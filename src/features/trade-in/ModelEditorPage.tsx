'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Smartphone, Image as ImageIcon, ClipboardList, Save, Upload, Loader2,
  Zap, List, ArrowRightLeft, Copy, AlertTriangle, ArrowLeft, Layers, Tag
} from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadImageToFirebase } from '../../utils/uploadImage';
import { CATEGORY_SCHEMAS, resolveCategorySchema } from './constants/categorySchemas';
import { ModifierPricingEditor } from './components/pricing/ModifierPricingEditor';
import { OptionImageEditor } from './components/pricing/OptionImageEditor';
import { PriceSimulatorPanel } from './components/pricing/PriceSimulatorPanel';
import { LegacyVariantEditor } from './components/pricing/LegacyVariantEditor';
import { UpgradePreviewPanel } from './components/pricing/UpgradePreviewPanel';
import { BuyingStatusBadge } from './components/pricing/BuyingStatusBadge';
import { detectModifiersFromLegacyVariants } from './utils/variantGenerator';
import type { DetectResult } from './utils/variantGenerator';
import { ACCESSORY_CATEGORY } from '../../utils/accessoryItems';
import { getModelReadiness, READINESS_ISSUE_LABELS } from './utils/modelReadiness';
// Tier->deduct conversion is shared with the Engine's bulk "แตกชุดรายรุ่น" tool.
import { representativeBasePrice, convertGroupsToSingleDeduct } from './utils/perModelConditionSets';

interface ModelEditorPageProps {
  editingItem: any;
  isNew: boolean;
  /** มีการแก้ไขที่ยังไม่ save — ใช้เตือนก่อนออกจากหน้า */
  isDirty: boolean;
  conditionSets: any[];
  availableSeries: any[];
  /** แคตตาล็อกทั้งหมด — ใช้ทำ checkbox ความเข้ากันได้ระดับรุ่นของ accessory */
  allModels?: any[];
  categories: any[];
  brands: any[];
  categorySchemas: typeof CATEGORY_SCHEMAS;
  onSave: () => void;
  /** กลับหน้า list (ตัวเรียกเป็นคน confirm เรื่อง unsaved changes แล้ว) */
  onClose: () => void;
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

// หน้าแก้ไขรุ่นแบบเต็มจอ (แทน ProductEditorModal เดิมบน desktop) — มี URL จริง
// (/pricing/:modelId) deep-link/refresh ได้, header โชว์ Buying Status สด,
// sticky save bar และ readiness checklist พร้อมปุ่มแก้ inline
export const ModelEditorPage: React.FC<ModelEditorPageProps> = ({
  editingItem,
  isNew,
  isDirty,
  conditionSets,
  availableSeries,
  allModels = [],
  categories,
  brands,
  categorySchemas,
  onSave,
  onClose,
  onEditingItemChange,
}) => {
  const [isAddingSeries, setIsAddingSeries] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState('');
  const [upgradePreview, setUpgradePreview] = useState<DetectResult | null>(null);

  // กันปิด tab / refresh ทิ้งงานที่แก้ค้าง (การ navigate ภายในแอปผ่าน onClose
  // ซึ่ง confirm ให้อยู่แล้วที่ตัวเรียก)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!editingItem) return null;

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
      const { db } = await import('../../api/firebase');
      const cloneName = `${source.name} (${editingItem.name || 'เฉพาะรุ่น'})`;
      const newRef = push(ref(db, 'settings/condition_sets'));
      // deep-clone so editing the clone doesn't mutate the source, then convert
      // legacy tier options to a single `deduct` at this model's price point —
      // per-model sets use one flat value (or pct), not tier buckets.
      const basePrice = representativeBasePrice(editingItem);
      const groups = convertGroupsToSingleDeduct(JSON.parse(JSON.stringify(source.groups || [])), basePrice);
      await update(newRef, { name: cloneName, groups });
      onEditingItemChange({ ...editingItem, conditionSetId: newRef.key });
      toast.success(`Clone เป็น "${cloneName}" และผูกกับรุ่นนี้แล้ว — ค่าหัก tier เดิมถูกแปลงเป็นค่าเดียวตามราคารุ่นนี้ (${basePrice.toLocaleString('th-TH')} บาท) แก้ต่อได้ที่ Condition Settings`);
    } catch {
      toast.error('Clone ชุดประเมินไม่สำเร็จ');
    }
  };

  const handleAddNewSeries = async () => {
    if (!newSeriesName.trim()) return toast.error('กรุณาพิมพ์ชื่อ Series ก่อนบันทึกครับ');
    try {
      const { ref, push, update } = await import('firebase/database');
      const { db } = await import('../../api/firebase');
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

  // Quick facts บนหัวหน้า — นับจากสถานะที่กำลังแก้ (สด ไม่ใช่ค่าที่ save แล้ว)
  const readiness = getModelReadiness(editingItem, conditionSets);
  const assignedSet = conditionSets.find(cs => cs.id === editingItem.conditionSetId);
  const variantPrices = (editingItem.variants || [])
    .map((v: any) => Number(v?.usedPrice || v?.price || 0))
    .filter((p: number) => p > 0);
  const priceMin = variantPrices.length ? Math.min(...variantPrices) : 0;
  const priceMax = variantPrices.length ? Math.max(...variantPrices) : 0;

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="p-4 lg:p-6 max-w-[1600px] mx-auto pb-4">

        {/* Breadcrumb */}
        <div className="mb-1 text-xs font-bold text-slate-400">
          Settings <span className="mx-1 text-slate-300">&rsaquo;</span>
          <button onClick={onClose} className="hover:text-blue-600 transition">Catalog</button>
          <span className="mx-1 text-slate-300">&rsaquo;</span>
          <span className="text-slate-600">{isNew ? 'New Model' : (editingItem.name || 'Edit Model')}</span>
        </div>

        {/* Page header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={onClose} className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-blue-600 hover:border-blue-300 transition shrink-0" title="กลับหน้า Catalog">
              <ArrowLeft size={18} />
            </button>
            <div className="w-12 h-12 bg-white border border-slate-200 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden">
              {editingItem.imageUrl
                ? <img src={editingItem.imageUrl} alt={editingItem.name} className="max-h-full p-1 object-contain" />
                : <Smartphone size={22} className="text-blue-500" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-black text-slate-900 truncate">
                  {isNew ? 'Add New Model' : (editingItem.name || 'Edit Model')}
                </h1>
                <BuyingStatusBadge item={editingItem} conditionSets={conditionSets} />
              </div>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                {[editingItem.brand, editingItem.series, editingItem.category].filter(Boolean).join(' · ')}
                <span className="mx-2 text-slate-300">|</span>
                {isModifier ? 'Modifier-Based Pricing' : 'Legacy Variant Pricing'}
              </p>
            </div>
          </div>

          {/* Quick facts */}
          <div className="flex gap-2 flex-wrap shrink-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl">
              <Layers size={13} className="text-blue-500" /> {editingItem.variants?.length || 0} ตัวเลือก
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl">
              <Tag size={13} className="text-emerald-500" />
              {priceMax > 0
                ? `รับซื้อ ${priceMin.toLocaleString('th-TH')}${priceMax !== priceMin ? ` - ${priceMax.toLocaleString('th-TH')}` : ''} บาท`
                : 'ยังไม่มีราคารับซื้อ'}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl max-w-[220px]">
              <ClipboardList size={13} className="text-indigo-500 shrink-0" />
              <span className="truncate">{assignedSet?.name || 'ยังไม่มีชุดประเมิน'}</span>
            </span>
          </div>
        </div>

        {/* Readiness checklist (Reusely-style empty state): บอกว่ารุ่นนี้ขาด
            config อะไรถึงจะรับซื้อได้จริง พร้อมปุ่มแก้ตรงนี้เลย — หายเอง
            ทันทีที่แก้ครบเพราะคำนวณสดจาก editingItem */}
        {!readiness.ready && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-black text-amber-800">
                  {editingItem.name ? `"${editingItem.name}" ` : 'รุ่นนี้'}ยังไม่พร้อมเปิดรับซื้อ — ตั้งค่าให้ครบก่อน ลูกค้าถึงจะขายรุ่นนี้ได้
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {readiness.issues.map(i => (
                    <li key={i} className="text-xs font-bold text-amber-700">
                      - {READINESS_ISSUE_LABELS[i]}
                      {i === 'condition_group' && ' — เลือกได้ที่ข้อ 2 (Assign Condition Item)'}
                      {i === 'pricing' && ' — กรอกได้ที่ข้อ 3 (Pricing)'}
                    </li>
                  ))}
                </ul>
                {readiness.issues.includes('purchasing_method') && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {([['inStore', 'เปิด In-store'], ['pickup', 'เปิด Pickup'], ['mailIn', 'เปิด Mail-in']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onEditingItemChange({ ...editingItem, [key]: true })}
                        className="px-3 py-1.5 text-xs font-bold text-amber-700 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 transition"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

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
                    <select value={editingItem.series || ''} onChange={(e) => onEditingItemChange({ ...editingItem, series: e.target.value })} className="w-full min-w-0 p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 transition-colors outline-none">
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
                {/* ชื่อภาษาอังกฤษ (ไม่บังคับ) — เว็บลูกค้าใช้แสดงบน /en, ชื่อไทยยังเป็นค่าหลัก */}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[9px] font-black text-sky-600 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 shrink-0" title="ชื่อภาษาอังกฤษ (ไม่บังคับ)">EN</span>
                  <input
                    type="text"
                    placeholder="English name (optional)"
                    title="ชื่อภาษาอังกฤษ (ไม่บังคับ)"
                    value={editingItem.label_en || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...editingItem };
                      if (v) next.label_en = v; else delete next.label_en;
                      onEditingItemChange(next);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-50 text-xs font-medium text-slate-600 focus:ring-2 focus:ring-sky-300 outline-none placeholder:text-slate-300"
                  />
                </div>
                {/* ชื่อเรียกทั่วไป (alias สำหรับค้นหา) — 1 รุ่นมี 3 ชื่อ:
                    ชื่อทางการ Apple (ช่องบน) + ชื่อที่คนทั่วไปเรียกไทย/อังกฤษ
                    (2 ช่องนี้). AI แชทและระบบค้นหาจับคู่จากทุกชื่อ — ลูกค้า
                    พิมพ์ "ไอแพดแอร์ 8" หรือ "iPad Air 8" ก็เจอรุ่นนี้ */}
                <p className="text-[10px] font-bold text-slate-400 mt-2 mb-1">ชื่อเรียกทั่วไป (ให้ AI/ระบบค้นหาจับคู่ได้ — ไม่แสดงหน้าเว็บ)</p>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 shrink-0" title="ชื่อเรียกภาษาไทย (ไม่บังคับ)">ไทย</span>
                  <input
                    type="text"
                    placeholder='เช่น "ไอแพดแอร์ 8" (ไม่บังคับ)'
                    title="ชื่อที่คนทั่วไปเรียกภาษาไทย"
                    value={editingItem.alias_th || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...editingItem };
                      if (v) next.alias_th = v; else delete next.alias_th;
                      onEditingItemChange(next);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-50 text-xs font-medium text-slate-600 focus:ring-2 focus:ring-amber-300 outline-none placeholder:text-slate-300"
                  />
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[9px] font-black text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 shrink-0" title="ชื่อเรียกภาษาอังกฤษ (ไม่บังคับ)">Alias</span>
                  <input
                    type="text"
                    placeholder='เช่น "iPad Air 8" (ไม่บังคับ)'
                    title="ชื่อที่คนทั่วไปเรียกภาษาอังกฤษ"
                    value={editingItem.alias_en || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...editingItem };
                      if (v) next.alias_en = v; else delete next.alias_en;
                      onEditingItemChange(next);
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-100 bg-slate-50 text-xs font-medium text-slate-600 focus:ring-2 focus:ring-amber-300 outline-none placeholder:text-slate-300"
                  />
                </div>
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

              {/* Option Images — รูปเฉพาะตัวเลือก (modifier mode เท่านั้น) */}
              {isModifier && (
                <OptionImageEditor editingItem={editingItem} onEditingItemChange={onEditingItemChange} />
              )}
            </div>

            {/* Trade-in Settings */}
            <div className="bg-white p-6 rounded-[1.5rem] shadow-sm border border-slate-200 space-y-5">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-3">2. Trade-in Settings</h4>
              <label className="text-xs font-bold text-slate-500 block -mb-2">วิธีรับซื้อ (Purchasing Method)</label>
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

              {/* Make Offer — ลูกค้าเสนอราคาเองจากหน้าสรุปประเมิน (opt-in รายรุ่น) */}
              <label className="text-xs font-bold text-slate-500 block -mb-2">เสนอราคาเอง (Make Offer)</label>
              <div className="space-y-3 bg-amber-50/60 p-4 rounded-xl border border-amber-100">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={editingItem.allowCustomerOffer === true} onChange={(e) => onEditingItemChange({ ...editingItem, allowCustomerOffer: e.target.checked })} className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500" />
                  <span className="text-sm font-bold text-slate-700">เปิดให้ลูกค้าเสนอราคาเองสำหรับรุ่นนี้</span>
                </label>
                {editingItem.allowCustomerOffer === true && (
                  <div className="ml-7 pt-1">
                    <label className="text-[11px] font-bold text-slate-500 mb-1 block">เพดานเสนอเกินราคาประเมิน (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      placeholder="ไม่กรอก = 15%"
                      value={editingItem.offerMaxPct || ''}
                      onChange={(e) => onEditingItemChange({ ...editingItem, offerMaxPct: Number(e.target.value) || undefined })}
                      className="w-full p-2.5 bg-white rounded-lg border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-amber-500 outline-none"
                    />
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">ลูกค้าเห็นกรอบนี้ตอนเสนอราคา — เพดานรับอัตโนมัติ (Auto-Accept) ตั้งแยกที่หน้าตั้งค่า Make Offer เพราะเป็นค่าลับที่ลูกค้าห้ามเห็น</p>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-black text-indigo-600 mb-2 block flex items-center gap-1"><ClipboardList size={14} /> Assign Condition Item</label>
                <div className="flex gap-2">
                  {/* min-w-0: select เป็น flex item — ถ้าไม่ใส่ browser จะไม่ยอมหด
                      ต่ำกว่าความกว้างข้อความ option แล้วดันล้นออกนอก card เมื่อ
                      ชื่อชุดประเมินยาว */}
                  <select className="flex-1 min-w-0 p-4 bg-indigo-50 rounded-xl border border-indigo-200 text-sm font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none" value={editingItem.conditionSetId} onChange={(e) => onEditingItemChange({ ...editingItem, conditionSetId: e.target.value })}>
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

              {/* iPad ที่ใช้ร่วมกันได้ — เฉพาะรุ่นอุปกรณ์เสริม. ระดับ "รุ่น" (เก็บ
                  model id — convention เดียวกับ coupon applicable_models) เพราะ
                  ระดับ series หยาบไป เช่น Pencil 2 ใช้กับ iPad Pro M4 ไม่ได้.
                  จัดกลุ่มตาม series + ปุ่มเลือกทั้งกลุ่ม. ไม่ติ๊กเลย = ทุกรุ่น */}
              {editingItem.category === ACCESSORY_CATEGORY && (() => {
                const ipadModels = (allModels || []).filter((m: any) => m?.category === 'Tablets' && m.id && m.name);
                const groups = ipadModels.reduce((acc: Record<string, any[]>, m: any) => {
                  const key = String(m.series || 'อื่นๆ').trim() || 'อื่นๆ';
                  (acc[key] = acc[key] || []).push(m);
                  return acc;
                }, {});
                const selected: string[] = Array.isArray(editingItem.compatible_models) ? editingItem.compatible_models : [];
                const setSelected = (next: string[]) => onEditingItemChange({ ...editingItem, compatible_models: next });
                return (
                  <div>
                    <label className="text-xs font-black text-blue-600 mb-2 block flex items-center gap-1"><Smartphone size={14} /> Compatible iPad Models (ใช้ร่วมกับ — ระดับรุ่น)</label>
                    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-4 max-h-72 overflow-y-auto">
                      {ipadModels.length === 0 && (
                        <p className="text-[10px] font-bold text-slate-400">ยังไม่มีรุ่น iPad ในระบบ</p>
                      )}
                      {Object.entries(groups).map(([groupName, models]) => {
                        const ids = (models as any[]).map((m: any) => m.id);
                        const allChecked = ids.length > 0 && ids.every(id => selected.includes(id));
                        return (
                          <div key={groupName}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">{groupName}</span>
                              <button
                                type="button"
                                onClick={() => setSelected(allChecked
                                  ? selected.filter(id => !ids.includes(id))
                                  : Array.from(new Set([...selected, ...ids])))}
                                className="text-[10px] font-bold text-blue-600 hover:underline"
                              >
                                {allChecked ? 'เอาออกทั้งกลุ่ม' : 'เลือกทั้งกลุ่ม'}
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              {(models as any[]).map((m: any) => {
                                const checked = selected.includes(m.id);
                                return (
                                  <label key={m.id} className="flex items-center gap-3 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => setSelected(e.target.checked
                                        ? [...selected, m.id]
                                        : selected.filter(id => id !== m.id))}
                                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className={`text-xs font-bold ${m.isActive === false ? 'text-slate-400' : 'text-slate-700'}`}>
                                      {String(m.name).trim()}{m.isActive === false ? ' (งดรับซื้อ)' : ''}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 font-medium">
                      ไม่ติ๊กเลย = เสนอเป็น add-on กับ iPad ทุกรุ่น · เลือกแล้ว {selected.length} รุ่น
                      {Array.isArray(editingItem.compatible_series) && editingItem.compatible_series.length > 0 && selected.length === 0
                        ? ` · ข้อมูลเดิมระดับ series (${editingItem.compatible_series.join(', ')}) ยังใช้อยู่จนกว่าจะเลือกระดับรุ่น`
                        : ''}
                    </p>
                  </div>
                );
              })()}

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

              {/* Pricing Content — โตตามเนื้อหา ไม่มี scroll ซ้อนแบบ modal เดิม */}
              <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-200 flex-1">
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

      {/* Sticky save bar */}
      <div className="sticky bottom-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.15)]">
        <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-4 flex items-center justify-between gap-4">
          <p className="text-xs font-bold text-slate-400 truncate">
            {isDirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'ไม่มีการแก้ไขค้าง'}
          </p>
          <div className="flex gap-3 shrink-0">
            <button onClick={onClose} className="px-8 py-3 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">Cancel</button>
            <button onClick={onSave} className="px-10 py-3 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition active:scale-95 flex items-center gap-2">
              <Save size={18} /> Save & Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelEditorPage;
