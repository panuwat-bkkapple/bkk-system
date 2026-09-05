// ---------------------------------------------------------------------------
// ค่ารอบเมื่องานถูกยกเลิก — กติกาสามข้อของเจ้าของงาน (5 ก.ย. 2569) ตรรกะล้วน
//
//   1. รับงานแล้ว แต่ยังไม่กดออกเดินทาง → ไม่จ่าย (ยอดที่ตรึงตอนกดรับเป็นโมฆะ)
//   2. ออกเดินทางแล้ว ถูกยกเลิกระหว่างทาง → ค่าเสียเวลา
//      (settings/rider_compensation/customer_cancel_time_loss)
//   3. ถึงหน้างาน ประเมินแล้วไม่ผ่าน → จ่ายตามเรทปกติ (ยอดที่ตรึงตอนกดรับ
//      หรือคำนวณจากระยะทางถ้ายังไม่ได้ตรึง)
//
// ทำไมต้องมี: bkk-system ตรึง `rider_fee` ลงงานตั้งแต่กดรับ (rider-fee-commitment)
// โดยไม่ตั้ง `rider_fee_status` — มันคือคำสัญญาว่าจะได้เท่านี้ถ้าทำงานจบ. คนเขียน
// Cancelled มีอย่างน้อยสี่ทาง (เว็บลูกค้า /api/cancel-order · แอดมินผ่าน engine
// event `cancelled` · amendment customer_request_cancel · ระบบ SLA) และมีแค่
// amendment ทางเดียวที่เคยคิดเรื่องเงินไรเดอร์ (เฉพาะข้อ 2). ผลคือ:
//   - ยกเลิกก่อนออกเดินทาง: ยอดที่ตรึงค้างบนงาน แอปไรเดอร์เคยอ่านเป็นรายได้
//     (bkk-rider-app #169 แก้ฝั่งอ่านแล้ว ไฟล์นี้แก้ฝั่งเขียน)
//   - ลูกค้ายกเลิกจากเว็บตอนไรเดอร์ขี่ไปครึ่งทาง: ได้ 0 บาท เว้นแต่ไรเดอร์รู้ว่า
//     ต้องไปยื่น amendment เอง
//   - ยกเลิกหลังตรวจเครื่องแล้ว (BEING_INSPECTED ขึ้นไป): amendment ก็ไม่จ่าย
//     เพราะ RIDER_DEPARTED_STATUSES เดิมมีแค่ EN_ROUTE/ARRIVED
//
// ไฟล์นี้เป็นเจ้าของ "ยกเลิกตอนไหน → ได้อะไร" ที่เดียว. ผู้เรียกสองราย:
//   - trigger onJobCancelledSettleRiderFee (index.js) — ยิงทุกทางที่เข้า Cancelled
//   - buildAmendmentApplyUpdates (index.js) — เขียนค่าเสียเวลาใน multi-path
//     เดียวกับสถานะ เพื่อคง failed-precondition เมื่อยังไม่ตั้งค่า (ห้ามจ่ายเงียบ
//     และห้ามเงียบเมื่อจ่ายไม่ได้) trigger เห็น Pending แล้วข้าม
// pure โดยตั้งใจ — index.js init firebase ตอน require เทสจากที่นั่นไม่ได้
// ---------------------------------------------------------------------------
const { JOB_STATUS, normalizeStatus } = require("./status-vocab.generated");
const { finiteOrNull } = require("./rider-fee-meta");

/** ค่าของ rider_fee_status ที่ไฟล์นี้เขียน/อ่าน — คนละคำศัพท์กับสถานะงาน */
const FEE_STATUS = { PENDING: "Pending", PAID: "Paid", VOIDED: "Voided" };

/** ไรเดอร์ไปถึงขั้นไหนก่อนงานถูกยกเลิก */
const CANCEL_STAGE = {
  NOT_DEPARTED: "not_departed",
  DEPARTED: "departed",
  INSPECTED: "inspected",
};

// สถานะ (canonical) ที่แปลว่าไรเดอร์ออกเดินทางแล้วแต่ยังไม่เริ่มตรวจ
const DEPARTED_STATUSES = new Set([JOB_STATUS.RIDER_EN_ROUTE, JOB_STATUS.RIDER_ARRIVED]);
// สถานะที่แปลว่าเริ่มตรวจเครื่องแล้ว — ยกเลิกจากตรงนี้คือ "ประเมินแล้วไม่ผ่าน"
const INSPECTED_STATUSES = new Set([
  JOB_STATUS.BEING_INSPECTED,
  JOB_STATUS.QC_REVIEW,
  JOB_STATUS.NEGOTIATION,
  JOB_STATUS.REVISED_OFFER,
  JOB_STATUS.PRICE_ACCEPTED,
  JOB_STATUS.PAYOUT_PROCESSING,
]);

function canonicalOf(status, receiveMethod) {
  if (typeof status !== "string" || !status) return null;
  return normalizeStatus(status, receiveMethod || null);
}

function checkpointAt(job, stage) {
  const cp = job && job.checkpoints && job.checkpoints[stage];
  return finiteOrNull(cp && cp.at);
}

/**
 * ขั้นที่ไรเดอร์ไปถึง — ตัดสินจาก **สถานะก่อนยกเลิก** เป็นหลัก และใช้จุดเช็คอิน
 * ที่แอปไรเดอร์เขียน (`checkpoints.rider_en_route` / `rider_arrived`) กับ
 * `inspected_at` เป็นสัญญาณเสริม เพราะสถานะย้อนได้ (แอดมินดึงกลับ Following Up
 * แล้วค่อยยกเลิก) แต่การเดินทางที่เกิดแล้วย้อนไม่ได้
 *
 * @param {object} job          งานที่อ่านสดจาก DB (สถานะปัจจุบันอาจเป็น Cancelled แล้ว)
 * @param {string|null} priorStatus สถานะก่อนเข้า Cancelled (before ของ trigger /
 *                                  job.status ตอน amendment ยังไม่ apply)
 */
function cancelStageOf(job, priorStatus) {
  const method = job && job.receive_method;
  const prior = canonicalOf(priorStatus, method);
  const inspected =
    (prior && INSPECTED_STATUSES.has(prior)) || finiteOrNull(job && job.inspected_at) !== null;
  if (inspected) return CANCEL_STAGE.INSPECTED;
  const departed =
    (prior && DEPARTED_STATUSES.has(prior)) ||
    checkpointAt(job, "rider_en_route") !== null ||
    checkpointAt(job, "rider_arrived") !== null;
  return departed ? CANCEL_STAGE.DEPARTED : CANCEL_STAGE.NOT_DEPARTED;
}

function timeLossFee(riderCompensation) {
  const raw = riderCompensation && riderCompensation.customer_cancel_time_loss;
  const fee = typeof raw === "number" ? raw : null;
  return fee !== null && Number.isFinite(fee) && fee >= 0 ? fee : null;
}

/**
 * ตัดสินว่างานที่ยกเลิกใบนี้ต้องทำอะไรกับค่ารอบ — คืน `{ kind, why, ... }` เสมอ
 *
 *   skip      ไม่ต้องทำอะไร (ไม่ใช่ Pickup / ไม่มีไรเดอร์ / ตัดสินไปแล้ว / ไม่มีอะไรให้โมฆะ)
 *   void      ข้อ 1 — ประทับ Voided บนยอดที่ตรึงไว้ (ไม่ลบ rider_fee: riderAudit
 *             ใช้การมีมันเป็นสัญญาณว่าไรเดอร์เกี่ยวข้อง และคนอ่านเรื่องเงินทุกตัว
 *             เทียบ Pending/Paid เท่านั้น ค่าอื่นจึงไม่ใช่เงินโดยโครงสร้าง)
 *   time_loss ข้อ 2 — `fee` จาก settings
 *   blocked   ข้อ 2 แต่ยังไม่ตั้งค่าเสียเวลา — ผู้เรียกต้องดังออกมา ห้ามเดาเลข
 *   normal    ข้อ 3 — `fee` = ยอดที่ตรึงตอนกดรับ หรือ null = ผู้เรียกต้องคำนวณ
 *             จากระยะทาง (computeRiderFeeForAssignee) ก่อนเขียน
 *
 * "ตัดสินไปแล้ว" = rider_fee_status มีค่าอะไรก็ตาม (Pending/Paid/Voided) — trigger
 * ยิงซ้ำได้ (reopen แล้วยกเลิกอีก) และ amendment เขียน Pending ไว้ก่อน trigger
 */
function cancelFeeDecision({ job, priorStatus, riderCompensation }) {
  if (!job) return { kind: "skip", why: "no_job" };
  if (job.receive_method !== "Pickup") return { kind: "skip", why: "not_pickup" };
  const riderId = typeof job.rider_id === "string" && job.rider_id ? job.rider_id : null;
  if (!riderId) return { kind: "skip", why: "no_rider" };
  if (job.rider_fee_status) return { kind: "skip", why: `already_${String(job.rider_fee_status).toLowerCase()}` };

  const stage = cancelStageOf(job, priorStatus);
  const frozen = finiteOrNull(job.rider_fee);
  const hasFrozen = frozen !== null && frozen > 0;

  if (stage === CANCEL_STAGE.NOT_DEPARTED) {
    return hasFrozen
      ? { kind: "void", stage, riderId, fee: frozen }
      : { kind: "skip", why: "nothing_to_void", stage };
  }
  if (stage === CANCEL_STAGE.DEPARTED) {
    const fee = timeLossFee(riderCompensation);
    return fee === null
      ? { kind: "blocked", why: "compensation_unset", stage, riderId }
      : { kind: "time_loss", stage, riderId, fee };
  }
  return { kind: "normal", stage, riderId, fee: hasFrozen ? frozen : null };
}

const baht = (n) => `฿${Number(n).toLocaleString("th-TH")}`;

function existingLogs(job) {
  const raw = job && job.qc_logs;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

/**
 * ฟิลด์ที่ต้องเขียนลง jobs/{id} (คีย์สัมพัทธ์) สำหรับ decision ที่ตัดสินแล้ว
 * `fee` ของ normal ต้องถูกเติมโดยผู้เรียกก่อน (คืน null ถ้ายังไม่มี = เขียนไม่ได้)
 * ทุกทางทิ้งแถว qc_logs — กฎเดียวกับ rider-fee-commitment: rider_fee เปลี่ยน
 * ต้องมีร่องรอยที่ทีมปฏิบัติการอ่านได้โดยไม่ต้องเปิด Cloud Functions log
 */
function buildCancelFeeUpdates(decision, job, now, extra = {}) {
  const logs = existingLogs(job);
  const distanceKm = finiteOrNull(extra.distanceKm);
  const distanceNote = distanceKm !== null ? ` (ระยะ ${distanceKm} กม.)` : "";
  if (decision.kind === "void") {
    return {
      rider_fee_status: FEE_STATUS.VOIDED,
      rider_fee_meta: {
        ...((job && job.rider_fee_meta) || {}),
        voided_at: now,
        voided_reason: "cancelled_before_departure",
      },
      qc_logs: [
        {
          action: "Rider Fee Voided",
          by: "System",
          timestamp: now,
          details: `งานถูกยกเลิกก่อนไรเดอร์ออกเดินทาง — ค่ารอบที่ตรึงไว้ ${baht(decision.fee)} เป็นโมฆะ ไม่จ่าย`,
        },
        ...logs,
      ],
      updated_at: now,
    };
  }
  if (decision.kind === "time_loss") {
    return {
      rider_fee: decision.fee,
      rider_fee_status: FEE_STATUS.PENDING,
      rider_fee_breakdown: {
        type: "time_loss_customer_cancel",
        amount: decision.fee,
        reason: `ลูกค้ายกเลิกระหว่างทาง (status: ${extra.priorStatus || "-"}) — ค่าเสียเวลาไรเดอร์`,
        computed_at: now,
        source: "settings",
      },
      qc_logs: [
        {
          action: "Rider Fee Set",
          by: "System",
          timestamp: now,
          details: `ลูกค้ายกเลิกหลังไรเดอร์ออกเดินทาง — ค่าเสียเวลา ${baht(decision.fee)} เข้าคิวจ่าย (ไรเดอร์ ${decision.riderId})`,
        },
        ...logs,
      ],
      updated_at: now,
    };
  }
  if (decision.kind === "normal") {
    const fee = finiteOrNull(decision.fee);
    if (fee === null || fee <= 0) return null;
    return {
      rider_fee: fee,
      rider_fee_status: FEE_STATUS.PENDING,
      rider_fee_breakdown: {
        type: "normal_rate_cancel_after_inspection",
        amount: fee,
        reason: `ยกเลิกหลังตรวจเครื่องแล้ว (status: ${extra.priorStatus || "-"}) — จ่ายค่ารอบตามเรทปกติ`,
        computed_at: now,
        source: extra.source || "frozen_at_accept",
      },
      qc_logs: [
        {
          action: "Rider Fee Set",
          by: "System",
          timestamp: now,
          details: `ยกเลิกหลังตรวจเครื่องแล้ว — ค่ารอบตามเรทปกติ ${baht(fee)} เข้าคิวจ่าย${distanceNote} (ไรเดอร์ ${decision.riderId})`,
        },
        ...logs,
      ],
      updated_at: now,
    };
  }
  return null;
}

/**
 * งานที่ถูกดึงกลับจาก Cancelled (reopen) — ยอดที่ประทับ Voided ต้องกลับเป็น
 * "ยังไม่ตัดสิน" ไม่งั้น onJobHandedOverCalcRiderFee ตอนส่งมอบเห็น status มีค่า
 * แล้วไม่ตั้ง Pending → งานที่ทำจบจริงไม่เข้าคิวจ่ายเงินเงียบๆ
 * คืน null เมื่อไม่มีอะไรต้องแก้
 */
function buildReopenFeeUpdates(job, now) {
  if (!job || job.rider_fee_status !== FEE_STATUS.VOIDED) return null;
  const meta = { ...((job && job.rider_fee_meta) || {}) };
  delete meta.voided_at;
  delete meta.voided_reason;
  return {
    rider_fee_status: null,
    rider_fee_meta: meta,
    qc_logs: [
      {
        action: "Rider Fee Unvoided",
        by: "System",
        timestamp: now,
        details: "งานถูกเปิดใหม่ — ยกเลิกสถานะโมฆะของค่ารอบ กลับไปตัดสินตามการส่งมอบตามปกติ",
      },
      ...existingLogs(job),
    ],
    updated_at: now,
  };
}

module.exports = {
  FEE_STATUS,
  CANCEL_STAGE,
  DEPARTED_STATUSES,
  INSPECTED_STATUSES,
  cancelStageOf,
  cancelFeeDecision,
  buildCancelFeeUpdates,
  buildReopenFeeUpdates,
};
