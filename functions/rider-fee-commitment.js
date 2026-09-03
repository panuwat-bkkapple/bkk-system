// ---------------------------------------------------------------------------
// "ยอดที่ไรเดอร์เห็นตอนกดรับ คือยอดที่เขาได้" — ตรรกะล้วน เทสได้ offline
//
// ทำไมต้องมี: ระบบเดิมไม่มีแนวคิดเรื่อง **ข้อผูกพัน** เลย มันคำนวณค่ารอบใหม่
// ทุกครั้งที่ถูกถาม และถูกถามหลายครั้ง (ตอนสร้างงาน / เปลี่ยนวิธีรับ / หมุดขยับ /
// กดรับงาน / ส่งมอบ) ไม่มีจุดไหนที่ตัวเลขกลายเป็นสัญญา
//
// เคสจริง 1 ก.ย. 2569 (งาน OID-MTIAI3FH-851): ไรเดอร์กดรับเห็น ฿182 ปิดจ๊อบได้
// ฿157 เพราะ settings/logistics_rates.travel_mode ถูกสลับ 8 นาทีก่อนปิดจ๊อบ
// การคำนวณตอนจบงานอ่านค่าสดจาก DB จึงวัดเส้นทางด้วยฐานใหม่ ไม่มีอะไรพังสักจุด
// สูตรถูกทุกบรรทัด — สิ่งที่ผิดคือมันย้อนไปคิดเงินใหม่ให้งานที่รับปากไปแล้ว
//
// สแกนทั้งฐานข้อมูลพบ 50 ใบที่ยอดตอนจบไม่ตรงกับตอนกดรับ แยกเป็นสองสาเหตุ:
//   - มีคนเปลี่ยนค่า (3 ใบ) เอียงข้างเดียว เสีย 3 ได้เพิ่ม 0
//   - ระยะทางที่วัดได้แกว่งเอง (46 ใบ) สมมาตร เสีย 18 ได้เพิ่ม 18 เท่าเดิม 10
//     คลาดเคลื่อน ±41 บาท/ใบ ระยะเปลี่ยนเฉลี่ย 18.4% สูงสุด 51%
// การตรึงยอดปิดทั้งสองทางพร้อมกัน และเพราะกองที่สองสมมาตร **ต้นทุนรวมจึงไม่ขึ้น**
// ต่างจากการจ่าย max(สองจุด) ที่เก็บแต่หางบวก
// รายละเอียด: bkk-rider-app/docs/reports/2026-09-01-rider-fare-integrity-survey.md
// ---------------------------------------------------------------------------

/** ค่าของ rider_fee_meta.frozen_source เมื่อยอดถูกตรึงตอนกดรับ */
const FROZEN_AT_ACCEPT = "accepted";

/**
 * ยอดที่มีอยู่แล้วบนงาน "ห้ามแตะ" หรือไม่ — เรียกได้ **ก่อน** ยิง Routes API
 *
 * trigger เดิมตัดจบด้วย `rider_fee > 0` เฉยๆ ซึ่งพอเริ่มตรึงยอดตอนกดรับแล้วจะ
 * กลายเป็นการตัดเคส "แอดมินเปลี่ยนตัวไรเดอร์" ทิ้งไปด้วย — คนใหม่จะติดอยู่กับ
 * อัตราของคนเก่าซึ่งอาจเป็นคนละยานพาหนะ ฟังก์ชันนี้จึงแยกสองกรณีออกจากกัน
 * และอยู่ก่อน Routes API เพื่อไม่ให้เสียค่า API กับงานที่ยังไงก็ไม่แตะ
 */
function shouldSkipForSettledFee(job, riderId) {
  const existing = Number(job && job.rider_fee);
  if (!Number.isFinite(existing) || existing <= 0) return false; // ยังไม่มียอด = ทำต่อ

  const meta = (job && job.rider_fee_meta) || {};
  // ยอดที่มาจากการส่งมอบจริง / แอดมินตั้งเอง / คำแย้งหมุด = ประวัติแล้ว ห้ามเขียนทับ
  if (meta.frozen_source !== FROZEN_AT_ACCEPT) return true;
  if (meta.frozen_for_rider_id === riderId) return true;  // คนเดิม ไม่มีอะไรต้องทำ
  if (job.completed_at) return true;                      // ส่งมอบแล้ว ยอดนิ่งแล้ว
  return false;                                           // เปลี่ยนตัวไรเดอร์ = คิดใหม่ให้คนใหม่
}

/**
 * ตรึงยอดให้ไรเดอร์คนนี้หรือไม่ — คืนเหตุผลด้วยเสมอเพื่อให้ log อ่านออก
 *
 * @param {object} job         งานที่อ่านสดจาก DB
 * @param {string|null} riderId ไรเดอร์ที่ event นี้พูดถึง (ค่า after ของ rider_id)
 * @param {object} result      ผลจาก computeRiderFee
 */
function freezeDecision(job, riderId, result) {
  if (!riderId) return { freeze: false, why: "no_rider" };
  if (!job || job.receive_method !== "Pickup") return { freeze: false, why: "not_pickup" };

  // **คำนวณไม่ได้จริง = ห้ามตรึง** — Routes ล้ม / ไม่มีพิกัด จะได้ min_fee ซึ่งเป็น
  // "พื้น" ไม่ใช่ราคาของงานนี้ ตรึงมันไว้ = ล็อกไรเดอร์ไว้ที่พื้นตลอดไปทั้งที่งาน
  // อาจไกลมาก ปล่อยให้คิดใหม่ตอนส่งมอบตามพฤติกรรมเดิมดีกว่า — และเขาเห็น min_fee
  // อยู่แล้วตอนกดรับ การคิดใหม่ทีหลังจึงมีแต่ทำให้ได้เพิ่ม ไม่มีทางเสีย
  if (!result || result.reason !== "calculated") return { freeze: false, why: "not_calculated" };

  if (shouldSkipForSettledFee(job, riderId)) return { freeze: false, why: "fee_is_final" };

  const existing = Number(job.rider_fee);
  if (!Number.isFinite(existing) || existing <= 0) return { freeze: true, why: "first_freeze" };
  return { freeze: true, why: "reassigned" };
}

/**
 * meta ของยอดที่ตรึง — ต่อยอดจาก riderFeeMeta ปกติ เพิ่มสองฟิลด์ที่ตอบว่า
 * "เลขนี้ถูกตรึงเมื่อไหร่ และตรึงไว้ให้ใคร" ซึ่งเป็นข้อมูลที่ freezeDecision
 * ต้องใช้ตอนมีการเปลี่ยนตัวไรเดอร์ และที่คนอ่านย้อนหลังต้องใช้ตอนไล่บั๊ก
 */
function frozenFeeMeta(baseMeta, riderId, now) {
  return { ...baseMeta, frozen_source: FROZEN_AT_ACCEPT, frozen_for_rider_id: riderId, frozen_at: now };
}

const baht = (n) => `฿${Number(n).toLocaleString("th-TH")}`;

/**
 * บรรทัด qc_logs สำหรับทุกการเปลี่ยน rider_fee
 *
 * ทุกวันนี้การเขียน rider_fee **ไม่ทิ้งร่องรอยเลย** — onJobHandedOverCalcRiderFee
 * เขียนยอดโดยไม่เขียน log ต่างจาก trigger เพื่อนบ้านทุกตัว (onPickupLocationChanged,
 * onReceiveMethodChanged, recomputeCustomerPickupFee เขียนหมด) ผลคือเวลาไรเดอร์ถาม
 * ว่าทำไมยอดเปลี่ยน ไม่มีใครตอบได้จากระบบ ต้องไปนั่งอ่าน Cloud Functions log
 * ซึ่งมีอายุจำกัดและทีมปฏิบัติการเปิดไม่ได้ — การสืบเคส 1 ก.ย. กินเวลาเป็นวัน
 * เพราะเรื่องนี้ ถ้ามี log จะใช้เวลาห้านาที
 */
function riderFeeLogEntry({ from, to, cause, distanceKm, reason, riderId, now }) {
  const parts = [];
  if (Number.isFinite(Number(from)) && Number(from) > 0) {
    parts.push(`จากเดิม ${baht(from)}`);
  }
  if (Number.isFinite(Number(distanceKm))) parts.push(`ระยะ ${distanceKm} กม.`);
  if (reason && reason !== "calculated") parts.push(`ฐานคำนวณ: ${reason}`);
  if (riderId) parts.push(`ไรเดอร์ ${riderId}`);
  const CAUSE_TEXT = {
    frozen_at_accept: "ตรึงค่ารอบตามยอดที่ไรเดอร์เห็นตอนกดรับ",
    frozen_reassigned: "เปลี่ยนตัวไรเดอร์ — ตรึงค่ารอบใหม่ตามอัตราของคนที่ถืองาน",
    settled_at_handover: "คิดค่ารอบตอนส่งมอบเครื่อง",
  };
  return {
    action: "Rider Fee Set",
    by: "System",
    timestamp: now,
    details: `${CAUSE_TEXT[cause] || cause} ${baht(to)}${parts.length ? ` (${parts.join(" · ")})` : ""}`,
  };
}

/** qc_logs ปัจจุบันในรูป array — RTDB คืน object เมื่อคีย์ไม่ต่อเนื่อง */
function existingLogs(job) {
  const raw = job && job.qc_logs;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

module.exports = {
  FROZEN_AT_ACCEPT,
  shouldSkipForSettledFee,
  freezeDecision,
  frozenFeeMeta,
  riderFeeLogEntry,
  existingLogs,
};
