/**
 * โครงการนำทางของแอป — **เป็นข้อมูล ไม่ใช่ลำดับ `if` ใน JSX**
 *
 * ดีไซน์ต้นทางเป็น hub-and-detail: หน้าแรกเป็นแท่นรวม แล้วกดเข้าไปหน้าลูกที่มี
 * ปุ่มย้อนกลับ ส่วนแถบล่างสลับ "แท่น" สี่อัน — ต่างจากรุ่นแรกของแอปนี้ที่เป็น
 * แท็บแบนล้วน
 *
 * เหตุผลที่แยกเป็นไฟล์ล้วน (บทเรียนเดิม `B2B_ACTION_EVENT` / `TabBar`): การผูก
 * "หน้าลูกนี้ย้อนกลับไปไหน" ถ้าอยู่ใน `onClick` เทสจะมองไม่เห็น แล้วปุ่มย้อนกลับ
 * ที่พาไปผิดที่จะไม่มีอะไรจับได้
 */

/** แท่นสี่อันของแถบล่าง — ปุ่มกลมไม่ใช่แท่น มันเปิดแผงทางลัด */
export const TAB_SCREENS = ['home', 'roster', 'documents', 'profile'] as const;
export type TabScreen = (typeof TAB_SCREENS)[number];

/** หน้าลูกที่เปิดจากแท่น — ทุกอันต้องประกาศว่าย้อนกลับไปแท่นไหน */
export const SUB_SCREENS = ['checkin', 'leave', 'swap', 'shift', 'payslip', 'inbox', 'history'] as const;
export type SubScreen = (typeof SUB_SCREENS)[number];

export type Screen = TabScreen | SubScreen;

/**
 * หน้าลูก -> แท่นที่มันสังกัด
 *
 * **ปุ่มย้อนกลับพาไปที่แท่นที่เป็นเจ้าของหน้านั้น ไม่ใช่ประวัติการกด** — คนที่
 * เข้าหน้าขอลาจากแผงทางลัดกับคนที่เข้าจากหน้าแรก ต้องออกไปที่เดียวกัน ไม่งั้น
 * ปุ่มเดียวกันพาไปคนละที่ตามทางที่เข้ามา ซึ่งอธิบายให้ผู้ใช้ฟังไม่ได้
 */
export const SUB_PARENT: Record<SubScreen, TabScreen> = {
  checkin: 'home',
  leave: 'home',
  swap: 'roster',
  shift: 'roster',
  payslip: 'documents',
  inbox: 'home',
  history: 'roster',
};

/** ชื่อที่ขึ้นบนหัวของหน้าลูก — หน้าแท่นใช้หัวแบบโลโก้ จึงไม่มีชื่อในตารางนี้ */
export const SUB_TITLE: Record<SubScreen, string> = {
  checkin: 'ลงเวลาเข้างาน',
  leave: 'ยื่นใบลา',
  swap: 'สลับกะกับเพื่อนร่วมงาน',
  shift: 'ขอเปลี่ยนกะ',
  payslip: 'สลิปเงินเดือน',
  inbox: 'คำขอที่รออนุมัติ',
  history: 'ประวัติการลงเวลา',
};

export const isTabScreen = (s: Screen): s is TabScreen =>
  (TAB_SCREENS as readonly string[]).includes(s);

/** ปุ่มย้อนกลับของหน้านี้ไปไหน — `null` = หน้าแท่น ไม่มีปุ่มย้อนกลับ */
export function backTarget(s: Screen): TabScreen | null {
  return isTabScreen(s) ? null : SUB_PARENT[s];
}

export function titleOf(s: Screen): string | null {
  return isTabScreen(s) ? null : SUB_TITLE[s];
}
