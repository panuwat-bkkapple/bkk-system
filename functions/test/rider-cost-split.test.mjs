// ---------------------------------------------------------------------------
// แยกค่าจ้างออกจากเงินคืนค่าทดรองในยอดถอน
//
//   node functions/test/rider-cost-split.test.mjs
//
// ทำไมมีไฟล์นี้: เจ้าของงานเคาะให้บันทึกค่าจ้างไรเดอร์เป็นค่าใช้จ่าย **ตอนถอน**
// แต่กระเป๋ามีเงินคืนค่าทดรองปนอยู่ ซึ่งลงบัญชีไปแล้วตอนอนุมัติ — ถ้าไม่แยก
// เงินคืนจะถูกนับสองรอบ แล้วกำไรจะ **ต่ำ** เกินจริง ซึ่งอ่านย้อนหลังยากกว่า
// ตอนสูงเกินจริง เพราะไม่มีใครสงสัยตัวเลขที่ดูแย่กว่าความจริง
//
// เคสในไฟล์นี้เขียนจากลำดับที่เกิดได้จริงในกระเป๋า ไม่ใช่จากตาราง spec
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { splitWithdrawal } = require(join(here, "..", "rider-cost-split.js"));

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`); failures += 1; }
};
const eq = (label, got, want) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

let clock = 1_000;
const tick = () => (clock += 1_000);
const payout = (id, amount) => ({ id, type: "CREDIT", category: "JOB_PAYOUT", amount, timestamp: tick() });
const refund = (id, amount) => ({ id, type: "CREDIT", category: "EXPENSE_REIMBURSEMENT", amount, timestamp: tick() });
const withdraw = (id, amount, extra = {}) => ({ id, type: "DEBIT", category: "WITHDRAWAL", amount, timestamp: tick(), ...extra });

// --- เคสพื้นฐาน ------------------------------------------------------------

{
  // วิ่งงานได้ 1,000 แล้วถอน 1,000 — ไม่มีเงินคืนปน ทั้งก้อนเป็นค่าจ้าง
  const rows = [payout("t1", 1000), withdraw("w1", 1000)];
  eq("ไม่มีเงินคืนปน = ทั้งก้อนเป็นค่าจ้าง", splitWithdrawal(rows, "w1"), { gross: 1000, reimbursed: 0, labour: 1000 });
}

{
  // สำรองจ่ายทางด่วน 65 ได้คืน แล้วถอนแค่ 65 — ไม่มีค่าจ้างในก้อนนี้เลย
  const rows = [refund("r1", 65), withdraw("w1", 65)];
  eq("ถอนเท่ายอดเงินคืนพอดี = ไม่มีค่าจ้าง", splitWithdrawal(rows, "w1"), { gross: 65, reimbursed: 65, labour: 0 });
}

{
  // ปนกัน: ค่าจ้าง 1,000 + เงินคืน 65 แล้วถอนหมด 1,065
  const rows = [payout("t1", 1000), refund("r1", 65), withdraw("w1", 1065)];
  eq("ถอนก้อนที่ปนกัน = แยกได้ถูก", splitWithdrawal(rows, "w1"), { gross: 1065, reimbursed: 65, labour: 1000 });
}

{
  // ถอนน้อยกว่ายอดเงินคืน — เงินคืนออกก่อนค่าจ้าง (FIFO โดยปริยาย)
  const rows = [payout("t1", 1000), refund("r1", 500), withdraw("w1", 200)];
  eq("ถอนน้อยกว่าเงินคืนที่ค้าง = เป็นเงินคืนทั้งก้อน", splitWithdrawal(rows, "w1"), { gross: 200, reimbursed: 200, labour: 0 });
}

// --- ถอนหลายครั้ง: pool ต้องไม่ถูกใช้ซ้ำ ----------------------------------

{
  const rows = [
    refund("r1", 100),
    payout("t1", 900),
    withdraw("w1", 300, { reimbursed_part: 100 }),
    withdraw("w2", 700),
  ];
  eq("ถอนครั้งแรกกินเงินคืนไปแล้ว ครั้งที่สองเป็นค่าจ้างล้วน",
    splitWithdrawal(rows, "w2"), { gross: 700, reimbursed: 0, labour: 700 });
}

{
  // แถวถอนเก่าที่ยังไม่มีฟิลด์บันทึก (ข้อมูลก่อนฟีเจอร์นี้) ต้องคิดด้วยกฎเดียวกัน
  const rows = [refund("r1", 100), payout("t1", 900), withdraw("w1", 300), withdraw("w2", 700)];
  eq("แถวถอนเก่าที่ไม่มี reimbursed_part ก็ต้องไม่ทำให้ pool ถูกใช้ซ้ำ",
    splitWithdrawal(rows, "w2"), { gross: 700, reimbursed: 0, labour: 700 });
}

{
  // เงินคืนมาทีหลังการถอนครั้งแรก — pool ของครั้งแรกต้องไม่เห็นอนาคต
  const rows = [payout("t1", 1000), withdraw("w1", 500), refund("r1", 65), withdraw("w2", 565)];
  eq("การถอนครั้งแรกไม่เห็นเงินคืนที่ยังไม่เกิด",
    splitWithdrawal(rows, "w1"), { gross: 500, reimbursed: 0, labour: 500 });
  eq("การถอนครั้งที่สองเห็นเงินคืนที่เกิดระหว่างทาง",
    splitWithdrawal(rows, "w2"), { gross: 565, reimbursed: 65, labour: 500 });
}

// --- ความคงที่ของผลลัพธ์ ---------------------------------------------------

{
  // เขียนพร้อมกันจนได้ timestamp เท่ากัน — ผลต้องคงที่ทุกครั้งที่รัน
  // ไม่ใช่ขึ้นกับลำดับที่ RTDB ส่งแถวมา
  const a = { id: "aaa", type: "CREDIT", category: "EXPENSE_REIMBURSEMENT", amount: 50, timestamp: 5000 };
  const b = { id: "bbb", type: "DEBIT", category: "WITHDRAWAL", amount: 50, timestamp: 5000 };
  const one = splitWithdrawal([a, b], "bbb");
  const two = splitWithdrawal([b, a], "bbb");
  eq("ลำดับที่ส่งแถวมาไม่เปลี่ยนผล", one, two);
  check("แถวที่ id เล็กกว่าถือว่ามาก่อนเมื่อเวลาเท่ากัน", one.reimbursed === 50);
}

{
  const rows = [payout("t1", 100.555), withdraw("w1", 100.555)];
  const r = splitWithdrawal(rows, "w1");
  check("ปัดสองตำแหน่ง ไม่ปล่อยเศษทศนิยมยาวลงบัญชี",
    r.gross === 100.56 && r.labour === 100.56, JSON.stringify(r));
}

// --- ของที่ต้องปฏิเสธ ------------------------------------------------------

{
  const rows = [payout("t1", 100)];
  check("แถวที่ไม่ใช่การถอน = null", splitWithdrawal(rows, "t1") === null);
  check("หา id ไม่เจอ = null", splitWithdrawal(rows, "nope") === null);
  check("rows ที่ไม่ใช่อาเรย์ = null ไม่ throw", splitWithdrawal(null, "w1") === null);
}

{
  // amount ที่เป็นสตริงจากฟอร์ม / null จากข้อมูลเสีย ต้องไม่กลายเป็น NaN
  // เพราะ NaN ลงบัญชีแล้วทำให้ยอดรวมทั้งเดือนเป็น NaN
  const rows = [refund("r1", "65"), withdraw("w1", "65")];
  eq("ตัวเลขที่มาเป็นสตริงใช้ได้", splitWithdrawal(rows, "w1"), { gross: 65, reimbursed: 65, labour: 0 });
  const bad = [{ id: "w1", type: "DEBIT", category: "WITHDRAWAL", amount: null, timestamp: 1 }];
  eq("amount เสีย = 0 ไม่ใช่ NaN", splitWithdrawal(bad, "w1"), { gross: 0, reimbursed: 0, labour: 0 });
}

{
  // เงินคืนมากกว่าที่ถอนไปทั้งหมด — pool ต้องไม่ติดลบแล้วไปทำให้ครั้งถัดไปเพี้ยน
  const rows = [refund("r1", 100), withdraw("w1", 30, { reimbursed_part: 30 }), withdraw("w2", 30)];
  const r = splitWithdrawal(rows, "w2");
  check("pool ที่เหลือยังใช้ได้ ไม่ติดลบ", r.reimbursed === 30 && r.labour === 0, JSON.stringify(r));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
