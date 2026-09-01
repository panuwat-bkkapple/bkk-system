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

const { JOB_STATUS, RECEIVE_METHOD, normalizeStatus } = require("./status-vocab.generated");

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

// ── Transition table ────────────────────────────────────────────────────────
// One row per event. `from` is the set of statuses the event is legal in;
// omitting it means "any status" (only used where the whole point is that the
// job can be anywhere, e.g. quarantine).
//
// This table describes the lifecycle as it runs TODAY, using canonical status
// values. The v2 additions that need an enum change (Awaiting Customer
// Decision, Quarantined, Return In Transit) are deliberately absent: the enum
// is a coordinated three-repo change and the readers have to move first.
const S = JOB_STATUS;

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
    methods: [RECEIVE_METHOD.PICKUP, RECEIVE_METHOD.STORE_IN],
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
  broadcast_to_riders: {
    from: [S.NEW_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET],
    to: S.ACTIVE_LEAD,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF],
    methods: [RECEIVE_METHOD.PICKUP],
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
  rider_departed: {
    from: [S.RIDER_ACCEPTED],
    to: S.RIDER_EN_ROUTE,
    custody: "=",
    actors: [ACTOR.RIDER],
  },
  rider_arrived: {
    from: [S.RIDER_EN_ROUTE],
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
  parcel_received: {
    from: [S.PARCEL_IN_TRANSIT],
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
  inspection_started: {
    from: [S.RIDER_ARRIVED, S.DROP_OFF_RECEIVED, S.PARCEL_RECEIVED, S.WAITING_DROP_OFF],
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
  offer_revised: {
    from: [S.QC_REVIEW, S.BEING_INSPECTED],
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

  // Phase 5: payout ----------------------------------------------------------
  payout_started: {
    from: [S.PRICE_ACCEPTED, S.QC_REVIEW, S.NEGOTIATION, S.REVISED_OFFER],
    to: S.PAYOUT_PROCESSING,
    custody: "=",
    actors: [ACTOR.ADMIN_STAFF, ACTOR.FINANCE],
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
  rider_return_arrived: {
    from: [S.RIDER_RETURNING],
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
  intake_qc_passed: {
    from: [S.PENDING_QC, S.QC_REVIEW, S.SENT_TO_QC_LAB],
    to: S.IN_STOCK,
    custody: CUSTODY.STORE,
    actors: [ACTOR.ADMIN_STAFF],
  },
  sent_to_lab: {
    from: [S.PENDING_QC, S.IN_STOCK],
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
  sold: {
    from: [S.READY_TO_SELL, S.IN_STOCK],
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
  cancelled: {
    from: [
      S.NEW_LEAD, S.ACTIVE_LEAD, S.FOLLOWING_UP, S.APPOINTMENT_SET,
      S.WAITING_DROP_OFF, S.AWAITING_SHIPPING,
      S.RIDER_ASSIGNED, S.RIDER_ACCEPTED, S.RIDER_EN_ROUTE, S.RIDER_ARRIVED,
      S.PARCEL_IN_TRANSIT, S.PARCEL_RECEIVED, S.DROP_OFF_RECEIVED,
      S.BEING_INSPECTED, S.QC_REVIEW, S.NEGOTIATION, S.REVISED_OFFER,
      S.PRICE_ACCEPTED,
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
 *   wrong_receive_method | missing_field | already_paid
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
  SIDE_EFFECT_OWNER,
  CUSTODY,
  TRANSITIONS,
  decideTransition,
  availableEvents,
  jobIsPaid,
};
