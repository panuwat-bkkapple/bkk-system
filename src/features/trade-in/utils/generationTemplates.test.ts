import { describe, it, expect } from 'vitest';
import {
  classifyIphoneGeneration,
  buildGenerationGroups,
  buildFunctionalScreeningGroups,
  applyGenerationToGroups,
  planGenerationApply,
} from './generationTemplates';

describe('classifyIphoneGeneration', () => {
  const cases: [string, string | null][] = [
    ['iPhone 17', 'latest'],
    ['iPhone 17 Air', 'latest'],
    ['iPhone 17 Pro Max', 'latest'],
    ['iPhone 17e', 'latest'],
    ['iPhone 16 Pro Max', 'recent'],
    ['iPhone 16', 'recent'],
    ['iPhone 15 Pro', 'mid'],
    ['iPhone 14 Plus', 'mid'],
    ['iPhone 13 mini', 'old'],
    ['iPhone 12', 'old'],
    ['iPhone 11 Pro Max', 'old'],
    ['iPhone SE (2022)', 'old'],
    ['iPhone XS Max', 'old'],
    ['iPhone X', 'old'],
    ['iPhone 8 Plus', 'old'],
    ['iPad Pro 11" (ชิป M4, 2024)', 'ipad_new'],
    ['iPad Pro 13" (ชิป M5, 2025)', 'ipad_new'],
    ['iPad Air 13" (ชิป M3, 2025)', 'ipad_new'],
    ['iPad mini รุ่นที่ 7 (ชิป A17 Pro)', 'ipad_new'],
    ['iPad Generation 11', 'ipad_new'],
    ['iPad Generation 10', 'ipad_old'],
    ['iPad Pro 12.9" (ชิป M2, 2022)', 'ipad_old'],
    ['iPad Pro 11" (2020)', 'ipad_old'],
    ['iPad Air (2013)', 'ipad_old'],
    ['iPad mini 6 (2021)', 'ipad_old'],
    ['MacBook Air 13" (Intel, 2020)', null],
    ['Apple Watch Series 10', null],
    ['Apple Pencil Pro', null],
  ];
  for (const [name, tier] of cases) {
    it(`${name} -> ${tier}`, () => {
      expect(classifyIphoneGeneration({ name })).toBe(tier);
    });
  }
});

describe('buildGenerationGroups', () => {
  it('materializes screen + body + battery + warranty + region groups with baked EN labels', () => {
    const groups = buildGenerationGroups('latest');
    expect(groups.map((g: any) => g.title)).toEqual(['สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก', 'สภาพตัวเครื่องและฝาหลัง', 'ประกัน', 'ประเทศที่ซื้อ']);
    for (const g of groups) {
      expect(g.title_en, `title_en of ${g.title}`).toBeTruthy();
      for (const o of g.options) expect(o.label_en, `label_en of ${o.label}`).toBeTruthy();
    }
  });
  it('ids are deterministic so re-builds are byte-identical (idempotency)', () => {
    expect(JSON.stringify(buildGenerationGroups('recent'))).toBe(JSON.stringify(buildGenerationGroups('recent')));
  });
  it('cosmetic percentages tier inversely with model age (cheaper device, higher pct)', () => {
    const screenLight = (tier: any) =>
      buildGenerationGroups(tier).find((g: any) => g.title === 'สภาพจอภาพและกระจก')!.options[1].pct;
    expect(screenLight('latest')).toBe(3);
    expect(screenLight('recent')).toBe(4);
    expect(screenLight('mid')).toBe(6);
    expect(screenLight('old')).toBe(10);
  });
  it('cracked-but-working screens deduct heavily per generation, never reject', () => {
    const cracked = (tier: any) =>
      buildGenerationGroups(tier)
        .find((g: any) => g.title === 'สภาพจอภาพและกระจก')!
        .options.find((o: any) => o.label === 'จอแตก/ร้าว');
    // Anchored to real Apple TH repair pricing (iPhone 17 screen = ฿12,499 on a
    // ~฿22,000 device) + competitor benchmarks — see PR #436.
    expect(cracked('latest').pct).toBe(55);
    expect(cracked('recent').pct).toBe(60);
    expect(cracked('mid').pct).toBe(65);
    expect(cracked('old').pct).toBe(70);
    expect(cracked('ipad_new').pct).toBe(60);
    expect(cracked('ipad_old').pct).toBe(70);
    for (const tier of ['latest', 'recent', 'mid', 'old', 'ipad_new', 'ipad_old']) {
      expect(cracked(tier).failBehavior, tier).toBe('deduct');
    }
  });
  it('worn-battery deduct follows the price-band policy (<20k -> 20%, 20-30k -> 15%)', () => {
    const worstBattery = (tier: any) => {
      const opts = buildGenerationGroups(tier).find((g: any) => g.title === 'สุขภาพแบตเตอรี่')!.options;
      return opts[opts.length - 1].pct;
    };
    expect(worstBattery('old')).toBe(20);
    expect(worstBattery('mid')).toBe(15);
    expect(worstBattery('recent')).toBe(15);
  });
  it('recent tier warranty never deducts; latest tier does', () => {
    const warranty = (tier: 'latest' | 'recent') =>
      buildGenerationGroups(tier).find((g: any) => g.title === 'ประกัน')!.options;
    expect(warranty('recent').every((o: any) => !(o.pct > 0) && !(o.deduct > 0))).toBe(true);
    expect(warranty('latest').some((o: any) => o.pct > 0)).toBe(true);
  });
});

const makeSet = () => ({
  id: 'set1',
  name: 'iPhone 15',
  groups: [
    { id: 'g1', title: 'เปิดเครื่อง / ใช้งานทั่วไป', kind: 'functional', options: [{ id: 'o1', label: 'ปกติ', deduct: 0 }] },
    { id: 'g2', title: 'แบตเตอรี่', kind: 'functional', options: [{ id: 'o2', label: 'ปกติ', deduct: 0 }, { id: 'o3', label: 'แบตเตอรี่เสื่อม', failBehavior: 'reject' }] },
    { id: 'g3', title: 'สภาพหน้าจอ', options: [{ id: 'o4', label: 'สวยมาก ไม่มีรอย', deduct: 0 }] },
    { id: 'g4', title: 'สถานะการรับประกัน (Warranty)', options: [{ id: 'o5', label: 'มีประกัน', deduct: 0 }] },
    { id: 'g5', title: 'รหัสโมเดล (Model Identifier)', options: [{ id: 'o6', label: 'ศูนย์ไทย (ZP/A)', deduct: 0 }] },
    { id: 'g6', title: 'อุปกรณ์เสริมที่นำมาด้วย', options: [{ id: 'o7', label: 'ครบกล่อง', deduct: 0 }] },
  ],
});

const IPHONE_SCREENING_TITLES = [
  'เปิดเครื่อง / ใช้งานทั่วไป',
  'การแสดงผล + ทัชสกรีน',
  'กล้องหน้า / กล้องหลัง',
  'การเชื่อมต่อ (ซิม / Wi-Fi / สัญญาณ)',
  'ลำโพง / ไมโครโฟน',
];

describe('buildFunctionalScreeningGroups', () => {
  it('materializes the standard screening minus battery, with baked EN labels', () => {
    const groups = buildFunctionalScreeningGroups('mid');
    expect(groups.map((g: any) => g.title)).toEqual(IPHONE_SCREENING_TITLES);
    for (const g of groups) {
      expect(g.kind).toBe('functional');
      expect(g.title_en, `title_en of ${g.title}`).toBeTruthy();
      expect(g.description, `description of ${g.title}`).toBeTruthy();
      for (const o of g.options) {
        expect(o.label_en, `label_en of ${o.label}`).toBeTruthy();
        expect(o.description, `description of ${o.label}`).toBeTruthy();
      }
    }
  });
  it('cracked-but-working glass counts as ปกติ (points customers at the cosmetic topic)', () => {
    const display = buildFunctionalScreeningGroups('latest').find((g: any) => g.title === 'การแสดงผล + ทัชสกรีน')!;
    expect(display.options[0].description).toContain('แม้กระจกจะมีรอยหรือแตก');
  });
  it('ipad tiers use the ipad screening template', () => {
    const titles = buildFunctionalScreeningGroups('ipad_old').map((g: any) => g.title);
    expect(titles).toContain('Wi-Fi / Bluetooth / สัญญาณ');
    expect(titles).not.toContain('แบตเตอรี่');
  });
});

describe('applyGenerationToGroups', () => {
  it('normalizes screening + replaces deduction groups in place, keeping the rest untouched', () => {
    const { groups, removedTitles } = applyGenerationToGroups(makeSet().groups, 'mid');
    expect(removedTitles).toEqual(['เปิดเครื่อง / ใช้งานทั่วไป', 'แบตเตอรี่', 'สภาพหน้าจอ', 'สถานะการรับประกัน (Warranty)', 'รหัสโมเดล (Model Identifier)']);
    expect(groups.map((g: any) => g.title)).toEqual([
      ...IPHONE_SCREENING_TITLES,
      'สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก',
      'สภาพตัวเครื่องและฝาหลัง', 'ประกัน', 'ประเทศที่ซื้อ',
      'อุปกรณ์เสริมที่นำมาด้วย',
    ]);
    // Untouched groups keep their identity.
    expect(groups[groups.length - 1].id).toBe('g6');
  });
  it('the old functional battery screen is folded into the single pricing battery group', () => {
    const { groups } = applyGenerationToGroups(makeSet().groups, 'mid');
    expect(groups.filter((g: any) => /แบต/.test(g.title))).toHaveLength(1);
  });
  it('prepends screening and appends deduction groups when the set had neither', () => {
    const bare = [{ id: 'g1', title: 'อุปกรณ์เสริมที่นำมาด้วย', options: [] }];
    const { groups } = applyGenerationToGroups(bare, 'old');
    expect(groups.map((g: any) => g.title)).toEqual([
      ...IPHONE_SCREENING_TITLES,
      'อุปกรณ์เสริมที่นำมาด้วย',
      'สุขภาพแบตเตอรี่', 'สภาพจอภาพและกระจก', 'สภาพตัวเครื่องและฝาหลัง', 'ประกัน', 'ประเทศที่ซื้อ',
    ]);
  });
});

describe('planGenerationApply', () => {
  const perModelSet = makeSet();
  const sharedSet = { id: 'shared', name: 'รวม', groups: makeSet().groups };
  const models = [
    { id: 'm15', name: 'iPhone 15', conditionSetId: 'set1' },
    { id: 'm16a', name: 'iPhone 16', conditionSetId: 'shared' },
    { id: 'm16b', name: 'iPhone 16 Pro', conditionSetId: 'shared' },
    { id: 'mx', name: 'iPhone X' }, // no set
    { id: 'ipad', name: 'iPad Air 4 (2020)', conditionSetId: 'setIpad' },
    { id: 'mac', name: 'MacBook Air 13" (ชิป M1, 2020)', conditionSetId: 'setMac' },
  ];
  const ipadSet = { id: 'setIpad', name: 'iPad Air 4', groups: makeSet().groups };

  it('plans per-model iPhone/iPad sets; shared/out-of-scope/missing are reported', () => {
    const plan = planGenerationApply(models, [perModelSet, sharedSet, ipadSet]);
    expect(plan.actions.map((a) => a.modelId)).toEqual(['m15', 'ipad']);
    expect(plan.actions[0].tier).toBe('mid');
    expect(plan.actions[1].tier).toBe('ipad_old');
    expect(plan.tierCounts.mid).toBe(1);
    expect(plan.tierCounts.ipad_old).toBe(1);
    expect(plan.sharedSkipped.map((s) => s.modelId)).toEqual(['m16a', 'm16b']);
    expect(plan.missing.map((s) => s.modelId)).toEqual(['mx']);
    expect(plan.outOfScope).toBe(1); // the MacBook
  });

  it('is idempotent: after applying, re-planning reports alreadyApplied', () => {
    const plan = planGenerationApply(models, [perModelSet, sharedSet]);
    const applied = { ...perModelSet, groups: plan.actions[0].groups };
    const replan = planGenerationApply(models, [applied, sharedSet]);
    expect(replan.actions).toHaveLength(0);
    expect(replan.alreadyApplied).toBe(1);
  });

  it('never mutates the source sets', () => {
    const before = JSON.stringify(perModelSet.groups);
    planGenerationApply(models, [perModelSet, sharedSet]);
    expect(JSON.stringify(perModelSet.groups)).toBe(before);
  });
});
