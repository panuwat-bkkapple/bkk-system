// src/pages/Evaluation.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { formatCurrency } from '../../utils/formatters';
import { 
  ClipboardCheck, Search, CheckCircle2, AlertTriangle, 
  Save, X, Calculator 
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';

const GRADES = [
  { id: 'A', label: 'Grade A (นางฟ้า / ไร้รอย)', multiplier: 1.0, color: 'bg-green-50 text-green-700 border-green-200' },
  { id: 'B', label: 'Grade B (รอยขนแมวเล็กน้อย)', multiplier: 0.90, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'C', label: 'Grade C (รอยตก / บุบ)', multiplier: 0.70, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'D', label: 'Grade D (จอแตก / เปิดไม่ติด)', multiplier: 0.10, color: 'bg-red-50 text-red-700 border-red-200' },
];

// ✅ แก้ไขบรรทัดนี้: เปลี่ยน (page: string) เป็น (page: any) เพื่อแก้ Error ใน App.tsx
export const Evaluation = ({ onNavigate }: { onNavigate?: (page: any) => void }) => {
  const { data: jobs, loading } = useDatabase('jobs');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJob, setSelectedJob] = useState<any>(null);
  
  const [selectedGrade, setSelectedGrade] = useState<string>('A');
  const [note, setNote] = useState('');

  const pendingJobs = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    return list.filter(j => 
      j.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      j.ref_no?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [jobs, searchTerm]);

  // ✅ แก้ไข Logic: ป้องกัน Error "Object is possibly undefined"
  const currentGradeObj = GRADES.find(g => g.id === selectedGrade) || GRADES[0];
  const newPrice = selectedJob ? Math.floor(Number(selectedJob.price) * currentGradeObj.multiplier) : 0;

  const handleSaveEvaluation = async () => {
    if (!selectedJob) return;
    try {
      if(!confirm(`ยืนยันการประเมินราคาใหม่เป็น ${formatCurrency(newPrice)}?`)) return;

      await update(ref(db, `jobs/${selectedJob.id}`), {
        status: 'Revised Offer',
        final_price: newPrice,
        grade: selectedGrade,
        evaluation_note: note,
        evaluated_at: Date.now(),
        // ✅ ใช้ currentGradeObj ที่ปลอดภัยแล้ว
        conditions: `ประเมินจากระบบ: Grade ${selectedGrade} (${currentGradeObj.multiplier * 100}%)` 
      });

      alert('บันทึกผลการประเมินเรียบร้อย');
      setSelectedJob(null);
      setNote('');
      if (onNavigate) onNavigate('tradein_dash'); 
    } catch (e) {
      alert('Error: ' + e);
    }
  };

  if (loading) return <div className="p-10 text-center text-gray-400">Loading Evaluation...</div>;

  return (
    <div className="p-8 bg-[#F9FBFC] min-h-screen space-y-6">
      <div className="flex justify-between items-center">
        <div>
           <h2 className="text-2xl font-black text-gray-800 uppercase tracking-tight">Evaluation Center</h2>
           <p className="text-sm text-gray-500">ประเมินสภาพและตัดเกรดสินค้า (Re-grading)</p>
        </div>
      </div>

      <div className="relative">
         <Search className="absolute left-4 top-3.5 text-gray-400" size={20}/>
         <input 
           type="text" 
           placeholder="ค้นหาตามรุ่น หรือ Ref No..." 
           value={searchTerm}
           onChange={e => setSearchTerm(e.target.value)}
           className="w-full pl-12 pr-4 py-4 bg-white border border-gray-100 rounded-2xl shadow-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
         />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
           {pendingJobs.map(job => (
             <div 
               key={job.id} 
               onClick={() => { setSelectedJob(job); setSelectedGrade('A'); }}
               className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                 selectedJob?.id === job.id 
                 ? 'bg-blue-600 text-white shadow-xl shadow-blue-200 border-blue-600' 
                 : 'bg-white hover:bg-gray-50 border-gray-100'
               }`}
             >
               <div className="flex justify-between items-start mb-2">
                 <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                    selectedJob?.id === job.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                 }`}>{job.ref_no}</span>
                 <span className="text-[10px] opacity-70">{new Date(job.created_at).toLocaleDateString()}</span>
               </div>
               <div className="font-bold text-lg mb-1">{job.model}</div>
               <div className={`text-sm ${selectedJob?.id === job.id ? 'text-blue-100' : 'text-gray-500'}`}>
                 ราคาประเมินแรก: {formatCurrency(job.price)}
               </div>
             </div>
           ))}
        </div>

        <div className="lg:col-span-2">
          {selectedJob ? (
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-gray-100 border border-gray-100 sticky top-8">
               <div className="flex justify-between items-start mb-8">
                 <div>
                   <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">กำลังประเมิน</div>
                   <h2 className="text-3xl font-black text-gray-800">{selectedJob.model}</h2>
                 </div>
                 <button onClick={() => setSelectedJob(null)} className="p-2 hover:bg-gray-100 rounded-full"><X/></button>
               </div>

               <div className="flex gap-4 mb-8">
                 <div className="flex-1 bg-gray-50 p-6 rounded-3xl border border-gray-100">
                    <div className="text-xs font-bold text-gray-400 uppercase">ราคาเดิม (Initial)</div>
                    <div className="text-2xl font-black text-gray-500 line-through">{formatCurrency(selectedJob.price)}</div>
                 </div>
                 <div className="flex-1 bg-blue-50 p-6 rounded-3xl border border-blue-100 relative overflow-hidden">
                    <div className="relative z-10">
                      <div className="text-xs font-bold text-blue-500 uppercase">ราคาหลังตัดเกรด (Final)</div>
                      <div className="text-4xl font-black text-blue-600">{formatCurrency(newPrice)}</div>
                    </div>
                    <Calculator className="absolute -right-4 -bottom-4 text-blue-200 opacity-50" size={80} />
                 </div>
               </div>

               <div className="mb-8">
                 <label className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 block">เลือกเกรดสภาพเครื่อง</label>
                 <div className="grid grid-cols-2 gap-3">
                   {GRADES.map(grade => (
                     <button
                       key={grade.id}
                       onClick={() => setSelectedGrade(grade.id)}
                       className={`p-4 rounded-2xl border-2 text-left transition-all ${
                         selectedGrade === grade.id 
                         ? `${grade.color} border-current ring-4 ring-gray-100` 
                         : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                       }`}
                     >
                       <div className="flex justify-between items-center">
                         <span className="font-black text-xl">Grade {grade.id}</span>
                         {selectedGrade === grade.id && <CheckCircle2 size={24}/>}
                       </div>
                       <div className="text-xs font-bold opacity-80 mt-1">{grade.label}</div>
                       <div className="text-[10px] font-black mt-2 bg-white/50 w-fit px-2 py-0.5 rounded">
                         คิด {grade.multiplier * 100}% ของราคา
                       </div>
                     </button>
                   ))}
                 </div>
                 
                 {/* ✅ ใช้ currentGradeObj แทนการ .find() ซ้ำ เพื่อความปลอดภัย */}
                 <p className="text-[10px] font-medium italic text-gray-400 mt-3 text-right">
                    Calculated based on {currentGradeObj.label} ({currentGradeObj.multiplier * 100}% of Base Price)
                 </p>
               </div>

               <div className="mb-8">
                 <label className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 block">หมายเหตุเพิ่มเติม (Internal Note)</label>
                 <textarea 
                   value={note}
                   onChange={e => setNote(e.target.value)}
                   placeholder="เช่น มีรอยขีดข่วนที่ขอบมุมขวา, แบตเตอรี่เสื่อม..."
                   className="w-full p-4 bg-gray-50 border-none rounded-2xl font-medium text-gray-700 h-24 resize-none outline-none focus:ring-2 focus:ring-blue-100"
                 />
               </div>

               <button 
                 onClick={handleSaveEvaluation}
                 className="w-full bg-black text-white py-5 rounded-2xl font-black text-lg shadow-xl hover:bg-gray-800 transition-all flex items-center justify-center gap-3"
               >
                 <Save size={20} /> บันทึกราคาประเมินใหม่
               </button>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-300 border-2 border-dashed border-gray-200 rounded-[2.5rem] min-h-[400px]">
               <ClipboardCheck size={64} className="mb-4 text-gray-200"/>
               <div className="font-bold text-lg">เลือกรายการทางซ้าย</div>
               <div className="text-sm">เพื่อเริ่มประเมินสภาพและตัดเกรด</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};