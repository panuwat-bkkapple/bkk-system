// statusColors — proof of ZERO visual change.
//
// The fixtures below are verbatim copies of the two maps this file replaced:
// the desktop StatusBadge styles that lived inline in
// features/trade-in/components/modal/TradeInUI.tsx and the mobile
// STATUS_COLORS that lived in pages/mobile/MobileTicketsPage.tsx, both as of
// the commit that introduced src/utils/statusColors.ts. Every status either
// surface used to style must come back byte-identical, and unknown statuses
// must hit the exact old fallbacks. If a hue-unification pass later changes
// colors on purpose, update the fixture rows in the same commit — that is
// the point: the diff of this file IS the visual changelog.
import { describe, it, expect } from 'vitest';
import {
  statusBadgeClass,
  statusChipColors,
  DESKTOP_BADGE_FALLBACK,
  MOBILE_CHIP_FALLBACK,
} from './statusColors';

const OLD_DESKTOP_BADGES: Record<string, string> = {
  'New Lead': 'bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500/20',
  'Following Up': 'bg-blue-50 text-blue-600 border-blue-200',
  'Appointment Set': 'bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm',
  'Waiting Drop-off': 'bg-indigo-100 text-indigo-700 border-indigo-200 border-dashed',
  'Awaiting Shipping': 'bg-indigo-50 text-indigo-600 border-indigo-200 border-dashed',
  'Active Leads': 'bg-purple-50 text-purple-600 border-purple-200 border-dashed',
  'Active Lead': 'bg-purple-50 text-purple-600 border-purple-200 border-dashed',
  'Assigned': 'bg-violet-100 text-violet-700 border-violet-200',
  'Rider Assigned': 'bg-violet-100 text-violet-700 border-violet-200',
  'Accepted': 'bg-blue-100 text-blue-700 border-blue-200',
  'Rider Accepted': 'bg-blue-100 text-blue-700 border-blue-200',
  'Heading to Customer': 'bg-sky-100 text-sky-700 border-sky-200',
  'Rider En Route': 'bg-sky-100 text-sky-700 border-sky-200',
  'Arrived': 'bg-teal-100 text-teal-700 border-teal-200',
  'Rider Arrived': 'bg-teal-100 text-teal-700 border-teal-200',
  'Drop-off Received': 'bg-purple-100 text-purple-700 border-purple-200',
  'Parcel In Transit': 'bg-blue-100 text-blue-700 border-blue-300',
  'Parcel Received': 'bg-orange-100 text-orange-700 border-orange-200',
  'In-Transit': 'bg-blue-100 text-blue-700 border-blue-300 shadow-sm',
  'Rider Returning': 'bg-blue-100 text-blue-700 border-blue-300 shadow-sm',
  'Pending QC': 'bg-amber-100 text-amber-700 border-amber-200',
  'Being Inspected': 'bg-purple-100 text-purple-700 border-purple-200',
  'QC Review': 'bg-amber-100 text-amber-700 border-amber-200',
  'Discrepancy Reported': 'bg-rose-100 text-rose-700 border-rose-300 ring-2 ring-rose-500/20',
  'Revised Offer': 'bg-purple-100 text-purple-700 border-purple-200',
  'Negotiation': 'bg-orange-100 text-orange-700 border-orange-300 ring-2 ring-orange-500/20 shadow-md',
  'Price Accepted': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Payout Processing': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Waiting For Handover': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Paid': 'bg-green-100 text-green-700 border-green-200',
  'PAID': 'bg-green-100 text-green-700 border-green-200',
  'In Stock': 'bg-slate-100 text-slate-700 border-slate-200',
  'Cancelled': 'bg-red-50 text-red-700 border-red-100',
  'Closed (Lost)': 'bg-slate-800 text-slate-300 border-slate-700',
  'Drop-off Expired': 'bg-slate-100 text-slate-600 border-slate-200',
  'Shipping Expired': 'bg-slate-100 text-slate-600 border-slate-200',
  'Returned': 'bg-slate-700 text-slate-300 border-slate-800 shadow-inner',
  'Return Confirmed': 'bg-slate-700 text-slate-300 border-slate-800 shadow-inner',
};

const OLD_MOBILE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'New Lead':            { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  'New B2B Lead':        { bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  'Following Up':        { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  'Appointment Set':     { bg: 'bg-cyan-100',    text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  'Waiting Drop-off':    { bg: 'bg-teal-100',    text: 'text-teal-700',    dot: 'bg-teal-500' },
  'Active Leads':        { bg: 'bg-orange-100',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  'Assigned':            { bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  'Accepted':            { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  'Heading to Customer': { bg: 'bg-sky-100',     text: 'text-sky-700',     dot: 'bg-sky-500' },
  'Arrived':             { bg: 'bg-lime-100',    text: 'text-lime-700',    dot: 'bg-lime-500' },
  'In-Transit':          { bg: 'bg-yellow-100',  text: 'text-yellow-700',  dot: 'bg-yellow-500' },
  'Awaiting Shipping':   { bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  'Parcel In Transit':   { bg: 'bg-yellow-100',  text: 'text-yellow-700',  dot: 'bg-yellow-500' },
  'Parcel Received':     { bg: 'bg-orange-100',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  'Drop-off Received':   { bg: 'bg-teal-100',    text: 'text-teal-700',    dot: 'bg-teal-500' },
  'Being Inspected':     { bg: 'bg-purple-100',  text: 'text-purple-700',  dot: 'bg-purple-500' },
  'Pending QC':          { bg: 'bg-pink-100',    text: 'text-pink-700',    dot: 'bg-pink-500' },
  'QC Review':           { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500' },
  'Revised Offer':       { bg: 'bg-rose-100',    text: 'text-rose-700',    dot: 'bg-rose-500' },
  'Negotiation':         { bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500' },
  'Payout Processing':   { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'Paid':                { bg: 'bg-green-100',   text: 'text-green-700',   dot: 'bg-green-500' },
  'PAID':                { bg: 'bg-green-100',   text: 'text-green-700',   dot: 'bg-green-500' },
  'In Stock':            { bg: 'bg-slate-100',   text: 'text-slate-700',   dot: 'bg-slate-500' },
  'Cancelled':           { bg: 'bg-gray-100',    text: 'text-gray-600',    dot: 'bg-gray-400' },
  'Closed (Lost)':       { bg: 'bg-gray-100',    text: 'text-gray-600',    dot: 'bg-gray-400' },
  'Returned':            { bg: 'bg-gray-100',    text: 'text-gray-600',    dot: 'bg-gray-400' },
};

describe('statusColors preserves both old maps byte-for-byte', () => {
  it('desktop badge classes match the old inline StatusBadge map', () => {
    for (const [status, cls] of Object.entries(OLD_DESKTOP_BADGES)) {
      expect(statusBadgeClass(status), status).toBe(cls);
    }
  });

  it('mobile chip colors match the old STATUS_COLORS map', () => {
    for (const [status, colors] of Object.entries(OLD_MOBILE_COLORS)) {
      expect(statusChipColors(status), status).toEqual(colors);
    }
  });

  it('unknown statuses hit the exact old fallbacks on both surfaces', () => {
    for (const s of ['Completed', 'Sold', 'Parcel Lost', 'Refund Completed', 'no-such-status']) {
      expect(statusBadgeClass(s), s).toBe(DESKTOP_BADGE_FALLBACK);
      expect(statusChipColors(s), s).toEqual(MOBILE_CHIP_FALLBACK);
    }
    expect(DESKTOP_BADGE_FALLBACK).toBe('bg-slate-50 text-slate-600 border-slate-100');
    expect(MOBILE_CHIP_FALLBACK).toEqual({ bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' });
  });

  it('statuses that only one surface styled fall back on the other, as before', () => {
    // Canonical rider statuses had desktop badges but no mobile chip entry.
    expect(statusBadgeClass('Rider Assigned')).toBe(OLD_DESKTOP_BADGES['Rider Assigned']);
    expect(statusChipColors('Rider Assigned')).toEqual(MOBILE_CHIP_FALLBACK);
    // 'New B2B Lead' had a mobile chip but no desktop badge entry.
    expect(statusChipColors('New B2B Lead')).toEqual(OLD_MOBILE_COLORS['New B2B Lead']);
    expect(statusBadgeClass('New B2B Lead')).toBe(DESKTOP_BADGE_FALLBACK);
  });
});
