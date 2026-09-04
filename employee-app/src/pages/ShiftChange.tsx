import { useCallback, useEffect, useState } from 'react';
import { Repeat, Loader2 } from 'lucide-react';
import { call, errorText, type ShiftOption, type ShiftRequestRow } from '../api';
import { shiftTimeText } from '../geo';
import { STATUS_LABEL, STATUS_TONE } from '../requestStatus';

interface ListRes { shifts: ShiftOption[]; requests: ShiftRequestRow[] }

export default function ShiftChange() {
  const [data, setData] = useState<ListRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ date: '', toShiftId: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<ListRes>('employeeShiftChangeList');
      setData(res);
      setForm((f) => ({ ...f, toShiftId: f.toShiftId || res.shifts[0]?.id || '' }));
    } catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await call('employeeShiftChangeCreate', form);
      setMsg({ tone: 'ok', text: 'ส่งคำขอแล้ว รอหัวหน้าอนุมัติ' });
      setForm((f) => ({ ...f, date: '', reason: '' }));
      await load();
    } catch (e2) { setMsg({ tone: 'bad', text: errorText(e2) }); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="card center"><Loader2 size={20} className="spin" /></div>;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}
      <div className="card">
        <h2><Repeat size={13} /> ขอเปลี่ยนกะ</h2>
        <form onSubmit={submit}>
          <label htmlFor="sd">วันที่ต้องการเปลี่ยน</label>
          <input id="sd" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <label htmlFor="ss">เปลี่ยนไปกะ</label>
          <select id="ss" value={form.toShiftId} onChange={(e) => setForm({ ...form, toShiftId: e.target.value })} required>
            {(data?.shifts || []).map((s) => (
              <option key={s.id} value={s.id}>{s.label} ({shiftTimeText(s.start, s.end)})</option>
            ))}
          </select>
          <label htmlFor="sr">เหตุผล</label>
          <textarea id="sr" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? <Loader2 size={17} className="spin" /> : <Repeat size={17} />} ส่งคำขอ
          </button>
        </form>
        <div className="muted" style={{ marginTop: 8 }}>
          ขอย้อนหลังไม่ได้ — กะที่ผ่านไปแล้วเปลี่ยนไม่ได้จริง
        </div>
      </div>

      <div className="card">
        <h2>คำขอของฉัน</h2>
        {(data?.requests || []).length === 0 ? (
          <div className="muted">ยังไม่เคยขอเปลี่ยนกะ</div>
        ) : (
          <div className="list">
            {(data?.requests || []).map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 13 }}>{r.date}</b>
                  <span className={`pill ${STATUS_TONE[r.status] || 'grey'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                </div>
                <div className="muted">ขอเปลี่ยนเป็น {r.to_shift_label || r.to_shift_id}{r.reason ? ` · ${r.reason}` : ''}</div>
                {r.decision_note && <div className="muted">หมายเหตุ: {r.decision_note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
