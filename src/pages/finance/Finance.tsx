// src/pages/finance/Finance.tsx
import React, { useState, useMemo } from 'react';
import { Landmark, Smartphone, Bike, CheckCircle2, History, Wrench, Trash2 } from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';

// Import ครบทุก Component ย่อย
import { TradeInPayouts } from './components/TradeInPayouts';
import { RiderWithdrawals } from './components/RiderWithdrawals';
import { RiderSettlements } from './components/RiderSettlements';
import { FinanceAuditLog } from './components/FinanceAuditLog'
import { TransactionRepair } from './components/TransactionRepair'
import { DataCleanup } from './components/DataCleanup'

export const Finance = () => {
  const [activeTab, setActiveTab] = useState<'payouts' | 'withdrawals' | 'settlements' | 'audit' | 'repair' | 'cleanup'>('payouts');

  // Integrity check: นับจำนวน jobs ที่จ่ายแล้วแต่ไม่มี transaction
  const { data: jobs } = useDatabase('jobs');
  const { data: transactions } = useDatabase('transactions');
  const orphanCount = useMemo(() => {
    const jobList = Array.isArray(jobs) ? jobs : [];
    const txList = Array.isArray(transactions) ? transactions : [];
    const txJobIds = new Set(txList.map(t => t.ref_job_id).filter(Boolean));
    return jobList.filter(j => {
      const isPaid = j.paid_at && (j.status === 'Waiting for Handover' || j.status === 'Sent to QC Lab' || j.status === 'Completed' || j.status === 'Payment Completed' || j.status === 'Pending QC');
      return isPaid && !txJobIds.has(j.id);
    }).length;
  }, [jobs, transactions]);

  return (
    <div className="p-8 space-y-8 bg-[#F8FAFC] min-h-screen font-sans">
      
      {/* 🏛️ HEADER & TAB NAVIGATION */}
      <div className="flex justify-between items-end no-print">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase flex items-center gap-3">
             <Landmark className="text-blue-600" size={32}/> Finance Center
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ศูนย์กลางจัดการการโอนเงินและบัญชี</p>
          
          <div className="flex gap-2 mt-6 bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 w-fit">
             <button onClick={() => setActiveTab('payouts')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'payouts' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'text-slate-400 hover:bg-slate-50'}`}>
                <Smartphone size={16}/> จ่ายเงินลูกค้า (Trade-In)
             </button>
             <button onClick={() => setActiveTab('withdrawals')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'withdrawals' ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'text-slate-400 hover:bg-slate-50'}`}>
                <Bike size={16}/> ไรเดอร์เบิกเงิน (Cashout)
             </button>
             <button onClick={() => setActiveTab('settlements')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'settlements' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'text-slate-400 hover:bg-slate-50'}`}>
                <CheckCircle2 size={16}/> อนุมัติค่ารอบ (Settlement)
             </button>
             <button onClick={() => setActiveTab('audit')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'audit' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}>
                <History size={16}/> ประวัติบัญชี (Audit Log)
             </button>
             <button onClick={() => setActiveTab('repair')} className={`relative px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'repair' ? 'bg-amber-500 text-white shadow-lg shadow-amber-200' : 'text-slate-400 hover:bg-slate-50'}`}>
                <Wrench size={16}/> ซ่อม Transaction
                {orphanCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5 shadow-lg animate-pulse">
                    {orphanCount}
                  </span>
                )}
             </button>
             <button onClick={() => setActiveTab('cleanup')} className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase flex items-center gap-2 transition-all ${activeTab === 'cleanup' ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'text-slate-400 hover:bg-slate-50'}`}>
                <Trash2 size={16}/> ล้างข้อมูลทดสอบ
             </button>
          </div>
        </div>
      </div>

      {/* 🚀 RENDER SUB-COMPONENTS */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
         {/* แสดงผลตาม Tab ที่เลือก และลบกล่อง Under Construction ออกแล้ว */}
         {activeTab === 'payouts' && <TradeInPayouts />}
         {activeTab === 'withdrawals' && <RiderWithdrawals />}
         {activeTab === 'settlements' && <RiderSettlements />}
         {activeTab === 'audit' && <FinanceAuditLog />}
         {activeTab === 'repair' && <TransactionRepair />}
         {activeTab === 'cleanup' && <DataCleanup />}
      </div>

    </div>
  );
};