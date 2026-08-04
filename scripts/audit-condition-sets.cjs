#!/usr/bin/env node

/**
 * BKK System — Condition Sets Audit (ตรวจชุดเงื่อนไขประเมินสภาพทั้งระบบ)
 *
 * ตรวจ /settings/condition_sets เทียบกับ /models (อ่านอย่างเดียว, public read):
 *
 *   MISSING_SET    (error)   — model ชี้ conditionSetId ที่ไม่มีอยู่จริง
 *                              → ลูกค้า/แอดมินประเมินสภาพรุ่นนั้นไม่ได้
 *   NO_SET         (warning) — รุ่น active ที่ไม่ได้ผูกชุดประเมินเลย
 *   DUP_OPTION_ID  (error)   — option id ซ้ำภายในชุดเดียว (การเลือก match ด้วย id
 *                              → ซ้ำ = หักเงินซ้ำ/เพี้ยน)
 *   NO_OPTION_ID   (error)   — option ไม่มี id (เลือกไม่ได้ resolver ข้ามตลอด)
 *   BAD_PCT        (error)   — pct ติดลบ / เกิน 100 / ไม่ใช่ตัวเลข
 *   BAD_DEDUCT     (error)   — deduct ติดลบ / ไม่ใช่ตัวเลข
 *   NO_VALUE       (warning) — option ไม่มีทั้ง pct / deduct / t1-t3 (หักได้ 0 เสมอ
 *                              — ถ้าตั้งใจให้ "ไม่หัก" ควรใส่ deduct: 0 ให้ชัด)
 *   LEGACY_TIERS   (warning) — option ยังพึ่ง t1/t2/t3 (ยังไม่ migrate เป็น deduct/pct)
 *   SHARED_SET     (warning) — ชุดเดียวถูกใช้ ≥2 รุ่น (ขัดแนวทาง 1 ชุดต่อ 1 รุ่น —
 *                              แตกได้ด้วยปุ่ม "แตกชุดรายรุ่น" ใน Engine)
 *   ORPHAN_SET     (warning) — ชุดที่ไม่มีรุ่นไหนใช้ (ค้างจากการ split — ลบได้)
 *   EMPTY_SET      (warning) — ชุดที่ไม่มี group/option เลย
 *   DUP_SET_NAME   (warning) — ชุดชื่อซ้ำกันหลายชุด (สับสนตอนเลือกใน dropdown)
 *
 * Usage:
 *   node scripts/audit-condition-sets.cjs
 *   node scripts/audit-condition-sets.cjs --json out.json
 *   node scripts/audit-condition-sets.cjs --sets sets.json --models models.json  # เทสจากไฟล์
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_URL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { jsonOut: null, setsFile: null, modelsFile: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--json') o.jsonOut = a[++i] || 'condition-sets-audit.json';
    else if (a[i] === '--sets') o.setsFile = a[++i];
    else if (a[i] === '--models') o.modelsFile = a[++i];
    else if (a[i] === '--help') {
      console.log('Usage: node scripts/audit-condition-sets.cjs [--json out.json] [--sets sets.json --models models.json]');
      process.exit(0);
    }
  }
  return o;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // Buffer.concat แล้ว decode ทีเดียว — กัน UTF-8 หั่นกลาง char เป็น U+FFFD
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Helpers — โครง option ตาม src/utils/pricingResolver.ts
// ---------------------------------------------------------------------------

function asArray(x) {
  if (Array.isArray(x)) return x.filter(Boolean);
  if (x && typeof x === 'object') return Object.values(x).filter(Boolean);
  return [];
}

function hasFinite(v) {
  return v != null && Number.isFinite(Number(v));
}

function optionLabel(opt) {
  return opt.label || opt.name || opt.id || '?';
}

/** ธีมของ group จากคีย์เวิร์ดในชื่อ — สอง group ธีมเดียวกันในชุดเดียว = ถามซ้ำ/หักซ้ำ */
const GROUP_THEMES = [
  { theme: 'สภาพภายนอก/บอดี้', keywords: ['ภายนอก', 'ตัวเครื่อง', 'บอดี้', 'body', 'exterior'] },
  { theme: 'หน้าจอ', keywords: ['จอ', 'screen', 'display'] },
  { theme: 'แบตเตอรี่', keywords: ['แบต', 'battery'] },
  { theme: 'การทำงาน', keywords: ['การทำงาน', 'ฟังก์ชัน', 'ฟังก์ชั่น', 'function'] },
  { theme: 'ประวัติการซ่อม', keywords: ['ซ่อม', 'repair'] },
  { theme: 'อุปกรณ์/กล่อง', keywords: ['อุปกรณ์', 'กล่อง', 'accessor'] },
];

function groupTheme(title) {
  const t = String(title || '').toLowerCase();
  for (const { theme, keywords } of GROUP_THEMES) {
    if (keywords.some((k) => t.includes(k))) return theme;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

function audit(setsObj, modelsObj) {
  const issues = [];
  const push = (code, severity, where, detail) => issues.push({ code, severity, where, detail });

  const sets = Object.entries(setsObj || {}).filter(([, s]) => s && typeof s === 'object');
  const models = Object.entries(modelsObj || {}).filter(([, m]) => m && typeof m === 'object');

  // --- ฝั่ง model: การผูกชุด ---
  const usage = new Map(); // setId -> [{id, name}]
  for (const [mid, m] of models) {
    const sid = m.conditionSetId || '';
    if (!sid) {
      if (m.isActive !== false) {
        push('NO_SET', 'warning', `${m.name || mid} (${mid})`, `รุ่น active ไม่ได้ผูกชุดประเมิน (category: ${m.category || '?'})`);
      }
      continue;
    }
    if (!setsObj || !setsObj[sid]) {
      push('MISSING_SET', 'error', `${m.name || mid} (${mid})`, `conditionSetId "${sid}" ไม่มีอยู่ใน /settings/condition_sets`);
      continue;
    }
    if (!usage.has(sid)) usage.set(sid, []);
    usage.get(sid).push({ id: mid, name: m.name || mid });
  }

  // --- SHARED_SET / ORPHAN_SET ---
  for (const [sid, s] of sets) {
    const users = usage.get(sid) || [];
    const label = `${s.name || sid} (${sid})`;
    if (users.length >= 2) {
      const sample = users.slice(0, 6).map((u) => u.name).join(', ');
      push('SHARED_SET', 'warning', label, `ถูกใช้โดย ${users.length} รุ่น: ${sample}${users.length > 6 ? ` ...และอีก ${users.length - 6}` : ''}`);
    } else if (users.length === 0) {
      push('ORPHAN_SET', 'warning', label, 'ไม่มีรุ่นไหนใช้ชุดนี้ (อาจค้างจากการแตกชุดรายรุ่น — ลบได้จาก sidebar ของ Engine)');
    }
  }

  // --- DUP_SET_NAME ---
  const byName = new Map();
  for (const [sid, s] of sets) {
    const key = String(s.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ sid, name: s.name, used: (usage.get(sid) || []).length });
  }
  for (const [, group] of byName) {
    if (group.length > 1) {
      push(
        'DUP_SET_NAME',
        'warning',
        `"${group[0].name}"`,
        `ชื่อชุดซ้ำ ${group.length} ชุด: ` + group.map((g) => `${g.sid} (ใช้โดย ${g.used} รุ่น)`).join(' | ')
      );
    }
  }

  // --- ภายในแต่ละชุด ---
  for (const [sid, s] of sets) {
    const label = `${s.name || sid} (${sid})`;
    const groups = asArray(s.groups);
    const optCount = groups.reduce((n, g) => n + asArray(g.options).length, 0);

    if (groups.length === 0 || optCount === 0) {
      push('EMPTY_SET', 'warning', label, 'ชุดไม่มี group/option เลย');
      continue;
    }

    // GROUP_DUP_THEME — หลาย group ในชุดเดียวที่เป็นธีมเดียวกัน (ถามซ้ำ + หักเงินซ้ำ)
    const byTheme = new Map();
    for (const g of groups) {
      const theme = groupTheme(g.title);
      if (!theme) continue;
      if (!byTheme.has(theme)) byTheme.set(theme, []);
      byTheme.get(theme).push(g.title || '?');
    }
    for (const [theme, titles] of byTheme) {
      if (titles.length > 1) {
        push(
          'GROUP_DUP_THEME',
          'error',
          label,
          `มี ${titles.length} หัวข้อธีมเดียวกัน (${theme}): ${titles.map((t) => `"${t}"`).join(' กับ ')} — ` +
            `ลูกค้าถูกถามซ้ำและถูกหักเงินซ้ำจากตำหนิเดียวกัน ควรยุบเหลือหัวข้อเดียว`
        );
      }
    }

    const seenIds = new Map();
    let legacyOnly = 0;
    let noValue = 0;
    const legacySamples = [];
    const noValueSamples = [];

    for (const g of groups) {
      const gTitle = g.title || '?';
      for (const opt of asArray(g.options)) {
        const oLabel = `${gTitle} → ${optionLabel(opt)}`;

        // id
        if (opt.id == null || opt.id === '') {
          push('NO_OPTION_ID', 'error', label, `option ไม่มี id: ${oLabel}`);
        } else {
          const k = String(opt.id);
          seenIds.set(k, (seenIds.get(k) || 0) + 1);
        }

        // ค่าตัวเลข
        if (opt.pct != null) {
          const p = Number(opt.pct);
          if (!Number.isFinite(p) || p < 0 || p > 100) {
            push('BAD_PCT', 'error', label, `pct ผิดปกติ (${opt.pct}) ที่ ${oLabel}`);
          }
        }
        if (opt.deduct != null) {
          const d = Number(opt.deduct);
          if (!Number.isFinite(d) || d < 0) {
            push('BAD_DEDUCT', 'error', label, `deduct ผิดปกติ (${opt.deduct}) ที่ ${oLabel}`);
          }
        }

        // โหมดของ option ตาม precedence — option ที่ประกาศ failBehavior ชัดเจน
        // ('pass' = ตั้งใจไม่หัก, 'reject' = ปฏิเสธรับซื้อ) ไม่ต้องมีค่าหัก
        const hasPct = hasFinite(opt.pct) && Number(opt.pct) >= 0;
        const hasDeduct = hasFinite(opt.deduct) && Number(opt.deduct) >= 0;
        const hasTier = hasFinite(opt.t1) || hasFinite(opt.t2) || hasFinite(opt.t3);
        const hasBehavior = opt.failBehavior === 'pass' || opt.failBehavior === 'reject';
        if (!hasPct && !hasDeduct && !hasBehavior) {
          if (hasTier) {
            legacyOnly++;
            if (legacySamples.length < 3) legacySamples.push(oLabel);
          } else {
            noValue++;
            if (noValueSamples.length < 3) noValueSamples.push(oLabel);
          }
        }
      }
    }

    for (const [id, c] of seenIds) {
      if (c > 1) push('DUP_OPTION_ID', 'error', label, `option id "${id}" ซ้ำ ${c} ครั้ง`);
    }
    if (legacyOnly > 0) {
      push('LEGACY_TIERS', 'warning', label, `${legacyOnly}/${optCount} options ยังใช้ t1/t2/t3 (เช่น ${legacySamples.join('; ')}) — ควร migrate เป็น deduct/pct ผ่านการ save จาก Engine หรือแตกชุดรายรุ่น`);
    }
    if (noValue > 0) {
      push('NO_VALUE', 'warning', label, `${noValue}/${optCount} options ไม่มีค่าหักเลย (เช่น ${noValueSamples.join('; ')}) — หักได้ 0 เสมอ ถ้าตั้งใจควรใส่ deduct: 0 ให้ชัด`);
    }
  }

  return { setCount: sets.length, modelCount: models.length, issues };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const CODE_LABEL = {
  GROUP_DUP_THEME: 'หัวข้อธีมซ้ำในชุดเดียว (หักเงินซ้ำ)',
  MISSING_SET: 'model ชี้ชุดที่ไม่มีอยู่จริง',
  DUP_OPTION_ID: 'option id ซ้ำในชุดเดียว',
  NO_OPTION_ID: 'option ไม่มี id',
  BAD_PCT: 'ค่า pct ผิดปกติ',
  BAD_DEDUCT: 'ค่า deduct ผิดปกติ',
  NO_SET: 'รุ่น active ไม่มีชุดประเมิน',
  SHARED_SET: 'ชุดถูกใช้ร่วมหลายรุ่น',
  ORPHAN_SET: 'ชุดไม่มีรุ่นไหนใช้',
  EMPTY_SET: 'ชุดว่างเปล่า',
  DUP_SET_NAME: 'ชื่อชุดซ้ำ',
  LEGACY_TIERS: 'ยังใช้ tier เก่า (t1/t2/t3)',
  NO_VALUE: 'option ไม่มีค่าหัก',
};

const ORDER = [
  'GROUP_DUP_THEME', 'MISSING_SET', 'DUP_OPTION_ID', 'NO_OPTION_ID', 'BAD_PCT', 'BAD_DEDUCT',
  'NO_SET', 'SHARED_SET', 'ORPHAN_SET', 'EMPTY_SET', 'DUP_SET_NAME', 'LEGACY_TIERS', 'NO_VALUE',
];

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(72));
  console.log('  BKK System — Condition Sets Audit');
  console.log('='.repeat(72));

  let setsObj, modelsObj;
  if (opts.setsFile && opts.modelsFile) {
    console.log(`Source: ${opts.setsFile} + ${opts.modelsFile} (local files)`);
    setsObj = JSON.parse(fs.readFileSync(path.resolve(opts.setsFile), 'utf-8'));
    modelsObj = JSON.parse(fs.readFileSync(path.resolve(opts.modelsFile), 'utf-8'));
  } else {
    console.log(`Source: ${DB_URL} (/settings/condition_sets + /models)`);
    [setsObj, modelsObj] = await Promise.all([
      fetchJSON(`${DB_URL}/settings/condition_sets.json`),
      fetchJSON(`${DB_URL}/models.json`),
    ]);
  }

  const { setCount, modelCount, issues } = audit(setsObj, modelsObj);

  console.log(`\nตรวจ ${setCount} ชุดประเมิน เทียบกับ ${modelCount} รุ่น — พบปัญหา ${issues.length} รายการ\n`);

  const byCode = new Map();
  for (const iss of issues) {
    if (!byCode.has(iss.code)) byCode.set(iss.code, []);
    byCode.get(iss.code).push(iss);
  }

  for (const code of ORDER) {
    const list = byCode.get(code);
    if (!list || list.length === 0) continue;
    console.log('─'.repeat(72));
    console.log(`  [${code}] ${CODE_LABEL[code]} — ${list.length} รายการ`);
    console.log('─'.repeat(72));
    for (const iss of list) {
      console.log(` ${iss.severity === 'error' ? '!!' : ' *'} ${iss.where}`);
      console.log(`      ${iss.detail}`);
    }
    console.log();
  }

  if (issues.length === 0) console.log('ไม่พบปัญหา — condition sets สะอาด');

  const errors = issues.filter((i) => i.severity === 'error').length;
  console.log('='.repeat(72));
  console.log(`  สรุป: ${errors} errors, ${issues.length - errors} warnings จาก ${setCount} ชุด / ${modelCount} รุ่น`);
  console.log('='.repeat(72));

  if (opts.jsonOut) {
    fs.writeFileSync(path.resolve(opts.jsonOut), JSON.stringify({ setCount, modelCount, issues }, null, 2));
    console.log(`\nJSON report: ${path.resolve(opts.jsonOut)}`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
