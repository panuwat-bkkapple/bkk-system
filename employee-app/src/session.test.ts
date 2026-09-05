// ใครได้เข้าแอป และลำดับของด่าน
//
// ─── บั๊กที่ทำให้ต้องมีไฟล์นี้ (5 ก.ย. 2569 เจ้าของงานสังเกตเอง) ────────────
// "คนที่มี UID เหมือนจะล็อกอินได้หมดเลย ทั้งที่ไม่ควรจะเป็นอย่างงั้น
//  แม้กระทั่งไรเดอร์เอง กลัวว่าลูกค้าก็จะล็อกอินเข้ามาได้เหมือนกัน"
//
// **ถูกทุกคำ** — Auth pool เดียวทั้งโปรเจกต์ และเว็บลูกค้ามี
// `createUserWithEmailAndPassword` จริง ข้อมูลไม่รั่วเพราะ callable ทุกตัวมีด่าน
// แต่เวอร์ชันแรกปล่อยให้คนที่ผ่านล็อกอินเดินไปถึง**ประตู GPS ก่อน** =
// ไปขอพิกัดปัจจุบันจากลูกค้า
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                                | ผล |
//   |----------------------------------------------------------|----|
//   | **ย้อนเป็นบั๊กเดิม: ขอ GPS ก่อนตรวจตัวตน**                 | แดง 4 |
//   | เน็ตหลุดถือว่าถูกปฏิเสธ (เตะพนักงานออกกลางกะ)              | แดง 2 |
//   | ถูกปฏิเสธแล้วยังปล่อยเข้าแอป                               | แดง 2 |
//   | ยังไม่รู้ว่าเป็นใครก็ปล่อยเข้าแอป                           | แดง 2 |

import { describe, it, expect } from 'vitest';
import { sessionVerdict, appGate, type GateInput, type SessionState, type EmployeeMe } from './session';
import type { GeoBlock } from './geo';

const BLOCK: GeoBlock = {
  code: 'denied', title: 'ต้องอนุญาต', detail: 'x', action: 'อนุญาต',
};
const ME: EmployeeMe = {
  id: 'e1', name: 'สมชาย', employee_code: 'EMP-1',
  position: null, department: null, photo_url: null, status: 'active',
  supervisor: null,
};
const employee: SessionState = { kind: 'employee', me: ME };

const gate = (over: Partial<GateInput> = {}) => appGate({
  authReady: true, signedIn: true, session: employee, geoBlock: null, ...over,
});

describe('error จากการถามตัวตน แปลว่าอะไร', () => {
  it('permission-denied = ไม่ใช่พนักงานแน่นอน', () => {
    const v = sessionVerdict({ code: 'functions/permission-denied', message: 'บัญชีนี้ยังไม่ได้ผูกกับแฟ้มพนักงาน' });
    expect(v.kind).toBe('rejected');
    // ข้อความของ server ต้องถึงผู้ใช้ — "ยังไม่ได้ผูก" กับ "พ้นสภาพ" คนละเรื่อง
    expect(v.message).toContain('ยังไม่ได้ผูก');
  });

  it('unauthenticated = ไม่ใช่พนักงานแน่นอน', () => {
    expect(sessionVerdict({ code: 'functions/unauthenticated' }).kind).toBe('rejected');
  });

  it('เน็ตหลุด = "ยังไม่รู้" ไม่ใช่ "ถูกปฏิเสธ"', () => {
    // **เส้นแบ่งที่สำคัญที่สุดของไฟล์นี้** — ถือว่าทุก error คือการปฏิเสธ แปลว่า
    // พนักงานที่สัญญาณกระตุกหน้าร้านจะถูกเตะออกจากระบบ ซึ่งเกิดบ่อยกว่าคนแปลก
    // หน้าล็อกอินเข้ามามาก
    expect(sessionVerdict({ code: 'functions/unavailable' }).kind).toBe('retry');
    expect(sessionVerdict({ code: 'functions/internal' }).kind).toBe('retry');
    expect(sessionVerdict({ code: 'functions/deadline-exceeded' }).kind).toBe('retry');
  });

  it('error ที่ไม่มีรหัสเลย = ยังไม่รู้', () => {
    expect(sessionVerdict(new Error('boom')).kind).toBe('retry');
    expect(sessionVerdict(null).kind).toBe('retry');
    expect(sessionVerdict(undefined).kind).toBe('retry');
  });

  it('ทุกเส้นทางมีข้อความให้แสดง', () => {
    expect(sessionVerdict({ code: 'functions/permission-denied' }).message).toBeTruthy();
    expect(sessionVerdict({}).message).toBeTruthy();
  });
});

describe('ลำดับด่าน — ตัวตนมาก่อนตำแหน่งเสมอ', () => {
  it('ยังไม่รู้ว่าใครล็อกอิน = รอ', () => {
    expect(gate({ authReady: false }).screen).toBe('loading');
  });

  it('ยังไม่ล็อกอิน = หน้าล็อกอิน', () => {
    expect(gate({ signedIn: false }).screen).toBe('login');
  });

  it('ล็อกอินแล้วแต่ยังไม่รู้ว่าเป็นใคร = รอ **ไม่ใช่ขอ GPS**', () => {
    // ถ้าปล่อยให้ตกไปหน้า geo ตรงนี้ คนที่ยังไม่ผ่านการตรวจจะโดนขอพิกัดทันที
    expect(gate({ session: null, geoBlock: BLOCK }).screen).toBe('loading');
    expect(gate({ session: { kind: 'checking' }, geoBlock: BLOCK }).screen).toBe('loading');
  });

  it('**ไม่ใช่พนักงาน = กลับไปหน้าล็อกอินพร้อมเหตุผล ไม่ใช่ขอ GPS**', () => {
    // นี่คือบั๊กที่เจ้าของงานสังเกตเจอ ในรูปที่เทสอ่านได้
    const g = gate({
      session: { kind: 'rejected', message: 'บัญชีนี้ไม่ใช่บัญชีพนักงาน' },
      geoBlock: BLOCK,
    });
    expect(g.screen).toBe('login');
    expect(g.screen === 'login' && g.notice).toContain('ไม่ใช่บัญชีพนักงาน');
  });

  it('ถามตัวตนไม่สำเร็จ = จอลองใหม่ **ห้ามเตะออก และห้ามขอ GPS**', () => {
    const g = gate({ session: { kind: 'retry', message: 'เชื่อมต่อไม่ได้' }, geoBlock: BLOCK });
    expect(g.screen).toBe('session_error');
  });

  it('เป็นพนักงานแล้วค่อยถึงประตู GPS', () => {
    expect(gate({ geoBlock: BLOCK }).screen).toBe('geo');
  });

  it('เป็นพนักงาน + ตำแหน่งพร้อม = เข้าแอป', () => {
    expect(gate().screen).toBe('app');
  });

  it('ข้อความค้างบนหน้าล็อกอินยังอยู่หลังถูกเตะออก', () => {
    // signOut ทำให้ signedIn เป็น false — เหตุผลต้องไม่หายไปพร้อมกัน
    const g = gate({ signedIn: false, session: null, loginNotice: 'บัญชีนี้ไม่ใช่บัญชีพนักงาน' });
    expect(g.screen === 'login' && g.notice).toContain('ไม่ใช่บัญชีพนักงาน');
  });

  it('ราวกันตก: ไม่มีเส้นทางไหนที่คนไม่ใช่พนักงานไปถึงจอ GPS ได้', () => {
    const notEmployee: (SessionState | null)[] = [
      null,
      { kind: 'checking' },
      { kind: 'rejected', message: 'x' },
      { kind: 'retry', message: 'x' },
    ];
    for (const session of notEmployee) {
      for (const geoBlock of [null, BLOCK]) {
        expect(gate({ session, geoBlock }).screen).not.toBe('geo');
        expect(gate({ session, geoBlock }).screen).not.toBe('app');
      }
    }
  });
});
