// =============================================================================
// ประวัติพนักงาน — เรื่องของ *คน* ไม่ใช่รายการการแก้ฟิลด์
//   node functions/test/employee-history.test.mjs
//
// ชุดนี้เขียนจากคำถามที่หน้าจอต้องตอบให้ได้ ไม่ใช่จากรูปของ API:
//   ทำงานมานานแค่ไหน · เคยอยู่ตำแหน่งไหนบ้าง · เงินเดือนขึ้นครั้งละเท่าไร ·
//   ปีนี้ลาไปกี่วัน — **ของเดิมตอบไม่ได้สักข้อ**
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                        | ผล |
//   |--------------------------------------------------|----|
//   | ไม่มีวันเริ่มงาน = รายงาน "0 วัน" แทน null         | แดง 3 |
//   | เอา guard ของ `Number(null) === 0` ออก            | แดง 1 |
//   | คนพ้นสภาพแล้วยังนับอายุงานต่อ                     | แดง 1 |
//   | ไม่คิดเปอร์เซ็นต์ที่ขึ้น                           | แดง 2 |
//   | ตำแหน่งแรกใช้ค่าปัจจุบันแทนค่า `from` ของการเปลี่ยน | แดง 1 |
//   | นับใบลาที่ยังไม่อนุมัติเข้าไปด้วย                   | แดง 3 |
//   | ไม่มีสิทธิ์ดูเงินเดือนแต่ยังส่งท่อนนั้นออกไป         | แดง 2 |
//   | เอกสารเรียงเก่าก่อน                               | แดง 1 |
//
// **สองบั๊กที่เทสชุดนี้จับได้ตอนเขียน (ไม่ใช่ตอน injection):**
//   1. `Number(null) === 0` ทำให้ค่าที่ audit จงใจไม่เก็บ กลายเป็น
//      **เงินเดือน 0 บาท** บนหน้าประวัติ — กับดักเดียวกับที่ CLAUDE.md จดไว้
//      และเป็นครั้งที่สามในโปรเจกต์นี้
//   2. assert ที่สแกน `JSON.stringify(...).includes("20000")` **แดงทั้งที่โค้ด
//      ถูก** เพราะ `hired_at` = 1753920000000 มีสตริงนั้นอยู่ข้างใน —
//      เทสจับ timestamp ไม่ได้จับเงินเดือน แก้เป็นตรวจโครงสร้างแทน
// =============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const H = require(join(HERE, "..", "employee-history.js"));

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 4);
const ago = (d) => NOW - d * DAY;

const auditRow = (at, changes, over = {}) => ({ at, changes, actor_name: "Panuwat", ...over });

// ── 1. ระยะเวลางาน — ช่องที่ FlowAccount มีแล้วเราไม่มี ─────────────────────
{
  check("13 เดือน = '1 ปี 1 เดือน'", H.tenureText(H.tenure(ago(400), { now: NOW })) === "1 ปี 1 เดือน");
  check("2 ปีพอดีไม่ต่อท้ายเดือน", H.tenureText(H.tenure(ago(731), { now: NOW })) === "2 ปี");
  check("ไม่ถึงเดือนบอกเป็นวัน", H.tenureText(H.tenure(ago(10), { now: NOW })) === "10 วัน");
  check("5 เดือนบอกเป็นเดือน", H.tenureText(H.tenure(ago(160), { now: NOW })) === "5 เดือน");

  // **ไม่มีวันเริ่มงาน = null ไม่ใช่ "0 วัน"** — คนที่ข้อมูลเราไม่ครบอาจทำงาน
  // มาสามปีแล้ว การเขียน 0 คือการรายงานสิ่งที่เราไม่รู้ว่าเป็นศูนย์
  check("ไม่มีวันเริ่มงาน = null", H.tenure(null, { now: NOW }) === null);
  check("วันเริ่มงานเป็น 0 = null", H.tenure(0, { now: NOW }) === null);
  check("ข้อความของ null ก็เป็น null", H.tenureText(null) === null);

  // คนที่พ้นสภาพแล้วต้องหยุดนับที่วันพ้นสภาพ ไม่ใช่นับต่อไปเรื่อยๆ
  const ended = H.tenure(ago(400), { now: NOW, terminatedAt: ago(35) });
  check("พ้นสภาพแล้วหยุดนับที่วันพ้นสภาพ", ended.days === 365 && ended.ended === true);
}

// ── 2. ประวัติเงินเดือน ต้องมีตัวเลขจริง ───────────────────────────────────
//
// **นี่คือข้อที่หน้าจอเดิมทำไม่ได้** — มันขึ้นว่า "ปรับเงินเดือน" แล้วเขียน
// แก้ตัวว่าระบบไม่ได้บันทึกจำนวนเงิน แล้วชี้ให้ไปกดปุ่มแก้ไขดู *ค่าปัจจุบัน*
// ซึ่งไม่ใช่ประวัติ
{
  const audit = [
    auditRow(ago(300), [{ field: "base_salary", from: 15000, to: 18000 }]),
    auditRow(ago(100), [{ field: "base_salary", from: 18000, to: 20000 }], { reason: "ผ่านทดลองงาน" }),
  ];
  const rows = H.salaryHistory(audit);
  check("มีสองครั้ง", rows.length === 2);
  check("เรียงจากเก่าไปใหม่", rows[0].at < rows[1].at);
  check("มีตัวเลขจริงทั้งค่าเก่าและใหม่", rows[0].from === 15000 && rows[0].to === 18000);
  check("คิดเปอร์เซ็นต์ให้", rows[0].pct === 20);
  check("เปอร์เซ็นต์ปัดหนึ่งตำแหน่ง", H.salaryHistory([auditRow(1, [{ field: "base_salary", from: 15000, to: 20000 }])])[0].pct === 33.3);
  check("มีคนสั่งกับเหตุผล", rows[1].by_name === "Panuwat" && rows[1].reason === "ผ่านทดลองงาน");

  const withheld = H.salaryHistory([auditRow(1, [{ field: "base_salary", from: null, to: null, withheld: true }])]);
  check("แถวที่ไม่เก็บค่าไว้ถูกทำเครื่องหมาย ไม่ใช่แสดงเป็น 0", withheld[0].withheld === true && withheld[0].from === null);

  check("ไม่มีการเปลี่ยนเงินเดือน = ลิสต์ว่าง", H.salaryHistory([auditRow(1, [{ field: "position", from: "a", to: "b" }])]).length === 0);
}

// ── 3. ประวัติตำแหน่ง พร้อมช่วงเวลา ────────────────────────────────────────
{
  const emp = { hired_at: ago(400), position: "หัวหน้าฝ่ายขาย" };
  const audit = [auditRow(ago(100), [{ field: "position", from: "พนักงานขาย", to: "หัวหน้าฝ่ายขาย" }])];
  const rows = H.positionHistory({ employee: emp, auditRows: audit, now: NOW });
  check("ได้สองช่วง", rows.length === 2);
  check("ช่วงแรกคือตำแหน่งเดิม", rows[0].position === "พนักงานขาย");
  check("ช่วงแรกเริ่มที่วันเริ่มงาน", rows[0].from === emp.hired_at);
  check("ช่วงแรกนับวันได้", rows[0].days === 300);
  check("ช่วงหลังคือตำแหน่งปัจจุบันและยังไม่จบ", rows[1].position === "หัวหน้าฝ่ายขาย" && rows[1].current === true && rows[1].to === null);
  check("ช่วงหลังนับถึงวันนี้", rows[1].days === 100);

  const never = H.positionHistory({ employee: { hired_at: ago(50), position: "พนักงานขาย" }, auditRows: [], now: NOW });
  check("ไม่เคยเปลี่ยนตำแหน่ง = ช่วงเดียวที่ยังไม่จบ", never.length === 1 && never[0].current === true && never[0].days === 50);

  check("ไม่มีตำแหน่งเลย = ลิสต์ว่าง", H.positionHistory({ employee: {}, auditRows: [], now: NOW }).length === 0);
}

// ── 4. วันลารายปี นับเฉพาะที่อนุมัติแล้ว ────────────────────────────────────
{
  const leave = [
    { status: "approved", from: "2026-02-02", days: 2, paid_days: 2, unpaid_days: 0, type: "personal" },
    { status: "approved", from: "2026-05-04", days: 3, paid_days: 0, unpaid_days: 3, type: "sick" },
    { status: "pending", from: "2026-06-01", days: 5, paid_days: 5, unpaid_days: 0, type: "personal" },
    { status: "rejected", from: "2026-07-01", days: 9, paid_days: 9, unpaid_days: 0, type: "personal" },
    { status: "approved", from: "2025-03-03", days: 1, paid_days: 1, unpaid_days: 0, type: "annual" },
  ];
  const years = H.leaveSummaryByYear(leave);
  check("แยกตามปี", years.length === 2);
  check("ปีล่าสุดมาก่อน", years[0].year === "2026");
  check("นับเฉพาะที่อนุมัติแล้ว", years[0].days === 5);
  check("แยกวันที่ได้เงินกับไม่ได้เงิน", years[0].paid_days === 2 && years[0].unpaid_days === 3);
  check("แยกตามชนิดการลา", years[0].by_type.personal === 2 && years[0].by_type.sick === 3);
  check("ปีก่อนหน้ายังอยู่", years[1].year === "2025" && years[1].days === 1);
  check("ใบที่วันที่อ่านไม่ออกไม่พัง", H.leaveSummaryByYear([{ status: "approved", from: "เมื่อวาน", days: 3 }]).length === 0);
}

// ── 5. สิทธิ์ดูเงินเดือน = ตัดทั้งท่อน ไม่ใช่ซ่อนที่ UI ─────────────────────
//
// ซ่อนที่ UI แปลว่าข้อมูลยังเดินทางไปถึงเบราว์เซอร์แล้วรอให้เปิด DevTools ดู
{
  const audit = [auditRow(ago(100), [{ field: "base_salary", from: 15000, to: 20000 }])];
  const yes = H.buildEmployeeHistory({ employee: { hired_at: ago(400) }, auditRows: audit, now: NOW, canSeePay: true });
  const no = H.buildEmployeeHistory({ employee: { hired_at: ago(400) }, auditRows: audit, now: NOW, canSeePay: false });
  check("มีสิทธิ์ = ได้ประวัติเงินเดือน", Array.isArray(yes.salary) && yes.salary.length === 1);
  check("ไม่มีสิทธิ์ = ท่อนนั้นเป็น null", no.salary === null);
  // **ห้ามสแกนด้วย substring ของตัวเลข** — assert เดิมเขียนว่า
  // `!JSON.stringify(no).includes("20000")` แล้วแดง ทั้งที่โค้ดถูก เพราะ
  // `hired_at` = 1753920000000 มีสตริง "20000" อยู่ข้างใน **เทสจับ timestamp
  // ไม่ได้จับเงินเดือน** — ตรวจโครงสร้างแทน: `pct` มีอยู่เฉพาะในแถวเงินเดือน
  const hasSalaryRow = (v) => {
    if (Array.isArray(v)) return v.some(hasSalaryRow);
    if (v && typeof v === "object") {
      if (Object.prototype.hasOwnProperty.call(v, "pct")) return true;
      return Object.values(v).some(hasSalaryRow);
    }
    return false;
  };
  check("ไม่มีแถวเงินเดือนหลงเหลืออยู่ที่ไหนเลยเมื่อไม่มีสิทธิ์", !hasSalaryRow(no));
  check("และเทสนี้จับได้จริงเมื่อมีสิทธิ์", hasSalaryRow(yes));
  check("ส่วนอื่นยังอยู่ครบ", no.summary.tenure_text === yes.summary.tenure_text);
}

// ── 6. ประกอบทั้งหน้า ──────────────────────────────────────────────────────
{
  const out = H.buildEmployeeHistory({
    employee: { hired_at: ago(400), position: "พนักงานขาย", status: "active", department: "ขาย" },
    auditRows: [auditRow(ago(100), [{ field: "base_salary", from: 15000, to: 20000 }])],
    leaveRows: [{ status: "approved", from: "2026-02-02", days: 2, paid_days: 2, unpaid_days: 0, type: "personal" }],
    documents: [
      { id: "d1", type: "contract", number: "CT-2569-0001", issued_at: ago(390) },
      { id: "d2", type: "cert", number: "CF-2569-0002", issued_at: ago(10) },
    ],
    now: NOW,
  });
  check("สรุปมีระยะเวลางาน", out.summary.tenure_text === "1 ปี 1 เดือน");
  check("สรุปมีตำแหน่งกับแผนก", out.summary.position === "พนักงานขาย" && out.summary.department === "ขาย");
  check("มีท่อนตำแหน่ง", out.positions.length === 1);
  check("มีท่อนวันลา", out.leave_by_year.length === 1);
  check("เอกสารเรียงใหม่สุดก่อน", out.documents[0].number === "CF-2569-0002");
  check("ไม่มีข้อมูลอะไรเลยก็ไม่พัง", H.buildEmployeeHistory({}).summary.tenure_text === null);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
