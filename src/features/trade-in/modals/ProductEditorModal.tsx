'use client';

import React, { useState, useRef } from 'react';
import {
  Smartphone, X, Image as ImageIcon, Plus, ClipboardList, Trash2, Save, Upload, Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadImageToFirebase } from '../../../utils/uploadImage';
import { CATEGORY_SCHEMAS } from '../constants/categorySchemas';

interface ProductEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingItem: any;
  conditionSets: any[];
  availableSeries: any[];
  categorySchemas: typeof CATEGORY_SCHEMAS;
  onSave: () => void;
  onEditingItemChange: (item: any) => void;
}

const categories = [
  { id: 'Smartphones' },
  { id: 'Tablets' },
  { id: 'Mac / Laptop' },
  { id: 'Smart Watch' },
  { id: 'Camera' },
  { id: 'Game System' },
];
const brands = ['All', 'Apple', 'Samsung', 'Google', 'Oppo', 'Vivo', 'Sony', 'Nintendo'];

const ImageUploadButton: React.FC<{ onUploaded: (url: string) => void }> = ({ onUploaded }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadImageToFirebase(file, 'product-images');
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

export const ProductEditorModal: React.FC<ProductEditorModalProps> = ({
  isOpen,
  onClose,
  editingItem,
  conditionSets,
  availableSeries,
  categorySchemas,
  onSave,
  onEditingItemChange,
}) => {
  const [isAddingSeries, setIsAddingSeries] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');

  if (!isOpen || !editingItem) return null;

  const handleCategoryChange = (newCat: string) => {
    const schema = categorySchemas[newCat] || categorySchemas['Smartphones'];
    onEditingItemChange({ ...editingItem, category: newCat, attributesSchema: schema });
  };

  const handleAddVariant = () => {
    onEditingItemChange({ ...editingItem, variants: [...(editingItem.variants || []), { id: Date.now().toString(), attributes: {}, name: '', newPrice: 0, usedPrice: 0 }] });
  };

  const handleRemoveVariant = (id: string) => {
    onEditingItemChange({ ...editingItem, variants: editingItem.variants.filter((v: any) => v.id !== id) });
  };

  const handleAttributeChange = (variantIndex: number, attrKey: string, value: string) => {
    const newVariants = [...editingItem.variants];
    if (!newVariants[variantIndex].attributes) newVariants[variantIndex].attributes = {};
    newVariants[variantIndex].attributes[attrKey] = value;
    onEditingItemChange({ ...editingItem, variants: newVariants });
  };

  const handleAddNewSeries = async () => {
    if (!newSeriesName.trim()) return toast.error('กรุณาพิมพ์ชื่อ Series ก่อนบันทึกครับ');
    try {
      const { ref, push, update } = await import('firebase/database');
      const { db } = await import('../../../api/firebase');
      const newRef = push(ref(db, 'series'));
      await update(newRef, { name: newSeriesName.trim(), brand: editingItem.brand || 'Apple', category: editingItem.category || 'Tablets' });
      toast.success(`เพิ่ม Series: ${newSeriesName} สำเร็จ!`);
      onEditingItemChange({ ...editingItem, series: newSeriesName.trim() });
      setNewSeriesName('');
      setIsAddingSeries(false);
    } catch (error) { toast.error('เกิดข้อผิดพลาดในการเพิ่ม Series'); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 lg:p-10">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[1400px] h-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

        <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><Smartphone size={24} /></div>
            <div><h3 className="font-black text-2xl text-slate-800">{editingItem.id.length > 15 ? 'Edit Model' : 'Add New Model'}</h3><p className="text-sm font-bold text-slate-400">Enterprise Database Structure</p></div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 max-w-7xl mx-auto w-full">

            {/* Left Column (Info & Settings) */}
            <div className="xl:col-span-4 space-y-6">
              <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 space-y-5">
                <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                  <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">1. General Info</h4>
                  <label className="flex items-center gap-2 cursor-pointer bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                    <input type="checkbox" checked={editingItem.isFeatured} onChange={(e) => onEditingItemChange({ ...editingItem, isFeatured: e.target.checked })} className="w-4 h-4 rounded text-amber-500" />
                    <span className="text-[10px] font-black text-amber-600 uppercase">โชว์หน้าแรก</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1.5 block">Category</label>
                    <select className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.category} onChange={(e) => handleCategoryChange(e.target.value)}>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1.5 block">Brand</label>
                    <select className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.brand} onChange={(e) => onEditingItemChange({ ...editingItem, brand: e.target.value })}>
                      {brands.filter(b => b !== 'All').map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 mb-1.5 flex justify-between items-center">
                    <span>Series (ตระกูล)</span>
                    <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                  </label>

                  {!isAddingSeries ? (
                    <div className="flex gap-2">
                      <select value={editingItem.series || ''} onChange={(e) => onEditingItemChange({ ...editingItem, series: e.target.value })} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-colors outline-none">
                        <option value="">-- ไม่ระบุ --</option>
                        {(() => {
                          const filtered = availableSeries.filter(s => s.brand === editingItem.brand && s.category === editingItem.category);
                          const groups = filtered.reduce((acc: Record<string, any[]>, s) => {
                            const key = s.subcategory || '';
                            if (!acc[key]) acc[key] = [];
                            acc[key].push(s);
                            return acc;
                          }, {});
                          const hasSubcategories = Object.keys(groups).some(k => k !== '');
                          if (!hasSubcategories) {
                            return filtered.map(s => <option key={s.id} value={s.name}>{s.name}</option>);
                          }
                          return Object.entries(groups).map(([group, items]) => (
                            <optgroup key={group || '_none'} label={group || 'ไม่ระบุ Subcategory'}>
                              {items.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                            </optgroup>
                          ));
                        })()}
                      </select>
                      <button type="button" onClick={() => setIsAddingSeries(true)} className="px-4 bg-slate-100 text-blue-600 rounded-xl hover:bg-blue-50 font-bold border border-slate-200 whitespace-nowrap transition-colors text-sm">+ เพิ่มใหม่</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input type="text" placeholder="เช่น iPad Pro..." value={newSeriesName} onChange={(e) => setNewSeriesName(e.target.value)} className="w-full p-3 bg-blue-50/50 rounded-xl border border-blue-200 text-sm font-bold text-blue-700 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-colors outline-none" autoFocus />
                      <button type="button" onClick={handleAddNewSeries} className="px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm shadow-sm">บันทึก</button>
                      <button type="button" onClick={() => setIsAddingSeries(false)} className="px-3 bg-white text-slate-400 rounded-xl font-bold hover:bg-red-50 hover:text-red-500 transition-colors text-sm border border-slate-200">✕</button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1.5 block">Model Name (ชื่อรุ่น)</label>
                  <input type="text" placeholder="เช่น MacBook Pro 14 นิ้ว..." className="w-full p-3 bg-white rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.name} onChange={(e) => onEditingItemChange({ ...editingItem, name: e.target.value })} />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1.5 block">รูปสินค้า</label>
                  <div className="flex gap-2">
                    <div className="w-12 h-12 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center shrink-0">
                      {editingItem.imageUrl ? <img src={editingItem.imageUrl} alt="preview" className="max-h-full p-1 object-contain" /> : <ImageIcon size={20} className="text-slate-300" />}
                    </div>
                    <div className="flex-1 flex gap-2">
                      <input type="text" placeholder="https://... หรืออัพโหลดรูป →" className="w-full p-3 bg-white rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-blue-500" value={editingItem.imageUrl} onChange={(e) => onEditingItemChange({ ...editingItem, imageUrl: e.target.value })} />
                      <ImageUploadButton onUploaded={(url) => onEditingItemChange({ ...editingItem, imageUrl: url })} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 space-y-5">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3">2. Trade-in Settings</h4>

                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={editingItem.inStore} onChange={(e) => onEditingItemChange({ ...editingItem, inStore: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-bold text-slate-700">หน้าร้าน (In-Store)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={editingItem.pickup} onChange={(e) => onEditingItemChange({ ...editingItem, pickup: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-bold text-slate-700">แมสเซนเจอร์ (Pickup)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={editingItem.mailIn} onChange={(e) => onEditingItemChange({ ...editingItem, mailIn: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-bold text-slate-700">ส่งพัสดุ (Mail-in)</span>
                  </label>
                </div>

                <div>
                  <label className="text-xs font-black text-indigo-600 mb-2 block flex items-center gap-1"><ClipboardList size={14} /> Assign Condition Item</label>
                  <select className="w-full p-4 bg-indigo-50 rounded-xl border border-indigo-200 text-sm font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none" value={editingItem.conditionSetId} onChange={(e) => onEditingItemChange({ ...editingItem, conditionSetId: e.target.value })}>
                    <option value="" disabled>-- เลือกชุดประเมินสภาพที่ตรงกับสินค้านี้ --</option>
                    {conditionSets.map(set => (<option key={set.id} value={set.id}>{set.name}</option>))}
                  </select>
                </div>
              </div>
            </div>

            {/* Right Column (DYNAMIC SPEC BUILDER) */}
            <div className="xl:col-span-8">
              <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 h-full flex flex-col">
                <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-4">
                  <div>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">3. Dynamic Variants (Step-by-Step UI)</h4>
                    <p className="text-[10px] text-emerald-500 font-bold mt-1">โครงสร้างนี้รองรับการสร้าง UI แบบทีละสเต็ปบนหน้าเว็บ (Progressive Disclosure)</p>
                  </div>
                  <button onClick={handleAddVariant} className="text-sm font-bold text-blue-600 border-2 border-blue-100 bg-blue-50 px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shadow-sm"><Plus size={16} /> Add Variant</button>
                </div>

                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 flex-1 overflow-y-auto space-y-4">
                  {editingItem.variants?.map((v: any, index: number) => {
                    const currentSchema = editingItem.attributesSchema || categorySchemas['Smartphones'];

                    return (
                      <div key={v.id} className="grid grid-cols-12 gap-4 items-start bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative group hover:border-blue-200 transition-colors pr-12">

                        {/* Dynamic Inputs Based on Category Schema */}
                        <div className="col-span-12 xl:col-span-7">
                           <div className="grid grid-cols-2 gap-3">
                              {currentSchema.map((attr: any) => (
                                 <div key={attr.key}>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                                      {attr.label}
                                    </label>

                                    {attr.type === 'select' ? (
                                       <select
                                          className="w-full p-2.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                          value={v.attributes?.[attr.key] || ''}
                                          onChange={(e) => handleAttributeChange(index, attr.key, e.target.value)}
                                       >
                                          <option value="">-- เลือก --</option>
                                          {attr.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                                       </select>
                                    ) : (
                                       <input
                                          type="text"
                                          placeholder={`e.g. ${attr.key === 'ram' ? '8GB' : attr.key === 'storage' ? '256GB' : '...'}`}
                                          className="w-full p-2.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                          value={v.attributes?.[attr.key] || ''}
                                          onChange={(e) => handleAttributeChange(index, attr.key, e.target.value)}
                                       />
                                    )}
                                 </div>
                              ))}
                              <div className="col-span-2 text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                                <span className="font-bold text-slate-500">ผลลัพธ์ที่จะโชว์ในฐานข้อมูลเก่า:</span>
                                {currentSchema.map((a: any) => v.attributes?.[a.key]).filter(Boolean).join(' | ') || '...'}
                              </div>
                           </div>
                        </div>

                        {/* Pricing Inputs */}
                        <div className="col-span-12 xl:col-span-5 grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[9px] font-black uppercase text-emerald-500 tracking-wider block mb-1">ราคาเครื่องซีล</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">฿</span>
                              <input type="number" className="w-full pl-8 pr-3 py-3 bg-emerald-50/50 rounded-lg text-sm font-black text-emerald-600 border border-emerald-100 focus:ring-2 focus:ring-emerald-500 outline-none" value={v.newPrice || ''} onChange={(e) => { const newV = [...editingItem.variants]; newV[index].newPrice = Number(e.target.value); onEditingItemChange({ ...editingItem, variants: newV }); }} />
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] font-black uppercase text-blue-500 tracking-wider block mb-1">ราคาเครื่องมือสอง (รับซื้อ)</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 font-bold">฿</span>
                              <input type="number" className="w-full pl-8 pr-3 py-3 bg-blue-50/50 rounded-lg text-sm font-black text-blue-600 border border-blue-100 focus:ring-2 focus:ring-blue-500 outline-none" value={v.usedPrice || v.price || ''} onChange={(e) => { const newV = [...editingItem.variants]; newV[index].usedPrice = Number(e.target.value); onEditingItemChange({ ...editingItem, variants: newV }); }} />
                            </div>
                          </div>
                        </div>

                        {editingItem.variants.length > 1 && (
                          <button onClick={() => handleRemoveVariant(v.id)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="px-8 py-5 border-t bg-white flex justify-end gap-4 shrink-0 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] z-10">
          <button onClick={onClose} className="px-8 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">Cancel</button>
          <button onClick={onSave} className="px-10 py-3 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition active:scale-95 flex items-center gap-2">
            <Save size={18} /> Save & Apply Schema
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductEditorModal;
