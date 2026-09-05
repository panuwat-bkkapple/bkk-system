#!/usr/bin/env node
/**
 * กลับรายการค่ารอบที่เข้ากระเป๋าไรเดอร์ของ "บัญชีเจ้าของบริษัท" (5 ก.ย. 2569)
 *
 * กติกา: เจ้าของต้องไม่มีค่ารอบเข้ากระเป๋าไรเดอร์เลย ไม่ว่างานวันไหน — แต่ปุ่ม batch
 * รุ่นเก่า + การอนุมัติจาก UI เขียน JOB_PAYOUT ให้บัญชีนั้นไป 129 แถว (Σ ~45,659) และ
 * งาน Store-in/Mail-in ที่ trigger คิดค่ารอบขั้นต่ำให้โดยไม่มีไรเดอร์ค้าง Pending อยู่
 * (survey: docs/reports/2026-09-05-owner-rider-wallet-reversal-survey.md)
 *
 *   OWNER_RIDER_IDS=<uid> node scripts/reverse-owner-rider-payouts.cjs --rider <uid>            # dry-run
 *   OWNER_RIDER_IDS=<uid> node scripts/reverse-owner-rider-payouts.cjs --rider <uid> --apply
 *
 *   ตัวเลือก:
 *     --rider <uid>              บังคับ และ **ต้องอยู่ใน env OWNER_RIDER_IDS** (ค่าเดียวกับที่ตั้งบน
 *                                functions) ไม่รับ uid อื่น — สคริปต์นี้กลับรายการได้เฉพาะบัญชีเจ้าของ
 *     --apply                    เขียนจริง (ไม่ใส่ = dry-run พิมพ์แผนอย่างเดียว)
 *     --service-account <file>   ไม่ใส่ = GOOGLE_APPLICATION_CREDENTIALS
 *     --rider-app <dir>          checkout ของ bkk-rider-app (ค่าเริ่มต้น ../bkk-rider-app) — balance
 *                                ก่อน/หลังคำนวณด้วย walletLedger.ts ตัวจริงของแอป ไม่ใช่สูตรในสคริปต์
 *
 * สิ่งที่เขียน (multi-path update ก้อนเดียว = atomic):
 *   1. ต่อแถว JOB_PAYOUT/CREDIT ของ OWNER ทุกแถว → แถวคู่กลับ `transactions/<key ใหม่>`:
 *      category ADJUSTMENT · type DEBIT · amount เท่ากัน · taxable:false · ref_job_id เดิม ·
 *      meta { reason:'owner_run_reversal', reverses:<key แถวเดิม>, reversed_at, reversed_by:'script' }
 *      **ไม่ลบ ไม่แก้แถวเดิม** — ledger เป็น append-only ตามกติกาของระบบ (ผิดยอด = ลงแถวชดเชย)
 *   2. งานที่แถวเหล่านั้นชี้ + สถานะ Paid → rider_fee_status 'Waived' reason 'owner_run'
 *   3. งาน Pending ของ OWNER (rider_id หรือ cancelled_by rider:<uid>) → 'Waived' reason 'owner_run'
 *   4. งาน Pending ที่ไม่มีไรเดอร์เลย → 'Waived' reason 'no_rider'
 *   ทุกข้อ **ไม่แตะ rider_fee** (ตัวเลขที่เคยคิดต้องย้อนดูได้) และเติม qc_logs ให้ Traceability เห็น
 *
 * กันรันซ้ำ: แถวที่มีคู่กลับแล้ว (มีแถว ADJUSTMENT ที่ meta.reverses ชี้มา) ถูกข้าม และงานที่
 * Waived แล้วไม่ถูกเขียนซ้ำ — รันสองรอบได้แถวกลับชุดเดียว (เทส: functions/test/reverse-owner-rider-payouts.test.mjs)
 *
 * ADJUSTMENT คู่เดิมของ OWNER (CREDIT/DEBIT เท่ากันหักกันเป็นศูนย์ — audit T6) ปล่อยไว้
 *
 * แถวกลับเป็น DEBIT หมวด ADJUSTMENT ซึ่ง walletBalance ของแอปไรเดอร์นับลบ และตัวแยกฐานภาษี
 * ตอนถอน (rider-cost-split.js) มองข้าม DEBIT ที่ไม่ใช่ WITHDRAWAL — `taxable:false` จึงเป็น
 * ป้ายบอกคนอ่าน ไม่ใช่ตัวเปลี่ยนการคำนวณ
 *
 * ลำดับที่ต้องทำก่อนรัน --apply: deploy functions (B1/B5) + deploy แอปไรเดอร์ (ตัวเขียน Pending ไม่ทับ
 * ปลายทาง) ไม่งั้นใบที่ Waived ไปแล้วอาจถูกเขียน Pending กลับ
 */
'use strict';

const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..');
const { ownerRiderIdsFromEnv, OWNER_RIDER_IDS_ENV, payoutRiderIdOf } = require(path.join(REPO_ROOT, 'functions', 'rider-fee-guard.js'));
const { RIDER_FEE_STATUS } = require(path.join(REPO_ROOT, 'functions', 'rider-fee-status.js'));
const { loadWalletLedger, resolveRiderAppDir } = require(path.join(REPO_ROOT, 'scripts', 'rider-wallet-audit.cjs'));

const DEFAULT_DATABASE_URL = 'https://bkk-apple-tradein-default-rtdb.asia-southeast1.firebasedatabase.app';
const REVERSAL_REASON = 'owner_run_reversal';
const WAIVE_REASON = { owner: 'owner_run', noRider: 'no_rider' };
const SCRIPT_ACTOR = 'script';

// ─── pure ─────────────────────────────────────────────────────────────────────

function finiteOrNull(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** แถว JOB_PAYOUT CREDIT ของไรเดอร์คนนี้ (ตัวที่ต้องกลับ) */
function ownerPayoutRows(transactions, riderId) {
  return Object.entries(transactions || {})
    .filter(([, t]) => t && t.rider_id === riderId && t.category === 'JOB_PAYOUT' && t.type === 'CREDIT')
    .map(([key, t]) => ({ key, ...t }));
}

/** key ของแถวเดิมที่มีคู่กลับอยู่แล้ว — อ่านจาก meta.reverses ของแถวกลับที่เคยเขียน */
function alreadyReversedKeys(transactions) {
  const set = new Set();
  for (const t of Object.values(transactions || {})) {
    if (t && t.category === 'ADJUSTMENT' && t.type === 'DEBIT' && t.meta && t.meta.reason === REVERSAL_REASON && t.meta.reverses) {
      set.add(String(t.meta.reverses));
    }
  }
  return set;
}

function existingLogs(job) {
  const raw = job && job.qc_logs;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}

/** Paid/Pending → Waived — ไม่แตะ rider_fee, เติม qc_logs; คืน null เมื่อ Waived อยู่แล้ว */
function waiveUpdates(job, reason, now) {
  if (!job || !job.id) return null;
  if (job.rider_fee_status === RIDER_FEE_STATUS.WAIVED) return null;
  const base = `jobs/${job.id}`;
  const fee = finiteOrNull(job.rider_fee);
  return {
    [`${base}/rider_fee_status`]: RIDER_FEE_STATUS.WAIVED,
    [`${base}/rider_fee_waived_reason`]: reason,
    [`${base}/rider_fee_waived_at`]: now,
    [`${base}/rider_fee_waived_by`]: SCRIPT_ACTOR,
    [`${base}/updated_at`]: now,
    [`${base}/qc_logs`]: [
      {
        action: 'Rider Fee Waived',
        by: SCRIPT_ACTOR,
        timestamp: now,
        details: `ยกเว้นค่ารอบ${fee !== null ? ` ฿${fee}` : ''} (เดิม ${job.rider_fee_status || '-'}) — ${reason} · scripts/reverse-owner-rider-payouts.cjs`,
      },
      ...existingLogs(job),
    ],
  };
}

/**
 * วางแผนทั้งหมด — pure. คืน { updates, ...สรุป } ไม่แตะ I/O
 *
 * @param {object} p
 * @param {Record<string, any>} p.transactions  /transactions ทั้งก้อน (key → แถว)
 * @param {Record<string, any>} p.jobs          /jobs ทั้งก้อน (id → งาน, ต้องมี id ในตัวหรือใช้ key)
 * @param {string} p.riderId                    บัญชีเจ้าของที่จะกลับรายการ
 * @param {Set<string>} p.ownerRiderIds         รายชื่อเจ้าของจาก env — riderId ต้องอยู่ในนี้
 * @param {number} p.now
 * @param {() => string} p.newKey               ผู้เรียกจอง key (push().key ตอนจริง / key จำลองตอนเทส)
 */
function planReversal({ transactions, jobs, riderId, ownerRiderIds, now, newKey }) {
  if (!riderId || !ownerRiderIds || !ownerRiderIds.has(riderId)) {
    throw new Error(`--rider ${riderId || '(ว่าง)'} ไม่อยู่ใน ${OWNER_RIDER_IDS_ENV} — สคริปต์นี้กลับรายการได้เฉพาะบัญชีเจ้าของ`);
  }
  const jobList = Object.entries(jobs || {}).map(([id, j]) => ({ ...(j || {}), id: (j && j.id) || id }));
  const jobById = Object.fromEntries(jobList.map((j) => [j.id, j]));

  const updates = {};
  const reversals = [];
  const skippedRows = [];
  const done = alreadyReversedKeys(transactions);
  let alreadyReversed = 0;
  const payoutRows = ownerPayoutRows(transactions, riderId);

  for (const row of payoutRows) {
    if (done.has(row.key)) { alreadyReversed += 1; continue; }
    const amount = finiteOrNull(row.amount);
    if (amount === null || amount <= 0) { skippedRows.push({ key: row.key, reason: 'bad_amount', amount: row.amount }); continue; }
    const key = newKey();
    const job = row.ref_job_id ? jobById[row.ref_job_id] : null;
    updates[`transactions/${key}`] = {
      rider_id: riderId,
      amount,
      type: 'DEBIT',
      category: 'ADJUSTMENT',
      taxable: false,
      description: `กลับรายการค่ารอบบัญชีเจ้าของ (${(job && job.ref_no) || row.ref_job_id || '-'})`,
      timestamp: now,
      ref_job_id: row.ref_job_id || null,
      meta: { reason: REVERSAL_REASON, reverses: row.key, reversed_at: now, reversed_by: SCRIPT_ACTOR },
    };
    reversals.push({ key, reverses: row.key, amount, ref_job_id: row.ref_job_id || null });
  }

  // งาน: (2) Paid ที่แถว OWNER ชี้ — รวมแถวที่กลับไปแล้วรอบก่อน (เผื่องานยังค้าง Paid)
  const waived = { owner_paid: [], owner_pending: [], no_rider: [] };
  const touched = new Set();
  const waive = (job, reason, bucket) => {
    if (!job || touched.has(job.id)) return;
    const u = waiveUpdates(job, reason, now);
    if (!u) return;
    Object.assign(updates, u);
    touched.add(job.id);
    waived[bucket].push({ job_id: job.id, ref_no: job.ref_no || '-', from: job.rider_fee_status || '-', rider_fee: finiteOrNull(job.rider_fee) });
  };
  for (const row of payoutRows) {
    const job = row.ref_job_id ? jobById[row.ref_job_id] : null;
    if (job && job.rider_fee_status === RIDER_FEE_STATUS.PAID) waive(job, WAIVE_REASON.owner, 'owner_paid');
  }
  // (3) Pending ของ OWNER และ (4) Pending ที่ไม่มีไรเดอร์
  for (const job of jobList) {
    if (job.rider_fee_status !== RIDER_FEE_STATUS.PENDING) continue;
    const who = payoutRiderIdOf(job);
    if (who === riderId) waive(job, WAIVE_REASON.owner, 'owner_pending');
    else if (who === null) waive(job, WAIVE_REASON.noRider, 'no_rider');
  }

  const sumAmount = reversals.reduce((s, r) => s + r.amount, 0);
  return {
    updates,
    reversals,
    skippedRows,
    alreadyReversed,
    payoutRowCount: payoutRows.length,
    sumAmount: Math.round(sumAmount * 100) / 100,
    waived,
    pathCount: Object.keys(updates).length,
  };
}

/** balance ก่อน/หลัง ด้วย walletLedger.ts ตัวจริงของแอปไรเดอร์ */
function balanceBeforeAfter(ledger, transactions, updates, riderId) {
  const rows = Object.values(transactions || {}).filter((t) => t && t.rider_id === riderId && ledger.isRiderWalletTx(t));
  const added = Object.entries(updates)
    .filter(([k]) => k.startsWith('transactions/'))
    .map(([, v]) => v)
    .filter((t) => t.rider_id === riderId && ledger.isRiderWalletTx(t));
  return { before: ledger.walletBalance(rows), after: ledger.walletBalance(rows.concat(added)), rowsBefore: rows.length, rowsAdded: added.length };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { apply: false, rider: null, serviceAccount: null, riderApp: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => { i += 1; return argv[i]; };
    if (a === '--apply') out.apply = true;
    else if (a === '--rider') out.rider = next();
    else if (a === '--service-account') out.serviceAccount = next();
    else if (a === '--rider-app') out.riderApp = next();
    else throw new Error(`ไม่รู้จักตัวเลือก ${a}`);
  }
  if (!out.rider) throw new Error('ต้องระบุ --rider <uid> (ต้องตรงกับค่าใน env OWNER_RIDER_IDS)');
  return out;
}

const fmt = (n) => Number(n).toLocaleString('th-TH');

function printPlan(plan, balance, apply) {
  const p = (s = '') => console.log(s);
  p(`# reverse-owner-rider-payouts — ${apply ? 'APPLY' : 'DRY-RUN'}`);
  p();
  p(`แถว JOB_PAYOUT/CREDIT ของ OWNER ทั้งหมด: ${plan.payoutRowCount}`);
  p(`  - มีคู่กลับอยู่แล้ว (ข้าม): ${plan.alreadyReversed}`);
  p(`  - amount ใช้ไม่ได้ (ข้าม): ${plan.skippedRows.length}${plan.skippedRows.length ? ' ' + JSON.stringify(plan.skippedRows) : ''}`);
  p(`  - จะเขียนแถวกลับ (ADJUSTMENT/DEBIT): ${plan.reversals.length}  Σ amount = ${fmt(plan.sumAmount)}`);
  p();
  p(`งานที่จะเป็น Waived: Paid→Waived (owner_run) ${plan.waived.owner_paid.length} · Pending→Waived (owner_run) ${plan.waived.owner_pending.length} · Pending→Waived (no_rider) ${plan.waived.no_rider.length}`);
  p(`path ทั้งหมดใน update ก้อนเดียว: ${plan.pathCount}`);
  p();
  p(`balance OWNER (walletLedger.ts ของแอปไรเดอร์): ก่อน ${fmt(balance.before)} → หลัง ${fmt(balance.after)}  (แถวเดิม ${balance.rowsBefore} + แถวใหม่ ${balance.rowsAdded})`);
  if (balance.after !== 0) p(`  !! balance หลังกลับรายการไม่ใช่ 0 — มีแถวหมวดอื่นของ OWNER ที่ไม่ใช่ JOB_PAYOUT (ดู T1/T6 ของ rider-wallet-audit) สคริปต์นี้ไม่แตะแถวเหล่านั้น`);
  p();
  for (const [bucket, rows] of Object.entries(plan.waived)) {
    p(`## ${bucket} (${rows.length})`);
    for (const r of rows) p(`  ${r.job_id}  ${r.ref_no}  จาก ${r.from}  rider_fee ${r.rider_fee === null ? '-' : fmt(r.rider_fee)}`);
  }
  p();
  p(`## แถวกลับ (${plan.reversals.length})`);
  for (const r of plan.reversals) p(`  ${r.key}  reverses ${r.reverses}  ${fmt(r.amount)}  job ${r.ref_job_id || '-'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ownerIds = ownerRiderIdsFromEnv();
  if (ownerIds.size === 0) throw new Error(`env ${OWNER_RIDER_IDS_ENV} ยังไม่ตั้ง — ตั้งค่าเดียวกับที่ตั้งบน functions ก่อนรัน`);
  if (!ownerIds.has(args.rider)) throw new Error(`--rider ${args.rider} ไม่อยู่ใน ${OWNER_RIDER_IDS_ENV}`);

  const riderAppDir = resolveRiderAppDir(args.riderApp);
  if (!riderAppDir) throw new Error('หา bkk-rider-app ไม่เจอ — ระบุ --rider-app <dir> (balance ต้องมาจาก walletLedger.ts ของแอป)');
  const { ledger, source } = loadWalletLedger(riderAppDir);

  const admin = require(path.join(REPO_ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    const credential = args.serviceAccount
      ? admin.credential.cert(require(path.resolve(args.serviceAccount)))
      : admin.credential.applicationDefault();
    admin.initializeApp({ credential, databaseURL: process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL });
  }
  const db = admin.database();

  console.error(`[reverse-owner] อ่าน /transactions และ /jobs อย่างละครั้ง (walletLedger @ ${source.rev})`);
  const [txSnap, jobsSnap] = await Promise.all([db.ref('transactions').once('value'), db.ref('jobs').once('value')]);
  const transactions = txSnap.val() || {};
  const jobs = jobsSnap.val() || {};

  const now = Date.now();
  const plan = planReversal({
    transactions, jobs, riderId: args.rider, ownerRiderIds: ownerIds, now,
    newKey: () => db.ref('transactions').push().key,
  });
  const balance = balanceBeforeAfter(ledger, transactions, plan.updates, args.rider);
  printPlan(plan, balance, args.apply);

  if (!args.apply) {
    console.log('\nDRY-RUN จบ — ไม่ได้เขียนอะไร ตรวจแล้วรันซ้ำด้วย --apply');
    return;
  }
  if (plan.pathCount === 0) {
    console.log('\nไม่มีอะไรต้องเขียน (รันไปแล้วครบ)');
    return;
  }
  await db.ref().update(plan.updates);
  console.log(`\nAPPLY สำเร็จ: เขียน ${plan.pathCount} path ในธุรกรรมเดียว — ยืนยันด้วย node scripts/rider-wallet-audit.cjs (OWNER balance 0 · T5 owner 0 · no-rider 0)`);
}

module.exports = {
  planReversal,
  waiveUpdates,
  ownerPayoutRows,
  alreadyReversedKeys,
  balanceBeforeAfter,
  parseArgs,
  REVERSAL_REASON,
  WAIVE_REASON,
  SCRIPT_ACTOR,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('[reverse-owner] ล้มเหลว:', e && e.message ? e.message : e);
    process.exit(1);
  });
}
