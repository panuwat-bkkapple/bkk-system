// Helpers for changing a job's receive_method (trade method) after creation —
// shared by the mobile ticket detail edit modal and the desktop PricingSidebar.
//
// The CLIENT only writes the method + the matching location field + a qc_log.
// All money reconciliation (pickup_fee, net_payout, rider_fee_estimate) and the
// rider withdrawal/notification are handled server-side by the
// `onReceiveMethodChanged` Cloud Function, so the distance-based rider-fee
// estimate uses the same `computeRiderFee` logic as everywhere else and there's
// a single source of truth for fees.

export const RECEIVE_METHOD_OPTIONS = [
  { id: 'Pickup', label: 'รับถึงที่ (Pickup)' },
  { id: 'Store-in', label: 'เข้าสาขา (Store-in)' },
  { id: 'Mail-in', label: 'ส่งไปรษณีย์ (Mail-in)' },
] as const;

// Once the device is physically in hand, money has moved, the parcel has
// shipped, or the job is terminal, switching the trade method no longer makes
// sense (and would strand fees/status). Allow it only before those points.
const METHOD_LOCKED_STATUSES = new Set([
  'being inspected', 'qc review', 'pending qc', 'parcel received', 'drop-off received',
  'waiting for handover', 'waiting for finance', 'payout processing', 'price accepted',
  'paid', 'payment completed', 'sent to qc lab', 'in stock', 'sold', 'completed',
  'rider returning', 'returned', 'closed (lost)', 'cancelled', 'withdrawal completed',
  'in-transit', 'parcel in transit',
]);

export function canChangeReceiveMethod(status?: string): boolean {
  return !METHOD_LOCKED_STATUSES.has((status || '').trim().toLowerCase());
}

// Label for the location field given the (selected) method.
export function locationLabel(method: string): string {
  if (method === 'Store-in') return 'สาขานัดหมาย';
  if (method === 'Mail-in') return 'ที่อยู่ลูกค้า (อ้างอิง)';
  return 'ที่อยู่รับเครื่อง';
}

// Where the location currently lives on the job, by its method.
export function currentLocation(job: any): string {
  return (job?.receive_method === 'Store-in' ? job?.store_branch : job?.cust_address) || '';
}

// Field updates for the location given the (selected) method. Store-in keeps it
// in store_branch; Pickup / Mail-in keep it in cust_address. The inactive field
// is nulled so stale data from the previous method doesn't linger.
export function buildMethodLocationFields(newMethod: string, location: string): Record<string, any> {
  const loc = (location || '').trim() || null;
  if (newMethod === 'Store-in') return { store_branch: loc, cust_address: null };
  return { cust_address: loc, store_branch: null };
}
