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
} from 'lucide-react';

const fns = () => getFunctions(app, 'asia-southeast1');
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

interface EmployeePrivate {
  national_id?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
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

  const staleCount = items.filter((e) => e.access?.stale_access).length;

  const setStatus = async (row: EmployeeRow, status: string) => {
    let reason: string | null = null;
    if (status === 'resigned' || status === 'terminated') {
      reason = window.prompt(`เหตุผลการ${status === 'resigned' ? 'ลาออก' : 'พ้นสภาพ'} ของ ${row.name}`);
      if (!reason) return;
    }
    setBusy(true);
    try {
      const res = await call<{ ok: boolean; access: EmployeeAccess }>(
        'adminHrEmployeeSetStatus', { employeeId: row.id, status, reason }
      );
      if (res.access?.open && (status === 'resigned' || status === 'terminated')) {
        toast.error('บันทึกสถานะแล้ว แต่บัญชีเข้าระบบยังเปิดอยู่ — ต้องไปปิดที่หน้าพนักงาน/ไรเดอร์');
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
                        <ShieldAlert size={13} /> พ้นสภาพแล้วแต่บัญชียังเข้าระบบได้ — ไปปิดที่หน้าพนักงาน/ไรเดอร์
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 items-start">
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
    phone: priv.phone || '',
    email: priv.email || '',
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
