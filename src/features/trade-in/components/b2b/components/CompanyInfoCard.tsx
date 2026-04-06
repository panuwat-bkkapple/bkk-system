import React from 'react';
import { Building2, User, Phone, Mail, MapPin, Pencil, Save, Copy } from 'lucide-react';
import { useToast } from '../../../../../components/ui/ToastProvider';

interface EditCompanyData {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  assetDetails: string;
}

interface CompanyInfoCardProps {
  job: any;
  isEditing: boolean;
  editData: EditCompanyData;
  onSave: () => void;
  onToggleEdit: (editing: boolean) => void;
  onEditChange: (data: EditCompanyData) => void;
}

export const CompanyInfoCard = ({ job, isEditing, editData, onSave, onToggleEdit, onEditChange }: CompanyInfoCardProps) => {
  const toast = useToast();
  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes(String(job.status || '').toLowerCase());

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('คัดลอกลิงก์เรียบร้อยแล้ว');
  };

  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6 relative">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
          <Building2 className="text-indigo-500" size={20}/> 1. Company Information
        </h3>
        {!isEditing && !isCancelled && (
          <button onClick={() => onToggleEdit(true)} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
            <Pencil size={14} /> แก้ไขข้อมูล
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 space-y-4 animate-in fade-in">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Company Name</label><input type="text" value={editData.companyName} onChange={e=>onEditChange({...editData, companyName: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
            <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Contact Person</label><input type="text" value={editData.contactName} onChange={e=>onEditChange({...editData, contactName: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
            <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Phone</label><input type="text" value={editData.phone} onChange={e=>onEditChange({...editData, phone: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
            <div><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Email</label><input type="email" value={editData.email} onChange={e=>onEditChange({...editData, email: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
            <div className="col-span-2"><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Address</label><input type="text" value={editData.address} onChange={e=>onEditChange({...editData, address: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400" /></div>
            <div className="col-span-2"><label className="text-[10px] font-black text-indigo-700 uppercase tracking-widest block mb-1">Asset Details</label><textarea value={editData.assetDetails} onChange={e=>onEditChange({...editData, assetDetails: e.target.value})} className="w-full bg-white border border-indigo-200 p-3 rounded-xl text-sm font-bold outline-none focus:border-indigo-400 min-h-[80px]" /></div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => onToggleEdit(false)} className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-200 transition-colors">ยกเลิก</button>
            <button onClick={onSave} className="px-6 py-2.5 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-transform active:scale-95"><Save size={14}/> บันทึกข้อมูล</button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">ผู้ติดต่อ</label><div className="font-black text-slate-800 flex items-center gap-2"><User size={16} className="text-indigo-500" />{(job.cust_name || '').split('(')[1]?.replace(')', '') || job.cust_name || '-'}</div></div>
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">เบอร์โทรศัพท์</label><div className="font-black text-blue-600 flex items-center gap-2"><Phone size={16} />{job.cust_phone}</div></div>
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">อีเมล</label><div className="font-black text-slate-800 flex items-center gap-2"><Mail size={16} className="text-indigo-500" />{job.cust_email || '-'}</div></div>
            {job.cust_address && <div className="col-span-3 bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">ที่อยู่องค์กร</label><div className="text-sm font-bold text-slate-700 flex items-center gap-2"><MapPin size={16} className="text-indigo-500"/> {job.cust_address}</div></div>}
            <div className="col-span-3 bg-slate-50 p-5 rounded-2xl border border-slate-100"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">รายละเอียดทรัพย์สิน (แจ้งเบื้องต้น)</label><div className="text-sm font-bold text-slate-700">{job.asset_details || 'ระบุยกล็อต (ดูไฟล์แนบ)'}</div></div>
          </div>
          <div className="pt-2">
            <button onClick={() => copyToClipboard(`${window.location.origin}/quote/${job.id}`)} className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-indigo-500 uppercase tracking-widest transition-colors"><Copy size={14} /> คัดลอกลิงก์ให้ลูกค้าติดตามสถานะ (Tracking Link)</button>
          </div>
        </>
      )}
    </div>
  );
};
