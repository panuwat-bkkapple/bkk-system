// src/pages/admin/B2CWorkspacePage.tsx
import React, { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '@/api/firebase';
import { useAuth } from '@/hooks/useAuth';
import {
  User, Phone, MapPin, CheckCircle2, Store, ShieldCheck,
  Camera, AlertTriangle, Bike, Search, ListChecks,
  ChevronLeft, History, Wallet, MessageCircle, PackageOpen,
  ExternalLink, Copy, Navigation, Map, Clock,
  AlertOctagon, XCircle, Send, PhoneCall, Archive,
  Plus, X, Pencil, Save, Mail, Truck , Monitor, Battery, Globe, Info, Package, Cpu, Smartphone
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/utils/formatters';

import { InternalQCModal } from '@/features/trade-in/components/qc/InternalQCModal';
import { AdminChatBox } from '@/components/Fleet/AdminChatBox';
import { B2BManager } from '@/features/trade-in/components/b2b/B2BManager';

const SmartPipeline = ({ job }: { job: any }) => {
  const s = String(job?.status || '').toLowerCase();
  let currentStep = 0;

  const hasBeenPaid = !!job?.paid_at || !!job?.payment_slip ||
    ['paid', 'payment completed', 'deal closed', 'sent to qc lab', 'in stock', 'waiting for handover'].includes(s) ||
    job?.qc_logs?.some((l: any) => ['paid', 'payment completed'].includes(l.action?.toLowerCase()));

  if (['cancelled', 'closed (lost)', 'returned'].includes(s)) currentStep = 0;
  else if (hasBeenPaid || ['payout processing', 'waiting for finance'].includes(s)) currentStep = 4;
  else if (['being inspected', 'pending qc', 'qc review', 'revised offer', 'negotiation'].includes(s)) currentStep = 3;
  else if (['active leads', 'arrived', 'in-transit', 'accepted'].includes(s)) currentStep = 2; // 🌟 เพิ่ม 'accepted' ให้เข้า step Logistics
  else if (['new lead', 'following up', 'appointment set'].includes(s)) currentStep = 1;

  const steps = [
    { num: 1, label: 'SALES & DEAL' },
    { num: 2, label: 'LOGISTICS' },
    { num: 3, label: 'INSPECTION' },
    { num: 4, label: 'FINANCE & QC' }
  ];

  return (
    <div className="flex items-start justify-between w-full pt-2 pb-8">
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.num;
        const isActive = currentStep === step.num;

        return (
          <React.Fragment key={step.num}>
            <div className="relative flex flex-col items-center z-10 shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-300 ${isCompleted ? 'bg-emerald-500 text-white' : isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 ring-4 ring-blue-50' : 'bg-slate-100 text-slate-300'}`}>
                {isCompleted ? <CheckCircle2 size={16} /> : step.num}
              </div>
              <span className={`absolute top-10 text-[8px] w-20 text-center font-black uppercase tracking-widest ${isActive ? 'text-blue-600' : isCompleted ? 'text-emerald-600' : 'text-slate-300'}`}>
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className="flex-1 h-[2px] mx-2 bg-slate-200 relative mt-4">
                <div className={`absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-500 ${isCompleted ? 'w-full' : 'w-0'}`}></div>
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  );
};

export const B2CWorkspacePage = ({ id, onBack }: { id: string, onBack: () => void }) => {
  const { currentUser } = useAuth();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [revisedPrice, setRevisedPrice] = useState('');
  const [reviseReason, setReviseReason] = useState('');
  const [negotiatedPrice, setNegotiatedPrice] = useState('');
  const [callNotes, setCallNotes] = useState('');

  const [isAddingCoupon, setIsAddingCoupon] = useState(false);
  const [adminCouponCode, setAdminCouponCode] = useState('');
  const [adminCouponValue, setAdminCouponValue] = useState('');

  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [editCustData, setEditCustData] = useState({
    name: '', phone: '', email: '', address: ''
  });

  const [isQCModalOpen, setIsQCModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [activeChatJobId, setActiveChatJobId] = useState<string | null>(null);

  const [modelsData, setModelsData] = useState([]);
  const [conditionSets, setConditionSets] = useState([]);

  useEffect(() => {
    if (!id) return;
    const unsubscribeJob = onValue(ref(db, `jobs/${id}`), (snapshot) => {
      if (snapshot.exists()) {
        const data = { id: snapshot.key, ...snapshot.val() };
        setJob(data);
        if (!negotiatedPrice) setNegotiatedPrice(data.final_price || data.price || '');
      }
      setLoading(false);
    });

    const unsubscribeModels = onValue(ref(db, 'models'), (snap) => setModelsData(snap.exists() ? Object.values(snap.val()) : []));
    const unsubscribeConditions = onValue(ref(db, 'settings/condition_sets'), (snap) => setConditionSets(snap.exists() ? Object.values(snap.val()) : []));

    return () => {
      unsubscribeJob();
      unsubscribeModels();
      unsubscribeConditions();
    };
  }, [id]);

  if (loading) return <div className="fixed inset-0 flex items-center justify-center bg-[#F8FAFC] font-black text-blue-500 z-[9999]">Loading Workspace...</div>;
  if (!job) return <div className="fixed inset-0 flex items-center justify-center bg-[#F8FAFC] font-black text-red-500 z-[9999]">ไม่พบข้อมูลคำสั่งซื้อนี้</div>;

  const isB2B = job.type === 'B2B Trade-in' || job.type === 'B2B' || String(job.ref_no).startsWith('B2B');

  if (isB2B) {
    const handleB2BUpdateStatus = async (jobId: string, newStatus: string, logDetails: string, extraData?: any) => {
      const log = { action: newStatus, details: logDetails, by: currentUser?.name || 'Admin', timestamp: Date.now() };
      await update(ref(db, `jobs/${jobId}`), {
        status: newStatus,
        qc_logs: [log, ...(job.qc_logs || [])],
        updated_at: Date.now(),
        ...(extraData || {})
      });
    };
    return <B2BManager job={job} onUpdateStatus={handleB2BUpdateStatus} onClose={onBack} basePricing={modelsData} />;
  }

  // 🌟 THE FIX 1: แก้ไขการคำนวณเงิน ให้หัก pickup_fee เฉพาะตอนที่เป็น Pickup เท่านั้น!
  const basePrice = Number(job.final_price || job.price || 0); 
  const pickupFee = job.receive_method === 'Pickup' ? Number(job.pickup_fee || 0) : 0; 
  const couponValue = Number(job.applied_coupon?.value || 0); 
  const netPayout = Math.max(0, basePrice - pickupFee + couponValue);

  const statusLower = String(job.status || '').trim().toLowerCase();
  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes(statusLower) || statusLower.includes('cancel');
  const isNew = ['new lead', 'following up', 'appointment set', 'active leads'].includes(statusLower);
  const isQC = ['being inspected', 'pending qc', 'qc review'].includes(statusLower);
  const isNegotiation = ['revised offer', 'negotiation'].includes(statusLower);
  const isProcessingPayment = statusLower === 'payout processing' || statusLower === 'waiting for finance';

  const hasBeenPaid = !!job.paid_at || !!job.payment_slip || [
    'paid', 'deal closed', 'deal closed (negotiated)', 'in stock', 'sent to qc lab',
    'payment completed', 'completed', 'success', 'transferred', 'waiting for handover'
  ].includes(statusLower) ||
    statusLower.includes('paid') ||
    job.qc_logs?.some((log: any) => ['paid', 'payment completed'].includes(log.action?.toLowerCase()));

  const handleUpdateStatus = async (newStatus: string, details: string) => {
    const log = { action: newStatus, details, by: currentUser?.name || 'Admin', timestamp: Date.now() };
    await update(ref(db, `jobs/${job.id}`), {
      status: newStatus,
      qc_logs: [log, ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
  };

  const handleCallCustomer = async () => {
    if (!job?.cust_phone) return alert('ไม่พบเบอร์โทรศัพท์ลูกค้า');
    window.location.href = `tel:${job.cust_phone}`;
    if (job.status === 'New Lead') {
      const log = { action: 'Following Up', details: 'แอดมินกดโทรติดต่อลูกค้าเพื่อคอนเฟิร์มนัดหมาย', by: currentUser?.name || 'Admin', timestamp: Date.now() };
      await update(ref(db, `jobs/${job.id}`), {
        status: 'Following Up',
        qc_logs: [log, ...(job.qc_logs || [])],
        updated_at: Date.now()
      });
    }
  };

  const handleSaveCustomerInfo = async () => {
    try {
      const updatePayload: any = {
        cust_name: editCustData.name,
        cust_phone: editCustData.phone,
        cust_email: editCustData.email,
      };
      if (job.receive_method === 'Store-in') updatePayload.store_branch = editCustData.address;
      else updatePayload.cust_address = editCustData.address;

      const log = { action: 'Customer Info Updated', details: 'อัปเดตข้อมูลการติดต่อ/ที่อยู่ของลูกค้า', by: currentUser?.name || 'Admin', timestamp: Date.now() };
      updatePayload.qc_logs = [log, ...(job.qc_logs || [])];

      await update(ref(db, `jobs/${job.id}`), updatePayload);
      setIsEditingCustomer(false);
    } catch (error) {
      alert('เกิดข้อผิดพลาดในการอัปเดตข้อมูล');
    }
  };

  const handleApplyAdminCoupon = async () => {
    if (!adminCouponCode || !adminCouponValue) return alert('กรุณาระบุชื่อโค้ดและจำนวนเงิน');
    const val = Number(adminCouponValue);
    const newNet = Math.max(0, basePrice - pickupFee + val); 

    const log = { action: 'Admin Top-up', details: `แอดมินเพิ่มคูปองพิเศษ: ${adminCouponCode} (+${val}฿)`, by: currentUser?.name || 'Admin', timestamp: Date.now() };

    await update(ref(db, `jobs/${job.id}`), {
      applied_coupon: { code: adminCouponCode, name: 'Admin Manual Top-up', value: val },
      net_payout: newNet, 
      qc_logs: [log, ...(job.qc_logs || [])],
      updated_at: Date.now()
    });

    setIsAddingCoupon(false); setAdminCouponCode(''); setAdminCouponValue('');
  };

  const handleRemoveCoupon = async () => {
    if (confirm('ยืนยันการลบคูปองและดึงเงินกลับ?')) {
      const newNet = Math.max(0, basePrice - pickupFee); 

      const log = { action: 'Coupon Revoked', details: `แอดมินยกเลิกการใช้คูปอง: ${job.applied_coupon?.code} (-${job.applied_coupon?.value}฿)`, by: currentUser?.name || 'Admin', timestamp: Date.now() };

      await update(ref(db, `jobs/${job.id}`), {
        applied_coupon: null,
        net_payout: newNet,
        qc_logs: [log, ...(job.qc_logs || [])],
        updated_at: Date.now()
      });
    }
  };

  const handleReviseOffer = async () => {
    if (!revisedPrice) return alert('กรุณาระบุราคาใหม่');
    if (!confirm(`ยืนยันการตั้งราคาเครื่องใหม่เป็น ${revisedPrice} บาท? (ระบบจะหักค่าไรเดอร์อัตโนมัติ)`)) return;

    const newBasePrice = Number(revisedPrice);
    const newNetPayout = Math.max(0, newBasePrice - pickupFee + couponValue);

    const log = { action: 'Revised Offer', details: `เสนอราคาเครื่องใหม่: ${newBasePrice} บ. (ยอดสุทธิ: ${newNetPayout} บ.) เหตุผล: ${reviseReason}`, by: currentUser?.name || 'Admin', timestamp: Date.now() };

    const updatedDevices = job.devices ? [...job.devices] : [];
    if (updatedDevices.length > 0) {
      if (updatedDevices.length === 1) {
        updatedDevices[0] = { ...updatedDevices[0], estimated_price: newBasePrice, price: newBasePrice };
      } else {
        const diff = basePrice - newBasePrice;
        updatedDevices[0] = { 
            ...updatedDevices[0], 
            estimated_price: Math.max(0, Number(updatedDevices[0].estimated_price || 0) - diff), 
            price: Math.max(0, Number(updatedDevices[0].price || 0) - diff) 
        };
      }
    }

    await update(ref(db, `jobs/${job.id}`), {
      status: 'Negotiation', price: newBasePrice, final_price: newBasePrice, net_payout: newNetPayout,
      devices: updatedDevices, qc_logs: [log, ...(job.qc_logs || [])], updated_at: Date.now()
    });
    setRevisedPrice(''); setReviseReason('');
  };

  const handleCloseNegotiation = async () => {
    if (!negotiatedPrice) return alert('กรุณาระบุราคาปิดดีล');
    if (!confirm(`ยืนยันปิดการขายที่ราคาเครื่อง ${negotiatedPrice} บาท?`)) return;

    const newBasePrice = Number(negotiatedPrice);
    const newNetPayout = Math.max(0, newBasePrice - pickupFee + couponValue);

    const log = { action: 'Deal Closed (Negotiated)', details: `จบการเจรจา ราคาเครื่อง: ${newBasePrice} บ. (ยอดโอนลูกค้า: ${newNetPayout} บ.)`, by: currentUser?.name || 'Admin', timestamp: Date.now() };

    const updatedDevices = job.devices ? [...job.devices] : [];
    if (updatedDevices.length > 0) {
      if (updatedDevices.length === 1) {
        updatedDevices[0] = { ...updatedDevices[0], estimated_price: newBasePrice, price: newBasePrice };
      } else {
        const diff = basePrice - newBasePrice;
        updatedDevices[0] = { 
            ...updatedDevices[0], 
            estimated_price: Math.max(0, Number(updatedDevices[0].estimated_price || 0) - diff), 
            price: Math.max(0, Number(updatedDevices[0].price || 0) - diff) 
        };
      }
    }

    await update(ref(db, `jobs/${job.id}`), {
      status: 'Payout Processing', price: newBasePrice, final_price: newBasePrice, net_payout: newNetPayout,
      devices: updatedDevices, qc_logs: [log, ...(job.qc_logs || [])], updated_at: Date.now()
    });
  };

  const handleCancelTicket = async (reason: string) => {
    const log = { action: 'Cancelled', details: `ยกเลิกออเดอร์ เหตุผล: ${reason}`, by: currentUser?.name || 'Admin', timestamp: Date.now() };
    await update(ref(db, `jobs/${job.id}`), {
      status: 'Cancelled', cancel_reason: reason, qc_logs: [log, ...(job.qc_logs || [])], updated_at: Date.now()
    });
    setIsCancelModalOpen(false);
  };

  const handleSaveNotes = async () => {
    if (!callNotes.trim()) return;
    const log = { action: 'CRM Note', details: callNotes, by: currentUser?.name || 'Admin', timestamp: Date.now() };
    await update(ref(db, `jobs/${job.id}`), { qc_logs: [log, ...(job.qc_logs || [])] });
    setCallNotes('');
  };

  const handleClaimTicket = async () => {
    const log = { action: 'Claimed Ticket', details: 'แอดมินรับผิดชอบเคส', by: currentUser?.name || 'Admin', timestamp: Date.now() };
    const nextStatus = job.status === 'New Lead' ? 'Following Up' : job.status;
    await update(ref(db, `jobs/${job.id}`), {
      agent_name: currentUser?.name || 'Admin', agent_id: currentUser?.id || 'admin_1', status: nextStatus, is_read: true,
      qc_logs: [log, ...(job.qc_logs || [])], updated_at: Date.now()
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('คัดลอกลิงก์เรียบร้อยแล้ว');
  };

  return (
    <div className="fixed inset-0 bg-[#F1F5F9] flex flex-col z-[9999] overflow-hidden animate-in fade-in duration-300">
      {/* 🔝 Global Header */}
      <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-20">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-500">
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">{job.model}</h1>
            <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">{job.ref_no || job.id}</span>
            {isCancelled && <span className="bg-red-100 text-red-600 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">CANCELLED</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!job.agent_name && !isCancelled && (
            <button onClick={handleClaimTicket} className="px-4 py-1.5 bg-slate-900 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all animate-pulse">
              + รับเคสนี้ (Claim Ticket)
            </button>
          )}
          {/* 🌟 แสดงป้ายชื่อตามวิธีจัดส่ง */}
          <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
            job.receive_method === 'Store-in' ? 'bg-purple-100 text-purple-600' : 
            job.receive_method === 'Mail-in' ? 'bg-orange-100 text-orange-600' : 
            'bg-blue-100 text-blue-600'
          }`}>
            {job.receive_method || 'Pickup'}
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ⬅️ LEFT SIDE: Workspace */}
        <div className="flex-1 overflow-y-auto p-8 no-scrollbar pb-24">
          <div className="max-w-5xl mx-auto space-y-6">

            {/* 1. PIPELINE BAR */}
            <div className="bg-white px-10 py-6 rounded-[2.5rem] shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pipeline Status</p>
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1 rounded-lg border border-blue-100">{job.status}</span>
              </div>
              <SmartPipeline job={job} />
            </div>

            {/* 🌟 2. DELIVERY & CUSTOMER INFO (THE FIX 2: ปรับปรุงการแสดงผล Logistics) */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 grid grid-cols-2 gap-8">
              <div className="space-y-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-2">Logistics & Location</p>
                
                {job.receive_method === 'Mail-in' ? (
                  <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-start gap-3">
                    <Truck className="text-orange-500 shrink-0" size={20} />
                    <div>
                      <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest flex items-center gap-2">ส่งพัสดุ (Mail-in)</p>
                      {job.tracking_number ? (
                        <div className="mt-1">
                          <p className="text-sm font-black text-orange-700 tracking-wider font-mono">{job.tracking_number}</p>
                          <p className="text-[10px] font-bold text-slate-500 mt-0.5">ลูกค้าระบุเลขพัสดุแล้ว รอรับของ</p>
                        </div>
                      ) : (
                        <p className="text-[11px] font-bold text-slate-500 mt-1">รอลูกค้าส่งพัสดุและแจ้ง Tracking...</p>
                      )}
                    </div>
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
                  {!isEditingCustomer && (
                    <button onClick={() => {
                      setEditCustData({ name: job?.cust_name || '', phone: job?.cust_phone || '', email: job?.cust_email || '', address: job?.cust_address || job?.store_branch || '' });
                      setIsEditingCustomer(true);
                    }} className="text-slate-400 hover:text-blue-500 p-1.5 bg-slate-50 rounded-lg shadow-sm border border-slate-200 transition-colors flex gap-2 items-center text-[10px] font-bold uppercase">
                      <Pencil size={12} /> Edit
                    </button>
                  )}
                </div>

                {isEditingCustomer ? (
                  <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-blue-200 shadow-inner animate-in fade-in">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-1">ชื่อลูกค้า</label>
                      <input type="text" value={editCustData.name} onChange={e => setEditCustData({ ...editCustData, name: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 ml-1">เบอร์โทร</label>
                        <input type="text" value={editCustData.phone} onChange={e => setEditCustData({ ...editCustData, phone: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 ml-1">อีเมล</label>
                        <input type="email" value={editCustData.email} onChange={e => setEditCustData({ ...editCustData, email: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-1">{job.receive_method === 'Store-in' ? 'สาขานัดหมาย' : 'ที่อยู่จัดส่ง'}</label>
                      <textarea value={editCustData.address} onChange={e => setEditCustData({ ...editCustData, address: e.target.value })} className="w-full text-sm font-bold border rounded-xl px-3 py-2 outline-none focus:border-blue-400" rows={2} />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => setIsEditingCustomer(false)} className="flex-1 text-xs font-bold text-slate-500 bg-white border border-slate-200 py-2 rounded-xl hover:bg-slate-50">ยกเลิก</button>
                      <button onClick={handleSaveCustomerInfo} className="flex-1 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 py-2 rounded-xl flex justify-center items-center gap-1 shadow-md"><Save size={14} /> บันทึกข้อมูล</button>
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
                    {!isEditingCustomer && (
                      <button onClick={() => copyToClipboard(`https://bkk-apple.com/track/${job.ref_no || job.id}`)} className="w-full text-[10px] bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-600 px-3 py-2.5 rounded-xl font-bold transition-all flex justify-center items-center gap-2 border border-slate-200 shadow-sm active:scale-95 mt-5">
                        <MapPin size={12} /> คัดลอกลิงก์ให้ลูกค้า (TRACKING LINK)
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Condition Match Verification */}
            <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-200 space-y-8">
              <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                  <ShieldCheck className="text-blue-500" size={20} /> Condition Match Verification
                </h3>
              </div>

              {(job.devices && job.devices.length > 0 ? job.devices : [job]).map((device: any, idx: number) => {
                const riderChecks = device.rider_conditions || device.deductions || (idx === 0 ? job.deductions : []) || [];
                const isInspected = device.inspection_status === "Inspected" || statusLower === "qc review";
                const devicePhotos = device.photos || (idx === 0 && job.photos ? job.photos : []);

                return (
                  <div key={idx} className="space-y-4 pt-6 first:pt-0 border-t first:border-t-0 border-slate-100">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="bg-slate-800 text-white px-3 py-1 rounded-lg text-[10px] font-black tracking-widest">DEVICE {idx + 1}</span>
                        <h4 className="text-sm font-black text-slate-800 uppercase">{device.model || job.model}</h4>
                      </div>
                      {job.initial_customer_price && (
                        <div className="bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-sm">
                          <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">ลูกค้าประเมินมา</span>
                          <span className="text-xs font-black text-blue-700">{formatCurrency(job.initial_customer_price)}</span>
                        </div>
                      )}
                    </div>

                   <div className="grid grid-cols-2 gap-4">
                      {/* 🌟 ฟังก์ชันตัวช่วย: เลือก Icon อัตโนมัติตามคำในหัวข้อ */}
                      {(() => {
                        const getConditionIcon = (text: string) => {
                          const t = text || '';
                          if (t.includes('จอ') || t.includes('กระจก')) return Monitor;
                          if (t.includes('ตัวเครื่อง') || t.includes('ฝาหลัง') || t.includes('รอย')) return Smartphone;
                          if (t.includes('แบต')) return Battery;
                          if (t.includes('ทำงาน') || t.includes('ระบบ')) return Cpu;
                          if (t.includes('อุปกรณ์') || t.includes('กล่อง')) return Package;
                          if (t.includes('โมเดล') || t.includes('ประเทศ') || t.includes('รหัส')) return Globe;
                          return Info; // ไอคอนเริ่มต้นถ้าหาหมวดไม่เจอ
                        };

                        return (
                          <>
                            {/* 🔴 ฝั่งซ้าย: ลูกค้าแจ้ง */}
                            <div className="space-y-3">
                              <p className="text-[9px] font-black text-slate-400 uppercase text-center tracking-widest">ลูกค้าแจ้ง</p>
                              <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 min-h-[120px]">
                                {device.isNewDevice ? (
                                  <div className="text-xs font-bold text-blue-600 flex items-center gap-2 bg-blue-50 p-3 rounded-xl border border-blue-100"><PackageOpen size={16} /> เครื่องใหม่มือ 1</div>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {device.customer_conditions?.map((c: any, i: number) => {
                                      let cText = '';
                                      if (typeof c === 'string') {
                                        cText = c;
                                      } else if (c && typeof c === 'object') {
                                        const textValue = c.value || c.label;
                                        if (c.title && textValue) cText = `[${c.title}] ${textValue}`;
                                        else cText = textValue || c.title || JSON.stringify(c);
                                      }

                                      let isMatchWithRider = false;
                                      if (riderChecks.length > 0) {
                                        isMatchWithRider = riderChecks.some((rItem: any) => {
                                          let rText = '';
                                          if (typeof rItem === 'string') rText = rItem;
                                          else if (rItem && typeof rItem === 'object') {
                                            const rValue = rItem.value || rItem.label;
                                            if (rItem.title && rValue) rText = `[${rItem.title}] ${rValue}`;
                                            else rText = rValue || rItem.title || "";
                                          }
                                          return cText.includes(rText) || rText.includes(cText) || cText === rText;
                                        });
                                      }

                                      const Icon = getConditionIcon(cText);

                                      if (riderChecks.length === 0) {
                                        return (
                                          <li key={i} className="text-[11px] font-bold text-slate-600 flex items-start gap-2 bg-slate-100/50 p-2 rounded-lg border border-slate-100">
                                            <Icon size={14} className="text-slate-400 shrink-0 mt-0.5" />{cText}
                                          </li>
                                        );
                                      }

                                      return isMatchWithRider ? (
                                        <li key={i} className="text-[11px] font-bold text-emerald-600 flex items-start gap-2 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                                          <Icon size={14} className="shrink-0 mt-0.5" />{cText}
                                        </li>
                                      ) : (
                                        <li key={i} className="text-[11px] font-bold text-red-600 flex items-start gap-2 bg-red-50 p-2 rounded-lg border border-red-100">
                                          <Icon size={14} className="shrink-0 mt-0.5" />{cText}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            </div>

                            {/* 🔵 ฝั่งขวา: ผลตรวจจริง */}
                            <div className="space-y-3">
                              <p className="text-[9px] font-black text-slate-400 uppercase text-center tracking-widest">ผลตรวจจริง</p>
                              <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 min-h-[120px]">
                                {riderChecks.length > 0 ? (
                                  <ul className="space-y-1.5">
                                    {riderChecks.map((d: any, i: number) => {
                                      let dText = '';
                                      if (typeof d === 'string') {
                                        dText = d;
                                      } else if (d && typeof d === 'object') {
                                        const textValue = d.value || d.label;
                                        if (d.title && textValue) dText = `[${d.title}] ${textValue}`;
                                        else dText = textValue || d.title || JSON.stringify(d);
                                      }
                                      
                                      const checkMatch = (arr: any[], text: string) => {
                                         if (!arr) return false;
                                         return arr.some(item => {
                                            let t = '';
                                            if (typeof item === 'string') t = item;
                                            else if (item && typeof item === 'object') {
                                              const tValue = item.value || item.label;
                                              if (item.title && tValue) t = `[${item.title}] ${tValue}`;
                                              else t = tValue || item.title || "";
                                            }
                                            return text.includes(t) || t.includes(text) || text === t;
                                         });
                                      };

                                      const isExactMatch = checkMatch(device.customer_conditions, dText);
                                      const isGoodCondition = dText.includes('สมบูรณ์') || dText.includes('ปกติ') || (device.isNewDevice && dText.includes('เครื่องใหม่'));
                                      const isMatch = isExactMatch || isGoodCondition;
                                      
                                      const Icon = getConditionIcon(dText);

                                      return isMatch ? (
                                        <li key={i} className="text-[11px] font-bold text-emerald-600 flex items-start gap-2 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                                          <Icon size={14} className="shrink-0 mt-0.5" />{dText}
                                        </li>
                                      ) : (
                                        <li key={i} className="text-[11px] font-bold text-red-600 flex items-start gap-2 bg-red-50 p-2 rounded-lg border border-red-100">
                                          <Icon size={14} className="shrink-0 mt-0.5" />{dText}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : isInspected ? (
                                  <div className="text-xs font-bold text-emerald-600 flex items-center gap-2 h-full justify-center"><CheckCircle2 size={16} /> สภาพสมบูรณ์ 100%</div>
                                ) : (
                                  <div className="h-full flex flex-col items-center justify-center text-slate-300"><Search size={32} className="mb-2 opacity-20" /><p className="text-[9px] font-black uppercase tracking-widest opacity-50">Waiting QC</p></div>
                                )}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {devicePhotos.length > 0 && (
                      <div className="pt-2">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Camera size={14} /> รูปถ่ายตัวเครื่อง</p>
                        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                          {devicePhotos.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="w-24 h-24 shrink-0 rounded-2xl overflow-hidden border border-slate-200 hover:border-blue-400 transition-all shadow-sm">
                              <img src={url} className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ➡️ RIGHT SIDEBAR */}
        <div className="w-[450px] bg-white border-l border-slate-200 flex flex-col shadow-2xl z-20 shrink-0">
          <div className="p-8 bg-slate-900 text-white relative shrink-0">
            <div className={`absolute top-0 right-0 w-32 h-32 blur-3xl rounded-full -mr-10 -mt-10 ${isCancelled ? 'bg-red-600/20' : isNegotiation ? 'bg-orange-600/20' : 'bg-blue-600/20'}`}></div>

            <div className="relative z-10">
              <div className="space-y-3 mb-6 pb-6 border-b border-white/10">
                {job.initial_customer_price && job.initial_customer_price !== basePrice && (
                  <div className="flex justify-between items-center text-[11px] font-bold text-slate-400 mb-3 pb-3 border-b border-white/5">
                    <span>ราคาที่ลูกค้าประเมินจากเว็บ (Initial Quote)</span>
                    <span className="line-through">{formatCurrency(job.initial_customer_price)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm font-bold text-slate-200">
                  <span>ราคาเครื่องปัจจุบัน (Current Base)</span>
                  <span>{formatCurrency(basePrice)}</span>
                </div>
                
                {/* 🌟 THE FIX 3: โชว์บรรทัดนี้เฉพาะตอนที่เป็น Pickup เท่านั้น */}
                {job.receive_method === 'Pickup' && pickupFee > 0 && (
                  <div className="flex justify-between items-center text-sm font-bold text-red-400">
                    <span>หักค่าบริการไรเดอร์ (Rider Fee)</span>
                    <span>- {formatCurrency(pickupFee)}</span>
                  </div>
                )}

                {couponValue > 0 && (
                  <div className="flex justify-between items-center text-sm font-bold text-emerald-400">
                    <span className="flex items-center gap-2">
                      <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-widest border border-emerald-500/30">Coupon</span>
                      <span className="text-xs">{job.applied_coupon?.code || 'Manual Top-up'}</span>
                    </span>
                    <span>+{formatCurrency(couponValue)}</span>
                  </div>
                )}
              </div>

              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">ยอดโอนสุทธิ (NET PAYOUT TO CUSTOMER)</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-5xl font-black tracking-tighter ${isCancelled ? 'text-red-400 line-through' : 'text-white'}`}>
                  {formatCurrency(netPayout)}
                </span>
                <span className="text-xs font-bold text-slate-400">THB</span>
              </div>
            </div>

            {isCancelled ? (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 relative z-10">
                <div className="p-2 bg-red-500 rounded-lg text-white"><XCircle size={16} /></div>
                <div>
                  <p className="text-[11px] font-black uppercase text-red-500 tracking-wider">ออเดอร์ถูกยกเลิก</p>
                  <p className="text-[9px] font-bold text-red-400/80 mt-0.5">{job.cancel_reason}</p>
                </div>
              </div>
            ) : isProcessingPayment ? (
              <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 relative z-10">
                <div className="p-2 bg-amber-500 rounded-lg text-white"><Clock size={16} className="animate-pulse" /></div>
                <div>
                  <p className="text-[11px] font-black uppercase text-amber-500 tracking-wider">Waiting for Finance</p>
                  <p className="text-[9px] font-bold text-amber-500/70 mt-0.5">รอแผนกบัญชีตรวจสอบและโอนเงิน</p>
                </div>
              </div>
            ) : hasBeenPaid ? (
              <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 relative z-10">
                <div className="p-2 bg-emerald-500 rounded-lg text-white"><CheckCircle2 size={16} /></div>
                <p className="text-[10px] font-black uppercase text-emerald-400 tracking-wider">โอนเงินสำเร็จเรียบร้อยแล้ว</p>
              </div>
            ) : (
              <div className="mt-6 h-6"></div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar bg-slate-50">

            {/* ส่วน Coupon */}
            {!isCancelled && !hasBeenPaid && (
              <div className="mb-4 border-b border-slate-200 pb-6">
                {job.applied_coupon ? (
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex justify-between items-center transition-all group">
                    <div>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Applied Coupon</p>
                      <p className="text-sm font-black text-emerald-800">{job.applied_coupon.code}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-black text-emerald-600">+{job.applied_coupon.value} ฿</p>
                      <button onClick={handleRemoveCoupon} className="p-1.5 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="นำคูปองออก"><X size={14} /></button>
                    </div>
                  </div>
                ) : (
                  !isAddingCoupon ? (
                    <button onClick={() => setIsAddingCoupon(true)} className="w-full py-3.5 bg-white hover:bg-slate-50 border border-slate-200 border-dashed text-slate-500 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm">
                      <Plus size={14} /> เพิ่มคูปอง / Manual Top-up (Admin)
                    </button>
                  ) : (
                    <div className="bg-white border border-slate-200 p-4 rounded-2xl space-y-3 animate-in zoom-in-95 shadow-sm">
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Admin Manual Top-up</p>
                        <button onClick={() => setIsAddingCoupon(false)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                      </div>
                      <div className="flex gap-2">
                        <input type="text" placeholder="ชื่อโค้ด / เหตุผล" value={adminCouponCode} onChange={e => setAdminCouponCode(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400" />
                        <div className="relative w-28">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-500 font-bold text-xs">+</span>
                          <input type="number" placeholder="0" value={adminCouponValue} onChange={e => setAdminCouponValue(e.target.value)} className="w-full bg-slate-50 border border-slate-200 pl-6 pr-2 py-2.5 rounded-xl text-xs font-black outline-none focus:border-emerald-400 text-emerald-600" />
                        </div>
                      </div>
                      <button onClick={handleApplyAdminCoupon} disabled={!adminCouponCode || !adminCouponValue} className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl text-xs font-black uppercase transition-all disabled:opacity-50 active:scale-95">Apply Top-up</button>
                    </div>
                  )
                )}
              </div>
            )}

            {/* 🌟 THE FIX 4: เพิ่มปุ่ม "ได้รับพัสดุแล้ว" สำหรับโหมด Mail-in (สถานะ In-Transit) */}
            {!isCancelled && job.receive_method === 'Mail-in' && statusLower === 'in-transit' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><PackageOpen size={14} /> Mail-In Receiving</p>
                <button 
                  onClick={async () => {
                    if(confirm('ยืนยันว่าได้รับพัสดุจากลูกค้าแล้วใช่หรือไม่?')) {
                      await update(ref(db, `jobs/${job.id}`), {
                        status: 'Pending QC',
                        qc_logs: [
                          { action: 'Package Received', by: currentUser?.name || 'Admin', timestamp: Date.now(), details: 'แอดมินได้รับพัสดุแล้ว เตรียมเข้าสู่กระบวนการ QC' },
                          ...(job.qc_logs || [])
                        ],
                        updated_at: Date.now()
                      });
                    }
                  }}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 transition-all active:scale-95 flex justify-center items-center gap-2"
                >
                  <PackageOpen size={18} /> ยืนยันได้รับพัสดุแล้ว (Mark as Received)
                </button>
              </div>
            )}

            {/* ปุ่มสำหรับ New Lead (ส่วนมากใช้กับ Pickup/Store-in) */}
            {!isCancelled && isNew && job.receive_method !== 'Mail-in' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Send size={14} /> Dispatch Operations</p>
                {statusLower === 'new lead' && (
                  <button onClick={handleCallCustomer} className="w-full py-3.5 bg-green-500 hover:bg-green-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-green-200 transition-all active:scale-95 flex justify-center items-center gap-2">
                    <PhoneCall size={16} /> 1. โทรคอนเฟิร์มลูกค้า (Follow Up)
                  </button>
                )}
                <button 
                  onClick={() => {
                    // 🌟 THE FIX: แยกลอจิกการเปลี่ยนสถานะระหว่างเข้าสาขา กับ เรียกไรเดอร์
                    if (job.receive_method === 'Store-in') {
                      handleUpdateStatus('Appointment Set', 'ลูกค้ายืนยันวันเวลาเข้าสาขาเรียบร้อยแล้ว');
                    } else {
                      handleUpdateStatus('Active Leads', 'ส่งงานให้พนักงานเข้ารับเครื่อง');
                    }
                  }} 
                  className={`w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2 ${statusLower === 'new lead' ? 'opacity-80' : ''}`}
                >
                  {job.receive_method === 'Store-in' ? 'ลูกค้ายืนยันเข้าสาขา (รอเข้าตรวจสอบ)' : (statusLower === 'new lead' ? '2. จ่ายงานให้ไรเดอร์ (Dispatch)' : 'จ่ายงานให้ไรเดอร์ (Dispatch Rider)')}
                </button>
              </div>
            )}

            {/* 🌟 เพิ่มปุ่มรับลูกค้าหน้าร้าน (Store-in) หลังจากยืนยันนัดหมายแล้ว */}
            {!isCancelled && statusLower === 'appointment set' && job.receive_method === 'Store-in' && (
              <div className="space-y-3 mt-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Store size={14} /> Store Operations</p>
                <button 
                  onClick={() => handleUpdateStatus('Being Inspected', 'ลูกค้ามาถึงสาขา แอดมินเริ่มประเมินสภาพเครื่อง')} 
                  className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-purple-200 transition-all active:scale-95 flex justify-center items-center gap-2"
                >
                  <Store size={18} /> ลูกค้ามาถึงสาขา (เริ่มตรวจสภาพ QC)
                </button>
              </div>
            )}

            {/* ปุ่มสำหรับ QC Phase */}
            {!isCancelled && isQC && !hasBeenPaid && (
              <div className="space-y-4 mt-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ListChecks size={14} /> Quality Control Phase</p>
                <button onClick={() => setIsQCModalOpen(true)} className="w-full flex items-center justify-between p-4 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100 hover:bg-blue-100 transition-all font-black text-xs uppercase">
                  <span>{job.receive_method === 'Pickup' ? 'ตรวจสอบผลจากไรเดอร์' : 'เริ่มตรวจสภาพเครื่อง (QC)'}</span><ListChecks size={18} />
                </button>

                <div className="space-y-3 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4"><Wallet size={14} className="text-blue-500" /> หักลบตำหนิ (Revised Offer)</p>
                  <div className="space-y-3">
                    <input type="number" value={revisedPrice} onChange={e => setRevisedPrice(e.target.value)} placeholder="ระบุราคาประเมินใหม่..." className="w-full bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-sm font-black outline-none focus:border-blue-400 focus:bg-white" />
                    <textarea value={reviseReason} onChange={e => setReviseReason(e.target.value)} placeholder="ระบุเหตุผลที่หักราคา..." className="w-full bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-xs font-bold min-h-[80px] outline-none focus:border-blue-400 focus:bg-white" />
                    <button onClick={handleReviseOffer} className="w-full py-3.5 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase hover:bg-black transition-colors">ส่งราคาใหม่ให้ลูกค้า</button>
                  </div>
                </div>

                <button onClick={() => handleUpdateStatus('Payout Processing', 'Approve Order')} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 transition-all active:scale-95 flex justify-center items-center gap-2 mt-4">
                  <CheckCircle2 size={16} /> สภาพผ่านเกณฑ์ (Approve)
                </button>
              </div>
            )}

            {/* Negotiation Phase */}
            {!isCancelled && isNegotiation && !hasBeenPaid && (
              <div className="space-y-4">
                <div className="bg-orange-50 border border-orange-200 p-4 rounded-3xl animate-in slide-in-from-right-4">
                  <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-2 mb-2"><AlertOctagon size={14} /> Human Intervention</p>
                  <p className="text-xs font-bold text-orange-800 mb-4 leading-relaxed">ลูกค้าปฏิเสธราคาใหม่ กรุณาติดต่อลูกค้าเพื่อเจรจาต่อรอง (Negotiation Phase)</p>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <PhoneCall size={16} className="text-slate-400" />
                      <input type="number" value={negotiatedPrice} onChange={e => setNegotiatedPrice(e.target.value)} placeholder="ระบุราคาประเมินปิดดีล..." className="w-full bg-white border border-orange-100 p-3.5 rounded-xl text-sm font-black outline-none focus:border-orange-400" />
                    </div>
                    <button onClick={handleCloseNegotiation} className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md">
                      ตกลงราคาได้ (ปิดการขาย)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Post-Payment Handover */}
            {!isCancelled && hasBeenPaid && statusLower !== 'sent to qc lab' && statusLower !== 'in stock' && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ListChecks size={14} /> Post-Payment / Handover</p>
                <button onClick={() => setIsQCModalOpen(true)} className="w-full flex items-center justify-between p-4 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100 hover:bg-blue-100 transition-all font-black text-xs uppercase">
                  <span>ตรวจสอบเครื่อง (Internal QC)</span><ListChecks size={18} />
                </button>
                <button onClick={() => handleUpdateStatus('Sent to QC Lab', 'รับมอบเครื่องและส่งเข้าห้องแล็บ')} className="w-full flex items-center justify-between p-4 bg-purple-600 text-white rounded-2xl shadow-lg shadow-purple-200 hover:bg-purple-700 transition-all font-black text-xs uppercase tracking-widest">
                  <span>Send to QC LAB (ส่งเข้าแล็บ)</span><ShieldCheck size={18} />
                </button>
              </div>
            )}

            {!isCancelled && statusLower === 'sent to qc lab' && (
              <div className="p-6 bg-purple-50 border border-purple-100 rounded-[2rem] flex flex-col items-center justify-center gap-2 text-center animate-in zoom-in-95 mt-4">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center text-purple-500 mb-2"><Archive size={32} className="animate-pulse" /></div>
                <p className="text-sm font-black uppercase text-purple-700 tracking-wider">รอแผนก QC LAB รับเครื่อง</p>
                <p className="text-[10px] font-bold text-purple-500">แอดมินส่งเครื่องเข้าคลังเรียบร้อย</p>
              </div>
            )}

            {!isCancelled && statusLower === 'in stock' && (
              <div className="p-6 bg-slate-100/50 border border-slate-200 rounded-[2rem] flex flex-col items-center justify-center gap-2 text-center animate-in zoom-in-95 mt-4">
                <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center text-slate-400 mb-2"><PackageOpen size={32} /></div>
                <p className="text-sm font-black uppercase text-slate-800 tracking-wider">ออเดอร์นี้เสร็จสมบูรณ์</p>
                <p className="text-[10px] font-bold text-slate-500">เครื่องถูกล้างข้อมูลและนำเข้าคลังสินค้าเรียบร้อย</p>
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><History size={14} /> Activity Timeline</p>
              <div className="space-y-5 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200 ml-1">
                {(job.qc_logs || []).map((log: any, i: number) => (
                  <div key={i} className="flex gap-4 relative">
                    <div className={`w-5 h-5 rounded-full border-[3px] border-[#F8FAFC] shadow-sm z-10 shrink-0 ${i === 0 ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                    <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm w-full">
                      <p className={`text-[10px] font-black uppercase mb-1 ${log.action === 'Cancelled' ? 'text-red-500' : 'text-slate-800'}`}>{log.action}</p>
                      <p className="text-[10px] text-slate-500 font-bold">{log.details}</p>
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2">
                        <span className="text-[8px] font-black text-slate-400 uppercase">{formatDate(log.timestamp)}</span>
                        <span className="text-[8px] font-black text-blue-500 uppercase bg-blue-50 px-1.5 py-0.5 rounded">BY: {log.by}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 bg-white border-t border-slate-200 space-y-4">
            <div className="flex gap-3">
              <button onClick={() => setActiveChatJobId(job.id)} className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 transition-all">
                <MessageCircle size={14} className="text-blue-500" /> View Chats
              </button>
              <button onClick={() => window.open(`/invoice/${job.id}`, '_blank')} className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 transition-all">
                <ExternalLink size={14} /> Invoice
              </button>
            </div>

            {!isCancelled && !hasBeenPaid && !isProcessingPayment && (
              <button onClick={() => setIsCancelModalOpen(true)} className="w-full py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                ยกเลิกออเดอร์ / ปฏิเสธการรับซื้อ
              </button>
            )}

            <div className="flex gap-2 pt-2">
              <input type="text" value={callNotes} onChange={e => setCallNotes(e.target.value)} placeholder="จดบันทึกภายใน..." className="flex-1 bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400" />
              <button onClick={handleSaveNotes} className="bg-slate-900 text-white px-5 rounded-xl text-[10px] font-black uppercase hover:bg-slate-800 transition-all">Save</button>
            </div>
          </div>
        </div>

      </div>

      {isCancelModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100000] flex items-center justify-center animate-in fade-in">
          <div className="bg-white p-8 rounded-[2rem] shadow-2xl w-[400px] animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-base font-black text-slate-800 uppercase flex items-center gap-2"><AlertOctagon className="text-red-500" /> ระบุเหตุผลการยกเลิก</h3>
            </div>
            <div className="space-y-3 mb-6">
              {[
                'ติดต่อลูกค้าไม่ได้ / ไม่มาตามนัด',
                'ลูกค้าเปลี่ยนใจยกเลิกเอง',
                'ตกลงราคาใหม่ไม่ได้ (ปฏิเสธราคา)',
                'สภาพเครื่องไม่อยู่ในเกณฑ์ / ติดล็อค iCloud'
              ].map(reason => (
                <button key={reason} onClick={() => handleCancelTicket(reason)} className="w-full text-left p-4 bg-slate-50 border border-slate-200 hover:border-red-400 hover:bg-red-50 rounded-xl text-xs font-bold text-slate-700 transition-all">
                  {reason}
                </button>
              ))}
            </div>
            <button onClick={() => setIsCancelModalOpen(false)} className="w-full py-3 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
              ปิดหน้าต่าง (กลับไปทำงานต่อ)
            </button>
          </div>
        </div>
      )}

      <div className="relative z-[99999]">
        <InternalQCModal isOpen={isQCModalOpen} onClose={() => setIsQCModalOpen(false)} job={job} modelsData={modelsData} conditionSets={conditionSets} />
      </div>

      {activeChatJobId && (
        <div className="fixed inset-0 z-[100000]">
          <AdminChatBox jobId={activeChatJobId} onClose={() => setActiveChatJobId(null)} adminName={currentUser?.name || "Admin"} />
        </div>
      )}
    </div>
  );
};