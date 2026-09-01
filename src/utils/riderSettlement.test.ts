// เทสของ settledRiderFee — เขียนจากรูปข้อมูลจริงบน jobs/{id} ที่
// onJobHandedOverCalcRiderFee เขียน (rider_fee เป็นตัวเลขบาท > 0) และจาก
// สภาพจริงที่ทำให้บั๊กนี้เกิด: งานที่ rider_fee_status='Pending' (ไรเดอร์ตั้ง
// ตอนกดส่งมอบ) แต่ trigger ยังไม่เขียน rider_fee หรือเขียนไม่สำเร็จ
//
// ด่านที่ชุดนี้ตรึงไว้: ห้ามมีค่า default — ถ้าใครใส่ `|| 150` (หรือเลขอื่นใด)
// กลับเข้ามา เคส "ยังไม่มีค่ารอบ" จะแดงทันที เพราะหน้านี้จ่ายเงินจริง
import { describe, it, expect } from 'vitest';
import { settledRiderFee } from './riderSettlement';

describe('settledRiderFee', () => {
  it('ค่ารอบที่ประทับแล้วคืนเป็นตัวเลข', () => {
    expect(settledRiderFee({ rider_fee: 240 })).toBe(240);
    expect(settledRiderFee({ rider_fee: 100 })).toBe(100);
  });

  it('ยังไม่มีค่ารอบ = null ห้ามคืนเลขที่แต่งขึ้น', () => {
    expect(settledRiderFee({})).toBeNull();
    expect(settledRiderFee({ rider_fee: null })).toBeNull();
    expect(settledRiderFee({ rider_fee: undefined })).toBeNull();
    expect(settledRiderFee(null)).toBeNull();
  });

  it('0 และค่าติดลบไม่ใช่ค่ารอบที่จ่ายได้', () => {
    // 0 มาจากงานที่ trigger ข้าม (ไม่ใช่ Pickup) — จ่าย 0 ไม่มีความหมาย
    expect(settledRiderFee({ rider_fee: 0 })).toBeNull();
    expect(settledRiderFee({ rider_fee: -50 })).toBeNull();
  });

  it('ค่าที่ไม่ใช่ตัวเลขไม่ถูกตีความเป็นเงิน', () => {
    expect(settledRiderFee({ rider_fee: 'ยังไม่คิด' })).toBeNull();
    expect(settledRiderFee({ rider_fee: NaN })).toBeNull();
    // สตริงตัวเลขจาก RTDB ยังอ่านได้ (Number แปลงให้) — เป็นค่ารอบจริง
    expect(settledRiderFee({ rider_fee: '240' })).toBe(240);
  });

  it('rider_fee_estimate ไม่ใช่ค่ารอบที่จ่ายได้', () => {
    // ประมาณการมาจากระยะทางจริงก็จริง แต่ไม่ใช่ค่าปิดงาน — หน้าจ่ายเงิน
    // ต้องรอเลขที่ประทับตอนส่งมอบเท่านั้น (ดูคำอธิบายใน riderSettlement.ts)
    expect(settledRiderFee({ rider_fee_estimate: 180 })).toBeNull();
  });
});
