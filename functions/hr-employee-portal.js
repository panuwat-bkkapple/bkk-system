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
const { getStorage } = require("firebase-admin/storage");

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
  from_shift_label: r.from_shift_label || null,
  to_shift_id: r.to_shift_id || null,
  to_shift_label: r.to_shift_label || null,
  // ขาสลับกับเพื่อน — ไม่มีสามฟิลด์นี้ = คำขอเปลี่ยนกะเดี่ยวแบบเดิม
  swap_with_employee_id: r.swap_with_employee_id || null,
  swap_with_name: r.swap_with_name || null,
  peer_accepted_at: Number(r.peer_accepted_at) || null,
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

/** เพดานไฟล์แนบต่อใบลา — ใบรับรองแพทย์ปกติหนึ่งใบ เผื่อถ่ายหลายหน้า */
const MAX_ATTACHMENTS = 5;

/**
 * รับ id ไฟล์ที่พนักงานอัปโหลดไว้แล้ว มาผูกกับใบลา
 *
 * **ไม่รับตัวไฟล์มาที่นี่ และไม่รับ path** — พนักงานอัปโหลดผ่าน
 * `employeeFileUpload` ก่อน (ซึ่งตรวจชนิด/ขนาด/นามสกุลไว้แล้ว) แล้วส่งแต่ id
 * มา ใบลาจึงเก็บแค่ "ชี้ไปที่ไฟล์ไหน" ไม่ได้เก็บสำเนาที่สองของเอกสารเดียวกัน
 *
 * การตรวจว่าเป็นของเจ้าตัวเป็น**เชิงโครงสร้าง**: อ่านใต้
 * `employee_files/{employeeId}` เท่านั้น id ของคนอื่นจึงหาไม่เจอ ไม่ใช่เพราะ
 * มี `if` ที่ลืมได้
 */
async function claimLeaveAttachments(db, employeeId, raw) {
  const ids = Array.isArray(raw) ? raw.map((x) => str(x, 60)).filter(Boolean) : [];
  if (!ids.length) return [];
  if (ids.length > MAX_ATTACHMENTS) {
    throw new HttpsError("invalid-argument", `แนบไฟล์ได้ไม่เกิน ${MAX_ATTACHMENTS} ไฟล์`);
  }
  const snaps = await Promise.all(
    ids.map((id) => db.ref(`employee_files/${employeeId}/${id}`).once("value")),
  );
  const out = [];
  snaps.forEach((snap, i) => {
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบไฟล์ที่แนบมา");
    const v = snap.val() || {};
    out.push({ id: ids[i], filename: v.filename || null, content_type: v.content_type || null });
  });
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

    // **หัวหน้ามาด้วยตั้งแต่ตอนเปิดแอป** — ฟอร์มขอลาต้องบอกได้ว่าใบนี้จะไปถึงใคร
    // ก่อนกดส่ง (ดีไซน์ 05 บรรทัด "ผู้อนุมัติ") และถ้ายังไม่ได้ตั้ง `supervisor_id`
    // พนักงานต้องเห็นตั้งแต่ตอนนั้นว่ายังไม่มีใครอนุมัติจากแอปได้ ไม่ใช่รู้ตอน
    // ใบค้างอยู่หลายวัน. เป็นการอ่านโหนดเดี่ยวเพิ่มหนึ่งครั้งต่อการเปิดแอป
    // และส่งออกแค่ชื่อกับตำแหน่ง ไม่ใช่แฟ้มของหัวหน้าทั้งใบ
    const supervisorId = str(employee.supervisor_id, 80);
    const supSnap = supervisorId
      ? await db.ref(`employees/${supervisorId}`).once("value")
      : null;
    const sup = supSnap && supSnap.exists() ? supSnap.val() : null;

    return {
      id,
      name: employee.name || null,
      employee_code: employee.employee_code || null,
      position: employee.position || null,
      department: employee.department || null,
      photo_url: employee.photo_url || null,
      status: employee.status || null,
      supervisor: sup ? { name: sup.name || null, position: sup.position || null } : null,
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
      // `id` = ใบที่กำลังแก้อยู่ — validator ข้ามใบนี้ตอนเช็คช่วงทับและตอนรวม
      // วันที่ใช้ไปแล้ว ไม่งั้นการแก้ใบเดิมจะชนกับตัวเองเสมอ
      draft: { type: str(d.type, 40), from: str(d.from, 10), to: str(d.to, 10),
        half_start: d.halfStart === true, half_end: d.halfEnd === true,
        id: str(d.requestId, 60) || undefined },
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
      half_start: d.halfStart === true, half_end: d.halfEnd === true,
      document_note: str(d.documentNote, 200),
    };
    const v = validateLeaveRequest({
      employee, draft, requests, overrides: policy.overrides, calendar: policy.calendar,
    });
    if (!v.ok) throw new HttpsError("failed-precondition", v.errors.join(" · "));

    const attachments = await claimLeaveAttachments(db, employeeId, d.attachments);

    const ref = db.ref(`leave_requests/${employeeId}`).push();
    const row = {
      type: draft.type, from: draft.from, to: draft.to,
      half_start: draft.half_start, half_end: draft.half_end,
      attachments: attachments.length ? attachments : null,
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
  // employeeLeaveUpdate — แก้ใบของตัวเองที่ยังไม่ถูกตัดสิน
  //
  // **แก้ในที่เดิม ไม่ใช่ยกเลิกแล้วยื่นใหม่** — สองคำสั่งที่ล้มกลางทางได้แปลว่า
  // ใบเดิมหายไปแล้วใบใหม่ไม่เกิด. `days`/`paid_days`/`unpaid_days` คำนวณใหม่
  // ฝั่ง server ทุกครั้งเหมือนตอนสร้าง ไม่รับตัวเลขจาก client
  // -------------------------------------------------------------------------
  const employeeLeaveUpdate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const requestId = str(d.requestId, 60);
    if (!requestId) throw new HttpsError("invalid-argument", "ต้องระบุใบลา");

    const ref = db.ref(`leave_requests/${employeeId}/${requestId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบลา");
    // ใบที่ถูกตัดสินไปแล้วแก้ไม่ได้ด้วยเหตุผลเดียวกับที่ยกเลิกไม่ได้ — วันลาถูก
    // นับเข้ายอดและอาจถูกจัดเวรแทนไปแล้ว
    if (snap.val().status !== "pending") {
      throw new HttpsError("failed-precondition", "ใบที่ตัดสินไปแล้วแก้จากแอปไม่ได้ ติดต่อหัวหน้างาน");
    }

    const [policy, requests] = await Promise.all([loadPolicy(db), loadRequests(db, employeeId)]);
    const draft = {
      id: requestId,
      type: str(d.type, 40), from: str(d.from, 10), to: str(d.to, 10),
      half_start: d.halfStart === true, half_end: d.halfEnd === true,
      document_note: str(d.documentNote, 200),
    };
    const v = validateLeaveRequest({
      employee, draft, requests, overrides: policy.overrides, calendar: policy.calendar,
    });
    if (!v.ok) throw new HttpsError("failed-precondition", v.errors.join(" · "));

    const patch = {
      type: draft.type, from: draft.from, to: draft.to,
      half_start: draft.half_start, half_end: draft.half_end,
      days: v.days, paid_days: v.paid_days, unpaid_days: v.unpaid_days,
      reason: str(d.reason, 400) || null,
      document_note: draft.document_note || null,
      // ร่องรอยการแก้ — หัวหน้าที่เห็นใบนี้ในกล่องอนุมัติต้องรู้ว่ามันถูกแก้
      // หลังยื่น ไม่ใช่ใบที่ยื่นมาแบบนี้ตั้งแต่แรก
      edited_at: nowMs(),
      edited_by_uid: request.auth.uid,
    };
    await ref.update(patch);
    const row = { ...snap.val(), ...patch };
    return { ok: true, id: requestId, warnings: v.warnings,
      request: publicRequest({ id: requestId, employee_id: employeeId, ...row }) };
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

  // -------------------------------------------------------------------------
  // employeeSwapCandidates — "ใครสลับกะกับฉันวันนั้นได้บ้าง" (ดีไซน์ 04)
  //
  // **รายชื่อจำกัดที่ทีมเดียวกัน (หัวหน้าคนเดียวกัน) หรือสาขาเดียวกัน** ไม่ใช่
  // ทั้งบริษัท — รายชื่อพนักงานทุกคนพร้อมกะของแต่ละคนเป็นข้อมูลที่ไม่มีเหตุผล
  // ให้ทุกคนเห็น และการสลับกะข้ามสาขาก็ไม่ใช่สิ่งที่ตารางเวรรองรับอยู่แล้ว
  //
  // **คนที่สลับไม่ได้ยังถูกส่งมาพร้อมเหตุผล ไม่ใช่ถูกกรองทิ้ง** — ดีไซน์ต้นทาง
  // แสดงแถวจางๆ ว่า "ลาวันนั้น · ไม่สามารถสลับ" ซึ่งถูก: การหายไปเฉยๆ ทำให้คน
  // ไล่หาชื่อเพื่อนที่รู้ว่ามีตัวตนแล้วสรุปว่าแอปพัง
  // -------------------------------------------------------------------------
  const employeeSwapCandidates = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const date = str((request.data || {}).date, 10);
    if (!DATE_RE.test(date)) throw new HttpsError("invalid-argument", "วันที่ไม่ถูกต้อง");

    const [hrSnap, empSnap] = await Promise.all([
      db.ref("settings/hr").once("value"),
      db.ref("employees").once("value"),
    ]);
    const { shifts } = A.normalizeShifts((hrSnap.val() || {}).shifts);
    const employees = empSnap.exists() ? empSnap.val() : {};

    const myRosterSnap = await db.ref(`shift_roster/${employeeId}/${date}`).once("value");
    const mine = A.resolveShift({
      shifts, roster: { [date]: myRosterSnap.val() }, employee, iso: date,
    }).shift;
    if (!mine) throw new HttpsError("failed-precondition", "วันนั้นคุณไม่มีกะ จึงไม่มีอะไรให้สลับ");

    const myBranch = str(employee.branch, 120);
    const mySup = str(employee.supervisor_id, 80);
    const peers = Object.entries(employees).filter(([id, e]) => (
      id !== employeeId && e && e.status === "ACTIVE"
      && ((mySup && str(e.supervisor_id, 80) === mySup) || (myBranch && str(e.branch, 120) === myBranch))
    )).slice(0, MAX_REPORTS);

    const rows = await Promise.all(peers.map(async ([id, e]) => {
      const [rSnap, leaves] = await Promise.all([
        db.ref(`shift_roster/${id}/${date}`).once("value"),
        loadRequests(db, id),
      ]);
      const theirs = A.resolveShift({
        shifts, roster: { [date]: rSnap.val() }, employee: e, iso: date,
      }).shift;
      // ใบลาที่ยัง "กินสิทธิ์" (รออนุมัติ หรืออนุมัติแล้ว) คลุมวันนั้นอยู่ไหม
      const onLeave = leaves.some((l) => (
        (l.status === "pending" || l.status === "approved")
        && String(l.from || "") <= date && date <= String(l.to || "")
      ));
      let blocked = null;
      if (onLeave) blocked = "ลาวันนั้น";
      else if (!theirs) blocked = "วันนั้นไม่มีกะ";
      else if (theirs.id === mine.id) blocked = "อยู่กะเดียวกัน";
      return {
        id,
        name: e.name || null,
        employee_code: e.employee_code || null,
        same_team: Boolean(mySup && str(e.supervisor_id, 80) === mySup),
        shift: theirs ? { id: theirs.id, label: theirs.label, start: theirs.start, end: theirs.end } : null,
        blocked,
      };
    }));

    rows.sort((a, b) => (a.blocked ? 1 : 0) - (b.blocked ? 1 : 0)
      || (b.same_team ? 1 : 0) - (a.same_team ? 1 : 0)
      || String(a.name || "").localeCompare(String(b.name || "")));

    return {
      date,
      my_shift: { id: mine.id, label: mine.label, start: mine.start, end: mine.end },
      candidates: rows,
    };
  });

  // -------------------------------------------------------------------------
  // employeeShiftSwapCreate — ขอสลับกะกับเพื่อน (ดีไซน์ 04)
  //
  // **สองขั้น ไม่ใช่ขั้นเดียว**: เพื่อนตอบรับก่อน (`awaiting_peer`) แล้วค่อยเข้า
  // กล่องหัวหน้า (`pending`) — คำขอที่หัวหน้าอนุมัติได้ทันทีโดยเพื่อนไม่เคยรู้
  // คือการเปลี่ยนกะของคนอื่นลับหลังเขา ซึ่งแย่กว่าไม่มีฟีเจอร์นี้เลย
  //
  // เก็บในโหนดเดิม `shift_requests/{ผู้ขอ}` โดยตั้งใจ — หัวหน้าคนเดิมอนุมัติ
  // ด้วยเส้นทางเดิม และคำขอเปลี่ยนกะเดี่ยวก็ยังเป็นแถวรูปเดียวกันที่ไม่มีขาสลับ
  // -------------------------------------------------------------------------
  const employeeShiftSwapCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const date = str(d.date, 10);
    const peerId = str(d.peerId, 80);
    if (!DATE_RE.test(date)) throw new HttpsError("invalid-argument", "วันที่ไม่ถูกต้อง");
    if (!peerId) throw new HttpsError("invalid-argument", "ต้องเลือกคนที่จะสลับด้วย");
    if (peerId === employeeId) throw new HttpsError("invalid-argument", "สลับกับตัวเองไม่ได้");
    if (date < A.bangkokIso(nowMs())) {
      throw new HttpsError("failed-precondition", "ขอสลับกะย้อนหลังไม่ได้");
    }

    const [hrSnap, peerSnap, myRoster, peerRoster, mineReqs, peerReqs, peerLeaves] = await Promise.all([
      db.ref("settings/hr").once("value"),
      db.ref(`employees/${peerId}`).once("value"),
      db.ref(`shift_roster/${employeeId}/${date}`).once("value"),
      db.ref(`shift_roster/${peerId}/${date}`).once("value"),
      loadShiftRequests(db, employeeId),
      loadShiftRequests(db, peerId),
      loadRequests(db, peerId),
    ]);
    if (!peerSnap.exists()) throw new HttpsError("not-found", "ไม่พบเพื่อนร่วมงานคนนี้");
    const peer = peerSnap.val();
    if (peer.status !== "ACTIVE") throw new HttpsError("failed-precondition", "คนนี้ไม่ได้อยู่ในสถานะทำงาน");

    const { shifts } = A.normalizeShifts((hrSnap.val() || {}).shifts);
    const mine = A.resolveShift({ shifts, roster: { [date]: myRoster.val() }, employee, iso: date }).shift;
    const theirs = A.resolveShift({ shifts, roster: { [date]: peerRoster.val() }, employee: peer, iso: date }).shift;
    if (!mine) throw new HttpsError("failed-precondition", "วันนั้นคุณไม่มีกะ");
    if (!theirs) throw new HttpsError("failed-precondition", "วันนั้นเขาไม่มีกะ");
    if (mine.id === theirs.id) throw new HttpsError("failed-precondition", "อยู่กะเดียวกันอยู่แล้ว");

    if (peerLeaves.some((l) => (l.status === "pending" || l.status === "approved")
      && String(l.from || "") <= date && date <= String(l.to || ""))) {
      throw new HttpsError("failed-precondition", "เขาลาวันนั้น สลับไม่ได้");
    }
    // ค้างใบเดียวต่อวันต่อคน — ทั้งฝั่งเราและฝั่งเขา ไม่งั้นตารางเวรของวันเดียว
    // จะมีคำขอสองใบที่ขัดกันเองรออยู่
    const openStatuses = ["pending", "awaiting_peer"];
    if (mineReqs.some((r) => r.date === date && openStatuses.includes(r.status))) {
      throw new HttpsError("failed-precondition", "มีคำขอของวันนี้ค้างอยู่แล้ว");
    }
    if (peerReqs.some((r) => r.date === date && openStatuses.includes(r.status))) {
      throw new HttpsError("failed-precondition", "เขามีคำขอของวันนี้ค้างอยู่แล้ว");
    }

    const ref = db.ref(`shift_requests/${employeeId}`).push();
    const row = {
      date,
      from_shift_id: mine.id,
      from_shift_label: mine.label,
      to_shift_id: theirs.id,
      to_shift_label: theirs.label,
      swap_with_employee_id: peerId,
      swap_with_name: peer.name || null,
      reason: str(d.reason, 400) || null,
      status: "awaiting_peer",
      requested_at: nowMs(),
      requested_by_uid: request.auth.uid,
      requested_by_name: employee.name || null,
      supervisor_id: str(employee.supervisor_id, 80) || null,
    };
    // **ตัวชี้ในกล่องของเพื่อน** — ไม่งั้นการหา "ใครขอสลับกับฉันบ้าง" ต้องไล่อ่าน
    // `shift_requests` ของทุกคน ซึ่งเป็นการกวาดโหนดที่กฎค่า RTDB ห้ามไว้
    await db.ref(`shift_swap_inbox/${peerId}/${ref.key}`).set({
      requester_id: employeeId, date, at: row.requested_at,
    });
    await ref.set(row);
    return { ok: true, id: ref.key, request: publicShiftRequest({ id: ref.key, employee_id: employeeId, ...row }) };
  });

  // -------------------------------------------------------------------------
  // employeeShiftSwapRespond — เพื่อนกดรับ/ปฏิเสธคำขอสลับ
  //
  // ผู้ตอบต้องเป็น `swap_with_employee_id` ของใบนั้นเท่านั้น — ตรวจจากใบ ไม่ใช่
  // จากพารามิเตอร์ที่ผู้เรียกส่งมา
  // -------------------------------------------------------------------------
  const employeeShiftSwapRespond = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const requesterId = str(d.requesterId, 80);
    const requestId = str(d.requestId, 60);
    const accept = d.accept === true;
    if (!requesterId || !requestId) throw new HttpsError("invalid-argument", "ต้องระบุคำขอ");

    const ref = db.ref(`shift_requests/${requesterId}/${requestId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบคำขอ");
    const cur = snap.val();
    if (str(cur.swap_with_employee_id, 80) !== employeeId) {
      throw new HttpsError("permission-denied", "คำขอนี้ไม่ได้ส่งถึงคุณ");
    }
    if (cur.status !== "awaiting_peer") {
      throw new HttpsError("failed-precondition", "คำขอนี้ถูกตอบไปแล้ว");
    }

    await ref.update(accept
      ? { status: "pending", peer_accepted_at: nowMs(), peer_responded_by_name: employee.name || null }
      : { status: "declined_by_peer", peer_declined_at: nowMs(), peer_responded_by_name: employee.name || null });
    // ตอบแล้วออกจากกล่อง ไม่ว่าตอบว่าอะไร — กล่องนี้คือ "รอฉันตอบ" ไม่ใช่ประวัติ
    await db.ref(`shift_swap_inbox/${employeeId}/${requestId}`).remove();
    return { ok: true, status: accept ? "pending" : "declined_by_peer" };
  });

  const employeeShiftChangeList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const [hrSnap, rows] = await Promise.all([
      db.ref("settings/hr").once("value"),
      loadShiftRequests(db, employeeId),
    ]);
    const { shifts } = A.normalizeShifts((hrSnap.val() || {}).shifts);

    // คำขอสลับที่รอ *ฉัน* ตอบ — อ่านผ่านตัวชี้ในกล่องของตัวเอง ทีละใบ
    const inboxSnap = await db.ref(`shift_swap_inbox/${employeeId}`).once("value");
    const pointers = [];
    inboxSnap.forEach((c) => { pointers.push({ id: c.key, ...(c.val() || {}) }); return false; });
    const incoming = (await Promise.all(pointers.slice(0, MAX_ROWS).map(async (ptr) => {
      const rid = str(ptr.requester_id, 80);
      if (!rid) return null;
      const snap = await db.ref(`shift_requests/${rid}/${ptr.id}`).once("value");
      if (!snap.exists()) return null;
      const v = snap.val();
      // ตัวชี้ค้างได้ถ้าคำขอถูกตอบด้วยเส้นทางอื่น — ไม่โชว์ ไม่ใช่ error
      if (v.status !== "awaiting_peer") return null;
      return { ...publicShiftRequest({ id: ptr.id, employee_id: rid, ...v }), requester_id: rid };
    }))).filter(Boolean);

    return {
      shifts: shifts.map((s) => ({ id: s.id, label: s.label, start: s.start, end: s.end })),
      requests: rows.slice(0, MAX_ROWS).map(publicShiftRequest),
      incoming,
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
  // supervisorLeaveAttachment — เปิดไฟล์แนบของใบลาที่กำลังจะอนุมัติ
  //
  // **แคบกว่า "หัวหน้าเปิดแฟ้มลูกน้องได้"** โดยตั้งใจ — ตรวจสามชั้น: เป็นลูกน้อง
  // ตรงจริง · ใบลานั้นเป็นของเขาจริง · และไฟล์ที่ขอ **ถูกแนบไว้กับใบนั้น**
  // (ชั้นที่สามคือชั้นที่สำคัญ ไม่งั้นมันจะกลายเป็นประตูอ่านสำเนาบัตรประชาชน
  // ของลูกน้องทุกคน โดยอ้างว่าจะอนุมัติใบลา)
  // -------------------------------------------------------------------------
  const supervisorLeaveAttachment = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    const { id: supervisorId } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const targetId = str(d.employeeId, 80);
    const requestId = str(d.requestId, 60);
    const fileId = str(d.fileId, 60);
    if (!targetId || !requestId || !fileId) throw new HttpsError("invalid-argument", "ข้อมูลไม่ครบ");

    const empSnap = await db.ref(`employees/${targetId}`).once("value");
    if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงาน");
    if (str(empSnap.val().supervisor_id, 80) !== supervisorId) {
      throw new HttpsError("permission-denied", "เปิดได้เฉพาะไฟล์ของลูกน้องในสายของตัวเอง");
    }

    const reqSnap = await db.ref(`leave_requests/${targetId}/${requestId}`).once("value");
    if (!reqSnap.exists()) throw new HttpsError("not-found", "ไม่พบใบลา");
    const listed = (reqSnap.val().attachments || []).some((a) => a && a.id === fileId);
    if (!listed) throw new HttpsError("permission-denied", "ไฟล์นี้ไม่ได้แนบกับใบลานี้");

    const fileSnap = await db.ref(`employee_files/${targetId}/${fileId}`).once("value");
    if (!fileSnap.exists()) throw new HttpsError("not-found", "ไม่พบไฟล์");
    const row = fileSnap.val() || {};
    if (!row.storage_path) throw new HttpsError("not-found", "ไฟล์นี้ไม่มีข้อมูลแนบ");
    const [buf] = await getStorage().bucket().file(row.storage_path).download();
    return {
      filename: row.filename || "document",
      content_type: row.content_type || "application/octet-stream",
      base64: buf.toString("base64"),
    };
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
      const stamp = { at, by_name: supervisor.name || null, source: "shift_request" };
      const peerId = str(cur.swap_with_employee_id, 80);
      if (peerId) {
        // **สลับต้องเขียนสองฝั่งในคำสั่งเดียว** — เขียนทีละฝั่งแล้วล้มกลางทาง
        // แปลว่าวันนั้นมีสองคนอยู่กะเดียวกันและอีกกะไม่มีใคร ซึ่งไม่มีใครเห็น
        // จนกว่าจะถึงวันงาน. `update()` หลาย path ของ RTDB เป็น atomic
        await db.ref().update({
          [`shift_roster/${targetId}/${cur.date}`]: { shift_id: cur.to_shift_id, ...stamp },
          [`shift_roster/${peerId}/${cur.date}`]: { shift_id: cur.from_shift_id, ...stamp },
        });
      } else {
        await db.ref(`shift_roster/${targetId}/${cur.date}`).set({ shift_id: cur.to_shift_id, ...stamp });
      }
    }
    return { ok: true };
  });

  return {
    employeeMe,
    employeeLeaveList,
    employeeLeavePreview,
    employeeLeaveCreate,
    employeeLeaveUpdate,
    employeeLeaveCancel,
    employeeShiftChangeCreate,
    employeeShiftChangeList,
    employeeSwapCandidates,
    employeeShiftSwapCreate,
    employeeShiftSwapRespond,
    supervisorInbox,
    supervisorLeaveAttachment,
    supervisorDecide,
  };
}

module.exports = { registerHrEmployeePortal, directReports, publicShiftRequest, MAX_ROWS, MAX_REPORTS };
