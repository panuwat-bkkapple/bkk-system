// ด่านของ "กฎเดียว ติดตั้งครบทุกคนที่อ่าน" สำหรับชนิดงานลูกในคลัง
//
// เทสที่เขียนว่า "ไฟล์ A ทำถูก" อ่อนกว่าเทสที่เขียนว่า "ไม่มีไฟล์ไหนทำผิด" — ชั้นที่สาม
// ข้างล่างสแกนทั้ง src/ ว่าไม่มีใครเทียบ `type` กับชนิดงานลูกด้วยตัวเอง เพราะนั่นคือ
// วิธีที่ Analytics กับ NotificationCenter เคยได้รายการคนละชุดกันโดยไม่มีใครเห็น
//
// INJECTION (วัดจริง 5 ก.ย. 2569 — แต่ละตัวถอดเดี่ยวแล้ว restore):
//   1. ลบ 'B2C-Unpacked' ออกจาก STOCK_CHILD_TYPES ฝั่ง TS      -> แดง 2 (parity + isStockChildJob)
//   2. ลบ 'B2C-Unpacked' ออกจาก STOCK_CHILD_TYPES ฝั่ง JS      -> แดง 1 (parity; b2c-unpack.test.mjs ยังเขียวเพราะมันวนลิสต์ที่เหลือ)
//   3. คืน `j.type !== 'Accessory'` กลับเข้า Analytics.tsx        -> แดง 1 (สแกน src/)
//   4. multiUnpackState คืน 'done' เมื่อ written แต่แม่ยังไม่ Completed -> แดง 1
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  STOCK_CHILD_TYPES, B2C_UNPACKED_JOB_TYPE, ACCESSORY_CHILD_JOB_TYPE, B2B_UNPACKED_JOB_TYPE,
  isStockChildJob, isB2cUnpackedChild, multiUnpackState, MULTI_UNPACK_ENTRY_STATUSES,
} from './stockChildren';
import { ACCESSORY_JOB_TYPE } from './accessoryItems';

const require = createRequire(import.meta.url);
const functionsMod = require(resolve(__dirname, '../../functions/b2c-unpack.js')) as {
  STOCK_CHILD_TYPES: string[];
  CHILD_TYPE: string;
  ENTRY_STATUSES: string[];
};

describe('stock child types', () => {
  it('สองสำเนา (TS ↔ functions/b2c-unpack.js) ถือรายการเดียวกัน', () => {
    expect([...STOCK_CHILD_TYPES].sort()).toEqual([...functionsMod.STOCK_CHILD_TYPES].sort());
    expect(B2C_UNPACKED_JOB_TYPE).toBe(functionsMod.CHILD_TYPE);
    expect(ACCESSORY_CHILD_JOB_TYPE).toBe(ACCESSORY_JOB_TYPE);
  });

  it('สถานะที่การ์ดบนตั๋วถือว่า "เครื่องถึงร้านแล้ว" ตรงกับ trigger ฝั่ง server', () => {
    expect([...MULTI_UNPACK_ENTRY_STATUSES].sort()).toEqual([...functionsMod.ENTRY_STATUSES].sort());
  });

  it('isStockChildJob รู้จักทั้งสามชนิด และไม่รู้จักงานลูกค้า', () => {
    expect(isStockChildJob({ type: B2B_UNPACKED_JOB_TYPE })).toBe(true);
    expect(isStockChildJob({ type: ACCESSORY_CHILD_JOB_TYPE })).toBe(true);
    expect(isStockChildJob({ type: B2C_UNPACKED_JOB_TYPE })).toBe(true);
    expect(isStockChildJob({ type: 'Trade-in' })).toBe(false);
    expect(isStockChildJob({ type: 'B2B Trade-in' })).toBe(false);
    expect(isStockChildJob({})).toBe(false);
    expect(isStockChildJob(null)).toBe(false);
    expect(isB2cUnpackedChild({ type: B2C_UNPACKED_JOB_TYPE })).toBe(true);
    expect(isB2cUnpackedChild({ type: ACCESSORY_CHILD_JOB_TYPE })).toBe(false);
  });

  it('multiUnpackState: none / partial / done ตามลำดับที่ server เขียน', () => {
    expect(multiUnpackState({}, false)).toBe('none');
    expect(multiUnpackState({ multi_unpack: { written: false } }, false)).toBe('partial');
    expect(multiUnpackState({ multi_unpack: { written: true } }, false)).toBe('partial');
    expect(multiUnpackState({ multi_unpack: { written: true } }, true)).toBe('done');
  });
});

// ── ชั้นสแกน: ไม่มีไฟล์ไหนใน src/ เทียบชนิดงานลูกเอง ────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('no file compares job.type against a stock-child literal on its own', () => {
  const srcRoot = resolve(__dirname, '..');
  const allowed = new Set([
    resolve(srcRoot, 'utils/stockChildren.ts'),
    resolve(srcRoot, 'utils/accessoryItems.ts'), // เจ้าของ ACCESSORY_JOB_TYPE (ตัวสร้าง)
  ]);
  const pattern = /(?:!==|===|==|!=)\s*['"](B2B-Unpacked|Accessory|B2C-Unpacked)['"]/;
  it('grep ทั้ง src/', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)) // ตัดคอมเมนต์ก่อนสแกน
        .join('\n');
      if (pattern.test(src)) offenders.push(file.replace(srcRoot + '/', ''));
    }
    expect(offenders, 'ใช้ isStockChildJob() / isB2cUnpackedChild() แทนการเทียบ literal').toEqual([]);
  });
});
