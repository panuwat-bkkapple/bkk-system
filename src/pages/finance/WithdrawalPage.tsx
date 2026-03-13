// src/pages/WithdrawalPage.tsx
import React, { useMemo, useState } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { 
  Landmark, ArrowUpRight, ArrowDownLeft, History, 
  FileText, Search, Filter, AlertCircle, User, Calculator, Calendar,
  Printer, Download 
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { logTransaction } from '../../utils/transactionLogger';

type Tab = 'requests' | 'audit' | 'statement';

export const WithdrawalPage = () => {
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: transactions, loading: txLoading } = useDatabase('transactions');
  
  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [selected, setSelected] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stmtRiderId, setStmtRiderId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const isInRange = (timestamp: number) => {
    if (!startDate && !endDate) return true;
    const start = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : 0;
    const end = endDate ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;
    return timestamp >= start && timestamp <= end;
  };

  const requests = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list
      .filter(j => j.status === 'Withdrawal Requested' || (j.type === 'Withdrawal' && j.status !== 'Withdrawal Completed'))
      .sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
  }, [jobs]);

  const auditLog = useMemo(() => {
    const list = Array.isArray(transactions) ? transactions : [];
    return list
      .filter(t => {
        const matchesSearch = t.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                              t.rider_id?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesDate = isInRange(t.timestamp);
        return matchesSearch && matchesDate;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [transactions, searchTerm, startDate, endDate]);

  const riderStatement = useMemo(() => {
    if (!stmtRiderId) return null;
    
    const list = Array.isArray(transactions) ? transactions : [];
    const myTx = list
      .filter(t => t.rider_id === stmtRiderId)
      .sort((a, b) => a.timestamp - b.timestamp);

    let runningBalance = 0;
    const allDetails = myTx.map(t => {
      if (t.type === 'CREDIT') runningBalance += Number(t.amount);
      else runningBalance -= Number(t.amount);
      return { ...t, balance: runningBalance };
    });

    const currentActualBalance = runningBalance;
    const filteredDetails = allDetails.filter(t => isInRange(t.timestamp));

    const periodIncome = filteredDetails.filter(t => t.type === 'CREDIT').reduce((s, t) => s + Number(t.amount), 0);
    const periodWithdraw = filteredDetails.filter(t => t.type === 'DEBIT').reduce((s, t) => s + Number(t.amount), 0);
    const jobCount = filteredDetails.filter(t => t.category === 'JOB_PAYOUT').length;

    return {
      details: filteredDetails,
      summary: { 
        totalIncome: periodIncome, 
        totalWithdraw: periodWithdraw, 
        currentBalance: currentActualBalance,
        jobCount 
      }
    };
  }, [transactions, stmtRiderId, startDate, endDate]);

  const riderList = useMemo(() => {
    const list = Array.isArray(transactions) ? transactions : [];
    return Array.from(new Set(list.map(t => t.rider_id)));
  }, [transactions]);

  const handleExportCSV = () => {
    if (!riderStatement) return;
    
    const headers = ["Date", "Time", "Category", "Description", "Ref Job", "Income (Credit)", "Withdraw (Debit)", "Balance"];
    
    const rows = riderStatement.details.map((tx: any) => {
      const dateObj = new Date(tx.timestamp);
      const dateStr = dateObj.toLocaleDateString('th-TH');
      const timeStr = dateObj.toLocaleTimeString('th-TH');
      const credit = tx.type === 'CREDIT' ? tx.amount : '0';
      const debit = tx.type === 'DEBIT' ? tx.amount : '0';
      
      return [
        dateStr,
        timeStr,
        tx.category,
        `"${tx.description}"`,
        tx.ref_job_id || '-',
        credit,
        debit,
        tx.balance
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Statement_${stmtRiderId}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleConfirm = async () => {
    if (!selected) return;
    if (!confirm('ยืนยันการโอนเงิน?')) return;
    try {
      await update(ref(db, `jobs/${selected.id}`), { status: 'Withdrawal Completed', withdrawn_at: Date.now() });
      await logTransaction({
        rider_id: selected.rider_id,
        amount: Number(selected.withdraw_amount),
        type: 'DEBIT',
        category: 'WITHDRAWAL',
        description: `ถอนเงินเข้า ${selected.bank_name} (${selected.bank_account})`,
        ref_job_id: selected.id
      });
      setSelected(null);
      alert('บันทึกสำเร็จ');
    } catch (e) { alert(e); }
  };

  if (jobsLoading || txLoading) return <div className="p-10 text-center font-bold text-gray-400 animate-pulse">กำลังโหลดข้อมูล...</div>;

  return (
    <div className="p-8 space-y-6 max-w-[1200px] mx-auto bg-[#F9FBFC] min-h-screen">
        <style>{`
            @media print {
                body * { visibility: hidden; }
                .printable-area, .printable-area * { visibility: visible; }
                .printable-area { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 20px; }
                .no-print { display: none !important; }
                table { font-size: 12px; width: 100%; border-collapse: collapse; }
                th, td { border-bottom: 1px solid #ddd; padding: 8px; }
                th { background-color: #f3f4f6 !important; color: black !important; font-weight: bold; }
            }
        `}</style>
      
      {/* Header (ซ่อนตอนปริ้นท์) */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 no-print">
        <div>
          <h2 className="text-2xl font-black text-gray-800 tracking-tight">ระบบการเงิน (Finance)</h2>
          <p className="text-sm text-gray-500 font-medium">จัดการการโอนเงินและตรวจสอบบัญชี (Reconcile)</p>
        </div>
        
        <div className="flex flex-col items-end gap-2">
           {/* Date Filter */}
           {(activeTab === 'audit' || activeTab === 'statement') && (
             <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm mb-2">
                <div className="flex items-center gap-2 px-2">
                    <Calendar size={14} className="text-gray-400"/>
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Filter Date:</span>
                </div>
                <input type="date" className="bg-gray-50 border-none outline-none text-xs font-bold text-gray-700 rounded-lg px-2 py-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                <span className="text-gray-300">-</span>
                <input type="date" className="bg-gray-50 border-none outline-none text-xs font-bold text-gray-700 rounded-lg px-2 py-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                {(startDate || endDate) && <button onClick={() => {setStartDate(''); setEndDate('');}} className="text-[10px] font-bold text-red-500 px-2 hover:underline">Clear</button>}
             </div>
           )}

           {/* Tab Switcher */}
           <div className="bg-white p-1 rounded-2xl border border-gray-200 flex shadow-sm">
             <button onClick={() => setActiveTab('requests')} className={`px-4 py-2.5 rounded-xl text-xs font-bold flex gap-2 ${activeTab === 'requests' ? 'bg-gray-900 text-white' : 'text-gray-400 hover:bg-gray-50'}`}><AlertCircle size={16}/> รอโอน ({requests.length})</button>
             <button onClick={() => setActiveTab('audit')} className={`px-4 py-2.5 rounded-xl text-xs font-bold flex gap-2 ${activeTab === 'audit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-50'}`}><History size={16}/> Audit Log</button>
             <button onClick={() => setActiveTab('statement')} className={`px-4 py-2.5 rounded-xl text-xs font-bold flex gap-2 ${activeTab === 'statement' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-50'}`}><FileText size={16}/> Statement</button>
          </div>
        </div>
      </div>

      {/* 🟢 TAB 1: รายการรอโอน */}
      {activeTab === 'requests' && (
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden animate-in fade-in">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b text-[10px] font-bold text-gray-400">
              <tr>
                <th className="p-6 pl-10">เวลาแจ้ง</th>
                <th className="p-6">ไรเดอร์</th>
                <th className="p-6">บัญชี</th>
                <th className="p-6 text-center">ยอดถอน</th>
                <th className="p-6 text-right pr-10">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {requests.map(req => (
                <tr key={req.id} className="hover:bg-gray-50/50">
                  <td className="p-6 pl-10 text-xs font-bold text-gray-600">{formatDate(req.requested_at)}</td>
                  <td className="p-6 font-bold">{req.rider_name || req.rider_id}</td>
                  <td className="p-6 text-xs text-blue-600 font-mono">{req.bank_name}: {req.bank_account}</td>
                  <td className="p-6 text-center font-black text-red-600">-{formatCurrency(req.withdraw_amount)}</td>
                  <td className="p-6 text-right pr-10"><button onClick={() => setSelected(req)} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-[10px] font-bold">โอนเงิน</button></td>
                </tr>
              ))}
              {requests.length === 0 && <tr><td colSpan={5} className="p-20 text-center text-gray-300 font-bold">ไม่มีรายการรอโอน</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* 🔵 TAB 2: Audit Log (คืนชีพไอคอน) */}
      {activeTab === 'audit' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex gap-4 bg-white p-2 pl-4 rounded-2xl border border-gray-100 items-center">
             <Search size={18} className="text-gray-400"/>
             <input type="text" placeholder="ค้นหาตามเลขธุรกรรม..." className="flex-1 bg-transparent outline-none text-sm font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <div className="bg-white rounded-[2.5rem] border border-gray-100 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b text-[10px] font-bold text-gray-400">
                <tr>
                  <th className="p-5 pl-10">วัน/เวลา</th>
                  <th className="p-5">รายการ</th>
                  <th className="p-5">รายละเอียด</th>
                  <th className="p-5">ไรเดอร์</th>
                  <th className="p-5 text-right pr-10">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {auditLog.map(tx => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="p-5 pl-10 text-[11px] text-gray-500">{formatDate(tx.timestamp)}</td>
                    <td className="p-5">
                        {/* ✅ คืนชีพไอคอน และ สี Badge */}
                        <span className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold w-fit ${tx.type === 'CREDIT' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {tx.type === 'CREDIT' ? <ArrowDownLeft size={14}/> : <ArrowUpRight size={14}/>}
                            {tx.category}
                        </span>
                    </td>
                    <td className="p-5 text-xs text-gray-700">{tx.description}</td>
                    <td className="p-5 text-xs text-gray-500 font-mono">{tx.rider_id}</td>
                    <td className={`p-5 text-right pr-10 font-black ${tx.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>{tx.type === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 🟣 TAB 3: Statement (คืนชีพสีตัวเลข) */}
      {activeTab === 'statement' && (
        <div className="space-y-6 animate-in fade-in printable-area">
            
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4 no-print">
                <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center"><User size={24}/></div>
                <div className="flex-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">เลือก Rider เพื่อตรวจสอบยอด</label>
                    <select className="w-full mt-1 bg-transparent font-black text-xl outline-none" value={stmtRiderId} onChange={(e) => setStmtRiderId(e.target.value)}>
                        <option value="">-- กรุณาเลือก Rider --</option>
                        {riderList.map(rid => <option key={rid} value={rid}>{rid}</option>)}
                    </select>
                </div>
                {riderStatement && (
                    <div className="flex gap-2 border-l pl-4 border-gray-100">
                        <button onClick={handleExportCSV} className="bg-green-600 text-white px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-green-700 shadow-lg shadow-green-100">
                            <Download size={16}/> Export CSV
                        </button>
                        <button onClick={() => window.print()} className="bg-gray-900 text-white px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-black shadow-lg">
                            <Printer size={16}/> Print
                        </button>
                    </div>
                )}
            </div>

            {/* Header ตอนปริ้นท์ */}
            <div className="hidden print:block text-center mb-8 border-b-2 border-black pb-4">
                <h1 className="text-2xl font-black uppercase tracking-tight mb-2">BKK APPLE PRO</h1>
                <h2 className="text-xl font-bold">Rider Statement of Account</h2>
                <div className="flex justify-between mt-4 text-sm">
                    <div className="text-left">
                        <p><strong>Rider ID:</strong> {stmtRiderId}</p>
                        <p><strong>Date Range:</strong> {startDate || 'All'} - {endDate || 'All'}</p>
                    </div>
                    <div className="text-right">
                        <p><strong>Printed Date:</strong> {new Date().toLocaleDateString('th-TH')}</p>
                        <p><strong>Printed Time:</strong> {new Date().toLocaleTimeString('th-TH')}</p>
                    </div>
                </div>
            </div>

            {riderStatement ? (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-3 gap-4 print:gap-4 mb-6">
                        <div className="bg-green-50 p-6 rounded-3xl border border-green-100 print:bg-white print:border print:border-black print:rounded-lg print:p-4">
                            <div className="text-[10px] font-black text-green-600 uppercase mb-1 print:text-black">Total Income</div>
                            <div className="text-2xl font-black text-green-700 print:text-black">+{formatCurrency(riderStatement.summary.totalIncome)}</div>
                        </div>
                        <div className="bg-red-50 p-6 rounded-3xl border border-red-100 print:bg-white print:border print:border-black print:rounded-lg print:p-4">
                            <div className="text-[10px] font-black text-red-600 uppercase mb-1 print:text-black">Total Withdraw</div>
                            <div className="text-2xl font-black text-red-700 print:text-black">-{formatCurrency(riderStatement.summary.totalWithdraw)}</div>
                        </div>
                        <div className="bg-gray-900 p-6 rounded-3xl text-white shadow-xl relative overflow-hidden print:bg-white print:text-black print:border print:border-black print:rounded-lg print:p-4 print:shadow-none">
                            <div className="text-[10px] font-black text-gray-400 uppercase mb-1 print:text-black">Net Balance</div>
                            <div className="text-3xl font-black text-white print:text-black">{formatCurrency(riderStatement.summary.currentBalance)}</div>
                        </div>
                    </div>

                    <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden print:border-none print:shadow-none print:rounded-none">
                        <table className="w-full text-left print:border print:border-black">
                            <thead className="bg-purple-50/50 border-b border-purple-100 text-[10px] font-black text-purple-400 uppercase print:bg-gray-200 print:text-black print:border-black">
                                <tr>
                                    <th className="p-5 pl-10 print:p-2 print:border-black">Date/Time</th>
                                    <th className="p-5 print:p-2 print:border-black">Description</th>
                                    <th className="p-5 text-center print:p-2 print:border-black">Ref. Job</th>
                                    <th className="p-5 text-right print:p-2 print:border-black">Amount</th>
                                    <th className="p-5 text-right pr-10 print:p-2 print:border-black">Balance</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-sm print:divide-black">
                                {riderStatement.details.map((tx: any) => (
                                    <tr key={tx.id} className="hover:bg-gray-50 print:hover:bg-transparent">
                                        <td className="p-5 pl-10 text-[11px] text-gray-500 font-bold print:p-2 print:text-black print:border-black">{formatDate(tx.timestamp)}</td>
                                        <td className="p-5 print:p-2 print:border-black">
                                            <div className="font-bold text-gray-700 text-xs print:text-black">{tx.description}</div>
                                            <div className="text-[9px] font-bold mt-0.5 w-fit px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200 print:border-black print:text-black">{tx.category}</div>
                                        </td>
                                        <td className="p-5 text-center text-xs text-gray-400 font-mono print:p-2 print:text-black print:border-black">{tx.ref_job_id || '-'}</td>
                                        
                                        {/* ✅ คืนชีพสีตัวเลข (และใช้ print:text-black) */}
                                        <td className={`p-5 text-right font-black print:p-2 print:text-black print:border-black ${tx.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                                            {tx.type === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                                        </td>
                                        
                                        <td className="p-5 text-right pr-10 font-bold text-gray-800 print:p-2 print:text-black print:border-black">{formatCurrency(tx.balance)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    
                    <div className="hidden print:flex justify-between mt-10 pt-10 border-t border-black text-xs text-center">
                         <div className="w-1/3">
                             <div className="border-b border-black mb-2 pb-8"></div>
                             <p>Prepared By (Accountant)</p>
                         </div>
                         <div className="w-1/3">
                             <div className="border-b border-black mb-2 pb-8"></div>
                             <p>Approved By (Manager)</p>
                         </div>
                    </div>
                </>
            ) : (
                <div className="text-center py-20 text-gray-300 font-bold bg-white rounded-3xl border border-dashed border-gray-200 no-print">
                    <User size={48} className="mx-auto mb-4 text-gray-200"/>
                    กรุณาเลือก Rider เพื่อดู Statement
                </div>
            )}
        </div>
      )}

      {/* Modal ยืนยันโอน (ซ่อนตอนปริ้นท์) */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 no-print">
          <div className="bg-white rounded-[3rem] p-10 max-w-md w-full shadow-2xl space-y-6">
            <h3 className="text-xl font-black text-center">ยืนยันการโอนเงิน</h3>
            <div className="bg-[#F8FAFC] p-8 rounded-3xl space-y-4 border border-gray-100">
               <div className="flex justify-between text-[10px] font-bold uppercase text-gray-400"><span>ธนาคาร</span><span>{selected.bank_name}</span></div>
               <div className="flex justify-between text-[10px] font-bold uppercase text-gray-400"><span>เลขบัญชี</span><span className="text-blue-600 font-mono text-sm">{selected.bank_account}</span></div>
               <div className="pt-4 border-t flex justify-between items-end font-black text-lg">
                   <span>ยอดโอนสุทธิ</span><span className="text-red-600 text-3xl">{formatCurrency(selected.withdraw_amount)}</span>
               </div>
            </div>
            <button onClick={handleConfirm} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold shadow-xl">ยืนยันการโอนเรียบร้อย</button>
            <button onClick={() => setSelected(null)} className="w-full text-gray-400 font-bold text-xs py-3">ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
};