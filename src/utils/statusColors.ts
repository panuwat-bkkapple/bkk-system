// Status colors for the two job-list surfaces — single place to edit.
//
// Before this file, TradeInUI's StatusBadge (desktop) and MobileTicketsPage's
// STATUS_COLORS (mobile) each kept their own per-status map, so changing a
// status color meant finding and editing two files that had already drifted
// apart. This file merges them: one row per status carrying both shapes.
//
// TWO THINGS THIS FILE DELIBERATELY DOES NOT DO:
// - It does NOT unify the hues. Today the two surfaces disagree on ~15
//   statuses (New Lead: pink badge / blue chip, Negotiation: orange / red,
//   Pending QC: amber / pink, ...) and several canonical statuses have a
//   badge but no chip. Every value below is copied verbatim from the two
//   old maps — zero visual change, guarded byte-for-byte by
//   statusColors.test.ts. Picking one hue per status is a design decision
//   for the owner; when made, it is a one-line edit per row here.
// - It does NOT build classes dynamically (`bg-${hue}-100`): Tailwind keeps
//   only class strings it can see verbatim in the source, so every entry
//   must stay a complete literal.

export interface StatusChipColors {
  bg: string;
  text: string;
  dot: string;
}

interface StatusStyle {
  /** Desktop JobTable badge (TradeInUI StatusBadge) — full class string. */
  badge?: string;
  /** Mobile JobCard chip (MobileTicketsPage) — {bg, text, dot} triplet. */
  chip?: StatusChipColors;
}

// Fallbacks catch statuses with no entry (Completed, Sold, Parcel Lost,
// Refund Completed, ...). Desktop text was darkened to slate-600 in the
// recede work: slate-400 on slate-50 was 2.45:1 — near invisible.
export const DESKTOP_BADGE_FALLBACK = 'bg-slate-50 text-slate-600 border-slate-100';
export const MOBILE_CHIP_FALLBACK: StatusChipColors = {
  bg: 'bg-slate-100',
  text: 'text-slate-600',
  dot: 'bg-slate-400',
};

const STATUS_STYLES: Record<string, StatusStyle> = {
  // --- Sales pipeline ---
  'New Lead': {
    badge: 'bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500/20',
    chip: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  },
  'New B2B Lead': {
    chip: { bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  },
  'Following Up': {
    badge: 'bg-blue-50 text-blue-600 border-blue-200',
    chip: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
  },
  'Appointment Set': {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm',
    chip: { bg: 'bg-cyan-100', text: 'text-cyan-700', dot: 'bg-cyan-500' },
  },
  'Waiting Drop-off': {
    badge: 'bg-indigo-100 text-indigo-700 border-indigo-200 border-dashed',
    chip: { bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500' },
  },
  'Awaiting Shipping': {
    badge: 'bg-indigo-50 text-indigo-600 border-indigo-200 border-dashed',
    chip: { bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  },

  // --- Logistics & inspection (legacy + canonical) ---
  'Active Leads': {
    badge: 'bg-purple-50 text-purple-600 border-purple-200 border-dashed',
    chip: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  },
  'Active Lead': {
    badge: 'bg-purple-50 text-purple-600 border-purple-200 border-dashed',
    // Chip added with the Phase B writer flip (admin mobile now broadcasts
    // as canonical 'Active Lead') — mirrors the legacy plural's hue so the
    // list card does not fall back to the slate chip.
    chip: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  },
  'Assigned': {
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
    chip: { bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500' },
  },
  'Rider Assigned': {
    badge: 'bg-violet-100 text-violet-700 border-violet-200',
  },
  'Accepted': {
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    chip: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  },
  'Rider Accepted': {
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  'Heading to Customer': {
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    chip: { bg: 'bg-sky-100', text: 'text-sky-700', dot: 'bg-sky-500' },
  },
  'Rider En Route': {
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    // Chip added with the Phase B writer flip (admin mobile writes the
    // canonical en-route status instead of the overloaded 'In-Transit') —
    // sky to match its own badge hue.
    chip: { bg: 'bg-sky-100', text: 'text-sky-700', dot: 'bg-sky-500' },
  },
  'Arrived': {
    badge: 'bg-teal-100 text-teal-700 border-teal-200',
    chip: { bg: 'bg-lime-100', text: 'text-lime-700', dot: 'bg-lime-500' },
  },
  'Rider Arrived': {
    badge: 'bg-teal-100 text-teal-700 border-teal-200',
  },
  'Drop-off Received': {
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    chip: { bg: 'bg-teal-100', text: 'text-teal-700', dot: 'bg-teal-500' },
  },
  'Parcel In Transit': {
    badge: 'bg-blue-100 text-blue-700 border-blue-300',
    chip: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  },
  'Parcel Received': {
    badge: 'bg-orange-100 text-orange-700 border-orange-200',
    chip: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  },
  'In-Transit': {
    badge: 'bg-blue-100 text-blue-700 border-blue-300 shadow-sm',
    chip: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  },
  'Rider Returning': {
    badge: 'bg-blue-100 text-blue-700 border-blue-300 shadow-sm',
  },
  'Pending QC': {
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    chip: { bg: 'bg-pink-100', text: 'text-pink-700', dot: 'bg-pink-500' },
  },
  'Being Inspected': {
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    chip: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  },
  'QC Review': {
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    chip: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500' },
  },
  'Discrepancy Reported': {
    badge: 'bg-rose-100 text-rose-700 border-rose-300 ring-2 ring-rose-500/20',
  },
  'Revised Offer': {
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    chip: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
  },
  'Negotiation': {
    badge: 'bg-orange-100 text-orange-700 border-orange-300 ring-2 ring-orange-500/20 shadow-md',
    chip: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' },
  },
  'Price Accepted': {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },

  // --- Finance & inventory ---
  'Payout Processing': {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    chip: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  },
  'Waiting For Handover': {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  'Paid': {
    badge: 'bg-green-100 text-green-700 border-green-200',
    chip: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  },
  'PAID': {
    badge: 'bg-green-100 text-green-700 border-green-200',
    chip: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  },
  'In Stock': {
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    chip: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500' },
  },

  // --- Closed / cancelled — these chips sit on receded rows and keep their
  // weight there, so the text must clear WCAG AA by itself: red-500 on
  // red-50 was 3.44:1 (red-700 is 5.91:1), slate/gray-500 on the -100
  // surfaces was ~4.3:1 (the -600 shades clear 6.9:1). ---
  'Cancelled': {
    badge: 'bg-red-50 text-red-700 border-red-100',
    chip: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  },
  'Closed (Lost)': {
    badge: 'bg-slate-800 text-slate-300 border-slate-700',
    chip: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  },
  'Drop-off Expired': {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  'Shipping Expired': {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  'Returned': {
    badge: 'bg-slate-700 text-slate-300 border-slate-800 shadow-inner',
    chip: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  },
  'Return Confirmed': {
    badge: 'bg-slate-700 text-slate-300 border-slate-800 shadow-inner',
  },
};

export function statusBadgeClass(status: string): string {
  return STATUS_STYLES[status]?.badge ?? DESKTOP_BADGE_FALLBACK;
}

export function statusChipColors(status: string): StatusChipColors {
  return STATUS_STYLES[status]?.chip ?? MOBILE_CHIP_FALLBACK;
}
