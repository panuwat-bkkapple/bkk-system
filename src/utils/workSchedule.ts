// เวลาทำงานที่ประกาศไว้สอดคล้องกันไหม
//
// **MIRROR ของ `workScheduleCheck` ใน `functions/hr-documents.js`** — ตัวที่
// ตัดสินจริงคือฝั่ง server (มันบล็อกการออกสัญญา) ตัวนี้มีไว้เตือนตั้งแต่ตอน
// พิมพ์ค่าที่หน้าตั้งค่า ไม่ต้องรอไปโดนปฏิเสธตอนกดออกเอกสาร
// **แก้สูตรต้องแก้ทั้งคู่** — มีด่านเทียบข้อความจริงในสองไฟล์ที่
// `functions/test/hr-documents.test.mjs`
//
// ที่มา: สัญญาฉบับแรกที่ออกจริงพิมพ์ว่า "วันละ 8 ชั่วโมง ระหว่างเวลา 09:00 ถึง
// 18:00 น." ซึ่งเป็นช่วง 9 ชั่วโมง และไม่ได้พูดถึงเวลาพักเลย — เอกสารที่คน
// ต้องเซ็นจึงบวกกันไม่ลงตัวบนหน้ากระดาษ
export interface ScheduleTerms {
  work_start?: string;
  work_end?: string;
  work_hours_per_day?: number | string;
  break_minutes?: number | string;
}
export interface ScheduleCheck {
  ok: boolean;
  spanMin?: number;
  workMin?: number;
  breakMin?: number;
  reason?: string;
}

export function parseClock(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function workScheduleCheck(terms: ScheduleTerms): ScheduleCheck {
  const t = terms || {};
  const start = parseClock(t.work_start);
  const end = parseClock(t.work_end);
  if (start == null || end == null) {
    return { ok: false, reason: 'เวลาเริ่ม/เลิกงานต้องเป็นรูป HH:MM' };
  }
  // เท่ากันเป๊ะ = ช่วงศูนย์ ไม่ใช่ 24 ชั่วโมง — กะที่ยาว 24 ชม.ไม่มีอยู่จริง
  const spanMin = end > start ? end - start : end === start ? 0 : end + 24 * 60 - start;
  const breakMin = Math.max(0, Math.round(Number(t.break_minutes) || 0));
  const workMin = Math.round((Number(t.work_hours_per_day) || 0) * 60);
  if (workMin <= 0) return { ok: false, spanMin, workMin, breakMin, reason: 'ยังไม่ได้ตั้งชั่วโมงทำงานต่อวัน' };
  if (breakMin >= spanMin) {
    return { ok: false, spanMin, workMin, breakMin, reason: 'เวลาพักยาวเท่าหรือมากกว่าช่วงเวลาทำงานทั้งวัน' };
  }
  if (spanMin - breakMin !== workMin) {
    const hh = (m: number) => (m / 60).toFixed(2).replace(/\.00$/, '');
    return {
      ok: false, spanMin, workMin, breakMin,
      reason: `ตัวเลขไม่ลงตัว: ${t.work_start}-${t.work_end} คือ ${hh(spanMin)} ชม. หักพัก ${breakMin} นาที `
        + `เหลือ ${hh(spanMin - breakMin)} ชม. แต่ประกาศว่าวันละ ${hh(workMin)} ชม.`,
    };
  }
  return { ok: true, spanMin, workMin, breakMin };
}
