// เส้นทางใบเบิกค่าใช้จ่ายไรเดอร์ — **ฝั่งหน้าจอเท่านั้น**
//
// ตารางจริงอยู่ที่ `functions/rider-expense-flow.js` และ **มันคือคนตัดสิน** —
// ไฟล์นี้มีไว้ตอบคำถามเดียวว่า "สถานะนี้ควรขึ้นปุ่มอะไรให้คนนี้" เพื่อไม่ให้
// หน้าจอเสนอปุ่มที่ server จะปฏิเสธอยู่ดี. functions เป็น JS import TS ไม่ได้
// จึงรวมเป็นไฟล์เดียวไม่ได้ (เหตุผลเดียวกับ notification-settings / job-statuses)
//
// **สิ่งที่ mirror คือกฎ ไม่ใช่จำนวนจุดที่เรียกกฎ** — ที่นี่ไม่ต้องมี
// `resolveTransition` ครบตัว เพราะหน้าจอไม่เคยต้องรู้ว่า transition ที่กดไม่ได้
// ล้มด้วยเหตุผลอะไร (server ส่งข้อความมาให้อยู่แล้ว) ถ้าลอกมาทั้งก้อนจะได้
// สำเนาที่ไม่มีใครเรียกครึ่งหนึ่งทันที

export type ExpenseStatus =
  | 'submitted'
  | 'approved'
  | 'finance_approved'
  | 'paid'
  | 'needs_info'
  | 'rejected';

export type ExpenseAction =
  | 'ops_approve'
  | 'finance_approve'
  | 'pay'
  | 'send_back'
  | 'reject'
  | 'resubmit';

/** ใบที่ยังไม่จบ = ยังมีคนต้องกดอะไรสักอย่าง (ใช้นับ badge) */
export const EXPENSE_PENDING_STATUSES: ExpenseStatus[] = [
  'submitted',
  'approved',
  'finance_approved',
];

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  submitted: 'รอหัวหน้าตรวจ',
  approved: 'รอฝ่ายบัญชีตรวจเอกสาร',
  finance_approved: 'ตั้งเบิกแล้ว รอจ่าย',
  paid: 'จ่ายแล้ว',
  needs_info: 'ส่งกลับให้ไรเดอร์แก้',
  rejected: 'ปฏิเสธ',
};

export const EXPENSE_ACTION_LABEL: Record<ExpenseAction, string> = {
  ops_approve: 'ยืนยันว่างานนี้วิ่งจริง',
  finance_approve: 'เอกสารครบ ตั้งเบิก',
  pay: 'จ่ายเงินเข้ากระเป๋า',
  send_back: 'ส่งกลับให้แก้',
  reject: 'ปฏิเสธ',
  resubmit: 'เอกสารครบแล้ว ส่งกลับเข้าคิว',
};

/** action ที่ต้องกรอกเหตุผลก่อนกดได้ — ไรเดอร์เป็นคนอ่านข้อความนั้น */
export const EXPENSE_ACTION_NEEDS_REASON: ExpenseAction[] = ['send_back', 'reject'];

type Actor = {
  /** หัวหน้า/แอดมินไรเดอร์ — CEO หรือ MANAGER */
  isOps: boolean;
  /** ฝ่ายบัญชี — CEO, บัญชีที่มีสิทธิ์จ่ายเงินออก หรือ role FINANCE */
  isFinance: boolean;
};

/**
 * ปุ่มที่ควรขึ้นสำหรับสถานะนี้ เรียงตามลำดับที่ควรเห็น
 *
 * ตีกลับ/ปฏิเสธเป็นของ**ฝ่ายที่ถือใบอยู่ตอนนั้น** ไม่ใช่ใครก็ได้ — บัญชีตีกลับ
 * ใบที่หัวหน้ายังไม่แตะไม่ได้ (กติกาเดียวกับ `gateForStatus` ฝั่ง server)
 */
export function expenseActionsFor(status: string, actor: Actor): ExpenseAction[] {
  if (status === 'submitted') {
    return actor.isOps ? ['ops_approve', 'send_back', 'reject'] : [];
  }
  if (status === 'approved') {
    return actor.isFinance ? ['finance_approve', 'send_back', 'reject'] : [];
  }
  if (status === 'finance_approved') {
    return actor.isFinance ? ['pay', 'send_back', 'reject'] : [];
  }
  if (status === 'needs_info') {
    // ไรเดอร์ยังไม่มีปุ่มส่งใหม่ในแอป (งานถัดไป) — ถ้าไม่มีทางนี้ ใบที่ตีกลับ
    // จะค้างตายอยู่ตรงนี้ตลอดไป
    return actor.isOps ? ['resubmit', 'reject'] : [];
  }
  return [];
}
