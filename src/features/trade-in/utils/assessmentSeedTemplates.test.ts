import { describe, it, expect } from 'vitest';
import { FUNCTIONAL_TEMPLATES, CONDITION_TEMPLATES, OK } from './assessmentSeedTemplates';
import { fillEnFields, translateAssessmentText } from './assessmentEnSeed';
import type { ConditionSetGroup } from './conditionSets';

// Every Thai string shipped in the built-in seed templates (group titles,
// group descriptions, option labels, option descriptions) must resolve
// through translateAssessmentText, so that fillEnFields — which runs when a
// set is opened AND when a template is seeded — leaves ZERO empty *_en
// fields on the app's own template content.

interface Cell { where: string; field: string; thai: string }

function collectTemplateStrings(): Cell[] {
  const cells: Cell[] = [];
  for (const [cat, tpl] of Object.entries(FUNCTIONAL_TEMPLATES)) {
    tpl.items.forEach((g, gi) => {
      cells.push({ where: `functional:${cat}[${gi}]`, field: 'title', thai: g.title });
      cells.push({ where: `functional:${cat}[${gi}]`, field: 'description', thai: g.description });
      g.options.forEach((o, oi) => {
        cells.push({ where: `functional:${cat}[${gi}].options[${oi}]`, field: 'label', thai: o.label });
        cells.push({ where: `functional:${cat}[${gi}].options[${oi}]`, field: 'description', thai: o.description });
      });
    });
  }
  for (const [key, tpl] of Object.entries(CONDITION_TEMPLATES)) {
    tpl.items.forEach((g, gi) => {
      cells.push({ where: `condition:${key}[${gi}]`, field: 'title', thai: g.title });
      cells.push({ where: `condition:${key}[${gi}]`, field: 'description', thai: g.description });
      g.options.forEach((o, oi) => {
        cells.push({ where: `condition:${key}[${gi}].options[${oi}]`, field: 'label', thai: o.label });
        cells.push({ where: `condition:${key}[${gi}].options[${oi}]`, field: 'description', thai: o.description });
      });
    });
  }
  // The OK() helper's default description also ships in the app.
  cells.push({ where: 'helper:OK()', field: 'description', thai: OK().description });
  return cells;
}

describe('seed templates EN coverage', () => {
  it('translateAssessmentText resolves EVERY Thai string in the seed templates', () => {
    const missing = collectTemplateStrings()
      .filter((c) => translateAssessmentText(c.thai) === null)
      .map((c) => `${c.where}.${c.field}: "${c.thai}"`);
    expect(missing, `untranslatable template strings:\n${missing.join('\n')}`).toEqual([]);
  });

  it('fillEnFields leaves zero empty *_en fields on every seeded template group', () => {
    const allGroups: ConditionSetGroup[] = [
      ...Object.values(FUNCTIONAL_TEMPLATES).flatMap((tpl) =>
        tpl.items.map((g, i) => ({
          id: `g_f_${i}`,
          title: g.title,
          icon: g.icon,
          description: g.description,
          kind: 'functional' as const,
          options: g.options.map((o, j) => ({ id: `o_${i}_${j}`, label: o.label, description: o.description, deduct: 0, failBehavior: o.failBehavior })),
        })),
      ),
      ...Object.values(CONDITION_TEMPLATES).flatMap((tpl) =>
        tpl.items.map((g, i) => ({
          id: `g_c_${i}`,
          title: g.title,
          icon: g.icon,
          description: g.description,
          kind: g.kind,
          options: g.options.map((o, j) => ({ id: `o_${i}_${j}`, label: o.label, description: o.description })),
        })),
      ),
    ];
    const { groups } = fillEnFields(allGroups);
    const empty: string[] = [];
    const filledStr = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    for (const g of groups) {
      if (!filledStr(g.title_en)) empty.push(`group "${g.title}" title_en`);
      if (filledStr(g.description) && !filledStr(g.description_en)) empty.push(`group "${g.title}" description_en`);
      for (const o of g.options || []) {
        if (!filledStr(o.label_en)) empty.push(`option "${o.label}" label_en`);
        if (filledStr(o.description) && !filledStr(o.description_en)) empty.push(`option "${o.label}" description_en`);
      }
    }
    expect(empty, `empty *_en after fillEnFields:\n${empty.join('\n')}`).toEqual([]);
  });

  it('default editor placeholders translate too (new set / new group / new option)', () => {
    for (const thai of ['หัวข้อประเมินใหม่', 'ตัวเลือก 1', 'ตัวเลือกใหม่']) {
      expect(translateAssessmentText(thai), thai).not.toBeNull();
    }
  });
});
