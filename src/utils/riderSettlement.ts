// src/utils/riderSettlement.ts — กติกาการอ่านค่ารอบก่อนจ่ายเงินไรเดอร์ (pure)
//
// แยกออกจาก RiderSettlements.tsx เพื่อให้เทสได้โดยไม่ต้อง init Firebase app

// ค่ารอบที่จ่ายได้ = ตัวเลขที่ `onJobHandedOverCalcRiderFee` ประทับไว้บนงานเท่านั้น
//
// เดิมทุกจุดที่นี่เขียน `job.rider_fee || 150` ซึ่งแปลว่า "งานที่ระบบยังคำนวณ
// ค่ารอบไม่เสร็จ (หรือคำนวณไม่สำเร็จ) จะถูกจ่าย 150 บาท" โดยที่ 150 ไม่ใช่
// ตัวเลขที่มาจากงานใบนั้นเลย — ไม่ใช่ระยะทางจริง ไม่ใช่ `min_fee` ของการ์ด
// อัตรา (ค่าเริ่มต้น 100 ที่ settings/logistics_rates ซึ่งเป็นเลขที่
// computeRiderFee คืนจริงเมื่อหาระยะทางไม่ได้) มันคือเลขที่แต่งขึ้น
//
// หน้าอนุมัติจ่ายค่ารอบเขียน transactions CREDIT เข้ากระเป๋าไรเดอร์จริง การมีค่า default
// จึงไม่ใช่เรื่องการแสดงผล แต่คือการจ่ายเงินจากตัวเลขที่ไม่มีใครคำนวณ
//
// คืน null เมื่อยังไม่มีค่ารอบ — คนเรียกต้องตัดสินใจว่าจะทำอย่างไร ห้ามเดา
export const settledRiderFee = (job: any): number | null => {
  const fee = Number(job?.rider_fee);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
};

// ─── การอนุมัติค่ารอบ ────────────────────────────────────────────────────────
//
// การเขียนชุดนี้ถูกแยกออกมาเป็นฟังก์ชัน pure เพราะมันจะถูกเรียกจากสองที่ระหว่าง
// การย้ายเจ้าของขั้นตอน (ใบตรวจงานไรเดอร์รับช่วงจากหน้าการเงิน) และเพราะมัน
// **สร้างเงินเข้ากระเป๋าคน** — โค้ดแบบนั้นควรมีเทสยิงตรงได้ ไม่ใช่ฝังอยู่ใน
// event handler ที่ลาก firebase เข้ามาจนเทสเอื้อมไม่ถึง
//
// รูปของ updates ต้องเหมือนเดิมเป๊ะ: multi-path atomic ที่เขียน jobs กับ
// transactions พร้อมกัน — เขียนแยกกันเมื่อไหร่ งานจะขึ้น Paid โดยไม่มีเงินเข้า
// กระเป๋าได้ (ซึ่งเป็นบั๊กที่ SettlementPage.tsx ตัวเก่าถือไว้จริงก่อนถูกลบ)

export interface RiderFeeApprovalInput {
  job: any;
  /** คีย์ที่ผู้เรียกจองมาจาก push() — ส่งเข้ามาเพื่อให้ฟังก์ชันนี้ยัง pure */
  txKey: string;
  now: number;
  /** ใครเป็นคนอนุมัติ — เก็บไว้เพื่อให้ย้อนดูได้ว่าใครรับรองงานใบนี้ */
  approvedBy?: string | null;
  /** ต่อท้ายคำอธิบายรายการ เช่น `[Batch]` */
  note?: string;
}

/**
 * updates สำหรับอนุมัติค่ารอบหนึ่งใบ — คืน null เมื่อจ่ายไม่ได้
 *
 * จ่ายไม่ได้ = ไม่มีค่ารอบที่ระบบประทับไว้ (`settledRiderFee` คืน null) ซึ่ง
 * ต่างจาก "ค่ารอบเป็นศูนย์" โดยสิ้นเชิง — ตัวแรกคือระบบยังไม่ได้คำนวณ
 */
export function buildRiderFeeApproval(input: RiderFeeApprovalInput): Record<string, any> | null {
  const { job, txKey, now, approvedBy, note } = input;
  const fee = settledRiderFee(job);
  if (fee === null || !job?.id || !txKey) return null;
  if (job.rider_fee_status === 'Paid') return null; // กันจ่ายซ้ำ

  // ไรเดอร์ที่ทำงานใบนี้ — งานที่ถูกยกเลิกล้าง rider_id ทิ้ง แต่ยังมีค่ารอบ
  // ค้างได้ (ค่าเสียเวลา) จึงตกไปอ่าน cancelled_by ซึ่งเก็บรูป `rider:{id}`
  const riderId =
    (typeof job.rider_id === 'string' && job.rider_id) ||
    (typeof job.cancelled_by === 'string' && job.cancelled_by.startsWith('rider:')
      ? job.cancelled_by.slice('rider:'.length)
      : null);
  if (!riderId) return null;

  const updates: Record<string, any> = {};
  updates[`jobs/${job.id}/rider_fee_status`] = 'Paid';
  updates[`jobs/${job.id}/settled_at`] = now;
  if (approvedBy) updates[`jobs/${job.id}/rider_fee_approved_by`] = approvedBy;
  updates[`transactions/${txKey}`] = {
    rider_id: riderId,
    amount: fee,
    type: 'CREDIT',
    category: 'JOB_PAYOUT',
    description: `ค่าเที่ยวงาน ${job.model || 'Unknown'} (${job.ref_no || '-'})${note ? ` ${note}` : ''}`,
    timestamp: now,
    ref_job_id: job.id,
  };
  return updates;
}
