const { onValueCreated } = require("firebase-functions/v2/database");
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
