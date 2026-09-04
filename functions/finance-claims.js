// =============================================================================
// สิทธิ์จ่ายเงินออก (finance disbursement) — custom claim + audit trail
//
// Vertical slice ของ Phase 1 ตาม docs/reports/2026-08-31-permission-matrix-plan.md:
// คุมเฉพาะ action ที่ทำให้ "เงินออกจากบริษัท" (จ่ายลูกค้า / ถอนเงินไรเดอร์ /
// void บิลขาย) ส่วนที่เหลือของระบบยังวิ่งบน admin boolean เดิมทั้งหมด
//
// ทำไมเป็น custom claim ไม่ใช่ role ใน /staff:
//   role ใน /staff ถูกอ่านฝั่ง client แล้ว cache ลง sessionStorage — ปลอมได้ด้วย
//   DevTools. claim อยู่ใน ID token ที่ Firebase เซ็น client แก้ไม่ได้ และเป็น
//   ค่าเดียวที่ RTDB rules อ่านได้โดยไม่ต้อง lookup ข้ามโหนด (เฟสถัดไป)
//
// CEO ผ่านได้เสมอโดยไม่ต้องมี claim — hardcode ทั้งฝั่ง client (financeGate.ts)
// และที่นี่ เพื่อไม่ให้มีสถานะ "CEO ที่ตั้ง claim ยังไม่ครบแล้วจ่ายเงินไม่ได้"
//
// ชื่อ callable ต้อง unique ระดับ project ({region}/{name}) — prefix adminFinance*
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const { requireCeoCaller } = require("./staff-accounts");
const { lookupStaffByAuth } = require("./sickw-core");

const REGION = "asia-southeast1";

// role ที่จ่ายเงินออกได้เมื่อเปิด enforcement — CEO ไม่ได้อยู่ในลิสต์เพราะผ่าน
// ด้วย hardcode เสมอ (ดูหัวไฟล์) ไม่ใช่เพราะมีชื่ออยู่ในตารางที่แก้ได้
const CLAIM_KEY = "finance_disburse";
const AUDIT_PATH = "finance_audit";

// action ที่นับว่า "เงินออก" — mirror ของ FINANCE_ACTIONS ใน
// src/utils/financeGate.ts (functions import TS ไม่ได้ ต้องแก้ทั้งคู่)
const FINANCE_ACTIONS = [
  "payout_transfer",        // จ่ายค่าเครื่องลูกค้า (desktop /finance + /mobile/finance)
  "job_mark_paid",          // ปุ่ม "จ่ายเงินแล้ว (Paid)" บนหน้า ticket
  "rider_withdrawal",       // ยืนยันโอนเงินถอนของไรเดอร์
  "sales_void",             // void บิลขาย (ย้อนรายการเงินเข้า)
  "rider_expense_pay",      // จ่ายคืนเงินสำรองจ่ายของไรเดอร์ (ขั้นสุดท้ายของใบเบิก)
];

/**
 * ใครทำขั้นของฝ่ายบัญชีได้ — **ตัวนี้บังคับฝั่ง server จริง ไม่ใช่ซ่อนปุ่ม**
 *
 * ต่างจาก `evaluateFinanceGate` (`src/utils/financeGate.ts`) ตรงที่**ไม่มีทาง
 * legacy**: ฟังก์ชันนั้นปล่อย admin เดิมผ่านเมื่อ `settings/finance_gate/enforce`
 * ยังไม่เปิด เพราะมันคุม action ที่มีคนใช้ทำงานอยู่แล้วตั้งแต่ก่อนมีสิทธิ์นี้
 * ส่วนขั้นบัญชีของใบเบิกเป็นเส้นทางที่**เพิ่งเกิด** ไม่มีใครทำงานค้างอยู่บนมัน
 * จึงไม่มีอะไรให้ grandfather และการเปิด dual-read ไว้เฉยๆ แปลว่าประตูบานนี้
 * ปิดไม่ลงจนกว่าจะมีคนไปเปิดสวิตช์ ซึ่งเป็นสิ่งที่ลืมได้เงียบที่สุด
 *
 * `role` มาจาก `/staff` ที่ resolve ฝั่ง server (`lookupStaffByAuth`) ไม่ใช่จาก
 * sessionStorage ของเบราว์เซอร์ จึงเชื่อได้ — คนละกรณีกับ role ฝั่ง client
 *
 * @param {{role?: unknown}|null} staff
 * @param {{[k: string]: unknown}|null|undefined} token  auth token ของผู้เรียก
 * @returns {{allowed: boolean, reason: 'ceo'|'claim'|'finance_role'|'denied'}}
 */
function financeActorVerdict(staff, token) {
  const role = String((staff && staff.role) || "").toUpperCase();
  // CEO ผ่านเสมอด้วย hardcode — กันสภาพ "CEO ตั้ง claim ให้ตัวเองยังไม่เสร็จ
  // แล้วจ่ายเงินไม่ได้" (เหตุผลเดียวกับหัวไฟล์)
  if (role === "CEO") return { allowed: true, reason: "ceo" };
  if (token && token[CLAIM_KEY] === true) return { allowed: true, reason: "claim" };
  if (role === "FINANCE") return { allowed: true, reason: "finance_role" };
  return { allowed: false, reason: "denied" };
}

/**
 * adminFinanceSetClaim — CEO ตั้ง/ถอนสิทธิ์จ่ายเงินออกให้บัญชีพนักงาน
 *
 * รับ { staffId, enabled } — resolve uid จาก /staff (ไม่รับ uid ตรงจาก client
 * เพื่อให้สิทธิ์ผูกกับ staff record ที่ CEO เห็นบนหน้าจอจริงๆ)
 *
 * claim มีผลกับ token ใบถัดไป: revoke refresh tokens ทิ้งเพื่อให้คนที่ถูกถอน
 * สิทธิ์หมดสิทธิ์ภายใน ~1 ชม.แทนที่จะรอ token เดิมหมดอายุเอง (รูปแบบเดียวกับ
 * adminStaffSetStatus ตอนพักงาน)
 */
exports.adminFinanceSetClaim = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { callerStaffId, caller, staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const enabled = data.enabled === true;
  const target = staffMap[staffId];
  if (!target) throw new HttpsError("not-found", "ไม่พบพนักงาน");
  if (!target.uid) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ยังไม่มีบัญชี login — ออกบัญชีก่อน");
  }

  const existing = await getAuth().getUser(target.uid);
  const claims = { ...(existing.customClaims || {}) };
  if (enabled) claims[CLAIM_KEY] = true;
  else delete claims[CLAIM_KEY];

  await getAuth().setCustomUserClaims(target.uid, claims);
  await getAuth().revokeRefreshTokens(target.uid);

  await db.ref(AUDIT_PATH).push({
    at: Date.now(),
    kind: "claim_change",
    action: enabled ? "grant" : "revoke",
    actor_uid: request.auth.uid,
    actor_staff_id: callerStaffId,
    actor_name: caller.name || null,
    target_staff_id: staffId,
    target_uid: target.uid,
    target_name: target.name || null,
    target_role: String(target.role || "").toUpperCase() || null,
  });

  console.log(
    `[financeGate] ${enabled ? "granted" : "revoked"} ${CLAIM_KEY} for staff ${staffId} by ${callerStaffId}`
  );
  return { ok: true, staffId, uid: target.uid, enabled };
});

/**
 * adminFinanceAudit — บันทึกความพยายามจ่ายเงินออก (ทั้งที่ผ่านและถูกปฏิเสธ)
 *
 * ตัวตนของผู้กระทำ resolve ฝั่ง server จาก auth token เสมอ — client ส่งมาได้แค่
 * "จะทำอะไรกับงานไหน" ไม่ใช่ "ฉันเป็นใคร" มิฉะนั้น audit trail ก็ปลอมได้เท่ากับ
 * สิ่งที่มันควรเฝ้า
 *
 * เขียนผ่าน Admin SDK จึงไม่ต้องเพิ่ม rule ให้ /finance_audit (โหนดไม่มี rule
 * = ตกกฎ root .read/.write:false — client เขียน/อ่านตรงไม่ได้ ซึ่งถูกต้องแล้ว)
 *
 * ไม่ throw เมื่อ log ไม่สำเร็จ: การจ่ายเงินที่ถูกต้องต้องไม่ล้มเพราะเขียน audit
 * ไม่ได้ — แต่ทุก error ถูก log ไว้ให้เห็นใน Cloud Logging
 */
exports.adminFinanceAudit = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const db = getDatabase();
  const data = request.data || {};

  const action = String(data.action || "");
  if (!FINANCE_ACTIONS.includes(action)) {
    throw new HttpsError("invalid-argument", `action ไม่รู้จัก: ${action}`);
  }

  const staff = await lookupStaffByAuth(db, request.auth);
  const row = {
    at: Date.now(),
    kind: "attempt",
    action,
    allowed: data.allowed === true,
    reason: data.reason ? String(data.reason).slice(0, 120) : null,
    ref_id: data.refId ? String(data.refId).slice(0, 80) : null,
    amount: Number.isFinite(Number(data.amount)) ? Number(data.amount) : null,
    actor_uid: request.auth.uid,
    actor_email: (request.auth.token && request.auth.token.email) || null,
    actor_staff_id: staff ? staff.id : null,
    actor_role: staff ? String(staff.role || "").toUpperCase() || null : null,
    // สิทธิ์ที่ token ใบนี้ถืออยู่จริง ณ เวลานั้น — เก็บไว้เพื่อให้ย้อนอ่านได้ว่า
    // การอนุญาตมาจาก claim หรือมาจาก dual-read ที่ยังปล่อย admin เดิมผ่าน
    actor_claim: (request.auth.token && request.auth.token[CLAIM_KEY]) === true,
  };

  try {
    await db.ref(AUDIT_PATH).push(row);
  } catch (e) {
    console.error(`[financeGate] audit write failed action=${action}: ${e && e.message}`);
    return { ok: false };
  }
  if (!row.allowed) {
    console.warn(
      `[financeGate] DENIED action=${action} staff=${row.actor_staff_id || "?"} role=${row.actor_role || "?"} ref=${row.ref_id || "-"}`
    );
  }
  return { ok: true };
});

exports.FINANCE_ACTIONS = FINANCE_ACTIONS;
exports.CLAIM_KEY = CLAIM_KEY;
exports.financeActorVerdict = financeActorVerdict;
