// ค่าของ `jobs/{id}/rider_fee_status` — ที่เดียวที่ประกาศ (แอปแอดมิน)
//
// MIRROR 3 ที่ ต้องตรงกันเป็นตัวอักษร (ด่าน: src/utils/riderFeeStatusParity.test.ts
// อ่านสองไฟล์ที่เหลือมาเทียบ):
//   - functions/rider-fee-status.js (ตัวที่ callable/trigger ใช้จริง)
//   - bkk-rider-app/src/types/riderFeeStatus.ts (แอปไรเดอร์ — ตัวเขียน 'Pending'
//     ตอนส่งมอบ ซึ่งต้องไม่ทับปลายทาง)
//
// ก่อน 5 ก.ย. 2569 ฟิลด์นี้ไม่มี enum ที่ไหนเลย ทุกจุดเทียบสตริงดิบ
//
//   Pending = ค่ารอบคำนวณแล้ว รออนุมัติเข้ากระเป๋า
//   Paid    = อนุมัติแล้ว มีแถว JOB_PAYOUT ในกระเป๋า
//   Waived  = ตัดสินใจไม่จ่าย (บัญชีเจ้าของ / ไม่มีไรเดอร์ / เหตุผลที่ระบุ)
//             ไม่มีแถวในกระเป๋า `rider_fee` ยังอยู่ให้ย้อนดูว่าเคยคิดเท่าไร
export const RIDER_FEE_STATUS = {
  PENDING: 'Pending',
  PAID: 'Paid',
  WAIVED: 'Waived',
} as const;

export type RiderFeeStatus = (typeof RIDER_FEE_STATUS)[keyof typeof RIDER_FEE_STATUS];

export const RIDER_FEE_STATUS_VALUES: readonly RiderFeeStatus[] = Object.values(RIDER_FEE_STATUS);

/** ปลายทาง — ตัวเขียน Pending (ส่งมอบ / trigger / แย้งหมุด) ต้องไม่ทับ */
export const TERMINAL_RIDER_FEE_STATUSES: readonly RiderFeeStatus[] = [
  RIDER_FEE_STATUS.PAID,
  RIDER_FEE_STATUS.WAIVED,
];

export const isTerminalRiderFeeStatus = (value: unknown): boolean =>
  TERMINAL_RIDER_FEE_STATUSES.includes(value as RiderFeeStatus);
