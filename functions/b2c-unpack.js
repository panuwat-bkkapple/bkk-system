// unpackMultiDeviceJob / onJobStatusUnpackMultiDevice — งาน B2C ที่มีหลายเครื่อง
// แตกเป็นงานลูกรายเครื่องตอนเข้าคิวคลัง
//
// ทำไมต้องมี
// ตะกร้าเว็บลูกค้าขายได้หลายเครื่องในใบเดียว (และปุ่ม "เพิ่มเครื่องแบบเดียวกัน"
// ทำให้เกิดบ่อยขึ้น) แต่ทุกอย่างหลังรับเครื่องของฝั่งแอดมินคิดเป็น "หนึ่งงาน =
// หนึ่งเครื่อง": QC Station มีฟอร์มเดียวต่องาน (IMEI เดียว แบตเดียว เกรดเดียว)
// หน้าคลังนับหนึ่งงานเป็นหนึ่งแถว POS ขายหนึ่งงานเป็นหนึ่งชิ้น. งานสองเครื่องจึง
// เคยกลายเป็น "เครื่อง" เดียวในคลังที่มีราคาสองเครื่องรวมกัน ไม่มี error ไหนบอก
//
// รูปที่ใช้คือรูปเดียวกับ B2B (b2b-unpack.js) และอุปกรณ์เสริม (src/utils/
// accessoryItems.ts): งานแม่ยังเป็นใบสั่งขายของลูกค้า (เงิน ใบสำคัญรับเงิน หน้า
// track คูปอง อยู่ที่นี่ทั้งหมดและไม่ถูกแตะ) ส่วน "เครื่อง" แต่ละใบกลายเป็นงานลูก
// ที่เข้า Pending QC แยกกัน แม่ปิดที่ Completed ผ่าน engine (multi_device_unpacked)
//
// เมื่อไหร่: อัตโนมัติ เมื่อสถานะแม่เข้าชุด {Pending QC, Sent To QC Lab, In Stock}
// (ชุดเดียวกับที่คิดค่ารอบไรเดอร์ — "เครื่องถึงมือร้านแล้ว") ผ่าน trigger บน
// jobs/{id}/status. ไม่มีปุ่มให้ลืมกด. callable มีไว้ **รันซ้ำ** เมื่อรอบอัตโนมัติ
// ล้มกลางทาง (ปุ่มบนตั๋วขึ้นเฉพาะตอนนั้น)
//
// ลำดับ — ลูกก่อน แม่ทีหลัง และทำไมถึงกลับไม่ได้ (เหตุผลเต็มที่หัว b2b-unpack.js):
//   1. transaction จอง jobs/{id}/multi_unpack (ตัวกันสองรอบชนกัน: trigger ยิงซ้ำ
//      ได้เมื่อแอดมินขยับสถานะสองครั้งติดในชุดเดียวกัน)
//   2. multi-path เดียว: งานลูกทุกใบ + multi_unpack.written=true (+ อุปกรณ์เสริม
//      ถ้ายังไม่เคยแตก) — all-or-nothing จึงไม่มี "ลูกเกิดครึ่งเดียว"
//   3. applyTransition แม่ → Completed (engine `requires: ["multi_unpack"]` เป็นด่าน
//      ที่ทำให้ลำดับนี้ถูกบังคับที่ตาราง ไม่ใช่ที่วินัยของผู้เรียก)
// ล้มระหว่าง 1→2: stamp มี written=false รอบถัดไป (callable) เขียนลูกด้วย key เดิม
// ล้มระหว่าง 2→3: ลูกอยู่ในคิว QC แล้ว แม่ยังอ่านสถานะเดิม ปุ่มรันซ้ำบนตั๋วขึ้น
// **ไม่ต้องมี .indexOn ใหม่** — idempotency อยู่ที่ stamp บนแม่ ไม่ใช่ query หาลูก
//
// สิ่งที่ลูก **ไม่** ได้รับโดยตั้งใจ: uid / อีเมล / เบอร์ / ที่อยู่ / เงิน (net_payout,
// paid_at, คูปอง, adjustments). ลูกไม่ใช่ออเดอร์ของลูกค้า มันคือเครื่องในคลัง —
// uid บนลูกจะทำให้มันโผล่ในประวัติการขายของลูกค้าเป็นออเดอร์ที่ไม่มีอยู่จริง และ
// paid_at บนลูกจะทำให้ Finance/TransactionRepair นับเป็น "จ่ายแล้วไม่มีแถวบัญชี".
// หลักฐานว่าจ่ายแล้วส่งผ่าน **แถวไทม์ไลน์** (action = Paid ชี้กลับไปที่แม่) ซึ่ง
// paidTrail.ts ของแอดมินอ่านเป็น "จ่ายแล้ว" → ปุ่ม Pending QC บนมือถือเสนอทาง
// Lab/Stock ไม่ใช่เสนอจ่ายเงินซ้ำ (B2B-Unpacked ไม่มีแถวนี้ — เป็นรูโหว่เดิมของ
// สายนั้น ไม่ได้แก้ที่นี่)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueUpdated } = require("firebase-functions/v2/database");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const { applyTransition } = require("./status-apply");
const { ACTOR } = require("./status-engine");
// ครึ่ง pure อยู่ b2c-unpack-core.js (ไม่มี firebase — เทสฝั่ง src/ require ได้)
const core = require("./b2c-unpack-core");
const {
  ENTRY_STATUSES, EVENT, UNPACK_REASON,
  devicesOf, isMultiDeviceRetailJob, isEntryStatus, checkUnpackable,
  buildUnpackUpdates, buildClaimStamp, accessoryKeyCount,
} = core;

const REGION = "asia-southeast1";

// ── the run ─────────────────────────────────────────────────────────────────

const ROLE_ACTOR = {
  CEO: ACTOR.ADMIN_MANAGER,
  MANAGER: ACTOR.ADMIN_MANAGER,
  STAFF: ACTOR.ADMIN_STAFF,
  FINANCE: ACTOR.FINANCE,
};

/**
 * ทั้งสามขั้น — ใช้ร่วมกันโดย trigger (actor system) และ callable (actor ตาม role)
 * คืน { ok, code, children, recovered } และไม่ throw นอกจากฐานข้อมูลล้ม
 */
async function runMultiDeviceUnpack({ db, jobId, actor, by, byName, log = console }) {
  const snap = await db.ref(`jobs/${jobId}`).once("value");
  const job = snap.val();
  const blocked = checkUnpackable(job);
  if (blocked) return { ok: false, code: blocked.code, message: blocked.message };

  const now = Date.now();
  const devices = devicesOf(job);

  // 1. จอง stamp — คนที่จองได้คือคนที่เขียนลูก คนที่จองไม่ได้ (รอบซ้อน) ใช้ key ของคนแรก
  const stampRef = db.ref(`jobs/${jobId}/multi_unpack`);
  const proposed = buildClaimStamp({
    job,
    jobId,
    keys: devices.map(() => db.ref("jobs").push().key),
    accessoryKeys: Array.from({ length: accessoryKeyCount(job) }, () => db.ref("jobs").push().key),
    now,
    by,
  });
  const claim = await stampRef.transaction((current) => (current ? undefined : proposed));
  const stamp = claim.snapshot && claim.snapshot.val() ? claim.snapshot.val() : proposed;
  const recovered = !claim.committed;

  // 2. ลูกทุกใบ + written ใน multi-path เดียว — ข้ามเมื่อรอบก่อนเขียนครบแล้ว
  if (stamp.written !== true) {
    await db.ref().update(buildUnpackUpdates({ job, jobId, stamp, now, by }));
  }

  // 3. แม่ → Completed ผ่าน engine (requires multi_unpack = ลำดับถูกบังคับที่ตาราง)
  const result = await applyTransition({
    db,
    jobId,
    event: EVENT,
    actor,
    by,
    byName,
    reason: UNPACK_REASON(devices.length),
    patch: { multi_unpacked_at: now, multi_child_count: devices.length },
  });

  if (!result.ok) {
    // ลูกอยู่ในคิว QC แล้ว แม่ยังอ่านสถานะเดิม — ปุ่มรันซ้ำบนตั๋วขึ้น กดแล้วมาถึงตรงนี้ใหม่
    log.error(`[multiUnpack] ${jobId}: children ready but transition refused: ${result.code}`);
    return { ok: false, code: result.code, message: result.message, children: devices.length, recovered };
  }
  log.log(`[multiUnpack] ${jobId}: ${devices.length} child jobs ${recovered ? "already claimed" : "created"}, parent closed`);
  return { ok: true, children: devices.length, recovered };
}

function registerB2cUnpack() {
  // ทางหลัก — ไม่มีปุ่มให้ลืม. ยิงบนทุกการเขียน status แล้วคัดด้วยชุดสถานะก่อน
  // อ่านงาน (ราคา RTDB: อ่านทั้งใบเฉพาะที่ผ่านตะแกรงแรก)
  const onJobStatusUnpackMultiDevice = onValueUpdated(
    { ref: "/jobs/{jobId}/status", region: REGION },
    async (event) => {
      const before = event.data.before.val();
      const after = event.data.after.val();
      if (before === after) return;
      if (!isEntryStatus(after, null)) return;
      const jobId = event.params.jobId;
      const db = getDatabase();
      const peek = await db.ref(`jobs/${jobId}`).once("value");
      if (!isMultiDeviceRetailJob(peek.val())) return;
      try {
        const out = await runMultiDeviceUnpack({
          db,
          jobId,
          actor: ACTOR.SYSTEM,
          by: "system:onJobStatusUnpackMultiDevice",
          byName: "System",
        });
        if (!out.ok && out.code !== "already-exists") {
          console.error(`[multiUnpack] ${jobId}: auto unpack stopped: ${out.code} ${out.message || ""}`);
        }
      } catch (err) {
        // ไม่ throw — retry ของ trigger จะไม่ช่วยอะไรที่ stamp ช่วยไม่ได้อยู่แล้ว
        // และปุ่มรันซ้ำบนตั๋วคือทางกู้ที่มองเห็น
        console.error(`[multiUnpack] ${jobId}: auto unpack failed:`, err);
      }
    }
  );

  // ทางกู้ — ขึ้นบนตั๋วเฉพาะเมื่อ multi_unpack มีแต่แม่ยังไม่ Completed
  const unpackMultiDeviceJob = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    const { jobId } = request.data || {};
    if (!jobId || typeof jobId !== "string") throw new HttpsError("invalid-argument", "ต้องระบุ jobId");

    const db = getDatabase();
    const who = await lookupStaffByAuth(db, request.auth);
    const role = String((who && who.role) || "").toUpperCase();
    const actor = who ? ROLE_ACTOR[role] : null;
    if (!actor) throw new HttpsError("permission-denied", "บัญชีนี้ไม่มีสิทธิ์แตกงานเข้าคลัง");

    const out = await runMultiDeviceUnpack({
      db,
      jobId,
      actor,
      by: `${actor}:${who.id}`,
      byName: who.name || who.displayName || `${actor}:${who.id}`,
    });
    if (!out.ok) {
      const code = ["not-found", "failed-precondition", "already-exists"].includes(out.code)
        ? out.code
        : "failed-precondition";
      throw new HttpsError(code, out.message || out.code, { code: out.code, children: out.children });
    }
    return out;
  });

  return { onJobStatusUnpackMultiDevice, unpackMultiDeviceJob };
}

module.exports = {
  registerB2cUnpack,
  runMultiDeviceUnpack,
  // pure halves re-exported from b2c-unpack-core.js (offline suite reads them here)
  ...core,
};
