// jobListPhaseOf — fixtures are the REAL status strings from the two pages'
// former hand-written arrays (legacy spellings included), not the spec: the
// point of this suite is that unifying the lists loses none of the behavior
// the two pages already agreed on, and that the desktop drift cases now land
// in a tab instead of vanishing.
import { describe, it, expect } from 'vitest';
import { jobListPhaseOf } from './jobListPhase';
import { isRecededStatus, isTerminal } from '../types/job-statuses';

describe('jobListPhaseOf', () => {
  it('sales tab: fresh and pre-handoff statuses', () => {
    for (const s of ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'Awaiting Shipping']) {
      expect(jobListPhaseOf(s), s).toBe('sales');
    }
  });

  it('Active Lead (Instant Sell) is in-progress, not sales — both pages agreed', () => {
    expect(jobListPhaseOf('Active Lead')).toBe('active');
    expect(jobListPhaseOf('Active Leads')).toBe('active'); // legacy plural
  });

  it('active tab: rider statuses in BOTH spellings (the desktop drift)', () => {
    for (const s of [
      // legacy — the only spellings desktop knew
      'Assigned', 'Accepted', 'Heading to Customer', 'Arrived',
      // canonical — the ones that vanished from desktop tabs
      'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',
    ]) {
      expect(jobListPhaseOf(s), s).toBe('active');
    }
  });

  it('active tab: Mail-in/Store-in intermediates and inspection/payout work', () => {
    for (const s of [
      'Parcel In Transit', 'Parcel Received', 'Drop-off Received',
      'Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation',
      'Discrepancy Reported', 'Price Accepted',
      'Payout Processing', 'Waiting for Handover', 'Waiting For Handover',
      'Pending QC',
    ]) {
      expect(jobListPhaseOf(s), s).toBe('active');
    }
  });

  it('active tab: exceptions still need someone working them', () => {
    for (const s of ['Disputed', 'Refund Initiated', 'Investigating Carrier', 'Returning To Customer']) {
      expect(jobListPhaseOf(s), s).toBe('active');
    }
  });

  it('In-Transit overload splits by receive_method and both sides are active', () => {
    expect(jobListPhaseOf('In-Transit', 'Pickup')).toBe('active'); // Rider Returning
    expect(jobListPhaseOf('In-Transit', 'Mail-in')).toBe('active'); // Parcel In Transit
  });

  it('closed tab: paid, inventory, and every terminal/soft-closed status', () => {
    for (const s of [
      'Paid', 'PAID', 'Payment Completed',
      // Both casings: canonical from the enum AND the lowercase 'to' the
      // bkk-system writers actually emit (via the new LEGACY_ALIAS rows) —
      // the lowercase ones are what the DB really contains today.
      'Sent To QC Lab', 'Sent to QC Lab', 'In Stock',
      'Ready To Sell', 'Ready to Sell', 'Sold', 'Completed',
      'Cancelled', 'Closed (Lost)', 'Returned', 'Return Confirmed',
      'Drop-off Expired', 'Shipping Expired', 'Parcel Lost', 'Refund Completed',
    ]) {
      expect(jobListPhaseOf(s), s).toBe('closed');
    }
  });

  it('unknown statuses return null — job shows only under the All tab', () => {
    for (const s of ['New B2B Lead', 'PO Issued', 'Pre-Quote Sent', 'garbage', '', null, undefined]) {
      expect(jobListPhaseOf(s as string | null | undefined), String(s)).toBe(null);
    }
  });
});

describe("'Reserved' — สถานะที่เพิ่งเข้า enum ใน P3-f", () => {
  // **นี่คือการเปลี่ยนพฤติกรรม ไม่ใช่ของที่ได้มาฟรี** เดิม Reserved อยู่นอก enum
  // `normalizeStatus` จึงคืน null แล้วบรรทัด `if (!status) return null` จัดการ
  // ให้เอง — เครื่องที่ถูกล็อตขายส่งจองไว้จึงไม่อยู่ในแท็บไหนเลย โผล่เฉพาะ
  // "ทั้งหมด" ทั้งที่พี่น้องของมัน (In Stock / Sold) นั่งอยู่ในแท็บปิดงาน
  //
  // พอเข้า enum แล้วมันได้ PHASE.INVENTORY เหมือนกัน → ตกแท็บ "ปิดงาน" ด้วย
  // ซึ่งคือผลที่ถูกต้อง: ธุรกรรมกับลูกค้าจบไปนานแล้ว เครื่องอยู่ในคลังเรา
  //
  // ตรึงไว้เพราะบทเรียน P3-a: ตอนสถานะ B2B เข้า enum มันไหลเข้าแท็บ "เปิดงาน"
  // ของ B2C โดยไม่มีใครตั้งใจ และสิ่งที่จับได้คือเทส ไม่ใช่คนอ่านโค้ด
  it('ตกแท็บปิดงานเหมือน In Stock / Sold ไม่ใช่ null เหมือนเดิม', () => {
    expect(jobListPhaseOf('Reserved')).toBe('closed');
    expect(jobListPhaseOf('In Stock')).toBe('closed');
    expect(jobListPhaseOf('Sold')).toBe('closed');
  });

  it('ไม่ใช่ terminal และไม่จาง — ปลดกลับมาขายได้', () => {
    // ล็อตที่ถูกยกเลิกคืนเครื่องกลับเป็นสถานะเดิม การทำให้มันจางในลิสต์จะบอก
    // ว่างานจบแล้วทั้งที่เครื่องยังหมุนอยู่
    expect(isTerminal('Reserved')).toBe(false);
    expect(isRecededStatus('Reserved')).toBe(false);
  });
});
