// =============================================================================
// HR core — กติกาล้วนของทะเบียนพนักงาน (ไม่มี Firebase ไม่มี I/O)
//
// แยกออกจาก hr.js ด้วยเหตุผลเดียวกับ actor.js และ couponEngine.ts: สิ่งที่
// ตัดสิน "อะไรเข้าไปอยู่ในทะเบียนได้บ้าง" ต้องทดสอบได้โดยไม่ต้องมีฐานข้อมูล
// เพราะมันคือด่านของข้อมูลที่อ่อนไหวที่สุดในระบบ (เลขบัตรประชาชน เงินเดือน)
//
// สองกฎที่ไฟล์นี้ถือไว้และห้ามย้ายไปที่อื่น:
//
//   1. **allowlist ทั้งสองชั้น** — ฟิลด์ที่ client ส่งมาได้ถูกประกาศเป็นรายชื่อ
//      ไม่ใช่ "รับทุกอย่างแล้วลบที่ไม่ต้องการ". บทเรียนจาก public_track ที่พลาด
//      สองรอบเพราะดูแค่ชั้นเดียว: object ซ้อน (emergency_contact, bank, pay)
//      ต้องมี allowlist ของตัวเอง ไม่ใช่ก๊อปทั้งก้อน
//   2. **แยก public ออกจาก private ตั้งแต่ชั้นรับข้อมูล** — ไม่ใช่แค่ตอนอ่าน
//      เพราะฟิลด์ที่หลุดเข้า employees/ ครั้งเดียวจะอยู่ที่นั่นตลอดไป และ
//      หน้าแอดมินเดิมอ่าน employees/ ได้ (ชื่อ/ตำแหน่ง) แต่ต้องไม่เห็นเงินเดือน
// =============================================================================

const EMPLOYMENT_TYPES = ["monthly", "daily", "freelance"];
const EMPLOYEE_STATUSES = ["probation", "active", "resigned", "terminated"];

// สถานะที่แปลว่า "ไม่ได้ทำงานที่นี่แล้ว" — ใช้ตัดสินว่าบัญชีที่ยังเปิดอยู่
// เป็นความเสี่ยงหรือเป็นเรื่องปกติ
const EX_EMPLOYEE_STATUSES = ["resigned", "terminated"];

const EMPLOYEE_EVENT_ACTIONS = [
  "hired", "probation_passed", "promoted", "salary_changed", "transferred",
  "resigned", "terminated", "account_issued", "account_revoked",
  "linked", "unlinked", "profile_updated",
];

const str = (v) => String(v == null ? "" : v).trim();
const clip = (v, max) => str(v).slice(0, max);

// ── เลขบัตรประชาชน ──────────────────────────────────────────────────────────
// ตรวจ checksum จริง ไม่ใช่แค่นับหลัก — เลข 13 หลักที่พิมพ์ผิดหนึ่งตัวยังนับได้
// 13 หลักอยู่ดี แล้วมันจะไปโผล่บนหนังสือรับรองหัก ณ ที่จ่ายที่ยื่นสรรพากร
//
// ข้อจำกัดที่รู้ตัว: รองรับเฉพาะเลขบัตรไทย พนักงานต่างชาติ (พาสปอร์ต/work
// permit) ยังกรอกไม่ได้ — จดไว้ในเอกสารออกแบบข้อ 11 ไม่ใช่ปล่อยให้ค้นพบเอง
function isThaiNationalId(v) {
  const digits = str(v).replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

const normalizeNationalId = (v) => str(v).replace(/[\s-]/g, "");

// ── รหัสประจำตัวพนักงาน ─────────────────────────────────────────────────────
// EMP-2569-0007 — ปีพุทธศักราชตามเวลาไทย เหมือนเลขรันเอกสารตัวอื่นในระบบ
// (accounting_documents ใช้ period แบบเดียวกัน) ตัวนับแยกรายปีจึงรีเซ็ตเองโดย
// ไม่ต้องมีใครไปกด
function bangkokBuddhistYear(now) {
  const d = new Date(now + 7 * 60 * 60 * 1000);
  return d.getUTCFullYear() + 543;
}

function formatEmployeeCode(prefix, year, seq) {
  const p = str(prefix) || "EMP";
  return `${p}-${year}-${String(seq).padStart(4, "0")}`;
}

// ── allowlist: ข้อมูลที่ไม่อ่อนไหว (employees/{id}) ─────────────────────────
// ฟิลด์ที่ "ไม่อยู่ในนี้" ไม่ได้แปลว่าเก็บไม่ได้ แต่แปลว่า client ตั้งเองไม่ได้:
// employee_code / status / links / terminated_at เป็นของ server ทั้งหมด
// เพราะแต่ละตัวมีกติกาของตัวเอง (ตัวนับ, การเปลี่ยนสถานะต้องมีประวัติ,
// การผูกบัญชีต้องตรวจว่าไม่ถูกคนอื่นจองไว้)
function sanitizeEmployeePublic(input, { partial = false } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  const errors = [];

  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);

  if (!partial || has("name")) {
    const name = clip(src.name, 120);
    if (!name) errors.push("ต้องระบุชื่อ-สกุลพนักงาน");
    out.name = name;
  }
  for (const [key, max] of [["nickname", 60], ["position", 120], ["department", 120], ["branch", 120]]) {
    if (!partial || has(key)) out[key] = clip(src[key], max) || null;
  }
  if (!partial || has("photo_url")) {
    const url = clip(src.photo_url, 500);
    // ยอมเฉพาะ https — รูปโปรไฟล์ที่เป็น javascript:/data: คือ XSS ที่รอถูก render
    if (url && !/^https:\/\//i.test(url)) errors.push("ลิงก์รูปต้องเป็น https");
    out.photo_url = url || null;
  }
  if (!partial || has("employment_type")) {
    const t = str(src.employment_type).toLowerCase();
    if (!EMPLOYMENT_TYPES.includes(t)) {
      errors.push(`ประเภทการจ้างต้องเป็นหนึ่งใน: ${EMPLOYMENT_TYPES.join(", ")}`);
    }
    out.employment_type = t;
  }
  for (const key of ["hired_at", "probation_until"]) {
    if (!partial || has(key)) {
      const raw = src[key];
      if (raw == null || raw === "") { out[key] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) errors.push(`${key} ต้องเป็นเวลาที่ถูกต้อง`);
      else out[key] = Math.round(n);
    }
  }
  if ((!partial || has("hired_at")) && !partial && !out.hired_at) {
    errors.push("ต้องระบุวันเริ่มงาน");
  }
  return { value: out, errors };
}

// ── allowlist: ข้อมูลอ่อนไหว (employees_private/{id}) ───────────────────────
// object ซ้อนทุกตัวมี allowlist ของตัวเอง — การรับ `src.bank` ทั้งก้อนแปลว่า
// ใครก็ตามที่ยิง callable ได้เขียนอะไรก็ได้ลงใต้ชื่อที่เราคิดว่ารู้จัก
function sanitizeEmployeePrivate(input, { partial = false } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);

  if (!partial || has("national_id")) {
    const raw = str(src.national_id);
    if (!raw) out.national_id = null;
    else if (!isThaiNationalId(raw)) errors.push("เลขบัตรประชาชนไม่ถูกต้อง (13 หลักและต้องผ่านการตรวจเลขหลักสุดท้าย)");
    else out.national_id = normalizeNationalId(raw);
  }
  if (!partial || has("birth_date")) {
    const raw = src.birth_date;
    if (raw == null || raw === "") out.birth_date = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) errors.push("วันเกิดไม่ถูกต้อง");
      else out.birth_date = Math.round(n);
    }
  }
  for (const [key, max] of [
    ["address", 500], ["phone", 40], ["email", 200], ["line", 100],
    ["tax_id", 20], ["social_security_no", 20],
  ]) {
    if (!partial || has(key)) out[key] = clip(src[key], max) || null;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) {
    errors.push("อีเมลไม่ถูกต้อง");
  }

  if (!partial || has("emergency_contact")) {
    const c = src.emergency_contact && typeof src.emergency_contact === "object" ? src.emergency_contact : null;
    out.emergency_contact = c
      ? { name: clip(c.name, 120) || null, relation: clip(c.relation, 60) || null, phone: clip(c.phone, 40) || null }
      : null;
  }
  if (!partial || has("bank")) {
    const b = src.bank && typeof src.bank === "object" ? src.bank : null;
    out.bank = b
      ? { name: clip(b.name, 80) || null, account: clip(b.account, 40) || null, account_name: clip(b.account_name, 120) || null }
      : null;
  }
  if (!partial || has("pay")) {
    const p = src.pay && typeof src.pay === "object" ? src.pay : {};
    const money = (v, label) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { errors.push(`${label} ต้องเป็นจำนวนเงินที่ไม่ติดลบ`); return null; }
      return Math.round(n * 100) / 100;
    };
    const allowances = Array.isArray(p.allowances) ? p.allowances.slice(0, 20).map((a) => ({
      label: clip(a && a.label, 80) || null,
      amount: money(a && a.amount, "เบี้ยเลี้ยง") || 0,
      taxable: (a && a.taxable) !== false,
      recurring: (a && a.recurring) !== false,
    })).filter((a) => a.label) : [];
    out.pay = {
      base_salary: money(p.base_salary, "เงินเดือน"),
      daily_rate: money(p.daily_rate, "ค่าแรงรายวัน"),
      allowances,
    };
  }
  return { value: out, errors };
}

// ── สถานะการเข้าถึงระบบของพนักงานคนหนึ่ง ────────────────────────────────────
// ทะเบียนบอกว่า "พ้นสภาพแล้ว" ได้ แต่การปิดบัญชีจริงเป็นงานของ P3
// (adminHrTerminate) — ระหว่างนั้นหน้าเว็บต้องบอกความจริงว่าบัญชียังเปิดอยู่
// ไม่ใช่โชว์คำว่าพ้นสภาพแล้วปล่อยให้เข้าใจว่าปิดแล้ว **นี่คือความต่างระหว่าง
// ระบบที่บอกความจริงกับระบบที่ตอบผิดเงียบๆ**
function accessSummary(employee, staffMap, ridersMap) {
  const links = (employee && employee.links) || {};
  const staffId = links.staff_id || null;
  const riderId = links.rider_id || null;
  const staffRow = staffId ? (staffMap || {})[staffId] : null;
  const riderRow = riderId ? (ridersMap || {})[riderId] : null;

  const staff = staffRow
    ? {
        id: staffId,
        status: String(staffRow.status || "").toUpperCase() || "ACTIVE",
        terminated: Boolean(staffRow.terminated_at),
        role: String(staffRow.role || "").toUpperCase() || null,
      }
    : null;
  const rider = riderRow
    ? {
        id: riderId,
        approval_status: String(riderRow.approval_status || "").toLowerCase() || "approved",
      }
    : null;

  // "เปิดอยู่" = ยังเข้าระบบได้จริง ไม่ใช่ "ยังมีแถวอยู่"
  const staffOpen = Boolean(staff && !staff.terminated && staff.status === "ACTIVE");
  const riderOpen = Boolean(rider && rider.approval_status === "approved");
  const exEmployee = EX_EMPLOYEE_STATUSES.includes(String(employee && employee.status || "").toLowerCase());

  return {
    staff, rider,
    open: staffOpen || riderOpen,
    // ธงเดียวที่หน้าเว็บต้องทำอะไรกับมัน
    stale_access: exEmployee && (staffOpen || riderOpen),
  };
}

// ── บัญชีที่ยังไม่ถูกผูกเข้าทะเบียน ──────────────────────────────────────────
// P1 คือการ "ผูกของเดิมเข้าทะเบียน" ไม่ใช่การสร้างคนใหม่ทั้งหมด — หน้าเว็บ
// ต้องบอกได้ว่ายังเหลือใครที่มีบัญชีแต่ไม่มีแฟ้ม
function unlinkedAccounts(employees, staffMap, ridersMap) {
  const usedStaff = new Set();
  const usedRider = new Set();
  for (const e of Object.values(employees || {})) {
    const l = (e && e.links) || {};
    if (l.staff_id) usedStaff.add(l.staff_id);
    if (l.rider_id) usedRider.add(l.rider_id);
  }
  const staff = Object.entries(staffMap || {})
    .filter(([id, s]) => s && !usedStaff.has(id) && !s.terminated_at)
    .map(([id, s]) => ({
      id, kind: "staff",
      name: s.name || s.email || id,
      email: s.email || null,
      role: String(s.role || "").toUpperCase() || null,
      status: String(s.status || "").toUpperCase() || "ACTIVE",
    }));
  const riders = Object.entries(ridersMap || {})
    .filter(([id, r]) => r && !usedRider.has(id))
    .map(([id, r]) => ({
      id, kind: "rider",
      name: r.name || r.displayName || r.email || id,
      email: r.email || null,
      role: "RIDER",
      status: String(r.approval_status || "approved").toLowerCase(),
    }));
  return [...staff, ...riders];
}

// ── ผู้กระทำ — รูปเดียวกับ staff_status_events / rider_status_events ────────
// ฟิลด์ by_* ต้องเหมือนกันเป๊ะทั้งสามโหนด ไม่งั้นประวัติของคนกลุ่มเดียวกัน
// join ด้วย query shape เดียวไม่ได้ ซึ่งเป็นปัญหาที่ survey เจอมาแล้ว
function employeeActorFields(callerStaffId, staffMap, auth) {
  const caller = (staffMap && staffMap[callerStaffId]) || {};
  return {
    by_staff_id: callerStaffId || null,
    by_uid: (auth && auth.uid) || null,
    by_name: caller.name || caller.email || null,
    by_role: String(caller.role || "").toUpperCase() || null,
  };
}

module.exports = {
  EMPLOYMENT_TYPES,
  EMPLOYEE_STATUSES,
  EX_EMPLOYEE_STATUSES,
  EMPLOYEE_EVENT_ACTIONS,
  isThaiNationalId,
  normalizeNationalId,
  bangkokBuddhistYear,
  formatEmployeeCode,
  sanitizeEmployeePublic,
  sanitizeEmployeePrivate,
  accessSummary,
  unlinkedAccounts,
  employeeActorFields,
};
