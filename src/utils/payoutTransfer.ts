// ก้อนเขียนของ "ฝ่ายบัญชีโอนเงินให้ลูกค้าแล้ว" — ที่เดียวสำหรับสองจอ
//
// เดิมโค้ดก้อนนี้ถูกคัดลอกไว้สองที่: `pages/finance/components/TradeInPayouts.tsx`
// (เดสก์ท็อป) กับ `pages/mobile/MobileFinancePage.tsx` วัดแล้ว **เหมือนกัน 88%
// ตรงกันเป๊ะ 53 บรรทัด** ซึ่งเป็นรูปที่ CLAUDE.md เตือนไว้ตรงตัว: กฎที่มีสำเนา
// สองชุดคือกฎที่วันหนึ่งจะไม่ตรงกัน และตัวที่ต่างจะเป็นตัวที่ไม่มีใครเปิดดู
//
// ตัวนี้ pure โดยตั้งใจ (ไม่ import firebase, ไม่เรียก Date.now, ไม่อัปโหลดอะไร)
// คนเรียกเป็นคนอัปโหลดสลิป · push key ของ transaction · แล้วส่งค่ามาให้
//
// **ทำไมยังไม่ย้ายไป status engine ทั้งที่ทุกจออื่นย้ายไปแล้ว** — ก้อนนี้เขียน
// สถานะงาน **กับแถว ledger ใน `update()` ก้อนเดียวแบบ atomic** (คอมเมนต์เดิม
// เขียนไว้ว่า "ถ้า path ใด fail ทั้งหมดจะ rollback") การแยกสถานะไปเรียก
// `transitionJob` ซึ่งเป็น callable คนละตัวทำลายคุณสมบัตินั้น: เงินลง ledger
// แล้วสถานะไม่ขยับ หรือกลับกัน ซึ่งบนงานที่จ่ายเงินจริงคือความเสียหายที่แย่กว่า
// ปัญหาที่การย้ายมาแก้
//
// ทางที่ถูกคือยกทั้งก้อนขึ้น Cloud Function แล้วให้มันเรียก applyTransition กับ
// เขียน ledger ฝั่ง server — ซึ่งยังติดอีกข้อ: engine ไม่มี event สำหรับขา B2B
// (`payment_confirmed` ไป Waiting For Handover เท่านั้น ส่วน B2B วันนี้ไป
// `Payment Completed` ตรงๆ) การรวมโค้ดมาที่เดียวก่อนคือขั้นที่ทำให้วันนั้น
// เป็นการแก้ไฟล์เดียว ไม่ใช่สองไฟล์ที่ต้องจำให้ตรงกัน

export interface PayoutBankInfo {
  name: string;
  account: string;
  holder: string;
}

export interface BuildPayoutUpdatesInput {
  /** งานที่กำลังจ่าย — อ่าน id / type / model / cust_name / qc_logs */
  job: {
    id: string;
    type?: string;
    model?: string;
    cust_name?: string;
    qc_logs?: unknown[];
  };
  /** URL สลิปที่อัปโหลดเสร็จแล้ว (คนเรียกอัปโหลดเอง) */
  slipUrl: string;
  /** เวลาโอนจริงตามสลิป — รองรับ backdate, ledger เงินสดอิงค่านี้ */
  transferredAt: number;
  /** ข้อความวันเวลาที่จะไปโผล่ใน qc_logs (คนเรียก format เอง) */
  transferredAtLabel: string;
  /** เวลาที่บันทึกลงระบบ — `paid_at` ใช้ค่านี้ ไม่ใช่ transferredAt */
  now: number;
  bank: PayoutBankInfo;
  /** ชื่อคนกด ไปโผล่ใน qc_logs ที่แอดมินอ่านด้วยตา */
  byName: string;
  /** ยอดสุทธิที่โอนจริง — คิดสดจาก final_price โดยคนเรียก */
  netPayout: number;
  /** push key ของแถว DEBIT (คนเรียกสร้างจาก firebase) */
  debitKey: string;
  /** แถวรายได้ค่าบริการรับเครื่อง — null เมื่อไม่มีค่าส่งให้บันทึก */
  revenueTx: unknown | null;
  /** push key ของแถว CREDIT — ต้องมีเมื่อ revenueTx ไม่เป็น null */
  creditKey: string | null;
}

/**
 * ประกอบ multi-path update ก้อนเดียวของการจ่ายเงิน
 *
 * คืน object ที่พร้อมส่งเข้า `update(ref(db), updates)` ตรงๆ — job กับ
 * transactions ไปด้วยกันในครั้งเดียว ถ้า path ใด fail ทั้งหมด rollback
 */
export function buildPayoutUpdates(input: BuildPayoutUpdatesInput): Record<string, unknown> {
  const { job, slipUrl, transferredAt, transferredAtLabel, now, bank, byName, netPayout } = input;
  const isB2B = job.type === 'B2B Trade-in';

  // **สถานะเป็น legacy lowercase 'Waiting for Handover' โดยตั้งใจ ห้ามแก้เป็น
  // canonical ตรงนี้** — คนอ่านฝั่งแอดมินทั้งชุด (TradeInDashboard, Finance,
  // RiderSettlements, MobileTicketsPage, QCStation, DispatcherPage) match แบบ
  // ตรงตัว การเปลี่ยนที่นี่ที่เดียวจะทำให้งานหายจากหน้าจอพวกนั้นทั้งหมด
  // ฝั่งแอปไรเดอร์รองรับผ่าน legacy alias อยู่แล้ว
  const nextStatus = isB2B ? 'Payment Completed' : 'Waiting for Handover';
  const logAction = isB2B ? 'Payment Completed' : 'Paid';

  const newLog = {
    action: logAction,
    by: byName,
    timestamp: now,
    details: `ฝ่ายบัญชีโอนเงินสำเร็จ ยอดสุทธิ ฿${netPayout.toLocaleString()} เข้าบัญชี ${bank.name} (${bank.account}) เมื่อ ${transferredAtLabel}`,
    evidence_url: slipUrl,
  };

  const updates: Record<string, unknown> = {};

  updates[`jobs/${job.id}/status`] = nextStatus;
  updates[`jobs/${job.id}/paid_at`] = now;
  updates[`jobs/${job.id}/transferred_at`] = transferredAt;
  updates[`jobs/${job.id}/paid_by`] = byName;
  updates[`jobs/${job.id}/payment_slip`] = slipUrl;
  updates[`jobs/${job.id}/updated_at`] = now;
  updates[`jobs/${job.id}/bank_name`] = bank.name;
  updates[`jobs/${job.id}/bank_account`] = bank.account;
  updates[`jobs/${job.id}/bank_holder`] = bank.holder;
  updates[`jobs/${job.id}/qc_logs`] = [newLog, ...(job.qc_logs || [])];

  updates[`transactions/${input.debitKey}`] = {
    rider_id: 'SYSTEM',
    amount: netPayout,
    type: 'DEBIT',
    category: isB2B ? 'B2B_PURCHASE' : 'TRADE_IN_PAYOUT',
    description: `จ่ายเงินรับซื้อสุทธิ ${job.model} (${job.cust_name?.split('(')[0]})`,
    // ledger เงินสดอิงเวลาโอนจริง ไม่ใช่เวลาที่กดบันทึก
    timestamp: transferredAt,
    ref_job_id: job.id,
    slip_url: slipUrl,
  };

  if (input.revenueTx && input.creditKey) {
    updates[`transactions/${input.creditKey}`] = input.revenueTx;
  }

  return updates;
}
