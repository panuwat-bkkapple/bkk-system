import { ref, push, update } from 'firebase/database';
import { db } from '../../../api/firebase';
import { tierDeduction } from '../../../utils/pricingResolver';
import { writeConditionSet } from './conditionSets';

/**
 * Per-model condition-set tooling (เป้าหมาย: 1 รุ่น : 1 ชุดประเมิน).
 *
 * Shared home of the tier->deduct conversion used by BOTH the single-model
 * Clone button (ProductEditorModal) and the bulk "แตกชุดรายรุ่น" tool in the
 * Engine (EngineSettingsModal), so the conversion math lives in exactly one
 * place.
 */

/**
 * Representative used-price of a model for converting LEGACY tier options into
 * a single flat `deduct` while cloning a per-model condition set: median of the
 * variants' used prices, falling back to the modifier-mode base prices.
 */
export function representativeBasePrice(model: any): number {
  const prices = (model?.variants || [])
    .map((v: any) => Number(v?.usedPrice || v?.price || 0))
    .filter((p: number) => p > 0)
    .sort((a: number, b: number) => a - b);
  if (prices.length > 0) return prices[Math.floor(prices.length / 2)];
  return Number(model?.baseUsedPrice || 0) || Number(model?.baseNewPrice || 0) || 0;
}

/**
 * Convert cloned groups off the legacy tier system: each option that still
 * relies on t1/t2/t3 gets a single `deduct` resolved at the model's
 * representative price; options already on `deduct`/`pct` just drop stale tiers.
 */
export function convertGroupsToSingleDeduct(groups: any[], basePrice: number): any[] {
  return (groups || []).map((g: any) => ({
    ...g,
    options: (g?.options || []).map((o: any) => {
      const next: any = { ...o };
      if (next.deduct == null && next.pct == null && (next.t1 != null || next.t2 != null || next.t3 != null)) {
        next.deduct = tierDeduction(next, basePrice);
      }
      delete next.t1;
      delete next.t2;
      delete next.t3;
      return next;
    }),
  }));
}

/** One planned clone: give this model its own copy of its current (shared) set. */
export interface PerModelSplitAction {
  modelId: string;
  modelName: string;
  sourceSetId: string;
  sourceSetName: string;
  /** Price point the legacy tiers were resolved at (for the admin to sanity-check). */
  basePrice: number;
  newSetName: string;
  /** Converted groups — tier-free, ready for writeConditionSet. */
  groups: any[];
}

export interface PerModelSplitPlan {
  /** Models still sharing a set with at least one other model. */
  actions: PerModelSplitAction[];
  /** Models already at 1 รุ่น : 1 ชุด (sole user of their set) — nothing to do. */
  alreadyPerModel: number;
  /** Models with no resolvable source set — need manual attention, never auto-fixed. */
  missing: { modelId: string; modelName: string; setId: string | null }[];
}

/** setId a model resolves to — same precedence every reader uses. */
const modelSetId = (m: any): string | null => (m?.conditionSetId as string) || (m?.engineId as string) || null;

/**
 * Plan the bulk split to 1 model : 1 condition set. Pure — no I/O.
 *
 * A model gets an action ONLY while its set is shared (used by >= 2 models),
 * so the plan is idempotent: after a run every model is the sole user of its
 * clone and re-planning yields zero actions. Models whose set id doesn't
 * resolve are reported in `missing` and skipped (there is nothing to clone).
 */
export function planPerModelSplit(models: any[], sets: any[]): PerModelSplitPlan {
  const setById = new Map((sets || []).map((s: any) => [s?.id, s]));
  const usage = new Map<string, number>();
  for (const m of models || []) {
    const sid = modelSetId(m);
    if (sid) usage.set(sid, (usage.get(sid) || 0) + 1);
  }

  const plan: PerModelSplitPlan = { actions: [], alreadyPerModel: 0, missing: [] };
  for (const m of models || []) {
    const sid = modelSetId(m);
    const source = sid ? setById.get(sid) : undefined;
    if (!sid || !source) {
      plan.missing.push({ modelId: m?.id, modelName: m?.name || m?.id || '?', setId: sid });
      continue;
    }
    if ((usage.get(sid) || 0) <= 1) {
      plan.alreadyPerModel++;
      continue;
    }
    const basePrice = representativeBasePrice(m);
    plan.actions.push({
      modelId: m.id,
      modelName: m?.name || m.id,
      sourceSetId: sid,
      sourceSetName: source?.name || sid,
      basePrice,
      // Same naming convention as the existing hand-made per-model sets
      // ("iPhone 13", "MacBook Air M1"): the set is simply named after its model.
      newSetName: (m?.name || '').trim() || `ชุดประเมิน ${m.id}`,
      groups: convertGroupsToSingleDeduct(JSON.parse(JSON.stringify(source.groups || [])), basePrice),
    });
  }
  return plan;
}

export interface PerModelSplitResult {
  done: number;
  failed: { modelId: string; modelName: string; error: unknown }[];
}

/**
 * Execute the plan sequentially: mint a key, persist the clone through
 * writeConditionSet (the single condition-set write path), then re-point the
 * model. Order matters — the set must exist before any reader can follow the
 * new `conditionSetId`. A failure on one model never aborts the rest; if the
 * re-point fails after the set was written, the clone is left orphaned (unused
 * and harmless) and the model keeps resolving via its old shared set.
 */
export async function executePerModelSplit(
  actions: PerModelSplitAction[],
  onProgress?: (done: number, total: number) => void,
): Promise<PerModelSplitResult> {
  const result: PerModelSplitResult = { done: 0, failed: [] };
  let processed = 0;
  for (const a of actions) {
    try {
      const newRef = push(ref(db, 'settings/condition_sets'));
      await writeConditionSet({ id: newRef.key, name: a.newSetName, groups: a.groups });
      await update(ref(db, `models/${a.modelId}`), { conditionSetId: newRef.key });
      result.done++;
    } catch (error) {
      result.failed.push({ modelId: a.modelId, modelName: a.modelName, error });
    }
    onProgress?.(++processed, actions.length);
  }
  return result;
}
