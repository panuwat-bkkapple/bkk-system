"use strict";

/**
 * callable ของ /rider-audit — อนุมัติ / ยกเว้นค่ารอบ และรายชื่อบัญชีเจ้าของ
 *
 * ก่อน 5 ก.ย. 2569 การอนุมัติเขียน jobs + transactions จากเบราว์เซอร์แอดมินตรงๆ
 * (`buildRiderFeeApproval` ฝั่ง client) ด่านใดๆ ที่นั่นจึงข้ามได้ด้วย console —
 * rules อนุญาตให้ admin เขียน /transactions ทุกรูป. ตัวนี้คือด่านจริง:
 *   - รายชื่อเจ้าของจาก env OWNER_RIDER_IDS (ไม่ตั้ง = ปฏิเสธการอนุมัติทั้งหมด)
 *   - มีใบไหนชนด่าน (เจ้าของ / ไม่มีไรเดอร์) = ปฏิเสธ**ทั้งชุด** ไม่เขียนอะไรเลย
 *     แล้วบอกชื่อใบ — เขียนครึ่งชุดแล้วรายงานว่าข้ามคือของที่ไม่มีใครอ่าน
 *   - เขียน multi-path update ก้อนเดียว (jobs + transactions พร้อมกัน) — เขียนแยก
 *     เมื่อไหร่ งานขึ้น Paid โดยไม่มีเงินเข้ากระเป๋าได้
 *
 * ทำไมไม่เขียนจาก client แล้วเช็คที่ client: `statusWriterCensus.test.ts` ตรึง
 * จำนวนการเขียน jobs/{id} ตรงจากเบราว์เซอร์ไว้ (ลดได้ ขึ้นไม่ได้) ทุกการเขียนของ
 * งานนี้จึงอยู่ที่นี่หรือในสคริปต์ admin เท่านั้น
 *
 * ชื่อ callable prefix `adminRiderFee*` unique ระดับ project ตามกฎ {region}/{name}
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const {
  OWNER_RIDER_IDS_ENV,
  RiderFeeGuardError,
  ownerRiderIdsFromEnv,
  buildRiderFeeApproval,
  buildRiderFeeWaive,
} = require("./rider-fee-guard");

const REGION = "asia-southeast1";
/** อนุมัติ = รับรองข้อเท็จจริงหน้างาน — เท่ากับ `canApprove` ของหน้า /rider-audit */
const APPROVE_ROLES = ["CEO", "MANAGER"];
/** ยกเว้น/อ่าน config = เท่ากับสิทธิ์เปิดหน้า finance และ /rider-audit */
const WAIVE_ROLES = ["CEO", "MANAGER", "FINANCE"];
const MAX_JOBS_PER_CALL = 200;

function normalizeJobIds(raw) {
  if (!Array.isArray(raw)) throw new HttpsError("invalid-argument", "jobIds ต้องเป็น array");
  const ids = [...new Set(raw.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()))];
  if (ids.length === 0) throw new HttpsError("invalid-argument", "ไม่มีใบงานที่เลือก");
  if (ids.length > MAX_JOBS_PER_CALL) {
    throw new HttpsError("invalid-argument", `เลือกได้ครั้งละไม่เกิน ${MAX_JOBS_PER_CALL} ใบ`);
  }
  return ids;
}

async function requireRole(db, auth, roles) {
  if (!auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const staff = (await lookupStaffByAuth(db, auth)) || {};
  const role = String(staff.role || "").toUpperCase();
  if (!roles.includes(role)) {
    throw new HttpsError("permission-denied", `เฉพาะ ${roles.join("/")} เท่านั้น`);
  }
  return staff;
}

async function loadJobs(db, ids) {
  const snaps = await Promise.all(ids.map((id) => db.ref(`jobs/${id}`).once("value")));
  return ids.map((id, i) => (snaps[i].exists() ? { id, ...snaps[i].val() } : null));
}

function registerRiderFeeAdmin() {
  const adminRiderFeeConfig = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireRole(db, request.auth, WAIVE_ROLES);
    const owners = ownerRiderIdsFromEnv();
    return { ownerRiderIds: [...owners], configured: owners.size > 0 };
  });

  const adminRiderFeeApprove = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const staff = await requireRole(db, request.auth, APPROVE_ROLES);
    const jobIds = normalizeJobIds((request.data || {}).jobIds);

    const owners = ownerRiderIdsFromEnv();
    if (owners.size === 0) {
      // fail closed — ด่านที่หายเพราะลืมตั้ง secret ต้องดัง ไม่ใช่เงียบ
      throw new HttpsError(
        "failed-precondition",
        `${OWNER_RIDER_IDS_ENV} ยังไม่ตั้งบน functions — ปฏิเสธการอนุมัติค่ารอบทั้งหมดจนกว่าจะตั้ง`,
      );
    }

    const jobs = await loadJobs(db, jobIds);
    const now = Date.now();
    const approvedBy = staff.id || request.auth.uid;
    const updates = {};
    const approved = [];
    const skipped = [];
    const blocked = [];
    jobs.forEach((job, i) => {
      if (!job) {
        skipped.push({ jobId: jobIds[i], code: "not_found" });
        return;
      }
      try {
        const txKey = db.ref("transactions").push().key;
        const u = buildRiderFeeApproval({ job, txKey, now, approvedBy, ownerRiderIds: owners });
        if (!u) {
          skipped.push({ jobId: job.id, code: "not_payable" });
          return;
        }
        Object.assign(updates, u);
        approved.push({ jobId: job.id, txKey, amount: u[`transactions/${txKey}`].amount });
      } catch (e) {
        if (e instanceof RiderFeeGuardError) blocked.push({ jobId: job.id, code: e.code });
        else throw e;
      }
    });

    if (blocked.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        `มีใบที่ห้ามจ่ายค่ารอบ ${blocked.length} ใบ (${blocked.map((b) => `${b.jobId}:${b.code}`).join(", ")}) — ไม่เขียนอะไรเลย`,
        { blocked },
      );
    }
    if (approved.length > 0) await db.ref().update(updates);
    return { approved, skipped };
  });

  const adminRiderFeeWaive = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const staff = await requireRole(db, request.auth, WAIVE_ROLES);
    const { jobIds: rawIds, reason } = request.data || {};
    const jobIds = normalizeJobIds(rawIds);
    if (typeof reason !== "string" || !reason.trim()) {
      throw new HttpsError("invalid-argument", "ต้องระบุเหตุผลที่ยกเว้นค่ารอบ");
    }

    const jobs = await loadJobs(db, jobIds);
    const now = Date.now();
    const by = staff.id || request.auth.uid;
    const updates = {};
    const waived = [];
    const skipped = [];
    jobs.forEach((job, i) => {
      if (!job) {
        skipped.push({ jobId: jobIds[i], code: "not_found" });
        return;
      }
      let u;
      try {
        u = buildRiderFeeWaive({ job, reason, now, by });
      } catch (e) {
        if (e instanceof RiderFeeGuardError) throw new HttpsError("invalid-argument", e.message);
        throw e;
      }
      if (!u) {
        skipped.push({ jobId: job.id, code: job.rider_fee_status === "Paid" ? "already_paid" : "not_pending" });
        return;
      }
      Object.assign(updates, u);
      waived.push({ jobId: job.id });
    });

    if (waived.length > 0) await db.ref().update(updates);
    return { waived, skipped };
  });

  return { adminRiderFeeConfig, adminRiderFeeApprove, adminRiderFeeWaive };
}

module.exports = { registerRiderFeeAdmin, APPROVE_ROLES, WAIVE_ROLES, MAX_JOBS_PER_CALL };
