#!/usr/bin/env node
/**
 * รายชื่องานที่ "ข้ามขั้นส่งมอบ" ผ่าน engine แล้วไม่ได้ค่ารอบไรเดอร์ — เพื่อจ่ายย้อนหลัง
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   FIREBASE_DATABASE_URL=https://<db>.asia-southeast1.firebasedatabase.app \
 *     node scripts/audit-fee-safety-net-skips.cjs [--since 2026-09-03T21:38+07:00]
 *
 * อ่านอย่างเดียว ไม่เขียน DB
 *
 * ทำไมต้องมี: ตาข่ายกันตกของ onJobHandedOverCalcRiderFee (งาน Pickup ที่แอดมิน
 * กดส่งเข้าแล็บ/เข้าคลังโดยไม่ผ่านขั้น Pending QC) เทียบ 'Sent to QC Lab' สะกดเดียว
 * ขณะที่ engine เขียน 'Sent To QC Lab' — ตั้งแต่ปุ่มพวกนั้นย้ายไป engine
 * (3 ก.ย. 2569 ~21:38 เวลาไทย) งานที่ข้ามขั้นจึงไม่ได้ค่ารอบเลยโดยไม่มี error
 * สคริปต์นี้ตอบว่ามีกี่ใบ ใบไหน ไรเดอร์คนไหน — เจ้าของงานตัดสินเรื่องจ่ายย้อนหลังเอง
 *
 * เกณฑ์ (ตรงกับเงื่อนไขของ trigger ตัวจริง):
 *   - receive_method = Pickup และมี rider_id
 *   - status_history มีแถว to ∈ {Sent To QC Lab, In Stock} ที่ at >= since
 *     (engine เท่านั้นที่เขียน status_history — แถวเก่าไม่มีฟิลด์นี้)
 *   - ก่อนแถวนั้นไม่เคยผ่าน Pending QC (ถ้าเคย ทางหลักคิดค่ารอบไปแล้ว)
 *   - rider_fee ยังไม่ถูกตั้ง (ไม่มี หรือ 0)
 *
 * "expected fee" = rider_fee_estimate ที่งานถืออยู่ (ตัวเลขที่ไรเดอร์เห็นตอนกดรับ
 * คิดด้วยอัตราของยานพาหนะคนที่ถืองาน — onRiderAssignedRecalcEstimate) พร้อม
 * fee_by_vehicle ถ้ามี. ตัวเลขที่ trigger จะคิดจริงมาจาก computeRiderFeeForAssignee
 * (ยิง Routes API) ซึ่งสคริปต์อ่านอย่างเดียวไม่เรียก — ต่างกันได้เล็กน้อยตามระยะทาง
 *
 * ค่า RTDB: query ตาม index status เฉพาะสถานะที่งานข้ามขั้นไปอยู่ได้ (ยังอยู่ที่แล็บ/
 * คลัง หรือเดินต่อไปขายแล้ว) ไม่กวาดทั้ง node
 */
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const { JOB_STATUS, normalizeStatus } = require(path.join(__dirname, '..', 'functions', 'status-vocab.generated.js'));

const sinceArg = (() => { const i = process.argv.indexOf('--since'); return i > 0 ? process.argv[i + 1] : '2026-09-03T21:38:00+07:00'; })();
const SINCE = Date.parse(sinceArg);
if (!Number.isFinite(SINCE)) { console.error(`--since อ่านไม่ออก: ${sinceArg}`); process.exit(2); }

const SKIP_TARGETS = new Set([JOB_STATUS.SENT_TO_QC_LAB, JOB_STATUS.IN_STOCK]);
// สถานะที่งานซึ่งข้ามขั้นไปแล้วอาจอยู่ตอนนี้ (ทั้งสองสะกดที่ index เก็บได้)
const QUERY_STATUSES = [
  'Sent To QC Lab', 'Sent to QC Lab', 'In Stock', 'Ready To Sell', 'Ready to Sell',
  'Sold', 'Completed', 'Pending QC',
];

const iso = (ms) => (ms ? new Date(Number(ms)).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }) : '-');
const historyOf = (job) => {
  const raw = job && job.status_history;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
};

function skipEntryOf(job) {
  const rows = historyOf(job).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  let seenPendingQc = false;
  for (const h of rows) {
    const to = normalizeStatus(h.to, job.receive_method) || h.to;
    if (to === JOB_STATUS.PENDING_QC) seenPendingQc = true;
    if (SKIP_TARGETS.has(to) && !seenPendingQc && Number(h.at) >= SINCE) return h;
  }
  return null;
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();
  const jobs = new Map();
  for (const status of QUERY_STATUSES) {
    const snap = await db.ref('jobs').orderByChild('status').equalTo(status).once('value');
    snap.forEach((child) => { jobs.set(child.key, { id: child.key, ...child.val() }); });
  }

  const hits = [];
  for (const job of jobs.values()) {
    if (job.receive_method !== 'Pickup' || !job.rider_id) continue;
    if (typeof job.rider_fee === 'number' && job.rider_fee > 0) continue;
    const skip = skipEntryOf(job);
    if (!skip) continue;
    hits.push({ job, skip });
  }
  hits.sort((a, b) => (a.skip.at || 0) - (b.skip.at || 0));

  const riderIds = [...new Set(hits.map((h) => h.job.rider_id))];
  const riderNames = {};
  for (const rid of riderIds) {
    const r = (await db.ref(`riders/${rid}`).once('value')).val();
    riderNames[rid] = (r && (r.name || r.displayName || r.email)) || '(ไม่พบชื่อ)';
  }

  console.log(`since ${sinceArg}  jobs scanned (by status index): ${jobs.size}`);
  console.log(`งานที่ข้ามขั้นส่งมอบผ่าน engine และยังไม่มี rider_fee: ${hits.length}\n`);
  console.log('rider_id | ชื่อไรเดอร์ | job id | ref_no | ข้ามไปที่ | เมื่อ (เวลาไทย) | event | สถานะตอนนี้ | expected fee (estimate) | fee_by_vehicle');
  for (const { job, skip } of hits) {
    const meta = job.rider_fee_estimate_meta || {};
    const fbv = meta.fee_by_vehicle ? JSON.stringify(meta.fee_by_vehicle) : '-';
    console.log([
      job.rider_id, riderNames[job.rider_id], job.id, job.ref_no || '-', skip.to, iso(skip.at), skip.event || '-',
      job.status, job.rider_fee_estimate ?? '-', fbv,
    ].join(' | '));
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
