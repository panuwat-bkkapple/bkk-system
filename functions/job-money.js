// เงินบนงานหนึ่งใบ — ตัวรวมที่ทุก writer ฝั่ง server ต้องใช้ร่วมกัน
//
// ย้ายออกมาจาก index.js (4 ก.ย. 2569) ตอนที่ callable confirmPayoutTransfer
// ต้องคิดยอดโอนสุทธิฝั่ง server เอง — ไฟล์ที่ require index.js ไม่ได้ (มัน
// initializeApp ตอนโหลด) ต้องการฟังก์ชันชุดนี้แบบ pure. โค้ดเหมือนเดิมทุกตัวอักษร
// ยังนับเป็นสำเนาเดิมของ MIRROR 4 ที่ ไม่ได้เพิ่มสำเนาใหม่

// Sum of admin/rider ad-hoc price adjustments that are currently APPLIED (a
// negative amount deducts, positive adds). Proposals still `pending` or
// `rejected` are ignored so they never move the payout until approved. Stored at
// jobs/{id}/adjustments (array or push-keyed object). Mirrored verbatim in
// bkk-frontend-next/functions/src/index.ts and the three clients — keep in sync.
function sumAppliedAdjustments(job) {
  const raw = job && job.adjustments;
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : []);
  return list.reduce((sum, a) => {
    if (!a || a.status !== "applied") return sum;
    const amt = Number(a.amount);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);
}

// คูปองบนงาน — รูปแบบหลายใบ
//
// งานหนึ่งใบถือคูปองได้หนึ่งใบต่อหนึ่ง bucket (คูปองที่ผูกกับสินค้าได้ทุกเครื่อง +
// คูปองรีวิว 1 ใบ + คูปองโปรโมชั่นระดับออเดอร์ 1 ใบ) เก็บที่
// jobs/{id}/applied_coupons ส่วนงานเก่าและ Manual Top-up ของแอดมินยังเป็น object
// เดี่ยว jobs/{id}/applied_coupon เหมือนเดิม. ตอนสร้างงานเรายังเขียน
// `applied_coupon` ให้เป็นใบที่มูลค่าสูงสุดด้วย เพื่อให้ UI ที่ยังไม่ย้ายโชว์ได้
// **จึงห้ามบวกทั้งสองรูปแบบ** (จะนับซ้ำ) — array มาก่อนเสมอ
//
// MIRROR 4 ที่ (ต้อง sync): bkk-frontend-next/functions/src/index.ts,
// bkk-frontend-next/app/utils/jobPricing.ts, bkk-system/src/utils/adjustments.ts,
// bkk-rider-app/src/utils/adjustments.ts
function listAppliedCoupons(job) {
  const raw = job && job.applied_coupons;
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : []);
  const present = list.filter(Boolean);
  if (present.length > 0) return present;
  return (job && job.applied_coupon) ? [job.applied_coupon] : [];
}

// เงินที่คูปองบวกเข้ายอดโอน — คูปองชนิด `service` (ส่งฟรี) ไม่มีตัวเงิน
// มันไปล้างค่าบริการรับเครื่องแทน
function sumAppliedCoupons(job) {
  return listAppliedCoupons(job).reduce((sum, c) => {
    if (!c || c.type === "service") return sum;
    const v = Number(c.actual_value != null ? c.actual_value : c.value);
    return Number.isFinite(v) ? sum + v : sum;
  }, 0);
}

module.exports = { sumAppliedAdjustments, listAppliedCoupons, sumAppliedCoupons };
