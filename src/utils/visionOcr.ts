// Thin wrapper around the `extractFromImage` Cloud Function. Each helper
// returns the parsed fields or null on failure — callers should treat
// null as "OCR didn't help, fall back to manual entry" rather than an
// error to surface to the user.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../api/firebase';

type Mode = 'idCard' | 'imei' | 'battery' | 'findMy' | 'warranty';

interface ExtractResponse<F> {
  mode: Mode;
  confidence: number;
  fields: F | null;
  warning?: string;
}

export interface IdCardFields {
  idNumber: string | null;
  name: string | null;
  address: string | null;
  dateOfBirth: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}

export interface ImeiFields {
  imei: string | null;
  imei2: string | null;
  serial: string | null;
  modelNumber: string | null;
  modelName: string | null;
}

export interface BatteryFields {
  maximumCapacityPct: number | null;
  cycleCount: number | null;
  peakPerformanceCapability: string | null;
}

export interface FindMyFields {
  findMyStatus: 'on' | 'off' | 'unknown';
  activationLock: 'on' | 'off' | 'unknown';
  appleIdHint: string | null;
}

export interface WarrantyFields {
  status: 'active' | 'expired' | 'unknown';
  expiresAt: string | null;
  coverageType: 'applecare_plus' | 'limited_warranty' | null;
  expiresAtRaw: string | null;
}

async function call<F>(mode: Mode, storageUri: string): Promise<ExtractResponse<F>> {
  const functions = getFunctions(app, 'asia-southeast1');
  const fn = httpsCallable<{ mode: Mode; storageUri: string }, ExtractResponse<F>>(functions, 'extractFromImage');
  const result = await fn({ mode, storageUri });
  return result.data;
}

export async function ocrIdCard(storageUri: string): Promise<ExtractResponse<IdCardFields>> {
  return call<IdCardFields>('idCard', storageUri);
}

export async function ocrImei(storageUri: string): Promise<ExtractResponse<ImeiFields>> {
  return call<ImeiFields>('imei', storageUri);
}

export async function ocrBattery(storageUri: string): Promise<ExtractResponse<BatteryFields>> {
  return call<BatteryFields>('battery', storageUri);
}

export async function ocrFindMy(storageUri: string): Promise<ExtractResponse<FindMyFields>> {
  return call<FindMyFields>('findMy', storageUri);
}

export async function ocrWarranty(storageUri: string): Promise<ExtractResponse<WarrantyFields>> {
  return call<WarrantyFields>('warranty', storageUri);
}

/** Confidence threshold below which the operator should manually verify */
export const OCR_VERIFY_THRESHOLD = 0.8;

