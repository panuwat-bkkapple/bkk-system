// กะ ตารางเวร และการลงเวลา (CEO/HR)
//
// หน้านี้เป็น **ฝั่งแอดมิน** ของแอปพนักงาน (`employee-app/`) — พนักงานลงเวลา
// ในแอป ส่วนที่นี่คือที่ที่กะถูกนิยาม เวรถูกจัด และผลถูกอ่าน
//
// **กติกาไม่ได้อยู่ที่นี่** — สาย/ออกก่อน/อยู่ในรัศมีไหม เป็นของ
// `functions/hr-attendance.js` ทั้งหมด หน้านี้แค่ตั้งค่าและแสดงผล

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ref, update } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Clock, CalendarRange, MapPin, Plus, Trash2, Save, RefreshCw, Loader2 } from 'lucide-react';
import { app, db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  toTime, shiftDraftErrors, shiftsPayload, weekDates, dowOf, rosterDiff,
  attendanceFlags, type ShiftDraft,
} from './shiftsView';

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async <T,>(name: string, data?: unknown): Promise<T> =>
  (await httpsCallable(fns(), name)(data ?? {})).data as T;

const todayIso = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

interface ShiftRow { id: string; label: string; start: number; end: number; grace_min: number; break_min: number }
interface RosterEmployee { id: string; name: string | null; employee_code: string | null; status: string | null; default_shift_id: string | null }
interface RosterRes {
  from: string; to: string;
  roster: Record<string, Record<string, string | null>>;
  shifts: ShiftRow[];
  dropped_shifts: { id: string; reason: string }[];
  employees: RosterEmployee[];
  capped: boolean;
}
interface AttendanceRow {
  employee_id: string; date: string; shift_label: string | null;
  in_at: number | null; out_at: number | null; worked_min: number | null;
  late_min: number | null; within_grace: boolean | null; early_min: number | null;
  out_outside: boolean | null; no_shift: boolean; status: string;
  in_site_name: string | null; in_distance_m: number | null;
}
interface AttendanceRes {
  from: string; to: string; rows: AttendanceRow[];
  names: Record<string, { name: string | null; employee_code: string | null }>;
  capped: boolean; employees_scanned: number;
}

const TONE: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  warn: 'bg-amber-50 text-amber-700 border-amber-100',
  bad: 'bg-rose-50 text-rose-700 border-rose-100',
  grey: 'bg-gray-50 text-gray-500 border-gray-200',
};

const clock = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-');

export default function Shifts() {
  const toast = useToast();
  const [tab, setTab] = useState<'roster' | 'shifts' | 'log'>('roster');
  const [anchor, setAnchor] = useState(todayIso());
  const [roster, setRoster] = useState<RosterRes | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, string | null>>>({});
  const [drafts, setDrafts] = useState<ShiftDraft[]>([]);
  const [radius, setRadius] = useState('150');
  const [minAcc, setMinAcc] = useState('200');
  const [log, setLog] = useState<AttendanceRes | null>(null);
  const [logDate, setLogDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const week = useMemo(() => weekDates(anchor), [anchor]);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    try {
      const days = weekDates(anchor);
      const res = await call<RosterRes>('adminHrRosterGet', { from: days[0], to: days[6] });
      setRoster(res);
      setEdits({});
      setDrafts(res.shifts.map((s) => ({
        id: s.id, label: s.label, start: toTime(s.start), end: toTime(s.end),
        break_min: String(s.break_min), grace_min: String(s.grace_min), active: true,
      })));
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'โหลดตารางเวรไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [anchor, toast]);

  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const loadLog = useCallback(async () => {
    try {
      setLog(await call<AttendanceRes>('adminHrAttendanceList', { from: logDate, to: logDate }));
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'โหลดข้อมูลลงเวลาไม่สำเร็จ');
    }
  }, [logDate, toast]);

  useEffect(() => { if (tab === 'log') void loadLog(); }, [tab, loadLog]);

  const cellValue = (empId: string, iso: string): string | null => {
    const e = edits[empId];
    if (e && Object.prototype.hasOwnProperty.call(e, iso)) return e[iso];
    return roster?.roster?.[empId]?.[iso] ?? null;
  };

  const setCell = (empId: string, iso: string, v: string) => {
    setEdits((p) => ({ ...p, [empId]: { ...(p[empId] || {}), [iso]: v || null } }));
  };

  const saveRoster = async () => {
    setSaving(true);
    try {
      let n = 0;
      for (const [empId, days] of Object.entries(edits)) {
        // ส่งเฉพาะเซลล์ที่เปลี่ยนจริง — เปิดหน้าแล้วกดบันทึกเฉยๆ ต้องไม่เขียน
        // ทับเวรที่คนอื่นเพิ่งแก้
        const diff = rosterDiff(roster?.roster?.[empId] || {}, days);
        if (!Object.keys(diff).length) continue;
        await call('adminHrRosterSet', { employeeId: empId, dates: diff });
        n += Object.keys(diff).length;
      }
      toast.success(n ? `บันทึกตารางเวร ${n} วัน` : 'ไม่มีอะไรเปลี่ยน');
      await loadRoster();
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  const saveShifts = async () => {
    const errs = shiftDraftErrors(drafts);
    if (errs.length) { toast.error(errs[0]); return; }
    setSaving(true);
    try {
      // **`update()` รายคีย์เท่านั้น ห้าม `set()` ที่ `settings/hr`** — โหนดนี้
      // ถือค่าภาษี/ประกันสังคม/สิทธิ์ลาของทั้งระบบ (กฎเดิมในหัว HrSettings.tsx)
      await update(ref(db, 'settings/hr'), {
        shifts: shiftsPayload(drafts),
        attendance: {
          radius_m: Number(radius) || 150,
          min_accuracy_m: Number(minAcc) || 200,
        },
      });
      toast.success('บันทึกกะแล้ว');
      await loadRoster();
    } catch (e) {
      toast.error((e as { message?: string })?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-black text-gray-800 flex items-center gap-2">
            <Clock size={18} /> กะและตารางเวร
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            พนักงานลงเวลาผ่านแอปพนักงาน (ต้องเปิด GPS) — หน้านี้คือที่ที่กะถูกนิยาม เวรถูกจัด และผลถูกอ่าน
          </p>
        </div>
        <button onClick={() => void loadRoster()} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
        </button>
      </div>

      <div className="flex gap-1.5">
        {([['roster', 'ตารางเวร'], ['shifts', 'กะและรัศมี'], ['log', 'การลงเวลา']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold border ${
              tab === id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {roster && roster.dropped_shifts.length > 0 && (
        // กะที่ server ตัดทิ้งต้องขึ้นบนหน้า ไม่ใช่หายไปเฉยๆ
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          กะที่ตั้งค่าไว้ผิดและถูกข้าม: {roster.dropped_shifts.map((d) => `${d.id} (${d.reason})`).join(' · ')}
        </div>
      )}

      {tab === 'roster' && (
        <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange size={14} className="text-gray-500" />
            <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
            <span className="text-[11px] text-gray-500">{week[0]} - {week[6]}</span>
            <button onClick={() => void saveRoster()} disabled={saving || !Object.keys(edits).length}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} บันทึกตารางเวร
            </button>
          </div>

          {roster?.capped && (
            <div className="text-[11px] text-amber-700">แสดงพนักงานได้บางส่วนเท่านั้น</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500">
                  <th className="text-left font-bold py-1.5 pr-2 min-w-[150px]">พนักงาน</th>
                  {week.map((iso) => (
                    <th key={iso} className="font-bold px-1 py-1.5 whitespace-nowrap">
                      {dowOf(iso)} <span className="font-normal text-gray-400">{iso.slice(8)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(roster?.employees || [])
                  .filter((e) => !['resigned', 'terminated'].includes(String(e.status || '')))
                  .map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="py-1.5 pr-2">
                        <div className="font-bold text-gray-800">{e.name || e.id}</div>
                        <div className="text-[10px] text-gray-400">
                          {e.employee_code || '-'}
                          {e.default_shift_id ? ` · ประจำ ${e.default_shift_id}` : ' · ไม่มีกะประจำ'}
                        </div>
                      </td>
                      {week.map((iso) => (
                        <td key={iso} className="px-0.5 py-1">
                          <select value={cellValue(e.id, iso) || ''} onChange={(ev) => setCell(e.id, iso, ev.target.value)}
                            className="w-full rounded-md border border-gray-200 px-1 py-1 text-[11px] bg-white">
                            <option value="">-</option>
                            {(roster?.shifts || []).map((s) => (
                              <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">
            ช่อง &quot;-&quot; = ใช้กะประจำตัวของคนนั้น (ตั้งในแฟ้มพนักงาน) ไม่ใช่ &quot;ไม่ต้องมาทำงาน&quot;
          </p>
        </div>
      )}

      {tab === 'shifts' && (
        <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-3">
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 items-end border-b border-gray-100 pb-2">
                <label className="block"><span className="text-[10px] font-bold text-gray-500">รหัส</span>
                  <input value={d.id} onChange={(e) => setDrafts((p) => p.map((x, j) => j === i ? { ...x, id: e.target.value } : x))}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500">ชื่อกะ</span>
                  <input value={d.label} onChange={(e) => setDrafts((p) => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500">เข้า</span>
                  <input type="time" value={d.start} onChange={(e) => setDrafts((p) => p.map((x, j) => j === i ? { ...x, start: e.target.value } : x))}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500">ออก</span>
                  <input type="time" value={d.end} onChange={(e) => setDrafts((p) => p.map((x, j) => j === i ? { ...x, end: e.target.value } : x))}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500">พัก (น.)</span>
                  <input type="number" value={d.break_min} onChange={(e) => setDrafts((p) => p.map((x, j) => j === i ? { ...x, break_min: e.target.value } : x))}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
                <label className="block"><span className="text-[10px] font-bold text-gray-500">ผ่อนผัน (น.)</span>
                  <input type="number" value={d.grace_min} onChange={(e) => setDrafts((p) => p.map((x, j) => j === i ? { ...x, grace_min: e.target.value } : x))}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
                <button onClick={() => setDrafts((p) => p.filter((_, j) => j !== i))}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-rose-600">
                  <Trash2 size={12} /> ลบ
                </button>
              </div>
            ))}
            <button onClick={() => setDrafts((p) => [...p, { id: '', label: '', start: '08:00', end: '17:00', break_min: '60', grace_min: '15', active: true }])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700">
              <Plus size={13} /> เพิ่มกะ
            </button>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-black text-gray-700 flex items-center gap-1.5"><MapPin size={13} /> รัศมีการลงเวลา</p>
            <div className="grid grid-cols-2 gap-2 mt-2 max-w-md">
              <label className="block"><span className="text-[10px] font-bold text-gray-500">รัศมีรอบสาขา (ม.)</span>
                <input type="number" value={radius} onChange={(e) => setRadius(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
              <label className="block"><span className="text-[10px] font-bold text-gray-500">ความคลาดเคลื่อนสูงสุด (ม.)</span>
                <input type="number" value={minAcc} onChange={(e) => setMinAcc(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" /></label>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              พิกัดสาขามาจากหน้าจัดการสาขา — สาขาที่ไม่ได้ปักหมุดจะใช้ลงเวลาไม่ได้
            </p>
          </div>

          <button onClick={() => void saveShifts()} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} บันทึกกะและรัศมี
          </button>
        </div>
      )}

      {tab === 'log' && (
        <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
            <span className="text-[11px] text-gray-500">
              {log ? `${log.rows.length} รายการ · ตรวจ ${log.employees_scanned} คน` : ''}
            </span>
          </div>
          {log?.capped && <div className="text-[11px] text-amber-700">ตรวจได้บางส่วนเท่านั้น</div>}
          {(log?.rows || []).length === 0 ? (
            <p className="text-[11px] text-gray-400">ยังไม่มีการลงเวลาในวันนี้</p>
          ) : (
            <div className="space-y-1.5">
              {(log?.rows || []).map((r) => (
                <div key={`${r.employee_id}-${r.date}`} className="rounded-lg border border-gray-100 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-800">
                      {log?.names?.[r.employee_id]?.name || r.employee_id}
                      <span className="text-gray-400 font-normal"> · {r.shift_label || 'ไม่มีกะ'}</span>
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {clock(r.in_at)} - {clock(r.out_at)}
                      {r.in_site_name ? ` · ${r.in_site_name}` : ''}
                      {r.in_distance_m !== null ? ` (${r.in_distance_m} ม.)` : ''}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {attendanceFlags(r).map((f, i) => (
                      <span key={i} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TONE[f.tone]}`}>
                        {f.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
