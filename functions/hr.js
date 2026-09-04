// =============================================================================
// ทะเบียนพนักงาน (HR) — เฟส P1 ของ docs/hr-system-design.md
//
// วันนี้บริษัทไม่มีทะเบียนพนักงาน มีแต่ "บัญชีเข้าระบบ" กระจายอยู่สองที่
// (/staff สำหรับแอดมิน, /riders สำหรับไรเดอร์) ไฟล์นี้สร้างทะเบียนกลาง
// `employees/{id}` ที่ **ชี้ไป**หาของเดิมผ่าน `links` ไม่ใช่กลืนมัน — คีย์เดิม
// ห้ามย้าย เพราะ riders/{uid} เป็นคีย์ที่ database rules กับการจ่ายงานใช้จริง
// และ /staff push id ถูกอ้างจาก /admins/{uid}.staff_id
//
// ขอบเขตของ P1 และสิ่งที่ **ยังไม่ทำ** (สำคัญกว่าสิ่งที่ทำ):
//   - ยังไม่ออก/ปิดบัญชีอัตโนมัติ — นั่นคือ P3 (adminHrHire/adminHrTerminate)
//     ระหว่างนี้การเปลี่ยนสถานะเป็น "พ้นสภาพ" ในทะเบียน **ไม่ได้ปิดการเข้าถึง**
//     จึงต้องคืนธง `stale_access` ให้หน้าเว็บบอกความจริงข้อนี้ทุกครั้ง
//   - ยังไม่มีเงินเดือน/ภาษี (P5) และไม่มีเอกสาร/สัญญา (P4)
//
// **การอ่านทุกทางผ่าน callable ไม่ใช่ RTDB ตรง** เพราะโหนดใหม่ทั้งสามยังไม่มี
// rule เป็นของตัวเอง จึงตกกฎ root `.read/.write: false` = client อ่านไม่ได้
// Admin SDK เขียนได้ที่นี่ที่เดียว ซึ่งเป็นสถานะที่ถูกต้องสำหรับข้อมูลที่มี
// เลขบัตรประชาชนและเงินเดือนอยู่ข้างใน — rules สำหรับ self-service เป็นงานของ
// P2 ตอนที่พอร์ทัลต้องอ่าน realtime จริงๆ
//
// ชื่อ callable ทุกตัว prefix adminHr* ตามกฎ namespace {region}/{name}
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole, suspendStaffAccount } = require("./staff-accounts");
const { suspendRiderAccount } = require("./rider-accounts");
const { ssoRegistrationState, ssoStateMessage } = require("./hr-compliance");
const {
  HR_ROLES, splitThaiName,
  EMPLOYEE_STATUSES,
  EX_EMPLOYEE_STATUSES,
  bangkokBuddhistYear,
  formatEmployeeCode,
  sanitizeEmployeePublic,
  sanitizeEmployeePrivate,
  accessSummary,
  planAccountClosure,
  unlinkedAccounts,
  employeeActorFields,
  supervisorChainError,
} = require("./hr-core");

const { buildAuditEntry, auditPath, auditFieldsFor } = require("./audit-log");
const { buildEmployeeHistory } = require("./employee-history");

const REGION = "asia-southeast1";

const nowMs = () => Date.now();

async function loadRegistry(db) {
  const [empSnap, staffSnap, riderSnap] = await Promise.all([
    db.ref("employees").once("value"),
    db.ref("staff").once("value"),
    db.ref("riders").once("value"),
  ]);
  return {
    employees: empSnap.exists() ? empSnap.val() : {},
    staffMap: staffSnap.exists() ? staffSnap.val() : {},
    ridersMap: riderSnap.exists() ? riderSnap.val() : {},
  };
}

// ประวัติการจ้างงาน — best-effort เหมือน recordStaffEvent/recordTransition:
// สิทธิ์หรือข้อมูลถูกเปลี่ยนไปแล้วจริง การโยน error ตรงนี้จะทำให้คนกดเข้าใจว่า
// ไม่สำเร็จแล้วกดซ้ำ ซึ่งแย่กว่าประวัติขาดแถว
/**
 * บันทึกลง audit log — ใครแก้อะไร จากค่าอะไรเป็นค่าอะไร
 *
 * **คนละเรื่องกับ `recordEmployeeEvent`** ซึ่งเป็นไทม์ไลน์ของการจ้าง:
 * audit เก็บ *ค่า* (รวมเงินเดือน) และคนอ่านแคบกว่า · ประวัติเป็นของ
 * **คำนวณ** จาก audit + ข้อมูลจริง ไม่ใช่โหนดที่สาม (ดู employee-history.js)
 *
 * best-effort เหมือนกัน — ข้อมูลถูกเปลี่ยนไปแล้วจริง การ throw ตรงนี้ทำให้
 * คนกดเข้าใจว่าไม่สำเร็จแล้วกดซ้ำ ซึ่งแย่กว่า audit ขาดแถว **แต่ต้องดังใน log**
 */
async function recordAudit(db, { entity, entityId, action, actor, before, after, fields, reason }) {
  try {
    const entry = buildAuditEntry({ entity, entityId, action, actor, before, after, fields, reason });
    if (!entry) return;
    const path = auditPath(entity, entityId);
    if (!path) return;
    await db.ref(path).push(entry);
  } catch (e) {
    console.error("[hr] audit log failed:", e && e.message ? e.message : e);
  }
}

/**
 * แปลง `employeeActorFields()` เป็นรูปที่ `buildAuditEntry` รับ
 *
 * สองรูปนี้ต่างกันเพราะคนละโหนดคนละคนอ่าน — ไทม์ไลน์ใช้ `by_*` ส่วน audit ใช้
 * `actor_*` การแปลงจึงต้องมีที่เดียว ไม่ใช่พิมพ์ `{ uid: f.by_uid, ... }` ซ้ำ
 * ทุก call site
 */
function auditActorOf(actorFields) {
  const a = actorFields || {};
  return { uid: a.by_uid || null, name: a.by_name || null, role: a.by_role || null };
}

async function recordEmployeeEvent(db, event) {
  try {
    await db.ref("employee_events").push(event);
  } catch (e) {
    console.error("[hr] employee event log failed:", e && e.message ? e.message : e);
  }
}

// รหัสประจำตัว — transaction เดียวกับที่เลขรันเอกสารใช้ (settings/accounting/
// *_seq_by_period) ตัวนับแยกรายปีพุทธศักราชจึงรีเซ็ตเองโดยไม่ต้องมีใครไปกด
async function allocateEmployeeCode(db) {
  const settingsSnap = await db.ref("settings/hr").once("value");
  const settings = settingsSnap.val() || {};
  const prefix = settings.employee_code_prefix || "EMP";
  const year = bangkokBuddhistYear(nowMs());
  const ref = db.ref(`settings/hr/employee_code_seq_by_year/${year}`);
  const res = await ref.transaction((cur) => (Number(cur) || 0) + 1);
  if (!res.committed) throw new HttpsError("aborted", "จองรหัสพนักงานไม่สำเร็จ ลองใหม่อีกครั้ง");
  return formatEmployeeCode(prefix, year, res.snapshot.val());
}

/**
 * สร้างแฟ้มพนักงานหนึ่งใบ — ทางเดียวที่แฟ้มพนักงานเกิดขึ้นได้
 *
 * แยกออกมาเพราะสายรับสมัครงาน (`hr-recruitment-api.js`) ต้องสร้างแฟ้มตอนกดจ้าง
 * ด้วย **สำเนาที่สองของการสร้างแฟ้มคือทางที่ของบางอย่างจะหายไป** และตัวที่หาย
 * เงียบที่สุดคือ `employees_private` (แฟ้มที่ไม่มีโหนดนี้จะเข้ารอบเงินเดือนแล้ว
 * ขึ้นว่า "ยังไม่ได้ตั้งเงินเดือน" ซึ่งถูก) กับ `employee_code` ที่ต้องมาจาก
 * ตัวนับ transaction ตัวเดียว ไม่งั้นรหัสซ้ำ
 */
async function createEmployeeRecord(db, { pub, priv, links, status, actor }) {
  const at = nowMs();
  const code = await allocateEmployeeCode(db);
  const ref = db.ref("employees").push();
  const employeeId = ref.key;

  await ref.set({
    ...pub,
    employee_code: code,
    status: EMPLOYEE_STATUSES.includes(String(status || "").toLowerCase())
      ? String(status).toLowerCase()
      : "active",
    links: links || {},
    created_at: at,
    updated_at: at,
  });
  await db.ref(`employees_private/${employeeId}`).set({ ...(priv || {}), updated_at: at });

  await recordEmployeeEvent(db, {
    employee_id: employeeId,
    action: "hired",
    from: null,
    to: { status: "active", employment_type: pub.employment_type },
    reason: null,
    at,
    ...(actor || {}),
  });

  // ── audit log ────────────────────────────────────────────────────────────
  //
  // **แถวแรกของแฟ้มคือแถวที่ audit ต้องมีที่สุด** — "ใครเป็นคนเอาคนนี้เข้า
  // ทะเบียนเงินเดือน และตั้งเงินเดือนเริ่มต้นไว้เท่าไร" ถ้าเก็บเฉพาะการแก้
  // ทีหลัง คนที่ถูกสร้างมาพร้อมเงินเดือนสูงแล้วไม่เคยถูกแก้เลยจะไม่มีแถวไหน
  // ในระบบเล่าถึงเขาเลย
  //
  // อยู่ในตัวสร้างแฟ้ม **ไม่ใช่ที่ callable** เพราะแฟ้มเกิดได้สองทาง (ทะเบียน
  // กับกดจ้างผู้สมัคร) และ seam เดียวคือเหตุผลที่ฟังก์ชันนี้ถูกแยกออกมาแต่แรก
  await recordAudit(db, {
    entity: "employee",
    entityId: employeeId,
    action: "created",
    actor: auditActorOf(actor),
    before: {},
    after: { ...pub, ...(priv || {}), employee_code: code },
    fields: auditFieldsFor("employee"),
  });

  // ห้าม log เลขบัตร/เงินเดือน — log ของ Cloud Run เก็บนานกว่าและมีคนอ่าน
  // ได้กว้างกว่าตัวข้อมูลเอง
  console.log(`[hr] employee created ${employeeId} code=${code}`);
  return { employeeId, code, at };
}

function assertNoErrors(errors) {
  if (errors && errors.length) {
    throw new HttpsError("invalid-argument", errors.join(" · "));
  }
}

// บัญชีหนึ่งใบผูกได้กับพนักงานคนเดียว — ถ้าปล่อยให้ผูกซ้ำ เงินเดือนกับประวัติ
// การจ้างของคนสองคนจะชี้ไปที่บัญชีเดียวกัน แล้วไม่มีทางรู้ว่าอันไหนจริง
function assertLinkFree(employees, selfId, links) {
  for (const [id, e] of Object.entries(employees || {})) {
    if (id === selfId || !e) continue;
    const l = e.links || {};
    if (links.staff_id && l.staff_id === links.staff_id) {
      throw new HttpsError("already-exists", `บัญชีพนักงานนี้ถูกผูกกับ ${e.name || id} แล้ว`);
    }
    if (links.rider_id && l.rider_id === links.rider_id) {
      throw new HttpsError("already-exists", `บัญชีไรเดอร์นี้ถูกผูกกับ ${e.name || id} แล้ว`);
    }
  }
}

function sanitizeLinks(input) {
  const src = input && typeof input === "object" ? input : {};
  const pick = (v) => {
    const s = String(v == null ? "" : v).trim();
    return s ? s.slice(0, 128) : null;
  };
  return {
    staff_id: pick(src.staff_id),
    rider_id: pick(src.rider_id),
    auth_uid: pick(src.auth_uid),
    application_id: pick(src.application_id),
  };
}

function registerHr() {
  // -------------------------------------------------------------------------
  // adminHrEmployeeList — ทะเบียนทั้งชุด + สถานะการเข้าถึง + บัญชีที่ยังไม่ผูก
  //
  // คืน private มาด้วย เพราะผู้เรียกคือ CEO/HR ซึ่งเป็นคนกลุ่มเดียวที่มีสิทธิ์
  // อยู่แล้ว — แยกเป็นสองคำขอไม่ได้เพิ่มความปลอดภัย แต่เพิ่มจังหวะที่หน้าเว็บ
  // แสดงข้อมูลไม่ครบ
  // -------------------------------------------------------------------------
  const adminHrEmployeeList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const { employees, staffMap, ridersMap } = await loadRegistry(db);

    const privSnap = await db.ref("employees_private").once("value");
    const privateMap = privSnap.exists() ? privSnap.val() : {};

    // **สถานะ ปกส. คิดฝั่ง server ไม่ใช่ให้หน้าเว็บคิดเอง** — กฎเรื่องกำหนด
    // 30 วันเป็นกติกาเดียวที่ probe ใน /system-health กับรอบจ่ายเงินเดือนก็ใช้
    // ถ้าให้ UI คิดเองจะได้สำเนาที่สามที่ drift โดยไม่มีใครรู้ว่าฝั่งไหนถูก
    const now = nowMs();
    const items = Object.entries(employees).map(([id, e]) => {
      const priv = privateMap[id] || null;
      const sso = ssoRegistrationState({ employee: { id, ...e }, priv: priv || {}, now });
      // **ข้อเสนอการแยกชื่อ ไม่ใช่การแยกจริง** — ส่งไปให้ฟอร์มเติมค่าเริ่มต้น
      // เท่านั้น คนต้องเห็นแล้วกดบันทึกเอง เพราะชื่อ/นามสกุลไปโผล่บนแบบยื่นภาษี
      // การเดาผิดแล้วบันทึกเงียบๆ คือการยื่นผิดโดยไม่มีใครรู้
      const split = Boolean(e.first_name && e.last_name);
      return {
        id,
        ...e,
        access: accessSummary(e, staffMap, ridersMap),
        private: priv,
        sso: { state: sso.state, days_left: sso.daysLeft ?? null, message: ssoStateMessage(sso) },
        name_split: split,
        name_suggestion: split ? null : splitThaiName(e.name),
      };
    });
    items.sort((a, b) => String(a.employee_code || "").localeCompare(String(b.employee_code || "")));

    return {
      items,
      unlinked: unlinkedAccounts(employees, staffMap, ridersMap),
    };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeCreate — เพิ่มคนเข้าทะเบียน (กรอกมือ)
  //
  // ไม่มี bulk import โดยตั้งใจ: พนักงาน 4 คน (ก.ย. 2569) การสร้างช่องทาง
  // ข้อมูลเข้าที่สองเพื่อประหยัดการพิมพ์สี่ครั้ง คือหนี้ที่ต้องดูแลตลอดไป
  //
  // **ไม่สร้างบัญชี login** — การออกบัญชีเป็น P3 ที่นี่ผูกได้เฉพาะบัญชีที่
  // มีอยู่แล้ว
  // -------------------------------------------------------------------------
  const adminHrEmployeeCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};

    const pub = sanitizeEmployeePublic(data.profile, { partial: false });
    const priv = sanitizeEmployeePrivate(data.private || {}, { partial: false });
    assertNoErrors([...pub.errors, ...priv.errors]);

    const links = sanitizeLinks(data.links);
    const { employees } = await loadRegistry(db);
    assertLinkFree(employees, null, links);
    // หัวหน้างานที่ชี้ไปที่คนที่ไม่มีอยู่ = ใบลาที่ไม่มีใครอนุมัติได้ และมันเงียบ
    {
      const err = supervisorChainError(employees, null, pub.value.supervisor_id);
      if (err) throw new HttpsError("invalid-argument", err);
    }

    // ผูกกับบัญชีที่ไม่มีอยู่ = ทะเบียนที่ชี้ไปที่ว่าง ตรวจตอนเขียนถูกกว่าตอนอ่าน
    if (links.staff_id) {
      const s = await db.ref(`staff/${links.staff_id}`).once("value");
      if (!s.exists()) throw new HttpsError("not-found", "ไม่พบบัญชีพนักงานที่จะผูก");
    }
    if (links.rider_id) {
      const r = await db.ref(`riders/${links.rider_id}`).once("value");
      if (!r.exists()) throw new HttpsError("not-found", "ไม่พบบัญชีไรเดอร์ที่จะผูก");
    }

    const { employeeId, code } = await createEmployeeRecord(db, {
      pub: pub.value, priv: priv.value, links, status: data.status,
      actor: employeeActorFields(callerStaffId, staffMap, request.auth),
    });
    return { ok: true, employeeId, employeeCode: code };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeUpdate — แก้ข้อมูล (public / private แยกกัน)
  // -------------------------------------------------------------------------
  const adminHrEmployeeUpdate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const employeeId = String(data.employeeId || "");
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");

    const snap = await db.ref(`employees/${employeeId}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");
    const existing = snap.val();

    const at = nowMs();
    const updates = {};
    let salaryChanged = false;
    // เก็บค่าก่อน/หลังของช่องเงินไว้ให้ audit — **audit ที่ไม่มีค่าเก่าคือ
    // audit ที่ตอบคำถามเดียวที่มันมีไว้ตอบไม่ได้** (ดู audit-log.js)
    let payBefore = null;
    let payAfter = null;

    if (data.profile !== undefined) {
      const pub = sanitizeEmployeePublic(data.profile, { partial: true });
      assertNoErrors(pub.errors);
      // ตรวจสายบังคับบัญชาเฉพาะเมื่อมีการส่งช่องนี้มาจริง — `partial` แปลว่า
      // ช่องที่ไม่ได้ส่งมาต้องไม่ถูกตีความว่า "ตั้งเป็นว่าง"
      if (Object.prototype.hasOwnProperty.call(pub.value, "supervisor_id")) {
        const { employees } = await loadRegistry(db);
        const err = supervisorChainError(employees, employeeId, pub.value.supervisor_id);
        if (err) throw new HttpsError("invalid-argument", err);
      }
      Object.assign(updates, pub.value);
    }
    if (data.private !== undefined) {
      const priv = sanitizeEmployeePrivate(data.private, { partial: true });
      assertNoErrors(priv.errors);
      if (Object.prototype.hasOwnProperty.call(priv.value, "pay")) {
        const before = (await db.ref(`employees_private/${employeeId}/pay`).once("value")).val() || {};
        salaryChanged = Number(before.base_salary || 0) !== Number(priv.value.pay.base_salary || 0)
          || Number(before.daily_rate || 0) !== Number(priv.value.pay.daily_rate || 0);
        payBefore = before;
        payAfter = priv.value.pay;

        // เบี้ยเลี้ยงประจำต้องรอดจากการแก้ข้อมูลที่ไม่เกี่ยวกับมัน
        //
        // `update()` แทนที่โหนด `pay` ทั้งก้อน และฟอร์มแก้ไขส่งมาแค่เงินเดือน
        // กับค่าแรงรายวัน — ถ้าไม่หิ้วของเดิมมาด้วย การแก้เบอร์โทรจะลบเบี้ยเลี้ยง
        // ทิ้ง แล้วเงินเดือนงวดถัดไปจะลดลงโดยไม่มีใครเห็นว่าเกิดจากอะไร
        // (`pay.allowances` เข้าสูตรใน hr-payroll.js ทั้งฝั่งรายได้และฐาน
        // ประกันสังคม) — รูปเดียวกับ carryInput ของรอบเงินเดือน
        const sentAllowances = Array.isArray(
          data.private && data.private.pay && data.private.pay.allowances
        );
        if (!sentAllowances) {
          priv.value.pay.allowances = Array.isArray(before.allowances) ? before.allowances : [];
        }
      }
      await db.ref(`employees_private/${employeeId}`).update({ ...priv.value, updated_at: at });
    }

    if (Object.keys(updates).length) {
      await db.ref(`employees/${employeeId}`).update({ ...updates, updated_at: at });
    }

    // บันทึกเฉพาะการเปลี่ยนที่มีผลทางการจ้าง — ถ้าเก็บทุกการแก้ ประวัติจะจม
    // อยู่ใต้การแก้คำสะกดชื่อ (เหตุผลเดียวกับ recordStaffEvent ที่เก็บเฉพาะ
    // การเปลี่ยน role)
    if (salaryChanged) {
      // ไทม์ไลน์การจ้าง — บอกว่า "มีการปรับเงินเดือน" ไม่บอกตัวเลข เพราะโหนดนี้
      // คนอ่านกว้างกว่า **ตัวเลขอยู่ใน audit log** ซึ่งประวัติหยิบไปแสดง
      // ให้เฉพาะคนที่เห็นเงินเดือนได้อยู่แล้ว
      await recordEmployeeEvent(db, {
        employee_id: employeeId,
        action: "salary_changed",
        from: null,
        to: null,
        reason: String(data.reason || "").slice(0, 300) || null,
        at,
        ...employeeActorFields(callerStaffId, staffMap, request.auth),
      });
    }

    // ── audit log ────────────────────────────────────────────────────────
    //
    // **เขียนค่าจริง** ทั้งช่องเงินและช่องข้อมูลทั่วไป — ก่อนหน้านี้ระบบเขียน
    // `from: null, to: null` ให้ทุกการปรับเงินเดือน ทำให้หน้าประวัติต้องขึ้น
    // ข้อความแก้ตัวว่า "ระบบไม่ได้บันทึกจำนวนเงินไว้" แล้วชี้ให้ไปดูค่าปัจจุบัน
    // ซึ่งไม่ใช่ประวัติ
    {
      const actor = auditActorOf(employeeActorFields(callerStaffId, staffMap, request.auth));
      const reason = String(data.reason || "").slice(0, 300) || null;
      await recordAudit(db, {
        entity: "employee", entityId: employeeId, action: "updated", actor, reason,
        before: { ...existing, ...(payBefore || {}) },
        after: { ...existing, ...updates, ...(payAfter || {}) },
        // ลิสต์มาจาก allowlist ตรงๆ — เดิมพิมพ์ไว้ที่นี่ 18 ชื่อ ซึ่งแปลว่า
        // ฟิลด์ที่ถูกเพิ่มเข้า `AUDIT_FIELDS` วันหน้าจะไม่ถูก audit เงียบๆ
        fields: auditFieldsFor("employee"),
      });
    }
    if (updates.position && updates.position !== existing.position) {
      await recordEmployeeEvent(db, {
        employee_id: employeeId,
        action: "promoted",
        from: { position: existing.position || null },
        to: { position: updates.position },
        reason: String(data.reason || "").slice(0, 300) || null,
        at,
        ...employeeActorFields(callerStaffId, staffMap, request.auth),
      });
    }
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeSetStatus — เปลี่ยนสถานะการจ้าง + ปิดการเข้าถึง (P3)
  //
  // **พ้นสภาพ = ปิดบัญชีให้อัตโนมัติ** (ข้อ 7 ของโจทย์) ด้วยกลไกเดียวกับที่
  // /staff และ /riders ใช้ ไม่ใช่สำเนาที่สอง — `suspendStaffAccount` และ
  // `suspendRiderAccount` ถูกแยกออกมาจากสองไฟล์นั้นเพื่อการนี้
  //
  // **ปิดอัตโนมัติ แต่เปิดคืนต้องทำด้วยมือเสมอ** — การแก้สถานะกลับเป็น active
  // คือการแก้ข้อมูล ไม่ใช่การอนุมัติให้คนกลับเข้าระบบ ระบบที่คืนสิทธิ์ให้เป็น
  // ผลข้างเคียงของการแก้ข้อมูลคือระบบที่ให้สิทธิ์โดยไม่มีใครตั้งใจ
  //
  // ยังคืน `access` กลับไปเหมือนเดิม — ปิดสำเร็จก็ต้องพิสูจน์ได้จากสถานะจริง
  // ไม่ใช่เชื่อเพราะเราบอกว่าปิดแล้ว
  // -------------------------------------------------------------------------
  const adminHrEmployeeSetStatus = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const employeeId = String(data.employeeId || "");
    const status = String(data.status || "").toLowerCase();
    if (!EMPLOYEE_STATUSES.includes(status)) {
      throw new HttpsError("invalid-argument", `สถานะต้องเป็นหนึ่งใน: ${EMPLOYEE_STATUSES.join(", ")}`);
    }
    const snap = await db.ref(`employees/${employeeId}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");
    const existing = snap.val();

    const at = nowMs();
    const reason = String(data.reason || "").slice(0, 300) || null;
    const leaving = EX_EMPLOYEE_STATUSES.includes(status);
    if (leaving && !reason) {
      throw new HttpsError("invalid-argument", "การพ้นสภาพต้องระบุเหตุผล");
    }

    // ── ปิดการเข้าถึง ──────────────────────────────────────────────────────
    // ตรวจก่อนเขียนอะไรทั้งสิ้น: ปฏิเสธแล้วต้องไม่เหลือร่องรอย เพราะการบันทึก
    // ว่า "พ้นสภาพ" ไว้โดยบัญชียังเปิด แล้วบอกให้ไปตามคนอื่นมากดต่อ คือสภาพ
    // ครึ่งๆ กลางๆ ที่งานนี้มีไว้กำจัด
    const { staffMap: preStaff, ridersMap: preRiders } = await loadRegistry(db);
    let closure = null;
    if (leaving) {
      const plan = planAccountClosure({
        employee: existing, staffMap: preStaff, ridersMap: preRiders,
        callerRole: (preStaff[callerStaffId] || {}).role, callerStaffId,
      });
      if (plan.refuse) throw new HttpsError("failed-precondition", plan.refuse.message);
      closure = plan;
    }

    await db.ref(`employees/${employeeId}`).update({
      status,
      terminated_at: leaving ? at : null,
      terminate_reason: leaving ? reason : null,
      updated_at: at,
    });

    // ปิดบัญชีหลังบันทึกสถานะ — ถ้าการปิดล้มกลางทาง (Auth ล่ม) ข้อเท็จจริงว่า
    // คนนี้พ้นสภาพแล้วยังถูกบันทึกไว้ และธง `stale_access` จะบอกหน้าเว็บเองว่า
    // ยังมีบัญชีเปิดค้างอยู่ ตรงข้ามกับการปิดก่อนแล้วบันทึกไม่สำเร็จ ซึ่งได้คน
    // ที่ถูกล็อกออกจากระบบโดยไม่มีบันทึกว่าทำไม
    const closed = { staff: null, rider: null, errors: [] };
    if (closure) {
      if (closure.staff && closure.staff.close) {
        try {
          await suspendStaffAccount(db, {
            staffId: closure.staff.id, existing: preStaff[closure.staff.id] || {},
            action: "terminated",
            reason: reason || "พ้นสภาพพนักงาน",
            actor: employeeActorFields(callerStaffId, preStaff, request.auth),
          });
          closed.staff = "closed";
        } catch (e) {
          closed.errors.push(`ปิดบัญชีพนักงานไม่สำเร็จ: ${(e && e.message) || e}`);
        }
      } else if (closure.staff) {
        closed.staff = `skipped:${closure.staff.skip}`;
      }

      if (closure.rider && closure.rider.close) {
        try {
          await suspendRiderAccount(db, {
            riderId: closure.rider.id, before: preRiders[closure.rider.id] || {},
            reason: reason || "พ้นสภาพพนักงาน",
            actor: {
              by_staff_id: callerStaffId || null,
              by_uid: request.auth && request.auth.uid,
              by_name: (preStaff[callerStaffId] || {}).name || null,
              by_role: String((preStaff[callerStaffId] || {}).role || "").toUpperCase() || null,
            },
          });
          closed.rider = "closed";
        } catch (e) {
          closed.errors.push(`ระงับบัญชีไรเดอร์ไม่สำเร็จ: ${(e && e.message) || e}`);
        }
      } else if (closure.rider) {
        closed.rider = `skipped:${closure.rider.skip}`;
      }
    }

    await recordEmployeeEvent(db, {
      employee_id: employeeId,
      action: status === "resigned" ? "resigned" : status === "terminated" ? "terminated"
        : status === "active" && existing.status === "probation" ? "probation_passed" : "profile_updated",
      from: { status: existing.status || null },
      to: { status },
      reason,
      at,
      ...employeeActorFields(callerStaffId, staffMap, request.auth),
    });

    // ── audit log ────────────────────────────────────────────────────────────
    //
    // สองแถว ไม่ใช่แถวเดียว เพราะเป็นคนละข้อเท็จจริง: **สถานะเปลี่ยน** เกิดขึ้น
    // เสมอ ส่วน **บัญชีถูกปิด** เกิดเฉพาะเมื่อปิดสำเร็จจริง — การพับรวมกันแปลว่า
    // แถวเดียวจะโกหกทุกครั้งที่ปิดบัญชีล้มกลางทาง (`closed.errors`) ซึ่งเป็น
    // เคสที่ธง `stale_access` มีไว้เตือนพอดี
    {
      const actor = auditActorOf(employeeActorFields(callerStaffId, staffMap, request.auth));
      await recordAudit(db, {
        entity: "employee", entityId: employeeId, action: "updated", actor, reason,
        before: existing,
        after: { ...existing, status, terminated_at: leaving ? at : null },
        fields: auditFieldsFor("employee"),
      });
      const revoked = [
        closed.staff === "closed" ? "บัญชีพนักงาน" : null,
        closed.rider === "closed" ? "บัญชีไรเดอร์" : null,
      ].filter(Boolean);
      if (revoked.length) {
        await recordAudit(db, {
          entity: "employee", entityId: employeeId, action: "account_revoked", actor,
          reason: `ปิด ${revoked.join(" และ ")}${reason ? ` · ${reason}` : ""}`,
          before: {}, after: {}, fields: [],
        });
      }
    }

    const { staffMap: freshStaff, ridersMap } = await loadRegistry(db);
    const access = accessSummary({ ...existing, status, links: existing.links }, freshStaff, ridersMap);
    console.log(
      `[hr] employee ${employeeId} status ${existing.status} -> ${status}` +
      ` (closed staff=${closed.staff || "-"} rider=${closed.rider || "-"}; access still open: ${access.open})`
    );
    return { ok: true, access, closed, nothing_to_close: Boolean(closure && closure.nothing_to_close) };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeLink — ผูก/ถอดบัญชีที่มีอยู่เข้ากับแฟ้มพนักงาน
  //
  // ถอดการผูก **ไม่ได้ปิดบัญชี** เช่นกัน — มันแค่บอกว่าแฟ้มนี้ไม่ใช่เจ้าของ
  // บัญชีนั้นแล้ว
  // -------------------------------------------------------------------------
  const adminHrEmployeeLink = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const employeeId = String(data.employeeId || "");
    const snap = await db.ref(`employees/${employeeId}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");
    const existing = snap.val();

    const next = sanitizeLinks({ ...(existing.links || {}), ...(data.links || {}) });
    const { employees } = await loadRegistry(db);
    assertLinkFree(employees, employeeId, next);

    if (next.staff_id && next.staff_id !== (existing.links || {}).staff_id) {
      const s = await db.ref(`staff/${next.staff_id}`).once("value");
      if (!s.exists()) throw new HttpsError("not-found", "ไม่พบบัญชีพนักงานที่จะผูก");
      // uid ของบัญชี Auth มาจาก staff record ไม่ใช่จาก client
      next.auth_uid = s.val().uid || next.auth_uid;
    }
    if (next.rider_id && next.rider_id !== (existing.links || {}).rider_id) {
      const r = await db.ref(`riders/${next.rider_id}`).once("value");
      if (!r.exists()) throw new HttpsError("not-found", "ไม่พบบัญชีไรเดอร์ที่จะผูก");
      // riders/{uid} ใช้ Firebase uid เป็นคีย์ตรงๆ
      next.auth_uid = next.auth_uid || next.rider_id;
    }

    const at = nowMs();
    await db.ref(`employees/${employeeId}/links`).set(next);
    await db.ref(`employees/${employeeId}/updated_at`).set(at);

    await recordEmployeeEvent(db, {
      employee_id: employeeId,
      action: (next.staff_id || next.rider_id) ? "linked" : "unlinked",
      from: { links: existing.links || null },
      to: { links: next },
      reason: null,
      at,
      ...employeeActorFields(callerStaffId, staffMap, request.auth),
    });
    return { ok: true, links: next };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeEvents — ประวัติการจ้างของคนหนึ่งคน
  // query ตาม index employee_id ไม่กวาดทั้งโหนด (กฎค่า RTDB)
  // -------------------------------------------------------------------------
// เพดานเหตุการณ์ต่อคน — ปกติคนหนึ่งมีไม่กี่สิบรายการตลอดอายุการจ้าง
  //
  // **หมายเหตุค่า RTDB: `employee_events` ยังไม่มี `.indexOn: "employee_id"`**
  // (rules อยู่ที่ `bkk-frontend-next/database.rules.json` ซึ่งต้อง deploy จาก
  // รีโปนั้น) ไม่มี index = RTDB อ่านทั้งโหนดมากรองเอง วันนี้โหนดยังเล็กมากจึงยัง
  // ไม่เจ็บ แต่ถ้าจำนวนพนักงานหรืออายุระบบโตขึ้น ต้องเพิ่ม index หรือย้ายไปเก็บ
  // ซ้อนใต้ `employee_events/{employeeId}` แบบเดียวกับ `hr_documents`
  const MAX_EVENTS = 200;
  const adminHrEmployeeEvents = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const employeeId = String((request.data || {}).employeeId || "");
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");
    // เพดานต้องบอกออกไป ไม่ใช่ตัดเงียบ — ไทม์ไลน์ที่ขาดท่อนต้นโดยไม่บอกคือ
    // ไทม์ไลน์ที่ตอบผิดเรื่อง "เริ่มงานเมื่อไหร่"
    const snap = await db.ref("employee_events")
      .orderByChild("employee_id").equalTo(employeeId).limitToLast(MAX_EVENTS).once("value");
    const items = [];
    snap.forEach((c) => { items.push({ id: c.key, ...c.val() }); return false; });
    items.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    return { items, capped: items.length >= MAX_EVENTS };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeHistory — ประวัติพนักงาน (ของ *คน* ไม่ใช่รายการแก้ฟิลด์)
  //
  // **ประกอบจากของที่มีอยู่แล้ว ไม่มีโหนดที่สาม** — ข้อเท็จจริงปัจจุบันจาก
  // `employees` · การเปลี่ยนย้อนหลังจาก `audit_log` · วันลาจาก
  // `leave_requests` · เอกสารจาก `hr_documents`
  //
  // ทุกอันอ่านเป็น subtree ของพนักงานคนเดียว **ไม่มีการกวาดโหนด** และไม่ต้อง
  // มี `.indexOn` (หนี้ที่ `employee_events` ยังติดอยู่)
  // -------------------------------------------------------------------------
  const adminHrEmployeeHistory = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const employeeId = String((request.data || {}).employeeId || "");
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");

    const [empSnap, auditSnap, leaveSnap, docSnap] = await Promise.all([
      db.ref(`employees/${employeeId}`).once("value"),
      db.ref(`audit_log/employee/${employeeId}`).limitToLast(300).once("value"),
      db.ref(`leave_requests/${employeeId}`).once("value"),
      db.ref(`hr_documents/${employeeId}`).once("value"),
    ]);
    if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");

    const collect = (snap) => {
      const out = [];
      snap.forEach((c) => { out.push({ id: c.key, ...c.val() }); return false; });
      return out;
    };

    const history = buildEmployeeHistory({
      employee: { id: employeeId, ...empSnap.val() },
      auditRows: collect(auditSnap),
      leaveRows: collect(leaveSnap),
      documents: collect(docSnap),
      now: nowMs(),
      // HR_ROLES คือ CEO/HR ซึ่งเห็น `employees_private` (ที่เก็บเงินเดือน)
      // อยู่แล้ว — ประวัติเงินเดือนจึงไม่ใช่การเปิดข้อมูลใหม่ให้ใคร
      canSeePay: true,
    });
    return history;
  });

  return {
    adminHrEmployeeHistory,
    adminHrEmployeeList,
    adminHrEmployeeCreate,
    adminHrEmployeeUpdate,
    adminHrEmployeeSetStatus,
    adminHrEmployeeLink,
    adminHrEmployeeEvents,
  };
}

module.exports = {
  registerHr, HR_ROLES,
  // ใช้ร่วมกับสายรับสมัครงาน — ห้ามก๊อปไปเขียนใหม่
  createEmployeeRecord, allocateEmployeeCode, recordEmployeeEvent, loadRegistry,
};
