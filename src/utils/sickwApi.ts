// Thin wrapper รอบ Cloud Function `checkDeviceWithSickw` + `submitSickwGateOverride`.
// API Key อยู่ใน Cloud Function env เท่านั้น — client ไม่ต้องรู้
//
// Server cache TTL = 24 ชั่วโมง: ถ้าเรียกซ้ำภายใน 24h จะคืน cached เลย
// (กันเปลืองเครดิต) ส่ง forceRefresh:true เมื่อต้องการตรวจใหม่จริงๆ
//
// ถ้าส่ง jobId มาด้วย: Cloud Function จะเขียน snapshot ผลตรวจล่าสุดลง
// jobs/{jobId}/sickw_check/last_check ให้อัตโนมัติ — Gate ใช้ snapshot นี้ตัดสิน

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../api/firebase';

export interface SickwParsedFields {
  model?: string;
  modelNumber?: string;
  capacity?: string;
  color?: string;
  country?: string;
  imei?: string;
  imei2?: string;
  serial?: string;
  iCloudStatus?: string;
  fmiStatus?: string;
  activationLock?: string;
  activationStatus?: string;
  mdmStatus?: string;
  blacklistStatus?: string;
  carrier?: string;
  simLock?: string;
  warrantyStatus?: string;
  estimatedPurchaseDate?: string;
}

export type SickwFlagState = 'clean' | 'flagged' | 'unknown';

export interface SickwFlags {
  fmi: SickwFlagState;
  mdm: SickwFlagState;
  blacklist: SickwFlagState;
}

export interface SickwCheckResult {
  ok: boolean;
  cached: boolean;
  checkedAt: number;
  serviceId: string;
  imei: string;
  status: string; // success | rejected | error | unknown
  parsed: SickwParsedFields;
  fields: Record<string, string>;
  raw: string;
  flags: SickwFlags;
}

export interface SickwCheckInput {
  imei: string;
  serviceId: string | number;
  forceRefresh?: boolean;
  jobId?: string;
}

// Shape ที่ Cloud Function เก็บใน jobs/{jobId}/sickw_check
export interface JobSickwCheck {
  last_check?: {
    checked_at: number;
    checked_by_uid: string;
    service_id: string;
    imei: string;
    status: string;
    parsed: SickwParsedFields;
    fields: Record<string, string>;
    raw: string;
    flags: SickwFlags;
  };
  override?: SickwOverride;
  override_history?: Record<string, SickwOverride>;
}

export interface SickwOverride {
  overridden_at: number;
  overridden_by_uid: string;
  overridden_by_name: string;
  overridden_by_role: string;
  reason: string;
  against_check_at: number;
  against_imei: string;
}

export async function checkDeviceWithSickw(input: SickwCheckInput): Promise<SickwCheckResult> {
  const fn = httpsCallable<SickwCheckInput, SickwCheckResult>(
    getFunctions(app, 'asia-southeast1'),
    'checkDeviceWithSickw'
  );
  const result = await fn({
    imei: input.imei,
    serviceId: String(input.serviceId),
    forceRefresh: input.forceRefresh,
    jobId: input.jobId,
  });
  return result.data;
}

export async function submitSickwGateOverride(jobId: string, reason: string): Promise<{ ok: boolean; override: SickwOverride }> {
  const fn = httpsCallable<{ jobId: string; reason: string }, { ok: boolean; override: SickwOverride }>(
    getFunctions(app, 'asia-southeast1'),
    'submitSickwGateOverride'
  );
  const result = await fn({ jobId, reason });
  return result.data;
}

export function interpretFmi(value: string | undefined): SickwFlagState {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v.includes('off') || v.includes('clean') || v.includes('disabled')) return 'clean';
  if (v.includes('on') || v.includes('locked') || v.includes('enabled') || v.includes('active')) return 'flagged';
  return 'unknown';
}

export function interpretMdm(value: string | undefined): SickwFlagState {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v.includes('no') || v.includes('clean') || v.includes('off') || v.includes('clear') || v.includes('not enrolled')) return 'clean';
  if (v.includes('yes') || v.includes('lock') || v.includes('enrolled') || v.includes('supervised')) return 'flagged';
  return 'unknown';
}

export function interpretBlacklist(value: string | undefined): SickwFlagState {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v.includes('clean') || v.includes('not') || v.includes('no') || v.includes('off')) return 'clean';
  if (v.includes('blacklist') || v.includes('lost') || v.includes('stolen') || v.includes('yes')) return 'flagged';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate logic — ใช้ตัดสินว่า submit QC / payout ผ่านได้หรือไม่
//
// กฎ:
//   1. ถ้าไม่เคยตรวจ Sickw → ผ่านได้ (warning ที่ banner เท่านั้น)
//   2. ถ้า last_check.status !== 'success' (error/rejected) → ผ่านได้
//      (เครดิตหมด/network เสีย จะ block business ทั้งหมดไม่ได้)
//   3. ถ้า flags.fmi/mdm/blacklist === 'flagged' → block
//   4. ถ้ามี override ที่ against_check_at ตรงกับ last_check.checked_at
//      → unblock (override ใช้ได้กับเช็คเดิมเท่านั้น)
//   5. ถ้ามี override เก่าแต่กดตรวจใหม่แล้วยัง flagged → ต้อง override ใหม่
// ─────────────────────────────────────────────────────────────────────────────

export interface SickwGateStatus {
  blocked: boolean;
  reasons: string[];
  state: 'none' | 'error' | 'clean' | 'flagged' | 'overridden';
  override?: SickwOverride;
  staleOverride?: boolean; // override มี แต่ไม่ตรงกับ check ล่าสุด
}

export function getSickwGateStatus(sickwCheck: JobSickwCheck | undefined | null): SickwGateStatus {
  const lc = sickwCheck?.last_check;
  if (!lc) {
    return { blocked: false, reasons: [], state: 'none' };
  }
  if (lc.status !== 'success') {
    return { blocked: false, reasons: [], state: 'error' };
  }

  const flags = lc.flags || {
    fmi: interpretFmi(lc.parsed?.fmiStatus || lc.parsed?.iCloudStatus || lc.parsed?.activationLock),
    mdm: interpretMdm(lc.parsed?.mdmStatus),
    blacklist: interpretBlacklist(lc.parsed?.blacklistStatus),
  };

  const reasons: string[] = [];
  if (flags.fmi === 'flagged') reasons.push('Find My / iCloud ติดล็อค');
  if (flags.mdm === 'flagged') reasons.push('ติด MDM');
  if (flags.blacklist === 'flagged') reasons.push('ติด Blacklist (Stolen/Lost)');

  if (reasons.length === 0) {
    return { blocked: false, reasons: [], state: 'clean' };
  }

  // มี flag ติด — เช็ค override
  const override = sickwCheck?.override;
  if (override && override.against_check_at === lc.checked_at) {
    return { blocked: false, reasons, state: 'overridden', override };
  }

  return {
    blocked: true,
    reasons,
    state: 'flagged',
    override,
    staleOverride: !!override && override.against_check_at !== lc.checked_at,
  };
}
