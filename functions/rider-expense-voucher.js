"use strict";

/**
 * ใบสำคัญเงินสดย่อยของใบเบิกไรเดอร์ — ออกอัตโนมัติเมื่อฝ่ายบัญชีกดจ่าย
 *
 * ขั้นสุดท้ายของเส้นทางที่เจ้าของงานกำหนด: ... → บัญชีจ่ายเงิน → **ออกเอกสาร**
 * นักบัญชียืนยัน (4 ก.ย. 2569) ว่ารายการนี้เป็นเงินสดย่อย ไม่หัก 3% ไม่ต้องมี
 * ใบเสร็จในนามบริษัท แต่ต้องมี "ใบสำคัญแทนใบเสร็จรับเงิน / ใบสำคัญเงินสดย่อย"
 * แนบกับสลิปการจ่าย — เอกสารนี้คือสิ่งที่ทำให้แถวใน /expenses อธิบายได้ตอนถูกตรวจ
 *
 * ทำไมเป็น trigger ไม่ใช่ทำใน callable `adminReviewExpense`:
 *   - การจ่าย (เขียนสามโหนด atomic) ต้องไม่ล้มเพราะสร้าง PDF ไม่ได้ — เอกสาร
 *     เป็น best-effort ที่**ต้องอธิบายได้เมื่อล้ม** ไม่ใช่เงื่อนไขของการจ่าย
 *   - ผูกกับข้อมูลที่ลงแล้ว (status = paid) เชื่อถือได้กว่าผูกกับ session ของคนกด
 *     ซึ่งปิดเบราว์เซอร์ได้ก่อน PDF เสร็จ
 *   รูปแบบเดียวกับ `onRiderWhtWithheld` (rider-wht-issue.js)
 *
 * กติกาที่ตั้งใจ:
 *   - **idempotent ก่อนทำอะไรทั้งสิ้น** — มี `rider_expenses/{id}/petty_cash_voucher`
 *     แล้วไม่ออกซ้ำ (trigger ยิงซ้ำได้จริง เลขเอกสารซ้ำคือของที่แก้ย้อนหลังไม่ได้)
 *   - **เลขห้ามหายเงียบ** — เลขถูกจอง*ก่อน*สร้าง PDF ถ้าสร้างไม่สำเร็จต้องลง
 *     ทะเบียนเป็น `status: "void"` พร้อมเหตุผล (กติกาเดียวกับใบกำกับภาษี/50 ทวิ)
 *   - **`accounting_documents` type ใหม่ `petty_cash_voucher`** — หน้า ภ.พ.30 /
 *     P&L กรองด้วย `type === 'tax_invoice' | 'credit_note'` เท่านั้น ใบนี้จึงไม่
 *     ถูกนับเป็นภาษีขาย และ**ไม่ถูกนับเป็นค่าใช้จ่ายซ้ำ** (ค่าใช้จ่ายลงที่
 *     /expenses ตอนจ่ายแล้ว ใบนี้เป็นเอกสารประกอบ ไม่ใช่รายจ่ายอีกก้อน)
 *
 * ชื่อ function `onRiderExpensePaidVoucher` unique ระดับ project ตามกฎ {region}/{name}
 */

const { onValueUpdated } = require("firebase-functions/v2/database");
const { getDatabase } = require("firebase-admin/database");
const { buildPettyCashVoucherPdf } = require("./voucher-pdf");
const { bangkokYM, archivePdf } = require("./rider-wht-issue");
const { CATEGORY_LABEL_TH } = require("./rider-expenses");

const REGION = "asia-southeast1";

/** type ใน accounting_documents — หน้ารายงานภาษีต้อง**ไม่**รู้จักค่านี้ (ดูหัวไฟล์) */
const DOC_TYPE = "petty_cash_voucher";

/** ป้ายของแต่ละขั้นบนเอกสาร — เฉพาะขั้นที่ผู้ตรวจถามถึง */
const APPROVAL_LABEL = {
  ops_approve: "ยืนยันว่างานวิ่งจริง (หัวหน้าไรเดอร์)",
  finance_approve: "ตรวจเอกสารและตั้งเบิก (ฝ่ายบัญชี)",
  pay: "อนุมัติจ่าย (ฝ่ายบัญชี)",
};

/**
 * จองเลขใบสำคัญ — `PC-YYYYMM-####` รีเซ็ตรายเดือนตามงวดบัญชี
 * transaction กันเลขซ้ำเมื่อจ่ายพร้อมกันหลายใบ
 */
async function allocatePettyCashNumber(db, ym) {
  const ref = db.ref(`settings/accounting/petty_cash_seq_by_period/${ym}`);
  const txn = await ref.transaction((cur) => (cur || 0) + 1);
  const seq = txn.snapshot.val() || 1;
  return { number: `PC-${ym}-${String(seq).padStart(4, "0")}`, seq };
}

const docIdFor = (number) => `PC_${String(number).replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * ลำดับผู้อนุมัติจาก `history` ของใบ — pure
 * เอาเฉพาะ**ครั้งล่าสุด**ของแต่ละขั้น (ใบที่ถูกตีกลับแล้วส่งใหม่จะมีขั้นเดิมซ้ำ
 * และครั้งที่นับคือครั้งที่พาใบมาถึงการจ่าย)
 */
function approvalsFromHistory(history) {
  const rows = history && typeof history === "object" ? Object.values(history) : [];
  const latest = new Map();
  for (const h of rows) {
    if (!h) continue;
    const prev = latest.get(h.action);
    if (!prev || Number(h.at) > Number(prev.at)) latest.set(h.action, h);
  }
  // การกรองว่า "ขั้นไหนนับเป็นการอนุมัติ" อยู่ที่บรรทัดถัดไปที่เดียว —
  // เคยมี if กรองซ้ำในลูปข้างบน injection ถอดออกแล้วเขียว = ด่านที่ไปไม่ถึง ลบ
  return Object.keys(APPROVAL_LABEL)
    .filter((k) => latest.has(k))
    .map((k) => ({ action: k, label: APPROVAL_LABEL[k], by: latest.get(k).by_name || "", at: Number(latest.get(k).at) || 0 }));
}

/**
 * ข้อมูลทั้งหมดของใบสำคัญ — pure เพื่อให้เทสได้โดยไม่ต้องมี DB
 * ตัวเลขมาจากแถวที่จ่ายไปแล้ว ไม่คำนวณใหม่
 */
function buildVoucherRecord({ id, row, number, ym, riderName, now }) {
  const amount = Number(row.amount_thb) || 0;
  const label = CATEGORY_LABEL_TH[row.category] || CATEGORY_LABEL_TH.other;
  const evidence = Array.isArray(row.evidence) ? row.evidence.filter((e) => e && e.url) : [];
  return {
    number,
    type: DOC_TYPE,
    category: "rider_expense",
    period: ym,
    issued_at: now,
    paid_at: Number(row.reviewed_at) || now,
    amount,
    // ใบสำคัญเงินสดย่อยไม่มี VAT — ใส่ศูนย์ชัดๆ ไม่ปล่อยว่างให้ตัวรวมเดา
    base: amount,
    vat: 0,
    total: amount,
    item_label: label,
    rider_id: row.rider_id || null,
    rider_name: riderName || null,
    rider_expense_id: id,
    tx_id: row.paid_tx_id || null,
    expense_doc_id: row.expense_doc_id || null,
    evidence_count: evidence.length,
    approvals: approvalsFromHistory(row.history),
    status: "issued",
  };
}

function registerRiderExpenseVoucher() {
  const onRiderExpensePaidVoucher = onValueUpdated(
    { ref: "/rider_expenses/{id}/status", region: REGION },
    async (event) => {
      try {
        if (event.data.after.val() !== "paid") return;
        const id = event.params.id;
        const db = getDatabase();

        // idempotent ก่อนทุกอย่าง
        if ((await db.ref(`rider_expenses/${id}/petty_cash_voucher`).get()).exists()) return;

        const row = (await db.ref(`rider_expenses/${id}`).get()).val();
        if (!row || row.status !== "paid") return;

        const [riderName, acct] = await Promise.all([
          db.ref(`riders/${row.rider_id}/name`).get().then((s) => s.val() || ""),
          db.ref("settings/accounting").get().then((s) => s.val() || {}),
        ]);

        const now = Date.now();
        const { ym } = bangkokYM(Number(row.reviewed_at) || now);
        const { number } = await allocatePettyCashNumber(db, ym);
        const docId = docIdFor(number);
        const record = buildVoucherRecord({ id, row, number, ym, riderName, now });

        try {
          const pdf = await buildPettyCashVoucherPdf({
            voucher: record,
            expense: {
              id,
              occurred_at: row.occurred_at,
              note: row.note || "",
              job_ref: row.job_id ? `#${String(row.job_id).slice(-6)}` : "",
            },
            rider: { id: row.rider_id, name: riderName },
            company: acct.company,
          });
          const storagePath = `petty_cash_vouchers/${docId}.pdf`;
          const url = await archivePdf(storagePath, pdf);

          // เอกสารพร้อมแล้วค่อยลงทะเบียน — ลงก่อนแล้วสร้างไม่ได้จะเหลือแถวที่
          // ชี้ไปยังไฟล์ที่ไม่มีอยู่
          await db.ref().update({
            [`accounting_documents/${docId}`]: { ...record, storage_path: storagePath, url },
            [`rider_expenses/${id}/petty_cash_voucher`]: {
              number, url, storage_path: storagePath, issued_at: now,
            },
          });
          console.log(`[riderExpenseVoucher] ${id}: issued ${number}`);
        } catch (e) {
          // เลขถูกจองไปแล้วแต่ไม่มีเอกสาร — ต้องอธิบายได้ตอนถูกตรวจ
          console.error(`[riderExpenseVoucher] build failed for ${number}:`, e?.message || e);
          await db.ref(`accounting_documents/${docId}`).set({
            ...record,
            status: "void",
            void_reason: `สร้างเอกสารไม่สำเร็จ (${String((e && e.message) || e).slice(0, 120)}) — ต้องออกใหม่ด้วยมือ`,
          });
        }
      } catch (err) {
        console.error("[riderExpenseVoucher] unhandled:", err);
      }
    }
  );

  return { onRiderExpensePaidVoucher };
}

module.exports = {
  registerRiderExpenseVoucher,
  allocatePettyCashNumber,
  buildVoucherRecord,
  approvalsFromHistory,
  docIdFor,
  DOC_TYPE,
};
