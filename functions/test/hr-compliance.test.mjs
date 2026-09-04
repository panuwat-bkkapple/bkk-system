// =============================================================================
// ความพร้อมก่อนจ่ายเงินเดือน — ปกส. 30 วัน + เลขบัญชี
//   node functions/test/hr-compliance.test.mjs
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//
//   | ทำลายอะไร                                                  | ผล |
//   |------------------------------------------------------------|----|
//   | `unknown` (ไม่มีวันเริ่มงาน) ตอบเป็น `ok`                     | แดง 2 |
//   | ขอบเขต 30 วันเลื่อนไปหนึ่งวัน (`daysLeft < 0` → `<= 0`)       | แดง 2 |
//   | เดา pay_method จากการมีเลขบัญชี (ย้อนพฤติกรรมเดิม)            | แดง 3 |
//   | `pay_method` ที่อ่านไม่ออกตกเป็น `cash`                       | แดง 1 |
//   | `overdue` ไปอยู่ช่อง blocking แทน warnings                    | แดง 2 |
//   | ฟรีแลนซ์ถูกนับว่าต้องขึ้นทะเบียน                              | แดง 1 |
//   | คนพ้นสภาพยังถูกทวง                                          | แดง 1 |
//   | ถอด `warned` ออกจากสรุปรอบ                                   | แดง 1 |
//   | probe `sso_registration` หายไปจาก buildProbes                | แดง 1 |
//
// **ข้อที่ไม่มีอะไรจับได้ และบันทึกไว้ตรงๆ:** `SSO_WARN_LEAD_DAYS` (7) เปลี่ยน
// เป็นเลขอื่นแล้วมีแต่เทสที่อ้างค่านั้นเองที่แดง — มันคือ **นโยบายว่าจะเตือน
// ล่วงหน้ากี่วัน** ไม่ใช่ตัวเลขที่กฎหมายกำหนด (30 ต่างหากที่กฎหมายกำหนด และมี
// เทสตรึงขอบเขตไว้จริง) เทสจึงตรึงแค่ความสัมพันธ์: ต้องมากกว่า 0 และน้อยกว่า 30
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, "..");

const C = require(join(FUNCTIONS, "hr-compliance.js"));
const P = require(join(FUNCTIONS, "hr-payroll.js"));

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 4, 5, 0, 0);
const hiredDaysAgo = (d) => NOW - d * DAY;
const emp = (over = {}) => ({
  id: "e1", name: "สมชาย", employment_type: "monthly", status: "active",
  hired_at: hiredDaysAgo(3), ...over,
});

// ── 1. ขอบเขต 30 วันตาม ม.34 ───────────────────────────────────────────────
//
// วันเริ่มงานนับเป็นวันที่ 1 (รูปเดียวกับที่เอกสารบุคคลนับวันครบทดลองงาน)
// **ขอบเขตนี้มีผลทางกฎหมาย** — คลาดไปหนึ่งวันคือรายงานว่าเลยกำหนดทั้งที่ยัง
// ไม่เลย (หรือแย่กว่า: บอกว่ายังไม่เลยทั้งที่เลยไปแล้ว)
{
  const st = (d) => C.ssoRegistrationState({ employee: emp({ hired_at: hiredDaysAgo(d) }), priv: {}, now: NOW });
  check("เข้าทำงานวันนี้ = ยังอยู่ในกำหนด", st(0).state === "pending");
  check("วันที่ 30 (เข้าทำงานมา 29 วัน) ยังไม่เลยกำหนด", st(29).state === "due_soon");
  check("วันที่ 30 เหลือ 0 วัน", st(29).daysLeft === 0);
  check("วันที่ 31 = เลยกำหนดแล้ว", st(30).state === "overdue");
  check("เลยมานาน = ยังเป็น overdue และนับวันถูก", st(60).state === "overdue" && st(60).daysLeft === -31);
  check("ช่วงเตือนล่วงหน้าเริ่มที่เหลือ 7 วัน", st(22).state === "due_soon" && st(22).daysLeft === 7);
  check("ก่อนหน้านั้นยังเงียบ", st(21).state === "pending");
  check("เตือนล่วงหน้าต้องอยู่ระหว่าง 0 กับกำหนดจริง",
    C.SSO_WARN_LEAD_DAYS > 0 && C.SSO_WARN_LEAD_DAYS < C.SSO_REGISTER_DAYS);
  check("กำหนดตามกฎหมายคือ 30 วัน", C.SSO_REGISTER_DAYS === 30);
}

// ── 2. ใครไม่ต้องขึ้นทะเบียน ────────────────────────────────────────────────
{
  const st = (e, p = {}) => C.ssoRegistrationState({ employee: e, priv: p, now: NOW }).state;
  check("มีเลขผู้ประกันตนแล้ว = ok",
    st(emp({ hired_at: hiredDaysAgo(500) }), { social_security_no: "1234567890" }) === "ok");
  check("ฟรีแลนซ์ไม่อยู่ ม.33 = ไม่ต้องขึ้นทะเบียน",
    st(emp({ employment_type: "freelance", hired_at: hiredDaysAgo(500) })) === "not_required");
  check("ลาออกแล้วไม่ต้องทวง",
    st(emp({ status: "resigned", hired_at: hiredDaysAgo(500) })) === "not_required");
  check("พ้นสภาพแล้วไม่ต้องทวง",
    st(emp({ status: "terminated", hired_at: hiredDaysAgo(500) })) === "not_required");
  check("รายวันอยู่ใน ม.33 เหมือนรายเดือน",
    st(emp({ employment_type: "daily", hired_at: hiredDaysAgo(500) })) === "overdue");
}

// ── 3. ไม่มีวันเริ่มงาน = unknown ไม่ใช่ ok ─────────────────────────────────
//
// คนที่ไม่มีวันเริ่มงานในระบบอาจเข้าทำงานมาแล้วครึ่งปี การตอบว่า `ok` คือการ
// เดาไปทางที่สบายกว่าแล้วเงียบให้เขาตลอดไป
{
  for (const bad of [null, undefined, 0, "", "อะไรสักอย่าง"]) {
    const s = C.ssoRegistrationState({ employee: emp({ hired_at: bad }), priv: {}, now: NOW });
    check(`hired_at = ${JSON.stringify(bad)} → unknown`, s.state === "unknown");
  }
  check("unknown มีคำอธิบายติดมาด้วย",
    Boolean(C.ssoStateMessage(C.ssoRegistrationState({ employee: emp({ hired_at: 0 }), priv: {}, now: NOW }))));
}

// ── 4. ข้อความ ─────────────────────────────────────────────────────────────
{
  const msg = (d) => C.ssoStateMessage(
    C.ssoRegistrationState({ employee: emp({ hired_at: hiredDaysAgo(d) }), priv: {}, now: NOW }),
  );
  check("เลยกำหนดแล้วบอกจำนวนวันที่เลยมา", /เลยกำหนด.*10 วัน/.test(msg(39) || ""));
  check("ใกล้ครบบอกจำนวนวันที่เหลือ", /ภายในอีก 3 วัน/.test(msg(26) || ""));
  check("ยังอยู่ในกำหนดไม่มีข้อความ", msg(1) === null);
  check("ขึ้นทะเบียนแล้วไม่มีข้อความ",
    C.ssoStateMessage(C.ssoRegistrationState({ employee: emp(), priv: { social_security_no: "x" }, now: NOW })) === null);
}

// ── 5. ช่องทางจ่ายเป็นการประกาศ ไม่ใช่การเดา ────────────────────────────────
//
// ของเดิมอ่านว่า "ไม่มีเลขบัญชี = เงินสด" ทำให้คนที่ควรได้รับโอนแต่ข้อมูลยังไม่
// ครบ ตกไปอยู่ถังเงินสดเงียบๆ แล้วยอดในสรุปก็ดูสมเหตุสมผลทุกประการ
{
  check("ไม่ระบุ = โอน (ไม่ใช่เงินสด)", C.payMethodOf({ pay: {} }) === "transfer");
  check("ไม่มี pay เลย = โอน", C.payMethodOf({}) === "transfer");
  check("ระบุเงินสด = เงินสด", C.payMethodOf({ pay: { pay_method: "cash" } }) === "cash");
  check("ค่าที่อ่านไม่ออกตกเป็นโอน ไม่ใช่เงินสด",
    C.payMethodOf({ pay: { pay_method: "อะไรสักอย่าง" } }) === "transfer");
  check("มีเลขบัญชีแต่ประกาศว่าเงินสด = เงินสด",
    C.payMethodOf({ pay: { pay_method: "cash" }, bank: { account: "1234567890" } }) === "cash");
}

// ── 6. blocking กับ warnings แยกช่องกันโดยตั้งใจ ───────────────────────────
//
// ปนกันเมื่อไหร่จะเหลือแค่ "บล็อกเกินจนคนหาทางข้าม" กับ "เตือนแล้วไม่มีใครอ่าน"
{
  const r = (priv, e = emp()) => C.payrollReadiness({ employee: e, priv, now: NOW });

  const noBank = r({ pay: {} });
  check("ไม่มีเลขบัญชี + ตั้งเป็นโอน = บล็อก", Boolean(noBank.blocking));
  check("ข้อความบอกทางออกทั้งสองทาง",
    /เลขบัญชี/.test(noBank.blocking) && /เงินสด/.test(noBank.blocking));

  check("ประกาศว่ารับเงินสด = ไม่บล็อกแม้ไม่มีเลขบัญชี",
    r({ pay: { pay_method: "cash" } }).blocking === null);
  check("มีเลขบัญชี = ไม่บล็อก", r({ bank: { account: "1234567890" } }).blocking === null);
  check("เลขบัญชีที่มีแต่ขีดกับช่องว่าง ไม่นับว่ามี",
    Boolean(r({ bank: { account: " - - " } }).blocking));

  // **ปกส. เลยกำหนดต้องไม่บล็อก** — การหักเงินสมทบตั้งแต่เดือนแรกถูกต้องอยู่แล้ว
  // ถ้าบล็อก ทั้งบริษัทจะจ่ายเงินเดือนไม่ได้เพราะคนใหม่หนึ่งคน
  const late = r({ bank: { account: "1" } }, emp({ hired_at: hiredDaysAgo(200) }));
  check("ปกส. เลยกำหนด = เตือน ไม่บล็อก", late.blocking === null && late.warnings.length === 1);
  check("คำเตือนบอกว่าเลยกำหนดมากี่วัน", /เลยกำหนด/.test(late.warnings[0]));

  check("ปกส. ใกล้ครบกำหนด ยังไม่ขึ้นเป็นคำเตือนบนรอบจ่าย",
    r({ bank: { account: "1" } }, emp({ hired_at: hiredDaysAgo(26) })).warnings.length === 0);
  check("ไม่มีวันเริ่มงาน = เตือนบนรอบจ่ายด้วย",
    r({ bank: { account: "1" } }, emp({ hired_at: 0 })).warnings.length === 1);
  check("ทุกอย่างครบ = เงียบ",
    r({ bank: { account: "1" }, social_security_no: "x" }).warnings.length === 0);
}

// ── 7. ต่อเข้ารอบจ่ายจริง ──────────────────────────────────────────────────
{
  const cfg = P.resolvePayrollConfig({});
  const period = { from: NOW - 30 * DAY, to: NOW };
  const item = (priv, e = emp()) =>
    P.buildPayrollItem({ employee: e, priv, config: cfg, period, input: {} });

  const noBank = item({ pay: { base_salary: 20000 } });
  check("รอบจ่าย: ไม่มีเลขบัญชี = incomplete (กันการอนุมัติ)", Boolean(noBank.incomplete));
  check("รอบจ่าย: ยังรายงานช่องทางเป็นโอน ไม่ใช่เงินสด", noBank.pay_method === "transfer");

  check("รอบจ่าย: ประกาศเงินสดแล้วผ่าน",
    item({ pay: { base_salary: 20000, pay_method: "cash" } }).incomplete === null);

  // ข้อความเรื่องเงินต้องชนะข้อความเรื่องบัญชี — ยอดที่คิดไม่ได้เป็นปัญหาที่ใหญ่กว่า
  const noSalary = item({ pay: {} });
  check("รอบจ่าย: ไม่ได้ตั้งเงินเดือนชนะข้อความเรื่องบัญชี",
    /เงินเดือน/.test(noSalary.incomplete || ""));

  const late = item({ pay: { base_salary: 20000 }, bank: { account: "1" } }, emp({ hired_at: hiredDaysAgo(200) }));
  check("รอบจ่าย: ปกส. เลยกำหนดขึ้นเป็น warnings ไม่ใช่ incomplete",
    late.incomplete === null && late.warnings.length === 1);

  const sum = P.summarizeRun([late, item({ pay: { base_salary: 1 }, bank: { account: "1" }, social_security_no: "x" })]);
  check("สรุปรอบนับคนที่ต้องตาม", sum.warned === 1);
  check("สรุปรอบยังนับคนที่กรอกไม่ครบเหมือนเดิม", sum.incomplete === 0);
  check("ยอดโอนไม่หลุดไปถังเงินสด", sum.cash === 0 && sum.transfer > 0);

  check("ฟรีแลนซ์ยังถูกข้ามเหมือนเดิม",
    item({ pay: { base_salary: 1 } }, emp({ employment_type: "freelance" })).skipped === "freelance");
}

// ── 8. ต่อสายครบ ───────────────────────────────────────────────────────────
//
// กฎอยู่ที่เดียว แต่ต้องมี **คนอ่านสามคน** ถึงจะมีประโยชน์: รอบจ่าย (เตือน),
// ทะเบียนพนักงาน (ป้าย), และ /system-health (push เมื่อเลยกำหนด)
{
  const src = (f) => readFileSync(join(FUNCTIONS, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  const health = src("health-check.js");
  check("probe sso_registration อยู่ใน buildProbes", /id: "sso_registration"/.test(health));
  check("probe เรียกกฎกลาง ไม่ได้เขียนกฎเอง", /ssoRegistrationState\(/.test(health));
  check("เลยกำหนด = fail (จะได้ push ออกไป)", /status: "fail",\s*\n?\s*message: `เลยกำหนดยื่น/.test(health));
  check("ข้อความแจ้งเตือนใช้รหัสพนักงาน ไม่ใช่ชื่อ (PDPA)",
    /employee_code\) \|\| id/.test(health) && !/e\.name/.test(health.slice(health.indexOf('id: "sso_registration"'), health.indexOf('id: "anthropic"'))));

  const hr = src("hr.js");
  check("ทะเบียนพนักงานส่งสถานะ ปกส. กลับไปให้หน้าเว็บ", /sso: \{ state: sso\.state/.test(hr));
  check("ทะเบียนใช้กฎกลาง ไม่ได้คิดเอง", /ssoRegistrationState\(/.test(hr));

  const payroll = src("hr-payroll.js");
  check("รอบจ่ายเรียก payrollReadiness", /payrollReadiness\(\{/.test(payroll));
  check("รอบจ่ายไม่เดา pay_method จากเลขบัญชีอีกแล้ว",
    !/account \? "transfer" : "cash"/.test(payroll));
}

console.log("");
if (failures.length) {
  console.log(`FAILED ${failures.length}:`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log(`ALL PASS (${passed} passed)`);
