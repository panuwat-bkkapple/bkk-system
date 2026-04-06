import React, { useState, useMemo } from 'react';
import { useDatabase } from '@/hooks/useDatabase';
import { useAuth } from '@/hooks/useAuth';
import { PlusCircle, Search, Building2, Smartphone, FileText, CheckCircle2, Clock, AlertCircle, Zap } from 'lucide-react';
import { ref, update, push } from 'firebase/database';
import { db } from '@/api/firebase';
import { useToast } from '@/components/ui/ToastProvider';
import { withRetry } from '@/utils/firebaseRetry';

// นำเข้า Components หลัก (ลบ Modal เก่าๆ ออกไปแล้ว)
import { JobTable } from './components/modal/TradeInUI';
import { CreateTicketModal } from './components/CreateTicketModal';
import { InstantSellModal } from './components/InstantSellModal';
import { CreateB2BModal } from './components/CreateB2BModal';

export const TradeInDashboard = ({ onOpenWorkspace }: { onOpenWorkspace?: (id: string) => void }) => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const { data: jobs, loading } = useDatabase('jobs');
  
  // 🔥 1. State สำหรับสลับโหมด Workspace (B2C vs B2B)
  const [workspace, setWorkspace] = useState<'B2C' | 'B2B'>('B2C');

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAgent, setFilterAgent] = useState<'All' | 'Me' | 'Unassigned'>('All');
  const [filterPhase, setFilterPhase] = useState<'All' | 'Sales' | 'Logistics' | 'Closed'>('All');
  const [filterMethod, setFilterMethod] = useState<'All' | 'Store-in' | 'Pickup' | 'Mail-in'>('All');

  // Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isInstantSellOpen, setIsInstantSellOpen] = useState(false);
  const [isB2BCreateOpen, setIsB2BCreateOpen] = useState(false);

  // 🎯 2. อัปเดตการกรองข้อมูล (แยก B2C และ B2B เด็ดขาด)
  const displayJobs = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list.filter(j => {
      const isB2BParent = j.type === 'B2B Trade-in';
      const isB2BChild = j.type === 'B2B-Unpacked';

      // 🛒 หน้า B2C: ห้ามโชว์งาน B2B
      if (workspace === 'B2C' && (isB2BParent || isB2BChild)) return false;
      
      // 🏢 หน้า B2B: โชว์เฉพาะ "งานแม่ (เหมา)"
      if (workspace === 'B2B' && !isB2BParent) return false;

      // 🔍 ค้นหา (Search)
      const isMatch = j.model?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                      j.ref_no?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                      j.cust_phone?.includes(searchTerm) || 
                      j.cust_name?.toLowerCase().includes(searchTerm.toLowerCase());
      if (!isMatch) return false;
      
      // 📱 ตัวกรองสำหรับ B2C
      if (workspace === 'B2C') {
        if (filterAgent === 'Me' && j.agent_name !== currentUser?.name) return false;
        if (filterAgent === 'Unassigned' && j.agent_name) return false;
        if (filterMethod !== 'All' && j.receive_method !== filterMethod) return false;

        const isSales = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off'].includes(j.status);
        const isLogistics = ['Active Leads', 'Assigned', 'Arrived', 'In-Transit', 'Pending QC', 'Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation', 'Payout Processing', 'Waiting for Handover'].includes(j.status);
        const isClosed = ['Paid', 'PAID', 'Sent to QC Lab', 'In Stock', 'Ready to Sell', 'Completed', 'Sold', 'Cancelled', 'Closed (Lost)', 'Returned'].includes(j.status);

        if (filterPhase === 'Sales' && !isSales) return false;
        if (filterPhase === 'Logistics' && !isLogistics) return false;
        if (filterPhase === 'Closed' && !isClosed) return false;
      } 
      // 🏢 ตัวกรองสำหรับ B2B
      else {
        const isB2BSales = ['New B2B Lead', 'Pre-Quote Sent', 'Site Visit & Grading', 'Final Quote Sent'].includes(j.status);
        const isB2BLogistics = ['PO Issued', 'Waiting for Invoice/Tax Inv.', 'Payment Completed'].includes(j.status);
        const isB2BClosed = ['In Stock', 'Cancelled'].includes(j.status);

        if (filterPhase === 'Sales' && !isB2BSales) return false;
        if (filterPhase === 'Logistics' && !isB2BLogistics) return false;
        if (filterPhase === 'Closed' && !isB2BClosed) return false;
      }

      return true;
    }).sort((a, b) => b.created_at - a.created_at);
  }, [jobs, searchTerm, filterAgent, filterPhase, filterMethod, currentUser, workspace]);

  // ฟังก์ชันสร้าง Ticket (B2C)
  const handleCreateTicket = async (payload: any) => {
    try {
      const finalPayload = {
        ...payload,
        created_at: Date.now(),
        created_by: currentUser?.name || 'Admin',
        is_read: false,
        ref_no: `OID-${Math.floor(100000 + Math.random() * 900000)}`,
        updated_at: Date.now()
      };
      await push(ref(db, 'jobs'), finalPayload);
      setIsCreateModalOpen(false);
    } catch (error) {
      toast.error("เกิดข้อผิดพลาดในการสร้าง Ticket");
    }
  };

  // Instant Sell: สร้าง Ticket แบบด่วนจากแอดมิน
  const handleInstantSell = async (payload: any) => {
    try {
      const finalPayload = {
        ...payload,
        price: Number(payload.price),
        type: 'Trade-in',
        source: 'instant-sell',
        status: 'Active Leads',
        receive_method: 'Store-in',
        created_at: Date.now(),
        created_by: currentUser?.name || 'Admin',
        agent_name: currentUser?.name || 'Admin',
        agent_id: currentUser?.id || 'admin_1',
        is_read: true,
        ref_no: `OID-${Math.floor(100000 + Math.random() * 900000)}`,
        updated_at: Date.now(),
        qc_logs: [{
          action: 'Instant Sell Created',
          by: currentUser?.name || 'Admin',
          timestamp: Date.now(),
          details: `เปิดรับซื้อด่วน — ราคา ฿${Number(payload.price).toLocaleString()}${payload.offer_note ? ` (${payload.offer_note})` : ''}`
        }]
      };
      await push(ref(db, 'jobs'), finalPayload);
      setIsInstantSellOpen(false);
      toast.success('เปิดรับซื้อด่วนสำเร็จ!');
    } catch (error) {
      toast.error("เกิดข้อผิดพลาดในการสร้าง Ticket");
    }
  };

  // ฟังก์ชันสร้าง B2B Deal
  const handleCreateB2B = async (payload: any) => {
    try {
      const finalPayload = {
        cust_name: payload.cust_name,
        cust_phone: payload.cust_phone,
        cust_email: payload.cust_email || '',
        cust_address: payload.cust_address || '',
        asset_details: payload.asset_details || '',
        price: Number(payload.price) || 0,
        type: 'B2B Trade-in',
        status: 'New B2B Lead',
        source: 'admin-b2b',
        attached_file_name: payload.attached_file_name || '',
        attached_file_url: payload.attached_file_url || '',
        created_at: Date.now(),
        created_by: currentUser?.name || 'Admin',
        agent_name: currentUser?.name || 'Admin',
        agent_id: currentUser?.id || 'admin_1',
        is_read: true,
        ref_no: `OID-${Math.floor(100000 + Math.random() * 900000)}`,
        updated_at: Date.now(),
        customer_id: payload.customer_id || '',
        qc_logs: [{
          action: 'New B2B Lead Created',
          by: currentUser?.name || 'Admin',
          timestamp: Date.now(),
          details: `สร้างดีล B2B — ${payload.cust_name}${payload.notes ? ` (${payload.notes})` : ''}`
        }]
      };
      await push(ref(db, 'jobs'), finalPayload);
      setIsB2BCreateOpen(false);
      toast.success('สร้างดีล B2B สำเร็จ!');
    } catch (error) {
      toast.error("เกิดข้อผิดพลาดในการสร้างดีล B2B");
    }
  };

  // 🌟 ทำความสะอาดฟังก์ชัน (ไม่ต้องพึ่งพาระบบ Modal เก่าแล้ว)
  const handleUpdateStatus = async (id: string, newStatus: string, logMsg: string, extraData: any = {}) => {
    const job = (jobs as any[]).find(j => j.id === id);
    const updatedLogs = [
      { action: newStatus, by: currentUser?.name || 'Admin', timestamp: Date.now(), details: logMsg },
      ...(job?.qc_logs || [])
    ];

    let cancelReason = extraData.cancel_reason || '';

    if (!cancelReason && (newStatus === 'Closed (Lost)' || newStatus === 'Cancelled' || newStatus === 'Returned')) {
      cancelReason = prompt(`ระบุเหตุผลสำหรับสถานะ ${newStatus}:`) || 'ไม่ระบุเหตุผล';
      updatedLogs[0].details = `${logMsg} (เหตุผล: ${cancelReason})`;
    } else if (cancelReason) {
      updatedLogs[0].details = `${logMsg} (เหตุผล: ${cancelReason})`;
    }

    try {
      await withRetry(() => update(ref(db, `jobs/${id}`), {
        status: newStatus,
        qc_logs: updatedLogs,
        cancel_reason: cancelReason || null,
        updated_at: Date.now(),
        ...extraData
      }));
    } catch (error) {
      console.error('Status update failed:', error);
      toast.error('บันทึกสถานะล้มเหลว กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleReviseOffer = async (job: any, price: string, reason: string, targetStatus: string = 'Revised Offer') => {
    if (!price || !reason) { toast.warning('กรุณาระบุราคาและเหตุผลให้ครบถ้วน'); return; }
    const actionLabel = targetStatus === 'Payout Processing' ? 'Deal Closed (Negotiated)' : 'Revised Offer';
    if (!confirm(`ยืนยันการตั้งราคาใหม่ที่ ${price} บาท?`)) return;

    const newNetPayout = Number(price); 
    const pickupFee = Number(job.pickup_fee || 0);
    const couponValue = Number(job.applied_coupon?.actual_value || job.applied_coupon?.value || 0);
    const newOriginalPrice = newNetPayout + pickupFee - couponValue;

    const updatedLogs = [
      { action: actionLabel, by: currentUser?.name || 'Admin', timestamp: Date.now(), details: `${reason} - ราคาตกลงสุทธิ: ฿${newNetPayout.toLocaleString()}` }, 
      ...(job.qc_logs || [])
    ];
    
    try {
      await withRetry(() => update(ref(db, `jobs/${job.id}`), {
        status: targetStatus,
        net_payout: newNetPayout,
        final_price: newNetPayout,
        negotiated_price: newNetPayout,
        revised_price: newNetPayout,
        original_price: newOriginalPrice,
        price: newOriginalPrice,
        revise_reason: reason,
        qc_logs: updatedLogs,
        updated_at: Date.now()
      }));
    } catch (error) {
      console.error('Revise offer failed:', error);
      toast.error('บันทึกราคาล้มเหลว กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleClaimTicket = async (job: any) => {
    const updatedLogs = [{ action: 'Claimed Ticket', by: currentUser?.name || 'Admin', timestamp: Date.now(), details: 'แอดมินรับผิดชอบเคส' }, ...(job?.qc_logs || [])];
    const nextStatus = job.status === 'New Lead' ? 'Following Up' : job.status;
    try {
      await withRetry(() => update(ref(db, `jobs/${job.id}`), {
        agent_name: currentUser?.name || 'Admin',
        agent_id: currentUser?.id || 'admin_1',
        qc_logs: updatedLogs,
        status: nextStatus,
        is_read: true
      }));
    } catch (error) {
      console.error('Claim ticket failed:', error);
      toast.error('รับเคสล้มเหลว กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleSaveNotes = async (id: string, notes: string) => {
    if (!notes.trim()) return;
    const job = (jobs as any[]).find(j => j.id === id);
    if (!job) return;

    const updatedLogs = [{ action: 'Sales Note Added', by: currentUser?.name || 'Admin', timestamp: Date.now(), details: notes }, ...(job.qc_logs || [])];
    await update(ref(db, `jobs/${id}`), { qc_logs: updatedLogs });
  };

  const handleRowClick = async (job: any) => {
    // 1. อัปเดตสถานะการอ่าน
    if ((job.status === 'New Lead' || job.status === 'New B2B Lead') && !job.is_read) {
      try { await update(ref(db, `jobs/${job.id}`), { is_read: true }); } catch (error) { console.error('Mark read failed:', error); }
    }

    // 2. เรียกใช้ฟังก์ชันเข้าสู่หน้า Workspace เสมอ
    if (onOpenWorkspace) {
      onOpenWorkspace(job.id);
    } 
  };

  // 🎨 B2B Status UI Helper
  const getB2BStatusBadge = (status: string) => {
    switch (status) {
      case 'New B2B Lead': return <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-[10px] font-black tracking-widest flex items-center gap-1 w-fit"><AlertCircle size={12}/> NEW LEAD</span>;
      case 'PO Issued': return <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-[10px] font-black tracking-widest flex items-center gap-1 w-fit"><FileText size={12}/> PO ISSUED</span>;
      case 'Payment Completed': return <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black tracking-widest flex items-center gap-1 w-fit"><CheckCircle2 size={12}/> PAID</span>;
      case 'In Stock': return <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-black tracking-widest flex items-center gap-1 w-fit"><CheckCircle2 size={12}/> COMPLETED</span>;
      default: return <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-[10px] font-black tracking-widest flex items-center gap-1 w-fit"><Clock size={12}/> {status}</span>;
    }
  };

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Syncing CRM Center...</div>;

  return (
    <div className="p-8 space-y-6 bg-[#F8FAFC] min-h-screen font-sans">
      
      {/* 🚀 Header & Workspace Switcher */}
      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase flex items-center gap-3">
              Trade-In CRM <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-md tracking-widest border border-blue-200">PRO</span>
            </h2>
            <p className="text-sm font-bold text-slate-500 mt-1">Management System</p>
          </div>

          {/* 🔥 สวิตช์สลับโหมด (Workspace Toggle) */}
          <div className="flex bg-slate-200/50 p-1.5 rounded-2xl w-fit border border-slate-200 shadow-inner">
            <button 
              onClick={() => setWorkspace('B2C')} 
              className={`px-8 py-3 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${workspace === 'B2C' ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Smartphone size={18}/> Retail (B2C)
            </button>
            <button 
              onClick={() => setWorkspace('B2B')} 
              className={`px-8 py-3 rounded-xl font-black text-sm transition-all flex items-center gap-2 ${workspace === 'B2B' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Building2 size={18}/> Corporate (B2B)
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-[2rem] border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input type="text" placeholder={`ค้นหา${workspace === 'B2B' ? 'บริษัท' : 'ชื่อลูกค้า'}, OID...`} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-12 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none w-64" />
            </div>
            <div className="h-8 w-px bg-slate-200"></div>
            
            <div className="flex bg-slate-100 p-1 rounded-xl">
              {['Sales', 'Logistics', 'Closed', 'All'].map(phase => (
                <button key={phase} onClick={() => setFilterPhase(phase as any)} className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase transition-all ${filterPhase === phase ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>{phase}</button>
              ))}
            </div>
            
            {/* ซ่อน Filter Agent และ Method ในโหมด B2B เพราะมักจะดูแลโดยทีมส่วนกลาง */}
            {workspace === 'B2C' && (
              <>
                <div className="flex bg-blue-50/50 p-1 rounded-xl border border-blue-100">
                  {['All', 'Me', 'Unassigned'].map(agent => (
                    <button key={agent} onClick={() => setFilterAgent(agent as any)} className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase transition-all ${filterAgent === agent ? 'bg-blue-600 text-white shadow-sm' : 'text-blue-400'}`}>{agent === 'Me' ? 'My Tickets' : agent}</button>
                  ))}
                </div>
                <select value={filterMethod} onChange={e => setFilterMethod(e.target.value as any)} className="bg-slate-50 border border-slate-200 text-slate-600 text-xs font-black uppercase rounded-xl px-4 py-2.5 outline-none">
                  <option value="All">All Methods</option>
                  <option value="Store-in">Store-in</option>
                  <option value="Pickup">Pickup</option>
                  <option value="Mail-in">Mail-in</option>
                </select>
              </>
            )}
          </div>
          
          {workspace === 'B2C' ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setIsInstantSellOpen(true)} className="bg-amber-500 text-white px-5 py-2.5 rounded-xl font-black flex items-center gap-2 hover:bg-amber-600 transition-colors text-sm shadow-sm">
                <Zap size={16} /> Instant Sell
              </button>
              <button onClick={() => setIsCreateModalOpen(true)} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-black flex items-center gap-2 hover:bg-blue-700 transition-colors text-sm">
                <PlusCircle size={18} /> New Ticket
              </button>
            </div>
          ) : (
            <button onClick={() => setIsB2BCreateOpen(true)} className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-black flex items-center gap-2 hover:bg-black transition-colors text-sm">
              <PlusCircle size={18} /> New B2B Deal
            </button>
          )}
        </div>
      </div>

      {/* 🚀 Rendering Tables based on Workspace */}
      {workspace === 'B2C' ? (
        // ตาราง B2C
        <JobTable jobs={displayJobs} onRowClick={handleRowClick} />
      ) : (
        // 🏢 ตาราง B2B
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-4 pl-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date / OID</th>
                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Company & Contact</th>
                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Asset Details</th>
                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Est. Value (Ex-VAT)</th>
                <th className="p-4 pr-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Pipeline Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayJobs.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold">ไม่มีรายการ B2B ในขณะนี้</td></tr>
              ) : (
                displayJobs.map((job) => (
                  <tr key={job.id} onClick={() => handleRowClick(job)} className="hover:bg-slate-50 transition-colors cursor-pointer group">
                    <td className="p-4 pl-6">
                      <div className="font-bold text-sm text-slate-800">{new Date(job.created_at).toLocaleDateString('th-TH')}</div>
                      <div className="text-[10px] text-slate-400 font-black tracking-widest mt-1">{job.ref_no}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-black text-sm text-slate-900 flex items-center gap-2"><Building2 size={14} className="text-blue-500"/> {job.cust_name.split('(')[0]}</div>
                      <div className="text-xs text-slate-500 font-bold mt-1">ติดต่อ: {job.cust_name.split('(')[1]?.replace(')','') || '-'}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-bold text-slate-700 truncate max-w-[200px]">{job.asset_details || 'ยกล็อต (ดูไฟล์แนบ)'}</div>
                      {job.attached_file_name && (
                        <div className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 mt-1 w-fit flex items-center gap-1">
                          <FileText size={10}/> {job.attached_file_name}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="text-lg font-black text-emerald-600">฿{(job.price || 0).toLocaleString()}</div>
                    </td>
                    <td className="p-4 pr-6">
                      <div className="flex justify-center">
                        {getB2BStatusBadge(job.status)}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals ที่เหลืออยู่ */}
      {isCreateModalOpen && (
        <CreateTicketModal
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={(data: any) => {
            const payload = { ...data, price: Number(data.price), type: 'Trade-in', status: 'New Lead' };
            handleCreateTicket(payload);
          }}
          jobs={jobs}
        />
      )}

      {isInstantSellOpen && (
        <InstantSellModal
          onClose={() => setIsInstantSellOpen(false)}
          onSubmit={handleInstantSell}
          jobs={jobs}
        />
      )}

      {isB2BCreateOpen && (
        <CreateB2BModal
          onClose={() => setIsB2BCreateOpen(false)}
          onSubmit={handleCreateB2B}
        />
      )}
    </div>
  );
};