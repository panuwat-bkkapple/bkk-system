// บันทึกกิจกรรมลง qc_logs โดย **ไม่แตะสถานะ**
//
// ที่มา: หน้า B2B มีสามปุ่มที่เรียก `onUpdateStatus(job.id, job.status, ...)` —
// ส่ง *สถานะเดิม* กลับเข้าไปเพื่อจะได้แถวใน qc_logs เท่านั้น (บันทึกโน้ตการโทร,
// แก้ข้อมูลบริษัท, ปรับราคาระหว่างเจรจา) ทั้งสามไม่ใช่ transition เลยสักตัว
//
// ทำไมมันไม่ใช่แค่เรื่องสำนวน:
//   1. มันเขียน `status` ทับด้วยค่าที่ไคลเอนต์อ่านมาจาก React tree — ถ้าอีก
//      หน้าจอเพิ่งเปลี่ยนสถานะไป การ "บันทึกโน้ต" จะย้อนสถานะกลับเงียบๆ
//   2. มันนับเป็นตัวเขียนสถานะตรงในสำมะโน ทั้งที่เจตนาไม่ได้จะเปลี่ยนอะไร
//
// **ไม่ใช่ transition และห้ามทำให้เป็น** — engine ไม่มี event ที่ปลายทางเท่ากับ
// ต้นทาง และไม่ควรมี: status_history ที่มีแถว "ไม่มีอะไรเกิดขึ้น" คือไทม์ไลน์
// ที่อ่านยากขึ้นโดยไม่ได้ข้อมูลเพิ่ม
//
// ข้อจำกัดที่รับไว้: read-modify-write ของ array ตัวเดียวกับที่ engine เขียน
// สองฝั่งชนกันได้ถ้ากดพร้อมกันเป๊ะๆ — เป็นข้อจำกัดเดิมของ PricingSidebar และ
// QCStation ที่เขียน qc_logs แบบเดียวกันมาตลอด ไม่ได้แย่ลงจากเดิม
import { ref, update } from 'firebase/database';
import { db } from '../api/firebase';

export interface JobLogEntry {
  action: string;
  details: string;
  by: string;
  timestamp: number;
}

/** สร้างแถวใหม่ไว้หัวลิสต์ — pure แยกจากตัวเขียนเพื่อให้เทสได้โดยไม่ต้องมี DB */
export function withNewLogEntry(
  existing: unknown,
  entry: JobLogEntry
): JobLogEntry[] {
  const rows = Array.isArray(existing) ? (existing as JobLogEntry[]) : [];
  return [entry, ...rows];
}

/**
 * @param patch ฟิลด์อื่นที่ไปพร้อมกัน (ข้อมูลบริษัท, ราคาที่เจรจาใหม่) — ไปใน
 *   write เดียวกับ log เสมอ ไม่ใช่ write ที่สองที่อาจสำเร็จครึ่งเดียว
 *   **ห้ามใส่ `status`** ตัวนั้นเป็นของ engine ผ่าน runJobTransition เท่านั้น
 */
export async function appendJobActivityLog(
  job: { id: string; qc_logs?: unknown },
  action: string,
  details: string,
  by: string,
  patch: Record<string, unknown> = {}
): Promise<void> {
  if ('status' in patch) {
    throw new Error('appendJobActivityLog: status เป็นของ status engine ใช้ runJobTransition');
  }
  await update(ref(db, `jobs/${job.id}`), {
    ...patch,
    qc_logs: withNewLogEntry(job.qc_logs, { action, details, by, timestamp: Date.now() }),
    updated_at: Date.now(),
  });
}
