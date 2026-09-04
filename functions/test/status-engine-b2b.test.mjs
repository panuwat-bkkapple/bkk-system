// Transition engine — corporate bulk (B2B) line, offline suite.
//
// Written from the buttons that exist today, not from a spec: every `from`
// asserted below is a status one of the three B2B screens can actually be
// sitting on when the operator presses that button (B2BManager's action
// panel, B2BDispatchQueue's two job lists, B2BAuditorTool's job filter).
//
// INJECTION RESULTS (see CLAUDE.md — a guard nobody proved is a guard nobody
// knows is empty). Each of these was applied alone and the suite went red:
//   1. drop `jobTypes` from b2b_unpacked_to_stock  -> "retail job at Paid"
//   2. drop the jobTypes check in decideTransition -> same, plus the untyped case
//   3. add `methods: [RECEIVE_METHOD.PICKUP]` to a B2B row -> whole chain dies
//   4. put SITE_VISIT_GRADING into b2b_grading_started's from-list -> no-op test
//   5. point b2b_final_quote_sent's from at SITE_VISIT_GRADING only -> Auditor
//      Assigned rows can no longer move forward
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { decideTransition, TRANSITIONS, ACTOR, JOB_TYPE, B2B_JOB_TYPES } = require(
  path.join(root, "functions/status-engine.js")
);
const { normalizeStatus, JOB_STATUS_B2B } = require(
  path.join(root, "functions/status-vocab.generated.js")
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

// A corporate deal as B2BDispatchQueue creates it: no receive_method at all.
const lot = (status, over = {}) => ({ status, type: "B2B Trade-in", ...over });
const admin = ACTOR.ADMIN_STAFF;

function walk(start, steps) {
  let current = start;
  for (const [event, actor] of steps) {
    const out = decideTransition({ job: current, event, actor });
    assert.ok(out.ok, `${event} on "${current.status}" rejected: ${out.code} ${out.message || ""}`);
    current = { ...current, status: out.to, custody: out.custody };
  }
  return current;
}

console.log("status-engine-b2b");

// ── The flow that actually runs ─────────────────────────────────────────────

check("the whole corporate line, from web lead to lot closed", () => {
  const end = walk(lot("New B2B Lead"), [
    ["b2b_pre_quote_sent", admin],
    ["b2b_pre_quote_accepted", admin],
    ["b2b_auditor_dispatched", admin],
    ["b2b_final_quote_sent", admin],
    ["b2b_final_quote_accepted", admin],
    ["b2b_po_issued", admin],
    ["b2b_invoice_requested", admin],
    ["b2b_submitted_to_finance", admin],
  ]);
  assert.equal(end.status, "Pending Finance Approval");
});

check("a deal created from the corporate web form walks the same line", () => {
  // functions/src/index.ts writes receive_method "Corporate Pickup" — a value
  // RECEIVE_METHOD does not contain. It must not affect anything.
  const end = walk(lot("New B2B Lead", { receive_method: "Corporate Pickup" }), [
    ["b2b_pre_quote_sent", admin],
    ["b2b_pre_quote_accepted", admin],
    ["b2b_auditor_dispatched", admin],
  ]);
  assert.equal(end.status, "Site Visit & Grading");
});

check("the admin phoned the lead: New B2B Lead -> Following Up, then quotes", () => {
  const end = walk(lot("New B2B Lead"), [
    ["b2b_followed_up", admin],
    ["b2b_pre_quote_sent", admin],
  ]);
  assert.equal(end.status, "Pre-Quote Sent");
});

check("negotiation loop: quote -> negotiate -> agreed", () => {
  const end = walk(lot("Final Quote Sent"), [
    ["b2b_negotiation_opened", admin],
    ["b2b_final_quote_accepted", admin],
  ]);
  assert.equal(end.status, "Final Quote Accepted");
});

check("the legacy 'Payment Completed' row unpacks — that is the only spelling finance writes", () => {
  // payoutTransfer writes "Payment Completed" for the B2B branch; the engine
  // reads it as Paid. If the alias ever went away this closes the whole line.
  assert.equal(normalizeStatus("Payment Completed"), "Paid");
  const out = decideTransition({
    job: lot("Payment Completed"),
    event: "b2b_unpacked_to_stock",
    actor: admin,
  });
  assert.ok(out.ok, out.code);
  assert.equal(out.to, "Completed");
});

// ── The guard the shared statuses make necessary ────────────────────────────

check("a retail job that was just paid cannot be unpacked as a corporate lot", () => {
  const out = decideTransition({
    job: { status: "Paid", type: "Trade-in", receive_method: "Pickup" },
    event: "b2b_unpacked_to_stock",
    actor: admin,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_job_type");
});

check("...and neither can a legacy retail job that carries no type at all", () => {
  const out = decideTransition({
    job: { status: "Paid", receive_method: "Pickup" },
    event: "b2b_unpacked_to_stock",
    actor: admin,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_job_type");
});

check("a retail job at Following Up cannot be pushed into the corporate line", () => {
  const out = decideTransition({
    job: { status: "Following Up", receive_method: "Pickup" },
    event: "b2b_pre_quote_sent",
    actor: admin,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "wrong_job_type");
});

check("the type axis costs the retail line nothing — an untyped job still runs", () => {
  // The whole reason jobTypes is opt-in per row: production retail rows
  // predate the field. If any retail row started requiring one, this dies.
  const end = walk({ status: "Active Lead", receive_method: "Pickup" }, [
    ["rider_accepted", ACTOR.RIDER],
    ["rider_departed", ACTOR.RIDER],
    ["rider_arrived", ACTOR.RIDER],
  ]);
  assert.equal(end.status, "Rider Arrived");
});

// ── The auditor tool's own window ───────────────────────────────────────────

check("the auditor can start grading a lot that already has a PO", () => {
  // B2BAuditorTool locks only six statuses; PO Issued is not one of them, so
  // a late correction on the floor is legal today and stays legal.
  const out = decideTransition({ job: lot("PO Issued"), event: "b2b_grading_started", actor: admin });
  assert.ok(out.ok, out.code);
  assert.equal(out.to, "Site Visit & Grading");
});

check("grading does not re-fire on a lot already being graded", () => {
  // The tool skips the status write there on purpose; a no-op transition would
  // write a status_history row that says nothing happened.
  for (const status of ["Site Visit & Grading", "Auditor Assigned"]) {
    const out = decideTransition({ job: lot(status), event: "b2b_grading_started", actor: admin });
    assert.equal(out.ok, false, `${status} should not accept b2b_grading_started`);
    assert.equal(out.code, "illegal_from");
  }
});

check("grading is closed once the lot is with finance", () => {
  for (const status of ["Pending Finance Approval", "Payment Completed", "Completed"]) {
    const out = decideTransition({ job: lot(status), event: "b2b_grading_started", actor: admin });
    assert.equal(out.ok, false, `${status} should be locked`);
  }
});

check("'Auditor Assigned' still moves forward even though nothing writes it", () => {
  const out = decideTransition({ job: lot("Auditor Assigned"), event: "b2b_final_quote_sent", actor: admin });
  assert.ok(out.ok, out.code);
});

// ── Cancellation ────────────────────────────────────────────────────────────

check("a corporate deal can be cancelled after the PO, not just at the quote", () => {
  const out = decideTransition({
    job: lot("PO Issued", {
      cancel_category: "customer_changed_mind",
      cancelled_by: "admin",
      cancelled_at: 1_700_000_000_000,
    }),
    event: "cancelled",
    actor: admin,
  });
  assert.ok(out.ok, out.code);
  assert.equal(out.to, "Cancelled");
});

const cancelFields = {
  cancel_category: "other",
  cancelled_by: "admin",
  cancelled_at: 1_700_000_000_000,
};

check("a paid corporate deal cannot be cancelled — that is a dispute", () => {
  // Rejected by the from-list, NOT by blockedWhenPaid: decideTransition checks
  // `from` before it looks at the money. Asserting the code and not just the
  // rejection is the point — a test that only asserted `ok === false` would
  // stay green if Paid were added to the from-list and blockedWhenPaid were
  // removed in the same edit.
  const out = decideTransition({
    job: lot("Payment Completed", { paid_at: 1_700_000_000_000, ...cancelFields }),
    event: "cancelled",
    actor: admin,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "illegal_from");
});

check("blockedWhenPaid is the second net: a lot inside the from-list with money out", () => {
  // Pending Finance Approval IS cancellable (it is in the widened list), so
  // this one reaches the paid check — which is where payoutTransfer having
  // stamped paid_at without the status landing yet gets caught.
  const out = decideTransition({
    job: lot("Pending Finance Approval", { paid_at: 1_700_000_000_000, ...cancelFields }),
    event: "cancelled",
    actor: admin,
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "already_paid");
});

// ── Structural pins ─────────────────────────────────────────────────────────

const b2bEvents = Object.keys(TRANSITIONS).filter((e) => e.startsWith("b2b_"));

check("the short 'B2B' spelling the workspace accepts is a corporate lot too", () => {
  // B2CWorkspacePage.isB2B opens this screen for type "B2B" as well. If the
  // engine only knew "B2B Trade-in", every button on such a row would answer
  // wrong_job_type — a screen full of dead buttons and no way to tell why.
  const out = decideTransition({
    job: { status: "New B2B Lead", type: "B2B" },
    event: "b2b_pre_quote_sent",
    actor: admin,
  });
  assert.ok(out.ok, out.code);
});

check("every b2b_ row carries jobTypes and no methods", () => {
  assert.ok(b2bEvents.length >= 12, `expected the whole line, got ${b2bEvents.length}`);
  for (const event of b2bEvents) {
    const rule = TRANSITIONS[event];
    assert.deepEqual(rule.jobTypes, B2B_JOB_TYPES, `${event} must be scoped to the corporate line`);
    assert.equal(rule.methods, undefined, `${event} must not filter by receive_method — B2B lots carry none`);
  }
});

check("every destination on the corporate line is a status the engine can read back", () => {
  // The failure this pins: before the enum change, normalizeStatus returned
  // null for every B2B value, so the engine answered unreadable_status before
  // it ever looked at a from-list.
  for (const event of b2bEvents) {
    const to = TRANSITIONS[event].to;
    assert.equal(normalizeStatus(to), to, `${event} lands on an unreadable status: ${to}`);
  }
});

check("JOB_TYPE.B2B is the literal the screens filter on", () => {
  // JOB_TYPE is a hand-written mirror of a raw DB value (it is not in the
  // status enum, on purpose). This is what stops it drifting.
  const files = [
    "src/pages/admin/B2BDispatchQueue.tsx",
    "src/features/trade-in/components/b2b/B2BAuditorTool.tsx",
    "functions/src/index.ts",
  ];
  for (const rel of files) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    assert.ok(
      src.includes(`'${JOB_TYPE.B2B}'`) || src.includes(`"${JOB_TYPE.B2B}"`),
      `${rel} does not mention ${JOB_TYPE.B2B} — JOB_TYPE has drifted from the writers`
    );
  }
});

check("B2B-Unpacked is a job type, not a status any transition lands on", () => {
  // It sits in JOB_STATUS_B2B because it was lifted from the TypeScript enum
  // that mislabels it, but every writer in the tree puts it in `type`. No
  // transition may point at it until that is untangled.
  const destinations = Object.values(TRANSITIONS).map((r) => r.to);
  assert.ok(
    !destinations.includes(JOB_STATUS_B2B.B2B_UNPACKED),
    "a transition now lands on B2B-Unpacked — check whether it is a status or a type first"
  );
});

if (failures > 0) {
  console.error(`\nstatus-engine-b2b: ${failures} failing`);
  process.exit(1);
}
console.log("status-engine-b2b: all passing");
