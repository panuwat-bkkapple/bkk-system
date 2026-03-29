'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Plus, Trash2, FolderTree, Image as ImageIcon, Save
} from 'lucide-react';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../../api/firebase';
import toast from 'react-hot-toast';

interface SeriesManagementModalProps {
  availableSeries: any[];
  subcategories: any[];
  modelsData: any[];
  isOpen: boolean;
  onClose: () => void;
}

const categories = [
  { id: 'Smartphones' },
  { id: 'Tablets' },
  { id: 'Mac / Laptop' },
  { id: 'Smart Watch' },
  { id: 'Camera' },
  { id: 'Game System' },
];
const brands = ['Apple', 'Samsung', 'Google', 'Oppo', 'Vivo', 'Sony', 'Nintendo'];

export const SeriesManagementModal: React.FC<SeriesManagementModalProps> = ({ availableSeries, subcategories, modelsData, isOpen, onClose }) => {
  const [activeSeriesId, setActiveSeriesId] = useState<string | null>(availableSeries.length > 0 ? availableSeries[0].id : null);
  const [editingSeries, setEditingSeries] = useState<any>(null);

  useEffect(() => {
    if (activeSeriesId) {
      const found = availableSeries.find(s => s.id === activeSeriesId);
      if (found) setEditingSeries(JSON.parse(JSON.stringify(found)));
    } else {
      setEditingSeries(null);
    }
  }, [activeSeriesId, availableSeries]);

  const handleCreateNewSeriesModal = async () => {
    try {
      const newRef = push(ref(db, 'series'));
      await update(newRef, {
        name: 'New Series',
        brand: 'Apple',
        category: 'Tablets',
        imageUrl: '',
        subcategory: ''
      });
      setActiveSeriesId(newRef.key);
      toast.success('สร้าง Series ใหม่เรียบร้อย');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการสร้าง Series');
    }
  };

  const handleSaveSeriesModal = async () => {
    if (!editingSeries || !editingSeries.name.trim()) return toast.error('กรุณาระบุชื่อ Series');

    try {
      // Look up subcategory image from subcategories collection
      const matchedSubcategory = subcategories.find(sc => sc.name === editingSeries.subcategory);
      const subcategoryImageUrl = matchedSubcategory?.imageUrl || '';

      await update(ref(db, `series/${editingSeries.id}`), {
        name: editingSeries.name,
        brand: editingSeries.brand || 'Apple',
        category: editingSeries.category || 'Tablets',
        imageUrl: editingSeries.imageUrl || '',
        subcategory: editingSeries.subcategory || '',
        subcategoryImageUrl
      });
      toast.success('บันทึกข้อมูล Series สำเร็จ!');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const handleDeleteSeriesModal = async (id: string, seriesName: string) => {
    const modelsInThisSeries = modelsData.filter(m => m.series === seriesName);
    if (modelsInThisSeries.length > 0) {
      toast.error(`ลบไม่ได้! มีสินค้าผูกกับ Series นี้อยู่ ${modelsInThisSeries.length} รายการ`);
      return;
    }

    if (confirm('ยืนยันการลบ Series นี้ใช่หรือไม่?')) {
      try {
        await remove(ref(db, `series/${id}`));
        setActiveSeriesId(availableSeries.length > 0 ? availableSeries[0].id : null);
        toast.success('ลบ Series สำเร็จ');
      } catch (error) {
        toast.error('เกิดข้อผิดพลาดในการลบ Series');
      }
    }
  }

  // Filter subcategories by current series brand+category
  const filteredSubcategories = editingSeries
    ? subcategories.filter(sc => sc.brand === editingSeries.brand && sc.category === editingSeries.category)
    : [];

  const modelsInActiveSeries = editingSeries ? modelsData.filter(m => m.series === editingSeries.name) : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[60] p-4 lg:p-10 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><FolderTree size={24} /></div>
            <div>
              <h3 className="font-black text-2xl text-slate-800">Series Management</h3>
              <p className="text-sm text-slate-500 font-bold">จัดการตระกูลสินค้า รูปไอคอน และรายการที่เกี่ยวข้อง</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Left: List of Series */}
          <div className="w-72 bg-slate-50 border-r p-6 flex flex-col gap-3 overflow-y-auto shrink-0">
            <button onClick={handleCreateNewSeriesModal} className="w-full py-3 bg-white border border-dashed border-blue-300 text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition mb-2 flex items-center justify-center gap-2">
              <Plus size={18} /> สร้าง Series ใหม่
            </button>

            {availableSeries.map(series => (
              <div key={series.id} className={`p-4 rounded-2xl cursor-pointer border-2 transition-all group relative ${activeSeriesId === series.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-transparent hover:border-slate-200 shadow-sm'}`} onClick={() => setActiveSeriesId(series.id)}>
                <div className="flex items-center gap-3">
                  {series.imageUrl ? (
                    <img src={series.imageUrl} alt={series.name} className="w-8 h-8 object-contain drop-shadow-sm" />
                  ) : (
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400"><ImageIcon size={14} /></div>
                  )}
                  <div>
                    <div className={`font-black text-sm truncate pr-6 ${activeSeriesId === series.id ? 'text-blue-900' : 'text-slate-700'}`}>{series.name}</div>
                    {series.subcategory && <div className="text-[10px] text-slate-400 font-medium mt-0.5 truncate">{series.subcategory}</div>}
                  </div>
                </div>

                <button onClick={(e) => { e.stopPropagation(); handleDeleteSeriesModal(series.id, series.name); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          {/* Main Area: Editor */}
          <div className="flex-1 bg-white flex flex-col overflow-hidden">
            {editingSeries ? (
              <>
                <div className="p-8 pb-4 border-b flex justify-between items-center bg-white shrink-0 z-10">
                  <h3 className="text-xl font-black text-slate-800">แก้ไขข้อมูล: {editingSeries.name}</h3>
                  <button onClick={handleSaveSeriesModal} className="px-6 py-2.5 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition flex items-center gap-2 shadow-md">
                    <Save size={18} /> บันทึกการเปลี่ยนแปลง
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                  <div className="grid grid-cols-2 gap-8 mb-8">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Basic Info</h4>
                      <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">ชื่อ Series (เช่น iPad Pro, iPhone 15)</label>
                        <input type="text" value={editingSeries.name} onChange={e => setEditingSeries({ ...editingSeries, name: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Brand</label>
                          <select value={editingSeries.brand} onChange={e => setEditingSeries({ ...editingSeries, brand: e.target.value, subcategory: '' })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none">
                            {brands.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Category</label>
                          <select value={editingSeries.category} onChange={e => setEditingSeries({ ...editingSeries, category: e.target.value, subcategory: '' })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none">
                            {categories.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">Subcategory (optional)</label>
                        <select
                          value={editingSeries.subcategory || ''}
                          onChange={e => setEditingSeries({ ...editingSeries, subcategory: e.target.value })}
                          className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- ไม่ระบุ --</option>
                          {filteredSubcategories.map(sc => (
                            <option key={sc.id} value={sc.name}>{sc.name}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1">จัดกลุ่มย่อยภายใน Category (จัดการได้ที่เมนู Subcategories)</p>
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Menu Icon Image</h4>
                      <div className="flex gap-4 items-start">
                        <div className="w-24 h-24 bg-slate-50 rounded-2xl border border-dashed border-slate-300 flex items-center justify-center shrink-0 p-2">
                          {editingSeries.imageUrl ? <img src={editingSeries.imageUrl} alt="icon" className="max-w-full max-h-full object-contain drop-shadow-md" /> : <ImageIcon className="text-slate-300" size={32} />}
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-bold text-slate-500 block mb-1">Image URL (รูปโปร่งใสพื้นหลัง PNG)</label>
                          <input type="text" placeholder="https://..." value={editingSeries.imageUrl} onChange={e => setEditingSeries({ ...editingSeries, imageUrl: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-2" />
                          <p className="text-[10px] text-slate-400">รูปนี้จะถูกนำไปแสดงเป็นไอคอนเมนูด้านบน (Sub-navigation) แบบเดียวกับหน้าเว็บ Apple</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h4 className="text-sm font-black text-slate-800 mb-4 flex justify-between items-center">
                      <span>รายการสินค้าที่อยู่ใน {editingSeries.name}</span>
                      <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full">{modelsInActiveSeries.length} รายการ</span>
                    </h4>

                    {modelsInActiveSeries.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        ยังไม่มีสินค้ารุ่นไหนถูกจัดให้อยู่ใน Series นี้
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        {modelsInActiveSeries.map(m => (
                          <div key={m.id} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-slate-50 hover:bg-white hover:shadow-sm transition-all">
                            {m.imageUrl ? <img src={m.imageUrl} alt={m.name} className="w-10 h-10 object-contain drop-shadow-sm" /> : <div className="w-10 h-10 bg-slate-200 rounded-lg"></div>}
                            <div>
                              <div className="text-xs font-black text-slate-800 line-clamp-1">{m.name}</div>
                              <div className="text-[10px] text-slate-400 font-bold">{m.variants?.length || 0} ความจุ</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </>
            ) : <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50/50">เลือกหรือสร้าง Series จากเมนูด้านซ้าย</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SeriesManagementModal;
