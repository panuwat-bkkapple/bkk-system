'use client';

import React, { useState, useRef } from 'react';
import {
  Smartphone, X, Image as ImageIcon, ClipboardList, Save, Upload, Loader2,
  Zap, List, ArrowRightLeft, Copy
} from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadImageToFirebase } from '../../../utils/uploadImage';
import { CATEGORY_SCHEMAS, resolveCategorySchema } from '../constants/categorySchemas';
import { ModifierPricingEditor } from '../components/pricing/ModifierPricingEditor';
import { PriceSimulatorPanel } from '../components/pricing/PriceSimulatorPanel';
import { LegacyVariantEditor } from '../components/pricing/LegacyVariantEditor';
import { UpgradePreviewPanel } from '../components/pricing/UpgradePreviewPanel';
import { detectModifiersFromLegacyVariants } from '../utils/variantGenerator';
import type { DetectResult } from '../utils/variantGenerator';
import { tierDeduction } from '../../../utils/pricingResolver';

/**
 * Representative used-price of a model for converting LEGACY tier options into
 * a single flat `deduct` while cloning a per-model condition set: median of the
 * variants' used prices, falling back to the modifier-mode base prices.
 */
function representativeBasePrice(model: any): number {
  const prices = (model?.variants || [])
    .map((v: any) => Number(v?.usedPrice || v?.price || 0))
    .filter((p: number) => p > 0)
    .sort((a: number, b: number) => a - b);
  if (prices.length > 0) return prices[Math.floor(prices.length / 2)];
  return Number(model?.baseUsedPrice || 0) || Number(model?.baseNewPrice || 0) || 0;
}

/**
 * Convert cloned groups off the legacy tier system: each option that still
 * relies on t1/t2/t3 gets a single `deduct` resolved at the model's
 * representative price; options already on `deduct`/`pct` just drop stale tiers.
 */
function convertGroupsToSingleDeduct(groups: any[], basePrice: number): any[] {
  return (groups || []).map((g: any) => ({
    ...g,
    options: (g?.options || []).map((o: any) => {
      const next: any = { ...o };
      if (next.deduct == null && next.pct == null && (next.t1 != null || next.t2 != null || next.t3 != null)) {
        next.deduct = tierDeduction(next, basePrice);
      }
      delete next.t1;
      delete next.t2;
      delete next.t3;
      return next;
    }),
  }));
}

interface ProductEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingItem: any;
  conditionSets: any[];
  availableSeries: any[];
  categories: any[];
  brands: any[];
  categorySchemas: typeof CATEGORY_SCHEMAS;
  onSave: () => void;
  onEditingItemChange: (item: any) => void;
}

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
  categories,
  brands,
  categorySchemas,
  onSave,
  onEditingItemChange,
}) => {
  const [isAddingSeries, setIsAddingSeries] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [upgradePreview, setUpgradePreview] = useState<DetectResult | null>(null);

  if (!isOpen || !editingItem) return null;

  const pricingMode = editingItem.pricingMode || 'legacy';
  const isModifier = pricingMode === 'modifier';

  const handleCategoryChange = (newCat: string) => {
    const schema = resolveCategorySchema(newCat, categories);
    const newItem: any = { ...editingItem, category: newCat, attributesSchema: schema };
    // Reset modifiers เมื่อเปลี่ยน category (initialize empty options per attribute)
    if (isModifier) {
      const mods: Record<string, { options: any[] }> = {};
      for (const attr of schema) {
        mods[attr.key] = editingItem.attributeModifiers?.[attr.key] || { options: [] };
      }
      newItem.attributeModifiers = mods;
    }
    onEditingItemChange(newItem);
  };

  const handleSwitchToModifier = () => {
    const schema = editingItem.attributesSchema || categorySchemas[editingItem.category] || categorySchemas['Smartphones'];
    const hasVariants = (editingItem.variants || []).some((v: any) => v.attributes && Object.keys(v.attributes).length > 0);

    if (hasVariants) {
      // มี variants เดิม → แสดง preview ก่อน
      const result = detectModifiersFromLegacyVariants(editingItem.variants || [], schema);
      setUpgradePreview(result);
    } else {
      // ไม่มี variants → switch ตรง
      const mods: Record<string, { options: any[] }> = {};
      for (const attr of schema) mods[attr.key] = { options: [] };
      onEditingItemChange({ ...editingItem, pricingMode: 'modifier', baseNewPrice: 0, baseUsedPrice: 0, attributeModifiers: mods });
      toast.success('เปลี่ยนเป็น Modifier Mode');
    }
  };

  const handleConfirmUpgrade = () => {
    if (!upgradePreview) return;
    const schema = editingItem.attributesSchema || categorySchemas[editingItem.category] || categorySchemas['Smartphones'];
    const fullModifiers: Record<string, { options: any[] }> = {};
    for (const attr of schema) {
      fullModifiers[attr.key] = upgradePreview.modifiers[attr.key] || { options: [] };
    }
    onEditingItemChange({
      ...editingItem,
      pricingMode: 'modifier',
      baseNewPrice: upgradePreview.baseNewPrice,
      baseUsedPrice: upgradePreview.baseUsedPrice,
      attributeModifiers: fullModifiers,
    });
    setUpgradePreview(null);
    toast.success(`อัพเกรดสำเร็จ! ตรง ${upgradePreview.matchedCount}/${upgradePreview.totalCount} variants`);
  };

  const handleSwitchToLegacy = () => {
    onEditingItemChange({ ...editingItem, pricingMode: 'legacy' });
    toast.success('เปลี่ยนกลับเป็น Legacy Mode');
  };

  const handleCloneConditionSet = async () => {
    const source = conditionSets.find(cs => cs.id === editingItem.conditionSetId);
    if (!source) return toast.error('เลือกชุดประเมินต้นทางก่อน Clone ครับ');
    try {
      const { ref, push, update } = await import('firebase/database');
      const { db } = await import('../../../api/firebase');
      const cloneName = `${source.name} (${editingItem.name || 'เฉพาะรุ่น'})`;
      const newRef = push(ref(db, 'settings/condition_sets'));
      // deep-clone so editing the clone doesn't mutate the source, then convert
      // legacy tier options to a single `deduct` at this model's price point —
      // per-model sets use one flat value (or pct), not tier buckets.
      const basePrice = representativeBasePrice(editingItem);
      const groups = convertGroupsToSingleDeduct(JSON.parse(JSON.stringify(source.groups || [])), basePrice);
      await update(newRef, { name: cloneName, groups });
      onEditingItemChange({ ...editingItem, conditionSetId: newRef.key });
      toast.success(`Clone เป็น "${cloneName}" และผูกกับรุ่นนี้แล้ว — ค่าหัก tier เดิมถูกแปลงเป็นค่าเดียวตามราคารุ่นนี้ (${basePrice.toLocaleString('th-TH')} บาท) แก้ต่อได้ที่ Condition Sets Engine`);
    } catch {
      toast.error('Clone ชุดประเมินไม่สำเร็จ');
    }
  };

  const handleAddNewSeries = async () => {
    if (!newSeriesName.trim()) return toast.error('กรุณาพิมพ์ชื่อ Series ก่อนบันทึกครับ');
    try {
      const { ref, push, update } = await import('firebase/database');
      const { db } = await import('../../../api/firebase');
      const newRef = push(ref(db, 'series'));
      await update(newRef, {
        name: newSeriesName.trim(),
        brand: editingItem.brand || 'Apple',
        category: editingItem.category || 'Tablets',
        subcategory: '',
      });
      toast.success(`เพิ่ม Series: ${newSeriesName} สำเร็จ!`);
      onEditingItemChange({ ...editingItem, series: newSeriesName.trim() });
      setNewSeriesName('');
      setIsAddingSeries(false);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการเพิ่ม Series');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-50 p-4 lg:p-10">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[1400px] h-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-8 py-5 border-b flex justify-between items-center bg-white shrink-0 z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
              <Smartphone size={24} />
            </div>
            <div>
              <h3 className="font-black text-2xl text-slate-800">
                {editingItem.id.length > 15 ? 'Edit Model' : 'Add New Model'}
              </h3>
              <p className="text-sm font-bold text-slate-400">
                {isModifier ? 'Modifier-Based Pricing' : 'Legacy Variant Pricing'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-full transition">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 max-w-7xl mx-auto w-full">

            {/* Left Column (Info & Settings) */}
            <div className="xl:col-span-4 space-y-6">
              {/* General Info */}
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
                      {categories.map(c => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1.5 block">Brand</label>
                    <select className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.brand} onChange={(e) => onEditingItemChange({ ...editingItem, brand: e.target.value })}>
                      {brands.map(b => <option key={b.id || b.name} value={b.name}>{b.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Series */}
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

                {/* Model Name */}
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1.5 block">Model Name (ชื่อรุ่น)</label>
                  <input type="text" placeholder="เช่น MacBook Pro 14 นิ้ว..." className="w-full p-3 bg-white rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500" value={editingItem.name} onChange={(e) => onEditingItemChange({ ...editingItem, name: e.target.value })} />
                </div>

                {/* Image */}
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

              {/* Trade-in Settings */}
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
                  {editingItem.pickup && (
                    <div className="ml-7 pt-1">
                      <label className="text-[11px] font-bold text-slate-500 mb-1 block">จำกัดระยะรับถึงที่ (กม.)</label>
                      <input
                        type="number"
                        min={0}
                        placeholder="0 = ไม่จำกัด"
                        value={editingItem.maxPickupDistanceKm || ''}
                        onChange={(e) => onEditingItemChange({ ...editingItem, maxPickupDistanceKm: Number(e.target.value) })}
                        className="w-full p-2.5 bg-white rounded-lg border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <p className="text-[10px] text-slate-400 mt-1 font-medium">เกินระยะนี้ลูกค้าจะเลือก Pickup ไม่ได้ (เหลือสาขา/พัสดุ) — เหมาะกับของมูลค่าต่ำที่ไม่คุ้มวิ่งไปรับ</p>
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={editingItem.mailIn} onChange={(e) => onEditingItemChange({ ...editingItem, mailIn: e.target.checked })} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-bold text-slate-700">ส่งพัสดุ (Mail-in)</span>
                  </label>
                </div>
                <div>
                  <label className="text-xs font-black text-indigo-600 mb-2 block flex items-center gap-1"><ClipboardList size={14} /> Assign Condition Item</label>
                  <div className="flex gap-2">
                    <select className="flex-1 p-4 bg-indigo-50 rounded-xl border border-indigo-200 text-sm font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none" value={editingItem.conditionSetId} onChange={(e) => onEditingItemChange({ ...editingItem, conditionSetId: e.target.value })}>
                      <option value="" disabled>-- เลือกชุดประเมินสภาพที่ตรงกับสินค้านี้ --</option>
                      {conditionSets.map(set => (<option key={set.id} value={set.id}>{set.name}</option>))}
                    </select>
                    <button
                      type="button"
                      onClick={handleCloneConditionSet}
                      disabled={!editingItem.conditionSetId}
                      title="Clone ชุดประเมินนี้เป็นของรุ่นนี้โดยเฉพาะ แล้วแก้ค่าแยกได้"
                      className="px-3 bg-white text-indigo-600 rounded-xl font-bold border border-indigo-200 hover:bg-indigo-50 transition-colors text-xs whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Copy size={14} className="inline mr-1" />Clone
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black text-emerald-600 mb-2 block flex items-center gap-1"><ArrowRightLeft size={14} /> Liquidity Factor (ตัวคูณส่วนลดสภาพ)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    placeholder="1.0"
                    value={editingItem.liquidityFactor ?? ''}
                    onChange={(e) => onEditingItemChange({ ...editingItem, liquidityFactor: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className="w-full p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-sm font-bold text-emerald-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 font-medium">1.0 = ปกติ · มากกว่า 1 = หักหนักขึ้น (สภาพคล่องต่ำ ขายออกยาก) · น้อยกว่า 1 = หักเบาลง (ของขายดี). คูณกับส่วนลดทุกข้อในชุดประเมิน</p>
                </div>
              </div>
            </div>

            {/* Right Column - Pricing Mode */}
            <div className="xl:col-span-8">
              <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 h-full flex flex-col">
                {/* Mode Switcher Header */}
                <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-4">
                  <div>
                    <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                      3. {isModifier ? 'Attribute-Based Pricing' : 'Variant Pricing (Legacy)'}
                    </h4>
                    <p className="text-[10px] text-emerald-500 font-bold mt-1">
                      {isModifier
                        ? 'ตั้งราคาฐาน + ส่วนต่างแต่ละ option → ระบบคำนวณทุก combination อัตโนมัติ'
                        : 'กรอกราคาแต่ละ variant ทีละตัว'}
                    </p>
                  </div>

                  {/* Mode Toggle */}
                  <button
                    onClick={isModifier ? handleSwitchToLegacy : handleSwitchToModifier}
                    className={`text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm border-2 ${
                      isModifier
                        ? 'text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100'
                        : 'text-violet-600 bg-violet-50 border-violet-100 hover:bg-violet-600 hover:text-white hover:border-violet-600'
                    }`}
                  >
                    {isModifier ? (
                      <><List size={14} /> Legacy Mode</>
                    ) : (
                      <><Zap size={14} /> Modifier Mode</>
                    )}
                    <ArrowRightLeft size={12} />
                  </button>
                </div>

                {/* Pricing Content */}
                <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 flex-1 overflow-y-auto">
                  {upgradePreview ? (
                    <UpgradePreviewPanel
                      result={upgradePreview}
                      onConfirm={handleConfirmUpgrade}
                      onCancel={() => setUpgradePreview(null)}
                    />
                  ) : isModifier ? (
                    <ModifierPricingEditor
                      editingItem={editingItem}
                      onEditingItemChange={onEditingItemChange}
                    />
                  ) : (
                    <LegacyVariantEditor
                      editingItem={editingItem}
                      categorySchemas={categorySchemas}
                      onEditingItemChange={onEditingItemChange}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Full-width price simulator below both columns */}
            <div className="xl:col-span-12">
              <PriceSimulatorPanel model={editingItem} conditionSets={conditionSets} />
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t bg-white flex justify-end gap-4 shrink-0 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] z-10">
          <button onClick={onClose} className="px-8 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">Cancel</button>
          <button onClick={onSave} className="px-10 py-3 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition active:scale-95 flex items-center gap-2">
            <Save size={18} /> Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductEditorModal;
