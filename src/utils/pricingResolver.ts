// Single source of truth for trade-in condition deductions.
//
// Deduction precedence per option: pct > deduct > legacy tiers.
//   pct    — percentage-of-base, scales smoothly with the variant price
//   deduct — single flat baht value (condition sets are authored per model now,
//            so one value per option is exact; replaces the t1/t2/t3 buckets)
//   t1/t2/t3 — LEGACY tier buckets picked by base price. No longer authorable in
//            the Engine UI; kept ONLY as a read fallback so condition sets that
//            have not been re-saved / cloned yet keep resolving identically.
//
// The four copy-pasted calculators (admin inspection, internal QC, customer
// SellPageClient, and the server validateAndCreateOrder) MUST stay in sync —
// change one mirror -> change them all (see the cross-repo rule in CLAUDE.md).

export interface ConditionOptionLike {
  id?: string;
  label?: string;
  name?: string;
  /** LEGACY tier buckets — read-only fallback for unmigrated data. */
  t1?: number;
  t2?: number;
  t3?: number;
  /**
   * Single flat baht deduction. The standard fixed-amount mode now that
   * condition sets are per-model. Takes precedence over legacy t1/t2/t3.
   */
  deduct?: number;
  /**
   * Percentage-of-base deduction (e.g. 35 = 35% of the model's base price).
   * When set to a finite number >= 0 it takes precedence over BOTH `deduct`
   * and the legacy tiers, and scales smoothly with price (no buckets).
   */
  pct?: number;
}

export interface ConditionGroupLike {
  title?: string;
  options?: ConditionOptionLike[];
}

/**
 * LEGACY tier deduction for a base price — the old 3-bucket logic:
 *   base >= 30,000 -> t1 | 15,000-29,999 -> t2 | < 15,000 -> t3
 * Only used as a fallback when an option has no `deduct` and no `pct`.
 */
export function tierDeduction(opt: ConditionOptionLike, basePrice: number): number {
  const b = Number(basePrice) || 0;
  if (b >= 30000) return Number(opt?.t1 || 0);
  if (b >= 15000) return Number(opt?.t2 || 0);
  return Number(opt?.t3 || 0);
}

/** Normalize a model's liquidity multiplier (default 1; must be > 0). */
export function normalizeLiquidityFactor(lf: unknown): number {
  const n = Number(lf);
  return n > 0 ? n : 1;
}

/** Whether an option uses percentage mode (a finite `pct` >= 0). */
export function isPercentOption(opt: ConditionOptionLike): boolean {
  if (opt?.pct == null) return false;
  const p = Number(opt.pct);
  return Number.isFinite(p) && p >= 0;
}

/** Whether an option carries a single flat baht deduction (a finite `deduct` >= 0). */
export function isFixedDeductOption(opt: ConditionOptionLike): boolean {
  if (opt?.deduct == null) return false;
  const d = Number(opt.deduct);
  return Number.isFinite(d) && d >= 0;
}

/**
 * Resolve one condition option's baht deduction for a model.
 *   percentage mode: round(basePrice × pct/100 × liquidityFactor)
 *   fixed mode:      round(deduct × liquidityFactor)
 *   legacy tiers:    round(tierDeduction × liquidityFactor)   [fallback only]
 * Mirrors admin inspection, internal QC, SellPageClient and the server.
 */
export function resolveOptionDeduction(
  opt: ConditionOptionLike,
  basePrice: number,
  liquidityFactor: unknown = 1,
): number {
  const lf = normalizeLiquidityFactor(liquidityFactor);
  if (isPercentOption(opt)) {
    return Math.round(((Number(basePrice) || 0) * Number(opt.pct)) / 100 * lf);
  }
  if (isFixedDeductOption(opt)) {
    return Math.round(Number(opt.deduct) * lf);
  }
  return Math.round(tierDeduction(opt, basePrice) * lf);
}

export interface DeductionLine {
  groupTitle: string;
  label: string;
  optionId: string;
  amount: number;
}

/**
 * Sum the deductions for a set of selected option ids across all groups.
 * Returns the total plus a per-line breakdown (for display / labels).
 */
export function resolveDeductions(
  groups: ConditionGroupLike[] | null | undefined,
  selectedOptionIds: Iterable<string>,
  basePrice: number,
  liquidityFactor: unknown = 1,
): { total: number; lines: DeductionLine[] } {
  const selected = new Set(selectedOptionIds);
  const lines: DeductionLine[] = [];
  let total = 0;
  for (const group of groups || []) {
    for (const opt of group?.options || []) {
      if (opt?.id != null && selected.has(opt.id)) {
        const amount = resolveOptionDeduction(opt, basePrice, liquidityFactor);
        total += amount;
        lines.push({
          groupTitle: group.title || '',
          label: opt.label || opt.name || '',
          optionId: opt.id,
          amount,
        });
      }
    }
  }
  return { total, lines };
}

/** Final price after deductions (never below 0). */
export function resolveFinalPrice(basePrice: number, totalDeduction: number): number {
  return Math.max(0, (Number(basePrice) || 0) - (Number(totalDeduction) || 0));
}
