// =============================================================================
// BKK Diagnos — on-device diagnostic sessions (design: bkk-frontend-next
// docs/diagnos-design-spec.md)
//
// A session is a short-lived workspace under /diagnostic_sessions/{sid}:
// staff (rider/admin) creates it, the customer's device claims it via a
// QR secret and writes per-step results directly (rules gate on claimed_by),
// then finalize verifies everything server-side and stamps a summary
// snapshot onto jobs/{id}/devices/{i}/diagnostics. Money and job status are
// never touched here — results are evidence for the amendment flow, not a
// pricing input.
//
// Function names are project-unique on purpose ({region}/{name} collision
// rule — see CLAUDE.md Cloud Functions section).
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getDatabase } = require("firebase-admin/database");
const crypto = require("crypto");

const DIAGNOS_REGION = "asia-southeast1";
const SESSION_TTL_MS = 30 * 60 * 1000; // QR expires 30 min after creation
const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // purge sessions after 7 days
const DIAGNOS_BASE_URL = process.env.DIAGNOS_BASE_URL || "https://www.bkkapple.com";

const STEP_IDS = [
  "device_identity",
  "find_my",
  "touch_grid",
  "display",
  "camera_back",
  "camera_front",
  "mic_speaker",
  "gps",
  "motion",
  "battery_guided",
  "faceid_guided",
];

const STEP_LABEL_TH = {
  device_identity: "ตรวจตัวตนเครื่อง",
  find_my: "Find My / iCloud",
  touch_grid: "ทัชสกรีน",
  display: "จอภาพ",
  camera_back: "กล้องหลัง",
  camera_front: "กล้องหน้า",
  mic_speaker: "ไมค์และลำโพง",
  gps: "GPS",
  motion: "เซ็นเซอร์การเคลื่อนไหว",
  battery_guided: "Battery Health",
  faceid_guided: "Face ID / Touch ID",
};

// Fallback keyword map: which customer-reported condition titles/values a
// failed step contradicts. Used until condition_sets carry an explicit
// diagnosticType tag (spec section 6.4). Matching is conservative — a
// mismatch is only recorded when the customer's matched condition is
// non-negative (they claimed it was fine) and the diagnostic says fail.
const STEP_CONDITION_KEYWORDS = {
  touch_grid: ["ทัช", "สัมผัส", "touch"],
  display: ["จอ", "หน้าจอ", "display", "screen"],
  camera_back: ["กล้อง", "camera"],
  camera_front: ["กล้อง", "camera"],
  mic_speaker: ["ลำโพง", "ไมค์", "เสียง", "speaker", "mic"],
  gps: ["gps", "จีพีเอส"],
  motion: ["เซ็นเซอร์", "gyro", "ไจโร"],
  battery_guided: ["แบต", "battery"],
  faceid_guided: ["face id", "touch id", "สแกนใบหน้า", "สแกนนิ้ว"],
  find_my: ["icloud", "find my", "ค้นหา"],
};

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function nowMs() {
  return Date.now();
}

async function requireAdmin(db, uid) {
  const adminSnap = await db.ref(`admins/${uid}`).once("value");
  return adminSnap.exists() && adminSnap.val().role === "admin";
}

function devicesList(job) {
  const raw = job && job.devices;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function guessCategory(modelName) {
  const m = String(modelName || "").toLowerCase();
  if (m.includes("ipad")) return "ipad";
  if (m.includes("watch")) return "watch";
  if (m.includes("mac")) return "mac";
  return "iphone";
}

function prependQcLog(job, entry) {
  const existing = Array.isArray(job.qc_logs)
    ? job.qc_logs
    : job.qc_logs
      ? Object.values(job.qc_logs)
      : [];
  return [entry, ...existing];
}

/** Loads session + job and authorizes the caller as the job's rider or an
 *  admin. Returns { session, job, actor } or throws HttpsError. */
async function loadSessionForStaff(db, uid, sessionId) {
  const sessSnap = await db.ref(`diagnostic_sessions/${sessionId}`).once("value");
  if (!sessSnap.exists()) throw new HttpsError("not-found", "ไม่พบ session");
  const session = sessSnap.val();

  const jobSnap = await db.ref(`jobs/${session.job_id}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบงานของ session นี้");
  const job = jobSnap.val();

  if (job.rider_id === uid) {
    const riderSnap = await db.ref(`riders/${uid}`).once("value");
    const name = (riderSnap.val() && riderSnap.val().name) || job.rider_name || "Rider";
    return { session, job, actor: { role: "RIDER", name } };
  }
  if (await requireAdmin(db, uid)) {
    const adminSnap = await db.ref(`admins/${uid}`).once("value");
    const name = adminSnap.val().name || adminSnap.val().display_name || "Admin";
    return { session, job, actor: { role: "ADMIN", name } };
  }
  throw new HttpsError("permission-denied", "ไม่มีสิทธิ์กับ session นี้");
}

// =============================================================================
// createDiagnosticSession — staff-initiated. Returns the QR payload URL.
// Creating a new session for the same job+device cancels any older open one,
// so a re-shown QR always wins and stale QRs stop working.
// =============================================================================
exports.createDiagnosticSession = onCall({ region: DIAGNOS_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const { jobId, deviceIndex, mode } = request.data || {};

  if (!jobId || typeof jobId !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ jobId");
  }
  const devIdx = Number.isInteger(deviceIndex) ? deviceIndex : 0;
  if (devIdx < 0 || devIdx > 50) {
    throw new HttpsError("invalid-argument", "deviceIndex ไม่ถูกต้อง");
  }
  const sessionMode = mode === "staff" ? "staff" : "customer";

  const db = getDatabase();
  const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบงาน");
  const job = jobSnap.val();

  let actor;
  if (job.rider_id === request.auth.uid) {
    const riderSnap = await db.ref(`riders/${request.auth.uid}`).once("value");
    actor = { role: "RIDER", name: (riderSnap.val() && riderSnap.val().name) || job.rider_name || "Rider" };
  } else if (await requireAdmin(db, request.auth.uid)) {
    const adminSnap = await db.ref(`admins/${request.auth.uid}`).once("value");
    actor = { role: "ADMIN", name: adminSnap.val().name || adminSnap.val().display_name || "Admin" };
  } else {
    throw new HttpsError("permission-denied", "เฉพาะไรเดอร์ของงานนี้หรือแอดมิน");
  }

  const devices = devicesList(job);
  const device = devices[devIdx];
  if (!device) throw new HttpsError("invalid-argument", `ไม่พบเครื่องลำดับที่ ${devIdx} ในงานนี้`);

  const category = guessCategory(device.model || device.model_name);
  if (category === "watch" || category === "mac") {
    throw new HttpsError(
      "failed-precondition",
      "Diagnos รองรับเฉพาะ iPhone/iPad ในเฟสนี้ — Apple Watch/Mac ใช้ขั้นตอนตรวจปกติ"
    );
  }

  const now = nowMs();
  const updates = {};

  // Invalidate older open sessions for the same job+device.
  const openSnap = await db.ref("diagnostic_sessions")
    .orderByChild("job_id").equalTo(jobId).once("value");
  openSnap.forEach((s) => {
    const v = s.val();
    if (v && (v.device_index ?? 0) === devIdx && (v.status === "open" || v.status === "in_progress")) {
      updates[`diagnostic_sessions/${s.key}/status`] = "cancelled";
      updates[`diagnostic_sessions/${s.key}/cancelled_at`] = now;
    }
  });

  const secret = crypto.randomBytes(24).toString("hex");
  const newRef = db.ref("diagnostic_sessions").push();
  const sessionId = newRef.key;

  updates[`diagnostic_sessions/${sessionId}`] = {
    job_id: jobId,
    device_index: devIdx,
    mode: sessionMode,
    status: "open",
    created_by: { uid: request.auth.uid, role: actor.role, name: actor.name },
    created_at: now,
    expires_at: now + SESSION_TTL_MS,
    secret_hash: sha256(secret),
    claimed_by: null,
    device_label: device.model || device.model_name || "",
    category,
  };

  updates[`jobs/${jobId}/qc_logs`] = prependQcLog(job, {
    action: "Diagnos Started",
    by: `${actor.role === "RIDER" ? "Rider" : "Admin"}: ${actor.name}`,
    timestamp: now,
    details: `เริ่ม BKK Diagnos เครื่องที่ ${devIdx + 1} (${device.model || "-"}) โหมด ${sessionMode}`,
  });

  await db.ref().update(updates);

  // Secret rides in the URL fragment so it never reaches server logs.
  const url = `${DIAGNOS_BASE_URL}/diagnos/s/${sessionId}#k=${secret}`;
  return { ok: true, sessionId, url, expiresAt: now + SESSION_TTL_MS };
});

// =============================================================================
// claimDiagnosticSession — called from the customer's device (anonymous auth)
// after scanning the QR. Binds the device to the session; from then on the
// database rules let that uid write steps directly (live monitoring).
// =============================================================================
exports.claimDiagnosticSession = onCall({ region: DIAGNOS_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const { sessionId, secret } = request.data || {};
  if (!sessionId || typeof sessionId !== "string" || !secret || typeof secret !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ sessionId และ secret");
  }

  const db = getDatabase();
  const ref = db.ref(`diagnostic_sessions/${sessionId}`);
  const snap = await ref.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบ session");
  const session = snap.val();

  if (sha256(secret) !== session.secret_hash) {
    throw new HttpsError("permission-denied", "รหัส QR ไม่ถูกต้อง");
  }
  const now = nowMs();
  if (now > (session.expires_at || 0)) {
    throw new HttpsError("failed-precondition", "QR หมดอายุแล้ว — ให้พนักงานสร้างใหม่");
  }
  if (session.status === "cancelled" || session.status === "expired" || session.status === "submitted") {
    throw new HttpsError("failed-precondition", `session ปิดแล้ว (${session.status})`);
  }
  // One device only. Re-claim by the same uid is allowed (page refresh).
  if (session.claimed_by && session.claimed_by !== request.auth.uid) {
    throw new HttpsError("failed-precondition", "session นี้ถูกใช้กับเครื่องอื่นแล้ว");
  }

  if (!session.claimed_by) {
    // The 30-min TTL is the QR *claim* window. Once a device claims, extend
    // the session so a slow run is never cut off mid-test (step writes are
    // rules-gated on expires_at).
    await ref.update({
      claimed_by: request.auth.uid,
      claimed_at: now,
      status: "in_progress",
      expires_at: now + SESSION_TTL_MS + 60 * 60 * 1000,
    });
  }

  return {
    ok: true,
    sessionId,
    mode: session.mode || "customer",
    deviceLabel: session.device_label || "",
    category: session.category || "iphone",
    expiresAt: session.expires_at,
    steps: STEP_IDS,
  };
});

// =============================================================================
// finalizeDiagnosticSession — closes the session, recomputes the summary from
// what's actually in the DB (never trusts a client-sent tally), compares
// against what the customer reported at checkout, and stamps the snapshot
// onto the job + qc_logs.
// =============================================================================
exports.finalizeDiagnosticSession = onCall({ region: DIAGNOS_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const { sessionId } = request.data || {};
  if (!sessionId || typeof sessionId !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ sessionId");
  }

  const db = getDatabase();
  const sessSnap = await db.ref(`diagnostic_sessions/${sessionId}`).once("value");
  if (!sessSnap.exists()) throw new HttpsError("not-found", "ไม่พบ session");
  const session = sessSnap.val();

  let actorLabel;
  if (session.claimed_by === request.auth.uid) {
    actorLabel = session.mode === "staff"
      ? `${session.created_by?.role === "RIDER" ? "Rider" : "Admin"}: ${session.created_by?.name || "-"}`
      : "Customer";
  } else {
    const { actor } = await loadSessionForStaff(db, request.auth.uid, sessionId);
    actorLabel = `${actor.role === "RIDER" ? "Rider" : "Admin"}: ${actor.name}`;
  }

  if (session.status === "submitted") {
    return { ok: true, sessionId, alreadySubmitted: true };
  }
  if (session.status !== "in_progress" && session.status !== "open") {
    throw new HttpsError("failed-precondition", `session ปิดแล้ว (${session.status})`);
  }

  const jobSnap = await db.ref(`jobs/${session.job_id}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบงานของ session นี้");
  const job = jobSnap.val();
  const devIdx = session.device_index ?? 0;
  const devices = devicesList(job);
  const device = devices[devIdx] || {};

  // --- Summarize steps (server-computed) ---
  const steps = session.steps && typeof session.steps === "object" ? session.steps : {};
  const results = {};
  const values = {};
  let pass = 0, fail = 0, skipped = 0;
  for (const stepId of STEP_IDS) {
    const s = steps[stepId];
    const result = s && ["pass", "fail", "skipped"].includes(s.result) ? s.result : null;
    if (!result) continue;
    results[stepId] = result;
    if (result === "pass") pass += 1;
    else if (result === "fail") fail += 1;
    else skipped += 1;
    if (s.value !== undefined && s.value !== null) values[stepId] = s.value;
  }

  // --- Mismatches vs what the customer reported at checkout ---
  const conditions = Array.isArray(device.customer_conditions)
    ? device.customer_conditions
    : device.customer_conditions
      ? Object.values(device.customer_conditions)
      : [];
  const mismatches = [];
  for (const [stepId, result] of Object.entries(results)) {
    if (result !== "fail") continue;
    const keywords = STEP_CONDITION_KEYWORDS[stepId] || [];
    const matched = conditions.find((c) => {
      if (!c || c.isNegative) return false; // customer already declared a defect
      const text = `${c.title || ""} ${c.value || ""}`.toLowerCase();
      return keywords.some((k) => text.includes(k));
    });
    if (matched) {
      mismatches.push({
        step_id: stepId,
        step_label: STEP_LABEL_TH[stepId] || stepId,
        customer_said: `${matched.title || ""}: ${matched.value || ""}`.trim(),
        diagnostic_result: "fail",
      });
    }
  }

  const now = nowMs();
  const summary = { pass, fail, skipped };
  const snapshot = {
    session_id: sessionId,
    mode: session.mode || "customer",
    performed_by: actorLabel,
    submitted_at: now,
    results,
    values,
    summary,
    mismatches,
    device_info: session.device_info || null,
  };

  const updates = {
    [`diagnostic_sessions/${sessionId}/status`]: "submitted",
    [`diagnostic_sessions/${sessionId}/submitted_at`]: now,
    [`diagnostic_sessions/${sessionId}/summary`]: summary,
    [`jobs/${session.job_id}/devices/${devIdx}/diagnostics`]: snapshot,
    [`jobs/${session.job_id}/qc_logs`]: prependQcLog(job, {
      action: "Diagnos Completed",
      by: actorLabel,
      timestamp: now,
      details: `BKK Diagnos เครื่องที่ ${devIdx + 1}: ${pass} ผ่าน / ${fail} ไม่ผ่าน / ${skipped} ข้าม${mismatches.length ? ` — พบ ${mismatches.length} จุดขัดกับที่ลูกค้าแจ้ง` : ""}`,
    }),
  };

  await db.ref().update(updates);
  return { ok: true, sessionId, summary, mismatches };
});

// =============================================================================
// cleanupDiagnosticSessions — daily sweep: expire stale open sessions, purge
// anything older than the retention window. Sessions are a workspace, not a
// ledger — the durable record is the snapshot on the job.
// =============================================================================
exports.cleanupDiagnosticSessions = onSchedule(
  { schedule: "every day 03:30", timeZone: "Asia/Bangkok", region: DIAGNOS_REGION },
  async () => {
    const db = getDatabase();
    const snap = await db.ref("diagnostic_sessions").once("value");
    if (!snap.exists()) return;

    const now = nowMs();
    const updates = {};
    snap.forEach((s) => {
      const v = s.val() || {};
      const isOpen = v.status === "open" || v.status === "in_progress";
      if (isOpen && now > (v.expires_at || 0)) {
        updates[`diagnostic_sessions/${s.key}/status`] = "expired";
        updates[`diagnostic_sessions/${s.key}/expired_at`] = now;
      }
      const age = now - (v.created_at || 0);
      if (age > SESSION_RETENTION_MS && v.status !== "open" && v.status !== "in_progress") {
        updates[`diagnostic_sessions/${s.key}`] = null;
      }
    });

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`[cleanupDiagnosticSessions] applied ${Object.keys(updates).length} updates`);
    }
  }
);
