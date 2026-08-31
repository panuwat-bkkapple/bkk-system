#!/usr/bin/env node
/**
 * Settle ค่ารอบค้างจ่ายที่เหลือ — งานที่ rider_fee ตั้งแล้วแต่ปุ่มอนุมัติใน
 * RiderSettlements ไม่เห็น (สถานะงานอยู่นอก filter ของหน้า) + รายงานงานที่
 * ยังไม่มี rider_fee เลย
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/settle-pending-rider-fees.cjs            # dry-run (ค่าเริ่มต้น)
 *     node scripts/settle-pending-rider-fees.cjs --apply    # เขียนจริง
 *
 * ที่มา (เฟส 0 + รอบเผลอกดอนุมัติ 31 ส.ค. 2569 — ดู bkk-rider-app
 * docs/reports/2026-08-31-rider-wallet-fix-plan.md): ปุ่ม "อนุมัติทั้งหมด"
 * กรองเฉพาะสถานะ Pending QC / Completed / Waiting for Handover จึงจ่ายไป
 * 121 ใบ (44,200) เหลือค้าง 69 ใบ (24,134) ที่สถานะเดินเลยไปแล้ว
 * (In Stock / Sold / ...) ทั้งที่ค่ารอบถูกคิดไว้ถูกต้อง
 *
 * กติกา (ต่างจากปุ่มเดิมสองข้อ โดยตั้งใจ):
 *   - จ่ายเฉพาะใบที่ `rider_fee` เป็นเลขจริง > 0 — **ไม่มี fallback 150**
 *     ใบที่ไม่มี fee = รายงานแยกให้เจ้าของตัดสิน ไม่เดาเงิน
 *   - ไม่สน status ของงาน (เงื่อนไขคือ rider_fee_status === 'Pending' ล้วนๆ)
 *     เพราะค่ารอบเกิดตอนส่งมอบเครื่องแล้ว การที่งานเดินต่อไม่ได้แปลว่าหนี้หาย
 *
 * เขียนรูปเดียวกับ RiderSettlements ทุกฟิลด์ (rider_fee_status='Paid' +
 * settled_at + CREDIT JOB_PAYOUT ที่มี ref_job_id) — แอปไรเดอร์จึงเห็น
 * รายการพร้อม description บอกชื่อรุ่น/เลขงานตามปกติ. idempotent โดยเงื่อนไข
 * เอง (ใบที่จ่ายแล้วเป็น 'Paid' รอบถัดไปไม่เจอ)
 *
 * ตรวจรับ: รัน scripts/audit-rider-wallet.cjs — หมวด 6 "ค่ารอบค้างจ่าย"
 * ต้องเหลือเฉพาะใบไม่มี fee และหมวด 4 ทุกแถวใหม่ต้อง reason=calculated
 */
'use strict';

const path = require('path');

const APPLY = process.argv.includes('--apply');

/** เลือกใบที่ settle ได้ + แยกใบไม่มี fee — pure, smoke-test ได้ */
function planSettlement(jobs) {
  const payable = [];
  const noFee = [];
  for (const j of jobs) {
    if (j.rider_fee_status !== 'Pending') continue;
    const fee = Number(j.rider_fee);
    if (Number.isFinite(fee) && fee > 0) {
      payable.push({ id: j.id, fee, model: j.model || 'Unknown', ref_no: j.ref_no || j.id, status: j.status || '(none)' });
    } else {
      noFee.push({ id: j.id, ref_no: j.ref_no || j.id, status: j.status || '(none)', receive_method: j.receive_method || '(none)' });
    }
  }
  return { payable, noFee };
}

const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('th-TH') : String(n));

async function main() {
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();

  console.log(`[settle-pending-rider-fees] โหมด: ${APPLY ? 'APPLY — เขียนจริง' : 'DRY-RUN — ไม่เขียนอะไร'}`);

  // ไล่ตามไรเดอร์ (query index rider_id — ไม่กวาด /jobs ทั้ง node ตามกฎค่า RTDB)
  const ridersSnap = await db.ref('riders').once('value');
  const riderIds = ridersSnap.exists() ? Object.keys(ridersSnap.val()) : [];

  const now = Date.now();
  const updates = {};
  let totalFee = 0;
  let totalCount = 0;
  const allNoFee = [];

  for (const rid of riderIds) {
    const jobsSnap = await db.ref('jobs').orderByChild('rider_id').equalTo(rid).once('value');
    const jobs = jobsSnap.exists() ? Object.entries(jobsSnap.val()).map(([id, j]) => ({ id, ...(j || {}) })) : [];
    const { payable, noFee } = planSettlement(jobs);
    allNoFee.push(...noFee.map((j) => ({ ...j, rider_id: rid })));

    console.log(`\nrider ${rid}: settle ได้ ${payable.length} ใบ · ไม่มี fee ${noFee.length} ใบ`);
    for (const j of payable) {
      totalFee += j.fee;
      totalCount += 1;
      updates[`jobs/${j.id}/rider_fee_status`] = 'Paid';
      updates[`jobs/${j.id}/settled_at`] = now;
      const txKey = db.ref('transactions').push().key;
      updates[`transactions/${txKey}`] = {
        rider_id: rid,
        amount: j.fee,
        type: 'CREDIT',
        category: 'JOB_PAYOUT',
        description: `ค่าเที่ยวงาน ${j.model} (${j.ref_no}) [Backfill Settle]`,
        timestamp: now,
        ref_job_id: j.id,
      };
      console.log(`  ${j.id} [${j.status}] ${j.ref_no}: ฿${fmt(j.fee)}`);
    }
  }

  console.log(`\nรวม settle: ${totalCount} ใบ ฿${fmt(totalFee)}`);
  console.log(`\nใบที่ไม่มี rider_fee (ไม่แตะ — ให้เจ้าของตัดสินฐานเงินก่อน): ${allNoFee.length} ใบ`);
  const byStatus = {};
  for (const j of allNoFee) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  for (const [st, n] of Object.entries(byStatus)) console.log(`   - status ${st}: ${n} ใบ`);
  allNoFee.forEach((j) => console.log(`     ${j.id} [${j.status}] ${j.ref_no} (${j.receive_method})`));

  if (!APPLY) {
    console.log('\nDRY-RUN จบ — ตรวจรายการแล้วรันซ้ำด้วย --apply');
    process.exit(0);
  }
  if (totalCount === 0) {
    console.log('\nไม่มีใบให้ settle — จบ');
    process.exit(0);
  }
  await db.ref().update(updates);
  console.log(`\nเขียนแล้ว ${totalCount} ใบ (${Object.keys(updates).length} path) — ตรวจรับด้วย audit-rider-wallet.cjs`);
  process.exit(0);
}

module.exports = { planSettlement };

if (require.main === module) {
  main().catch((e) => {
    console.error('[settle-pending-rider-fees] ล้มเหลว:', e);
    process.exit(1);
  });
}
