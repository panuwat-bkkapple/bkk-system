// ─── ผล injection ─────────────────────────────────────────────────────────
//   | ทำลายอะไร                                              | ผล |
//   |--------------------------------------------------------|----|
//   | `licenseFact` อ่านค่าที่ไม่มีเป็น `no`                    | แดง 2 |
//   | `licenseFact` ใช้ truthy แทนการเทียบ `=== true`          | แดง 1 |
//   | `consentFact` นับว่าบันทึกแล้วเมื่อมีแค่เวอร์ชัน           | แดง 2 |
//   | `consentFact` ยอมรับ `consent_at` ที่เป็น 0               | แดง 1 |
//   | `licenseLabel` คืนข้อความให้ `unasked`                   | แดง 1 |

import { describe, it, expect } from 'vitest';
import { licenseFact, consentFact, licenseLabel } from './applicantFacts';

describe('licenseFact', () => {
  it('ตอบว่ามี / ไม่มี อ่านตรงตามที่ตอบ', () => {
    expect(licenseFact(true)).toEqual({ kind: 'yes' });
    expect(licenseFact(false)).toEqual({ kind: 'no' });
  });

  it('ใบที่ไม่เคยถูกถามต้องไม่กลายเป็น "ไม่มี"', () => {
    // **ข้อสำคัญที่สุดของไฟล์นี้** — ใบสมัครทุกใบที่ส่งมาก่อนฟอร์มจะมีคำถามนี้
    // และทุกตำแหน่งที่ไม่ต้องใช้ใบขับขี่ จะมาถึงตรงนี้เป็น undefined
    expect(licenseFact(undefined)).toEqual({ kind: 'unasked' });
    expect(licenseFact(null)).toEqual({ kind: 'unasked' });
  });

  it('ค่าที่ไม่ใช่ boolean ไม่ถูกอ่านเป็นคำตอบ', () => {
    // สตริง 'yes' เป็น truthy — ถ้าอ่านแบบ truthy จะกลายเป็น "มีใบขับขี่"
    // ทั้งที่เป็นข้อมูลผิดรูป ซึ่งแปลว่าเราไม่รู้จริงๆ ว่าเขาตอบอะไร
    expect(licenseFact('yes')).toEqual({ kind: 'unasked' });
    expect(licenseFact('no')).toEqual({ kind: 'unasked' });
    expect(licenseFact(1)).toEqual({ kind: 'unasked' });
    expect(licenseFact(0)).toEqual({ kind: 'unasked' });
  });
});

describe('consentFact', () => {
  it('มีเวลายินยอมจริง = บันทึกไว้แล้ว', () => {
    const f = consentFact({ consent_at: 1756000000000, consent_privacy_version: '2026-08-01' });
    expect(f).toEqual({ kind: 'recorded', version: '2026-08-01', at: 1756000000000 });
  });

  it('มีเวอร์ชันแต่ไม่มีเวลา = ยังไม่นับว่าบันทึก', () => {
    // รู้ว่าประกาศคือฉบับไหน ไม่ได้แปลว่ารู้ว่าเขากดยินยอมเมื่อไร
    expect(consentFact({ consent_privacy_version: '2026-08-01' })).toEqual({ kind: 'unrecorded' });
  });

  it('เวลาเป็น 0 หรืออ่านไม่ออก = ยังไม่นับว่าบันทึก', () => {
    expect(consentFact({ consent_at: 0 })).toEqual({ kind: 'unrecorded' });
    expect(consentFact({ consent_at: 'เมื่อวาน' })).toEqual({ kind: 'unrecorded' });
  });

  it('ใบเก่าที่ไม่มีอะไรเลย = ไม่มีบันทึก ไม่ใช่ปฏิเสธ', () => {
    expect(consentFact({})).toEqual({ kind: 'unrecorded' });
  });

  it('ยินยอมแล้วแต่ไม่รู้เวอร์ชัน ยังนับว่ายินยอม', () => {
    // เวอร์ชันหายเป็นข้อบกพร่องของบันทึก ไม่ใช่การถอนความยินยอม
    const f = consentFact({ consent_at: 1756000000000, consent_privacy_version: '  ' });
    expect(f).toEqual({ kind: 'recorded', version: null, at: 1756000000000 });
  });
});

describe('licenseLabel', () => {
  it('ขึ้นป้ายเฉพาะตอนมีคำตอบจริง', () => {
    expect(licenseLabel({ kind: 'yes' })).toBe('มีใบขับขี่');
    expect(licenseLabel({ kind: 'no' })).toBe('ไม่มีใบขับขี่');
  });

  it('ไม่เคยถาม = ไม่มีป้าย ไม่ใช่ป้ายว่าไม่มี', () => {
    expect(licenseLabel({ kind: 'unasked' })).toBeNull();
  });
});
