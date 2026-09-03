// ---------------------------------------------------------------------------
// เบิกค่าใช้จ่ายไรเดอร์ — ด่านของ multi-path update ตอนอนุมัติ
//
//   node functions/test/rider-expenses.test.mjs
//
// การอนุมัติหนึ่งครั้งแตะสามโหนดพร้อมกัน (กระเป๋าไรเดอร์ / บัญชีบริษัท /
// สถานะรายการ) ซึ่งแปลว่ามีสามวิธีที่มันจะพังแบบครึ่งๆ:
//
//   เงินเข้ากระเป๋าแต่ไม่ลงบัญชี  = กำไรสูงเกินจริงทุกเดือนโดยไม่มีใครเห็น
//   ลงบัญชีแต่เงินไม่เข้ากระเป๋า  = ไรเดอร์ไม่ได้เงินที่เขาสำรองจ่ายไป
//   สถานะไม่เปลี่ยน               = อนุมัติซ้ำได้ = จ่ายสองรอบ
//
// และบทเรียนของ pin-dispute (1 ก.ย. 2569) เพิ่มข้อที่สี่: RTDB ปฏิเสธทั้ง
// update ถ้ามี path ใดเป็นบรรพบุรุษของอีก path ในก้อนเดียวกัน แล้วเด้งถึง
// แอดมินเป็นคำว่า "INTERNAL" เฉยๆ — จึงตรวจ **รูปของ update map** ด้วย
// ไม่ใช่แค่ค่าที่อยู่ในนั้น
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { buildApprovalUpdates } = require(join(here, "..", "rider-expenses.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

/** คืนคู่ path ที่ซ้อนกัน (ว่าง = ปลอดภัย) */
function ancestorOverlaps(updates) {
  const keys = Object.keys(updates);
  const bad = [];
  for (const x of keys) for (const y of keys) {
    if (x !== y && y.startsWith(`${x}/`)) bad.push([x, y]);
  }
  return bad;
}

const ROW = {
  rider_id: "riderA",
  job_id: "OID-ABCDEFGH-384",
  category: "toll",
  amount_thb: 65,
  note: "ทางด่วนขาไปรับเครื่อง",
};
const REVIEWER = { id: "staff1", name: "สมชาย" };
const NOW = 1_756_000_000_000;

const build = (over = {}) =>
  buildApprovalUpdates({
    id: "exp1",
    row: { ...ROW, ...(over.row || {}) },
    reviewer: REVIEWER,
    txKey: "tx1",
    expenseKey: "ex1",
    now: NOW,
    taxable: over.taxable === true,
  });

// --- รูปของ update map -----------------------------------------------------

{
  const { updates } = build();
  check(
    "ไม่มี path ไหนเป็นบรรพบุรุษของอีก path (RTDB จะปฏิเสธทั้งก้อน)",
    ancestorOverlaps(updates).length === 0
  );
  check(
    "แตะครบสามโหนดในก้อนเดียว — ครึ่งๆ ไม่ได้",
    Object.keys(updates).some((k) => k.startsWith("rider_expenses/")) &&
      Object.keys(updates).some((k) => k.startsWith("transactions/")) &&
      Object.keys(updates).some((k) => k.startsWith("expenses/"))
  );
}

// --- แถวกระเป๋าไรเดอร์ ------------------------------------------------------

{
  const { updates } = build();
  const tx = updates["transactions/tx1"];
  check("เป็น CREDIT (เงินเข้า ไม่ใช่เงินออก)", tx.type === "CREDIT");
  check(
    "หมวด EXPENSE_REIMBURSEMENT ไม่ใช่ BONUS — โบนัสเป็นเงินได้ เงินคืนไม่ใช่",
    tx.category === "EXPENSE_REIMBURSEMENT"
  );
  check("ยอดตรงกับที่ยื่น", tx.amount === 65);
  check("ผูกกลับไปหางาน", tx.ref_job_id === ROW.job_id);
  check("ผูกกลับไปหารายการเบิก (ตามรอยสองทาง)", tx.rider_expense_id === "exp1");
  check(
    "มีฟิลด์ taxable เขียนลงแถวตรงๆ ไม่ปล่อยให้ไปอนุมานจากชื่อหมวดทีหลัง",
    Object.prototype.hasOwnProperty.call(tx, "taxable")
  );
  check("ค่าเริ่มต้นคือไม่ใช่เงินได้", tx.taxable === false);
}

{
  // คำตอบนักบัญชีออกมาอีกทางก็ต้องเขียนได้โดยไม่ต้องแก้โค้ด
  const { updates } = build({ taxable: true });
  check("ตั้ง taxable: true ได้จาก settings", updates["transactions/tx1"].taxable === true);
}

// --- แถวบัญชีบริษัท --------------------------------------------------------

{
  const { updates } = build();
  const ex = updates["expenses/ex1"];
  check("ลงหมวด TRANSPORT ที่ P&L อ่าน", ex.category === "TRANSPORT");
  check("ยอดเท่ากับที่จ่ายไรเดอร์ ไม่ใช่คนละเลข", ex.amount === 65);
  check(
    "มี source แยกแถวที่ระบบสร้างออกจากแถวที่แอดมินคีย์มือ (กันนับซ้ำ)",
    ex.source === "rider_expense"
  );
  check("ตามรอยกลับไปหารายการเบิกได้", ex.rider_expense_id === "exp1");
  check("มี created_at ให้ตัวรวมรายเดือนจัดงวดได้", ex.created_at === NOW);
}

// --- สถานะรายการ -----------------------------------------------------------

{
  const { updates } = build();
  check(
    "สถานะไปเป็น paid — ไม่งั้นอนุมัติซ้ำได้แล้วจ่ายสองรอบ",
    updates["rider_expenses/exp1/status"] === "paid"
  );
  check("บันทึกว่าใครอนุมัติ", updates["rider_expenses/exp1/reviewed_by_staff_id"] === "staff1");
  check(
    "ชี้ไปที่แถว ledger กับแถวบัญชีที่เพิ่งสร้าง",
    updates["rider_expenses/exp1/paid_tx_id"] === "tx1" &&
      updates["rider_expenses/exp1/expense_doc_id"] === "ex1"
  );
}

// --- รายการที่ไม่ผูกงาน ----------------------------------------------------

{
  const { updates } = build({ row: { job_id: null } });
  const tx = updates["transactions/tx1"];
  check(
    "ไม่ผูกงาน = ไม่มี ref_job_id ค้างเป็น null (คีย์ null ทำให้ query by job พลาด)",
    !Object.prototype.hasOwnProperty.call(tx, "ref_job_id")
  );
  check(
    "คำอธิบายยังอ่านออกโดยไม่มีเลขงานห้อยท้าย",
    typeof tx.description === "string" && !tx.description.includes("#")
  );
}

// --- ยอดที่คืนออกมาต้องเท่ากับที่เขียนจริง --------------------------------

{
  const { amount, updates } = build({ row: { amount_thb: "120" } });
  check(
    "amount ที่คืนกับที่เขียนลง ledger เป็นตัวเลขตัวเดียวกัน (สตริงจากฟอร์มก็ต้องได้)",
    amount === 120 && updates["transactions/tx1"].amount === 120
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
