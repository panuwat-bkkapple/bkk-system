'use client';

import React from 'react';
import {
  ToggleLeft, ToggleRight, Pencil, Star, ClipboardList, Zap, Smartphone,
} from 'lucide-react';
import { StatusBadges } from './ModelsTable';

interface PriceListMobileProps {
  models: any[];
  conditionSets: any[];
  coupons?: any[];
  loading: boolean;
  onEdit: (item: any) => void;
  onToggleStatus: (item: any) => void;
  onToggleFeatured: (item: any) => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString('th-TH');

// Used-price (รับซื้อมือสอง) range for the card headline. Display only —
// reads the same variant fields the save logic writes (usedPrice||price).
function usedPriceRange(variants: any[]): { min: number; max: number } | null {
  const prices = (variants || [])
    .map(v => Number(v.usedPrice ?? v.price ?? 0))
    .filter(p => p > 0);
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

const CardToggle: React.FC<{ isActive: boolean; onToggle: () => void }> = ({ isActive, onToggle }) => (
  <button
    onClick={onToggle}
    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-sm transition-colors border ${
      isActive
        ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
        : 'bg-slate-50 text-slate-400 border-slate-200'
    }`}
  >
    {isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
    {isActive ? 'เปิดรับซื้อ' : 'ปิดอยู่'}
  </button>
);

const ModelCard: React.FC<{
  item: any;
  conditionSets: any[];
  coupons: any[];
  onEdit: (item: any) => void;
  onToggleStatus: (item: any) => void;
  onToggleFeatured: (item: any) => void;
}> = ({ item, conditionSets, coupons, onEdit, onToggleStatus, onToggleFeatured }) => {
  const assignedSet = conditionSets.find(c => c.id === item.conditionSetId);
  const isModifier = item.pricingMode === 'modifier';
  const range = usedPriceRange(item.variants);
  const variantCount = item.variants?.length || 0;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${!item.isActive ? 'opacity-60' : ''}`}>
      {/* Top: image + identity */}
      <div className="flex gap-3">
        <div className="w-16 h-16 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center shrink-0 relative">
          {item.imageUrl
            ? <img src={item.imageUrl} alt={item.name} className="max-h-full max-w-full p-1.5 object-contain" />
            : <Smartphone size={24} className="text-slate-300" />}
          <button
            onClick={() => onToggleFeatured(item)}
            className={`absolute -top-2 -right-2 p-1 rounded-full border shadow-sm ${
              item.isFeatured ? 'bg-amber-100 text-amber-500 border-amber-200' : 'bg-white text-slate-300 border-slate-200'
            }`}
          >
            <Star size={13} className={item.isFeatured ? 'fill-amber-500' : ''} />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold text-slate-400 uppercase truncate">
            {item.brand}{item.series ? ` · ${item.series}` : ''}
          </div>
          <div className="font-black text-slate-900 leading-tight break-words">{item.name}</div>
          <div className="text-[11px] font-bold text-slate-400 mt-0.5">
            {variantCount} ตัวเลือก
          </div>
        </div>
      </div>

      {/* Price range */}
      <div className="mt-3 bg-slate-50 rounded-xl px-3 py-2 flex items-baseline justify-between border border-slate-100">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">รับซื้อมือสอง</span>
        <span className="font-black text-blue-600">
          {range
            ? (range.min === range.max ? `฿${fmt(range.min)}` : `฿${fmt(range.min)} - ฿${fmt(range.max)}`)
            : <span className="text-slate-300">ยังไม่ตั้งราคา</span>}
        </span>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1 mt-2">
        <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 flex items-center gap-1">
          <ClipboardList size={11} /> {assignedSet?.name || 'No Set Assigned'}
        </span>
        {isModifier && (
          <span className="text-[10px] font-bold text-violet-500 bg-violet-50 px-2 py-0.5 rounded-md border border-violet-100 uppercase flex items-center gap-1">
            <Zap size={11} /> Modifier
          </span>
        )}
      </div>

      {/* Status badges (wrap, never truncate) — shared with desktop table */}
      <StatusBadges item={item} coupons={coupons} />

      {/* Footer actions: toggle + แก้ราคา, equal weight */}
      <div className="flex gap-2 mt-3">
        <CardToggle isActive={item.isActive} onToggle={() => onToggleStatus(item)} />
        <button
          onClick={() => onEdit(item)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-sm bg-blue-600 text-white border border-blue-600 active:scale-95 transition-transform"
        >
          <Pencil size={18} /> แก้ราคา
        </button>
      </div>
    </div>
  );
};

export const PriceListMobile: React.FC<PriceListMobileProps> = ({
  models,
  conditionSets,
  coupons = [],
  loading,
  onEdit,
  onToggleStatus,
  onToggleFeatured,
}) => {
  if (loading) {
    return <div className="p-10 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดข้อมูล...</div>;
  }
  if (models.length === 0) {
    return <div className="p-10 text-center text-slate-400">ไม่พบรุ่นสินค้า</div>;
  }

  return (
    <div className="space-y-3">
      {models.map(item => (
        <ModelCard
          key={item.id}
          item={item}
          conditionSets={conditionSets}
          coupons={coupons}
          onEdit={onEdit}
          onToggleStatus={onToggleStatus}
          onToggleFeatured={onToggleFeatured}
        />
      ))}
    </div>
  );
};

export default PriceListMobile;
