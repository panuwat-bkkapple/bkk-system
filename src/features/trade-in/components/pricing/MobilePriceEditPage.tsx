'use client';

import React, { useRef, useState } from 'react';
import {
  ChevronLeft, Save, Image as ImageIcon, Upload, Loader2, ToggleLeft, ToggleRight,
  ClipboardList, Ticket, Package, Recycle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadImageToFirebase } from '../../../../utils/uploadImage';
import { CATEGORY_SCHEMAS } from '../../constants/categorySchemas';
import { ModifierPricingEditor } from './ModifierPricingEditor';
import { LegacyVariantEditor } from './LegacyVariantEditor';

interface MobilePriceEditPageProps {
  editingItem: any;
  conditionSets: any[];
  coupons?: any[];
  availableSeries: any[];
  onEditingItemChange: (item: any) => void;
  onSave: () => void;
  onClose: () => void;
}

const categories = ['Smartphones', 'Tablets', 'Mac / Laptop', 'Smart Watch', 'Camera', 'Game System'];
const brands = ['Apple', 'Samsung', 'Google', 'Oppo', 'Vivo', 'Sony', 'Nintendo'];

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
        className="px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm shrink-0 disabled:opacity-50 flex items-center"
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
      </button>
    </>
  );
};

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">{children}</h4>
);

export const MobilePriceEditPage: React.FC<MobilePriceEditPageProps> = ({
  editingItem,
  conditionSets,
  coupons = [],
  availableSeries,
  onEditingItemChange,
  onSave,
  onClose,
}) => {
  if (!editingItem) return null;

  const pricingMode = editingItem.pricingMode || 'legacy';
  const isModifier = pricingMode === 'modifier';
  const isNew = !editingItem.id || editingItem.id.length <= 15;

  // Promo include/exclude is owned by the coupon side (read-only here, same
  // cross-reference the desktop badges use). We never write it onto the model.
  const excludedCount = coupons.filter(c => Array.isArray(c.excluded_models) && c.excluded_models.includes(editingItem.id)).length;
  const includedCount = coupons.filter(c => Array.isArray(c.applicable_models) && c.applicable_models.length > 0 && c.applicable_models.includes(editingItem.id)).length;

  // Same schema-reset behaviour as the desktop modal's handleCategoryChange.
  const handleCategoryChange = (newCat: string) => {
    const schema = CATEGORY_SCHEMAS[newCat] || CATEGORY_SCHEMAS['Smartphones'];
    const newItem: any = { ...editingItem, category: newCat, attributesSchema: schema };
    if (isModifier) {
      const mods: Record<string, { options: any[] }> = {};
      for (const attr of schema) {
        mods[attr.key] = editingItem.attributeModifiers?.[attr.key] || { options: [] };
      }
      newItem.attributeModifiers = mods;
    }
    onEditingItemChange(newItem);
  };

  const seriesOptions = availableSeries.filter(
    s => s.brand === editingItem.brand && s.category === editingItem.category
  );

  const inputCls = 'w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none';

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 flex flex-col">
      {/* Sticky header: back + title + save */}
      <div className="bg-white border-b border-slate-200 px-3 py-2.5 flex items-center justify-between gap-2 shrink-0 safe-top">
        <button onClick={onClose} className="p-2 -ml-1 text-slate-500 hover:text-slate-700">
          <ChevronLeft size={24} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-sm font-black text-slate-800 truncate">
            {isNew ? 'เพิ่มรุ่นใหม่' : (editingItem.name || 'แก้ราคา')}
          </h1>
          <p className="text-[10px] font-bold text-slate-400">{isModifier ? 'Modifier Pricing' : 'Legacy Pricing'}</p>
        </div>
        <button
          onClick={onSave}
          className="px-4 py-2 rounded-xl text-sm font-black text-white bg-blue-600 active:scale-95 transition-transform flex items-center gap-1.5 shrink-0"
        >
          <Save size={16} /> บันทึก
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* General info */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <SectionTitle>ข้อมูลรุ่น</SectionTitle>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">ชื่อรุ่น</label>
              <input
                type="text"
                placeholder="เช่น iPhone 15 Pro Max"
                className={inputCls}
                value={editingItem.name || ''}
                onChange={(e) => onEditingItemChange({ ...editingItem, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">รูปสินค้า</label>
              <div className="flex gap-2">
                <div className="w-12 h-12 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center shrink-0">
                  {editingItem.imageUrl
                    ? <img src={editingItem.imageUrl} alt="preview" className="max-h-full p-1 object-contain" />
                    : <ImageIcon size={20} className="text-slate-300" />}
                </div>
                <input
                  type="text"
                  placeholder="https://..."
                  className={inputCls + ' flex-1'}
                  value={editingItem.imageUrl || ''}
                  onChange={(e) => onEditingItemChange({ ...editingItem, imageUrl: e.target.value })}
                />
                <ImageUploadButton onUploaded={(url) => onEditingItemChange({ ...editingItem, imageUrl: url })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Category</label>
                <select className={inputCls} value={editingItem.category} onChange={(e) => handleCategoryChange(e.target.value)}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Brand</label>
                <select className={inputCls} value={editingItem.brand} onChange={(e) => onEditingItemChange({ ...editingItem, brand: e.target.value })}>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Series (ตระกูล) — Optional</label>
              <select
                className={inputCls}
                value={editingItem.series || ''}
                onChange={(e) => onEditingItemChange({ ...editingItem, series: e.target.value })}
              >
                <option value="">-- ไม่ระบุ --</option>
                {seriesOptions.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-black text-indigo-600 mb-1 flex items-center gap-1"><ClipboardList size={14} /> ชุดประเมินสภาพ</label>
              <select
                className="w-full p-3 bg-indigo-50 rounded-xl border border-indigo-200 text-sm font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                value={editingItem.conditionSetId || ''}
                onChange={(e) => onEditingItemChange({ ...editingItem, conditionSetId: e.target.value })}
              >
                <option value="" disabled>-- เลือกชุดประเมิน --</option>
                {conditionSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Trade-in flags */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <SectionTitle>การรับซื้อ</SectionTitle>

          {/* Active toggle */}
          <button
            onClick={() => onEditingItemChange({ ...editingItem, isActive: !editingItem.isActive })}
            className={`w-full flex items-center justify-between p-3 rounded-xl border mb-3 font-black text-sm transition-colors ${
              editingItem.isActive
                ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                : 'bg-slate-50 text-slate-400 border-slate-200'
            }`}
          >
            <span>{editingItem.isActive ? 'เปิดรับซื้อรุ่นนี้' : 'ปิดรับซื้อรุ่นนี้'}</span>
            {editingItem.isActive ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
          </button>

          <div className="space-y-2.5 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={!!editingItem.inStore} onChange={(e) => onEditingItemChange({ ...editingItem, inStore: e.target.checked })} className="w-5 h-5 rounded text-blue-600" />
              <span className="text-sm font-bold text-slate-700">หน้าร้าน (In-Store)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={!!editingItem.pickup} onChange={(e) => onEditingItemChange({ ...editingItem, pickup: e.target.checked })} className="w-5 h-5 rounded text-blue-600" />
              <span className="text-sm font-bold text-slate-700">แมสเซนเจอร์ (Pickup)</span>
            </label>
            {editingItem.pickup && (
              <div className="ml-8">
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">จำกัดระยะรับถึงที่ (กม.)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0 = ไม่จำกัด"
                  value={editingItem.maxPickupDistanceKm || ''}
                  onChange={(e) => onEditingItemChange({ ...editingItem, maxPickupDistanceKm: Number(e.target.value) })}
                  className="w-full p-2.5 bg-white rounded-lg border border-slate-200 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            )}
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={!!editingItem.mailIn} onChange={(e) => onEditingItemChange({ ...editingItem, mailIn: e.target.checked })} className="w-5 h-5 rounded text-blue-600" />
              <span className="text-sm font-bold text-slate-700">ส่งพัสดุ (Mail-in)</span>
            </label>
          </div>

          {/* Promo — read-only, owned by coupon side */}
          {(includedCount > 0 || excludedCount > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
              <Ticket size={13} className="text-slate-400" />
              {includedCount > 0 && (
                <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">ร่วมโปรเฉพาะ {includedCount} แคมเปญ</span>
              )}
              {excludedCount > 0 && (
                <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">ไม่ร่วมโปร {excludedCount} แคมเปญ</span>
              )}
              <span className="text-slate-400 font-medium">— จัดการที่หน้าคูปอง</span>
            </div>
          )}
        </div>

        {/* Pricing — reuse the exact same editors as the desktop modal */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <SectionTitle>
            {isModifier
              ? <span className="flex items-center gap-1"><Package size={13} /> ราคาฐาน + ส่วนต่าง (Modifier)</span>
              : <span className="flex items-center gap-1"><Recycle size={13} /> ราคาแต่ละ Variant (Legacy)</span>}
          </SectionTitle>
          {isModifier ? (
            <ModifierPricingEditor editingItem={editingItem} onEditingItemChange={onEditingItemChange} />
          ) : (
            <LegacyVariantEditor editingItem={editingItem} categorySchemas={CATEGORY_SCHEMAS} onEditingItemChange={onEditingItemChange} />
          )}
        </div>
      </div>
    </div>
  );
};

export default MobilePriceEditPage;
