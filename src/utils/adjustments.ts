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
