import React, { useState, useMemo, useEffect } from 'react';
import { useDatabase } from "@/hooks/useDatabase";
import { ref, update } from "firebase/database";
import { db } from "@/api/firebase";
import { 
  ScanLine, CheckCircle2, AlertCircle, Building2, 
  Smartphone, Plus, Save, X, Trash2, Calculator,
  ClipboardCheck, AlertTriangle
} from 'lucide-react';

export const B2BAuditorTool = () => {
  const { data: jobs, loading } = useDatabase('jobs');
  const { data: basePricing } = useDatabase('base_pricing');

  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [imei, setImei] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [grade, setGrade] = useState<'A' | 'B' | 'C' | 'Reject'>('A');
  const [unitPrice, setUnitPrice] = useState<number>(0);

  const activeB2BJobs = useMemo(() => {
    if (!jobs) return [];
    return (jobs as any[]).filter(j => j.type === 'B2B Trade-in' && ['New B2B Lead', 'Pre-Quote Sent', 'Site Visit & Grading'].includes(j.status));
  }, [jobs]);

  const currentJob = activeB2BJobs.find(j => j.id === selectedJobId);
  const gradedItems: any[] = currentJob?.graded_items || [];
  const expectedItems: any[] = currentJob?.expected_items || []; // 🌟 ดึงโพยที่แอดมินสร้างไว้

  // 🔥 ระบบ Auto-Pricing (ดึง basePrice และคำนวณหัก % ตามเกรด)
  useEffect(() => {
    if (!selectedModel || grade === 'Reject') {
      setUnitPrice(0);
      return;
    }
    const product = (basePricing as any[])?.find(p => {
      const displayName = `${p.model || p.name} ${p.capacity || p.storage || ''}`.trim();
      return displayName === selectedModel;
    });
    
    if (product) {
      const base = Number(product.basePrice || product.base_price || product.price || 0);
      let targetPrice = 0;
      if (grade === 'A') targetPrice = base; 
      else if (grade === 'B') targetPrice = base * 0.85; 
      else if (grade === 'C') targetPrice = base * 0.70; 
      
      setUnitPrice(Math.round(targetPrice / 10) * 10); 
    }
  }, [selectedModel, grade, basePricing]);

  const handleAddItem = async () => {
    if (!selectedJobId) return alert('กรุณาเลือกล็อตงาน B2B ก่อนครับ');
    if (!imei || !selectedModel) return alert('กรุณากรอก IMEI และเลือกรุ่น');

    const newItem = {
      id: Date.now().toString(),
      imei,
      model: selectedModel,
      grade,
      price: grade === 'Reject' ? 0 : unitPrice,
      timestamp: Date.now()
    };

    const updatedItems: any[] = [newItem, ...gradedItems];
    const totalQty = updatedItems.filter((i) => i.grade !== 'Reject').length;
    const totalPrice = updatedItems.reduce((sum: number, item: any) => sum + Number(item.price), 0);

    await update(ref(db, `jobs/${selectedJobId}`), {
      graded_items: updatedItems,
      price: totalPrice,
      summary: { total_qty: totalQty, total_price: totalPrice },
      status: 'Site Visit & Grading'
    });

    setImei('');
    document.getElementById('imei-input')?.focus();
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!confirm('ต้องการลบรายการนี้ใช่หรือไม่?')) return;
    const updatedItems: any[] = gradedItems.filter((i) => i.id !== itemId);
    const totalQty = updatedItems.filter((i) => i.grade !== 'Reject').length;
    const totalPrice = updatedItems.reduce((sum: number, item: any) => sum + Number(item.price), 0);

    await update(ref(db, `jobs/${selectedJobId}`), {
      graded_items: updatedItems,
      price: totalPrice,
      summary: { total_qty: totalQty, total_price: totalPrice }
    });
  };

  // 📊 คำนวณความคืบหน้าการกระทบยอด (Reconciliation Logic)
  const reconciliation = expectedItems.map(exp => {
    const scannedCount = gradedItems.filter(item => item.model === exp.model && item.grade !== 'Reject').length;
    return {
      ...exp,
      scannedCount,
      isComplete: scannedCount >= exp.qty,
      isOver: scannedCount > exp.qty
    };
  });

  // ⚠️ ค้นหาเครื่องที่สแกนเข้ามาแต่ "ไม่มีในโพย" (Unexpected Items)
  const unexpectedItems = gradedItems.filter(item => item.grade !== 'Reject' && !expectedItems.some(exp => exp.model === item.model));
  const unexpectedSummary = unexpectedItems.reduce((acc: any, item: any) => {
    acc[item.model] = (acc[item.model] || 0) + 1;
    return acc;
  }, {});

  const gradeSummary = {
    A: gradedItems.filter((i) => i.grade === 'A').length,
    B: gradedItems.filter((i) => i.grade === 'B').length,
    C: gradedItems.filter((i) => i.grade === 'C').length,
    Reject: gradedItems.filter((i) => i.grade === 'Reject').length,
  };

  if (loading) return <div className="p-10 text-center font-bold text-slate-400">Loading Auditor System...</div>;

  return (
    <div className="bg-slate-50 min-h-screen p-6 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black tracking-tighter flex items-center gap-3">
              <ScanLine size={28} className="text-blue-400"/> B2B On-Site Auditor
            </h1>
            <p className="text-slate-400 text-sm font-bold mt-1">เครื่องมือคีย์ข้อมูลประเมินทรัพย์สินหน้างาน</p>
          </div>
          
          <select 
            value={selectedJobId} 
            onChange={(e) => setSelectedJobId(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 font-bold outline-none focus:ring-2 focus:ring-blue-500 w-72"
          >
            <option value="">-- เลือกล็อตงานที่กำลังประเมิน --</option>
            {activeB2BJobs.map(job => (
              <option key={job.id} value={job.id}>{job.cust_name.split('(')[0]} ({job.ref_no})</option>
            ))}
          </select>
        </div>

        {currentJob ? (
          <div className="grid grid-cols-12 gap-6">
            
            {/* ⬅️ ฝั่งซ้าย: Fast Entry Form */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200">
                <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><Smartphone size={14}/> Fast Entry Form</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1">เลข IMEI / S/N</label>
                    <input id="imei-input" type="text" value={imei} onChange={(e) => setImei(e.target.value)} placeholder="ยิงบาร์โค้ด หรือพิมพ์ IMEI..." className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-black text-slate-800 outline-none focus:border-blue-500 transition-all" autoFocus />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1">รุ่นอุปกรณ์ (Model)</label>
                    <select 
                      value={selectedModel} 
                      onChange={(e) => setSelectedModel(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500 transition-all cursor-pointer"
                    >
                      <option value="">-- เลือกรุ่นและความจุ --</option>
                      {(basePricing as any[])?.map((p: any) => {
                        const displayName = `${p.model || p.name} ${p.capacity || p.storage || ''}`.trim();
                        return <option key={p.id} value={displayName}>{displayName}</option>;
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1">เกรดสภาพ (Condition Grade)</label>
                    <div className="grid grid-cols-4 gap-2">
                      {['A', 'B', 'C', 'Reject'].map(g => (
                        <button 
                          key={g} 
                          onClick={() => setGrade(g as any)}
                          className={`py-3 rounded-xl font-black text-sm transition-all ${grade === g ? (g === 'Reject' ? 'bg-red-500 text-white' : 'bg-blue-600 text-white') : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  {grade !== 'Reject' && (
                    <div className="animate-in fade-in slide-in-from-top-2">
                      <label className="text-xs font-bold text-slate-500 block mb-1">ราคาประเมินต่อเครื่อง (Unit Price)</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
                        <input type="number" value={unitPrice || ''} onChange={(e) => setUnitPrice(Number(e.target.value))} placeholder="0" className="w-full bg-emerald-50 border border-emerald-100 pl-8 p-3 rounded-xl font-black text-emerald-600 outline-none focus:border-emerald-500 transition-all" />
                      </div>
                    </div>
                  )}

                  <button onClick={handleAddItem} className="w-full bg-slate-900 text-white py-4 rounded-xl font-black text-sm uppercase flex justify-center items-center gap-2 hover:bg-black transition-all shadow-lg mt-2">
                    <Plus size={18} /> บันทึกเข้ารายการ (Add Item)
                  </button>
                </div>
              </div>

              {/* Summary Box */}
              <div className="bg-blue-600 text-white p-6 rounded-[2rem] shadow-lg shadow-blue-200">
                <div className="text-[10px] font-black uppercase tracking-widest text-blue-200 mb-1">Live Summary (ยอดรวมหน้างาน)</div>
                <div className="text-4xl font-black tracking-tighter mb-4">฿{(currentJob.summary?.total_price || 0).toLocaleString()}</div>
                
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-white/10 p-2 rounded-xl"><div className="text-[10px] font-bold text-blue-200">Grade A</div><div className="font-black">{gradeSummary.A}</div></div>
                  <div className="bg-white/10 p-2 rounded-xl"><div className="text-[10px] font-bold text-blue-200">Grade B</div><div className="font-black">{gradeSummary.B}</div></div>
                  <div className="bg-white/10 p-2 rounded-xl"><div className="text-[10px] font-bold text-blue-200">Grade C</div><div className="font-black">{gradeSummary.C}</div></div>
                  <div className="bg-red-500/80 p-2 rounded-xl"><div className="text-[10px] font-bold text-red-100">Reject</div><div className="font-black">{gradeSummary.Reject}</div></div>
                </div>
              </div>
            </div>

            {/* ➡️ ฝั่งขวา: Checklist & Scanned Items */}
            <div className="col-span-12 lg:col-span-8 flex flex-col gap-6">
              
              {/* 📋 ส่วนใหม่: Reconciliation Checklist (รายการคาดหวังจากแอดมิน) */}
              {expectedItems.length > 0 && (
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 shrink-0">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                    <ClipboardCheck size={14}/> Baseline Checklist (กระทบยอดตามโพยจัดซื้อ)
                  </h3>
                  
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {reconciliation.map((item: any) => (
                      <div key={item.id} className={`p-4 rounded-xl border transition-all ${item.isComplete ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-bold text-sm text-slate-800 line-clamp-1" title={item.model}>{item.model}</span>
                          <span className={`text-xs font-black shrink-0 ml-2 ${item.isComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {item.scannedCount} / {item.qty}
                          </span>
                        </div>
                        <div className="w-full bg-white/50 rounded-full h-1.5 mb-1 overflow-hidden">
                          <div 
                            className={`h-1.5 rounded-full transition-all duration-500 ${item.isOver ? 'bg-red-500' : item.isComplete ? 'bg-emerald-500' : 'bg-amber-500'}`} 
                            style={{ width: `${Math.min((item.scannedCount / item.qty) * 100, 100)}%` }}
                          ></div>
                        </div>
                        {item.isOver && <div className="text-[9px] text-red-500 font-bold uppercase mt-1 flex items-center gap-1"><AlertTriangle size={10}/> เกินโพย (+{item.scannedCount - item.qty})</div>}
                        {item.isComplete && !item.isOver && <div className="text-[9px] text-emerald-600 font-bold uppercase mt-1 flex items-center gap-1"><CheckCircle2 size={10}/> ครบถ้วน</div>}
                      </div>
                    ))}
                  </div>

                  {/* 🚨 แจ้งเตือนของงอก (Unexpected Items) */}
                  {Object.keys(unexpectedSummary).length > 0 && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl animate-in fade-in">
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-widest block mb-2 flex items-center gap-1">
                        <AlertCircle size={12}/> Unexpected Items (สินค้านอกโพย / สแกนผิดรุ่น)
                      </span>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(unexpectedSummary).map(([model, count]) => (
                          <span key={model} className="bg-white text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">
                            {model} : <span className="font-black">{count as number}</span> เครื่อง
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 📋 ตารางสแกนเดิม */}
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 h-[50vh]">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                  <div>
                    <h2 className="text-lg font-black text-slate-800">รายการทรัพย์สิน ({gradedItems.length} เครื่อง)</h2>
                    <p className="text-xs font-bold text-slate-500">บริษัท: {currentJob.cust_name}</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 no-scrollbar">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white shadow-sm z-10">
                      <tr>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">IMEI / S/N</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Model</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Grade</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Price</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {gradedItems.length === 0 ? (
                        <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold">ยังไม่มีรายการสแกนอุปกรณ์</td></tr>
                      ) : (
                        gradedItems.map((item: any) => (
                          <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-4 font-mono text-xs font-bold text-slate-600">{item.imei}</td>
                            <td className="p-4 font-bold text-sm text-slate-800">{item.model}</td>
                            <td className="p-4 text-center">
                              <span className={`px-3 py-1 rounded-lg text-xs font-black ${item.grade === 'A' ? 'bg-emerald-100 text-emerald-700' : item.grade === 'B' ? 'bg-blue-100 text-blue-700' : item.grade === 'C' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                                {item.grade}
                              </span>
                            </td>
                            <td className="p-4 text-right font-black text-slate-800">{item.grade === 'Reject' ? '-' : `฿${item.price.toLocaleString()}`}</td>
                            <td className="p-4 text-center">
                              <button onClick={() => handleRemoveItem(item.id)} className="text-slate-300 hover:text-red-500 transition-colors p-2"><Trash2 size={16}/></button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-20 text-center">
            <Building2 size={64} className="mx-auto text-slate-200 mb-4"/>
            <h2 className="text-xl font-black text-slate-400">กรุณาเลือกล็อตงานที่ต้องการประเมินจากเมนูด้านบน</h2>
            <p className="text-slate-400 text-sm mt-2">แสดงเฉพาะรายการที่อยู่ในสถานะ Site Visit หรือ Pre-Quote เท่านั้น</p>
          </div>
        )}

      </div>
    </div>
  );
};