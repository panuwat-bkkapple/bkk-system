/**
 * ราวกันตกของ "หน้าตาเปลือกแอป" — กติกาที่ tsc/eslint/เทสพฤติกรรมมองไม่เห็น
 *
 * ที่มา (5 ก.ย. 2569): เจ้าของงานส่งภาพหน้าขอลามาบอกว่า UI พัง — ชื่อกับรหัส
 * พนักงานหายไปจากหัวแอป เหลือกล่องขาวเปล่าๆ **ไม่มีอะไรพัง ไม่มี error ไม่มี
 * เทสแดง** สาเหตุคือหัวแอปใช้ `className="row"` ซึ่งชนกับ `.row` ที่เป็น
 * **การ์ดในลิสต์** (พื้นขาว มีขอบ) สไตล์การ์ดจึงทาทับหัวแอปสีกรม แล้วตัวหนังสือ
 * สีขาวก็อยู่บนพื้นขาว
 *
 * ตาราง injection (วัดจริงทั้ง 12 ข้อ 5 ก.ย. 2569 หลังเปลี่ยนมาใช้ธีมการ์ดนุ่ม
 * — ตัวเลขคือ **จำนวนเทสที่แดง** ไม่ใช่จำนวน assertion):
 *   ย้อน `.list .row` -> `.row`                              -> แดง 1
 *   `.head` ทาพื้นเข้มโดยไม่แก้สีตัวอักษร                     -> แดง 1 (ชั้นเบราว์เซอร์)
 *   `.gate` ทาพื้นเข้มโดยไม่แก้สีตัวอักษร                     -> แดง 1 (ชั้นเบราว์เซอร์)
 *   App.tsx เขียนมาร์กอัปหัวแอปเองซ้ำ                         -> แดง 1
 *   หน้าใดหน้าหนึ่งเขียน `<div className="gate">` เอง          -> แดง 1
 *   ถอด `var(--safe-t)` ออกจาก `.head`                        -> แดง 1
 *   ถอด `var(--safe-t)` ออกจาก `.gate`                        -> แดง 1
 *   ถอดกฎ `.datefield.empty > input::-webkit-datetime-edit`   -> แดง 1
 *   ถอดการติดคลาส `empty` ใน DateField.tsx                     -> แดง 1
 *   หน้าใดหน้าหนึ่งเขียน `input type="date"` เองแทน DateField   -> แดง 1
 *   ตั้ง `--warn` เป็นสีอ่อน (#d9a441) บนพื้น warn เดิม        -> แดง 1 (ชั้นเบราว์เซอร์)
 *   ลบ `viewport-fit=cover` ออกจาก index.html                  -> เขียว (ดูหมายเหตุ)
 *
 * **หมายเหตุที่เขียวและเขียวถูกแล้ว ไม่ใช่รูของด่าน:** ลบ `viewport-fit=cover`
 * ทำให้เว็บวิวเลิกกินพื้นที่ใต้ขอบจอ = การเผื่อไม่จำเป็นอีก กฎเรื่อง `--safe-t`
 * จึงเขียนเป็นเงื่อนไขตามนั้น (บังคับตลอดไป = อ้างเกินกว่าที่เรารู้)
 *
 * **ชั้นเบราว์เซอร์ไม่ใช่ของซ้ำซ้อนกับชั้นสตริง** — injection ที่ทา `.head` เป็น
 * สีอ่อนโดยไม่แตะ `.row` เลย ทำให้ชั้นสตริงเขียวสนิท (ไม่มีกฎไหนผิดรูป) แต่
 * ตัวหนังสือขาวไปนั่งบนพื้นสว่าง = อ่านไม่ออกจริง ชั้นเบราว์เซอร์จับได้ตัวเดียว
 *
 * **สิ่งที่ด่านนี้ยัง*ไม่*ครอบ และไม่แกล้งทำเป็นครอบ:** หน้าในแอป (Home/Leave/
 * ShiftChange/Inbox/History) import `../api` ซึ่งลาก Firebase มาด้วย จึง SSR
 * ไม่ได้ ชั้นเบราว์เซอร์เลยวัดได้แค่ `AppHeader` กับ `GpsGate` (ซึ่งผ่าน
 * `GateShell`) — ส่วนสีของป้ายและกล่องข้อความที่หน้าพวกนั้นใช้ ถูกคุมด้วย
 * "ทุกรูปแบบที่ประกาศไว้ใน CSS ต้องอ่านออก" แทน ซึ่งครอบโดยโครงสร้าง
 * ไม่ใช่ครอบเท่าที่เรานึกออก
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import AppHeader from './AppHeader';
import GpsGate from './pages/GpsGate';
import { join } from 'node:path';

const here = join(__dirname);
const css = readFileSync(join(here, 'styles.css'), 'utf8');
const appTsx = readFileSync(join(here, 'App.tsx'), 'utf8');
const headerTsx = readFileSync(join(here, 'AppHeader.tsx'), 'utf8');
const gateTsx = readFileSync(join(here, 'GateShell.tsx'), 'utf8');
const dateFieldTsx = readFileSync(join(here, 'DateField.tsx'), 'utf8');

/** ไฟล์ .tsx ทุกไฟล์ของแอป (ไม่รวมเทส) — กฎบางข้อต้องตรวจ *ทั้งแอป*
 *  ไม่ใช่หน้าที่เราบังเอิญนึกถึง */
function allTsx(dir: string): { path: string; src: string }[] {
  const out: { path: string; src: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...allTsx(full)); continue; }
    if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
    out.push({ path: full.slice(here.length + 1), src: readFileSync(full, 'utf8') });
  }
  return out;
}
const indexHtml = readFileSync(join(here, '..', 'index.html'), 'utf8');

/** คู่ (selector, บล็อกประกาศ) ของทุกกฎในไฟล์ — พอสำหรับกติกาที่เราตรวจ */
function rules(source: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้น selector ปลอมจากข้อความในคอมเมนต์จะติดมาด้วย
  // (บทเรียน P3-c: regex ของเทสโครงสร้างแมตช์คอมเมนต์ได้)
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

/** คลาสที่ถูกใช้กับ element ที่อยู่ "ข้างใน" คอนเทนเนอร์หนึ่ง (ไม่รวมตัวมันเอง) */
function classesInside(tsx: string, root: string): string[] {
  const open = `<div className="${root}">`;
  const start = tsx.indexOf(open);
  expect(start, `หา ${open} ไม่เจอ`).toBeGreaterThan(-1);
  const block = tsx.slice(start + open.length).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const found = new Set<string>();
  for (const m of block.matchAll(/className="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) found.add(c);
  }
  found.delete(root);
  return [...found];
}

/** คลาสที่ทาพื้นโดยไม่ตั้งสีตัวอักษรของตัวเอง = รูปของบั๊กขาวบนขาว */
function bgWithoutColor(names: string[]): string[] {
  const offenders: string[] = [];
  for (const rule of rules(css)) {
    if (!/(^|[^-])background\s*:/.test(rule.body)) continue;
    if (/(^|[^-])color\s*:/.test(rule.body)) continue;
    for (const sel of rule.selector.split(',').map((s) => s.trim())) {
      // สนใจเฉพาะ selector ที่เป็นคลาสเดี่ยวๆ ไม่มีบรรพบุรุษกำกับ — ตัวที่มี
      // บรรพบุรุษ (เช่น `.list .row`) เอื้อมมาถึงเปลือกไม่ได้อยู่แล้ว
      const bare = /^\.([A-Za-z0-9_-]+)$/.exec(sel);
      if (bare && names.includes(bare[1])) offenders.push(`${sel} -> ${rule.body.trim()}`);
    }
  }
  return offenders;
}

describe('เปลือกแอปพนักงาน — กติกาที่จับได้เฉพาะตอนวาดจริง', () => {
  it('คลาสในหัวแอปและจอเต็มที่ทาสีพื้น ต้องกำหนดสีตัวอักษรของตัวเองด้วย', () => {
    // **นี่คือรูปของบั๊กจริงเป๊ะๆ** — เปลือกตั้งสีตัวอักษรไว้ ลูกทุกตัวจึงได้สี
    // นั้นมาโดยการสืบทอด. กฎที่ทา `background` ให้คลาสในนั้นแต่ **ไม่ตั้ง `color`
    // ของตัวเอง** = ตัวหนังสืออาจไปนั่งบนพื้นที่กลืนกับมัน (`.row` ทาพื้นขาว
    // โดยไม่ตั้งสี -> ขาวบนขาว) ส่วน `.chip`/`.btn.ghost` ทาพื้นขาว **พร้อมตั้ง
    // `color`** จึงอ่านออกและไม่ถือว่าผิดกฎ
    const inHead = classesInside(headerTsx, 'head');
    const inGate = classesInside(gateTsx, 'gate');
    expect(inHead.length).toBeGreaterThan(0);
    expect(inGate.length).toBeGreaterThan(0);
    expect(bgWithoutColor([...inHead, ...inGate]),
      'คลาสในเปลือกทาพื้นโดยไม่ตั้งสีตัวอักษร = เสี่ยงกลืนพื้น').toEqual([]);
  });

  it('App.tsx ใช้หัวแอปที่แยกไฟล์ไว้ ไม่ได้เขียนมาร์กอัปเองซ้ำ', () => {
    // ถ้ามีคนเขียน `<div className="head">` กลับเข้าไปใน App.tsx ด่านข้างบนกับ
    // ชั้นเบราว์เซอร์จะไปวัด AppHeader ที่ไม่มีใครใช้ = ด่านที่ตรวจของผิดชิ้น
    expect(appTsx).toMatch(/<AppHeader\b/);
    expect(appTsx.includes('<div className="head">'),
      'App.tsx ต้องไม่เขียนมาร์กอัปหัวแอปเอง — ใช้ <AppHeader /> เท่านั้น').toBe(false);
  });

  it('จอเต็มทุกใบผ่าน GateShell ที่เดียว', () => {
    // เหตุผลเดียวกับ DateField: ล็อกอิน / สิทธิ์ตำแหน่ง / ถามตัวตนไม่สำเร็จ /
    // กำลังโหลด เคยเขียนเปลือกของตัวเองคนละไฟล์ แก้ที่หนึ่งอีกที่ยังพัง
    const offenders = allTsx(here)
      .filter((f) => f.path !== 'GateShell.tsx')
      .filter((f) => /<div className="gate"/.test(f.src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')))
      .map((f) => f.path);
    expect(offenders, 'ต้องใช้ <GateShell /> แทน').toEqual([]);
    const users = allTsx(here).filter((f) => /<GateShell\b/.test(f.src)).map((f) => f.path);
    expect(users.length, 'ไม่มีใครใช้ GateShell เลย').toBeGreaterThan(0);
  });

  it('การ์ดในลิสต์ถูก scope ไว้ใต้ .list', () => {
    const cardRules = rules(css).filter((r) => /(^|,|\s)\.row(\s|$|,)/.test(r.selector));
    expect(cardRules.length).toBeGreaterThan(0);
    for (const r of cardRules) {
      for (const sel of r.selector.split(',').map((s) => s.trim())) {
        if (!/\.row/.test(sel)) continue;
        expect(sel.startsWith('.list '), `\`${sel}\` ต้องอยู่ใต้ .list`).toBe(true);
      }
    }
  });

  it('หัวแอปกับจอเต็มเผื่อพื้นที่ปลอดภัยของขอบจอ (viewport-fit=cover)', () => {
    // **กฎนี้มีเงื่อนไขโดยตั้งใจ** — `viewport-fit=cover` คือสิ่งที่ทำให้เลย์เอาต์
    // กินพื้นที่ขอบจอทั้งบนและล่าง ถ้าวันหนึ่งถอดออก การเผื่อก็ไม่จำเป็นอีก
    // (แถบสถานะเปลี่ยนเป็น `default` ตอนย้ายมาธีมสว่างแล้ว เพราะ
    // `black-translucent` บังคับตัวอักษรสีขาวซึ่งอ่านไม่ออกบนหัวแอปสว่าง)
    if (!indexHtml.includes('viewport-fit=cover')) return;
    expect(css).toMatch(/--safe-t:\s*env\(safe-area-inset-top/);
    for (const sel of ['.head', '.gate']) {
      const rule = rules(css).find((r) => r.selector === sel);
      expect(rule, `ไม่พบกฎของ ${sel}`).toBeTruthy();
      expect(rule!.body, `${sel} ต้องเผื่อ --safe-t`).toContain('var(--safe-t)');
    }
  });

  it('ช่องวันที่ที่ยังว่างมีป้ายของเราตัวเดียว ไม่ซ้อนกับป้ายของเบราว์เซอร์', () => {
    // iOS วาดช่องว่างเป็นกล่องเปล่า (จึงต้องมีป้ายของเราเอง) ส่วน Chromium
    // วาด mm/dd/yyyy ให้ (จึงต้องซ่อนตอนว่าง) — ขาดข้อไหนก็ผิดบนเครื่องหนึ่ง
    expect(css).toMatch(/\.datefield\.empty\s*>\s*input::-webkit-datetime-edit\s*\{[^}]*opacity:\s*0/);
    expect(dateFieldTsx).toMatch(/className=\{value \? 'datefield' : 'datefield empty'\}/);
  });

  it('ไม่มีหน้าไหนเขียน input[type=date] เอง — ต้องผ่าน DateField ที่เดียว', () => {
    // **รอบแรกแก้ที่หน้าขอลาหน้าเดียว หน้าเปลี่ยนกะยังเป็นกล่องเปล่าอยู่**
    // และเทสรอบนั้นก็ดูแค่ `Leave.tsx` จึงเขียวสนิท — เจ้าของงานส่งภาพมาอีกรอบ
    // (กฎ "กฎมีกี่คนอ่าน": กฎถูกแล้ว แต่ติดตั้งไม่ครบทุกคนที่อ่านมัน)
    const offenders = allTsx(here)
      .filter((f) => f.path !== 'DateField.tsx')
      .filter((f) => /type=["']date["']/.test(f.src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')))
      .map((f) => f.path);
    expect(offenders, 'ต้องใช้ <DateField /> แทน').toEqual([]);

    // และต้องมีคนใช้จริง ไม่ใช่คอมโพเนนต์ที่ไม่มีใครเรียก
    const users = allTsx(here).filter((f) => /<DateField\b/.test(f.src)).map((f) => f.path);
    expect(users.length, 'ไม่มีใครใช้ DateField เลย').toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ชั้นที่สอง: วาดจริงในเบราว์เซอร์แล้ววัดสี
//
// **ชั้นสตริงข้างบนเข้ารหัสกฎที่เรา*รู้แล้ว* ชั้นนี้จับกฎที่เรายังไม่รู้** — บั๊ก
// จริงเป็นเรื่องของ cascade (กฎที่ไม่ได้ scope เอื้อมมาทับ) ซึ่งอ่านจากสตริง
// ทีละกฎไม่มีทางเห็น ต้องให้เบราว์เซอร์คำนวณให้
//
// CI ติดตั้ง chromium อยู่แล้วสำหรับด่านพิมพ์ใบเสร็จ ชั้นนี้จึงแทบไม่มีต้นทุนเพิ่ม
// และใช้สวิตช์ตัวเดียวกัน (`REQUIRE_PRINT_CHECKS=1`) — ไม่มีเบราว์เซอร์ใน CI =
// สอบตก ไม่ใช่ข้ามเงียบๆ
const REQUIRED = process.env.REQUIRE_PRINT_CHECKS === '1';

const findChromium = (): string | undefined => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    const bin = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
};

/** อัตราส่วนความต่างของสีตาม WCAG — 1 = สีเดียวกันเป๊ะ (มองไม่เห็น) */
function contrastRatio(a: string, b: string): number {
  const lum = (c: string) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return 0;
    const [r, g, bl] = m.slice(0, 3).map((v) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** ทุกรูปแบบของป้าย/กล่องข้อความที่ **CSS ประกาศไว้** — ครอบโดยโครงสร้าง
 *  ไม่ใช่ครอบเท่าที่เรานึกออก (`.pill.ok`, `.note.bad`, ...) */
function toneVariants(base: 'pill' | 'note'): string[] {
  const out = new Set<string>([base]);
  for (const r of rules(css)) {
    for (const sel of r.selector.split(',').map((s) => s.trim())) {
      const m = new RegExp(`^\\.${base}\\.([A-Za-z0-9_-]+)$`).exec(sel);
      if (m) out.add(`${base} ${m[1]}`);
    }
  }
  return [...out];
}

describe('เปลือกแอปวาดจริงในเบราว์เซอร์', () => {
  let browser: import('playwright').Browser | undefined;
  let url = '';
  let skipReason = '';

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'employee-chrome-'));
    const header = renderToStaticMarkup(
      createElement(AppHeader, { name: 'ปณุวัฒน์ ทดสอบ', sub: 'EMP-0001 · ผู้จัดการ' }),
    );
    // `GpsGate` เป็นจอเต็มจริงใบเดียวที่ SSR ได้ (ไม่ลาก Firebase) จึงใช้มัน
    // วัดเปลือก `GateShell` แทนที่จะประกอบมาร์กอัปปลอมขึ้นมาเอง
    const gate = renderToStaticMarkup(createElement(GpsGate, {
      block: {
        code: 'denied',
        title: 'แอปยังไม่ได้รับสิทธิ์ตำแหน่ง',
        detail: 'กดปุ่มด้านล่างเพื่อขอสิทธิ์อีกครั้ง',
        action: 'ขอสิทธิ์ตำแหน่ง',
      },
      onAct: () => {},
    }));
    // ป้ายและกล่องข้อความ วัดบนพื้นสองแบบที่มันถูกใช้จริง (พื้นหน้า และในการ์ด)
    const tones = [...toneVariants('pill'), ...toneVariants('note')]
      .map((cls) => `<div class="${cls}" data-tone="${cls}">ตัวอย่าง</div>`).join('');
    const file = join(dir, 'chrome.html');
    writeFileSync(file,
      `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
      `<style>${css}</style></head><body>` +
      `<div class="app">${header}<div class="main" id="on-bg">${tones}</div>` +
      `<div class="main"><div class="card" id="on-card">${tones}</div></div></div>` +
      `<div id="gate">${gate}</div>` +
      `</body></html>`);
    url = `file://${file}`;

    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ executablePath: findChromium() });
    } catch (err) {
      skipReason = `เปิด Chromium ไม่ได้: ${(err as Error).message.split('\n')[0]}`;
    }
    if (!browser && REQUIRED) {
      throw new Error(
        `REQUIRE_PRINT_CHECKS=1 แต่รันด่านหน้าจอไม่ได้ — ${skipReason}\n` +
          'ใน CI ต้องมี Chromium เสมอ ห้ามปล่อยให้ด่านนี้ข้ามตัวเองเงียบๆ',
      );
    }
  }, 120_000);

  afterAll(async () => { await browser?.close(); });

  const measure = async (sels: Record<string, string>) => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(url);
    const seen = await page.evaluate((map: Record<string, string>) => {
      // พื้นหลังที่ *มีผลจริง* คือตัวแรกที่ไม่โปร่งใสเมื่อไล่ขึ้นไปหาบรรพบุรุษ
      const effectiveBg = (el: Element | null): string => {
        for (let n: Element | null = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return bg;
        }
        return 'rgb(255, 255, 255)';
      };
      const out: Record<string, { color: string; bg: string; text: string } | null> = {};
      for (const [name, sel] of Object.entries(map)) {
        const el = document.querySelector(sel);
        out[name] = el
          ? { color: getComputedStyle(el).color, bg: effectiveBg(el), text: (el.textContent || '').trim() }
          : null;
      }
      return out;
    }, sels);
    await page.close();

    for (const [what, got] of Object.entries(seen)) {
      expect(got, `หา ${what} ไม่เจอ`).toBeTruthy();
      expect(got!.text.length, `${what} ไม่มีข้อความ`).toBeGreaterThan(0);
      const ratio = contrastRatio(got!.color, got!.bg);
      expect(ratio, `${what}: ${got!.color} บน ${got!.bg} = ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  };

  it('ชื่อและรหัสพนักงานอ่านออกจริง (ไม่ใช่ขาวบนขาว)', async () => {
    if (!browser) { expect(skipReason).not.toBe(''); return; }
    await measure({
      'หัวแอป h1': '.head h1',
      'หัวแอป sub': '.head .sub',
      'หัวแอป ปุ่มออก': '.head button',
    });
  }, 60_000);

  it('จอเต็ม (GateShell) อ่านออกจริงทุกส่วน', async () => {
    if (!browser) { expect(skipReason).not.toBe(''); return; }
    await measure({
      'จอเต็ม หัวข้อ': '#gate .gate h2',
      'จอเต็ม คำอธิบาย': '#gate .gate p',
      'จอเต็ม ปุ่มหลัก': '#gate .gate .btn',
      'จอเต็ม รหัสเหตุผล': '#gate .gate .foot',
    });
  }, 60_000);

  it('ป้ายและกล่องข้อความทุกรูปแบบที่ประกาศไว้ อ่านออกทั้งบนพื้นหน้าและในการ์ด', async () => {
    if (!browser) { expect(skipReason).not.toBe(''); return; }
    const variants = [...toneVariants('pill'), ...toneVariants('note')];
    expect(variants.length).toBeGreaterThan(4);
    const sels: Record<string, string> = {};
    for (const cls of variants) {
      const attr = `[data-tone="${cls}"]`;
      sels[`${cls} (พื้นหน้า)`] = `#on-bg ${attr}`;
      sels[`${cls} (ในการ์ด)`] = `#on-card ${attr}`;
    }
    await measure(sels);
  }, 60_000);
});
