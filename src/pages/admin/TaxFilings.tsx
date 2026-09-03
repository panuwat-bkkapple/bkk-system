// ปฏิทินกำหนดยื่นแบบ — ค้างอะไร เท่าไหร่ ถึงเมื่อไหร่ (CEO / FINANCE)
//
// **หน้านี้ไม่ได้แก้ปัญหา "ไม่รู้ว่าต้องยื่นอะไร" — มันแก้ "ไม่รู้ว่ายื่นไปแล้ว
// หรือยัง"** ระบบออกเลขที่เอกสารและรู้ยอดทุกก้อนอยู่แล้ว (ภ.ง.ด.1 จากรอบ
// เงินเดือน · ภ.ง.ด.3 จาก 50 ทวิ ของไรเดอร์ · ภ.พ.30 จากทะเบียนใบกำกับ) สิ่งที่
// ไม่เคยมีคือที่ที่บอกว่าเดือนนี้ค้างอะไร เงินที่หักไว้ไม่ใช่ของบริษัท มันนอน
// อยู่ในบัญชีจนกว่าจะมีคนจำได้ว่าต้องนำส่ง — ยื่นช้า = เบี้ยปรับ + เงินเพิ่ม
//
// **ปุ่ม "ยื่นแล้ว" เป็นส่วนสำคัญของหน้า ไม่ใช่ของประดับ** ตัวเตือนที่รับทราบ
// ไม่ได้จะขึ้นแดงซ้ำทุกวันจนคนเลิกอ่านทั้งหน้า แล้วก็จะพลาดตัวที่ค้างจริงพอดี
//
// **สิ่งที่หน้านี้จงใจไม่ทำ:** ไม่เลื่อนวันเมื่อกำหนดตรงกับวันหยุด (ปฏิทิน
// ราชการไม่ได้อยู่ในระบบ เดาแล้วเลื่อนช้ากว่าจริง = ทำให้ยื่นสาย) และไม่รู้
// เรื่องการขยายเวลาของการยื่นออนไลน์ — วันที่ที่แสดงเป็นวันตามกฎหมาย ซึ่ง
// เร็วกว่าหรือเท่ากับกำหนดจริงเสมอ
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { CalendarClock, RefreshCw, AlertTriangle, CheckCircle2, Undo2, Info } from 'lucide-react';

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async <T,>(name: string, data: Record<string, unknown>): Promise<T> => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as T;
};

type Status = 'filed' | 'overdue' | 'due_soon' | 'upcoming' | 'not_required' | 'unknown';

interface Row {
  key: string;
  form: string;
  period: string;
  label: string;
  detail: string;
  authority: string;
  amount: number;
  note: string | null;
  required: boolean;
  deadline: number | null;
  filed: { at: number | null; by: string | null; reference: string | null } | null;
  status: Status;
}

const baht = (n: number) =>
  (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '-';

const periodLabel = (p: string) => {
  if (p.length === 4) return `ปีภาษี ${Number(p) + 543}`;
  const y = Number(p.slice(0, 4)) + 543;
  const m = Number(p.slice(4, 6));
  return `${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m - 1]} ${y}`;
};

const STATUS_UI: Record<Status, { label: string; cls: string }> = {
  overdue: { label: 'เลยกำหนด', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  due_soon: { label: 'ใกล้ครบกำหนด', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  upcoming: { label: 'ยังไม่ถึงกำหนด', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  filed: { label: 'ยื่นแล้ว', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  not_required: { label: 'ไม่ต้องยื่น', cls: 'bg-gray-50 text-gray-400 border-gray-200' },
  unknown: { label: 'ไม่ทราบกำหนด', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

export const TaxFilings: React.FC = () => {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<{ rows: Row[] }>('adminTaxFilingCalendar', { months: 6 });
      setRows(res.rows || []);
    } catch (e) {
      setRows([]);
      toast.error(e instanceof Error ? e.message : 'โหลดปฏิทินยื่นแบบไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const mark = async (row: Row, filed: boolean) => {
    let reference: string | null = null;
    if (filed) {
      // เลขที่อ้างอิงไม่บังคับ — บังคับเมื่อไหร่คนจะกรอกขยะลงไปเพื่อให้ปุ่มทำงาน
      reference = window.prompt(`ยื่น ${row.label} งวด ${periodLabel(row.period)} แล้ว\nเลขที่อ้างอิง/เลขรับ (ไม่ใส่ก็ได้):`, '');
      if (reference === null) return;
    } else if (!window.confirm(`ยกเลิกการทำเครื่องหมาย "ยื่นแล้ว" ของ ${row.label} งวด ${periodLabel(row.period)}?`)) {
      return;
    }
    setBusy(row.key);
    try {
      await call('adminTaxFilingMark', { form: row.form, period: row.period, filed, reference });
      toast.success(filed ? 'บันทึกว่ายื่นแล้ว' : 'ยกเลิกการทำเครื่องหมายแล้ว');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const overdue = useMemo(() => rows.filter((r) => r.status === 'overdue'), [rows]);
  const dueSoon = useMemo(() => rows.filter((r) => r.status === 'due_soon'), [rows]);
  const visible = useMemo(
    () => rows.filter((r) => showDone || (r.status !== 'filed' && r.status !== 'not_required')),
    [rows, showDone]
  );

  const byPeriod = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of visible) map.set(r.period, [...(map.get(r.period) || []), r]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <CalendarClock className="text-rose-500" /> กำหนดยื่นแบบ
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            ภ.ง.ด.1 · ภ.ง.ด.3 (วันที่ 7) · ประกันสังคม · ภ.พ.30 (วันที่ 15) · ภ.ง.ด.1ก (ภายใน ก.พ.)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300" /> แสดงที่ยื่นแล้ว/ไม่ต้องยื่น
          </label>
          <button onClick={() => void load()} disabled={loading}
            className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
          </button>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-[13px] text-rose-900 flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">เลยกำหนดยื่น {overdue.length} รายการ</p>
            <p className="mt-1">{overdue.map((r) => `${r.label} ${periodLabel(r.period)}`).join(' · ')}</p>
            <p className="mt-1">ยื่นช้ามีเบี้ยปรับและเงินเพิ่ม — ถ้ายื่นไปแล้วให้กด &quot;ยื่นแล้ว&quot; เพื่อไม่ให้ค้างอยู่ตรงนี้</p>
          </div>
        </div>
      )}

      {overdue.length === 0 && dueSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[13px] text-amber-900 flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p><b>ใกล้ครบกำหนด {dueSoon.length} รายการ</b> — {dueSoon.map((r) => `${r.label} ${periodLabel(r.period)} (${fmtDate(r.deadline)})`).join(' · ')}</p>
        </div>
      )}

      {loading && <p className="text-sm text-gray-400">กำลังโหลด...</p>}
      {!loading && byPeriod.length === 0 && (
        <p className="text-sm text-gray-400 bg-white border border-gray-100 rounded-2xl p-6">
          ไม่มีรายการค้างยื่น
        </p>
      )}

      {byPeriod.map(([period, list]) => (
        <div key={period} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="font-black text-gray-800">{periodLabel(period)}</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {list.map((r) => (
              <div key={r.key} className="px-5 py-3 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800">{r.label}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS_UI[r.status].cls}`}>
                      {STATUS_UI[r.status].label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{r.detail} · {r.authority}</p>
                  {r.note && <p className="text-[11px] text-gray-400 mt-0.5">{r.note}</p>}
                  {r.filed && (
                    <p className="text-[11px] text-emerald-600 mt-0.5">
                      ยื่นเมื่อ {fmtDate(r.filed.at)}{r.filed.by ? ` โดย ${r.filed.by}` : ''}
                      {r.filed.reference ? ` · อ้างอิง ${r.filed.reference}` : ''}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-black text-gray-800">{baht(r.amount)}</p>
                  <p className="text-[11px] text-gray-400">ภายใน {fmtDate(r.deadline)}</p>
                </div>
                <div className="w-[110px] text-right">
                  {r.status === 'not_required' ? (
                    <span className="text-[11px] text-gray-300">—</span>
                  ) : r.filed ? (
                    <button onClick={() => void mark(r, false)} disabled={busy === r.key}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                      <Undo2 size={13} /> ยกเลิก
                    </button>
                  ) : (
                    <button onClick={() => void mark(r, true)} disabled={busy === r.key}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                      <CheckCircle2 size={13} /> ยื่นแล้ว
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-[12px] text-blue-900 flex gap-2 leading-relaxed">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <p>
            วันที่ที่แสดงเป็น <b>กำหนดตามกฎหมาย</b> — หน้านี้ไม่เลื่อนวันให้เมื่อตรงกับวันหยุดราชการ
            และไม่รวมการขยายเวลาของการยื่นออนไลน์ เพราะปฏิทินวันหยุดไม่ได้อยู่ในระบบนี้
            การเดาแล้วเลื่อนให้ช้ากว่าจริงคือการทำให้ยื่นสาย <b>วันที่นี่จึงเร็วกว่าหรือเท่ากับกำหนดจริงเสมอ</b>
          </p>
          <p className="mt-1">
            ยอดมาจากรอบเงินเดือนที่ <b>จ่ายแล้ว</b> · 50 ทวิ ของไรเดอร์ · ทะเบียนใบกำกับภาษี —
            หน้านี้ไม่คิดเลขใหม่ และ <b>ไม่ได้ยื่นให้</b> เป็นตัวเตือนกับที่บันทึกว่ายื่นไปแล้วเท่านั้น
          </p>
        </div>
      </div>
    </div>
  );
};
