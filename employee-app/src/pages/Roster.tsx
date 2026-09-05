import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Repeat, CalendarPlus, History as HistoryIcon } from 'lucide-react';
import { call, errorText, type RosterRes } from '../api';
import { shiftTimeText, thaiDayParts } from '../geo';
import type { Screen } from '../nav';

/** เดือนถัดไป/ก่อนหน้าจาก `YYYY-MM` — คิดด้วยเลขปี/เดือนตรงๆ ไม่ผ่าน Date
 *  (ปฏิทินเดือนไม่ควรเดินตามเขตเวลาของเครื่อง) */
function shiftMonth(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) + delta;
  const y2 = y + Math.floor((m - 1) / 12);
  const m2 = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${y2}-${String(m2).padStart(2, '0')}`;
}

const THAI_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const monthTitle = (ym: string) =>
  `${THAI_MONTH[Number(ym.slice(5, 7)) - 1]} ${Number(ym.slice(0, 4)) + 543}`;

/**
 * ตารางกะของฉัน (ดีไซน์ 03)
 *
 * **วันหยุดกับ "ยังไม่ได้จัดเวร" เป็นคนละเรื่อง และห้ามวาดเหมือนกัน** — server
 * ตอบ `shift: null` เมื่อวันนั้นไม่มีกะจากทั้งตารางเวรและกะประจำตัว ซึ่งอ่านว่า
 * *วันหยุด*; ส่วนคนที่ยังไม่ถูกตั้ง `default_shift_id` เลยจะได้ null ทั้งเดือน
 * ซึ่งไม่ใช่วันหยุดทั้งเดือน — จึงมีข้อความบอกไว้ต่างหากใต้หัวเดือน
 */
export default function Roster({ onGo }: { onGo: (s: Screen) => void }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<RosterRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (ym: string) => {
    setLoading(true);
    setErr(null);
    try {
      setData(await call<RosterRes>('employeeRoster', { month: ym }));
    } catch (e) {
      setErr(errorText(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(month); }, [load, month]);

  const days = data?.days || [];
  const hasAnyShift = days.some((d) => d.shift);
  const noRosterAtAll = Boolean(data) && !hasAnyShift && !data?.default_shift_id;

  return (
    <>
      {err && <div className="note bad">{err}</div>}

      <div className="section">
        <h2 style={{ justifyContent: 'space-between' }}>
          <button className="iconbtn sm" aria-label="เดือนก่อนหน้า"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft size={17} />
          </button>
          <span>{monthTitle(month)}</span>
          <button className="iconbtn sm" aria-label="เดือนถัดไป"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight size={17} />
          </button>
        </h2>

        {loading && !data ? (
          <div className="card center"><Loader2 size={20} className="spin" /></div>
        ) : noRosterAtAll ? (
          <div className="card">
            <div className="muted">
              ยังไม่มีตารางเวรของคุณในระบบ และยังไม่ได้ตั้งกะประจำตัว —
              ติดต่อฝ่ายบุคคลให้จัดเวรก่อน ระหว่างนี้ยังลงเวลาได้ตามปกติ
            </div>
          </div>
        ) : (
          <div className="list">
            {days.map((d) => {
              const p = thaiDayParts(d.date);
              return (
                <div className={`row day${d.today ? ' today' : ''}`} key={d.date}>
                  <div className="daycol">
                    <span className="dow">{p.dow}</span>
                    <span className="dnum">{p.num}</span>
                  </div>
                  <span className="vline" aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="top">
                      <b style={{ fontSize: 14, fontWeight: 600 }}>
                        {d.shift ? shiftTimeText(d.shift.start, d.shift.end) : 'วันหยุด'}
                      </b>
                      {d.today && <span className="pill brand">วันนี้</span>}
                      {d.pending_change && <span className="pill warn">รอตอบ</span>}
                    </div>
                    <div className="muted">
                      {d.shift ? d.shift.label : 'ไม่มีกะ'}
                      {d.note ? ` · ${d.note}` : ''}
                      {d.pending_change?.to_shift_label ? ` · ขอเปลี่ยนเป็น ${d.pending_change.to_shift_label}` : ''}
                    </div>
                    {d.checked_in && (
                      <div className="muted">
                        ลงเวลาแล้ว{d.late_min && d.late_min > 0 ? ` · สาย ${d.late_min} นาที` : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="section">
        <div className="acts wide">
          <button className="btn ghost" onClick={() => onGo('swap')}>
            <Repeat size={15} /> สลับกะกับเพื่อน
          </button>
          <button className="btn ghost" onClick={() => onGo('shift')}>
            <CalendarPlus size={15} /> ขอเปลี่ยนกะ
          </button>
          <button className="btn ghost" onClick={() => onGo('history')}>
            <HistoryIcon size={15} /> ประวัติการลงเวลา
          </button>
        </div>
      </div>
    </>
  );
}
