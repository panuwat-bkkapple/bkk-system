'use client';

import React, { useState, useMemo } from 'react';
import {
  Pencil, Trash2, Star, Copy, ChevronDown, ChevronRight, FolderOpen, Zap,
  TrendingDown, Ban, Bike, Ticket, MoreVertical, ToggleLeft, ToggleRight, ClipboardList
} from 'lucide-react';
import { BuyingStatusBadge } from './BuyingStatusBadge';

interface ModelsTableProps {
  models: any[];
  conditionSets: any[];
  coupons?: any[];
  loading: boolean;
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
  onDuplicate: (item: any) => void;
  onToggleStatus: (item: any) => void;
  onToggleFeatured: (item: any) => void;
  onBatchAdjust?: (seriesName: string, models: any[]) => void;
}

interface SeriesGroup {
  seriesName: string;
  models: any[];
}

function groupModelsBySeries(models: any[]): SeriesGroup[] {
  const grouped: Record<string, any[]> = {};
  const noSeries: any[] = [];

  for (const model of models) {
    const series = model.series?.trim();
    if (series) {
      if (!grouped[series]) grouped[series] = [];
      grouped[series].push(model);
    } else {
      noSeries.push(model);
    }
  }

  const groups: SeriesGroup[] = [];

  // Series ที่มี models > 1 → แสดงเป็น group
  // Series ที่มี 1 model → แสดงเป็น flat row (ไม่ต้อง group)
  for (const [seriesName, seriesModels] of Object.entries(grouped)) {
    if (seriesModels.length > 1) {
      groups.push({ seriesName, models: seriesModels });
    } else {
      noSeries.push(...seriesModels);
    }
  }

  // เพิ่ม items ที่ไม่มี group เป็น individual entries
  for (const model of noSeries) {
    groups.push({ seriesName: '', models: [model] });
  }

  return groups;
}

// Status badges computed live from the model + coupons. Coupon
// include/exclude is owned by the coupon side (applicable_models /
// excluded_models) — we cross-reference here for display only, never
// denormalize a flag onto the model. `showPickup` = false เมื่อคอลัมน์
// Purchasing Method แสดงข้อมูล pickup อยู่แล้ว (desktop table) กันซ้ำซ้อน
export const StatusBadges: React.FC<{ item: any; coupons: any[]; showPickup?: boolean }> = ({ item, coupons, showPickup = true }) => {
  const noPickup = showPickup && item.pickup === false;
  const distLimit = showPickup && item.pickup !== false && Number(item.maxPickupDistanceKm) > 0 ? Number(item.maxPickupDistanceKm) : 0;
  const excludedCount = coupons.filter(c => Array.isArray(c.excluded_models) && c.excluded_models.includes(item.id)).length;
  const includedCount = coupons.filter(c => Array.isArray(c.applicable_models) && c.applicable_models.length > 0 && c.applicable_models.includes(item.id)).length;

  if (!noPickup && !distLimit && !excludedCount && !includedCount) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {noPickup && (
        <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 flex items-center gap-0.5">
          <Ban size={10} /> ไม่รับถึงที่
        </span>
      )}
      {distLimit > 0 && (
        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 flex items-center gap-0.5">
          <Bike size={10} /> รับถึงที่ ≤ {distLimit} กม.
        </span>
      )}
      {excludedCount > 0 && (
        <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 flex items-center gap-0.5">
          <Ticket size={10} /> ไม่ร่วมโปร {excludedCount}
        </span>
      )}
      {includedCount > 0 && (
        <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 flex items-center gap-0.5">
          <Ticket size={10} /> ร่วมโปรเฉพาะ {includedCount}
        </span>
      )}
    </div>
  );
};

// เมนู ⋮ ท้ายแถว (Reusely-style): เปิด/งดรับซื้อ, Duplicate, Delete
const RowMenu: React.FC<{
  item: any;
  onToggleStatus: (item: any) => void;
  onDuplicate: (item: any) => void;
  onDelete: (id: string) => void;
}> = ({ item, onToggleStatus, onDuplicate, onDelete }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
        title="เมนูเพิ่มเติม"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 w-48 text-left">
            <button
              onClick={() => { setOpen(false); onToggleStatus(item); }}
              className="w-full px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              {item.isActive
                ? <><ToggleLeft size={15} className="text-slate-400" /> งดรับซื้อ (ปิดชั่วคราว)</>
                : <><ToggleRight size={15} className="text-emerald-500" /> เปิดรับซื้อ</>}
            </button>
            <button
              onClick={() => { setOpen(false); onDuplicate(item); }}
              className="w-full px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <Copy size={15} className="text-slate-400" /> Duplicate
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={() => { setOpen(false); onDelete(item.id); }}
              className="w-full px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2"
            >
              <Trash2 size={15} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const ModelRow: React.FC<{
  item: any;
  conditionSets: any[];
  coupons: any[];
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
  onDuplicate: (item: any) => void;
  onToggleStatus: (item: any) => void;
  onToggleFeatured: (item: any) => void;
  indent?: boolean;
}> = ({ item, conditionSets, coupons, onEdit, onDelete, onDuplicate, onToggleStatus, onToggleFeatured, indent }) => {
  const assignedSet = conditionSets.find(c => c.id === item.conditionSetId);
  const isModifier = item.pricingMode === 'modifier';

  const methods = [
    item.inStore !== false && 'In-store',
    item.pickup !== false && 'Pickup',
    item.mailIn !== false && 'Mail-in',
  ].filter(Boolean) as string[];
  const pickupLimit = item.pickup !== false && Number(item.maxPickupDistanceKm) > 0 ? Number(item.maxPickupDistanceKm) : 0;

  return (
    <tr className={`hover:bg-blue-50/30 transition-colors ${!item.isActive && 'bg-slate-50/50 opacity-60'}`}>
      <td className="p-4 pl-6">
        <div className={indent ? 'pl-6' : ''}>
          <div className="font-bold text-slate-700">{item.brand}</div>
          {item.series && <div className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">{item.series}</div>}
        </div>
      </td>
      <td className="p-4">
        <div className="flex items-center gap-3">
          <button onClick={() => onToggleFeatured(item)} className={`p-1.5 rounded-full ${item.isFeatured ? 'bg-amber-100 text-amber-500' : 'text-slate-300 hover:text-amber-300 transition'}`} title="โชว์หน้าแรก">
            <Star size={18} className={item.isFeatured ? 'fill-amber-500' : ''} />
          </button>
          <div className="flex items-center gap-3">
            {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-8 h-8 object-contain" />}
            <div>
              <div className="font-black text-slate-900">{item.name}</div>
              <StatusBadges item={item} coupons={coupons} showPickup={false} />
            </div>
          </div>
        </div>
      </td>
      <td className="p-4">
        {methods.length > 0 ? (
          <div>
            <span className="text-xs font-bold text-slate-600">{methods.join(', ')}</span>
            {pickupLimit > 0 && (
              <div className="text-[10px] font-bold text-amber-600 mt-0.5 flex items-center gap-1">
                <Bike size={11} /> Pickup ≤ {pickupLimit} กม.
              </div>
            )}
          </div>
        ) : (
          <span className="text-xs font-medium text-slate-400">No methods enabled</span>
        )}
      </td>
      <td className="p-4">
        {assignedSet ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md border border-indigo-100 max-w-[180px]">
            <ClipboardList size={12} className="shrink-0" />
            <span className="truncate">{assignedSet.name}</span>
          </span>
        ) : (
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">No Condition</span>
        )}
      </td>
      <td className="p-4">
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded-md border border-slate-200 text-slate-600">
            {item.variants?.length || 0} ตัวเลือก
          </span>
          {isModifier && (
            <span className="text-[9px] font-bold text-violet-500 bg-violet-50 px-1.5 py-1 rounded border border-violet-100 uppercase flex items-center gap-0.5">
              <Zap size={10} /> Modifier
            </span>
          )}
        </div>
      </td>
      <td className="p-4">
        <BuyingStatusBadge item={item} conditionSets={conditionSets} />
      </td>
      <td className="p-4 text-right pr-6">
        <div className="flex justify-end items-center gap-1.5">
          <button
            onClick={() => onEdit(item)}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition flex items-center gap-1.5 whitespace-nowrap"
          >
            <Pencil size={13} /> Pricing & Settings
          </button>
          <RowMenu item={item} onToggleStatus={onToggleStatus} onDuplicate={onDuplicate} onDelete={onDelete} />
        </div>
      </td>
    </tr>
  );
};

export const ModelsTable: React.FC<ModelsTableProps> = ({
  models,
  conditionSets,
  coupons = [],
  loading,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleStatus,
  onToggleFeatured,
  onBatchAdjust,
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupModelsBySeries(models), [models]);

  const toggleGroup = (seriesName: string) => {
    setCollapsedGroups(prev => ({ ...prev, [seriesName]: !prev[seriesName] }));
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border overflow-hidden overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[1100px]">
        <thead className="bg-slate-50/80 border-b text-slate-500 font-bold uppercase text-[10px] tracking-widest">
          <tr>
            <th className="p-4 pl-6 w-32">Brand / Series</th>
            <th className="p-4">Model</th>
            <th className="p-4 w-44">Purchasing Method</th>
            <th className="p-4 w-48">Condition Group</th>
            <th className="p-4 w-36">Total Items</th>
            <th className="p-4 w-32">Buying Status</th>
            <th className="p-4 text-right pr-6 w-52">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr><td colSpan={7} className="p-10 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดข้อมูล...</td></tr>
          ) : models.length === 0 ? (
            <tr><td colSpan={7} className="p-10 text-center text-slate-400">ไม่พบรุ่นสินค้า</td></tr>
          ) : (
            groups.map((group) => {
              // Single model (no group header)
              if (!group.seriesName) {
                return group.models.map(item => (
                  <ModelRow
                    key={item.id}
                    item={item}
                    conditionSets={conditionSets}
                    coupons={coupons}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                    onToggleStatus={onToggleStatus}
                    onToggleFeatured={onToggleFeatured}
                  />
                ));
              }

              // Series group with collapsible header
              const isCollapsed = collapsedGroups[group.seriesName];
              const totalVariants = group.models.reduce((sum, m) => sum + (m.variants?.length || 0), 0);

              return (
                <React.Fragment key={`group-${group.seriesName}`}>
                  {/* Series Group Header */}
                  <tr
                    className="bg-gradient-to-r from-blue-50/80 to-slate-50/50 cursor-pointer hover:from-blue-100/80 transition-colors"
                    onClick={() => toggleGroup(group.seriesName)}
                  >
                    <td colSpan={7} className="px-6 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isCollapsed ? <ChevronRight size={18} className="text-blue-400" /> : <ChevronDown size={18} className="text-blue-400" />}
                          <FolderOpen size={16} className="text-blue-500" />
                          <span className="font-black text-slate-700 text-sm">{group.seriesName}</span>
                          <span className="text-[10px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded-md border">
                            {group.models.length} รุ่น
                          </span>
                          <span className="text-[10px] font-bold text-blue-400 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                            {totalVariants} variants
                          </span>
                        </div>
                        {onBatchAdjust && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onBatchAdjust(group.seriesName, group.models); }}
                            className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-violet-600 hover:text-white hover:border-violet-600 transition-all"
                          >
                            <TrendingDown size={12} /> ปรับราคาทั้ง Series
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Group Models */}
                  {!isCollapsed && group.models.map(item => (
                    <ModelRow
                      key={item.id}
                      item={item}
                      conditionSets={conditionSets}
                      coupons={coupons}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onDuplicate={onDuplicate}
                      onToggleStatus={onToggleStatus}
                      onToggleFeatured={onToggleFeatured}
                      indent
                    />
                  ))}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ModelsTable;
