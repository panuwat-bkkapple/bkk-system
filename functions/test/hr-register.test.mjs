// ---------------------------------------------------------------------------
// ทะเบียนพนักงาน (P1) — ด่านของข้อมูลที่อ่อนไหวที่สุดในระบบ
//
//   node functions/test/hr-register.test.mjs
//
// ทำไมต้องมี: โหนด employees_private เก็บเลขบัตรประชาชนกับเงินเดือนของทุกคน
// ซึ่งเป็นข้อมูลที่ถ้าหลุดแล้วเรียกคืนไม่ได้ และเป็นชุดแรกในระบบนี้ที่เป็น PII
// ของ "พนักงาน" ไม่ใช่ของลูกค้า — บทเรียนจาก public_track (พลาดสองรอบเพราะดู
// แค่ชั้นเดียว) บอกว่า allowlist ต้องพิสูจน์ถึงใบสุดท้ายของทุกกิ่ง ไม่ใช่แค่
// ชื่อ key ระดับบนสุด
//
// สองส่วน: ตรรกะล้วนทดสอบด้วยการเรียกจริง (hr-core.js ไม่มี I/O) ส่วน gate ของ
// callable อ่านจาก source เพราะ hr.js ประกาศ onCall ตอน import และทุก handler
// ต้องมี getDatabase() จริง (กฎเดียวกับ staff-lifecycle / ledger-updated-by)
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  isThaiNationalId,
  formatEmployeeCode,
  bangkokBuddhistYear,
  sanitizeEmployeePublic,
  sanitizeEmployeePrivate,
  accessSummary,
  unlinkedAccounts,
  employeeActorFields,
} from "../hr-core.js";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { failures++; console.log(`FAIL  ${label}`); }
};

// ── 1. เลขบัตรประชาชน: checksum จริง ไม่ใช่แค่นับหลัก ──────────────────────
// 13 หลักที่พิมพ์ผิดหนึ่งตัวยังนับได้ 13 หลักอยู่ดี แล้วมันจะไปโผล่บนหนังสือ
// รับรองหัก ณ ที่จ่ายที่ยื่นสรรพากร
const VALID_ID = "1101700207366"; // ผ่าน checksum จริง (คิดจากสูตรหลักที่ 13)
check("เลขบัตรที่ถูกต้องผ่าน", isThaiNationalId(VALID_ID));
check("เลขบัตรที่พิมพ์ผิดหนึ่งหลักไม่ผ่าน (checksum ทำงานจริง)",
  !isThaiNationalId("1101700207367"));
check("13 หลักแต่ checksum ไม่ตรง ไม่ผ่าน", !isThaiNationalId("1234567890123"));
check("น้อยกว่า 13 หลักไม่ผ่าน", !isThaiNationalId("110170020736"));
check("มีขีดคั่นยังผ่าน (คนกรอกใส่ขีด)", isThaiNationalId("1-1017-00207-36-6"));
check("ว่างไม่ผ่าน", !isThaiNationalId(""));

// ── 2. รหัสประจำตัว ────────────────────────────────────────────────────────
check("รหัสพนักงานเติมศูนย์ 4 หลัก", formatEmployeeCode("EMP", 2569, 7) === "EMP-2569-0007");
check("รหัสพนักงานเกิน 4 หลักไม่ถูกตัด", formatEmployeeCode("EMP", 2569, 12345) === "EMP-2569-12345");
check("prefix ว่าง fallback เป็น EMP", formatEmployeeCode("", 2569, 1) === "EMP-2569-0001");
// 1 ม.ค. 2026 07:00 ICT = 2026-01-01T00:00:00Z → พ.ศ. 2569
check("ปีพุทธศักราชอิงเวลาไทย", bangkokBuddhistYear(Date.parse("2026-01-01T00:00:00Z")) === 2569);
// 31 ธ.ค. 2025 23:30 UTC = 1 ม.ค. 2026 06:30 ICT → ต้องเป็นปีใหม่แล้ว
check("ข้ามปีตามเวลาไทยไม่ใช่ UTC",
  bangkokBuddhistYear(Date.parse("2025-12-31T23:30:00Z")) === 2569);

// ── 3. allowlist ชั้นบน: client ตั้งฟิลด์ของ server ไม่ได้ ─────────────────
// employee_code / status / links / timestamps มีกติกาของตัวเอง (ตัวนับ,
// ประวัติ, การตรวจว่าบัญชีถูกจองไว้แล้ว) — รับจาก client เมื่อไหร่ กติกา
// ทั้งหมดนั้นถูกข้าม
{
  const { value } = sanitizeEmployeePublic({
    name: "สมชาย ใจดี", employment_type: "monthly", hired_at: 1_700_000_000_000,
    employee_code: "EMP-2569-9999", status: "active", links: { staff_id: "hacked" },
    created_at: 1, updated_at: 2, terminated_at: 3, evil: "x",
  });
  const keys = Object.keys(value).sort();
  check("public allowlist ไม่ปล่อยฟิลด์ของ server ผ่าน",
    !keys.includes("employee_code") && !keys.includes("status") &&
    !keys.includes("links") && !keys.includes("created_at") &&
    !keys.includes("terminated_at") && !keys.includes("evil"));
  check("public allowlist เก็บฟิลด์ที่ตั้งใจไว้", value.name === "สมชาย ใจดี" && value.employment_type === "monthly");
}
{
  const { errors } = sanitizeEmployeePublic({ name: "", employment_type: "monthly", hired_at: 1 });
  check("ไม่มีชื่อ = error", errors.some((e) => e.includes("ชื่อ")));
}
{
  const { errors } = sanitizeEmployeePublic({ name: "ก", employment_type: "contractor", hired_at: 1 });
  check("ประเภทการจ้างนอกลิสต์ = error", errors.some((e) => e.includes("ประเภทการจ้าง")));
}
{
  const { errors } = sanitizeEmployeePublic({ name: "ก", employment_type: "monthly" });
  check("ไม่มีวันเริ่มงาน = error (ตอนสร้างใหม่)", errors.some((e) => e.includes("วันเริ่มงาน")));
}
{
  const { errors } = sanitizeEmployeePublic({ name: "ก", employment_type: "monthly", hired_at: 1, photo_url: "javascript:alert(1)" });
  check("รูปโปรไฟล์ที่ไม่ใช่ https = error (XSS ที่รอถูก render)",
    errors.some((e) => e.includes("https")));
}
{
  // partial: แก้เฉพาะฟิลด์ที่ส่งมา ไม่ล้างฟิลด์อื่นเป็น null
  const { value, errors } = sanitizeEmployeePublic({ position: "ช่างซ่อม" }, { partial: true });
  check("partial แก้เฉพาะที่ส่งมา", Object.keys(value).length === 1 && value.position === "ช่างซ่อม" && errors.length === 0);
}

// ── 4. allowlist ชั้นใน: object ซ้อนต้องมี allowlist ของตัวเอง ─────────────
// นี่คือจุดที่ public_track พลาดสองรอบ — รับ `src.bank` ทั้งก้อนแปลว่าใครก็ตาม
// ที่ยิง callable ได้เขียนอะไรก็ได้ลงใต้ชื่อที่เราคิดว่ารู้จัก
{
  const { value } = sanitizeEmployeePrivate({
    national_id: VALID_ID,
    bank: { name: "SCB", account: "1234567890", account_name: "สมชาย", secret_note: "leak" },
    emergency_contact: { name: "แม่", relation: "มารดา", phone: "0800000000", id_card: "leak" },
    pay: { base_salary: 25000, daily_rate: null, bonus_hack: 999999, allowances: [{ label: "ค่าน้ำมัน", amount: 1000, evil: 1 }] },
    unknown_top_level: "leak",
  });
  check("bank ไม่ปล่อยคีย์แปลกปลอม", Object.keys(value.bank).sort().join(",") === "account,account_name,name");
  check("emergency_contact ไม่ปล่อยคีย์แปลกปลอม",
    Object.keys(value.emergency_contact).sort().join(",") === "name,phone,relation");
  check("pay ไม่ปล่อยคีย์แปลกปลอม", Object.keys(value.pay).sort().join(",") === "allowances,base_salary,daily_rate");
  check("allowances แต่ละแถวไม่ปล่อยคีย์แปลกปลอม",
    Object.keys(value.pay.allowances[0]).sort().join(",") === "amount,label,recurring,taxable");
  check("ฟิลด์บนสุดที่ไม่รู้จักถูกทิ้ง", !("unknown_top_level" in value));
}
{
  const { errors } = sanitizeEmployeePrivate({ national_id: "1234567890123" });
  check("เลขบัตรผิด = error ตั้งแต่ชั้นรับข้อมูล", errors.some((e) => e.includes("เลขบัตร")));
}
{
  const { errors } = sanitizeEmployeePrivate({ pay: { base_salary: -1 } });
  check("เงินเดือนติดลบ = error", errors.some((e) => e.includes("ไม่ติดลบ")));
}
{
  const { errors } = sanitizeEmployeePrivate({ email: "not-an-email" });
  check("อีเมลผิดรูป = error", errors.some((e) => e.includes("อีเมล")));
}

// ── 5. สถานะการเข้าถึง — ธงที่หน้าเว็บใช้บอกความจริง ─────────────────────
// ทะเบียนบอกว่าพ้นสภาพได้ แต่การปิดบัญชีจริงเป็นงานของ P3 ระหว่างนั้นระบบ
// **ต้องบอกว่าบัญชียังเปิดอยู่** ไม่ใช่โชว์คำว่าพ้นสภาพแล้วปล่อยให้เข้าใจว่าปิดแล้ว
const STAFF = { s1: { name: "A", status: "ACTIVE", role: "STAFF" }, s2: { name: "B", status: "INACTIVE", role: "STAFF" } };
const RIDERS = { r1: { name: "R", approval_status: "approved" }, r2: { name: "R2", approval_status: "blocked" } };
{
  const a = accessSummary({ status: "terminated", links: { staff_id: "s1" } }, STAFF, RIDERS);
  check("พ้นสภาพแต่บัญชีแอดมินยัง ACTIVE = stale_access", a.stale_access === true && a.open === true);
}
{
  const a = accessSummary({ status: "terminated", links: { staff_id: "s2" } }, STAFF, RIDERS);
  check("พ้นสภาพและบัญชีถูกพักแล้ว = ไม่ stale", a.stale_access === false && a.open === false);
}
{
  const a = accessSummary({ status: "terminated", links: { rider_id: "r1" } }, STAFF, RIDERS);
  check("พ้นสภาพแต่ไรเดอร์ยัง approved = stale_access", a.stale_access === true);
}
{
  const a = accessSummary({ status: "terminated", links: { rider_id: "r2" } }, STAFF, RIDERS);
  check("ไรเดอร์ที่ถูก block ไม่นับว่าเปิดอยู่", a.stale_access === false && a.open === false);
}
{
  const a = accessSummary({ status: "active", links: { staff_id: "s1" } }, STAFF, RIDERS);
  check("ยังทำงานอยู่ + บัญชีเปิด = ปกติ ไม่ใช่ stale", a.open === true && a.stale_access === false);
}
{
  const a = accessSummary({ status: "terminated", links: { staff_id: "s1" } },
    { s1: { ...STAFF.s1, terminated_at: 123 } }, RIDERS);
  check("แถว staff ที่ปิดบัญชีแล้ว (terminated_at) ไม่นับว่าเปิดอยู่", a.stale_access === false);
}
{
  const a = accessSummary({ status: "resigned", links: {} }, STAFF, RIDERS);
  check("ไม่ผูกบัญชีเลย = ไม่ stale", a.stale_access === false && a.open === false);
}

// ── 6. บัญชีที่ยังไม่ผูก — งานหลักของ P1 คือผูกของเดิมเข้าทะเบียน ─────────
{
  const employees = { e1: { name: "A", links: { staff_id: "s1" } } };
  const list = unlinkedAccounts(employees,
    { ...STAFF, s3: { name: "C", status: "ACTIVE", role: "FINANCE" }, s4: { name: "D", terminated_at: 1 } },
    RIDERS);
  const ids = list.map((x) => x.id).sort();
  check("บัญชีที่ผูกแล้วไม่โผล่ซ้ำ", !ids.includes("s1"));
  check("บัญชีที่ปิดไปแล้วไม่โผล่ (ไม่ใช่พนักงานที่รอผูก)", !ids.includes("s4"));
  check("บัญชีที่ยังไม่ผูกโผล่ครบ", ids.includes("s2") && ids.includes("s3") && ids.includes("r1") && ids.includes("r2"));
  check("ไรเดอร์ถูกติดป้าย kind ให้ถูก", list.find((x) => x.id === "r1").kind === "rider");
}

// ── 7. รูป by_* ต้องตรงกับ staff_status_events / rider_status_events ───────
// ประวัติของคนกลุ่มเดียวกันต้อง join ด้วย query shape เดียวได้ ซึ่งเป็นปัญหา
// ที่ survey เจอมาแล้ว (คนคนเดียวถูกประทับด้วยสี่รูปแบบที่เข้ากันไม่ได้)
{
  const f = employeeActorFields("s1", STAFF, { uid: "u1" });
  check("by_* ครบสี่ฟิลด์ตามรูปเดียวกับอีกสองโหนด",
    Object.keys(f).sort().join(",") === "by_name,by_role,by_staff_id,by_uid");
  check("by_role เป็นตัวพิมพ์ใหญ่", f.by_role === "STAFF");
}

// ── 8. gate ของ callable (อ่านจาก source) ──────────────────────────────────
const hrSrc = readFileSync(join(fnDir, "hr.js"), "utf8");
const coreSrc = readFileSync(join(fnDir, "hr-core.js"), "utf8");
const actorSrc = readFileSync(join(fnDir, "actor.js"), "utf8");
const staffSrc = readFileSync(join(fnDir, "staff-accounts.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/pages/hr/EmployeeRegister.tsx"), "utf8");

function callableOf(name) {
  const start = hrSrc.indexOf(`const ${name} = onCall`);
  if (start === -1) return null;
  const next = hrSrc.indexOf("\n  const admin", start + 1);
  return hrSrc.slice(start, next === -1 ? hrSrc.length : next);
}
const CALLABLES = [
  "adminHrEmployeeList", "adminHrEmployeeCreate", "adminHrEmployeeUpdate",
  "adminHrEmployeeSetStatus", "adminHrEmployeeLink", "adminHrEmployeeEvents",
];
for (const name of CALLABLES) {
  const body = callableOf(name);
  check(`${name} มี gate requireStaffRole(..., HR_ROLES)`,
    !!body && /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(body));
}

// MANAGER ต้องไม่อยู่ใน HR_ROLES — โหนดนี้มีเงินเดือนของทุกคนรวมถึงของ
// MANAGER คนอื่น การเปิดให้ทั้งชั้นบริหารเป็นการตัดสินใจเรื่องคน ต้องมีคนสั่ง
// HR_ROLES อยู่ที่ hr-core.js เพราะทั้ง hr.js และ hr-payroll-api.js ใช้ร่วมกัน —
// gate เดียวกันต้องมีสำเนาเดียว ไม่งั้นวันหนึ่งสองไฟล์จะนิยาม "ใครเป็น HR"
// ไม่ตรงกัน แล้วรอบเงินเดือนจะเปิดกว้างกว่าทะเบียนพนักงานโดยไม่มีใครเห็น
{
  const m = coreSrc.match(/const HR_ROLES = (\[[^\]]*\])/);
  check("HR_ROLES = CEO/HR เท่านั้น (ไม่มี MANAGER)",
    !!m && JSON.parse(m[1].replace(/'/g, '"')).sort().join(",") === "CEO,HR");
  check("hr.js ไม่ประกาศ HR_ROLES ของตัวเอง (สำเนาเดียว)",
    !/const HR_ROLES = \[/.test(hrSrc));
}

// ── 9. ห้าม log ข้อมูลอ่อนไหว ──────────────────────────────────────────────
// log ของ Cloud Run เก็บนานกว่าและมีคนอ่านได้กว้างกว่าตัวข้อมูลเอง
{
  const logs = hrSrc.match(/console\.(log|warn|error)\([^\n]*/g) || [];
  const leaky = logs.filter((l) => /national_id|base_salary|daily_rate|\bpriv\b|private/.test(l));
  check("ไม่มี console.log ที่แตะเลขบัตร/เงินเดือน", leaky.length === 0);
}

// ── 10. HR ต้องไม่ถูก map เข้า ROLE_TO_ACTOR ───────────────────────────────
// resolveActor คืน null ให้ HR = ด่านที่กันฝ่ายบุคคลออกจากเอนด์พอยต์ที่จ่ายเงิน
// (SICKW) และจากการเปลี่ยนสถานะงาน — ดู docs/hr-system-design.md ข้อ 7.1
{
  const m = actorSrc.match(/const ROLE_TO_ACTOR = \{([\s\S]*?)\};/);
  check("actor.js ไม่ map HR (ด่านที่ตั้งใจปล่อยว่าง)", !!m && !/\bHR:/.test(m[1]));
  check("actor.js อธิบายไว้ว่าทำไมถึงไม่ map (กันคนมาเติมให้ครบตาราง)",
    /ห้ามเติม/.test(actorSrc));
}
check("staff-accounts.js รู้จัก role HR", /VALID_ROLES = \[[^\]]*"HR"/.test(staffSrc));

// ── 11. หน้าเว็บต้องพูดความจริงว่าทะเบียนยังไม่ปิดบัญชีให้ ─────────────────
// ระบบที่เขียนว่าพ้นสภาพแล้วเงียบเรื่องบัญชีที่ยังใช้ได้ คือระบบที่ตอบผิด
// โดยไม่มีใครเห็น — ข้อความเตือนนี้เป็นส่วนหนึ่งของฟีเจอร์ ไม่ใช่ของประดับ
check("หน้าทะเบียนบอกว่ายังไม่ปิดบัญชีให้อัตโนมัติ", /ยังไม่ปิดบัญชีให้อัตโนมัติ/.test(uiSrc));
check("หน้าทะเบียนอ่านธง stale_access มาแสดง", /stale_access/.test(uiSrc));
check("หน้าทะเบียนไม่โชว์เลขบัตรเต็ม (mask ก่อนเสมอ)",
  /maskId\(row\.private\?\.national_id\)/.test(uiSrc) && !/\{row\.private\?\.national_id\}/.test(uiSrc));

// ── 12. hr-core ต้องไม่มี I/O — ถ้าแตะ Firebase เมื่อไหร่ เทสชุดนี้จะกลาย
// เป็นเทสที่ต้องมีฐานข้อมูล แล้วจะไม่มีใครรันมัน
check("hr-core.js ไม่ import firebase อะไรเลย", !/require\(["']firebase/.test(coreSrc));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
