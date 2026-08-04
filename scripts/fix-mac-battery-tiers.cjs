#!/usr/bin/env node

/**
 * BKK System — Migrate Mac battery bands (รอบชาร์จ → รอบชาร์จ หรือ แบต%)
 *
 * นโยบายเจ้าของร้าน ส.ค. 2026: เกณฑ์แบต Mac เดิมดูแค่ Cycle Count ทำให้เครื่อง
 * รอบชาร์จน้อยแต่แบตเสื่อม (เช่น 100 กว่ารอบ / 81%) ไม่มีข้อให้หักหน้างาน
 * → เปลี่ยนเป็น 4 ระดับ เกณฑ์คู่ "รอบชาร์จ หรือ แบต%" หัก 0/5/10/15%:
 *
 *   1. แบตปกติ (รอบชาร์จไม่เกิน 300 และแบต 90% ขึ้นไป)         หัก 0
 *   2. รอบชาร์จเกิน 300 หรือแบต 85-89%                          หัก 5%
 *   3. รอบชาร์จเกิน 400 หรือแบต 80-84%                          หัก 10%
 *   4. รอบชาร์จเกิน 500 หรือแบตต่ำกว่า 80% หรือ Service Recommended  หัก 15%
 *
 * เป้าหมาย: ทุกชุดใน /settings/condition_sets ที่มี group "สุขภาพแบตเตอรี่"
 * แบบอิงรอบชาร์จ (มี option ที่ label มีคำว่า "รอบชาร์จ") — ชุด Intel แบบ
 * Normal/เสื่อม 2 ตัวเลือกไม่ถูกแตะ. idempotent: ชุดที่ migrate แล้ว
 * (มี label "85-89") จะถูกข้าม
 *
 * seed template ในโค้ด (assessmentSeedTemplates.ts MAC_BATTERY_GROUP) ถูกแก้
 * เป็นเกณฑ์เดียวกันแล้ว — ชุดที่สร้างใหม่จากแม่แบบจะได้เกณฑ์นี้อัตโนมัติ
 *
 * Default = DRY-RUN. เขียนจริง: --apply (FIREBASE_AUTH_EMAIL/PASSWORD)
 * Backup: mac-battery-fix-backup-<ts>.json
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

const GROUP_TITLE = 'สุขภาพแบตเตอรี่';
const MIGRATED_MARK = '85-89'; // มีใน label ระดับ 2 = ชุดนี้ migrate แล้ว

const NEW_DESCRIPTION =
  'ดูสถานะแบต + ความจุสูงสุด (Maximum Capacity) จาก การตั้งค่า > แบตเตอรี่ และ Cycle Count ใน System Report — ถ้าเข้าเกณฑ์หลายระดับ เลือกระดับที่แย่กว่า';
const NEW_DESCRIPTION_EN =
  'Check battery status and maximum capacity in Settings > Battery, plus the cycle count in System Report — if more than one band applies, pick the worse one';

const NEW_OPTIONS = [
  {
    id: 'batt_cyc_t1',
    label: 'แบตปกติ (รอบชาร์จไม่เกิน 300 และแบต 90% ขึ้นไป)',
    label_en: 'Battery normal (up to 300 cycles and 90-100% health)',
    description: 'สถานะ Normal, Cycle Count ไม่เกิน 300 และความจุสูงสุด 90-100%',
    description_en: 'Status Normal, cycle count up to 300, maximum capacity 90-100%',
    deduct: 0,
  },
  {
    id: 'batt_cyc_t2',
    label: 'รอบชาร์จเกิน 300 หรือแบต 85-89%',
    label_en: 'Over 300 cycles or 85-89% battery health',
    description: 'Cycle Count 301-400 หรือความจุสูงสุด 85-89%',
    description_en: 'Cycle count 301-400 or maximum capacity 85-89%',
    pct: 5,
    failBehavior: 'deduct',
  },
  {
    id: 'batt_cyc_t3',
    label: 'รอบชาร์จเกิน 400 หรือแบต 80-84%',
    label_en: 'Over 400 cycles or 80-84% battery health',
    description: 'Cycle Count 401-500 หรือความจุสูงสุด 80-84%',
    description_en: 'Cycle count 401-500 or maximum capacity 80-84%',
    pct: 10,
    failBehavior: 'deduct',
  },
  {
    id: 'batt_cyc_t4',
    label: 'รอบชาร์จเกิน 500 หรือแบตต่ำกว่า 80% หรือขึ้น Service Recommended',
    label_en: 'Over 500 cycles, below 80% health, or Service Recommended',
    description: 'Cycle Count เกิน 500, ความจุสูงสุดต่ำกว่า 80% หรือขึ้นสถานะ Service Recommended (เข้าเกณฑ์เปลี่ยนแบต)',
    description_en: 'Cycle count over 500, maximum capacity below 80%, or shows Service Recommended (battery replacement due)',
    pct: 15,
    failBehavior: 'deduct',
  },
];

function httpJSON(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
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

/** วางแผนแก้ชุดเดียว — คืน groups ใหม่ถ้ามีการแก้, null ถ้าไม่แตะ */
function planSet(set) {
  const groups = asArray(set.groups);
  let touched = false;
  const changes = [];

  const next = groups.map((g) => {
    if (String(g.title || '').trim() !== GROUP_TITLE) return g;
    const options = asArray(g.options);
    const labels = options.map((o) => String(o.label || o.name || ''));
    const isCycleStyle = labels.some((l) => l.includes('รอบชาร์จ'));
    if (!isCycleStyle) return g; // Intel-style (Normal/เสื่อม) — ไม่แตะ
    if (labels.some((l) => l.includes(MIGRATED_MARK))) return g; // migrate แล้ว

    touched = true;
    changes.push(
      `แทนที่ ${options.length} ตัวเลือกเดิม (${labels.join(' | ')}) ด้วยเกณฑ์คู่ 4 ระดับ (0/5/10/15%)`
    );
    return {
      ...g,
      description: NEW_DESCRIPTION,
      description_en: NEW_DESCRIPTION_EN,
      options: NEW_OPTIONS.map((o) => ({ ...o })),
    };
  });

  return touched ? { groups: next, changes } : null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileIdx = args.indexOf('--file');
  const localFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  console.log('='.repeat(72));
  console.log(`  BKK System — Mac Battery Bands Migration  ${apply ? '(APPLY — เขียนจริง)' : '(DRY-RUN)'}`);
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
    console.log('\nไม่มีชุดที่ต้อง migrate — จบ');
    return;
  }
  console.log(`\nรวม: จะแก้ ${plans.length} ชุด`);

  if (!apply) {
    console.log('DRY-RUN: ตรวจรายการแล้วรันซ้ำด้วย --apply เพื่อเขียนจริง');
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

  const backupPath = path.resolve(`mac-battery-fix-backup-${Date.now()}.json`);
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

  console.log(`\nเสร็จ — migrate ${plans.length} ชุด. รัน node scripts/audit-condition-sets.cjs เพื่อยืนยัน`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
