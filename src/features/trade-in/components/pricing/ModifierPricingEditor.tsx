'use client';

import React, { useMemo } from 'react';
import { Plus, Trash2, Calculator, ArrowUpDown } from 'lucide-react';
import { countCombinations, getPriceRange } from '../../utils/variantGenerator';
import type { ModifierGroup, ModifierOption } from '../../utils/variantGenerator';

interface ModifierPricingEditorProps {
  editingItem: any;
  onEditingItemChange: (item: any) => void;
}

const formatPrice = (n: number) => n.toLocaleString('th-TH');

export const ModifierPricingEditor: React.FC<ModifierPricingEditorProps> = ({
  editingItem,
  onEditingItemChange,
}) => {
  const schema = editingItem.attributesSchema || [];
  const modifiers: Record<string, ModifierGroup> = editingItem.attributeModifiers || {};
  const baseNew = editingItem.baseNewPrice || 0;
  const baseUsed = editingItem.baseUsedPrice || 0;

  const stats = useMemo(() => {
    const combos = countCombinations(modifiers);
    const range = getPriceRange(modifiers, baseNew, baseUsed);
    return { combos, ...range };
  }, [modifiers, baseNew, baseUsed]);

  // --- Handlers ---
  const updateModifiers = (newMods: Record<string, ModifierGroup>) => {
    onEditingItemChange({ ...editingItem, attributeModifiers: newMods });
  };

  const handleAddOption = (attrKey: string) => {
    const current = { ...modifiers };
    if (!current[attrKey]) current[attrKey] = { options: [] };
    current[attrKey] = {
      options: [...current[attrKey].options, { value: '', newPriceMod: 0, usedPriceMod: 0 }],
    };
    updateModifiers(current);
  };

  const handleRemoveOption = (attrKey: string, optIdx: number) => {
    const current = { ...modifiers };
    current[attrKey] = {
      options: current[attrKey].options.filter((_: ModifierOption, i: number) => i !== optIdx),
    };
    updateModifiers(current);
  };

  const handleOptionChange = (
    attrKey: string,
    optIdx: number,
    field: keyof ModifierOption,
    value: string | number
  ) => {
    const current = { ...modifiers };
    if (!current[attrKey]) current[attrKey] = { options: [] };
    const opts = [...current[attrKey].options];
    opts[optIdx] = { ...opts[optIdx], [field]: value };
    current[attrKey] = { options: opts };
    updateModifiers(current);
  };

  const handleMoveOption = (attrKey: string, optIdx: number, direction: 'up' | 'down') => {
    const current = { ...modifiers };
    const opts = [...(current[attrKey]?.options || [])];
    const targetIdx = direction === 'up' ? optIdx - 1 : optIdx + 1;
    if (targetIdx < 0 || targetIdx >= opts.length) return;
    [opts[optIdx], opts[targetIdx]] = [opts[targetIdx], opts[optIdx]];
    current[attrKey] = { options: opts };
    updateModifiers(current);
  };

  return (
    <div className="space-y-6">
      {/* Base Price */}
      <div className="bg-gradient-to-r from-blue-50 to-emerald-50 p-5 rounded-2xl border border-blue-100">
        <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5">
          <Calculator size={14} className="text-blue-500" />
          Base Price (ราคาฐาน - สเปคเริ่มต้น)
        </h5>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[9px] font-black uppercase text-emerald-600 tracking-wider block mb-1">ราคาซีล (Base)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold text-sm">฿</span>
              <input
                type="number"
                className="w-full pl-8 pr-3 py-3 bg-white rounded-xl text-base font-black text-emerald-700 border border-emerald-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                value={baseNew || ''}
                onChange={(e) => onEditingItemChange({ ...editingItem, baseNewPrice: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] font-black uppercase text-blue-600 tracking-wider block mb-1">ราคามือสอง (Base)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 font-bold text-sm">฿</span>
              <input
                type="number"
                className="w-full pl-8 pr-3 py-3 bg-white rounded-xl text-base font-black text-blue-700 border border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none"
                value={baseUsed || ''}
                onChange={(e) => onEditingItemChange({ ...editingItem, baseUsedPrice: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modifier Tables per Attribute */}
      {schema.map((attr: any) => {
        const mod = modifiers[attr.key] || { options: [] };
        return (
          <div key={attr.key} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex justify-between items-center px-5 py-3 bg-slate-50 border-b border-slate-200">
              <div>
                <h5 className="text-xs font-black text-slate-700">{attr.label}</h5>
                <p className="text-[10px] text-slate-400 font-medium">{mod.options.length} ตัวเลือก</p>
              </div>
              <button
                onClick={() => handleAddOption(attr.key)}
                className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all"
              >
                <Plus size={14} /> เพิ่ม
              </button>
            </div>

            {mod.options.length > 0 && (
              <div className="px-5 py-3">
                {/* Header */}
                <div className="grid grid-cols-12 gap-2 mb-2 px-1">
                  <div className="col-span-4 text-[9px] font-black text-slate-400 uppercase tracking-wider">ค่า / ชื่อ</div>
                  <div className="col-span-3 text-[9px] font-black text-emerald-500 uppercase tracking-wider">ซีล +/-</div>
                  <div className="col-span-3 text-[9px] font-black text-blue-500 uppercase tracking-wider">มือสอง +/-</div>
                  <div className="col-span-2"></div>
                </div>

                {/* Option Rows */}
                <div className="space-y-2">
                  {mod.options.map((opt: ModifierOption, idx: number) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center group">
                      <div className="col-span-4">
                        {attr.type === 'select' ? (
                          <select
                            className="w-full p-2 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={opt.value}
                            onChange={(e) => handleOptionChange(attr.key, idx, 'value', e.target.value)}
                          >
                            <option value="">-- เลือก --</option>
                            {attr.options?.map((o: string) => (
                              <option key={o} value={o}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            placeholder="เช่น 256GB, 8GB..."
                            className="w-full p-2 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                            value={opt.value}
                            onChange={(e) => handleOptionChange(attr.key, idx, 'value', e.target.value)}
                          />
                        )}
                      </div>
                      <div className="col-span-3">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-xs">+฿</span>
                          <input
                            type="number"
                            className="w-full pl-8 pr-2 py-2 bg-emerald-50/50 rounded-lg text-sm font-black text-emerald-600 border border-emerald-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                            value={opt.newPriceMod || ''}
                            onChange={(e) => handleOptionChange(attr.key, idx, 'newPriceMod', Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <div className="col-span-3">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-blue-400 font-bold text-xs">+฿</span>
                          <input
                            type="number"
                            className="w-full pl-8 pr-2 py-2 bg-blue-50/50 rounded-lg text-sm font-black text-blue-600 border border-blue-100 focus:ring-2 focus:ring-blue-500 outline-none"
                            value={opt.usedPriceMod || ''}
                            onChange={(e) => handleOptionChange(attr.key, idx, 'usedPriceMod', Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <div className="col-span-2 flex justify-end gap-0.5">
                        <button
                          onClick={() => handleMoveOption(attr.key, idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30 transition"
                        >
                          <ArrowUpDown size={12} />
                        </button>
                        <button
                          onClick={() => handleRemoveOption(attr.key, idx)}
                          className="p-1 text-slate-300 hover:text-red-500 transition"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mod.options.length === 0 && (
              <div className="px-5 py-6 text-center text-xs text-slate-400">
                ยังไม่มีตัวเลือก กดปุ่ม "เพิ่ม" เพื่อเริ่มต้น
              </div>
            )}
          </div>
        );
      })}

      {/* Stats Preview */}
      {stats.combos > 0 && (
        <div className="bg-gradient-to-r from-violet-50 to-blue-50 p-4 rounded-2xl border border-violet-100">
          <div className="flex items-center gap-2 mb-2">
            <Calculator size={16} className="text-violet-500" />
            <span className="text-xs font-black text-violet-700">Preview Combinations</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-black text-violet-600">{stats.combos}</div>
              <div className="text-[10px] text-slate-500 font-bold">combinations</div>
            </div>
            <div>
              <div className="text-sm font-black text-emerald-600">
                ฿{formatPrice(stats.minNew)} - ฿{formatPrice(stats.maxNew)}
              </div>
              <div className="text-[10px] text-slate-500 font-bold">ราคาซีล</div>
            </div>
            <div>
              <div className="text-sm font-black text-blue-600">
                ฿{formatPrice(stats.minUsed)} - ฿{formatPrice(stats.maxUsed)}
              </div>
              <div className="text-[10px] text-slate-500 font-bold">ราคามือสอง</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModifierPricingEditor;
