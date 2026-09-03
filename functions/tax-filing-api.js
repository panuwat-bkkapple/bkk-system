// =============================================================================
// ปฏิทินกำหนดยื่นแบบ — callable (ข้อ 3 ของแผน HR)
//
// รวมยอดจากสามที่ที่ระบบเขียนไว้อยู่แล้ว **ไม่คิดเลขใหม่เอง**:
//   * `payroll_runs/{งวด}/totals` → ภ.ง.ด.1 + เงินสมทบประกันสังคม
//   * `wht_certificates` (query ตาม period) → ภ.ง.ด.3 ของไรเดอร์
//   * `accounting_documents` (query ตาม period) → ภ.พ.30
//
// **จัดกลุ่ม ภ.ง.ด.1 ตามวันจ่ายเงิน ไม่ใช่ตามชื่องวด** — หน้าที่นำส่งเกิดเมื่อ
// จ่ายเงิน กติกาเดียวกับที่ใช้ตัดปีภาษีใน hr-tax-year.js ถ้าวันหนึ่งย้ายวันจ่าย
// ไปต้นเดือนถัดไป งวดธันวาคมจะต้องนำส่งในรอบมกราคม
//
// **นับเฉพาะรอบที่จ่ายแล้ว** ด้วยเหตุผลเดียวกับ 50 ทวิ — ยังไม่จ่าย ยังไม่หัก
// ยังไม่มีอะไรต้องนำส่ง
//
// `tax_filings` ไม่มี rule ของตัวเอง = ตกกฎ root `.read/.write: false` client
// อ่าน/เขียนไม่ได้ ต้องผ่าน callable ที่ gate ด้วย role **ไม่ต้อง deploy rules**
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const {
  FORMS, bangkokPeriod, nextMonthOf, buildPeriodRows, buildAnnualRow, round2,
} = require("./tax-filing-calendar");

const REGION = "asia-southeast1";

// หน้ายื่นแบบเป็นงานการเงิน/บัญชี ไม่ใช่งานทะเบียนพนักงาน — ตัวเลขบนหน้านี้
// รวมภาษีขายกับค่าตอบแทนไรเดอร์ด้วย จึงใช้สิทธิ์ชุดเดียวกับ /vat-report และ
// /wht-report ที่มีอยู่แล้ว ไม่ใช่ HR_ROLES
const FILING_ROLES = ["CEO", "FINANCE"];

/** งวดย้อนหลัง n เดือนนับจากงวดปัจจุบัน (ใหม่ไปเก่า) */
function recentPeriods(now, n) {
  const out = [];
  let cur = bangkokPeriod(now);
  for (let i = 0; i < n; i++) {
    out.push(cur);
    const y = Number(cur.slice(0, 4));
    const m = Number(cur.slice(4, 6));
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    cur = `${prev.y}${String(prev.m).padStart(2, "0")}`;
  }
  return out;
}

/** ยอดของแต่ละงวดจากรอบเงินเดือนที่จ่ายแล้ว — คีย์ตามเดือนที่จ่ายจริง */
function payrollByPayMonth(runsVal) {
  const out = {};
  for (const [id, run] of Object.entries(runsVal || {})) {
    if (!run || run.status !== "paid") continue;
    const at = Number(run.pay_date) || 0;
    if (!at) continue;
    const p = bangkokPeriod(at);
    const t = run.totals || {};
    const bucket = out[p] || { wht: 0, sso: 0, headcount: 0, runs: [] };
    bucket.wht = round2(bucket.wht + (Number(t.wht) || 0));
    bucket.sso = round2(bucket.sso + (Number(t.sso_employee) || 0) + (Number(t.sso_employer) || 0));
    bucket.headcount += Number(t.headcount) || 0;
    bucket.runs.push(id);
    out[p] = bucket;
  }
  return out;
}

// ตัวรวมยอดแยกออกมาเป็นฟังก์ชันล้วนที่รับ "รายการเอกสาร" ไม่ใช่ snapshot —
// เพื่อให้เทสขับมันด้วยข้อมูลจริงได้โดยไม่ต้องมี Firebase ด่านที่ตรวจได้แค่
// ว่าซอร์สมีคำว่า void อยู่ ไม่ได้พิสูจน์ว่าเอกสารที่ยกเลิกถูกกันออกจริง
function sumRiderWhtFrom(list) {
  let total = 0;
  for (const v of list || []) {
    if (!v || v.status === "void") continue;
    total += Number(v.wht) || 0;
  }
  return round2(total);
}

function sumOutputVatFrom(list) {
  let total = 0;
  for (const v of list || []) {
    if (!v || v.status === "void") continue;
    // ใบลดหนี้หักออกจากภาษีขายของงวด — กติกาเดียวกับหน้า /vat-report
    if (v.type === "tax_invoice") total += Number(v.vat) || 0;
    else if (v.type === "credit_note") total -= Number(v.vat) || 0;
  }
  return round2(total);
}

const snapshotList = (snap) => {
  const out = [];
  snap.forEach((c) => { out.push(c.val() || {}); return false; });
  return out;
};

async function sumRiderWht(db, period) {
  const snap = await db.ref("wht_certificates").orderByChild("period").equalTo(period).once("value");
  return sumRiderWhtFrom(snapshotList(snap));
}

async function sumOutputVat(db, period) {
  const snap = await db.ref("accounting_documents").orderByChild("period").equalTo(period).once("value");
  return sumOutputVatFrom(snapshotList(snap));
}

function registerTaxFiling() {
  // -------------------------------------------------------------------------
  // adminTaxFilingCalendar — ค้างอะไร เท่าไหร่ ถึงเมื่อไหร่
  // -------------------------------------------------------------------------
  const adminTaxFilingCalendar = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, FILING_ROLES);
    const months = Math.min(Math.max(Math.round(Number((request.data || {}).months) || 6), 1), 24);
    const now = Date.now();

    const [runsSnap, filingsSnap] = await Promise.all([
      db.ref("payroll_runs").once("value"),
      db.ref("tax_filings").once("value"),
    ]);
    const filings = filingsSnap.val() || {};
    const payroll = payrollByPayMonth(runsSnap.val());

    const periods = recentPeriods(now, months);
    const rows = [];
    for (const period of periods) {
      const [riderWht, outputVat] = await Promise.all([
        sumRiderWht(db, period),
        sumOutputVat(db, period),
      ]);
      const pay = payroll[period] || { wht: 0, sso: 0, headcount: 0, runs: [] };
      rows.push(...buildPeriodRows({
        period,
        facts: {
          pnd1: { amount: pay.wht, activity: pay.headcount > 0, note: pay.runs.length ? `จากรอบ ${pay.runs.join(" ")}` : null },
          sso: { amount: pay.sso, activity: pay.headcount > 0, note: pay.runs.length ? `ลูกจ้าง+นายจ้าง จากรอบ ${pay.runs.join(" ")}` : null },
          pnd3: { amount: riderWht, activity: riderWht > 0 },
          pp30: { amount: outputVat, activity: true },
        },
        filings,
        now,
      }));
    }

    // ปีภาษีที่แล้ว — ภ.ง.ด.1ก ยื่นภายในเดือนกุมภาพันธ์ของปีถัดไป จึงต้องขึ้น
    // ให้เห็นตั้งแต่ต้นปี ไม่ใช่รอให้ถึงกำหนดแล้วค่อยโผล่
    const lastTaxYear = new Date(now + 7 * 3600 * 1000).getUTCFullYear() - 1;
    let annualWht = 0, annualHeadcount = 0;
    for (const [, run] of Object.entries(runsSnap.val() || {})) {
      if (!run || run.status !== "paid") continue;
      const at = Number(run.pay_date) || 0;
      if (!at) continue;
      if (new Date(at + 7 * 3600 * 1000).getUTCFullYear() !== lastTaxYear) continue;
      annualWht = round2(annualWht + (Number((run.totals || {}).wht) || 0));
      annualHeadcount += Number((run.totals || {}).headcount) || 0;
    }
    rows.push(buildAnnualRow({
      gregorianTaxYear: lastTaxYear, amount: annualWht,
      activity: annualHeadcount > 0, filings, now,
    }));

    const overdue = rows.filter((r) => r.status === "overdue").length;
    console.log(`[tax-filing] calendar months=${months} rows=${rows.length} overdue=${overdue}`);
    return { now, rows, forms: FORMS };
  });

  // -------------------------------------------------------------------------
  // adminTaxFilingMark — กด "ยื่นแล้ว" / ยกเลิกการกด
  // -------------------------------------------------------------------------
  const adminTaxFilingMark = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, caller } = await requireStaffRole(db, request.auth, FILING_ROLES);
    const data = request.data || {};
    const form = String(data.form || "");
    const period = String(data.period || "");
    if (!Object.prototype.hasOwnProperty.call(FORMS, form) && form !== "pnd1k") {
      throw new HttpsError("invalid-argument", "ไม่รู้จักแบบนี้");
    }
    if (!/^\d{4}(\d{2})?$/.test(period)) {
      throw new HttpsError("invalid-argument", "งวดต้องเป็น YYYYMM หรือ YYYY");
    }

    const key = `${form}_${period}`;
    const ref = db.ref(`tax_filings/${key}`);
    if (data.filed === false) {
      // ยกเลิกได้ เพราะกดผิดแถวเกิดขึ้นจริง — แต่ทิ้งร่องรอยไว้ว่าใครยกเลิก
      // เมื่อไหร่ การลบเงียบๆ ทำให้ประวัติการยื่นอธิบายตัวเองไม่ได้
      const before = (await ref.once("value")).val();
      await ref.set(null);
      if (before) {
        await db.ref(`tax_filings_log/${key}_${Date.now()}`).set({
          ...before, unmarked_at: Date.now(),
          unmarked_by: (caller && caller.name) || callerStaffId || null,
        });
      }
      console.log(`[tax-filing] unmark ${key} by=${callerStaffId || "?"}`);
      return { key, filed: false };
    }

    const record = {
      form, period,
      filed_at: Date.now(),
      filed_by: (caller && caller.name) || callerStaffId || null,
      filed_by_staff_id: callerStaffId || null,
      reference: String(data.reference || "").slice(0, 120) || null,
      note: String(data.note || "").slice(0, 300) || null,
    };
    await ref.set(record);
    console.log(`[tax-filing] mark ${key} by=${callerStaffId || "?"} ref=${record.reference || "-"}`);
    return { key, filed: true, record };
  });

  return { adminTaxFilingCalendar, adminTaxFilingMark };
}

module.exports = {
  registerTaxFiling, FILING_ROLES, recentPeriods, payrollByPayMonth,
  sumRiderWhtFrom, sumOutputVatFrom,
};
