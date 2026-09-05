import { LogOut } from 'lucide-react';
import Avatar from './Avatar';

/** หัวแอป — แยกไฟล์เพื่อให้ **เรนเดอร์เดี่ยวๆ ได้** ตอนวัดสีจริงในเบราว์เซอร์
 *
 * เดิมมาร์กอัปนี้ฝังอยู่กลาง `App.tsx` ซึ่ง import Firebase จึง SSR ไม่ได้ และ
 * บั๊ก "ตัวหนังสือขาวบนพื้นขาว" (5 ก.ย. 2569) จึงไม่มีด่านไหนมองเห็นเลย
 * (บทเรียนเดียวกับ `B2B_ACTION_EVENT`: ถ้า injection จับไม่ได้เพราะโค้ดอยู่ใน
 * ที่ที่เทสเข้าไม่ถึง คำตอบคือย้ายโค้ด ไม่ใช่ยอมรับว่าจับไม่ได้)
 */
export default function AppHeader({ name, sub, photoUrl, onLogout }: {
  name: string; sub: string; photoUrl?: string | null; onLogout?: () => void;
}) {
  return (
    <div className="head">
      {/* `bar` ไม่ใช่ `row` โดยตั้งใจ — `.row` เป็นการ์ดในลิสต์ (พื้นขาว มีขอบ)
          เคยใช้ชื่อร่วมกันแล้วสไตล์การ์ดทาทับหัวแอป ตัวหนังสือขาวบนพื้นขาว
          ชื่อกับรหัสพนักงานจึงหายไปทั้งบรรทัดโดยไม่มีอะไรพัง */}
      <div className="bar">
        <div className="who">
          <Avatar name={name} photoUrl={photoUrl} />
          <div style={{ minWidth: 0 }}>
            <h1>{name}</h1>
            <div className="sub">{sub}</div>
          </div>
        </div>
        <button className="chip" onClick={onLogout}>
          <LogOut size={13} /> ออก
        </button>
      </div>
    </div>
  );
}
