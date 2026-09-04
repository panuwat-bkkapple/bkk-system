// สำเนาสองชุดของตัวเทียบสถานะ — src/utils/statusCompare.ts (แอดมิน) กับ
// functions/status-match.js (Cloud Functions) — ต้องให้คำตอบเดียวกันทุกอินพุต
// ไม่งั้นหน้าจอบอกว่า "จ่ายแล้ว" ขณะที่ trigger บอกว่า "ยัง" หรือกลับกัน
//
// require ฝั่ง functions ได้เพราะ pure (ไม่แตะ firebase) — เทสพฤติกรรม ไม่ใช่เทส
// ตัวอักษร (รูปเดียวกับ riderPushHealth.test.ts)
//
// ผล injection — วัดจริงหลังรันทีละตัวบนไฟล์ JS:
//   canonicalStatus คืนค่าดิบไม่ normalize          → แดง 4
//   canonicalStatusOf ไม่ส่ง receive_method          → แดง 1 (In-Transit ของ Pickup)
//   queryStatusesFor ไม่กาง alias                     → แดง 1 (+ terminal-statuses.test.mjs แดง 1)
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { canonicalStatus, statusIs, statusIn, actionIs } from './statusCompare';
import { JOB_STATUS, JOB_STATUS_B2B, normalizeStatus } from '../types/job-statuses';

const require = createRequire(import.meta.url);
const fn = require('../../functions/status-match.js') as {
  canonicalStatus: (raw: unknown, rm?: string | null) => string | null;
  statusIs: (job: unknown, ...c: string[]) => boolean;
  statusIn: (job: unknown, set: Set<string> | string[]) => boolean;
  actionIs: (a: unknown, ...c: string[]) => boolean;
  queryStatusesFor: (c: string[]) => string[];
};

// ทุกรูปที่อยู่ใน DB จริง: canonical · สะกดเก่าทุกตัวใน LEGACY_ALIAS · overload ·
// ค่าที่ enum ไม่รู้จัก · ค่าว่าง
const RAW: Array<[unknown, string | null]> = [
  ['Sent To QC Lab', 'Pickup'], ['Sent to QC Lab', 'Pickup'], ['Ready To Sell', null], ['Ready to Sell', null],
  ['Waiting For Handover', null], ['Waiting for Handover', null], ['Paid', null], ['PAID', null],
  ['Payment Completed', null], ['Active Lead', null], ['Active Leads', null], ['Assigned', null],
  ['Accepted', null], ['Heading to Customer', null], ['Arrived', null], ['Returned', null],
  ['Return Confirmed', null], ['PRICE ACCEPTED', null],
  ['In-Transit', 'Pickup'], ['In-Transit', 'Mail-in'], ['In-Transit', null],
  ['Pending Finance Approval', null], ['Reserved', null], ['Withdrawal Completed', null],
  ['', null], [null, null], [undefined, null], [42, null],
];

const TARGETS = [
  JOB_STATUS.SENT_TO_QC_LAB, JOB_STATUS.READY_TO_SELL, JOB_STATUS.WAITING_FOR_HANDOVER, JOB_STATUS.PAID,
  JOB_STATUS.ACTIVE_LEAD, JOB_STATUS.RIDER_ASSIGNED, JOB_STATUS.RIDER_ACCEPTED, JOB_STATUS.RIDER_EN_ROUTE,
  JOB_STATUS.RIDER_ARRIVED, JOB_STATUS.RETURN_CONFIRMED, JOB_STATUS.PRICE_ACCEPTED, JOB_STATUS.RIDER_RETURNING,
  JOB_STATUS.PARCEL_IN_TRANSIT, JOB_STATUS_B2B.PENDING_FINANCE_APPROVAL, 'Reserved',
];

describe('statusCompare (TS) ↔ status-match (JS)', () => {
  it('canonicalStatus ตรงกันทุกอินพุต', () => {
    for (const [raw, rm] of RAW) {
      expect(fn.canonicalStatus(raw, rm), `${String(raw)} / ${rm}`).toBe(canonicalStatus(raw, rm));
    }
  });

  it('statusIs / statusIn ตรงกันทุกคู่ (อินพุต × เป้าหมาย)', () => {
    for (const [raw, rm] of RAW) {
      const job = { status: raw as string, receive_method: rm };
      for (const t of TARGETS) {
        expect(fn.statusIs(job, t), `${String(raw)}/${rm} is ${t}`).toBe(statusIs(job, t));
      }
      const set = new Set(TARGETS);
      expect(fn.statusIn(job, set)).toBe(statusIn(job, set));
    }
  });

  it('actionIs ตรงกัน — action ที่ไม่ใช่สถานะเทียบค่าดิบ', () => {
    for (const a of ['Paid', 'PAID', 'Payment Completed', 'Deal Closed (Negotiated)', 'QC PASSED', '', null]) {
      expect(fn.actionIs(a, JOB_STATUS.PAID, 'Deal Closed (Negotiated)')).toBe(actionIs(a, JOB_STATUS.PAID, 'Deal Closed (Negotiated)'));
    }
  });

  it('สะกดเก่า normalize ไปหา canonical ที่คาด — ยืนยันว่า fixture ไม่ได้เขียวเพราะทุกตัวเป็น null', () => {
    expect(fn.canonicalStatus('Waiting for Handover')).toBe(JOB_STATUS.WAITING_FOR_HANDOVER);
    expect(fn.canonicalStatus('In-Transit', 'Pickup')).toBe(JOB_STATUS.RIDER_RETURNING);
    expect(fn.canonicalStatus('In-Transit', 'Mail-in')).toBe(JOB_STATUS.PARCEL_IN_TRANSIT);
    expect(fn.canonicalStatus('Reserved')).toBe('Reserved');
  });

  it('queryStatusesFor กางทุกสะกดที่ normalize มาลงเซ็ต — ตรวจกับ normalizeStatus ของ TS', () => {
    const wanted = [JOB_STATUS.PAID, JOB_STATUS.RIDER_RETURNING];
    const q = fn.queryStatusesFor(wanted);
    for (const w of wanted) expect(q).toContain(w);
    expect(q).toContain('PAID');
    expect(q).toContain('Payment Completed');
    expect(q).toContain('In-Transit');
    // ทุกค่าใน list ต้อง normalize (ด้วยสักวิธีรับเครื่อง) มาลงเซ็ตที่ขอ — ไม่มีแถวแปลกปน
    for (const s of q) {
      const hit = ['Pickup', 'Mail-in', null].some((rm) => wanted.includes(normalizeStatus(s, rm) as never));
      expect(hit, s).toBe(true);
    }
  });
});
