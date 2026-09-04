// สองนิยามของสาย B2B ต้องอ่านออกทั้งคู่ — ไม่ใช่แค่มีจำนวนเท่ากัน
//
// `JobStatusB2B` (domain.ts) เป็น enum ที่ UI อ้างถึงมาตั้งแต่ก่อนมี engine
// `JOB_STATUS_B2B` (job-statuses.ts) เป็นตัวที่ engine อ่านผ่าน normalizeStatus
//
// **ถ้าสองที่ไม่ตรงกัน อาการคือปุ่ม B2B ยิง transitionJob แล้วโดน
// unreadable_status** ซึ่งไม่มี error ให้ใครเห็นนอกจากคนที่กดอยู่ — รูปเดียวกับ
// ที่ทั้งสาย B2B เคยเป็นก่อน PR นี้
//
// ด่านนี้ไม่ได้บังคับให้สองที่มีสมาชิกเท่ากัน เพราะไม่ควรเท่า: ตัวที่ทับกับ B2C
// (Following Up, Negotiation, In Stock, ...) อยู่ใน JOB_STATUS ร่วมกันอยู่แล้ว
// **สิ่งที่บังคับคือทุกค่าใน JobStatusB2B ต้องมีทางอ่านออก** ไม่ว่าจะมาจากเส้นไหน
import { describe, it, expect } from 'vitest';
import { JobStatusB2B } from './domain';
import { JOB_STATUS, JOB_STATUS_B2B, normalizeStatus, getPhase } from './job-statuses';

describe('B2B status parity', () => {
  it('ทุกค่าใน JobStatusB2B อ่านออกด้วย normalizeStatus', () => {
    for (const value of Object.values(JobStatusB2B)) {
      expect(normalizeStatus(value), `${value} อ่านไม่ออก — ปุ่มของสถานะนี้จะโดน unreadable_status`)
        .not.toBeNull();
    }
  });

  it('ทุกค่าใน JOB_STATUS_B2B มีอยู่ใน JobStatusB2B ด้วย — ไม่มีตัวที่งอกข้างเดียว', () => {
    const legacyEnum = new Set<string>(Object.values(JobStatusB2B));
    for (const value of Object.values(JOB_STATUS_B2B)) {
      expect(legacyEnum.has(value), `${value} มีที่ job-statuses.ts แต่ไม่มีใน domain.ts`).toBe(true);
    }
  });

  it('ตัวที่ทับกับ B2C ไม่ถูกซ้ำใน JOB_STATUS_B2B', () => {
    // ซ้ำเมื่อไหร่ = มีสองที่ให้แก้เวลากติกาเปลี่ยน และวันหนึ่งจะไม่ตรงกัน
    const b2c = new Set<string>(Object.values(JOB_STATUS));
    for (const value of Object.values(JOB_STATUS_B2B)) {
      expect(b2c.has(value), `${value} ซ้ำกับ JOB_STATUS — ให้ใช้ตัวใน JOB_STATUS`).toBe(false);
    }
  });

  it('ทุกสถานะ B2B มี phase — ไม่มีตัวไหนคืน undefined', () => {
    // getPhase อ่านจาก Record ที่ exhaustive อยู่แล้ว เทสนี้จับกรณีที่ Record
    // ถูกแก้เป็น Partial หรือมีคน cast ทับ ซึ่ง compiler จะไม่บ่นอีก
    for (const value of Object.values(JOB_STATUS_B2B)) {
      expect(getPhase(value), `${value} ไม่มี phase`).toBeDefined();
    }
  });

  it("'Payment Completed' ของ B2B ยังอ่านเป็น Paid เหมือนเดิม", () => {
    // มันอยู่ใน LEGACY_ALIAS มาก่อนแล้ว — การเพิ่มสาย B2B ต้องไม่ทำให้มัน
    // กลายเป็นสถานะของตัวเองที่แยกจาก Paid ไม่งั้นรายงานเงินจะนับสองถัง
    expect(normalizeStatus(JobStatusB2B.PAYMENT_COMPLETED)).toBe(JOB_STATUS.PAID);
  });
});
