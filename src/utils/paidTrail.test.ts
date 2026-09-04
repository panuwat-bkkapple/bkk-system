// paidTrail — fixture คือรูปที่แถวจริงมีหลัง writer จ่ายเงินย้ายไป engine (4 ก.ย. 2569)
// เทียบกับรูปเก่าที่ payoutTransfer.ts เคยเขียน — reader ต้องเห็น "จ่ายแล้ว" ทั้งสองรูป
//
// INJECTION (วัดจริง — เขียนหลังรัน):
//   ไม่อ่าน paid_at (ดู qc_logs อย่างเดียว)                  → แดง __
//   ตัด WAITING_FOR_HANDOVER ออกจาก PAID_TRAIL_ACTIONS         → แดง __
//   isJobAlreadyPaid กลับไปอ่าน qc_logs ตรง (qcStation.ts)     → แดง __
import { describe, it, expect } from 'vitest';
import { JOB_STATUS } from '../types/job-statuses';
import { paidTrailEntry, jobWasPaid, PAID_TRAIL_ACTIONS } from './paidTrail';
import { isJobAlreadyPaid, PAID_LOG_ACTIONS } from './qcStation';

const NOW = 1_700_000_999_000;

/** งาน Pickup ที่จ่ายผ่าน engine: paid_at + action = สถานะปลายทาง ไม่มี 'Paid' ในไทม์ไลน์ */
const enginePaidPickup = {
  receive_method: 'Pickup', status: JOB_STATUS.PENDING_QC, paid_at: NOW,
  qc_logs: [
    { action: JOB_STATUS.PENDING_QC, timestamp: NOW + 5000 },
    { action: JOB_STATUS.RIDER_RETURNING, timestamp: NOW + 3000 },
    { action: JOB_STATUS.WAITING_FOR_HANDOVER, timestamp: NOW, details: 'ฝ่ายบัญชีโอนเงินสำเร็จ' },
  ],
};
/** แถวเก่าจาก payoutTransfer.ts (ไคลเอนต์): action 'Paid' และ paid_at เขียนพร้อมกัน */
const legacyPaidPickup = { receive_method: 'Pickup', status: 'Pending QC', paid_at: NOW - 1, qc_logs: [{ action: 'Paid', timestamp: NOW - 1 }] };
/** แถวเก่ากว่านั้น: มีแต่ log ไม่มี paid_at */
const veryOldPaid = { qc_logs: [{ action: 'PAID', timestamp: 5 }] };
const veryOldB2B = { qc_logs: [{ action: 'Payment Completed', timestamp: 6 }] };
/** Mail-in ก่อนจ่าย ที่ Pending QC หลังช่างตรวจ */
const unpaidMailIn = { receive_method: 'Mail-in', status: JOB_STATUS.PENDING_QC, qc_logs: [{ action: 'QC COMPLETED', timestamp: 1 }, { action: JOB_STATUS.BEING_INSPECTED, timestamp: 0 }] };
/** ทางจ่ายตรงจาก Price Accepted (Store-in): ไทม์ไลน์มีแค่ Waiting For Handover */
const directPayStoreIn = { receive_method: 'Store-in', status: JOB_STATUS.WAITING_FOR_HANDOVER, paid_at: NOW, qc_logs: [{ action: JOB_STATUS.WAITING_FOR_HANDOVER, timestamp: NOW }] };

describe('paidTrailEntry / jobWasPaid', () => {
  it('งาน Pickup ที่จ่ายผ่าน engine ถือว่าจ่ายแล้ว แม้ไม่มี action "Paid" เลยในไทม์ไลน์', () => {
    expect(enginePaidPickup.qc_logs.some((l) => l.action === 'Paid')).toBe(false); // fixture ตรงตามที่ engine เขียน
    expect(jobWasPaid(enginePaidPickup)).toBe(true);
    expect(paidTrailEntry(enginePaidPickup)).toEqual({ at: NOW, source: 'paid_at' });
  });

  it('แถวเก่าทุกรูป (Paid / PAID / Payment Completed) ยังอ่านว่าจ่ายแล้ว', () => {
    expect(jobWasPaid(legacyPaidPickup)).toBe(true);
    expect(paidTrailEntry(veryOldPaid)).toEqual({ at: 5, source: 'qc_logs' });
    expect(paidTrailEntry(veryOldB2B)).toEqual({ at: 6, source: 'qc_logs' });
  });

  it('ไม่มี paid_at แต่ไทม์ไลน์มี Waiting For Handover (ทางที่ engine เขียน ก่อน trigger/ไม่มี paid_at) = จ่ายแล้ว', () => {
    const { paid_at: _drop, ...noPaidAt } = directPayStoreIn;
    void _drop;
    expect(jobWasPaid(noPaidAt)).toBe(true);
    expect(PAID_TRAIL_ACTIONS).toContain(JOB_STATUS.WAITING_FOR_HANDOVER);
  });

  it('Mail-in ก่อนจ่ายที่ Pending QC ไม่ใช่จ่ายแล้ว — ปุ่ม Payout ต้องยังขึ้น', () => {
    expect(jobWasPaid(unpaidMailIn)).toBe(false);
    expect(paidTrailEntry(unpaidMailIn)).toBeNull();
  });

  it('paid_at มาก่อน log เสมอ และ paid_at ที่ไม่ใช่ตัวเลขถูกข้ามไปดู log', () => {
    expect(paidTrailEntry({ paid_at: 10, qc_logs: [{ action: 'Paid', timestamp: 99 }] })).toEqual({ at: 10, source: 'paid_at' });
    expect(paidTrailEntry({ paid_at: 'x', qc_logs: [{ action: 'Paid', timestamp: 99 }] })).toEqual({ at: 99, source: 'qc_logs' });
    expect(paidTrailEntry({ paid_at: 0, qc_logs: [] })).toBeNull();
    expect(paidTrailEntry(null)).toBeNull();
  });

  it('extraActions ขยายเซ็ตต่อ reader โดยไม่แตะเซ็ตกลาง (qc_logs เป็น object push-keyed ได้)', () => {
    const closedByStock = { qc_logs: { a: { action: JOB_STATUS.IN_STOCK, timestamp: 7 } } };
    expect(jobWasPaid(closedByStock)).toBe(false);
    expect(paidTrailEntry(closedByStock, [JOB_STATUS.IN_STOCK])).toEqual({ at: 7, source: 'qc_logs' });
  });
});

describe('qcStation.isJobAlreadyPaid ผ่าน paidTrail', () => {
  it('งานที่จ่ายผ่าน engine ห้ามถูกส่งกลับ QC Review — ทั้ง Pickup และทางจ่ายตรง Store-in', () => {
    expect(isJobAlreadyPaid(enginePaidPickup)).toBe(true);
    expect(isJobAlreadyPaid(directPayStoreIn)).toBe(true);
    expect(isJobAlreadyPaid(legacyPaidPickup)).toBe(true);
  });

  it('ยังรับ action เฉพาะของสถานี (Payout Processing / Deal Closed) และไม่นับงานที่ยังไม่จ่าย', () => {
    expect(PAID_LOG_ACTIONS).toContain(JOB_STATUS.PAYOUT_PROCESSING);
    expect(isJobAlreadyPaid({ qc_logs: [{ action: 'Payout Processing', timestamp: 1 }] })).toBe(true);
    expect(isJobAlreadyPaid({ qc_logs: [{ action: 'Deal Closed (Negotiated)', timestamp: 1 }] })).toBe(true);
    expect(isJobAlreadyPaid(unpaidMailIn)).toBe(false);
  });
});
