#!/usr/bin/env node

/**
 * BKK System — Delete Orphan Condition Sets (ลบชุดประเมิน orphan 7 ตัว)
 *
 * ตามผล audit 4 ส.ค. 2026: ชุดเหล่านี้ไม่มีรุ่นไหนใช้ (ค้างจากการแตกชุด
 * รายรุ่น) และ 5 ตัวเป็นแฝดชื่อซ้ำกับชุดจริงที่ใช้งานอยู่ — เจ้าของสั่งลบ
 *
 * ความปลอดภัย:
 *   - ลบเฉพาะ id ที่ระบุ + ชื่อใน DB ต้องตรงกับที่คาด (expectName)
 *   - เช็คสดตอนรันว่าไม่มี model ไหนชี้ conditionSetId มาที่ชุดนี้ —
 *     ถ้ามีคนเพิ่งผูกไปใช้ = ข้าม ไม่ลบ
 *   - Backup ชุดเต็มก่อนลบ: orphan-sets-backup-<ts>.json (กู้คืนได้)
 *
 * หมายเหตุ: ชุดแม่แบบ "มาตรฐานการตรวจ ... (Full Option)" / *_standard_set
 * ตั้งใจเก็บไว้เป็นต้นแบบ ไม่อยู่ในรายการลบ
 *
 * Default = DRY-RUN. ลบจริง: --apply (FIREBASE_AUTH_EMAIL/PASSWORD)
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

// รายการลบ — id + ชื่อที่ต้องตรงใน DB (จากผล audit 4 ส.ค. 2026)
const TARGETS = [
  { id: '-OxJGxB9lYF18ldsGEGY', expectName: 'iPhone 13' },
  { id: '-OxaU5LRLUVjuIGCuVyg', expectName: 'iPhone 11' },
  { id: '-Oxdq8kqfN-6oP0f-fl6', expectName: 'iPhone 17 Pro Max' },
  { id: '-OxhrtUkNv-LvWl2ZGMd', expectName: 'iPhone 16 Pro Max' },
  { id: '-OyNPhxYun8uqupzpNCv', expectName: 'iPhone 14 Pro Max' },
  { id: '-OwfvqtlHDRBff6jgnOb', expectName: 'MacBook Air M1' },
  { id: '-OyH1Ff98kh-td6vq6gV', expectName: 'ชุดประเมินใหม่' },
];

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

async function main() {
  const apply = process.argv.includes('--apply');

  console.log('='.repeat(72));
  console.log(`  BKK System — Delete Orphan Condition Sets  ${apply ? '(APPLY — ลบจริง)' : '(DRY-RUN)'}`);
  console.log('='.repeat(72));
  console.log(`Source: ${DB_URL}\n`);

  const [setsObj, modelsObj] = await Promise.all([
    httpJSON('GET', `${DB_URL}/settings/condition_sets.json`),
    httpJSON('GET', `${DB_URL}/models.json`),
  ]);

  // นับการใช้งานสดจาก /models
  const usage = new Map();
  for (const [mid, m] of Object.entries(modelsObj || {})) {
    if (!m || typeof m !== 'object' || !m.conditionSetId) continue;
    if (!usage.has(m.conditionSetId)) usage.set(m.conditionSetId, []);
    usage.get(m.conditionSetId).push(m.name || mid);
  }

  const toDelete = [];
  for (const t of TARGETS) {
    const set = setsObj ? setsObj[t.id] : null;
    console.log('─'.repeat(72));
    if (!set) {
      console.log(`?? ${t.expectName} (${t.id}) — ไม่พบใน DB (อาจถูกลบไปแล้ว) — ข้าม`);
      continue;
    }
    const name = String(set.name || '').trim();
    if (name !== t.expectName) {
      console.log(`!! ${t.id} — ชื่อใน DB ("${name}") ไม่ตรงกับที่คาด ("${t.expectName}") — ข้ามเพื่อความปลอดภัย`);
      continue;
    }
    const users = usage.get(t.id) || [];
    if (users.length > 0) {
      console.log(`!! ${name} (${t.id}) — มีรุ่นใช้อยู่ ${users.length} รุ่น (${users.slice(0, 3).join(', ')}) — ไม่ลบ`);
      continue;
    }
    const groupCount = Array.isArray(set.groups) ? set.groups.length : Object.keys(set.groups || {}).length;
    console.log(`ลบ: ${name} (${t.id}) — ${groupCount} หัวข้อ, 0 รุ่นใช้`);
    toDelete.push({ id: t.id, name, set });
  }

  console.log('─'.repeat(72));
  if (toDelete.length === 0) {
    console.log('\nไม่มีชุดที่จะลบ — จบ');
    return;
  }
  console.log(`\nรวม: จะลบ ${toDelete.length} ชุด`);

  if (!apply) {
    console.log('DRY-RUN: ตรวจรายการแล้วรันซ้ำด้วย --apply เพื่อลบจริง');
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

  const backupPath = path.resolve(`orphan-sets-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(Object.fromEntries(toDelete.map((d) => [d.id, d.set])), null, 2));
  console.log(`Backup ชุดเต็มก่อนลบ: ${backupPath} (กู้คืนได้ถ้าจำเป็น)`);

  for (const d of toDelete) {
    await httpJSON('DELETE', `${DB_URL}/settings/condition_sets/${encodeURIComponent(d.id)}.json?auth=${token}`);
    console.log(`ลบแล้ว: ${d.name} (${d.id})`);
  }

  console.log(`\nเสร็จ — ลบ ${toDelete.length} ชุด. รัน node scripts/audit-condition-sets.cjs เพื่อยืนยัน`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
