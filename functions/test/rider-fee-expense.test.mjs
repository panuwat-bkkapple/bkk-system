// ---------------------------------------------------------------------------
// แถวค่าใช้จ่ายที่เกิดจากการถอนเงินของไรเดอร์
//
//   node functions/test/rider-fee-expense.test.mjs
//
// สองข้อที่ผิดแล้วตัวเลขในรายงานภาษี/กำไรผิดตามทันที:
//   ลงยอด net_paid แทน gross  = ต้นทุนต่ำไปเท่ากับภาษีที่หักไว้
//   ลงยอดถอนทั้งก้อน          = นับเงินคืนค่าทดรองซ้ำ (ลงบัญชีตอนอนุมัติแล้ว)
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { buildFeeExpense, expenseKeyFor, EXPENSE_SOURCE } =
  require(join(here, "..", "rider-fee-expense.js"));

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`); failures += 1; }
};

const NOW = 1_756_000_000_000;
const build = (split, over = {}) =>
  buildFeeExpense({ txId: "tx1", split, riderId: "riderA", riderName: "สมชาย", now: NOW, ...over });

// --- ยอดที่ลง --------------------------------------------------------------

{
  const row = build({ gross: 1000, reimbursed: 0, labour: 1000 });
  check("ลงยอดค่าจ้างเต็มจำนวน", row.amount === 1000);
  check("หมวด TRANSPORT ที่ P&L อ่าน", row.category === "TRANSPORT");
  check("ติดธง source แยกจากแถวที่แอดมินคีย์มือ", row.source === EXPENSE_SOURCE);
  check("ตามรอยกลับไปหาแถวถอนได้", row.withdrawal_tx_id === "tx1");
  check("ตามรอยกลับไปหาไรเดอร์ได้", row.rider_id === "riderA");
  check("มี created_at ให้ตัวรวมรายเดือนจัดงวด", row.created_at === NOW);
  check("logged_by บอกตรงๆ ว่าระบบเขียน ไม่ใช่ชื่อคน", row.logged_by.includes("ระบบ"));
}

{
  // ยอดที่ลงต้องเป็นค่าจ้างเท่านั้น ไม่ใช่ยอดถอนทั้งก้อน
  const row = build({ gross: 1065, reimbursed: 65, labour: 1000 });
  check("ถอน 1,065 ที่มีเงินคืน 65 ปน = ลงบัญชี 1,000 ไม่ใช่ 1,065", row.amount === 1000);
  check("หมายเหตุอธิบายว่าหักอะไรออกไป (ให้บัญชีตรวจย้อนได้)",
    row.note.includes("1,065") && row.note.includes("65"), row.note);
}

{
  // ถอนเงินคืนล้วน — ไม่มีค่าจ้าง ห้ามสร้างแถว 0 บาทมารบกวนรายงาน
  check("ถอนเงินคืนล้วน = ไม่สร้างแถวค่าใช้จ่าย",
    build({ gross: 65, reimbursed: 65, labour: 0 }) === null);
  check("split เป็น null = ไม่สร้างแถว", build(null) === null);
  check("labour ติดลบ (ข้อมูลเพี้ยน) = ไม่สร้างแถว",
    build({ gross: 0, reimbursed: 10, labour: -10 }) === null);
}

// --- คีย์ที่กันเขียนซ้ำ ----------------------------------------------------

{
  check("คีย์คำนวณจาก txId ไม่ใช่ push key (รันซ้ำได้ผลเดียว)",
    expenseKeyFor("abc") === "RF_abc" && expenseKeyFor("abc") === expenseKeyFor("abc"));
  check("txId ต่างกันได้คีย์ต่างกัน", expenseKeyFor("a") !== expenseKeyFor("b"));
}

// --- ชื่อไรเดอร์ที่หาย -----------------------------------------------------

{
  const row = build({ gross: 500, reimbursed: 0, labour: 500 }, { riderName: "" });
  check("ไม่มีชื่อไรเดอร์ก็ยังอ่านออก ไม่มีขีดกลางห้อยท้าย",
    row.title === "ค่ารอบไรเดอร์", row.title);
}

// --- ค่า source ต้องตรงกับที่หน้ารายงานอ่าน ------------------------------
//
// injection ที่เปลี่ยน EXPENSE_SOURCE **เขียวตอนแรก** เพราะเทสข้างบน assert
// เทียบกับค่าคงที่ตัวเดียวกับที่ถูกเปลี่ยน (เทสที่เห็นด้วยกับตัวเอง) — ของที่
// ต้องกันจริงคือ **สองไฟล์เดินห่างกัน**: ถ้าคำไม่ตรง ค่าจ้างไรเดอร์จะไหลกลับ
// ไปรวมในบรรทัด "ค่าใช้จ่ายดำเนินงาน" เงียบๆ แล้วบรรทัดของมันเป็นศูนย์
// ซึ่งอ่านเหมือนเดือนนั้นไม่มีใครถอนเงิน

{
  const { readFileSync } = await import("fs");
  const src = readFileSync(join(here, "..", "..", "src", "pages", "admin", "FinancialReport.tsx"), "utf-8");
  const m = src.match(/const RIDER_LABOUR_SOURCE = '([^']+)'/);
  check("หา RIDER_LABOUR_SOURCE ในหน้ารายงานเจอ", !!m);
  check(`คำว่า source ตรงกันทั้งสองไฟล์ (${EXPENSE_SOURCE})`,
    m && m[1] === EXPENSE_SOURCE, m ? `หน้ารายงานใช้ '${m[1]}'` : "");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
