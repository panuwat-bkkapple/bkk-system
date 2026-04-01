'use client';

import React from 'react';
import { Plus, Trash2, ArrowUpDown, TrendingUp } from 'lucide-react';

interface PricingSectionProps {
  title: string;
  icon: React.ReactNode;
  color: 'emerald' | 'blue';
  schema: any[];
  modifiers: Record<string, { options: any[] }>;
  baseSellPrice: number;
  baseBuyPrice: number;
  sellFieldKey: string;   // e.g. 'baseSellPrice' or 'baseSellUsedPrice'
  buyFieldKey: string;    // e.g. 'baseNewPrice' or 'baseUsedPrice'
  sellModKey: string;     // e.g. 'sellPriceMod' or 'sellUsedPriceMod'
  buyModKey: string;      // e.g. 'newPriceMod' or 'usedPriceMod'
  editingItem: any;
  onEditingItemChange: (item: any) => void;
  onUpdateModifiers: (mods: Record<string, { options: any[] }>) => void;
}

const fmt = (n: number) => n.toLocaleString('th-TH');

export const PricingSection: React.FC<PricingSectionProps> = ({
  title, icon, color, schema, modifiers,
  baseSellPrice, baseBuyPrice,
  sellFieldKey, buyFieldKey, sellModKey, buyModKey,
  editingItem, onEditingItemChange, onUpdateModifiers,
}) => {
  const profit = baseSellPrice && baseBuyPrice ? baseSellPrice - baseBuyPrice : 0;
  const profitPct = baseSellPrice > 0 ? (profit / baseSellPrice * 100) : 0;

  const colorMap = {
    emerald: { bg: 'from-emerald-50 to-teal-50', border: 'border-emerald-200', sellBg: 'bg-violet-50/50 border-violet-100 text-violet-600', buyBg: 'bg-emerald-50/50 border-emerald-100 text-emerald-600' },
    blue: { bg: 'from-blue-50 to-indigo-50', border: 'border-blue-200', sellBg: 'bg-violet-50/50 border-violet-100 text-violet-600', buyBg: 'bg-blue-50/50 border-blue-100 text-blue-600' },
  };
  const c = colorMap[color];

  const handleOptionChange = (attrKey: string, optIdx: number, field: string, value: string | number) => {
    const current = { ...modifiers };
    if (!current[attrKey]) current[attrKey] = { options: [] };
    const opts = [...current[attrKey].options];
    opts[optIdx] = { ...opts[optIdx], [field]: value };
    current[attrKey] = { options: opts };
    onUpdateModifiers(current);
  };

  const handleAddOption = (attrKey: string) => {
    const current = { ...modifiers };
    if (!current[attrKey]) current[attrKey] = { options: [] };
    current[attrKey] = { options: [...current[attrKey].options, { value: '', newPriceMod: 0, usedPriceMod: 0 }] };
    onUpdateModifiers(current);
  };

  const handleRemoveOption = (attrKey: string, optIdx: number) => {
    const current = { ...modifiers };
    current[attrKey] = { options: current[attrKey].options.filter((_: any, i: number) => i !== optIdx) };
    onUpdateModifiers(current);
  };

  const handleMoveOption = (attrKey: string, optIdx: number, dir: 'up' | 'down') => {
    const current = { ...modifiers };
    const opts = [...(current[attrKey]?.options || [])];
    const t = dir === 'up' ? optIdx - 1 : optIdx + 1;
    if (t < 0 || t >= opts.length) return;
    [opts[optIdx], opts[t]] = [opts[t], opts[optIdx]];
    current[attrKey] = { options: opts };
    onUpdateModifiers(current);
  };

  return (
    <div className={`rounded-2xl border ${c.border} overflow-hidden`}>
      {/* Header */}
      <div className={`bg-gradient-to-r ${c.bg} px-5 py-3 border-b ${c.border}`}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-black text-slate-800">{title}</span>
        </div>
      </div>

      {/* Base Prices */}
      <div className="p-5 border-b border-slate-100">
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-[9px] font-black uppercase text-violet-600 tracking-wider block mb-1">ราคาขาย</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-500 font-bold text-sm">฿</span>
              <input type="number" className="w-full pl-8 pr-3 py-2.5 bg-white rounded-xl text-sm font-black text-violet-700 border border-violet-200 focus:ring-2 focus:ring-violet-500 outline-none" value={baseSellPrice || ''} onChange={(e) => onEditingItemChange({ ...editingItem, [sellFieldKey]: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            <label className={`text-[9px] font-black uppercase text-${color}-600 tracking-wider block mb-1`}>ราคารับซื้อ</label>
            <div className="relative">
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-${color}-500 font-bold text-sm`}>฿</span>
              <input type="number" className={`w-full pl-8 pr-3 py-2.5 bg-white rounded-xl text-sm font-black text-${color}-700 border border-${color}-200 focus:ring-2 focus:ring-${color}-500 outline-none`} value={baseBuyPrice || ''} onChange={(e) => onEditingItemChange({ ...editingItem, [buyFieldKey]: Number(e.target.value) })} />
            </div>
          </div>
          <div>
            {baseSellPrice > 0 && baseBuyPrice > 0 && (
              <div className={`px-3 py-2.5 rounded-xl text-sm font-black flex items-center gap-1.5 border ${profit < 0 ? 'text-red-600 bg-red-50 border-red-200' : profit < 1500 ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-emerald-600 bg-emerald-50 border-emerald-200'}`}>
                <TrendingUp size={14} />
                ฿{fmt(profit)} ({profitPct.toFixed(0)}%)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Attribute Modifiers */}
      {schema.map((attr: any) => {
        const mod = modifiers[attr.key] || { options: [] };
        return (
          <div key={attr.key} className="border-b border-slate-100 last:border-b-0">
            <div className="flex justify-between items-center px-5 py-2 bg-slate-50/50">
              <span className="text-xs font-black text-slate-600">{attr.label} <span className="text-slate-400 font-medium">({mod.options.length})</span></span>
              <button onClick={() => handleAddOption(attr.key)} className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-blue-600 hover:text-white transition-all">
                <Plus size={12} /> เพิ่ม
              </button>
            </div>

            {mod.options.length > 0 && (
              <div className="px-5 py-2 space-y-1.5">
                {mod.options.map((opt: any, idx: number) => {
                  const optSell = baseSellPrice + (opt[sellModKey] || 0);
                  const optBuy = baseBuyPrice + (opt[buyModKey] || 0);
                  const optProfit = optSell > 0 && optBuy > 0 ? optSell - optBuy : 0;

                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-3">
                        {attr.type === 'select' ? (
                          <select className="w-full p-1.5 bg-slate-50 rounded-lg text-xs font-bold border border-slate-200 outline-none" value={opt.value} onChange={(e) => handleOptionChange(attr.key, idx, 'value', e.target.value)}>
                            <option value="">--</option>
                            {attr.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type="text" placeholder="เช่น 256GB" className="w-full p-1.5 bg-slate-50 rounded-lg text-xs font-bold border border-slate-200 outline-none" value={opt.value} onChange={(e) => handleOptionChange(attr.key, idx, 'value', e.target.value)} />
                        )}
                      </div>
                      <div className="col-span-3">
                        <div className="relative">
                          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-violet-400 font-bold text-[10px]">ขาย+</span>
                          <input type="number" className="w-full pl-10 pr-1 py-1.5 bg-violet-50/30 rounded-lg text-xs font-black text-violet-600 border border-violet-100 outline-none" value={opt[sellModKey] || ''} onChange={(e) => handleOptionChange(attr.key, idx, sellModKey, Number(e.target.value))} />
                        </div>
                      </div>
                      <div className="col-span-3">
                        <div className="relative">
                          <span className={`absolute left-1.5 top-1/2 -translate-y-1/2 text-${color}-400 font-bold text-[10px]`}>ซื้อ+</span>
                          <input type="number" className={`w-full pl-10 pr-1 py-1.5 ${c.buyBg} rounded-lg text-xs font-black border outline-none`} value={opt[buyModKey] || ''} onChange={(e) => handleOptionChange(attr.key, idx, buyModKey, Number(e.target.value))} />
                        </div>
                      </div>
                      <div className="col-span-1 text-center">
                        {optSell > 0 && (
                          <span className={`text-[9px] font-black ${optProfit < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                            ฿{fmt(optProfit)}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 flex justify-end gap-0.5">
                        <button onClick={() => handleMoveOption(attr.key, idx, 'up')} disabled={idx === 0} className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ArrowUpDown size={11} /></button>
                        <button onClick={() => handleRemoveOption(attr.key, idx)} className="p-0.5 text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PricingSection;
