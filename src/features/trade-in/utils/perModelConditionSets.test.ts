import { describe, it, expect } from 'vitest';
import {
  representativeBasePrice,
  convertGroupsToSingleDeduct,
  planPerModelSplit,
} from './perModelConditionSets';

const legacyGroups = () => ([
  {
    id: 'g1',
    title: 'จอ',
    options: [
      { id: 'o1', label: 'สมบูรณ์', t1: 0, t2: 0, t3: 0 },
      { id: 'o2', label: 'จอแตก', t1: 20000, t2: 15000, t3: 10000 },
      { id: 'o3', label: 'รอยลึก', deduct: 4000, t1: 9000, t2: 7000, t3: 5000 },
      { id: 'o4', label: 'เบิร์น', pct: 35 },
    ],
  },
]);

describe('representativeBasePrice', () => {
  it('uses the median of variant used prices', () => {
    expect(representativeBasePrice({
      variants: [{ usedPrice: 10000 }, { usedPrice: 30000 }, { usedPrice: 20000 }],
    })).toBe(20000);
  });
  it('falls back to modifier-mode base prices when there are no variants', () => {
    expect(representativeBasePrice({ baseUsedPrice: 12000 })).toBe(12000);
    expect(representativeBasePrice({ baseNewPrice: 45000 })).toBe(45000);
    expect(representativeBasePrice({})).toBe(0);
  });
});

describe('convertGroupsToSingleDeduct', () => {
  it('resolves tier-only options at the model price and drops ALL tier keys', () => {
    const out = convertGroupsToSingleDeduct(legacyGroups(), 35000); // >= 30000 -> t1
    const [o1, o2, o3, o4] = out[0].options;
    expect(o2.deduct).toBe(20000);
    expect(o1.deduct).toBe(0);
    for (const o of [o1, o2, o3, o4]) {
      expect('t1' in o).toBe(false);
      expect('t2' in o).toBe(false);
      expect('t3' in o).toBe(false);
    }
  });
  it('keeps existing deduct/pct untouched (tiers just dropped)', () => {
    const out = convertGroupsToSingleDeduct(legacyGroups(), 20000);
    expect(out[0].options[2].deduct).toBe(4000); // NOT re-resolved from t2
    expect(out[0].options[3].pct).toBe(35);
    expect('deduct' in out[0].options[3]).toBe(false);
  });
  it('picks the right tier for the price band', () => {
    expect(convertGroupsToSingleDeduct(legacyGroups(), 20000)[0].options[1].deduct).toBe(15000); // t2
    expect(convertGroupsToSingleDeduct(legacyGroups(), 9000)[0].options[1].deduct).toBe(10000); // t3
  });
});

describe('planPerModelSplit', () => {
  const sharedSet = { id: 'shared', name: 'มาตรฐาน iPhone', groups: legacyGroups() };
  const soloSet = { id: 'solo', name: 'iPhone 13', groups: legacyGroups() };

  const models = [
    { id: 'm1', name: 'iPhone 15', conditionSetId: 'shared', variants: [{ usedPrice: 31000 }] },
    { id: 'm2', name: 'iPhone 8', conditionSetId: 'shared', variants: [{ usedPrice: 3000 }] },
    { id: 'm3', name: 'iPhone 13', conditionSetId: 'solo', variants: [{ usedPrice: 12000 }] },
    { id: 'm4', name: 'รุ่นหลุดชุด', conditionSetId: 'gone' },
    { id: 'm5', name: 'รุ่นไม่มีชุด' },
  ];

  it('plans one clone per model on a SHARED set only', () => {
    const plan = planPerModelSplit(models, [sharedSet, soloSet]);
    expect(plan.actions.map((a) => a.modelId)).toEqual(['m1', 'm2']);
    expect(plan.alreadyPerModel).toBe(1); // m3 is the sole user of its set
    expect(plan.missing.map((x) => x.modelId)).toEqual(['m4', 'm5']);
  });

  it('resolves tiers per model price band and names the set after the model', () => {
    const plan = planPerModelSplit(models, [sharedSet, soloSet]);
    const [a1, a2] = plan.actions;
    expect(a1.newSetName).toBe('iPhone 15');
    expect(a1.groups[0].options[1].deduct).toBe(20000); // 31000 -> t1
    expect(a2.groups[0].options[1].deduct).toBe(10000); // 3000 -> t3
    // source set object is never mutated
    expect(sharedSet.groups[0].options[1].t1).toBe(20000);
  });

  it('honors the conditionSetId > engineId precedence readers use', () => {
    const plan = planPerModelSplit(
      [
        { id: 'a', name: 'A', engineId: 'shared' },
        { id: 'b', name: 'B', conditionSetId: 'shared', engineId: 'gone' },
      ],
      [sharedSet],
    );
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions.every((x) => x.sourceSetId === 'shared')).toBe(true);
  });

  it('is idempotent: after the split every model is a sole user -> zero actions', () => {
    const plan = planPerModelSplit(models, [sharedSet, soloSet]);
    // Simulate a completed run: each action became its own set + re-pointed model.
    const newSets = plan.actions.map((a, i) => ({ id: `new_${i}`, name: a.newSetName, groups: a.groups }));
    const migrated = models.map((m) => {
      const i = plan.actions.findIndex((a) => a.modelId === m.id);
      return i === -1 ? m : { ...m, conditionSetId: `new_${i}` };
    });
    const replan = planPerModelSplit(migrated, [sharedSet, soloSet, ...newSets]);
    expect(replan.actions).toHaveLength(0);
    expect(replan.alreadyPerModel).toBe(3);
    expect(replan.missing).toHaveLength(2); // still needs manual attention, never auto-fixed
  });

  it('clones are tier-free so writeConditionSet/sanitizeGroups cannot resurrect tiers', () => {
    const plan = planPerModelSplit(models, [sharedSet, soloSet]);
    for (const a of plan.actions) {
      for (const g of a.groups) {
        for (const o of g.options) {
          expect('t1' in o).toBe(false);
          expect('t2' in o).toBe(false);
          expect('t3' in o).toBe(false);
        }
      }
    }
  });
});
