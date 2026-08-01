// /dealers — ทะเบียนดีลเลอร์ (CEO/MANAGER)
// วงจรบัญชีทั้งหมดผ่าน cloud functions (adminDealer*) — client ไม่เขียน /dealers
// เอง (rules ปิด write) โครงเดียวกับ StaffManagement
import React, { useMemo, useState } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import {
  Building2, Plus, Edit, KeyRound, UserX, UserCheck, X, Copy, Phone, Mail,
} from 'lucide-react';
import { DEALER_TIERS, TIER_META, type Dealer, type DealerTier, fmtDateTime } from '../../types/dealer';

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async (name: string, data: Record<string, unknown>) => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as { ok: boolean; uid?: string };
};

// รหัสผ่านชั่วคราวอ่านง่าย ไม่มีตัวสับสน (0/O, 1/l/I) — เหมือน StaffManagement
const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const EMPTY_FORM = {
  company_name: '',
  tax_id: '',
  address: '',
  contact_name: '',
  phone: '',
  line_id: '',
  email: '',
  tier: 'B' as DealerTier,
  password: '',
};

export const DealerManager = () => {
  const toast = useToast();
  const { data: dealersRaw, loading } = useDatabase('dealers');
  const { data: applicationsRaw } = useDatabase('dealer_applications');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // ออกบัญชีจากใบสมัครหน้า landing — ส่ง id ไปปิดใบสมัครเป็น approved ฝั่ง server
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  // รหัสผ่านที่เพิ่งออก — โชว์ครั้งเดียวให้ส่งต่อดีลเลอร์
  const [issued, setIssued] = useState<{ company: string; email: string; password: string } | null>(null);

  const pendingApplications = useMemo(() => {
    const list = Array.isArray(applicationsRaw) ? applicationsRaw : [];
    return list
      .filter((a: any) => a.status === 'pending')
      .sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0));
  }, [applicationsRaw]);

  const dealers: Dealer[] = useMemo(() => {
    if (!dealersRaw) return [];
    const list = Array.isArray(dealersRaw)
      ? dealersRaw
      : Object.keys(dealersRaw).map((k) => ({ id: k, ...(dealersRaw as any)[k] }));
    return list.sort((a: Dealer, b: Dealer) => (b.created_at || 0) - (a.created_at || 0));
  }, [dealersRaw]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      toast.error(err?.message || 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setApplicationId(null);
    setForm({ ...EMPTY_FORM, password: generatePassword() });
    setIsModalOpen(true);
  };

  const openCreateFromApplication = (app: any) => {
    setEditingId(null);
    setApplicationId(app.id);
    setForm({
      company_name: app.company_name || '',
      tax_id: app.tax_id || '',
      address: app.address || '',
      contact_name: app.contact_name || '',
      phone: app.phone || '',
      line_id: app.line_id || '',
      email: app.email || '',
      tier: 'C',
      password: generatePassword(),
    });
    setIsModalOpen(true);
  };

  const handleRejectApplication = (app: any) => {
    const reason = prompt(`ปฏิเสธใบสมัครของ ${app.company_name}? ระบุเหตุผล (แจ้งผู้สมัครทางอีเมล):`);
    if (reason === null) return;
    run(async () => {
      await call('adminDealerApplicationReject', { applicationId: app.id, reason });
      toast.success('ปฏิเสธใบสมัครแล้ว');
    });
  };

  const openEdit = (d: Dealer) => {
    setEditingId(d.id);
    setForm({
      company_name: d.company_name || '',
      tax_id: d.tax_id || '',
      address: d.address || '',
      contact_name: d.contact_name || '',
      phone: d.phone || '',
      line_id: d.line_id || '',
      email: d.email || '',
      tier: (d.tier || 'B') as DealerTier,
      password: '',
    });
    setIsModalOpen(true);
  };

  const handleSave = () =>
    run(async () => {
      if (!form.company_name.trim()) throw new Error('ต้องระบุชื่อบริษัท/ร้าน');
      if (!form.email.trim()) throw new Error('ต้องระบุอีเมล');
      if (editingId) {
        await call('adminDealerUpdate', { uid: editingId, ...form, password: undefined });
        toast.success('บันทึกข้อมูลดีลเลอร์แล้ว');
      } else {
        await call('adminDealerCreate', { ...form, applicationId: applicationId || undefined });
        setIssued({ company: form.company_name, email: form.email, password: form.password });
        toast.success(applicationId ? 'อนุมัติใบสมัคร + สร้างบัญชีแล้ว' : 'สร้างบัญชีดีลเลอร์แล้ว');
      }
      setIsModalOpen(false);
      setApplicationId(null);
    });

  const handleToggleStatus = (d: Dealer) => {
    const suspend = d.status === 'ACTIVE';
    if (!confirm(suspend ? `ระงับบัญชี ${d.company_name}? (session ที่เปิดค้างจะถูกเตะออกทันที)` : `เปิดใช้บัญชี ${d.company_name}?`)) return;
    run(async () => {
      await call('adminDealerSetStatus', { uid: d.id, status: suspend ? 'SUSPENDED' : 'ACTIVE' });
      toast.success(suspend ? 'ระงับบัญชีแล้ว' : 'เปิดใช้บัญชีแล้ว');
    });
  };

  const handleResetPassword = (d: Dealer) => {
    const password = generatePassword();
    if (!confirm(`ออกรหัสผ่านใหม่ให้ ${d.company_name}?`)) return;
    run(async () => {
      await call('adminDealerResetPassword', { uid: d.id, password });
      setIssued({ company: d.company_name, email: d.email, password });
      toast.success('รีเซ็ตรหัสผ่านแล้ว');
    });
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading Dealers...</div>;

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
            <Building2 className="text-blue-600" /> Dealer Manager
          </h1>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
            ทะเบียนดีลเลอร์ขายส่ง · Tier · บัญชีเข้า Portal
          </p>
        </div>
        <button onClick={openCreate} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center gap-2">
          <Plus size={16} /> เพิ่มดีลเลอร์
        </button>
      </div>

      {/* ใบสมัครจากหน้า landing getmobie.com — รอตรวจสอบ */}
      {pendingApplications.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 mb-6">
          <div className="font-black text-xs uppercase tracking-widest text-amber-700 mb-3">
            ใบสมัครดีลเลอร์รอตรวจสอบ ({pendingApplications.length})
          </div>
          <div className="space-y-3">
            {pendingApplications.map((app: any) => (
              <div key={app.id} className="bg-white rounded-xl border border-amber-200 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-black text-sm text-slate-800">{app.company_name}</div>
                  <div className="text-xs font-bold text-slate-500">
                    {app.contact_name || '-'} · {app.phone} · {app.email}
                    {app.tax_id && <span className="font-mono"> · Tax {app.tax_id}</span>}
                  </div>
                  {app.note && <div className="text-[11px] text-slate-400 font-bold mt-1">"{app.note}"</div>}
                  <div className="text-[10px] text-slate-400 font-bold mt-1">สมัครเมื่อ {fmtDateTime(app.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openCreateFromApplication(app)} disabled={busy} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50">
                    อนุมัติ + ออกบัญชี
                  </button>
                  <button onClick={() => handleRejectApplication(app)} disabled={busy} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-red-100 disabled:opacity-50">
                    ปฏิเสธ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Dealer</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">ติดต่อ</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Tier</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">สถานะ</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">สร้างเมื่อ</th>
                <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {dealers.map((d) => (
                <tr key={d.id} className="hover:bg-blue-50/30 transition-colors">
                  <td className="p-5">
                    <div className="font-black text-sm text-slate-800">{d.company_name}</div>
                    {d.tax_id && <div className="text-[10px] font-mono font-bold text-slate-400">Tax ID: {d.tax_id}</div>}
                    {d.contact_name && <div className="text-[10px] font-bold text-slate-500">ผู้ติดต่อ: {d.contact_name}</div>}
                  </td>
                  <td className="p-5">
                    <div className="text-xs font-bold text-slate-600 flex items-center gap-1"><Mail size={12} /> {d.email}</div>
                    {d.phone && <div className="text-xs font-bold text-slate-500 flex items-center gap-1 mt-1"><Phone size={12} /> {d.phone}</div>}
                  </td>
                  <td className="p-5 text-center">
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg border ${TIER_META[d.tier]?.cls || TIER_META.C.cls}`}>
                      {TIER_META[d.tier]?.label || d.tier}
                    </span>
                  </td>
                  <td className="p-5 text-center">
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${
                      d.status === 'ACTIVE'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-600 border-red-200'
                    }`}>{d.status}</span>
                  </td>
                  <td className="p-5 text-xs font-bold text-slate-500">{fmtDateTime(d.created_at)}</td>
                  <td className="p-5 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => openEdit(d)} className="bg-slate-100 text-slate-600 p-2 rounded-lg hover:bg-slate-200" title="แก้ไข"><Edit size={16} /></button>
                      <button onClick={() => handleResetPassword(d)} className="bg-amber-50 text-amber-600 p-2 rounded-lg hover:bg-amber-100" title="รีเซ็ตรหัสผ่าน"><KeyRound size={16} /></button>
                      <button
                        onClick={() => handleToggleStatus(d)}
                        className={`p-2 rounded-lg ${d.status === 'ACTIVE' ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                        title={d.status === 'ACTIVE' ? 'ระงับบัญชี' : 'เปิดใช้บัญชี'}
                      >
                        {d.status === 'ACTIVE' ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {dealers.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-slate-400 italic font-bold">ยังไม่มีดีลเลอร์ — กด "เพิ่มดีลเลอร์" เพื่อออกบัญชีแรก</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight">
                {editingId ? 'แก้ไขดีลเลอร์' : 'เพิ่มดีลเลอร์ใหม่'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <Field label="ชื่อบริษัท / ร้าน *">
                <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="inp" placeholder="หจก. โฟนช็อป" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="เลขผู้เสียภาษี (ออกใบกำกับเต็มรูป)">
                  <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} className="inp" placeholder="0105561234567" />
                </Field>
                <Field label="ผู้ติดต่อ">
                  <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="inp" />
                </Field>
              </div>
              <Field label="ที่อยู่ (ตามจดทะเบียน — ใช้ในใบกำกับภาษี)">
                <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="inp" rows={2} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="เบอร์โทร">
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="inp" />
                </Field>
                <Field label="LINE ID">
                  <input value={form.line_id} onChange={(e) => setForm({ ...form, line_id: e.target.value })} className="inp" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="อีเมล (ใช้ login Portal) *">
                  <input value={form.email} disabled={!!editingId && false} onChange={(e) => setForm({ ...form, email: e.target.value })} className="inp" placeholder="dealer@example.com" />
                </Field>
                <Field label="Tier">
                  <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as DealerTier })} className="inp">
                    {DEALER_TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
                  </select>
                </Field>
              </div>
              {!editingId && (
                <Field label="รหัสผ่านชั่วคราว (ระบบสุ่มให้ — ส่งต่อดีลเลอร์)">
                  <div className="flex gap-2">
                    <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="inp font-mono" />
                    <button onClick={() => setForm({ ...form, password: generatePassword() })} className="px-3 bg-slate-100 rounded-xl text-xs font-bold hover:bg-slate-200">สุ่มใหม่</button>
                  </div>
                </Field>
              )}
              <div className="pt-2 flex gap-3">
                <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-slate-500 font-bold text-xs uppercase hover:bg-slate-50 rounded-xl">ยกเลิก</button>
                <button onClick={handleSave} disabled={busy} className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 disabled:opacity-50">
                  {busy ? 'กำลังบันทึก...' : editingId ? 'บันทึก' : 'สร้างบัญชีดีลเลอร์'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* One-time password dialog */}
      {issued && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md p-6">
            <h3 className="font-black text-lg text-slate-800 mb-2">ข้อมูลเข้าระบบของ {issued.company}</h3>
            <p className="text-xs font-bold text-amber-600 mb-4">แสดงครั้งเดียว — คัดลอกส่งให้ดีลเลอร์ทันที</p>
            <div className="bg-slate-50 rounded-xl p-4 font-mono text-sm space-y-1">
              <div>URL: https://app.getmobie.com</div>
              <div>Email: {issued.email}</div>
              <div>Password: <span className="font-black">{issued.password}</span></div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`Dealer Portal: https://app.getmobie.com\nEmail: ${issued.email}\nPassword: ${issued.password}`);
                }}
                className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 hover:bg-black"
              >
                <Copy size={14} /> คัดลอก
              </button>
              <button onClick={() => setIssued(null)} className="flex-1 py-3 text-slate-500 font-bold text-xs uppercase hover:bg-slate-50 rounded-xl">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
    <div className="mt-1 [&_.inp]:w-full [&_.inp]:p-3 [&_.inp]:rounded-xl [&_.inp]:border [&_.inp]:border-slate-200 [&_.inp]:font-bold [&_.inp]:text-sm [&_.inp]:outline-none [&_.inp]:focus:border-blue-500">
      {children}
    </div>
  </div>
);
