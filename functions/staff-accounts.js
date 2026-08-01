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
// ชื่อ functions ต้อง unique ระดับ project ({region}/{name}) — prefix adminStaff*
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const REGION = "asia-southeast1";
const VALID_ROLES = ["CEO", "MANAGER", "STAFF", "FINANCE"];

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function loadStaffMap(db) {
  const snap = await db.ref("staff").once("value");
  return snap.exists() ? snap.val() : {};
}

// ตรวจว่า caller เป็น CEO ที่ ACTIVE จริง — จับคู่ด้วยอีเมลใน token (แหล่ง
// เดียวที่ client ปลอมไม่ได้) ไม่เชื่อ role ที่ client ส่งมาเด็ดขาด
async function requireCeoCaller(db, auth) {
  if (!auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const email = normEmail(auth.token && auth.token.email);
  if (!email) throw new HttpsError("permission-denied", "บัญชีที่ login ไม่มีอีเมล");
  const staffMap = await loadStaffMap(db);
  for (const [id, s] of Object.entries(staffMap)) {
    if (!s) continue;
    const status = String(s.status || "").toUpperCase();
    if (normEmail(s.email) === email && (status === "" || status === "ACTIVE")) {
      if (String(s.role || "").toUpperCase() !== "CEO") {
        throw new HttpsError("permission-denied", "เฉพาะ CEO เท่านั้นที่จัดการบัญชีพนักงานได้");
      }
      return { callerStaffId: id, caller: s, staffMap };
    }
  }
  throw new HttpsError("permission-denied", "ไม่พบข้อมูลพนักงานของบัญชีนี้");
}

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
  const { staffMap } = await requireCeoCaller(db, request.auth);
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

  console.log(`[staff-accounts] created/linked account ${email} (uid ${authUser.uid}) staff ${staffId} role ${role}`);
  return { ok: true, staffId, uid: authUser.uid };
});

// ---------------------------------------------------------------------------
// adminStaffUpdate — แก้โปรไฟล์/role/อีเมล (ไม่แตะสถานะ — ใช้ adminStaffSetStatus)
// ---------------------------------------------------------------------------
exports.adminStaffUpdate = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const existing = staffMap[staffId];
  if (!existing) throw new HttpsError("not-found", "ไม่พบพนักงาน");

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

  await db.ref(`staff/${staffId}`).update({
    name, phone, email, role, branch, updated_at: Date.now(),
  });

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
    await db.ref(`staff/${staffId}`).update({
      status: "INACTIVE",
      suspended_at: Date.now(),
      updated_at: Date.now(),
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
    await db.ref(`staff/${staffId}`).update({
      status: "ACTIVE",
      suspended_at: null,
      updated_at: Date.now(),
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

  if (existing.uid) {
    await db.ref(`admins/${existing.uid}`).remove();
    try {
      await getAuth().deleteUser(existing.uid);
    } catch (e) {
      if (!e || e.code !== "auth/user-not-found") throw e;
    }
  }
  await db.ref(`admin_fcm_tokens/${staffId}`).remove();
  await db.ref(`staff/${staffId}`).remove();

  console.log(`[staff-accounts] deleted staff ${staffId} (${existing.email || "no-email"})`);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// adminStaffResetPassword — CEO ออกรหัสผ่านใหม่ให้พนักงาน
// ---------------------------------------------------------------------------
exports.adminStaffResetPassword = onCall({ region: REGION }, async (request) => {
  const db = getDatabase();
  const { staffMap } = await requireCeoCaller(db, request.auth);
  const data = request.data || {};

  const staffId = String(data.staffId || "");
  const existing = staffMap[staffId];
  if (!existing) throw new HttpsError("not-found", "ไม่พบพนักงาน");
  if (!existing.uid) {
    throw new HttpsError("failed-precondition", "พนักงานคนนี้ยังไม่มีบัญชี login — ใช้ปุ่มออกบัญชีแทน");
  }
  assertPassword(data.password);

  await getAuth().updateUser(existing.uid, { password: data.password });
  await getAuth().revokeRefreshTokens(existing.uid);

  console.log(`[staff-accounts] password reset for staff ${staffId} (${existing.email || "no-email"})`);
  return { ok: true };
});
