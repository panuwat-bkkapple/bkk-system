"use strict";

/**
 * แย้งหมุดลูกค้า — ไรเดอร์ขอให้คิดค่าวิ่งใหม่จาก "จุดที่เช็คอินจริง"
 *
 * ปัญหาที่แก้ (เคสจริง 31 ส.ค. 2569): ลูกค้าปักหมุดผิดไป ~11.8 กม. ค่าวิ่ง
 * ถูกคำนวณจากเส้นทาง "หมุดที่ปัก → สาขา" ซึ่งไม่ใช่ที่ที่ไรเดอร์ไปจริง
 * ระบบเห็นแค่ระยะห่าง (`checkpoints.rider_arrived.distance_m`) แต่แยกไม่ออก
 * ว่าเป็น "หมุดผิด" หรือ "ไรเดอร์กดเช็คอินก่อนถึง" — คนเดียวที่รู้คือไรเดอร์
 * ที่อยู่หน้างาน ท่อนี้จึงให้เขา *แย้ง* แล้วให้แอดมินเป็นคนตัดสิน
 *
 * ท่อ: ไรเดอร์ยื่น (riderDisputePickupPin) → push หา CEO/MANAGER →
 *      แอดมินอนุมัติ/ปฏิเสธ (adminReviewPinDispute) → อนุมัติ = คิดค่าวิ่งใหม่
 *      จากพิกัดจุดเช็คอิน แล้ว push กลับหาไรเดอร์
 *
 * กติกาที่ตั้งใจ:
 *   - **หลักฐานคือจุดเช็คอิน ไม่ใช่คำพูด** — ไม่มี `checkpoints.rider_arrived`
 *     ที่มีพิกัด = แย้งไม่ได้ (ไม่มีอะไรให้คำนวณใหม่)
 *   - **แตะเงินฝั่งไรเดอร์อย่างเดียว** — `pickup_fee`/`net_payout` ของลูกค้า
 *     ห้ามขยับ (invariant #3: ค่าบริการที่เก็บลูกค้าถูก quote ตอน checkout
 *     คนละก้อนกับต้นทุนที่จ่ายไรเดอร์). การคืนเงินให้ลูกค้าที่ปักผิดเป็น
 *     การตัดสินใจเชิงธุรกิจคนละเรื่อง ทำผ่าน adjustments ตามปกติ
 *   - **งานที่จ่ายค่ารอบไปแล้ว ต้องลงส่วนต่างใน ledger ห้ามเขียนทับเงียบๆ**
 *     — กระเป๋าไรเดอร์คำนวณจากแถวใน /transactions ถ้าแก้ `rider_fee` เฉยๆ
 *     ยอดในกระเป๋ากับตัวเลขบนงานจะไม่ตรงกันตลอดไป
 *   - พิกัดที่ใช้เป็น snapshot ที่ยื่นตอนนั้น ไม่ใช่ค่าที่อ่านสดตอนอนุมัติ
 *     (ไรเดอร์เขียน jobs/{id} ของตัวเองได้ตามกฎ — snapshot ทำให้สิ่งที่
 *     แอดมินกดอนุมัติคือสิ่งเดียวกับที่เขาเห็นตอนตัดสินใจ)
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");

const REGION = "asia-southeast1";
const REVIEW_ROLES = ["CEO", "MANAGER"];
const MAX_REASON_LEN = 500;

const finite = (v) => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const shortJob = (jobId) => String(jobId || "").slice(-6);

/**
 * พิกัดจุดเช็คอิน "ถึงลูกค้า" ที่ใช้อ้างอิงได้ — null เมื่อไม่มีหรือค่าเสีย
 * pure เพื่อให้เทสได้โดยไม่ต้องมี firebase
 */
function checkinEvidence(job) {
  const cp = job && job.checkpoints && job.checkpoints.rider_arrived;
  if (!cp) return null;
  const lat = finite(cp.lat);
  const lng = finite(cp.lng);
  if (lat === null || lng === null) return null;
  const at = finite(cp.at);
  const distanceM = finite(cp.distance_m);
  return {
    lat,
    lng,
    at: at !== null && at > 0 ? at : null,
    distance_m: distanceM,
  };
}

/**
 * ส่วนต่างค่าวิ่งหลังคิดใหม่ + จะต้องลง ledger ไหม — pure, เทสได้
 * `settled` = ค่ารอบถูกจ่ายเข้ากระเป๋าไปแล้ว (rider_fee_status === 'Paid')
 */
function settlementDelta(feeBefore, feeAfter, settled) {
  const before = finite(feeBefore) ?? 0;
  const after = finite(feeAfter);
  if (after === null) return { delta: 0, ledger: null };
  const delta = Math.round(after - before);
  if (!settled || delta === 0) return { delta, ledger: null };
  // จ่ายไปแล้วแล้วเลขขยับ = ต้องมีแถวส่วนต่าง ไม่งั้นกระเป๋ากับงานเล่าคนละเรื่อง
  return {
    delta,
    ledger: delta > 0
      ? { type: "CREDIT", category: "JOB_PAYOUT", amount: delta }
      : { type: "DEBIT", category: "PENALTY", amount: Math.abs(delta) },
  };
}

function registerPinDispute({ computeRiderFee, riderFeeMeta, riderVehicleType, pushToRider, dispatchAdminPush, staffIdsByRoles }) {
  /** ไรเดอร์ยื่นแย้งหมุด — หลักฐานคือจุดเช็คอินของตัวเอง */
  const riderDisputePickupPin = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    const uid = request.auth.uid;
    const { jobId, reason } = request.data || {};
    if (!jobId || typeof jobId !== "string") {
      throw new HttpsError("invalid-argument", "ไม่พบรหัสงาน");
    }
    if (reason != null && (typeof reason !== "string" || reason.length > MAX_REASON_LEN)) {
      throw new HttpsError("invalid-argument", `เหตุผลยาวเกิน ${MAX_REASON_LEN} ตัวอักษร`);
    }

    const db = getDatabase();
    const riderSnap = await db.ref(`riders/${uid}`).once("value");
    if (!riderSnap.exists()) throw new HttpsError("permission-denied", "ไม่พบบัญชีไรเดอร์");

    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบงานนี้");
    const job = jobSnap.val();
    if (job.rider_id !== uid) {
      throw new HttpsError("permission-denied", "แย้งได้เฉพาะงานของตัวเอง");
    }

    const existing = job.pin_dispute;
    if (existing && (existing.status === "pending" || existing.status === "approved")) {
      throw new HttpsError(
        "failed-precondition",
        existing.status === "pending" ? "งานนี้ยื่นแย้งไว้แล้ว รอแอดมินตรวจ" : "งานนี้แอดมินอนุมัติการแย้งไปแล้ว"
      );
    }

    const evidence = checkinEvidence(job);
    if (!evidence) {
      throw new HttpsError(
        "failed-precondition",
        "งานนี้ไม่มีพิกัดตอนเช็คอิน 'ถึงลูกค้า' จึงไม่มีจุดอ้างอิงให้คิดใหม่"
      );
    }

    const now = Date.now();
    const dispute = {
      status: "pending",
      requested_at: now,
      requested_by_rider_id: uid,
      requested_by_rider_name: riderSnap.val().name || "ไรเดอร์",
      reason: typeof reason === "string" ? reason.trim() : "",
      checkin: evidence,
      fee_before: finite(job.rider_fee) ?? finite(job.rider_fee_estimate) ?? 0,
      distance_km_before: finite(job.rider_fee_meta?.distance_km) ?? finite(job.rider_fee_estimate_meta?.distance_km),
      fee_settled_at_request: job.rider_fee_status === "Paid",
    };
    await db.ref(`jobs/${jobId}/pin_dispute`).set(dispute);

    const allow = await staffIdsByRoles(db, REVIEW_ROLES);
    await dispatchAdminPush(
      {
        notification: {
          title: "ไรเดอร์แย้งหมุดลูกค้า",
          body: `${dispute.requested_by_rider_name} · งาน #${shortJob(jobId)}${
            evidence.distance_m != null ? ` · ห่างหมุด ${Math.round(evidence.distance_m).toLocaleString("th-TH")} ม.` : ""
          }`,
        },
        data: { type: "pin_dispute", jobId },
      },
      "pin-dispute",
      "admin",
      allow
    );

    return { ok: true, status: "pending" };
  });

  /** แอดมิน (CEO/MANAGER) อนุมัติ = คิดค่าวิ่งใหม่จากพิกัดจุดเช็คอิน */
  const adminReviewPinDispute = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
    const { jobId, decision, adminNote } = request.data || {};
    if (!jobId || (decision !== "approve" && decision !== "reject")) {
      throw new HttpsError("invalid-argument", "jobId / decision ไม่ถูกต้อง");
    }
    if (adminNote != null && (typeof adminNote !== "string" || adminNote.length > MAX_REASON_LEN)) {
      throw new HttpsError("invalid-argument", `หมายเหตุยาวเกิน ${MAX_REASON_LEN} ตัวอักษร`);
    }

    const db = getDatabase();
    const staff = (await lookupStaffByAuth(db, request.auth)) || {};
    const role = String(staff.role || "").toUpperCase();
    if (!REVIEW_ROLES.includes(role)) {
      throw new HttpsError("permission-denied", `เฉพาะ ${REVIEW_ROLES.join("/")} เท่านั้น`);
    }

    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบงานนี้");
    const job = jobSnap.val();
    const dispute = job.pin_dispute;
    if (!dispute || dispute.status !== "pending") {
      throw new HttpsError("failed-precondition", "ไม่มีคำแย้งที่รอตรวจบนงานนี้");
    }

    const now = Date.now();
    const reviewer = {
      reviewed_at: now,
      reviewed_by_uid: request.auth.uid,
      reviewed_by_name: staff.name || staff.id || "Admin",
      admin_note: typeof adminNote === "string" ? adminNote.trim() : "",
    };

    if (decision === "reject") {
      await db.ref(`jobs/${jobId}/pin_dispute`).update({ ...reviewer, status: "rejected" });
      await pushToRider(
        db,
        dispute.requested_by_rider_id,
        {
          notification: {
            title: "แอดมินไม่อนุมัติการแย้งหมุด",
            body: reviewer.admin_note || `ค่ารอบงาน #${shortJob(jobId)} คงเดิม`,
          },
          data: { type: "pin_dispute_rejected", jobId },
        },
        "pin-dispute-rejected"
      );
      return { ok: true, status: "rejected" };
    }

    // อนุมัติ — คิดใหม่จากพิกัดที่ยื่นไว้ (snapshot) ไม่ใช่ค่าที่อ่านสดตอนนี้
    const origin = dispute.checkin;
    if (!origin || finite(origin.lat) === null || finite(origin.lng) === null) {
      throw new HttpsError("failed-precondition", "คำแย้งนี้ไม่มีพิกัดจุดเช็คอิน");
    }
    const vehicleType = await riderVehicleType(db, job);
    const result = await computeRiderFee(db, job, {
      ...(vehicleType ? { vehicleType } : {}),
      originCoords: { lat: Number(origin.lat), lng: Number(origin.lng) },
    });
    if (result.reason && result.reason.startsWith("routes_api_")) {
      // คิดระยะทางจริงไม่ได้ = ได้ min_fee ซึ่งไม่ใช่คำตอบ ปล่อยให้ลองใหม่
      throw new HttpsError("unavailable", "คำนวณเส้นทางไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }

    const settled = job.rider_fee_status === "Paid";
    const feeBefore = finite(job.rider_fee) ?? finite(dispute.fee_before) ?? 0;
    const { delta, ledger } = settlementDelta(feeBefore, result.fee, settled);

    const meta = { ...riderFeeMeta(result), basis: "pin_dispute_checkin" };
    const updates = {
      [`jobs/${jobId}/rider_fee`]: result.fee,
      [`jobs/${jobId}/rider_fee_meta`]: meta,
      [`jobs/${jobId}/rider_fee_estimate`]: result.fee,
      [`jobs/${jobId}/rider_fee_estimate_meta`]: meta,
      [`jobs/${jobId}/updated_at`]: now,
      [`jobs/${jobId}/pin_dispute`]: {
        ...dispute,
        ...reviewer,
        status: "approved",
        fee_before: feeBefore,
        fee_after: result.fee,
        delta,
        distance_km_after: result.distance_km ?? null,
      },
    };
    // ยังไม่ได้จ่าย = ตัวเลขใหม่เข้าคิว settlement ตามปกติ ไม่ต้องแตะ ledger
    if (!settled && !job.rider_fee_status) {
      updates[`jobs/${jobId}/rider_fee_status`] = "Pending";
    }
    if (ledger) {
      const txKey = db.ref("transactions").push().key;
      updates[`transactions/${txKey}`] = {
        rider_id: dispute.requested_by_rider_id,
        amount: ledger.amount,
        type: ledger.type,
        category: ledger.category,
        description: `ปรับค่ารอบตามหมุดที่แก้ ${job.model || "งาน"} (${job.ref_no || job.OID || shortJob(jobId)})`,
        timestamp: now,
        ref_job_id: jobId,
      };
      updates[`jobs/${jobId}/pin_dispute/delta_tx_id`] = txKey;
    }
    await db.ref().update(updates);

    await pushToRider(
      db,
      dispute.requested_by_rider_id,
      {
        notification: {
          title: "แอดมินอนุมัติการแย้งหมุด",
          body: `ค่ารอบงาน #${shortJob(jobId)} ${delta >= 0 ? "เพิ่มเป็น" : "ปรับเป็น"} ฿${Number(result.fee).toLocaleString("th-TH")}`,
        },
        data: { type: "pin_dispute_approved", jobId },
      },
      "pin-dispute-approved"
    );

    return { ok: true, status: "approved", fee: result.fee, delta, distance_km: result.distance_km ?? null };
  });

  return { riderDisputePickupPin, adminReviewPinDispute };
}

module.exports = { registerPinDispute, checkinEvidence, settlementDelta };
