// การลา — สิทธิ์ ยอดคงเหลือ และการแยกวันที่ได้ค่าจ้างออกจากวันที่ไม่ได้
//
// **ไฟล์นี้ไม่แตะเงินของใคร** และนั่นเป็นการตัดสินใจ ไม่ใช่ของที่ยังทำไม่เสร็จ
// รอบจ่ายเงินเดือนวันนี้ไม่รู้จักการลาเลย การเปิดฟีเจอร์นี้พร้อมกับต่อสาย
// เข้ารอบจ่ายในคราวเดียว แปลว่ารอบแรกหลัง deploy ยอดของทุกคนขยับพร้อมกัน
// โดยไม่มีใครเคยเห็นตัวเลขมาก่อน — สิ่งที่ต้องมาก่อนคือให้ HR ได้เห็นวันลา
// ที่ระบบนับได้ แล้วเทียบกับที่ตัวเองรู้ ก่อนที่ตัวเลขนั้นจะกลายเป็นเงิน
// (การต่อสายเข้ารอบจ่ายเป็นงานรอบถัดไป และต้องโผล่เป็นบรรทัด `absence`
// ที่มีชื่อ ไม่ใช่การหักที่ซ่อนอยู่ในยอดรวม)
//
// ─── ฐานกฎหมาย: พ.ร.บ.คุ้มครองแรงงาน พ.ศ. 2541 ───────────────────────────
// ตัวเลขในตารางข้างล่างเป็น **ขั้นต่ำตามกฎหมาย** ไม่ใช่เพดาน นายจ้างให้มากกว่า
// ได้เสมอ ค่าที่ตั้งเองจึงทับได้ **แต่ตั้งต่ำกว่าขั้นต่ำไม่ได้เงียบๆ** —
// `policyWarnings` จะบอก เพราะสัญญาจ้างที่ให้สิทธิ์ต่ำกว่ากฎหมายเป็นโมฆะ
// เฉพาะส่วนนั้น (ม.14/1) และคนที่ตั้งค่าไม่ใช่คนที่อ่านกฎหมาย

"use strict";

/**
 * ชนิดการลาที่ระบบรู้จัก
 *
 * `paid_days` = จำนวนวันที่**นายจ้างจ่ายค่าจ้าง**ต่อปี ไม่ใช่จำนวนวันที่ลาได้
 * สองอย่างนี้ต่างกันมากสำหรับลาป่วย: ม.32 ให้ลาได้ **เท่าที่ป่วยจริง** (ไม่มี
 * เพดาน) ส่วน ม.57 บอกว่าจ่ายไม่เกิน 30 วันทำงาน วันที่ 31 ขึ้นไปจึงลาได้
 * แต่ไม่ได้เงิน **ห้ามเอา 30 ไปใช้เป็นเพดานการลา** เพราะนั่นคือการบังคับให้
 * คนป่วยมาทำงาน
 */
const LEAVE_TYPES = [
  {
    id: "sick",
    label: "ลาป่วย",
    paid_days: 30,
    statutory_paid_min: 30,
    // ลาได้ไม่จำกัดตามที่ป่วยจริง (ม.32) — เพดานมีแค่ฝั่งค่าจ้าง
    capped: false,
    counts: "working_days",
    doc_required_after: 3, // ม.32 วรรคสอง: ป่วยตั้งแต่ 3 วันทำงานขึ้นไป
    basis: "ม.32 / ม.57 วรรคหนึ่ง",
  },
  {
    id: "personal",
    label: "ลากิจธุระอันจำเป็น",
    paid_days: 3,
    statutory_paid_min: 3,
    capped: true,
    counts: "working_days",
    doc_required_after: null,
    basis: "ม.34 / ม.57/1",
  },
  {
    id: "annual",
    label: "วันหยุดพักผ่อนประจำปี",
    paid_days: 6,
    statutory_paid_min: 6,
    capped: true,
    counts: "working_days",
    doc_required_after: null,
    // ม.30: สิทธิ์เกิดเมื่อทำงานครบหนึ่งปี
    requires_service_years: 1,
    basis: "ม.30",
  },
  {
    id: "maternity",
    label: "ลาคลอดบุตร",
    paid_days: 45,
    statutory_paid_min: 45,
    max_days: 98,
    capped: true,
    // ม.41 นับ "รวมวันหยุด" — ลาคลอดจึงนับวันปฏิทิน ไม่ใช่วันทำงาน
    counts: "calendar_days",
    doc_required_after: null,
    basis: "ม.41 / ม.59",
  },
  {
    id: "sterilization",
    label: "ลาเพื่อทำหมัน",
    // ม.33 ให้ลาตามที่แพทย์กำหนด และ ม.57 วรรคสองให้จ่ายค่าจ้างตามนั้น
    // ไม่มีตัวเลขในกฎหมาย จึงไม่มีเพดานให้ตั้ง
    paid_days: null,
    statutory_paid_min: null,
    capped: false,
    counts: "working_days",
    doc_required_after: null,
    basis: "ม.33 / ม.57 วรรคสอง",
  },
  {
    id: "military",
    label: "ลารับราชการทหาร",
    paid_days: 60,
    statutory_paid_min: 60,
    capped: false,
    counts: "calendar_days",
    doc_required_after: null,
    basis: "ม.35 / ม.58",
  },
  {
    id: "training",
    label: "ลาเพื่อฝึกอบรม",
    // ม.36 ไม่ได้กำหนดให้จ่ายค่าจ้าง
    paid_days: 0,
    statutory_paid_min: 0,
    capped: false,
    counts: "working_days",
    doc_required_after: null,
    basis: "ม.36",
  },
  {
    id: "unpaid",
    label: "ลาไม่รับค่าจ้าง",
    paid_days: 0,
    statutory_paid_min: 0,
    capped: false,
    counts: "working_days",
    doc_required_after: null,
    basis: null,
  },
];

const LEAVE_TYPE_IDS = LEAVE_TYPES.map((t) => t.id);

const REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"];

/** สถานะที่ยังกินสิทธิ์อยู่ — ใบที่ปฏิเสธหรือยกเลิกแล้วต้องคืนสิทธิ์ */
const CONSUMING_STATUSES = ["pending", "approved"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);

/** แปลง YYYY-MM-DD เป็นเลขวัน (UTC) — สร้างเองทั้งหมด ไม่ผ่าน Date.parse
 *  เพราะ `new Date("2026-09-04")` ตีความเป็น UTC แต่ `new Date("2026/09/04")`
 *  ตีความเป็นเวลาท้องถิ่น การพึ่ง parser จึงให้ผลต่างกันตาม TZ ของเครื่อง */
function dayNumber(iso) {
  if (!DATE_RE.test(String(iso || ""))) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // ปฏิเสธวันที่ที่ไม่มีจริง (31 ก.พ. จะถูก Date.UTC ม้วนไปเป็น 3 มี.ค.)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.floor(t / 86400000);
}

const isoOf = (dayNum) => new Date(dayNum * 86400000).toISOString().slice(0, 10);

/** 0 = อาทิตย์ ... 6 = เสาร์ — ตรงกับรูปของ `closedDays` ใน business_hours */
const weekdayOf = (dayNum) => new Date(dayNum * 86400000).getUTCDay();

/**
 * ปฏิทินทำงานของร้าน
 *
 * อ่านจาก `settings/store/business_hours` ตัวเดียวกับที่หน้า checkout ของลูกค้า
 * ใช้ **ไม่สร้างปฏิทินวันหยุดชุดที่สอง** — วันที่ร้านปิดคือวันที่ร้านปิด
 * ถ้าแยกสองชุดเมื่อไหร่ วันหยุดที่ประกาศให้ลูกค้ากับวันหยุดที่ใช้นับวันลา
 * จะเดินคนละทางโดยไม่มีใครเห็น
 */
function normalizeCalendar(businessHours) {
  const b = businessHours || {};
  const closed = Array.isArray(b.closedDays)
    ? b.closedDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  const holidays = Array.isArray(b.holidays)
    ? b.holidays.map((h) => str(h, 10)).filter((h) => DATE_RE.test(h))
    : [];
  return { closedDays: new Set(closed), holidays: new Set(holidays) };
}

/** วันนั้นเป็นวันทำงานไหม (ไม่ใช่วันหยุดประจำสัปดาห์ และไม่ใช่วันหยุดประกาศ) */
function isWorkingDay(dayNum, calendar) {
  const cal = calendar || { closedDays: new Set(), holidays: new Set() };
  if (cal.closedDays.has(weekdayOf(dayNum))) return false;
  if (cal.holidays.has(isoOf(dayNum))) return false;
  return true;
}

const MAX_SPAN_DAYS = 366;

/**
 * นับวันลาในช่วง from..to (รวมปลายทั้งสองข้าง)
 *
 * คืน `null` เมื่ออินพุตใช้ไม่ได้ — **ห้ามคืน 0** เพราะ 0 อ่านว่า "ลาศูนย์วัน"
 * ซึ่งเป็นคำตอบที่ผ่านการตรวจต่อไปได้ ส่วน null บังคับให้คนเรียกจัดการ
 */
function countLeaveDays({ from, to, counts, calendar }) {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a == null || b == null || b < a) return null;
  if (b - a + 1 > MAX_SPAN_DAYS) return null;
  if (counts === "calendar_days") return b - a + 1;
  let n = 0;
  for (let d = a; d <= b; d += 1) if (isWorkingDay(d, calendar)) n += 1;
  return n;
}

/** หาชนิดการลาจาก id — คืน `null` ถ้าไม่รู้จัก (ห้าม fallback เป็นชนิดใดชนิดหนึ่ง) */
function leaveTypeById(id, overrides) {
  const base = LEAVE_TYPES.find((t) => t.id === str(id, 40));
  if (!base) return null;
  const o = (overrides || {})[base.id] || {};
  const out = { ...base };
  if (o.paid_days != null && Number.isFinite(Number(o.paid_days))) {
    out.paid_days = Math.max(0, Number(o.paid_days));
  }
  if (o.label) out.label = str(o.label, 60);
  return out;
}

/** ชนิดการลาทั้งหมดหลังใช้ค่าที่ตั้งเองทับแล้ว */
function resolveLeaveTypes(overrides) {
  return LEAVE_TYPE_IDS.map((id) => leaveTypeById(id, overrides));
}

/**
 * สิทธิ์ที่ตั้งไว้ต่ำกว่าขั้นต่ำตามกฎหมายหรือเปล่า
 *
 * เตือน ไม่ใช่บล็อก — ค่าที่ตั้งไว้แล้วอาจมาจากข้อตกลงที่เราไม่รู้ทั้งหมด
 * แต่มันต้องไม่เงียบ เพราะคนที่กรอกตัวเลขไม่ใช่คนที่เปิดกฎหมายอ่าน
 */
function policyWarnings(overrides) {
  const out = [];
  for (const t of resolveLeaveTypes(overrides)) {
    if (t.statutory_paid_min == null) continue;
    if (Number(t.paid_days) < Number(t.statutory_paid_min)) {
      out.push({
        type: t.id,
        message:
          `${t.label} ตั้งไว้ ${t.paid_days} วัน ต่ำกว่าขั้นต่ำตามกฎหมาย ` +
          `${t.statutory_paid_min} วัน (${t.basis})`,
      });
    }
  }
  return out;
}

const YEAR_MS = 365.25 * 86400000;

/**
 * มีสิทธิ์ลาพักร้อนหรือยัง (ม.30 — ต้องทำงานครบหนึ่งปี)
 *
 * ไม่มี `hired_at` = **`unknown` ไม่ใช่ `false`** ตามกฎเดียวกับที่ใช้ทั้งระบบ:
 * คนที่ไม่มีวันเริ่มงานในระบบอาจทำงานมาสามปีแล้ว การตอบว่า "ยังไม่มีสิทธิ์"
 * คือการปฏิเสธสิทธิ์ตามกฎหมายเพราะข้อมูลของเราไม่ครบ
 */
function annualEligibility(hiredAt, asOf) {
  const h = Number(hiredAt);
  if (!Number.isFinite(h) || h <= 0) return { state: "unknown" };
  const now = Number(asOf) || Date.now();
  const years = (now - h) / YEAR_MS;
  if (years >= 1) return { state: "eligible", years };
  return { state: "too_new", years: Math.max(0, years) };
}

/**
 * แบ่งวันลาที่ขอออกเป็นวันที่ได้ค่าจ้างกับวันที่ไม่ได้
 *
 * `usedPaid` = วันที่**ได้ค่าจ้าง**ซึ่งใช้ไปแล้วในปีนั้น ไม่ใช่จำนวนวันที่ลาไปแล้ว
 * — คนที่ลาป่วยไป 35 วันใช้สิทธิ์ที่ได้เงินไป 30 อีก 5 วันไม่กินสิทธิ์อะไรอีก
 * การนับรวมกันทำให้ปีถัดไปสิทธิ์หายไปเฉยๆ
 */
function splitPaidDays({ type, days, usedPaid }) {
  const n = Math.max(0, Number(days) || 0);
  if (!type) return { paid: 0, unpaid: n };
  if (type.paid_days == null) {
    // ไม่มีเพดานในกฎหมาย (ลาทำหมัน) — จ่ายตามที่ลาจริง
    return { paid: n, unpaid: 0 };
  }
  const remaining = Math.max(0, Number(type.paid_days) - Math.max(0, Number(usedPaid) || 0));
  const paid = Math.min(n, remaining);
  return { paid, unpaid: n - paid };
}

/** ใบที่ยังกินสิทธิ์อยู่ ของพนักงานคนนั้น ชนิดนั้น ปีนั้น */
function consumingRequests(requests, { employeeId, typeId, year }) {
  return (Array.isArray(requests) ? requests : []).filter((r) => {
    if (!r || r.employee_id !== employeeId) return false;
    if (typeId && r.type !== typeId) return false;
    if (!CONSUMING_STATUSES.includes(String(r.status || ""))) return false;
    if (year && String(r.from || "").slice(0, 4) !== String(year)) return false;
    return true;
  });
}

/**
 * ยอดคงเหลือรายชนิดของพนักงานหนึ่งคนในหนึ่งปี
 *
 * `used` นับทั้งใบที่รออนุมัติและใบที่อนุมัติแล้ว — ใบที่รออยู่ยังไม่ใช่สิทธิ์
 * ที่ถูกใช้จริง แต่ถ้าไม่นับ คนจะยื่นสามใบพร้อมกันแล้วผ่านทั้งสามใบทั้งที่
 * รวมกันเกินสิทธิ์ (ยอดจึงมี `pending` แยกให้เห็นว่าส่วนไหนยังไม่แน่)
 */
function leaveBalances({ employee, requests, overrides, year, asOf }) {
  const emp = employee || {};
  const y = String(year || new Date().getUTCFullYear());
  const annual = annualEligibility(emp.hired_at, asOf);
  return resolveLeaveTypes(overrides).map((t) => {
    const rows = consumingRequests(requests, { employeeId: emp.id, typeId: t.id, year: y });
    const usedPaid = rows.reduce((s, r) => s + (Number(r.paid_days) || 0), 0);
    const usedUnpaid = rows.reduce((s, r) => s + (Number(r.unpaid_days) || 0), 0);
    const pending = rows
      .filter((r) => r.status === "pending")
      .reduce((s, r) => s + (Number(r.days) || 0), 0);
    const entitled = t.paid_days;
    return {
      type: t.id,
      label: t.label,
      basis: t.basis,
      counts: t.counts,
      entitled_paid_days: entitled,
      used_paid_days: usedPaid,
      used_unpaid_days: usedUnpaid,
      pending_days: pending,
      remaining_paid_days: entitled == null ? null : Math.max(0, entitled - usedPaid),
      // ลาพักร้อนของคนที่ยังไม่ครบปีมีสิทธิ์เป็น 0 แต่ **ไม่ใช่เพราะใช้ไปหมด**
      locked: t.requires_service_years && annual.state === "too_new" ? "service" : null,
      service_state: t.requires_service_years ? annual.state : null,
    };
  });
}

/**
 * ตรวจใบลาก่อนบันทึก
 *
 * คืนรายการเหตุผล — ว่าง = ผ่าน. **การทับซ้อนเป็นการปฏิเสธ ไม่ใช่คำเตือน**
 * ใบลาสองใบบนวันเดียวกันทำให้ยอดวันลาถูกนับสองครั้ง ซึ่งกลายเป็นเงินผิด
 * ทันทีที่รอบจ่ายเริ่มอ่านตัวเลขนี้
 */
function validateLeaveRequest({ employee, draft, requests, overrides, calendar, asOf }) {
  const errors = [];
  const d = draft || {};
  const emp = employee || {};
  const type = leaveTypeById(d.type, overrides);

  if (!emp.id) errors.push("ไม่พบพนักงาน");
  if (!type) errors.push("ชนิดการลาไม่ถูกต้อง");

  const from = str(d.from, 10);
  const to = str(d.to, 10);
  if (dayNumber(from) == null) errors.push("วันที่เริ่มลาไม่ถูกต้อง");
  if (dayNumber(to) == null) errors.push("วันที่สิ้นสุดไม่ถูกต้อง");
  if (dayNumber(from) != null && dayNumber(to) != null && dayNumber(to) < dayNumber(from)) {
    errors.push("วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่มลา");
  }
  if (from.slice(0, 4) !== to.slice(0, 4) && errors.length === 0) {
    // ปีสิทธิ์เป็นปีปฏิทิน ใบที่คร่อมปีจะถูกนับเข้าปีเดียวทั้งใบ ซึ่งผิดทั้งสองปี
    errors.push("ใบลาคร่อมปีไม่ได้ ให้แยกเป็นสองใบ");
  }

  if (errors.length) return { ok: false, errors };

  const days = countLeaveDays({ from, to, counts: type.counts, calendar });
  if (days == null) return { ok: false, errors: ["ช่วงวันลาไม่ถูกต้อง"] };
  if (days === 0) {
    return { ok: false, errors: ["ช่วงที่เลือกไม่มีวันทำงานเลย (ตรงวันหยุดทั้งช่วง)"] };
  }

  if (type.max_days && days > type.max_days) {
    errors.push(`${type.label} ลาได้ไม่เกิน ${type.max_days} วัน (${type.basis})`);
  }

  if (type.requires_service_years) {
    const el = annualEligibility(emp.hired_at, asOf);
    if (el.state === "too_new") {
      errors.push(`${type.label} ต้องทำงานครบ 1 ปีก่อน (${type.basis})`);
    } else if (el.state === "unknown") {
      errors.push("ยังไม่ได้กรอกวันเริ่มงาน จึงตรวจสิทธิ์ลาพักร้อนไม่ได้");
    }
  }

  const a = dayNumber(from);
  const b = dayNumber(to);
  for (const r of consumingRequests(requests, { employeeId: emp.id })) {
    if (d.id && r.id === d.id) continue;
    const ra = dayNumber(r.from);
    const rb = dayNumber(r.to);
    if (ra == null || rb == null) continue;
    if (a <= rb && ra <= b) {
      errors.push(`ช่วงวันทับกับใบลาที่มีอยู่แล้ว (${r.from} ถึง ${r.to})`);
      break;
    }
  }

  if (errors.length) return { ok: false, errors };

  const year = from.slice(0, 4);
  const usedPaid = consumingRequests(requests, { employeeId: emp.id, typeId: type.id, year })
    .filter((r) => !d.id || r.id !== d.id)
    .reduce((s, r) => s + (Number(r.paid_days) || 0), 0);
  const split = splitPaidDays({ type, days, usedPaid });

  const warnings = [];
  if (split.unpaid > 0) {
    warnings.push(
      type.capped
        ? `เกินสิทธิ์ที่ได้ค่าจ้าง ${split.unpaid} วัน (ใช้ไปแล้ว ${usedPaid} จาก ${type.paid_days})`
        : `${split.unpaid} วันนี้ไม่ได้รับค่าจ้าง`
    );
  }
  if (type.doc_required_after && days >= type.doc_required_after && !str(d.document_note)) {
    warnings.push(
      `${type.label} ตั้งแต่ ${type.doc_required_after} วันขึ้นไป นายจ้างขอใบรับรองแพทย์ได้ (${type.basis})`
    );
  }

  return {
    ok: true,
    errors: [],
    warnings,
    days,
    paid_days: split.paid,
    unpaid_days: split.unpaid,
    counts: type.counts,
  };
}

/**
 * สรุปวันลาของพนักงานในช่วงรอบจ่ายหนึ่งรอบ
 *
 * **ตัวนี้ยังไม่มีใครเรียกในเส้นทางที่คิดเงิน** — มันมีไว้ให้หน้ารอบจ่าย
 * *แสดง* ว่ารอบนี้มีวันลาไม่รับค่าจ้างกี่วัน เพื่อให้ HR ใส่บรรทัดหักเองได้
 * อย่างมีข้อมูล การให้มันหักอัตโนมัติเป็นงานรอบถัดไปที่ต้องตัดสินใจแยก
 */
function unpaidLeaveInPeriod({ requests, employeeId, from, to }) {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a == null || b == null) return { days: 0, requests: [] };
  const hits = [];
  let days = 0;
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || r.employee_id !== employeeId) continue;
    if (r.status !== "approved") continue;
    const unpaid = Number(r.unpaid_days) || 0;
    if (unpaid <= 0) continue;
    const ra = dayNumber(r.from);
    const rb = dayNumber(r.to);
    if (ra == null || rb == null) continue;
    if (!(ra <= b && a <= rb)) continue;
    // ใบที่คร่อมขอบรอบถูกนับทั้งใบโดยตั้งใจ และรายงานว่าคร่อม — การเฉลี่ย
    // วันไม่รับค่าจ้างลงตามสัดส่วนของช่วงที่ทับ เดาว่าวันไหนคือวันที่ไม่ได้เงิน
    // ซึ่งใบลาไม่ได้บอกไว้ ให้คนตัดสินดีกว่าเดาแล้วเงียบ
    hits.push({ id: r.id, from: r.from, to: r.to, unpaid_days: unpaid, straddles: ra < a || rb > b });
    days += unpaid;
  }
  return { days, requests: hits };
}

module.exports = {
  LEAVE_TYPES,
  LEAVE_TYPE_IDS,
  REQUEST_STATUSES,
  CONSUMING_STATUSES,
  dayNumber,
  isoOf,
  normalizeCalendar,
  isWorkingDay,
  countLeaveDays,
  leaveTypeById,
  resolveLeaveTypes,
  policyWarnings,
  annualEligibility,
  splitPaidDays,
  consumingRequests,
  leaveBalances,
  validateLeaveRequest,
  unpaidLeaveInPeriod,
};
