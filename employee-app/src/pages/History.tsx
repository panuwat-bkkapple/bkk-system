import { useEffect, useState } from 'react';
import { Loader2, CalendarDays } from 'lucide-react';
import { call, errorText, type AttendanceRecord } from '../api';
import { clockTime, durationText, thaiDayParts } from '../geo';

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

  const rows = data?.rows || [];
  let lastMonth = '';

  return (
    <div className="section">
      <h2><CalendarDays size={13} /> ประวัติลงเวลา 30 วัน</h2>
      {data?.capped && (
        <div className="note warn">แสดงได้บางส่วนเท่านั้น — ขอประวัติเต็มจากฝ่ายบุคคล</div>
      )}
      {rows.length === 0 ? (
        <div className="card"><div className="muted">ยังไม่มีประวัติการลงเวลา</div></div>
      ) : (
        <div className="list">
          {rows.map((r) => {
            const d = thaiDayParts(r.date);
            // 30 วันคร่อมสองเดือนได้ — เลขวันที่ลอยๆ จึงกำกวมถ้าไม่คั่นเดือน
            const sep = d.month && d.month !== lastMonth ? d.month : '';
            if (sep) lastMonth = d.month;
            return (
              <div key={r.date}>
                {sep && <div className="monthsep">{sep}</div>}
                <div className="row" style={sep ? { marginTop: 6 } : undefined}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div className="daycol">
                      <div className="d">{d.dow}</div>
                      <div className="n">{d.num}</div>
                    </div>
                    <div className="vline" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="num" style={{ fontSize: 16 }}>
                        {/* ยังไม่ออกงาน = ไม่พิมพ์ขีดคู่ ("06:36 - -" อ่านเหมือนจอเสีย)
                            ป้าย "ยังไม่ได้ออกงาน" ด้านล่างเป็นตัวบอกสถานะแทน */}
                        {r.out_at ? `${clockTime(r.in_at)} - ${clockTime(r.out_at)}` : clockTime(r.in_at)}
                      </div>
                      <div className="muted">
                        {r.shift_label || 'ไม่มีกะ'}
                        {r.worked_min !== null ? ` · ${durationText(r.worked_min)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {r.status === 'open' && <span className="pill warn">ยังไม่ได้ออกงาน</span>}
                    {r.late_min !== null && r.late_min > 0 && (
                      <span className={`pill ${r.within_grace ? 'warn' : 'bad'}`}>สาย {r.late_min} น.</span>
                    )}
                    {r.early_min !== null && r.early_min > 0 && <span className="pill warn">ออกก่อน {r.early_min} น.</span>}
                    {r.out_outside && <span className="pill grey">ออกงานนอกพื้นที่</span>}
                    {r.no_shift && <span className="pill grey">ไม่มีกะ</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
