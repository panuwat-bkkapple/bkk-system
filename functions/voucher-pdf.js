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
const { companyOf, bahtText, serviceFeeBreakdown } = require("./email");
// กฎการตัดบรรทัดภาษาไทย — pure มี unit test ห้ามก๊อปกฎมาไว้ที่นี่
const { wrapText } = require("./hr-documents");

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
async function buildVoucherPdf(job, kyc) {
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
  const CO = companyOf(job);

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
  draw(CO.legalName, M, 16, { bold: true });
  y -= 18;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId}`, M, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M, 10, contentW, 13, { color: gray });

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
  // วันที่ = เวลาโอนจริงตามสลิป (transferred_at) ถ้ามี ไม่งั้น fallback paid_at
  drawRight(`วันที่: ${formatDate(job.transferred_at || job.paid_at) || "-"}`, width - M, 11);
  y -= 22;

  // ── Payee ───────────────────────────────────────────────────────────────────
  draw("ได้รับเงินจาก (ผู้จ่ายเงิน):", M, 11, { color: gray });
  y -= 15;
  draw(CO.legalName, M + 12, 11, { bold: true });
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
    draw("ราคารับซื้อเครื่อง (เราจ่ายคุณ)", M, 11, { color: gray });
    drawRight(thb(net + fee.feeIncl), amountColX, 11, { color: gray });
    y -= 16;
    draw("ค่าบริการรับเครื่อง (คุณชำระเรา รวม VAT)", M, 11, { color: gray });
    drawRight(`-${thb(fee.feeIncl)}`, amountColX, 11, { color: gray });
    y -= 14;
    draw(
      fee.discountBase
        ? `(ค่าบริการ ${thb(fee.grossBase)} − ส่วนลด ${thb(fee.discountBase)} = ${thb(fee.base)} + VAT 7% ${thb(fee.vat)})`
        : `(ค่าบริการ ${thb(fee.base)} + VAT 7% ${thb(fee.vat)})`,
      M + 12,
      9,
      { color: gray },
    );
    y -= 14;
    // การซื้อเครื่องกับการขายบริการรับเครื่องเป็นคนละธุรกรรม เดินคนละทิศ และ
    // ลงบัญชีแยกกัน — ใบกำกับภาษีจึงเป็นคนละฉบับ. แต่เงินหักกลบกันจริงตอนโอน
    // ใบสำคัญรับเงินจึงต้องโชว์การหักกลบให้ตรงกับสลิป แล้วชี้ไปยังอีกฉบับ
    draw("(ค่าบริการส่วนนี้ออกใบกำกับภาษีแยกอีกฉบับ อ้างอิงเลขที่คำสั่งขายเดียวกัน)", M + 12, 9, { color: gray });
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

  // ── Legal note + หลักฐานประกอบ ─────────────────────────────────────────────
  //
  // ธุรกรรมนี้ไม่มีการลงลายมือชื่อผู้รับเงิน (จ่ายด้วยการโอนเข้าบัญชี ไม่มี
  // การพบหน้าตอนจ่าย) — ฝ่ายบัญชียืนยันว่าใช้ **หลักฐานการโอน + สำเนาบัตร
  // ประชาชนที่เก็บตอน KYC** แทนได้. เอกสารจึงต้องระบุว่าหลักฐานคืออะไรและ
  // อยู่ที่ไหน แทนการพิมพ์เส้นลายเซ็นเปล่าที่ไม่มีวันถูกเซ็น ซึ่งทำให้เอกสาร
  // ที่เก็บไว้ดูเหมือนทำไม่เสร็จ
  y -= 6;
  const note =
    `เนื่องจากผู้รับเงินเป็นบุคคลธรรมดาซึ่งไม่สามารถออกใบเสร็จรับเงินได้ ${CO.legalName} ` +
    `จึงออกใบสำคัญรับเงินฉบับนี้ไว้เป็นหลักฐานการจ่ายเงินเพื่อประกอบการบันทึกบัญชีและภาษีตามกฎหมาย`;
  drawWrapped(note, M, 9, contentW, 12, { color: gray });
  y -= 6;

  const evidence = ["หลักฐานการโอนเงินเข้าบัญชีผู้รับเงินตามที่ระบุข้างต้น"];
  const nid = kyc && (kyc.id_number || kyc.nid);
  const nidTail = nid ? String(nid).replace(/\D/g, "").slice(-4) : "";
  evidence.push(
    nidTail
      ? `สำเนาบัตรประจำตัวประชาชนผู้รับเงิน (เลขที่ลงท้าย ${nidTail}) จัดเก็บไว้ในระบบ`
      : "สำเนาบัตรประจำตัวประชาชนผู้รับเงินที่จัดเก็บไว้ในระบบ",
  );
  drawWrapped(`หลักฐานประกอบการจ่ายเงิน: ${evidence.join(" และ ")}`, M, 9, contentW, 12, { color: gray });

  // ── Signature (ผู้จ่ายเงินเท่านั้น) ─────────────────────────────────────────
  const sigY = Math.max(y - 50, 110);
  const colW = contentW / 2;
  const sigLineLen = 150;
  const rightCenter = M + colW + colW / 2;
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
  sigLabel("ลงชื่อผู้มีอำนาจจ่ายเงิน", rightCenter);
  const dateLabel = "(.........../.........../...........)";
  const dw = widthOf(dateLabel, 9, font);
  page.drawText(dateLabel, { x: rightCenter - dw / 2, y: sigY - 32, size: 9, font, color: gray });

  // Footer
  page.drawText(
    `${CO.legalName} (${CO.tradeName}) • ออกโดยระบบอัตโนมัติ`,
    { x: M, y: 50, size: 8, font, color: gray }
  );

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/**
 * Render the ใบกำกับภาษี/ใบเสร็จรับเงิน for the pickup SERVICE fee (the company
 * is the seller of the service here, so this is a real tax invoice under
 * ป.รัษฎากร ม.86/4). `taxInvoice` carries the allocated running number + issue
 * date; amounts come from serviceFeeBreakdown(job). Returns a Buffer, or null
 * when there's no service fee.
 */
/**
 * ป้ายกำกับใต้ชื่อเอกสารสำหรับใบกำกับภาษี
 *
 * ตราบใดที่ยังไม่ได้ขึ้นระบบ e-Tax Invoice ของกรมสรรพากร (e-Tax Invoice by
 * Email หรือ e-Tax Invoice & e-Receipt) ไฟล์ PDF ที่ส่งอีเมลไป **ไม่ใช่**
 * ใบกำกับภาษีอิเล็กทรอนิกส์ตามกฎหมาย ต้นฉบับต้องเป็นเอกสารกระดาษ ไฟล์นี้จึง
 * ต้องบอกตัวเองว่าเป็นสำเนา ไม่งั้นทั้งลูกค้าและผู้ตรวจจะนับเป็นต้นฉบับใบที่สอง
 */
function taxDocCopyMark(etaxEnabled) {
  return etaxEnabled ? "" : "สำเนา — ต้นฉบับออกเป็นเอกสารกระดาษ";
}

async function buildTaxInvoicePdf(job, taxInvoice) {
  const fee = serviceFeeBreakdown(job);
  if (!fee) return null;

  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);
  const CO = companyOf(job);
  let y = height - M;

  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) =>
    page.drawText(String(t == null ? "" : t), {
      x,
      y: opts.y != null ? opts.y : y,
      size,
      font: opts.bold ? fontB : font,
      color: opts.color || black,
    });
  const drawRight = (t, rightX, size, opts = {}) =>
    draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor });
  const wrap = (t, size, f, maxW) => {
    const s = String(t == null ? "" : t);
    const out = [];
    let cur = "";
    for (const ch of s) {
      if (cur && widthOf(cur + ch, size, f) > maxW) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) {
      draw(ln, x, size, opts);
      y -= lineH;
    }
  };

  // Seller header (the company sells the service)
  draw(CO.legalName, M, 16, { bold: true });
  y -= 18;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M, 10, contentW, 13, { color: gray });

  // Title
  y -= 14;
  const title = "ใบกำกับภาษี / ใบเสร็จรับเงิน";
  draw(title, (width - widthOf(title, 20, fontB)) / 2, 20, { bold: true });
  y -= 16;
  const subtitle = "Tax Invoice / Receipt";
  draw(subtitle, (width - widthOf(subtitle, 11, font)) / 2, 11, { color: gray });
  y -= 14;
  const copyMark = taxDocCopyMark(job && job._accounting && job._accounting.etax_enabled);
  if (copyMark) {
    draw(copyMark, (width - widthOf(copyMark, 10, font)) / 2, 10, { color: gray });
    y -= 16;
  }
  y -= 12;

  // Meta
  draw(`เลขที่ใบกำกับภาษี: ${taxInvoice.number || "-"}`, M, 11, { bold: true });
  drawRight(`วันที่: ${formatDate(taxInvoice.issued_at) || "-"}`, width - M, 11);
  y -= 16;
  if (job.ref_no) {
    draw(`อ้างอิงคำสั่งซื้อ: ${job.ref_no}`, M, 10, { color: gray });
    y -= 20;
  } else {
    y -= 4;
  }

  // Buyer (customer)
  draw("ลูกค้า (ผู้ซื้อบริการ):", M, 11, { color: gray });
  y -= 15;
  draw(job.cust_name || "-", M + 12, 11, { bold: true });
  y -= 16;
  const buyerAddr = job.cust_id_address || job.cust_address;
  if (buyerAddr) {
    draw("ที่อยู่:", M, 10, { color: gray });
    drawWrapped(buyerAddr, M + 36, 10, contentW - 36, 13);
    y -= 4;
  }
  y -= 10;

  // Line item table
  const amountX = width - M;
  hr(y + 4);
  y -= 12;
  draw("รายการ", M, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน (บาท)", amountX, 11, { bold: true, color: gray });
  y -= 8;
  hr(y + 2);
  y -= 16;
  // ม.79(1): ส่วนลดจะกันออกจากฐานภาษีได้ต่อเมื่อ "แสดงส่วนลดไว้ในใบกำกับภาษี
  // ให้ชัดแจ้ง" — เมื่อมีส่วนลดจึงต้องพิมพ์ราคาก่อนลดและตัวส่วนลดเป็นบรรทัด
  // ของมันเอง แล้วค่อยลงมูลค่าสุทธิ ห้ามพิมพ์แต่ยอดที่หักแล้ว
  draw("ค่าบริการรับเครื่องถึงที่ (Pickup Service)", M, 11);
  drawRight(thb(fee.discountBase ? fee.grossBase : fee.base), amountX, 11);
  y -= 20;
  if (fee.discountBase) {
    draw("หัก ส่วนลดค่าบริการ (โปรโมชั่น)", M, 11);
    drawRight(`-${thb(fee.discountBase)}`, amountX, 11);
    y -= 20;
  }
  hr(y + 6);
  y -= 14;
  draw("มูลค่าบริการ (ก่อน VAT)", M, 11, { color: gray });
  drawRight(thb(fee.base), amountX, 11, { color: gray });
  y -= 16;
  draw("ภาษีมูลค่าเพิ่ม 7%", M, 11, { color: gray });
  drawRight(thb(fee.vat), amountX, 11, { color: gray });
  y -= 16;
  draw("จำนวนเงินรวมทั้งสิ้น", M, 13, { bold: true });
  drawRight(thb(fee.feeIncl), amountX, 13, { bold: true, color: rgb(0.02, 0.45, 0.34) });
  y -= 20;

  const words = bahtText(fee.feeIncl);
  if (words) {
    draw(`(${words})`, M, 11);
    y -= 22;
  }

  draw(
    "หมายเหตุ: ค่าบริการนี้หักจากยอดรับซื้อเครื่องของลูกค้า (ดูใบสำคัญรับเงินประกอบ)",
    M,
    9,
    { color: gray }
  );

  // Signature (issuer)
  const sigY = Math.max(y - 60, 120);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้รับเงิน / ผู้มีอำนาจออกใบกำกับภาษี";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });

  page.drawText(`${CO.legalName} (${CO.tradeName}) • ออกโดยระบบอัตโนมัติ`, {
    x: M,
    y: 50,
    size: 8,
    font,
    color: gray,
  });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/**
 * Sales tax invoice (ใบกำกับภาษี/ใบเสร็จรับเงิน) for a POS sale of goods.
 * `sale` is a /sales record; `ti` has the allocated number + base/vat/total;
 * `company` is the resolved seller identity. When the buyer gives no tax id /
 * address it renders an abbreviated tax invoice (ใบกำกับภาษีอย่างย่อ, ม.86/6),
 * which is allowed for retail sales to the general public.
 */
async function buildSalesTaxInvoicePdf(sale, ti, company, etaxEnabled) {
  const CO = companyOf({ _company: company || {} });
  const isFull = Boolean(sale.customer_tax_id || sale.customer_address);

  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);
  let y = height - M;

  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) =>
    page.drawText(String(t == null ? "" : t), { x, y: opts.y != null ? opts.y : y, size, font: opts.bold ? fontB : font, color: opts.color || black });
  const drawRight = (t, rightX, size, opts = {}) => draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor });
  const wrap = (t, size, f, maxW) => {
    const s = String(t == null ? "" : t); const out = []; let cur = "";
    for (const ch of s) { if (cur && widthOf(cur + ch, size, f) > maxW) { out.push(cur); cur = ch; } else cur += ch; }
    if (cur) out.push(cur); return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) { draw(ln, x, size, opts); y -= lineH; }
  };

  // Seller header
  draw(CO.legalName, M, 16, { bold: true });
  y -= 18;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M, 10, contentW, 13, { color: gray });

  // Title
  y -= 14;
  const title = isFull ? "ใบกำกับภาษี / ใบเสร็จรับเงิน" : "ใบกำกับภาษีอย่างย่อ / ใบเสร็จรับเงิน";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 14;
  const salesCopyMark = taxDocCopyMark(etaxEnabled);
  if (salesCopyMark) {
    draw(salesCopyMark, (width - widthOf(salesCopyMark, 10, font)) / 2, 10, { color: gray });
    y -= 16;
  }
  y -= 12;

  // Meta
  draw(`เลขที่ใบกำกับภาษี: ${ti.number || "-"}`, M, 11, { bold: true });
  drawRight(`วันที่: ${formatDate(sale.sold_at) || "-"}`, width - M, 11);
  y -= 15;
  if (sale.receipt_no) { draw(`เลขที่ใบเสร็จ: ${sale.receipt_no}`, M, 10, { color: gray }); y -= 16; }

  // Buyer
  draw("ลูกค้า:", M, 11, { color: gray });
  draw(sale.customer_name || "ลูกค้าทั่วไป", M + 42, 11, { bold: true });
  y -= 15;
  if (isFull) {
    if (sale.customer_tax_id) { draw(`เลขผู้เสียภาษี: ${sale.customer_tax_id}`, M, 10, { color: gray }); y -= 14; }
    if (sale.customer_address) { draw("ที่อยู่:", M, 10, { color: gray }); drawWrapped(sale.customer_address, M + 36, 10, contentW - 36, 13); }
  }
  y -= 10;

  // Items table
  const colQty = width - M - 200;
  const colPrice = width - M - 110;
  const colAmt = width - M;
  hr(y + 4); y -= 12;
  draw("รายการ", M, 11, { bold: true, color: gray });
  drawRight("จำนวน", colQty + 30, 11, { bold: true, color: gray });
  drawRight("ราคา", colPrice + 40, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน", colAmt, 11, { bold: true, color: gray });
  y -= 8; hr(y + 2); y -= 16;

  const items = Array.isArray(sale.items) ? sale.items : [];
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    const price = Number(it.price) || 0;
    const nameLines = wrap(`${it.name || "สินค้า"}${it.code ? ` (${it.code})` : ""}`, 10, font, colQty - M - 8);
    nameLines.forEach((ln, i) => {
      draw(ln, M, 10);
      if (i === 0) {
        drawRight(String(qty), colQty + 30, 10);
        drawRight(thb(price), colPrice + 40, 10);
        drawRight(thb(price * qty), colAmt, 10);
      }
      y -= 15;
    });
  }

  y -= 4; hr(y + 6); y -= 14;
  if (Number(sale.discount) > 0) {
    draw("ส่วนลด", M, 11, { color: gray });
    drawRight(`-${thb(sale.discount)}`, colAmt, 11, { color: gray });
    y -= 16;
  }
  // VAT breakdown (prices are VAT-inclusive)
  draw("มูลค่าสินค้า (ก่อน VAT)", M, 11, { color: gray });
  drawRight(thb(ti.base), colAmt, 11, { color: gray });
  y -= 16;
  draw("ภาษีมูลค่าเพิ่ม 7%", M, 11, { color: gray });
  drawRight(thb(ti.vat), colAmt, 11, { color: gray });
  y -= 16;
  draw("ยอดรวมทั้งสิ้น", M, 13, { bold: true });
  drawRight(thb(ti.total), colAmt, 13, { bold: true, color: rgb(0.02, 0.45, 0.34) });
  y -= 20;

  const words = bahtText(ti.total);
  if (words) { draw(`(${words})`, M, 11); y -= 18; }
  if (sale.payment_method) { draw(`ชำระโดย: ${sale.payment_method}`, M, 10, { color: gray }); y -= 16; }

  // Signature
  const sigY = Math.max(y - 50, 120);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้รับเงิน / ผู้มีอำนาจออกใบกำกับภาษี";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });
  page.drawText(`${CO.legalName} (${CO.tradeName}) • ออกโดยระบบอัตโนมัติ`, { x: M, y: 50, size: 8, font, color: gray });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/**
 * ใบเสนอราคา (Quotation) สำหรับคำสั่งซื้อดีลเลอร์ (dealer_orders record).
 * แทนที่การคีย์ใบเสนอราคามือในโปรแกรมแยก — ออกอัตโนมัติตอน award.
 * ยอด order.amount เป็น VAT-inclusive; แตก base/VAT ให้เห็นเพื่อความชัดเจน
 * (ใบกำกับภาษีจริงออกทีหลังตอนชำระเงินผ่าน onSaleCreated)
 */
async function buildQuotationPdf(order, company) {
  const CO = companyOf({ _company: company || {} });
  const ds = order.dealer_snapshot || {};
  const vatRate = Number(order.vat_rate) > 0 ? Number(order.vat_rate) : 0.07;
  const total = Number(order.amount) || 0;
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const base = round2(total / (1 + vatRate));
  const vat = round2(total - base);

  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);
  let y = height - M;

  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) =>
    page.drawText(String(t == null ? "" : t), { x, y: opts.y != null ? opts.y : y, size, font: opts.bold ? fontB : font, color: opts.color || black });
  const drawRight = (t, rightX, size, opts = {}) => draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor });
  const wrap = (t, size, f, maxW) => {
    const s = String(t == null ? "" : t); const out = []; let cur = "";
    for (const ch of s) { if (cur && widthOf(cur + ch, size, f) > maxW) { out.push(cur); cur = ch; } else cur += ch; }
    if (cur) out.push(cur); return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) { draw(ln, x, size, opts); y -= lineH; }
  };

  // Seller header
  draw(CO.legalName, M, 16, { bold: true });
  y -= 18;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M, 10, contentW, 13, { color: gray });

  // Title
  y -= 14;
  const title = "ใบเสนอราคา / Quotation";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 26;

  // Meta
  draw(`เลขที่: ${(order.quotation && order.quotation.number) || "-"}`, M, 11, { bold: true });
  drawRight(`วันที่: ${formatDate((order.quotation && order.quotation.issued_at) || Date.now()) || "-"}`, width - M, 11);
  y -= 15;
  draw(`อ้างอิง: ล็อต ${order.lot_no || "-"} · คำสั่งซื้อ ${order.order_no || "-"}`, M, 10, { color: gray });
  y -= 16;

  // Buyer
  draw("เสนอต่อ:", M, 11, { color: gray });
  draw(ds.company_name || "-", M + 52, 11, { bold: true });
  y -= 15;
  if (ds.tax_id) { draw(`เลขผู้เสียภาษี: ${ds.tax_id}`, M, 10, { color: gray }); y -= 14; }
  if (ds.address) { draw("ที่อยู่:", M, 10, { color: gray }); drawWrapped(ds.address, M + 36, 10, contentW - 36, 13); }
  y -= 10;

  // Items table
  const colAmt = width - M;
  hr(y + 4); y -= 12;
  draw("รายการ", M, 11, { bold: true, color: gray });
  drawRight("ราคาเสนอ", colAmt, 11, { bold: true, color: gray });
  y -= 8; hr(y + 2); y -= 16;

  const items = Object.values(order.items || {});
  const wholeLot = order.type === "whole_lot";
  for (const it of items) {
    if (y < 170) break; // กันตกขอบหน้า (lot ใหญ่มากใช้บรรทัดสรุปแทน)
    const label = `${it.model || "สินค้า"}${it.ref_no ? ` (${it.ref_no})` : ""}`;
    const nameLines = wrap(label, 10, font, contentW - 120);
    nameLines.forEach((ln, i) => {
      draw(ln, M, 10);
      if (i === 0) drawRight(wholeLot ? "-" : thb(it.amount), colAmt, 10);
      y -= 15;
    });
  }
  if (wholeLot) {
    draw(`เหมายกล็อต ${items.length} เครื่อง`, M, 10, { color: gray });
    drawRight(thb(total), colAmt, 10, { bold: true });
    y -= 15;
  }

  y -= 4; hr(y + 6); y -= 14;
  draw("มูลค่าก่อนภาษี", M, 11, { color: gray });
  drawRight(thb(base), colAmt, 11, { color: gray });
  y -= 16;
  draw(`ภาษีมูลค่าเพิ่ม ${Math.round(vatRate * 100)}%`, M, 11, { color: gray });
  drawRight(thb(vat), colAmt, 11, { color: gray });
  y -= 16;
  draw("ยอดรวมทั้งสิ้น (รวม VAT)", M, 13, { bold: true });
  drawRight(thb(total), colAmt, 13, { bold: true, color: rgb(0.02, 0.45, 0.34) });
  y -= 20;

  const words = bahtText(total);
  if (words) { draw(`(${words})`, M, 11); y -= 18; }

  // Payment info + validity
  const pay = order.payment_info || {};
  if (pay.account_no) {
    draw(`ชำระเงิน: ${pay.bank || ""} ${pay.account_no} (${pay.account_name || ""})`, M, 10, { color: gray });
    y -= 14;
  }
  draw("ใบเสนอราคานี้ออกจากผลการเสนอราคาในระบบ Dealer Portal — กรุณาชำระเงินตามยอดข้างต้นและแนบหลักฐานผ่านระบบ", M, 9, { color: gray });
  y -= 13;
  draw("ใบกำกับภาษี/ใบเสร็จรับเงินฉบับจริงจะออกให้เมื่อยืนยันการชำระเงินแล้ว", M, 9, { color: gray });

  // Signature
  const sigY = Math.max(y - 60, 110);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้มีอำนาจอนุมัติ";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });
  if (order.created_by) {
    page.drawText(`อนุมัติโดย: ${order.created_by}`, { x: cx - 75, y: sigY - 30, size: 8, font, color: gray });
  }
  page.drawText(`${CO.legalName} (${CO.tradeName}) • ออกโดยระบบอัตโนมัติ`, { x: M, y: 50, size: 8, font, color: gray });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/**
 * ใบลดหนี้ (Credit Note) สำหรับเคลม/คืนสินค้าฝั่งดีลเลอร์ — ออกเมื่ออนุมัติเคลม
 * หลังใบกำกับภาษีขายออกไปแล้ว (ม.86/10: ต้องอ้างใบกำกับเดิม + มูลค่าเดิม/ที่ถูกต้อง/
 * ผลต่าง + สาเหตุ) ยอด cn.total เป็น VAT-inclusive แตก base/vat มาแล้ว
 * data: { cn:{number,issued_at,base,vat,total}, orig:{number,issued_at,total},
 *         buyer:{company_name,tax_id,address}, claim:{claim_no,order_no,model,ref_no,reason} }
 */
async function buildCreditNotePdf(data, company) {
  const CO = companyOf({ _company: company || {} });
  const { cn, orig, buyer, claim } = data;

  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);
  let y = height - M;

  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) =>
    page.drawText(String(t == null ? "" : t), { x, y: opts.y != null ? opts.y : y, size, font: opts.bold ? fontB : font, color: opts.color || black });
  const drawRight = (t, rightX, size, opts = {}) => draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor });
  const wrap = (t, size, f, maxW) => {
    const s = String(t == null ? "" : t); const out = []; let cur = "";
    for (const ch of s) { if (cur && widthOf(cur + ch, size, f) > maxW) { out.push(cur); cur = ch; } else cur += ch; }
    if (cur) out.push(cur); return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) { draw(ln, x, size, opts); y -= lineH; }
  };

  // ผู้ออก (ผู้ขายเดิม)
  draw(CO.legalName, M, 16, { bold: true });
  y -= 18;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M, 10, contentW, 13, { color: gray });

  y -= 14;
  const title = "ใบลดหนี้ (Credit Note)";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 26;

  draw(`เลขที่ใบลดหนี้: ${cn.number || "-"}`, M, 11, { bold: true });
  drawRight(`วันที่: ${formatDate(cn.issued_at) || "-"}`, width - M, 11);
  y -= 18;

  // ผู้ซื้อ (ดีลเลอร์)
  draw("ลูกค้า:", M, 11, { color: gray });
  draw(buyer.company_name || "-", M + 42, 11, { bold: true });
  y -= 15;
  if (buyer.tax_id) { draw(`เลขผู้เสียภาษี: ${buyer.tax_id}`, M, 10, { color: gray }); y -= 14; }
  if (buyer.address) { draw("ที่อยู่:", M, 10, { color: gray }); drawWrapped(buyer.address, M + 36, 10, contentW - 36, 13); }
  y -= 8;

  // อ้างอิงใบกำกับภาษีเดิม (บังคับตาม ม.86/10)
  hr(y + 4); y -= 14;
  draw("อ้างอิงใบกำกับภาษีเดิม", M, 11, { bold: true });
  y -= 16;
  draw(`เลขที่: ${orig.number || "-"}`, M, 10);
  drawRight(`วันที่: ${formatDate(orig.issued_at) || "-"}`, width - M, 10);
  y -= 14;
  if (claim.order_no) { draw(`คำสั่งซื้อ: ${claim.order_no}`, M, 10, { color: gray }); y -= 14; }
  y -= 4;

  // รายการที่ลดหนี้
  const colAmt = width - M;
  hr(y + 4); y -= 12;
  draw("รายการ", M, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน", colAmt, 11, { bold: true, color: gray });
  y -= 8; hr(y + 2); y -= 16;
  drawWrapped(
    `คืนสินค้า/เคลม: ${claim.model || "-"}${claim.ref_no ? ` (${claim.ref_no})` : ""} — ใบเคลม ${claim.claim_no || "-"}`,
    M, 10, contentW - 110, 15
  );
  drawRight(thb(cn.total), colAmt, 10, { y: y + 15 });
  y -= 4;
  if (claim.reason) {
    drawWrapped(`สาเหตุ: ${claim.reason}`, M, 9.5, contentW, 13, { color: gray });
    y -= 2;
  }

  // มูลค่าเดิม / ที่ถูกต้อง / ผลต่าง
  y -= 4; hr(y + 6); y -= 14;
  const origTotal = Number(orig.total) || 0;
  draw("มูลค่าตามใบกำกับภาษีเดิม", M, 11, { color: gray });
  drawRight(thb(origTotal), colAmt, 11, { color: gray });
  y -= 16;
  draw("มูลค่าที่ถูกต้อง", M, 11, { color: gray });
  drawRight(thb(Math.max(0, origTotal - (Number(cn.total) || 0))), colAmt, 11, { color: gray });
  y -= 16;
  draw("ผลต่าง (ก่อน VAT)", M, 11, { color: gray });
  drawRight(thb(cn.base), colAmt, 11, { color: gray });
  y -= 16;
  draw("ภาษีมูลค่าเพิ่มที่ลด 7%", M, 11, { color: gray });
  drawRight(thb(cn.vat), colAmt, 11, { color: gray });
  y -= 16;
  draw("รวมมูลค่าที่ลดหนี้ทั้งสิ้น", M, 13, { bold: true });
  drawRight(thb(cn.total), colAmt, 13, { bold: true, color: rgb(0.7, 0.15, 0.12) });
  y -= 20;
  const words = bahtText(cn.total);
  if (words) { draw(`(${words})`, M, 11); y -= 18; }

  // ลายเซ็น
  const sigY = Math.max(y - 50, 120);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้มีอำนาจออกใบลดหนี้";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });
  page.drawText(`${CO.legalName} (GETMOBIE) • ออกโดยระบบอัตโนมัติ`, { x: M, y: 50, size: 8, font, color: gray });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}


/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) สำหรับค่าตอบแทนไรเดอร์อิสระ
 *
 * ตาม ม.50 ทวิ ผู้จ่ายเงินได้ที่มีหน้าที่หักภาษี ณ ที่จ่ายต้องออกหนังสือรับรอง
 * ให้ผู้ถูกหัก **ทุกครั้งที่มีการหัก** — ระบบจึงออกให้ต่อการถอนหนึ่งครั้ง
 * ไม่ใช่สรุปรวมท้ายเดือน (ยอดรวมรายเดือนใช้ตอนยื่น ภ.ง.ด.3 คนละใบกัน)
 *
 * ประเภทเงินได้ = ค่าจ้างทำของ/ค่าบริการ ตามมาตรา 40(8) ซึ่งเป็นช่องที่
 * ค่าตอบแทนงานขนส่งรายเที่ยวของผู้รับจ้างอิสระตกอยู่โดยทั่วไป — ถ้าผู้สอบบัญชี
 * จัดประเภทเป็นช่องอื่น ต้องแก้ทั้งข้อความในเอกสารและช่องที่กรอกใน ภ.ง.ด.3
 */
async function buildWhtCertificatePdf({ rider, cert, company }) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);
  const CO = { ...companyOf({}), ...(company || {}) };

  let y = height - M;
  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    page.drawText(String(t == null ? "" : t), { x, y: opts.y != null ? opts.y : y, size, font: f, color: opts.color || black });
  };
  const drawRight = (t, rightX, size, opts = {}) => draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor });
  const wrap = (t, size, f, maxW) => {
    const str = String(t == null ? "" : t);
    const out = []; let cur = "";
    for (const ch of str) {
      if (cur && widthOf(cur + ch, size, f) > maxW) { out.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) { draw(ln, x, size, opts); y -= lineH; }
  };

  // หัวเอกสาร
  const title = "หนังสือรับรองการหักภาษี ณ ที่จ่าย";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 18;
  const sub = "ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร";
  draw(sub, (width - widthOf(sub, 10, font)) / 2, 10, { color: gray });
  y -= 26;

  draw(`เลขที่: ${cert.number || "-"}`, M, 11, { bold: true });
  drawRight(`วันที่จ่ายเงิน: ${formatDate(cert.paid_at) || "-"}`, width - M, 11);
  y -= 22;

  // ผู้มีหน้าที่หักภาษี ณ ที่จ่าย
  hr(y + 6); y -= 14;
  draw("ผู้มีหน้าที่หักภาษี ณ ที่จ่าย", M, 11, { bold: true });
  y -= 16;
  draw(CO.legalName, M + 12, 11);
  y -= 15;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M + 12, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M + 12, 10, contentW - 12, 13, { color: gray });
  y -= 10;

  // ผู้ถูกหักภาษี ณ ที่จ่าย
  hr(y + 6); y -= 14;
  draw("ผู้ถูกหักภาษี ณ ที่จ่าย", M, 11, { bold: true });
  y -= 16;
  draw(rider.name || "-", M + 12, 11);
  y -= 15;
  draw(`เลขประจำตัวผู้เสียภาษี/บัตรประชาชน ${rider.tax_id || "-"}`, M + 12, 10, { color: gray });
  y -= 14;
  if (rider.tax_address) drawWrapped(rider.tax_address, M + 12, 10, contentW - 12, 13, { color: gray });
  y -= 12;

  // ตารางเงินได้
  hr(y + 6); y -= 14;
  draw("ประเภทเงินได้พึงประเมินที่จ่าย", M, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน (บาท)", width - M, 11, { bold: true, color: gray });
  y -= 8; hr(y + 2); y -= 16;
  draw("ค่าจ้างทำของ/ค่าบริการ ตามมาตรา 40(8)", M, 11);
  drawRight(thb(cert.gross), width - M, 11);
  y -= 16;
  draw("(ค่าตอบแทนงานรับ-ส่งอุปกรณ์)", M + 12, 9, { color: gray });
  y -= 14;
  // ยอดถอนที่มีเงินคืนค่าทดรองปน — บอกให้ชัดว่าส่วนนั้นไม่ใช่เงินได้และไม่ได้ถูกหัก
  // ไม่งั้นไรเดอร์เทียบกับสลิปแล้วเห็นว่า "จ่าย 1,065 แต่หนังสือรับรองบอก 1,000"
  if (Number(cert.exempt) > 0) {
    draw(`ยอดที่จ่ายรวม ${thb(cert.withdrawal_amount)} บาท มีเงินคืนค่าใช้จ่ายที่ผู้รับสำรองจ่าย ${thb(cert.exempt)} บาท ซึ่งไม่ใช่เงินได้พึงประเมินและไม่ได้หักภาษี`, M + 12, 9, { color: gray });
    y -= 14;
  }
  y -= 6;
  hr(y + 6); y -= 14;
  draw("รวมเงินที่จ่าย", M, 11, { color: gray });
  drawRight(thb(cert.gross), width - M, 11, { color: gray });
  y -= 16;
  draw(`ภาษีที่หักและนำส่ง (${cert.rate_percent}%)`, M, 13, { bold: true });
  drawRight(thb(cert.wht), width - M, 13, { bold: true, color: rgb(0.72, 0.11, 0.11) });
  y -= 18;
  draw("ยอดที่จ่ายจริงให้ผู้รับ", M, 11, { color: gray });
  drawRight(thb(cert.net), width - M, 11, { color: gray });
  y -= 20;

  const words = bahtText(cert.wht);
  if (words) { draw(`ภาษีที่หักไว้ (ตัวอักษร): (${words})`, M, 11); y -= 22; }

  draw("ผู้จ่ายเงินได้นำส่งภาษีที่หักไว้ต่อกรมสรรพากรตามแบบ ภ.ง.ด.3 ภายในกำหนดเวลา", M, 9, { color: gray });
  y -= 12;
  draw("ผู้ถูกหักภาษีสามารถใช้หนังสือรับรองฉบับนี้เป็นหลักฐานเครดิตภาษีในการยื่นแบบแสดงรายการภาษีเงินได้บุคคลธรรมดา", M, 9, { color: gray });

  // ลายเซ็นผู้จ่าย
  const sigY = Math.max(y - 60, 120);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้มีอำนาจลงนาม";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });

  page.drawText(`${CO.legalName} • ออกโดยระบบอัตโนมัติ`, { x: M, y: 50, size: 8, font, color: gray });
  return Buffer.from(await pdf.save());
}

/**
 * สลิปเงินเดือน — เอกสารที่พนักงานได้รับต่อหนึ่งงวด
 *
 * **สร้างสดทุกครั้ง ไม่เก็บลง Storage โดยตั้งใจ** — ต่างจากใบกำกับภาษีกับ
 * ใบสำคัญรับเงินซึ่งต้องมีสำเนาถาวรตามกฎหมาย สลิปเงินเดือนเป็นข้อมูลส่วนบุคคล
 * ที่ไฟล์ใน Storage จะมี URL ถือติดตัวไปได้ตลอด (capability URL) ส่วนตัวข้อมูล
 * จริงถูกแช่อยู่ในรอบที่อนุมัติแล้วอยู่แล้ว การ render ซ้ำจึงได้เอกสารเหมือนเดิม
 * เป๊ะโดยไม่ต้องมีไฟล์ลอยอยู่
 *
 * **กางที่มาของภาษีให้พนักงานเห็น** — สลิปที่บอกแค่ "หักภาษี 1,704.17" คือ
 * ตัวเลขที่เจ้าตัวตรวจไม่ได้ และภาษีหัก ณ ที่จ่ายเป็นเงินของเขาที่บริษัทถือไว้
 * นำส่งแทน เขาจึงมีสิทธิ์รู้ว่ามันมาจากไหน
 */
async function buildPayslipPdf({ employee, item, run, company }) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const red = rgb(0.72, 0.11, 0.11);
  const lineColor = rgb(0.85, 0.86, 0.88);
  const CO = { ...companyOf({}), ...(company || {}) };
  const emp = employee || {};
  const it = item || {};
  const basis = it.wht_basis || {};

  let y = height - M;
  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    page.drawText(String(t == null ? "" : t), {
      x, y: opts.y != null ? opts.y : y, size, font: f, color: opts.color || black,
    });
  };
  const drawRight = (t, rightX, size, opts = {}) =>
    draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({
    start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor,
  });

  // หัวเอกสาร
  const title = "สลิปเงินเดือน";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 18;
  const sub = `${CO.legalName}${CO.taxId ? ` · เลขประจำตัวผู้เสียภาษี ${CO.taxId}` : ""}`;
  draw(sub, (width - widthOf(sub, 9, font)) / 2, 9, { color: gray });
  y -= 24;

  hr(y + 6); y -= 15;
  draw(`งวด ${run.period || run.id || "-"}`, M, 11, { bold: true });
  const range = `${formatDate(run.period_from)} - ${formatDate(run.period_to)}`;
  draw(range, M + 90, 10, { color: gray });
  drawRight(`วันที่จ่าย ${formatDate(run.pay_date) || "-"}`, width - M, 10);
  y -= 20;

  // ตัวพนักงาน
  hr(y + 6); y -= 15;
  draw(emp.name || it.name || "-", M, 12, { bold: true });
  drawRight(String(it.employee_code || emp.employee_code || ""), width - M, 10, { color: gray });
  y -= 15;
  const meta = [emp.position, emp.department, emp.branch].filter(Boolean).join(" · ");
  if (meta) { draw(meta, M, 10, { color: gray }); y -= 14; }
  const channel = it.pay_method === "cash"
    ? "ช่องทางจ่าย: เงินสด"
    : `ช่องทางจ่าย: โอนเข้าบัญชี ${it.bank_name || ""} ${it.bank_masked || ""}`.trim();
  draw(channel, M, 10, { color: gray });
  y -= 18;

  // สองคอลัมน์: รายได้ / รายการหัก
  const colGap = 24;
  const colW = (contentW - colGap) / 2;
  const leftX = M;
  const rightX = M + colW + colGap;
  hr(y + 6); y -= 15;
  draw("รายได้", leftX, 11, { bold: true, color: gray });
  draw("รายการหัก", rightX, 11, { bold: true, color: gray });
  y -= 6; hr(y + 2);

  const earnings = Array.isArray(it.earnings) ? it.earnings : [];
  const deductions = Array.isArray(it.deductions) ? it.deductions : [];
  const rows = Math.max(earnings.length, deductions.length);
  const topY = y;
  let ly = topY - 15;
  for (const e of earnings) {
    page.drawText(String(e.label || "-"), { x: leftX, y: ly, size: 10, font, color: black });
    const amt = thb(e.amount);
    page.drawText(amt, { x: leftX + colW - widthOf(amt, 10), y: ly, size: 10, font, color: black });
    ly -= 14;
    if (e.note) {
      page.drawText(String(e.note), { x: leftX + 10, y: ly, size: 8, font, color: gray });
      ly -= 11;
    }
  }
  let ry = topY - 15;
  for (const d of deductions) {
    page.drawText(String(d.label || "-"), { x: rightX, y: ry, size: 10, font, color: black });
    const amt = thb(d.amount);
    page.drawText(amt, { x: width - M - widthOf(amt, 10), y: ry, size: 10, font, color: red });
    ry -= 14;
  }
  if (!deductions.length) {
    page.drawText("ไม่มี", { x: rightX, y: ry, size: 10, font, color: gray });
    ry -= 14;
  }
  y = Math.min(ly, ry) - 6;
  if (rows === 0) y = topY - 30;

  hr(y + 6); y -= 15;
  draw("รวมรายได้", leftX, 11, { bold: true });
  const grossTxt = thb(it.gross);
  draw(grossTxt, leftX + colW - widthOf(grossTxt, 11, fontB), 11, { bold: true });
  const deductTotal = deductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  draw("รวมรายการหัก", rightX, 11, { bold: true });
  drawRight(thb(deductTotal), width - M, 11, { bold: true, color: red });
  y -= 24;

  // ยอดสุทธิ
  page.drawRectangle({
    x: M, y: y - 10, width: contentW, height: 34,
    color: rgb(0.96, 0.97, 0.98),
  });
  draw("ยอดโอนสุทธิ", M + 12, 13, { bold: true, y: y + 4 });
  drawRight(`${thb(it.net)} บาท`, width - M - 12, 15, { bold: true, y: y + 2 });
  y -= 22;
  const words = bahtText(it.net);
  if (words) { draw(`(${words})`, M + 12, 10, { color: gray }); y -= 20; }
  y -= 10;

  // ที่มาของภาษี — พนักงานมีสิทธิ์ตรวจตัวเลขที่ถูกหักจากเงินตัวเอง
  if (!basis.skipped) {
    hr(y + 6); y -= 15;
    draw("ที่มาของภาษีหัก ณ ที่จ่าย", M, 10, { bold: true, color: gray });
    y -= 14;
    draw(`ประมาณการเงินได้ประจำทั้งปี ${thb(basis.annual_income)} (${basis.periods || 12} งวด)`, M + 10, 9, { color: gray });
    y -= 12;
    draw(`หักค่าใช้จ่าย ${thb(basis.expenses)} · หักค่าลดหย่อน ${thb(basis.allowances_total)} (รวมประกันสังคม ${thb(basis.sso_allowance)})`, M + 10, 9, { color: gray });
    y -= 12;
    draw(`เงินได้สุทธิ ${thb(basis.net_income)} → ภาษีทั้งปี ${thb(basis.annual_tax)}`, M + 10, 9, { color: gray });
    y -= 12;
    if (Number(basis.occasional_income) > 0) {
      draw(`เงินได้ที่จ่ายเป็นครั้งคราว ${thb(basis.occasional_income)} → ภาษีส่วนเพิ่ม ${thb(basis.occasional_tax)} (เก็บเฉพาะงวดนี้ ไม่เฉลี่ยทั้งปี)`, M + 10, 9, { color: gray });
      y -= 12;
    }
    if (it.wht_override) {
      draw(`ยอดภาษีถูกปรับด้วยมือ: ระบบคำนวณ ${thb(it.wht_computed)} → ใช้ ${thb(it.wht_override.amount)}`, M + 10, 9, { color: red });
      y -= 11;
      draw(`เหตุผล: ${it.wht_override.reason || "-"}${it.wht_override.by_name ? ` (โดย ${it.wht_override.by_name})` : ""}`, M + 10, 9, { color: red });
      y -= 12;
    }
    y -= 6;
  }

  // ประกันสังคม — ส่วนของนายจ้างไม่ได้หักจากลูกจ้าง ต้องเขียนให้ชัด
  hr(y + 6); y -= 15;
  draw("เงินสมทบประกันสังคม", M, 10, { bold: true, color: gray });
  y -= 14;
  draw(`ค่าจ้างที่ใช้คำนวณ ${thb(it.sso_wage)} · ส่วนของลูกจ้าง ${thb(it.sso_employee)} (หักจากสลิปนี้) · ส่วนของนายจ้าง ${thb(it.sso_employer)} (บริษัทจ่ายสมทบ ไม่ได้หักจากคุณ)`, M + 10, 9, { color: gray });
  y -= 24;

  const foot1 = "เอกสารนี้เป็นข้อมูลส่วนบุคคล โปรดเก็บรักษาเป็นความลับ";
  const foot2 = `${CO.legalName} • ออกโดยระบบอัตโนมัติ ไม่ต้องลงลายมือชื่อ`;
  page.drawText(foot1, { x: M, y: 62, size: 8, font, color: gray });
  page.drawText(foot2, { x: M, y: 50, size: 8, font, color: gray });

  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------
// 50 ทวิ ของลูกจ้าง — เงินได้ ม.40(1) สรุปทั้งปี
//
// คนละใบกับของไรเดอร์ (`buildWhtCertificatePdf`) และ **ห้ามยุบรวมกัน** แม้จะ
// หน้าตาคล้าย: ไรเดอร์เป็น ม.40(8) ออกต่อการจ่ายหนึ่งครั้ง ยื่น ภ.ง.ด.3 ส่วน
// ลูกจ้างเป็น ม.40(1) ออกปีละฉบับสรุปทั้งปี ยื่น ภ.ง.ด.1/1ก และมีบรรทัด
// ประกันสังคมที่ใบของไรเดอร์ไม่มี — สามอย่างนี้คือสาระของเอกสาร ไม่ใช่ธีม
//
// ตัวเลขทุกตัวมาจาก `cert` ที่รวมมาแล้วจาก payroll_items ของรอบที่จ่ายแล้ว
// ฟังก์ชันนี้ไม่บวกเลขเอง (กฎเดียวกับสลิป: สูตรสำเนาที่สองคือของที่วันหนึ่ง
// จะไม่ตรงกับที่ยื่นจริง)
// ---------------------------------------------------------------------------
async function buildEmployeeWhtCertificatePdf({ employee, priv, cert, company }) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const red = rgb(0.72, 0.11, 0.11);
  const lineColor = rgb(0.85, 0.86, 0.88);
  const CO = { ...companyOf({}), ...(company || {}) };
  const emp = employee || {};
  const pv = priv || {};

  let y = height - M;
  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    page.drawText(String(t == null ? "" : t), {
      x, y: opts.y != null ? opts.y : y, size, font: f, color: opts.color || black,
    });
  };
  const drawRight = (t, rightX, size, opts = {}) =>
    draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({
    start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor,
  });
  const wrap = (t, size, f, maxW) => {
    const str = String(t == null ? "" : t);
    const out = []; let cur = "";
    for (const ch of str) {
      if (cur && widthOf(cur + ch, size, f) > maxW) { out.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) { draw(ln, x, size, opts); y -= lineH; }
  };

  const title = "หนังสือรับรองการหักภาษี ณ ที่จ่าย";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 18;
  const sub = "ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร";
  draw(sub, (width - widthOf(sub, 10, font)) / 2, 10, { color: gray });
  y -= 26;

  draw(`เลขที่: ${cert.number || "-"}`, M, 11, { bold: true });
  drawRight(`ปีภาษี ${cert.buddhist_year || "-"}`, width - M, 11, { bold: true });
  y -= 16;
  draw(
    `เงินได้ที่จ่ายระหว่าง ${formatDate(cert.first_pay_date) || "-"} ถึง ${formatDate(cert.last_pay_date) || "-"}`,
    M, 9, { color: gray },
  );
  y -= 20;

  hr(y + 6); y -= 14;
  draw("ผู้มีหน้าที่หักภาษี ณ ที่จ่าย", M, 11, { bold: true });
  y -= 16;
  draw(CO.legalName, M + 12, 11);
  y -= 15;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M + 12, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M + 12, 10, contentW - 12, 13, { color: gray });
  y -= 10;

  hr(y + 6); y -= 14;
  draw("ผู้ถูกหักภาษี ณ ที่จ่าย", M, 11, { bold: true });
  y -= 16;
  draw(emp.name || cert.name || "-", M + 12, 11);
  drawRight(String(cert.employee_code || emp.employee_code || ""), width - M, 10, { color: gray });
  y -= 15;
  // บุคคลธรรมดาใช้เลขบัตรประชาชนเป็นเลขประจำตัวผู้เสียภาษี — เลขผู้เสียภาษี
  // ที่กรอกแยกไว้ (ถ้ามี) มาก่อนเพราะบางคนจดทะเบียนไว้ต่างหาก
  draw(`เลขประจำตัวผู้เสียภาษี/บัตรประชาชน ${pv.tax_id || pv.national_id || "-"}`, M + 12, 10, { color: gray });
  y -= 14;
  if (pv.address) drawWrapped(pv.address, M + 12, 10, contentW - 12, 13, { color: gray });
  y -= 12;

  hr(y + 6); y -= 14;
  draw("ประเภทเงินได้พึงประเมินที่จ่าย", M, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน (บาท)", width - M, 11, { bold: true, color: gray });
  y -= 8; hr(y + 2); y -= 16;
  draw("เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ตามมาตรา 40(1)", M, 11);
  drawRight(thb(cert.gross), width - M, 11);
  y -= 16;
  draw(`(จ่าย ${cert.periods || 0} งวด)`, M + 12, 9, { color: gray });
  y -= 20;

  hr(y + 6); y -= 14;
  draw("รวมเงินได้ที่จ่ายทั้งปี", M, 11, { color: gray });
  drawRight(thb(cert.gross), width - M, 11, { color: gray });
  y -= 18;
  draw("รวมภาษีที่หักและนำส่ง", M, 13, { bold: true });
  drawRight(thb(cert.wht), width - M, 13, { bold: true, color: red });
  y -= 22;

  const words = bahtText(cert.wht);
  if (words) { draw(`ภาษีที่หักไว้ (ตัวอักษร): (${words})`, M, 11); y -= 22; }

  // ประกันสังคม — ช่องนี้มีอยู่ในแบบ 50 ทวิ ของจริง และลูกจ้างใช้เป็นหลักฐาน
  // ค่าลดหย่อนตอนยื่นภาษีเงินได้บุคคลธรรมดา ใบที่ไม่มีบรรทัดนี้ทำให้เจ้าตัว
  // ต้องไปขอเอกสารเพิ่มอีกใบ
  hr(y + 6); y -= 14;
  draw("เงินที่ผู้ถูกหักภาษีจ่ายเข้ากองทุนประกันสังคม", M, 11, { color: gray });
  drawRight(thb(cert.sso_employee), width - M, 11, { color: gray });
  y -= 18;
  draw("ใช้เป็นค่าลดหย่อนได้ตามที่จ่ายจริง ไม่เกินเพดานที่กฎหมายกำหนด", M + 12, 9, { color: gray });
  y -= 20;

  draw("ผู้จ่ายเงินได้นำส่งภาษีที่หักไว้ต่อกรมสรรพากรตามแบบ ภ.ง.ด.1 และสรุปรายปีตามแบบ ภ.ง.ด.1ก", M, 9, { color: gray });
  y -= 12;
  draw("ผู้ถูกหักภาษีใช้หนังสือรับรองฉบับนี้เป็นหลักฐานเครดิตภาษีในการยื่นแบบภาษีเงินได้บุคคลธรรมดา", M, 9, { color: gray });
  y -= 12;
  if (cert.reissued) {
    draw("ฉบับนี้เป็นการออกซ้ำจากเลขที่เดิม ไม่ใช่เอกสารเพิ่มเติม", M, 9, { color: red });
    y -= 12;
  }
  if (cert.draft) {
    // ปีที่ยังมีรอบค้างจ่าย ตัวเลขยังขยับได้ ห้ามให้เอกสารเดินออกไปโดยดูเหมือนฉบับจริง
    draw("ยังไม่สิ้นสุดปีภาษี — ยังมีรอบที่ยังไม่จ่ายในปีนี้ ตัวเลขจะเปลี่ยนเมื่อจ่ายครบ", M, 9, { color: red });
    y -= 12;
  }

  const sigY = Math.max(y - 50, 120);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้มีอำนาจลงนาม";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });

  page.drawText("เอกสารนี้เป็นข้อมูลส่วนบุคคล โปรดเก็บรักษาเป็นความลับ", { x: M, y: 62, size: 8, font, color: gray });
  page.drawText(`${CO.legalName} • ออกโดยระบบอัตโนมัติ`, { x: M, y: 50, size: 8, font, color: gray });
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------
// เอกสารบุคคล — โครงร่วมของหน้ากระดาษ
//
// สี่เอกสาร (สัญญาจ้าง · รับรองเงินเดือน · หนังสือเตือน · ผ่านทดลองงาน) ใช้หัว
// กระดาษ ฟอนต์ และบล็อกลายเซ็นชุดเดียวกัน — แยกเป็นตัวช่วยเพื่อไม่ให้มีสี่สำเนา
// ของ "หัวจดหมายบริษัท" ที่วันหนึ่งจะเพี้ยนจากกัน (บทเรียนใบเสร็จ POS)
//
// **ทุกฉบับพิมพ์ลงกระดาษเพื่อเซ็นจริง** ไม่ใช่เอกสารอิเล็กทรอนิกส์ที่มีผลเอง
// จึงต้องมีเส้นเซ็นและวันที่ให้เขียนเสมอ
// ---------------------------------------------------------------------------
function hrDocPage(pdf, font, fontB, company) {
  let page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 56;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.82, 0.84, 0.86);
  const CO = { ...companyOf({}), ...(company || {}) };

  const st = { y: height - M, page, width, height, M, contentW, black, gray, lineColor, CO };

  // **ขอบล่างที่เนื้อหาห้ามข้าม** — pdf-lib วาดข้อความที่ y ติดลบโดยไม่ error
  // และหน้าก็ยังนับเป็นหนึ่งหน้าเหมือนเดิม ข้อความหายไปเงียบสนิท ซึ่งเป็น
  // กับดักตระกูลเดียวกับ "หน้าว่างก็นับได้ 1 หน้า" ในบทเรียนใบเสร็จ
  const BOTTOM = 150;
  st.newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    st.page = page;
    st.y = height - M;
    return page;
  };
  /** พื้นที่ไม่พอสำหรับ n บรรทัดขนาด size → ขึ้นหน้าใหม่ */
  st.ensure = (needH) => { if (st.y - needH < BOTTOM) st.newPage(); };

  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  st.widthOf = widthOf;
  st.draw = (t, x, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    page.drawText(String(t == null ? "" : t), {
      x, y: opts.y != null ? opts.y : st.y, size, font: f, color: opts.color || black,
    });
  };
  st.center = (t, size, opts = {}) =>
    st.draw(t, (width - widthOf(t, size, opts.bold ? fontB : font)) / 2, size, opts);
  st.right = (t, rightX, size, opts = {}) =>
    st.draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  st.hr = (yy) => page.drawLine({
    start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor,
  });
  // กฎการตัดบรรทัดภาษาไทยอยู่ที่ `hr-documents.js` (pure มี unit test) —
  // ตัวนี้แค่ผูกตัววัดความกว้างของฟอนต์เข้าไป **ห้ามก๊อปกฎมาไว้ที่นี่**
  st.wrap = (t, size, maxW, bold) =>
    wrapText(t, maxW, (x) => widthOf(x, size, bold ? fontB : font));

  st.para = (t, size, opts = {}) => {
    const x = st.M + (opts.indent || 0);
    const lineH = opts.lineH || size + 6;
    for (const ln of st.wrap(t, size, contentW - (opts.indent || 0), opts.bold)) {
      st.ensure(lineH);
      st.draw(ln, x, size, opts);
      st.y -= lineH;
    }
  };

  // หัวกระดาษ — ชื่อนิติบุคคลก่อนเสมอ ไม่ใช่ชื่อทางการค้า เอกสารจ้างงานเป็น
  // สัญญาระหว่างลูกจ้างกับ "นิติบุคคล" ที่จดทะเบียน
  st.center(CO.legalName, 14, { bold: true });
  st.y -= 15;
  for (const ln of st.wrap(CO.address, 9, contentW)) { st.center(ln, 9, { color: gray }); st.y -= 11; }
  st.center(`เลขประจำตัวผู้เสียภาษี ${CO.taxId}`, 9, { color: gray });
  st.y -= 16;
  st.hr(st.y + 4);
  st.y -= 20;
  return st;
}

/** บล็อกลายเซ็นสองฝ่าย (สัญญา) หรือฝ่ายเดียว (จดหมาย) */
function hrSignatures(st, font, pairs) {
  // ต้องการที่อย่างน้อย 60pt ใต้เนื้อหา ไม่งั้นเส้นเซ็นไปทับย่อหน้าสุดท้าย
  if (st.y - 60 < 130) st.newPage();
  const gapY = Math.max(st.y - 30, 130);
  const colW = st.contentW / pairs.length;
  pairs.forEach((label, i) => {
    const cx = st.M + colW * i + colW / 2;
    st.page.drawLine({
      start: { x: cx - 78, y: gapY }, end: { x: cx + 78, y: gapY },
      thickness: 0.8, color: st.lineColor,
    });
    const w = st.widthOf(label, 9, font);
    st.page.drawText(label, { x: cx - w / 2, y: gapY - 14, size: 9, font, color: st.black });
    const d = "(                    /                    /                    )";
    const dw = st.widthOf(d, 8, font);
    st.page.drawText(d, { x: cx - dw / 2, y: gapY - 28, size: 8, font, color: st.gray });
  });
  return gapY;
}

// ---------------------------------------------------------------------------
// สัญญาจ้างแรงงาน
//
// **เงื่อนไขทุกข้อมาจาก `doc.terms` ที่ freeze ไว้ตอนออกเอกสาร ไม่ได้อ่านสด**
// สัญญาที่เซ็นไปแล้วต้องอธิบายตัวเองได้แม้ค่าใน settings จะถูกแก้พรุ่งนี้
// (รูปเดียวกับ payroll_runs.config และใบกำกับภาษี)
// ---------------------------------------------------------------------------
async function buildEmploymentContractPdf({ employee, priv, doc, company }) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });
  const st = hrDocPage(pdf, font, fontB, company);

  const emp = employee || {};
  const pv = priv || {};
  const t = doc.terms || {};
  const pay = doc.pay || {};

  st.center("สัญญาจ้างแรงงาน", 16, { bold: true });
  st.y -= 20;
  st.right(`เลขที่ ${doc.number || "-"}`, st.width - st.M, 9, { color: st.gray });
  st.y -= 16;

  st.para(`ทำที่ ${st.CO.legalName} เมื่อวันที่ ${formatDate(doc.issued_at) || "-"}`, 10);
  st.y -= 6;
  st.para(
    `สัญญาฉบับนี้ทำขึ้นระหว่าง ${st.CO.legalName} เลขประจำตัวผู้เสียภาษี ${st.CO.taxId} ` +
    `ซึ่งต่อไปในสัญญานี้เรียกว่า "นายจ้าง" ฝ่ายหนึ่ง กับ ${emp.name || "-"} ` +
    `เลขประจำตัวประชาชน ${pv.national_id || "-"} อยู่บ้านเลขที่ ${pv.address || "-"} ` +
    `ซึ่งต่อไปในสัญญานี้เรียกว่า "ลูกจ้าง" อีกฝ่ายหนึ่ง โดยทั้งสองฝ่ายตกลงกันดังนี้`, 10);
  st.y -= 8;

  const clauses = [
    ["ตำแหน่งและหน้าที่",
      `นายจ้างตกลงจ้าง และลูกจ้างตกลงเข้าทำงานในตำแหน่ง ${emp.position || "-"}` +
      `${emp.department ? ` แผนก${emp.department}` : ""}` +
      `${emp.branch ? ` ประจำที่ ${emp.branch}` : ""} ` +
      `โดยปฏิบัติหน้าที่ตามที่ได้รับมอบหมายด้วยความซื่อสัตย์สุจริต`],
    ["วันเริ่มงานและระยะเวลาจ้าง",
      `เริ่มทำงานตั้งแต่วันที่ ${formatDate(emp.hired_at) || "-"} เป็นต้นไป ` +
      (doc.fixed_term_end
        ? `โดยเป็นสัญญาจ้างที่มีกำหนดระยะเวลา สิ้นสุดวันที่ ${formatDate(doc.fixed_term_end)}`
        : "โดยเป็นสัญญาจ้างที่ไม่มีกำหนดระยะเวลา")],
    ["การทดลองงาน",
      t.probation_days > 0
        ? `ลูกจ้างต้องผ่านการทดลองงานเป็นระยะเวลา ${t.probation_days} วัน ` +
          `นับแต่วันเริ่มงาน ครบกำหนดวันที่ ${formatDate(doc.probation_end) || "-"}` +
          (t.probation_note ? ` ${t.probation_note}` : "")
        : "ไม่มีการทดลองงาน"],
    ["ค่าจ้างและการจ่ายค่าจ้าง",
      pay.amount
        ? `นายจ้างตกลงจ่ายค่าจ้างให้ลูกจ้างในอัตรา ${thb(pay.amount)} ${pay.unit} ` +
          `โดยจ่ายเป็น${pay.period} ตามรอบการจ่ายค่าจ้างของนายจ้าง และหักภาษี ณ ที่จ่าย ` +
          `กับเงินสมทบประกันสังคมตามที่กฎหมายกำหนด`
        : "ค่าจ้างเป็นไปตามที่ทั้งสองฝ่ายตกลงกัน"],
    // **ต้องพูดถึงเวลาพัก** — ช่วง 09:00-18:00 คือ 9 ชั่วโมง ส่วน "วันละ 8
    // ชั่วโมง" คือชั่วโมงทำงานจริง เอกสารที่พิมพ์ทั้งสองตัวเลขโดยไม่บอกว่ามี
    // เวลาพักคั่นอยู่ จะขัดกันเองบนหน้ากระดาษที่คนต้องเซ็น (เจอจากการเปิด
    // สัญญาฉบับจริงที่ออกไปแล้ว ไม่ใช่จากเทส) และการพักระหว่างวันเป็นข้อที่
    // กฎหมายแรงงานกำหนดให้ต้องมีอยู่แล้ว
    ["เวลาทำงานและวันหยุด",
      `ทำงานสัปดาห์ละ ${t.work_days_per_week} วัน วันละ ${t.work_hours_per_day} ชั่วโมง ` +
      `ระหว่างเวลา ${t.work_start} ถึง ${t.work_end} น. ` +
      (Number(t.break_minutes) > 0
        ? `และมีเวลาพักระหว่างวัน ${Math.round(Number(t.break_minutes))} นาที `
        : "") +
      `โดยมีวันหยุดประจำสัปดาห์คือวัน${t.weekly_holiday} ` +
      `ทั้งนี้ วันหยุดตามประเพณี วันหยุดพักผ่อนประจำปี และวันลา เป็นไปตามระเบียบของนายจ้างและที่กฎหมายกำหนด`],
    ["การเลิกสัญญา",
      `ฝ่ายใดประสงค์จะเลิกสัญญา ต้องบอกกล่าวเป็นหนังสือให้อีกฝ่ายทราบล่วงหน้าไม่น้อยกว่า ` +
      `${t.notice_days} วัน เว้นแต่กรณีที่กฎหมายกำหนดให้เลิกจ้างได้ทันที`],
  ];
  if (t.benefits) clauses.push(["สวัสดิการ", t.benefits]);
  if (t.extra_clauses) clauses.push(["ข้อตกลงอื่น", t.extra_clauses]);
  clauses.push(["ความเข้าใจร่วมกัน",
    "ทั้งสองฝ่ายได้อ่านและเข้าใจข้อความในสัญญานี้โดยตลอดแล้ว จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน " +
    "และต่างเก็บไว้ฝ่ายละหนึ่งฉบับ"]);

  clauses.forEach(([title, body], i) => {
    st.para(`ข้อ ${i + 1}. ${title}`, 10, { bold: true });
    st.para(body, 10, { indent: 14 });
    st.y -= 5;
  });

  hrSignatures(st, font, ["ลงชื่อ ผู้ว่าจ้าง", "ลงชื่อ ลูกจ้าง", "ลงชื่อ พยาน"]);
  st.page.drawText(`${st.CO.legalName} • เอกสารนี้เป็นข้อมูลส่วนบุคคล โปรดเก็บรักษาเป็นความลับ`,
    { x: st.M, y: 46, size: 8, font, color: st.gray });
  return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------
// จดหมายบุคคลสามชนิด — รับรองเงินเดือน / หนังสือเตือน / ผ่านทดลองงาน
//
// ใช้ตัวเดียวกันเพราะโครงเหมือนกันหมด (หัวบริษัท → เรื่อง → เนื้อความ → ลงชื่อ)
// ต่างกันแค่ **ถ้อยคำ** ซึ่งประกอบไว้ที่ `hrLetterBody` — สามฟังก์ชันที่วาด
// เหมือนกันแต่คนละสำเนา คือของที่จะเพี้ยนจากกันทีละจุด
// ---------------------------------------------------------------------------
function hrLetterBody({ type, employee, priv, doc, company }) {
  const emp = employee || {};
  const t = doc.terms || {};
  const pay = doc.pay || {};
  const co = { ...companyOf({}), ...(company || {}) };
  const who = `${emp.name || "-"}${emp.employee_code ? ` (รหัสพนักงาน ${emp.employee_code})` : ""}`;
  const role = `${emp.position ? `ตำแหน่ง${emp.position}` : ""}${emp.department ? ` แผนก${emp.department}` : ""}`.trim();

  if (type === "salary_certificate") {
    return {
      title: "หนังสือรับรองเงินเดือน",
      subject: null,
      paras: [
        `${co.legalName} ขอรับรองว่า ${who} ${role ? `${role} ` : ""}` +
        `เป็นพนักงานของบริษัท โดยเริ่มปฏิบัติงานตั้งแต่วันที่ ${formatDate(emp.hired_at) || "-"} ` +
        `และปัจจุบันยังคงปฏิบัติงานอยู่`,
        pay.amount
          ? `ได้รับค่าจ้างในอัตรา ${thb(pay.amount)} ${pay.unit} (${bahtText(pay.amount) || "-"})`
          : "อัตราค่าจ้างเป็นไปตามที่บริษัทกำหนด",
        // เอกสารนี้เปิดเผยเงินเดือน — ระบุวัตถุประสงค์ไว้เพื่อให้ชัดว่าออกให้ใคร
        // ใช้ทำอะไร ไม่ใช่เอกสารที่แจกได้ทั่วไป
        `หนังสือฉบับนี้ออกให้เพื่อ${doc.purpose || "ใช้เป็นหลักฐานตามที่ผู้ถือเอกสารร้องขอ"} เท่านั้น`,
        "ออกให้ ณ วันที่ที่ระบุข้างต้น เพื่อเป็นหลักฐาน",
      ],
      signers: ["ลงชื่อ ผู้มีอำนาจลงนาม"],
    };
  }

  if (type === "warning") {
    return {
      title: "หนังสือเตือน",
      subject: `เรื่อง ${doc.subject || "การกระทำที่ไม่เป็นไปตามระเบียบของบริษัท"}`,
      paras: [
        `เรียน ${who}${role ? ` ${role}` : ""}`,
        `ตามที่บริษัทตรวจพบว่าท่านได้${doc.incident || "-"}` +
        `${doc.incident_at ? ` เมื่อวันที่ ${formatDate(doc.incident_at)}` : ""} ` +
        `ซึ่งไม่เป็นไปตามระเบียบข้อบังคับเกี่ยวกับการทำงานของบริษัทนั้น`,
        `บริษัทจึงมีหนังสือฉบับนี้เพื่อเตือนให้ท่านแก้ไขและปรับปรุงการปฏิบัติงาน ` +
        `และขอให้ท่านปฏิบัติตามระเบียบข้อบังคับของบริษัทโดยเคร่งครัดต่อไป`,
        // ข้อความนี้คือสาระของหนังสือเตือน ไม่ใช่คำขู่ — ถ้าไม่เขียน เอกสารจะ
        // ใช้อ้างอิงตอนพิจารณาโทษครั้งถัดไปไม่ได้
        `หากท่านกระทำผิดซ้ำในเรื่องเดียวกันอีก บริษัทจำเป็นต้องพิจารณาดำเนินการตามระเบียบ ` +
        `ข้อบังคับเกี่ยวกับการทำงานและตามที่กฎหมายกำหนดต่อไป`,
        doc.expires_at
          ? `หนังสือเตือนฉบับนี้มีผลถึงวันที่ ${formatDate(doc.expires_at)}`
          : "",
      ].filter(Boolean),
      signers: ["ลงชื่อ ผู้มีอำนาจลงนาม", "ลงชื่อ ผู้รับหนังสือ"],
    };
  }

  // probation_pass
  return {
    title: "หนังสือแจ้งผลการทดลองงาน",
    subject: "เรื่อง แจ้งผลการทดลองงาน",
    paras: [
      `เรียน ${who}${role ? ` ${role}` : ""}`,
      `ตามที่ท่านได้เข้าปฏิบัติงานกับ${co.legalName} ตั้งแต่วันที่ ${formatDate(emp.hired_at) || "-"} ` +
      `และอยู่ในระหว่างการทดลองงานเป็นระยะเวลา ${t.probation_days || "-"} วัน ` +
      `ซึ่งครบกำหนดเมื่อวันที่ ${formatDate(doc.probation_end) || "-"} นั้น`,
      `บริษัทได้พิจารณาผลการปฏิบัติงานของท่านแล้ว เห็นว่าท่าน**ผ่านการทดลองงาน** ` +
      `และให้บรรจุเป็นพนักงานตั้งแต่วันที่ ${formatDate(doc.effective_at) || formatDate(doc.probation_end) || "-"} เป็นต้นไป`,
      doc.note || "",
      "จึงเรียนมาเพื่อทราบ",
    ].filter(Boolean),
    signers: ["ลงชื่อ ผู้มีอำนาจลงนาม"],
  };
}

async function buildHrLetterPdf({ type, employee, priv, doc, company }) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });
  const st = hrDocPage(pdf, font, fontB, company);
  const body = hrLetterBody({ type, employee, priv, doc, company });

  st.right(`เลขที่ ${doc.number || "-"}`, st.width - st.M, 9, { color: st.gray });
  st.y -= 12;
  st.right(`วันที่ ${formatDate(doc.issued_at) || "-"}`, st.width - st.M, 10);
  st.y -= 22;

  st.center(body.title, 15, { bold: true });
  st.y -= 22;
  if (body.subject) { st.para(body.subject, 10, { bold: true }); st.y -= 6; }

  for (const para of body.paras) {
    // `**...**` ในถ้อยคำหมายถึงส่วนที่ต้องเน้น — วาดทั้งย่อหน้าเป็นตัวหนา
    // แทนการผสมกลางบรรทัด (ผสมฟอนต์กลางบรรทัดในภาษาไทยทำให้ระยะห่างเพี้ยน)
    const boldPara = para.includes("**");
    st.para(para.replace(/\*\*/g, ""), 10, { indent: 14, bold: boldPara });
    st.y -= 7;
  }

  hrSignatures(st, font, body.signers);
  st.page.drawText(`${st.CO.legalName} • เอกสารนี้เป็นข้อมูลส่วนบุคคล โปรดเก็บรักษาเป็นความลับ`,
    { x: st.M, y: 46, size: 8, font, color: st.gray });
  return Buffer.from(await pdf.save());
}

/**
 * ใบสำคัญเงินสดย่อย (petty cash voucher) — ออกตอนฝ่ายบัญชีกดจ่ายใบเบิกไรเดอร์
 *
 * ทำไมเป็นเอกสารนี้ ไม่ใช่ใบเสร็จ: นักบัญชียืนยัน (4 ก.ย. 2569) ว่าค่าทางด่วน/
 * ที่จอดรถที่ไรเดอร์สำรองจ่ายเป็นเงินสดย่อย ไม่ต้องมีใบเสร็จในนามบริษัท ไม่หัก
 * 3% แต่**ต้องมีใบสำคัญ**แนบกับสลิปการจ่าย เอกสารนี้จึงเป็นสิ่งที่ทำให้รายการ
 * เบิกกลายเป็นรายจ่ายที่อธิบายได้ตอนถูกตรวจ
 *
 * **ตัวเลขทุกตัวมาจากแถวที่จ่ายไปแล้ว ไม่คำนวณใหม่** — ใบสำคัญที่คิดเลขเองคือ
 * สูตรสำเนาที่สอง วันหนึ่งจะไม่ตรงกับยอดที่เข้ากระเป๋าไรเดอร์
 *
 * **ลำดับผู้อนุมัติพิมพ์จาก `history` ของใบ** (หัวหน้าตรวจงาน → บัญชีตั้งเบิก →
 * บัญชีจ่าย) เพราะนั่นคือสิ่งที่ผู้ตรวจถาม: ใครยืนยันว่างานวิ่งจริง และใครอนุมัติ
 * ให้จ่าย — ฟิลด์เดี่ยว `reviewed_by_name` ตอบได้แค่คนสุดท้าย
 *
 * **หลักฐานอ้างเป็นจำนวนรูปและ id ในระบบ ไม่ฝังรูปลง PDF** — รูปสลิปอยู่ใน
 * Storage ใต้ rider_expenses/{id} อยู่แล้ว ฝังลงเอกสารทำให้ไฟล์โตหลายเท่าและ
 * ไม่ได้เพิ่มความน่าเชื่อถือ (ผู้ตรวจเปิดจากระบบได้)
 */
async function buildPettyCashVoucherPdf({ voucher, expense, rider, company }) {
  const { regular, bold } = loadFonts();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular, { subset: true });
  const fontB = await pdf.embedFont(bold, { subset: true });

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  const contentW = width - M * 2;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.42, 0.45, 0.5);
  const lineColor = rgb(0.85, 0.86, 0.88);
  const CO = { ...companyOf({}), ...(company || {}) };
  const v = voucher || {};
  const ex = expense || {};
  const rd = rider || {};

  let y = height - M;
  const widthOf = (t, size, f = font) => f.widthOfTextAtSize(String(t == null ? "" : t), size);
  const draw = (t, x, size, opts = {}) => {
    const f = opts.bold ? fontB : font;
    page.drawText(String(t == null ? "" : t), { x, y: opts.y != null ? opts.y : y, size, font: f, color: opts.color || black });
  };
  const drawRight = (t, rightX, size, opts = {}) => draw(t, rightX - widthOf(t, size, opts.bold ? fontB : font), size, opts);
  const hr = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.8, color: lineColor });
  const wrap = (t, size, f, maxW) => {
    const str = String(t == null ? "" : t);
    const out = []; let cur = "";
    for (const ch of str) {
      if (cur && widthOf(cur + ch, size, f) > maxW) { out.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const drawWrapped = (t, x, size, maxW, lineH, opts = {}) => {
    for (const ln of wrap(t, size, opts.bold ? fontB : font, maxW)) { draw(ln, x, size, opts); y -= lineH; }
  };

  // หัวเอกสาร
  const title = "ใบสำคัญเงินสดย่อย";
  draw(title, (width - widthOf(title, 18, fontB)) / 2, 18, { bold: true });
  y -= 18;
  const sub = "ใบสำคัญแทนใบเสร็จรับเงิน สำหรับค่าใช้จ่ายที่พนักงานสำรองจ่าย";
  draw(sub, (width - widthOf(sub, 10, font)) / 2, 10, { color: gray });
  y -= 26;

  draw(`เลขที่: ${v.number || "-"}`, M, 11, { bold: true });
  drawRight(`วันที่จ่าย: ${formatDate(v.paid_at) || "-"}`, width - M, 11);
  y -= 22;

  // ผู้จ่าย
  hr(y + 6); y -= 14;
  draw("ผู้จ่ายเงิน", M, 11, { bold: true });
  y -= 16;
  draw(CO.legalName, M + 12, 11);
  y -= 15;
  draw(`เลขประจำตัวผู้เสียภาษี ${CO.taxId} (${CO.branch || "สำนักงานใหญ่"})`, M + 12, 10, { color: gray });
  y -= 14;
  drawWrapped(CO.address, M + 12, 10, contentW - 12, 13, { color: gray });
  y -= 10;

  // ผู้รับเงิน
  hr(y + 6); y -= 14;
  draw("ผู้รับเงิน (ผู้สำรองจ่าย)", M, 11, { bold: true });
  y -= 16;
  draw(rd.name || "-", M + 12, 11);
  y -= 15;
  draw(`ไรเดอร์ รหัสในระบบ ${rd.id || "-"}`, M + 12, 10, { color: gray });
  y -= 18;

  // รายการ
  hr(y + 6); y -= 14;
  draw("รายการ", M, 11, { bold: true, color: gray });
  drawRight("จำนวนเงิน (บาท)", width - M, 11, { bold: true, color: gray });
  y -= 8; hr(y + 2); y -= 16;
  draw(v.item_label || "ค่าใช้จ่ายสำรองจ่าย", M, 11);
  drawRight(thb(v.amount), width - M, 11);
  y -= 15;
  const details = [
    `วันที่จ่ายจริง ${formatDate(ex.occurred_at) || "-"}`,
    ex.job_ref ? `งาน ${ex.job_ref}` : "ไม่ผูกกับงาน",
  ];
  draw(details.join(" • "), M + 12, 9, { color: gray });
  y -= 13;
  if (ex.note) { drawWrapped(`รายละเอียด: ${ex.note}`, M + 12, 9, contentW - 12, 12, { color: gray }); }
  y -= 8;
  hr(y + 6); y -= 16;
  draw("รวมจ่าย", M, 13, { bold: true });
  drawRight(thb(v.amount), width - M, 13, { bold: true });
  y -= 18;
  const words = bahtText(v.amount);
  if (words) { draw(`จำนวนเงิน (ตัวอักษร): (${words})`, M, 11); y -= 20; }

  // วิธีจ่าย + หลักฐาน — บอกตามความจริง: เงินเข้ากระเป๋าในระบบ สลิปโอนจริงคือ
  // ตอนไรเดอร์ถอน ไม่ใช่ตอนนี้ ห้ามเขียนว่า "โอนเงินแล้ว" ถ้ายังไม่โอน
  hr(y + 6); y -= 14;
  draw("การจ่ายและหลักฐาน", M, 11, { bold: true });
  y -= 16;
  drawWrapped(
    `จ่ายโดยเครดิตเข้ากระเป๋าไรเดอร์ในระบบ (รายการ ${v.tx_id || "-"}) — ยอดนี้ถูกโอนเข้าบัญชีธนาคารของผู้รับพร้อมค่าตอบแทนรอบถัดไปที่ผู้รับกดถอน สลิปโอนอยู่ที่รายการถอนนั้น`,
    M + 12, 10, contentW - 12, 13, { color: gray },
  );
  drawWrapped(
    `หลักฐานการจ่ายเงินของผู้สำรองจ่าย: รูปสลิป/ใบเสร็จ ${Number(v.evidence_count) || 0} รูป เก็บในระบบที่รายการเบิก ${ex.id || "-"}`,
    M + 12, 10, contentW - 12, 13, { color: gray },
  );
  drawWrapped(
    "ไม่มีใบเสร็จในนามบริษัท (ค่าทางด่วน/ค่าที่จอดรถ ผู้ให้บริการไม่ออกใบเสร็จในนามนิติบุคคล) จึงออกใบสำคัญฉบับนี้แทนใบเสร็จรับเงิน",
    M + 12, 10, contentW - 12, 13, { color: gray },
  );
  y -= 8;

  // ผู้อนุมัติแต่ละขั้น — จากประวัติจริง ไม่ใช่ช่องเซ็นว่างที่ไม่มีใครเซ็น
  hr(y + 6); y -= 14;
  draw("การอนุมัติ", M, 11, { bold: true });
  y -= 16;
  const approvals = Array.isArray(v.approvals) ? v.approvals : [];
  if (approvals.length === 0) { draw("-", M + 12, 10, { color: gray }); y -= 14; }
  for (const a of approvals) {
    draw(`${a.label}: ${a.by || "-"}`, M + 12, 10);
    drawRight(formatDate(a.at) || "-", width - M, 10, { color: gray });
    y -= 14;
  }
  y -= 6;

  // ลายเซ็นผู้มีอำนาจจ่ายเงิน — เส้นเดียว (ผู้รับเงินรับผ่านระบบ ไม่มีวันมาเซ็น
  // กระดาษ เส้นที่ไม่มีวันถูกเซ็นคือคำโกหกบนเอกสาร — บทเรียนใบสำคัญรับเงิน)
  const sigY = Math.max(y - 60, 120);
  const cx = width - M - 75;
  page.drawLine({ start: { x: cx - 75, y: sigY }, end: { x: cx + 75, y: sigY }, thickness: 0.8, color: lineColor });
  const lbl = "ผู้มีอำนาจจ่ายเงิน";
  page.drawText(lbl, { x: cx - widthOf(lbl, 9, font) / 2, y: sigY - 15, size: 9, font, color: black });

  page.drawText(`${CO.legalName} • ออกโดยระบบอัตโนมัติ`, { x: M, y: 50, size: 8, font, color: gray });
  return Buffer.from(await pdf.save());
}

module.exports = { buildVoucherPdf, buildTaxInvoicePdf, buildSalesTaxInvoicePdf, buildQuotationPdf, buildCreditNotePdf, buildWhtCertificatePdf, buildPayslipPdf, buildEmployeeWhtCertificatePdf,
  buildEmploymentContractPdf, buildHrLetterPdf, hrLetterBody, buildPettyCashVoucherPdf };
