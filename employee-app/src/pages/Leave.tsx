import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Loader2, X } from 'lucide-react';
import { call, errorText, type LeaveRequestRow, type LeaveTypeRow } from '../api';
import { STATUS_LABEL, STATUS_TONE } from '../requestStatus';

interface ListRes {
  year: string;
  types: LeaveTypeRow[];
  balances: unknown;
  requests: LeaveRequestRow[];
}
interface PreviewRes {
  ok: boolean; errors: string[]; warnings: string[];
  days: number | null; paid_days: number | null; unpaid_days: number | null;
}

export default function Leave() {
  const [data, setData] = useState<ListRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ type: '', from: '', to: '', reason: '' });
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<ListRes>('employeeLeaveList');
      setData(res);
      setForm((f) => ({ ...f, type: f.type || res.types[0]?.id || '' }));
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // **ตัวเลขที่โชว์ก่อนกดส่ง มาจากตัวคำนวณเดียวกับตอนบันทึกจริง** — ถ้าคำนวณ
  // เองฝั่งหน้าจอ คนจะเห็นเลขหนึ่งตอนยื่นและอีกเลขตอนเงินเดือนออก
  useEffect(() => {
    if (!form.type || !form.from || !form.to) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await call<PreviewRes>('employeeLeavePreview', form);
        if (alive) setPreview(res);
      } catch { if (alive) setPreview(null); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [form]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await call('employeeLeaveCreate', form);
      setMsg({ tone: 'ok', text: 'ส่งใบลาแล้ว รอหัวหน้าอนุมัติ' });
      setForm((f) => ({ ...f, from: '', to: '', reason: '' }));
      setPreview(null);
      await load();
    } catch (e2) {
      setMsg({ tone: 'bad', text: errorText(e2) });
    } finally { setBusy(false); }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try { await call('employeeLeaveCancel', { requestId: id }); await load(); }
    catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="card center"><Loader2 size={20} className="spin" /></div>;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      <div className="card">
        <h2><CalendarPlus size={13} /> ขอลา</h2>
        <form onSubmit={submit}>
          <label htmlFor="lt">ประเภทการลา</label>
          <select id="lt" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required>
            {(data?.types || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <label htmlFor="lf">ตั้งแต่วันที่</label>
          <input id="lf" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required />
          <label htmlFor="lto">ถึงวันที่</label>
          <input id="lto" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required />
          <label htmlFor="lr">เหตุผล</label>
          <textarea id="lr" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />

          {preview && (
            <div className={`note ${preview.ok ? 'ok' : 'bad'}`} style={{ marginTop: 12 }}>
              {preview.ok ? (
                <>ลา {preview.days} วัน · ได้ค่าจ้าง {preview.paid_days} วัน · ไม่ได้ค่าจ้าง {preview.unpaid_days} วัน</>
              ) : (preview.errors.join(' · ') || 'ยื่นใบนี้ไม่ได้')}
              {preview.warnings?.length > 0 && <div style={{ marginTop: 4 }}>{preview.warnings.join(' · ')}</div>}
            </div>
          )}

          <button className="btn" type="submit" disabled={busy || (preview ? !preview.ok : true)} style={{ marginTop: 12 }}>
            {busy ? <Loader2 size={17} className="spin" /> : <CalendarPlus size={17} />} ส่งใบลา
          </button>
        </form>
      </div>

      <div className="card">
        <h2>ใบลาของฉัน ปี {data?.year}</h2>
        {(data?.requests || []).length === 0 ? (
          <div className="muted">ยังไม่มีใบลาในปีนี้</div>
        ) : (
          <div className="list">
            {(data?.requests || []).map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 13 }}>{r.from} - {r.to}</b>
                  <span className={`pill ${STATUS_TONE[r.status] || 'grey'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                </div>
                <div className="muted">
                  {r.days} วัน (ได้ค่าจ้าง {r.paid_days} · ไม่ได้ {r.unpaid_days})
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
                {r.decision_note && <div className="muted">หมายเหตุ: {r.decision_note}</div>}
                {r.status === 'pending' && (
                  <button className="btn ghost sm" style={{ marginTop: 6 }} disabled={busy}
                    onClick={() => void cancel(r.id)}>
                    <X size={13} /> ยกเลิกใบนี้
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
