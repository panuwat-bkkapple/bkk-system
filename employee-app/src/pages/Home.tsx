import { useCallback, useEffect, useState } from 'react';
import { Clock, MapPin, Loader2, RefreshCw } from 'lucide-react';
import { call, errorText, type AttendanceStatus, type PunchResult } from '../api';
import { clockTime, durationText, formatDistance, shiftTimeText, type GeoFix } from '../geo';
import SlideConfirm from '../SlideConfirm';

// หน้าลงเวลา — ปุ่มเดียวที่เปลี่ยนความหมายตามสถานะ (เข้า -> ออก -> จบแล้ว)
//
// **ระยะห่างต้องโชว์ก่อนกด** — ปุ่มที่กดแล้วค่อยรู้ว่าไกลไป คือปุ่มที่คนกดซ้ำๆ
// ตอนยืนอยู่หน้าร้าน แล้วสรุปว่าระบบพัง
//
// ดีไซน์ต้นทาง (02) มีแผนที่ geofence · ปุ่มสแกน QR · ปุ่มเช็คอินนอกสถานที่ —
// **สามอย่างนี้ยังไม่ได้ทำ** เพราะระบบไม่มี QR ไม่มีเส้นทางเช็คอินนอกสถานที่
// และการวาดแผนที่ต้องโหลด Maps JS ทุกการเปิดแอปเพื่อภาพประกอบที่ไม่ได้เปลี่ยน
// คำตอบ (ตัวเลขระยะทางบอกสิ่งเดียวกัน และ server เป็นคนตัดสินอยู่แล้ว)
// ส่วน **แถบเลื่อนยืนยันทำแล้ว** — ดู `SlideConfirm`
export default function Home({ fix }: { fix: GeoFix }) {
  const [data, setData] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call<AttendanceStatus>('employeeAttendanceStatus'));
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const punch = async (kind: 'in' | 'out') => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await call<PunchResult>(
        kind === 'in' ? 'employeeAttendanceCheckIn' : 'employeeAttendanceCheckOut',
        { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m },
      );
      if (!res.ok) {
        // server เป็นคนตัดสิน — หน้าจอแค่เล่าเหตุผลที่มันส่งกลับมา ไม่ตีความใหม่
        setMsg({ tone: 'warn', text: res.message || 'ลงเวลาไม่สำเร็จ' });
      } else {
        setMsg({ tone: 'ok', text: kind === 'in' ? 'ลงเวลาเข้างานแล้ว' : 'ลงเวลาออกงานแล้ว' });
      }
      await load();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="card center"><Loader2 size={20} className="spin" /></div>;
  }
  if (!data) {
    return (
      <div className="card">
        {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}
        <button className="btn ghost" onClick={() => void load()}><RefreshCw size={16} /> ลองใหม่</button>
      </div>
    );
  }

  const rec = data.record;
  const nearest = data.sites
    .map((s) => ({ s, d: haversine(fix, s) }))
    .sort((a, b) => a.d - b.d)[0] || null;
  const inRange = nearest ? nearest.d <= data.radius_m : false;
  const accuracyOk = fix.accuracy_m <= data.min_accuracy_m;

  const statusPill = rec.status === 'empty' ? { tone: 'grey', text: 'ยังไม่ลงเวลา' }
    : rec.status === 'open' ? { tone: 'ok', text: 'อยู่ระหว่างกะ' }
      : { tone: 'ok', text: 'ลงเวลาครบแล้ว' };

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      <div className="section"><h2>สถานะวันนี้</h2>
        <div className="card">
          <div className="split">
            <div>
              <div className="muted">
                {data.shift ? `กะวันนี้ · ${data.shift.label}` : 'กะวันนี้'}
              </div>
              <div style={{ fontSize: 23, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {data.shift ? shiftTimeText(data.shift.start, data.shift.end) : 'ยังไม่ได้จัดเวร'}
              </div>
            </div>
            <span className={`pill ${statusPill.tone}`}>{statusPill.text}</span>
          </div>

          <div className="center" style={{ margin: '18px 0 4px' }}>
            <div className="muted">
              {rec.status === 'empty' ? 'ยังไม่ได้ลงเวลา' : rec.status === 'open' ? 'เข้างานเมื่อ' : 'ทำงานวันนี้'}
            </div>
            <div className="big">
              {rec.status === 'empty' ? '--:--'
                : rec.status === 'open' ? clockTime(rec.in_at)
                  : durationText(rec.worked_min)}
            </div>
            {rec.status === 'closed' && (
              <div className="muted">{clockTime(rec.in_at)} - {clockTime(rec.out_at)}</div>
            )}
          </div>

          {rec.status !== 'empty' && rec.late_min !== null && rec.late_min > 0 && (
            <div className={`note ${rec.within_grace ? 'warn' : 'bad'}`} style={{ marginTop: 12, marginBottom: 0 }}>
              เข้างานช้า {rec.late_min} นาที{rec.within_grace ? ' (อยู่ในช่วงผ่อนผัน)' : ''}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {rec.status === 'closed' ? (
              <div className="center"><span className="pill ok">ลงเวลาครบแล้ววันนี้</span></div>
            ) : (
              <>
                <SlideConfirm
                  label={rec.status === 'open' ? 'ลงเวลาออกงาน' : 'ลงเวลาเข้างาน'}
                  tone={rec.status === 'open' ? 'dark' : 'brand'}
                  busy={busy}
                  disabled={rec.status === 'empty' && (!inRange || !accuracyOk)}
                  onConfirm={() => void punch(rec.status === 'open' ? 'out' : 'in')}
                />
                <div className="muted center" style={{ marginTop: 8 }}>
                  ลากไปทางขวาเพื่อยืนยัน
                </div>
              </>
            )}
          </div>

          {!data.shift && (
            // ไม่มีกะยังลงเวลาได้ (server ยอม) แต่ต้องบอกให้รู้ ไม่ใช่เงียบ
            <div className="muted" style={{ marginTop: 10 }}>
              ยังไม่มีตารางเวรของวันนี้ ลงเวลาได้ตามปกติ แต่ระบบจะไม่คิดว่าสายหรือไม่
            </div>
          )}
          {data.shift?.crosses_midnight && (
            <div className="muted" style={{ marginTop: 10 }}>
              กะนี้ข้ามเที่ยงคืน — ลงเวลาออกงานเช้าวันถัดไปยังนับเป็นกะเดียวกัน
            </div>
          )}
        </div>
      </div>

      <div className="section"><h2>ตำแหน่งของคุณ</h2>
        <div className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className={`dot ${nearest ? (inRange ? 'ok' : 'bad') : ''}`} />
            <b style={{ fontSize: 15, fontWeight: 600 }}>
              {nearest
                ? (inRange ? `อยู่ในพื้นที่${nearest.s.name}` : `อยู่นอกพื้นที่${nearest.s.name}`)
                : 'ยังไม่ได้ตั้งพิกัดสาขา'}
            </b>
          </div>
          <div className="muted" style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <MapPin size={13} />
            {nearest
              ? <>ห่างจากจุดลงเวลา {formatDistance(nearest.d)} · ต้องอยู่ในระยะ {data.radius_m} ม. · ความแม่นยำ {Math.round(fix.accuracy_m)} ม.</>
              : <>ยังไม่ได้ตั้งพิกัดสาขาสำหรับลงเวลา</>}
          </div>
          {!accuracyOk && (
            // บอกว่า "รอสัญญาณ" ไม่ใช่ "อยู่ผิดที่" — ข้อความเดียวกับฝั่ง server
            <div className="note warn" style={{ marginTop: 12, marginBottom: 0 }}>
              สัญญาณ GPS ยังไม่แม่นพอ (คลาดเคลื่อน {Math.round(fix.accuracy_m)} ม.) รอสักครู่แล้วลองใหม่
            </div>
          )}
          {rec.status === 'open' && (
            <div className="muted" style={{ marginTop: 10 }}>
              ออกงานกดได้แม้ไม่ได้อยู่ที่สาขา ระบบจะบันทึกระยะไว้ให้หัวหน้าเห็น
            </div>
          )}
        </div>
      </div>

      <div className="section"><h2><Clock size={13} /> รายละเอียดวันนี้</h2>
        <div className="card">
          <div className="kv"><span className="k">วันที่ของกะ</span><span className="v">{data.attendance_date}</span></div>
          <div className="kv"><span className="k">เข้างาน</span><span className="v">{clockTime(rec.in_at)}{rec.in_site_name ? ` · ${rec.in_site_name}` : ''}</span></div>
          <div className="kv"><span className="k">ออกงาน</span><span className="v">{clockTime(rec.out_at)}{rec.out_site_name ? ` · ${rec.out_site_name}` : ''}</span></div>
          {rec.out_outside && <div className="muted" style={{ marginTop: 8 }}>ลงเวลาออกงานนอกพื้นที่สาขา</div>}
        </div>
      </div>
    </>
  );
}

// ระยะทางฝั่งหน้าจอมีไว้ **บอกคนใช้ก่อนกด** เท่านั้น — การตัดสินว่าอยู่ในรัศมี
// ไหมเป็นของ server เสมอ (hr-attendance.js) สองที่นี้ไม่ใช่สำเนาของกฎเดียวกัน
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}
