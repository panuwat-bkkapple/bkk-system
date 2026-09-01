// =============================================================================
// Rider lifecycle — อนุมัติ / ปฏิเสธ / ระงับ / ปลดระงับ ไรเดอร์
//
// ทำไมต้องเป็น callable ไม่ใช่เขียน RTDB ตรงจากหน้าแอดมินเหมือนเดิม:
//
//   1. การอนุมัติไรเดอร์ = ให้สิทธิ์คนคนหนึ่งไปรับเครื่องมูลค่าหลายหมื่นจาก
//      บ้านลูกค้า แต่ rules ของ `riders` แยกได้แค่ "เป็นแอดมินไหม" (binary)
//      ไม่รู้จัก role ธุรกิจ → STAFF ทุกคนกดอนุมัติได้ และ route guard ฝั่ง
//      client เป็นแค่การซ่อนหน้า ไม่ได้กันการยิง update() ตรง. gate จริงของ
//      CEO/MANAGER จึงต้องอยู่ฝั่ง server ที่นี่
//   2. การระงับต้องมีผลจริง ไม่ใช่แค่ธงใน DB — `bkk-rider-app` เช็คตอน login
//      เฉพาะ `status === 'Pending'` (src/pages/Login.tsx) แปลว่า **ไรเดอร์ที่
//      ถูก Rejected หรือ Suspended ยัง login ผ่านด่านนั้นได้** เหลือแค่
//      watcher ฝั่ง client (useRiderData) ที่เตะออกทีหลัง ซึ่งเป็นโค้ดใน
//      เครื่องของคนที่เราเพิ่งเลิกไว้ใจ. ที่นี่จึง disable Firebase Auth user
//      + revoke refresh tokens แบบเดียวกับ adminStaffSetStatus
//   3. ทุกการเปลี่ยนสถานะถูกบันทึกเป็น transition record (ดูด้านล่าง)
//
// `riders/{key}` ใช้ Firebase Auth UID เป็น key ตรงๆ (rider สมัครเองแล้ว
// `set(riders/${uid})` — ต่างจาก `staff/{pushId}` ที่ join ด้วยอีเมล) จึงใช้
// riderId เป็น uid ได้เลย
//
// ชื่อ function ต้อง unique ระดับ project ({region}/{name}) — prefix adminRider*
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
// standing ของไรเดอร์เป็นส่วนหนึ่งของ actor contract — นิยามอยู่ที่ actor.js
// ที่เดียว ไฟล์นี้เป็นผู้ใช้ (re-export ไว้ให้ call site เดิมไม่ต้องรู้ว่ามันย้าย)
const { effectiveApprovalStatus } = require("./actor");

const REGION = "asia-southeast1";
const MANAGE_ROLES = ["CEO", "MANAGER"];

// สถานะปลายทางของแต่ละ action — เขียนทั้ง `approval_status` (ธงที่แอดมินใช้)
// และ `status` (ธงที่แอปไรเดอร์อ่าน) เสมอ เพราะมีคนอ่านคนละตัวกัน ปล่อยให้
// ไม่ตรงกันเมื่อไหร่ = ด่าน login กับหน้าแอดมินเห็นคนละความจริง
const ACTIONS = {
  approve: { approval_status: "Active", status: "Active" },
  reject: { approval_status: "Rejected", status: "Rejected" },
  suspend: { approval_status: "Suspended", status: "Suspended" },
  unsuspend: { approval_status: "Active", status: "Active" },
};

// action ที่แปลว่า "คนนี้ไม่ควรเข้าระบบได้อีก" → ต้องปิดบัญชี Auth ด้วย
const BLOCKS_LOGIN = new Set(["reject", "suspend"]);


// คืน true = ปิด/เปิดบัญชีสำเร็จ, false = ไม่มีบัญชี Auth ให้ปิด (record เก่าที่
// สร้างด้วยมือ) — เคสหลังไม่ใช่ความล้มเหลว ธงใน DB คือทั้งหมดที่มี
// error อื่นโยนต่อโดยตั้งใจ: ระงับที่ปิดบัญชีไม่สำเร็จต้องดังพอให้คนเห็น
// ไม่ใช่ประกาศว่าระงับแล้วทั้งที่เขายังเข้าระบบได้
async function setAuthDisabled(uid, disabled) {
  try {
    await getAuth().updateUser(uid, { disabled });
    if (disabled) await getAuth().revokeRefreshTokens(uid);
    return true;
  } catch (e) {
    if (e && e.code === "auth/user-not-found") return false;
    throw e;
  }
}

// ประวัติการเปลี่ยนสถานะ — เขียนตั้งแต่วันแรกแม้ยังไม่มีหน้าไหนอ่าน เพราะ
// เป็นข้อมูลที่ backfill ย้อนหลังไม่ได้ ("ใครกดอนุมัติคนนี้เมื่อไหร่" ไม่มี
// ที่ไหนเก็บอยู่เลยวันนี้)
//
// เก็บตัวระบุตัวตนของผู้กดไว้ครบทุกแบบและตั้งชื่อให้ชัดว่าอันไหนคืออันไหน
// โดยตั้งใจ — ระบบนี้มีตัวแทนของคนคนเดียวกันอยู่หลายแบบปนกันบนงาน (ชื่อที่
// แสดง / staff push id / Firebase uid) และการเดาย้อนหลังว่าฟิลด์ไหนเป็นแบบ
// ไหนคือสิ่งที่ทำให้ข้อมูลเก่าใช้ join ไม่ได้
//
// โหนดนี้ไม่มี rule ของตัวเอง → ตกกฎ root `.read/.write: false` = Admin SDK
// เขียนได้ที่นี่ที่เดียว client อ่านไม่ได้ (ตั้งใจ: ยังไม่มีใครอ่าน) วันที่จะ
// มี UI อ่าน ให้เพิ่ม `.read` แบบ admin ตามแบบ lot_audit / security_logs ที่
// `bkk-frontend-next/database.rules.json`
async function recordTransition(db, event) {
  try {
    await db.ref("rider_status_events").push(event);
  } catch (e) {
    // best-effort: สถานะเปลี่ยนไปแล้วจริง การโยน error ตรงนี้จะทำให้แอดมิน
    // เข้าใจว่าไม่สำเร็จแล้วกดซ้ำ ซึ่งแย่กว่าประวัติขาดหนึ่งแถว
    console.error("[rider-accounts] transition log failed:", e && e.message ? e.message : e);
  }
}

function registerRiderAccounts() {
  // ---------------------------------------------------------------------------
  // adminRiderSetStatus — จุดเดียวที่เปลี่ยนสถานะการอนุมัติของไรเดอร์
  // ---------------------------------------------------------------------------
  const adminRiderSetStatus = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    const db = getDatabase();

    const staff = (await lookupStaffByAuth(db, request.auth)) || {};
    const role = String(staff.role || "").toUpperCase();
    if (!MANAGE_ROLES.includes(role)) {
      throw new HttpsError(
        "permission-denied",
        `เฉพาะ ${MANAGE_ROLES.join("/")} เท่านั้นที่เปลี่ยนสถานะไรเดอร์ได้`
      );
    }

    const data = request.data || {};
    const riderId = String(data.riderId || "");
    const action = String(data.action || "");
    const reason = data.reason == null ? null : String(data.reason).trim() || null;

    if (!riderId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุไรเดอร์");
    if (!ACTIONS[action]) {
      throw new HttpsError(
        "invalid-argument",
        `action ต้องเป็นหนึ่งใน ${Object.keys(ACTIONS).join(" / ")}`
      );
    }

    const snap = await db.ref(`riders/${riderId}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบไรเดอร์");
    const before = snap.val() || {};

    const now = Date.now();
    const target = ACTIONS[action];
    const updates = { ...target };

    if (action === "approve") {
      // ค่าเริ่มต้นของไรเดอร์ที่เพิ่งผ่านการอนุมัติ — คงพฤติกรรมเดิมของหน้า
      // แอดมินไว้เป๊ะ (คะแนนเต็ม + ยังไม่ถูกจัดโซน)
      updates.score = 100;
      updates.zone = "Unassigned";
      updates.approved_at = now;
    } else if (action === "reject") {
      updates.reject_reason = reason;
      updates.rejected_at = now;
    } else if (action === "suspend") {
      updates.suspend_reason = reason;
      updates.suspended_at = now;
    } else if (action === "unsuspend") {
      updates.suspend_reason = null;
      updates.suspended_at = null;
    }

    // ปิด/เปิดบัญชีก่อนเขียนธง — ถ้าปิดบัญชีไม่สำเร็จจะได้ยังไม่มีอะไรใน DB
    // ประกาศว่าระงับแล้ว (ลำดับเดียวกับ adminStaffSetStatus)
    const blocksLogin = BLOCKS_LOGIN.has(action);
    const hadAuthAccount = await setAuthDisabled(riderId, blocksLogin);

    await db.ref(`riders/${riderId}`).update(updates);

    await recordTransition(db, {
      rider_id: riderId,
      action,
      from: {
        approval_status: effectiveApprovalStatus(before),
        status: String(before.status || ""),
      },
      to: { approval_status: target.approval_status, status: target.status },
      reason,
      at: now,
      by_staff_id: staff.id || null,
      by_uid: request.auth.uid,
      by_name: staff.name || null,
      by_role: role,
      auth_login_blocked: blocksLogin,
      auth_account_found: hadAuthAccount,
    });

    console.log(
      `[rider-accounts] ${action} rider ${riderId} by ${staff.id || request.auth.uid} (${role})` +
        (hadAuthAccount ? "" : " — ไม่มีบัญชี Auth ให้ปิด/เปิด")
    );

    return { ok: true, action, authAccountFound: hadAuthAccount };
  });

  return { adminRiderSetStatus };
}

module.exports = { registerRiderAccounts, effectiveApprovalStatus, ACTIONS, BLOCKS_LOGIN };
