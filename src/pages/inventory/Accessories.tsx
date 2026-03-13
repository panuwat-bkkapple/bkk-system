// src/pages/inventory/Accessories.tsx
import React, { useState, useMemo } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { Headphones, PlusCircle, Search, Edit, Trash2, X, Save } from 'lucide-react';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../api/firebase';

export const Accessories = () => {
  const { data: products, loading } = useDatabase('products');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [formData, setFormData] = useState<any>({ sku: '', name: '', price: 0, cost: 0, stock: 0 });

  const filteredProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];
    return list.filter(p => 
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  }, [products, searchTerm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.sku || !formData.name) return alert('กรุณากรอกรหัส SKU และชื่อสินค้า');

    try {
      const payload = { 
         ...formData, 
         price: Number(formData.price), 
         cost: Number(formData.cost), 
         stock: Number(formData.stock),
         updated_at: Date.now() 
      };

      if (modalMode === 'add') {
        await push(ref(db, 'products'), { ...payload, created_at: Date.now() });
      } else {
        const { id, ...updateData } = payload;
        await update(ref(db, `products/${id}`), updateData);
      }
      setIsModalOpen(false);
    } catch (error) { alert('Error: ' + error); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ยืนยันการลบสินค้านี้?')) return;
    await remove(ref(db, `products/${id}`));
  };

  const openModal = (mode: 'add' | 'edit', item?: any) => {
    setModalMode(mode);
    setFormData(item ? { ...item } : { sku: '', name: '', price: 0, cost: 0, stock: 0 });
    setIsModalOpen(true);
  };

  if (loading) return <div className="p-10 text-center font-bold text-slate-400">Loading Accessories...</div>;

  return (
    <div className="p-8 space-y-6 bg-[#F9FBFC] min-h-screen font-sans text-slate-800">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight flex items-center gap-2"><Headphones className="text-blue-600"/> Accessories (SKU)</h2>
          <p className="text-sm text-slate-500 font-bold mt-1">จัดการสต็อกอุปกรณ์เสริม เคส ฟิล์ม สายชาร์จ</p>
        </div>
        <button onClick={() => openModal('add')} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg hover:bg-blue-700 transition-all">
          <PlusCircle size={18} /> เพิ่มสินค้าใหม่
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-3 text-slate-400" size={18} />
          <input type="text" placeholder="ค้นหาตามชื่อสินค้า หรือ SKU..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-2.5 bg-slate-50 rounded-xl font-bold outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
         <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
               <tr>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">SKU Code</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Product Name</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Cost (ทุน)</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Price (ขาย)</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">In Stock</th>
                  <th className="p-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
               {filteredProducts.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                     <td className="p-5"><span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded">{item.sku}</span></td>
                     <td className="p-5 font-bold text-slate-800">{item.name}</td>
                     <td className="p-5 text-right font-bold text-slate-400">฿{Number(item.cost).toLocaleString()}</td>
                     <td className="p-5 text-right font-black text-blue-600 text-lg">฿{Number(item.price).toLocaleString()}</td>
                     <td className="p-5 text-center">
                        <span className={`px-3 py-1 rounded-lg text-xs font-black ${item.stock > 10 ? 'bg-green-100 text-green-700' : item.stock > 0 ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                           {item.stock} ชิ้น
                        </span>
                     </td>
                     <td className="p-5 text-right">
                        <div className="flex justify-end gap-2">
                           <button onClick={() => openModal('edit', item)} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"><Edit size={16}/></button>
                           <button onClick={() => handleDelete(item.id)} className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"><Trash2 size={16}/></button>
                        </div>
                     </td>
                  </tr>
               ))}
               {filteredProducts.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-400 italic font-bold">ไม่มีรายการอุปกรณ์เสริม</td></tr>}
            </tbody>
         </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
         <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden">
               <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="font-black text-lg text-slate-800 uppercase tracking-tight">{modalMode === 'add' ? 'เพิ่มสินค้าใหม่' : 'แก้ไขสินค้า'}</h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24}/></button>
               </div>
               
               <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">รหัสสินค้า (SKU)</label><input type="text" value={formData.sku} onChange={e=>setFormData({...formData, sku: e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 font-mono font-bold outline-none" required placeholder="เช่น ACC-CASE-001"/></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ชื่อสินค้า</label><input type="text" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 font-bold outline-none" required placeholder="เช่น เคสใสกันกระแทก"/></div>
                  
                  <div className="grid grid-cols-2 gap-4">
                     <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ต้นทุน (Cost)</label><input type="number" value={formData.cost || ''} onChange={e=>setFormData({...formData, cost: e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 font-bold outline-none" required/></div>
                     <div><label className="text-[10px] font-black text-blue-500 uppercase tracking-widest">ราคาขาย (Price)</label><input type="number" value={formData.price || ''} onChange={e=>setFormData({...formData, price: e.target.value})} className="w-full p-3 rounded-xl border border-blue-200 font-black text-blue-600 outline-none" required/></div>
                  </div>
                  
                  <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">จำนวนสต็อก (Stock)</label><input type="number" value={formData.stock || ''} onChange={e=>setFormData({...formData, stock: e.target.value})} className="w-full p-3 rounded-xl border border-slate-200 font-bold outline-none" required/></div>

                  <div className="pt-4 flex gap-3">
                     <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-slate-500 font-bold text-xs uppercase hover:bg-slate-50 rounded-xl">ยกเลิก</button>
                     <button type="submit" className="flex-[2] bg-blue-600 text-white py-3 rounded-xl font-black text-xs uppercase shadow-lg hover:bg-blue-700 flex items-center justify-center gap-2"><Save size={16}/> บันทึกข้อมูล</button>
                  </div>
               </form>
            </div>
         </div>
      )}
    </div>
  );
};