import { describe, it, expect } from 'vitest';
import { evaluateFinanceGate } from './financeGate';

describe('evaluateFinanceGate', () => {
  it('CEO ผ่านเสมอ แม้ไม่มี claim และเปิด enforcement แล้ว', () => {
    expect(evaluateFinanceGate({ role: 'CEO', hasClaim: false, enforce: true }))
      .toEqual({ allowed: true, reason: 'ceo' });
  });

  it('CEO ตัวพิมพ์เล็กก็ยังเป็น CEO (role ใน session ไม่ได้ normalize ทุกทาง)', () => {
    expect(evaluateFinanceGate({ role: 'ceo', hasClaim: false, enforce: true }).allowed).toBe(true);
  });

  it('มี claim = ผ่าน แม้ role ไม่ใช่ CEO — นี่คือทางที่ตั้งใจให้ FINANCE ใช้', () => {
    expect(evaluateFinanceGate({ role: 'FINANCE', hasClaim: true, enforce: true }))
      .toEqual({ allowed: true, reason: 'claim' });
  });

  // ข้อนี้คือทั้งหมดของ dual-read: คนเดิมต้องทำงานได้ปกติในวันที่ deploy
  it('ไม่มี claim + ยังไม่เปิด enforcement = ผ่านแบบ legacy', () => {
    expect(evaluateFinanceGate({ role: 'MANAGER', hasClaim: false, enforce: false }))
      .toEqual({ allowed: true, reason: 'legacy_admin' });
  });

  it('ไม่มี claim + เปิด enforcement แล้ว = ถูกปฏิเสธ พร้อมข้อความไทย', () => {
    const v = evaluateFinanceGate({ role: 'MANAGER', hasClaim: false, enforce: true });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('no_claim');
    expect(v.message).toBeTruthy();
  });

  it('role ที่หายไป/ว่าง ไม่ถูกเข้าใจผิดว่าเป็น CEO', () => {
    expect(evaluateFinanceGate({ role: undefined, hasClaim: false, enforce: true }).allowed).toBe(false);
    expect(evaluateFinanceGate({ role: null, hasClaim: false, enforce: true }).allowed).toBe(false);
    expect(evaluateFinanceGate({ role: '', hasClaim: false, enforce: true }).allowed).toBe(false);
  });

  // ลำดับความสำคัญต้องแยกได้จริง ไม่ใช่กฎสองข้อที่กลบกันเอง:
  // ถ้าสลับข้อ 1 กับ 4 เคสนี้จะเปลี่ยนคำตอบทันที
  it('เหตุผลที่คืนมาบอกได้ว่าผ่านมาทางไหน ไม่ใช่แค่ผ่าน', () => {
    expect(evaluateFinanceGate({ role: 'CEO', hasClaim: true, enforce: true }).reason).toBe('ceo');
    expect(evaluateFinanceGate({ role: 'STAFF', hasClaim: true, enforce: false }).reason).toBe('claim');
    expect(evaluateFinanceGate({ role: 'STAFF', hasClaim: false, enforce: false }).reason).toBe('legacy_admin');
  });
});
