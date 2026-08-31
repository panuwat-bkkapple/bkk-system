// Which job-list tab does a B2C job belong to?
//
// Both list pages (TradeInDashboard's Sales/Logistics/Closed filter and
// MobileTicketsPage's เปิดงาน/ดำเนินการ/ปิดงาน pills) used to keep their own
// hand-written status arrays, and the two had drifted: the desktop list was
// missing every canonical rider status ('Rider Assigned', ...), 'Awaiting
// Shipping', and the Mail-in/Store-in intermediates, so those jobs silently
// fell out of every named tab on desktop while still appearing on mobile.
// This classifier replaces both, built on normalizeStatus/getPhase from the
// shared enum so new canonical values keep working without list edits.
//
// Tab semantics are NOT a 1:1 phase mapping — three deliberate exceptions,
// each preserving what the two pages already agreed on:
// - 'Active Lead' is PHASE.CREATED, but an Instant Sell job skips the sales
//   stage by construction: both pages show it under in-progress.
// - PHASE.PAYOUT splits: 'Paid' means the customer side is settled (closed
//   tab), while 'Payout Processing'/'Waiting For Handover' are still work.
// - PHASE.INVENTORY splits: 'Pending QC' still needs hands on the device
//   (in progress); from 'Sent To QC Lab' onward the ticket reads as closed.
//
// B2B statuses are outside the B2C enum and return null (fail open: the job
// still shows under "ทั้งหมด"/All). The mobile page special-cases 'New B2B
// Lead' itself; the desktop B2B workspace has its own filter on the B2B enum
// (separate redesign track, see JobStatusB2B in types/domain.ts).

import {
  getPhase,
  JOB_STATUS,
  normalizeStatus,
  PHASE,
} from '../types/job-statuses';

/** sales = เปิดงาน · active = ดำเนินการ · closed = ปิดงาน */
export type JobListPhase = 'sales' | 'active' | 'closed';

export function jobListPhaseOf(
  rawStatus: string | null | undefined,
  receiveMethod?: string | null
): JobListPhase | null {
  const status = normalizeStatus(rawStatus, receiveMethod);
  if (!status) return null;

  if (status === JOB_STATUS.ACTIVE_LEAD) return 'active';
  if (status === JOB_STATUS.PAID) return 'closed';
  if (status === JOB_STATUS.PENDING_QC) return 'active';

  switch (getPhase(status)) {
    case PHASE.CREATED:
    case PHASE.SALES:
      return 'sales';
    case PHASE.LOGISTICS:
    case PHASE.INSPECTION:
    case PHASE.PAYOUT:
    case PHASE.RETURN_TO_STORE:
    case PHASE.EXCEPTION:
      return 'active';
    case PHASE.INVENTORY:
    case PHASE.PENDING_CLOSE:
    case PHASE.TERMINAL:
      return 'closed';
  }
}
