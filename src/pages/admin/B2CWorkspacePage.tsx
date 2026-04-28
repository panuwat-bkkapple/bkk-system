// src/pages/admin/B2CWorkspacePage.tsx
import React, { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '@/api/firebase';
import { useAuth } from '@/hooks/useAuth';
import { ChevronLeft } from 'lucide-react';
import { InternalQCModal } from '@/features/trade-in/components/qc/InternalQCModal';
import { AdminChatBox } from '@/components/Fleet/AdminChatBox';
import { B2BManager } from '@/features/trade-in/components/b2b/B2BManager';
import { useToast } from '@/components/ui/ToastProvider';
import { CANCEL_CATEGORY_LABEL_TH, JOB_STATUS } from '@/types/job-statuses';
import type { CancelCategory } from '@/types/job-statuses';

import { SmartPipeline } from './components/SmartPipeline';
import { CustomerInfoCard } from './components/CustomerInfoCard';
import { ConditionVerification } from './components/ConditionVerification';
import { PricingSidebar } from './components/PricingSidebar';
import { CancelModal } from './components/CancelModal';

export const B2CWorkspacePage = ({ id, onBack }: { id: string, onBack: () => void }) => {
  const toast = useToast();
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
  const [editCustData, setEditCustData] = useState({ name: '', phone: '', email: '', address: '' });
  const [isQCModalOpen, setIsQCModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [activeChatJobId, setActiveChatJobId] = useState<string | null>(null);
  const [modelsData, setModelsData] = useState<any[]>([]);
  const [conditionSets, setConditionSets] = useState<any[]>([]);

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

    const unsubscribeModels = onValue(ref(db, 'models'), (snap) => setModelsData(snap.exists() ? Object.entries(snap.val()).map(([id, v]: [string, any]) => ({ id, ...v })) : []));
    const unsubscribeConditions = onValue(ref(db, 'settings/condition_sets'), (snap) => setConditionSets(snap.exists() ? Object.entries(snap.val()).map(([id, v]: [string, any]) => ({ id, ...v })) : []));

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
      await update(ref(db, `jobs/${jobId}`), { status: newStatus, qc_logs: [{ action: newStatus, details: logDetails, by: currentUser?.name || 'Admin', timestamp: Date.now() }, ...(job.qc_logs || [])], updated_at: Date.now(), ...(extraData || {}) });
    };
    return <B2BManager job={job} onUpdateStatus={handleB2BUpdateStatus} onClose={onBack} basePricing={modelsData} />;
  }

  const basePrice = Number(job.final_price || job.price || 0);
  const pickupFee = job.receive_method === 'Pickup' ? Number(job.pickup_fee || 0) : 0;
  const couponValue = Number(job.applied_coupon?.actual_value || job.applied_coupon?.value || 0);
  const netPayout = Math.max(0, basePrice - pickupFee + couponValue);
  const statusLower = String(job.status || '').trim().toLowerCase();
  const isCancelled = ['cancelled', 'closed (lost)', 'returned', 'return confirmed', 'drop-off expired', 'shipping expired', 'parcel lost'].includes(statusLower) || statusLower.includes('cancel');
  // Tolerant matching: each bucket carries both legacy DB strings and the
  // canonical names from src/types/job-statuses.ts so the workspace lights
  // up the right action panel regardless of which writer touched the job.
  const isNew = [
    // legacy
    'new lead', 'following up', 'appointment set', 'waiting drop-off', 'active leads',
    // canonical
    'awaiting shipping', 'active lead',
  ].includes(statusLower);
  const isLogistics = [
    // legacy
    'assigned', 'accepted', 'arrived',
    // canonical
    'rider assigned', 'rider accepted', 'rider en route', 'rider arrived',
  ].includes(statusLower);
  const isQC = [
    'being inspected', 'pending qc', 'qc review', 'discrepancy reported',
  ].includes(statusLower);
  const isNegotiation = ['revised offer', 'negotiation'].includes(statusLower);
  const isProcessingPayment = statusLower === 'payout processing' || statusLower === 'waiting for finance' || statusLower === 'waiting for handover';
  const hasBeenPaid = !!job.paid_at || !!job.payment_slip || ['paid', 'deal closed', 'deal closed (negotiated)', 'in stock', 'sent to qc lab', 'payment completed', 'completed', 'success', 'transferred', 'waiting for handover', 'ready to sell', 'sold', 'rider returning'].includes(statusLower) || statusLower.includes('paid') || job.qc_logs?.some((log: any) => ['paid', 'payment completed'].includes(log.action?.toLowerCase()));

  const makeLog = (action: string, details: string) => ({ action, details, by: currentUser?.name || 'Admin', timestamp: Date.now() });
  const buildUpdatedDevices = (newBasePrice: number) => {
    const devs = job.devices ? [...job.devices] : [];
    // อัปเดตเฉพาะ price (ราคาปัจจุบัน) — ไม่แตะ estimated_price ซึ่งเป็นราคาที่ลูกค้าประเมินตอนล็อก
    // ใช้เป็นฐานของ Internal QC (ล็อค 7 วัน) ถ้าเขียนทับจะทำให้ประเมินซ้ำแล้วค่าตกทบ
    if (devs.length === 1) devs[0] = { ...devs[0], price: newBasePrice };
    else if (devs.length > 1) {
      const diff = basePrice - newBasePrice;
      devs[0] = { ...devs[0], price: Math.max(0, Number(devs[0].price || 0) - diff) };
    }
    return devs;
  };

  const handleUpdateStatus = async (newStatus: string, details: string) => {
    await update(ref(db, `jobs/${job.id}`), { status: newStatus, qc_logs: [makeLog(newStatus, details), ...(job.qc_logs || [])], updated_at: Date.now() });
  };
  const handleCallCustomer = async () => {
    if (!job?.cust_phone) { toast.warning('ไม่พบเบอร์โทรศัพท์ลูกค้า'); return; }
    window.location.href = `tel:${job.cust_phone}`;
    if (job.status === 'New Lead') await update(ref(db, `jobs/${job.id}`), { status: 'Following Up', qc_logs: [makeLog('Following Up', 'แอดมินกดโทรติดต่อลูกค้าเพื่อคอนเฟิร์มนัดหมาย'), ...(job.qc_logs || [])], updated_at: Date.now() });
  };
  const handleSaveCustomerInfo = async () => {
    try {
      const p: any = { cust_name: editCustData.name, cust_phone: editCustData.phone, cust_email: editCustData.email };
      if (job.receive_method === 'Store-in') p.store_branch = editCustData.address; else p.cust_address = editCustData.address;
      p.qc_logs = [makeLog('Customer Info Updated', 'อัปเดตข้อมูลการติดต่อ/ที่อยู่ของลูกค้า'), ...(job.qc_logs || [])];
      await update(ref(db, `jobs/${job.id}`), p);
      setIsEditingCustomer(false);
    } catch { toast.error('เกิดข้อผิดพลาดในการอัปเดตข้อมูล'); }
  };
  const handleApplyAdminCoupon = async () => {
    if (!adminCouponCode || !adminCouponValue) { toast.warning('กรุณาระบุชื่อโค้ดและจำนวนเงิน'); return; }
    const val = Number(adminCouponValue);
    await update(ref(db, `jobs/${job.id}`), {
      applied_coupon: { code: adminCouponCode, name: 'Admin Manual Top-up', value: val, actual_value: val },
      net_payout: Math.max(0, basePrice - pickupFee + val), qc_logs: [makeLog('Admin Top-up', `แอดมินเพิ่มคูปองพิเศษ: ${adminCouponCode} (+${val}฿)`), ...(job.qc_logs || [])], updated_at: Date.now()
    });
    setIsAddingCoupon(false); setAdminCouponCode(''); setAdminCouponValue('');
  };
  const handleRemoveCoupon = async () => {
    if (!confirm('ยืนยันการลบคูปองและดึงเงินกลับ?')) return;
    await update(ref(db, `jobs/${job.id}`), {
      applied_coupon: null, net_payout: Math.max(0, basePrice - pickupFee),
      qc_logs: [makeLog('Coupon Revoked', `แอดมินยกเลิกการใช้คูปอง: ${job.applied_coupon?.code} (-${job.applied_coupon?.value}฿)`), ...(job.qc_logs || [])], updated_at: Date.now()
    });
  };

  const handleReviseOffer = async () => {
    if (!revisedPrice) { toast.warning('กรุณาระบุราคาใหม่'); return; }
    if (!confirm(`ยืนยันการตั้งราคาเครื่องใหม่เป็น ${revisedPrice} บาท? (ระบบจะหักค่าไรเดอร์อัตโนมัติ)`)) return;
    const p = Number(revisedPrice), net = Math.max(0, p - pickupFee + couponValue);
    await update(ref(db, `jobs/${job.id}`), {
      status: 'Negotiation', price: p, final_price: p, net_payout: net, devices: buildUpdatedDevices(p),
      qc_logs: [makeLog('Revised Offer', `เสนอราคาเครื่องใหม่: ${p} บ. (ยอดสุทธิ: ${net} บ.) เหตุผล: ${reviseReason}`), ...(job.qc_logs || [])], updated_at: Date.now()
    });
    setRevisedPrice(''); setReviseReason('');
  };

  const handleCloseNegotiation = async () => {
    if (!negotiatedPrice) { toast.warning('กรุณาระบุราคาปิดดีล'); return; }
    if (!confirm(`ยืนยันปิดการขายที่ราคาเครื่อง ${negotiatedPrice} บาท?`)) return;
    const p = Number(negotiatedPrice), net = Math.max(0, p - pickupFee + couponValue);
    await update(ref(db, `jobs/${job.id}`), {
      status: 'Payout Processing', price: p, final_price: p, net_payout: net, devices: buildUpdatedDevices(p),
      qc_logs: [makeLog('Deal Closed (Negotiated)', `จบการเจรจา ราคาเครื่อง: ${p} บ. (ยอดโอนลูกค้า: ${net} บ.)`), ...(job.qc_logs || [])], updated_at: Date.now()
    });
  };

  const handleCancelTicket = async (category: CancelCategory, detail: string) => {
    const categoryLabel = CANCEL_CATEGORY_LABEL_TH[category];
    // Free text is the operator's words; combine with the category label
    // only for the human-readable qc_logs entry. Structured analytics read
    // cancel_category directly.
    const fullReason = detail ? `${categoryLabel} — ${detail}` : categoryLabel;
    await update(ref(db, `jobs/${job.id}`), {
      status: 'Cancelled',
      cancel_category: category,
      cancel_reason: detail || null,
      cancelled_by: `staff:${currentUser?.id || 'admin'}`,
      cancelled_at: Date.now(),
      qc_logs: [makeLog('Cancelled', `ยกเลิกออเดอร์ เหตุผล: ${fullReason}`), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    setIsCancelModalOpen(false);
  };
  const handleSaveNotes = async () => {
    if (!callNotes.trim()) return;
    await update(ref(db, `jobs/${job.id}`), { qc_logs: [makeLog('CRM Note', callNotes), ...(job.qc_logs || [])] });
    setCallNotes('');
  };
  const handleClaimTicket = async () => {
    // Option B of the status redesign: every method (Pickup, Store-in,
    // Mail-in) now starts at "New Lead". Admin's claim action — the
    // "อ่าน / รับเคส" button — flips it to "Active Lead". For Pickup
    // that's also the trigger that broadcasts to riders (rider Cloud
    // Function onBroadcastJob). For Store-in / Mail-in the admin then
    // moves on to "Following Up" via the next button.
    const nextStatus = job.status === 'New Lead' ? JOB_STATUS.ACTIVE_LEAD : job.status;
    await update(ref(db, `jobs/${job.id}`), {
      agent_name: currentUser?.name || 'Admin',
      agent_id: currentUser?.id || 'admin_1',
      status: nextStatus,
      is_read: true,
      qc_logs: [makeLog('Claimed Ticket', 'แอดมินอ่าน/รับเคสแล้ว'), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
  };

  const handleToggleEdit = (editing: boolean, data?: { name: string; phone: string; email: string; address: string }) => {
    setIsEditingCustomer(editing);
    if (data) setEditCustData(data);
  };

  return (
    <div className="fixed inset-0 bg-[#F1F5F9] flex flex-col z-[9999] overflow-hidden animate-in fade-in duration-300">
      {/* Global Header */}
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
        <div className="flex-1 overflow-y-auto p-8 no-scrollbar pb-24">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-white px-10 py-6 rounded-[2.5rem] shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pipeline Status</p>
                <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1 rounded-lg border border-blue-100">{job.status}</span>
              </div>
              <SmartPipeline job={job} />
            </div>
            <CustomerInfoCard job={job} isEditing={isEditingCustomer} editData={editCustData} onSave={handleSaveCustomerInfo} onToggleEdit={handleToggleEdit} onEditChange={setEditCustData} />
            <ConditionVerification job={job} modelsData={modelsData} conditionSets={conditionSets} />
          </div>
        </div>
        <PricingSidebar
          job={job}
          handlers={{ handleUpdateStatus, handleCallCustomer, handleReviseOffer, handleCloseNegotiation, handleApplyAdminCoupon, handleRemoveCoupon, handleSaveNotes, setIsQCModalOpen, setIsCancelModalOpen, setActiveChatJobId }}
          couponState={{ isAddingCoupon, setIsAddingCoupon, adminCouponCode, setAdminCouponCode, adminCouponValue, setAdminCouponValue, revisedPrice, setRevisedPrice, reviseReason, setReviseReason, negotiatedPrice, setNegotiatedPrice, callNotes, setCallNotes }}
          pricing={{ basePrice, pickupFee, couponValue, netPayout, isCancelled, isNew, isLogistics, isQC, isNegotiation, isProcessingPayment, hasBeenPaid }}
          currentUserName={currentUser?.name || 'Admin'}
        />
      </div>
      <CancelModal isOpen={isCancelModalOpen} onClose={() => setIsCancelModalOpen(false)} onConfirm={handleCancelTicket} />
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
