// src/utils/logisticsRevenue.ts
//
// แถว ledger "รายได้ค่าบริการรับเครื่อง" (LOGISTICS_REVENUE) — helper กลางตัวเดียว
// ของทั้ง 3 จุดที่บันทึกตอนจ่ายเงินลูกค้า (TradeInPayouts, MobileFinancePage,
// TransactionRepair). ห้าม inline ก้อนนี้ที่อื่นอีก — สามสำเนาที่เคยมีคือ
// เหตุที่บั๊กเดียวกันอยู่ครบทั้งสามที่
//
// นิยามธุรกิจ (เคาะโดยเจ้าของงาน 31 ส.ค. 2569 — ดู bkk-rider-app
// docs/reports/2026-08-31-rider-wallet-fix-plan.md):
//   "รายได้ค่าไรเดอร์ของบริษัท" = ค่าบริการที่เก็บจากลูกค้า (effective
//   pickup_fee) — คนละก้อนกับ "ค่าวิ่งของไรเดอร์" (rider_fee ซึ่งเป็นต้นทุน)
//
// ของเดิมผิดสองชั้นและแก้พร้อมกันที่นี่:
//   1. rider_id เคยเป็นของไรเดอร์ → กระเป๋าไรเดอร์นับรายได้บริษัทเป็นเงิน
//      ตัวเอง (วัดจริง: บวม 3,776 จาก 15 แถว). แถวรายได้บริษัทต้องเป็น
//      'SYSTEM' เสมอ ไม่ว่างานจะมีไรเดอร์หรือไม่
//   2. amount เคยเป็น rider_fee (ต้นทุน) → ตอนนี้เป็นค่าบริการที่เก็บจริง
//      = max(0, pickup_fee − rider_fee_discount) เฉพาะงาน Pickup และเป็น 0
//      เมื่อมีคูปองส่งฟรี (type 'service') ตามเศรษฐศาสตร์เดียวกับตอนสร้างงาน
//      (validateAndCreateOrder: isFreeDeliveryCoupon → grossFee = 0)
//
// ผลข้างเคียงที่ประกาศแล้ว: การ์ดรายรับของ FinanceAuditLog เปลี่ยนฐานจาก
// "ต้นทุนไรเดอร์" เป็น "ค่าบริการที่เก็บจริง" ตั้งแต่แถวใหม่เป็นต้นไป

import { listAppliedCoupons } from './adjustments';

interface JobLike {
  id?: string;
  ref_no?: string;
  receive_method?: string;
  pickup_fee?: unknown;
  rider_fee_discount?: unknown;
}

/** คูปองส่งฟรี (type 'service') ล้างค่าส่งทั้งก้อน — บริษัทไม่ได้เก็บอะไร */
export function hasFreeDeliveryCoupon(job: unknown): boolean {
  return listAppliedCoupons(job).some((c) => (c as { type?: string })?.type === 'service');
}

/** ค่าบริการรับเครื่องที่เก็บจากลูกค้าจริง — 0 เมื่อไม่ใช่ Pickup / ส่งฟรี */
export function effectiveCustomerPickupFee(job: JobLike | null | undefined): number {
  if (!job || job.receive_method !== 'Pickup') return 0;
  if (hasFreeDeliveryCoupon(job)) return 0;
  const gross = Number(job.pickup_fee || 0);
  const discount = Number(job.rider_fee_discount || 0);
  return Math.max(0, gross - discount);
}

export interface LogisticsRevenueTx {
  rider_id: 'SYSTEM';
  amount: number;
  type: 'CREDIT';
  category: 'LOGISTICS_REVENUE';
  description: string;
  timestamp: number;
  ref_job_id: string;
}

/**
 * แถว CREDIT รายได้ค่าบริการรับเครื่องสำหรับงานหนึ่งใบ — คืน null เมื่อไม่มี
 * ค่าบริการให้บันทึก (ไม่ใช่ Pickup / fee 0 / ส่งฟรี) แปลว่า caller ไม่ต้อง
 * เขียนแถวเลย ไม่ใช่เขียนแถวศูนย์บาท
 */
export function buildLogisticsRevenueTx(
  job: JobLike | null | undefined,
  timestamp: number,
  opts?: { repair?: boolean },
): LogisticsRevenueTx | null {
  const fee = effectiveCustomerPickupFee(job);
  if (!(fee > 0) || !job?.id) return null;
  const prefix = opts?.repair ? '[ซ่อม] ' : '';
  return {
    rider_id: 'SYSTEM',
    amount: fee,
    type: 'CREDIT',
    category: 'LOGISTICS_REVENUE',
    description: `${prefix}รายได้ค่าบริการรับเครื่อง (ค่าส่งที่เก็บจากลูกค้า) - Ref: ${job.ref_no || job.id}`,
    timestamp,
    ref_job_id: job.id,
  };
}
