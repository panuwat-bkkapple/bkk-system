// ---------------------------------------------------------------------------
// ใบสำคัญเงินสดย่อยของใบเบิกไรเดอร์ — ด่านของเอกสารและทะเบียน
//
//   node functions/test/rider-expense-voucher.test.mjs
//
// เทสนี้ **สร้าง PDF จริงแล้วตรวจผลลัพธ์** (บทเรียนผลพิมพ์ใน CLAUDE.md:
// หน้าเปล่าก็ผ่านเงื่อนไข "1 หน้า" ได้) และตรวจแถวทะเบียนว่าหน้ารายงานภาษี
// จะ**ไม่**หยิบมันไปนับเป็นภาษีขาย
//
// ผล injection (วัดจริงทุกข้อ 4 ก.ย. 2569):
//
//   1. type เป็น 'tax_invoice' (ใบสำคัญโดนนับเป็นภาษีขาย)       → แดง 2
//   2. amount คิดใหม่จาก evidence.length แทนอ่านจากแถว          → แดง 2
//   3. approvalsFromHistory เอาครั้งแรกแทนครั้งล่าสุด           → แดง 1
//   4. ถอด if กรอง action ในลูปของ approvalsFromHistory          → **เขียว** —
//      เพราะการกรองจริงอยู่ที่ projection ท้ายฟังก์ชัน if ตัวนั้นเป็นด่านที่
//      ไปไม่ถึง → **ลบทิ้ง** (กฎ "ด่านที่ไปไม่ถึง ให้ลบ ไม่ใช่ ship")
//   5. เปลี่ยนกระดาษเป็น Letter                                  → แดง 1
//   6. ใช้ฟอนต์มาตรฐานแทน Sarabun                                → เทสรันไม่จบ
//      (pdf-lib โยน WinAnsi cannot encode — ดังกว่าแดง)
//   7. เขียนบนเอกสารว่า "โอนเงินเข้าบัญชีแล้ว"                  → **เขียว** —
//      ไม่มีเทสอ่านข้อความใน PDF (pdf-lib บีบ stream, ต้องมี text extractor)
//      บันทึกไว้ตรงๆ: ข้อนี้คุมด้วยการอ่านโค้ด ไม่ใช่เทส
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildVoucherRecord, approvalsFromHistory, docIdFor, DOC_TYPE } = require(join(fnDir, "rider-expense-voucher.js"));
const { buildPettyCashVoucherPdf } = require(join(fnDir, "voucher-pdf.js"));
const { PDFDocument } = require("pdf-lib");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

const HISTORY = {
  h1: { at: 100, action: "ops_approve", from: "submitted", to: "approved", by_name: "หัวหน้า ก" },
  h2: { at: 200, action: "send_back", from: "approved", to: "needs_info", by_name: "บัญชี ข", reason: "ขอใบเสร็จ" },
  h3: { at: 300, action: "resubmit", from: "needs_info", to: "submitted", by_name: "ไรเดอร์ ค" },
  h4: { at: 400, action: "ops_approve", from: "submitted", to: "approved", by_name: "หัวหน้า ง" },
  h5: { at: 500, action: "finance_approve", from: "approved", to: "finance_approved", by_name: "บัญชี ข" },
  h6: { at: 600, action: "pay", from: "finance_approved", to: "paid", by_name: "บัญชี ข" },
};

const ROW = {
  rider_id: "riderA",
  job_id: "OID-ABCDEFGH-384",
  category: "toll",
  amount_thb: 65,
  note: "ทางด่วนขาไปรับเครื่อง",
  occurred_at: 1_756_000_000_000,
  reviewed_at: 1_756_100_000_000,
  paid_tx_id: "tx1",
  expense_doc_id: "ex1",
  evidence: [{ url: "https://x/a.jpg" }, { url: "https://x/b.jpg" }, { bogus: true }],
  history: HISTORY,
  status: "paid",
};

const record = buildVoucherRecord({
  id: "exp1", row: ROW, number: "PC-202609-0007", ym: "202609", riderName: "สมชาย", now: 1_756_200_000_000,
});

// --- ทะเบียน: ต้องไม่ถูกหน้ารายงานภาษีหยิบไปนับ ------------------------------
{
  check("type คือ petty_cash_voucher ไม่ใช่ tax_invoice", record.type === DOC_TYPE && record.type !== "tax_invoice");
  check("ไม่ใช่ credit_note ด้วย (ตัวหักภาษีขาย)", record.type !== "credit_note");
  check("vat เป็น 0 ชัดๆ ไม่ปล่อยว่าง", record.vat === 0);
  check("period ตามงวดที่จ่าย", record.period === "202609");
  check("docId ปลอดภัยสำหรับ RTDB key", docIdFor(record.number) === "PC_PC-202609-0007");
}

// --- ตัวเลขมาจากแถวที่จ่ายแล้ว ไม่คำนวณใหม่ --------------------------------
{
  check("ยอดเท่ากับที่จ่ายจริง", record.amount === 65 && record.total === 65);
  check("ชี้กลับไปแถวกระเป๋าและแถวบัญชี", record.tx_id === "tx1" && record.expense_doc_id === "ex1");
  check("นับเฉพาะหลักฐานที่มี url (แถวเสียไม่นับ)", record.evidence_count === 2);
  check("paid_at = เวลาที่กดจ่าย ไม่ใช่เวลาที่ออกเอกสาร", record.paid_at === ROW.reviewed_at);
}

// --- ลำดับผู้อนุมัติจากประวัติ ----------------------------------------------
{
  const a = approvalsFromHistory(HISTORY);
  check("มีสามขั้นเรียงตามเส้นทาง", a.map((x) => x.action).join(">") === "ops_approve>finance_approve>pay");
  check("ใบที่วนผ่านการตีกลับ เอาการอนุมัติครั้งล่าสุด (คนที่พาใบมาถึงการจ่าย)", a[0].by === "หัวหน้า ง");
  check("ตีกลับ/ส่งซ้ำ ไม่โผล่เป็นการอนุมัติ", !a.some((x) => x.action === "send_back" || x.action === "resubmit"));
  check("ไม่มีประวัติ = ว่าง ไม่พัง", approvalsFromHistory(null).length === 0);
}

// --- PDF จริง ---------------------------------------------------------------
{
  const buf = await buildPettyCashVoucherPdf({
    voucher: record,
    expense: { id: "exp1", occurred_at: ROW.occurred_at, note: ROW.note, job_ref: "#GH-384" },
    rider: { id: "riderA", name: "สมชาย ใจดี" },
    company: {},
  });
  const doc = await PDFDocument.load(buf);
  check("หน้าเดียว", doc.getPageCount() === 1);
  const { width, height } = doc.getPage(0).getSize();
  check("ขนาดกระดาษ A4", Math.round(width) === 595 && Math.round(height) === 842);
  check(`มีเนื้อหาจริง ไม่ใช่หน้าเปล่า (${buf.length} bytes)`, buf.length > 8000);
  let hasFontFile = false;
  const fontNames = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const s = String(obj);
    const m = s.match(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/);
    if (m) fontNames.push(m[1]);
    if (/\/FontFile2?\b/.test(s)) hasFontFile = true;
  }
  check(`ฝังฟอนต์ Sarabun (${fontNames.join(", ")})`, fontNames.some((n) => /Sarabun/.test(n)) && hasFontFile);
  check(`ฟอนต์ถูก subset (${buf.length} bytes)`, buf.length < 40000);

  // ใบที่ไม่ผูกงาน ไม่มีโน้ต ไม่มีประวัติ — ต้องยังสร้างได้
  const bare = await buildPettyCashVoucherPdf({
    voucher: { ...record, approvals: [], evidence_count: 0 },
    expense: { id: "exp2", occurred_at: 0, note: "", job_ref: "" },
    rider: { id: "riderB", name: "" },
    company: {},
  });
  check("ใบที่ข้อมูลน้อยที่สุดยังสร้างได้", bare.length > 8000);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
