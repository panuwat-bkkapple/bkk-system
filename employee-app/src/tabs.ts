import { Home, CalendarDays, FolderClosed, User, Fingerprint, CalendarPlus, Repeat } from 'lucide-react';
import type { Screen, TabScreen } from './nav';

/** สี่แท่นของแถบล่าง ตามดีไซน์ต้นทาง (หน้าแรก · กะงาน · เอกสาร · ฉัน)
 *
 * ปุ่มกลมตรงกลางไม่อยู่ในลิสต์นี้ — มันไม่ใช่แท่น แต่เป็น**แผงทางลัด** ที่กาง
 * ขึ้นมาให้เลือกงานที่ทำบ่อย (ลงเวลา · ขอลา · สลับกะ)
 *
 * ต้นฉบับวางปุ่มนี้เป็นเครื่องหมายบวกลอยๆ ที่ไม่มีปลายทาง — เราให้มันมีปลายทาง
 * จริงสามอัน แทนที่จะวาดปุ่มที่กดแล้วไม่เกิดอะไร
 */
export const TABS: { id: TabScreen; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'หน้าแรก', icon: Home },
  { id: 'roster', label: 'กะงาน', icon: CalendarDays },
  { id: 'documents', label: 'เอกสาร', icon: FolderClosed },
  { id: 'profile', label: 'ฉัน', icon: User },
];

/** ทางลัดในแผงของปุ่มกลม — เป็นตารางข้อมูล ไม่ใช่ JSX ที่ผูก onClick ไว้ในตัว
 *  (บทเรียน P3-c: การผูกปุ่มกับปลายทางที่อยู่ใน onClick คือของที่เทสมองไม่เห็น)
 *
 *  อยู่ไฟล์นี้เพราะ eslint (`react-refresh/only-export-components`) ห้ามไฟล์
 *  คอมโพเนนต์ export ค่าที่ไม่ใช่คอมโพเนนต์ — ผลพลอยได้คือเทสอ่านตารางได้ตรงๆ
 */
export const QUICK_ACTIONS: { id: Screen; label: string; icon: typeof Home }[] = [
  { id: 'checkin', label: 'ลงเวลาเข้า-ออกงาน', icon: Fingerprint },
  { id: 'leave', label: 'ยื่นใบลา', icon: CalendarPlus },
  { id: 'swap', label: 'สลับกะกับเพื่อน', icon: Repeat },
];
