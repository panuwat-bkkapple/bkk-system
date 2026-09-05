import { useCallback, useEffect, useState } from 'react';
import { Check, X, Loader2, Inbox as InboxIcon } from 'lucide-react';
import { call, errorText, type SupervisorInbox } from '../api';

// กล่องอนุมัติของหัวหน้า — เห็นเฉพาะ **ลูกน้องตรง** ของตัวเอง
// (`employees/{id}/supervisor_id` ชี้มาที่แฟ้มเรา) ไม่ใช่ทั้งแผนก
export default function Inbox() {
  const [data, setData] = useState<SupervisorInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await call<SupervisorInbox>('supervisorInbox')); }
    catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (kind: 'leave' | 'shift', employeeId: string, requestId: string, status: 'approved' | 'rejected') => {
    setBusy(requestId); setMsg(null);
    try {
      await call('supervisorDecide', { kind, employeeId, requestId, status });
      await load();
    } catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(null); }
  };

  if (loading && !data) return <div className="card center"><Loader2 size={20} className="spin" /></div>;
  if (!data?.is_supervisor) {
    return (
      <div className="card">
        <h2><InboxIcon size={13} /> อนุมัติคำขอ</h2>
        <div className="muted">ยังไม่มีลูกน้องในสายบังคับบัญชาของคุณ</div>
      </div>
    );
  }

  const empty = data.leave.length === 0 && data.shift.length === 0;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}
      <div className="card">
        <h2><InboxIcon size={13} /> รออนุมัติ ({data.leave.length + data.shift.length})</h2>
        <div className="muted">ลูกน้องในสายของคุณ {data.reports.length} คน</div>
        {empty && <div className="muted" style={{ marginTop: 8 }}>ไม่มีคำขอค้างอยู่</div>}
      </div>

      {data.leave.length > 0 && (
        <div className="card">
          <h2>ใบลา</h2>
          <div className="list">
            {data.leave.map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 13 }}>{r.employee_name || r.employee_id}</b>
                  <span className="pill warn">{r.days} วัน</span>
                </div>
                <div className="muted">
                  {r.from} - {r.to} · ได้ค่าจ้าง {r.paid_days} วัน · ไม่ได้ {r.unpaid_days} วัน
                </div>
                {r.reason && <div className="muted">เหตุผล: {r.reason}</div>}
                {/* ใบที่ถูกแก้หลังยื่นต้องบอก — ไม่งั้นหัวหน้าอนุมัติสิ่งที่ต่างจาก
                    ที่เคยเห็นตอนได้รับแจ้งโดยไม่รู้ตัว */}
                {r.edited_at ? <div className="muted">แก้ไขหลังยื่นแล้ว</div> : null}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn in sm" disabled={busy === r.id}
                    onClick={() => void decide('leave', r.employee_id, r.id, 'approved')}>
                    <Check size={13} /> อนุมัติ
                  </button>
                  <button className="btn ghost sm" disabled={busy === r.id}
                    onClick={() => void decide('leave', r.employee_id, r.id, 'rejected')}>
                    <X size={13} /> ไม่อนุมัติ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.shift.length > 0 && (
        <div className="card">
          <h2>ขอเปลี่ยนกะ</h2>
          <div className="list">
            {data.shift.map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 13 }}>{r.employee_name || r.employee_id}</b>
                  <span className="pill warn">{r.date}</span>
                </div>
                <div className="muted">ขอเปลี่ยนเป็น {r.to_shift_label || r.to_shift_id}{r.reason ? ` · ${r.reason}` : ''}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {/* อนุมัติ = เขียนตารางเวรจริง (server ทำให้) ไม่ใช่แค่ติดสถานะ */}
                  <button className="btn in sm" disabled={busy === r.id}
                    onClick={() => void decide('shift', r.employee_id, r.id, 'approved')}>
                    <Check size={13} /> อนุมัติ
                  </button>
                  <button className="btn ghost sm" disabled={busy === r.id}
                    onClick={() => void decide('shift', r.employee_id, r.id, 'rejected')}>
                    <X size={13} /> ไม่อนุมัติ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
