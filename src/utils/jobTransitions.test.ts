// เทสของประตูฝั่งแอดมิน — เขียนจากสิ่งที่แอดมินจะเห็นบนจอเมื่อ engine ปฏิเสธ
// ไม่ใช่จากลิสต์รหัสใน CODE_TO_HTTPS. เทสที่เดินตามลิสต์จะเขียวแม้ข้อความจะ
// บอกแอดมินไม่ได้ว่าต้องทำอะไรต่อ ซึ่งเป็นเหตุผลเดียวที่ไฟล์นี้มีอยู่
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JOB_EVENT, engineErrorCode, transitionErrorMessage } from './jobTransitions';

const require = createRequire(import.meta.url);

describe('JOB_EVENT', () => {
  it('ทุกชื่อ event มีอยู่จริงในตาราง TRANSITIONS ของ engine', () => {
    // ด่านข้ามไฟล์: ชื่อที่พิมพ์ผิดจะไม่พังตอน build และไม่พังตอนเทส มันจะพัง
    // ตอนแอดมินกดปุ่มบน production แล้วได้ unknown_event
    const engine = readFileSync(resolve(__dirname, '../../functions/status-engine.js'), 'utf8');
    for (const event of Object.values(JOB_EVENT)) {
      expect(engine, event).toContain(`\n  ${event}: {`);
    }
  });

  it('ทุก event ชี้ไปที่ปลายทางที่ปุ่มสัญญาไว้ ไม่ใช่แค่มีชื่ออยู่ในตาราง', () => {
    // **ด่านนี้เพิ่มเพราะ injection เขียว**: สลับ BROADCAST_RECALLED ให้ชี้ไป
    // `rider_unassigned` แล้วเทสทั้งชุดผ่านหมด เพราะตัวที่มีอยู่เช็คแค่ว่า "ชื่อนี้
    // มีในตาราง engine ไหม" ซึ่ง rider_unassigned ก็มี
    //
    // ผลถ้าหลุดจริง: ปุ่ม "กลับไปติดตาม" จะพางานไป **Active Lead** (เข้าคิว
    // แย่งงานของไรเดอร์) แทน Following Up — สวนทางกับที่ปุ่มเขียนไว้ และดูเหมือน
    // ทำงานปกติ ไม่มี error ไม่มีใครรู้
    const engine = require(resolve(__dirname, '../../functions/status-engine.js'));
    const expected: Record<string, string> = {
      [JOB_EVENT.RIDER_ASSIGNED]: 'Rider Assigned',
      [JOB_EVENT.RIDER_UNASSIGNED]: 'Active Lead',
      [JOB_EVENT.INTAKE_QUEUED_FOR_QC]: 'Pending QC',
      [JOB_EVENT.DROPOFF_RECEIVED]: 'Drop-off Received',
      [JOB_EVENT.INSPECTION_STARTED]: 'Being Inspected',
      [JOB_EVENT.BROADCAST_TO_RIDERS]: 'Active Lead',
      [JOB_EVENT.RIDER_ARRIVED]: 'Rider Arrived',
      [JOB_EVENT.PAYOUT_STARTED]: 'Payout Processing',
      [JOB_EVENT.RIDER_RETURN_ARRIVED]: 'Pending QC',
      [JOB_EVENT.SENT_TO_LAB]: 'Sent To QC Lab',
      [JOB_EVENT.CASE_CLAIMED]: 'Following Up',
      [JOB_EVENT.APPOINTMENT_SET]: 'Appointment Set',
      [JOB_EVENT.PARCEL_RECEIVED]: 'Parcel Received',
      [JOB_EVENT.RIDER_DEPARTED]: 'Rider En Route',
      [JOB_EVENT.OFFER_REVISED]: 'Negotiation',
      [JOB_EVENT.INTAKE_QC_PASSED]: 'In Stock',
      [JOB_EVENT.SOLD]: 'Sold',
      [JOB_EVENT.BROADCAST_RECALLED]: 'Following Up',
      [JOB_EVENT.SALE_REVERTED_TO_QC]: 'Pending QC',
      [JOB_EVENT.PUSHED_TO_POS]: 'Ready To Sell',
      [JOB_EVENT.ADMIN_MARKED_PAID]: 'Paid',
      [JOB_EVENT.PROCESSING_STARTED]: 'Active Lead',
    };

    // ทุกตัวใน JOB_EVENT ต้องอยู่ในตารางนี้ — เพิ่ม event แล้วลืมปักปลายทาง
    // = กลับไปมีรูเดิม
    for (const event of Object.values(JOB_EVENT)) {
      expect(expected[event], `${event} ยังไม่ได้ปักปลายทางไว้ในเทสนี้`).toBeDefined();
      expect(engine.TRANSITIONS[event]?.to, event).toBe(expected[event]);
    }
  });

  it('ไม่มีสองชื่อใน JOB_EVENT ที่ชี้ไป event เดียวกัน', () => {
    // **ด่านนี้เพิ่มเพราะ injection เขียวอีกตัว**: เปลี่ยน PUSHED_TO_POS ให้ชี้
    // 'intake_qc_passed' แล้วเทสผ่านหมด เพราะการปักปลายทางคีย์ด้วย *ค่า* ของ
    // event ไม่ใช่ชื่อ — พอสองชื่อชี้ค่าเดียวกัน ค่านั้นถูกปักอยู่แล้ว การสลับ
    // จึงหลบอยู่ใต้รายการที่ถูกปักไว้
    //
    // ผลถ้าหลุดจริง: ปุ่ม "ส่งขึ้นหน้าร้าน (POS)" จะพาเครื่องไป In Stock แทน
    // Ready to Sell — เครื่องไม่ขึ้นหน้าร้าน และปุ่มก็ยังขึ้นอยู่ที่เดิม
    const values = Object.values(JOB_EVENT);
    expect(new Set(values).size, `ชื่อซ้ำค่า: ${values.join(', ')}`).toBe(values.length);
  });

  it('event ที่วิ่งสวนทางกันต้องไม่ชี้ไปที่เดียวกัน', () => {
    const engine = require(resolve(__dirname, '../../functions/status-engine.js'));
    // ถอนงานออกจากคิว vs ดึงงานจากไรเดอร์เข้าคิว
    expect(engine.TRANSITIONS[JOB_EVENT.BROADCAST_RECALLED].to)
      .not.toBe(engine.TRANSITIONS[JOB_EVENT.RIDER_UNASSIGNED].to);
  });

  it('assign กับ unassign ไม่ใช่ event เดียวกัน', () => {
    expect(JOB_EVENT.RIDER_ASSIGNED).not.toBe(JOB_EVENT.RIDER_UNASSIGNED);
  });

  it('unassign ไม่ใช่ rider_withdrew — ปลายทางกับ withdrawn_* ต่างกัน', () => {
    // ยุบสองอย่างนี้เมื่อไหร่ แอดมินที่สับเปลี่ยนคนเองจะโดนแบนเนอร์เตือนว่า
    // "ไรเดอร์ทิ้งงานใบนี้" และงานจะไปจบที่คิวที่ต้องโทรหาลูกค้าแทนคิวแย่งงาน
    expect(Object.values(JOB_EVENT)).not.toContain('rider_withdrew');
  });
});

describe('engineErrorCode', () => {
  it('อ่านรหัสจาก details ที่ callable ห่อมา', () => {
    expect(engineErrorCode({ code: 'functions/failed-precondition', details: { code: 'illegal_from' } }))
      .toBe('illegal_from');
  });

  it('ไม่หยิบรหัส gRPC มาใช้แทน', () => {
    // `error.code` เป็น "permission-denied" ซึ่งหยาบเกินกว่าจะแยก wrong_actor
    // ออกจาก not_job_owner ได้ — สองอันนี้ต้องขึ้นข้อความคนละแบบ
    expect(engineErrorCode({ code: 'functions/permission-denied' })).toBeNull();
  });

  it('error รูปอื่นคืน null ไม่ throw', () => {
    for (const e of [null, undefined, 'boom', new Error('boom'), { details: 'illegal_from' }, { details: {} }]) {
      expect(engineErrorCode(e)).toBeNull();
    }
  });
});

describe('transitionErrorMessage', () => {
  it('illegal_from บอกให้รีเฟรช ไม่ใช่บอกว่าผิดพลาด', () => {
    // เคสที่เจอบ่อยที่สุดและมีสาเหตุเดียวเสมอ: มีคนอื่นเปลี่ยนสถานะไปแล้ว
    // ระหว่างที่หน้านี้เปิดค้างอยู่ ข้อความต้องบอกทางออก ไม่ใช่บอกอาการ
    const msg = transitionErrorMessage('illegal_from');
    expect(msg).toContain('รีเฟรช');
  });

  it('รหัสที่ต่างกันได้ข้อความที่ต่างกัน', () => {
    // ถ้าทุกรหัสตกลง fallback เหมือนกันหมด แอดมินจะแยก "ไม่มีสิทธิ์" ออกจาก
    // "งานถูกแก้พร้อมกัน ลองใหม่ได้" ไม่ได้ ซึ่งเป็นคนละการกระทำต่อ
    const codes = [
      'illegal_from', 'wrong_actor', 'not_job_owner', 'job_not_found',
      'wrong_receive_method', 'already_paid', 'not_paid', 'missing_field',
      'patch_conflict', 'unknown_event', 'write_contended', 'unreadable_status',
    ];
    const seen = new Set(codes.map((c) => transitionErrorMessage(c)));
    expect(seen.size).toBe(codes.length);
  });

  it('ทุกรหัสที่ callable แปลงเป็น HttpsError ต้องมีข้อความของตัวเอง', () => {
    // ด่านข้ามไฟล์ตัวที่สอง: เพิ่มรหัสใน CODE_TO_HTTPS แล้วลืมที่นี่ = แอดมิน
    // ได้ข้อความกลางๆ "กรุณาลองใหม่" สำหรับสิ่งที่ลองใหม่แล้วก็ไม่ผ่าน
    const api = readFileSync(resolve(__dirname, '../../functions/status-transition-api.js'), 'utf8');
    const block = api.slice(api.indexOf('const CODE_TO_HTTPS'), api.indexOf('function httpsErrorFor'));
    const codes = [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    const fallback = transitionErrorMessage(null);
    for (const code of codes) {
      expect(transitionErrorMessage(code), code).not.toBe(fallback);
    }
  });

  it('รหัสที่ไม่รู้จักใช้ fallback ที่ caller ส่งมาได้', () => {
    expect(transitionErrorMessage('something_new', 'ข้อความเฉพาะหน้า')).toBe('ข้อความเฉพาะหน้า');
    expect(transitionErrorMessage(null)).toContain('เปลี่ยนสถานะไม่สำเร็จ');
  });
});
