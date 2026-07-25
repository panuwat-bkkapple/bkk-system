// Ad-hoc price adjustments on a job — itemised deductions/additions that admin
// QC or a rider (via approved amendment) records, instead of silently
// overwriting the total. Each line is transparent to the customer.
//
// net_payout folds in ONLY adjustments with status 'applied'. Rider-proposed
// lines start 'pending' and become 'applied' when an admin approves the
// amendment (server-side reviewAmendment). The canonical formula lives in the
// data contract (bkk-system/CLAUDE.md invariant #2); sumAppliedAdjustments is
// mirrored in bkk-frontend-next/functions, bkk-system/functions, and the rider
// app — keep all copies in sync.

export interface JobAdjustment {
  id: string;
  label: string;
  amount: number; // negative = deduct, positive = add (baht)
  device_index?: number;
  source: 'admin_qc' | 'admin_manual' | 'rider_proposed';
  status: 'applied' | 'pending' | 'rejected';
  by_uid?: string;
  by_name?: string;
  by_role?: string;
  at: number;
  reason?: string;
  evidence?: { url: string; uploaded_at?: number }[];
  // Approval trail — admin offers proposed by non-CEO/MANAGER staff start
  // 'pending' and need a CEO/MANAGER decision (push notified via the
  // onAdminOfferProposed cloud function). CEO/MANAGER-created lines are
  // self-approved on the spot so the trail is never empty.
  approved_by_uid?: string;
  approved_by_name?: string;
  approved_by_role?: string;
  approved_at?: number;
  rejected_by_name?: string;
  rejected_at?: number;
}

// Roles allowed to approve/reject a pending admin offer (and to create one
// that applies immediately). Everyone else proposes → pending.
export function canReviewAdjustments(role?: string): boolean {
  const r = String(role || '').toUpperCase();
  return r === 'CEO' || r === 'MANAGER';
}

// RTDB stores adjustments as an array or a push-keyed object depending on the
// writer — normalise to an array.
export function listAdjustments(job: unknown): JobAdjustment[] {
  const raw = (job as { adjustments?: unknown } | null)?.adjustments;
  if (Array.isArray(raw)) return raw as JobAdjustment[];
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, JobAdjustment>);
  return [];
}

export function sumAppliedAdjustments(job: unknown): number {
  return listAdjustments(job).reduce((sum, a) => {
    if (!a || a.status !== 'applied') return sum;
    const amt = Number(a.amount);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);
}
