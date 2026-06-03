// =============================================================================
// Transactional email helper (Resend) + order-confirmation templates.
//
// We call the Resend REST API directly via the global `fetch` shipped with
// Node 22 instead of pulling in the `resend` npm package. Order-confirmation
// is a tiny, stable surface (one POST), so a dependency + lockfile churn +
// supply-chain footprint buys us nothing here.
//
// Why a transactional API (not SMTP / nodemailer / Gmail): Gmail SMTP is
// rate-limited, lands in spam, and has no DKIM/DMARC story. A transactional
// provider with a verified bkkapple.com sending domain is the only path to
// reliable inbox delivery for customer-facing order mail.
//
// Required env (written into functions/.env by the deploy workflow from
// GitHub Secrets — see .github/workflows/firebase-hosting-deploy.yml):
//   RESEND_API_KEY     — Resend API key ("re_...")
//   EMAIL_FROM         — verified sender, e.g. "BKK APPLE <noreply@bkkapple.com>"
//   ORDER_NOTIFY_EMAIL — central admin inbox, e.g. "orders@bkkapple.com"
// Optional:
//   EMAIL_REPLY_TO            — customer-facing reply address (e.g. support@bkkapple.com)
//   CUSTOMER_TRACKING_BASE_URL — base URL for the customer tracking link
// =============================================================================

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const BRAND = "BKK APPLE";

/**
 * Send one email via Resend. No-ops (returns { skipped }) when the provider
 * isn't configured or there are no recipients, so a missing secret degrades
 * to "no email" rather than crashing the order pipeline. Throws on a real
 * Resend API error so the caller can log it.
 */
async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("[email] RESEND_API_KEY or EMAIL_FROM not set — skipping send");
    return { skipped: true, reason: "not_configured" };
  }

  const recipients = (Array.isArray(to) ? to : [to])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter(Boolean);
  if (recipients.length === 0) return { skipped: true, reason: "no_recipients" };

  const payload = { from, to: recipients, subject, html };
  const reply = replyTo || process.env.EMAIL_REPLY_TO;
  if (reply) payload.reply_to = reply;

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** HTML-escape any value before interpolating customer/admin-supplied strings. */
function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Format a number as Thai Baht, tolerant of strings/blank/NaN. */
function formatTHB(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "-";
  return `฿${n.toLocaleString("th-TH")}`;
}

const RECEIVE_METHOD_TH = {
  Pickup: "นัดรับถึงที่ (Pickup)",
  "Store-in": "นำเข้าที่สาขา (Store-in)",
  "Mail-in": "ส่งพัสดุ (Mail-in)",
};

/** Pull the human device names out of a job's `devices` array (defensive). */
function deviceLines(job) {
  const devices = Array.isArray(job.devices) ? job.devices : [];
  if (devices.length === 0) {
    return job.model ? [{ name: job.model, price: job.price }] : [];
  }
  return devices.map((d) => {
    if (!d || typeof d !== "object") return { name: String(d || "อุปกรณ์"), price: null };
    return {
      name: d.model || d.name || d.title || "อุปกรณ์",
      price: d.finalPrice ?? d.price ?? null,
    };
  });
}

function pickupScheduleText(job) {
  const ps = job.pickup_schedule;
  if (!ps || typeof ps !== "object") return "";
  if (ps.type === "instant" || ps.date === "Instant") return "รับทันที (Instant)";
  const date = ps.date || "";
  const time = ps.time || "";
  return [date, time].filter(Boolean).join(" ");
}

// ── Shared HTML shell ───────────────────────────────────────────────────────

/**
 * Wrap body content in a table-based, inline-styled shell. Email clients
 * strip <style>/<head> and choke on flexbox, so everything is inline + tables.
 */
function shell({ heading, intro, bodyHtml, footerNote }) {
  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans Thai',sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:#111827;padding:20px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">${esc(BRAND)}</span>
        </td></tr>
        <tr><td style="padding:32px 32px 8px;">
          <h1 style="margin:0 0 8px;font-size:20px;line-height:1.4;color:#111827;">${esc(heading)}</h1>
          ${intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">${intro}</p>` : ""}
        </td></tr>
        <tr><td style="padding:0 32px 24px;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid #eef0f3;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
            ${footerNote || "อีเมลฉบับนี้ส่งอัตโนมัติจากระบบ BKK APPLE — กรุณาอย่าตอบกลับโดยตรงหากระบุไว้ว่าเป็น noreply"}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Render an order summary card shared by every template. */
function orderSummaryCard(job) {
  const lines = deviceLines(job);
  const deviceRows = lines
    .map(
      (d) => `<tr>
        <td style="padding:6px 0;font-size:14px;color:#374151;">${esc(d.name)}</td>
        <td style="padding:6px 0;font-size:14px;color:#374151;text-align:right;white-space:nowrap;">${
          d.price != null ? esc(formatTHB(d.price)) : ""
        }</td>
      </tr>`
    )
    .join("");

  const rows = [
    ["เลขที่คำสั่งขาย", esc(job.ref_no || "-")],
    ["วิธีรับเครื่อง", esc(RECEIVE_METHOD_TH[job.receive_method] || job.receive_method || "-")],
  ];
  const schedule = pickupScheduleText(job);
  if (job.receive_method === "Pickup" && schedule) rows.push(["นัดรับเครื่อง", esc(schedule)]);
  if (job.receive_method === "Pickup" && job.cust_address)
    rows.push(["ที่อยู่รับเครื่อง", esc(job.cust_address)]);
  if ((job.receive_method === "Store-in" || job.receive_method === "Mail-in") && job.branch_name)
    rows.push(["สาขา", esc(job.branch_name)]);

  const metaRows = rows
    .map(
      ([k, v]) => `<tr>
        <td style="padding:4px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${k}</td>
        <td style="padding:4px 0 4px 16px;font-size:13px;color:#111827;text-align:right;">${v}</td>
      </tr>`
    )
    .join("");

  const payout = formatTHB(job.net_payout ?? job.price);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:10px;">
    <tr><td style="padding:16px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${metaRows}</table>
    </td></tr>
    <tr><td style="padding:0 18px;"><hr style="border:none;border-top:1px solid #eef0f3;margin:4px 0;"></td></tr>
    <tr><td style="padding:12px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td colspan="2" style="padding:0 0 6px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;">รายการอุปกรณ์</td></tr>
        ${deviceRows}
      </table>
    </td></tr>
    <tr><td style="padding:12px 18px 16px;background:#f9fafb;border-top:1px solid #eef0f3;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:14px;color:#111827;font-weight:600;">ยอดที่จะได้รับโดยประมาณ</td>
          <td style="font-size:18px;color:#059669;font-weight:700;text-align:right;">${esc(payout)}</td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

function trackingButton(job) {
  const base = process.env.CUSTOMER_TRACKING_BASE_URL;
  if (!base || !job.ref_no) return "";
  const sep = base.includes("?") ? "&" : "/";
  const url = `${base.replace(/\/$/, "")}${sep}${encodeURIComponent(job.ref_no)}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr>
    <td style="border-radius:8px;background:#111827;">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">ติดตามสถานะคำสั่งขาย</a>
    </td>
  </tr></table>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

/** Customer: "we received your order" — sent on job creation. */
function buildCustomerReceivedEmail(job) {
  const name = job.cust_name ? `คุณ${esc(job.cust_name)}` : "ลูกค้า";
  return {
    to: job.cust_email,
    subject: `ได้รับคำสั่งขายของคุณแล้ว — ${job.ref_no || "BKK APPLE"}`,
    html: shell({
      heading: "เราได้รับคำสั่งขายของคุณแล้ว",
      intro: `สวัสดี ${name} ขอบคุณที่เลือกขายอุปกรณ์กับ ${esc(BRAND)} เราได้รับคำสั่งขายของคุณเรียบร้อยแล้ว ทีมงานกำลังตรวจสอบรายละเอียดและจะติดต่อกลับเพื่อยืนยันโดยเร็วที่สุด`,
      bodyHtml: orderSummaryCard(job) + trackingButton(job),
    }),
  };
}

/** Customer: "your deal is confirmed" — sent when admin accepts the case. */
function buildCustomerConfirmedEmail(job) {
  const name = job.cust_name ? `คุณ${esc(job.cust_name)}` : "ลูกค้า";
  const method = job.receive_method;
  let intro = `สวัสดี ${name} ทีมงาน ${esc(BRAND)} ได้ยืนยันรับคำสั่งขายของคุณเรียบร้อยแล้ว`;
  if (method === "Pickup") {
    const schedule = pickupScheduleText(job);
    intro += schedule
      ? ` เจ้าหน้าที่จะเข้ารับเครื่องตามนัดหมาย: ${esc(schedule)}`
      : " เจ้าหน้าที่จะติดต่อนัดหมายเข้ารับเครื่องกับคุณอีกครั้ง";
  } else if (method === "Mail-in") {
    intro += " กรุณาจัดส่งอุปกรณ์ตามรายละเอียดที่ทีมงานแจ้ง และเก็บหลักฐานการส่งไว้";
  } else if (method === "Store-in") {
    intro += " คุณสามารถนำอุปกรณ์เข้ามาที่สาขาได้ตามรายละเอียดด้านล่าง";
  }
  return {
    to: job.cust_email,
    subject: `ยืนยันรับคำสั่งขาย — ${job.ref_no || "BKK APPLE"}`,
    html: shell({
      heading: "ยืนยันรับคำสั่งขายเรียบร้อย",
      intro,
      bodyHtml: orderSummaryCard(job) + trackingButton(job),
    }),
  };
}

/** Admin central inbox: a new order just landed. */
function buildAdminNewOrderEmail(job, to) {
  const contact = [
    job.cust_name && `ชื่อ: ${esc(job.cust_name)}`,
    job.cust_phone && `โทร: ${esc(job.cust_phone)}`,
    job.cust_email && `อีเมล: ${esc(job.cust_email)}`,
  ]
    .filter(Boolean)
    .join(" &nbsp;|&nbsp; ");

  const isB2B = job.status === "New B2B Lead";
  return {
    to,
    subject: `[ออเดอร์ใหม่${isB2B ? " B2B" : ""}] ${job.ref_no || ""} — ${esc(job.model || "")} ${formatTHB(
      job.net_payout ?? job.price
    )}`.trim(),
    html: shell({
      heading: `มีคำสั่งขายใหม่เข้ามา${isB2B ? " (B2B)" : ""}`,
      intro: `สถานะเริ่มต้น: <strong>${esc(job.status || "-")}</strong>`,
      bodyHtml:
        (contact
          ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">${contact}</p>`
          : "") + orderSummaryCard(job),
      footerNote: "อีเมลแจ้งเตือนภายในทีม BKK APPLE — เปิดแอดมินเพื่อดูรายละเอียดและรับเคส",
    }),
  };
}

module.exports = {
  sendEmail,
  buildCustomerReceivedEmail,
  buildCustomerConfirmedEmail,
  buildAdminNewOrderEmail,
};
