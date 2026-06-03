// Appointment / pickup_schedule helpers — shared by the mobile ticket detail
// edit modal and the desktop PricingSidebar so both write the same shape.
//
// `pickup_schedule` is reused across receive methods (Pickup / Store-in /
// Mail-in). Historically `time` held either a single "HH:MM" (admin scheduler)
// or a range string "HH:MM - HH:MM" (customer bookings send a slot). We now
// always persist a structured start/end PLUS the combined `time` string so the
// many readers that show `pickup_schedule.time` verbatim (calendar, customer
// tracking, ticket detail) keep working without changes.

export interface PickupSchedule {
  type?: string;
  date?: string;
  time?: string;
  time_start?: string;
  time_end?: string;
  rescheduled_at?: number;
}

const RANGE_SEP = /\s*[-–—]\s*/;

// Pull start/end out of an existing schedule. Prefers the structured fields,
// falling back to parsing the legacy combined `time` string.
export function parseTimeRange(ps?: PickupSchedule | null): { start: string; end: string } {
  if (!ps) return { start: '', end: '' };
  if (ps.time_start || ps.time_end) {
    return { start: ps.time_start || '', end: ps.time_end || '' };
  }
  const raw = ps.time && ps.time !== 'Instant' ? ps.time : '';
  if (!raw) return { start: '', end: '' };
  const parts = raw.split(RANGE_SEP);
  return { start: (parts[0] || '').trim(), end: (parts[1] || '').trim() };
}

// The date currently on the schedule, or '' for instant / unscheduled jobs.
export function existingApptDate(ps?: PickupSchedule | null): string {
  return ps?.date && ps.date !== 'Instant' ? ps.date : '';
}

// Combined display string from start + optional end.
export function composeTimeRange(start: string, end: string): string {
  if (start && end) return `${start} - ${end}`;
  return start || end || '';
}

// Build the object to persist. When `isReschedule` is true we stamp
// `rescheduled_at` so downstream (calendar, notifications) can tell an edit
// from an initial set. RTDB rejects `undefined`, so the field is only added
// when relevant.
export function buildPickupSchedule(
  date: string,
  start: string,
  end: string,
  isReschedule: boolean,
): PickupSchedule {
  const ps: PickupSchedule = {
    type: 'scheduled',
    date,
    time: composeTimeRange(start, end),
    time_start: start,
    time_end: end || '',
  };
  if (isReschedule) ps.rescheduled_at = Date.now();
  return ps;
}
