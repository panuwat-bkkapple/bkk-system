import { CONDITION_TEMPLATES } from './assessmentSeedTemplates';
import { fillEnFields } from './assessmentEnSeed';
import { writeConditionSet } from './conditionSets';

/**
 * Auto-apply the generation battery/warranty/region templates to every
 * iPhone's PER-MODEL condition set (นโยบายเจ้าของร้าน ก.ค. 2026 — ดูคอมเมนต์
 * ประกอบใน assessmentSeedTemplates.ts):
 *
 *   iPhone 17+  -> battery_latest (แบต % ละเอียด + ประกันละเอียด)
 *   iPhone 16   -> battery_recent (แบต >= 90% ไม่หัก, ประกันไม่หัก)
 *   iPhone 14-15-> battery_mid    (แบต >= 85% ไม่หัก, ประกันไม่หัก)
 *   iPhone <=13 -> battery_old    (ดี/เสื่อม เกณฑ์ >= 80%, ประกันไม่หัก)
 *   (SE / X / XR / XS / 8 / 7 / 6 = ก่อนยุค 14 ทั้งหมด -> battery_old)
 *
 * The tool REPLACES the set's existing battery + warranty + region groups
 * (matched by title) with the template's three groups, inserted where the
 * first replaced group used to be — every other group (สภาพจอ/บอดี้/กล่อง/
 * ประวัติซ่อม ฯลฯ) is left untouched. Non-iPhone models are never touched,
 * and a model whose set is still SHARED is skipped (split to 1:1 first —
 * editing a shared set would change its sibling models too).
 */

export type IphoneGeneration = 'latest' | 'recent' | 'mid' | 'old';

const GEN_TEMPLATE_KEY: Record<IphoneGeneration, string> = {
  latest: 'battery_latest',
  recent: 'battery_recent',
  mid: 'battery_mid',
  old: 'battery_old',
};

/** Short per-tier labels for plan summaries / confirm dialogs. */
export const GEN_LABELS: Record<IphoneGeneration, string> = {
  latest: 'iPhone 17 ขึ้นไป',
  recent: 'iPhone 16',
  mid: 'iPhone 14-15',
  old: 'iPhone 13 ลงไป',
};

// Groups the templates replace, matched by group TITLE. Battery matches both
// the pricing group (สุขภาพแบตเตอรี่) and the old functional screen
// (แบตเตอรี่ ปกติ/เสื่อม) on purpose — after apply there is exactly ONE
// battery question per set, per the owner's policy (a worn battery deducts,
// it no longer dead-ends the flow).
const REPLACED_TITLE_RES = [
  /แบต|battery/i,
  /ประกัน|warranty/i,
  /ประเทศ|รหัสโมเดล|identifier/i,
];
const isReplacedTitle = (title: unknown): boolean =>
  REPLACED_TITLE_RES.some((re) => re.test(String(title || '')));

/**
 * Which generation tier an iPhone model belongs to; null = not an iPhone
 * (never touched by this tool). Names without a number after "iPhone"
 * (SE / X / XR / XS) all predate the 14-era rules -> 'old'.
 */
export function classifyIphoneGeneration(model: any): IphoneGeneration | null {
  const name = String(model?.name || '').trim();
  if (!/^iphone/i.test(name)) return null;
  // Letter suffix covers the e-line ("iPhone 17e", "iPhone 16e").
  const m = name.match(/iphone\s+(\d{1,2})[a-z]?\b/i);
  if (!m) return 'old';
  const n = Number(m[1]);
  if (n >= 17) return 'latest';
  if (n === 16) return 'recent';
  if (n >= 14) return 'mid';
  return 'old';
}

/**
 * Materialize a tier's template items into concrete condition-set groups.
 * Ids are DETERMINISTIC per tier so re-applying produces byte-identical
 * groups — that is what makes the planner's already-applied check (and thus
 * idempotency) a simple structural comparison. English labels are baked in
 * via fillEnFields, same as the manual seed path.
 */
export function buildGenerationGroups(tier: IphoneGeneration): any[] {
  const tpl = CONDITION_TEMPLATES[GEN_TEMPLATE_KEY[tier]];
  const groups = (tpl?.items || []).map((g, i) => ({
    id: `g_gen_${tier}_${i}`,
    title: g.title,
    icon: g.icon,
    description: g.description,
    kind: g.kind,
    options: g.options.map((o, j) => {
      const opt: any = { id: `o_gen_${tier}_${i}_${j}`, label: o.label, description: o.description };
      if (o.pct != null) opt.pct = o.pct;
      else if (o.deduct != null) opt.deduct = o.deduct;
      if (o.failBehavior) opt.failBehavior = o.failBehavior;
      return opt;
    }),
  }));
  return fillEnFields(groups as any[]).groups;
}

/** Replace the battery/warranty/region groups of one set with a tier's template groups. */
export function applyGenerationToGroups(existingGroups: any[], tier: IphoneGeneration): {
  groups: any[];
  removedTitles: string[];
} {
  const kept: any[] = [];
  const removedTitles: string[] = [];
  let insertAt = -1;
  (existingGroups || []).forEach((g) => {
    if (isReplacedTitle(g?.title)) {
      if (insertAt === -1) insertAt = kept.length;
      removedTitles.push(String(g?.title || ''));
    } else {
      kept.push(g);
    }
  });
  const fresh = buildGenerationGroups(tier);
  if (insertAt === -1) insertAt = kept.length;
  kept.splice(insertAt, 0, ...fresh);
  return { groups: kept, removedTitles };
}

export interface GenerationApplyAction {
  modelId: string;
  modelName: string;
  setId: string;
  setName: string;
  tier: IphoneGeneration;
  removedTitles: string[];
  /** The set's full new groups array, ready for writeConditionSet. */
  groups: any[];
}

export interface GenerationApplyPlan {
  actions: GenerationApplyAction[];
  /** iPhone sets already carrying exactly the tier's template groups. */
  alreadyApplied: number;
  /** iPhones whose set is still shared by other models — split to 1:1 first. */
  sharedSkipped: { modelId: string; modelName: string; setId: string }[];
  /** Models that are not iPhones — out of scope, untouched. */
  nonIphone: number;
  /** iPhones with no resolvable set — need manual attention. */
  missing: { modelId: string; modelName: string }[];
  /** Action count per tier (for the confirm summary). */
  tierCounts: Record<IphoneGeneration, number>;
}

const modelSetId = (m: any): string | null => (m?.conditionSetId as string) || (m?.engineId as string) || null;

/** Plan the auto-apply. Pure — no I/O; idempotent by structural comparison. */
export function planGenerationApply(models: any[], sets: any[]): GenerationApplyPlan {
  const setById = new Map((sets || []).map((s: any) => [s?.id, s]));
  const usage = new Map<string, number>();
  for (const m of models || []) {
    const sid = modelSetId(m);
    if (sid) usage.set(sid, (usage.get(sid) || 0) + 1);
  }

  const plan: GenerationApplyPlan = {
    actions: [], alreadyApplied: 0, sharedSkipped: [], nonIphone: 0, missing: [],
    tierCounts: { latest: 0, recent: 0, mid: 0, old: 0 },
  };
  for (const m of models || []) {
    const tier = classifyIphoneGeneration(m);
    if (!tier) { plan.nonIphone++; continue; }
    const sid = modelSetId(m);
    const set = sid ? setById.get(sid) : undefined;
    if (!sid || !set) { plan.missing.push({ modelId: m?.id, modelName: m?.name || m?.id || '?' }); continue; }
    if ((usage.get(sid) || 0) > 1) {
      plan.sharedSkipped.push({ modelId: m.id, modelName: m?.name || m.id, setId: sid });
      continue;
    }
    const existing = JSON.parse(JSON.stringify(set.groups || []));
    const { groups, removedTitles } = applyGenerationToGroups(existing, tier);
    if (JSON.stringify(groups) === JSON.stringify(set.groups || [])) { plan.alreadyApplied++; continue; }
    plan.tierCounts[tier]++;
    plan.actions.push({
      modelId: m.id,
      modelName: m?.name || m.id,
      setId: sid,
      setName: set?.name || sid,
      tier,
      removedTitles,
      groups,
    });
  }
  return plan;
}

export interface GenerationApplyResult {
  done: number;
  failed: { modelName: string; setId: string; error: unknown }[];
}

/**
 * Execute the plan sequentially through writeConditionSet (the single
 * condition-set write path). A failure on one set never aborts the rest;
 * re-running the planner picks up only what is still unapplied.
 */
export async function executeGenerationApply(
  actions: GenerationApplyAction[],
  onProgress?: (done: number, total: number) => void,
): Promise<GenerationApplyResult> {
  const result: GenerationApplyResult = { done: 0, failed: [] };
  let processed = 0;
  for (const a of actions) {
    try {
      await writeConditionSet({ id: a.setId, name: a.setName, groups: a.groups });
      result.done++;
    } catch (error) {
      result.failed.push({ modelName: a.modelName, setId: a.setId, error });
    }
    onProgress?.(++processed, actions.length);
  }
  return result;
}
