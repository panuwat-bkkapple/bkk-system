// ยอดโอนสุทธิที่ฝ่ายบัญชีจ่ายลูกค้า — ตัวเดียวของสองจอจ่ายเงิน
//
// เดิม getNetPayout ถูกเขียนไว้ในจอเดสก์ท็อป (TradeInPayouts) กับจอมือถือ
// (MobileFinancePage) คนละก๊อปปี้ — และตั้งแต่ writer ย้ายขึ้น server
// (confirmPayoutTransfer, 4 ก.ย. 2569) เลขนี้มี**คนอ่านคนที่สาม**ที่ตัดสินจริง:
// functions/payout-ledger.js `netPayoutOf` คิดจากแถวในธุรกรรมแล้วปฏิเสธถ้าไม่ตรง
// กับเลขที่จอส่งไป (amount_changed). สูตรสองฝั่งจึงต้องเท่ากันทุกกรณี
// ด่าน: payoutNet.test.ts require ไฟล์ JS นั้นมารันบน fixture เดียวกัน
//
// คิดสดจาก final_price ทุกครั้ง — ไม่ใช้ net_payout ที่เก็บใน DB เพราะบาง path
// (เช่น Internal QC เก่า) อัปเดต final_price โดยไม่ sync net_payout ทำให้ค่าค้าง
import { sumAppliedAdjustments, sumAppliedCoupons } from './adjustments';

export interface PayoutJobLike {
  final_price?: unknown;
  price?: unknown;
  receive_method?: string | null;
  pickup_fee?: unknown;
  rider_fee_discount?: unknown;
}

/**
 * MIRROR ของ `netPayoutOf` ใน functions/payout-ledger.js — แก้ต้องแก้ทั้งคู่
 * รับ unknown เหมือน sumAppliedCoupons: จอส่งแถวงานรูปต่างกัน (any / type เฉพาะจอ)
 */
export function getNetPayout(job: unknown): number {
  const j = (job ?? {}) as PayoutJobLike;
  const base = Number(j.final_price || j.price || 0);
  // Effective fee = gross pickup_fee minus the absorbed rider-fee discount.
  const pickup = j.receive_method === 'Pickup';
  const grossFee = pickup ? Number(j.pickup_fee || 0) : 0;
  const riderFeeDiscount = pickup ? Number(j.rider_fee_discount || 0) : 0;
  const pickupFee = Math.max(0, grossFee - riderFeeDiscount);
  return Math.max(0, base - pickupFee + sumAppliedCoupons(j) + sumAppliedAdjustments(j));
}
