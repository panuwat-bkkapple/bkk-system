// src/pages/finance/components/RiderWithdrawals.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { useAuth } from '../../../hooks/useAuth';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { uploadImageToFirebase } from '../../../utils/uploadImage'; // ✅ ใช้ Utility
import { Search, CheckCircle2, X, Copy, Check, Bike, Upload, FileText, Loader2 } from 'lucide-react';
import { ref, update, push, child } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';

export const RiderWithdrawals = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const { data: jobs, loading } = useDatabase('jobs');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  
  // 📸 State สำหรับอัปโหลดสลิป
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const pendingWithdrawals = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list.filter(j => 
        j.status === 'Withdrawal Requested' && 
        j.type === 'Withdrawal' &&
        (j.rider_name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
         j.rider_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.bank_account?.includes(searchTerm))
    ).sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
  }, [jobs, searchTerm]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSlipFile(e.target.files[0]);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!selectedTx) return;
    if (!slipFile) { toast.warning("กรุณาแนบสลิปการโอนเงินเพื่อเป็นหลักฐาน"); return; } // 🔒 บังคับแนบสลิป

    if (!confirm(`ยืนยันการโอนเงิน ${formatCurrency(selectedTx.withdraw_amount)} ให้ไรเดอร์?`)) return;

    setIsUploading(true);
    try {
      const now = Date.now();
      
      // 1. อัปโหลดสลิป
      const slipUrl = await uploadImageToFirebase(slipFile, `slips/withdrawals/${selectedTx.id}_${now}`);

      // Atomic multi-path update: job + transaction ในครั้งเดียว
      const txKey = push(child(ref(db), 'transactions')).key;
      const updates: Record<string, any> = {};
      updates[`jobs/${selectedTx.id}/status`] = 'Completed';
      updates[`jobs/${selectedTx.id}/paid_at`] = now;
      updates[`jobs/${selectedTx.id}/paid_by`] = currentUser?.name || 'Finance';
      updates[`jobs/${selectedTx.id}/payment_slip`] = slipUrl;
      updates[`transactions/${txKey}`] = {
        rider_id: selectedTx.rider_id,
        amount: Number(selectedTx.withdraw_amount),
        type: 'DEBIT',
        category: 'WITHDRAWAL',
        description: `ถอนเงินเข้าบัญชี ${selectedTx.bank_name} (${selectedTx.bank_account})`,
        timestamp: now,
        ref_job_id: selectedTx.id,
        slip_url: slipUrl
      };
      await update(ref(db), updates);

      toast.success('บันทึกการโอนเงินพร้อมสลิปสำเร็จ!');
      setSelectedTx(null);
      setSlipFile(null);
    } catch (e) { toast.error('Error: ' + e); }
    finally { setIsUploading(false); }
  };

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Loading Cashouts...</div>;

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input type="text" placeholder="ค้นหาด้วยชื่อไรเดอร์, รหัส หรือ เลขบัญชี..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="w-full pl-14 pr-8 py-4 bg-white border border-slate-100 rounded-2xl font-bold outline-none shadow-sm focus:ring-4 ring-orange-500/5 transition-all" />
      </div>

      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
              <th className="p-6 pl-10">Time Requested</th>
              <th className="p-6">Rider Info</th>
              <th className="p-6">Bank Details (บัญชีโอนออก)</th>
              <th className="p-6 text-center">Amount</th>
              <th className="p-6 text-right pr-10">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pendingWithdrawals.map((tx) => (
               <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                 <td className="p-6 pl-10">
                   <div className="text-[11px] font-bold text-slate-600 mb-1">{formatDate(tx.requested_at)}</div>
                 </td>
                 <td className="p-6">
                   <div className="font-black text-slate-800 text-sm flex items-center gap-2"><Bike size={14} className="text-orange-500"/> {tx.rider_name || 'Unknown'}</div>
                   <div className="text-[10px] font-bold text-slate-400 font-mono mt-1">ID: {tx.rider_id}</div>
                 </td>
                 <td className="p-6">
                   <div className="font-black text-slate-700 text-xs uppercase">{tx.bank_name || 'N/A'}</div>
                   <div className="text-[11px] font-mono font-bold text-slate-500 mt-1 flex items-center gap-2">
                      {tx.bank_account || 'No Account'} 
                      {tx.bank_account && <button onClick={() => handleCopy(tx.bank_account)} className="text-orange-500 hover:text-orange-700 p-1 bg-orange-50 rounded transition-colors">{copiedText === tx.bank_account ? <Check size={12}/> : <Copy size={12}/>}</button>}
                   </div>
                   <div className="text-[9px] text-slate-400 font-bold mt-1">ACC: {tx.bank_holder || tx.rider_name}</div>
                 </td>
                 <td className="p-6 text-center">
                    <span className="font-black text-red-500 text-lg bg-red-50 px-3 py-1 rounded-xl">-{formatCurrency(tx.withdraw_amount)}</span>
                 </td>
                 <td className="p-6 text-right pr-10">
                    <button onClick={() => { setSelectedTx(tx); setSlipFile(null); }} className="px-6 py-3 bg-gray-900 text-white rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-black active:scale-95 transition-all">โอนเงิน</button>
                 </td>
               </tr>
            ))}
            {pendingWithdrawals.length === 0 && <tr><td colSpan={5} className="p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">ไม่มีรายการขอเบิกเงิน 🎉</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedTx && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in">
           <div className="bg-white rounded-[3rem] w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                 <div><h3 className="text-2xl font-black text-slate-800 uppercase">Rider Cashout</h3><p className="text-[10px] font-bold text-orange-500 tracking-widest uppercase mt-1">{selectedTx.rider_name}</p></div>
                 <button onClick={()=>setSelectedTx(null)} className="p-3 hover:bg-slate-100 rounded-2xl transition-colors text-slate-400"><X size={28}/></button>
              </div>
              <div className="p-10 space-y-6">
                 <div className="text-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Withdrawal Amount</p>
                    <h1 className="text-6xl font-black text-red-500">-{formatCurrency(selectedTx.withdraw_amount)}</h1>
                 </div>
                 
                 <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200 space-y-4">
                    <div className="flex justify-between items-center"><span className="text-xs font-black text-slate-400 uppercase tracking-widest">Bank</span><span className="font-black text-slate-800 uppercase">{selectedTx.bank_name}</span></div>
                    <div className="flex justify-between items-center py-4 border-y border-slate-200"><span className="text-xs font-black text-slate-400 uppercase tracking-widest">Account Number</span><div className="flex items-center gap-3"><span className="font-mono text-2xl font-black tracking-widest text-slate-900">{selectedTx.bank_account}</span><button onClick={() => handleCopy(selectedTx.bank_account)} className="bg-orange-100 text-orange-600 p-2 rounded-xl hover:bg-orange-200">{copiedText === selectedTx.bank_account ? <Check size={20}/> : <Copy size={20}/>}</button></div></div>
                    <div className="flex justify-between items-center"><span className="text-xs font-black text-slate-400 uppercase tracking-widest">Account Name</span><span className="font-bold text-slate-700">{selectedTx.bank_holder || selectedTx.rider_name}</span></div>
                 </div>

                 {/* 📸 ส่วนอัปโหลดสลิป */}
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Slip (หลักฐานการโอน)</label>
                    <label className={`block w-full border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-colors ${slipFile ? 'border-orange-500 bg-orange-50' : 'border-slate-300 hover:border-orange-500 hover:bg-orange-50'}`}>
                        <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                        {slipFile ? (
                            <div className="flex items-center justify-center gap-2 text-orange-700 font-bold text-sm">
                                <FileText size={20}/> {slipFile.name}
                            </div>
                        ) : (
                            <div className="text-slate-400 flex flex-col items-center gap-2">
                                <Upload size={24}/> <span className="text-xs font-bold uppercase">Click to Upload Slip</span>
                            </div>
                        )}
                    </label>
                 </div>

                 <button 
                    onClick={handleConfirmTransfer}
                    disabled={isUploading}
                    className={`w-full text-white py-6 rounded-[2rem] font-black text-lg flex items-center justify-center gap-3 shadow-xl transition-all uppercase ${isUploading ? 'bg-slate-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-black active:scale-95'}`}
                 >
                    {isUploading ? <Loader2 size={24} className="animate-spin"/> : <CheckCircle2 size={24}/>} 
                    {isUploading ? 'Uploading & Saving...' : 'Confirm & Mark as Paid'}
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};