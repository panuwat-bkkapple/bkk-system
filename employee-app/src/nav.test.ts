/**
 * ราวกันตกของโครงการนำทาง
 *
 * **ทำไมต้องมี** — ตอนแอปเป็นแท็บแบนสี่อัน การลืมวาดจอหนึ่งจอเห็นได้ทันที
 * ที่กด แต่พอเป็น hub-and-detail ที่มีสิบจอ การเพิ่มจอเข้า `nav.ts` แล้วลืม
 * ต่อสายใน `App.tsx` จะได้**หน้าว่างเปล่า**ที่ไม่มี error ไม่มีเทสแดง และ
 * ไม่มีใครเจอจนกว่าจะมีคนกดปุ่มนั้น — ตระกูลเดียวกับบั๊กหน้าตาสี่ตัวก่อนหน้า
 *
 * ทุกข้อเขียนเป็น **"ไม่มีจอไหนทำผิด"** ไม่ใช่ "จอ A ถูกต้อง" — ข้อแรกโตตาม
 * จำนวนจอเองได้ ข้อหลังโตไม่ได้ (บทเรียน DateField ที่หลุดรอบสองเพราะด่าน
 * ตรวจแค่ call site เดียว)
 *
 * ตาราง injection (วัดจริง 5 ก.ย. 2569 — ตัวเลขคือจำนวนเทสที่แดง):
 *   ลบ `payslip` ออกจาก render switch ของ App.tsx        -> แดง 1
 *   เปลี่ยน SUB_PARENT.swap จาก 'roster' เป็น 'home'      -> แดง 1
 *   เพิ่มจอใหม่ใน SUB_SCREENS โดยไม่แตะ App.tsx           -> แดง 2 (ไม่มีคนวาด + ไม่มีชื่อ/พ่อ ถ้าลืมด้วย)
 *   ใส่ id ที่ไม่ใช่จอลงใน QUICK_ACTIONS                   -> แดง 1
 *   ใส่ id ที่ไม่ใช่จอลงในเมนูหน้าแรก                       -> แดง 1
 *   ถอดปุ่มย้อนกลับของหน้าลูก (ไม่ส่ง onBack)              -> แดง 1
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TAB_SCREENS, SUB_SCREENS, SUB_PARENT, SUB_TITLE,
  backTarget, titleOf, isTabScreen, type Screen,
} from './nav';
import { TABS, QUICK_ACTIONS } from './tabs';

const here = __dirname;
const appTsx = readFileSync(join(here, 'App.tsx'), 'utf8');
const homeTsx = readFileSync(join(here, 'pages', 'Home.tsx'), 'utf8');
const ALL: Screen[] = [...TAB_SCREENS, ...SUB_SCREENS];

describe('โครงการนำทาง', () => {
  it('ทุกจอที่โมเดลรู้จัก มีคนวาดใน App.tsx จริง', () => {
    // จอที่ประกาศไว้แต่ไม่มีใครวาด = หน้าว่างเปล่าที่ไม่มี error บอก
    const missing = ALL.filter((s) => !appTsx.includes(`screen === '${s}'`));
    expect(missing, 'จอเหล่านี้ไม่มีใครวาด').toEqual([]);
  });

  it('ทุกหน้าลูกมีทั้งแท่นแม่และชื่อหน้า', () => {
    for (const s of SUB_SCREENS) {
      expect(SUB_PARENT[s], `${s} ไม่มีแท่นแม่`).toBeTruthy();
      expect(TAB_SCREENS as readonly string[]).toContain(SUB_PARENT[s]);
      expect(SUB_TITLE[s]?.length, `${s} ไม่มีชื่อหน้า`).toBeGreaterThan(0);
    }
  });

  it('แท่นไม่มีปุ่มย้อนกลับและไม่มีชื่อหน้า ส่วนหน้าลูกมีทั้งคู่', () => {
    // ปุ่มย้อนกลับบนแท่นจะพาออกไปไหนไม่ได้ และชื่อหน้าบนแท่นจะไปทับหัวแบบโลโก้
    for (const s of TAB_SCREENS) {
      expect(isTabScreen(s)).toBe(true);
      expect(backTarget(s), `${s} ไม่ควรมีปุ่มย้อนกลับ`).toBeNull();
      expect(titleOf(s), `${s} ไม่ควรมีชื่อหน้า`).toBeNull();
    }
    for (const s of SUB_SCREENS) {
      expect(backTarget(s), `${s} ต้องรู้ว่าย้อนกลับไปไหน`).toBeTruthy();
      expect(titleOf(s), `${s} ต้องมีชื่อหน้า`).toBeTruthy();
    }
  });

  it('App.tsx ต่อปุ่มย้อนกลับกับ backTarget จริง ไม่ได้เดาเอง', () => {
    // ถ้าหัวแอปไม่ได้รับ onBack หน้าลูกจะตัน — ออกได้ทางเดียวคือกดแท็บ
    expect(appTsx).toMatch(/backTarget\(screen\)/);
    expect(appTsx).toMatch(/onBack=\{/);
    expect(appTsx).toMatch(/title=\{titleOf\(screen\)\}/);
  });

  it('ทางลัดและเมนูหน้าแรกชี้ไปที่จอที่มีอยู่จริงทุกอัน', () => {
    for (const a of QUICK_ACTIONS) {
      expect(ALL, `ทางลัด ${a.id} ไม่ใช่จอที่มีอยู่`).toContain(a.id);
      expect(a.label.length).toBeGreaterThan(0);
    }
    for (const t of TABS) expect(TAB_SCREENS as readonly string[]).toContain(t.id);
    // เมนูหน้าแรกเขียนเป็นตารางในไฟล์ — อ่าน id ออกมาจากตัวอักษรจริง
    const ids = [...homeTsx.matchAll(/\{\s*id:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(ids.length, 'อ่านเมนูหน้าแรกไม่เจอ').toBeGreaterThan(0);
    for (const id of ids) expect(ALL, `เมนู ${id} ไม่ใช่จอที่มีอยู่`).toContain(id as Screen);
  });

  it('แท่นของแถบล่างครบทั้งสี่ ไม่ขาดไม่เกิน', () => {
    // แท่นที่ประกาศไว้แต่ไม่มีปุ่ม = กดไปไม่ถึงเลย (มีแค่ทางอ้อมผ่านหน้าอื่น)
    expect(TABS.map((t) => t.id).sort()).toEqual([...TAB_SCREENS].sort());
  });
});
