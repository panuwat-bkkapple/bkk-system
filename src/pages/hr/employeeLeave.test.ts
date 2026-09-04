// ─── ผล injection ─────────────────────────────────────────────────────────
//   | ทำลายอะไร                                                | ผล |
//   |----------------------------------------------------------|----|
//   | `balanceText` พูดว่า "เหลือ 0" กับคนที่ยังไม่ครบปี          | แดง 1 |
//   | `balanceText` พูดว่า "เหลือ" กับชนิดที่ไม่มีเพดาน           | แดง 1 |
//   | `needsAttention` เน้นคนที่ยังไม่ครบปีด้วย                   | แดง 1 |
//   | `needsAttention` เงียบเมื่อมีวันที่ไม่ได้ค่าจ้าง             | แดง 1 |
//   | `leaveSummary` นับใบที่ยังไม่อนุมัติรวมเข้าไปด้วย            | แดง 1 |
//   | ป้ายสถานะที่ไม่รู้จักกลายเป็นสีเขียว (ดูเหมือนอนุมัติแล้ว)   | แดง 1 |
//   | `bangkokIsoDate` ไม่บวกออฟเซ็ต UTC+7                       | แดง 1 |
//   | `bangkokIsoDate` ถอด guard ของ null                        | แดง 1 |
//
// **สองแถวสุดท้ายของกลุ่มกลางเคยเป็น "แดง 0" ตอนรันรอบแรก** และทั้งคู่เป็น
// กับดักข้อ 2 ใน CLAUDE.md (เทสที่เห็นด้วยกับตัวเอง) คนละรูปกัน:
//   - `needsAttention` + `locked` — fixture เดิมมี `used_paid_days: 0` ซึ่ง
//     ทำให้กฎ *ถัดไป* ตอบ false อยู่แล้ว การถอด `locked` ทิ้งจึงไม่เปลี่ยนอะไร
//     ต้องหา fixture ที่กฎถัดไปจะยิงจริง (ยอดของคนที่ HR แก้วันเริ่มงานย้อนหลัง)
//   - `statusTone` — assert เดิมเทียบ unknown กับ pending ซึ่งออกจาก `return`
//     บรรทัดเดียวกัน เปลี่ยนบรรทัดนั้นแล้วยังเท่ากันอยู่ดี ต้องเทียบกับ
//     `approved` ซึ่งเป็นค่าที่การเดาผิดจะไปชนพอดี
//
// **กับดักนี้กัดสามครั้งในงานเดียว** (อีกครั้งอยู่ที่ hr-leave.test.mjs เรื่อง
// โหมดนับวันของลาคลอด) — ยืนยันบรรทัดใน CLAUDE.md ว่ามันไม่ใช่ของหายาก
// มันคือค่าเริ่มต้น: **ถามเสมอว่าเทสตกที่ชั้นไหนจริง ไม่ใช่ชั้นไหนที่เราตั้งใจ**

import { describe, it, expect } from 'vitest';
import {
  balanceText, needsAttention, leaveSummary, statusTone, bangkokIsoDate,
  type LeaveBalance, type LeaveRequestRow,
} from './employeeLeave';

const bal = (over: Partial<LeaveBalance> = {}): LeaveBalance => ({
  type: 'personal', label: 'ลากิจธุระอันจำเป็น', basis: 'ม.34 / ม.57/1',
  counts: 'working_days', entitled_paid_days: 3, used_paid_days: 0,
  used_unpaid_days: 0, pending_days: 0, remaining_paid_days: 3,
  locked: null, service_state: null, ...over,
});

const req = (over: Partial<LeaveRequestRow> = {}): LeaveRequestRow => ({
  id: 'r1', type: 'personal', from: '2026-09-04', to: '2026-09-04',
  days: 1, paid_days: 1, unpaid_days: 0, status: 'approved',
  reason: null, decided_by_name: null, decision_note: null, ...over,
});

describe('balanceText', () => {
  it('มีเพดาน = บอกว่าเหลือเท่าไร', () => {
    expect(balanceText(bal({ used_paid_days: 1, remaining_paid_days: 2 }))).toBe('เหลือ 2 จาก 3 วัน');
  });

  it('ยังไม่ครบปี = "ยังไม่มีสิทธิ์" ไม่ใช่ "เหลือ 0"', () => {
    // **ข้อสำคัญ** — "เหลือ 0 จาก 6 วัน" อ่านว่าใช้หมดแล้ว ซึ่งตรงข้ามกับ
    // ความจริงว่าเขายังไม่เคยได้สิทธิ์นั้นเลย (ม.30)
    const t = balanceText(bal({ type: 'annual', locked: 'service', entitled_paid_days: 6, remaining_paid_days: 6 }));
    expect(t).toContain('ยังไม่มีสิทธิ์');
    expect(t).not.toContain('เหลือ');
  });

  it('ไม่มีเพดาน = บอกว่าใช้ไปเท่าไร ไม่ใช่เหลือเท่าไร', () => {
    // ม.32 ให้ลาป่วยได้เท่าที่ป่วยจริง คำว่า "เหลือ" สื่อว่ามีเพดานการลา
    const t = balanceText(bal({ type: 'sterilization', entitled_paid_days: null, remaining_paid_days: null, used_paid_days: 4 }));
    expect(t).toContain('ใช้สิทธิ์ที่ได้ค่าจ้างไปแล้ว 4 วัน');
    expect(t).not.toContain('เหลือ');
  });
});

describe('needsAttention', () => {
  it('ยอดปกติไม่ต้องเน้น', () => {
    expect(needsAttention(bal())).toBe(false);
  });

  it('มีวันที่ไม่ได้ค่าจ้าง = ต้องเน้น', () => {
    expect(needsAttention(bal({ used_unpaid_days: 2 }))).toBe(true);
  });

  it('ใช้สิทธิ์หมดพอดี = ต้องเน้น', () => {
    expect(needsAttention(bal({ used_paid_days: 3, remaining_paid_days: 0 }))).toBe(true);
  });

  it('ยังไม่ครบปีไม่ใช่เรื่องต้องเน้น แม้ยอดจะดูเหมือนใช้หมด', () => {
    // คนเพิ่งเข้างานยังไม่มีสิทธิ์ลาพักร้อนเป็นเรื่องปกติ ไม่ใช่ปัญหาที่ต้องแก้
    //
    // **fixture ต้องเป็นแถวที่กฎข้างล่างจะยิงถ้าไม่มี `locked`** ไม่งั้นเทส
    // จะเขียวเพราะกฎอื่นตัดสินไปก่อน ไม่ใช่เพราะ `locked` ทำงาน (กับดักข้อ 2
    // ใน CLAUDE.md — injection ที่ถอด `locked` ออกเคยผ่านฉลุยด้วยเหตุนี้)
    //
    // แถวแบบนี้เกิดจริงเมื่อ HR **แก้วันเริ่มงานย้อนหลัง**: คนที่เคยบันทึกว่า
    // เข้างานสองปีแล้วและลาพักร้อนไป 6 วัน พอแก้วันเริ่มงานเป็นเดือนที่แล้ว
    // ยอดจะกลายเป็น locked ทั้งที่มีวันที่ใช้ไปแล้วค้างอยู่
    const corrected = bal({
      type: 'annual', locked: 'service',
      entitled_paid_days: 6, used_paid_days: 6, remaining_paid_days: 0,
    });
    expect(needsAttention(corrected)).toBe(false);
    // และพิสูจน์ว่ากฎข้างล่างจะยิงจริงถ้าไม่ถูก `locked` กันไว้
    expect(needsAttention({ ...corrected, locked: null })).toBe(true);
  });

  it('สิทธิ์เต็มแต่ยังไม่เคยใช้ ไม่ใช่ "ใช้หมด"', () => {
    expect(needsAttention(bal({ entitled_paid_days: 0, remaining_paid_days: 0, used_paid_days: 0 }))).toBe(false);
  });
});

describe('leaveSummary', () => {
  it('นับเฉพาะใบที่อนุมัติแล้ว และแยกใบที่ยังรอ', () => {
    const s = leaveSummary([
      req({ id: 'a', days: 2, unpaid_days: 0 }),
      req({ id: 'b', days: 3, unpaid_days: 3 }),
      req({ id: 'c', days: 5, unpaid_days: 5, status: 'pending' }),
      req({ id: 'd', days: 9, unpaid_days: 9, status: 'rejected' }),
    ]);
    expect(s.approved_days).toBe(5);
    expect(s.unpaid_days).toBe(3);
    expect(s.pending).toBe(1);
  });

  it('ไม่มีใบเลยไม่พัง', () => {
    expect(leaveSummary([])).toEqual({ approved_days: 0, unpaid_days: 0, pending: 0 });
  });
});

describe('statusTone', () => {
  it('อนุมัติกับไม่อนุมัติต้องคนละสี', () => {
    expect(statusTone('approved')).not.toBe(statusTone('rejected'));
  });

  it('สถานะที่ไม่รู้จักตกเป็นสีของ "รออนุมัติ" ไม่ใช่สีเขียว', () => {
    // เดาไปทางที่สบายกว่า = ใบที่ระบบอ่านไม่ออกดูเหมือนผ่านแล้ว
    //
    // **ห้ามเทียบกับ `statusTone('pending')` อย่างเดียว** — สองค่านั้นออกจาก
    // `return` บรรทัดเดียวกัน เปลี่ยนบรรทัดนั้นเป็นสีเขียวก็ยังเท่ากันอยู่ดี
    // (injection ที่เปลี่ยน fallback เป็นสีเขียวเคยผ่านฉลุยด้วยเหตุนี้)
    expect(statusTone('อะไรสักอย่าง')).not.toBe(statusTone('approved'));
    expect(statusTone('อะไรสักอย่าง')).toBe(statusTone('pending'));
  });
});

describe('bangkokIsoDate', () => {
  it('เที่ยงคืนตามเวลาไทยยังเป็นวันเดียวกัน', () => {
    // 2026-09-04 00:00 ไทย = 2026-09-03 17:00 UTC — `toISOString` เปล่าๆ
    // จะได้ 09-03 ซึ่งเลื่อนขอบรอบจ่ายไปหนึ่งวัน
    expect(bangkokIsoDate(Date.UTC(2026, 8, 3, 17, 0, 0))).toBe('2026-09-04');
  });

  it('สิ้นวันตามเวลาไทยยังไม่ข้ามวัน', () => {
    expect(bangkokIsoDate(Date.UTC(2026, 8, 4, 16, 59, 0))).toBe('2026-09-04');
  });

  it('ค่าที่อ่านไม่ออกคืนสตริงว่าง ไม่ใช่วันที่มั่ว', () => {
    expect(bangkokIsoDate(null)).toBe('');
    expect(bangkokIsoDate(undefined)).toBe('');
    expect(bangkokIsoDate(NaN)).toBe('');
  });
});
