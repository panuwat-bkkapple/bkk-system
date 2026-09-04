// คำศัพท์และการจัดรูปของหน้าประวัติพนักงาน — ล้วน มีเทส
//
// **ไม่คำนวณประวัติซ้ำ** — ตัวเลขทุกตัวมาจาก `functions/employee-history.js`
// ไฟล์นี้แปลงให้อ่านออกเท่านั้น สูตรสองชุดคือของที่วันหนึ่งจะไม่ตรงกัน

export interface SalaryRow {
  at: number;
  from: number | null;
  to: number | null;
  pct: number | null;
  by_name: string | null;
  reason: string | null;
  withheld: boolean;
}

export interface PositionRow {
  position: string;
  from: number | null;
  to: number | null;
  days: number | null;
  current: boolean;
}

export interface StatusRow {
  at: number;
  from: string | null;
  to: string | null;
  by_name: string | null;
}

export interface LeaveYearRow {
  year: string;
  days: number;
  paid_days: number;
  unpaid_days: number;
  by_type: Record<string, number>;
}

export interface EmployeeHistoryData {
  summary: {
    tenure_days: number | null;
    tenure_text: string | null;
    tenure_ended: boolean;
    position: string | null;
    department: string | null;
    status: string | null;
    hired_at: number | null;
    terminated_at: number | null;
  };
  positions: PositionRow[];
  statuses: StatusRow[];
  /** `null` = ผู้เรียกไม่มีสิทธิ์ดูเงินเดือน (ท่อนนี้ถูกตัดฝั่ง server) */
  salary: SalaryRow[] | null;
  leave_by_year: LeaveYearRow[];
  documents: { id: string; type: string | null; number: string | null; issued_at: number | null }[];
}

export const STATUS_LABEL: Record<string, string> = {
  hired: 'เริ่มงาน',
  probation: 'ทดลองงาน',
  active: 'ทำงานอยู่',
  resigned: 'ลาออก',
  terminated: 'เลิกจ้าง',
};

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  annual: 'พักร้อน',
  maternity: 'ลาคลอด',
  sterilization: 'ลาทำหมัน',
  military: 'ลาทหาร',
  training: 'ลาอบรม',
  unpaid: 'ลาไม่รับค่าจ้าง',
};

/**
 * ข้อความเปอร์เซ็นต์ที่เงินเดือนขยับ
 *
 * **ต้องมีเครื่องหมายเสมอ** — "20%" อ่านไม่ออกว่าขึ้นหรือลง และการปรับลด
 * เงินเดือนเป็นเรื่องที่ต้องเห็นชัดที่สุดในหน้านี้
 */
export function salaryDeltaText(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '';
  if (pct === 0) return 'เท่าเดิม';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** ช่วงเวลาที่อยู่ตำแหน่งนั้น */
export function positionRangeText(p: PositionRow): string {
  const days = p.days;
  const span = days === null
    ? ''
    : days >= 365
      ? `${Math.floor(days / 365)} ปี`
      : days >= 30
        ? `${Math.floor(days / 30)} เดือน`
        : `${days} วัน`;
  if (p.current) return span ? `${span} · ปัจจุบัน` : 'ปัจจุบัน';
  return span;
}
