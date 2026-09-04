// สำมะโน string literal ของสถานะงานในตำแหน่งเทียบ — สะกดเก่าต้องเป็น 0, canonical ลดได้ขึ้นไม่ได้
//
// ที่มา: 4 ก.ย. 2569 หน้าจอสามหน้าว่างลงเงียบๆ ในวันเดียว (#709 /qc-station, #711
// /inventory + POS, #713 ล็อต B2B ที่จ่ายแล้วไม่ล็อก) ด้วยสาเหตุเดียวกัน: reader เทียบ
// status กับ literal สะกดเก่า ('Sent to QC Lab') ขณะที่ engine เขียน canonical
// ('Sent To QC Lab'). tsc ไม่รู้จักความต่าง eslint ใน CI เป็น advisory ไม่มีอะไรจับได้
// (docs/reports/2026-09-04-status-literal-compare-survey.md)
//
// สองเพดาน:
//   LEGACY    — literal สะกดเก่า (คีย์ LEGACY_ALIAS + 'In-Transit') ในตำแหน่งเทียบ
//               ต้องเท่ากับผลรวมของ EXEMPTIONS เป๊ะ ไม่ใช่ ≤ — วันนี้ (หลัง #710) = 0
//               ถ้าต้องเว้นไฟล์รอ PR ที่แยกไว้ ให้ระบุจำนวนเป๊ะแล้วถอดออกเมื่อ PR นั้น merge
//   CANONICAL — literal สะกด canonical ในตำแหน่งเทียบ ลดได้ ขึ้นไม่ได้ (reader ใหม่ต้อง
//               เขียนด้วย JOB_STATUS.* + statusIs/statusIn ใน utils/statusCompare.ts)
//
// แดงเพราะเพิ่ม = แก้ที่ reader ใหม่ให้ใช้ statusCompare · แดงเพราะลด = ลดเลขพร้อม PR
//
// ตัวจำแนก "ตำแหน่งเทียบ" เป็น heuristic ระดับบรรทัด (ตัวเดียวกับที่สร้างภาคผนวก A ของ
// รายงาน): ตัดบรรทัดคอมเมนต์ทิ้งก่อน · `status: '…'` / `status = '…'` = write ไม่นับ ·
// `'…': ` = คีย์ของตารางป้าย/สี ไม่นับ · ที่เหลือที่มี ===/!==/case/includes/has/Set/
// สมาชิก array = เทียบ. regex โกหกได้สองทาง (บทเรียน 4 ก.ย.) จึงมี injection ในหัว
// ไฟล์เทสตัวนี้เป็นหลักฐานว่ามันจับได้จริง:
//   - เติม `if (j.status === 'Sent to QC Lab')` ใน src/pages/sales/POS.tsx → LEGACY แดง
//   - เติม `['In Stock'].includes(j.status)` ที่เดียวกัน → CANONICAL แดง
//   - เติม `'Sent to QC Lab': 'x'` เป็นคีย์ object → เขียว (ตารางป้าย ไม่ใช่การเทียบ)
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { JOB_STATUS, JOB_STATUS_B2B } from '../types/job-statuses';

const SRC = resolve(__dirname, '..');
const ROOT = resolve(__dirname, '../..');

// ---- เพดาน (วัดจริง ก.ย. 2569 หลัง sweep) ----
/** literal สะกด canonical ในตำแหน่งเทียบ — ลดได้ ขึ้นไม่ได้ */
const CANONICAL_CEILING = 95; // วัดจริง 4 ก.ย. 2569 หลัง #710 (ก่อน sweep 283, หลัง #714 99)

/**
 * ไฟล์ที่ยังถือ literal สะกดเก่าโดยรอ PR ที่แยกไว้ — ต้องระบุจำนวนเป๊ะ ไม่ใช่ allow ทั้งไฟล์
 * ถอดออกเมื่อ PR นั้น merge (เลขจะแดงเตือนเองถ้าลืม)
 */
const LEGACY_EXEMPTIONS: Record<string, { count: number; reason: string }> = {};

const SKIP_FILES = new Set([
  'src/types/job-statuses.ts',   // ต้นทางของคำศัพท์
  'src/types/domain.ts',         // JobStatusB2B enum เก่า (deprecated) — สมาชิกไม่ใช่การเทียบ
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function legacySpellings(): string[] {
  const text = readFileSync(join(SRC, 'types/job-statuses.ts'), 'utf8');
  const block = text.slice(text.indexOf('const LEGACY_ALIAS'), text.indexOf('export function normalizeStatus'));
  const keys = [...block.matchAll(/^\s*'?([A-Za-z][A-Za-z ()\-]+?)'?\s*:\s*JOB_STATUS\./gm)].map((m) => m[1]);
  return [...new Set([...keys, 'In-Transit'])];
}

const CANONICAL = new Set<string>([...Object.values(JOB_STATUS), ...Object.values(JOB_STATUS_B2B)]);
const LEGACY = new Set<string>(legacySpellings());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VOCAB = [...CANONICAL, ...LEGACY].sort((a, b) => b.length - a.length);
const LITERAL_RE = new RegExp(`(['"])(${VOCAB.map(esc).join('|')})\\1`, 'g');

type Site = 'compare' | 'write' | 'map' | 'other';
function classify(line: string, val: string): Site {
  const v = esc(val);
  if (new RegExp(`\\bstatus\\s*:\\s*['"]${v}['"]`).test(line) || new RegExp(`status\\s*=\\s*['"]${v}`).test(line)) return 'write';
  if (new RegExp(`^\\s*['"]?${v}['"]?\\s*:\\s*`).test(line) || new RegExp(`\\[['"]${v}['"]\\]\\s*:`).test(line)) return 'map';
  if (/(===|!==|==|!=)\s*['"]/.test(line) || /['"]\s*(===|!==|==|!=)/.test(line) || /\bcase\s+['"]/.test(line)
      || /\.includes\(|\.has\(|new Set\(|equalTo\(/.test(line) || new RegExp(`\\[\\s*['"]${v}|,\\s*['"]${v}['"]|['"]${v}['"]\\s*,`).test(line)) return 'compare';
  return 'other';
}

function stripComment(line: string): string | null {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return null;
  return line.replace(/\s\/\/[^'"]*$/, '');
}

export function census() {
  const legacyHits: Array<{ file: string; line: number; val: string }> = [];
  const canonicalHits: Array<{ file: string; line: number; val: string }> = [];
  for (const abs of walk(SRC)) {
    const file = relative(ROOT, abs).split('\\').join('/');
    if (SKIP_FILES.has(file)) continue;
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      const line = stripComment(raw);
      if (!line) return;
      for (const m of line.matchAll(LITERAL_RE)) {
        const val = m[2];
        if (classify(line, val) !== 'compare') continue;
        (LEGACY.has(val) ? legacyHits : canonicalHits).push({ file, line: i + 1, val });
      }
    });
  }
  return { legacyHits, canonicalHits };
}

describe('status literal census', () => {
  const { legacyHits, canonicalHits } = census();
  const fmt = (h: { file: string; line: number; val: string }) => `${h.file}:${h.line} '${h.val}'`;

  it('legacy spellings in compare position: 0 outside the recorded exemptions', () => {
    const byFile = new Map<string, number>();
    for (const h of legacyHits) byFile.set(h.file, (byFile.get(h.file) || 0) + 1);
    const unexpected = legacyHits.filter((h) => !LEGACY_EXEMPTIONS[h.file]);
    expect(unexpected.map(fmt), 'legacy literal compares outside exemptions').toEqual([]);
    for (const [file, { count }] of Object.entries(LEGACY_EXEMPTIONS)) {
      expect(byFile.get(file) || 0, `exemption count for ${file} (remove the entry when its PR merges)`).toBe(count);
    }
  });

  it('canonical literals in compare position never grow', () => {
    expect(canonicalHits.length, `canonical literal compares (ceiling ${CANONICAL_CEILING}); newest first:\n` + canonicalHits.slice(-5).map(fmt).join('\n'))
      .toBeLessThanOrEqual(CANONICAL_CEILING);
  });

  it('vocabulary was actually loaded (guards against a silent empty scan)', () => {
    // พิมพ์ตัวเลขทุกครั้งเพื่อให้ลดเพดานได้โดยไม่ต้องเดา
    console.log(`[statusLiteralCensus] legacy=${legacyHits.length} canonical=${canonicalHits.length} (ceiling ${CANONICAL_CEILING})`);
    expect(LEGACY.size).toBeGreaterThan(5);
    expect(CANONICAL.size).toBeGreaterThan(30);
    expect(canonicalHits.length).toBeGreaterThan(0);
  });
});
