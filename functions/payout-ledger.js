// เงินตอน "ฝ่ายบัญชีโอนเงินให้ลูกค้าแล้ว" — ส่วน pure ของ confirmPayoutTransfer
//
// MIRROR ของฝั่งแอดมิน (bkk-system/src) ที่ต้องเห็นเลขเดียวกับที่ server เขียน:
//   netPayoutOf              <-> src/utils/payoutNet.ts        (getNetPayout)
//   effectiveCustomerPickupFee / hasFreeDeliveryCoupon / buildLogisticsRevenueTx
//                            <-> src/utils/logisticsRevenue.ts
// ด่าน: src/utils/payoutNet.test.ts require ไฟล์นี้มารันบน fixture ชุดเดียวกัน
// (รูปเดียวกับ riderPushHealth.test.ts) — แก้สูตรฝั่งไหนต้องแก้ทั้งคู่
//
// ทำไมยอดโอนคิดที่ server อีกรอบทั้งที่หน้าจอคิดแล้ว: หน้าจอส่ง `expectedNetPayout`
// มาเป็น "เลขที่คนกดเห็น" เท่านั้น ตัวที่ลง ledger คือเลขที่คิดจากแถวจริง**ในธุรกรรม**
// (payoutGuard) ถ้าสองเลขไม่ตรง = มีใครแก้ราคาระหว่างที่หน้าจอเปิดค้าง → ปฏิเสธ
// ไม่ใช่โอนตามเลขเก่าแล้วค่อยมาตามเก็บ (ดู scripts/audit-payouts.cjs)
const { sumAppliedAdjustments, listAppliedCoupons, sumAppliedCoupons } = require("./job-money");
const { B2B_JOB_TYPES } = require("./status-engine");

const RECEIVE_PICKUP = "Pickup";

/** ล็อตเหมาองค์กร — ชุดเดียวกับที่ engine ใช้กั้นแถว B2B (jobTypes) */
function isB2BPayout(job) {
  return B2B_JOB_TYPES.includes(job && job.type);
}

/**
 * ยอดโอนสุทธิ — คิดสดจาก final_price ทุกครั้ง ไม่ใช้ net_payout ที่เก็บใน DB
 * (บาง path เก่าอัปเดต final_price โดยไม่ sync net_payout ทำให้ค่าค้าง)
 */
function netPayoutOf(job) {
  const j = job || {};
  const base = Number(j.final_price || j.price || 0);
  const pickup = j.receive_method === RECEIVE_PICKUP;
  const grossFee = pickup ? Number(j.pickup_fee || 0) : 0;
  const riderFeeDiscount = pickup ? Number(j.rider_fee_discount || 0) : 0;
  const pickupFee = Math.max(0, grossFee - riderFeeDiscount);
  return Math.max(0, base - pickupFee + sumAppliedCoupons(j) + sumAppliedAdjustments(j));
}

/** คูปองส่งฟรี (type 'service') ล้างค่าส่งทั้งก้อน — บริษัทไม่ได้เก็บอะไร */
function hasFreeDeliveryCoupon(job) {
  return listAppliedCoupons(job).some((c) => c && c.type === "service");
}

/** ค่าบริการรับเครื่องที่เก็บจากลูกค้าจริง — 0 เมื่อไม่ใช่ Pickup / ส่งฟรี */
function effectiveCustomerPickupFee(job) {
  if (!job || job.receive_method !== RECEIVE_PICKUP) return 0;
  if (hasFreeDeliveryCoupon(job)) return 0;
  const gross = Number(job.pickup_fee || 0);
  const discount = Number(job.rider_fee_discount || 0);
  return Math.max(0, gross - discount);
}

/**
 * แถว CREDIT รายได้ค่าบริการรับเครื่อง — null เมื่อไม่มีค่าบริการให้บันทึก
 * (caller ไม่ต้องเขียนแถวเลย ไม่ใช่เขียนแถวศูนย์บาท)
 */
function buildLogisticsRevenueTx(job, timestamp, opts) {
  const fee = effectiveCustomerPickupFee(job);
  if (!(fee > 0) || !job || !job.id) return null;
  const prefix = opts && opts.repair ? "[ซ่อม] " : "";
  return {
    rider_id: "SYSTEM",
    amount: fee,
    type: "CREDIT",
    category: "LOGISTICS_REVENUE",
    description: `${prefix}รายได้ค่าบริการรับเครื่อง (ค่าส่งที่เก็บจากลูกค้า) - Ref: ${job.ref_no || job.id}`,
    timestamp,
    ref_job_id: job.id,
  };
}

/** แถว DEBIT เงินรับซื้อที่จ่ายลูกค้า — รูปเดิมของ payoutTransfer.ts ทุกฟิลด์ */
function buildPayoutDebitTx({ job, netPayout, transferredAt, slipUrl }) {
  const custName = String((job && job.cust_name) || "").split("(")[0];
  return {
    rider_id: "SYSTEM",
    amount: netPayout,
    type: "DEBIT",
    category: isB2BPayout(job) ? "B2B_PURCHASE" : "TRADE_IN_PAYOUT",
    description: `จ่ายเงินรับซื้อสุทธิ ${job.model} (${custName})`,
    // ledger เงินสดอิงเวลาโอนจริง ไม่ใช่เวลาที่กดบันทึก
    timestamp: transferredAt,
    ref_job_id: job.id,
    slip_url: slipUrl,
  };
}

/**
 * ฟิลด์ domain ที่ไปใน patch ของ applyTransition — **ต้องครบทั้ง 6 ชื่อ** เพราะแต่ละ
 * ตัวมีคนอ่านคนละที่ (payment_slip = ตัวที่ทำให้งานหายจากคิวจ่ายเงิน + has_payment_slip
 * บน public_track; transferred_at = อีเมล/ใบสำคัญรับเงิน; paid_by = Traceability;
 * bank_* = InvoicePage) — ดูตารางข้อ 2 ในรายงาน 2026-09-04 cross-repo survey
 */
const PAYOUT_PATCH_FIELDS = ["transferred_at", "paid_by", "payment_slip", "bank_name", "bank_account", "bank_holder"];

function buildPayoutPatch({ transferredAt, paidBy, slipUrl, bank }) {
  return {
    transferred_at: transferredAt,
    paid_by: paidBy,
    payment_slip: slipUrl,
    bank_name: bank.name,
    bank_account: bank.account,
    bank_holder: bank.holder,
  };
}

/** วันเวลาแบบเดียวกับ formatDate ของหน้าแอดมิน (th-TH, เวลาไทย) */
function formatThaiDateTime(ts) {
  return new Date(ts).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

/** ข้อความในไทม์ไลน์ (qc_logs.details) — ข้อความเดิมของ payoutTransfer.ts */
function payoutLogDetails({ netPayout, bank, transferredAt }) {
  return `ฝ่ายบัญชีโอนเงินสำเร็จ ยอดสุทธิ ฿${Number(netPayout).toLocaleString()} เข้าบัญชี ${bank.name} (${bank.account}) เมื่อ ${formatThaiDateTime(transferredAt)}`;
}

/**
 * "บัญชีนี้จ่ายเงินออกได้ไหม" — MIRROR ของ evaluateFinanceGate (src/utils/financeGate.ts)
 * ลำดับเดียวกันห้ามสลับ: CEO เสมอ → claim → (เพิ่มจากฝั่งหน้าจอ: role FINANCE
 * ตาม financeActorVerdict) → ยังไม่เปิด enforce = ผ่านแบบ legacy → ปฏิเสธ
 *
 * ทำไมไม่ใช้ financeActorVerdict ตรงๆ: มันไม่มีขา legacy — ใช้แล้ว MANAGER/STAFF
 * ที่หน้าจอยังให้กดได้ (enforce ปิด) จะโดน server ปฏิเสธ = ปุ่มที่โกหกคนกด
 * (คอมเมนต์ใน financeGate.ts เขียนเรื่องนี้ไว้ตรงตัว)
 */
function payoutGateVerdict({ role, hasClaim, enforce }) {
  const r = String(role || "").toUpperCase();
  if (r === "CEO") return { allowed: true, reason: "ceo" };
  if (hasClaim === true) return { allowed: true, reason: "claim" };
  if (r === "FINANCE") return { allowed: true, reason: "finance_role" };
  if (!enforce) return { allowed: true, reason: "legacy_admin" };
  return { allowed: false, reason: "no_claim" };
}

/**
 * guard ที่รัน**ในธุรกรรม**ของ applyTransition — สองด่านที่ตาราง engine ตอบไม่ได้
 *   1. จ่ายซ้ำ: แถวมี paid_at หรือ payment_slip แล้ว (payment_confirmed ไม่มี
 *      blockedWhenPaid เพราะ from-list กันไว้แล้วในทางปกติ — นี่คือชั้นสองสำหรับ
 *      สองแท็บที่กดพร้อมกัน)
 *   2. ยอดเปลี่ยน: เลขที่คนกดเห็นไม่เท่าเลขจากแถวจริง
 * `seen.net` เก็บเลขของรอบที่ commit จริง (RTDB replay callback ได้) ให้ caller
 * เอาไปลง ledger — ไม่ใช่เลขจากการอ่านก่อนธุรกรรม
 */
function payoutGuard({ expectedNetPayout, seen }) {
  return (current) => {
    if (current.paid_at || current.payment_slip) {
      return { code: "already_paid", message: "งานนี้บันทึกการโอนเงินไปแล้ว" };
    }
    const live = netPayoutOf(current);
    seen.net = live;
    if (Math.round(live) !== Math.round(Number(expectedNetPayout))) {
      return {
        code: "amount_changed",
        message: `ยอดโอนสุทธิเปลี่ยนจาก ฿${Number(expectedNetPayout).toLocaleString()} เป็น ฿${live.toLocaleString()} ระหว่างที่หน้านี้เปิดอยู่ — รีเฟรชแล้วตรวจยอดใหม่ก่อนโอน`,
      };
    }
    return null;
  };
}

module.exports = {
  isB2BPayout,
  netPayoutOf,
  hasFreeDeliveryCoupon,
  effectiveCustomerPickupFee,
  buildLogisticsRevenueTx,
  buildPayoutDebitTx,
  buildPayoutPatch,
  PAYOUT_PATCH_FIELDS,
  payoutLogDetails,
  formatThaiDateTime,
  payoutGateVerdict,
  payoutGuard,
};
