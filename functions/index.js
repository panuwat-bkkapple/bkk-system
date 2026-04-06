const { onValueCreated, onValueUpdated, onValueWritten } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

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

      // เฉพาะ ticket ใหม่ (New Lead / New B2B Lead / Active Leads จาก Instant Sell)
      const newStatuses = ["New Lead", "New B2B Lead", "Active Leads"];
      if (!newStatuses.includes(job.status)) {
        console.log(`[onNewTicket] Skipped: status="${job.status}" not in ${JSON.stringify(newStatuses)}`);
        return;
      }

      const jobId = event.params.jobId;
      const model = job.model || "ไม่ระบุรุ่น";
      const price = job.price ? `฿${Number(job.price).toLocaleString()}` : "";
      const method = job.receive_method || "";
      const custName = job.cust_name || "";
      const isB2B = job.status === "New B2B Lead";

      const title = isB2B ? "📦 New B2B Ticket!" : "📱 Ticket ใหม่เข้ามา!";
      const body = `${model} ${price} ${custName ? `- ${custName}` : ""} ${method ? `(${method})` : ""}`.trim();

      console.log(`[onNewTicket] Job ${jobId}: status="${job.status}", model="${model}"`);

      // ดึง FCM tokens ของ admin ทุกคน
      const db = getDatabase();
      const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
      if (!tokensSnap.exists()) {
        console.warn("[onNewTicket] No tokens in admin_fcm_tokens — nobody to notify");
        return;
      }

      const tokens = [];
      const tokenMeta = []; // เก็บ staffId+tokenKey สำหรับ cleanup
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
        console.warn("[onNewTicket] Found token entries but all empty — nobody to notify");
        return;
      }

      console.log(`[onNewTicket] Found ${tokens.length} token(s) to notify`);

      // ส่ง FCM multicast
      const messaging = getMessaging();
      const message = {
        notification: { title, body },
        data: {
          jobId,
          type: "new_ticket",
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
              alert: { title, body },
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
          notification: {
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            vibrate: [200, 100, 200, 100, 200],
            requireInteraction: true,
            renotify: true,
            actions: [
              { action: "open", title: "เปิดดู" },
              { action: "dismiss", title: "ปิด" },
            ],
          },
          fcmOptions: {
            link: `/tickets`,
          },
        },
      };

      // ส่งทีละ batch (FCM limit 500 tokens/batch)
      const batches = [];
      for (let i = 0; i < tokens.length; i += 500) {
        const batch = tokens.slice(i, i + 500);
        batches.push(
          messaging.sendEachForMulticast({ ...message, tokens: batch })
        );
      }

      const results = await Promise.all(batches);

      // Log + cleanup tokens ที่ใช้ไม่ได้
      let tokenIdx = 0;
      for (const result of results) {
        result.responses.forEach((resp, idx) => {
          const actualIdx = tokenIdx + idx;
          if (resp.error) {
            const meta = tokenMeta[actualIdx];
            console.error(
              `[onNewTicket] Token FAILED: staff=${meta?.staffId}, error=${resp.error.code || resp.error.message}`
            );
            if (
              resp.error.code === "messaging/registration-token-not-registered" ||
              resp.error.code === "messaging/invalid-registration-token"
            ) {
              if (meta) {
                db.ref(`admin_fcm_tokens/${meta.staffId}/${meta.tokenKey}`).remove();
                console.log(`[onNewTicket] Cleaned up expired token: ${meta.staffId}/${meta.tokenKey}`);
              }
            }
          }
        });
        tokenIdx += result.responses.length;
      }

      const successCount = results.reduce((acc, r) => acc + r.successCount, 0);
      const failCount = tokens.length - successCount;
      console.log(`[onNewTicket] Done: ${successCount} success, ${failCount} failed, ${tokens.length} total`);
    } catch (err) {
      console.error("[onNewTicket] Unhandled error:", err);
    }
  }
);

/**
 * Cloud Function: ส่ง Push Notification เมื่อมีข้อความแชทใหม่ในงาน
 * Trigger: เมื่อมีข้อมูลใหม่ถูกเขียนลง /jobs/{jobId}/chats/{chatId}
 * - ถ้า sender เป็น admin/customer → แจ้ง rider ที่ได้รับมอบหมาย
 * - ถ้า sender เป็น rider → แจ้ง admin ทุกคน
 * ใช้ collapseKey + apns-collapse-id เพื่อป้องกัน notification ซ้ำ
 */
exports.onChatMessageCreated = onValueCreated(
  {
    ref: "/jobs/{jobId}/chats/{chatId}",
    region: "asia-southeast1",
  },
  async (event) => {
    const chat = event.data.val();
    if (!chat) return;

    const { jobId } = event.params;
    const sender = chat.sender || "";
    const senderName = chat.senderName || sender;
    const text = chat.text || "";
    const imageUrl = chat.imageUrl || "";

    const db = getDatabase();
    const messaging = getMessaging();

    // ดึงข้อมูล job เพื่อหา rider_id และ model
    const jobSnap = await db.ref(`jobs/${jobId}`).once("value");
    if (!jobSnap.exists()) return;
    const job = jobSnap.val();

    if (sender === "rider") {
      // Rider ส่งข้อความ → แจ้ง admin ทุกคน
      const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
      if (!tokensSnap.exists()) return;

      const tokens = [];
      tokensSnap.forEach((staffSnap) => {
        staffSnap.forEach((tokenSnap) => {
          const data = tokenSnap.val();
          if (data && data.token) tokens.push(data.token);
        });
      });

      if (tokens.length === 0) return;

      const title = `💬 ${senderName}`;
      const body = imageUrl ? "📷 ส่งรูปภาพ" : text;
      const collapseKey = `chat-${jobId}`;

      const message = {
        notification: { title, body },
        data: { jobId, type: "chat_message", sender },
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
              alert: { title, body },
              sound: "default",
            },
          },
        },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "86400",
          },
          notification: {
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            tag: collapseKey,
            vibrate: [200, 100, 200],
            renotify: true,
          },
        },
      };

      const batches = [];
      for (let i = 0; i < tokens.length; i += 500) {
        batches.push(
          messaging.sendEachForMulticast({
            ...message,
            tokens: tokens.slice(i, i + 500),
          })
        );
      }
      const results = await Promise.all(batches);
      const successCount = results.reduce((a, r) => a + r.successCount, 0);
      console.log(`Chat notif (rider→admin): ${successCount}/${tokens.length} devices`);
    } else {
      // Admin หรือ Customer ส่งข้อความ → แจ้ง rider
      const riderId = job.rider_id;
      if (!riderId) return;

      const riderSnap = await db.ref(`riders/${riderId}`).once("value");
      if (!riderSnap.exists()) return;
      const rider = riderSnap.val();
      const riderToken = rider.fcm_token;
      if (!riderToken) return;

      const senderLabel = sender === "admin" ? "แอดมิน" : "ลูกค้า";
      const title = `💬 ${senderLabel}`;
      const body = imageUrl ? "📷 ส่งรูปภาพ" : text;
      const collapseKey = `chat-${jobId}`;

      try {
        await messaging.send({
          token: riderToken,
          notification: { title, body },
          data: { jobId, type: "chat_message", sender },
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
                alert: { title, body },
                sound: "default",
              },
            },
          },
        });
        console.log(`Chat notif (${sender}→rider ${riderId}): sent`);
      } catch (err) {
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token"
        ) {
          await db.ref(`riders/${riderId}/fcm_token`).remove();
          console.log(`Removed invalid FCM token for rider ${riderId}`);
        } else {
          console.error(`Failed to send chat notif to rider ${riderId}:`, err);
        }
      }
    }
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
 */
const NOTIFY_STATUS_MAP = {
  Cancelled: "ยกเลิกงาน",
  "Closed (Lost)": "ปิดงาน (Lost)",
  Returned: "ตีเครื่องกลับ",
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

    // ดึง FCM tokens ของ admin ทุกคน
    const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
    if (!tokensSnap.exists()) return;

    const tokens = [];
    tokensSnap.forEach((staffSnap) => {
      staffSnap.forEach((tokenSnap) => {
        const data = tokenSnap.val();
        if (data && data.token) tokens.push(data.token);
      });
    });

    if (tokens.length === 0) return;

    const messaging = getMessaging();
    const message = {
      notification: { title, body },
      data: {
        jobId,
        type: "status_change",
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
            alert: { title, body },
            sound: "default",
          },
        },
      },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        notification: {
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: `status-${jobId}`,
          vibrate: [200, 100, 200],
          renotify: true,
        },
      },
    };

    const batches = [];
    for (let i = 0; i < tokens.length; i += 500) {
      batches.push(
        messaging.sendEachForMulticast({
          ...message,
          tokens: tokens.slice(i, i + 500),
        })
      );
    }
    const results = await Promise.all(batches);
    const successCount = results.reduce((a, r) => a + r.successCount, 0);
    console.log(
      `Status change notif (${before}→${after}) job ${jobId}: ${successCount}/${tokens.length} devices`
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
