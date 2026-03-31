import { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { uploadImageToFirebase } from '../../utils/uploadImage';
import {
  Search, CheckCircle2, X, Copy, Check,
  Smartphone, Upload, FileText, Loader2,
  RefreshCw, Banknote, ChevronDown, ChevronUp
} from 'lucide-react';
import { ref, update, push, child, get } from 'firebase/database';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

export const MobileFinancePage = () => {
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

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getNetPayout = (tx: any) => {
    if (tx.net_payout !== undefined && tx.net_payout !== null) {
      return Number(tx.net_payout);
    }
    const base = Number(tx.final_price || tx.price || 0);
    const fee = Number(tx.pickup_fee || 0);
    const coupon = Number(tx.applied_coupon?.actual_value || tx.applied_coupon?.value || 0);
    return base - fee + coupon;
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
      return s === 'payout processing' ||
             s === 'pending finance approval' ||
             s === 'waiting for finance' ||
             s === 'price accepted';
    }).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }, [jobs]);

  const filteredPayouts = useMemo(() => {
    if (!searchTerm.trim()) return pendingPayouts;
    const q = searchTerm.toLowerCase();
    return pendingPayouts.filter(tx =>
      (tx.cust_name || '').toLowerCase().includes(q) ||
      (tx.bank_account || tx.payment_info?.account_number || '').includes(q) ||
      (tx.ref_no || '').toLowerCase().includes(q) ||
      (tx.model || '').toLowerCase().includes(q)
    );
  }, [pendingPayouts, searchTerm]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    toast.success('คัดลอกแล้ว');
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setSlipFile(e.target.files[0]);
  };

  const openTransferModal = (tx: any) => {
    setSelectedTx(tx);
    setSlipFile(null);

    let bankNameDisplay = tx.payment_info?.bank || tx.bank_name || '';
    if (tx.payment_info?.type === 'promptpay') bankNameDisplay = 'พร้อมเพย์ (PromptPay)';

    setEditBankName(bankNameDisplay);
    setEditBankAccount(tx.payment_info?.account_number || tx.bank_account || '');
    setEditBankHolder(tx.payment_info?.account_name || tx.bank_holder || tx.cust_name || '');
  };

  const handleConfirmTransfer = async () => {
    if (!selectedTx) return;
    if (!slipFile) { toast.warning('กรุณาแนบสลิปการโอนเงิน'); return; }
    if (!editBankName || !editBankAccount || !editBankHolder) { toast.warning('กรุณาระบุข้อมูลบัญชีให้ครบ'); return; }

    if (!confirm('ยืนยันว่าโอนเงินเข้าบัญชีลูกค้าเรียบร้อยแล้ว?')) return;

    setIsUploading(true);
    try {
      const now = Date.now();
      const isB2B = selectedTx.type === 'B2B Trade-in';
      const slipUrl = await uploadImageToFirebase(slipFile, `slips/tradein/${selectedTx.id}_${now}`);

      const actualTransferAmount = getNetPayout(selectedTx);
      const pickupFee = Number(selectedTx.pickup_fee || 0);

      const nextStatus = isB2B ? 'Payment Completed' : 'Waiting for Handover';
      const logAction = isB2B ? 'Payment Completed' : 'Paid';
      const logDetails = `ฝ่ายบัญชีโอนเงินสำเร็จ ยอดสุทธิ ฿${actualTransferAmount.toLocaleString()} เข้าบัญชี ${editBankName} (${editBankAccount})`;

      const newLog = { action: logAction, by: currentUser?.name || 'Finance', timestamp: now, details: logDetails, evidence_url: slipUrl };

      // Atomic multi-path update: job + transactions ทั้งหมดในครั้งเดียว
      const updates: Record<string, any> = {};

      updates[`jobs/${selectedTx.id}/status`] = nextStatus;
      updates[`jobs/${selectedTx.id}/paid_at`] = now;
      updates[`jobs/${selectedTx.id}/paid_by`] = currentUser?.name || 'Finance';
      updates[`jobs/${selectedTx.id}/payment_slip`] = slipUrl;
      updates[`jobs/${selectedTx.id}/updated_at`] = now;
      updates[`jobs/${selectedTx.id}/bank_name`] = editBankName;
      updates[`jobs/${selectedTx.id}/bank_account`] = editBankAccount;
      updates[`jobs/${selectedTx.id}/bank_holder`] = editBankHolder;
      updates[`jobs/${selectedTx.id}/qc_logs`] = [newLog, ...(selectedTx.qc_logs || [])];

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

      if (pickupFee > 0) {
        const creditKey = push(child(ref(db), 'transactions')).key;
        updates[`transactions/${creditKey}`] = {
          rider_id: selectedTx.rider_id || 'SYSTEM',
          amount: pickupFee,
          type: 'CREDIT',
          category: 'LOGISTICS_REVENUE',
          description: `รายได้ค่าบริการไรเดอร์รับเครื่อง - Ref: ${selectedTx.ref_no}`,
          timestamp: now,
          ref_job_id: selectedTx.id
        };
      }

      await update(ref(db), updates);

      // Post-payment verification: ตรวจสอบว่า transaction ถูกสร้างจริง
      const verifySnapshot = await get(ref(db, `transactions/${debitKey}`));
      if (!verifySnapshot.exists()) {
        toast.warning('⚠️ โอนเงินสำเร็จแต่ Transaction อาจไม่ถูกบันทึก — กรุณาตรวจสอบที่แท็บ "ซ่อม Transaction"');
      } else {
        toast.success('บันทึกการโอนเงินพร้อมสลิปสำเร็จ!');
      }
      setSelectedTx(null);
      setSlipFile(null);
    } catch (e) {
      toast.error('เกิดข้อผิดพลาด: ' + e);
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-100 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Banknote size={18} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-800">โอนเงิน</h2>
              <p className="text-[10px] text-slate-400 font-bold">{filteredPayouts.length} รายการรอโอน</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ค้นหาชื่อลูกค้า, เลขบัญชี, OID..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Payout List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filteredPayouts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <CheckCircle2 size={40} className="text-slate-200" />
            <p className="text-sm font-bold">ไม่มีรายการรอโอน</p>
          </div>
        ) : (
          filteredPayouts.map((tx) => {
            const accountNum = tx.payment_info?.account_number || tx.bank_account || '';
            const bankName = tx.payment_info?.type === 'promptpay'
              ? 'พร้อมเพย์'
              : (tx.payment_info?.bank || tx.bank_name || 'ไม่ระบุ');
            const holderName = tx.payment_info?.account_name || tx.bank_holder || tx.cust_name || '';
            const isExpanded = expandedId === tx.id;

            return (
              <div key={tx.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Card Header - tap to expand */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : tx.id)}
                  className="w-full p-3.5 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Smartphone size={14} className="text-blue-500 shrink-0" />
                        <span className="text-sm font-black text-slate-800 truncate">{tx.cust_name || 'ไม่ระบุชื่อ'}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                        {tx.model} · {tx.ref_no}
                      </p>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-1.5">
                      <span className="text-base font-black text-emerald-600">
                        {formatCurrency(getNetPayout(tx))}
                      </span>
                      {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </div>
                </button>

                {/* Expanded Bank Details */}
                {isExpanded && (
                  <div className="px-3.5 pb-3.5 space-y-2 border-t border-slate-50 pt-2">
                    {/* Bank Info */}
                    <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400 font-bold">ธนาคาร</span>
                        <span className="font-black text-slate-700">{bankName}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-bold">เลขบัญชี</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-slate-700">{accountNum || 'ไม่ระบุ'}</span>
                          {accountNum && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCopy(accountNum); }}
                              className="p-1 bg-blue-50 rounded text-blue-500 active:bg-blue-100"
                            >
                              {copiedText === accountNum ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400 font-bold">ชื่อบัญชี</span>
                        <span className="font-bold text-slate-600">{holderName}</span>
                      </div>
                    </div>

                    {/* Status + Date */}
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">
                        {tx.status}
                      </span>
                      <span className="text-slate-400 font-bold">{formatDate(tx.updated_at || tx.created_at)}</span>
                    </div>

                    {/* Transfer Button */}
                    <button
                      onClick={() => openTransferModal(tx)}
                      className="w-full py-3 bg-emerald-600 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-lg shadow-emerald-200"
                    >
                      <Banknote size={18} /> โอนเงิน
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Transfer Modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-end justify-center animate-in fade-in">
          <div className="bg-white rounded-t-[2rem] w-full max-w-lg shadow-2xl animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto safe-bottom">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white rounded-t-[2rem] z-10">
              <div>
                <h3 className="text-lg font-black text-slate-800">ยืนยันโอนเงิน</h3>
                <p className="text-[10px] font-bold text-blue-500 tracking-widest uppercase mt-0.5">Ref: {selectedTx.ref_no}</p>
              </div>
              <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400">
                <X size={24} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Amount */}
              <div className="text-center py-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">ยอดโอนสุทธิ</p>
                <h1 className="text-4xl font-black text-emerald-600">
                  {formatCurrency(getNetPayout(selectedTx))}
                </h1>
                <p className="text-xs text-slate-400 mt-1">{selectedTx.cust_name} · {selectedTx.model}</p>
              </div>

              {/* Bank Details Form */}
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-200">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ธนาคาร</label>
                  <input
                    type="text"
                    value={editBankName}
                    onChange={(e) => setEditBankName(e.target.value)}
                    placeholder="เช่น กสิกรไทย, KBank..."
                    className="w-full mt-1 bg-white border border-slate-200 px-3 py-2.5 rounded-xl font-bold text-slate-800 outline-none focus:border-emerald-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">เลขบัญชี</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      value={editBankAccount}
                      onChange={(e) => setEditBankAccount(e.target.value)}
                      placeholder="เลขที่บัญชี"
                      className="flex-1 bg-white border border-slate-200 px-3 py-2.5 rounded-xl font-mono font-bold text-slate-900 outline-none focus:border-emerald-500 text-sm tracking-wider"
                    />
                    {editBankAccount && (
                      <button
                        onClick={() => handleCopy(editBankAccount)}
                        className="bg-blue-100 text-blue-600 p-2.5 rounded-xl active:bg-blue-200 shrink-0"
                      >
                        {copiedText === editBankAccount ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ชื่อบัญชี</label>
                  <input
                    type="text"
                    value={editBankHolder}
                    onChange={(e) => setEditBankHolder(e.target.value)}
                    placeholder="ชื่อบัญชีรับเงิน"
                    className="w-full mt-1 bg-white border border-slate-200 px-3 py-2.5 rounded-xl font-bold text-slate-700 outline-none focus:border-emerald-500 text-sm"
                  />
                </div>
              </div>

              {/* Slip Upload */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">หลักฐานการโอน (สลิป)</label>
                <label className={`block w-full mt-1 border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${slipFile ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 active:border-emerald-500 active:bg-emerald-50'}`}>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  {slipFile ? (
                    <div className="flex items-center justify-center gap-2 text-emerald-700 font-bold text-sm">
                      <FileText size={18} /> {slipFile.name}
                    </div>
                  ) : (
                    <div className="text-slate-400 flex flex-col items-center gap-1.5">
                      <Upload size={22} />
                      <span className="text-xs font-bold">แตะเพื่ออัปโหลดสลิป</span>
                    </div>
                  )}
                </label>
              </div>

              {/* Confirm Button */}
              <button
                onClick={handleConfirmTransfer}
                disabled={isUploading}
                className={`w-full text-white py-4 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-xl transition-all ${isUploading ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 active:scale-[0.98] shadow-emerald-200'}`}
              >
                {isUploading ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
                {isUploading ? 'กำลังบันทึก...' : 'ยืนยันโอนเงินแล้ว'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
