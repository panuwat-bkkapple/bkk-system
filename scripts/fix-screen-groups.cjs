#!/usr/bin/env node

/**
 * BKK System — Unify screen groups (ยุบหัวข้อธีมจอเหลือ "สภาพจอภาพและกระจก")
 *
 * ตามผล audit GROUP_DUP_THEME: หลายชุดมีหัวข้อจอซ้อนกันสองชื่อ
 * ("สภาพหน้าจอและกระจก" / "สภาพหน้าจอ" ปนกับ "สภาพจอภาพและกระจก")
 * เจ้าของเคาะ 4 ส.ค. 2026: ใช้ "สภาพจอภาพและกระจก" เป็นชื่อเดียวทั้งระบบ
 *
 * ต่อชุด:
 *   - มีทั้งหัวข้อ canonical และหัวข้อชื่อเก่า → ลบหัวข้อชื่อเก่าทิ้ง
 *     (เก็บ options/ราคาของฝั่ง canonical — log ของที่ถูกลบให้ตรวจได้)
 *   - มีแต่หัวข้อชื่อเก่า → เปลี่ยนชื่อเป็น canonical (+ title_en)
 *   - หัวข้ออื่นที่มีคำว่า "จอ" แต่ชื่อไม่ตรงเป๊ะ (เช่น "การแสดงผลของหน้าจอ"
 *     ที่เป็นเช็คการทำงาน) ไม่ถูกแตะ
 *
 * seed template ในโค้ด (assessmentSeedTemplates.ts) แก้เป็นชื่อ canonical แล้ว
 *
 * Default = DRY-RUN. เขียนจริง: --apply (FIREBASE_AUTH_EMAIL/PASSWORD)
 * Backup: screen-groups-fix-backup-<ts>.json
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

const CANON = 'สภาพจอภาพและกระจก';
const CANON_EN = 'Screen & Glass Condition';
const OLD_TITLES = ['สภาพหน้าจอและกระจก', 'สภาพหน้าจอ']; // เทียบตรงเป๊ะเท่านั้น

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

function asArray(x) {
  if (Array.isArray(x)) return x.filter(Boolean);
  if (x && typeof x === 'object') return Object.values(x).filter(Boolean);
  return [];
}

function optSummary(g) {
  return asArray(g.options)
    .map((o) => {
      const v = o.pct != null ? `${o.pct}%` : o.deduct != null ? `${o.deduct}฿` : o.failBehavior || '-';
      return `${o.label || o.name || '?'} (${v})`;
    })
    .join('; ');
}

function planSet(set) {
  const changes = [];
  let groups = asArray(set.groups).map((g) => ({ ...g }));
  let touched = false;

  const titleOf = (g) => String(g.title || '').trim();
  const hasCanon = groups.some((g) => titleOf(g) === CANON);
  const oldGroups = groups.filter((g) => OLD_TITLES.includes(titleOf(g)));
  if (oldGroups.length === 0) return null;

  if (hasCanon) {
    // ลบหัวข้อชื่อเก่าทั้งหมด — เก็บฝั่ง canonical
    for (const og of oldGroups) {
      changes.push(`ลบหัวข้อ "${titleOf(og)}" — options ที่หายไป: ${optSummary(og)}`);
    }
    groups = groups.filter((g) => !OLD_TITLES.includes(titleOf(g)));
    touched = true;
  } else {
    // ไม่มี canonical: เปลี่ยนชื่อหัวข้อเก่าตัวแรกเป็น canonical, ตัวเกิน (ถ้ามี) ลบ
    let renamed = false;
    groups = groups
      .map((g) => {
        if (!OLD_TITLES.includes(titleOf(g))) return g;
        if (!renamed) {
          renamed = true;
          touched = true;
          changes.push(`เปลี่ยนชื่อหัวข้อ "${titleOf(g)}" → "${CANON}"`);
          const next = { ...g, title: CANON };
          if (g.title_en !== undefined) next.title_en = CANON_EN;
          return next;
        }
        changes.push(`ลบหัวข้อซ้ำ "${titleOf(g)}" — options ที่หายไป: ${optSummary(g)}`);
        touched = true;
        return null;
      })
      .filter(Boolean);
  }

  return touched ? { changes, groups } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileIdx = args.indexOf('--file');
  const localFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  console.log('='.repeat(72));
  console.log(`  BKK System — Unify Screen Groups → "${CANON}"  ${apply ? '(APPLY)' : '(DRY-RUN)'}`);
  console.log('='.repeat(72));

  let setsObj;
  if (localFile) {
    console.log(`Source: ${localFile} (local file)`);
    setsObj = JSON.parse(fs.readFileSync(path.resolve(localFile), 'utf-8'));
  } else {
    console.log(`Source: ${DB_URL}/settings/condition_sets`);
    setsObj = await httpJSON('GET', `${DB_URL}/settings/condition_sets.json`);
  }

  const plans = [];
  for (const [sid, set] of Object.entries(setsObj || {})) {
    if (!set || typeof set !== 'object') continue;
    const plan = planSet(set);
    if (!plan) continue;
    console.log('─'.repeat(72));
    console.log(`${set.name || sid}  (${sid})`);
    for (const c of plan.changes) console.log(`   ${c}`);
    plans.push({ sid, set, groups: plan.groups });
  }

  console.log('─'.repeat(72));
  if (plans.length === 0) {
    console.log('\nไม่มีชุดที่ต้องแก้ — จบ');
    return;
  }
  console.log(`\nรวม: จะแก้ ${plans.length} ชุด`);

  if (!apply) {
    console.log('DRY-RUN: ตรวจรายการ (โดยเฉพาะ options ที่จะหายไปตอนลบหัวข้อซ้ำ) แล้วรันซ้ำด้วย --apply');
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

  const backupPath = path.resolve(`screen-groups-fix-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(Object.fromEntries(plans.map((p) => [p.sid, p.set])), null, 2));
  console.log(`Backup ข้อมูลเดิม: ${backupPath}`);

  let done = 0;
  for (const p of plans) {
    await httpJSON(
      'PUT',
      `${DB_URL}/settings/condition_sets/${encodeURIComponent(p.sid)}/groups.json?auth=${token}`,
      p.groups
    );
    done++;
    if (done % 20 === 0 || done === plans.length) console.log(`   เขียนแล้ว ${done}/${plans.length} ชุด`);
  }

  console.log(`\nเสร็จ — แก้ ${plans.length} ชุด. รัน node scripts/audit-condition-sets.cjs เพื่อยืนยัน`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
