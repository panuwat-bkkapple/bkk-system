'use client';

import React from 'react';
import {
  ToggleLeft, ToggleRight, Pencil, Trash2, Star, ClipboardList, Layers
} from 'lucide-react';

interface ModelsTableProps {
  models: any[];
  conditionSets: any[];
  loading: boolean;
  onEdit: (item: any) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (item: any) => void;
  onToggleFeatured: (item: any) => void;
}

// --- Component สำหรับปุ่ม เปิด/ปิด Status ---
const StatusToggle = ({ isActive, onToggle }: { isActive: boolean, onToggle: () => void }) => {
  return (
    <button onClick={onToggle} className="flex items-center gap-2 group cursor-pointer w-fit">
      <div className={`text-xs font-black uppercase ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
        {isActive ? 'On' : 'Off'}
      </div>
      {isActive ? (
        <ToggleRight size={28} className="text-emerald-500 group-hover:text-emerald-600 transition" />
      ) : (
        <ToggleLeft size={28} className="text-slate-300 group-hover:text-slate-400 transition" />
      )}
    </button>
  );
};

export const ModelsTable: React.FC<ModelsTableProps> = ({
  models,
  conditionSets,
  loading,
  onEdit,
  onDelete,
  onToggleStatus,
  onToggleFeatured,
}) => {
  return (
    <div className="bg-white rounded-3xl shadow-sm border overflow-hidden overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[1000px]">
        <thead className="bg-slate-50/80 border-b text-slate-500 font-bold uppercase text-[10px] tracking-widest">
          <tr>
            <th className="p-4 pl-6 w-24">Activate</th>
            <th className="p-4 w-32">Brand / Series</th>
            <th className="p-4">Model Name</th>
            <th className="p-4 w-64">Variants Overview</th>
            <th className="p-4 w-32">Buying Type</th>
            <th className="p-4 text-right pr-6 w-24">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr><td colSpan={6} className="p-10 text-center text-slate-400 font-bold animate-pulse">กำลังโหลดข้อมูล...</td></tr>
          ) : models.length === 0 ? (
            <tr><td colSpan={6} className="p-10 text-center text-slate-400">ไม่พบรุ่นสินค้า</td></tr>
          ) : (
            models.map((item) => {
              const assignedSet = conditionSets.find(c => c.id === item.conditionSetId);
              return (
                <tr key={item.id} className={`hover:bg-blue-50/30 transition-colors ${!item.isActive && 'bg-slate-50/50 opacity-60'}`}>
                  <td className="p-4 pl-6"><StatusToggle isActive={item.isActive} onToggle={() => onToggleStatus(item)} /></td>
                  <td className="p-4">
                    <div className="font-bold text-slate-700">{item.brand}</div>
                    {item.series && <div className="text-[10px] text-slate-400 font-medium uppercase mt-0.5">{item.series}</div>}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <button onClick={() => onToggleFeatured(item)} className={`p-1.5 rounded-full ${item.isFeatured ? 'bg-amber-100 text-amber-500' : 'text-slate-300 hover:text-amber-300 transition'}`}><Star size={18} className={item.isFeatured ? "fill-amber-500" : ""} /></button>
                      <div className="flex items-center gap-3">
                        {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-8 h-8 object-contain" />}
                        <div>
                          <div className="font-black text-slate-900">{item.name}</div>
                          <div className="text-[10px] text-indigo-500 font-bold mt-0.5 flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100 w-fit"><ClipboardList size={12} /> {assignedSet?.name || 'No Set Assigned'}</div>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {/* โชว์สรุป Variants แบบยืดหยุ่น */}
                      <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded-md border border-slate-200 text-slate-600">
                        {item.variants?.length || 0} ตัวเลือก
                      </span>
                      {item.attributesSchema && item.attributesSchema.length > 1 && (
                          <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-1 rounded border border-blue-100 uppercase">
                              Multi-Step UI Ready
                          </span>
                      )}
                    </div>
                  </td>

                  <td className="p-4">
                    <div className="flex gap-2 opacity-60">
                      {item.inStore && <Layers size={14} aria-label="Store" className="text-emerald-600" />}
                      {item.pickup && <Layers size={14} aria-label="Pickup" className="text-blue-600" />}
                      {item.mailIn && <Layers size={14} aria-label="Mail" className="text-orange-600" />}
                    </div>
                  </td>
                  <td className="p-4 text-right pr-6">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => onEdit(item)} className="p-2 text-slate-400 hover:text-blue-600 transition hover:bg-white rounded-lg"><Pencil size={18} /></button>
                      <button onClick={() => onDelete(item.id)} className="p-2 text-slate-400 hover:text-red-600 transition hover:bg-white rounded-lg"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ModelsTable;
