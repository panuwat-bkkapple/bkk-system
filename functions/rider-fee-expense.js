"use strict";

/**
 * บันทึกค่าจ้างไรเดอร์เป็นค่าใช้จ่ายของบริษัท — ตอนที่ไรเดอร์ถอนเงิน
 *
 * ===================================================================
 * ปัญหาที่แก้ (ตรวจแล้ว 3 ก.ย. 2569)
 * ===================================================================
 *
 * `/financial-report` คิดกำไรสุทธิว่า
 *   `grossProfit + serviceBase − opex − riderFeeAbsorbed`
 * โดย `opex` มาจาก `/expenses` ซึ่ง **ไม่มีผู้เขียนฝั่ง server เลยสักตัว**
 * (ผู้เขียนรายเดียวคือฟอร์มคีย์มือที่ `DailyExpenses.tsx`) และ
 * `riderFeeAbsorbed` คือ *ส่วนลดค่าบริการที่ให้ลูกค้า* ไม่ใช่เงินที่จ่ายไรเดอร์
 * ส่วน `cogs` มาจาก `stock_cost` = ราคารับซื้อเครื่องล้วน
 *
 * แปลว่า **ค่าจ้างไรเดอร์ทุกบาทไม่เคยปรากฏใน P&L** กำไรรายเดือนจึงสูงเกินจริง
 * เท่ากับค่าจ้างไรเดอร์ทั้งเดือน ยืนยันกับเจ้าของงานแล้วว่าไม่มีใครคีย์มือ
 *
 * ===================================================================
 * จุดที่บันทึก: **ตอนถอน** (เจ้าของงานเคาะ 3 ก.ย. 2569)
 * ===================================================================
 *
 * ให้ตรงกับจุดที่หัก WHT (ดูหัวข้อ "ภาษีหัก ณ ที่จ่าย ค่าตอบแทนไรเดอร์" ใน
 * CLAUDE.md) — หลักฐานคือสลิปโอน และแถวเดียวกันถือทั้งค่าใช้จ่ายกับภาษี
 *
 * **ข้อแลกที่รับแล้วและต้องรู้เวลาอ่านรายงาน:** P&L รายเดือนจะเลื่อนตาม
 * พฤติกรรมการถอนของไรเดอร์ ไม่ใช่ตามเดือนที่งานเกิด — ไรเดอร์ที่ไม่ถอน
 * สองเดือนจะทำให้ต้นทุนของงานเดือน ม.ค. ไปโผล่ใน P&L เดือน มี.ค.
 * (ทางเลือกอีกทางคือบันทึกตอนอนุมัติค่ารอบเข้ากระเป๋า ซึ่งตรงตามเกณฑ์สิทธิ์
 * มากกว่า แต่ไม่ตรงกับ WHT — เจ้าของงานเลือกความสอดคล้องกับ WHT)
 *
 * ===================================================================
 * กติกาที่ห้ามพลาด
 * ===================================================================
 *
 * 1. **นับเฉพาะส่วนที่เป็นค่าจ้าง** — ยอดถอนมีเงินคืนค่าทดรองปนได้ ซึ่ง
 *    ลงบัญชีไปแล้วตอนอนุมัติ (`rider-expenses.js`) การนับทั้งก้อนคือนับซ้ำ
 *    ตัวแยกอยู่ `rider-cost-split.js` **สูตรเดียวห้ามเขียนที่สอง**
 * 2. **ยอดที่ลงคือยอดเต็ม (gross) ไม่ใช่ยอดที่โอนจริง (net_paid)** — WHT ที่
 *    หักไว้เป็นเงินของไรเดอร์ที่บริษัทนำส่งแทน ไม่ใช่เงินที่บริษัทเก็บไว้
 *    ต้นทุนของบริษัทคือค่าจ้างเต็มจำนวน
 * 3. **idempotent ด้วยคีย์ที่คำนวณจาก txId** (`RF_{txId}`) ไม่ใช่ push key —
 *    trigger ยิงซ้ำได้ (redeploy, retry ของ Cloud Functions) และการนับต้นทุน
 *    ซ้ำคือสิ่งเดียวที่งานนี้มีไว้กำจัด
 * 4. **`source: "rider_withdrawal"` บนแถว** — แยกจากแถวที่แอดมินคีย์มือได้
 *    ทำให้หน้ารายงานแยกบรรทัดได้ และลบ/แก้ย้อนหลังได้อย่างปลอดภัย
 * 5. **query `/transactions` ตาม index `rider_id` เท่านั้น** ห้ามกวาดทั้ง node
 *    (กฎค่า RTDB ใน CLAUDE.md)
 *
 * ชื่อ function `onRiderWithdrawalExpense` unique ระดับ project ตามกฎ
 * `{region}/{name}` — ห้ามตั้งชื่อทั่วไปอย่าง `onTransactionCreated`
 */

const { onValueCreated } = require("firebase-functions/v2/database");
const { getDatabase } = require("firebase-admin/database");
const { splitWithdrawal } = require("./rider-cost-split");

const REGION = "asia-southeast1";

/** หมวดใน /expenses ที่ P&L อ่าน — ค่าวิ่งคือค่าเดินทาง */
const EXPENSE_CATEGORY = "TRANSPORT";
/** ค่าของฟิลด์ `source` — หน้ารายงานใช้ค่านี้แยกบรรทัด **ห้ามเปลี่ยนคำ** */
const EXPENSE_SOURCE = "rider_withdrawal";

/** คีย์ของแถวค่าใช้จ่าย — คำนวณจาก txId ให้รันซ้ำได้ผลเดียว */
const expenseKeyFor = (txId) => `RF_${txId}`;

/**
 * ประกอบแถวที่จะเขียน — pure เพื่อให้เทสได้โดยไม่ต้องมี DB
 * คืน `null` เมื่อไม่มีอะไรต้องลงบัญชี (ถอนเงินคืนล้วน)
 */
function buildFeeExpense({ txId, split, riderId, riderName, now }) {
  if (!split || split.labour <= 0) return null;
  return {
    title: `ค่ารอบไรเดอร์${riderName ? ` — ${riderName}` : ""}`,
    amount: split.labour,
    category: EXPENSE_CATEGORY,
    note:
      split.reimbursed > 0
        ? `จากการถอนเงิน ${split.gross.toLocaleString("th-TH")} บาท (หักส่วนที่เป็นเงินคืนค่าทดรอง ${split.reimbursed.toLocaleString("th-TH")} บาท ซึ่งลงบัญชีไปแล้วตอนอนุมัติ)`
        : `จากการถอนเงินของไรเดอร์`,
    created_at: now,
    logged_by: "ระบบ (อัตโนมัติ)",
    source: EXPENSE_SOURCE,
    rider_id: riderId,
    withdrawal_tx_id: txId,
  };
}

function registerRiderFeeExpense() {
  const onRiderWithdrawalExpense = onValueCreated(
    { ref: "/transactions/{txId}", region: REGION },
    async (event) => {
      try {
        const tx = event.data.val();
        if (!tx || tx.category !== "WITHDRAWAL" || tx.type !== "DEBIT") return;

        const riderId = tx.rider_id;
        if (!riderId) return;

        const txId = event.params.txId;
        const db = getDatabase();

        // กันเขียนซ้ำก่อนทำอะไรทั้งสิ้น — trigger ยิงซ้ำได้จริง
        const key = expenseKeyFor(txId);
        if ((await db.ref(`expenses/${key}`).get()).exists()) {
          console.log(`[riderFeeExpense] ${txId}: already recorded, skip`);
          return;
        }

        // query ตาม index rider_id — ห้ามกวาด /transactions ทั้ง node
        const snap = await db
          .ref("transactions")
          .orderByChild("rider_id")
          .equalTo(riderId)
          .get();
        const rows = [];
        snap.forEach((c) => {
          rows.push({ id: c.key, ...(c.val() || {}) });
          return false;
        });

        const split = splitWithdrawal(rows, txId);
        if (!split) {
          console.warn(`[riderFeeExpense] ${txId}: split returned null`);
          return;
        }

        const now = Date.now();
        const row = buildFeeExpense({
          txId,
          split,
          riderId,
          riderName: (await db.ref(`riders/${riderId}/name`).get()).val() || "",
          now,
        });

        // บันทึกส่วนที่เป็นเงินคืนไว้บนแถวถอนเสมอ **แม้จะเป็น 0** — การถอน
        // ครั้งถัดไปอ่านค่านี้เพื่อไม่ให้ pool ถูกใช้ซ้ำ ถ้าไม่เขียนไว้
        // ตัวแยกต้องเดาย้อนหลัง ซึ่งเดาถูกแต่เปราะกว่า
        const updates = {
          [`transactions/${txId}/reimbursed_part`]: split.reimbursed,
          [`transactions/${txId}/labour_part`]: split.labour,
        };
        if (row) updates[`expenses/${key}`] = row;
        await db.ref().update(updates);

        console.log(
          `[riderFeeExpense] ${txId}: gross=${split.gross} labour=${split.labour} reimbursed=${split.reimbursed}${row ? "" : " (no expense row)"}`
        );
      } catch (e) {
        // ต้องไม่ทำให้ท่อถอนเงินพัง — ค่าใช้จ่ายที่ลงไม่ได้ยังตามเก็บได้
        // จากแถวถอน (`labour_part`) แต่การถอนที่ล้มคือเงินที่ไรเดอร์ไม่ได้รับ
        console.error("[riderFeeExpense] failed:", e);
      }
    }
  );

  return { onRiderWithdrawalExpense };
}

module.exports = {
  registerRiderFeeExpense,
  buildFeeExpense,
  expenseKeyFor,
  EXPENSE_CATEGORY,
  EXPENSE_SOURCE,
};
