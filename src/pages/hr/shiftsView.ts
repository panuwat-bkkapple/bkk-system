// กะ ตารางเวร และการลงเวลา — ส่วนที่คำนวณได้โดยไม่ต้องมี Firebase (มีเทส)
//
// **ไม่คำนวณกติกาซ้ำ** — สาย/ออกก่อน/อยู่ในรัศมีไหม เป็นของ
// `functions/hr-attendance.js` ทั้งหมด ไฟล์นี้ทำสองอย่างเท่านั้น: จัดรูปให้
// อ่านออก และคิดว่า "ผู้ใช้แก้อะไรไปบ้าง" ก่อนส่งขึ้น server

export interface ShiftDraft {
  id: string;
  label: string;
  start: string;
  end: string;
  break_min: string;
  grace_min: string;
  active: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "08:30" -> 510 · รูปอื่นคืน null (ไม่ใช่ 0 — 0 คือเที่ยงคืนซึ่งเป็นเวลาจริง) */
export function toMinutes(hhmm: string): number | null {
  const m = TIME_RE.exec(String(hhmm || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 510 -> "08:30" */
export function toTime(min: number | null | undefined): string {
  if (min === null || min === undefined) return '';
  const n = Number(min);
  if (!Number.isFinite(n)) return '';
  const v = ((Math.round(n) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/**
 * ตรวจกะก่อนบันทึก
 *
 * **ปฏิเสธก่อนเขียน ไม่ใช่ปล่อยให้ server ตัดทิ้งเงียบๆ** — `normalizeShifts`
 * ฝั่ง server จะทิ้งกะที่เวลาเสีย ซึ่งถูก แต่ถ้าหน้าจอไม่บอกอะไรเลย แอดมินจะ
 * กดบันทึกแล้วเห็นกะหายไปโดยไม่รู้ว่าทำไม
 */
export function shiftDraftErrors(rows: ShiftDraft[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = String(r.id || '').trim();
    if (!id) { errs.push('ทุกกะต้องมีรหัส'); continue; }
    if (!/^[a-z0-9_-]+$/i.test(id)) errs.push(`รหัสกะ "${id}" ใช้ได้เฉพาะ a-z 0-9 _ -`);
    if (seen.has(id)) errs.push(`รหัสกะซ้ำ: ${id}`);
    seen.add(id);
    if (!String(r.label || '').trim()) errs.push(`กะ ${id} ต้องมีชื่อ`);
    const s = toMinutes(r.start);
    const e = toMinutes(r.end);
    if (s === null) errs.push(`กะ ${id}: เวลาเข้างานต้องเป็น HH:MM`);
    if (e === null) errs.push(`กะ ${id}: เวลาออกงานต้องเป็น HH:MM`);
    if (s !== null && e !== null && s === e) errs.push(`กะ ${id}: เวลาเข้าและออกเท่ากัน`);
  }
  if (!rows.length) errs.push('ต้องมีอย่างน้อยหนึ่งกะ');
  return errs;
}

/** รูปที่เขียนลง `settings/hr/shifts` */
export function shiftsPayload(rows: ShiftDraft[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  rows.forEach((r, i) => {
    const id = String(r.id || '').trim();
    if (!id) return;
    out[id] = {
      label: String(r.label || '').trim(),
      start: r.start,
      end: r.end,
      break_min: Number(r.break_min) || 0,
      grace_min: Number(r.grace_min) || 0,
      active: r.active !== false,
      order: i + 1,
    };
  });
  return out;
}

/** เจ็ดวันเริ่มจากวันจันทร์ของสัปดาห์ที่ `iso` อยู่ */
export function weekDates(iso: string): string[] {
  const base = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(base)) return [];
  const dow = new Date(base).getUTCDay();          // 0=อา
  const monday = base - ((dow + 6) % 7) * 86400000; // จันทร์เป็นวันแรกของสัปดาห์ไทย
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86400000).toISOString().slice(0, 10));
}

export const DOW_LABEL = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export function dowOf(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? DOW_LABEL[new Date(t).getUTCDay()] : '';
}

/**
 * เซลล์ที่เปลี่ยนไปจากของเดิม
 *
 * **`null` (ลบเวร) ต้องต่างจาก "ไม่ได้แตะ"** — ส่งทั้งตารางขึ้นไปทุกครั้งแปลว่า
 * การเปิดหน้าแล้วกดบันทึกเฉยๆ จะเขียนทับเวรที่คนอื่นเพิ่งแก้ ส่วนการส่งเฉพาะ
 * ที่เปลี่ยนทำให้สองคนแก้คนละวันพร้อมกันได้
 */
export function rosterDiff(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [iso, v] of Object.entries(after || {})) {
    const b = (before || {})[iso] ?? null;
    const a = v ?? null;
    if (a !== b) out[iso] = a;
  }
  return out;
}

/** ป้ายของแถวลงเวลา — คืนลิสต์ เพราะแถวเดียวมีได้หลายเรื่องพร้อมกัน */
export function attendanceFlags(r: {
  status?: string; late_min?: number | null; within_grace?: boolean | null;
  early_min?: number | null; out_outside?: boolean | null; no_shift?: boolean;
}): { text: string; tone: 'ok' | 'warn' | 'bad' | 'grey' }[] {
  const out: { text: string; tone: 'ok' | 'warn' | 'bad' | 'grey' }[] = [];
  if (r.status === 'open') out.push({ text: 'ยังไม่ได้ออกงาน', tone: 'warn' });
  if (typeof r.late_min === 'number' && r.late_min > 0) {
    out.push({ text: `สาย ${r.late_min} น.`, tone: r.within_grace ? 'warn' : 'bad' });
  }
  if (typeof r.early_min === 'number' && r.early_min > 0) {
    out.push({ text: `ออกก่อน ${r.early_min} น.`, tone: 'warn' });
  }
  if (r.out_outside) out.push({ text: 'ออกงานนอกพื้นที่', tone: 'grey' });
  if (r.no_shift) out.push({ text: 'ไม่มีกะ', tone: 'grey' });
  if (!out.length && r.status === 'closed') out.push({ text: 'ปกติ', tone: 'ok' });
  return out;
}
