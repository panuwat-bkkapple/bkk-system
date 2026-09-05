// สองสำเนาของตัวสร้างงานลูกอุปกรณ์เสริมต้องให้ multi-path เดียวกันทุก byte
//
// ทำไมมีสองสำเนา: ปุ่ม In Stock ฝั่งไคลเอนต์ (accessoryItems.ts) แตกอุปกรณ์เสริม
// ให้งานเครื่องเดียว ส่วนงานหลายเครื่องถูกแตกฝั่ง server (functions/b2c-unpack.js)
// และแม่ปิดที่ Completed โดยไม่ผ่านปุ่มนั้น server จึงต้องแตกอุปกรณ์เสริมเองด้วย
// รูปเดียวกัน — ถ้าสองรูปต่างกัน Pencil ที่มาจากงานสองเครื่องจะหน้าตาไม่เหมือน
// Pencil ที่มาจากงานเครื่องเดียวในคลังเดียวกัน
//
// INJECTION (วัดจริง 5 ก.ย. 2569): เปลี่ยน ref suffix ฝั่ง JS จาก -A เป็น -X -> แดง 2
//   ถอด stock_cost ออกจากฝั่ง TS -> แดง 2
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildAccessoryChildUpdates } from './accessoryItems';

const require = createRequire(import.meta.url);
const server = require(resolve(__dirname, '../../functions/b2c-unpack.js')) as {
  buildAccessoryChildUpdates: (job: unknown, keys: string[], by: string, now: number) => Record<string, unknown>;
};

const NOW = 1_800_000_500_000;
const fixtures: Array<[string, Record<string, unknown>]> = [
  ['two accessories on an iPad order', {
    id: 'job-1', ref_no: 'OID-ABC123', cust_name: 'สมชาย', receive_method: 'Pickup',
    price: 24000, final_price: 24000,
    accessory_items: [
      { id: 'pen', model_id: 'pen', model_name: 'Apple Pencil Pro', price: 2500, serial: 'AP-1' },
      { id: 'kb', model_id: 'kb', model_name: 'Magic Keyboard', price: 4000 },
    ],
  }],
  ['object-shaped list (RTDB after a delete)', {
    id: 'job-2', ref_no: 'OID-DEF456', price: 10000, final_price: 10000,
    accessory_items: { 1: { id: 'pen', model_id: 'pen', model_name: 'Apple Pencil', price: 1500 } },
  }],
  ['already unpacked = empty on both sides', {
    id: 'job-3', ref_no: 'OID-GHI789', price: 10000, accessories_unpacked_at: 1,
    accessory_items: [{ id: 'pen', model_id: 'pen', model_name: 'Apple Pencil', price: 1500 }],
  }],
  ['no accessories = empty on both sides', { id: 'job-4', ref_no: 'OID-JKL012', price: 9000 }],
  ['accessory value larger than the total never goes negative', {
    id: 'job-5', ref_no: 'OID-MNO345', price: 1000, final_price: 1000,
    accessory_items: [{ id: 'kb', model_id: 'kb', model_name: 'Magic Keyboard', price: 4000 }],
  }],
];

describe('accessory child builder parity (TS ↔ functions/b2c-unpack.js)', () => {
  for (const [name, job] of fixtures) {
    it(name, () => {
      const keys = ['a1', 'a2', 'a3'];
      const ts = buildAccessoryChildUpdates(job, keys, 'system:test', NOW);
      const js = server.buildAccessoryChildUpdates(job, keys, 'system:test', NOW);
      expect(JSON.parse(JSON.stringify(ts))).toEqual(JSON.parse(JSON.stringify(js)));
    });
  }

  it('the shape the inventory page reads is pinned (not just equal on both sides)', () => {
    const [, job] = fixtures[0];
    const out = buildAccessoryChildUpdates(job, ['a1', 'a2'], 'system:test', NOW);
    expect(out['jobs/a1'].ref_no).toBe('OID-ABC123-A1');
    expect(out['jobs/a1'].type).toBe('Accessory');
    expect(out['jobs/a1'].status).toBe('In Stock');
    expect(out['jobs/a2'].price).toBe(4000);
    expect(out['jobs/job-1/stock_cost']).toBe(24000 - 6500);
    expect(out['jobs/job-1/accessories_unpacked_at']).toBe(NOW);
  });
});
