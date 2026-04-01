/**
 * Variant Generator Utility
 *
 * สร้าง flat variants จาก base price + attribute modifiers
 * เพื่อ backward compatibility กับ frontend ที่อ่าน variants[] array
 */

import type { AttributeSchemaItem } from '../../../types/domain';

/** แปลงค่า size string เป็นตัวเลข GB เพื่อเปรียบเทียบ (เช่น "16GB"→16, "1TB"→1024, "512GB"→512) */
function parseStorageSize(s: string): number {
  if (!s) return 0;
  const cleaned = s.toUpperCase().trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*(TB|GB|MB|MM)?/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2] || 'GB';
  if (unit === 'TB') return num * 1024;
  if (unit === 'MB') return num / 1024;
  if (unit === 'MM') return num; // for watch size
  return num;
}

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

/** ผลลัพธ์การ detect modifiers จาก legacy variants */
export interface DetectResult {
  baseNewPrice: number;
  baseUsedPrice: number;
  modifiers: Record<string, ModifierGroup>;
  matchedCount: number;
  totalCount: number;
  mismatches: { variantName: string; expected: number; actual: number; diff: number }[];
}

/**
 * Smart detect: วิเคราะห์ legacy variants → คำนวณ base + modifiers อัตโนมัติ
 *
 * วิธีการ: เปรียบเทียบ pairs ของ variants ที่ต่างกันแค่ 1 attribute
 * แล้ว average ผลต่างราคาเพื่อหา modifier ที่แม่นยำที่สุด
 */
export function detectModifiersFromLegacyVariants(
  variants: any[],
  schema: AttributeSchemaItem[]
): DetectResult {
  const empty: DetectResult = {
    baseNewPrice: 0, baseUsedPrice: 0, modifiers: {},
    matchedCount: 0, totalCount: 0, mismatches: [],
  };
  if (!variants.length || !schema.length) return empty;

  // ---- Step 1: เตรียมข้อมูล ----
  const parsed = variants
    .filter(v => v.attributes)
    .map(v => ({
      attrs: { ...v.attributes } as Record<string, string>,
      usedPrice: Number(v.usedPrice || v.price || 0),
      newPrice: Number(v.newPrice || 0),
      name: v.name || '',
    }));

  if (parsed.length === 0) return empty;

  // ---- Step 2: หา unique values per attribute ----
  const attrValues: Record<string, string[]> = {};
  for (const attr of schema) {
    const set = new Set<string>();
    for (const p of parsed) {
      const val = p.attrs[attr.key];
      if (val) set.add(val);
    }
    attrValues[attr.key] = Array.from(set);
  }

  // ---- Step 3: หา base price (ราคาต่ำสุด) ----
  const usedPrices = parsed.map(p => p.usedPrice).filter(p => p > 0);
  const newPrices = parsed.map(p => p.newPrice).filter(p => p > 0);
  const baseUsedPrice = usedPrices.length > 0 ? Math.min(...usedPrices) : 0;
  const baseNewPrice = newPrices.length > 0 ? Math.min(...newPrices) : 0;

  // ---- Step 4: คำนวณ modifier ด้วยวิธี pairwise comparison ----
  // สำหรับแต่ละ attribute: หา pairs ที่ต่างกันแค่ attribute นั้น
  // แล้ว average ผลต่างราคา → ได้ relative modifier ต่อ value
  const modifiers: Record<string, ModifierGroup> = {};

  for (const attr of schema) {
    const values = attrValues[attr.key];
    if (values.length === 0) {
      modifiers[attr.key] = { options: [] };
      continue;
    }

    // สะสม delta ต่อ value pair
    const deltas: Record<string, { newDeltas: number[]; usedDeltas: number[] }> = {};
    for (const val of values) deltas[val] = { newDeltas: [], usedDeltas: [] };

    // เปรียบเทียบทุกคู่ variant ที่ต่างกันแค่ attribute นี้
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const a = parsed[i];
        const b = parsed[j];

        // เช็คว่าต่างกันแค่ attribute นี้หรือเปล่า
        let diffCount = 0;
        let diffKey = '';
        for (const s of schema) {
          if ((a.attrs[s.key] || '') !== (b.attrs[s.key] || '')) {
            diffCount++;
            diffKey = s.key;
          }
        }

        if (diffCount === 1 && diffKey === attr.key) {
          // ได้คู่ที่ต่างแค่ attribute นี้ → บันทึก delta ระหว่าง 2 values
          const valA = a.attrs[attr.key];
          const valB = b.attrs[attr.key];

          // เก็บ price difference: B เทียบกับ A
          deltas[valB].newDeltas.push(b.newPrice - a.newPrice);
          deltas[valB].usedDeltas.push(b.usedPrice - a.usedPrice);
          // A เทียบกับ B (กลับเครื่องหมาย)
          deltas[valA].newDeltas.push(a.newPrice - b.newPrice);
          deltas[valA].usedDeltas.push(a.usedPrice - b.usedPrice);
        }
      }
    }

    // คำนวณ modifier ต่อ value
    // ใช้ pairwise deltas ถ้ามี (แม่นยำกว่า), fallback เป็น average price
    const valueMods: { value: string; newMod: number; usedMod: number }[] = values.map(val => {
      const d = deltas[val];
      const hasPairwise = d.usedDeltas.length > 0;

      if (hasPairwise) {
        // ใช้ median ของ pairwise deltas (robust กว่า average)
        const sortedNew = [...d.newDeltas].sort((a, b) => a - b);
        const sortedUsed = [...d.usedDeltas].sort((a, b) => a - b);
        const mid = Math.floor(sortedNew.length / 2);
        return {
          value: val,
          newMod: sortedNew[mid],
          usedMod: sortedUsed[mid],
        };
      }

      // Fallback: ใช้ average price ของ variants ที่มี value นี้
      const matching = parsed.filter(p => p.attrs[attr.key] === val);
      const avgNew = matching.reduce((s, p) => s + p.newPrice, 0) / matching.length;
      const avgUsed = matching.reduce((s, p) => s + p.usedPrice, 0) / matching.length;
      return { value: val, newMod: avgNew, usedMod: avgUsed };
    });

    // Sort: ถ้าเป็น size-based (ram, storage, size) → sort ตามขนาดจริง
    // ถ้าไม่ใช่ → sort ตาม usedMod ascending
    const sizeKeys = ['storage', 'ram', 'size'];
    if (sizeKeys.includes(attr.key)) {
      valueMods.sort((a, b) => parseStorageSize(a.value) - parseStorageSize(b.value));
    } else {
      valueMods.sort((a, b) => a.usedMod - b.usedMod);
    }

    // Normalize: ค่าแรก (base) = 0, ที่เหลือ = delta จาก base
    const baseNew = valueMods[0].newMod;
    const baseUsed = valueMods[0].usedMod;

    const options: ModifierOption[] = valueMods.map(({ value, newMod, usedMod }) => ({
      value,
      newPriceMod: Math.round(newMod - baseNew),
      usedPriceMod: Math.round(usedMod - baseUsed),
    }));

    modifiers[attr.key] = { options };
  }

  // ---- Step 5: Verify accuracy ----
  const mismatches: DetectResult['mismatches'] = [];
  let matchedCount = 0;

  for (const p of parsed) {
    let expectedUsed = baseUsedPrice;
    for (const attr of schema) {
      const val = p.attrs[attr.key];
      const opt = modifiers[attr.key]?.options.find(o => o.value === val);
      if (opt) expectedUsed += opt.usedPriceMod;
    }

    if (Math.abs(expectedUsed - p.usedPrice) <= 500) {
      matchedCount++;
    } else {
      mismatches.push({
        variantName: p.name,
        expected: expectedUsed,
        actual: p.usedPrice,
        diff: p.usedPrice - expectedUsed,
      });
    }
  }

  return {
    baseNewPrice, baseUsedPrice, modifiers,
    matchedCount, totalCount: parsed.length, mismatches,
  };
}
