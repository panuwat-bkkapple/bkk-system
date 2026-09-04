// สองสำเนาของ splitWithdrawal ต้องตอบเท่ากันบน fixture ชุดเดียวกัน
//
// ตัวจริง = functions/rider-cost-split.js (ลงบัญชีค่าจ้างตอนถอน + ฐานภาษี 50 ทวิ)
// สำเนา   = src/utils/riderCostSplit.ts   (หน้าจอโอนเงินต้องเห็นยอดสุทธิก่อนโอน)
//
// โหลด JS ด้วย createRequire (โมดูล CommonJS ไม่มี dependency) แล้วรันทั้งคู่
// บนเคสเดียวกับ functions/test/rider-cost-split.test.mjs — drift โผล่ที่นี่
// ไม่ใช่ที่บัญชีไรเดอร์
//
// ตาราง injection เต็มอยู่หัวไฟล์ JS นั้น สรุปที่เกี่ยวกับไฟล์นี้ (4 ก.ย. 2569):
// parity อย่างเดียว **มองไม่เห็นตอนสองสำเนาผิดเหมือนกัน** — เคสที่ต้องมีตัวเลข
// คาดหวังจริงจึงมี `it.each('ตัวเลขที่ต้องได้จริง')` แยกต่างหาก. สามเคสที่เพิ่มหลัง
// injection เขียว: ธงชนะหมวดบนตัวเลขไม่สมมาตร (100/30 ไม่ใช่ 100/100) ·
// exempt_part ที่ประทับต่างจาก FIFO · เงินคืนมาทีหลังโดยไม่มี w2 มาบัง

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { splitWithdrawal as splitTs, splitPendingWithdrawal, type LedgerRow } from './riderCostSplit';

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
  ['ไม่เห็นอนาคต', [payout('t1', 1000), withdraw('w1', 500), refund('r1', 65)], 'w1'],
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
    expect(splitPendingWithdrawal([], 500, 1)).toEqual({ gross: 500, exempt: 0, taxable: 500, reimbursed: 0, labour: 500 });
  });
});

describe('ธง taxable — TS ตอบเท่ากับ JS และ acceptance ของเจ้าของงาน', () => {
  const flagged = (id: string, category: string, amount: number, taxable: boolean) =>
    ({ id, type: 'CREDIT', category, amount, taxable, timestamp: tick() });

  const FLAG_CASES: [string, LedgerRow[], string][] = [
    // ตัวเลขสองฝั่งต้องไม่เท่ากัน — 100/100 ทำให้การอ่านธงผิดด้านให้ผลเดิม (injection I8 เคยเขียว)
    ['ธงชนะชื่อหมวด', [flagged('r', 'EXPENSE_REIMBURSEMENT', 100, true), flagged('f', 'JOB_PAYOUT', 30, false), withdraw('w', 130)], 'w'],
    ['หมวดใหม่ไม่มีธง', [{ ...payout('a', 200), category: 'COMPANY_ADVANCE' }, { ...payout('d', 300), category: 'RIDER_DEPOSIT' }, payout('f', 500), withdraw('w', 800)], 'w'],
    ['หมวดไม่รู้จัก', [{ ...payout('x', 100), category: 'SOMETHING_NEW' }, withdraw('w', 100)], 'w'],
    ['exempt_part บนแถวถอนเก่า', [flagged('d', 'RIDER_DEPOSIT', 100, false), payout('f', 900), withdraw('w1', 300, { exempt_part: 100 }), withdraw('w2', 700)], 'w2'],
    // ค่าที่ประทับต่างจากที่ FIFO เดา (แถวเงินเข้าถูกแก้ป้ายหลัง w1 ลงบัญชีไปแล้ว)
    ['exempt_part ชนะการเดา FIFO', [{ ...flagged('b', 'RIDER_DEPOSIT', 100, false), category_was: 'BONUS' }, payout('f', 900), withdraw('w1', 300, { exempt_part: 0 }), withdraw('w2', 700)], 'w2'],
    // เงินคืนมาถึงหลังการถอน และไม่มี w2 ตามหลังมาบัง (injection I7 เคยเขียวเพราะ w2 กินกองพอดี)
    ['เงินคืนที่มาทีหลัง ไม่มีการถอนถัดไปบัง', [payout('f', 1000), withdraw('w1', 500), refund('r', 65)], 'w1'],
  ];
  it.each(FLAG_CASES)('%s', (_l, rows, txId) => {
    expect(splitTs(rows, txId)).toEqual(splitJs(rows, txId));
  });

  it.each([
    ['ธงชนะชื่อหมวด (ไม่สมมาตร)', 'ธงชนะชื่อหมวด', { exempt: 30, taxable: 100 }],
    ['exempt_part ชนะการเดา FIFO', 'exempt_part ชนะการเดา FIFO', { exempt: 100, taxable: 600 }],
    ['เงินคืนที่มาทีหลัง', 'เงินคืนที่มาทีหลัง ไม่มีการถอนถัดไปบัง', { exempt: 0, taxable: 500 }],
  ])('ตัวเลขที่ต้องได้จริง: %s', (_l, key, want) => {
    const found = FLAG_CASES.find(([label]) => label === key);
    expect(found).toBeDefined();
    const [, rows, txId] = found!;
    const s = splitTs(rows, txId);
    expect({ exempt: s!.exempt, taxable: s!.taxable }).toEqual(want);
  });

  it('Scenario A: กระเป๋า 520 ถอน 20 → ฐาน 0', () => {
    const rows = [flagged('f', 'JOB_PAYOUT', 500, true), flagged('p', 'EXPENSE_REIMBURSEMENT', 20, false)];
    const s = splitPendingWithdrawal(rows, 20, tick());
    expect({ exempt: s.exempt, taxable: s.taxable }).toEqual({ exempt: 20, taxable: 0 });
  });

  it('Scenario B: กระเป๋า 520 ถอน 520 → ฐาน 500', () => {
    const rows = [flagged('f', 'JOB_PAYOUT', 500, true), flagged('p', 'EXPENSE_REIMBURSEMENT', 20, false)];
    const s = splitPendingWithdrawal(rows, 520, tick());
    expect({ exempt: s.exempt, taxable: s.taxable }).toEqual({ exempt: 20, taxable: 500 });
  });

  it('ชื่อเดิมกับชื่อใหม่ชี้ตัวเลขเดียวกัน (ผู้อ่านเดิมไม่เห็นความเปลี่ยนแปลง)', () => {
    const s = splitPendingWithdrawal([flagged('p', 'EXPENSE_REIMBURSEMENT', 65, false), payout('f', 1000)], 1065, tick());
    expect(s.labour).toBe(s.taxable);
    expect(s.reimbursed).toBe(s.exempt);
  });
});

describe('WALLET_CREDIT_TAXABLE ↔ NON_TAXABLE_CREDIT_CATEGORIES — สองสำเนาของกฎเดียวกัน', () => {
  it('หมวดที่ตารางกลางบอกว่าไม่ใช่เงินได้ ต้องตรงกับ fallback ของตัวแยกทั้ง TS และ JS', async () => {
    const { WALLET_CREDIT_TAXABLE } = await import('./transactionLogger');
    const { NON_TAXABLE_CREDIT_CATEGORIES: tsSet } = await import('./riderCostSplit');
    const { NON_TAXABLE_CREDIT_CATEGORIES: jsSet } = require('../../functions/rider-cost-split.js') as { NON_TAXABLE_CREDIT_CATEGORIES: Set<string> };
    // หมวดเงินเข้าที่ taxable === false ในตารางกลาง (ตัด WITHDRAWAL/PENALTY ซึ่งเป็นเงินออก)
    const fromTable = new Set(
      Object.entries(WALLET_CREDIT_TAXABLE)
        .filter(([k, v]) => v === false && k !== 'WITHDRAWAL' && k !== 'PENALTY')
        .map(([k]) => k),
    );
    expect(new Set(tsSet)).toEqual(fromTable);
    expect(new Set(jsSet)).toEqual(fromTable);
  });
});

describe('Partial Withdrawal with Mixed Funds — เคสของเจ้าของงาน (570 → ถอน 300)', () => {
  const flagged = (id: string, category: string, amount: number, taxable: boolean) =>
    ({ id, type: 'CREDIT', category, amount, taxable, timestamp: tick() });
  const base = () => [flagged('f', 'JOB_PAYOUT', 550, true), flagged('p', 'EXPENSE_REIMBURSEMENT', 20, false)];

  it('ถอน 300 → ไม่ใช่เงินได้ 20 / เงินได้ 280 (ทั้งสองสำเนาตอบเท่ากัน)', () => {
    const rows = [...base(), withdraw('w1', 300)];
    const ts = splitTs(rows, 'w1');
    expect(ts).toEqual(splitJs(rows, 'w1'));
    expect({ exempt: ts!.exempt, taxable: ts!.taxable }).toEqual({ exempt: 20, taxable: 280 });
  });

  it('ภาษี 3% ของ 280 = 8.40 โอน 291.60', async () => {
    const { computeRiderWht } = await import('./riderWht');
    const s = splitPendingWithdrawal(base(), 300, tick());
    const w = computeRiderWht(300, 'freelance', { enabled: true, ratePercent: 3 }, { taxableBase: s.taxable });
    expect({ base: w.taxableBase, wht: w.wht, net: w.net }).toEqual({ base: 280, wht: 8.4, net: 291.6 });
  });

  it('270 ที่เหลือเป็นเงินได้ล้วนในการถอนครั้งถัดไป — ไม่ว่าแถวแรกจะถูกประทับ exempt_part แล้วหรือไม่', () => {
    const stamped = [...base(), withdraw('w1', 300, { exempt_part: 20 }), withdraw('w2', 270)];
    const unstamped = [...base(), withdraw('w1', 300), withdraw('w2', 270)];
    for (const rows of [stamped, unstamped]) {
      const ts = splitTs(rows, 'w2');
      expect(ts).toEqual(splitJs(rows, 'w2'));
      expect({ exempt: ts!.exempt, taxable: ts!.taxable }).toEqual({ exempt: 0, taxable: 270 });
    }
  });
});
