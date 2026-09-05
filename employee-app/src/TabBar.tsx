import { Fingerprint } from 'lucide-react';
import { TABS, type Tab } from './tabs';

/** แถบเมนูล่าง — **แยกไฟล์เพื่อให้ SSR แล้ววัดสีจริงได้** เหมือน `AppHeader`
 *
 * ที่มา (5 ก.ย. 2569): ตอนเพิ่มปุ่มกลม กฎ `.tabs button[aria-current='true']`
 * ซึ่งเขียนไว้ให้แท็บเล็ก มี specificity สูงกว่า `.tabs .fab` จึงไปทับสี
 * ตัวอักษรของปุ่มกลม → ไอคอนสีแบรนด์บนพื้นแบรนด์เข้ม คอนทราสต์ **1.16:1**
 * `tsc`/eslint/เทสเขียวหมด และ**ชั้นเบราว์เซอร์ก็มองไม่เห็นเพราะมาร์กอัปนี้
 * อยู่ใน `App.tsx` ซึ่ง import Firebase จึง SSR ไม่ได้** — บทเรียนเดิมข้อเดิม:
 * ถ้าด่านจับไม่ได้เพราะโค้ดอยู่ในที่ที่เทสเข้าไม่ถึง คำตอบคือย้ายโค้ด
 */
export default function TabBar({ tab, onSelect }: {
  tab: Tab; onSelect: (t: Tab) => void;
}) {
  const btn = (t: (typeof TABS)[number]) => (
    <button key={t.id} aria-current={tab === t.id} onClick={() => onSelect(t.id)}>
      <t.icon size={19} strokeWidth={tab === t.id ? 2.3 : 1.8} />
      {t.label}
    </button>
  );
  return (
    // แท่นลอย (ดีไซน์ต้นทางเป็นแคปซูลขาวลอยเหนือพื้น ไม่ใช่แถบติดขอบจอ)
    // ช่องว่างตรงกลางเว้นไว้ให้ปุ่มลงเวลาซึ่งลอยทับขึ้นไป
    <nav className="tabs">
      <div className="dock">
        {TABS.slice(0, 2).map(btn)}
        <div className="fabgap" aria-hidden="true" />
        {TABS.slice(2).map(btn)}
      </div>
      {/* ในรูปมีแต่ไอคอนไม่มีป้ายกำกับ จึงต้องมี aria-label */}
      <button className="fab" aria-label="ลงเวลา" aria-current={tab === 'home'}
        onClick={() => onSelect('home')}>
        <Fingerprint size={24} strokeWidth={2} />
      </button>
    </nav>
  );
}
