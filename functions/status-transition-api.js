// transitionJob — the callable front door to the status engine.
//
// This is the only way a client is meant to change a job's status. It exists
// because the alternative, which is what runs today, is every client writing
// jobs/{id}/status directly with the RTDB rules validating nothing about the
// field: a rider can write "Paid" over "New Lead", and the only thing stopping
// them is that no button renders for it.
//
// Nothing calls this yet, on purpose. It ships and deploys FIRST; the writers
// move afterwards, one client at a time. The other order — client first — is a
// rider in the field tapping a button that calls a function that does not
// exist.
//
// TWO KINDS OF PERMISSION, DELIBERATELY SPLIT
//   The engine's table answers "may a rider fire rider_departed at all". It
//   cannot answer "is this the rider holding THIS job", because that is about
//   identity, not about the state machine. So role comes from verified auth
//   here, and the per-row ownership question goes in as a guard that runs
//   INSIDE the transaction — checking it out here against a row read a moment
//   earlier would be checking a job that may since have been reassigned.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const { applyTransition } = require("./status-apply");
const { ACTOR } = require("./status-engine");

const REGION = "asia-southeast1";

// Staff roles as /staff records carry them → the engine's actors. CASHIER and
// QC are the deprecated values in domain.ts that no route guard recognises any
// more; they map to nothing rather than silently inheriting staff powers.
const ROLE_TO_ACTOR = {
  CEO: ACTOR.ADMIN_MANAGER,
  MANAGER: ACTOR.ADMIN_MANAGER,
  FINANCE: ACTOR.FINANCE,
  STAFF: ACTOR.ADMIN_STAFF,
  RIDER: ACTOR.RIDER,
};

function actorForRole(role) {
  return ROLE_TO_ACTOR[String(role || "").toUpperCase()] || null;
}

// Engine refusals carry a code; clients deserve the right gRPC status for each
// so a retry loop can tell "you may not" from "try again".
const CODE_TO_HTTPS = {
  unknown_event: "invalid-argument",
  missing_field: "invalid-argument",
  patch_conflict: "invalid-argument",
  wrong_actor: "permission-denied",
  not_job_owner: "permission-denied",
  job_not_found: "not-found",
  illegal_from: "failed-precondition",
  unreadable_status: "failed-precondition",
  wrong_receive_method: "failed-precondition",
  wrong_job_type: "failed-precondition",
  already_paid: "failed-precondition",
  not_paid: "failed-precondition",
  write_contended: "aborted",
};

function httpsErrorFor(result) {
  return new HttpsError(CODE_TO_HTTPS[result.code] || "internal", result.message || result.code, {
    code: result.code,
  });
}

/**
 * Ownership guard for riders: the job must already be theirs, or — for the
 * events that are how a job BECOMES theirs — still be unclaimed. Runs inside
 * the transaction; see the note at the top of the file.
 */
const CLAIMING_EVENTS = new Set(["rider_accepted"]);

function riderOwnershipGuard(uid, event) {
  return (job) => {
    const holder = job && job.rider_id;
    if (holder === uid) return null;
    if (CLAIMING_EVENTS.has(event) && !holder) return null;
    return {
      code: "not_job_owner",
      message: holder ? "งานนี้มีไรเดอร์คนอื่นถืออยู่" : "ต้องรับงานก่อนจึงจะดำเนินการได้",
    };
  };
}

exports.transitionJob = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");

  const { jobId, event, patch, reason } = request.data || {};
  if (!jobId || typeof jobId !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ jobId");
  }
  if (!event || typeof event !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ event");
  }
  if (patch !== undefined && (patch === null || typeof patch !== "object" || Array.isArray(patch))) {
    throw new HttpsError("invalid-argument", "patch ต้องเป็น object");
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 1000)) {
    throw new HttpsError("invalid-argument", "reason ยาวเกิน 1,000 ตัวอักษร");
  }

  const db = getDatabase();

  // The role comes from the auth token, never from the request body: a
  // client-supplied role is a client-chosen permission.
  const who = await lookupStaffByAuth(db, request.auth);
  const actor = who ? actorForRole(who.role) : null;
  if (!actor) {
    throw new HttpsError("permission-denied", "บัญชีนี้ไม่มีสิทธิ์เปลี่ยนสถานะงาน");
  }

  const result = await applyTransition({
    db,
    jobId,
    event,
    actor,
    by: `${actor}:${who.id}`,
    // แถวใน qc_logs ถูกแอดมินอ่านด้วยตา ชื่อคนจึงมีค่ากว่า uid — ส่วน `by`
    // ข้างบนยังเป็นรูปที่ query ได้ ใช้คู่กันคนละหน้าที่
    byName: who.name || who.displayName || `${actor}:${who.id}`,
    reason,
    patch: patch || {},
    guard: actor === ACTOR.RIDER ? riderOwnershipGuard(request.auth.uid, event) : null,
  });

  if (!result.ok) {
    console.warn(`[transitionJob] ${jobId} ${event} by ${actor}:${who.id} refused: ${result.code}`);
    throw httpsErrorFor(result);
  }

  console.log(
    `[transitionJob] ${jobId} ${result.from} → ${result.to} via ${event} by ${actor}:${who.id} (v${result.status_version})`
  );
  return {
    ok: true,
    from: result.from,
    to: result.to,
    custody: result.custody,
    status_version: result.status_version,
  };
});

// Exported for the offline suite: the parts worth testing are the mappings and
// the guard, not the onCall plumbing.
exports.__test__ = { actorForRole, riderOwnershipGuard, CODE_TO_HTTPS };
