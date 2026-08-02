// Onboarding 3 สไลด์ — โชว์ครั้งแรกหลัง login เท่านั้น (จำใน localStorage)
// โครงตามจอ Stitch onboarding.html: swipe carousel + dot indicator +
// ปุ่ม "เริ่มใช้งาน" โผล่สไลด์สุดท้าย + ข้ามได้ทุกเมื่อ
import { useCallback, useRef, useState } from 'react';
import { Boxes, Lock, Gavel, Wallet, RefreshCw, Truck, Star } from 'lucide-react';

const ONBOARD_KEY = 'gm_dealer_onboarded_v1';

export const shouldShowOnboarding = (): boolean => {
  try {
    return localStorage.getItem(ONBOARD_KEY) !== '1';
  } catch {
    return false;
  }
};

export const Onboarding = ({ onDone }: { onDone: () => void }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch {
      /* private mode — โชว์ใหม่ครั้งหน้าไม่เป็นไร */
    }
    onDone();
  }, [onDone]);

  const handleScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setSlide(Math.round(el.scrollLeft / el.offsetWidth));
  };

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: el.offsetWidth * i, behavior: 'smooth' });
  };

  return (
    <div className="onb">
      <div className="onb-top">
        <button className="onb-skip" onClick={finish}>ข้าม</button>
      </div>
      <div className="onb-track" ref={trackRef} onScroll={handleScroll}>
        <div className="onb-slide">
          <div className="onb-visual">
            <div className="blur" />
            <div className="frame">
              <Boxes size={58} strokeWidth={1.5} style={{ color: 'var(--brand-deep)' }} />
              <span className="onb-tier"><Star size={13} fill="currentColor" /> Gold Early Access</span>
            </div>
          </div>
          <h2>ดูล็อตสินค้าตามระดับของคุณ</h2>
          <p>เข้าถึงล็อตสินค้าขายส่งที่ผ่าน QC แล้วก่อนใคร ตามระดับดีลเลอร์ของคุณ</p>
        </div>
        <div className="onb-slide">
          <div className="onb-visual">
            <div className="blur" />
            <div className="frame">
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <span style={{ width: 58, height: 58, borderRadius: '50%', background: '#fff', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Lock size={26} style={{ color: 'var(--accent)' }} />
                </span>
                <span style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--brand-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Gavel size={26} style={{ color: '#fff' }} />
                </span>
              </div>
              <div style={{ width: '70%', height: 7, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
                <div style={{ width: '55%', height: '100%', borderRadius: 999, background: 'var(--brand-deep)' }} />
              </div>
            </div>
          </div>
          <h2>เสนอราคาแบบปิดซอง</h2>
          <p>ไม่มีใครเห็นราคาของคุณจนกว่าจะปิดรับและเปิดซอง แก้ไขราคาได้จนถึงเวลาปิดรับ</p>
        </div>
        <div className="onb-slide">
          <div className="onb-visual">
            <div className="blur" />
            <div className="frame">
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span style={{ width: 50, height: 50, borderRadius: '50%', background: 'var(--brand-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Wallet size={22} style={{ color: '#fff' }} />
                </span>
                <span style={{ width: 50, height: 50, borderRadius: '50%', background: '#fff', border: '2px solid var(--brand-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RefreshCw size={22} style={{ color: 'var(--brand-deep)' }} />
                </span>
                <span style={{ width: 50, height: 50, borderRadius: '50%', background: '#fff', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Truck size={22} style={{ color: 'var(--muted)' }} />
                </span>
              </div>
            </div>
          </div>
          <h2>ชนะแล้วจ่าย-รับของ-จบ</h2>
          <p>ชนะประมูลรับใบเสนอราคาทันที แนบสลิปในระบบ และติดตามการจัดส่งจนถึงมือคุณ</p>
        </div>
      </div>
      <div className="onb-foot">
        <div className="onb-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={slide === i ? 'on' : ''} onClick={() => goTo(i)} style={{ cursor: 'pointer' }} />
          ))}
        </div>
        <button
          className="btn"
          style={{ opacity: slide === 2 ? 1 : 0, pointerEvents: slide === 2 ? 'auto' : 'none', transition: 'opacity 0.25s' }}
          onClick={finish}
        >
          เริ่มใช้งาน
        </button>
      </div>
    </div>
  );
};
