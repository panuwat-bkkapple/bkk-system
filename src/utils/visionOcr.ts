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

async function call<F>(mode: Mode, storageUri: string): Promise<ExtractResponse<F>> {
  const functions = getFunctions(app, 'asia-southeast1');
  const fn = httpsCallable<{ mode: Mode; storageUri: string }, ExtractResponse<F>>(functions, 'extractFromImage');
  const result = await fn({ mode, storageUri });
  return result.data;
}

export async function ocrIdCard(storageUri: string): Promise<ExtractResponse<IdCardFields>> {
  return call<IdCardFields>('idCard', storageUri);
}

/** Confidence threshold below which the operator should manually verify */
export const OCR_VERIFY_THRESHOLD = 0.8;
