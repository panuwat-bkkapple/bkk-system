import {
  CalendarPlus, Repeat, Inbox as InboxIcon, CalendarDays,
} from 'lucide-react';

export type Tab = 'home' | 'leave' | 'shift' | 'inbox' | 'history';

/** สี่แท็บรอบข้าง — ตัวที่ห้า (`home` = ลงเวลา) เป็นปุ่มกลมตรงกลาง ไม่อยู่ในลิสต์นี้
 *
 * **ปุ่มกลางคือลงเวลา ไม่ใช่ปุ่ม "+" ที่ไม่มีปลายทาง** — ดีไซน์ต้นทางวางปุ่มกลม
 * ไว้เป็นตัวเด่นที่สุดของแถบ ซึ่งตรงกับความจริงของแอปนี้พอดี: การลงเวลาคือสิ่งที่
 * คนเปิดแอปมาทำ ส่วนอีกสี่อย่างเป็นงานเป็นครั้งคราว
 */
export const TABS: { id: Tab; label: string; icon: typeof CalendarPlus }[] = [
  { id: 'leave', label: 'ขอลา', icon: CalendarPlus },
  { id: 'shift', label: 'เปลี่ยนกะ', icon: Repeat },
  { id: 'inbox', label: 'อนุมัติ', icon: InboxIcon },
  { id: 'history', label: 'ประวัติ', icon: CalendarDays },
];
