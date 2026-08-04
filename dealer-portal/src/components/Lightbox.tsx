// Lightbox ดูรูปในแอป — แก้ปัญหาแตะรูปแล้วเด้งไปหน้า URL ของ Firebase Storage
// ใช้ร่วมกันทุกจุดที่มี thumbnail รูป (DeviceReport, Claims)
// แตะรูป → ขยายเต็มจอ, ลูกศร/ปุ่มเลื่อนซ้าย-ขวา, Esc หรือแตะพื้นหลังเพื่อปิด
import { useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface LightboxProps {
  photos: string[];
  index: number;            // รูปที่เปิดอยู่ (-1 หรือ null parent ไม่ render)
  onClose: () => void;
  onNavigate: (next: number) => void;
  caption?: string;
}

export const Lightbox = ({ photos, index, onClose, onNavigate, caption }: LightboxProps) => {
  const count = photos.length;
  const prev = useCallback(() => onNavigate((index - 1 + count) % count), [index, count, onNavigate]);
  const next = useCallback(() => onNavigate((index + 1) % count), [index, count, onNavigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && count > 1) prev();
      else if (e.key === 'ArrowRight' && count > 1) next();
    };
    window.addEventListener('keydown', onKey);
    // ล็อกสกรอลพื้นหลังระหว่างเปิด
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, prev, next, count]);

  if (index < 0 || index >= count) return null;

  const navBtn: React.CSSProperties = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none',
    borderRadius: '50%', width: 44, height: 44, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,14,24,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <button
        type="button" aria-label="ปิด"
        onClick={onClose}
        style={{
          position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.12)',
          color: '#fff', border: 'none', borderRadius: '50%', width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        <X size={20} />
      </button>

      {count > 1 && (
        <>
          <button type="button" aria-label="รูปก่อนหน้า" onClick={(e) => { e.stopPropagation(); prev(); }} style={{ ...navBtn, left: 10 }}>
            <ChevronLeft size={24} />
          </button>
          <button type="button" aria-label="รูปถัดไป" onClick={(e) => { e.stopPropagation(); next(); }} style={{ ...navBtn, right: 10 }}>
            <ChevronRight size={24} />
          </button>
        </>
      )}

      <figure
        onClick={(e) => e.stopPropagation()}
        style={{ margin: 0, maxWidth: 'min(1080px, 94vw)', maxHeight: '90vh', textAlign: 'center' }}
      >
        <img
          src={photos[index]}
          alt={caption ? `${caption} ${index + 1}` : `รูปที่ ${index + 1}`}
          style={{
            maxWidth: '100%', maxHeight: 'calc(90vh - 40px)', objectFit: 'contain',
            borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        />
        <figcaption style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 700, marginTop: 10 }}>
          {caption ? `${caption} · ` : ''}{index + 1} / {count}
        </figcaption>
      </figure>
    </div>
  );
};
