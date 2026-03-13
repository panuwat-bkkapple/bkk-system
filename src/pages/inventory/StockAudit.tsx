// src/pages/inventory/StockAudit.tsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { ref, push } from 'firebase/database';
import { db } from '../../api/firebase';
import { 
  ScanLine, CheckCircle2, AlertOctagon, HelpCircle, 
  Play, Square, Save, History, Search, Package, ShieldAlert
} from 'lucide-react';

export const StockAudit = () => {
  const { currentUser } = useAuth();
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');
  const { data: audits, loading: auditsLoading } = useDatabase('audits');

  // State สำหรับโหมดนับสต็อก
  const [isAuditing, setIsAuditing] = useState(false);
  const [expectedStock, setExpectedStock] = useState<any[]>([]);
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  
  const scannerInputRef = useRef<HTMLInputElement>(null);

  // 🚀 เริ่มการนับสต็อก
  const handleStartAudit = () => {
    if (!jobs) return alert('ไม่สามารถโหลดข้อมูลคลังสินค้าได้');
    
    // ดึงเฉพาะของที่ "ควรจะอยู่ในตู้" (In Stock หรือ Ready to Sell)
    const allJobs = Array.isArray(jobs) ? jobs : Object.keys(jobs).map(k => ({ id: k, ...(jobs as any)[k] }));
    const currentStock = allJobs.filter(j => ['In Stock', 'Ready to Sell'].includes(j.status));
    
    setExpectedStock(currentStock);
    setScannedCodes([]);
    setIsAuditing(true);
    
    // บังคับโฟกัสช่องสแกน
    setTimeout(() => scannerInputRef.current?.focus(), 100);
  };

  // 🛑 หยุดและบันทึกผลการนับสต็อก
  const handleFinishAudit = async () => {
    if (!window.confirm('คุณแน่ใจหรือไม่ว่าต้องการจบการนับสต็อก และบันทึกผลลัพธ์นี้?')) return;

    try {
      const auditRecord = {
        date: Date.now(),
        auditor: currentUser?.name || 'Admin',
        total_expected: expectedStock.length,
        total_scanned: scannedCodes.length,
        total_matched: auditStats.matched.length,
        total_missing: auditStats.missing.length,
        total_extra: auditStats.extra.length,
        missing_items: auditStats.missing.map((i: any) => ({ model: i.model, code: i.imei || i.serial || i.code || 'N/A' })),
        extra_codes: auditStats.extra,
        status: auditStats.missing.length === 0 && auditStats.extra.length === 0 ? 'PERFECT' : 'ISSUES_FOUND'
      };

      await push(ref(db, 'audits'), auditRecord);
      alert('บันทึกผลการนับสต็อกเรียบร้อยแล้ว!');
      setIsAuditing(false);
    } catch (error) {
      alert('เกิดข้อผิดพลาดในการบันทึก: ' + error);
    }
  };

  // 🎯 จัดการเมื่อมีการยิงบาร์โค้ด (กด Enter)
  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim() !== '') {
      const code = inputValue.trim().toUpperCase();
      
      if (!scannedCodes.includes(code)) {
        setScannedCodes(prev => [code, ...prev]);
      }
      setInputValue(''); // ล้างช่องเตรียมยิงตัวต่อไป
    }
  };

  // 🧠 ระบบประมวลผลอัจฉริยะ (แยกของครบ, หาย, เกิน)
  const auditStats = useMemo(() => {
    const matched: any[] = [];
    const missing: any[] = [];
    const extra: string[] = [];

    // ดึงรหัสที่คาดหวังทั้งหมดออกมา
    const expectedCodesMap = new Map();
    expectedStock.forEach(item => {
      const code = (item.imei || item.serial || item.code || '').toUpperCase();
      if (code) expectedCodesMap.set(code, item);
    });

    // 1. หาของที่แสกนเจอ และ ของที่เกินมา
    scannedCodes.forEach(code => {
      if (expectedCodesMap.has(code)) {
        matched.push(expectedCodesMap.get(code));
      } else {
        extra.push(code);
      }
    });

    // 2. หาของที่คาดหวังแต่ยังไม่ได้แสกน (ของหาย)
    expectedStock.forEach(item => {
      const code = (item.imei || item.serial || item.code || '').toUpperCase();
      if (code && !scannedCodes.includes(code)) {
        missing.push(item);
      }
    });

    return { matched, missing, extra };
  }, [expectedStock, scannedCodes]);

  const pastAudits = useMemo(() => {
    if (!audits) return [];
    const list = Array.isArray(audits) ? audits : Object.keys(audits).map(k => ({ id: k, ...(audits as any)[k] }));
    return list.sort((a, b) => b.date - a.date);
  }, [audits]);

  // บังคับให้ช่องสแกนพร้อมเสมอเมื่อคลิกพื้นที่ว่าง
  useEffect(() => {
    const handleClick = () => {
       if (isAuditing && scannerInputRef.current) {
          scannerInputRef.current.focus();
       }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [isAuditing]);

  if (jobsLoading) return <div className="p-10 text-center font-bold text-slate-400">Loading Inventory Data...</div>;

  return (
    <div className="p-6 md:p-8 space-y-6 bg-[#F5F7FA] min-h-screen font-sans text-slate-800">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            <ScanLine className="text-blue-600"/> Smart Stock Audit
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ระบบนับสต็อกด้วยการสแกน IMEI เพื่อหาของหายและสินค้าตกหล่น</p>
        </div>
        {!isAuditing && (
           <button onClick={handleStartAudit} className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-black uppercase text-sm hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20">
             <Play size={18} className="fill-white"/> เริ่มนับสต็อก (Start Audit)
           </button>
        )}
      </div>

      {isAuditing ? (
         /* 🔴 โหมดกำลังสแกน (Active Audit Mode) */
         <div className="animate-in slide-in-from-bottom-4 space-y-6">
            
            {/* กล่องรับสแกนยักษ์ */}
            <div className="bg-slate-900 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden flex flex-col items-center border border-slate-700">
               <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -z-10"></div>
               <h3 className="text-blue-400 font-black tracking-widest uppercase mb-4 flex items-center gap-2">
                  <ScanLine size={20} className="animate-pulse"/> พร้อมสแกนบาร์โค้ด / IMEI
               </h3>
               <input 
                  ref={scannerInputRef}
                  type="text" 
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleScan}
                  placeholder="ยิงบาร์โค้ดที่นี่..."
                  className="w-full max-w-2xl bg-slate-800 border-2 border-slate-600 px-6 py-5 rounded-2xl font-mono text-3xl font-black text-center tracking-widest text-white outline-none focus:border-blue-500 focus:shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all"
                  autoFocus
               />
               <p className="text-slate-500 font-bold text-xs mt-4 uppercase tracking-widest">
                  (ระบบโฟกัสช่องนี้อัตโนมัติ สามารถยิงปืนบาร์โค้ดรัวๆ ได้เลย)
               </p>
            </div>

            {/* Dashboard สรุปผลสดๆ */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
               <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col items-center justify-center">
                  <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 flex items-center gap-1"><Package size={14}/> เป้าหมาย (Expected)</div>
                  <div className="text-4xl font-black text-slate-800">{expectedStock.length}</div>
               </div>
               <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-200 flex flex-col items-center justify-center">
                  <div className="text-[10px] font-black uppercase text-emerald-600 tracking-widest mb-1 flex items-center gap-1"><CheckCircle2 size={14}/> เจอแล้ว (Matched)</div>
                  <div className="text-4xl font-black text-emerald-600">{auditStats.matched.length}</div>
               </div>
               <div className={`p-5 rounded-2xl border flex flex-col items-center justify-center transition-colors ${auditStats.missing.length > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1 ${auditStats.missing.length > 0 ? 'text-red-500' : 'text-slate-400'}`}><AlertOctagon size={14}/> ยังไม่เจอ (Missing)</div>
                  <div className={`text-4xl font-black ${auditStats.missing.length > 0 ? 'text-red-600' : 'text-slate-300'}`}>{auditStats.missing.length}</div>
               </div>
               <div className={`p-5 rounded-2xl border flex flex-col items-center justify-center transition-colors ${auditStats.extra.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1 ${auditStats.extra.length > 0 ? 'text-orange-500' : 'text-slate-400'}`}><HelpCircle size={14}/> ของเกิน (Unexpected)</div>
                  <div className={`text-4xl font-black ${auditStats.extra.length > 0 ? 'text-orange-600' : 'text-slate-300'}`}>{auditStats.extra.length}</div>
               </div>
            </div>

            {/* รายละเอียด Lists */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               
               {/* คอลัมน์ของที่หาย */}
               <div className="bg-white rounded-[2rem] border border-red-200 overflow-hidden shadow-sm">
                  <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                     <h4 className="font-black text-red-600 text-xs uppercase tracking-widest flex items-center gap-2"><AlertOctagon size={16}/> ของหาย ({auditStats.missing.length})</h4>
                  </div>
                  <div className="p-2 h-[400px] overflow-y-auto space-y-2">
                     {auditStats.missing.length === 0 ? <div className="text-center p-10 text-slate-300 font-bold">ไม่มีของหาย</div> : 
                        auditStats.missing.map((item, idx) => (
                           <div key={idx} className="p-3 bg-white border border-slate-100 rounded-xl">
                              <div className="font-bold text-slate-800 text-sm truncate">{item.model}</div>
                              <div className="text-[10px] font-mono font-bold text-red-500 mt-1">IMEI: {item.imei || item.serial || item.code}</div>
                           </div>
                        ))
                     }
                  </div>
               </div>

               {/* คอลัมน์ของเกิน (หลงมา) */}
               <div className="bg-white rounded-[2rem] border border-orange-200 overflow-hidden shadow-sm">
                  <div className="bg-orange-50 p-4 border-b border-orange-100 flex justify-between items-center">
                     <h4 className="font-black text-orange-600 text-xs uppercase tracking-widest flex items-center gap-2"><HelpCircle size={16}/> ของเกิน / ไม่ได้อยู่ในระบบ ({auditStats.extra.length})</h4>
                  </div>
                  <div className="p-2 h-[400px] overflow-y-auto space-y-2">
                     {auditStats.extra.length === 0 ? <div className="text-center p-10 text-slate-300 font-bold">ไม่มีของเกิน</div> : 
                        auditStats.extra.map((code, idx) => (
                           <div key={idx} className="p-3 bg-orange-50 border border-orange-100 rounded-xl">
                              <div className="text-xs font-mono font-black text-orange-600">UNKNOWN: {code}</div>
                              <div className="text-[9px] text-orange-400 font-bold mt-1">อาจถูกขายไปแล้ว หรือยังไม่ได้บันทึกรับเข้า</div>
                           </div>
                        ))
                     }
                  </div>
               </div>

               {/* คอลัมน์ของที่หาเจอแล้ว */}
               <div className="bg-white rounded-[2rem] border border-emerald-200 overflow-hidden shadow-sm">
                  <div className="bg-emerald-50 p-4 border-b border-emerald-100 flex justify-between items-center">
                     <h4 className="font-black text-emerald-600 text-xs uppercase tracking-widest flex items-center gap-2"><CheckCircle2 size={16}/> เจอแล้ว ({auditStats.matched.length})</h4>
                  </div>
                  <div className="p-2 h-[400px] overflow-y-auto space-y-2">
                     {auditStats.matched.length === 0 ? <div className="text-center p-10 text-slate-300 font-bold">ยังไม่ได้สแกน</div> : 
                        auditStats.matched.map((item, idx) => (
                           <div key={idx} className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-center justify-between">
                              <div className="overflow-hidden">
                                 <div className="font-bold text-slate-800 text-sm truncate">{item.model}</div>
                                 <div className="text-[10px] font-mono font-bold text-emerald-600 mt-1">{item.imei || item.serial || item.code}</div>
                              </div>
                              <CheckCircle2 size={18} className="text-emerald-500 shrink-0"/>
                           </div>
                        ))
                     }
                  </div>
               </div>

            </div>

            {/* ปุ่มจบงาน */}
            <div className="flex justify-end gap-4 pt-4 border-t border-slate-200">
               <button onClick={() => {if(window.confirm('ยกเลิกการนับสต็อกรอบนี้? ข้อมูลสแกนจะหายทั้งหมด')) setIsAuditing(false)}} className="px-6 py-4 font-black uppercase text-slate-500 hover:bg-slate-100 rounded-2xl transition-colors text-sm">
                  ยกเลิก (Cancel)
               </button>
               <button onClick={handleFinishAudit} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black uppercase text-sm hover:bg-slate-800 transition-all flex items-center gap-2 shadow-xl shadow-slate-900/20">
                  <Save size={18}/> จบการนับ และบันทึกผล (Finish & Save)
               </button>
            </div>
         </div>
      ) : (
         /* 📋 โหมดดูประวัติ (Audit History) */
         <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
               <h3 className="font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <History size={18} className="text-slate-400"/> ประวัติการนับสต็อก (Audit Logs)
               </h3>
            </div>
            <table className="w-full text-left">
               <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                     <th className="p-5 pl-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">วันที่นับสต็อก</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">ผู้ตรวจนับ</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">สแกน/เป้าหมาย</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">ของหาย</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">ของเกิน</th>
                     <th className="p-5 pr-8 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">สถานะ</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {pastAudits.length === 0 ? (
                     <tr><td colSpan={6} className="p-10 text-center text-slate-400 font-bold italic">ยังไม่มีประวัติการนับสต็อก</td></tr>
                  ) : (
                     pastAudits.map(log => (
                        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                           <td className="p-5 pl-8">
                              <div className="font-black text-slate-800 text-sm">{new Date(log.date).toLocaleDateString('th-TH')}</div>
                              <div className="text-[10px] font-bold text-slate-400">{new Date(log.date).toLocaleTimeString('th-TH')} น.</div>
                           </td>
                           <td className="p-5 font-bold text-slate-600 text-sm">{log.auditor}</td>
                           <td className="p-5 text-center font-black text-blue-600 text-sm">
                              {log.total_scanned} / {log.total_expected}
                           </td>
                           <td className="p-5 text-center">
                              {log.total_missing > 0 ? <span className="text-red-600 font-black bg-red-50 px-2 py-1 rounded-md text-xs">{log.total_missing}</span> : <span className="text-slate-300">-</span>}
                           </td>
                           <td className="p-5 text-center">
                              {log.total_extra > 0 ? <span className="text-orange-600 font-black bg-orange-50 px-2 py-1 rounded-md text-xs">{log.total_extra}</span> : <span className="text-slate-300">-</span>}
                           </td>
                           <td className="p-5 pr-8 text-right">
                              {log.status === 'PERFECT' ? (
                                 <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase"><CheckCircle2 size={12}/> สมบูรณ์ (Perfect)</span>
                              ) : (
                                 <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase"><ShieldAlert size={12}/> พบปัญหา (Issues)</span>
                              )}
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