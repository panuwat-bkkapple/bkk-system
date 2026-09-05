import { MapPin, MapPinOff, RefreshCw, ShieldAlert } from 'lucide-react';
import type { GeoBlock } from '../geo';
import GateShell from '../GateShell';

// จอที่ปิดทั้งแอปเมื่อใช้ตำแหน่งไม่ได้
//
// **ปิดทั้งแอป ไม่ใช่แค่ปิดปุ่มลงเวลา** — เป็นข้อกำหนดของงานนี้โดยตรง และมี
// เหตุผล: ทุกอย่างในแอปนี้ผูกกับ "คุณอยู่ที่ไหนตอนนี้" ถ้าปล่อยให้เข้าไปดู
// หน้าอื่นได้ คนจะเข้าใจว่าแอปใช้ได้แล้วแค่ปุ่มเสีย
//
// **แต่จอที่ปิดทางต้องไม่ตัน** — เวอร์ชันแรกไม่มีปุ่มบนจอ `denied` เพราะคิดว่า
// ผู้ใช้ปฏิเสธไปแล้วจริง กดปุ่มก็ไม่ช่วย บน iOS นั่นผิด: `denied` เกิดได้ตั้งแต่
// ก่อนมีใครถูกถาม จอเลยตันสนิท (เจอบนเครื่องจริง 5 ก.ย. 2569)
export default function GpsGate({ block, onAct }: { block: GeoBlock; onAct: () => void }) {
  const Icon = block.code === 'denied' ? ShieldAlert
    : block.code === 'needs_gesture' ? MapPin : MapPinOff;
  const isAsk = block.code === 'needs_gesture' || block.code === 'denied';
  return (
    <GateShell
      icon={<Icon size={22} strokeWidth={2} />}
      title={block.title}
      detail={block.detail}
      /* รหัสเหตุผลไว้ให้บอกทางโทรศัพท์ได้ว่าติดตรงไหน — ไล่ปัญหาตำแหน่ง
         ด้วยคำบรรยายของผู้ใช้อย่างเดียวแทบเป็นไปไม่ได้ */
      foot={`รหัส: ${block.code}`}
    >
      {block.action ? (
        <button className={isAsk ? 'btn' : 'btn ghost'} onClick={onAct}>
          {isAsk ? <MapPin size={16} /> : <RefreshCw size={16} />} {block.action}
        </button>
      ) : (
        // เหลือไว้เฉพาะเคสที่กดแล้วไม่มีทางสำเร็จจริงๆ (ไม่รองรับ / http)
        <div className="note">แก้ตามขั้นตอนด้านบนแล้วปิดแอปเปิดใหม่อีกครั้ง</div>
      )}
    </GateShell>
  );
}
