'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface LegacyVariantEditorProps {
  editingItem: any;
  categorySchemas: Record<string, any[]>;
  onEditingItemChange: (item: any) => void;
}

export const LegacyVariantEditor: React.FC<LegacyVariantEditorProps> = ({
  editingItem,
  categorySchemas,
  onEditingItemChange,
}) => {
  const handleAddVariant = () => {
    onEditingItemChange({
      ...editingItem,
      variants: [
        ...(editingItem.variants || []),
        { id: Date.now().toString(), attributes: {}, name: '', newPrice: 0, usedPrice: 0 },
      ],
    });
  };

  const handleRemoveVariant = (id: string) => {
    onEditingItemChange({
      ...editingItem,
      variants: editingItem.variants.filter((v: any) => v.id !== id),
    });
  };

  const handleAttributeChange = (variantIndex: number, attrKey: string, value: string) => {
    const newVariants = [...editingItem.variants];
    if (!newVariants[variantIndex].attributes) newVariants[variantIndex].attributes = {};
    newVariants[variantIndex].attributes[attrKey] = value;
    onEditingItemChange({ ...editingItem, variants: newVariants });
  };

  const currentSchema = editingItem.attributesSchema || categorySchemas['Smartphones'];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-[10px] text-slate-400 font-bold">กรอกราคาแต่ละ variant ทีละตัว (Legacy Mode)</p>
        <button
          onClick={handleAddVariant}
          className="text-sm font-bold text-blue-600 border-2 border-blue-100 bg-blue-50 px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shadow-sm"
        >
          <Plus size={16} /> Add Variant
        </button>
      </div>

      <div className="space-y-3">
        {editingItem.variants?.map((v: any, index: number) => (
          <div
            key={v.id}
            className="grid grid-cols-12 gap-4 items-start bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative group hover:border-blue-200 transition-colors pr-12"
          >
            {/* Dynamic Inputs Based on Category Schema */}
            <div className="col-span-12 xl:col-span-7">
              <div className="grid grid-cols-2 gap-3">
                {currentSchema.map((attr: any) => (
                  <div key={attr.key}>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                      {attr.label}
                    </label>
                    {attr.type === 'select' ? (
                      <select
                        className="w-full p-2.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={v.attributes?.[attr.key] || ''}
                        onChange={(e) => handleAttributeChange(index, attr.key, e.target.value)}
                      >
                        <option value="">-- เลือก --</option>
                        {attr.options.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder={`e.g. ${attr.key === 'ram' ? '8GB' : attr.key === 'storage' ? '256GB' : '...'}`}
                        className="w-full p-2.5 bg-slate-50 rounded-lg text-sm font-bold border border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={v.attributes?.[attr.key] || ''}
                        onChange={(e) => handleAttributeChange(index, attr.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
                <div className="col-span-2 text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  <span className="font-bold text-slate-500">ผลลัพธ์:</span>
                  {currentSchema.map((a: any) => v.attributes?.[a.key]).filter(Boolean).join(' | ') || '...'}
                </div>
              </div>
            </div>

            {/* Pricing Inputs */}
            <div className="col-span-12 xl:col-span-5 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-black uppercase text-emerald-500 tracking-wider block mb-1">ราคาเครื่องซีล</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">฿</span>
                  <input
                    type="number"
                    className="w-full pl-8 pr-3 py-3 bg-emerald-50/50 rounded-lg text-sm font-black text-emerald-600 border border-emerald-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={v.newPrice || ''}
                    onChange={(e) => {
                      const newV = [...editingItem.variants];
                      newV[index].newPrice = Number(e.target.value);
                      onEditingItemChange({ ...editingItem, variants: newV });
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black uppercase text-blue-500 tracking-wider block mb-1">ราคามือสอง (รับซื้อ)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 font-bold">฿</span>
                  <input
                    type="number"
                    className="w-full pl-8 pr-3 py-3 bg-blue-50/50 rounded-lg text-sm font-black text-blue-600 border border-blue-100 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={v.usedPrice || v.price || ''}
                    onChange={(e) => {
                      const newV = [...editingItem.variants];
                      newV[index].usedPrice = Number(e.target.value);
                      onEditingItemChange({ ...editingItem, variants: newV });
                    }}
                  />
                </div>
              </div>
            </div>

            {editingItem.variants.length > 1 && (
              <button
                onClick={() => handleRemoveVariant(v.id)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default LegacyVariantEditor;
