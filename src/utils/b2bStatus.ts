// สถานะของสาย B2B ที่หน้าแอดมินใช้กรอง/ล็อก/ติดป้าย — เทียบผ่าน normalizeStatus
// ทั้งสองฝั่ง ไม่ใช่ string literal
//
// เคสจริง 4 ก.ย. 2569 (P1 ในรายงาน status-literal survey): ล็อต B2B ที่จ่ายเงินแล้ว
// มีสองสะกดอยู่พร้อมกันบน production —
//   - 'Paid'              จาก engine (P3-a #690 สาย B2B เข้า canonical enum)
//   - 'Payment Completed' จาก payoutTransfer.ts (writer ไคลเอนต์ตัวเก่า — ย้ายขึ้น engine
//     เป็น confirmPayoutTransfer 4 ก.ย. 2569 ซึ่งเขียน 'Paid'; แถวที่มันเขียนไว้ยังอยู่)
// reader ที่เทียบ 'Payment Completed' สะกดเดียว (B2BAuditorTool lockedStatuses,
// TradeInDashboard แท็บ Logistics + ป้าย) จึงมองไม่เห็นใบที่ engine เขียน — ผลที่
// อันตรายที่สุดคือ **ล็อตที่จ่ายเงินแล้วยังแก้เกรด/ราคาได้** เพราะไม่ถูกล็อก
//
// normalizeStatus อ่าน 'Payment Completed' / 'PAID' เป็น JOB_STATUS.PAID (LEGACY_ALIAS)
// และคืนสถานะสาย B2B (JOB_STATUS_B2B) ตามเดิม จึงครอบทั้งสองสะกดในที่เดียว
import { JOB_STATUS, JOB_STATUS_B2B } from '../types/job-statuses';
import { canonicalStatusOf, statusIn, type StatusJob } from './statusCompare';

export { canonicalStatusOf };
const inSet = statusIn;

// ล็อตที่ห้ามแก้เกรด/ราคาแล้ว (B2BAuditorTool) — ตั้งแต่รอฝ่ายบัญชีอนุมัติเป็นต้นไป
export const B2B_LOCKED_STATUSES: ReadonlySet<string> = new Set([
   JOB_STATUS_B2B.PENDING_FINANCE_APPROVAL, JOB_STATUS.PAID, JOB_STATUS.IN_STOCK,
   JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED, JOB_STATUS.CLOSED_LOST,
]);
export const isB2BLotLocked = (job: StatusJob): boolean => inSet(job, B2B_LOCKED_STATUSES);

/** ล็อตจ่ายเงินแล้ว — ทั้ง 'Paid' (engine รวม confirmPayoutTransfer) และ 'Payment Completed' / 'PAID' (แถวเก่า) */
export const isB2BPaid = (job: StatusJob): boolean => canonicalStatusOf(job) === JOB_STATUS.PAID;

// สามแท็บของ TradeInDashboard ฝั่ง B2B
export const B2B_SALES_STATUSES: ReadonlySet<string> = new Set([
   JOB_STATUS_B2B.NEW_B2B_LEAD, JOB_STATUS.FOLLOWING_UP, JOB_STATUS_B2B.PRE_QUOTE_SENT,
   JOB_STATUS_B2B.PRE_QUOTE_ACCEPTED, JOB_STATUS_B2B.SITE_VISIT_GRADING, JOB_STATUS_B2B.FINAL_QUOTE_SENT,
   JOB_STATUS_B2B.FINAL_QUOTE_ACCEPTED, JOB_STATUS.NEGOTIATION,
]);
export const B2B_LOGISTICS_STATUSES: ReadonlySet<string> = new Set([
   JOB_STATUS_B2B.PO_ISSUED, JOB_STATUS_B2B.WAITING_FOR_INVOICE, JOB_STATUS_B2B.PENDING_FINANCE_APPROVAL,
   JOB_STATUS.PAID,
]);
export const B2B_CLOSED_STATUSES: ReadonlySet<string> = new Set([
   JOB_STATUS.IN_STOCK, JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED, JOB_STATUS.CLOSED_LOST,
]);
export const isB2BSales = (job: StatusJob): boolean => inSet(job, B2B_SALES_STATUSES);
export const isB2BLogistics = (job: StatusJob): boolean => inSet(job, B2B_LOGISTICS_STATUSES);
export const isB2BClosed = (job: StatusJob): boolean => inSet(job, B2B_CLOSED_STATUSES);
