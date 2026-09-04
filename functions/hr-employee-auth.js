// =============================================================================
// "คนที่กดในแอปพนักงาน คือใครในทะเบียน" — ตัวจับคู่ (ล้วน) + ตัว gate (I/O)
//
// แอปพนักงานล็อกอินด้วย Firebase Auth แต่สิ่งที่ระบบ HR รู้จักคือ
// `employees/{id}` การจับคู่จึงต้องมีที่เดียว ไม่ใช่ให้ callable แต่ละตัวเดาเอง
//
// **`links` เป็นของที่ฝ่ายบุคคลตั้ง ไม่ใช่ของที่ผู้ใช้ส่งมา** — uid มาจาก
// auth token เสมอ ห้ามรับจาก body (uid ที่ผู้เรียกระบุเองได้ = uid ที่ปลอมได้
// และการปลอมที่นี่ไม่ใช่แค่แถวขยะ แต่คือการลงเวลาแทนคนอื่น)
//
// **พ้นสภาพแล้วใช้แอปไม่ได้** — ปิดบัญชี Auth ตอนพ้นสภาพเป็นด่านหลักอยู่แล้ว
// (ดู `planAccountClosure`) แต่ด่านนั้นล้มได้กลางทาง (ธง `stale_access`) ตัวนี้
// จึงเป็นด่านที่สองที่ตัดสินจาก *ทะเบียน* ไม่ใช่จากสถานะบัญชี
// =============================================================================

"use strict";

const { HttpsError } = require("firebase-functions/v2/https");

const str = (v, max = 80) => String(v == null ? "" : v).trim().slice(0, max);

/** สถานะที่ยังถือว่าเป็นพนักงานอยู่ */
const WORKING_STATUSES = ["active", "probation"];

/**
 * หาแฟ้มพนักงานจาก uid — ล้วน ทดสอบได้
 *
 * ลำดับการจับคู่มีเหตุผล: `auth_uid` เป็นสิ่งที่ฝ่ายบุคคลตั้งไว้ตรงๆ ส่วน
 * `rider_id` เป็น uid โดยโครงสร้าง (`riders/{uid}`) จึงใช้เป็นทางสำรองได้ ส่วน
 * `staff_id` **ไม่ใช่ uid** จึงต้องมี staffMap มาช่วยแปลง
 *
 * คืน `{ id, employee }` หรือ `{ id: null, reason }` — เหตุผลมีชื่อ เพื่อให้
 * หน้าจอบอกได้ว่า "ยังไม่ได้ผูกบัญชี" ต่างจาก "พ้นสภาพแล้ว"
 */
function matchEmployeeByAuth(employees, { uid, staffMap } = {}) {
  const id = str(uid, 128);
  if (!id) return { id: null, employee: null, reason: "no_uid" };
  const rows = employees && typeof employees === "object" ? employees : {};

  // staff_id ที่ชี้กลับมาที่ uid นี้ (บัญชีพนักงานเก็บ uid ไว้ในตัวมันเอง)
  const staffIds = new Set();
  const sm = staffMap && typeof staffMap === "object" ? staffMap : {};
  for (const [sid, s] of Object.entries(sm)) {
    if (s && typeof s === "object" && str(s.uid, 128) === id) staffIds.add(sid);
  }

  let inactive = null;
  for (const [empId, v] of Object.entries(rows)) {
    const emp = v && typeof v === "object" ? v : {};
    const links = emp.links && typeof emp.links === "object" ? emp.links : {};
    const hit = str(links.auth_uid, 128) === id
      || str(links.rider_id, 128) === id
      || (links.staff_id && staffIds.has(str(links.staff_id, 128)));
    if (!hit) continue;
    const status = str(emp.status, 40).toLowerCase();
    if (!WORKING_STATUSES.includes(status)) {
      inactive = { id: null, employee: null, reason: "not_working", status };
      continue;
    }
    return { id: empId, employee: { id: empId, ...emp }, reason: null };
  }
  return inactive || { id: null, employee: null, reason: "not_linked" };
}

const REASON_MESSAGE = {
  no_uid: "ต้องเข้าสู่ระบบก่อน",
  not_linked: "บัญชีนี้ยังไม่ได้ผูกกับแฟ้มพนักงาน ติดต่อฝ่ายบุคคล",
  not_working: "บัญชีนี้ไม่ได้อยู่ในสถานะพนักงานปัจจุบัน",
};

/** gate ของทุก callable ฝั่งแอปพนักงาน */
async function requireEmployeeCaller(db, auth) {
  if (!auth || !auth.uid) throw new HttpsError("unauthenticated", REASON_MESSAGE.no_uid);
  const [empSnap, staffSnap] = await Promise.all([
    db.ref("employees").once("value"),
    db.ref("staff").once("value"),
  ]);
  const found = matchEmployeeByAuth(
    empSnap.exists() ? empSnap.val() : {},
    { uid: auth.uid, staffMap: staffSnap.exists() ? staffSnap.val() : {} },
  );
  if (!found.id) {
    throw new HttpsError("permission-denied", REASON_MESSAGE[found.reason] || REASON_MESSAGE.not_linked);
  }
  return found;
}

module.exports = {
  WORKING_STATUSES,
  REASON_MESSAGE,
  matchEmployeeByAuth,
  requireEmployeeCaller,
};
