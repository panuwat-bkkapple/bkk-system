// สิทธิ์จ่ายเงินออก (finance disbursement) — ตรรกะบริสุทธิ์ ไม่มี I/O
//
// ครอบเฉพาะ action ที่ทำให้ "เงินออกจากบริษัท" ตาม vertical slice ของ Phase 1
// (docs/reports/2026-08-31-permission-matrix-plan.md) ส่วนอื่นของระบบยังวิ่งบน
// admin boolean เดิม — ห้ามเอา helper นี้ไป gate อย่างอื่นโดยไม่ทบทวนแผนก่อน
//
// MIRROR: รายการ action + ชื่อ claim อยู่ที่ functions/finance-claims.js ด้วย
// (functions เป็น JS import TS ไม่ได้) — เพิ่ม action ต้องแก้ทั้งคู่

export const FINANCE_CLAIM_KEY = 'finance_disburse';

/** path ของสวิตช์เปิด enforcement — อยู่ใต้ settings จึงใช้ rule เดิม ไม่ต้อง deploy rules */
export const FINANCE_ENFORCE_PATH = 'settings/finance_gate/enforce';

export type FinanceAction =
  | 'payout_transfer'
  | 'job_mark_paid'
  | 'rider_withdrawal'
  | 'sales_void'
  | 'rider_expense_pay';

/** ข้อความบอกผู้ใช้ว่าปุ่มที่กดคืออะไร — ใช้ทั้งใน toast และ audit */
export const FINANCE_ACTION_LABEL: Record<FinanceAction, string> = {
  payout_transfer: 'ยืนยันโอนเงินค่าเครื่องให้ลูกค้า',
  job_mark_paid: 'ทำเครื่องหมายว่าจ่ายเงินแล้ว',
  rider_withdrawal: 'ยืนยันโอนเงินถอนของไรเดอร์',
  sales_void: 'ยกเลิกบิลขาย',
  rider_expense_pay: 'จ่ายคืนเงินสำรองจ่ายของไรเดอร์',
};

/**
 * action ที่ **server บังคับเองด้วย** ไม่ได้พึ่งหน้าจอ
 *
 * สี่ตัวแรกในตารางนี้ยังเป็นด่านฝั่งเบราว์เซอร์ล้วน — `finance_disburse` ถูก
 * อ่านฝั่ง server ที่ `functions/finance-claims.js` เพียงเพื่อ**บันทึกลง audit**
 * ว่า token ใบนั้นถือสิทธิ์อะไร ไม่เคยถูกใช้ปฏิเสธ callable ตัวไหนเลย
 * (`financeActorVerdict` เพิ่งเกิดมาพร้อมกับ `rider_expense_pay`)
 *
 * เขียนไว้ตรงๆ เพราะ "มีตารางสิทธิ์อยู่" อ่านแล้วเหมือนมีการบังคับ ทั้งที่
 * ของจริงยังไม่มี — การไล่ปิดสี่ตัวนั้นเป็นงานแยก ไม่ใช่ของที่ทำแถมกลางทาง
 */
export const SERVER_ENFORCED_FINANCE_ACTIONS: FinanceAction[] = ['rider_expense_pay'];

/**
 * "บัญชีนี้เป็นฝ่ายบัญชีไหม" — MIRROR ของ `financeActorVerdict`
 * (`functions/finance-claims.js`) ซึ่งเป็นตัวตัดสินจริง **แก้ต้องแก้ทั้งคู่**
 *
 * ห้ามใช้ `evaluateFinanceGate` แทนตัวนี้สำหรับขั้นของฝ่ายบัญชี — ฟังก์ชันนั้น
 * ปล่อย admin ทุกคนผ่านตราบใดที่ยังไม่เปิด `settings/finance_gate/enforce`
 * (dual-read ของ action เก่า) ซึ่งจะทำให้หน้าจอขึ้นปุ่มให้ STAFF แล้ว server
 * ปฏิเสธ = ปุ่มที่โกหกคนกด
 */
export function isFinanceActor(state: { role?: string | null; hasClaim: boolean }): boolean {
  const role = String(state.role || '').toUpperCase();
  return role === 'CEO' || state.hasClaim === true || role === 'FINANCE';
}

export type FinanceGateState = {
  /** role จาก staff session (CEO / MANAGER / STAFF / FINANCE) */
  role?: string | null;
  /** ID token มี custom claim finance_disburse หรือไม่ */
  hasClaim: boolean;
  /**
   * enforcement เปิดอยู่ไหม (settings/finance_gate/enforce === true)
   * ปิดอยู่ = ช่วง dual-read: admin เดิมทุกคนยังทำได้เหมือนเดิม แต่ทุกครั้งที่ทำ
   * จะถูกบันทึกลง audit ว่าผ่านมาด้วยสิทธิ์เก่า — ใช้ดูว่าใครจะโดนกระทบก่อนเปิดจริง
   */
  enforce: boolean;
};

export type FinanceGateVerdict = {
  allowed: boolean;
  /** เหตุผลแบบสั้น ใช้เป็นค่าใน audit — ไม่ใช่ข้อความสำหรับผู้ใช้ */
  reason: 'ceo' | 'claim' | 'legacy_admin' | 'no_claim';
  /** ข้อความไทยไว้ขึ้น toast เมื่อถูกปฏิเสธ */
  message?: string;
};

/**
 * ตัดสินว่าบัญชีนี้จ่ายเงินออกได้ไหม
 *
 * ลำดับความสำคัญ (ห้ามสลับ):
 *   1. CEO ผ่านเสมอ — hardcode ไม่ผูกกับ claim/ตาราง เพื่อไม่ให้เกิดสภาพ
 *      "CEO ตั้ง claim ให้ตัวเองยังไม่เสร็จแล้วจ่ายเงินไม่ได้"
 *   2. มี claim = ผ่าน (นี่คือทางที่ตั้งใจให้ FINANCE ใช้)
 *   3. ไม่มี claim + ยังไม่เปิด enforcement = ผ่านแบบ legacy (dual-read)
 *   4. ไม่มี claim + เปิด enforcement แล้ว = ปฏิเสธ
 */
export function evaluateFinanceGate(state: FinanceGateState): FinanceGateVerdict {
  const role = String(state.role || '').toUpperCase();
  if (role === 'CEO') return { allowed: true, reason: 'ceo' };
  if (state.hasClaim) return { allowed: true, reason: 'claim' };
  if (!state.enforce) return { allowed: true, reason: 'legacy_admin' };
  return {
    allowed: false,
    reason: 'no_claim',
    message: 'บัญชีนี้ไม่มีสิทธิ์จ่ายเงินออก — ให้ CEO เปิดสิทธิ์ให้ที่หน้าจัดการพนักงาน',
  };
}
