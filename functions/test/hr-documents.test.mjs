// ---------------------------------------------------------------------------
// เอกสารบุคคล — สัญญาจ้าง · รับรองเงินเดือน · หนังสือเตือน · ผ่านทดลองงาน
//
//   node functions/test/hr-documents.test.mjs
//
// สร้าง PDF จริงแล้ววัดผล ตามบทเรียน "ผลพิมพ์" ใน CLAUDE.md — และที่นี่มี
// กับดักเพิ่มอีกชั้นที่ใบเสร็จไม่มี: **pdf-lib วาดข้อความที่ y ติดลบโดยไม่ error
// และหน้าก็ยังนับเป็น 1 หน้าเหมือนเดิม ข้อความหายเงียบสนิท** เอกสารที่คนต้อง
// เซ็นซึ่งข้อความหายไปครึ่งหนึ่งจึงผ่านเงื่อนไข "1 หน้า" ได้สบาย
//
// ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) — 3 ก.ย. 2569
//
//   #   ทำลายอะไร                                        ผล
//   1   ทดลองงานนับผิดไปหนึ่งวัน                          แดง 3
//   2   นับหนังสือเตือนที่หมดอายุแล้วด้วย                  แดง 2
//   3   นับหนังสือเตือนที่ยกเลิกแล้วด้วย                   แดง 2
//   4   สัญญาไม่บังคับเลขบัตร/ที่อยู่                      แดง
//   5   ตั้งทดลองงาน 0 แล้วตกกลับค่าตั้งต้น                แดง
//   6   prefix ซ้ำกัน (ลำดับเอกสารปนกัน)                   แดง
//   7   ถอดการขึ้นหน้าใหม่ (ข้อความหายเงียบ)               เขียว* → วัดพิกัด y
//   8   ถอดการกันแยกสระหน้า                               เขียว* → เทสตัวกฎตรงๆ
//   9   กันสระหน้าแต่ลืมกันวรรณยุกต์                       แดง
//  10   เทียบทั้งสตริงแทนตัวแรก (บั๊กจริงรอบแรก)           แดง 2
//  11   ถอดด่านขึ้นหน้าใหม่ของบล็อกลายเซ็น                 เขียว* → ด่านตาย ลบทิ้ง
//  12   ถอด gate สิทธิ์ของ issue                           แดง
//  13   จองเลขก่อนตรวจข้อมูลครบ                            เขียว* → ยืนยันว่าด่านมีอยู่
//  14   หนังสือเตือนออกได้โดยไม่ระบุเหตุ                   แดง
//  15   พิมพ์ซ้ำอ่านเงื่อนไขใหม่จาก settings               แดง 2
//  16   ลงทะเบียนก่อนสร้าง PDF                             เขียว* → นับจำนวนการเขียน
//  17   ยกเลิกไม่ต้องมีเหตุผล                              แดง
//  18   ยกเลิกด้วยการลบแถว                                 แดง
//  19   เก็บ PDF ลง Storage                                แดง
//  20   query ทั้งโหนดแทน subtree                          แดง
//  21   ถอดปุ่มเอกสาร                                      แดง
//  22   หนังสือเตือนกดได้โดยไม่กรอกเหตุ                    แดง
//  23   ไม่บอกก่อนว่าขาดอะไร                               แดง
//  24   ถอดกล่องเตือนว่าระบบไม่รับรองตามกฎหมาย             แดง
//  25   ค่าตั้งต้นสองฝั่งไม่ตรงกัน                          แดง
//  26   ถอดการลงทะเบียนใน index.js                         แดง
//
// **ห้าข้อที่เขียว (*) — สี่ข้อเป็นเทสว่าง หนึ่งข้อเป็นด่านตาย:**
//   7  ตัวนับ `Tj` นับข้อความที่วาดที่ y ติดลบด้วย — หน้าที่เนื้อหาหายครึ่ง
//      จึงยังผ่านทั้ง "1 หน้า" และ "มีการวาด" เปลี่ยนไปวัด **พิกัด y** แทน
//   8  ด่านหาคำว่า `badBreak` ในซอร์ส ยังเขียวหลังถอดลูปที่ใช้มันออก —
//      ย้ายกฎออกมาเป็น `wrapText` ที่ขับได้ตรงๆ แล้วเทสผลลัพธ์
//  11  **ไม่ใช่เทสว่าง แต่เป็นด่านที่พิสูจน์ไม่ได้ว่ากันอะไร** — วัดของจริงแล้ว
//      พบว่า `BOTTOM = 150` กันไว้อยู่แล้ว ระยะห่างไม่เคยน้อยกว่า ~34pt ในทุก
//      เคสที่สร้างได้ ด่านนั้นเปลี่ยนได้แค่ว่าลายเซ็นไปอยู่หน้าไหน → ลบทิ้ง
//  13  `indexOf` ของสิ่งที่ถูกลบคืน -1 ซึ่งน้อยกว่าทุกตำแหน่ง ด่านลำดับจึงเขียว
//      ตอนที่ด่านหายไปทั้งอัน → ยืนยันว่ามีอยู่จริงก่อนเทียบลำดับ
//  16  เช็คว่า renderDoc มาก่อน `.set(doc)` ยังเขียวถ้ามีการเขียนตัวที่สอง
//      แทรกไว้ก่อนหน้า → นับจำนวนการเขียนด้วย
//
// **และมีบั๊กจริงหนึ่งตัวที่เจอจากการเปิดดู PDF ไม่ใช่จากเทส** (ข้อ 10 คือการ
// ย้อนมันกลับเข้ามา): `unsafeBreak` เทียบวรรณยุกต์กับสตริง `next` ทั้งก้อน
// พอถอยกลับแล้ว next ยาวขึ้น มันจึงเจอวรรณยุกต์ที่อยู่ลึกเข้าไปแล้วถอยไม่หยุด
// จนบรรทัดหมด แล้วตกไปตัดที่จุดเดิมซึ่งผิด — "ไว้ฝ่ายละหนึ" / "่งฉบับ"
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

const D = require(join(fnDir, "hr-documents.js"));
const { buildEmploymentContractPdf, buildHrLetterPdf, hrLetterBody } = require(join(fnDir, "voucher-pdf.js"));
const { PDFDocument, PDFName, PDFRawStream } = require("pdf-lib");
const zlib = require("zlib");

/**
 * นับจำนวนครั้งที่ "วาดข้อความ" บนหน้าหนึ่ง
 *
 * ตำแหน่ง y ของทุกจุดที่ข้อความถูกวางลงหน้าหนึ่ง
 *
 * **สองเครื่องมือที่ลองแล้วผิด และเป็นเหตุผลที่ต้องวัดตำแหน่ง:**
 *   1. *ขนาดไฟล์* — ข้อความ 4,000 ตัวที่เป็นตัวอักษรซ้ำมี glyph ตัวเดียว
 *      subset แทบไม่โตและ stream ถูกบีบ ขนาดขึ้นไม่ถึง 20% (วัดจริง 1.16 เท่า)
 *   2. *จำนวนครั้งที่วาด (Tj)* — **ข้อความที่วาดที่ y ติดลบก็ยังนับเป็นการวาด**
 *      ถอดการขึ้นหน้าใหม่ออกแล้วตัวนับยังเท่าเดิม ทั้งที่ครึ่งหน้าหายไปจากกระดาษ
 *      (injection ข้อ 7 เขียวด้วยเหตุนี้)
 *
 * ตัวที่ตอบคำถามจริงคือ "มีข้อความตกไปนอกกระดาษไหม" ซึ่งต้องดูที่พิกัด
 */
function textPositionsOn(doc, i) {
  const page = doc.getPage(i);
  const c = page.node.Contents();
  const streams = c && c.constructor.name === "PDFArray"
    ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  const ys = [];
  for (const st of streams) {
    if (!(st instanceof PDFRawStream)) continue;
    let bytes = st.getContents();
    if (String(st.dict.get(PDFName.of("Filter"))) === "/FlateDecode") {
      bytes = zlib.inflateSync(Buffer.from(bytes));
    }
    const txt = Buffer.from(bytes).toString("latin1");
    // pdf-lib วางข้อความด้วย text matrix (`a b c d e f Tm`) ไม่ใช่ `Td`
    // — ค่าที่หกคือ y (ตรวจจาก content stream จริง ไม่ได้เดา)
    for (const m of txt.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm\b/g)) {
      ys.push(Number(m[6]));
    }
  }
  return ys;
}

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const eq = (name, got, want) =>
  check(`${name} (${JSON.stringify(got)} = ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

const bkk = (y, m, d) => Date.UTC(y, m - 1, d) - 7 * 3600 * 1000;
const readBkk = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);

const EMP = {
  name: "สมชาย ใจดี", position: "ช่างซ่อม", department: "เทคนิค", branch: "สำนักงานใหญ่",
  employee_code: "EMP-2569-0001", hired_at: bkk(2026, 1, 1), employment_type: "monthly",
};
const PRIV = { national_id: "1101700207366", address: "123 ถนนสุขุมวิท กรุงเทพฯ", pay: { base_salary: 25000 } };

// ── 1. วันครบทดลองงาน — นับวันเริ่มงานเป็นวันที่ 1 ────────────────────────
// off-by-one ตรงนี้ = เอกสารระบุวันผิดหนึ่งวัน ซึ่งเป็นวันที่มีผลทางกฎหมาย
{
  // 1 ม.ค. + 119 วัน (นับวันแรกด้วย) → ม.ค.31 + ก.พ.28 + มี.ค.31 = วันที่ 90 คือ 31 มี.ค.
  // เหลืออีก 29 วัน → 29 เม.ย.
  eq("ทดลองงาน 119 วันจาก 1 ม.ค. 2026", readBkk(D.probationEnd(bkk(2026, 1, 1), 119)), "2026-04-29");
  eq("ทดลองงาน 1 วัน = วันเดียวกับวันเริ่มงาน", readBkk(D.probationEnd(bkk(2026, 1, 1), 1)), "2026-01-01");
  // ปีอธิกสุรทิน: 2028 มี ก.พ. 29 วัน
  eq("ข้ามเดือน ก.พ. ปีอธิกสุรทิน", readBkk(D.probationEnd(bkk(2028, 1, 1), 119)), "2028-04-28");
  eq("ไม่มีวันเริ่มงาน = null", D.probationEnd(0, 119), null);
  eq("ทดลองงาน 0 วัน = null", D.probationEnd(bkk(2026, 1, 1), 0), null);
}

// ── 2. อายุหนังสือเตือน ────────────────────────────────────────────────────
{
  eq("เตือน 1 ม.ค. อายุ 365 วัน", readBkk(D.warningExpiry(bkk(2026, 1, 1), 365)), "2027-01-01");
  const docs = [
    { type: "warning", expires_at: bkk(2027, 1, 1) },
    { type: "warning", expires_at: bkk(2026, 1, 1) },           // หมดอายุแล้ว
    { type: "warning", expires_at: bkk(2027, 1, 1), status: "void" }, // ยกเลิกแล้ว
    { type: "contract", expires_at: null },                      // คนละชนิด
  ];
  const now = bkk(2026, 6, 1);
  eq("นับเฉพาะใบที่ยังมีผลและไม่ถูกยกเลิก", D.activeWarnings(docs, now).length, 1);
  // ใบที่หมดอายุใช้อ้างอิงตอนพิจารณาโทษไม่ได้ การนับรวมทำให้เข้าใจผิดว่ามี
  // ประวัติมากกว่าจริง ซึ่งกระทบคนคนหนึ่งโดยตรง
  eq("ใบที่ยกเลิกไม่นับ", D.activeWarnings([docs[2]], now).length, 0);
  eq("ใบที่หมดอายุไม่นับ", D.activeWarnings([docs[1]], now).length, 0);
}

// ── 3. ออกเอกสารไม่ได้ถ้าข้อมูลไม่ครบ ──────────────────────────────────────
// เอกสารที่ออกโดยมีช่องว่างคือเอกสารที่ต้องพิมพ์ใหม่ ซึ่งแพงกว่าการบอกก่อนพิมพ์
{
  eq("สัญญาต้องมีเลขบัตรและที่อยู่",
    D.missingFor("contract", { employee: EMP, priv: { pay: { base_salary: 1 } } }).sort(),
    ["ที่อยู่", "เลขบัตรประชาชน"]);
  eq("ข้อมูลครบแล้วไม่ขาดอะไร", D.missingFor("contract", { employee: EMP, priv: PRIV }), []);
  // หนังสือเตือนไม่ต้องมีเลขบัตร/เงินเดือน — เตือนคนที่ยังไม่ได้ตั้งเงินเดือนได้
  eq("หนังสือเตือนไม่บังคับเลขบัตร/เงินเดือน",
    D.missingFor("warning", { employee: EMP, priv: {} }), []);
  eq("รับรองเงินเดือนต้องมีเงินเดือน",
    D.missingFor("salary_certificate", { employee: EMP, priv: {} }), ["เงินเดือนหรือค่าแรงรายวัน"]);
  eq("ไม่มีชื่อ = ออกไม่ได้ทุกชนิด",
    D.missingFor("warning", { employee: {}, priv: {} }), ["ชื่อ-สกุล"]);
}

// ── 4. ค่าจ้างที่พิมพ์ลงเอกสาร ─────────────────────────────────────────────
{
  eq("รายเดือน", D.payLine(EMP, PRIV), { amount: 25000, unit: "บาทต่อเดือน", period: "รายเดือน" });
  eq("รายวัน",
    D.payLine({ ...EMP, employment_type: "daily" }, { pay: { daily_rate: 500 } }),
    { amount: 500, unit: "บาทต่อวัน", period: "รายวัน" });
  // คนรายเดือนที่ยังไม่ได้ตั้งเงินเดือนแต่มีค่าแรงรายวัน → ใช้รายวัน ไม่ใช่คืน null
  eq("รายเดือนแต่มีแต่ค่าแรงรายวัน", D.payLine(EMP, { pay: { daily_rate: 500 } }).unit, "บาทต่อวัน");
  eq("ไม่มีทั้งคู่ = null", D.payLine(EMP, { pay: {} }), null);
}

// ── 5. เงื่อนไข: ตั้งบางช่องต้องไม่ทำให้ช่องอื่นหาย ───────────────────────
{
  const t = D.resolveContractTerms({ contract: { probation_days: 90 } });
  eq("ค่าที่ตั้งถูกใช้", t.probation_days, 90);
  eq("ช่องที่ไม่ได้ตั้งยังได้ค่าตั้งต้น", t.notice_days, D.DEFAULT_CONTRACT.notice_days);
  eq("ไม่มี contract เลย = ค่าตั้งต้นทั้งชุด",
    D.resolveContractTerms({}), D.DEFAULT_CONTRACT);
  // 0 ต้องแปลว่า "ไม่มีทดลองงาน" ไม่ใช่ "ไม่ได้ตั้ง แล้วตกกลับไป 119"
  eq("ตั้ง 0 = ศูนย์จริง ไม่ตกกลับค่าตั้งต้น",
    D.resolveContractTerms({ contract: { probation_days: 0 } }).probation_days, 0);
}

// ── 6. เลขที่เอกสาร ────────────────────────────────────────────────────────
{
  eq("รูปเลขที่", D.formatDocNumber("CT", 2569, 7), "CT-2569-0007");
  // แต่ละชนิดมี prefix ของตัวเอง — ลำดับสัญญากับหนังสือเตือนไม่ปนกัน
  const prefixes = Object.values(D.DOC_TYPES).map((t) => t.prefix);
  eq("prefix ไม่ซ้ำกัน", prefixes.length, new Set(prefixes).size);
}

// ── 7. เอกสารจริง ──────────────────────────────────────────────────────────
const TERMS = D.DEFAULT_CONTRACT;
const DOC = {
  number: "CT-2569-0001", issued_at: bkk(2026, 1, 1), terms: TERMS,
  pay: D.payLine(EMP, PRIV), probation_end: D.probationEnd(EMP.hired_at, TERMS.probation_days),
};
const render = (type, over = {}) => type === "contract"
  ? buildEmploymentContractPdf({ employee: EMP, priv: PRIV, doc: { ...DOC, ...over }, company: {} })
  : buildHrLetterPdf({ type, employee: EMP, priv: PRIV, doc: { ...DOC, ...over }, company: {} });

{
  for (const type of Object.keys(D.DOC_TYPES)) {
    const buf = await render(type, type === "warning" ? { incident: "มาสาย" } : {});
    const doc = await PDFDocument.load(buf);
    const { width, height } = doc.getPage(0).getSize();
    check(`${type}: A4`, Math.round(width) === 595 && Math.round(height) === 842);
    check(`${type}: มีเนื้อหาจริง (${buf.length} bytes)`, buf.length > 8000);
    check(`${type}: ฟอนต์ subset (${buf.length} bytes)`, buf.length < 40000);

    const names = [];
    let hasFontFile = false;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const s = String(obj);
      const m = s.match(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/);
      if (m) names.push(m[1]);
      if (/\/FontFile2?\b/.test(s)) hasFontFile = true;
    }
    check(`${type}: ฝังฟอนต์ไทยจริง`, names.some((n) => /Sarabun/.test(n)) && hasFontFile);
  }
}

// ── 8. ข้อความยาวต้องขึ้นหน้าใหม่ ไม่ใช่หายไป ─────────────────────────────
// **นี่คือด่านที่แพงที่สุดของไฟล์นี้** — pdf-lib วาดที่ y ติดลบเงียบๆ สัญญาที่
// ข้อความหายครึ่งหนึ่งยังนับเป็น "1 หน้า" และ "มีเนื้อหา" ผ่านทั้งสองเงื่อนไข
{
  const short = await render("contract");
  const long = await render("contract", {
    terms: { ...TERMS, extra_clauses: "ก".repeat(4000), benefits: "ข".repeat(2000) },
  });
  const sp = (await PDFDocument.load(short)).getPageCount();
  const lp = (await PDFDocument.load(long)).getPageCount();
  eq("สัญญาปกติ 1 หน้า", sp, 1);
  check(`ข้อตกลงยาวมากขึ้นหน้าใหม่ ไม่ใช่ข้อความหาย (${sp} → ${lp} หน้า)`, lp > sp);
  // **ทุกหน้าที่เพิ่มมาต้องมีข้อความจริง** — หน้าเปล่าก็นับเป็นหน้า และ pdf-lib
  // ก็ยินดีวาดข้อความที่ y ติดลบให้หายไปเงียบๆ การนับหน้าอย่างเดียวจึงไม่พอ
  const longDoc = await PDFDocument.load(long);
  const perPage = [];
  for (let i = 0; i < longDoc.getPageCount(); i++) perPage.push(textPositionsOn(longDoc, i));
  const allY = perPage.flat();
  // **ไม่มีข้อความตกนอกกระดาษ** — pdf-lib วาดที่ y ติดลบให้เงียบๆ หน้าก็ยังนับ
  // เป็นหน้า และตัวนับการวาดก็ยังเท่าเดิม มีแต่พิกัดที่บอกความจริง
  // **ต้องยืนยันก่อนว่าวัดได้จริง** — Math.min([]) คืน Infinity ซึ่งผ่านเงื่อนไข
  // "> 0" สบายๆ ด่านที่วัดไม่ได้เลยแล้วขึ้นเขียว คือด่านที่ไม่รู้ว่าตัวเองว่าง
  check(`วัดตำแหน่งข้อความได้จริง (${allY.length} จุด)`, allY.length > 50);
  check(`ไม่มีข้อความตกนอกกระดาษ (y ต่ำสุด ${Math.min(...allY).toFixed(0)})`,
    allY.length > 0 && Math.min(...allY) > 0);
  check(`ทุกหน้ามีข้อความจริง ไม่มีหน้าเปล่า (${perPage.map((p) => p.length).join(" / ")} จุด)`,
    perPage.every((p) => p.length > 5));
  const shortY = textPositionsOn(await PDFDocument.load(short), 0);
  check(`ข้อความที่เพิ่มมาถูกวาดจริง (${shortY.length} → ${allY.length} จุด)`, allY.length > shortY.length);
  check(`สัญญาปกติก็ไม่มีข้อความตกนอกกระดาษ (y ต่ำสุด ${Math.min(...shortY).toFixed(0)})`,
    shortY.length > 20 && Math.min(...shortY) > 0);

  const longLetter = await buildHrLetterPdf({
    type: "warning", employee: EMP, priv: PRIV,
    doc: { ...DOC, incident: "ก".repeat(5000) }, company: {},
  });
  check("จดหมายยาวก็ขึ้นหน้าใหม่", (await PDFDocument.load(longLetter)).getPageCount() > 1);
}

// ── 9. ตัดบรรทัดภาษาไทยห้ามแยกสระหน้าจากพยัญชนะ ───────────────────────────
// เจอจริงตอนเปิดดูสัญญาฉบับแรก: "และต่างเก็บไว้" ถูกตัดเป็น "และต่างเก็บไ" /
// "ว้ฝ่ายละหนึ่งฉบับ" — บนเอกสารที่คนต้องเซ็น
//
// **ทดสอบที่ตัวกฎโดยตรง ไม่ใช่หาคำในซอร์ส** — ด่านที่เช็คว่ามีคำว่า badBreak
// อยู่ในไฟล์ ยังเขียวหลังถอดลูปที่ใช้มันออก (injection ข้อ 8)
{
  const measure = (x) => [...x].length; // 1 ตัวอักษร = 1 หน่วย ทดสอบได้โดยไม่ต้องมีฟอนต์
  const LEAD = /[\u0E40-\u0E44]/;
  const COMB = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;

  // ไล่ความกว้างทุกค่า เพื่อให้จุดตัดตกที่ตำแหน่งอันตรายครบทุกแบบ
  const samples = [
    "และต่างเก็บไว้ฝ่ายละหนึ่งฉบับ",
    "ลูกจ้างตกลงเข้าทำงานในตำแหน่งช่างซ่อมอุปกรณ์",
    "นายจ้างตกลงจ่ายค่าจ้างให้ลูกจ้างในอัตราที่ตกลงกันไว้",
  ];
  let badLead = 0, badComb = 0, overflow = 0, lines = 0;
  for (const text of samples) {
    for (let w = 4; w <= 30; w++) {
      for (const ln of D.wrapText(text, w, measure)) {
        lines += 1;
        if (ln && LEAD.test(ln[ln.length - 1])) badLead += 1;
        if (ln && COMB.test(ln[0])) badComb += 1;
        if (measure(ln) > w) overflow += 1;
      }
    }
  }
  check(`ไม่มีบรรทัดจบด้วยสระหน้า (ตรวจ ${lines} บรรทัด)`, badLead === 0);
  check("ไม่มีบรรทัดขึ้นต้นด้วยสระบน/ล่างหรือวรรณยุกต์", badComb === 0);
  check("ไม่มีบรรทัดล้นความกว้าง", overflow === 0);

  // ต่อกลับแล้วต้องได้ข้อความเดิม — ตัดบรรทัดห้ามทำตัวอักษรหาย
  for (const text of samples) {
    eq(`ต่อกลับได้ข้อความเดิม (${text.slice(0, 10)}…)`,
      D.wrapText(text, 9, measure).join(""), text);
  }

  // เคสที่ตัดไม่ได้จริงๆ (สระหน้ายาวติดกัน) ต้องไม่วนไม่จบและไม่ทำข้อความหาย
  const pathological = "เเเเเเเเเเเเเเเเเเเเก";
  eq("สตริงที่ตัดไม่ได้ก็ยังต่อกลับได้ครบ",
    D.wrapText(pathological, 5, measure).join(""), pathological);
}

// ── 10. สาระของแต่ละฉบับ ───────────────────────────────────────────────────
{
  const warn = hrLetterBody({
    type: "warning", employee: EMP, priv: PRIV,
    doc: { ...DOC, incident: "มาสาย", expires_at: bkk(2027, 1, 1) }, company: {},
  });
  const text = warn.paras.join(" ");
  // สาระของหนังสือเตือน: ถ้าไม่เขียนว่าทำผิดซ้ำแล้วจะเป็นยังไง เอกสารใช้อ้างอิง
  // ตอนพิจารณาโทษครั้งถัดไปไม่ได้
  check("หนังสือเตือนบอกผลของการทำผิดซ้ำ", /กระทำผิดซ้ำ/.test(text));
  check("หนังสือเตือนระบุเหตุ", /มาสาย/.test(text));
  check("หนังสือเตือนบอกวันหมดอายุ", /มีผลถึงวันที่/.test(text));
  // ต้องมีช่องให้ผู้รับเซ็น ไม่งั้นพิสูจน์ไม่ได้ว่าส่งถึงมือ
  check("หนังสือเตือนมีช่องเซ็นผู้รับ", warn.signers.some((s) => /ผู้รับ/.test(s)));

  const cert = hrLetterBody({
    type: "salary_certificate", employee: EMP, priv: PRIV,
    doc: { ...DOC, purpose: "ยื่นต่อธนาคาร" }, company: {},
  });
  // เอกสารนี้เปิดเผยเงินเดือน — ต้องระบุว่าออกให้ใช้ทำอะไร ไม่ใช่แจกได้ทั่วไป
  check("รับรองเงินเดือนระบุวัตถุประสงค์", /ยื่นต่อธนาคาร/.test(cert.paras.join(" ")));
  check("รับรองเงินเดือนมีจำนวนเงินเป็นตัวอักษร", /\(/.test(cert.paras[1]));

  const pb = hrLetterBody({ type: "probation_pass", employee: EMP, priv: PRIV, doc: DOC, company: {} });
  check("ผ่านทดลองงานระบุวันครบกำหนด", /ครบกำหนดเมื่อวันที่/.test(pb.paras.join(" ")));
}

// ── 11. กติกาของ callable ──────────────────────────────────────────────────
{
  const raw = readFileSync(join(fnDir, "hr-documents-api.js"), "utf8");
  const src = raw.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  for (const name of ["adminHrDocumentList", "adminHrDocumentIssue", "adminHrDocumentPrint", "adminHrDocumentVoid"]) {
    const start = src.indexOf(`const ${name} = onCall`);
    check(`ตัด ${name} ได้จริง`, start > 0);
    const end = src.indexOf("\n  });", start);
    check(`${name} มี gate requireStaffRole(..., HR_ROLES)`,
      /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(src.slice(start, end)));
  }

  // เงื่อนไข freeze ลงทะเบียน — พิมพ์ซ้ำต้องได้ฉบับเดิม ไม่ใช่ฉบับที่ใช้ settings วันนี้
  check("freeze เงื่อนไขลงเอกสาร", /terms,\s*$/m.test(src) || /terms,/.test(src));
  const printBody = src.slice(src.indexOf("const adminHrDocumentPrint"), src.indexOf("const adminHrDocumentVoid"));
  check("พิมพ์ซ้ำใช้ doc จากทะเบียน", /const doc = snap\.val\(\)/.test(printBody));
  check("พิมพ์ซ้ำไม่อ่าน settings ใหม่", !/resolveContractTerms/.test(printBody));

  // ตรวจก่อนจองเลข — เลขที่จองแล้วออกเอกสารไม่ได้ = ช่องว่างในลำดับ
  const issueBody = src.slice(src.indexOf("const adminHrDocumentIssue"), src.indexOf("const adminHrDocumentPrint"));
  // **ต้องยืนยันว่าด่านมีอยู่จริงก่อนเทียบลำดับ** — `indexOf` ของสิ่งที่ถูกลบทิ้ง
  // คืน -1 ซึ่งน้อยกว่าทุกตำแหน่งเสมอ ด่านลำดับจึงเขียวตอนที่ด่านหายไปทั้งอัน
  // (injection ข้อ 13 เขียวด้วยเหตุนี้)
  const missingAt = issueBody.indexOf("missing.length");
  const allocAt = issueBody.indexOf("allocateDocNumber");
  check("มีด่านตรวจข้อมูลครบอยู่จริง", missingAt >= 0 && allocAt >= 0);
  check("ตรวจข้อมูลครบก่อนจองเลข", missingAt >= 0 && missingAt < allocAt);

  // เลขที่จองแล้วแต่ออกเอกสารไม่ได้ = ช่องว่างในลำดับที่อธิบายไม่ได้ตอนถูกตรวจ
  // **นับจำนวนการเขียนด้วย** — เช็คแค่ว่า renderDoc มาก่อน ref.set ยังเขียว
  // ถ้ามีการเขียนตัวที่สองแทรกไว้ก่อนหน้า (injection ข้อ 16)
  const writes = [...issueBody.matchAll(/\.set\(doc\)/g)].length;
  eq("เขียนทะเบียนครั้งเดียว", writes, 1);
  check("ลงทะเบียนหลังสร้าง PDF สำเร็จ",
    issueBody.indexOf("renderDoc") < issueBody.indexOf(".set(doc)"));
  check("หนังสือเตือนต้องระบุเหตุ", /type === "warning" && !str\(data\.incident\)/.test(issueBody));

  // ยกเลิกต้องมีเหตุผล และไม่ลบแถว
  const voidBody = src.slice(src.indexOf("const adminHrDocumentVoid"));
  check("ยกเลิกต้องมีเหตุผล", /if \(!reason\) throw new HttpsError/.test(voidBody));
  check("ยกเลิกไม่ลบแถว", !/\.remove\(\)/.test(voidBody) && /status: "void"/.test(voidBody));

  // ไม่เก็บไฟล์ลง Storage — เอกสารกลุ่มนี้มีเงินเดือน เลขบัตร และเรื่องวินัย
  check("ไม่เก็บ PDF ลง Storage", !/getStorage|bucket\(/.test(src));

  // เก็บซ้อนใต้ employeeId — ไม่ต้องพึ่ง .indexOn ที่อยู่คนละรีโป
  check("อ่านเอกสารเป็น subtree ของคนคนเดียว", /hr_documents\/\$\{employeeId\}/.test(src));
  check("ไม่ query ทั้งโหนดด้วย orderByChild", !/ref\("hr_documents"\)/.test(src));
}

// ── 12. หน้าเว็บและค่าตั้ง ─────────────────────────────────────────────────
{
  const idx = readFileSync(join(fnDir, "index.js"), "utf8");
  check("index.js ลงทะเบียน registerHrDocuments",
    /require\("\.\/hr-documents-api"\)\.registerHrDocuments\(\)/.test(idx));

  const ui = readFileSync(join(root, "src/pages/hr/EmployeeRegister.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  // ป้ายเปลี่ยนจาก "เอกสาร" เป็น "ออกเอกสาร" ตอนที่แฟ้มเอกสารพนักงาน (แนบไฟล์)
  // มาอยู่ข้างกันในแถวเดียวกัน — สองปุ่มที่ชื่อคล้ายกันในที่เดียวกันคือที่ที่คน
  // กดผิด ปุ่มนี้ "ออก" เอกสารใหม่ ส่วน "แฟ้ม" คือที่เก็บของที่มีอยู่แล้ว
  check("มีปุ่มออกเอกสารในทะเบียน", /<FileText size=\{13\} \/> ออกเอกสาร/.test(ui));
  check("ปุ่มออกเอกสารเปิดโมดอลออกเอกสารจริง", /onClick=\{\(\) => setDocsFor\(row\)\}/.test(ui));
  check("บอกก่อนกดว่าขาดอะไร", /ออกไม่ได้ — ยังไม่ได้กรอก/.test(ui));
  check("หนังสือเตือนกดไม่ได้ถ้าไม่กรอกเหตุ", /type === 'warning' && !extra\.incident\.trim\(\)/.test(ui));
  check("เตือนว่ามีหนังสือเตือนที่ยังมีผล", /หนังสือเตือนที่ยังมีผลอยู่/.test(ui));
  check("บอกว่าแก้ค่าตั้งไม่เปลี่ยนเอกสารเก่า", /จะไม่เปลี่ยนเอกสารที่ออกไปแล้ว/.test(ui));
  check("พิมพ์ซ้ำใบที่ยกเลิกแล้วเตือน", /ถูกยกเลิกไปแล้ว/.test(ui));

  // **ทุกฟิลด์ที่เอกสารบังคับ ต้องมีช่องให้กรอกในฟอร์มแก้ไขพนักงาน**
  //
  // เจอของจริง 4 ก.ย. 2569: `contract.needs` มี `address` แต่ฟอร์มไม่เคยมีช่อง
  // ที่อยู่เลย → กดออกสัญญาแล้วขึ้น "ยังไม่ได้กรอก: ที่อยู่ (แก้ที่ปุ่มแก้ไข)"
  // ซึ่งบอกให้ไปแก้ในที่ที่**ไม่มีช่องให้แก้** = ทางตัน ไม่มีเทสไหนจับได้เพราะ
  // ทั้งสองฝั่งถูกในตัวเอง สิ่งที่ผิดคือความสัมพันธ์ระหว่างกัน
  //
  // ลิสต์มาจาก DOC_TYPES ตรงๆ ไม่ได้พิมพ์ซ้ำ — เพิ่ม needs ใหม่แล้วลืมทำช่อง
  // กรอก เทสนี้แดงทันที
  {
    // `pay` ไม่ใช่ชื่อช่อง แต่เป็นก้อนที่ประกอบจากสองช่องนี้
    const FIELD_OF = { pay: ["base_salary", "daily_rate"] };
    const needs = [...new Set(Object.values(D.DOC_TYPES).flatMap((t) => t.needs || []))];
    check(`มี needs ให้ตรวจ (${needs.join(", ")})`, needs.length >= 3);
    for (const need of needs) {
      const keys = FIELD_OF[need] || [need];
      const found = keys.some((k) =>
        new RegExp(`field\\('${k}'|area\\('${k}'`).test(ui));
      check(`ฟอร์มมีช่องกรอก "${need}" (${keys.join(" หรือ ")})`, found);
    }
  }

  const st = readFileSync(join(root, "src/pages/hr/HrSettings.tsx"), "utf8");
  // **ห้ามลบกล่องเตือนนี้** — เอกสารจ้างงานมีผลผูกพันจริง คนกรอกต้องรู้ว่า
  // ระบบไม่ได้รับรองความถูกต้องตามกฎหมายให้
  check("หน้าตั้งค่าเตือนว่าระบบไม่ได้รับรองตามกฎหมาย",
    /ระบบไม่ได้ตรวจว่าค่าเหล่านี้ถูกต้องตามกฎหมายแรงงาน/.test(st));
  check("บอกให้ผู้ที่ปรึกษาตรวจฉบับแรก", /ตรวจฉบับแรกก่อนใช้จริง/.test(st));
  check("หน้าตั้งค่าเขียน contract ลง settings/hr", /contract: \{/.test(st));
  // MIRROR: ค่าตั้งต้นสองที่ต้องตรงกัน
  const uiDefaults = st.slice(st.indexOf("contract: {"), st.indexOf("};", st.indexOf("contract: {")));
  for (const [k, v] of Object.entries(D.DEFAULT_CONTRACT)) {
    if (typeof v !== "number") continue;
    check(`ค่าตั้งต้น ${k} ตรงกับฝั่ง functions (${v})`, new RegExp(`${k}: ${v}\\b`).test(uiDefaults));
  }
}

// ── 13. เวลาทำงานที่ประกาศต้องบวกกันลงตัว ────────────────────────────────
// **เจอจากการเปิดสัญญาฉบับจริงที่ออกไปแล้ว ไม่ใช่จากเทส** — ข้อ "เวลาทำงาน"
// พิมพ์ว่า "วันละ 8 ชั่วโมง ระหว่างเวลา 09:00 ถึง 18:00 น." ซึ่งเป็นช่วง 9
// ชั่วโมง และเอกสารไม่ได้พูดถึงเวลาพักเลย เอกสารที่คนต้องเซ็นจึงบวกกันไม่ลงตัว
// บนหน้ากระดาษ และใช้อ้างอิงตอนมีข้อพิพาทไม่ได้
{
  const base = { work_start: "09:00", work_end: "18:00", work_hours_per_day: 8, break_minutes: 60 };
  check("ค่าตั้งต้นลงตัวพอดี (9 ชม. − พัก 60 นาที = 8 ชม.)", D.workScheduleCheck(base).ok);
  eq("ช่วงเวลาเป็นนาที", D.workScheduleCheck(base).spanMin, 540);

  check("ไม่มีเวลาพัก = ไม่ลงตัว", !D.workScheduleCheck({ ...base, break_minutes: 0 }).ok);
  check("บอกตัวเลขที่ขัดกันในข้อความ",
    /9 ชม\./.test(D.workScheduleCheck({ ...base, break_minutes: 0 }).reason || ""));
  check("ชั่วโมงต่อวันมากกว่าช่วงเวลา = ไม่ลงตัว",
    !D.workScheduleCheck({ ...base, work_hours_per_day: 10 }).ok);
  check("พักยาวกว่าช่วงเวลาทั้งวัน = ไม่ผ่าน",
    !D.workScheduleCheck({ ...base, break_minutes: 600 }).ok);
  check("ยังไม่ตั้งชั่วโมงต่อวัน = ไม่ผ่าน",
    !D.workScheduleCheck({ ...base, work_hours_per_day: 0 }).ok);
  check("เวลาผิดรูป = ไม่ผ่าน", !D.workScheduleCheck({ ...base, work_start: "9 โมง" }).ok);
  check("ชั่วโมงเกิน 23 = ไม่ผ่าน", !D.workScheduleCheck({ ...base, work_start: "25:00" }).ok);

  // กะข้ามคืนต้องคิดถูก ไม่ใช่ได้ค่าติดลบ
  const night = D.workScheduleCheck({ work_start: "22:00", work_end: "07:00", work_hours_per_day: 8, break_minutes: 60 });
  check("กะข้ามคืนคิดถูก", night.ok && night.spanMin === 540);
  // เริ่มเท่ากับเลิก = ช่วงศูนย์ ไม่ใช่ 24 ชม. (กะยาว 24 ชม.ไม่มีอยู่จริง)
  check("เริ่มเท่ากับเลิก = ไม่ผ่าน",
    !D.workScheduleCheck({ ...base, work_start: "09:00", work_end: "09:00" }).ok);
}

// ── 14. สัญญาที่ขัดกันเองต้องออกไม่ได้ และเอกสารต้องพูดถึงเวลาพัก ─────────
{
  const api = readFileSync(join(fnDir, "hr-documents-api.js"), "utf8")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  check("ตรวจเวลาทำงานก่อนออกสัญญา", /workScheduleCheck\(terms\)/.test(api));
  check("ไม่ลงตัวแล้ว throw", /if \(!sched\.ok\) \{\s*throw new HttpsError/.test(api));
  // ต้องตรวจ **ก่อน** จองเลข ไม่งั้นเลขหายจากลำดับโดยไม่มีเอกสาร
  // เทียบกับ **จุดที่เรียก** ไม่ใช่ชื่อฟังก์ชันเปล่าๆ — `allocateDocNumber(db, type`
  // ตรงกับบรรทัดนิยามฟังก์ชันที่อยู่บนสุดของไฟล์ด้วย ทำให้เงื่อนไข "มาก่อน"
  // เป็นจริงเสมอโดยไม่ได้พิสูจน์อะไร (เจอตอนเขียนเทสนี้เอง)
  check("ตรวจก่อนจองเลขที่เอกสาร",
    api.includes("await allocateDocNumber(db, type")
    && api.indexOf("workScheduleCheck(terms)") < api.indexOf("await allocateDocNumber(db, type"));
  // ด่านนี้ต้องไม่ไปบล็อกเอกสารชนิดอื่นที่ไม่ได้พูดถึงเวลาทำงาน — ต้องเทียบ
  // เงื่อนไข **ที่ครอบด่านนี้จริงๆ** ไม่ใช่หาข้อความ `type === "contract"`
  // ลอยๆ ซึ่งมีอยู่อีกสามที่ในไฟล์ (เปลี่ยนเงื่อนไขเป็น `if (true)` แล้วเทส
  // ยังเขียว — injection ข้อ 6 จับได้)
  check("บล็อกเฉพาะสัญญาจ้าง",
    /if \(type === "contract"\) \{\s*const sched = workScheduleCheck\(terms\);/.test(api));

  const pdf = readFileSync(join(fnDir, "voucher-pdf.js"), "utf8");
  check("สัญญาพิมพ์เวลาพักออกมาด้วย", /เวลาพักระหว่างวัน \$\{Math\.round\(Number\(t\.break_minutes\)\)\} นาที/.test(pdf));
  // พัก 0 นาที = ไม่พิมพ์ประโยคนั้น ดีกว่าพิมพ์ "พัก 0 นาที" ซึ่งอ่านแล้วแปลก
  check("พัก 0 นาทีไม่พิมพ์ประโยคเวลาพัก", /Number\(t\.break_minutes\) > 0/.test(pdf));
}

// ── 15. MIRROR: กฎเวลาทำงานมีสองสำเนา (JS ฝั่ง server · TS ฝั่งหน้าเว็บ) ──
// ตัวที่ตัดสินจริงคือฝั่ง server (มันบล็อกการออกเอกสาร) ตัว TS มีไว้เตือนตั้งแต่
// ตอนพิมพ์ค่า **แก้สูตรต้องแก้ทั้งคู่** — เทียบจากข้อความจริงในไฟล์เพราะ
// functions import TS ไม่ได้ (รูปเดียวกับ walletCategoryParity ของแอปไรเดอร์)
{
  const js = readFileSync(join(fnDir, "hr-documents.js"), "utf8");
  const ts = readFileSync(join(root, "src/utils/workSchedule.ts"), "utf8");
  const KEY_LINES = [
    "const spanMin = end > start ? end - start : end === start ? 0 : end + 24 * 60 - start;",
    "if (breakMin >= spanMin) {",
    "if (spanMin - breakMin !== workMin) {",
  ];
  for (const line of KEY_LINES) {
    check(`สูตรตรงกันทั้งสองสำเนา: ${line.slice(0, 42)}...`,
      js.includes(line) && ts.includes(line));
  }
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
