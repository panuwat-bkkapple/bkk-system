// =============================================================================
// การลงเวลาเข้า-ออกงาน — กติกาล้วน ไม่มี I/O (มีเทส + injection)
//
// ─── สิ่งที่ไฟล์นี้ถือไว้ และทำไมต้องอยู่ฝั่ง server ───────────────────────
// การเช็คอินคือ **หลักฐานว่าคนมาทำงาน** ซึ่งเดินตรงเข้าไปในเงินเดือนและใน
// ข้อพิพาทแรงงาน ถ้ากติกาอยู่ในเบราว์เซอร์อย่างเดียว คนที่เรียก callable ตรงๆ
// ก็เช็คอินจากที่ไหนก็ได้ — ซึ่งไม่ใช่การโกงที่ต้องแฮ็ก แค่เปิด devtools
//
// **จุดที่ต้องพูดให้ตรง: GPS โกงได้ และไฟล์นี้ไม่ได้แก้เรื่องนั้น** — mock
// location ในมือถือทำได้โดยไม่ต้องรูท สิ่งที่ระบบนี้ให้คือ *บันทึกที่ตรวจสอบ
// ย้อนหลังได้* (พิกัด ระยะห่าง ความแม่นยำ สาขาที่เข้าเกณฑ์) ไม่ใช่การพิสูจน์ว่า
// คนอยู่ตรงนั้นจริง อย่าเขียนข้อความบนหน้าจอที่อ้างเกินกว่านี้
//
// ─── กฎที่ตั้งใจ ───────────────────────────────────────────────────────────
// 1. **ไม่มีพิกัด = ปฏิเสธ ไม่ใช่บันทึกแบบไม่มีพิกัด** — แถวที่ไม่มีพิกัด
//    หน้าตาเหมือนการมาทำงานทุกประการ แต่พิสูจน์อะไรไม่ได้เลย ซึ่งแย่กว่าการ
//    ไม่มีแถว เพราะมันถูกนับ
// 2. **`Number(null) === 0` และ 0 เป็นพิกัดจริง** (อ่าวกินี) — ละติจูดที่หาย
//    ต้องไม่กลายเป็น 0 เงียบๆ แล้วผ่านการตรวจว่า "เป็นตัวเลข"
// 3. **นอกรัศมีต้องบอกระยะจริง** — "คุณอยู่ไกลเกินไป" เฉยๆ ทำให้คนไม่รู้ว่า
//    ต้องเดินอีกสิบเมตรหรืออีกสองกิโล
// 4. **ไม่มีกะในตาราง = ยังเช็คอินได้** — การบล็อกคนเพราะแอดมินยังไม่ได้จัดเวร
//    คือการลงโทษคนผิดคน แต่ต้องติดธงให้แอดมินเห็นว่าแถวนี้ไม่มีกะ
// 5. **กะข้ามเที่ยงคืนผูกกับวันที่กะ *เริ่ม*** — คนเข้ากะดึก 22:00 แล้วออก
//    06:00 ของอีกวัน ต้องเป็นแถวเดียว ไม่ใช่สองแถวที่อ่านว่าขาดงานหนึ่งวัน
// =============================================================================

"use strict";

const str = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);

/** เวลาไทยคงที่ +7 — ระบบนี้ไม่มีสาขานอกประเทศ และ DST ของไทยไม่มี */
const TZ_OFFSET_MS = 7 * 3600000;

const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * ตัวเลขที่ต้องมีมาจริงๆ
 *
 * **ห้ามใช้ `Number(x)` เปล่าๆ กับพิกัด** — `Number(null)` และ `Number("")`
 * ได้ 0 ซึ่งเป็นละติจูด/ลองจิจูดที่ถูกต้องตามหลักภูมิศาสตร์ (กลางทะเล
 * อ่าวกินี) การเช็ค `Number.isFinite` อย่างเดียวจึงปล่อยพิกัดที่หายไปให้ผ่าน
 */
function realNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** พิกัดที่ใช้ได้จริง — นอกช่วงโลก = ไม่ใช่พิกัด */
function coordsOf(input) {
  const src = input && typeof input === "object" ? input : {};
  const lat = realNumber(src.lat);
  const lng = realNumber(src.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, accuracy_m: realNumber(src.accuracy_m) };
}

// ── วันที่/เวลาแบบไทย ───────────────────────────────────────────────────────

/** วันที่ไทยของเวลาหนึ่ง (YYYY-MM-DD) */
function bangkokIso(ms) {
  const n = realNumber(ms);
  if (n === null) return null;
  return new Date(n + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** เที่ยงคืนของวันไทยนั้น เป็น epoch ms */
function bangkokMidnight(iso) {
  if (!DATE_RE.test(str(iso, 10))) return null;
  return Date.parse(`${iso}T00:00:00Z`) - TZ_OFFSET_MS;
}

/** เลื่อนวันที่ ISO ไป n วัน */
function shiftIso(iso, days) {
  const base = bangkokMidnight(iso);
  if (base === null) return null;
  return bangkokIso(base + days * DAY_MS);
}

/** "08:30" -> 510 นาทีจากเที่ยงคืน · รูปอื่นคืน null (ไม่ใช่ 0) */
function minutesOfDay(hhmm) {
  const m = TIME_RE.exec(str(hhmm, 5));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ── กะ ──────────────────────────────────────────────────────────────────────

/**
 * กะตั้งต้น — มีไว้ให้ระบบใช้งานได้ทันทีที่เปิด ไม่ใช่ให้แอดมินเริ่มจากหน้าว่าง
 *
 * แอดมินแก้ทับได้ที่ `settings/hr/shifts` (ดู `normalizeShifts`)
 */
const DEFAULT_SHIFTS = [
  { id: "morning", label: "กะเช้า", start: "08:00", end: "17:00", break_min: 60, grace_min: 15, order: 1 },
  { id: "afternoon", label: "กะบ่าย", start: "13:00", end: "22:00", break_min: 60, grace_min: 15, order: 2 },
  { id: "night", label: "กะดึก", start: "22:00", end: "06:00", break_min: 60, grace_min: 15, order: 3 },
];

/** เพดานที่ยอมให้เช็คอินก่อนกะเริ่ม — มาก่อนงานเป็นเรื่องปกติ */
const EARLY_IN_MIN = 120;

/** เพดานที่ยอมให้เช็คอินหลังกะเริ่ม — เกินกว่านี้ถือว่าคนละกะ ไม่ใช่มาสาย */
const LATE_IN_MIN = 480;

/**
 * แปลงค่าที่แอดมินตั้งเป็นตารางกะที่ใช้ได้
 *
 * กะที่เวลาเสีย **ถูกตัดทิ้งพร้อมเหตุผล ไม่ใช่ปัดเป็น 00:00** — กะที่เริ่ม
 * เที่ยงคืนโดยไม่มีใครตั้งใจ จะทำให้ทุกคนในกะนั้น "สาย" ทั้งวัน
 */
function normalizeShifts(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const rows = [];
  const dropped = [];
  const entries = Array.isArray(src)
    ? src.map((v, i) => [String(v && v.id ? v.id : i), v])
    : Object.entries(src);

  for (const [key, v] of entries) {
    const val = v && typeof v === "object" ? v : {};
    const id = str(val.id || key, 40);
    const start = minutesOfDay(val.start);
    const end = minutesOfDay(val.end);
    if (!id) continue;
    if (start === null || end === null) {
      dropped.push({ id, reason: "เวลาเข้า-ออกกะไม่ถูกต้อง (ต้องเป็น HH:MM)" });
      continue;
    }
    if (start === end) {
      dropped.push({ id, reason: "เวลาเข้าและออกกะเท่ากัน" });
      continue;
    }
    if (val.active === false) continue;
    rows.push({
      id,
      label: str(val.label, 60) || id,
      start,
      end,
      crosses_midnight: end < start,
      break_min: Math.max(0, realNumber(val.break_min) ?? 0),
      grace_min: Math.max(0, realNumber(val.grace_min) ?? 0),
      order: realNumber(val.order) ?? 99,
    });
  }
  if (!rows.length && !dropped.length) return normalizeShifts(DEFAULT_SHIFTS);
  rows.sort((a, b) => a.order - b.order || a.start - b.start);
  return { shifts: rows, dropped };
}

const shiftById = (shifts, id) => (shifts || []).find((s) => s.id === str(id, 40)) || null;

/**
 * กะของคนคนนั้นในวันนั้น
 *
 * ตารางเวรมาก่อนกะประจำตัวเสมอ — ตารางเวรคือสิ่งที่หัวหน้าตั้งใจ ส่วนกะประจำตัว
 * คือค่าเริ่มต้นเมื่อไม่มีใครตั้งใจอะไร
 */
function resolveShift({ shifts, roster, employee, iso }) {
  const day = (roster && typeof roster === "object" ? roster[str(iso, 10)] : null) || null;
  const rosterId = day && typeof day === "object" ? day.shift_id : day;
  const fromRoster = shiftById(shifts, rosterId);
  if (fromRoster) return { shift: fromRoster, source: "roster" };
  const fromEmployee = shiftById(shifts, (employee || {}).default_shift_id);
  if (fromEmployee) return { shift: fromEmployee, source: "employee" };
  return { shift: null, source: "none" };
}

/** ช่วงเวลาจริงของกะในวันนั้น (ข้ามเที่ยงคืน = จบวันถัดไป) */
function shiftWindow(shift, iso) {
  const base = bangkokMidnight(iso);
  if (base === null || !shift) return null;
  const startMs = base + shift.start * 60000;
  const endMs = base + (shift.end + (shift.crosses_midnight ? 1440 : 0)) * 60000;
  return { startMs, endMs };
}

/**
 * วันที่ที่การเช็คอิน ณ เวลานี้ควรผูกอยู่
 *
 * **ผูกกับวันที่กะ *เริ่ม* ไม่ใช่วันตามนาฬิกา** — คนเข้ากะดึกตอน 22:00 แล้ว
 * ออก 06:00 ของอีกวัน ถ้าผูกตามนาฬิกาจะได้สองแถวที่ต่างก็ไม่สมบูรณ์ และวันแรก
 * จะอ่านว่า "ไม่ได้ออกงาน" ส่วนวันหลังอ่านว่า "ไม่ได้เข้างาน"
 *
 * คืน `iso` ของวันที่ควรผูก + กะของวันนั้น (อาจเป็น null = ไม่มีกะ ซึ่งยัง
 * เช็คอินได้ตามกฎข้อ 4)
 */
function attendanceDayFor({ now, shifts, roster, employee }) {
  const nowMs = realNumber(now);
  if (nowMs === null) return null;
  const today = bangkokIso(nowMs);
  const yesterday = shiftIso(today, -1);

  for (const iso of [today, yesterday]) {
    const { shift, source } = resolveShift({ shifts, roster, employee, iso });
    if (!shift) continue;
    const w = shiftWindow(shift, iso);
    if (!w) continue;
    if (nowMs >= w.startMs - EARLY_IN_MIN * 60000 && nowMs <= w.startMs + LATE_IN_MIN * 60000) {
      return { iso, shift, source, window: w };
    }
    // ยังอยู่กลางกะที่เริ่มไปแล้ว (เช่นเข้ากะดึกช้ามาก) ก็ยังผูกกับกะนั้น
    if (nowMs > w.startMs && nowMs <= w.endMs) {
      return { iso, shift, source, window: w };
    }
  }
  const { shift, source } = resolveShift({ shifts, roster, employee, iso: today });
  return { iso: today, shift: shift || null, source, window: shift ? shiftWindow(shift, today) : null };
}

// ── ระยะทาง / รั้วพิกัด ────────────────────────────────────────────────────

const R_EARTH_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** ระยะทางเส้นตรงบนผิวโลก (เมตร) */
function haversineMeters(a, b) {
  const p = coordsOf(a);
  const q = coordsOf(b);
  if (!p || !q) return null;
  const dLat = rad(q.lat - p.lat);
  const dLng = rad(q.lng - p.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s))));
}

/**
 * จุดลงเวลาที่ระบบยอมรับ — มาจาก `settings/branches` ที่เปิดใช้และมีพิกัดจริง
 *
 * สาขาที่ไม่มีพิกัดถูกตัดทิ้ง **ไม่ใช่ถือว่าอยู่ที่ (0,0)** ด้วยเหตุผลเดียวกับ
 * กฎข้อ 2
 */
function attendanceSites(branches) {
  const src = branches && typeof branches === "object" ? branches : {};
  const out = [];
  for (const [id, v] of Object.entries(src)) {
    const b = v && typeof v === "object" ? v : {};
    if (b.isActive === false) continue;
    const c = coordsOf({ lat: b.lat, lng: b.lng });
    if (!c) continue;
    out.push({ id: str(b.id || id, 60), name: str(b.name, 120) || str(id, 60), lat: c.lat, lng: c.lng });
  }
  return out;
}

/** สาขาที่ใกล้ที่สุด + อยู่ในรัศมีไหม */
function nearestSite(coords, sites, radiusM) {
  const c = coordsOf(coords);
  if (!c) return null;
  const list = Array.isArray(sites) ? sites : [];
  let best = null;
  for (const s of list) {
    const d = haversineMeters(c, s);
    if (d === null) continue;
    if (!best || d < best.distance_m) best = { site: s, distance_m: d };
  }
  if (!best) return null;
  const radius = Math.max(0, realNumber(radiusM) ?? 0);
  return { ...best, inside: best.distance_m <= radius, radius_m: radius };
}

// ── การตั้งค่า ─────────────────────────────────────────────────────────────

const DEFAULT_ATTENDANCE_SETTINGS = {
  /** รัศมีรอบสาขาที่ถือว่า "อยู่ที่ทำงาน" */
  radius_m: 150,
  /**
   * ความแม่นยำต่ำสุดที่ยอมรับ
   *
   * ตัวเลขนี้ไม่ใช่การกันโกง — มันกันเคสที่พบบ่อยกว่ามาก: มือถือในอาคารที่
   * ตกไปใช้ Wi-Fi/เสาสัญญาณแล้วให้พิกัดคลาดหลายร้อยเมตร ซึ่งจะทำให้คนที่ยืน
   * อยู่หน้าร้านจริงๆ เช็คอินไม่ผ่าน **ยอมให้ค่าที่แม่นน้อยผ่านไม่ได้ แต่ต้อง
   * บอกให้ชัดว่าให้รอสัญญาณ ไม่ใช่บอกว่าอยู่ผิดที่**
   */
  min_accuracy_m: 200,
};

function normalizeAttendanceSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const radius = realNumber(src.radius_m);
  const acc = realNumber(src.min_accuracy_m);
  return {
    radius_m: radius !== null && radius > 0 ? radius : DEFAULT_ATTENDANCE_SETTINGS.radius_m,
    min_accuracy_m: acc !== null && acc > 0 ? acc : DEFAULT_ATTENDANCE_SETTINGS.min_accuracy_m,
  };
}

// ── คำตัดสิน ───────────────────────────────────────────────────────────────

/**
 * เช็คอินได้ไหม
 *
 * คืน `{ code, message }` เมื่อไม่ได้ **ไม่ throw** — ผู้เรียกเป็นคนตัดสินว่า
 * จะแปลงเป็น error อะไร (รูปเดียวกับ `sellableVerdict` / `checkUnpackable`)
 */
function checkInVerdict({ now, coords, sites, settings, existing, day }) {
  const nowMs = realNumber(now);
  if (nowMs === null) return { ok: false, code: "no_time", message: "ไม่ทราบเวลาปัจจุบัน" };

  const c = coordsOf(coords);
  // กฎข้อ 1 — ไม่มีพิกัดคือปฏิเสธ ไม่ใช่บันทึกแบบไม่มีพิกัด
  if (!c) {
    return { ok: false, code: "no_coords", message: "ต้องเปิด GPS และอนุญาตให้เข้าถึงตำแหน่งก่อนลงเวลา" };
  }

  const cfg = normalizeAttendanceSettings(settings);
  if (c.accuracy_m !== null && c.accuracy_m > cfg.min_accuracy_m) {
    return {
      ok: false,
      code: "low_accuracy",
      accuracy_m: Math.round(c.accuracy_m),
      // ข้อความต้องบอกว่า "รอสัญญาณ" ไม่ใช่ "คุณอยู่ผิดที่" เพราะคนที่ยืนถูกที่
      // แล้วโดนบอกว่าอยู่ผิดที่จะเลิกเชื่อระบบตั้งแต่วันแรก
      message: `สัญญาณ GPS ยังไม่แม่นพอ (คลาดเคลื่อน ${Math.round(c.accuracy_m)} ม.) รอสักครู่แล้วลองใหม่`,
    };
  }

  const list = attendanceSites(sites);
  if (!list.length) {
    return { ok: false, code: "no_sites", message: "ยังไม่ได้ตั้งพิกัดสาขาสำหรับลงเวลา ติดต่อฝ่ายบุคคล" };
  }

  const near = nearestSite(c, list, cfg.radius_m);
  // กฎข้อ 3 — บอกระยะจริงเสมอ
  if (!near || !near.inside) {
    const d = near ? near.distance_m : null;
    return {
      ok: false,
      code: "too_far",
      distance_m: d,
      radius_m: cfg.radius_m,
      site: near ? near.site : null,
      message: d === null
        ? "หาตำแหน่งสาขาที่ใกล้ที่สุดไม่ได้"
        : `อยู่ห่างจาก${near.site.name} ${d.toLocaleString("th-TH")} ม. (ต้องอยู่ในระยะ ${cfg.radius_m} ม.)`,
    };
  }

  if (existing && existing.in_at) {
    return {
      ok: false,
      code: "already_in",
      at: realNumber(existing.in_at),
      message: "ลงเวลาเข้างานของกะนี้ไปแล้ว",
    };
  }

  const d = day || {};
  const w = d.window || null;
  const shift = d.shift || null;
  // กฎข้อ 4 — ไม่มีกะก็ยังเข้าได้ แต่ติดธงไว้
  const lateMin = w ? Math.max(0, Math.round((nowMs - w.startMs) / 60000)) : null;
  const grace = shift ? shift.grace_min : 0;

  return {
    ok: true,
    code: "ok",
    iso: d.iso || bangkokIso(nowMs),
    site: near.site,
    distance_m: near.distance_m,
    accuracy_m: c.accuracy_m === null ? null : Math.round(c.accuracy_m),
    shift,
    shift_source: d.source || "none",
    no_shift: !shift,
    late_min: lateMin,
    within_grace: lateMin === null ? null : lateMin <= grace,
  };
}

/** ออกงานได้ไหม — ต้องมีแถวที่เปิดค้างอยู่เท่านั้น */
function checkOutVerdict({ now, coords, sites, settings, existing, shift, window: win }) {
  const nowMs = realNumber(now);
  if (nowMs === null) return { ok: false, code: "no_time", message: "ไม่ทราบเวลาปัจจุบัน" };

  const rec = existing && typeof existing === "object" ? existing : null;
  const inAt = rec ? realNumber(rec.in_at) : null;
  if (!rec || inAt === null) {
    return { ok: false, code: "not_in", message: "ยังไม่ได้ลงเวลาเข้างาน" };
  }
  if (realNumber(rec.out_at) !== null) {
    return { ok: false, code: "already_out", at: realNumber(rec.out_at), message: "ลงเวลาออกงานไปแล้ว" };
  }
  if (nowMs < inAt) {
    return { ok: false, code: "before_in", message: "เวลาออกงานอยู่ก่อนเวลาเข้างาน" };
  }

  const c = coordsOf(coords);
  if (!c) return { ok: false, code: "no_coords", message: "ต้องเปิด GPS และอนุญาตให้เข้าถึงตำแหน่งก่อนลงเวลา" };

  const cfg = normalizeAttendanceSettings(settings);
  const near = nearestSite(c, attendanceSites(sites), cfg.radius_m);
  // **ออกงานไม่บังคับว่าต้องอยู่ในรัศมี** — คนที่ออกไปส่งของแล้วกลับบ้านเลย
  // ยังต้องปิดกะได้ ไม่งั้นจะได้แถวที่ค้างเปิดตลอดไป ซึ่งอ่านว่า "ยังทำงานอยู่"
  // บันทึกระยะไว้ให้หัวหน้าเห็นแทนการบล็อก
  const breakMin = shift ? shift.break_min : 0;
  const grossMin = Math.round((nowMs - inAt) / 60000);
  const workedMin = Math.max(0, grossMin - breakMin);
  const earlyMin = win ? Math.max(0, Math.round((win.endMs - nowMs) / 60000)) : null;

  return {
    ok: true,
    code: "ok",
    site: near ? near.site : null,
    distance_m: near ? near.distance_m : null,
    outside: near ? !near.inside : true,
    accuracy_m: c.accuracy_m === null ? null : Math.round(c.accuracy_m),
    gross_min: grossMin,
    break_min: breakMin,
    worked_min: workedMin,
    early_min: earlyMin,
  };
}

module.exports = {
  TZ_OFFSET_MS,
  DEFAULT_SHIFTS,
  DEFAULT_ATTENDANCE_SETTINGS,
  EARLY_IN_MIN,
  LATE_IN_MIN,
  realNumber,
  coordsOf,
  bangkokIso,
  bangkokMidnight,
  shiftIso,
  minutesOfDay,
  normalizeShifts,
  shiftById,
  resolveShift,
  shiftWindow,
  attendanceDayFor,
  haversineMeters,
  attendanceSites,
  nearestSite,
  normalizeAttendanceSettings,
  checkInVerdict,
  checkOutVerdict,
};
