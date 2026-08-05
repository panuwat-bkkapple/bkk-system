#!/usr/bin/env node

/**
 * BKK System — Repair Mojibake (ซ่อมตัวอักษรไทยที่เพี้ยนเป็น U+FFFD "�")
 *
 * สาเหตุ: สคริปต์ fix รุ่นก่อนหน้าอ่าน HTTP response แบบต่อ chunk เป็น string
 * ทีละก้อน — ตัวอักษรไทย (UTF-8 3 bytes) ที่ถูกหั่นพอดีตรงรอยต่อ chunk กลายเป็น
 * U+FFFD แล้วถูกเขียนกลับเข้า DB ตอน --apply (ตัวอ่านแก้แล้วทุกสคริปต์)
 *
 * ขอบเขต: สแกน /settings/condition_sets + /models (สอง node เดียวที่สคริปต์
 * เคยเขียน) หา string ที่มี U+FFFD แล้วกู้ค่าที่ถูกต้องโดย match กับคลังข้อความ:
 *   (a) string เดียวกันจากชุด/รุ่นอื่นที่ไม่เพี้ยน (ชุดถูก clone รายรุ่น —
 *       ข้อความเดิมมีสำเนาดีอยู่หลายสิบชุด)
 *   (b) string literal จาก seed templates ในโค้ด (assessmentSeedTemplates.ts,
 *       assessmentEnSeed.ts, generationTemplates.ts)
 * เงื่อนไข match: แทนช่วง "�" ต่อเนื่องด้วยตัวอักษร 1-2 ตัว แล้วต้องตรงทั้ง
 * string และได้คำตอบเดียวเท่านั้น — กำกวม/ไม่เจอ = รายงานให้แก้มือ ไม่เดา
 *
 * Default = DRY-RUN. เขียนจริง: --apply (FIREBASE_AUTH_EMAIL/PASSWORD)
 * Backup ค่าเดิมทุก path ที่แก้: mojibake-repair-backup-<ts>.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

(function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
})();

const DB_URL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';
const API_KEY = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '';

const BAD = '�';

function httpJSON(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`${method} ${u.pathname}: HTTP ${res.statusCode} — ${JSON.stringify(parsed).slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function signIn(email, password) {
  if (!API_KEY) throw new Error('ไม่พบ FIREBASE_API_KEY / VITE_FIREBASE_API_KEY');
  const res = await httpJSON(
    'POST',
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email, password, returnSecureToken: true }
  );
  return res.idToken;
}

// ---------------------------------------------------------------------------
// เดินต้นไม้เก็บ string ทุกตัวพร้อม path
// ---------------------------------------------------------------------------

function walkStrings(node, prefix, out) {
  if (typeof node === 'string') {
    out.push({ path: prefix, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => v != null && walkStrings(v, `${prefix}/${i}`, out));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (v != null) walkStrings(v, `${prefix}/${k}`, out);
    }
  }
}

// ---------------------------------------------------------------------------
// คลังข้อความอ้างอิงจาก source code (string literal ภาษาไทยใน seed templates)
// ---------------------------------------------------------------------------

function corpusFromSources() {
  const files = [
    '../src/features/trade-in/utils/assessmentSeedTemplates.ts',
    '../src/features/trade-in/utils/assessmentEnSeed.ts',
    '../src/features/trade-in/utils/generationTemplates.ts',
  ];
  const out = new Set();
  for (const rel of files) {
    const p = path.resolve(__dirname, rel);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf-8');
    for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
      const s = m[1].replace(/\\'/g, "'");
      if (s.length >= 2 && /[฀-๿]/.test(s)) out.add(s);
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** หา candidate เดียวจาก corpus ที่ตรงกับ string เพี้ยน (� ต่อเนื่อง = 1-2 ตัวอักษร) */
function resolveCorrupted(value, corpus) {
  const parts = value.split(/�+/);
  const re = new RegExp('^' + parts.map(escapeRe).join('.{1,2}') + '$');
  const hits = new Set();
  for (const c of corpus) {
    if (re.test(c)) hits.add(c);
  }
  return { candidates: [...hits] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const filesIdx = args.indexOf('--files'); // เทส: --files sets.json models.json
  let setsObj, modelsObj;

  console.log('='.repeat(72));
  console.log(`  BKK System — Repair Mojibake (U+FFFD)  ${apply ? '(APPLY — เขียนจริง)' : '(DRY-RUN)'}`);
  console.log('='.repeat(72));

  if (filesIdx >= 0) {
    setsObj = JSON.parse(fs.readFileSync(path.resolve(args[filesIdx + 1]), 'utf-8'));
    modelsObj = JSON.parse(fs.readFileSync(path.resolve(args[filesIdx + 2]), 'utf-8'));
    console.log('Source: local files (test mode)');
  } else {
    console.log(`Source: ${DB_URL} (/settings/condition_sets + /models)`);
    [setsObj, modelsObj] = await Promise.all([
      httpJSON('GET', `${DB_URL}/settings/condition_sets.json`),
      httpJSON('GET', `${DB_URL}/models.json`),
    ]);
  }

  // 1. เก็บ string ทั้งหมด
  const all = [];
  walkStrings(setsObj || {}, 'settings/condition_sets', all);
  walkStrings(modelsObj || {}, 'models', all);

  const corrupted = all.filter((e) => e.value.includes(BAD));
  console.log(`\nสแกน ${all.length.toLocaleString()} strings — พบเพี้ยน (มี "${BAD}") ${corrupted.length} จุด\n`);

  if (corrupted.length === 0) {
    console.log('ไม่พบตัวอักษรเพี้ยน — จบ');
    return;
  }

  // 2. คลังข้อความ: จากข้อมูลจริงที่ไม่เพี้ยน + จาก source code
  const corpus = new Set();
  for (const e of all) {
    if (!e.value.includes(BAD) && e.value.length >= 2) corpus.add(e.value);
  }
  for (const s of corpusFromSources()) corpus.add(s);
  console.log(`คลังข้อความอ้างอิง: ${corpus.size.toLocaleString()} strings (ข้อมูลจริงที่ดี + seed templates ในโค้ด)\n`);

  // 3. จับคู่
  const fixes = [];
  const manual = [];
  for (const e of corrupted) {
    const { candidates } = resolveCorrupted(e.value, corpus);
    if (candidates.length === 1) {
      fixes.push({ path: e.path, old: e.value, fixed: candidates[0] });
    } else {
      manual.push({ path: e.path, old: e.value, candidates });
    }
  }

  console.log('─'.repeat(72));
  console.log(`  ซ่อมอัตโนมัติได้ ${fixes.length} จุด`);
  console.log('─'.repeat(72));
  for (const f of fixes) {
    console.log(` ${f.path}`);
    console.log(`   "${f.old}"`);
    console.log(`   → "${f.fixed}"`);
  }

  if (manual.length > 0) {
    console.log('─'.repeat(72));
    console.log(`  !! ต้องแก้มือ ${manual.length} จุด (ไม่เจอ/กำกวม — ไม่เดา)`);
    console.log('─'.repeat(72));
    for (const m of manual) {
      console.log(` ${m.path}`);
      console.log(`   "${m.old}"`);
      if (m.candidates.length > 1) console.log(`   กำกวม: ${m.candidates.map((c) => `"${c}"`).join(' | ')}`);
    }
  }

  if (fixes.length === 0) {
    console.log('\nไม่มีจุดที่ซ่อมอัตโนมัติได้ — จบ');
    return;
  }

  if (!apply) {
    console.log(`\nDRY-RUN: จะซ่อม ${fixes.length} จุด${manual.length ? ` (แก้มืออีก ${manual.length})` : ''} — ตรวจแล้วรันซ้ำด้วย --apply`);
    return;
  }

  const email = process.env.FIREBASE_AUTH_EMAIL || '';
  const password = process.env.FIREBASE_AUTH_PASSWORD || '';
  if (!email || !password) {
    console.error('\n--apply ต้องตั้ง FIREBASE_AUTH_EMAIL และ FIREBASE_AUTH_PASSWORD');
    process.exit(1);
  }
  console.log('\nAuthenticating...');
  const token = await signIn(email, password);

  const backupPath = path.resolve(`mojibake-repair-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(fixes, null, 2));
  console.log(`Backup รายการแก้: ${backupPath}`);

  // PATCH ทีละ batch (multi-path update ที่ root)
  const BATCH = 200;
  for (let i = 0; i < fixes.length; i += BATCH) {
    const body = {};
    for (const f of fixes.slice(i, i + BATCH)) body[f.path] = f.fixed;
    await httpJSON('PATCH', `${DB_URL}/.json?auth=${token}`, body);
    console.log(`   เขียนแล้ว ${Math.min(i + BATCH, fixes.length)}/${fixes.length} จุด`);
  }

  console.log(`\nเสร็จ — ซ่อม ${fixes.length} จุด${manual.length ? `, เหลือแก้มือ ${manual.length} จุด (ดูรายการด้านบน)` : ''}`);
  console.log('รันซ้ำอีกครั้งเพื่อยืนยันว่าไม่เหลือ "�" (ควรขึ้น "ไม่พบตัวอักษรเพี้ยน")');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
