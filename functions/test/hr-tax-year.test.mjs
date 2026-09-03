// ---------------------------------------------------------------------------
// เอกสารภาษีรายปีของพนักงาน — 50 ทวิ + ภ.ง.ด.1ก
//
//   node functions/test/hr-tax-year.test.mjs
//
// ตัวเลขทุกตัวในไฟล์นี้คิดด้วยมือ ไม่ได้เอาผลลัพธ์ของโค้ดมาแปะ — เทสที่
// assert สิ่งที่โค้ดคืนมาคือเทสที่เห็นด้วยกับตัวเองเสมอ
//
// ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) — 3 ก.ย. 2569
//
//   #   ทำลายอะไร                                    ผล
//   1   ปีภาษีอิงงวดแทนวันจ่าย                        แดง 4
//   2   ถอด offset เวลาไทย (อ่านเป็น UTC)             แดง
//   3   นับรอบที่อนุมัติแล้วแต่ยังไม่จ่ายด้วย           แดง 13
//   4   กรองรอบค้างทิ้งเงียบๆ                          แดง
//   5   ไม่ข้ามบรรทัดที่ skipped                       แดง
//   6   ใช้ชื่อของรอบแรกแทนรอบล่าสุด                   เขียว* → เพิ่มลำดับที่สอง
//   7   เอกสารระบุ ม.40(8) แทน 40(1)                  แดง 2
//   8   ถอดบรรทัดประกันสังคม                          แดง
//   9   อ้างแบบ ภ.ง.ด.3 แทน 1/1ก                      แดง 2
//  10   ถอดป้ายฉบับพรีวิว                              แดง 2
//  11   ถอดป้ายฉบับออกซ้ำ                              แดง 2
//  12   เอกสารคิดยอดภาษีเอง                            แดง
//  13   ถอด gate สิทธิ์ของ summary                     แดง
//  14   ถอด gate สิทธิ์ของ 50 ทวิ                       แดง
//  15   จองเลขให้ฉบับพรีวิวด้วย                         แดง
//  16   ออกซ้ำแล้วได้เลขใหม่                            แดง
//  17   ลงทะเบียนเลขก่อนสร้าง PDF                      แดง
//  18   ใช้ตัวนับเลขร่วมกับไรเดอร์                       แดง
//  19   กวาด payroll_items ทั้งโหนด                     แดง
//  20   เก็บ PDF ลง Storage                            แดง
//  21   ถอดปุ่ม 50 ทวิ                                  แดง
//  22   ถอดปุ่ม ภ.ง.ด.1ก                                แดง
//  23   ถอดกล่องเตือนรอบค้างจ่าย                        เขียว* → ปักที่กล่อง
//  24   ถอดหมายเหตุว่า CSV ไม่ใช่ e-filing              เขียว* → ปักที่หมายเหตุ
//  25   ถอดการลงทะเบียน callable ใน index.js            แดง
//  26   เปิด route ให้ทุก role                          เขียว* → อ่านทีละบรรทัด
//  27   ถอด /payroll ออกจากขอบเขต HR                    แดง
//  28   ถอดคู่ (3+4 พร้อมกัน เผื่อกลบกันเอง)             แดง 14
//
// สี่ข้อที่เขียว (*) **เป็นเทสว่างทั้งหมด ไม่ใช่บั๊กในโค้ด** และสามในสี่เป็น
// รูปเดียวกัน: เทสหาข้อความทั้งไฟล์แล้วไปเจอสำเนาที่ลูกค้าไม่มีวันเห็น
// (คอมเมนต์ · toast · route บรรทัดถัดไป) ส่วนข้อ 6 คือคำตอบที่ถูกด้วยลำดับ
// ที่บังเอิญวนเจอ ไม่ใช่ด้วยกฎ — แก้ครบทั้งสี่แล้วและยืนยันว่าแดงจริง
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

const { taxYearOfRun, aggregateTaxYear, bangkokYear } = require(join(fnDir, "hr-tax-year.js"));
const { buildEmployeeWhtCertificatePdf } = require(join(fnDir, "voucher-pdf.js"));
const { PDFDocument } = require("pdf-lib");

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const eq = (name, got, want) =>
  check(`${name} (${JSON.stringify(got)} = ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

/** เวลาไทยเป็น epoch — เขียนเป็นเวลาที่คนไทยอ่าน แล้วถอย 7 ชม.เป็น UTC */
const bkk = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h - 7, 0, 0);

// ── 1. ปีภาษีตัดที่วันจ่ายเงิน ไม่ใช่งวดงาน ────────────────────────────────
{
  eq("จ่ายในเดือนเดียวกับงวด = ปีเดียวกัน",
    taxYearOfRun({ period: "2569-10", pay_date: bkk(2026, 10, 25) }), 2026);

  // เคสที่กฎนี้มีไว้เพื่อ: งวดธันวาคมถูกจ่ายต้นเดือนมกราคมของปีถัดไป
  // เงินได้ก้อนนี้เป็นของปีภาษีใหม่ ไม่ใช่ปีของงวดงาน
  eq("งวด ธ.ค. จ่าย ม.ค. ปีถัดไป = ปีภาษีถัดไป",
    taxYearOfRun({ period: "2569-12", pay_date: bkk(2027, 1, 5) }), 2027);

  // ไม่มีวันจ่าย (ข้อมูลเก่า/เสีย) ต้องตกไปที่งวด ไม่ใช่คืนปี 1970 แล้วหายทั้งรอบ
  eq("ไม่มีวันจ่าย ตกไปใช้งวด", taxYearOfRun({ period: "2569-10" }), 2026);
  eq("ไม่มีทั้งคู่ = null", taxYearOfRun({}), null);
}

// ── 2. เส้นแบ่งปีต้องเป็นเวลาไทย ───────────────────────────────────────────
// 31 ธ.ค. 23:30 เวลาไทย = 16:30 UTC วันเดียวกัน — ถ้าอ่านเป็น UTC ยังได้ปีเดิม
// แต่ 1 ม.ค. 00:30 เวลาไทย = 31 ธ.ค. 17:30 UTC ซึ่ง**อ่านเป็น UTC จะได้ปีเก่า**
// นี่คือฝั่งที่จับ off-by-one ของโซนเวลาได้จริง
{
  eq("31 ธ.ค. 23:30 เวลาไทย = ปีเดิม", bangkokYear(bkk(2026, 12, 31, 23.5)), 2026);
  eq("1 ม.ค. 00:30 เวลาไทย = ปีใหม่", bangkokYear(bkk(2027, 1, 1, 0.5)), 2027);
}

// ── 3. รวมยอดทั้งปี ────────────────────────────────────────────────────────
const item = (id, code, name, gross, wht, sso) => ({
  employee_id: id, employee_code: code, name, gross, wht, sso_employee: sso,
});

const RUNS = [
  { id: "2568-12", status: "paid", pay_date: bkk(2025, 12, 25) },   // ปีก่อน
  { id: "2569-10", status: "paid", pay_date: bkk(2026, 10, 25) },
  { id: "2569-11", status: "paid", pay_date: bkk(2026, 11, 25) },
  { id: "2569-12", status: "approved", pay_date: bkk(2026, 12, 25) }, // อนุมัติแล้วแต่ยังไม่โอน
];
const ITEMS = {
  "2568-12": [item("a", "EMP-2568-0001", "สมชาย", 99999, 9999, 875)],
  "2569-10": [
    item("a", "EMP-2568-0001", "สมชาย", 50000, 1000, 875),
    item("b", "EMP-2569-0002", "สมหญิง", 30000, 200, 750),
  ],
  "2569-11": [
    item("a", "EMP-2568-0001", "สมชาย", 50000, 1000, 875),
    item("b", "EMP-2569-0002", "สมหญิง", 30000, 200, 750),
  ],
  "2569-12": [
    item("a", "EMP-2568-0001", "สมชาย", 50000, 1000, 875),
    item("b", "EMP-2569-0002", "สมหญิง", 30000, 200, 750),
  ],
};

const SUM = aggregateTaxYear({ year: 2026, runs: RUNS, itemsByRun: ITEMS });

{
  eq("นับเฉพาะรอบที่จ่ายแล้วในปีนั้น", SUM.runs_counted, ["2569-10", "2569-11"]);
  eq("รอบที่ยังไม่จ่ายถูกรายงาน ไม่ได้หายเงียบ",
    SUM.runs_pending.map((p) => `${p.id}:${p.status}`), ["2569-12:approved"]);
  eq("ปีพุทธศักราชคิดจากปีคริสต์", SUM.buddhist_year, 2569);
  eq("จำนวนคน", SUM.totals.headcount, 2);

  // คิดมือ: สมชาย 50,000 × 2 งวด = 100,000 · ภาษี 1,000 × 2 = 2,000 · สปส. 875 × 2 = 1,750
  const a = SUM.rows.find((r) => r.employee_id === "a");
  eq("สมชาย เงินได้ทั้งปี", a.gross, 100000);
  eq("สมชาย ภาษีทั้งปี", a.wht, 2000);
  eq("สมชาย ประกันสังคมทั้งปี", a.sso_employee, 1750);
  eq("สมชาย จำนวนงวด", a.periods, 2);

  // คิดมือ: สมหญิง 30,000 × 2 = 60,000 · ภาษี 200 × 2 = 400 · สปส. 750 × 2 = 1,500
  const b = SUM.rows.find((r) => r.employee_id === "b");
  eq("สมหญิง เงินได้ทั้งปี", b.gross, 60000);
  eq("สมหญิง ภาษีทั้งปี", b.wht, 400);
  eq("สมหญิง ประกันสังคมทั้งปี", b.sso_employee, 1500);

  // รวม = 100,000 + 60,000 = 160,000 · 2,000 + 400 = 2,400 · 1,750 + 1,500 = 3,250
  eq("รวมเงินได้", SUM.totals.gross, 160000);
  eq("รวมภาษี", SUM.totals.wht, 2400);
  eq("รวมประกันสังคม", SUM.totals.sso_employee, 3250);

  // รอบของปีก่อน (99,999) ต้องไม่ปนเข้ามาเลย — ตัวเลขนี้ถูกเลือกให้เห็นชัดถ้าปน
  check("ยอดของปีก่อนไม่ปนเข้ามา", SUM.totals.gross === 160000 && !SUM.runs_counted.includes("2568-12"));

  eq("ช่วงวันจ่ายของสมชาย", [a.first_pay_date, a.last_pay_date], [bkk(2026, 10, 25), bkk(2026, 11, 25)]);
  eq("เรียงตามรหัสพนักงาน", SUM.rows.map((r) => r.employee_code),
    ["EMP-2568-0001", "EMP-2569-0002"]);
}

// ── 4. บรรทัดที่ถูกข้ามไม่นับ ───────────────────────────────────────────────
{
  const s = aggregateTaxYear({
    year: 2026,
    runs: [{ id: "2569-10", status: "paid", pay_date: bkk(2026, 10, 25) }],
    itemsByRun: { "2569-10": [{ ...item("a", "E1", "สมชาย", 50000, 1000, 875), skipped: true }] },
  });
  eq("บรรทัดที่ skipped ไม่เข้ายอด", s.totals, { headcount: 0, gross: 0, wht: 0, sso_employee: 0 });
}

// ── 5. เปลี่ยนนามสกุลกลางปี — เอกสารต้องใช้ชื่อล่าสุด ──────────────────────
// **ต้องทดสอบทั้งสองลำดับ** — ตอนแรกส่งมาเรียงจากใหม่ไปเก่าอย่างเดียว ซึ่ง
// ทำให้คำตอบถูกด้วย "ตัวแรกที่วนเจอ" ไม่ใช่ด้วยการเทียบวันจ่าย เทสจึงเขียว
// ทั้งที่กฎถูกทำลาย (injection ข้อ 6) ลำดับที่ RTDB คืนมาไม่มีใครรับประกัน
{
  const NAMES = {
    "2569-10": [item("a", "E1", "สมชาย นามเดิม", 10000, 0, 500)],
    "2569-11": [item("a", "E1", "สมชาย นามใหม่", 10000, 0, 500)],
  };
  const oct = { id: "2569-10", status: "paid", pay_date: bkk(2026, 10, 25) };
  const nov = { id: "2569-11", status: "paid", pay_date: bkk(2026, 11, 25) };
  for (const [label, runs] of [["เก่าก่อนใหม่", [oct, nov]], ["ใหม่ก่อนเก่า", [nov, oct]]]) {
    const s = aggregateTaxYear({ year: 2026, runs, itemsByRun: NAMES });
    eq(`ใช้ชื่อของรอบที่จ่ายล่าสุด (${label})`, s.rows[0].name, "สมชาย นามใหม่");
  }
}

// ── 6. ปีที่ไม่มีรอบจ่ายเลย ─────────────────────────────────────────────────
{
  const s = aggregateTaxYear({ year: 2030, runs: RUNS, itemsByRun: ITEMS });
  eq("ปีที่ไม่มีข้อมูล = ตารางว่าง ไม่ throw", [s.rows.length, s.runs_counted.length], [0, 0]);
}

// ── 7. เอกสาร 50 ทวิ ของจริง ───────────────────────────────────────────────
const CERT = {
  number: "WHTE-2569-0001",
  buddhist_year: 2569,
  name: "สมชาย ใจดี",
  employee_code: "EMP-2568-0001",
  gross: 100000, wht: 2000, sso_employee: 1750, periods: 2,
  first_pay_date: bkk(2026, 10, 25), last_pay_date: bkk(2026, 11, 25),
  draft: false, reissued: false,
};
{
  const buf = await buildEmployeeWhtCertificatePdf({
    employee: { name: "สมชาย ใจดี" },
    priv: { national_id: "1234567890121", address: "123 ถนนสุขุมวิท กรุงเทพฯ 10110" },
    cert: CERT, company: {},
  });
  const doc = await PDFDocument.load(buf);
  eq("50 ทวิ เป็นหน้าเดียว", doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  check("ขนาดกระดาษ A4", Math.round(width) === 595 && Math.round(height) === 842);
  check(`มีเนื้อหาจริง ไม่ใช่หน้าเปล่า (${buf.length} bytes)`, buf.length > 8000);

  const fontNames = [];
  let hasFontFile = false;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const s = String(obj);
    const m = s.match(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/);
    if (m) fontNames.push(m[1]);
    if (/\/FontFile2?\b/.test(s)) hasFontFile = true;
  }
  check(`ฝังฟอนต์ Sarabun (${fontNames.join(", ") || "ไม่พบ"})`, fontNames.some((n) => /Sarabun/.test(n)));
  check("ฟอนต์ถูกฝังจริง ไม่ใช่แค่อ้างชื่อ", hasFontFile);
  check(`ฟอนต์ถูก subset (${buf.length} bytes)`, buf.length < 40000);
}

// ── 8. สาระของเอกสารที่ทำให้มันเป็นใบของลูกจ้าง ไม่ใช่ของไรเดอร์ ──────────
{
  const src = readFileSync(join(fnDir, "voucher-pdf.js"), "utf8");
  const i = src.indexOf("async function buildEmployeeWhtCertificatePdf");
  const fn = src.slice(i, src.indexOf("\nmodule.exports", i));
  check("ตัดตัวฟังก์ชันได้จริง", i > 0 && fn.length > 500);

  // สามอย่างนี้คือสิ่งที่แยกใบของลูกจ้างออกจากใบของไรเดอร์ ถ้าหายไปแปลว่า
  // เอกสารกลายเป็นใบผิดประเภทโดยที่หน้าตายังเหมือนเดิม
  check("ระบุเงินได้ ม.40(1)", /มาตรา 40\(1\)/.test(fn));
  check("อ้างแบบ ภ.ง.ด.1 และ 1ก", /ภ\.ง\.ด\.1 และสรุปรายปีตามแบบ ภ\.ง\.ด\.1ก/.test(fn));
  check("มีบรรทัดเงินสมทบประกันสังคม", /จ่ายเข้ากองทุนประกันสังคม/.test(fn));
  check("ไม่ใช้ถ้อยคำของใบไรเดอร์", !/ภ\.ง\.ด\.3/.test(fn) && !/40\(8\)/.test(fn));

  // ตัวเลขต้องมาจาก cert ที่รวมมาแล้ว ไม่บวกเองในตัววาด
  check("ไม่ import ตัวรวมยอด", !/hr-tax-year|aggregateTaxYear/.test(fn));
  check("ยอดภาษีพิมพ์ค่าจาก cert", /thb\(cert\.wht\)/.test(fn));
  check("ยอดเงินได้พิมพ์ค่าจาก cert", /thb\(cert\.gross\)/.test(fn));
  check("ยอดประกันสังคมพิมพ์ค่าจาก cert", /thb\(cert\.sso_employee\)/.test(fn));
  check("มีจำนวนเงินเป็นตัวอักษร", /bahtText\(cert\.wht\)/.test(fn));
  check("เตือนว่าเป็นข้อมูลส่วนบุคคล", /ข้อมูลส่วนบุคคล/.test(fn));
  check("ฉบับพรีวิวติดป้ายบนหน้ากระดาษ", /cert\.draft/.test(fn));
  check("ฉบับออกซ้ำติดป้ายบนหน้ากระดาษ", /cert\.reissued/.test(fn));
}

// ── 9. ฉบับพรีวิวกับฉบับออกซ้ำต้องพิมพ์ป้ายลงกระดาษจริง ────────────────────
// การมีคำว่า cert.draft ในซอร์สพิสูจน์แค่ว่ามีโค้ดเขียนไว้ — เทียบใบที่ต่างกัน
// แค่ธงเดียวจึงจะรู้ว่ากิ่งนั้นถูกเดินถึง
{
  const render = async (over) => buildEmployeeWhtCertificatePdf({
    employee: { name: "สมชาย ใจดี" }, priv: {}, cert: { ...CERT, ...over }, company: {},
  });
  const plain = await render({});
  const draft = await render({ draft: true });
  const reissue = await render({ reissued: true });
  check(`ป้ายพรีวิวถูกพิมพ์ลงกระดาษ (${plain.length} → ${draft.length})`, draft.length > plain.length);
  check(`ป้ายออกซ้ำถูกพิมพ์ลงกระดาษ (${plain.length} → ${reissue.length})`, reissue.length > plain.length);
}

// ── 10. กติกาของ callable ──────────────────────────────────────────────────
{
  const api = readFileSync(join(fnDir, "hr-tax-api.js"), "utf8");

  for (const name of ["adminHrTaxYearSummary", "adminHrWhtCertificate"]) {
    const start = api.indexOf(`const ${name} = onCall`);
    const end = api.indexOf("\n  });", start);
    check(`ตัด ${name} ได้จริง`, start > 0 && end > start);
    const body = api.slice(start, end);
    check(`${name} มี gate requireStaffRole(..., HR_ROLES)`,
      /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(body));
    check(`${name} ไม่เก็บ PDF ลง Storage`, !/getStorage|bucket\(/.test(body));
  }

  const start = api.indexOf("const adminHrWhtCertificate = onCall");
  const body = api.slice(start, api.indexOf("\n  });", start));
  // เลขที่ต้องจองเมื่อ "ยังไม่เคยออก และไม่ใช่พรีวิว" เท่านั้น
  check("ไม่จองเลขให้ฉบับพรีวิว", /if \(!number && !preview\)/.test(body));
  check("ออกซ้ำใช้เลขเดิมจากทะเบียน", /existing \? existing\.number : null/.test(body));
  check("ลงทะเบียนหลังสร้าง PDF สำเร็จ",
    body.indexOf("buildEmployeeWhtCertificatePdf") < body.indexOf("regRef.set("));

  // ตัวนับต้องแยกจากของไรเดอร์ ไม่งั้นลำดับเลขของทั้งสองแบบยื่นจะมีช่องว่าง
  // สลับกันโดยไม่มีเหตุผลที่อธิบายได้
  check("ตัวนับเลขแยกจากของไรเดอร์",
    /wht_employee_seq_by_year/.test(api) && !/settings\/accounting\/wht_seq_by_period/.test(api));
  check("รูปเลขที่เป็น WHTE-{ปี}-####", /`WHTE-\$\{buddhistYear\}-\$\{String\(seq\)\.padStart\(4, "0"\)\}`/.test(api));

  // อ่าน payroll_items รายงวด ไม่กวาดทั้งโหนด (กฎค่า RTDB)
  check("ไม่กวาด payroll_items ทั้งโหนด", !/ref\("payroll_items"\)/.test(api));
}

// ── 11. index.js ต้อง export ทั้งสองตัว ────────────────────────────────────
{
  const idx = readFileSync(join(fnDir, "index.js"), "utf8");
  check("index.js ลงทะเบียน registerHrTax", /require\("\.\/hr-tax-api"\)\.registerHrTax\(\)/.test(idx));
}

// ── 12. หน้าเว็บ ───────────────────────────────────────────────────────────
{
  const ui = readFileSync(join(root, "src/pages/hr/TaxYear.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  check("มีปุ่มออก 50 ทวิ", /50 ทวิ \(PDF\)/.test(ui));
  check("มีปุ่มส่งออก ภ.ง.ด.1ก", /ภ\.ง\.ด\.1ก \(CSV\)/.test(ui));
  check("บอกว่านับเฉพาะรอบที่จ่ายแล้ว", /รอบที่จ่ายแล้ว/.test(ui));
  // ปักที่กล่องเตือนกับหมายเหตุท้ายหน้า ไม่ใช่หาคำทั้งไฟล์ — ถ้อยคำเดียวกัน
  // อยู่ใน toast และในคอมเมนต์หัวไฟล์ด้วย ถอดกล่องเตือนทิ้งแล้วเทสยังเขียว
  // ได้ด้วยข้อความที่ลูกค้าไม่มีวันเห็น (injection ข้อ 23/24)
  check("เตือนเมื่อยังมีรอบค้างจ่าย", /รอบ — ตัวเลขยังไม่ครบ/.test(ui));
  check("บอกว่า CSV ไม่ใช่ไฟล์ e-filing", /ตารางตัวเลขต่อคน ไม่ใช่ไฟล์ e-filing/.test(ui));

  // ต้องอ่านทีละบรรทัด — regex ที่ข้ามบรรทัดได้จะไปเจอ 'CEO'/'HR' ของ route
  // ถัดไป (/hr-settings) แล้วเขียวทั้งที่ route นี้ถูกเปิดให้ทุกคน (injection ข้อ 26)
  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  const routeLine = app.split("\n").find((l) => l.includes('path="/payroll/tax-year"')) || "";
  check(`route ถูก gate ด้วย CEO/HR (${routeLine.trim().slice(0, 60)}...)`,
    /'CEO'/.test(routeLine) && /'HR'/.test(routeLine) && /Navigate to="\/"/.test(routeLine));

  // เส้นทางต้องอยู่ในขอบเขตของ role HR ไม่งั้น HR กดเมนูแล้วถูกเด้งกลับ
  const scope = readFileSync(join(root, "src/utils/hrScope.ts"), "utf8");
  const prefixes = [...scope.matchAll(/'(\/[a-z-]+)'/g)].map((m) => m[1]);
  check(`/payroll/tax-year อยู่ในขอบเขต HR (prefix: ${prefixes.join(" ")})`,
    prefixes.some((p) => "/payroll/tax-year".startsWith(`${p}/`)));
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
