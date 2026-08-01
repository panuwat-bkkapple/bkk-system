/**
 * Return-to-customer flow (ปฏิเสธรับซื้อ → ส่งเครื่องคืนลูกค้า)
 *
 * Data contract — fields on jobs/{id} that travel together:
 *   status: 'Returning To Customer' → 'Return Confirmed'
 *   return_reason / return_initiated_at / return_initiated_by  (ตอนเริ่มส่งคืน)
 *   return_tracking_number / return_shipped_at                 (Mail-in: เลขพัสดุขากลับ)
 *   return_confirmed_at / return_confirmed_by                  (ตอนปิดงาน)
 *
 * Cross-repo readers (grep before changing field names):
 *   - bkk-frontend-next: track page shows return_tracking_number via the
 *     public_track mirror (functions/src/publicTrack.ts PUBLIC_TRACK_FIELDS
 *     + the backfill mirror in this repo's functions/index.js)
 *   - bkk-system functions: onReturnTrackingSent emails the customer the
 *     return tracking number; email.js Return Confirmed copy includes it
 *
 * Entry points into 'Returning To Customer':
 *   1. Customer declines a revised offer on /track (bkk-frontend-next
 *      app/api/jobs/action decline-revision) — no return_reason written.
 *   2. Admin rejects the purchase from the ticket UI (mobile panel /
 *      desktop PricingSidebar) via buildReturnInitFields below.
 */

import { JOB_STATUS } from '@/types/job-statuses';

/**
 * Statuses (lowercase) from which an admin may reject the purchase and start
 * a return. Device must be at the branch and unpaid — i.e. the inspection /
 * price-decision phase of a Mail-in or Store-in job. 'Pending QC' here is the
 * PRE-payment variant only (the paid guard below excludes the post-payment
 * one used by the Pickup resale pipeline).
 */
const RETURN_ELIGIBLE_STATUSES = [
  'parcel received',
  'drop-off received',
  'being inspected',
  'qc review',
  'discrepancy reported',
  'revised offer',
  'negotiation',
  'pending qc',
];

/** True when the job was ever paid — returning a paid device is a refund
 *  (Disputed / Refund Initiated) flow, not this one. */
export function jobWasPaid(job: any): boolean {
  if (!job) return false;
  if (job.paid_at || job.payment_slip) return true;
  const logs = Array.isArray(job.qc_logs) ? job.qc_logs : [];
  return logs.some(
    (l: any) => l && typeof l.action === 'string' && l.action.toLowerCase() === 'paid'
  );
}

/**
 * Admin may start the return flow: unpaid Mail-in / Store-in job sitting in
 * the inspection or price-decision phase. Pickup is excluded — a rejected
 * Pickup never leaves the customer's hands (the rider simply doesn't take
 * it), so that path is Cancel, not Return.
 */
export function canStartReturn(job: any): boolean {
  if (!job) return false;
  if (job.receive_method === 'Pickup') return false;
  if (jobWasPaid(job)) return false;
  const status = String(job.status || '').trim().toLowerCase();
  return RETURN_ELIGIBLE_STATUSES.includes(status);
}

/** จุดที่งานอยู่ระหว่างส่งคืน (รอส่ง/รอลูกค้ารับ) */
export function isReturning(job: any): boolean {
  return (
    String(job?.status || '').trim().toLowerCase() ===
    JOB_STATUS.RETURNING_TO_CUSTOMER.toLowerCase()
  );
}

/** เริ่มส่งคืน: ปฏิเสธรับซื้อ + เหตุผล (แอดมินเป็นผู้เริ่ม) */
export function buildReturnInitFields(reason: string, byName: string) {
  return {
    status: JOB_STATUS.RETURNING_TO_CUSTOMER,
    return_reason: reason.trim(),
    return_initiated_at: Date.now(),
    return_initiated_by: byName,
    updated_at: Date.now(),
  };
}

/** บันทึกเลขพัสดุขากลับ (Mail-in) — trigger onReturnTrackingSent จะส่งอีเมลแจ้งลูกค้า */
export function buildReturnShipFields(trackingNumber: string) {
  return {
    return_tracking_number: trackingNumber.trim(),
    return_shipped_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** ปิดงานส่งคืน: เครื่องถึงมือลูกค้าแล้ว (terminal) */
export function buildReturnConfirmFields(byName: string) {
  return {
    status: JOB_STATUS.RETURN_CONFIRMED,
    return_confirmed_at: Date.now(),
    return_confirmed_by: byName,
    updated_at: Date.now(),
  };
}
