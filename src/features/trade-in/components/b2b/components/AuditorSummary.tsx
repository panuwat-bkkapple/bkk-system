import React from 'react';
import { Smartphone, CalendarRange, Clock } from 'lucide-react';

interface AuditorSummaryProps {
  job: any;
  siteVisitDate: string;
  onDateChange: (val: string) => void;
  onSaveDate: (field: string, val: string) => void;
}

export const AuditorSummary = ({ job, siteVisitDate, onDateChange, onSaveDate }: AuditorSummaryProps) => {
  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes(String(job.status || '').toLowerCase());
  const gradedItems = job?.graded_items || [];
  const validItems = gradedItems.filter((i: any) => i.grade !== 'Reject');
  const rejectItemsCount = gradedItems.length - validItems.length;

  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
          <Smartphone className="text-indigo-500" size={20}/> 3. On-Site Auditor Summary (ผลตรวจหน้างาน)
        </h3>
      </div>

      <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100">

        {/* DUE DATE: Site Visit Schedule */}
        <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-2xl border border-indigo-200 shadow-sm w-fit">
           <CalendarRange size={18} className="text-indigo-500"/>
           <label className="text-xs font-black text-indigo-800 uppercase tracking-widest">Site Visit Schedule (เวลานัดหมายเข้าประเมิน):</label>
           <input type="datetime-local" value={siteVisitDate} disabled={isCancelled}
             onChange={e => { onDateChange(e.target.value); onSaveDate('site_visit_date', e.target.value); }}
             className="bg-indigo-50 border border-indigo-200 text-indigo-900 font-bold px-3 py-1.5 rounded-lg outline-none focus:border-indigo-500"
           />
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-sm font-black text-slate-800 mb-1">รายการสแกน IMEI และประเมินเกรด</div>
            {gradedItems.length > 0 ? (
              <div className="text-xs font-bold text-slate-600 flex items-center gap-3 mt-2">
                <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg border border-emerald-200">ผ่านเกณฑ์ (Accepted): {validItems.length} เครื่อง</span>
                {rejectItemsCount > 0 && <span className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg border border-red-200">ตีคืน (Reject): {rejectItemsCount} เครื่อง</span>}
              </div>
            ) : (
              <div className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mt-2 flex items-center gap-2 bg-indigo-100/50 px-3 py-1.5 rounded-lg inline-flex"><Clock size={14} className="animate-pulse"/> Waiting for Inspection Scan</div>
            )}
          </div>
          <div className="text-right bg-white px-6 py-4 rounded-2xl shadow-sm border border-indigo-50">
            <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">ยอดรวมจากหน้างาน</div>
            <div className="text-3xl font-black text-indigo-600">฿{(job.price || 0).toLocaleString()}</div>
          </div>
        </div>

        {gradedItems.length > 0 && (
          <div className="border border-indigo-100 rounded-2xl overflow-hidden bg-white shadow-sm">
            <div className="max-h-80 overflow-y-auto no-scrollbar">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px]">IMEI / S/N</th>
                    <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px]">Model</th>
                    <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-center">Grade</th>
                    <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gradedItems.map((item: any, idx: number) => (
                    <tr key={item.id || idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-6 font-mono text-slate-500 font-bold text-xs">{item.imei}</td>
                      <td className="py-3 px-6 font-bold text-slate-800">{item.model}</td>
                      <td className="py-3 px-6 text-center">
                        <span className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${item.grade === 'A' ? 'bg-emerald-100 text-emerald-700' : item.grade === 'B' ? 'bg-indigo-100 text-indigo-700' : item.grade === 'C' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{item.grade}</span>
                      </td>
                      <td className="py-3 px-6 text-right font-black text-slate-700 bg-slate-50/50">{item.grade === 'Reject' ? '-' : `฿${item.price.toLocaleString()}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
