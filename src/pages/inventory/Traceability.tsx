// src/pages/inventory/Traceability.tsx
import React, { useState } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  Search, ShieldCheck, User, Store,
  RotateCcw, CheckCircle2, History, Smartphone,
  FileText, Image as ImageIcon, X, CreditCard
} from 'lucide-react';

export const Traceability = () => {
  const toast = useToast();
  const { data: jobs } = useDatabase('jobs');
  const { data: sales } = useDatabase('sales');
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);
  const [viewingSlip, setViewingSlip] = useState<string | null>(null); // State สำหรับดูรูปสลิป

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // 1. หาข้อมูลการรับซื้อ (Acquisition Job)
    const job = Array.isArray(jobs) ? jobs.find(j => 
      j.serial === query || j.imei === query || j.ref_no === query
    ) : null;

    // 2. หาประวัติการขาย (Sales Records)
    const saleRecords = Array.isArray(sales) ? sales.filter(s => 
      s.items?.some((item: any) => item.code === query)
    ).sort((a, b) => (b.sold_at || 0) - (a.sold_at || 0)) : [];

    if (!job && saleRecords.length === 0) {
       toast.info('ไม่พบข้อมูล S/N หรือ IMEI นี้ในระบบ Traceability');
       setSearchResult(null);
       return;
    }

    setSearchResult({ job, saleRecords });
  };

  return (
    <div className="p-8 space-y-8 bg-[#F5F7FA] min-h-screen font-sans text-slate-800">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-blue-600"/> Product Lifecycle Trace
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ตรวจสอบเส้นทางสินค้าและหลักฐานการเงิน (End-to-End Audit)</p>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="max-w-2xl bg-white p-2 rounded-[2.5rem] shadow-xl border border-blue-100 flex gap-2 transition-transform hover:scale-[1.01]">
         <div className="flex-1 flex items-center px-4 gap-3">
            <Search className="text-slate-400" size={20}/>
            <input 
               type="text" 
               placeholder="Scan IMEI / Serial Number..." 
               value={query}
               onChange={e => setQuery(e.target.value)}
               className="w-full bg-transparent outline-none font-bold text-lg text-slate-700 placeholder:text-slate-300"
            />
         </div>
         <button type="submit" className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black uppercase text-sm hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all">Track</button>
      </form>

      {searchResult ? (
         <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in slide-in-from-bottom-4 duration-500">
            
            {/* 📍 LEFT COLUMN: ACQUISITION (ขาเข้า) */}
            <div className="lg:col-span-4 space-y-6">
               
               {/* 1. ข้อมูลเครื่อง (Product Identity) */}
               <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-6 opacity-5"><Smartphone size={120}/></div>
                  <div className="flex items-center gap-3 mb-6 relative z-10">
                     <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><Smartphone size={24}/></div>
                     <h3 className="font-black text-slate-800 uppercase tracking-tight">Product Identity</h3>
                  </div>
                  <div className="space-y-4 relative z-10">
                     <DataRow label="Model Name" value={searchResult.job?.model || 'N/A'} />
                     <DataRow label="Serial / IMEI" value={<span className="font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{query}</span>} />
                     <DataRow label="Current Status" value={
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${searchResult.job?.status === 'Sold' ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-green-100 text-green-700 border-green-200'}`}>
                           {searchResult.job?.status || 'UNKNOWN'}
                        </span>
                     } />
                  </div>
               </div>

               {/* 2. ข้อมูลการรับซื้อและการจ่ายเงิน (Acquisition & Payout) */}
               <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
                  <div className="flex items-center gap-3 mb-6">
                     <div className="p-3 bg-orange-50 rounded-2xl text-orange-600"><User size={24}/></div>
                     <h3 className="font-black text-slate-800 uppercase tracking-tight">Origin & Payout</h3>
                  </div>
                  
                  {searchResult.job ? (
                     <div className="space-y-5">
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                           <DataRow label="Sold By (ผู้ขายให้ร้าน)" value={searchResult.job.cust_name || searchResult.job.customer_name || 'N/A'} />
                           <DataRow label="Contact Info" value={searchResult.job.cust_phone || searchResult.job.customer_phone || 'N/A'} />
                           <DataRow label="Handled By (คนรับเครื่อง)" value={searchResult.job.rider_name || searchResult.job.dispatcher || 'Shop Staff'} />
                        </div>

                        <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-3">
                           <DataRow label="Purchase Price (ราคารับซื้อ)" value={<span className="text-emerald-700 text-lg">฿{Number(searchResult.job.final_price || searchResult.job.price).toLocaleString()}</span>} />
                           <DataRow label="Paid Date" value={searchResult.job.paid_at ? new Date(searchResult.job.paid_at).toLocaleString('th-TH') : 'Pending Payment'} />
                           <DataRow label="Approved By (คนโอนเงิน)" value={searchResult.job.paid_by || 'System'} />
                           
                           {/* 🔥 ปุ่มดูสลิปการโอนเงิน (ขาเข้า) */}
                           {searchResult.job.payment_slip && (
                              <button 
                                 onClick={() => setViewingSlip(searchResult.job.payment_slip)}
                                 className="w-full mt-2 bg-emerald-600 text-white py-3 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
                              >
                                 <FileText size={16}/> View Payment Slip (ดูสลิป)
                              </button>
                           )}
                           {!searchResult.job.payment_slip && searchResult.job.paid_at && (
                              <div className="text-[10px] text-red-400 font-bold italic text-center mt-2">* No slip attached in system</div>
                           )}
                        </div>
                     </div>
                  ) : (
                     <div className="text-center py-8 text-slate-400 font-bold text-xs italic">ไม่พบข้อมูลต้นทาง (สินค้านี้อาจไม่ได้มาจากการรับซื้อ)</div>
                  )}
               </div>
            </div>

            {/* 📍 RIGHT COLUMN: SALES HISTORY (ขาออก) */}
            <div className="lg:col-span-8 space-y-6">
               <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden min-h-[600px]">
                  <div className="absolute top-0 right-0 p-8 opacity-10"><History size={120}/></div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-blue-400 mb-8 flex items-center gap-2 relative z-10">
                     <History size={18}/> Sales Timeline (เส้นทางสินค้า)
                  </h3>

                  <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-blue-500 before:via-slate-700 before:to-transparent z-10">
                     
                     {/* จุดเริ่มต้น (Acquisition Point) */}
                     {searchResult.job && (
                        <div className="relative pl-12">
                           <div className="absolute left-0 w-10 h-10 rounded-full border-4 border-slate-900 bg-blue-500 flex items-center justify-center z-10 shadow-lg shadow-blue-900/50">
                              <Store size={18} className="text-white"/>
                           </div>
                           <div className="p-6 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-md">
                              <div className="flex justify-between items-start">
                                 <div>
                                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-blue-500 text-white mb-2 inline-block">Stock In</span>
                                    <h4 className="font-black text-lg text-white">Item Added to Inventory</h4>
                                    <p className="text-xs text-slate-400 font-bold mt-1">
                                       {new Date(searchResult.job.created_at).toLocaleString('th-TH')}
                                    </p>
                                 </div>
                              </div>
                           </div>
                        </div>
                     )}

                     {/* รายการขายออก (Sales Points) */}
                     {searchResult.saleRecords.length === 0 ? (
                        <div className="pl-12 py-4 italic text-slate-500 font-bold">ยังไม่มีประวัติการขายออก (Item In Stock)</div>
                     ) : (
                        searchResult.saleRecords.map((sale: any) => (
                           <div key={sale.id} className="relative pl-12">
                              <div className={`absolute left-0 w-10 h-10 rounded-full border-4 border-slate-900 flex items-center justify-center z-10 shadow-lg ${sale.status === 'VOIDED' ? 'bg-red-500 shadow-red-900/50' : 'bg-emerald-500 shadow-emerald-900/50'}`}>
                                 {sale.status === 'VOIDED' ? <RotateCcw size={18} className="text-white"/> : <CheckCircle2 size={18} className="text-white"/>}
                              </div>

                              <div className={`p-6 rounded-3xl border transition-all hover:bg-white/10 ${sale.status === 'VOIDED' ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/10'}`}>
                                 <div className="flex justify-between items-start mb-4">
                                    <div>
                                       <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded mb-2 inline-block ${sale.status === 'VOIDED' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                                          {sale.status === 'VOIDED' ? 'VOIDED (ยกเลิกบิล)' : 'SOLD (ขายออก)'}
                                       </span>
                                       <h4 className="font-black text-lg text-white">Receipt: {sale.receipt_no}</h4>
                                       <p className="text-xs text-slate-400 font-bold mt-1">{new Date(sale.sold_at).toLocaleString('th-TH')}</p>
                                    </div>
                                    <div className="text-right">
                                       <div className="text-xl font-black text-blue-400">฿{Number(sale.grand_total).toLocaleString()}</div>
                                       <div className="text-[10px] font-bold text-slate-500 uppercase mt-1 flex items-center justify-end gap-1">
                                          <CreditCard size={10}/> {sale.payment_method}
                                       </div>
                                    </div>
                                 </div>

                                 <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/10">
                                    <div>
                                       <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Customer (ผู้ซื้อ)</div>
                                       <div className="text-sm font-bold text-slate-200 flex items-center gap-1.5"><User size={14} className="text-blue-400"/> {sale.customer_name || 'Walk-in Customer'}</div>
                                       <div className="text-xs font-bold text-slate-500 mt-0.5">{sale.customer_phone || '-'}</div>
                                    </div>
                                    <div>
                                       <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Sold By (พนักงานขาย)</div>
                                       <div className="text-sm font-bold text-slate-300">{sale.sold_by || 'Admin'}</div>
                                    </div>
                                 </div>
                                 
                                 {/* 🔥 ปุ่มดูสลิปขาเข้า (กรณีลูกค้าโอนเงินซื้อ) */}
                                 {sale.payment_slip && (
                                    <button 
                                       onClick={() => setViewingSlip(sale.payment_slip)}
                                       className="mt-4 w-full py-3 bg-slate-800 text-blue-400 rounded-xl font-bold text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-slate-700 transition-all border border-slate-700"
                                    >
                                       <ImageIcon size={14}/> View Customer Payment Slip
                                    </button>
                                 )}
                              </div>
                           </div>
                        ))
                     )}
                  </div>
               </div>
            </div>

         </div>
      ) : (
         <div className="bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-20 text-center flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
            <div className="bg-slate-50 p-6 rounded-full text-slate-300 shadow-inner"><Search size={48}/></div>
            <div>
               <h3 className="font-black text-slate-800 text-lg uppercase tracking-tight">Trace Product History</h3>
               <p className="font-bold text-slate-400 text-sm mt-1 max-w-md mx-auto">ระบุ IMEI หรือ Serial Number เพื่อสืบประวัติเส้นทางการเงินและการเปลี่ยนมือของสินค้า (Audit Trail)</p>
            </div>
         </div>
      )}

      {/* 🖼️ Modal ดูรูปสลิปเต็มจอ */}
      {viewingSlip && (
         <div className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-8 cursor-zoom-out animate-in fade-in duration-200" onClick={() => setViewingSlip(null)}>
            <img src={viewingSlip} className="max-w-full max-h-full rounded-2xl shadow-2xl border-4 border-white/10" alt="Evidence Slip"/>
            <button onClick={() => setViewingSlip(null)} className="absolute top-6 right-6 text-white bg-white/20 p-3 rounded-full hover:bg-white/40 backdrop-blur-md transition-all"><X size={24}/></button>
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/50 text-xs font-bold uppercase tracking-widest bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">Click anywhere to close</div>
         </div>
      )}

    </div>
  );
};

// Sub-component for Data Row
const DataRow = ({ label, value }: { label: string, value: any }) => (
   <div className="border-b border-slate-50 pb-2 last:border-0">
      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
      <div className="font-bold text-slate-700 text-sm">{value}</div>
   </div>
);