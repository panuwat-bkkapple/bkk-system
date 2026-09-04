// ตัวเทียบสถานะงานตัวเดียวของแอดมิน — normalizeStatus ทั้งสองฝั่ง แทน string literal
//
// ที่มา (4 ก.ย. 2569, docs/reports/2026-09-04-status-literal-compare-survey.md):
// DB มีสองสะกดของสถานะเดียวกันอยู่ถาวร — canonical จาก status engine
// ('Sent To QC Lab', 'Ready To Sell', 'Paid', 'Rider Assigned', ...) และสะกดเก่า
// จากแถวก่อน P2/P3 + writer ที่ยังไม่ผ่าน engine (payoutTransfer.ts: 'Payment
// Completed' / 'Waiting for Handover'). reader ที่เทียบ literal สะกดเดียวมองไม่เห็น
// อีกสะกด และมันไม่พัง มันแค่ว่างลงเงียบๆ (#709 /qc-station, #711 /inventory + POS,
// #713 ล็อต B2B ที่จ่ายแล้วไม่ล็อก)
//
// กติกา: reader เขียนเซ็ตด้วย JOB_STATUS.* / JOB_STATUS_B2B.* เท่านั้น แล้วถามผ่าน
// statusIs / statusIn ซึ่ง normalize ฝั่งงานก่อนเทียบ. สถานะที่ enum ไม่รู้จัก
// (เช่น 'Reserved' ของ dealer lot) ตกกลับไปเทียบค่าดิบกับตัวเอง — ไม่หาย ไม่พัง
//
// ด่าน: src/utils/statusLiteralCensus.test.ts นับ literal สะกดเก่าในตำแหน่งเทียบ
// ทั้ง src/ ต้องเป็น 0 และ literal canonical ลดได้ขึ้นไม่ได้
import { normalizeStatus } from '../types/job-statuses';

export type StatusJob = { status?: string | null; receive_method?: string | null } | null | undefined;

/** canonical ถ้าอ่านออก ไม่งั้นค่าดิบ (string ไม่ว่าง) ไม่งั้น null */
export const canonicalStatus = (raw: unknown, receiveMethod?: string | null): string | null => {
   const text = typeof raw === 'string' && raw ? raw : null;
   if (!text) return null;
   return normalizeStatus(text, receiveMethod) ?? text;
};

export const canonicalStatusOf = (job: StatusJob): string | null =>
   canonicalStatus(job?.status, job?.receive_method);

/** งานอยู่ในสถานะใดสถานะหนึ่งที่ให้มา (เขียนด้วย JOB_STATUS.*) */
export const statusIs = (job: StatusJob, ...canonical: readonly string[]): boolean => {
   const s = canonicalStatusOf(job);
   return !!s && canonical.includes(s);
};

export const statusIn = (job: StatusJob, set: ReadonlySet<string> | readonly string[]): boolean => {
   const s = canonicalStatusOf(job);
   if (!s) return false;
   return set instanceof Set ? set.has(s) : (set as readonly string[]).includes(s);
};

/**
 * เทียบ qc_logs[].action — engine เขียน action เป็นชื่อสถานะ canonical ส่วน log เก่า
 * ถือสะกดเดิม และบาง action ไม่ใช่สถานะเลย ('Deal Closed (Negotiated)') จึง
 * normalize แล้วตกกลับค่าดิบเหมือน canonicalStatus
 */
export const actionIs = (action: unknown, ...accepted: readonly string[]): boolean => {
   const a = canonicalStatus(action);
   return !!a && accepted.includes(a);
};
