// ด่านของตัวเทียบกลาง — ทุกสะกดเก่าใน LEGACY_ALIAS ต้องเทียบเท่ากับ canonical ของมัน
//
// injection ที่ต้องแดง: canonicalStatus คืนค่าดิบเสมอ (ตัด normalizeStatus) → ทุกเคส
// สะกดเก่าแดง, 'Reserved' ยังเขียว (มันไม่มี canonical อยู่แล้ว)
import { describe, it, expect } from 'vitest';
import { JOB_STATUS, JOB_STATUS_B2B } from '../types/job-statuses';
import { canonicalStatus, canonicalStatusOf, statusIs, statusIn, actionIs } from './statusCompare';

const LEGACY_TO_CANONICAL: Array<[string, string]> = [
   ['Sent to QC Lab', JOB_STATUS.SENT_TO_QC_LAB],
   ['Ready to Sell', JOB_STATUS.READY_TO_SELL],
   ['Waiting for Handover', JOB_STATUS.WAITING_FOR_HANDOVER],
   ['Payment Completed', JOB_STATUS.PAID],
   ['PAID', JOB_STATUS.PAID],
   ['Active Leads', JOB_STATUS.ACTIVE_LEAD],
   ['Assigned', JOB_STATUS.RIDER_ASSIGNED],
   ['Accepted', JOB_STATUS.RIDER_ACCEPTED],
   ['Heading to Customer', JOB_STATUS.RIDER_EN_ROUTE],
   ['Arrived', JOB_STATUS.RIDER_ARRIVED],
   ['Returned', JOB_STATUS.RETURN_CONFIRMED],
   ['PRICE ACCEPTED', JOB_STATUS.PRICE_ACCEPTED],
];

describe('statusCompare', () => {
   it('every legacy spelling compares equal to its canonical', () => {
      for (const [legacy, canonical] of LEGACY_TO_CANONICAL) {
         expect(canonicalStatus(legacy), legacy).toBe(canonical);
         expect(statusIs({ status: legacy }, canonical), legacy).toBe(true);
         expect(statusIs({ status: canonical }, canonical), canonical).toBe(true);
         expect(statusIn({ status: legacy }, new Set([canonical])), legacy).toBe(true);
      }
   });

   it('In-Transit splits by receive_method, Reserved and unknown fall back to raw', () => {
      expect(canonicalStatusOf({ status: 'In-Transit', receive_method: 'Pickup' })).toBe(JOB_STATUS.RIDER_RETURNING);
      expect(canonicalStatusOf({ status: 'In-Transit', receive_method: 'Mail-in' })).toBe(JOB_STATUS.PARCEL_IN_TRANSIT);
      expect(canonicalStatusOf({ status: 'Reserved' })).toBe('Reserved');
      expect(statusIs({ status: 'Reserved' }, 'Reserved')).toBe(true);
      expect(statusIs({ status: JOB_STATUS_B2B.PO_ISSUED }, JOB_STATUS_B2B.PO_ISSUED)).toBe(true);
      expect(canonicalStatusOf({ status: '' })).toBeNull();
      expect(canonicalStatusOf(null)).toBeNull();
      expect(statusIs(null, JOB_STATUS.PAID)).toBe(false);
   });

   it('actionIs reads qc_logs actions under both spellings and keeps non-status actions raw', () => {
      expect(actionIs('PAID', JOB_STATUS.PAID)).toBe(true);
      expect(actionIs('Payment Completed', JOB_STATUS.PAID)).toBe(true);
      expect(actionIs(JOB_STATUS.PAID, JOB_STATUS.PAID)).toBe(true);
      expect(actionIs('Deal Closed (Negotiated)', 'Deal Closed (Negotiated)')).toBe(true);
      expect(actionIs(undefined, JOB_STATUS.PAID)).toBe(false);
   });
});
