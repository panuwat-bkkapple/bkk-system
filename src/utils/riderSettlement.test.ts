// เทสของ settledRiderFee — เขียนจากรูปข้อมูลจริงบน jobs/{id} ที่
// onJobHandedOverCalcRiderFee เขียน (rider_fee เป็นตัวเลขบาท > 0) และจาก
// สภาพจริงที่ทำให้บั๊กนี้เกิด: งานที่ rider_fee_status='Pending' (ไรเดอร์ตั้ง
// ตอนกดส่งมอบ) แต่ trigger ยังไม่เขียน rider_fee หรือเขียนไม่สำเร็จ
//
// ด่านที่ชุดนี้ตรึงไว้: ห้ามมีค่า default — ถ้าใครใส่ `|| 150` (หรือเลขอื่นใด)
// กลับเข้ามา เคส "ยังไม่มีค่ารอบ" จะแดงทันที เพราะหน้านี้จ่ายเงินจริง
//
// ส่วน buildRiderFeeApproval ย้ายไป functions/rider-fee-guard.js (5 ก.ย. 2569) —
// เทสของมันอยู่ functions/test/rider-fee-guard.test.mjs. ที่นี่เหลือด่าน UX
// (riderFeeBlockReason) ซึ่งเป็น MIRROR ของ JS ตัวจริง จึงรันสองสำเนาบน fixture
// เดียวกันแบบเดียวกับ riderCostSplitParity
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { settledRiderFee, riderFeeBlockReason, payoutRiderIdOf } from './riderSettlement';

const require = createRequire(import.meta.url);
const guard = require('../../functions/rider-fee-guard.js') as {
  riderFeeBlockReason: typeof riderFeeBlockReason;
  payoutRiderIdOf: typeof payoutRiderIdOf;
  settledRiderFee: typeof settledRiderFee;
};

describe('settledRiderFee', () => {
  it('ค่ารอบที่ประทับแล้วคืนเป็นตัวเลข', () => {
    expect(settledRiderFee({ rider_fee: 95 })).toBe(95);
    expect(settledRiderFee({ rider_fee: 100.5 })).toBe(100.5);
  });

  it('ยังไม่มีค่ารอบ = null ห้ามคืนเลขที่แต่งขึ้น', () => {
    expect(settledRiderFee({})).toBeNull();
    expect(settledRiderFee({ rider_fee: undefined })).toBeNull();
    expect(settledRiderFee({ rider_fee: null })).toBeNull();
    expect(settledRiderFee(null)).toBeNull();
  });

  it('0 และค่าติดลบไม่ใช่ค่ารอบที่จ่ายได้', () => {
    expect(settledRiderFee({ rider_fee: 0 })).toBeNull();
    expect(settledRiderFee({ rider_fee: -20 })).toBeNull();
  });

  it('ค่าที่ไม่ใช่ตัวเลขไม่ถูกตีความเป็นเงิน', () => {
    expect(settledRiderFee({ rider_fee: 'abc' })).toBeNull();
    expect(settledRiderFee({ rider_fee: NaN })).toBeNull();
    expect(settledRiderFee({ rider_fee: Infinity })).toBeNull();
  });

  it('rider_fee_estimate ไม่ใช่ค่ารอบที่จ่ายได้', () => {
    expect(settledRiderFee({ rider_fee_estimate: 90 })).toBeNull();
  });
});

const OWNER = 'owner-uid';
const owners = new Set([OWNER]);

const CASES: [string, Record<string, unknown> | null, 'no_rider' | 'owner_rider' | null][] = [
  ['ไรเดอร์จ้างปกติ', { id: 'j1', rider_id: 'r1' }, null],
  ['บัญชีเจ้าของ', { id: 'j2', rider_id: OWNER }, 'owner_rider'],
  ['rider_id ว่าง (undefined)', { id: 'j3' }, 'no_rider'],
  ['rider_id ว่าง (null)', { id: 'j4', rider_id: null }, 'no_rider'],
  ['rider_id สตริงว่าง — ปุ่ม batch รุ่นเก่าปล่อยผ่าน', { id: 'j5', rider_id: '' }, 'no_rider'],
  ['rider_id ช่องว่างล้วน', { id: 'j6', rider_id: '   ' }, 'no_rider'],
  ['ยกเลิกโดยไรเดอร์ — จ่ายให้คนที่ทำงานจริง', { id: 'j7', rider_id: null, cancelled_by: 'rider:r9' }, null],
  ['ยกเลิกโดยเจ้าของ (rider:OWNER)', { id: 'j8', rider_id: null, cancelled_by: `rider:${OWNER}` }, 'owner_rider'],
  ['ยกเลิกโดยลูกค้า — ไม่รู้ว่าจ่ายให้ใคร', { id: 'j9', rider_id: null, cancelled_by: 'customer' }, 'no_rider'],
  ['งานว่างเปล่า', null, 'no_rider'],
];

describe('riderFeeBlockReason — ด่าน UX ต้องตอบเหมือน functions/rider-fee-guard.js', () => {
  it.each(CASES)('%s', (_name, job, expected) => {
    expect(riderFeeBlockReason(job, owners)).toBe(expected);
    expect(guard.riderFeeBlockReason(job, owners)).toBe(expected);
    expect(payoutRiderIdOf(job)).toBe(guard.payoutRiderIdOf(job));
  });

  it('รายชื่อเจ้าของว่าง = ไม่มีใครเป็นเจ้าของ (ฝั่ง server แยกต่างหากว่าไม่ตั้ง env = ปฏิเสธทั้งหมด)', () => {
    expect(riderFeeBlockReason({ rider_id: OWNER }, new Set())).toBeNull();
    expect(guard.riderFeeBlockReason({ rider_id: OWNER }, new Set())).toBeNull();
  });

  it('settledRiderFee สองสำเนาตอบเท่ากัน', () => {
    for (const v of [95, 0, -1, 'abc', undefined, null, NaN, Infinity, '80']) {
      expect(settledRiderFee({ rider_fee: v })).toBe(guard.settledRiderFee({ rider_fee: v }));
    }
  });
});
