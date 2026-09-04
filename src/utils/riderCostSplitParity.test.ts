// สองสำเนาของ splitWithdrawal ต้องตอบเท่ากันบน fixture ชุดเดียวกัน
//
// ตัวจริง = functions/rider-cost-split.js (ลงบัญชีค่าจ้างตอนถอน + ฐานภาษี 50 ทวิ)
// สำเนา   = src/utils/riderCostSplit.ts   (หน้าจอโอนเงินต้องเห็นยอดสุทธิก่อนโอน)
//
// โหลด JS ด้วย createRequire (โมดูล CommonJS ไม่มี dependency) แล้วรันทั้งคู่
// บนเคสเดียวกับ functions/test/rider-cost-split.test.mjs — drift โผล่ที่นี่
// ไม่ใช่ที่บัญชีไรเดอร์

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { splitWithdrawal as splitTs, splitPendingWithdrawal } from './riderCostSplit';

const require = createRequire(import.meta.url);
const { splitWithdrawal: splitJs } = require('../../functions/rider-cost-split.js') as {
  splitWithdrawal: typeof splitTs;
};

let clock = 1_000;
const tick = () => (clock += 1_000);
const payout = (id: string, amount: number) => ({ id, type: 'CREDIT', category: 'JOB_PAYOUT', amount, timestamp: tick() });
const refund = (id: string, amount: number) => ({ id, type: 'CREDIT', category: 'EXPENSE_REIMBURSEMENT', amount, timestamp: tick() });
const withdraw = (id: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'DEBIT', category: 'WITHDRAWAL', amount, timestamp: tick(), ...extra });

const CASES: [string, ReturnType<typeof payout>[], string][] = [
  ['ค่าจ้างล้วน', [payout('t1', 1000), withdraw('w1', 1000)], 'w1'],
  ['เงินคืนล้วน', [refund('r1', 65), withdraw('w1', 65)], 'w1'],
  ['ปนกัน', [payout('t1', 1000), refund('r1', 65), withdraw('w1', 1065)], 'w1'],
  ['ถอนน้อยกว่าเงินคืน (FIFO)', [payout('t1', 1000), refund('r1', 500), withdraw('w1', 200)], 'w1'],
  ['ครั้งที่สองหลังครั้งแรกกิน pool (มี reimbursed_part)', [refund('r1', 100), payout('t1', 900), withdraw('w1', 300, { reimbursed_part: 100 }), withdraw('w2', 700)], 'w2'],
  ['ครั้งที่สองหลังครั้งแรกกิน pool (ไม่มีฟิลด์)', [refund('r1', 100), payout('t1', 900), withdraw('w1', 300), withdraw('w2', 700)], 'w2'],
  ['ไม่เห็นอนาคต', [payout('t1', 1000), withdraw('w1', 500), refund('r1', 65), withdraw('w2', 565)], 'w1'],
  ['เห็นเงินคืนระหว่างทาง', [payout('t1', 1000), withdraw('w1', 500), refund('r1', 65), withdraw('w2', 565)], 'w2'],
  ['ทศนิยม', [payout('t1', 100.555), withdraw('w1', 100.555)], 'w1'],
  ['ไม่ใช่การถอน', [payout('t1', 100)], 't1'],
  ['หาไม่เจอ', [payout('t1', 100)], 'nope'],
];

describe('splitWithdrawal — TS ตอบเท่ากับ JS ทุกเคส', () => {
  it.each(CASES)('%s', (_label, rows, txId) => {
    expect(splitTs(rows, txId)).toEqual(splitJs(rows, txId));
  });

  it('เวลาเท่ากัน ลำดับที่ส่งมาไม่เปลี่ยนผล (ทั้งสองฝั่ง)', () => {
    const a = { id: 'aaa', type: 'CREDIT', category: 'EXPENSE_REIMBURSEMENT', amount: 50, timestamp: 5000 };
    const b = { id: 'bbb', type: 'DEBIT', category: 'WITHDRAWAL', amount: 50, timestamp: 5000 };
    expect(splitTs([a, b], 'bbb')).toEqual(splitTs([b, a], 'bbb'));
    expect(splitTs([a, b], 'bbb')).toEqual(splitJs([a, b], 'bbb'));
  });
});

describe('splitPendingWithdrawal — แถวที่ยังไม่ได้เขียน', () => {
  it('ให้ผลเท่ากับการแยกแถวจริงที่จะถูกเขียนถัดไป', () => {
    const rows = [payout('t1', 1000), refund('r1', 65)];
    const pending = splitPendingWithdrawal(rows, 1065, tick());
    const real = splitJs([...rows, withdraw('w1', 1065)], 'w1');
    expect(pending).toEqual(real);
  });

  it('ไม่มีแถวเลย = ค่าจ้างล้วน (ไม่มี pool ให้กิน)', () => {
    expect(splitPendingWithdrawal([], 500, 1)).toEqual({ gross: 500, reimbursed: 0, labour: 500 });
  });
});
