#!/usr/bin/env node
/**
 * แก้ป้ายหมวดของแถวปรับค่ารอบที่ลงไว้ก่อนมีหมวด ADJUSTMENT
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/relabel-pin-dispute-tx.cjs <jobId>            # dry-run
 *     node scripts/relabel-pin-dispute-tx.cjs <jobId> --apply
 *
 * ที่มา: ก่อน 1 ก.ย. 2569 การคิดค่ารอบใหม่หลังอนุมัติคำแย้งหมุดลง ledger
 * เป็น PENALTY (ทิศลบ) กับ JOB_PAYOUT (ทิศบวก) ซึ่งผิดทั้งคู่ — มันคือการ
 * **แก้ตัวเลขที่คิดผิด** ไม่ใช่ค่าปรับไรเดอร์ และไม่ใช่ค่ารอบงานใหม่. ผลคือ
 * กระเป๋าไรเดอร์ขึ้นคำว่า "รายการหัก" ให้คนที่ไม่ได้ทำอะไรผิด
 *
 * โค้ดถูกแก้ไปแล้ว (หมวด ADJUSTMENT ทั้งสองทิศ) แต่มีผลกับแถวใหม่เท่านั้น
 * สคริปต์นี้ตามไปแก้ป้ายของแถวเดิม
 *
 * กติกา:
 *   - **แก้เฉพาะ `category` ไม่แตะจำนวนเงิน/เวลา/คำอธิบาย/ref_job_id**
 *     ยอดในกระเป๋าจึงเป็นตัวเลขเดิมเป๊ะ เปลี่ยนแค่ป้ายที่ติดผิด
 *   - **เก็บร่องรอยไว้เสมอ** (`category_was` / `category_corrected_at` /
 *     `category_correction_reason`) — การแก้ประวัติแบบทับเงียบๆ คือสิ่งที่
 *     ledger มีไว้กัน ป้ายเก่าต้องยังอ่านย้อนได้ว่าเคยเป็นอะไร
 *   - **เข้าถึงแถวผ่าน pin_dispute เท่านั้น** (`delta_tx_id` + `revert_tx_id`)
 *     ห้าม scan /transactions หา PENALTY แล้วแก้ยกชุด — ค่าปรับจริงมีอยู่จริง
 *     และเป็นคนละเรื่อง (กฎค่า RTDB ก็ห้ามกวาดทั้ง node อยู่แล้ว)
 *   - แถวที่ `ref_job_id` ไม่ตรงกับงานนี้ = ไม่แตะ (กัน id ที่ค้างผิดใบ)
 *   - idempotent: แถวที่เป็น ADJUSTMENT แล้วถูกข้าม รันซ้ำได้ผล 0 แถว
 */
'use strict';

const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const jobId = args.find((a) => !a.startsWith('--'));

const TARGET = 'ADJUSTMENT';
/** ป้ายที่ยอมให้แก้ — หมวดอื่นแปลว่าแถวไม่ใช่สิ่งที่เราคิด ให้หยุดแล้วรายงาน */
const RELABELABLE = new Set(['PENALTY', 'JOB_PAYOUT']);
const REASON = 'pin_dispute fee correction — ไม่ใช่ค่าปรับ/ค่ารอบใหม่';

/**
 * วางแผนการแก้ป้าย — pure, เทสได้
 * @param {string} jobId
 * @param {object} job งานที่มี pin_dispute
 * @param {Record<string, object>} txs แถว ledger ที่อ่านมาแล้ว (key -> row)
 * @param {number} now
 */
function planRelabel(jobId, job, txs, now) {
  const d = job && job.pin_dispute;
  if (!d) return { error: 'งานนี้ไม่มีคำแย้งหมุด' };

  const keys = [d.delta_tx_id, d.revert_tx_id].filter((k) => typeof k === 'string' && k);
  if (keys.length === 0) return { error: 'คำแย้งนี้ไม่เคยลงแถวใน ledger จึงไม่มีป้ายให้แก้' };

  const updates = {};
  const changed = [];
  const skipped = [];

  for (const key of keys) {
    const row = txs[key];
    if (!row) {
      skipped.push({ key, why: 'ไม่พบแถวนี้ใน /transactions' });
      continue;
    }
    if (row.ref_job_id && row.ref_job_id !== jobId) {
      skipped.push({ key, why: `แถวนี้อ้างงาน ${row.ref_job_id} ไม่ใช่ ${jobId}` });
      continue;
    }
    const current = String(row.category ?? '');
    if (current === TARGET) {
      skipped.push({ key, why: 'เป็น ADJUSTMENT อยู่แล้ว' });
      continue;
    }
    if (!RELABELABLE.has(current)) {
      skipped.push({ key, why: `หมวด '${current}' ไม่อยู่ในชุดที่ยอมให้แก้` });
      continue;
    }
    updates[`transactions/${key}/category`] = TARGET;
    updates[`transactions/${key}/category_was`] = current;
    updates[`transactions/${key}/category_corrected_at`] = now;
    updates[`transactions/${key}/category_correction_reason`] = REASON;
    changed.push({ key, from: current, to: TARGET, type: row.type, amount: row.amount });
  }

  return { updates, changed, skipped };
}

async function main() {
  if (!jobId) {
    console.error('ใช้: node scripts/relabel-pin-dispute-tx.cjs <jobId> [--apply]');
    process.exit(1);
  }
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();

  console.log(`[relabel-pin-dispute-tx] งาน ${jobId} — โหมด: ${APPLY ? 'APPLY — เขียนจริง' : 'DRY-RUN — ไม่เขียนอะไร'}`);

  const jobSnap = await db.ref(`jobs/${jobId}`).once('value');
  if (!jobSnap.exists()) {
    console.error('ไม่พบงานนี้');
    process.exit(1);
  }
  const job = jobSnap.val();
  const d = job.pin_dispute || {};

  // อ่านทีละแถวตาม id ที่คำแย้งชี้ ไม่ query /transactions
  const txs = {};
  for (const key of [d.delta_tx_id, d.revert_tx_id]) {
    if (typeof key !== 'string' || !key) continue;
    const snap = await db.ref(`transactions/${key}`).once('value');
    if (snap.exists()) txs[key] = snap.val();
  }

  const plan = planRelabel(jobId, job, txs, Date.now());
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }

  for (const c of plan.changed) {
    console.log(`  ${c.key}: ${c.from} -> ${c.to}  (${c.type} ${c.amount})`);
  }
  for (const s of plan.skipped) {
    console.log(`  ข้าม ${s.key}: ${s.why}`);
  }
  console.log(`\nจะแก้ ${plan.changed.length} แถว (${Object.keys(plan.updates).length} path)`);

  if (!APPLY) {
    console.log('DRY-RUN จบ — ตรวจแล้วรันซ้ำด้วย --apply');
    process.exit(0);
  }
  if (plan.changed.length === 0) {
    console.log('ไม่มีอะไรให้แก้ — จบ');
    process.exit(0);
  }
  await db.ref().update(plan.updates);
  console.log('\nเขียนแล้ว — รัน dry-run ซ้ำต้องได้ 0 แถว และกระเป๋าต้องขึ้นว่า "ปรับปรุงค่ารอบ"');
  process.exit(0);
}

module.exports = { planRelabel };

if (require.main === module) {
  main().catch((e) => {
    console.error('[relabel-pin-dispute-tx] ล้มเหลว:', e);
    process.exit(1);
  });
}
