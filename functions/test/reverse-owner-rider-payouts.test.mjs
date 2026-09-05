// reverse-owner-rider-payouts — offline suite ของ planner (pure) ในสคริปต์กลับรายการ
// ค่ารอบบัญชีเจ้าของ. fixture จำลอง 3 แถว JOB_PAYOUT (2 ของ OWNER, 1 ของไรเดอร์จ้าง)
// + งาน 5 ใบครบทุกถัง (Paid ของ OWNER / Pending ของ OWNER / Pending ไม่มีไรเดอร์ /
// Pending ของไรเดอร์จ้าง / Waived อยู่แล้ว)
//
// INJECTION RESULTS (ทำทีละตัว วัดหลังรัน):
//   1. alreadyReversedKeys คืนเซ็ตว่างเสมอ                  -> แดง 2 (idempotent)
//   2. planReversal ไม่เช็ค ownerRiderIds                      -> แดง 1
//   3. แถวกลับเป็น CREDIT แทน DEBIT                             -> แดง 2 (รูปแถว + balance)
//   4. waiveUpdates เขียน rider_fee                             -> แดง 1
//   5. Pending ของไรเดอร์จ้างถูก waive ด้วย                    -> แดง 1
//   6. ข้ามแถวที่ amount ใช้ไม่ได้ แต่ยังนับเข้า Σ               -> แดง 1
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = require(path.join(root, "scripts/reverse-owner-rider-payouts.cjs"));
const { planReversal, waiveUpdates, balanceBeforeAfter, parseArgs, REVERSAL_REASON } = script;
const { loadWalletLedger, resolveRiderAppDir } = require(path.join(root, "scripts/rider-wallet-audit.cjs"));

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

const OWNER = "owner-uid";
const RIDER = "rider-uid";
const owners = new Set([OWNER]);
const NOW = 1_757_000_000_000;

const fixture = () => ({
  transactions: {
    txA: { rider_id: OWNER, amount: 150, type: "CREDIT", category: "JOB_PAYOUT", ref_job_id: "jPaid", timestamp: 1, description: "ค่าเที่ยวงาน x (R-1) [Batch]" },
    txB: { rider_id: OWNER, amount: "95", type: "CREDIT", category: "JOB_PAYOUT", ref_job_id: "jGone", timestamp: 2 },
    txC: { rider_id: RIDER, amount: 120, type: "CREDIT", category: "JOB_PAYOUT", ref_job_id: "jRider", timestamp: 3 },
    // คู่ ADJUSTMENT เดิมของ OWNER ที่หักกันเป็นศูนย์ — ต้องปล่อยไว้และไม่ถูกนับเป็นแถวกลับ
    adjUp: { rider_id: OWNER, amount: 30, type: "CREDIT", category: "ADJUSTMENT", ref_job_id: "jPaid", timestamp: 4 },
    adjDown: { rider_id: OWNER, amount: 30, type: "DEBIT", category: "ADJUSTMENT", ref_job_id: "jPaid", timestamp: 5 },
  },
  jobs: {
    jPaid: { ref_no: "R-1", rider_id: OWNER, rider_fee: 150, rider_fee_status: "Paid", qc_logs: [{ action: "old" }] },
    jOwnerPending: { ref_no: "R-2", rider_id: OWNER, rider_fee: 100, rider_fee_status: "Pending" },
    jNoRider: { ref_no: "R-3", receive_method: "Store-in", rider_fee: 100, rider_fee_status: "Pending" },
    jNoRiderCancelled: { ref_no: "R-4", rider_id: null, cancelled_by: "customer", rider_fee: 40, rider_fee_status: "Pending" },
    jOwnerCancelled: { ref_no: "R-5", rider_id: null, cancelled_by: `rider:${OWNER}`, rider_fee: 40, rider_fee_status: "Pending" },
    jRider: { ref_no: "R-6", rider_id: RIDER, rider_fee: 120, rider_fee_status: "Pending" },
    jWaived: { ref_no: "R-7", rider_id: OWNER, rider_fee: 100, rider_fee_status: "Waived" },
    jNoStatus: { ref_no: "R-8", rider_id: OWNER, rider_fee: 100 },
  },
});

const keyGen = (prefix) => { let n = 0; return () => `${prefix}${++n}`; };

console.log("reverse-owner-rider-payouts");

check("--rider ที่ไม่อยู่ใน OWNER_RIDER_IDS = throw ไม่วางแผน", () => {
  const f = fixture();
  assert.throws(() => planReversal({ ...f, riderId: RIDER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") }), /ไม่อยู่ใน OWNER_RIDER_IDS/);
  assert.throws(() => planReversal({ ...f, riderId: OWNER, ownerRiderIds: new Set(), now: NOW, newKey: keyGen("k") }));
});

check("แถวกลับ: หนึ่งต่อหนึ่งกับ JOB_PAYOUT/CREDIT ของ OWNER เท่านั้น รูปตามสเปก ไม่แตะแถวเดิม", () => {
  const f = fixture();
  const plan = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
  assert.equal(plan.payoutRowCount, 2);
  assert.equal(plan.reversals.length, 2);
  assert.equal(plan.sumAmount, 245);
  const r = plan.updates["transactions/k1"];
  assert.deepEqual(r, {
    rider_id: OWNER, amount: 150, type: "DEBIT", category: "ADJUSTMENT", taxable: false,
    description: "กลับรายการค่ารอบบัญชีเจ้าของ (R-1)", timestamp: NOW, ref_job_id: "jPaid",
    meta: { reason: REVERSAL_REASON, reverses: "txA", reversed_at: NOW, reversed_by: "script" },
  });
  assert.equal(plan.updates["transactions/k2"].amount, 95, "amount สตริง '95' ต้องกลายเป็นตัวเลข");
  assert.equal(plan.updates["transactions/k2"].ref_job_id, "jGone");
  // ไม่มี path ที่แตะแถวเดิมหรือแถวของไรเดอร์จ้าง
  for (const k of ["txA", "txB", "txC", "adjUp", "adjDown"]) assert.equal(`transactions/${k}` in plan.updates, false, k);
  assert.equal(Object.keys(plan.updates).some((k) => k.startsWith("transactions/") && plan.updates[k].rider_id === RIDER), false);
});

check("งาน: Paid ของ OWNER → Waived owner_run · Pending ของ OWNER (rider_id และ cancelled_by) → owner_run · Pending ไม่มีไรเดอร์ → no_rider · ไรเดอร์จ้าง/Waived/ไม่มีสถานะ ไม่แตะ", () => {
  const f = fixture();
  const plan = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
  assert.deepEqual(plan.waived.owner_paid.map((w) => w.job_id), ["jPaid"]);
  assert.deepEqual(plan.waived.owner_pending.map((w) => w.job_id).sort(), ["jOwnerCancelled", "jOwnerPending"]);
  assert.deepEqual(plan.waived.no_rider.map((w) => w.job_id).sort(), ["jNoRider", "jNoRiderCancelled"]);
  assert.equal(plan.updates["jobs/jPaid/rider_fee_status"], "Waived");
  assert.equal(plan.updates["jobs/jPaid/rider_fee_waived_reason"], "owner_run");
  assert.equal(plan.updates["jobs/jPaid/rider_fee_waived_by"], "script");
  assert.equal(plan.updates["jobs/jPaid/rider_fee_waived_at"], NOW);
  assert.equal(plan.updates["jobs/jPaid/qc_logs"].length, 2);
  assert.equal(plan.updates["jobs/jNoRider/rider_fee_waived_reason"], "no_rider");
  for (const id of ["jRider", "jWaived", "jNoStatus"]) {
    assert.equal(Object.keys(plan.updates).some((k) => k.startsWith(`jobs/${id}/`)), false, `${id} ต้องไม่ถูกแตะ`);
  }
  // ห้ามแตะ rider_fee ทุกใบ
  assert.equal(Object.keys(plan.updates).some((k) => k.endsWith("/rider_fee")), false);
});

check("idempotent: รันรอบสองบนผลของรอบแรก = ไม่มีแถวกลับใหม่ ไม่มีงานให้เขียน", () => {
  const f = fixture();
  const first = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
  // จำลองสถานะหลัง apply: แถวใหม่เข้า transactions, งานกลายเป็น Waived
  const after = { transactions: { ...f.transactions }, jobs: JSON.parse(JSON.stringify(f.jobs)) };
  for (const [k, v] of Object.entries(first.updates)) {
    if (k.startsWith("transactions/")) after.transactions[k.slice("transactions/".length)] = v;
    else {
      const [, id, field] = k.split("/");
      after.jobs[id][field] = v;
    }
  }
  const second = planReversal({ ...after, riderId: OWNER, ownerRiderIds: owners, now: NOW + 1, newKey: keyGen("z") });
  assert.equal(second.reversals.length, 0);
  assert.equal(second.alreadyReversed, 2);
  assert.equal(second.pathCount, 0);
  assert.deepEqual(second.waived, { owner_paid: [], owner_pending: [], no_rider: [] });
});

check("แถวที่กลับไปแล้วบางส่วน — รอบถัดไปกลับเฉพาะที่เหลือ และงาน Paid ที่ยังค้างก็ยังถูก waive", () => {
  const f = fixture();
  f.transactions.rev1 = { rider_id: OWNER, amount: 150, type: "DEBIT", category: "ADJUSTMENT", ref_job_id: "jPaid", timestamp: 9, meta: { reason: REVERSAL_REASON, reverses: "txA" } };
  const plan = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
  assert.deepEqual(plan.reversals.map((r) => r.reverses), ["txB"]);
  assert.equal(plan.alreadyReversed, 1);
  assert.deepEqual(plan.waived.owner_paid.map((w) => w.job_id), ["jPaid"]);
});

check("amount ใช้ไม่ได้ (ว่าง / NaN / 0 / ติดลบ) = ข้ามพร้อมรายงาน ไม่เข้า Σ ไม่ทำให้ล้มทั้งแผน", () => {
  const f = fixture();
  f.transactions.txBad1 = { rider_id: OWNER, amount: "", type: "CREDIT", category: "JOB_PAYOUT", ref_job_id: "jPaid", timestamp: 6 };
  f.transactions.txBad2 = { rider_id: OWNER, amount: -5, type: "CREDIT", category: "JOB_PAYOUT", ref_job_id: "jPaid", timestamp: 7 };
  const plan = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
  assert.equal(plan.skippedRows.length, 2);
  assert.equal(plan.reversals.length, 2);
  assert.equal(plan.sumAmount, 245);
});

check("waiveUpdates: Waived อยู่แล้ว = null · Paid และ Pending เขียนได้ · ไม่มี id = null", () => {
  assert.equal(waiveUpdates({ id: "j", rider_fee_status: "Waived" }, "owner_run", NOW), null);
  assert.equal(waiveUpdates({ rider_fee_status: "Paid" }, "owner_run", NOW), null);
  assert.equal(waiveUpdates({ id: "j", rider_fee_status: "Paid", rider_fee: 150 }, "owner_run", NOW)["jobs/j/rider_fee_status"], "Waived");
  assert.equal(waiveUpdates({ id: "j", rider_fee_status: "Pending" }, "no_rider", NOW)["jobs/j/rider_fee_waived_reason"], "no_rider");
});

// balance ด้วย ledger จำลองที่มีสัญญาเดียวกับ walletLedger.ts (CREDIT บวก DEBIT ลบ, กรองหมวด)
const stubLedger = {
  isRiderWalletTx: (t) => (t.type === "CREDIT" || t.type === "DEBIT") && ["JOB_PAYOUT", "WITHDRAWAL", "PENALTY", "BONUS", "ADJUSTMENT", "EXPENSE_REIMBURSEMENT", "COMPANY_ADVANCE", "RIDER_DEPOSIT"].includes(t.category) && Number.isFinite(Number(t.amount)),
  walletBalance: (rows) => rows.reduce((a, t) => (t.type === "CREDIT" ? a + Number(t.amount) : a - Number(t.amount)), 0),
};

check("balance OWNER ก่อน 245 (คู่ ADJUSTMENT หักกันเอง) → หลัง 0 · ไรเดอร์จ้างไม่กระทบ", () => {
  const f = fixture();
  const plan = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
  const b = balanceBeforeAfter(stubLedger, f.transactions, plan.updates, OWNER);
  assert.equal(b.before, 245);
  assert.equal(b.after, 0);
  const r = balanceBeforeAfter(stubLedger, f.transactions, plan.updates, RIDER);
  assert.equal(r.before, 120);
  assert.equal(r.after, 120);
});

const riderAppDir = resolveRiderAppDir(null);
if (riderAppDir && existsSync(path.join(riderAppDir, "src/utils/walletLedger.ts"))) {
  check("balance ด้วย walletLedger.ts ตัวจริงของแอปไรเดอร์ตอบเท่ากับ stub (เมื่อ checkout ข้างกัน)", () => {
    const { ledger } = loadWalletLedger(riderAppDir);
    const f = fixture();
    const plan = planReversal({ ...f, riderId: OWNER, ownerRiderIds: owners, now: NOW, newKey: keyGen("k") });
    const b = balanceBeforeAfter(ledger, f.transactions, plan.updates, OWNER);
    assert.equal(b.before, 245);
    assert.equal(b.after, 0);
  });
} else {
  console.log("  skip bkk-rider-app ไม่ได้ checkout ข้างกัน — ข้ามเคส walletLedger.ts ตัวจริง");
}

check("parseArgs: ต้องมี --rider · --apply เป็น opt-in · ตัวเลือกแปลก = throw", () => {
  assert.throws(() => parseArgs([]), /--rider/);
  assert.deepEqual(parseArgs(["--rider", "u1"]), { apply: false, rider: "u1", serviceAccount: null, riderApp: null });
  assert.equal(parseArgs(["--rider", "u1", "--apply"]).apply, true);
  assert.throws(() => parseArgs(["--rider", "u1", "--force"]));
});

if (failures > 0) {
  console.error(`\nreverse-owner-rider-payouts: ${failures} failing`);
  process.exit(1);
}
console.log("reverse-owner-rider-payouts: all passing");
