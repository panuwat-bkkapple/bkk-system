// =============================================================================
// สายการรับสมัครงาน — callable (หน้าใบสมัครงานทั้งหมดอยู่ฝั่ง HR แล้ว)
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
//
// -----------------------------------------------------------------------------
// โน้ตภายในอยู่คนละโหนดกับใบสมัคร และนั่นคือสาระสำคัญของไฟล์นี้
//
// `job_applications/$appId` ให้ **เจ้าของใบอ่านใบตัวเองได้** ดังนั้นทุกฟิลด์บน
// แถวนั้นคือของที่ผู้สมัครอ่านได้ ไม่ใช่แค่ที่หน้าเว็บเลือกแสดง โน้ต HR
// เงื่อนไขข้อเสนอ (มีเงินเดือน) และประวัติที่มีชื่อพนักงานจริง จึงย้ายไปอยู่
// `job_application_notes/{id}` ซึ่งไม่มี rule เป็นของตัวเอง = ตกกฎ root
// `.read/.write: false` — **ไม่ต้อง deploy rules**
//
// **แถวเก่าถูกย้ายให้อัตโนมัติตอน list** (`migrateLegacyNotes`) เพราะโน้ตที่
// หน้าเดิมฝั่งเว็บลูกค้าเขียนไว้มีอยู่จริงบน production แล้ว ถ้าย้ายเฉพาะตอนมี
// คนกดแก้ ใบที่ไม่มีใครแตะอีกจะค้างอยู่บนโหนดที่ผู้สมัครอ่านได้ตลอดไป
// เป็น idempotent: รอบแรกเขียน รอบต่อไปไม่เขียนอะไรเลย
//
// **สิ่งที่ยังไม่มีตัวเก็บกวาด:** `job_application_notes/{id}` ของใบที่ถูก
// retention sweep ฝั่ง bkk-frontend-next ลบไป (365 วัน) จะค้างเป็นแถวกำพร้า
// ตัวลบของเรา (`adminHrApplicationDelete`) เก็บให้ครบ แต่ตัวกวาดอัตโนมัติของ
// อีกรีโปไม่รู้จักโหนดนี้ — จดไว้ตรงๆ ดีกว่าเขียนตัวกวาดที่เดาอายุเอาเอง
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onValueCreated } = require("firebase-functions/v2/database");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, sanitizeEmployeePublic, sanitizeEmployeePrivate, employeeActorFields } = require("./hr-core");
const { createEmployeeRecord } = require("./hr.js");
const {
  STAGES, TRACK, trackStepOf, stageOf, canTransition, nextStages, canHire, employeeDraftFrom, summarize,
  legacyInternalFields, mergeNotes, canDelete, resumeStoragePath,
  clearInternalOnRow, stageRowUpdate, deletionLogRow,
} = require("./hr-recruitment");

const REGION = "asia-southeast1";

// อ่านย้อนหลังตาม `.indexOn: created_at` ที่มีอยู่แล้ว ไม่กวาดทั้งโหนด
// (กฎค่า RTDB) — เพดานสูงพอสำหรับร้านขนาดนี้ และถ้าชนเพดานหน้าเว็บบอก
const MAX_APPLICATIONS = 300;

// เพดานการย้ายโน้ตเก่าต่อการเปิดหน้าหนึ่งครั้ง — ครั้งแรกอาจไม่ครบ แต่รอบ
// ถัดไปเก็บที่เหลือ ดีกว่าเขียนยาวจน callable timeout
const MAX_NOTE_MIGRATIONS = 50;

/** ฟิลด์ที่ส่งออกไปหน้าเว็บ — allowlist ไม่ใช่ส่งทั้งก้อน */
function publicApplication(id, raw, notes) {
  const a = raw || {};
  const stage = stageOf(a);
  const n = mergeNotes(a, notes);
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
    // ใบขับขี่: สามสถานะ ไม่ใช่สอง — ไม่มีฟิลด์ = ตำแหน่งนี้ไม่ได้ถาม หรือใบนี้
    // ส่งมาก่อนฟอร์มจะมีคำถาม **ห้ามยุบเป็น false** (ดู src/pages/hr/applicantFacts.ts)
    has_driver_license:
      typeof a.has_driver_license === "boolean" ? a.has_driver_license : null,
    // ความยินยอม PDPA — เวอร์ชันของประกาศที่เขาเห็นตอนกด ต้องมาคู่กับเวลาเสมอ
    consent_at: Number(a.consent_at) || null,
    consent_privacy_version: a.consent_privacy_version || null,
    created_at: Number(a.created_at) || null,
    uid: a.uid || null,
    status: stage,
    stage_label: STAGES[stage].label,
    // ขั้นบนแถบความคืบหน้า — 0 = อยู่นอกสาย (ปฏิเสธ/ถอนตัว/ค่าเก่า)
    track_step: trackStepOf(a),
    next: nextStages(stage),
    employee_id: a.employee_id || null,
    hired_at: Number(a.hired_at) || null,
    can_delete: canDelete(a).ok,
    // สามตัวนี้มาจากโหนดภายใน ไม่ใช่จากแถวใบสมัคร
    stage_history: Array.isArray(n.stage_history) ? n.stage_history.slice(-20) : [],
    offer_note: n.offer_note,
    admin_note: n.admin_note,
  };
}

/**
 * ย้ายโน้ตเก่าที่ยังอยู่บนแถวใบสมัครไปโหนดภายใน
 *
 * **ล้มแล้วต้องไม่ทำให้หน้าเว็บพัง** — การย้ายเป็นงานทำความสะอาด ส่วนการอ่าน
 * รายการคือสิ่งที่ HR มาเปิด เขียนไม่ได้ก็ยังต้องเห็นรายการ (และ `mergeNotes`
 * อ่านค่าจากแถวเก่าได้อยู่แล้ว จึงไม่มีอะไรหายไปจากจอ)
 */
async function migrateLegacyNotes(db, rows) {
  let moved = 0;
  for (const { id, raw, notes } of rows) {
    if (moved >= MAX_NOTE_MIGRATIONS) break;
    const legacy = legacyInternalFields(raw);
    if (!legacy) continue;
    try {
      // โหนดใหม่ชนะเสมอ — ค่าที่ย้ายไปแล้วและถูกแก้ต่อ ห้ามถูกค่าบนแถวทับ
      const merged = mergeNotes(raw, notes);
      await db.ref(`job_application_notes/${id}`).update({
        admin_note: merged.admin_note,
        offer_note: merged.offer_note,
        stage_history: merged.stage_history,
        migrated_at: Date.now(),
      });
      await db.ref(`job_applications/${id}`).update(clearInternalOnRow());
      moved += 1;
    } catch (e) {
      console.error(`[hr-recruit] ย้ายโน้ตของ ${id} ไม่สำเร็จ: ${e.message}`);
    }
  }
  if (moved) console.log(`[hr-recruit] moved internal fields off ${moved} application rows`);
  return moved;
}

/** โหลดโน้ตภายในทั้งโหนด — หนึ่งแถวต่อหนึ่งใบสมัคร ก้อนเล็ก อ่านครั้งเดียว */
async function loadNotesMap(db) {
  const snap = await db.ref("job_application_notes").once("value");
  return snap.val() || {};
}

/**
 * @param {object} deps  `dispatchAdminPush` / `dispatchTelegram` / `staffIdsByRoles`
 *   ฉีดจาก index.js แบบเดียวกับ dealer-portal และ health-check — ไฟล์นี้ import
 *   ตรงไม่ได้เพราะทั้งสามตัวอยู่ใน index.js ซึ่ง require ไฟล์นี้อยู่ (วงกลม)
 *   ไม่ส่ง deps มา = ทริกเกอร์ไม่ถูกสร้าง ส่วน callable ทำงานตามปกติ
 */
function registerHrRecruitment(deps = {}) {
  // -------------------------------------------------------------------------
  // adminHrApplicationList
  // -------------------------------------------------------------------------
  const adminHrApplicationList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);

    const [snap, notesMap] = await Promise.all([
      db.ref("job_applications").orderByChild("created_at").limitToLast(MAX_APPLICATIONS).once("value"),
      loadNotesMap(db),
    ]);

    const raws = [];
    snap.forEach((c) => { raws.push({ id: c.key, raw: c.val(), notes: notesMap[c.key] }); return false; });

    const movedNotes = await migrateLegacyNotes(db, raws);

    const rows = raws.map((r) => publicApplication(r.id, r.raw, r.notes));
    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    console.log(`[hr-recruit] list ${rows.length} applications`);
    return {
      applications: rows,
      summary: summarize(rows),
      stages: STAGES,
      // ลำดับขั้นมาจาก server — หน้าเว็บวาดแถบตามนี้ ไม่ได้ถือ array ของตัวเอง
      track: TRACK,
      capped: rows.length >= MAX_APPLICATIONS,
      moved_notes: movedNotes,
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
    const notesRef = db.ref(`job_application_notes/${id}`);
    const [snap, notesSnap] = await Promise.all([ref.once("value"), notesRef.once("value")]);
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบสมัคร");
    const app = snap.val();
    const notes = mergeNotes(app, notesSnap.val());

    const verdict = canTransition(stageOf(app), to);
    if (!verdict.ok) throw new HttpsError("failed-precondition", verdict.reason);

    const at = Date.now();
    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    // ประวัติเก็บบนโหนดภายใน — มันมี `by_name` (ชื่อจริงของพนักงาน) อยู่ ซึ่ง
    // เป็น PII ของบุคคลที่สาม วางไว้บนแถวใบสมัครแปลว่าผู้สมัครอ่านได้
    const history = notes.stage_history.slice(-49);
    history.push({
      from: stageOf(app), to, at,
      by_name: actor.by_name || null,
      by_staff_id: actor.by_staff_id || null,
      note: String(data.note || "").slice(0, 300) || null,
    });

    const noteUpdates = { stage_history: history };
    // บันทึกเงื่อนไขข้อเสนอไว้ — ตอนกดจ้างจะได้ไม่ต้องนึกเอาเองว่าตกลงอะไรกันไว้
    // (และเป็นหลักฐานถ้ามีข้อโต้แย้งภายหลัง) เงินเดือนอยู่ในข้อความนี้จึงต้อง
    // อยู่โหนดภายในเท่านั้น
    if (to === "offer" && data.note) noteUpdates.offer_note = String(data.note).slice(0, 300);

    await notesRef.update(noteUpdates);
    // เขียนสถานะทีหลัง และล้างฟิลด์ภายในที่อาจค้างบนแถวไปพร้อมกัน
    await ref.update(stageRowUpdate(to, at));

    console.log(`[hr-recruit] ${id} ${stageOf(app)} -> ${to} by ${callerStaffId || "?"}`);
    const merged = mergeNotes({}, { ...notes, ...noteUpdates });
    return { ok: true, application: publicApplication(id, { ...app, status: to, updated_at: at }, merged) };
  });

  // -------------------------------------------------------------------------
  // adminHrApplicationNote — โน้ต HR เกี่ยวกับผู้สมัคร
  //
  // แยกจากประวัติสถานะโดยตั้งใจ: ประวัติคือสิ่งที่เกิดขึ้น โน้ตคือความเห็น
  // ของ HR ซึ่งแก้ทับได้ ส่วนประวัติแก้ไม่ได้
  // -------------------------------------------------------------------------
  const adminHrApplicationNote = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const id = String(data.applicationId || "");
    if (!id) throw new HttpsError("invalid-argument", "ไม่ได้ระบุใบสมัคร");

    const ref = db.ref(`job_applications/${id}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบสมัคร");

    const at = Date.now();
    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    const note = String(data.note || "").slice(0, 2000).trim();

    await db.ref(`job_application_notes/${id}`).update({
      admin_note: note || null,
      note_by_name: actor.by_name || null,
      note_at: at,
    });
    // แถวเก่าอาจมีโน้ตค้างอยู่บนตัวใบ ซึ่งผู้สมัครอ่านได้ — ล้างทิ้งตอนนี้เลย
    await ref.update(clearInternalOnRow());

    console.log(`[hr-recruit] note on ${id} by ${callerStaffId || "?"} (${note.length} chars)`);
    return { ok: true, admin_note: note || null };
  });

  // -------------------------------------------------------------------------
  // adminHrApplicationDelete — ลบใบสมัครพร้อมไฟล์เรซูเม่
  //
  // **ลบไฟล์ก่อน แล้วค่อยลบแถว และไฟล์ลบไม่สำเร็จ = ยกเลิกทั้งรายการ**
  // ลำดับกลับกันเมื่อไหร่จะได้เรซูเม่กำพร้าใน Storage ที่ไม่มีใครหาเจออีกเลย
  // (URL อยู่บนแถวที่เพิ่งลบ) และไม่มี process ไหนตามมาเก็บ — retention sweep
  // ของ bkk-frontend-next กวาดเฉพาะ RTDB ไม่แตะ Storage
  //
  // `storage.rules` ไม่มี grant สำหรับ delete โดยตั้งใจ (ถอดออกไปแล้วเพราะ
  // ผู้ใช้นิรนามลบเรซูเม่ของคนอื่นได้) — คอมเมนต์ที่นั่นเขียนไว้ตรงๆ ว่า
  // "Restoring deletion means a callable, not this grant" ตัวนี้คือ callable นั้น
  // Admin SDK ไม่ผ่าน rules **ไม่ต้อง deploy storage.rules**
  // -------------------------------------------------------------------------
  const adminHrApplicationDelete = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const id = String(data.applicationId || "");
    if (!id) throw new HttpsError("invalid-argument", "ไม่ได้ระบุใบสมัคร");

    const ref = db.ref(`job_applications/${id}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบใบสมัคร");
    const app = snap.val();

    const verdict = canDelete(app);
    if (!verdict.ok) throw new HttpsError("failed-precondition", verdict.reason);

    let resumeDeleted = false;
    if (app.resume_url) {
      const path = resumeStoragePath(app.resume_url);
      if (!path) {
        throw new HttpsError(
          "failed-precondition",
          "อ่าน path ของไฟล์เรซูเม่จาก URL ไม่ได้ จึงยังลบไม่ได้ — ลบแถวทิ้งโดยไฟล์ยังอยู่จะไม่มีใครตามไปลบได้อีก",
        );
      }
      try {
        await getStorage().bucket().file(path).delete();
        resumeDeleted = true;
      } catch (e) {
        // 404 = ไฟล์หายไปแล้ว (ถูกลบไปก่อนหน้า) ซึ่งคือสภาพที่เราต้องการอยู่แล้ว
        if (e && (e.code === 404 || e.code === "404")) resumeDeleted = true;
        else throw new HttpsError("internal", `ลบไฟล์เรซูเม่ไม่สำเร็จ (${e.message}) จึงยังไม่ลบใบสมัคร`);
      }
    }

    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    // ทะเบียนการลบ — **ไม่เก็บชื่อ/เบอร์/อีเมลของผู้สมัคร** การเก็บไว้คือการ
    // ไม่ได้ลบ สิ่งที่ต้องตอบได้คือ "ใบไหน ใครลบ เมื่อไหร่" เท่านั้น
    await db.ref("job_application_deletions").push(
      deletionLogRow(id, app, actor, resumeDeleted, data.reason),
    );

    // ตัวชี้ฝั่งผู้สมัคร (`users/{uid}/job_applications/{id}`) ต้องไปด้วย ไม่งั้น
    // หน้า "ใบสมัครงานของฉัน" จะพยายามอ่านใบที่ไม่มีอยู่ทุกครั้งที่เปิด
    if (app.uid) await db.ref(`users/${app.uid}/job_applications/${id}`).remove();
    await db.ref(`job_application_notes/${id}`).remove();
    await ref.remove();

    console.log(`[hr-recruit] deleted ${id} by ${callerStaffId || "?"} (resume=${resumeDeleted})`);
    return { ok: true, resumeDeleted };
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

  // -------------------------------------------------------------------------
  // onJobApplicationCreated — มีคนสมัครงาน แจ้ง CEO/MANAGER
  //
  // ก่อนหน้านี้ **ไม่มีใครถูกแจ้งเลย** ใบสมัครไปนอนรออยู่ที่ /recruitment
  // จนกว่าจะมีคนนึกได้ว่าต้องเปิดดู — ขณะที่ใบสมัคร*ดีลเลอร์*แจ้งมาตั้งแต่ต้น
  // (dealer-portal.js) ความไม่สมมาตรนี้ไม่มีเหตุผล คนสมัครงานที่รอเงียบสองอาทิตย์
  // คือคนที่ไปรับงานที่อื่นแล้ว
  //
  // **ไม่ใส่ชื่อ/เบอร์/อีเมลผู้สมัครลงข้อความแจ้งเตือน** — push ขึ้นหน้าจอล็อก
  // และเข้า Telegram ที่มีคนอยู่ในห้องมากกว่าคนที่ควรเห็นใบสมัคร ตำแหน่งที่สมัคร
  // ไม่ใช่ PII และเพียงพอให้รู้ว่าต้องไปเปิดดู (หลักเดียวกับ probe
  // `order_reconciliation` ใน health-check.js ที่ชี้ไปหน้าที่ gate สิทธิ์แล้วแทน)
  //
  // best-effort ทั้งก้อน — ใบสมัครถูกบันทึกไปแล้วตั้งแต่ก่อนถึงตรงนี้
  // การแจ้งเตือนล้มต้องไม่ทำให้ใบสมัครหาย
  const onJobApplicationCreated = deps.dispatchAdminPush
    ? onValueCreated(
        { region: REGION, ref: "/job_applications/{appId}" },
        async (event) => {
          const app = event.data?.val() || {};
          const position = str(app.position_title, 80) || "ไม่ระบุตำแหน่ง";
          try {
            const db = getDatabase();
            const targets = deps.staffIdsByRoles
              ? await deps.staffIdsByRoles(db, ["CEO", "MANAGER"])
              : null;
            await deps.dispatchAdminPush(
              {
                data: {
                  type: "job_application",
                  title: "ใบสมัครงานใหม่",
                  body: `ตำแหน่ง ${position} — รอตรวจสอบ`,
                  url: "/recruitment",
                },
              },
              "jobApplication",
              "admin",
              targets
            );
            if (deps.dispatchTelegram) {
              await deps.dispatchTelegram(
                `<b>ใบสมัครงานใหม่</b>\nตำแหน่ง ${position}\nเปิดดูที่หน้าใบสมัครงาน`,
                "jobApplication"
              );
            }
          } catch (e) {
            console.error("[hr] job application notify failed:", (e && e.message) || e);
          }
        }
      )
    : null;

  return {
    adminHrApplicationList,
    adminHrApplicationSetStage,
    adminHrApplicationNote,
    adminHrApplicationDelete,
    adminHrApplicationHire,
    // ไม่ส่ง deps มา = ไม่มีทริกเกอร์ (แต่ callable ยังทำงานครบ) — ทำให้เทส
    // ที่ require ไฟล์นี้ตรงๆ ไม่ต้องมี Firebase app
    ...(onJobApplicationCreated ? { onJobApplicationCreated } : {}),
  };
}

module.exports = { registerHrRecruitment, MAX_APPLICATIONS, publicApplication };
