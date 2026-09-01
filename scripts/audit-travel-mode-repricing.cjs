#!/usr/bin/env node
/**
 * หางานที่ "ค่ารอบถูกคิดใหม่ด้วยฐานคนละแบบกับตอนไรเดอร์กดรับ"
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json \
 *   FIREBASE_DATABASE_URL=https://<project>-default-rtdb.<region>.firebasedatabase.app \
 *     node scripts/audit-travel-mode-repricing.cjs                 # /jobs อย่างเดียว
 *     node scripts/audit-travel-mode-repricing.cjs --archived      # รวม /jobs_archived
 *     node scripts/audit-travel-mode-repricing.cjs --json=out.json
 *
 * **READ-ONLY ทั้งไฟล์ ไม่มี write path ใดๆ** — ตัวแก้เงินคือ RiderSettlements
 * หรือ scripts/settle-pending-rider-fees.cjs ตามเดิม สคริปต์นี้แค่บอกว่าใบไหนต้องดู
 *
 * ── ที่มา (เคสจริง 1 ก.ย. 2569 งาน OID-MTIAI3FH-851) ────────────────────────
 * ไรเดอร์กดรับงานตอน 13:32 เห็นค่ารอบ ฿182 พอปิดจ๊อบตอน 17:05 ได้ ฿157
 * ไม่มีอะไรพังเลย: `reason` เป็น `calculated` ทั้งสองครั้ง อัตราเท่ากันเป๊ะ
 * ยานพาหนะเดียวกัน หมุดไม่ขยับ **ตัวแปรเดียวที่ต่างคือ `rates.travel_mode`**
 * ซึ่งถูกแก้ที่ settings/logistics_rates ตอน 16:57 คือ 8 นาทีก่อนปิดจ๊อบ
 *
 *   estimate_meta : travel_mode DRIVE       distance 24.37 กม. -> 60 + 5*24.37 = 182
 *   fee_meta      : travel_mode TWO_WHEELER distance 19.35 กม. -> 60 + 5*19.35 = 157
 *
 * เส้นทางมอเตอร์ไซค์สั้นกว่าเพราะขึ้นทางด่วนไม่ได้ (ดูคอมเมนต์ที่ index.js:436)
 * ค่าที่ตั้งไม่ได้ผิด — สิ่งที่ผิดคือมันย้อนไปคิดเงินใหม่ให้งานที่ไรเดอร์
 * รับปากไปแล้ว โดยไม่มี qc_logs ไม่มีการแจ้ง และไม่มี trigger ใดบน /settings
 * รายละเอียดเต็มอยู่ที่ bkk-rider-app/docs/reports/2026-09-01-rider-fare-integrity-survey.md
 *
 * ── ทำไมต้องสแกน ไม่ query ──────────────────────────────────────────────────
 * เงื่อนไขอยู่ใน object ซ้อน (`rider_fee_meta.rates.travel_mode`) ซึ่ง RTDB
 * query ไม่ได้ และ `receive_method` ก็ไม่อยู่ใน .indexOn ของ /jobs
 * (indexOn มี: status, created_at, type, rider_id, agent_name, uid, cust_email,
 * cust_phone, crm_customer_id, kyc_verified_at) การ orderByChild ฟิลด์ที่ไม่มี
 * index จะดาวน์โหลดทั้ง node มากรองฝั่ง client อยู่ดี **แต่แพงกว่า** เพราะ
 * RTDB เตือนแล้วทำแบบเดียวกัน จึงอ่านตรงๆ ทีเดียวแล้วกรองในหน่วยความจำ
 *
 * `--since=YYYY-MM-DD` ใช้ `created_at` ซึ่ง **มี index** เพื่อลดขนาดที่ดาวน์โหลด
 * จริง (ไม่ใช่กรองทีหลัง) — ใช้เมื่อรู้ว่าสนใจเฉพาะช่วงไหน. ไม่ใส่ = อ่านทั้ง node
 * ซึ่งเป็นพฤติกรรมเดียวกับ scripts/audit-rider-wallet.cjs และยอมรับได้เพราะ
 * เป็นสคริปต์ที่คนรันมือเป็นครั้งคราว ไม่ใช่ hot path (กฎค่า RTDB ใน CLAUDE.md)
 *
 * ── สามถังที่รายงาน ────────────────────────────────────────────────────────
 *   A  travel_mode ต่างกัน          = เคสแบบ OID-MTIAI3FH-851 เป๊ะ
 *   B  ฟิลด์อัตราอื่นต่างกัน        = แอดมินแก้ base_fee/per_km/min/max กลางทาง
 *   C  อัตราเหมือนกันหมดแต่ระยะต่าง = หมุดขยับ หรือ Routes เลือกเส้นทางคนละเส้น
 *                                     (ถังนี้คือตัวที่วัด "traffic jitter" ได้จริง
 *                                      ซึ่งรายงานบอกว่าแยกจากถัง A ไม่ได้ด้วย
 *                                      ข้อมูลใบเดียว — หลายใบรวมกันแยกได้)
 *
 * ทุกถังแยกตาม `rider_fee_status` เพราะทางแก้คนละเรื่อง:
 *   ยังไม่ Paid = แก้ได้ก่อนจ่าย · Paid แล้ว = ต้องลง ledger ส่วนต่าง
 *   (ห้ามแก้ rider_fee เฉยๆ — กระเป๋าไรเดอร์คิดจากแถวใน /transactions
 *    ดูกติกาเดียวกันที่ functions/pin-dispute.js:23-25)
 */
'use strict';

const path = require('path');

const finite = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ฟิลด์อัตราที่ถือว่า "เปลี่ยนแล้วเงินเปลี่ยน" — ตรงกับที่ getLogisticsRates คืน */
const RATE_FIELDS = ['base_fee', 'per_km', 'min_fee', 'max_fee'];

/**
 * ค่ารอบที่ไรเดอร์ "เห็นจริง" ตอนงานยังไม่จบ
 * เลียนแบบ getRiderPayout ของแอปไรเดอร์ (bkk-rider-app/src/utils/jobHelpers.ts:89-101)
 * แบบตัดกิ่งแรกออก — กิ่งนั้นคือ `rider_fee` ซึ่ง ณ ตอนกดรับยังไม่มี
 */
function shownEstimate(job) {
  const meta = (job && job.rider_fee_estimate_meta) || {};
  const vehicle = meta.rates && meta.rates.vehicle;
  const byVehicle = meta.fee_by_vehicle;
  if (vehicle && byVehicle) {
    const mine = finite(byVehicle[vehicle]);
    if (mine !== null && mine > 0) return mine;
  }
  return finite(job && job.rider_fee_estimate);
}

/**
 * จัดประเภทงานหนึ่งใบ — pure ไม่มี I/O เพื่อให้ทดสอบได้
 * คืน null เมื่อ "ไม่มีอะไรให้เทียบ" (ไม่ใช่ Pickup / ยังไม่จบ / meta ไม่ครบ)
 */
function classifyJob(id, job) {
  if (!job || job.receive_method !== 'Pickup') return null;
  if (!job.rider_id) return null;

  const em = job.rider_fee_estimate_meta;
  const fm = job.rider_fee_meta;
  // ต้องมีทั้งสองก้อนถึงจะเทียบได้ — ใบที่ยังไม่ปิดจ๊อบยังไม่มี fee_meta
  if (!em || !fm || !em.rates || !fm.rates) return null;

  const modeBefore = em.rates.travel_mode ?? null;
  const modeAfter = fm.rates.travel_mode ?? null;
  const modeChanged = modeBefore !== modeAfter;

  const rateDiffs = RATE_FIELDS
    .filter((f) => finite(em.rates[f]) !== finite(fm.rates[f]))
    .map((f) => ({ field: f, before: finite(em.rates[f]), after: finite(fm.rates[f]) }));

  const distBefore = finite(em.distance_km);
  const distAfter = finite(fm.distance_km);
  const distChanged = distBefore !== null && distAfter !== null && distBefore !== distAfter;

  const shown = shownEstimate(job);
  const settled = finite(job.rider_fee);
  const delta = shown !== null && settled !== null ? settled - shown : null;

  let bucket = null;
  if (modeChanged) bucket = 'A_travel_mode';
  else if (rateDiffs.length > 0) bucket = 'B_rate_fields';
  else if (distChanged) bucket = 'C_distance_only';
  if (!bucket) return null;

  return {
    id,
    ref_no: job.ref_no || job.OID || null,
    status: job.status || null,
    rider_id: job.rider_id,
    rider_fee_status: job.rider_fee_status || '(none)',
    bucket,
    shown_estimate: shown,
    settled_fee: settled,
    delta,
    travel_mode_before: modeBefore,
    travel_mode_after: modeAfter,
    rate_diffs: rateDiffs,
    distance_km_before: distBefore,
    distance_km_after: distAfter,
    vehicle_before: (em.rates && em.rates.vehicle) || null,
    vehicle_after: (fm.rates && fm.rates.vehicle) || null,
    reason_before: em.reason ?? null,
    reason_after: fm.reason ?? null,
    estimate_computed_at: finite(em.computed_at),
    fee_computed_at: finite(fm.computed_at),
    // ใบที่ reason ไม่ใช่ calculated แปลว่าตัวเลขมาจาก min_fee ไม่ใช่ระยะจริง —
    // ส่วนต่างของใบพวกนี้อธิบายด้วย travel_mode ไม่ได้ ต้องแยกดู
    fallback_involved: em.reason !== 'calculated' || fm.reason !== 'calculated',
  };
}

/** เดินทุกใบแล้วสรุป — pure */
function analyzeJobs(jobsById, source) {
  const rows = [];
  for (const [id, job] of Object.entries(jobsById || {})) {
    const r = classifyJob(id, job);
    if (r) rows.push({ ...r, source });
  }
  return rows;
}

/** สรุปยอดเงินต่อถัง แยกตามว่าจ่ายไปแล้วหรือยัง — pure */
function summarize(rows) {
  const out = {};
  for (const r of rows) {
    const paid = r.rider_fee_status === 'Paid';
    const key = r.bucket;
    if (!out[key]) out[key] = { count: 0, paid: 0, unpaid: 0, delta_paid: 0, delta_unpaid: 0, delta_unknown: 0 };
    const b = out[key];
    b.count += 1;
    if (paid) b.paid += 1; else b.unpaid += 1;
    if (r.delta === null) b.delta_unknown += 1;
    else if (paid) b.delta_paid += r.delta;
    else b.delta_unpaid += r.delta;
  }
  return out;
}

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('th-TH') : String(n));
const ts = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }) : '-');

const BUCKET_LABEL = {
  A_travel_mode: 'A) travel_mode ต่างกัน — ฐานวัดระยะเปลี่ยนกลางทาง',
  B_rate_fields: 'B) ฟิลด์อัตราต่างกัน — แอดมินแก้ตัวเลขค่าจ้างกลางทาง',
  C_distance_only: 'C) อัตราเหมือนกันแต่ระยะต่าง — หมุดขยับ หรือ Routes เลือกคนละเส้น',
};

async function readJobs(db, root, since) {
  const ref = db.ref(root);
  const snap = since
    ? await ref.orderByChild('created_at').startAt(since).once('value')
    : await ref.once('value');
  return snap.val() || {};
}

async function main() {
  // require ตรงนี้ ไม่ใช่หัวไฟล์ เพื่อให้ส่วน pure ถูกทดสอบได้โดยไม่ต้องมี
  // firebase-admin ติดตั้ง (กติกาเดียวกับ scripts/audit-rider-wallet.cjs:147)
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();

  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const since = sinceArg ? Date.parse(`${sinceArg.split('=')[1]}T00:00:00+07:00`) : null;
  if (sinceArg && !Number.isFinite(since)) {
    console.error('--since ต้องเป็น YYYY-MM-DD');
    process.exit(1);
  }
  const withArchived = process.argv.includes('--archived');

  console.log('[audit-travel-mode-repricing] READ-ONLY ไม่เขียนอะไรทั้งสิ้น');
  console.log(`  ช่วง: ${since ? `created_at >= ${sinceArg.split('=')[1]}` : 'ทั้งหมด'}` +
              ` | node: /jobs${withArchived ? ' + /jobs_archived' : ' (ไม่รวม archived — ใส่ --archived ถ้าต้องการ)'}`);

  const rows = analyzeJobs(await readJobs(db, 'jobs', since), 'jobs');
  if (withArchived) {
    rows.push(...analyzeJobs(await readJobs(db, 'jobs_archived', since), 'jobs_archived'));
  }
  rows.sort((a, b) => (b.fee_computed_at ?? 0) - (a.fee_computed_at ?? 0));

  const summary = summarize(rows);

  console.log(`\n== สรุป: พบ ${rows.length} ใบที่ฐานคิดเงินตอนจบงานไม่ตรงกับตอนกดรับ ==`);
  if (rows.length === 0) {
    console.log('   (ไม่พบใบไหนเลย — ทุกงานถูกคิดด้วยฐานเดียวกันตลอดทั้งใบ)');
  }
  for (const [bucket, s] of Object.entries(summary)) {
    console.log(`\n ${BUCKET_LABEL[bucket] || bucket}`);
    console.log(`   ทั้งหมด ${s.count} ใบ — จ่ายแล้ว ${s.paid} · ยังไม่จ่าย ${s.unpaid}`);
    console.log(`   ผลต่างรวม (จ่ายจริง − ที่ไรเดอร์เห็น): ยังไม่จ่าย ${fmt(s.delta_unpaid)} บาท · จ่ายไปแล้ว ${fmt(s.delta_paid)} บาท`);
    if (s.delta_unknown) console.log(`   คำนวณผลต่างไม่ได้ ${s.delta_unknown} ใบ (ขาด rider_fee หรือ estimate)`);
  }

  console.log('\n== รายใบ (ใหม่สุดก่อน) ==');
  for (const r of rows) {
    const sign = r.delta === null ? '?' : (r.delta < 0 ? 'ไรเดอร์เสีย' : (r.delta > 0 ? 'ไรเดอร์ได้เพิ่ม' : 'เท่าเดิม'));
    console.log(`\n  ${r.ref_no || r.id}  [${r.source}] ${r.bucket}`);
    console.log(`    งาน ${r.id} · status ${r.status} · rider_fee_status ${r.rider_fee_status} · rider ${r.rider_id}`);
    console.log(`    เห็นตอนกดรับ ${fmt(r.shown_estimate)} -> จ่ายจริง ${fmt(r.settled_fee)}  (${sign} ${r.delta === null ? '-' : fmt(Math.abs(r.delta))} บาท)`);
    if (r.travel_mode_before !== r.travel_mode_after) {
      console.log(`    travel_mode: ${r.travel_mode_before} -> ${r.travel_mode_after}`);
    }
    for (const d of r.rate_diffs) console.log(`    ${d.field}: ${d.before} -> ${d.after}`);
    console.log(`    ระยะ: ${r.distance_km_before} -> ${r.distance_km_after} กม. · ยานพาหนะ ${r.vehicle_before} -> ${r.vehicle_after}`);
    console.log(`    reason: ${r.reason_before} -> ${r.reason_after}${r.fallback_involved ? '  <-- มี fallback ปน ส่วนต่างอธิบายด้วยฐานวัดอย่างเดียวไม่ได้' : ''}`);
    console.log(`    เวลา: estimate ${ts(r.estimate_computed_at)} -> fee ${ts(r.fee_computed_at)}`);
  }

  const unpaidLosers = rows.filter((r) => r.rider_fee_status !== 'Paid' && r.delta !== null && r.delta < 0);
  const paidLosers = rows.filter((r) => r.rider_fee_status === 'Paid' && r.delta !== null && r.delta < 0);
  console.log('\n== สิ่งที่ทำต่อได้ ==');
  console.log(`  ยังไม่จ่ายและไรเดอร์เสีย: ${unpaidLosers.length} ใบ — แก้ได้ก่อนเงินเข้ากระเป๋า`);
  unpaidLosers.forEach((r) => console.log(`    - ${r.ref_no || r.id}: ${fmt(r.shown_estimate)} -> ${fmt(r.settled_fee)}`));
  console.log(`  จ่ายไปแล้วและไรเดอร์เสีย: ${paidLosers.length} ใบ — ต้องลงส่วนต่างใน /transactions ห้ามแก้ rider_fee เฉยๆ`);
  paidLosers.forEach((r) => console.log(`    - ${r.ref_no || r.id}: ${fmt(r.shown_estimate)} -> ${fmt(r.settled_fee)}`));

  const jsonArg = process.argv.find((a) => a.startsWith('--json='));
  if (jsonArg) {
    const out = jsonArg.split('=')[1];
    require('fs').writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
    console.log(`\nเขียนผลดิบที่ ${out}`);
  }

  process.exit(0);
}

module.exports = { classifyJob, analyzeJobs, summarize, shownEstimate, RATE_FIELDS };

if (require.main === module) {
  main().catch((e) => {
    console.error('[audit-travel-mode-repricing] ล้มเหลว:', e);
    process.exit(1);
  });
}
