// Which existing bookings a new holiday would strand.
//
// The dates are the ones from the real incident (16-17 August 2026). The rule
// under test is deliberately lopsided — a booking flagged that did not need
// action costs one glance, a booking missed costs a customer standing outside
// a closed shop — so most of these pin the "still flag it" side.

import { describe, it, expect } from 'vitest';
import { findHolidayConflicts, isAwaitingHandover, bookedDateOf } from './holidayConflicts';
import { JOB_STATUS } from '../types/job-statuses';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  ref_no: 'BKK-0001',
  status: JOB_STATUS.APPOINTMENT_SET as string,
  receive_method: 'Store-in',
  pickup_schedule: { date: '2026-08-16', time: '12:00 - 14:00' },
  ...over,
});

describe('findHolidayConflicts', () => {
  it('finds the booking sitting on the day being closed', () => {
    const out = findHolidayConflicts([job()], ['2026-08-16']);
    expect(out.get('2026-08-16')).toHaveLength(1);
    expect(out.get('2026-08-16')![0].ref).toBe('BKK-0001');
  });

  it('ignores bookings on other days', () => {
    const out = findHolidayConflicts([job({ pickup_schedule: { date: '2026-08-18' } })], ['2026-08-16']);
    expect(out.size).toBe(0);
  });

  it('groups across several days at once', () => {
    const out = findHolidayConflicts([
      job({ id: 'a', pickup_schedule: { date: '2026-08-16' } }),
      job({ id: 'b', pickup_schedule: { date: '2026-08-17' } }),
      job({ id: 'c', pickup_schedule: { date: '2026-08-17' } }),
    ], ['2026-08-16', '2026-08-17']);
    expect(out.get('2026-08-16')).toHaveLength(1);
    expect(out.get('2026-08-17')).toHaveLength(2);
  });

  it('reads the legacy appointment_date when pickup_schedule is absent', () => {
    // Older jobs predate pickup_schedule. Missing them would be the exact
    // silent gap this check exists to close.
    const legacy = { id: 'old', status: JOB_STATUS.APPOINTMENT_SET as string, appointment_date: '2026-08-16', appointment_time: '10:00 - 12:00' };
    expect(bookedDateOf(legacy)).toBe('2026-08-16');
    const out = findHolidayConflicts([legacy], ['2026-08-16']);
    expect(out.get('2026-08-16')).toHaveLength(1);
    expect(out.get('2026-08-16')![0].time).toBe('10:00 - 12:00');
  });

  it('returns nothing when no dates are asked for', () => {
    expect(findHolidayConflicts([job()], []).size).toBe(0);
  });

  it('sorts each day by time so the list reads the same every load', () => {
    const out = findHolidayConflicts([
      job({ id: 'late', ref_no: 'B', pickup_schedule: { date: '2026-08-16', time: '18:00 - 20:00' } }),
      job({ id: 'early', ref_no: 'A', pickup_schedule: { date: '2026-08-16', time: '10:00 - 12:00' } }),
    ], ['2026-08-16']);
    expect(out.get('2026-08-16')!.map((r) => r.ref)).toEqual(['A', 'B']);
  });
});

describe('isAwaitingHandover — someone is still going to turn up', () => {
  it('flags jobs before the device reaches us', () => {
    for (const status of [
      JOB_STATUS.NEW_LEAD, JOB_STATUS.ACTIVE_LEAD, JOB_STATUS.FOLLOWING_UP,
      JOB_STATUS.APPOINTMENT_SET, JOB_STATUS.WAITING_DROP_OFF, JOB_STATUS.AWAITING_SHIPPING,
      JOB_STATUS.RIDER_ASSIGNED, JOB_STATUS.RIDER_ACCEPTED, JOB_STATUS.RIDER_EN_ROUTE,
      JOB_STATUS.RIDER_ARRIVED,
    ]) {
      expect(isAwaitingHandover(job({ status }))).toBe(true);
    }
  });

  it('does not flag jobs whose device already arrived', () => {
    // Same LOGISTICS phase as the rider statuses above, but the visit is done.
    for (const status of [JOB_STATUS.DROP_OFF_RECEIVED, JOB_STATUS.PARCEL_RECEIVED]) {
      expect(isAwaitingHandover(job({ status }))).toBe(false);
    }
  });

  it('does not flag jobs past inspection, payout, inventory or the end', () => {
    for (const status of [
      JOB_STATUS.BEING_INSPECTED, JOB_STATUS.QC_REVIEW, JOB_STATUS.PRICE_ACCEPTED,
      JOB_STATUS.PAYOUT_PROCESSING, JOB_STATUS.PAID,
      JOB_STATUS.IN_STOCK, JOB_STATUS.SOLD,
      JOB_STATUS.COMPLETED, JOB_STATUS.CLOSED_LOST, JOB_STATUS.RETURN_CONFIRMED,
    ]) {
      expect(isAwaitingHandover(job({ status }))).toBe(false);
    }
  });

  it('does not flag a cancelled job', () => {
    expect(isAwaitingHandover(job({ status: JOB_STATUS.CANCELLED }))).toBe(false);
  });

  it('flags a device on its way back to the customer', () => {
    // A return trip is a visit too, and it can land on the closed day just the
    // same as a pickup.
    expect(isAwaitingHandover(job({ status: JOB_STATUS.RETURNING_TO_CUSTOMER }))).toBe(true);
  });

  it('flags an unknown status rather than assuming it is finished', () => {
    // A status this file has not heard of is far more likely to be a new step
    // mid-flow than a new way of being done, and guessing wrong runs one way.
    expect(isAwaitingHandover(job({ status: 'Some Future Status' }))).toBe(true);
    expect(isAwaitingHandover(job({ status: '' }))).toBe(true);
    expect(isAwaitingHandover(job({ status: undefined }))).toBe(true);
  });

  it('keeps an unknown-status job in the conflict list', () => {
    const out = findHolidayConflicts([job({ status: 'Some Future Status' })], ['2026-08-16']);
    expect(out.get('2026-08-16')).toHaveLength(1);
  });
});
