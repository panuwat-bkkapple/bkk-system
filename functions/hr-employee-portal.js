// =============================================================================
// แอปพนักงาน — ใบลา คำขอเปลี่ยนกะ และการอนุมัติของหัวหน้า
//
// **ทุก callable ที่นี่ตัดสิน "ของใคร" จาก auth token เท่านั้น** ผ่าน
// `requireEmployeeCaller` — ไม่มีตัวไหนรับ `employeeId` จาก body ในเส้นทางของ
// เจ้าตัว (ยกเว้นเส้นทางของหัวหน้า ซึ่งตรวจว่าเป็นลูกน้องจริงก่อนเสมอ)
//
// **กติกาการลาไม่ได้เขียนใหม่ที่นี่** — `validateLeaveRequest` ตัวเดียวกับที่
// ฝ่ายบุคคลใช้ (`hr-leave.js`) สูตรวันลาสองชุดคือของที่วันหนึ่งจะไม่ตรงกัน
// แล้วพนักงานกับ HR จะเห็นยอดคงเหลือคนละเลข
//
// **หัวหน้าอนุมัติได้เฉพาะลูกน้องตรงของตัวเอง** (`supervisor_id`) — ไม่ใช่ทุกคน
// ในบริษัท และไม่ใช่ตัวเอง (คนอนุมัติใบลาของตัวเองคือคนที่ไม่ต้องขอลา)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireEmployeeCaller } = require("./hr-employee-auth");
const { validateLeaveRequest, leaveBalances, REQUEST_STATUSES } = require("./hr-leave");
const { publicRequest, loadPolicy, loadRequests } = require("./hr-leave-api");
const A = require("./hr-attendance");

const REGION = "asia-southeast1";
const str = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
const nowMs = () => Date.now();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** เพดานคำขอที่ส่งกลับ — ชนแล้วบอก ไม่ตัดเงียบ */
const MAX_ROWS = 200;
/** เพดานลูกน้องต่อหัวหน้าหนึ่งคน */
const MAX_REPORTS = 100;

/** แถวคำขอเปลี่ยนกะที่ส่งออก — allowlist ไม่ใช่ส่งทั้งก้อน */
const publicShiftRequest = (r) => ({
  id: r.id,
  employee_id: r.employee_id,
  date: r.date,
  from_shift_id: r.from_shift_id || null,
  to_shift_id: r.to_shift_id || null,
  to_shift_label: r.to_shift_label || null,
  reason: r.reason || null,
  status: r.status,
  requested_at: Number(r.requested_at) || null,
  decided_at: Number(r.decided_at) || null,
  decided_by_name: r.decided_by_name || null,
  decision_note: r.decision_note || null,
});

async function loadShiftRequests(db, employeeId) {
  const snap = await db.ref(`shift_requests/${employeeId}`).once("value");
  const out = [];
  snap.forEach((c) => { out.push({ id: c.key, employee_id: employeeId, ...c.val() }); return false; });
  out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return out;
}

/** ลูกน้องตรงของคนนี้ — `employees` เป็นโหนดหลักสิบแถว อ่านทั้งก้อนได้ */
function directReports(employees, supervisorEmployeeId) {
  const rows = employees && typeof employees === "object" ? employees : {};
  return Object.entries(rows)
    .filter(([id, e]) => id !== supervisorEmployeeId
      && e && typeof e === "object"
      && str(e.supervisor_id, 80) === supervisorEmployeeId)
    .map(([id, e]) => ({ id, name: e.name || null, employee_code: e.employee_code || null, status: e.status || null }));
}

function registerHrEmployeePortal() {
  // -------------------------------------------------------------------------
  // employeeMe — "คนที่ล็อกอินอยู่เป็นพนักงานคนไหน"
  //
  // **มีไว้เป็นด่านแรกของแอป ไม่ใช่แค่ไว้โชว์ชื่อ** — บัญชี Firebase Auth ของ
  // โปรเจกต์นี้เป็นกองเดียวกันทั้งระบบ: พนักงาน ไรเดอร์ ดีลเลอร์ **และลูกค้า**
  // (เว็บลูกค้ามี `createUserWithEmailAndPassword`) ทุกคนจึงผ่านหน้าล็อกอินของ
  // แอปพนักงานได้ สิ่งที่กันอยู่คือด่านของ callable ทุกตัว ไม่ใช่หน้าล็อกอิน
  //
  // แอปต้องเรียกตัวนี้ **ก่อนขอสิทธิ์ตำแหน่ง** — ไม่งั้นเราจะไปขอพิกัดปัจจุบัน
  // จากลูกค้าที่บังเอิญกรอกรหัสผ่านของตัวเองเข้ามา ซึ่งเป็นข้อมูลที่เราไม่มี
  // สิทธิ์ขอตั้งแต่แรก
  //
  // อ่านแค่ `employees` + `staff` (ผ่าน `requireEmployeeCaller`) ไม่แตะโหนดอื่น
  // เพราะมันถูกเรียกทุกครั้งที่เปิดแอป
  // -------------------------------------------------------------------------
  const employeeMe = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id, employee } = await requireEmployeeCaller(db, request.auth);
    return {
      id,
      name: employee.name || null,
      employee_code: employee.employee_code || null,
      position: employee.position || null,
      photo_url: employee.photo_url || null,
      status: employee.status || null,
    };
  });

  // -------------------------------------------------------------------------
  // employeeLeaveList — ใบลาของตัวเอง + ยอดคงเหลือ
  // -------------------------------------------------------------------------
  const employeeLeaveList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const year = str((request.data || {}).year, 4) || String(new Date().getFullYear());
    const [policy, requests] = await Promise.all([loadPolicy(db), loadRequests(db, employeeId)]);
    const balances = leaveBalances({
      employee, requests, overrides: policy.overrides, year, asOf: nowMs(),
    });
    return {
      year,
      types: policy.types.map((t) => ({ id: t.id, label: t.label, paid_days: t.paid_days, counts: t.counts })),
      balances,
      requests: requests.filter((r) => String(r.from || "").slice(0, 4) === year).slice(0, MAX_ROWS).map(publicRequest),
      capped: requests.length > MAX_ROWS,
    };
  });

  // -------------------------------------------------------------------------
  // employeeLeavePreview — กี่วัน ได้ค่าจ้างกี่วัน **ก่อน** กดส่ง
  //
  // ใช้ตัวคำนวณตัวเดียวกับตอนบันทึกจริง — ตัวเลขที่โชว์ก่อนกดกับตัวเลขที่ได้
  // หลังกด ต้องเป็นตัวเดียวกันเสมอ ไม่งั้นคนจะรู้ตอนเงินเดือนออก
  // -------------------------------------------------------------------------
  const employeeLeavePreview = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const [policy, requests] = await Promise.all([loadPolicy(db), loadRequests(db, employeeId)]);
    const v = validateLeaveRequest({
      employee,
      draft: { type: str(d.type, 40), from: str(d.from, 10), to: str(d.to, 10) },
      requests, overrides: policy.overrides, calendar: policy.calendar,
    });
    return {
      ok: v.ok, errors: v.errors || [], warnings: v.warnings || [],
      days: v.days ?? null, paid_days: v.paid_days ?? null, unpaid_days: v.unpaid_days ?? null,
    };
  });

  // -------------------------------------------------------------------------
  // employeeLeaveCreate — ยื่นใบลาของตัวเอง (สถานะ pending เสมอ)
  // -------------------------------------------------------------------------
  const employeeLeaveCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const [policy, requests] = await Promise.all([loadPolicy(db), loadRequests(db, employeeId)]);

    const draft = {
      type: str(d.type, 40), from: str(d.from, 10), to: str(d.to, 10),
      document_note: str(d.documentNote, 200),
    };
    const v = validateLeaveRequest({
      employee, draft, requests, overrides: policy.overrides, calendar: policy.calendar,
    });
    if (!v.ok) throw new HttpsError("failed-precondition", v.errors.join(" · "));

    const ref = db.ref(`leave_requests/${employeeId}`).push();
    const row = {
      type: draft.type, from: draft.from, to: draft.to,
      // ตัวเลขทั้งสามมาจาก server เท่านั้น ไม่รับจาก client
      days: v.days, paid_days: v.paid_days, unpaid_days: v.unpaid_days,
      reason: str(d.reason, 400) || null,
      document_note: draft.document_note || null,
      status: "pending",
      requested_at: nowMs(),
      requested_by_uid: request.auth.uid,
      requested_by_name: employee.name || null,
      // ยื่นเองจากแอป — ต่างจากใบที่ฝ่ายบุคคลกรอกแทน ซึ่งอ่านย้อนหลังแล้วต้อง
      // แยกออกจากกันได้
      source: "employee_app",
      supervisor_id: str(employee.supervisor_id, 80) || null,
    };
    await ref.set(row);
    return { ok: true, id: ref.key, warnings: v.warnings,
      request: publicRequest({ id: ref.key, employee_id: employeeId, ...row }) };
  });

  // -------------------------------------------------------------------------
  // employeeLeaveCancel — ยกเลิกใบของตัวเองที่ยังไม่ถูกตัดสิน
  //
  // ยกเลิกใบที่ **อนุมัติแล้ว** ไม่ได้จากแอป — วันลาที่อนุมัติแล้วถูกนับเข้ายอด
  // และอาจถูกจัดเวรแทนไปแล้ว การถอนต้องผ่านคนที่เห็นภาพรวม
  // -------------------------------------------------------------------------
  const employeeLeaveCancel = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const requestId = str((request.data || {}).requestId, 60);
    if (!requestId) throw new HttpsError("invalid-argument", "ต้องระบุใบลา");
    const ref = db.ref(`leave_requests/${employeeId}/${requestId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบลา");
    if (snap.val().status !== "pending") {
      throw new HttpsError("failed-precondition", "ใบที่ตัดสินไปแล้วยกเลิกจากแอปไม่ได้ ติดต่อหัวหน้างาน");
    }
    await ref.update({ status: "cancelled", decided_at: nowMs(), decided_by_name: "ยกเลิกโดยผู้ยื่น" });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // employeeShiftChangeCreate / List — คำขอเปลี่ยนกะ
  // -------------------------------------------------------------------------
  const employeeShiftChangeCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const date = str(d.date, 10);
    if (!DATE_RE.test(date)) throw new HttpsError("invalid-argument", "วันที่ไม่ถูกต้อง");
    const today = A.bangkokIso(nowMs());
    // ขอเปลี่ยนกะย้อนหลังไม่ได้ — กะที่ผ่านไปแล้วเปลี่ยนไม่ได้จริง และการยอมให้
    // ขอย้อนหลังคือช่องแก้ประวัติการทำงานหลังจากรู้ผลแล้ว
    if (date < today) throw new HttpsError("failed-precondition", "ขอเปลี่ยนกะย้อนหลังไม่ได้");

    const [hrSnap, rosterSnap, existing] = await Promise.all([
      db.ref("settings/hr").once("value"),
      db.ref(`shift_roster/${employeeId}/${date}`).once("value"),
      loadShiftRequests(db, employeeId),
    ]);
    const { shifts } = A.normalizeShifts((hrSnap.val() || {}).shifts);
    const toShift = A.shiftById(shifts, str(d.toShiftId, 40));
    if (!toShift) throw new HttpsError("invalid-argument", "ไม่รู้จักกะที่ขอเปลี่ยนไป");

    const rosterVal = rosterSnap.val();
    const current = (rosterVal && typeof rosterVal === "object" ? rosterVal.shift_id : rosterVal)
      || str(employee.default_shift_id, 40) || null;
    if (current === toShift.id) {
      throw new HttpsError("failed-precondition", "วันนั้นอยู่กะนี้อยู่แล้ว");
    }
    // ค้างอยู่ใบหนึ่งต่อวันหนึ่ง — สองใบของวันเดียวกันแปลว่าหัวหน้าต้องเดาว่า
    // ใบไหนคือของจริง
    if (existing.some((r) => r.date === date && r.status === "pending")) {
      throw new HttpsError("failed-precondition", "มีคำขอของวันนี้รออนุมัติอยู่แล้ว");
    }

    const ref = db.ref(`shift_requests/${employeeId}`).push();
    const row = {
      date,
      from_shift_id: current,
      to_shift_id: toShift.id,
      to_shift_label: toShift.label,
      reason: str(d.reason, 400) || null,
      status: "pending",
      requested_at: nowMs(),
      requested_by_uid: request.auth.uid,
      requested_by_name: employee.name || null,
      supervisor_id: str(employee.supervisor_id, 80) || null,
    };
    await ref.set(row);
    return { ok: true, id: ref.key, request: publicShiftRequest({ id: ref.key, employee_id: employeeId, ...row }) };
  });

  const employeeShiftChangeList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const [hrSnap, rows] = await Promise.all([
      db.ref("settings/hr").once("value"),
      loadShiftRequests(db, employeeId),
    ]);
    const { shifts } = A.normalizeShifts((hrSnap.val() || {}).shifts);
    return {
      shifts: shifts.map((s) => ({ id: s.id, label: s.label, start: s.start, end: s.end })),
      requests: rows.slice(0, MAX_ROWS).map(publicShiftRequest),
      capped: rows.length > MAX_ROWS,
    };
  });

  // -------------------------------------------------------------------------
  // supervisorInbox — คำขอที่รอ *ฉัน* อนุมัติ
  //
  // "ลูกน้องตรง" คือคนที่ `supervisor_id` ชี้มาที่แฟ้มของเรา **ไม่ใช่ทั้งแผนก**
  // — ถ้าจะขยายเป็นทั้งสายบังคับบัญชาวันหน้า ต้องเป็นการตัดสินใจที่ตั้งใจ
  // ไม่ใช่ผลข้างเคียงของการเปลี่ยน query
  // -------------------------------------------------------------------------
  const supervisorInbox = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const empSnap = await db.ref("employees").once("value");
    const employees = empSnap.exists() ? empSnap.val() : {};
    const reports = directReports(employees, employeeId).slice(0, MAX_REPORTS);

    const leave = [];
    const shift = [];
    await Promise.all(reports.map(async (r) => {
      const [lv, sh] = await Promise.all([loadRequests(db, r.id), loadShiftRequests(db, r.id)]);
      for (const row of lv) if (row.status === "pending") leave.push({ ...publicRequest(row), employee_name: r.name });
      for (const row of sh) if (row.status === "pending") shift.push({ ...publicShiftRequest(row), employee_name: r.name });
    }));
    leave.sort((a, b) => (a.from < b.from ? -1 : 1));
    shift.sort((a, b) => (a.date < b.date ? -1 : 1));

    return { is_supervisor: reports.length > 0, reports, leave, shift };
  });

  // -------------------------------------------------------------------------
  // supervisorDecide — อนุมัติ/ปฏิเสธคำขอของลูกน้องตรง
  //
  // อนุมัติคำขอเปลี่ยนกะ = **เขียนตารางเวรจริง** ไม่ใช่แค่ติดสถานะ — คำขอที่
  // อนุมัติแล้วแต่ตารางไม่เปลี่ยน คือคำสัญญาที่ระบบไม่ได้ทำตาม และคนจะรู้ตอน
  // มาเช็คอินแล้วกะไม่ตรง
  // -------------------------------------------------------------------------
  const supervisorDecide = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: supervisorId, employee: supervisor } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const kind = str(d.kind, 20);
    const targetId = str(d.employeeId, 80);
    const requestId = str(d.requestId, 60);
    const status = str(d.status, 20);
    if (!["leave", "shift"].includes(kind)) throw new HttpsError("invalid-argument", "ชนิดคำขอไม่ถูกต้อง");
    if (!["approved", "rejected"].includes(status)) throw new HttpsError("invalid-argument", "สถานะไม่ถูกต้อง");
    if (!targetId || !requestId) throw new HttpsError("invalid-argument", "ต้องระบุคำขอ");
    if (targetId === supervisorId) {
      throw new HttpsError("permission-denied", "อนุมัติคำขอของตัวเองไม่ได้");
    }

    const empSnap = await db.ref(`employees/${targetId}`).once("value");
    if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงาน");
    if (str(empSnap.val().supervisor_id, 80) !== supervisorId) {
      throw new HttpsError("permission-denied", "อนุมัติได้เฉพาะลูกน้องในสายของตัวเอง");
    }

    const path = kind === "leave" ? `leave_requests/${targetId}/${requestId}` : `shift_requests/${targetId}/${requestId}`;
    const ref = db.ref(path);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบคำขอ");
    const cur = snap.val();
    if (cur.status !== "pending") {
      throw new HttpsError("failed-precondition", "คำขอนี้ถูกตัดสินไปแล้ว");
    }
    if (!REQUEST_STATUSES.includes(status)) throw new HttpsError("invalid-argument", "สถานะไม่ถูกต้อง");

    const at = nowMs();
    await ref.update({
      status, decided_at: at,
      decided_by_uid: request.auth.uid,
      decided_by_name: supervisor.name || null,
      decision_note: str(d.note, 400) || null,
    });

    if (kind === "shift" && status === "approved") {
      await db.ref(`shift_roster/${targetId}/${cur.date}`).set({
        shift_id: cur.to_shift_id,
        at,
        by_name: supervisor.name || null,
        source: "shift_request",
      });
    }
    return { ok: true };
  });

  return {
    employeeMe,
    employeeLeaveList,
    employeeLeavePreview,
    employeeLeaveCreate,
    employeeLeaveCancel,
    employeeShiftChangeCreate,
    employeeShiftChangeList,
    supervisorInbox,
    supervisorDecide,
  };
}

module.exports = { registerHrEmployeePortal, directReports, publicShiftRequest, MAX_ROWS, MAX_REPORTS };
