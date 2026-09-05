// สามสำเนาของค่า rider_fee_status ต้องตรงกันเป็นตัวอักษร
//
//   ตัวจริง = functions/rider-fee-status.js (callable/trigger ใช้)
//   สำเนา   = src/types/riderFeeStatus.ts (แอปแอดมิน — ไฟล์นี้ import)
//   สำเนา   = bkk-rider-app/src/types/riderFeeStatus.ts (แอปไรเดอร์ อยู่คนละรีโป —
//             ตรวจได้เมื่อ checkout ไว้ข้างกัน ไม่มีก็ข้าม ไม่ใช่แดง แบบเดียวกับ
//             walletCategoryParity ฝั่งนั้น)
//
// ทำไมต้องเทียบตัวอักษร: 'Waived' ที่สะกดต่างกันคนละที่จะทำให้ตัวเขียน Pending
// ฝั่งแอปไรเดอร์ไม่รู้จักปลายทางแล้วเขียนทับ — ไม่มี error ไม่มีเทสแดง มีแต่ใบที่
// waive ไปแล้วกลับมานั่งในคิว
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RIDER_FEE_STATUS, RIDER_FEE_STATUS_VALUES, TERMINAL_RIDER_FEE_STATUSES, isTerminalRiderFeeStatus } from '../types/riderFeeStatus';

const require = createRequire(import.meta.url);
const js = require('../../functions/rider-fee-status.js') as {
  RIDER_FEE_STATUS: Record<string, string>;
  RIDER_FEE_STATUS_VALUES: readonly string[];
  TERMINAL_RIDER_FEE_STATUSES: readonly string[];
  isTerminalRiderFeeStatus: (v: unknown) => boolean;
  pendingFeeStatusPatch: (v: unknown) => Record<string, string>;
};

describe('rider_fee_status — สำเนาต้องตรงกัน', () => {
  it('functions/rider-fee-status.js ตรงกับ src/types/riderFeeStatus.ts', () => {
    expect(js.RIDER_FEE_STATUS).toEqual(RIDER_FEE_STATUS);
    expect([...js.RIDER_FEE_STATUS_VALUES]).toEqual([...RIDER_FEE_STATUS_VALUES]);
    expect([...js.TERMINAL_RIDER_FEE_STATUSES]).toEqual([...TERMINAL_RIDER_FEE_STATUSES]);
  });

  it('Paid และ Waived เป็นปลายทาง — Pending, ว่าง, ค่าแปลกไม่ใช่', () => {
    for (const v of ['Paid', 'Waived']) {
      expect(isTerminalRiderFeeStatus(v)).toBe(true);
      expect(js.isTerminalRiderFeeStatus(v)).toBe(true);
    }
    for (const v of ['Pending', '', undefined, null, 'paid', 'WAIVED']) {
      expect(isTerminalRiderFeeStatus(v)).toBe(false);
      expect(js.isTerminalRiderFeeStatus(v)).toBe(false);
    }
  });

  it('pendingFeeStatusPatch (ฝั่ง functions) ไม่ทับปลายทาง', () => {
    expect(js.pendingFeeStatusPatch(undefined)).toEqual({ rider_fee_status: 'Pending' });
    expect(js.pendingFeeStatusPatch('')).toEqual({ rider_fee_status: 'Pending' });
    expect(js.pendingFeeStatusPatch('Pending')).toEqual({});
    expect(js.pendingFeeStatusPatch('Paid')).toEqual({});
    expect(js.pendingFeeStatusPatch('Waived')).toEqual({});
  });

  it('bkk-rider-app/src/types/riderFeeStatus.ts ตรงกัน (ข้ามเมื่อไม่ได้ checkout ไว้ข้างกัน)', () => {
    const file = resolve(__dirname, '../../../bkk-rider-app/src/types/riderFeeStatus.ts');
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    const block = src.match(/RIDER_FEE_STATUS = \{([\s\S]*?)\} as const/);
    expect(block, 'หาบล็อก RIDER_FEE_STATUS ในแอปไรเดอร์ไม่เจอ').toBeTruthy();
    const values = [...block![1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((m) => m[1]);
    expect(values).toEqual([...RIDER_FEE_STATUS_VALUES]);
    const terminal = src.match(/TERMINAL_RIDER_FEE_STATUSES[^=]*=\s*\[([\s\S]*?)\]/);
    expect(terminal, 'หา TERMINAL_RIDER_FEE_STATUSES ในแอปไรเดอร์ไม่เจอ').toBeTruthy();
    const terminalKeys = [...terminal![1].matchAll(/RIDER_FEE_STATUS\.([A-Z]+)/g)].map((m) => RIDER_FEE_STATUS[m[1] as keyof typeof RIDER_FEE_STATUS]);
    expect(terminalKeys).toEqual([...TERMINAL_RIDER_FEE_STATUSES]);
  });
});
