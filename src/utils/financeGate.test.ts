// ตารางความจริงของ `isFinanceActor`
//
// **เคสชุดนี้ซ้ำกับ `functions/test/rider-expenses.test.mjs` โดยตั้งใจ** —
// ตัวตัดสินจริงคือ `financeActorVerdict` ใน `functions/finance-claims.js`
// ส่วนตัวนี้เป็นมิเรอร์ฝั่งหน้าจอ (functions import TS ไม่ได้ รวมเป็นตัวเดียว
// ไม่ได้) การเขียนเคสเดียวกันสองที่ทำให้ drift โผล่เป็นสีแดงข้างเดียว
// ไม่ใช่ความเงียบแบบที่ `ADJUSTMENT` เคยหลุดมาแล้ว

import { describe, it, expect } from 'vitest';
import { evaluateFinanceGate, isFinanceActor } from './financeGate';

describe('isFinanceActor — ใครทำขั้นของฝ่ายบัญชีได้', () => {
  const cases: [string, { role?: string | null; hasClaim: boolean }, boolean][] = [
    ['CEO ผ่านเสมอแม้ไม่มี claim', { role: 'CEO', hasClaim: false }, true],
    ['FINANCE ผ่านด้วย role', { role: 'FINANCE', hasClaim: false }, true],
    ['ใครก็ตามที่มี claim ผ่าน', { role: 'STAFF', hasClaim: true }, true],
    ['MANAGER ไม่ใช่ฝ่ายบัญชี', { role: 'MANAGER', hasClaim: false }, false],
    ['STAFF ไม่ผ่าน', { role: 'STAFF', hasClaim: false }, false],
    ['ไม่มี role ไม่ผ่าน', { role: null, hasClaim: false }, false],
  ];

  it.each(cases)('%s', (_label, state, want) => {
    expect(isFinanceActor(state)).toBe(want);
  });

  it('role พิมพ์เล็กก็ต้องอ่านออก (staff record ไม่ได้บังคับตัวพิมพ์)', () => {
    expect(isFinanceActor({ role: 'finance', hasClaim: false })).toBe(true);
  });

  // ข้อที่สำคัญที่สุดของไฟล์นี้: สองฟังก์ชันนี้ตอบคนละคำถาม การหยิบผิดตัวคือ
  // การขึ้นปุ่มให้คนที่ server จะปฏิเสธ ซึ่งเป็นปุ่มที่โกหกคนกด
  it('ต่างจาก evaluateFinanceGate ที่ปล่อย admin ทุกคนผ่านระหว่างยังไม่บังคับ', () => {
    const state = { role: 'STAFF', hasClaim: false, enforce: false };
    expect(evaluateFinanceGate(state).allowed).toBe(true);
    expect(isFinanceActor(state)).toBe(false);
  });
});
