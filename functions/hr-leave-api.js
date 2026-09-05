// =============================================================================
// การลา — callable
//
// กติกาทั้งหมดอยู่ `hr-leave.js` (ล้วน มีเทส) ไฟล์นี้ต่อสายกับ Firebase เท่านั้น
//
// **จำนวนวัน / วันที่ได้ค่าจ้าง / วันที่ไม่ได้ คำนวณฝั่ง server เสมอ** ไม่รับ
// ตัวเลขจาก client แม้แต่ตัวเดียว — หน้าเว็บคำนวณไว้แสดงตัวอย่างได้ แต่ตัวเลข
// ที่ถูกบันทึกต้องมาจากปฏิทินและสิทธิ์ที่ server เพิ่งอ่าน ไม่งั้นคนที่ยิง
// callable ตรงๆ ก็ประกาศเองได้ว่าลา 20 วันแล้วได้ค่าจ้างครบ
//
// **`leave_requests` ไม่มี rule เป็นของตัวเอง** จึงตกกฎ root `.read/.write:
// false` — Admin SDK เท่านั้นที่แตะได้ **ไม่ต้อง deploy rules** (รูปแบบเดียวกับ
// `employee_files` — ดูหัวไฟล์ hr-files-api.js)
//
// โครงเก็บเป็น `leave_requests/{employeeId}/{requestId}` ซ้อนใต้พนักงานแบบ
// เดียวกับ `hr_documents` และ `employee_files` — อ่านของคนเดียวคือการอ่าน
// subtree เล็กๆ ตรงๆ **ไม่ต้องมี `.indexOn`** ซึ่งอยู่ในไฟล์กฎของอีกรีโป
// (ปัญหาที่ `employee_events` ยังติดอยู่ทุกวันนี้)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, employeeActorFields } = require("./hr-core");
const {
  REQUEST_STATUSES,
  normalizeCalendar,
  resolveLeaveTypes,
  policyWarnings,
  leaveBalances,
  validateLeaveRequest,
  unpaidLeaveInPeriod,
} = require("./hr-leave");

const REGION = "asia-southeast1";
const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);

/** ใครอนุมัติใบลาได้ — คนละชุดกับคนที่ *เห็น* ใบลา */
const APPROVE_ROLES = ["CEO", "MANAGER"];

/**
 * ปฏิทินร้าน + สิทธิ์ที่ตั้งเอง
 *
 * ปฏิทินอ่านจาก `settings/store/business_hours` **ตัวเดียวกับที่หน้า checkout
 * ของลูกค้าใช้** — ไม่สร้างปฏิทินวันหยุดชุดที่สอง (ดูหัวไฟล์ hr-leave.js)
 */
async function loadPolicy(db) {
  const [hoursSnap, cfgSnap] = await Promise.all([
    db.ref("settings/store/business_hours").once("value"),
    db.ref("settings/hr/leave_types").once("value"),
  ]);
  const overrides = cfgSnap.val() || {};
  return {
    calendar: normalizeCalendar(hoursSnap.val() || {}),
    overrides,
    types: resolveLeaveTypes(overrides),
    warnings: policyWarnings(overrides),
  };
}

async function loadEmployee(db, employeeId) {
  const snap = await db.ref(`employees/${employeeId}`).once("value");
  if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");
  return { id: employeeId, ...snap.val() };
}

async function loadRequests(db, employeeId) {
  const snap = await db.ref(`leave_requests/${employeeId}`).once("value");
  const out = [];
  snap.forEach((c) => { out.push({ id: c.key, employee_id: employeeId, ...c.val() }); return false; });
  out.sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")));
  return out;
}

/** แถวที่ส่งออกหน้าเว็บ — allowlist ไม่ใช่ส่งทั้งก้อน */
const publicRequest = (r) => ({
  id: r.id,
  employee_id: r.employee_id,
  type: r.type,
  from: r.from,
  to: r.to,
  days: Number(r.days) || 0,
  paid_days: Number(r.paid_days) || 0,
  unpaid_days: Number(r.unpaid_days) || 0,
  reason: r.reason || null,
  document_note: r.document_note || null,
  status: r.status,
  requested_at: Number(r.requested_at) || null,
  requested_by_name: r.requested_by_name || null,
  decided_at: Number(r.decided_at) || null,
  decided_by_name: r.decided_by_name || null,
  decision_note: r.decision_note || null,
  // แก้หลังยื่น — หัวหน้าที่เห็นใบนี้ในกล่องอนุมัติต้องรู้ว่ามันไม่ใช่ใบที่
  // ยื่นมาแบบนี้ตั้งแต่แรก (เขียนโดย employeeLeaveUpdate)
  edited_at: Number(r.edited_at) || null,
  // ครึ่งวันหัว/ท้าย — ต้องส่งออกมาด้วย ไม่งั้นหน้าจอที่โชว์ "2.5 วัน" อธิบาย
  // ไม่ได้ว่าครึ่งวันนั้นอยู่วันไหน และตอนกดแก้ใบ ธงจะหายไปเงียบๆ
  half_start: r.half_start === true,
  half_end: r.half_end === true,
  // ไฟล์แนบ = ตัวชี้ไปที่ `employee_files` ไม่ใช่ URL — คนที่มีสิทธิ์เปิด
  // (เจ้าตัว หรือหัวหน้าของเขา) ขอ base64 ผ่าน callable อีกที
  attachments: Array.isArray(r.attachments)
    ? r.attachments.map((a) => ({ id: a && a.id, filename: (a && a.filename) || null }))
      .filter((a) => a.id)
    : [],
});

function registerHrLeave() {
  // -------------------------------------------------------------------------
  // adminHrLeaveList — ใบลา + ยอดคงเหลือของพนักงานหนึ่งคน
  // -------------------------------------------------------------------------
  const adminHrLeaveList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const employeeId = str((request.data || {}).employeeId, 60);
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");
    const year = str((request.data || {}).year, 4) || String(new Date().getUTCFullYear());

    const [policy, employee, requests] = await Promise.all([
      loadPolicy(db),
      loadEmployee(db, employeeId),
      loadRequests(db, employeeId),
    ]);

    return {
      employee: { id: employee.id, name: employee.name || null, hired_at: employee.hired_at || null },
      year,
      types: policy.types.map((t) => ({
        id: t.id, label: t.label, basis: t.basis, counts: t.counts,
        paid_days: t.paid_days, max_days: t.max_days || null,
      })),
      policy_warnings: policy.warnings,
      balances: leaveBalances({ employee, requests, overrides: policy.overrides, year }),
      requests: requests.filter((r) => String(r.from || "").slice(0, 4) === year).map(publicRequest),
    };
  });

  // -------------------------------------------------------------------------
  // adminHrLeavePreview — ตรวจใบลาโดยยังไม่บันทึก
  //
  // มีไว้ให้หน้าเว็บโชว์ "ลากี่วัน / ได้ค่าจ้างกี่วัน" ก่อนกดยืนยัน **โดยใช้
  // ตัวคำนวณตัวเดียวกับตอนบันทึกจริง** — ถ้าหน้าเว็บคำนวณเองจะมีสูตรสองชุด
  // ที่วันหนึ่งจะไม่ตรงกัน แล้วคนจะเชื่อตัวที่เห็นบนจอ
  // -------------------------------------------------------------------------
  const adminHrLeavePreview = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const d = request.data || {};
    const employeeId = str(d.employeeId, 60);
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");

    const [policy, employee, requests] = await Promise.all([
      loadPolicy(db), loadEmployee(db, employeeId), loadRequests(db, employeeId),
    ]);
    return validateLeaveRequest({
      employee,
      draft: { id: str(d.requestId, 60) || null, type: str(d.type, 40), from: str(d.from, 10), to: str(d.to, 10), document_note: str(d.documentNote, 200) },
      requests,
      overrides: policy.overrides,
      calendar: policy.calendar,
    });
  });

  // -------------------------------------------------------------------------
  // adminHrLeaveCreate — ยื่นใบลา
  // -------------------------------------------------------------------------
  const adminHrLeaveCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const actor = await requireStaffRole(db, request.auth, HR_ROLES);
    const d = request.data || {};
    const employeeId = str(d.employeeId, 60);
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");

    const [policy, employee, requests] = await Promise.all([
      loadPolicy(db), loadEmployee(db, employeeId), loadRequests(db, employeeId),
    ]);

    const draft = {
      type: str(d.type, 40),
      from: str(d.from, 10),
      to: str(d.to, 10),
      document_note: str(d.documentNote, 200),
    };
    const v = validateLeaveRequest({
      employee, draft, requests, overrides: policy.overrides, calendar: policy.calendar,
    });
    if (!v.ok) throw new HttpsError("failed-precondition", v.errors.join(" · "));

    const ref = db.ref(`leave_requests/${employeeId}`).push();
    const actorFields = employeeActorFields(actor);
    const row = {
      type: draft.type,
      from: draft.from,
      to: draft.to,
      // **ตัวเลขทั้งสามมาจาก server เท่านั้น** ไม่รับจาก client
      days: v.days,
      paid_days: v.paid_days,
      unpaid_days: v.unpaid_days,
      reason: str(d.reason, 400) || null,
      document_note: draft.document_note || null,
      status: "pending",
      requested_at: Date.now(),
      requested_by_uid: actorFields.by_uid || null,
      requested_by_name: actorFields.by_name || null,
    };
    await ref.set(row);
    return { ok: true, id: ref.key, warnings: v.warnings, request: publicRequest({ id: ref.key, employee_id: employeeId, ...row }) };
  });

  // -------------------------------------------------------------------------
  // adminHrLeaveDecide — อนุมัติ / ปฏิเสธ / ยกเลิก
  //
  // การอนุมัติจำกัดที่ CEO/MANAGER **แคบกว่าคนที่เห็นใบลา** โดยตั้งใจ:
  // การอนุมัติวันลาคือการยอมรับว่าบริษัทจ่ายค่าจ้างวันนั้น
  // -------------------------------------------------------------------------
  const adminHrLeaveDecide = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const actor = await requireStaffRole(db, request.auth, APPROVE_ROLES);
    const d = request.data || {};
    const employeeId = str(d.employeeId, 60);
    const requestId = str(d.requestId, 60);
    const status = str(d.status, 20);
    if (!employeeId || !requestId) throw new HttpsError("invalid-argument", "ต้องระบุใบลา");
    if (!REQUEST_STATUSES.includes(status) || status === "pending") {
      throw new HttpsError("invalid-argument", "สถานะไม่ถูกต้อง");
    }

    const ref = db.ref(`leave_requests/${employeeId}/${requestId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบลา");
    const current = snap.val();
    if (current.status === status) return { ok: true, unchanged: true };

    // ใบที่ตัดสินไปแล้วกลับมาอนุมัติใหม่ไม่ได้ — ต้องยื่นใบใหม่ เพราะการพลิก
    // สถานะย้อนหลังเปลี่ยนยอดวันลาของปีนั้นโดยไม่มีร่องรอยว่าเปลี่ยนตอนไหน
    if (current.status !== "pending" && status === "approved") {
      throw new HttpsError("failed-precondition", "ใบที่ตัดสินไปแล้วอนุมัติย้อนหลังไม่ได้ ให้ยื่นใบใหม่");
    }

    const actorFields = employeeActorFields(actor);
    await ref.update({
      status,
      decided_at: Date.now(),
      decided_by_uid: actorFields.by_uid || null,
      decided_by_name: actorFields.by_name || null,
      decision_note: str(d.note, 400) || null,
    });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // adminHrLeaveUnpaidInPeriod — วันลาไม่รับค่าจ้างในรอบจ่ายหนึ่งรอบ
  //
  // **หน้ารอบจ่ายใช้ตัวนี้เพื่อ *แสดง* ไม่ใช่เพื่อ *หัก*** — การหักอัตโนมัติ
  // เป็นงานรอบถัดไปที่ต้องตัดสินใจแยก (ดูหัวไฟล์ hr-leave.js)
  // -------------------------------------------------------------------------
  const adminHrLeaveUnpaidInPeriod = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const d = request.data || {};
    const ids = Array.isArray(d.employeeIds) ? d.employeeIds.slice(0, 200).map((x) => str(x, 60)).filter(Boolean) : [];
    const from = str(d.from, 10);
    const to = str(d.to, 10);
    if (!ids.length) return { rows: {} };

    // อ่านทีละคนตาม subtree ของตัวเอง **ไม่กวาด `leave_requests` ทั้งโหนด**
    // (กฎค่า RTDB — ดู CLAUDE.md)
    const rows = {};
    await Promise.all(ids.map(async (id) => {
      const requests = await loadRequests(db, id);
      rows[id] = unpaidLeaveInPeriod({ requests, employeeId: id, from, to });
    }));
    return { rows };
  });

  return {
    adminHrLeaveList,
    adminHrLeavePreview,
    adminHrLeaveCreate,
    adminHrLeaveDecide,
    adminHrLeaveUnpaidInPeriod,
  };
}

// `publicRequest` / `loadPolicy` / `loadRequests` ใช้ร่วมกับแอปพนักงาน
// (`hr-employee-portal.js`) — **รูปของใบลาที่ส่งออกต้องมีที่เดียว** ไม่งั้น
// วันหนึ่งจอแอดมินกับจอพนักงานจะเล่าใบเดียวกันคนละแบบ
module.exports = { registerHrLeave, APPROVE_ROLES, publicRequest, loadPolicy, loadRequests, loadEmployee };
