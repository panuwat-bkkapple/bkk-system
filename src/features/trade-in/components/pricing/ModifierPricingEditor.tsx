'use client';

import React, { useMemo } from 'react';
import { Calculator, Package, Recycle, Tag } from 'lucide-react';
import { countCombinations, getPriceRange } from '../../utils/variantGenerator';
import { PricingSection } from './PricingSection';
import type { ModifierGroup } from '../../utils/variantGenerator';

interface ModifierPricingEditorProps {
  editingItem: any;
  onEditingItemChange: (item: any) => void;
}

const fmt = (n: number) => n.toLocaleString('th-TH');

export const ModifierPricingEditor: React.FC<ModifierPricingEditorProps> = ({
  editingItem,
  onEditingItemChange,
}) => {
  const schema = editingItem.attributesSchema || [];
  const modifiers: Record<string, ModifierGroup> = editingItem.attributeModifiers || {};
  const baseRetail = editingItem.baseRetailPrice || 0;
  const baseNew = editingItem.baseNewPrice || 0;
  const baseUsed = editingItem.baseUsedPrice || 0;

  const stats = useMemo(() => {
    const combos = countCombinations(modifiers);
    const range = getPriceRange(modifiers, baseNew, baseUsed);
    return { combos, ...range };
  }, [modifiers, baseNew, baseUsed]);

  const updateModifiers = (newMods: Record<string, ModifierGroup>) => {
    onEditingItemChange({ ...editingItem, attributeModifiers: newMods });
  };

  return (
    <div className="space-y-6">
      {/* Retail Reference */}
      <div className="bg-orange-50 p-4 rounded-2xl border border-orange-200">
        <div className="flex items-center gap-2 mb-2">
          <Tag size={14} className="text-orange-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-orange-600">ราคาอ้างอิง (Apple Store)</span>
        </div>
        <div className="relative max-w-xs">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-500 font-bold">฿</span>
          <input
            type="number"
            placeholder="ราคาทางการ เช่น 29,900"
            className="w-full pl-8 pr-3 py-2.5 bg-white rounded-xl text-sm font-black text-orange-700 border border-orange-200 focus:ring-2 focus:ring-orange-500 outline-none"
            value={baseRetail || ''}
            onChange={(e) => onEditingItemChange({ ...editingItem, baseRetailPrice: Number(e.target.value) })}
          />
        </div>
      </div>

      {/* Section: เครื่องซีล */}
      <PricingSection
        title="เครื่องซีล (Sealed / New)"
        icon={<Package size={16} className="text-emerald-500" />}
        color="emerald"
        schema={schema}
        modifiers={modifiers}
        baseSellPrice={editingItem.baseSellPrice || 0}
        baseBuyPrice={baseNew}
        sellFieldKey="baseSellPrice"
        buyFieldKey="baseNewPrice"
        sellModKey="sellPriceMod"
        buyModKey="newPriceMod"
        editingItem={editingItem}
        onEditingItemChange={onEditingItemChange}
        onUpdateModifiers={updateModifiers}
      />

      {/* Section: เครื่องมือสอง */}
      <PricingSection
        title="เครื่องมือสอง (Used / Pre-owned)"
        icon={<Recycle size={16} className="text-blue-500" />}
        color="blue"
        schema={schema}
        modifiers={modifiers}
        baseSellPrice={editingItem.baseSellUsedPrice || 0}
        baseBuyPrice={baseUsed}
        sellFieldKey="baseSellUsedPrice"
        buyFieldKey="baseUsedPrice"
        sellModKey="sellUsedPriceMod"
        buyModKey="usedPriceMod"
        editingItem={editingItem}
        onEditingItemChange={onEditingItemChange}
        onUpdateModifiers={updateModifiers}
      />

      {/* Stats Preview */}
      {stats.combos > 0 && (
        <div className="bg-gradient-to-r from-violet-50 to-slate-50 p-4 rounded-2xl border border-violet-100">
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
              <div className="text-sm font-black text-emerald-600">฿{fmt(stats.minNew)} - ฿{fmt(stats.maxNew)}</div>
              <div className="text-[10px] text-slate-500 font-bold">รับซื้อซีล</div>
            </div>
            <div>
              <div className="text-sm font-black text-blue-600">฿{fmt(stats.minUsed)} - ฿{fmt(stats.maxUsed)}</div>
              <div className="text-[10px] text-slate-500 font-bold">รับซื้อมือสอง</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModifierPricingEditor;
