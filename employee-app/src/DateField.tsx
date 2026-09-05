/** ช่องวันที่ + ป้ายที่วางทับเมื่อยังว่าง — **ตัวเดียวของทั้งแอป**
 *
 * iOS Safari วาด `input[type=date]` ที่ไม่มีค่าเป็น **กล่องเปล่าสนิท** ไม่มี
 * ตัวอักษรใดๆ (เดสก์ท็อป Chrome ขึ้น mm/dd/yyyy ให้ ซึ่งเป็นเหตุผลที่มองไม่
 * เห็นตอนพัฒนา) คนใช้จึงอ่านว่าแอปพัง ไม่ใช่ว่ายังไม่ได้เลือก
 *
 * **แยกไฟล์เพราะรอบแรกแก้ที่หน้าขอลาหน้าเดียว แล้วหน้าเปลี่ยนกะยังเป็นกล่อง
 * เปล่าอยู่** — เจ้าของงานส่งภาพมาอีกรอบ (5 ก.ย. 2569) กฎ "กฎมีกี่คนอ่าน":
 * กฎเขียนถูกแล้ว แต่ติดตั้งไว้ไม่ครบทุกคนที่อ่านมัน. เทสสแกนทั้งโฟลเดอร์แล้ว
 * ว่า **ไฟล์นี้ไฟล์เดียวเท่านั้นที่มี `type="date"` ได้**
 */
export default function DateField({ id, value, onChange, required = true }: {
  id: string; value: string; onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div className={value ? 'datefield' : 'datefield empty'}>
      <input id={id} type="date" value={value} required={required}
        onChange={(e) => onChange(e.target.value)} />
      {!value && <span className="ph" aria-hidden="true">เลือกวันที่</span>}
    </div>
  );
}
