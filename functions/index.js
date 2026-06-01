const { onValueCreated, onValueUpdated, onValueWritten } = require("firebase-functions/v2/database");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

// =============================================================================
// Admin push helper: collect tokens, multicast send, prune dead tokens
// Three trigger functions used to repeat this block; centralizing it keeps
// the cleanup-on-failure rule the same everywhere.
// =============================================================================

async function dispatchAdminPush(message, tag) {
  const db = getDatabase();
  const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
  if (!tokensSnap.exists()) {
    console.warn(`[${tag}] No tokens in admin_fcm_tokens — nobody to notify`);
    return { successCount: 0, failureCount: 0, total: 0 };
  }

  const tokens = [];
  const tokenMeta = [];
  tokensSnap.forEach((staffSnap) => {
    staffSnap.forEach((tokenSnap) => {
      const data = tokenSnap.val();
      if (data && data.token) {
        tokens.push(data.token);
        tokenMeta.push({ staffId: staffSnap.key, tokenKey: tokenSnap.key });
      }
    });
  });

  if (tokens.length === 0) {
    console.warn(`[${tag}] Found token entries but all empty — nobody to notify`);
    return { successCount: 0, failureCount: 0, total: 0 };
  }

  const messaging = getMessaging();
  const batches = [];
  for (let i = 0; i < tokens.length; i += 500) {
    batches.push(
      messaging.sendEachForMulticast({ ...message, tokens: tokens.slice(i, i + 500) })
    );
  }
  const results = await Promise.all(batches);

  // iOS PWA's FCM token frequently looks "dead" to FCM right after iOS pauses
  // the PWA / rotates the web-push subscription, but the page can recover it
  // on next open by calling deleteToken() + getToken() to bypass the SDK's
  // local cache. Removing the entry on first rejection broke that recovery
  // path — the user would silently miss every push until they happened to
  // re-open the PWA and the hook re-registered from scratch at a fresh
  // deviceId (which doesn't help if iOS reuses the same localStorage entry).
  //
  // New policy: stamp first_failure_at / last_failure_at, leave the token in
  // place. The page hook treats last_failure_at as a signal to force-refresh
  // via deleteToken() on next visibility. Only after 7 days of consecutive
  // failures do we accept the token is truly dead and remove it.
  const FAILURE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  let tokenIdx = 0;
  for (const result of results) {
    const failures = [];
    result.responses.forEach((resp, idx) => {
      if (resp.error) {
        const meta = tokenMeta[tokenIdx + idx];
        if (
          (resp.error.code === "messaging/registration-token-not-registered" ||
            resp.error.code === "messaging/invalid-registration-token") &&
          meta
        ) {
          failures.push({ meta, code: resp.error.code });
        }
      }
    });
    await Promise.all(
      failures.map(async ({ meta, code }) => {
        const path = db.ref(`admin_fcm_tokens/${meta.staffId}/${meta.tokenKey}`);
        const snap = await path.once("value");
        const existing = snap.val() || {};
        const firstFailureAt = existing.first_failure_at || Date.now();
        const ageMs = Date.now() - firstFailureAt;
        if (ageMs >= FAILURE_GRACE_MS) {
          await path.remove();
          console.log(
            `[${tag}] Removed dead token (failed ${(ageMs / 86400000).toFixed(1)}d): ${meta.staffId}/${meta.tokenKey}`
          );
        } else {
          await path.update({
            first_failure_at: firstFailureAt,
            last_failure_at: Date.now(),
            last_failure_code: code,
          });
        }
      })
    );
    tokenIdx += result.responses.length;
  }

  const successCount = results.reduce((acc, r) => acc + r.successCount, 0);
  const failureCount = tokens.length - successCount;
  console.log(`[${tag}] Done: ${successCount} success, ${failureCount} failed, ${tokens.length} total`);
  return { successCount, failureCount, total: tokens.length };
}

// =============================================================================
// Rider Fee Calculation: คำนวณค่าวิ่งไรเดอร์ตามระยะทางจริง
// =============================================================================

const DEFAULT_LOGISTICS_RATES = {
  base_fee: 60,
  per_km: 15,
  min_fee: 100,
  max_fee: 500,
};

/**
 * ดึงระยะทาง driving จริงจาก Google Routes API (v2:computeRoutes)
 * ต้องตั้งค่า GOOGLE_MAPS_API_KEY ใน Cloud Functions secrets/env
 *
 * ใช้ Routes API แทน Distance Matrix API เพราะ Google แนะนำเป็น successor
 * (ราคาเท่ากัน, response เล็กกว่า, ใช้ field mask)
 *
 * คืน { distance_km, duration_min } หรือ { error } ถ้า fail
 */
async function fetchDrivingDistance(origin, destination) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("[routesApi] GOOGLE_MAPS_API_KEY not configured");
    return { error: "api_key_missing" };
  }

  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const body = {
    origin: {
      location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lng },
      },
    },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };

  // Hard timeout so a slow/hung Routes endpoint can never block the calling
  // function until its own 60s timeout. Callers treat any error as a
  // graceful fallback to min_fee, so an abort just means "no live distance".
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[routesApi] HTTP ${res.status}: ${await res.text()}`);
      return { error: `http_${res.status}` };
    }
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route || typeof route.distanceMeters !== "number") {
      console.error(
        `[routesApi] No route in response: ${JSON.stringify(data).slice(0, 200)}`
      );
      return { error: "no_route" };
    }
    // duration มาเป็น string "900s" — ตัด "s" แล้วแปลงเป็นนาที
    const durationSec = parseFloat(String(route.duration || "0").replace("s", ""));
    return {
      distance_km: route.distanceMeters / 1000,
      duration_min: durationSec / 60,
    };
  } catch (err) {
    if (err && err.name === "AbortError") {
      console.error("[routesApi] Fetch timed out after 8s");
      return { error: "timeout" };
    }
    console.error("[routesApi] Fetch failed:", err);
    return { error: "fetch_exception" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * อ่านอัตราค่าวิ่งจาก settings/logistics_rates (configurable ผ่าน admin UI)
 * คืนค่า default ถ้ายังไม่ได้ตั้งไว้
 */
async function getLogisticsRates(db) {
  const snap = await db.ref("settings/logistics_rates").once("value");
  const saved = snap.exists() ? snap.val() : {};
  return {
    base_fee: Number(saved.base_fee ?? DEFAULT_LOGISTICS_RATES.base_fee),
    per_km: Number(saved.per_km ?? DEFAULT_LOGISTICS_RATES.per_km),
    min_fee: Number(saved.min_fee ?? DEFAULT_LOGISTICS_RATES.min_fee),
    max_fee: Number(saved.max_fee ?? DEFAULT_LOGISTICS_RATES.max_fee),
  };
}

/**
 * หาพิกัดสาขาปลายทางสำหรับ job หนึ่ง
 * ลำดับ fallback:
 *   1. job.branch_details.{lat,lng}  (ถูก populate ตอนสร้างงานฝั่ง frontend)
 *   2. settings/branches/{job.branch_id}
 *   3. settings/branches แรกที่ isActive
 * คืน null ถ้าไม่พบ
 */
async function resolveBranchCoords(db, job) {
  const bd = job && job.branch_details;
  if (bd && typeof bd.lat === "number" && typeof bd.lng === "number") {
    return { lat: bd.lat, lng: bd.lng, source: "job.branch_details" };
  }

  if (job && job.branch_id) {
    const snap = await db
      .ref(`settings/branches/${job.branch_id}`)
      .once("value");
    if (snap.exists()) {
      const b = snap.val();
      if (typeof b.lat === "number" && typeof b.lng === "number") {
        return { lat: b.lat, lng: b.lng, source: `branches/${job.branch_id}` };
      }
    }
  }

  const allSnap = await db.ref("settings/branches").once("value");
  if (allSnap.exists()) {
    let fallback = null;
    allSnap.forEach((child) => {
      const b = child.val();
      if (
        !fallback &&
        b &&
        b.isActive !== false &&
        typeof b.lat === "number" &&
        typeof b.lng === "number"
      ) {
        fallback = { lat: b.lat, lng: b.lng, source: `branches/${child.key}` };
      }
    });
    if (fallback) return fallback;
  }

  return null;
}

/**
 * หาพิกัดจุดรับเครื่องของลูกค้า
 * รองรับหลาย field name เพราะแต่ละ client เขียนไม่เหมือนกัน
 * คืน null ถ้าไม่พบ (เช่นลูกค้าเลือก Store-in)
 */
function resolveCustomerCoords(job) {
  if (!job) return null;
  const candidates = [
    [job.cust_lat, job.cust_lng],
    [job.customer_lat, job.customer_lng],
    [job.pickup_lat, job.pickup_lng],
    job.pickup_location && [job.pickup_location.lat, job.pickup_location.lng],
    job.customer && [job.customer.lat, job.customer.lng],
  ];
  for (const pair of candidates) {
    if (!pair) continue;
    const [lat, lng] = pair;
    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng };
    }
  }
  return null;
}

/**
 * คำนวณค่าวิ่งไรเดอร์ (บาท, จำนวนเต็ม) จากระยะทาง driving จริง
 * สูตร: clamp(base_fee + per_km × distance_km, min_fee, max_fee)
 *
 * Fallback เป็น min_fee (พร้อม reason) เมื่อ:
 *   - ไม่มีพิกัดลูกค้า/สาขา (เช่น Store-in, ลูกค้าไม่ได้ปักหมุด)
 *   - Distance Matrix API fail (network / quota / API key)
 * ไม่คำนวณเส้นตรง (Haversine) เพื่อให้ยอดตรงกับระยะทางจริงเสมอ
 */
async function computeRiderFee(db, job) {
  const rates = await getLogisticsRates(db);
  const custCoords = resolveCustomerCoords(job);
  const branchCoords = await resolveBranchCoords(db, job);

  if (!custCoords || !branchCoords) {
    return {
      fee: rates.min_fee,
      distance_km: null,
      duration_min: null,
      rates,
      reason: !custCoords ? "missing_customer_coords" : "missing_branch_coords",
    };
  }

  const route = await fetchDrivingDistance(custCoords, branchCoords);
  if (route.error) {
    return {
      fee: rates.min_fee,
      distance_km: null,
      duration_min: null,
      rates,
      reason: `routes_api_${route.error}`,
    };
  }

  const raw = rates.base_fee + rates.per_km * route.distance_km;
  const clamped = Math.max(rates.min_fee, Math.min(rates.max_fee, raw));
  return {
    fee: Math.round(clamped),
    distance_km: Math.round(route.distance_km * 100) / 100,
    duration_min: Math.round(route.duration_min),
    rates,
    reason: "calculated",
  };
}

// =============================================================================
// Archive System: ย้ายงานที่จบแล้วไป jobs_archived เพื่อลด load
// =============================================================================

const TERMINAL_STATUSES = [
  "Completed",
  "Sold",
  "Cancelled",
  "Closed (Lost)",
  "Returned",
  "Withdrawal Completed",
];
const ARCHIVE_THRESHOLD_DAYS = 90;

/**
 * ฟังก์ชันกลางสำหรับ archive งานเก่า
 * ย้ายงานที่สถานะจบ + เก่ากว่า 90 วัน จาก jobs → jobs_archived
 */
async function runArchive() {
  const db = getDatabase();
  const jobsSnap = await db.ref("jobs").once("value");
  if (!jobsSnap.exists()) return { archived: 0 };

  const now = Date.now();
  const thresholdMs = ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  const updates = {};
  let count = 0;

  jobsSnap.forEach((child) => {
    const job = child.val();
    const jobId = child.key;
    const createdAt = job.created_at || job.updated_at || 0;

    if (
      TERMINAL_STATUSES.includes(job.status) &&
      createdAt > 0 &&
      now - createdAt > thresholdMs
    ) {
      updates[`jobs_archived/${jobId}`] = { ...job, archived_at: now };
      updates[`jobs/${jobId}`] = null;
      count++;
    }
  });

  if (count > 0) {
    await db.ref().update(updates);
  }

  console.log(`Archived ${count} old jobs`);
  return { archived: count };
}

/**
 * Scheduled Function: รันทุกวันตี 3 (Bangkok time)
 * ตรวจสอบและ archive งานเก่าอัตโนมัติ
 */
exports.archiveOldJobs = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "Asia/Bangkok",
    region: "asia-southeast1",
  },
  async () => {
    const result = await runArchive();
    console.log(`Scheduled archive completed:`, result);
  }
);

// ----------------------------------------------------------------------------
// Finalize soft-cancelled jobs
// ----------------------------------------------------------------------------
//
// "Cancelled" is a SOFT close, not the end of the line: the customer was told
// the job is off and the rider stood down, but admin can still reopen the same
// ticket (preserving the revised offer) if the customer comes back. This
// scheduler closes the loop — once a Cancelled job has sat untouched past the
// 7-day reopen window, it's finalized to the true terminal "Closed (Lost)".
//
// Mirrors REOPEN_WINDOW_DAYS in src/types/job-statuses.ts. A reopen clears
// cancelled_at, so reopened jobs naturally fall out of this sweep.
const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

exports.finalizeCancelledJobs = onSchedule(
  {
    schedule: "0 */6 * * *",
    timeZone: "Asia/Bangkok",
    region: "asia-southeast1",
  },
  async () => {
    const db = getDatabase();
    const jobsSnap = await db.ref("jobs").once("value");
    if (!jobsSnap.exists()) return;

    const now = Date.now();
    const updates = {};
    let count = 0;

    jobsSnap.forEach((child) => {
      const job = child.val();
      if (job.status !== "Cancelled") return;
      // No timestamp → can't age it out safely; leave for an admin to close.
      if (!job.cancelled_at) return;
      if (now - job.cancelled_at < REOPEN_WINDOW_MS) return;

      const jobId = child.key;
      const existingLogs = Array.isArray(job.qc_logs)
        ? job.qc_logs
        : job.qc_logs
          ? Object.values(job.qc_logs)
          : [];
      updates[`jobs/${jobId}/status`] = "Closed (Lost)";
      updates[`jobs/${jobId}/closed_at`] = now;
      updates[`jobs/${jobId}/closed_by`] = "system";
      updates[`jobs/${jobId}/qc_logs`] = [
        {
          action: "Closed (Lost)",
          details: "ปิดงานอัตโนมัติ (พ้นหน้าต่างนำกลับมาขายใหม่ 7 วัน)",
          by: "System",
          timestamp: now,
        },
        ...existingLogs,
      ];
      updates[`jobs/${jobId}/updated_at`] = now;
      count += 1;
    });

    if (count === 0) return;
    console.log(`[finalize-cancelled] Closing ${count} expired soft-cancelled jobs`);
    await db.ref().update(updates);
  }
);

/**
 * HTTP Function: เรียกด้วยมือเพื่อ migrate งานเก่าทันที
 * ใช้สำหรับการ migrate ครั้งแรก หรือเรียกเมื่อต้องการ archive ทันที
 *
 * Two modes via ?action= query param:
 *   - default / 'archive'      → runArchive() (the original behavior)
 *   - 'rename-statuses'        → runStatusMigration()
 *   - 'rename-statuses-dry'    → runStatusMigration({ dryRun: true })
 *
 * The status rename mode is the Phase 2D-4 one-time DB migration. Reusing
 * this existing HTTP endpoint instead of adding a new one avoids the
 * cloudfunctions.functions.setIamPolicy permission gap that blocked
 * runSlaExpire (#101) and expireStaleJobs (#102).
 */
exports.migrateOldJobs = onRequest(
  { region: "asia-southeast1", cors: true },
  async (req, res) => {
    const action = String(req.query.action || "archive");

    if (action === "rename-statuses" || action === "rename-statuses-dry") {
      const result = await runStatusMigration({ dryRun: action === "rename-statuses-dry" });
      return res.json({
        success: true,
        action,
        message: `${action === "rename-statuses-dry" ? "DRY RUN — would rename" : "Renamed"} ${result.renamed} job statuses`,
        ...result,
      });
    }

    const result = await runArchive();
    res.json({
      success: true,
      action: "archive",
      message: `Archived ${result.archived} old jobs`,
      ...result,
    });
  }
);

// =============================================================================
// Status migration (Phase 2D-4)
//
// One-time DB migration: rename legacy status strings in /jobs/* to the
// canonical names from src/types/job-statuses.ts. Phase 2A landed tolerant
// readers that accept both spellings; Phase 2D-1/2/3 flipped writers to
// emit canonical names. After this migration runs, the LEGACY_STATUS_MAP
// half of those readers can be deleted (in a follow-up PR).
//
// Trigger by hand once production has settled:
//   GET https://<region>-<project>.cloudfunctions.net/migrateOldJobs?action=rename-statuses-dry
//   GET https://<region>-<project>.cloudfunctions.net/migrateOldJobs?action=rename-statuses
//
// Run the dry mode first to see counts before committing.
// =============================================================================

// Mirror of LEGACY_ALIAS in src/types/job-statuses.ts. Kept inline because
// functions/ has its own rootDir and cannot import the TS enum.
const LEGACY_STATUS_RENAME = {
  PAID: "Paid",
  "Payment Completed": "Paid",
  "Active Leads": "Active Lead",
  Assigned: "Rider Assigned",
  Accepted: "Rider Accepted",
  "Heading to Customer": "Rider En Route",
  Arrived: "Rider Arrived",
  Returned: "Return Confirmed",
};

function resolveCanonical(legacy, receiveMethod) {
  if (!legacy) return null;
  if (legacy === "In-Transit") {
    return receiveMethod === "Pickup" ? "Rider Returning" : "Parcel In Transit";
  }
  return LEGACY_STATUS_RENAME[legacy] || null;
}

async function runStatusMigration({ dryRun = false } = {}) {
  const db = getDatabase();
  const jobsSnap = await db.ref("jobs").once("value");
  if (!jobsSnap.exists()) return { renamed: 0, scanned: 0, breakdown: {}, dryRun };

  const updates = {};
  const breakdown = {};
  let renamed = 0;
  let scanned = 0;

  jobsSnap.forEach((child) => {
    const job = child.val();
    const jobId = child.key;
    scanned++;

    const canonical = resolveCanonical(job.status, job.receive_method);
    if (!canonical || canonical === job.status) return;

    const key = `${job.status} → ${canonical}`;
    breakdown[key] = (breakdown[key] || 0) + 1;
    renamed++;

    if (!dryRun) {
      updates[`jobs/${jobId}/status`] = canonical;
      // Record the migration in qc_logs so the audit trail is intact.
      const existingLogs = Array.isArray(job.qc_logs) ? job.qc_logs : [];
      updates[`jobs/${jobId}/qc_logs`] = [
        {
          action: "Status Migrated",
          by: "System (Phase 2D-4)",
          timestamp: Date.now(),
          details: `Renamed legacy status "${job.status}" → "${canonical}"`,
        },
        ...existingLogs,
      ];
      updates[`jobs/${jobId}/updated_at`] = Date.now();
    }
  });

  if (!dryRun && renamed > 0) {
    await db.ref().update(updates);
  }

  console.log(
    `Status migration ${dryRun ? "(DRY RUN) " : ""}complete: scanned ${scanned}, renamed ${renamed}, breakdown ${JSON.stringify(breakdown)}`
  );
  return { renamed, scanned, breakdown, dryRun };
}

// =============================================================================
// SLA Timeouts: auto-expire stale Store-in / Mail-in jobs
//
// The status redesign session flagged that jobs can sit in "Waiting Drop-off"
// or "Following Up" indefinitely if the customer ghosts. Runbook:
//   - Store-in: 7 days from creation without anyone marking the device
//     received → set status to "Drop-off Expired".
//   - Mail-in: 14 days from creation without a tracking_number entered →
//     set status to "Shipping Expired".
// Both flip the canonical status and write the cancel taxonomy
// (cancel_category='sla_timeout', cancelled_by='system') so the analytics
// dashboard can split system-cancelled jobs from human-cancelled ones.
// =============================================================================

const STORE_IN_TIMEOUT_DAYS = 7;
const MAIL_IN_TIMEOUT_DAYS = 14;

// Source statuses for each timeout. Includes both legacy and canonical
// spellings so the trigger keeps matching through the Phase 2D writer
// rename. Drop-off Received and Parcel Received intentionally NOT here —
// once received, the SLA stops counting.
const STORE_IN_PENDING_STATUSES = new Set([
  "New Lead",
  "Following Up",
  "Appointment Set",
  "Waiting Drop-off",
]);
const MAIL_IN_PENDING_STATUSES = new Set([
  "New Lead",
  "Following Up",
  "Awaiting Shipping",
]);

async function runExpireStaleJobs() {
  const db = getDatabase();
  const jobsSnap = await db.ref("jobs").once("value");
  if (!jobsSnap.exists()) return { dropOffExpired: 0, shippingExpired: 0 };

  const now = Date.now();
  const storeInThresholdMs = STORE_IN_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
  const mailInThresholdMs = MAIL_IN_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
  const updates = {};
  let dropOffExpired = 0;
  let shippingExpired = 0;

  jobsSnap.forEach((child) => {
    const job = child.val();
    const jobId = child.key;
    const createdAt = job.created_at || 0;
    if (createdAt <= 0) return;

    const age = now - createdAt;
    const status = String(job.status || "");

    if (
      job.receive_method === "Store-in" &&
      STORE_IN_PENDING_STATUSES.has(status) &&
      age > storeInThresholdMs
    ) {
      const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
      updates[`jobs/${jobId}/status`] = "Drop-off Expired";
      updates[`jobs/${jobId}/cancel_category`] = "sla_timeout";
      updates[`jobs/${jobId}/cancel_reason`] =
        `ลูกค้าไม่มาส่งเครื่องภายใน ${STORE_IN_TIMEOUT_DAYS} วัน (ระบบยกเลิกอัตโนมัติ)`;
      updates[`jobs/${jobId}/cancelled_by`] = "system";
      updates[`jobs/${jobId}/cancelled_at`] = now;
      updates[`jobs/${jobId}/updated_at`] = now;
      updates[`jobs/${jobId}/qc_logs`] = [
        {
          action: "Drop-off Expired",
          by: "System (SLA)",
          timestamp: now,
          details: `งาน Store-in ค้างเกิน ${STORE_IN_TIMEOUT_DAYS} วัน (อายุ ${ageDays} วัน) — ระบบยกเลิกอัตโนมัติ`,
        },
        ...(job.qc_logs || []),
      ];
      dropOffExpired++;
      return;
    }

    if (
      job.receive_method === "Mail-in" &&
      MAIL_IN_PENDING_STATUSES.has(status) &&
      !job.tracking_number &&
      age > mailInThresholdMs
    ) {
      const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
      updates[`jobs/${jobId}/status`] = "Shipping Expired";
      updates[`jobs/${jobId}/cancel_category`] = "sla_timeout";
      updates[`jobs/${jobId}/cancel_reason`] =
        `ลูกค้าไม่ได้ส่งพัสดุภายใน ${MAIL_IN_TIMEOUT_DAYS} วัน (ระบบยกเลิกอัตโนมัติ)`;
      updates[`jobs/${jobId}/cancelled_by`] = "system";
      updates[`jobs/${jobId}/cancelled_at`] = now;
      updates[`jobs/${jobId}/updated_at`] = now;
      updates[`jobs/${jobId}/qc_logs`] = [
        {
          action: "Shipping Expired",
          by: "System (SLA)",
          timestamp: now,
          details: `งาน Mail-in ไม่มี tracking_number เกิน ${MAIL_IN_TIMEOUT_DAYS} วัน (อายุ ${ageDays} วัน) — ระบบยกเลิกอัตโนมัติ`,
        },
        ...(job.qc_logs || []),
      ];
      shippingExpired++;
    }
  });

  if (dropOffExpired + shippingExpired > 0) {
    await db.ref().update(updates);
  }

  console.log(
    `SLA expire complete: ${dropOffExpired} drop-off, ${shippingExpired} shipping`
  );
  return { dropOffExpired, shippingExpired };
}

/**
 * Scheduled Function: รันทุก 1 ชั่วโมง
 * ตรวจ Store-in ที่ค้าง > 7 วัน → Drop-off Expired
 * ตรวจ Mail-in ที่ไม่มี tracking_number > 14 วัน → Shipping Expired
 *
 * ⚠ DISABLED FOR CI DEPLOY. Both #100 and #101 attempts failed at the
 * IAM step:
 *   Failed to set the IAM Policy on the Service projects/*\/locations/
 *   asia-southeast1/services/expirestalejobs
 * The CI service account has roles/functions.developer (can update
 * existing functions) but lacks roles/functions.admin needed to create
 * a new function and bind its invoker. Granting that role is an
 * operations task outside this session.
 *
 * Until then, the helper above (runExpireStaleJobs) stays exported as
 * a regular module function. Re-enable this scheduled trigger by
 * un-commenting the block below once IAM is sorted, OR deploy this
 * single function once locally with admin credentials:
 *   firebase deploy --only functions:expireStaleJobs --project bkk-apple-tradein
 */
// exports.expireStaleJobs = onSchedule(
//   {
//     schedule: "every 1 hours",
//     timeZone: "Asia/Bangkok",
//     region: "asia-southeast1",
//   },
//   async () => {
//     const result = await runExpireStaleJobs();
//     console.log("Scheduled SLA expire completed:", result);
//   }
// );

// Note: a manual HTTP companion (runSlaExpire) was considered but
// dropped — deploying a NEW HTTPS function in this project requires
// `cloudfunctions.functions.setIamPolicy` on the CI service account,
// which is not granted. The scheduled function above runs hourly and
// covers the production need. If a debug trigger is ever required,
// add it as a Realtime DB trigger (e.g. write to /sla_expire_now to
// fire once) instead of HTTPS.

/**
 * Cloud Function: ส่ง Push Notification ให้ admin ทุกคนเมื่อมี ticket ใหม่
 * Trigger: เมื่อมีข้อมูลใหม่ถูกเขียนลง /jobs/{jobId}
 */
exports.onNewTicketCreated = onValueCreated(
  {
    ref: "/jobs/{jobId}",
    region: "asia-southeast1",
  },
  async (event) => {
    try {
      const job = event.data.val();
      if (!job) return;

      const jobId = event.params.jobId;
      const db = getDatabase();

      // เฉพาะ ticket ใหม่ (New Lead / New B2B Lead / Active Lead).
      // Accept both legacy "Active Leads" (plural) and the canonical
      // "Active Lead" so the trigger keeps firing through Phase 2D's
      // writer rename. functions/ can't import the canonical TS enum.
      const newStatuses = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead"];

      // Dispatch the admin push FIRST — before any external I/O. The
      // rider-fee estimate below calls the Google Routes API, which can be
      // slow, rate-limited, or hang. When it ran first (and was awaited),
      // a slow Routes call delayed the push and a hung one let the 60s
      // function timeout kill the invocation BEFORE dispatchAdminPush ever
      // ran — so the "new ticket" push silently went missing on some orders
      // ("บางครั้งก็แจ้งเตือน") while status-change pushes (which do no
      // network call before dispatch) always arrived. Sending the push
      // first decouples delivery from the Routes API entirely.
      if (newStatuses.includes(job.status)) {
        const model = job.model || "ไม่ระบุรุ่น";
        const price = job.price ? `฿${Number(job.price).toLocaleString()}` : "";
        const method = job.receive_method || "";
        const custName = job.cust_name || "";
        const isB2B = job.status === "New B2B Lead";

        const title = isB2B ? "📦 New B2B Ticket!" : "📱 Ticket ใหม่เข้ามา!";
        const body = `${model} ${price} ${custName ? `- ${custName}` : ""} ${method ? `(${method})` : ""}`.trim();

        console.log(`[onNewTicket] Job ${jobId}: status="${job.status}", model="${model}"`);

        // Data-only message: SW builds the notification from `data` so iOS
        // PWA shows it once. Including a top-level `notification` field would
        // cause iOS/FCM to auto-display ON TOP of the SW's showNotification
        // call, producing two identical alerts per push.
        await dispatchAdminPush(
          {
            data: {
              jobId,
              type: "new_ticket",
              title,
              body,
              model,
              price: String(job.price || ""),
              status: job.status,
              click_action: `/tickets`,
            },
            android: {
              priority: "high",
              notification: {
                channelId: "new_tickets",
                priority: "high",
                defaultSound: true,
                defaultVibrateTimings: true,
              },
            },
            apns: {
              headers: {
                "apns-priority": "10",
                "apns-push-type": "alert",
              },
              payload: {
                aps: {
                  "mutable-content": 1,
                  sound: "default",
                  badge: 1,
                },
              },
            },
            webpush: {
              headers: {
                Urgency: "high",
                TTL: "86400",
              },
              fcmOptions: {
                link: `/tickets`,
              },
            },
          },
          "onNewTicket"
        );
      } else {
        console.log(`[onNewTicket] Skipped push: status="${job.status}" not in ${JSON.stringify(newStatuses)}`);
      }

      // คำนวณ rider_fee_estimate เพื่อให้ไรเดอร์เห็นก่อนรับงาน — best-effort,
      // หลังส่ง push แล้ว เพื่อไม่ให้ความล่าช้าของ Routes API กระทบการแจ้งเตือน.
      try {
        const result = await computeRiderFee(db, job);
        await db.ref(`jobs/${jobId}`).update({
          rider_fee_estimate: result.fee,
          rider_fee_estimate_meta: {
            distance_km: result.distance_km,
            rates: result.rates,
            reason: result.reason,
            computed_at: Date.now(),
          },
        });
        console.log(
          `[onNewTicket] rider_fee_estimate for job ${jobId}: ฿${result.fee} (${result.reason}, ${result.distance_km ?? "n/a"} km)`
        );
      } catch (err) {
        console.error(`[onNewTicket] Failed to compute rider_fee_estimate:`, err);
      }
    } catch (err) {
      console.error("[onNewTicket] Unhandled error:", err);
    }
  }
);

/**
 * Cloud Function: ส่ง Push Notification ให้ admin ทุกคน เมื่อ rider ส่งข้อความแชทในงาน
 * Trigger: เมื่อมีข้อมูลใหม่ถูกเขียนลง /jobs/{jobId}/chats/{chatId}
 *
 * หมายเหตุ: การแจ้ง rider เมื่อ admin/customer ส่งข้อความ จัดการใน bkk-rider-app
 * (codebase rider-notifications → onNewChatMessage) เพื่อหลีกเลี่ยง push ซ้ำ
 * และรองรับ rider ที่ login หลายเครื่อง (multi-device FCM tokens)
 */
exports.onChatMessageCreated = onValueCreated(
  {
    ref: "/jobs/{jobId}/chats/{chatId}",
    region: "asia-southeast1",
  },
  async (event) => {
    const chat = event.data.val();
    if (!chat) return;

    const sender = chat.sender || "";
    if (sender !== "rider") return;

    const { jobId } = event.params;
    const senderName = chat.senderName || sender;
    const text = chat.text || "";
    const imageUrl = chat.imageUrl || "";

    const title = `💬 ${senderName}`;
    const body = imageUrl ? "📷 ส่งรูปภาพ" : text;
    const collapseKey = `chat-${jobId}`;

    // Data-only — SW builds the notification (see onNewTicketCreated for
    // why a top-level `notification` field is not used).
    await dispatchAdminPush(
      {
        data: { jobId, type: "chat_message", title, body, sender },
        android: {
          priority: "high",
          collapseKey,
          notification: {
            channelId: "chat_messages",
            priority: "high",
            defaultSound: true,
          },
        },
        apns: {
          headers: {
            "apns-collapse-id": collapseKey,
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
          payload: {
            aps: {
              "mutable-content": 1,
              sound: "default",
            },
          },
        },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "86400",
          },
        },
      },
      "onChatMessageCreated"
    );
  }
);

/**
 * HTTP Cloud Function: notifyChatMessage
 * เดิมเป็น no-op (onChatMessageCreated จัดการแทน)
 * เพิ่ม ?debug=true เพื่อดู admin FCM tokens + ทดสอบ push
 * เรียก:
 *   /notifyChatMessage?debug=true        → ดู tokens ใน database
 *   /notifyChatMessage?debug=true&send=true → ส่ง test push ไปทุก token
 */
exports.notifyChatMessage = onRequest(
  { region: "asia-southeast1", cors: true },
  async (req, res) => {
    // Debug mode: ดู tokens + ทดสอบ push
    if (req.query.debug === "true") {
      const db = getDatabase();
      const messaging = getMessaging();
      const shouldSend = req.query.send === "true";

      const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
      if (!tokensSnap.exists()) {
        return res.json({
          success: false,
          message: "No tokens found in admin_fcm_tokens",
          tokenCount: 0,
        });
      }

      const tokenDetails = [];
      const allTokens = [];
      tokensSnap.forEach((staffSnap) => {
        staffSnap.forEach((tokenSnap) => {
          const data = tokenSnap.val();
          if (data && data.token) {
            allTokens.push(data.token);
            tokenDetails.push({
              staffId: staffSnap.key,
              tokenKey: tokenSnap.key,
              device: data.device || "unknown",
              updated_at: data.updated_at
                ? new Date(data.updated_at).toISOString()
                : "N/A",
              tokenPreview: data.token.slice(0, 20) + "...",
            });
          }
        });
      });

      if (!shouldSend) {
        return res.json({
          success: true,
          message: `Found ${allTokens.length} token(s). Add &send=true to send test push.`,
          tokenCount: allTokens.length,
          tokens: tokenDetails,
        });
      }

      // ส่ง test push
      const title = "🔔 Test Push from Cloud Function";
      const body = `ทดสอบ push ${new Date().toLocaleString("th-TH")}`;

      const results = [];
      for (let i = 0; i < allTokens.length; i++) {
        try {
          await messaging.send({
            token: allTokens[i],
            notification: { title, body },
            data: { type: "test", timestamp: String(Date.now()) },
            webpush: {
              headers: { Urgency: "high", TTL: "86400" },
              notification: {
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                vibrate: [200, 100, 200],
                tag: "test-push",
                renotify: true,
              },
            },
            apns: {
              headers: { "apns-priority": "10", "apns-push-type": "alert" },
              payload: {
                aps: { alert: { title, body }, sound: "default", badge: 1 },
              },
            },
          });
          results.push({ ...tokenDetails[i], status: "SUCCESS", error: null });
        } catch (err) {
          results.push({
            ...tokenDetails[i],
            status: "FAILED",
            error: err.code || err.message || String(err),
          });
          if (
            err.code === "messaging/registration-token-not-registered" ||
            err.code === "messaging/invalid-registration-token"
          ) {
            await db
              .ref(
                `admin_fcm_tokens/${tokenDetails[i].staffId}/${tokenDetails[i].tokenKey}`
              )
              .remove();
            results[results.length - 1].cleaned = true;
          }
        }
      }

      const successCount = results.filter(
        (r) => r.status === "SUCCESS"
      ).length;
      return res.json({
        success: true,
        message: `Sent test push: ${successCount}/${allTokens.length} succeeded`,
        results,
      });
    }

    // Default: no-op (backward-compatible)
    res.json({ success: true, message: "Handled by database trigger" });
  }
);

// =============================================================================
// Status Change Notifications: แจ้ง admin เมื่อสถานะงานเปลี่ยน (ยกเลิก, ตีกลับ ฯลฯ)
// =============================================================================

/**
 * สถานะที่ต้องแจ้งเตือน admin พร้อม label ภาษาไทย
 *
 * Each notable transition is keyed by every spelling that may appear in
 * the DB so the trigger keeps firing while writers gradually adopt the
 * canonical names from src/types/job-statuses.ts (Phase 2D). The
 * functions/ entry point can't import the TS enum directly, so legacy
 * and canonical strings live side-by-side here and resolve to the same
 * Thai label.
 */
const NOTIFY_STATUS_MAP = {
  // Sales / scheduling — owner needs to see where the lead is in pre-pickup flow
  "Appointment Set": "📅 นัดหมายลูกค้าเรียบร้อย",
  "Waiting Drop-off": "🏬 รอลูกค้านำเครื่องมาส่งที่สาขา",
  "Awaiting Shipping": "📮 รอลูกค้าส่งเครื่องทางไปรษณีย์",
  // Inspection / negotiation
  "Revised Offer": "💰 เสนอราคาใหม่",
  Negotiation: "💬 ลูกค้าต่อราคา",
  "Price Accepted": "✅ ลูกค้ารับราคา",
  "Discrepancy Reported": "❗ พบความไม่ตรงตอนตรวจ — ต้องตรวจสอบ",
  // Rider lifecycle — admins need real-time visibility of who's where without
  // having to open the dashboard. Both canonical (job-statuses.ts) and legacy
  // DB strings are listed so the trigger keeps firing through the rename.
  //
  // Rider Assigned vs Rider Accepted are DIFFERENT events:
  //   - Rider Assigned  = admin manually picked a rider (the assigning admin
  //                       knows; other admins might not).
  //   - Rider Accepted  = rider tapped Accept in the PWA (or self-claimed a
  //                       broadcast job where status jumps straight from
  //                       Active Lead → Rider Accepted with no Rider Assigned
  //                       in between). Admin definitely needs to know this.
  // The earlier "double push" concern that omitted Rider Accepted was wrong
  // for the broadcast/self-claim path — user reported "ตอนรับงานไม่เด้ง".
  "Rider Assigned": "📋 จ่ายงานให้ไรเดอร์",
  Assigned: "📋 จ่ายงานให้ไรเดอร์",
  "Rider Accepted": "✋ ไรเดอร์รับงาน",
  Accepted: "✋ ไรเดอร์รับงาน",
  "Rider En Route": "🛣️ ไรเดอร์ออกเดินทาง",
  "Heading to Customer": "🛣️ ไรเดอร์ออกเดินทาง",
  "Rider Arrived": "📍 ไรเดอร์ถึงจุดนัดหมาย",
  Arrived: "📍 ไรเดอร์ถึงจุดนัดหมาย",
  // Drop-off / Mail-in arrival — owner needs to know device reached the shop
  "Drop-off Received": "📥 ลูกค้านำเครื่องมาส่งที่สาขาแล้ว",
  "Parcel In Transit": "📦 พัสดุอยู่ระหว่างขนส่ง",
  "Parcel Received": "📬 พัสดุถึงสาขาแล้ว",
  // Mid-inspection events
  "Being Inspected": "🔍 ไรเดอร์เริ่มตรวจสภาพเครื่อง",
  "QC Review": "⚠️ ส่งผลตรวจ — รออนุมัติ QC",
  "Pending QC": "📦 ไรเดอร์ส่งมอบเครื่อง — รอ QC",
  // Payout
  "Payout Processing": "💵 รอจ่ายเงิน — บัญชีต้อง action",
  "Waiting For Handover": "🤝 จ่ายเงินแล้ว — รอส่งมอบเครื่องกลับ",
  Paid: "💸 จ่ายเงินเรียบร้อย",
  "Rider Returning": "🔙 ไรเดอร์กำลังกลับสาขา",
  "In-Transit": "🔙 ไรเดอร์กำลังกลับสาขา", // Pickup overload — guarded below
  // Terminal happy-path
  Completed: "🎉 ปิดงานสมบูรณ์",
  // Returns / refunds
  Returned: "ตีเครื่องกลับ",
  "Return Confirmed": "ตีเครื่องกลับ", // canonical of "Returned"
  "Returning To Customer": "↩️ กำลังตีเครื่องคืนลูกค้า",
  "Withdrawal Requested": "💱 ขอถอนเงิน",
  "Refund Initiated": "↩️ เริ่มกระบวนการคืนเงิน — admin ต้อง action",
  "Refund Completed": "↩️ คืนเงินเรียบร้อย",
  Disputed: "⚖️ ลูกค้าโต้แย้ง — admin ต้องตรวจสอบ",
  // Logistics exceptions — owner must intervene
  "Drop-off Expired": "⏰ ลูกค้าไม่มา drop-off ตามนัด — งานหมดอายุ",
  "Shipping Expired": "⏰ ลูกค้าไม่ส่งพัสดุตามนัด — งานหมดอายุ",
  "Investigating Carrier": "🔎 กำลังตามขนส่ง — พัสดุล่าช้า",
  "Parcel Lost": "🚨 ขนส่งทำพัสดุหาย",
  // B2B Pipeline Statuses
  "Pre-Quote Sent": "ส่งใบเสนอราคาเบื้องต้น (B2B)",
  "Pre-Quote Accepted": "ลูกค้ายอมรับราคาเบื้องต้น (B2B)",
  "Site Visit & Grading": "ส่งทีมประเมินหน้างาน (B2B)",
  "Final Quote Sent": "ส่งใบเสนอราคาจริง (B2B)",
  "Final Quote Accepted": "ลูกค้ายอมรับราคาจริง (B2B)",
  "PO Issued": "ออก PO เรียบร้อย (B2B)",
  "Waiting for Invoice/Tax Inv.": "รอใบกำกับภาษี (B2B)",
  "Pending Finance Approval": "รอบัญชีตรวจสอบ (B2B)",
  "Payment Completed": "ชำระเงินเสร็จ (B2B)",
  // INTENTIONALLY OMITTED — inventory-churn statuses fire after the owning
  // agent's responsibility ends (device already inside the shop, sales team
  // owns it now). Adding them would dilute the meaningful signal:
  //   - "Sent To QC Lab"   (internal QC routing step)
  //   - "In Stock"          (inventory state — no agent action)
  //   - "Ready To Sell"     (sales-team handoff)
  //   - "Sold"              (sales event — not the trade-in flow's owner)
};

// =============================================================================
// Context-aware label builder
//
// Some transitions share a status string but mean different things depending
// on who caused them — Cancelled by rider vs customer vs system, or Following
// Up that's an ordinary CRM state vs the parking lot for a mid-route
// rider-cancel. The static NOTIFY_STATUS_MAP can't express that, so cases
// that need the extra dimension are resolved here and the map is the fallback
// for everything else.
//
// Returns the Thai label to push, or null to suppress the notification.
// =============================================================================
function buildAdminStatusLabel(after, job) {
  const cancelledBy = job.cancelled_by || "";
  const isRiderCancel = cancelledBy.startsWith("rider:");
  const isCustomerCancel = cancelledBy === "customer" || cancelledBy.startsWith("customer:");
  const isAdminCancel = cancelledBy === "admin" || cancelledBy.startsWith("admin:");
  const isSystemCancel = cancelledBy === "system";

  // Reopen — admin pulled a soft-cancelled job back onto the same ticket. The
  // reopen writes a target status (Following Up / Rider En Route) that would
  // otherwise push a misleading label, so intercept it here. reopened_at is
  // freshly stamped by the reopen and cleared cancelled_at, so a short recency
  // guard keeps this from hijacking later transitions on the same job.
  if (
    job.reopened_at &&
    Date.now() - job.reopened_at < 2 * 60 * 1000 &&
    (after === "Following Up" || after === "Rider En Route")
  ) {
    return "🔄 เปิดงานกลับมาขายใหม่";
  }

  // Cancelled — vary the label by source so admin instantly knows blame.
  if (after === "Cancelled") {
    if (isRiderCancel) return "❌ ไรเดอร์ยกเลิกงาน";
    if (isCustomerCancel) return "❌ ลูกค้ายกเลิกงาน";
    if (isAdminCancel) return "❌ Admin ยกเลิกงาน";
    if (isSystemCancel) return "⏱ ระบบยกเลิกอัตโนมัติ (timeout)";
    return "❌ ยกเลิกงาน";
  }
  if (after === "Closed (Lost)") return "ปิดงาน (Lost)";

  // Following Up is the parking lot for mid-route rider cancels (PR #52).
  // Without the cancelled_by guard, every ordinary follow-up would push.
  if (after === "Following Up") {
    if (isRiderCancel) return "🚫 ไรเดอร์คืนงาน — ต้องจ่ายงานใหม่";
    return null;
  }

  return NOTIFY_STATUS_MAP[after] || null;
}

// Status family the overdue scheduler keys off — needs paid_at to be
// authoritative regardless of which client wrote the status.
const PAID_STATUSES = ["Paid", "PAID", "Payment Completed"];

// IMPORTANT: keep the export name globally unique across the bkk-system and
// rider-notifications codebases. Firebase Cloud Functions identifies functions
// by {region}/{name} project-wide — codebase is only a Firebase CLI deploy
// concept, NOT a name-namespacing mechanism. Both repos previously exported
// `onJobStatusChanged` against the same trigger path/region, so every admin
// deploy silently overwrote rider-notifications' function with admin code (and
// vice versa). Whoever deployed last won; the other side's pushes died until
// their next deploy flipped the coin back. This was the recurring "ได้บ้างแต่
// หายไปอีก" that the previous patches in this codebase kept failing to fix.
exports.onAdminJobStatusNotify = onValueUpdated(
  {
    ref: "/jobs/{jobId}/status",
    region: "asia-southeast1",
  },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (before === after) return;

    const jobId = event.params.jobId;
    const db = getDatabase();

    // Auto-stamp paid_at on transition into the Paid family. The mobile
    // "จ่ายเงินแล้ว" button only writes status, so the overdue scheduler
    // wouldn't have an anchor without this. Finance payouts already stamp
    // explicitly — guard against overwriting their timestamp.
    if (PAID_STATUSES.includes(after) && !PAID_STATUSES.includes(before)) {
      const paidAtRef = db.ref(`jobs/${jobId}/paid_at`);
      const existing = await paidAtRef.once("value");
      if (!existing.exists()) {
        await paidAtRef.set(Date.now());
        console.log(`[onJobStatusChanged] ${jobId} paid_at stamped`);
      }
    }

    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) return;
    const job = jobSnap.val();

    // 'In-Transit' is overloaded by receive_method: Pickup → rider returning
    // (admin wants to know), Mail-in → parcel in transit (Thailand Post
    // tracking trigger handles parcel updates separately).
    if (after === "In-Transit" && job.receive_method !== "Pickup") return;

    const statusLabel = buildAdminStatusLabel(after, job);
    if (!statusLabel) return;

    const model = job.model || "ไม่ระบุรุ่น";
    const custName = job.cust_name || "";
    const reason = job.cancel_reason ? ` - ${job.cancel_reason}` : "";

    const title = `🔔 ${statusLabel}`;
    const body = `${model}${custName ? ` - ${custName}` : ""}${reason}`.trim();

    // Data-only — SW builds the notification (see onNewTicketCreated for
    // why a top-level `notification` field is not used).
    await dispatchAdminPush(
      {
        data: {
          jobId,
          type: "status_change",
          title,
          body,
          oldStatus: String(before || ""),
          newStatus: after,
          model,
        },
        android: {
          priority: "high",
          notification: {
            channelId: "status_changes",
            priority: "high",
            defaultSound: true,
            tag: `status-${jobId}`,
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
          payload: {
            aps: {
              "mutable-content": 1,
              sound: "default",
            },
          },
        },
        webpush: {
          headers: { Urgency: "high", TTL: "86400" },
        },
      },
      `onJobStatusChanged(${before}→${after})`
    );
  }
);

// =============================================================================
// Thailand Post Tracking — Database Trigger (ไม่ต้องใช้ HTTPS = ไม่ต้อง IAM)
// =============================================================================

/**
 * ฟังก์ชันกลางสำหรับดึงข้อมูล tracking จาก Thailand Post API
 */
async function fetchThaiPostTracking(barcode) {
  const apiKey = process.env.THAILAND_POST_API_KEY;
  if (!apiKey) {
    console.error("THAILAND_POST_API_KEY not configured");
    return null;
  }

  try {
    // Step 1: Get token
    const tokenRes = await fetch(
      "https://trackapi.thailandpost.co.th/post/security/getToken?grant_type=client_credentials",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!tokenRes.ok) {
      console.error("Token error:", tokenRes.status, await tokenRes.text());
      return null;
    }
    const { token } = await tokenRes.json();

    // Step 2: Track by barcode
    const trackRes = await fetch(
      "https://trackapi.thailandpost.co.th/post/api/v1/track",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "all",
          language: "TH",
          barcode: [barcode],
        }),
      }
    );
    if (!trackRes.ok) {
      console.error("Track error:", trackRes.status, await trackRes.text());
      return null;
    }
    const trackData = await trackRes.json();

    const items =
      trackData?.response?.items?.[barcode] ||
      trackData?.response?.items?.[barcode.toUpperCase()] ||
      [];

    return {
      barcode,
      status: items.length > 0 ? "found" : "not_found",
      fetched_at: Date.now(),
      items: items.map((item) => ({
        status: item.status_description || item.status,
        status_code: item.status,
        date: item.status_date,
        location: item.location || "",
        postcode: item.postcode || "",
        delivery_status: item.delivery_status || null,
        receiver_name: item.receiver_name || null,
      })),
    };
  } catch (err) {
    console.error("fetchThaiPostTracking error:", err);
    return null;
  }
}

/**
 * onTrackingNumberUpdated — เมื่อบันทึก tracking_number ใหม่ ดึงข้อมูลจาก Thailand Post
 * แล้วเก็บผลลัพธ์ไว้ที่ jobs/{jobId}/tracking_data
 */
exports.onTrackingNumberUpdated = onValueWritten(
  {
    ref: "/jobs/{jobId}/tracking_number",
    region: "asia-southeast1",
  },
  async (event) => {
    const after = event.data.after.val();
    if (!after) return; // tracking ถูกลบ

    const jobId = event.params.jobId;
    console.log(`Tracking number updated for job ${jobId}: ${after}`);

    const trackingData = await fetchThaiPostTracking(after);
    if (!trackingData) return;

    const db = getDatabase();
    await db.ref(`jobs/${jobId}/tracking_data`).set(trackingData);
    console.log(
      `Saved tracking data for job ${jobId}: ${trackingData.items.length} items`
    );
  }
);

// =============================================================================
// Rider Fee: คำนวณค่าวิ่งจริงเมื่อไรเดอร์ส่งมอบเครื่อง (status = Pending QC)
// =============================================================================

/**
 * เมื่อ job.status เปลี่ยนเป็น "Pending QC" แปลว่าไรเดอร์ส่งมอบเครื่องเข้าสาขาเรียบร้อย
 * ดึงพิกัดลูกค้า + สาขา + rate card จาก settings/logistics_rates แล้วเขียน jobs/{id}/rider_fee
 * เพื่อให้ Finance approve จ่ายเงินไรเดอร์ตามค่าวิ่งจริง ไม่ใช่ pickup_fee ที่เก็บจากลูกค้า
 */
exports.onJobHandedOverCalcRiderFee = onValueUpdated(
  {
    ref: "/jobs/{jobId}/status",
    region: "asia-southeast1",
  },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();

    if (before === after) return;
    // Primary trigger: rider hands over at the branch (status → Pending QC).
    // Safety-net triggers: if a Pickup job skips the handover step (e.g. admin
    // jumps it straight to QC Lab / In Stock), still compute the fee below so
    // the rider is never left unpaid by a status skip.
    const FEE_TRIGGER_STATUSES = ["Pending QC", "Sent to QC Lab", "In Stock"];
    if (!FEE_TRIGGER_STATUSES.includes(after)) return;

    const jobId = event.params.jobId;
    const db = getDatabase();

    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) {
      console.warn(`[riderFee] Job ${jobId} not found`);
      return;
    }
    const job = jobSnap.val();

    // Safety-net path (entered via a non-"Pending QC" trigger): only fire for a
    // Pickup job that skipped handover and still has an unpaid, rider-assigned
    // fee. Everything else (Store-in/Mail-in, no rider, already paid) is a no-op.
    if (after !== "Pending QC") {
      if (job.receive_method !== "Pickup") return;
      if (!job.rider_id) return;
      if (typeof job.rider_fee === "number" && job.rider_fee > 0) return;
      console.warn(`[riderFee] Job ${jobId} reached "${after}" without a handover — computing fee as safety net`);
    }

    // ถ้า rider_fee ถูก set แล้ว (เช่น admin ตั้งเอง) ไม่ override
    if (typeof job.rider_fee === "number" && job.rider_fee > 0) {
      console.log(
        `[riderFee] Job ${jobId} already has rider_fee=${job.rider_fee}, skip`
      );
      return;
    }

    try {
      const result = await computeRiderFee(db, job);
      const updates = {
        rider_fee: result.fee,
        rider_fee_meta: {
          distance_km: result.distance_km,
          rates: result.rates,
          reason: result.reason,
          computed_at: Date.now(),
        },
      };
      // ถ้ายังไม่มี rider_fee_status มาก่อน ตั้งเป็น Pending เพื่อเข้าคิว settlement
      if (!job.rider_fee_status) {
        updates.rider_fee_status = "Pending";
      }
      await db.ref(`jobs/${jobId}`).update(updates);
      console.log(
        `[riderFee] Job ${jobId}: ฿${result.fee} (${result.reason}, ${result.distance_km ?? "n/a"} km)`
      );
    } catch (err) {
      console.error(`[riderFee] Failed to compute for ${jobId}:`, err);
    }
  }
);

// =============================================================================
// Job Amendment workflow (PR-AMEND)
// ---------------------------------------------------------------------
// On-site change-request flow when rider arrives and finds the job's data
// doesn't match reality. Rider role is purely operational — they report the
// problem + photos. Admin owns every decision (model identification, pricing,
// approve/reject, customer-facing communication). All mutations to /jobs are
// authored server-side here so we have a single audit trail and atomic apply.
//
// Endpoints:
//   - requestAmendment   (callable, rider) — open a request
//   - reviewAmendment    (callable, admin) — approve/reject
//   - consentAmendment   (callable, rider) — customer signed → atomic apply
//   - escalateAmendmentTimeouts (scheduled) — broadcast to all admins after 15 min
// =============================================================================

const AMENDMENT_REGION = "asia-southeast1";

/** Targeted push to the specific admin owning the job; falls back to the
 *  existing dispatchAdminPush broadcast if (a) job has no agent_uid yet, or
 *  (b) the targeted admin has no live FCM tokens. Keeps cleanup-on-failure
 *  semantics consistent with broadcast path. */
async function dispatchAmendmentPush(db, message, ownerAdminUid, tag) {
  if (ownerAdminUid) {
    const tokensSnap = await db.ref(`admin_fcm_tokens/${ownerAdminUid}`).once("value");
    if (tokensSnap.exists()) {
      const tokens = [];
      const tokenMeta = [];
      tokensSnap.forEach((tokenSnap) => {
        const data = tokenSnap.val();
        if (data && data.token) {
          tokens.push(data.token);
          tokenMeta.push({ staffId: ownerAdminUid, tokenKey: tokenSnap.key });
        }
      });
      if (tokens.length > 0) {
        const messaging = getMessaging();
        const result = await messaging.sendEachForMulticast({ ...message, tokens });
        result.responses.forEach((resp, idx) => {
          if (
            resp.error &&
            (resp.error.code === "messaging/registration-token-not-registered" ||
              resp.error.code === "messaging/invalid-registration-token")
          ) {
            const meta = tokenMeta[idx];
            db.ref(`admin_fcm_tokens/${meta.staffId}/${meta.tokenKey}`).remove();
          }
        });
        console.log(`[${tag}] Targeted ${ownerAdminUid}: ${result.successCount}/${tokens.length} delivered`);
        return;
      }
    }
    console.log(`[${tag}] No live tokens for owner ${ownerAdminUid}; broadcasting`);
  }
  await dispatchAdminPush(message, tag);
}

/** Send a push to all of the rider's FCM tokens.
 *  Reads multi-device tokens from `/riders/{uid}/fcm_tokens/{deviceId}` (current
 *  format) and falls back to legacy `/riders/{uid}/fcm_token` (single-string) for
 *  rider clients that haven't migrated yet. Dead tokens are cleaned up the same
 *  way `dispatchAdminPush` does — when FCM returns
 *  `messaging/registration-token-not-registered` or `invalid-registration-token`,
 *  the offending token entry is removed from RTDB so it doesn't waste sends. */
async function pushToRider(db, riderUid, message, tag) {
  try {
    const tokens = [];
    const tokenMeta = [];

    const multiSnap = await db.ref(`riders/${riderUid}/fcm_tokens`).once("value");
    if (multiSnap.exists()) {
      multiSnap.forEach((deviceSnap) => {
        const data = deviceSnap.val();
        if (data && data.token) {
          tokens.push(data.token);
          tokenMeta.push({ kind: "multi", deviceId: deviceSnap.key });
        }
      });
    }

    const legacySnap = await db.ref(`riders/${riderUid}/fcm_token`).once("value");
    const legacyToken = legacySnap.val();
    if (typeof legacyToken === "string" && legacyToken && !tokens.includes(legacyToken)) {
      tokens.push(legacyToken);
      tokenMeta.push({ kind: "legacy" });
    }

    if (tokens.length === 0) {
      console.warn(`[${tag}] Rider ${riderUid} has no FCM tokens (multi or legacy)`);
      return;
    }

    const result = await getMessaging().sendEachForMulticast({ ...message, tokens });

    result.responses.forEach((resp, idx) => {
      if (resp.error) {
        const meta = tokenMeta[idx];
        const expired =
          resp.error.code === "messaging/registration-token-not-registered" ||
          resp.error.code === "messaging/invalid-registration-token";
        if (expired && meta) {
          if (meta.kind === "multi") {
            db.ref(`riders/${riderUid}/fcm_tokens/${meta.deviceId}`).remove();
            console.log(`[${tag}] Cleaned up expired rider token: ${riderUid}/${meta.deviceId}`);
          } else {
            db.ref(`riders/${riderUid}/fcm_token`).remove();
            console.log(`[${tag}] Cleaned up expired legacy rider token: ${riderUid}`);
          }
        } else {
          console.warn(`[${tag}] Push to rider ${riderUid} (idx ${idx}) failed:`, resp.error.code);
        }
      }
    });

    console.log(
      `[${tag}] Rider ${riderUid}: ${result.successCount} success, ${result.failureCount} failed, ${tokens.length} total`
    );
  } catch (err) {
    console.error(`[${tag}] Push to rider ${riderUid} failed:`, err);
  }
}

function shortJobId(id) {
  return (id || "").slice(-4).toUpperCase() || "????";
}

// ----------------------------------------------------------------------------
// Type/class lookup tables — single source of truth, mirrored client-side
// ----------------------------------------------------------------------------

const AMENDMENT_TYPE_CLASS = {
  device_mismatch: "contractual",
  add_device: "contractual",
  remove_device: "contractual",
  appointment_reschedule: "operational",
  address_wrong: "operational",
  customer_info_wrong: "operational",
  customer_request_cancel: "operational",
  other: "operational",
};
const VALID_AMENDMENT_TYPES = Object.keys(AMENDMENT_TYPE_CLASS);
const VALID_REJECT_ACTIONS = ["continue_original", "cancel_job", "wait_admin_call"];
const VALID_CUSTOMER_INFO_FIELDS = ["cust_name", "cust_phone", "cust_email"];
const VALID_CANCEL_CATEGORIES = [
  "customer_changed_mind", "customer_no_show", "rider_issue",
  "device_mismatch", "hidden_damage", "price_disagreement",
  "fraud_suspected", "parcel_lost", "sla_timeout", "other",
];

/** TTL for contractual approval — expires if customer doesn't sign in 24h */
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const AMENDMENT_TYPE_LABEL_TH = {
  device_mismatch: "เครื่องไม่ตรง",
  add_device: "เพิ่มเครื่อง",
  remove_device: "ลด/ยกเลิกเครื่อง",
  appointment_reschedule: "เลื่อนนัดหมาย",
  address_wrong: "ที่อยู่ไม่ตรง",
  customer_info_wrong: "ข้อมูลลูกค้าผิด",
  customer_request_cancel: "ลูกค้าขอยกเลิก",
  other: "ปัญหาอื่นๆ",
};

function buildBeforeSnapshot(job) {
  return {
    devices: job.devices || [],
    final_price:
      typeof job.final_price === "number" ? job.final_price :
      typeof job.price === "number" ? job.price : 0,
    pricing: {
      devices_subtotal: typeof job.price === "number" ? job.price : 0,
      pickup_fee: typeof job.pickup_fee === "number" ? job.pickup_fee : 0,
      coupon_discount: typeof job.coupon_discount === "number" ? job.coupon_discount : 0,
      final_price:
        typeof job.final_price === "number" ? job.final_price :
        typeof job.price === "number" ? job.price : 0,
      currency: "THB",
    },
  };
}

/** Validate the rider's per-type submission shape. Throws HttpsError on
 *  bad input. Returns sanitized fields for write. */
function validateRiderRequest(type, body) {
  const out = { evidence: [], evidenceUrls: [], target: null, target_device_index: null };
  const evidence = Array.isArray(body.evidence) ? body.evidence : [];
  const legacyUrls = Array.isArray(body.evidenceUrls) ? body.evidenceUrls : [];

  // Normalize evidence — accept either v2 array or v1 url[]
  if (evidence.length) {
    for (const e of evidence) {
      if (!e || typeof e.url !== "string" || !/^https?:\/\//.test(e.url)) {
        throw new HttpsError("invalid-argument", "evidence URL ไม่ถูกต้อง");
      }
      out.evidence.push({
        url: e.url,
        purpose: typeof e.purpose === "string" ? e.purpose : "other",
        uploaded_at: typeof e.uploaded_at === "number" ? e.uploaded_at : Date.now(),
      });
      out.evidenceUrls.push(e.url);
    }
  } else if (legacyUrls.length) {
    for (const url of legacyUrls) {
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        throw new HttpsError("invalid-argument", "evidenceUrls ต้องเป็น https URL");
      }
      out.evidence.push({ url, purpose: "other", uploaded_at: Date.now() });
      out.evidenceUrls.push(url);
    }
  }

  // Photo requirement varies by type. Contractual types need a photo of
  // the device for admin to identify the model.
  if (["device_mismatch", "add_device"].includes(type) && out.evidence.length < 1) {
    throw new HttpsError("invalid-argument", "ต้องมีรูปประกอบอย่างน้อย 1 รูป");
  }

  // target_device_index — used by remove_device + device_mismatch on
  // multi-device jobs (admin can set later for replace; rider sets for remove).
  if (typeof body.target_device_index === "number" && body.target_device_index >= 0) {
    out.target_device_index = body.target_device_index;
  }

  // target — typed payload depending on type
  if (body.target && typeof body.target === "object") {
    const t = body.target;
    if (type === "appointment_reschedule" && t.kind === "appointment" && typeof t.new_appointment_time === "number") {
      out.target = { kind: "appointment", new_appointment_time: t.new_appointment_time };
    } else if (type === "address_wrong" && t.kind === "address" && typeof t.new_address === "string") {
      out.target = { kind: "address", new_address: t.new_address.slice(0, 500) };
      if (typeof t.new_lat === "number") out.target.new_lat = t.new_lat;
      if (typeof t.new_lng === "number") out.target.new_lng = t.new_lng;
    } else if (type === "customer_info_wrong" && t.kind === "customer_info"
              && VALID_CUSTOMER_INFO_FIELDS.includes(t.field)
              && typeof t.new_value === "string") {
      out.target = { kind: "customer_info", field: t.field, new_value: t.new_value.slice(0, 500) };
    } else if (type === "customer_request_cancel" && t.kind === "cancel"
              && VALID_CANCEL_CATEGORIES.includes(t.reason_category)) {
      out.target = { kind: "cancel", reason_category: t.reason_category };
      if (typeof t.reason_detail === "string") out.target.reason_detail = t.reason_detail.slice(0, 500);
    } else if ((type === "device_mismatch" || type === "add_device")
              && t.kind === "device_pick"
              && typeof t.model_id === "string" && t.model_id.length > 0
              && typeof t.model_name === "string" && t.model_name.length > 0) {
      // Rider's pick of the actual device model+variant from /models
      // catalog. Admin can override during review; this just seeds the
      // approval form so admin doesn't have to re-identify from the photo.
      out.target = {
        kind: "device_pick",
        model_id: t.model_id.slice(0, 64),
        model_name: t.model_name.slice(0, 200),
      };
      if (typeof t.variant_id === "string") out.target.variant_id = t.variant_id.slice(0, 64);
      if (typeof t.variant_name === "string") out.target.variant_name = t.variant_name.slice(0, 100);
      if (typeof t.brand === "string") out.target.brand = t.brand.slice(0, 50);
      if (typeof t.suggested_price === "number" && t.suggested_price >= 0 && t.suggested_price <= 1000000) {
        out.target.suggested_price = t.suggested_price;
      }
    }
  }

  return out;
}

exports.requestAmendment = onCall({ region: AMENDMENT_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const body = request.data || {};
  const { jobId, type, riderNote, clientRequestId } = body;
  if (!jobId || typeof jobId !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ jobId");
  }
  if (!VALID_AMENDMENT_TYPES.includes(type)) {
    throw new HttpsError("invalid-argument", `type ไม่รองรับ: ${type}`);
  }
  if (riderNote && (typeof riderNote !== "string" || riderNote.length > 1000)) {
    throw new HttpsError("invalid-argument", "riderNote ยาวเกิน 1,000 ตัวอักษร");
  }
  // 'other' requires a note since there's no other structured signal
  if (type === "other" && (!riderNote || riderNote.trim().length < 5)) {
    throw new HttpsError("invalid-argument", "ประเภท 'อื่นๆ' ต้องระบุรายละเอียดอย่างน้อย 5 ตัวอักษร");
  }

  const sanitized = validateRiderRequest(type, body);
  const amendmentClass = AMENDMENT_TYPE_CLASS[type];
  const db = getDatabase();

  // Idempotency — if same client_request_id submitted within last 1h, return existing
  if (clientRequestId && typeof clientRequestId === "string") {
    const dup = await db.ref("jobs_amendments")
      .orderByChild("client_request_id").equalTo(clientRequestId).once("value");
    let existingId = null;
    dup.forEach((s) => {
      const am = s.val();
      if (am && am.requested_at && (Date.now() - am.requested_at) < 60 * 60 * 1000) {
        existingId = am.id;
      }
    });
    if (existingId) {
      console.log(`[amendment] Idempotent retry for client_request_id=${clientRequestId}; returning existing ${existingId}`);
      return { ok: true, amendmentId: existingId, deduplicated: true };
    }
  }

  const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบงาน");
  const job = jobSnap.val();
  if (job.rider_id !== request.auth.uid) {
    throw new HttpsError("permission-denied", "ไม่ใช่ rider ของ job นี้");
  }

  // Single in-flight guard — only one open amendment per job
  const existing = await db.ref("jobs_amendments")
    .orderByChild("job_id").equalTo(jobId).once("value");
  let hasOpen = false;
  existing.forEach((s) => {
    const st = s.val().status;
    if (st === "pending" || st === "approved" || st === "consented") hasOpen = true;
  });
  if (hasOpen) {
    throw new HttpsError("failed-precondition", "มี amendment ค้างอยู่บน job นี้แล้ว — รอเคลียร์ก่อน");
  }

  // Build before-snapshot (contractual only — operational doesn't need it)
  const before = amendmentClass === "contractual" ? buildBeforeSnapshot(job) : null;

  const newRef = db.ref("jobs_amendments").push();
  const amendmentId = newRef.key;

  const riderSnap = await db.ref(`riders/${request.auth.uid}`).once("value");
  const riderName = (riderSnap.val() && riderSnap.val().name) || job.rider_name || "Rider";

  const amendment = {
    id: amendmentId,
    job_id: jobId,
    schema_version: 2,
    amendment_class: amendmentClass,
    type,
    requested_at: Date.now(),
    requested_by_rider_uid: request.auth.uid,
    requested_by_rider_name: riderName,
    rider_note: riderNote || "",
    evidence: sanitized.evidence,
    evidence_urls: sanitized.evidenceUrls,
    status: "pending",
  };
  if (clientRequestId) amendment.client_request_id = clientRequestId;
  if (before) amendment.before = before;
  if (sanitized.target) amendment.target = sanitized.target;
  if (sanitized.target_device_index !== null) amendment.target_device_index = sanitized.target_device_index;

  await newRef.set(amendment);

  await dispatchAmendmentPush(
    db,
    {
      notification: {
        title: `🚨 Rider แจ้งปัญหา — ${AMENDMENT_TYPE_LABEL_TH[type]}`,
        body: `${riderName} ขอ admin จัดการ job #${shortJobId(jobId)}${riderNote ? `: ${riderNote.slice(0, 80)}` : ""}`,
      },
      data: { type: "amendment_requested", amendmentId, jobId, amendmentType: type },
    },
    job.agent_uid,
    "amendment-requested"
  );

  return { ok: true, amendmentId };
});

/** Status set in which the rider has committed time/fuel and deserves
 *  a time-loss fee if the customer cancels. (RIDER_ACCEPTED alone
 *  doesn't count — rider hasn't departed yet.) */
const RIDER_DEPARTED_STATUSES = new Set([
  "Heading to Customer",
  "Rider En Route",
  "Arrived",
  "Rider Arrived",
]);

// Hard-coded default removed in favour of forcing admin to configure
// settings/rider_compensation/customer_cancel_time_loss via the
// Global Settings page in bkk-system. The previous fallback (100฿) was
// silently used when the settings node was absent which made the
// production payout amount invisible from code review.

/** Build the multi-path updates needed to atomically apply an amendment.
 *  Returns object suitable for db.ref().update(). Caller should also
 *  append a qc_logs entry. Different types touch different /jobs fields.
 *
 *  job is the current /jobs/{id} value — used by customer_request_cancel
 *  to decide whether the rider has already departed (and thus is owed
 *  ค่าเสียเวลา for the cancelled trip). riderCompensation is the
 *  resolved settings/rider_compensation block, or null. */
function buildAmendmentApplyUpdates(am, job, now, riderCompensation) {
  const u = {};
  const jobBase = `jobs/${am.job_id}`;

  switch (am.type) {
    // Contractual — require am.after with devices + final_price
    case "device_mismatch":
    case "add_device":
    case "remove_device": {
      if (!am.after || !Array.isArray(am.after.devices)) {
        throw new HttpsError("internal", "amendment.after ขาด");
      }
      u[`${jobBase}/devices`] = am.after.devices;
      u[`${jobBase}/final_price`] = am.after.final_price;
      if (am.after.devices[0]) {
        const d = am.after.devices[0];
        u[`${jobBase}/model`] = d.model || (d.model_name + (d.variant_name ? ` ${d.variant_name}` : "")).trim();
      }
      if (am.after.pricing) u[`${jobBase}/pricing`] = am.after.pricing;
      break;
    }
    // Operational — read target.kind for the change
    case "appointment_reschedule": {
      if (!am.target || am.target.kind !== "appointment" || typeof am.target.new_appointment_time !== "number") {
        throw new HttpsError("internal", "target.appointment ขาด");
      }
      u[`${jobBase}/appointment_time`] = am.target.new_appointment_time;
      break;
    }
    case "address_wrong": {
      if (!am.target || am.target.kind !== "address" || typeof am.target.new_address !== "string") {
        throw new HttpsError("internal", "target.address ขาด");
      }
      u[`${jobBase}/cust_address`] = am.target.new_address;
      if (typeof am.target.new_lat === "number") u[`${jobBase}/cust_lat`] = am.target.new_lat;
      if (typeof am.target.new_lng === "number") u[`${jobBase}/cust_lng`] = am.target.new_lng;
      break;
    }
    case "customer_info_wrong": {
      if (!am.target || am.target.kind !== "customer_info"
          || !VALID_CUSTOMER_INFO_FIELDS.includes(am.target.field)
          || typeof am.target.new_value !== "string") {
        throw new HttpsError("internal", "target.customer_info ขาด");
      }
      u[`${jobBase}/${am.target.field}`] = am.target.new_value;
      break;
    }
    case "customer_request_cancel": {
      if (!am.target || am.target.kind !== "cancel"
          || !VALID_CANCEL_CATEGORIES.includes(am.target.reason_category)) {
        throw new HttpsError("internal", "target.cancel ขาด");
      }
      u[`${jobBase}/status`] = "Cancelled";
      u[`${jobBase}/cancel_category`] = am.target.reason_category;
      u[`${jobBase}/cancel_reason`] = am.target.reason_detail || am.rider_note || "ลูกค้าขอยกเลิก";
      u[`${jobBase}/cancelled_at`] = now;

      // Rider time-loss fee: customer cancelled mid-route. Different
      // from rider self-cancel (handled by RejectModal flow) which
      // pays nothing and may deduct rider points. Only kicks in once
      // the rider has actually departed — RIDER_ACCEPTED alone doesn't
      // qualify since they haven't burned fuel yet.
      if (job && RIDER_DEPARTED_STATUSES.has(job.status)) {
        const fee = riderCompensation && typeof riderCompensation.customer_cancel_time_loss === "number"
          ? riderCompensation.customer_cancel_time_loss
          : null;
        if (fee === null || !Number.isFinite(fee) || fee < 0) {
          // No silent fallback — refuse to apply the amendment until
          // admin sets the value via Global Settings. Avoids the
          // previous failure mode where the function quietly paid out
          // a hard-coded 100฿ that no longer reflected business policy.
          throw new HttpsError(
            "failed-precondition",
            "settings/rider_compensation/customer_cancel_time_loss ยังไม่ตั้งค่า — ตั้งค่าใน Global Settings ก่อน",
          );
        }
        u[`${jobBase}/rider_fee`] = fee;
        u[`${jobBase}/rider_fee_status`] = "Pending";
        u[`${jobBase}/rider_fee_breakdown`] = {
          type: "time_loss_customer_cancel",
          amount: fee,
          reason: `ลูกค้ายกเลิกระหว่างทาง (status: ${job.status}) — ค่าเสียเวลาไรเดอร์`,
          computed_at: now,
          source: "settings",
        };
      }
      break;
    }
    case "other": {
      // No structured apply — admin uses chat with customer to coordinate.
      // Just mark job updated_at so dashboards refresh.
      break;
    }
  }
  u[`${jobBase}/updated_at`] = now;
  return u;
}

exports.reviewAmendment = onCall({ region: AMENDMENT_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const { amendmentId, decision, after, target, adminNote, rejectAction } = request.data || {};
  if (!amendmentId || (decision !== "approve" && decision !== "reject")) {
    throw new HttpsError("invalid-argument", "amendmentId / decision ไม่ถูกต้อง");
  }
  if (adminNote && (typeof adminNote !== "string" || adminNote.length > 1000)) {
    throw new HttpsError("invalid-argument", "adminNote ยาวเกิน 1,000 ตัวอักษร");
  }

  const db = getDatabase();
  const adminSnap = await db.ref(`admins/${request.auth.uid}`).once("value");
  if (!adminSnap.exists() || adminSnap.val().role !== "admin") {
    throw new HttpsError("permission-denied", "เฉพาะ admin");
  }

  const amSnap = await db.ref(`jobs_amendments/${amendmentId}`).once("value");
  if (!amSnap.exists()) throw new HttpsError("not-found", "ไม่พบ amendment");
  const am = amSnap.val();
  if (am.status !== "pending") {
    throw new HttpsError("failed-precondition", `amendment status=${am.status}`);
  }

  const adminName = adminSnap.val().name || adminSnap.val().display_name || "Admin";
  const now = Date.now();
  const amendmentClass = am.amendment_class || AMENDMENT_TYPE_CLASS[am.type] || "contractual";

  if (decision === "reject") {
    if (!VALID_REJECT_ACTIONS.includes(rejectAction)) {
      throw new HttpsError("invalid-argument", `rejectAction ต้องเป็น ${VALID_REJECT_ACTIONS.join("/")}`);
    }
    const updates = {
      [`jobs_amendments/${amendmentId}/reviewed_at`]: now,
      [`jobs_amendments/${amendmentId}/reviewed_by_admin_uid`]: request.auth.uid,
      [`jobs_amendments/${amendmentId}/reviewed_by_admin_name`]: adminName,
      [`jobs_amendments/${amendmentId}/admin_note`]: adminNote || "",
      [`jobs_amendments/${amendmentId}/status`]: "rejected",
      [`jobs_amendments/${amendmentId}/reject_action`]: rejectAction,
    };
    if (rejectAction === "cancel_job") {
      updates[`jobs/${am.job_id}/status`] = "Cancelled";
      updates[`jobs/${am.job_id}/cancel_category`] = "amendment_rejected";
      updates[`jobs/${am.job_id}/cancel_reason`] = adminNote || "Admin ปฏิเสธ amendment + ขอยกเลิก job";
      updates[`jobs/${am.job_id}/cancelled_at`] = now;
      updates[`jobs/${am.job_id}/updated_at`] = now;
    }
    await db.ref().update(updates);

    const riderTitle = rejectAction === "cancel_job"
      ? "❌ Admin ยกเลิก job"
      : rejectAction === "wait_admin_call"
        ? "⏸ Admin จะติดต่อลูกค้าเอง"
        : "❌ Admin ปฏิเสธ — ทำงานต่อตาม original";
    await pushToRider(
      db,
      am.requested_by_rider_uid,
      {
        notification: {
          title: riderTitle,
          body: adminNote || (rejectAction === "wait_admin_call"
            ? `รอที่จุดรับ — job #${shortJobId(am.job_id)}`
            : `Job #${shortJobId(am.job_id)}`),
        },
        data: { type: "amendment_rejected", amendmentId, jobId: am.job_id, rejectAction },
      },
      "amendment-rejected"
    );
    return { ok: true };
  }

  // Approve path — branches by class
  const baseUpdates = {
    [`jobs_amendments/${amendmentId}/reviewed_at`]: now,
    [`jobs_amendments/${amendmentId}/reviewed_by_admin_uid`]: request.auth.uid,
    [`jobs_amendments/${amendmentId}/reviewed_by_admin_name`]: adminName,
    [`jobs_amendments/${amendmentId}/admin_note`]: adminNote || "",
  };

  if (amendmentClass === "contractual") {
    // Admin must provide `after` snapshot (devices + final_price [+ pricing])
    if (!after || !Array.isArray(after.devices) || after.devices.length < 1
        || typeof after.final_price !== "number") {
      throw new HttpsError("invalid-argument", "after snapshot ต้องครบ (devices + final_price)");
    }
    const sanitizedAfter = {
      devices: after.devices,
      final_price: after.final_price,
    };
    if (after.pricing && typeof after.pricing === "object") {
      sanitizedAfter.pricing = {
        devices_subtotal: Number(after.pricing.devices_subtotal) || 0,
        pickup_fee: Number(after.pricing.pickup_fee) || 0,
        coupon_discount: Number(after.pricing.coupon_discount) || 0,
        final_price: Number(after.pricing.final_price) || after.final_price,
        currency: "THB",
      };
    }
    const updates = {
      ...baseUpdates,
      [`jobs_amendments/${amendmentId}/status`]: "approved",
      [`jobs_amendments/${amendmentId}/after`]: sanitizedAfter,
      [`jobs_amendments/${amendmentId}/approved_expires_at`]: now + APPROVAL_TTL_MS,
    };
    await db.ref().update(updates);

    // Include the new total + delta in the push body so rider sees the
    // pending amount on the lock-screen notification (without needing
    // to open the consent modal first). Job's main card still shows the
    // old final_price until atomic apply runs after consent.
    const beforeTotal = (am.before && typeof am.before.final_price === "number") ? am.before.final_price : 0;
    const afterTotal = sanitizedAfter.final_price;
    const delta = afterTotal - beforeTotal;
    const deltaSign = delta >= 0 ? "+" : "";
    await pushToRider(
      db,
      am.requested_by_rider_uid,
      {
        notification: {
          title: "✅ Admin อนุมัติ — ขอลายเซ็นลูกค้า",
          body: `Job #${shortJobId(am.job_id)} · ราคาใหม่ ฿${afterTotal.toLocaleString()} (${deltaSign}฿${delta.toLocaleString()})`,
        },
        data: {
          type: "amendment_approved",
          amendmentId,
          jobId: am.job_id,
          beforeFinalPrice: String(beforeTotal),
          afterFinalPrice: String(afterTotal),
        },
      },
      "amendment-approved"
    );
    return { ok: true };
  }

  // Operational approve = atomic apply NOW (no consent step)
  // Admin may have edited target during review; merge edits if provided.
  let finalTarget = am.target;
  if (target && typeof target === "object" && am.target && target.kind === am.target.kind) {
    finalTarget = { ...am.target, ...target };
    baseUpdates[`jobs_amendments/${amendmentId}/target`] = finalTarget;
  } else if (target && typeof target === "object" && !am.target) {
    // Rider didn't seed a target hint; admin authored it from scratch
    finalTarget = target;
    baseUpdates[`jobs_amendments/${amendmentId}/target`] = finalTarget;
  }
  const stagedAm = { ...am, target: finalTarget };

  // Fetch job + rider compensation settings (the latter only needed
  // for customer_request_cancel but cheap to always fetch — single
  // realtime DB read).
  const jobSnap = await db.ref(`jobs/${am.job_id}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบ job ที่จะ apply");
  const job = jobSnap.val();
  const compSnap = await db.ref("settings/rider_compensation").once("value");
  const riderCompensation = compSnap.exists() ? compSnap.val() : null;

  const applyUpdates = buildAmendmentApplyUpdates(stagedAm, job, now, riderCompensation);
  const updatedLogs = [
    {
      action: "Amendment Applied",
      by: `Admin: ${adminName}`,
      timestamp: now,
      details: `${AMENDMENT_TYPE_LABEL_TH[am.type]} — apply โดย admin (operational, no consent required)`,
    },
    ...(job.qc_logs || []),
  ];

  await db.ref().update({
    ...baseUpdates,
    [`jobs_amendments/${amendmentId}/status`]: "applied",
    [`jobs_amendments/${amendmentId}/applied_at`]: now,
    ...applyUpdates,
    [`jobs/${am.job_id}/qc_logs`]: updatedLogs,
  });

  await pushToRider(
    db,
    am.requested_by_rider_uid,
    {
      notification: {
        title: "✅ Admin จัดการเรียบร้อย",
        body: `${AMENDMENT_TYPE_LABEL_TH[am.type]} — อัพเดตข้อมูล job แล้ว ทำงานต่อได้`,
      },
      data: { type: "amendment_applied", amendmentId, jobId: am.job_id },
    },
    "amendment-applied-operational"
  );
  return { ok: true };
});

exports.consentAmendment = onCall({ region: AMENDMENT_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const { amendmentId, signatureUrl, disclosureText, disclosureVersion } = request.data || {};
  if (!amendmentId || !signatureUrl || typeof signatureUrl !== "string") {
    throw new HttpsError("invalid-argument", "amendmentId/signatureUrl ไม่ครบ");
  }
  if (!/^https?:\/\//.test(signatureUrl)) {
    throw new HttpsError("invalid-argument", "signatureUrl ต้องเป็น https URL");
  }

  const db = getDatabase();
  const amSnap = await db.ref(`jobs_amendments/${amendmentId}`).once("value");
  if (!amSnap.exists()) throw new HttpsError("not-found", "ไม่พบ amendment");
  const am = amSnap.val();
  if (am.status !== "approved") {
    throw new HttpsError("failed-precondition", `amendment status=${am.status}`);
  }
  // Operational types should never reach consent — admin already applied.
  const amendmentClass = am.amendment_class || AMENDMENT_TYPE_CLASS[am.type] || "contractual";
  if (amendmentClass !== "contractual") {
    throw new HttpsError("failed-precondition", "operational amendment ไม่ต้องการ consent");
  }
  if (am.requested_by_rider_uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "เฉพาะ rider ของ amendment");
  }
  if (am.approved_expires_at && Date.now() > am.approved_expires_at) {
    throw new HttpsError("failed-precondition", "amendment หมดอายุแล้ว — ขออนุมัติใหม่");
  }

  const now = Date.now();
  const jobSnap = await db.ref(`jobs/${am.job_id}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบ job ที่จะ apply");
  const job = jobSnap.val();
  // Contractual amendments don't currently use job/riderCompensation
  // (no time-loss case), but keep the call consistent for forward-compat.
  const compSnap = await db.ref("settings/rider_compensation").once("value");
  const riderCompensation = compSnap.exists() ? compSnap.val() : null;

  const applyUpdates = buildAmendmentApplyUpdates(am, job, now, riderCompensation);
  const updatedLogs = [
    {
      action: "Amendment Applied",
      by: `Rider: ${am.requested_by_rider_name}`,
      timestamp: now,
      details: `${AMENDMENT_TYPE_LABEL_TH[am.type]} — ลูกค้าเซ็นยืนยัน (admin: ${am.reviewed_by_admin_name || "?"})`,
    },
    ...(job.qc_logs || []),
  ];

  const consent = {
    method: "signature",
    consented_at: now,
    signature_url: signatureUrl,
    disclosure_text_snapshot: typeof disclosureText === "string" && disclosureText.length > 0
      ? disclosureText.slice(0, 2000)
      : "ลูกค้ายอมรับการเปลี่ยนแปลงของ job ตาม amendment ที่ admin อนุมัติ",
    disclosure_version: typeof disclosureVersion === "string" ? disclosureVersion.slice(0, 32) : "amendment-2026.09",
    captured_on: "rider_app",
    captured_by_uid: request.auth.uid,
  };

  await db.ref().update({
    [`jobs_amendments/${amendmentId}/status`]: "applied",
    [`jobs_amendments/${amendmentId}/applied_at`]: now,
    [`jobs_amendments/${amendmentId}/consent`]: consent,
    // V1-compat flat fields (older readers)
    [`jobs_amendments/${amendmentId}/consented_at`]: now,
    [`jobs_amendments/${amendmentId}/consent_method`]: "signature",
    [`jobs_amendments/${amendmentId}/consent_signature_url`]: signatureUrl,
    ...applyUpdates,
    [`jobs/${am.job_id}/qc_logs`]: updatedLogs,
  });

  await dispatchAmendmentPush(
    db,
    {
      notification: {
        title: "✅ Amendment สำเร็จ",
        body: `Job #${shortJobId(am.job_id)} ลูกค้าเซ็นแล้ว — rider ทำงานต่อ`,
      },
      data: { type: "amendment_applied", amendmentId, jobId: am.job_id },
    },
    job.agent_uid,
    "amendment-applied"
  );

  return { ok: true };
});

exports.expireApprovedAmendments = onSchedule(
  { schedule: "every 30 minutes", timeZone: "Asia/Bangkok", region: AMENDMENT_REGION },
  async () => {
    const db = getDatabase();
    const snap = await db
      .ref("jobs_amendments")
      .orderByChild("status")
      .equalTo("approved")
      .once("value");
    if (!snap.exists()) return;

    const ops = [];
    const now = Date.now();
    snap.forEach((s) => {
      const am = s.val();
      const ttl = am.approved_expires_at || (am.reviewed_at ? am.reviewed_at + APPROVAL_TTL_MS : 0);
      if (ttl && now > ttl) {
        ops.push(
          s.ref.update({ status: "expired", cancelled_at: now })
            .then(() =>
              pushToRider(db, am.requested_by_rider_uid,
                {
                  notification: {
                    title: "⏰ Amendment หมดอายุ",
                    body: `Job #${shortJobId(am.job_id)} ลูกค้าไม่ได้เซ็นยืนยันใน 24 ชม. — กรุณาขออนุมัติใหม่หากต้องการแก้ไข`,
                  },
                  data: { type: "amendment_expired", amendmentId: am.id, jobId: am.job_id },
                },
                "amendment-expired")
            )
        );
      }
    });
    if (ops.length === 0) return;
    console.log(`[amendment-expire] Expiring ${ops.length} approved-but-not-consented amendments`);
    await Promise.all(ops);
  }
);

// ----------------------------------------------------------------------------
// Auto-cancel open amendments when their parent job goes to a terminal status
// ----------------------------------------------------------------------------
//
// When admin cancels a job through any path that doesn't run through the
// amendment review modal (legacy cancel buttons, discrepancy-reports
// page, manual Firebase Console edits), any open /jobs_amendments/{id}
// records on that job stay in pending/approved/consented forever. The
// single-pending guard then blocks the rider's next request on the job
// with `failed-precondition`.
//
// This trigger watches /jobs/{jobId}/status. When it transitions INTO
// any TERMINAL_STATUSES value (Cancelled / Completed / Sold / Closed /
// Returned / Withdrawal Completed), we sweep open amendments on that
// job and flip them to `cancelled`. Idempotent — no-op if there are
// no open amendments.

exports.onJobTerminalCancelAmendments = onValueUpdated(
  {
    ref: "/jobs/{jobId}/status",
    instance: "bkk-apple-tradein-default-rtdb",
    region: AMENDMENT_REGION,
  },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (before === after) return;
    if (!TERMINAL_STATUSES.includes(after)) return;
    // Only fire on the transition INTO terminal — not subsequent edits
    // while already terminal.
    if (TERMINAL_STATUSES.includes(before)) return;

    const jobId = event.params.jobId;
    const db = getDatabase();
    const snap = await db
      .ref("jobs_amendments")
      .orderByChild("job_id")
      .equalTo(jobId)
      .once("value");
    if (!snap.exists()) return;

    const now = Date.now();
    const ops = [];
    snap.forEach((s) => {
      const am = s.val();
      if (am.status === "pending" || am.status === "approved" || am.status === "consented") {
        ops.push(
          s.ref.update({
            status: "cancelled",
            cancelled_at: now,
            admin_note: am.admin_note
              ? `${am.admin_note} [auto: job terminal=${after}]`
              : `Auto-cancelled because job moved to ${after}`,
          })
        );
      }
    });
    if (ops.length === 0) return;
    console.log(`[amendment-auto-cancel] job ${jobId} → ${after}; cancelled ${ops.length} open amendments`);
    await Promise.all(ops);
  }
);

exports.escalateAmendmentTimeouts = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Asia/Bangkok", region: AMENDMENT_REGION },
  async () => {
    const db = getDatabase();
    const cutoff = Date.now() - 15 * 60 * 1000;

    const snap = await db
      .ref("jobs_amendments")
      .orderByChild("status")
      .equalTo("pending")
      .once("value");
    if (!snap.exists()) return;

    const ops = [];
    snap.forEach((s) => {
      const am = s.val();
      if (am.requested_at < cutoff && !am.escalated_at) {
        ops.push(
          s.ref
            .update({ escalated_at: Date.now() })
            .then(() =>
              dispatchAdminPush(
                {
                  notification: {
                    title: "🚨 Amendment ค้างนาน — รอ admin",
                    body: `Rider ${am.requested_by_rider_name} รอเกิน 15 นาทีบน job #${shortJobId(am.job_id)}`,
                  },
                  data: { type: "amendment_escalated", amendmentId: am.id, jobId: am.job_id },
                },
                "amendment-escalation"
              )
            )
        );
      }
    });
    if (ops.length === 0) return;
    console.log(`[amendment-escalation] Escalating ${ops.length} stale amendments`);
    await Promise.all(ops);
  }
);

// ────────────────────────────────────────────────────────────────────
// Auto-flag misbehaving riders (Phase 3).
//
// Scheduled daily — walks /jobs and /jobs_offers from the last 30 days,
// computes per-rider stats, and writes /riders/{id}/flags/auto_review
// for anyone exceeding any threshold. Admin gets a push for each newly
// flagged rider so they can investigate via the dashboard. We never
// auto-suspend — flag-only — because the dashboard already exposes
// "อัตราสำเร็จ" / "อัตรารับงาน" so an admin can sanity-check before
// taking action. Auto-suspend is left for a future phase once we trust
// the data more.
//
// Thresholds live at /settings/rider_flag_thresholds in RTDB so they
// can be tuned without redeploying functions. If the node is missing
// we fall back to conservative defaults (high bar — only obvious bad
// actors get flagged).

const AUTO_FLAG_LOOKBACK_DAYS = 30;
const DEFAULT_FLAG_THRESHOLDS = {
  // Trip ≥ this fraction of completed-or-customer-cancelled landing in
  // customer-cancelled bucket suggests the rider is causing the cancels
  // (late, no-show, customer dispute on arrival).
  customer_cancel_rate: 0.30,
  // Rider rejecting / abandoning ≥ this fraction of accepted jobs in
  // the window. Different from "ignores broadcasts" — those are tracked
  // by acceptance rate.
  rider_cancel_rate: 0.30,
  // Acceptance rate < this fraction → rider mostly ignores broadcasts.
  // A rider who literally never accepts anything in 30 days isn't
  // useful as a rider; they should be talked to or paused.
  acceptance_rate_min: 0.20,
  // At least this many offered/assigned jobs in the window before we
  // bother evaluating a rider — avoids flagging brand-new riders on
  // sample-size noise (e.g. 0/1 looks worse than it is).
  min_sample_size: 10,
};

function statusIsCompleted(s) {
  return ["Paid", "Payment Completed", "Sent To QC Lab", "Ready To Sell", "Sold", "In Stock", "Completed"].includes(s);
}

exports.autoFlagRiders = onSchedule(
  {
    // Run at 04:00 Bangkok daily — after archiveOldJobs (03:00) so we
    // don't double-count freshly archived jobs. The archive uses
    // jobs/${id}, our query reads /jobs only, so this is a non-issue
    // anyway, but keeping a clean ordering helps mental model.
    schedule: "0 4 * * *",
    timeZone: "Asia/Bangkok",
    region: "asia-southeast1",
  },
  async () => {
    const db = getDatabase();
    const now = Date.now();
    const sinceTs = now - AUTO_FLAG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    const [thrSnap, ridersSnap, jobsSnap, offersSnap] = await Promise.all([
      db.ref("settings/rider_flag_thresholds").once("value"),
      db.ref("riders").once("value"),
      db.ref("jobs").once("value"),
      db.ref("jobs_offers").once("value"),
    ]);

    const thresholds = { ...DEFAULT_FLAG_THRESHOLDS, ...(thrSnap.val() || {}) };
    const riders = ridersSnap.val() || {};
    const jobs = jobsSnap.val() || {};
    const offers = offersSnap.val() || {};

    const flagsToWrite = {};
    const newlyFlaggedNotifications = [];

    for (const [riderId, riderRaw] of Object.entries(riders)) {
      const rider = riderRaw || {};
      const status = rider.approval_status || rider.status;
      // Skip already-suspended / rejected riders — flagging them again is noise.
      if (status === "Suspended" || status === "Rejected") continue;

      let completed = 0;
      let customerCancelled = 0;
      let riderCancelled = 0;
      let offered = 0;
      let acceptedFromOffers = 0;

      for (const [, jobRaw] of Object.entries(jobs)) {
        const job = jobRaw || {};
        const refTs = job.completed_at || job.cancelled_at || job.created_at || 0;
        if (refTs < sinceTs) continue;

        if (job.cancelled_by === `rider:${riderId}`) {
          riderCancelled += 1;
          continue;
        }
        if (job.rider_id !== riderId) continue;

        if (statusIsCompleted(job.status)) completed += 1;
        else if (job.status === "Cancelled" && job.cancel_category === "customer_request_cancel") customerCancelled += 1;
      }

      // Walk offers for this rider
      for (const [, perJobOffers] of Object.entries(offers)) {
        const rec = perJobOffers && perJobOffers[riderId];
        if (!rec) continue;
        const refTs = rec.offered_at || rec.accepted_at || rec.rejected_at || 0;
        if (refTs < sinceTs) continue;
        if (rec.offered_at) offered += 1;
        if (rec.accepted_at) acceptedFromOffers += 1;
      }

      const totalEngaged = completed + customerCancelled + riderCancelled;
      // Sample size = max of the two denominators we evaluate against.
      const sampleSize = Math.max(totalEngaged, offered);
      if (sampleSize < thresholds.min_sample_size) continue;

      const reasons = [];
      const customerCancelRate = totalEngaged > 0 ? customerCancelled / totalEngaged : 0;
      const riderCancelRate = totalEngaged > 0 ? riderCancelled / totalEngaged : 0;
      const acceptanceRate = offered > 0 ? acceptedFromOffers / offered : null;

      if (customerCancelRate > thresholds.customer_cancel_rate) {
        reasons.push(`อัตราลูกค้ายกเลิก ${(customerCancelRate * 100).toFixed(0)}% (เกิน ${(thresholds.customer_cancel_rate * 100).toFixed(0)}%)`);
      }
      if (riderCancelRate > thresholds.rider_cancel_rate) {
        reasons.push(`อัตราไรเดอร์ยกเลิก/ปฏิเสธ ${(riderCancelRate * 100).toFixed(0)}% (เกิน ${(thresholds.rider_cancel_rate * 100).toFixed(0)}%)`);
      }
      if (acceptanceRate != null && acceptanceRate < thresholds.acceptance_rate_min) {
        reasons.push(`อัตรารับงาน ${(acceptanceRate * 100).toFixed(0)}% (ต่ำกว่า ${(thresholds.acceptance_rate_min * 100).toFixed(0)}%)`);
      }

      const wasAlreadyFlagged = !!(rider.flags && rider.flags.auto_review);

      if (reasons.length > 0) {
        flagsToWrite[`riders/${riderId}/flags/auto_review`] = {
          flagged_at: now,
          window_days: AUTO_FLAG_LOOKBACK_DAYS,
          sample_size: sampleSize,
          reasons,
          metrics: {
            completed,
            customer_cancelled: customerCancelled,
            rider_cancelled: riderCancelled,
            offered,
            accepted_from_offers: acceptedFromOffers,
            customer_cancel_rate: Number(customerCancelRate.toFixed(3)),
            rider_cancel_rate: Number(riderCancelRate.toFixed(3)),
            acceptance_rate: acceptanceRate != null ? Number(acceptanceRate.toFixed(3)) : null,
          },
        };
        if (!wasAlreadyFlagged) {
          newlyFlaggedNotifications.push({
            riderId,
            name: rider.name || rider.fullName || riderId,
            reasons,
          });
        }
      } else if (wasAlreadyFlagged) {
        // Rider's stats recovered — clear the flag.
        flagsToWrite[`riders/${riderId}/flags/auto_review`] = null;
      }
    }

    if (Object.keys(flagsToWrite).length > 0) {
      await db.ref().update(flagsToWrite);
    }

    for (const item of newlyFlaggedNotifications) {
      try {
        await dispatchAdminPush(
          {
            notification: {
              title: "🚩 Rider flagged for review",
              body: `${item.name}: ${item.reasons[0]}${item.reasons.length > 1 ? ` (+${item.reasons.length - 1})` : ""}`,
            },
            data: { type: "rider_auto_flagged", riderId: item.riderId },
          },
          "rider-auto-flag"
        );
      } catch (e) {
        console.error(`autoFlagRiders push failed for ${item.riderId}:`, e);
      }
    }

    console.log(
      `autoFlagRiders: scanned ${Object.keys(riders).length} riders, ` +
      `wrote ${Object.keys(flagsToWrite).length} flag updates, ` +
      `${newlyFlaggedNotifications.length} new flags notified.`
    );
  }
);

// =============================================================================
// Overdue rider-return detector
//
// Once a job hits Paid, the rider has the device and the money has left our
// account — every minute they're not back at the branch is unmanaged risk.
// Anchoring the SLA on paid_at (rather than 'Rider Returning') means the
// clock starts the moment we're financially exposed, even if the rider
// hasn't pressed the "เดินทางกลับ" button.
//
// Default threshold 60 minutes, overridable in settings/system/rider_overdue_min
// (single integer, minutes). One push per job — overdue_notified_at stamp
// prevents the cron from spamming the same job on every tick.
// =============================================================================
const STILL_OUT_STATUSES = [
  "Paid", "PAID", "Payment Completed",
  "Rider Returning", "In-Transit",
];

exports.checkOverdueReturns = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "asia-southeast1",
    timeZone: "Asia/Bangkok",
  },
  async () => {
    const db = getDatabase();

    const thresholdSnap = await db.ref("settings/system/rider_overdue_min").get();
    const thresholdMin = (thresholdSnap.exists() && typeof thresholdSnap.val() === "number" && thresholdSnap.val() > 0)
      ? thresholdSnap.val()
      : 60;

    const now = Date.now();
    const cutoff = now - thresholdMin * 60 * 1000;
    const lookback = now - 24 * 60 * 60 * 1000; // ignore stale data > 24h

    // Scan the live jobs collection — archived jobs (>90d) aren't here.
    // No paid_at index in rules so we filter in code; live set is ~hundreds,
    // negligible at every-5-min cadence.
    const jobsSnap = await db.ref("jobs").once("value");
    if (!jobsSnap.exists()) {
      console.log("[checkOverdueReturns] no jobs to scan");
      return;
    }

    const overdue = [];
    jobsSnap.forEach((snap) => {
      const job = snap.val();
      if (!job || typeof job.paid_at !== "number") return;
      if (job.paid_at < lookback || job.paid_at > cutoff) return;
      if (!STILL_OUT_STATUSES.includes(job.status)) return;
      if (job.overdue_notified_at) return; // already alerted once
      if (!job.rider_id) return; // store-in / mail-in skip — no rider in the loop
      overdue.push({ id: snap.key, job });
    });

    if (overdue.length === 0) {
      console.log(`[checkOverdueReturns] none overdue (threshold ${thresholdMin}m)`);
      return;
    }

    for (const { id, job } of overdue) {
      const elapsedMin = Math.floor((now - job.paid_at) / 60000);
      const model = job.model || "ไม่ระบุรุ่น";
      const custName = job.cust_name || "";
      const title = "⚠️ ไรเดอร์ค้างส่งคืน";
      const body = `จ่ายเงินไปแล้ว ${elapsedMin} นาที ยังไม่ถึงสาขา — ${model}${custName ? ` (${custName})` : ""}`;

      await dispatchAdminPush(
        {
          data: {
            jobId: id,
            type: "rider_overdue",
            title,
            body,
            model,
            elapsedMin: String(elapsedMin),
            riderId: String(job.rider_id || ""),
          },
          android: {
            priority: "high",
            notification: {
              channelId: "rider_overdue",
              priority: "high",
              defaultSound: true,
              tag: `overdue-${id}`,
            },
          },
          apns: {
            headers: { "apns-priority": "10", "apns-push-type": "alert" },
            payload: { aps: { "mutable-content": 1, sound: "default" } },
          },
          webpush: { headers: { Urgency: "high", TTL: "86400" } },
        },
        `checkOverdueReturns(${id})`
      );

      await db.ref(`jobs/${id}/overdue_notified_at`).set(now);
    }

    console.log(`[checkOverdueReturns] alerted on ${overdue.length} overdue job(s), threshold ${thresholdMin}m`);
  }
);

// =============================================================================
// Rider mid-job event notifications — Sickw + KYC don't change job.status, so
// onAdminJobStatusNotify can't surface them. Admin needs them anyway so the
// owning agent can pre-stage approval instead of finding out at QC time.
// =============================================================================

/**
 * Rider tapped "Check Sickw" inside InspectionModal → recordSickwUsage pushed
 * a log entry. Surface this to admins as a push so the owning agent knows the
 * device is being verified in the field. Filter:
 *   - source === 'rider'  (skip admin-desktop / admin-mobile self-checks)
 *   - job_id present      (skip rider self-test / Internal QC scratch checks)
 */
exports.onRiderSickwCheck = onValueCreated(
  {
    ref: "/sickw_usage/{logId}",
    region: "asia-southeast1",
  },
  async (event) => {
    const entry = event.data.val();
    if (!entry) return;
    if (entry.source !== "rider") return;
    if (!entry.job_id) return;

    const jobId = entry.job_id;
    const db = getDatabase();
    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) return;
    const job = jobSnap.val();

    const riderName = entry.name || "ไรเดอร์";
    const model = job.model || "ไม่ระบุรุ่น";
    const custName = job.cust_name || "";
    const services = Array.isArray(entry.service_ids) ? entry.service_ids.length : 1;

    const title = "🔬 ไรเดอร์ตรวจ Sickw";
    const body = `${riderName} ตรวจ ${services} service บน ${model}${custName ? ` (${custName})` : ""}`;

    await dispatchAdminPush(
      {
        data: {
          jobId,
          type: "status_change",
          title,
          body,
          newStatus: "Sickw Checked",
          model,
        },
        android: {
          priority: "high",
          notification: {
            channelId: "status_changes",
            priority: "high",
            defaultSound: true,
            tag: `sickw-${jobId}`,
          },
        },
        apns: {
          headers: { "apns-priority": "10", "apns-push-type": "alert" },
          payload: { aps: { "mutable-content": 1, sound: "default" } },
        },
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
      },
      `onRiderSickwCheck(${jobId})`
    );
  }
);

/**
 * Rider finished KYC → wrote kyc_verified_at on the job. Notify admin so the
 * owning agent can review the captured ID / signature before payout. Differs
 * by kyc_method:
 *   - photo          → routine success
 *   - typed_fallback → URGENT review needed (customer had no ID)
 */
exports.onJobKycVerified = onValueCreated(
  {
    ref: "/jobs/{jobId}/kyc_verified_at",
    region: "asia-southeast1",
  },
  async (event) => {
    const ts = event.data.val();
    if (!ts) return;

    const jobId = event.params.jobId;
    const db = getDatabase();
    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) return;
    const job = jobSnap.val();

    const kycMethod = job.kyc_method || "photo";
    const model = job.model || "ไม่ระบุรุ่น";
    const custName = job.cust_name || "";
    const isFallback = kycMethod === "typed_fallback";

    const title = isFallback
      ? "🪪 ⚠️ KYC ผิดปกติ — ตรวจสอบลายเซ็น"
      : "🪪 ไรเดอร์บันทึก KYC แล้ว";
    const body = `${model}${custName ? ` - ${custName}` : ""}${isFallback ? " (ลูกค้าไม่มีบัตร)" : ""}`;

    await dispatchAdminPush(
      {
        data: {
          jobId,
          type: "status_change",
          title,
          body,
          newStatus: "KYC Verified",
          model,
        },
        android: {
          priority: "high",
          notification: {
            channelId: "status_changes",
            priority: "high",
            defaultSound: true,
            tag: `kyc-${jobId}`,
          },
        },
        apns: {
          headers: { "apns-priority": "10", "apns-push-type": "alert" },
          payload: { aps: { "mutable-content": 1, sound: "default" } },
        },
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
      },
      `onJobKycVerified(${jobId}, ${kycMethod})`
    );
  }
);

// =============================================================================
// Sickw IMEI Check: ตรวจสอบสถานะเครื่อง (รุ่น, ความจุ, ประเทศ, iCloud, FMI,
// MDM, Stolen) ผ่าน Sickw API
//
// - API Key เก็บใน Cloud Function env (SICKW_API_KEY) — ห้ามอยู่ฝั่ง client
// - Auth: ต้อง login เท่านั้น (admin/rider/staff)
// - Cache: เก็บผลใน device_checks/{imei}/svc_{serviceId} เพื่อกันเรียกซ้ำ
//   เปลืองเครดิต (default TTL = 24 ชม., ส่ง forceRefresh:true เพื่อข้าม)
// - Generic parser: Sickw แต่ละ Service ID คืนค่าคนละ field กัน — เก็บ raw
//   ทั้งก้อน + best-effort parse field ที่พบบ่อย (model, capacity, country,
//   iCloud/FMI, MDM, blacklist, carrier ฯลฯ)
// =============================================================================

const SICKW_REGION = "asia-southeast1";
const SICKW_ENDPOINT = "https://sickw.com/api.php";
const SICKW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ─────────────────────────────────────────────────────────────────────────────
// Audit log helper — บันทึก call ทุกครั้งของ Sickw (single + bundle)
// เก็บที่ sickw_usage/{push-key} เพื่อให้ CEO/MANAGER ตรวจย้อนได้
//
// เก็บ: uid, name (lookup), role, imei, service_ids, job_id, cached[],
//       credit_used (USD), status, source ('client'/'rider'/'admin_mobile'/...)
//
// Cache hit ไม่หัก credit แต่ก็ log อยู่ดี — เพราะ admin อาจสงสัยว่าทำไมคนนี้
// query บ่อย (อาจหา IMEI ที่ไม่ใช่ของลูกค้า)
// ─────────────────────────────────────────────────────────────────────────────

// staff/ key เป็น push id (สร้างตอน Staff Management) ไม่ใช่ Firebase Auth UID
// → lookup ด้วย email match จาก request.auth.token.email
// rider app ต่างกัน — riders/{uid} ใช้ Firebase UID เป็น key ตรงๆ
async function lookupStaffByAuth(db, auth) {
  if (!auth) return null;
  const email = auth.token && auth.token.email;
  if (email) {
    const snap = await db.ref("staff").once("value");
    let matched = null;
    snap.forEach((s) => {
      const v = s.val();
      if (!v) return false;
      const status = String(v.status || "").toUpperCase();
      if (v.email === email && (status === "" || status === "ACTIVE")) {
        matched = { id: s.key, ...v };
        return true; // stop forEach
      }
      return false;
    });
    if (matched) return matched;
  }
  // Fallback rider lookup (rider app ใช้ Firebase UID เป็น key ใน riders/)
  const riderSnap = await db.ref(`riders/${auth.uid}`).once("value");
  if (riderSnap.exists()) {
    const r = riderSnap.val();
    return { id: auth.uid, role: "RIDER", name: r.name || r.displayName || r.email || "Rider", ...r };
  }
  return null;
}

async function recordSickwUsage(db, entry) {
  try {
    let name = "Unknown";
    let role = "UNKNOWN";
    let staffId = null;
    try {
      const staff = await lookupStaffByAuth(db, { uid: entry.uid, token: entry.authToken });
      if (staff) {
        name = staff.name || staff.displayName || staff.email || "Unknown";
        role = String(staff.role || "STAFF").toUpperCase();
        staffId = staff.id || null;
      }
    } catch (e) {
      // best-effort — don't fail the request just because lookup failed
      console.warn("[sickw-audit] lookup name failed:", e?.message || e);
    }

    const log = {
      timestamp: Date.now(),
      uid: entry.uid,
      staff_id: staffId,
      name,
      role,
      imei: entry.imei,
      service_ids: entry.serviceIds,
      job_id: entry.jobId || null,
      cached: entry.cached,
      credit_used: entry.creditUsed,
      status: entry.status,
      source: entry.source || "unknown",
    };

    await db.ref("sickw_usage").push(log);

    // ถ้าตรวจโดยไม่ผูก jobId → flag เป็น suspicious ใน sickw_usage_flags/
    // เผื่อ CEO เปิดดูแยก (น่าจะตรวจ IMEI ที่ไม่ใช่ของลูกค้า — ส่วนตัวหรือ test)
    if (!entry.jobId) {
      await db.ref("sickw_usage_flags").push({
        ...log,
        reason: "no_job_id",
      });
    }
  } catch (e) {
    console.warn("[sickw-audit] write log failed:", e?.message || e);
  }
}

// ปรับ key ของ Sickw ที่เจอบ่อย → ชื่อ field มาตรฐานของเรา
// ปล่อย key ที่ไม่ match ไว้ใน raw response เพื่อให้แอดมินอ่านได้
//
// ระวัง: Sickw มี 2 key ที่ดูคล้ายแต่ความหมายต่าง
//   - "icloud lock" = Activation Lock ON/OFF → จัดเป็น FMI flag
//   - "icloud status" = Lost/Stolen/Clean → จัดเป็น Blacklist flag
// อย่าสลับ ไม่งั้นเครื่อง FMI=ON จะโชว์ clean ผิดทาง
const SICKW_FIELD_MAP = {
  model: ["model", "model description", "model desc", "model name", "device name", "modal description"],
  modelNumber: ["model number", "model no", "part number", "model code", "material number"],
  capacity: ["capacity", "memory", "storage", "memory capacity"],
  color: ["color", "colour", "device color"],
  country: ["country", "purchase country", "sold by", "region", "sold by country", "purchased in", "country of purchase"],
  imei: ["imei", "imei number"],
  imei2: ["imei2", "imei 2"],
  serial: ["serial", "serial number", "sn"],
  fmiStatus: ["icloud lock", "fmi status", "fmi", "find my iphone", "find my", "find my status"],
  activationLock: ["activation lock", "activation lock status"],
  activationStatus: ["activation status", "activated", "activation", "device activation"],
  mdmStatus: ["mdm lock", "mdm status", "mdm", "mdm lock status"],
  blacklistStatus: ["icloud status", "blacklist status", "blacklist", "gsma blacklist", "stolen", "lost"],
  carrier: ["carrier", "initial carrier", "carrier country", "network", "sold carrier"],
  simLock: ["sim-lock", "sim lock", "simlock", "lock status", "simpolicy unlock status"],
  warrantyStatus: ["warranty status", "warranty", "limited warranty"],
  estimatedPurchaseDate: ["estimated purchase date", "purchase date", "initial activation", "coverage start date"],
};

function normalizeSickwKey(rawKey) {
  return String(rawKey || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

// Map ค่าจาก Sickw → flag state (clean | flagged | unknown) สำหรับใช้ตัดสิน Gate
// ที่ฝั่ง server ด้วย (อย่าให้ client กำหนดเองทั้งหมด)
function interpretSickwFlag(value, kind) {
  if (!value) return "unknown";
  const v = String(value).toLowerCase();
  if (kind === "fmi" || kind === "icloud") {
    if (v.includes("off") || v.includes("clean") || v.includes("disabled")) return "clean";
    if (v.includes("on") || v.includes("locked") || v.includes("enabled") || v.includes("active")) return "flagged";
    return "unknown";
  }
  if (kind === "mdm") {
    if (v.includes("no") || v.includes("clean") || v.includes("off") || v.includes("clear") || v.includes("not enrolled")) return "clean";
    if (v.includes("yes") || v.includes("lock") || v.includes("enrolled") || v.includes("supervised")) return "flagged";
    return "unknown";
  }
  if (kind === "blacklist") {
    if (v.includes("clean") || v.startsWith("not") || v === "no" || v.includes(" no ") || v.includes("off")) return "clean";
    if (v.includes("blacklist") || v.includes("lost") || v.includes("stolen") || v.startsWith("yes")) return "flagged";
    return "unknown";
  }
  return "unknown";
}

// คำนวณ flags สรุปจาก parsed fields → ใช้ทั้งฝั่ง server (เขียนลง snapshot ของ job)
// และ Gate check ฝั่ง UI (helper เดียวกัน source-of-truth)
//
// fmi = "icloud lock" หรือ "fmi" หรือ "activation lock" (ON/OFF — ติดล็อคไหม)
// blacklist = "icloud status" หรือ "blacklist" (Clean/Lost/Stolen)
// ห้ามใช้ "icloud status" ตัดสิน FMI เพราะ status=Clean บอกแค่ว่า "ไม่หาย" ไม่ใช่ "FMI=OFF"
function summarizeSickwFlags(parsed) {
  const p = parsed || {};
  return {
    fmi: interpretSickwFlag(p.fmiStatus || p.activationLock, "fmi"),
    mdm: interpretSickwFlag(p.mdmStatus, "mdm"),
    blacklist: interpretSickwFlag(p.blacklistStatus, "blacklist"),
  };
}

function parseSickwResult(raw) {
  // Sickw คืน result เป็น HTML/text เช่น
  //   "Model Description: iPhone 14 Pro<br>IMEI: 35xx<br>FMI Status: OFF"
  // หรือบาง service มี IMEI/Serial เป็น prefix ของทุก key:
  //   "klfqvl2mj6 find my iphone: ON<br>klfqvl2mj6 imei: ..."
  // ขั้นตอน: split ด้วย <br>/\n → split "key:value" → strip imei prefix
  // → map ด้วย endsWith (ทน prefix variants)
  if (!raw || typeof raw !== "string") return { parsed: {}, fields: {} };

  const lines = raw
    .split(/<br\s*\/?>|\r?\n/i)
    .map((s) => s.trim())
    .filter(Boolean);

  // เก็บ field ดิบทุก key:value ที่หาเจอ (สำหรับโชว์ในแอดมิน)
  const fields = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = normalizeSickwKey(line.slice(0, idx));
    const value = line
      .slice(idx + 1)
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    if (!key || !value) continue;
    // เก็บแบบ first-write-wins (ค่าแรกของ key เดิม)
    if (!(key in fields)) fields[key] = value;
  }

  // Map ลง standard fields — ใช้ endsWith เพื่อทน IMEI/Serial prefix
  // (เช่น "klfqvl2mj6 find my iphone" → match candidate "find my iphone")
  // ลำดับ candidate สำคัญ: ตัวที่จำเพาะมากกว่าต้องอยู่ก่อน
  const parsed = {};
  for (const [stdKey, candidates] of Object.entries(SICKW_FIELD_MAP)) {
    for (const candidate of candidates) {
      const hit = Object.keys(fields).find(
        (k) => k === candidate || k.endsWith(" " + candidate)
      );
      if (hit) {
        parsed[stdKey] = fields[hit];
        break;
      }
    }
  }

  // บาง service (GSX/MDM status) ไม่ได้คืน capacity/color เป็น field แยก แต่ฝังรวมใน
  // "model name" เช่น "iPhone 13 Pro Max 256GB Sierra Blue" — แกะออกมาเติมให้
  // เฉพาะตอนที่ยังว่าง (ไม่ทับค่าที่ service คืนมาตรงๆ)
  const modelName = parsed.model || fields["model name"] || "";
  if (!parsed.capacity) {
    const cap =
      modelName.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i) ||
      (fields["device configuration"] || "").match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
    if (cap) parsed.capacity = `${cap[1]}${cap[2].toUpperCase()}`;
  }
  if (!parsed.color && modelName) {
    // สี = ข้อความที่อยู่หลัง token ความจุใน model name
    const m = modelName.match(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/i);
    if (m && m.index != null) {
      const after = modelName.slice(m.index + m[0].length).trim();
      if (after) parsed.color = after;
    }
  }

  return { parsed, fields };
}

exports.checkDeviceWithSickw = onCall({ region: SICKW_REGION, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }

  const apiKey = process.env.SICKW_API_KEY;
  if (!apiKey) {
    console.error("[sickw] SICKW_API_KEY not configured");
    throw new HttpsError("failed-precondition", "ระบบยังไม่ได้ตั้งค่า Sickw API Key");
  }

  const { imei, serviceId, forceRefresh, jobId, source } = request.data || {};

  if (!imei || typeof imei !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ IMEI หรือ Serial Number");
  }
  if (jobId != null && (typeof jobId !== "string" || jobId.length > 128 || /[/.#$\[\]]/.test(jobId))) {
    throw new HttpsError("invalid-argument", "jobId ไม่ถูกต้อง");
  }
  const cleanImei = imei.trim().toUpperCase();
  // IMEI 15 หลัก หรือ Serial 8–17 ตัวอักษร (Apple serial = 10–12)
  if (!/^[A-Z0-9]{8,17}$/.test(cleanImei)) {
    throw new HttpsError("invalid-argument", "IMEI / Serial ไม่ถูกต้อง (ต้องเป็นตัวเลข/ตัวอักษร 8–17 หลัก)");
  }

  const svcId = String(serviceId || "").trim();
  if (!/^\d{1,4}$/.test(svcId)) {
    throw new HttpsError("invalid-argument", "ต้องระบุ Sickw service ID (ตัวเลข)");
  }

  const db = getDatabase();
  const cacheRef = db.ref(`device_checks/${cleanImei}/svc_${svcId}`);

  // helper: เขียน snapshot ผลตรวจล่าสุดลงใบงาน (ถ้าผู้เรียกส่ง jobId มา)
  // ทำทั้งเส้น cache-hit และ cache-miss — ใบงานต้องมี snapshot ทุกครั้งที่กดตรวจ
  // เพื่อให้ Gate ตัดสินใจจาก state ล่าสุด
  async function writeJobSnapshot(snapshot) {
    if (!jobId) return;
    const flags = summarizeSickwFlags(snapshot.parsed);
    const snapshotForJob = {
      ...snapshot,
      flags,
    };
    try {
      // ใช้ update เพื่อไม่ลบ override เก่า (ถ้ามี) — override จะถูก invalidate
      // เฉพาะตอนที่ checked_at ใหม่กว่า against_check_at ของ override
      await db.ref(`jobs/${jobId}/sickw_check`).update({ last_check: snapshotForJob });
    } catch (e) {
      console.warn(`[sickw] writeJobSnapshot(${jobId}) failed:`, e?.message || e);
    }
  }

  // Cache hit (ภายใน TTL) — return เลย ไม่เรียก Sickw
  if (!forceRefresh) {
    const cacheSnap = await cacheRef.once("value");
    if (cacheSnap.exists()) {
      const cached = cacheSnap.val();
      if (cached.checked_at && Date.now() - cached.checked_at < SICKW_CACHE_TTL_MS) {
        console.log(`[sickw] cache hit for ${cleanImei}/svc_${svcId} (age=${Math.round((Date.now() - cached.checked_at) / 1000)}s)`);
        // Audit log แม้ cache hit — ยังคงต้องรู้ว่าใครเปิดดูเครื่องไหนบ่อย
        await recordSickwUsage(db, {
          uid: request.auth.uid,
          authToken: request.auth.token,
          imei: cleanImei,
          serviceIds: [svcId],
          jobId,
          cached: [true],
          creditUsed: 0,
          status: cached.status,
          source: source || "unknown",
        });
        // Re-parse จาก raw ทุกครั้ง — ทำให้ parser improvement ใหม่มีผล
        // กับ cache เก่าโดยไม่ต้องไป burn credit เรียก Sickw ใหม่
        const reparsed = parseSickwResult(cached.raw || "");
        const flags = summarizeSickwFlags(reparsed.parsed);
        // cache-hit ก็ต้องเขียน snapshot ลง job (ผูกผลล่าสุดเข้าใบงานนี้)
        // ใช้ time เดิม เพื่อ Gate ตัดสินถูกว่า override เก่ายัง valid อยู่หรือไม่
        await writeJobSnapshot({
          checked_at: cached.checked_at,
          checked_by_uid: request.auth.uid,
          service_id: svcId,
          imei: cleanImei,
          status: cached.status,
          parsed: reparsed.parsed,
          fields: reparsed.fields,
          raw: cached.raw || "",
        });
        return {
          ok: true,
          cached: true,
          checkedAt: cached.checked_at,
          serviceId: svcId,
          imei: cleanImei,
          status: cached.status,
          parsed: reparsed.parsed,
          fields: reparsed.fields,
          raw: cached.raw || "",
          flags,
        };
      }
    }
  }

  // เรียก Sickw API
  const url = `${SICKW_ENDPOINT}?format=JSON&key=${encodeURIComponent(apiKey)}&imei=${encodeURIComponent(cleanImei)}&service=${encodeURIComponent(svcId)}`;
  let sickwResp;
  try {
    const httpResp = await fetch(url, { method: "GET" });
    const text = await httpResp.text();
    try {
      sickwResp = JSON.parse(text);
    } catch {
      // Sickw บางครั้งคืน text/html แทน JSON ตอน error
      console.error(`[sickw] non-JSON response: ${text.slice(0, 200)}`);
      throw new HttpsError("internal", `Sickw คืนค่าไม่ใช่ JSON: ${text.slice(0, 120)}`);
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("[sickw] fetch failed:", e?.message || e);
    throw new HttpsError("internal", `เรียก Sickw ไม่สำเร็จ: ${e?.message || e}`);
  }

  // Sickw response shape: { status: "success"|"rejected"|"error", result, imei, service, ... }
  const status = String(sickwResp.status || "unknown").toLowerCase();
  const raw = typeof sickwResp.result === "string" ? sickwResp.result : JSON.stringify(sickwResp.result || sickwResp);
  const { parsed, fields } = parseSickwResult(raw);

  const record = {
    checked_at: Date.now(),
    checked_by_uid: request.auth.uid,
    service_id: svcId,
    imei: cleanImei,
    status,
    raw,
    parsed,
    fields,
  };

  // เก็บ cache (overwrite เสมอ — record ล่าสุดทับของเก่า)
  // เก็บแม้ status=rejected/error ด้วย เพื่อเลี่ยงการ retry แบบไม่ตั้งใจ
  // แต่ TTL ของ failure จะสั้นกว่าผ่าน logic ฝั่ง read
  try {
    await cacheRef.set(record);
  } catch (e) {
    console.warn("[sickw] cache write failed:", e?.message || e);
  }

  // เก็บ snapshot ลงใบงานด้วย (ถ้าผู้เรียกส่ง jobId มา)
  await writeJobSnapshot(record);

  // ดึงราคาของ service จาก catalog cache เพื่อบันทึก credit_used
  let price = 0;
  try {
    const catalogSnap = await db.ref(SICKW_CATALOG_CACHE_KEY).once("value");
    if (catalogSnap.exists()) {
      const cat = catalogSnap.val();
      const found = (cat.services || []).find((s) => String(s.service) === svcId);
      if (found) price = Number(found.price || 0);
    }
  } catch (_) { /* ignore — credit_used = 0 ก็ยังบันทึก log อยู่ */ }

  await recordSickwUsage(db, {
    uid: request.auth.uid,
    authToken: request.auth.token,
    imei: cleanImei,
    serviceIds: [svcId],
    jobId,
    cached: [false],
    creditUsed: price,
    status,
    source: source || "unknown",
  });

  return {
    ok: status === "success",
    cached: false,
    checkedAt: record.checked_at,
    serviceId: svcId,
    imei: cleanImei,
    status,
    parsed,
    fields,
    raw,
    flags: summarizeSickwFlags(parsed),
  };
});

// =============================================================================
// lookupDeviceForQuote: เวอร์ชัน public สำหรับเว็บลูกค้า (bkk-frontend-next)
// ใช้ตอนลูกค้ากรอก Serial/IMEI ที่หน้า /sell เพื่อเด้ง "รุ่น + ความจุ" มาเติม
// ในระบบประเมินราคา — แล้วฝั่ง client เอาไป match กับ catalog เอง
//
// ต่างจาก checkDeviceWithSickw (ของแอดมิน/ไรเดอร์) ตรงนี้:
//   - คืนเฉพาะ { model, capacity } เท่านั้น — ตัด FMI/iCloud/MDM/blacklist/serial
//     ทิ้งก่อนส่งกลับ (privacy + ขอบเขตงาน — เช็คสถานะติดล็อกค่อยทำตอนไรเดอร์)
//   - Rate limit ต่อ uid (anonymous auth ก็ผ่าน) — กัน abuse/เครดิตหมด
//   - ไม่เขียน sickw_usage_flags (no_job_id เป็นเรื่องปกติของ public traffic)
//     แต่ยัง log แยกที่ quote_lookups/ ให้ตรวจย้อนได้
//   - ใช้ cache 24h + parser ตัวเดียวกับของแอดมิน (reuse)
// =============================================================================

const QUOTE_LOOKUP_RATE_LIMIT = 10;          // ครั้งต่อหน้าต่าง
const QUOTE_LOOKUP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 ชั่วโมง

// เลือก Sickw service สำหรับ quote lookup:
//   1) settings/sickw/quote_lookup_service (ตั้งเฉพาะงานนี้)
//   2) fallback เป็นตัวแรกของ settings/sickw/default_bundle ที่แอดมินตั้งไว้แล้ว
async function resolveQuoteLookupService(db) {
  const explicit = await db.ref("settings/sickw/quote_lookup_service").once("value");
  if (explicit.exists()) {
    const v = String(explicit.val()).trim();
    if (/^\d{1,4}$/.test(v)) return v;
  }
  const bundle = await db.ref("settings/sickw/default_bundle").once("value");
  if (bundle.exists()) {
    const arr = bundle.val();
    const first = Array.isArray(arr) ? arr[0] : (arr && Object.values(arr)[0]);
    const v = String(first || "").trim();
    if (/^\d{1,4}$/.test(v)) return v;
  }
  return null;
}

// Rate limit ต่อ uid — transaction กัน race เมื่อกดรัวๆ
// คืน true ถ้าเกิน limit
async function isQuoteLookupRateLimited(db, uid) {
  const ref = db.ref(`quote_lookup_rate/${uid}`);
  let limited = false;
  await ref.transaction((cur) => {
    const now = Date.now();
    if (!cur || now - cur.window_start >= QUOTE_LOOKUP_RATE_WINDOW_MS) {
      return { window_start: now, count: 1 };
    }
    if (cur.count >= QUOTE_LOOKUP_RATE_LIMIT) {
      limited = true;
      return cur; // ไม่เพิ่ม count
    }
    return { window_start: cur.window_start, count: cur.count + 1 };
  });
  return limited;
}

exports.lookupDeviceForQuote = onCall({ region: SICKW_REGION, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }

  const apiKey = process.env.SICKW_API_KEY;
  if (!apiKey) {
    console.error("[quote-lookup] SICKW_API_KEY not configured");
    throw new HttpsError("failed-precondition", "ระบบยังไม่พร้อมให้บริการค้นหา");
  }

  const { serial } = request.data || {};
  if (!serial || typeof serial !== "string") {
    throw new HttpsError("invalid-argument", "กรุณากรอกหมายเลขเครื่อง (Serial / IMEI)");
  }
  const cleanSerial = serial.trim().toUpperCase();
  // IMEI 15 หลัก หรือ Serial 8–17 ตัวอักษร (Apple serial = 10–12)
  if (!/^[A-Z0-9]{8,17}$/.test(cleanSerial)) {
    throw new HttpsError("invalid-argument", "หมายเลขเครื่องไม่ถูกต้อง (ต้องเป็นตัวเลข/ตัวอักษร 8–17 หลัก)");
  }
  const deviceType = /^\d{15}$/.test(cleanSerial) ? "imei" : "serial";

  const db = getDatabase();

  // Rate limit ก่อนทำอย่างอื่น — กัน abuse เครดิต
  if (await isQuoteLookupRateLimited(db, request.auth.uid)) {
    throw new HttpsError("resource-exhausted", "ค้นหาบ่อยเกินไป กรุณาลองใหม่ในอีกสักครู่");
  }

  const svcId = await resolveQuoteLookupService(db);
  if (!svcId) {
    console.error("[quote-lookup] no service configured (settings/sickw/quote_lookup_service หรือ default_bundle)");
    throw new HttpsError("failed-precondition", "ระบบยังไม่พร้อมให้บริการค้นหา");
  }

  const cacheRef = db.ref(`device_checks/${cleanSerial}/svc_${svcId}`);

  // helper: log แยกที่ quote_lookups/ (ไม่ใช่ sickw_usage_flags)
  async function logQuoteLookup(extra) {
    try {
      await db.ref("quote_lookups").push({
        timestamp: Date.now(),
        uid: request.auth.uid,
        device_type: deviceType,
        service_id: svcId,
        ...extra,
      });
    } catch (e) {
      console.warn("[quote-lookup] log failed:", e?.message || e);
    }
  }

  // คืนเฉพาะ field ที่หน้าบ้านต้องใช้ — ตัดข้อมูล sensitive ทิ้ง
  function publicResult(status, parsed) {
    return {
      ok: status === "success",
      status,
      deviceType,
      model: parsed.model || "",
      capacity: parsed.capacity || "",
    };
  }

  // Cache hit (ภายใน TTL) — re-parse จาก raw แล้วคืนเลย ไม่ burn เครดิต
  const cacheSnap = await cacheRef.once("value");
  if (cacheSnap.exists()) {
    const cached = cacheSnap.val();
    if (cached.checked_at && Date.now() - cached.checked_at < SICKW_CACHE_TTL_MS) {
      const reparsed = parseSickwResult(cached.raw || "");
      await logQuoteLookup({ cached: true, status: cached.status });
      return publicResult(cached.status, reparsed.parsed);
    }
  }

  // Cache miss — เรียก Sickw
  const url = `${SICKW_ENDPOINT}?format=JSON&key=${encodeURIComponent(apiKey)}&imei=${encodeURIComponent(cleanSerial)}&service=${encodeURIComponent(svcId)}`;
  let sickwResp;
  try {
    const httpResp = await fetch(url, { method: "GET" });
    const text = await httpResp.text();
    sickwResp = JSON.parse(text);
  } catch (e) {
    console.error("[quote-lookup] fetch/parse failed:", e?.message || e);
    await logQuoteLookup({ cached: false, status: "error" });
    throw new HttpsError("internal", "ค้นหาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  }

  const status = String(sickwResp.status || "unknown").toLowerCase();
  const raw = typeof sickwResp.result === "string" ? sickwResp.result : JSON.stringify(sickwResp.result || sickwResp);
  const { parsed, fields } = parseSickwResult(raw);

  // เก็บ cache (full record เหมือน checkDeviceWithSickw เพื่อให้แอดมิน reuse ได้)
  try {
    await cacheRef.set({
      checked_at: Date.now(),
      checked_by_uid: request.auth.uid,
      service_id: svcId,
      imei: cleanSerial,
      status,
      raw,
      parsed,
      fields,
    });
  } catch (e) {
    console.warn("[quote-lookup] cache write failed:", e?.message || e);
  }

  await logQuoteLookup({ cached: false, status });
  return publicResult(status, parsed);
});

// =============================================================================
// Sickw Gate Override: แอดมินระดับ MANAGER/CEO เขียนเหตุผลเพื่อปลดล็อก Gate
// บนใบงานที่ Sickw รายงานว่าเครื่องติด FMI/MDM/Blacklist
//
// - Override ผูกกับเช็คเดิม (against_check_at) — ถ้าใบงานนั้นมีการกดตรวจใหม่
//   ภายหลัง override จะ stale อัตโนมัติและ Gate กลับมา block อีกครั้ง
// - ลง audit log ใน sickw_check/override_history[] เพื่อให้ตรวจย้อนหลังได้
//   (เก็บเฉพาะ override ที่เคยกด ไม่ลบทับของเก่า)
// =============================================================================

const SICKW_OVERRIDE_ROLES = ["CEO", "MANAGER"];

exports.submitSickwGateOverride = onCall({ region: SICKW_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }

  const { jobId, reason } = request.data || {};
  if (!jobId || typeof jobId !== "string" || /[/.#$\[\]]/.test(jobId)) {
    throw new HttpsError("invalid-argument", "jobId ไม่ถูกต้อง");
  }
  if (!reason || typeof reason !== "string" || reason.trim().length < 10) {
    throw new HttpsError("invalid-argument", "ต้องระบุเหตุผลการ override อย่างน้อย 10 ตัวอักษร");
  }
  if (reason.length > 500) {
    throw new HttpsError("invalid-argument", "เหตุผลยาวเกิน 500 ตัวอักษร");
  }

  const db = getDatabase();

  // ตรวจ role จาก staff — staff/{key} เป็น push id ไม่ใช่ uid → lookup ด้วย email
  const staff = await lookupStaffByAuth(db, request.auth) || {};
  const role = String(staff.role || "").toUpperCase();
  if (!SICKW_OVERRIDE_ROLES.includes(role)) {
    throw new HttpsError("permission-denied", `เฉพาะ ${SICKW_OVERRIDE_ROLES.join(" / ")} เท่านั้นที่ override ได้`);
  }

  // ต้องมี last_check และ flagged จริง — กันกด override ทิ้งไว้บนใบงานที่ผ่านอยู่แล้ว
  const checkSnap = await db.ref(`jobs/${jobId}/sickw_check/last_check`).once("value");
  if (!checkSnap.exists()) {
    throw new HttpsError("failed-precondition", "ใบงานนี้ยังไม่มีผลตรวจ Sickw");
  }
  const lastCheck = checkSnap.val();
  const flags = lastCheck.flags || summarizeSickwFlags(lastCheck.parsed);
  const anyFlagged = flags.fmi === "flagged" || flags.mdm === "flagged" || flags.blacklist === "flagged";
  if (!anyFlagged) {
    throw new HttpsError("failed-precondition", "ใบงานนี้ไม่ติด Gate — ไม่ต้อง override");
  }

  const overrideRecord = {
    overridden_at: Date.now(),
    overridden_by_uid: request.auth.uid,
    overridden_by_name: staff.name || staff.displayName || "Unknown",
    overridden_by_role: role,
    reason: reason.trim(),
    against_check_at: lastCheck.checked_at,
    against_imei: lastCheck.imei,
  };

  await db.ref(`jobs/${jobId}/sickw_check/override`).set(overrideRecord);
  // เก็บประวัติด้วย — push() เพื่อให้ list ทุก override ที่เคยกดบนใบงานนี้
  await db.ref(`jobs/${jobId}/sickw_check/override_history`).push(overrideRecord);

  console.log(`[sickw] gate override on job ${jobId} by ${role} ${request.auth.uid}`);
  return { ok: true, override: overrideRecord };
});

// =============================================================================
// Sickw Service Catalog: ดึง list services ที่ user มี subscription + ราคา
// (Sickw endpoint `?action=services` คืน array {service, name, price})
//
// Cache 1 ชม. ใน sickw/services_catalog เพราะ service list เปลี่ยนน้อยมาก
// ทุก admin/rider load page = ดึง cache → ไม่ burn quota
// =============================================================================

// =============================================================================
// Sickw → Job sync: ใช้ข้อมูล parsed จาก Sickw last_check ไป update
// ฟิลด์ model/capacity/color/country/imei/serial/imei2 ของใบงาน
//
// ทำไม: ลูกค้ากรอกตอนสร้างงานอาจคลาดเคลื่อน (รุ่นผิด/สีผิด/ความจุผิด)
// — Sickw ดึงข้อมูลจาก Apple database จริง → ใช้เป็น authoritative source ได้
//
// เก็บ before-snapshot ใน sickw_sync_history เผื่อ undo
// บันทึก qc_log entry "SICKW_SYNC" + ผู้ทำรายการ + ฟิลด์ที่เปลี่ยน
// =============================================================================

exports.syncJobFromSickw = onCall({ region: SICKW_REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");

  const { jobId, fields } = request.data || {};
  if (!jobId || typeof jobId !== "string" || /[/.#$\[\]]/.test(jobId)) {
    throw new HttpsError("invalid-argument", "jobId ไม่ถูกต้อง");
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new HttpsError("invalid-argument", "ต้องระบุ fields ที่จะ sync (array)");
  }

  // whitelist fields ที่อนุญาตให้ sync — กันลูกค้า inject path อื่น
  const ALLOWED_FIELDS = ["model", "capacity", "color", "country", "imei", "imei2", "serial"];
  const validFields = fields.filter((f) => ALLOWED_FIELDS.includes(f));
  if (validFields.length === 0) {
    throw new HttpsError("invalid-argument", `fields ที่อนุญาต: ${ALLOWED_FIELDS.join(", ")}`);
  }

  const db = getDatabase();

  // ตรวจ role — staff/CEO/MANAGER/STAFF + rider ก็ใช้ได้ (rider sync ตอนรับเครื่อง)
  const staff = await lookupStaffByAuth(db, request.auth);
  const actorName = staff ? (staff.name || staff.email || "Unknown") : "Unknown";
  const actorRole = staff ? String(staff.role || "STAFF").toUpperCase() : "UNKNOWN";

  const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
  if (!jobSnap.exists()) throw new HttpsError("not-found", "ไม่พบใบงาน");
  const job = jobSnap.val();

  const checkSnap = await db.ref(`jobs/${jobId}/sickw_check/last_check`).once("value");
  if (!checkSnap.exists()) {
    throw new HttpsError("failed-precondition", "ใบงานนี้ยังไม่มีผลตรวจ Sickw");
  }
  const parsed = (checkSnap.val() && checkSnap.val().parsed) || {};

  // before-snapshot สำหรับ audit
  const before = {};
  const after = {};
  const updates = {};
  for (const field of validFields) {
    const newVal = parsed[field];
    if (!newVal || String(newVal).trim() === "") continue; // ไม่ override ด้วยค่าว่าง
    before[field] = job[field] ?? null;
    after[field] = String(newVal);
    updates[`jobs/${jobId}/${field}`] = String(newVal);
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpsError("failed-precondition", "ไม่มี field ใน Sickw ที่จะ sync (ค่าว่างทั้งหมด)");
  }

  // เพิ่ม qc_log entry — append หน้าสุดของ list
  const oldLogs = Array.isArray(job.qc_logs) ? job.qc_logs : [];
  const detailLines = Object.entries(after).map(([k, v]) => {
    const old = before[k] ?? "(ว่าง)";
    return `${k}: ${old} → ${v}`;
  }).join("; ");
  const newLog = {
    action: "SICKW_SYNC",
    by: actorName,
    role: actorRole,
    timestamp: Date.now(),
    details: `Sync จาก Sickw: ${detailLines}`,
  };
  updates[`jobs/${jobId}/qc_logs`] = [newLog, ...oldLogs];
  updates[`jobs/${jobId}/updated_at`] = Date.now();

  // เก็บ history ใน sickw_sync_history เผื่อ undo
  const historyKey = db.ref("sickw_sync_history").push().key;
  updates[`sickw_sync_history/${historyKey}`] = {
    job_id: jobId,
    synced_at: Date.now(),
    synced_by_uid: request.auth.uid,
    synced_by_name: actorName,
    synced_by_role: actorRole,
    fields: validFields,
    before,
    after,
  };

  await db.ref().update(updates);

  console.log(`[sickw-sync] job ${jobId} synced ${validFields.length} field(s) by ${actorName} (${actorRole})`);
  return { ok: true, fields: validFields, before, after };
});

const SICKW_CATALOG_CACHE_KEY = "sickw/services_catalog";
const SICKW_CATALOG_TTL_MS = 60 * 60 * 1000; // 1h
const SICKW_BALANCE_CACHE_KEY = "sickw/balance_cache";
const SICKW_BALANCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

exports.listSickwServices = onCall({ region: SICKW_REGION, timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const apiKey = process.env.SICKW_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "ระบบยังไม่ได้ตั้งค่า Sickw API Key");

  const forceRefresh = !!(request.data && request.data.forceRefresh);
  const db = getDatabase();

  if (!forceRefresh) {
    const cacheSnap = await db.ref(SICKW_CATALOG_CACHE_KEY).once("value");
    if (cacheSnap.exists()) {
      const cached = cacheSnap.val();
      if (cached.cached_at && Date.now() - cached.cached_at < SICKW_CATALOG_TTL_MS) {
        return { cached: true, services: cached.services || [], cachedAt: cached.cached_at };
      }
    }
  }

  const url = `${SICKW_ENDPOINT}?action=services&key=${encodeURIComponent(apiKey)}`;
  let parsed;
  try {
    const resp = await fetch(url);
    const text = await resp.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HttpsError("internal", `Sickw services: non-JSON: ${text.slice(0, 120)}`);
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", `เรียก services ไม่สำเร็จ: ${e?.message || e}`);
  }

  // Sickw shape: { "Service List": [{service, name, price}] }
  const list = parsed["Service List"] || parsed.services || parsed.result || [];
  const services = (Array.isArray(list) ? list : []).map((s) => ({
    service: String(s.service),
    name: String(s.name || ""),
    price: Number(s.price || 0),
  })).filter((s) => /^\d+$/.test(s.service));

  await db.ref(SICKW_CATALOG_CACHE_KEY).set({ cached_at: Date.now(), services });

  return { cached: false, services, cachedAt: Date.now() };
});

exports.getSickwBalance = onCall({ region: SICKW_REGION, timeoutSeconds: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const apiKey = process.env.SICKW_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "ระบบยังไม่ได้ตั้งค่า Sickw API Key");

  const forceRefresh = !!(request.data && request.data.forceRefresh);
  const db = getDatabase();

  if (!forceRefresh) {
    const cacheSnap = await db.ref(SICKW_BALANCE_CACHE_KEY).once("value");
    if (cacheSnap.exists()) {
      const cached = cacheSnap.val();
      if (cached.cached_at && Date.now() - cached.cached_at < SICKW_BALANCE_TTL_MS) {
        return { cached: true, balance: cached.balance, cachedAt: cached.cached_at };
      }
    }
  }

  const url = `${SICKW_ENDPOINT}?action=balance&key=${encodeURIComponent(apiKey)}`;
  let balance;
  try {
    const resp = await fetch(url);
    const text = (await resp.text()).trim();
    // ตอบกลับเป็นตัวเลขล้วนๆ (เช่น "878.75") หรือ JSON
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      balance = numeric;
    } else {
      try {
        const parsed = JSON.parse(text);
        balance = Number(parsed.balance || parsed.result || parsed);
      } catch {
        throw new HttpsError("internal", `Sickw balance: ตอบกลับไม่เข้าใจ: ${text.slice(0, 80)}`);
      }
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", `เรียก balance ไม่สำเร็จ: ${e?.message || e}`);
  }

  await db.ref(SICKW_BALANCE_CACHE_KEY).set({ cached_at: Date.now(), balance });
  return { cached: false, balance, cachedAt: Date.now() };
});

// =============================================================================
// Sickw Bundle Check: ยิงหลาย service พร้อมกันบน IMEI เดียวกัน → merge ผล
//
// ใช้สำหรับเคสที่ admin/rider ต้องการเช็คครบ (model+capacity+country+FMI+
// iCloud+blacklist+MDM) — ทำใน Cloud Function เพื่อ:
//   1. ลด round-trip จาก client (1 callable vs N callable)
//   2. Server-side cache hit ใช้ของเดิมถ้ามี (กัน user spam burn credit)
//   3. รวม flags ทั้งหมด → snapshot เดียวบนใบงาน → Gate ดู source-of-truth
//
// Cost = sum(prices ของทุก service ที่ไม่ใช่ cache-hit)
// =============================================================================

exports.checkDeviceWithSickwBundle = onCall({ region: SICKW_REGION, timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const apiKey = process.env.SICKW_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "ระบบยังไม่ได้ตั้งค่า Sickw API Key");

  const { imei, serviceIds, forceRefresh, jobId, source } = request.data || {};
  if (!imei || typeof imei !== "string") throw new HttpsError("invalid-argument", "ต้องระบุ IMEI / Serial");
  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new HttpsError("invalid-argument", "ต้องระบุ serviceIds (array) อย่างน้อย 1 ตัว");
  }
  if (serviceIds.length > 10) {
    // กันยิงทีเดียวมากเกินไป (cost protection)
    throw new HttpsError("invalid-argument", "เลือกได้สูงสุด 10 service ต่อครั้ง");
  }
  if (jobId != null && (typeof jobId !== "string" || jobId.length > 128 || /[/.#$\[\]]/.test(jobId))) {
    throw new HttpsError("invalid-argument", "jobId ไม่ถูกต้อง");
  }

  const cleanImei = imei.trim().toUpperCase();
  if (!/^[A-Z0-9]{8,17}$/.test(cleanImei)) {
    throw new HttpsError("invalid-argument", "IMEI / Serial ไม่ถูกต้อง");
  }

  const cleanSvcIds = serviceIds.map((s) => String(s).trim()).filter((s) => /^\d{1,4}$/.test(s));
  if (cleanSvcIds.length === 0) throw new HttpsError("invalid-argument", "serviceIds ทุกตัวต้องเป็นตัวเลข");

  const db = getDatabase();

  // ยิงทุก service พร้อมกัน — แต่ละตัวเช็ค cache ตัวเอง
  // (ใช้ logic เดียวกับ checkDeviceWithSickw แต่ inline เพื่อ parallel ได้)
  const results = await Promise.all(cleanSvcIds.map(async (svcId) => {
    const cacheRef = db.ref(`device_checks/${cleanImei}/svc_${svcId}`);

    if (!forceRefresh) {
      const cacheSnap = await cacheRef.once("value");
      if (cacheSnap.exists()) {
        const cached = cacheSnap.val();
        if (cached.checked_at && Date.now() - cached.checked_at < SICKW_CACHE_TTL_MS) {
          const reparsed = parseSickwResult(cached.raw || "");
          return {
            serviceId: svcId,
            cached: true,
            checkedAt: cached.checked_at,
            status: cached.status,
            parsed: reparsed.parsed,
            fields: reparsed.fields,
            raw: cached.raw || "",
          };
        }
      }
    }

    const url = `${SICKW_ENDPOINT}?format=JSON&key=${encodeURIComponent(apiKey)}&imei=${encodeURIComponent(cleanImei)}&service=${encodeURIComponent(svcId)}`;
    let sickwResp;
    try {
      const httpResp = await fetch(url);
      const text = await httpResp.text();
      try { sickwResp = JSON.parse(text); }
      catch { return { serviceId: svcId, error: `non-JSON: ${text.slice(0, 100)}` }; }
    } catch (e) {
      return { serviceId: svcId, error: `fetch failed: ${e?.message || e}` };
    }

    const status = String(sickwResp.status || "unknown").toLowerCase();
    const raw = typeof sickwResp.result === "string" ? sickwResp.result : JSON.stringify(sickwResp.result || sickwResp);
    const { parsed, fields } = parseSickwResult(raw);

    const record = {
      checked_at: Date.now(),
      checked_by_uid: request.auth.uid,
      service_id: svcId,
      imei: cleanImei,
      status,
      raw,
      parsed,
      fields,
    };
    try { await cacheRef.set(record); } catch (e) { console.warn("[sickw bundle] cache write failed:", e?.message || e); }

    return {
      serviceId: svcId,
      cached: false,
      checkedAt: record.checked_at,
      status,
      parsed,
      fields,
      raw,
    };
  }));

  // Merge ผล — รวม parsed (worst-case: ค่าที่ใหม่กว่าทับ), fields (รวมหมด)
  const mergedParsed = {};
  const mergedFields = {};
  const perService = {};
  let hasAnySuccess = false;
  for (const r of results) {
    perService[r.serviceId] = r;
    if (r.error) continue;
    if (r.status === "success") hasAnySuccess = true;
    Object.assign(mergedFields, r.fields || {});
    // first-non-empty wins per parsed key (ป้องกัน service หลังเขียนทับ
    // ของที่ดีกว่า เช่น service Carrier มี model ครบ ตามด้วย FMI ที่ไม่มี
    // model จะทับเป็น undefined)
    for (const [k, v] of Object.entries(r.parsed || {})) {
      if (v && !mergedParsed[k]) mergedParsed[k] = v;
    }
  }

  // คำนวณ flag รวม — ถ้า service ไหนบอกว่า flagged → flagged, clean+unknown → clean
  const flags = summarizeSickwFlags(mergedParsed);

  // เขียน snapshot ลงใบงาน (ใช้ checked_at ล่าสุด)
  const latestCheckedAt = Math.max(...results.filter((r) => r.checkedAt).map((r) => r.checkedAt), 0) || Date.now();
  if (jobId) {
    try {
      await db.ref(`jobs/${jobId}/sickw_check`).update({
        last_check: {
          checked_at: latestCheckedAt,
          checked_by_uid: request.auth.uid,
          // bundle เก็บเป็น csv ของ service ids ที่เรียก
          service_id: cleanSvcIds.join(","),
          imei: cleanImei,
          status: hasAnySuccess ? "success" : "error",
          parsed: mergedParsed,
          fields: mergedFields,
          raw: results.map((r) => `[svc_${r.serviceId}] ${r.raw || r.error || ""}`).join("\n"),
          flags,
          bundle: true,
        },
      });
    } catch (e) {
      console.warn(`[sickw bundle] writeJobSnapshot(${jobId}) failed:`, e?.message || e);
    }
  }

  // คำนวณ credit_used รวม — เฉพาะ service ที่ไม่ใช่ cache-hit
  let totalCredit = 0;
  const cachedFlags = [];
  try {
    const catalogSnap = await db.ref(SICKW_CATALOG_CACHE_KEY).once("value");
    const cat = catalogSnap.exists() ? catalogSnap.val() : { services: [] };
    for (const svcId of cleanSvcIds) {
      const r = perService[svcId];
      const isCached = !!(r && r.cached);
      cachedFlags.push(isCached);
      if (!isCached) {
        const found = (cat.services || []).find((s) => String(s.service) === svcId);
        if (found) totalCredit += Number(found.price || 0);
      }
    }
  } catch (_) { /* ignore */ }

  await recordSickwUsage(db, {
    uid: request.auth.uid,
    authToken: request.auth.token,
    imei: cleanImei,
    serviceIds: cleanSvcIds,
    jobId,
    cached: cachedFlags,
    creditUsed: totalCredit,
    status: hasAnySuccess ? "success" : "error",
    source: source || "unknown",
  });

  return {
    ok: hasAnySuccess,
    bundle: true,
    checkedAt: latestCheckedAt,
    imei: cleanImei,
    serviceIds: cleanSvcIds,
    parsed: mergedParsed,
    fields: mergedFields,
    flags,
    perService,
  };
});

// =============================================================================
// Daily Sickw Usage Summary (Scheduled): รัน 8:00 น. ทุกวัน
// รวมยอด audit log ของเมื่อวาน → ส่ง push ให้ CEO ถ้าเกิน threshold
//
// Threshold (อ่านจาก settings/sickw/alert_thresholds):
//   - per_user_checks_per_day: default 20
//   - per_user_credit_per_day: default 5 (USD)
//   - flagged_no_jobid_per_day: default 5 (กรณีกดตรวจโดยไม่ผูกใบงาน)
//
// Summary เก็บที่ sickw_usage_daily/{YYYY-MM-DD}/{uid} เผื่อ admin ดูย้อน
// =============================================================================

const SICKW_ALERT_DEFAULTS = {
  per_user_checks_per_day: 20,
  per_user_credit_per_day: 5,
  flagged_no_jobid_per_day: 5,
};

exports.dailySickwUsageSummary = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Bangkok", region: SICKW_REGION },
  async () => {
    const db = getDatabase();

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
    const dd = String(yesterday.getDate()).padStart(2, "0");
    const dateKey = `${yyyy}-${mm}-${dd}`;

    // bound ของวันเมื่อวาน (Asia/Bangkok)
    const startOfYesterday = new Date(yyyy, yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0).getTime();
    const endOfYesterday = startOfYesterday + 24 * 60 * 60 * 1000;

    // โหลด audit log ของเมื่อวาน
    const usageSnap = await db.ref("sickw_usage")
      .orderByChild("timestamp")
      .startAt(startOfYesterday)
      .endAt(endOfYesterday - 1)
      .once("value");

    const perUser = {};
    let totalChecks = 0;
    let totalCredit = 0;
    usageSnap.forEach((snap) => {
      const e = snap.val();
      if (!e || !e.uid) return;
      const u = perUser[e.uid] = perUser[e.uid] || {
        uid: e.uid,
        name: e.name || "Unknown",
        role: e.role || "UNKNOWN",
        checks: 0,
        credit: 0,
        no_job_id: 0,
      };
      u.checks += 1;
      u.credit += Number(e.credit_used || 0);
      if (!e.job_id) u.no_job_id += 1;
      totalChecks += 1;
      totalCredit += Number(e.credit_used || 0);
    });

    const userList = Object.values(perUser);
    // เก็บ summary
    await db.ref(`sickw_usage_daily/${dateKey}`).set({
      date: dateKey,
      computed_at: Date.now(),
      total_checks: totalChecks,
      total_credit: Number(totalCredit.toFixed(4)),
      per_user: userList,
    });
    console.log(`[sickw-daily] ${dateKey}: ${totalChecks} checks, $${totalCredit.toFixed(2)}, ${userList.length} users`);

    // หา anomaly — เกิน threshold ก็ส่ง push ให้ CEO
    const thresholdSnap = await db.ref("settings/sickw/alert_thresholds").once("value");
    const t = { ...SICKW_ALERT_DEFAULTS, ...(thresholdSnap.exists() ? thresholdSnap.val() : {}) };

    const offenders = userList.filter((u) =>
      u.checks > Number(t.per_user_checks_per_day) ||
      u.credit > Number(t.per_user_credit_per_day) ||
      u.no_job_id > Number(t.flagged_no_jobid_per_day)
    );
    if (offenders.length === 0) return;

    const lines = offenders.map((u) =>
      `${u.name} (${u.role}): ${u.checks} checks, $${u.credit.toFixed(2)}` +
      (u.no_job_id > 0 ? `, ${u.no_job_id} ไม่ผูกใบงาน` : "")
    );
    const body = `${dateKey}\n${lines.join("\n")}`;

    // ส่ง push ให้ admin ทุก token — staff/ ใช้ push id เป็น key ส่วน
    // admin_fcm_tokens/ ใช้ Firebase UID เป็น key (ไม่ match กับ staff key ตรงๆ)
    // จึง filter ฝั่ง CEO ไม่ได้ง่ายๆ — ส่งให้ทุก admin device แทน เพราะ
    // คนที่ใส่ FCM token ใน admin_fcm_tokens คือ admin ของระบบทั้งหมดอยู่แล้ว
    try {
      const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
      const tokens = [];
      tokensSnap.forEach((adminSnap) => {
        adminSnap.forEach((tokenSnap) => {
          const t = tokenSnap.val();
          if (t && t.token) tokens.push(t.token);
        });
      });

      if (tokens.length === 0) {
        console.warn("[sickw-daily] no admin FCM tokens — skipping push");
        return;
      }

      await getMessaging().sendEachForMulticast({
        tokens,
        notification: {
          title: `⚠️ Sickw usage alert — ${offenders.length} user${offenders.length > 1 ? "s" : ""}`,
          body,
        },
        data: { type: "sickw_usage_alert", date: dateKey },
        webpush: { fcmOptions: { link: "/sickw-usage" } },
      });
      console.log(`[sickw-daily] alerted ${tokens.length} CEO device(s) about ${offenders.length} offenders`);
    } catch (e) {
      console.error("[sickw-daily] push failed:", e?.message || e);
    }
  }
);
