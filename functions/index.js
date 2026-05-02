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

const DEFAULT_RIDER_TIME_LOSS_FEE = 100;

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
        const fee = (riderCompensation && typeof riderCompensation.customer_cancel_time_loss === "number")
          ? riderCompensation.customer_cancel_time_loss
          : DEFAULT_RIDER_TIME_LOSS_FEE;
        u[`${jobBase}/rider_fee`] = fee;
        u[`${jobBase}/rider_fee_status`] = "Pending";
        u[`${jobBase}/rider_fee_breakdown`] = {
          type: "time_loss_customer_cancel",
          amount: fee,
          reason: `ลูกค้ายกเลิกระหว่างทาง (status: ${job.status}) — ค่าเสียเวลาไรเดอร์`,
          computed_at: now,
          source: riderCompensation ? "settings" : "default",
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

    await pushToRider(
      db,
      am.requested_by_rider_uid,
      {
        notification: {
          title: "✅ Admin อนุมัติ — ขอลายเซ็นลูกค้า",
          body: `เปิดงาน #${shortJobId(am.job_id)} เพื่อให้ลูกค้าเซ็นยืนยัน`,
        },
        data: { type: "amendment_approved", amendmentId, jobId: am.job_id },
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
