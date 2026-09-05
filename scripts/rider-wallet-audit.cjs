#!/usr/bin/env node
/**
 * READ-ONLY — ตรวจกระเป๋าเงินไรเดอร์จาก ledger จริง (5 ก.ย. 2569)
 *
 * สคริปต์นี้อ่านอย่างเดียวโดยโครงสร้าง: ไม่มีคำสั่งเขียน RTDB ชนิดใดในไฟล์
 * (ด่านอยู่ที่ src/utils/riderWalletAuditReadOnly.test.ts ซึ่ง grep ไฟล์นี้ใน CI)
 * ไม่มีโหมดเขียน ไม่มีสวิตช์ apply — สิ่งเดียวที่มันเขียนคือไฟล์รายงาน markdown
 * บนเครื่องที่รัน
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/rider-wallet-audit.cjs
 *   # หรือ
 *   node scripts/rider-wallet-audit.cjs --service-account /path/to/service-account.json
 *
 *   ตัวเลือก:
 *     --rider-app <dir>      ที่อยู่ checkout ของ bkk-rider-app (ค่าเริ่มต้น: ../bkk-rider-app
 *                            ข้าง repo นี้ หรือ env BKK_RIDER_APP_DIR) — ต้องมี เพราะสูตร
 *                            balance และ allowlist ถูกโหลดจากไฟล์จริงของแอป ไม่ได้คัดลอกมา
 *     --window-end <YYYY-MM-DD>  ปลายหน้าต่าง T3 (ค่าเริ่มต้น: วันที่ Routes API key ถูกแก้)
 *     --owner-rider <uid>    rider_id ของเจ้าของธุรกิจ (ค่าเริ่มต้น: uid ที่รายงานเฟส 0 บันทึกไว้)
 *     --out <file>           ที่เก็บรายงาน (ค่าเริ่มต้น: docs/reports/rider-wallet-audit-<ISO>.md)
 *
 *   env FIREBASE_DATABASE_URL ไม่ตั้ง = ใช้ URL ของ project bkk-apple-tradein
 *
 * ทำไม balance ต้องมาจากไฟล์ของแอปไรเดอร์ ไม่ใช่สูตรในสคริปต์นี้:
 *   สคริปต์รุ่นก่อน (audit-rider-wallet.cjs) คัดลอก allowlist 4 หมวดมาไว้ในตัว แล้วแอป
 *   ขยับเป็น 8 หมวดโดยที่สำเนานั้นไม่ตาม — รันซ้ำวันนี้จะได้เลขที่ต่ำกว่าจอไรเดอร์โดยไม่มี
 *   error. ไฟล์ bkk-rider-app/src/utils/walletLedger.ts เป็น TypeScript ที่ไม่มี import ใดๆ
 *   สคริปต์นี้จึง transpile มันด้วย typescript ของ repo แล้วเรียก isRiderWalletTx /
 *   walletBalance / pendingWithdrawalHold ตัวจริง — เลขในรายงานคือเลขที่จอไรเดอร์คำนวณ
 *   ด้วยโค้ดชุดเดียวกัน ณ commit ของ checkout นั้น (รายงานพิมพ์ rev ไว้ให้)
 *
 * การอ่านข้อมูล: /transactions, /jobs, /riders, /withdrawals อย่างละหนึ่งครั้ง เก็บใน
 *   หน่วยความจำแล้วคำนวณทั้งหมด ไม่ query ซ้ำต่อ rider. ข้อยกเว้นเดียว: ref_job_id ที่หา
 *   ไม่เจอใน /jobs จะถูกเช็คทีละใบที่ jobs_archived/{id}/ref_no (subpath เล็ก) เพื่อแยก
 *   "งานถูก archive" ออกจาก "งานหาย"
 *
 * ความเป็นส่วนตัว: รายงานพิมพ์ rider_id / job id / ref_no / ตัวเลข เท่านั้น — ไม่พิมพ์
 *   ชื่อ เบอร์ เลขบัญชี และไม่พิมพ์ description ดิบของแถวใด (แถวถอนเงินมีเลขบัญชีอยู่
 *   ในนั้น) ใช้ได้แค่ป้ายที่อนุมานจากมัน
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

/** allowlist ที่แผน 31 ส.ค. ใช้ (เฟส 0/1 รุ่นแรก) — ค่าประวัติศาสตร์สำหรับคอลัมน์เปรียบเทียบ
 *  ของ T1 เท่านั้น ไม่ใช่กติกาปัจจุบัน (กติกาปัจจุบันโหลดจาก walletLedger.ts) */
const LEGACY_ALLOWLIST_2026_08_31 = ['JOB_PAYOUT', 'WITHDRAWAL', 'PENALTY', 'BONUS'];

/** ทิศทางที่แต่ละหมวดควรเป็น ตามจุดเขียนจริง (ดู docs/reports/2026-09-05-rider-wallet-status-survey.md
 *  ใน bkk-frontend-next ตาราง A3). 'ANY' = หมวดที่เขียนได้ทั้งสองทิศโดยดีไซน์ (ADJUSTMENT) */
const EXPECTED_TYPE = {
  JOB_PAYOUT: 'CREDIT',
  BONUS: 'CREDIT',
  EXPENSE_REIMBURSEMENT: 'CREDIT',
  COMPANY_ADVANCE: 'CREDIT',
  RIDER_DEPOSIT: 'CREDIT',
  LOGISTICS_REVENUE: 'CREDIT',
  WITHDRAWAL: 'DEBIT',
  PENALTY: 'DEBIT',
  TRADE_IN_PAYOUT: 'DEBIT',
  B2B_PURCHASE: 'DEBIT',
  ADJUSTMENT: 'ANY',
};

/** วันที่ Routes API key ถูกแก้ — bkk-frontend-next commits 6a8e7c7e และ 49fed338
 *  "chore: use Routes-enabled Maps key" (2026-08-07). git log ของ bkk-system ไม่มี commit
 *  เรื่องคีย์นี้ (คีย์ตั้งที่ frontend). ค่านี้อยู่ก่อน WINDOW_START จึงทำให้หน้าต่าง T3
 *  ตามที่ตั้งโจทย์ว่างเปล่าโดยนิยาม — รายงานพิมพ์ข้อเท็จจริงนี้ และรับ --window-end ให้ลองค่าอื่น */
const ROUTES_KEY_FIX_DATE = '2026-08-07';
const WINDOW_START = '2026-08-11';
/** วันแรกที่มีไรเดอร์จ้าง — ก่อนหน้านี้เจ้าของวิ่งเอง (fare-integrity survey 1 ก.ย. 2569) */
const RIDER_ERA_START = '2026-09-01';
/** rider_id ของเจ้าของธุรกิจ ตามที่รายงานเฟส 0 บันทึก (fix-plan.md บรรทัด 42) — override ได้ */
const DEFAULT_OWNER_RIDER = 'GmxKmv51QxNr0HTuZ5FqmIB50kQ2';
/** งานเคสแรกของไรเดอร์ที่จ้าง (fare-integrity survey) */
const CASE_JOB_REF = 'OID-MTIAI3FH-851';
const CASE_JOB_ID = '-P0QekIHDPBe7phJhabu';
const DEFAULT_DATABASE_URL = 'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';
const ARCHIVE_LOOKUP_CAP = 300;

const BKK_OFFSET_MS = 7 * 3600 * 1000;

/** ต่อท้ายลิสต์โดยไม่ใช้เมธอดที่ด่าน read-only ห้ามในไฟล์นี้ */
function add(list, item) {
  list[list.length] = item;
}

function parseArgs(argv) {
  const out = {
    serviceAccount: null,
    riderApp: null,
    windowEnd: ROUTES_KEY_FIX_DATE,
    ownerRider: DEFAULT_OWNER_RIDER,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${a} ต้องมีค่าตามหลัง`);
      return argv[i];
    };
    if (a === '--service-account') out.serviceAccount = next();
    else if (a === '--rider-app') out.riderApp = next();
    else if (a === '--window-end') out.windowEnd = next();
    else if (a === '--owner-rider') out.ownerRider = next();
    else if (a === '--out') out.out = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`ไม่รู้จักตัวเลือก ${a}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.windowEnd)) throw new Error(`--window-end ต้องเป็น YYYY-MM-DD ได้ ${out.windowEnd}`);
  return out;
}

// ─── เวลา (เขตกรุงเทพ) ───────────────────────────────────────────────────────

function bkkDayStartMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - BKK_OFFSET_MS;
}
function bkkDayEndMs(ymd) {
  return bkkDayStartMs(ymd) + 24 * 3600 * 1000 - 1;
}
function fmtBkk(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const d = new Date(n + BKK_OFFSET_MS);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ─── ตัวเลข ───────────────────────────────────────────────────────────────────

/** number|string ที่แปลงเป็นเลข finite ได้ → number, อย่างอื่น → null (Number(null) === 0 คือกับดัก) */
function finiteOrNull(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const fmt = (n) => (Number.isFinite(Number(n)) && n !== null ? Number(n).toLocaleString('th-TH') : '-');

// ─── โหลดสูตรของแอปไรเดอร์ ────────────────────────────────────────────────────

function resolveRiderAppDir(cliValue) {
  const candidates = [cliValue, process.env.BKK_RIDER_APP_DIR, path.resolve(REPO_ROOT, '..', 'bkk-rider-app')];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'src', 'utils', 'walletLedger.ts'))) return path.resolve(c);
  }
  return null;
}

/**
 * transpile bkk-rider-app/src/utils/walletLedger.ts (ไฟล์ pure ไม่มี import) แล้วคืน exports
 * ของมันตรงๆ — สูตร balance และ allowlist จึงเป็นของแอปเอง ไม่ใช่สำเนา
 */
function loadWalletLedger(riderAppDir) {
  const file = path.join(riderAppDir, 'src', 'utils', 'walletLedger.ts');
  const src = fs.readFileSync(file, 'utf8');
  if (/^\s*import\s/m.test(src)) {
    throw new Error(`${file} มี import แล้ว — สคริปต์นี้ transpile ได้เฉพาะไฟล์ pure ต้องปรับ loader ก่อน`);
  }
  let ts;
  try {
    ts = require(path.join(REPO_ROOT, 'node_modules', 'typescript'));
  } catch {
    ts = require('typescript');
  }
  const out = ts.transpileModule(src, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const Module = require('module');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(out.outputText, file);
  const exp = m.exports;
  for (const name of ['isRiderWalletTx', 'walletBalance', 'pendingWithdrawalHold', 'RIDER_WALLET_CATEGORIES']) {
    if (!(name in exp)) throw new Error(`walletLedger.ts ไม่มี export ${name} — สคริปต์นี้ต้องปรับตาม`);
  }
  let rev = '(unknown)';
  try {
    rev = require('child_process')
      .execFileSync('git', ['-C', riderAppDir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
      .trim();
  } catch {
    /* ไม่มี git ก็รายงานว่าไม่ทราบ */
  }
  return { ledger: exp, source: { file, rev } };
}

// ─── วิเคราะห์ (pure — รับข้อมูลที่โหลดแล้ว) ──────────────────────────────────

function riderKey(v) {
  if (v === undefined || v === null || v === '') return '(none)';
  return String(v);
}

/** ป้ายผู้เขียนแถว JOB_PAYOUT อนุมานจาก description — ไม่คืน description เอง */
function payoutWriterLabel(t) {
  const d = String((t && t.description) || '');
  if (d.includes('[Backfill Settle]')) return 'script settle-pending-rider-fees';
  if (d.includes('[Batch]')) return 'ปุ่ม batch ของ RiderSettlements (รุ่นเก่า)';
  if (d.startsWith('ค่าเที่ยวงาน')) return 'อนุมัติจาก UI (buildRiderFeeApproval / RiderSettlements)';
  if (d.startsWith('[ซ่อม]')) return 'TransactionRepair';
  return 'ไม่ทราบ';
}

function jobDate(job) {
  const completed = finiteOrNull(job && job.completed_at);
  if (completed !== null && completed > 0) return { ms: completed, field: 'completed_at' };
  const created = finiteOrNull(job && job.created_at);
  if (created !== null && created > 0) return { ms: created, field: 'created_at' };
  return { ms: null, field: '(none)' };
}

/**
 * @param {object} input
 *   tx            snapshot.val() ของ /transactions
 *   jobs          snapshot.val() ของ /jobs
 *   riders        snapshot.val() ของ /riders
 *   withdrawals   snapshot.val() ของ /withdrawals (null ได้)
 *   archivedFound เซ็ตของ job id ที่พบใน jobs_archived (เฉพาะที่ถูกเช็ค)
 *   ledger        exports ของ walletLedger.ts
 *   opts          { windowEnd, ownerRider }
 */
function analyze(input) {
  const { ledger, opts } = input;
  const txMap = input.tx || {};
  const jobsMap = input.jobs || {};
  const ridersMap = input.riders || {};
  const wdMap = input.withdrawals || {};
  const archivedFound = input.archivedFound || new Set();
  const windowEnd = (opts && opts.windowEnd) || ROUTES_KEY_FIX_DATE;
  const ownerRider = (opts && opts.ownerRider) || DEFAULT_OWNER_RIDER;

  const rows = Object.entries(txMap).map(([id, v]) => ({ id, ...(v || {}) }));
  const jobs = Object.entries(jobsMap).map(([id, v]) => ({ id, ...(v || {}) }));
  const wdRows = Object.entries(wdMap).map(([id, v]) => ({ id, ...(v || {}) }));
  const legacySet = new Set(LEGACY_ALLOWLIST_2026_08_31);
  const currentAllowlist = Array.from(ledger.RIDER_WALLET_CATEGORIES);

  // ── T1 ──
  const byRider = {};
  for (const t of rows) {
    const rid = riderKey(t.rider_id);
    if (!byRider[rid]) byRider[rid] = [];
    add(byRider[rid], t);
  }
  const wdByRider = {};
  for (const w of wdRows) {
    const rid = riderKey(w.rider_id);
    if (!wdByRider[rid]) wdByRider[rid] = [];
    add(wdByRider[rid], w);
  }
  const t1 = [];
  for (const rid of Object.keys(byRider).sort()) {
    const riderRows = byRider[rid];
    const perCategory = {};
    for (const t of riderRows) {
      const key = `${t.category ?? '(none)'}/${t.type ?? '(none)'}`;
      if (!perCategory[key]) perCategory[key] = { count: 0, sum: 0, bad: 0 };
      perCategory[key].count += 1;
      const amt = finiteOrNull(t.amount);
      if (amt === null) perCategory[key].bad += 1;
      else perCategory[key].sum += amt;
    }
    const walletRows = riderRows.filter((t) => ledger.isRiderWalletTx(t));
    const balance = ledger.walletBalance(walletRows);
    const balanceLegacy = ledger.walletBalance(walletRows.filter((t) => legacySet.has(String(t.category))));
    const hold = ledger.pendingWithdrawalHold(wdByRider[rid] || []);
    add(t1, {
      rider_id: rid,
      rows: riderRows.length,
      walletRows: walletRows.length,
      perCategory,
      balance,
      balanceLegacy,
      diff: balance - balanceLegacy,
      hold,
      available: balance - hold,
      inRiders: Object.prototype.hasOwnProperty.call(ridersMap, rid),
    });
  }
  const ridersWithoutLedger = Object.keys(ridersMap).filter((rid) => !byRider[rid]);

  // ── T2 ──
  const t2 = [];
  const wdIds = new Set(wdRows.map((w) => w.id));
  for (const t of rows) {
    const flags = [];
    const amt = finiteOrNull(t.amount);
    if (amt === null) add(flags, 'amount_not_finite');
    else if (amt < 0) add(flags, 'negative_amount');
    if (t.type !== 'CREDIT' && t.type !== 'DEBIT') add(flags, 'bad_type');
    const cat = String(t.category ?? '');
    const expected = EXPECTED_TYPE[cat];
    if (!expected) add(flags, 'unknown_category');
    else if (expected !== 'ANY' && (t.type === 'CREDIT' || t.type === 'DEBIT') && t.type !== expected) add(flags, `type_${t.type}_but_category_expects_${expected}`);
    const ref = t.ref_job_id;
    if (!ref) add(flags, 'no_ref_job_id');
    else if (!jobsMap[ref] && !wdIds.has(ref) && !archivedFound.has(ref)) add(flags, 'ref_job_missing');
    else if (!jobsMap[ref] && archivedFound.has(ref)) add(flags, 'ref_job_archived');
    if (finiteOrNull(t.timestamp) === null) add(flags, 'timestamp_missing');
    if (flags.length) add(t2, { id: t.id, rider_id: riderKey(t.rider_id), category: cat || '(none)', type: t.type ?? '(none)', amount: t.amount ?? null, ref_job_id: ref ?? null, flags });
  }

  // ── T3 ──
  const payoutRows = rows.filter((t) => t.category === 'JOB_PAYOUT');
  const winStart = bkkDayStartMs(WINDOW_START);
  const winEnd = bkkDayEndMs(windowEnd);
  const t3 = {
    windowStart: WINDOW_START,
    windowEnd,
    windowInverted: winEnd < winStart,
    amount150: [],
    inWindow: [],
    reasonNotCalculated: [],
    paidNotEqualFee: [],
  };
  for (const t of payoutRows) {
    const amt = finiteOrNull(t.amount);
    const ts = finiteOrNull(t.timestamp);
    const job = t.ref_job_id ? jobsMap[t.ref_job_id] : null;
    const meta = (job && job.rider_fee_meta) || null;
    const base = { id: t.id, rider_id: riderKey(t.rider_id), ref_job_id: t.ref_job_id ?? null, amount: amt, at: ts, writer: payoutWriterLabel(t), reason: meta ? meta.reason ?? '(no reason)' : job ? '(no meta)' : '(job not in /jobs)', fee_on_job: job ? finiteOrNull(job.rider_fee) : null };
    if (amt === 150) add(t3.amount150, base);
    if (ts !== null && ts >= winStart && ts <= winEnd) add(t3.inWindow, base);
    if (job && meta && meta.reason && meta.reason !== 'calculated') add(t3.reasonNotCalculated, base);
    if (job && base.fee_on_job !== null && amt !== null && base.fee_on_job !== amt) add(t3.paidNotEqualFee, base);
  }

  // ── T4 ──
  const withdrawalRows = rows.filter((t) => t.category === 'WITHDRAWAL');
  const t4 = {
    withdrawalTotal: withdrawalRows.length,
    withdrawalDebit: withdrawalRows.filter((t) => t.type === 'DEBIT').length,
    withdrawalCredit: withdrawalRows.filter((t) => t.type === 'CREDIT').length,
    withdrawalIds: withdrawalRows.map((t) => t.id),
    backfillSettle: rows.filter((t) => String(t.description || '').includes('[Backfill Settle]')).map((t) => ({ id: t.id, rider_id: riderKey(t.rider_id), amount: finiteOrNull(t.amount), ref_job_id: t.ref_job_id ?? null })),
    batchTagged: rows.filter((t) => String(t.description || '').includes('[Batch]')).length,
    withdrawalsNode: { total: wdRows.length, requested: 0, paid: 0, rejected: 0, other: 0 },
  };
  for (const w of wdRows) {
    const st = String(w.status || '');
    if (st === 'requested' || st === 'paid' || st === 'rejected') t4.withdrawalsNode[st] += 1;
    else t4.withdrawalsNode.other += 1;
  }

  // ── T5 ──
  const eraStart = bkkDayStartMs(RIDER_ERA_START);
  const t5 = { owner: [], rider: [], noFee: [], undated: [], ownerSum: 0, riderSum: 0 };
  for (const j of jobs) {
    if (j.rider_fee_status !== 'Pending') continue;
    const fee = finiteOrNull(j.rider_fee);
    const { ms, field } = jobDate(j);
    const rid = riderKey(j.rider_id);
    const row = { job_id: j.id, ref_no: j.ref_no || j.OID || '-', rider_id: rid, fee, date: ms, dateField: field, status: j.status || '(none)', receive_method: j.receive_method || '(none)' };
    if (fee === null || fee <= 0) {
      add(t5.noFee, row);
      continue;
    }
    if (ms === null) {
      add(t5.undated, row);
      continue;
    }
    if (ms < eraStart) {
      row.labelMismatch = rid !== ownerRider;
      add(t5.owner, row);
      t5.ownerSum += fee;
    } else {
      row.labelMismatch = rid === ownerRider;
      add(t5.rider, row);
      t5.riderSum += fee;
    }
  }
  const byDate = (a, b) => (a.date || 0) - (b.date || 0);
  t5.owner.sort(byDate);
  t5.rider.sort(byDate);

  // ── T6 ──
  const payoutByJob = {};
  const adjustByJob = {};
  for (const t of rows) {
    if (!t.ref_job_id) continue;
    if (t.category === 'JOB_PAYOUT') {
      if (!payoutByJob[t.ref_job_id]) payoutByJob[t.ref_job_id] = [];
      add(payoutByJob[t.ref_job_id], t);
    } else if (t.category === 'ADJUSTMENT') {
      if (!adjustByJob[t.ref_job_id]) adjustByJob[t.ref_job_id] = [];
      add(adjustByJob[t.ref_job_id], t);
    }
  }
  const describeJob = (j) => {
    const fee = finiteOrNull(j.rider_fee);
    const payouts = (payoutByJob[j.id] || []).map((t) => ({ id: t.id, amount: finiteOrNull(t.amount), at: finiteOrNull(t.timestamp), writer: payoutWriterLabel(t), taxable: t.taxable ?? null }));
    const adjustments = (adjustByJob[j.id] || []).map((t) => ({ id: t.id, type: t.type, amount: finiteOrNull(t.amount), at: finiteOrNull(t.timestamp) }));
    const payoutSum = payouts.reduce((s, p) => s + (p.amount ?? 0), 0);
    const adjustSum = adjustments.reduce((s, a) => s + (a.type === 'CREDIT' ? a.amount ?? 0 : -(a.amount ?? 0)), 0);
    const meta = j.rider_fee_meta || {};
    const estMeta = j.rider_fee_estimate_meta || {};
    const { ms, field } = jobDate(j);
    return {
      job_id: j.id,
      ref_no: j.ref_no || j.OID || '-',
      rider_id: riderKey(j.rider_id),
      status: j.status || '(none)',
      date: ms,
      dateField: field,
      rider_fee: fee,
      rider_fee_estimate: finiteOrNull(j.rider_fee_estimate),
      rider_fee_status: j.rider_fee_status || '(none)',
      meta_reason: meta.reason ?? null,
      meta_distance_km: finiteOrNull(meta.distance_km),
      meta_travel_mode: meta.travel_mode ?? (meta.rates && meta.rates.travel_mode) ?? null,
      estimate_distance_km: finiteOrNull(estMeta.distance_km),
      approved_by: j.rider_fee_approved_by ?? null,
      settled_at: finiteOrNull(j.settled_at),
      payouts,
      adjustments,
      payoutSum,
      adjustSum,
      diff: fee === null ? null : payoutSum + adjustSum - fee,
      pin_dispute: j.pin_dispute ? { status: j.pin_dispute.status ?? null, fee_before: finiteOrNull(j.pin_dispute.fee_before), fee_after: finiteOrNull(j.pin_dispute.fee_after) } : null,
    };
  };
  const caseJobs = jobs.filter((j) => j.id === CASE_JOB_ID || j.ref_no === CASE_JOB_REF || j.OID === CASE_JOB_REF);
  const riderEraJobs = jobs.filter((j) => {
    const rid = riderKey(j.rider_id);
    if (rid === '(none)' || rid === ownerRider) return false;
    const { ms } = jobDate(j);
    return ms !== null && ms >= eraStart;
  });
  const seen = new Set();
  const t6 = [];
  for (const j of [...caseJobs, ...riderEraJobs]) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    add(t6, describeJob(j));
  }
  t6.sort(byDate);
  const caseFound = caseJobs.length > 0;
  // แถว ledger ที่ชี้เคสโดยตรง แม้งานจะไม่อยู่ใน /jobs แล้ว (archive)
  const casePayoutsWithoutJob = caseFound ? [] : (payoutByJob[CASE_JOB_ID] || []).map((t) => ({ id: t.id, amount: finiteOrNull(t.amount), at: finiteOrNull(t.timestamp), writer: payoutWriterLabel(t) }));

  // ── T7 ──
  const verdicts = [];
  for (const r of t1) {
    if (r.rider_id === 'SYSTEM' || r.rider_id === '(none)') continue;
    const anomalies = t2.filter((a) => a.rider_id === r.rider_id);
    const mismatches = t3.paidNotEqualFee.filter((p) => p.rider_id === r.rider_id);
    const notCalc = t3.reasonNotCalculated.filter((p) => p.rider_id === r.rider_id);
    const at150 = t3.amount150.filter((p) => p.rider_id === r.rider_id);
    const reasons = [];
    if (anomalies.length) add(reasons, `แถวผิดปกติ ${anomalies.length}`);
    if (mismatches.length) add(reasons, `JOB_PAYOUT ไม่ตรง rider_fee บนงาน ${mismatches.length}`);
    if (notCalc.length) add(reasons, `ค่ารอบจาก fallback (reason ไม่ใช่ calculated) ${notCalc.length}`);
    if (at150.length) add(reasons, `แถว 150 บาท ${at150.length}`);
    if (!r.inRiders) add(reasons, 'rider_id นี้ไม่มีใน /riders');
    add(verdicts, { rider_id: r.rider_id, balance: r.balance, available: r.available, trusted: reasons.length === 0, reasons });
  }
  const decisions = [];
  if (t5.owner.length) add(decisions, `ค่ารอบค้าง Pending กลุ่ม OWNER ${t5.owner.length} ใบ Σ ${fmt(t5.ownerSum)} — จะอนุมัติเข้ากระเป๋าเจ้าของหรือไม่`);
  if (t5.rider.length) add(decisions, `ค่ารอบค้าง Pending กลุ่ม RIDER ${t5.rider.length} ใบ Σ ${fmt(t5.riderSum)} — รออนุมัติที่ /rider-audit`);
  if (t5.noFee.length) add(decisions, `ใบ Pending ที่ไม่มี rider_fee หรือ fee ≤ 0: ${t5.noFee.length} ใบ — ต้องตัดสินฐานเงินก่อนจ่าย`);
  if (t3.paidNotEqualFee.length) add(decisions, `JOB_PAYOUT ที่ยอดไม่ตรง rider_fee บนงาน: ${t3.paidNotEqualFee.length} แถว`);
  if (t3.reasonNotCalculated.length) add(decisions, `JOB_PAYOUT ของงานที่ค่ารอบมาจาก fallback: ${t3.reasonNotCalculated.length} แถว`);
  if (t4.backfillSettle.length) add(decisions, `พบแถว [Backfill Settle] ${t4.backfillSettle.length} แถว — สคริปต์ settle-pending เคย apply`);
  if (t2.length) add(decisions, `แถวผิดปกติใน ledger ${t2.length} แถว (T2)`);
  const wdRequested = wdRows.filter((w) => w.status === 'requested');
  if (wdRequested.length) add(decisions, `คำขอถอนค้าง requested ${wdRequested.length} ใบ`);
  const t6Diff = t6.filter((j) => j.diff !== null && j.diff !== 0);
  if (t6Diff.length) add(decisions, `งานยุคไรเดอร์ที่ยอดใน ledger ≠ rider_fee: ${t6Diff.length} ใบ (T6)`);

  return {
    meta: {
      txRows: rows.length,
      jobs: jobs.length,
      riders: Object.keys(ridersMap).length,
      withdrawals: wdRows.length,
      currentAllowlist,
      legacyAllowlist: LEGACY_ALLOWLIST_2026_08_31,
      ownerRider,
      riderEraStart: RIDER_ERA_START,
      routesKeyFixDate: ROUTES_KEY_FIX_DATE,
    },
    t1,
    ridersWithoutLedger,
    t2,
    t3,
    t4,
    t5,
    t6,
    caseFound,
    casePayoutsWithoutJob,
    t7: { verdicts, decisions },
  };
}

// ─── render ───────────────────────────────────────────────────────────────────

function renderMarkdown(r, ctx) {
  const L = [];
  const p = (s = '') => add(L, s);
  const src = (ctx && ctx.ledgerSource) || { file: '(fixture)', rev: '-' };
  const ranAt = (ctx && ctx.ranAt) || new Date().toISOString();

  p(`# Rider wallet audit (read-only) — ${ranAt}`);
  p();
  p(`- ledger rows: ${r.meta.txRows} · jobs: ${r.meta.jobs} · riders: ${r.meta.riders} · withdrawals: ${r.meta.withdrawals}`);
  p(`- สูตร balance + allowlist: \`${src.file}\` @ \`${src.rev}\` (${r.meta.currentAllowlist.length} หมวด: ${r.meta.currentAllowlist.join(', ')})`);
  p(`- allowlist เดิม 4 หมวด (คอลัมน์เปรียบเทียบ): ${r.meta.legacyAllowlist.join(', ')}`);
  p(`- OWNER rider_id: \`${r.meta.ownerRider}\` · ยุคไรเดอร์เริ่ม ${r.meta.riderEraStart}`);
  p(`- ไม่พิมพ์ชื่อ/เบอร์/เลขบัญชี/description ดิบ — ระบุแถวด้วย key เท่านั้น`);
  p();

  p('## T1 — ต่อ rider_id');
  p();
  p('| rider_id | แถว | แถวที่นับเข้ากระเป๋า | balance (walletLedger) | balance (allowlist 4 เดิม) | ส่วนต่าง | จองค้าง (requested) | ถอนได้ | ใน /riders |');
  p('|---|---|---|---|---|---|---|---|---|');
  for (const x of r.t1) p(`| \`${x.rider_id}\` | ${x.rows} | ${x.walletRows} | ${fmt(x.balance)} | ${fmt(x.balanceLegacy)} | ${fmt(x.diff)} | ${fmt(x.hold)} | ${fmt(x.available)} | ${x.inRiders ? 'ใช่' : 'ไม่'} |`);
  p();
  for (const x of r.t1) {
    p(`<details><summary>\`${x.rider_id}\` — ต่อ category/type</summary>`);
    p();
    p('| category/type | แถว | Σ amount | amount เสีย |');
    p('|---|---|---|---|');
    for (const [k, v] of Object.entries(x.perCategory).sort()) p(`| ${k} | ${v.count} | ${fmt(v.sum)} | ${v.bad || ''} |`);
    p();
    p('</details>');
    p();
  }
  if (r.ridersWithoutLedger.length) p(`ไรเดอร์ใน /riders ที่ไม่มีแถว ledger เลย: ${r.ridersWithoutLedger.map((x) => `\`${x}\``).join(', ')}`);
  p();

  p(`## T2 — แถวผิดปกติ (${r.t2.length} แถว)`);
  p();
  if (!r.t2.length) p('ไม่พบ');
  else {
    p('| key | rider_id | category/type | amount | ref_job_id | ธง |');
    p('|---|---|---|---|---|---|');
    for (const a of r.t2) p(`| \`${a.id}\` | \`${a.rider_id}\` | ${a.category}/${a.type} | ${JSON.stringify(a.amount)} | ${a.ref_job_id ? `\`${a.ref_job_id}\`` : '-'} | ${a.flags.join(', ')} |`);
  }
  p();

  p('## T3 — JOB_PAYOUT');
  p();
  p(`หน้าต่าง: ${r.t3.windowStart} → ${r.t3.windowEnd} (ปลายหน้าต่าง = ${r.t3.windowEnd === r.meta.routesKeyFixDate ? 'วันที่ Routes API key ถูกแก้ ตาม bkk-frontend-next commits 6a8e7c7e/49fed338' : 'ค่าจาก --window-end'})`);
  if (r.t3.windowInverted) p(`**ปลายหน้าต่างอยู่ก่อนต้นหน้าต่าง — หน้าต่างนี้ว่างโดยนิยาม** (คีย์ถูกแก้ ${r.meta.routesKeyFixDate} ก่อน ${r.t3.windowStart}) ใช้ --window-end เพื่อลองช่วงอื่น`);
  p();
  const payoutTable = (title, list) => {
    p(`### ${title} (${list.length})`);
    p();
    if (!list.length) {
      p('ไม่พบ');
      p();
      return;
    }
    p('| key | rider_id | ref_job_id | amount | rider_fee บนงาน | meta.reason | เวลา | ผู้เขียน (อนุมาน) |');
    p('|---|---|---|---|---|---|---|---|');
    for (const x of list) p(`| \`${x.id}\` | \`${x.rider_id}\` | ${x.ref_job_id ? `\`${x.ref_job_id}\`` : '-'} | ${fmt(x.amount)} | ${fmt(x.fee_on_job)} | ${x.reason} | ${fmtBkk(x.at)} | ${x.writer} |`);
    p();
  };
  payoutTable('amount = 150 เป๊ะ', r.t3.amount150);
  payoutTable('timestamp ในหน้าต่าง', r.t3.inWindow);
  payoutTable('งานที่ค่ารอบมาจาก fallback (meta.reason ไม่ใช่ calculated)', r.t3.reasonNotCalculated);
  payoutTable('amount ไม่เท่า rider_fee บนงาน', r.t3.paidNotEqualFee);

  p('## T4 — WITHDRAWAL และร่องรอย settle-pending');
  p();
  p(`- แถว WITHDRAWAL ใน /transactions: **${r.t4.withdrawalTotal}** (DEBIT ${r.t4.withdrawalDebit} · CREDIT ${r.t4.withdrawalCredit})${r.t4.withdrawalIds.length ? ` — key: ${r.t4.withdrawalIds.map((x) => `\`${x}\``).join(', ')}` : ''}`);
  p(`- /withdrawals: ${r.t4.withdrawalsNode.total} ใบ (requested ${r.t4.withdrawalsNode.requested} · paid ${r.t4.withdrawalsNode.paid} · rejected ${r.t4.withdrawalsNode.rejected} · อื่น ${r.t4.withdrawalsNode.other})`);
  p(`- แถวที่ description มี \`[Backfill Settle]\`: **${r.t4.backfillSettle.length}** → ${r.t4.backfillSettle.length === 0 ? 'settle-pending-rider-fees.cjs ไม่เคยถูก apply' : 'settle-pending-rider-fees.cjs เคยถูก apply'}`);
  for (const x of r.t4.backfillSettle) p(`  - \`${x.id}\` rider \`${x.rider_id}\` amount ${fmt(x.amount)} job \`${x.ref_job_id ?? '-'}\``);
  p(`- แถวที่ description มี \`[Batch]\` (ปุ่ม batch รุ่นเก่า): ${r.t4.batchTagged}`);
  p();

  p('## T5 — ใบที่ rider_fee_status = Pending');
  p();
  p('"วันที่งานเกิด" = `completed_at` ถ้ามี (ค่ารอบเกิดตอนส่งมอบ — `onJobHandedOverCalcRiderFee` คำนวณตอนนั้น และคนที่วิ่งงานคือคนที่ปิดงาน) ไม่มีจึงตกไป `created_at`. คอลัมน์ "ป้ายไม่ตรง" = rider_id ของงานไม่สอดคล้องกับกลุ่มตามวันที่');
  p();
  const pendingTable = (title, list, sum) => {
    p(`### ${title} — ${list.length} ใบ Σ ${fmt(sum)}`);
    p();
    if (!list.length) {
      p('ไม่พบ');
      p();
      return;
    }
    p('| job_id | ref_no | rider_id | rider_fee | วันที่ (ฟิลด์) | status | ป้ายไม่ตรง |');
    p('|---|---|---|---|---|---|---|');
    for (const j of list) p(`| \`${j.job_id}\` | ${j.ref_no} | \`${j.rider_id}\` | ${fmt(j.fee)} | ${fmtBkk(j.date)} (${j.dateField}) | ${j.status} | ${j.labelMismatch ? 'ใช่' : ''} |`);
    p();
  };
  pendingTable(`OWNER (ก่อน ${r.meta.riderEraStart})`, r.t5.owner, r.t5.ownerSum);
  pendingTable(`RIDER (ตั้งแต่ ${r.meta.riderEraStart})`, r.t5.rider, r.t5.riderSum);
  p(`### ไม่มี rider_fee หรือ fee ≤ 0 — ${r.t5.noFee.length} ใบ`);
  p();
  if (!r.t5.noFee.length) p('ไม่พบ');
  else {
    p('| job_id | ref_no | rider_id | rider_fee | วันที่ (ฟิลด์) | status | receive_method |');
    p('|---|---|---|---|---|---|---|');
    for (const j of r.t5.noFee) p(`| \`${j.job_id}\` | ${j.ref_no} | \`${j.rider_id}\` | ${JSON.stringify(j.fee)} | ${fmtBkk(j.date)} (${j.dateField}) | ${j.status} | ${j.receive_method} |`);
  }
  p();
  if (r.t5.undated.length) {
    p(`### มี fee แต่ไม่มีวันที่ (จัดกลุ่มไม่ได้) — ${r.t5.undated.length} ใบ`);
    p();
    for (const j of r.t5.undated) p(`- \`${j.job_id}\` ${j.ref_no} rider \`${j.rider_id}\` fee ${fmt(j.fee)}`);
    p();
  }

  p(`## T6 — งาน ${CASE_JOB_REF} และงานยุคไรเดอร์ (rider_id ≠ OWNER, ตั้งแต่ ${r.meta.riderEraStart})`);
  p();
  if (!r.caseFound) {
    p(`งาน ${CASE_JOB_REF} (\`${CASE_JOB_ID}\`) **ไม่อยู่ใน /jobs** (อาจถูก archive)${r.casePayoutsWithoutJob.length ? ` — แต่มีแถว JOB_PAYOUT ชี้มา: ${r.casePayoutsWithoutJob.map((x) => `\`${x.id}\` ${fmt(x.amount)} (${x.writer})`).join(', ')}` : ''}`);
    p();
  }
  if (!r.t6.length) p('ไม่พบงานเข้าเงื่อนไข');
  else {
    p('| job_id | ref_no | rider_id | วันที่ | rider_fee | estimate | fee_status | meta.reason | km (meta/estimate) | JOB_PAYOUT (amount · ผู้เขียน · เวลา) | ADJUSTMENT | Σ ledger − rider_fee |');
    p('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const j of r.t6) {
      const payouts = j.payouts.length ? j.payouts.map((x) => `${fmt(x.amount)} · ${x.writer} · ${fmtBkk(x.at)}`).join('<br>') : '—';
      const adjs = j.adjustments.length ? j.adjustments.map((x) => `${x.type} ${fmt(x.amount)} · ${fmtBkk(x.at)}`).join('<br>') : '—';
      p(`| \`${j.job_id}\` | ${j.ref_no} | \`${j.rider_id}\` | ${fmtBkk(j.date)} | ${fmt(j.rider_fee)} | ${fmt(j.rider_fee_estimate)} | ${j.rider_fee_status} | ${j.meta_reason ?? '-'} | ${fmt(j.meta_distance_km)} / ${fmt(j.estimate_distance_km)} | ${payouts} | ${adjs} | ${j.diff === null ? '-' : fmt(j.diff)} |`);
    }
    p();
    const withApprover = r.t6.filter((j) => j.approved_by);
    if (withApprover.length) p(`rider_fee_approved_by (uid): ${withApprover.map((j) => `\`${j.job_id}\` → \`${j.approved_by}\``).join(' · ')}`);
    const withDispute = r.t6.filter((j) => j.pin_dispute);
    if (withDispute.length) p(`pin_dispute: ${withDispute.map((j) => `\`${j.job_id}\` ${j.pin_dispute.status} ${fmt(j.pin_dispute.fee_before)}→${fmt(j.pin_dispute.fee_after)}`).join(' · ')}`);
  }
  p();

  p('## T7 — สรุป');
  p();
  for (const v of r.t7.verdicts) p(`- \`${v.rider_id}\`: balance ${fmt(v.balance)} / ถอนได้ ${fmt(v.available)} — ${v.trusted ? 'เชื่อได้ (ไม่มีแถวผิดปกติ, JOB_PAYOUT ตรง rider_fee ทุกใบ)' : `ต้องดู: ${v.reasons.join(' · ')}`}`);
  if (!r.t7.verdicts.length) p('- ไม่มี rider_id ที่ไม่ใช่ SYSTEM ใน ledger');
  p('- รายการที่ต้องมีคนตัดสินใจ:');
  if (!r.t7.decisions.length) p('  - ไม่มี');
  for (const d of r.t7.decisions) p(`  - ${d}`);
  p();
  return L.join('\n');
}

// ─── IO ───────────────────────────────────────────────────────────────────────

function usage() {
  return fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const riderAppDir = resolveRiderAppDir(args.riderApp);
  if (!riderAppDir) {
    throw new Error(
      'หา bkk-rider-app/src/utils/walletLedger.ts ไม่เจอ — ใส่ --rider-app <dir> หรือตั้ง BKK_RIDER_APP_DIR ' +
        '(สคริปต์ไม่มีสูตรสำรองโดยตั้งใจ: เลขที่ไม่ได้มาจากโค้ดของแอปคือเลขที่เทียบกับจอไม่ได้)',
    );
  }
  const { ledger, source } = loadWalletLedger(riderAppDir);

  // require ตรงนี้เพื่อให้ส่วน pure ถูกเทสได้โดยไม่มี firebase-admin
  const admin = require(path.join(REPO_ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    const credential = args.serviceAccount
      ? admin.credential.cert(require(path.resolve(args.serviceAccount)))
      : admin.credential.applicationDefault();
    admin.initializeApp({ credential, databaseURL: process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL });
  }
  const db = admin.database();

  console.error('[rider-wallet-audit] READ-ONLY — อ่าน /transactions /jobs /riders /withdrawals อย่างละครั้ง');
  const [txSnap, jobsSnap, ridersSnap, wdSnap] = await Promise.all([
    db.ref('transactions').once('value'),
    db.ref('jobs').once('value'),
    db.ref('riders').once('value'),
    db.ref('withdrawals').once('value'),
  ]);
  const tx = txSnap.val() || {};
  const jobs = jobsSnap.val() || {};

  // ref_job_id ที่ไม่อยู่ใน /jobs และไม่ใช่ id ของ /withdrawals → เช็ค archive ทีละใบ (subpath เล็ก)
  const wdIds = new Set(Object.keys(wdSnap.val() || {}));
  const missing = [];
  const seenMissing = new Set();
  for (const t of Object.values(tx)) {
    const ref = t && t.ref_job_id;
    if (!ref || jobs[ref] || wdIds.has(ref) || seenMissing.has(ref)) continue;
    seenMissing.add(ref);
    add(missing, ref);
  }
  const archivedFound = new Set();
  const toCheck = missing.slice(0, ARCHIVE_LOOKUP_CAP);
  for (const id of toCheck) {
    const s = await db.ref(`jobs_archived/${id}/ref_no`).once('value');
    if (s.exists()) archivedFound.add(id);
  }
  if (missing.length > toCheck.length) {
    console.error(`[rider-wallet-audit] ref_job_id ที่ไม่อยู่ใน /jobs มี ${missing.length} ใบ เช็ค archive แค่ ${toCheck.length} ใบแรก`);
  }

  const ranAt = new Date().toISOString();
  const report = analyze({
    tx,
    jobs,
    riders: ridersSnap.val() || {},
    withdrawals: wdSnap.val() || {},
    archivedFound,
    ledger,
    opts: { windowEnd: args.windowEnd, ownerRider: args.ownerRider },
  });
  const md = renderMarkdown(report, { ledgerSource: source, ranAt });

  const outFile = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, 'docs', 'reports', `rider-wallet-audit-${ranAt.replace(/[:.]/g, '-')}.md`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, md);

  process.stdout.write(md);
  console.error(`\n[rider-wallet-audit] เขียนรายงานที่ ${outFile}`);
  process.exit(0);
}

module.exports = {
  analyze,
  renderMarkdown,
  loadWalletLedger,
  resolveRiderAppDir,
  parseArgs,
  payoutWriterLabel,
  jobDate,
  bkkDayStartMs,
  bkkDayEndMs,
  LEGACY_ALLOWLIST_2026_08_31,
  EXPECTED_TYPE,
  ROUTES_KEY_FIX_DATE,
  WINDOW_START,
  RIDER_ERA_START,
  DEFAULT_OWNER_RIDER,
  CASE_JOB_REF,
  CASE_JOB_ID,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('[rider-wallet-audit] ล้มเหลว:', e && e.message ? e.message : e);
    process.exit(1);
  });
}
