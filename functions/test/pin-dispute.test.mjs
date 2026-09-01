// ---------------------------------------------------------------------------
// แย้งหมุดลูกค้า — ด่านของ multi-path update ตอนอนุมัติ
//
//   node functions/test/pin-dispute.test.mjs
//
// ทำไมมีไฟล์นี้: เวอร์ชันแรกเขียน `jobs/{id}/pin_dispute` ทั้งก้อน แล้วเขียน
// `jobs/{id}/pin_dispute/delta_tx_id` ต่อในก้อนเดียวกัน — RTDB ปฏิเสธทั้ง
// update เพราะ path หนึ่งเป็นบรรพบุรุษของอีก path ("...is ancestor of
// another path...") แล้วเด้งถึงแอดมินเป็นคำว่า "INTERNAL" เฉยๆ
//
// ที่แย่กว่าคือมัน **พังเฉพาะงานที่จ่ายค่ารอบไปแล้ว** (เส้นทางเดียวที่มีแถว
// ledger) ซึ่งเป็นเคสที่ smoke ตอนนั้นไม่ได้เดินไปถึง — เจอบน production
// รอบแรกที่กดใช้จริง 1 ก.ย. 2569
//
// เทสจึงตรวจ "รูปของ update map" ไม่ใช่แค่ตัวเลข: ห้ามมี key ใดเป็น
// บรรพบุรุษของอีก key ในก้อนเดียวกัน ทุกเส้นทาง
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { buildApprovalUpdates, settlementDelta, checkinEvidence } = require(join(here, "..", "pin-dispute.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

/** คืนคู่ path ที่ซ้อนกัน (ว่าง = ปลอดภัย) */
function ancestorOverlaps(updates) {
  const keys = Object.keys(updates);
  const bad = [];
  for (const x of keys) for (const y of keys) {
    if (x !== y && y.startsWith(`${x}/`)) bad.push([x, y]);
  }
  return bad;
}

const base = {
  jobId: "J1",
  job: { model: 'MacBook Air 13"', ref_no: "OID-MTHBWFJJ-384", rider_fee_status: "Paid" },
  dispute: { requested_by_rider_id: "R1", checkin: { lat: 13.7, lng: 100.5 } },
  reviewer: { reviewed_at: 2, reviewed_by_name: "CEO" },
  meta: { distance_km: 3.2 },
  now: 2,
  txKey: "TX1",
};

// --- เคสจริงที่พัง: จ่ายไปแล้ว 290 คิดใหม่ได้ 150 ---
const lower = settlementDelta(290, 150, true);
const uLower = buildApprovalUpdates({
  ...base, result: { fee: 150, distance_km: 3.2 }, feeBefore: 290, delta: lower.delta, ledger: lower.ledger,
});
check("จ่ายแล้ว/ลดลง: ไม่มี path ซ้อนกัน", ancestorOverlaps(uLower).length === 0);
check("จ่ายแล้ว/ลดลง: ลงแถว DEBIT PENALTY ส่วนต่าง 140", uLower["transactions/TX1"]?.type === "DEBIT" && uLower["transactions/TX1"]?.amount === 140);
check("delta_tx_id อยู่ในก้อน pin_dispute", uLower["jobs/J1/pin_dispute"]?.delta_tx_id === "TX1");
check("ไม่มี path แยกของ delta_tx_id", uLower["jobs/J1/pin_dispute/delta_tx_id"] === undefined);
check("จ่ายแล้วห้ามดึง rider_fee_status กลับเป็น Pending", uLower["jobs/J1/rider_fee_status"] === undefined);
check("เขียนค่าวิ่งใหม่ลงงาน", uLower["jobs/J1/rider_fee"] === 150);

// --- จ่ายแล้วและเพิ่มขึ้น ---
const higher = settlementDelta(150, 290, true);
const uHigher = buildApprovalUpdates({
  ...base, result: { fee: 290, distance_km: 38 }, feeBefore: 150, delta: higher.delta, ledger: higher.ledger,
});
check("จ่ายแล้ว/เพิ่มขึ้น: ไม่มี path ซ้อนกัน", ancestorOverlaps(uHigher).length === 0);
check("จ่ายแล้ว/เพิ่มขึ้น: ลงแถว CREDIT JOB_PAYOUT", uHigher["transactions/TX1"]?.type === "CREDIT" && uHigher["transactions/TX1"]?.category === "JOB_PAYOUT");

// --- ยังไม่จ่าย ---
const unsettled = settlementDelta(290, 150, false);
const uNew = buildApprovalUpdates({
  ...base, job: { model: "X" }, result: { fee: 150, distance_km: 3.2 }, feeBefore: 290,
  delta: unsettled.delta, ledger: unsettled.ledger,
});
check("ยังไม่จ่าย: ไม่มี path ซ้อนกัน", ancestorOverlaps(uNew).length === 0);
check("ยังไม่จ่าย: ไม่แตะ ledger", uNew["transactions/TX1"] === undefined);
check("ยังไม่จ่าย: ตั้งคิว settlement ให้", uNew["jobs/J1/rider_fee_status"] === "Pending");

// --- injection: ถ้าใครเขียน delta_tx_id กลับเป็น path แยก ด่านต้องจับได้ ---
check(
  "injection: path แยกของ delta_tx_id ต้องถูกจับ",
  ancestorOverlaps({ ...uLower, "jobs/J1/pin_dispute/delta_tx_id": "TX1" }).length === 1
);

// --- หลักฐานการแย้ง ---
check("ไม่มีพิกัดเช็คอิน = แย้งไม่ได้", checkinEvidence({ checkpoints: { rider_arrived: { at: 1 } } }) === null);
check("lat เป็น null ต้องไม่กลายเป็น 0", checkinEvidence({ checkpoints: { rider_arrived: { lat: null, lng: 100 } } }) === null);

console.log(failures === 0 ? "\nOK — pin-dispute" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
