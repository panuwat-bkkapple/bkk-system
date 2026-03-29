'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Plus, Trash2, Layers, Image as ImageIcon, Save, Upload, Loader2
} from 'lucide-react';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../../api/firebase';
import toast from 'react-hot-toast';
import { useRef } from 'react';
import { uploadImageToFirebase } from '../../../utils/uploadImage';

interface SubcategoryManagementModalProps {
  subcategories: any[];
  availableSeries: any[];
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

const ImageUploadButton: React.FC<{ onUploaded: (url: string) => void }> = ({ onUploaded }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImageToFirebase(file, 'subcategory-images');
      onUploaded(url);
      toast.success('อัพโหลดรูปสำเร็จ');
    } catch (err: any) {
      toast.error(err.message || 'อัพโหลดรูปไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="px-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm shadow-sm shrink-0 disabled:opacity-50"
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
      </button>
    </>
  );
};

export const SubcategoryManagementModal: React.FC<SubcategoryManagementModalProps> = ({ subcategories, availableSeries, isOpen, onClose }) => {
  const [activeId, setActiveId] = useState<string | null>(subcategories.length > 0 ? subcategories[0].id : null);
  const [editing, setEditing] = useState<any>(null);

  useEffect(() => {
    if (activeId) {
      const found = subcategories.find(s => s.id === activeId);
      if (found) setEditing(JSON.parse(JSON.stringify(found)));
    } else {
      setEditing(null);
    }
  }, [activeId, subcategories]);

  const handleCreate = async () => {
    try {
      const newRef = push(ref(db, 'subcategories'));
      await update(newRef, {
        name: 'New Subcategory',
        brand: 'Apple',
        category: 'Mac / Laptop',
        imageUrl: ''
      });
      setActiveId(newRef.key);
      toast.success('สร้าง Subcategory ใหม่เรียบร้อย');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการสร้าง Subcategory');
    }
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return toast.error('กรุณาระบุชื่อ Subcategory');

    try {
      await update(ref(db, `subcategories/${editing.id}`), {
        name: editing.name,
        brand: editing.brand || 'Apple',
        category: editing.category || 'Mac / Laptop',
        imageUrl: editing.imageUrl || ''
      });

      // Sync subcategoryImageUrl to all series that belong to this subcategory
      const relatedSeries = availableSeries.filter(s => s.subcategory === editing.name);
      if (relatedSeries.length > 0) {
        await Promise.all(relatedSeries.map(s =>
          update(ref(db, `series/${s.id}`), { subcategoryImageUrl: editing.imageUrl || '' })
        ));
      }

      toast.success('บันทึกข้อมูล Subcategory สำเร็จ!');
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const seriesInThis = availableSeries.filter(s => s.subcategory === name);
    if (seriesInThis.length > 0) {
      toast.error(`ลบไม่ได้! มี Series ผูกกับ Subcategory นี้อยู่ ${seriesInThis.length} รายการ`);
      return;
    }

    if (confirm('ยืนยันการลบ Subcategory นี้ใช่หรือไม่?')) {
      try {
        await remove(ref(db, `subcategories/${id}`));
        setActiveId(subcategories.length > 0 ? subcategories[0].id : null);
        toast.success('ลบ Subcategory สำเร็จ');
      } catch (error) {
        toast.error('เกิดข้อผิดพลาดในการลบ Subcategory');
      }
    }
  };

  const seriesInActive = editing ? availableSeries.filter(s => s.subcategory === editing.name) : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[60] p-4 lg:p-10 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-violet-50 text-violet-600 rounded-2xl flex items-center justify-center"><Layers size={24} /></div>
            <div>
              <h3 className="font-black text-2xl text-slate-800">Subcategory Management</h3>
              <p className="text-sm text-slate-500 font-bold">จัดการกลุ่มย่อยสินค้า เช่น MacBook Air, MacBook Pro, iMac</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-72 bg-slate-50 border-r p-6 flex flex-col gap-3 overflow-y-auto shrink-0">
            <button onClick={handleCreate} className="w-full py-3 bg-white border border-dashed border-violet-300 text-violet-600 font-bold rounded-xl hover:bg-violet-50 transition mb-2 flex items-center justify-center gap-2">
              <Plus size={18} /> สร้าง Subcategory ใหม่
            </button>

            {subcategories.map(sub => (
              <div key={sub.id} className={`p-4 rounded-2xl cursor-pointer border-2 transition-all group relative ${activeId === sub.id ? 'bg-violet-50 border-violet-500' : 'bg-white border-transparent hover:border-slate-200 shadow-sm'}`} onClick={() => setActiveId(sub.id)}>
                <div className="flex items-center gap-3">
                  {sub.imageUrl ? (
                    <img src={sub.imageUrl} alt={sub.name} className="w-8 h-8 object-contain drop-shadow-sm" />
                  ) : (
                    <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400"><ImageIcon size={14} /></div>
                  )}
                  <div>
                    <div className={`font-black text-sm truncate pr-6 ${activeId === sub.id ? 'text-violet-900' : 'text-slate-700'}`}>{sub.name}</div>
                    <div className="text-[10px] text-slate-400 font-medium truncate">{sub.brand} / {sub.category}</div>
                  </div>
                </div>

                <button onClick={(e) => { e.stopPropagation(); handleDelete(sub.id, sub.name); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 bg-white flex flex-col overflow-hidden">
            {editing ? (
              <>
                <div className="p-8 pb-4 border-b flex justify-between items-center bg-white shrink-0 z-10">
                  <h3 className="text-xl font-black text-slate-800">แก้ไขข้อมูล: {editing.name}</h3>
                  <button onClick={handleSave} className="px-6 py-2.5 bg-violet-600 text-white font-black rounded-xl hover:bg-violet-700 transition flex items-center gap-2 shadow-md">
                    <Save size={18} /> บันทึกการเปลี่ยนแปลง
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                  <div className="grid grid-cols-2 gap-8 mb-8">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Basic Info</h4>
                      <div>
                        <label className="text-xs font-bold text-slate-500 block mb-1">ชื่อ Subcategory (เช่น MacBook Air, MacBook Pro, iMac)</label>
                        <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-violet-500 outline-none" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Brand</label>
                          <select value={editing.brand} onChange={e => setEditing({ ...editing, brand: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none">
                            {brands.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Category</label>
                          <select value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 font-bold outline-none">
                            {categories.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Subcategory Image</h4>
                      <div className="flex gap-4 items-start">
                        <div className="w-24 h-24 bg-slate-50 rounded-2xl border border-dashed border-slate-300 flex items-center justify-center shrink-0 p-2">
                          {editing.imageUrl ? <img src={editing.imageUrl} alt="icon" className="max-w-full max-h-full object-contain drop-shadow-md" /> : <ImageIcon className="text-slate-300" size={32} />}
                        </div>
                        <div className="flex-1">
                          <label className="text-xs font-bold text-slate-500 block mb-1">Image URL (รูปโปร่งใสพื้นหลัง PNG)</label>
                          <div className="flex gap-2">
                            <input type="text" placeholder="https://..." value={editing.imageUrl} onChange={e => setEditing({ ...editing, imageUrl: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                            <ImageUploadButton onUploaded={(url) => setEditing({ ...editing, imageUrl: url })} />
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2">รูปนี้จะแสดงในขั้นตอน Sub-category ของหน้า Sell</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h4 className="text-sm font-black text-slate-800 mb-4 flex justify-between items-center">
                      <span>Series ที่อยู่ใน {editing.name}</span>
                      <span className="text-xs bg-violet-50 text-violet-600 px-3 py-1 rounded-full">{seriesInActive.length} รายการ</span>
                    </h4>

                    {seriesInActive.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        ยังไม่มี Series ไหนถูกจัดให้อยู่ใน Subcategory นี้
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                        {seriesInActive.map(s => (
                          <div key={s.id} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl bg-slate-50 hover:bg-white hover:shadow-sm transition-all">
                            {s.imageUrl ? <img src={s.imageUrl} alt={s.name} className="w-10 h-10 object-contain drop-shadow-sm" /> : <div className="w-10 h-10 bg-slate-200 rounded-lg"></div>}
                            <div>
                              <div className="text-xs font-black text-slate-800 line-clamp-1">{s.name}</div>
                              <div className="text-[10px] text-slate-400 font-bold">{s.brand} / {s.category}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50/50">เลือกหรือสร้าง Subcategory จากเมนูด้านซ้าย</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubcategoryManagementModal;
