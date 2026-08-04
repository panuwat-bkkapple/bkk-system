#!/usr/bin/env node

/**
 * BKK System — Catalog Audit (ตรวจสอบความถูกต้องของ /models ทั้งระบบ)
 *
 * ตรวจหาปัญหาข้อมูล catalog ที่เจอจริงมาแล้ว:
 *   1. CHIP_MISMATCH   — ชื่อรุ่นระบุชิปหนึ่ง (เช่น "ชิป M3, 2023") แต่ตัวเลือก Processor
 *                        ใน variants หรือ attributeModifiers มีชิปอื่นปน (เช่น M3 Pro / M3 Max
 *                        ทั้งที่มีรุ่นแยกของชิปนั้นอยู่แล้ว) → ราคาผิดรุ่นทุก combination
 *   2. DUP_VARIANT     — variant ซ้ำ (attributes ชุดเดียวกันหลายรายการในรุ่นเดียว)
 *                        เกิดจากแถวซ้ำใน CSV ตอน bulk upload
 *   3. DUP_MODEL_NAME  — ชื่อรุ่นซ้ำกันหลาย record (เทียบแบบ normalize ช่องว่าง)
 *   4. NAME_FORMAT     — ชื่อรุ่นมีช่องว่างนำหน้า/ต่อท้าย, ช่องว่างซ้ำ, หรือ "( ชิป"
 *   5. DUP_OPTION      — ตัวเลือกซ้ำใน attributeModifiers ของ attribute เดียวกัน
 *   6. ZERO_PRICE      — รุ่น active ที่ราคารับซื้อ (usedPrice) เป็น 0 ทุก variant
 *
 * อ่านอย่างเดียว — ไม่แก้ข้อมูลใดๆ (GET /models เป็น public read)
 *
 * Usage:
 *   node scripts/audit-catalog.cjs                  # ตรวจจาก Firebase จริง
 *   node scripts/audit-catalog.cjs --json out.json  # export ผลเป็น JSON
 *   node scripts/audit-catalog.cjs --file dump.json # ตรวจจากไฟล์ dump (สำหรับเทส)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { jsonOut: null, file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') opts.jsonOut = args[++i] || 'catalog-audit.json';
    else if (args[i] === '--file') opts.file = args[++i];
    else if (args[i] === '--help') {
      console.log('Usage: node scripts/audit-catalog.cjs [--json out.json] [--file dump.json]');
      process.exit(0);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // สะสมเป็น Buffer แล้ว decode ทีเดียว — ห้าม += chunk เป็น string
        // (ตัวอักษรไทย UTF-8 หลาย byte ที่ถูกหั่นตรงรอยต่อ chunk จะกลายเป็น U+FFFD)
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** คำในวงเล็บที่ไม่ใช่ชื่อชิป — เจอแล้วถือว่าชื่อรุ่นไม่ได้ระบุชิป ไม่ต้องเช็ค mismatch
 *  (เช่น MacBook 12" (Retina, 2015) ใช้ processor Intel Core m ซึ่งถูกต้องอยู่แล้ว) */
const NON_CHIP_TOKENS = new Set(['retina']);

/** ดึงชิป + ปี จากชื่อรุ่น เช่น "MacBook Pro 14\" (ชิป M3, 2023)" → { chip: "M3", year: 2023 } */
function chipFromName(name) {
  const m = /\((?:\s*ชิป\s*)?([^,()]+),\s*(\d{4})\s*\)/.exec(name || '');
  if (!m) return null;
  const chip = m[1].trim();
  if (NON_CHIP_TOKENS.has(chip.toLowerCase())) return null;
  return { chip, year: parseInt(m[2], 10) };
}

/** normalize ค่า processor: ตัดวงเล็บสเปก core ทิ้ง เช่น "M3 Pro (11-core CPU)" → "M3 Pro" */
function baseChip(proc) {
  return String(proc || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * เช็คว่าค่า processor เข้ากับชิปในชื่อรุ่นไหม
 * - ชื่อบอก "Intel" → ยอมรับทุกค่าที่ขึ้นต้น Intel (i3/i5/i7/i9 อยู่รุ่นเดียวกันได้)
 * - ชื่อบอกชิปเจาะจง (M3, M3 Pro, A17 Pro ฯลฯ) → ต้องตรงเป๊ะเท่านั้น
 *   ("M3" ไม่ยอมรับ "M3 Pro" — มีรุ่นแยกของ M3 Pro อยู่แล้ว)
 */
function chipMatches(nameChip, procValue) {
  const a = nameChip.toLowerCase();
  const b = baseChip(procValue).toLowerCase();
  if (!b) return true; // ค่าว่างไม่ใช่ mismatch (ไปโผล่ในเช็คอื่น)
  if (a === 'intel') return b.startsWith('intel');
  return a === b;
}

function normName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** canonical form ต่อ attribute เพื่อจับ "ป้ายต่างกันแต่ความหมายเดียวกัน"
 *  display: "Standard" == "Standard Glass", "Nano-texture" == "Nano-texture Glass"
 *  ram/storage/size: "8 GB" == "8GB"
 */
function canonValue(attrKey, raw) {
  const v = String(raw || '').trim();
  if (attrKey === 'display') {
    return v.toLowerCase().replace(/glass/g, '').replace(/[^a-z0-9ก-๙]+/g, ' ').trim();
  }
  if (['ram', 'storage', 'size'].includes(attrKey)) {
    return v.toUpperCase().replace(/\s+/g, '');
  }
  if (attrKey === 'processor') {
    return baseChip(v).toLowerCase();
  }
  return v.toLowerCase().replace(/\s+/g, ' ');
}

/** เลขรุ่นชิปจากชื่อ เช่น "M3 Pro" → 3, "Intel"/"Retina" → 0, ไม่รู้จัก → null */
function chipGen(chip) {
  if (!chip) return null;
  const c = chip.toLowerCase();
  if (c.startsWith('intel')) return 0;
  const m = /^m(\d+)/.exec(c);
  return m ? parseInt(m[1], 10) : null;
}

/** รวมค่า attribute ทั้งหมดของ model (จาก variants + attributeModifiers) แยกตาม key */
function collectAttrValues(model, variants) {
  const byKey = new Map(); // key -> Set(raw values)
  const add = (key, val) => {
    if (val === undefined || val === null || val === '') return;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(String(val));
  };
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes || {})) add(k, val);
  }
  if (model.attributeModifiers && typeof model.attributeModifiers === 'object') {
    for (const [k, group] of Object.entries(model.attributeModifiers)) {
      if (group && Array.isArray(group.options)) {
        for (const o of group.options) if (o) add(k, o.value);
      }
    }
  }
  return byKey;
}

function variantUsedPrice(v) {
  return Number(v.usedPrice ?? v.price ?? 0);
}

// ---------------------------------------------------------------------------
// Audit checks — แต่ละตัวคืน array ของ issue { code, severity, model, detail }
// ---------------------------------------------------------------------------

function auditModel(id, model) {
  const issues = [];
  const name = model.name || '';
  const variants = Array.isArray(model.variants) ? model.variants.filter(Boolean) : [];
  const push = (code, severity, detail) =>
    issues.push({ code, severity, id, name, category: model.category || '', detail });

  // 4. NAME_FORMAT
  if (name !== name.trim()) {
    push('NAME_FORMAT', 'error', `ชื่อมีช่องว่างนำหน้า/ต่อท้าย: "${name}"`);
  }
  if (/\s{2,}/.test(name)) {
    push('NAME_FORMAT', 'warning', `ชื่อมีช่องว่างซ้ำติดกัน: "${name}"`);
  }
  if (/\(\s+ชิป/.test(name)) {
    push('NAME_FORMAT', 'warning', `มีช่องว่างหลังวงเล็บเปิดก่อนคำว่า ชิป: "${name}"`);
  }

  // 1. CHIP_MISMATCH — เทียบชิปในชื่อกับ (a) variants (b) attributeModifiers.processor
  const nc = chipFromName(name);
  if (nc) {
    const badFromVariants = new Set();
    for (const v of variants) {
      const proc = v && v.attributes ? v.attributes.processor : undefined;
      if (proc !== undefined && !chipMatches(nc.chip, proc)) {
        badFromVariants.add(baseChip(proc));
      }
    }
    if (badFromVariants.size > 0) {
      push(
        'CHIP_MISMATCH',
        'error',
        `ชื่อรุ่นระบุชิป "${nc.chip}" แต่ variants มี processor อื่นปน: ${[...badFromVariants].join(', ')}`
      );
    }

    const procMods = model.attributeModifiers && model.attributeModifiers.processor;
    if (procMods && Array.isArray(procMods.options)) {
      const badOpts = procMods.options
        .map((o) => o && o.value)
        .filter((val) => val && !chipMatches(nc.chip, val))
        .map(baseChip);
      if (badOpts.length > 0) {
        push(
          'CHIP_MISMATCH',
          'error',
          `ชื่อรุ่นระบุชิป "${nc.chip}" แต่ตัวเลือก Processor ในโหมด Modifier มี: ${[...new Set(badOpts)].join(', ')} ` +
            `(ทุก combination ของชิปพวกนี้ถูก generate เป็น variant ราคาผิดรุ่น)`
      );
      }
    }
  }

  // 2. DUP_VARIANT — attributes ชุดเดียวกันซ้ำ
  const seen = new Map();
  for (const v of variants) {
    const attrs = v.attributes || {};
    const key = Object.keys(attrs)
      .sort()
      .map((k) => `${k}=${String(attrs[k]).trim().toLowerCase()}`)
      .join('|');
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, c]) => c > 1);
  if (dups.length > 0) {
    const sample = dups.slice(0, 3).map(([k, c]) => `${k} (x${c})`).join('; ');
    push('DUP_VARIANT', 'error', `variant ซ้ำ ${dups.length} ชุด เช่น ${sample}`);
  }

  // 5. DUP_OPTION — ตัวเลือกซ้ำใน attributeModifiers
  if (model.attributeModifiers && typeof model.attributeModifiers === 'object') {
    for (const [attrKey, group] of Object.entries(model.attributeModifiers)) {
      if (!group || !Array.isArray(group.options)) continue;
      const counts = new Map();
      for (const o of group.options) {
        if (!o || !o.value) continue;
        const k = String(o.value).trim().toLowerCase();
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const dupOpts = [...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k);
      if (dupOpts.length > 0) {
        push('DUP_OPTION', 'error', `ตัวเลือกซ้ำใน attribute "${attrKey}": ${dupOpts.join(', ')}`);
      }
    }
  }

  // 7. NEAR_DUP_OPTION — ป้ายต่างกันแต่ความหมายเดียวกัน (จาก variants + modifiers)
  //    processor: flag เฉพาะเมื่อมีค่า "เปล่า" (ไม่ระบุ core) ชนกับค่าที่ระบุ core —
  //    สอง config ที่ระบุ core ต่างกัน (เช่น 15-core vs 18-core) เป็นตัวเลือกจริง ไม่ flag
  const attrValues = collectAttrValues(model, variants);
  for (const [attrKey, rawSet] of attrValues) {
    const groupsByCanon = new Map();
    for (const raw of rawSet) {
      const c = canonValue(attrKey, raw);
      if (!c) continue;
      if (!groupsByCanon.has(c)) groupsByCanon.set(c, []);
      groupsByCanon.get(c).push(raw);
    }
    for (const [, raws] of groupsByCanon) {
      if (raws.length < 2) continue;
      if (attrKey === 'processor') {
        const hasBare = raws.some((r) => !/\(/.test(r));
        if (!hasBare) continue;
      }
      push(
        'NEAR_DUP_OPTION',
        'error',
        `attribute "${attrKey}" มีตัวเลือกความหมายเดียวกันหลายป้าย: ${raws.map((r) => `"${r}"`).join(' กับ ')} ` +
          `(ลูกค้าเห็นเป็นคนละตัวเลือก — ควรยุบเหลือป้ายเดียว)`
      );
    }
  }

  // 8. NANO_OLD — Nano-texture มีจริงเฉพาะ Mac ตระกูล M4 ขึ้นไป (MacBook Pro/iMac ปี 2024+)
  //    รุ่นชิป Intel/M1/M2/M3 ไม่เคยมีตัวเลือกนี้
  const displayRaws = attrValues.get('display');
  if (displayRaws && nc) {
    const gen = chipGen(nc.chip);
    if (gen !== null && gen < 4) {
      const nano = [...displayRaws].filter((r) => canonValue('display', r).includes('nano'));
      if (nano.length > 0) {
        push(
          'NANO_OLD',
          'error',
          `มีตัวเลือกจอ ${nano.map((r) => `"${r}"`).join(', ')} แต่ชิปในชื่อรุ่นคือ "${nc.chip}" — ` +
            `Nano-texture เริ่มมีตั้งแต่ตระกูล M4 (2024) เท่านั้น`
        );
      }
    }
  }

  // 6. ZERO_PRICE — รุ่น active แต่ราคารับซื้อเป็น 0 ทั้งหมด
  if (model.isActive !== false && variants.length > 0) {
    const allZero = variants.every((v) => variantUsedPrice(v) <= 0);
    if (allZero) {
      push('ZERO_PRICE', 'warning', `รุ่น active แต่ราคารับซื้อ (usedPrice) เป็น 0 ทุก variant (${variants.length} ตัวเลือก)`);
    }
  }

  return issues;
}

function auditCatalog(modelsObj) {
  const entries = Object.entries(modelsObj || {}).filter(
    ([, m]) => m && typeof m === 'object'
  );

  let issues = [];
  for (const [id, model] of entries) {
    issues = issues.concat(auditModel(id, model));
  }

  // 3. DUP_MODEL_NAME — ชื่อซ้ำข้าม record (normalize ช่องว่าง + case)
  const byName = new Map();
  for (const [id, model] of entries) {
    const key = normName(model.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ id, raw: model.name, category: model.category || '' });
  }
  for (const [, group] of byName) {
    if (group.length > 1) {
      issues.push({
        code: 'DUP_MODEL_NAME',
        severity: 'error',
        id: group.map((g) => g.id).join(', '),
        name: group[0].raw,
        category: group[0].category,
        detail:
          `ชื่อรุ่นเดียวกันมี ${group.length} record: ` +
          group.map((g) => `${g.id} ("${g.raw}")`).join(' | '),
      });
    }
  }

  return { modelCount: entries.length, issues };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const CODE_LABEL = {
  CHIP_MISMATCH: 'ชิปในตัวเลือกไม่ตรงชื่อรุ่น',
  NANO_OLD: 'Nano-texture บนรุ่นที่ไม่มีจริง (ก่อน M4)',
  NEAR_DUP_OPTION: 'ตัวเลือกความหมายเดียวกันหลายป้าย',
  DUP_VARIANT: 'variant ซ้ำในรุ่นเดียว',
  DUP_MODEL_NAME: 'ชื่อรุ่นซ้ำหลาย record',
  NAME_FORMAT: 'รูปแบบชื่อรุ่นผิดปกติ',
  DUP_OPTION: 'ตัวเลือกซ้ำใน attribute',
  ZERO_PRICE: 'ราคารับซื้อเป็น 0',
};

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(72));
  console.log('  BKK System — Catalog Audit');
  console.log('='.repeat(72));

  let models;
  if (opts.file) {
    console.log(`Source: ${opts.file} (local file)`);
    models = JSON.parse(fs.readFileSync(path.resolve(opts.file), 'utf-8'));
  } else {
    console.log(`Source: ${FIREBASE_DATABASE_URL}/models.json`);
    models = await fetchJSON(`${FIREBASE_DATABASE_URL}/models.json`);
  }

  const { modelCount, issues } = auditCatalog(models);

  const byCode = new Map();
  for (const iss of issues) {
    if (!byCode.has(iss.code)) byCode.set(iss.code, []);
    byCode.get(iss.code).push(iss);
  }

  console.log(`\nตรวจทั้งหมด ${modelCount} รุ่น — พบปัญหา ${issues.length} รายการ\n`);

  const order = ['CHIP_MISMATCH', 'NANO_OLD', 'NEAR_DUP_OPTION', 'DUP_MODEL_NAME', 'DUP_VARIANT', 'DUP_OPTION', 'NAME_FORMAT', 'ZERO_PRICE'];
  for (const code of order) {
    const list = byCode.get(code);
    if (!list || list.length === 0) continue;
    console.log('─'.repeat(72));
    console.log(`  [${code}] ${CODE_LABEL[code]} — ${list.length} รายการ`);
    console.log('─'.repeat(72));
    for (const iss of list) {
      const sev = iss.severity === 'error' ? '!!' : ' *';
      console.log(` ${sev} ${iss.name}  (${iss.id})`);
      console.log(`      ${iss.detail}`);
    }
    console.log();
  }

  if (issues.length === 0) {
    console.log('ไม่พบปัญหา — catalog สะอาด');
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  console.log('='.repeat(72));
  console.log(`  สรุป: ${errors} errors, ${warnings} warnings จาก ${modelCount} รุ่น`);
  console.log('='.repeat(72));

  if (opts.jsonOut) {
    fs.writeFileSync(path.resolve(opts.jsonOut), JSON.stringify({ modelCount, issues }, null, 2));
    console.log(`\nJSON report: ${path.resolve(opts.jsonOut)}`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
