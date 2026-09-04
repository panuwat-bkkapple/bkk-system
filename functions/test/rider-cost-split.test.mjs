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
//
// ผล injection (4 ก.ย. 2569 — ทำลายกฎทีละข้อแล้ววัดบนไฟล์สุดท้าย: จำนวน FAIL
// ของไฟล์นี้ / จำนวน failed ของ riderCostSplitParity.test.ts + riderWht.test.ts):
//
//   I1  (JS) creditIsTaxable ไม่อ่านธง ใช้หมวดอย่างเดียว        แดง 3 / 1
//   I2  (JS) หมวดไม่รู้จัก = ไม่ใช่เงินได้                       แดง 1 / 1
//   I3  (JS) ถอด COMPANY_ADVANCE/RIDER_DEPOSIT ออกจาก fallback    แดง 1 / 2
//   I4  (JS) ลำดับสลับ เงินได้ออกก่อน                            แดง 10 / 7
//   I5  (JS) ไม่อ่าน exempt_part ของแถวถอนเก่า (เดา FIFO เสมอ)   แดง 1 / 1
//   I6  (JS) alias drift labour ชี้ exempt                       แดง 12 / 19
//   I7  (JS) "ที่ผ่านมา" = ทุกแถว ไม่ตัดที่แถวเป้าหมาย            แดง 1 / 2
//   I8  (TS) creditIsTaxable ไม่อ่านธง                           แดง 0 / 2
//   I9  (TS) WALLET_CREDIT_TAXABLE.COMPANY_ADVANCE = true       แดง 0 / 1  (parity สามที่)
//   I10 (TS) fallback ถอด RIDER_DEPOSIT                         แดง 0 / 2
//   I11 (TS) ลำดับสลับ                                           แดง 0 / 15
//   I12 (TS) ไม่อ่าน exempt_part                                 แดง 0 / 2
//   I13 (TS) "ที่ผ่านมา" = ทุกแถว                                แดง 0 / 3
//
// รอบแรก I5 / I7 / I8 **เขียว 0 / 0 ทั้งสามตัว** — โค้ดถูก แต่ fixture ไม่ไปถึงกฎ:
//   I5: fixture ประทับ exempt_part เท่ากับที่ FIFO เดาพอดี (เทสเห็นด้วยกับตัวเอง)
//       → เพิ่มเคส "ค่าที่ประทับต่างจาก FIFO" (แถวเงินเข้าถูกแก้ป้ายหลังลงบัญชี)
//   I7: ทุก fixture ที่มีเงินเข้าหลังการถอน มี w2 ตามมากินกองนั้นพอดี ผลจึงเท่ากัน
//       → เพิ่มเคส "เงินคืนมาทีหลัง ไม่มี w2 ตามหลัง"
//   I8: fixture ธงชนะหมวดใช้ 100/100 อ่านธงผิดด้านได้ผลเดิม → เปลี่ยนเป็น 100/30
// ทั้งสามจับที่ **เทส** ไม่ใช่ที่โค้ด (ตามที่ CLAUDE.md ของ frontend เตือน)
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
/** รูปเดิมของผลลัพธ์ (ก่อนมี exempt/taxable) — เคสเก่าเทียบรูปนี้เพื่อพิสูจน์ว่า
 *  ผู้อ่านเดิม (rider-fee-expense) เห็นตัวเลขเท่าเดิมทุกเคส */
const shape = (s) => (s ? { gross: s.gross, reimbursed: s.reimbursed, labour: s.labour } : s);

let clock = 1_000;
const tick = () => (clock += 1_000);
const payout = (id, amount) => ({ id, type: "CREDIT", category: "JOB_PAYOUT", amount, timestamp: tick() });
const refund = (id, amount) => ({ id, type: "CREDIT", category: "EXPENSE_REIMBURSEMENT", amount, timestamp: tick() });
const withdraw = (id, amount, extra = {}) => ({ id, type: "DEBIT", category: "WITHDRAWAL", amount, timestamp: tick(), ...extra });

// --- เคสพื้นฐาน ------------------------------------------------------------

{
  // วิ่งงานได้ 1,000 แล้วถอน 1,000 — ไม่มีเงินคืนปน ทั้งก้อนเป็นค่าจ้าง
  const rows = [payout("t1", 1000), withdraw("w1", 1000)];
  eq("ไม่มีเงินคืนปน = ทั้งก้อนเป็นค่าจ้าง", shape(splitWithdrawal(rows, "w1")), { gross: 1000, reimbursed: 0, labour: 1000 });
}

{
  // สำรองจ่ายทางด่วน 65 ได้คืน แล้วถอนแค่ 65 — ไม่มีค่าจ้างในก้อนนี้เลย
  const rows = [refund("r1", 65), withdraw("w1", 65)];
  eq("ถอนเท่ายอดเงินคืนพอดี = ไม่มีค่าจ้าง", shape(splitWithdrawal(rows, "w1")), { gross: 65, reimbursed: 65, labour: 0 });
}

{
  // ปนกัน: ค่าจ้าง 1,000 + เงินคืน 65 แล้วถอนหมด 1,065
  const rows = [payout("t1", 1000), refund("r1", 65), withdraw("w1", 1065)];
  eq("ถอนก้อนที่ปนกัน = แยกได้ถูก", shape(splitWithdrawal(rows, "w1")), { gross: 1065, reimbursed: 65, labour: 1000 });
}

{
  // ถอนน้อยกว่ายอดเงินคืน — เงินคืนออกก่อนค่าจ้าง (FIFO โดยปริยาย)
  const rows = [payout("t1", 1000), refund("r1", 500), withdraw("w1", 200)];
  eq("ถอนน้อยกว่าเงินคืนที่ค้าง = เป็นเงินคืนทั้งก้อน", shape(splitWithdrawal(rows, "w1")), { gross: 200, reimbursed: 200, labour: 0 });
}

// --- ถอนหลายครั้ง: pool ต้องไม่ถูกใช้ซ้ำ ----------------------------------

{
  const rows = [
    refund("r1", 100),
    payout("t1", 900),
    withdraw("w1", 300, { reimbursed_part: 100 }),
    withdraw("w2", 700),
  ];
  eq("ถอนครั้งแรกกินเงินคืนไปแล้ว ครั้งที่สองเป็นค่าจ้างล้วน", shape(splitWithdrawal(rows, "w2")), { gross: 700, reimbursed: 0, labour: 700 });
}

{
  // แถวถอนเก่าที่ยังไม่มีฟิลด์บันทึก (ข้อมูลก่อนฟีเจอร์นี้) ต้องคิดด้วยกฎเดียวกัน
  const rows = [refund("r1", 100), payout("t1", 900), withdraw("w1", 300), withdraw("w2", 700)];
  eq("แถวถอนเก่าที่ไม่มี reimbursed_part ก็ต้องไม่ทำให้ pool ถูกใช้ซ้ำ", shape(splitWithdrawal(rows, "w2")), { gross: 700, reimbursed: 0, labour: 700 });
}

{
  // เงินคืนมาทีหลังการถอนครั้งแรก — pool ของครั้งแรกต้องไม่เห็นอนาคต
  const rows = [payout("t1", 1000), withdraw("w1", 500), refund("r1", 65), withdraw("w2", 565)];
  eq("การถอนครั้งแรกไม่เห็นเงินคืนที่ยังไม่เกิด", shape(splitWithdrawal(rows, "w1")), { gross: 500, reimbursed: 0, labour: 500 });
  eq("การถอนครั้งที่สองเห็นเงินคืนที่เกิดระหว่างทาง", shape(splitWithdrawal(rows, "w2")), { gross: 565, reimbursed: 65, labour: 500 });
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
  eq("ตัวเลขที่มาเป็นสตริงใช้ได้", shape(splitWithdrawal(rows, "w1")), { gross: 65, reimbursed: 65, labour: 0 });
  const bad = [{ id: "w1", type: "DEBIT", category: "WITHDRAWAL", amount: null, timestamp: 1 }];
  eq("amount เสีย = 0 ไม่ใช่ NaN", shape(splitWithdrawal(bad, "w1")), { gross: 0, reimbursed: 0, labour: 0 });
}

{
  // เงินคืนมากกว่าที่ถอนไปทั้งหมด — pool ต้องไม่ติดลบแล้วไปทำให้ครั้งถัดไปเพี้ยน
  const rows = [refund("r1", 100), withdraw("w1", 30, { reimbursed_part: 30 }), withdraw("w2", 30)];
  const r = splitWithdrawal(rows, "w2");
  check("pool ที่เหลือยังใช้ได้ ไม่ติดลบ", r.reimbursed === 30 && r.labour === 0, JSON.stringify(r));
}

// --- ธง taxable บนแถว (4 ก.ย. 2569) ----------------------------------------
//
// ตัวแยกอ่านธงก่อน ชื่อหมวดเป็นแค่ fallback ของแถวเก่า — หมวดใหม่ในอนาคตแค่
// ประกาศธงตอนเขียนก็ถูกแยกถูกโดยไม่ต้องแก้ไฟล์นี้
{
  const { creditIsTaxable } = require(join(here, "..", "rider-cost-split.js"));
  check("ธง true ชนะชื่อหมวด (เงินคืนที่บัญชีสั่งให้นับเป็นเงินได้)",
    creditIsTaxable({ category: "EXPENSE_REIMBURSEMENT", taxable: true }) === true);
  check("ธง false ชนะชื่อหมวด (ค่ารอบที่ถูกประกาศว่าไม่ใช่เงินได้)",
    creditIsTaxable({ category: "JOB_PAYOUT", taxable: false }) === false);
  check("แถวเก่าไม่มีธง: เงินคืน = ไม่ใช่เงินได้", creditIsTaxable({ category: "EXPENSE_REIMBURSEMENT" }) === false);
  check("แถวเก่าไม่มีธง: ค่ารอบ = เงินได้", creditIsTaxable({ category: "JOB_PAYOUT" }) === true);
  check("หมวดใหม่ไม่มีธง: เครดิตบริษัท/เงินฝาก = ไม่ใช่เงินได้",
    creditIsTaxable({ category: "COMPANY_ADVANCE" }) === false && creditIsTaxable({ category: "RIDER_DEPOSIT" }) === false);
  check("หมวดที่ไม่รู้จัก = เงินได้ (ทิศหักเกิน ไม่ใช่หักขาด)", creditIsTaxable({ category: "SOMETHING_NEW" }) === true);
  check("ธงที่ไม่ใช่ boolean (สตริง 'false') ไม่นับเป็นธง", creditIsTaxable({ category: "JOB_PAYOUT", taxable: "false" }) === true);
}

// --- Acceptance: กระเป๋า 520 = ค่ารอบ 500 (taxable) + ค่าจอด 20 (ไม่ taxable) ---
{
  const flagged = (id, category, amount, taxable) =>
    ({ id, type: "CREDIT", category, amount, taxable, timestamp: tick() });
  const { computeRiderWht } = require(join(here, "..", "rider-wht.js"));
  const ON = { enabled: true, ratePercent: 3 };

  // Scenario A: ถอน 20
  {
    const rows = [flagged("f1", "JOB_PAYOUT", 500, true), flagged("p1", "EXPENSE_REIMBURSEMENT", 20, false), withdraw("wA", 20)];
    const s = splitWithdrawal(rows, "wA");
    eq("A: ดึงจากกองไม่ใช่เงินได้ 20 / เงินได้ 0", { exempt: s.exempt, taxable: s.taxable }, { exempt: 20, taxable: 0 });
    const w = computeRiderWht(20, "freelance", ON, { taxableBase: s.taxable });
    eq("A: ภาษี 0 โอน 20", { wht: w.wht, net: w.net }, { wht: 0, net: 20 });
  }
  // Scenario B: ถอน 520
  {
    const rows = [flagged("f1", "JOB_PAYOUT", 500, true), flagged("p1", "EXPENSE_REIMBURSEMENT", 20, false), withdraw("wB", 520)];
    const s = splitWithdrawal(rows, "wB");
    eq("B: ดึงจากกองไม่ใช่เงินได้ 20 / เงินได้ 500", { exempt: s.exempt, taxable: s.taxable }, { exempt: 20, taxable: 500 });
    const w = computeRiderWht(520, "freelance", ON, { taxableBase: s.taxable });
    eq("B: ฐาน 500 ภาษี 15 โอน 505", { base: w.taxableBase, wht: w.wht, net: w.net }, { base: 500, wht: 15, net: 505 });
  }
  // โบนัสเป็นเงินได้ · เครดิตบริษัทกับเงินฝากไม่ใช่ — ทั้งหมดอยู่ในกระเป๋าเดียวกัน
  {
    const rows = [
      flagged("f1", "JOB_PAYOUT", 500, true),
      flagged("b1", "BONUS", 100, true),
      flagged("a1", "COMPANY_ADVANCE", 200, false),
      flagged("d1", "RIDER_DEPOSIT", 300, false),
      withdraw("wC", 1100),
    ];
    const s = splitWithdrawal(rows, "wC");
    eq("C: กองไม่ใช่เงินได้ 500 (เครดิต 200 + ฝาก 300) / เงินได้ 600 (ค่ารอบ + โบนัส)",
      { exempt: s.exempt, taxable: s.taxable }, { exempt: 500, taxable: 600 });
  }
  // แถวถอนเก่าที่บันทึก exempt_part ไว้ ใช้ค่านั้น (ตัวเลขที่ลงบัญชีแล้วห้ามคำนวณใหม่)
  {
    const rows = [flagged("p1", "RIDER_DEPOSIT", 100, false), flagged("f1", "JOB_PAYOUT", 900, true),
      withdraw("w1", 300, { exempt_part: 100 }), withdraw("w2", 700)];
    const s = splitWithdrawal(rows, "w2");
    eq("ถอนครั้งแรกกินกองไปแล้ว (exempt_part) ครั้งที่สองเป็นเงินได้ล้วน", { exempt: s.exempt, taxable: s.taxable }, { exempt: 0, taxable: 700 });
  }
  // ค่าที่ประทับไว้ **ต่างจาก** ที่ FIFO จะเดา — เคสที่แถวเงินเข้าถูกแก้ป้ายทีหลัง
  // (แบบเดียวกับ relabel-pin-dispute-tx.cjs): ตอน w1 ถูกลงบัญชี b1 ยังเป็น BONUS
  // (เงินได้) w1 จึงประทับ exempt_part 0 และเสียภาษีไปเต็ม 300 แล้ว ต่อมา b1 ถูกแก้
  // เป็น RIDER_DEPOSIT — กองไม่ใช่เงินได้ 100 นั้นยังไม่เคยถูกดึง ครั้งที่สองจึงต้อง
  // ได้ 100 ไม่ใช่ 0 (FIFO เดาว่า w1 กินไปแล้ว = คำนวณตัวเลขที่ลงบัญชีแล้วใหม่ ซึ่งห้าม)
  {
    const rows = [
      { ...flagged("b1", "RIDER_DEPOSIT", 100, false), category_was: "BONUS" },
      flagged("f1", "JOB_PAYOUT", 900, true),
      withdraw("w1", 300, { exempt_part: 0, taxable_part: 300 }),
      withdraw("w2", 700),
    ];
    const s = splitWithdrawal(rows, "w2");
    eq("exempt_part ที่ประทับไว้ชนะการเดา FIFO (แถวเงินเข้าถูกแก้ป้ายหลังลงบัญชี)",
      { exempt: s.exempt, taxable: s.taxable }, { exempt: 100, taxable: 600 });
  }
  // เงินเข้าที่ไม่ใช่เงินได้ซึ่งมาถึง **หลัง** การถอน ต้องไม่ย้อนไปลดฐานภาษีของการถอนนั้น
  // (ไม่มีการถอนครั้งถัดไปมาบังเคส — ถ้ามี w2 ตามหลัง มันจะกินกองนั้นไปพอดีแล้วผลเท่ากัน
  // ทั้งที่ตัวกรอง "ที่ผ่านมา" พัง — injection I7 เขียวเพราะแบบนั้นมาแล้วหนึ่งรอบ)
  {
    const rows = [flagged("f1", "JOB_PAYOUT", 1000, true), withdraw("w1", 500), flagged("p1", "EXPENSE_REIMBURSEMENT", 65, false)];
    const s = splitWithdrawal(rows, "w1");
    eq("เงินคืนที่มาทีหลังไม่ย้อนลดฐานภาษีของการถอนก่อนหน้า", { exempt: s.exempt, taxable: s.taxable }, { exempt: 0, taxable: 500 });
  }
  // ธงชนะหมวดโดยที่ตัวเลขสองฝั่ง **ไม่เท่ากัน** — ถ้าเท่ากัน (100/100) การอ่านผิดด้าน
  // จะให้ผลลัพธ์เดิม แล้วเทสจะเขียวทั้งตอนอ่านธงและตอนไม่อ่าน (injection I8 จับได้)
  {
    const rows = [flagged("r", "EXPENSE_REIMBURSEMENT", 100, true), flagged("f", "JOB_PAYOUT", 30, false), withdraw("w", 130)];
    const s = splitWithdrawal(rows, "w");
    eq("ธงชนะหมวดบนตัวเลขที่ไม่สมมาตร: กองไม่ใช่เงินได้ = 30 (ค่ารอบที่ถูกประกาศว่าไม่ใช่เงินได้)",
      { exempt: s.exempt, taxable: s.taxable }, { exempt: 30, taxable: 100 });
  }
  // ชื่อเดิมยังตรงกับชื่อใหม่ — ผู้อ่านเดิม (rider-fee-expense) ต้องไม่เห็นตัวเลขเปลี่ยน
  {
    const s = splitWithdrawal([flagged("p1", "EXPENSE_REIMBURSEMENT", 65, false), flagged("f1", "JOB_PAYOUT", 1000, true), withdraw("w", 1065)], "w");
    check("labour === taxable และ reimbursed === exempt", s.labour === s.taxable && s.reimbursed === s.exempt);
  }
}

// --- Acceptance: Partial Withdrawal with Mixed Funds (เจ้าของงาน 4 ก.ย. 2569) ---
//
// กระเป๋า 570 = ค่ารอบ 550 (taxable) + ค่าจอด 20 (ไม่ taxable) ถอน 300
//   ขั้น 1 ดึงกองไม่ใช่เงินได้จนหมด (20) · ขั้น 2 ที่เหลือจากกองเงินได้ (280)
//   ขั้น 3 หัก 3% เฉพาะ 280 = 8.40 → โอน 291.60 · เหลือ 270 ซึ่งต้องเป็นเงินได้ล้วน
//
// "270 ที่เหลือคง identity taxable" ไม่ได้มาจากการเก็บป้าย แต่จากโครงสร้าง:
// กองไม่ใช่เงินได้เป็น 0 แล้ว การถอนครั้งถัดไปจึงไม่มีอะไรให้ดึงนอกจากเงินได้
{
  const flagged = (id, category, amount, taxable) =>
    ({ id, type: "CREDIT", category, amount, taxable, timestamp: tick() });
  const { computeRiderWht } = require(join(here, "..", "rider-wht.js"));
  const ON = { enabled: true, ratePercent: 3 };
  const base = [flagged("f1", "JOB_PAYOUT", 550, true), flagged("p1", "EXPENSE_REIMBURSEMENT", 20, false)];

  const first = splitWithdrawal([...base, withdraw("w1", 300)], "w1");
  eq("ถอน 300: ไม่ใช่เงินได้ 20 / เงินได้ 280", { exempt: first.exempt, taxable: first.taxable }, { exempt: 20, taxable: 280 });
  const w = computeRiderWht(300, "freelance", ON, { taxableBase: first.taxable });
  eq("ฐาน 280 ภาษี 8.40 โอน 291.60", { base: w.taxableBase, wht: w.wht, net: w.net }, { base: 280, wht: 8.4, net: 291.6 });

  // ครั้งถัดไป — ทั้งแบบที่แถวแรกถูกประทับ exempt_part แล้ว (ทางปกติ) และยังไม่ถูกประทับ
  // (trigger ยังไม่ทัน) ต้องได้ 270 เป็นเงินได้ล้วนทั้งคู่
  const stamped = splitWithdrawal([...base, withdraw("w1", 300, { exempt_part: 20 }), withdraw("w2", 270)], "w2");
  const unstamped = splitWithdrawal([...base, withdraw("w1", 300), withdraw("w2", 270)], "w2");
  eq("270 ที่เหลือเป็นเงินได้ล้วน (แถวแรกประทับแล้ว)", { exempt: stamped.exempt, taxable: stamped.taxable }, { exempt: 0, taxable: 270 });
  eq("270 ที่เหลือเป็นเงินได้ล้วน (แถวแรกยังไม่ประทับ)", { exempt: unstamped.exempt, taxable: unstamped.taxable }, { exempt: 0, taxable: 270 });
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
