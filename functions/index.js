const { onValueCreated } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

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
    const job = event.data.val();
    if (!job) return;

    // เฉพาะ ticket ใหม่ (New Lead / New B2B Lead)
    if (job.status !== "New Lead" && job.status !== "New B2B Lead") return;

    const jobId = event.params.jobId;
    const model = job.model || "ไม่ระบุรุ่น";
    const price = job.price ? `฿${Number(job.price).toLocaleString()}` : "";
    const method = job.receive_method || "";
    const custName = job.cust_name || "";
    const isB2B = job.status === "New B2B Lead";

    const title = isB2B ? "📦 New B2B Ticket!" : "📱 Ticket ใหม่เข้ามา!";
    const body = `${model} ${price} ${custName ? `- ${custName}` : ""} ${method ? `(${method})` : ""}`.trim();

    // ดึง FCM tokens ของ admin ทุกคน
    const db = getDatabase();
    const tokensSnap = await db.ref("admin_fcm_tokens").once("value");
    if (!tokensSnap.exists()) return;

    const tokens = [];
    tokensSnap.forEach((staffSnap) => {
      staffSnap.forEach((tokenSnap) => {
        const data = tokenSnap.val();
        if (data && data.token) {
          tokens.push(data.token);
        }
      });
    });

    if (tokens.length === 0) return;

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
      webpush: {
        notification: {
          icon: "/vite.svg",
          badge: "/vite.svg",
          vibrate: [200, 100, 200],
          requireInteraction: true,
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

    // ลบ tokens ที่ใช้ไม่ได้แล้ว
    for (const result of results) {
      result.responses.forEach((resp, idx) => {
        if (
          resp.error &&
          (resp.error.code === "messaging/registration-token-not-registered" ||
            resp.error.code === "messaging/invalid-registration-token")
        ) {
          // Token หมดอายุ → ลบออก
          const badToken = tokens[idx];
          tokensSnap.forEach((staffSnap) => {
            staffSnap.forEach((tokenSnap) => {
              if (tokenSnap.val()?.token === badToken) {
                db.ref(`admin_fcm_tokens/${staffSnap.key}/${tokenSnap.key}`).remove();
              }
            });
          });
        }
      });
    }

    const successCount = results.reduce(
      (acc, r) => acc + r.successCount,
      0
    );
    console.log(`Sent new ticket notification to ${successCount}/${tokens.length} devices`);
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
        android: { collapseKey },
        apns: {
          headers: { "apns-collapse-id": collapseKey },
        },
        webpush: {
          notification: {
            icon: "/vite.svg",
            tag: collapseKey,
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
          android: { collapseKey },
          apns: {
            headers: { "apns-collapse-id": collapseKey },
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
 * HTTP Cloud Function: notifyChatMessage (backward-compatible)
 * เปลี่ยนเป็น no-op เพราะ onChatMessageCreated จัดการแล้ว
 * คงไว้เพื่อไม่ให้ client เก่าที่ยังเรียก HTTP endpoint เกิด error
 */
exports.notifyChatMessage = onRequest(
  { region: "asia-southeast1", cors: true },
  (req, res) => {
    // No-op: notification is now handled by onChatMessageCreated database trigger
    res.json({ success: true, message: "Handled by database trigger" });
  }
);
