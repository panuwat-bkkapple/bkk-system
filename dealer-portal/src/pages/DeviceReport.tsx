// Diagnostic Report รายเครื่อง — หน้าเต็มของตัวเอง (ไม่ใช่ modal/bottom sheet)
// โครงตามจอ "Detailed Diagnostic Report" ของ Stitch: hero ขาว + % Functional วงแหวนเขียว
// + การ์ดหมวดผลตรวจ (header แถบฟ้า, แถวชื่อซ้าย-badge ขวา, zebra)
// Desktop = grid หลายคอลัมน์ / Mobile = เรียงลงมา (ดู .report-grid ใน styles.css)
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { onValue, ref } from 'firebase/database';
import {
  ArrowLeft, Smartphone, ScanFace, MonitorSmartphone, Volume2, BatteryCharging,
  ShieldCheck, Layers, CheckCircle2, XCircle, Sparkles,
} from 'lucide-react';
import { db } from '../firebase';
import { QC_CHECK_LABEL, CLEAN_STATUS_LABEL, gradeDescOf, fmtBaht, fmtDateTime, type LotItem } from '../types';
import { Lightbox } from '../components/Lightbox';

// จัดกลุ่มผลตรวจ 10 รายการเป็นหมวดแบบ Stitch (Face ID Array / Display Subsystem / ...)
const CHECK_GROUPS: { title: string; icon: React.ReactNode; keys: string[] }[] = [
  { title: 'จอแสดงผล', icon: <MonitorSmartphone size={16} />, keys: ['screen_display', 'screen_touch', 'truetone'] },
  { title: 'กล้องและเซ็นเซอร์', icon: <ScanFace size={16} />, keys: ['faceid', 'camera_front', 'camera_rear'] },
  { title: 'เสียงและการเชื่อมต่อ', icon: <Volume2 size={16} />, keys: ['speaker_mic', 'wifi_bt', 'buttons'] },
];

export const DeviceReport = () => {
  const { id, jobId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<LotItem | null | undefined>(undefined);
  const [lotNo, setLotNo] = useState<string>('');
  const [photoIdx, setPhotoIdx] = useState(-1); // -1 = lightbox ปิด

  useEffect(() => {
    if (!id || !jobId) return;
    const unsubItem = onValue(
      ref(db, `lots/${id}/items/${jobId}`),
      (snap) => setItem(snap.exists() ? snap.val() : null),
      () => setItem(null)
    );
    const unsubNo = onValue(ref(db, `lots/${id}/lot_no`), (snap) => setLotNo(snap.val() || ''), () => {});
    return () => { unsubItem(); unsubNo(); };
  }, [id, jobId]);

  const checks = useMemo(() => Object.entries(item?.qc_checks || {}), [item]);
  const passed = checks.filter(([, v]) => v).length;
  const pct = checks.length > 0 ? Math.round((passed / checks.length) * 100) : null;
  const clean = Object.entries(item?.clean_status || {});
  const bat = item?.battery_pct;
  const batLow = bat != null && bat < 80;
  const checkMap = item?.qc_checks || {};

  if (item === undefined) return (<><div className="skel" style={{ marginTop: 20 }} /><div className="skel" /></>);
  if (item === null) return <div className="empty mt16">ไม่พบข้อมูลเครื่องนี้ หรือล็อตไม่เปิดสำหรับบัญชีของคุณ</div>;

  const row = (key: string, ok: boolean | undefined, label: string) => (
    <div key={key} className="rrow">
      <span className="nm">{label}</span>
      {ok == null ? (
        <span className="rbadge na">ไม่มีข้อมูล</span>
      ) : ok ? (
        <span className="rbadge ok">ผ่าน <CheckCircle2 size={15} /></span>
      ) : (
        <span className="rbadge bad">ไม่ผ่าน <XCircle size={15} /></span>
      )}
    </div>
  );

  return (
    <div>
      <button className="btn ghost small" style={{ marginTop: 16 }} onClick={() => navigate(`/lots/${id}`)}>
        <ArrowLeft size={14} /> กลับไปหน้าล็อต
      </button>
      <nav className="crumbs" style={{ marginTop: 12 }}>
        <a onClick={(e) => { e.preventDefault(); navigate(`/lots/${id}`); }} href={`/lots/${id}`}>{lotNo || 'ล็อตสินค้า'}</a>
        <span className="sep">/</span>
        <span>Diagnostic Report</span>
      </nav>

      {/* hero ขาว: ซ้าย = เครื่อง, ขวา = % Functional + วงแหวนเขียว (ตามจอ Stitch) */}
      <div className="card report-hero">
        <div className="dev">
          <span className="dev-ic"><Smartphone size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="h1" style={{ margin: 0, fontSize: 20 }}>{item.model}</div>
            <div className="row mt8" style={{ justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
              <span className="chip" style={{ background: 'var(--zebra)', color: 'var(--ink-2)', border: '1px solid var(--line)' }}>{item.ref_no}</span>
              <span className="chip" style={{ background: 'var(--zebra)', color: 'var(--ink-2)', border: '1px solid var(--line)' }}>SN {item.serial_masked || '-'}</span>
            </div>
            <div className="small muted bold mt8">
              {[item.capacity, item.color].filter(Boolean).join(' · ')}
              {item.asking_price != null ? ` · ราคาตั้ง ${fmtBaht(item.asking_price)}` : ''}
            </div>
          </div>
        </div>
        {pct != null || item.grade ? (
          <div className="func">
            <div>
              {pct != null ? (
                <>
                  <div className="fv">{pct}% Functional</div>
                  <div className="label-caps muted">Test Complete</div>
                  {item.qc_date ? <div className="tiny muted bold" style={{ marginTop: 2 }}>{fmtDateTime(item.qc_date)}</div> : null}
                </>
              ) : (
                <div className="label-caps muted">ยังไม่มีผลตรวจละเอียด</div>
              )}
            </div>
            {/* ป้ายเกรดตัวใหญ่ (แทนวงแหวน — grading คือสิ่งที่ดีลเลอร์ใช้ตัดสินใจ) */}
            {item.grade && (
              <div className="grade-tile">
                <span className="gl">{item.grade}</span>
                <span className="gc">Grade</span>
              </div>
            )}
          </div>
        ) : (
          <div className="func"><div className="label-caps muted">ยังไม่มีผลตรวจละเอียด</div></div>
        )}
      </div>

      {checks.length === 0 && bat == null && !item.parts && (
        <div className="notice mt12">เครื่องนี้ยังไม่มีรายงานผลตรวจละเอียดในระบบ — สอบถามเพิ่มเติมได้ที่เจ้าหน้าที่</div>
      )}

      {/* รูปสภาพเครื่องจริง — แตะเพื่อดูขยายใน lightbox (ไม่เด้งออกจากแอป) */}
      {Array.isArray(item.photos) && item.photos.length > 0 && (
        <div className="card">
          <div className="tiny muted black" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            รูปสภาพเครื่อง ({item.photos.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 10 }}>
            {item.photos.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setPhotoIdx(i)}
                aria-label={`ดูรูปเครื่องที่ ${i + 1}`}
                style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}
              >
                <img
                  src={url}
                  alt={`รูปเครื่องที่ ${i + 1}`}
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}
                />
              </button>
            ))}
          </div>
          {photoIdx >= 0 && (
            <Lightbox
              photos={item.photos}
              index={photoIdx}
              onClose={() => setPhotoIdx(-1)}
              onNavigate={setPhotoIdx}
              caption={item.model || 'รูปสภาพเครื่อง'}
            />
          )}
        </div>
      )}

      {/* การ์ดหมวดผลตรวจ — desktop เป็น grid, mobile เรียงลงมา */}
      <div className="report-grid">
        {/* สภาพเครื่องและตำหนิ — คำอธิบายเกรด + รายการที่ไม่ผ่านการตรวจ + หมายเหตุผู้ตรวจ (เต็มแถว) */}
        {(item.grade || item.qc_notes || checks.some(([, v]) => v === false)) && (
          <div className="rsec rspan">
            <div className="rsec-head">
              <Sparkles size={16} /> สภาพเครื่องและตำหนิที่พบ
              <a
                className="cnt2"
                style={{ color: 'var(--info)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                onClick={(e) => { e.preventDefault(); navigate('/grading'); }}
                href="/grading"
              >
                เกณฑ์การเกรด →
              </a>
            </div>
            {item.grade && (
              <div className="rrow">
                <span className="nm" style={{ flexShrink: 0 }}>เกรดสภาพ</span>
                <span className="small bold" style={{ textAlign: 'right' }}>
                  เกรด {item.grade}{gradeDescOf(item.grade) ? ` — ${gradeDescOf(item.grade)}` : ''}
                </span>
              </div>
            )}
            {checks.filter(([, v]) => v === false).map(([k]) => (
              <div key={k} className="rrow">
                <span className="nm" style={{ color: 'var(--danger)' }}>ตำหนิ: {QC_CHECK_LABEL[k] || k} — ไม่ผ่านการตรวจ</span>
                <XCircle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              </div>
            ))}
            {item.qc_notes && (
              <div className="rrow" style={{ alignItems: 'flex-start' }}>
                <span className="nm" style={{ flexShrink: 0 }}>หมายเหตุผู้ตรวจ</span>
                <span className="small bold" style={{ textAlign: 'right', whiteSpace: 'pre-wrap' }}>{item.qc_notes}</span>
              </div>
            )}
            {checks.length > 0 && !checks.some(([, v]) => v === false) && !item.qc_notes && (
              <div className="rrow">
                <span className="nm">ตำหนิจากการตรวจ {checks.length} รายการ</span>
                <span className="rbadge ok">ไม่พบ <CheckCircle2 size={15} /></span>
              </div>
            )}
          </div>
        )}
        {checks.length > 0 && CHECK_GROUPS.map((g) => {
          const keys = g.keys.filter((k) => checkMap[k] != null);
          if (keys.length === 0) return null;
          return (
            <div key={g.title} className="rsec">
              <div className="rsec-head">{g.icon} {g.title}</div>
              {keys.map((k) => row(k, checkMap[k], QC_CHECK_LABEL[k] || k))}
            </div>
          );
        })}

        {/* Power Systems: การชาร์จ + Battery Health */}
        {(checkMap.charging != null || bat != null) && (
          <div className="rsec">
            <div className="rsec-head"><BatteryCharging size={16} /> ระบบพลังงาน</div>
            {checkMap.charging != null && row('charging', checkMap.charging, QC_CHECK_LABEL.charging)}
            {bat != null && (
              <div className="rrow">
                <span className="nm">Battery Health{item.battery_cycles != null ? ` · ${item.battery_cycles} รอบชาร์จ` : ''}</span>
                <span className={`rbadge ${batLow ? 'bad' : 'ok'} mono`} style={{ fontSize: 13 }}>{bat}%</span>
              </div>
            )}
            {item.parts?.battery && (
              <div className="rrow"><span className="nm">สถานะแบตเตอรี่</span><span className="small bold">{item.parts.battery}</span></div>
            )}
          </div>
        )}

        {/* ความพร้อมขายต่อ */}
        {clean.length > 0 && (
          <div className="rsec">
            <div className="rsec-head"><ShieldCheck size={16} /> พร้อมขายต่อ</div>
            {clean.map(([k, v]) => row(k, v, CLEAN_STATUS_LABEL[k] || k))}
          </div>
        )}

        {/* ชิ้นส่วนหลัก / อุปกรณ์ */}
        {(item.parts?.screen || item.parts?.camera || item.parts_condition || item.accessories || item.warranty_days != null) && (
          <div className="rsec">
            <div className="rsec-head"><Layers size={16} /> ชิ้นส่วนและอุปกรณ์</div>
            {item.parts?.screen && <div className="rrow"><span className="nm">จอ</span><span className="small bold">{item.parts.screen}</span></div>}
            {item.parts?.camera && <div className="rrow"><span className="nm">กล้อง</span><span className="small bold">{item.parts.camera}</span></div>}
            {item.parts_condition && <div className="rrow"><span className="nm">อะไหล่</span><span className="small bold">{item.parts_condition}</span></div>}
            {item.accessories && <div className="rrow"><span className="nm">อุปกรณ์ที่ให้</span><span className="small bold">{item.accessories}</span></div>}
            {item.warranty_days != null && <div className="rrow"><span className="nm">ประกันร้าน</span><span className="small bold">{item.warranty_days} วัน</span></div>}
          </div>
        )}
      </div>

    </div>
  );
};
