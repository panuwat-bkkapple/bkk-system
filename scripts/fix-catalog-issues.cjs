#!/usr/bin/env node

/**
 * BKK System — Fix Catalog Issues (batch 2: ยุบป้ายตัวเลือกซ้ำความหมายเดียวกัน)
 *
 * batch 1 (ลบชิปผิดรุ่น + แก้ชื่อ) apply ไปแล้ว 4 ส.ค. 2026 — script นี้เป็นรอบใหม่
 * แก้ NEAR_DUP_OPTION 5 รายการจาก audit-catalog.cjs:
 *
 *   MacBook Pro 14" (M4, 2024)      display: "Nano-Texture" → "Nano-texture Glass"
 *   MacBook Pro 14" (M3, 2023)      display: "Standard" → "Standard Glass"
 *   MacBook Pro 16" (M3 Pro, 2023)  display: "Standard" → "Standard Glass"
 *   MacBook Pro 16" (M3 Pro, 2023)  processor: "M3 Pro (12-core CPU, 18-core GPU)" → "M3 Pro"
 *                                   (16" M3 Pro มี config เดียวจริง ใช้ป้ายสั้น)
 *   Mac mini (M4 Pro, 2024)         processor: "M4 Pro" → "M4 Pro (12-core CPU, 16-core GPU)"
 *                                   (ยุบป้ายเปล่าเข้า config เริ่มต้น; 12 vs 14-core เป็นคนละ config เก็บทั้งคู่)
 *
 * วิธี merge ต่อรุ่น:
 *   1. เปลี่ยนค่า attribute ใน variants ตาม map แล้ว dedupe combination ที่ชนกัน
 *      (เก็บตัวที่ราคา > 0; ถ้าราคาต่างกันทั้งคู่ เก็บตัวที่ป้ายเป็น canonical อยู่แล้ว
 *      และรายงานให้เห็นใน dry-run)
 *   2. attributeModifiers: ถ้ามีทั้งป้ายเก่า+canonical → ลบป้ายเก่า, มีแต่ป้ายเก่า → เปลี่ยนชื่อ
 *
 * Default = DRY-RUN. เขียนจริง: --apply (ต้องมี FIREBASE_AUTH_EMAIL/PASSWORD)
 * Backup ก่อนเขียนเสมอ: catalog-fix-backup-<ts>.json
 *
 * Usage:
 *   node scripts/fix-catalog-issues.cjs
 *   FIREBASE_AUTH_EMAIL=.. FIREBASE_AUTH_PASSWORD=.. node scripts/fix-catalog-issues.cjs --apply
 *   node scripts/fix-catalog-issues.cjs --file dump.json      # เทสจากไฟล์
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// .env + config
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
// รายการ merge — expectName เป็น guard ก่อนแตะทุกรุ่น
// mergeValues: { attrKey: { ป้ายเก่า: ป้ายcanonical } }
// ---------------------------------------------------------------------------

const FIXES = [
  {
    id: '-MGg8Y0P_VOPgeXk7AmdC',
    expectName: /MacBook Pro 14" \(ชิป M4, 2024\)/,
    mergeValues: { display: { 'Nano-Texture': 'Nano-texture Glass' } },
  },
  {
    id: '-Sb92cvfub_ZZd7I0klcc',
    expectName: /MacBook Pro 14" \(ชิป M3, 2023\)/,
    mergeValues: { display: { 'Standard': 'Standard Glass' } },
  },
  {
    id: '-qnR-XlPA95qudSrxLXdu',
    expectName: /MacBook Pro 16" \(ชิป M3 Pro, 2023\)/,
    mergeValues: {
      display: { 'Standard': 'Standard Glass' },
      processor: { 'M3 Pro (12-core CPU, 18-core GPU)': 'M3 Pro' },
    },
  },
  {
    id: '-mhUqkREll65AwaWata_c',
    expectName: /Mac mini \(ชิป M4 Pro, 2024\)/,
    mergeValues: { processor: { 'M4 Pro': 'M4 Pro (12-core CPU, 16-core GPU)' } },
  },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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
  if (!API_KEY) throw new Error('ไม่พบ FIREBASE_API_KEY / VITE_FIREBASE_API_KEY (ต้องมีใน .env ตอน --apply)');
  const res = await httpJSON(
    'POST',
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email, password, returnSecureToken: true }
  );
  return res.idToken;
}

// ---------------------------------------------------------------------------
// Merge planner (pure)
// ---------------------------------------------------------------------------

function variantList(variants) {
  if (Array.isArray(variants)) return variants.filter(Boolean);
  if (variants && typeof variants === 'object') return Object.values(variants).filter(Boolean);
  return [];
}

function usedPriceOf(v) {
  return Number(v.usedPrice ?? v.price ?? 0);
}

function comboKey(attrs) {
  return Object.keys(attrs || {})
    .sort()
    .map((k) => `${k}=${String(attrs[k]).trim().toLowerCase()}`)
    .join('|');
}

function variantLabel(v) {
  const a = v.attributes || {};
  return [a.processor, a.ram, a.storage, a.display].filter(Boolean).join(' | ') || v.name || v.id || '?';
}

function planFix(fix, model) {
  const changes = [];
  const warnings = [];
  const updates = {};

  if (!fix.expectName.test(model.name || '')) {
    return { error: `ชื่อใน DB ("${model.name}") ไม่ตรงกับที่คาด (${fix.expectName}) — ข้ามเพื่อความปลอดภัย` };
  }

  // --- 1. variants: rename ค่า attribute ตาม map ---
  const vlist = variantList(model.variants).map((v) => ({ ...v, attributes: { ...(v.attributes || {}) } }));
  let renamed = 0;
  const renamedFlag = new WeakSet(); // variant ที่ถูก rename (ป้ายเดิมไม่ใช่ canonical)
  for (const v of vlist) {
    for (const [attrKey, map] of Object.entries(fix.mergeValues)) {
      const cur = v.attributes[attrKey];
      if (cur != null && Object.prototype.hasOwnProperty.call(map, String(cur).trim())) {
        v.attributes[attrKey] = map[String(cur).trim()];
        // sync ชื่อ variant ที่ประกอบจากค่า attribute
        if (typeof v.name === 'string' && v.name.includes(String(cur).trim())) {
          v.name = v.name.replace(String(cur).trim(), map[String(cur).trim()]);
        }
        renamed++;
        renamedFlag.add(v);
      }
    }
  }

  // --- 2. dedupe combination ที่ชนกันหลัง rename ---
  const byCombo = new Map();
  for (const v of vlist) {
    const k = comboKey(v.attributes);
    if (!byCombo.has(k)) byCombo.set(k, []);
    byCombo.get(k).push(v);
  }
  const kept = [];
  let dropped = 0;
  for (const [, group] of byCombo) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    // เลือกตัวที่เก็บ: (1) ราคา > 0 ก่อน (2) ตัวที่ป้ายเป็น canonical อยู่แล้ว (ไม่ถูก rename)
    const sorted = [...group].sort((a, b) => {
      const pa = usedPriceOf(a) > 0 ? 1 : 0;
      const pb = usedPriceOf(b) > 0 ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ca = renamedFlag.has(a) ? 0 : 1;
      const cb = renamedFlag.has(b) ? 0 : 1;
      return cb - ca;
    });
    const winner = sorted[0];
    kept.push(winner);
    for (const loser of sorted.slice(1)) {
      dropped++;
      const pw = usedPriceOf(winner);
      const pl = usedPriceOf(loser);
      if (pl > 0 && pl !== pw) {
        warnings.push(
          `ราคาขัดแย้งที่ ${variantLabel(winner)}: เก็บ ${pw.toLocaleString()} ทิ้ง ${pl.toLocaleString()} — ตรวจราคาหลัง apply ด้วย`
        );
      }
    }
  }

  if (renamed > 0 || dropped > 0) {
    updates['variants'] = kept;
    changes.push(`variants: เปลี่ยนป้าย ${renamed} รายการ, ยุบ combination ซ้ำ ${dropped} รายการ (เหลือ ${kept.length})`);
  }

  // --- 3. attributeModifiers: ลบ/เปลี่ยนชื่อป้ายเก่า ---
  const mods = model.attributeModifiers || {};
  for (const [attrKey, map] of Object.entries(fix.mergeValues)) {
    const group = mods[attrKey];
    if (!group || !Array.isArray(group.options)) continue;
    let opts = group.options.filter(Boolean).map((o) => ({ ...o }));
    let touched = false;
    for (const [oldVal, canonical] of Object.entries(map)) {
      const oldIdx = opts.findIndex((o) => String(o.value).trim() === oldVal);
      if (oldIdx < 0) continue;
      const canonIdx = opts.findIndex((o) => String(o.value).trim() === canonical);
      if (canonIdx >= 0) {
        const oldOpt = opts[oldIdx];
        const canonOpt = opts[canonIdx];
        if ((oldOpt.usedPriceMod || 0) !== (canonOpt.usedPriceMod || 0)) {
          warnings.push(
            `modifier "${attrKey}": ป้าย "${oldVal}" (mod ${oldOpt.usedPriceMod || 0}) ถูกลบ, เก็บ "${canonical}" (mod ${canonOpt.usedPriceMod || 0})`
          );
        }
        opts.splice(oldIdx, 1);
        changes.push(`modifier "${attrKey}": ลบตัวเลือก "${oldVal}" (มี "${canonical}" อยู่แล้ว)`);
      } else {
        opts[oldIdx].value = canonical;
        changes.push(`modifier "${attrKey}": เปลี่ยนป้าย "${oldVal}" → "${canonical}"`);
      }
      touched = true;
    }
    if (touched) updates[`attributeModifiers/${attrKey}/options`] = opts;
  }

  if (Object.keys(updates).length > 0) updates['updatedAt'] = Date.now();
  return { changes, warnings, updates };
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
  console.log(`  BKK System — Fix Catalog Issues (batch 2: merge ป้ายตัวเลือก)  ${apply ? '(APPLY)' : '(DRY-RUN)'}`);
  console.log('='.repeat(72));

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

  const plans = [];
  for (const fix of FIXES) {
    const model = models[fix.id];
    console.log('─'.repeat(72));
    if (!model) {
      console.log(`?? ${fix.id} — ไม่พบใน DB — ข้าม`);
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
    for (const w of plan.warnings) console.log(`   ** ${w}`);
    plans.push({ fix, model, updates: plan.updates });
  }

  console.log('─'.repeat(72));
  if (plans.length === 0) {
    console.log('\nไม่มีรุ่นที่ต้องแก้ — จบ');
    return;
  }

  if (!apply) {
    console.log(`\nDRY-RUN: จะแก้ ${plans.length} รุ่น — ตรวจรายการ (โดยเฉพาะบรรทัด **) แล้วรันซ้ำด้วย --apply`);
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

  const backupPath = path.resolve(`catalog-fix-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(Object.fromEntries(plans.map((p) => [p.fix.id, p.model])), null, 2));
  console.log(`Backup ข้อมูลเดิม: ${backupPath}`);

  for (const p of plans) {
    await httpJSON('PATCH', `${DB_URL}/models/${encodeURIComponent(p.fix.id)}.json?auth=${token}`, p.updates);
    console.log(`เขียนแล้ว: ${p.model.name} (${p.fix.id})`);
  }

  console.log(`\nเสร็จ — แก้ ${plans.length} รุ่น. รัน node scripts/audit-catalog.cjs เพื่อยืนยันอีกครั้ง`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
