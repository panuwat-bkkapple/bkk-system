// src/pages/finance/components/TradeInPayouts.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { useAuth } from '../../../hooks/useAuth';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { uploadImageToFirebase } from '../../../utils/uploadImage';
import { Search, CheckCircle2, X, Copy, Check, Smartphone, Upload, FileText, Loader2 } from 'lucide-react';
import { ref, update, push, child, get } from 'firebase/database';
import { db } from '../../../api/firebase';
import { useToast } from '../../../components/ui/ToastProvider';

export const TradeInPayouts = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const { data: jobs, loading } = useDatabase('jobs');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [editBankName, setEditBankName] = useState('');
  const [editBankAccount, setEditBankAccount] = useState('');
  const [editBankHolder, setEditBankHolder] = useState('');

  // คำนวณยอดโอนสุทธิจาก final_price ทุกครั้ง — ไม่ใช้ net_payout ที่เก็บใน DB เพราะบาง path
  // (เช่น Internal QC เก่า) อัปเดต final_price โดยไม่ sync net_payout ทำให้ค่าค้าง
  const getNetPayout = (tx: any) => {
    const base = Number(tx.final_price || tx.price || 0);
    const pickupFee = tx.receive_method === 'Pickup' ? Number(tx.pickup_fee || 0) : 0;
    const coupon = Number(tx.applied_coupon?.actual_value || tx.applied_coupon?.value || 0);
    return Math.max(0, base - pickupFee + coupon);
  };

  const pendingPayouts = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    
    return list.filter(job => {
      const s = String(job.status || '').trim().toLowerCase();
      
      if (s === 'cancelled' || s === 'closed (lost)' || s === 'returned' || s.includes('cancel')) {
        return false;
      }
      if (s === 'paid' || s === 'payment completed' || s === 'sent to qc lab' || s === 'in stock' || job.slip_url || job.payment_slip) {
        return false;
      }
      // 🌟 ดึง Price Accepted ของลูกค้ามาโชว์ด้วย
      return s === 'payout processing' || 
             s === 'pending finance approval' || 
             s === 'waiting for finance' ||
             s === 'price accepted';
      
    }).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    
  }, [jobs]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setSlipFile(e.target.files[0]);
  };

  const handleConfirmTransfer = async () => {
    if (!selectedTx) return;
    if (!slipFile) { toast.warning("กรุณาแนบสลิปการโอนเงินเพื่อเป็นหลักฐาน"); return; }
    if (!editBankName || !editBankAccount || !editBankHolder) { toast.warning("กรุณาระบุข้อมูลบัญชีรับเงินให้ครบถ้วน"); return; }

    if (!confirm('ยืนยันว่าทำการโอนเงินเข้าบัญชีลูกค้าเรียบร้อยแล้ว?')) return;

    setIsUploading(true);
    try {
      const now = Date.now();
      const isB2B = selectedTx.type === 'B2B Trade-in';
      const slipUrl = await uploadImageToFirebase(slipFile, `slips/tradein/${selectedTx.id}_${now}`);

      // 🌟 ใช้ยอดสุทธิและค่าไรเดอร์ที่ถูกต้อง
      const actualTransferAmount = getNetPayout(selectedTx);
      // ค่าวิ่งจริงที่ Cloud Function คำนวณไว้ตอน Pending QC (ไม่ใช่ pickup_fee ที่เก็บจากลูกค้า)
      const riderFee = Number(selectedTx.rider_fee || 0);

      const nextStatus = isB2B ? 'Payment Completed' : 'Waiting for Handover'; 
      const logAction = isB2B ? 'Payment Completed' : 'Paid';
      const logDetails = `ฝ่ายบัญชีโอนเงินสำเร็จ ยอดสุทธิ ฿${actualTransferAmount.toLocaleString()} เข้าบัญชี ${editBankName} (${editBankAccount})`;

      const newLog = { action: logAction, by: currentUser?.name || 'Finance', timestamp: now, details: logDetails, evidence_url: slipUrl };

      // 🌟 Atomic multi-path update: job + transactions ทั้งหมดในครั้งเดียว
      // ถ้า path ใด fail ทั้งหมดจะ rollback — ไม่มี partial write
      const updates: Record<string, any> = {};

      // Job update
      updates[`jobs/${selectedTx.id}/status`] = nextStatus;
      updates[`jobs/${selectedTx.id}/paid_at`] = now;
      updates[`jobs/${selectedTx.id}/paid_by`] = currentUser?.name || 'Finance';
      updates[`jobs/${selectedTx.id}/payment_slip`] = slipUrl;
      updates[`jobs/${selectedTx.id}/updated_at`] = now;
      updates[`jobs/${selectedTx.id}/bank_name`] = editBankName;
      updates[`jobs/${selectedTx.id}/bank_account`] = editBankAccount;
      updates[`jobs/${selectedTx.id}/bank_holder`] = editBankHolder;
      updates[`jobs/${selectedTx.id}/qc_logs`] = [newLog, ...(selectedTx.qc_logs || [])];

      // Transaction: DEBIT (payout to customer)
      const debitKey = push(child(ref(db), 'transactions')).key;
      updates[`transactions/${debitKey}`] = {
        rider_id: 'SYSTEM',
        amount: actualTransferAmount,
        type: 'DEBIT',
        category: isB2B ? 'B2B_PURCHASE' : 'TRADE_IN_PAYOUT',
        description: `จ่ายเงินรับซื้อสุทธิ ${selectedTx.model} (${selectedTx.cust_name?.split('(')[0]})`,
        timestamp: now,
        ref_job_id: selectedTx.id,
        slip_url: slipUrl
      };

      // Transaction: CREDIT (logistics revenue)
      if (riderFee > 0) {
        const creditKey = push(child(ref(db), 'transactions')).key;
        updates[`transactions/${creditKey}`] = {
          rider_id: selectedTx.rider_id || 'SYSTEM',
          amount: riderFee,
          type: 'CREDIT',
          category: 'LOGISTICS_REVENUE',
          description: `รายได้ค่าบริการไรเดอร์รับเครื่อง - Ref: ${selectedTx.ref_no}`,
          timestamp: now,
          ref_job_id: selectedTx.id
        };
      }

      await update(ref(db), updates);

      // ✅ Post-payment verification: ตรวจสอบว่า transaction ถูกสร้างจริง
      const verifySnapshot = await get(ref(db, `transactions/${debitKey}`));
      if (!verifySnapshot.exists()) {
        toast.warning('⚠️ โอนเงินสำเร็จแต่ Transaction อาจไม่ถูกบันทึก — กรุณาตรวจสอบที่แท็บ "ซ่อม Transaction"');
      } else {
        toast.success('บันทึกการโอนเงินพร้อมสลิปสำเร็จ!');
      }
      setSelectedTx(null);
      setSlipFile(null);
    } catch (e) {
      toast.error('Error: ' + e);
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Loading Payouts...</div>;

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input type="text" placeholder="ค้นหาด้วยชื่อลูกค้า, เลขที่บัญชี หรือ OID..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="w-full pl-14 pr-8 py-4 bg-white border border-slate-100 rounded-2xl font-bold outline-none shadow-sm focus:ring-4 ring-blue-500/5 transition-all" />
      </div>

      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
              <th className="p-6 pl-10">Job Identity</th>
              <th className="p-6">Customer & Device</th>
              <th className="p-6">Bank Details (บัญชีโอนออก)</th>
              <th className="p-6 text-right">Net Payout</th>
              <th className="p-6 text-right pr-10">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pendingPayouts.map((tx) => (
               <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                 <td className="p-6 pl-10">
                   <div className="font-mono text-[11px] font-black text-blue-600 mb-1">{tx.ref_no}</div>
                   <div className="text-[10px] font-bold text-slate-400">{formatDate(tx.updated_at || tx.created_at)}</div>
                 </td>
                 <td className="p-6">
                   <div className="font-black text-slate-800 text-sm flex items-center gap-2"><Smartphone size={14} className="text-blue-500"/> {tx.cust_name || 'Anonymous'}</div>
                   <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{tx.model}</div>
                 </td>
                 <td className="p-6">
                   <div className="font-black text-slate-700 text-xs uppercase">
                     {tx.payment_info?.type === 'promptpay' ? 'พร้อมเพย์ (PromptPay)' : (tx.payment_info?.bank || tx.bank_name || 'N/A')}
                   </div>
                   <div className="text-[11px] font-mono font-bold text-slate-500 mt-1 flex items-center gap-2">
                      {tx.payment_info?.account_number || tx.bank_account || 'No Account'} 
                      {(tx.payment_info?.account_number || tx.bank_account) && <button onClick={() => handleCopy(tx.payment_info?.account_number || tx.bank_account)} className="text-blue-500 hover:text-blue-700 p-1 bg-blue-50 rounded transition-colors">{copiedText === (tx.payment_info?.account_number || tx.bank_account) ? <Check size={12}/> : <Copy size={12}/>}</button>}
                   </div>
                   <div className="text-[9px] text-slate-400 font-bold mt-1">ACC: {tx.payment_info?.account_name || tx.bank_holder || tx.cust_name}</div>
                 </td>
                 {/* 🌟 โชว์ยอด Net Payout ในตาราง */}
                 <td className="p-6 font-black text-emerald-600 text-lg text-right">
                    {formatCurrency(getNetPayout(tx))}
                 </td>
                 <td className="p-6 text-right pr-10">
                    <button 
                      onClick={() => { 
                        setSelectedTx(tx); 
                        setSlipFile(null); 
                        
                        // 🌟 THE FIX: ดึงข้อมูลจาก payment_info ที่ลูกค้ากรอกมาหน้าเว็บ (ถ้าระบุเป็น PromptPay ให้แสดงคำว่า พร้อมเพย์)
                        let bankNameDisplay = tx.payment_info?.bank || tx.bank_name || '';
                        if (tx.payment_info?.type === 'promptpay') bankNameDisplay = 'พร้อมเพย์ (PromptPay)';
                        
                        setEditBankName(bankNameDisplay);
                        setEditBankAccount(tx.payment_info?.account_number || tx.bank_account || '');
                        setEditBankHolder(tx.payment_info?.account_name || tx.bank_holder || tx.cust_name || '');
                      }} 
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all"
                    >
                      โอนเงิน
                    </button>
                 </td>
               </tr>
            ))}
            {pendingPayouts.length === 0 && <tr><td colSpan={5} className="p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">ไม่มีรายการรอโอน 🎉</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedTx && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in">
           <div className="bg-white rounded-[3rem] w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
              <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                 <div><h3 className="text-2xl font-black text-slate-800 uppercase">Trade-In Transfer</h3><p className="text-[10px] font-bold text-blue-500 tracking-widest uppercase mt-1">Ref: {selectedTx.ref_no}</p></div>
                 <button onClick={()=>setSelectedTx(null)} className="p-3 hover:bg-slate-100 rounded-2xl transition-colors text-slate-400"><X size={28}/></button>
              </div>
              <div className="p-10 space-y-6">
                 <div className="text-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Net Transfer Amount</p>
                    {/* 🌟 โชว์ยอด Net Payout ตัวเบ้อเริ่มใน Modal */}
                    <h1 className="text-6xl font-black text-emerald-600">
                      {formatCurrency(getNetPayout(selectedTx))}
                    </h1>
                 </div>
                 
                 <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200 space-y-4 shadow-inner">
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest w-1/3">Bank (ธนาคาร)</span>
                        <input type="text" value={editBankName} onChange={(e) => setEditBankName(e.target.value)} placeholder="เช่น กสิกรไทย, KBank..." className="w-2/3 bg-white border border-slate-200 px-4 py-2.5 rounded-xl font-black text-slate-800 outline-none focus:border-blue-500 text-right uppercase shadow-sm transition-all" />
                    </div>
                    <div className="flex justify-between items-center py-4 border-y border-slate-200 gap-4">
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest w-1/3">Account Number</span>
                        <div className="flex items-center gap-2 w-2/3 justify-end">
                            <input type="text" value={editBankAccount} onChange={(e) => setEditBankAccount(e.target.value)} placeholder="เลขที่บัญชี 10 หลัก" className="w-full bg-white border border-slate-200 px-4 py-2.5 rounded-xl font-mono font-black text-slate-900 outline-none focus:border-blue-500 text-right tracking-widest shadow-sm transition-all" />
                            {editBankAccount && <button onClick={() => handleCopy(editBankAccount)} className="bg-blue-100 text-blue-600 p-3 rounded-xl hover:bg-blue-200 shrink-0 shadow-sm">{copiedText === editBankAccount ? <Check size={18}/> : <Copy size={18}/>}</button>}
                        </div>
                    </div>
                    <div className="flex justify-between items-center gap-4">
                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest w-1/3">Account Name</span>
                        <input type="text" value={editBankHolder} onChange={(e) => setEditBankHolder(e.target.value)} placeholder="ชื่อบัญชีรับเงิน (ตาม Invoice)" className="w-2/3 bg-white border border-slate-200 px-4 py-2.5 rounded-xl font-bold text-slate-700 outline-none focus:border-blue-500 text-right shadow-sm transition-all" />
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Slip (หลักฐานการโอน)</label>
                    <label className={`block w-full border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-colors ${slipFile ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 hover:border-blue-500 hover:bg-blue-50'}`}>
                        <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                        {slipFile ? (
                            <div className="flex items-center justify-center gap-2 text-emerald-700 font-bold text-sm">
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
                    className={`w-full text-white py-6 rounded-[2rem] font-black text-lg flex items-center justify-center gap-3 shadow-xl transition-all uppercase ${isUploading ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-blue-200'}`}
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