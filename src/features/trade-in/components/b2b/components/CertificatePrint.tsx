import React from 'react';
import { ShieldCheck, MapPin, CheckCircle2 } from 'lucide-react';

interface CertificatePrintProps {
  job: any;
  printMode: 'none' | 'master_cert';
}

export const CertificatePrint = ({ job, printMode }: CertificatePrintProps) => {
  const gradedItems = job?.graded_items || [];
  const validItems = gradedItems.filter((i: any) => i.grade !== 'Reject');

  if (printMode !== 'master_cert') return null;

  return (
    <div className="fixed inset-0 bg-white z-[9999] flex justify-center items-start pt-10 print:pt-0 print:block print:static">
      <style>{`@media print { @page { size: A4 portrait; margin: 15mm; } body { visibility: hidden; background: white; } .master-cert-container { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; } table { page-break-inside: auto; } tr { page-break-inside: avoid; page-break-after: auto; } thead { display: table-header-group; } }`}</style>
      <div className="master-cert-container w-[190mm] min-h-[270mm] bg-white p-10 flex flex-col font-sans text-black">
         {/* หัวกระดาษ */}
         <div className="flex justify-between items-center border-b-4 border-slate-900 pb-6 mb-8">
           <div><div className="flex items-center gap-3 mb-2"><ShieldCheck size={32} className="text-slate-900" /><h1 className="text-3xl font-black tracking-tighter uppercase text-slate-900">Certificate</h1></div><h2 className="text-lg font-black text-slate-700 uppercase tracking-widest">of Data Destruction</h2></div>
           <div className="text-right"><div className="font-mono text-sm font-black text-slate-600">REF: {job.ref_no}</div><div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">Date: {new Date().toLocaleDateString('en-GB')}</div></div>
         </div>
         {/* ข้อมูลลูกค้า */}
         <div className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-200 flex justify-between items-center">
           <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Corporate Client</p><h2 className="text-xl font-black text-slate-800">{(job.cust_name || '').split('(')[0]}</h2><p className="text-xs font-bold text-slate-500 mt-1 flex items-center gap-2"><MapPin size={12} /> {job.cust_address || 'Head Office'}</p></div>
           <div className="text-right"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Devices Processed</p><div className="text-3xl font-black text-indigo-600">{validItems.length} <span className="text-sm text-slate-500">Units</span></div></div>
         </div>
         {/* คำประกาศ */}
         <div className="mb-8 text-sm text-slate-700 leading-relaxed font-medium text-justify">This document certifies that the data storage devices listed below have been securely erased and sanitized in accordance with industry-leading data destruction standards, including <strong>NIST 800-88 (Guidelines for Media Sanitization)</strong>. All user data, personal information, corporate profiles, and cloud-locks (e.g. iCloud/MDM) have been permanently removed and are irrecoverable.</div>
         {/* ตารางเครื่อง */}
         <div className="flex-1 mb-8">
           <table className="w-full text-left text-[11px] border-collapse">
             <thead><tr className="bg-slate-900 text-white"><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800 w-12 text-center">No.</th><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800">Device Model</th><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800">IMEI / Serial Number</th><th className="py-2.5 px-3 font-bold uppercase tracking-wider border border-slate-800 text-center">Status</th></tr></thead>
             <tbody>
               {validItems.map((item: any, idx: number) => (
                 <tr key={item.id || idx} className="border-b border-slate-200"><td className="py-2 px-3 border-x border-slate-200 text-center font-bold text-slate-500">{idx + 1}</td><td className="py-2 px-3 border-x border-slate-200 font-bold text-slate-800">{item.model}</td><td className="py-2 px-3 border-x border-slate-200 font-mono font-bold text-slate-600">{item.imei}</td><td className="py-2 px-3 border-x border-slate-200 text-center font-black text-emerald-600 flex items-center justify-center gap-1"><CheckCircle2 size={12} /> WIPED</td></tr>
               ))}
             </tbody>
           </table>
         </div>
         {/* ลายเซ็น */}
         <div className="mt-auto pt-8 border-t-2 border-slate-100 flex justify-around">
           <div className="text-center w-56"><div className="h-16 border-b border-slate-300 mb-2"></div><p className="text-xs font-black text-slate-800 uppercase">Authorized Technician</p><p className="text-[10px] font-bold text-slate-400">QC Lab Operations</p></div>
           <div className="text-center w-56"><div className="h-16 border-b border-slate-300 mb-2"></div><p className="text-xs font-black text-slate-800 uppercase">Operations Manager</p><p className="text-[10px] font-bold text-slate-400">BKK System Co., Ltd.</p></div>
         </div>
         <div className="mt-8 text-center text-[9px] font-bold text-slate-400 uppercase tracking-widest">Confidential Corporate Document • Generated by BKK Trade-in Enterprise ERP</div>
      </div>
    </div>
  );
};
