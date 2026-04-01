/**
 * Variant Generator Utility
 *
 * สร้าง flat variants จาก base price + attribute modifiers
 * เพื่อ backward compatibility กับ frontend ที่อ่าน variants[] array
 */

import type { AttributeSchemaItem } from '../../../types/domain';

export interface ModifierOption {
  value: string;
  newPriceMod: number;
  usedPriceMod: number;
}

export interface ModifierGroup {
  options: ModifierOption[];
}

export interface GeneratedVariant {
  id: string;
  name: string;
  attributes: Record<string, string>;
  newPrice: number;
  usedPrice: number;
}

export interface PriceOverride {
  newPrice: number;
  usedPrice: number;
}

/**
 * สร้าง Cartesian product ของ attribute options ทั้งหมด
 * เช่น [["32GB","64GB"], ["512GB","1TB"]] → [["32GB","512GB"], ["32GB","1TB"], ["64GB","512GB"], ["64GB","1TB"]]
 */
function cartesianProduct(arrays: string[][]): string[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<string[][]>(
    (acc, curr) => acc.flatMap(combo => curr.map(item => [...combo, item])),
    [[]]
  );
}

/**
 * สร้าง override key จาก combination values
 * เช่น ["M2 Max 30-core", "32GB", "512GB"] → "M2 Max 30-core|32GB|512GB"
 */
export function makeOverrideKey(values: string[]): string {
  return values.join('|');
}

/**
 * Generate flat variants จาก modifier-based pricing
 */
export function generateVariantsFromModifiers(
  schema: AttributeSchemaItem[],
  modifiers: Record<string, ModifierGroup>,
  baseNewPrice: number,
  baseUsedPrice: number,
  overrides?: Record<string, PriceOverride>
): GeneratedVariant[] {
  // เก็บ attribute keys ที่มี options
  const attrKeys: string[] = [];
  const attrOptions: string[][] = [];

  for (const attr of schema) {
    const mod = modifiers[attr.key];
    if (mod && mod.options.length > 0) {
      attrKeys.push(attr.key);
      attrOptions.push(mod.options.map(o => o.value));
    }
  }

  if (attrKeys.length === 0) {
    return [{
      id: 'v1',
      name: '',
      attributes: {},
      newPrice: baseNewPrice,
      usedPrice: baseUsedPrice,
    }];
  }

  // สร้างทุก combination
  const combos = cartesianProduct(attrOptions);

  return combos.map((combo, idx) => {
    const attributes: Record<string, string> = {};
    let newPrice = baseNewPrice;
    let usedPrice = baseUsedPrice;

    combo.forEach((value, i) => {
      const key = attrKeys[i];
      attributes[key] = value;

      // หา modifier ของ value นี้
      const mod = modifiers[key]?.options.find(o => o.value === value);
      if (mod) {
        newPrice += mod.newPriceMod;
        usedPrice += mod.usedPriceMod;
      }
    });

    // เช็ค override
    const overrideKey = makeOverrideKey(combo);
    if (overrides?.[overrideKey]) {
      newPrice = overrides[overrideKey].newPrice;
      usedPrice = overrides[overrideKey].usedPrice;
    }

    // สร้าง name จาก ordered values
    const name = combo.join(' | ');

    return {
      id: `v${idx + 1}`,
      name,
      attributes,
      newPrice,
      usedPrice,
    };
  });
}

/**
 * คำนวณจำนวน combinations ทั้งหมด
 */
export function countCombinations(modifiers: Record<string, ModifierGroup>): number {
  const counts = Object.values(modifiers)
    .map(m => m.options.length)
    .filter(c => c > 0);
  if (counts.length === 0) return 0;
  return counts.reduce((acc, c) => acc * c, 1);
}

/**
 * คำนวณ price range (min/max)
 */
export function getPriceRange(
  modifiers: Record<string, ModifierGroup>,
  baseNewPrice: number,
  baseUsedPrice: number
): { minNew: number; maxNew: number; minUsed: number; maxUsed: number } {
  let minNewMod = 0, maxNewMod = 0;
  let minUsedMod = 0, maxUsedMod = 0;

  for (const mod of Object.values(modifiers)) {
    if (mod.options.length === 0) continue;
    const newMods = mod.options.map(o => o.newPriceMod);
    const usedMods = mod.options.map(o => o.usedPriceMod);
    minNewMod += Math.min(...newMods);
    maxNewMod += Math.max(...newMods);
    minUsedMod += Math.min(...usedMods);
    maxUsedMod += Math.max(...usedMods);
  }

  return {
    minNew: baseNewPrice + minNewMod,
    maxNew: baseNewPrice + maxNewMod,
    minUsed: baseUsedPrice + minUsedMod,
    maxUsed: baseUsedPrice + maxUsedMod,
  };
}

/**
 * พยายาม detect base price + modifiers จาก legacy variants
 * ใช้ตอน upgrade จาก legacy → modifier mode
 */
export function detectModifiersFromLegacyVariants(
  variants: any[],
  schema: AttributeSchemaItem[]
): {
  baseNewPrice: number;
  baseUsedPrice: number;
  modifiers: Record<string, ModifierGroup>;
  unmatchedCount: number;
} {
  if (!variants.length || !schema.length) {
    return { baseNewPrice: 0, baseUsedPrice: 0, modifiers: {}, unmatchedCount: 0 };
  }

  // หา unique values ต่อ attribute
  const attrValues: Record<string, Set<string>> = {};
  for (const attr of schema) {
    attrValues[attr.key] = new Set();
  }
  for (const v of variants) {
    if (!v.attributes) continue;
    for (const attr of schema) {
      const val = v.attributes[attr.key];
      if (val) attrValues[attr.key].add(val);
    }
  }

  // หา base price = ราคาต่ำสุด
  const usedPrices = variants.map(v => Number(v.usedPrice || v.price || 0)).filter(p => p > 0);
  const newPrices = variants.map(v => Number(v.newPrice || 0)).filter(p => p > 0);
  const baseUsedPrice = usedPrices.length > 0 ? Math.min(...usedPrices) : 0;
  const baseNewPrice = newPrices.length > 0 ? Math.min(...newPrices) : 0;

  // คำนวณ average modifier per attribute value
  // ใช้วิธี: สำหรับแต่ละ attribute หา average price diff ระหว่าง value กับ base
  const modifiers: Record<string, ModifierGroup> = {};

  for (const attr of schema) {
    const values = Array.from(attrValues[attr.key]);
    if (values.length === 0) {
      modifiers[attr.key] = { options: [] };
      continue;
    }

    const options: ModifierOption[] = values.map(value => {
      // หา variants ที่มี value นี้
      const matching = variants.filter(v => v.attributes?.[attr.key] === value);
      if (matching.length === 0) return { value, newPriceMod: 0, usedPriceMod: 0 };

      // หา variants ที่ต่างจากตัวนี้แค่ attribute เดียว เพื่อคำนวณ delta
      // Simplified: ใช้ average price ของ variants ที่มี value นี้ ลบ base
      const avgUsed = matching.reduce((s, v) => s + Number(v.usedPrice || v.price || 0), 0) / matching.length;
      const avgNew = matching.reduce((s, v) => s + Number(v.newPrice || 0), 0) / matching.length;

      return { value, newPriceMod: 0, usedPriceMod: 0 }; // เริ่มที่ 0 ให้ admin ปรับเอง
    });

    // Sort: ราคาน้อยสุดก่อน
    modifiers[attr.key] = { options };
  }

  // นับ variants ที่ราคาจะไม่ตรงกับสูตร (เพราะเราเริ่มที่ 0 ทั้งหมด)
  const unmatchedCount = variants.length;

  return { baseNewPrice, baseUsedPrice, modifiers, unmatchedCount };
}
