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
// B2B statuses return null (fail open: the job still shows under "ทั้งหมด"/All).
// The mobile page special-cases 'New B2B Lead' itself; the desktop B2B
// workspace has its own filter.
//
// **ตั้งแต่ P3-a การกันนี้ต้องเขียนให้ชัด ไม่ใช่ได้มาฟรี** — เดิมสถานะ B2B อยู่
// นอก enum ทำให้ normalizeStatus คืน null แล้วบรรทัด `if (!status) return null`
// จัดการให้เอง พอสาย B2B เข้า enum แล้ว มันอ่านออกและมี phase (New B2B Lead ->
// PHASE.CREATED) ซึ่งจะพางาน B2B ไปโผล่ในแท็บ "เปิดงาน" ของลิสต์ B2C
//
// เทส "unknown statuses return null" จับตอนที่เพิ่ม enum พอดี — ถ้าไม่มีมัน
// งาน B2B จะไหลเข้าลิสต์ B2C โดยไม่มีใครสังเกต

import {
  getPhase,
  JOB_STATUS,
  JOB_STATUS_B2B,
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
  // สาย B2B มีลิสต์ของตัวเอง — ไม่ปนกับแท็บของ B2C (ดูหมายเหตุด้านบน)
  if ((Object.values(JOB_STATUS_B2B) as string[]).includes(status)) return null;

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
