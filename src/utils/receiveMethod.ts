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
//
// Store-in MUST come from a real branch record (settings/branches) via
// buildStoreInBranchFields below — free text here used to smear the
// customer's home address into store_branch and left branch_details empty,
// so the customer tracking page fell back to a guessed default branch.
export function buildMethodLocationFields(newMethod: string, location: string): Record<string, any> {
  const loc = (location || '').trim() || null;
  if (newMethod === 'Store-in') return { store_branch: loc, cust_address: null };
  // Leaving Store-in: clear the branch snapshot too — the tracking page
  // resolves the live branch from branch_details.id and must not show a
  // stale branch on a job that is no longer Store-in.
  return { cust_address: loc, store_branch: null, branch_name: null, branch_details: null };
}

// Branch record as stored at settings/branches/{id} (see BranchManager).
export interface BranchRecord {
  id: string;
  name?: string;
  address?: string;
  mapInfo?: string;
  phone?: string;
  lat?: number;
  lng?: number;
  openHour?: number;
  closeHour?: number;
  isActive?: boolean;
  isOpen?: boolean;
}

// Store-in fields written by the ADMIN when picking a branch — the SAME
// shape validateAndCreateOrder (bkk-frontend-next functions) writes at
// customer checkout, so the tracking page (TrackDeliverySection /
// PickupDeliveryLegacy) resolves the live branch identically for both
// creation paths. branch_details.id is what the live-branch lookup keys on.
export function buildStoreInBranchFields(branch: BranchRecord): Record<string, any> {
  return {
    store_branch: branch.name || '',
    branch_name: branch.name || '',
    branch_details: {
      id: branch.id,
      name: branch.name || '',
      address: branch.address || '',
      phone: branch.phone || '',
      lat: branch.lat != null ? Number(branch.lat) : null,
      lng: branch.lng != null ? Number(branch.lng) : null,
      openHour: Number.isFinite(Number(branch.openHour)) ? Number(branch.openHour) : null,
      closeHour: Number.isFinite(Number(branch.closeHour)) ? Number(branch.closeHour) : null,
    },
    cust_address: null,
  };
}
