import { MapPinOff, RefreshCw, ShieldAlert } from 'lucide-react';
import type { GeoBlock } from '../geo';

// จอที่ปิดทั้งแอปเมื่อใช้ตำแหน่งไม่ได้
//
// **ปิดทั้งแอป ไม่ใช่แค่ปิดปุ่มลงเวลา** — เป็นข้อกำหนดของงานนี้โดยตรง และมี
// เหตุผล: ทุกอย่างในแอปนี้ผูกกับ "คุณอยู่ที่ไหนตอนนี้" ถ้าปล่อยให้เข้าไปดู
// หน้าอื่นได้ คนจะเข้าใจว่าแอปใช้ได้แล้วแค่ปุ่มเสีย
export default function GpsGate({ block, onRetry }: { block: GeoBlock; onRetry: () => void }) {
  const Icon = block.code === 'denied' ? ShieldAlert : MapPinOff;
  return (
    <div className="gate">
      <div style={{ maxWidth: 380, width: '100%', margin: '0 auto' }}>
        <Icon size={38} strokeWidth={1.6} />
        <h2>{block.title}</h2>
        <p>{block.detail}</p>
        {block.canRetry ? (
          <button className="btn ghost" onClick={onRetry}>
            <RefreshCw size={16} /> ลองใหม่
          </button>
        ) : (
          // ปุ่มที่กดแล้วไม่มีทางสำเร็จ สอนให้คนกดวนไปเรื่อยๆ แล้วเลิกเชื่อ
          // ข้อความบนจอ — เคสนี้จึงบอกทางแก้เป็นข้อความอย่างเดียว
          <p style={{ fontSize: 12.5, opacity: 0.75 }}>
            แก้ตามขั้นตอนด้านบนแล้วปิดแอปเปิดใหม่อีกครั้ง
          </p>
        )}
      </div>
    </div>
  );
}
