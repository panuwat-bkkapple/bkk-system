"use strict";

/**
 * ขั้นตอนของใบเบิกค่าใช้จ่ายที่ไรเดอร์สำรองจ่าย (ค่าทางด่วน / ค่าจอดรถ)
 *
 * ครึ่งที่ไรเดอร์ยื่นอยู่ที่ `bkk-rider-app/functions/src/index.ts`
 * (`riderSubmitExpense`) — คนละ codebase เพราะตัวนี้ต้อง gate ด้วย
 * `lookupStaffByAuth` + `dispatchAdminPush` ซึ่งอยู่ที่นี่ทั้งคู่
 * ดีไซน์เต็ม: `bkk-rider-app/docs/reports/2026-09-02-rider-expense-claim-design.md`
 *
 * **เส้นทางที่เจ้าของงานกำหนด (4 ก.ย. 2569) — ตารางอยู่ที่
 * `rider-expense-flow.js` ที่เดียว ห้ามกระจายเป็น if ที่นี่:**
 *
 *   ไรเดอร์ตั้งเบิก → หัวหน้า/แอดมินไรเดอร์ตรวจว่างานนั้นวิ่งจริง (`ops_approve`)
 *   → ฝ่ายบัญชีตรวจเอกสารแล้วตั้งเบิก (`finance_approve`) → ฝ่ายบัญชีจ่ายเงิน
 *   (`pay`) → ออกเอกสารใบสำคัญเงินสดย่อย (งานถัดไป ยังไม่อยู่ในไฟล์นี้)
 *
 * กติกาที่ตั้งใจ:
 *
 *   - **เงินขยับที่ `pay` ที่เดียว** และบังคับด้วยโครงสร้าง: ตัวจ่ายถูกเรียก
 *     ก็ต่อเมื่อ `resolveTransition` ตอบ `movesMoney` เท่านั้น ซึ่งตารางบังคับ
 *     ให้เป็นจริงได้แถวเดียว. **ก่อนหน้านี้การกดอนุมัติครั้งเดียวเครดิตกระเป๋า
 *     ทันที** = คนที่ตรวจว่า "วิ่งงานนั้นจริงไหม" เป็นคนสั่งจ่ายเงินไปด้วยในตัว
 *     ซึ่งเป็นการรวมหน้าที่ที่ระบบบัญชีมีไว้แยก
 *
 *   - **idempotent เป็นข้อแรก ไม่ใช่ข้อสุดท้าย** — ทุกคำสั่งต้องผ่านตาราง
 *     transition ก่อนแตะอะไร: สถานะปลายทาง (`paid`/`rejected`) ออกไม่ได้ และ
 *     ข้ามขั้นไม่ได้. การกดสองครั้ง (เน็ตช้าแล้วกดใหม่) คือความพังที่แพงที่สุด
 *     ของฟีเจอร์นี้ เพราะมันเติมเงินสองรอบและไม่มีใครเห็นจนกว่าจะกระทบยอด
 *
 *   - **จ่าย = เขียนสามโหนดใน `update()` เดียว** (rider_expenses + transactions
 *     + expenses) เพื่อให้ไม่มีสภาพครึ่งๆ: เงินเข้ากระเป๋าแล้วแต่ไม่ลงบัญชี
 *     (กำไรสูงเกินจริง) หรือลงบัญชีแล้วแต่ไรเดอร์ไม่ได้เงิน
 *
 *   - **`needs_ceo` ตัดสินที่ตอนยื่น อ่านที่ตอนรีวิว** — ธงถูกประทับโดย
 *     `riderSubmitExpense` จากเพดานใน `settings/rider_expense` ตัวนี้ไม่คำนวณ
 *     ใหม่ เพราะเพดานอาจถูกแก้ระหว่างทาง และสิ่งที่ยุติธรรมคือกติกา ณ วันที่ยื่น
 *
 *   - **`taxable` เขียนลงแถว ledger ตรงๆ ห้ามอนุมานจากชื่อหมวดทีหลัง** —
 *     ถ้าอนุมานจากหมวด การเปลี่ยนคำตอบทางบัญชีจะเปลี่ยนความหมายของ**แถวเก่า
 *     ทุกแถวย้อนหลัง** ซึ่งเป็นสิ่งที่ ledger ห้ามทำโดยนิยาม
 *     (คำตอบที่ได้แล้ว 4 ก.ย. 2569: เงินคืนค่าทดรอง **ไม่ใช่เงินได้** ไม่หัก 3%
 *     — ตรงกับค่าเริ่มต้นที่เขียนไว้อยู่แล้ว ไม่ต้อง backfill)
 *
 *   - **ตีกลับ/ปฏิเสธไม่แตะเงินเลย** — ไม่มีแถว ledger ไม่มีแถวบัญชี
 *     มีแค่สถานะ เหตุผล และแถวประวัติ
 *
 * ชื่อ callable `adminReviewExpense` unique ระดับ project ตามกฎ {region}/{name}
 * — **ไม่เปลี่ยนชื่อแม้ความหมายกว้างขึ้น** เพราะการเปลี่ยนชื่อ = Cloud Run
 * service ตัวใหม่ + ตัวเก่าค้างเป็นกำพร้าที่ยังรับ request ได้อยู่
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const { financeActorVerdict } = require("./finance-claims");
const { GATE, resolveTransition } = require("./rider-expense-flow");

const REGION = "asia-southeast1";

/** หัวหน้า/แอดมินฝั่งไรเดอร์ — ตรวจว่างานนั้นวิ่งจริง ไม่ได้แตะเงิน */
const OPS_ROLES = ["CEO", "MANAGER"];

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
 * แถวที่ทุก transition เขียนเหมือนกัน — pure เพื่อให้เทสได้โดยไม่ต้องมี DB
 *
 * `reviewed_by_*`/`reviewed_at` = **คนที่ทำล่าสุด** ไม่ใช่ "คนอนุมัติ" อีกต่อไป
 * แต่ยังเขียนต่อเพราะมีคนอ่านอยู่ (`src/pages/finance/RiderExpenses.tsx`) —
 * ย้าย writer โดยไม่ดูว่าใครอ่านของเดิมคือบั๊กที่ CLAUDE.md จดไว้แล้วหนึ่งรอบ
 *
 * `history/{key}` คือสิ่งที่ตอบคำถามของฝ่ายบัญชีว่า "ใครอนุมัติขั้นไหนเมื่อไร"
 * ซึ่งฟิลด์เดี่ยวตอบไม่ได้เมื่อใบหนึ่งเดินวนผ่านการตีกลับหลายรอบ
 */
function buildTransitionUpdates({ id, action, from, to, actor, now, reason, historyKey }) {
  const text = String(reason || "").trim().slice(0, MAX_REASON_LEN);
  return {
    [`rider_expenses/${id}/status`]: to,
    [`rider_expenses/${id}/reviewed_by_staff_id`]: actor.id,
    [`rider_expenses/${id}/reviewed_by_name`]: actor.name,
    [`rider_expenses/${id}/reviewed_at`]: now,
    [`rider_expenses/${id}/review_reason`]: text || null,
    // คนอ่านเดิมรู้จักแค่ชื่อนี้ — เขียนคู่ไว้จนกว่าจะไม่มีจอไหนอ่านมันแล้ว
    ...(action === "reject" ? { [`rider_expenses/${id}/reject_reason`]: text } : {}),
    [`rider_expenses/${id}/history/${historyKey}`]: {
      at: now,
      action,
      from,
      to,
      by_staff_id: actor.id,
      by_name: actor.name,
      ...(text ? { reason: text } : {}),
    },
  };
}

/**
 * multi-path update ของ**ขั้นจ่ายเงิน** — pure ด้วยเหตุผลเดียวกัน
 *
 * คืน `{ updates, txKey, amount }` ไม่ใช่เขียนเอง เพราะสิ่งที่ต้องพิสูจน์คือ
 * "เขียนอะไรบ้าง" ไม่ใช่ "เขียนสำเร็จไหม"
 *
 * ชื่อเดิมคือ `buildApprovalUpdates` — เปลี่ยนเพราะการอนุมัติกับการจ่ายเงิน
 * แยกขั้นกันแล้ว ชื่อเดิมจะอ่านเหมือนว่าอนุมัติแล้วเงินออกทันที ซึ่งคือ
 * พฤติกรรมเก่าที่งานนี้มาแก้พอดี
 */
function buildPaymentUpdates({
  id, row, actor, txKey, expenseKey, now, taxable, from, to, historyKey,
}) {
  const amount = Number(row.amount_thb) || 0;
  const label = CATEGORY_LABEL_TH[row.category] || CATEGORY_LABEL_TH.other;
  const jobRef = row.job_id ? ` งาน #${shortJob(row.job_id)}` : "";

  return {
    updates: {
      ...buildTransitionUpdates({
        id, action: "pay", from, to, actor, now, reason: "", historyKey,
      }),
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
        logged_by: actor.name,
        source: "rider_expense",
        rider_id: row.rider_id,
        rider_expense_id: id,
      },
    },
    txKey,
    amount,
  };
}

/**
 * ใครกดขั้นนี้ได้ — pure เพื่อให้ตารางสิทธิ์มีเทสจริง ไม่ใช่ if ที่ฝังใน callable
 *
 * แยกออกมาเพราะนี่คือส่วนที่ **ผิดแล้วเงียบที่สุด**: ปล่อยผิดคนแล้วเงินออกโดยไม่มี
 * error ที่ไหน. ตอนอยู่ใน callable ไม่มีเทสตัวไหนแตะมันได้เลย (ต้องมี Firebase)
 *
 * `needsCeo` บังคับที่ **ทั้งสองขั้นของฝ่ายบัญชี** ไม่ใช่แค่ปุ่มจ่าย — การตั้งเบิก
 * คือการผูกพันเงินก้อนนั้น (ยอดค้างจ่ายที่บัญชีเห็นต้องเป็นยอดที่ CEO เห็นชอบ
 * แล้ว) ปล่อยให้ตั้งเบิกได้ก่อนแปลว่ายอดใหญ่ไปนอนในคิวค้างจ่ายโดย CEO ยังไม่รู้
 * (ตัวเอกสารใบสำคัญเงินสดย่อยออกตอน `pay` — rider-expense-voucher.js)
 *
 * @returns {{ok: true}|{ok: false, message: string}}
 */
function authorizeExpenseAction({ gate, staff, token, needsCeo }) {
  const role = String((staff && staff.role) || "").toUpperCase();

  if (gate === GATE.OPS) {
    if (!OPS_ROLES.includes(role)) {
      return { ok: false, message: "ขั้นนี้เป็นของหัวหน้าไรเดอร์หรือผู้จัดการ" };
    }
    return { ok: true };
  }

  if (gate === GATE.FINANCE) {
    if (!financeActorVerdict(staff, token).allowed) {
      return {
        ok: false,
        message: "ขั้นนี้เป็นของฝ่ายบัญชี — ให้ CEO เปิดสิทธิ์จ่ายเงินออกให้บัญชีนี้ก่อน",
      };
    }
    // ธงถูกประทับตอนยื่นตามเพดาน ณ วันนั้น — ตรงนี้อ่านอย่างเดียว ไม่คำนวณใหม่
    if (needsCeo === true && role !== "CEO") {
      return { ok: false, message: "รายการนี้เกินเพดาน ต้องให้ CEO อนุมัติ" };
    }
    return { ok: true };
  }

  // ตารางบังคับให้ทุกแถวระบุประตูได้ (มีเทสตรึง) — มาถึงตรงนี้แปลว่ามีคนเพิ่ม
  // สถานะใหม่โดยไม่ได้บอกว่าใครกดได้ ปฏิเสธไว้ก่อนดีกว่าเดา
  return { ok: false, message: "ขั้นนี้ยังไม่ได้กำหนดผู้มีสิทธิ์" };
}

/** ข้อความที่ไรเดอร์เห็นบนหน้าจอล็อก — เงียบไปเลยแปลว่าเขาไม่รู้ว่าใบไปถึงไหน */
const RIDER_PUSH = {
  ops_approve: () => ({
    title: "หัวหน้าอนุมัติใบเบิกแล้ว",
    body: "ส่งต่อให้ฝ่ายบัญชีตรวจเอกสารแล้ว",
    type: "rider_expense_ops_approved",
  }),
  finance_approve: () => ({
    title: "ฝ่ายบัญชีตั้งเบิกแล้ว",
    body: "รอรอบการจ่ายเงิน",
    type: "rider_expense_finance_approved",
  }),
  pay: (amount) => ({
    title: "คืนเงินสำรองจ่ายแล้ว",
    body: `฿${Number(amount).toLocaleString("th-TH")} เข้ากระเป๋าเรียบร้อย`,
    // ชื่อเดิม — แอปไรเดอร์รู้จักอยู่แล้ว ไม่เปลี่ยนโดยไม่จำเป็น
    type: "rider_expense_approved",
  }),
  send_back: (_a, reason) => ({
    title: "ใบเบิกถูกส่งกลับให้แก้ไข",
    body: reason,
    type: "rider_expense_needs_info",
  }),
  reject: (_a, reason) => ({
    title: "คำขอเบิกค่าใช้จ่ายถูกปฏิเสธ",
    body: reason,
    type: "rider_expense_rejected",
  }),
};

function registerRiderExpenses({ dispatchAdminPush, pushToRider, staffIdsByRoles }) {
  const adminReviewExpense = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();

    const staff = await lookupStaffByAuth(db, request.auth);
    if (!staff) throw new HttpsError("permission-denied", "ไม่พบบัญชีพนักงาน");
    const actor = { id: staff.id, name: staff.name || "" };

    const id = String(request.data?.id || "");
    if (!id) throw new HttpsError("invalid-argument", "ไม่พบรหัสรายการ");

    // **ไม่มี fallback จาก `approve: true` ของโปรโตคอลเดิมโดยตั้งใจ** — แท็บที่
    // ค้างไว้ก่อน deploy จะได้ข้อความให้รีเฟรช ไม่ใช่ถูกเดาให้เป็นขั้นใดขั้นหนึ่ง
    // การเดาผิดที่นี่คือการจ่ายเงินโดยข้ามฝ่ายบัญชี
    const action = String(request.data?.action || "");
    if (!action) {
      throw new HttpsError(
        "invalid-argument",
        "หน้าจอเป็นเวอร์ชันเก่า — รีเฟรชหน้าจอแล้วลองใหม่"
      );
    }

    const rowRef = db.ref(`rider_expenses/${id}`);
    const row = (await rowRef.get()).val();
    if (!row) throw new HttpsError("not-found", "ไม่พบรายการนี้");

    const from = String(row.status || "");
    const t = resolveTransition(action, from);
    if (!t.ok) {
      const code = t.code === "unknown_action" ? "invalid-argument" : "failed-precondition";
      throw new HttpsError(code, t.message);
    }

    const reason = String(request.data?.reason || "").trim().slice(0, MAX_REASON_LEN);
    if (t.needsReason && reason === "") {
      throw new HttpsError("invalid-argument", "ระบุเหตุผลให้ไรเดอร์ทราบ");
    }

    const auth = authorizeExpenseAction({
      gate: t.gate,
      staff,
      token: request.auth && request.auth.token,
      needsCeo: row.needs_ceo === true,
    });
    if (!auth.ok) throw new HttpsError("permission-denied", auth.message);

    const now = Date.now();
    const historyKey = db.ref(`rider_expenses/${id}/history`).push().key;

    if (!t.movesMoney) {
      await db.ref().update(
        buildTransitionUpdates({
          id, action, from, to: t.to, actor, now, reason, historyKey,
        })
      );

      const push = RIDER_PUSH[action];
      if (push) {
        const p = push(0, reason);
        await pushToRider(
          db,
          row.rider_id,
          {
            notification: { title: p.title, body: p.body },
            data: { type: p.type, expenseId: id },
          },
          `rider-expense-${action}`
        ).catch(() => undefined);
      }

      // ใบที่ผ่านหัวหน้าแล้วต้องมีคนรู้ว่ามันมาถึงคิวบัญชี ไม่งั้นมันนอนรอ
      // โดยที่ไรเดอร์คิดว่าอนุมัติแล้ว — badge ฝั่งบัญชีนับ `approved` ให้
      if (action === "ops_approve" && staffIdsByRoles && dispatchAdminPush) {
        try {
          const targets = await staffIdsByRoles(db, ["CEO", "FINANCE"]);
          if (targets.size > 0) {
            await dispatchAdminPush(
              {
                data: {
                  type: "rider_expense_finance_queue",
                  expenseId: id,
                  title: "ใบเบิกไรเดอร์รอฝ่ายบัญชี",
                  body: `฿${(Number(row.amount_thb) || 0).toLocaleString("th-TH")} — ${
                    CATEGORY_LABEL_TH[row.category] || CATEGORY_LABEL_TH.other
                  }`,
                  click_action: "/rider-expenses",
                },
              },
              `adminReviewExpense(${id})`,
              "admin",
              targets
            );
          }
        } catch (e) {
          // แจ้งเตือนพลาดต้องไม่ทำให้การอนุมัติที่สำเร็จแล้วดูเหมือนล้มเหลว
          console.error(`[riderExpense] finance queue push failed ${id}: ${e && e.message}`);
        }
      }

      return { ok: true, status: t.to };
    }

    // --- ขั้นเดียวที่เงินขยับ ------------------------------------------------
    const taxable =
      (await db.ref("settings/rider_expense/reimbursement_taxable").get()).val() === true;

    const { updates, amount } = buildPaymentUpdates({
      id,
      row,
      actor,
      txKey: db.ref("transactions").push().key,
      expenseKey: db.ref("expenses").push().key,
      now,
      taxable,
      from,
      to: t.to,
      historyKey,
    });

    await db.ref().update(updates);

    const p = RIDER_PUSH.pay(amount);
    await pushToRider(
      db,
      row.rider_id,
      {
        notification: { title: p.title, body: p.body },
        data: { type: p.type, expenseId: id },
      },
      "rider-expense-paid"
    ).catch(() => undefined);

    return { ok: true, status: t.to, amount };
  });

  return { adminReviewExpense };
}

module.exports = {
  registerRiderExpenses,
  authorizeExpenseAction,
  buildTransitionUpdates,
  buildPaymentUpdates,
  CATEGORY_LABEL_TH,
  EXPENSE_ACCOUNT_CATEGORY,
  OPS_ROLES,
};
