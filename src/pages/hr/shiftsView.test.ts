// กะ/ตารางเวร ฝั่งหน้าจอ
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง เติมหลังรันจริง)

import { describe, it, expect } from 'vitest';
import {
  toMinutes, toTime, shiftDraftErrors, shiftsPayload, weekDates, dowOf,
  rosterDiff, attendanceFlags, type ShiftDraft,
} from './shiftsView';

const draft = (over: Partial<ShiftDraft> = {}): ShiftDraft => ({
  id: 'morning', label: 'กะเช้า', start: '08:00', end: '17:00',
  break_min: '60', grace_min: '15', active: true, ...over,
});

describe('เวลา', () => {
  it('แปลงไป-กลับได้', () => {
    expect(toMinutes('08:30')).toBe(510);
    expect(toTime(510)).toBe('08:30');
  });

  it('เที่ยงคืนเป็นเวลาจริง ไม่ใช่ค่าว่าง', () => {
    // `if (!m)` แบบง่ายๆ จะทำให้ 00:00 หายไป ทั้งที่กะดึกจบเที่ยงคืนได้
    expect(toMinutes('00:00')).toBe(0);
    expect(toTime(0)).toBe('00:00');
  });

  it('รูปที่ไม่ใช่ HH:MM คืน null ไม่ใช่ 0', () => {
    // คืน 0 = กะที่พิมพ์ผิดกลายเป็นกะที่เริ่มเที่ยงคืน แล้วทุกคนสายทั้งวัน
    expect(toMinutes('8:00')).toBeNull();
    expect(toMinutes('25:00')).toBeNull();
    expect(toMinutes('')).toBeNull();
  });
});

describe('ตรวจกะก่อนบันทึก', () => {
  it('กะปกติผ่าน', () => {
    expect(shiftDraftErrors([draft()])).toEqual([]);
  });

  it('เวลาเสียต้องบอก ไม่ใช่ปล่อยให้ server ตัดทิ้งเงียบๆ', () => {
    // ถ้าหน้าจอไม่บอก แอดมินจะกดบันทึกแล้วเห็นกะหายไปโดยไม่รู้ว่าทำไม
    expect(shiftDraftErrors([draft({ start: '8:00' })]).join()).toContain('HH:MM');
  });

  it('รหัสซ้ำต้องบอก', () => {
    expect(shiftDraftErrors([draft(), draft()]).join()).toContain('ซ้ำ');
  });

  it('ไม่มีชื่อกะต้องบอก', () => {
    expect(shiftDraftErrors([draft({ label: '  ' })]).join()).toContain('ชื่อ');
  });

  it('เข้าและออกเวลาเดียวกันไม่ได้', () => {
    expect(shiftDraftErrors([draft({ end: '08:00' })]).join()).toContain('เท่ากัน');
  });

  it('ลบกะจนหมดไม่ได้', () => {
    // ไม่มีกะเลย = ทุกคนลงเวลาโดยไม่มีใครรู้ว่าสายหรือไม่
    expect(shiftDraftErrors([]).join()).toContain('อย่างน้อยหนึ่ง');
  });

  it('รหัสที่มีอักขระแปลกไม่ได้ (มันคือ key ใน RTDB)', () => {
    expect(shiftDraftErrors([draft({ id: 'กะ/เช้า' })]).length).toBeGreaterThan(0);
  });
});

describe('รูปที่เขียนลงฐานข้อมูล', () => {
  it('เก็บครบทุกช่อง และเรียงลำดับตามที่เห็นบนจอ', () => {
    const p = shiftsPayload([draft(), draft({ id: 'night', label: 'กะดึก', start: '22:00', end: '06:00' })]);
    expect(Object.keys(p)).toEqual(['morning', 'night']);
    expect((p.night as { order: number }).order).toBe(2);
    expect((p.morning as { break_min: number }).break_min).toBe(60);
  });

  it('ช่องตัวเลขที่ว่างเป็น 0 ไม่ใช่ NaN', () => {
    const p = shiftsPayload([draft({ break_min: '', grace_min: '' })]);
    expect((p.morning as { break_min: number }).break_min).toBe(0);
  });
});

describe('สัปดาห์', () => {
  it('เริ่มวันจันทร์เสมอ', () => {
    // 2026-09-04 เป็นวันศุกร์
    const w = weekDates('2026-09-04');
    expect(w).toHaveLength(7);
    expect(w[0]).toBe('2026-08-31');
    expect(w[6]).toBe('2026-09-06');
  });

  it('วันอาทิตย์ยังอยู่ในสัปดาห์ที่เพิ่งจบ ไม่ใช่เริ่มสัปดาห์ใหม่', () => {
    // กับดักคลาสสิกของ `getDay()` ซึ่งนับอาทิตย์เป็น 0
    expect(weekDates('2026-09-06')[0]).toBe('2026-08-31');
  });

  it('วันที่เสียไม่พัง', () => {
    expect(weekDates('ไม่ใช่วันที่')).toEqual([]);
  });

  it('ชื่อวันถูก', () => {
    expect(dowOf('2026-09-04')).toBe('ศ');
  });
});

describe('ส่งเฉพาะเวรที่เปลี่ยน', () => {
  it('ไม่แตะอะไรเลย = ไม่ส่งอะไรเลย', () => {
    // เปิดหน้าแล้วกดบันทึกเฉยๆ ต้องไม่เขียนทับเวรที่คนอื่นเพิ่งแก้
    expect(rosterDiff({ '2026-09-01': 'morning' }, { '2026-09-01': 'morning' })).toEqual({});
  });

  it('เปลี่ยนกะ = ส่งค่าใหม่', () => {
    expect(rosterDiff({ '2026-09-01': 'morning' }, { '2026-09-01': 'night' }))
      .toEqual({ '2026-09-01': 'night' });
  });

  it('ลบเวร = ส่ง null ไม่ใช่ไม่ส่ง', () => {
    // "ไม่ส่ง" แปลว่าไม่แตะ ซึ่งตรงข้ามกับ "ลบทิ้ง" — ถ้าไม่แยกสองเคสนี้
    // การลบเวรจะไม่มีวันมีผล
    expect(rosterDiff({ '2026-09-01': 'morning' }, { '2026-09-01': null }))
      .toEqual({ '2026-09-01': null });
  });

  it('เพิ่มเวรในวันที่ยังว่าง', () => {
    expect(rosterDiff({}, { '2026-09-02': 'night' })).toEqual({ '2026-09-02': 'night' });
  });
});

describe('ป้ายของแถวลงเวลา', () => {
  it('แถวปกติที่ปิดแล้วขึ้นว่าปกติ', () => {
    expect(attendanceFlags({ status: 'closed' })[0].text).toBe('ปกติ');
  });

  it('สายเกินผ่อนผันเป็นสีแดง ในผ่อนผันเป็นสีเหลือง', () => {
    expect(attendanceFlags({ status: 'closed', late_min: 30, within_grace: false })[0].tone).toBe('bad');
    expect(attendanceFlags({ status: 'closed', late_min: 5, within_grace: true })[0].tone).toBe('warn');
  });

  it('แถวเดียวมีได้หลายป้าย', () => {
    const f = attendanceFlags({ status: 'closed', late_min: 30, early_min: 20, out_outside: true });
    expect(f.length).toBe(3);
  });

  it('สาย 0 นาทีไม่ขึ้นป้าย', () => {
    expect(attendanceFlags({ status: 'closed', late_min: 0 })[0].text).toBe('ปกติ');
  });

  it('ยังไม่ออกงานขึ้นป้ายเสมอ', () => {
    expect(attendanceFlags({ status: 'open' })[0].text).toContain('ยังไม่ได้ออกงาน');
  });
});
