// ---------------------------------------------------------------------------
// สลิปเงินเดือน — เอกสารที่พนักงานถือไปเป็นหลักฐาน
//
//   node functions/test/hr-payslip.test.mjs
//
// เทสนี้ **สร้าง PDF จริงแล้วตรวจผลลัพธ์** ไม่ใช่แค่ดูว่าฟังก์ชันไม่ throw
// เพราะบทเรียนเรื่องผลพิมพ์ใน CLAUDE.md บอกไว้ว่า "โค้ดถูกทุกด่าน แต่ผิดบน
// กระดาษ" — และหน้าเปล่าก็ผ่านเงื่อนไข "1 หน้า" ได้เหมือนกัน จึงต้องยืนยันว่า
// มีเนื้อหาจริงก่อนเชื่อผลอื่น
//
// ข้อจำกัดที่รู้ตัว: ตรวจได้ถึงระดับ "กล่องหน้าถูกและมีตัวอักษรฝังอยู่จริง"
// ยังไม่ได้ตรวจว่าข้อความไปทับกันไหม — ตัวนั้นต้องเปิดดูด้วยตา ซึ่งทำแล้ว
// ตอนพัฒนา (screenshot ผ่าน Chromium) แต่ไม่ได้ทำเป็นด่านถาวรใน CI
//
// ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) — 3 ก.ย. 2569
//
//   #   ทำลายอะไร                                  ผล
//   1   ใช้ฟอนต์มาตรฐานแทน Sarabun                 แดง (pdf-lib โยน
//       "WinAnsi cannot encode ส" — ภาษาไทยกลายเป็นกล่องเงียบๆ ไม่ได้)
//   2   ปิด subset ของฟอนต์                        เขียว → เพิ่มเพดานขนาดไฟล์
//   3   เปลี่ยนกระดาษเป็น Letter                    แดง
//   4   ถอดหัวข้อที่มาของภาษี                       แดง
//   5   ถอดคำอธิบายเงินสมทบฝั่งนายจ้าง              แดง
//   6   ถอดจำนวนเงินเป็นตัวอักษร                    แดง
//   7   ถอดคำเตือนข้อมูลส่วนบุคคล                   แดง
//   8   ปิดกิ่งยอดภาษีที่ปรับด้วยมือ                 เขียว → เทียบสองใบที่ต่าง
//       กันแค่กิ่งนี้ (ครั้งแรกเทียบผิดคู่ ยังเขียว — ดูคอมเมนต์ที่ข้อนั้น)
//   9   ให้กล่องยอดสุทธิคิดเลขเอง                    เขียว → ปักที่กล่อง
//  10   พิมพ์เลขบัญชีเต็มแทน mask                    แดง
//  11   ถอด gate สิทธิ์ของ callable                  แดง
//  12   ปิดด่านบรรทัดที่ยังกรอกไม่ครบ                เขียว → ปักที่รูปของ if
//  13   ถอดป้ายรอบร่างออกจากชื่อไฟล์                 แดง
//  14   เก็บสลิปลง Storage                          แดง (หลังแก้ช่วงที่ slice)
//  15   ถอดปุ่มสลิปออกจากหน้า                       แดง
//  16   เปิดปุ่มทั้งที่บรรทัดยังกรอกไม่ครบ            แดง
//  17   ถอดคำเตือนรอบร่าง                           แดง
//
// สี่ข้อที่เขียว (2, 8, 9, 12) **ไม่มีข้อไหนเป็นบั๊กในโค้ด — ทั้งสี่เป็นเทสที่
// ว่าง** ตรงกับบทเรียนใน CLAUDE.md: injection มีไว้ตรวจเทส ไม่ใช่ตรวจโค้ด
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

const { buildPayslipPdf } = require(join(fnDir, "voucher-pdf.js"));
const {
  resolvePayrollConfig, periodBounds, payDateOf, buildPayrollItem, bangkokMidnight,
} = require(join(fnDir, "hr-payroll.js"));
const { PDFDocument } = require("pdf-lib");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { failures++; console.log(`FAIL  ${label}`); }
};
const eq = (label, got, want) => {
  if (got !== want) console.log(`      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  check(label, got === want);
};

const CFG = resolvePayrollConfig({ payroll: { cutoff_day: 25, pay_day: 28 } });
const bounds = periodBounds(2026, 9, 25);
const RUN = {
  id: "2569-09", period: "2569-09",
  period_from: bounds.from, period_to: bounds.to,
  pay_date: payDateOf(2026, 9, 28), status: "approved",
};

const mkItem = (input, priv) => buildPayrollItem({
  employee: {
    id: "e1", name: "สุดารัตน์ ผาสุขพนักงาน", employee_code: "EMP-2569-0001",
    employment_type: "monthly", hired_at: bangkokMidnight(2024, 1, 1),
  },
  priv: { pay: { base_salary: 20000 }, bank: { name: "ธ.กสิกรไทย", account: "131-8-79619-6" }, ...(priv || {}) },
  config: CFG, period: { ...bounds, periods: 12 }, input: input || {},
});

const EMP = { name: "สุดารัตน์ ผาสุขพนักงาน", position: "พนักงานขาย", department: "ขาย", branch: "Main Store" };

async function render(item) {
  const buf = await buildPayslipPdf({ employee: EMP, item, run: RUN, company: {} });
  const doc = await PDFDocument.load(buf);
  return { buf, doc };
}

// ── 1. กล่องหน้าและเนื้อหา ─────────────────────────────────────────────────
{
  const item = mkItem({
    extra_earnings: [{ label: "ค่าคอมมิชชั่น", amount: 30000, sso_wage: true, occasional: true }],
    extra_deductions: [{ label: "หักขาด/ลา/มาสาย", amount: 500 }],
  });
  const { buf, doc } = await render(item);

  eq("สลิปเป็นหน้าเดียว", doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  check("ขนาดกระดาษ A4", Math.round(width) === 595 && Math.round(height) === 842);

  // หน้าเปล่าของ pdf-lib อยู่ราวหนึ่งพันไบต์ ส่วนหน้าที่มีฟอนต์ไทยฝังอยู่จะโตกว่า
  // มาก — ตัวเลขนี้จึงแยก "หน้าที่มีเนื้อหา" ออกจาก "หน้าที่ว่าง" ได้จริง
  check(`มีเนื้อหาจริง ไม่ใช่หน้าเปล่า (${buf.length} bytes)`, buf.length > 8000);

  // ฟอนต์ไทยต้องถูกฝัง ไม่งั้นตัวอักษรจะเป็นกล่องบนเครื่องที่ไม่มีฟอนต์
  // ห้ามค้นจากสตริงดิบของไฟล์ — pdf-lib บีบ object stream (FlateDecode) ชื่อ
  // ฟอนต์จึงไม่โผล่ใน latin1 เลยสักตัว ต้องเดิน indirect object ผ่าน API แทน
  const fontNames = [];
  let hasFontFile = false;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const s = String(obj);
    const m = s.match(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/);
    if (m) fontNames.push(m[1]);
    if (/\/FontFile2?\b/.test(s)) hasFontFile = true;
  }
  check(
    `ฝังฟอนต์ Sarabun ไว้ในไฟล์ (${fontNames.join(", ") || "ไม่พบฟอนต์"})`,
    fontNames.some((n) => /Sarabun/.test(n)),
  );
  // BaseFont อย่างเดียวพิสูจน์แค่ว่า "อ้างถึง" ฟอนต์ ตัวที่พิสูจน์ว่าไฟล์ฟอนต์
  // เดินทางไปกับเอกสารจริงคือสตรีม FontFile2
  check("ฟอนต์ถูกฝังจริง ไม่ใช่แค่อ้างชื่อ", hasFontFile);
  // subset หรือไม่ ดูจากชื่อ BaseFont ไม่ได้ (pdf-lib ตั้งชื่อเหมือนกันทั้งสองทาง)
  // ตัวที่ต่างคือขนาดไฟล์ — วัดจริงบนสลิปใบเดียวกัน: subset 12.8 kB /
  // ไม่ subset 98 kB เพราะยัดฟอนต์ไทยทั้งไฟล์ลงไป เพดานนี้จึงจับได้จริง
  // และห่างจากสลิปที่ยาวที่สุดในชุดนี้ (15 kB) พอที่จะไม่แดงเพราะเนื้อหาเยอะ
  check(`ฟอนต์ถูก subset (${buf.length} bytes)`, buf.length < 40000);
}

// ── 2. ตัวเลขบนสลิปต้องมาจากบรรทัดของรอบ ไม่ใช่คำนวณใหม่ ──────────────────
// สลิปที่คำนวณเองคือสูตรสำเนาที่สอง วันหนึ่งจะไม่ตรงกับยอดที่โอนจริง
{
  const src = readFileSync(join(fnDir, "voucher-pdf.js"), "utf8");
  const fn = src.slice(src.indexOf("async function buildPayslipPdf"), src.indexOf("module.exports"));
  check("สลิปไม่ import เครื่องคิดเงิน", !/hr-payroll/.test(fn));
  check("สลิปไม่คิดภาษีเอง", !/progressiveTax|computeWithholding|computeSso/.test(fn));
  // ต้องปักที่ "กล่องยอดสุทธิ" ไม่ใช่แค่หาคำว่า it.net ทั้งฟังก์ชัน — เปลี่ยน
  // กล่องให้คิดเอง (gross - deductTotal) แล้วคำว่า it.net ยังเหลืออยู่ที่บรรทัด
  // ตัวอักษรอยู่ดี เทสจึงเขียวทั้งที่เลขบนกระดาษมาจากสูตรสำเนา (injection ข้อ 9)
  check("กล่องยอดสุทธิพิมพ์ค่าจากบรรทัด ไม่ได้คิดเอง", /thb\(it\.net\)\} บาท/.test(fn));
  check("สลิปอ่านที่มาของภาษีจากบรรทัด", /wht_basis/.test(fn));
}

// ── 3. สิ่งที่ต้องอยู่บนสลิปเสมอ ───────────────────────────────────────────
{
  const src = readFileSync(join(fnDir, "voucher-pdf.js"), "utf8");
  const fn = src.slice(src.indexOf("async function buildPayslipPdf"), src.indexOf("module.exports"));

  // ภาษีหัก ณ ที่จ่ายเป็นเงินของลูกจ้างที่บริษัทถือไว้นำส่งแทน เจ้าตัวมีสิทธิ์
  // รู้ว่ามันมาจากไหน สลิปที่บอกแค่ยอดคือตัวเลขที่ตรวจไม่ได้
  check("กางที่มาของภาษีให้พนักงานเห็น", /ที่มาของภาษีหัก ณ ที่จ่าย/.test(fn));
  // ส่วนของนายจ้างไม่ได้หักจากลูกจ้าง ถ้าไม่เขียนจะเข้าใจว่าถูกหักสองเท่า
  check("บอกว่าเงินสมทบฝั่งนายจ้างไม่ได้หักจากลูกจ้าง", /ไม่ได้หักจากคุณ/.test(fn));
  check("มีจำนวนเงินเป็นตัวอักษร", /bahtText\(it\.net\)/.test(fn));
  check("เตือนว่าเป็นข้อมูลส่วนบุคคล", /ข้อมูลส่วนบุคคล/.test(fn));
  // เลขบัญชีบนสลิปต้อง mask — บรรทัดของรอบเก็บไว้แบบ mask อยู่แล้ว
  check("ใช้เลขบัญชีที่ mask แล้วจากบรรทัด", /bank_masked/.test(fn));
  check("ไม่ดึงเลขบัญชีเต็มจาก employees_private", !/bank\.account/.test(fn));
  // ยอดที่ถูกแก้ด้วยมือต้องปรากฏบนเอกสารที่พนักงานถือ ไม่ใช่เห็นแค่ในหน้าแอดมิน
  check("แสดงการปรับยอดภาษีด้วยมือบนสลิป", /wht_override/.test(fn));
}

// ── 4. เคสที่ต้อง render ได้โดยไม่ล้ม ──────────────────────────────────────
{
  const plain = mkItem({});
  const { doc } = await render(plain);
  eq("ไม่มีรายการปรับเพิ่ม/ปรับลด ก็ยังออกได้", doc.getPageCount(), 1);
}
{
  const noBank = buildPayrollItem({
    employee: { id: "c", name: "เงินสด", employee_code: "EMP-2569-0002", employment_type: "monthly", hired_at: bangkokMidnight(2024, 1, 1) },
    priv: { pay: { base_salary: 12000 } }, config: CFG, period: { ...bounds, periods: 12 }, input: {},
  });
  const { doc } = await render(noBank);
  eq("คนที่ไม่มีเลขบัญชี (จ่ายเงินสด) ก็ออกสลิปได้", doc.getPageCount(), 1);
}
{
  const ov = mkItem({ wht_override: { amount: 900, reason: "บัญชีคิดแยกก้อนพิเศษ", by_name: "CEO", at: 1 } });
  const { buf, doc } = await render(ov);
  eq("สลิปของบรรทัดที่พิมพ์ทับยอดภาษีออกได้", doc.getPageCount(), 1);
  // การมีคำว่า wht_override อยู่ในซอร์ส พิสูจน์แค่ว่ามีโค้ดเขียนไว้ ไม่ได้พิสูจน์
  // ว่ากิ่งนั้นถูกเดินถึง — ปิด `if` ทิ้งแล้วเทสยังเขียว (injection ข้อ 8)
  // ตัวเทียบต้องต่างกัน "แค่กิ่งนี้กิ่งเดียว" ด้วย: เทียบกับบรรทัดที่ผ่าน
  // buildPayrollItem แบบไม่มี override จะได้ยอดภาษีคนละตัว ไฟล์จึงโตขึ้นด้วย
  // เหตุผลอื่นแล้วเทสก็ยังเขียวอยู่ดี (injection ข้อ 8b) — จึงถอดฟิลด์ออกจาก
  // บรรทัดเดียวกันตรงๆ ทุกตัวเลขบนสลิปเท่ากันเป๊ะ เหลือต่างแค่สองบรรทัดนั้น
  const stripped = { ...ov };
  delete stripped.wht_override;
  const { buf: plain } = await render(stripped);
  check(
    `การปรับยอดภาษีถูกพิมพ์ลงสลิปจริง (${plain.length} → ${buf.length} bytes)`,
    buf.length > plain.length,
  );
}
{
  // รายการเยอะ ๆ ต้องไม่ทำให้เนื้อหาล้นออกนอกหน้า — ตรวจว่ายังเป็นหน้าเดียว
  const many = mkItem({
    extra_earnings: Array.from({ length: 6 }, (_, i) => ({ label: `รายการเพิ่ม ${i + 1}`, amount: 1000, sso_wage: true })),
    extra_deductions: Array.from({ length: 6 }, (_, i) => ({ label: `รายการหัก ${i + 1}`, amount: 100 })),
  });
  const { doc } = await render(many);
  eq("รายการเยอะยังอยู่หน้าเดียว", doc.getPageCount(), 1);
}

// ── 5. gate ของ callable ───────────────────────────────────────────────────
{
  const api = readFileSync(join(fnDir, "hr-payroll-api.js"), "utf8");
  const start = api.indexOf("const adminHrPayrollPayslip = onCall");
  // ตัดให้จบที่ตัว callable จริงๆ — เดิมตัดที่ "\n  return {" ซึ่งเป็นบรรทัด
  // return ของ registerHrPayroll ทั้งฟังก์ชัน body จึงลากยาวเกินตัว callable
  // ไปหลายสิบบรรทัด แล้วด่าน "ไม่เก็บลง Storage" ก็ไปตรวจโค้ดของคนอื่นแทน
  const end = api.indexOf("\n  });", start);
  check("ตัดตัว callable ได้จริง", end > start);
  const body = api.slice(start, end);
  check("adminHrPayrollPayslip มี gate requireStaffRole(..., HR_ROLES)",
    /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(body));
  check("ไม่เก็บสลิปลง Storage (ไม่มี capability URL ลอยอยู่)",
    !/getStorage|bucket\(|\.save\(/.test(body));
  // ต้องปักที่รูปของ `if` — เขียน `if (false && item.incomplete)` แล้วคำว่า
  // item.incomplete ยังอยู่ ด่านเดิมจึงเขียวทั้งที่ด่านจริงถูกปิดไปแล้ว
  check("ปฏิเสธบรรทัดที่ยังกรอกไม่ครบ", /if \(item\.incomplete\)/.test(body));
  check("สลิปของรอบร่างติดป้ายไว้ในชื่อไฟล์", /draftTag/.test(body) && /ร่าง/.test(body));
}
{
  const ui = readFileSync(join(root, "src/pages/hr/PayrollRuns.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  check("หน้ารอบจ่ายมีปุ่มสลิป", /สลิปเงินเดือน \(PDF\)/.test(ui));
  check("ปุ่มถูกปิดเมื่อบรรทัดยังกรอกไม่ครบ", /disabled=\{busy \|\| Boolean\(item\.incomplete\)\}/.test(ui));
  check("เตือนเมื่อดาวน์โหลดสลิปของรอบที่ยังเป็นร่าง", /อย่าเพิ่งส่งให้พนักงาน/.test(ui));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
