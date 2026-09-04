// เทสของ riderPushHealth — fixture คือรูปที่แอปไรเดอร์เขียนจริง
// (usePushNotifications: riders/{id}/fcm_tokens/{deviceId} = {token, device, updated_at})
//
// เทียบผลกับสำเนาฝั่ง functions ด้วย (functions/rider-push-coverage.js) —
// require ได้เพราะ pure ไม่แตะ firebase. สองสำเนาต้องให้ level เดียวกันทุก fixture
//
// ผล injection — วัดจริงหลังรันทีละตัวบนไฟล์ TS (parity กับ functions ต้องจับ
// drift ทุกตัว ไม่ใช่แค่เทสตรง):
//   เส้น stale 7 → 30 วัน                        → แดง 3 จาก 17 (parity 2 + ตรง 1)
//   ทิ้ง legacy fcm_token                          → แดง 3
//   ไม่อ่าน fcm_updated_at                         → แดง 4
//   none: ใช้ข้อความเดียวไม่แยก "ถูกตัดทิ้ง"        → แดง 1
//   มี token แต่ไม่มีเวลา = ok แทน stale            → แดง 2
// ทุกกฎมีเทสไปถึง — และทุกตัวที่เปลี่ยน level ถูก parity จับด้วย

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { riderPushHealth, RIDER_PUSH_STALE_MS } from './riderPushHealth';

const require = createRequire(import.meta.url);
const fn = require('../../functions/rider-push-coverage.js') as {
  assessRiderPushHealth: (r: unknown, now: number) => { level: string; devices: number; updatedAt: number | null };
  STALE_MS: number;
};

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const FIXTURES: Array<[string, Record<string, unknown>]> = [
  ['สด 5 นาที', { fcm_tokens: { a: { token: 't', device: 'ios', updated_at: NOW - 5 * 60_000 } }, fcm_updated_at: NOW - 5 * 60_000 }],
  ['สองเครื่อง เก่า+ใหม่', { fcm_tokens: { o: { token: 'a', updated_at: NOW - 30 * DAY }, n: { token: 'b', updated_at: NOW - DAY } } }],
  ['8 วัน', { fcm_tokens: { d: { token: 't', updated_at: NOW - 8 * DAY } }, fcm_updated_at: NOW - 8 * DAY }],
  ['6 วัน', { fcm_tokens: { d: { token: 't', updated_at: NOW - 6 * DAY } } }],
  ['token ถูกตัดทิ้ง เหลือ fcm_updated_at', { fcm_updated_at: NOW - 2 * DAY }],
  ['ว่าง', {}],
  ['entry token ว่าง', { fcm_tokens: { x: { token: '', updated_at: NOW } } }],
  ['legacy fcm_token + เวลา', { fcm_token: 'legacy', fcm_updated_at: NOW - DAY }],
  ['legacy ไม่มีเวลา', { fcm_token: 'legacy' }],
];

describe('riderPushHealth', () => {
  it('สด = ok พร้อมรายละเอียดเครื่อง', () => {
    const h = riderPushHealth(FIXTURES[0][1], NOW);
    expect(h.level).toBe('ok');
    expect(h.devices).toHaveLength(1);
    expect(h.devices[0].device).toBe('ios');
    expect(h.detail).toContain('5 นาทีที่แล้ว');
  });

  it('สองเครื่อง เวลาล่าสุดชนะ', () => {
    const h = riderPushHealth(FIXTURES[1][1], NOW);
    expect(h.level).toBe('ok');
    expect(h.devices).toHaveLength(2);
    expect(h.updatedAt).toBe(NOW - DAY);
  });

  it('เกิน 7 วัน = stale · 6 วันยัง ok', () => {
    expect(riderPushHealth(FIXTURES[2][1], NOW).level).toBe('stale');
    expect(riderPushHealth(FIXTURES[3][1], NOW).level).toBe('ok');
    expect(RIDER_PUSH_STALE_MS).toBe(7 * DAY);
  });

  it('token ถูก server ตัดทิ้ง = none และบอกว่าเคยลงทะเบียนเมื่อไหร่', () => {
    const h = riderPushHealth(FIXTURES[4][1], NOW);
    expect(h.level).toBe('none');
    expect(h.detail).toContain('ถูกตัดทิ้ง');
    expect(h.detail).toContain('2 วันที่แล้ว');
  });

  it('ไม่เคยลงทะเบียน = none ข้อความต่างจากถูกตัด', () => {
    const h = riderPushHealth({}, NOW);
    expect(h.level).toBe('none');
    expect(h.detail).toContain('ไม่เคยลงทะเบียน');
  });

  it('null/undefined ไม่ throw', () => {
    expect(riderPushHealth(null, NOW).level).toBe('none');
    expect(riderPushHealth(undefined, NOW).level).toBe('none');
  });

  it('legacy fcm_token นับเป็นเครื่อง · ไม่มีเวลา = stale ไม่ใช่ ok', () => {
    expect(riderPushHealth(FIXTURES[7][1], NOW).level).toBe('ok');
    expect(riderPushHealth(FIXTURES[8][1], NOW).level).toBe('stale');
  });
});

describe('parity กับ functions/rider-push-coverage.js', () => {
  it.each(FIXTURES)('%s', (_label, rider) => {
    const a = riderPushHealth(rider, NOW);
    const b = fn.assessRiderPushHealth(rider, NOW);
    expect(b.level).toBe(a.level);
    expect(b.devices).toBe(a.devices.length);
    expect(b.updatedAt).toBe(a.updatedAt);
  });

  it('เกณฑ์ 7 วันตรงกัน', () => {
    expect(fn.STALE_MS).toBe(RIDER_PUSH_STALE_MS);
  });
});
