"use strict";

/**
 * รีวิวคำขอเบิกค่าใช้จ่ายที่ไรเดอร์สำรองจ่าย (ค่าทางด่วน / ค่าจอดรถ)
 *
 * ครึ่งที่ไรเดอร์ยื่นอยู่ที่ `bkk-rider-app/functions/src/index.ts`
 * (`riderSubmitExpense`) — คนละ codebase เพราะตัวนี้ต้อง gate ด้วย
 * `lookupStaffByAuth` + `dispatchAdminPush` ซึ่งอยู่ที่นี่ทั้งคู่ ส่วนตัวนั้น
 * ถูกเรียกจากแอปไรเดอร์และอยู่ข้าง `riderRequestWithdraw` ที่มี pattern เดียวกัน
 * ดีไซน์เต็ม: `bkk-rider-app/docs/reports/2026-09-02-rider-expense-claim-design.md`
 *
 * กติกาที่ตั้งใจ:
 *
 *   - **idempotent เป็นข้อแรก ไม่ใช่ข้อสุดท้าย** — รายการที่ `status` ไม่ใช่
 *     `submitted` แล้วจะถูกปฏิเสธการรีวิวซ้ำ. การกดสองครั้ง (เน็ตช้า แล้วกดใหม่)
 *     คือความพังที่แพงที่สุดของฟีเจอร์นี้ เพราะมันเติมเงินเข้ากระเป๋าสองรอบ
 *     และไม่มีใครเห็นจนกว่าจะมีคนกระทบยอด
 *
 *   - **อนุมัติ = เขียนสามโหนดใน `update()` เดียว** (rider_expenses + transactions
 *     + expenses) เพื่อให้ไม่มีสภาพครึ่งๆ: เงินเข้ากระเป๋าแล้วแต่ไม่ลงบัญชี
 *     (กำไรสูงเกินจริง) หรือลงบัญชีแล้วแต่ไรเดอร์ไม่ได้เงิน
 *
 *   - **`needs_ceo` ตัดสินที่ตอนยื่น อ่านที่ตอนรีวิว** — ธงถูกประทับโดย
 *     `riderSubmitExpense` จากเพดานใน `settings/rider_expense` ตัวรีวิวไม่คำนวณ
 *     ใหม่ เพราะเพดานอาจถูกแก้ระหว่างทาง และสิ่งที่ยุติธรรมคือกติกา ณ วันที่ยื่น
 *
 *   - **`taxable` เขียนลงแถว ledger ตรงๆ ห้ามอนุมานจากชื่อหมวดทีหลัง** —
 *     คำตอบของนักบัญชีว่า "เงินคืนค่าทดรองเป็นเงินได้ไหม" ยังไม่มา แถวที่เขียน
 *     วันนี้ต้องอ่านได้ถูกไม่ว่าคำตอบจะออกทางไหน. ถ้าอนุมานจากหมวดทีหลัง
 *     การเปลี่ยนคำตอบจะเปลี่ยนความหมายของ**แถวเก่าทุกแถวย้อนหลัง** ซึ่งเป็น
 *     สิ่งที่ ledger ห้ามทำโดยนิยาม
 *
 *   - **ปฏิเสธไม่แตะเงินเลย** — ไม่มีแถว ledger ไม่มีแถวบัญชี มีแค่สถานะกับเหตุผล
 *
 * ชื่อ callable `adminReviewExpense` unique ระดับ project ตามกฎ {region}/{name}
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");

const REGION = "asia-southeast1";
const REVIEW_ROLES = ["CEO", "MANAGER"];
const MAX_REASON_LEN = 500;

/** หมวดใน /expenses ที่ P&L อ่าน — ค่าทางด่วน/ที่จอดรถเป็นค่าเดินทาง */
const EXPENSE_ACCOUNT_CATEGORY = "TRANSPORT";

const CATEGORY_LABEL_TH = {
  toll: "ค่าทางด่วน",
  parking: "ค่าที่จอดรถ",
  other: "ค่าใช้จ่ายอื่น",
};

const shortJob = (id) => String(id || "").slice(-4);

/**
 * สร้าง multi-path update ของการอนุมัติ — pure เพื่อให้เทสได้โดยไม่ต้องมี DB
 *
 * คืน `{ updates, txKey, amount }` ไม่ใช่เขียนเอง เพราะสิ่งที่ต้องพิสูจน์คือ
 * "เขียนอะไรบ้าง" ไม่ใช่ "เขียนสำเร็จไหม"
 */
function buildApprovalUpdates({ id, row, reviewer, txKey, expenseKey, now, taxable }) {
  const amount = Number(row.amount_thb) || 0;
  const label = CATEGORY_LABEL_TH[row.category] || CATEGORY_LABEL_TH.other;
  const jobRef = row.job_id ? ` งาน #${shortJob(row.job_id)}` : "";

  return {
    updates: {
      [`rider_expenses/${id}/status`]: "paid",
      [`rider_expenses/${id}/reviewed_by_staff_id`]: reviewer.id,
      [`rider_expenses/${id}/reviewed_by_name`]: reviewer.name,
      [`rider_expenses/${id}/reviewed_at`]: now,
      [`rider_expenses/${id}/paid_tx_id`]: txKey,
      [`rider_expenses/${id}/expense_doc_id`]: expenseKey,

      // เงินเข้ากระเป๋าไรเดอร์
      [`transactions/${txKey}`]: {
        rider_id: row.rider_id,
        amount,
        type: "CREDIT",
        category: "EXPENSE_REIMBURSEMENT",
        description: `คืนเงินสำรองจ่าย: ${label}${jobRef}`,
        ...(row.job_id ? { ref_job_id: row.job_id } : {}),
        // ดูเหตุผลที่ต้องเขียนตรงๆ ในหัวไฟล์
        taxable,
        rider_expense_id: id,
        created_at: now,
        timestamp: now,
      },

      // ต้นทุนของบริษัท — ไม่ลงตรงนี้ P&L จะรายงานกำไรสูงเกินจริงทุกเดือน
      // `source` แยกแถวที่ระบบสร้างออกจากแถวที่แอดมินคีย์มือ (กันนับซ้ำ
      // และทำให้ลบ/ตรวจย้อนหลังได้อย่างปลอดภัย)
      [`expenses/${expenseKey}`]: {
        title: `${label}${jobRef}`,
        amount,
        category: EXPENSE_ACCOUNT_CATEGORY,
        note: String(row.note || ""),
        created_at: now,
        logged_by: reviewer.name,
        source: "rider_expense",
        rider_id: row.rider_id,
        rider_expense_id: id,
      },
    },
    txKey,
    amount,
  };
}

function registerRiderExpenses({ dispatchAdminPush, pushToRider, staffIdsByRoles }) {
  const adminReviewExpense = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();

    const reviewer = await lookupStaffByAuth(db, request.auth);
    const role = String(reviewer?.role || "").toUpperCase();
    if (!reviewer || !REVIEW_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", "เฉพาะ CEO หรือ Manager เท่านั้น");
    }

    const id = String(request.data?.id || "");
    if (!id) throw new HttpsError("invalid-argument", "ไม่พบรหัสรายการ");

    const approve = request.data?.approve === true;
    const reason = String(request.data?.reason || "").trim().slice(0, MAX_REASON_LEN);
    if (!approve && reason === "") {
      throw new HttpsError("invalid-argument", "ระบุเหตุผลที่ปฏิเสธ");
    }

    const rowRef = db.ref(`rider_expenses/${id}`);
    const row = (await rowRef.get()).val();
    if (!row) throw new HttpsError("not-found", "ไม่พบรายการนี้");

    // ด่านกันจ่ายซ้ำ — ต้องอยู่ก่อนทุกการเขียน
    if (row.status !== "submitted") {
      throw new HttpsError(
        "failed-precondition",
        `รายการนี้ถูกดำเนินการไปแล้ว (${row.status})`
      );
    }

    // ธงถูกประทับตอนยื่นตามเพดาน ณ วันนั้น — ตัวรีวิวอ่านอย่างเดียว ไม่คำนวณใหม่
    if (row.needs_ceo === true && role !== "CEO") {
      throw new HttpsError("permission-denied", "รายการนี้เกินเพดาน ต้องให้ CEO อนุมัติ");
    }

    const now = Date.now();

    if (!approve) {
      await rowRef.update({
        status: "rejected",
        reviewed_by_staff_id: reviewer.id,
        reviewed_by_name: reviewer.name || "",
        reviewed_at: now,
        reject_reason: reason,
      });
      await pushToRider(
        db,
        row.rider_id,
        {
          notification: {
            title: "คำขอเบิกค่าใช้จ่ายถูกปฏิเสธ",
            body: reason,
          },
          data: { type: "rider_expense_rejected", expenseId: id },
        },
        "rider-expense-rejected"
      ).catch(() => undefined);
      return { ok: true, status: "rejected" };
    }

    const taxable =
      (await db.ref("settings/rider_expense/reimbursement_taxable").get()).val() === true;

    const { updates, amount } = buildApprovalUpdates({
      id,
      row,
      reviewer: { id: reviewer.id, name: reviewer.name || "" },
      txKey: db.ref("transactions").push().key,
      expenseKey: db.ref("expenses").push().key,
      now,
      taxable,
    });

    await db.ref().update(updates);

    await pushToRider(
      db,
      row.rider_id,
      {
        notification: {
          title: "อนุมัติคืนเงินสำรองจ่ายแล้ว",
          body: `฿${amount.toLocaleString("th-TH")} เข้ากระเป๋าเรียบร้อย`,
        },
        data: { type: "rider_expense_approved", expenseId: id },
      },
      "rider-expense-approved"
    ).catch(() => undefined);

    return { ok: true, status: "paid", amount };
  });

  return { adminReviewExpense };
}

module.exports = {
  registerRiderExpenses,
  buildApprovalUpdates,
  CATEGORY_LABEL_TH,
  EXPENSE_ACCOUNT_CATEGORY,
};
