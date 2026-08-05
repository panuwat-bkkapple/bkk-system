import { CONDITION_TEMPLATES, FUNCTIONAL_TEMPLATES } from './assessmentSeedTemplates';
import { fillEnFields } from './assessmentEnSeed';
import { writeConditionSet } from './conditionSets';
import { representativeBasePrice } from './perModelConditionSets';

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
 *   iPad ปี 2024 ขึ้นไป -> battery_ipad_new (มีเมนู Battery Health % ให้ถามช่วง)
 *   iPad ก่อนปี 2024    -> battery_ipad_old (ไม่มีเมนู % -> ถามได้แค่ ดี/เสื่อม)
 *   MacBook M3+        -> mac_new   | MacBook M1-M2 -> mac_mid | MacBook Intel -> mac_intel
 *   iMac -> mac_imac (มีจอ ไม่มีแบต) | Mac mini/Studio/Pro -> mac_desktop (ไม่มีจอ/แบต)
 *
 * The tool REPLACES two batches of a set's groups, each inserted where its
 * first removed group used to be: (1) the functional screening topics,
 * normalized from FUNCTIONAL_TEMPLATES (iphone/ipad, minus battery), and
 * (2) the screen/body/battery/warranty/region deduction groups from the
 * tier's pricing template. Every other group (กล่อง/อุปกรณ์, ประวัติซ่อม,
 * custom topics) is left untouched. Models outside the policy (Watch / accessories) are never
 * touched, and a model whose set is still SHARED is skipped (split to 1:1
 * first — editing a shared set would change its sibling models too).
 */

export type IphoneGeneration =
  | 'latest' | 'recent' | 'mid' | 'old' | 'ipad_new' | 'ipad_old'
  | 'mac_new' | 'mac_mid' | 'mac_intel' | 'mac_imac' | 'mac_desktop';

const GEN_TEMPLATE_KEY: Record<IphoneGeneration, string> = {
  latest: 'battery_latest',
  recent: 'battery_recent',
  mid: 'battery_mid',
  old: 'battery_old',
  ipad_new: 'battery_ipad_new',
  ipad_old: 'battery_ipad_old',
  mac_new: 'mac_new',
  mac_mid: 'mac_mid',
  mac_intel: 'mac_intel',
  mac_imac: 'mac_imac',
  mac_desktop: 'mac_desktop',
};

/** Short per-tier labels for plan summaries / confirm dialogs. */
export const GEN_LABELS: Record<IphoneGeneration, string> = {
  latest: 'iPhone 17 ขึ้นไป',
  recent: 'iPhone 16',
  mid: 'iPhone 14-15',
  old: 'iPhone 13 ลงไป',
  ipad_new: 'iPad ปี 2024 ขึ้นไป',
  ipad_old: 'iPad ก่อนปี 2024',
  mac_new: 'MacBook ชิป M3 ขึ้นไป',
  mac_mid: 'MacBook ชิป M1-M2',
  mac_intel: 'MacBook Intel',
  mac_imac: 'iMac',
  mac_desktop: 'Mac mini / Studio / Pro',
};

// Groups the templates replace, matched by group TITLE. Battery matches both
// the pricing group (สุขภาพแบตเตอรี่) and the old functional screen
// (แบตเตอรี่ ปกติ/เสื่อม) on purpose — after apply there is exactly ONE
// battery question per set, per the owner's policy (a worn battery deducts,
// it no longer dead-ends the flow). The cosmetic screen/body patterns are
// written to NEVER match the functional screening topics ("การแสดงผล +
// ทัชสกรีน", "เปิดเครื่อง / ใช้งานทั่วไป") — those are normalized separately
// from FUNCTIONAL_TEMPLATES (see below), not from the pricing templates.
const REPLACED_TITLE_RES = [
  /แบต|battery/i,
  /ประกัน|warranty/i,
  /ประเทศ|รหัสโมเดล|identifier/i,
  /สภาพ(หน้า)?จอ|สภาพจอภาพ|screen condition/i,
  /สภาพตัวเครื่อง|สภาพรอบตัวเครื่อง|บอดี้|ฝาหลัง|body condition/i,
  /ประวัติ(การ)?ซ่อม|repair history/i,
  /กล่อง|อุปกรณ์เสริม|accessor/i,
];
const isReplacedTitle = (title: unknown): boolean =>
  REPLACED_TITLE_RES.some((re) => re.test(String(title || '')));

// Functional screening groups are normalized from FUNCTIONAL_TEMPLATES too
// (นโยบายเจ้าของร้าน ก.ค. 2026 — "ยกชุดตามแม่แบบมาตรฐาน"): sets cloned from
// the old shared sets carried bare "ปกติ / ใช้งานได้" options with no
// descriptions; the template versions have per-topic reject labels and
// customer-facing descriptions on every option. A group counts as functional
// screening when its `kind` says so, or (for sets predating the kind field)
// its title matches a known screening topic. Battery is EXCLUDED here — it
// belongs to REPLACED_TITLE_RES so each set keeps exactly ONE battery
// question (the pricing one).
const FUNCTIONAL_TITLE_RES = [
  /เปิดเครื่อง/i,
  /หน้าจอ \+ ทัชสกรีน|การแสดงผล \+ ทัชสกรีน|หน้าจอแสดงผล/i,
  /กล้องหน้า|กล้องหลัง/i,
  /การเชื่อมต่อ|สัญญาณ|bluetooth/i,
  /ลำโพง|ไมโครโฟน/i,
  /สแกนใบหน้า|face id/i,
  // Mac topics (คีย์บอร์ดถูกดักโดย isReplacedTitle ก่อนเสมอเมื่ออยู่ในหัวข้อ
  // "ประเทศที่ซื้อ + คีย์บอร์ด" — เช็ค isReplacedTitle มาก่อนใน isFunctionalScreening)
  /คีย์บอร์ด|แทร็คแพด|trackpad|keyboard/i,
  /พอร์ต|\bport/i,
];
const isFunctionalScreening = (g: any): boolean => {
  const title = String(g?.title || '');
  // Pricing-owned topics (battery/warranty/region/cosmetic/repair/box) are
  // NEVER screening regardless of a stray kind flag on old data — repair and
  // box groups stored with kind 'functional' once got swallowed by the
  // screening replacement and vanished from the flow.
  if (isReplacedTitle(title)) return false;
  if (g?.kind === 'functional') return true;
  return FUNCTIONAL_TITLE_RES.some((re) => re.test(title));
};

const FUNCTIONAL_TEMPLATE_KEY: Record<IphoneGeneration, 'iphone' | 'ipad' | 'mac' | 'mac_imac' | 'mac_desktop'> = {
  latest: 'iphone', recent: 'iphone', mid: 'iphone', old: 'iphone',
  ipad_new: 'ipad', ipad_old: 'ipad',
  mac_new: 'mac', mac_mid: 'mac', mac_intel: 'mac',
  mac_imac: 'mac_imac', mac_desktop: 'mac_desktop',
};

/**
 * Which generation tier a model belongs to; null = out of scope (never
 * touched by this tool — Watch / accessories have no policy yet).
 *
 * iPhone: names without a number after "iPhone" (SE / X / XR / XS) all
 * predate the 14-era rules -> 'old'.
 *
 * iPad: the dividing line is the Settings Battery Health (%) menu, which
 * only 2024-and-newer iPads have (Pro M4/M5, Air M2+, mini A17 Pro,
 * Gen 11) — detected from the year in the name, the M4+ chip, the A17 Pro
 * mini, or Generation >= 11. Everything else can only answer good/degraded.
 */
export function classifyIphoneGeneration(model: any): IphoneGeneration | null {
  const name = String(model?.name || '').trim();
  if (/^iphone/i.test(name)) {
    // Letter suffix covers the e-line ("iPhone 17e", "iPhone 16e").
    const m = name.match(/iphone\s+(\d{1,2})[a-z]?\b/i);
    if (!m) return 'old';
    const n = Number(m[1]);
    if (n >= 17) return 'latest';
    if (n === 16) return 'recent';
    if (n >= 14) return 'mid';
    return 'old';
  }
  if (/^ipad/i.test(name)) {
    const year = name.match(/\b(20\d{2})\b/);
    if (year && Number(year[1]) >= 2024) return 'ipad_new';
    if (/ชิป\s*M[4-9]/i.test(name) || /A17\s*Pro/i.test(name)) return 'ipad_new';
    const gen = name.match(/generation\s+(\d{1,2})\b/i);
    if (gen && Number(gen[1]) >= 11) return 'ipad_new';
    return 'ipad_old';
  }
  // Mac — ชิปอาจอยู่ในชื่อรุ่น ("MacBook Air M2") หรือใน attribute
  // `processor` ของ variant ("Apple M2", "Intel Core i5") จึงรวมข้อความ
  // ทั้งสองแหล่งก่อน match. desktop (mini/Studio/Pro) กับ iMac แยก tier
  // ของตัวเอง (ไม่มีแบต/จอในตัว) — เช็ค MacBook ก่อนกัน "Mac Pro" ชนกับ
  // "MacBook Pro".
  if (/^imac/i.test(name)) return 'mac_imac';
  if (/^macbook/i.test(name)) {
    const chipText = [
      name,
      ...(Array.isArray(model?.variants)
        ? model.variants.map((v: any) => String(v?.attributes?.processor || v?.processor || ''))
        : []),
    ].join(' ');
    const chip = chipText.match(/\bM([1-9])\b/i);
    if (chip) return Number(chip[1]) >= 3 ? 'mac_new' : 'mac_mid';
    if (/intel|core\s*i[3579]/i.test(chipText)) return 'mac_intel';
    // ไม่รู้ชิป: ปี 2021 ขึ้นไปคือยุค Apple Silicon, ก่อนหน้านั้นถือเป็น Intel
    const year = name.match(/\b(20\d{2})\b/);
    if (year && Number(year[1]) >= 2021) return 'mac_mid';
    return 'mac_intel';
  }
  if (/^mac\s*(mini|studio|pro)\b/i.test(name)) return 'mac_desktop';
  return null;
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

/**
 * Materialize the functional-screening template (minus its battery group) the
 * same way: deterministic ids per template key, EN baked in, and the exact
 * option shape the Engine's own seed path writes (deduct: 0 + failBehavior).
 */
export function buildFunctionalScreeningGroups(tier: IphoneGeneration): any[] {
  const key = FUNCTIONAL_TEMPLATE_KEY[tier];
  const items = (FUNCTIONAL_TEMPLATES[key]?.items || []).filter((g) => !/แบต/.test(g.title));
  const groups = items.map((g, i) => ({
    id: `g_fn_${key}_${i}`,
    title: g.title,
    icon: g.icon,
    description: g.description,
    kind: 'functional',
    options: g.options.map((o, j) => ({
      id: `o_fn_${key}_${i}_${j}`,
      label: o.label,
      description: o.description,
      deduct: 0,
      failBehavior: o.failBehavior,
    })),
  }));
  return fillEnFields(groups as any[]).groups;
}

/**
 * นโยบายค่าหักกล่อง/อุปกรณ์ราย line ของ iPad (เจ้าของร้าน ส.ค. 2026) —
 * หัวข้อกล่องเป็นหัวข้อที่ "ปรับตามรุ่น" เป็นเจ้าของ (อยู่ใน REPLACED_TITLE_RES)
 * เลขที่กรอกมือใน Engine จะถูกรีเซ็ตทุกครั้งที่กดปุ่ม จึงต้องฝังเป็น policy
 * ที่นี่ให้ survive การกดซ้ำ:
 *   iPad Air รุ่น 6-8 (M2-M4)  -> ขาดกล่อง 1,000 / เครื่องเปล่า 1,500
 *   iPad Pro M4-M5             -> ขาดกล่อง 1,000 / เครื่องเปล่า 1,500
 *   iPad Generation 10         -> คงค่าที่แอดมินตั้งไว้เดิม (500/800)
 *   iPad อื่นทุกรุ่น           -> กันไว้ที่ ขาดกล่อง 500 / เครื่องเปล่า 1,000
 *     (ครอบคลุม Air 4-5, Pro M1-M2, Gen 11 ตามนโยบาย และเป็น fallback ของ
 *      mini/Gen/รุ่นเก่าที่ไม่ระบุ — เจ้าของร้านสั่งไม่ให้ปล่อย 0)
 */
/**
 * นโยบายค่าหักกล่อง/อุปกรณ์ของ iPhone (เจ้าของร้าน ส.ค. 2026) — เหตุผลการ
 * ฝังในโค้ดเดียวกับ iPad ด้านบน:
 *   iPhone 17 ขึ้นไป (รุ่นล่าสุด)      -> ขาดกล่อง 500 / เครื่องเปล่า 1,000
 *   iPhone 15-16                        -> ขาดกล่อง 500 / เครื่องเปล่า 800
 *   iPhone 14 ลงไป (รวม SE/X/รุ่นเก่า) -> ขาดกล่อง 300 / เครื่องเปล่า 500
 */
export function iphoneBoxDeducts(modelName: unknown): { missingBox: number; bareDevice: number } | null {
  const name = String(modelName || '').trim();
  if (!/^iphone/i.test(name)) return null;
  const m = name.match(/iphone\s+(\d{1,2})[a-z]?\b/i);
  const n = m ? Number(m[1]) : 0;
  if (n >= 17) return { missingBox: 500, bareDevice: 1000 };
  if (n >= 15) return { missingBox: 500, bareDevice: 800 };
  return { missingBox: 300, bareDevice: 500 };
}

export function ipadBoxDeducts(modelName: unknown): { missingBox: number; bareDevice: number } | null {
  const name = String(modelName || '').trim();
  if (!/^ipad/i.test(name)) return null;
  const chip = name.match(/ชิป\s*M(\d)|(?:^|[\s("])M(\d)\b/i);
  const m = chip ? Number(chip[1] || chip[2]) : null;
  if (/^ipad air/i.test(name) && m != null && m >= 2) return { missingBox: 1000, bareDevice: 1500 };
  if (/^ipad pro/i.test(name) && m != null && m >= 4) return { missingBox: 1000, bareDevice: 1500 };
  if (/^ipad generation 10\b/i.test(name)) return { missingBox: 500, bareDevice: 800 };
  return { missingBox: 500, bareDevice: 1000 };
}

/** Mac "ขาดกล่อง (มีเครื่อง+อะแดปเตอร์)" — คงที่ 1,000 บาททุกรุ่น. */
export const MAC_MISSING_BOX_DEDUCT = 1000;

/**
 * Mac "เครื่องเปล่า (ไม่มีอะแดปเตอร์/กล่อง)" — นโยบายเจ้าของร้าน (ส.ค. 2026):
 * ต้องหักมากกว่า "ขาดกล่อง" อย่างมีนัย เพราะไม่ได้หายแค่กล่อง แต่ต้องซื้อ
 * **หัวชาร์จ + สายชาร์จ** ใหม่ทั้งคู่ (ของแท้: อะแดปเตอร์ 70W ~1,900, 96W
 * ~2,700, 140W ~3,300 / สาย USB-C หรือ MagSafe 3 อีก ~800-1,700) ก่อนจะเอา
 * เครื่องไปเทสหรือขายต่อได้เลย
 *
 *   เครื่องเปล่า = max(2,500, ค่ากล่อง 1,000 + 5% ของราคากลางรุ่น)
 *
 * พื้น 2,500 = อะแดปเตอร์มือสอง/เทียบ ~1,700 + สาย ~800 (เครื่องถูกก็ต้อง
 * ซื้อเท่านี้อยู่ดี); ส่วน 5% ทำให้รุ่นแพงที่ใช้หัว 140W หักตามจริงมากขึ้น.
 * schema ของ option ไม่มีฟิลด์ขั้นต่ำ จึง bake เป็นบาทต่อรุ่นที่ราคากลางของ
 * รุ่น (median used price) ตอนกด "ปรับตามรุ่น" — ปัดขึ้นเป็นหลักร้อย.
 */
export function macBareDeviceDeduct(model: any): number {
  const rep = representativeBasePrice(model);
  const accessories = rep > 0 ? Math.ceil((rep * 0.05) / 100) * 100 : 0;
  return Math.max(2500, MAC_MISSING_BOX_DEDUCT + accessories);
}

/** Overlay the per-line box deducts onto a materialized groups array. */
function applyBoxDeducts(groups: any[], model: unknown): any[] {
  const name = String((typeof model === 'object' && model !== null ? (model as any).name : model) || '').trim();
  // Mac คิดค่าเครื่องเปล่าจากราคา (ต้องใช้ model object) จึงแยกจากตาราง
  // คงที่ของ iPhone/iPad; ขาดกล่องของ Mac คงที่ 1,000 ทุกรุ่น
  const box = /^(macbook|imac|mac\s)/i.test(name)
    ? {
        missingBox: MAC_MISSING_BOX_DEDUCT,
        bareDevice: macBareDeviceDeduct(typeof model === 'object' ? model : { name }),
      }
    : ipadBoxDeducts(name) || iphoneBoxDeducts(name);
  if (!box) return groups;
  return groups.map((g) => {
    if (!/กล่อง|อุปกรณ์เสริม/.test(String(g?.title || ''))) return g;
    return {
      ...g,
      options: (g.options || []).map((o: any) => {
        const label = String(o?.label || '');
        // ลบ pct ทิ้งเมื่อ overlay เป็นบาท (precedence pct > deduct)
        const { pct: _pct, ...rest } = o;
        if (/^ขาดกล่อง/.test(label)) return { ...rest, deduct: box.missingBox };
        if (/^เครื่องเปล่า/.test(label)) return { ...rest, deduct: box.bareDevice };
        return o;
      }),
    };
  });
}

/**
 * Replace one set's functional-screening groups AND its
 * battery/warranty/region/cosmetic groups with the tier's template groups.
 * Each batch is inserted where its first removed group used to be, so the
 * customer flow keeps its shape (screening first, then deduction topics);
 * untouched groups (custom topics) stay put. `model` (optional; model object
 * or plain name string) applies the per-line iPad/Mac box-deduct policy above.
 */
export function applyGenerationToGroups(existingGroups: any[], tier: IphoneGeneration, model?: unknown): {
  groups: any[];
  removedTitles: string[];
} {
  const kept: any[] = [];
  const removedTitles: string[] = [];
  let fnInsertAt = -1;
  let priceInsertAt = -1;
  (existingGroups || []).forEach((g) => {
    if (isFunctionalScreening(g)) {
      if (fnInsertAt === -1) fnInsertAt = kept.length;
      removedTitles.push(String(g?.title || ''));
    } else if (isReplacedTitle(g?.title)) {
      if (priceInsertAt === -1) priceInsertAt = kept.length;
      removedTitles.push(String(g?.title || ''));
    } else {
      kept.push(g);
    }
  });
  const freshFn = buildFunctionalScreeningGroups(tier);
  const freshPrice = applyBoxDeducts(buildGenerationGroups(tier), model);
  // Screening leads the flow when the set never had it; pricing appends.
  if (fnInsertAt === -1) fnInsertAt = 0;
  if (priceInsertAt === -1) priceInsertAt = kept.length;
  if (priceInsertAt >= fnInsertAt) priceInsertAt += freshFn.length;
  kept.splice(fnInsertAt, 0, ...freshFn);
  kept.splice(priceInsertAt, 0, ...freshPrice);
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
  /** Models outside the policy (Watch / accessories) — untouched. */
  outOfScope: number;
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
    actions: [], alreadyApplied: 0, sharedSkipped: [], outOfScope: 0, missing: [],
    tierCounts: {
      latest: 0, recent: 0, mid: 0, old: 0, ipad_new: 0, ipad_old: 0,
      mac_new: 0, mac_mid: 0, mac_intel: 0, mac_imac: 0, mac_desktop: 0,
    },
  };
  for (const m of models || []) {
    const tier = classifyIphoneGeneration(m);
    if (!tier) { plan.outOfScope++; continue; }
    const sid = modelSetId(m);
    const set = sid ? setById.get(sid) : undefined;
    if (!sid || !set) { plan.missing.push({ modelId: m?.id, modelName: m?.name || m?.id || '?' }); continue; }
    if ((usage.get(sid) || 0) > 1) {
      plan.sharedSkipped.push({ modelId: m.id, modelName: m?.name || m.id, setId: sid });
      continue;
    }
    const existing = JSON.parse(JSON.stringify(set.groups || []));
    const { groups, removedTitles } = applyGenerationToGroups(existing, tier, m);
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
