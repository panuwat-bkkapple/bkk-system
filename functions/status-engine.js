// Job status transition engine — pure decision core.
//
// WHY THIS EXISTS
// Today every status write in the system is `update(ref(db, 'jobs/'+id), {
// status: X })`. There is no transition table anywhere, no validation that X is
// reachable from the current status, and the RTDB rules do not validate the
// field either — a rider can write "Paid" over "New Lead", or write "asdf".
// The guards that exist are render-time conditions in three different UIs, so a
// stale React tree, a second tab, or a direct API call walks straight past
// them. See docs/design/status-machine-v2.md (bkk-frontend-next) §5.
//
// WHAT THIS FILE IS
// The decision half of that engine, and nothing else: given the job as it is
// now plus an event, it answers "is this legal, what does it become, and what
// changes about the device and the money". It performs no I/O, so it can be
// unit-tested offline against real flows instead of against a mock database.
// The apply half (transaction, status_version bump, status_history append,
// side effects) lands separately; nothing calls this yet.
//
// THREE AXES, NOT ONE
// The survey found that `status` alone cannot answer the two questions the
// business actually asks. "Pending QC" means a paid device sitting in our
// store on a Pickup job, and an unpaid customer device on a Mail-in job — so
// the code that needs to know whether we have paid scans qc_logs for the word
// "Paid" instead of reading a field. And nothing at all records who is holding
// the device, which is why a job cancelled after a mail-in parcel arrives
// leaves that parcel with no state saying we still have it.
//   status  — where the job is in the workflow
//   custody — who physically holds the device right now
//   paid_at — set once, by one event
//
// EVENTS, NOT SET-STATUS
// Callers send what happened ("rider_accepted"), never the status they want.
// The destination is this table's business, which is what keeps the rule in
// one place instead of in 60 call sites.

const {
  JOB_STATUS,
  JOB_STATUS_B2B,
  RECEIVE_METHOD,
  normalizeStatus,
} = require("./status-vocab.generated");

// ── Custody ─────────────────────────────────────────────────────────────────
// Who is holding the device. `=` in a transition means "unchanged".
const CUSTODY = {
  CUSTOMER: "customer",
  RIDER: "rider",
  CARRIER_INBOUND: "carrier_inbound",
  CARRIER_RETURN: "carrier_return",
  STORE: "store",
  RELEASED: "released", // sold, returned to the customer, or written off
};

// Inspection happens in the customer's hands on a Pickup (the rider inspects at
// the door, before any money moves) and in ours on every other method. Several
// transitions therefore cannot name a single custody value.
const CUSTODY_BY_METHOD = "__by_receive_method__";

function custodyForMethod(receiveMethod) {
  return receiveMethod === RECEIVE_METHOD.PICKUP ? CUSTODY.CUSTOMER : CUSTODY.STORE;
}

// ── Actors ──────────────────────────────────────────────────────────────────
// Roles as the running system already understands them. `admin_manager` is
// CEO/MANAGER — the pair that already gates SICKW overrides and dealer lots.
const ACTOR = {
  CUSTOMER: "customer",
  RIDER: "rider",
  ADMIN_STAFF: "admin_staff",
  ADMIN_MANAGER: "admin_manager",
  FINANCE: "finance",
  SYSTEM: "system",
  DEALER_FLOW: "dealer_flow",
};

// An admin_manager may do anything an admin_staff may do, and system may do
// anything at all (schedulers, triggers, migrations).
const ACTOR_IMPLIES = {
  [ACTOR.ADMIN_MANAGER]: [ACTOR.ADMIN_STAFF],
};

function actorSatisfies(actual, allowed) {
  if (allowed.includes(actual)) return true;
  if (actual === ACTOR.SYSTEM) return true;
  return (ACTOR_IMPLIES[actual] || []).some((implied) => allowed.includes(implied));
}

// ── Job line ────────────────────────────────────────────────────────────────
// `type` on the job row separates the corporate bulk line from the retail one.
// It is a raw database value, not part of the status enum, and deliberately
// stays out of `job-statuses.ts`: that file is byte-identical across three
// repos, and adding a constant only the engine reads would spend a
// three-repo sync on it. `jobTypeParity` in the offline suite pins the literal
// against the writers instead.
//
// WHY THE ENGINE NEEDS IT AT ALL — the two lines share five status values
// (Following Up, Negotiation, Paid, In Stock, Completed). Without this axis,
// `b2b_unpacked_to_stock` (from "Paid") would be legal on a retail job that
// was just paid out, and one call would turn a customer's phone into a
// corporate lot and close their ticket.
const JOB_TYPE = {
  B2B: "B2B Trade-in",
};

// ── Transition table ────────────────────────────────────────────────────────
// One row per event. `from` is the set of statuses the event is legal in;
// omitting it means "any status" (only used where the whole point is that the
// job can be anywhere, e.g. quarantine). `methods` and `jobTypes` narrow the
// same way and are omitted on every row that does not need them — a row
// without `jobTypes` is legal on both the retail and the corporate line,
// which is what keeps the retail rows behaving exactly as they did before
// the corporate line existed (legacy retail rows carry no `type` field at
// all, so requiring one there would break them).
//
// This table describes the lifecycle as it runs TODAY, using canonical status
// values. The v2 additions that need an enum change (Awaiting Customer
// Decision, Quarantined, Return In Transit) are deliberately absent: the enum
// is a coordinated three-repo change and the readers have to move first.
const S = JOB_STATUS;
const B = JOB_STATUS_B2B;

const TRANSITIONS = {
  // Phase 1-2: created and sales -------------------------------------------
  case_claimed: {
    from: [S.NEW_LEAD],
    to: S.FOLLOWING_UP,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
  },
  appointment_set: {
    from: [S.NEW_LEAD, S.FOLLOWING_UP],
    to: S.APPOINTMENT_SET,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    // Mail-in เพิ่มเข้ามาเพราะปุ่ม "นัดหมายแล้ว" บน MobileTicketDetail ขึ้นที่
    // New Lead ทุกวิธีรับ ไม่ได้แยก — การนัดวันส่งพัสดุก็เป็นการนัดหมายอย่างหนึ่ง
    methods: [RECEIVE_METHOD.PICKUP, RECEIVE_METHOD.STORE_IN, RECEIVE_METHOD.MAIL_IN],
  },
  dropoff_confirmed: {
    from: [S.NEW_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET],
    to: S.WAITING_DROP_OFF,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.STORE_IN],
  },
  mailin_confirmed: {
    from: [S.NEW_LEAD, S.FOLLOWING_UP],
    to: S.AWAITING_SHIPPING,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.MAIL_IN],
  },
  // from-list กว้างกว่าสเปกเดิมเพราะปุ่ม "ส่งงานให้พนักงานเข้ารับเครื่อง" บน
  // PricingSidebar ขึ้นทั้งกลุ่ม `isNew` — ACTIVE_LEAD คือการ re-broadcast ซ้ำ
  // (idempotent) ส่วน WAITING_DROP_OFF/AWAITING_SHIPPING คืองานที่แอดมิน
  // เปลี่ยนวิธีรับจาก Store-in/Mail-in มาเป็น Pickup ทีหลัง (`canChangeReceiveMethod`
  // เปิดทางนั้นไว้จริง) แถวนั้นค้างอยู่ที่สถานะของวิธีเดิม
  broadcast_to_riders: {
    from: [
      S.NEW_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET,
      S.ACTIVE_LEAD, S.WAITING_DROP_OFF, S.AWAITING_SHIPPING,
    ],
    to: S.ACTIVE_LEAD,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.PICKUP],
  },
  // ปุ่ม "เริ่มดำเนินการ (Active Lead)" ของสาย Store-in/Mail-in
  //
  // **คนละ event กับ broadcast_to_riders โดยตั้งใจ ทั้งที่ปลายทางเดียวกัน** —
  // ตัวนั้นแปลว่า "ไรเดอร์เห็นงานนี้ได้แล้ว" ซึ่งเป็นความจริงเฉพาะสาย Pickup
  // ยืมมาใช้กับ Mail-in จะทำให้ qc_logs กับ status_history เล่าเรื่องที่ไม่เกิดขึ้น
  //
  // ตรวจแล้วว่าการที่งาน Mail-in/Store-in ไปนั่งที่ Active Lead ไม่ทำให้มันโผล่
  // ในคิวไรเดอร์: `useRiderData.ts` กรอง `receive_method !== PICKUP` ทิ้ง
  // **ก่อนดูสถานะด้วยซ้ำ** — Active Lead ของสองวิธีนั้นจึงเป็นแค่ "เริ่มดำเนินการ
  // แล้ว" ไม่ใช่คิวแย่งงาน
  processing_started: {
    from: [S.APPOINTMENT_SET, S.WAITING_DROP_OFF, S.AWAITING_SHIPPING],
    to: S.ACTIVE_LEAD,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.STORE_IN, RECEIVE_METHOD.MAIL_IN],
  },
  rider_assigned: {
    from: [S.ACTIVE_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET],
    to: S.RIDER_ASSIGNED,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.PICKUP],
  },

  // Phase 3a: pickup logistics ---------------------------------------------
  // The one transition that is already correct in production: the rider app
  // claims a job inside runTransaction after re-reading the row, so two riders
  // racing for the same broadcast cannot both win. The engine keeps that
  // shape — this row is the guard, not a suggestion.
  rider_accepted: {
    from: [S.ACTIVE_LEAD, S.RIDER_ASSIGNED],
    to: S.RIDER_ACCEPTED,
    custody: "=",
    actors: [ACTOR.RIDER],
    methods: [RECEIVE_METHOD.PICKUP],
  },
  // เดิม actors เป็น [RIDER] เท่านั้น ซึ่งตรงกับความจริงว่าไรเดอร์เป็นคนกด แต่
  // **แอดมินกดแทนได้อยู่แล้ววันนี้** จากปุ่ม "กำลังเดินทาง (Rider En Route)" บน
  // MobileTicketDetail ซึ่งขึ้นที่ Assigned / Accepted / Active Lead (ที่มีไรเดอร์
  // แล้ว) — ไรเดอร์ลืมกดแล้วโทรบอกแอดมินเป็นเรื่องปกติ เหตุผลเดียวกับ rider_arrived
  rider_departed: {
    from: [S.RIDER_ACCEPTED, S.RIDER_ASSIGNED, S.ACTIVE_LEAD],
    to: S.RIDER_EN_ROUTE,
    custody: "=",
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
  },
  // RIDER_ASSIGNED/RIDER_ACCEPTED คือ manual override ของแอดมิน ไม่ใช่ช่องโหว่:
  // ปุ่ม "ไรเดอร์ถึงแล้ว (Mark Arrived)" ขึ้นทั้งกลุ่ม logistics เพราะไรเดอร์
  // ลืมกดปุ่มระหว่างทางเป็นเรื่องปกติ แล้วแอดมินแก้ให้จากหน้าจอ. ตัดออกเมื่อไหร่
  // งานที่ไรเดอร์ลืมกดจะเดินต่อไม่ได้เลยและไม่มีทางแก้จากที่ไหน
  rider_arrived: {
    from: [S.RIDER_EN_ROUTE, S.RIDER_ASSIGNED, S.RIDER_ACCEPTED],
    to: S.RIDER_ARRIVED,
    custody: "=",
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
  },
  // The rider stands down mid-route. This is NOT a cancel: the job goes back
  // to the sales queue for an admin to re-broadcast, which is why it carries
  // rider_withdrawal rather than the cancel taxonomy. Writing cancel_* here is
  // what left live jobs looking cancelled while they were still running.
  rider_withdrew: {
    from: [S.RIDER_ASSIGNED, S.RIDER_ACCEPTED, S.RIDER_EN_ROUTE, S.RIDER_ARRIVED],
    to: S.FOLLOWING_UP,
    custody: CUSTODY.CUSTOMER,
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
    clears: ["rider_id"],
    // ประทับ withdrawn_at/withdrawn_by แทนการเขียน cancel_* — แอดมินต้องรู้ว่า
    // "ไรเดอร์ทิ้งงาน" เพื่อขึ้นปุ่ม Re-broadcast กับแบนเนอร์เตือน ซึ่งเดิม
    // อ่านจาก cancelled_at + cancelled_by ที่ไคลเอนต์เขียน. ฟิลด์ชุดนั้นทำให้
    // งานที่ยังวิ่งอยู่ถือ cancelled_at ค้างไว้ แล้ววันที่แอดมินยกเลิกจริงโดย
    // ไม่เขียนทับ finalizeCancelledJobs จะเห็นเวลาเก่าหลายสัปดาห์แล้วปิดงาน
    // ทันทีแทนที่จะรอครบ 7 วัน — แยกฟิลด์จึงไม่ใช่เรื่องความสะอาด แต่กันเคสนั้น
    stampsWithdrawn: true,
  },
  // แอดมินดึงงานกลับเข้าคิวเอง — คนละเหตุการณ์กับ rider_withdrew และ**ห้ามยุบ
  // รวมกันแม้ actors จะทับกัน** เพราะสองอย่างนี้ต่างกันที่ปลายทางและที่คนอ่าน:
  //
  // - ปลายทาง: ไรเดอร์ทิ้งงานกลางทาง = ลูกค้ารออยู่แล้วไม่มีใครไป ต้องมีคนโทร
  //   ไปบอก จึงลง Following Up. แอดมินสับเปลี่ยนคนเอง = ไม่มีอะไรต้องอธิบาย
  //   กับลูกค้า งานกลับเข้าคิวแย่งงานตรงๆ จึงลง Active Leads
  // - คนอ่าน: `wasRiderWithdrawn()` (src/utils/riderWithdrawal.ts) เป็นตัวขึ้น
  //   ปุ่ม Re-broadcast กับแบนเนอร์เตือน ถ้า unassign ประทับ withdrawn_* ด้วย
  //   แอดมินที่เพิ่งกดสับเปลี่ยนเองจะโดนเตือนว่า "ไรเดอร์ทิ้งงานใบนี้" ทุกครั้ง
  //
  // ล้าง assigned_at ด้วย ไม่ใช่แค่ rider_id — เป็นการรักษาพฤติกรรมที่ตัวเขียน
  // เดิม (DispatcherPage.handleUnassignJob) ทำอยู่แล้ว ไม่ใช่ของใหม่. คนอ่าน
  // ฟิลด์นี้มีที่เดียวคือ `src/utils/riderAudit.ts` ซึ่งวางมันลงแถว audit ตรงๆ
  // ถ้าค้างไว้ งานที่กลับเข้าคิวแย่งงานแล้วจะยังโชว์เวลามอบหมายของคนก่อนหน้า
  rider_unassigned: {
    from: [S.RIDER_ASSIGNED, S.RIDER_ACCEPTED, S.RIDER_EN_ROUTE, S.RIDER_ARRIVED],
    to: S.ACTIVE_LEAD,
    custody: CUSTODY.CUSTOMER,
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.PICKUP],
    clears: ["rider_id", "assigned_at"],
  },

  // Phase 3b-3c: store-in and mail-in intake --------------------------------
  dropoff_received: {
    from: [S.WAITING_DROP_OFF, S.APPOINTMENT_SET, S.NEW_LEAD, S.FOLLOWING_UP],
    to: S.DROP_OFF_RECEIVED,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.STORE_IN],
  },
  // Idempotent on purpose: a customer who mistypes a tracking number must be
  // able to correct it while the parcel is still inbound. What it must never do
  // is drag a received or paid job backwards, which is why `from` stops there.
  parcel_shipped: {
    from: [S.AWAITING_SHIPPING, S.NEW_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET, S.PARCEL_IN_TRANSIT],
    to: S.PARCEL_IN_TRANSIT,
    custody: CUSTODY.CARRIER_INBOUND,
    actors: [ACTOR.CUSTOMER, ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.MAIL_IN],
    requires: ["tracking_number"],
  },
  // ปุ่ม "รับพัสดุไว้ก่อน (ยังไม่เปิด)" บน MobileTicketDetail ขึ้นทั่วขาขายของ
  // Mail-in ไม่ใช่แค่ตอน tracking บอกว่าของอยู่กับขนส่ง — พัสดุถึงสาขาได้โดยที่
  // ไม่มีใครเคยกรอก tracking เลย (แถวเก่ายังค้างอยู่ที่สถานะไรเดอร์ก็มี)
  parcel_received: {
    from: [
      S.PARCEL_IN_TRANSIT, S.APPOINTMENT_SET, S.WAITING_DROP_OFF,
      S.AWAITING_SHIPPING, S.ACTIVE_LEAD, S.RIDER_EN_ROUTE,
    ],
    to: S.PARCEL_RECEIVED,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.MAIL_IN],
  },
  carrier_investigation_opened: {
    from: [S.PARCEL_IN_TRANSIT],
    to: S.INVESTIGATING_CARRIER,
    custody: CUSTODY.CARRIER_INBOUND,
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.MAIL_IN],
  },
  carrier_investigation_resolved: {
    from: [S.INVESTIGATING_CARRIER],
    to: S.PARCEL_RECEIVED,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },
  // Terminal, and the only status where the device is gone but nobody chose to
  // let it go. Manager-gated because it opens a claim against the carrier.
  parcel_declared_lost: {
    from: [S.INVESTIGATING_CARRIER],
    to: S.PARCEL_LOST,
    custody: "=",
    actors: [ACTOR.ADMIN_MANAGER],
  },

  // Phase 4: inspection ------------------------------------------------------
  // สามสถานะไรเดอร์ที่เพิ่มเข้ามา (ASSIGNED/ACCEPTED/EN_ROUTE) มาจากปุ่ม "เริ่ม
  // ตรวจสภาพเครื่อง (Start QC)" ที่ขึ้นทั้งกลุ่ม logistics — เงื่อนไขปุ่มหลวม
  // กว่าที่ควร (เริ่มตรวจก่อนไรเดอร์ถึงบ้านลูกค้าไม่มีความหมาย) แต่วันนี้ยอมให้
  // ทำ และการปิดที่ engine จะทำให้ปุ่มพังโดยที่ไม่มีใครแก้เงื่อนไขปุ่ม
  // **ที่ควรแก้คือเงื่อนไขปุ่ม ไม่ใช่ from-list — ทำแยกใบเมื่อเจ้าของงานเคาะ**
  //
  // APPOINTMENT_SET มาจากปุ่ม "ลูกค้ามาถึงสาขา" ของ Store-in ซึ่งถูกต้องตรงไปตรงมา
  inspection_started: {
    from: [
      S.RIDER_ARRIVED, S.DROP_OFF_RECEIVED, S.PARCEL_RECEIVED, S.WAITING_DROP_OFF,
      S.APPOINTMENT_SET, S.RIDER_ASSIGNED, S.RIDER_ACCEPTED, S.RIDER_EN_ROUTE,
      // สามตัวนี้มาจาก MobileTicketDetail (P2-j): ปุ่ม branch intake ขึ้นที่
      // Awaiting Shipping / Parcel In Transit / Active Lead ด้วย เพราะเครื่อง
      // มาถึงเคาน์เตอร์ได้ทุกจังหวะของขาขาย (ลูกค้าเดินเข้ามาก่อนนัด, พัสดุถึง
      // ก่อนมีคนอัปเดต tracking) ไม่ใช่ตามลำดับที่สถานะบอก
      S.AWAITING_SHIPPING, S.PARCEL_IN_TRANSIT, S.ACTIVE_LEAD,
    ],
    to: S.BEING_INSPECTED,
    custody: CUSTODY_BY_METHOD,
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
  },
  inspection_submitted: {
    from: [S.BEING_INSPECTED],
    to: S.QC_REVIEW,
    custody: "=",
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
  },
  inspection_reverted: {
    from: [S.QC_REVIEW],
    to: S.BEING_INSPECTED,
    custody: "=",
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
    // Deliberately blocked once money has moved: the rider app offers this as
    // "go back and edit", which must not reopen a paid job.
    blockedWhenPaid: true,
  },
  // Today's two "customer must decide" statuses. v2 merges them into one
  // Awaiting Customer Decision with an SLA; until the readers move, the engine
  // keeps both reachable and treats them as the same stage.
  // PENDING_QC มาจากปุ่ม "ต้องเจรจาราคา (Negotiation)" บน MobileTicketDetail
  // ซึ่งขึ้นที่ Pending QC ด้วย (ขา Mail-in/Store-in ที่ยังไม่จ่ายเงิน)
  offer_revised: {
    from: [S.QC_REVIEW, S.BEING_INSPECTED, S.PENDING_QC],
    to: S.NEGOTIATION,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    blockedWhenPaid: true,
  },
  customer_accepted_price: {
    from: [S.QC_REVIEW, S.NEGOTIATION, S.REVISED_OFFER, S.BEING_INSPECTED, S.PENDING_QC],
    to: S.PRICE_ACCEPTED,
    custody: "=",
    // The rider taps this at the door on the customer's behalf; the decision is
    // still the customer's, which is what the audit trail must record.
    actors: [ACTOR.CUSTOMER, ACTOR.RIDER, ACTOR.ADMIN_STAFF],
    blockedWhenPaid: true,
  },

  // ลูกค้ารับราคาที่ปรับใหม่ "ต่อหน้าไรเดอร์" แล้วข้ามไป Payout Processing เลย
  //
  // ทำไมไม่ใช่ customer_accepted_price ซึ่งพาไป Price Accepted: เพราะนี่คือ
  // พฤติกรรมที่ระบบทำอยู่จริงวันนี้ และเจ้าของงานตัดสินให้คงไว้ (1 ก.ย. 2569)
  // ไรเดอร์ยืนอยู่หน้าลูกค้า ตกลงราคากันจบแล้ว ไม่มีขั้น "รอลูกค้ายืนยัน" คั่น
  // อีกชั้น — งานเข้าคิวโอนเงินทันที
  //
  // **หนี้ที่รู้ตัวและตั้งใจรับไว้:** ตอนนี้ "ลูกค้ารับราคา" มีปลายทางสองที่
  // ตามช่องทาง — ทางเว็บ (`/api/jobs/action` accept-price) ไป Price Accepted
  // ส่วนทางไรเดอร์มาที่นี่ ไป Payout Processing. PR นี้ **ไม่แตะทางเว็บ**
  // เพราะการรวมสองทางเป็นการตัดสินใจเชิง spec ไม่ใช่ผลพลอยได้ของ cutover —
  // และมันคือส่วนหนึ่งของการยุบ Negotiation + Revised Offer เป็น
  // Awaiting Customer Decision ใน v2 ซึ่งยังไม่เคาะ
  //
  // ขอบเขตแคบโดยตั้งใจ: from มีแค่สองสถานะที่ "มีข้อเสนอค้างอยู่จริง" และ
  // ไม่ได้ไปเติม actor ไรเดอร์ให้ payout_started (ซึ่ง from กว้างกว่ามาก
  // รวม QC Review กับ Price Accepted) เพราะนั่นคือการเปิดสิทธิ์เกินคำถาม
  revised_offer_accepted: {
    from: [S.REVISED_OFFER, S.NEGOTIATION],
    to: S.PAYOUT_PROCESSING,
    custody: "=",
    actors: [ACTOR.CUSTOMER, ACTOR.RIDER, ACTOR.ADMIN_STAFF],
    blockedWhenPaid: true,
  },

  // Phase 5: payout ----------------------------------------------------------
  // **การขยายที่หนักที่สุดในชุดนี้ และเจ้าของงานเคาะแล้วว่าคงพฤติกรรมเดิม**
  //
  // ปุ่ม "สภาพผ่านเกณฑ์ (Approve)" ขึ้นทั้งกลุ่ม `isQC` = Being Inspected,
  // Pending QC, QC Review, Discrepancy Reported แปลว่าวันนี้แอดมินอนุมัติจ่ายเงิน
  // จาก Being Inspected ได้โดย**ข้ามขั้น QC Review** ซึ่งเป็นของจริงในร้าน:
  // Store-in/Mail-in แอดมินตรวจแล้วอนุมัติในนั่งเดียว ไม่มีขั้นรีวิวคั่น
  //
  // ที่ตัดสินใจแบบนี้เพราะปิดที่ engine = ปุ่มจ่ายเงินพังทั้งสาย Store-in/Mail-in
  // ส่วนด่านที่ยังกันอยู่จริงคือ `!hasBeenPaid` ที่เงื่อนไขปุ่ม + blockedWhenPaid
  // ของ event ปลายทาง ไม่ใช่ from-list ตัวนี้
  payout_started: {
    from: [
      S.PRICE_ACCEPTED, S.QC_REVIEW, S.NEGOTIATION, S.REVISED_OFFER,
      S.BEING_INSPECTED, S.PENDING_QC, S.DISCREPANCY_REPORTED,
    ],
    to: S.PAYOUT_PROCESSING,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF, ACTOR.FINANCE],
    // **จำเป็นเพราะการขยาย from-list ข้างบน ไม่ใช่ของแถม** — PENDING_QC เป็น
    // สถานะ *หลังจ่ายเงิน* ของสาย Pickup (ไรเดอร์ส่งมอบเครื่องที่สาขา) การรับ
    // สถานะนั้นเข้ามาโดยไม่มีด่านนี้ = ดันงานที่จ่ายเงินไปแล้วกลับเข้าคิวจ่ายเงิน
    // ได้อีกรอบ ซึ่งคือการจ่ายซ้ำ. เงื่อนไขปุ่มมี `!hasBeenPaid` อยู่แล้วแต่
    // engine ห้ามพึ่ง UI — เทสที่จับเรื่องนี้ได้คือตัวที่เขียนหลังขยายเสร็จ
    blockedWhenPaid: true,
  },
  // The one event that stamps paid_at. Everything downstream reads that field
  // instead of guessing from the status or scanning qc_logs.
  payment_confirmed: {
    from: [S.PAYOUT_PROCESSING],
    to: S.WAITING_FOR_HANDOVER,
    custody: "=",
    actors: [ACTOR.FINANCE],
    stampsPaid: true,
  },
  // ปุ่ม "จ่ายเงินแล้ว (Paid)" บน MobileTicketDetail — ทางลัดที่ประกาศว่าเงินออก
  // แล้วโดยข้ามหน้า finance และ **ไม่สร้างแถว `transactions`**
  //
  // **การมี event นี้ไม่ได้แปลว่าเรารับรองว่าทางนั้นถูกต้องทางบัญชี** — คำถามว่า
  // "เงินออกได้โดยไม่มีแถว ledger ไหม" ยังเปิดอยู่เหมือนเดิม สิ่งที่ event นี้
  // เปลี่ยนคือ *ใครคุมทางนั้น*: วันนี้ไคลเอนต์เขียน 'Paid' ทับสถานะอะไรก็ได้ที่
  // ปุ่ม render อยู่ ไม่มี from-list ไม่มี status_version ไม่มี status_history
  // ผ่าน engine แล้วมันแคบลงทั้งสามอย่าง — **การย้ายนี้จึงรัดเข้า ไม่ได้เปิดออก**
  //
  // ถ้าวันหนึ่งเจ้าของงานเคาะว่าเงินต้องออกทาง finance เท่านั้น แก้ที่ actors
  // บรรทัดเดียว (ตัด ADMIN_STAFF ออก) แล้วปุ่มจะถูกปฏิเสธด้วย wrong_actor
  // พร้อมข้อความไทย ไม่ต้องรื้ออะไรอีก
  //
  // **ไม่ตั้ง `stampsPaid` โดยตั้งใจ และครั้งแรกผมตั้งไว้ผิด** — registry ของ
  // side effect บังคับว่า event ที่ประทับ `paid_at` ได้มี **ตัวเดียว** คือ
  // `payment_confirmed` (เทส "every named side effect is owned by a real event,
  // exactly once" ใน status-apply.test.mjs จับได้ทันที) การเพิ่มตัวที่สองคือการ
  // เปิดประตูที่สองไปหาเวลาที่ฝ่ายบัญชีอ่าน ซึ่งเป็นสิ่งที่ registry มีไว้กัน
  //
  // `paid_at` ของทางนี้จึงยังมาจาก trigger `onJobStatusChanged` เหมือนเดิม —
  // คอมเมนต์ที่นั่นเขียนไว้ตรงตัวว่ามีไว้เพราะ "ปุ่มมือถือเขียนแค่สถานะ" และมัน
  // write-once อยู่แล้ว **พฤติกรรมจึงเท่าเดิมเป๊ะ ไม่ใช่การถอยหลัง**
  admin_marked_paid: {
    from: [S.PAYOUT_PROCESSING],
    to: S.PAID,
    // ไม่แตะแกน custody โดยตั้งใจ — event นี้พูดเรื่องเงินอย่างเดียว ไม่ได้บอก
    // ว่าเครื่องอยู่กับใคร (ต่างจาก payment_handover_done ที่เป็นการส่งมอบจริง)
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF, ACTOR.FINANCE],
  },
  payment_handover_done: {
    from: [S.WAITING_FOR_HANDOVER],
    to: S.PAID,
    custody: CUSTODY.RIDER,
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.PICKUP],
  },
  // No paid-money check here, and that is a finding rather than an omission:
  // paid_at is auto-stamped only on entry to PAID_STATUSES ("Paid", "PAID",
  // "Payment Completed") — 'Waiting For Handover' is not one of them, so the
  // 21 live jobs sitting at that status carry no timestamp at all. Requiring
  // one would refuse the return leg for every job the legacy finance writer
  // created, which is a rider stranded at the customer's door.
  //
  // The from-list is the real guard anyway: both statuses already mean the
  // transfer happened. Once finance moves onto the engine, payment_confirmed
  // stamps paid_at on the way into Waiting For Handover and the field becomes
  // trustworthy — at which point a money check here would be worth adding.
  rider_return_started: {
    from: [S.PAID, S.WAITING_FOR_HANDOVER],
    to: S.RIDER_RETURNING,
    custody: CUSTODY.RIDER,
    actors: [ACTOR.RIDER],
    methods: [RECEIVE_METHOD.PICKUP],
  },
  // Entering Pending QC is what pays the rider (onJobHandedOverCalcRiderFee).
  // That side effect is keyed to the status value today; the registry moves it
  // to this event so a rename cannot silently stop paying riders.
  // PAID/WAITING_FOR_HANDOVER = แอดมินกดยืนยันรับมอบแทนไรเดอร์ที่ไม่ได้กด
  // "เดินทางกลับ" (ปุ่มบน PricingSidebar ขึ้นตั้งแต่งานจ่ายเงินแล้วและยังไม่ถึง
  // Pending QC) — ขั้นนี้เป็นตัวที่ทำให้ `onJobHandedOverCalcRiderFee` คำนวณ
  // ค่าวิ่ง ปิดทางนี้ = ไรเดอร์ไม่ได้เงินค่ารอบเมื่อลืมกดปุ่มเดียว
  rider_return_arrived: {
    from: [S.RIDER_RETURNING, S.PAID, S.WAITING_FOR_HANDOVER],
    to: S.PENDING_QC,
    custody: CUSTODY.STORE,
    actors: [ACTOR.RIDER, ACTOR.ADMIN_STAFF],
  },
  // Mail-in and store-in reach the QC queue without a rider leg.
  intake_queued_for_qc: {
    from: [S.PARCEL_RECEIVED, S.DROP_OFF_RECEIVED, S.PARCEL_IN_TRANSIT],
    to: S.PENDING_QC,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },

  // Phase 7: inventory -------------------------------------------------------
  // สามสถานะหลังจ่ายเงินมาจากปุ่ม "เข้าสต็อก (In Stock)" บน MobileTicketDetail
  // ซึ่งขึ้นที่ Paid / Waiting For Handover / Rider Returning ของขา Store-in
  // และ Mail-in — เครื่องอยู่ที่สาขาตั้งแต่ต้น ไม่มีขั้นรับมอบจากไรเดอร์คั่น
  intake_qc_passed: {
    from: [
      S.PENDING_QC, S.QC_REVIEW, S.SENT_TO_QC_LAB,
      S.PAID, S.WAITING_FOR_HANDOVER, S.RIDER_RETURNING,
    ],
    to: S.IN_STOCK,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },
  // PAID/WAITING_FOR_HANDOVER = สาย Store-in/Mail-in ที่จ่ายเงินแล้วและเครื่อง
  // อยู่ที่ร้านตั้งแต่ต้น ไม่มีขั้นรับมอบจากไรเดอร์คั่น จึงส่งเข้าแล็บได้ตรงๆ
  //
  // **ไม่ขยายไปถึง SOLD/COMPLETED/READY_TO_SELL ทั้งที่ปุ่มไปถึงได้วันนี้** —
  // `hasBeenPaid` ของหน้านั้นครอบสถานะขายจบไปด้วย การถอยเครื่องที่ขายแล้วกลับ
  // เข้าแล็บไม่ใช่พฤติกรรมที่คุ้มค่าจะรักษา มันคือเงื่อนไขปุ่มที่หลวม ไม่ใช่ฟีเจอร์
  sent_to_lab: {
    from: [S.PENDING_QC, S.IN_STOCK, S.PAID, S.WAITING_FOR_HANDOVER, S.RIDER_RETURNING],
    to: S.SENT_TO_QC_LAB,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },
  pushed_to_pos: {
    from: [S.IN_STOCK],
    to: S.READY_TO_SELL,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },
  // PENDING_QC มาจากปุ่ม "ขายแล้ว (Sold)" บน MobileTicketDetail ที่ขึ้นเฉพาะสาขา
  // "จ่ายเงินแล้ว" ของ Pending QC (ตรวจจาก qc_logs) = เครื่องอยู่ในมือเราแล้ว
  sold: {
    from: [S.READY_TO_SELL, S.IN_STOCK, S.PENDING_QC],
    to: S.SOLD,
    custody: CUSTODY.RELEASED,
    actors: [ACTOR.ADMIN_STAFF, ACTOR.DEALER_FLOW],
  },
  sale_voided: {
    from: [S.SOLD],
    to: S.IN_STOCK,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },
  job_completed: {
    from: [S.SOLD, S.IN_STOCK],
    to: S.COMPLETED,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
  },

  // Cancel, reopen, expiry ---------------------------------------------------
  // Cancelling is legal only while the deal has not been paid for. The
  // cancel taxonomy is required by the engine rather than by convention: every
  // channel that skipped cancelled_at left a job that the 7-day finaliser
  // could never pick up, so it stayed soft-cancelled forever.
  // แอดมินถอนงานออกจากคิวแย่งงานกลับไปขาขาย — ปุ่ม "กลับไปติดตาม (Following Up)"
  // บน MobileTicketDetail ที่ขึ้นตอน Active Lead ยังไม่มีไรเดอร์รับ
  //
  // **คนละตัวกับ rider_unassigned ซึ่งวิ่งสวนทาง** (พาเข้าคิว) และคนละตัวกับ
  // case_claimed (New Lead -> Following Up ตอนแอดมินรับเคสครั้งแรก) การยืมสองตัว
  // นั้นมาใช้จะทำให้ qc_logs เล่าเรื่องผิด: ใบนี้ไม่ใช่การรับเคสใหม่และไม่ใช่การ
  // ดึงงานจากไรเดอร์
  broadcast_recalled: {
    from: [S.ACTIVE_LEAD],
    to: S.FOLLOWING_UP,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
  },
  // ย้อนสถานะกลับจากปลายทางขายเมื่อกดผิด — ปุ่ม "ย้อนสถานะกลับ -> Pending QC"
  // บน MobileTicketDetail ที่ขึ้นที่ Sold / In Stock / Ready To Sell / Sent To QC Lab
  //
  // ก่อนหน้านี้สี่สถานะนั้นไม่มีปุ่มอะไรเลย งานที่กดผิดจึงค้างถาวร ปุ่มนี้เป็น
  // ทางกลับที่มีอยู่แล้ววันนี้ ไม่ใช่ของใหม่
  //
  // **ไม่ใช้ sale_voided** (Sold -> In Stock) เพราะปลายทางต่างกัน และตัวนั้นพูดถึง
  // การยกเลิกการขายซึ่งมีความหมายทางบัญชี ส่วนใบนี้คือแอดมินกดผิดแล้วย้อน
  //
  // งานพวกนี้จ่ายเงินไปแล้วทั้งหมด จึงไม่ใส่ blockedWhenPaid (จะบล็อกทุกใบ) —
  // ด่านที่กันการจ่ายซ้ำคือ blockedWhenPaid ของ payout_started ที่ปลายทางอีกฝั่ง
  sale_reverted_to_qc: {
    from: [S.SOLD, S.IN_STOCK, S.READY_TO_SELL, S.SENT_TO_QC_LAB],
    to: S.PENDING_QC,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
  },


  // Phase B: corporate bulk (B2B) -------------------------------------------
  //
  // A separate line, not a variant of the retail one: the unit is a LOT, the
  // device count is unknown until an auditor walks the customer's floor, and
  // the money moves against a PO and a tax invoice instead of a payout to a
  // person. Nothing crosses between the two lines — a job is one or the other
  // from the moment it is created.
  //
  // Every row below carries `jobTypes` because the two lines share status
  // values; see the JOB_TYPE block above for what that guard is actually
  // stopping.
  //
  // NO `methods` ON ANY B2B ROW, ON PURPOSE. B2B parents do not carry a
  // receive method the enum knows: the corporate web form writes
  // "Corporate Pickup" and the admin-created deal (B2BDispatchQueue) writes
  // nothing at all. A `methods` list would therefore reject every B2B job,
  // and adding those two strings to RECEIVE_METHOD would tell the retail
  // logistics rows that a lot can be broadcast to riders.
  //
  // CUSTODY STAYS "=" THROUGH THE WHOLE LINE, ALSO ON PURPOSE. The parent is
  // a deal, not a device — there is no single thing for it to hold, and the
  // system has never recorded a handover moment for a lot. Per-device custody
  // begins on the child jobs the unpack creates, each of which enters the
  // retail inventory flow at Pending QC. Writing "store" onto the parent
  // would assert an observation nobody made.
  //
  // The from-lists are read off the buttons that exist today (B2BManager's
  // action panel, B2BDispatchQueue's two lists, B2BAuditorTool's job filter),
  // not off a spec — every one of them is a status the UI can currently be
  // sitting on when that button is pressed.
  b2b_followed_up: {
    from: [B.NEW_B2B_LEAD],
    to: S.FOLLOWING_UP,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
    // B2BManager handleCallCustomer — writes only when the deal is still at
    // New B2B Lead, so the from-list is that one status and nothing else.
  },
  // Both B2BManager (buttons shown at New B2B Lead / Following Up) and
  // B2BDispatchQueue (whose queue holds those two plus both Pre-Quote states)
  // send this. Pre-Quote Sent is in the list because a re-send is the same
  // event landing on the same status — the dispatch screen only greys the
  // button out, which is a UI nicety and not a rule the engine should invent.
  b2b_pre_quote_sent: {
    from: [B.NEW_B2B_LEAD, S.FOLLOWING_UP, B.PRE_QUOTE_SENT, B.PRE_QUOTE_ACCEPTED],
    to: B.PRE_QUOTE_SENT,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  b2b_pre_quote_accepted: {
    from: [B.PRE_QUOTE_SENT],
    to: B.PRE_QUOTE_ACCEPTED,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  // Admin schedules the site visit and hands the lot to an auditor.
  b2b_auditor_dispatched: {
    from: [B.NEW_B2B_LEAD, S.FOLLOWING_UP, B.PRE_QUOTE_SENT, B.PRE_QUOTE_ACCEPTED],
    to: B.SITE_VISIT_GRADING,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
    // site_visit_date is enforced by the two callers before they fire; it is
    // not in `requires` because both of them write it in the same patch, so
    // the engine would be reading the field it is being handed.
  },
  // The auditor scanned the first device on a lot nobody had dispatched.
  //
  // Same destination as b2b_auditor_dispatched and still a separate event,
  // for the reason processing_started is separate from broadcast_to_riders:
  // the two sentences are not the same sentence, and status_history is read
  // by people asking what happened. This one means "grading began", not
  // "a visit was scheduled" — there is no site_visit_date behind it.
  //
  // The wide from-list is B2BAuditorTool's own job filter: it offers every
  // B2B deal except the six it locks (Pending Finance Approval, Payment
  // Completed, In Stock, Completed, Cancelled, Closed (Lost)). The two
  // grading statuses are absent because the tool deliberately skips the
  // status write once the lot is already there — a no-op transition would
  // add a status_history row saying nothing happened.
  b2b_grading_started: {
    from: [
      B.NEW_B2B_LEAD, S.FOLLOWING_UP, B.PRE_QUOTE_SENT, B.PRE_QUOTE_ACCEPTED,
      B.FINAL_QUOTE_SENT, B.FINAL_QUOTE_ACCEPTED, S.NEGOTIATION,
      B.PO_ISSUED, B.WAITING_FOR_INVOICE,
    ],
    to: B.SITE_VISIT_GRADING,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  // AUDITOR_ASSIGNED is in this from-list and in no `to` anywhere: nothing in
  // any of the three repos writes it. It survives because both B2B screens
  // accept it as an in-grading status, so production rows that carry it (from
  // a version that did write it) must still be able to move forward. Do not
  // "clean it up" without checking the data first.
  b2b_final_quote_sent: {
    from: [B.SITE_VISIT_GRADING, B.AUDITOR_ASSIGNED],
    to: B.FINAL_QUOTE_SENT,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  b2b_negotiation_opened: {
    from: [B.FINAL_QUOTE_SENT],
    to: S.NEGOTIATION,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  // Negotiation is in the from-list because the negotiation panel's "ตกลงราคาได้"
  // button fires the same action as accepting the quote outright.
  b2b_final_quote_accepted: {
    from: [B.FINAL_QUOTE_SENT, S.NEGOTIATION],
    to: B.FINAL_QUOTE_ACCEPTED,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  // The PO number lives at documents.po_number — nested, so `requires` (which
  // only reads top-level fields) cannot check it. The caller blocks on it.
  b2b_po_issued: {
    from: [B.FINAL_QUOTE_ACCEPTED],
    to: B.PO_ISSUED,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  b2b_invoice_requested: {
    from: [B.PO_ISSUED],
    to: B.WAITING_FOR_INVOICE,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },
  b2b_submitted_to_finance: {
    from: [B.WAITING_FOR_INVOICE],
    to: B.PENDING_FINANCE_APPROVAL,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },

  // THE GAP BETWEEN THE TWO ROWS ABOVE AND BELOW IS DELIBERATE.
  // Pending Finance Approval -> Paid has no event, because the write that
  // makes it is `payoutTransfer` (src/utils/payoutTransfer.ts), which sets
  // the status and the DEBIT/CREDIT ledger rows in ONE multi-path update.
  // Splitting that so the status half could go through the engine would put
  // money movement and its ledger entry in two writes that can half-succeed —
  // the reason that file documents for staying off the engine. The from-list
  // below reads "Paid" because the legacy value that write produces for the
  // B2B branch is "Payment Completed", which normalizeStatus reads as Paid.

  // Closing the lot: the deal ends and its devices are re-created as one
  // child job per unit, each entering the retail inventory flow at Pending QC.
  // Those children are NOT this event's doing — the caller writes them in the
  // same multi-path update, because a lot that changed status without its
  // devices appearing anywhere is worse than one that did neither.
  b2b_unpacked_to_stock: {
    from: [S.PAID],
    to: S.COMPLETED,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    jobTypes: [JOB_TYPE.B2B],
  },

  cancelled: {
    from: [
      S.NEW_LEAD, S.ACTIVE_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET,
      S.WAITING_DROP_OFF, S.AWAITING_SHIPPING,
      S.RIDER_ASSIGNED, S.RIDER_ACCEPTED, S.RIDER_EN_ROUTE, S.RIDER_ARRIVED,
      S.PARCEL_IN_TRANSIT, S.PARCEL_RECEIVED, S.DROP_OFF_RECEIVED,
      S.BEING_INSPECTED, S.QC_REVIEW, S.NEGOTIATION, S.REVISED_OFFER,
      S.PRICE_ACCEPTED,
      // สาย B2B ทั้งเส้นก่อนจ่ายเงิน. วันนี้มีปุ่มยกเลิกใบเดียวคือ "ลูกค้าปฏิเสธ"
      // ที่ Pre-Quote Sent — ที่เหลือคือการขยายตามกฎของงานชุดนี้ (ขยายได้
      // ห้ามหด): กฎที่ยอมให้ยกเลิกตอนเพิ่งเสนอราคาแต่ห้ามยกเลิกตอนออก PO แล้ว
      // ไม่ใช่กฎ มันคือรูปร่างของหน้าจอที่บังเอิญมีปุ่มอยู่ที่เดียว
      // Payment Completed (= Paid) ไม่อยู่ในลิสต์ และ **การไม่อยู่ในลิสต์คือ
      // ตัวที่กันจริง** ไม่ใช่ blockedWhenPaid — decideTransition เช็ค from
      // ก่อน paid เสมอ ตัว blockedWhenPaid เป็นตาข่ายชั้นสองของสถานะที่
      // *อยู่* ในลิสต์แต่ดันมี paid_at ติดมา. ยกเลิกหลังโอนเงินคือ dispute
      B.NEW_B2B_LEAD, B.PRE_QUOTE_SENT, B.PRE_QUOTE_ACCEPTED,
      B.SITE_VISIT_GRADING, B.AUDITOR_ASSIGNED,
      B.FINAL_QUOTE_SENT, B.FINAL_QUOTE_ACCEPTED,
      B.PO_ISSUED, B.WAITING_FOR_INVOICE, B.PENDING_FINANCE_APPROVAL,
    ],
    to: S.CANCELLED,
    custody: "=",
    actors: [ACTOR.CUSTOMER, ACTOR.RIDER, ACTOR.ADMIN_STAFF],
    blockedWhenPaid: true,
    requires: ["cancel_category", "cancelled_by", "cancelled_at"],
  },
  reopened: {
    from: [S.CANCELLED],
    to: S.FOLLOWING_UP,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
  },
  finalized_lost: {
    from: [S.CANCELLED],
    to: S.CLOSED_LOST,
    custody: "=",
    actors: [ACTOR.SYSTEM],
  },
  dropoff_expired: {
    from: [S.WAITING_DROP_OFF, S.APPOINTMENT_SET, S.NEW_LEAD, S.FOLLOWING_UP],
    to: S.DROP_OFF_EXPIRED,
    custody: CUSTODY.CUSTOMER,
    actors: [ACTOR.SYSTEM],
    methods: [RECEIVE_METHOD.STORE_IN],
  },
  shipping_expired: {
    from: [S.AWAITING_SHIPPING, S.NEW_LEAD, S.FOLLOWING_UP],
    to: S.SHIPPING_EXPIRED,
    custody: CUSTODY.CUSTOMER,
    actors: [ACTOR.SYSTEM],
    methods: [RECEIVE_METHOD.MAIL_IN],
  },

  // Return and post-paid recovery -------------------------------------------
  // The whole branch below has no writer in production today, which is why a
  // customer whose deal collapses after their parcel arrived sees nothing.
  return_shipped: {
    from: [S.CANCELLED, S.NEGOTIATION, S.REVISED_OFFER, S.PARCEL_RECEIVED, S.QC_REVIEW],
    to: S.RETURNING_TO_CUSTOMER,
    custody: CUSTODY.CARRIER_RETURN,
    actors: [ACTOR.ADMIN_STAFF],
    requires: ["return_channel"],
  },
  return_delivered: {
    from: [S.RETURNING_TO_CUSTOMER],
    to: S.RETURN_CONFIRMED,
    custody: CUSTODY.RELEASED,
    actors: [ACTOR.ADMIN_STAFF, ACTOR.CUSTOMER],
  },
  dispute_opened: {
    from: [S.PAID, S.PENDING_QC, S.IN_STOCK, S.SOLD, S.COMPLETED],
    to: S.DISPUTED,
    custody: "=",
    actors: [ACTOR.ADMIN_MANAGER],
  },
  refund_initiated: {
    from: [S.DISPUTED],
    to: S.REFUND_INITIATED,
    custody: "=",
    actors: [ACTOR.FINANCE],
  },
  refund_completed: {
    from: [S.REFUND_INITIATED],
    to: S.REFUND_COMPLETED,
    custody: "=",
    actors: [ACTOR.FINANCE],
    stampsRefunded: true,
  },
};

// ── Decision ────────────────────────────────────────────────────────────────

/** A job has been paid for when paid_at is set. */
function jobIsPaid(job) {
  return Number.isFinite(Number(job && job.paid_at)) && Number(job.paid_at) > 0;
}

function reject(code, message) {
  return { ok: false, code, message };
}

/**
 * Decide whether `event` is legal on `job`, and what it changes.
 *
 * Pure: no database, no clock, no network. Returns either
 *   { ok: true, from, to, custody, stamps, clears, requires }
 * or
 *   { ok: false, code, message }
 *
 * `code` is a closed set so callers can map it to their own copy:
 *   unknown_event | unreadable_status | illegal_from | wrong_actor |
 *   wrong_receive_method | wrong_job_type | missing_field | already_paid
 */
function decideTransition({ job, event, actor }) {
  const rule = TRANSITIONS[event];
  if (!rule) return reject("unknown_event", `ไม่รู้จัก event: ${event}`);

  const receiveMethod = (job && job.receive_method) || null;
  const from = normalizeStatus(job && job.status, receiveMethod);
  if (!from) {
    return reject("unreadable_status", `อ่านสถานะปัจจุบันไม่ได้: ${JSON.stringify(job && job.status)}`);
  }

  if (rule.from && !rule.from.includes(from)) {
    return reject("illegal_from", `event ${event} ใช้กับสถานะ "${from}" ไม่ได้`);
  }
  if (!actorSatisfies(actor, rule.actors)) {
    return reject("wrong_actor", `${actor} ไม่มีสิทธิ์ยิง event ${event}`);
  }
  if (rule.methods && !rule.methods.includes(receiveMethod)) {
    return reject("wrong_receive_method", `event ${event} ใช้กับวิธีรับเครื่อง "${receiveMethod}" ไม่ได้`);
  }
  const jobType = (job && job.type) || null;
  if (rule.jobTypes && !rule.jobTypes.includes(jobType)) {
    return reject("wrong_job_type", `event ${event} ใช้กับงานชนิด "${jobType}" ไม่ได้`);
  }

  const paid = jobIsPaid(job);
  if (rule.blockedWhenPaid && paid) {
    return reject("already_paid", `event ${event} ทำไม่ได้เมื่อจ่ายเงินแล้ว`);
  }

  for (const field of rule.requires || []) {
    const value = job && job[field];
    if (value === undefined || value === null || value === "") {
      return reject("missing_field", `event ${event} ต้องมีฟิลด์ ${field}`);
    }
  }

  let custody = rule.custody;
  if (custody === CUSTODY_BY_METHOD) custody = custodyForMethod(receiveMethod);
  else if (custody === "=") custody = (job && job.custody) || null;

  return {
    ok: true,
    from,
    to: rule.to,
    custody,
    stamps: {
      paid: Boolean(rule.stampsPaid),
      refunded: Boolean(rule.stampsRefunded),
      withdrawn: Boolean(rule.stampsWithdrawn),
    },
    clears: rule.clears || [],
  };
}

/** Events legal on this job right now — for building UIs off the table. */
function availableEvents({ job, actor }) {
  return Object.keys(TRANSITIONS).filter((event) => decideTransition({ job, event, actor }).ok);
}

// ── Side-effect ownership ───────────────────────────────────────────────────
// Everything the system does *because* a status changed, and the event that
// will own it once the writers move (P2). Today each of these is keyed to a
// status VALUE inside a trigger, which is why renaming a status silently stops
// paying riders or stamping money — the failure mode this table exists to end.
//
// This is documentation with a test attached, not yet a dispatcher: the
// triggers still fire off status values. What it buys now is that P2 has a
// checklist, and the test below fails if the event named here stops agreeing
// with the transition table (e.g. someone moves the paid stamp).
const SIDE_EFFECT_OWNER = {
  // functions/index.js onJobHandedOverCalcRiderFee — fires on FEE_TRIGGER_STATUSES
  // ("Pending QC" plus two safety-net values). This is the rider getting paid.
  rider_fee_computed: "rider_return_arrived",
  // functions/index.js onAdminJobStatusNotify — auto-stamps paid_at when the
  // status enters PAID_STATUSES, because the mobile "จ่ายเงินแล้ว" button only
  // writes a status and the overdue scheduler needs an anchor.
  paid_at_stamped: "payment_confirmed",
  // src/utils/accessoryItems.ts unpackAccessoryItemsToStock — called from the
  // QC station and mobile ticket detail when a job reaches In Stock.
  accessories_unpacked: "intake_qc_passed",
  // functions/index.js finalizeCancelledJobs — the 7-day soft-close finaliser.
  soft_close_finalized: "finalized_lost",
};

module.exports = {
  ACTOR,
  JOB_TYPE,
  SIDE_EFFECT_OWNER,
  CUSTODY,
  TRANSITIONS,
  decideTransition,
  availableEvents,
  jobIsPaid,
};
