"use strict";

/**
 * ค่าของ `jobs/{id}/rider_fee_status` — ที่เดียวที่ประกาศ (ฝั่ง functions)
 *
 * MIRROR 3 ที่ (parity test อ่านไฟล์นี้เป็นตัวอักษร):
 *   - `src/types/riderFeeStatus.ts` (แอปแอดมิน)
 *   - `bkk-rider-app/src/types/riderFeeStatus.ts` (แอปไรเดอร์)
 *
 * ก่อน 5 ก.ย. 2569 ฟิลด์นี้ไม่มี enum ที่ไหนเลย — ทุกจุดเทียบสตริง 'Pending'/'Paid'
 * ดิบๆ และแอปไรเดอร์เขียน 'Pending' ทับทุกครั้งที่ส่งมอบ การเพิ่ม 'Waived' จึงต้อง
 * มาพร้อมกฎว่า **Paid กับ Waived เป็นปลายทาง ห้ามใครเขียน Pending ทับ**
 *
 *   Pending = ค่ารอบคำนวณแล้ว รออนุมัติเข้ากระเป๋า
 *   Paid    = อนุมัติแล้ว มีแถว JOB_PAYOUT ในกระเป๋า
 *   Waived  = ตัดสินใจไม่จ่าย (บัญชีเจ้าของ / ไม่มีไรเดอร์ / เหตุผลอื่นที่ระบุ)
 *             ไม่มีแถวในกระเป๋า `rider_fee` ยังอยู่เพื่อให้ย้อนดูได้ว่าเคยคิดเท่าไร
 */
// ลำดับต้องตรงกับสำเนา TS ทั้งสอง (parity test เทียบ values ตามลำดับ) — PAID อยู่ท้าย
const RIDER_FEE_STATUS = Object.freeze({
  PENDING: "Pending",
  WAIVED: "Waived",
  PAID: "Paid",
});

const RIDER_FEE_STATUS_VALUES = Object.freeze(Object.values(RIDER_FEE_STATUS));

/** ปลายทาง — ตัวเขียน Pending (ส่งมอบ / trigger / แย้งหมุด) ต้องไม่ทับ */
const TERMINAL_RIDER_FEE_STATUSES = Object.freeze([RIDER_FEE_STATUS.PAID, RIDER_FEE_STATUS.WAIVED]);

function isTerminalRiderFeeStatus(value) {
  return TERMINAL_RIDER_FEE_STATUSES.includes(value);
}

/**
 * patch ที่ตัวเขียน "Pending" ควรใช้ — คืน {} เมื่อสถานะปัจจุบันเป็นปลายทาง
 * (หรือเป็น Pending อยู่แล้ว) มิฉะนั้นคืน { rider_fee_status: 'Pending' }
 */
function pendingFeeStatusPatch(current) {
  if (isTerminalRiderFeeStatus(current) || current === RIDER_FEE_STATUS.PENDING) return {};
  return { rider_fee_status: RIDER_FEE_STATUS.PENDING };
}

module.exports = {
  RIDER_FEE_STATUS,
  RIDER_FEE_STATUS_VALUES,
  TERMINAL_RIDER_FEE_STATUSES,
  isTerminalRiderFeeStatus,
  pendingFeeStatusPatch,
};
