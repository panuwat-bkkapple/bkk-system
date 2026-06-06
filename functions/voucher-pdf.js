// =============================================================================
// ใบสำคัญรับเงิน (payment voucher) PDF generator.
//
// Built with pdf-lib (pure JS, no native binaries → safe in Cloud Functions)
// and an embedded TH Sarabun New font (OFL, the standard Thai document font);
// without an embedded Thai font, pdf-lib's built-in fonts render Thai as boxes.
//
// Returns a Buffer (the PDF bytes). Pure/synchronous-ish — no I/O beyond
// reading the bundled font files, so it never touches the network.
// =============================================================================

const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const { COMPANY, bahtText, serviceFeeBreakdown } = require("./email");

const FONT_DIR = path.join(__dirname, "assets", "fonts");
let _regular = null;
let _bold = null;
function loadFonts() {
  if (!_regular) _regular = fs.readFileSync(path.join(FONT_DIR, "Sarabun-Regular.ttf"));
  if (!_bold) _bold = fs.readFileSync(path.join(FONT_DIR, "Sarabun-Bold.ttf"));
  return { regular: _regular, bold: _bold };
}

function thb(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskAccount(n) {
  const s = String(n || "").replace(/\s+/g, "");
  return s.length > 4 ? `${"x".repeat(s.length - 4)}${s.slice(-4)}` : s;
}

function formatDate(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Bangkok",
    });
  } catch (e) {
    return "";
  }
}

function deviceLines(job) {
  const devices = Array.isArray(job.devices) ? job.devices : [];
  if (devices.length === 0) {
    return job.model ? [{ name: job.model, price: job.price }] : [];
  }
  return devices.map((d) => {
    if (!d || typeof d !== "object") return { name: String(d || "อุปกรณ์"), price: null };
    return { name: d.model || d.name || d.title || "อุปกรณ์", price: d.finalPrice ?? d.price ?? null };
  });
}

/**
 * Render the payment voucher for a paid job. Returns a Buffer of PDF bytes.
 * Layout: A4, company header, payee, itemised devices, net total, amount in
 * words, payment account (masked), legal note, and two signature blocks.
 */
async function buildVoucherPdf(job) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]); // A4 in points
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);

  let y = height - M;

  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    page.drawText(String(t == null ? "" : t), { x, y: opts.y != null ? opts.y : y, size, font: f, color: opts.color || black });
  };
  const drawRight = (t, rightX, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    const x = rightX - widthOf(t, size, f);
    draw(t, x, size, opts);
  };
  const hr = (yy, x1 = M, x2 = width - M, color = lineColor) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.8, color });
  // Word-wrap by character (Thai has no inter-word spaces).
  const wrap = (t, size, f, maxW) => {
    const s = String(t == null ? "" : t);
    const out = [];
    let cur = "";
    for (const ch of s) {
      if (cur && widthOf(cur + ch, size, f) > maxW) {
        out.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    const f = opts.bold ? fontB : font;
    for (const ln of wrap(t, size, f, maxW)) {
      draw(ln, x, size, opts);
      y -= lineH;
    }
  };

  // ── Company header ─────────────────────────────────────────────────────────
  draw(COMPANY.legalName, M, 16, { bold: true });
  y -= 18;
  draw(`เลขประจำตัวผู้เสียภาษี ${COMPANY.taxId}`, M, 10, { color: gray });
  y -= 14;
  drawWrapped(COMPANY.address, M, 10, contentW, 13, { color: gray });

  // ── Title ──────────────────────────────────────────────────────────────────
  y -= 14;
  const title = "ใบสำคัญรับเงิน";
  draw(title, (width - widthOf(title, 22, fontB)) / 2, 22, { bold: true });
  y -= 18;
  const subtitle = "Payment Voucher";
  draw(subtitle, (width - widthOf(subtitle, 11, font)) / 2, 11, { color: gray });
  y -= 24;

  // ── Document meta (no. / date) ──────────────────────────────────────────────
  draw(`เลขที่เอกสาร: ${job.ref_no || "-"}`, M, 11);
  drawRight(`วันที่: ${formatDate(job.paid_at) || "-"}`, width - M, 11);
  y -= 22;

  // ── Payee ───────────────────────────────────────────────────────────────────
  draw("ได้รับเงินจาก (ผู้จ่ายเงิน):", M, 11, { color: gray });
  y -= 15;
  draw(COMPANY.legalName, M + 12, 11, { bold: true });
  y -= 20;
  draw("ผู้รับเงิน:", M, 11, { color: gray });
  y -= 15;
  draw(job.cust_name || "-", M + 12, 11, { bold: true });
  y -= 16;
  const payeeAddr = job.cust_id_address || job.cust_address;
  if (payeeAddr) {
    draw("ที่อยู่:", M, 10, { color: gray });
    drawWrapped(payeeAddr, M + 36, 10, contentW - 36, 13, { color: black });
    y -= 4;
  }
  y -= 8;

  // ── Items table ─────────────────────────────────────────────────────────────
  const amountColX = width - M; // right edge for amounts
  hr(y + 4);
  y -= 12;
  draw("รายการ", M, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน (บาท)", amountColX, 11, { bold: true, color: gray });
  y -= 8;
  hr(y + 2);
  y -= 16;

  const lines = deviceLines(job);
  for (const d of lines) {
    drawWrappedRow(d.name, d.price);
  }
  function drawWrappedRow(name, price) {
    const maxNameW = contentW - 120;
    const nameLines = wrap(name, 11, font, maxNameW);
    nameLines.forEach((ln, i) => {
      draw(ln, M, 11);
      if (i === 0 && price != null) drawRight(thb(price), amountColX, 11);
      y -= 16;
    });
  }

  y -= 4;
  hr(y + 6);
  y -= 14;
  const net = Number(job.net_payout ?? job.price) || 0;

  // VAT-registered: show the service fee (pickup_fee) as a deduction with its
  // 7% output VAT backed out (fee treated as VAT-inclusive).
  const fee = serviceFeeBreakdown(job);
  if (fee) {
    draw("รวมราคารับซื้อ", M, 11, { color: gray });
    drawRight(thb(net + fee.feeIncl), amountColX, 11, { color: gray });
    y -= 16;
    draw("หักค่าบริการรับเครื่อง (รวม VAT)", M, 11, { color: gray });
    drawRight(`-${thb(fee.feeIncl)}`, amountColX, 11, { color: gray });
    y -= 14;
    draw(`(ค่าบริการ ${thb(fee.base)} + VAT 7% ${thb(fee.vat)})`, M + 12, 9, { color: gray });
    y -= 16;
  }

  draw("ยอดรับสุทธิ", M, 13, { bold: true });
  drawRight(thb(net), amountColX, 13, { bold: true, color: rgb(0.02, 0.45, 0.34) });
  y -= 20;

  // Amount in words
  const words = bahtText(net);
  if (words) {
    draw(`จำนวนเงิน (ตัวอักษร): (${words})`, M, 11, { color: black });
    y -= 22;
  }

  // ── Payment account ─────────────────────────────────────────────────────────
  const pi = job.payment_info || {};
  if (pi.bank || pi.account_number || pi.account_name) {
    const parts = [
      pi.bank && `ธนาคาร ${pi.bank}`,
      pi.account_name && `ชื่อบัญชี ${pi.account_name}`,
      pi.account_number && `เลขบัญชี ${maskAccount(pi.account_number)}`,
    ].filter(Boolean);
    drawWrapped(`ชำระโดยโอนเข้าบัญชี: ${parts.join("  /  ")}`, M, 10, contentW, 13, { color: gray });
    y -= 6;
  }

  // ── Legal note ──────────────────────────────────────────────────────────────
  y -= 6;
  const note =
    `เนื่องจากผู้รับเงินเป็นบุคคลธรรมดาซึ่งไม่สามารถออกใบเสร็จรับเงินได้ ${COMPANY.legalName} ` +
    `จึงออกใบสำคัญรับเงินฉบับนี้ไว้เป็นหลักฐานการจ่ายเงินเพื่อประกอบการบันทึกบัญชีและภาษีตามกฎหมาย`;
  drawWrapped(note, M, 9, contentW, 12, { color: gray });

  // ── Signatures ──────────────────────────────────────────────────────────────
  const sigY = Math.max(y - 50, 110);
  const colW = contentW / 2;
  const sigLineLen = 150;
  const leftCenter = M + colW / 2;
  const rightCenter = M + colW + colW / 2;
  page.drawLine({
    start: { x: leftCenter - sigLineLen / 2, y: sigY },
    end: { x: leftCenter + sigLineLen / 2, y: sigY },
    thickness: 0.8,
    color: lineColor,
  });
  page.drawLine({
    start: { x: rightCenter - sigLineLen / 2, y: sigY },
    end: { x: rightCenter + sigLineLen / 2, y: sigY },
    thickness: 0.8,
    color: lineColor,
  });
  const sigLabel = (label, center) => {
    const w = widthOf(label, 10, font);
    page.drawText(label, { x: center - w / 2, y: sigY - 16, size: 10, font, color: black });
  };
  sigLabel("ลงชื่อผู้รับเงิน", leftCenter);
  sigLabel("ลงชื่อผู้จ่ายเงิน", rightCenter);
  const dateLabel = "(.........../.........../...........)";
  const dw = widthOf(dateLabel, 9, font);
  page.drawText(dateLabel, { x: leftCenter - dw / 2, y: sigY - 32, size: 9, font, color: gray });
  page.drawText(dateLabel, { x: rightCenter - dw / 2, y: sigY - 32, size: 9, font, color: gray });

  // Footer
  page.drawText(
    `${COMPANY.legalName} (${COMPANY.tradeName}) • ออกโดยระบบอัตโนมัติ`,
    { x: M, y: 50, size: 8, font, color: gray }
  );

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

module.exports = { buildVoucherPdf };
