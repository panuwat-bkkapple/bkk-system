import Wordmark from '../Wordmark';
import { APP_NAME } from '../appName';

/** จอโลโก้ระหว่างรอ (ดีไซน์ 00)
 *
 * โครงลอกต้นฉบับครบ — พื้นเขียวเข้ม · กระเบื้องโลโก้ขาวมุมมน 26px พร้อมวงแหวน
 * หมุน · ชื่อแอป · คำโปรย · แถบความคืบหน้า · บรรทัดสถานะ
 *
 * **สิ่งเดียวที่ต่างจากรูปโดยตั้งใจ:** แถบความคืบหน้าในรูปหยุดนิ่งที่ 62%
 * ซึ่งเป็นตัวเลขที่เราไม่รู้จริง (ไม่มีทางรู้ว่า `employeeMe` เหลืออีกกี่
 * เปอร์เซ็นต์) จึงทำเป็นแถบวิ่งบอก "กำลังทำงานอยู่" แทนการอ้างเปอร์เซ็นต์ปลอม
 * และบรรทัดท้ายตัดเลขเวอร์ชันออก เพราะ package.json ยังเป็น 0.0.0 —
 * พิมพ์ v2.4.0 ตามรูปคือเลขที่ไม่มีอยู่จริง
 */
export default function Splash({ note = 'กำลังเตรียมข้อมูลของคุณ…' }: { note?: string }) {
  return (
    <div className="splash">
      <div className="splash-mid">
        <div className="splash-mark"><div className="splash-ring" /></div>
        <Wordmark className="splash-word" />
        <div className="splash-tag">แอปพนักงาน · ลงเวลา ขอลา เปลี่ยนกะ</div>
      </div>
      <div className="splash-bar"><div /></div>
      <div className="splash-note">{note}</div>
      <div className="splash-foot">{APP_NAME} for work</div>
    </div>
  );
}
