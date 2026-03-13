// src/pages/sales/SalesHistory.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { 
  Search, Receipt, RotateCcw, Printer, AlertTriangle, 
  CheckCircle2, X, Smartphone, Package, User,
  Banknote, CreditCard, Wallet, Calculator, Calendar, Download, FileText
} from 'lucide-react';
import { ref, update, get } from 'firebase/database';
import { db } from '../../api/firebase';
import { useAuth } from '../../hooks/useAuth';

export const SalesHistory = () => {
  const { data: sales, loading } = useDatabase('sales');
  const { hasAccess } = useAuth();
  
  // States
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'this_week' | 'this_month' | 'all_time' | 'custom'>('today');
  const [customDate, setCustomDate] = useState({ start: '', end: '' });
  const [selectedReceipt, setSelectedReceipt] = useState<any>(null);
  const [printMode, setPrintMode] = useState<'receipt' | 'zread' | null>(null);

  // 🧠 Logic: Date Filtering
  const filteredByDateSales = useMemo(() => {
    const list = Array.isArray(sales) ? sales : [];
    const now = new Date();
    
    const getStartOfDay = (d: Date) => new Date(d.setHours(0,0,0,0)).getTime();
    const getEndOfDay = (d: Date) => new Date(d.setHours(23,59,59,999)).getTime();

    let start = 0, end = getEndOfDay(new Date());

    if (dateFilter === 'today') {
       start = getStartOfDay(new Date());
    } else if (dateFilter === 'yesterday') {
       const y = new Date(now); y.setDate(y.getDate() - 1);
       start = getStartOfDay(y); end = getEndOfDay(y);
    } else if (dateFilter === 'this_week') {
       const w = new Date(now); w.setDate(w.getDate() - w.getDay());
       start = getStartOfDay(w);
    } else if (dateFilter === 'this_month') {
       const m = new Date(now.getFullYear(), now.getMonth(), 1);
       start = getStartOfDay(m);
    } else if (dateFilter === 'custom' && customDate.start && customDate.end) {
       start = getStartOfDay(new Date(customDate.start));
       end = getEndOfDay(new Date(customDate.end));
    } else if (dateFilter === 'all_time') {
       return list; 
    }

    return list.filter(s => s.sold_at >= start && s.sold_at <= end);
  }, [sales, dateFilter, customDate]);

  // 🧠 Logic: Search & Final Filter
  const finalFilteredSales = useMemo(() => {
     return filteredByDateSales.filter(s => {
        const searchLower = searchTerm.toLowerCase();
        const matchText = 
           s.receipt_no?.toLowerCase().includes(searchLower) ||
           s.customer_name?.toLowerCase().includes(searchLower) ||
           s.customer_phone?.toLowerCase().includes(searchLower);
        const matchItems = s.items?.some((item: any) => item.code?.toLowerCase().includes(searchLower) || item.name?.toLowerCase().includes(searchLower));
        return matchText || matchItems;
     }).sort((a, b) => b.sold_at - a.sold_at);
  }, [filteredByDateSales, searchTerm]);

  // 🧠 Logic: Summary Stats (สำหรับช่วงเวลาที่เลือก)
  const periodStats = useMemo(() => {
    let cash = 0, transfer = 0, credit = 0, total = 0, voidedTotal = 0, itemQty = 0;

    filteredByDateSales.forEach(sale => {
       if (sale.status === 'VOIDED') {
          voidedTotal += Number(sale.grand_total) || 0;
       } else {
          const amount = Number(sale.grand_total) || 0;
          total += amount;
          if (sale.payment_method === 'CASH') cash += amount;
          if (sale.payment_method === 'TRANSFER') transfer += amount;
          if (sale.payment_method === 'CREDIT') credit += amount;
          sale.items?.forEach((i:any) => itemQty += i.qty);
       }
    });
    return { cash, transfer, credit, total, voidedTotal, itemQty, billCount: filteredByDateSales.filter(s=>s.status !== 'VOIDED').length };
  }, [filteredByDateSales]);

  // 📝 Action: Export CSV
  const handleExportCSV = () => {
     const headers = ['Receipt No', 'Date', 'Customer', 'Items', 'Subtotal', 'Discount', 'Total', 'Payment Method', 'Status'];
     const rows = finalFilteredSales.map(s => [
        s.receipt_no,
        new Date(s.sold_at).toLocaleString('th-TH'),
        s.customer_name || 'ลูกค้าทั่วไป',
        s.items?.map((i:any)=>`${i.name}(x${i.qty})`).join('; '),
        s.subtotal,
        s.discount,
        s.grand_total,
        s.payment_method,
        s.status || 'COMPLETED'
     ]);
     
     const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(','), ...rows.map(e => e.map(field => `"${field}"`).join(','))].join('\n');
     const encodedUri = encodeURI(csvContent);
     const link = document.createElement("a");
     link.setAttribute("href", encodedUri);
     link.setAttribute("download", `sales_report_${dateFilter}_${Date.now()}.csv`);
     document.body.appendChild(link);
     link.click();
     link.remove();
  };

  // 📝 Action: Print Z-Read (ปิดยอดกะ)
  const handlePrintZRead = () => {
     setPrintMode('zread');
     setTimeout(() => { window.print(); setPrintMode(null); }, 500);
  };

  // 📝 Action: Print Receipt
  const handlePrintReceipt = () => {
     setPrintMode('receipt');
     setTimeout(() => { window.print(); setPrintMode(null); }, 500);
  };

  // 🗑️ Action: Void Sale
  const handleVoidSale = async (saleRecord: any) => {
     if (saleRecord.status === 'VOIDED') return alert('บิลนี้ถูกยกเลิกไปแล้ว');
     const confirmVoid = window.confirm(`⚠️ คำเตือน: ต้องการยกเลิกบิล ${saleRecord.receipt_no} ใช่หรือไม่?\nสินค้าจะถูกคืนเข้าคลังอัตโนมัติ`);
     if (!confirmVoid) return;

     try {
        await update(ref(db, `sales/${saleRecord.id}`), { status: 'VOIDED', voided_at: Date.now() });
        const items = saleRecord.items || [];
        for (const item of items) {
           if (item.type === 'DEVICE') await update(ref(db, `jobs/${item.id}`), { status: 'In Stock', sold_at: null, receipt_no: null, customer_info: null });
           else if (item.type === 'SKU') {
              const productRef = ref(db, `products/${item.id}`);
              const snapshot = await get(productRef);
              if (snapshot.exists()) await update(productRef, { stock: (Number(snapshot.val().stock) || 0) + item.qty, updated_at: Date.now() });
           }
        }
        alert(`✅ ยกเลิกบิลสำเร็จ!`);
        setSelectedReceipt(null);
     } catch (error) { alert('เกิดข้อผิดพลาด: ' + error); }
  };

  if (loading) return <div className="p-10 text-center font-bold text-slate-400">Loading Transactions...</div>;

  return (
    <div className="p-8 space-y-6 bg-[#F9FBFC] min-h-screen font-sans text-slate-800 print:bg-white print:p-0">
      
      <style>{`
         @media print {
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 80mm; margin: 0; padding: 0; box-shadow: none; border-radius: 0; }
         }
      `}</style>

      {/* HEADER & FILTERS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 print:hidden">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2"><Receipt className="text-blue-600"/> Sales Transactions</h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ประวัติการขาย, จัดการบิล, และสรุปยอดลิ้นชัก</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Date Filter Dropdown */}
            <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
               <Calendar size={18} className="text-slate-400 ml-2"/>
               <select value={dateFilter} onChange={e=>setDateFilter(e.target.value as any)} className="bg-transparent font-bold text-sm outline-none py-2 pr-4 cursor-pointer text-blue-600">
                  <option value="today">วันนี้ (Today)</option>
                  <option value="yesterday">เมื่อวาน (Yesterday)</option>
                  <option value="this_week">สัปดาห์นี้ (This Week)</option>
                  <option value="this_month">เดือนนี้ (This Month)</option>
                  <option value="all_time">ทั้งหมด (All Time)</option>
                  <option value="custom">ระบุวันที่...</option>
               </select>
            </div>

            {/* Custom Date Inputs */}
            {dateFilter === 'custom' && (
               <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                  <input type="date" value={customDate.start} onChange={e=>setCustomDate({...customDate, start: e.target.value})} className="text-xs font-bold outline-none text-slate-600"/>
                  <span className="text-slate-300">-</span>
                  <input type="date" value={customDate.end} onChange={e=>setCustomDate({...customDate, end: e.target.value})} className="text-xs font-bold outline-none text-slate-600"/>
               </div>
            )}

            {/* Search Bar */}
            <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm flex-1 md:w-64">
               <Search className="text-slate-400 ml-1" size={18}/>
               <input type="text" placeholder="ค้นหาบิล, ชื่อ, IMEI..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="bg-transparent outline-none font-bold text-sm w-full"/>
            </div>

            {/* Action Buttons */}
            <button onClick={handleExportCSV} className="bg-emerald-50 text-emerald-600 border border-emerald-200 p-2.5 rounded-xl hover:bg-emerald-100 transition-colors shadow-sm" title="Export to Excel (CSV)"><Download size={18}/></button>
            <button onClick={handlePrintZRead} className="bg-slate-800 text-white p-2.5 rounded-xl hover:bg-black transition-colors shadow-sm flex items-center gap-2 font-bold text-xs uppercase" title="Print Z-Read Report"><FileText size={18}/> ปิดยอดกะ</button>
        </div>
      </div>

      {/* 📊 SUMMARY WIDGETS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:hidden">
         <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center relative overflow-hidden">
            <div className="flex items-center gap-2 mb-2 relative z-10"><Banknote size={16} className="text-green-500"/><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">เงินสดในเก๊ะ (Cash)</span></div>
            <div className="text-2xl font-black text-slate-800 relative z-10">฿{periodStats.cash.toLocaleString()}</div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center relative overflow-hidden">
            <div className="flex items-center gap-2 mb-2 relative z-10"><Smartphone size={16} className="text-blue-500"/><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">เงินโอน (Transfer)</span></div>
            <div className="text-2xl font-black text-slate-800 relative z-10">฿{periodStats.transfer.toLocaleString()}</div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center relative overflow-hidden">
            <div className="flex items-center gap-2 mb-2 relative z-10"><CreditCard size={16} className="text-purple-500"/><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">บัตรเครดิต (Credit)</span></div>
            <div className="text-2xl font-black text-slate-800 relative z-10">฿{periodStats.credit.toLocaleString()}</div>
         </div>
         <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-lg flex flex-col justify-center relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 relative z-10">
               <div className="flex items-center gap-2"><Calculator size={16} className="text-blue-400"/><span className="text-[10px] font-black text-blue-300 uppercase tracking-widest">ยอดขายสุทธิ</span></div>
               {periodStats.voidedTotal > 0 && <span className="text-[9px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded">Void: -฿{periodStats.voidedTotal.toLocaleString()}</span>}
            </div>
            <div className="text-3xl font-black text-blue-400 relative z-10 tracking-tight">฿{periodStats.total.toLocaleString()}</div>
         </div>
      </div>

      {/* 📋 TRANSACTIONS TABLE */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden print:hidden">
         <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
               <tr>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Receipt Info</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Customer</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Items</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Total</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
               {finalFilteredSales.map((sale) => (
                  <tr key={sale.id} className={`hover:bg-slate-50 transition-colors ${sale.status === 'VOIDED' ? 'opacity-50 bg-slate-50/50' : ''}`}>
                     <td className="p-5">
                        <div className="text-sm font-black text-blue-600 mb-0.5">{sale.receipt_no}</div>
                        <div className="text-[10px] font-bold text-slate-400">{formatDate(sale.sold_at)}</div>
                     </td>
                     <td className="p-5">
                        <div className="font-bold text-slate-800">{sale.customer_name || 'ลูกค้าทั่วไป'}</div>
                        <div className="text-[10px] font-bold text-slate-400">{sale.customer_phone || '-'}</div>
                     </td>
                     <td className="p-5">
                        <div className="text-xs font-bold text-slate-600">{sale.items?.length || 0} รายการ</div>
                        <div className="text-[9px] font-bold text-slate-400 truncate w-48">{sale.items?.map((i:any) => i.name).join(', ')}</div>
                     </td>
                     <td className="p-5 text-right">
                        <div className="font-black text-slate-800">฿{Number(sale.grand_total).toLocaleString()}</div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase">{sale.payment_method}</div>
                     </td>
                     <td className="p-5 text-center">
                        {sale.status === 'VOIDED' ? (
                           <span className="px-2 py-1 bg-red-100 text-red-600 text-[10px] font-black uppercase rounded-lg border border-red-200">Voided (ยกเลิก)</span>
                        ) : (
                           <span className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase rounded-lg border border-green-200 flex items-center justify-center gap-1 w-fit mx-auto"><CheckCircle2 size={12}/> Completed</span>
                        )}
                     </td>
                     <td className="p-5 text-right">
                        <button onClick={() => setSelectedReceipt(sale)} className="bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase shadow-sm hover:bg-black transition-colors">View / Options</button>
                     </td>
                  </tr>
               ))}
               {finalFilteredSales.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-400 italic font-bold">ไม่พบประวัติการขายในช่วงเวลาที่เลือก</td></tr>}
            </tbody>
         </table>
      </div>

      {/* 🧾 MODAL: RECEIPT & OPTIONS */}
      {selectedReceipt && !printMode && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm print:hidden">
            <div className="flex gap-6 items-start">
               {/* Preview ใบเสร็จ */}
               <div className="bg-white w-[80mm] min-h-[100mm] p-6 text-black font-sans shadow-2xl rounded-lg relative overflow-hidden">
                  {selectedReceipt.status === 'VOIDED' && (
                     <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-45 text-red-500 font-black text-6xl opacity-20 border-8 border-red-500 p-4 rounded-xl">VOIDED</div>
                  )}
                  <div className="text-center mb-6"><h2 className="text-xl font-black tracking-tight uppercase">BKK APPLE PRO</h2><p className="text-[10px] font-bold text-gray-500 mt-1">Bangkok, Thailand</p></div>
                  <div className="text-[10px] font-mono mb-4 border-b border-dashed border-gray-300 pb-4">
                     <div className="flex justify-between mb-1"><span>Receipt No:</span> <span className="font-bold">{selectedReceipt.receipt_no}</span></div>
                     <div className="flex justify-between mb-1"><span>Date:</span> <span>{new Date(selectedReceipt.sold_at).toLocaleString('th-TH')}</span></div>
                     <div className="flex justify-between mb-1"><span>Cashier:</span> <span>{selectedReceipt.cashier}</span></div>
                     <div className="flex justify-between"><span>Customer:</span> <span>{selectedReceipt.customer_name}</span></div>
                  </div>
                  <div className="mb-4 border-b border-dashed border-gray-300 pb-4 z-10 relative">
                     <div className="text-[10px] font-bold uppercase mb-2">Items</div>
                     {selectedReceipt.items?.map((item: any, idx: number) => (
                        <div key={idx} className="text-[10px] mb-2">
                           <div className="flex justify-between font-bold"><span className="truncate pr-2">{item.name}</span><span>{item.qty} x {Number(item.price).toLocaleString()}</span></div>
                           {item.type === 'DEVICE' && <div className="text-[9px] text-gray-500">IMEI/SN: {item.code}</div>}
                           <div className="text-right mt-0.5">฿{(Number(item.price) * item.qty).toLocaleString()}</div>
                        </div>
                     ))}
                  </div>
                  <div className="text-[10px] mb-6">
                     <div className="flex justify-between mb-1"><span>Subtotal:</span> <span>฿{Number(selectedReceipt.subtotal).toLocaleString()}</span></div>
                     {selectedReceipt.discount > 0 && <div className="flex justify-between mb-1 text-red-500"><span>Discount:</span> <span>-฿{Number(selectedReceipt.discount).toLocaleString()}</span></div>}
                     <div className="flex justify-between font-black text-sm mt-2 pt-2 border-t border-gray-200"><span>TOTAL:</span> <span>฿{Number(selectedReceipt.grand_total).toLocaleString()}</span></div>
                  </div>
                  <div className="text-[10px] mb-6 border-b border-dashed border-gray-300 pb-4"><div className="flex justify-between mb-1"><span>Pay Method:</span> <span>{selectedReceipt.payment_method}</span></div></div>
                  <div className="text-center text-[9px] text-gray-500"><p className="font-bold text-black mb-1">Thank you for your purchase!</p></div>
               </div>

               {/* ปุ่มคำสั่ง */}
               <div className="bg-white p-6 rounded-[2rem] shadow-2xl w-72 flex flex-col gap-4">
                  <div className="flex justify-between items-center mb-2">
                     <h3 className="font-black text-slate-800">Actions</h3>
                     <button onClick={() => setSelectedReceipt(null)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200"><X size={16}/></button>
                  </div>
                  <button onClick={handlePrintReceipt} className="w-full bg-blue-600 text-white p-4 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-lg"><Printer size={18}/> พิมพ์ใบเสร็จ (Re-print)</button>
                  {selectedReceipt.status !== 'VOIDED' && (
                     <><hr className="border-slate-100 my-2" />
                     <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                        <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-3 flex items-center gap-1"><AlertTriangle size={14}/> Danger Zone</p>
                        <button onClick={() => handleVoidSale(selectedReceipt)} className="w-full bg-white text-red-600 border border-red-200 p-3 rounded-lg font-black uppercase text-[10px] flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-colors"><RotateCcw size={14}/> ยกเลิกและคืนสินค้า (Void)</button>
                    </div></>
                  )}
               </div>
            </div>
         </div>
      )}

      {/* 🖨️ PRINT AREA: Z-READ OR RECEIPT */}
      {printMode === 'receipt' && selectedReceipt && (
         <div className="print-area bg-white p-6 text-black font-sans">
            <div className="text-center mb-6"><h2 className="text-xl font-black tracking-tight uppercase">BKK APPLE PRO</h2><p className="text-[10px] font-bold text-gray-500 mt-1">Bangkok, Thailand</p></div>
            <div className="text-[10px] font-mono mb-4 border-b border-dashed border-gray-300 pb-4">
               <div className="flex justify-between mb-1"><span>Receipt No:</span> <span className="font-bold">{selectedReceipt.receipt_no}</span></div>
               <div className="flex justify-between mb-1"><span>Date:</span> <span>{new Date(selectedReceipt.sold_at).toLocaleString('th-TH')}</span></div>
            </div>
            <div className="mb-4 border-b border-dashed border-gray-300 pb-4 z-10 relative">
               <div className="text-[10px] font-bold uppercase mb-2">Items</div>
               {selectedReceipt.items?.map((item: any, idx: number) => (
                  <div key={idx} className="text-[10px] mb-2"><div className="flex justify-between font-bold"><span className="truncate pr-2">{item.name}</span><span>{item.qty} x {Number(item.price).toLocaleString()}</span></div>{item.type === 'DEVICE' && <div className="text-[9px] text-gray-500">IMEI/SN: {item.code}</div>}<div className="text-right mt-0.5">฿{(Number(item.price) * item.qty).toLocaleString()}</div></div>
               ))}
            </div>
            <div className="text-[10px] mb-6">
               <div className="flex justify-between mb-1"><span>Subtotal:</span> <span>฿{Number(selectedReceipt.subtotal).toLocaleString()}</span></div>
               {selectedReceipt.discount > 0 && <div className="flex justify-between mb-1 text-red-500"><span>Discount:</span> <span>-฿{Number(selectedReceipt.discount).toLocaleString()}</span></div>}
               <div className="flex justify-between font-black text-sm mt-2 pt-2 border-t border-gray-200"><span>TOTAL:</span> <span>฿{Number(selectedReceipt.grand_total).toLocaleString()}</span></div>
            </div>
            <div className="text-[10px] mb-6 border-b border-dashed border-gray-300 pb-4"><div className="flex justify-between mb-1"><span>Pay Method:</span> <span>{selectedReceipt.payment_method}</span></div></div>
            <div className="text-center text-[9px] text-gray-500"><p className="font-bold text-black mb-1">Thank you for your purchase!</p></div>
         </div>
      )}

      {printMode === 'zread' && (
         <div className="print-area bg-white p-6 text-black font-sans">
            <div className="text-center mb-6">
               <h2 className="text-lg font-black tracking-tight uppercase">END OF DAY REPORT (Z-READ)</h2>
               <p className="text-[10px] font-bold text-gray-500 mt-1">BKK APPLE PRO</p>
               <p className="text-[10px] font-bold text-gray-500">Date: {new Date().toLocaleString('th-TH')}</p>
            </div>
            
            <div className="text-[10px] font-mono mb-4 border-b border-dashed border-gray-300 pb-4 space-y-2">
               <div className="font-bold uppercase text-center mb-2 pb-1 border-b border-gray-200">Period: {dateFilter.toUpperCase()}</div>
               <div className="flex justify-between"><span>Total Bills:</span> <span>{periodStats.billCount}</span></div>
               <div className="flex justify-between"><span>Items Sold:</span> <span>{periodStats.itemQty}</span></div>
            </div>

            <div className="text-[10px] font-mono mb-4 border-b border-dashed border-gray-300 pb-4 space-y-2">
               <div className="font-bold uppercase mb-2">Payment Breakdown</div>
               <div className="flex justify-between"><span>CASH (เงินสด):</span> <span>฿{periodStats.cash.toLocaleString()}</span></div>
               <div className="flex justify-between"><span>TRANSFER (โอน):</span> <span>฿{periodStats.transfer.toLocaleString()}</span></div>
               <div className="flex justify-between"><span>CREDIT (บัตร):</span> <span>฿{periodStats.credit.toLocaleString()}</span></div>
            </div>

            <div className="text-[10px] font-mono mb-6 pb-4">
               <div className="flex justify-between text-sm font-black mt-2 pt-2 border-t border-gray-300"><span>NET SALES:</span> <span>฿{periodStats.total.toLocaleString()}</span></div>
               <div className="flex justify-between text-red-500 mt-2"><span>Total Voided:</span> <span>-฿{periodStats.voidedTotal.toLocaleString()}</span></div>
            </div>

            <div className="mt-12 text-center text-[10px] text-gray-500">
               <p className="mb-8">_______________________________</p>
               <p className="font-bold">Cashier / Manager Signature</p>
            </div>
         </div>
      )}

    </div>
  );
};