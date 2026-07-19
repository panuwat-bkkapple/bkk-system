import { ref, update } from 'firebase/database';
import { db } from '../../../api/firebase';

/**
 * One condition option within an assessment group.
 * `label`/`description` (Thai) are CANONICAL — used for matching/payloads
 * everywhere. `label_en`/`description_en` are OPTIONAL display-only English
 * labels read by the customer site (bkk-frontend-next) on /en; when there is
 * no translation the field is ABSENT (never an empty string).
 */
export interface ConditionSetOption {
  id: string;
  label: string;
  label_en?: string;
  description?: string;
  description_en?: string;
  deduct?: number;
  pct?: number;
  /** LEGACY tier buckets — read-only fallback, stripped on save once deduct/pct exists. */
  t1?: number;
  t2?: number;
  t3?: number;
  failBehavior?: 'pass' | 'reject' | 'deduct';
  [key: string]: unknown;
}

/**
 * One assessment group (topic) within a condition set. Same bilingual rule as
 * options: Thai `title`/`description` canonical, `*_en` optional display-only.
 */
export interface ConditionSetGroup {
  id: string;
  title: string;
  title_en?: string;
  description?: string;
  description_en?: string;
  icon?: string;
  kind?: 'cosmetic' | 'functional';
  options?: ConditionSetOption[];
  [key: string]: unknown;
}

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
    groups: sanitizeGroups(set.groups || []),
  });
}

/**
 * Drop optional English display keys (`title_en`/`description_en`/`label_en`)
 * that are empty/whitespace, so "no translation" is stored as ABSENT — never
 * `label_en: ''`. Non-empty values pass through untouched (returns the same
 * object when nothing needs stripping).
 */
function stripEmptyEn<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
  let next = obj;
  for (const k of keys) {
    const v = next?.[k];
    if (typeof v === 'string' && v.trim() === '') {
      if (next === obj) next = { ...obj };
      delete (next as Record<string, unknown>)[k];
    }
  }
  return next;
}

/**
 * Once an option carries a new-mode value (`deduct` or `pct`), drop its LEGACY
 * t1/t2/t3 keys — data migrates off tiers as it is edited, from BOTH the card
 * and the table view. Options with neither keep their tiers (read fallback in
 * pricingResolver).
 *
 * Optional English display fields (`title_en`/`description_en`/`label_en`) are
 * PRESERVED as-is; only empty-string values are dropped (absent = no translation).
 */
export function sanitizeGroups(groups: any[]): any[] {
  return (groups || []).map((g: any) => ({
    ...stripEmptyEn(g, ['title_en', 'description_en']),
    options: (g?.options || []).map((o: any) => {
      const clean = stripEmptyEn(o, ['label_en', 'description_en']);
      if (o?.deduct == null && o?.pct == null) return clean;
      const next = { ...clean };
      delete next.t1;
      delete next.t2;
      delete next.t3;
      return next;
    }),
  }));
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
  /**
   * Single flat baht deduction. null = not set (option still resolves via its
   * legacy t1/t2/t3 fallback, or deducts 0 when it never had tiers).
   */
  deduct: number | null;
  /**
   * Percentage-of-base deduction (0-100). When set (a number), it takes
   * precedence over `deduct` in the pricingResolver. null/empty = fixed mode.
   */
  pct: number | null;
  /**
   * Read-only display of LEGACY t1/t2/t3 values (e.g. "20,000 / 15,000 / 10,000")
   * so the admin can pick the right single value; '' when the option has none.
   */
  legacyTiers: string;
}

/** All editable columns in left-to-right display order (used by paste). */
export const EDITABLE_FIELDS = ['label', 'deduct', 'pct'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const fmtBaht = (n: unknown) => Number(n || 0).toLocaleString('th-TH');

/** "20,000 / 15,000 / 10,000" when the option still carries legacy tiers, else ''. */
export function legacyTierLabel(o: any): string {
  if (o?.t1 == null && o?.t2 == null && o?.t3 == null) return '';
  return `${fmtBaht(o.t1)} / ${fmtBaht(o.t2)} / ${fmtBaht(o.t3)}`;
}

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
        deduct: typeof o.deduct === 'number' && Number.isFinite(o.deduct) ? o.deduct : null,
        pct: typeof o.pct === 'number' && Number.isFinite(o.pct) ? o.pct : null,
        legacyTiers: legacyTierLabel(o),
      });
    }
  }
  return rows;
}

/**
 * Rebuild a condition set from edited rows, preserving the original group /
 * option structure and order. The table only edits existing options
 * (label + deduct + pct); it never adds/removes/reorders — add/remove stays in
 * the card editor. Rows are matched back by their `rowKey`.
 *
 * `deduct` / `pct`: a finite number >= 0 is written; null/empty REMOVES the
 * field. Once an option has a new-mode value (deduct or pct) its LEGACY
 * t1/t2/t3 keys are dropped — this is how data migrates off tiers as it is
 * edited. An option left with neither keeps its legacy tiers (read fallback).
 */
export function applyRowsToSet(set: any, rows: DeductionRow[]): any {
  const byKey = new Map(rows.map((r) => [r.rowKey, r]));
  const groups = (set?.groups || []).map((g: any) => ({
    ...g,
    options: (g?.options || []).map((o: any) => {
      const r = byKey.get(`${g.id}::${o.id}`);
      if (!r) return o;
      const next: any = { ...o, label: r.label };
      if (r.deduct != null && Number.isFinite(Number(r.deduct)) && Number(r.deduct) >= 0) {
        next.deduct = Number(r.deduct);
      } else {
        delete next.deduct;
      }
      if (r.pct != null && Number.isFinite(Number(r.pct)) && Number(r.pct) >= 0) {
        next.pct = Number(r.pct);
      } else {
        delete next.pct;
      }
      if (next.deduct != null || next.pct != null) {
        delete next.t1;
        delete next.t2;
        delete next.t3;
      }
      return next;
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
 * Validate the flat baht deduction cell before write.
 * Empty/null = OK and CLEARS deduct (back to legacy tiers / 0). Otherwise must
 * be a real number >= 0. (Deduction can equal any value — sets are per model
 * now, but there is still no per-row base price to bound against.)
 */
export function validateDeduction(raw: unknown): ValidationResult {
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: true, value: undefined }; // clears deduct
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return { ok: false, reason: 'ต้องเป็นตัวเลข' };
  if (n < 0) return { ok: false, reason: 'ต้องไม่ติดลบ (>= 0)' };
  return { ok: true, value: n };
}

/**
 * Validate the percentage cell before write.
 * Empty/null = OK and CLEARS pct (back to fixed/legacy mode). Otherwise must be
 * a number in [0, 100]. When set, pct overrides deduct and legacy tiers.
 */
export function validatePercent(raw: unknown): ValidationResult {
  if (raw === '' || raw === null || raw === undefined) {
    return { ok: true, value: undefined }; // clears pct -> tier mode
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,%\s]/g, ''));
  if (!Number.isFinite(n)) return { ok: false, reason: 'ต้องเป็นตัวเลข' };
  if (n < 0) return { ok: false, reason: 'ต้องไม่ติดลบ (>= 0)' };
  if (n > 100) return { ok: false, reason: 'ต้องไม่เกิน 100%' };
  return { ok: true, value: n };
}
