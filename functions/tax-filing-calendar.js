// =============================================================================
// ปฏิทินกำหนดยื่นแบบ — ตัวคิดล้วน ไม่มี I/O (ข้อ 3 ของแผน HR)
//
// **ปัญหาที่หน้านี้แก้ ไม่ใช่ "ไม่รู้ว่าต้องยื่นอะไร" แต่คือ "ไม่รู้ว่ายื่นไป
// แล้วหรือยัง"** — ระบบออกเลขที่เอกสารและรู้ยอดทุกก้อนอยู่แล้ว สิ่งที่ไม่มีคือ
// ที่ที่บอกว่าเดือนนี้ค้างอะไร. เงินที่หักไว้ไม่ใช่ของบริษัท มันนอนอยู่ในบัญชี
// จนกว่าจะมีคนจำได้ว่าต้องนำส่ง ยื่นช้า = เบี้ยปรับ+เงินเพิ่ม
//
// **เพราะอย่างนั้นหน้านี้ต้องกดว่า "ยื่นแล้ว" ได้** — ตัวเตือนที่รับทราบไม่ได้
// จะเตือนซ้ำทุกวันจนคนเลิกอ่าน แล้วก็จะพลาดตัวที่ค้างจริงพอดี
//
// **สิ่งที่ตัวนี้ไม่ทำ และต้องบอกไว้ให้ตรง:**
//   * ไม่เลื่อนวันเมื่อกำหนดตรงกับเสาร์-อาทิตย์หรือวันหยุดราชการ — ปฏิทินวันหยุด
//     ของราชการไม่ได้อยู่ในระบบนี้ การเดาเองแล้วเลื่อนให้ช้ากว่าจริงคือการ
//     ทำให้คนยื่นสาย **วันที่แสดงจึงเป็นวันตามกฎหมาย ซึ่งเร็วกว่าหรือเท่ากับ
//     กำหนดจริงเสมอ** = ผิดไปในทางที่ปลอดภัย
//   * ไม่รู้เรื่องการขยายเวลาของการยื่นออนไลน์ — ด้วยเหตุผลเดียวกัน
//   * ไม่ยื่นให้ ไม่สร้างไฟล์ e-filing — มันบอกว่า "ค้างอะไร เท่าไหร่ ถึงเมื่อไหร่"
// =============================================================================

const BKK_OFFSET_MS = 7 * 3600 * 1000;

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const round2 = (n) => Math.round((num(n, 0) + Number.EPSILON) * 100) / 100;

/** งวด YYYYMM ตามเวลาไทยของ timestamp หนึ่ง */
function bangkokPeriod(ms) {
  const d = new Date(num(ms, 0) + BKK_OFFSET_MS);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ต้นวันตามเวลาไทยเป็น epoch */
const bangkokMidnight = (y, m, d) => Date.UTC(y, m - 1, d) - BKK_OFFSET_MS;

/** สิ้นวันตามเวลาไทย — กำหนดยื่นหมดตอนสิ้นวันนั้น ไม่ใช่เที่ยงคืนต้นวัน */
const bangkokEndOfDay = (y, m, d) => bangkokMidnight(y, m, d) + 24 * 3600 * 1000 - 1;

/**
 * แบบที่ระบบนี้มีตัวเลขให้ — ไม่ใส่แบบที่เราไม่มีข้อมูล เพราะรายการที่ขึ้นว่า
 * "0 บาท" ทั้งที่ระบบไม่เคยรู้ยอดของมัน คือคำโกหกที่ดูเหมือนการตรวจสอบ
 *
 *   day  = วันที่ครบกำหนดของเดือนถัดจากงวด
 *   zero = ต้องยื่นไหมเมื่อยอดเป็นศูนย์
 *            'if_activity' = ยื่นถ้าเดือนนั้นมีการจ่าย/มีลูกจ้าง แม้ภาษีเป็น 0
 *            'always'      = ยื่นทุกเดือนตราบใดที่ยังจดทะเบียนอยู่
 *            'if_amount'   = ไม่มียอด = ไม่ต้องยื่น
 */
const FORMS = {
  pnd1: {
    label: "ภ.ง.ด.1",
    detail: "ภาษีหัก ณ ที่จ่าย เงินเดือนลูกจ้าง (ม.40(1))",
    authority: "กรมสรรพากร",
    day: 7,
    zero: "if_activity",
  },
  pnd3: {
    label: "ภ.ง.ด.3",
    detail: "ภาษีหัก ณ ที่จ่าย ค่าตอบแทนไรเดอร์ (ม.40(8))",
    authority: "กรมสรรพากร",
    day: 7,
    zero: "if_amount",
  },
  sso: {
    label: "เงินสมทบประกันสังคม",
    detail: "แบบ สปส.1-10 ส่วนของลูกจ้าง + นายจ้าง",
    authority: "สำนักงานประกันสังคม",
    day: 15,
    zero: "if_activity",
  },
  pp30: {
    label: "ภ.พ.30",
    detail: "ภาษีมูลค่าเพิ่ม (ภาษีขาย)",
    authority: "กรมสรรพากร",
    day: 15,
    zero: "always",
  },
};

/** เดือนถัดจากงวด YYYYMM */
function nextMonthOf(period) {
  const y = Number(String(period).slice(0, 4));
  const m = Number(String(period).slice(4, 6));
  if (!y || !m) return null;
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/** กำหนดยื่นของแบบรายเดือน — วันที่ N ของเดือนถัดไป สิ้นวันเวลาไทย */
function monthlyDeadline(period, day) {
  const n = nextMonthOf(period);
  return n ? bangkokEndOfDay(n.y, n.m, day) : null;
}

/**
 * กำหนดยื่น ภ.ง.ด.1ก — ภายในเดือนกุมภาพันธ์ของปีถัดจากปีภาษี
 * ใช้วันสุดท้ายของเดือนกุมภาพันธ์ (คิดจากปฏิทินจริง ปีอธิกสุรทินได้ 29)
 */
function annualDeadline(gregorianTaxYear) {
  const y = Math.round(num(gregorianTaxYear, 0)) + 1;
  const lastFeb = new Date(Date.UTC(y, 2, 0)).getUTCDate(); // วันที่ 0 ของ มี.ค. = วันสุดท้าย ก.พ.
  return bangkokEndOfDay(y, 2, lastFeb);
}

const DUE_SOON_MS = 7 * 24 * 3600 * 1000;

/**
 * สถานะของรายการหนึ่ง
 *
 * `filed` มาก่อนทุกอย่าง — รายการที่ยื่นแล้วต้องไม่ขึ้นแดงอีก ไม่งั้นคนจะเลิก
 * อ่านทั้งหน้า
 */
function statusOf({ required, filed, deadline, now }) {
  if (filed) return "filed";
  if (!required) return "not_required";
  if (deadline == null) return "unknown";
  if (now > deadline) return "overdue";
  if (deadline - now <= DUE_SOON_MS) return "due_soon";
  return "upcoming";
}

/** ต้องยื่นไหม — ตัดสินจากกฎ zero ของแบบนั้น ไม่ใช่จาก "ยอดมากกว่าศูนย์" */
function isRequired(form, { amount, activity }) {
  const rule = FORMS[form].zero;
  if (rule === "always") return true;
  if (rule === "if_activity") return Boolean(activity) || num(amount, 0) > 0;
  return num(amount, 0) > 0;
}

/**
 * รายการที่ต้องยื่นของงวดหนึ่ง
 *
 * @param period   'YYYYMM'
 * @param facts    { pnd1:{amount,activity}, pnd3:{...}, sso:{...}, pp30:{...} }
 * @param filings  { 'pnd1_202609': { filed_at, ... } }
 * @param now      epoch
 */
function buildPeriodRows({ period, facts, filings, now }) {
  return Object.keys(FORMS).map((form) => {
    const f = (facts && facts[form]) || {};
    const key = `${form}_${period}`;
    const filed = (filings && filings[key]) || null;
    const deadline = monthlyDeadline(period, FORMS[form].day);
    const required = isRequired(form, f);
    return {
      key,
      form,
      period,
      label: FORMS[form].label,
      detail: FORMS[form].detail,
      authority: FORMS[form].authority,
      amount: round2(f.amount),
      note: f.note || null,
      required,
      deadline,
      filed: filed ? { at: num(filed.filed_at, 0) || null, by: filed.filed_by || null, reference: filed.reference || null } : null,
      status: statusOf({ required, filed: Boolean(filed), deadline, now }),
    };
  });
}

/** แถวรายปี ภ.ง.ด.1ก ของปีภาษีหนึ่ง */
function buildAnnualRow({ gregorianTaxYear, amount, activity, filings, now }) {
  const period = `${gregorianTaxYear}`;
  const key = `pnd1k_${period}`;
  const filed = (filings && filings[key]) || null;
  const deadline = annualDeadline(gregorianTaxYear);
  const required = Boolean(activity) || num(amount, 0) > 0;
  return {
    key,
    form: "pnd1k",
    period,
    label: "ภ.ง.ด.1ก",
    detail: `สรุปภาษีหัก ณ ที่จ่ายเงินเดือนทั้งปี ${gregorianTaxYear + 543}`,
    authority: "กรมสรรพากร",
    amount: round2(amount),
    note: null,
    required,
    deadline,
    filed: filed ? { at: num(filed.filed_at, 0) || null, by: filed.filed_by || null, reference: filed.reference || null } : null,
    status: statusOf({ required, filed: Boolean(filed), deadline, now }),
  };
}

module.exports = {
  FORMS,
  bangkokPeriod,
  bangkokEndOfDay,
  nextMonthOf,
  monthlyDeadline,
  annualDeadline,
  isRequired,
  statusOf,
  buildPeriodRows,
  buildAnnualRow,
  round2,
  DUE_SOON_MS,
};
