import { useCallback, useEffect, useState } from 'react';
import { Repeat, Loader2 } from 'lucide-react';
import { call, errorText, type ShiftOption, type ShiftRequestRow } from '../api';
import { shiftTimeText, thaiDate } from '../geo';
import { STATUS_LABEL, STATUS_TONE } from '../requestStatus';
import DateField from '../DateField';

interface ListRes { shifts: ShiftOption[]; requests: ShiftRequestRow[] }

// ดีไซน์ต้นทาง (04) เป็นการ **สลับกะกับเพื่อนร่วมงาน** (เลือกคน → เขาตอบรับ →
// หัวหน้าอนุมัติ) ระบบนี้ยังไม่มีเส้นทางนั้น — ของจริงคือ "ขอเปลี่ยนไปกะอื่น
// แล้วหัวหน้าอนุมัติ" จึงเอา **ภาษาภาพ** ของดีไซน์มาใช้ แต่ไม่เอาโครงที่ระบบ
// ทำไม่ได้ (รายชื่อเพื่อนที่กดเลือกได้ทั้งที่ไม่มีใครถูกส่งคำขอไป = คำสัญญาปลอม)
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

  const picked = (data?.shifts || []).find((s) => s.id === form.toShiftId) || null;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      <div className="section">
        <h2><Repeat size={13} /> ขอเปลี่ยนกะ</h2>
        <div className="card">
          <form onSubmit={submit}>
            <label htmlFor="sd">วันที่ต้องการเปลี่ยน</label>
            <DateField id="sd" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />

            <label>เปลี่ยนไปกะ</label>
            <div className="chips">
              {(data?.shifts || []).map((s) => (
                <button type="button" key={s.id} className="opt"
                  aria-pressed={form.toShiftId === s.id}
                  onClick={() => setForm({ ...form, toShiftId: s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
            {picked && (
              <div className="stat brand" style={{ marginTop: 12 }}>
                <div className="lbl">กะที่ขอเปลี่ยนไป</div>
                <div className="val">{shiftTimeText(picked.start, picked.end)}</div>
                <div className="sub">{picked.label}</div>
              </div>
            )}

            <label htmlFor="sr">เหตุผล (ถึงหัวหน้างาน)</label>
            <textarea id="sr" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />

            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16 }}>
              {busy ? <Loader2 size={17} className="spin" /> : <Repeat size={17} />} ส่งคำขอ
            </button>
          </form>
          <div className="muted" style={{ marginTop: 12 }}>
            ขอย้อนหลังไม่ได้ — กะที่ผ่านไปแล้วเปลี่ยนไม่ได้จริง
          </div>
        </div>
      </div>

      <div className="section">
        <h2>คำขอของฉัน</h2>
        {(data?.requests || []).length === 0 ? (
          <div className="card"><div className="muted">ยังไม่เคยขอเปลี่ยนกะ</div></div>
        ) : (
          <div className="list">
            {(data?.requests || []).map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{thaiDate(r.date)}</b>
                  <span className={`pill ${STATUS_TONE[r.status] || 'grey'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                </div>
                <div className="muted">ขอเปลี่ยนเป็น {r.to_shift_label || r.to_shift_id}{r.reason ? ` · ${r.reason}` : ''}</div>
                {r.edited_at ? <div className="muted">แก้ไขหลังยื่นแล้ว</div> : null}
                {r.decision_note && <div className="muted">หมายเหตุ: {r.decision_note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
