// rider-fee-guard — offline suite. เขียนจากเคสจริง 5 ก.ย. 2569: บัญชีไรเดอร์ของ
// เจ้าของบริษัทได้ค่ารอบเข้ากระเป๋า 129 แถวจากปุ่ม batch รุ่นเก่า + การอนุมัติจาก UI
// และงาน Store-in/Mail-in ที่ไม่มีไรเดอร์ 26 ใบได้ค่ารอบขั้นต่ำแล้วไปนั่งในคิว
// (docs/reports/2026-09-05-owner-rider-wallet-reversal-survey.md)
//
// INJECTION RESULTS (ทำทีละตัว วัดหลังรัน):
//   1. assertRiderFeePayable ไม่ throw (return เฉยๆ)             -> แดง 4
//   2. payoutRiderIdOf ไม่ trim ('   ' นับเป็นไรเดอร์)          -> แดง 2
//   3. buildRiderFeeApproval เช็ค !== 'Paid' แทน !== 'Pending'   -> แดง 2 (Waived / ว่าง)
//   4. buildRiderFeeWaive ไม่ตรวจ reason ว่าง                     -> แดง 1
//   5. parseOwnerRiderIds split ด้วย ',' อย่างเดียว              -> แดง 1 (ช่องว่าง/ขึ้นบรรทัด)
//   6. buildRiderFeeWaive แตะ rider_fee                           -> แดง 1
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const guard = require(path.join(root, "functions/rider-fee-guard.js"));
const {
  RiderFeeGuardError,
  parseOwnerRiderIds,
  ownerRiderIdsFromEnv,
  payoutRiderIdOf,
  riderFeeBlockReason,
  assertRiderFeePayable,
  buildRiderFeeApproval,
  buildRiderFeeWaive,
} = guard;

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

const OWNER = "GmxOwnerUid";
const owners = new Set([OWNER]);
const NOW = 1_757_000_000_000;
const job = { id: "j1", ref_no: "OID-1", model: "iPhone 15", rider_id: "r1", rider_fee: 95, rider_fee_status: "Pending" };

console.log("parseOwnerRiderIds / env");
check("คั่นด้วย , ช่องว่าง หรือขึ้นบรรทัด และตัดค่าว่าง", () => {
  assert.deepEqual([...parseOwnerRiderIds("a, b\nc  d,,")], ["a", "b", "c", "d"]);
});
check("ไม่ตั้ง / ไม่ใช่สตริง = เซ็ตว่าง", () => {
  assert.equal(parseOwnerRiderIds(undefined).size, 0);
  assert.equal(parseOwnerRiderIds("").size, 0);
  assert.equal(parseOwnerRiderIds(42).size, 0);
});
check("ownerRiderIdsFromEnv อ่าน OWNER_RIDER_IDS", () => {
  assert.deepEqual([...ownerRiderIdsFromEnv({ OWNER_RIDER_IDS: "x,y" })], ["x", "y"]);
  assert.equal(ownerRiderIdsFromEnv({}).size, 0);
});

console.log("payoutRiderIdOf / riderFeeBlockReason");
check("rider_id ปกติ", () => {
  assert.equal(payoutRiderIdOf(job), "r1");
  assert.equal(riderFeeBlockReason(job, owners), null);
});
check("บัญชีเจ้าของ = owner_rider", () => {
  assert.equal(riderFeeBlockReason({ ...job, rider_id: OWNER }, owners), "owner_rider");
});
check("rider_id ว่างทุกรูป = no_rider (สตริงว่างคือรูปที่ปุ่ม batch รุ่นเก่าปล่อยผ่าน)", () => {
  for (const v of [undefined, null, "", "   "]) {
    assert.equal(payoutRiderIdOf({ ...job, rider_id: v }), null, `rider_id=${JSON.stringify(v)}`);
    assert.equal(riderFeeBlockReason({ ...job, rider_id: v }, owners), "no_rider");
  }
});
check("งานที่ไรเดอร์ยกเลิก อ่าน cancelled_by รูป rider:{id} — และเจ้าของก็ยังโดนด่าน", () => {
  assert.equal(payoutRiderIdOf({ rider_id: null, cancelled_by: "rider:r9" }), "r9");
  assert.equal(riderFeeBlockReason({ rider_id: null, cancelled_by: `rider:${OWNER}` }, owners), "owner_rider");
  assert.equal(riderFeeBlockReason({ rider_id: null, cancelled_by: "customer" }, owners), "no_rider");
  assert.equal(payoutRiderIdOf({ rider_id: null, cancelled_by: "rider:" }), null);
});

console.log("assertRiderFeePayable");
check("เจ้าของ → throw RiderFeeGuardError(owner_rider) พร้อม jobId", () => {
  assert.throws(
    () => assertRiderFeePayable({ ...job, rider_id: OWNER }, owners),
    (e) => e instanceof RiderFeeGuardError && e.code === "owner_rider" && e.jobId === "j1",
  );
});
check("ไม่มีไรเดอร์ → throw RiderFeeGuardError(no_rider)", () => {
  assert.throws(() => assertRiderFeePayable({ ...job, rider_id: "" }, owners), (e) => e.code === "no_rider");
});
check("ผ่านด่าน = ไม่ throw", () => {
  assert.doesNotThrow(() => assertRiderFeePayable(job, owners));
});

console.log("buildRiderFeeApproval");
check("เขียน jobs + transactions ในชุดเดียว รูปเดิมทุกฟิลด์ + taxable:true", () => {
  const u = buildRiderFeeApproval({ job, txKey: "t1", now: NOW, approvedBy: "staff-7", ownerRiderIds: owners });
  assert.equal(u["jobs/j1/rider_fee_status"], "Paid");
  assert.equal(u["jobs/j1/settled_at"], NOW);
  assert.equal(u["jobs/j1/rider_fee_approved_by"], "staff-7");
  assert.deepEqual(u["transactions/t1"], {
    rider_id: "r1", amount: 95, type: "CREDIT", category: "JOB_PAYOUT", taxable: true,
    description: "ค่าเที่ยวงาน iPhone 15 (OID-1)", timestamp: NOW, ref_job_id: "j1",
  });
});
check("เจ้าของ → throw ไม่คืน updates (ด่านถาวร)", () => {
  assert.throws(
    () => buildRiderFeeApproval({ job: { ...job, rider_id: OWNER }, txKey: "t1", now: NOW, ownerRiderIds: owners }),
    (e) => e.code === "owner_rider",
  );
});
check("rider_id ว่าง → throw ไม่คืน updates", () => {
  assert.throws(
    () => buildRiderFeeApproval({ job: { ...job, rider_id: "" }, txKey: "t1", now: NOW, ownerRiderIds: owners }),
    (e) => e.code === "no_rider",
  );
});
check("ไม่มีค่ารอบที่ประทับ / ศูนย์ / ค่าประมาณ = null ไม่ throw (เรื่องข้อมูล ไม่ใช่ฝ่าด่าน)", () => {
  const { rider_fee, ...noFee } = job;
  assert.equal(buildRiderFeeApproval({ job: noFee, txKey: "t1", now: NOW, ownerRiderIds: owners }), null);
  assert.equal(buildRiderFeeApproval({ job: { ...noFee, rider_fee_estimate: 90 }, txKey: "t1", now: NOW, ownerRiderIds: owners }), null);
  assert.equal(buildRiderFeeApproval({ job: { ...job, rider_fee: 0 }, txKey: "t1", now: NOW, ownerRiderIds: owners }), null);
});
check("เฉพาะ Pending — Paid (จ่ายซ้ำ), Waived, ว่าง = null", () => {
  for (const st of ["Paid", "Waived", undefined, ""]) {
    assert.equal(
      buildRiderFeeApproval({ job: { ...job, rider_fee_status: st }, txKey: "t1", now: NOW, ownerRiderIds: owners }),
      null,
      `status=${st}`,
    );
  }
});
check("ไม่มี txKey / ไม่มี id = null", () => {
  assert.equal(buildRiderFeeApproval({ job, txKey: "", now: NOW, ownerRiderIds: owners }), null);
  assert.equal(buildRiderFeeApproval({ job: { ...job, id: undefined }, txKey: "t1", now: NOW, ownerRiderIds: owners }), null);
});
check("ไม่ส่ง approvedBy = ไม่เขียนคีย์เปล่า", () => {
  const u = buildRiderFeeApproval({ job, txKey: "t1", now: NOW, ownerRiderIds: owners });
  assert.equal("jobs/j1/rider_fee_approved_by" in u, false);
});
check("ยกเลิกโดยไรเดอร์แต่มีค่าเสียเวลา — จ่ายให้คนที่ทำงานจริง", () => {
  const u = buildRiderFeeApproval({ job: { ...job, rider_id: null, cancelled_by: "rider:r9", rider_fee: 40 }, txKey: "t1", now: NOW, ownerRiderIds: owners });
  assert.equal(u["transactions/t1"].rider_id, "r9");
  assert.equal(u["transactions/t1"].amount, 40);
});

console.log("buildRiderFeeWaive");
check("Pending → Waived พร้อม reason/at/by และแถว qc_logs ไม่แตะ rider_fee", () => {
  const u = buildRiderFeeWaive({ job: { ...job, qc_logs: [{ action: "old" }] }, reason: " ไม่มีไรเดอร์ ", now: NOW, by: "staff-3" });
  assert.equal(u["jobs/j1/rider_fee_status"], "Waived");
  assert.equal(u["jobs/j1/rider_fee_waived_reason"], "ไม่มีไรเดอร์");
  assert.equal(u["jobs/j1/rider_fee_waived_at"], NOW);
  assert.equal(u["jobs/j1/rider_fee_waived_by"], "staff-3");
  assert.equal(u["jobs/j1/qc_logs"].length, 2);
  assert.equal(u["jobs/j1/qc_logs"][0].action, "Rider Fee Waived");
  assert.equal(Object.keys(u).some((k) => k.endsWith("/rider_fee")), false);
  assert.equal(Object.keys(u).some((k) => k.startsWith("transactions/")), false);
});
check("qc_logs รูป object (RTDB คืนเมื่อคีย์ไม่ต่อเนื่อง) ถูกอ่านเป็น array", () => {
  const u = buildRiderFeeWaive({ job: { ...job, qc_logs: { a: { action: "x" }, b: { action: "y" } } }, reason: "r", now: NOW, by: "s" });
  assert.equal(u["jobs/j1/qc_logs"].length, 3);
});
check("reason ว่าง → throw reason_required", () => {
  for (const r of ["", "   ", undefined, null, 5]) {
    assert.throws(() => buildRiderFeeWaive({ job, reason: r, now: NOW, by: "s" }), (e) => e.code === "reason_required", `reason=${JSON.stringify(r)}`);
  }
});
check("reason ยาวเกิน → throw reason_too_long", () => {
  assert.throws(() => buildRiderFeeWaive({ job, reason: "x".repeat(201), now: NOW, by: "s" }), (e) => e.code === "reason_too_long");
});
check("Paid / Waived / ว่าง = null (Paid ต้องกลับรายการผ่านสคริปต์ ไม่ใช่ waive)", () => {
  for (const st of ["Paid", "Waived", undefined]) {
    assert.equal(buildRiderFeeWaive({ job: { ...job, rider_fee_status: st }, reason: "r", now: NOW, by: "s" }), null, `status=${st}`);
  }
});
check("waive ไม่สนด่านเจ้าของ — ใบเจ้าของคือใบที่ต้อง waive ได้", () => {
  const u = buildRiderFeeWaive({ job: { ...job, rider_id: OWNER }, reason: "owner_run", now: NOW, by: "s" });
  assert.equal(u["jobs/j1/rider_fee_status"], "Waived");
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall rider-fee-guard checks passed");
