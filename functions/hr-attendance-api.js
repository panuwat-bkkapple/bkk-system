// =============================================================================
// ลงเวลาเข้า-ออกงาน + ตารางเวร — callable (กติกาอยู่ hr-attendance.js)
//
// **การตัดสินทั้งหมดอยู่ฝั่ง server** — แอปพนักงานส่งมาแค่พิกัด ส่วนคำตอบว่า
// อยู่ในรัศมีไหม สายกี่นาที ผูกกับกะไหน เป็นของที่นี่ ถ้าให้แอปตัดสิน คนที่
// เรียก callable ตรงๆ ก็ลงเวลาจากที่ไหนก็ได้
//
// **เวลาที่บันทึกคือเวลาของ server เสมอ ไม่ใช่เวลาที่แอปส่งมา** — นาฬิกาเครื่อง
// ตั้งเองได้ และมันคือช่องที่ง่ายที่สุดในการย้อนเวลาเข้างาน
//
// **โหนดใหม่ทั้งสองตัวไม่มี rule ของตัวเอง** (`attendance`, `shift_roster`) จึง
// ตกกฎ root `.read/.write: false` → Admin SDK เขียนได้ ลูกค้า/พนักงานอ่านตรงไม่ได้
// ต้องผ่าน callable เท่านั้น **ไม่ต้อง deploy rules** (ไฟล์กฎอยู่อีกรีโป)
// และเก็บซ้อนใต้ `{employeeId}/{YYYY-MM-DD}` จึงอ่านของคนเดียวได้โดยไม่ต้องมี
// `.indexOn` (หลักเดียวกับ `audit_log` และ `leave_requests`)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, employeeActorFields } = require("./hr-core");
const { requireEmployeeCaller } = require("./hr-employee-auth");
const A = require("./hr-attendance");

const REGION = "asia-southeast1";
const str = (v, max = 80) => String(v == null ? "" : v).trim().slice(0, max);
const nowMs = () => Date.now();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** เพดานของหน้าประวัติ — ชนแล้วต้องบอก ไม่ตัดเงียบ */
const MAX_DAYS = 62;
const MAX_EMPLOYEES = 200;

async function loadContext(db, employeeId) {
  const [hrSnap, branchSnap, rosterSnap] = await Promise.all([
    db.ref("settings/hr").once("value"),
    db.ref("settings/branches").once("value"),
    db.ref(`shift_roster/${employeeId}`).once("value"),
  ]);
  const hr = hrSnap.exists() ? hrSnap.val() : {};
  const { shifts, dropped } = A.normalizeShifts(hr.shifts);
  return {
    shifts,
    dropped,
    settings: A.normalizeAttendanceSettings(hr.attendance),
    branches: branchSnap.exists() ? branchSnap.val() : {},
    roster: rosterSnap.exists() ? rosterSnap.val() : {},
  };
}

/** รูปที่แอปพนักงานเห็น — ไม่มีอะไรของคนอื่นอยู่ในนั้น */
function publicDay(iso, row) {
  const r = row && typeof row === "object" ? row : {};
  return {
    date: iso,
    shift_id: r.shift_id || null,
    shift_label: r.shift_label || null,
    in_at: A.realNumber(r.in_at),
    in_site_name: r.in_site_name || null,
    in_distance_m: A.realNumber(r.in_distance_m),
    late_min: A.realNumber(r.late_min),
    within_grace: typeof r.within_grace === "boolean" ? r.within_grace : null,
    out_at: A.realNumber(r.out_at),
    out_site_name: r.out_site_name || null,
    out_outside: typeof r.out_outside === "boolean" ? r.out_outside : null,
    worked_min: A.realNumber(r.worked_min),
    early_min: A.realNumber(r.early_min),
    no_shift: r.no_shift === true,
    status: A.realNumber(r.out_at) !== null ? "closed" : (A.realNumber(r.in_at) !== null ? "open" : "empty"),
  };
}

function registerHrAttendance() {
  // -------------------------------------------------------------------------
  // employeeAttendanceStatus — "วันนี้ฉันต้องทำอะไร และทำไปแล้วแค่ไหน"
  //
  // ส่งพิกัดสาขาไปด้วยโดยตั้งใจ เพื่อให้แอปบอกระยะห่างได้ก่อนกดปุ่ม — ปุ่มที่
  // กดแล้วค่อยรู้ว่าไกลไป คือปุ่มที่คนกดซ้ำๆ ตอนยืนอยู่หน้าร้าน
  // (พิกัดสาขาไม่ใช่ความลับ มันคือที่อยู่ร้านที่ลูกค้าเดินเข้ามาได้)
  // -------------------------------------------------------------------------
  const employeeAttendanceStatus = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const ctx = await loadContext(db, employeeId);
    const now = nowMs();
    const day = A.attendanceDayFor({ now, shifts: ctx.shifts, roster: ctx.roster, employee });

    const todayIso = A.bangkokIso(now);
    const isoList = [...new Set([day.iso, todayIso, A.shiftIso(todayIso, -1)])].filter(Boolean);
    const snaps = await Promise.all(
      isoList.map((iso) => db.ref(`attendance/${employeeId}/${iso}`).once("value")),
    );
    const days = {};
    isoList.forEach((iso, i) => { days[iso] = snaps[i].exists() ? snaps[i].val() : null; });

    // แถวที่ยังเปิดค้าง (กะดึกที่ยังไม่ปิด) สำคัญกว่าแถวของวันนี้
    const openIso = isoList.find((iso) => days[iso] && days[iso].in_at && !days[iso].out_at) || null;
    const activeIso = openIso || day.iso;

    return {
      employee: {
        id: employeeId,
        name: employee.name || null,
        employee_code: employee.employee_code || null,
        position: employee.position || null,
        photo_url: employee.photo_url || null,
      },
      today: A.bangkokIso(now),
      server_now: now,
      shift: day.shift
        ? { id: day.shift.id, label: day.shift.label, start: day.shift.start, end: day.shift.end,
            grace_min: day.shift.grace_min, break_min: day.shift.break_min,
            crosses_midnight: day.shift.crosses_midnight }
        : null,
      shift_source: day.source,
      attendance_date: activeIso,
      record: publicDay(activeIso, days[activeIso]),
      sites: A.attendanceSites(ctx.branches).map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
      radius_m: ctx.settings.radius_m,
      min_accuracy_m: ctx.settings.min_accuracy_m,
    };
  });

  // -------------------------------------------------------------------------
  // employeeAttendanceCheckIn / CheckOut
  //
  // ใช้ transaction บนโหนดของวันนั้น — กดสองครั้งพร้อมกัน (เน็ตกระตุก แล้วกดซ้ำ)
  // ต้องได้แถวเดียว ไม่ใช่แถวที่เวลาเข้างานถูกเขียนทับด้วยครั้งที่สอง
  // -------------------------------------------------------------------------
  const employeeAttendanceCheckIn = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const ctx = await loadContext(db, employeeId);
    const now = nowMs();
    const day = A.attendanceDayFor({ now, shifts: ctx.shifts, roster: ctx.roster, employee });

    const ref = db.ref(`attendance/${employeeId}/${day.iso}`);
    const existing = (await ref.once("value")).val();

    const d = request.data || {};
    const verdict = A.checkInVerdict({
      now,
      coords: { lat: d.lat, lng: d.lng, accuracy_m: d.accuracy_m },
      sites: ctx.branches,
      settings: ctx.settings,
      existing,
      day,
    });
    if (!verdict.ok) {
      return { ok: false, code: verdict.code, message: verdict.message,
        distance_m: verdict.distance_m ?? null, radius_m: verdict.radius_m ?? null };
    }

    const row = {
      employee_id: employeeId,
      date: day.iso,
      shift_id: verdict.shift ? verdict.shift.id : null,
      shift_label: verdict.shift ? verdict.shift.label : null,
      shift_source: verdict.shift_source,
      no_shift: verdict.no_shift,
      in_at: now,
      in_lat: A.realNumber(d.lat),
      in_lng: A.realNumber(d.lng),
      in_accuracy_m: verdict.accuracy_m,
      in_site_id: verdict.site.id,
      in_site_name: verdict.site.name,
      in_distance_m: verdict.distance_m,
      late_min: verdict.late_min,
      within_grace: verdict.within_grace,
      created_at: now,
    };

    const res = await ref.transaction((cur) => {
      // มีแถวที่เข้างานแล้ว = ปล่อยไว้เหมือนเดิม (คนกดซ้ำไม่ควรเขียนทับเวลาแรก)
      if (cur && cur.in_at) return cur;
      return { ...(cur || {}), ...row };
    });
    const saved = res.snapshot.val() || {};
    if (A.realNumber(saved.in_at) !== now) {
      return { ok: false, code: "already_in", message: "ลงเวลาเข้างานของกะนี้ไปแล้ว",
        record: publicDay(day.iso, saved) };
    }
    console.log(`[hr-attendance] ${employeeId} in ${day.iso} site=${verdict.site.id} d=${verdict.distance_m}m late=${verdict.late_min}`);
    return { ok: true, record: publicDay(day.iso, saved) };
  });

  const employeeAttendanceCheckOut = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const ctx = await loadContext(db, employeeId);
    const now = nowMs();

    // หาแถวที่เปิดค้าง — วันนี้ก่อน แล้วเมื่อวาน (กะดึก)
    const todayIso = A.bangkokIso(now);
    const candidates = [todayIso, A.shiftIso(todayIso, -1)];
    let iso = null;
    let existing = null;
    for (const c of candidates) {
      const v = (await db.ref(`attendance/${employeeId}/${c}`).once("value")).val();
      if (v && v.in_at && !v.out_at) { iso = c; existing = v; break; }
      if (!existing && v && v.in_at) { iso = c; existing = v; }
    }
    if (!iso) {
      return { ok: false, code: "not_in", message: "ยังไม่ได้ลงเวลาเข้างาน" };
    }

    const shift = A.shiftById(ctx.shifts, existing.shift_id);
    const win = shift ? A.shiftWindow(shift, iso) : null;
    const d = request.data || {};
    const verdict = A.checkOutVerdict({
      now,
      coords: { lat: d.lat, lng: d.lng, accuracy_m: d.accuracy_m },
      sites: ctx.branches,
      settings: ctx.settings,
      existing,
      shift,
      window: win,
    });
    if (!verdict.ok) {
      return { ok: false, code: verdict.code, message: verdict.message };
    }

    const patch = {
      out_at: now,
      out_lat: A.realNumber(d.lat),
      out_lng: A.realNumber(d.lng),
      out_accuracy_m: verdict.accuracy_m,
      out_site_id: verdict.site ? verdict.site.id : null,
      out_site_name: verdict.site ? verdict.site.name : null,
      out_distance_m: verdict.distance_m,
      out_outside: verdict.outside,
      gross_min: verdict.gross_min,
      break_min: verdict.break_min,
      worked_min: verdict.worked_min,
      early_min: verdict.early_min,
      updated_at: now,
    };
    const res = await db.ref(`attendance/${employeeId}/${iso}`).transaction((cur) => {
      if (!cur || !cur.in_at) return cur;
      if (cur.out_at) return cur;
      return { ...cur, ...patch };
    });
    const saved = res.snapshot.val() || {};
    if (A.realNumber(saved.out_at) !== now) {
      return { ok: false, code: "already_out", message: "ลงเวลาออกงานไปแล้ว",
        record: publicDay(iso, saved) };
    }
    console.log(`[hr-attendance] ${employeeId} out ${iso} worked=${verdict.worked_min}m early=${verdict.early_min}`);
    return { ok: true, record: publicDay(iso, saved) };
  });

  // -------------------------------------------------------------------------
  // employeeAttendanceHistory — ของตัวเองเท่านั้น
  // -------------------------------------------------------------------------
  const employeeAttendanceHistory = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const to = DATE_RE.test(str(d.to, 10)) ? str(d.to, 10) : A.bangkokIso(nowMs());
    const from = DATE_RE.test(str(d.from, 10)) ? str(d.from, 10) : A.shiftIso(to, -30);
    const snap = await db.ref(`attendance/${employeeId}`)
      .orderByKey().startAt(from).endAt(to).once("value");
    const rows = [];
    snap.forEach((c) => { rows.push(publicDay(c.key, c.val())); return false; });
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { from, to, rows: rows.slice(0, MAX_DAYS), capped: rows.length > MAX_DAYS };
  });

  // -------------------------------------------------------------------------
  // adminHrAttendanceList — ฝ่ายบุคคลดูของทุกคนในช่วงวัน
  //
  // อ่าน subtree ต่อคน **ไม่กวาดโหนด `attendance` ทั้งก้อน** (กฎค่า RTDB)
  // -------------------------------------------------------------------------
  const adminHrAttendanceList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const d = request.data || {};
    const to = DATE_RE.test(str(d.to, 10)) ? str(d.to, 10) : A.bangkokIso(nowMs());
    const from = DATE_RE.test(str(d.from, 10)) ? str(d.from, 10) : to;
    if (from > to) throw new HttpsError("invalid-argument", "ช่วงวันที่ไม่ถูกต้อง");

    const one = str(d.employeeId, 80);
    const empSnap = await db.ref("employees").once("value");
    const employees = empSnap.exists() ? empSnap.val() : {};
    const ids = one ? [one] : Object.keys(employees);
    const capped = ids.length > MAX_EMPLOYEES;

    const rows = [];
    await Promise.all(ids.slice(0, MAX_EMPLOYEES).map(async (id) => {
      const snap = await db.ref(`attendance/${id}`).orderByKey().startAt(from).endAt(to).once("value");
      snap.forEach((c) => {
        rows.push({ employee_id: id, ...publicDay(c.key, c.val()) });
        return false;
      });
    }));
    rows.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

    const names = {};
    for (const [id, v] of Object.entries(employees)) {
      const e = v && typeof v === "object" ? v : {};
      names[id] = { name: e.name || null, employee_code: e.employee_code || null };
    }
    return { from, to, rows, names, capped, employees_scanned: Math.min(ids.length, MAX_EMPLOYEES) };
  });

  // -------------------------------------------------------------------------
  // adminHrRosterGet / adminHrRosterSet — ตารางเวร
  //
  // `dates` เป็น map `{ "YYYY-MM-DD": shiftId | null }` — `null` = ลบเวรวันนั้น
  // (กลับไปใช้กะประจำตัว) ซึ่งต่างจาก "ไม่ส่งวันนั้นมา" ที่แปลว่าไม่แตะ
  // -------------------------------------------------------------------------
  const adminHrRosterGet = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const d = request.data || {};
    const to = DATE_RE.test(str(d.to, 10)) ? str(d.to, 10) : A.bangkokIso(nowMs());
    const from = DATE_RE.test(str(d.from, 10)) ? str(d.from, 10) : to;

    const [hrSnap, empSnap] = await Promise.all([
      db.ref("settings/hr").once("value"),
      db.ref("employees").once("value"),
    ]);
    const hr = hrSnap.exists() ? hrSnap.val() : {};
    const { shifts, dropped } = A.normalizeShifts(hr.shifts);
    const employees = empSnap.exists() ? empSnap.val() : {};
    const ids = Object.keys(employees).slice(0, MAX_EMPLOYEES);

    const roster = {};
    await Promise.all(ids.map(async (id) => {
      const snap = await db.ref(`shift_roster/${id}`).orderByKey().startAt(from).endAt(to).once("value");
      const days = {};
      snap.forEach((c) => {
        const v = c.val();
        days[c.key] = v && typeof v === "object" ? v.shift_id || null : v || null;
        return false;
      });
      roster[id] = days;
    }));

    return {
      from, to, roster,
      shifts: shifts.map((s) => ({ id: s.id, label: s.label, start: s.start, end: s.end,
        crosses_midnight: s.crosses_midnight, grace_min: s.grace_min, break_min: s.break_min })),
      dropped_shifts: dropped,
      employees: ids.map((id) => ({
        id,
        name: (employees[id] || {}).name || null,
        employee_code: (employees[id] || {}).employee_code || null,
        status: (employees[id] || {}).status || null,
        default_shift_id: (employees[id] || {}).default_shift_id || null,
      })),
      capped: Object.keys(employees).length > MAX_EMPLOYEES,
    };
  });

  const adminHrRosterSet = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const d = request.data || {};
    const employeeId = str(d.employeeId, 80);
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");
    const empSnap = await db.ref(`employees/${employeeId}`).once("value");
    if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");

    const hrSnap = await db.ref("settings/hr").once("value");
    const { shifts } = A.normalizeShifts((hrSnap.val() || {}).shifts);
    const dates = d.dates && typeof d.dates === "object" ? d.dates : {};

    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    const at = nowMs();
    const updates = {};
    let cleared = 0;
    let set = 0;
    for (const [iso, raw] of Object.entries(dates)) {
      const key = str(iso, 10);
      if (!DATE_RE.test(key)) throw new HttpsError("invalid-argument", `วันที่ไม่ถูกต้อง: ${key}`);
      const shiftId = str(raw, 40);
      if (!shiftId) { updates[key] = null; cleared += 1; continue; }
      // กะที่ไม่มีอยู่จริง = ปฏิเสธทั้งชุด ไม่ใช่เขียนแล้วให้ไปเจอตอนเช็คอิน
      if (!A.shiftById(shifts, shiftId)) {
        throw new HttpsError("invalid-argument", `ไม่รู้จักกะ: ${shiftId}`);
      }
      updates[key] = { shift_id: shiftId, at, by_name: actor.by_name || null, by_staff_id: actor.by_staff_id || null };
      set += 1;
    }
    if (!Object.keys(updates).length) return { ok: true, set: 0, cleared: 0 };
    await db.ref(`shift_roster/${employeeId}`).update(updates);
    return { ok: true, set, cleared };
  });

  return {
    employeeAttendanceStatus,
    employeeAttendanceCheckIn,
    employeeAttendanceCheckOut,
    employeeAttendanceHistory,
    adminHrAttendanceList,
    adminHrRosterGet,
    adminHrRosterSet,
  };
}

module.exports = { registerHrAttendance, MAX_DAYS, MAX_EMPLOYEES, publicDay };
