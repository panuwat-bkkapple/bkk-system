// มาตรฐานการเกรดและคุณภาพ — หน้าอ้างอิงกลางของ portal
// โครงตามจอ "Grading & Quality Standards" ใน Stitch (hero + การ์ดเกรดมีแถบสีบน)
// ปรับเนื้อหาให้ตรงระบบจริง: เกรด New/A/B/C/D (แหล่งเดียวกับ Diagnostic Report ผ่าน GRADE_DESC)
// และการตรวจ 10 จุด + สถานะพร้อมขายต่อ 4 รายการของทีม QC เรา
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, HeartPulse, ShieldCheck, CheckCircle2, Info } from 'lucide-react';
import { GRADE_DESC, QC_CHECK_LABEL, CLEAN_STATUS_LABEL } from '../types';

const GRADES: { g: string; en: string; color: string; title: string }[] = [
  { g: 'New', en: 'Brand New', color: 'var(--accent)', title: 'เครื่องใหม่' },
  { g: 'A', en: 'Excellent', color: 'var(--brand)', title: 'ดีเยี่ยม' },
  { g: 'B', en: 'Good', color: 'var(--info)', title: 'ดี' },
  { g: 'C', en: 'Fair', color: 'var(--warn)', title: 'ปานกลาง' },
  { g: 'D', en: 'Poor', color: 'var(--danger)', title: 'มีตำหนิมาก' },
];

export const GradingStandards = () => {
  const navigate = useNavigate();
  return (
    <div>
      <button className="btn ghost small" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>
        <ArrowLeft size={14} /> กลับ
      </button>

      {/* hero (ตาม Quality Guarantee hero ของ Stitch) */}
      <div className="card" style={{ padding: '24px 20px', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: 999,
            background: 'rgba(26, 43, 60, 0.05)', filter: 'blur(40px)', pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative' }}>
          <div className="label-caps" style={{ color: 'var(--accent-deep)' }}>GETMOBIE Quality Guarantee</div>
          <h1 className="h1" style={{ margin: '6px 0 4px' }}>มาตรฐานการเกรดสินค้า</h1>
          <div className="small muted bold" style={{ lineHeight: 1.7, maxWidth: 560 }}>
            ทุกเครื่องผ่านการตรวจสภาพโดยทีม QC ของเราก่อนขึ้นล็อต — เกรดที่เห็นคือเกรดที่ตรวจจริง
            พร้อมรายงานผลตรวจรายเครื่อง (Diagnostic Report) ให้เปิดดูได้ก่อนเสนอราคา
          </div>
          <div className="row mt12" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <span className="check" style={{ flex: 'none' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><BadgeCheck size={15} /> ตรวจโดยทีม QC ทุกเครื่อง</span></span>
            <span className="check" style={{ flex: 'none' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><HeartPulse size={15} /> ผลตรวจ 10 จุดรายเครื่อง</span></span>
            <span className="check" style={{ flex: 'none' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={15} /> iCloud/MDM เคลียร์ก่อนส่งมอบ</span></span>
          </div>
        </div>
      </div>

      {/* การ์ดเกรด — แถบสีบนการ์ดตามจอ Stitch */}
      <div className="hr-title">เกรดสภาพสินค้า <span className="line" /></div>
      <div className="bento" style={{ marginTop: 12 }}>
        {GRADES.map(({ g, en, color, title }) => (
          <div key={g} className="gcard sp4">
            <span className="bar" style={{ background: color }} />
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="grade-tile" style={{ background: color === 'var(--brand)' ? 'var(--brand-deep)' : color, width: 52, height: 52 }}>
                <span className="gl" style={{ fontSize: g === 'New' ? 15 : 24 }}>{g}</span>
              </span>
              <span className="label-caps" style={{ color }}>{en}</span>
            </div>
            <div className="bold" style={{ fontSize: 15.5, marginTop: 12 }}>{title}</div>
            <div className="small muted bold" style={{ marginTop: 4, lineHeight: 1.65 }}>{GRADE_DESC[g]}</div>
          </div>
        ))}
      </div>

      {/* รายการตรวจจริงของทีม QC — ชุดเดียวกับที่โชว์ใน Diagnostic Report */}
      <div className="hr-title">การตรวจสภาพรายเครื่อง <span className="line" /></div>
      <div className="grid2">
        <div className="rsec">
          <div className="rsec-head"><HeartPulse size={16} /> ผลตรวจการทำงาน 10 จุด</div>
          <div className="body">
            <div className="check-grid" style={{ marginTop: 4 }}>
              {Object.entries(QC_CHECK_LABEL).map(([k, label]) => (
                <span key={k} className="check">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  <CheckCircle2 className="st" size={16} />
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="rsec">
          <div className="rsec-head"><ShieldCheck size={16} /> ความพร้อมขายต่อ</div>
          <div className="body">
            <div className="check-grid" style={{ marginTop: 4, gridTemplateColumns: '1fr' }}>
              {Object.entries(CLEAN_STATUS_LABEL).map(([k, label]) => (
                <span key={k} className="check">
                  <span>{label}</span>
                  <CheckCircle2 className="st" size={16} />
                </span>
              ))}
            </div>
            <div className="notice mt12" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                ผลตรวจของแต่ละเครื่องเปิดดูได้จากหน้าล็อต — แตะชื่อเครื่องเพื่อเปิด <b>Diagnostic Report</b> ฉบับเต็ม
                รายการที่ไม่ผ่านจะแสดงเป็นตำหนิพร้อมหมายเหตุจากผู้ตรวจเสมอ
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
