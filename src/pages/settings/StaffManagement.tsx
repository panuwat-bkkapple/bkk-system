// src/pages/settings/StaffManagement.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  Users, ShieldCheck, KeyRound, Plus,
  Edit, Trash2, X, UserCog, AlertTriangle, Mail
} from 'lucide-react';

// Role ทั้ง 4 ค่านี้คือชุดเดียวที่ route guard ทั้งระบบรู้จัก (App.tsx,
// AdminLayout, settingsNav, canReviewAdjustments, functions/staffIdsByRoles).
// คำอธิบายต้องตรงกับ gate จริง — ถ้าแก้ gate ให้กลับมาแก้คำอธิบายด้วย
const ROLES = [
  { id: 'CEO', label: 'CEO / Owner', desc: 'เข้าถึงได้ทุกระบบ รวมจัดการพนักงาน ตั้งค่าระบบส่วนกลาง วิเคราะห์กำไร และอนุมัติ Offer', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { id: 'MANAGER', label: 'Manager (ผู้จัดการ)', desc: 'เกือบทุกระบบ: Tickets, สต็อก, CRM, Analytics, Catalog, คูปอง และอนุมัติ Offer — ยกเว้นจัดการพนักงาน ตั้งค่าส่วนกลาง และรายงานการเงิน/ภาษี', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'STAFF', label: 'Staff (พนักงานทั่วไป)', desc: 'งานปฏิบัติการพื้นฐาน: Tickets, QC Lab, คลังสินค้า, POS, ประวัติการขาย — เสนอ Offer ได้แต่ต้องรอ CEO/Manager อนุมัติ', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { id: 'FINANCE', label: 'Finance (บัญชี/การเงิน)', desc: 'ระบบบัญชีและการเงิน: Finance, เบิกจ่าย, P&L, ภ.พ.30, สมุดรายวัน, ตั้งค่าระบบบัญชี และงานพื้นฐาน', color: 'bg-amber-100 text-amber-700 border-amber-200' },
];

const VALID_ROLE_IDS = ROLES.map(r => r.id);

// อ่าน session ของคนที่ล็อกอินอยู่ (รูปเดียวกับ useStaffSession) เพื่อกัน
// ลบ/ปิดบัญชีตัวเอง
const readSession = (): { id?: string; email?: string } | null => {
  try {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  role: 'STAFF',
  pin: '',
  branch: 'Main Store',
  status: 'ACTIVE',
};

export const StaffManagement = () => {
  const toast = useToast();
  const { data: staff, loading } = useDatabase('staff');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ ...EMPTY_FORM });

  const staffList = useMemo(() => {
    if (!staff) return [];
    return Array.isArray(staff) ? staff : Object.keys(staff).map(k => ({ id: k, ...(staff as any)[k] }));
  }, [staff]);

  const session = useMemo(() => readSession(), []);

  const isSelf = (emp: any) => {
    if (!session) return false;
    if (session.id && emp.id === session.id) return true;
    if (session.email && emp.email && normalizeEmail(session.email) === normalizeEmail(emp.email)) return true;
    return false;
  };

  // CEO ที่ยัง ACTIVE — ห้ามลบ/ลด role/ปิดสถานะจนเหลือศูนย์ ไม่งั้นไม่มีใคร
  // เข้าหน้านี้ (route /staff เปิดให้ CEO เท่านั้น) = ล็อคตัวเองออกจากระบบถาวร
  const activeCeos = useMemo(
    () => staffList.filter(s => s.role === 'CEO' && s.status === 'ACTIVE'),
    [staffList]
  );

  const handleOpenModal = (staffItem?: any) => {
    if (staffItem) {
      setEditingId(staffItem.id);
      setFormData({
        name: staffItem.name || '',
        phone: staffItem.phone || '',
        email: staffItem.email || '',
        // role เก่าที่ไม่รู้จัก (เช่น CASHIER/QC จากระบบเดิม) ปล่อยให้ค้างไว้
        // เพื่อบังคับให้ผู้ใช้เลือกใหม่ก่อนบันทึก (handleSave block ไว้)
        role: staffItem.role || 'STAFF',
        pin: staffItem.pin || '',
        branch: staffItem.branch || 'Main Store',
        status: staffItem.status || 'ACTIVE',
      });
    } else {
      setEditingId(null);
      setFormData({ ...EMPTY_FORM });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.pin.length !== 4) { toast.warning('รหัส PIN ต้องมี 4 หลัก'); return; }
    if (!VALID_ROLE_IDS.includes(formData.role)) {
      toast.warning('กรุณาเลือก Role ใหม่ — role เดิมของพนักงานคนนี้ไม่มีในระบบแล้ว');
      return;
    }

    const email = normalizeEmail(formData.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.warning('กรุณากรอกอีเมลให้ถูกต้อง — ระบบใช้อีเมลผูก role ตอน login');
      return;
    }
    const emailTaken = staffList.some(
      s => s.id !== editingId && s.email && normalizeEmail(s.email) === email
    );
    if (emailTaken) {
      toast.warning('อีเมลนี้ถูกใช้กับพนักงานคนอื่นแล้ว');
      return;
    }

    // กันแก้ CEO ที่ ACTIVE คนสุดท้ายให้หลุดจากตำแหน่ง (เปลี่ยน role หรือปิดสถานะ)
    if (editingId) {
      const isLastActiveCeo = activeCeos.length === 1 && activeCeos[0].id === editingId;
      const losesCeo = formData.role !== 'CEO' || formData.status !== 'ACTIVE';
      if (isLastActiveCeo && losesCeo) {
        toast.warning('ต้องมี CEO ที่ Active อย่างน้อย 1 คนเสมอ — ตั้ง CEO คนใหม่ก่อนแล้วค่อยแก้คนนี้');
        return;
      }
    }

    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      email,
      role: formData.role,
      pin: formData.pin,
      branch: formData.branch,
      status: formData.status,
    };

    try {
      if (editingId) {
        await update(ref(db, `staff/${editingId}`), { ...payload, updated_at: Date.now() });
        toast.success('บันทึกข้อมูลพนักงานแล้ว');
      } else {
        await push(ref(db, 'staff'), { ...payload, created_at: Date.now() });
        toast.success('เพิ่มพนักงานใหม่แล้ว');
      }
      setIsModalOpen(false);
    } catch (error) {
      toast.error('เกิดข้อผิดพลาด: ' + error);
    }
  };

  const handleDelete = async (emp: any) => {
    if (isSelf(emp)) {
      toast.warning('ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้');
      return;
    }
    if (emp.role === 'CEO' && emp.status === 'ACTIVE' && activeCeos.length <= 1) {
      toast.warning('ต้องมี CEO ที่ Active อย่างน้อย 1 คนเสมอ — ตั้ง CEO คนใหม่ก่อนแล้วค่อยลบ');
      return;
    }
    if (window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบพนักงาน "${emp.name}" ออกจากระบบ?`)) {
      try {
        await remove(ref(db, `staff/${emp.id}`));
      } catch (error) {
        toast.error('เกิดข้อผิดพลาด: ' + error);
      }
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
          <p className="text-sm text-slate-500 font-bold mt-1">จัดการรายชื่อพนักงานและสิทธิ์การเข้าถึงระบบ</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black uppercase text-sm hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
        >
          <Plus size={18}/> เพิ่มพนักงานใหม่
        </button>
      </div>

      {/* Security Warning */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
         <AlertTriangle className="text-amber-500 shrink-0" size={20}/>
         <div>
            <h4 className="font-black text-amber-800 text-sm">Security Policy (นโยบายความปลอดภัย)</h4>
            <p className="text-xs font-bold text-amber-700/80 mt-1 leading-relaxed">
               รหัส PIN 4 หลักของพนักงานใช้สำหรับยืนยันตัวตนก่อนเข้าใช้งานระบบ (Login) และใช้สำหรับการอนุมัติรายการสำคัญ (เช่น Void บิล) กรุณากำชับพนักงานไม่ให้เปิดเผยรหัส PIN แก่ผู้อื่น
               อีเมลของพนักงานต้องตรงกับอีเมลที่ใช้ login เข้าระบบ — ระบบใช้อีเมลจับคู่ role และสิทธิ์การอนุมัติ
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
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">สาขา (Branch)</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">รหัสเข้าเครื่อง (PIN)</th>
              <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {staffList.length === 0 ? (
               <tr><td colSpan={6} className="p-10 text-center text-slate-400 font-bold italic">ยังไม่มีข้อมูลพนักงาน กรุณาเพิ่มพนักงานใหม่</td></tr>
            ) : (
               staffList.map((emp) => {
                  const roleDef = ROLES.find(r => r.id === emp.role);
                  return (
                     <tr key={emp.id} className={`hover:bg-slate-50 transition-colors ${emp.status !== 'ACTIVE' ? 'opacity-50' : ''}`}>
                        <td className="p-5">
                           <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-400">{emp.name?.charAt(0)}</div>
                              <div>
                                 <div className="font-black text-slate-800 flex items-center gap-2">
                                    {emp.name}
                                    {isSelf(emp) && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">คุณ</span>}
                                    {emp.status !== 'ACTIVE' && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">INACTIVE</span>}
                                 </div>
                                 <div className="text-xs font-bold text-slate-400">{emp.phone}</div>
                              </div>
                           </div>
                        </td>
                        <td className="p-5">
                           {emp.email ? (
                              <span className="text-sm font-bold text-slate-600">{emp.email}</span>
                           ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-red-500 bg-red-50 border border-red-200 px-2 py-1 rounded-lg uppercase">
                                 <AlertTriangle size={11}/> ไม่มีอีเมล — role ไม่ทำงานตอน login
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
                        <td className="p-5 font-bold text-slate-600 text-sm">{emp.branch}</td>
                        <td className="p-5 text-center">
                           <div className="inline-flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl font-mono text-sm font-black text-slate-500 tracking-widest">
                              <KeyRound size={12} className="text-slate-400"/> {emp.pin ? '••••' : 'N/A'}
                           </div>
                        </td>
                        <td className="p-5 text-right">
                           <div className="flex justify-end gap-2">
                              <button onClick={() => handleOpenModal(emp)} className="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-blue-100 hover:text-blue-600 transition-colors"><Edit size={16}/></button>
                              <button onClick={() => handleDelete(emp)} className="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors"><Trash2 size={16}/></button>
                           </div>
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

                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block flex items-center gap-1"><Mail size={11}/> อีเมล (ใช้ login)</label>
                     <input required type="email" value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500" placeholder="staff@bkkapple.com"/>
                     <p className="text-[9px] text-slate-400 mt-1 font-bold">ต้องตรงกับอีเมลบัญชีที่ใช้ login — ระบบใช้อีเมลจับคู่ role และสิทธิ์อนุมัติ</p>
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

                  <div className="grid grid-cols-2 gap-4 pt-2">
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">ตั้งรหัส PIN (4 หลัก)</label>
                        <input required type="text" maxLength={4} pattern="\d{4}" value={formData.pin} onChange={e=>setFormData({...formData, pin: e.target.value.replace(/\D/g, '')})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-mono text-xl font-black text-center tracking-[0.5em] outline-none focus:border-blue-500" placeholder="••••"/>
                        <p className="text-[9px] text-slate-400 mt-1 font-bold text-center">ใช้สำหรับ Login เข้าระบบ</p>
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">สถานะพนักงาน</label>
                        <select value={formData.status} onChange={e=>setFormData({...formData, status: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-blue-500">
                           <option value="ACTIVE">ทำงานอยู่ (Active)</option>
                           <option value="INACTIVE">ลาออก/พักงาน (Inactive)</option>
                        </select>
                     </div>
                  </div>
               </div>

               <div className="p-6 bg-slate-50 border-t border-slate-100">
                  <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">
                     บันทึกข้อมูลพนักงาน
                  </button>
               </div>
            </form>
         </div>
      )}
    </div>
  );
};
