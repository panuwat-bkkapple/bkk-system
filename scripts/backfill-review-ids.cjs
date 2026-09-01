#!/usr/bin/env node
/**
 * Backfill jobs/{id}/review_id จากแถวรีวิวเก่า — งานที่ลูกค้ารีวิวไปก่อน
 * review submit จะเริ่มเขียน review_id (bkk-frontend-next PR #920) มีแค่ธง
 * is_reviewed จึงโชว์ดาว/คอมเมนต์ใน bottom sheet ของแอปไรเดอร์ไม่ได้
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/backfill-review-ids.cjs            # dry-run (ค่าเริ่มต้น)
 *     node scripts/backfill-review-ids.cjs --apply    # เขียนจริง
 *
 * กติกา:
 *   - join ด้วย reviews/{id}.job_id ซึ่งมีทุกแถวตั้งแต่แรก (อ่าน /reviews
 *     ทั้งก้อนหนึ่งครั้ง — สคริปต์ manual ครั้งเดียว เป็นข้อยกเว้นตามกฎค่า
 *     RTDB แบบเดียวกับ audit/backfill ตัวอื่น)
 *   - เขียนเฉพาะงานที่ยังไม่มี review_id — idempotent รันซ้ำไม่ทับของใหม่
 *     ที่ route เขียนเอง และไม่ทับกรณีมีสองรีวิวชี้งานเดียว (ใบแรกที่เจอชนะ
 *     แล้วรายงานใบซ้ำให้เห็น)
 *   - งานที่หายไปแล้ว (ลบ/archive) = รายงาน ไม่สร้างโหนดผี
 *   - แถมความถูกต้อง: งานที่ได้ review_id แต่ is_reviewed ยังไม่ true
 *     จะถูกเซ็ตให้ด้วย (ควรเป็น true อยู่แล้วจาก route — กันข้อมูลยุคเก่า)
 *
 * ตรวจรับ: รันซ้ำแบบ dry-run ต้องรายงาน "เขียน 0 งาน"
 */
'use strict';

const path = require('path');

const APPLY = process.argv.includes('--apply');

/** วางแผนการเขียนจากข้อมูลทั้งสองก้อน — pure, smoke-test ได้ */
function planBackfill(reviews, jobs) {
  const writes = []; // { jobId, reviewId, setReviewedFlag }
  const jobMissing = []; // { reviewId, jobId }
  const duplicate = []; // { reviewId, jobId, keptReviewId }
  const claimed = new Map(); // jobId -> reviewId ที่ถือสิทธิ์แล้ว (มีอยู่เดิมหรือแผนนี้)

  for (const [jobId, job] of Object.entries(jobs)) {
    if (job && typeof job.review_id === 'string' && job.review_id) claimed.set(jobId, job.review_id);
  }

  for (const [reviewId, review] of Object.entries(reviews)) {
    const jobId = review && typeof review.job_id === 'string' ? review.job_id : null;
    if (!jobId) continue;
    const job = jobs[jobId];
    if (!job) {
      jobMissing.push({ reviewId, jobId });
      continue;
    }
    const holder = claimed.get(jobId);
    if (holder) {
      if (holder !== reviewId) duplicate.push({ reviewId, jobId, keptReviewId: holder });
      continue;
    }
    claimed.set(jobId, reviewId);
    writes.push({ jobId, reviewId, setReviewedFlag: job.is_reviewed !== true });
  }

  return { writes, jobMissing, duplicate };
}

async function main() {
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();

  console.log(`[backfill-review-ids] โหมด: ${APPLY ? 'APPLY — เขียนจริง' : 'DRY-RUN — ไม่เขียนอะไร'}`);

  const reviewsSnap = await db.ref('reviews').once('value');
  const reviews = reviewsSnap.exists() ? reviewsSnap.val() : {};
  const reviewIds = Object.keys(reviews);
  console.log(`รีวิวทั้งหมด: ${reviewIds.length} แถว`);

  // ดึงเฉพาะงานที่รีวิวชี้ถึง — ไม่กวาด /jobs ทั้ง node
  const jobs = {};
  const wantedJobIds = [...new Set(reviewIds.map((id) => reviews[id]?.job_id).filter((v) => typeof v === 'string' && v))];
  for (const jobId of wantedJobIds) {
    const snap = await db.ref(`jobs/${jobId}`).once('value');
    if (snap.exists()) jobs[jobId] = snap.val();
  }

  const { writes, jobMissing, duplicate } = planBackfill(reviews, jobs);

  for (const w of writes) {
    console.log(`  jobs/${w.jobId}: review_id = ${w.reviewId}${w.setReviewedFlag ? ' (+is_reviewed)' : ''}`);
  }
  console.log(`\nจะเขียน ${writes.length} งาน`);
  if (duplicate.length) {
    console.log(`รีวิวซ้ำงานเดียวกัน (ไม่แตะ — ใบที่ถือสิทธิ์อยู่ชนะ): ${duplicate.length}`);
    duplicate.forEach((d) => console.log(`   - ${d.reviewId} ชี้ ${d.jobId} (คงไว้ ${d.keptReviewId})`));
  }
  if (jobMissing.length) {
    console.log(`รีวิวที่งานหายไปแล้ว (ลบ/archive — ข้าม): ${jobMissing.length}`);
    jobMissing.forEach((m) => console.log(`   - ${m.reviewId} ชี้ ${m.jobId}`));
  }

  if (!APPLY) {
    console.log('\nDRY-RUN จบ — ตรวจรายการแล้วรันซ้ำด้วย --apply');
    process.exit(0);
  }
  if (writes.length === 0) {
    console.log('\nไม่มีอะไรให้เขียน — จบ');
    process.exit(0);
  }
  const updates = {};
  for (const w of writes) {
    updates[`jobs/${w.jobId}/review_id`] = w.reviewId;
    if (w.setReviewedFlag) updates[`jobs/${w.jobId}/is_reviewed`] = true;
  }
  await db.ref().update(updates);
  console.log(`\nเขียนแล้ว ${writes.length} งาน (${Object.keys(updates).length} path) — รัน dry-run ซ้ำต้องได้ 0`);
  process.exit(0);
}

module.exports = { planBackfill };

if (require.main === module) {
  main().catch((e) => {
    console.error('[backfill-review-ids] ล้มเหลว:', e);
    process.exit(1);
  });
}
