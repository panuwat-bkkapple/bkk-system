// สายเรียก callable ทั้งหมดของแอปพนักงาน + รูปข้อมูลที่ server ส่งมา
//
// **ทุกตัวไม่ส่ง employeeId** — ตัวตนมาจาก auth token ฝั่ง server เสมอ
// (ดู `requireEmployeeCaller`) การส่ง id มาเองคือช่องลงเวลาแทนคนอื่น

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export const call = async <T>(name: string, data?: unknown): Promise<T> => {
  const fn = httpsCallable(functions, name);
  const res = await fn(data ?? {});
  return res.data as T;
};

/** ข้อความ error ที่อ่านออก — callable โยน `functions/xxx` มาพร้อม message ไทย */
export const errorText = (e: unknown): string => {
  const m = (e as { message?: string })?.message;
  if (!m) return 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
  return m.replace(/^([A-Z_]+:\s*)/, '');
};

export interface AttendanceRecord {
  date: string;
  shift_id: string | null;
  shift_label: string | null;
  in_at: number | null;
  in_site_name: string | null;
  in_distance_m: number | null;
  late_min: number | null;
  within_grace: boolean | null;
  out_at: number | null;
  out_site_name: string | null;
  out_outside: boolean | null;
  worked_min: number | null;
  early_min: number | null;
  no_shift: boolean;
  status: 'empty' | 'open' | 'closed';
}

export interface Site { id: string; name: string; lat: number; lng: number }

export interface AttendanceStatus {
  employee: { id: string; name: string | null; employee_code: string | null;
    position: string | null; photo_url: string | null };
  today: string;
  server_now: number;
  shift: { id: string; label: string; start: number; end: number;
    grace_min: number; break_min: number; crosses_midnight: boolean } | null;
  shift_source: 'roster' | 'employee' | 'none';
  attendance_date: string;
  record: AttendanceRecord;
  sites: Site[];
  radius_m: number;
  min_accuracy_m: number;
}

export interface PunchResult {
  ok: boolean;
  code?: string;
  message?: string;
  distance_m?: number | null;
  radius_m?: number | null;
  record?: AttendanceRecord;
}

export interface LeaveRequestRow {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  type: string;
  from: string;
  to: string;
  days: number;
  paid_days: number;
  unpaid_days: number;
  reason: string | null;
  status: string;
  requested_at: number | null;
  decided_at: number | null;
  decided_by_name: string | null;
  decision_note: string | null;
  edited_at?: number | null;
  half_start?: boolean;
  half_end?: boolean;
  attachments?: { id: string; filename: string | null }[];
}

export interface LeaveTypeRow { id: string; label: string; paid_days: number | null; counts: string }

/** ยอดสิทธิ์ลารายชนิด (รูปเดียวกับ `leaveBalances` ใน functions/hr-leave.js)
 *
 * **`entitled_paid_days` คือเพดาน *ค่าจ้าง* ไม่ใช่เพดานวันลา** — ลาป่วยตาม
 * ม.32 ลาได้ตามที่ป่วยจริงไม่จำกัด แต่ได้ค่าจ้างไม่เกิน 30 วัน หน้าจอจึงห้าม
 * เขียนว่า "วันลาคงเหลือ" ลอยๆ กับตัวเลขนี้
 * `null` = ไม่มีเพดานในกฎหมาย (ลาทำหมัน — ตามที่แพทย์กำหนด)
 * `locked: 'service'` = สิทธิ์เป็น 0 เพราะยังไม่ครบอายุงาน **ไม่ใช่เพราะใช้หมด**
 */
export interface LeaveBalanceRow {
  type: string;
  label: string;
  basis?: string | null;
  counts?: string;
  entitled_paid_days: number | null;
  used_paid_days: number;
  used_unpaid_days: number;
  pending_days: number;
  remaining_paid_days: number | null;
  locked: string | null;
  service_state: string | null;
}

export interface ShiftRequestRow {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  date: string;
  from_shift_id: string | null;
  from_shift_label?: string | null;
  to_shift_id: string | null;
  to_shift_label: string | null;
  // ขาสลับกับเพื่อน — ไม่มี = คำขอเปลี่ยนกะเดี่ยวแบบเดิม
  swap_with_employee_id?: string | null;
  swap_with_name?: string | null;
  peer_accepted_at?: number | null;
  requester_id?: string;
  reason: string | null;
  status: string;
  requested_at: number | null;
  decided_at: number | null;
  decided_by_name: string | null;
  decision_note: string | null;
  edited_at?: number | null;
}

export interface ShiftOption { id: string; label: string; start: number; end: number }

export interface SupervisorInbox {
  is_supervisor: boolean;
  reports: { id: string; name: string | null; employee_code: string | null; status: string | null }[];
  leave: LeaveRequestRow[];
  shift: ShiftRequestRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ข้อมูลของฉัน — ตารางกะ · สลิปเงินเดือน · แฟ้มเอกสาร · โปรไฟล์
// (ดู functions/hr-employee-self.js — ทุกตัวอ่านได้เฉพาะของเจ้าตัว)
// ─────────────────────────────────────────────────────────────────────────────

/** หนึ่งวันในตารางกะ — `shift: null` = วันหยุด ไม่ใช่ "ยังไม่รู้" */
export interface RosterDay {
  date: string;
  today: boolean;
  shift: { id: string; label: string; start: number; end: number; crosses_midnight: boolean } | null;
  note: string | null;
  pending_change: { id: string; to_shift_label: string | null; to_shift_id: string | null } | null;
  checked_in: boolean;
  late_min: number | null;
}

export interface RosterRes {
  month: string;
  days: RosterDay[];
  shifts: ShiftOption[];
  default_shift_id: string | null;
}

export interface PayslipBrief {
  period: string;
  status: string | null;
  pay_date: number | null;
  net: number;
  gross: number;
}

export interface PayslipFull extends PayslipBrief {
  period_from: number | null;
  period_to: number | null;
  name: string | null;
  employee_code: string | null;
  pay_method: string | null;
  bank_name: string | null;
  bank_masked: string | null;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  wht: number;
  sso_employee: number;
  days_worked: number | null;
}

export interface EmployeeFileRow {
  id: string;
  kind: string;
  kind_label: string;
  filename: string | null;
  content_type: string | null;
  size: number;
  uploaded_at: number | null;
  by_me: boolean;
}

/** เอกสารที่ HR ออกให้ — คนละแหล่งกับไฟล์ที่อัปโหลด และเปิดคนละทาง */
export interface HrDocumentRow {
  id: string;
  type: string;
  type_label: string;
  number: string | null;
  issued_at: number | null;
}

export interface FileListRes {
  files: EmployeeFileRow[];
  documents: HrDocumentRow[];
  capped: boolean;
  upload_kinds: { id: string; label: string }[];
}

export interface ProfileRes {
  id: string;
  name: string | null;
  employee_code: string | null;
  position: string | null;
  department: string | null;
  branch: string | null;
  photo_url: string | null;
  hired_at: number | null;
  status: string | null;
  supervisor: { name: string | null; position: string | null } | null;
  month: string;
  summary: { worked_days: number; late_days: number; worked_hours: number };
}

/** ผู้สมัครสลับกะ — `blocked` มีค่า = แสดงแต่กดไม่ได้ พร้อมเหตุผล */
export interface SwapCandidate {
  id: string;
  name: string | null;
  employee_code: string | null;
  same_team: boolean;
  shift: ShiftOption | null;
  blocked: string | null;
}

export interface SwapCandidatesRes {
  date: string;
  my_shift: ShiftOption;
  candidates: SwapCandidate[];
}

/** ไฟล์ที่ callable ส่งกลับมาเป็น base64 — แอปแปลงเป็น blob แล้วเปิด */
export interface FilePayload { filename: string; content_type: string; base64: string }
