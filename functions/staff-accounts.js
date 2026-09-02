// =============================================================================
// Staff account lifecycle — per-employee Firebase Auth accounts.
//
// สถาปัตยกรรมใหม่: พนักงานแต่ละคนมีบัญชี Firebase Auth ของตัวเอง (อีเมล+รหัสผ่าน
// ส่วนตัว) แทนบัญชีมาสเตอร์ร่วม + PIN แบบเดิม. ทุก operation ในไฟล์นี้เป็น
// callable ที่ gate ด้วย role CEO ฝั่ง server (ตรวจจากอีเมลใน auth token —
// client ปลอมไม่ได้) และเป็น "ผู้เขียนคนเดียว" ของ /staff และ /admins:
// database rules ปิด client write ทั้งสอง path แล้ว (bkk-frontend-next/
// database.rules.json) — Admin SDK bypass rules จึงเขียนได้ที่นี่ที่เดียว.
//
// การพักงาน (status INACTIVE) บังคับ 3 ชั้น:
//   1. Firebase Auth user ถูก disable → login ใหม่ไม่ได้ (auth/user-disabled)
//   2. revoke refresh tokens → token เดิมหมดอายุภายใน ~1 ชม.
//   3. ลบ /admins/{uid} → database rules ตัดสิทธิ์อ่าน/เขียนทันที ไม่ต้องรอ
//      token หมดอายุ (client ที่เปิดค้างจะโดนเตะออกด้วย useStaffSession watcher)
//
// การปิดบัญชี (adminStaffDelete) ถอนการเข้าถึงเท่ากับการพักงานทุกประการ บวก
// การลบบัญชี Auth ทิ้ง — แต่ **ไม่ลบแถวใน /staff** แถวนั้นถูกประทับ
// `terminated_at` แล้วอยู่ต่อ เพราะ id ของพนักงานถูกอ้างถึงจากที่อื่นเต็มไปหมด
// (qc_logs, adjustments, rider_status_events.by_staff_id และต่อไปคือ
// status_history ของทุก transition) การลบทิ้งทำให้ทุกอ้างอิงชี้ไปที่ว่าง
//
// ทุก operation ที่เปลี่ยน "สิทธิ์" เขียนแถวลง staff_status_events —
// สร้าง / ออกบัญชีใหม่ให้แถวเดิม / เปลี่ยน role / พักงาน / คืนสถานะ /
// ปิดบัญชี / รีเซ็ตรหัสผ่าน มิเรอร์ของ rider_status_events ทั้งรูปและเหตุผล
//
// ชื่อ functions ต้อง unique ระดับ project ({region}/{name}) — prefix adminStaff*
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const REGION = "asia-southeast1";
// HR = role ที่ 5 (ก.ย. 2569) — ดู docs/hr-system-design.md ข้อ 7.1
// **ห้ามเพิ่ม HR เข้า ROLE_TO_ACTOR ใน actor.js** การที่ resolveActor คืน null
// ให้ HR คือด่านที่กันฝ่ายบุคคลออกจากเอนด์พอยต์ที่จ่ายเงิน (SICKW) และจาก
// การเปลี่ยนสถานะงาน ไม่ใช่ของที่ลืมเติม
const VALID_ROLES = ["CEO", "MANAGER", "STAFF", "FINANCE", "HR"];

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function loadStaffMap(db) {
  const snap = await db.ref("staff").once("value");
  return snap.exists() ? snap.val() : {};
}

// พนักงานที่ลาออก/ถูกเลิกจ้าง — แถวยังอยู่ ไม่ได้ถูกลบ (ดู adminStaffDelete)
//
// ใช้ฟิลด์แยกแทนการเพิ่มค่าที่สามใน `status` โดยตั้งใจ: "ยังทำงานอยู่ไหม" กับ
// "ยังเป็นพนักงานอยู่ไหม" เป็นคนละแกน และคนอ่าน status ทุกตัวในระบบ
// (lookupStaffByAuth, requireCeoCaller, useStaffSession, UserRole/StaffStatus
// ใน src/types/domain.ts) รู้จักแค่ ACTIVE/INACTIVE — เพิ่มค่าที่สามแปลว่า
// ต้องไล่แก้ทุกตัวพร้อมกัน. รูปแบบเดียวกับ `removed_at` ของแถวตะกร้าใน
// bkk-frontend-next ซึ่งเลือกด้วยเหตุผลเดียวกันเป๊ะ
const isTerminated = (s) => Boolean(s && s.terminated_at);

// ประวัติการเปลี่ยนสิทธิ์ของพนักงาน — มิเรอร์ของ recordTransition ใน
// rider-accounts.js ทั้งรูปฟิลด์และเหตุผลที่มี
//
// ก่อนหน้านี้ไรเดอร์มีประวัติแต่พนักงานไม่มีเลย ซึ่งกลับด้าน: พนักงานคือฝั่ง
// ที่มีอำนาจมากกว่า และ adminStaffDelete เคยลบแถวทิ้งจริง จึงไม่เหลือแม้แต่
// ร่องรอยว่าเคยมีคนนี้อยู่. backfill ย้อนหลังไม่ได้ — "ใครปลดใครเมื่อไหร่"
// ไม่มีที่ไหนเก็บ จึงเขียนตั้งแต่วันแรกแม้ยังไม่มีหน้าไหนอ่าน
//
// เก็บตัวระบุตัวตนของผู้กดครบทุกแบบและตั้งชื่อให้ชัดว่าอันไหนคืออันไหน ตาม
// เหตุผลเดียวกับฝั่งไรเดอร์: ระบบนี้มีตัวแทนของคนคนเดียวกันหลายแบบปนกันอยู่
// (ชื่อที่แสดง / staff push id / Firebase uid) การเดาย้อนหลังว่าฟิลด์ไหนเป็น
// แบบไหนคือสิ่งที่ทำให้ข้อมูลเก่า join ไม่ได้
//
// read rule ของ `staff_status_events` อยู่ที่ bkk-frontend-next/
// database.rules.json (admin อ่าน, client เขียนไม่ได้) — Admin SDK bypass
// rules จึงเขียนได้แม้ยังไม่ deploy rules แต่จะยังไม่มีใครอ่านได้จนกว่าจะ deploy
async function recordStaffEvent(db, event) {
  try {
    await db.ref("staff_status_events").push(event);
  } catch (e) {
    // best-effort เหมือนฝั่งไรเดอร์: สิทธิ์ถูกเปลี่ยนไปแล้วจริง การโยน error
    // ตรงนี้จะทำให้ CEO เข้าใจว่าไม่สำเร็จแล้วกดซ้ำ ซึ่งแย่กว่าประวัติขาดแถว
    console.error("[staff-accounts] transition log failed:", e && e.message ? e.message : e);
  }
}

// ผู้กด — รูปเดียวกับ by_* ของ rider_status_events
function actorFields(callerStaffId, staffMap, auth) {
  const caller = (staffMap && staffMap[callerStaffId]) || {};
  return {
    by_staff_id: callerStaffId || null,
    by_uid: (auth && auth.uid) || null,
    by_name: caller.name || caller.email || null,
    by_role: String(caller.role || "").toUpperCase() || null,
  };
}

// หา staff record ที่ ACTIVE ของ caller — จับคู่ด้วยอีเมลใน verified token
// (แหล่งเดียวที่ client ปลอมไม่ได้ เพราะ staff/{key} เป็น push id ไม่ใช่ uid)
// ไม่เชื่อ role ที่ client ส่งมาเด็ดขาด
//
// แถวที่ปิดบัญชีไปแล้วไม่มีทางแมตช์: adminStaffDelete ย้ายอีเมลไป
// email_at_termination แล้วเซ็ต email = null
async function findActiveStaffByAuth(db, auth) {
  if (!auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const email = normEmail(auth.token && auth.token.email);
  if (!email) throw new HttpsError("permission-denied", "บัญชีที่ login ไม่มีอีเมล");
  const staffMap = await loadStaffMap(db);
  for (const [id, s] of Object.entries(staffMap)) {
    if (!s) continue;
    const status = String(s.status || "").toUpperCase();
    if (normEmail(s.email) === email && (status === "" || status === "ACTIVE")) {
      return {
        callerStaffId: id,
        caller: s,
        callerRole: String(s.role || "").toUpperCase(),
        staffMap,
      };
    }
  }
  throw new HttpsError("permission-denied", "ไม่พบข้อมูลพนักงานของบัญชีนี้");
}

// ตรวจว่า caller เป็น CEO ที่ ACTIVE จริง
async function requireCeoCaller(db, auth) {
  const found = await findActiveStaffByAuth(db, auth);
  if (found.callerRole !== "CEO") {
    throw new HttpsError("permission-denied", "เฉพาะ CEO เท่านั้นที่จัดการบัญชีพนักงานได้");
  }
  return { callerStaffId: found.callerStaffId, caller: found.caller, staffMap: found.staffMap };
}

// gate แบบระบุ role เอง — ไฟล์นี้เป็นบ้านของ gate ที่ใช้ร่วมกันหลายโมดูล
// (finance-claims.js ใช้ requireCeoCaller อยู่แล้วด้วยเหตุผลเดียวกัน: gate
// เดียวกันต้องมีสำเนาเดียว ไม่งั้นวันหนึ่งสองไฟล์จะนิยาม role ไม่ตรงกัน)
//
// หมายเหตุ: dealer-portal.js มี requireStaffRole ของตัวเองที่ทำสิ่งเดียวกัน —
// ควรพับมารวมที่นี่ตอนที่แตะไฟล์นั้นด้วยเหตุอื่นอยู่แล้ว ไม่ใช่ตอนนี้
// (เส้นทางประมูลปิดซองไม่ใช่ที่ที่ควรมี diff แถมติดมา)
async function requireStaffRole(db, auth, roles) {
  const found = await findActiveStaffByAuth(db, auth);
  if (!roles.includes(found.callerRole)) {
    throw new HttpsError("permission-denied", `เฉพาะ ${roles.join("/")} เท่านั้น`);
  }
  return found;
}

// ใช้ร่วมกับ finance-claims.js — gate เดียวกันต้องมีสำเนาเดียว ไม่งั้นวันหนึ่ง
// สองไฟล์จะนิยาม "CEO" ไม่ตรงกัน
exports.requireCeoCaller = requireCeoCaller;
// ใช้โดย hr.js (HR_ROLES = CEO/HR)
exports.requireStaffRole = requireStaffRole;

function countOtherActiveCeos(staffMap, excludeStaffId) {
  return Object.entries(staffMap).filter(([id, s]) => {
    if (!s || id === excludeStaffId) return false;
    return String(s.role || "").toUpperCase() === "CEO" &&
      String(s.status || "").toUpperCase() === "ACTIVE";
  }).length;
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpsError("invalid-argument", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
  }
  if (password.length > 128) {
    throw new HttpsError("invalid-argument", "รหัสผ่านยาวเกินไป");
  }
}

function sanitizeProfile(data) {
  const name = String(data.name || "").trim();
  const phone = String(data.phone || "").trim();
  const branch = String(data.branch || "Main Store").trim() || "Main Store";
  const role = String(data.role || "").toUpperCase();
  if (!name) throw new HttpsError("invalid-argument", "ต้องระบุชื่อพนักงาน");
  if (!VALID_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", `role ต้องเป็นหนึ่งใน: ${VALID_ROLES.join(", ")}`);
  }
  return { name, phone, branch, role };
}

async function findAuthUserByEmail(email) {
  try {
    return await getAuth().getUserByEmail(email);
  } catch (e) {
    if (e && e.code === "auth/user-not-found") return null;
    throw new HttpsError("internal", `ตรวจสอบบัญชี Auth ไม่สำเร็จ: ${e.message || e}`);
  }
}

// ---------------------------------------------------------------------------
// adminStaffCreate — สร้างพนักงาน + บัญชี login ในคำสั่งเดียว
// (หรือออกบัญชี login ให้ staff record เดิมที่ยังไม่มี ผ่าน staffId)
// ---------------------------------------------------------------------------
exports.adminStaffCreate = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { callerStaffId, staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const email = normEmail(data.email);
  if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "อีเมลไม่ถูกต้อง");
  assertPassword(data.password);
  const { name, phone, branch, role } = sanitizeProfile(data);

  const attachToId = data.staffId ? String(data.staffId) : null;
  if (attachToId && !staffMap[attachToId]) {
    throw new HttpsError("not-found", "ไม่พบพนักงานที่ต้องการออกบัญชีให้");
  }

  // อีเมลห้ามซ้ำกับ staff record อื่น
  for (const [id, s] of Object.entries(staffMap)) {
    if (id !== attachToId && s && normEmail(s.email) === email) {
      throw new HttpsError("already-exists", "อีเมลนี้ถูกใช้กับพนักงานคนอื่นแล้ว");
    }
  }

  // ถ้ามีบัญชี Auth อยู่แล้ว: ห้ามชนบัญชีไรเดอร์ (คนละระบบ) — ที่เหลือถือว่า
  // CEO ตั้งใจออกรหัสใหม่ให้บัญชีนั้น (เช่น บัญชีมาสเตอร์เดิม / บัญชีที่เคยสร้างค้างไว้)
  let authUser = await findAuthUserByEmail(email);
  if (authUser) {
    const riderSnap = await db.ref(`riders/${authUser.uid}`).once("value");
    if (riderSnap.exists()) {
      throw new HttpsError("already-exists", "อีเมลนี้เป็นบัญชีไรเดอร์ — ใช้กับพนักงานแอดมินไม่ได้");
    }
    await getAuth().updateUser(authUser.uid, {
      password: data.password,
      displayName: name,
      disabled: false,
    });
  } else {
    authUser = await getAuth().createUser({
      email,
      password: data.password,
      displayName: name,
    });
  }

  const record = {
    name, phone, email, role, branch,
    status: "ACTIVE",
    uid: authUser.uid,
    updated_at: Date.now(),
  };

  let staffId = attachToId;
  if (staffId) {
    await db.ref(`staff/${staffId}`).update(record);
  } else {
    const refNew = db.ref("staff").push();
    staffId = refNew.key;
    await refNew.set({ ...record, created_at: Date.now() });
  }

  await db.ref(`admins/${authUser.uid}`).set({
    role: "admin",
    staff_id: staffId,
    email,
  });

  await recordStaffEvent(db, {
    staff_id: staffId,
    action: attachToId ? "reissued" : "created",
    from: attachToId
      ? { status: String((staffMap[attachToId] || {}).status || ""), role: String((staffMap[attachToId] || {}).role || "").toUpperCase() }
      : null,
    to: { status: "ACTIVE", role },
    reason: null,
    at: Date.now(),
    ...actorFields(callerStaffId, staffMap, request.auth),
  });

  console.log(`[staff-accounts] created/linked account ${email} (uid ${authUser.uid}) staff ${staffId} role ${role}`);
  return { ok: true, staffId, uid: authUser.uid };
});

// ---------------------------------------------------------------------------
// adminStaffUpdate — แก้โปรไฟล์/role/อีเมล (ไม่แตะสถานะ — ใช้ adminStaffSetStatus)
// ---------------------------------------------------------------------------
exports.adminStaffUpdate = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { callerStaffId, staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const existing = staffMap[staffId];
  if (!existing) throw new HttpsError("not-found", "ไม่พบพนักงาน");
  // แถวที่ปิดบัญชีไปแล้วเป็นบันทึกทางประวัติศาสตร์ ไม่ใช่พนักงานที่แก้ไขได้ —
  // ปล่อยให้แก้ = เขียนทับ role/อีเมลของคนที่ออกไปแล้ว แล้วประวัติที่ชี้มาที่
  // แถวนี้จะเล่าเรื่องผิด และเป็นทางอ้อมกลับมาเป็นพนักงานโดยไม่ผ่านการออกบัญชี
  if (isTerminated(existing)) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ปิดบัญชีไปแล้ว — ถ้ากลับมาทำงานให้ออกบัญชีใหม่");
  }

  const email = normEmail(data.email !== undefined ? data.email : existing.email);
  if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "อีเมลไม่ถูกต้อง");
  const { name, phone, branch, role } = sanitizeProfile({ ...existing, ...data });

  for (const [id, s] of Object.entries(staffMap)) {
    if (id !== staffId && s && normEmail(s.email) === email) {
      throw new HttpsError("already-exists", "อีเมลนี้ถูกใช้กับพนักงานคนอื่นแล้ว");
    }
  }

  // กันลด role ของ CEO ที่ ACTIVE คนสุดท้าย
  const wasActiveCeo = String(existing.role || "").toUpperCase() === "CEO" &&
    String(existing.status || "").toUpperCase() === "ACTIVE";
  if (wasActiveCeo && role !== "CEO" && countOtherActiveCeos(staffMap, staffId) === 0) {
    throw new HttpsError("failed-precondition", "ต้องมี CEO ที่ Active อย่างน้อย 1 คนเสมอ — ตั้ง CEO คนใหม่ก่อน");
  }

  // อีเมลเปลี่ยน → sync ไปที่บัญชี Auth ด้วย (identity ผูกกันด้วยอีเมล)
  if (existing.uid && email !== normEmail(existing.email)) {
    await getAuth().updateUser(existing.uid, { email, displayName: name });
    await db.ref(`admins/${existing.uid}/email`).set(email);
  } else if (existing.uid && name !== existing.name) {
    await getAuth().updateUser(existing.uid, { displayName: name });
  }

  const at = Date.now();
  await db.ref(`staff/${staffId}`).update({
    name, phone, email, role, branch, updated_at: at,
  });

  // บันทึกเฉพาะการเปลี่ยน role — นั่นคือการเปลี่ยน "สิทธิ์" ส่วนชื่อ/เบอร์/สาขา
  // เป็นข้อมูลโปรไฟล์ที่ไม่ได้เปลี่ยนว่าใครทำอะไรได้ ถ้าเก็บทุกการแก้ ประวัติ
  // สิทธิ์จะจมอยู่ใต้การแก้คำสะกดชื่อ
  const prevRole = String(existing.role || "").toUpperCase();
  if (prevRole !== role) {
    await recordStaffEvent(db, {
      staff_id: staffId,
      action: "role_changed",
      from: { status: String(existing.status || ""), role: prevRole },
      to: { status: String(existing.status || ""), role },
      reason: null,
      at,
      ...actorFields(callerStaffId, staffMap, request.auth),
    });
  }

  console.log(`[staff-accounts] updated staff ${staffId} (${email}) role ${role}`);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// adminStaffSetStatus — พักงาน / คืนสถานะ
// ---------------------------------------------------------------------------
exports.adminStaffSetStatus = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { callerStaffId, staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const status = String(data.status || "").toUpperCase();
  const existing = staffMap[staffId];
  if (!existing) throw new HttpsError("not-found", "ไม่พบพนักงาน");
  if (!["ACTIVE", "INACTIVE"].includes(status)) {
    throw new HttpsError("invalid-argument", "status ต้องเป็น ACTIVE หรือ INACTIVE");
  }
  // ปิดบัญชีแล้วคืนสถานะไม่ได้ — บัญชี Auth ถูกลบไปแล้ว การปล่อยผ่านจะไป
  // เรียก updateUser บน uid ที่ไม่มีอยู่แล้วพังกลางทาง หลังจากเขียน /admins
  // กลับไปแล้ว = คนที่ออกไปแล้วได้สิทธิ์ admin คืนโดยที่ login ไม่ได้
  if (isTerminated(existing)) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ปิดบัญชีไปแล้ว — ถ้ากลับมาทำงานให้ออกบัญชีใหม่");
  }

  if (status === "INACTIVE") {
    if (staffId === callerStaffId) {
      throw new HttpsError("failed-precondition", "พักงานบัญชีตัวเองไม่ได้");
    }
    const wasActiveCeo = String(existing.role || "").toUpperCase() === "CEO" &&
      String(existing.status || "").toUpperCase() === "ACTIVE";
    if (wasActiveCeo && countOtherActiveCeos(staffMap, staffId) === 0) {
      throw new HttpsError("failed-precondition", "ต้องมี CEO ที่ Active อย่างน้อย 1 คนเสมอ");
    }
    if (existing.uid) {
      await getAuth().updateUser(existing.uid, { disabled: true });
      await getAuth().revokeRefreshTokens(existing.uid);
      await db.ref(`admins/${existing.uid}`).remove();
    }
    const at = Date.now();
    await db.ref(`staff/${staffId}`).update({
      status: "INACTIVE",
      suspended_at: at,
      updated_at: at,
    });
    await recordStaffEvent(db, {
      staff_id: staffId,
      action: "suspended",
      from: { status: String(existing.status || ""), role: String(existing.role || "").toUpperCase() },
      to: { status: "INACTIVE", role: String(existing.role || "").toUpperCase() },
      reason: data.reason == null ? null : String(data.reason).trim() || null,
      at,
      ...actorFields(callerStaffId, staffMap, request.auth),
    });
    console.log(`[staff-accounts] suspended staff ${staffId} (${existing.email || "no-email"})`);
  } else {
    if (existing.uid) {
      await getAuth().updateUser(existing.uid, { disabled: false });
      await db.ref(`admins/${existing.uid}`).set({
        role: "admin",
        staff_id: staffId,
        email: normEmail(existing.email),
      });
    }
    const at = Date.now();
    await db.ref(`staff/${staffId}`).update({
      status: "ACTIVE",
      suspended_at: null,
      updated_at: at,
    });
    await recordStaffEvent(db, {
      staff_id: staffId,
      action: "reactivated",
      from: { status: String(existing.status || ""), role: String(existing.role || "").toUpperCase() },
      to: { status: "ACTIVE", role: String(existing.role || "").toUpperCase() },
      reason: data.reason == null ? null : String(data.reason).trim() || null,
      at,
      ...actorFields(callerStaffId, staffMap, request.auth),
    });
    console.log(`[staff-accounts] reactivated staff ${staffId} (${existing.email || "no-email"})`);
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// adminStaffDelete — ลบพนักงาน + บัญชี Auth + สิทธิ์ + FCM tokens
// ---------------------------------------------------------------------------
exports.adminStaffDelete = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { callerStaffId, staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const existing = staffMap[staffId];
  if (!existing) throw new HttpsError("not-found", "ไม่พบพนักงาน");
  if (staffId === callerStaffId) {
    throw new HttpsError("failed-precondition", "ลบบัญชีตัวเองไม่ได้");
  }
  const wasActiveCeo = String(existing.role || "").toUpperCase() === "CEO" &&
    String(existing.status || "").toUpperCase() === "ACTIVE";
  if (wasActiveCeo && countOtherActiveCeos(staffMap, staffId) === 0) {
    throw new HttpsError("failed-precondition", "ต้องมี CEO ที่ Active อย่างน้อย 1 คนเสมอ");
  }

  if (isTerminated(existing)) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ถูกปิดบัญชีไปแล้ว");
  }

  // การเข้าถึงถูกถอนจนหมดเหมือนเดิมทุกอย่าง — /admins, บัญชี Auth, FCM token
  let authAccountFound = false;
  if (existing.uid) {
    await db.ref(`admins/${existing.uid}`).remove();
    try {
      await getAuth().deleteUser(existing.uid);
      authAccountFound = true;
    } catch (e) {
      if (!e || e.code !== "auth/user-not-found") throw e;
    }
  }
  await db.ref(`admin_fcm_tokens/${staffId}`).remove();

  // ...แต่แถวใน /staff อยู่ต่อ
  //
  // ก่อนหน้านี้บรรทัดนี้คือ `.remove()` ซึ่งลบตัวตนของคนคนหนึ่งทิ้งทั้งใบ
  // ทั้งที่ id ของเขาถูกประทับไว้บนงานที่เขาเคยแตะ (qc_logs, adjustments
  // by_uid/by_name, rider_status_events.by_staff_id) — ทุกอ้างอิงเหล่านั้น
  // กลายเป็นคีย์ที่ไม่มีอยู่ทันทีที่กดปุ่ม และ status_history ของ status
  // machine v2 จะทำให้ปัญหานี้โตขึ้นตามจำนวน transition ไม่ใช่ตามจำนวนคน
  //
  // อีเมลถูกย้ายไป email_at_termination ไม่ใช่เก็บไว้ที่เดิม เพราะ
  // adminStaffCreate กันอีเมลซ้ำกับ "ทุก" แถวใน /staff — ถ้าปล่อยไว้ที่เดิม
  // จะออกบัญชีให้คนเดิมที่กลับมาทำงาน (หรือใช้อีเมลกลางซ้ำ) ไม่ได้อีกเลย
  const terminatedAt = Date.now();
  await db.ref(`staff/${staffId}`).update({
    status: "INACTIVE",
    terminated_at: terminatedAt,
    email: null,
    email_at_termination: existing.email || null,
    updated_at: terminatedAt,
  });

  await recordStaffEvent(db, {
    staff_id: staffId,
    action: "terminated",
    from: { status: String(existing.status || ""), role: String(existing.role || "").toUpperCase() },
    to: { status: "INACTIVE", role: String(existing.role || "").toUpperCase() },
    reason: null,
    at: terminatedAt,
    ...actorFields(callerStaffId, staffMap, request.auth),
    auth_account_found: authAccountFound,
  });

  console.log(`[staff-accounts] terminated staff ${staffId} (${existing.email || "no-email"})`);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// adminStaffResetPassword — CEO ออกรหัสผ่านใหม่ให้พนักงาน
// ---------------------------------------------------------------------------
exports.adminStaffResetPassword = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { callerStaffId, staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const existing = staffMap[staffId];
  if (!existing) throw new HttpsError("not-found", "ไม่พบพนักงาน");
  if (isTerminated(existing)) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ปิดบัญชีไปแล้ว");
  }
  if (!existing.uid) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ยังไม่มีบัญชี login — ใช้ปุ่มออกบัญชีแทน");
  }
  assertPassword(data.password);

  await getAuth().updateUser(existing.uid, { password: data.password });
  await getAuth().revokeRefreshTokens(existing.uid);

  // ไม่มี from/to เพราะไม่ได้เปลี่ยนสถานะหรือ role — แต่เป็นการเข้าถึงบัญชีของ
  // คนอื่น ซึ่งเป็นเหตุการณ์ที่ต้องตอบได้ว่าใครทำเมื่อไหร่ (รหัสผ่านใหม่อยู่ใน
  // มือคนกด ไม่ใช่เจ้าของบัญชี จนกว่าจะส่งต่อ)
  await recordStaffEvent(db, {
    staff_id: staffId,
    action: "password_reset",
    from: null,
    to: null,
    reason: null,
    at: Date.now(),
    ...actorFields(callerStaffId, staffMap, request.auth),
  });

  console.log(`[staff-accounts] password reset for staff ${staffId} (${existing.email || "no-email"})`);
  return { ok: true };
});
