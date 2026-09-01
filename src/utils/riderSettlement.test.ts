// เทสของ settledRiderFee — เขียนจากรูปข้อมูลจริงบน jobs/{id} ที่
// onJobHandedOverCalcRiderFee เขียน (rider_fee เป็นตัวเลขบาท > 0) และจาก
// สภาพจริงที่ทำให้บั๊กนี้เกิด: งานที่ rider_fee_status='Pending' (ไรเดอร์ตั้ง
// ตอนกดส่งมอบ) แต่ trigger ยังไม่เขียน rider_fee หรือเขียนไม่สำเร็จ
//
// ด่านที่ชุดนี้ตรึงไว้: ห้ามมีค่า default — ถ้าใครใส่ `|| 150` (หรือเลขอื่นใด)
// กลับเข้ามา เคส "ยังไม่มีค่ารอบ" จะแดงทันที เพราะหน้านี้จ่ายเงินจริง
import { describe, it, expect } from 'vitest';
import { settledRiderFee, buildRiderFeeApproval } from './riderSettlement';

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

// ─── การอนุมัติค่ารอบ ────────────────────────────────────────────────────────
//
// โค้ดที่สร้างเงินเข้ากระเป๋าคน ต้องยิงเทสตรงได้
describe('buildRiderFeeApproval', () => {
  const job = { id: 'j1', ref_no: 'OID-1', model: 'iPhone 15', rider_id: 'r1', rider_fee: 95 };
  const NOW = 1_756_000_000_000;

  it('เขียน jobs กับ transactions พร้อมกันในชุดเดียว (atomic)', () => {
    const u = buildRiderFeeApproval({ job, txKey: 't1', now: NOW })!;
    expect(u['jobs/j1/rider_fee_status']).toBe('Paid');
    expect(u['jobs/j1/settled_at']).toBe(NOW);
    expect(u['transactions/t1']).toMatchObject({
      rider_id: 'r1', amount: 95, type: 'CREDIT', category: 'JOB_PAYOUT', ref_job_id: 'j1',
    });
  });

  it('ยอดที่ลงกระเป๋าต้องเป็นค่ารอบที่ระบบประทับ ไม่ใช่ค่าประมาณ', () => {
    const u = buildRiderFeeApproval({ job: { ...job, rider_fee_estimate: 500 }, txKey: 't1', now: NOW })!;
    expect(u['transactions/t1'].amount).toBe(95);
  });

  it('ไม่มีค่ารอบที่ประทับ = จ่ายไม่ได้ คืน null', () => {
    const { rider_fee, ...noFee } = job;
    expect(buildRiderFeeApproval({ job: noFee, txKey: 't1', now: NOW })).toBeNull();
    expect(buildRiderFeeApproval({ job: { ...noFee, rider_fee_estimate: 90 }, txKey: 't1', now: NOW })).toBeNull();
  });

  it('ค่ารอบศูนย์ต่างจากยังไม่คำนวณ — ทั้งคู่จ่ายไม่ได้แต่คนละเหตุผล', () => {
    expect(buildRiderFeeApproval({ job: { ...job, rider_fee: 0 }, txKey: 't1', now: NOW })).toBeNull();
  });

  it('จ่ายไปแล้วต้องไม่จ่ายซ้ำ', () => {
    expect(buildRiderFeeApproval({ job: { ...job, rider_fee_status: 'Paid' }, txKey: 't1', now: NOW })).toBeNull();
  });

  it('งานที่ไรเดอร์ยกเลิกแต่ยังมีค่าเสียเวลา จ่ายให้คนที่ทำงานจริงได้', () => {
    const cancelled = { ...job, rider_id: null, cancelled_by: 'rider:r9', rider_fee: 40 };
    const u = buildRiderFeeApproval({ job: cancelled, txKey: 't1', now: NOW })!;
    expect(u['transactions/t1'].rider_id).toBe('r9');
  });

  it('ไม่รู้ว่าจ่ายให้ใคร = ไม่จ่าย (ห้ามสร้างแถวที่ไม่มีเจ้าของ)', () => {
    expect(buildRiderFeeApproval({ job: { ...job, rider_id: null }, txKey: 't1', now: NOW })).toBeNull();
    expect(buildRiderFeeApproval({ job: { ...job, rider_id: null, cancelled_by: 'customer' }, txKey: 't1', now: NOW })).toBeNull();
  });

  it('ไม่มี txKey = ไม่เขียน (กันแถวที่ทับกันเอง)', () => {
    expect(buildRiderFeeApproval({ job, txKey: '', now: NOW })).toBeNull();
  });

  it('บันทึกคนอนุมัติเมื่อส่งมา และไม่เขียนคีย์เปล่าเมื่อไม่ส่ง', () => {
    const withBy = buildRiderFeeApproval({ job, txKey: 't1', now: NOW, approvedBy: 'staff-7' })!;
    expect(withBy['jobs/j1/rider_fee_approved_by']).toBe('staff-7');
    const without = buildRiderFeeApproval({ job, txKey: 't1', now: NOW })!;
    expect('jobs/j1/rider_fee_approved_by' in without).toBe(false);
  });
});
