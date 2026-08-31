#!/usr/bin/env node
/**
 * เฟส 0 ของแผนแก้กระเป๋าเงินไรเดอร์ — วัดความเสียหายจริงจาก ledger (READ-ONLY)
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   FIREBASE_DATABASE_URL=https://<db>.asia-southeast1.firebasedatabase.app \
 *     node scripts/audit-rider-wallet.cjs            # พิมพ์รายงานอย่างเดียว
 *     node scripts/audit-rider-wallet.cjs --json=out.json   # + เขียนผลดิบเป็นไฟล์
 *
 * สคริปต์นี้ "ไม่มีโหมดเขียน" โดยตั้งใจ — เฟส 0 คือการวัด ไม่ใช่การแก้
 * (ตัว backfill เป็นสคริปต์แยกของเฟส 3 และต้องมี dry-run ของตัวเอง)
 *
 * สิ่งที่รายงาน (อ้างอิงแผน docs/reports/2026-08-31-rider-wallet-fix-plan.md
 * ใน bkk-rider-app, หัวข้อ "เฟส 0"):
 *   1. ต่อ rider: ยอดแยกตาม category + balance สูตรเดิมของแอป (รวมทุกหมวด,
 *      เลียนแบบ useRiderData.ts:154 เป๊ะ รวมพฤติกรรม NaN) เทียบสูตรใหม่
 *      (allowlist หมวดเงินไรเดอร์ + Number.isFinite) → คอลัมน์ "ส่วนที่บวม"
 *      ตัวเลขคู่นี้คือ X (ยอดเดิม) / Y (ยอดใหม่) ในข้อความสื่อสารเฟส 5
 *   2. แถว LOGISTICS_REVENUE ที่ rider_id !== 'SYSTEM' (เป้า backfill เฟส 3)
 *   3. แถวผิดปกติ: amount ไม่ใช่ตัวเลข / ขาดฟิลด์บังคับ
 *   4. ความถูกเชิงตัวเลขของ JOB_PAYOUT: แถว amount === 150 เป๊ะ (ร่องรอย
 *      fallback ตอน settle — RiderSettlements.tsx) + join ref_job_id →
 *      jobs/{id}/rider_fee_meta.reason (fallback jobs_archived) เพื่อชี้รายใบ
 *      ว่าค่ารอบคิดจากระยะจริง ('calculated') หรือ fallback min_fee
 *   5. ยืนยันสมมุติฐานเฟส 4: จำนวนแถว WITHDRAWAL ใน /transactions,
 *      เนื้อใน /withdrawals, แถว /jobs ที่ type === 'Withdrawal' — คาดว่าศูนย์ทั้งสาม
 *
 * หมายเหตุค่า RTDB: อ่าน /transactions ทั้ง node หนึ่งครั้ง (one-off รันมือ —
 * ข้อยกเว้นแบบเดียวกับ strip-ledger-emails.cjs ตาม CLAUDE.md) ส่วน join ไป
 * jobs อ่านเฉพาะ subpath `rider_fee_meta` + `rider_fee` รายใบ ไม่ดึง job เต็มก้อน
 */
'use strict';

const path = require('path');

// หมวดเงินไรเดอร์ — MIRROR ของ allowlist ที่เฟส 1 จะใช้ใน bkk-rider-app
// (ชุดเดียวกับ type ที่ประกาศใน bkk-rider-app/src/utils/transactionLogger.ts:11)
const RIDER_WALLET_CATEGORIES = new Set(['JOB_PAYOUT', 'WITHDRAWAL', 'PENALTY', 'BONUS']);
const REQUIRED_FIELDS = ['rider_id', 'amount', 'type', 'category'];

/** สูตร balance เดิมของแอปไรเดอร์ (bkk-rider-app/src/hooks/useRiderData.ts:154)
 *  — จงใจเลียนแบบทั้งจุดอ่อน: ไม่กรอง category และ NaN ทะลุเข้าไปได้ */
function legacyBalance(rows) {
  return rows.reduce(
    (acc, t) => (t.type === 'CREDIT' ? acc + Number(t.amount) : acc - Number(t.amount)),
    0,
  );
}

/** สูตรใหม่ตามเฟส 1: allowlist + Number.isFinite */
function allowlistBalance(rows) {
  return rows.reduce((acc, t) => {
    if (!RIDER_WALLET_CATEGORIES.has(t.category)) return acc;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) return acc;
    return t.type === 'CREDIT' ? acc + amt : acc - amt;
  }, 0);
}

/**
 * ส่วนวิเคราะห์ pure — รับ transactions map ตรงจาก snapshot.val()
 * แยกจาก IO เพื่อให้ smoke-test ได้โดยไม่ต้องต่อ Firebase
 */
function analyzeTransactions(txMap) {
  const rows = Object.entries(txMap || {}).map(([id, v]) => ({ id, ...(v || {}) }));

  const byRider = new Map(); // rider_id -> rows
  const anomalies = { badAmount: [], missingFields: [] };
  const logisticsMistagged = []; // LOGISTICS_REVENUE ที่ rider_id !== 'SYSTEM'
  const jobPayout150 = [];
  const jobPayoutRows = [];
  const withdrawalRows = [];

  for (const t of rows) {
    for (const f of REQUIRED_FIELDS) {
      if (t[f] === undefined || t[f] === null || t[f] === '') {
        anomalies.missingFields.push({ id: t.id, missing: f, category: t.category ?? null });
        break;
      }
    }
    if (!Number.isFinite(Number(t.amount))) {
      anomalies.badAmount.push({ id: t.id, amount: t.amount ?? null, category: t.category ?? null, rider_id: t.rider_id ?? null });
    }

    const rid = String(t.rider_id ?? '(none)');
    if (!byRider.has(rid)) byRider.set(rid, []);
    byRider.get(rid).push(t);

    if (t.category === 'LOGISTICS_REVENUE' && rid !== 'SYSTEM') {
      logisticsMistagged.push({ id: t.id, rider_id: rid, amount: Number(t.amount) || 0, ref_job_id: t.ref_job_id ?? null, timestamp: t.timestamp ?? null });
    }
    if (t.category === 'JOB_PAYOUT') {
      jobPayoutRows.push(t);
      if (Number(t.amount) === 150) {
        jobPayout150.push({ id: t.id, rider_id: rid, ref_job_id: t.ref_job_id ?? null, timestamp: t.timestamp ?? null });
      }
    }
    if (t.category === 'WITHDRAWAL') withdrawalRows.push({ id: t.id, rider_id: rid, amount: t.amount ?? null });
  }

  const riderReport = [];
  for (const [rid, riderRows] of byRider.entries()) {
    const perCategory = {};
    for (const t of riderRows) {
      const key = `${t.category ?? '(none)'}/${t.type ?? '(none)'}`;
      const amt = Number(t.amount);
      if (!perCategory[key]) perCategory[key] = { count: 0, sum: 0, hasBadAmount: false };
      perCategory[key].count += 1;
      if (Number.isFinite(amt)) perCategory[key].sum += amt;
      else perCategory[key].hasBadAmount = true;
    }
    const legacy = legacyBalance(riderRows);
    const clean = allowlistBalance(riderRows);
    riderReport.push({
      rider_id: rid,
      rows: riderRows.length,
      perCategory,
      balance_legacy: legacy, // X — เลขที่จอแอปโชว์วันนี้ (NaN ได้ ถ้ามีแถวเสีย)
      balance_allowlist: clean, // Y — เลขหลังเฟส 1
      inflation: Number.isFinite(legacy) ? legacy - clean : null, // null = legacy เป็น NaN
    });
  }
  riderReport.sort((a, b) => (Math.abs(b.inflation ?? Infinity) - Math.abs(a.inflation ?? Infinity)));

  return { totalRows: rows.length, riderReport, anomalies, logisticsMistagged, jobPayout150, jobPayoutRows, withdrawalRows };
}

/** อ่าน rider_fee_meta.reason + rider_fee ของงานรายใบ (jobs → jobs_archived) */
async function fetchJobFeeMeta(db, jobId) {
  for (const root of ['jobs', 'jobs_archived']) {
    const [metaSnap, feeSnap] = await Promise.all([
      db.ref(`${root}/${jobId}/rider_fee_meta`).once('value'),
      db.ref(`${root}/${jobId}/rider_fee`).once('value'),
    ]);
    if (metaSnap.exists() || feeSnap.exists()) {
      const meta = metaSnap.val() || {};
      return { found: root, reason: meta.reason ?? '(no meta)', distance_km: meta.distance_km ?? null, rider_fee: feeSnap.val() ?? null };
    }
  }
  return { found: null, reason: '(job not found)', distance_km: null, rider_fee: null };
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('th-TH') : String(n));

async function main() {
  // require ตรงนี้ (ไม่ใช่หัวไฟล์) เพื่อให้ส่วน pure ถูก smoke-test ได้โดยไม่มี dependency
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();

  console.log('[audit-rider-wallet] เฟส 0 — read-only, ไม่เขียนอะไรทั้งสิ้น');

  // ── โหลดข้อมูล ──────────────────────────────────────────────────────────
  const txSnap = await db.ref('transactions').once('value');
  const result = analyzeTransactions(txSnap.val() || {});

  // ── 1) ต่อ rider: X / Y / ส่วนที่บวม ────────────────────────────────────
  console.log(`\n== 1) balance ต่อ rider (แถว ledger ทั้งหมด ${fmt(result.totalRows)} แถว) ==`);
  for (const r of result.riderReport) {
    if (r.rider_id === 'SYSTEM') continue; // แถวฝั่งบริษัท สรุปแยกด้านล่าง
    console.log(`\n rider ${r.rider_id} (${r.rows} แถว)`);
    console.log(`   X ยอดที่จอโชว์วันนี้ (สูตรเดิม): ${fmt(r.balance_legacy)}`);
    console.log(`   Y ยอดหลังเฟส 1 (allowlist):     ${fmt(r.balance_allowlist)}`);
    console.log(`   ส่วนที่บวม (X−Y):               ${r.inflation === null ? 'คำนวณไม่ได้ (X เป็น NaN — มีแถว amount เสีย)' : fmt(r.inflation)}`);
    for (const [key, v] of Object.entries(r.perCategory)) {
      console.log(`     - ${key}: ${v.count} แถว รวม ${fmt(v.sum)}${v.hasBadAmount ? ' (มีแถว amount เสีย)' : ''}`);
    }
  }
  const sys = result.riderReport.find((r) => r.rider_id === 'SYSTEM');
  if (sys) {
    console.log(`\n แถวฝั่งบริษัท (rider_id=SYSTEM): ${sys.rows} แถว`);
    for (const [key, v] of Object.entries(sys.perCategory)) console.log(`     - ${key}: ${v.count} แถว รวม ${fmt(v.sum)}`);
  }

  // ── 2) เป้า backfill เฟส 3 ──────────────────────────────────────────────
  console.log(`\n== 2) LOGISTICS_REVENUE ที่ติด rider_id ของไรเดอร์ (เป้า retag): ${result.logisticsMistagged.length} แถว ==`);
  const mistagByRider = {};
  for (const m of result.logisticsMistagged) {
    mistagByRider[m.rider_id] = (mistagByRider[m.rider_id] || 0) + m.amount;
  }
  for (const [rid, sum] of Object.entries(mistagByRider)) console.log(`   ${rid}: รวม ${fmt(sum)} — ควรเท่ากับ "ส่วนที่บวม" ของคนเดียวกันในข้อ 1 พอดี`);

  // ── 3) แถวผิดปกติ ───────────────────────────────────────────────────────
  console.log(`\n== 3) แถวผิดปกติ ==`);
  console.log(`   amount ไม่ใช่ตัวเลข: ${result.anomalies.badAmount.length} แถว`);
  result.anomalies.badAmount.forEach((a) => console.log(`     - ${a.id} (${a.category}, rider ${a.rider_id}): amount=${JSON.stringify(a.amount)}`));
  console.log(`   ขาดฟิลด์บังคับ: ${result.anomalies.missingFields.length} แถว`);
  result.anomalies.missingFields.forEach((a) => console.log(`     - ${a.id}: ขาด ${a.missing}`));

  // ── 4) ความถูกเชิงตัวเลขของ JOB_PAYOUT ──────────────────────────────────
  console.log(`\n== 4) JOB_PAYOUT ${result.jobPayoutRows.length} แถว ==`);
  console.log(`   amount === 150 เป๊ะ (ร่องรอย fallback ตอน settle): ${result.jobPayout150.length} แถว`);
  const reasonCount = {};
  const suspectRows = [];
  for (const t of result.jobPayoutRows) {
    if (!t.ref_job_id) {
      reasonCount['(no ref_job_id)'] = (reasonCount['(no ref_job_id)'] || 0) + 1;
      suspectRows.push({ tx: t.id, job: null, reason: '(no ref_job_id)', amount: Number(t.amount) || null });
      continue;
    }
    const meta = await fetchJobFeeMeta(db, t.ref_job_id);
    reasonCount[meta.reason] = (reasonCount[meta.reason] || 0) + 1;
    // ใบที่ค่ารอบไม่ได้มาจากระยะจริง หรือยอดที่จ่ายไม่ตรง rider_fee บนงาน
    const paid = Number(t.amount);
    const feeOnJob = Number(meta.rider_fee);
    if (meta.reason !== 'calculated' || (Number.isFinite(feeOnJob) && feeOnJob !== paid)) {
      suspectRows.push({ tx: t.id, job: t.ref_job_id, found_in: meta.found, reason: meta.reason, rider_fee_on_job: meta.rider_fee, paid_amount: paid, distance_km: meta.distance_km });
    }
  }
  console.log('   การกระจายของ rider_fee_meta.reason (จากงานที่ join ได้):');
  for (const [reason, n] of Object.entries(reasonCount)) console.log(`     - ${reason}: ${n} ใบ`);
  console.log(`   ใบที่ต้องเปิดดู (reason ไม่ใช่ calculated หรือยอดจ่ายไม่ตรง rider_fee บนงาน): ${suspectRows.length}`);
  suspectRows.forEach((s) => console.log(`     - tx ${s.tx} job ${s.job ?? '-'} [${s.found_in ?? '-'}] reason=${s.reason} fee_on_job=${s.rider_fee_on_job ?? '-'} paid=${s.paid_amount ?? '-'}`));

  // ── 5) ยืนยันสมมุติฐานเฟส 4: ศูนย์ทั้งสามที่ ────────────────────────────
  const [withdrawalsSnap, jobsWithdrawalSnap] = await Promise.all([
    db.ref('withdrawals').once('value'),
    db.ref('jobs').orderByChild('type').equalTo('Withdrawal').once('value'),
  ]);
  const withdrawalsNodeCount = withdrawalsSnap.exists() ? Object.keys(withdrawalsSnap.val()).length : 0;
  const jobsWithdrawalCount = jobsWithdrawalSnap.exists() ? Object.keys(jobsWithdrawalSnap.val()).length : 0;
  console.log(`\n== 5) ยืนยันสมมุติฐานเฟส 4 (คาดว่าศูนย์ทั้งสาม) ==`);
  console.log(`   /transactions category WITHDRAWAL: ${result.withdrawalRows.length} แถว`);
  console.log(`   /withdrawals (node ที่แอปไรเดอร์เขียน): ${withdrawalsNodeCount} แถว`);
  console.log(`   /jobs ที่ type === 'Withdrawal': ${jobsWithdrawalCount} แถว`);
  if (result.withdrawalRows.length || withdrawalsNodeCount || jobsWithdrawalCount) {
    console.log('   *** ไม่ศูนย์ — เฟส 4 ต้องเพิ่ม migration ที่แผนปัจจุบันไม่ได้วางไว้ ***');
  }

  // ── 6) ค่ารอบค้างจ่าย (เพิ่มหลังรอบรันแรกพบ JOB_PAYOUT = 0 แถว) ─────────
  // ledger บอกว่าไม่เคยมีการอนุมัติค่ารอบเข้ากระเป๋าเลย — ต้องรู้ว่าฝั่งงาน
  // มีค่ารอบสะสมค้างอยู่เท่าไหร่ เพราะหลังเฟส 1 เลขนี้คือส่วนต่างระหว่าง
  // "0 ที่จอโชว์" กับ "เงินที่ไรเดอร์ควรได้จริง". query ตาม .indexOn rider_id
  // รายคน ไม่กวาด /jobs ทั้ง node (กฎค่า RTDB)
  console.log(`\n== 6) ค่ารอบฝั่งงาน เทียบกับ ledger ==`);
  const ridersSnap = await db.ref('riders').once('value');
  const riderIds = ridersSnap.exists() ? Object.keys(ridersSnap.val()) : [];
  const riderNames = ridersSnap.exists()
    ? Object.fromEntries(Object.entries(ridersSnap.val()).map(([id, r]) => [id, (r && r.name) || '(no name)']))
    : {};
  console.log(`   ไรเดอร์ใน /riders: ${riderIds.length} คน`);
  for (const rid of riderIds) {
    const jobsSnap = await db.ref('jobs').orderByChild('rider_id').equalTo(rid).once('value');
    const jobs = jobsSnap.exists() ? Object.entries(jobsSnap.val()).map(([id, j]) => ({ id, ...(j || {}) })) : [];
    const byFeeStatus = {};
    let unpaidSum = 0;
    let feeMissing = 0;
    for (const j of jobs) {
      const st = j.rider_fee_status || '(none)';
      byFeeStatus[st] = (byFeeStatus[st] || 0) + 1;
      const fee = Number(j.rider_fee);
      if (st !== 'Paid') {
        if (Number.isFinite(fee) && fee > 0) unpaidSum += fee;
        else if (j.receive_method === 'Pickup') feeMissing += 1;
      }
    }
    console.log(`\n   rider ${rid} (${riderNames[rid]}): งานที่ถือ ${jobs.length} ใบ`);
    for (const [st, n] of Object.entries(byFeeStatus)) console.log(`     - rider_fee_status ${st}: ${n} ใบ`);
    console.log(`     ค่ารอบค้างจ่าย (rider_fee ตั้งแล้วแต่ยังไม่ Paid): ${fmt(unpaidSum)}`);
    if (feeMissing) console.log(`     งาน Pickup ที่ยังไม่มี rider_fee เลย: ${feeMissing} ใบ (ต้องรอ/ไล่ trigger settlement)`);
    const ledgerPaid = (result.riderReport.find((r) => r.rider_id === rid) || { perCategory: {} }).perCategory['JOB_PAYOUT/CREDIT'];
    console.log(`     เทียบ ledger: JOB_PAYOUT ที่เคยเข้ากระเป๋า = ${ledgerPaid ? fmt(ledgerPaid.sum) : '0'}`);
  }
  console.log(`\n   (หมายเหตุ: นับเฉพาะ /jobs — งานที่ถูก archive แล้วไม่อยู่ในเลขนี้)`);

  const jsonArg = process.argv.find((a) => a.startsWith('--json='));
  if (jsonArg) {
    const out = jsonArg.split('=')[1];
    require('fs').writeFileSync(out, JSON.stringify({ ...result, suspectRows, reasonCount, withdrawalsNodeCount, jobsWithdrawalCount }, null, 2));
    console.log(`\nเขียนผลดิบที่ ${out}`);
  }

  process.exit(0);
}

module.exports = { analyzeTransactions, legacyBalance, allowlistBalance, RIDER_WALLET_CATEGORIES };

if (require.main === module) {
  main().catch((e) => {
    console.error('[audit-rider-wallet] ล้มเหลว:', e);
    process.exit(1);
  });
}
