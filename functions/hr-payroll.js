// =============================================================================
// เครื่องคิดเงินเดือน — กติกาล้วน ไม่มี I/O (เฟส P5 ของ docs/hr-system-design.md)
//
// **ทุกอัตราเป็นพารามิเตอร์ ไม่มีตัวไหนฝังในสูตร** และรอบที่อนุมัติแล้วจะ
// **แช่ค่าที่ใช้ตอนนั้นไว้กับตัวรอบเอง** เหตุผลสองข้อ:
//
//   1. กฎหมายภาษีและอัตราประกันสังคมเปลี่ยนได้ และเคยเปลี่ยนจริง (อัตรา สปส.
//      ถูกลดชั่วคราวหลายรอบ) การแก้ตัวเลขต้องเป็นการแก้ "ค่าตั้ง" ไม่ใช่
//      การแก้โค้ดแล้ว deploy
//   2. **รอบเก่าต้องอธิบายตัวเองได้เสมอ** — ถ้าอัตราเปลี่ยนวันนี้แล้วรอบเดือน
//      ที่แล้วคำนวณใหม่ด้วยอัตราใหม่ ตัวเลขบนสลิปที่ส่งไปแล้วจะไม่ตรงกับที่
//      ระบบบอก ซึ่งเป็นปัญหาเดียวกับใบกำกับภาษีที่ออกแล้วแก้ไม่ได้
//
// **ค่าตั้งต้นข้างล่างเป็นค่าที่ต้องตรวจกับกรมสรรพากรและประกันสังคมก่อนใช้จริง**
// ไม่ใช่ค่าที่ระบบรับประกันว่าถูกต้องตามกฎหมายวันนี้ — ตัวที่ทำให้ปลอดภัยคือ
// (ก) รอบต้องถูกตรวจในสถานะ draft ก่อนอนุมัติ ซึ่งแสดงที่มาของทุกตัวเลข และ
// (ข) แก้ที่ settings/hr ได้โดยไม่ต้อง deploy
//
// วิธีคิดภาษีหัก ณ ที่จ่ายของเงินเดือนประจำ (ม.40(1)) ที่ใช้ที่นี่คือวิธี
// "ประมาณการทั้งปีแล้วหารด้วยจำนวนงวด": รายได้ต่องวด × จำนวนงวดที่เหลือในปี
// → หักค่าใช้จ่าย → หักค่าลดหย่อน → คิดภาษีขั้นบันได → หารด้วยจำนวนงวด
// =============================================================================

// ── ค่าตั้งต้น (override ได้ที่ settings/hr) ────────────────────────────────

const DEFAULT_TAX = {
  // ค่าใช้จ่ายเหมา ม.40(1)(2)
  expense_rate_percent: 50,
  expense_cap: 100000,
  // ค่าลดหย่อน
  personal_allowance: 60000,
  spouse_allowance: 60000,
  child_allowance: 30000,
  parent_allowance: 30000,
  // เงินสมทบประกันสังคมที่จ่ายทั้งปี ใช้ลดหย่อนได้ตามจริงแต่ไม่เกินเพดาน
  // ต้องไม่ต่ำกว่า 12 x เงินสมทบสูงสุดต่อเดือน (875 x 12) — เพดานที่บีบต่ำกว่า
  // ยอดที่หักไปจริง แปลว่าเราคิดภาษีจากเงินที่ลูกจ้างไม่เคยได้รับ มีเทสตรึงไว้
  sso_allowance_cap: 10500,
  // ขั้นบันไดภาษีเงินได้บุคคลธรรมดา — upTo: null = ขั้นบนสุด
  brackets: [
    { upTo: 150000, rate: 0 },
    { upTo: 300000, rate: 5 },
    { upTo: 500000, rate: 10 },
    { upTo: 750000, rate: 15 },
    { upTo: 1000000, rate: 20 },
    { upTo: 2000000, rate: 25 },
    { upTo: 5000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
};

// เพดานค่าจ้าง 17,500 (ปรับปี 2569 จากเดิม 15,000) → สมทบสูงสุด 875 บาท/เดือน
// พื้น 1,650 → สมทบต่ำสุด 83 บาท/เดือน
//
// `round_to_baht` มาจากหลักฐานว่าพื้น 1,650 x 5% = 82.50 แต่ตารางของประกันสังคม
// เก็บ 83 บาท — ปัดเป็นจำนวนเต็มบาทแบบครึ่งขึ้น **ตั้งเป็นค่าที่ปิดได้เผื่อ
// กติกาการปัดไม่ตรงกับที่เข้าใจ** ยอดที่ลงท้าย .50 เท่านั้นที่ต่างกัน
const DEFAULT_SSO = {
  enabled: true,
  rate_percent: 5,
  wage_floor: 1650,
  wage_ceiling: 17500,
  round_to_baht: true,
};

// รายการปรับเพิ่ม/ปรับลดที่ใช้ประจำ — ตั้งเองได้ที่ settings/hr
//
// **`sso_wage` เป็นการตัดสินที่ต้องเห็น ไม่ใช่ค่าที่ซ่อนอยู่** — ค่าล่วงเวลากับ
// ค่าคอมมิชชั่นของพนักงานขายเป็น "ค่าจ้าง" ตามกฎหมายประกันสังคม จึงเข้าฐาน
// สมทบ ส่วนโบนัสประจำปีโดยทั่วไปไม่ใช่ ค่าตั้งต้นจึงต่างกัน และหน้าจอโชว์
// ช่องติ๊กรายบรรทัดให้แก้ได้เสมอ เพราะเส้นแบ่งนี้ขึ้นกับข้อเท็จจริงของแต่ละ
// รายการ ไม่ใช่ชื่อของมัน
const DEFAULT_ADJUSTMENT_PRESETS = [
  { id: "ot", label: "ค่าล่วงเวลา", kind: "earning", taxable: true, sso_wage: true },
  { id: "commission", label: "ค่าคอมมิชชั่น", kind: "earning", taxable: true, sso_wage: true },
  { id: "bonus", label: "โบนัส", kind: "earning", taxable: true, sso_wage: false },
  { id: "allowance", label: "เบี้ยขยัน", kind: "earning", taxable: true, sso_wage: true },
  { id: "absence", label: "หักขาด/ลา/มาสาย", kind: "deduction" },
  { id: "advance", label: "หักเงินเบิกล่วงหน้า", kind: "deduction" },
  { id: "other_deduction", label: "เงินหักอื่นๆ", kind: "deduction" },
];

const DEFAULT_PAYROLL = {
  cycle: "monthly",
  cutoff_day: 20,
  pay_day: 25,
  // ตัวหารสำหรับคิดค่าจ้างรายวันจากเงินเดือน (พ.ร.บ.คุ้มครองแรงงานใช้ 30)
  prorate_divisor: 30,
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// ── config ที่ถูกแช่ไว้กับรอบ ───────────────────────────────────────────────
// รวมค่าที่ตั้งไว้เข้ากับค่าตั้งต้น **ทีละฟิลด์** ไม่ใช่ทั้งก้อน — settings ที่
// ตั้งมาครึ่งเดียวต้องไม่ทำให้ฟิลด์ที่ไม่ได้ตั้งกลายเป็นศูนย์ (เพดานภาษีที่เป็น
// ศูนย์ = หักภาษีเกินจริงทุกคนเงียบๆ) รูปแบบเดียวกับ loadQuoteSettings
function resolvePayrollConfig(settings) {
  const s = settings && typeof settings === "object" ? settings : {};
  const tax = s.income_tax && typeof s.income_tax === "object" ? s.income_tax : {};
  const sso = s.social_security && typeof s.social_security === "object" ? s.social_security : {};
  const pay = s.payroll && typeof s.payroll === "object" ? s.payroll : {};

  const brackets = Array.isArray(tax.brackets) && tax.brackets.length
    ? tax.brackets.map((b) => ({
        upTo: b && b.upTo == null ? null : num(b && b.upTo, 0),
        rate: num(b && b.rate, 0),
      }))
    : DEFAULT_TAX.brackets.map((b) => ({ ...b }));

  // **มีคีย์อยู่ = เชื่อสิ่งที่แอดมินตั้ง แม้จะเหลือศูนย์แถว** ตกกลับไปใช้
  // ค่าตั้งต้นเฉพาะตอนที่ยังไม่เคยตั้งเท่านั้น — ถ้าลิสต์ว่างแล้วคืนค่าตั้งต้น
  // แปลว่า "ลบทิ้งทั้งหมด" ทำไม่ได้ รายการที่ลบไปจะโผล่กลับมาเองทุกครั้ง
  const presets = Array.isArray(s.adjustment_presets)
    ? s.adjustment_presets
        .map((r) => ({
          id: String((r && r.id) || "").trim() || null,
          label: String((r && r.label) || "").trim(),
          kind: String((r && r.kind) || "").toLowerCase() === "deduction" ? "deduction" : "earning",
          taxable: !(r && r.taxable === false),
          sso_wage: Boolean(r && r.sso_wage),
        }))
        .filter((r) => r.label)
    : DEFAULT_ADJUSTMENT_PRESETS.map((r) => ({ ...r }));

  return {
    adjustment_presets: presets,
    payroll: {
      cycle: String(pay.cycle || DEFAULT_PAYROLL.cycle),
      cutoff_day: num(pay.cutoff_day, DEFAULT_PAYROLL.cutoff_day),
      pay_day: num(pay.pay_day, DEFAULT_PAYROLL.pay_day),
      prorate_divisor: num(pay.prorate_divisor, DEFAULT_PAYROLL.prorate_divisor),
    },
    social_security: {
      enabled: sso.enabled !== false,
      rate_percent: num(sso.rate_percent, DEFAULT_SSO.rate_percent),
      wage_floor: num(sso.wage_floor, DEFAULT_SSO.wage_floor),
      wage_ceiling: num(sso.wage_ceiling, DEFAULT_SSO.wage_ceiling),
      round_to_baht: sso.round_to_baht !== false,
    },
    income_tax: {
      enabled: tax.enabled !== false,
      expense_rate_percent: num(tax.expense_rate_percent, DEFAULT_TAX.expense_rate_percent),
      expense_cap: num(tax.expense_cap, DEFAULT_TAX.expense_cap),
      personal_allowance: num(tax.personal_allowance, DEFAULT_TAX.personal_allowance),
      spouse_allowance: num(tax.spouse_allowance, DEFAULT_TAX.spouse_allowance),
      child_allowance: num(tax.child_allowance, DEFAULT_TAX.child_allowance),
      parent_allowance: num(tax.parent_allowance, DEFAULT_TAX.parent_allowance),
      sso_allowance_cap: num(tax.sso_allowance_cap, DEFAULT_TAX.sso_allowance_cap),
      brackets,
    },
  };
}

// ── ช่วงงวด ────────────────────────────────────────────────────────────────
// ตัดรอบวันที่ 20 จ่ายวันที่ 25 (ตัดสิน ก.ย. 2569) → งวดของเดือนกันยายนคือ
// 21 ส.ค. ถึง 20 ก.ย. จ่าย 25 ก.ย.
//
// คิดด้วย UTC+7 ตรงๆ ไม่พึ่ง timezone ของเครื่องที่รัน — Cloud Function รันบน
// UTC ส่วนคนใช้อยู่ไทย ถ้าปล่อยให้ Date ท้องถิ่นตัดสิน วันตัดรอบจะเลื่อนไป
// หนึ่งวันโดยไม่มีใครเห็น
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** เที่ยงคืนของวันไทยที่ระบุ คืนค่าเป็น epoch ms */
function bangkokMidnight(year, month, day) {
  return Date.UTC(year, month - 1, day) - BKK_OFFSET_MS;
}

function periodBounds(year, month, cutoffDay) {
  const cutoff = Math.min(28, Math.max(1, Math.round(num(cutoffDay, 20))));
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return {
    from: bangkokMidnight(prevYear, prevMonth, cutoff + 1),
    // สิ้นสุดท้ายวันตัดรอบ — ใช้เที่ยงคืนของวันถัดไปลบ 1 มิลลิวินาที
    to: bangkokMidnight(year, month, cutoff + 1) - 1,
  };
}

function payDateOf(year, month, payDay) {
  const d = Math.min(28, Math.max(1, Math.round(num(payDay, 25))));
  return bangkokMidnight(year, month, d);
}

/** จำนวนงวดของปีปฏิทินที่พนักงานคนนี้ยังได้รับเงินเดือน (ใช้ประมาณการภาษี) */
function periodsInYear(year, month, hiredAt) {
  if (!hiredAt) return 12;
  const d = new Date(num(hiredAt, 0) + BKK_OFFSET_MS);
  if (d.getUTCFullYear() !== year) return 12; // เข้างานปีก่อน = เต็มปี
  // เข้างานเดือนไหน ก็เหลืองวดตั้งแต่เดือนนั้นถึงสิ้นปี
  return Math.max(1, 12 - (d.getUTCMonth() + 1) + 1);
}

// ── การคิดเงินฐาน ──────────────────────────────────────────────────────────
// เข้างานหรือพ้นสภาพกลางงวด = จ่ายตามวันที่อยู่จริงในงวด
//
// ตัวหารเป็น 30 ตามที่ พ.ร.บ.คุ้มครองแรงงานใช้คิดค่าจ้างต่อวันของลูกจ้างราย
// เดือน **ไม่ใช่จำนวนวันจริงของเดือน** — ตั้งค่าได้ที่ settings/hr เพราะเป็น
// ตัวเลขที่มีผลต่อเงินในกระเป๋าคน ไม่ใช่รายละเอียดทางเทคนิค
// เลขวันตามปฏิทินไทย — นับเป็น "วัน" ไม่ใช่ "มิลลิวินาที" โดยตั้งใจ
//
// สองเหตุผล: (ก) `terminated_at` ถูกประทับตอนที่ HR กดปุ่ม ถ้าคิดด้วยมิลลิวินาที
// คนที่พ้นสภาพวันเดียวกันจะได้เงินไม่เท่ากันขึ้นกับว่ากดตอนเช้าหรือบ่าย
// (ข) วันที่ที่กรอกจากปฏิทิน (`YYYY-MM-DD`) ถูก parse เป็นเที่ยงคืน UTC ซึ่งคือ
// 07:00 ของเช้าวันนั้นตามเวลาไทย — การลบมิลลิวินาทีตรงๆ จึงคลาดไปเกือบหนึ่งวัน
const bkkDayIndex = (ms) => Math.floor((num(ms, 0) + BKK_OFFSET_MS) / (24 * 60 * 60 * 1000));

function proratedBase({ baseSalary, from, to, hiredAt, terminatedAt, divisor }) {
  const base = num(baseSalary, 0);
  if (base <= 0) return { amount: 0, days: 0, full: false };

  const fromDay = bkkDayIndex(from);
  const toDay = bkkDayIndex(to);
  // วันสุดท้ายของการทำงานนับเป็นวันที่ได้เงิน (พ้นสภาพวันที่ 31 = ทำถึงวันที่ 31)
  const start = Math.max(fromDay, hiredAt ? bkkDayIndex(hiredAt) : fromDay);
  const end = Math.min(toDay, terminatedAt ? bkkDayIndex(terminatedAt) : toDay);
  const totalDays = toDay - fromDay + 1;
  if (end < start) return { amount: 0, days: 0, full: false };

  const days = end - start + 1;
  const full = days >= totalDays;
  if (full) return { amount: round2(base), days, full: true };

  const div = num(divisor, DEFAULT_PAYROLL.prorate_divisor) || DEFAULT_PAYROLL.prorate_divisor;
  return { amount: round2((base / div) * days), days, full: false };
}

// ── ประกันสังคม ────────────────────────────────────────────────────────────
function computeSso(wage, sso) {
  const cfg = sso || DEFAULT_SSO;
  if (cfg.enabled === false) {
    return { employee: 0, employer: 0, wage_used: 0, skipped: true };
  }
  const w = num(wage, 0);
  if (w <= 0) return { employee: 0, employer: 0, wage_used: 0, skipped: false };
  const floor = num(cfg.wage_floor, DEFAULT_SSO.wage_floor);
  const ceiling = num(cfg.wage_ceiling, DEFAULT_SSO.wage_ceiling);
  const used = Math.min(Math.max(w, floor), ceiling);
  const raw = (used * num(cfg.rate_percent, DEFAULT_SSO.rate_percent)) / 100;
  const amount = cfg.round_to_baht === false ? round2(raw) : Math.round(raw);
  return { employee: amount, employer: amount, wage_used: used, skipped: false };
}

// ── ภาษีขั้นบันได ──────────────────────────────────────────────────────────
function progressiveTax(netIncome, brackets) {
  const income = Math.max(0, num(netIncome, 0));
  const list = Array.isArray(brackets) && brackets.length ? brackets : DEFAULT_TAX.brackets;
  let tax = 0;
  let prev = 0;
  for (const b of list) {
    const ceiling = b.upTo == null ? Infinity : num(b.upTo, 0);
    if (income <= prev) break;
    const slice = Math.min(income, ceiling) - prev;
    if (slice > 0) tax += (slice * num(b.rate, 0)) / 100;
    prev = ceiling;
    if (!Number.isFinite(ceiling)) break;
  }
  return round2(tax);
}

// ── ภาษีหัก ณ ที่จ่ายต่องวด ────────────────────────────────────────────────
function computeWithholding({ periodIncome, periods, ssoPerPeriod, allowances, tax }) {
  const cfg = tax || DEFAULT_TAX;
  if (cfg.enabled === false) {
    return { amount: 0, basis: { skipped: true } };
  }
  const n = Math.max(1, Math.round(num(periods, 12)));
  const annualIncome = round2(num(periodIncome, 0) * n);
  const expenses = round2(Math.min(
    (annualIncome * num(cfg.expense_rate_percent, DEFAULT_TAX.expense_rate_percent)) / 100,
    num(cfg.expense_cap, DEFAULT_TAX.expense_cap)
  ));

  const a = allowances && typeof allowances === "object" ? allowances : {};
  const ssoYear = Math.min(
    round2(num(ssoPerPeriod, 0) * n),
    num(cfg.sso_allowance_cap, DEFAULT_TAX.sso_allowance_cap)
  );
  const allowanceTotal = round2(
    num(cfg.personal_allowance, DEFAULT_TAX.personal_allowance)
    + (a.spouse ? num(cfg.spouse_allowance, DEFAULT_TAX.spouse_allowance) : 0)
    + Math.max(0, Math.round(num(a.children, 0))) * num(cfg.child_allowance, DEFAULT_TAX.child_allowance)
    + Math.max(0, Math.round(num(a.parents, 0))) * num(cfg.parent_allowance, DEFAULT_TAX.parent_allowance)
    + ssoYear
    + Math.max(0, num(a.other, 0))
  );

  const netIncome = Math.max(0, round2(annualIncome - expenses - allowanceTotal));
  const annualTax = progressiveTax(netIncome, cfg.brackets);
  return {
    amount: round2(annualTax / n),
    basis: {
      periods: n,
      annual_income: annualIncome,
      expenses,
      allowances_total: allowanceTotal,
      sso_allowance: ssoYear,
      net_income: netIncome,
      annual_tax: annualTax,
    },
  };
}

// ── หนึ่งบรรทัดของรอบจ่าย ──────────────────────────────────────────────────
// คืน `incomplete` เมื่อยังคำนวณให้จบไม่ได้ (เช่น ลูกจ้างรายวันที่ยังไม่กรอก
// จำนวนวัน) — ตัวรอบใช้ธงนี้บล็อกการอนุมัติ **การอนุมัติรอบที่ยังไม่ครบคือ
// การจ่ายเงินผิดจำนวน ซึ่งเรียกคืนยากกว่าการรอ**
function buildPayrollItem({ employee, priv, config, period, input }) {
  const cfg = config || resolvePayrollConfig({});
  const emp = employee || {};
  const p = priv || {};
  const pay = p.pay || {};
  const inp = input || {};
  const type = String(emp.employment_type || "").toLowerCase();

  // ฟรีแลนซ์/ไรเดอร์ไม่เข้ารอบเงินเดือน — เขาถูกจ่ายผ่านกระเป๋าเงินและถูกหัก
  // 3% ตอนถอนอยู่แล้ว (functions/rider-wht.js) การใส่เข้ามาที่นี่คือการจ่ายซ้ำ
  if (type === "freelance") {
    return { skipped: "freelance", earnings: [], deductions: [], gross: 0, net: 0 };
  }

  const earnings = [];
  let incomplete = null;

  if (type === "daily") {
    const rate = num(pay.daily_rate, 0);
    const days = inp.days_worked;
    if (days == null || days === "") {
      incomplete = "ต้องกรอกจำนวนวันทำงาน";
    } else {
      earnings.push({
        label: "ค่าแรงรายวัน",
        amount: round2(rate * Math.max(0, num(days, 0))),
        taxable: true, sso_wage: true,
        note: `${num(days, 0)} วัน x ${rate}`,
      });
    }
    if (rate <= 0) incomplete = incomplete || "ยังไม่ได้ตั้งค่าแรงรายวัน";
  } else {
    const baseSalary = num(pay.base_salary, 0);
    if (baseSalary <= 0) incomplete = "ยังไม่ได้ตั้งเงินเดือน";
    const pro = proratedBase({
      baseSalary,
      from: period.from, to: period.to,
      hiredAt: emp.hired_at, terminatedAt: emp.terminated_at,
      divisor: cfg.payroll.prorate_divisor,
    });
    earnings.push({
      label: "เงินเดือน",
      amount: pro.amount,
      taxable: true, sso_wage: true,
      note: pro.full ? null : `คิดตามสัดส่วน ${pro.days} วัน (หาร ${cfg.payroll.prorate_divisor})`,
    });
  }

  for (const a of Array.isArray(pay.allowances) ? pay.allowances : []) {
    if (a && a.recurring === false) continue;
    earnings.push({
      label: a.label, amount: round2(num(a.amount, 0)),
      taxable: a.taxable !== false, sso_wage: true,
    });
  }
  for (const e of Array.isArray(inp.extra_earnings) ? inp.extra_earnings : []) {
    earnings.push({
      label: String(e && e.label || "รายการเพิ่ม"),
      amount: round2(num(e && e.amount, 0)),
      taxable: !(e && e.taxable === false),
      // รายการครั้งเดียว (โบนัส เบี้ยขยัน) ไม่ใช่ "ค่าจ้าง" โดยอัตโนมัติ
      // ต้องติ๊กเอง ถ้าจะให้เข้าฐานประกันสังคม
      sso_wage: Boolean(e && e.sso_wage),
    });
  }

  const gross = round2(earnings.reduce((s, e) => s + num(e.amount, 0), 0));
  const taxableIncome = round2(earnings.filter((e) => e.taxable).reduce((s, e) => s + num(e.amount, 0), 0));
  const ssoWage = round2(earnings.filter((e) => e.sso_wage).reduce((s, e) => s + num(e.amount, 0), 0));

  const sso = computeSso(ssoWage, cfg.social_security);
  const wht = computeWithholding({
    periodIncome: taxableIncome,
    periods: period.periods,
    ssoPerPeriod: sso.employee,
    allowances: p.tax || {},
    tax: cfg.income_tax,
  });

  const deductions = [];
  if (sso.employee > 0) {
    deductions.push({ label: "ประกันสังคม", amount: sso.employee, type: "sso" });
  }
  if (wht.amount > 0) {
    deductions.push({ label: "ภาษีหัก ณ ที่จ่าย", amount: wht.amount, type: "wht" });
  }
  for (const d of Array.isArray(inp.extra_deductions) ? inp.extra_deductions : []) {
    deductions.push({
      label: String(d && d.label || "รายการหัก"),
      amount: round2(num(d && d.amount, 0)),
      type: "other",
    });
  }

  const deductTotal = round2(deductions.reduce((s, d) => s + num(d.amount, 0), 0));

  // ช่องทางจ่ายมาจาก "มีเลขบัญชีไหม" ไม่ใช่ฟิลด์ที่ต้องมากรอกซ้ำ
  //
  // เก็บเลขบัญชีแบบ mask เท่านั้นในบรรทัดนี้ — เลขเต็มอยู่ที่ employees_private
  // ที่เดียว การก๊อปมาไว้ในทุกรอบทุกเดือนคือการเพิ่มที่ที่ข้อมูลธนาคารอยู่
  // โดยไม่ได้เพิ่มความสามารถอะไร (ตอนทำไฟล์โอนจริงค่อยอ่านจากต้นทาง)
  const account = String((p.bank && p.bank.account) || "").replace(/\s|-/g, "");
  const payMethod = account ? "transfer" : "cash";

  return {
    employee_id: emp.id || null,
    employee_code: emp.employee_code || null,
    pay_method: payMethod,
    bank_name: (p.bank && p.bank.name) || null,
    bank_masked: account ? `••••${account.slice(-4)}` : null,
    name: emp.name || null,
    employment_type: type,
    earnings,
    deductions,
    gross,
    taxable_income: taxableIncome,
    sso_wage: ssoWage,
    sso_employee: sso.employee,
    sso_employer: sso.employer,
    wht: wht.amount,
    wht_basis: wht.basis,
    net: round2(gross - deductTotal),
    days_worked: inp.days_worked == null ? null : num(inp.days_worked, 0),
    note: String(inp.note || "").slice(0, 300) || null,
    incomplete,
  };
}

function summarizeRun(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && !i.skipped);
  const sum = (f) => round2(list.reduce((s, i) => s + num(i[f], 0), 0));
  return {
    headcount: list.length,
    gross: sum("gross"),
    wht: sum("wht"),
    sso_employee: sum("sso_employee"),
    sso_employer: sum("sso_employer"),
    net: sum("net"),
    // ต้นทุนจริงของบริษัท = ที่จ่ายลูกจ้าง + เงินสมทบฝั่งนายจ้าง
    // ยอดโอนสุทธิไม่ใช่ตัวเลขที่ควรเอาไปคิดต้นทุน เพราะมันคือยอดหลังหักภาษี
    // และประกันสังคมที่บริษัทถือไว้นำส่งแทน ไม่ใช่เงินที่บริษัทประหยัดได้
    employer_cost: round2(sum("gross") + sum("sso_employer")),
    // แยกตามช่องทางจ่ายเพื่อให้กระทบยอดกับสลิปโอนได้
    transfer: round2(list.filter((i) => i.pay_method !== "cash").reduce((s2, i) => s2 + num(i.net, 0), 0)),
    cash: round2(list.filter((i) => i.pay_method === "cash").reduce((s2, i) => s2 + num(i.net, 0), 0)),
    incomplete: list.filter((i) => i.incomplete).length,
  };
}

module.exports = {
  DEFAULT_TAX,
  DEFAULT_ADJUSTMENT_PRESETS,
  DEFAULT_SSO,
  DEFAULT_PAYROLL,
  resolvePayrollConfig,
  bangkokMidnight,
  periodBounds,
  payDateOf,
  periodsInYear,
  proratedBase,
  computeSso,
  progressiveTax,
  computeWithholding,
  buildPayrollItem,
  summarizeRun,
  round2,
};
