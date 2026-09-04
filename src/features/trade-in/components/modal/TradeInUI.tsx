import React from 'react';
import { Bike, Mail, Store, CheckCircle2, ChevronRight, Phone, Zap, CalendarDays, History } from 'lucide-react';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { isAwaitingOffer } from '@/utils/offerRequest';
import { isOfferAwaitingDecision } from '@/utils/customerOffer';
import { isRecededStatus, JOB_STATUS } from '@/types/job-statuses';
import { canonicalStatus } from '@/utils/statusCompare';
import { statusBadgeClass } from '@/utils/statusColors';

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

// Per-status colors live in src/utils/statusColors.ts, shared with the
// mobile JobCard chip — edit them there, not here.
export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase border shadow-sm transition-all ${statusBadgeClass(status)}`}>{status}</span>
);

export const TicketPipeline = ({ status }: { status: string }) => {
  // Tolerant matching: each phase array carries both the legacy DB strings
  // and the canonical names from src/types/job-statuses.ts so the pipeline
  // keeps lighting up correctly through the Phase 2D writer rename. New
  // statuses from Phase 2B (Drop-off Received, Parcel Received, Awaiting
  // Shipping, Discrepancy Reported, ...) get bucketed too.
  const canon = (s: string) => canonicalStatus(s) ?? s;
  const inList = (list: readonly string[]) => list.includes(canon(status));
  const isCancelled = inList([
    JOB_STATUS.CANCELLED, JOB_STATUS.CLOSED_LOST, JOB_STATUS.RETURN_CONFIRMED,
    JOB_STATUS.DROP_OFF_EXPIRED, JOB_STATUS.SHIPPING_EXPIRED, JOB_STATUS.PARCEL_LOST,
  ]);

  // canonical เท่านั้น — สถานะของงานถูก canon() ก่อนเทียบ สะกดเก่าตกที่ canonical เอง
  const phase1_Sales = [
    JOB_STATUS.NEW_LEAD, JOB_STATUS.FOLLOWING_UP, JOB_STATUS.APPOINTMENT_SET, JOB_STATUS.WAITING_DROP_OFF,
    JOB_STATUS.AWAITING_SHIPPING,
  ];
  const phase2_Logistics = [
    JOB_STATUS.ACTIVE_LEAD, JOB_STATUS.RIDER_ASSIGNED, JOB_STATUS.RIDER_ACCEPTED, JOB_STATUS.RIDER_EN_ROUTE, JOB_STATUS.RIDER_ARRIVED,
    JOB_STATUS.RIDER_RETURNING, JOB_STATUS.PARCEL_IN_TRANSIT,
    JOB_STATUS.DROP_OFF_RECEIVED, JOB_STATUS.PARCEL_RECEIVED,
  ];
  const phase3_Inspection = [
    JOB_STATUS.BEING_INSPECTED, JOB_STATUS.QC_REVIEW, JOB_STATUS.REVISED_OFFER, JOB_STATUS.NEGOTIATION,
    JOB_STATUS.PRICE_ACCEPTED, 'Discrepancy Reported',
  ];
  const phase4_Finance = [
    JOB_STATUS.PAYOUT_PROCESSING, JOB_STATUS.WAITING_FOR_HANDOVER,
    JOB_STATUS.PAID, JOB_STATUS.PENDING_QC, JOB_STATUS.SENT_TO_QC_LAB, JOB_STATUS.IN_STOCK, JOB_STATUS.READY_TO_SELL,
    JOB_STATUS.SOLD, JOB_STATUS.COMPLETED,
  ];

  const phases = [
    { id: 1, name: 'Sales & Deal', active: inList(phase1_Sales), done: (inList(phase2_Logistics) || inList(phase3_Inspection) || inList(phase4_Finance)) && !isCancelled },
    { id: 2, name: 'Logistics', active: inList(phase2_Logistics), done: (inList(phase3_Inspection) || inList(phase4_Finance)) && !isCancelled },
    { id: 3, name: 'Inspection', active: inList(phase3_Inspection), done: inList(phase4_Finance) && !isCancelled },
    { id: 4, name: 'Finance & QC', active: inList(phase4_Finance), done: inList([JOB_STATUS.IN_STOCK, JOB_STATUS.READY_TO_SELL]) && !isCancelled }
  ];

  if (isCancelled) {
    return (
      <div className={`p-4 rounded-2xl text-center font-black text-xs uppercase tracking-widest border mt-6 shadow-inner ${canon(status) === JOB_STATUS.RETURN_CONFIRMED ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-red-50 text-red-600 border-red-200'}`}>
        {canon(status) === JOB_STATUS.RETURN_CONFIRMED ? '📦 Item Returned (ส่งเครื่องคืนลูกค้าแล้ว)' : '🚫 Ticket Closed / Cancelled (ยกเลิกรายการแล้ว)'}
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

export const JobTable = ({ jobs, onRowClick, onViewHistory }: { jobs: any[], onRowClick: (job: any) => void, onViewHistory?: (job: any) => void }) => (
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
        {jobs.map((job) => {
          // Receded = terminal or soft-closed: content ink goes quiet (never
          // the status chip, never the row background) and attention markers
          // (offer CTA badges) are suppressed so active work stands out.
          const receded = isRecededStatus(job.status, job.receive_method);
          return (
          <tr key={job.id} className="group hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => onRowClick(job)}>
            <td className="p-6 pl-10">
              <div className="font-mono text-[11px] font-black text-blue-600 mb-1 flex items-center gap-2">
                {job.ref_no}
                {job.status === 'New Lead' && !job.is_read && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] tracking-widest animate-pulse shadow-sm">NEW</span>}
                {job.source === 'instant-sell' && <span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded text-[8px] tracking-widest border border-amber-200 flex items-center gap-0.5"><Zap size={8} />INSTANT</span>}
                {!receded && isAwaitingOffer(job) && <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[8px] tracking-widest border border-blue-200">ขอราคา</span>}
                {!receded && isOfferAwaitingDecision(job) && <span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded text-[8px] tracking-widest border border-amber-200 animate-pulse">เสนอราคา</span>}
              </div>
              <div className={`text-[10px] font-bold ${receded ? 'text-ink-receded-muted' : 'text-slate-400'}`}>{formatDate(job.created_at)}</div>
            </td>
            <td className="p-6">
              {onViewHistory && job.cust_phone ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onViewHistory(job); }}
                  className="text-left group/cust -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                  title="ดูประวัติลูกค้า"
                >
                  <div className={`font-black text-sm flex items-center gap-1.5 group-hover/cust:text-blue-600 ${receded ? 'text-ink-receded' : 'text-slate-800'}`}>
                    {job.cust_name || 'Anonymous'}
                    <History size={12} className="text-blue-400 opacity-0 group-hover/cust:opacity-100 transition-opacity" />
                  </div>
                  <div className={`text-[10px] font-bold flex items-center gap-1 mt-0.5 ${receded ? 'text-ink-receded-muted' : 'text-slate-400'}`}><Phone size={10} /> {job.cust_phone}</div>
                </button>
              ) : (
                <>
                  <div className={`font-black text-sm ${receded ? 'text-ink-receded' : 'text-slate-800'}`}>{job.cust_name || 'Anonymous'}</div>
                  <div className={`text-[10px] font-bold flex items-center gap-1 mt-0.5 ${receded ? 'text-ink-receded-muted' : 'text-slate-400'}`}><Phone size={10} /> {job.cust_phone || 'N/A'}</div>
                </>
              )}
            </td>
            
            {/* 🌟 1. จุดที่ถูกปรับปรุง: คอลัมน์ Device & Method 🌟 */}
            <td className="p-6">
              <div className={`font-black text-xs uppercase mb-1.5 ${receded ? 'text-ink-receded' : 'text-slate-700'}`}>{job.model}</div>

              <div className="flex flex-col gap-1.5">
                {/* แถวที่ 1: ราคา & วิธีส่งมอบ */}
                <div className="flex items-center gap-2">
                  {!receded && isAwaitingOffer(job)
                    ? <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">รอเสนอราคา</span>
                    : receded
                      ? <span className="text-[9px] font-black text-ink-receded px-2 py-0.5">{formatCurrency(job.final_price || job.price)}</span>
                      : <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">{formatCurrency(job.final_price || job.price)}</span>}
                  <MethodBadge method={job.receive_method} />
                </div>

                {/* แถวที่ 2: เวลานัดหมาย (โชว์เฉพาะงาน Pickup และมีการระบุเวลามาแล้ว) */}
                {job.receive_method === 'Pickup' && job.pickup_schedule && (
                  <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest">
                    {/* On receded rows the schedule text switches to receded
                        ink: orange-600 on the tinted chip is 3.33:1, and a
                        loud appointment on a closed job misleads anyway. */}
                    {job.pickup_schedule.type?.toLowerCase() === 'instant' ? (
                      <span className={`${receded ? 'text-ink-receded' : 'text-orange-600'} bg-orange-100/50 border border-orange-200 px-1.5 py-0.5 rounded-md flex items-center gap-1 w-fit shadow-sm`}>
                        <Zap size={10} className={receded ? 'text-ink-receded' : 'text-orange-500'} /> รับด่วน (1-2 ชม.)
                      </span>
                    ) : (
                      <span className={`${receded ? 'text-ink-receded' : 'text-blue-600'} bg-blue-100/50 border border-blue-200 px-1.5 py-0.5 rounded-md flex items-center gap-1 w-fit shadow-sm`}>
                        <CalendarDays size={10} className={receded ? 'text-ink-receded' : 'text-blue-500'} />
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
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black uppercase ${receded ? 'bg-slate-100 text-ink-receded' : 'bg-blue-100 text-blue-600'}`}>{job.agent_name.substring(0, 2)}</div>
                  <span className={`text-xs font-bold ${receded ? 'text-ink-receded' : 'text-slate-700'}`}>{job.agent_name}</span>
                </div>
              ) : (
                <span className={`text-[10px] font-black bg-slate-100 px-2 py-1 rounded-md uppercase border border-slate-200 border-dashed ${receded ? 'text-ink-receded' : 'text-slate-400'}`}>Unassigned</span>
              )}
            </td>
            <td className="p-6"><StatusBadge status={job.status} /></td>
            <td className="p-6 text-right pr-10"><button className="p-3 bg-slate-100 text-slate-400 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-all"><ChevronRight size={18} /></button></td>
          </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);