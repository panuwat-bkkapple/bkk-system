// เทสนิยาม "รายได้ค่าบริการรับเครื่อง" — เขียนจากบั๊กจริงที่วัดบน production
// (31 ส.ค. 2569): แถวรายได้บริษัทเคยติด rider_id ของไรเดอร์ (กระเป๋าบวม 3,776)
// และยอดเคยเป็น rider_fee (ต้นทุน) แทนค่าส่งที่เก็บจากลูกค้า
import { describe, it, expect } from 'vitest';
import {
  buildLogisticsRevenueTx,
  effectiveCustomerPickupFee,
  hasFreeDeliveryCoupon,
} from './logisticsRevenue';

const pickupJob = (over: Record<string, unknown> = {}) => ({
  id: 'job1',
  ref_no: 'BKK-001',
  receive_method: 'Pickup',
  pickup_fee: 120,
  rider_fee_discount: 0,
  rider_fee: 251, // ต้นทุนไรเดอร์ — ต้องไม่โผล่ในแถวรายได้เด็ดขาด
  rider_id: 'RIDER_UID',
  ...over,
});

describe('effectiveCustomerPickupFee', () => {
  it('Pickup: gross ลบส่วนลดที่บริษัท absorb, ไม่ติดลบ', () => {
    expect(effectiveCustomerPickupFee(pickupJob())).toBe(120);
    expect(effectiveCustomerPickupFee(pickupJob({ rider_fee_discount: 40 }))).toBe(80);
    expect(effectiveCustomerPickupFee(pickupJob({ rider_fee_discount: 999 }))).toBe(0);
  });
  it('ไม่ใช่ Pickup = ไม่มีค่าบริการ แม้ pickup_fee จะค้างค่าอยู่', () => {
    expect(effectiveCustomerPickupFee(pickupJob({ receive_method: 'Store-in' }))).toBe(0);
    expect(effectiveCustomerPickupFee(pickupJob({ receive_method: 'Mail-in' }))).toBe(0);
    expect(effectiveCustomerPickupFee(null)).toBe(0);
  });
  it('คูปองส่งฟรี (type service) = บริษัทไม่ได้เก็บ = 0 (เศรษฐศาสตร์เดียวกับตอนสร้างงาน)', () => {
    const job = pickupJob({ applied_coupons: [{ code: 'FREE', type: 'service', value: 0 }] });
    expect(hasFreeDeliveryCoupon(job)).toBe(true);
    expect(effectiveCustomerPickupFee(job)).toBe(0);
  });
});

describe('buildLogisticsRevenueTx', () => {
  it('แถวรายได้บริษัท: rider_id = SYSTEM เสมอ แม้งานมีไรเดอร์ และยอด = ค่าส่งลูกค้า ไม่ใช่ rider_fee', () => {
    const tx = buildLogisticsRevenueTx(pickupJob({ rider_fee_discount: 20 }), 1725100000000);
    expect(tx).not.toBeNull();
    expect(tx!.rider_id).toBe('SYSTEM');
    expect(tx!.amount).toBe(100); // 120 − 20 — ห้ามเป็น 251 (rider_fee)
    expect(tx!.type).toBe('CREDIT');
    expect(tx!.category).toBe('LOGISTICS_REVENUE');
    expect(tx!.ref_job_id).toBe('job1');
    expect(tx!.timestamp).toBe(1725100000000);
    expect(tx!.description).toContain('BKK-001');
  });
  it('ไม่มีค่าบริการ = คืน null ไม่ใช่แถวศูนย์บาท', () => {
    expect(buildLogisticsRevenueTx(pickupJob({ pickup_fee: 0 }), 1)).toBeNull();
    expect(buildLogisticsRevenueTx(pickupJob({ receive_method: 'Store-in' }), 1)).toBeNull();
    expect(
      buildLogisticsRevenueTx(pickupJob({ applied_coupons: [{ type: 'service' }] }), 1),
    ).toBeNull();
    expect(buildLogisticsRevenueTx(null, 1)).toBeNull();
  });
  it('โหมดซ่อมติด prefix [ซ่อม] และ fallback ref เป็น id เมื่อไม่มี ref_no', () => {
    const tx = buildLogisticsRevenueTx(pickupJob({ ref_no: undefined }), 1, { repair: true });
    expect(tx!.description.startsWith('[ซ่อม] ')).toBe(true);
    expect(tx!.description).toContain('job1');
  });
  it('fallback คูปองใบเดี่ยว applied_coupon (งานเก่า) ก็ต้องเห็นคูปอง service', () => {
    const job = pickupJob({ applied_coupon: { code: 'FREE', type: 'service' } });
    expect(buildLogisticsRevenueTx(job, 1)).toBeNull();
  });
});
