// ประตู GPS — เหตุผลที่บล็อกต้องเรียงตามความถาวร และต้องบอกวิธีแก้ที่ถูก
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง เติมหลังรันจริง)

import { describe, it, expect } from 'vitest';
import {
  geoBlockReason, formatDistance, clockTime, durationText, shiftTimeText,
  MAX_FIX_AGE_MS, type GeoInput,
} from './geo';

const NOW = 1788000000000;
const fix = (over: Partial<{ lat: number; lng: number; accuracy_m: number; at: number }> = {}) =>
  ({ lat: 13.746, lng: 100.534, accuracy_m: 12, at: NOW, ...over });

const input = (over: Partial<GeoInput> = {}): GeoInput => ({
  supported: true, secureContext: true, permission: 'granted',
  fix: fix(), error: null, now: NOW, asked: true, ...over,
});

describe('ใช้แอปได้เมื่อไหร่', () => {
  it('พิกัดสดและอนุญาตแล้ว = ผ่าน', () => {
    expect(geoBlockReason(input())).toBeNull();
  });

  it('ไม่รองรับ = บล็อก และไม่มีปุ่ม', () => {
    const b = geoBlockReason(input({ supported: false }))!;
    expect(b.code).toBe('unsupported');
    // เคสนี้กดยังไงก็ไม่สำเร็จจริงๆ (เบราว์เซอร์ไม่มี API) จึงไม่ควรมีปุ่ม
    expect(b.action).toBeNull();
  });

  it('เปิดผ่าน http = บอกเหตุผลจริง ไม่ใช่หมุนรอตลอดไป', () => {
    const b = geoBlockReason(input({ secureContext: false }))!;
    expect(b.code).toBe('insecure');
    expect(b.detail).toContain('https');
  });

  it('ปฏิเสธสิทธิ์ = บอกวิธีแก้ **และต้องมีปุ่มให้กดต่อ**', () => {
    const b = geoBlockReason(input({ permission: 'denied' }))!;
    expect(b.code).toBe('denied');
    expect(b.detail).toMatch(/ตั้งค่า/);
    // **จอนี้เคยตัน และนั่นคือบั๊กที่หลุดถึงมือผู้ใช้** — บน iOS `denied`
    // เกิดได้ตั้งแต่ก่อนมีใครถูกถาม (คำขอที่ไม่ได้มาจากการแตะถูกปฏิเสธทันที
    // โดยไม่ขึ้นกล่อง) ปุ่มจึงไม่ใช่ปุ่มหลอก มันคือทางเดียวที่จะได้กล่องถาม
    expect(b.action).toBeTruthy();
  });

  it('ยังไม่ได้ถาม (prompt) ไม่ถือว่าถูกปฏิเสธ', () => {
    // ตอนเปิดแอปครั้งแรกสถานะคือ prompt — ถ้าอ่านเป็น denied จะขึ้นหน้าจอ
    // "ไปแก้การตั้งค่า" ให้คนที่ยังไม่เคยถูกถามด้วยซ้ำ
    const b = geoBlockReason(input({ permission: 'prompt', fix: null }))!;
    expect(b.code).toBe('no_fix');
  });

  it('ยังไม่เคยแตะขอ = ขอปุ่มก่อน ไม่ใช่หมุนรอ', () => {
    // **iOS ไม่ขึ้นกล่องถามให้คำขอที่ไม่ได้มาจากการแตะ** จอที่หมุนรอกล่องนั้น
    // จึงหมุนตลอดกาล — เคสจริงบนเครื่องเจ้าของงาน
    const b = geoBlockReason(input({ permission: null, fix: null, asked: false }))!;
    expect(b.code).toBe('needs_gesture');
    expect(b.action).toBeTruthy();
  });

  it('แตะขอแล้วแต่ยังไม่ได้พิกัด = กำลังหา (ไม่ใช่ขอให้แตะซ้ำ)', () => {
    const b = geoBlockReason(input({ permission: null, fix: null, asked: true }))!;
    expect(b.code).toBe('no_fix');
  });

  it('เคยให้สิทธิ์แล้วและมีพิกัดอยู่ ไม่ต้องแตะขอ', () => {
    // คนที่เปิดแอปซ้ำทุกเช้าต้องไม่โดนขอสิทธิ์ใหม่ทุกครั้ง
    expect(geoBlockReason(input({ asked: false }))).toBeNull();
  });

  it('เบราว์เซอร์ที่ไม่มี Permissions API ยังใช้ได้', () => {
    // `navigator.permissions` เป็น null ได้จริง (เคยทำทั้งหน้าพังมาแล้วในเว็บลูกค้า)
    // และบน Safari ค่านี้เป็น null **เสมอ** — geolocation ไม่อยู่ใน Permissions
    // API ของ Safari เลย เส้นทางนี้จึงเป็นเส้นทางปกติของ iOS ไม่ใช่เคสขอบ
    expect(geoBlockReason(input({ permission: null }))).toBeNull();
  });

  it('error ของเบราว์เซอร์มาก่อน "ยังไม่มีพิกัด"', () => {
    const b = geoBlockReason(input({ fix: null, error: 'unavailable' }))!;
    expect(b.code).toBe('unavailable');
    expect(b.action).toBeTruthy();
  });

  it('หมดเวลา = ลองใหม่ได้', () => {
    expect(geoBlockReason(input({ fix: null, error: 'timeout' }))!.action).toBeTruthy();
  });

  it('ทุกเหตุผลที่แก้ได้ต้องมีปุ่ม และที่แก้ไม่ได้ต้องไม่มี', () => {
    // ราวกันตกของกฎทั้งหมวด: จอที่ตันคือบั๊กที่หลุดมาแล้วหนึ่งรอบ
    const withButton = [
      geoBlockReason(input({ permission: 'denied' })),
      geoBlockReason(input({ fix: null, asked: false, permission: null })),
      geoBlockReason(input({ fix: null, error: 'unavailable' })),
      geoBlockReason(input({ fix: null, error: 'timeout' })),
      geoBlockReason(input({ fix: null })),
      geoBlockReason(input({ fix: fix({ at: 1 }) })),
    ];
    expect(withButton.every((b) => b && b.action)).toBe(true);

    const noButton = [
      geoBlockReason(input({ supported: false })),
      geoBlockReason(input({ secureContext: false })),
    ];
    expect(noButton.every((b) => b && b.action === null)).toBe(true);
  });
});

describe('พิกัดเก่า — เคสที่ไม่ error แต่อันตรายที่สุด', () => {
  it('พิกัดเก่ากว่าเพดาน = บล็อก', () => {
    // เบราว์เซอร์คืนพิกัดจากแคชได้โดยไม่ error ถ้าไม่ตรวจอายุ คนจะเช็คอินผ่าน
    // ด้วยพิกัดของที่ที่เขาอยู่เมื่อชั่วโมงที่แล้ว
    const b = geoBlockReason(input({ fix: fix({ at: NOW - MAX_FIX_AGE_MS - 1 }) }))!;
    expect(b.code).toBe('stale');
  });

  it('พิกัดที่อายุพอดีเพดานยังใช้ได้', () => {
    expect(geoBlockReason(input({ fix: fix({ at: NOW - MAX_FIX_AGE_MS }) }))).toBeNull();
  });

  it('พิกัดที่ไม่รู้เวลา ต้องไม่ถือว่าสดเสมอ', () => {
    // NaN เปรียบเทียบแล้วเป็น false ทุกทาง — `age > MAX` อย่างเดียวจะปล่อยผ่าน
    const b = geoBlockReason(input({ fix: fix({ at: NaN }) }))!;
    expect(b.code).toBe('stale');
  });
});

describe('การจัดรูป', () => {
  it('ระยะต่ำกว่ากิโลเป็นเมตร', () => {
    expect(formatDistance(87)).toBe('87 ม.');
  });

  it('เกินกิโลเป็นกิโลเมตร', () => {
    expect(formatDistance(1500)).toBe('1.50 กม.');
  });

  it('ไม่มีค่าไม่กลายเป็น 0 ม.', () => {
    expect(formatDistance(null)).toBe('-');
    expect(formatDistance(undefined)).toBe('-');
  });

  it('ระยะ 0 เมตรเป็นค่าจริง ไม่ใช่ค่าว่าง', () => {
    // ยืนทับหมุดสาขาพอดี = 0 ซึ่งต้องอ่านว่า 0 ไม่ใช่ "-"
    expect(formatDistance(0)).toBe('0 ม.');
  });

  it('เวลาว่างไม่กลายเป็นปี 1970', () => {
    // `Number(null) === 0` และ 0 เป็น finite — กับดักเดิมของโปรเจกต์นี้
    expect(clockTime(null)).toBe('-');
    expect(clockTime(0)).toBe('-');
    expect(clockTime(NaN)).toBe('-');
  });

  it('ชั่วโมงทำงานอ่านออก', () => {
    expect(durationText(510)).toBe('8 ชม. 30 นาที');
    expect(durationText(480)).toBe('8 ชม.');
    expect(durationText(45)).toBe('45 นาที');
  });

  it('ทำงาน 0 นาทีเป็นค่าจริง ไม่ใช่ค่าว่าง', () => {
    expect(durationText(0)).toBe('0 นาที');
  });

  it('ไม่มีชั่วโมงทำงานยังไม่ใช่ 0', () => {
    expect(durationText(null)).toBe('-');
  });

  it('เวลากะแปลงจากนาทีของวัน', () => {
    expect(shiftTimeText(480, 1020)).toBe('08:00 - 17:00');
  });

  it('กะที่ยังไม่รู้เวลาไม่ขึ้นเป็น 00:00', () => {
    expect(shiftTimeText(null, null)).toBe('--:-- - --:--');
  });

  it('เที่ยงคืนเป็นเวลาจริง', () => {
    expect(shiftTimeText(0, 360)).toBe('00:00 - 06:00');
  });
});
