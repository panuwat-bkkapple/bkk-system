#!/usr/bin/env node
/**
 * เฟส 3 ของแผนแก้กระเป๋าเงินไรเดอร์ — retag แถว LOGISTICS_REVENUE เก่า
 * (ดู bkk-rider-app docs/reports/2026-08-31-rider-wallet-fix-plan.md)
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/backfill-logistics-revenue.cjs            # dry-run (ค่าเริ่มต้น)
 *     node scripts/backfill-logistics-revenue.cjs --apply    # เขียนจริง
 *
 * เป้า: แถว /transactions ที่ category === 'LOGISTICS_REVENUE' และ
 * rider_id !== 'SYSTEM' (จุดเขียนเก่าประทับ rider_id ของไรเดอร์ — วัดจริง
 * เฟส 0: 15 แถว). ต่อแถวเขียน:
 *   - rider_id: 'SYSTEM'            (แถวรายได้บริษัท ไม่ใช่เงินไรเดอร์)
 *   - retagged_from / retagged_at   (เก็บของเดิมไว้ audit ได้ ไม่ทำลายประวัติ)
 *   - amount_basis: 'legacy_rider_fee'  (บอกคนอ่านย้อนหลังว่ายอดแถวนี้คือ
 *     ต้นทุนไรเดอร์ ไม่ใช่ค่าบริการที่เก็บจริงตามนิยามใหม่)
 *   - amount_customer_fee           (เลขที่ถูกตามนิยามใหม่ คำนวณจาก job ผ่าน
 *     ref_job_id — รอบที่ join ครบแบบนี้คือรอบนี้รอบเดียว) หรือ null +
 *     amount_customer_fee_missing_reason เมื่อคำนวณไม่ได้
 *
 * **ไม่แตะ `amount` เดิมเด็ดขาด** (หลักการข้อ 4 ของแผน: ledger คือบันทึกประวัติ)
 *
 * สูตร amount_customer_fee = MIRROR ของ src/utils/logisticsRevenue.ts
 * (effectiveCustomerPickupFee — สคริปต์ CJS import TS ไม่ได้):
 *   Pickup เท่านั้น · max(0, pickup_fee − rider_fee_discount) · คูปองส่งฟรี
 *   (type 'service' ใน applied_coupons[] หรือ applied_coupon เดี่ยว) = 0
 * แก้สูตรฝั่งไหนต้องแก้อีกฝั่งด้วย
 *
 * idempotent: แถวที่มี retagged_at อยู่แล้วถูกข้าม — รันซ้ำไม่เขียนซ้ำ
 * ตรวจรับ: รัน scripts/audit-rider-wallet.cjs ซ้ำ → "ส่วนที่บวม" ต้องเป็น 0
 */
'use strict';

const path = require('path');

const APPLY = process.argv.includes('--apply');

/** MIRROR: src/utils/logisticsRevenue.ts — listAppliedCoupons + service check */
function hasFreeDeliveryCoupon(job) {
  const raw = job && job.applied_coupons;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const present = list.filter(Boolean);
  const coupons = present.length > 0 ? present : (job && job.applied_coupon ? [job.applied_coupon] : []);
  return coupons.some((c) => c && c.type === 'service');
}

/** MIRROR: src/utils/logisticsRevenue.ts — effectiveCustomerPickupFee */
function effectiveCustomerPickupFee(job) {
  if (!job || job.receive_method !== 'Pickup') return 0;
  if (hasFreeDeliveryCoupon(job)) return 0;
  const gross = Number(job.pickup_fee || 0);
  const discount = Number(job.rider_fee_discount || 0);
  return Math.max(0, gross - discount);
}

/** เลือกแถวเป้าจาก transactions map — pure, smoke-test ได้โดยไม่ต่อ Firebase */
function collectTargets(txMap) {
  const targets = [];
  const skippedRetagged = [];
  for (const [id, t] of Object.entries(txMap || {})) {
    if (!t || t.category !== 'LOGISTICS_REVENUE') continue;
    const rid = String(t.rider_id ?? '');
    if (rid === 'SYSTEM') continue;
    if (t.retagged_at) { skippedRetagged.push(id); continue; }
    targets.push({ id, rider_id: rid, amount: t.amount ?? null, ref_job_id: t.ref_job_id ?? null });
  }
  return { targets, skippedRetagged };
}

/** สร้าง patch ของหนึ่งแถวจาก job ที่ join มา — pure */
function buildRetagPatch(target, jobInfo, now) {
  const patch = {
    rider_id: 'SYSTEM',
    retagged_from: target.rider_id,
    retagged_at: now,
    amount_basis: 'legacy_rider_fee',
  };
  if (jobInfo && jobInfo.job) {
    patch.amount_customer_fee = effectiveCustomerPickupFee(jobInfo.job);
  } else {
    patch.amount_customer_fee = null;
    patch.amount_customer_fee_missing_reason = target.ref_job_id
      ? 'job_not_found'
      : 'no_ref_job_id';
  }
  return patch;
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

  console.log(`[backfill-logistics-revenue] โหมด: ${APPLY ? 'APPLY — เขียนจริง' : 'DRY-RUN — ไม่เขียนอะไร'}`);

  const txSnap = await db.ref('transactions').once('value');
  const { targets, skippedRetagged } = collectTargets(txSnap.val() || {});
  console.log(`เป้า retag: ${targets.length} แถว · ข้าม (retag ไปแล้ว): ${skippedRetagged.length} แถว`);

  // join ไป job รายใบ — อ่านเฉพาะฟิลด์ที่สูตรใช้ ไม่ดึง job เต็มก้อน
  const FIELDS = ['receive_method', 'pickup_fee', 'rider_fee_discount', 'applied_coupons', 'applied_coupon'];
  async function fetchJobSlice(jobId) {
    for (const root of ['jobs', 'jobs_archived']) {
      const exists = await db.ref(`${root}/${jobId}/receive_method`).once('value');
      if (!exists.exists()) continue;
      const job = {};
      for (const f of FIELDS) {
        const s = await db.ref(`${root}/${jobId}/${f}`).once('value');
        if (s.exists()) job[f] = s.val();
      }
      return { root, job };
    }
    return null;
  }

  const now = Date.now();
  const updates = {};
  let missing = 0;
  for (const t of targets) {
    const jobInfo = t.ref_job_id ? await fetchJobSlice(t.ref_job_id) : null;
    const patch = buildRetagPatch(t, jobInfo, now);
    if (patch.amount_customer_fee === null) missing += 1;
    for (const [k, v] of Object.entries(patch)) updates[`transactions/${t.id}/${k}`] = v;
    console.log(
      `  ${t.id}: rider ${t.rider_id} -> SYSTEM · amount เดิม ${fmt(t.amount)} (คงไว้) · ` +
      `amount_customer_fee ${patch.amount_customer_fee === null ? `null (${patch.amount_customer_fee_missing_reason})` : fmt(patch.amount_customer_fee)}` +
      (jobInfo ? ` [job ใน ${jobInfo.root}]` : ''),
    );
  }
  if (missing) console.log(`หมายเหตุ: ${missing} แถวคำนวณ amount_customer_fee ไม่ได้ — มี missing_reason กำกับต่อแถว`);

  if (!APPLY) {
    console.log('\nDRY-RUN จบ — ตรวจรายการด้านบนแล้วรันซ้ำด้วย --apply เพื่อเขียนจริง');
    process.exit(0);
  }
  if (targets.length === 0) {
    console.log('\nไม่มีแถวให้ retag — จบ');
    process.exit(0);
  }

  await db.ref().update(updates); // batch เดียว atomic
  console.log(`\nเขียนแล้ว ${targets.length} แถว (${Object.keys(updates).length} path) — ` +
    'ตรวจรับด้วย: node scripts/audit-rider-wallet.cjs (ส่วนที่บวมต้องเป็น 0)');
  process.exit(0);
}

module.exports = { collectTargets, buildRetagPatch, effectiveCustomerPickupFee, hasFreeDeliveryCoupon };

if (require.main === module) {
  main().catch((e) => {
    console.error('[backfill-logistics-revenue] ล้มเหลว:', e);
    process.exit(1);
  });
}
