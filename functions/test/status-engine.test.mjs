// Transition engine — offline suite.
//
// The cases below are written from flows that exist in production and from the
// four bugs the cross-repo status survey found, not from the spec's happy path.
// A test written from the spec would have agreed with every one of those bugs:
// each of them was a rule everybody believed was already enforced.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { decideTransition, availableEvents, ACTOR, CUSTODY } = require(
  path.join(root, "functions/status-engine.js")
);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const job = (over = {}) => ({ status: "New Lead", receive_method: "Pickup", ...over });

function walk(start, steps) {
  let current = start;
  for (const [event, actor] of steps) {
    const out = decideTransition({ job: current, event, actor });
    assert.ok(out.ok, `${event} on "${current.status}" rejected: ${out.code} ${out.message || ""}`);
    current = {
      ...current,
      status: out.to,
      custody: out.custody,
      ...(out.stamps.paid ? { paid_at: 1_700_000_000_000 } : {}),
    };
  }
  return current;
}

console.log("status-engine");

// ── The flows that actually run ─────────────────────────────────────────────

check("pickup: broadcast → rider → inspection → payout → back at the store", () => {
  const end = walk(job({ status: "Active Lead" }), [
    ["rider_accepted", ACTOR.RIDER],
    ["rider_departed", ACTOR.RIDER],
    ["rider_arrived", ACTOR.RIDER],
    ["inspection_started", ACTOR.RIDER],
    ["inspection_submitted", ACTOR.RIDER],
    ["customer_accepted_price", ACTOR.CUSTOMER],
    ["payout_started", ACTOR.FINANCE],
    ["payment_confirmed", ACTOR.FINANCE],
    ["payment_handover_done", ACTOR.RIDER],
    ["rider_return_started", ACTOR.RIDER],
    ["rider_return_arrived", ACTOR.RIDER],
    ["intake_qc_passed", ACTOR.ADMIN_STAFF],
  ]);
  assert.equal(end.status, "In Stock");
  assert.equal(end.custody, CUSTODY.STORE);
});

check("mail-in: the leg that has no writer in production today", () => {
  // The customer types the tracking number in as part of the shipping event —
  // the engine requires the field rather than trusting the caller to have set it.
  const end = walk(job({ status: "New Lead", receive_method: "Mail-in", tracking_number: "TH123456789" }), [
    ["mailin_confirmed", ACTOR.ADMIN_STAFF],
    ["parcel_shipped", ACTOR.CUSTOMER],
    ["parcel_received", ACTOR.ADMIN_STAFF],
    ["inspection_started", ACTOR.ADMIN_STAFF],
    ["inspection_submitted", ACTOR.ADMIN_STAFF],
  ]);
  assert.equal(end.status, "QC Review");
});

check("store-in: drop-off through to the QC queue", () => {
  const end = walk(job({ status: "New Lead", receive_method: "Store-in" }), [
    ["dropoff_confirmed", ACTOR.ADMIN_STAFF],
    ["dropoff_received", ACTOR.ADMIN_STAFF],
    ["intake_queued_for_qc", ACTOR.ADMIN_STAFF],
  ]);
  assert.equal(end.status, "Pending QC");
  assert.equal(end.custody, CUSTODY.STORE);
});

// ── The four bugs the survey found, as regressions ──────────────────────────

// /api/jobs/action had no status guard on submit-tracking, so re-POSTing the
// endpoint moved a paid Mail-in job back to Parcel In Transit.
check("a re-posted tracking number cannot rewind a paid mail-in job", () => {
  const paid = job({ status: "Paid", receive_method: "Mail-in", paid_at: 1, tracking_number: "TH1" });
  const out = decideTransition({ job: paid, event: "parcel_shipped", actor: ACTOR.CUSTOMER });
  assert.equal(out.ok, false);
  assert.equal(out.code, "illegal_from");
});

check("but a customer may still correct a mistyped tracking number in flight", () => {
  const inFlight = job({ status: "Parcel In Transit", receive_method: "Mail-in", tracking_number: "TH2" });
  assert.equal(decideTransition({ job: inFlight, event: "parcel_shipped", actor: ACTOR.CUSTOMER }).ok, true);
});

// /api/cancel-order used a blocklist, so every status the list did not name —
// Negotiation, Sold, Rider Returning — was silently cancellable.
check("self-cancel is an allowlist: Sold and Rider Returning are not on it", () => {
  for (const status of ["Sold", "Rider Returning", "In Stock", "Completed"]) {
    const out = decideTransition({
      job: job({ status, paid_at: 1, cancel_category: "customer_changed_mind", cancelled_by: "customer", cancelled_at: 1 }),
      event: "cancelled",
      actor: ACTOR.CUSTOMER,
    });
    assert.equal(out.ok, false, `${status} should not be cancellable`);
  }
});

// The rider app's revised-offer cancel wrote cancel_reason only. Without
// cancelled_at the 7-day reopen window cannot be computed and the finaliser
// skips the job forever — it stays soft-cancelled and never closes.
check("cancelling without the taxonomy is rejected, not quietly accepted", () => {
  const bad = decideTransition({
    job: job({ status: "Rider Arrived", cancel_reason: "ลูกค้ายกเลิก" }),
    event: "cancelled",
    actor: ACTOR.RIDER,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "missing_field");

  const good = decideTransition({
    job: job({
      status: "Rider Arrived",
      cancel_category: "price_disagreement",
      cancelled_by: "customer",
      cancelled_at: 1_700_000_000_000,
    }),
    event: "cancelled",
    actor: ACTOR.RIDER,
  });
  assert.equal(good.ok, true);
  assert.equal(good.to, "Cancelled");
});

// Reaching the paid guard needs a status that IS legal for the event, so the
// from-list cannot reject it first — otherwise the paid rule is never asked and
// a test that removes it still passes. On a Pickup job "Pending QC" is exactly
// that status: it means the rider already paid the customer and handed the
// device over, while on a Mail-in job it means an unpaid device on our bench.
// /api/jobs/action carries a comment about this overload and guards it by
// scanning qc_logs; here paid_at answers it directly.
check("a paid job cannot re-accept a price, even from a status that allows it", () => {
  const unpaid = job({ status: "Pending QC" });
  assert.equal(decideTransition({ job: unpaid, event: "customer_accepted_price", actor: ACTOR.CUSTOMER }).ok, true);

  const paid = job({ status: "Pending QC", paid_at: 1_700_000_000_000 });
  const out = decideTransition({ job: paid, event: "customer_accepted_price", actor: ACTOR.CUSTOMER });
  assert.equal(out.ok, false);
  assert.equal(out.code, "already_paid");
});

// ── revised_offer_accepted ───────────────────────────────────────────────────
// เจ้าของงานเคาะ (1 ก.ย. 2569) ว่าการ์ด Revised Offer ของแอปไรเดอร์ต้องพาไป
// Payout Processing ตามพฤติกรรมวันนี้ ไม่ใช่ Price Accepted ตามที่ engine เคย
// เสนอ เทสชุดนี้ตรึงทั้ง "ไปถูกที่" และ "ไม่กว้างเกินที่ถาม"
check("ไรเดอร์กดยอมรับแทนลูกค้า: Revised Offer และ Negotiation ไป Payout Processing", () => {
  for (const status of ["Revised Offer", "Negotiation"]) {
    const out = decideTransition({
      job: job({ status }),
      event: "revised_offer_accepted",
      actor: ACTOR.RIDER,
    });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Payout Processing");
  }
});

check("revised_offer_accepted ไม่เปิดทางลัดจากสถานะอื่น", () => {
  // payout_started ยิงจาก QC Review กับ Price Accepted ได้ (แอดมิน/การเงิน)
  // event ใหม่ต้องไม่พาสิทธิ์นั้นติดมือไรเดอร์ไปด้วย
  for (const status of ["QC Review", "Price Accepted", "Being Inspected", "Pending QC"]) {
    const out = decideTransition({
      job: job({ status }),
      event: "revised_offer_accepted",
      actor: ACTOR.RIDER,
    });
    assert.equal(out.ok, false, `${status} ควรถูกปฏิเสธแต่ผ่าน`);
    assert.equal(out.code, "illegal_from");
  }
});

check("แอดมินดึงงานกลับเข้าคิวได้ทุกจุดที่ไรเดอร์ยังไม่ได้เริ่มตรวจ", () => {
  for (const status of ["Assigned", "Rider Accepted", "Rider En Route", "Rider Arrived"]) {
    const out = decideTransition({
      job: job({ status }),
      event: "rider_unassigned",
      actor: ACTOR.ADMIN_STAFF,
    });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Active Lead");
    assert.deepEqual(out.clears, ["rider_id", "assigned_at"]);
  }
});

check("unassign กับ withdraw ต้องไม่ไปจบที่เดียวกัน", () => {
  // ปลายทางคือสิ่งเดียวที่แยกสองเหตุการณ์นี้ออกจากกันในสายตาคนอ่านถัดไป:
  // Active Lead = กลับเข้าคิวแย่งงานทันที · Following Up = ต้องมีคนโทรหาลูกค้า
  // ก่อน เพราะมีไรเดอร์รับปากแล้วหายไป. ยุบให้เท่ากันเมื่อไหร่ ลูกค้าที่ถูก
  // ทิ้งกลางทางจะเงียบหายไปในคิวโดยไม่มีใครโทรไปบอก
  const unassign = decideTransition({
    job: job({ status: "Rider Accepted" }),
    event: "rider_unassigned",
    actor: ACTOR.ADMIN_STAFF,
  });
  const withdraw = decideTransition({
    job: job({ status: "Rider Accepted" }),
    event: "rider_withdrew",
    actor: ACTOR.RIDER,
  });
  assert.equal(unassign.to, "Active Lead");
  assert.equal(withdraw.to, "Following Up");
  assert.notEqual(unassign.to, withdraw.to);
});

check("unassign ไม่ประทับ withdrawn_* — ไม่งั้นแอดมินที่กดเองจะโดนเตือนว่าไรเดอร์ทิ้งงาน", () => {
  const out = decideTransition({
    job: job({ status: "Rider En Route" }),
    event: "rider_unassigned",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(out.ok, true);
  assert.equal(out.stamps.withdrawn, false);
});

check("ไรเดอร์ unassign ตัวเองไม่ได้ ต้องไปทาง rider_withdrew เท่านั้น", () => {
  // ถ้าเปิดให้ไรเดอร์ยิง unassign ได้ การทิ้งงานจะกลายเป็นทางที่ไม่ประทับ
  // withdrawn_* แล้วปุ่ม Re-broadcast กับแบนเนอร์เตือนจะไม่ขึ้นอีกเลย
  const out = decideTransition({
    job: job({ status: "Rider Accepted" }),
    event: "rider_unassigned",
    actor: ACTOR.RIDER,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_actor");
});

check("unassign ยิงหลังเริ่มตรวจแล้วไม่ได้ — เครื่องอยู่ในมือไรเดอร์", () => {
  for (const status of ["Being Inspected", "Pending QC", "Payout Processing"]) {
    const out = decideTransition({
      job: job({ status }),
      event: "rider_unassigned",
      actor: ACTOR.ADMIN_STAFF,
    });
    assert.equal(out.ok, false, `${status} ควรถูกปฏิเสธแต่ผ่าน`);
    assert.equal(out.code, "illegal_from");
  }
});

check("customer_accepted_price ยังพาไป Price Accepted เหมือนเดิม (ไม่แตะทางเว็บ)", () => {
  // ทางเว็บ (/api/jobs/action accept-price) ยังไม่ย้ายมา engine — ถ้าวันหนึ่ง
  // ปลายทางของ event นี้ถูกเปลี่ยนไปด้วยความเข้าใจผิดว่า "รวมให้เหมือนกัน"
  // พฤติกรรมของอีกช่องทางจะเปลี่ยนเงียบๆ เทสนี้คือหมุดกันเรื่องนั้น
  const out = decideTransition({
    job: job({ status: "Revised Offer" }),
    event: "customer_accepted_price",
    actor: ACTOR.CUSTOMER,
  });
  assert.equal(out.ok, true);
  assert.equal(out.to, "Price Accepted");
});

check("จ่ายเงินแล้วรับข้อเสนอใหม่ไม่ได้", () => {
  const out = decideTransition({
    job: job({ status: "Revised Offer", paid_at: 1_700_000_000_000 }),
    event: "revised_offer_accepted",
    actor: ACTOR.RIDER,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "already_paid");
});

check("การเงินไม่ใช่คนกดแทนลูกค้าหน้างาน", () => {
  const out = decideTransition({
    job: job({ status: "Revised Offer" }),
    event: "revised_offer_accepted",
    actor: ACTOR.FINANCE,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_actor");
});

check("a paid job cannot be reverted back into inspection", () => {
  const paid = job({ status: "QC Review", paid_at: 1_700_000_000_000 });
  assert.equal(decideTransition({ job: paid, event: "inspection_reverted", actor: ACTOR.RIDER }).code, "already_paid");
});

// Written from what production actually holds: paid_at is auto-stamped only on
// entry to PAID_STATUSES ("Paid", "PAID", "Payment Completed"), and
// 'Waiting For Handover' is not one of them — the 21 live jobs at that status
// carry no timestamp. A money check on this transition would strand every one
// of their riders at the customer's door. The from-list is the guard: both
// statuses already mean the transfer happened.
check("the return leg works on the rows the legacy writer actually created", () => {
  for (const status of ["Waiting For Handover", "Waiting for Handover", "Paid"]) {
    const out = decideTransition({ job: job({ status }), event: "rider_return_started", actor: ACTOR.RIDER });
    assert.equal(out.ok, true, `${status} rejected: ${out.code}`);
    assert.equal(out.to, "Rider Returning");
  }
});

check("but the return leg still refuses a status where nothing was transferred", () => {
  const out = decideTransition({ job: job({ status: "QC Review" }), event: "rider_return_started", actor: ACTOR.RIDER });
  assert.equal(out.ok, false);
  assert.equal(out.code, "illegal_from");
});

// updateStatus() in the rider app never read the current status, so any button
// rendered off a stale list could write any status over any other.
check("no jumping the queue: a rider cannot pay a job they just accepted", () => {
  const out = decideTransition({
    job: job({ status: "Rider Accepted" }),
    event: "payment_confirmed",
    actor: ACTOR.RIDER,
  });
  assert.equal(out.ok, false);
});

// ── The ambiguity that forced qc_logs scanning ──────────────────────────────

check("custody answers what status could not: same status, two holders", () => {
  // Being Inspected on a Pickup means the rider is at the door and the device
  // is still the customer's; on a Mail-in it is already on our bench.
  const pickup = decideTransition({
    job: job({ status: "Rider Arrived" }),
    event: "inspection_started",
    actor: ACTOR.RIDER,
  });
  const mailIn = decideTransition({
    job: job({ status: "Parcel Received", receive_method: "Mail-in" }),
    event: "inspection_started",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(pickup.custody, CUSTODY.CUSTOMER);
  assert.equal(mailIn.custody, CUSTODY.STORE);
  assert.equal(pickup.to, mailIn.to);
});

check("paid_at is stamped by exactly one event", () => {
  const out = decideTransition({
    job: job({ status: "Payout Processing" }),
    event: "payment_confirmed",
    actor: ACTOR.FINANCE,
  });
  assert.equal(out.stamps.paid, true);
  // Nothing else in the table claims to stamp it.
  const others = ["payout_started", "payment_handover_done", "rider_return_arrived", "intake_qc_passed"];
  for (const event of others) {
    const rule = decideTransition({ job: job({ status: "Waiting For Handover", paid_at: 1 }), event, actor: ACTOR.ADMIN_STAFF });
    if (rule.ok) assert.equal(rule.stamps.paid, false, `${event} must not stamp paid_at`);
  }
});

// ── Legacy data keeps working ───────────────────────────────────────────────

// 'In-Transit' means two opposite things: a paid device riding back to the
// store (Pickup) and an unpaid customer parcel heading to us (everything else).
check("the In-Transit overload resolves by receive method", () => {
  const pickup = decideTransition({
    job: { status: "In-Transit", receive_method: "Pickup", paid_at: 1 },
    event: "rider_return_arrived",
    actor: ACTOR.RIDER,
  });
  assert.equal(pickup.ok, true, `pickup leg rejected: ${pickup.code}`);
  assert.equal(pickup.to, "Pending QC");

  const mailIn = decideTransition({
    job: { status: "In-Transit", receive_method: "Mail-in" },
    event: "parcel_received",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(mailIn.ok, true, `mail-in leg rejected: ${mailIn.code}`);
  assert.equal(mailIn.to, "Parcel Received");
});

check("legacy spellings that live rows carry are accepted", () => {
  // 92 live rows carry 'Sent to QC Lab'; 21 carry 'Waiting for Handover'.
  const lab = decideTransition({
    job: job({ status: "Sent to QC Lab" }),
    event: "intake_qc_passed",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(lab.ok, true, `legacy lab spelling rejected: ${lab.code}`);
  const handover = decideTransition({
    job: job({ status: "Waiting for Handover", paid_at: 1 }),
    event: "payment_handover_done",
    actor: ACTOR.RIDER,
  });
  assert.equal(handover.ok, true, `legacy handover spelling rejected: ${handover.code}`);
});

check("an unreadable status is refused rather than guessed at", () => {
  const out = decideTransition({ job: job({ status: "Totally Made Up" }), event: "case_claimed", actor: ACTOR.ADMIN_STAFF });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unreadable_status");
});

// ── Role gating (the job pages have none today) ─────────────────────────────

check("declaring a parcel lost is manager-only; staff cannot", () => {
  const j = job({ status: "Investigating Carrier", receive_method: "Mail-in" });
  assert.equal(decideTransition({ job: j, event: "parcel_declared_lost", actor: ACTOR.ADMIN_STAFF }).code, "wrong_actor");
  assert.equal(decideTransition({ job: j, event: "parcel_declared_lost", actor: ACTOR.ADMIN_MANAGER }).ok, true);
});

check("a manager inherits staff powers; a rider does not", () => {
  const j = job({ status: "New Lead" });
  assert.equal(decideTransition({ job: j, event: "case_claimed", actor: ACTOR.ADMIN_MANAGER }).ok, true);
  assert.equal(decideTransition({ job: j, event: "case_claimed", actor: ACTOR.RIDER }).code, "wrong_actor");
});

check("receive method gates the events that only make sense for one", () => {
  const storeIn = job({ status: "New Lead", receive_method: "Store-in" });
  assert.equal(decideTransition({ job: storeIn, event: "broadcast_to_riders", actor: ACTOR.ADMIN_STAFF }).code, "wrong_receive_method");
  assert.equal(decideTransition({ job: storeIn, event: "dropoff_confirmed", actor: ACTOR.ADMIN_STAFF }).ok, true);
});

// ── Shape guarantees the callers rely on ────────────────────────────────────

check("availableEvents is derived from the same table, not a second list", () => {
  const events = availableEvents({ job: job({ status: "Rider Accepted" }), actor: ACTOR.RIDER });
  assert.ok(events.includes("rider_departed"));
  assert.ok(!events.includes("payment_confirmed"));
});

check("แอดมินกด Mark Arrived แทนไรเดอร์ที่ลืมกดได้ทุกจุดของขา logistics", () => {
  // เคสจริง: ไรเดอร์ลืมกด "ออกเดินทาง"/"รับงาน" แล้วไปถึงบ้านลูกค้า แอดมินแก้ให้
  // จากหน้าจอ ปิดทางนี้ = งานเดินต่อไม่ได้เลยและไม่มีที่ไหนแก้ได้
  for (const status of ["Rider Assigned", "Rider Accepted", "Rider En Route"]) {
    const out = decideTransition({ job: job({ status }), event: "rider_arrived", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Rider Arrived");
  }
});

check("อนุมัติจ่ายเงินได้จาก Being Inspected — สาย Store-in/Mail-in ไม่มีขั้น QC Review คั่น", () => {
  for (const status of ["Being Inspected", "Pending QC", "QC Review", "Discrepancy Reported"]) {
    const out = decideTransition({ job: job({ status }), event: "payout_started", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Payout Processing");
  }
});

check("แอดมินยืนยันรับมอบแทนไรเดอร์ที่ไม่ได้กดเดินทางกลับ", () => {
  // ขั้นนี้เป็นตัวที่ทำให้ onJobHandedOverCalcRiderFee คำนวณค่าวิ่ง — ปิดทางนี้
  // = ไรเดอร์ไม่ได้ค่ารอบเพราะลืมกดปุ่มเดียว
  for (const status of ["Paid", "Waiting For Handover", "Rider Returning"]) {
    const out = decideTransition({ job: job({ status }), event: "rider_return_arrived", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Pending QC");
  }
});

check("re-broadcast งานที่อยู่ในคิวอยู่แล้วได้ และงานที่เปลี่ยนวิธีรับมาเป็น Pickup ก็ได้", () => {
  for (const status of ["Active Lead", "Waiting Drop-off", "Awaiting Shipping"]) {
    const out = decideTransition({ job: job({ status }), event: "broadcast_to_riders", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Active Lead");
  }
});

check("การขยายไม่ได้เปิดให้ถอยเครื่องที่ขายแล้วกลับเข้าแล็บ", () => {
  // ปุ่ม Send to QC LAB ไปถึงสถานะพวกนี้ได้จริงวันนี้ (hasBeenPaid ครอบสถานะขาย
  // จบไปด้วย) แต่เป็นเงื่อนไขปุ่มที่หลวม ไม่ใช่ฟีเจอร์ — from-list จึงไม่รับ
  for (const status of ["Sold", "Completed", "Ready To Sell"]) {
    const out = decideTransition({ job: job({ status }), event: "sent_to_lab", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, false, `${status} ควรถูกปฏิเสธแต่ผ่าน`);
    assert.equal(out.code, "illegal_from");
  }
});

check("การขยายไม่ได้ทำให้ไรเดอร์ได้สิทธิ์ของแอดมินติดมือไปด้วย", () => {
  // from-list กว้างขึ้นแต่ actors ต้องไม่ขยับ — ไรเดอร์ต้องยังอนุมัติจ่ายเงิน
  // และ re-broadcast ไม่ได้
  for (const event of ["payout_started", "broadcast_to_riders", "sent_to_lab"]) {
    const out = decideTransition({ job: job({ status: "Pending QC" }), event, actor: ACTOR.RIDER });
    assert.equal(out.ok, false, `${event} ควรปฏิเสธไรเดอร์แต่ผ่าน`);
  }
});

check("การขยายไม่ได้พาสิทธิ์จ่ายเงินย้อนเข้าไปในงานที่จ่ายแล้ว", () => {
  // payout_started รับจาก Pending QC ได้แล้ว และ Pending QC เป็นสถานะ "หลังจ่าย"
  // ของสาย Pickup — งานที่มี paid_at ต้องไม่ถูกส่งเข้ารอบจ่ายเงินซ้ำ
  const out = decideTransition({
    job: job({ status: "Pending QC", paid_at: 1_700_000_000_000 }),
    event: "payout_started",
    actor: ACTOR.FINANCE,
  });
  assert.equal(out.ok, false, "งานที่จ่ายเงินแล้วต้องถูกปฏิเสธ");
});

check("ทางลัดจ่ายเงินของมือถือแคบกว่าที่ไคลเอนต์เคยทำเอง", () => {
  // วันนี้ไคลเอนต์เขียน 'Paid' ทับสถานะอะไรก็ได้ที่ปุ่ม render — ผ่าน engine
  // แล้วรับเฉพาะ Payout Processing **การย้ายนี้รัดเข้า ไม่ได้เปิดออก**
  const ok = decideTransition({
    job: job({ status: "Payout Processing" }),
    event: "admin_marked_paid",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(ok.ok, true, ok.code);
  assert.equal(ok.to, "Paid");
  // **ต้องไม่ประทับ paid_at** — registry ให้สิทธิ์นั้นกับ payment_confirmed
  // ตัวเดียว ทางนี้ปล่อยให้ trigger onJobStatusChanged ประทับเหมือนวันนี้
  assert.equal(ok.stamps.paid, false, "ห้ามเป็นประตูที่สองไปหา paid_at");

  for (const status of ["Being Inspected", "QC Review", "Rider Arrived", "New Lead"]) {
    const out = decideTransition({ job: job({ status }), event: "admin_marked_paid", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, false, `${status} ควรถูกปฏิเสธแต่ผ่าน`);
    assert.equal(out.code, "illegal_from");
  }
});

check("ไรเดอร์กดจ่ายเงินแทนไม่ได้", () => {
  const out = decideTransition({
    job: job({ status: "Payout Processing" }),
    event: "admin_marked_paid",
    actor: ACTOR.RIDER,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_actor");
});

check("จ่ายซ้ำไม่ได้ — ตกที่ from-list ไม่ใช่ผ่านแล้วเขียนทับ", () => {
  // เมื่ออยู่ Paid แล้วยิงซ้ำต้องถูกปฏิเสธ ไม่ใช่ผ่านแล้วไปเขียนอะไรใหม่
  const again = decideTransition({
    job: job({ status: "Paid", paid_at: 1_700_000_000_000 }),
    event: "admin_marked_paid",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(again.ok, false);
});

check("เริ่มดำเนินการของ Store-in/Mail-in ไม่ใช่ event เดียวกับ broadcast", () => {
  // ปลายทางเดียวกันแต่ความหมายต่างกัน — broadcast แปลว่าไรเดอร์เห็นงานได้แล้ว
  // ซึ่งไม่จริงสำหรับสองวิธีนี้ (useRiderData กรอง non-Pickup ทิ้งก่อนดูสถานะ)
  for (const method of ["Store-in", "Mail-in"]) {
    const out = decideTransition({
      job: job({ status: "Appointment Set", receive_method: method }),
      event: "processing_started",
      actor: ACTOR.ADMIN_STAFF,
    });
    assert.equal(out.ok, true, `${method} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Active Lead");
  }
});

check("Pickup ต้องใช้ broadcast ไม่ใช่ processing_started", () => {
  // ถ้าเปิดให้ Pickup ยิงตัวนี้ได้ งานจะเข้าคิวไรเดอร์โดยที่ trail บอกว่า
  // "เริ่มดำเนินการ" ไม่ใช่ "ส่งให้ไรเดอร์" ซึ่งอ่านย้อนหลังแล้วผิด
  const out = decideTransition({
    job: job({ status: "Appointment Set", receive_method: "Pickup" }),
    event: "processing_started",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_receive_method");
});

check("แอดมินกดออกเดินทางแทนไรเดอร์ที่ลืมกดได้", () => {
  for (const status of ["Rider Accepted", "Rider Assigned", "Active Lead"]) {
    const out = decideTransition({ job: job({ status }), event: "rider_departed", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Rider En Route");
  }
});

check("ถอนงานออกจากคิวแย่งงานกลับไปขาขาย — คนละทางกับ rider_unassigned", () => {
  // สองตัวนี้วิ่งสวนทางกัน ยุบรวมเมื่อไหร่ qc_logs จะเล่าเรื่องกลับหัว
  const recall = decideTransition({ job: job({ status: "Active Lead" }), event: "broadcast_recalled", actor: ACTOR.ADMIN_STAFF });
  assert.equal(recall.ok, true, recall.code);
  assert.equal(recall.to, "Following Up");

  const unassign = decideTransition({ job: job({ status: "Rider Accepted" }), event: "rider_unassigned", actor: ACTOR.ADMIN_STAFF });
  assert.equal(unassign.to, "Active Lead");
  assert.notEqual(recall.to, unassign.to);
});

check("broadcast_recalled ยิงได้เฉพาะจากคิว ไม่ใช่จากงานที่ไรเดอร์ถืออยู่", () => {
  // ถ้ายิงจาก Rider Accepted ได้ มันจะกลายเป็นทางถอนงานที่ไม่ล้าง rider_id
  // แล้วงานจะไปอยู่ Following Up โดยยังมีเจ้าของค้างอยู่
  for (const status of ["Rider Accepted", "Rider En Route", "New Lead"]) {
    const out = decideTransition({ job: job({ status }), event: "broadcast_recalled", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, false, `${status} ควรถูกปฏิเสธแต่ผ่าน`);
    assert.equal(out.code, "illegal_from");
  }
});

check("ย้อนสถานะที่กดผิดจากปลายทางขายกลับมา Pending QC ได้ทั้งสี่จุด", () => {
  for (const status of ["Sold", "In Stock", "Ready To Sell", "Sent To QC Lab"]) {
    const out = decideTransition({ job: job({ status }), event: "sale_reverted_to_qc", actor: ACTOR.ADMIN_STAFF });
    assert.equal(out.ok, true, `${status} ถูกปฏิเสธ: ${out.code}`);
    assert.equal(out.to, "Pending QC");
  }
});

check("การย้อนกลับไม่พาไปเข้าคิวจ่ายเงินอีกรอบ", () => {
  // งานที่ย้อนกลับมาจ่ายเงินไปแล้วทุกใบ — ด่านที่กันการจ่ายซ้ำอยู่ที่ปลายทาง
  // อีกฝั่ง ไม่ใช่ที่ตัวย้อน. เทสนี้พิสูจน์ว่าด่านนั้นยังทำงานหลังย้อนแล้ว
  const out = decideTransition({
    job: job({ status: "Pending QC", paid_at: 1_700_000_000_000 }),
    event: "payout_started",
    actor: ACTOR.ADMIN_STAFF,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "already_paid");
});

check("ไรเดอร์ย้อนสถานะการขายหรือถอนงานจากคิวไม่ได้", () => {
  for (const event of ["broadcast_recalled", "sale_reverted_to_qc"]) {
    const status = event === "broadcast_recalled" ? "Active Lead" : "Sold";
    const out = decideTransition({ job: job({ status }), event, actor: ACTOR.RIDER });
    assert.equal(out.ok, false, `${event} ควรปฏิเสธไรเดอร์แต่ผ่าน`);
    assert.equal(out.code, "wrong_actor");
  }
});

check("นัดหมายได้ทุกวิธีรับ รวม Mail-in", () => {
  for (const method of ["Pickup", "Store-in", "Mail-in"]) {
    const out = decideTransition({
      job: job({ status: "New Lead", receive_method: method }),
      event: "appointment_set",
      actor: ACTOR.ADMIN_STAFF,
    });
    assert.equal(out.ok, true, `${method} ถูกปฏิเสธ: ${out.code}`);
  }
});

check("from-list ของ event ที่ปุ่มแอดมินเรียก ถูกตรึงไว้ — ขยายต้องตั้งใจ", () => {
  // ค่าชุดนี้ถูกขยายรอบหนึ่งแล้ว (P2-i) ให้ตรงกับสถานะที่ปุ่มบน PricingSidebar
  // ไปถึงได้จริง — เจ้าของงานเคาะว่าคงพฤติกรรมเดิมไว้ ไม่ให้ปุ่มแอดมินพัง
  //
  // เทสนี้ไม่ได้บอกว่าค่าพวกนี้ถูกในเชิงธุรกิจ — มันบอกว่าถ้าใครขยายอีก ต้อง
  // ขยายที่นี่ด้วย และจะมองเห็นใน diff แทนที่จะไหลเข้ามาพร้อมการย้ายปุ่มสักตัว
  // (ตัวที่ยังรู้ว่าหลวมคือ inspection_started จาก Rider Assigned/Accepted และ
  // payout_started จาก Being Inspected — ทางแก้คือรัดเงื่อนไข *ปุ่ม* ไม่ใช่
  // หด from-list ซึ่งจะทำให้ปุ่มพังโดยไม่มีใครแก้ปุ่ม)
  const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
  const pinned = {
    intake_queued_for_qc: ["Parcel Received", "Drop-off Received", "Parcel In Transit"],
    dropoff_received: ["Waiting Drop-off", "Appointment Set", "New Lead", "Following Up"],
    inspection_started: [
      "Rider Arrived", "Drop-off Received", "Parcel Received", "Waiting Drop-off",
      "Appointment Set", "Rider Assigned", "Rider Accepted", "Rider En Route",
      "Awaiting Shipping", "Parcel In Transit", "Active Lead",
    ],
    broadcast_to_riders: [
      "New Lead", "Following Up", "Appointment Set",
      "Active Lead", "Waiting Drop-off", "Awaiting Shipping",
    ],
    rider_arrived: ["Rider En Route", "Rider Assigned", "Rider Accepted"],
    payout_started: [
      "Price Accepted", "QC Review", "Negotiation", "Revised Offer",
      "Being Inspected", "Pending QC", "Discrepancy Reported",
    ],
    rider_return_arrived: ["Rider Returning", "Paid", "Waiting For Handover"],
    sent_to_lab: ["Pending QC", "In Stock", "Paid", "Waiting For Handover", "Rider Returning"],
    // P2-j — ปุ่มบน MobileTicketDetail
    rider_departed: ["Rider Accepted", "Rider Assigned", "Active Lead"],
    parcel_received: [
      "Parcel In Transit", "Appointment Set", "Waiting Drop-off",
      "Awaiting Shipping", "Active Lead", "Rider En Route",
    ],
    offer_revised: ["QC Review", "Being Inspected", "Pending QC"],
    intake_qc_passed: [
      "Pending QC", "QC Review", "Sent To QC Lab",
      "Paid", "Waiting For Handover", "Rider Returning",
    ],
    sold: ["Ready To Sell", "In Stock", "Pending QC"],
    broadcast_recalled: ["Active Lead"],
    admin_marked_paid: ["Payout Processing"],
    processing_started: ["Appointment Set", "Waiting Drop-off", "Awaiting Shipping"],
    sale_reverted_to_qc: ["Sold", "In Stock", "Ready To Sell", "Sent To QC Lab"],
  };
  for (const [event, from] of Object.entries(pinned)) {
    assert.deepEqual(TRANSITIONS[event].from, from, `from-list ของ ${event} เปลี่ยน`);
  }
});

check("every rule names a destination inside the canonical enum", () => {
  // "Canonical" is BOTH lines: JOB_STATUS is retail, JOB_STATUS_B2B is
  // corporate bulk. Widened when the corporate rows landed (P3-b) — this
  // check went red on them, correctly, because it only knew the retail enum.
  const vocab = require(path.join(root, "functions/status-vocab.generated.js"));
  const canonical = new Set([
    ...Object.values(vocab.JOB_STATUS),
    ...Object.values(vocab.JOB_STATUS_B2B),
  ]);
  const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
  for (const [event, rule] of Object.entries(TRANSITIONS)) {
    assert.ok(canonical.has(rule.to), `${event} targets a status outside the enum: ${rule.to}`);
    for (const s of rule.from || []) {
      assert.ok(canonical.has(s), `${event} accepts a status outside the enum: ${s}`);
    }
  }
});

check("no rule can drop a job onto the corporate line without scoping to it", () => {
  // The widening above would, on its own, be a pure relaxation: every retail
  // row could now name a B2B status and nothing would object. This is the
  // rule that replaces what was lost. Destinations are the half that matters —
  // an event whose `to` is a corporate status is how a retail ticket would
  // become a corporate lot, and `jobTypes` is what stops it.
  //
  // Shared destinations (Cancelled, Following Up, Negotiation, Paid,
  // Completed) are deliberately NOT covered: those events belong to both
  // lines, which is why `cancelled` carries corporate statuses in its
  // from-list and no jobTypes.
  const vocab = require(path.join(root, "functions/status-vocab.generated.js"));
  const b2bOnly = new Set(Object.values(vocab.JOB_STATUS_B2B));
  const { TRANSITIONS, B2B_JOB_TYPES } = require(path.join(root, "functions/status-engine.js"));
  for (const [event, rule] of Object.entries(TRANSITIONS)) {
    if (!b2bOnly.has(rule.to)) continue;
    assert.deepEqual(
      rule.jobTypes,
      B2B_JOB_TYPES,
      `${event} lands on the corporate status "${rule.to}" but is legal on any job type`
    );
  }
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
