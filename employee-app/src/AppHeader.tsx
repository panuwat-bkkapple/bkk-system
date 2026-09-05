import { ChevronLeft, LogOut } from 'lucide-react';
import Avatar from './Avatar';
import Wordmark from './Wordmark';

/** หัวแอป — แยกไฟล์เพื่อให้ **เรนเดอร์เดี่ยวๆ ได้** ตอนวัดสีจริงในเบราว์เซอร์
 *
 * เดิมมาร์กอัปนี้ฝังอยู่กลาง `App.tsx` ซึ่ง import Firebase จึง SSR ไม่ได้ และ
 * บั๊ก "ตัวหนังสือขาวบนพื้นขาว" (5 ก.ย. 2569) จึงไม่มีด่านไหนมองเห็นเลย
 * (บทเรียนเดียวกับ `B2B_ACTION_EVENT`: ถ้า injection จับไม่ได้เพราะโค้ดอยู่ใน
 * ที่ที่เทสเข้าไม่ถึง คำตอบคือย้ายโค้ด ไม่ใช่ยอมรับว่าจับไม่ได้)
 *
 * **สองโหมดในไฟล์เดียว ไม่ใช่สองคอมโพเนนต์** — ดีไซน์ต้นทางมีหัวสองแบบ (หน้าแท่น
 * เป็นโลโก้ · หน้าลูกเป็นปุ่มย้อนกลับ + ชื่อหน้า) การแยกเป็นสองไฟล์คือรูปเดิม
 * ที่ทำให้ช่องวันที่หลุดรอบสอง: แก้ที่หนึ่งอีกที่ยังพัง และด่านก็จะวัดแค่ใบเดียว
 */
export default function AppHeader({ name, sub, photoUrl, onLogout, title, onBack }: {
  name: string; sub: string; photoUrl?: string | null; onLogout?: () => void;
  /** มีชื่อหน้า = โหมดหน้าลูก (ปุ่มย้อนกลับ + ชื่อ) ไม่มี = โหมดแท่น (โลโก้ + ตัวตน) */
  title?: string | null;
  onBack?: () => void;
}) {
  return (
    <div className="head">
      {/* `bar` ไม่ใช่ `row` โดยตั้งใจ — `.row` เป็นการ์ดในลิสต์ (พื้นขาว มีขอบ)
          เคยใช้ชื่อร่วมกันแล้วสไตล์การ์ดทาทับหัวแอป ตัวหนังสือขาวบนพื้นขาว
          ชื่อกับรหัสพนักงานจึงหายไปทั้งบรรทัดโดยไม่มีอะไรพัง */}
      <div className="bar">
        {title ? (
          <>
            <button className="iconbtn" aria-label="ย้อนกลับ" onClick={onBack}>
              <ChevronLeft size={20} strokeWidth={2.2} />
            </button>
            <div style={{ minWidth: 0 }}>
              <h1>{title}</h1>
            </div>
          </>
        ) : (
          <>
            <div className="who">
              <Avatar name={name} photoUrl={photoUrl} />
              <div style={{ minWidth: 0 }}>
                <h1>{name}</h1>
                <div className="sub">{sub}</div>
              </div>
            </div>
            <Wordmark className="headmark" />
            <button className="chip" onClick={onLogout}>
              <LogOut size={13} /> ออก
            </button>
          </>
        )}
      </div>
    </div>
  );
}
