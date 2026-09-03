import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReceiptTemplate } from './ReceiptTemplate';
import { RECEIPT_DEFAULTS, type ReceiptSettings } from './receiptSettings';

// =============================================================================
// ด่านผลพิมพ์ของใบเสร็จขาย
//
// ทำไมต้องมี: บั๊กสองตัวใน #653 ผ่าน tsc / eslint / เทส 320 ตัว / vite build /
// CI ทุกช่อง แล้วใบเสร็จยังออกมาผิดขนาดกระดาษ — `@page { size: 80mm auto }`
// เป็น CSS ที่ใช้ไม่ได้ (ห้ามผสม <length> กับ auto) เบราว์เซอร์จึงทิ้งทั้ง
// declaration แล้วตกไปใช้ Letter เงียบๆ และกล่องที่ตรึง 80mm ก็ล้นพื้นที่พิมพ์
// ที่เหลือ 72mm หลังหักขอบ **ไม่มีด่านตัวไหนในระบบมองเห็นสองอย่างนี้ได้เลย
// นอกจากสั่งพิมพ์จริงแล้ววัด**
//
// ไฟล์นี้มีสองชั้น:
//   1. ตรวจสตริง `@page` — เร็ว ไม่ต้องใช้เบราว์เซอร์ รันทุกที่เสมอ
//   2. พิมพ์เป็น PDF จริงแล้ววัดขนาดหน้า/จำนวนหน้า/การล้น — ต้องมี Chromium
//
// **สิ่งที่ชั้นที่ 2 ครอบไม่ได้ และไม่ได้แกล้งทำเป็นครอบ:** การที่กล่องกว้าง
// เกินพื้นที่พิมพ์ (บั๊กตัวที่สองของ #653) วัดจาก DOM ไม่ได้ — `scrollWidth -
// clientWidth` เทียบ "เนื้อกับกล่อง" แต่บั๊กคือ "กล่องกับหน้ากระดาษ" ซึ่ง
// Chromium ย่อให้พอดีเงียบๆ แทนที่จะตัด. เคยเขียน assertion ตัวนั้นไว้แล้ว
// ถอด `width: 100%` ออกก็ยังเขียว = ด่านที่ไปไม่ถึงบั๊ก จึงลบทิ้งแล้วให้
// ชั้นที่ 1 (กติกา `width` ตายตัวห้ามอยู่ใน print CSS) เป็นคนคุมข้อนี้แทน
//
// **ชั้นที่ 2 ห้ามเงียบใน CI**: ไม่มีเบราว์เซอร์ = ข้ามได้เฉพาะเครื่อง dev
// ส่วนใน CI ตั้ง `REQUIRE_PRINT_CHECKS=1` ไว้ การข้ามจะกลายเป็นการสอบตก
// (ด่านที่ skip ตัวเองเงียบๆ คือด่านที่ไม่มีใครรู้ว่ามันว่าง)
// =============================================================================

const printStyleOf = (settings: ReceiptSettings): string => {
  const html = renderToStaticMarkup(
    <ReceiptTemplate sale={SALE_1} settings={settings} domId="printable-receipt" />,
  );
  return /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
};

const sizeValueOf = (css: string): string =>
  (/@page\s*\{[^}]*?size:\s*([^;}]+)/.exec(css)?.[1] ?? '').trim();

const ITEM = { name: 'iPhone 15 Pro Max 256GB', qty: 1, price: 38900, type: 'DEVICE', code: '356789012345678' };
const SALE_1 = {
  receipt_no: 'REC-000123', sold_at: 1756900000000, cashier: 'Admin (Main Store)',
  customer_name: 'ลูกค้าตัวอย่าง', payment_method: 'CASH',
  subtotal: 38900, discount: 0, grand_total: 38900, items: [ITEM],
};
const saleWith = (n: number, extra: Record<string, unknown> = {}) => ({
  ...SALE_1,
  items: Array.from({ length: n }, (_, i) => ({ ...ITEM, name: `สินค้า ${i + 1}` })),
  ...extra,
});

/**
 * จำลองหน้าจริงที่ใบเสร็จไปอยู่: `/sales-history` ยาวหลายหน้ากระดาษ และ
 * ใบเสร็จถูกฝังลึกอยู่ในนั้น. **นี่คือรูปที่ harness เดิมมองไม่เห็น** —
 * เรนเดอร์ใบเสร็จบนหน้าเปล่าแล้วทุกอย่างดูปกติ ทั้งที่ของจริงพิมพ์ออกมา 3 หน้า
 */
const LONG_PAGE = (receipt: string) =>
  // `<style>` ก้อนนี้คือของจริงจาก SalesHistory — เป็น print CSS ของ Z-Read ที่
  // อยู่บนหน้าตลอดเวลา และสั่ง `body * { visibility: hidden }` ทับใบเสร็จด้วย
  // **นี่คือรูปที่ทำให้พิมพ์ได้ 1 หน้าว่างเปล่าและหลุดถึงมือผู้ใช้** harness ที่
  // ไม่มีสไตล์ของหน้าโฮสต์อยู่ด้วยจะเขียวทั้งที่ของจริงพัง
  `<style>@media print{body *{visibility:hidden}` +
  `.print-area,.print-area *{visibility:visible}` +
  `.print-area{position:absolute;left:0;top:0;width:80mm;margin:0;padding:0}}</style>` +
  `<div class="p-8 min-h-screen"><h1>ประวัติการขาย</h1>` +
  '<div style="height:60px;border-bottom:1px solid #ddd">แถวตาราง</div>'.repeat(40) +
  `<div style="position:fixed;inset:0"><div>${receipt}</div></div></div>`;

const A4: ReceiptSettings = { ...RECEIPT_DEFAULTS, paperSize: 'A4' };
const THERMAL: ReceiptSettings = { ...RECEIPT_DEFAULTS, paperSize: 'thermal80' };

// ---------------------------------------------------------------------------
// ชั้นที่ 1 — กติกาของ `@page` (ไม่ต้องใช้เบราว์เซอร์)
// ---------------------------------------------------------------------------
describe('print CSS ของใบเสร็จ', () => {
  // CSS `size` รับได้แค่ <length>{1,2} หรือ auto หรือชื่อกระดาษ — **ผสมกันไม่ได้**
  // ค่าที่ผสมจะถูกเบราว์เซอร์ทิ้งทั้งบรรทัดโดยไม่มี error นี่คือบั๊กเดิมเป๊ะๆ
  const LENGTH_THEN_AUTO = /(^|\s)-?[\d.]+(mm|cm|in|px|pt|pc|q)\s+auto(\s|$)/i;
  const AUTO_THEN_LENGTH = /(^|\s)auto\s+-?[\d.]+(mm|cm|in|px|pt|pc|q)(\s|$)/i;

  it.each([
    ['A4', A4],
    ['thermal80', THERMAL],
  ])('%s: ค่า size ต้องไม่ผสม <length> กับ auto', (_name, settings) => {
    const size = sizeValueOf(printStyleOf(settings));
    expect(size).not.toBe('');
    expect(size).not.toMatch(LENGTH_THEN_AUTO);
    expect(size).not.toMatch(AUTO_THEN_LENGTH);
  });

  it('A4 ใช้ชื่อกระดาษมาตรฐาน', () => {
    expect(sizeValueOf(printStyleOf(A4))).toMatch(/^A4(\s+(portrait|landscape))?$/i);
  });

  it('thermal80 ระบุสองความยาว และความกว้างเป็น 80mm', () => {
    const size = sizeValueOf(printStyleOf(THERMAL));
    const parts = size.split(/\s+/);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('80mm');
    expect(parts[1]).toMatch(/^[\d.]+(mm|cm|in)$/);
  });

  // `@page` เป็นเจ้าของขนาดกระดาษที่เดียว — ตรึงความกว้างที่กล่องซ้ำเมื่อไหร่
  // เลขจะไม่ตรงกับพื้นที่พิมพ์ที่เหลือหลังหักขอบ แล้วเนื้อล้น
  it('ความกว้างของกล่องตอนพิมพ์เป็น 100% ทั้งสองขนาดกระดาษ', () => {
    for (const settings of [A4, THERMAL]) {
      const css = printStyleOf(settings);
      const block = /#printable-receipt\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
      expect(block).toMatch(/width:\s*100%/);
      // ห้ามเป็นความยาวตายตัว (100% ผ่าน เพราะกล่องต้องเต็มพื้นที่พิมพ์ที่ @page ให้มา)
      expect(block).not.toMatch(/width:\s*[\d.]+(mm|cm|in|px|pt|pc|q)\b/i);
    }
  });

  it('ล้าง min-height ตอนพิมพ์ (ของเดิมทำให้บิลรายการเดียวล้นไปหน้า 2)', () => {
    const block = /#printable-receipt\s*\{([\s\S]*?)\}/.exec(printStyleOf(A4))?.[1] ?? '';
    expect(block).toMatch(/min-height:\s*0/);
  });

  // `visibility: hidden` ซ่อนหมึกแต่ไม่ซ่อนพื้นที่ — ของที่เหลือในหน้ายังนับ
  // เป็นความสูงของเอกสาร แล้วกลายเป็นหน้าว่างต่อท้าย
  it('ซ่อนของที่ไม่ได้พิมพ์ด้วย display:none ไม่ใช่ visibility:hidden', () => {
    // ตัดคอมเมนต์ทิ้งก่อน — กฎนี้พูดถึง declaration ไม่ใช่ข้อความที่เล่าประวัติ
    const css = printStyleOf(A4).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/display:\s*none/);
    expect(css).not.toMatch(/visibility:\s*hidden/);
  });
});

// ---------------------------------------------------------------------------
// ชั้นที่ 2 — พิมพ์เป็น PDF จริง
// ---------------------------------------------------------------------------
const REQUIRED = process.env.REQUIRE_PRINT_CHECKS === '1';
const PT_PER_MM = 72 / 25.4;
const toMm = (pt: number) => pt / PT_PER_MM;

/** Chromium ที่ playwright ติดตั้งไว้ หรือที่ image เตรียมมาให้ (เวอร์ชันไม่ตรงกันได้) */
const findChromium = (): string | undefined => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    const bin = path.join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
};

describe('พิมพ์ใบเสร็จเป็น PDF จริง', () => {
  let browser: import('playwright').Browser | undefined;
  let css = '';
  let dir = '';
  let skipReason = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'receipt-print-'));
    // คอมไพล์ Tailwind ของจริง — คลาสบนใบเสร็จต้องมีผลจริงตอนวัด
    css = (() => {
      const out = path.join(dir, 'tw.css');
      execFileSync('npx', ['tailwindcss', '-i', 'src/index.css', '-o', out, '--minify'], {
        stdio: 'pipe',
      });
      return readFileSync(out, 'utf8');
    })();

    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ executablePath: findChromium() });
    } catch (err) {
      skipReason = `เปิด Chromium ไม่ได้: ${(err as Error).message.split('\n')[0]}`;
    }

    if (!browser && REQUIRED) {
      throw new Error(
        `REQUIRE_PRINT_CHECKS=1 แต่รันด่านพิมพ์ไม่ได้ — ${skipReason}\n` +
          'ใน CI ต้องมี Chromium เสมอ (npx playwright install --with-deps chromium) ' +
          'ห้ามปล่อยให้ด่านนี้ข้ามตัวเองเงียบๆ',
      );
    }
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
  });

  const measure = async (
    sale: Record<string, unknown>,
    settings: ReceiptSettings,
    className = '',
    host: 'bare' | 'page' = 'bare',
  ) => {
    const markup = renderToStaticMarkup(
      <ReceiptTemplate sale={sale} settings={settings} domId="printable-receipt" className={className} />,
    );
    const file = path.join(dir, `${Math.random().toString(36).slice(2)}.html`);
    const body = host === 'bare' ? markup : LONG_PAGE(markup);
    writeFileSync(
      file,
      `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`,
    );

    const page = await browser!.newPage();
    await page.goto(`file://${file}`, { waitUntil: 'load' });

    // ด่านกัน "เทสเห็นด้วยกับตัวเอง": หน้าเปล่าก็นับได้ 1 หน้าเหมือนกัน
    // ถ้าใบเสร็จไม่ได้ render ทุกค่าที่วัดข้างล่างจะผ่านโดยไม่พิสูจน์อะไรเลย
    const rendered = await page.evaluate(() => {
      const el = document.getElementById('printable-receipt');
      return el
        ? { shop: el.querySelector('h2')?.textContent?.trim() ?? '', hasTotal: /TOTAL/.test(el.textContent ?? '') }
        : null;
    });

    await page.emulateMedia({ media: 'print' });
    const receiptVisibility = await page.evaluate(() => {
      const el = document.getElementById('printable-receipt');
      return el ? getComputedStyle(el).visibility : null;
    });
    const watermark = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => d.textContent?.trim() === 'VOIDED');
      return el ? getComputedStyle(el).visibility : null;
    });

    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(await page.pdf({ printBackground: true, preferCSSPageSize: true }));
    await page.close();

    return {
      rendered,
      receiptVisibility,
      watermark,
      pages: pdf.getPageCount(),
      widthMm: toMm(pdf.getPage(0).getSize().width),
    };
  };

  const printIt = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!browser) {
        console.warn(`[receiptPrint] ข้าม "${name}" — ${skipReason}`);
        return;
      }
      await fn();
    }, 60_000);

  printIt('A4 บิลรายการเดียว = หน้าเดียว กว้างเท่ากระดาษ A4', async () => {
    const r = await measure(SALE_1, A4);
    expect(r.rendered?.shop).toBe(RECEIPT_DEFAULTS.shopName);
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.pages).toBe(1);
    expect(r.widthMm).toBeCloseTo(210, 0);
  });

  printIt('A4 ยี่สิบรายการขึ้นหน้าที่สองได้จริง', async () => {
    const r = await measure(saleWith(20), A4);
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.pages).toBeGreaterThan(1);
    expect(r.widthMm).toBeCloseTo(210, 0);
  });

  printIt('กระดาษความร้อนกว้าง 80mm ไม่ใช่กระดาษเริ่มต้นของเครื่อง', async () => {
    const r = await measure(SALE_1, THERMAL);
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.widthMm).toBeCloseTo(80, 0);
    expect(r.pages).toBe(1);
  });

  printIt('กระดาษความร้อนยี่สิบรายการ ยังกว้าง 80mm และตัดหน้าได้', async () => {
    const r = await measure(saleWith(20), THERMAL);
    expect(r.widthMm).toBeCloseTo(80, 0);
    expect(r.pages).toBeGreaterThan(1);
  });

  // รูปเดียวกับบั๊กเดิม: POS เคยส่ง `min-h-[100mm]` มาทาง className ทำให้บิล
  // รายการเดียวสูงเกินเนื้อแล้วล้นไปหน้าที่ 2 — กฎ `min-height: 0` ตอนพิมพ์
  // มีไว้ล้างค่าที่ caller ส่งมา เคสนี้คือทางที่เดินไปถึงกฎนั้นจริง
  // (พิสูจน์แล้ว: ถอดกฎออก = 2 หน้า, ใส่กลับ = 1 หน้า)
  printIt('min-h ที่ caller ส่งมาต้องไม่ดันใบเสร็จไปหน้าที่ 2', async () => {
    const r = await measure(SALE_1, A4, 'min-h-[400mm]');
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.pages).toBe(1);
  });

  // บั๊กที่หลุดถึงมือผู้ใช้ (3 ก.ย. 2569): สั่งพิมพ์จาก /sales-history ได้ 3 หน้า
  // ว่างเปล่า 2 หน้า เพราะ `visibility: hidden` ซ่อนหมึกแต่ไม่ซ่อนพื้นที่ —
  // ความสูงของตารางทั้งหน้ายังนับเป็นหน้ากระดาษอยู่
  // **เคสนี้ต้องรันบนหน้าโฮสต์ยาวๆ เสมอ บนหน้าเปล่ามันเขียวทั้งที่ของจริงพัง**
  printIt('A4 ฝังในหน้ายาวหลายหน้า ต้องพิมพ์ออกมาหน้าเดียว ไม่มีหน้าว่างตาม', async () => {
    const r = await measure(SALE_1, A4, '', 'page');
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.pages).toBe(1);
    // "1 หน้า" อย่างเดียวไม่พอ — หน้าว่างก็นับได้ 1 หน้า
    expect(r.receiptVisibility).toBe('visible');
  });

  // print CSS ของหน้าโฮสต์ (Z-Read) สั่ง `body * { visibility: hidden }` ทับ
  // ใบเสร็จด้วย เราต้องดึงตัวเองกลับมาเสมอ ไม่งั้นได้ 1 หน้าว่างเปล่า
  printIt('ใบเสร็จต้องมองเห็นแม้หน้าโฮสต์จะสั่ง visibility:hidden ทับ', async () => {
    for (const settings of [A4, THERMAL]) {
      const r = await measure(SALE_1, settings, '', 'page');
      expect(r.receiptVisibility).toBe('visible');
      expect(r.rendered?.hasTotal).toBe(true);
    }
  });

  printIt('ความร้อนฝังในหน้ายาว ก็ต้องหน้าเดียวและกว้าง 80mm', async () => {
    const r = await measure(SALE_1, THERMAL, '', 'page');
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.pages).toBe(1);
    expect(r.widthMm).toBeCloseTo(80, 0);
    expect(r.receiptVisibility).toBe('visible');
  });

  printIt('บิลที่ยกเลิกต้องมีลายน้ำ VOIDED ตอนพิมพ์ ไม่ใช่แค่บนจอ', async () => {
    const r = await measure({ ...SALE_1, status: 'VOIDED' }, A4);
    expect(r.rendered?.hasTotal).toBe(true);
    expect(r.watermark).toBe('visible');
  });
});
