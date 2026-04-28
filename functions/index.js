const { onValueCreated, onValueUpdated, onValueWritten } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
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
 */
exports.migrateOldJobs = onRequest(
  { region: "asia-southeast1", cors: true },
  async (req, res) => {
    const result = await runArchive();
    res.json({
      success: true,
      message: `Archived ${result.archived} old jobs`,
      ...result,
    });
  }
);

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
