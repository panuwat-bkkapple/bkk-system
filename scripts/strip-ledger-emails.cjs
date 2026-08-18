#!/usr/bin/env node
/**
 * แทนที่อีเมลพนักงานใน `price_ledger/{id}/updated_by` ด้วย uid
 *
 *   node scripts/strip-ledger-emails.cjs            # ดูอย่างเดียว ไม่เขียนอะไร (ค่าเริ่มต้น)
 *   node scripts/strip-ledger-emails.cjs --apply    # เขียนจริง
 *   ... เติม --limit=500 เพื่อทยอยทำเป็นชุด
 *
 * ทำไมต้องมี: `price_ledger` เป็นโหนดที่ `.read: true` โดยตั้งใจ (เปิดให้ลูกค้าดู
 * ประวัติการเปลี่ยนราคา) แต่ทุกแถวถือ `updated_by` เป็น **อีเมลจริงของพนักงาน** —
 * แปลว่า `curl .../price_ledger.json` คำสั่งเดียวได้ทะเบียนอีเมลทีมทั้งชุด โดยไม่
 * ต้อง login. ต้นทางถูกแก้ไปแล้ว (PriceEditor + BatchPriceAdjustModal เขียน uid)
 * สคริปต์นี้เก็บกวาดแถวเก่าที่เขียนไว้ก่อนหน้านั้น
 *
 * แปลงเป็นอะไร:
 *   - อีเมลที่ map เข้ากับ staff record ได้  -> uid ของคนนั้น (audit ภายในยังใช้ได้)
 *   - อีเมลที่ map ไม่ได้ (คนลาออก/บัญชีเก่า) -> "admin"
 *   - ค่าที่ไม่ใช่รูปอีเมล (uid, "System Admin") -> ไม่แตะ
 *
 * วิธีรัน:
 *   cd functions && npm ci        # ถ้ายังไม่มี node_modules
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   FIREBASE_DATABASE_URL=https://<db>.asia-southeast1.firebasedatabase.app \
 *     node ../scripts/strip-ledger-emails.cjs
 *
 * หมายเหตุค่า RTDB: อ่าน `price_ledger` ทั้ง node หนึ่งครั้ง — เป็น one-off ที่รัน
 * ด้วยมือ ไม่ใช่ scheduler จึงเป็นข้อยกเว้นเดียวกับ endpoint migration ตาม CLAUDE.md
 * และเขียนกลับเป็น batch update ก้อนเดียว ไม่ใช่รายแถว
 */
const admin = require(require('path').join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

/** รูปอีเมลแบบหลวมๆ พอสำหรับงานนี้: มี @ และมีจุดหลัง @ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  const db = admin.database();

  // แผนที่อีเมล -> uid จากทะเบียนพนักงาน (อีเมลเก็บเป็น lowercase ตาม
  // useStaffSession/lookupStaffByAuth)
  const staffSnap = await db.ref('staff').once('value');
  const emailToUid = new Map();
  staffSnap.forEach((child) => {
    const s = child.val() || {};
    const email = String(s.email || '').trim().toLowerCase();
    const uid = String(s.uid || '').trim();
    if (email && uid) emailToUid.set(email, uid);
    return false;
  });
  console.log(`[strip-ledger] staff ที่มี uid: ${emailToUid.size} คน`);

  const snap = await db.ref('price_ledger').once('value');
  const updates = {};
  let total = 0;
  let emails = 0;
  let mapped = 0;
  let unmapped = 0;
  const byValue = new Map();

  snap.forEach((child) => {
    total += 1;
    const row = child.val() || {};
    const by = String(row.updated_by || '');
    if (!EMAIL_RE.test(by)) return false;

    emails += 1;
    byValue.set(by, (byValue.get(by) || 0) + 1);
    if (Object.keys(updates).length >= LIMIT) return false;

    const uid = emailToUid.get(by.toLowerCase());
    if (uid) mapped += 1;
    else unmapped += 1;
    updates[`price_ledger/${child.key}/updated_by`] = uid || 'admin';
    return false;
  });

  console.log(`[strip-ledger] แถวทั้งหมด ${total}`);
  console.log(`[strip-ledger] แถวที่ updated_by เป็นอีเมล ${emails}`);
  console.log(`[strip-ledger]   map เป็น uid ได้ ${mapped} · map ไม่ได้ (จะเป็น "admin") ${unmapped}`);
  console.log('[strip-ledger] อีเมลที่พบ (จำนวนแถวต่อคน):');
  for (const [email, n] of [...byValue.entries()].sort((a, b) => b[1] - a[1])) {
    // พิมพ์แบบ mask — สคริปต์ที่แก้ปัญหาอีเมลรั่วไม่ควรพ่นอีเมลเต็มลง log
    const [local, domain] = email.split('@');
    console.log(`  ${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}  ${n} แถว`);
  }

  if (!APPLY) {
    console.log(`\n[strip-ledger] โหมดดูอย่างเดียว — ยังไม่เขียนอะไร`);
    console.log(`[strip-ledger] จะแก้ ${Object.keys(updates).length} แถว · รันซ้ำด้วย --apply เพื่อเขียนจริง`);
    return;
  }

  await db.ref().update(updates);
  console.log(`\n[strip-ledger] เขียนแล้ว ${Object.keys(updates).length} แถว`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[strip-ledger] ล้มเหลว:', e);
    process.exit(1);
  });
