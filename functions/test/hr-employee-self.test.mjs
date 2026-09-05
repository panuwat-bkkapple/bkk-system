/**
 * ราวกันตกของเส้นทาง "ข้อมูลของฉัน" ในแอปพนักงาน
 *
 * เทสออฟไลน์ล้วน — ไม่ต้องมี Firebase ไม่ต้องมีคีย์ (รันด้วย
 * `node functions/test/hr-employee-self.test.mjs`; CI หยิบไปเองด้วย glob)
 *
 * **สิ่งที่ตรวจคือกติกาที่ไม่มี type ไหนบังคับ** — ด่านของ callable, การไม่รับ
 * employeeId จาก body, สลิปที่ยังไม่อนุมัติต้องไม่หลุด, และการนับวันลาครึ่งวัน
 *
 * ตาราง injection (วัดจริง 5 ก.ย. 2569 — ตัวเลขคือจำนวนข้อที่แดง):
 *   เพิ่ม "draft" เข้า VISIBLE_RUN_STATUSES                    -> แดง 1
 *   ให้ employeePayslipGet รับ employeeId จาก body             -> แดง 1 (หลังอุดรู)
 *   ถอด requireEmployeeCaller ออกจาก callable ตัวใดตัวหนึ่ง     -> แดง 1
 *   ใส่ signed_contract เข้า EMPLOYEE_UPLOAD_KINDS              -> แดง 1
 *   ใส่ warning เข้า SELF_VISIBLE_DOC_TYPES                     -> แดง 1
 *   ให้ countLeaveDays หักครึ่งวันโดยไม่ดูว่าวันนั้นถูกนับไหม     -> แดง 1
 *   ให้ใบวันเดียวที่ติดธงสองตัวหักเต็มวัน                         -> แดง 1
 *   ถอดการปัดทศนิยมของ splitPaidDays                            -> เขียว (ดูหมายเหตุ)
 *
 * **รูที่ injection จับได้ในตัวด่านเอง (5 ก.ย. 2569):** ข้อ "รับ employeeId จาก
 * body" รอบแรก **เขียว** เพราะ assert เขียนเป็น `/data\.employeeId/` แต่
 * injection เขียน `(request.data || {}).employeeId` ซึ่งข้างหน้าจุดเป็นวงเล็บปิด
 * — `git status` สะอาด จึงไม่ใช่เคสงานหาย แต่เป็นรูของด่านจริง แก้เป็น
 * "ไม่มีการอ่าน `.employeeId` เลย" ซึ่งตรงกับความจริงของไฟล์นี้ แล้วมันแดงทันที
 *
 * **หมายเหตุข้อที่เขียว และเขียวถูกแล้ว:** ค่าที่ใช้จริงมีแค่ .0 กับ .5 ซึ่งเก็บ
 * ใน binary ได้ตรง การปัดจึงไม่เปลี่ยนผลของ fixture ชุดไหนเลย — มันเป็นการกัน
 * เศษที่จะเกิดตอนบวกสะสมข้ามหลายใบในอนาคต ไม่ใช่ด่านของวันนี้ **บันทึกไว้ตรงๆ
 * ดีกว่าแต่ง fixture ให้ดูเหมือนมีด่าน**
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const fnDir = join(here, "..");

const self = require(join(fnDir, "hr-employee-self.js"));
const leave = require(join(fnDir, "hr-leave.js"));

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
};

// ── สลิปเงินเดือน ────────────────────────────────────────────────────────────

test("รอบร่างต้องไม่อยู่ในรายการที่พนักงานเห็นได้", () => {
  assert.ok(!self.VISIBLE_RUN_STATUSES.has("draft"),
    "รอบร่างยังถูกแก้ตัวเลขได้จนถึงวินาทีที่อนุมัติ ปล่อยให้เห็นแปลว่าพนักงานจำเลขที่ยังไม่ใช่เลขจริง");
  assert.ok(self.VISIBLE_RUN_STATUSES.has("approved"));
  assert.ok(self.VISIBLE_RUN_STATUSES.has("paid"));
});

test("สลิปที่ส่งออกเป็น allowlist ไม่ใช่ทั้งแถว", () => {
  const out = self.payslipFull("2569-08", { status: "paid", pay_date: 1 }, {
    net: 100, gross: 120, earnings: [{ label: "เงินเดือน", amount: 120, secret: "x" }],
    deductions: [], name: "ก", employee_code: "E1",
    // สามอย่างนี้ต้องไม่หลุดออกไป
    note: "หมายเหตุภายในของ HR",
    wht_override: { by_staff_id: "S9", reason: "ปรับตามคำสั่ง" },
    warnings: ["ยังไม่ขึ้นทะเบียน ปกส."],
  });
  const json = JSON.stringify(out);
  assert.ok(!json.includes("หมายเหตุภายในของ HR"), "หมายเหตุภายในของ HR หลุด");
  assert.ok(!json.includes("S9"), "staff id ของคนที่แก้ภาษีหลุด");
  assert.ok(!json.includes("ปกส."), "คำเตือนที่พนักงานแก้ไม่ได้หลุด");
  assert.ok(!json.includes('"secret"'), "ฟิลด์แปลกปลอมในรายการรายได้หลุด");
  assert.equal(out.net, 100);
});

test("prevMonth เดินข้ามปีถูก", () => {
  assert.equal(self.prevMonth("2569-01"), "2568-12");
  assert.equal(self.prevMonth("2569-09"), "2569-08");
});

// ── แฟ้มเอกสาร ───────────────────────────────────────────────────────────────

test("สัญญาที่ลงนามแล้ว พนักงานอัปโหลดเองไม่ได้", () => {
  assert.ok(!self.EMPLOYEE_UPLOAD_KINDS.has("signed_contract"),
    "ฉบับที่ใช้ยันกันตอนมีข้อพิพาทต้องมาจากมือ HR ไม่ใช่จากการอัปโหลดของฝ่ายเดียว");
  assert.ok(self.EMPLOYEE_UPLOAD_KINDS.has("id_card"));
});

test("หนังสือเตือนไม่อยู่ในเอกสารที่เปิดดูเองได้", () => {
  assert.ok(!self.SELF_VISIBLE_DOC_TYPES.has("warning"),
    "การรู้ว่าถูกออกหนังสือเตือนจากแอปก่อนหัวหน้าได้คุยด้วย เป็นการส่งข่าวที่ระบบไม่ควรทำ");
  assert.ok(self.SELF_VISIBLE_DOC_TYPES.has("contract"));
});

// ── ด่านของ callable ทุกตัว ──────────────────────────────────────────────────

/** ตัด body ของ callable ตัวหนึ่งออกมา โดยตัดที่ callable ตัวถัดไป
 *  (หน้าต่างความยาวคงที่เคยทำให้ด่านของตัวถัดไปทำให้ตัวที่ไม่มีด่านผ่าน) */
function callableBodies(src) {
  const out = {};
  const re = /const (\w+) = onCall\(/g;
  const marks = [...src.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    out[m.name] = src.slice(m.at, end);
  });
  return out;
}

test("ทุก callable ของเส้นทางนี้มีด่านตัวตน และไม่รับ employeeId จาก body", () => {
  const src = readFileSync(join(fnDir, "hr-employee-self.js"), "utf8");
  const bodies = callableBodies(src);
  const names = Object.keys(bodies);
  assert.ok(names.length >= 8, `เจอ callable แค่ ${names.length} ตัว`);
  for (const [name, body] of Object.entries(bodies)) {
    assert.ok(body.includes("requireEmployeeCaller"), `${name} ไม่มีด่านตัวตน`);
    // **เขียนเป็น "ไม่มีการอ่านฟิลด์นี้เลย" ไม่ใช่ไล่จับรูปที่นึกออก** — รอบแรก
    // เขียนเป็น /data\.employeeId/ แล้ว injection ที่เขียน
    // `(request.data || {}).employeeId` **ลอดผ่านไปได้** เพราะข้างหน้าจุดเป็น
    // วงเล็บปิด ไม่ใช่คำว่า data. โค้ดจริงของไฟล์นี้ไม่เคยอ่าน `.employeeId`
    // จากอะไรเลย (ตัวตนมาจาก token เสมอ) การห้ามทั้งรูปจึงตรงกับความจริง
    // และไม่มีทางลอดด้วยการเปลี่ยนวิธีเขียน
    assert.ok(!/\.employeeId\b/.test(body),
      `${name} อ่าน employeeId จากอินพุต — id ที่ผู้เรียกระบุเองได้ = สลิปของเพื่อนร่วมงาน`);
  }
});

/**
 * เมธอดเขียนที่ห้อยอยู่กับ `db.ref(...)` เท่านั้น
 *
 * **เขียนแบบนี้เพราะรอบแรกเขียนผิด** — `/\.(set|update|remove|push)\(/` ไล่จับ
 * ทั้งไฟล์ แล้วไปโดน `days.push(...)` ซึ่งเป็นอาร์เรย์ธรรมดา ทำให้เทสแดงทั้งที่
 * โค้ดถูก (บทเรียน P3-c: regex ของเทสโครงสร้างโกหกได้ — ทางแก้คือรัดขอบเขต
 * ไม่ใช่ผ่อน assert ให้ผ่าน) จึงตามโซ่จาก `db.ref(` ถึงจบ statement แทน
 */
function rtdbWrites(body) {
  const out = [];
  for (const m of body.matchAll(/db\.ref\(/g)) {
    const chain = body.slice(m.index, body.indexOf(";", m.index) + 1);
    const w = /\.(set|update|remove|push|transaction)\(/.exec(chain);
    if (w) out.push(w[1]);
  }
  return out;
}

test("callable ของเส้นทางนี้อ่านอย่างเดียว ยกเว้นตัวอัปโหลดที่ตั้งใจให้เขียน", () => {
  const src = readFileSync(join(fnDir, "hr-employee-self.js"), "utf8");
  const bodies = callableBodies(src);
  let checked = 0;
  for (const [name, body] of Object.entries(bodies)) {
    if (name === "employeeFileUpload") continue;
    checked += 1;
    assert.deepEqual(rtdbWrites(body), [],
      `${name} เขียน RTDB ทั้งที่ควรอ่านอย่างเดียว`);
  }
  assert.ok(checked >= 7, `ตรวจแค่ ${checked} ตัว — น่าจะตัด body ผิด`);
  // และตัวที่ตั้งใจให้เขียน ต้องเขียนจริง ไม่งั้นข้อยกเว้นนี้คือข้อยกเว้นที่ว่าง
  assert.ok(rtdbWrites(bodies.employeeFileUpload).length > 0,
    "employeeFileUpload ไม่ได้เขียนอะไรเลย — ข้อยกเว้นนี้ไปไม่ถึง");
});

// ── ลาครึ่งวัน ───────────────────────────────────────────────────────────────

const CAL = { closedDays: new Set([0]), holidays: new Set(["2569-09-10"]) };
const days = (o) => leave.countLeaveDays({ counts: "working_days", calendar: CAL, ...o });

test("ครึ่งวันหักได้เฉพาะวันที่ถูกนับอยู่แล้ว", () => {
  // 2569-09-07 จันทร์ ถึง 09-09 พุธ = 3 วันทำงาน
  assert.equal(days({ from: "2569-09-07", to: "2569-09-09" }), 3);
  assert.equal(days({ from: "2569-09-07", to: "2569-09-09", halfStart: true }), 2.5);
  assert.equal(days({ from: "2569-09-07", to: "2569-09-09", halfStart: true, halfEnd: true }), 2);
});

test("ครึ่งวันบนวันที่ไม่ถูกนับ ไม่ทำให้ยอดติดลบ", () => {
  // 09-10 เป็นวันหยุดประกาศ — ลาช่วง 09-10..09-11 นับได้ 1 วัน (เฉพาะ 09-11)
  const base = days({ from: "2569-09-10", to: "2569-09-11" });
  assert.equal(base, 1);
  // ธงวันแรกตกบนวันหยุด จึงไม่มีอะไรให้หัก
  assert.equal(days({ from: "2569-09-10", to: "2569-09-11", halfStart: true }), 1);
  // ธงวันท้ายตกบนวันทำงาน หักได้
  assert.equal(days({ from: "2569-09-10", to: "2569-09-11", halfEnd: true }), 0.5);
});

test("ใบวันเดียวที่ติดธงสองตัว หักครึ่งวันครั้งเดียว", () => {
  assert.equal(days({ from: "2569-09-07", to: "2569-09-07" }), 1);
  assert.equal(days({ from: "2569-09-07", to: "2569-09-07", halfStart: true }), 0.5);
  assert.equal(
    days({ from: "2569-09-07", to: "2569-09-07", halfStart: true, halfEnd: true }),
    0.5,
    "ธงสองตัวของใบวันเดียวหมายถึงวันเดียวกัน หักสองครั้งคือลาศูนย์วัน",
  );
});

test("ลาครึ่งวันล้วนต้องยื่นได้ ไม่ถูกปฏิเสธว่าไม่มีวันทำงาน", () => {
  const v = leave.validateLeaveRequest({
    employee: { id: "E1", hired_at: 0 },
    draft: { type: "personal", from: "2569-09-07", to: "2569-09-07", half_start: true },
    requests: [], overrides: {}, calendar: CAL, asOf: Date.parse("2026-09-05"),
  });
  assert.ok(v.ok, `ควรยื่นได้: ${(v.errors || []).join(" · ")}`);
  assert.equal(v.days, 0.5);
  assert.equal(v.half_start, true);
});

console.log(`hr-employee-self: ผ่าน ${passed} ข้อ`);
