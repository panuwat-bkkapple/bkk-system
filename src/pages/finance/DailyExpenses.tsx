// src/pages/finance/DailyExpenses.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { ref, push, remove } from 'firebase/database';
import { db } from '../../api/firebase';
import { 
  ReceiptText, Truck, Coffee, Megaphone, HelpCircle, 
  Plus, Trash2, Calendar, Banknote, ShieldAlert
} from 'lucide-react';

const EXPENSE_CATEGORIES = [
  { id: 'TRANSPORT', label: 'ค่าส่ง/เดินทาง (Transport)', icon: <Truck size={18}/>, color: 'text-blue-500 bg-blue-50 border-blue-200' },
  { id: 'SUPPLIES', label: 'ของใช้ในร้าน (Supplies)', icon: <Coffee size={18}/>, color: 'text-emerald-500 bg-emerald-50 border-emerald-200' },
  { id: 'MARKETING', label: 'ค่าโฆษณา (Marketing)', icon: <Megaphone size={18}/>, color: 'text-purple-500 bg-purple-50 border-purple-200' },
  { id: 'MISC', label: 'จิปาถะ (Misc)', icon: <HelpCircle size={18}/>, color: 'text-orange-500 bg-orange-50 border-orange-200' },
];

export const DailyExpenses = () => {
  const { currentUser, hasAccess } = useAuth();
  const { data: expenses, loading } = useDatabase('expenses');
  
  const [filterDate, setFilterDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [formData, setFormData] = useState({
    title: '',
    amount: '',
    category: 'MISC',
    note: ''
  });

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.amount) return alert('กรุณากรอกชื่อรายการและจำนวนเงิน');
    if (Number(formData.amount) <= 0) return alert('จำนวนเงินต้องมากกว่า 0');

    try {
      await push(ref(db, 'expenses'), {
        title: formData.title,
        amount: Number(formData.amount),
        category: formData.category,
        note: formData.note,
        created_at: Date.now(),
        logged_by: currentUser?.name || 'Admin',
      });

      // รีเซ็ตฟอร์ม
      setFormData({ title: '', amount: '', category: 'MISC', note: '' });
    } catch (error) {
      alert('เกิดข้อผิดพลาด: ' + error);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (window.confirm(`⚠️ ยืนยันการลบรายการเบิกจ่าย: "${title}" ใช่หรือไม่?`)) {
      await remove(ref(db, `expenses/${id}`));
    }
  };

  // 🧠 กรองรายการและคำนวณยอดรวมของวันที่เลือก
  const filteredData = useMemo(() => {
    if (!expenses) return { list: [], total: 0 };
    
    const allExpenses = Array.isArray(expenses) ? expenses : Object.keys(expenses).map(k => ({ id: k, ...(expenses as any)[k] }));
    
    // ตั้งค่าเวลาเริ่มต้นและสิ้นสุดของวันที่เลือก
    const selectedDate = new Date(filterDate);
    const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0)).getTime();
    const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999)).getTime();

    const list = allExpenses
       .filter(exp => exp.created_at >= startOfDay && exp.created_at <= endOfDay)
       .sort((a, b) => b.created_at - a.created_at);

    const total = list.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);

    return { list, total };
  }, [expenses, filterDate]);

  if (loading) return <div className="p-10 text-center font-bold text-slate-400">Loading Expense Records...</div>;

  return (
    <div className="p-8 space-y-6 bg-[#F5F7FA] min-h-screen font-sans text-slate-800">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2">
            <ReceiptText className="text-red-500"/> Petty Cash & Expenses
          </h2>
          <p className="text-sm text-slate-500 font-bold mt-1">ระบบบันทึกเบิกเงินเก๊ะและรายจ่ายจิปาถะรายวัน</p>
        </div>
        
        {/* ตัวเลือกวันที่ */}
        <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
           <Calendar size={18} className="text-slate-400"/>
           <input 
              type="date" 
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="bg-transparent font-black text-slate-700 outline-none cursor-pointer"
           />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         
         {/* LEFT: ฟอร์มบันทึกรายจ่าย */}
         <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-bl-full -z-10"></div>
               <h3 className="font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
                  <Plus size={18} className="text-red-500"/> บันทึกรายจ่ายใหม่
               </h3>

               <form onSubmit={handleSaveExpense} className="space-y-4">
                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">รายการ (Title)</label>
                     <input required type="text" value={formData.title} onChange={e=>setFormData({...formData, title: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-red-500" placeholder="เช่น ค่าไปรษณีย์ส่งของให้ลูกค้า..."/>
                  </div>
                  
                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">จำนวนเงินที่หยิบจากเก๊ะ (Amount)</label>
                     <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-400">฿</span>
                        <input required type="number" value={formData.amount} onChange={e=>setFormData({...formData, amount: e.target.value})} className="w-full bg-slate-50 border border-slate-200 pl-10 pr-4 py-3 rounded-xl font-black text-lg outline-none focus:border-red-500 text-red-600" placeholder="0.00"/>
                     </div>
                  </div>

                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">หมวดหมู่ (Category)</label>
                     <div className="grid grid-cols-2 gap-2">
                        {EXPENSE_CATEGORIES.map(cat => (
                           <label key={cat.id} className={`p-3 rounded-xl border-2 flex flex-col items-center gap-2 cursor-pointer transition-all text-center ${formData.category === cat.id ? `border-red-500 bg-red-50 text-red-600` : `border-slate-100 bg-white text-slate-500 hover:border-slate-300`}`}>
                              <input type="radio" name="category" value={cat.id} checked={formData.category === cat.id} onChange={e=>setFormData({...formData, category: e.target.value})} className="hidden" />
                              {cat.icon}
                              <span className="text-[9px] font-black uppercase leading-tight">{cat.label}</span>
                           </label>
                        ))}
                     </div>
                  </div>

                  <div>
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">หมายเหตุ (ถ้ามี)</label>
                     <input type="text" value={formData.note} onChange={e=>setFormData({...formData, note: e.target.value})} className="w-full bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl font-bold outline-none focus:border-red-500 text-sm" placeholder="คำอธิบายเพิ่มเติม..."/>
                  </div>

                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase text-sm hover:bg-slate-800 transition-colors shadow-lg mt-2">
                     บันทึกรายจ่าย
                  </button>
               </form>
            </div>
         </div>

         {/* RIGHT: สรุปและประวัติรายจ่าย */}
         <div className="lg:col-span-2 space-y-6">
            
            {/* KPI สรุปยอดเงินไหลออก */}
            <div className="bg-red-50 p-6 rounded-[2rem] border border-red-100 flex items-center justify-between">
               <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-1 flex items-center gap-1">
                     <Banknote size={14}/> รวมเงินออกจากเก๊ะ (Total Expenses)
                  </div>
                  <div className="text-xs font-bold text-red-400">ของวันที่ {new Date(filterDate).toLocaleDateString('th-TH')}</div>
               </div>
               <div className="text-4xl font-black text-red-600 tracking-tighter">
                  ฿{filteredData.total.toLocaleString()}
               </div>
            </div>

            {/* ตารางประวัติ */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
               <div className="p-5 border-b border-slate-100 bg-slate-50">
                  <h3 className="font-black text-slate-800 uppercase tracking-widest text-sm">ประวัติการเบิกจ่าย (Expense Log)</h3>
               </div>
               <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100">
                     <tr>
                        <th className="p-4 pl-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">เวลา</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">รายการ</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">หมวดหมู่</th>
                        <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">จำนวนเงิน</th>
                        {/* โชว์คอลัมน์ลบ เฉพาะ CEO/Manager */}
                        {hasAccess(['CEO', 'MANAGER']) && <th className="p-4 pr-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">ลบ</th>}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                     {filteredData.list.length === 0 ? (
                        <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold italic">ไม่พบรายการเบิกจ่ายในวันนี้</td></tr>
                     ) : (
                        filteredData.list.map(exp => {
                           const catDef = EXPENSE_CATEGORIES.find(c => c.id === exp.category) || EXPENSE_CATEGORIES[3];
                           return (
                              <tr key={exp.id} className="hover:bg-slate-50 transition-colors">
                                 <td className="p-4 pl-6 text-xs font-bold text-slate-500">
                                    {new Date(exp.created_at).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})} น.
                                 </td>
                                 <td className="p-4">
                                    <div className="font-bold text-slate-800 text-sm">{exp.title}</div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">เบิกโดย: {exp.logged_by} {exp.note && `• ${exp.note}`}</div>
                                 </td>
                                 <td className="p-4">
                                    <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase border flex items-center gap-1 w-fit ${catDef.color}`}>
                                       {catDef.icon} {catDef.id}
                                    </span>
                                 </td>
                                 <td className="p-4 text-right">
                                    <div className="font-black text-red-600 text-sm">-฿{Number(exp.amount).toLocaleString()}</div>
                                 </td>
                                 
                                 {/* ปุ่มลบ (Micro-Permission: ซ่อนจาก Cashier) */}
                                 {hasAccess(['CEO', 'MANAGER']) && (
                                    <td className="p-4 pr-6 text-right">
                                       <button onClick={() => handleDelete(exp.id, exp.title)} className="p-2 text-slate-300 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors">
                                          <Trash2 size={16}/>
                                       </button>
                                    </td>
                                 )}
                              </tr>
                           );
                        })
                     )}
                  </tbody>
               </table>
            </div>
         </div>

      </div>
    </div>
  );
};