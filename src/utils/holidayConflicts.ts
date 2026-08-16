// Bookings that would be stranded by declaring a day a holiday.
//
// MIRROR of bkk-frontend-next/app/utils/holidayConflicts.ts — same rule, same
// tests, two repos. It cannot be shared: each repo carries its own copy of
// job-statuses.ts (see the Data Contracts section in CLAUDE.md) and this reads
// getPhase() from it. **Change one, change both, and keep the tests in sync.**
//
// WHY: closing a day in the business-hours settings does nothing to
// appointments already booked on it. The customer keeps their confirmation,
// turns up at a locked door or waits for a rider nobody dispatched, and the
// shop finds out from the complaint. Nothing in the system was watching for
// that — the checkout picker fix only stops NEW bookings landing on a closed
// day.
//
// This is a WARNING, never a block. Closing a day at short notice is a real
// business decision (staff sick, flood, power cut); the shop still has to be
// able to do it. What it must not do is happen silently.
//
// The asymmetry matters and drives the rule below: flagging a booking that
// turns out not to need action costs one glance, while missing one costs a
// customer standing outside a closed shop. So when in doubt, flag it.

import { getPhase, JOB_STATUS, PHASE, type JobStatus, type Phase } from '../types/job-statuses';

/** The shape this reads off a job. Everything optional — real rows vary. */
export interface BookingLike {
  id: string;
  ref_no?: string;
  status?: string;
  receive_method?: string;
  pickup_schedule?: { date?: string; time?: string } | null;
  appointment_date?: string;
  appointment_time?: string;
}

export interface HolidayConflict {
  id: string;
  ref: string;
  /** Bangkok calendar date, YYYY-MM-DD. */
  date: string;
  time: string;
  method: string;
  status: string;
}

/**
 * Phases where the appointment is already behind us — the device is in our
 * hands (or the job is dead), so a closure on the booked date strands nobody.
 */
const SETTLED_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  PHASE.INSPECTION,
  PHASE.PAYOUT,
  PHASE.INVENTORY,
  PHASE.TERMINAL,
  PHASE.PENDING_CLOSE,
]);

/**
 * Logistics statuses that mean the device already arrived. The rest of
 * logistics (rider assigned / en route / arrived) is still a visit that has
 * not happened.
 */
const RECEIVED_STATUSES: ReadonlySet<string> = new Set<string>([
  JOB_STATUS.DROP_OFF_RECEIVED,
  JOB_STATUS.PARCEL_RECEIVED,
]);

/** The booked Bangkok date for a job, or '' when it has no appointment. */
export function bookedDateOf(job: BookingLike): string {
  return job.pickup_schedule?.date || job.appointment_date || '';
}

function bookedTimeOf(job: BookingLike): string {
  return job.pickup_schedule?.time || job.appointment_time || '';
}

/**
 * Is someone still expected to turn up for this job?
 *
 * Unknown statuses count as live on purpose: a status this file has not heard
 * of is far more likely to be a new step in the middle of the flow than a new
 * way of being finished, and the cost of guessing wrong runs one way.
 */
export function isAwaitingHandover(job: BookingLike): boolean {
  const status = (job.status || '') as JobStatus;
  if (RECEIVED_STATUSES.has(status)) return false;
  const phase = getPhase(status);
  if (!phase) return true;               // unknown status — flag it
  return !SETTLED_PHASES.has(phase);
}

/**
 * Bookings stranded by closing `dates`, grouped by date.
 *
 * Pure: the caller fetches the jobs (bounded by the created_at index — see the
 * note in the settings page) and decides what to do with the result.
 */
export function findHolidayConflicts(
  jobs: BookingLike[],
  dates: readonly string[],
): Map<string, HolidayConflict[]> {
  const wanted = new Set(dates.filter(Boolean));
  const out = new Map<string, HolidayConflict[]>();
  if (wanted.size === 0) return out;

  for (const job of jobs) {
    const date = bookedDateOf(job);
    if (!wanted.has(date)) continue;
    if (!isAwaitingHandover(job)) continue;

    const row: HolidayConflict = {
      id: job.id,
      ref: job.ref_no || job.id,
      date,
      time: bookedTimeOf(job),
      method: job.receive_method || '',
      status: job.status || '',
    };
    const bucket = out.get(date);
    if (bucket) bucket.push(row); else out.set(date, [row]);
  }

  // Stable order so the same data always reads the same way.
  for (const rows of out.values()) {
    rows.sort((a, b) => a.time.localeCompare(b.time) || a.ref.localeCompare(b.ref));
  }
  return out;
}
