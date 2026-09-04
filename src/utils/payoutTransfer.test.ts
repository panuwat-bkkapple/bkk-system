// เขียนจากพฤติกรรมที่สองจอทำอยู่จริงก่อนรวมสำเนา ไม่ใช่จาก spec
import { describe, it, expect } from 'vitest';
import { buildPayoutUpdates } from './payoutTransfer';

const base = {
  job: { id: 'J1', model: 'iPhone 15', cust_name: 'สมชาย (081)', qc_logs: [{ action: 'เก่า' }] },
  slipUrl: 'https://example/slip.jpg',
  transferredAt: 1_700_000_000_000,
  transferredAtLabel: '14 พ.ย. 2566',
  now: 1_700_000_999_000,
  bank: { name: 'กสิกร', account: '123-4-56789-0', holder: 'สมชาย' },
  byName: 'ฝ่ายบัญชี A',
  netPayout: 22_000,
  debitKey: 'TX_DEBIT',
  revenueTx: null,
  creditKey: null,
};

describe('buildPayoutUpdates', () => {
  it('B2C ไปสถานะ legacy lowercase — ห้ามเปลี่ยนเป็น canonical ตรงนี้', () => {
    // คนอ่านฝั่งแอดมินทั้งชุด match แบบตรงตัว การเปลี่ยนที่นี่ที่เดียวทำให้งาน
    // หายจาก TradeInDashboard / Finance / RiderSettlements / QCStation พร้อมกัน
    const u = buildPayoutUpdates(base);
    expect(u['jobs/J1/status']).toBe('Waiting for Handover');
  });

  it('B2B ไป Payment Completed และ ledger เป็นหมวด B2B', () => {
    const u = buildPayoutUpdates({ ...base, job: { ...base.job, type: 'B2B Trade-in' } });
    expect(u['jobs/J1/status']).toBe('Payment Completed');
    expect((u['transactions/TX_DEBIT'] as Record<string, unknown>).category).toBe('B2B_PURCHASE');
  });

  it('paid_at ใช้เวลาบันทึก ส่วน ledger ใช้เวลาโอนจริง — คนละค่า', () => {
    // รองรับ backdate: แอดมินกรอกเวลาโอนตามสลิปย้อนหลังได้ ledger เงินสดต้อง
    // อิงเวลานั้น ส่วน paid_at คือเวลาที่ระบบรับรู้ ถ้าสลับกันงบกระแสเงินสด
    // จะไปลงผิดวัน
    const u = buildPayoutUpdates(base);
    expect(u['jobs/J1/paid_at']).toBe(base.now);
    expect(u['jobs/J1/transferred_at']).toBe(base.transferredAt);
    expect((u['transactions/TX_DEBIT'] as Record<string, unknown>).timestamp).toBe(base.transferredAt);
  });

  it('qc_logs วางแถวใหม่ไว้บนสุดและไม่ทิ้งของเดิม', () => {
    const u = buildPayoutUpdates(base);
    const logs = u['jobs/J1/qc_logs'] as Array<Record<string, unknown>>;
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe('Paid');
    expect(logs[0].evidence_url).toBe(base.slipUrl);
    expect(logs[1].action).toBe('เก่า');
  });

  it('งานที่ไม่มี qc_logs เดิมไม่พัง', () => {
    const u = buildPayoutUpdates({ ...base, job: { id: 'J2', model: 'X', cust_name: 'ก' } });
    expect(u['jobs/J2/qc_logs']).toHaveLength(1);
  });

  it('ไม่มีค่าส่งให้บันทึก = ไม่มีแถว CREDIT', () => {
    const u = buildPayoutUpdates(base);
    expect(Object.keys(u).filter((k) => k.startsWith('transactions/'))).toEqual(['transactions/TX_DEBIT']);
  });

  it('มีค่าส่ง = มีแถว CREDIT เพิ่มในก้อนเดียวกัน ไม่ใช่ write ที่สอง', () => {
    const u = buildPayoutUpdates({
      ...base,
      revenueTx: { type: 'CREDIT', amount: 100 },
      creditKey: 'TX_CREDIT',
    });
    expect(u['transactions/TX_CREDIT']).toEqual({ type: 'CREDIT', amount: 100 });
    // job + ledger อยู่ใน object เดียว = update() ครั้งเดียว rollback ทั้งก้อน
    expect(Object.keys(u).some((k) => k.startsWith('jobs/'))).toBe(true);
  });

  it('มี revenueTx แต่ไม่มี key = ไม่เขียนแถวลอย', () => {
    // กันเคสที่คนเรียกลืม push key — เขียนลง `transactions/null` คือแถวขยะที่
    // การกระทบยอดจะเจอทีหลังโดยไม่รู้ว่ามาจากไหน
    const u = buildPayoutUpdates({ ...base, revenueTx: { type: 'CREDIT' }, creditKey: null });
    expect(Object.keys(u).filter((k) => k.startsWith('transactions/'))).toEqual(['transactions/TX_DEBIT']);
  });

  it('ยอดที่ลง ledger คือยอดสุทธิที่ส่งเข้ามา ไม่คำนวณเอง', () => {
    // การคิดยอดสุทธิเป็นของ getNetPayout ที่คิดสดจาก final_price — builder นี้
    // คำนวณเองเมื่อไหร่จะกลายเป็นสูตรที่สองที่ต้องจำให้ตรงกัน
    const u = buildPayoutUpdates({ ...base, netPayout: 19_500 });
    expect((u['transactions/TX_DEBIT'] as Record<string, unknown>).amount).toBe(19_500);
    expect(u['jobs/J1/qc_logs']).toBeDefined();
    expect(String((u['jobs/J1/qc_logs'] as Array<Record<string, unknown>>)[0].details)).toContain('19,500');
  });

  it('ข้อมูลบัญชีที่แอดมินแก้ถูกเขียนลงงานด้วย', () => {
    const u = buildPayoutUpdates(base);
    expect(u['jobs/J1/bank_name']).toBe('กสิกร');
    expect(u['jobs/J1/bank_account']).toBe('123-4-56789-0');
    expect(u['jobs/J1/bank_holder']).toBe('สมชาย');
  });
});
