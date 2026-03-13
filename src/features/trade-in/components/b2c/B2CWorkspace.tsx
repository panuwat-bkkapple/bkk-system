// src/features/trade-in/components/b2c/B2CWorkspace.tsx
import React, { useState } from 'react';
import { 
  X, User, Phone, MapPin, MessageSquare, 
  CheckCircle2, AlertCircle, Store, ShieldCheck, 
  Landmark, Camera, AlertTriangle, Bike, ClipboardCheck, 
  ExternalLink, PackageOpen, Zap, CalendarDays, Search, ListChecks,
  ChevronLeft, History, Wallet, MessageCircle, Ticket, Plus,
  Mail, Pencil, Save, Clock // 🌟 เพิ่มไอคอนสำหรับ Edit
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { MethodBadge, TicketPipeline } from '../modal/TradeInUI'; 

// 🌟 Import Firebase
import { ref, update } from 'firebase/database';
import { db } from '@/api/firebase';

export const B2CWorkspace = ({ 
  job, onUpdateStatus, onClaimTicket, onSaveNotes, 
  onReviseOffer, setIsInspectionModalOpen, setActiveChatJobId, onClose 
}: any) => {
  
  const [callNotes, setCallNotes] = useState('');
  const [revisedPrice, setRevisedPrice] = useState('');
  const [reviseReason, setReviseReason] = useState('');

  // State สำหรับระบบ Admin Coupon
  const [isAddingCoupon, setIsAddingCoupon] = useState(false);
  const [adminCouponCode, setAdminCouponCode] = useState('');
  const [adminCouponValue, setAdminCouponValue] = useState('');

  // 🌟 State สำหรับโหมดแก้ไขข้อมูลลูกค้า
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [editCustData, setEditCustData] = useState({
      name: '', phone: '', email: '', address: ''
  });

  const statusLower = (job?.status || '').trim().toLowerCase();
  
  // 🌟 THE FIX 1: แก้ไขเงื่อนไขการ "จ่ายเงินแล้ว" ให้ถูกต้อง (ไม่รวม Payout Processing)
  const hasBeenPaid = !!job?.paid_at || !!job?.payment_slip || job?.qc_logs?.some((log: any) =>
    ['Paid', 'PAID', 'Payment Completed'].includes(log.action)
  ) || ['waiting for handover', 'paid', 'payment completed', 'sent to qc lab', 'in stock'].includes(statusLower);

  const isQCStage = ['pending qc', 'being inspected', 'qc review'].includes(statusLower);
  const showApproveButtons = isQCStage && !hasBeenPaid;
  
  // 🌟 เพิ่มตัวแปรสำหรับดักสถานะ "รอโอนเงิน"
  const isProcessingPayment = ['payout processing', 'waiting for finance', 'price accepted'].includes(statusLower);

  const pickupFee = Number(job?.pickup_fee || 0);
  const originalPrice = Number(job?.original_price || job?.price || 0);
  const couponValue = Number(job?.applied_coupon?.actual_value || job?.applied_coupon?.value || 0);
  const displayNetPayout = job?.revised_price || job?.negotiated_price || job?.net_payout || job?.final_price || job?.price || 0;

  const handleSaveCustomerInfo = async () => {
      // ... (โค้ดบันทึกลูกค้าเหมือนเดิม) ...
      try {
          const updatePayload: any = {
              cust_name: editCustData.name,
              cust_phone: editCustData.phone,
              cust_email: editCustData.email,
          };
          if (job.receive_method === 'Store-in') updatePayload.store_branch = editCustData.address;
          else updatePayload.cust_address = editCustData.address;

          const updatedLogs = [{ action: 'Customer Info Updated', by: 'Admin', timestamp: Date.now(), details: 'อัปเดตข้อมูลการติดต่อ/ที่อยู่ของลูกค้า' }, ...(job.qc_logs || [])];
          updatePayload.qc_logs = updatedLogs;

          await update(ref(db, `jobs/${job.id}`), updatePayload);
          setIsEditingCustomer(false);
      } catch (error) { alert('เกิดข้อผิดพลาดในการอัปเดตข้อมูล'); }
  };

  // 🌟 THE FIX 2: แก้สมการคณิตศาสตร์ตอนเติมคูปอง (ไม่ให้ไปทับราคาตั้งต้น)
  const handleApplyAdminCoupon = () => {
    if (!adminCouponCode || !adminCouponValue) return alert('กรุณาระบุชื่อโค้ดและจำนวนเงิน');
    const val = Number(adminCouponValue);
    
    // ดึงราคาเครื่องปัจจุบันมาเป็นฐาน (ห้ามใช้ displayNetPayout เพราะมันอาจโดนหักค่ารถไปแล้ว)
    const currentBasePrice = Number(job?.final_price || job?.price || 0);
    // คำนวณยอดโอนใหม่ (ราคาเครื่อง - ค่ารถ + คูปองใหม่) และป้องกันติดลบ
    const newNetPayout = Math.max(0, currentBasePrice - pickupFee + val);

    onUpdateStatus(
      job.id, 
      job.status, 
      `แอดมินเพิ่มคูปอง/Top-up พิเศษ: ${adminCouponCode} (+${val}฿)`, 
      {
        applied_coupon: { code: adminCouponCode, name: 'Admin Manual Top-up', value: val, actual_value: val },
        net_payout: newNetPayout
        // ❌ เอา final_price และ price ออกไปเลย จะได้ไม่ไปทับข้อมูลเดิม
      }
    );
    setIsAddingCoupon(false); setAdminCouponCode(''); setAdminCouponValue('');
  };

  // 🌟 THE FIX 3: ป้องกันยอดติดลบตอนดึงคูปองออก
  const handleRemoveCoupon = () => {
    if (confirm('ยืนยันการลบคูปองและดึงเงินกลับ?')) {
      const currentBasePrice = Number(job?.final_price || job?.price || 0);
      const newNetPayout = Math.max(0, currentBasePrice - pickupFee); // 🛡️ ใส่ Math.max ป้องกันติดลบ

      onUpdateStatus(
        job.id, 
        job.status, 
        `แอดมินยกเลิกการใช้คูปอง: ${job.applied_coupon?.code} (-${couponValue}฿)`, 
        {
          applied_coupon: null,
          net_payout: newNetPayout
        }
      );
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden animate-in fade-in duration-500">
      
      {/* ⬅️ LEFT CONTENT: Workspace Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-8 pb-24">
        
        {/* Navigation & Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onClose} className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all shadow-sm">
            <ChevronLeft size={24} className="text-slate-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">{job.model}</h1>
              <span className="bg-blue-100 text-blue-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-blue-200">
                {job.receive_method}
              </span>
            </div>
            <p className="text-[11px] font-bold text-slate-400 mt-1 tracking-widest uppercase">TICKET ID: {job.ref_no}</p>
          </div>
        </div>

        <div className="space-y-6">
          
          {/* Customer & Appointment Detail Card */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm grid grid-cols-2 gap-8">
            <div className="flex flex-col h-full justify-between">
              <div className="space-y-6">
                {job.receive_method === 'Store-in' && (
                  <div className="p-4 bg-purple-50 border border-purple-100 rounded-2xl flex items-start gap-3">
                     <Store className="text-purple-500 shrink-0" size={20} />
                     <div>
                       <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Appointment Store</p>
                       <p className="text-sm font-black text-purple-900">{job.store_branch || 'BKK APPLE (Head Office)'}</p>
                     </div>
                  </div>
                )}
                
                {/* 🌟 ข้อมูลลูกค้า (Customer Profile) พร้อมปุ่ม Edit */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ข้อมูลลูกค้า (CUSTOMER)</p>
                      {!isEditingCustomer && (
                          <button onClick={() => {
                              // ดึงข้อมูลล่าสุดมาใส่ฟอร์ม
                              setEditCustData({
                                  name: job?.cust_name || '',
                                  phone: job?.cust_phone || '',
                                  email: job?.cust_email || '',
                                  address: job?.cust_address || job?.store_branch || ''
                              });
                              setIsEditingCustomer(true);
                          }} className="text-slate-400 hover:text-blue-500 p-1.5 bg-slate-50 rounded-lg shadow-sm border border-slate-200 transition-colors flex gap-2 items-center text-[10px] font-bold uppercase">
                              <Pencil size={12} /> แก้ไขข้อมูล
                          </button>
                      )}
                  </div>
                  
                  {isEditingCustomer ? (
                      <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-blue-200 shadow-inner animate-in fade-in">
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 ml-1">ชื่อลูกค้า</label>
                            <input type="text" value={editCustData.name} onChange={e => setEditCustData({...editCustData, name: e.target.value})} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 ml-1">เบอร์โทร</label>
                              <input type="text" value={editCustData.phone} onChange={e => setEditCustData({...editCustData, phone: e.target.value})} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-500 ml-1">อีเมล</label>
                              <input type="email" value={editCustData.email} onChange={e => setEditCustData({...editCustData, email: e.target.value})} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 ml-1">{job.receive_method === 'Store-in' ? 'สาขานัดหมาย' : 'ที่อยู่จัดส่ง'}</label>
                            <textarea value={editCustData.address} onChange={e => setEditCustData({...editCustData, address: e.target.value})} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" rows={2} />
                          </div>
                          <div className="flex gap-2 pt-2">
                              <button onClick={() => setIsEditingCustomer(false)} className="flex-1 text-xs font-bold text-slate-500 bg-white border border-slate-200 py-2 rounded-xl">ยกเลิก</button>
                              <button onClick={handleSaveCustomerInfo} className="flex-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 py-2 rounded-xl flex justify-center items-center gap-1 shadow-md"><Save size={14}/> บันทึกข้อมูล</button>
                          </div>
                      </div>
                  ) : (
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 font-black text-xl shrink-0"><User size={28}/></div>
                        <div>
                          <p className="text-xl font-black text-slate-800 leading-tight">{job.cust_name || 'N/A'}</p>
                          <div className="flex flex-col gap-1 mt-2">
                            <p className="text-sm font-bold text-blue-500 flex items-center gap-1.5"><Phone size={14}/> {job.cust_phone}</p>
                            {job.cust_email && <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5"><Mail size={12}/> {job.cust_email}</p>}
                          </div>
                          {job.receive_method === 'Store-in' ? (
                              <p className="text-xs font-bold text-purple-600 mt-2 bg-purple-50 inline-block px-2 py-1 rounded-lg border border-purple-100"><Store size={12} className="inline mr-1"/> {job.store_branch || 'BKK APPLE'}</p>
                          ) : job.cust_address && (
                              <p className="text-xs font-medium text-slate-500 mt-2 leading-relaxed line-clamp-2"><MapPin size={12} className="inline mr-1 text-red-400"/> {job.cust_address}</p>
                          )}
                        </div>
                      </div>
                  )}
                </div>
              </div>

              {/* ข้อมูลบัญชีธนาคาร */}
              {(job.payment_info || job.bank_account) && (
                <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-4">
                  <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-xl shrink-0"><Landmark size={20} /></div>
                  <div className="flex-1">
                    <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Payment Account</p>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-black text-slate-800">{job.payment_info?.bank || job.bank_name}</p>
                        <p className="text-xs font-bold text-slate-600 font-mono mt-0.5">{job.payment_info?.account_number || job.bank_account}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Account Name</p>
                        <p className="text-xs font-bold text-slate-700">{job.payment_info?.account_name || job.bank_holder || '-'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-l border-slate-100 pl-8">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Service Timeline</p>
               <TicketPipeline status={job.status} />
            </div>
          </div>

          {/* Condition Match Comparison */}
          <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm space-y-8">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
              <ShieldCheck className="text-blue-500" size={20}/> Condition Match Verification
            </h3>
            
            {(job.devices && job.devices.length > 0 ? job.devices : [job]).map((device: any, index: number) => {
              const riderDeductions = device.deductions || (index === 0 ? job.deductions : []) || [];
              const isInspected = device.inspection_status === "Inspected" || statusLower === "qc review";

              return (
                <div key={index} className="grid grid-cols-2 gap-6 bg-slate-50 p-6 rounded-[2.5rem] border border-slate-100">
                  <div className="space-y-4">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">ลูกค้าแจ้งมาเบื้องต้น</p>
                     <div className="bg-white p-5 rounded-3xl border border-slate-200 min-h-[150px]">
                        {device.isNewDevice ? (
                          <div className="bg-blue-50 text-blue-600 p-4 rounded-xl font-bold text-xs flex items-center gap-2 border border-blue-100"><PackageOpen size={16}/> เครื่องใหม่มือ 1 (ยังไม่แกะซีล)</div>
                        ) : (
                          <ul className="space-y-2">
                            {(device.customer_conditions || []).map((c: string, i: number) => (
                              <li key={i} className="text-xs font-bold text-slate-600 flex items-start gap-2">
                                <span className="text-blue-400 mt-1">•</span>{c}
                              </li>
                            ))}
                          </ul>
                        )}
                     </div>
                  </div>

                  <div className="space-y-4">
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">พนักงาน/ไรเดอร์ ตรวจพบ</p>
                     <div className="bg-white p-5 rounded-3xl border border-slate-200 min-h-[150px]">
                        {riderDeductions.length > 0 ? (
                           <ul className="space-y-2">
                             {riderDeductions.map((d: string, i: number) => (
                               <li key={i} className="bg-red-50 text-red-700 p-3 rounded-xl text-xs font-bold border border-red-100 flex items-start gap-2">
                                 <AlertTriangle size={14} className="mt-0.5" />{d}
                               </li>
                             ))}
                           </ul>
                        ) : isInspected ? (
                          <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl font-bold text-xs flex items-center gap-2 border border-emerald-100 h-full"><CheckCircle2 size={16}/> สภาพสมบูรณ์ ตรงตามประเมิน</div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-slate-300">
                             <Search size={32} className="mb-2 opacity-20" />
                             <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Waiting for QC</p>
                          </div>
                        )}
                     </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Photo Gallery Section */}
          <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><Camera size={16}/> Inspection Gallery</p>
             <div className="grid grid-cols-4 gap-4">
                {(job.photos || []).map((url: string, i: number) => (
                   <a key={i} href={url} target="_blank" className="aspect-square rounded-3xl overflow-hidden border-2 border-slate-100 hover:border-blue-400 transition-all shadow-sm">
                      <img src={url} className="w-full h-full object-cover" />
                   </a>
                ))}
                {(!job.photos || job.photos.length === 0) && (
                  <div className="col-span-4 py-20 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
                     <Camera size={40} className="mx-auto text-slate-200 mb-2" />
                     <p className="text-xs font-bold text-slate-400 uppercase">ไม่มีรูปถ่ายหน้างานในระบบ</p>
                  </div>
                )}
             </div>
          </div>
        </div>
      </div>

      {/* ➡️ RIGHT SIDEBAR: Action Control */}
      <div className="w-[450px] bg-white border-l border-slate-200 flex flex-col shadow-2xl relative z-10 shrink-0">
        
        {/* Top Summary: Sticky Price & Approve */}
        <div className="p-8 bg-slate-900 text-white shadow-xl relative overflow-hidden shrink-0">
           <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/20 blur-3xl rounded-full -mr-16 -mt-16"></div>
           
           <div className="relative z-10">
             <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 mb-2">Total Net Payout</p>
             <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black tracking-tighter text-white">
                  {formatCurrency(displayNetPayout)}
                </span>
                <span className="text-blue-400 font-bold">THB</span>
             </div>
           </div>

           {(pickupFee > 0 || originalPrice > 0 || couponValue > 0) && (
              <div className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-[10px] font-bold text-slate-300 uppercase tracking-widest relative z-10">
                 {originalPrice > 0 && (
                   <div className="flex justify-between">
                     <span>รวมราคาประเมิน ({job.total_devices || 1} เครื่อง)</span>
                     <span className="text-white">฿{formatCurrency(originalPrice)}</span>
                   </div>
                 )}
                 {pickupFee > 0 && (
                   <div className="flex justify-between text-red-400">
                     <span>หักค่าบริการไรเดอร์</span>
                     <span>- ฿{formatCurrency(pickupFee)}</span>
                   </div>
                 )}
                 {couponValue > 0 && (
                   <div className="flex justify-between text-emerald-400">
                     <span>คูปอง ({job.applied_coupon?.code})</span>
                     <span>+ ฿{formatCurrency(couponValue)}</span>
                   </div>
                 )}
              </div>
           )}

           {/* Coupon Management */}
           <div className="mt-4 relative z-10">
             {job.applied_coupon ? (
               <div className="bg-white/10 border border-white/20 p-4 rounded-2xl flex justify-between items-center backdrop-blur-sm group transition-all">
                 <div className="flex items-center gap-3">
                   <div className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400"><Ticket size={18} /></div>
                   <div>
                     <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-0.5">Applied Coupon</p>
                     <p className="text-xs font-black text-white">{job.applied_coupon.code}</p>
                   </div>
                 </div>
                 <div className="text-right flex items-center gap-3">
                   <div>
                     <p className="text-[9px] text-slate-400 mb-0.5 uppercase tracking-widest">Top-up Value</p>
                     <p className="text-sm font-black text-emerald-400">+{couponValue} ฿</p>
                   </div>
                   {showApproveButtons && (
                     <button 
                       onClick={handleRemoveCoupon}
                       className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-all opacity-0 group-hover:opacity-100"
                       title="นำคูปองออก"
                     >
                       <X size={14} />
                     </button>
                   )}
                 </div>
               </div>
             ) : (
               showApproveButtons && (
                 !isAddingCoupon ? (
                   <button 
                     onClick={() => setIsAddingCoupon(true)}
                     className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 border-dashed text-blue-300 hover:text-blue-200 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                   >
                     <Plus size={14} /> Apply Manual Top-up
                   </button>
                 ) : (
                   <div className="bg-white/10 border border-white/20 p-4 rounded-2xl space-y-3 backdrop-blur-sm animate-in zoom-in-95">
                     <div className="flex justify-between items-center mb-1">
                       <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Admin Manual Top-up</p>
                       <button onClick={() => setIsAddingCoupon(false)} className="text-slate-400 hover:text-white transition-colors"><X size={14}/></button>
                     </div>
                     <div className="flex gap-2">
                       <input 
                         type="text" 
                         placeholder="Code หรือ เหตุผล..." 
                         value={adminCouponCode}
                         onChange={e => setAdminCouponCode(e.target.value)}
                         className="flex-1 bg-slate-900/50 border border-white/10 text-white px-3 py-2 rounded-xl text-xs outline-none focus:border-blue-400 placeholder:text-slate-500"
                       />
                       <div className="relative w-28">
                         <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-xs">+</span>
                         <input 
                           type="number" 
                           placeholder="0" 
                           value={adminCouponValue}
                           onChange={e => setAdminCouponValue(e.target.value)}
                           className="w-full bg-slate-900/50 border border-white/10 text-emerald-400 pl-6 pr-2 py-2 rounded-xl text-xs font-black outline-none focus:border-emerald-400 placeholder:text-emerald-900/50"
                         />
                       </div>
                     </div>
                     <button 
                       onClick={handleApplyAdminCoupon}
                       disabled={!adminCouponCode || !adminCouponValue}
                       className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-2.5 rounded-xl text-xs font-black uppercase transition-all disabled:opacity-50"
                     >
                       Apply Top-up
                     </button>
                   </div>
                 )
               )
             )}
           </div>

           {showApproveButtons ? (
              <button 
                onClick={() => onUpdateStatus(job.id, 'Payout Processing', 'แอดมินตรวจสอบรายละเอียดและอนุมัติราคาทั้งหมด')}
                className="w-full mt-6 bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-blue-900/50 transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                <CheckCircle2 size={20} /> Approve Order
              </button>
           ) : isProcessingPayment ? (
              <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 relative z-10">
                 <div className="p-2 bg-amber-500 rounded-xl text-white"><Clock size={16} className="animate-pulse" /></div>
                 <div>
                   <p className="text-xs font-black uppercase text-amber-500 tracking-wider">Waiting for Finance</p>
                   <p className="text-[10px] font-bold text-amber-500/70 mt-0.5">รอแผนกบัญชีตรวจสอบและโอนเงิน</p>
                 </div>
              </div>
           ) : hasBeenPaid ? (
              <div className="mt-6 bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center gap-3">
                 <div className="p-2 bg-emerald-500 rounded-xl text-white"><CheckCircle2 size={18}/></div>
                 <div>
                   <p className="text-xs font-black uppercase text-emerald-400">Payment Completed</p>
                   <p className="text-[10px] font-bold text-emerald-500/70">ปิดยอดการโอนเงินเรียบร้อยแล้ว</p>
                 </div>
              </div>
           ) : (
              <div className="mt-6 p-4 bg-white/5 border border-white/10 rounded-2xl text-center relative z-10">
                 <p className="text-[10px] font-bold text-slate-400 uppercase italic">Waiting for Status Change</p>
              </div>
           )}
        </div>

        {/* Sidebar Middle: Activity & Note Tabs */}
        <div className="flex-1 overflow-y-auto p-8 no-scrollbar space-y-8">
          
          {/* Internal Actions */}
          {showApproveButtons && (
            <div className="space-y-4 bg-purple-50 p-6 rounded-3xl border border-purple-100 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
              <label className="text-[11px] font-black text-purple-700 uppercase tracking-widest flex items-center gap-2"><Wallet size={16}/> Revised Offer (ตั้งราคาสุทธิใหม่)</label>
              <div className="space-y-3">
                <div className="relative">
                   <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
                   <input type="number" value={revisedPrice} onChange={e => setRevisedPrice(e.target.value)} placeholder="พิมพ์ยอดเงินสุทธิที่ต้องการโอน..." className="w-full bg-white border border-slate-200 pl-8 pr-4 py-4 rounded-2xl text-sm font-black outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all shadow-inner" />
                </div>
                <textarea value={reviseReason} onChange={e => setReviseReason(e.target.value)} placeholder="ระบุเหตุผลในการแก้ไขราคา เช่น ลูกค้ามีรอยตกบุบ..." className="w-full bg-white border border-slate-200 p-4 rounded-2xl text-xs font-bold min-h-[80px] outline-none focus:border-purple-500" />
                <button onClick={() => {onReviseOffer(job, revisedPrice, reviseReason); setRevisedPrice(''); setReviseReason('');}} className="w-full bg-purple-600 text-white py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all active:scale-95">ส่งข้อเสนอราคาใหม่ให้ลูกค้า</button>
              </div>
            </div>
          )}

          {/* Management Buttons */}
          <div className="space-y-3 pt-4">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2"><ListChecks size={14}/> Pipeline Operations</p>
             {statusLower === 'pending qc' && (
               <button onClick={() => setIsInspectionModalOpen(true)} className="w-full flex items-center justify-between p-4 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100 hover:bg-blue-100 transition-all font-black text-xs uppercase">
                 <span>Start Internal QC</span>
                 <ListChecks size={18} />
               </button>
             )}
             {hasBeenPaid && statusLower !== 'sent to qc lab' && statusLower !== 'in stock' && (
               <button onClick={() => onUpdateStatus(job.id, 'Sent to QC Lab', 'แอดมินส่งเครื่องเข้าห้องแล็บล้างข้อมูล')} className="w-full flex items-center justify-between p-4 bg-purple-600 text-white rounded-2xl shadow-lg shadow-purple-200 hover:bg-purple-700 transition-all font-black text-xs uppercase tracking-widest">
                 <span>Send to QC LAB</span>
                 <ShieldCheck size={18} />
               </button>
             )}
          </div>

          {/* Activity Logs */}
          <div className="space-y-4 pt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><History size={14}/> Activity Logs</p>
            <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-slate-100">
              {job.qc_logs?.map((log: any, i: number) => (
                <div key={i} className="flex gap-4 relative">
                  <div className={`w-6 h-6 rounded-full border-4 border-white shadow-sm shrink-0 z-10 ${i === 0 ? 'bg-blue-500 animate-pulse' : 'bg-slate-200'}`}></div>
                  <div>
                    <p className="text-[11px] font-black text-slate-800 uppercase leading-none">{log.action}</p>
                    <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">{log.details}</p>
                    <div className="flex items-center gap-2 mt-2">
                       <span className="text-[8px] font-black text-blue-400 uppercase bg-blue-50 px-1.5 py-0.5 rounded">BY: {log.by}</span>
                       <span className="text-[8px] font-bold text-slate-300 uppercase">{formatDate(log.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="p-8 bg-slate-50 border-t border-slate-100 shrink-0">
           <div className="flex gap-3 mb-4">
              <button onClick={() => setActiveChatJobId(job.id)} className="flex-1 bg-white border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 hover:bg-slate-100 transition-all">
                <MessageCircle size={14} className="text-blue-500" /> View Chats
              </button>
              <button className="flex-1 bg-white border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 hover:bg-slate-100 transition-all">
                <ExternalLink size={14} /> Open Invoice
              </button>
           </div>
           <div className="relative">
              <input 
                type="text" 
                value={callNotes} 
                onChange={e => setCallNotes(e.target.value)}
                placeholder="พิมพ์บันทึกย่อการคุยกับลูกค้า..." 
                className="w-full bg-white border border-slate-200 p-4 pr-16 rounded-2xl text-xs font-bold outline-none focus:border-blue-500" 
              />
              <button 
                onClick={() => {onSaveNotes(job.id, callNotes); setCallNotes('');}}
                disabled={!callNotes.trim()}
                className="absolute right-2 top-2 bottom-2 bg-slate-900 text-white px-4 rounded-xl text-[9px] font-black uppercase disabled:opacity-30"
              >
                Save
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};