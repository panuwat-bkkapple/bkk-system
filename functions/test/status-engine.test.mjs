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

check("every rule names a destination inside the canonical enum", () => {
  const vocab = require(path.join(root, "functions/status-vocab.generated.js"));
  const canonical = new Set(Object.values(vocab.JOB_STATUS));
  const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
  for (const [event, rule] of Object.entries(TRANSITIONS)) {
    assert.ok(canonical.has(rule.to), `${event} targets a status outside the enum: ${rule.to}`);
    for (const s of rule.from || []) {
      assert.ok(canonical.has(s), `${event} accepts a status outside the enum: ${s}`);
    }
  }
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
