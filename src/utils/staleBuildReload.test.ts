// เทสของตัวกู้คืนเมื่อ chunk ของ build เก่าหายหลัง deploy
//
// ด่านหลัก: **`preventDefault()` ต้องเรียกเฉพาะตอนที่ reload จริงเท่านั้น**
//
// เคสจริง 2 ก.ย. 2569 01:54 (deploy 01:49): handler เดิมเรียก preventDefault()
// ก่อนเสมอ ซึ่งบอก Vite ว่า "จัดการแล้ว" ทำให้ dynamic import resolve ด้วย
// undefined แทนที่จะ reject. พอติด cooldown 60 วิ จึงไม่ได้ reload ด้วย แต่
// error ถูกกลืนไปแล้ว ปลายทางเลยพังเป็น
//   Cannot read properties of undefined (reading 'CEODashboard')
// ซึ่ง isStaleChunkError จับไม่ได้ ผู้ใช้จึงเห็น "ส่งภาพหน้านี้ให้ Claude"
// แทน "ระบบมีเวอร์ชันใหม่ กรุณาโหลดใหม่" ทั้งที่กดปุ่มเดียวก็จบ
//
// ย้าย preventDefault() กลับไปไว้บนสุดเมื่อไหร่ เคส "ติด cooldown" แดงทันที
//
// หมายเหตุ: vitest ของ repo นี้รันบน node ไม่มี jsdom — ตรรกะจึงถูกแยกเป็น
// pure function (handlePreloadError / shouldReloadForStaleBuild) เพื่อให้เทสได้
// โดยไม่ต้องลาก toolchain เพิ่ม
import { describe, it, expect, vi } from 'vitest';
import {
  isStaleChunkError,
  shouldReloadForStaleBuild,
  handlePreloadError,
} from './staleBuildReload';

describe('isStaleChunkError', () => {
  it('จับข้อความที่เบราว์เซอร์/Vite ใช้จริงตอน chunk หาย', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: https://x/assets/a-1.js',
      'Importing a module script failed.',
      'error loading dynamically imported module',
      'Loading chunk 42 failed.',
    ]) {
      expect(isStaleChunkError(new Error(msg))).toBe(true);
    }
  });

  it('ไม่จับ TypeError ทั่วไป — ขยายให้จับ = reload ทับบั๊กจริงจนมองไม่เห็น', () => {
    // ข้อความที่เคสจริงพังออกมา จงใจให้ *ไม่* จับ แล้วไปแก้ที่ต้นทางแทน
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'CEODashboard')"))).toBe(false);
    expect(isStaleChunkError(new Error('x.map is not a function'))).toBe(false);
  });

  it('ทนกับค่าที่ไม่ใช่ Error', () => {
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError('Loading chunk 7 failed.')).toBe(true);
  });
});

describe('shouldReloadForStaleBuild', () => {
  it('ยังไม่เคย reload = ทำได้', () => {
    expect(shouldReloadForStaleBuild(1_000_000, 0)).toBe(true);
  });

  it('เพิ่ง reload ไป = ยังไม่ทำ (กันหน้าจอกะพริบที่กดอะไรไม่ได้)', () => {
    const now = 1_000_000;
    expect(shouldReloadForStaleBuild(now, now)).toBe(false);
    expect(shouldReloadForStaleBuild(now, now - 59_999)).toBe(false);
  });

  it('ครบ 60 วินาทีพอดี = ทำได้', () => {
    const now = 1_000_000;
    expect(shouldReloadForStaleBuild(now, now - 60_000)).toBe(true);
  });
});

describe('handlePreloadError', () => {
  it('reload ได้ = กลืน error เพราะหน้ากำลังจะหายอยู่แล้ว', () => {
    const preventDefault = vi.fn();
    expect(handlePreloadError({ preventDefault }, () => true)).toBe('reloaded');
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ติด cooldown = **ห้ามกลืน error** ต้องปล่อยให้ Vite throw', () => {
    // เคสที่พังจริง: กลืนแล้วไม่ reload -> import resolve เป็น undefined
    // -> ปลายทางอ่าน property ของ undefined -> error ที่ชี้ต้นตอไม่ได้
    const preventDefault = vi.fn();
    expect(handlePreloadError({ preventDefault }, () => false)).toBe('surfaced');
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ถาม reload ครั้งเดียวต่อหนึ่ง event', () => {
    const reload = vi.fn(() => true);
    handlePreloadError({ preventDefault: vi.fn() }, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
