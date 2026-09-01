// ---------------------------------------------------------------------------
// meta ของค่าจ้างไรเดอร์ — รูปเดียวกันทุกจุดที่เขียน rider_fee / rider_fee_estimate
//
// แยกออกมาจาก index.js เพื่อให้เทสได้แบบ offline (index.js ต้อง init
// firebase-functions ตอน require) — รูปแบบเดียวกับ pin-dispute.js
//
// ทำไมต้องมีด่าน: `computeRiderFee` คำนวณ `duration_min` ทุกครั้งที่ยิง Routes
// API สำเร็จ (และยิงรอบที่สองด้วยซ้ำเมื่อโหมดของยานพาหนะต่างจากฐานที่ใช้คิดเงิน)
// แต่ meta เดิมไม่เก็บมัน — เวลาเดินทางที่เราจ่ายเงินไปถามแล้วถูกทิ้งทุกครั้ง
// เช่นเดียวกับ `travel_mode` / `eta_travel_mode` ซึ่งเป็นคำตอบของ "เลขนี้มาจาก
// ฐานไหน" และ `branch_source` ซึ่งเป็นคำตอบของ "วัดไปที่สาขาไหน" (resolveBranchCoords
// มี fallback สามชั้น — ไม่บันทึกไว้ก็ย้อนดูไม่ได้ว่าตอนนั้นตกชั้นไหน)
//
// กติกา: ฟิลด์ที่ผู้เรียกไม่มีให้ = `null` **ห้ามละคีย์ทิ้ง** เพราะคีย์ที่หายไป
// อ่านย้อนหลังแล้วแยกไม่ออกระหว่าง "แถวเก่าก่อนมีฟิลด์นี้" กับ "คำนวณแล้วไม่มีค่า"
// และห้ามใส่ค่าเดา — 0 กิโลเมตร/0 นาที คือคำตอบที่ผิด ไม่ใช่คำตอบที่ว่าง
// ---------------------------------------------------------------------------

/**
 * ตัวเลขที่ใช้ได้จริงเท่านั้น — undefined/null/สตริงว่าง/NaN = null
 *
 * เช็ค null และสตริงว่างก่อน Number() โดยตั้งใจ: `Number(null)` คือ **0** และ
 * 0 ผ่าน `Number.isFinite` — เขียนแบบตรงไปตรงมาจะได้ระยะทาง 0 กม. / เวลา 0 นาที
 * สำหรับงานที่วัดไม่ได้เลย ซึ่งเป็นคำตอบที่ผิด ไม่ใช่คำตอบที่ว่าง
 * (กับดักเดียวกับที่ CLAUDE.md ของ bkk-frontend-next บันทึกไว้เรื่อง
 * `pickBatteryOptionId(opts, null)` ที่เคยหักค่าแบตของเครื่องที่ไม่มีใครพูดถึง)
 */
function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} result ผลลัพธ์จาก computeRiderFee
 * @param {number} [now] เวลา (ms) — รับเข้ามาเพื่อให้เทสตรึงค่าได้
 */
function riderFeeMeta(result, now = Date.now()) {
  const r = result || {};
  return {
    distance_km: finiteOrNull(r.distance_km),
    // เวลาเดินทางที่ Routes API ตอบมา — เดิมถูกคำนวณแล้วทิ้ง
    duration_min: finiteOrNull(r.duration_min),
    fee_by_vehicle: r.fee_by_vehicle || null,
    rates: r.rates || null,
    // ฐานที่ใช้วัดระยะทาง (เงิน) กับที่ใช้วัดเวลา (ETA) — คนละคำถาม
    travel_mode: r.travel_mode || null,
    eta_travel_mode: r.eta_travel_mode || null,
    // สาขาปลายทางที่ resolveBranchCoords เลือกได้ในรอบนั้น
    branch_source: r.branch_source || null,
    reason: r.reason || null,
    computed_at: now,
  };
}

module.exports = { riderFeeMeta, finiteOrNull };
