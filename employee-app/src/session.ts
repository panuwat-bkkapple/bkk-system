// ใครได้เข้าแอปนี้ และหน้าจอไหนควรขึ้นตอนไหน — ล้วน มีเทส
//
// ─── ทำไมด่านนี้ต้องมี และทำไมต้องมาก่อนประตู GPS ─────────────────────────
// **บัญชี Firebase Auth ของโปรเจกต์นี้เป็นกองเดียวกันทั้งระบบ** — พนักงาน
// ไรเดอร์ ดีลเลอร์ **และลูกค้า** (เว็บลูกค้ามี `createUserWithEmailAndPassword`
// ที่ `bkk-frontend-next/app/components/loginActions.ts`) ทุกคนจึงกรอกรหัสผ่าน
// ของตัวเองแล้วผ่านหน้าล็อกอินของแอปพนักงานได้จริง
//
// สิ่งที่กันข้อมูลอยู่คือด่านของ callable ทุกตัวฝั่ง server (`requireEmployeeCaller`)
// ซึ่งปิดสนิท — แต่ **หน้าล็อกอินไม่ได้กันใครเลย** และเวอร์ชันแรกปล่อยให้คนที่
// ผ่านล็อกอินเดินไปถึงประตู GPS ก่อน แปลว่า**เราไปขอพิกัดปัจจุบันจากลูกค้า**
// ที่บังเอิญใช้รหัสผ่านของตัวเอง ซึ่งเป็นข้อมูลที่เราไม่มีสิทธิ์ขอตั้งแต่แรก
//
// กฎที่ได้: **ตรวจตัวตนก่อนขออะไรจากเครื่องเขาเสมอ** และไฟล์นี้ทำให้ลำดับนั้น
// เป็น *ข้อมูลที่เทสอ่านได้* ไม่ใช่ลำดับ `if` ที่ซ่อนอยู่ใน JSX

import type { GeoBlock } from './geo';

export interface EmployeeMe {
  id: string;
  name: string | null;
  employee_code: string | null;
  position: string | null;
  department: string | null;
  photo_url: string | null;
  status: string | null;
  /** หัวหน้าที่จะได้รับใบลาของคนนี้ — `null` = ยังไม่ได้ตั้ง ซึ่งแปลว่าไม่มีใคร
   *  อนุมัติจากแอปได้ และฟอร์มขอลาต้องบอกตั้งแต่ก่อนกดส่ง */
  supervisor: { name: string | null; position: string | null } | null;
}

export type SessionState =
  | { kind: 'checking' }
  | { kind: 'employee'; me: EmployeeMe }
  /** server ตอบชัดว่าไม่ใช่พนักงาน — ต้องออกจากระบบ */
  | { kind: 'rejected'; message: string }
  /** ถามไม่สำเร็จด้วยเหตุอื่น (เน็ต/เซิร์ฟเวอร์) — ยังไม่รู้ว่าใช่หรือไม่ใช่ */
  | { kind: 'retry'; message: string };

/**
 * รหัสที่แปลว่า "ไม่ใช่พนักงานแน่นอน" — นอกจากนี้คือ "ยังไม่รู้"
 *
 * **เส้นแบ่งนี้สำคัญกว่าที่เห็น** — ถ้าถือว่าทุก error คือการปฏิเสธ พนักงานที่
 * เน็ตหลุดตอนยืนอยู่หน้าร้านจะถูกเตะออกจากระบบแล้วต้องล็อกอินใหม่ทุกครั้งที่
 * สัญญาณกระตุก ซึ่งเกิดบ่อยกว่าการที่คนแปลกหน้าล็อกอินเข้ามามาก
 */
const REJECT_CODES = ['permission-denied', 'unauthenticated'];

const DEFAULT_REJECT = 'บัญชีนี้ไม่ใช่บัญชีพนักงาน';
const DEFAULT_RETRY = 'เชื่อมต่อระบบไม่ได้ ลองใหม่อีกครั้ง';

/** ตัดคำนำหน้า `functions/` ที่ SDK ติดมากับรหัส */
const bareCode = (raw: unknown): string =>
  String(raw == null ? '' : raw).trim().replace(/^functions\//, '');

/**
 * ผลของการ *ถามแล้วไม่ผ่าน* — แคบกว่า `SessionState` โดยตั้งใจ
 *
 * `sessionVerdict` ไม่มีทางคืน `checking` หรือ `employee` ได้เลย การประกาศ
 * ให้แคบทำให้ผู้เรียกอ่าน `.message` ได้โดยไม่ต้องเช็คซ้ำ (และเป็นสิ่งที่
 * compiler บอกเราตอนเขียนเทส)
 */
export type SessionFailure = Extract<SessionState, { kind: 'rejected' | 'retry' }>;

/** error จากการถามตัวตน แปลว่าอะไร */
export function sessionVerdict(err: unknown): SessionFailure {
  const e = (err || {}) as { code?: unknown; message?: unknown };
  const code = bareCode(e.code);
  const message = String(e.message == null ? '' : e.message).trim();
  if (REJECT_CODES.includes(code)) {
    return { kind: 'rejected', message: message || DEFAULT_REJECT };
  }
  return { kind: 'retry', message: message || DEFAULT_RETRY };
}

export interface GateInput {
  /** Firebase บอกแล้วหรือยังว่ามีใครล็อกอินอยู่ */
  authReady: boolean;
  signedIn: boolean;
  /** `null` = ยังไม่ได้เริ่มถามตัวตน */
  session: SessionState | null;
  geoBlock: GeoBlock | null;
  /** ข้อความค้างไว้บนหน้าล็อกอิน (เช่น เพิ่งถูกเตะออกเพราะไม่ใช่พนักงาน) */
  loginNotice?: string | null;
}

export type Gate =
  | { screen: 'loading' }
  | { screen: 'login'; notice: string | null }
  /** ถามตัวตนไม่สำเร็จชั่วคราว — **ห้ามเตะออกจากระบบ** */
  | { screen: 'session_error'; message: string }
  | { screen: 'geo'; block: GeoBlock }
  | { screen: 'app' };

/**
 * หน้าจอไหนควรขึ้นตอนนี้
 *
 * **ลำดับคือสาระของฟังก์ชันนี้ ไม่ใช่ผลข้างเคียง** — ตัวตนมาก่อนตำแหน่งเสมอ
 * (ดูหัวไฟล์) และ "ถามไม่สำเร็จ" ต้องไม่ถูกปฏิบัติเหมือน "ถูกปฏิเสธ"
 */
export function appGate(input: GateInput): Gate {
  const i = input || ({} as GateInput);
  const notice = i.loginNotice || null;

  if (!i.authReady) return { screen: 'loading' };
  if (!i.signedIn) return { screen: 'login', notice };

  // ยังไม่รู้ว่าเป็นใคร = ยังไม่ถามอะไรจากเครื่องเขา
  if (!i.session || i.session.kind === 'checking') return { screen: 'loading' };

  // **มาก่อนประตู GPS โดยตั้งใจ** — คนที่ไม่ใช่พนักงานต้องไม่เคยถูกขอพิกัด
  if (i.session.kind === 'rejected') {
    return { screen: 'login', notice: i.session.message };
  }
  if (i.session.kind === 'retry') {
    return { screen: 'session_error', message: i.session.message };
  }

  if (i.geoBlock) return { screen: 'geo', block: i.geoBlock };
  return { screen: 'app' };
}
