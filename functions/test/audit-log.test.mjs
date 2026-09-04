// =============================================================================
// Audit log — ใครแก้อะไร จากค่าอะไรเป็นค่าอะไร
//   node functions/test/audit-log.test.mjs
//
// ชุดนี้เฝ้าเส้นแบ่งเส้นเดียวที่ทำให้ของเดิมพัง: **audit ต้องเก็บค่า ส่วนของ
// ที่ระบุตัวบุคคลต้องไม่เก็บเต็ม** — เดิมเลือกทางเดียว (ไม่เก็บอะไรเลย) แล้ว
// บรรทัด "ปรับเงินเดือน" บนจอต้องเขียนแก้ตัวว่าระบบไม่ได้บันทึกจำนวนเงินไว้
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                          | ผล |
//   |----------------------------------------------------|----|
//   | **ย้อนกลับเป็นบั๊กเดิม: ไม่เก็บค่าเลย**              | แดง 8 |
//   | เลขบัตร/เลขบัญชี/เบอร์ เก็บเต็มไม่ mask              | แดง 4 |
//   | ฟิลด์นอก allowlist เก็บค่าเต็ม (เสีย fail-safe)      | แดง 3 |
//   | ไม่มีอะไรเปลี่ยนก็ยังเขียนแถว                        | แดง 1 |
//   | `''` กับ `null` ถูกนับว่าเปลี่ยน                     | แดง 2 |
//   | diff เดินตาม key ที่บังเอิญมี แทน fields ที่ประกาศ    | แดง 1 |
//   | เก็บแบน ไม่ซ้อนใต้ entity (ต้องมี .indexOn)          | แดง 1 |
//   | ถอดเพดานจำนวน changes ต่อแถว                        | แดง 1 |
//
// แถวแรกแดงมากที่สุดโดยตั้งใจ — มันคือบั๊กที่ทำให้ต้องเขียนไฟล์นี้ ถ้าวันหนึ่ง
// มีใครย้อนกลับไปเพราะกลัวข้อมูลอ่อนไหว จะเจอ 8 ข้อพร้อมกันพร้อมเหตุผล
// =============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const A = require(join(HERE, "..", "audit-log.js"));

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const diff = (before, after, fields, entity = "employee") =>
  A.diffFields({ entity, before, after, fields });

// ── 1. ข้อเท็จจริงทางธุรกิจต้องเก็บค่าเต็ม ─────────────────────────────────
//
// **นี่คือบั๊กที่ทำให้ต้องเขียนไฟล์นี้** — ของเดิมเขียน `from: null, to: null`
// ให้ salary_changed ทุกแถว แล้ว audit ตอบคำถามเดียวที่มันมีไว้ตอบไม่ได้เลย
{
  const d = diff({ base_salary: 15000 }, { base_salary: 20000 }, ["base_salary"]);
  check("เงินเดือนเก็บค่าเก่าและค่าใหม่จริง", d.length === 1 && d[0].from === 15000 && d[0].to === 20000);
  check("เงินเดือนไม่ถูกทำเครื่องหมายว่าไม่เก็บค่า", !d[0].withheld);

  const pos = diff({ position: "พนักงานขาย" }, { position: "หัวหน้าฝ่ายขาย" }, ["position"]);
  check("ตำแหน่งเก็บค่าเต็ม", pos[0].from === "พนักงานขาย" && pos[0].to === "หัวหน้าฝ่ายขาย");

  const st = diff({ status: "probation" }, { status: "active" }, ["status"]);
  check("สถานะการจ้างเก็บค่าเต็ม", st[0].from === "probation" && st[0].to === "active");
}

// ── 2. ตัวระบุตัวบุคคลต้องไม่เก็บเต็ม ───────────────────────────────────────
//
// audit ตอบหน้าที่ได้ครบด้วย "เปลี่ยนจาก ****0121 เป็น ****0987" — การเก็บเลข
// เต็มคือการสร้างสำเนาเลขบัตรของทุกคนไว้อีกที่โดยไม่มีใครต้องใช้
{
  const nid = diff({ national_id: "1234567890121" }, { national_id: "9876543210987" }, ["national_id"]);
  check("เลขบัตรถูก mask", nid[0].from === "****0121" && nid[0].to === "****0987");
  check("เลขบัตรเต็มไม่โผล่ในแถว", !JSON.stringify(nid).includes("1234567890121"));

  const bank = diff({ bank_account_no: "1234567890" }, { bank_account_no: "0987654321" }, ["bank_account_no"]);
  check("เลขบัญชีถูก mask", bank[0].from === "****7890" && bank[0].to === "****4321");

  const phone = diff({ phone: "0812345678" }, { phone: "0898765432" }, ["phone"]);
  check("เบอร์โทรถูก mask", phone[0].from === "****5678" && !JSON.stringify(phone).includes("0812345678"));

  check("ค่าสั้นมากถูกกลบทั้งตัว", A.maskAuditValue("12") === "****");
  check("ค่าว่าง mask แล้วเป็น null ไม่ใช่ '****'", A.maskAuditValue("") === null);
}

// ── 3. ฟิลด์นอก allowlist = รู้ว่าเปลี่ยน แต่ไม่เก็บค่า ─────────────────────
//
// **fail-safe** — ฟิลด์อ่อนไหวที่ใครเพิ่มเข้ามาวันหน้าต้องไม่ไหลลง audit เอง
// โดยไม่มีใครตัดสินใจ (หลักเดียวกับ PUBLIC_TRACK_FIELDS)
{
  const d = diff({ secret_note: "ก" }, { secret_note: "ข" }, ["secret_note"]);
  check("ฟิลด์ที่ไม่รู้จักยังถูกบันทึกว่าเปลี่ยน", d.length === 1 && d[0].field === "secret_note");
  check("แต่ไม่เก็บค่า", d[0].from === null && d[0].to === null);
  check("และติดธงบอกว่าจงใจไม่เก็บ", d[0].withheld === true);
  check("ค่าจริงไม่โผล่ที่ไหนในแถว", !JSON.stringify(d).includes("ก") && !JSON.stringify(d).includes("ข"));
}

// ── 4. ไม่มีอะไรเปลี่ยน = ไม่มีแถว ─────────────────────────────────────────
//
// แถวที่บอกว่าไม่มีอะไรเกิดขึ้นคือขยะที่กลบแถวจริง
{
  check("ค่าเท่าเดิมไม่นับว่าเปลี่ยน", diff({ name: "สมชาย" }, { name: "สมชาย" }, ["name"]).length === 0);
  check("null กับ '' ไม่นับว่าเปลี่ยน", diff({ position: null }, { position: "" }, ["position"]).length === 0);
  check("null กับ undefined ไม่นับว่าเปลี่ยน", diff({ position: null }, {}, ["position"]).length === 0);

  const entry = A.buildAuditEntry({
    entity: "employee", entityId: "e1", action: "updated",
    before: { name: "สมชาย" }, after: { name: "สมชาย" }, fields: ["name"],
  });
  check("แก้แล้วไม่มีอะไรเปลี่ยน = ไม่เขียนแถว", entry === null);
}

// ── 5. action ที่ไม่ใช่การแก้ฟิลด์ยังต้องมีแถว ─────────────────────────────
//
// การสร้าง/ลบ/ออกบัญชี ไม่มี diff แต่เป็นสิ่งที่ต้องตรวจสอบได้มากที่สุด
{
  const created = A.buildAuditEntry({
    entity: "employee", entityId: "e1", action: "created", before: {}, after: {}, fields: [],
  });
  check("สร้างพนักงานมีแถวแม้ diff ว่าง", created !== null && created.action === "created");

  const revoked = A.buildAuditEntry({
    entity: "employee", entityId: "e1", action: "account_revoked", before: {}, after: {}, fields: [],
  });
  check("ถอนบัญชีมีแถวแม้ diff ว่าง", revoked !== null);
}

// ── 6. เดินตามฟิลด์ที่ประกาศ ไม่ใช่ตาม key ที่บังเอิญมี ─────────────────────
//
// ไม่งั้น `updated_at` ที่ระบบเขียนเองทุกครั้งจะกลายเป็น "การเปลี่ยนแปลง"
// ทุกแถว แล้ว audit เต็มไปด้วยแถวที่ไม่มีใครสั่ง
{
  const d = diff(
    { name: "สมชาย", updated_at: 1 },
    { name: "สมหญิง", updated_at: 2 },
    ["name"]
  );
  check("ฟิลด์ที่ไม่ได้ประกาศไม่เข้า diff", d.length === 1 && d[0].field === "name");
}

// ── 7. แถวที่ประกอบได้ต้องมีคนสั่งติดมาด้วย ────────────────────────────────
//
// audit ที่ไม่รู้ว่าใครทำคือ log เฉยๆ ไม่ใช่ audit
{
  const e = A.buildAuditEntry({
    entity: "employee", entityId: "e1", action: "updated",
    before: { base_salary: 15000 }, after: { base_salary: 20000 }, fields: ["base_salary"],
    actor: { uid: "u1", name: "Panuwat", role: "CEO" }, reason: "ปรับตามผลงาน", at: 1756000000000,
  });
  check("มีผู้กระทำ", e.actor_uid === "u1" && e.actor_name === "Panuwat" && e.actor_role === "CEO");
  check("มีเวลา", e.at === 1756000000000);
  check("มีเหตุผล", e.reason === "ปรับตามผลงาน");
  check("มีค่าเก่า→ใหม่", e.changes[0].from === 15000 && e.changes[0].to === 20000);
}

// ── 8. entity/id ที่ใช้ไม่ได้ต้องไม่สร้างแถวลอย ────────────────────────────
{
  check("ไม่มี entity = ไม่มีแถว", A.buildAuditEntry({ entityId: "e1", action: "updated" }) === null);
  check("ไม่มี id = ไม่มีแถว", A.buildAuditEntry({ entity: "employee", action: "updated" }) === null);
  check("ไม่มี action = ไม่มีแถว", A.buildAuditEntry({ entity: "employee", entityId: "e1" }) === null);
  check("path ของ entity ที่ใช้ไม่ได้เป็น null", A.auditPath("", "e1") === null);
}

// ── 9. ที่อยู่ต้องซ้อนใต้ entity (ไม่ต้องมี .indexOn) ───────────────────────
//
// เก็บแบน + query ด้วย orderByChild คือหนี้ที่ `employee_events` ติดอยู่ —
// ไม่มี index = RTDB อ่านทั้งโหนดมากรองเอง
{
  check("ที่อยู่ซ้อนใต้ entity/entityId", A.auditPath("employee", "e1") === "audit_log/employee/e1");
}

// ── 10. เพดานจำนวนการเปลี่ยนแปลงต่อแถว ─────────────────────────────────────
{
  const many = {};
  const fields = [];
  for (let i = 0; i < 60; i += 1) { fields.push(`f${i}`); many[`f${i}`] = i; }
  const e = A.buildAuditEntry({
    entity: "employee", entityId: "e1", action: "updated", before: {}, after: many, fields,
  });
  check("จำนวนการเปลี่ยนแปลงต่อแถวมีเพดาน", e.changes.length === A.MAX_CHANGES);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
