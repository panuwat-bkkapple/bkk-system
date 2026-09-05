/** จอโลโก้ระหว่างรอ (ดีไซน์ 00)
 *
 * โครงลอกต้นฉบับครบ — พื้นเขียวเข้ม · กระเบื้องโลโก้ขาวมุมมน 26px พร้อมวงแหวน
 * หมุน · ชื่อแอป · คำโปรย · แถบความคืบหน้า · บรรทัดสถานะ
 *
 * **สองอย่างที่ต่างจากรูปโดยตั้งใจ:**
 * 1. ต้นฉบับเป็นแบรนด์ `getmobie` ซึ่งเป็นแบรนด์ฝั่งดีลเลอร์ ห้ามหลุดเข้าแอป
 *    พนักงาน — ใช้ BKK APPLE
 * 2. แถบความคืบหน้าในรูปหยุดนิ่งที่ 62% ซึ่งเป็นตัวเลขที่เราไม่รู้จริง
 *    (ไม่มีทางรู้ว่า `employeeMe` เหลืออีกกี่เปอร์เซ็นต์) จึงทำเป็นแถบวิ่ง
 *    บอก "กำลังทำงานอยู่" แทนการอ้างเปอร์เซ็นต์ปลอม
 *    และตัดบรรทัดเลขเวอร์ชันออก เพราะ package.json ยังเป็น 0.0.0 —
 *    พิมพ์ v2.4.0 ตามรูปคือเลขที่ไม่มีอยู่จริง
 */
export default function Splash({ note = 'กำลังเตรียมข้อมูลของคุณ…' }: { note?: string }) {
  return (
    <div className="splash">
      <div className="splash-mid">
        <div className="splash-mark"><div className="splash-ring" /></div>
        <div className="splash-word">BKK<span> APPLE</span></div>
        <div className="splash-tag">แอปพนักงาน · ลงเวลา ขอลา เปลี่ยนกะ</div>
      </div>
      <div className="splash-bar"><div /></div>
      <div className="splash-note">{note}</div>
    </div>
  );
}
