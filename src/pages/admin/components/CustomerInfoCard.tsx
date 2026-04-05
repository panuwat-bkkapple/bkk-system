import React, { useState } from 'react';
import {
  User, Phone, MapPin, Store, Bike, Truck, Navigation, Map,
  Pencil, Save, PackageOpen, X
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '@/api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';

interface CustomerInfoCardProps {
  job: any;
  isEditing: boolean;
  editData: { name: string; phone: string; email: string; address: string };
  onSave: () => void;
  onToggleEdit: (editing: boolean, data?: { name: string; phone: string; email: string; address: string }) => void;
  onEditChange: (data: { name: string; phone: string; email: string; address: string }) => void;
}

export const CustomerInfoCard: React.FC<CustomerInfoCardProps> = ({
  job, isEditing, editData, onSave, onToggleEdit, onEditChange
}) => {
  const toast = useToast();
  const [isEditingTracking, setIsEditingTracking] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [courierInput, setCourierInput] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);

  const handleSaveTracking = async () => {
    if (!trackingInput.trim()) {
      toast.error('กรุณากรอกเลข Tracking');
      return;
    }
    setSavingTracking(true);
    try {
      const statusLower = String(job.status || '').trim().toLowerCase();
      const shouldTransit = ['new lead', 'following up', 'appointment set', 'waiting drop-off', 'active leads'].includes(statusLower);
      const payload: any = {
        tracking_number: trackingInput.trim(),
        courier_name: courierInput.trim() || '',
        updated_at: Date.now(),
      };
      if (shouldTransit) {
        payload.status = 'In-Transit';
        payload.qc_logs = [
          { action: 'In-Transit', by: 'Admin', timestamp: Date.now(), details: `อัพเดทเลขพัสดุ: ${trackingInput.trim()} — สถานะเปลี่ยนเป็นกำลังจัดส่ง` },
          ...(job.qc_logs || [])
        ];
      }
      await update(ref(db, `jobs/${job.id}`), payload);
      toast.success(shouldTransit ? 'บันทึก Tracking และอัพเดทสถานะเป็น In-Transit เรียบร้อย' : 'อัพเดท Tracking Number เรียบร้อย');
      setIsEditingTracking(false);
    } catch {
      toast.error('ไม่สามารถบันทึกได้ ลองใหม่อีกครั้ง');
    } finally {
      setSavingTracking(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('คัดลอกลิงก์เรียบร้อยแล้ว');
  };

  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 grid grid-cols-2 gap-8">
      <div className="space-y-6">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-2">Logistics & Location</p>

        {job.receive_method === 'Mail-in' ? (
          <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl">
            {isEditingTracking ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest flex items-center gap-2">
                    <Truck size={16} /> อัพเดท Tracking Number
                  </p>
                  <button onClick={() => setIsEditingTracking(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={16} />
                  </button>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 ml-1">ขนส่ง (เช่น Kerry, Flash, J&T)</label>
                  <input
                    type="text"
                    value={courierInput}
                    onChange={e => setCourierInput(e.target.value)}
                    placeholder="ชื่อขนส่ง"
                    className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-orange-400 mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 ml-1">เลข Tracking</label>
                  <input
                    type="text"
                    value={trackingInput}
                    onChange={e => setTrackingInput(e.target.value)}
                    placeholder="เลข Tracking Number"
                    className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-orange-400 font-mono mt-1"
                  />
                </div>
                <button
                  onClick={handleSaveTracking}
                  disabled={savingTracking}
                  className="w-full text-xs font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 py-2.5 rounded-xl flex justify-center items-center gap-1 shadow-md transition-colors"
                >
                  <Save size={14} /> {savingTracking ? 'กำลังบันทึก...' : 'บันทึก Tracking'}
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <Truck className="text-orange-500 shrink-0" size={20} />
                <div className="flex-1">
                  <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest flex items-center gap-2">ส่งพัสดุ (Mail-in)</p>
                  {job.tracking_number ? (
                    <div className="mt-1">
                      {job.courier_name && (
                        <p className="text-[10px] font-bold text-slate-500">{job.courier_name}</p>
                      )}
                      <p className="text-sm font-black text-orange-700 tracking-wider font-mono">{job.tracking_number}</p>
                      <p className="text-[10px] font-bold text-slate-500 mt-0.5">เลขพัสดุถูกบันทึกแล้ว รอรับของ</p>
                    </div>
                  ) : (
                    <p className="text-[11px] font-bold text-slate-500 mt-1">รอลูกค้าส่งพัสดุและแจ้ง Tracking...</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setTrackingInput(job.tracking_number || '');
                    setCourierInput(job.courier_name || '');
                    setIsEditingTracking(true);
                  }}
                  className="text-slate-400 hover:text-orange-500 p-1.5 bg-white rounded-lg shadow-sm border border-orange-200 transition-colors shrink-0"
                  title="แก้ไข Tracking Number"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>
        ) : job.receive_method === 'Store-in' ? (
          <div className="p-4 bg-purple-50 border border-purple-100 rounded-2xl flex items-start gap-3">
            <Store className="text-purple-500 shrink-0" size={20} />
            <div>
              <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">นัดหมายสาขา (Store)</p>
              <p className="text-sm font-black text-purple-900">
                {job.branch_details?.name || job.branch_name || job.store_branch || 'BKK APPLE (Head Office)'}
              </p>
              {job.branch_details?.address && (
                <p className="text-[10px] font-bold text-purple-700/70 mt-1 line-clamp-1">{job.branch_details.address}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
            <Bike className="text-blue-500 shrink-0" size={20} />
            <div>
              <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">Pickup Service <span className="bg-blue-200 text-blue-700 px-1.5 rounded text-[8px]">RIDER</span></p>
              <p className="text-[11px] font-bold text-slate-600 mt-1 line-clamp-2">{job.cust_address || 'ไม่มีข้อมูลที่อยู่'}</p>
            </div>
          </div>
        )}

        {job.receive_method === 'Pickup' && job.rider_name && (
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between mt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white text-blue-500 rounded-full flex items-center justify-center shadow-sm"><Navigation size={16} /></div>
              <div>
                <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">พนักงานเข้ารับเครื่อง</p>
                <p className="text-xs font-black text-slate-800">{job.rider_name}</p>
                <p className="text-[9px] font-bold text-slate-500">โทร: {job.rider_phone || '-'}</p>
              </div>
            </div>
            {job.tracking_url && (
              <a href={job.tracking_url} target="_blank" rel="noreferrer" className="p-2 bg-white text-blue-600 rounded-lg shadow-sm hover:bg-blue-100 transition-colors">
                <Map size={16} />
              </a>
            )}
          </div>
        )}
      </div>

      <div className="border-l border-slate-100 pl-8">
        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Customer Profile</p>
          {!isEditing && (
            <button onClick={() => {
              onToggleEdit(true, { name: job?.cust_name || '', phone: job?.cust_phone || '', email: job?.cust_email || '', address: job?.cust_address || job?.store_branch || '' });
            }} className="text-slate-400 hover:text-blue-500 p-1.5 bg-slate-50 rounded-lg shadow-sm border border-slate-200 transition-colors flex gap-2 items-center text-[10px] font-bold uppercase">
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-blue-200 shadow-inner animate-in fade-in">
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-1">ชื่อลูกค้า</label>
              <input type="text" value={editData.name} onChange={e => onEditChange({ ...editData, name: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-1">เบอร์โทร</label>
                <input type="text" value={editData.phone} onChange={e => onEditChange({ ...editData, phone: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-1">อีเมล</label>
                <input type="email" value={editData.email} onChange={e => onEditChange({ ...editData, email: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-1">{job.receive_method === 'Store-in' ? 'สาขานัดหมาย' : 'ที่อยู่จัดส่ง'}</label>
              <textarea value={editData.address} onChange={e => onEditChange({ ...editData, address: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => onToggleEdit(false)} className="flex-1 text-xs font-bold text-slate-500 bg-white border border-slate-200 py-2 rounded-xl hover:bg-slate-50">ยกเลิก</button>
              <button onClick={onSave} className="flex-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 py-2 rounded-xl flex justify-center items-center gap-1 shadow-md"><Save size={14} /> บันทึกข้อมูล</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 font-black text-xl shrink-0 border border-slate-100"><User size={24} /></div>
              <div>
                <p className="text-base font-black text-slate-800 leading-tight">{job.cust_name || 'N/A'}</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm font-bold text-blue-500">{job.cust_phone}</p>
                  <a href={`tel:${job.cust_phone}`} className="bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 hover:bg-emerald-200"><Phone size={10} /> โทร</a>
                </div>
                {job.cust_email && <p className="text-xs font-medium text-slate-500 mt-1">{job.cust_email}</p>}
              </div>
            </div>
            {!isEditing && (
              <button onClick={() => copyToClipboard(`https://bkk-apple.com/track/${job.ref_no || job.id}`)} className="w-full text-[10px] bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 px-3 py-2.5 rounded-xl font-bold transition-all flex justify-center items-center gap-2 border border-slate-200 shadow-sm active:scale-95 mt-5">
                <MapPin size={12} /> คัดลอกลิงก์ให้ลูกค้า (TRACKING LINK)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};