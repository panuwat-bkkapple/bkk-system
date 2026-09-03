"use strict";

/**
 * แยก "ค่าจ้าง" ออกจาก "เงินคืนค่าทดรอง" ในยอดถอนหนึ่งครั้ง — pure ทั้งไฟล์
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

/** หมวดที่เป็น "เงินคืนค่าทดรอง" — เคยลงบัญชีตอนอนุมัติแล้ว
 *  MIRROR ของ RIDER_WALLET_CATEGORIES: bkk-rider-app/src/utils/walletLedger.ts */
const REIMBURSEMENT_CATEGORIES = new Set(["EXPENSE_REIMBURSEMENT"]);

/** หมวดที่เป็นเงินเข้ากระเป๋าและ **ยังไม่เคย** ลงบัญชี = ค่าจ้าง/โบนัส/ปรับยอด */
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
 * @returns {{labour: number, reimbursed: number, gross: number}|null}
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

  let pool = 0;
  for (const r of before) {
    if (r.type === "CREDIT" && REIMBURSEMENT_CATEGORIES.has(String(r.category))) {
      pool += num(r.amount);
    }
    if (r.type === "DEBIT" && r.category === "WITHDRAWAL") {
      // การถอนที่ผ่านมากินเงินคืนไปเท่าไร — ถ้าแถวเก่ามีฟิลด์บันทึกไว้แล้วใช้
      // ค่านั้น (ตัวเลขที่ลงบัญชีไปแล้วห้ามคำนวณใหม่ให้ต่างจากเดิม)
      // ไม่มี = คิดด้วยกฎเดียวกันแบบ FIFO
      const recorded = r.reimbursed_part;
      pool -= recorded == null ? Math.min(num(r.amount), Math.max(pool, 0)) : num(recorded);
    }
  }
  pool = Math.max(0, pool);

  const gross = num(target.amount);
  const reimbursed = round2(Math.min(gross, pool));
  return { gross: round2(gross), reimbursed, labour: round2(gross - reimbursed) };
}

module.exports = {
  splitWithdrawal,
  REIMBURSEMENT_CATEGORIES,
  LABOUR_CREDIT_CATEGORIES,
};
