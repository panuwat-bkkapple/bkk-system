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
}

export interface LeaveTypeRow { id: string; label: string; paid_days: number | null; counts: string }

export interface LeaveBalanceRow {
  type?: string; id?: string; label?: string;
  used_paid?: number; used_unpaid?: number; remaining?: number | null;
  entitled?: number | null;
}

export interface ShiftRequestRow {
  id: string;
  employee_id: string;
  employee_name?: string | null;
  date: string;
  from_shift_id: string | null;
  to_shift_id: string | null;
  to_shift_label: string | null;
  reason: string | null;
  status: string;
  requested_at: number | null;
  decided_at: number | null;
  decided_by_name: string | null;
  decision_note: string | null;
}

export interface ShiftOption { id: string; label: string; start: number; end: number }

export interface SupervisorInbox {
  is_supervisor: boolean;
  reports: { id: string; name: string | null; employee_code: string | null; status: string | null }[];
  leave: LeaveRequestRow[];
  shift: ShiftRequestRow[];
}
