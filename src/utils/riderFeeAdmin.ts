// ประตูเดียวของ "อนุมัติ / ยกเว้นค่ารอบ" จากหน้า /rider-audit — เรียก callable
// `adminRiderFeeApprove` / `adminRiderFeeWaive` / `adminRiderFeeConfig`
// (`functions/rider-fee-admin-api.js`)
//
// ห้าม `httpsCallable('adminRiderFee*')` ตรงที่อื่น และห้ามเขียน jobs/transactions
// ของค่ารอบจากเบราว์เซอร์ — ด่าน OWNER/ไม่มีไรเดอร์อยู่ฝั่ง server, ฝั่งนี้เป็นแค่ UX
//
// **throw เมื่อ server ปฏิเสธ** (ต่างจาก runJobTransition) เพราะผลลัพธ์ที่ต้องอ่าน
// คือ "ใบไหนไม่ผ่านด่าน" ซึ่งอยู่ในข้อความของ HttpsError อยู่แล้ว หน้าจอแค่ toast
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../api/firebase';

const REGION = 'asia-southeast1';

export interface RiderFeeApproveResult {
  approved: { jobId: string; txKey: string; amount: number }[];
  skipped: { jobId: string; code: string }[];
}

export interface RiderFeeWaiveResult {
  waived: { jobId: string }[];
  skipped: { jobId: string; code: string }[];
}

export interface RiderFeeConfig {
  ownerRiderIds: string[];
  /** false = OWNER_RIDER_IDS ยังไม่ตั้งบน functions — server จะปฏิเสธการอนุมัติทั้งหมด */
  configured: boolean;
}

const call = <I, O>(name: string) => httpsCallable<I, O>(getFunctions(app, REGION), name);

export async function fetchRiderFeeConfig(): Promise<RiderFeeConfig> {
  const res = await call<Record<string, never>, RiderFeeConfig>('adminRiderFeeConfig')({});
  return res.data;
}

export async function approveRiderFees(jobIds: string[]): Promise<RiderFeeApproveResult> {
  const res = await call<{ jobIds: string[] }, RiderFeeApproveResult>('adminRiderFeeApprove')({ jobIds });
  return res.data;
}

export async function waiveRiderFees(jobIds: string[], reason: string): Promise<RiderFeeWaiveResult> {
  const res = await call<{ jobIds: string[]; reason: string }, RiderFeeWaiveResult>('adminRiderFeeWaive')({
    jobIds,
    reason,
  });
  return res.data;
}

/** ข้อความจาก HttpsError ของ callable — ไม่โชว์ stack ไม่โชว์ code ดิบ */
export function riderFeeErrorMessage(e: unknown): string {
  const msg = (e as { message?: unknown })?.message;
  return typeof msg === 'string' && msg ? msg : 'เกิดข้อผิดพลาด';
}
