import { ref, update } from 'firebase/database';
import { db } from '../../../api/firebase';

/**
 * Single source of truth for persisting a condition set to RTDB.
 *
 * BOTH the card view (EngineSettingsModal grouped editor, via its "Save Set"
 * button) and the new inline table view write through this one helper so there
 * is exactly one write path / shape. Do not write `settings/condition_sets/{id}`
 * anywhere else.
 *
 * Mirrors the original `handleSaveSet` payload: `{ name, groups }`.
 */
export async function writeConditionSet(set: any): Promise<void> {
  if (!set?.id) throw new Error('writeConditionSet: set.id is required');
  await update(ref(db, `settings/condition_sets/${set.id}`), {
    name: set.name,
    groups: set.groups || [],
  });
}

/** One editable deduction row (= one condition option within a set). */
export interface DeductionRow {
  /** Stable grid row id: `${groupId}::${optionId}` */
  rowKey: string;
  groupId: string;
  /** Read-only — which assessment group the option belongs to. */
  groupTitle: string;
  optionId: string;
  /** Editable label of the condition option. */
  label: string;
  /** Tier deductions (baht). Editable, must be a number >= 0. */
  t1: number;
  t2: number;
  t3: number;
}

/** Editable numeric tier columns. Order matters for paste/fill mapping. */
export const TIER_FIELDS = ['t1', 't2', 't3'] as const;
/** All editable columns in left-to-right display order (used by paste). */
export const EDITABLE_FIELDS = ['label', 't1', 't2', 't3'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Flatten a condition set's groups/options into flat, editable grid rows. */
export function flattenSetToRows(set: any): DeductionRow[] {
  const rows: DeductionRow[] = [];
  for (const g of set?.groups || []) {
    for (const o of g?.options || []) {
      rows.push({
        rowKey: `${g.id}::${o.id}`,
        groupId: g.id,
        groupTitle: g.title || '',
        optionId: o.id,
        label: o.label || '',
        t1: Number(o.t1 || 0),
        t2: Number(o.t2 || 0),
        t3: Number(o.t3 || 0),
      });
    }
  }
  return rows;
}

/**
 * Rebuild a condition set from edited rows, preserving the original group /
 * option structure and order. The table only edits existing options
 * (label + t1/t2/t3); it never adds/removes/reorders — add/remove stays in the
 * card editor. Rows are matched back by their `rowKey`.
 */
export function applyRowsToSet(set: any, rows: DeductionRow[]): any {
  const byKey = new Map(rows.map((r) => [r.rowKey, r]));
  const groups = (set?.groups || []).map((g: any) => ({
    ...g,
    options: (g?.options || []).map((o: any) => {
      const r = byKey.get(`${g.id}::${o.id}`);
      if (!r) return o;
      return { ...o, label: r.label, t1: r.t1, t2: r.t2, t3: r.t3 };
    }),
  }));
  return { ...set, groups };
}

export interface ValidationResult {
  ok: boolean;
  /** Coerced numeric value when ok. */
  value?: number;
  reason?: string;
}

/**
 * Validate a tier deduction cell value before write.
 * Rule (agreed scope): must be a real number >= 0. (Condition options are
 * shared across many models with different base prices, so there is no single
 * per-row base price to bound against — the "> base price" guard does not apply
 * at this level.)
 */
export function validateDeduction(raw: unknown): ValidationResult {
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: false, reason: 'ต้องไม่ว่าง' };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return { ok: false, reason: 'ต้องเป็นตัวเลข' };
  if (n < 0) return { ok: false, reason: 'ต้องไม่ติดลบ (>= 0)' };
  return { ok: true, value: n };
}

/** Whether a field is one of the numeric tier columns. */
export function isTierField(field: string): field is (typeof TIER_FIELDS)[number] {
  return (TIER_FIELDS as readonly string[]).includes(field);
}
