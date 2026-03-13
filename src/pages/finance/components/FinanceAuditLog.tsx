// src/pages/finance/components/FinanceAuditLog.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../../utils/formatters';
import { 
  Search, Download, Printer, Filter, ArrowUpRight, ArrowDownLeft, 
  Calendar, FileText, PieChart, Image ,X
} from 'lucide-react';

export const FinanceAuditLog = () => {
  const { data: transactions, loading } = useDatabase('transactions'); 

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // 🔍 State สำหรับดูสลิปเต็มจอ
  const [viewingSlip, setViewingSlip] = useState<string | null>(null);

  const filteredData = useMemo(() => {
    const list = Array.isArray(transactions) ? transactions : [];
    
    return list.filter(tx => {
      const matchesSearch = 
        tx.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.ref_job_id?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesType = filterType === 'ALL' || tx.type === filterType;

      let matchesDate = true;
      if (startDate || endDate) {
        const txDate = new Date(tx.timestamp).setHours(0,0,0,0);
        const start = startDate ? new Date(startDate).setHours(0,0,0,0) : 0;
        const end = endDate ? new Date(endDate).setHours(23,59,59,999) : Infinity;
        matchesDate = txDate >= start && txDate <= end;
      }

      return matchesSearch && matchesType && matchesDate;
    }).sort((a, b) => b.timestamp - a.timestamp); 
  }, [transactions, searchTerm, filterType, startDate, endDate]);

  const stats = useMemo(() => {
    const income = filteredData.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + Number(t.amount), 0);
    const expense = filteredData.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + Number(t.amount), 0);
    return { income, expense, balance: income - expense };
  }, [filteredData]);

  const handleExportCSV = () => {
    const headers = ["Date", "Time", "Type", "Category", "Description", "Ref Job", "Amount", "Slip URL"];
    const rows = filteredData.map(tx => [
      new Date(tx.timestamp).toLocaleDateString('th-TH'),
      new Date(tx.timestamp).toLocaleTimeString('th-TH'),
      tx.type,
      tx.category,
      `"${tx.description}"`,
      tx.ref_job_id || '-',
      tx.amount,
      tx.slip_url || '-'
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Finance_Log_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Loading Audit Logs...</div>;

  return (
    <div className="space-y-6 printable-area">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .printable-area, .printable-area * { visibility: visible; }
          .printable-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-6">
         <div className="bg-green-50 p-6 rounded-[2rem] border border-green-100 flex flex-col justify-between">
            <div className="flex justify-between items-start">
               <span className="text-[10px] font-black text-green-600 uppercase tracking-widest flex items-center gap-1"><ArrowDownLeft size={12}/> Total Income (Credit)</span>
               <div className="bg-green-200 p-1.5 rounded-full"><PieChart size={14} className="text-green-700"/></div>
            </div>
            <div className="text-3xl font-black text-green-700 mt-4">+{formatCurrency(stats.income)}</div>
         </div>
         <div className="bg-red-50 p-6 rounded-[2rem] border border-red-100 flex flex-col justify-between">
            <div className="flex justify-between items-start">
               <span className="text-[10px] font-black text-red-600 uppercase tracking-widest flex items-center gap-1"><ArrowUpRight size={12}/> Total Expense (Debit)</span>
               <div className="bg-red-200 p-1.5 rounded-full"><PieChart size={14} className="text-red-700"/></div>
            </div>
            <div className="text-3xl font-black text-red-700 mt-4">-{formatCurrency(stats.expense)}</div>
         </div>
         <div className="bg-slate-900 p-6 rounded-[2rem] text-white flex flex-col justify-between shadow-xl relative overflow-hidden">
            <div className="flex justify-between items-start relative z-10">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Cash Flow</span>
               <div className="bg-white/20 p-1.5 rounded-full"><FileText size={14} className="text-white"/></div>
            </div>
            <div className={`text-4xl font-black mt-4 relative z-10 ${stats.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
               {stats.balance >= 0 ? '+' : ''}{formatCurrency(stats.balance)}
            </div>
         </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex flex-wrap gap-4 items-center justify-between no-print">
         <div className="flex items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-md">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
               <input type="text" placeholder="ค้นหาธุรกรรม..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-slate-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
               {['ALL', 'CREDIT', 'DEBIT'].map(type => (
                  <button key={type} onClick={()=>setFilterType(type as any)} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${filterType === type ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
                     {type}
                  </button>
               ))}
            </div>
         </div>
         <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
               <Calendar size={14} className="text-slate-400"/>
               <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none text-slate-600"/>
               <span className="text-slate-300">-</span>
               <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none text-slate-600"/>
            </div>
            <button onClick={handleExportCSV} className="bg-green-600 text-white px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-green-700 shadow-md transition-all"><Download size={16}/> CSV</button>
            <button onClick={() => window.print()} className="bg-slate-900 text-white px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-black shadow-md transition-all"><Printer size={16}/> Print</button>
         </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
         <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
               <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <th className="p-5 pl-8">Date / Time</th>
                  <th className="p-5">Description</th>
                  <th className="p-5">Category</th>
                  <th className="p-5 text-right">Amount</th>
                  <th className="p-5 text-center">Slip</th> {/* ✅ เพิ่มคอลัมน์ Slip */}
                  <th className="p-5 text-center pr-8">Ref ID</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
               {filteredData.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                     <td className="p-5 pl-8">
                        <div className="font-bold text-slate-700 text-xs">{formatDate(tx.timestamp)}</div>
                     </td>
                     <td className="p-5">
                        <div className="font-bold text-slate-800 text-sm">{tx.description}</div>
                        <div className="text-[10px] font-bold text-slate-400 mt-0.5">{tx.rider_id || 'System'}</div>
                     </td>
                     <td className="p-5">
                        <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase border ${tx.type === 'CREDIT' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                           {tx.category}
                        </span>
                     </td>
                     <td className={`p-5 text-right font-black text-sm ${tx.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                        {tx.type === 'CREDIT' ? '+' : '-'}{formatCurrency(tx.amount)}
                     </td>
                     
                     {/* 📸 ปุ่มดูสลิป */}
                     <td className="p-5 text-center">
                        {tx.slip_url ? (
                           <button onClick={() => setViewingSlip(tx.slip_url)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                              <Image size={16}/>
                           </button>
                        ) : (
                           <span className="text-slate-300">-</span>
                        )}
                     </td>

                     <td className="p-5 text-center pr-8">
                        <div className="font-mono text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded inline-block">
                           {tx.ref_job_id ? tx.ref_job_id.slice(-6) : '-'}
                        </div>
                     </td>
                  </tr>
               ))}
               {filteredData.length === 0 && (
                  <tr><td colSpan={6} className="p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">No transactions found within this period</td></tr>
               )}
            </tbody>
         </table>
      </div>

      {/* 🖼️ Modal ดูสลิปเต็มจอ */}
      {viewingSlip && (
         <div className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in" onClick={() => setViewingSlip(null)}>
            <img src={viewingSlip} className="max-w-full max-h-full rounded-lg shadow-2xl" alt="Evidence Slip"/>
            <button onClick={() => setViewingSlip(null)} className="absolute top-4 right-4 text-white bg-white/20 p-2 rounded-full hover:bg-white/40"><X size={24}/></button>
         </div>
      )}
    </div>
  );
};