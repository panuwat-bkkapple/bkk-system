// getNetPayout ↔ functions/payout-ledger.js netPayoutOf และ logisticsRevenue.ts ↔ สำเนา
// server — fixture ชุดเดียวรันสองฝั่งแล้วเทียบ (รูปเดียวกับ riderPushHealth.test.ts)
// require ได้เพราะ payout-ledger.js pure ไม่แตะ firebase
//
// ทำไมต้องเท่ากันเป๊ะไม่ใช่แค่ใกล้เคียง: server ปฏิเสธการโอน (amount_changed) เมื่อ
// เลขที่จอส่งไปไม่เท่าเลขที่มันคิดเอง (ปัดเป็นบาท) — สูตรที่ต่างกันแม้กรณีเดียวคือปุ่ม
// โอนเงินที่กดไม่ผ่านโดยไม่มีใครรู้ว่าทำไม
//
// INJECTION (วัดจริง 4 ก.ย. 2569 — เขียนหลังรัน):
//   getNetPayout ไม่หัก rider_fee_discount                     → แดง __
//   getNetPayout ใช้ net_payout ที่เก็บไว้แทนคิดสด               → แดง __
//   effectiveCustomerPickupFee ไม่ดูคูปองส่งฟรี (TS)             → แดง __
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { getNetPayout } from './payoutNet';
import { effectiveCustomerPickupFee, buildLogisticsRevenueTx } from './logisticsRevenue';

const require = createRequire(import.meta.url);
const fn = require('../../functions/payout-ledger.js') as {
  netPayoutOf: (job: unknown) => number;
  effectiveCustomerPickupFee: (job: unknown) => number;
  buildLogisticsRevenueTx: (job: unknown, ts: number, opts?: { repair?: boolean }) => unknown;
};

const T = 1_700_000_000_000;

// เขียนจากรูปที่แถวจริงมี ไม่ใช่จาก spec: final_price ทับ price, ค่าส่งกับส่วนลด,
// คูปองทั้งสองรูป (array + เดี่ยว), adjustments ที่ยัง pending, ตัวเลขที่มาเป็น string
const FIXTURES: Array<[string, Record<string, unknown>]> = [
  ['Pickup ครบทุกก้อน', {
    id: 'J1', ref_no: 'OID-1', final_price: 22000, price: 25000, receive_method: 'Pickup', pickup_fee: 300, rider_fee_discount: 100,
    applied_coupons: [{ type: 'promo', value: 200 }, { type: 'service', value: 300 }],
    adjustments: [{ status: 'applied', amount: -500 }, { status: 'pending', amount: -999 }],
  }],
  ['Pickup ส่งฟรี (คูปอง service)', { id: 'J2', final_price: 15000, receive_method: 'Pickup', pickup_fee: 300, applied_coupons: [{ type: 'service', value: 300 }] }],
  ['Pickup ส่วนลดค่าไรเดอร์กลบเกินค่าส่ง', { id: 'J3', final_price: 5000, receive_method: 'Pickup', pickup_fee: 100, rider_fee_discount: 900 }],
  ['Store-in มี pickup_fee ค้าง (ต้องไม่หัก)', { id: 'J4', final_price: 10000, receive_method: 'Store-in', pickup_fee: 300 }],
  ['Mail-in ไม่มี final_price ใช้ price', { id: 'J5', price: 12000, receive_method: 'Mail-in' }],
  ['คูปองเดี่ยว applied_coupon (แถวเก่า)', { id: 'J6', final_price: 1000, applied_coupon: { value: 50 } }],
  ['คูปอง actual_value ก่อน value และ array ทับเดี่ยว', { id: 'J7', final_price: 1000, applied_coupons: [{ value: 100, actual_value: 60 }], applied_coupon: { value: 999 } }],
  ['adjustments เป็น object push-keyed', { id: 'J8', final_price: 1000, adjustments: { a: { status: 'applied', amount: 40 }, b: { status: 'rejected', amount: 999 } } }],
  ['ตัวเลขมาเป็น string', { id: 'J9', final_price: '9000', receive_method: 'Pickup', pickup_fee: '250', rider_fee_discount: '50' }],
  ['ราคาต่ำกว่าค่าส่ง (ไม่ติดลบ)', { id: 'J10', final_price: 100, receive_method: 'Pickup', pickup_fee: 300 }],
  ['B2B ล็อต (ไม่มี receive_method)', { id: 'J11', type: 'B2B Trade-in', price: 300000 }],
  ['ว่างเปล่า', { id: 'J12' }],
];

describe('getNetPayout ↔ functions/payout-ledger.js netPayoutOf', () => {
  it.each(FIXTURES)('%s', (_name, job) => {
    expect(getNetPayout(job)).toBe(fn.netPayoutOf(job));
  });

  it('เลขจริงของเคสหลัก — ไม่ใช่แค่สองฝั่งเท่ากัน (เท่ากันแบบผิดทั้งคู่ก็ได้)', () => {
    expect(getNetPayout(FIXTURES[0][1])).toBe(22000 - 200 + 200 - 500);
    expect(getNetPayout(FIXTURES[2][1])).toBe(5000);
    expect(getNetPayout(FIXTURES[3][1])).toBe(10000);
    expect(getNetPayout(FIXTURES[9][1])).toBe(0);
  });

  it('ไม่อ่าน net_payout ที่เก็บไว้ — ค่าค้างจาก path เก่าต้องไม่มีผล', () => {
    expect(getNetPayout({ final_price: 22000, net_payout: 99999 } as Record<string, unknown>)).toBe(22000);
  });
});

describe('logisticsRevenue.ts ↔ functions/payout-ledger.js', () => {
  it.each(FIXTURES)('effectiveCustomerPickupFee: %s', (_name, job) => {
    expect(effectiveCustomerPickupFee(job)).toBe(fn.effectiveCustomerPickupFee(job));
  });

  it.each(FIXTURES)('buildLogisticsRevenueTx: %s', (_name, job) => {
    expect(buildLogisticsRevenueTx(job, T)).toEqual(fn.buildLogisticsRevenueTx(job, T));
    expect(buildLogisticsRevenueTx(job, T, { repair: true })).toEqual(fn.buildLogisticsRevenueTx(job, T, { repair: true }));
  });

  it('มีทั้งเคสที่ได้แถวจริงและเคส null — เท่ากันแบบ null ทั้งคู่ไม่นับว่าพิสูจน์อะไร', () => {
    // fixture 0 มีคูปอง service (ส่งฟรี) จึงเป็น null โดยตั้งใจ; fixture 8 คือเคสที่มีแถว
    expect(buildLogisticsRevenueTx(FIXTURES[8][1], T)).toMatchObject({ amount: 200, rider_id: 'SYSTEM', ref_job_id: 'J9' });
    expect(buildLogisticsRevenueTx(FIXTURES[0][1], T)).toBeNull();
    expect(buildLogisticsRevenueTx(FIXTURES[1][1], T)).toBeNull();
  });
});
