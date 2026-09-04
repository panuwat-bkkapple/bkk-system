// =============================================================================
// เอกสารบุคคล — สัญญาจ้าง · หนังสือรับรองเงินเดือน · หนังสือเตือน · ผ่านทดลองงาน
// ตัวคิดล้วน ไม่มี I/O
//
// **สิ่งที่ไฟล์นี้ *ไม่* ทำ และต้องพูดให้ตรง: มันไม่ใช่ที่ปรึกษากฎหมายแรงงาน**
// เงื่อนไขทุกข้อ (ระยะทดลองงาน เวลาทำงาน การบอกกล่าวล่วงหน้า) เป็นค่าที่แอดมิน
// ตั้งเองที่ `settings/hr/contract` ค่าตั้งต้นในไฟล์นี้เป็นแค่**จุดเริ่มให้แก้**
// ไม่ใช่ตัวเลขที่ระบบรับรองว่าถูกกฎหมาย — หน้าตั้งค่าเขียนกำกับไว้ และเอกสาร
// ฉบับแรกต้องให้คนที่ปรึกษาได้ตรวจก่อนใช้จริง
//
// **เงื่อนไขถูก freeze ลงบนเอกสารตอนออก ไม่ได้อ่านสดตอนพิมพ์ซ้ำ** — รูปเดียวกับ
// `payroll_runs.config` และใบกำกับภาษี: สัญญาที่เซ็นไปแล้วต้องอธิบายตัวเองได้
// แม้ค่าใน settings จะถูกแก้พรุ่งนี้ พิมพ์ซ้ำ = ได้ฉบับเดิมเป๊ะ ไม่ใช่ฉบับใหม่
// ที่ใช้เงื่อนไขวันนี้
// =============================================================================

const BKK_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);

/**
 * ชนิดเอกสาร — `prefix` ใช้เป็นเลขที่, `needs` คือสิ่งที่ต้องมีก่อนออกได้
 *
 * แยกตัวนับต่อชนิดโดยตั้งใจ: ลำดับของสัญญาจ้างกับหนังสือเตือนไม่ควรมีช่องว่าง
 * สลับกันไปมา เพราะเป็นคนละทะเบียนที่ถูกอ้างถึงคนละแบบ
 */
const DOC_TYPES = {
  contract: {
    label: "สัญญาจ้างแรงงาน",
    prefix: "CT",
    // สัญญาต้องมีเลขบัตรและที่อยู่ของลูกจ้าง ไม่งั้นเป็นเอกสารที่ระบุตัวคู่สัญญา
    // ไม่ได้ ซึ่งคือสิ่งเดียวที่สัญญาต้องทำให้ได้
    needs: ["national_id", "address", "hired_at", "pay"],
  },
  salary_certificate: {
    label: "หนังสือรับรองเงินเดือน",
    prefix: "SC",
    needs: ["hired_at", "pay"],
  },
  warning: {
    label: "หนังสือเตือน",
    prefix: "WN",
    needs: [],
    // หนังสือเตือนมีอายุ — ดู warningExpiry ด้านล่าง
    expires: true,
  },
  probation_pass: {
    label: "หนังสือแจ้งผ่านการทดลองงาน",
    prefix: "PB",
    needs: ["hired_at"],
  },
};

/**
 * ค่าตั้งต้นของเงื่อนไขจ้าง — **จุดเริ่มให้แก้ ไม่ใช่คำแนะนำทางกฎหมาย**
 *
 * ตัวเลขพวกนี้ถูกเลือกให้เป็นค่าที่พบบ่อยในสัญญาจ้างไทย ไม่ได้ถูกเลือกเพราะ
 * ระบบรู้ว่ากฎหมายกำหนดเท่าไหร่ **ห้ามเขียนโค้ดหรือ UI ที่บอกเป็นนัยว่าค่าเหล่านี้
 * ถูกต้องตามกฎหมายแล้ว** — แอดมินต้องเป็นคนยืนยัน
 */
const DEFAULT_CONTRACT = {
  probation_days: 119,
  work_days_per_week: 6,
  work_hours_per_day: 8,
  work_start: "09:00",
  work_end: "18:00",
  // เวลาพักระหว่างวัน — **ไม่ใช่ของประดับ** ช่วงเวลาทำงาน 09:00-18:00 คือ 9
  // ชั่วโมง ส่วน "วันละ 8 ชั่วโมง" คือชั่วโมงทำงานจริง สองตัวเลขนี้ต่างกันได้
  // ก็เพราะมีเวลาพักคั่นอยู่ **เอกสารที่พิมพ์ตัวเลขทั้งคู่โดยไม่พูดถึงเวลาพัก
  // จึงขัดกันเองบนหน้ากระดาษ** (เจอจากการเปิดสัญญาฉบับจริงที่ออกไปแล้ว)
  break_minutes: 60,
  weekly_holiday: "อาทิตย์",
  notice_days: 30,
  // อายุของหนังสือเตือน — ใช้ตัดสินว่าใบไหนยัง "มีผล" อยู่
  warning_valid_days: 365,
  probation_note: "",
  benefits: "",
  extra_clauses: "",
};

/**
 * เวลาทำงานที่ประกาศไว้สอดคล้องกันไหม
 *
 * **สัญญาที่ขัดกันเองแย่กว่าสัญญาที่ยังพิมพ์ไม่ได้** — ถ้าช่วงเวลาลบเวลาพักแล้ว
 * ไม่เท่ากับชั่วโมงทำงานที่ประกาศ เอกสารจะพิมพ์ตัวเลขสองชุดที่บวกกันไม่ลงตัว
 * ให้คนเซ็น ซึ่งเป็นเอกสารที่ใช้อ้างอิงตอนมีข้อพิพาทไม่ได้
 *
 * รองรับกะข้ามคืน (`22:00`-`06:00`) โดยบวก 24 ชั่วโมงเมื่อเวลาจบน้อยกว่าเวลาเริ่ม
 * คืน `{ ok, spanMin, workMin, breakMin, reason }` — `reason` เป็นข้อความไทยที่
 * ไปโผล่บนหน้าจอโดยตรง
 */
function parseClock(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function workScheduleCheck(terms) {
  const t = terms || {};
  const start = parseClock(t.work_start);
  const end = parseClock(t.work_end);
  if (start == null || end == null) {
    return { ok: false, reason: "เวลาเริ่ม/เลิกงานต้องเป็นรูป HH:MM" };
  }
  // เท่ากันเป๊ะ = ช่วงศูนย์ ไม่ใช่ 24 ชั่วโมง — กะที่ยาว 24 ชม.ไม่มีอยู่จริง
  const spanMin = end > start ? end - start : end === start ? 0 : end + 24 * 60 - start;
  const breakMin = Math.max(0, Math.round(Number(t.break_minutes) || 0));
  const workMin = Math.round((Number(t.work_hours_per_day) || 0) * 60);
  if (workMin <= 0) return { ok: false, spanMin, workMin, breakMin, reason: "ยังไม่ได้ตั้งชั่วโมงทำงานต่อวัน" };
  if (breakMin >= spanMin) {
    return { ok: false, spanMin, workMin, breakMin, reason: "เวลาพักยาวเท่าหรือมากกว่าช่วงเวลาทำงานทั้งวัน" };
  }
  if (spanMin - breakMin !== workMin) {
    const hh = (m) => (m / 60).toFixed(2).replace(/\.00$/, "");
    return {
      ok: false, spanMin, workMin, breakMin,
      reason: `ตัวเลขไม่ลงตัว: ${t.work_start}-${t.work_end} คือ ${hh(spanMin)} ชม. หักพัก ${breakMin} นาที `
        + `เหลือ ${hh(spanMin - breakMin)} ชม. แต่ประกาศว่าวันละ ${hh(workMin)} ชม.`,
    };
  }
  return { ok: true, spanMin, workMin, breakMin };
}

/** รวมค่าที่ตั้งไว้กับค่าตั้งต้น ทีละฟิลด์ — ตั้งบางช่องไม่ทำให้ช่องอื่นหาย */
function resolveContractTerms(settings) {
  const c = (settings && settings.contract) || {};
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_CONTRACT)) {
    if (typeof def === "number") out[k] = c[k] == null || c[k] === "" ? def : num(c[k], def);
    else out[k] = c[k] == null ? def : str(c[k], 2000);
  }
  return out;
}

/** ต้นวันตามเวลาไทย — วันครบกำหนดคิดเป็นวัน ไม่ใช่เป็นมิลลิวินาที */
const bkkDayIndex = (ms) => Math.floor((num(ms, 0) + BKK_OFFSET_MS) / DAY_MS);

/**
 * วันครบทดลองงาน
 *
 * นับ **วันเริ่มงานเป็นวันที่ 1** ตามที่คนไทยนับกัน (เริ่ม 1 ม.ค. ทดลองงาน
 * 119 วัน = ครบวันที่ 119 ไม่ใช่วันที่ 120) — เขียนไว้ให้ชัดเพราะเป็นจุดที่
 * off-by-one แล้วเอกสารระบุวันผิดหนึ่งวัน ซึ่งเป็นวันที่มีผลทางกฎหมาย
 */
function probationEnd(hiredAt, days) {
  const start = num(hiredAt, 0);
  const n = num(days, 0);
  if (!start || n <= 0) return null;
  return (bkkDayIndex(start) + n - 1) * DAY_MS - BKK_OFFSET_MS;
}

/** หนังสือเตือนหมดอายุเมื่อไหร่ */
function warningExpiry(issuedAt, validDays) {
  const at = num(issuedAt, 0);
  const n = num(validDays, 0);
  if (!at || n <= 0) return null;
  return (bkkDayIndex(at) + n) * DAY_MS - BKK_OFFSET_MS;
}

/** หนังสือเตือนที่ยัง "มีผล" ณ เวลาหนึ่ง — ใบที่หมดอายุแล้วไม่นับ */
function activeWarnings(docs, now) {
  const t = num(now, 0);
  return (docs || []).filter((d) =>
    d && d.type === "warning" && d.status !== "void" &&
    (d.expires_at == null || num(d.expires_at, 0) >= t));
}

/**
 * ออกเอกสารนี้ได้ไหม
 *
 * คืนรายการสิ่งที่ขาดเป็นภาษาไทย — ข้อความนี้ไปโผล่บนหน้าจอตรงๆ เอกสารที่ออก
 * โดยมีช่องว่างคือเอกสารที่ต้องพิมพ์ใหม่ ซึ่งแพงกว่าการบอกก่อนพิมพ์
 */
function missingFor(type, { employee, priv }) {
  const t = DOC_TYPES[type];
  if (!t) return ["ไม่รู้จักชนิดเอกสารนี้"];
  const e = employee || {};
  const p = priv || {};
  const out = [];
  for (const need of t.needs) {
    if (need === "national_id" && !str(p.national_id)) out.push("เลขบัตรประชาชน");
    if (need === "address" && !str(p.address)) out.push("ที่อยู่");
    if (need === "hired_at" && !num(e.hired_at, 0)) out.push("วันเริ่มงาน");
    if (need === "pay") {
      const pay = p.pay || {};
      if (!num(pay.base_salary, 0) && !num(pay.daily_rate, 0)) out.push("เงินเดือนหรือค่าแรงรายวัน");
    }
  }
  if (!str(e.name)) out.push("ชื่อ-สกุล");
  return out;
}

/** ค่าจ้างที่จะพิมพ์ลงเอกสาร — รายเดือนหรือรายวันตามประเภทการจ้าง */
function payLine(employee, priv) {
  const pay = (priv && priv.pay) || {};
  const monthly = num(pay.base_salary, 0);
  const daily = num(pay.daily_rate, 0);
  const type = String((employee && employee.employment_type) || "").toLowerCase();
  if (type === "daily" || (!monthly && daily)) {
    return daily ? { amount: daily, unit: "บาทต่อวัน", period: "รายวัน" } : null;
  }
  return monthly ? { amount: monthly, unit: "บาทต่อเดือน", period: "รายเดือน" } : null;
}

/**
 * ตัดบรรทัดภาษาไทย — รับตัววัดความกว้างเข้ามา จึงทดสอบได้โดยไม่ต้องมีฟอนต์
 *
 * ภาษาไทยไม่มีช่องว่างระหว่างคำ จะตัดที่ช่องว่างอย่างเดียวไม่ได้ **แต่ตัดตรงไหน
 * ก็ได้ก็ไม่ได้** — สองจุดที่ตัดแล้วอ่านเป็นคำอื่น:
 *   1. หลังสระหน้า (เ แ โ ใ ไ) ซึ่งต้องอยู่ติดพยัญชนะตัวถัดไปเสมอ
 *   2. ก่อนสระบน/ล่างและวรรณยุกต์ ซึ่งลอยเดี่ยวไม่ได้
 *
 * เจอจริงตอนเปิดดูสัญญาฉบับแรก: "และต่างเก็บไว้" ถูกตัดเป็น "และต่างเก็บไ" /
 * "ว้ฝ่ายละหนึ่งฉบับ" — บนเอกสารที่คนต้องเซ็น
 */
const LEADING_VOWEL = /[\u0E40-\u0E44]/;
const COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
// **เทียบเฉพาะตัวอักษรตัวแรกของ `next` เท่านั้น** — พอถอยกลับไปแล้ว `next`
// กลายเป็นสตริงหลายตัว ถ้าเทสทั้งสตริงมันจะเจอวรรณยุกต์ที่อยู่ลึกเข้าไปแล้ว
// ถอยต่อไม่หยุดจนบรรทัดหมด แล้วตกไปตัดที่จุดเดิมซึ่งเป็นจุดที่ผิด
// (บั๊กจริงในรอบแรกของฟังก์ชันนี้ — "ไว้ฝ่ายละหนึ" / "่งฉบับ")
const unsafeBreak = (line, next) =>
  (line.length > 0 && LEADING_VOWEL.test(line[line.length - 1])) ||
  COMBINING.test(String(next || "")[0] || "");

function wrapText(text, maxW, measure) {
  const chars = [...String(text == null ? "" : text)];
  const out = []; let cur = "";
  for (const ch of chars) {
    if (ch === "\n") { out.push(cur); cur = ""; continue; }
    if (cur && measure(cur + ch) > maxW) {
      let line = cur, carry = ch, back = 0;
      // ถอยกลับได้ไม่เกิน 12 ตัว — ไกลกว่านั้นแปลว่าเจอสตริงที่ตัดไม่ได้จริงๆ
      // ยอมตัดตรงนั้นดีกว่าปล่อยให้ล้นขอบกระดาษ
      while (back < 12 && unsafeBreak(line, carry)) {
        carry = line[line.length - 1] + carry;
        line = line.slice(0, -1);
        back += 1;
      }
      if (!line) { line = cur; carry = ch; }
      out.push(line);
      cur = carry;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

/** เลขที่เอกสาร — `{prefix}-{ปีพ.ศ.}-{4 หลัก}` รีเซ็ตรายปี */
const formatDocNumber = (prefix, buddhistYear, seq) =>
  `${prefix}-${buddhistYear}-${String(num(seq, 1)).padStart(4, "0")}`;

module.exports = {
  workScheduleCheck, parseClock,
  DOC_TYPES, DEFAULT_CONTRACT,
  resolveContractTerms, probationEnd, warningExpiry, activeWarnings,
  missingFor, payLine, formatDocNumber, bkkDayIndex,
  wrapText, LEADING_VOWEL, COMBINING,
};
