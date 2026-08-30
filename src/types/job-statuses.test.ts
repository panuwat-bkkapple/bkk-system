// isRecededStatus — list-presentation gate for the job list pages.
//
// This test file is per-repo and NOT part of the byte-for-byte mirror of
// job-statuses.ts itself. Cases are written from real DB values (canonical
// AND the legacy strings normalizeStatus exists for), not from the spec —
// the legacy rows are the ones a list-page regression would silently miss.
import { describe, it, expect } from 'vitest';
import { isRecededStatus } from './job-statuses';

describe('isRecededStatus', () => {
  it('recedes every terminal status', () => {
    for (const s of [
      'Completed',
      'Closed (Lost)',
      'Drop-off Expired',
      'Shipping Expired',
      'Parcel Lost',
      'Return Confirmed',
      'Refund Completed',
    ]) {
      expect(isRecededStatus(s), s).toBe(true);
    }
  });

  it('recedes the Cancelled soft-close (PENDING_CLOSE, not terminal)', () => {
    // Distinguishes this function from plain isTerminal(): a version that
    // only checked PHASE.TERMINAL would fail here.
    expect(isRecededStatus('Cancelled')).toBe(true);
  });

  it('recedes legacy DB values via normalizeStatus', () => {
    // 'Returned' is the legacy alias of Return Confirmed — a version that
    // skipped normalization would fail here.
    expect(isRecededStatus('Returned')).toBe(true);
  });

  it('does not recede paid or inventory statuses — work remains after payout', () => {
    for (const s of ['Paid', 'PAID', 'Payment Completed', 'In Stock', 'Ready To Sell', 'Sold', 'Pending QC']) {
      expect(isRecededStatus(s), s).toBe(false);
    }
  });

  it('does not recede active pipeline or exception statuses', () => {
    for (const s of [
      'New Lead',
      'Following Up',
      'Being Inspected',
      'Negotiation',
      'Disputed',
      'Refund Initiated',
      'Investigating Carrier',
      'Returning To Customer',
    ]) {
      expect(isRecededStatus(s), s).toBe(false);
    }
  });

  it('resolves the In-Transit overload with receive_method and recedes neither', () => {
    expect(isRecededStatus('In-Transit', 'Pickup')).toBe(false); // Rider Returning
    expect(isRecededStatus('In-Transit', 'Mail-in')).toBe(false); // Parcel In Transit
  });

  it('fails open on unknown and empty statuses — never fade what it cannot classify', () => {
    // B2B statuses are outside the B2C enum; their literal Cancelled/Closed
    // values still recede because the strings overlap the B2C enum.
    for (const s of ['New B2B Lead', 'PO Issued', 'garbage-status', '', null, undefined]) {
      expect(isRecededStatus(s as string | null | undefined), String(s)).toBe(false);
    }
    expect(isRecededStatus('Cancelled')).toBe(true);
    expect(isRecededStatus('Closed (Lost)')).toBe(true);
  });
});
