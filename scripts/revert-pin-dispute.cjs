#!/usr/bin/env node
/**
 * ย้อนการอนุมัติคำแย้งหมุด — คืนค่าวิ่งเดิม + ลงแถวชดเชยในกระเป๋าไรเดอร์
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/revert-pin-dispute.cjs <jobId>            # dry-run
 *     node scripts/revert-pin-dispute.cjs <jobId> --apply
 *
 * ที่มา (1 ก.ย. 2569, งาน -P0NC2QI6QGvm3GgwapK / OID-MTHBWFJJ-384):
 * อนุมัติคำแย้งไปแล้ว ค่าวิ่งถูกคิดใหม่จาก 290 เหลือ 186 แล้วพบทีหลังว่า
 * **หมุดลูกค้าถูกต้อง** (geocode ที่อยู่ตรงกับหมุด 0 กม.) ส่วนพิกัดเช็คอิน
 * คือจุดกลางทางขากลับ เพราะไรเดอร์กดสามสถานะรวดเดียวหลังออกจากลูกค้า
 * ค่าวิ่งเดิมจึงถูกอยู่แล้ว และไรเดอร์ถูกหักไป 104 บาทโดยไม่ควรโดน
 *
 * กติกา:
 *   - **ไม่ลบแถวเดิมใน ledger** — เขียนแถวชดเชยทิศตรงข้ามแทน เพื่อให้กระเป๋า
 *     เล่าความจริงว่า "หักแล้วคืน" ไม่ใช่ทำให้ประวัติหายไปเหมือนไม่เคยเกิด
 *   - คืน `rider_fee` เป็นค่าก่อนอนุมัติ (อ่านจาก pin_dispute.fee_before)
 *     พร้อม meta ที่บอกที่มาว่าเป็นการย้อน ไม่ใช่เลขที่คำนวณสด
 *   - คำแย้งถูกตีเป็น `reverted` (ไม่ใช่ลบทิ้ง) — ไรเดอร์กับแอดมินต้องเห็นว่า
 *     เคยมีคำแย้งและผลจบยังไง
 *   - **ไม่แตะ `pickup_fee`/`net_payout` ของลูกค้า** ตาม invariant #3
 *   - idempotent: ใบที่ย้อนแล้วรันซ้ำจะไม่ทำอะไร
 */
'use strict';

const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const jobId = args.find((a) => !a.startsWith('--'));

/** วางแผนการย้อน — pure, เทสได้ */
function planRevert(jobId, job, txKey, now) {
  const d = job && job.pin_dispute;
  if (!d) return { error: 'งานนี้ไม่มีคำแย้งหมุด' };
  if (d.status !== 'approved') return { error: `คำแย้งสถานะ '${d.status}' ไม่ใช่ 'approved' จึงไม่มีอะไรให้ย้อน` };

  const feeBefore = Number(d.fee_before);
  const feeAfter = Number(d.fee_after);
  if (!Number.isFinite(feeBefore) || !Number.isFinite(feeAfter)) {
    return { error: 'คำแย้งไม่มีตัวเลขก่อน/หลังครบ ย้อนอัตโนมัติไม่ได้' };
  }
  const delta = Math.round(feeAfter - feeBefore); // ที่เคยปรับไป
  const updates = {
    [`jobs/${jobId}/rider_fee`]: feeBefore,
    [`jobs/${jobId}/rider_fee_estimate`]: feeBefore,
    [`jobs/${jobId}/updated_at`]: now,
    [`jobs/${jobId}/pin_dispute`]: {
      ...d,
      status: 'reverted',
      reverted_at: now,
      revert_reason:
        'หมุดลูกค้าตรงกับที่อยู่ที่พิมพ์ — พิกัดเช็คอินเป็นจุดที่กดปุ่มระหว่างทาง ไม่ใช่จุดรับเครื่อง',
      fee_restored: feeBefore,
    },
  };
  const kmBefore = Number(d.distance_km_before);
  if (Number.isFinite(kmBefore)) {
    const meta = {
      distance_km: kmBefore,
      basis: 'reverted_pin_dispute',
      computed_at: now,
    };
    updates[`jobs/${jobId}/rider_fee_meta`] = meta;
    updates[`jobs/${jobId}/rider_fee_estimate_meta`] = meta;
  }

  // แถวชดเชย — ทิศตรงข้ามกับที่เคยลงไว้ และเฉพาะเมื่อเคยลง ledger จริง
  let ledger = null;
  if (d.delta_tx_id && delta !== 0) {
    ledger = {
      key: txKey,
      row: {
        rider_id: d.requested_by_rider_id,
        amount: Math.abs(delta),
        type: delta < 0 ? 'CREDIT' : 'DEBIT',
        category: delta < 0 ? 'JOB_PAYOUT' : 'PENALTY',
        description: `ย้อนการปรับค่ารอบ (หมุดลูกค้าถูกต้อง) ${job.model || 'งาน'} (${job.ref_no || job.OID || jobId})`,
        timestamp: now,
        ref_job_id: jobId,
        reverts_tx_id: d.delta_tx_id,
      },
    };
    updates[`transactions/${txKey}`] = ledger.row;
    updates[`jobs/${jobId}/pin_dispute`].revert_tx_id = txKey;
  }

  return { updates, feeBefore, feeAfter, delta, ledger };
}

async function main() {
  if (!jobId) {
    console.error('ใช้: node scripts/revert-pin-dispute.cjs <jobId> [--apply]');
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
  console.log(`[revert-pin-dispute] โหมด: ${APPLY ? 'APPLY — เขียนจริง' : 'DRY-RUN — ไม่เขียนอะไร'}`);

  const snap = await db.ref(`jobs/${jobId}`).once('value');
  if (!snap.exists()) {
    console.error(`ไม่พบงาน ${jobId}`);
    process.exit(1);
  }
  const job = snap.val();
  const txKey = db.ref('transactions').push().key;
  const plan = planRevert(jobId, job, txKey, Date.now());
  if (plan.error) {
    console.error(plan.error);
    process.exit(1);
  }

  console.log(`งาน: ${job.ref_no || job.OID || jobId} (${job.model || '-'})`);
  console.log(`ค่าวิ่ง: ${plan.feeAfter} -> คืนเป็น ${plan.feeBefore}`);
  console.log(`สถานะค่ารอบ: ${job.rider_fee_status || '(ไม่ระบุ)'}`);
  if (plan.ledger) {
    console.log(`แถวชดเชย: ${plan.ledger.row.type} ${plan.ledger.row.amount} (${plan.ledger.row.category}) ย้อนแถว ${plan.ledger.row.reverts_tx_id}`);
  } else {
    console.log('ไม่มีแถวชดเชย (คำแย้งนี้ไม่เคยลง ledger)');
  }
  console.log(`paths ที่จะเขียน: ${Object.keys(plan.updates).length}`);

  if (!APPLY) {
    console.log('\nDRY-RUN จบ — ตรวจแล้วรันซ้ำด้วย --apply');
    process.exit(0);
  }
  await db.ref().update(plan.updates);
  console.log('\nเขียนแล้ว — ตรวจรับด้วยการอ่าน jobs/<id>/rider_fee กับ pin_dispute.status (ต้องเป็น reverted)');
  process.exit(0);
}

module.exports = { planRevert };

if (require.main === module) {
  main().catch((e) => {
    console.error('[revert-pin-dispute] ล้มเหลว:', e);
    process.exit(1);
  });
}
