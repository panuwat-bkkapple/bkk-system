#!/usr/bin/env node
/**
 * เติมแถว qc_logs ที่หายไป โดยสร้างจาก status_history ของงานเดียวกัน
 *
 * ที่มา: ตั้งแต่ writer ตัวแรกของแอปไรเดอร์ย้ายมาที่ engine (bkk-rider-app
 * #128, deploy 1 ก.ย. 2569 17:53) จนถึงตอนที่ applyTransition เริ่มมิเรอร์
 * qc_logs (#636, deploy 19:02) การเปลี่ยนสถานะทุกครั้งเขียนแต่ status_history
 * ซึ่ง **ไม่มีหน้าไหนใน bkk-system อ่าน** ทุกขั้นของไรเดอร์ในช่วงนั้นจึงหาย
 * จากไทม์ไลน์ที่แอดมินเปิดดู (Traceability สร้างจาก qc_logs ตรงๆ)
 *
 * กู้ได้เพราะ status_history มีครบทุกแถว — สคริปต์นี้อ่านมันแล้วเติมแถวที่
 * ยังไม่มีคู่ใน qc_logs กลับเข้าไป
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_DATABASE_URL=... \
 *     node scripts/backfill-qc-logs-from-history.mjs           # dry-run (ค่าเริ่มต้น)
 *     node scripts/backfill-qc-logs-from-history.mjs --apply   # เขียนจริง
 *
 * กติกา:
 *   - **จับคู่ด้วย timestamp** — applyTransition เขียน status_history.at กับ
 *     qc_logs.timestamp ด้วยค่า `at` ตัวเดียวกันเสมอ แถวไหนมีคู่แล้วคือแถวที่
 *     เกิดหลัง #636 ข้ามไป **สคริปต์จึง idempotent รันซ้ำได้ ไม่สร้างของซ้ำ**
 *   - แถว qc_logs ยุคเก่า (client เขียนเอง) ใช้ Date.now() คนละจังหวะกับ
 *     history จึงไม่มีทางชนกันโดยบังเอิญ
 *   - เรียงใหม่ก่อนเก่าตาม timestamp เหมือนที่ทุก writer ของโหนดนี้ทำ
 *   - เขียนด้วย transaction ต่องาน ไม่ใช่ update ทับทั้ง array — งานที่แอดมิน
 *     กำลังแก้อยู่พร้อมกันจะไม่ถูกกลบ (เป็นเหตุผลเดียวกับที่ engine ใช้
 *     transaction)
 *   - ไม่แตะงานที่ไม่มี status_history เลย (ยุคก่อน engine ทั้งหมด)
 *
 * ตรวจรับ: รัน --apply แล้วรัน dry-run ซ้ำ ต้องรายงาน "เติม 0 แถว"
 */

/** รายละเอียดของแถว qc_logs ที่สร้างจาก history entry หนึ่งแถว */
export function qcRowFromHistory(entry) {
  return {
    action: entry.to,
    by: entry.by || entry.actor || 'system',
    timestamp: entry.at,
    details: entry.reason || `${entry.from} -> ${entry.to} (${entry.event})`,
  };
}

const asArray = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
};

/**
 * วางแผนต่อหนึ่งงาน — pure
 *
 * คืน null เมื่อไม่มีอะไรต้องเติม (ไม่มี history / มีคู่ครบแล้ว) เพื่อให้ผู้เรียก
 * ข้ามงานนั้นไปโดยไม่ต้องเปิด transaction
 */
export function planJobBackfill(job) {
  const history = asArray(job && job.status_history).filter(
    (e) => e && typeof e.at === 'number' && e.to
  );
  if (history.length === 0) return null;

  const logs = asArray(job && job.qc_logs);
  const seen = new Set(logs.map((l) => l && l.timestamp).filter((t) => typeof t === 'number'));

  const missing = history.filter((e) => !seen.has(e.at));
  if (missing.length === 0) return null;

  const merged = [...logs, ...missing.map(qcRowFromHistory)].sort(
    (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
  );
  return { qcLogs: merged, added: missing.length };
}

// ── ตัวรัน (ไม่ทำงานตอนถูก import โดยเทส) ──────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('backfill-qc-logs-from-history.mjs');
if (isMain) {
  const APPLY = process.argv.includes('--apply');
  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  initializeApp({
    credential: credPath ? cert((await import('node:fs')).readFileSync(credPath, 'utf8') && JSON.parse((await import('node:fs')).readFileSync(credPath, 'utf8'))) : applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  const db = getDatabase();

  const snap = await db.ref('jobs').once('value');
  const jobs = snap.val() || {};
  const planned = [];
  for (const [jobId, job] of Object.entries(jobs)) {
    const plan = planJobBackfill(job);
    if (plan) planned.push({ jobId, ...plan });
  }

  const totalRows = planned.reduce((n, p) => n + p.added, 0);
  console.log(`${APPLY ? 'เขียนจริง' : 'dry-run'}: ${planned.length} งาน / เติม ${totalRows} แถว`);
  for (const p of planned) console.log(`  ${p.jobId}  +${p.added}`);

  if (APPLY) {
    let committed = 0;
    for (const p of planned) {
      // transaction เพื่อไม่กลบแถวที่เพิ่งถูกเขียนระหว่างสคริปต์กำลังรัน —
      // วางแผนใหม่จากค่าสดทุกครั้ง ไม่ใช้แผนที่คำนวณไว้ตอนอ่านรอบแรก
      const res = await db.ref(`jobs/${p.jobId}`).transaction((current) => {
        if (current === null) return current;
        const fresh = planJobBackfill(current);
        if (!fresh) return; // ไม่มีอะไรต้องเติมแล้ว — ยกเลิกโดยไม่เขียน
        return { ...current, qc_logs: fresh.qcLogs };
      });
      if (res.committed) committed++;
    }
    console.log(`เขียนสำเร็จ ${committed} งาน`);
  } else {
    console.log('\nยังไม่เขียนอะไร — ใส่ --apply เพื่อเขียนจริง');
  }
  process.exit(0);
}
