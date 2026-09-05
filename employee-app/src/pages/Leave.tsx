import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Loader2, X, Pencil, Save } from 'lucide-react';
import {
  call, errorText,
  type LeaveBalanceRow, type LeaveRequestRow, type LeaveTypeRow,
} from '../api';
import { thaiDateRange } from '../geo';
import { STATUS_LABEL, STATUS_TONE } from '../requestStatus';
import DateField from '../DateField';

interface ListRes {
  year: string;
  types: LeaveTypeRow[];
  balances: LeaveBalanceRow[];
  requests: LeaveRequestRow[];
}
interface PreviewRes {
  ok: boolean; errors: string[]; warnings: string[];
  days: number | null; paid_days: number | null; unpaid_days: number | null;
}

const EMPTY = { type: '', from: '', to: '', reason: '' };

/** ตัวเลขบนกล่องสิทธิ์ — สามสถานะที่ **ห้ามเขียนเป็น "0"** เหมือนกันหมด
 *  เพราะแต่ละอันแปลว่าคนละเรื่อง (ยังไม่ครบอายุงาน / ไม่มีเพดานตามกฎหมาย /
 *  ชนิดนี้ไม่ได้ค่าจ้างอยู่แล้ว) */
function balanceText(b: LeaveBalanceRow): { val: string; sub: string } {
  if (b.locked === 'service') return { val: '—', sub: 'ยังไม่ครบอายุงาน 1 ปี' };
  if (b.entitled_paid_days == null) return { val: '—', sub: 'ตามที่แพทย์กำหนด' };
  if (b.entitled_paid_days === 0) return { val: '—', sub: 'ลาได้ แต่ไม่ได้ค่าจ้าง' };
  return { val: String(b.remaining_paid_days ?? 0), sub: `จาก ${b.entitled_paid_days} วัน` };
}

export default function Leave() {
  const [data, setData] = useState<ListRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  // ใบที่กำลังแก้อยู่ — null = กำลังยื่นใบใหม่
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allBalances, setAllBalances] = useState(false);
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

  // ชนิดที่ยังไม่มีสิทธิ์และยังไม่เคยใช้ ไม่ต้องกินที่บนจอ
  const shown = (data?.balances || []).filter((b) => (
    (b.entitled_paid_days ?? 0) > 0 || b.entitled_paid_days == null
    || b.used_paid_days > 0 || b.used_unpaid_days > 0 || b.pending_days > 0
  ));
  const visible = allBalances ? shown : shown.slice(0, 3);

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      {shown.length > 0 && (
        <div className="section">
          <h2 style={{ justifyContent: 'space-between' }}>
            <span>สิทธิ์ลาที่ได้ค่าจ้าง ปี {data?.year}</span>
            {shown.length > 3 && (
              <button className="opt" style={{ padding: '4px 12px', fontSize: 12 }}
                onClick={() => setAllBalances((v) => !v)}>
                {allBalances ? 'ย่อ' : 'ดูทั้งหมด'}
              </button>
            )}
          </h2>
          <div className="grid3">
            {visible.map((b) => {
              const t = balanceText(b);
              return (
                <div className="tile" key={b.type}>
                  <div className="muted" style={{ fontSize: 11.5 }}>{b.label}</div>
                  {/* ชื่อชนิดลายาวไม่เท่ากัน ถ้าไม่ดันส่วนนี้ชิดล่าง ตัวเลขของแต่ละ
                      กล่องจะอยู่คนละระดับจนอ่านเทียบกันไม่ได้ (เห็นตอนวาดจริง) */}
                  <div className="btm">
                    <div className="num" style={{ fontSize: 21, marginTop: 6 }}>{t.val}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{t.sub}</div>
                    {b.pending_days > 0 && (
                      <div className="muted" style={{ fontSize: 11 }}>รออนุมัติ {b.pending_days} วัน</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* กันการอ่านผิดที่แพงที่สุดของหน้านี้ — เลขคือเพดานค่าจ้าง ไม่ใช่เพดานวันลา */}
          <div className="muted" style={{ marginTop: 8, padding: '0 2px' }}>
            ตัวเลขคือวันที่ยัง<b>ได้รับค่าจ้าง</b> — ลาป่วยตามกฎหมายลาได้ตามที่ป่วยจริง
            แม้เกินจำนวนนี้ แต่ส่วนที่เกินจะไม่ได้ค่าจ้าง
          </div>
        </div>
      )}

      <div className="section">
        <h2>
          {editingId ? <Pencil size={13} /> : <CalendarPlus size={13} />}
          {editingId ? 'แก้ใบลา' : 'ยื่นใบลา'}
        </h2>
        <div className="card">
          <form onSubmit={submit}>
            <label>ประเภทการลา</label>
            <div className="chips">
              {(data?.types || []).map((t) => (
                <button type="button" key={t.id} className="opt"
                  aria-pressed={form.type === t.id}
                  onClick={() => setForm({ ...form, type: t.id })}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* เริ่ม–ถึง เรียงข้างกันในการ์ดเดียว (ดีไซน์ 05) พร้อมแถบรวมวันลา
                ใต้มัน — ตัวเลขในแถบมาจาก `employeeLeavePreview` ซึ่งเป็นตัว
                คำนวณเดียวกับตอนบันทึกจริง ไม่ได้นับเองฝั่งหน้าจอ */}
            <label style={{ marginBottom: 8 }}>ช่วงวันที่ลา</label>
            <div className="datecard">
              <div className="half">
                <label htmlFor="lf">เริ่ม</label>
                <DateField id="lf" value={form.from} onChange={(v) => setForm({ ...form, from: v })} />
              </div>
              <div className="half">
                <label htmlFor="lto">ถึง</label>
                <DateField id="lto" value={form.to} onChange={(v) => setForm({ ...form, to: v })} />
              </div>
            </div>
            {preview?.ok && preview.days !== null && (
              <div className="totalrow">
                <span>รวมวันลา</span>
                <span className="num" style={{ fontSize: 17 }}>{preview.days} วัน</span>
              </div>
            )}

            <label htmlFor="lr">เหตุผล</label>
            <textarea id="lr" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />

            {preview && (
              <div className={`note ${preview.ok ? 'ok' : 'bad'}`} style={{ marginTop: 14, marginBottom: 0 }}>
                {preview.ok
                  ? <>ได้ค่าจ้าง {preview.paid_days} วัน · ไม่ได้ค่าจ้าง {preview.unpaid_days} วัน</>
                  : (preview.errors.join(' · ') || 'ยื่นใบนี้ไม่ได้')}
                {preview.warnings?.length > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>{preview.warnings.join(' · ')}</div>
                )}
              </div>
            )}

            <button className="btn" type="submit" disabled={busy || (preview ? !preview.ok : true)} style={{ marginTop: 16 }}>
              {busy ? <Loader2 size={17} className="spin" /> : editingId ? <Save size={17} /> : <CalendarPlus size={17} />}
              {editingId ? 'บันทึกการแก้ไข' : 'ส่งใบลา'}
            </button>
            {editingId && (
              <button className="btn ghost" type="button" disabled={busy} onClick={resetForm} style={{ marginTop: 10 }}>
                เลิกแก้ไข
              </button>
            )}
          </form>
        </div>
      </div>

      <div className="section">
        <h2>ใบลาของฉัน ปี {data?.year}</h2>
        {(data?.requests || []).length === 0 ? (
          <div className="card"><div className="muted">ยังไม่มีใบลาในปีนี้</div></div>
        ) : (
          <div className="list">
            {(data?.requests || []).map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{thaiDateRange(r.from, r.to)}</b>
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
