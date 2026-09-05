"use strict";

/**
 * ด่านถาวรก่อนเงินค่ารอบเข้ากระเป๋าไรเดอร์ + ตัวสร้าง update ของการอนุมัติ/ยกเว้น
 * (pure — ไม่มี I/O เทสได้ที่ functions/test/rider-fee-guard.test.mjs)
 *
 * ที่มา (5 ก.ย. 2569): บัญชีไรเดอร์ของเจ้าของบริษัทได้ค่ารอบเข้ากระเป๋า 129 แถว
 * (Σ ~45,659) จากปุ่ม batch รุ่นเก่า + การอนุมัติจาก UI ทั้งที่กติกาคือ
 * **เจ้าของต้องไม่มีค่ารอบเข้ากระเป๋าเลย ไม่ว่างานวันไหน** และงาน Store-in /
 * Mail-in ที่ไม่มีไรเดอร์ได้ค่ารอบขั้นต่ำจาก trigger แล้วไปนั่งในคิวอนุมัติ 26 ใบ
 * (docs/reports/2026-09-05-owner-rider-wallet-reversal-survey.md)
 *
 * กติกา:
 *   - รายชื่อบัญชีเจ้าของอ่านจาก env `OWNER_RIDER_IDS` (คั่นด้วย , หรือช่องว่าง)
 *     ไม่ hardcode uid ในโค้ด — CI เขียนลง functions/.env จาก GitHub Secret
 *   - **ไม่ตั้ง env = ปฏิเสธการอนุมัติทั้งหมด (fail closed)** เหมือน SEARCH_OVERVIEW_KEY:
 *     ด่านที่หายไปเงียบๆ เพราะลืมตั้ง secret คือด่านที่ไม่มีอยู่จริง
 *   - rider_id ว่าง (และ cancelled_by ไม่ใช่รูป `rider:{id}`) = ไม่มีใครให้จ่าย → throw
 *   - rider_id อยู่ในรายชื่อเจ้าของ → throw
 *   - ที่เหลือ (ไม่มีค่ารอบ / สถานะไม่ใช่ Pending) = "จ่ายไม่ได้" คืน null ไม่ throw
 *     เพราะเป็นเรื่องของข้อมูลใบนั้น ไม่ใช่การพยายามฝ่าด่าน
 *
 * `buildRiderFeeApproval` ย้ายมาจาก `src/utils/riderSettlement.ts` (client) เพราะ
 * ด่านที่อยู่ในเบราว์เซอร์ข้ามได้ด้วย console หนึ่งบรรทัด — rules อนุญาตให้ admin
 * เขียน /transactions ทุกรูป ด่านจริงจึงต้องอยู่ที่ callable ฝั่งนี้ ฝั่ง client
 * เหลือแค่ UX (ป้าย + ปิด checkbox)
 */
const { RIDER_FEE_STATUS } = require("./rider-fee-status");

const OWNER_RIDER_IDS_ENV = "OWNER_RIDER_IDS";

class RiderFeeGuardError extends Error {
  constructor(code, jobId, message) {
    super(message);
    this.name = "RiderFeeGuardError";
    this.code = code;
    this.jobId = jobId;
  }
}

/** แปลงค่าดิบของ env เป็นเซ็ต uid — ค่าว่าง/ไม่ใช่สตริง = เซ็ตว่าง */
function parseOwnerRiderIds(raw) {
  if (typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** อ่านจาก process.env (ตัวเดียวที่ callable/สคริปต์ควรเรียก) */
function ownerRiderIdsFromEnv(env = process.env) {
  return parseOwnerRiderIds(env[OWNER_RIDER_IDS_ENV]);
}

/** ค่ารอบที่จ่ายได้ = ตัวเลข finite > 0 ที่ trigger ประทับไว้ (ไม่มี fallback) */
function settledRiderFee(job) {
  const fee = Number(job && job.rider_fee);
  return Number.isFinite(fee) && fee > 0 ? fee : null;
}

/** ใครทำงานใบนี้ — rider_id หรือ cancelled_by รูป `rider:{id}` (งานที่ยกเลิกล้าง rider_id) */
function payoutRiderIdOf(job) {
  if (!job) return null;
  if (typeof job.rider_id === "string" && job.rider_id.trim()) return job.rider_id.trim();
  if (typeof job.cancelled_by === "string" && job.cancelled_by.startsWith("rider:")) {
    const id = job.cancelled_by.slice("rider:".length).trim();
    return id || null;
  }
  return null;
}

/**
 * เหตุผลที่ห้ามจ่ายค่ารอบใบนี้ — `'no_rider' | 'owner_rider' | null`
 * null = ด่านผ่าน (ไม่ได้แปลว่าจ่ายได้ ดู settledRiderFee/สถานะต่างหาก)
 */
function riderFeeBlockReason(job, ownerRiderIds) {
  const riderId = payoutRiderIdOf(job);
  if (!riderId) return "no_rider";
  if (ownerRiderIds && ownerRiderIds.has(riderId)) return "owner_rider";
  return null;
}

const BLOCK_MESSAGE = {
  no_rider: "งานนี้ไม่มีไรเดอร์ จ่ายค่ารอบไม่ได้",
  owner_rider: "บัญชีเจ้าของบริษัทต้องไม่มีค่ารอบเข้ากระเป๋า",
};

/** throw เมื่อด่านไม่ผ่าน — ทุกทางที่เขียน JOB_PAYOUT ต้องเรียกก่อนสร้างแถว */
function assertRiderFeePayable(job, ownerRiderIds) {
  const reason = riderFeeBlockReason(job, ownerRiderIds);
  if (reason) throw new RiderFeeGuardError(reason, job && job.id, BLOCK_MESSAGE[reason]);
}

/**
 * updates สำหรับอนุมัติค่ารอบหนึ่งใบ — multi-path (jobs + transactions พร้อมกัน)
 * คืน null เมื่อจ่ายไม่ได้ด้วยเหตุผลของข้อมูล, throw เมื่อชนด่าน OWNER/ไม่มีไรเดอร์
 *
 * รูปของแถวเหมือน client เดิมทุกฟิลด์ (ตัวแยกฐานภาษีตอนถอนอ่าน `taxable`)
 */
function buildRiderFeeApproval({ job, txKey, now, approvedBy, ownerRiderIds, note }) {
  if (!job || !job.id || !txKey) return null;
  const fee = settledRiderFee(job);
  if (fee === null) return null;
  // เฉพาะใบที่รออยู่จริง — Paid = จ่ายซ้ำ, Waived = ตัดสินใจไม่จ่ายไปแล้ว
  if (job.rider_fee_status !== RIDER_FEE_STATUS.PENDING) return null;

  assertRiderFeePayable(job, ownerRiderIds);
  const riderId = payoutRiderIdOf(job);

  const updates = {};
  updates[`jobs/${job.id}/rider_fee_status`] = RIDER_FEE_STATUS.PAID;
  updates[`jobs/${job.id}/settled_at`] = now;
  if (approvedBy) updates[`jobs/${job.id}/rider_fee_approved_by`] = approvedBy;
  updates[`transactions/${txKey}`] = {
    rider_id: riderId,
    amount: fee,
    type: "CREDIT",
    category: "JOB_PAYOUT",
    // ค่ารอบเป็นเงินได้ — ธงนี้คือสิ่งที่ตัวแยกฐานภาษีตอนถอนอ่าน ไม่ใช่ชื่อหมวด
    taxable: true,
    description: `ค่าเที่ยวงาน ${job.model || "Unknown"} (${job.ref_no || "-"})${note ? ` ${note}` : ""}`,
    timestamp: now,
    ref_job_id: job.id,
  };
  return updates;
}

const WAIVE_REASON_MAX = 200;

/**
 * updates สำหรับยกเว้นค่ารอบหนึ่งใบ (Pending → Waived) — ไม่แตะ `rider_fee`
 * คืน null เมื่อสถานะไม่ใช่ Pending (Paid ต้องกลับรายการผ่านสคริปต์ ไม่ใช่ waive;
 * Waived อยู่แล้ว = idempotent)
 */
function buildRiderFeeWaive({ job, reason, now, by }) {
  if (!job || !job.id) return null;
  if (job.rider_fee_status !== RIDER_FEE_STATUS.PENDING) return null;
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) throw new RiderFeeGuardError("reason_required", job.id, "ต้องระบุเหตุผลที่ยกเว้นค่ารอบ");
  if (text.length > WAIVE_REASON_MAX) {
    throw new RiderFeeGuardError("reason_too_long", job.id, `เหตุผลยาวเกิน ${WAIVE_REASON_MAX} ตัวอักษร`);
  }
  const base = `jobs/${job.id}`;
  const existing = Array.isArray(job.qc_logs)
    ? job.qc_logs
    : job.qc_logs && typeof job.qc_logs === "object"
      ? Object.values(job.qc_logs)
      : [];
  return {
    [`${base}/rider_fee_status`]: RIDER_FEE_STATUS.WAIVED,
    [`${base}/rider_fee_waived_reason`]: text,
    [`${base}/rider_fee_waived_at`]: now,
    [`${base}/rider_fee_waived_by`]: by || "unknown",
    [`${base}/updated_at`]: now,
    // ร่องรอยในไทม์ไลน์ที่แอดมินเปิดดู (Traceability อ่าน qc_logs)
    [`${base}/qc_logs`]: [
      {
        action: "Rider Fee Waived",
        by: by || "unknown",
        timestamp: now,
        details: `ยกเว้นค่ารอบ${settledRiderFee(job) !== null ? ` ฿${settledRiderFee(job)}` : ""} — ${text}`,
      },
      ...existing,
    ],
  };
}

module.exports = {
  OWNER_RIDER_IDS_ENV,
  RiderFeeGuardError,
  parseOwnerRiderIds,
  ownerRiderIdsFromEnv,
  settledRiderFee,
  payoutRiderIdOf,
  riderFeeBlockReason,
  assertRiderFeePayable,
  buildRiderFeeApproval,
  buildRiderFeeWaive,
  WAIVE_REASON_MAX,
};
