import { describe, it, expect } from 'vitest';
import {
  flattenSetToRows,
  applyRowsToSet,
  sanitizeGroups,
  validatePercent,
  validateDeduction,
  legacyTierLabel,
  type DeductionRow,
} from './conditionSets';

const makeLegacySet = () => ({
  id: 'set1',
  name: 'Test',
  groups: [
    {
      id: 'g1',
      title: 'จอ',
      options: [
        { id: 'o1', label: 'สมบูรณ์', t1: 0, t2: 0, t3: 0 },
        { id: 'o2', label: 'จอแตก', t1: 20000, t2: 15000, t3: 10000 },
      ],
    },
  ],
});

describe('flattenSetToRows', () => {
  it('flattens options, defaulting deduct/pct to null and exposing legacy tiers read-only', () => {
    const rows = flattenSetToRows(makeLegacySet());
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      rowKey: 'g1::o2',
      label: 'จอแตก',
      deduct: null,
      pct: null,
      legacyTiers: '20,000 / 15,000 / 10,000',
    });
  });
  it('reads existing numeric deduct and pct', () => {
    const set = makeLegacySet();
    (set.groups[0].options[1] as any).deduct = 4000;
    (set.groups[0].options[1] as any).pct = 35;
    const row = flattenSetToRows(set)[1];
    expect(row.deduct).toBe(4000);
    expect(row.pct).toBe(35);
  });
  it('legacyTiers is empty for new-mode options without tier keys', () => {
    expect(legacyTierLabel({ deduct: 500 })).toBe('');
  });
});

describe('applyRowsToSet — deduct/pct write/clear + legacy tier migration', () => {
  it('writes deduct and DROPS legacy tiers once set', () => {
    const set = makeLegacySet();
    const rows = flattenSetToRows(set);
    rows[1].deduct = 4000;
    const next = applyRowsToSet(set, rows);
    expect(next.groups[0].options[1].deduct).toBe(4000);
    expect('t1' in next.groups[0].options[1]).toBe(false);
    expect('t2' in next.groups[0].options[1]).toBe(false);
    expect('t3' in next.groups[0].options[1]).toBe(false);
  });

  it('writes pct and DROPS legacy tiers once set', () => {
    const set = makeLegacySet();
    const rows = flattenSetToRows(set);
    rows[1].pct = 35;
    const next = applyRowsToSet(set, rows);
    expect(next.groups[0].options[1].pct).toBe(35);
    expect('t1' in next.groups[0].options[1]).toBe(false);
  });

  it('REMOVES deduct when cleared to null', () => {
    const set = makeLegacySet();
    (set.groups[0].options[1] as any).deduct = 4000;
    const rows = flattenSetToRows(set);
    rows[1].deduct = null;
    const next = applyRowsToSet(set, rows);
    expect('deduct' in next.groups[0].options[1]).toBe(false);
  });

  it('keeps legacy tiers for options left untouched (no deduct, no pct)', () => {
    const set = makeLegacySet();
    const next = applyRowsToSet(set, flattenSetToRows(set));
    expect(next.groups[0].options[1].t1).toBe(20000);
    expect('deduct' in next.groups[0].options[1]).toBe(false);
    expect('pct' in next.groups[0].options[1]).toBe(false);
  });

  it('preserves group/option order and untouched options', () => {
    const set = makeLegacySet();
    const rows = flattenSetToRows(set);
    rows[0].label = 'สมบูรณ์ (แก้)';
    const next = applyRowsToSet(set, rows);
    expect(next.groups[0].options[0].label).toBe('สมบูรณ์ (แก้)');
    expect(next.groups[0].options[1].label).toBe('จอแตก');
  });
});

describe('sanitizeGroups — optional English display fields (*_en)', () => {
  it('preserves title_en/description_en/label_en on save (with and without deduct/pct)', () => {
    const groups = [
      {
        id: 'g1',
        title: 'จอ',
        title_en: 'Screen',
        description_en: 'Scratches or damage on the screen glass',
        options: [
          { id: 'o1', label: 'สมบูรณ์', label_en: 'Flawless', description_en: 'No scratches', deduct: 0 },
          { id: 'o2', label: 'จอแตก', label_en: 'Cracked screen', t1: 20000, t2: 15000, t3: 10000 },
        ],
      },
    ];
    const out = sanitizeGroups(groups);
    expect(out[0].title_en).toBe('Screen');
    expect(out[0].description_en).toBe('Scratches or damage on the screen glass');
    expect(out[0].options[0].label_en).toBe('Flawless');
    expect(out[0].options[0].description_en).toBe('No scratches');
    // legacy-tier option (no deduct/pct) keeps both its tiers AND its label_en
    expect(out[0].options[1].label_en).toBe('Cracked screen');
    expect(out[0].options[1].t1).toBe(20000);
  });

  it('still drops legacy tiers once deduct/pct is set, without touching *_en', () => {
    const out = sanitizeGroups([
      { id: 'g1', title: 'จอ', options: [{ id: 'o1', label: 'จอแตก', label_en: 'Cracked screen', deduct: 4000, t1: 20000, t2: 15000, t3: 10000 }] },
    ]);
    expect('t1' in out[0].options[0]).toBe(false);
    expect(out[0].options[0].deduct).toBe(4000);
    expect(out[0].options[0].label_en).toBe('Cracked screen');
  });

  it('drops empty-string *_en so "no translation" is stored as ABSENT', () => {
    const out = sanitizeGroups([
      {
        id: 'g1',
        title: 'จอ',
        title_en: '',
        description_en: '  ',
        options: [{ id: 'o1', label: 'สมบูรณ์', label_en: '', description_en: '', deduct: 0 }],
      },
    ]);
    expect('title_en' in out[0]).toBe(false);
    expect('description_en' in out[0]).toBe(false);
    expect('label_en' in out[0].options[0]).toBe(false);
    expect('description_en' in out[0].options[0]).toBe(false);
  });
});

describe('validatePercent', () => {
  it('treats empty/null as OK and a clear (value undefined)', () => {
    expect(validatePercent('')).toEqual({ ok: true, value: undefined });
    expect(validatePercent(null)).toEqual({ ok: true, value: undefined });
  });
  it('accepts 0..100, strips % and commas', () => {
    expect(validatePercent('35')).toEqual({ ok: true, value: 35 });
    expect(validatePercent('35%')).toEqual({ ok: true, value: 35 });
    expect(validatePercent(0)).toEqual({ ok: true, value: 0 });
    expect(validatePercent(100)).toEqual({ ok: true, value: 100 });
  });
  it('rejects negatives, > 100, and non-numbers', () => {
    expect(validatePercent(-1).ok).toBe(false);
    expect(validatePercent(101).ok).toBe(false);
    expect(validatePercent('abc').ok).toBe(false);
  });
});

describe('validateDeduction (single flat value)', () => {
  it('treats empty/null as OK and a clear (value undefined)', () => {
    expect(validateDeduction('')).toEqual({ ok: true, value: undefined });
    expect(validateDeduction(null)).toEqual({ ok: true, value: undefined });
  });
  it('requires a number >= 0, strips commas', () => {
    expect(validateDeduction(-5).ok).toBe(false);
    expect(validateDeduction('abc').ok).toBe(false);
    expect(validateDeduction('1,500')).toEqual({ ok: true, value: 1500 });
    expect(validateDeduction(0)).toEqual({ ok: true, value: 0 });
  });
});

// Type guard: DeductionRow keeps deduct/pct as number | null
const _row: DeductionRow = { rowKey: 'a::b', groupId: 'a', groupTitle: '', optionId: 'b', label: '', deduct: null, pct: null, legacyTiers: '' };
void _row;
