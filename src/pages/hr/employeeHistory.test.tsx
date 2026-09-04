// ประวัติพนักงาน — เรนเดอร์จริงด้วย renderToStaticMarkup
//
// ชุดนี้แทนที่ `employeeTimeline.test.tsx` ซึ่งเฝ้าหน้าจอที่**ไม่ใช่ประวัติ**
// (มันคือ audit log ที่ปลอมตัวมา — ดูหัวไฟล์ EmployeeHistory.tsx)
//
// **ข้อที่ตั้งใจไม่มีในไฟล์นี้:** ข้อความบอกว่า audit log ย้ายไปอยู่ที่อื่น
// อยู่ในกรอบโมดอลที่ `EmployeeRegister.tsx` ซึ่ง import firebase ตอนโหลดโมดูล
// จึง SSR ในเทสไม่ได้ — เคยเขียนเป็น `expect(true).toBe(true)` ไว้แล้วลบทิ้ง
// เพราะเทสว่างที่ดูเหมือนมีด่านแย่กว่าการรู้ว่าไม่มี (กฎใน CLAUDE.md)
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                          | ผล |
//   |----------------------------------------------------|----|
//   | ไม่มีวันเริ่มงาน = แสดง "0 วัน" แทนคำเตือน           | แดง 1 |
//   | แถวที่ audit ไม่เก็บค่า แสดงเป็นตัวเลข (0 บาท)        | แดง 1 |
//   | ไม่มีสิทธิ์ดูเงินเดือนแต่ยังขึ้นหัวข้อนั้น              | แดง 1 |
//   | เปอร์เซ็นต์ไม่มีเครื่องหมาย (แยกขึ้น/ลงไม่ออก)         | แดง 2 |
//   | "เท่าเดิม" กลายเป็น "+0%"                            | แดง 1 |
//   | ช่วงตำแหน่งปัจจุบันไม่บอกว่าปัจจุบัน                  | แดง 3 |

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmployeeHistoryView } from './EmployeeHistory';
import { salaryDeltaText, positionRangeText, type EmployeeHistoryData } from './employeeHistoryView';

const base = (over: Partial<EmployeeHistoryData> = {}): EmployeeHistoryData => ({
  summary: {
    tenure_days: 400, tenure_text: '1 ปี 1 เดือน', tenure_ended: false,
    position: 'พนักงานขาย', department: 'ขาย', status: 'active',
    hired_at: 1753920000000, terminated_at: null,
  },
  positions: [], statuses: [], salary: [], leave_by_year: [], documents: [],
  ...over,
});

const html = (d: EmployeeHistoryData | null, loading = false) =>
  renderToStaticMarkup(<EmployeeHistoryView data={d} loading={loading} />);

describe('สรุประยะเวลางาน', () => {
  it('แสดงระยะเวลางานเป็นอันดับแรก', () => {
    expect(html(base())).toContain('1 ปี 1 เดือน');
  });

  it('ไม่มีวันเริ่มงาน = บอกให้ไปกรอก ไม่ใช่แสดง 0 วัน', () => {
    // **ข้อสำคัญที่สุดของไฟล์นี้** — คนที่ไม่มีวันเริ่มงานในระบบอาจทำงานมา
    // สามปีแล้ว การเขียน "0 วัน" คือการรายงานสิ่งที่เราไม่เคยตรวจว่าเป็นศูนย์
    const out = html(base({ summary: { ...base().summary, tenure_text: null, tenure_days: null } }));
    expect(out).toContain('ยังไม่ได้กรอกวันเริ่มงาน');
    expect(out).not.toContain('0 วัน');
  });

  it('พ้นสภาพแล้วบอกด้วย', () => {
    expect(html(base({ summary: { ...base().summary, tenure_ended: true } }))).toContain('พ้นสภาพแล้ว');
  });
});

describe('ประวัติเงินเดือน — ท่อนที่หน้าจอเดิมทำไม่ได้', () => {
  const withSalary = base({
    salary: [{ at: 1779840000000, from: 15000, to: 20000, pct: 33.3, by_name: 'Panuwat', reason: 'ผ่านทดลองงาน', withheld: false }],
  });

  it('แสดงจำนวนเงินจริงทั้งค่าเก่าและค่าใหม่', () => {
    const out = html(withSalary);
    // หน้าจอเดิมเขียนแก้ตัวว่า "ระบบไม่ได้บันทึกจำนวนเงินไว้ในประวัติ"
    expect(out).toContain('15,000');
    expect(out).toContain('20,000');
    expect(out).not.toContain('ระบบไม่ได้บันทึกจำนวนเงิน');
  });

  it('แสดงเปอร์เซ็นต์พร้อมเครื่องหมาย', () => {
    expect(html(withSalary)).toContain('+33.3%');
  });

  it('แสดงคนสั่งกับเหตุผล', () => {
    const out = html(withSalary);
    expect(out).toContain('ผ่านทดลองงาน');
    expect(out).toContain('Panuwat');
  });

  it('แถวเก่าที่ไม่มีค่าเก็บไว้ ต้องบอกตรงๆ ไม่ใช่แสดงเป็น 0 บาท', () => {
    const out = html(base({
      salary: [{ at: 1, from: null, to: null, pct: null, by_name: null, reason: null, withheld: true }],
    }));
    expect(out).toContain('ไม่ได้บันทึกจำนวนเงินไว้');
    expect(out).not.toContain('฿0');
  });

  it('ไม่มีสิทธิ์ดูเงินเดือน = ไม่มีหัวข้อนั้นเลย', () => {
    const out = html(base({ salary: null }));
    expect(out).not.toContain('ประวัติเงินเดือน');
  });

  it('มีสิทธิ์แต่ยังไม่เคยปรับ = มีหัวข้อ พร้อมบอกว่ายังไม่มี', () => {
    const out = html(base({ salary: [] }));
    expect(out).toContain('ประวัติเงินเดือน');
    expect(out).toContain('ยังไม่เคยปรับเงินเดือน');
  });
});

describe('ตำแหน่ง', () => {
  it('แสดงทุกช่วงพร้อมระยะเวลา และเน้นช่วงปัจจุบัน', () => {
    const out = html(base({
      positions: [
        { position: 'พนักงานขาย', from: 1, to: 2, days: 300, current: false },
        { position: 'หัวหน้าฝ่ายขาย', from: 2, to: null, days: 100, current: true },
      ],
    }));
    expect(out).toContain('พนักงานขาย');
    expect(out).toContain('หัวหน้าฝ่ายขาย');
    expect(out).toContain('ปัจจุบัน');
    expect(out).toContain('emerald');
  });
});

describe('วันลารายปี', () => {
  it('แยกปี และเน้นวันที่ไม่ได้ค่าจ้าง', () => {
    const out = html(base({
      leave_by_year: [{ year: '2026', days: 5, paid_days: 2, unpaid_days: 3, by_type: { sick: 3, personal: 2 } }],
    }));
    expect(out).toContain('ปี 2026');
    expect(out).toContain('ไม่ได้ค่าจ้าง 3 วัน');
    expect(out).toContain('ลาป่วย 3 วัน');
  });
});

describe('salaryDeltaText', () => {
  it('ขึ้นต้องมีเครื่องหมายบวก', () => {
    expect(salaryDeltaText(10)).toBe('+10%');
  });

  it('ลงต้องเห็นชัดว่าติดลบ', () => {
    // การปรับ *ลด* เงินเดือนเป็นเรื่องที่ต้องเห็นชัดที่สุดในหน้านี้
    expect(salaryDeltaText(-5)).toBe('-5%');
  });

  it('เท่าเดิมเขียนเป็นคำ ไม่ใช่ "+0%"', () => {
    expect(salaryDeltaText(0)).toBe('เท่าเดิม');
  });

  it('ไม่มีค่า = ไม่มีข้อความ', () => {
    expect(salaryDeltaText(null)).toBe('');
    expect(salaryDeltaText(NaN)).toBe('');
  });
});

describe('positionRangeText', () => {
  const row = (days: number | null, current = false) => ({ position: 'x', from: 1, to: null, days, current });

  it('เกินปีบอกเป็นปี', () => {
    expect(positionRangeText(row(400))).toBe('1 ปี');
  });

  it('เกินเดือนบอกเป็นเดือน', () => {
    expect(positionRangeText(row(70))).toBe('2 เดือน');
  });

  it('ไม่ถึงเดือนบอกเป็นวัน', () => {
    expect(positionRangeText(row(5))).toBe('5 วัน');
  });

  it('ช่วงปัจจุบันต่อท้ายว่าปัจจุบัน', () => {
    expect(positionRangeText(row(400, true))).toBe('1 ปี · ปัจจุบัน');
  });

  it('ไม่รู้จำนวนวันแต่เป็นปัจจุบัน ยังบอกว่าปัจจุบัน', () => {
    expect(positionRangeText(row(null, true))).toBe('ปัจจุบัน');
  });
});

describe('สถานะขอบ', () => {
  it('กำลังโหลดไม่พัง', () => {
    expect(html(null, true)).toContain('กำลังโหลด');
  });

  it('ไม่มีข้อมูลไม่พัง', () => {
    expect(html(null)).toContain('ยังไม่มีข้อมูลประวัติ');
  });

  it('ทุกท่อนว่างก็ยังเรนเดอร์หัวข้อครบ', () => {
    const out = html(base());
    for (const t of ['ตำแหน่งที่เคยอยู่', 'วันลาแต่ละปี', 'สถานะการจ้าง', 'เอกสารที่ออกให้']) {
      expect(out).toContain(t);
    }
  });
});
