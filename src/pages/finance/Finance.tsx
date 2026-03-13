// src/pages/finance/Finance.tsx
import React, { useState } from 'react';
import { Landmark, Smartphone, Bike, CheckCircle2, History } from 'lucide-react';

// Import ครบทุก Component ย่อย
import { TradeInPayouts } from './components/TradeInPayouts';
import { RiderWithdrawals } from './components/RiderWithdrawals';
import { RiderSettlements } from './components/RiderSettlements';
import { FinanceAuditLog } from './components/FinanceAuditLog'

export const Finance = () => {
  const [activeTab, setActiveTab] = useState<'payouts' | 'withdrawals' | 'settlements' | 'audit'>('payouts');

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
      </div>

    </div>
  );
};