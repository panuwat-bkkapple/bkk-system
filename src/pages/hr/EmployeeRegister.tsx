// src/pages/hr/EmployeeRegister.tsx
//
// ทะเบียนพนักงาน — เฟส P1 ของ docs/hr-system-design.md
//
// หน้านี้อยู่ในระบบแอดมิน **ชั่วคราว** ปลายทางคือพอร์ทัล HR แยกโดเมน (P2)
// จึงตั้งใจไม่ผูกกับอะไรในแอดมินมากไปกว่า layout กับ toast
//
// ทุกการอ่านและเขียนผ่าน cloud functions (CEO/HR-gated ฝั่ง server, ดู
// functions/hr.js) — ไม่มี useDatabase เพราะ employees / employees_private /
// employee_events ยังไม่มี rule เป็นของตัวเอง จึงตกกฎ root .read:false ซึ่ง
// ถูกต้องแล้วสำหรับโหนดที่มีเลขบัตรประชาชนและเงินเดือนอยู่ข้างใน
//
// สิ่งที่หน้านี้ต้องพูดให้ตรงและห้ามตัดออก: **การตั้งสถานะเป็นพ้นสภาพยังไม่ได้
// ปิดบัญชีเข้าระบบ** (นั่นคือ P3) แถวที่พ้นสภาพแล้วแต่บัญชียังเปิดอยู่จึงขึ้น
// ป้ายเตือนสีแดงพร้อมบอกว่าต้องไปปิดที่ไหน — ระบบที่เขียนว่าพ้นสภาพแล้วเงียบ
// เรื่องบัญชีที่ยังใช้ได้ คือระบบที่ตอบผิดโดยไม่มีใครเห็น
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  Users, Plus, X, ShieldAlert, Link2, RefreshCw, Search, IdCard, Banknote, UserMinus, Pencil, Receipt,
  FileText, Printer, Ban, AlertTriangle,
} from 'lucide-react';

const fns = () => getFunctions(app, 'asia-southeast1');
interface StatusResult {
  ok: boolean;
  access: EmployeeAccess;
  nothing_to_close?: boolean;
  closed?: { staff: string | null; rider: string | null; errors: string[] };
}

const call = async <T,>(name: string, data: Record<string, unknown>): Promise<T> => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as T;
};

const EMPLOYMENT_TYPES = [
  { id: 'monthly', label: 'รายเดือน' },
  { id: 'daily', label: 'รายวัน' },
  { id: 'freelance', label: 'ฟรีแลนซ์ / จ้างทำของ' },
];

const STATUSES = [
  { id: 'probation', label: 'ทดลองงาน', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  { id: 'active', label: 'ทำงานอยู่', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { id: 'resigned', label: 'ลาออก', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  { id: 'terminated', label: 'พ้นสภาพ', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
];

interface EmployeeAccess {
  staff: { id: string; status: string; terminated: boolean; role: string | null } | null;
  rider: { id: string; approval_status: string } | null;
  open: boolean;
  stale_access: boolean;
}

// ต้องมีครบทุกฟิลด์ที่ `sanitizeEmployeePrivate` (functions/hr-core.js) รับ —
// ฟิลด์ที่ไม่ได้ประกาศที่นี่คือฟิลด์ที่ฟอร์มกรอกไม่ได้ ซึ่งเป็นที่มาของบั๊ก
// "ออกสัญญาจ้างไม่ได้เพราะไม่มีที่อยู่ และไม่มีช่องให้กรอกที่อยู่"
interface EmployeePrivate {
  national_id?: string | null;
  birth_date?: number | null;
  phone?: string | null;
  email?: string | null;
  line?: string | null;
  address?: string | null;
  tax_id?: string | null;
  social_security_no?: string | null;
  emergency_contact?: { name?: string | null; relation?: string | null; phone?: string | null } | null;
  bank?: { name?: string | null; account?: string | null; account_name?: string | null } | null;
  pay?: { base_salary?: number | null; daily_rate?: number | null } | null;
  /** ค่าลดหย่อนภาษี — เก็บเป็นจำนวน ไม่ใช่จำนวนเงิน (อัตราต่อหัวอยู่ที่ settings/hr) */
  tax?: { spouse?: boolean; children?: number; parents?: number; other?: number } | null;
}

interface EmployeeRow {
  id: string;
  employee_code?: string;
  name?: string;
  nickname?: string | null;
  position?: string | null;
  department?: string | null;
  branch?: string | null;
  employment_type?: string;
  status?: string;
  hired_at?: number | null;
  links?: { staff_id?: string | null; rider_id?: string | null };
  access: EmployeeAccess;
  private: EmployeePrivate | null;
}

interface UnlinkedAccount {
  id: string;
  kind: 'staff' | 'rider';
  name: string;
  email: string | null;
  role: string | null;
  status: string;
}

const thaiDate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

const money = (n?: number | null) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('th-TH') : '-';

// เลขบัตรประชาชนโชว์ 4 ตัวท้ายเท่านั้น รูปเดียวกับที่ใช้บนเอกสารบัญชี —
// คนที่ต้องการเลขเต็มคือคนที่กำลังยื่นภาษี ซึ่งเป็นเส้นทางของ P5 ไม่ใช่ตาราง
const maskId = (v?: string | null) => (v && v.length > 4 ? `••••${v.slice(-4)}` : v || '-');

export const EmployeeRegister = () => {
  const toast = useToast();
  const [items, setItems] = useState<EmployeeRow[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [formFor, setFormFor] = useState<{ mode: 'create' } | { mode: 'edit'; row: EmployeeRow } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<{ items: EmployeeRow[]; unlinked: UnlinkedAccount[] }>(
        'adminHrEmployeeList', {}
      );
      setItems(res.items || []);
      setUnlinked(res.unlinked || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดทะเบียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((e) =>
      [e.name, e.nickname, e.employee_code, e.position, e.department]
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [items, query]);

  const [docsFor, setDocsFor] = useState<EmployeeRow | null>(null);

  const staleCount = items.filter((e) => e.access?.stale_access).length;

  const setStatus = async (row: EmployeeRow, status: string) => {
    let reason: string | null = null;
    if (status === 'resigned' || status === 'terminated') {
      reason = window.prompt(`เหตุผลการ${status === 'resigned' ? 'ลาออก' : 'พ้นสภาพ'} ของ ${row.name}`);
      if (!reason) return;
    }
    setBusy(true);
    try {
      const res = await call<StatusResult>(
        'adminHrEmployeeSetStatus', { employeeId: row.id, status, reason }
      );
      const leaving = status === 'resigned' || status === 'terminated';
      if (leaving && res.closed?.errors?.length) {
        // ปิดไม่สำเร็จต้องดังกว่า "บันทึกแล้ว" — คนที่พ้นสภาพแล้วยังเข้าระบบได้
        // คือสิ่งเดียวที่งานนี้มีไว้กัน
        toast.error(`บันทึกสถานะแล้ว แต่ ${res.closed.errors.join(' · ')}`);
      } else if (leaving && res.access?.open) {
        toast.error('บันทึกสถานะแล้ว แต่บัญชีเข้าระบบยังเปิดอยู่ — ไปปิดที่หน้าพนักงาน/ไรเดอร์');
      } else if (leaving && res.nothing_to_close) {
        toast.success('บันทึกสถานะแล้ว (คนนี้ไม่มีบัญชีเข้าระบบผูกอยู่)');
      } else if (leaving) {
        const what = [
          res.closed?.staff === 'closed' ? 'บัญชีแอดมิน' : null,
          res.closed?.rider === 'closed' ? 'บัญชีไรเดอร์' : null,
        ].filter(Boolean);
        toast.success(what.length ? `บันทึกสถานะและปิด${what.join(' + ')}แล้ว` : 'บันทึกสถานะแล้ว');
      } else {
        toast.success('บันทึกสถานะแล้ว');
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const linkAccount = async (employeeId: string, acc: UnlinkedAccount) => {
    setBusy(true);
    try {
      await call('adminHrEmployeeLink', {
        employeeId,
        links: acc.kind === 'staff' ? { staff_id: acc.id } : { rider_id: acc.id },
      });
      toast.success('ผูกบัญชีเข้าทะเบียนแล้ว');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ผูกบัญชีไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Users className="text-rose-500" /> ทะเบียนพนักงาน
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            แฟ้มประวัติการจ้างของทุกคน รวมไรเดอร์ — ทะเบียนกลางที่บัญชีเข้าระบบชี้กลับมาหา
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
          <button onClick={() => setFormFor({ mode: 'create' })}
            className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 flex items-center gap-2">
            <Plus size={16} /> เพิ่มพนักงาน
          </button>
        </div>
      </div>

      {/* ความจริงที่ห้ามซ่อน: ทะเบียนยังไม่ได้คุมการเข้าถึง */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold flex items-center gap-2"><ShieldAlert size={16} /> ทะเบียนนี้ยังไม่ปิดบัญชีให้อัตโนมัติ</p>
        <p className="mt-1 leading-relaxed">
          การตั้งสถานะเป็นลาออก/พ้นสภาพที่นี่บันทึก <b>ประวัติการจ้าง</b> เท่านั้น
          การปิดบัญชีเข้าระบบยังต้องทำที่หน้า <b>พนักงาน (Users)</b> และ <b>จัดการไรเดอร์</b> ด้วยตัวเอง
          (ระบบปิดให้อัตโนมัติเป็นงานเฟสถัดไป) แถวที่พ้นสภาพแล้วแต่บัญชียังเปิดอยู่จะขึ้นป้ายแดง
        </p>
      </div>

      {staleCount > 0 && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 font-bold flex items-center gap-2">
          <ShieldAlert size={18} /> มี {staleCount} คนที่พ้นสภาพแล้วแต่ยังเข้าระบบได้
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อ รหัส ตำแหน่ง"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200" />
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-12 font-bold">กำลังโหลด...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-bold">{items.length === 0 ? 'ยังไม่มีใครในทะเบียน' : 'ไม่พบพนักงานที่ค้นหา'}</p>
          {items.length === 0 && unlinked.length > 0 && (
            <p className="text-sm mt-2">มีบัญชีที่ยังไม่ผูก {unlinked.length} บัญชี — เพิ่มพนักงานแล้วผูกเข้ามาได้</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => {
            const st = STATUSES.find((s) => s.id === row.status) || STATUSES[1];
            return (
              <div key={row.id}
                className={`rounded-2xl border p-4 bg-white ${row.access?.stale_access ? 'border-rose-300 ring-1 ring-rose-100' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-gray-800">{row.name}</span>
                      {row.nickname && <span className="text-sm text-gray-400">({row.nickname})</span>}
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                      <span className="text-[11px] font-mono text-gray-400">{row.employee_code}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {row.position || 'ไม่ระบุตำแหน่ง'}
                      {row.department ? ` · ${row.department}` : ''}
                      {row.branch ? ` · ${row.branch}` : ''}
                      {' · '}
                      {EMPLOYMENT_TYPES.find((t) => t.id === row.employment_type)?.label || row.employment_type}
                      {' · เริ่มงาน '}{thaiDate(row.hired_at)}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1"><IdCard size={13} /> {maskId(row.private?.national_id)}</span>
                      <span className="flex items-center gap-1">
                        <Banknote size={13} />
                        {row.employment_type === 'daily'
                          ? `${money(row.private?.pay?.daily_rate)} บาท/วัน`
                          : `${money(row.private?.pay?.base_salary)} บาท/เดือน`}
                      </span>
                      <span className="flex items-center gap-1">
                        <Link2 size={13} />
                        {row.links?.staff_id ? `บัญชีแอดมิน (${row.access?.staff?.role || '-'})` : ''}
                        {row.links?.rider_id ? ' บัญชีไรเดอร์' : ''}
                        {!row.links?.staff_id && !row.links?.rider_id ? 'ยังไม่ผูกบัญชี' : ''}
                      </span>
                    </div>
                    {row.access?.stale_access && (
                      <p className="mt-2 text-xs font-bold text-rose-700 flex items-center gap-1">
                        <ShieldAlert size={13} /> พ้นสภาพแล้วแต่บัญชียังเข้าระบบได้ — ระบบปิดให้อัตโนมัติตอนบันทึกพ้นสภาพ ถ้ายังขึ้นแบบนี้แปลว่าปิดไม่สำเร็จหรือแถวนี้ถูกตั้งพ้นสภาพไว้ก่อนมีการปิดอัตโนมัติ ให้ไปปิดที่หน้าพนักงาน/ไรเดอร์
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 items-start">
                    <button onClick={() => setDocsFor(row)} disabled={busy}
                      className="text-xs font-bold border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                      <FileText size={13} /> เอกสาร
                    </button>
                    <button onClick={() => setFormFor({ mode: 'edit', row })} disabled={busy}
                      className="text-xs font-bold border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-1">
                      <Pencil size={13} /> แก้ไข
                    </button>
                    <select value={row.status} disabled={busy}
                      onChange={(e) => void setStatus(row, e.target.value)}
                      className="text-xs font-bold border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                      {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unlinked.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <p className="font-bold text-gray-700 flex items-center gap-2 mb-1">
            <UserMinus size={16} /> บัญชีที่ยังไม่มีแฟ้มพนักงาน ({unlinked.length})
          </p>
          <p className="text-xs text-gray-500 mb-3">
            คนเหล่านี้เข้าระบบได้อยู่แล้วแต่ยังไม่มีประวัติการจ้าง — เลือกแฟ้มที่จะผูกเข้าไป
          </p>
          <div className="space-y-2">
            {unlinked.map((acc) => (
              <div key={`${acc.kind}-${acc.id}`} className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2">
                <div className="text-sm">
                  <span className="font-bold text-gray-800">{acc.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {acc.kind === 'staff' ? `พนักงาน · ${acc.role}` : 'ไรเดอร์'}
                    {acc.email ? ` · ${acc.email}` : ''}
                  </span>
                </div>
                <select disabled={busy || items.length === 0} defaultValue=""
                  onChange={(e) => { if (e.target.value) void linkAccount(e.target.value, acc); }}
                  className="text-xs font-bold border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                  <option value="">ผูกเข้าแฟ้ม...</option>
                  {items.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employee_code})</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {formFor && (
        <EmployeeFormModal
          key={formFor.mode === 'edit' ? formFor.row.id : 'create'}
          existing={formFor.mode === 'edit' ? formFor.row : null}
          onClose={() => setFormFor(null)}
          onSaved={async () => { setFormFor(null); await load(); }}
        />
      )}

      {docsFor && (
        <DocumentsModal employee={docsFor} onClose={() => setDocsFor(null)} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// เอกสารบุคคล — ออก / พิมพ์ซ้ำ / ยกเลิก
//
// **ออกแล้วพิมพ์ซ้ำได้ฉบับเดิมเป๊ะ** เลขที่ วันที่ และเงื่อนไขทั้งชุดถูกบันทึก
// ไว้กับเอกสารตอนออก การพิมพ์ซ้ำอ่านจากตรงนั้น ไม่ใช่จากค่า settings วันนี้ —
// สัญญาที่เซ็นไปแล้วต้องอธิบายตัวเองได้แม้เงื่อนไขมาตรฐานจะถูกแก้พรุ่งนี้
//
// **ยกเลิกแล้วไม่ลบแถว** เลขที่ที่หายไปจากลำดับคืออธิบายไม่ได้ตอนถูกตรวจ
// ---------------------------------------------------------------------------
interface HrDoc {
  id: string; type: string; number: string; issued_at: number;
  status?: string; void_reason?: string; expires_at?: number | null;
  subject?: string | null; purpose?: string | null; by_name?: string | null;
}
interface DocsResult {
  documents: HrDoc[];
  active_warnings: number;
  probation_end: number | null;
  availability: Record<string, { label: string; missing: string[] }>;
}

const DocumentsModal: React.FC<{ employee: EmployeeRow; onClose: () => void }> = ({ employee, onClose }) => {
  const toast = useToast();
  const [data, setData] = useState<DocsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState('contract');
  const [extra, setExtra] = useState({ purpose: '', subject: '', incident: '', note: '' });

  const load = useCallback(async () => {
    try {
      setData(await call<DocsResult>('adminHrDocumentList', { employeeId: employee.id }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดเอกสารไม่สำเร็จ');
    }
  }, [employee.id, toast]);
  useEffect(() => { void load(); }, [load]);

  const save = (filename: string, base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const issue = async () => {
    setBusy(true);
    try {
      const res = await call<{ filename: string; base64: string; number: string }>(
        'adminHrDocumentIssue',
        {
          employeeId: employee.id, type,
          purpose: extra.purpose || null,
          subject: extra.subject || null,
          incident: extra.incident || null,
          note: extra.note || null,
        }
      );
      save(res.filename, res.base64);
      toast.success(`ออกเอกสารเลขที่ ${res.number} แล้ว`);
      setExtra({ purpose: '', subject: '', incident: '', note: '' });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ออกเอกสารไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const reprint = async (doc: HrDoc) => {
    setBusy(true);
    try {
      const res = await call<{ filename: string; base64: string; voided: boolean }>(
        'adminHrDocumentPrint', { employeeId: employee.id, documentId: doc.id }
      );
      save(res.filename, res.base64);
      if (res.voided) toast.error('เอกสารฉบับนี้ถูกยกเลิกไปแล้ว — พิมพ์ได้เพื่ออ้างอิงเท่านั้น');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'พิมพ์ไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const voidDoc = async (doc: HrDoc) => {
    const reason = window.prompt(`เหตุผลที่ยกเลิก ${doc.number}:`);
    if (!reason) return;
    setBusy(true);
    try {
      await call('adminHrDocumentVoid', { employeeId: employee.id, documentId: doc.id, reason });
      toast.success('ยกเลิกเอกสารแล้ว');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ยกเลิกไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const avail = data?.availability?.[type];
  const missing = avail?.missing || [];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-black text-gray-800">เอกสารบุคคล — {employee.name}</h2>
            <p className="text-xs text-gray-400">{employee.employee_code}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* หนังสือเตือนที่ยังมีผล — ตัวเลขที่ต้องรู้ก่อนออกใบถัดไป ใบที่หมดอายุ
            แล้วใช้อ้างอิงตอนพิจารณาโทษไม่ได้ */}
        {Boolean(data?.active_warnings) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[12px] text-amber-900 flex gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <p>คนนี้มี<b>หนังสือเตือนที่ยังมีผลอยู่ {data?.active_warnings} ฉบับ</b> (ใบที่เกินอายุแล้วไม่ถูกนับ)</p>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 p-4 space-y-3">
          <p className="text-xs font-black text-gray-500">ออกเอกสารใหม่</p>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white font-bold text-gray-700">
            {Object.entries(data?.availability || {}).map(([id, a]) => (
              <option key={id} value={id}>{a.label}</option>
            ))}
          </select>

          {type === 'salary_certificate' && (
            <input value={extra.purpose} onChange={(e) => setExtra((x) => ({ ...x, purpose: e.target.value }))}
              placeholder="ออกให้เพื่อ… (เช่น ยื่นประกอบการขอสินเชื่อกับธนาคาร)"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
          )}
          {type === 'warning' && (
            <>
              <input value={extra.subject} onChange={(e) => setExtra((x) => ({ ...x, subject: e.target.value }))}
                placeholder="เรื่อง (เช่น มาปฏิบัติงานสายเกินกำหนด)"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
              <textarea rows={3} value={extra.incident} onChange={(e) => setExtra((x) => ({ ...x, incident: e.target.value }))}
                placeholder="เหตุที่เตือน — เขียนให้ชัดว่าทำอะไร เมื่อไหร่ (จำเป็น)"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            </>
          )}
          {type === 'probation_pass' && (
            <input value={extra.note} onChange={(e) => setExtra((x) => ({ ...x, note: e.target.value }))}
              placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
          )}

          {/* บอกก่อนกด ไม่ใช่ให้กดแล้วค่อยรู้ว่าออกไม่ได้ */}
          {missing.length > 0 && (
            <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              ออกไม่ได้ — ยังไม่ได้กรอก: <b>{missing.join(' · ')}</b> (แก้ที่ปุ่ม &quot;แก้ไข&quot;)
            </p>
          )}
          <button onClick={() => void issue()}
            disabled={busy || missing.length > 0 || (type === 'warning' && !extra.incident.trim())}
            className="w-full px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            <Printer size={15} /> ออกเอกสารและดาวน์โหลด PDF
          </button>
          <p className="text-[11px] text-gray-400">
            เงื่อนไขที่พิมพ์ลงเอกสารมาจากหน้า <b>ตั้งค่าเงินเดือน/ภาษี</b> และถูกบันทึกไว้กับเอกสารตอนออก —
            แก้ค่าตั้งทีหลังจะไม่เปลี่ยนเอกสารที่ออกไปแล้ว
          </p>
        </div>

        <div>
          <p className="text-xs font-black text-gray-500 mb-2">เอกสารที่เคยออก</p>
          {!data?.documents.length && <p className="text-sm text-gray-400">ยังไม่เคยออกเอกสารให้คนนี้</p>}
          <div className="space-y-1.5">
            {data?.documents.map((d) => (
              <div key={d.id} className="flex items-center gap-2 flex-wrap border border-gray-100 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-bold text-gray-800">
                    {data.availability[d.type]?.label || d.type}
                    {d.status === 'void' && <span className="ml-2 text-[11px] text-rose-600">ยกเลิกแล้ว</span>}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {d.number} · {thaiDate(d.issued_at)}{d.by_name ? ` · โดย ${d.by_name}` : ''}
                    {d.expires_at ? ` · มีผลถึง ${thaiDate(d.expires_at)}` : ''}
                    {d.void_reason ? ` · เหตุผล: ${d.void_reason}` : ''}
                  </p>
                </div>
                <button onClick={() => void reprint(d)} disabled={busy}
                  className="text-xs font-bold border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  พิมพ์ซ้ำ
                </button>
                {d.status !== 'void' && (
                  <button onClick={() => void voidDoc(d)} disabled={busy}
                    className="text-xs font-bold border border-rose-200 rounded-lg px-2.5 py-1.5 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-1">
                    <Ban size={12} /> ยกเลิก
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ฟอร์มเดียวใช้ทั้งสร้างและแก้ไข — สองฟอร์มที่ต้อง sync กันเองคือของที่วันหนึ่ง
// จะไม่ตรงกัน (ช่องใหม่ถูกเพิ่มที่เดียว) กฎเดียวกับ LoginForm ฝั่งเว็บลูกค้า
//
// **โหมดแก้ไขเติมเลขบัตรประชาชนตัวเต็มลงในช่อง ไม่ใช่ค่าที่ mask แล้ว** —
// ผู้เรียกคือ CEO/HR ซึ่งอ่านค่านี้ได้อยู่แล้วผ่าน callable และถ้าเติมค่าที่ mask
// ไว้ การกดบันทึกโดยไม่แตะช่องนั้นจะเขียนทับเลขจริงด้วยจุดสี่จุด ตารางข้างนอก
// ยัง mask ตามเดิม
const EmployeeFormModal = ({ existing, onClose, onSaved }: {
  existing: EmployeeRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) => {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const editing = Boolean(existing);
  const priv = existing?.private || {};
  const [form, setForm] = useState({
    name: existing?.name || '',
    nickname: existing?.nickname || '',
    position: existing?.position || '',
    department: existing?.department || '',
    branch: existing?.branch || 'Main Store',
    employment_type: existing?.employment_type || 'monthly',
    hired_at: existing?.hired_at
      ? new Date(existing.hired_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    national_id: priv.national_id || '',
    birth_date: priv.birth_date ? new Date(priv.birth_date).toISOString().slice(0, 10) : '',
    phone: priv.phone || '',
    email: priv.email || '',
    line: priv.line || '',
    // ที่อยู่เป็นฟิลด์บังคับของสัญญาจ้าง (DOC_TYPES.contract.needs) — ไม่มีช่อง
    // กรอกอยู่พักหนึ่งจึงออกสัญญาไม่ได้เลยและไม่มีทางแก้จากหน้าจอ
    address: priv.address || '',
    social_security_no: priv.social_security_no || '',
    tax_id: priv.tax_id || '',
    emg_name: priv.emergency_contact?.name || '',
    emg_relation: priv.emergency_contact?.relation || '',
    emg_phone: priv.emergency_contact?.phone || '',
    base_salary: priv.pay?.base_salary != null ? String(priv.pay.base_salary) : '',
    daily_rate: priv.pay?.daily_rate != null ? String(priv.pay.daily_rate) : '',
    bank_name: priv.bank?.name || '',
    bank_account: priv.bank?.account || '',
    bank_account_name: priv.bank?.account_name || '',
    tax_spouse: priv.tax?.spouse ? '1' : '',
    tax_children: priv.tax?.children != null ? String(priv.tax.children) : '',
    tax_parents: priv.tax?.parents != null ? String(priv.tax.parents) : '',
    tax_other: priv.tax?.other != null ? String(priv.tax.other) : '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const payload = () => ({
    profile: {
      name: form.name, nickname: form.nickname, position: form.position,
      department: form.department, branch: form.branch,
      employment_type: form.employment_type,
      hired_at: form.hired_at ? new Date(form.hired_at).getTime() : null,
    },
    private: {
      national_id: form.national_id, phone: form.phone, email: form.email,
      birth_date: form.birth_date ? new Date(form.birth_date).getTime() : null,
      address: form.address, line: form.line,
      social_security_no: form.social_security_no, tax_id: form.tax_id,
      // ส่ง null เมื่อไม่ได้กรอกอะไรเลย ไม่ใช่ object ที่ทุกช่องว่าง
      emergency_contact: (form.emg_name || form.emg_relation || form.emg_phone)
        ? { name: form.emg_name, relation: form.emg_relation, phone: form.emg_phone }
        : null,
      bank: { name: form.bank_name, account: form.bank_account, account_name: form.bank_account_name },
      pay: { base_salary: form.base_salary || null, daily_rate: form.daily_rate || null },
      tax: {
        spouse: form.tax_spouse === '1',
        children: form.tax_children || 0,
        parents: form.tax_parents || 0,
        other: form.tax_other || 0,
      },
    },
  });

  const submit = async () => {
    setSaving(true);
    try {
      if (editing && existing) {
        await call('adminHrEmployeeUpdate', { employeeId: existing.id, ...payload() });
        toast.success('บันทึกการแก้ไขแล้ว');
      } else {
        await call('adminHrEmployeeCreate', payload());
        toast.success('เพิ่มพนักงานเข้าทะเบียนแล้ว');
      }
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: string, label: string, type = 'text') => (
    <label className="block">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      <input type={type} value={(form as Record<string, string>)[key]}
        onChange={(e) => set(key, e.target.value)}
        className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200" />
    </label>
  );

  const area = (key: string, label: string, hint?: string) => (
    <label className="block sm:col-span-2">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      <textarea rows={2} value={(form as Record<string, string>)[key]}
        onChange={(e) => set(key, e.target.value)}
        className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-200" />
      {hint && <span className="block mt-0.5 text-[11px] text-gray-400">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-black text-gray-800">
            {editing ? `แก้ไขข้อมูล ${existing?.name || ''}` : 'เพิ่มพนักงานเข้าทะเบียน'}
            {editing && <span className="text-xs font-mono text-gray-400 ml-2">{existing?.employee_code}</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-5">
          {!editing && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
              การเพิ่มที่นี่ <b>ไม่ได้สร้างบัญชีเข้าระบบ</b> — ถ้าคนนี้มีบัญชีอยู่แล้ว
              ให้ผูกเข้ามาจากรายการ &quot;บัญชีที่ยังไม่มีแฟ้มพนักงาน&quot; หลังบันทึก
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('name', 'ชื่อ-สกุล *')}
            {field('nickname', 'ชื่อเล่น')}
            {field('position', 'ตำแหน่ง')}
            {field('department', 'ฝ่าย')}
            {field('branch', 'สาขา')}
            <label className="block">
              <span className="text-xs font-bold text-gray-500">ประเภทการจ้าง</span>
              <select value={form.employment_type} onChange={(e) => set('employment_type', e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                {EMPLOYMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {field('hired_at', 'วันเริ่มงาน *', 'date')}
            {field('national_id', 'เลขบัตรประชาชน')}
            {field('phone', 'เบอร์โทร')}
            {field('email', 'อีเมล')}
            {field('base_salary', 'เงินเดือน (บาท)', 'number')}
            {field('daily_rate', 'ค่าแรงรายวัน (บาท)', 'number')}
            {field('bank_name', 'ธนาคาร')}
            {field('bank_account', 'เลขบัญชี')}
            {field('bank_account_name', 'ชื่อบัญชี')}
            {field('birth_date', 'วันเกิด', 'date')}
            {field('line', 'Line ID')}
            {field('social_security_no', 'เลขประกันสังคม')}
            {field('tax_id', 'เลขผู้เสียภาษี (ถ้าไม่ใช่เลขบัตร)')}
            {/* ช่องเต็มความกว้างต้องอยู่ท้ายสุด ไม่งั้นมันตัดแถวแล้วเหลือช่องว่าง
                ข้างช่องก่อนหน้า (เห็นจากการเรนเดอร์จริง) */}
            {area('address', 'ที่อยู่', 'ใช้บนสัญญาจ้าง — ไม่กรอกจะออกสัญญาไม่ได้')}
          </div>

          {/* ผู้ติดต่อฉุกเฉิน — ไม่เข้าเอกสารหรือสูตรเงินใดๆ แต่เป็นสิ่งที่ต้อง
              หาให้เจอในนาทีที่ต้องใช้ ไม่ใช่ตอนมีเวลานั่งค้น */}
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="font-bold text-sm text-gray-700">ผู้ติดต่อกรณีฉุกเฉิน</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {field('emg_name', 'ชื่อ')}
              {field('emg_relation', 'ความสัมพันธ์')}
              {field('emg_phone', 'เบอร์โทร')}
            </div>
          </div>

          {/* ค่าลดหย่อน — ไม่กรอกแปลว่าคิดให้เฉพาะลดหย่อนส่วนตัวกับประกันสังคม
              ซึ่งจะหักภาษีไว้สูงกว่าจริง ต้องเขียนบอกตรงๆ ไม่ใช่ปล่อยให้เดาเอง */}
          <div className="rounded-xl border border-gray-200 p-4">
            <p className="font-bold text-sm text-gray-700 flex items-center gap-2">
              <Receipt size={15} /> ค่าลดหย่อนภาษี
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              ใช้คิดภาษีหัก ณ ที่จ่ายในรอบเงินเดือน — <b>ไม่กรอก = ระบบคิดให้เฉพาะลดหย่อนส่วนตัวกับประกันสังคม
              ซึ่งจะหักภาษีไว้สูงกว่าความเป็นจริง</b> จำนวนเงินต่อหัวเป็นอัตราตามกฎหมาย ตั้งที่ <code>settings/hr</code>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.tax_spouse === '1'}
                  onChange={(e) => set('tax_spouse', e.target.checked ? '1' : '')}
                  className="w-4 h-4 rounded border-gray-300" />
                คู่สมรสไม่มีเงินได้
              </label>
              <div />
              {field('tax_children', 'จำนวนบุตร', 'number')}
              {field('tax_parents', 'จำนวนบิดามารดาในอุปการะ', 'number')}
              {field('tax_other', 'ค่าลดหย่อนอื่นรวมทั้งปี (บาท)', 'number')}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              ค่าลดหย่อนอื่น เช่น เบี้ยประกันชีวิต กองทุนสำรองเลี้ยงชีพ ดอกเบี้ยบ้าน เงินบริจาค — ใส่เป็นยอดรวมทั้งปี
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={saving || !form.name.trim()}
            className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
};
