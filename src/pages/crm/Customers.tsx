// src/pages/crm/Customers.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { 
  User, Search, Phone, History, 
  ArrowUpRight, ArrowDownRight, Smartphone,
  UserCheck, Star, Clock, X, ShoppingCart, Tag
} from 'lucide-react';
import { formatDate } from '../../utils/formatters';

export const Customers = () => {
  const { data: customersData, loading } = useDatabase('customers');
  const { data: salesData } = useDatabase('sales'); // ดึงข้อมูลการขาย
  const { data: activeJobs } = useDatabase('jobs');   // ดึงข้อมูลการรับซื้อ
  const { data: archivedJobs } = useDatabase('jobs_archived'); // รวมงานที่ archive แล้ว
  const jobsData = useMemo(() => [...activeJobs, ...archivedJobs], [activeJobs, archivedJobs]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  // 🧠 แปลง Object จาก Firebase เป็น Array และกรองข้อมูล
  const customerList = useMemo(() => {
    if (!customersData) return [];
    
    let list: any[] = [];
    if (Array.isArray(customersData)) {
       list = customersData.filter(c => c !== null && c !== undefined);
    } else {
       list = Object.keys(customersData).map(key => ({
          id: key,
          ...(customersData as any)[key]
       }));
    }

    const term = searchTerm.toLowerCase();
    return list.filter(c => 
      (c.name && c.name.toLowerCase().includes(term)) || 
      (c.phone && c.phone.includes(term))
    ).sort((a, b) => (Number(b.total_spent) || 0) - (Number(a.total_spent) || 0));
  }, [customersData, searchTerm]);

  // 🧠 ดึงประวัติธุรกรรมแบบผสม (ซื้อ + ขาย) ของลูกค้าที่ถูกเลือก
  const customerHistory = useMemo(() => {
     if (!selectedCustomer) return [];
     
     const history: any[] = [];
     const targetPhone = selectedCustomer.phone?.replace(/[^0-9]/g, '');
     
     // 1. ดึงประวัติที่ลูกค้า "ซื้อจากเรา" (Sales)
     if (Array.isArray(salesData)) {
         salesData.forEach(sale => {
             const cleanPhone = sale.cust_phone?.replace(/[^0-9]/g, '');
             if (cleanPhone === targetPhone || sale.cust_phone === targetPhone) {
                 history.push({
                     id: sale.id,
                     type: 'BUY',
                     date: sale.sold_at || sale.created_at,
                     title: `ซื้อสินค้า (Receipt: ${sale.receipt_no})`,
                     amount: sale.grand_total,
                     // 🔥 แก้ไขตรงนี้: แยกระบุ IMEI/SN สำหรับเครื่องโทรศัพท์
                     items: sale.items?.map((i:any) => 
                        i.type === 'DEVICE' 
                           ? `${i.name} [IMEI/SN: ${i.code}]` 
                           : `${i.name} (x${i.qty})`
                     ).join(' • '),
                     status: sale.status || 'COMPLETED',
                     icon: <ShoppingCart size={16}/>,
                     color: 'blue'
                 });
             }
         });
     }
     
     // 2. ดึงประวัติที่ลูกค้า "ขายให้เรา" (Jobs/Trade-in)
     if (Array.isArray(jobsData)) {
         jobsData.forEach(job => {
             const cleanPhone = job.cust_phone?.replace(/[^0-9]/g, '');
             if (cleanPhone === targetPhone || job.cust_phone === targetPhone) {
                 history.push({
                     id: job.id,
                     type: 'SELL',
                     date: job.created_at,
                     title: `ขายเครื่องให้ร้าน (รุ่น: ${job.model})`,
                     amount: job.final_price || job.price,
                     items: `IMEI/SN: ${job.imei || job.serial || '-'}`,
                     status: job.status,
                     icon: <Smartphone size={16}/>,
                     color: 'orange'
                 });
             }
         });
     }
     
     return history.sort((a, b) => b.date - a.date);
  }, [selectedCustomer, salesData, jobsData]);

  if (loading) return <div className="p-10 text-center font-bold text-slate-400">Loading CRM...</div>;

  return (
    <div className="p-8 space-y-6 bg-[#F5F7FA] min-h-screen font-sans text-slate-800 relative">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            <UserCheck className="text-blue-600"/> Customer Database (CRM)
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ฐานข้อมูลสมาชิก 360 องศา (ประวัติการซื้อ-ขายเครื่อง)</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-slate-200">
        <div className="relative">
          <Search className="absolute left-5 top-3.5 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="ค้นหาลูกค้าด้วยชื่อ หรือ เบอร์โทรศัพท์..." 
            value={searchTerm} 
            onChange={e=>setSearchTerm(e.target.value)} 
            className="w-full pl-14 pr-6 py-4 bg-slate-50 rounded-2xl font-black text-lg outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {customerList.map((customer) => {
          const isVip = (customer.total_spent || 0) > 50000;

          // 🔴 คำนวณจำนวนครั้งที่เคยนำเครื่องมาขายแบบ Real-time
          const cleanCustPhone = customer.phone?.replace(/[^0-9]/g, '');
          const soldCount = Array.isArray(jobsData) ? jobsData.filter(j => 
             (j.cust_phone || j.customer_phone || '').replace(/[^0-9]/g, '') === cleanCustPhone
          ).length : (customer.total_sold_qty || 0);

          return (
            <div key={customer.id} className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 hover:shadow-2xl hover:-translate-y-1 transition-all group relative overflow-hidden">
              
              {isVip && <div className="absolute top-0 right-0 bg-yellow-400 text-yellow-900 px-6 py-1 rounded-bl-2xl font-black text-[10px] uppercase tracking-tighter shadow-sm flex items-center gap-1"><Star size={10} fill="currentColor"/> VIP Client</div>}

              <div className="flex items-center gap-5 mb-8">
                 <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center font-black text-2xl shadow-inner ${isVip ? 'bg-yellow-50 text-yellow-600' : 'bg-blue-50 text-blue-600'}`}>
                    {customer.name?.charAt(0)}
                 </div>
                 <div>
                    <h3 className="font-black text-xl text-slate-800 leading-tight">{customer.name}</h3>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-slate-400 mt-1">
                       <Phone size={14} className="text-blue-400"/> {customer.phone}
                    </div>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                 <div className="bg-emerald-50 p-4 rounded-3xl border border-emerald-100">
                    <div className="text-[10px] font-black text-emerald-600 uppercase mb-1 flex items-center gap-1"><ArrowUpRight size={12}/> ยอดซื้อสะสม</div>
                    <div className="text-lg font-black text-slate-800">฿{Number(customer.total_spent || 0).toLocaleString()}</div>
                 </div>
                 <div className="bg-blue-50 p-4 rounded-3xl border border-blue-100">
                    <div className="text-[10px] font-black text-blue-600 uppercase mb-1 flex items-center gap-1"><Smartphone size={12}/> เคยขายเครื่อง</div>
                    <div className="text-lg font-black text-slate-800">{soldCount} ครั้ง</div>
                 </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-50">
                 <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    <span className="flex items-center gap-1"><Clock size={12}/> Last Interaction</span>
                    <span>{customer.last_purchase ? formatDate(customer.last_purchase) : 'N/A'}</span>
                 </div>
                 <button onClick={() => setSelectedCustomer(customer)} className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase rounded-2xl hover:bg-blue-600 transition-colors shadow-lg flex items-center justify-center gap-2">
                    <History size={16}/> View Full History
                 </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedCustomer && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
               <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center relative overflow-hidden">
                  <div className="relative z-10 flex items-center gap-4">
                     <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-black text-xl shadow-lg">{selectedCustomer.name?.charAt(0)}</div>
                     <div><h3 className="font-black text-xl text-slate-800 uppercase tracking-tight">{selectedCustomer.name}</h3><p className="text-xs font-bold text-slate-500">{selectedCustomer.phone}</p></div>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full shadow-sm relative z-10"><X size={20}/></button>
                  <History className="absolute -right-4 -top-4 text-slate-200 opacity-50 rotate-12" size={100}/>
               </div>

               <div className="p-8 overflow-y-auto flex-1 bg-slate-50">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2"><Clock size={14}/> Transaction Timeline</h4>

                  <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-200 before:to-transparent">
                     {customerHistory.length === 0 ? (
                        <div className="pl-12 py-10 text-center text-slate-400 font-bold italic">ไม่พบประวัติการทำธุรกรรม</div>
                     ) : (
                        customerHistory.map((item, idx) => (
                           <div key={`${item.id}-${idx}`} className="relative pl-12">
                              <div className={`absolute left-0 w-10 h-10 rounded-full border-4 border-slate-50 flex items-center justify-center z-10 ${item.color === 'blue' ? 'bg-blue-500 text-white' : 'bg-orange-500 text-white'}`}>
                                 {item.icon}
                              </div>
                              <div className={`p-5 rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md ${item.status === 'VOIDED' ? 'opacity-60 grayscale' : ''}`}>
                                 <div className="flex justify-between items-start mb-2">
                                    <div>
                                       <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded mb-2 inline-block ${item.color === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>{item.type === 'BUY' ? 'Customer Bought (ซื้อสินค้า)' : 'Customer Sold (เทิร์นเครื่อง)'}</span>
                                       <h5 className="font-black text-slate-800 text-sm">{item.title}</h5>
                                       <p className="text-[10px] text-slate-400 font-bold mt-0.5">{new Date(item.date).toLocaleString('th-TH')}</p>
                                    </div>
                                    <div className="text-right">
                                       <div className={`text-lg font-black ${item.status === 'VOIDED' ? 'line-through text-slate-400' : 'text-slate-800'}`}>฿{Number(item.amount).toLocaleString()}</div>
                                       {item.status === 'VOIDED' && <div className="text-[9px] font-black text-red-500 uppercase mt-0.5">VOIDED</div>}
                                    </div>
                                 </div>
                                 <div className="mt-3 pt-3 border-t border-slate-100">
                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1"><Tag size={10}/> รายละเอียด</div>
                                    <p className="text-xs font-bold text-slate-600 leading-relaxed whitespace-pre-line">
                                       {item.items}
                                    </p>
                                 </div>
                              </div>
                           </div>
                        ))
                     )}
                  </div>
               </div>
            </div>
         </div>
      )}
    </div>
  );
};