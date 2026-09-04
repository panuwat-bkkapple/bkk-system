import { useEffect, useState } from 'react';
import { Loader2, CalendarDays } from 'lucide-react';
import { call, errorText, type AttendanceRecord } from '../api';
import { clockTime, durationText } from '../geo';

interface Res { from: string; to: string; rows: AttendanceRecord[]; capped: boolean }

export default function History() {
  const [data, setData] = useState<Res | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try { setData(await call<Res>('employeeAttendanceHistory')); }
      catch (e) { setErr(errorText(e)); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="card center"><Loader2 size={20} className="spin" /></div>;
  if (err) return <div className="note bad">{err}</div>;

  return (
    <div className="card">
      <h2><CalendarDays size={13} /> ประวัติลงเวลา 30 วัน</h2>
      {data?.capped && (
        <div className="note warn">แสดงได้บางส่วนเท่านั้น — ขอประวัติเต็มจากฝ่ายบุคคล</div>
      )}
      {(data?.rows || []).length === 0 ? (
        <div className="muted">ยังไม่มีประวัติการลงเวลา</div>
      ) : (
        <div className="list">
          {(data?.rows || []).map((r) => (
            <div className="row" key={r.date}>
              <div className="top">
                <b style={{ fontSize: 13 }}>{r.date}</b>
                <span className="muted">{r.shift_label || 'ไม่มีกะ'}</span>
              </div>
              <div className="muted">
                {clockTime(r.in_at)} - {clockTime(r.out_at)}
                {r.worked_min !== null ? ` · ${durationText(r.worked_min)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                {r.status === 'open' && <span className="pill warn">ยังไม่ได้ออกงาน</span>}
                {r.late_min !== null && r.late_min > 0 && (
                  <span className={`pill ${r.within_grace ? 'warn' : 'bad'}`}>สาย {r.late_min} น.</span>
                )}
                {r.early_min !== null && r.early_min > 0 && <span className="pill warn">ออกก่อน {r.early_min} น.</span>}
                {r.out_outside && <span className="pill grey">ออกงานนอกพื้นที่</span>}
                {r.no_shift && <span className="pill grey">ไม่มีกะ</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
