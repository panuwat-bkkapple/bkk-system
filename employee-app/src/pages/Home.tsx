import { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight, Loader2, RefreshCw, TriangleAlert, Fingerprint,
  CalendarPlus, Repeat, CalendarDays, Receipt, FolderClosed, Inbox as InboxIcon,
} from 'lucide-react';
import { call, errorText, type AttendanceStatus, type LeaveBalanceRow } from '../api';
import { clockTime, shiftTimeText } from '../geo';
import type { Screen } from '../nav';

/**
 * หน้าแรกแบบแท่นรวม (ดีไซน์ 01)
 *
 * **การ์ดสถานะวันนี้เป็นปุ่ม ไม่ใช่ป้าย** — ต้นฉบับให้แตะการ์ดแล้วเข้าหน้าลงเวลา
 * ซึ่งตรงกับสิ่งที่คนเปิดแอปมาทำจริง
 *
 * **ตะแกรงเมนูมีเฉพาะปลายทางที่มีจริง** — ต้นฉบับมีหกช่อง (รวมสวัสดิการ) เรามี
 * ห้าที่กดแล้วไปถึงจริง ปุ่มที่กดแล้วไม่เกิดอะไรทำให้คนสรุปว่าแอปพัง ไม่ใช่ว่า
 * เรายังไม่ได้ทำ · ปุ่ม "จัดเรียง" ของต้นฉบับไม่มี เพราะยังไม่มีที่เก็บลำดับ
 * ที่ผู้ใช้จัดเอง (ทำเป็นปุ่มลวงไม่ได้)
 */
const MENU: { id: Screen; label: string; icon: typeof CalendarPlus }[] = [
  { id: 'leave', label: 'ขอลา', icon: CalendarPlus },
  { id: 'swap', label: 'สลับกะ', icon: Repeat },
  { id: 'roster', label: 'ตารางกะ', icon: CalendarDays },
  { id: 'payslip', label: 'เงินเดือน', icon: Receipt },
  { id: 'documents', label: 'เอกสาร', icon: FolderClosed },
];

interface LeaveListRes { year: string; balances: LeaveBalanceRow[] }

export default function Home({ onGo, isSupervisor }: {
  onGo: (s: Screen) => void;
  isSupervisor: boolean;
}) {
  const [att, setAtt] = useState<AttendanceStatus | null>(null);
  const [leave, setLeave] = useState<LeaveListRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // ยอดสิทธิ์ลาพังได้โดยไม่ทำให้หน้าแรกพัง — การ์ดลงเวลาสำคัญกว่า
      const [a, l] = await Promise.all([
        call<AttendanceStatus>('employeeAttendanceStatus'),
        call<LeaveListRes>('employeeLeaveList').catch(() => null),
      ]);
      setAtt(a);
      setLeave(l);
    } catch (e) {
      setErr(errorText(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !att) return <div className="card center"><Loader2 size={20} className="spin" /></div>;
  if (!att) {
    return (
      <div className="card">
        {err && <div className="note bad">{err}</div>}
        <button className="btn ghost" onClick={() => void load()}><RefreshCw size={16} /> ลองใหม่</button>
      </div>
    );
  }

  const rec = att.record;
  const late = rec.late_min !== null && rec.late_min > 0;
  const statusText = rec.status === 'empty' ? 'ยังไม่เช็คอิน'
    : rec.status === 'open' ? `เข้างานแล้ว ${clockTime(rec.in_at)}`
      : `ลงเวลาครบแล้ว · ${clockTime(rec.in_at)} - ${clockTime(rec.out_at)}`;

  const shown = (leave?.balances || [])
    .filter((b) => (b.entitled_paid_days ?? 0) > 0 || b.entitled_paid_days == null)
    .slice(0, 2);

  return (
    <>
      {err && <div className="note bad">{err}</div>}

      <div className="section"><h2>สถานะวันนี้</h2>
        <button className="card tap" onClick={() => onGo('checkin')}>
          <div className="split">
            <div style={{ textAlign: 'left' }}>
              <div className="muted">
                กะวันนี้{att.shift ? ` · ${att.shift.label}` : ''}
              </div>
              <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>
                {att.shift ? shiftTimeText(att.shift.start, att.shift.end) : 'ยังไม่ได้จัดเวร'}
              </div>
              <div className={`statusline ${rec.status === 'empty' ? 'call' : ''}`}>
                {statusText}
              </div>
            </div>
            <span className="go"><Fingerprint size={20} strokeWidth={1.9} /><ChevronRight size={16} /></span>
          </div>
        </button>
        {late && (
          <div className={`note ${rec.within_grace ? 'warn' : 'bad'}`} style={{ marginTop: 10 }}>
            <TriangleAlert size={14} /> เข้างานสายวันนี้ {rec.late_min} นาที
            {rec.within_grace ? ' (อยู่ในช่วงผ่อนผัน)' : ''}
          </div>
        )}
      </div>

      <div className="section"><h2>เมนูของฉัน</h2>
        <div className="menugrid">
          {MENU.map((m) => (
            <button key={m.id} className="menuitem" onClick={() => onGo(m.id)}>
              <span className="mi"><m.icon size={19} strokeWidth={1.9} /></span>
              {m.label}
            </button>
          ))}
          {/* กล่องอนุมัติขึ้นเฉพาะคนที่มีลูกน้องจริง — หัวหน้ารู้ตัวจากการมีเมนูนี้ */}
          {isSupervisor && (
            <button className="menuitem" onClick={() => onGo('inbox')}>
              <span className="mi"><InboxIcon size={19} strokeWidth={1.9} /></span>
              อนุมัติ
            </button>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div className="section">
          <h2 style={{ justifyContent: 'space-between' }}>
            <span>สิทธิ์ลาที่ได้ค่าจ้าง</span>
            <button className="opt" style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={() => onGo('leave')}>ดูทั้งหมด</button>
          </h2>
          <div className="grid2">
            {shown.map((b) => (
              <div className="tile" key={b.type}>
                <div className="muted" style={{ fontSize: 11.5 }}>{b.label}</div>
                <div className="btm">
                  <div className="num" style={{ fontSize: 21, marginTop: 6 }}>
                    {b.entitled_paid_days == null ? '—' : (b.remaining_paid_days ?? 0)}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {b.entitled_paid_days == null ? 'ตามที่แพทย์กำหนด' : `จาก ${b.entitled_paid_days} วัน`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
