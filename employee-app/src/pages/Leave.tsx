import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Loader2, X, Pencil, Save } from 'lucide-react';
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

const EMPTY = { type: '', from: '', to: '', reason: '' };

/** ช่องวันที่ + ป้ายที่วางทับเมื่อยังว่าง
 *
 * iOS Safari วาด `input[type=date]` ที่ไม่มีค่าเป็น **กล่องเปล่าสนิท** ไม่มี
 * ตัวอักษรใดๆ (เดสก์ท็อป Chrome ขึ้น mm/dd/yyyy ให้ ซึ่งเป็นเหตุผลที่มองไม่
 * เห็นตอนพัฒนา) คนใช้จึงอ่านว่าแอปพัง ไม่ใช่ว่ายังไม่ได้เลือก
 */
function DateField({ id, value, onChange }: {
  id: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className={value ? 'datefield' : 'datefield empty'}>
      <input id={id} type="date" value={value} required
        onChange={(e) => onChange(e.target.value)} />
      {!value && <span className="ph" aria-hidden="true">เลือกวันที่</span>}
    </div>
  );
}

export default function Leave() {
  const [data, setData] = useState<ListRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  // ใบที่กำลังแก้อยู่ — null = กำลังยื่นใบใหม่
  const [editingId, setEditingId] = useState<string | null>(null);
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
  // ส่ง `requestId` ตอนแก้ ไม่งั้นใบที่กำลังแก้จะทับช่วงของตัวเองเสมอ
  useEffect(() => {
    if (!form.type || !form.from || !form.to) { setPreview(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await call<PreviewRes>('employeeLeavePreview',
          { ...form, requestId: editingId || undefined });
        if (alive) setPreview(res);
      } catch { if (alive) setPreview(null); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [form, editingId]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setForm((f) => ({ ...EMPTY, type: data?.types[0]?.id || f.type }));
    setPreview(null);
  }, [data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (editingId) {
        await call('employeeLeaveUpdate', { ...form, requestId: editingId });
        setMsg({ tone: 'ok', text: 'แก้ใบลาแล้ว รอหัวหน้าอนุมัติ' });
      } else {
        await call('employeeLeaveCreate', form);
        setMsg({ tone: 'ok', text: 'ส่งใบลาแล้ว รอหัวหน้าอนุมัติ' });
      }
      resetForm();
      await load();
    } catch (e2) {
      setMsg({ tone: 'bad', text: errorText(e2) });
    } finally { setBusy(false); }
  };

  const startEdit = (r: LeaveRequestRow) => {
    setEditingId(r.id);
    setForm({ type: r.type, from: r.from, to: r.to, reason: r.reason || '' });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await call('employeeLeaveCancel', { requestId: id });
      // ยกเลิกใบที่กำลังแก้อยู่ = ฟอร์มต้องกลับเป็นใบใหม่ ไม่งั้นกดบันทึกแล้ว
      // จะยิงไปที่ใบที่ไม่ใช่ pending อีกต่อไป
      if (editingId === id) resetForm();
      await load();
    } catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="card center"><Loader2 size={20} className="spin" /></div>;

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      <div className="card">
        <h2>
          {editingId ? <Pencil size={13} /> : <CalendarPlus size={13} />}
          {editingId ? ' แก้ใบลา' : ' ขอลา'}
        </h2>
        <form onSubmit={submit}>
          <label htmlFor="lt">ประเภทการลา</label>
          <select id="lt" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required>
            {(data?.types || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <label htmlFor="lf">ตั้งแต่วันที่</label>
          <DateField id="lf" value={form.from} onChange={(v) => setForm({ ...form, from: v })} />
          <label htmlFor="lto">ถึงวันที่</label>
          <DateField id="lto" value={form.to} onChange={(v) => setForm({ ...form, to: v })} />
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
            {busy ? <Loader2 size={17} className="spin" /> : editingId ? <Save size={17} /> : <CalendarPlus size={17} />}
            {editingId ? ' บันทึกการแก้ไข' : ' ส่งใบลา'}
          </button>
          {editingId && (
            <button className="btn ghost" type="button" disabled={busy} onClick={resetForm} style={{ marginTop: 8 }}>
              เลิกแก้ไข
            </button>
          )}
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
                {r.edited_at ? <div className="muted">แก้ไขหลังยื่นแล้ว</div> : null}
                {r.decision_note && <div className="muted">หมายเหตุ: {r.decision_note}</div>}
                {/* แก้/ยกเลิกได้เฉพาะใบที่ยังไม่ถูกตัดสิน — server บังคับซ้ำอีกชั้น */}
                {r.status === 'pending' && (
                  <div className="acts">
                    <button className="btn ghost sm" disabled={busy} onClick={() => startEdit(r)}>
                      <Pencil size={13} /> แก้ไข
                    </button>
                    <button className="btn ghost sm" disabled={busy} onClick={() => void cancel(r.id)}>
                      <X size={13} /> ยกเลิกใบนี้
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
