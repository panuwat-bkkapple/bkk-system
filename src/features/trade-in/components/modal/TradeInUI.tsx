import React from 'react';
import { Bike, Mail, Store, CheckCircle2, ChevronRight, Phone, Zap, CalendarDays } from 'lucide-react';
import { formatCurrency, formatDate } from '@/utils/formatters';

export const MethodBadge = ({ method }: { method: string }) => {
  const getStyle = () => {
    if (method === 'Pickup') return { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', icon: Bike };
    if (method === 'Mail-in') return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', icon: Mail };
    return { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', icon: Store };
  };
  const s = getStyle();
  const Icon = s.icon;
  return (
    <span className={`px-2 py-0.5 rounded flex items-center gap-1 w-fit text-[9px] font-black uppercase border ${s.bg} ${s.text} ${s.border}`}>
      <Icon size={10} /> {method || 'Store-in'}
    </span>
  );
};

export const StatusBadge = ({ status }: { status: string }) => {
  const styles: any = {
    // Sales Pipeline
    'New Lead': 'bg-pink-100 text-pink-700 border-pink-200 ring-2 ring-pink-500/20',
    'Following Up': 'bg-blue-50 text-blue-600 border-blue-200',
    'Appointment Set': 'bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm',
    'Waiting Drop-off': 'bg-indigo-100 text-indigo-700 border-indigo-200 border-dashed',
    // Logistics & Inspection
    'Active Leads': 'bg-purple-50 text-purple-600 border-purple-200 border-dashed',
    'In-Transit': 'bg-blue-100 text-blue-700 border-blue-300 shadow-sm',
    'Pending QC': 'bg-amber-100 text-amber-700 border-amber-200',
    'QC Review': 'bg-amber-100 text-amber-700 border-amber-200',
    'Revised Offer': 'bg-purple-100 text-purple-700 border-purple-200',
    'Negotiation': 'bg-orange-100 text-orange-700 border-orange-300 ring-2 ring-orange-500/20 shadow-md', // 🟢 สถานะเจรจา
    // Finance & Inventory
    'Payout Processing': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'In Stock': 'bg-slate-100 text-slate-700 border-slate-200',
    // Closed / Cancelled
    'Cancelled': 'bg-red-50 text-red-500 border-red-100',
    'Closed (Lost)': 'bg-slate-800 text-slate-300 border-slate-700',
    'Returned': 'bg-slate-700 text-slate-300 border-slate-800 shadow-inner', // 🟢 สถานะตีของกลับ
  };
  return <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border shadow-sm transition-all ${styles[status] || 'bg-slate-50 text-slate-400 border-slate-100'}`}>{status}</span>;
};

export const TicketPipeline = ({ status }: { status: string }) => {
  // 🟢 รวม Returned ไว้ในกลุ่มยกเลิก
  const isCancelled = ['Cancelled', 'Closed (Lost)', 'Returned'].includes(status);
  
  const phase1_Sales = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off'];
  const phase2_Logistics = ['Active Leads', 'Assigned', 'Arrived', 'In-Transit'];
  
  // 🟢 เอา Pending QC ออกจากสเตปที่ 3
  const phase3_Inspection = ['Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation'];
  
  // 🟢 นำ Pending QC มาใส่สเตป 4 และเพิ่มคำว่า 'Paid' ให้ครอบคลุมการพิมพ์เล็ก/ใหญ่
  const phase4_Finance = ['Payout Processing', 'Waiting for Handover', 'PAID', 'Paid', 'Pending QC', 'In Stock', 'Ready to Sell'];

  const phases = [
    { id: 1, name: 'Sales & Deal', active: phase1_Sales.includes(status), done: (phase2_Logistics.includes(status) || phase3_Inspection.includes(status) || phase4_Finance.includes(status)) && !isCancelled },
    { id: 2, name: 'Logistics', active: phase2_Logistics.includes(status), done: (phase3_Inspection.includes(status) || phase4_Finance.includes(status)) && !isCancelled },
    { id: 3, name: 'Inspection', active: phase3_Inspection.includes(status), done: phase4_Finance.includes(status) && !isCancelled },
    { id: 4, name: 'Finance & QC', active: phase4_Finance.includes(status), done: ['In Stock', 'Ready to Sell'].includes(status) && !isCancelled }
  ];

  if (isCancelled) {
    return (
      <div className={`p-4 rounded-2xl text-center font-black text-xs uppercase tracking-widest border mt-6 shadow-inner ${status === 'Returned' ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-red-50 text-red-600 border-red-200'}`}>
        {status === 'Returned' ? '📦 Item Returned (ส่งเครื่องคืนลูกค้าแล้ว)' : '🚫 Ticket Closed / Cancelled (ยกเลิกรายการแล้ว)'}
      </div>
    );
  }

  let progressWidth = '0%';
  if (phases[3].done || phases[3].active) progressWidth = '70%'; 
  else if (phases[2].active || phases[2].done) progressWidth = '50%'; 
  else if (phases[1].active || phases[1].done) progressWidth = '25%';

  return (
    <div className="relative mt-8 mb-6 px-4">
      <div className="absolute left-[15%] top-4 w-[70%] h-1 bg-slate-100 z-0 rounded-full"></div>
      <div className="absolute left-[15%] top-4 h-1 bg-emerald-400 z-0 rounded-full transition-all duration-700" style={{ width: progressWidth }}></div>
      <div className="flex items-center justify-between relative z-10">
        {phases.map((phase) => (
          <div key={phase.id} className="flex flex-col items-center gap-2 w-1/4">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm border-4 transition-all duration-500 ${phase.done ? 'bg-emerald-500 border-emerald-100 text-white scale-110 shadow-md' : phase.active ? 'bg-blue-600 border-blue-100 text-white shadow-lg shadow-blue-200 animate-bounce' : 'bg-white border-slate-100 text-slate-300'}`}>
              {phase.done ? <CheckCircle2 size={16} strokeWidth={3} /> : phase.id}
            </div>
            <span className={`text-[9px] font-black uppercase tracking-widest text-center leading-tight ${phase.active ? 'text-blue-600' : phase.done ? 'text-emerald-600' : 'text-slate-400'}`}>
              {phase.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const JobTable = ({ jobs, onRowClick }: { jobs: any[], onRowClick: (job: any) => void }) => (
  <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
    <table className="w-full text-left">
      <thead className="bg-slate-50 border-b border-slate-100">
        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
          <th className="p-6 pl-10">Ticket / ID</th>
          <th className="p-6">Customer Info</th>
          <th className="p-6">Device & Method</th>
          <th className="p-6">Owner (Agent)</th>
          <th className="p-6">Status Pipeline</th>
          <th className="p-6 text-right pr-10">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {jobs.length === 0 && (<tr><td colSpan={6} className="text-center p-10 font-bold text-slate-400">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</td></tr>)}
        {jobs.map((job) => (
          <tr key={job.id} className="group hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => onRowClick(job)}>
            <td className="p-6 pl-10">
              <div className="font-mono text-[11px] font-black text-blue-600 mb-1 flex items-center gap-2">
                {job.ref_no}
                {job.status === 'New Lead' && !job.is_read && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] tracking-widest animate-pulse shadow-sm">NEW</span>}
                {job.source === 'instant-sell' && <span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded text-[8px] tracking-widest border border-amber-200 flex items-center gap-0.5"><Zap size={8} />INSTANT</span>}
              </div>
              <div className="text-[10px] font-bold text-slate-400">{formatDate(job.created_at)}</div>
            </td>
            <td className="p-6">
              <div className="font-black text-slate-800 text-sm">{job.cust_name || 'Anonymous'}</div>
              <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mt-0.5"><Phone size={10} /> {job.cust_phone || 'N/A'}</div>
            </td>
            
            {/* 🌟 1. จุดที่ถูกปรับปรุง: คอลัมน์ Device & Method 🌟 */}
            <td className="p-6">
              <div className="font-black text-slate-700 text-xs uppercase mb-1.5">{job.model}</div>
              
              <div className="flex flex-col gap-1.5">
                {/* แถวที่ 1: ราคา & วิธีส่งมอบ */}
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">{formatCurrency(job.final_price || job.price)}</span>
                  <MethodBadge method={job.receive_method} />
                </div>

                {/* แถวที่ 2: เวลานัดหมาย (โชว์เฉพาะงาน Pickup และมีการระบุเวลามาแล้ว) */}
                {job.receive_method === 'Pickup' && job.pickup_schedule && (
                  <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest">
                    {job.pickup_schedule.type?.toLowerCase() === 'instant' ? (
                      <span className="text-orange-600 bg-orange-100/50 border border-orange-200 px-1.5 py-0.5 rounded-md flex items-center gap-1 w-fit shadow-sm">
                        <Zap size={10} className="text-orange-500" /> รับด่วน (1-2 ชม.)
                      </span>
                    ) : (
                      <span className="text-blue-600 bg-blue-100/50 border border-blue-200 px-1.5 py-0.5 rounded-md flex items-center gap-1 w-fit shadow-sm">
                        <CalendarDays size={10} className="text-blue-500" />
                        {job.pickup_schedule.date !== 'Instant' && job.pickup_schedule.date 
                          ? new Date(job.pickup_schedule.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) 
                          : ''} {job.pickup_schedule.time}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </td>

            <td className="p-6">
              {job.agent_name ? (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-black uppercase">{job.agent_name.substring(0, 2)}</div>
                  <span className="text-xs font-bold text-slate-700">{job.agent_name}</span>
                </div>
              ) : (
                <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-md uppercase border border-slate-200 border-dashed">Unassigned</span>
              )}
            </td>
            <td className="p-6"><StatusBadge status={job.status} /></td>
            <td className="p-6 text-right pr-10"><button className="p-3 bg-slate-100 text-slate-400 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-all"><ChevronRight size={18} /></button></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);