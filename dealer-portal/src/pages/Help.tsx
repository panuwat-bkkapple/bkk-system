// ศูนย์ช่วยเหลือ — โครงตามจอ Stitch help-support.html: hero + search,
// การ์ดช่องทางติดต่อ (ค่าจริงจาก settings/dealer/support — ว่าง = ซ่อน),
// FAQ accordion 6 ข้อ (เนื้อหาตรงกับระบบจริง), ลิงก์ไปเกณฑ์เกรด/คลังเอกสาร
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, MessageCircle, Phone, ChevronDown, ChevronRight, BadgeCheck, FolderOpen,
} from 'lucide-react';
import { getSupportInfo } from '../api';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'การเสนอราคาแบบปิดซองทำงานอย่างไร?',
    a: 'ราคาที่เสนอเป็นความลับ — ไม่มีใครเห็นราคาของคุณจนกว่าจะปิดรับและเปิดซองโดยผู้มีอำนาจ คุณแก้ไขราคาได้ไม่จำกัดครั้งจนถึงเวลาปิดรับ ระบบบันทึกทุกการแก้ไขไว้ตรวจสอบย้อนหลังได้',
  },
  {
    q: 'ระดับดีลเลอร์ Gold / Silver / Bronze ต่างกันอย่างไร?',
    a: 'ระดับที่สูงกว่าจะเห็นล็อตใหม่ก่อน (Early Access) ตามจำนวนนาทีที่กำหนด ระดับพิจารณาจากยอดสั่งซื้อ — ยอดต่อออเดอร์หรือยอดสะสมต่อเดือนถึงเกณฑ์ เจ้าหน้าที่จะปรับระดับให้',
  },
  {
    q: 'ชนะประมูลแล้วต้องทำอะไรต่อ?',
    a: 'ระบบสร้างคำสั่งซื้อพร้อมใบเสนอราคา PDF ให้ทันที (ดูได้ที่เมนูคำสั่งซื้อ และในอีเมล) โอนเงินตามบัญชีที่ระบุ แล้วแนบสลิปในหน้าคำสั่งซื้อ เจ้าหน้าที่จะตรวจสอบและยืนยันการชำระ',
  },
  {
    q: 'แนบสลิปโอนเงินอย่างไร?',
    a: 'เปิดคำสั่งซื้อที่ต้องชำระ → กดปุ่มแนบหลักฐานการโอน → เลือกรูปสลิปจากเครื่อง ระบบจะเปลี่ยนสถานะเป็น "กำลังตรวจสอบการชำระ" และแจ้งผลให้ทราบเมื่อยืนยันแล้ว',
  },
  {
    q: 'จะได้ใบกำกับภาษีเมื่อไหร่?',
    a: 'ใบกำกับภาษีเต็มรูปออกอัตโนมัติหลังเจ้าหน้าที่ยืนยันการชำระเงิน โดยใช้ข้อมูลนิติบุคคล (ชื่อบริษัท เลขผู้เสียภาษี ที่อยู่) ที่ลงทะเบียนไว้ ดาวน์โหลดได้ที่เมนูคลังเอกสาร',
  },
  {
    q: 'เกรดสภาพเครื่อง A/B/C/D ดูจากอะไร?',
    a: 'ทุกเครื่องผ่านการตรวจ 10 จุด (จอ ทัชสกรีน กล้อง Face ID ลำโพง การชาร์จ ฯลฯ) พร้อมสถานะ iCloud/MDM และ Battery Health เกรดสะท้อนสภาพภายนอกและการทำงาน — ดูรายละเอียดที่หน้าเกณฑ์การเกรด',
  },
];

export const Help = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(0);
  const [support, setSupport] = useState<{ line_id: string | null; phone: string | null; hours: string | null }>({
    line_id: null, phone: null, hours: null,
  });

  useEffect(() => {
    getSupportInfo().then((r) => setSupport(r.support)).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return FAQ;
    return FAQ.filter((f) => f.q.toLowerCase().includes(t) || f.a.toLowerCase().includes(t));
  }, [q]);

  const hasContact = support.line_id || support.phone;

  return (
    <div>
      <div style={{ textAlign: 'center', marginTop: 22 }}>
        <h1 className="h1" style={{ marginBottom: 0 }}>มีอะไรให้เราช่วย?</h1>
        <div className="input-ic" style={{ maxWidth: 400, margin: '16px auto 0' }}>
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(-1); }}
            placeholder="ค้นหาคำถาม เช่น การชำระเงิน"
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 999, border: '1px solid var(--line)',
              fontSize: 14, fontWeight: 600, outline: 'none', fontFamily: 'var(--font-body)', background: '#fff',
            }}
          />
        </div>
      </div>

      {hasContact && (
        <div className="grid2" style={{ marginTop: 20 }}>
          {support.line_id && (
            <div className="card" style={{ textAlign: 'center', marginTop: 0 }}>
              <span className="mr-ic" style={{ margin: '0 auto', background: 'rgba(0,185,0,0.1)', color: '#00b900' }}>
                <MessageCircle size={20} />
              </span>
              <div className="bold small" style={{ marginTop: 10 }}>LINE Official</div>
              <div className="mono bold" style={{ marginTop: 4, fontSize: 14 }}>{support.line_id}</div>
              <div className="tiny muted bold" style={{ marginTop: 4 }}>{support.hours || 'ตอบในเวลาทำการ'}</div>
            </div>
          )}
          {support.phone && (
            <div className="card" style={{ textAlign: 'center', marginTop: 0 }}>
              <span className="mr-ic" style={{ margin: '0 auto', background: 'rgba(26,43,60,0.08)', color: 'var(--brand-deep)' }}>
                <Phone size={20} />
              </span>
              <div className="bold small" style={{ marginTop: 10 }}>โทรหาเจ้าหน้าที่</div>
              <a className="mono bold" href={`tel:${support.phone.replace(/[^0-9+]/g, '')}`} style={{ display: 'block', marginTop: 4, fontSize: 14, color: 'var(--brand-deep)' }}>
                {support.phone}
              </a>
              <div className="tiny muted bold" style={{ marginTop: 4 }}>{support.hours || 'ในเวลาทำการ'}</div>
            </div>
          )}
        </div>
      )}

      <div className="hr-title"><span>คำถามที่พบบ่อย</span><span className="line" /></div>
      {visible.length === 0 && (
        <div className="empty">ไม่พบคำถามที่ตรงกับ "{q}" — ลองคำอื่น หรือติดต่อเจ้าหน้าที่ตามช่องทางด้านบน</div>
      )}
      {visible.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {visible.map((f, i) => (
            <div key={f.q} style={{ borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
              <button
                onClick={() => setOpen(open === i ? -1 : i)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  width: '100%', padding: '15px 16px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)',
                  fontSize: 13.5, fontWeight: 700, color: 'var(--ink)',
                }}
              >
                {f.q}
                <ChevronDown
                  size={16}
                  style={{ flexShrink: 0, color: 'var(--muted)', transform: open === i ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s' }}
                />
              </button>
              {open === i && (
                <div className="small muted" style={{ padding: '0 16px 15px', lineHeight: 1.7, background: 'var(--zebra)', paddingTop: 12 }}>
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card mini-row" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => navigate('/grading')}>
        <span className="mr-ic" style={{ background: 'rgba(26,43,60,0.08)', color: 'var(--brand-deep)' }}><BadgeCheck size={18} /></span>
        <div className="bold small" style={{ flex: 1 }}>เกณฑ์การเกรดสภาพเครื่อง</div>
        <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
      </div>
      <div className="card mini-row" style={{ cursor: 'pointer', alignItems: 'center' }} onClick={() => navigate('/documents')}>
        <span className="mr-ic" style={{ background: 'rgba(49,130,206,0.1)', color: 'var(--info)' }}><FolderOpen size={18} /></span>
        <div className="bold small" style={{ flex: 1 }}>คลังเอกสารของฉัน</div>
        <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
      </div>

      <div className="tiny muted bold" style={{ textAlign: 'center', margin: '26px 0 10px' }}>
        GETMOBIE โดยบริษัท เก็ทโมบี้ จำกัด
      </div>
    </div>
  );
};
