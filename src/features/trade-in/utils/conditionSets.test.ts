import { describe, it, expect } from 'vitest';
import {
  flattenSetToRows,
  applyRowsToSet,
  validatePercent,
  validateDeduction,
  type DeductionRow,
} from './conditionSets';

const makeSet = () => ({
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
  it('flattens options, defaulting pct to null when absent', () => {
    const rows = flattenSetToRows(makeSet());
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ rowKey: 'g1::o2', label: 'จอแตก', t1: 20000, pct: null });
  });
  it('reads an existing numeric pct', () => {
    const set = makeSet();
    (set.groups[0].options[1] as any).pct = 35;
    expect(flattenSetToRows(set)[1].pct).toBe(35);
  });
});

describe('applyRowsToSet — pct write/clear', () => {
  it('writes pct when a finite number >= 0 is set', () => {
    const set = makeSet();
    const rows = flattenSetToRows(set);
    rows[1].pct = 35;
    const next = applyRowsToSet(set, rows);
    expect(next.groups[0].options[1].pct).toBe(35);
    // tiers preserved
    expect(next.groups[0].options[1].t1).toBe(20000);
  });

  it('REMOVES pct (back to tier mode) when cleared to null', () => {
    const set = makeSet();
    (set.groups[0].options[1] as any).pct = 35;
    const rows = flattenSetToRows(set); // pct = 35
    rows[1].pct = null;
    const next = applyRowsToSet(set, rows);
    expect('pct' in next.groups[0].options[1]).toBe(false);
  });

  it('does not add pct for options left in tier mode', () => {
    const set = makeSet();
    const next = applyRowsToSet(set, flattenSetToRows(set));
    expect('pct' in next.groups[0].options[0]).toBe(false);
    expect('pct' in next.groups[0].options[1]).toBe(false);
  });

  it('preserves group/option order and untouched options', () => {
    const set = makeSet();
    const rows = flattenSetToRows(set);
    rows[0].label = 'สมบูรณ์ (แก้)';
    const next = applyRowsToSet(set, rows);
    expect(next.groups[0].options[0].label).toBe('สมบูรณ์ (แก้)');
    expect(next.groups[0].options[1].label).toBe('จอแตก');
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

describe('validateDeduction (unchanged tier rule)', () => {
  it('requires a number >= 0, rejects empty', () => {
    expect(validateDeduction('').ok).toBe(false);
    expect(validateDeduction(-5).ok).toBe(false);
    expect(validateDeduction('1,500')).toEqual({ ok: true, value: 1500 });
  });
});

// Type guard: DeductionRow keeps pct as number | null
const _row: DeductionRow = { rowKey: 'a::b', groupId: 'a', groupTitle: '', optionId: 'b', label: '', t1: 0, t2: 0, t3: 0, pct: null };
void _row;
