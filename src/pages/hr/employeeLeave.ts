// การแสดงผลยอดวันลา — ล้วน ไม่มี firebase (EmployeeRegister.tsx import firebase
// ตอนโหลดโมดูล จึงเรนเดอร์ในเทสไม่ได้ ดูหัวไฟล์ StageTrack.tsx)
//
// กติกาการนับทั้งหมดอยู่ฝั่ง server (`functions/hr-leave.js`) **ไฟล์นี้ไม่คำนวณ
// วันลาซ้ำ** มันแปลงตัวเลขที่ server ส่งมาให้อ่านออกเท่านั้น — สูตรสองชุดที่
// วันหนึ่งจะไม่ตรงกันคือสิ่งที่ทำให้คนเชื่อตัวเลขบนจอมากกว่าตัวเลขที่บันทึกไว้

export interface LeaveBalance {
  type: string;
  label: string;
  basis: string | null;
  counts: string;
  entitled_paid_days: number | null;
  used_paid_days: number;
  used_unpaid_days: number;
  pending_days: number;
  remaining_paid_days: number | null;
  locked: string | null;
  service_state: string | null;
}

export interface LeaveRequestRow {
  id: string;
  type: string;
  from: string;
  to: string;
  days: number;
  paid_days: number;
  unpaid_days: number;
  status: string;
  reason: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

/**
 * ข้อความยอดคงเหลือหนึ่งบรรทัด
 *
 * สามเคสที่ต้องพูดคนละอย่าง และการยุบเข้าด้วยกันคือการโกหก:
 *   - ล็อกเพราะยังไม่ครบปี = **ยังไม่มีสิทธิ์** ไม่ใช่ "ใช้หมดแล้ว"
 *   - ไม่มีเพดาน (ลาป่วย/ลาทำหมัน) = บอกว่าใช้ไปเท่าไร ไม่ใช่เหลือเท่าไร
 *     เพราะ "เหลือ" สื่อว่ามีเพดานการลา ซึ่ง ม.32 บอกว่าไม่มี
 *   - มีเพดาน = เหลือเท่าไร
 */
export function balanceText(b: LeaveBalance): string {
  if (b.locked === 'service') return 'ยังไม่มีสิทธิ์ (ต้องทำงานครบ 1 ปี)';
  if (b.entitled_paid_days == null) {
    return `ใช้สิทธิ์ที่ได้ค่าจ้างไปแล้ว ${b.used_paid_days} วัน (ไม่มีเพดาน)`;
  }
  return `เหลือ ${b.remaining_paid_days} จาก ${b.entitled_paid_days} วัน`;
}

/**
 * ยอดที่ต้องเน้นให้เห็น — ใช้สิทธิ์หมดแล้ว หรือมีวันที่ไม่ได้ค่าจ้าง
 *
 * `locked` **ไม่ใช่เรื่องต้องเน้น** — คนเพิ่งเข้างานยังไม่มีสิทธิ์ลาพักร้อน
 * เป็นเรื่องปกติ ไม่ใช่ปัญหาที่ใครต้องไปทำอะไร
 */
export function needsAttention(b: LeaveBalance): boolean {
  if (b.locked) return false;
  if (b.used_unpaid_days > 0) return true;
  if (b.entitled_paid_days != null && b.remaining_paid_days === 0 && b.used_paid_days > 0) return true;
  return false;
}

/** ยอดรวมที่หัวโมดอล — นับเฉพาะใบที่อนุมัติแล้วและที่ยังรอ แยกกัน */
export function leaveSummary(requests: LeaveRequestRow[]) {
  const rows = Array.isArray(requests) ? requests : [];
  const approved = rows.filter((r) => r.status === 'approved');
  return {
    approved_days: approved.reduce((s, r) => s + (Number(r.days) || 0), 0),
    unpaid_days: approved.reduce((s, r) => s + (Number(r.unpaid_days) || 0), 0),
    pending: rows.filter((r) => r.status === 'pending').length,
  };
}

/** ป้ายสีตามสถานะใบลา */
export function statusTone(status: string): string {
  if (status === 'approved') return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (status === 'rejected') return 'text-rose-700 bg-rose-50 border-rose-100';
  if (status === 'cancelled') return 'text-gray-500 bg-gray-50 border-gray-200';
  return 'text-amber-700 bg-amber-50 border-amber-100';
}

/**
 * วันที่แบบไทย (YYYY-MM-DD) จาก epoch ms
 *
 * ไทยเป็น UTC+7 ตลอดปี ไม่มี DST — บวกออฟเซ็ตแล้วอ่านเป็น UTC จึงถูกเสมอ
 * ส่วน `toISOString().slice(0,10)` เปล่าๆ **ผิดได้หนึ่งวัน** สำหรับเวลาก่อน
 * 07:00 ตามเวลาไทย ซึ่งพอดีกับขอบของรอบจ่ายที่มักตั้งไว้เที่ยงคืน
 */
export function bangkokIsoDate(ms: number | null | undefined): string {
  // `Number(null) === 0` และ 0 เป็น finite — เช็ค `Number.isFinite` อย่างเดียว
  // จะคืนวันที่ปี 1970 ให้กับค่าว่าง (กับดักตัวเดียวกับที่ CLAUDE.md จดไว้ใน
  // เรื่อง `pickBatteryOptionId`) จึงต้องกัน null/undefined แยกก่อน
  if (ms == null) return '';
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  return new Date(n + 7 * 3600000).toISOString().slice(0, 10);
}
