/**
 * ตรรกะล้วนของชิ้นส่วน UI ที่เพิ่มมาพร้อมธีมการ์ดนุ่ม
 *
 * ตาราง injection (วัดจริง):
 *   หน้าจอพิมพ์ชื่อแอปเองแทนอ่านจาก `APP_NAME`                 -> แดง 1
 *   `manifest.webmanifest` ไม่ตรงกับ `APP_NAME`                -> แดง 1
 *   `index.html` `<title>` ไม่ตรงกับ `APP_NAME`                 -> แดง 1
 *   สไลด์กลับไปใช้คำของต้นฉบับที่ระบบยังไม่มี                   -> แดง 1
 *   หน้าแนะนำโผล่ได้ทุกจอ (รวมจอขอสิทธิ์ตำแหน่ง)                -> แดง 1
 *   `initialsOf` คืนอักษรแรกของคำเดียวเสมอ (ไม่เอาคำที่สอง)  -> แดง 2
 *   `initialsOf` ใช้ `slice` บนสตริงแทน spread (นับ code unit) -> แดง 1
 *   `reachedConfirm` เทียบ `>` แทน `>=`                        -> แดง 1
 *   `reachedConfirm` ไม่กัน max <= 0                           -> แดง 1
 */
import { describe, it, expect } from 'vitest';
import { initialsOf } from './avatarText';
import { reachedConfirm, CONFIRM_RATIO } from './slideConfirm';
import { SLIDES, shouldShowOnboarding } from './onboarding';
import { APP_NAME } from './appName';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('อักษรย่อบนวงกลมโปรไฟล์', () => {
  it('สองคำขึ้นไป = อักษรแรกของสองคำแรก', () => {
    expect(initialsOf('ปณุวัฒน์ ทดสอบ')).toBe('ปท');
    expect(initialsOf('สุชาติ ธนวัฒน์ จริงจัง')).toBe('สธ');
  });

  it('คำเดียว = สองอักษรแรก (ชื่อไทยเขียนติดกันได้)', () => {
    expect(initialsOf('ณิชา')).toBe('ณิ');
  });

  it('ช่องว่างเกินไม่ทำให้ได้อักษรว่าง', () => {
    expect(initialsOf('  ปณุวัฒน์   ทดสอบ  ')).toBe('ปท');
  });

  it('ไม่มีชื่อ = เครื่องหมายคำถาม ไม่ใช่สตริงว่าง', () => {
    // วงกลมเปล่าสนิทอ่านเหมือนรูปโหลดไม่ขึ้น ซึ่งคนละเรื่องกับ "ไม่มีรูป"
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });

  it('นับเป็นตัวอักษร ไม่ใช่ code unit', () => {
    // อักษรนอก BMP (เช่นอิโมจิในชื่อเล่น) ต้องไม่ถูกตัดครึ่งจนเป็นตัวประหลาด
    expect([...initialsOf('𝒜lice')].length).toBeLessThanOrEqual(2);
  });
});

describe('เกณฑ์การลากเพื่อยืนยัน', () => {
  it('ลากไม่ถึงเกณฑ์ = ยังไม่ยืนยัน', () => {
    expect(reachedConfirm(50, 200)).toBe(false);
    expect(reachedConfirm(200 * CONFIRM_RATIO - 1, 200)).toBe(false);
  });

  it('ลากถึงเกณฑ์พอดีก็นับ (นิ้วมักปล่อยก่อนสุดราง)', () => {
    expect(reachedConfirm(200 * CONFIRM_RATIO, 200)).toBe(true);
    expect(reachedConfirm(200, 200)).toBe(true);
  });

  it('รางกว้าง 0 ต้องไม่ยืนยันเอง', () => {
    // เกิดจริงตอนคอมโพเนนต์ยังไม่ถูกวัดขนาด (ref ยังว่าง) — ถ้าไม่กัน
    // การแตะเบาๆ ครั้งเดียวจะลงเวลาให้ทันทีโดยไม่มีใครลาก
    expect(reachedConfirm(0, 0)).toBe(false);
    expect(reachedConfirm(10, 0)).toBe(false);
  });
});

describe('หน้าแนะนำแอปครั้งแรก', () => {
  it('โผล่เฉพาะก่อนหน้าล็อกอิน และเฉพาะคนที่ยังไม่เคยดู', () => {
    expect(shouldShowOnboarding('login', false)).toBe(true);
    expect(shouldShowOnboarding('login', true)).toBe(false);
  });

  it('ห้ามแทรกก่อนจอขอสิทธิ์ตำแหน่งหรือจออื่นใด', () => {
    // ลำดับ "ตรวจตัวตนก่อนขออะไรจากเครื่องเขา" เป็นการแก้บั๊กจริง (#726)
    // หน้าแนะนำที่โผล่คั่นตรงนั้นจะพาลำดับกลับไปผิดแบบเดิม
    for (const screen of ['geo', 'app', 'loading', 'session_error']) {
      expect(shouldShowOnboarding(screen, false), `${screen} ต้องไม่โชว์หน้าแนะนำ`).toBe(false);
    }
  });

  it('ข้อความบนสไลด์ต้องไม่สัญญาฟีเจอร์ที่ระบบยังไม่มี', () => {
    // ต้นฉบับพูดถึงสแกน QR · ดูตารางกะ · สลับกะกับเพื่อน · สลิปเงินเดือน ·
    // แฟ้มเอกสาร — ยังไม่มีสักอย่าง. **เทสนี้เขียนเป็น "ไม่มีสไลด์ไหนอ้าง"
    // ไม่ใช่ "สไลด์ที่ 1 ถูกต้อง"** เพื่อให้ครอบสไลด์ที่เพิ่มมาวันหลังด้วย
    const banned = ['QR', 'คิวอาร์', 'สลิปเงินเดือน', 'แฟ้มเอกสาร', 'สลับกะ', 'ตารางกะ', 'สวัสดิการ'];
    const text = SLIDES.map((s) => `${s.title} ${s.body} ${s.art}`).join(' ');
    for (const word of banned) {
      expect(text.includes(word), `สไลด์อ้างถึง "${word}" ซึ่งระบบยังไม่มี`).toBe(false);
    }
    expect(SLIDES.length).toBeGreaterThan(0);
  });

  it('ทุกสไลด์มีเนื้อครบ ไม่มีใบว่าง', () => {
    for (const s of SLIDES) {
      expect(s.title.trim().length, `${s.key} ไม่มีหัวข้อ`).toBeGreaterThan(0);
      expect(s.body.trim().length, `${s.key} ไม่มีคำอธิบาย`).toBeGreaterThan(0);
      expect(s.art.trim().length, `${s.key} ไม่มีป้ายภาพประกอบ`).toBeGreaterThan(0);
    }
  });
});

describe('ชื่อแอปมีเจ้าของที่เดียว', () => {
  const dir = join(__dirname);
  const tsxFiles = (d: string): { path: string; src: string }[] => {
    const out: { path: string; src: string }[] = [];
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) { out.push(...tsxFiles(full)); continue; }
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      out.push({ path: full.slice(dir.length + 1), src: readFileSync(full, 'utf8') });
    }
    return out;
  };

  it('ไม่มีคอมโพเนนต์ไหนพิมพ์ชื่อแอปเอง — ต้องอ่านจาก APP_NAME', () => {
    // ชื่อแบรนด์ที่กระจายหลายไฟล์คือของที่วันหนึ่งจะไม่ตรงกัน — และรอบที่
    // เปลี่ยนชื่อทั้งแอปก็เจอว่ามันกระจายอยู่ 5 ที่จริงๆ
    const offenders = tsxFiles(dir)
      // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นคำอธิบายจะถูกนับเป็นการใช้งาน
      .filter((f) => new RegExp(APP_NAME, 'i')
        .test(f.src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map((f) => f.path);
    expect(offenders, 'ต้องอ่านชื่อจาก APP_NAME / <Wordmark /> แทนการพิมพ์เอง').toEqual([]);
  });

  it('ชื่อในหน้าเว็บกับใน manifest ตรงกับชื่อในโค้ด', () => {
    // สามที่นี้คนละไฟล์คนละภาษา ไม่มี type ไหนบังคับให้ตรงกัน — เปลี่ยนชื่อ
    // แล้วลืม manifest = ชื่อบนหน้าจอโฮมของมือถือไม่ตรงกับในแอป
    const html = readFileSync(join(dir, '..', 'index.html'), 'utf8');
    const manifest = JSON.parse(
      readFileSync(join(dir, '..', 'public', 'manifest.webmanifest'), 'utf8'),
    ) as { name: string };
    expect(html, 'index.html <title> ไม่ตรงกับ APP_NAME').toContain(`<title>${APP_NAME} —`);
    expect(manifest.name.startsWith(`${APP_NAME} —`), `manifest.name = ${manifest.name}`).toBe(true);
  });
});
