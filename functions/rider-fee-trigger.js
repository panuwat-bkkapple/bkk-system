// ตัวตัดสินของ onJobHandedOverCalcRiderFee: สถานะไหนทำให้ต้องคิดค่ารอบไรเดอร์
//
// ทางหลัก = ไรเดอร์ส่งมอบเครื่องที่สาขา (Pending QC). ตาข่ายกันตก = งาน Pickup
// ที่แอดมินข้ามขั้นส่งมอบไปเข้าแล็บ/เข้าคลังตรง — ต้องคิดค่ารอบให้อยู่ดี ไม่งั้น
// ไรเดอร์ไม่ได้เงินเพราะมีคนกดข้ามขั้นหนึ่งปุ่ม
//
// **ทำไมต้อง normalize (4 ก.ย. 2569):** ลิสต์เดิมใน index.js เป็น literal
// `["Pending QC", "Sent to QC Lab", "In Stock"]` — สะกดเก่าของ Sent to QC Lab
// ตัวเดียว ขณะที่ engine เขียน 'Sent To QC Lab' ให้ทุก transition ตั้งแต่ P2
// ตาข่ายจึงตายเงียบสำหรับทุกงานที่ผ่าน engine โดยไม่มี error (ทางหลัก Pending QC
// สะกดเดียวกับ enum จึงไม่มีใครเห็น จนกว่าจะเกิดเคสข้ามขั้นจริง). รายงาน:
// docs/reports/2026-09-04-status-literal-compare-survey-cross-repo.md ข้อ 1
//
// pure โดยตั้งใจ — index.js init firebase-functions ตอน require เทสจากที่นั่นไม่ได้
const { JOB_STATUS, normalizeStatus } = require("./status-vocab.generated");

/** สถานะที่ทำให้คิดค่ารอบ (canonical) — ทางหลักตัวแรก ที่เหลือคือตาข่าย */
const FEE_TRIGGER_CANONICAL = [
  JOB_STATUS.PENDING_QC,
  JOB_STATUS.SENT_TO_QC_LAB,
  JOB_STATUS.IN_STOCK,
];

/** canonical ของสถานะที่เขียนมา — สะกดใดก็ได้ ค่าที่อ่านไม่ออกคืน null */
function canonicalOf(status, receiveMethod) {
  if (typeof status !== "string" || !status) return null;
  return normalizeStatus(status, receiveMethod || null);
}

/** สถานะนี้ (สะกดใดก็ได้) อยู่ในเซ็ตที่ต้องคิดค่ารอบไหม */
function isFeeTriggerStatus(status, receiveMethod) {
  const canonical = canonicalOf(status, receiveMethod);
  return !!canonical && FEE_TRIGGER_CANONICAL.includes(canonical);
}

/** เข้ามาทางตาข่าย (ไม่ใช่ทางส่งมอบ Pending QC) ไหม — ถามหลัง isFeeTriggerStatus แล้วเท่านั้น */
function isSafetyNetEntry(status, receiveMethod) {
  return canonicalOf(status, receiveMethod) !== JOB_STATUS.PENDING_QC;
}

/**
 * เหตุผลที่ห้ามคิดค่ารอบให้งานนี้เลย — `'not_pickup' | 'no_rider' | null`
 *
 * ใช้กับ**ทั้งสองทางเข้า**ของ onJobHandedOverCalcRiderFee (ทางหลัก Pending QC และ
 * ตาข่าย). ก่อน 5 ก.ย. 2569 สองด่านนี้อยู่เฉพาะในบล็อกตาข่าย ทางหลักจึงคิดค่ารอบ
 * ขั้นต่ำให้งาน Store-in/Mail-in ที่เข้า Pending QC (computeRiderFee ไม่มีทางคืน
 * "ไม่มีค่ารอบ" — ไม่มีพิกัดลูกค้าก็คืน min_fee) แล้วตั้ง Pending ให้ใบที่ไม่มีใครให้จ่าย
 * 26 ใบไปนั่งในคิวอนุมัติ (docs/reports/2026-09-05-owner-rider-wallet-reversal-survey.md A4)
 *
 * ด่านคือ "ไรเดอร์ไปรับ" (receive_method Pickup) + "มีไรเดอร์ถืองาน" (rider_id ไม่ว่าง)
 * ไม่ผ่าน = ไม่คำนวณ ไม่ตั้ง rider_fee_status ใดๆ
 */
function feeCalcBlockReason(job) {
  if (!job || job.receive_method !== "Pickup") return "not_pickup";
  if (typeof job.rider_id !== "string" || !job.rider_id.trim()) return "no_rider";
  return null;
}

module.exports = { FEE_TRIGGER_CANONICAL, isFeeTriggerStatus, isSafetyNetEntry, feeCalcBlockReason };
