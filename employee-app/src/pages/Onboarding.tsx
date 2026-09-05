import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { SLIDES, markOnboardingSeen } from '../onboarding';

/** หน้าแนะนำแอปครั้งแรก (ดีไซน์ 00b–00d)
 *
 * โครงลอกต้นฉบับครบ: ปุ่มข้าม · กรอบภาพประกอบลายทแยง · หัวข้อสองบรรทัด ·
 * คำอธิบาย · จุดบอกหน้า · ปุ่มหลักเต็มความกว้าง · ปุ่มย้อนกลับตั้งแต่หน้าที่สอง
 *
 * **ไม่ขอสิทธิ์อะไรจากเครื่องเลย** — หน้าสุดท้ายของต้นฉบับมีสวิตช์สิทธิ์สามตัว
 * (ตำแหน่ง/แจ้งเตือน/กล้อง) แต่แอปนี้ใช้แค่ตำแหน่ง และการขอสิทธิ์ต้องเกิด
 * **หลังยืนยันว่าเป็นพนักงาน** เท่านั้น (บั๊ก #726) สไลด์สุดท้ายจึงเป็นการ
 * *บอกล่วงหน้า* ว่าจะถูกขออะไร ไม่ใช่ตัวขอ
 */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  const finish = () => { markOnboardingSeen(); onDone(); };

  return (
    <div className="onb">
      <div className="onb-top">
        {i > 0
          ? <button className="onb-back" onClick={() => setI(i - 1)} aria-label="ย้อนกลับ">
              <ChevronLeft size={18} />
            </button>
          : <span />}
        <button className="onb-skip" onClick={finish}>ข้าม</button>
      </div>

      <div className={`onb-art ${slide.tint}`}>
        <span>{slide.art}</span>
      </div>

      <div className="onb-copy">
        <h2>{slide.title}</h2>
        <p>{slide.body}</p>
      </div>

      <div className="onb-foot">
        <div className="onb-dots">
          {SLIDES.map((s, n) => (
            <span key={s.key} className={n === i ? 'on' : ''} />
          ))}
        </div>
        <button className="btn" onClick={() => (last ? finish() : setI(i + 1))}>
          {last ? 'เริ่มใช้งาน' : 'ต่อไป'}
        </button>
      </div>
    </div>
  );
}
