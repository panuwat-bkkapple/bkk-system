#!/usr/bin/env node

/**
 * BKK System — Fix Condition Sets (ตามผล audit-condition-sets 4 ส.ค. 2026)
 *
 * แก้ 3 เรื่องกับทุกชุดใน /settings/condition_sets (เจ้าของยืนยันแล้ว):
 *
 *   1. DUP_GROUP  — ชุดที่มีทั้งหัวข้อ "สภาพภายนอก" และหัวข้อบอดี้
 *                   ("สภาพตัวเครื่อง"/"บอดี้") → ลบหัวข้อ "สภาพภายนอก" ทิ้ง
 *                   (เก็บสเกลของบอดี้ที่ละเอียดกว่า — กันหักเงินซ้ำสองเด้ง)
 *                   ลบเฉพาะหัวข้อที่ชื่อตรงเป๊ะ "สภาพภายนอก" เท่านั้น
 *   2. REPAIR_50  — option "ซ่อมนอกศูนย์ / อะไหล่เทียบ (ไม่แท้)" ที่ยังไม่มีค่าหัก
 *                   → ตั้ง pct: 50 (หัก 50% ของราคาประเมิน)
 *                   ถ้ามีค่าอยู่แล้ว (pct/deduct) จะไม่ทับ — รายงานให้ดูแทน
 *   3. LOCK_REJECT — option "ติดล็อกเครือข่าย / ติดสัญญา" → ตั้ง failBehavior:
 *                   'reject' (ระบบปฏิเสธรับซื้อทันที — SellPageClient,
 *                   validateAndCreateOrder, chat-ai, rider รองรับธงนี้อยู่แล้ว)
 *
 * Default = DRY-RUN. เขียนจริง: --apply (FIREBASE_AUTH_EMAIL/PASSWORD)
 * Backup ชุดที่แตะทั้งหมดก่อนเขียน: condition-sets-fix-backup-<ts>.json
 *
 * Usage:
 *   node scripts/fix-condition-sets.cjs
 *   FIREBASE_AUTH_EMAIL=.. FIREBASE_AUTH_PASSWORD=.. node scripts/fix-condition-sets.cjs --apply
 *   node scripts/fix-condition-sets.cjs --file sets.json    # เทสจากไฟล์
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

const REPAIR_PCT = 50;
const EXTERIOR_TITLE = 'สภาพภายนอก'; // ลบเฉพาะชื่อตรงเป๊ะ
const BODY_KEYWORDS = ['ตัวเครื่อง', 'บอดี้', 'body'];
const REPAIR_LABEL_KEYWORDS = ['ซ่อมนอกศูนย์', 'อะไหล่เทียบ'];
const LOCK_LABEL_KEYWORDS = ['ติดล็อกเครือข่าย', 'ติดสัญญา'];

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

function hasValue(opt) {
  const p = Number(opt.pct);
  if (opt.pct != null && Number.isFinite(p) && p >= 0) return true;
  const d = Number(opt.deduct);
  if (opt.deduct != null && Number.isFinite(d) && d >= 0) return true;
  return false;
}

function labelOf(opt) {
  return String(opt.label || opt.name || '');
}

/** วางแผนแก้ชุดเดียว — คืน { changes, warnings, groups } (groups ใหม่ถ้ามีการแก้) */
function planSet(set) {
  const changes = [];
  const warnings = [];
  let groups = asArray(set.groups).map((g) => ({ ...g }));
  let touched = false;

  // --- 1. DUP_GROUP: ลบ "สภาพภายนอก" เมื่อมีหัวข้อบอดี้อยู่ด้วย ---
  const hasBody = groups.some((g) => {
    const t = String(g.title || '').toLowerCase();
    return BODY_KEYWORDS.some((k) => t.includes(k));
  });
  const exteriorIdx = groups.findIndex((g) => String(g.title || '').trim() === EXTERIOR_TITLE);
  if (hasBody && exteriorIdx >= 0) {
    const removed = groups[exteriorIdx];
    const optCount = asArray(removed.options).length;
    groups.splice(exteriorIdx, 1);
    changes.push(`ลบหัวข้อ "${EXTERIOR_TITLE}" (${optCount} options) — มีหัวข้อบอดี้ครอบคลุมอยู่แล้ว`);
    touched = true;
  }

  // --- 2+3. options: ซ่อมนอกศูนย์ → pct 50, ติดล็อก → reject ---
  groups = groups.map((g) => {
    const options = asArray(g.options).map((o) => ({ ...o }));
    let gTouched = false;
    for (const opt of options) {
      const label = labelOf(opt);

      if (REPAIR_LABEL_KEYWORDS.some((k) => label.includes(k))) {
        if (!hasValue(opt)) {
          opt.pct = REPAIR_PCT;
          if (opt.failBehavior === undefined || opt.failBehavior === 'pass') opt.failBehavior = 'deduct';
          changes.push(`"${label}" (${g.title || '?'}): ตั้ง pct ${REPAIR_PCT}%`);
          gTouched = true;
        } else {
          warnings.push(`"${label}" มีค่าอยู่แล้ว (pct ${opt.pct ?? '-'}, deduct ${opt.deduct ?? '-'}) — ไม่ทับ`);
        }
      }

      if (LOCK_LABEL_KEYWORDS.some((k) => label.includes(k))) {
        if (opt.failBehavior !== 'reject') {
          opt.failBehavior = 'reject';
          changes.push(`"${label}" (${g.title || '?'}): ตั้ง failBehavior reject (ปฏิเสธรับซื้อ)`);
          gTouched = true;
        }
      }
    }
    if (gTouched) {
      touched = true;
      return { ...g, options };
    }
    return g;
  });

  return { changes, warnings, groups: touched ? groups : null };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileIdx = args.indexOf('--file');
  const localFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  console.log('='.repeat(72));
  console.log(`  BKK System — Fix Condition Sets  ${apply ? '(APPLY — เขียนจริง)' : '(DRY-RUN)'}`);
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
  let totalChanges = 0;
  for (const [sid, set] of Object.entries(setsObj || {})) {
    if (!set || typeof set !== 'object') continue;
    const plan = planSet(set);
    if (plan.changes.length === 0 && plan.warnings.length === 0) continue;
    console.log('─'.repeat(72));
    console.log(`${set.name || sid}  (${sid})`);
    for (const c of plan.changes) console.log(`   ${c}`);
    for (const w of plan.warnings) console.log(`   ** ${w}`);
    if (plan.groups) {
      plans.push({ sid, set, groups: plan.groups });
      totalChanges += plan.changes.length;
    }
  }

  console.log('─'.repeat(72));
  if (plans.length === 0) {
    console.log('\nไม่มีชุดที่ต้องแก้ — จบ');
    return;
  }

  console.log(`\nรวม: จะแก้ ${plans.length} ชุด (${totalChanges} รายการ)`);

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

  const backupPath = path.resolve(`condition-sets-fix-backup-${Date.now()}.json`);
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
