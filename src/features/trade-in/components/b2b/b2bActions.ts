// ปุ่มของหน้า B2B -> event ของ status engine, เป็น **ข้อมูล** ไม่ใช่ switch
//
// ทำไมต้องเป็นข้อมูล: injection ตอนย้าย (P3-c) พบว่าการสลับ event ของปุ่มสองใบ
// ให้ผิดตัว **ไม่มีเทสไหนจับได้เลย** ทั้งที่ปลายทางคนละสถานะ — เพราะการผูก
// ปุ่มกับ event อยู่ใน onClick ซึ่งเทสมองไม่เห็น พอเป็นตารางแล้วมันถูกตรวจได้
// ว่าปุ่มไหนสัญญาอะไรไว้ (บทเรียนเดียวกับตาราง getQuickActions ของ
// MobileTicketDetail ที่ทำแบบนี้ตั้งแต่ P2-j)
import { JOB_EVENT, type JobEvent } from '@/utils/jobTransitions';

/** ชื่อ action ที่ปุ่มบน B2BManager ส่งเข้า handleB2BAction */
export type B2BActionType =
  | 'send_pre_quote'
  | 'accept_pre_quote'
  | 'dispatch_inspector'
  | 'send_final_quote'
  | 'accept_final_quote'
  | 'enter_negotiation'
  | 'issue_po'
  | 'wait_invoice'
  | 'submit_to_finance';

export const B2B_ACTION_EVENT: Record<B2BActionType, JobEvent> = {
  send_pre_quote: JOB_EVENT.B2B_PRE_QUOTE_SENT,
  accept_pre_quote: JOB_EVENT.B2B_PRE_QUOTE_ACCEPTED,
  dispatch_inspector: JOB_EVENT.B2B_AUDITOR_DISPATCHED,
  send_final_quote: JOB_EVENT.B2B_FINAL_QUOTE_SENT,
  accept_final_quote: JOB_EVENT.B2B_FINAL_QUOTE_ACCEPTED,
  enter_negotiation: JOB_EVENT.B2B_NEGOTIATION_OPENED,
  issue_po: JOB_EVENT.B2B_PO_ISSUED,
  wait_invoice: JOB_EVENT.B2B_INVOICE_REQUESTED,
  submit_to_finance: JOB_EVENT.B2B_SUBMITTED_TO_FINANCE,
};

/**
 * ฟิลด์ที่ต้องไปพร้อมการยกเลิกงาน — **ทั้งสามตัวเป็นข้อบังคับของ engine**
 * (`requires` ของ event `cancelled`) และของเดิมฝั่ง B2B ไม่เคยเขียนสักตัว
 *
 * ผลของการไม่เขียน ไม่ใช่แค่ข้อมูลขาด: `finalizeCancelledJobs` หา `cancelled_at`
 * ไม่เจอ งานจึงไม่มีวันปิดเป็น Closed (Lost) และ `getReopenDeadline` คำนวณ
 * กำหนดเปิดใหม่ไม่ได้ — งานค้างอยู่ที่ Cancelled ตลอดกาลโดยไม่มีใครเห็น
 *
 * `admin:` ไม่ใช่ `rider:` โดยตั้งใจ — `wasRiderWithdrawn` และการคิดค่าตอบแทน
 * ไรเดอร์อ่าน prefix นั้น การใช้ผิดจะทำให้งานที่แอดมินยกเลิกถูกนับเป็น
 * "ไรเดอร์ทิ้งงาน"
 */
export function buildCancelPatch(
  actorId: string | undefined | null,
  category: string,
  reason: string,
  now: number = Date.now()
): Record<string, unknown> {
  return {
    cancel_category: category,
    cancelled_by: `admin:${actorId || 'unknown'}`,
    cancelled_at: now,
    cancel_reason: reason,
  };
}
