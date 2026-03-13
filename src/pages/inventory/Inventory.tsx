// src/pages/Inventory.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { formatDate } from '../../utils/formatters';
import {
  Package, Search, DollarSign, TrendingUp,
  Clock, Tag, Barcode, CheckCircle2, Save, Smartphone,
  ShoppingCart, ListFilter, X
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { useAuth } from '../../hooks/useAuth';

export const Inventory = () => {
  const toast = useToast();
  const { data: jobs, loading } = useDatabase('jobs');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'instock' | 'ready'>('instock');
  const { hasAccess } = useAuth();
  
  // Modal สำหรับแก้ไขข้อมูลก่อนขึ้นขาย
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ 
     selling_price: 0, 
     promo_price: 0, 
     status: '', 
     accessories: 'เครื่องเปล่า',
     warranty_days: 30
  });

  // 🧠 Logic: ดึงเฉพาะงานที่เกี่ยวกับคลัง
  const inventoryItems = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    const filtered = list.filter(j => 
      // 🛑 1. เตะ "งานแม่ B2B" (Bulk Assets) ทิ้งไปเลย ห้ามโชว์ในหน้าคลังเด็ดขาด!
      j.type !== 'B2B Trade-in' && 
      // 🛑 เผื่อไว้: ไม่เอางานเบิกเงินของไรเดอร์มาปนด้วย
      j.type !== 'Withdrawal' &&

      // 🟢 2. ดึงเฉพาะเครื่องที่มีสถานะอยู่ในคลังเท่านั้น
      ['In Stock', 'Ready to Sell', 'Reserved'].includes(j.status) &&
      (
        j.model?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        j.ref_no?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        j.serial?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    ).sort((a,b) => (b.qc_date || 0) - (a.qc_date || 0)); 
    
    if (activeTab === 'instock') return filtered.filter(j => j.status === 'In Stock');
    if (activeTab === 'ready') return filtered.filter(j => j.status === 'Ready to Sell');
    return filtered; // 'all'
  }, [jobs, searchTerm, activeTab]);

  const stats = useMemo(() => {
    const list = Array.isArray(jobs) ? jobs : [];
    
    // 🌟 คิดเฉพาะเครื่องเดี่ยว (B2C) และเครื่องลูก (B2B-Unpacked)
    // 🛑 และต้องตัดงานแม่ (B2B Trade-in) กับรายการถอนเงิน (Withdrawal) ออกไป
    const currentStock = list.filter(j => 
      ['In Stock', 'Ready to Sell', 'Reserved'].includes(j.status) &&
      j.type !== 'B2B Trade-in' &&
      j.type !== 'Withdrawal'
    );
    
    const totalItems = currentStock.length;
    const totalCost = currentStock.reduce((sum, item) => sum + (Number(item.final_price) || Number(item.price) || 0), 0); 
    const totalSellingValue = currentStock.reduce((sum, item) => sum + (Number(item.selling_price) || 0), 0);
    const potentialProfit = totalSellingValue - totalCost;

    return { totalItems, totalCost, potentialProfit };
  }, [jobs]);

  const getStockAge = (qcDate: number) => {
    if (!qcDate) return 0;
    const diffDays = Math.ceil(Math.abs(Date.now() - qcDate) / (1000 * 60 * 60 * 24)); 
    return diffDays;
  };

  const getAgingColor = (days: number) => {
    if (days <= 14) return 'bg-green-100 text-green-700'; 
    if (days <= 30) return 'bg-yellow-100 text-yellow-700'; 
    return 'bg-red-100 text-red-700'; 
  };

  const handleEditClick = (item: any) => {
    setEditingItem(item);
    setEditForm({ 
       selling_price: item.selling_price || 0, 
       promo_price: item.promo_price || 0,
       status: item.status,
       accessories: item.accessories || 'เครื่องเปล่า',
       warranty_days: item.warranty_days || 30
    });
  };

  const handleSavePricing = async () => {
    if (!editingItem) return;
    try {
      await update(ref(db, `jobs/${editingItem.id}`), {
        selling_price: Number(editForm.selling_price),
        promo_price: Number(editForm.promo_price),
        status: editForm.status,
        accessories: editForm.accessories,
        warranty_days: Number(editForm.warranty_days),
        updated_at: Date.now()
      });
      setEditingItem(null);
    } catch (e) { toast.error('Update failed'); }
  };

  // 🔥 ส่งข้อมูลไปยัง POS (อัปเดตสถานะเป็น Ready to Sell)
  const handlePushToPOS = async (id: string) => {
    if(!confirm('ยืนยันส่งสินค้านี้ขึ้นระบบหน้าร้าน (POS) ใช่หรือไม่?')) return;
    try {
      await update(ref(db, `jobs/${id}`), {
          status: 'Ready to Sell',
          listed_at: Date.now()
      });
    } catch (error) {
      toast.error('ส่งสินค้าขึ้น POS ไม่สำเร็จ');
    }
  };

  // 🔥 กรณีขายหน้าร้านโดยตรง (Manual Sold)
  const handleMarkSold = async (id: string) => {
    if(!confirm('ยืนยันการขายสินค้านี้? (รายการจะถูกย้ายไปที่ประวัติการขาย)')) return;
    try {
      await update(ref(db, `jobs/${id}`), {
          status: 'Sold',
          sold_date: Date.now()
      });
    } catch (error) {
      toast.error('บันทึกการขายไม่สำเร็จ');
    }
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading Inventory...</div>;

  return (
    <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
      
      <div className="mb-8">
        <div className="flex justify-between items-end mb-6">
           <div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-slate-800 flex items-center gap-2"><Package className="text-blue-600"/> Inventory Management</h1>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Pricing & Stock Control</p>
           </div>
           <div className="flex items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-slate-200 w-96">
              <Barcode className="text-slate-400" size={24}/>
              <input type="text" placeholder="Scan OID / SN..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="bg-transparent outline-none font-bold text-sm w-full"/>
           </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-8">
           <StatCard icon={<Package/>} label="Items in Stock" value={stats.totalItems} sub="Units Available" color="bg-blue-600"/>
           <StatCard icon={<DollarSign/>} label="Total Cost" value={`฿${stats.totalCost.toLocaleString()}`} sub="Capital Invested" color="bg-slate-700"/>
           <StatCard icon={<TrendingUp/>} label="Est. Profit" value={`฿${stats.potentialProfit.toLocaleString()}`} sub="Based on Retail Price" color="bg-emerald-600"/>
           <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">View Filters</span>
              <div className="flex gap-2">
                 <button onClick={()=>setActiveTab('instock')} className={`flex-1 py-1.5 text-[10px] font-bold rounded uppercase transition-colors ${activeTab === 'instock' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>New Stock</button>
                 <button onClick={()=>setActiveTab('ready')} className={`flex-1 py-1.5 text-[10px] font-bold rounded uppercase transition-colors ${activeTab === 'ready' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>In POS</button>
                 <button onClick={()=>setActiveTab('all')} className={`flex-1 py-1.5 text-[10px] font-bold rounded uppercase transition-colors ${activeTab === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>All</button>
              </div>
           </div>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden">
         <div className="overflow-x-auto">
            <table className="w-full text-left">
               <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Device Info</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">QC Grade</th>
                     {hasAccess(['CEO', 'MANAGER']) && (
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Cost</th>
                     )}
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Retail Price</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Stock Age</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                     <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {inventoryItems.map((item) => {
                     const age = getStockAge(item.qc_date);
                     const cost = Number(item.final_price) || Number(item.price) || 0;
                     const profit = (item.selling_price || 0) - cost;

                     return (
                        <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                           <td className="p-5">
                              <div className="flex items-center gap-3">
                                 <div className="bg-slate-100 p-2 rounded-lg"><Smartphone size={20} className="text-slate-500"/></div>
                                 <div>
                                    <div className="font-black text-sm text-slate-800">{item.model}</div>
                                    <div className="text-[10px] font-mono font-bold text-slate-400 flex gap-2"><span>SN: {item.serial || 'N/A'}</span> • <span>{item.color}</span></div>
                                    <div className="mt-1"><span className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono font-bold">{item.ref_no}</span></div>
                                 </div>
                              </div>
                           </td>
                           
                           <td className="p-5 text-center">
                              <div className="flex flex-col items-center">
                                 <span className="text-2xl font-black text-slate-800">{item.grade}</span>
                                 <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${item.battery_health >= 80 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>Bat: {item.battery_health}%</span>
                              </div>
                           </td>
                           
                           
                              {hasAccess(['CEO', 'MANAGER']) && (
                           <td className="p-5 text-right">
                              <div className="font-bold text-slate-400 text-sm">฿{cost.toLocaleString()}</div>
                           </td>
                              )}
                           
                           
                           <td className="p-5 text-right">
                              {item.selling_price ? (
                                 <div onClick={() => handleEditClick(item)} className="cursor-pointer hover:scale-105 transition-transform">
                                    <div className="font-black text-blue-600 text-lg">฿{Number(item.selling_price).toLocaleString()}</div>
                                    {hasAccess(['CEO', 'MANAGER']) && (
                                    <div className={`text-[9px] font-bold ${profit > 0 ? 'text-green-600' : 'text-red-500'}`}>margin: ฿{profit.toLocaleString()}</div>
                                    )}
                                 </div>
                              ) : (
                                 <button onClick={() => handleEditClick(item)} className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100">Set Price</button>
                              )}
                           </td>
                           
                           <td className="p-5 text-center">
                              <span className={`px-2 py-1 rounded-md text-[10px] font-black flex items-center gap-1 w-fit mx-auto ${getAgingColor(age)}`}><Clock size={10}/> {age} d</span>
                           </td>
                           
                           <td className="p-5 text-center">
                              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border ${
                                 item.status === 'Ready to Sell' ? 'bg-purple-50 text-purple-600 border-purple-200' : 
                                 item.status === 'Reserved' ? 'bg-orange-50 text-orange-600 border-orange-200' : 
                                 'bg-slate-50 text-slate-600 border-slate-200'
                              }`}>{item.status}</span>
                           </td>
                           
                           <td className="p-5 text-right">
                              <div className="flex justify-end gap-2 opacity-100 group-hover:opacity-100 transition-opacity">
                                 <button onClick={() => handleEditClick(item)} className="bg-slate-100 text-slate-600 p-2 rounded-lg hover:bg-slate-200" title="Edit Pricing"><Tag size={16}/></button>
                                 
                                 {/* ปุ่ม Push to POS (ถ้ามีราคาแล้วและยังไม่ได้ลง POS) */}
                                 {item.selling_price > 0 && item.status === 'In Stock' && (
                                    <button onClick={() => handlePushToPOS(item.id)} className="bg-purple-600 text-white p-2 rounded-lg hover:bg-purple-700 shadow-md" title="Push to POS">
                                       <ShoppingCart size={16}/>
                                    </button>
                                 )}

                                 {/* ปุ่ม Manual Sold (ถ้าอยู่ใน POS แล้ว) */}
                                 {item.status === 'Ready to Sell' && (
                                    <button onClick={() => handleMarkSold(item.id)} className="bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 shadow-md text-[10px] font-bold uppercase tracking-widest">
                                       Sold
                                    </button>
                                 )}
                              </div>
                           </td>
                        </tr>
                     );
                  })}
                  {inventoryItems.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-400 italic font-bold">No inventory items found.</td></tr>}
               </tbody>
            </table>
         </div>
      </div>

      {/* 🏷️ PRICING & DETAILS MODAL */}
      {editingItem && (
         <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden">
               <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight flex items-center gap-2"><Tag size={20} className="text-blue-500"/> Pricing Setup</h3>
                  <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
               </div>
               
               <div className="p-6 space-y-5">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                     <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Device</div>
                     <div className="font-black text-slate-800">{editingItem.model}</div>
                     <div className="text-xs font-bold text-slate-500 mt-1">Cost: ฿{(Number(editingItem.final_price) || Number(editingItem.price) || 0).toLocaleString()} | Grade: {editingItem.grade}</div>
                  </div>

                  <div className="space-y-4">
                     <div>
                        <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Retail Selling Price (ราคาขายเต็ม)</label>
                        <div className="relative mt-1">
                           <span className="absolute left-4 top-3 font-black text-slate-400">฿</span>
                           <input type="number" value={editForm.selling_price || ''} onChange={e => setEditForm({...editForm, selling_price: Number(e.target.value)})} className="w-full p-3 pl-8 rounded-xl border border-slate-200 font-black text-lg outline-none focus:border-blue-500" />
                        </div>
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-purple-500 uppercase tracking-widest">Promo Price (ราคาโปรโมชั่น - ไม่บังคับ)</label>
                        <div className="relative mt-1">
                           <span className="absolute left-4 top-3 font-black text-slate-400">฿</span>
                           <input type="number" value={editForm.promo_price || ''} onChange={e => setEditForm({...editForm, promo_price: Number(e.target.value)})} className="w-full p-3 pl-8 rounded-xl border border-slate-200 font-bold outline-none focus:border-purple-500" />
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        <div>
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Included Accessories</label>
                           <input type="text" value={editForm.accessories} onChange={e => setEditForm({...editForm, accessories: e.target.value})} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-xs outline-none" placeholder="e.g. สายชาร์จแท้" />
                        </div>
                        <div>
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Warranty (Days)</label>
                           <input type="number" value={editForm.warranty_days} onChange={e => setEditForm({...editForm, warranty_days: Number(e.target.value)})} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-xs outline-none" />
                        </div>
                     </div>
                     <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Manual Status Override</label>
                        <select value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold text-sm outline-none">
                           <option value="In Stock">In Stock (ยังไม่ขึ้น POS)</option>
                           <option value="Ready to Sell">Ready to Sell (ขึ้นหน้าร้านแล้ว)</option>
                           <option value="Reserved">Reserved (จองแล้ว)</option>
                        </select>
                     </div>
                  </div>

                  <div className="pt-4 flex gap-3">
                     <button onClick={() => setEditingItem(null)} className="flex-1 py-3 text-slate-500 font-bold text-xs uppercase hover:bg-slate-50 rounded-xl">Cancel</button>
                     <button onClick={handleSavePricing} className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center justify-center gap-2"><Save size={16}/> Save Pricing</button>
                  </div>
               </div>
            </div>
         </div>
      )}

    </div>
  );
};

const StatCard = ({ icon, label, value, sub, color }: any) => (
   <div className={`${color} p-5 rounded-2xl shadow-lg text-white relative overflow-hidden`}>
      <div className="relative z-10">
         <div className="flex items-center gap-2 opacity-80 mb-2">{icon} <span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
         <div className="text-3xl font-black">{value}</div>
         <div className="text-[10px] font-bold opacity-80 mt-1">{sub}</div>
      </div>
      <div className="absolute -right-4 -bottom-4 opacity-10 scale-150">{icon}</div>
   </div>
);