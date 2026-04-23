// =============================================================================
// Status groupings for filters, badges, and reports.
//
// Canonical reference: bkk-frontend-next/app/constants/orderStatus.ts +
// bkk-frontend-next/docs/order-status-flow.md.
// =============================================================================

import type { JobStatus } from '../types/domain';
import { JobStatusB2C, JobStatusB2B } from '../types/domain';

// ---------------------------------------------------------------------------
// Finance / payout reporting
// ---------------------------------------------------------------------------

/**
 * Statuses that should be treated as "paid / post-payment" for finance
 * reconciliation reports. Paired with a `paid_at` timestamp check — the
 * timestamp is authoritative; this list is a read-side safety net so jobs
 * stuck in an intermediate post-payment state still appear on finance pages.
 *
 * Dual-read: includes legacy `Payment Completed` (B2B historical) and the
 * ephemeral `Sent to QC Lab`.
 */
export const POST_PAYMENT_READ_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.WAITING_FOR_HANDOVER,
  JobStatusB2C.PAID,
  JobStatusB2C.IN_STOCK,
  JobStatusB2C.SOLD,
  JobStatusB2C.COMPLETED,
  JobStatusB2B.PAYMENT_COMPLETED,
  JobStatusB2B.IN_STOCK,
  JobStatusB2B.COMPLETED,
  // Legacy dual-read (safe to delete after migration grace period)
  JobStatusB2C.SENT_TO_QC_LAB,
  JobStatusB2C.PENDING_QC,
];

/**
 * Statuses where rider settlement has to be reconciled — the job is closed
 * from the customer's perspective but the rider fee has not been paid out yet.
 */
export const RIDER_SETTLEMENT_READ_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.PENDING_QC,
  JobStatusB2C.COMPLETED,
  JobStatusB2C.WAITING_FOR_HANDOVER,
];

// ---------------------------------------------------------------------------
// Kanban / workspace tabs
// ---------------------------------------------------------------------------

/**
 * QC workspace inbox. Physical device is at the branch and needs QC action.
 */
export const QC_STATION_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.PENDING_QC,
  JobStatusB2C.WAITING_FOR_HANDOVER,
  JobStatusB2C.SENT_TO_QC_LAB,
];

/**
 * QC stage check — covers all statuses where the device is under inspection.
 * Used by workspace filters like `isQCStage`.
 */
export const QC_STAGE_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.PENDING_QC,
  JobStatusB2C.QC_REVIEW,
  JobStatusB2C.BEING_INSPECTED,
];

/**
 * Logistics lane — rider is active or device is in motion.
 */
export const LOGISTICS_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.NEW_LEAD,
  JobStatusB2C.ACTIVE_LEADS,
  JobStatusB2C.ASSIGNED,
  JobStatusB2C.ACCEPTED,
  JobStatusB2C.HEADING_TO_CUSTOMER,
  JobStatusB2C.ARRIVED,
  JobStatusB2C.SHIPPING,
  JobStatusB2C.IN_TRANSIT, // legacy overloaded — remove post-migration
  JobStatusB2C.RIDER_RETURNING,
  JobStatusB2C.BEING_INSPECTED,
  JobStatusB2C.PENDING_QC,
  JobStatusB2C.QC_REVIEW,
  JobStatusB2C.REVISED_OFFER,
  JobStatusB2C.NEGOTIATION,
  JobStatusB2C.PRICE_ACCEPTED,
  JobStatusB2C.PAYOUT_PROCESSING,
  JobStatusB2C.WAITING_FOR_HANDOVER,
];

/**
 * Mobile ticket "จ่ายเงิน" stage group.
 */
export const PAYMENT_STAGE_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.PAYOUT_PROCESSING,
  JobStatusB2C.WAITING_FOR_HANDOVER,
  JobStatusB2C.PAID,
  JobStatusB2C.SENT_TO_QC_LAB,
  JobStatusB2C.IN_STOCK,
  JobStatusB2C.READY_TO_SELL,
  JobStatusB2C.SOLD,
  JobStatusB2C.COMPLETED,
  JobStatusB2C.PAID_UPPER, // legacy uppercase
];

/**
 * TradeInUI Phase 4 Finance pipe.
 */
export const PHASE_4_FINANCE_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.PAYOUT_PROCESSING,
  JobStatusB2C.WAITING_FOR_HANDOVER,
  JobStatusB2C.PAID,
  JobStatusB2C.PAID_UPPER, // legacy uppercase
  JobStatusB2C.PENDING_QC,
  JobStatusB2C.IN_STOCK,
  JobStatusB2C.READY_TO_SELL,
];

/**
 * History / closed jobs list (rider app parity).
 */
export const CLOSED_FOR_RIDER_STATUSES: readonly JobStatus[] = [
  JobStatusB2C.PENDING_QC,
  JobStatusB2C.IN_STOCK,
  JobStatusB2C.PAID,
  JobStatusB2C.PAID_UPPER,
  JobStatusB2C.COMPLETED,
  JobStatusB2C.RETURNED,
  JobStatusB2C.CLOSED_LOST,
  JobStatusB2C.CANCELLED,
];

// ---------------------------------------------------------------------------
// Terminal statuses (mirrors functions/index.js TERMINAL_STATUSES)
// ---------------------------------------------------------------------------

/**
 * A job in any of these statuses is considered final for lifecycle purposes
 * (archive + KPIs + cannot-cancel check). Keep in sync with the Cloud
 * Functions copy in `functions/index.js` — the server uses the same list to
 * decide archive eligibility.
 */
export const TERMINAL_STATUSES: readonly JobStatus[] = [
  // B2C terminal
  JobStatusB2C.PAID,
  JobStatusB2C.IN_STOCK,
  JobStatusB2C.SOLD,
  JobStatusB2C.CANCELLED,
  // B2B terminal
  JobStatusB2B.COMPLETED,
  // Legacy
  JobStatusB2C.CLOSED_LOST,
  JobStatusB2C.RETURNED,
];

export function isTerminal(status: JobStatus | string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(String(status));
}

/** Defensive cancel check — tolerates legacy casing. */
export function isCancelled(raw: string | null | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'cancelled';
}
