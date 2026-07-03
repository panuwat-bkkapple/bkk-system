import { describe, it, expect } from 'vitest';
import {
  tierDeduction,
  normalizeLiquidityFactor,
  isPercentOption,
  isFixedDeductOption,
  resolveOptionDeduction,
  resolveDeductions,
  resolveFinalPrice,
} from './pricingResolver';

// Golden tests: these lock the CURRENT pricing behavior (tier × liquidityFactor)
// so the resolver extraction provably does not move any price. If a later step
// changes the model intentionally, update these with the new expected numbers.

const screenCrack = { id: 'o_screen', label: 'จอแตก', t1: 20000, t2: 15000, t3: 10000 };
const catScratch = { id: 'o_scratch', label: 'รอยขนแมว', t1: 3000, t2: 2000, t3: 1500 };

describe('tierDeduction (3-bucket logic)', () => {
  it('picks t1 at base >= 30000', () => {
    expect(tierDeduction(screenCrack, 45000)).toBe(20000);
    expect(tierDeduction(screenCrack, 30000)).toBe(20000);
  });
  it('picks t2 at 15000-29999', () => {
    expect(tierDeduction(screenCrack, 29999)).toBe(15000);
    expect(tierDeduction(screenCrack, 15000)).toBe(15000);
  });
  it('picks t3 below 15000', () => {
    expect(tierDeduction(screenCrack, 14999)).toBe(10000);
    expect(tierDeduction(screenCrack, 10000)).toBe(10000);
  });
  it('treats missing tier values as 0', () => {
    expect(tierDeduction({ id: 'x' }, 50000)).toBe(0);
  });
});

describe('normalizeLiquidityFactor', () => {
  it('defaults to 1 for missing / non-positive / non-numeric', () => {
    expect(normalizeLiquidityFactor(undefined)).toBe(1);
    expect(normalizeLiquidityFactor(0)).toBe(1);
    expect(normalizeLiquidityFactor(-2)).toBe(1);
    expect(normalizeLiquidityFactor('abc')).toBe(1);
  });
  it('passes through positive values', () => {
    expect(normalizeLiquidityFactor(0.6)).toBe(0.6);
    expect(normalizeLiquidityFactor('1.5')).toBe(1.5);
  });
});

describe('resolveOptionDeduction (tier × liquidityFactor, rounded)', () => {
  it('applies lf=1 by default (unchanged from raw tier)', () => {
    expect(resolveOptionDeduction(catScratch, 45000)).toBe(3000);
  });
  it('scales a high-demand model down (MacBook Air M1 case: base 10000, lf 0.6)', () => {
    // t3 = 10000 -> round(10000 * 0.6) = 6000
    expect(resolveOptionDeduction(screenCrack, 10000, 0.6)).toBe(6000);
    // t3 = 1500 -> round(1500 * 0.6) = 900
    expect(resolveOptionDeduction(catScratch, 10000, 0.6)).toBe(900);
  });
  it('rounds to the nearest baht', () => {
    // t2 = 2000 -> round(2000 * 0.333) = round(666) = 666
    expect(resolveOptionDeduction(catScratch, 20000, 0.333)).toBe(666);
  });
});

describe('isPercentOption', () => {
  it('is false for legacy tier-only options', () => {
    expect(isPercentOption(screenCrack)).toBe(false);
    expect(isPercentOption({ id: 'x' })).toBe(false);
  });
  it('is true only for a finite pct >= 0 (including 0)', () => {
    expect(isPercentOption({ id: 'x', pct: 35 })).toBe(true);
    expect(isPercentOption({ id: 'x', pct: 0 })).toBe(true);
    expect(isPercentOption({ id: 'x', pct: -5 })).toBe(false);
    expect(isPercentOption({ id: 'x', pct: NaN })).toBe(false);
  });
});

describe('resolveOptionDeduction — percentage mode', () => {
  const pctScreen = { id: 'o_pct', label: 'จอแตก', pct: 35, t1: 20000, t2: 15000, t3: 10000 };

  it('uses pct (not tiers) when pct is set, scaling with base price', () => {
    expect(resolveOptionDeduction(pctScreen, 45000)).toBe(15750); // 45000 * 35%
    expect(resolveOptionDeduction(pctScreen, 10000)).toBe(3500); //  10000 * 35%
  });
  it('applies liquidityFactor on top of pct (MacBook Air M1: base 10000, lf 0.6)', () => {
    expect(resolveOptionDeduction(pctScreen, 10000, 0.6)).toBe(2100); // 10000 * 35% * 0.6
  });
  it('pct=0 deducts nothing', () => {
    expect(resolveOptionDeduction({ id: 'x', pct: 0, t1: 9999 }, 50000)).toBe(0);
  });
  it('legacy options (no pct) are unchanged — still tier-based', () => {
    expect(resolveOptionDeduction(screenCrack, 45000)).toBe(20000);
    expect(resolveOptionDeduction(screenCrack, 10000, 0.6)).toBe(6000);
  });
});

describe('resolveOptionDeduction — fixed deduct mode (single value)', () => {
  const fixedScreen = { id: 'o_fixed', label: 'จอแตก', deduct: 4000 };

  it('isFixedDeductOption is true only for a finite deduct >= 0 (including 0)', () => {
    expect(isFixedDeductOption(fixedScreen)).toBe(true);
    expect(isFixedDeductOption({ id: 'x', deduct: 0 })).toBe(true);
    expect(isFixedDeductOption({ id: 'x', deduct: -5 })).toBe(false);
    expect(isFixedDeductOption({ id: 'x', deduct: NaN })).toBe(false);
    expect(isFixedDeductOption(screenCrack)).toBe(false);
  });
  it('uses deduct regardless of base price (no tier buckets)', () => {
    expect(resolveOptionDeduction(fixedScreen, 45000)).toBe(4000);
    expect(resolveOptionDeduction(fixedScreen, 10000)).toBe(4000);
  });
  it('applies liquidityFactor on top of deduct', () => {
    expect(resolveOptionDeduction(fixedScreen, 10000, 0.6)).toBe(2400);
  });
  it('deduct takes precedence over stale legacy tiers on the same option', () => {
    expect(resolveOptionDeduction({ id: 'x', deduct: 500, t1: 20000, t2: 15000, t3: 10000 }, 45000)).toBe(500);
  });
  it('pct takes precedence over deduct', () => {
    expect(resolveOptionDeduction({ id: 'x', pct: 10, deduct: 9999 }, 20000)).toBe(2000);
  });
  it('deduct=0 deducts nothing even with stale tiers present', () => {
    expect(resolveOptionDeduction({ id: 'x', deduct: 0, t1: 9999 }, 50000)).toBe(0);
  });
});

describe('resolveDeductions + resolveFinalPrice', () => {
  const groups = [
    { title: 'จอ', options: [screenCrack, { id: 'o_screen_ok', label: 'สมบูรณ์', t1: 0, t2: 0, t3: 0 }] },
    { title: 'ตัวเครื่อง', options: [catScratch] },
  ];

  it('sums only selected options and builds a breakdown', () => {
    const { total, lines } = resolveDeductions(groups, ['o_screen', 'o_scratch'], 45000, 1);
    expect(total).toBe(23000);
    expect(lines).toEqual([
      { groupTitle: 'จอ', label: 'จอแตก', optionId: 'o_screen', amount: 20000 },
      { groupTitle: 'ตัวเครื่อง', label: 'รอยขนแมว', optionId: 'o_scratch', amount: 3000 },
    ]);
  });

  it('applies liquidityFactor to the whole selection', () => {
    const { total } = resolveDeductions(groups, ['o_screen', 'o_scratch'], 10000, 0.6);
    // round(10000*0.6) + round(1500*0.6) = 6000 + 900
    expect(total).toBe(6900);
  });

  it('clamps final price at 0', () => {
    expect(resolveFinalPrice(10000, 23000)).toBe(0);
    expect(resolveFinalPrice(45000, 23000)).toBe(22000);
  });
});
