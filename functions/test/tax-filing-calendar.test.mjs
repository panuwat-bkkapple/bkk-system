// ---------------------------------------------------------------------------
// ปฏิทินกำหนดยื่นแบบ — ภ.ง.ด.1/3, ประกันสังคม, ภ.พ.30, ภ.ง.ด.1ก
//
//   node functions/test/tax-filing-calendar.test.mjs
//
// วันที่ทุกวันในไฟล์นี้เขียนเป็น "วันตามปฏิทินไทย" แล้วให้เทสแปลงเอง ไม่ได้
// เอา epoch ที่โค้ดคืนมาแปะ — เทสที่ assert ค่าที่โค้ดคำนวณคือเทสที่เห็นด้วย
// กับตัวเองเสมอ
//
// ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) — 3 ก.ย. 2569
//
//   #   ทำลายอะไร                                     ผล
//   1   ภ.ง.ด.1 ครบวันที่ 15 แทนวันที่ 7               เขียว* → อ่านกำหนดจากแถวจริง
//   2   ถอด offset เวลาไทย                             แดง 7
//   3   กำหนดเป็นต้นวันแทนสิ้นวัน                       แดง 6
//   4   ภ.ง.ด.1ก ตรึง 28 ก.พ. (ไม่รู้จักอธิกสุรทิน)     แดง
//   5   required ตัดสินจากยอด > 0 อย่างเดียว           แดง 4
//   6   filed ไม่ได้มาก่อน overdue                      แดง 2
//   7   ประกันสังคมครบวันที่ 7 แทน 15                   แดง
//   8   ใส่การเลื่อนวันหยุดเองโดยไม่มีปฏิทินราชการ       แดง
//   9   DUE_SOON 30 วัน (ทุกอย่างขึ้นเหลือง)            แดง
//  10   นับรอบที่ยังไม่จ่ายด้วย                          แดง 2
//  11   จัดกลุ่มตามชื่องวดแทนวันจ่าย                     แดง
//  12   ประกันสังคมนับแค่ฝั่งลูกจ้าง                      แดง 2
//  13   รอบที่สองในเดือนเดียวทับรอบแรก                   แดง 3
//  14   นับเอกสารที่ยกเลิกเข้าภาษีขาย                    แดง
//  15   ใบลดหนี้บวกแทนหัก                               แดง 3
//  16   กวาด wht_certificates ทั้งโหนด                   แดง
//  17   ถอด gate สิทธิ์ของ mark                          แดง
//  18   เปิดให้ HR ยื่นแบบด้วย                           แดง
//  19   ยกเลิกเครื่องหมายแบบลบเงียบ                      แดง
//  20   ภ.ง.ด.3 นับใบที่ยกเลิกด้วย                       แดง
//  21   ยอดภาษีขายติดลบถูกกลืนเป็น 0                     แดง
//  22   ถอดปุ่ม "ยื่นแล้ว"                               แดง
//  23   ยกเลิกเครื่องหมายไม่ได้                          แดง
//  24   ถอดกล่องเตือนเลยกำหนด                           แดง
//  25   ถอดหมายเหตุว่าไม่ได้ยื่นให้                       แดง
//  26   ถอดหมายเหตุว่าไม่เลื่อนวันหยุด                    แดง
//  27   เปิด route ให้ทุก role                           แดง
//  28   ถอดการลงทะเบียนใน index.js                       แดง
//
// (*) ข้อ 1 เป็นเทสว่าง ไม่ใช่บั๊กในโค้ด — เดิมเรียก `monthlyDeadline("202609", 7)`
// พร้อมป้อนเลข 7 เข้าไปเอง จึงไม่เคยแตะตาราง FORMS เลย เปลี่ยน ภ.ง.ด.1 เป็น
// วันที่ 15 แล้วยังเขียว ซึ่งแปลว่ายื่นสายไป 8 วันโดยไม่มีอะไรเตือน แก้เป็น
// อ่านกำหนดจากแถวที่ `buildPeriodRows` คืนมาแทน
//
// **ข้อ 14/15/20/21 เคยจับได้แค่ด้วยการหาข้อความในซอร์ส** ("มีคำว่า void ไหม")
// ซึ่งพิสูจน์แค่ว่ามีโค้ดเขียนไว้ ไม่ได้พิสูจน์ว่ามันกันออกจริง — ตัวรวมยอด
// จึงถูกแยกเป็นฟังก์ชันล้วน (`sumOutputVatFrom`/`sumRiderWhtFrom`) ให้เทสขับ
// ด้วยเอกสารจริงได้ ทั้งสี่ข้อกลายเป็นด่านเชิงพฤติกรรม
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

const cal = require(join(fnDir, "tax-filing-calendar.js"));
const api = require(join(fnDir, "tax-filing-api.js"));

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const eq = (name, got, want) =>
  check(`${name} (${JSON.stringify(got)} = ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

const BKK = 7 * 3600 * 1000;
/** เวลาไทยเป็น epoch */
const bkk = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h - 7);
/** อ่าน epoch กลับเป็นวันไทยแบบอ่านออก */
const readBkk = (ms) => new Date(ms + BKK).toISOString().slice(0, 16).replace("T", " ");

// ── 1. งวดตามเวลาไทย ───────────────────────────────────────────────────────
{
  eq("กลางเดือน", cal.bangkokPeriod(bkk(2026, 9, 15)), "202609");
  // 1 ต.ค. 00:30 เวลาไทย = 30 ก.ย. 17:30 UTC — อ่านเป็น UTC จะได้งวดเดือนกันยายน
  eq("ต้นเดือนตี 0:30 เวลาไทย = เดือนใหม่", cal.bangkokPeriod(bkk(2026, 10, 1, 0.5)), "202610");
  eq("สิ้นเดือน 23:30 เวลาไทย = เดือนเดิม", cal.bangkokPeriod(bkk(2026, 9, 30, 23.5)), "202609");
}

// ── 2. กำหนดยื่นรายเดือน ───────────────────────────────────────────────────
{
  // งวดกันยายน 2569 → ภ.ง.ด.1/ภ.ง.ด.3 ครบกำหนด 7 ต.ค. · ประกันสังคม/ภ.พ.30 15 ต.ค.
  eq("ภ.ง.ด.1 งวด ก.ย. ครบ 7 ต.ค. สิ้นวัน",
    readBkk(cal.monthlyDeadline("202609", 7)), "2026-10-07 23:59");
  eq("ประกันสังคม งวด ก.ย. ครบ 15 ต.ค.",
    readBkk(cal.monthlyDeadline("202609", 15)), "2026-10-15 23:59");
  // ข้ามปี: งวดธันวาคม → มกราคมปีถัดไป
  eq("งวด ธ.ค. ข้ามไปปีถัดไป",
    readBkk(cal.monthlyDeadline("202612", 7)), "2027-01-07 23:59");
  eq("เดือนถัดจาก ธ.ค.", cal.nextMonthOf("202612"), { y: 2027, m: 1 });
}

// ── 3. กำหนดยื่น ภ.ง.ด.1ก — วันสุดท้ายของเดือนกุมภาพันธ์ปีถัดไป ────────────
{
  // 2570 (2027) ไม่ใช่ปีอธิกสุรทิน → 28 ก.พ.
  eq("ปีภาษี 2026 ครบ 28 ก.พ. 2027", readBkk(cal.annualDeadline(2026)), "2027-02-28 23:59");
  // 2571 (2028) เป็นปีอธิกสุรทิน → 29 ก.พ. ไม่ใช่ 28
  eq("ปีภาษี 2027 ครบ 29 ก.พ. 2028 (อธิกสุรทิน)", readBkk(cal.annualDeadline(2027)), "2028-02-29 23:59");
}

// ── 4. ต้องยื่นไหมเมื่อยอดเป็นศูนย์ — สามกฎ ไม่ใช่ "ยอด > 0" ───────────────
{
  // ภ.พ.30 ยื่นทุกเดือนตราบใดที่ยังจดทะเบียน แม้ไม่มีภาษีขาย
  eq("ภ.พ.30 ยอด 0 ก็ยังต้องยื่น", cal.isRequired("pp30", { amount: 0, activity: false }), true);
  // ภ.ง.ด.1 / ประกันสังคม ยื่นเมื่อเดือนนั้นมีการจ่ายเงินเดือน แม้ภาษีเป็น 0
  eq("ภ.ง.ด.1 ภาษี 0 แต่มีการจ่าย = ต้องยื่น", cal.isRequired("pnd1", { amount: 0, activity: true }), true);
  eq("ภ.ง.ด.1 ไม่มีการจ่ายเลย = ไม่ต้องยื่น", cal.isRequired("pnd1", { amount: 0, activity: false }), false);
  eq("ประกันสังคม มีลูกจ้าง = ต้องยื่น", cal.isRequired("sso", { amount: 0, activity: true }), true);
  // ภ.ง.ด.3 ไม่ได้หักใคร = ไม่มีอะไรต้องนำส่ง
  eq("ภ.ง.ด.3 ไม่ได้หัก = ไม่ต้องยื่น", cal.isRequired("pnd3", { amount: 0, activity: false }), false);
  eq("ภ.ง.ด.3 หักไว้ = ต้องยื่น", cal.isRequired("pnd3", { amount: 300, activity: false }), true);
}

// ── 5. สถานะ ───────────────────────────────────────────────────────────────
{
  const dl = bkk(2026, 10, 7, 23.99);
  const day = 24 * 3600 * 1000;
  eq("ยื่นแล้วมาก่อนทุกอย่าง แม้เลยกำหนด",
    cal.statusOf({ required: true, filed: true, deadline: dl, now: dl + 30 * day }), "filed");
  eq("เลยกำหนด", cal.statusOf({ required: true, filed: false, deadline: dl, now: dl + 1 }), "overdue");
  eq("เหลือ 3 วัน = ใกล้ครบกำหนด",
    cal.statusOf({ required: true, filed: false, deadline: dl, now: dl - 3 * day }), "due_soon");
  eq("เหลือ 20 วัน = ยังไม่ถึงกำหนด",
    cal.statusOf({ required: true, filed: false, deadline: dl, now: dl - 20 * day }), "upcoming");
  eq("ไม่ต้องยื่นก็ไม่ขึ้นแดง",
    cal.statusOf({ required: false, filed: false, deadline: dl, now: dl + 30 * day }), "not_required");
}

// ── 6. รายการของงวดหนึ่ง ───────────────────────────────────────────────────
{
  const now = bkk(2026, 10, 20); // เลยทั้ง 7 และ 15 ต.ค. แล้ว
  const rows = cal.buildPeriodRows({
    period: "202609",
    facts: {
      pnd1: { amount: 2400, activity: true },
      sso: { amount: 3500, activity: true },
      pnd3: { amount: 0, activity: false },
      pp30: { amount: 0, activity: true },
    },
    filings: { sso_202609: { filed_at: bkk(2026, 10, 14), filed_by: "แอดมิน", reference: "SSO-1" } },
    now,
  });
  const by = Object.fromEntries(rows.map((r) => [r.form, r]));
  eq("ภ.ง.ด.1 ยังไม่ยื่นและเลยกำหนดแล้ว", by.pnd1.status, "overdue");
  eq("ประกันสังคมยื่นแล้ว", by.sso.status, "filed");
  eq("ประกันสังคมเก็บว่าใครยื่น", [by.sso.filed.by, by.sso.filed.reference], ["แอดมิน", "SSO-1"]);
  eq("ภ.ง.ด.3 ไม่ต้องยื่น", by.pnd3.status, "not_required");
  eq("ภ.พ.30 ยอด 0 ก็ยังค้าง", by.pp30.status, "overdue");
  eq("คีย์เป็น form_งวด", by.pnd1.key, "pnd1_202609");
  eq("จำนวนแบบต่องวด", rows.length, 4);

  // **ต้องอ่านกำหนดจากแถวจริง ไม่ใช่เรียก monthlyDeadline พร้อมเลขวันที่เอง**
  // — เทสที่ป้อนเลข 7 เข้าไปเองไม่เคยแตะตาราง FORMS เลย เปลี่ยน ภ.ง.ด.1 เป็น
  // วันที่ 15 แล้วยังเขียว (injection ข้อ 1) ซึ่งคือการยื่นสายไป 8 วัน
  eq("ภ.ง.ด.1 ครบวันที่ 7 ของเดือนถัดไป", readBkk(by.pnd1.deadline), "2026-10-07 23:59");
  eq("ภ.ง.ด.3 ครบวันที่ 7 ของเดือนถัดไป", readBkk(by.pnd3.deadline), "2026-10-07 23:59");
  eq("ประกันสังคม ครบวันที่ 15 ของเดือนถัดไป", readBkk(by.sso.deadline), "2026-10-15 23:59");
  eq("ภ.พ.30 ครบวันที่ 15 ของเดือนถัดไป", readBkk(by.pp30.deadline), "2026-10-15 23:59");
}

// ── 7. จัดกลุ่ม ภ.ง.ด.1 ตามเดือนที่จ่ายจริง ไม่ใช่ชื่องวด ──────────────────
// นี่คือกติกาเดียวกับที่ใช้ตัดปีภาษี — หน้าที่นำส่งเกิดเมื่อจ่ายเงิน
{
  const out = api.payrollByPayMonth({
    // งวด ธ.ค. แต่จ่ายต้นเดือน ม.ค. → ต้องนำส่งในรอบมกราคม
    "2569-12": { status: "paid", pay_date: bkk(2027, 1, 5), totals: { wht: 1000, sso_employee: 875, sso_employer: 875, headcount: 2 } },
    "2569-11": { status: "paid", pay_date: bkk(2026, 11, 25), totals: { wht: 500, sso_employee: 875, sso_employer: 875, headcount: 2 } },
    // รอบที่ยังไม่จ่าย ไม่มีอะไรต้องนำส่ง
    "2569-10": { status: "approved", pay_date: bkk(2026, 10, 25), totals: { wht: 9999, sso_employee: 999, sso_employer: 999, headcount: 2 } },
  });
  eq("งวดที่ถูกนับ", Object.keys(out).sort(), ["202611", "202701"]);
  eq("งวด ธ.ค. ไปโผล่ที่รอบ ม.ค. ตามวันจ่าย", out["202701"].wht, 1000);
  // คิดมือ: 875 + 875 = 1,750
  eq("ประกันสังคมรวมสองฝั่ง", out["202701"].sso, 1750);
  check("รอบที่ยังไม่จ่ายไม่เข้ามา (9999 ต้องไม่โผล่)",
    !Object.values(out).some((b) => b.wht === 9999));
}

// ── 8. สองรอบจ่ายในเดือนเดียวกันต้องรวมกัน ─────────────────────────────────
// เกิดได้จริงเมื่อมีรอบปรับปรุง — ยื่นแยกสองใบไม่ได้ ต้องรวมเป็นยอดเดียว
{
  const out = api.payrollByPayMonth({
    "2569-09": { status: "paid", pay_date: bkk(2026, 9, 25), totals: { wht: 1000, sso_employee: 100, sso_employer: 100, headcount: 2 } },
    "2569-09b": { status: "paid", pay_date: bkk(2026, 9, 28), totals: { wht: 250, sso_employee: 50, sso_employer: 50, headcount: 1 } },
  });
  eq("สองรอบในเดือนเดียวรวมภาษี", out["202609"].wht, 1250);   // 1,000 + 250
  eq("สองรอบในเดือนเดียวรวมประกันสังคม", out["202609"].sso, 300); // 100+100+50+50
  eq("อ้างอิงบอกว่ามาจากรอบไหนบ้าง", out["202609"].runs.sort(), ["2569-09", "2569-09b"]);
}

// ── 8b. ยอดที่ยื่นต้องกันเอกสารที่ยกเลิกออก และหักใบลดหนี้ ────────────────
// เดิมข้อนี้ตรวจแค่ว่าซอร์สมีคำว่า void อยู่ ซึ่งพิสูจน์แค่ว่ามีโค้ดเขียนไว้
// ไม่ได้พิสูจน์ว่ามันกันออกจริง — ตัวรวมยอดจึงถูกแยกเป็นฟังก์ชันล้วนให้ขับได้
{
  // ภาษีขาย: 700 + 350 − ใบลดหนี้ 210 = 840 ส่วนใบที่ยกเลิกไม่นับ
  const vat = api.sumOutputVatFrom([
    { type: "tax_invoice", vat: 700 },
    { type: "tax_invoice", vat: 350 },
    { type: "credit_note", vat: 210 },
    { type: "tax_invoice", vat: 9999, status: "void" },
  ]);
  eq("ภาษีขายหักใบลดหนี้และข้ามใบที่ยกเลิก", vat, 840);

  // ใบลดหนี้มากกว่าภาษีขายของงวดนั้นได้ — ยอดติดลบต้องไม่ถูกกลืนเป็น 0
  eq("ใบลดหนี้มากกว่าภาษีขาย = ยอดติดลบ",
    api.sumOutputVatFrom([{ type: "tax_invoice", vat: 100 }, { type: "credit_note", vat: 300 }]), -200);

  // ภ.ง.ด.3: 300 + 150 = 450 ใบที่ยกเลิกไม่นับ
  eq("ภ.ง.ด.3 ข้ามใบที่ยกเลิก",
    api.sumRiderWhtFrom([{ wht: 300 }, { wht: 150 }, { wht: 9999, status: "void" }]), 450);
}

// ── 9. งวดย้อนหลัง ─────────────────────────────────────────────────────────
{
  eq("ย้อนหลัง 3 เดือนจาก ม.ค. ข้ามปีถูก",
    api.recentPeriods(bkk(2027, 1, 10), 3), ["202701", "202612", "202611"]);
}

// ── 10. แถวรายปี ───────────────────────────────────────────────────────────
{
  const row = cal.buildAnnualRow({
    gregorianTaxYear: 2026, amount: 24000, activity: true, filings: {}, now: bkk(2027, 1, 10),
  });
  eq("คีย์ของแถวรายปี", row.key, "pnd1k_2026");
  eq("แถวรายปีขึ้นตั้งแต่ต้นปี ยังไม่ถึงกำหนด", row.status, "upcoming");
  eq("กำหนดคือสิ้นเดือน ก.พ.", readBkk(row.deadline), "2027-02-28 23:59");
  const late = cal.buildAnnualRow({
    gregorianTaxYear: 2026, amount: 24000, activity: true, filings: {}, now: bkk(2027, 3, 1),
  });
  eq("เลย 1 มี.ค. = เลยกำหนด", late.status, "overdue");
}

// ── 11. กติกาของ callable ──────────────────────────────────────────────────
{
  const raw = readFileSync(join(fnDir, "tax-filing-api.js"), "utf8");
  // ถอดคอมเมนต์ก่อนตรวจ "ห้ามมีสิ่งนี้" — ไฟล์นี้อธิบายไว้ในคอมเมนต์ว่าทำไม
  // ถึงไม่ใช้ HR_ROLES ด่านที่หาคำทั้งไฟล์จึงแดงเพราะคำอธิบายของตัวเอง
  const src = raw.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  for (const name of ["adminTaxFilingCalendar", "adminTaxFilingMark"]) {
    const start = src.indexOf(`const ${name} = onCall`);
    const end = src.indexOf("\n  });", start);
    check(`ตัด ${name} ได้จริง`, start > 0 && end > start);
    const body = src.slice(start, end);
    check(`${name} มี gate requireStaffRole(..., FILING_ROLES)`,
      /requireStaffRole\(db, request\.auth, FILING_ROLES\)/.test(body));
  }

  // หน้านี้อ่านตัวเลขที่ระบบเขียนไว้แล้ว ห้ามคิดภาษีเอง — สูตรสำเนาที่สอง
  // จะทำให้ยอดที่ยื่นไม่ตรงกับยอดบนสลิปที่ลูกจ้างถืออยู่
  check("ไม่คิดภาษีเอง", !/progressiveTax|computeWithholding|computeSso/.test(src));
  check("ภ.ง.ด.1 อ่านจาก totals ของรอบ", /\(run\.totals \|\| \{\}\)|run\.totals/.test(src));
  check("นับเฉพาะรอบที่จ่ายแล้ว", /run\.status !== "paid"/.test(src));

  // query ตาม index ไม่กวาดทั้งโหนด (กฎค่า RTDB)
  check("ภ.ง.ด.3 query ตาม period", /ref\("wht_certificates"\)\.orderByChild\("period"\)/.test(src));
  check("ภ.พ.30 query ตาม period", /ref\("accounting_documents"\)\.orderByChild\("period"\)/.test(src));

  // เอกสารที่ยกเลิก/ใบลดหนี้มีด่านที่ขับตัวรวมยอดจริงอยู่ที่หัวข้อ 8b แล้ว
  // ตรงนี้เหลือแค่ยืนยันว่าตัวรวมยอดไม่ได้ถูกก๊อปไปเขียนใหม่ที่อื่นในไฟล์
  check("มีตัวรวมยอดชุดเดียว", (src.match(/total \+= Number\(v\.vat\)/g) || []).length === 1);

  // การยกเลิกเครื่องหมายต้องทิ้งร่องรอย ไม่ใช่ลบเงียบ
  check("ยกเลิกแล้วเก็บ log", /tax_filings_log/.test(src));

  // สิทธิ์: หน้ายื่นแบบเป็นงานการเงิน ไม่ใช่ HR — ตัวเลขรวมภาษีขายและไรเดอร์
  check("ใช้สิทธิ์ CEO/FINANCE ไม่ใช่ HR_ROLES",
    /FILING_ROLES = \["CEO", "FINANCE"\]/.test(src) && !/HR_ROLES/.test(src));
}

// ── 12. ไม่เลื่อนวันให้เอง — เขียนไว้ให้คนอ่านด้วย ─────────────────────────
// ถ้าวันหนึ่งมีคนใส่การเลื่อนวันหยุดเข้ามาโดยไม่มีปฏิทินราชการจริง เทสนี้จะแดง
{
  const src = readFileSync(join(fnDir, "tax-filing-calendar.js"), "utf8");
  check("ไม่มีการเลื่อนวันหยุด/สุดสัปดาห์", !/getDay\(\)|isWeekend|holiday/i.test(src));
  const ui = readFileSync(join(root, "src/pages/admin/TaxFilings.tsx"), "utf8");
  check("หน้าเว็บบอกว่าไม่เลื่อนวันให้", /ไม่เลื่อนวันให้เมื่อตรงกับวันหยุดราชการ/.test(ui));
}

// ── 13. index.js + route ───────────────────────────────────────────────────
{
  const idx = readFileSync(join(fnDir, "index.js"), "utf8");
  check("index.js ลงทะเบียน registerTaxFiling", /require\("\.\/tax-filing-api"\)\.registerTaxFiling\(\)/.test(idx));

  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  const line = app.split("\n").find((l) => l.includes('path="/tax-filings"')) || "";
  check(`route ถูก gate ด้วย CEO/FINANCE (${line.trim().slice(0, 50)}...)`,
    /'CEO'/.test(line) && /'FINANCE'/.test(line) && /Navigate to="\//.test(line));

  const ui = readFileSync(join(root, "src/pages/admin/TaxFilings.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  // ปุ่มรับทราบคือหัวใจของหน้า — ตัวเตือนที่กดรับทราบไม่ได้จะถูกเมินทั้งหน้า
  check("มีปุ่มยื่นแล้ว", /<CheckCircle2 size=\{13\} \/> ยื่นแล้ว/.test(ui));
  check("ยกเลิกเครื่องหมายได้", /<Undo2 size=\{13\} \/> ยกเลิก/.test(ui));
  check("เตือนรายการที่เลยกำหนด", /เลยกำหนดยื่น \{overdue\.length\} รายการ/.test(ui));
  check("บอกว่าหน้านี้ไม่ได้ยื่นให้", /ไม่ได้ยื่นให้/.test(ui));
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
