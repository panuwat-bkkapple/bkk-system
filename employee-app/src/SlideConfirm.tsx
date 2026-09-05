import { useCallback, useRef, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { reachedConfirm } from './slideConfirm';

/** แถบเลื่อนเพื่อยืนยัน (ดีไซน์ 02)
 *
 * **ยังเป็น `<button>` จริง ไม่ใช่ div ที่ฟัง pointer เฉยๆ** — คนที่ใช้
 * โปรแกรมอ่านหน้าจอหรือคีย์บอร์ดลาก pointer ไม่ได้ การกด Enter/Space จึงยืนยัน
 * ได้ตรงๆ. การลากเป็นด่านกันกดพลาดสำหรับนิ้ว ไม่ใช่ด่านความปลอดภัย — ตัวที่
 * ตัดสินจริงว่าลงเวลาได้ไหมอยู่ที่ server เสมอ
 */
export default function SlideConfirm({ label, tone = 'brand', disabled, busy, onConfirm }: {
  label: string;
  tone?: 'brand' | 'dark';
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const startX = useRef(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const maxX = () => {
    const track = trackRef.current;
    if (!track) return 0;
    // ราง − ปุ่ม − ขอบสองข้าง
    return Math.max(0, track.clientWidth - KNOB_W - PAD * 2);
  };

  const end = useCallback(() => {
    setDragging(false);
    const reached = reachedConfirm(dx, maxX());
    setDx(0);
    if (reached) onConfirm();
  }, [dx, onConfirm]);

  const locked = disabled || busy;

  return (
    <div className={`slide ${tone}${locked ? ' off' : ''}`} ref={trackRef}>
      <button
        type="button"
        className="knob"
        aria-label={label}
        disabled={locked}
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : 'transform .18s' }}
        onPointerDown={(e) => {
          if (locked) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          startX.current = e.clientX;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging || locked) return;
          setDx(Math.min(maxX(), Math.max(0, e.clientX - startX.current)));
        }}
        onPointerUp={end}
        onPointerCancel={() => { setDragging(false); setDx(0); }}
        // คีย์บอร์ด/โปรแกรมอ่านหน้าจอ: กดยืนยันได้ตรงๆ ไม่ต้องลาก
        onClick={() => { if (!locked && !dragging && dx === 0) onConfirm(); }}
      >
        {busy ? <Loader2 size={20} className="spin" /> : <ChevronRight size={22} />}
      </button>
      <div className="slidelabel" aria-hidden="true">{label}</div>
    </div>
  );
}

const KNOB_W = 96;
const PAD = 6;
