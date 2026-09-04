// ด่านของสาย B2B (P1 ในรายงาน status-literal survey 4 ก.ย. 2569)
//
// ล็อตที่จ่ายเงินแล้วต้องล็อกภายใต้ทั้งสองสะกด — 'Paid' (engine, P3-a #690) และ
// 'Payment Completed' (แถวที่ payoutTransfer.ts เขียนไว้ก่อนย้ายขึ้น engine 4 ก.ย. 2569) + 'PAID'
//
// injection ที่ต้องแดง: canonicalStatusOf คืนค่าดิบเสมอ (ตัด normalize) → เคส 'Paid'
// กับ 'PAID' แดงทั้ง lock / logistics / isB2BPaid
import { describe, it, expect } from 'vitest';
import { JOB_STATUS, JOB_STATUS_B2B } from '../types/job-statuses';
import { isB2BLotLocked, isB2BPaid, isB2BSales, isB2BLogistics, isB2BClosed } from './b2bStatus';

const PAID_SPELLINGS = ['Payment Completed', JOB_STATUS.PAID, 'PAID'];

describe('B2B paid lot under every spelling', () => {
   it('is locked, is paid, and sits in the Logistics tab', () => {
      for (const status of PAID_SPELLINGS) {
         const job = { status, type: 'B2B Trade-in' };
         expect(isB2BLotLocked(job), status).toBe(true);
         expect(isB2BPaid(job), status).toBe(true);
         expect(isB2BLogistics(job), status).toBe(true);
         expect(isB2BSales(job), status).toBe(false);
         expect(isB2BClosed(job), status).toBe(false);
      }
   });

   it('lots still being graded are not locked; closed lots are locked and closed', () => {
      for (const status of [JOB_STATUS_B2B.SITE_VISIT_GRADING, JOB_STATUS_B2B.FINAL_QUOTE_SENT, JOB_STATUS_B2B.PO_ISSUED]) {
         expect(isB2BLotLocked({ status }), status).toBe(false);
      }
      expect(isB2BLotLocked({ status: JOB_STATUS_B2B.PENDING_FINANCE_APPROVAL })).toBe(true);
      for (const status of [JOB_STATUS.IN_STOCK, JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED, JOB_STATUS.CLOSED_LOST]) {
         expect(isB2BLotLocked({ status }), status).toBe(true);
         expect(isB2BClosed({ status }), status).toBe(true);
      }
   });

   it('tab predicates partition the B2B pipeline the way the old literal lists did', () => {
      expect(isB2BSales({ status: JOB_STATUS_B2B.NEW_B2B_LEAD })).toBe(true);
      expect(isB2BSales({ status: JOB_STATUS.NEGOTIATION })).toBe(true);
      expect(isB2BLogistics({ status: JOB_STATUS_B2B.WAITING_FOR_INVOICE })).toBe(true);
      expect(isB2BLogistics({ status: JOB_STATUS_B2B.PO_ISSUED })).toBe(true);
      // ไม่มีใครรับ: สถานะที่ไม่อยู่ในสามแท็บ (ตรงกับลิสต์เดิม ไม่ได้ขยาย)
      expect(isB2BSales({ status: JOB_STATUS_B2B.AUDITOR_ASSIGNED })).toBe(false);
      expect(isB2BLotLocked({ status: null })).toBe(false);
   });
});
