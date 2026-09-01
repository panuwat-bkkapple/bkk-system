/**
 * "ไรเดอร์ทิ้งงานใบนี้ไปหรือเปล่า" — นิยามเดียวของสัญญาณนี้
 *
 * แอดมินใช้มันตัดสินสองอย่าง: ขึ้นปุ่ม "ส่งให้ไรเดอร์ใหม่ (Re-broadcast)"
 * แทนปุ่ม dispatch ปกติ และขึ้นแบนเนอร์เตือนว่างานนี้เคยมีไรเดอร์แล้วหลุด
 *
 * มีสองรูปเพราะกำลังเปลี่ยนผ่าน:
 *
 *   เดิม  ไคลเอนต์ไรเดอร์เขียน cancelled_at + cancelled_by: "rider:{uid}"
 *         ปนกับ cancel taxonomy ของการยกเลิกจริง
 *   ใหม่  engine ประทับ withdrawn_at + withdrawn_by ตอน rider_withdrew
 *
 * ทำไมต้องแยกฟิลด์ ไม่ใช่แค่เรื่องความสะอาด: งานที่ไรเดอร์ทิ้งยัง **วิ่งอยู่**
 * (สถานะ Following Up) แต่ถือ cancelled_at ค้างไว้ ถ้าวันหนึ่งแอดมินยกเลิกงาน
 * นั้นจริงผ่านทางที่ไม่ได้เขียน cancelled_at ทับ finalizeCancelledJobs จะเห็น
 * เวลาเก่าหลายสัปดาห์แล้วปิดงานทันที แทนที่จะเปิดช่อง 7 วันให้ลูกค้ากลับมา
 *
 * อ่านทั้งสองรูปตราบใดที่ยังมีงานยุคเก่าค้างอยู่ — ตัดรูปเดิมออกได้เมื่อไม่มี
 * งานไหนถือ cancelled_by ขึ้นต้น "rider:" อีกแล้ว
 */

interface WithdrawalFields {
  withdrawn_at?: number | null;
  withdrawn_by?: string | null;
  cancelled_at?: number | null;
  cancelled_by?: string | null;
}

const byARider = (by: unknown): boolean => String(by || '').startsWith('rider:');

export function wasRiderWithdrawn(job: WithdrawalFields | null | undefined): boolean {
  if (!job) return false;
  if (job.withdrawn_at && byARider(job.withdrawn_by)) return true;
  // รูปเดิม: ต้องเช็ค cancelled_by ด้วย ไม่ใช่แค่ cancelled_at — งานที่ลูกค้า
  // หรือแอดมินยกเลิกก็มี cancelled_at เหมือนกัน แต่ไม่ใช่การทิ้งงานของไรเดอร์
  return Boolean(job.cancelled_at && byARider(job.cancelled_by));
}

/** เวลาที่ไรเดอร์ทิ้งงานครั้งล่าสุด — null เมื่อไม่เคยถูกทิ้ง */
export function riderWithdrawnAt(job: WithdrawalFields | null | undefined): number | null {
  if (!wasRiderWithdrawn(job)) return null;
  return (job?.withdrawn_at ?? job?.cancelled_at) || null;
}
