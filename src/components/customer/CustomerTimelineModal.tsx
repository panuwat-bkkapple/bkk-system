// src/components/customer/CustomerTimelineModal.tsx
//
// ไทม์ไลน์ประวัติลูกค้าแบบใช้ซ้ำได้ (shared) — เปิดจากที่ไหนก็ได้โดยส่ง
// แค่เบอร์โทรเข้ามา แล้ว component จะไปดึง sales + jobs + jobs_archived
// เองและจับคู่ด้วยเบอร์โทร (normalize เฉพาะตัวเลข) เพื่อรวมประวัติ
// "ซื้อจากเรา" และ "ขายให้เรา" เป็นไทม์ไลน์เดียว
//
// logic นี้ย้ายออกมาจาก pages/crm/Customers.tsx และ CustomerCRM.tsx
// (เดิม duplicate กันอยู่) เพื่อให้หน้างาน (ทั้ง mobile และ desktop)
// กดชื่อ/เบอร์ลูกค้าแล้วเห็นประวัติได้โดยไม่ต้องเข้า CRM
import { useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import {
  History, Clock, ShoppingCart, Smartphone, Tag, X,
  ArrowUpRight, RefreshCw,
} from 'lucide-react';

interface CustomerTimelineModalProps {
  /** เบอร์โทรลูกค้าที่จะใช้จับคู่ประวัติ */
  phone: string;
  /** ชื่อลูกค้า (ใช้แสดงหัว modal เฉยๆ) */
  name?: string;
  onClose: () => void;
}

const onlyDigits = (v: any) => String(v ?? '').replace(/[^0-9]/g, '');

export const CustomerTimelineModal = ({ phone, name, onClose }: CustomerTimelineModalProps) => {
  const { data: salesData } = useDatabase('sales');
  const { data: activeJobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: archivedJobs } = useDatabase('jobs_archived');
  const jobsData = useMemo(() => [...activeJobs, ...archivedJobs], [activeJobs, archivedJobs]);

  const targetPhone = onlyDigits(phone);

  const history = useMemo(() => {
    if (!targetPhone) return [];
    const out: any[] = [];

    // 1. ประวัติที่ลูกค้า "ซื้อจากเรา" (Sales)
    if (Array.isArray(salesData)) {
      salesData.forEach(sale => {
        if (onlyDigits(sale.cust_phone) === targetPhone) {
          out.push({
            id: sale.id,
            type: 'BUY',
            date: sale.sold_at || sale.created_at,
            title: `ซื้อสินค้า (Receipt: ${sale.receipt_no})`,
            amount: sale.grand_total,
            items: sale.items?.map((i: any) =>
              i.type === 'DEVICE' ? `${i.name} [IMEI/SN: ${i.code}]` : `${i.name} (x${i.qty})`
            ).join(' • '),
            status: sale.status || 'COMPLETED',
            icon: <ShoppingCart size={16} />,
            color: 'blue',
          });
        }
      });
    }

    // 2. ประวัติที่ลูกค้า "ขายให้เรา" (Jobs/Trade-in)
    if (Array.isArray(jobsData)) {
      jobsData.forEach(job => {
        if (onlyDigits(job.cust_phone) === targetPhone) {
          out.push({
            id: job.id,
            type: 'SELL',
            date: job.created_at,
            title: `ขายเครื่องให้ร้าน (รุ่น: ${job.model})`,
            amount: job.final_price || job.price,
            items: `IMEI/SN: ${job.imei || job.serial || '-'}`,
            status: job.status,
            icon: <Smartphone size={16} />,
            color: 'orange',
          });
        }
      });
    }

    return out.sort((a, b) => b.date - a.date);
  }, [targetPhone, salesData, jobsData]);

  // สรุปยอดจากไทม์ไลน์เอง (self-contained ไม่พึ่ง customer record)
  const summary = useMemo(() => {
    let totalSpent = 0;
    let soldCount = 0;
    history.forEach(item => {
      if (item.status === 'VOIDED') return;
      if (item.type === 'BUY') totalSpent += Number(item.amount) || 0;
      else if (item.type === 'SELL') soldCount += 1;
    });
    return { totalSpent, soldCount };
  }, [history]);

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center relative overflow-hidden">
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center font-black text-xl shadow-lg">
              {(name || '?').charAt(0)}
            </div>
            <div>
              <h3 className="font-black text-xl text-slate-800 uppercase tracking-tight">{name || 'ลูกค้า'}</h3>
              <p className="text-xs font-bold text-slate-500">{phone}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full shadow-sm relative z-10"><X size={20} /></button>
          <History className="absolute -right-4 -top-4 text-slate-200 opacity-50 rotate-12" size={100} />
        </div>

        {/* สรุปยอด */}
        <div className="grid grid-cols-2 gap-4 p-6 border-b border-slate-100">
          <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
            <div className="text-[10px] font-black text-emerald-600 uppercase mb-1 flex items-center gap-1"><ArrowUpRight size={12} /> ยอดซื้อสะสม</div>
            <div className="text-lg font-black text-slate-800">฿{summary.totalSpent.toLocaleString()}</div>
          </div>
          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
            <div className="text-[10px] font-black text-blue-600 uppercase mb-1 flex items-center gap-1"><Smartphone size={12} /> เคยขายเครื่อง</div>
            <div className="text-lg font-black text-slate-800">{summary.soldCount} ครั้ง</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="p-8 overflow-y-auto flex-1 bg-slate-50">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2"><Clock size={14} /> Transaction Timeline</h4>

          {jobsLoading ? (
            <div className="py-10 flex items-center justify-center text-slate-400"><RefreshCw size={20} className="animate-spin" /></div>
          ) : (
            <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-200 before:to-transparent">
              {history.length === 0 ? (
                <div className="pl-12 py-10 text-center text-slate-400 font-bold italic">ไม่พบประวัติการทำธุรกรรม</div>
              ) : (
                history.map((item, idx) => (
                  <div key={`${item.id}-${idx}`} className="relative pl-12">
                    <div className={`absolute left-0 w-10 h-10 rounded-full border-4 border-slate-50 flex items-center justify-center z-10 ${item.color === 'blue' ? 'bg-blue-500 text-white' : 'bg-orange-500 text-white'}`}>
                      {item.icon}
                    </div>
                    <div className={`p-5 rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md ${item.status === 'VOIDED' ? 'opacity-60 grayscale' : ''}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded mb-2 inline-block ${item.color === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>{item.type === 'BUY' ? 'Customer Bought (ซื้อสินค้า)' : 'Customer Sold (เทิร์นเครื่อง)'}</span>
                          <h5 className="font-black text-slate-800 text-sm">{item.title}</h5>
                          <p className="text-[10px] text-slate-400 font-bold mt-0.5">{item.date ? new Date(item.date).toLocaleString('th-TH') : '-'}</p>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-black ${item.status === 'VOIDED' ? 'line-through text-slate-400' : 'text-slate-800'}`}>฿{Number(item.amount || 0).toLocaleString()}</div>
                          {item.status === 'VOIDED' && <div className="text-[9px] font-black text-red-500 uppercase mt-0.5">VOIDED</div>}
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1"><Tag size={10} /> รายละเอียด</div>
                        <p className="text-xs font-bold text-slate-600 leading-relaxed whitespace-pre-line">{item.items}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
