// src/utils/riderSettlement.ts — กติกาการอ่านค่ารอบก่อนจ่ายเงินไรเดอร์ (pure, ฝั่ง UX)
//
// **ตั้งแต่ 5 ก.ย. 2569 ไฟล์นี้ไม่สร้าง update ที่เขียนเงินอีกแล้ว** —
// `buildRiderFeeApproval` ย้ายไป `functions/rider-fee-guard.js` และถูกเรียกผ่าน
// callable `adminRiderFeeApprove` (`src/utils/riderFeeAdmin.ts`) เพราะด่านที่อยู่ใน
// เบราว์เซอร์ข้ามได้ด้วย console หนึ่งบรรทัด (rules อนุญาตให้ admin เขียน /transactions
// ทุกรูป) ด่านจริงต้องอยู่ฝั่ง server. สิ่งที่เหลือที่นี่คือกติกา**การแสดงผล**: ใบไหน
// ติ๊กได้ ใบไหนขึ้นป้ายอะไร — server ตัดสินซ้ำเองทุกครั้ง
//
// ด่าน OWNER/ไม่มีไรเดอร์ที่นี่เป็น MIRROR ของ `riderFeeBlockReason` ใน
// functions/rider-fee-guard.js (parity test: src/utils/riderSettlement.test.ts รัน JS
// ตัวจริงบน fixture เดียวกัน) — แก้ฝั่งไหนต้องแก้ทั้งคู่

// ค่ารอบที่จ่ายได้ = ตัวเลขที่ `onJobHandedOverCalcRiderFee` ประทับไว้บนงานเท่านั้น
//
// เดิมทุกจุดที่นี่เขียน `job.rider_fee || 150` ซึ่งแปลว่า "งานที่ระบบยังคำนวณ
// ค่ารอบไม่เสร็จ (หรือคำนวณไม่สำเร็จ) จะถูกจ่าย 150 บาท" โดยที่ 150 ไม่ใช่
// ตัวเลขที่มาจากงานใบนั้นเลย — มันคือเลขที่แต่งขึ้น
//
// คืน null เมื่อยังไม่มีค่ารอบ — คนเรียกต้องตัดสินใจว่าจะทำอย่างไร ห้ามเดา
export const settledRiderFee = (job: any): number | null => {
  const fee = Number(job?.rider_fee);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
};

export type RiderFeeBlockReason = 'no_rider' | 'owner_rider';

/** ใครทำงานใบนี้ — rider_id หรือ cancelled_by รูป `rider:{id}` (งานที่ยกเลิกล้าง rider_id) */
export const payoutRiderIdOf = (job: any): string | null => {
  if (!job) return null;
  if (typeof job.rider_id === 'string' && job.rider_id.trim()) return job.rider_id.trim();
  if (typeof job.cancelled_by === 'string' && job.cancelled_by.startsWith('rider:')) {
    const id = job.cancelled_by.slice('rider:'.length).trim();
    return id || null;
  }
  return null;
};

/**
 * เหตุผลที่ห้ามจ่ายค่ารอบใบนี้ — `'no_rider' | 'owner_rider' | null`
 * null = ด่านผ่าน (ไม่ได้แปลว่าจ่ายได้ ดู settledRiderFee/สถานะต่างหาก)
 */
export const riderFeeBlockReason = (
  job: any,
  ownerRiderIds: ReadonlySet<string>,
): RiderFeeBlockReason | null => {
  const riderId = payoutRiderIdOf(job);
  if (!riderId) return 'no_rider';
  if (ownerRiderIds.has(riderId)) return 'owner_rider';
  return null;
};

export const RIDER_FEE_BLOCK_LABEL: Record<RiderFeeBlockReason, string> = {
  no_rider: 'ไม่มีไรเดอร์',
  owner_rider: 'บัญชีเจ้าของ',
};
