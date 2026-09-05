/**
 * ราวกันตกของ "หน้าตาเปลือกแอป" — กติกาที่ tsc/eslint/เทสพฤติกรรมมองไม่เห็น
 *
 * ที่มา (5 ก.ย. 2569): เจ้าของงานส่งภาพหน้าขอลามาบอกว่า UI พัง — ชื่อกับรหัส
 * พนักงานหายไปจากหัวแอป เหลือกล่องขาวเปล่าๆ **ไม่มีอะไรพัง ไม่มี error ไม่มี
 * เทสแดง** สาเหตุคือหัวแอปใช้ `className="row"` ซึ่งชนกับ `.row` ที่เป็น
 * **การ์ดในลิสต์** (พื้นขาว มีขอบ) สไตล์การ์ดจึงทาทับหัวแอปสีกรม แล้วตัวหนังสือ
 * สีขาวก็อยู่บนพื้นขาว — วัดจริงในเบราว์เซอร์: bg `rgb(255,255,255)` คู่กับ
 * color `rgb(255,255,255)`
 *
 * ตาราง injection (วัดจริง ไม่ได้เดา):
 *   ย้อน `.list .row` -> `.row`                            -> แดง 1
 *   ย้อน `className="bar"` -> `"row"` (เดี่ยว)             -> **เขียว** (ดูหมายเหตุ)
 *   ย้อนทั้งสองข้อข้างบนพร้อมกัน = บั๊กจริงเป๊ะๆ            -> แดง 3
 *   `.head` ทาพื้นสีอ่อนโดยตัวหนังสือยังขาว                 -> แดง 1 (เฉพาะชั้นเบราว์เซอร์)
 *   App.tsx เขียนมาร์กอัปหัวแอปเองซ้ำ                       -> แดง 1
 *   ถอด `var(--safe-t)` ออกจาก `.head`                      -> แดง 1
 *   ถอด `var(--safe-t)` ออกจาก `.gate`                      -> แดง 1
 *   ถอดกฎ `.datefield.empty > input::-webkit-datetime-edit`  -> แดง 1
 *   ถอดการติดคลาส `empty` ใน DateField.tsx                   -> แดง 1
 *   หน้าใดหน้าหนึ่งเขียน `input type="date"` เองแทน DateField  -> แดง 1
 *   ลบ `viewport-fit=cover` ออกจาก index.html                -> เขียว (ดูหมายเหตุ)
 *
 * **หมายเหตุสองข้อที่เขียว และทั้งคู่เขียวถูกแล้ว ไม่ใช่รูของด่าน:**
 * - เปลี่ยนหัวแอปกลับไปใช้ `row` เดี่ยวๆ ไม่ทำให้พัง เพราะ `.row` ถูก scope ไว้
 *   ใต้ `.list` แล้ว มันจึงเอื้อมมาไม่ถึง — **บั๊กเดิมต้องการสองข้อพร้อมกัน**
 *   (กับดัก injection ข้อ 1: ต้องถอดเป็นคู่ด้วย ไม่ใช่ทีละตัวอย่างเดียว)
 * - ลบ `viewport-fit=cover` ทำให้เว็บวิวเลิกกินพื้นที่ใต้แถบสถานะ = บั๊กหายไป
 *   เอง เทสจึงเขียวถูกแล้ว และกฎเรื่อง `--safe-t` เขียนเป็นเงื่อนไขตามนั้น
 *
 * **ชั้นเบราว์เซอร์ไม่ใช่ของซ้ำซ้อนกับชั้นสตริง** — injection ที่ทา `.head` เป็น
 * สีอ่อนโดยไม่แตะ `.row` เลย ทำให้ชั้นสตริงเขียวสนิท (ไม่มีกฎไหนผิดรูป) แต่
 * ตัวหนังสือขาวไปนั่งบนพื้นสว่าง = อ่านไม่ออกจริง ชั้นเบราว์เซอร์จับได้ตัวเดียว
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import AppHeader from './AppHeader';
import { join } from 'node:path';

const here = join(__dirname);
const css = readFileSync(join(here, 'styles.css'), 'utf8');
const appTsx = readFileSync(join(here, 'App.tsx'), 'utf8');
const headerTsx = readFileSync(join(here, 'AppHeader.tsx'), 'utf8');
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

/** คลาสที่ถูกใช้กับ element ที่อยู่ "ข้างใน" หัวแอป (ไม่รวมตัว .head เอง) */
function classesInsideHead(tsx: string): string[] {
  const start = tsx.indexOf('<div className="head">');
  expect(start, 'หา <div className="head"> ใน AppHeader.tsx ไม่เจอ').toBeGreaterThan(-1);
  const block = tsx.slice(start + '<div className="head">'.length)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const found = new Set<string>();
  for (const m of block.matchAll(/className="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/).filter(Boolean)) found.add(c);
  }
  found.delete('head');
  return [...found];
}

describe('เปลือกแอปพนักงาน — กติกาที่จับได้เฉพาะตอนวาดจริง', () => {
  it('คลาสในหัวแอปที่ทาสีพื้น ต้องกำหนดสีตัวอักษรของตัวเองด้วย', () => {
    // **นี่คือรูปของบั๊กจริงเป๊ะๆ** — หัวแอปตั้ง `color: #fff` ไว้ ลูกทุกตัวจึง
    // ได้ตัวหนังสือสีขาวมาโดยการสืบทอด. กฎที่ทา `background` ให้คลาสในนั้นแต่
    // **ไม่ตั้ง `color` ของตัวเอง** = ตัวหนังสือขาวไปนั่งบนพื้นที่อาจสว่าง
    // (`.row` ทาพื้นขาวโดยไม่ตั้งสี -> ขาวบนขาว) ส่วน `.btn.ghost` ทาพื้นขาว
    // **พร้อมตั้ง `color: var(--ink)`** จึงอ่านออกและไม่ถือว่าผิดกฎ
    const inHead = classesInsideHead(headerTsx);
    expect(inHead.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const rule of rules(css)) {
      if (!/(^|[^-])background\s*:/.test(rule.body)) continue;
      if (/(^|[^-])color\s*:/.test(rule.body)) continue;
      for (const sel of rule.selector.split(',').map((s) => s.trim())) {
        // สนใจเฉพาะ selector ที่เป็นคลาสเดี่ยวๆ ไม่มีบรรพบุรุษกำกับ — ตัวที่มี
        // บรรพบุรุษ (เช่น `.list .row`) เอื้อมมาถึงหัวแอปไม่ได้อยู่แล้ว
        const bare = /^\.([A-Za-z0-9_-]+)$/.exec(sel);
        if (bare && inHead.includes(bare[1])) offenders.push(`${sel} -> ${rule.body.trim()}`);
      }
    }
    expect(offenders, 'คลาสในหัวแอปทาพื้นโดยไม่ตั้งสีตัวอักษร = เสี่ยงขาวบนขาว').toEqual([]);
  });

  it('App.tsx ใช้หัวแอปที่แยกไฟล์ไว้ ไม่ได้เขียนมาร์กอัปเองซ้ำ', () => {
    // ถ้ามีคนเขียน `<div className="head">` กลับเข้าไปใน App.tsx ด่านข้างบนกับ
    // ชั้นเบราว์เซอร์จะไปวัด AppHeader ที่ไม่มีใครใช้ = ด่านที่ตรวจของผิดชิ้น
    expect(appTsx).toMatch(/<AppHeader\b/);
    expect(appTsx.includes('<div className="head">'),
      'App.tsx ต้องไม่เขียนมาร์กอัปหัวแอปเอง — ใช้ <AppHeader /> เท่านั้น').toBe(false);
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

  it('หัวแอปกับจอเต็มเผื่อพื้นที่ใต้แถบสถานะ (viewport-fit=cover + black-translucent)', () => {
    // **กฎนี้มีเงื่อนไขโดยตั้งใจ** — สองหัวนี้คือสิ่งที่ทำให้เว็บวิวกินพื้นที่
    // ใต้แถบสถานะ ถ้าวันหนึ่งถอดออก การเผื่อก็ไม่จำเป็นอีก จึงไม่บังคับให้ต้อง
    // มีทั้งคู่ตลอดไป (บังคับ = อ้างเกินกว่าที่เรารู้)
    const edgeToEdge = indexHtml.includes('viewport-fit=cover')
      && indexHtml.includes('black-translucent');
    if (!edgeToEdge) return;
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

describe('หัวแอปวาดจริงในเบราว์เซอร์', () => {
  let browser: import('playwright').Browser | undefined;
  let url = '';
  let skipReason = '';

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'employee-chrome-'));
    const markup = renderToStaticMarkup(
      createElement(AppHeader, { name: 'ปณุวัฒน์ ทดสอบ', sub: 'EMP-0001 · ผู้จัดการ' }),
    );
    const file = join(dir, 'head.html');
    writeFileSync(file,
      `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
      `<style>${css}</style></head><body><div class="app">${markup}</div></body></html>`);
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

  it('ชื่อและรหัสพนักงานอ่านออกจริง (ไม่ใช่ขาวบนขาว)', async () => {
    if (!browser) { expect(skipReason).not.toBe(''); return; }
    const page = await browser.newPage({ viewport: { width: 390, height: 400 } });
    await page.goto(url);
    const seen = await page.evaluate(() => {
      // พื้นหลังที่ *มีผลจริง* คือตัวแรกที่ไม่โปร่งใสเมื่อไล่ขึ้นไปหาบรรพบุรุษ
      const effectiveBg = (el: Element | null): string => {
        for (let n: Element | null = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(bg)) return bg;
        }
        return 'rgb(255, 255, 255)';
      };
      const pick = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return { color: getComputedStyle(el).color, bg: effectiveBg(el),
          text: (el.textContent || '').trim() };
      };
      return { h1: pick('.head h1'), sub: pick('.head .sub'), out: pick('.head button') };
    });
    await page.close();

    for (const [what, got] of Object.entries(seen)) {
      expect(got, `หา ${what} ในหัวแอปไม่เจอ`).toBeTruthy();
      expect(got!.text.length, `${what} ไม่มีข้อความ`).toBeGreaterThan(0);
      const ratio = contrastRatio(got!.color, got!.bg);
      expect(ratio, `${what}: ${got!.color} บน ${got!.bg} = ${ratio.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }, 60_000);
});
