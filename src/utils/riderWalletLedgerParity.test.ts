// สองสำเนาของสูตรกระเป๋าไรเดอร์ต้องตอบเท่ากันบน fixture ชุดเดียวกัน
//
// ต้นทาง = bkk-rider-app/src/utils/walletLedger.ts (จอไรเดอร์)
// สำเนา  = src/utils/riderWalletLedger.ts          (หน้า Rider Statement ฝั่งแอดมิน)
//
// ต้นทางอยู่คนละรีโป: โหลดจาก checkout ข้างๆ (`../bkk-rider-app`) โดย transpile ด้วย
// typescript ของรีโปนี้ — วิธีเดียวกับ `scripts/rider-wallet-audit.cjs` (ไฟล์ต้นทางเป็น
// TS pure ไม่มี import จึงทำได้). ไม่มี checkout = **ข้าม ไม่ใช่แดง** (แบบเดียวกับ
// `riderWalletAuditReadOnly.test.ts` และ `walletCategoryParity.test.ts` ฝั่งแอป) ยกเว้น
// ตั้ง REQUIRE_CROSS_REPO_CHECKS=1 (CI ตั้งให้เมื่อวาง bkk-rider-app สำเร็จ) — ตอนนั้น
// "หาไฟล์ไม่เจอ" กลายเป็นสอบตก ไม่ใช่ข้ามเงียบ
//
// parity อย่างเดียวมองไม่เห็นตอนสองสำเนาผิดเหมือนกัน (บทเรียน riderCostSplitParity)
// จึงมีเคส "ตัวเลขที่ต้องได้จริง" แยกต่างหาก ซึ่งรันเสมอไม่ว่าจะมี checkout ไหม
//
// path ของไฟล์ต้นทางเขียนเป็นสตริงตรงๆ (ไม่ประกอบจากตัวแปร) เพื่อให้ขั้น "ตรวจว่า
// sparse-checkout ครอบไฟล์ที่เทสอ้าง" ใน ci.yml grep เจอ

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mirror from './riderWalletLedger';

const require = createRequire(import.meta.url);
const SOURCE = resolve(__dirname, '../../../bkk-rider-app/src/utils/walletLedger.ts');
const hasSource = existsSync(SOURCE);
const mustHaveSource = process.env.REQUIRE_CROSS_REPO_CHECKS === '1';

type Ledger = typeof mirror;

function loadSource(): Ledger {
  const src = readFileSync(SOURCE, 'utf8');
  if (/^\s*import\s/m.test(src)) {
    throw new Error(`${SOURCE} มี import แล้ว — loader นี้ transpile ได้เฉพาะไฟล์ pure ต้องปรับก่อน`);
  }
  const ts = require('typescript') as typeof import('typescript');
  const out = ts.transpileModule(src, {
    fileName: SOURCE,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const Module = require('module');
  const m = new Module(SOURCE, module);
  m.filename = SOURCE;
  m.paths = Module._nodeModulePaths(resolve(SOURCE, '..'));
  m._compile(out.outputText, SOURCE);
  return m.exports as Ledger;
}

// ─── fixture: ครบทุกหมวดใน allowlist · นอก allowlist · amount เสียทุกรูป · type เสีย ───

const TX = [
  { id: 't01', type: 'CREDIT', category: 'JOB_PAYOUT', amount: 300 },
  { id: 't02', type: 'DEBIT', category: 'WITHDRAWAL', amount: 100 },
  { id: 't03', type: 'DEBIT', category: 'PENALTY', amount: 20 },
  { id: 't04', type: 'CREDIT', category: 'BONUS', amount: 50 },
  { id: 't05', type: 'DEBIT', category: 'ADJUSTMENT', amount: 15 },
  { id: 't06', type: 'CREDIT', category: 'ADJUSTMENT', amount: 5 },
  { id: 't07', type: 'CREDIT', category: 'EXPENSE_REIMBURSEMENT', amount: '65' }, // string ตัวเลข = นับ
  { id: 't08', type: 'CREDIT', category: 'COMPANY_ADVANCE', amount: 200 },
  { id: 't09', type: 'CREDIT', category: 'RIDER_DEPOSIT', amount: 10.5 },
  { id: 't10', type: 'CREDIT', category: 'LOGISTICS_REVENUE', amount: 500 }, // นอก allowlist
  { id: 't11', type: 'DEBIT', category: 'TRADE_IN_PAYOUT', amount: 9000 }, // นอก allowlist
  { id: 't12', type: 'CREDIT', category: 'JOB_PAYOUT', amount: 'abc' }, // เสีย
  { id: 't13', type: 'CREDIT', category: 'JOB_PAYOUT', amount: '' }, // เสีย (string ว่าง)
  { id: 't14', type: 'CREDIT', category: 'JOB_PAYOUT', amount: null }, // เสีย (Number(null) === 0 กับดัก)
  { id: 't15', type: 'CREDIT', category: 'JOB_PAYOUT' }, // เสีย (ไม่มี amount)
  { id: 't16', type: 'CREDIT', category: 'JOB_PAYOUT', amount: Infinity }, // เสีย
  { id: 't17', type: 'credit', category: 'JOB_PAYOUT', amount: 100 }, // type เสีย (ตัวเล็ก)
  { id: 't18', category: 'JOB_PAYOUT', amount: 100 }, // ไม่มี type
  { id: 't19', type: 'CREDIT', amount: 100 }, // ไม่มี category
  { id: 't20', type: 'CREDIT', category: 'JOB_PAYOUT', amount: -30 }, // ติดลบ = ยังเป็นเลข finite
  null,
  undefined,
] as const;

const WD = [
  { status: 'requested', withdraw_amount: 120 },
  { status: 'requested', withdraw_amount: '30' },
  { status: 'paid', withdraw_amount: 999 },
  { status: 'rejected', withdraw_amount: 999 },
  { status: 'requested', withdraw_amount: 'x' },
  { status: 'requested', withdraw_amount: -5 },
  { status: 'requested' },
  { withdraw_amount: 40 },
  null,
] as unknown as readonly { status?: unknown; withdraw_amount?: unknown }[];

const LABEL_KEYS = ['JOB_PAYOUT', 'WITHDRAWAL', 'PENALTY', 'BONUS', 'ADJUSTMENT', 'EXPENSE_REIMBURSEMENT', 'COMPANY_ADVANCE', 'RIDER_DEPOSIT', 'LOGISTICS_REVENUE', '', null, undefined, 42];

const run = (L: Ledger) => {
  const counted = TX.filter((t) => L.isRiderWalletTx(t as never));
  return {
    categories: [...L.RIDER_WALLET_CATEGORIES],
    accepted: TX.map((t) => L.isRiderWalletTx(t as never)),
    balance: L.walletBalance(counted as never),
    hold: L.pendingWithdrawalHold(WD),
    labels: LABEL_KEYS.map((k) => L.walletCategoryLabel(k)),
  };
};

describe('riderWalletLedger — mirror ตอบเท่ากับ walletLedger.ts ของแอปไรเดอร์', () => {
  it('ถ้าบังคับด่านข้ามรีโป ต้องหาไฟล์ต้นทางเจอ (ไม่ใช่ข้ามเงียบ)', () => {
    if (mustHaveSource) expect(hasSource, `REQUIRE_CROSS_REPO_CHECKS=1 แต่ไม่พบ ${SOURCE}`).toBe(true);
  });

  it.skipIf(!hasSource)('fixture เดียวกัน ผลเท่ากันทุกฟังก์ชัน', () => {
    const source = loadSource();
    for (const name of ['isRiderWalletTx', 'walletBalance', 'pendingWithdrawalHold', 'walletCategoryLabel', 'RIDER_WALLET_CATEGORIES', 'WALLET_CATEGORY_LABEL_TH']) {
      expect(name in source, `ต้นทางไม่มี export ${name}`).toBe(true);
    }
    expect(run(mirror)).toEqual(run(source));
    expect(mirror.WALLET_CATEGORY_LABEL_TH).toEqual(source.WALLET_CATEGORY_LABEL_TH);
  });

  it.skipIf(!hasSource)('ตัวโค้ดตรงกันตัวอักษรเดียวกัน (นอกคอมเมนต์)', () => {
    // ด่านที่แรงกว่า fixture: ถ้าใครแก้ต้นทางแบบที่ fixture ไม่ไปถึง ยังจับได้
    const strip = (s: string) =>
      s
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').trim())
        .filter((l) => l && !l.startsWith('*') && !l.startsWith('/*'))
        .join('\n');
    const codeFrom = (s: string) => strip(s.slice(s.indexOf('export type WalletTxType')));
    expect(codeFrom(readFileSync(resolve(__dirname, 'riderWalletLedger.ts'), 'utf8'))).toBe(codeFrom(readFileSync(SOURCE, 'utf8')));
  });
});

describe('ตัวเลขที่ต้องได้จริง (รันเสมอ — parity มองไม่เห็นตอนผิดเหมือนกันสองฝั่ง)', () => {
  const r = run(mirror);
  it('allowlist 8 หมวด', () => {
    expect(new Set(r.categories)).toEqual(new Set(['JOB_PAYOUT', 'WITHDRAWAL', 'PENALTY', 'BONUS', 'ADJUSTMENT', 'EXPENSE_REIMBURSEMENT', 'COMPANY_ADVANCE', 'RIDER_DEPOSIT']));
  });
  it('นับเฉพาะแถวที่หมวดอยู่ใน allowlist + type ถูก + amount เป็นเลข finite (string ตัวเลขนับ)', () => {
    // t01-t09 นับ · t10-t19 ไม่นับ · t20 ติดลบยังนับ (ทิศเป็นเรื่องของ type) · null/undefined ไม่นับ
    expect(r.accepted).toEqual([true, true, true, true, true, true, true, true, true, false, false, false, false, false, false, false, false, false, false, true, false, false]);
  });
  it('balance = 300-100-20+50-15+5+65+200+10.5-30 = 465.5', () => {
    expect(r.balance).toBeCloseTo(465.5, 6);
  });
  it('hold = เฉพาะ requested ที่เป็นเลขบวก = 120+30 = 150', () => {
    expect(r.hold).toBe(150);
  });
  it('ป้ายหมวด: รู้จัก → ไทย · ไม่รู้จัก → ค่าดิบ · ว่าง → "รายการอื่น"', () => {
    expect(r.labels[0]).toBe('ค่ารอบงาน');
    expect(r.labels[8]).toBe('LOGISTICS_REVENUE');
    expect(r.labels.slice(9, 12)).toEqual(['รายการอื่น', 'รายการอื่น', 'รายการอื่น']);
    expect(r.labels[12]).toBe('42');
  });
});
