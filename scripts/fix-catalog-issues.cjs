#!/usr/bin/env node

/**
 * BKK System — Fix Catalog Issues (แก้ปัญหาที่ audit-catalog.cjs ตรวจพบ ส.ค. 2026)
 *
 * รายการแก้ (hardcode เจาะจง id — มี guard เช็คชื่อรุ่นก่อนแก้ทุกตัว):
 *   1. MacBook Pro 14" (ชิป M3, 2023)   — ลบ variants/ตัวเลือกที่เป็น M3 Pro / M3 Max
 *      และ RAM ที่มีเฉพาะบน Pro/Max (18/36/48/64/96/128GB)
 *   2. MacBook Pro 16" (ชิป M3 Pro, 2023) — ลบ variants/ตัวเลือกที่เป็น M3 Max
 *      และ RAM ที่มีเฉพาะบน Max (48/64/96/128GB)
 *   3-4. iPad Air 11"/13" (ชิป M4, 2026) — ตัดช่องว่างหน้าชื่อ
 *   5. MacBook Neo 13" ( ชิป A18 Pro, 2026) — แก้ "( ชิป" เป็น "(ชิป"
 *
 * ค่า default = DRY-RUN (โชว์ว่าจะแก้อะไร ไม่เขียนจริง) — เขียนจริงต้องใส่ --apply
 * ก่อนเขียนจะ backup ข้อมูลเดิมของทุกรุ่นที่แตะลงไฟล์ catalog-fix-backup-<ts>.json
 *
 * Usage:
 *   node scripts/fix-catalog-issues.cjs                      # dry-run (ไม่ต้อง login)
 *   FIREBASE_AUTH_EMAIL=you@x.com FIREBASE_AUTH_PASSWORD=xx \
 *     node scripts/fix-catalog-issues.cjs --apply            # เขียนจริง
 *
 * ต้องมี VITE_FIREBASE_API_KEY ใน .env ของ repo (หรือ env FIREBASE_API_KEY)
 * เฉพาะตอน --apply เท่านั้น
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// .env + config (pattern เดียวกับ bulk-upload-mac-products.cjs)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// รายการแก้ — expectName เป็น guard: ชื่อใน DB ต้อง match ก่อนถึงจะแตะ
// ---------------------------------------------------------------------------

const FIXES = [
  {
    id: '-Sb92cvfub_ZZd7I0klcc',
    expectName: /MacBook Pro 14" \(ชิป M3, 2023\)/,
    keepProcessors: ['M3'],
    removeRam: ['18GB', '36GB', '48GB', '64GB', '96GB', '128GB'],
  },
  {
    id: '-qnR-XlPA95qudSrxLXdu',
    expectName: /MacBook Pro 16" \(ชิป M3 Pro, 2023\)/,
    keepProcessors: ['M3 Pro'],
    removeRam: ['48GB', '64GB', '96GB', '128GB'],
  },
  {
    id: '-OolySgIjc4w0cuQ8XhO',
    expectName: /iPad Air 11" \(ชิป M4, 2026\)/,
    normalizeName: true,
  },
  {
    id: '-Oom3bOtFuoSUxs-tU4a',
    expectName: /iPad Air 13" \(ชิป M4, 2026\)/,
    normalizeName: true,
  },
  {
    id: '-OomKn99jQCop-1SXRh8',
    expectName: /MacBook Neo 13"/,
    normalizeName: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpJSON(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...headers } },
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
  if (!API_KEY) throw new Error('ไม่พบ FIREBASE_API_KEY / VITE_FIREBASE_API_KEY (ต้องมีใน .env ตอน --apply)');
  const res = await httpJSON(
    'POST',
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email, password, returnSecureToken: true }
  );
  return res.idToken;
}

/** ตัดวงเล็บสเปก core: "M3 Pro (11-core CPU)" → "M3 Pro" */
function baseChip(p) {
  return String(p || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

function normalizeName(name) {
  return String(name).replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();
}

/** variants เก็บได้ทั้ง array และ object (Firebase แปลง array เป็น object ได้) */
function variantEntries(variants) {
  if (Array.isArray(variants)) return variants.map((v, i) => [String(i), v]).filter(([, v]) => v);
  if (variants && typeof variants === 'object') return Object.entries(variants).filter(([, v]) => v);
  return [];
}

function variantLabel(v) {
  const a = v.attributes || {};
  return [a.processor, a.ram, a.storage, a.display].filter(Boolean).join(' | ') || v.name || v.id || '?';
}

// ---------------------------------------------------------------------------
// วางแผนการแก้ของรุ่นเดียว — pure function คืน { changes, updates }
// ---------------------------------------------------------------------------

function planFix(fix, model) {
  const changes = [];
  const updates = {}; // path ใต้ models/{id} → ค่าใหม่

  if (!fix.expectName.test(model.name || '')) {
    return { error: `ชื่อใน DB ("${model.name}") ไม่ตรงกับที่คาด (${fix.expectName}) — ข้ามเพื่อความปลอดภัย` };
  }

  // --- แก้ชื่อ ---
  if (fix.normalizeName) {
    const fixed = normalizeName(model.name);
    if (fixed !== model.name) {
      updates['name'] = fixed;
      changes.push(`ชื่อ: "${model.name}" → "${fixed}"`);
    }
  }

  // --- ลบ variants ผิดรุ่น ---
  if (fix.keepProcessors) {
    const keep = new Set(fix.keepProcessors.map((s) => s.toLowerCase()));
    const removeRam = new Set((fix.removeRam || []).map((s) => s.toLowerCase()));
    const entries = variantEntries(model.variants);
    const kept = [];
    const removed = [];

    for (const [, v] of entries) {
      const a = v.attributes || {};
      const proc = baseChip(a.processor).toLowerCase();
      const ram = String(a.ram || '').trim().toLowerCase();
      const badProc = a.processor !== undefined && proc !== '' && !keep.has(proc);
      const badRam = removeRam.has(ram);
      if (badProc || badRam) removed.push(variantLabel(v));
      else kept.push(v);
    }

    if (removed.length > 0) {
      if (kept.length === 0) {
        return { error: `การลบจะทำให้ variants ว่างเปล่าทั้งรุ่น (ลบ ${removed.length} ตัว) — ผิดปกติ ข้าม` };
      }
      updates['variants'] = kept; // เขียนกลับเป็น array เสมอ
      changes.push(`variants: ลบ ${removed.length} / เหลือ ${kept.length}`);
      for (const r of removed) changes.push(`  - ลบ variant: ${r}`);
    }

    // --- ลบตัวเลือกใน attributeModifiers (processor + ram) ถ้ามี ---
    const mods = model.attributeModifiers || {};
    if (mods.processor && Array.isArray(mods.processor.options)) {
      const keptOpts = mods.processor.options.filter((o) => o && keep.has(baseChip(o.value).toLowerCase()));
      const removedOpts = mods.processor.options.filter((o) => o && !keep.has(baseChip(o.value).toLowerCase()));
      if (removedOpts.length > 0 && keptOpts.length > 0) {
        updates['attributeModifiers/processor/options'] = keptOpts;
        changes.push(`ตัวเลือก processor: ลบ ${removedOpts.map((o) => o.value).join(', ')}`);
      }
    }
    if (mods.ram && Array.isArray(mods.ram.options)) {
      const keptOpts = mods.ram.options.filter((o) => o && !removeRam.has(String(o.value).trim().toLowerCase()));
      const removedOpts = mods.ram.options.filter((o) => o && removeRam.has(String(o.value).trim().toLowerCase()));
      if (removedOpts.length > 0 && keptOpts.length > 0) {
        updates['attributeModifiers/ram/options'] = keptOpts;
        changes.push(`ตัวเลือก ram: ลบ ${removedOpts.map((o) => o.value).join(', ')}`);
      }
    }
  }

  if (Object.keys(updates).length > 0) updates['updatedAt'] = Date.now();
  return { changes, updates };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileIdx = args.indexOf('--file');
  const localFile = fileIdx >= 0 ? args[fileIdx + 1] : null;

  console.log('='.repeat(72));
  console.log(`  BKK System — Fix Catalog Issues  ${apply ? '(APPLY — เขียนจริง)' : '(DRY-RUN — ไม่เขียน)'}`);
  console.log('='.repeat(72));

  // 1. โหลดข้อมูลรุ่นที่จะแก้ (read เป็น public)
  const models = {};
  if (localFile) {
    const all = JSON.parse(fs.readFileSync(path.resolve(localFile), 'utf-8'));
    for (const f of FIXES) models[f.id] = all[f.id] || null;
    console.log(`Source: ${localFile} (local file)\n`);
  } else {
    console.log(`Source: ${DB_URL}\n`);
    for (const f of FIXES) {
      models[f.id] = await httpJSON('GET', `${DB_URL}/models/${encodeURIComponent(f.id)}.json`);
    }
  }

  // 2. วางแผน
  const plans = [];
  for (const fix of FIXES) {
    const model = models[fix.id];
    console.log('─'.repeat(72));
    if (!model) {
      console.log(`?? ${fix.id} — ไม่พบใน DB (อาจถูกลบ/แก้ไปแล้ว) — ข้าม`);
      continue;
    }
    console.log(`${model.name}  (${fix.id})`);
    const plan = planFix(fix, model);
    if (plan.error) {
      console.log(`   !! ${plan.error}`);
      continue;
    }
    if (plan.changes.length === 0) {
      console.log('   ไม่มีอะไรต้องแก้ (สะอาดแล้ว)');
      continue;
    }
    for (const c of plan.changes) console.log(`   ${c}`);
    plans.push({ fix, model, updates: plan.updates });
  }

  console.log('─'.repeat(72));
  if (plans.length === 0) {
    console.log('\nไม่มีรุ่นที่ต้องแก้ — จบ');
    return;
  }

  if (!apply) {
    console.log(`\nDRY-RUN: จะแก้ ${plans.length} รุ่น — ตรวจรายการด้านบนแล้วรันซ้ำด้วย --apply เพื่อเขียนจริง`);
    return;
  }

  // 3. Auth
  const email = process.env.FIREBASE_AUTH_EMAIL || '';
  const password = process.env.FIREBASE_AUTH_PASSWORD || '';
  if (!email || !password) {
    console.error('\n--apply ต้องตั้ง FIREBASE_AUTH_EMAIL และ FIREBASE_AUTH_PASSWORD (บัญชีแอดมิน)');
    process.exit(1);
  }
  console.log('\nAuthenticating...');
  const token = await signIn(email, password);

  // 4. Backup ของเดิมก่อนเขียน
  const backupPath = path.resolve(`catalog-fix-backup-${Date.now()}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(Object.fromEntries(plans.map((p) => [p.fix.id, p.model])), null, 2)
  );
  console.log(`Backup ข้อมูลเดิม: ${backupPath}`);

  // 5. เขียนทีละรุ่น (PATCH เฉพาะ field ที่เปลี่ยน)
  for (const p of plans) {
    const body = {};
    for (const [k, v] of Object.entries(p.updates)) body[k] = v;
    await httpJSON('PATCH', `${DB_URL}/models/${encodeURIComponent(p.fix.id)}.json?auth=${token}`, body);
    console.log(`เขียนแล้ว: ${p.model.name} (${p.fix.id})`);
  }

  console.log(`\nเสร็จ — แก้ ${plans.length} รุ่น. รัน node scripts/audit-catalog.cjs เพื่อยืนยันอีกครั้ง`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
