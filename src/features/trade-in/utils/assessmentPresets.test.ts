import { describe, it, expect } from 'vitest';
import { ASSESSMENT_PRESETS } from './assessmentPresets';
import type { PresetEntry } from './assessmentPresets';

// Prohibited glossary words (see bkk-frontend-next CLAUDE.md i18n rules).
// "item" is only banned as a device noun, so a simple word-boundary check on
// the curated EN copy is enough — none of it should ever need the word.
const PROHIBITED: { re: RegExp; name: string }[] = [
  { re: /appraisal/i, name: 'appraisal' },
  { re: /check\s*price/i, name: 'check price' },
  { re: /\bitem\b/i, name: 'item (as a device noun)' },
  { re: /serious\s*cash/i, name: 'serious cash' },
  { re: /big\s*money/i, name: 'big money' },
  { re: /phone\s*machine/i, name: 'phone machine' },
];

const REQUIRED_CATEGORIES = [
  'screen', 'body', 'functional', 'battery', 'accessories', 'warranty', 'model', 'mac', 'watch',
];

const allEntries = (cat: { topics: PresetEntry[]; options: PresetEntry[] }): PresetEntry[] =>
  [...cat.topics, ...cat.options];

describe('ASSESSMENT_PRESETS', () => {
  it('covers all required categories with a Thai label', () => {
    for (const key of REQUIRED_CATEGORIES) {
      expect(ASSESSMENT_PRESETS[key], `missing category "${key}"`).toBeDefined();
      expect(ASSESSMENT_PRESETS[key].label.trim().length).toBeGreaterThan(0);
    }
  });

  it('has topics and a usable number of options per category', () => {
    for (const [key, cat] of Object.entries(ASSESSMENT_PRESETS)) {
      expect(cat.topics.length, `${key}: no topics`).toBeGreaterThan(0);
      expect(cat.options.length, `${key}: too few options`).toBeGreaterThanOrEqual(8);
      expect(cat.options.length, `${key}: too many options`).toBeLessThanOrEqual(15);
    }
  });

  it('every entry has non-empty th + en (and non-empty descriptions when present)', () => {
    for (const [key, cat] of Object.entries(ASSESSMENT_PRESETS)) {
      for (const entry of allEntries(cat)) {
        expect(entry.th.trim().length, `${key}: empty th`).toBeGreaterThan(0);
        expect(entry.en.trim().length, `${key} "${entry.th}": empty en`).toBeGreaterThan(0);
        if (entry.desc_th !== undefined) expect(entry.desc_th.trim().length, `${key} "${entry.th}": empty desc_th`).toBeGreaterThan(0);
        if (entry.desc_en !== undefined) expect(entry.desc_en.trim().length, `${key} "${entry.th}": empty desc_en`).toBeGreaterThan(0);
      }
    }
  });

  it('uses no prohibited glossary words in the English copy', () => {
    for (const [key, cat] of Object.entries(ASSESSMENT_PRESETS)) {
      for (const entry of allEntries(cat)) {
        for (const text of [entry.en, entry.desc_en ?? '']) {
          for (const { re, name } of PROHIBITED) {
            expect(re.test(text), `${key} "${entry.th}": EN "${text}" contains prohibited "${name}"`).toBe(false);
          }
        }
      }
    }
  });

  it('has no duplicate th values within a category', () => {
    for (const [key, cat] of Object.entries(ASSESSMENT_PRESETS)) {
      const seen = new Set<string>();
      for (const entry of allEntries(cat)) {
        const th = entry.th.trim();
        expect(seen.has(th), `${key}: duplicate th "${th}"`).toBe(false);
        seen.add(th);
      }
    }
  });

  it('contains no emojis in any field', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [key, cat] of Object.entries(ASSESSMENT_PRESETS)) {
      for (const entry of allEntries(cat)) {
        for (const text of [entry.th, entry.en, entry.desc_th ?? '', entry.desc_en ?? '']) {
          expect(emoji.test(text), `${key} "${entry.th}": emoji found in "${text}"`).toBe(false);
        }
      }
    }
  });
});
