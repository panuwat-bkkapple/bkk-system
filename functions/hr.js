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
  HR_ROLES,
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
} = require("./hr-core");

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
      return {
        id,
        ...e,
        access: accessSummary(e, staffMap, ridersMap),
        private: priv,
        sso: { state: sso.state, days_left: sso.daysLeft ?? null, message: ssoStateMessage(sso) },
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

    if (data.profile !== undefined) {
      const pub = sanitizeEmployeePublic(data.profile, { partial: true });
      assertNoErrors(pub.errors);
      Object.assign(updates, pub.value);
    }
    if (data.private !== undefined) {
      const priv = sanitizeEmployeePrivate(data.private, { partial: true });
      assertNoErrors(priv.errors);
      if (Object.prototype.hasOwnProperty.call(priv.value, "pay")) {
        const before = (await db.ref(`employees_private/${employeeId}/pay`).once("value")).val() || {};
        salaryChanged = Number(before.base_salary || 0) !== Number(priv.value.pay.base_salary || 0)
          || Number(before.daily_rate || 0) !== Number(priv.value.pay.daily_rate || 0);

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
      await recordEmployeeEvent(db, {
        employee_id: employeeId,
        action: "salary_changed",
        from: null, // ค่าเก่าเป็นข้อมูลอ่อนไหว — เก็บไว้ใน employees_private เท่านั้น
        to: null,
        reason: String(data.reason || "").slice(0, 300) || null,
        at,
        ...employeeActorFields(callerStaffId, staffMap, request.auth),
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

  return {
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
