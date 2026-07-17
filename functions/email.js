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

// Registered company identity — DEFAULT/fallback, mirror of the source of truth
// in bkk-frontend-next (app/utils/company.ts / functions/src/legal.ts). Admins
// can override these in the "ตั้งค่าระบบบัญชี" page (settings/accounting/company);
// the resolved value is stashed on job._company by the trigger. Keep the legal
// name/tax id/address in sync with the entity registered on the customer site.
const COMPANY = {
  legalName: "บริษัท เก็ทโมบี้ จำกัด",
  tradeName: "BKK APPLE",
  taxId: "0105565094088",
  address:
    "596/163 ซอย 6/1 โครงการ อารียา ทูบี ถนนลาดปลาเค้า แขวงจรเข้บัว เขตลาดพร้าว กรุงเทพฯ 10230",
  branch: "สำนักงานใหญ่",
  nameEn: "",
  addressEn: "",
  phone: "",
};

// Resolve the company to use for a job: admin override (job._company) merged
// over the hardcoded defaults, so partial overrides still render fully.
function companyOf(job) {
  const o = (job && job._company) || {};
  return { ...COMPANY, ...o };
}

/**
 * Send one email via Resend. No-ops (returns { skipped }) when the provider
 * isn't configured or there are no recipients, so a missing secret degrades
 * to "no email" rather than crashing the order pipeline. Throws on a real
 * Resend API error so the caller can log it.
 */
async function sendEmail({ to, subject, html, replyTo, attachments }) {
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
  // Resend attachments: [{ filename, content: base64 }]
  if (Array.isArray(attachments) && attachments.length > 0) payload.attachments = attachments;

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

// Thai baht-in-words for the payment voucher (e.g. 31800 → "สามหมื่นหนึ่งพัน
// แปดร้อยบาทถ้วน"). Handles เอ็ด / ยี่สิบ / ล้าน and satang.
const THAI_DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

function readThaiChunk(group, hasHigher) {
  const g = String(group);
  const len = g.length;
  let seenNonZero = Boolean(hasHigher);
  let out = "";
  for (let i = 0; i < len; i++) {
    const d = parseInt(g[i], 10);
    const place = len - i - 1; // 0..5
    if (d === 0) continue;
    if (place === 0) {
      out += d === 1 && seenNonZero ? "เอ็ด" : THAI_DIGITS[d];
    } else if (place === 1) {
      out += d === 1 ? "สิบ" : d === 2 ? "ยี่สิบ" : THAI_DIGITS[d] + "สิบ";
    } else {
      out += THAI_DIGITS[d] + THAI_PLACES[place];
    }
    seenNonZero = true;
  }
  return out;
}

function readThaiInt(numStr) {
  const s = String(numStr).replace(/^0+/, "");
  if (s === "") return "";
  if (s.length > 6) {
    const high = s.slice(0, s.length - 6);
    const low = s.slice(s.length - 6);
    return readThaiChunk(high, false) + "ล้าน" + readThaiChunk(low, true);
  }
  return readThaiChunk(s, false);
}

function bahtText(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  const fixed = (Math.round(Math.abs(n) * 100) / 100).toFixed(2);
  const [intPart, satPart] = fixed.split(".");
  const bahtWords = readThaiInt(intPart) || "ศูนย์";
  let out = bahtWords + "บาท";
  if (satPart === "00") out += "ถ้วน";
  else out += readThaiInt(satPart) + "สตางค์";
  return out;
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
      // Offer-request device: price 0 is "not priced yet", not a real ฿0 quote
      // — blank the cell so the email never quotes ฿0 to the customer.
      price: d.offer_request === true ? null : (d.finalPrice ?? d.price ?? null),
    };
  });
}

/** Offer request still awaiting a price — validateAndCreateOrder (bkk-frontend-next)
 *  flags jobs whose spec is actively bought but has no published price. The order
 *  emails must not present the ฿0 as a real quote; once admin sets a price
 *  (final_price > 0) the job reads as a normal order again. */
function isOfferAwaiting(job) {
  if (!job || job.offer_request !== true) return false;
  return !(Number(job.final_price || job.price) > 0);
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

/**
 * Render an order summary card shared by every template. `payoutLabel`
 * defaults to the pre-settlement wording ("ยอดที่จะได้รับโดยประมาณ"); pass
 * "ยอดรับสุทธิ" once the money has actually been transferred (Paid).
 */
const PAYOUT_LABEL_ESTIMATE = "ยอดที่จะได้รับโดยประมาณ";
const PAYOUT_LABEL_NET = "ยอดรับสุทธิ";

// The company is VAT-registered. The pickup/service fee charged to the
// customer is treated as VAT-INCLUSIVE, so we back out the 7% for the
// company's output-VAT records and to disclose it on the voucher.
const VAT_RATE = 0.07;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Service-fee (pickup_fee) breakdown for a job, or null when there's no fee.
 * `feeIncl` is the VAT-inclusive fee deducted from the payout; `base` + `vat`
 * are its VAT-exclusive base and the 7% output VAT.
 */
function serviceFeeBreakdown(job) {
  // The customer is only charged the EFFECTIVE fee: the gross pickup_fee minus
  // any rider-fee discount the company absorbed. VAT, the tax invoice and the
  // payment voucher must all follow this — if the fee is fully waived there is
  // no service revenue and no tax invoice. (The rider's pay is a separate
  // expense and is unaffected.)
  const gross = Number(job && job.pickup_fee) || 0;
  const riderDiscount = Number(job && job.rider_fee_discount) || 0;
  const feeIncl = Math.max(0, gross - riderDiscount);
  if (feeIncl <= 0) return null;
  // Resolved accounting config is stashed on the job in-memory by the trigger
  // (job._accounting), read from settings/accounting. Defaults preserve the
  // VAT-registered, 7% VAT-inclusive behaviour when unset.
  const acct = (job && job._accounting) || {};
  const vatRegistered = acct.vat_registered !== false;
  if (!vatRegistered) {
    return { feeIncl: round2(feeIncl), base: round2(feeIncl), vat: 0, vatRegistered: false };
  }
  const rate = Number(acct.vat_rate) > 0 ? Number(acct.vat_rate) : VAT_RATE;
  const base = round2(feeIncl / (1 + rate));
  return { feeIncl: round2(feeIncl), base, vat: round2(feeIncl - base), vatRegistered: true };
}

function orderSummaryCard(job, opts = {}) {
  const { payoutLabel = PAYOUT_LABEL_ESTIMATE, showVatDetail = false } =
    typeof opts === "string" ? { payoutLabel: opts } : opts;
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

  const net = Number(job.net_payout ?? job.price) || 0;
  // Awaiting offer: no price exists yet — suppress the fee breakdown (it would
  // reconcile against a meaningless 0) and show "รอเสนอราคา" as the total.
  const awaitingOffer = isOfferAwaiting(job);
  const fee = awaitingOffer ? null : serviceFeeBreakdown(job);
  // Gross-before-fee reconciles exactly with the net regardless of coupons,
  // since the fee is the only line we break out: gross − fee = net.
  const grossBeforeFee = fee ? net + fee.feeIncl : net;

  const totalRow = (label, value, opts2 = {}) => `<tr>
          <td style="font-size:${opts2.big ? 14 : 13}px;color:${opts2.muted ? "#6b7280" : "#111827"};${opts2.big ? "font-weight:600;" : ""}">${label}</td>
          <td style="font-size:${opts2.big ? 18 : 13}px;color:${opts2.color || (opts2.muted ? "#6b7280" : "#111827")};${opts2.big ? "font-weight:700;" : ""}text-align:right;white-space:nowrap;">${value}</td>
        </tr>`;

  let totalsRows = "";
  if (fee) {
    const feeLabel = fee.vatRegistered
      ? "ค่าบริการรับเครื่อง (คุณชำระเรา · รวม VAT)"
      : "ค่าบริการรับเครื่อง (คุณชำระเรา)";
    totalsRows += totalRow("ราคารับซื้อเครื่อง (เราจ่ายคุณ)", esc(formatTHB(grossBeforeFee)), { muted: true });
    totalsRows += totalRow(feeLabel, `−${esc(formatTHB(fee.feeIncl))}`, { muted: true });
    if (showVatDetail && fee.vatRegistered) {
      totalsRows += `<tr><td colspan="2" style="padding:1px 0 4px 14px;font-size:11px;color:#9ca3af;">
        ค่าบริการ ${esc(formatTHB(fee.base))} + VAT 7% ${esc(formatTHB(fee.vat))}</td></tr>`;
    }
  }
  totalsRows += awaitingOffer
    ? totalRow("ราคารับซื้อ", "รอทีมงานเสนอราคา", { big: true, color: "#2563eb" })
    : totalRow(esc(payoutLabel), esc(formatTHB(net)), { big: true, color: "#059669" });

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
        ${totalsRows}
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
  // Offer request — the customer submitted a spec with no published price;
  // the copy promises a call-back with an offer instead of an order confirm.
  if (isOfferAwaiting(job)) {
    return {
      to: job.cust_email,
      subject: `ได้รับคำขอใบเสนอราคาของคุณแล้ว — ${job.ref_no || "BKK APPLE"}`,
      html: shell({
        heading: "เราได้รับคำขอใบเสนอราคาของคุณแล้ว",
        intro: `สวัสดี ${name} ขอบคุณที่เลือกขายอุปกรณ์กับ ${esc(BRAND)} สเปกที่คุณส่งเข้ามายังไม่มีราคากลางในระบบ ทีมงานจะตรวจสอบข้อมูลและติดต่อกลับเพื่อเสนอราคาให้คุณโดยเร็วที่สุด ไม่มีข้อผูกมัดใดๆ`,
        bodyHtml: orderSummaryCard(job) + trackingButton(job),
      }),
    };
  }
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
  const awaitingOffer = isOfferAwaiting(job);
  return {
    to,
    subject: awaitingOffer
      ? `[ขอใบเสนอราคา] ${job.ref_no || ""} — ${esc(job.model || "")} (ติดต่อลูกค้ากลับ)`.trim()
      : `[ออเดอร์ใหม่${isB2B ? " B2B" : ""}] ${job.ref_no || ""} — ${esc(job.model || "")} ${formatTHB(
          job.net_payout ?? job.price
        )}`.trim(),
    html: shell({
      heading: awaitingOffer ? "ลูกค้าขอใบเสนอราคา (สเปกยังไม่มีราคากลาง)" : `มีคำสั่งขายใหม่เข้ามา${isB2B ? " (B2B)" : ""}`,
      intro: awaitingOffer
        ? `สถานะเริ่มต้น: <strong>${esc(job.status || "-")}</strong> — สเปกนี้ยังไม่มีราคากลางในระบบ ต้องติดต่อลูกค้ากลับเพื่อเสนอราคา`
        : `สถานะเริ่มต้น: <strong>${esc(job.status || "-")}</strong>`,
      bodyHtml:
        (contact
          ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">${contact}</p>`
          : "") + orderSummaryCard(job),
      footerNote: "อีเมลแจ้งเตือนภายในทีม BKK APPLE — เปิดแอดมินเพื่อดูรายละเอียดและรับเคส",
    }),
  };
}

// ── Payment voucher (ใบสำคัญรับเงิน) ──────────────────────────────────────────
// When BKK buys a device from an individual, the seller (a natural person)
// can't issue a tax receipt, so the company issues a ใบสำคัญรับเงิน instead:
// the buyer-prepared voucher the payee acknowledges, used as the company's
// accounting/tax evidence of the expense. This replaces the plain "receipt"
// framing for the customer Paid email.

/** Company (payer) + customer (payee) identity block for the voucher. */
function voucherPartiesCard(job) {
  const co = companyOf(job);
  const docMeta = kvTable([
    ["เลขที่เอกสาร", esc(job.ref_no || "-")],
    // วันที่จ่ายเงิน = เวลาโอนจริงตามสลิป (transferred_at) ถ้ามี ไม่งั้น fallback เวลาที่ระบบบันทึก
    (job.transferred_at || job.paid_at) && ["วันที่จ่ายเงิน", esc(formatThaiDateTime(job.transferred_at || job.paid_at))],
  ]);
  const payer = kvTable([
    ["ผู้จ่ายเงิน", esc(co.legalName)],
    ["เลขประจำตัวผู้เสียภาษี", esc(co.taxId)],
    ["ที่อยู่", esc(co.address)],
  ]);
  const payee = kvTable([
    ["ผู้รับเงิน", esc(job.cust_name || "-")],
    (job.cust_id_address || job.cust_address) && [
      "ที่อยู่",
      esc(job.cust_id_address || job.cust_address),
    ],
  ]);
  return (
    sectionCard("รายละเอียดเอกสาร", docMeta) +
    sectionCard("ผู้จ่ายเงิน (บริษัท)", payer) +
    sectionCard("ผู้รับเงิน", payee)
  );
}

/** Amount-in-words line ("จำนวนเงิน (ตัวอักษร): (... บาทถ้วน)"). */
function bahtTextLine(amount) {
  const t = bahtText(amount);
  if (!t) return "";
  return `<p style="margin:12px 2px 0;font-size:14px;color:#111827;">จำนวนเงิน (ตัวอักษร): <strong>(${esc(t)})</strong></p>`;
}

function voucherLegalNote(job) {
  return `<p style="margin:16px 2px 0;font-size:12px;line-height:1.7;color:#6b7280;">
    เนื่องจากผู้รับเงินเป็นบุคคลธรรมดาซึ่งไม่สามารถออกใบเสร็จรับเงินได้
    ${esc(companyOf(job).legalName)} จึงออกใบสำคัญรับเงินฉบับนี้ไว้เป็นหลักฐานการจ่ายเงิน
    เพื่อประกอบการบันทึกบัญชีและภาษีตามกฎหมาย — เอกสารฉบับนี้เป็นสำเนาอิเล็กทรอนิกส์
    โดยผู้รับเงินได้ลงลายมือชื่อรับเงินไว้แล้ว ณ จุดส่งมอบเครื่อง
  </p>`;
}

/**
 * Customer Paid document = ใบสำคัญรับเงิน (payment voucher), not a receipt.
 * Sensitive verification (SickW/KYC) is NOT included — only the parties,
 * the device, and the net amount paid.
 */
function buildCustomerPaymentVoucherEmail(job) {
  const co = companyOf(job);
  const name = job.cust_name ? `คุณ${esc(job.cust_name)} ` : "";
  const amount = job.net_payout ?? job.price;
  return {
    to: job.cust_email,
    subject: `ใบสำคัญรับเงิน — ${job.ref_no || "BKK APPLE"}`,
    html: shell({
      heading: "ใบสำคัญรับเงิน",
      intro: `${name}${esc(co.legalName)} ได้จ่ายเงินค่ารับซื้ออุปกรณ์ให้คุณเรียบร้อยแล้ว รายละเอียดตามเอกสารด้านล่าง`,
      bodyHtml:
        voucherPartiesCard(job) +
        orderSummaryCard(job, { payoutLabel: PAYOUT_LABEL_NET, showVatDetail: true }) +
        bahtTextLine(amount) +
        paymentExtra(job) +
        voucherLegalNote(job) +
        trackingButton(job),
      footerNote: `${co.legalName} (${co.tradeName}) • เลขประจำตัวผู้เสียภาษี ${co.taxId}`,
    }),
  };
}

// ── Status normalisation (ported from src/types/job-statuses.ts) ─────────────
// functions/ is plain JS and can't import the canonical TS enum, so the legacy
// aliasing + "In-Transit" overload rule are mirrored here. Keep in sync with
// LEGACY_ALIAS / normalizeStatus in job-statuses.ts.

const CANONICAL_STATUSES = new Set([
  "New Lead", "Active Lead", "Following Up", "Appointment Set", "Waiting Drop-off",
  "Awaiting Shipping", "Rider Assigned", "Rider Accepted", "Rider En Route",
  "Rider Arrived", "Drop-off Received", "Parcel In Transit", "Parcel Received",
  "Being Inspected", "Discrepancy Reported", "QC Review", "Revised Offer",
  "Negotiation", "Price Accepted", "Payout Processing", "Waiting For Handover",
  "Paid", "Rider Returning", "Pending QC", "Sent To QC Lab", "In Stock",
  "Ready To Sell", "Sold", "Completed", "Cancelled", "Closed (Lost)",
  "Drop-off Expired", "Shipping Expired", "Investigating Carrier", "Parcel Lost",
  "Returning To Customer", "Return Confirmed", "Disputed", "Refund Initiated",
  "Refund Completed",
]);

const LEGACY_ALIAS = {
  PAID: "Paid",
  "Payment Completed": "Paid",
  "Active Leads": "Active Lead",
  "Waiting for Handover": "Waiting For Handover",
  Assigned: "Rider Assigned",
  Accepted: "Rider Accepted",
  "Heading to Customer": "Rider En Route",
  Arrived: "Rider Arrived",
  Returned: "Return Confirmed",
};

function normalizeStatus(legacy, receiveMethod) {
  if (!legacy) return null;
  if (CANONICAL_STATUSES.has(legacy)) return legacy;
  if (legacy === "In-Transit") {
    return receiveMethod === "Pickup" ? "Rider Returning" : "Parcel In Transit";
  }
  return LEGACY_ALIAS[legacy] || null;
}

const CANCEL_CATEGORY_LABEL_TH = {
  customer_changed_mind: "ลูกค้าเปลี่ยนใจ",
  customer_no_show: "ลูกค้าไม่มา / ติดต่อไม่ได้",
  rider_issue: "ปัญหาฝั่งไรเดอร์",
  device_mismatch: "เครื่องไม่ตรงใบสั่ง",
  hidden_damage: "พบความเสียหายซ่อน",
  price_disagreement: "เจรจาราคาไม่ลงตัว",
  fraud_suspected: "สงสัยฉ้อโกง",
  parcel_lost: "ขนส่งทำพัสดุหาย",
  sla_timeout: "หมดเวลา (ระบบยกเลิกอัตโนมัติ)",
  other: "อื่น ๆ",
};

/** RTDB-safe idempotency key for "we already emailed about this status". */
function statusEmailKey(status) {
  return String(status).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── Per-status extras (HTML appended after the summary card) ──────────────────

function maskAccount(n) {
  const s = String(n || "").replace(/\s+/g, "");
  return s.length > 4 ? `${"x".repeat(s.length - 4)}${s.slice(-4)}` : s;
}

function paymentExtra(job) {
  const pi = job.payment_info || {};
  const rows = [
    pi.bank && ["ธนาคาร", esc(pi.bank)],
    pi.account_name && ["ชื่อบัญชี", esc(pi.account_name)],
    pi.account_number && ["เลขบัญชี", esc(maskAccount(pi.account_number))],
  ].filter(Boolean);
  if (rows.length === 0) return "";
  const body = rows
    .map(
      ([k, v]) => `<tr><td style="padding:3px 0;font-size:13px;color:#6b7280;">${k}</td>
        <td style="padding:3px 0 3px 16px;font-size:13px;color:#111827;text-align:right;">${v}</td></tr>`
    )
    .join("");
  return `<p style="margin:18px 0 6px;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;">โอนเข้าบัญชี</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:8px;padding:8px 14px;">${body}</table>`;
}

function cancelExtra(job) {
  const cat = job.cancel_category ? CANCEL_CATEGORY_LABEL_TH[job.cancel_category] : "";
  const reason = [cat, job.cancel_reason].filter(Boolean).join(" — ");
  if (!reason) return "";
  return `<p style="margin:16px 0 0;font-size:14px;color:#b91c1c;">เหตุผล: ${esc(reason)}</p>`;
}

// ── Admin Paid summary helpers (sensitive — admin-only record) ─────────────────
// GSX/FMI/iCloud verification + KYC are internal/sensitive (PDPA). They appear
// only in the admin Paid summary, never in customer mail. The data is already
// persisted on the job (sickw_check.last_check, written during inspection) and
// at /jobs_kyc/{jobId}, so the email READS the stored snapshot — it never
// re-calls the SickW API (no extra credit burn; the inspection-time result is
// the figure the purchase was decided on).

function formatThaiDateTime(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    });
  } catch (e) {
    return "";
  }
}

/** Mask a Thai national ID (or any number), showing only the last 4 digits. */
function maskId(id) {
  const s = String(id || "").replace(/\s+/g, "");
  return s.length > 4 ? `${"x".repeat(s.length - 4)}${s.slice(-4)}` : s;
}

function flagBadge(state) {
  const map = {
    clean: ["ผ่าน", "#059669", "#ecfdf5"],
    flagged: ["ผิดปกติ", "#b91c1c", "#fef2f2"],
    unknown: ["ไม่ทราบ", "#6b7280", "#f3f4f6"],
  };
  const [label, color, bg] = map[state] || map.unknown;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;color:${color};background:${bg};">${label}</span>`;
}

/** Key/value table. Values are interpolated as-is — caller escapes plain text. */
function kvTable(rows) {
  const body = rows
    .filter(Boolean)
    .map(
      ([k, v]) => `<tr>
        <td style="padding:4px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top;">${k}</td>
        <td style="padding:4px 0 4px 16px;font-size:13px;color:#111827;text-align:right;">${v}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
}

function sectionCard(title, innerHtml) {
  return `<p style="margin:18px 0 6px;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;">${title}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:8px;">
      <tr><td style="padding:10px 14px;">${innerHtml}</td></tr>
    </table>`;
}

/** GSX basic info + FMI/iCloud/MDM flags from the stored SickW snapshot. */
function sickwVerificationExtra(job) {
  const lc = job.sickw_check && job.sickw_check.last_check;
  if (!lc) return "";
  const p = lc.parsed || {};
  const f = lc.flags || {};
  const info = [
    p.model && ["รุ่น (GSX)", esc(p.model)],
    p.capacity && ["ความจุ", esc(p.capacity)],
    p.color && ["สี", esc(p.color)],
    p.serial && ["Serial", esc(p.serial)],
    p.imei && ["IMEI", esc(p.imei)],
    p.country && ["ประเทศ", esc(p.country)],
    p.warrantyStatus && ["ประกัน", esc(p.warrantyStatus)],
    p.estimatedPurchaseDate && ["วันเริ่มประกัน", esc(p.estimatedPurchaseDate)],
  ];
  const flagRows = [
    ["Find My (FMI)", flagBadge(f.fmi)],
    ["iCloud / Blacklist", flagBadge(f.blacklist)],
    ["MDM", flagBadge(f.mdm)],
  ];
  const checkedAt = formatThaiDateTime(lc.checked_at);
  return sectionCard(
    `ผลตรวจเครื่อง (SickW)${checkedAt ? ` — ตรวจ ${esc(checkedAt)}` : ""}`,
    kvTable([...info, ...flagRows])
  );
}

/** KYC summary from /jobs_kyc/{jobId}. ID number is masked (last 4 only). */
function kycExtra(kyc) {
  if (!kyc) return "";
  const methodLabel = kyc.method === "typed_fallback" ? "กรอกมือ (Fallback)" : "ถ่ายบัตร";
  const rows = [
    kyc.id_name && ["ชื่อตามบัตร", esc(kyc.id_name)],
    kyc.id_number && ["เลขบัตร ปชช.", esc(maskId(kyc.id_number))],
    kyc.id_address && ["ที่อยู่ตามบัตร", esc(kyc.id_address)],
    ["วิธี KYC", esc(methodLabel)],
    kyc.verified_by_rider_name && ["ตรวจโดย", esc(kyc.verified_by_rider_name)],
    kyc.verified_at && ["เวลา KYC", esc(formatThaiDateTime(kyc.verified_at))],
    kyc.fallback_reason && ["เหตุผล fallback", esc(kyc.fallback_reason)],
  ];
  return sectionCard("ข้อมูลผู้ขาย (KYC)", kvTable(rows));
}

// ── Milestone copy map ────────────────────────────────────────────────────────
// The map IS the allowlist: a (canonical) status not present here sends no mail.
// `customer` (optional) drives the customer email; `adminLabel` is the short TH
// label used for the admin milestone email (admin gets one for every entry).
// Add a future status = add one entry here, no logic changes.

const REF = (j) => j.ref_no || "BKK APPLE";

const STATUS_COPY = {
  "Active Lead": {
    adminLabel: "รับเคสแล้ว",
    customer: {
      subject: (j) => `ยืนยันรับคำสั่งขาย — ${REF(j)}`,
      heading: "ยืนยันรับคำสั่งขายเรียบร้อย",
      intro: (j) => {
        let t = `ทีมงาน ${esc(BRAND)} ได้ยืนยันรับคำสั่งขายของคุณเรียบร้อยแล้ว`;
        if (j.receive_method === "Pickup") {
          const s = pickupScheduleText(j);
          t += s ? ` เจ้าหน้าที่จะเข้ารับเครื่องตามนัดหมาย: ${esc(s)}` : " เจ้าหน้าที่จะติดต่อนัดหมายเข้ารับเครื่องอีกครั้ง";
        } else if (j.receive_method === "Mail-in") {
          t += " กรุณาจัดส่งอุปกรณ์ตามรายละเอียดที่ทีมงานแจ้ง และเก็บหลักฐานการส่งไว้";
        } else if (j.receive_method === "Store-in") {
          t += " คุณสามารถนำอุปกรณ์เข้ามาที่สาขาได้ตามรายละเอียดด้านล่าง";
        }
        return t;
      },
    },
  },
  "Appointment Set": {
    adminLabel: "ตั้งนัดหมาย",
    customer: {
      subject: (j) => `นัดหมายเรียบร้อย — ${REF(j)}`,
      heading: "นัดหมายรับเครื่องเรียบร้อย",
      intro: (j) => {
        const s = pickupScheduleText(j);
        return `เราได้นัดหมายรับเครื่องของคุณแล้ว${s ? `: ${esc(s)}` : " เจ้าหน้าที่จะยืนยันเวลากับคุณอีกครั้ง"}`;
      },
    },
  },
  "Drop-off Received": {
    adminLabel: "รับเครื่องที่สาขา",
    customer: {
      subject: (j) => `รับเครื่องของคุณแล้ว — ${REF(j)}`,
      heading: "เราได้รับเครื่องของคุณแล้ว",
      intro: () => "เราได้รับเครื่องที่สาขาเรียบร้อยแล้ว และกำลังเข้าสู่ขั้นตอนตรวจสอบสภาพเครื่อง",
    },
  },
  "Parcel Received": {
    adminLabel: "รับพัสดุแล้ว",
    customer: {
      subject: (j) => `รับพัสดุของคุณแล้ว — ${REF(j)}`,
      heading: "เราได้รับพัสดุของคุณแล้ว",
      intro: () => "เราได้รับพัสดุเรียบร้อยแล้ว และกำลังเข้าสู่ขั้นตอนตรวจสอบสภาพเครื่อง",
    },
  },
  "Being Inspected": {
    adminLabel: "กำลังตรวจเครื่อง",
    customer: {
      subject: (j) => `กำลังตรวจสอบเครื่อง — ${REF(j)}`,
      heading: "กำลังตรวจสอบสภาพเครื่อง",
      intro: () => "ทีมงานกำลังตรวจสอบสภาพเครื่องของคุณ หากตรงตามที่ประเมินไว้ เราจะดำเนินการโอนเงินทันที",
    },
  },
  "Revised Offer": {
    adminLabel: "เสนอราคาใหม่",
    customer: {
      subject: (j) => `มีข้อเสนอราคาใหม่ รอการยืนยัน — ${REF(j)}`,
      heading: "มีข้อเสนอราคาใหม่",
      intro: () => "หลังตรวจสอบสภาพเครื่อง เรามีข้อเสนอราคาใหม่ตามด้านล่าง กรุณายืนยันผ่านระบบหรือกับเจ้าหน้าที่เพื่อดำเนินการต่อ",
    },
  },
  Negotiation: {
    adminLabel: "ต่อรองราคา",
    customer: {
      subject: (j) => `ปรับราคา รอการยืนยัน — ${REF(j)}`,
      heading: "มีการปรับราคา รอการยืนยัน",
      intro: () => "ราคารับซื้อมีการปรับตามสภาพเครื่องจริง กรุณายืนยันราคาใหม่ตามด้านล่างเพื่อให้เราดำเนินการต่อ",
    },
  },
  Paid: {
    // Customer copy is the ใบสำคัญรับเงิน (buildCustomerPaymentVoucherEmail),
    // delegated in buildCustomerStatusEmail; admin copy is the full sale
    // summary (buildAdminPaidSummaryEmail). Entry kept so Paid is a milestone.
    adminLabel: "โอนเงินแล้ว",
  },
  Cancelled: {
    adminLabel: "ยกเลิก",
    customer: {
      subject: (j) => `คำสั่งขายถูกยกเลิก — ${REF(j)}`,
      heading: "คำสั่งขายถูกยกเลิก",
      intro: () => "คำสั่งขายของคุณถูกยกเลิก หากต้องการดำเนินการต่อหรือมีข้อสงสัย กรุณาติดต่อทีมงาน",
      extra: cancelExtra,
    },
  },
  "Closed (Lost)": {
    adminLabel: "ปิดงาน",
    customer: {
      subject: (j) => `ปิดคำสั่งขาย — ${REF(j)}`,
      heading: "ปิดคำสั่งขาย",
      intro: () => "คำสั่งขายนี้ถูกปิดเรียบร้อยแล้ว หากต้องการขายใหม่ คุณสามารถเริ่มคำสั่งขายใหม่ได้ทุกเมื่อ",
      extra: cancelExtra,
    },
  },
  "Drop-off Expired": {
    adminLabel: "หมดเวลานำเข้าสาขา",
    customer: {
      subject: (j) => `หมดเวลานำเครื่องเข้าสาขา — ${REF(j)}`,
      heading: "หมดเวลานำเครื่องเข้าสาขา",
      intro: () => "เลยกำหนดการนำเครื่องเข้าสาขาแล้ว คำสั่งขายถูกพักไว้ หากยังต้องการขาย กรุณาติดต่อทีมงานเพื่อนัดหมายใหม่",
    },
  },
  "Shipping Expired": {
    adminLabel: "หมดเวลาจัดส่ง",
    customer: {
      subject: (j) => `หมดเวลาจัดส่งพัสดุ — ${REF(j)}`,
      heading: "หมดเวลาจัดส่งพัสดุ",
      intro: () => "เลยกำหนดการจัดส่งพัสดุแล้ว คำสั่งขายถูกพักไว้ หากยังต้องการขาย กรุณาติดต่อทีมงาน",
    },
  },
  "Investigating Carrier": {
    adminLabel: "ตรวจสอบกับขนส่ง",
    customer: {
      subject: (j) => `กำลังตรวจสอบพัสดุกับขนส่ง — ${REF(j)}`,
      heading: "กำลังตรวจสอบพัสดุกับขนส่ง",
      intro: () => "เรากำลังประสานกับบริษัทขนส่งเพื่อติดตามพัสดุของคุณ และจะแจ้งความคืบหน้าให้ทราบโดยเร็ว",
    },
  },
  "Parcel Lost": {
    adminLabel: "พัสดุสูญหาย",
    customer: {
      subject: (j) => `แจ้งพัสดุสูญหาย — ${REF(j)}`,
      heading: "พัสดุสูญหายระหว่างขนส่ง",
      intro: () => "เราตรวจสอบแล้วพบว่าพัสดุสูญหายระหว่างขนส่ง ทีมงานจะติดต่อคุณเพื่อดำเนินการชดเชยตามนโยบาย",
    },
  },
  "Returning To Customer": {
    adminLabel: "ส่งเครื่องคืน",
    customer: {
      subject: (j) => `กำลังส่งเครื่องคืน — ${REF(j)}`,
      heading: "กำลังส่งเครื่องคืนให้คุณ",
      intro: () => "เรากำลังดำเนินการส่งเครื่องคืนให้คุณ และจะแจ้งรายละเอียดการจัดส่งให้ทราบ",
    },
  },
  "Return Confirmed": {
    adminLabel: "ยืนยันส่งคืน",
    customer: {
      subject: (j) => `ยืนยันการส่งเครื่องคืน — ${REF(j)}`,
      heading: "ยืนยันการส่งเครื่องคืน",
      intro: () => "เครื่องของคุณถูกส่งคืนเรียบร้อยแล้ว หากมีข้อสงสัยกรุณาติดต่อทีมงาน",
    },
  },
  "Refund Initiated": {
    adminLabel: "เริ่มคืนเงิน",
    customer: {
      subject: (j) => `เริ่มดำเนินการคืนเงิน — ${REF(j)}`,
      heading: "เริ่มดำเนินการคืนเงิน",
      intro: () => "เราได้เริ่มดำเนินการคืนเงินให้คุณแล้ว โดยปกติใช้เวลา 1-3 วันทำการ",
    },
  },
  "Refund Completed": {
    adminLabel: "คืนเงินเสร็จ",
    customer: {
      subject: (j) => `คืนเงินเรียบร้อย — ${REF(j)}`,
      heading: "คืนเงินเรียบร้อยแล้ว",
      intro: () => "เราได้คืนเงินให้คุณเรียบร้อยแล้ว ขอบคุณที่ใช้บริการ",
      extra: paymentExtra,
    },
  },
};

/**
 * Build the customer milestone email for a canonical status, or null when the
 * status isn't a customer-facing milestone / there's no customer copy. Paid is
 * special-cased to the ใบสำคัญรับเงิน (payment voucher).
 */
function buildCustomerStatusEmail(job, status) {
  if (status === "Paid") return buildCustomerPaymentVoucherEmail(job);
  const entry = STATUS_COPY[status];
  if (!entry || !entry.customer) return null;
  const c = entry.customer;
  const name = job.cust_name ? `คุณ${esc(job.cust_name)} ` : "";
  const extra = c.extra ? c.extra(job) : "";
  const payoutLabel = PAYOUT_LABEL_ESTIMATE;
  return {
    to: job.cust_email,
    subject: c.subject(job),
    html: shell({
      heading: typeof c.heading === "function" ? c.heading(job) : c.heading,
      intro: `${name}${c.intro(job)}`,
      bodyHtml: orderSummaryCard(job, payoutLabel) + extra + trackingButton(job),
    }),
  };
}

/**
 * Build the admin milestone notification for a canonical status, or null when
 * the status isn't a tracked milestone.
 */
function buildAdminStatusEmail(job, status, to) {
  const entry = STATUS_COPY[status];
  if (!entry) return null;
  const contact = [
    job.cust_name && `ชื่อ: ${esc(job.cust_name)}`,
    job.cust_phone && `โทร: ${esc(job.cust_phone)}`,
  ]
    .filter(Boolean)
    .join(" &nbsp;|&nbsp; ");
  return {
    to,
    subject: `[${entry.adminLabel}] ${job.ref_no || ""} — ${esc(job.model || "")}`.trim(),
    html: shell({
      heading: `อัปเดตสถานะ: ${esc(entry.adminLabel)}`,
      intro: `สถานะปัจจุบัน: <strong>${esc(status)}</strong>`,
      bodyHtml:
        (contact ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">${contact}</p>` : "") +
        orderSummaryCard(job),
      footerNote: "อีเมลแจ้งความคืบหน้าภายในทีม BKK APPLE",
    }),
  };
}

/** True when a canonical status is a tracked milestone (drives admin email). */
function isMilestone(status) {
  return Boolean(STATUS_COPY[status]);
}

/**
 * Admin/finance full sale record sent at Paid. Doubles as the company's
 * ใบสำคัญรับเงิน backing: parties + order + payout + amount-in-words, plus the
 * internal-only SickW device verification (GSX/FMI/iCloud) + KYC. `kyc` is the
 * /jobs_kyc/{jobId} record (or null). Sensitive — never sent to a customer.
 */
function buildAdminPaidSummaryEmail(job, kyc, to) {
  const contact = [
    job.cust_name && `ชื่อ: ${esc(job.cust_name)}`,
    job.cust_phone && `โทร: ${esc(job.cust_phone)}`,
  ]
    .filter(Boolean)
    .join(" &nbsp;|&nbsp; ");

  return {
    to,
    subject: `[สรุปการขาย • โอนแล้ว] ${job.ref_no || ""} — ${esc(job.model || "")} ${formatTHB(
      job.net_payout ?? job.price
    )}`.trim(),
    html: shell({
      heading: "สรุปการขาย / ใบสำคัญรับเงิน (โอนเงินเรียบร้อย)",
      intro: `เลขที่ <strong>${esc(job.ref_no || "-")}</strong>${
        (job.transferred_at || job.paid_at)
          ? ` • โอนเมื่อ ${esc(formatThaiDateTime(job.transferred_at || job.paid_at))}`
          : ""
      }`,
      bodyHtml:
        (contact ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">${contact}</p>` : "") +
        voucherPartiesCard(job) +
        orderSummaryCard(job, { payoutLabel: PAYOUT_LABEL_NET, showVatDetail: true }) +
        bahtTextLine(job.net_payout ?? job.price) +
        paymentExtra(job) +
        sickwVerificationExtra(job) +
        kycExtra(kyc),
      footerNote:
        "บันทึกการขาย / ใบสำคัญรับเงินภายในทีม BKK APPLE — มีข้อมูลส่วนบุคคล (PDPA) โปรดเก็บเป็นความลับ ห้ามส่งต่อ",
    }),
  };
}

module.exports = {
  sendEmail,
  COMPANY,
  companyOf,
  bahtText,
  VAT_RATE,
  serviceFeeBreakdown,
  normalizeStatus,
  statusEmailKey,
  isMilestone,
  buildCustomerReceivedEmail,
  buildAdminNewOrderEmail,
  buildCustomerStatusEmail,
  buildCustomerPaymentVoucherEmail,
  buildAdminStatusEmail,
  buildAdminPaidSummaryEmail,
};
