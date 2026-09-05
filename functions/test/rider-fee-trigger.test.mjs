// rider-fee-trigger — offline suite. เขียนจากบั๊กจริง: ตาข่ายกันตกของ
// onJobHandedOverCalcRiderFee เทียบ 'Sent to QC Lab' สะกดเดียว ขณะที่ engine
// เขียน 'Sent To QC Lab' → งาน Pickup ที่ข้ามขั้นส่งมอบเข้าแล็บผ่าน engine ไม่ได้
// ค่ารอบ (รายงานขั้นที่ 3 ข้อ 1)
//
// INJECTION RESULTS (ทำทีละตัว วัดหลังรัน):
//   1. isFeeTriggerStatus เทียบ raw === แทน normalize   -> แดง 1 (เทส "ทั้งสองสะกด")
//   2. ตัด SENT_TO_QC_LAB ออกจาก FEE_TRIGGER_CANONICAL  -> แดง 2
//   3. isSafetyNetEntry คืน true เสมอ                    -> แดง 1 (ทางหลักถูกนับเป็นตาข่าย)
//   4. feeCalcBlockReason ไม่เช็ค receive_method            -> แดง 1 (Store-in/Mail-in) — วัดจริง 5 ก.ย. 2569
//   5. feeCalcBlockReason เช็ค `!job.rider_id` แทน trim     -> แดง 1 ('   ') — วัดจริง 5 ก.ย. 2569
//
// ด่าน 4-5 มาจากบั๊กจริง 5 ก.ย. 2569: ทางหลัก (Pending QC) ของ onJobHandedOverCalcRiderFee
// ไม่เช็ค rider_id/receive_method เลย (สองด่านอยู่เฉพาะบล็อกตาข่าย) งาน Store-in/Mail-in
// จึงได้ค่ารอบขั้นต่ำ + Pending ไปนั่งในคิวอนุมัติ 26 ใบ ทั้งที่ไม่มีใครให้จ่าย
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { FEE_TRIGGER_CANONICAL, isFeeTriggerStatus, isSafetyNetEntry, feeCalcBlockReason } = require(
  path.join(root, "functions/rider-fee-trigger.js")
);
const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
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

console.log("rider-fee-trigger");

check("ทางหลัก: Pending QC คิดค่ารอบ และไม่ใช่ตาข่าย", () => {
  assert.equal(isFeeTriggerStatus("Pending QC"), true);
  assert.equal(isSafetyNetEntry("Pending QC", "Pickup"), false);
});

check("ตาข่าย: Sent To QC Lab ทั้งสองสะกด — ของ engine และแถวเก่า", () => {
  for (const spelling of ["Sent To QC Lab", "Sent to QC Lab"]) {
    assert.equal(isFeeTriggerStatus(spelling), true, `${spelling} ต้องคิดค่ารอบ`);
    assert.equal(isSafetyNetEntry(spelling, "Pickup"), true, `${spelling} คือทางตาข่าย`);
  }
});

check("ตาข่าย: In Stock", () => {
  assert.equal(isFeeTriggerStatus("In Stock"), true);
  assert.equal(isSafetyNetEntry("In Stock", "Pickup"), true);
});

check("สถานะอื่นไม่ยิง — รวมค่าที่อ่านไม่ออกและค่าว่าง", () => {
  for (const s of ["Ready To Sell", "Waiting For Handover", "Paid", "Reserved", "", null, undefined, 42]) {
    assert.equal(isFeeTriggerStatus(s), false, `${JSON.stringify(s)} ต้องไม่ยิง`);
  }
});

check("ทุกค่าที่ engine เขียนซึ่งตกในเซ็ตนี้ ถูกจับได้ — ด่านตามตาราง TRANSITIONS ไม่ใช่ตามความจำ", () => {
  // events ที่ลงที่ Sent To QC Lab / In Stock / Pending QC ทุกตัว: ค่า `to` ของมัน
  // ต้องผ่าน isFeeTriggerStatus — ถ้าวันหนึ่งมีคนเปลี่ยนสะกดใน enum ด่านนี้แดงเอง
  const landing = Object.entries(TRANSITIONS)
    .filter(([, r]) => FEE_TRIGGER_CANONICAL.includes(r.to))
    .map(([e, r]) => [e, r.to]);
  assert.ok(landing.length >= 4, `คาดว่ามีอย่างน้อย 4 event ลงในเซ็ตนี้ ได้ ${landing.length}`);
  for (const [event, to] of landing) {
    assert.equal(isFeeTriggerStatus(to), true, `${event} -> ${to} หลุดจากตัวจับ`);
  }
  assert.deepEqual(FEE_TRIGGER_CANONICAL, [JOB_STATUS.PENDING_QC, JOB_STATUS.SENT_TO_QC_LAB, JOB_STATUS.IN_STOCK]);
});

check("ด่านร่วมสองทางเข้า: ไรเดอร์ไปรับ + มีไรเดอร์ถืองาน เท่านั้นที่คิดค่ารอบ", () => {
  assert.equal(feeCalcBlockReason({ receive_method: "Pickup", rider_id: "r1" }), null);
  for (const method of ["Store-in", "Mail-in", "Corporate Pickup", undefined, null]) {
    assert.equal(feeCalcBlockReason({ receive_method: method, rider_id: "r1" }), "not_pickup", `receive_method=${method}`);
  }
});

check("Pickup ที่ไม่มีไรเดอร์ (ทุกรูปของค่าว่าง) = no_rider — ไม่คิด ไม่ตั้ง status", () => {
  for (const rid of [undefined, null, "", "   ", 42]) {
    assert.equal(feeCalcBlockReason({ receive_method: "Pickup", rider_id: rid }), "no_rider", `rider_id=${JSON.stringify(rid)}`);
  }
  assert.equal(feeCalcBlockReason(null), "not_pickup");
});

if (failures > 0) {
  console.error(`\nrider-fee-trigger: ${failures} failing`);
  process.exit(1);
}
console.log("rider-fee-trigger: all passing");
