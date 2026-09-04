// ไทม์ไลน์ประวัติพนักงาน — เทสเชิงพฤติกรรม (SSR จริง)
//
// สองข้อที่ชุดนี้เฝ้าไว้ และเป็นเหตุผลที่ไฟล์นี้มีอยู่:
//
// 1. **เหตุการณ์ที่ระบบไม่รู้จักต้องยังขึ้นบนไทม์ไลน์** — ไทม์ไลน์คือคำตอบของ
//    "เกิดอะไรขึ้นกับคนนี้บ้าง" การกรองแถวที่แปลไม่ออกทิ้งทำให้มันตอบผิดโดยไม่มี
//    ใครรู้ว่าขาดอะไร (ตระกูลเดียวกับสถานะใบสมัครที่เคยตกเป็น "ส่งใบสมัครแล้ว")
// 2. **`salary_changed` ต้องไม่มีตัวเลข** — server เขียน from/to เป็น null โดย
//    ตั้งใจ ("ค่าเก่าเป็นข้อมูลอ่อนไหว เก็บใน employees_private เท่านั้น")
//    ไทม์ไลน์ต้องเขียนบอกตรงๆ ว่าไม่ได้บันทึกจำนวนเงิน ไม่ใช่ปล่อยว่าง
//
// ผล injection — 4 ก.ย. 2569
//
//   #   ทำลายอะไร                                          ผล
//   1   กรองเหตุการณ์ที่ไม่รู้จักทิ้ง                        แดง 3
//   2   เหตุการณ์ที่ไม่รู้จักถูกแปลเป็น "แก้ไขข้อมูล"         แดง 2
//   3   salary_changed โชว์ from/to (ซึ่งเป็น null)          แดง
//   4   ไม่เรียงตามเวลา (เชื่อลำดับที่ได้มา)                  แดง
//   5   ไม่มีชื่อผู้ทำรายการ = ขึ้นว่า "ไม่ทราบ"              แดง
//   6   ชนเพดานแล้วไม่บอก                                   แดง
//   7   ไม่มีประวัติ = จอว่างเปล่า ไม่อธิบายอะไร              แดง
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmployeeTimeline } from './EmployeeTimeline';
import { describeEvent, actorLabel, sortEvents, type TimelineEvent } from './employeeTimeline';

const at = (d: string) => new Date(d).getTime();
const render = (items: TimelineEvent[], capped = false) =>
  renderToStaticMarkup(<EmployeeTimeline items={items} capped={capped} />);

describe('เหตุการณ์ที่ระบบไม่รู้จัก', () => {
  const ev: TimelineEvent = { id: '1', action: 'transferred_branch', at: at('2026-09-01') };

  it('ยังขึ้นบนไทม์ไลน์ ไม่ถูกกรองทิ้ง', () => {
    const html = render([ev]);
    expect(html).toContain('transferred_branch');
  });

  it('ไม่ถูกแปลเป็นเหตุการณ์อื่นที่ระบบรู้จัก', () => {
    const v = describeEvent(ev);
    expect(v.unknown).toBe(true);
    expect(v.label).not.toBe(describeEvent({ id: '2', action: 'profile_updated' }).label);
  });

  it('บอกบนจอว่าอ่านไม่ออก', () => {
    expect(render([ev])).toContain('ระบบยังไม่รู้จักเหตุการณ์นี้');
  });

  it('เหตุการณ์ที่ไม่มี action เลยก็ยังขึ้น', () => {
    expect(describeEvent({ id: '3' }).unknown).toBe(true);
    expect(render([{ id: '3', at: at('2026-09-01') }])).toContain('ไม่ระบุชนิด');
  });
});

describe('เหตุการณ์ที่รู้จัก', () => {
  it('ปรับเงินเดือนไม่โชว์ตัวเลข และบอกว่าไม่ได้บันทึกไว้', () => {
    const v = describeEvent({ id: '1', action: 'salary_changed', from: null, to: null });
    expect(v.lines.join(' ')).toContain('ไม่ได้บันทึกจำนวนเงิน');
    expect(v.lines.join(' ')).not.toMatch(/[0-9]{3,}/);
  });

  it('เปลี่ยนตำแหน่งโชว์ก่อน → หลัง', () => {
    const v = describeEvent({
      id: '1', action: 'promoted',
      from: { position: 'พนักงานขาย' }, to: { position: 'หัวหน้าทีมขาย' },
    });
    expect(v.lines[0]).toBe('พนักงานขาย → หัวหน้าทีมขาย');
  });

  it('เปลี่ยนสถานะแปลเป็นภาษาไทย ไม่ใช่ค่าดิบ', () => {
    const v = describeEvent({
      id: '1', action: 'resigned',
      from: { status: 'active' }, to: { status: 'resigned' },
    });
    expect(v.lines[0]).toBe('ทำงานอยู่ → ลาออก');
  });

  // `hired` มีแต่ปลายทาง — ลูกศรจากช่องว่างไม่ได้บอกอะไรเพิ่มจากป้าย "เริ่มงาน"
  it('เริ่มงานไม่เขียนลูกศรจากช่องว่าง', () => {
    const v = describeEvent({ id: '1', action: 'hired', from: null, to: { status: 'active' } });
    expect(v.lines.join(' ')).not.toContain('→');
  });

  it('เหตุผลขึ้นเป็นบรรทัดของตัวเอง', () => {
    const v = describeEvent({ id: '1', action: 'terminated', reason: 'ขาดงานเกินกำหนด' });
    expect(v.lines.some((l) => l.includes('ขาดงานเกินกำหนด'))).toBe(true);
  });
});

describe('ผู้ทำรายการ', () => {
  it('มีชื่อ = แสดงชื่อพร้อม role', () => {
    expect(actorLabel({ id: '1', by_name: 'สมชาย', by_role: 'CEO' })).toBe('สมชาย (CEO)');
  });
  // แถวที่ระบบเขียนเอง (เช่นตอนกดจ้างจากใบสมัคร) ต้องไม่ขึ้นว่า "ไม่ทราบ"
  // ซึ่งอ่านเหมือนข้อมูลหาย ทั้งที่ความจริงคือไม่มีคนกด
  it('ไม่มีชื่อ = "ระบบ" ไม่ใช่ "ไม่ทราบ"', () => {
    expect(actorLabel({ id: '1' })).toBe('ระบบ');
  });
});

describe('ลำดับและเพดาน', () => {
  const rows: TimelineEvent[] = [
    { id: 'a', action: 'hired', at: at('2026-01-01') },
    { id: 'b', action: 'promoted', at: at('2026-06-01') },
    { id: 'c', action: 'resigned', at: at('2026-03-01') },
  ];

  it('เรียงใหม่เอง ไม่เชื่อลำดับที่ได้มา', () => {
    expect(sortEvents(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('แถวที่ไม่มีเวลาไปอยู่ท้าย ไม่ใช่หัวแถว', () => {
    const out = sortEvents([{ id: 'x' }, ...rows]);
    expect(out[out.length - 1].id).toBe('x');
  });

  it('ชนเพดานแล้วบอกบนจอ', () => {
    expect(render(rows, true)).toContain('เท่าที่เพดานอนุญาต');
    expect(render(rows, false)).not.toContain('เท่าที่เพดานอนุญาต');
  });

  it('ไม่มีประวัติ = อธิบายว่าทำไม ไม่ใช่จอว่าง', () => {
    const html = render([]);
    expect(html).toContain('ยังไม่มีประวัติ');
    expect(html).toContain('แฟ้มถูกสร้างในระบบ');
  });
});
