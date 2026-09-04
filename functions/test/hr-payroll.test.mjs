// ---------------------------------------------------------------------------
// เครื่องคิดเงินเดือน (P5) — ตัวเลขที่ผิดที่นี่คือเงินที่คนได้ไม่ครบ
//
//   node functions/test/hr-payroll.test.mjs
//
// ทุกตัวเลขที่ assert คำนวณด้วยมือจากกติกาที่เขียนไว้ในหัวไฟล์ hr-payroll.js
// ไม่ใช่คัดลอกจากผลที่โค้ดคืนมา (เทสที่เอาผลลัพธ์ของโค้ดมาเป็นความคาดหวังคือ
// เทสที่เห็นด้วยกับตัวเองเสมอ ไม่ว่าโค้ดจะถูกหรือผิด)
//
// การคิดที่ยกมาเป็นตัวอย่างหลัก — เงินเดือน 60,000 โสด ไม่มีลดหย่อนอื่น:
//   ทั้งปี 720,000 · ค่าใช้จ่าย 50% = 360,000 แต่ติดเพดาน 100,000
//   ลดหย่อน = ส่วนตัว 60,000 + ประกันสังคมทั้งปี 875x12 = 10,500 → 70,500
//   เงินได้สุทธิ = 720,000 - 100,000 - 70,500 = 549,500
//   ภาษี = 150,000 ยกเว้น + 150,000x5% (7,500) + 200,000x10% (20,000)
//        + 49,500x15% (7,425) = 34,925 → ต่อเดือน 2,910.416... = 2,910.42
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  resolvePayrollConfig, periodBounds, payDateOf, periodsInYear, bangkokMidnight,
  proratedBase, computeSso, progressiveTax, computeWithholding,
  buildPayrollItem, summarizeRun, DEFAULT_SSO, DEFAULT_TAX, DEFAULT_PAYROLL,
  DEFAULT_ADJUSTMENT_PRESETS, round2,
} from "../hr-payroll.js";
import { eligibleForPeriod } from "../hr-payroll-api.js";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { failures++; console.log(`FAIL  ${label}`); }
};
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) console.log(`      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  check(label, ok);
};

const CFG = resolvePayrollConfig({});
const utc = (ms) => new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 16);

// ── 1. ช่วงงวด: ตัด 20 จ่าย 25 ─────────────────────────────────────────────
{
  const p = periodBounds(2026, 9, 20);
  eq("งวด ก.ย. เริ่ม 21 ส.ค. 00:00 เวลาไทย", utc(p.from), "2026-08-21T00:00");
  eq("งวด ก.ย. จบ 20 ก.ย. 23:59 เวลาไทย", utc(p.to), "2026-09-20T23:59");
  eq("จ่าย 25 ก.ย.", utc(payDateOf(2026, 9, 25)), "2026-09-25T00:00");
}
{
  // ข้ามปี — งวดมกราคมต้องย้อนไปเดือน 12 ของปีก่อน
  const p = periodBounds(2026, 1, 20);
  eq("งวด ม.ค. ย้อนไป 21 ธ.ค. ปีก่อน", utc(p.from), "2025-12-21T00:00");
}
{
  // ตัดรอบวันที่ 31 ต้องถูกบีบให้ไม่เกิน 28 ไม่งั้นเดือน ก.พ. จะได้วันที่ไม่มีจริง
  const p = periodBounds(2026, 3, 31);
  eq("วันตัดรอบเกิน 28 ถูกบีบลง", utc(p.to), "2026-03-28T23:59");
}

// ── 2. จำนวนงวดที่ใช้ประมาณการภาษี ─────────────────────────────────────────
eq("เข้างานปีก่อน = 12 งวด", periodsInYear(2026, 9, bangkokMidnight(2024, 1, 1)), 12);
eq("เข้างาน ก.ย. ปีนี้ = 4 งวด (ก.ย.-ธ.ค.)", periodsInYear(2026, 9, bangkokMidnight(2026, 9, 1)), 4);
eq("เข้างาน ม.ค. ปีนี้ = 12 งวด", periodsInYear(2026, 9, bangkokMidnight(2026, 1, 15)), 12);
eq("ไม่รู้วันเข้างาน = 12 งวด", periodsInYear(2026, 9, null), 12);

// ── 3. ภาษีขั้นบันได — คิดมือทีละขั้น ──────────────────────────────────────
eq("เงินได้สุทธิ 150,000 = ยกเว้นทั้งหมด", progressiveTax(150000, CFG.income_tax.brackets), 0);
eq("200,000 → 50,000x5% = 2,500", progressiveTax(200000, CFG.income_tax.brackets), 2500);
// 150k@0 + 150k@5%=7,500 + 200k@10%=20,000 + 51k@15%=7,650
eq("551,000 → 35,150", progressiveTax(551000, CFG.income_tax.brackets), 35150);
// เพิ่มขั้น 20% และ 25%: 7,500+20,000+37,500(250k@15%)+50,000(250k@20%)+250,000(1M@25%)
eq("2,000,000 → 365,000", progressiveTax(2000000, CFG.income_tax.brackets), 365000);
eq("ติดลบ/ศูนย์ = 0", progressiveTax(-5, CFG.income_tax.brackets), 0);

// ── 4. ประกันสังคม — เพดานและพื้น ──────────────────────────────────────────
// ตารางปี 2569 ที่เจ้าของงานยืนยัน: เพดาน 17,500 → สูงสุด 875 · พื้น 1,650 → 83
eq("10,000 = 500", computeSso(10000, CFG.social_security).employee, 500);
eq("15,000 = 750", computeSso(15000, CFG.social_security).employee, 750);
eq("17,500 (เพดานใหม่ 2569) = 875", computeSso(17500, CFG.social_security).employee, 875);
eq("20,000 ติดเพดาน = 875", computeSso(20000, CFG.social_security).employee, 875);
eq("เกินเพดานไปมากก็ยัง 875", computeSso(90000, CFG.social_security).employee, 875);
eq("ต่ำกว่าพื้น 1,650 ถูกยกขึ้นเป็นพื้น แล้วปัดเป็นบาท = 83", computeSso(1000, CFG.social_security).employee, 83);
// **ต้องทดสอบผ่าน resolvePayrollConfig ไม่ใช่ประกอบ object เอง** — การส่ง
// object ที่เขียนมือเข้าไปพิสูจน์แค่ว่า computeSso อ่านฟิลด์เป็น ไม่ได้พิสูจน์ว่า
// ค่าที่แอดมินตั้งใน settings/hr เดินทางมาถึง (รอบแรกเทสข้อนี้เขียวทั้งที่ถอด
// round_to_baht ออกจาก resolvePayrollConfig ไปแล้ว = สวิตช์บนหน้าตั้งค่าไม่ทำงาน)
eq("ปิดการปัดเป็นบาทจาก settings ได้จริง (82.5)",
  computeSso(1000, resolvePayrollConfig({ social_security: { round_to_baht: false } }).social_security).employee, 82.5);
eq("ไม่ตั้ง round_to_baht = ปัดเป็นบาทตามค่าตั้งต้น",
  computeSso(1000, resolvePayrollConfig({}).social_security).employee, 83);
eq("ตั้ง round_to_baht: true ชัดๆ ก็ยังปัด",
  computeSso(1000, resolvePayrollConfig({ social_security: { round_to_baht: true } }).social_security).employee, 83);
eq("นายจ้างสมทบเท่าลูกจ้าง", computeSso(20000, CFG.social_security).employer, 875);
eq("ค่าจ้าง 0 = ไม่สมทบ", computeSso(0, CFG.social_security).employee, 0);
check("ปิดประกันสังคมได้", computeSso(15000, { ...DEFAULT_SSO, enabled: false }).skipped === true);

// ── 5. ภาษีหัก ณ ที่จ่ายต่องวด — เคสหลักที่คิดมือไว้ในหัวไฟล์ ─────────────
{
  const r = computeWithholding({
    periodIncome: 60000, periods: 12, ssoPerPeriod: 875, allowances: {}, tax: CFG.income_tax,
  });
  eq("60,000/เดือน → ภาษีทั้งปี 34,925", r.basis.annual_tax, 34925);
  eq("60,000/เดือน → หักต่องวด 2,910.42", r.amount, 2910.42);
  eq("ค่าใช้จ่ายติดเพดาน 100,000", r.basis.expenses, 100000);
  eq("ลดหย่อนรวม 70,500", r.basis.allowances_total, 70500);
}
{
  // 25,000/เดือน = 300,000/ปี → 300,000-100,000(50%)-69,000 = 131,000 < 150,000
  const r = computeWithholding({ periodIncome: 25000, periods: 12, ssoPerPeriod: 875, allowances: {}, tax: CFG.income_tax });
  eq("25,000/เดือน ไม่ถึงเกณฑ์เสียภาษี", r.amount, 0);
  eq("ค่าใช้จ่าย 50% ของ 300,000 = 150,000 แต่ติดเพดาน 100,000", r.basis.expenses, 100000);
}
{
  // ลดหย่อนคู่สมรส 60,000 + บุตร 2 คน 60,000 + ประกันสังคม 10,500 → รวม 190,500
  // สุทธิ = 720,000-100,000-190,500 = 429,500
  // ภาษี = 7,500 + 129,500x10% = 12,950 → 20,450 → ต่องวด 1,704.17
  const r = computeWithholding({
    periodIncome: 60000, periods: 12, ssoPerPeriod: 875,
    allowances: { spouse: true, children: 2 }, tax: CFG.income_tax,
  });
  eq("มีคู่สมรส+บุตร 2 → ลดหย่อน 190,500", r.basis.allowances_total, 190500);
  eq("มีคู่สมรส+บุตร 2 → หักต่องวด 1,704.17", r.amount, 1704.17);
}
{
  // เพดานลดหย่อนประกันสังคม 9,000 ต้องกันไม่ให้เกินแม้สมทบสูงกว่า
  const r = computeWithholding({ periodIncome: 60000, periods: 12, ssoPerPeriod: 5000, allowances: {}, tax: CFG.income_tax });
  eq("ลดหย่อนประกันสังคมติดเพดาน 10,500", r.basis.sso_allowance, 10500);
}
{
  const r = computeWithholding({ periodIncome: 60000, periods: 12, ssoPerPeriod: 875, allowances: {}, tax: { ...CFG.income_tax, enabled: false } });
  eq("ปิดการหักภาษีได้", r.amount, 0);
}

// ── 6. คิดตามสัดส่วนวันที่อยู่จริง ─────────────────────────────────────────
{
  const p = periodBounds(2026, 9, 20); // 21 ส.ค. - 20 ก.ย. = 31 วัน
  const full = proratedBase({ baseSalary: 30000, from: p.from, to: p.to, divisor: 30 });
  eq("อยู่ทั้งงวด = เงินเดือนเต็ม", full.amount, 30000);
  check("อยู่ทั้งงวดติดธง full", full.full === true);

  // เข้างาน 1 ก.ย. → อยู่ 1-20 ก.ย. = 20 วัน → 30,000/30x20 = 20,000
  const mid = proratedBase({ baseSalary: 30000, from: p.from, to: p.to, hiredAt: bangkokMidnight(2026, 9, 1), divisor: 30 });
  eq("เข้างาน 1 ก.ย. = 20 วัน", mid.days, 20);
  eq("เข้างานกลางงวด ได้ 20,000", mid.amount, 20000);

  // ลาออก 31 ส.ค. → อยู่ 21-31 ส.ค. = 11 วัน → 30,000/30x11 = 11,000
  const out = proratedBase({ baseSalary: 30000, from: p.from, to: p.to, terminatedAt: bangkokMidnight(2026, 8, 31), divisor: 30 });
  eq("ลาออกกลางงวด = 11 วัน", out.days, 11);
  eq("ลาออกกลางงวด ได้ 11,000", out.amount, 11000);

  // เข้างานหลังงวดจบ = ไม่ได้เงินงวดนี้
  const later = proratedBase({ baseSalary: 30000, from: p.from, to: p.to, hiredAt: bangkokMidnight(2026, 10, 1), divisor: 30 });
  eq("เข้างานหลังงวดจบ = 0", later.amount, 0);

  // ตัวหารเป็นค่าตั้ง ไม่ใช่จำนวนวันของเดือน
  const d31 = proratedBase({ baseSalary: 30000, from: p.from, to: p.to, hiredAt: bangkokMidnight(2026, 9, 1), divisor: 31 });
  check("ตัวหารเปลี่ยนแล้วยอดเปลี่ยน (ไม่ได้ฝัง 30 ไว้ในสูตร)", d31.amount !== 20000);
}

// ── 7. หนึ่งบรรทัดของรอบ ───────────────────────────────────────────────────
const P = { ...periodBounds(2026, 9, 20), periods: 12 };
// **fixture มีเลขบัญชีเป็นค่าตั้งต้น** — ตั้งแต่ ก.ย. 2569 ช่องทางจ่ายเป็นการ
// ประกาศ (ค่าตั้งต้น = โอน) คนที่ตั้งเป็นโอนแต่ไม่มีเลขบัญชีจะติด `incomplete`
// ซึ่งตั้งใจ ดังนั้นพนักงานสมมติที่ "ปกติ" ต้องมีเลขบัญชี ไม่งั้นทุกเทสในไฟล์นี้
// จะวัดเคสผิดพลาดแทนที่จะวัดการคิดเงิน (ดู hr-compliance.js)
const ACCOUNT = { name: "SCB", account: "1234567890", account_name: "A" };
const monthly = (base, priv, emp, input) => buildPayrollItem({
  employee: { id: "e1", name: "A", employee_code: "EMP-2569-0001", employment_type: "monthly", hired_at: bangkokMidnight(2024, 1, 1), ...(emp || {}) },
  priv: { pay: { base_salary: base, allowances: [] }, bank: ACCOUNT, ...(priv || {}) },
  config: CFG, period: P, input: input || {},
});
{
  const i = monthly(60000);
  eq("บรรทัดเงินเดือน 60,000 → รายได้รวม", i.gross, 60000);
  eq("บรรทัดเงินเดือน 60,000 → ประกันสังคม 875", i.sso_employee, 875);
  eq("บรรทัดเงินเดือน 60,000 → ภาษี 2,910.42", i.wht, 2910.42);
  eq("บรรทัดเงินเดือน 60,000 → สุทธิ 56,214.58", i.net, 56214.58);
  check("ไม่มีธง incomplete", i.incomplete === null);
}
{
  // เบี้ยเลี้ยงประจำเข้าทั้งฐานภาษีและฐานประกันสังคม
  const i = monthly(14000, { pay: { base_salary: 14000, allowances: [{ label: "ค่าเดินทาง", amount: 2000, taxable: true, recurring: true }] } });
  eq("เบี้ยเลี้ยงประจำรวมในรายได้", i.gross, 16000);
  eq("เบี้ยเลี้ยงประจำเข้าฐานประกันสังคม (16,000 ยังไม่ถึงเพดาน 17,500 → 800)", i.sso_employee, 800);
}
{
  // เบี้ยเลี้ยงที่ไม่เสียภาษี ต้องไม่เข้าฐานภาษีแต่ยังอยู่ในรายได้รวม
  const i = monthly(60000, { pay: { base_salary: 60000, allowances: [{ label: "ค่ารักษาพยาบาล", amount: 5000, taxable: false, recurring: true }] } });
  eq("รายได้รวมมีเบี้ยเลี้ยงที่ไม่เสียภาษีด้วย", i.gross, 65000);
  eq("ฐานภาษีไม่รวมรายการที่ taxable=false", i.taxable_income, 60000);
}
{
  // รายการครั้งเดียว (โบนัส) ไม่เข้าฐานประกันสังคมโดยอัตโนมัติ
  const i = monthly(10000, null, null, { extra_earnings: [{ label: "โบนัส", amount: 50000 }] });
  eq("โบนัสอยู่ในรายได้รวม", i.gross, 60000);
  eq("โบนัสไม่เข้าฐานประกันสังคมโดยอัตโนมัติ", i.sso_wage, 10000);
  eq("ฐานประกันสังคม 10,000 → สมทบ 500", i.sso_employee, 500);
}
{
  const i = monthly(10000, null, null, { extra_earnings: [{ label: "ค่าล่วงเวลา", amount: 5000, sso_wage: true }] });
  eq("ติ๊กให้เข้าฐานประกันสังคมได้", i.sso_wage, 15000);
}
{
  // 30,000/เดือน → ปีละ 360,000 - 100,000 - 70,500 = 189,500
  // ภาษี = 39,500x5% = 1,975 → ต่องวด 164.58
  const i = monthly(30000, null, null, { extra_deductions: [{ label: "เบิกล่วงหน้า", amount: 3000 }] });
  eq("ภาษีของ 30,000/เดือน = 164.58", i.wht, 164.58);
  eq("รายการหักเพิ่มลดยอดสุทธิ", i.net, 30000 - 875 - 164.58 - 3000);
}
{
  const i = monthly(0);
  check("ยังไม่ตั้งเงินเดือน = incomplete", i.incomplete === "ยังไม่ได้ตั้งเงินเดือน");
}

// ── 8. รายวัน ──────────────────────────────────────────────────────────────
const daily = (rate, input) => buildPayrollItem({
  employee: { id: "d1", name: "D", employment_type: "daily" },
  priv: { pay: { daily_rate: rate }, bank: ACCOUNT }, config: CFG, period: P, input: input || {},
});
{
  const i = daily(500);
  check("รายวันที่ยังไม่กรอกวัน = incomplete", i.incomplete === "ต้องกรอกจำนวนวันทำงาน");
  eq("รายวันที่ยังไม่กรอกวัน รายได้เป็น 0 ไม่ใช่เดา", i.gross, 0);
}
{
  const i = daily(500, { days_worked: 22 });
  eq("500 x 22 วัน = 11,000", i.gross, 11000);
  eq("ฐานประกันสังคม 11,000 → 550", i.sso_employee, 550);
  check("กรอกวันแล้วหายจาก incomplete", i.incomplete === null);
}
{
  const i = daily(0, { days_worked: 10 });
  check("ยังไม่ตั้งค่าแรงรายวัน = incomplete", i.incomplete === "ยังไม่ได้ตั้งค่าแรงรายวัน");
}

// ── 9. ฟรีแลนซ์/ไรเดอร์ต้องไม่เข้ารอบเงินเดือน ─────────────────────────────
// เขาถูกจ่ายผ่านกระเป๋าเงินและหัก 3% ตอนถอนอยู่แล้ว การใส่เข้ามาที่นี่คือจ่ายซ้ำ
{
  const i = buildPayrollItem({
    employee: { id: "r1", employment_type: "freelance" },
    priv: { pay: { base_salary: 30000 } }, config: CFG, period: P, input: {},
  });
  eq("ฟรีแลนซ์ถูกข้าม", i.skipped, "freelance");
  eq("ฟรีแลนซ์ไม่มียอดใดๆ", i.gross, 0);
}

// ── 10. คนที่พ้นสภาพกลางงวดยังต้องได้เงินของวันที่ทำจริง ───────────────────
{
  const p = periodBounds(2026, 9, 20);
  const gone = { status: "resigned", terminated_at: bangkokMidnight(2026, 9, 5), employment_type: "monthly" };
  check("ลาออกกลางงวด ยังอยู่ในรอบ", eligibleForPeriod(gone, p) === true);
  const long = { status: "resigned", terminated_at: bangkokMidnight(2026, 5, 1), employment_type: "monthly" };
  check("ลาออกก่อนงวดเริ่ม ไม่อยู่ในรอบ", eligibleForPeriod(long, p) === false);
  const future = { status: "active", hired_at: bangkokMidnight(2026, 12, 1), employment_type: "monthly" };
  check("ยังไม่ถึงวันเริ่มงาน ไม่อยู่ในรอบ", eligibleForPeriod(future, p) === false);
  check("ฟรีแลนซ์ไม่อยู่ในรอบ", eligibleForPeriod({ status: "active", employment_type: "freelance" }, p) === false);
  check("พนักงานปกติอยู่ในรอบ", eligibleForPeriod({ status: "active", employment_type: "monthly" }, p) === true);
}

// ── 11. ยอดรวมของรอบ ───────────────────────────────────────────────────────
{
  const a = monthly(60000);
  const b = daily(500, { days_worked: 22 });
  const c = daily(500); // incomplete
  const t = summarizeRun([a, b, c, { skipped: "freelance" }]);
  eq("นับเฉพาะคนที่อยู่ในรอบ", t.headcount, 3);
  eq("รวมรายได้", t.gross, 71000);
  eq("นับจำนวนคนที่กรอกไม่ครบ", t.incomplete, 1);
  eq("รวมสมทบนายจ้าง", t.sso_employer, 875 + 550);
}

// ── 12. ค่าที่ตั้งครึ่งเดียวต้องไม่ทำให้ฟิลด์อื่นเป็นศูนย์ ─────────────────
// เพดานค่าใช้จ่ายที่กลายเป็น 0 = หักภาษีเกินจริงทุกคนแบบเงียบๆ
{
  const c = resolvePayrollConfig({ social_security: { rate_percent: 3 } });
  eq("ตั้งแค่อัตรา สปส. — เพดานยังเป็นค่าตั้งต้น", c.social_security.wage_ceiling, 17500);
  eq("อัตราที่ตั้งถูกใช้จริง", c.social_security.rate_percent, 3);
  eq("ค่าใช้จ่ายเหมายังเป็นค่าตั้งต้น", c.income_tax.expense_cap, 100000);
  eq("ขั้นบันไดยังครบ", c.income_tax.brackets.length, 8);
}
{
  const c = resolvePayrollConfig({ payroll: { cutoff_day: 15 } });
  eq("ตั้งแค่วันตัดรอบ — วันจ่ายยังเป็นค่าตั้งต้น", c.payroll.pay_day, 25);
  eq("วันตัดรอบที่ตั้งถูกใช้จริง", c.payroll.cutoff_day, 15);
}
{
  const c = resolvePayrollConfig({ income_tax: { brackets: [{ upTo: null, rate: 10 }] } });
  eq("ขั้นบันไดที่ตั้งเองถูกใช้จริง", progressiveTax(100000, c.income_tax.brackets), 10000);
}

// ── 12b. เพดานลดหย่อนต้องไม่บีบต่ำกว่ายอดที่หักไปจริง ─────────────────────
// ถ้าเพดานลดหย่อนประกันสังคมต่ำกว่า 12 x เงินสมทบสูงสุดต่อเดือน แปลว่าเราคิด
// ภาษีจากเงินที่ลูกจ้างไม่เคยได้รับ — เป็นค่าคู่ที่อยู่คนละหัวข้อกัน จึงพลาด
// ได้ง่ายเวลาแก้เพดานค่าจ้างแล้วลืมแก้เพดานลดหย่อน (เกิดขึ้นจริงตอนเพดาน
// ขยับจาก 15,000 เป็น 17,500 ในปี 2569)
{
  const maxMonthly = (DEFAULT_SSO.wage_ceiling * DEFAULT_SSO.rate_percent) / 100;
  check(
    `เพดานลดหย่อน สปส. (${DEFAULT_TAX.sso_allowance_cap}) ต้องไม่ต่ำกว่า 12 x สมทบสูงสุด (${maxMonthly * 12})`,
    DEFAULT_TAX.sso_allowance_cap >= maxMonthly * 12
  );
  // และต้องเป็นจริงกับค่าที่ resolve แล้วด้วย ไม่ใช่แค่ค่าคงที่ในโค้ด
  const c = resolvePayrollConfig({});
  const resolvedMax = (c.social_security.wage_ceiling * c.social_security.rate_percent) / 100;
  check("เพดานลดหย่อนหลัง resolve ก็ยังไม่บีบ", c.income_tax.sso_allowance_cap >= resolvedMax * 12);
}

// ── 12c. รายการปรับเพิ่ม/ปรับลด + ต้นทุนบริษัท + ช่องทางจ่าย ──────────────
// เคสจริงของพนักงานขาย: เงินเดือน 20,000 + คอมมิชชั่น 8,000 - หักขาดงาน 500
// ฐานประกันสังคม = 28,000 ซึ่งเกินเพดาน 17,500 → สมทบ 875
// ภาษี: 28,000x12 = 336,000 - 100,000 - 70,500 = 165,500
//       → 15,500x5% = 775/ปี → 64.58/งวด
// สุทธิ = 28,000 - 875 - 64.58 - 500 = 26,560.42
{
  const i = buildPayrollItem({
    employee: { id: "s1", name: "ขาย", employment_type: "monthly", hired_at: bangkokMidnight(2024, 1, 1) },
    priv: { pay: { base_salary: 20000 }, bank: { name: "กสิกรไทย", account: "131-8-79619-6" } },
    config: CFG, period: P,
    input: {
      extra_earnings: [{ label: "ค่าคอมมิชชั่น", amount: 8000, sso_wage: true }],
      extra_deductions: [{ label: "หักขาด/ลา/มาสาย", amount: 500 }],
    },
  });
  eq("คอมมิชชั่นรวมในรายได้", i.gross, 28000);
  eq("คอมมิชชั่นที่ติ๊กแล้วเข้าฐานประกันสังคม", i.sso_wage, 28000);
  eq("ฐานเกินเพดาน → สมทบ 875", i.sso_employee, 875);
  eq("ภาษีของพนักงานขายคนนี้ = 64.58", i.wht, 64.58);
  eq("สุทธิหลังหักรายการปรับลด = 26,560.42", i.net, 26560.42);
  eq("ช่องทางจ่ายมาจากการมีเลขบัญชี", i.pay_method, "transfer");
  eq("เลขบัญชีถูก mask ในบรรทัดของรอบ", i.bank_masked, "••••6196");
  check("ไม่เก็บเลขบัญชีเต็มไว้ในบรรทัดของรอบ",
    !JSON.stringify(i).includes("13187961") && !JSON.stringify(i).includes("131-8-79619-6"));
}
{
  const i = buildPayrollItem({
    employee: { id: "c1", employment_type: "monthly", hired_at: bangkokMidnight(2024, 1, 1) },
    priv: { pay: { base_salary: 20000 } }, config: CFG, period: P, input: {},
  });
  // **เปลี่ยนพฤติกรรมโดยตั้งใจ (ก.ย. 2569)** — ของเดิมอ่านว่า "ไม่มีเลขบัญชี =
  // เงินสด" ทำให้คนที่ควรได้รับโอนแต่ข้อมูลยังไม่ครบ ตกไปอยู่ถังเงินสดเงียบๆ
  // แล้วยอดในสรุปก็ดูสมเหตุสมผล จนไปตายตอนโอนจริง
  eq("ไม่มีเลขบัญชี = ยังเป็นโอน (ไม่เดาว่าเงินสด)", i.pay_method, "transfer");
  check("ไม่มีเลขบัญชี = กันการอนุมัติ", Boolean(i.incomplete));
  eq("ไม่มีเลขบัญชี = ไม่มีเลข mask", i.bank_masked, null);
}
{
  // ประกาศว่ารับเงินสดจริง = ผ่านได้โดยไม่ต้องมีเลขบัญชี
  const i = buildPayrollItem({
    employee: { id: "c2", employment_type: "monthly", hired_at: bangkokMidnight(2024, 1, 1) },
    priv: { pay: { base_salary: 20000, pay_method: "cash" }, social_security_no: "1" },
    config: CFG, period: P, input: {},
  });
  eq("ประกาศเงินสด = เงินสด", i.pay_method, "cash");
  check("ประกาศเงินสด = ไม่กันการอนุมัติ", i.incomplete === null);
}
{
  // ต้นทุนบริษัทต้องรวมเงินสมทบฝั่งนายจ้าง — ยอดโอนสุทธิไม่ใช่ต้นทุน
  const a = monthly(20000);
  const t = summarizeRun([a]);
  eq("ต้นทุนบริษัท = รายได้รวม + สมทบนายจ้าง", t.employer_cost, 20000 + 875);
  check("ต้นทุนบริษัทมากกว่ายอดโอนสุทธิเสมอ", t.employer_cost > t.net);
  eq("แยกช่องทาง: มีบัญชี = โอน", t.transfer, a.net);
  eq("แยกช่องทาง: เงินสด = 0", t.cash, 0);
}

// ── 12d. รายการที่ใช้ประจำ (presets) ───────────────────────────────────────
{
  const c = resolvePayrollConfig({});
  check("มี presets ค่าตั้งต้น", Array.isArray(c.adjustment_presets) && c.adjustment_presets.length > 0);
  const byLabel = Object.fromEntries(c.adjustment_presets.map((r) => [r.label, r]));
  // ค่าล่วงเวลาและคอมมิชชั่นเป็นค่าจ้าง → เข้าฐานสมทบ · โบนัสประจำปีไม่ใช่
  check("ค่าล่วงเวลาเข้าฐานประกันสังคมโดยค่าตั้งต้น", byLabel["ค่าล่วงเวลา"]?.sso_wage === true);
  check("ค่าคอมมิชชั่นเข้าฐานประกันสังคมโดยค่าตั้งต้น", byLabel["ค่าคอมมิชชั่น"]?.sso_wage === true);
  check("โบนัสไม่เข้าฐานประกันสังคมโดยค่าตั้งต้น", byLabel["โบนัส"]?.sso_wage === false);
  check("มีรายการฝั่งปรับลดด้วย", c.adjustment_presets.some((r) => r.kind === "deduction"));
}
{
  const c = resolvePayrollConfig({ adjustment_presets: [{ label: "ค่าน้ำมัน", kind: "earning", sso_wage: true }] });
  eq("ตั้ง presets เองแล้วใช้ของตัวเอง", c.adjustment_presets.length, 1);
  eq("presets ที่ตั้งเองถูกอ่านถูกต้อง", c.adjustment_presets[0].label, "ค่าน้ำมัน");
}
{
  const c = resolvePayrollConfig({ adjustment_presets: [{ kind: "earning" }, { label: "  " }] });
  eq("แถวที่ไม่มีชื่อถูกทิ้ง", c.adjustment_presets.length, 0);
}
{
  // ยังไม่เคยตั้ง = ได้ค่าตั้งต้น · ตั้งเป็นลิสต์ว่าง = ว่างจริง
  // ถ้าลิสต์ว่างคืนค่าตั้งต้น แปลว่า "ลบทิ้งทั้งหมด" ทำไม่ได้ รายการที่ลบไป
  // จะโผล่กลับมาเองทุกครั้งที่โหลดหน้า
  eq("ยังไม่เคยตั้ง = ค่าตั้งต้น",
    resolvePayrollConfig({}).adjustment_presets.length, DEFAULT_ADJUSTMENT_PRESETS.length);
  eq("ตั้งเป็นลิสต์ว่าง = ว่างจริง (ลบทิ้งทั้งหมดได้)",
    resolvePayrollConfig({ adjustment_presets: [] }).adjustment_presets.length, 0);
}

// ── 12e. เงินได้ครั้งคราว — ไม่ถูกคูณจำนวนงวด ─────────────────────────────
// เคสจริงของคุณแนน: เงินเดือน 20,000 + คอมมิชชั่น 30,000
//
// คิดรวมแบบเดิม: (50,000x12=600,000) - 100,000 - 70,500 = 429,500
//   → 7,500 + 129,500x10% = 20,450/ปี → 1,704.17/งวด
// คิดแยกก้อนพิเศษ:
//   ประจำ  240,000 - 100,000 - 70,500 = 69,500 → ต่ำกว่า 150,000 → ภาษี 0
//   รวมก้อน 270,000 - 100,000 - 70,500 = 99,500 → ต่ำกว่า 150,000 → ภาษี 0
//   → ส่วนต่าง 0 → หักงวดนี้ 0
// ต่างกัน 1,704.17 บาทในเดือนเดียว ซึ่งคือเงินสดของลูกจ้างที่ถูกกันไว้ข้ามปี
{
  const withOcc = computeWithholding({
    periodIncome: 20000, occasionalIncome: 30000, periods: 12,
    ssoPerPeriod: 875, allowances: {}, tax: CFG.income_tax,
  });
  eq("แยกก้อนพิเศษแล้วไม่ถึงเกณฑ์เสียภาษี", withOcc.amount, 0);
  eq("บันทึกยอดก้อนพิเศษไว้ให้อธิบายได้", withOcc.basis.occasional_income, 30000);
  eq("ภาษีส่วนเพิ่มจากก้อนพิเศษ = 0", withOcc.basis.occasional_tax, 0);

  const asRegular = computeWithholding({
    periodIncome: 50000, periods: 12, ssoPerPeriod: 875, allowances: {}, tax: CFG.income_tax,
  });
  eq("คิดรวมเป็นรายได้ประจำ = 1,704.17 (ของเดิม)", asRegular.amount, 1704.17);
  check("การแยกก้อนพิเศษให้ผลต่างจริง ไม่ใช่ทางที่ไม่มีใครเดินถึง",
    withOcc.amount !== asRegular.amount);
}
{
  // ก้อนพิเศษที่ใหญ่พอจะดันข้ามขั้น: เงินเดือน 40,000 + โบนัส 200,000
  //   ประจำ  480,000 - 100,000 - 70,500 = 309,500 → 7,500 + 9,500x10% = 8,450
  //   รวมก้อน 680,000 - 100,000 - 70,500 = 509,500 → 7,500+20,000+9,500x15%(1,425) = 28,925
  //   ส่วนต่าง = 20,475 · ต่องวดของประจำ = 8,450/12 = 704.17 → รวม 21,179.17
  const r = computeWithholding({
    periodIncome: 40000, occasionalIncome: 200000, periods: 12,
    ssoPerPeriod: 875, allowances: {}, tax: CFG.income_tax,
  });
  eq("ภาษีของรายได้ประจำทั้งปี", r.basis.annual_tax, 8450);
  eq("ภาษีส่วนเพิ่มจากโบนัสก้อนใหญ่", r.basis.occasional_tax, 20475);
  eq("รวมหักงวดที่จ่ายโบนัส", r.amount, 21179.17);
}
{
  // เพดานค่าใช้จ่ายเหมาต้องคิดใหม่บนฐานที่รวมก้อนพิเศษ
  //
  // **fixture นี้เขียนขึ้นเพราะ injection ผ่าน** — สองเคสข้างบนมีรายได้ประจำสูง
  // พอที่ค่าใช้จ่ายเหมาติดเพดาน 100,000 อยู่แล้วทั้งก่อนและหลังบวกก้อนพิเศษ
  // การคิดใหม่จึงไม่เปลี่ยนอะไร กฎข้อนี้เลยไม่เคยถูกทดสอบ
  //
  // เคสที่ไปถึงกฎ: เงินเดือน 15,000 → ทั้งปี 180,000 → 50% = 90,000 (ยังไม่ติด
  // เพดาน) พอบวกโบนัส 400,000 เป็น 580,000 → 50% = 290,000 → ติดเพดาน 100,000
  //   ประจำ  180,000 - 90,000 - 69,000 = 21,000 → ภาษี 0
  //   รวมก้อน 580,000 - 100,000 - 69,000 = 411,000
  //          → 7,500 + 111,000x10% = 11,100 → รวม 18,600
  // ถ้าไม่คิดค่าใช้จ่ายใหม่ (ใช้ 90,000 ต่อ) จะได้ 421,000 → 19,600 = หักเกิน 1,000
  const r = computeWithholding({
    periodIncome: 15000, occasionalIncome: 400000, periods: 12,
    ssoPerPeriod: 750, allowances: {}, tax: CFG.income_tax,
  });
  eq("ค่าใช้จ่ายเหมาของรายได้ประจำยังไม่ติดเพดาน", r.basis.expenses, 90000);
  eq("ภาษีของรายได้ประจำ = 0", r.basis.annual_tax, 0);
  eq("ภาษีก้อนพิเศษคิดจากฐานที่ค่าใช้จ่ายติดเพดานแล้ว", r.basis.occasional_tax, 18600);
  eq("รวมหักงวดนี้", r.amount, 18600);
}
{
  eq("ไม่มีก้อนพิเศษ = สูตรยุบเหลือแบบเดิมเป๊ะ",
    computeWithholding({ periodIncome: 50000, occasionalIncome: 0, periods: 12, ssoPerPeriod: 875, allowances: {}, tax: CFG.income_tax }).amount,
    1704.17);
}
{
  // ธง occasional บนบรรทัดต้องเดินไปถึงสูตรจริง ไม่ใช่แค่ถูกเก็บไว้
  const plain = monthly(20000, null, null, { extra_earnings: [{ label: "คอม", amount: 30000, sso_wage: true }] });
  const occ = monthly(20000, null, null, { extra_earnings: [{ label: "คอม", amount: 30000, sso_wage: true, occasional: true }] });
  eq("ไม่ติ๊กครั้งคราว → หัก 1,704.17", plain.wht, 1704.17);
  eq("ติ๊กครั้งคราว → หัก 0", occ.wht, 0);
  eq("ยอดรายได้รวมเท่ากันทั้งสองแบบ", plain.gross, occ.gross);
  eq("ฐานประกันสังคมไม่เปลี่ยนตามธงครั้งคราว", plain.sso_employee, occ.sso_employee);
  eq("บันทึกยอดครั้งคราวไว้บนบรรทัด", occ.occasional_income, 30000);
}

// ── 12f. พิมพ์ทับยอดภาษี ────────────────────────────────────────────────────
{
  const base = monthly(50000);
  const ov = monthly(50000, null, null, {
    wht_override: { amount: 900, reason: "บัญชีคิดแยกก้อนพิเศษ", by_name: "CEO", at: 1 },
  });
  eq("ใช้ยอดที่พิมพ์ทับ", ov.wht, 900);
  eq("เก็บยอดที่ระบบคำนวณไว้ด้วยเสมอ", ov.wht_computed, base.wht);
  check("ยอดที่ระบบคำนวณไม่ถูกเขียนทับ", ov.wht_computed !== ov.wht);
  eq("บันทึกเหตุผล", ov.wht_override.reason, "บัญชีคิดแยกก้อนพิเศษ");
  eq("บันทึกผู้แก้", ov.wht_override.by_name, "CEO");
  eq("ยอดสุทธิใช้เลขที่พิมพ์ทับ", ov.net, round2(50000 - 875 - 900));
  const line = ov.deductions.find((d) => d.type === "wht");
  check("บรรทัดหักบอกว่าแก้ด้วยมือ", /แก้ด้วยมือ/.test(line.label));
  check("บรรทัดหักปกติไม่ติดป้ายนั้น",
    !/แก้ด้วยมือ/.test(base.deductions.find((d) => d.type === "wht").label));
}
{
  eq("พิมพ์ทับเป็น 0 ได้ (ไม่ใช่ถูกมองว่าไม่ได้ตั้ง)",
    monthly(50000, null, null, { wht_override: { amount: 0, reason: "ยกเว้น" } }).wht, 0);
  eq("ไม่ส่ง override = ใช้ที่ระบบคำนวณ", monthly(50000).wht, 1704.17);
  check("ยอดติดลบถูกปัดเป็น 0 ไม่ใช่คืนเงินภาษี",
    monthly(50000, null, null, { wht_override: { amount: -500, reason: "x" } }).wht === 0);
}

// ── 13. gate ของ callable + กติกาที่อ่านจาก source ─────────────────────────
const apiSrc = readFileSync(join(fnDir, "hr-payroll-api.js"), "utf8");
const engineSrc = readFileSync(join(fnDir, "hr-payroll.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/pages/hr/PayrollRuns.tsx"), "utf8");

for (const name of [
  "adminHrPayrollList", "adminHrPayrollGet", "adminHrPayrollDraft",
  "adminHrPayrollSetItem", "adminHrPayrollApprove", "adminHrPayrollMarkPaid",
]) {
  const start = apiSrc.indexOf(`const ${name} = onCall`);
  const next = apiSrc.indexOf("\n  const admin", start + 1);
  const body = start === -1 ? null : apiSrc.slice(start, next === -1 ? apiSrc.length : next);
  check(`${name} มี gate requireStaffRole(..., HR_ROLES)`,
    !!body && /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(body));
}

// รอบที่อนุมัติแล้วต้องแก้ไม่ได้ทุกทาง — นี่คือกติกาข้อ 2 ของไฟล์
for (const name of ["adminHrPayrollDraft", "adminHrPayrollSetItem", "adminHrPayrollApprove"]) {
  const start = apiSrc.indexOf(`const ${name} = onCall`);
  const next = apiSrc.indexOf("\n  const admin", start + 1);
  const body = apiSrc.slice(start, next === -1 ? apiSrc.length : next);
  check(`${name} ปฏิเสธรอบที่ไม่ใช่ draft`, /status !== "draft"|status && \w+\.status !== "draft"/.test(body));
}
// การพิมพ์ทับยอดภาษีต้องมีเหตุผลเสมอ และผู้แก้ต้องมาจาก auth token
check("server บังคับให้ระบุเหตุผลตอนพิมพ์ทับยอดภาษี",
  /ต้องระบุเหตุผล/.test(apiSrc) && /whtOverride/.test(apiSrc));
check("ผู้แก้มาจาก employeeActorFields ไม่ใช่จาก client",
  /const actor = employeeActorFields\(callerStaffId, staffMap, request\.auth\);/.test(apiSrc));
check("ไม่รับชื่อผู้แก้ที่ client ส่งมา",
  !/by_name: (data|rawOv)\./.test(apiSrc));
check("ยอดที่พิมพ์ทับรอดจากการคำนวณรอบใหม่",
  /wht_override: \(existing && existing\.wht_override\) \|\| null,/.test(apiSrc));

check("อนุมัติไม่ได้ถ้ายังมีบรรทัดที่กรอกไม่ครบ",
  /const blocked = items\.filter\(\(i\) => i && i\.incomplete\);/.test(apiSrc) && /blocked\.length/.test(apiSrc));
check("บันทึกว่าจ่ายแล้วได้เฉพาะรอบที่อนุมัติแล้ว",
  /status !== "approved"/.test(apiSrc));
check("รอบคีย์ด้วยงวด ไม่ใช่ push id (กันสองใบของงวดเดียวกัน)",
  /payroll_runs\/\$\{p\.key\}/.test(apiSrc) && !/ref\("payroll_runs"\)\.push\(\)/.test(apiSrc));
check("รอบแช่ config ที่ใช้คำนวณไว้กับตัวเอง",
  /config,\n\s+drafted_at/.test(apiSrc));
check("แก้บรรทัดเดียวใช้ config ที่แช่ไว้ ไม่ใช่ settings ปัจจุบัน",
  /const config = run\.config \|\| await loadHrSettings\(db\)/.test(apiSrc));
check("การคำนวณใหม่เก็บสิ่งที่ HR กรอกเองไว้",
  /const carryInput = \(existing\)/.test(apiSrc) && /carryInput\(prevItems\[id\]\)/.test(apiSrc));

// ── 14. เครื่องคิดเงินต้องไม่มี I/O และไม่มีอัตราฝังในสูตร ────────────────
check("hr-payroll.js ไม่ import firebase อะไรเลย", !/require\(["']firebase/.test(engineSrc));
{
  // ตัวเลขกฎหมายต้องอยู่ในบล็อกค่าตั้งต้นเท่านั้น ไม่ใช่กระจายในสูตร
  const afterDefaults = engineSrc.slice(engineSrc.indexOf("const round2"));
  const leaked = ["150000", "300000", "60000", "9000", "15000", "1650"].filter((n) => afterDefaults.includes(n));
  check("ไม่มีอัตราตามกฎหมายฝังอยู่ในสูตร (มีแต่ในบล็อกค่าตั้งต้น)", leaked.length === 0);
}

// ── 15. หน้าเว็บต้องไม่อ้างเกินจริง ────────────────────────────────────────
// CSV ที่ส่งออกไม่ใช่ไฟล์ e-filing และปุ่ม "จ่ายแล้ว" ไม่ได้โอนเงินให้
//
// **ต้องตัดคอมเมนต์ออกก่อนค้นเสมอ** — รอบแรกเทสข้อนี้เขียวทั้งที่ลบข้อความ
// เตือนบนหน้าจอไปแล้ว เพราะประโยคเดียวกันยังอยู่ในคอมเมนต์หัวไฟล์ ซึ่งไม่มี
// ลูกค้าคนไหนอ่าน เทสที่ค้นทั้งไฟล์จึงพิสูจน์แค่ว่า "เคยมีคนเขียนคำนี้ไว้"
// ไม่ได้พิสูจน์ว่าคำนั้นยังขึ้นบนจอ
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
const uiText = stripComments(uiSrc);

// รับได้ทั้ง "e-filing" และ "e-Filing" และทั้งรูป "ไม่ใช่ไฟล์..." กับ
// "ยังไม่ใช่ไฟล์อัปโหลดเข้า..." — สิ่งที่ตรึงคือ **คำปฏิเสธต้องอยู่บนจอ**
// ไม่ใช่ถ้อยคำเป๊ะๆ (ครั้งก่อนถ้อยคำเปลี่ยนแล้วเทสแดงทั้งที่คำเตือนยังอยู่จริง)
check("หน้าเว็บบอกว่า CSV ไม่ใช่ไฟล์ e-filing", /ไม่ใช่ไฟล์[^\n]{0,40}e-filing/i.test(uiText));
check("หน้าเว็บบอกว่าระบบไม่ได้โอนเงินให้", /ระบบไม่ได้โอนให้/.test(uiText));
check("หน้าเว็บบอกว่าอัตราเป็นค่าตั้งต้นที่ต้องตรวจก่อนยื่นจริง",
  /ค่าตั้งต้น/.test(uiText) && /ก่อนยื่นจริง/.test(uiText));
check("หน้าเว็บกางที่มาของภาษีให้ตรวจได้", /ที่มาของภาษีหัก ณ ที่จ่าย/.test(uiText));
// พิสูจน์ว่าตัวตัดคอมเมนต์ทำงานจริง ไม่ใช่ฟังก์ชันที่คืนค่าเดิม
check("ตัวตัดคอมเมนต์ตัดได้จริง",
  stripComments("a\n// x\n/* y */b").indexOf("x") === -1 && stripComments("a\n// x\nb").includes("a"));
check("ปุ่มอนุมัติถูกปิดเมื่อยังกรอกไม่ครบ", /disabled=\{busy \|\| incomplete\.length > 0\}/.test(uiSrc));

// ── 16. หน้าตั้งค่า settings/hr ────────────────────────────────────────────
const setSrc = readFileSync(join(root, "src/pages/hr/HrSettings.tsx"), "utf8");

// ห้าม set() ที่ settings/hr เด็ดขาด — ใต้โหนดเดียวกันมี employee_code_seq_by_year
// (ตัวนับรหัสพนักงาน) เขียนทับทั้งก้อนเมื่อไหร่ ตัวนับกลับไปเริ่มใหม่ แล้วรหัส
// พนักงานคนใหม่จะซ้ำกับคนที่มีอยู่แล้ว
check("หน้าตั้งค่าเขียนด้วย update() ไม่ใช่ set()",
  /update\(ref\(db, ['"]settings\/hr['"]\)/.test(setSrc));
check("หน้าตั้งค่าไม่มี set() ที่ settings/hr เลย",
  !/[^a-zA-Z]set\(ref\(db, ['"]settings\/hr['"]/.test(setSrc));
check("หน้าตั้งค่าไม่แตะตัวนับรหัสพนักงาน",
  !/employee_code_seq_by_year/.test(setSrc.replace(/\/\/.*$/gm, "")));

// ค่าที่หน้าเว็บบอกว่า "ถ้าไม่ตั้งจะได้อะไร" ต้องตรงกับค่าตั้งต้นจริงของ
// เครื่องคิดเงิน — ไม่ตรงเมื่อไหร่ หน้าตั้งค่าจะโกหกคนที่มาอ่าน
{
  const block = setSrc.slice(setSrc.indexOf("const CODE_DEFAULTS"), setSrc.indexOf("const DEFAULT_BRACKETS"));
  const mirrors = [
    ["cutoff_day", DEFAULT_PAYROLL.cutoff_day],
    ["pay_day", DEFAULT_PAYROLL.pay_day],
    ["prorate_divisor", DEFAULT_PAYROLL.prorate_divisor],
    ["rate_percent", DEFAULT_SSO.rate_percent],
    ["wage_floor", DEFAULT_SSO.wage_floor],
    ["wage_ceiling", DEFAULT_SSO.wage_ceiling],
    ["expense_rate_percent", DEFAULT_TAX.expense_rate_percent],
    ["expense_cap", DEFAULT_TAX.expense_cap],
    ["personal_allowance", DEFAULT_TAX.personal_allowance],
    ["spouse_allowance", DEFAULT_TAX.spouse_allowance],
    ["child_allowance", DEFAULT_TAX.child_allowance],
    ["parent_allowance", DEFAULT_TAX.parent_allowance],
    ["sso_allowance_cap", DEFAULT_TAX.sso_allowance_cap],
  ];
  const missing = mirrors.filter(([k, v]) => !new RegExp(`${k}: ${v}\\b`).test(block));
  check(`CODE_DEFAULTS ในหน้าตั้งค่าตรงกับค่าตั้งต้นของเครื่องคิดเงินครบทุกตัว${missing.length ? " (ไม่ตรง: " + missing.map((m) => m[0]).join(", ") + ")" : ""}`,
    missing.length === 0);
}
{
  // ขั้นบันไดที่หน้าเว็บใช้เป็นค่าตั้งต้นต้องตรงกับของเครื่องคิดเงินด้วย
  const block = setSrc.slice(setSrc.indexOf("const DEFAULT_BRACKETS"), setSrc.indexOf("interface Bracket"));
  const rows = block.match(/upTo:/g) || [];
  check("จำนวนขั้นบันไดในหน้าตั้งค่าเท่ากับเครื่องคิดเงิน", rows.length === DEFAULT_TAX.brackets.length);
  const topRate = DEFAULT_TAX.brackets[DEFAULT_TAX.brackets.length - 1].rate;
  check("ขั้นบนสุดของหน้าตั้งค่าไม่มีเพดานและอัตราตรงกัน",
    new RegExp(`upTo: null[^,]*, rate: ${topRate}`).test(block));
}
// เช็คว่ามัน **ถูก render** ไม่ใช่แค่มีชื่อตัวแปรอยู่ในไฟล์ — รอบแรกเทสข้อนี้
// เขียวตอนเปลี่ยนชื่อตัวแปรเป็น capWarningDisabled เพราะ /capWarning/ ยัง match
// สตริงที่ยาวกว่า (การ์ดหายจากจอแต่เทสไม่รู้)
{
  const ui = stripComments(setSrc);
  check("หน้าตั้งค่าคำนวณคำเตือนเพดานลดหย่อน", /const capWarning = useMemo\(/.test(ui));
  check("หน้าตั้งค่า render คำเตือนนั้นจริง", /\{capWarning && \(/.test(ui));
  check("ข้อความเตือนบอกว่าจะคิดภาษีจากเงินที่ลูกจ้างไม่เคยได้รับ",
    /คิดภาษีจากเงินที่ลูกจ้างไม่เคยได้รับ/.test(ui));
}
// presets ที่หน้าตั้งค่าโชว์เป็นค่าตั้งต้น ต้องตรงกับของเครื่องคิดเงิน
{
  const block = setSrc.slice(setSrc.indexOf("const DEFAULT_PRESETS"), setSrc.indexOf("const numOr"));
  const missing = DEFAULT_ADJUSTMENT_PRESETS.filter((r) => !block.includes(`'${r.label}'`));
  check(`DEFAULT_PRESETS ในหน้าตั้งค่ามีครบทุกรายการ${missing.length ? " (ขาด: " + missing.map((m) => m.label).join(", ") + ")" : ""}`,
    missing.length === 0);
  const ot = /label: 'ค่าล่วงเวลา'[^}]*sso_wage: true/.test(block);
  const bonus = /label: 'โบนัส'[^}]*sso_wage: false/.test(block);
  check("ค่าเริ่มต้น sso_wage ของหน้าตั้งค่าตรงกับเครื่องคิดเงิน", ot && bonus);
}

// หน้ารอบจ่ายต้องกรอกรายการปรับเพิ่ม/ปรับลดได้จริง ไม่ใช่มีแต่ช่องจำนวนวัน
{
  const ui = stripComments(uiSrc);
  check("หน้ารอบจ่ายมีตัวแก้รายการปรับเพิ่ม/ปรับลด", /<ManualLinesEditor/.test(ui));
  check("ตัวแก้ถูกซ่อนเมื่อรอบล็อกแล้ว", /\{!locked && \(\s*<ManualLinesEditor/.test(ui));
  check("ส่ง extra_earnings / extra_deductions ไปที่ callable",
    /extra_earnings:/.test(ui) && /extra_deductions:/.test(ui));
  check("ช่อง 'เข้าฐานประกันสังคม' โชว์รายบรรทัด ไม่ได้ซ่อนไว้ในค่าตั้งต้น",
    /เข้าฐานประกันสังคม/.test(ui));
  check("มีช่องติ๊ก 'จ่ายเป็นครั้งคราว' รายบรรทัด", /จ่ายเป็นครั้งคราว/.test(ui));
  check("มีตัวพิมพ์ทับยอดภาษี", /<WhtOverrideEditor/.test(ui));
  check("ปุ่มใช้ยอดที่พิมพ์ทับถูกปิดถ้าไม่กรอกเหตุผล", /!reason\.trim\(\)/.test(ui));
  check("โชว์ทั้งเลขที่ระบบคิดและเลขที่คนแก้", /ระบบคำนวณ \{baht\(item\.wht_computed\)\}/.test(ui));
  check("โชว์ที่มาของภาษีส่วนก้อนพิเศษ", /ภาษีส่วนเพิ่ม/.test(ui));
  check("หน้ารอบจ่ายโชว์ต้นทุนบริษัท (ไม่ใช่แค่ยอดโอน)", /ต้นทุนบริษัท/.test(ui));
  check("หน้ารอบจ่ายแยกยอดตามช่องทางจ่าย", /แยกตามช่องทางจ่าย/.test(ui));
}

check("หน้าตั้งค่าบอกว่ารอบที่อนุมัติแล้วไม่เปลี่ยนตาม",
  /ไม่ย้อนไปแก้รอบที่อนุมัติแล้ว/.test(stripComments(setSrc)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
