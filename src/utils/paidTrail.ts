// "งานนี้จ่ายเงินลูกค้าไปแล้วหรือยัง" อ่านจากอะไร — ที่เดียวของสาม reader ฝั่งแอดมิน
//
// ที่มา (รายงาน 2026-09-04 cross-repo survey หัวข้อ 2, เงื่อนไข (ก) ของ PR cutover):
// writer จ่ายเงินตัวเดิม (payoutTransfer.ts) เขียน qc_logs.action = 'Paid' (B2C) /
// 'Payment Completed' (B2B) เอง reader สามตัวจึงเคยตัดสินจาก action นั้น:
//   MobileTicketDetail.wasPaid      — Pending QC เป็นก่อนจ่าย (Mail-in) หรือหลังจ่าย (Pickup)
//   qcStation.isJobAlreadyPaid      — ห้ามส่งงานที่จ่ายแล้วกลับ QC Review (วนลูป)
//   CEODashboard.CLOSED_LOG_ACTIONS — วันปิดจ๊อบ/ยอดรับซื้อวันนี้
// ตั้งแต่ writer ย้ายไป engine (confirmPayoutTransfer) action ในไทม์ไลน์คือ**สถานะ
// ปลายทาง** — B2C ได้ 'Waiting For Handover' ไม่ใช่ 'Paid' และ 'Paid' จะโผล่เฉพาะตอน
// ไรเดอร์ส่งมอบ (payment_handover_done) → reader ที่หา 'Paid' อย่างเดียวจะไม่เห็นงาน
// Pickup ที่จ่ายผ่าน engine **ทุกใบ** และปุ่มที่ Pending QC จะเสนอจ่ายซ้ำ
//
// กติกาที่นี่: **paid_at มาก่อนเสมอ** (engine ประทับในธุรกรรมเดียวกับสถานะสำหรับ B2C;
// trigger ประทับให้ทุกทางที่เข้า Paid) แล้วค่อยตกไปดู qc_logs สำหรับแถวเก่าที่ไม่มี
// paid_at — และรับ WAITING_FOR_HANDOVER เป็น action ที่แปลว่าจ่ายแล้วด้วย
import { JOB_STATUS } from '../types/job-statuses';
import { actionIs } from './statusCompare';

/** action ในไทม์ไลน์ที่แปลว่าเงินออกแล้ว — engine เขียนสถานะปลายทางเป็น action */
export const PAID_TRAIL_ACTIONS: readonly string[] = [JOB_STATUS.PAID, JOB_STATUS.WAITING_FOR_HANDOVER];

type LogLike = { action?: unknown; timestamp?: unknown } | null | undefined;
type JobLike = { paid_at?: unknown; qc_logs?: unknown } | null | undefined;

function logsOf(job: JobLike): LogLike[] {
  const raw = job?.qc_logs;
  if (Array.isArray(raw)) return raw as LogLike[];
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, LogLike>);
  return [];
}

export interface PaidTrailEntry {
  /** เวลาที่ถือว่าจ่าย/ปิด — paid_at ถ้ามี ไม่งั้น timestamp ของแถว log ที่เจอ */
  at: number;
  source: 'paid_at' | 'qc_logs';
}

/**
 * หลักฐานว่าจ่ายแล้ว หรือ null — `extraActions` คือ action เพิ่มที่ reader ตัวนั้นถือว่า
 * "ปิดแล้ว" นอกเหนือจากการจ่าย (เช่น In Stock ของแดชบอร์ด, Payout Processing ของสถานี)
 */
export function paidTrailEntry(job: JobLike, extraActions: readonly string[] = []): PaidTrailEntry | null {
  const paidAt = Number(job?.paid_at);
  if (job?.paid_at && Number.isFinite(paidAt) && paidAt > 0) return { at: paidAt, source: 'paid_at' };
  const accepted = [...PAID_TRAIL_ACTIONS, ...extraActions];
  const hit = logsOf(job).find((l) => l && actionIs(l.action, ...accepted));
  if (!hit) return null;
  const ts = Number(hit.timestamp);
  return { at: Number.isFinite(ts) ? ts : 0, source: 'qc_logs' };
}

export const jobWasPaid = (job: JobLike, extraActions: readonly string[] = []): boolean =>
  paidTrailEntry(job, extraActions) !== null;
