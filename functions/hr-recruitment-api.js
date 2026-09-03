// =============================================================================
// สายการรับสมัครงาน — callable (ย้ายการตัดสินใจจ้างมาไว้ฝั่ง HR)
//
// **ข้อมูลไม่ได้ย้าย** — ใบสมัครยังถูกเขียนโดยฟอร์ม `/careers` ของเว็บลูกค้า
// ลงที่ `job_applications/{id}` ที่เดิม สิ่งที่ย้ายมาคือ *การอ่านและตัดสินใจ*
// ซึ่งเป็นงานของ HR และเป็นที่ที่ทะเบียนพนักงานอยู่ ย้ายข้อมูลด้วยจะได้โหนดที่
// สองที่ต้อง sync กับฟอร์มสมัครตลอดไปโดยไม่ได้อะไรเพิ่ม
//
// เครื่องสถานะอยู่ที่ `hr-recruitment.js` (pure มี unit test) ไฟล์นี้ทำแค่
// โหลด · ตรวจสิทธิ์ · เขียน · และ **ต่อสะพานไปทะเบียนพนักงานตอนกดจ้าง** โดย
// เรียก `createEmployeeRecord` ตัวเดียวกับที่หน้าทะเบียนใช้ ไม่ได้เขียนใหม่
//
// **ขอบเขตที่จงใจไม่ข้าม: กดจ้างแล้ว "ไม่ออกบัญชี login ให้"**
// การออกบัญชีคือการให้สิทธิ์เข้าระบบพร้อม role ซึ่ง `adminStaffCreate` gate ไว้
// ที่ CEO — ถ้าให้สายนี้ออกบัญชีเองได้ role HR จะสร้างบัญชี role อะไรก็ได้
// รวมถึง CEO ผ่านทางอ้อม ซึ่งเป็นรูที่ P3 เพิ่งปิดไปจากอีกด้าน (การปิดบัญชี)
// แฟ้มที่สร้างจึงขึ้นว่า "ยังไม่ผูกบัญชี" และ CEO เป็นคนออกบัญชีแล้วผูกเข้ามา
//
// `job_applications` มี rule ให้ admin อ่านได้อยู่แล้ว และ Admin SDK bypass
// rules — **ไม่ต้อง deploy rules**
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, sanitizeEmployeePublic, sanitizeEmployeePrivate, employeeActorFields } = require("./hr-core");
const { createEmployeeRecord } = require("./hr.js");
const {
  STAGES, stageOf, canTransition, nextStages, canHire, employeeDraftFrom, summarize,
} = require("./hr-recruitment");

const REGION = "asia-southeast1";

// อ่านย้อนหลังตาม `.indexOn: created_at` ที่มีอยู่แล้ว ไม่กวาดทั้งโหนด
// (กฎค่า RTDB) — เพดานสูงพอสำหรับร้านขนาดนี้ และถ้าชนเพดานหน้าเว็บบอก
const MAX_APPLICATIONS = 300;

/** ฟิลด์ที่ส่งออกไปหน้าเว็บ — allowlist ไม่ใช่ส่งทั้งก้อน */
function publicApplication(id, raw) {
  const a = raw || {};
  const stage = stageOf(a);
  return {
    id,
    full_name: a.full_name || null,
    phone: a.phone || null,
    email: a.email || null,
    position_id: a.position_id || null,
    position_title: a.position_title || null,
    experience: a.experience || null,
    introduction: a.introduction || null,
    resume_url: a.resume_url || null,
    created_at: Number(a.created_at) || null,
    uid: a.uid || null,
    status: stage,
    stage_label: STAGES[stage].label,
    next: nextStages(stage),
    employee_id: a.employee_id || null,
    hired_at: Number(a.hired_at) || null,
    stage_history: Array.isArray(a.stage_history) ? a.stage_history.slice(-20) : [],
    offer_note: a.offer_note || null,
  };
}

function registerHrRecruitment() {
  // -------------------------------------------------------------------------
  // adminHrApplicationList
  // -------------------------------------------------------------------------
  const adminHrApplicationList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);

    const snap = await db.ref("job_applications")
      .orderByChild("created_at").limitToLast(MAX_APPLICATIONS).once("value");
    const rows = [];
    snap.forEach((c) => { rows.push(publicApplication(c.key, c.val())); return false; });
    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    console.log(`[hr-recruit] list ${rows.length} applications`);
    return {
      applications: rows,
      summary: summarize(rows),
      stages: STAGES,
      capped: rows.length >= MAX_APPLICATIONS,
    };
  });

  // -------------------------------------------------------------------------
  // adminHrApplicationSetStage — ย้ายสถานะตามเครื่องสถานะ
  // -------------------------------------------------------------------------
  const adminHrApplicationSetStage = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const id = String(data.applicationId || "");
    const to = String(data.stage || "");
    if (!id) throw new HttpsError("invalid-argument", "ไม่ได้ระบุใบสมัคร");

    const ref = db.ref(`job_applications/${id}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบสมัคร");
    const app = snap.val();

    const verdict = canTransition(stageOf(app), to);
    if (!verdict.ok) throw new HttpsError("failed-precondition", verdict.reason);

    const at = Date.now();
    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    // ประวัติเก็บบนใบเอง — ใบสมัครหนึ่งใบมีเหตุการณ์ไม่กี่ครั้ง การแยกโหนด
    // ประวัติออกไปคือคนอ่านเพิ่มอีกที่โดยไม่ได้อะไร
    const history = Array.isArray(app.stage_history) ? app.stage_history.slice(-49) : [];
    history.push({
      from: stageOf(app), to, at,
      by_name: actor.by_name || null,
      by_staff_id: actor.by_staff_id || null,
      note: String(data.note || "").slice(0, 300) || null,
    });

    const updates = { status: to, stage_history: history, updated_at: at };
    // บันทึกเงื่อนไขข้อเสนอไว้บนใบ — ตอนกดจ้างจะได้ไม่ต้องนึกเอาเองว่าตกลง
    // อะไรกันไว้ (และเป็นหลักฐานถ้ามีข้อโต้แย้งภายหลัง)
    if (to === "offer" && data.note) updates.offer_note = String(data.note).slice(0, 300);

    await ref.update(updates);
    console.log(`[hr-recruit] ${id} ${stageOf(app)} -> ${to} by ${callerStaffId || "?"}`);
    return { ok: true, application: publicApplication(id, { ...app, ...updates }) };
  });

  // -------------------------------------------------------------------------
  // adminHrApplicationHire — สะพานไปทะเบียนพนักงาน
  // -------------------------------------------------------------------------
  const adminHrApplicationHire = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const id = String(data.applicationId || "");
    if (!id) throw new HttpsError("invalid-argument", "ไม่ได้ระบุใบสมัคร");

    const ref = db.ref(`job_applications/${id}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบสมัคร");
    const app = snap.val();

    const verdict = canHire(app);
    if (!verdict.ok) throw new HttpsError("failed-precondition", verdict.reason);

    // ค่าที่ตกลงกันตอนยื่นข้อเสนอ (วันเริ่มงาน ประเภทการจ้าง เงินเดือน) ไม่ได้
    // อยู่ในใบสมัคร — HR กรอกตอนกดจ้าง **ห้ามเดาแทน** ค่าที่เดาให้แล้วไม่มีใคร
    // ตรวจคือค่าที่จะไปโผล่ในรอบจ่ายเงินเดือนรอบแรก
    const draft = employeeDraftFrom(app);
    const pub = sanitizeEmployeePublic({ ...draft, ...(data.profile || {}) }, { partial: false });
    const priv = sanitizeEmployeePrivate(data.private || {}, { partial: false });
    const errors = [...pub.errors, ...priv.errors];
    if (errors.length) throw new HttpsError("invalid-argument", errors.join(" · "));

    const { employeeId, code, at } = await createEmployeeRecord(db, {
      pub: pub.value, priv: priv.value, links: {}, status: "active",
      actor: employeeActorFields(callerStaffId, staffMap, request.auth),
    });

    // ผูกสองทาง — ใบสมัครชี้ไปแฟ้ม และแฟ้มชี้กลับไปใบ ทำให้ตอบได้ทั้งสองทิศ
    // ว่า "คนนี้มาจากใบไหน" และ "ใบนี้กลายเป็นใครในทะเบียน"
    await ref.update({ status: "hired", employee_id: employeeId, hired_at: at, updated_at: at });
    await db.ref(`employees/${employeeId}/application_id`).set(id);

    console.log(`[hr-recruit] hired ${id} -> employee ${employeeId} (${code})`);
    return {
      ok: true, employeeId, employeeCode: code,
      // บอกตรงๆ ว่ายังไม่มีบัญชี login — หน้าเว็บต้องพูดต่อ ไม่ใช่ปล่อยให้
      // เข้าใจว่าจ้างแล้วเข้าระบบได้เลย
      accountIssued: false,
    };
  });

  return { adminHrApplicationList, adminHrApplicationSetStage, adminHrApplicationHire };
}

module.exports = { registerHrRecruitment, MAX_APPLICATIONS, publicApplication };
