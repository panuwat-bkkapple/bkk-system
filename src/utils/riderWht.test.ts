// ภาษีหัก ณ ที่จ่ายบนฐานค่าจ้างล้วน — ฝั่งจอ (MIRROR ของ functions/rider-wht.js)
// เคสชุดเดียวกับ functions/test/rider-wht.test.mjs โดยตั้งใจ — drift = แดงข้างเดียว

import { describe, it, expect } from 'vitest';
import { computeRiderWht } from './riderWht';

const ON = { enabled: true, ratePercent: 3 };

describe('computeRiderWht — ฐานภาษี', () => {
  it('ไม่ส่งฐาน = หักบนยอดเต็ม (ทิศหักเกิน ไม่ใช่หักขาด)', () => {
    const r = computeRiderWht(1000, 'freelance', ON);
    expect(r.taxableBase).toBe(1000);
    expect(r.wht).toBe(30);
    expect(r.net).toBe(970);
  });

  it('ถอน 1,065 ที่มีเงินคืน 65 ปน = หัก 3% ของ 1,000 เท่านั้น แต่โอน 1,065 − 30', () => {
    const r = computeRiderWht(1065, 'freelance', ON, { taxableBase: 1000 });
    expect(r.applies).toBe(true);
    expect(r.taxableBase).toBe(1000);
    expect(r.exempt).toBe(65);
    expect(r.wht).toBe(30);
    expect(r.net).toBe(1035);
  });

  it('ถอนเงินคืนล้วน = ไม่หัก และบอกเหตุผล', () => {
    const r = computeRiderWht(65, 'freelance', ON, { taxableBase: 0 });
    expect(r.applies).toBe(false);
    expect(r.wht).toBe(0);
    expect(r.net).toBe(65);
    expect(r.reason).toContain('เงินคืน');
  });

  it('ฐานเกินยอดถอน (ledger เพี้ยน) ถูกบีบลงมาเท่ายอดถอน ไม่หักเกินที่จ่าย', () => {
    const r = computeRiderWht(500, 'freelance', ON, { taxableBase: 9999 });
    expect(r.taxableBase).toBe(500);
    expect(r.wht).toBe(15);
  });

  it('ฐานติดลบ / NaN = ปฏิบัติเหมือนไม่ส่ง (ยอดเต็ม)', () => {
    expect(computeRiderWht(500, 'freelance', ON, { taxableBase: -10 }).taxableBase).toBe(0);
    expect(computeRiderWht(500, 'freelance', ON, { taxableBase: Number.NaN }).taxableBase).toBe(500);
  });

  it('ปิดสวิตช์ / ลูกจ้างประจำ / ไม่ระบุ = ไม่หัก แม้มีฐาน', () => {
    expect(computeRiderWht(1000, 'freelance', { enabled: false, ratePercent: 3 }, { taxableBase: 1000 }).applies).toBe(false);
    expect(computeRiderWht(1000, 'employee', ON, { taxableBase: 1000 }).applies).toBe(false);
    expect(computeRiderWht(1000, null, ON, { taxableBase: 1000 }).applies).toBe(false);
  });
});
