import { describe, it, expect } from 'vitest';
import { wasRiderWithdrawn, riderWithdrawnAt } from './riderWithdrawal';

describe('wasRiderWithdrawn', () => {
  it('รูปใหม่: engine ประทับ withdrawn_at + withdrawn_by', () => {
    expect(wasRiderWithdrawn({ withdrawn_at: 1, withdrawn_by: 'rider:r1' })).toBe(true);
  });

  it('รูปเดิม: ไคลเอนต์เขียน cancelled_at + cancelled_by', () => {
    // งานยุคก่อน cutover ยังต้องขึ้นปุ่ม Re-broadcast กับแบนเนอร์เหมือนเดิม
    expect(wasRiderWithdrawn({ cancelled_at: 1, cancelled_by: 'rider:r1' })).toBe(true);
  });

  it('ลูกค้าหรือแอดมินยกเลิก ไม่ใช่ไรเดอร์ทิ้งงาน', () => {
    // เคสนี้คือเหตุผลที่ต้องเช็ค *_by ไม่ใช่แค่ *_at — งานที่ถูกยกเลิกจริง
    // ต้องไม่ขึ้นปุ่ม "ส่งให้ไรเดอร์ใหม่"
    expect(wasRiderWithdrawn({ cancelled_at: 1, cancelled_by: 'customer' })).toBe(false);
    expect(wasRiderWithdrawn({ cancelled_at: 1, cancelled_by: 'admin:a1' })).toBe(false);
  });

  it('มีเวลาแต่ไม่มีคนทิ้ง = ไม่นับ', () => {
    expect(wasRiderWithdrawn({ cancelled_at: 1 })).toBe(false);
    expect(wasRiderWithdrawn({ withdrawn_at: 1 })).toBe(false);
  });

  it('มีคนทิ้งแต่ไม่มีเวลา = ไม่นับ', () => {
    expect(wasRiderWithdrawn({ withdrawn_by: 'rider:r1' })).toBe(false);
  });

  it('งานว่างเปล่า / null ไม่ throw', () => {
    expect(wasRiderWithdrawn({})).toBe(false);
    expect(wasRiderWithdrawn(null)).toBe(false);
    expect(wasRiderWithdrawn(undefined)).toBe(false);
  });
});

describe('riderWithdrawnAt', () => {
  it('รูปใหม่ชนะรูปเดิมเมื่อมีทั้งคู่', () => {
    // งานที่เคยถูกทิ้งยุคเก่าแล้วถูกทิ้งอีกครั้งหลัง cutover — แอดมินต้องเห็น
    // ครั้งล่าสุด ไม่ใช่ครั้งแรก
    const at = riderWithdrawnAt({
      withdrawn_at: 200, withdrawn_by: 'rider:r2',
      cancelled_at: 100, cancelled_by: 'rider:r1',
    });
    expect(at).toBe(200);
  });

  it('ไม่เคยถูกทิ้ง = null ไม่ใช่ 0', () => {
    expect(riderWithdrawnAt({ cancelled_at: 5, cancelled_by: 'customer' })).toBe(null);
  });
});
