"use strict";

/**
 * แยกยอดถอนหนึ่งครั้งเป็น "เงินได้" กับ "ไม่ใช่เงินได้" — pure ทั้งไฟล์
 *
 * (ชื่อไฟล์และหัวข้อข้างล่างพูดถึง "ค่าจ้าง vs เงินคืน" ซึ่งเป็นเคสแรกที่ทำให้
 * ต้องแยก ตั้งแต่ 4 ก.ย. 2569 กองไม่ใช่เงินได้รวมเครดิตบริษัทเติมให้กับเงินฝาก
 * ของไรเดอร์ด้วย และการจำแนกอ่านจากธง `taxable` บนแถว — ดู creditIsTaxable)
 *
 * ===================================================================
 * ทำไมต้องแยก และมันคือบั๊กที่กำลังจะเกิดถ้าไม่แยก
 * ===================================================================
 *
 * เจ้าของงานเคาะ (3 ก.ย. 2569) ว่าให้บันทึกค่าจ้างไรเดอร์เป็นค่าใช้จ่าย
 * **ตอนไรเดอร์ถอนเงิน** เพื่อให้ตรงกับจุดที่หัก WHT
 *
 * แต่กระเป๋าไรเดอร์ไม่ได้มีแต่ค่าจ้าง — มันมี `EXPENSE_REIMBURSEMENT`
 * (เงินคืนค่าทางด่วน/ที่จอดรถที่เขาสำรองจ่าย) ซึ่ง **ถูกบันทึกเป็นค่าใช้จ่าย
 * ไปแล้วตอนแอดมินอนุมัติ** (ดู `rider-expenses.js` → เขียน `/expenses`)
 *
 * ถ้าบันทึกยอดถอนทั้งก้อนเป็นค่าใช้จ่ายอีกครั้ง เงินคืนก้อนนั้นจะถูกนับสองรอบ
 * แล้วกำไรจะ **ต่ำ** เกินจริง ซึ่งอ่านย้อนหลังยากกว่าตอนสูงเกินจริง เพราะ
 * ไม่มีใครสงสัยตัวเลขที่ดูแย่กว่าความจริง
 *
 * ===================================================================
 * วิธีแยก — derive จาก ledger ไม่เพิ่ม state ใหม่
 * ===================================================================
 *
 *   poolคืนเงิน = Σ(CREDIT หมวด EXPENSE_REIMBURSEMENT ที่ผ่านมา)
 *              − Σ(ส่วนที่เป็นเงินคืนของการถอนที่ผ่านมาแล้ว)
 *
 *   ตอนถอน X:  reimbursed = min(X, poolคืนเงิน)     ← เคยลงบัญชีแล้ว ข้าม
 *              labour     = X − reimbursed          ← ค่าจ้าง ลงบัญชีตอนนี้
 *
 * **FIFO โดยปริยาย: เงินคืนออกก่อนค่าจ้าง** — เลือกทางนี้เพราะมันทำให้
 * "เงินคืนจะไม่ถูกนับเป็นค่าจ้างเลย" เป็นจริงเสมอ ไม่ว่าไรเดอร์จะถอนกี่ครั้ง
 * ส่วนทางกลับกัน (ค่าจ้างออกก่อน) จะทำให้ยอดค่าจ้างในเดือนแรกโป่ง แล้วเดือน
 * ท้ายๆ ติดลบ ซึ่งเป็นตัวเลขที่อธิบายกับบัญชีไม่ได้
 *
 * **นี่คือกลไกเดียวกับที่เอกสารออกแบบข้อ 0 เรียกว่า `wht_base` /
 * `non_taxable_part`** (P4 ของฟีเจอร์เบิกค่าใช้จ่าย) — เมื่อ P4 มาถึง ให้ใช้
 * ฟังก์ชันในไฟล์นี้ **ห้ามเขียนสูตรที่สอง** เพราะสองสูตรที่ควรตอบเท่ากันแต่
 * เขียนคนละที่ คือสิ่งที่ CLAUDE.md ทั้งไฟล์เตือนไว้
 */

/**
 * "แถวเงินเข้านี้เป็นเงินได้ไหม" — อ่าน**ธงบนแถว**ก่อน ชื่อหมวดเป็นแค่ fallback
 *
 * ตั้งแต่ 4 ก.ย. 2569 ทุกแถว CREDIT ถูกประทับ `taxable` ตอนเขียน (ตารางกลาง
 * `WALLET_CREDIT_TAXABLE` ใน `src/utils/transactionLogger.ts`) ตัวแยกจึงไม่ต้อง
 * รู้จักชื่อหมวดอีก — หมวดใหม่ในอนาคตแค่ประกาศธงตอนเขียนก็ถูกแยกถูกทันที
 *
 * fallback ตามหมวดมีไว้ให้**แถวเก่าที่เกิดก่อนมีธง**เท่านั้น: เงินคืนค่าทดรอง
 * (`EXPENSE_REIMBURSEMENT`) เป็นหมวดเดียวที่เคยเขียนแบบไม่ใช่เงินได้ก่อนหน้านั้น
 * ส่วนหมวดที่ไม่รู้จัก = เงินได้ (ทิศหักเกิน ซึ่งคืนได้ ไม่ใช่หักขาดที่ต้องไล่เก็บ)
 *
 * MIRROR ของตารางกลางฝั่ง TS — แก้ต้องแก้ทั้งคู่ (parity test ตรึงไว้)
 */
const NON_TAXABLE_CREDIT_CATEGORIES = new Set([
  "EXPENSE_REIMBURSEMENT",
  "COMPANY_ADVANCE",
  "RIDER_DEPOSIT",
]);

function creditIsTaxable(row) {
  if (row && typeof row.taxable === "boolean") return row.taxable;
  return !NON_TAXABLE_CREDIT_CATEGORIES.has(String(row && row.category));
}

/** หมวดที่ยังคงไว้ให้ผู้อ่านเดิม (rider-fee-expense) — ความหมายเดิม: เงินเข้าที่ยัง
 *  ไม่เคยลงบัญชี = ค่าจ้าง. ตอนนี้เท่ากับ "แถวที่ taxable" ทุกหมวดพอดี */
const LABOUR_CREDIT_CATEGORIES = new Set(["JOB_PAYOUT", "BONUS", "ADJUSTMENT"]);

const num = (v) => {
  if (typeof v !== "number" && typeof v !== "string") return 0;
  if (typeof v === "string" && v.trim() === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * แยกยอดถอนหนึ่งครั้งออกเป็นสองส่วน
 *
 * @param {Array} rows  แถวใน /transactions ของไรเดอร์คนนี้ **ทุกแถว**
 *                      (query ตาม index rider_id — ห้ามกวาดทั้ง node)
 * @param {string} txId id ของแถวถอนที่กำลังพิจารณา
 * @returns {{gross, taxable, exempt, labour, reimbursed}|null}
 *          taxable = ส่วนที่ดึงจากกองเงินได้ (ฐานภาษี + ค่าใช้จ่ายบริษัท)
 *          exempt  = ส่วนที่ดึงจากกองไม่ใช่เงินได้ (ออกก่อนเสมอ)
 *          `null` = ไม่ใช่แถวถอน หรือหาไม่เจอ
 */
function splitWithdrawal(rows, txId) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const target = list.find((r) => r.id === txId);
  if (!target || target.category !== "WITHDRAWAL") return null;

  const at = num(target.timestamp) || num(target.created_at);

  // เรียงตามเวลา แล้วตัดที่แถวเป้าหมาย — "ที่ผ่านมา" ต้องหมายถึงก่อนแถวนี้
  // จริงๆ ไม่ใช่ทั้งหมด ไม่งั้นการถอนครั้งเก่าจะถูกคิดด้วย pool ของอนาคต
  const timeOf = (r) => num(r.timestamp) || num(r.created_at);
  const before = list.filter((r) => {
    const t = timeOf(r);
    if (t < at) return true;
    // เวลาเท่ากัน (เขียนพร้อมกัน) ตัดด้วย id เพื่อให้ลำดับคงที่ทุกครั้งที่รัน
    return t === at && String(r.id) < String(txId);
  });

  // กองเงินที่ไม่ใช่เงินได้ (เงินคืน / เครดิตบริษัท / เงินฝาก) — ถูกดึงออกก่อนเสมอ
  let pool = 0;
  for (const r of before) {
    if (r.type === "CREDIT" && !creditIsTaxable(r)) {
      pool += num(r.amount);
    }
    if (r.type === "DEBIT" && r.category === "WITHDRAWAL") {
      // การถอนที่ผ่านมากินกองนี้ไปเท่าไร — ถ้าแถวเก่ามีฟิลด์บันทึกไว้แล้วใช้
      // ค่านั้น (ตัวเลขที่ลงบัญชีไปแล้วห้ามคำนวณใหม่ให้ต่างจากเดิม)
      // ไม่มี = คิดด้วยกฎเดียวกันแบบ FIFO
      const recorded = r.exempt_part != null ? r.exempt_part : r.reimbursed_part;
      pool -= recorded == null ? Math.min(num(r.amount), Math.max(pool, 0)) : num(recorded);
    }
  }
  pool = Math.max(0, pool);

  const gross = num(target.amount);
  const exempt = round2(Math.min(gross, pool));
  const taxable = round2(gross - exempt);
  // `reimbursed`/`labour` = ชื่อเดิมของสองก้อนนี้ (ก่อนมีเครดิตบริษัท/เงินฝาก)
  // คงไว้ให้ผู้อ่านเดิม — ความหมายทางบัญชียังตรง: labour = ส่วนที่บริษัทลง
  // เป็นค่าใช้จ่ายตอนถอน ซึ่งคือส่วนที่เป็นเงินได้ของไรเดอร์พอดี
  return { gross: round2(gross), exempt, taxable, reimbursed: exempt, labour: taxable };
}

module.exports = {
  splitWithdrawal,
  creditIsTaxable,
  NON_TAXABLE_CREDIT_CATEGORIES,
  LABOUR_CREDIT_CATEGORIES,
};
