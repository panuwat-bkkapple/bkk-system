// src/pages/crm/WarrantyClaims.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { ref, push, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/ToastProvider';
import { 
  ShieldAlert, Search, FileText, Smartphone, User, 
  Calendar, Wrench, RefreshCcw, Banknote, AlertTriangle, 
  Info, CheckCircle2, History, XCircle
} from 'lucide-react';

export const WarrantyClaims = () => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const { data: sales } = useDatabase('sales');
  const { data: jobs } = useDatabase('jobs');
  const { data: claims } = useDatabase('claims');

  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<any>(null);

  // 📝 ฟอร์มเปิดบิลเคลม
  const [claimForm, setClaimForm] = useState({
    issue: '',
    resolution: 'REPAIR',
    note: ''
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // 1. ค้นหาในประวัติการขายทั้งหมด
    const allSales = Array.isArray(sales) ? sales : [];
    let foundItem = null;
    let foundSale = null;

    // หาบิลที่มี IMEI/SN หรือ เลขที่ใบเสร็จ ตรงกัน
    for (const sale of allSales) {
       if (sale.status === 'VOIDED') continue;
       
       if (sale.receipt_no === query) {
          foundSale = sale;
          foundItem = sale.items?.find((i:any) => i.type === 'DEVICE') || sale.items[0];
          break;
       }

       const itemByCode = sale.items?.find((i:any) => i.code === query);
       if (itemByCode) {
          foundSale = sale;
          foundItem = itemByCode;
          break;
       }
    }

    if (!foundSale || !foundItem) {
       toast.warning('ไม่พบประวัติการขายสินค้า หรือ IMEI นี้ในระบบ (หรือบิลถูกยกเลิกไปแล้ว)');
       setSearchResult(null);
       return;
    }

    // 2. ดึงประวัติต้นทางจาก Jobs (หาว่าใครรับซื้อ ใคร QC)
    const allJobs = Array.isArray(jobs) ? jobs : [];
    const originalJob = allJobs.find(j => j.id === foundItem.id);

    setSearchResult({ sale: foundSale, item: foundItem, job: originalJob });
  };

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimForm.issue) { toast.warning('กรุณาระบุอาการเสีย'); return; }
    if (!window.confirm('ยืนยันการเปิดบิลเคลมสินค้า?')) return;

    try {
      const claimNo = `CLM-${Date.now().toString().slice(-6)}`;
      const timestamp = Date.now();

      const claimRecord = {
        claim_no: claimNo,
        receipt_no: searchResult.sale.receipt_no,
        item_code: searchResult.item.code,
        item_name: searchResult.item.name,
        customer_name: searchResult.sale.customer_name,
        customer_phone: searchResult.sale.customer_phone,
        issue: claimForm.issue,
        resolution: claimForm.resolution,
        note: claimForm.note,
        status: 'OPEN', // OPEN, RESOLVED, REJECTED
        created_at: timestamp,
        handled_by: currentUser?.name || 'Admin',
        original_job_id: searchResult.job?.id || null
      };

      // 1. บันทึกลงตาราง Claims
      await push(ref(db, 'claims'), claimRecord);

      // 2. อัปเดตสถานะใน Jobs (ตีเครื่องกลับเข้าคลังในสถานะ "รอเคลม/ซ่อม")
      if (searchResult.job?.id) {
         let newJobStatus = 'In Repair';
         if (claimForm.resolution === 'REFUND' || claimForm.resolution === 'REPLACE') {
            newJobStatus = 'Defective Return'; // ตีกลับเป็นของเสีย
         }
         await update(ref(db, `jobs/${searchResult.job.id}`), {
            status: newJobStatus,
            updated_at: timestamp,
            claim_info: `ถูกเคลม: ${claimNo}`
         });
      }

      toast.success(`เปิดบิลเคลมสำเร็จ! เลขที่: ${claimNo}`);
      setSearchResult(null);
      setQuery('');
      setClaimForm({ issue: '', resolution: 'REPAIR', note: '' });

    } catch (error) {
      toast.error('เกิดข้อผิดพลาด: ' + error);
    }
  };

  const claimsList = useMemo(() => {
     if (!claims) return [];
     const list = Array.isArray(claims) ? claims : Object.keys(claims).map(k => ({ id: k, ...(claims as any)[k] }));
     return list.sort((a, b) => b.created_at - a.created_at);
  }, [claims]);

  return (
    <div className="p-8 space-y-8 bg-[#F5F7FA] min-h-screen font-sans text-slate-800">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            <ShieldAlert className="text-red-500"/> Warranty & Claims
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ระบบเปิดบิลเคลม ตรวจสอบประกัน และติดตามความรับผิดชอบ</p>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="max-w-2xl bg-white p-2 rounded-[2.5rem] shadow-xl border border-red-100 flex gap-2">
         <div className="flex-1 flex items-center px-4 gap-3">
            <Search className="text-slate-400" size={20}/>
            <input 
               type="text" 
               placeholder="ค้นหาด้วย IMEI / Serial Number หรือ เลขใบเสร็จ..." 
               value={query}
               onChange={e => setQuery(e.target.value)}
               className="w-full bg-transparent outline-none font-bold text-lg"
            />
         </div>
         <button type="submit" className="bg-red-600 text-white px-8 py-3 rounded-2xl font-black uppercase text-sm hover:bg-red-700 transition-all">ตรวจสอบ</button>
      </form>

      {/* 🔴 SEARCH RESULT & CLAIM FORM */}
      {searchResult ? (
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4">
            
            {/* LEFT: ประวัติการขายและต้นทาง */}
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
               <h3 className="font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-4">
                  <FileText size={18} className="text-blue-500"/> ข้อมูลการรับประกัน (Warranty Info)
               </h3>
               
               <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex justify-between items-start mb-4">
                     <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">อุปกรณ์ที่พบ</div>
                        <div className="font-black text-lg text-slate-800">{searchResult.item.name}</div>
                        <div className="text-xs font-mono font-bold text-slate-500 mt-1">IMEI/SN: {searchResult.item.code || '-'}</div>
                     </div>
                     <div className="text-right">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">วันที่ขายออก</div>
                        <div className="font-bold text-sm text-slate-800">{new Date(searchResult.sale.sold_at).toLocaleDateString('th-TH')}</div>
                     </div>
                  </div>

                  {/* คำนวณวันหมดประกัน */}
                  {(() => {
                     const daysSinceSold = Math.floor((Date.now() - searchResult.sale.sold_at) / (1000 * 60 * 60 * 24));
                     const isExpired = daysSinceSold > 30; // สมมติประกันร้าน 30 วัน
                     return (
                        <div className={`mt-4 p-3 rounded-xl border flex justify-between items-center ${isExpired ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                           <span className={`text-xs font-black uppercase tracking-widest ${isExpired ? 'text-red-600' : 'text-emerald-600'}`}>
                              {isExpired ? 'หมดระยะประกันร้าน' : 'ยังอยู่ในระยะประกัน'}
                           </span>
                           <span className={`font-black text-lg ${isExpired ? 'text-red-600' : 'text-emerald-600'}`}>
                              ผ่านมาแล้ว {daysSinceSold} วัน
                           </span>
                        </div>
                     );
                  })()}
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
                     <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1"><User size={12}/> ผู้ซื้อ (Customer)</div>
                     <div className="font-bold text-sm text-slate-800">{searchResult.sale.customer_name}</div>
                     <div className="text-xs font-bold text-slate-500">{searchResult.sale.customer_phone}</div>
                  </div>
                  <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl shadow-sm">
                     <div className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1 flex items-center gap-1"><ShieldAlert size={12}/> ต้นทาง (Acquisition)</div>
                     {searchResult.job ? (
                        <>
                           <div className="font-bold text-sm text-slate-800 line-clamp-1">ผู้รับซื้อ: {searchResult.job.rider_name || 'Admin'}</div>
                           <div className="text-xs font-bold text-slate-500">เกรด QC: {searchResult.job.grade || '-'}</div>
                        </>
                     ) : (
                        <div className="text-xs italic text-slate-400">ไม่มีข้อมูลต้นทางในระบบ</div>
                     )}
                  </div>
               </div>
            </div>

            {/* RIGHT: ฟอร์มเปิดบิลเคลม */}
            <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
               <Wrench className="absolute top-0 right-0 m-8 text-white opacity-5" size={100}/>
               <h3 className="font-black uppercase tracking-widest flex items-center gap-2 mb-6 text-red-400 relative z-10">
                  <AlertTriangle size={18}/> เปิดบิลเคลม (Open Claim Ticket)
               </h3>

               <form onSubmit={handleSubmitClaim} className="space-y-5 relative z-10">
                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">อาการที่พบ / ปัญหาที่ลูกค้าแจ้ง (Issue)</label>
                     <input required type="text" value={claimForm.issue} onChange={e=>setClaimForm({...claimForm, issue: e.target.value})} className="w-full bg-slate-800 border border-slate-700 px-4 py-3 rounded-xl font-bold text-white outline-none focus:border-red-500" placeholder="เช่น จอลาย, แบตเสื่อมเร็วกว่าปกติ, Face ID เสีย..."/>
                  </div>

                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">การดำเนินการ (Resolution)</label>
                     <div className="grid grid-cols-3 gap-3">
                        <label className={`p-3 rounded-xl border-2 flex flex-col items-center gap-2 cursor-pointer transition-all ${claimForm.resolution === 'REPAIR' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                           <input type="radio" name="resolution" value="REPAIR" checked={claimForm.resolution === 'REPAIR'} onChange={e=>setClaimForm({...claimForm, resolution: e.target.value})} className="hidden" />
                           <Wrench size={20}/>
                           <span className="text-[10px] font-black uppercase">ส่งซ่อม</span>
                        </label>
                        <label className={`p-3 rounded-xl border-2 flex flex-col items-center gap-2 cursor-pointer transition-all ${claimForm.resolution === 'REPLACE' ? 'border-orange-500 bg-orange-500/20 text-orange-400' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                           <input type="radio" name="resolution" value="REPLACE" checked={claimForm.resolution === 'REPLACE'} onChange={e=>setClaimForm({...claimForm, resolution: e.target.value})} className="hidden" />
                           <RefreshCcw size={20}/>
                           <span className="text-[10px] font-black uppercase">เปลี่ยนเครื่อง</span>
                        </label>
                        <label className={`p-3 rounded-xl border-2 flex flex-col items-center gap-2 cursor-pointer transition-all ${claimForm.resolution === 'REFUND' ? 'border-red-500 bg-red-500/20 text-red-400' : 'border-slate-700 bg-slate-800 text-slate-400'}`}>
                           <input type="radio" name="resolution" value="REFUND" checked={claimForm.resolution === 'REFUND'} onChange={e=>setClaimForm({...claimForm, resolution: e.target.value})} className="hidden" />
                           <Banknote size={20}/>
                           <span className="text-[10px] font-black uppercase">คืนเงินเต็มจำนวน</span>
                        </label>
                     </div>
                  </div>

                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">หมายเหตุเพิ่มเติม (Internal Note)</label>
                     <textarea value={claimForm.note} onChange={e=>setClaimForm({...claimForm, note: e.target.value})} className="w-full bg-slate-800 border border-slate-700 px-4 py-3 rounded-xl font-bold text-white outline-none focus:border-red-500 h-24 resize-none" placeholder="รายละเอียดเพิ่มเติม หรือสาเหตุ..."></textarea>
                  </div>

                  <div className="pt-2 flex gap-3">
                     <button type="button" onClick={() => setSearchResult(null)} className="flex-1 bg-slate-800 text-white py-4 rounded-xl font-black uppercase text-sm hover:bg-slate-700 transition-colors">
                        ยกเลิก
                     </button>
                     <button type="submit" className="flex-[2] bg-red-600 text-white py-4 rounded-xl font-black uppercase text-sm hover:bg-red-500 transition-colors shadow-lg shadow-red-600/20 flex items-center justify-center gap-2">
                        <CheckCircle2 size={18}/> ยืนยันการเปิดบิลเคลม
                     </button>
                  </div>
               </form>
            </div>

         </div>
      ) : (
         /* 📋 RECENT CLAIMS LIST */
         <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden mt-8">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
               <h3 className="font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <History size={18} className="text-slate-400"/> ประวัติการเคลมล่าสุด (Recent Claims)
               </h3>
            </div>
            <table className="w-full text-left">
               <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                     <th className="p-4 pl-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Claim No.</th>
                     <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">สินค้า & อาการ</th>
                     <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">ลูกค้า</th>
                     <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">การดำเนินการ</th>
                     <th className="p-4 pr-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">พนักงาน</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {claimsList.length === 0 ? (
                     <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold italic">ยังไม่มีประวัติการเปิดบิลเคลมสินค้า</td></tr>
                  ) : (
                     claimsList.map(claim => (
                        <tr key={claim.id} className="hover:bg-slate-50 transition-colors">
                           <td className="p-4 pl-6">
                              <div className="font-black text-slate-800 text-sm">{claim.claim_no}</div>
                              <div className="text-[10px] font-bold text-slate-400 mt-1">{new Date(claim.created_at).toLocaleString('th-TH')}</div>
                           </td>
                           <td className="p-4">
                              <div className="font-bold text-slate-800 text-sm">{claim.item_name} <span className="text-[10px] text-slate-400 font-mono">({claim.item_code})</span></div>
                              <div className="text-xs font-bold text-red-500 mt-1 flex items-center gap-1"><AlertTriangle size={10}/> {claim.issue}</div>
                           </td>
                           <td className="p-4">
                              <div className="font-bold text-slate-700 text-sm">{claim.customer_name}</div>
                              <div className="text-[10px] font-bold text-slate-400">{claim.customer_phone}</div>
                           </td>
                           <td className="p-4">
                              <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${claim.resolution === 'REFUND' ? 'bg-red-100 text-red-600' : claim.resolution === 'REPLACE' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                                 {claim.resolution === 'REFUND' ? 'คืนเงิน (Refund)' : claim.resolution === 'REPLACE' ? 'เปลี่ยนเครื่อง (Replace)' : 'ส่งซ่อม (Repair)'}
                              </span>
                           </td>
                           <td className="p-4 pr-6 text-right">
                              <div className="font-bold text-slate-600 text-xs">{claim.handled_by}</div>
                           </td>
                        </tr>
                     ))
                  )}
               </tbody>
            </table>
         </div>
      )}
    </div>
  );
};