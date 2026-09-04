// =============================================================================
// การลา — การนับวัน สิทธิ์ และการแยกวันที่ได้ค่าจ้างออกจากวันที่ไม่ได้
//   node functions/test/hr-leave.test.mjs
//
// เทสชุดนี้เขียนจาก **ขอบเขตที่มีผลทางกฎหมาย** เป็นหลัก ไม่ใช่จากรูปของ API
// เพราะสิ่งที่ผิดแล้วแพงที่สุดในไฟล์นี้คือตัวเลขวันที่ไปโผล่บนสลิปเงินเดือน
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//
//   | ทำลายอะไร                                                    | ผล |
//   |--------------------------------------------------------------|----|
//   | นับวันลาเป็นวันปฏิทินหมด (ไม่สนวันหยุดร้าน)                     | แดง 4 |
//   | ลาคลอดถูกตั้งให้นับวันทำงาน (ขัด ม.41 ที่ให้รวมวันหยุด)          | แดง 2 |
//   | `countLeaveDays` คืน 0 แทน null เมื่ออินพุตเสีย                 | แดง 2 |
//   | `dayNumber` ยอมรับวันที่ที่ไม่มีจริง (31 ก.พ.)                   | แดง 1 |
//   | เพดาน 30 วันของลาป่วยกลายเป็นเพดาน**การลา** ไม่ใช่ของค่าจ้าง     | แดง 1 |
//   | `annualEligibility` ตอบ `too_new` เมื่อไม่มีวันเริ่มงาน          | แดง 4 |
//   | ขอบเขตครบ 1 ปีเลื่อนไปหนึ่งวัน (`>= 1` → `> 1`)                  | แดง 1 |
//   | ใบที่ปฏิเสธ/ยกเลิกยังกินสิทธิ์                                   | แดง 5 |
//   | การทับซ้อนเป็นคำเตือนแทนการปฏิเสธ                               | แดง 2 |
//   | ยอมให้ใบลาคร่อมปี                                              | แดง 1 |
//   | `policyWarnings` เงียบเมื่อตั้งสิทธิ์ต่ำกว่าขั้นต่ำ               | แดง 2 |
//   | `unpaidLeaveInPeriod` นับใบที่ยังไม่อนุมัติ                      | แดง 1 |
//   | `splitPaidDays` ไม่หักสิทธิ์ที่ใช้ไปแล้ว                          | แดง 3 |
//
// **ตัวเลขข้างบนเป็นค่าที่วัดจริง ไม่ใช่ที่คาดไว้** — และแถวที่สองเคยเป็น
// **แดง 0** ตอนรันรอบแรก: เทสลาคลอดเดิมเรียก `countLeaveDays` แล้ว*สั่ง*โหมด
// `calendar_days` ไปเอง จึงพิสูจน์ว่าตัวนับทำงานถูก แต่ไม่ได้พิสูจน์เลยว่า
// **ลาคลอดถูกตั้งค่าให้ใช้โหมดนั้น** ซึ่งเป็นสิ่งที่ ม.41 บังคับ
// (กับดักข้อ 2 ใน CLAUDE.md — เทสที่เห็นด้วยกับตัวเอง) แก้โดยเพิ่มเทสที่เดิน
// ผ่าน `leaveTypeById` กับ `validateLeaveRequest` จริง
//
// **ข้อที่ไม่มีอะไรจับได้ และบันทึกไว้ตรงๆ:** `MAX_SPAN_DAYS` (366) เปลี่ยนเป็น
// เลขอื่นแล้วมีแต่เทสที่อ้างค่านั้นเองที่แดง — มันคือกันวนลูปยาวเกินเหตุ
// ไม่ใช่กฎของโดเมน (กฎ "ห้ามคร่อมปี" ทำงานก่อนมันเสมอในทางปฏิบัติ) จึงตรึงแค่
// ความสัมพันธ์: ต้องมากกว่าหนึ่งปีปฏิทิน ไม่งั้นมันจะไปตัดใบที่ถูกกฎหมายทิ้ง
// =============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const L = require(join(HERE, "..", "hr-leave.js"));

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 4);
const yearsAgo = (y) => NOW - Math.round(y * 365.25 * DAY);

// ปฏิทินจริงของร้าน: หยุดอาทิตย์ + วันหยุดประกาศ 7 ก.ย. 2026 (จันทร์)
const CAL = L.normalizeCalendar({ closedDays: [0], holidays: ["2026-09-07"] });

const emp = (over = {}) => ({ id: "e1", name: "สมชาย", hired_at: yearsAgo(3), ...over });

// ── 1. การนับวัน ต้องเคารพปฏิทินร้าน ───────────────────────────────────────
//
// วันลาที่ตกวันหยุดร้านไม่ใช่วันลา — ถ้านับรวม พนักงานจะเสียสิทธิ์ให้กับวันที่
// เขาไม่ต้องมาทำงานอยู่แล้ว ซึ่งกินสิทธิ์ที่กฎหมายให้ไว้จริงๆ
{
  const wd = (from, to) => L.countLeaveDays({ from, to, counts: "working_days", calendar: CAL });
  // ศ.4 ก.ย. ถึง พฤ.10 ก.ย. = 7 วันปฏิทิน หัก อา.6 กับวันหยุด จ.7 = 5
  check("นับวันทำงานโดยข้ามวันหยุดประจำสัปดาห์และวันหยุดประกาศ", wd("2026-09-04", "2026-09-10") === 5);
  check("ลาวันเดียวที่เป็นวันทำงาน = 1", wd("2026-09-04", "2026-09-04") === 1);
  check("ลาวันเดียวที่ตรงวันหยุดประกาศ = 0", wd("2026-09-07", "2026-09-07") === 0);
  check("ลาวันเดียวที่ตรงวันอาทิตย์ = 0", wd("2026-09-06", "2026-09-06") === 0);

  const cd = (from, to) => L.countLeaveDays({ from, to, counts: "calendar_days", calendar: CAL });
  // **ม.41 ให้นับลาคลอด "รวมวันหยุด"** — ต่างจากการลาชนิดอื่นโดยกฎหมาย
  check("ตัวนับรองรับโหมดวันปฏิทิน", cd("2026-09-04", "2026-09-10") === 7);

  // ข้อบนพิสูจน์แค่ว่า *ตัวนับ* ทำงานถูกเมื่อสั่งโหมดมาให้ ไม่ได้พิสูจน์ว่า
  // **ลาคลอดถูกตั้งให้ใช้โหมดนั้น** — injection ที่เปลี่ยน counts ของลาคลอด
  // เป็น working_days ผ่านฉลุยจนกระทั่งเพิ่มสองข้อล่างนี้ (กับดักข้อ 2 ใน
  // CLAUDE.md: เทสที่เห็นด้วยกับตัวเอง เพราะมันตกที่ชั้นที่เราสั่งเอง)
  check("ชนิด 'ลาคลอด' ถูกตั้งให้นับวันปฏิทิน (ม.41)", L.leaveTypeById("maternity").counts === "calendar_days");
  const matThroughType = L.validateLeaveRequest({
    employee: emp(), draft: { type: "maternity", from: "2026-09-04", to: "2026-09-10" },
    requests: [], overrides: {}, calendar: CAL, asOf: NOW,
  });
  check("ยื่นใบลาคลอดผ่านเส้นทางจริงได้ 7 วัน ไม่ใช่ 5", matThroughType.days === 7);

  // และชนิดอื่นต้องไม่พลอยกลายเป็นวันปฏิทินตามไปด้วย
  check("ลาป่วยยังนับวันทำงาน", L.leaveTypeById("sick").counts === "working_days");
}

// ── 2. อินพุตเสียต้องเป็น null ไม่ใช่ 0 ────────────────────────────────────
//
// 0 อ่านว่า "ลาศูนย์วัน" ซึ่งผ่านการตรวจชั้นถัดไปได้และกลายเป็นใบลาที่ไม่มีวัน
// ส่วน null บังคับให้คนเรียกจัดการ
{
  const bad = (from, to) => L.countLeaveDays({ from, to, counts: "working_days", calendar: CAL });
  check("วันสิ้นสุดอยู่ก่อนวันเริ่ม = null", bad("2026-09-10", "2026-09-04") === null);
  check("รูปวันที่ผิด = null", bad("4 ก.ย. 2026", "2026-09-10") === null);
  check("วันที่ที่ไม่มีจริงถูกปฏิเสธ ไม่ถูกม้วนไปวันอื่น", L.dayNumber("2026-02-31") === null);
  check("วันที่ปกติอ่านได้", L.dayNumber("2026-09-04") !== null);
  check("ช่วงยาวเกินเพดานกันวนลูป = null", bad("2026-01-01", "2027-12-31") === null);
}

// ── 3. เพดาน 30 วันของลาป่วยเป็นของ "ค่าจ้าง" ไม่ใช่ของ "การลา" ────────────
//
// ม.32 ให้ลาป่วยได้เท่าที่ป่วยจริง ไม่มีเพดาน · ม.57 บอกว่านายจ้างจ่ายไม่เกิน
// 30 วันทำงาน **เอา 30 ไปเป็นเพดานการลาเมื่อไหร่ = บังคับให้คนป่วยมาทำงาน**
{
  const sick = L.leaveTypeById("sick");
  check("ลาป่วยไม่มีเพดานจำนวนวันที่ลาได้", sick.capped === false);
  const s = L.splitPaidDays({ type: sick, days: 35, usedPaid: 0 });
  check("ลาป่วย 35 วัน: จ่าย 30 ไม่จ่าย 5", s.paid === 30 && s.unpaid === 5);
  const s2 = L.splitPaidDays({ type: sick, days: 5, usedPaid: 28 });
  check("ใช้สิทธิ์ไปแล้ว 28 ลาอีก 5: จ่าย 2 ไม่จ่าย 3", s2.paid === 2 && s2.unpaid === 3);
  const s3 = L.splitPaidDays({ type: sick, days: 3, usedPaid: 30 });
  check("สิทธิ์หมดแล้ว ลาได้แต่ไม่ได้เงินทั้งหมด", s3.paid === 0 && s3.unpaid === 3);

  // ลาทำหมัน (ม.33/ม.57 วรรคสอง) ไม่มีตัวเลขในกฎหมาย = จ่ายตามที่ลาจริง
  const ster = L.splitPaidDays({ type: L.leaveTypeById("sterilization"), days: 9, usedPaid: 0 });
  check("ลาทำหมันจ่ายตามที่แพทย์กำหนด ไม่มีเพดาน", ster.paid === 9 && ster.unpaid === 0);
}

// ── 4. ลาพักร้อน: ครบ 1 ปีก่อน และ "ไม่รู้" ต้องไม่กลายเป็น "ไม่มีสิทธิ์" ──
//
// คนที่ไม่มี `hired_at` ในระบบอาจทำงานมาสามปีแล้ว การตอบว่ายังไม่มีสิทธิ์
// คือการปฏิเสธสิทธิ์ตามกฎหมายเพราะข้อมูลของ *เรา* ไม่ครบ
{
  check("ไม่มีวันเริ่มงาน = unknown", L.annualEligibility(null, NOW).state === "unknown");
  check("วันเริ่มงานเป็น 0 = unknown", L.annualEligibility(0, NOW).state === "unknown");
  check("ทำงานครบ 1 ปีพอดี = มีสิทธิ์", L.annualEligibility(yearsAgo(1), NOW).state === "eligible");
  check("ทำงาน 364 วัน = ยังไม่ครบ", L.annualEligibility(NOW - 364 * DAY, NOW).state === "too_new");
  check("ทำงาน 3 ปี = มีสิทธิ์", L.annualEligibility(yearsAgo(3), NOW).state === "eligible");
}

// ── 5. สิทธิ์ที่ตั้งต่ำกว่ากฎหมายต้องดัง ────────────────────────────────────
{
  check("ค่าตั้งต้นไม่มีคำเตือน", L.policyWarnings({}).length === 0);
  const w = L.policyWarnings({ personal: { paid_days: 1 } });
  check("ลากิจ 1 วัน ต่ำกว่าขั้นต่ำ 3 วัน = เตือน (ม.34)", w.length === 1 && w[0].type === "personal");
  const w2 = L.policyWarnings({ annual: { paid_days: 3 }, sick: { paid_days: 10 } });
  check("เตือนได้หลายชนิดพร้อมกัน", w2.length === 2);
  const w3 = L.policyWarnings({ annual: { paid_days: 15 } });
  check("ให้มากกว่ากฎหมายไม่ใช่ความผิด", w3.length === 0);
}

// ── 6. ยอดคงเหลือ: ใบที่ปฏิเสธ/ยกเลิกต้องคืนสิทธิ์ ──────────────────────────
{
  const reqs = [
    { id: "r1", employee_id: "e1", type: "personal", status: "approved", from: "2026-02-02", to: "2026-02-03", days: 2, paid_days: 2, unpaid_days: 0 },
    { id: "r2", employee_id: "e1", type: "personal", status: "rejected", from: "2026-03-02", to: "2026-03-03", days: 2, paid_days: 2, unpaid_days: 0 },
    { id: "r3", employee_id: "e1", type: "personal", status: "cancelled", from: "2026-04-02", to: "2026-04-02", days: 1, paid_days: 1, unpaid_days: 0 },
    { id: "r4", employee_id: "e2", type: "personal", status: "approved", from: "2026-05-04", to: "2026-05-04", days: 1, paid_days: 1, unpaid_days: 0 },
  ];
  const bal = L.leaveBalances({ employee: emp(), requests: reqs, overrides: {}, year: "2026", asOf: NOW });
  const personal = bal.find((b) => b.type === "personal");
  check("นับเฉพาะใบที่อนุมัติ/รออนุมัติ", personal.used_paid_days === 2);
  check("เหลือ 1 วันจากสิทธิ์ 3 วัน", personal.remaining_paid_days === 1);
  check("ใบของพนักงานคนอื่นไม่ถูกนับ", personal.used_paid_days === 2);

  const withPending = L.leaveBalances({
    employee: emp(),
    requests: [...reqs, { id: "r5", employee_id: "e1", type: "personal", status: "pending", from: "2026-06-01", to: "2026-06-01", days: 1, paid_days: 1, unpaid_days: 0 }],
    overrides: {}, year: "2026", asOf: NOW,
  }).find((b) => b.type === "personal");
  check("ใบที่รออนุมัติกินสิทธิ์ไว้ก่อน", withPending.used_paid_days === 3);
  check("แต่แยกให้เห็นว่าส่วนไหนยังไม่แน่", withPending.pending_days === 1);

  const newbie = L.leaveBalances({
    employee: emp({ hired_at: NOW - 30 * DAY }), requests: [], overrides: {}, year: "2026", asOf: NOW,
  }).find((b) => b.type === "annual");
  check("ลาพักร้อนของคนยังไม่ครบปีถูกล็อก ไม่ใช่ 'ใช้หมดแล้ว'", newbie.locked === "service");

  const unknownHire = L.leaveBalances({
    employee: emp({ hired_at: null }), requests: [], overrides: {}, year: "2026", asOf: NOW,
  }).find((b) => b.type === "annual");
  check("ไม่รู้วันเริ่มงาน = ไม่ล็อก แต่รายงานว่าไม่รู้", unknownHire.locked === null && unknownHire.service_state === "unknown");
}

// ── 7. ตรวจใบลา ────────────────────────────────────────────────────────────
{
  const v = (draft, requests = []) =>
    L.validateLeaveRequest({ employee: emp(), draft, requests, overrides: {}, calendar: CAL, asOf: NOW });

  const ok = v({ type: "personal", from: "2026-09-04", to: "2026-09-04" });
  check("ใบปกติผ่าน", ok.ok === true && ok.days === 1 && ok.paid_days === 1);

  const allHoliday = v({ type: "personal", from: "2026-09-06", to: "2026-09-07" });
  check("ช่วงที่เป็นวันหยุดทั้งหมดถูกปฏิเสธ", allHoliday.ok === false);

  const straddle = v({ type: "personal", from: "2026-12-30", to: "2027-01-02" });
  check("ใบคร่อมปีถูกปฏิเสธ", straddle.ok === false && straddle.errors.some((e) => e.includes("คร่อมปี")));

  const badType = v({ type: "ลาไปเที่ยว", from: "2026-09-04", to: "2026-09-04" });
  check("ชนิดที่ไม่รู้จักถูกปฏิเสธ ไม่ตกเป็นชนิดใดชนิดหนึ่ง", badType.ok === false);

  // ── การทับซ้อน: ปฏิเสธ ไม่ใช่เตือน ──
  const existing = [{ id: "r1", employee_id: "e1", type: "sick", status: "approved", from: "2026-09-08", to: "2026-09-10", days: 3, paid_days: 3, unpaid_days: 0 }];
  const overlap = v({ type: "personal", from: "2026-09-09", to: "2026-09-11" }, existing);
  check("ช่วงทับกับใบที่อนุมัติแล้วถูกปฏิเสธ", overlap.ok === false && overlap.errors.some((e) => e.includes("ทับ")));

  const pendingExisting = [{ ...existing[0], status: "pending" }];
  check("ทับกับใบที่ยังรออนุมัติก็ถูกปฏิเสธ", v({ type: "personal", from: "2026-09-09", to: "2026-09-11" }, pendingExisting).ok === false);

  const rejectedExisting = [{ ...existing[0], status: "rejected" }];
  check("ทับกับใบที่ปฏิเสธไปแล้วไม่เป็นไร", v({ type: "personal", from: "2026-09-09", to: "2026-09-11" }, rejectedExisting).ok === true);

  const editingSelf = v(
    { id: "r1", type: "sick", from: "2026-09-08", to: "2026-09-09" },
    existing
  );
  check("แก้ใบเดิมไม่นับว่าทับตัวเอง", editingSelf.ok === true);

  // ── ลาพักร้อนของคนที่ยังไม่ครบปี ──
  const tooNew = L.validateLeaveRequest({
    employee: emp({ hired_at: NOW - 30 * DAY }),
    draft: { type: "annual", from: "2026-09-04", to: "2026-09-04" },
    requests: [], overrides: {}, calendar: CAL, asOf: NOW,
  });
  check("ยังไม่ครบปี ลาพักร้อนไม่ได้ (ม.30)", tooNew.ok === false);

  const noHire = L.validateLeaveRequest({
    employee: emp({ hired_at: null }),
    draft: { type: "annual", from: "2026-09-04", to: "2026-09-04" },
    requests: [], overrides: {}, calendar: CAL, asOf: NOW,
  });
  check("ไม่รู้วันเริ่มงาน = บอกให้ไปกรอก ไม่ใช่ปฏิเสธสิทธิ์เฉยๆ",
    noHire.ok === false && noHire.errors.some((e) => e.includes("วันเริ่มงาน")));

  // ── ลาคลอดเกิน 98 วัน (ม.41) ──
  const longMat = v({ type: "maternity", from: "2026-01-01", to: "2026-05-01" });
  check("ลาคลอดเกิน 98 วันถูกปฏิเสธ (ม.41)", longMat.ok === false);

  // ── คำเตือนใบรับรองแพทย์ (ม.32 วรรคสอง) — เตือน ไม่ใช่บล็อก ──
  const sick3 = v({ type: "sick", from: "2026-09-08", to: "2026-09-10" });
  check("ลาป่วย 3 วันผ่านได้ แต่เตือนเรื่องใบรับรองแพทย์",
    sick3.ok === true && sick3.warnings.some((w) => w.includes("ใบรับรองแพทย์")));
  const sick1 = v({ type: "sick", from: "2026-09-04", to: "2026-09-04" });
  check("ลาป่วยวันเดียวไม่เตือน", sick1.warnings.length === 0);

  // ── เกินสิทธิ์ = ผ่านแต่บอกว่ากี่วันไม่ได้เงิน ──
  const used = [{ id: "r9", employee_id: "e1", type: "personal", status: "approved", from: "2026-01-05", to: "2026-01-07", days: 3, paid_days: 3, unpaid_days: 0 }];
  const over = v({ type: "personal", from: "2026-09-04", to: "2026-09-04" }, used);
  check("ลากิจเกินสิทธิ์ยังลาได้", over.ok === true);
  check("แต่รายงานว่าไม่ได้ค่าจ้าง", over.paid_days === 0 && over.unpaid_days === 1);
}

// ── 8. วันลาไม่รับค่าจ้างในรอบจ่าย ─────────────────────────────────────────
//
// ตัวนี้เป็นตัวที่รอบจ่ายจะ *แสดง* ไม่ใช่ *หัก* — ดูหัวไฟล์ hr-leave.js
{
  const reqs = [
    { id: "a", employee_id: "e1", status: "approved", from: "2026-09-08", to: "2026-09-10", days: 3, paid_days: 0, unpaid_days: 3 },
    { id: "b", employee_id: "e1", status: "pending", from: "2026-09-14", to: "2026-09-15", days: 2, paid_days: 0, unpaid_days: 2 },
    { id: "c", employee_id: "e1", status: "approved", from: "2026-09-16", to: "2026-09-16", days: 1, paid_days: 1, unpaid_days: 0 },
    { id: "d", employee_id: "e2", status: "approved", from: "2026-09-09", to: "2026-09-09", days: 1, paid_days: 0, unpaid_days: 1 },
  ];
  const r = L.unpaidLeaveInPeriod({ requests: reqs, employeeId: "e1", from: "2026-09-01", to: "2026-09-30" });
  check("นับเฉพาะใบที่อนุมัติแล้ว", r.days === 3);
  check("ใบที่ได้ค่าจ้างไม่ถูกนับ", r.requests.every((x) => x.id !== "c"));
  check("ใบของคนอื่นไม่ถูกนับ", r.requests.every((x) => x.id !== "d"));

  const outside = L.unpaidLeaveInPeriod({ requests: reqs, employeeId: "e1", from: "2026-10-01", to: "2026-10-31" });
  check("ใบนอกรอบไม่ถูกนับ", outside.days === 0);

  const straddling = L.unpaidLeaveInPeriod({ requests: reqs, employeeId: "e1", from: "2026-09-09", to: "2026-09-30" });
  check("ใบที่คร่อมขอบรอบถูกรายงานว่าคร่อม", straddling.requests.some((x) => x.id === "a" && x.straddles === true));
}

// ── 9. เพดานกันวนลูปเป็นความสัมพันธ์ ไม่ใช่ตัวเลขของโดเมน ─────────────────
{
  const oneYear = L.countLeaveDays({ from: "2026-01-01", to: "2026-12-31", counts: "calendar_days", calendar: CAL });
  check("หนึ่งปีเต็มยังนับได้ (เพดานต้องไม่ตัดใบที่ถูกกฎหมายทิ้ง)", oneYear === 365);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
