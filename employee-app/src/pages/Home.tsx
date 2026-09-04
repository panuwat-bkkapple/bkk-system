import { useCallback, useEffect, useState } from 'react';
import { Clock, LogIn, LogOut, MapPin, Loader2, RefreshCw } from 'lucide-react';
import { call, errorText, type AttendanceStatus, type PunchResult } from '../api';
import { clockTime, durationText, formatDistance, shiftTimeText, type GeoFix } from '../geo';

// หน้าลงเวลา — ปุ่มเดียวที่เปลี่ยนความหมายตามสถานะ (เข้า -> ออก -> จบแล้ว)
//
// **ระยะห่างต้องโชว์ก่อนกด** — ปุ่มที่กดแล้วค่อยรู้ว่าไกลไป คือปุ่มที่คนกดซ้ำๆ
// ตอนยืนอยู่หน้าร้าน แล้วสรุปว่าระบบพัง
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

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      <div className="card">
        <div className="kv">
          <span className="k">กะวันนี้</span>
          <span className="v">
            {data.shift ? `${data.shift.label} · ${shiftTimeText(data.shift.start, data.shift.end)}` : 'ยังไม่ได้จัดเวร'}
          </span>
        </div>
        {!data.shift && (
          // ไม่มีกะยังลงเวลาได้ (server ยอม) แต่ต้องบอกให้รู้ ไม่ใช่เงียบ
          <div className="muted">ยังไม่มีตารางเวรของวันนี้ ลงเวลาได้ตามปกติ แต่ระบบจะไม่คิดว่าสายหรือไม่</div>
        )}
        {data.shift?.crosses_midnight && (
          <div className="muted">กะนี้ข้ามเที่ยงคืน — ลงเวลาออกงานเช้าวันถัดไปยังนับเป็นกะเดียวกัน</div>
        )}
      </div>

      <div className="card center">
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
        {rec.status !== 'empty' && rec.late_min !== null && rec.late_min > 0 && (
          <div style={{ marginTop: 6 }}>
            <span className={`pill ${rec.within_grace ? 'warn' : 'bad'}`}>
              เข้างานช้า {rec.late_min} นาที{rec.within_grace ? ' (ในช่วงผ่อนผัน)' : ''}
            </span>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {rec.status === 'closed' ? (
            <div className="pill ok">ลงเวลาครบแล้ววันนี้</div>
          ) : (
            <button
              className={`btn ${rec.status === 'open' ? 'out' : 'in'}`}
              disabled={busy || (rec.status === 'empty' && (!inRange || !accuracyOk))}
              onClick={() => void punch(rec.status === 'open' ? 'out' : 'in')}
            >
              {busy ? <Loader2 size={18} className="spin" />
                : rec.status === 'open' ? <LogOut size={18} /> : <LogIn size={18} />}
              {' '}{rec.status === 'open' ? 'ลงเวลาออกงาน' : 'ลงเวลาเข้างาน'}
            </button>
          )}
        </div>

        <div className="muted" style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
          <MapPin size={13} />
          {nearest
            ? <>ห่างจาก{nearest.s.name} {formatDistance(nearest.d)} (ต้องอยู่ในระยะ {data.radius_m} ม.)</>
            : <>ยังไม่ได้ตั้งพิกัดสาขาสำหรับลงเวลา</>}
        </div>
        {!accuracyOk && (
          // บอกว่า "รอสัญญาณ" ไม่ใช่ "อยู่ผิดที่" — ข้อความเดียวกับฝั่ง server
          <div className="muted">สัญญาณ GPS ยังไม่แม่นพอ (คลาดเคลื่อน {Math.round(fix.accuracy_m)} ม.) รอสักครู่</div>
        )}
        {rec.status === 'open' && (
          <div className="muted">ออกงานกดได้แม้ไม่ได้อยู่ที่สาขา ระบบจะบันทึกระยะไว้ให้หัวหน้าเห็น</div>
        )}
      </div>

      <div className="card">
        <h2><Clock size={13} /> รายละเอียดวันนี้</h2>
        <div className="kv"><span className="k">วันที่ของกะ</span><span className="v">{data.attendance_date}</span></div>
        <div className="kv"><span className="k">เข้างาน</span><span className="v">{clockTime(rec.in_at)}{rec.in_site_name ? ` · ${rec.in_site_name}` : ''}</span></div>
        <div className="kv"><span className="k">ออกงาน</span><span className="v">{clockTime(rec.out_at)}{rec.out_site_name ? ` · ${rec.out_site_name}` : ''}</span></div>
        {rec.out_outside && <div className="muted">ลงเวลาออกงานนอกพื้นที่สาขา</div>}
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
