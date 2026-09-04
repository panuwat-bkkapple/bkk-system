#!/usr/bin/env node
/**
 * นับ "งานที่จ่ายแล้วแต่ไม่มี transaction" (orphan) ก่อน/หลังเปลี่ยนตัวเทียบสถานะ
 * ของ Finance.tsx (orphanCount) และ TransactionRepair.tsx
 *
 *   node scripts/audit-orphan-payouts.cjs          # สรุป before / after + รายการที่โผล่ใหม่
 *   node scripts/audit-orphan-payouts.cjs --all    # พิมพ์ทุกใบทั้งสองชุด ไม่ใช่แค่ส่วนต่าง
 *
 * ทำไมต้องมี: ตัวเทียบเดิมเป็น literal สะกดเก่า
 *     status === 'Waiting for Handover' || 'Sent to QC Lab' || 'Completed'
 *            || 'Payment Completed' || 'Pending QC'
 * พอเปลี่ยนเป็น normalizeStatus(status) === JOB_STATUS.* จะได้สองอย่างพร้อมกัน:
 *   1. ใบที่ engine เขียน canonical ('Waiting For Handover' / 'Sent To QC Lab')
 *      ซึ่งเดิมหลุดจากตัวนับ
 *   2. ใบที่ status เป็น 'Paid' (สะกดใหม่) — 'Payment Completed' เป็น alias ของ Paid
 *      ตาม LEGACY_ALIAS ดังนั้น normalize แล้วเทียบ PAID จะรวม 'Paid' และ 'PAID' ด้วย
 * ข้อ 2 คือแถวที่ตัวนับเดิม **ไม่เคยนับ** สคริปต์นี้มีไว้บอกว่ามันคือกี่ใบและใบไหน
 * ก่อน merge ไม่ใช่ให้ตัวเลขบนหน้า finance กระโดดโดยไม่มีใครรู้ว่าทำไม
 *
 * วิธีรัน (จากเครื่องที่มี service account — สคริปต์นี้อ่านอย่างเดียว ไม่เขียน DB):
 *   cd functions && npm ci        # ถ้ายังไม่มี node_modules
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   FIREBASE_DATABASE_URL=https://<db>.asia-southeast1.firebasedatabase.app \
 *     node ../scripts/audit-orphan-payouts.cjs
 *
 * หมายเหตุค่า RTDB: `jobs` ดึงตาม index status เฉพาะสถานะที่ตัวเทียบทั้งสองชุด
 * รับได้ (ครบถ้วนโดยนิยาม — ค่าอื่น normalize ไม่ตกในเซ็ตนี้) ส่วน `transactions`
 * อ่านทั้ง node ครั้งเดียวเหมือนที่หน้า Finance ทำ (ไม่มี index ref_job_id)
 */
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const { JOB_STATUS, normalizeStatus } = require(path.join(__dirname, '..', 'functions', 'status-vocab.generated.js'));

// ตัวเทียบเดิม — ก๊อปมาตรงตัวจาก Finance.tsx / TransactionRepair.tsx บน main
const OLD_STATUSES = ['Waiting for Handover', 'Sent to QC Lab', 'Completed', 'Payment Completed', 'Pending QC'];
const isPaidOld = (j) => !!j.paid_at && OLD_STATUSES.includes(j.status);

// ตัวเทียบใหม่ — สูตรเดียวกับใน PR
const NEW_CANONICAL = new Set([
  JOB_STATUS.WAITING_FOR_HANDOVER, JOB_STATUS.SENT_TO_QC_LAB, JOB_STATUS.COMPLETED,
  JOB_STATUS.PAID, JOB_STATUS.PENDING_QC,
]);
const isPaidNew = (j) => {
  const s = normalizeStatus(j.status, j.receive_method);
  return !!j.paid_at && !!s && NEW_CANONICAL.has(s);
};

// ทุกสะกดที่ตัวเทียบชุดใดชุดหนึ่งรับได้ — ใช้ query ตาม index status
const QUERY_STATUSES = [
  ...OLD_STATUSES,
  'Waiting For Handover', 'Sent To QC Lab', 'Paid', 'PAID',
];

const SHOW_ALL = process.argv.includes('--all');
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 19).replace('T', ' ') : '-');
const row = (j) => `${j.id}  ${j.ref_no || '-'}  status="${j.status}"  paid_at=${iso(j.paid_at)}  net_payout=${j.net_payout ?? '-'}`;

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
  const txSnap = await db.ref('transactions').once('value');
  const txJobIds = new Set();
  txSnap.forEach((child) => { const t = child.val(); if (t && t.ref_job_id) txJobIds.add(t.ref_job_id); });

  const all = [...jobs.values()];
  const before = all.filter((j) => isPaidOld(j) && !txJobIds.has(j.id));
  const after = all.filter((j) => isPaidNew(j) && !txJobIds.has(j.id));
  const beforeIds = new Set(before.map((j) => j.id));
  const afterIds = new Set(after.map((j) => j.id));
  const added = after.filter((j) => !beforeIds.has(j.id)).sort((a, b) => (b.paid_at || 0) - (a.paid_at || 0));
  const removed = before.filter((j) => !afterIds.has(j.id));

  console.log(`jobs scanned (by status index): ${all.length}   transactions with ref_job_id: ${txJobIds.size}`);
  console.log(`orphan BEFORE (literal compare): ${before.length}`);
  console.log(`orphan AFTER  (normalizeStatus):  ${after.length}`);
  console.log(`newly appearing: ${added.length}   disappearing: ${removed.length}`);
  const byStatus = {};
  for (const j of added) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  if (added.length) console.log('newly appearing by raw status:', byStatus);
  console.log('\n--- newly appearing ---');
  for (const j of added) console.log(row(j));
  if (removed.length) { console.log('\n--- disappearing (should be empty) ---'); for (const j of removed) console.log(row(j)); }
  if (SHOW_ALL) {
    console.log('\n--- BEFORE ---'); for (const j of before) console.log(row(j));
    console.log('\n--- AFTER ---'); for (const j of after) console.log(row(j));
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
