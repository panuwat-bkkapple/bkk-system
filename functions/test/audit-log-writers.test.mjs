// =============================================================================
// Audit log — สารบัญต้องตรงกับผู้เขียนจริง และป้ายต้องมาจากที่เดียว
//   node functions/test/audit-log-writers.test.mjs
//
// ชุดนี้เฝ้าสิ่งที่ `audit-log.test.mjs` เฝ้าไม่ได้ เพราะมันเป็นเรื่องของ
// **ความสัมพันธ์ระหว่างไฟล์** ไม่ใช่พฤติกรรมของฟังก์ชันล้วน:
//
//   1. ทุก action ในสารบัญมีโค้ดที่เขียนมันจริง (ตอนร่างครั้งแรกลิสต์มี
//      `deleted` กับ `account_issued` ที่ไม่มีใครเขียนเลย = หน้า audit log
//      สัญญาว่าตอบสองคำถามที่มันตอบไม่ได้)
//   2. แฟ้มที่ถูก **สร้าง** ต้องมีแถว audit — ไม่งั้นคนที่ถูกตั้งเงินเดือนสูง
//      ตั้งแต่วันแรกแล้วไม่เคยถูกแก้เลย จะไม่มีแถวไหนในระบบเล่าถึงเขา
//   3. call site ไม่พิมพ์ลิสต์ฟิลด์เอง — ต้องมาจาก allowlist (ลิสต์ที่พิมพ์มือ
//      จะเงียบเมื่อมีคนเพิ่มฟิลด์เข้า `AUDIT_FIELDS` แล้วลืมแก้ call site)
//
// **การสแกน action ต้องดูเฉพาะใน `recordAudit(...)`** — `account_revoked` มีอยู่
// ในสารบัญของไทม์ไลน์การจ้าง (`EMPLOYEE_EVENT_ACTIONS`) ด้วย ถ้าสแกนทั้งไฟล์
// แล้วตัดด้วยรายชื่อ การเขียน `employee_events` เฉยๆ ก็จะทำให้เทสเขียว
// (กับดัก "เทสที่เห็นด้วยกับตัวเอง" — ผลลัพธ์ถูกตัดสินโดยกลไกก่อนหน้ากฎที่
// ตั้งใจทดสอบ) จึงตัดบล็อกของ `recordAudit` ออกมาด้วยการนับวงเล็บ
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                                | ผล |
//   |----------------------------------------------------------|----|
//   | ใส่ `deleted` กลับเข้าสารบัญทั้งที่ไม่มีผู้เขียน            | แดง 2 |
//   | ถอดแถว audit ตอนสร้างแฟ้ม (กลับไปเก็บเฉพาะการแก้)         | แดง 3 |
//   | call site พิมพ์ลิสต์ฟิลด์เอง แทนดึงจาก allowlist           | แดง 2 |
//   | callable มีเส้นทางเขียน (`.set`)                          | แดง 1 |
//   | กวาดโหนด `audit_log` ทั้งก้อน (กฎค่า RTDB)                | แดง 2 |
//   | เปิดให้ MANAGER/STAFF อ่าน audit ได้                       | แดง 2 |
//   | ถอดแถว `account_revoked` ตอนปิดบัญชี                      | แดง 1 |
//   | ถอดป้ายภาษาไทยของ `base_salary`                           | แดง 1 |
//   | `base_salary` ไม่บอกชนิดเป็น money                        | แดง 1 |
//   | ถอด `field_meta` / `action_labels` ออกจากคำตอบ            | แดง 1 (แต่ละตัว) |
//
// **สองแถวสุดท้ายเป็นการสแกนซอร์ส ไม่ใช่การรัน callable** — รันจริงต้องมี
// Firebase ซึ่งชุดออฟไลน์ทำไม่ได้ ด่านจึงอ่อนกว่าที่ควร บันทึกไว้ตรงๆ แทนที่
// จะแต่ง fixture ให้ดูเหมือนพิสูจน์ได้มากกว่าความจริง
// =============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, "..");
const A = require(join(FUNCTIONS, "audit-log.js"));

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const read = (f) => readFileSync(join(FUNCTIONS, f), "utf8");

/** ตัดคอมเมนต์ทิ้งก่อนสแกนเสมอ — regex ของเทสโครงสร้างแมตช์คอมเมนต์ได้ */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** ดึงเนื้อในวงเล็บของทุก `name(` ด้วยการนับวงเล็บ (ไม่ใช่หน้าต่างความยาวคงที่) */
function callBlocks(src, name) {
  const out = [];
  const needle = `${name}(`;
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === "(") depth += 1;
      else if (src[j] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf(needle, j + 1);
  }
  return out;
}

const HR = stripComments(read("hr.js"));
const auditCalls = callBlocks(HR, "recordAudit");

// ── 1. เครื่องมือสแกนต้องทำงานจริงก่อน ────────────────────────────────────
{
  check("ดึงบล็อก recordAudit ออกมาได้ (ตัวสแกนยังใช้ได้)", auditCalls.length >= 3);
  check("ตัดคอมเมนต์ทิ้งจริง", !HR.includes("audit เก็บ *ค่า*"));
}

// ── 2. ทุก action ในสารบัญมีผู้เขียนจริง ───────────────────────────────────
{
  const written = new Set();
  for (const b of auditCalls) {
    for (const m of b.matchAll(/\baction:\s*"([a-z_]+)"/g)) written.add(m[1]);
  }
  const missing = A.AUDIT_ACTIONS.filter((a) => !written.has(a));
  check(`ทุก action ในสารบัญมีโค้ดที่เขียนมัน (ขาด: ${missing.join(", ") || "ไม่มี"})`,
    missing.length === 0);

  const unknown = [...written].filter((a) => !A.AUDIT_ACTIONS.includes(a));
  check(`ไม่มี action ที่เขียนแต่ไม่อยู่ในสารบัญ (เกิน: ${unknown.join(", ") || "ไม่มี"})`,
    unknown.length === 0);

  // ป้ายต้องครบทุก action ไม่งั้นหน้าเว็บขึ้นชื่อ action ดิบเป็นภาษาอังกฤษ
  const noLabel = A.AUDIT_ACTIONS.filter((a) => !A.AUDIT_ACTION_LABEL[a]);
  check(`ทุก action มีป้ายภาษาไทย (ขาด: ${noLabel.join(", ") || "ไม่มี"})`,
    noLabel.length === 0);
}

// ── 3. การสร้างแฟ้มต้องมีแถว audit และต้องอยู่ที่ตัวสร้าง ไม่ใช่ที่ callable ─
//
// แฟ้มเกิดได้สองทาง (ทะเบียน `adminHrEmployeeCreate` กับกดจ้างผู้สมัคร
// `adminHrApplicationHire`) ทั้งคู่ผ่าน `createEmployeeRecord` — seam เดียว
{
  const body = callBlocks(HR, "function createEmployeeRecord")[0] || "";
  const start = HR.indexOf("async function createEmployeeRecord");
  const end = HR.indexOf("\nfunction assertNoErrors", start);
  const fnSrc = start !== -1 && end !== -1 ? HR.slice(start, end) : body;
  check("createEmployeeRecord เขียน audit ด้วย", /recordAudit\(/.test(fnSrc));
  check('และเขียนด้วย action "created"', /action:\s*"created"/.test(fnSrc));

  // ทางกดจ้างต้องไม่มีตัวสร้างแฟ้มเป็นของตัวเอง มิฉะนั้น seam ข้างบนไม่ครอบ
  const REC = stripComments(read("hr-recruitment-api.js"));
  check("สายรับสมัครงานใช้ createEmployeeRecord ตัวเดียวกัน ไม่สร้างแฟ้มเอง",
    REC.includes("createEmployeeRecord(") && !/db\.ref\("employees"\)\.push\(/.test(REC));
}

// ── 4. call site ไม่พิมพ์ลิสต์ฟิลด์เอง ─────────────────────────────────────
{
  const hardCoded = auditCalls.filter((b) => /fields:\s*\[\s*"/.test(b));
  check(`ไม่มี call site ที่พิมพ์ลิสต์ฟิลด์เอง (พบ ${hardCoded.length})`,
    hardCoded.length === 0);

  const employeeCalls = auditCalls.filter((b) => /entity:\s*"employee"/.test(b));
  const viaAllowlist = employeeCalls.filter((b) => /auditFieldsFor\("employee"\)/.test(b));
  // `account_revoked` ไม่ diff ฟิลด์ (fields: []) จึงไม่ต้องผ่าน allowlist
  const diffing = employeeCalls.filter((b) => !/fields:\s*\[\]/.test(b));
  check("ทุก call site ที่ diff ฟิลด์ของพนักงานดึงลิสต์จาก allowlist",
    diffing.length > 0 && diffing.every((b) => viaAllowlist.includes(b)));
}

// ── 5. ป้ายฟิลด์ครบทุกฟิลด์ในทุก entity ────────────────────────────────────
//
// ฟิลด์ที่ไม่มีป้ายไม่ได้ทำให้พัง (หน้าเว็บขึ้นชื่อดิบ) แต่ชื่อดิบอย่าง
// `bank_account_no` บนหน้าที่ผู้บริหารใช้ตรวจ คือของที่อ่านแล้วต้องเดา
{
  for (const entity of A.AUDITED_ENTITIES) {
    const meta = A.auditFieldMeta(entity);
    const fields = A.auditFieldsFor(entity);
    const noLabel = fields.filter((f) => !meta[f] || meta[f].label === f);
    check(`[${entity}] ทุกฟิลด์มีป้ายภาษาไทย (ขาด: ${noLabel.join(", ") || "ไม่มี"})`,
      fields.length > 0 && noLabel.length === 0);
    const maskMismatch = fields.filter((f) => meta[f].mask !== Boolean(A.AUDIT_FIELDS[entity][f].mask));
    check(`[${entity}] ธง mask ที่ส่งให้หน้าเว็บตรงกับ allowlist`, maskMismatch.length === 0);
  }
  check("ฟิลด์เงินเดือนบอกชนิดเป็น money (ไม่งั้นหน้าเว็บโชว์เลขดิบ)",
    A.auditFieldMeta("employee").base_salary.kind === "money");
  check("วันเริ่มงานบอกชนิดเป็น date (ไม่งั้นหน้าเว็บโชว์ ms)",
    A.auditFieldMeta("employee").hired_at.kind === "date");
  check("entity ที่ไม่รู้จักคืนตารางว่าง ไม่ throw",
    Object.keys(A.auditFieldMeta("ไม่มีจริง")).length === 0);
}

// ── 6. callable อ่านอย่างเดียว และ gate แคบกว่า HR ─────────────────────────
{
  const API = read("audit-log-api.js");
  const api = require(join(FUNCTIONS, "audit-log-api.js"));
  check("อ่าน audit ได้เฉพาะ CEO", JSON.stringify(api.AUDIT_READ_ROLES) === '["CEO"]');
  const CORE = require(join(FUNCTIONS, "hr-core.js"));
  check("แคบกว่าสิทธิ์ของงาน HR ประจำวัน",
    api.AUDIT_READ_ROLES.length < CORE.HR_ROLES.length);

  const stripped = stripComments(API);
  // **ดูเฉพาะเมธอดที่ต่อท้าย `db.ref(...)`** — เช็ค `.push(` ทั้งไฟล์จะไปแมตช์
  // `rows.push(...)` ซึ่งเป็น array ธรรมดา แล้วเทสจะแดงด้วยเหตุผลที่ผิด
  // (regex ของเทสโครงสร้างโกหกได้สองทาง — นี่คือทางที่สอง)
  const refChains = [...stripped.matchAll(/db\.ref\([\s\S]*?(?=;)/g)].map((m) => m[0]);
  check("มี db.ref ให้ตรวจจริง (ตัวสแกนยังใช้ได้)", refChains.length >= 2);
  const READ_ONLY = new Set(["ref", "once", "limitToLast", "orderByChild", "equalTo", "forEach"]);
  const writes = [];
  for (const chain of refChains) {
    for (const m of chain.matchAll(/\.([a-zA-Z]+)\(/g)) {
      if (!READ_ONLY.has(m[1])) writes.push(m[1]);
    }
  }
  check(`callable ไม่มีเส้นทางเขียน (พบ: ${[...new Set(writes)].join(", ") || "ไม่มี"})`,
    writes.length === 0);
  check("ไม่กวาดโหนด audit_log ทั้งก้อน", !/ref\("audit_log"\)|ref\(`audit_log`\)/.test(stripped));
  check("อ่าน subtree ต่อ entity", stripped.includes("audit_log/${entity}/${id}"));
  check("มีเพดานแถว และบอกออกไปให้หน้าเว็บรู้",
    api.MAX_ROWS > 0 && stripped.includes("capped"));
  // หน้าเว็บ render ป้ายจากสิ่งที่ callable ส่งมา ถ้าสองฟิลด์นี้หายไป หน้าเว็บ
  // จะขึ้นชื่อฟิลด์ดิบทั้งหน้าโดยไม่มีอะไรพัง — เทสนี้เป็นการสแกนซอร์ส ซึ่ง
  // อ่อนกว่าการรัน callable จริง แต่ callable รันออฟไลน์ไม่ได้ (ต้องมี Firebase)
  check("callable ส่งป้ายฟิลด์ไปให้หน้าเว็บ", /field_meta:\s*auditFieldMeta\(/.test(stripped));
  check("callable ส่งป้าย action ไปให้หน้าเว็บ", /action_labels:\s*AUDIT_ACTION_LABEL/.test(stripped));
  check("ลงทะเบียนใน index.js แล้ว",
    /require\("\.\/audit-log-api"\)\.registerAuditLog\(/.test(read("index.js")));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
