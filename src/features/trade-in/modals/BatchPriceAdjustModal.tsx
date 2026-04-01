'use client';

import React, { useState, useMemo } from 'react';
import { X, TrendingDown, TrendingUp, Save, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { ref, update } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { db, app } from '../../../api/firebase';

interface BatchPriceAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  seriesName: string;
  models: any[];
}

type AdjustMode = 'fixed' | 'percent';
type PriceTarget = 'used' | 'new' | 'both';

const fmt = (n: number) => n.toLocaleString('th-TH');

export const BatchPriceAdjustModal: React.FC<BatchPriceAdjustModalProps> = ({
  isOpen, onClose, seriesName, models,
}) => {
  const [mode, setMode] = useState<AdjustMode>('fixed');
  const [target, setTarget] = useState<PriceTarget>('used');
  const [amount, setAmount] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const totalVariants = models.reduce((sum, m) => sum + (m.variants?.length || 0), 0);

  const preview = useMemo(() => {
    if (amount === 0) return [];
    return models.map(m => {
      const variants = m.variants || [];
      const adjusted = variants.map((v: any) => {
        const oldUsed = Number(v.usedPrice || v.price || 0);
        const oldNew = Number(v.newPrice || 0);
        let newUsed = oldUsed;
        let newNew = oldNew;

        const delta = mode === 'fixed' ? amount : 0;
        const pct = mode === 'percent' ? amount / 100 : 0;

        if (target === 'used' || target === 'both') {
          newUsed = mode === 'fixed' ? oldUsed + delta : Math.round(oldUsed * (1 + pct));
        }
        if (target === 'new' || target === 'both') {
          newNew = mode === 'fixed' ? oldNew + delta : Math.round(oldNew * (1 + pct));
        }

        return { name: v.name, oldUsed, oldNew, newUsed, newNew };
      });
      return { modelName: m.name, modelId: m.id, variants: adjusted, original: m };
    });
  }, [models, amount, mode, target]);

  const handleSave = async () => {
    if (amount === 0) return toast.error('กรุณาระบุจำนวนเงินที่ต้องการปรับ');
    setSaving(true);
    try {
      const auth = getAuth(app);
      const adminUser = auth.currentUser?.email || 'System Admin';

      for (const item of preview) {
        const updatedVariants = item.original.variants.map((v: any, i: number) => ({
          ...v,
          usedPrice: item.variants[i].newUsed,
          newPrice: item.variants[i].newNew,
        }));

        // Update modifier base prices if modifier mode
        const updates: any = { variants: updatedVariants, updatedAt: Date.now() };
        if (item.original.pricingMode === 'modifier') {
          const delta = mode === 'fixed' ? amount : 0;
          const pct = mode === 'percent' ? amount / 100 : 0;
          if (target === 'used' || target === 'both') {
            const old = Number(item.original.baseUsedPrice || 0);
            updates.baseUsedPrice = mode === 'fixed' ? old + delta : Math.round(old * (1 + pct));
          }
          if (target === 'new' || target === 'both') {
            const old = Number(item.original.baseNewPrice || 0);
            updates.baseNewPrice = mode === 'fixed' ? old + delta : Math.round(old * (1 + pct));
          }
        }

        await update(ref(db, `models/${item.modelId}`), updates);

        // Price ledger
        for (let i = 0; i < item.variants.length; i++) {
          const v = item.variants[i];
          if (v.oldUsed !== v.newUsed || v.oldNew !== v.newNew) {
            const ledgerRef = ref(db, 'price_ledger');
            const { push: fbPush } = await import('firebase/database');
            await update(fbPush(ledgerRef), {
              model_id: item.modelId,
              model_name: item.modelName,
              variant_name: v.name,
              price: v.newUsed,
              previous_price: v.oldUsed,
              updated_by: adminUser,
              updated_at: Date.now(),
            });
          }
        }
      }

      toast.success(`ปรับราคาเรียบร้อย! ${totalVariants} variants ใน ${models.length} รุ่น`);
      onClose();
    } catch {
      toast.error('เกิดข้อผิดพลาดในการปรับราคา');
    } finally {
      setSaving(false);
    }
  };

  const isDecrease = amount < 0;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center z-[60] p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b flex justify-between items-center">
          <div>
            <h3 className="font-black text-lg text-slate-800">Batch Price Adjust</h3>
            <p className="text-xs text-slate-400 font-bold">{seriesName} — {models.length} รุ่น, {totalVariants} variants</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-full transition"><X size={20} /></button>
        </div>

        {/* Controls */}
        <div className="p-6 space-y-4 border-b">
          {/* Mode */}
          <div className="flex gap-3">
            <button onClick={() => setMode('fixed')} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition ${mode === 'fixed' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
              +/- บาท (คงที่)
            </button>
            <button onClick={() => setMode('percent')} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition ${mode === 'percent' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
              +/- % (เปอร์เซ็นต์)
            </button>
          </div>

          {/* Target */}
          <div className="flex gap-2">
            {(['used', 'new', 'both'] as PriceTarget[]).map(t => (
              <button key={t} onClick={() => setTarget(t)} className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${target === t ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-400'}`}>
                {t === 'used' ? 'มือสอง' : t === 'new' ? 'ซีล' : 'ทั้งสอง'}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">
              จำนวนที่ปรับ {mode === 'percent' ? '(%)' : '(บาท)'} — ใส่ค่าลบเพื่อลดราคา
            </label>
            <input
              type="number"
              className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-lg font-black text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
              value={amount || ''}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder={mode === 'fixed' ? 'เช่น -2000 หรือ 1500' : 'เช่น -5 หรือ 10'}
            />
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto p-6">
          {amount === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8">ระบุจำนวนเพื่อดู Preview</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                {isDecrease ? <TrendingDown size={16} className="text-red-500" /> : <TrendingUp size={16} className="text-emerald-500" />}
                <span className="text-xs font-black text-slate-600">Preview การปรับราคา</span>
              </div>
              {preview.map((item) => (
                <div key={item.modelId} className="bg-slate-50 rounded-xl p-3 border">
                  <div className="font-bold text-sm text-slate-700 mb-2">{item.modelName}</div>
                  <div className="space-y-1">
                    {item.variants.slice(0, 3).map((v: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500 truncate flex-1">{v.name}</span>
                        {(target === 'used' || target === 'both') && (
                          <span className={`font-bold ${isDecrease ? 'text-red-600' : 'text-emerald-600'}`}>
                            ฿{fmt(v.oldUsed)} → ฿{fmt(v.newUsed)}
                          </span>
                        )}
                      </div>
                    ))}
                    {item.variants.length > 3 && (
                      <div className="text-[10px] text-slate-400">+{item.variants.length - 3} more...</div>
                    )}
                  </div>
                </div>
              ))}

              {preview.some(p => p.variants.some((v: any) => v.newUsed < 0 || v.newNew < 0)) && (
                <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-200 text-xs font-bold">
                  <AlertTriangle size={14} /> มีบาง variant ที่ราคาจะติดลบ!
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition">ยกเลิก</button>
          <button
            onClick={handleSave}
            disabled={amount === 0 || saving}
            className="px-8 py-2.5 rounded-xl text-sm font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2 shadow-md"
          >
            <Save size={16} /> {saving ? 'กำลังบันทึก...' : `ปรับราคา ${totalVariants} variants`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BatchPriceAdjustModal;
