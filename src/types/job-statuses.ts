/**
 * BKK Job Status — single source of truth (B2C lifecycle)
 *
 * This file is duplicated verbatim across three repos:
 *   - bkk-system            (this file is the source)
 *   - bkk-frontend-next     (app/types/job-statuses.ts)
 *   - bkk-rider-app         (src/types/job-statuses.ts)
 *
 * A CI check (.github/workflows/sync-status-enum.yml) fails if the three
 * copies drift. When you change this file, copy it byte-for-byte into the
 * other two repos in the same PR cycle.
 *
 * B2B statuses live in JobStatusB2B inside ./domain.ts and are NOT covered
 * here yet (separate redesign track).
 */

// =============================================================================
// Status enum
// =============================================================================

export const JOB_STATUS = {
  // Phase 1: Created
  NEW_LEAD: 'New Lead',
  ACTIVE_LEAD: 'Active Lead',

  // Phase 2: Sales (pre-handoff)
  FOLLOWING_UP: 'Following Up',
  APPOINTMENT_SET: 'Appointment Set',
  WAITING_DROP_OFF: 'Waiting Drop-off',
  AWAITING_SHIPPING: 'Awaiting Shipping',

  // Phase 3a: Logistics (Pickup)
  RIDER_ASSIGNED: 'Rider Assigned',
  RIDER_ACCEPTED: 'Rider Accepted',
  RIDER_EN_ROUTE: 'Rider En Route',
  RIDER_ARRIVED: 'Rider Arrived',

  // Phase 3b: Logistics (Store-in)
  DROP_OFF_RECEIVED: 'Drop-off Received',

  // Phase 3c: Logistics (Mail-in)
  PARCEL_IN_TRANSIT: 'Parcel In Transit',
  PARCEL_RECEIVED: 'Parcel Received',

  // Phase 4: Inspection
  BEING_INSPECTED: 'Being Inspected',
  DISCREPANCY_REPORTED: 'Discrepancy Reported',
  QC_REVIEW: 'QC Review',
  REVISED_OFFER: 'Revised Offer',
  NEGOTIATION: 'Negotiation',
  PRICE_ACCEPTED: 'Price Accepted',

  // Phase 5: Payout
  PAYOUT_PROCESSING: 'Payout Processing',
  WAITING_FOR_HANDOVER: 'Waiting For Handover',
  PAID: 'Paid',

  // Phase 6: Return-to-store (Pickup only)
  RIDER_RETURNING: 'Rider Returning',

  // Phase 7: Inventory
  PENDING_QC: 'Pending QC',
  SENT_TO_QC_LAB: 'Sent To QC Lab',
  IN_STOCK: 'In Stock',
  READY_TO_SELL: 'Ready To Sell',
  SOLD: 'Sold',
  COMPLETED: 'Completed',

  // Terminal — cancellation paths
  CANCELLED: 'Cancelled',
  CLOSED_LOST: 'Closed (Lost)',
  DROP_OFF_EXPIRED: 'Drop-off Expired',
  SHIPPING_EXPIRED: 'Shipping Expired',

  // Mail-in carrier issues
  INVESTIGATING_CARRIER: 'Investigating Carrier',
  PARCEL_LOST: 'Parcel Lost',

  // Return path (device goes back to customer)
  RETURNING_TO_CUSTOMER: 'Returning To Customer',
  RETURN_CONFIRMED: 'Return Confirmed',

  // Post-paid recovery
  DISPUTED: 'Disputed',
  REFUND_INITIATED: 'Refund Initiated',
  REFUND_COMPLETED: 'Refund Completed',
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

// =============================================================================
// Phase grouping — used by dashboards and customer tracking timelines
// =============================================================================

export const PHASE = {
  CREATED: 'created',
  SALES: 'sales',
  LOGISTICS: 'logistics',
  INSPECTION: 'inspection',
  PAYOUT: 'payout',
  RETURN_TO_STORE: 'return_to_store',
  INVENTORY: 'inventory',
  TERMINAL: 'terminal',
  EXCEPTION: 'exception',
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

const STATUS_TO_PHASE: Record<JobStatus, Phase> = {
  [JOB_STATUS.NEW_LEAD]: PHASE.CREATED,
  [JOB_STATUS.ACTIVE_LEAD]: PHASE.CREATED,

  [JOB_STATUS.FOLLOWING_UP]: PHASE.SALES,
  [JOB_STATUS.APPOINTMENT_SET]: PHASE.SALES,
  [JOB_STATUS.WAITING_DROP_OFF]: PHASE.SALES,
  [JOB_STATUS.AWAITING_SHIPPING]: PHASE.SALES,

  [JOB_STATUS.RIDER_ASSIGNED]: PHASE.LOGISTICS,
  [JOB_STATUS.RIDER_ACCEPTED]: PHASE.LOGISTICS,
  [JOB_STATUS.RIDER_EN_ROUTE]: PHASE.LOGISTICS,
  [JOB_STATUS.RIDER_ARRIVED]: PHASE.LOGISTICS,
  [JOB_STATUS.DROP_OFF_RECEIVED]: PHASE.LOGISTICS,
  [JOB_STATUS.PARCEL_IN_TRANSIT]: PHASE.LOGISTICS,
  [JOB_STATUS.PARCEL_RECEIVED]: PHASE.LOGISTICS,

  [JOB_STATUS.BEING_INSPECTED]: PHASE.INSPECTION,
  [JOB_STATUS.DISCREPANCY_REPORTED]: PHASE.INSPECTION,
  [JOB_STATUS.QC_REVIEW]: PHASE.INSPECTION,
  [JOB_STATUS.REVISED_OFFER]: PHASE.INSPECTION,
  [JOB_STATUS.NEGOTIATION]: PHASE.INSPECTION,
  [JOB_STATUS.PRICE_ACCEPTED]: PHASE.INSPECTION,

  [JOB_STATUS.PAYOUT_PROCESSING]: PHASE.PAYOUT,
  [JOB_STATUS.WAITING_FOR_HANDOVER]: PHASE.PAYOUT,
  [JOB_STATUS.PAID]: PHASE.PAYOUT,

  [JOB_STATUS.RIDER_RETURNING]: PHASE.RETURN_TO_STORE,

  [JOB_STATUS.PENDING_QC]: PHASE.INVENTORY,
  [JOB_STATUS.SENT_TO_QC_LAB]: PHASE.INVENTORY,
  [JOB_STATUS.IN_STOCK]: PHASE.INVENTORY,
  [JOB_STATUS.READY_TO_SELL]: PHASE.INVENTORY,
  [JOB_STATUS.SOLD]: PHASE.INVENTORY,
  [JOB_STATUS.COMPLETED]: PHASE.TERMINAL,

  [JOB_STATUS.CANCELLED]: PHASE.TERMINAL,
  [JOB_STATUS.CLOSED_LOST]: PHASE.TERMINAL,
  [JOB_STATUS.DROP_OFF_EXPIRED]: PHASE.TERMINAL,
  [JOB_STATUS.SHIPPING_EXPIRED]: PHASE.TERMINAL,

  [JOB_STATUS.INVESTIGATING_CARRIER]: PHASE.EXCEPTION,
  [JOB_STATUS.PARCEL_LOST]: PHASE.TERMINAL,

  [JOB_STATUS.RETURNING_TO_CUSTOMER]: PHASE.EXCEPTION,
  [JOB_STATUS.RETURN_CONFIRMED]: PHASE.TERMINAL,

  [JOB_STATUS.DISPUTED]: PHASE.EXCEPTION,
  [JOB_STATUS.REFUND_INITIATED]: PHASE.EXCEPTION,
  [JOB_STATUS.REFUND_COMPLETED]: PHASE.TERMINAL,
};

export function getPhase(status: JobStatus): Phase {
  return STATUS_TO_PHASE[status];
}

export function isTerminal(status: JobStatus): boolean {
  return STATUS_TO_PHASE[status] === PHASE.TERMINAL;
}

// =============================================================================
// Cancel taxonomy
// =============================================================================

export const CANCEL_CATEGORY = {
  CUSTOMER_CHANGED_MIND: 'customer_changed_mind',
  CUSTOMER_NO_SHOW: 'customer_no_show',
  RIDER_ISSUE: 'rider_issue',
  DEVICE_MISMATCH: 'device_mismatch',
  HIDDEN_DAMAGE: 'hidden_damage',
  PRICE_DISAGREEMENT: 'price_disagreement',
  FRAUD_SUSPECTED: 'fraud_suspected',
  PARCEL_LOST: 'parcel_lost',
  SLA_TIMEOUT: 'sla_timeout',
  OTHER: 'other',
} as const;

export type CancelCategory =
  (typeof CANCEL_CATEGORY)[keyof typeof CANCEL_CATEGORY];

export const CANCEL_CATEGORY_LABEL_TH: Record<CancelCategory, string> = {
  customer_changed_mind: 'ลูกค้าเปลี่ยนใจ',
  customer_no_show: 'ลูกค้าไม่มา / ติดต่อไม่ได้',
  rider_issue: 'ปัญหาฝั่งไรเดอร์',
  device_mismatch: 'เครื่องไม่ตรงใบสั่ง',
  hidden_damage: 'พบความเสียหายซ่อน',
  price_disagreement: 'เจรจาราคาไม่ลงตัว',
  fraud_suspected: 'สงสัยฉ้อโกง',
  parcel_lost: 'ขนส่งทำพัสดุหาย',
  sla_timeout: 'หมดเวลา (ระบบยกเลิกอัตโนมัติ)',
  other: 'อื่น ๆ',
};

// =============================================================================
// Legacy → canonical adapter
//
// The DB still contains legacy values (e.g. 'PAID', 'Active Leads', 'Assigned',
// 'In-Transit') from before this redesign. Reader code should call
// normalizeStatus() before comparing against JOB_STATUS values. Writers should
// always emit canonical values from JOB_STATUS.
//
// `In-Transit` is overloaded — Pickup uses it for "rider returning" and
// Mail-in uses it for "parcel in transit" — so the adapter needs the
// receive_method to disambiguate.
// =============================================================================

const LEGACY_ALIAS: Record<string, JobStatus> = {
  // Casing/format aliases
  PAID: JOB_STATUS.PAID,
  'Payment Completed': JOB_STATUS.PAID,
  'Active Leads': JOB_STATUS.ACTIVE_LEAD, // plural → singular

  // Renamed statuses
  Assigned: JOB_STATUS.RIDER_ASSIGNED,
  Accepted: JOB_STATUS.RIDER_ACCEPTED,
  'Heading to Customer': JOB_STATUS.RIDER_EN_ROUTE,
  Arrived: JOB_STATUS.RIDER_ARRIVED,
  Returned: JOB_STATUS.RETURN_CONFIRMED,
};

export function normalizeStatus(
  legacy: string | null | undefined,
  receiveMethod?: string | null
): JobStatus | null {
  if (!legacy) return null;

  // Already canonical
  if ((Object.values(JOB_STATUS) as string[]).includes(legacy)) {
    return legacy as JobStatus;
  }

  // The 'In-Transit' overload — split by receive_method
  if (legacy === 'In-Transit') {
    return receiveMethod === 'Pickup'
      ? JOB_STATUS.RIDER_RETURNING
      : JOB_STATUS.PARCEL_IN_TRANSIT;
  }

  return LEGACY_ALIAS[legacy] ?? null;
}

// =============================================================================
// Receive method
// =============================================================================

export const RECEIVE_METHOD = {
  PICKUP: 'Pickup',
  STORE_IN: 'Store-in',
  MAIL_IN: 'Mail-in',
} as const;

export type ReceiveMethod =
  (typeof RECEIVE_METHOD)[keyof typeof RECEIVE_METHOD];
