// src/pages/settings/StaffManagement.tsx
//
// สถาปัตยกรรมใหม่: พนักงานแต่ละคนมีบัญชี Firebase Auth ของตัวเอง — หน้านี้
// ไม่เขียน /staff ตรงๆ อีกแล้ว ทุก operation เรียก cloud functions (CEO-gated
// ฝั่ง server, ดู functions/staff-accounts.js):
//   adminStaffCreate        สร้างพนักงาน + บัญชี login (หรือออกบัญชีให้ record เดิม)
//   adminStaffUpdate        แก้โปรไฟล์ / role / อีเมล
//   adminStaffSetStatus     พักงาน (ปิด auth + ถอนสิทธิ์ DB ทันที) / คืนสถานะ
//   adminStaffDelete        ปิดบัญชี: ถอนสิทธิ์ + ลบบัญชี login + tokens
//                           แต่ **ไม่ลบแถวใน /staff** (ประทับ terminated_at)
//   adminStaffResetPassword ออกรหัสผ่านใหม่
// database rules ปิด client write ที่ /staff และ /admins แล้ว — Admin SDK
// ใน functions เป็นผู้เขียนคนเดียว
//
// แถวที่ปิดบัญชีแล้วยังโผล่ในตาราง (ท้ายรายการ) โดยตั้งใจ: id ของพนักงานถูก
// อ้างถึงจากงานเก่าเต็มไปหมด (qc_logs, adjustments, ประวัติสถานะ) การลบทิ้งทำให้
// ทุกอ้างอิงชี้ไปที่ว่าง ปุ่มจัดการทั้งหมดถูกซ่อนสำหรับแถวเหล่านี้เพราะ server
// ปฏิเสธทุกตัวอยู่แล้ว
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  Users, ShieldCheck, KeyRound, Plus, Edit, Trash2, X, UserCog,
  AlertTriangle, Mail, UserX, UserCheck, Copy, RefreshCw, Wand2
} from 'lucide-react';

/** พอสำหรับคำถามเดียวที่ถูกถาม: แถวนี้ปิดบัญชีไปแล้วหรือยัง */
type Terminatable = { terminated_at?: number | null } | null | undefined;

// Role ทั้ง 5 ค่านี้คือชุดเดียวที่ route guard ทั้งระบบรู้จัก (App.tsx,
// AdminLayout, settingsNav, canReviewAdjustments, functions/staffIdsByRoles)
// และต้องตรงกับ VALID_ROLES ใน functions/staff-accounts.js
const ROLES = [
  { id: 'CEO', label: 'CEO / Owner', desc: 'เข้าถึงได้ทุกระบบ รวมจัดการพนักงาน ตั้งค่าระบบส่วนกลาง วิเคราะห์กำไร และอนุมัติ Offer', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { id: 'MANAGER', label: 'Manager (ผู้จัดการ)', desc: 'เกือบทุกระบบ: Tickets, สต็อก, CRM, Analytics, Catalog, คูปอง และอนุมัติ Offer — ยกเว้นจัดการพนักงาน ตั้งค่าส่วนกลาง และรายงานการเงิน/ภาษี', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'STAFF', label: 'Staff (พนักงานทั่วไป)', desc: 'งานปฏิบัติการพื้นฐาน: Tickets, QC Lab, คลังสินค้า, POS, ประวัติการขาย — เสนอ Offer ได้แต่ต้องรอ CEO/Manager อนุมัติ', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { id: 'FINANCE', label: 'Finance (บัญชี/การเงิน)', desc: 'ระบบบัญชีและการเงิน: Finance, เบิกจ่าย, P&L, ภ.พ.30, สมุดรายวัน, ตั้งค่าระบบบัญชี และงานพื้นฐาน', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { id: 'HR', label: 'HR (ฝ่ายบุคคล)', desc: 'ทะเบียนพนักงาน ข้อมูลการจ้าง และเงินเดือน — เข้าได้เฉพาะหน้าของฝ่ายบุคคล ไม่เห็นงานรับซื้อ คลัง หรือลูกค้า', color: 'bg-rose-100 text-rose-700 border-rose-200' },
];

const VALID_ROLE_IDS = ROLES.map(r => r.id);

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async (name: string, data: Record<string, unknown>) => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as { ok: boolean };
};

const readSession = (): { id?: string; email?: string } | null => {
  try {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// รหัสผ่านชั่วคราวอ่านง่าย ไม่มีตัวสับสน (0/O, 1/l/I)
const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => chars[Math.floor(Math.random() * chars.length)];
  return Array.from({ length: 10 }, pick).join('');
};

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  role: 'STAFF',
  branch: 'Main Store',
  password: '',
};

type PasswordDialog =
  | { mode: 'issue'; staff: any; password: string }
  | { mode: 'reset'; staff: any; password: string }
  | null;

export const StaffManagement = () => {
  const toast = useToast();
  const { data: staff, loading } = useDatabase('staff');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState(false);
  const [pwDialog, setPwDialog] = useState<PasswordDialog>(null);
  // รหัสผ่านที่เพิ่งออก — โชว์ครั้งเดียวหลังสร้าง/รีเซ็ตสำเร็จ ให้ CEO ส่งต่อพนักงาน
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);

  const staffList = useMemo(() => {
    if (!staff) return [];
    const rows = Array.isArray(staff)
      ? staff
      : Object.keys(staff).map(k => ({ id: k, ...(staff as any)[k] }));
    // แถวของคนที่ปิดบัญชีแล้วไม่ถูกลบทิ้งอีกต่อไป (ดู adminStaffDelete) — มันคือ
    // บันทึกทางประวัติศาสตร์ที่ id ถูกอ้างถึงจากงานเก่า จึงต้องยังเห็นได้ แต่ดัน
    // ลงท้ายรายการเพื่อไม่ให้ปนกับคนที่ยังทำงานอยู่
    return [...rows].sort(
      (a: Terminatable, b: Terminatable) =>
        Number(Boolean(a?.terminated_at)) - Number(Boolean(b?.terminated_at))
    );
  }, [staff]);

  // "ปิดบัญชีแล้ว" ต่างจาก "พักงานอยู่": พักงานคืนสถานะได้ ปิดบัญชีคืนไม่ได้
  // เพราะบัญชี Auth ถูกลบไปแล้ว — server ปฏิเสธทุก operation บนแถวเหล่านี้
  const isTerminated = (emp: Terminatable) => Boolean(emp?.terminated_at);

  const session = useMemo(() => readSession(), []);

  const isSelf = (emp: any) => {
    if (!session) return false;
    if (session.id && emp.id === session.id) return true;
    if (session.email && emp.email && normalizeEmail(session.email) === normalizeEmail(emp.email)) return true;
    return false;
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err: any) {
      toast.error(err?.message || `${label}ไม่สำเร็จ`);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenModal = (staffItem?: any) => {
    setIssued(null);
    if (staffItem) {
      setEditingId(staffItem.id);
      setFormData({
        name: staffItem.name || '',
        phone: staffItem.phone || '',
        email: staffItem.email || '',
        // role เก่าที่เลิกใช้ (CASHIER/QC) ปล่อยค้างไว้เพื่อบังคับเลือกใหม่ก่อนบันทึก
        role: staffItem.role || 'STAFF',
        branch: staffItem.branch || 'Main Store',
        password: '',
      });
    } else {
      setEditingId(null);
      setFormData({ ...EMPTY_FORM, password: generatePassword() });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!VALID_ROLE_IDS.includes(formData.role)) {
      toast.warning('กรุณาเลือก Role ใหม่ — role เดิมของพนักงานคนนี้ไม่มีในระบบแล้ว');
      return;
    }
    const email = normalizeEmail(formData.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.warning('กรุณากรอกอีเมลให้ถูกต้อง — พนักงานใช้อีเมลนี้ login');
      return;
    }
    if (!editingId && formData.password.length < 8) {
      toast.warning('รหัสผ่านชั่วคราวต้องยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }

    await run('บันทึก', async () => {
      if (editingId) {
        await call('adminStaffUpdate', {
          staffId: editingId,
          name: formData.name,
          phone: formData.phone,
          email,
          role: formData.role,
          branch: formData.branch,
        });
        toast.success('บันทึกข้อมูลพนักงานแล้ว');
      } else {
        await call('adminStaffCreate', {
          name: formData.name,
          phone: formData.phone,
          email,
          role: formData.role,
          branch: formData.branch,
          password: formData.password,
        });
        setIssued({ name: formData.name, email, password: formData.password });
        toast.success('สร้างพนักงานและบัญชี login แล้ว');
      }
      setIsModalOpen(false);
    });
  };

  const handleToggleStatus = async (emp: any) => {
    if (isTerminated(emp)) {
      toast.warning('พนักงานคนนี้ปิดบัญชีไปแล้ว — ถ้ากลับมาทำงานให้ออกบัญชีใหม่');
      return;
    }
    const suspending = emp.status === 'ACTIVE';
    if (suspending && isSelf(emp)) {
      toast.warning('พักงานบัญชีตัวเองไม่ได้');
      return;
    }
    const ok = window.confirm(
      suspending
        ? `พักงาน "${emp.name}"?\n\nบัญชีจะถูกปิดทันที: login ไม่ได้ และหน้าจอที่เปิดค้างอยู่จะถูกเตะออกจากระบบ`
        : `คืนสถานะการทำงานให้ "${emp.name}"?\n\nบัญชีจะกลับมา login และใช้งานระบบได้ตาม role เดิม`
    );
    if (!ok) return;
    await run('เปลี่ยนสถานะ', async () => {
      await call('adminStaffSetStatus', { staffId: emp.id, status: suspending ? 'INACTIVE' : 'ACTIVE' });
      toast.success(suspending ? `พักงาน ${emp.name} แล้ว` : `คืนสถานะให้ ${emp.name} แล้ว`);
    });
  };

  const handleDelete = async (emp: any) => {
    if (isSelf(emp)) {
      toast.warning('ปิดบัญชีที่กำลังใช้งานอยู่ไม่ได้');
      return;
    }
    if (isTerminated(emp)) {
      toast.warning('พนักงานคนนี้ปิดบัญชีไปแล้ว');
      return;
    }
    if (!window.confirm(
      `ปิดบัญชีพนักงาน "${emp.name}"?\n\n` +
      `บัญชี login, สิทธิ์เข้าระบบ และการแจ้งเตือนจะถูกลบทั้งหมด และย้อนกลับไม่ได้\n\n` +
      `ชื่อของพนักงานคนนี้ยังอยู่ในรายการ (ท้ายตาราง) เพราะงานเก่าอ้างถึงเขาอยู่ — ` +
      `ถ้าลบทิ้ง ประวัติบนงานเหล่านั้นจะไม่เหลือชื่อคนทำ`
    )) return;
    await run('ปิดบัญชีพนักงาน', async () => {
      await call('adminStaffDelete', { staffId: emp.id });
      toast.success(`ปิดบัญชี ${emp.name} แล้ว`);
    });
  };

  const submitPasswordDialog = async () => {
    if (!pwDialog) return;
    if (pwDialog.password.length < 8) {
      toast.warning('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
      return;
    }
    const { mode, staff: target, password } = pwDialog;
    await run(mode === 'issue' ? 'ออกบัญชี' : 'รีเซ็ตรหัสผ่าน', async () => {
      if (mode === 'issue') {
        await call('adminStaffCreate', {
          staffId: target.id,
          name: target.name,
          phone: target.phone || '',
          email: normalizeEmail(target.email || ''),
          role: VALID_ROLE_IDS.includes(target.role) ? target.role : 'STAFF',
          branch: target.branch || 'Main Store',
          password,
        });
        toast.success(`ออกบัญชี login ให้ ${target.name} แล้ว`);
      } else {
        await call('adminStaffResetPassword', { staffId: target.id, password });
        toast.success(`รีเซ็ตรหัสผ่านของ ${target.name} แล้ว`);
      }
      setIssued({ name: target.name, email: normalizeEmail(target.email || ''), password });
      setPwDialog(null);
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('คัดลอกแล้ว');
    } catch {
      toast.warning('คัดลอกอัตโนมัติไม่ได้ กรุณาจดด้วยตนเอง');
    }
  };

  if (loading) return <div className="p-10 text-center font-bold text-slate-400">Loading Staff Data...</div>;

  return (
    <div className="p-8 space-y-6 bg-[#F5F7FA] min-h-screen font-sans text-slate-800">

      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            <UserCog className="text-blue-600"/> Staff & Roles
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">พนักงานแต่ละคนมีบัญชี login ของตัวเอง — role และสิทธิ์ผูกกับบัญชีนั้น</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black uppercase text-sm hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
        >
          <Plus size={18}/> เพิ่มพนักงานใหม่
        </button>
      </div>

      {/* รหัสผ่านที่เพิ่งออก — โชว์ครั้งเดียว */}
      {issued && (
        <div className="bg-emerald-50 border border-emerald-200 p-5 rounded-2xl flex items-start gap-3">
          <KeyRound className="text-emerald-500 shrink-0" size={20}/>
          <div className="flex-1">
            <h4 className="font-black text-emerald-800 text-sm">บัญชี login ของ {issued.name} พร้อมใช้งาน — ส่งข้อมูลนี้ให้พนักงานทางช่องทางที่ปลอดภัย</h4>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="bg-white border border-emerald-200 px-3 py-1.5 rounded-lg font-mono text-sm font-bold text-slate-700">{issued.email}</code>
              <code className="bg-white border border-emerald-200 px-3 py-1.5 rounded-lg font-mono text-sm font-bold text-slate-700">{issued.password}</code>
              <button onClick={() => copyText(`${issued.email}\n${issued.password}`)} className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-700 hover:text-emerald-900 uppercase">
                <Copy size={13}/> คัดลอก
              </button>
            </div>
            <p className="text-[11px] font-bold text-emerald-700/70 mt-2">รหัสผ่านนี้จะไม่แสดงอีก — พนักงานเปลี่ยนรหัสเองได้ผ่าน "ลืมรหัสผ่าน" ที่หน้า login</p>
          </div>
          <button onClick={() => setIssued(null)} className="text-emerald-400 hover:text-emerald-600"><X size={16}/></button>
        </div>
      )}

      {/* Security note */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
         <AlertTriangle className="text-amber-500 shrink-0" size={20}/>
         <div>
            <h4 className="font-black text-amber-800 text-sm">Security Policy (นโยบายความปลอดภัย)</h4>
            <p className="text-xs font-bold text-amber-700/80 mt-1 leading-relaxed">
               พนักงานแต่ละคน login ด้วยอีเมล + รหัสผ่านของตัวเอง ห้ามใช้บัญชีร่วมกัน
               การพักงานจะปิดบัญชีทันทีทั้งการ login และหน้าจอที่เปิดค้างอยู่
               ทุกการสร้าง/แก้ไข/ลบบัญชีถูกตรวจสิทธิ์ CEO ที่ฝั่ง server
            </p>
         </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">พนักงาน (Staff Info)</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">อีเมล (Login)</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">บทบาท (Role)</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">บัญชี / สถานะ</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {staffList.length === 0 ? (
               <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold italic">ยังไม่มีข้อมูลพนักงาน กรุณาเพิ่มพนักงานใหม่</td></tr>
            ) : (
               staffList.map((emp) => {
                  const roleDef = ROLES.find(r => r.id === emp.role);
                  const terminated = isTerminated(emp);
                  const suspended = emp.status !== 'ACTIVE' && !terminated;
                  return (
                     <tr key={emp.id} className={`hover:bg-slate-50 transition-colors ${suspended ? 'opacity-60' : ''}`}>
                        <td className="p-5">
                           <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-400">{emp.name?.charAt(0)}</div>
                              <div>
                                 <div className="font-black text-slate-800 flex items-center gap-2">
                                    {emp.name}
                                    {isSelf(emp) && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">คุณ</span>}
                                 </div>
                                 <div className="text-xs font-bold text-slate-400">{emp.phone}{emp.branch ? ` • ${emp.branch}` : ''}</div>
                              </div>
                           </div>
                        </td>
                        <td className="p-5">
                           {emp.email ? (
                              <span className="text-sm font-bold text-slate-600">{emp.email}</span>
                           ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-red-500 bg-red-50 border border-red-200 px-2 py-1 rounded-lg uppercase">
                                 <AlertTriangle size={11}/> ไม่มีอีเมล
                              </span>
                           )}
                        </td>
                        <td className="p-5">
                           {roleDef ? (
                              <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase border ${roleDef.color} flex items-center gap-1.5 w-fit`}>
                                 <ShieldCheck size={12}/> {roleDef.id}
                              </span>
                           ) : (
                              <span className="px-3 py-1 rounded-lg text-[10px] font-black uppercase border bg-red-50 text-red-600 border-red-200 flex items-center gap-1.5 w-fit">
                                 <AlertTriangle size={12}/> {emp.role || 'ไม่ระบุ'} (เก่า — กรุณาแก้ไข)
                              </span>
                           )}
                        </td>
                        <td className="p-5">
                           <div className="flex flex-col gap-1.5">
                              {emp.uid ? (
                                 <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg uppercase w-fit">
                                    <UserCheck size={11}/> มีบัญชี login
                                 </span>
                              ) : (
                                 <button
                                    onClick={() => emp.email
                                       ? setPwDialog({ mode: 'issue', staff: emp, password: generatePassword() })
                                       : toast.warning('กรอกอีเมลให้พนักงานก่อน (ปุ่มแก้ไข) แล้วค่อยออกบัญชี')}
                                    className="inline-flex items-center gap-1 text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg uppercase w-fit hover:bg-blue-100 transition-colors"
                                 >
                                    <Wand2 size={11}/> ออกบัญชี login
                                 </button>
                              )}
                              {suspended && (
                                 <span className="inline-flex items-center gap-1 text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg uppercase w-fit">
                                    <UserX size={11}/> พักงานอยู่
                                 </span>
                              )}
                              {terminated && (
                                 <span className="inline-flex items-center gap-1 text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg uppercase w-fit">
                                    <UserX size={11}/> ปิดบัญชีแล้ว
                                 </span>
                              )}
                           </div>
                        </td>
                        <td className="p-5 text-right">
                           {/* แถวที่ปิดบัญชีแล้วเป็นบันทึกทางประวัติศาสตร์ ไม่ใช่พนักงานที่จัดการได้ —
                               server ปฏิเสธทุกปุ่มเหล่านี้อยู่แล้ว ปุ่มที่กดแล้วขึ้น error เสมอ
                               คือปุ่มที่ไม่ควรมี */}
                           {terminated ? (
                              <span className="text-[11px] font-bold text-slate-400 italic">
                                 ปิดบัญชีแล้ว — เก็บไว้เพื่ออ้างอิงงานเก่า
                              </span>
                           ) : (
                           <div className="flex justify-end gap-2">
                              <button title="แก้ไขข้อมูล" onClick={() => handleOpenModal(emp)} className="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors"><Edit size={16}/></button>
                              {emp.uid && (
                                 <button title="รีเซ็ตรหัสผ่าน" onClick={() => setPwDialog({ mode: 'reset', staff: emp, password: generatePassword() })} className="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-indigo-100 hover:text-indigo-600 transition-colors"><KeyRound size={16}/></button>
                              )}
                              <button
                                 title={suspended ? 'คืนสถานะการทำงาน' : 'พักงาน (ปิดการเข้าถึงทันที)'}
                                 onClick={() => handleToggleStatus(emp)}
                                 className={`p-2 rounded-lg transition-colors ${suspended ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-amber-100 hover:text-amber-600'}`}
                              >
                                 {suspended ? <UserCheck size={16}/> : <UserX size={16}/>}
                              </button>
                              <button title="ปิดบัญชี (ถอนสิทธิ์ทั้งหมด แต่เก็บชื่อไว้อ้างอิงงานเก่า)" onClick={() => handleDelete(emp)} className="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors"><Trash2 size={16}/></button>
                           </div>
                           )}
                        </td>
                     </tr>
                  );
               })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal: Add/Edit Staff */}
      {isModalOpen && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <form onSubmit={handleSave} className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
               <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight flex items-center gap-2">
                     <Users size={20} className="text-blue-600"/> {editingId ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มพนักงานใหม่'}
                  </h3>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 bg-white p-1.5 rounded-full shadow-sm"><X size={18}/></button>
               </div>

               <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">ชื่อ-นามสกุล</label>
                        <input required type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="ชื่อจริง นามสกุล"/>
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">เบอร์โทรศัพท์</label>
                        <input required type="text" value={formData.phone} onChange={e=>setFormData({...formData, phone: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="08x-xxx-xxxx"/>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block flex items-center gap-1"><Mail size={11}/> อีเมล (ใช้ login)</label>
                        <input required type="email" value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="staff@bkkapple.com"/>
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">สาขา (Branch)</label>
                        <input type="text" value={formData.branch} onChange={e=>setFormData({...formData, branch: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="Main Store"/>
                     </div>
                  </div>

                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ระดับสิทธิ์การเข้าถึง (Role)</label>
                     {!VALID_ROLE_IDS.includes(formData.role) && (
                        <div className="mb-2 bg-red-50 border border-red-200 text-red-600 text-xs font-bold p-3 rounded-xl flex items-center gap-2">
                           <AlertTriangle size={14} className="shrink-0"/> Role เดิม "{formData.role}" ไม่มีในระบบแล้ว กรุณาเลือก role ใหม่ด้านล่าง
                        </div>
                     )}
                     <div className="grid grid-cols-1 gap-2">
                        {ROLES.map(r => (
                           <label key={r.id} className={`p-3 rounded-xl border-2 flex items-start gap-3 cursor-pointer transition-all ${formData.role === r.id ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-300'}`}>
                              <input type="radio" name="role" value={r.id} checked={formData.role === r.id} onChange={e=>setFormData({...formData, role: e.target.value})} className="mt-1" />
                              <div>
                                 <div className="font-black text-sm text-slate-800">{r.label}</div>
                                 <div className="text-xs font-bold text-slate-500">{r.desc}</div>
                              </div>
                           </label>
                        ))}
                     </div>
                  </div>

                  {!editingId && (
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">รหัสผ่านชั่วคราว (อย่างน้อย 8 ตัวอักษร)</label>
                        <div className="flex gap-2">
                           <input required type="text" minLength={8} value={formData.password} onChange={e=>setFormData({...formData, password: e.target.value})} className="flex-1 bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-mono font-bold outline-none focus:border-blue-500" placeholder="อย่างน้อย 8 ตัวอักษร"/>
                           <button type="button" onClick={() => setFormData({...formData, password: generatePassword()})} className="px-4 bg-slate-100 text-slate-500 rounded-xl hover:bg-blue-100 hover:text-blue-600 transition-colors" title="สุ่มรหัสผ่านใหม่">
                              <RefreshCw size={16}/>
                           </button>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1 font-bold">ระบบจะแสดงรหัสนี้อีกครั้งหลังบันทึก เพื่อให้ส่งต่อพนักงาน — พนักงานเปลี่ยนเองได้ผ่าน "ลืมรหัสผ่าน"</p>
                     </div>
                  )}
               </div>

               <div className="p-6 bg-slate-50 border-t border-slate-100">
                  <button type="submit" disabled={busy} className="w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase text-sm hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-lg shadow-blue-600/20">
                     {busy ? 'กำลังบันทึก...' : editingId ? 'บันทึกข้อมูลพนักงาน' : 'สร้างพนักงาน + บัญชี Login'}
                  </button>
               </div>
            </form>
         </div>
      )}

      {/* Dialog: ออกบัญชี / รีเซ็ตรหัสผ่าน */}
      {pwDialog && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl">
               <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight flex items-center gap-2">
                     <KeyRound size={20} className="text-blue-600"/>
                     {pwDialog.mode === 'issue' ? 'ออกบัญชี Login' : 'รีเซ็ตรหัสผ่าน'}
                  </h3>
                  <button type="button" onClick={() => setPwDialog(null)} className="text-slate-400 hover:text-slate-600 bg-white p-1.5 rounded-full shadow-sm"><X size={18}/></button>
               </div>
               <div className="p-6 space-y-4">
                  <p className="text-sm font-bold text-slate-600">
                     {pwDialog.mode === 'issue'
                        ? <>สร้างบัญชี login ให้ <span className="text-slate-900">{pwDialog.staff.name}</span> ({pwDialog.staff.email})</>
                        : <>ตั้งรหัสผ่านใหม่ให้ <span className="text-slate-900">{pwDialog.staff.name}</span> — รหัสเดิมและ session ที่ค้างอยู่จะใช้ไม่ได้ทันที</>}
                  </p>
                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>
                     <div className="flex gap-2">
                        <input type="text" minLength={8} value={pwDialog.password} onChange={e=>setPwDialog({...pwDialog, password: e.target.value})} className="flex-1 bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-mono font-bold outline-none focus:border-blue-500"/>
                        <button type="button" onClick={() => setPwDialog({...pwDialog, password: generatePassword()})} className="px-4 bg-slate-100 text-slate-500 rounded-xl hover:bg-blue-100 hover:text-blue-600 transition-colors" title="สุ่มรหัสผ่านใหม่">
                           <RefreshCw size={16}/>
                        </button>
                     </div>
                  </div>
               </div>
               <div className="p-6 bg-slate-50 border-t border-slate-100">
                  <button onClick={submitPasswordDialog} disabled={busy} className="w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase text-sm hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-lg shadow-blue-600/20">
                     {busy ? 'กำลังดำเนินการ...' : pwDialog.mode === 'issue' ? 'สร้างบัญชี' : 'ตั้งรหัสผ่านใหม่'}
                  </button>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};
