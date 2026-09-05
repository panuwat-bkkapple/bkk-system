// ด่านของหน้า Rider Statement — อ่านอย่างเดียว "โดยโครงสร้าง" ไม่ใช่โดยวินัย
//
// สามไฟล์ของหน้านี้ (page · view · util) ต้องไม่มีเมธอดเขียน RTDB แม้แต่ตัวเดียว, ไม่เรียก
// callable, ไม่ import โมดูลที่เขียน ledger/สถานะงาน, และ firebase/database ที่ import ได้
// มีแค่ชุดอ่าน. view กับ util ห้าม import firebase เลย (view ต้อง SSR ได้ใน harness)
//
// เทสนี้ grep ไฟล์จริง และพิสูจน์ก่อนว่า regex ของตัวเองจับได้จริงด้วยตัวอย่างที่ควรแดง —
// ด่านที่ไม่ได้ทดสอบว่าจับอะไรได้ คือด่านที่ไม่รู้ว่าตัวเองว่าง (รูปเดียวกับ
// riderWalletAuditReadOnly.test.ts)
//
// ผลข้างเคียงที่ตั้งใจ: โค้ดในสามไฟล์นี้ต่อท้ายอาร์เรย์ด้วย `list[list.length] = x` แทน `.push(`
// เพราะ regex แยก Array.push กับ Reference.push ไม่ได้ และการผ่อน regex ให้แยกคือการเปิดช่อง
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = {
  page: resolve(__dirname, '../pages/fleet/RiderStatementPage.tsx'),
  view: resolve(__dirname, '../pages/fleet/RiderStatementView.tsx'),
  util: resolve(__dirname, './riderStatement.ts'),
  mirror: resolve(__dirname, './riderWalletLedger.ts'),
};
const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')])) as Record<keyof typeof FILES, string>;

const WRITE_CALL = /\.(set|update|push|remove|transaction|setWithPriority|setPriority|runTransaction)\s*\(/;
/** modular API ของ firebase/database เรียกเป็นฟังก์ชันเปล่า (`update(ref(...), ...)`) ไม่มีจุดข้างหน้า */
const BARE_WRITE_CALL = /(^|[^.\w])(set|update|remove|runTransaction)\s*\(/;
const isWrite = (line: string) => WRITE_CALL.test(line) || BARE_WRITE_CALL.test(line);
const CALLABLE = /httpsCallable|getFunctions|runJobTransition|confirmPayoutTransfer/;
/** โมดูลในรีโปนี้ที่เขียน ledger / สถานะงาน / เงิน — ห้ามโผล่ใน import ของหน้านี้ */
const FORBIDDEN_IMPORT = /from\s+['"][^'"]*(transactionLogger|riderSettlement|runJobTransition|confirmPayoutTransfer|jobActivityLog|payoutTransfer|riderCostSplit|uploadImage|financeGate|useFinanceGate)['"]/;
const FIREBASE_DB_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]firebase\/database['"]/;
const READ_ONLY_DB_API = new Set(['ref', 'get', 'query', 'orderByChild', 'equalTo', 'limitToFirst', 'limitToLast', 'startAt', 'endAt', 'onValue', 'child']);

const importsOf = (s: string) => [...s.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0]);
const codeLines = (s: string) =>
  s
    .split('\n')
    .map((line, i) => ({ line: line.replace(/\/\/.*$/, ''), n: i + 1 }))
    .filter(({ line }) => !/^\s*(\*|\/\*)/.test(line));

describe('regex ของด่านจับได้จริง (injection ของด่านเอง)', () => {
  it('เมธอดเขียน', () => {
    for (const bad of ["update(ref(db, 'jobs/x'), {})", 'await set(r, 1)', "db.ref('t').push()", 'r.remove()', 'lockRef.transaction(fn)', 'a.set (b)', 'runTransaction(r, fn)']) {
      expect(isWrite(bad), bad).toBe(true);
    }
    for (const ok of ["get(ref(db, 'x'))", 'new Set([1])', 'seen.add(id)', 'list[list.length] = x', 'setLoading(true)', 'setArchived((p) => p)', 'const s = useState(0)']) {
      expect(isWrite(ok), ok).toBe(false);
    }
  });
  it('import ต้องห้าม + callable', () => {
    expect(FORBIDDEN_IMPORT.test("import { logTransaction } from '../../utils/transactionLogger';")).toBe(true);
    expect(FORBIDDEN_IMPORT.test("import { buildRiderFeeApproval } from './riderSettlement';")).toBe(true);
    expect(FORBIDDEN_IMPORT.test("import { buildStatement } from '../../utils/riderStatement';")).toBe(false);
    expect(CALLABLE.test("const fn = httpsCallable(getFunctions(app), 'transitionJob');")).toBe(true);
  });
  it('รายชื่อที่ import จาก firebase/database ถูกอ่านออกมาได้', () => {
    const m = "import { ref, get, query, orderByChild, equalTo } from 'firebase/database';".match(FIREBASE_DB_IMPORT);
    expect(m![1].split(',').map((x) => x.trim())).toEqual(['ref', 'get', 'query', 'orderByChild', 'equalTo']);
  });
});

describe('สามไฟล์ของหน้า statement ไม่มีทางเขียนอะไรเลย', () => {
  it.each(Object.keys(FILES) as (keyof typeof FILES)[])('%s: ไม่มีเมธอดเขียน RTDB / callable / update(...) เปล่า', (k) => {
    const offenders = codeLines(src[k]).filter(({ line }) => isWrite(line) || CALLABLE.test(line));
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it.each(Object.keys(FILES) as (keyof typeof FILES)[])('%s: ไม่ import โมดูลที่เขียน ledger/สถานะ/เงิน', (k) => {
    const bad = importsOf(src[k]).filter((imp) => FORBIDDEN_IMPORT.test(imp) || /firebase\/functions|firebase\/storage/.test(imp));
    expect(bad).toEqual([]);
  });

  it('page: firebase/database ที่ import มีแต่ชุดอ่าน', () => {
    const m = src.page.match(FIREBASE_DB_IMPORT);
    expect(m, 'page ต้อง import firebase/database เพื่ออ่าน ledger').toBeTruthy();
    const names = m![1].split(',').map((x) => x.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(READ_ONLY_DB_API.has(n), `${n} ไม่ใช่ API อ่าน`).toBe(true);
  });

  it('view / util / mirror: ไม่ import firebase หรือ hooks ที่ต่อ DB เลย (SSR ได้)', () => {
    for (const k of ['view', 'util', 'mirror'] as const) {
      const bad = importsOf(src[k]).filter((imp) => /firebase|api\/firebase|hooks\/useDatabase|hooks\/useAuth/.test(imp));
      expect(bad, k).toEqual([]);
    }
  });

  it('util คิดยอดผ่าน mirror เท่านั้น — ไม่มีสูตร balance ของตัวเอง', () => {
    expect(src.util).toMatch(/from '\.\/riderWalletLedger'/);
    // ห้ามมี reduce ที่บวก/ลบ amount ตาม type เอง (นั่นคือ walletBalance ตัวที่สอง)
    const own = codeLines(src.util).filter(({ line }) => /type === 'CREDIT' \? .*\+ .*amount/.test(line) && !/signed/.test(line));
    expect(own, JSON.stringify(own)).toEqual([]);
  });

  it('WITHDRAWAL ไม่แสดง description ดิบ — util ไม่ส่ง description ออกไปในแถวเลย', () => {
    // description ถูกอ่านเพื่ออนุมานป้ายผู้เขียนเท่านั้น ห้ามถูก assign เข้าฟิลด์ของแถวที่ view วาด
    const leaks = codeLines(src.util).filter(({ line }) => /detail\s*[:=].*description|source\s*[:=].*description|description\s*:\s*t\.description/.test(line));
    expect(leaks).toEqual([]);
    expect(src.view).not.toMatch(/\.description/);
  });
});
