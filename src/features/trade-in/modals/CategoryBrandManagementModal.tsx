'use client';

import React, { useState, useEffect } from 'react';
import {
  X, Plus, Trash2, LayoutGrid, Save, ArrowUp, ArrowDown, Tag,
} from 'lucide-react';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../../api/firebase';
import toast from 'react-hot-toast';
import { CATEGORY_ICON_KEYS, getCategoryIcon } from '../constants/categoryIcons';
import type { AttributeSchemaItem } from '../constants/categorySchemas';

interface CategoryBrandManagementModalProps {
  categories: any[];
  brands: any[];
  modelsData: any[];
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'categories' | 'brands';

export const CategoryBrandManagementModal: React.FC<CategoryBrandManagementModalProps> = ({
  categories, brands, modelsData, isOpen, onClose,
}) => {
  const [tab, setTab] = useState<Tab>('categories');
  const [activeCatId, setActiveCatId] = useState<string | null>(categories.length > 0 ? categories[0].id : null);
  const [editingCat, setEditingCat] = useState<any>(null);

  useEffect(() => {
    if (activeCatId) {
      const found = categories.find(c => c.id === activeCatId);
      if (found) setEditingCat(JSON.parse(JSON.stringify(found)));
    } else {
      setEditingCat(null);
    }
  }, [activeCatId, categories]);

  // ----- Categories -----
  const handleCreateCategory = async () => {
    const name = (prompt('ชื่อ Category ใหม่ (ค่านี้ใช้เป็น join key กับ models/series และแก้ไม่ได้ภายหลัง)') || '').trim();
    if (!name) return;
    if (categories.some(c => c.name === name)) {
      toast.error('มี Category ชื่อนี้อยู่แล้ว');
      return;
    }
    try {
      const maxOrder = categories.reduce((m, c) => Math.max(m, Number(c.order) || 0), 0);
      const newRef = push(ref(db, 'product_categories'));
      await update(newRef, {
        name,
        label_th: '',
        icon: 'package',
        route: '',
        slug: '',
        order: maxOrder + 1,
        active: true,
        schema: [{ key: 'storage', label: 'Storage', type: 'text' }],
      });
      setActiveCatId(newRef.key);
      toast.success('สร้าง Category ใหม่เรียบร้อย');
    } catch {
      toast.error('เกิดข้อผิดพลาดในการสร้าง Category');
    }
  };

  const handleSaveCategory = async () => {
    if (!editingCat) return;
    try {
      const cleanSchema: AttributeSchemaItem[] = (editingCat.schema || [])
        .filter((s: any) => s && s.key && s.key.trim())
        .map((s: any) => {
          const item: AttributeSchemaItem = {
            key: s.key.trim(),
            label: (s.label || '').trim(),
            type: s.type === 'select' ? 'select' : 'text',
          };
          if (item.type === 'select') {
            item.options = (s.options || []).map((o: string) => o.trim()).filter(Boolean);
          }
          return item;
        });
      await update(ref(db, `product_categories/${editingCat.id}`), {
        // name is immutable — keep the canonical join key
        name: editingCat.name,
        label_th: editingCat.label_th || '',
        icon: editingCat.icon || 'package',
        route: editingCat.route || '',
        slug: editingCat.slug || '',
        order: Number(editingCat.order) || 0,
        active: editingCat.active !== false,
        schema: cleanSchema,
      });
      toast.success('บันทึกข้อมูล Category สำเร็จ!');
    } catch {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    const used = modelsData.filter(m => m.category === name).length;
    if (used > 0) {
      toast.error(`ลบไม่ได้! มีสินค้าผูกกับ Category นี้อยู่ ${used} รายการ`);
      return;
    }
    if (confirm('ยืนยันการลบ Category นี้ใช่หรือไม่?')) {
      try {
        await remove(ref(db, `product_categories/${id}`));
        setActiveCatId(categories.length > 0 ? categories[0].id : null);
        toast.success('ลบ Category สำเร็จ');
      } catch {
        toast.error('เกิดข้อผิดพลาดในการลบ Category');
      }
    }
  };

  // ----- Schema row helpers (operate on editingCat in local state) -----
  const updateSchema = (next: any[]) => setEditingCat({ ...editingCat, schema: next });

  const addSchemaRow = () => {
    updateSchema([...(editingCat.schema || []), { key: '', label: '', type: 'text' }]);
  };
  const removeSchemaRow = (idx: number) => {
    updateSchema((editingCat.schema || []).filter((_: any, i: number) => i !== idx));
  };
  const moveSchemaRow = (idx: number, dir: -1 | 1) => {
    const arr = [...(editingCat.schema || [])];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    updateSchema(arr);
  };
  const setSchemaField = (idx: number, field: string, value: any) => {
    const arr = [...(editingCat.schema || [])];
    arr[idx] = { ...arr[idx], [field]: value };
    updateSchema(arr);
  };

  // ----- Brands -----
  const handleCreateBrand = async () => {
    const name = (prompt('ชื่อ Brand ใหม่ (ค่านี้ใช้เป็น join key กับ models และแก้ไม่ได้ภายหลัง)') || '').trim();
    if (!name) return;
    if (name.toLowerCase() === 'all') {
      toast.error('"All" เป็นค่าสงวนของระบบ ใช้ตั้งชื่อไม่ได้');
      return;
    }
    if (brands.some(b => b.name === name)) {
      toast.error('มี Brand ชื่อนี้อยู่แล้ว');
      return;
    }
    try {
      const maxOrder = brands.reduce((m, b) => Math.max(m, Number(b.order) || 0), 0);
      const newRef = push(ref(db, 'product_brands'));
      await update(newRef, { name, order: maxOrder + 1, active: true });
      toast.success('สร้าง Brand ใหม่เรียบร้อย');
    } catch {
      toast.error('เกิดข้อผิดพลาดในการสร้าง Brand');
    }
  };

  const handleUpdateBrand = async (id: string, patch: any) => {
    try {
      await update(ref(db, `product_brands/${id}`), patch);
    } catch {
      toast.error('บันทึก Brand ไม่สำเร็จ');
    }
  };

  const handleDeleteBrand = async (id: string, name: string) => {
    const used = modelsData.filter(m => m.brand === name).length;
    if (used > 0) {
      toast.error(`ลบไม่ได้! มีสินค้าผูกกับ Brand นี้อยู่ ${used} รายการ`);
      return;
    }
    if (confirm('ยืนยันการลบ Brand นี้ใช่หรือไม่?')) {
      try {
        await remove(ref(db, `product_brands/${id}`));
        toast.success('ลบ Brand สำเร็จ');
      } catch {
        toast.error('เกิดข้อผิดพลาดในการลบ Brand');
      }
    }
  };

  if (!isOpen) return null;

  const inputCls = 'w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[60] p-4 lg:p-10 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><LayoutGrid size={24} /></div>
            <div>
              <h3 className="font-black text-2xl text-slate-800">Categories & Brands</h3>
              <p className="text-sm text-slate-500 font-bold">จัดการหมวดสินค้า แบรนด์ และโครงสร้าง Attribute ของแต่ละหมวด</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={24} /></button>
        </div>

        {/* Tabs */}
        <div className="px-8 pt-4 flex gap-2 border-b shrink-0">
          <button onClick={() => setTab('categories')} className={`px-5 py-2.5 rounded-t-xl text-sm font-black flex items-center gap-2 transition-colors ${tab === 'categories' ? 'bg-slate-50 text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <LayoutGrid size={16} /> Categories
          </button>
          <button onClick={() => setTab('brands')} className={`px-5 py-2.5 rounded-t-xl text-sm font-black flex items-center gap-2 transition-colors ${tab === 'brands' ? 'bg-slate-50 text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <Tag size={16} /> Brands
          </button>
        </div>

        {tab === 'categories' ? (
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <div className="w-72 bg-slate-50 border-r p-6 flex flex-col gap-3 overflow-y-auto shrink-0">
              <button onClick={handleCreateCategory} className="w-full py-3 bg-white border border-dashed border-blue-300 text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition mb-2 flex items-center justify-center gap-2">
                <Plus size={18} /> สร้าง Category ใหม่
              </button>

              {[...categories].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map(cat => (
                <div key={cat.id} className={`p-4 rounded-2xl cursor-pointer border-2 transition-all group relative ${activeCatId === cat.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-transparent hover:border-slate-200 shadow-sm'}`} onClick={() => setActiveCatId(cat.id)}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activeCatId === cat.id ? 'text-blue-600' : 'text-slate-400'}`}>
                      {getCategoryIcon(cat.icon, 18)}
                    </div>
                    <div className="min-w-0">
                      <div className={`font-black text-sm truncate pr-6 ${activeCatId === cat.id ? 'text-blue-900' : 'text-slate-700'}`}>{cat.name}</div>
                      <div className="text-[10px] text-slate-400 font-medium truncate">{cat.active === false ? 'ซ่อนจากลูกค้า' : 'แสดงต่อลูกค้า'} · #{cat.order}</div>
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            {/* Editor */}
            <div className="flex-1 bg-white flex flex-col overflow-hidden">
              {editingCat ? (
                <>
                  <div className="p-8 pb-4 border-b flex justify-between items-center bg-white shrink-0 z-10">
                    <h3 className="text-xl font-black text-slate-800">แก้ไข: {editingCat.name}</h3>
                    <button onClick={handleSaveCategory} className="px-6 py-2.5 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 transition flex items-center gap-2 shadow-md">
                      <Save size={18} /> บันทึกการเปลี่ยนแปลง
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 space-y-8">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Basic Info</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Name (join key — แก้ไม่ได้)</label>
                          <input type="text" value={editingCat.name} disabled className="w-full p-3 bg-slate-100 rounded-xl border border-slate-200 font-bold text-slate-500 cursor-not-allowed" />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Label TH (ชื่อแสดงผลภาษาไทย)</label>
                          <input type="text" value={editingCat.label_th || ''} onChange={e => setEditingCat({ ...editingCat, label_th: e.target.value })} className={inputCls} placeholder="เช่น สมาร์ทโฟน" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Icon</label>
                          <div className="flex items-center gap-2">
                            <div className="w-11 h-11 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                              {getCategoryIcon(editingCat.icon, 20)}
                            </div>
                            <select value={editingCat.icon || 'package'} onChange={e => setEditingCat({ ...editingCat, icon: e.target.value })} className={inputCls}>
                              {CATEGORY_ICON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Order</label>
                          <input type="number" value={editingCat.order ?? 0} onChange={e => setEditingCat({ ...editingCat, order: Number(e.target.value) })} className={inputCls} />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Active (แสดงต่อลูกค้า)</label>
                          <button
                            type="button"
                            onClick={() => setEditingCat({ ...editingCat, active: editingCat.active === false })}
                            className={`w-full p-3 rounded-xl border font-black text-sm transition-colors ${editingCat.active !== false ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
                          >
                            {editingCat.active !== false ? 'Active' : 'Hidden'}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Route (หน้า landing บนเว็บลูกค้า)</label>
                          <input type="text" value={editingCat.route || ''} onChange={e => setEditingCat({ ...editingCat, route: e.target.value })} className={inputCls} placeholder="เช่น /iphone" />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-slate-500 block mb-1">Slug (kebab-case)</label>
                          <input type="text" value={editingCat.slug || ''} onChange={e => setEditingCat({ ...editingCat, slug: e.target.value })} className={inputCls} placeholder="เช่น smartphones" />
                        </div>
                      </div>
                    </div>

                    {/* Schema editor */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex justify-between items-center border-b pb-2 mb-4">
                        <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Attribute Schema</h4>
                        <button onClick={addSchemaRow} className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition flex items-center gap-1">
                          <Plus size={14} /> เพิ่ม Attribute
                        </button>
                      </div>

                      {(editingCat.schema || []).length === 0 ? (
                        <div className="text-center py-6 text-slate-400 font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">
                          ยังไม่มี Attribute
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {(editingCat.schema || []).map((row: any, idx: number) => (
                            <div key={idx} className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-3 rounded-xl border border-slate-100">
                              <div className="col-span-3">
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">Key</label>
                                <input type="text" value={row.key || ''} onChange={e => setSchemaField(idx, 'key', e.target.value)} className="w-full p-2 bg-white rounded-lg border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" placeholder="storage" />
                              </div>
                              <div className="col-span-3">
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">Label</label>
                                <input type="text" value={row.label || ''} onChange={e => setSchemaField(idx, 'label', e.target.value)} className="w-full p-2 bg-white rounded-lg border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500" placeholder="Storage" />
                              </div>
                              <div className="col-span-2">
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">Type</label>
                                <select value={row.type || 'text'} onChange={e => setSchemaField(idx, 'type', e.target.value)} className="w-full p-2 bg-white rounded-lg border border-slate-200 text-sm font-bold outline-none">
                                  <option value="text">text</option>
                                  <option value="select">select</option>
                                </select>
                              </div>
                              <div className="col-span-3">
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">Options (คั่นด้วย ,)</label>
                                <input
                                  type="text"
                                  disabled={row.type !== 'select'}
                                  value={Array.isArray(row.options) ? row.options.join(', ') : ''}
                                  onChange={e => setSchemaField(idx, 'options', e.target.value.split(',').map(s => s.trim()))}
                                  className="w-full p-2 bg-white rounded-lg border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-300"
                                  placeholder="A, B, C"
                                />
                              </div>
                              <div className="col-span-1 flex flex-col gap-1 pt-5">
                                <button onClick={() => moveSchemaRow(idx, -1)} className="p-1 text-slate-400 hover:text-blue-600 transition"><ArrowUp size={14} /></button>
                                <button onClick={() => moveSchemaRow(idx, 1)} className="p-1 text-slate-400 hover:text-blue-600 transition"><ArrowDown size={14} /></button>
                                <button onClick={() => removeSchemaRow(idx)} className="p-1 text-slate-400 hover:text-red-500 transition"><Trash2 size={14} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50/50">เลือกหรือสร้าง Category จากเมนูด้านซ้าย</div>}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
            <div className="max-w-3xl mx-auto">
              <button onClick={handleCreateBrand} className="w-full py-3 bg-white border border-dashed border-blue-300 text-blue-600 font-bold rounded-xl hover:bg-blue-50 transition mb-4 flex items-center justify-center gap-2">
                <Plus size={18} /> สร้าง Brand ใหม่
              </button>

              <div className="space-y-3">
                {[...brands].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map(brand => (
                  <div key={brand.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-4">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shrink-0"><Tag size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-slate-800 truncate">{brand.name}</div>
                      <div className="text-[10px] text-slate-400 font-bold">join key (แก้ไม่ได้)</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Order</label>
                        <input
                          type="number"
                          value={brand.order ?? 0}
                          onChange={e => handleUpdateBrand(brand.id, { order: Number(e.target.value) })}
                          className="w-20 p-2 bg-slate-50 rounded-lg border border-slate-200 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdateBrand(brand.id, { active: brand.active === false })}
                        className={`px-4 py-2 mt-4 rounded-lg border font-black text-xs transition-colors ${brand.active !== false ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
                      >
                        {brand.active !== false ? 'Active' : 'Hidden'}
                      </button>
                      <button onClick={() => handleDeleteBrand(brand.id, brand.name)} className="p-2 mt-4 text-slate-300 hover:text-red-500 transition">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryBrandManagementModal;
