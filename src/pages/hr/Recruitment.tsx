// src/pages/hr/Recruitment.tsx
//
// ใบสมัครงาน — สายตั้งแต่รับใบจนกลายเป็นแฟ้มพนักงาน (CEO/HR)
//
// ใบสมัครถูกเขียนโดยฟอร์ม /careers ของเว็บลูกค้าที่โหนดเดิม **ข้อมูลไม่ได้ย้าย**
// สิ่งที่ย้ายมาคือการตัดสินใจจ้าง ซึ่งเป็นงานของ HR และเป็นที่ที่ทะเบียนพนักงานอยู่
//
// **สองอย่างที่หน้านี้ทำแล้วหน้าเดิมทำไม่ได้:**
//   1. มีขั้น "ยื่นข้อเสนอ" แยกจาก "เขาตอบรับ" — ระหว่างสองอันนี้คือช่วงที่ HR
//      ต้องรู้ว่ารออะไรอยู่ ยุบรวมเมื่อไหร่ ใบที่ยื่นไปแล้วเงียบกับใบที่ตกลง
//      แล้วรอเริ่มงานจะหน้าตาเหมือนกัน
//   2. กดจ้างแล้ว **กลายเป็นแฟ้มพนักงานจริง** ไม่ใช่จบที่คำว่า "ผ่าน"
//
// ปุ่มสถานะ render จาก `next` ที่ server ส่งมา ไม่ใช่ลิสต์ที่ hardcode ไว้ที่นี่
// — เครื่องสถานะมีสำเนาเดียวและอยู่ฝั่ง server
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  Briefcase, RefreshCw, FileText, UserPlus, Phone, Mail, X, Clock, AlertTriangle,
  Trash2, StickyNote,
} from 'lucide-react';
import { thaiDate } from './hrFormat';

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async <T,>(name: string, data: Record<string, unknown>): Promise<T> => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as T;
};

interface HistoryRow { from: string; to: string; at: number; by_name: string | null; note: string | null }
interface Application {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  position_title: string | null;
  experience: string | null;
  introduction: string | null;
  resume_url: string | null;
  created_at: number | null;
  status: string;
  stage_label: string;
  next: string[];
  employee_id: string | null;
  hired_at: number | null;
  stage_history: HistoryRow[];
  offer_note: string | null;
  admin_note: string | null;
  can_delete: boolean;
}
interface StageMeta { label: string; tone: string; terminal?: boolean; legacy?: boolean }
interface ListResult {
  applications: Application[];
  summary: { total: number; open: number; untouched: number; counts: Record<string, number> };
  stages: Record<string, StageMeta>;
  capped: boolean;
  moved_notes: number;
}

const TONE: Record<string, string> = {
  red: 'bg-red-100 text-red-700 border-red-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  violet: 'bg-violet-100 text-violet-700 border-violet-200',
  teal: 'bg-teal-100 text-teal-700 border-teal-200',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  gray: 'bg-gray-100 text-gray-500 border-gray-200',
};

export const Recruitment: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('open');
  const [hireFor, setHireFor] = useState<Application | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call<ListResult>('adminHrApplicationList', {}));
    } catch (e) {
      setData(null);
      toast.error(e instanceof Error ? e.message : 'โหลดใบสมัครไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const stages = data?.stages || {};
  const meta = (s: string): StageMeta => stages[s] || { label: s, tone: 'gray' };

  const move = async (row: Application, to: string) => {
    // ขอเหตุผล/เงื่อนไขเฉพาะตอนยื่นข้อเสนอ — ตอนกดจ้างจะได้ไม่ต้องนึกเอาเอง
    // ว่าตกลงอะไรกันไว้
    let note: string | null = null;
    if (to === 'offer') {
      note = window.prompt('เงื่อนไขที่เสนอ (เงินเดือน/วันเริ่มงาน — บันทึกไว้บนใบ):', '');
      if (note === null) return;
    }
    setBusy(row.id);
    try {
      await call('adminHrApplicationSetStage', { applicationId: row.id, stage: to, note });
      toast.success(`ย้ายไป "${meta(to).label}" แล้ว`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const remove = async (row: Application) => {
    // ลบแล้วเรียกคืนไม่ได้ และมันลบไฟล์เรซูเม่ใน Storage ไปด้วย — ต้องพิมพ์
    // ยืนยัน ไม่ใช่กดครั้งเดียวจบ (ปุ่มอยู่ในแผงที่กางออกมาแล้วเท่านั้น)
    const typed = window.prompt(
      `ลบใบสมัครของ "${row.full_name || 'ไม่ระบุชื่อ'}" ถาวร พร้อมไฟล์เรซูเม่\nพิมพ์ ลบ เพื่อยืนยัน:`,
      '',
    );
    if (typed === null) return;
    if (typed.trim() !== 'ลบ') { toast.error('ยกเลิกแล้ว — ข้อความยืนยันไม่ตรง'); return; }
    setBusy(row.id);
    try {
      const res = await call<{ resumeDeleted: boolean }>('adminHrApplicationDelete', { applicationId: row.id });
      toast.success(res.resumeDeleted ? 'ลบใบสมัครและไฟล์เรซูเม่แล้ว' : 'ลบใบสมัครแล้ว (ใบนี้ไม่มีไฟล์แนบ)');
      setOpenId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ลบไม่สำเร็จ');
    } finally { setBusy(''); }
  };

  const visible = useMemo(() => {
    const list = data?.applications || [];
    if (filter === 'all') return list;
    if (filter === 'open') return list.filter((a) => !meta(a.status).terminal);
    return list.filter((a) => a.status === filter);
  }, [data, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Briefcase className="text-rose-500" /> ใบสมัครงาน
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            ใหม่ → ตรวจสอบ → สัมภาษณ์ → ยื่นข้อเสนอ → ตอบรับ → จ้าง
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white font-bold text-gray-600">
            <option value="open">ที่ยังดำเนินอยู่</option>
            <option value="all">ทั้งหมด</option>
            {Object.entries(stages).map(([id, m]) => (
              <option key={id} value={id}>{m.label} ({data?.summary.counts[id] ?? 0})</option>
            ))}
          </select>
          <button onClick={() => void load()} disabled={loading}
            className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
          </button>
        </div>
      </div>

      {data && data.summary.untouched > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-[13px] text-red-900 flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            มีใบสมัครที่ยังไม่ได้ดำเนินการ <b>{data.summary.untouched} ใบ</b> —
            ระบบไม่ได้บันทึกว่ามีใครเปิดอ่านหรือยัง นับจากสถานะที่ยังเป็น &quot;ใหม่&quot; เท่านั้น
            และ<b>ยังไม่มีการแจ้งเตือนเมื่อมีใบสมัครใหม่</b> ต้องเข้ามาดูเองที่หน้านี้
          </p>
        </div>
      )}

      {data?.capped && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          แสดงเฉพาะใบล่าสุดเท่าที่เพดานอนุญาต — ใบเก่ากว่านั้นไม่ได้อยู่ในรายการนี้
        </p>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading && <p className="p-6 text-sm text-gray-400">กำลังโหลด...</p>}
        {!loading && !visible.length && (
          <p className="p-6 text-sm text-gray-400">ไม่มีใบสมัครในหมวดนี้</p>
        )}
        <div className="divide-y divide-gray-50">
          {visible.map((row) => {
            const m = meta(row.status);
            return (
              <div key={row.id} className="px-5 py-4">
                <div className="flex items-start gap-4 flex-wrap">
                  <button onClick={() => setOpenId(openId === row.id ? null : row.id)}
                    className="flex-1 min-w-[240px] text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">{row.full_name || '(ไม่ระบุชื่อ)'}</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${TONE[m.tone] || TONE.gray}`}>
                        {m.label}
                      </span>
                      {row.employee_id && (
                        <span className="text-[11px] font-bold text-emerald-700">มีแฟ้มพนักงานแล้ว</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {row.position_title || 'ไม่ระบุตำแหน่ง'} · สมัครเมื่อ {thaiDate(row.created_at)}
                    </p>
                  </button>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {row.next.map((to) => (
                      <button key={to} onClick={() => void move(row, to)} disabled={busy === row.id}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-600 disabled:opacity-50">
                        {meta(to).label}
                      </button>
                    ))}
                    {row.status === 'accepted' && !row.employee_id && (
                      <button onClick={() => setHireFor(row)} disabled={busy === row.id}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                        <UserPlus size={13} /> สร้างแฟ้มพนักงาน
                      </button>
                    )}
                  </div>
                </div>

                {openId === row.id && (
                  <div className="mt-3 bg-gray-50 rounded-xl p-4 text-sm space-y-2">
                    <div className="flex gap-4 flex-wrap text-xs text-gray-600">
                      {row.phone && <span className="flex items-center gap-1"><Phone size={12} /> {row.phone}</span>}
                      {row.email && <span className="flex items-center gap-1"><Mail size={12} /> {row.email}</span>}
                      {row.resume_url && (
                        <a href={row.resume_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 font-bold hover:underline">
                          <FileText size={12} /> เปิดเรซูเม่
                        </a>
                      )}
                    </div>
                    {row.experience && <p className="text-gray-700"><b className="text-gray-500">ประสบการณ์:</b> {row.experience}</p>}
                    {row.introduction && <p className="text-gray-700"><b className="text-gray-500">แนะนำตัว:</b> {row.introduction}</p>}
                    {row.offer_note && (
                      <p className="text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                        <b>เงื่อนไขที่เสนอ:</b> {row.offer_note}
                      </p>
                    )}
                    <NoteEditor row={row} onSaved={load} />
                    {row.stage_history.length > 0 && (
                      <div className="pt-1">
                        <p className="text-xs font-bold text-gray-500 flex items-center gap-1"><Clock size={12} /> ประวัติ</p>
                        <ul className="mt-1 space-y-0.5">
                          {row.stage_history.slice().reverse().map((h, i) => (
                            <li key={i} className="text-[11px] text-gray-500">
                              {thaiDate(h.at)} · {meta(h.from).label} → {meta(h.to).label}
                              {h.by_name ? ` โดย ${h.by_name}` : ''}{h.note ? ` — ${h.note}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="pt-2 border-t border-gray-200/70">
                      {row.can_delete ? (
                        <button onClick={() => void remove(row)} disabled={busy === row.id}
                          className="text-[11px] font-bold text-red-400 hover:text-red-600 inline-flex items-center gap-1 disabled:opacity-50">
                          <Trash2 size={12} /> ลบใบสมัครนี้ถาวร (พร้อมไฟล์เรซูเม่)
                        </button>
                      ) : (
                        <p className="text-[11px] text-gray-400">
                          ใบนี้กลายเป็นแฟ้มพนักงานแล้ว ลบไม่ได้ — เอกสารที่บอกว่าคนคนนี้ถูกจ้างมาอย่างไรต้องอยู่ต่อ
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {hireFor && (
        <HireModal application={hireFor} onClose={() => setHireFor(null)}
          onDone={async () => { setHireFor(null); await load(); }} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// โน้ต HR
//
// **โน้ตไม่ได้อยู่บนแถวใบสมัคร** — กฎของ `job_applications/$appId` ให้เจ้าของใบ
// อ่านใบตัวเองได้ ทุกฟิลด์บนแถวนั้นจึงเป็นของที่ผู้สมัครอ่านได้ ไม่ใช่แค่ที่
// หน้าเว็บเลือกแสดง โน้ตจึงเก็บที่ `job_application_notes/{id}` ซึ่งอ่านได้
// เฉพาะฝั่ง server (หน้าเดิมฝั่งเว็บลูกค้าเขียนโน้ตลงบนแถวตรงๆ มาตลอด)
// ---------------------------------------------------------------------------
const NoteEditor: React.FC<{ row: Application; onSaved: () => Promise<void> }> = ({ row, onSaved }) => {
  const toast = useToast();
  const [text, setText] = useState(row.admin_note || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(row.admin_note || ''); }, [row.id, row.admin_note]);

  const dirty = text.trim() !== (row.admin_note || '').trim();

  const save = async () => {
    setBusy(true);
    try {
      await call('adminHrApplicationNote', { applicationId: row.id, note: text });
      toast.success('บันทึกโน้ตแล้ว');
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกโน้ตไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  return (
    <div className="pt-1">
      <p className="text-xs font-bold text-gray-500 flex items-center gap-1">
        <StickyNote size={12} /> โน้ต HR
        <span className="font-normal text-gray-400">— ผู้สมัครไม่เห็นข้อความนี้</span>
      </p>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
        placeholder="บันทึกสำหรับผู้สมัครคนนี้..."
        className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 resize-none bg-white" />
      <button onClick={() => void save()} disabled={busy || !dirty}
        className="mt-1 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold disabled:opacity-40">
        บันทึกโน้ต
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// โมดอลสร้างแฟ้มพนักงาน
//
// **ใบสมัครไม่มีวันเริ่มงาน ประเภทการจ้าง หรือเงินเดือน** — สามอย่างนี้ตกลงกัน
// ตอนยื่นข้อเสนอ ระบบจึงถามตรงนี้แทนที่จะเดาให้ ค่าที่เดาให้แล้วไม่มีใครตรวจ
// คือค่าที่จะไปโผล่ในรอบจ่ายเงินเดือนรอบแรก
// ---------------------------------------------------------------------------
const HireModal: React.FC<{ application: Application; onClose: () => void; onDone: () => Promise<void> }> =
({ application, onClose, onDone }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: application.full_name || '',
    position: application.position_title || '',
    employment_type: 'monthly',
    hired_at: new Date().toISOString().slice(0, 10),
    base_salary: '',
    national_id: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      const res = await call<{ employeeCode: string; accountIssued: boolean }>('adminHrApplicationHire', {
        applicationId: application.id,
        profile: {
          name: form.name.trim(),
          position: form.position.trim() || null,
          phone: application.phone,
          email: application.email,
          employment_type: form.employment_type,
          hired_at: new Date(`${form.hired_at}T00:00:00+07:00`).getTime(),
        },
        private: {
          national_id: form.national_id.trim() || null,
          phone: application.phone,
          email: application.email,
          pay: form.base_salary ? { base_salary: Number(form.base_salary) } : {},
        },
      });
      toast.success(`สร้างแฟ้มพนักงานแล้ว รหัส ${res.employeeCode}`);
      // บอกตรงๆ ว่ายังเข้าระบบไม่ได้ — ไม่ปล่อยให้เข้าใจว่าจ้างแล้วจบ
      if (!res.accountIssued) {
        toast.error('ยังไม่มีบัญชีเข้าระบบ — ให้ CEO ออกบัญชีที่หน้าจัดการพนักงาน แล้วผูกเข้าแฟ้มที่ทะเบียน');
      }
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'สร้างแฟ้มพนักงานไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const field = (k: string, label: string, type = 'text', hint?: string) => (
    <label className="block text-xs font-bold text-gray-500">
      {label}
      <input type={type} value={(form as Record<string, string>)[k]} onChange={(e) => set(k, e.target.value)}
        className="mt-1 block w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-normal text-gray-800" />
      {hint && <span className="block mt-0.5 text-[11px] font-normal text-gray-400">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-black text-gray-800">สร้างแฟ้มพนักงานจากใบสมัคร</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
          ชื่อ/เบอร์/อีเมล/ตำแหน่ง มาจากใบสมัคร ส่วน <b>วันเริ่มงาน ประเภทการจ้าง และเงินเดือน</b>
          เป็นสิ่งที่ตกลงกันตอนยื่นข้อเสนอ ไม่ได้อยู่ในใบสมัคร — กรอกเอง
          {application.offer_note && <> · เงื่อนไขที่เสนอไว้: <b>{application.offer_note}</b></>}
        </p>
        {field('name', 'ชื่อ-สกุล')}
        {field('position', 'ตำแหน่ง')}
        <label className="block text-xs font-bold text-gray-500">
          ประเภทการจ้าง
          <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}
            className="mt-1 block w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-normal bg-white">
            <option value="monthly">รายเดือน</option>
            <option value="daily">รายวัน</option>
          </select>
        </label>
        {field('hired_at', 'วันเริ่มงาน', 'date')}
        {field('base_salary', 'เงินเดือน (บาท)', 'number', 'เว้นว่างได้ แล้วไปตั้งทีหลังที่ทะเบียน — แต่รอบเงินเดือนจะขึ้นว่ากรอกไม่ครบ')}
        {field('national_id', 'เลขบัตรประชาชน', 'text', 'เว้นว่างได้ แต่ต้องมีก่อนออกหนังสือรับรองหัก ณ ที่จ่าย')}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={busy || !form.name.trim()}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
            สร้างแฟ้มพนักงาน
          </button>
        </div>
      </div>
    </div>
  );
};
