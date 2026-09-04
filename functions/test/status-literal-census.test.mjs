// สำมะโน string literal ของสถานะงานในตำแหน่งเทียบ ทั้ง functions/*.js —
// สะกดเก่าต้องเป็น 0 (นอก exemption ที่ระบุจำนวนเป๊ะ), canonical ลดได้ขึ้นไม่ได้
//
// ฝาแฝดของ src/utils/statusLiteralCensus.test.ts (แอดมิน #714) สำหรับฝั่ง server —
// ที่มา: รายงานขั้นที่ 3 (docs/reports/2026-09-04-status-literal-compare-survey-cross-repo.md)
// พบสามลิสต์ที่ "รับทั้งสองสะกด" ด้วยมือแล้วลืมไปหนึ่งสะกด พังเงียบทั้งสาม
// (FEE_TRIGGER_STATUSES / TERMINAL_STATUSES / SELLABLE_STATUSES). กติกาใหม่: reader
// เขียนเซ็ตด้วย JOB_STATUS.* แล้วถามผ่าน status-match.js; query list ผ่าน
// queryStatusesFor — ไม่มี literal สะกดเก่าที่ไหนอีก
//
// ตัวจำแนก "ตำแหน่งเทียบ" เป็น heuristic ระดับบรรทัด ตัวเดียวกับฝั่งแอดมิน: ตัด
// คอมเมนต์ก่อน · `status: "…"` / `status = "…"` / `status\`] = "…"` = write ไม่นับ ·
// `"…":` = คีย์ตารางป้าย ไม่นับ · `action: "…"` = ข้อความ qc_logs ไม่นับ · ที่เหลือที่มี
// ===/!==/case/includes/has/Set/สมาชิก array = เทียบ
//
// INJECTION (วัดจริง):
//   - เติม `if (job.status === "Sent to QC Lab") return;` ใน index.js   -> LEGACY แดง
//   - เติม `["In Stock"].includes(job.status)` ที่เดียวกัน               -> CANONICAL แดง
//   - เติม `"Sent to QC Lab": "x"` เป็นคีย์ object ใน index.js          -> เขียว (ตารางป้าย)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FN = path.join(root, "functions");
const { JOB_STATUS, JOB_STATUS_B2B, LEGACY_ALIAS } = require(path.join(FN, "status-vocab.generated.js"));

// ---- เพดาน (วัดจริง 4 ก.ย. 2569 หลัง sweep) ----
const CANONICAL_CEILING = 28; // วัดจริง 4 ก.ย. 2569 (ก่อน sweep: legacy 22 · canonical 78 ตามรายงานขั้นที่ 3 — ตัวจำแนก python นับกว้างกว่า)

/**
 * ไฟล์ที่ยังถือ literal สะกดเก่าโดยรอ PR ที่แยกไว้ — จำนวนเป๊ะ ถอดออกเมื่อ PR นั้น merge
 */
const LEGACY_EXEMPTIONS = {
  // onJobHandedOverCalcRiderFee FEE_TRIGGER_STATUSES — #716 (HUMAN-GATED รอรายชื่อจ่ายย้อนหลัง)
  "index.js": { count: 1, reason: "#716 rider-fee safety net" },
};

// เจ้าของคำศัพท์ — literal ในนี้คือคำจำกัดความ ไม่ใช่การเทียบ
const SKIP_FILES = new Set(["status-vocab.generated.js", "status-match.js"]);

const CANONICAL = new Set([...Object.values(JOB_STATUS), ...Object.values(JOB_STATUS_B2B)]);
// 'In-Transit' overload ไม่อยู่ในตาราง alias แต่เป็นสะกดเก่าที่ DB ถืออยู่จริง
const LEGACY = new Set([...Object.keys(LEGACY_ALIAS), "In-Transit"].filter((k) => !CANONICAL.has(k)));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VOCAB = [...CANONICAL, ...LEGACY].sort((a, b) => b.length - a.length);
const LIT_RE = new RegExp(`(['"\`])(${VOCAB.map(esc).join("|")})\\1`, "g");

function stripComment(line) {
  const t = line.trimStart();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
  let out = "";
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      out += c;
      if (c === "\\") { out += line[i + 1] || ""; i++; continue; }
      if (c === q) q = null;
    } else if (c === "'" || c === '"' || c === "`") { q = c; out += c; }
    else if (line.startsWith("//", i)) break;
    else out += c;
  }
  return out;
}

// คืน 'write' | 'map' | 'log' | 'compare' | null
function classify(code, lit) {
  const q = `(['"\`])${esc(lit)}\\1`;
  if (new RegExp(`\\bstatus\\s*[:=]\\s*${q}`).test(code) || new RegExp(`status\`\\]\\s*=\\s*${q}`).test(code)) return "write";
  if (new RegExp(`\\baction\\s*:\\s*${q}`).test(code)) return "log";
  if (new RegExp(`(?:^|[\\s{,])${q}\\s*:`).test(code)) return "map";
  if (new RegExp(`[=!]==?\\s*${q}`).test(code) || new RegExp(`${q}\\s*[=!]==?`).test(code)) return "compare";
  if (new RegExp(`\\bcase\\s+${q}`).test(code)) return "compare";
  if (new RegExp(`\\.(?:includes|has|indexOf)\\(\\s*${q}`).test(code)) return "compare";
  if (/\.(?:includes|has|some|indexOf)\(/.test(code) || /new Set\(/.test(code)) return "compare";
  if (/=\s*(?:new Set\()?\[/.test(code) || new RegExp(`^\\s*${q}\\s*,?\\s*$`).test(code) || new RegExp(`,\\s*${q}\\s*,?\\s*(?:\\]|$)`).test(code) || new RegExp(`\\[\\s*${q}`).test(code)) return "compare";
  return null;
}

const files = fs.readdirSync(FN).filter((f) => f.endsWith(".js") && !SKIP_FILES.has(f));
const legacyHits = [];
const canonicalHits = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(FN, f), "utf8").split("\n");
  lines.forEach((raw, i) => {
    const code = stripComment(raw);
    if (!code.trim()) return;
    for (const m of code.matchAll(LIT_RE)) {
      const lit = m[2];
      const kind = classify(code, lit);
      if (kind !== "compare") continue;
      (LEGACY.has(lit) ? legacyHits : canonicalHits).push(`${f}:${i + 1} [${lit}] ${code.trim().slice(0, 80)}`);
    }
  });
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); } catch (err) { failures++; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

console.log("status-literal-census");
console.log(`  [census] legacy=${legacyHits.length} canonical=${canonicalHits.length} files=${files.length}`);

check("LEGACY = ผลรวมของ exemption เป๊ะ (วันนี้ = #716) — ถอด exemption เมื่อ merge แล้วต้องเป็น 0", () => {
  const perFile = {};
  for (const h of legacyHits) { const f = h.split(":")[0]; perFile[f] = (perFile[f] || 0) + 1; }
  const expected = Object.fromEntries(Object.entries(LEGACY_EXEMPTIONS).map(([f, e]) => [f, e.count]));
  assert.deepEqual(perFile, expected, `legacy literal ในตำแหน่งเทียบ:\n${legacyHits.join("\n")}`);
});

check(`CANONICAL ไม่เกินเพดาน ${CANONICAL_CEILING} (ลดได้ ขึ้นไม่ได้)`, () => {
  assert.ok(canonicalHits.length <= CANONICAL_CEILING, `canonical=${canonicalHits.length}:\n${canonicalHits.join("\n")}`);
});

check("เพดานไม่หลวมเกินจริง — ลดแล้วต้องลดเลขในไฟล์นี้ด้วย", () => {
  assert.ok(canonicalHits.length >= CANONICAL_CEILING - 3, `canonical=${canonicalHits.length} ต่ำกว่าเพดาน ${CANONICAL_CEILING} เกิน 3`);
});

check("คำศัพท์ไม่ว่าง — ด่านที่ไม่รู้จักคำไหนเลยจะเขียวเสมอ", () => {
  assert.ok(CANONICAL.size >= 40 && LEGACY.size >= 10, `canonical=${CANONICAL.size} legacy=${LEGACY.size}`);
  assert.ok(files.includes("index.js") && files.length >= 40);
});

if (failures > 0) { console.error(`\nstatus-literal-census: ${failures} failing`); process.exit(1); }
console.log("status-literal-census: all passing");
