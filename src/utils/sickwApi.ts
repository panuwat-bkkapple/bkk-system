// Thin wrapper รอบ Cloud Function `checkDeviceWithSickw`.
// ตัว API Key อยู่ใน Cloud Function env เท่านั้น — ฝั่ง client ไม่ต้องรู้
// แค่ส่ง IMEI + serviceId ไปแล้วรอผล
//
// Server cache TTL = 24 ชั่วโมง: ถ้าเรียกซ้ำภายใน 24h จะคืน cached เลย
// (กันเปลืองเครดิต) ส่ง forceRefresh:true เมื่อต้องการตรวจใหม่จริงๆ

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

export interface SickwCheckResult {
  ok: boolean;
  cached: boolean;
  checkedAt: number;
  serviceId: string;
  imei: string;
  status: string; // success | rejected | error | unknown
  parsed: SickwParsedFields;
  fields: Record<string, string>; // raw key:value ทุก field ที่ Sickw ส่งมา
  raw: string;
}

export interface SickwCheckInput {
  imei: string;
  serviceId: string | number;
  forceRefresh?: boolean;
}

export async function checkDeviceWithSickw(input: SickwCheckInput): Promise<SickwCheckResult> {
  const fn = httpsCallable<SickwCheckInput, SickwCheckResult>(
    getFunctions(app, 'asia-southeast1'),
    'checkDeviceWithSickw'
  );
  const { imei, serviceId, forceRefresh } = input;
  const result = await fn({ imei, serviceId: String(serviceId), forceRefresh });
  return result.data;
}

// helper: แปลงค่า iCloud/FMI/MDM/Blacklist ที่ Sickw ส่งมาให้รู้ว่า "เป็นปัญหาไหม"
// คืน 'clean' | 'flagged' | 'unknown' เพื่อให้ UI โชว์สี/ไอคอนได้ตรง
export type SickwFlagState = 'clean' | 'flagged' | 'unknown';

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
