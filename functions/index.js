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

  let tokenIdx = 0;
  for (const result of results) {
    result.responses.forEach((resp, idx) => {
      if (resp.error) {
        const meta = tokenMeta[tokenIdx + idx];
        if (
          (resp.error.code === "messaging/registration-token-not-registered" ||
            resp.error.code === "messaging/invalid-registration-token") &&
          meta
        ) {
          db.ref(`admin_fcm_tokens/${meta.staffId}/${meta.tokenKey}`).remove();
          console.log(`[${tag}] Cleaned up expired token: ${meta.staffId}/${meta.tokenKey}`);
        }
      }
    });
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

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify(body),
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
    console.error("[routesApi] Fetch failed:", err);
    return { error: "fetch_exception" };
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

      // คำนวณ rider_fee_estimate ทันทีตอนสร้างงาน เพื่อให้ไรเดอร์เห็นก่อนรับงาน
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

      // เฉพาะ ticket ใหม่ (New Lead / New B2B Lead / Active Lead).
      // Accept both legacy "Active Leads" (plural) and the canonical
      // "Active Lead" so the trigger keeps firing through Phase 2D's
      // writer rename. functions/ can't import the canonical TS enum.
      const newStatuses = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead"];
      if (!newStatuses.includes(job.status)) {
        console.log(`[onNewTicket] Skipped: status="${job.status}" not in ${JSON.stringify(newStatuses)}`);
        return;
      }

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
  Cancelled: "ยกเลิกงาน",
  "Closed (Lost)": "ปิดงาน (Lost)",
  Returned: "ตีเครื่องกลับ",
  "Return Confirmed": "ตีเครื่องกลับ", // canonical of "Returned"
  "Withdrawal Requested": "ขอถอนเงิน",
  "Revised Offer": "เสนอราคาใหม่",
  Negotiation: "ลูกค้าต่อราคา",
  "Price Accepted": "ลูกค้ารับราคา",
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
};

exports.onJobStatusChanged = onValueUpdated(
  {
    ref: "/jobs/{jobId}/status",
    region: "asia-southeast1",
  },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();

    // สถานะไม่เปลี่ยน หรือไม่ใช่สถานะที่ต้องแจ้ง
    if (before === after) return;
    if (!NOTIFY_STATUS_MAP[after]) return;

    const jobId = event.params.jobId;
    const db = getDatabase();

    // ดึงข้อมูล job เพื่อแสดงในข้อความ
    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) return;
    const job = jobSnap.val();

    const model = job.model || "ไม่ระบุรุ่น";
    const custName = job.cust_name || "";
    const statusLabel = NOTIFY_STATUS_MAP[after];
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
    if (after !== "Pending QC") return;

    const jobId = event.params.jobId;
    const db = getDatabase();

    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) {
      console.warn(`[riderFee] Job ${jobId} not found`);
      return;
    }
    const job = jobSnap.val();

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

/** Send a single push to the rider's FCM token (stored at /riders/{uid}/fcm_token).
 *  No-op if rider has no token saved. Errors are logged but not thrown — push
 *  failures must not block the database operation that triggered them. */
async function pushToRider(db, riderUid, message, tag) {
  try {
    const tokenSnap = await db.ref(`riders/${riderUid}/fcm_token`).once("value");
    const token = tokenSnap.val();
    if (!token) {
      console.warn(`[${tag}] Rider ${riderUid} has no fcm_token`);
      return;
    }
    await getMessaging().send({ token, ...message });
    console.log(`[${tag}] Delivered to rider ${riderUid}`);
  } catch (err) {
    console.error(`[${tag}] Push to rider ${riderUid} failed:`, err);
  }
}

function shortJobId(id) {
  return (id || "").slice(-4).toUpperCase() || "????";
}

exports.requestAmendment = onCall({ region: AMENDMENT_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const { jobId, type, riderNote, evidenceUrls } = request.data || {};
  if (!jobId || typeof jobId !== "string") {
    throw new HttpsError("invalid-argument", "ต้องระบุ jobId");
  }
  if (type !== "device_mismatch") {
    throw new HttpsError("invalid-argument", "type ไม่รองรับใน Phase 1");
  }
  if (!Array.isArray(evidenceUrls) || evidenceUrls.length < 1) {
    throw new HttpsError("invalid-argument", "ต้องมีรูปประกอบอย่างน้อย 1 รูป");
  }
  for (const url of evidenceUrls) {
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
      throw new HttpsError("invalid-argument", "evidenceUrls ต้องเป็น https URL");
    }
  }
  if (riderNote && (typeof riderNote !== "string" || riderNote.length > 500)) {
    throw new HttpsError("invalid-argument", "riderNote ยาวเกิน 500 ตัวอักษร");
  }

  const db = getDatabase();

  const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
  if (!jobSnap.exists()) {
    throw new HttpsError("not-found", "ไม่พบงาน");
  }
  const job = jobSnap.val();
  if (job.rider_id !== request.auth.uid) {
    throw new HttpsError("permission-denied", "ไม่ใช่ rider ของ job นี้");
  }

  // Reject if there's already a pending amendment on this job — one at a time
  const existing = await db.ref("jobs_amendments")
    .orderByChild("job_id").equalTo(jobId).once("value");
  let hasPending = false;
  existing.forEach((s) => {
    if (s.val().status === "pending" || s.val().status === "approved") hasPending = true;
  });
  if (hasPending) {
    throw new HttpsError("failed-precondition", "มี amendment ค้างอยู่บน job นี้แล้ว");
  }

  const before = {
    devices: job.devices || [],
    final_price: typeof job.final_price === "number" ? job.final_price :
                 typeof job.price === "number" ? job.price : 0,
  };

  const newRef = db.ref("jobs_amendments").push();
  const amendmentId = newRef.key;

  const riderSnap = await db.ref(`riders/${request.auth.uid}`).once("value");
  const riderName = (riderSnap.val() && riderSnap.val().name) || job.rider_name || "Rider";

  const amendment = {
    id: amendmentId,
    job_id: jobId,
    type,
    requested_at: Date.now(),
    requested_by_rider_uid: request.auth.uid,
    requested_by_rider_name: riderName,
    rider_note: riderNote || "",
    evidence_urls: evidenceUrls,
    before,
    status: "pending",
  };

  await newRef.set(amendment);

  await dispatchAmendmentPush(
    db,
    {
      notification: {
        title: "🚨 Rider ขอแก้ไข — รอ admin อนุมัติ",
        body: `${riderName} แจ้งปัญหา job #${shortJobId(jobId)}: ${riderNote || "ดูรายละเอียด"}`,
      },
      data: { type: "amendment_requested", amendmentId, jobId },
    },
    job.agent_uid,
    "amendment-requested"
  );

  return { ok: true, amendmentId };
});

exports.reviewAmendment = onCall({ region: AMENDMENT_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const { amendmentId, decision, after, adminNote, rejectAction } = request.data || {};
  if (!amendmentId || (decision !== "approve" && decision !== "reject")) {
    throw new HttpsError("invalid-argument", "amendmentId / decision ไม่ถูกต้อง");
  }
  if (adminNote && (typeof adminNote !== "string" || adminNote.length > 500)) {
    throw new HttpsError("invalid-argument", "adminNote ยาวเกิน 500 ตัวอักษร");
  }

  const db = getDatabase();
  const adminSnap = await db.ref(`admins/${request.auth.uid}`).once("value");
  if (!adminSnap.exists() || adminSnap.val().role !== "admin") {
    throw new HttpsError("permission-denied", "เฉพาะ admin");
  }

  const amSnap = await db.ref(`jobs_amendments/${amendmentId}`).once("value");
  if (!amSnap.exists()) {
    throw new HttpsError("not-found", "ไม่พบ amendment");
  }
  const am = amSnap.val();
  if (am.status !== "pending") {
    throw new HttpsError("failed-precondition", `amendment status=${am.status}`);
  }

  const adminName = adminSnap.val().name || adminSnap.val().display_name || "Admin";
  const updates = {
    reviewed_at: Date.now(),
    reviewed_by_admin_uid: request.auth.uid,
    reviewed_by_admin_name: adminName,
    admin_note: adminNote || "",
  };

  if (decision === "approve") {
    if (
      !after ||
      !Array.isArray(after.devices) ||
      after.devices.length < 1 ||
      typeof after.final_price !== "number"
    ) {
      throw new HttpsError("invalid-argument", "after snapshot ต้องครบ (devices + final_price)");
    }
    updates.status = "approved";
    updates.after = {
      devices: after.devices,
      final_price: after.final_price,
    };
  } else {
    const allowed = ["continue_original", "cancel_job", "wait_admin_call"];
    if (!allowed.includes(rejectAction)) {
      throw new HttpsError("invalid-argument", `rejectAction ต้องเป็น ${allowed.join("/")}`);
    }
    updates.status = "rejected";
    updates.reject_action = rejectAction;
    if (rejectAction === "cancel_job") {
      // Atomic: amendment+job both updated together
      const now = Date.now();
      await db.ref().update({
        ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [`jobs_amendments/${amendmentId}/${k}`, v])),
        [`jobs/${am.job_id}/status`]: "Cancelled",
        [`jobs/${am.job_id}/cancel_category`]: "amendment_rejected",
        [`jobs/${am.job_id}/cancel_reason`]: adminNote || "Admin ปฏิเสธ amendment + ขอยกเลิก job",
        [`jobs/${am.job_id}/cancelled_at`]: now,
        [`jobs/${am.job_id}/updated_at`]: now,
      });
      await pushToRider(
        db,
        am.requested_by_rider_uid,
        {
          notification: {
            title: "❌ Admin ยกเลิก job",
            body: adminNote || `แจ้งลูกค้าและกลับได้เลย — job #${shortJobId(am.job_id)}`,
          },
          data: { type: "amendment_rejected", amendmentId, jobId: am.job_id, rejectAction },
        },
        "amendment-rejected-cancel"
      );
      return { ok: true };
    }
  }

  await db.ref(`jobs_amendments/${amendmentId}`).update(updates);

  const riderTitle = decision === "approve"
    ? "✅ Admin อนุมัติ — ขอลายเซ็นลูกค้า"
    : (rejectAction === "wait_admin_call"
        ? "⏸ Admin จะติดต่อลูกค้าเอง"
        : "❌ Admin ปฏิเสธ — ทำงานต่อตาม original");
  const riderBody = decision === "approve"
    ? `เปิดงาน #${shortJobId(am.job_id)} เพื่อให้ลูกค้าเซ็นยืนยัน`
    : (adminNote || (rejectAction === "wait_admin_call"
        ? "รอที่จุดรับ — admin จะแจ้งคำสั่งใหม่"
        : `รับเครื่องตาม spec เดิมเท่านั้น — job #${shortJobId(am.job_id)}`));

  await pushToRider(
    db,
    am.requested_by_rider_uid,
    {
      notification: { title: riderTitle, body: riderBody },
      data: { type: `amendment_${updates.status}`, amendmentId, jobId: am.job_id, rejectAction: rejectAction || "" },
    },
    `amendment-${updates.status}`
  );

  return { ok: true };
});

exports.consentAmendment = onCall({ region: AMENDMENT_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  }
  const { amendmentId, signatureUrl } = request.data || {};
  if (!amendmentId || !signatureUrl || typeof signatureUrl !== "string") {
    throw new HttpsError("invalid-argument", "amendmentId/signatureUrl ไม่ครบ");
  }
  if (!/^https?:\/\//.test(signatureUrl)) {
    throw new HttpsError("invalid-argument", "signatureUrl ต้องเป็น https URL");
  }

  const db = getDatabase();
  const amSnap = await db.ref(`jobs_amendments/${amendmentId}`).once("value");
  if (!amSnap.exists()) {
    throw new HttpsError("not-found", "ไม่พบ amendment");
  }
  const am = amSnap.val();
  if (am.status !== "approved") {
    throw new HttpsError("failed-precondition", `amendment status=${am.status}`);
  }
  if (am.requested_by_rider_uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "เฉพาะ rider ของ amendment");
  }
  if (!am.after || !Array.isArray(am.after.devices)) {
    throw new HttpsError("internal", "amendment.after ขาด — admin approve ผิดพลาด");
  }

  const now = Date.now();

  // Append qc_log: pull current logs first since RTDB doesn't have arrayUnion
  const jobSnap = await db.ref(`jobs/${am.job_id}`).once("value");
  if (!jobSnap.exists()) {
    throw new HttpsError("not-found", "ไม่พบ job ที่จะ apply");
  }
  const job = jobSnap.val();
  const updatedLogs = [
    {
      action: "Amendment Applied",
      by: `Rider: ${am.requested_by_rider_name}`,
      timestamp: now,
      details: `เปลี่ยน devices/ราคา ตาม amendment ${amendmentId} (admin: ${am.reviewed_by_admin_name || "?"})`,
    },
    ...(job.qc_logs || []),
  ];

  // Atomic multi-path update
  await db.ref().update({
    [`jobs_amendments/${amendmentId}/status`]: "applied",
    [`jobs_amendments/${amendmentId}/consented_at`]: now,
    [`jobs_amendments/${amendmentId}/consent_method`]: "signature",
    [`jobs_amendments/${amendmentId}/consent_signature_url`]: signatureUrl,
    [`jobs_amendments/${amendmentId}/applied_at`]: now,
    [`jobs/${am.job_id}/devices`]: am.after.devices,
    [`jobs/${am.job_id}/final_price`]: am.after.final_price,
    [`jobs/${am.job_id}/qc_logs`]: updatedLogs,
    [`jobs/${am.job_id}/updated_at`]: now,
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
