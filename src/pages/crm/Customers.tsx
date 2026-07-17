// src/pages/crm/Customers.tsx
import { useState, useMemo } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useDatabase } from '../../hooks/useDatabase';
import {
  Search, Phone, History,
  ArrowUpRight, Smartphone,
  UserCheck, Star, Clock, Users,
} from 'lucide-react';
import { formatDate } from '../../utils/formatters';
import { CustomerTimelineModal } from '../../components/customer/CustomerTimelineModal';

interface BackfillResult { scanned: number; linked: number; strayCustomerIdsForReview: string[]; }

export const Customers = () => {
  const { data: customersData, loading } = useDatabase('customers');
  const { data: activeJobs } = useDatabase('jobs');   // ดึงข้อมูลการรับซื้อ (ใช้นับจำนวนครั้งที่ขายเครื่อง)
  const { data: archivedJobs } = useDatabase('jobs_archived'); // รวมงานที่ archive แล้ว
  const jobsData = useMemo(() => [...activeJobs, ...archivedJobs], [activeJobs, archivedJobs]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [backfilling, setBackfilling] = useState(false);

  // One-time CRM contact backfill — links existing orders to crm_contacts (by
  // phone/email), cleans up the orphan legacy index, and reports stray records
  // that our earlier resolveCustomer wrote into `customers` for manual review.
  const runBackfill = async () => {
    if (backfilling) return;
    if (!confirm('รวมข้อมูลลูกค้าย้อนหลัง (ผูกออเดอร์เก่าเข้ากับ CRM contact) — รันครั้งเดียว ดำเนินการต่อ?')) return;
    setBackfilling(true);
    try {
      const fn = httpsCallable<Record<string, never>, BackfillResult>(
        getFunctions(app, 'asia-southeast1'), 'backfillCrmContacts');
      const d = (await fn({})).data;
      const stray = d.strayCustomerIdsForReview || [];
      alert(
        `เสร็จแล้ว\n\nสแกนออเดอร์: ${d.scanned}\nผูก crm_customer_id: ${d.linked}\n` +
        `records ที่ต้องลบเองใน customers: ${stray.length}` +
        (stray.length ? `\n\nID ที่ควรลบ:\n${stray.join('\n')}` : '')
      );
    } catch (e) {
      alert('ไม่สำเร็จ: ' + ((e as Error)?.message || String(e)));
    } finally {
      setBackfilling(false);
    }
  };

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
        <button
          onClick={runBackfill}
          disabled={backfilling}
          title="ผูกออเดอร์เก่าทั้งหมดเข้ากับ CRM contact ด้วยเบอร์/อีเมล (รันครั้งเดียว)"
          className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-black text-xs uppercase rounded-2xl hover:bg-blue-700 disabled:bg-slate-300 transition-colors shadow-lg"
        >
          <Users size={16} /> {backfilling ? 'กำลังรวม...' : 'รวมข้อมูลลูกค้า (Backfill)'}
        </button>
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
         <CustomerTimelineModal
            phone={selectedCustomer.phone}
            name={selectedCustomer.name}
            onClose={() => setSelectedCustomer(null)}
         />
      )}
    </div>
  );
};