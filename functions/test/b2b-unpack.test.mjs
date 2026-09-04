// unpackB2BLot — offline suite for the pure halves.
//
// The callable itself needs a database; what is testable without one is every
// decision it makes BEFORE it writes, plus the exact shape of the child rows
// (which is what the QC station, the inventory page and the CEO dashboard all
// read afterwards).
//
// INJECTION RESULTS — each applied alone, suite went red:
//   1. read graded_items as an array only          -> object-shaped rows test
//   2. drop the Paid pre-check from checkUnpackable-> "wrong status" test
//   3. drop the tax-invoice check                  -> "no tax invoice" test
//   4. keep Reject rows in the children            -> valid-items tests
//   5. child status becomes Completed not Pending QC -> child shape test
//   6. child loses parent_b2b_id                   -> "the retry can find them"
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { validItemsOf, buildUnpackChildren, checkUnpackable } = require(
  path.join(root, "functions/b2b-unpack.js")
);
const { JOB_STATUS } = require(path.join(root, "functions/status-vocab.generated.js"));

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

const item = (over = {}) => ({ id: "1", imei: "35000", model: "iPhone 13", grade: "A", price: 12000, ...over });

const lot = (over = {}) => ({
  ref_no: "OID-123456",
  type: "B2B Trade-in",
  // The value finance actually writes for the B2B branch; normalizeStatus
  // reads it as Paid.
  status: "Payment Completed",
  cust_name: "บริษัท ทดสอบ จำกัด (คุณสมชาย)",
  agent_name: "Admin A",
  documents: { tax_invoice_number: "TIV-001" },
  graded_items: [item(), item({ id: "2", imei: "35001", grade: "B", price: 9000 })],
  ...over,
});

console.log("b2b-unpack");

// ── What counts as a device ─────────────────────────────────────────────────

check("rejected devices are not unpacked — the shop did not buy them", () => {
  const job = lot({ graded_items: [item(), item({ id: "2", grade: "Reject", price: 0 })] });
  assert.equal(validItemsOf(job).length, 1);
});

check("graded_items arriving as an object still reads — RTDB does that after a delete", () => {
  // The auditor tool has a delete button, and RTDB stops returning an array
  // the moment the keys are not contiguous. Reading it as an array only is a
  // bug that waits for the first deleted row.
  const job = lot({ graded_items: { 0: item(), 2: item({ id: "3", imei: "35002" }) } });
  assert.equal(validItemsOf(job).length, 2);
});

check("no graded_items at all is zero, not a crash", () => {
  assert.equal(validItemsOf({}).length, 0);
  assert.equal(validItemsOf({ graded_items: null }).length, 0);
});

// ── What must be true before a single row is written ────────────────────────

check("a lot that finance has not paid cannot be unpacked", () => {
  // Checked here as well as in the engine because the children are written
  // FIRST — without this, a lot at the wrong status gets its devices created
  // and only then gets refused.
  const out = checkUnpackable(lot({ status: "Pending Finance Approval" }));
  assert.ok(out, "should be refused");
  assert.match(out.message, /ชำระเงิน/);
});

check("no tax invoice number, no stock intake", () => {
  const out = checkUnpackable(lot({ documents: {} }));
  assert.ok(out);
  assert.match(out.message, /ใบกำกับภาษี/);
});

check("a lot with nothing graded is refused", () => {
  const out = checkUnpackable(lot({ graded_items: [] }));
  assert.ok(out);
});

check("a retail job cannot be unpacked as a lot, whatever its status", () => {
  const out = checkUnpackable({ ...lot(), type: "Trade-in" });
  assert.ok(out);
  assert.match(out.message, /ไม่ใช่ล็อต/);
});

check("the short 'B2B' spelling is a lot too", () => {
  assert.equal(checkUnpackable({ ...lot(), type: "B2B" }), null);
});

check("a complete lot passes", () => {
  assert.equal(checkUnpackable(lot()), null);
});

// ── The rows the rest of the system reads afterwards ────────────────────────

check("child rows carry what the QC queue and inventory read", () => {
  const out = buildUnpackChildren({ job: lot(), jobId: "PARENT1", keys: ["c1", "c2"], now: 1_700_000_000_000 });
  const first = out["jobs/c1"];
  assert.equal(first.status, JOB_STATUS.PENDING_QC, "a child enters the retail inventory flow");
  assert.equal(first.type, "B2B-Unpacked");
  assert.equal(first.receive_method, "Corporate Bulk");
  assert.equal(first.ref_no, "OID-123456-U001");
  assert.equal(out["jobs/c2"].ref_no, "OID-123456-U002");
  assert.equal(first.model, "iPhone 13");
  assert.equal(first.pre_grade, "A");
  assert.equal(first.price, 12000);
  assert.equal(first.imei, "35000");
  assert.equal(first.serial, "35000");
  assert.equal(first.cust_name, "[Corporate] บริษัท ทดสอบ จำกัด ");
});

check("every child points back at its lot — this is what makes the retry safe", () => {
  // The existence query is orderByChild('parent_b2b_id'). A child without it
  // is invisible to that query, so a retry would create the whole lot again.
  const out = buildUnpackChildren({ job: lot(), jobId: "PARENT1", keys: ["c1", "c2"], now: 1 });
  for (const row of Object.values(out)) {
    assert.equal(row.parent_b2b_id, "PARENT1");
  }
});

check("rejected devices produce no child row", () => {
  const job = lot({ graded_items: [item(), item({ id: "2", grade: "Reject" })] });
  const out = buildUnpackChildren({ job, jobId: "P", keys: ["c1", "c2"], now: 1 });
  assert.equal(Object.keys(out).length, 1);
});

check("child rows never write engine-owned fields other than their own start", () => {
  // A child is a brand new job, so it legitimately declares its starting
  // status — but it must not arrive pre-loaded with a history or a paid stamp
  // copied from the lot.
  const out = buildUnpackChildren({ job: lot(), jobId: "P", keys: ["c1", "c2"], now: 1 });
  for (const row of Object.values(out)) {
    for (const field of ["status_version", "status_history", "paid_at", "custody", "refunded_at"]) {
      assert.equal(row[field], undefined, `child must not carry ${field}`);
    }
  }
});

check("the lot's own index is what the query needs — pinned so nobody renames it", () => {
  // `parent_b2b_id` is also the value in database.rules.json's .indexOn for
  // /jobs, which lives in ANOTHER repo. Renaming it here silently turns the
  // existence query into a full-node download.
  const out = buildUnpackChildren({ job: lot(), jobId: "P", keys: ["c1"], now: 1 });
  assert.ok("parent_b2b_id" in out["jobs/c1"]);
});

check("the unpack callable's own role table matches the engine's reach", () => {
  // `unpackB2BLot` gates on staff role BEFORE it ever calls the engine, so it
  // is a SECOND copy of the same rule. When finance was opened up, missing
  // this one would have left exactly one B2B button broken — the hardest
  // shape of bug to trace back to a permission change.
  const src = fs.readFileSync(path.join(root, "functions/b2b-unpack.js"), "utf8");
  const table = src.match(/const ROLE_ACTOR = \{([\s\S]*?)\}/);
  assert.ok(table, "role table not found");
  for (const role of ["CEO", "MANAGER", "STAFF", "FINANCE"]) {
    assert.match(table[1], new RegExp(`\\b${role}\\s*:`), `${role} missing from the unpack role table`);
  }
  // RIDER must not be in it: a rider has no reason to close a corporate lot.
  assert.doesNotMatch(table[1], /\bRIDER\s*:/);
});

if (failures > 0) {
  console.error(`\nb2b-unpack: ${failures} failing`);
  process.exit(1);
}
console.log("b2b-unpack: all passing");
