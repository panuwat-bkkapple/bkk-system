#!/usr/bin/env node
/**
 * ตอบคำถาม Q7 ของ spec ด้วยข้อมูล: กองงานที่ `Pending QC` (121) กับ
 * `Sent to QC Lab` (92) — ครึ่งหนึ่งของงาน live ทั้งระบบ — เท่าไหร่คือ
 * **backlog จริง** (งานที่ยังต้องทำ) เท่าไหร่คือ **"จบแล้วแต่ไม่มีใครกดต่อ"**
 *
 * ทำไมต้องตอบก่อน migration: ถ้าเป็นอย่างหลังเป็นส่วนใหญ่ migration ต้องมี pass
 * พิเศษปิดงานเก่ายกชุด ไม่ใช่ลากทั้งกองเข้า enum ใหม่แล้วปล่อยให้ค้างต่อไปใน
 * ชื่อใหม่ — ซึ่งจะทำให้ทุก dashboard ที่นับ "งานค้าง" ผิดไปอีกหลายเดือน
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/audit-qc-backlog.mjs
 *
 * อ่านอย่างเดียว ไม่เขียนอะไรเลย
 *
 * วิธีอ่านผล: ดูการกระจายของอายุ
 *   - กระจุกที่ 0-7 วัน   -> backlog จริง คนทำงานตามปกติ ไม่ต้องมี pass พิเศษ
 *   - หางยาวเกิน 30-90 วัน -> งานที่ไม่มีใครกดต่อ ต้องปิดยกชุดตอน migration
 *   - ทั้งสองอย่าง         -> ตัด cutoff ตรงจุดที่หางเริ่ม แล้วปิดเฉพาะฝั่งเก่า
 */

const DAY = 86_400_000;

/** ป้ายอายุ — แยกเป็น pure function เพราะตัวเลขจากมันคือสิ่งที่ใช้ตัดสิน migration */
export function ageBucket(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'ไม่รู้';
  const d = ageMs / DAY;
  if (d < 7) return '0-7 วัน';
  if (d < 30) return '7-30 วัน';
  if (d < 90) return '30-90 วัน';
  if (d < 180) return '90-180 วัน';
  return 'เกิน 180 วัน';
}

export const BUCKET_ORDER = ['0-7 วัน', '7-30 วัน', '30-90 วัน', '90-180 วัน', 'เกิน 180 วัน', 'ไม่รู้'];

/**
 * เวลาล่าสุดที่ "มีคนแตะงานนี้จริง"
 *
 * ไม่ใช้ updated_at อย่างเดียว เพราะ trigger ฝั่ง server เขียนมันได้โดยไม่มีคน
 * เกี่ยวข้อง (เช่น mirror ไป public_track) งานที่ไม่มีใครแตะมาครึ่งปีจึงดูเหมือน
 * เพิ่งถูกแตะเมื่อวาน — ใช้เวลาล่าสุดจากไทม์ไลน์ที่คนเป็นคนสร้างแทน
 */
export function lastHumanTouch(job) {
  const stamps = [];
  const push = (v) => { if (typeof v === 'number' && v > 0) stamps.push(v); };
  push(job && job.completed_at);
  push(job && job.inspected_at);
  for (const raw of [job && job.qc_logs, job && job.status_history]) {
    const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    for (const e of arr) push(e && (e.timestamp || e.at));
  }
  if (stamps.length === 0) push(job && job.updated_at);
  return stamps.length ? Math.max(...stamps) : null;
}

/** สรุปทั้งกอง — pure ให้เทสได้ */
export function summarise(jobs, statuses, now) {
  const rows = [];
  for (const [jobId, job] of Object.entries(jobs || {})) {
    if (!job || !statuses.includes(job.status)) continue;
    const touched = lastHumanTouch(job);
    rows.push({
      jobId,
      status: job.status,
      receiveMethod: job.receive_method || '-',
      touched,
      bucket: touched ? ageBucket(now - touched) : 'ไม่รู้',
    });
  }
  const byBucket = {};
  for (const r of rows) {
    byBucket[r.status] = byBucket[r.status] || {};
    byBucket[r.status][r.bucket] = (byBucket[r.status][r.bucket] || 0) + 1;
  }
  return { rows, byBucket, total: rows.length };
}

const isMain = process.argv[1] && process.argv[1].endsWith('audit-qc-backlog.mjs');
if (isMain) {
  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const { readFileSync } = await import('node:fs');

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  initializeApp({
    credential: credPath ? cert(JSON.parse(readFileSync(credPath, 'utf8'))) : applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });

  const STATUSES = ['Pending QC', 'Sent to QC Lab'];
  const snap = await getDatabase().ref('jobs').once('value');
  const { rows, byBucket, total } = summarise(snap.val() || {}, STATUSES, Date.now());

  console.log(`งานที่ ${STATUSES.join(' / ')} รวม ${total} ใบ\n`);
  for (const status of STATUSES) {
    const b = byBucket[status] || {};
    console.log(status);
    for (const name of BUCKET_ORDER) {
      if (b[name]) console.log(`  ${name.padEnd(14)} ${b[name]}`);
    }
    console.log('');
  }

  console.log('--- รายใบ (TSV: jobId, status, receive_method, อายุวัน) ---');
  const now = Date.now();
  for (const r of rows.sort((a, b) => (a.touched || 0) - (b.touched || 0))) {
    const days = r.touched ? Math.round((now - r.touched) / DAY) : '';
    console.log(`${r.jobId}\t${r.status}\t${r.receiveMethod}\t${days}`);
  }
  process.exit(0);
}
