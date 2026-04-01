'use client';

import React from 'react';
import { CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import type { DetectResult } from '../../utils/variantGenerator';

interface UpgradePreviewPanelProps {
  result: DetectResult;
  onConfirm: () => void;
  onCancel: () => void;
}

const fmt = (n: number) => n.toLocaleString('th-TH');

export const UpgradePreviewPanel: React.FC<UpgradePreviewPanelProps> = ({
  result, onConfirm, onCancel,
}) => {
  const { baseNewPrice, baseUsedPrice, modifiers, matchedCount, totalCount, mismatches } = result;
  const pct = totalCount > 0 ? Math.round((matchedCount / totalCount) * 100) : 0;
  const isGood = pct >= 80;

  return (
    <div className="space-y-4">
      {/* Accuracy Banner */}
      <div className={`p-4 rounded-xl border flex items-start gap-3 ${isGood ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        {isGood ? <CheckCircle size={20} className="text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />}
        <div>
          <div className="font-black text-sm">
            {isGood ? 'วิเคราะห์สำเร็จ!' : 'วิเคราะห์เสร็จแล้ว (มีราคาไม่ตรงบางส่วน)'}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            ราคาตรง <span className="font-black">{matchedCount}/{totalCount}</span> variants ({pct}%)
            {mismatches.length > 0 && ` — ไม่ตรง ${mismatches.length} รายการ (tolerance ±฿500)`}
          </div>
        </div>
      </div>

      {/* Detected Base Price */}
      <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
        <div className="text-[10px] font-black text-blue-500 uppercase tracking-wider mb-2">Base Price (ตรวจพบ)</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[9px] font-bold text-emerald-600 uppercase">ซีล</span>
            <div className="text-lg font-black text-emerald-700">฿{fmt(baseNewPrice)}</div>
          </div>
          <div>
            <span className="text-[9px] font-bold text-blue-600 uppercase">มือสอง</span>
            <div className="text-lg font-black text-blue-700">฿{fmt(baseUsedPrice)}</div>
          </div>
        </div>
      </div>

      {/* Detected Modifiers */}
      {Object.entries(modifiers).map(([key, mod]) => (
        mod.options.length > 0 && (
          <div key={key} className="bg-white p-3 rounded-xl border border-slate-200">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">{key}</div>
            <div className="space-y-1">
              {mod.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-700 w-32 truncate">{opt.value}</span>
                  <span className="font-black text-emerald-600 w-20">
                    {opt.newPriceMod === 0 ? 'base' : `+฿${fmt(opt.newPriceMod)}`}
                  </span>
                  <span className="font-black text-blue-600 w-20">
                    {opt.usedPriceMod === 0 ? 'base' : `+฿${fmt(opt.usedPriceMod)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {/* Mismatches */}
      {mismatches.length > 0 && (
        <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
          <div className="text-[10px] font-black text-amber-600 uppercase tracking-wider mb-2">
            ราคาไม่ตรง ({mismatches.length} รายการ)
          </div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {mismatches.map((m, i) => (
              <div key={i} className="text-[11px] flex items-center gap-2">
                <span className="text-slate-600 truncate flex-1">{m.variantName}</span>
                <span className="text-slate-400">฿{fmt(m.expected)}</span>
                <ArrowRight size={10} className="text-slate-300" />
                <span className="font-bold text-amber-700">฿{fmt(m.actual)}</span>
                <span className="text-[9px] text-amber-500">({m.diff > 0 ? '+' : ''}{fmt(m.diff)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onConfirm}
          className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-sm hover:bg-blue-700 transition shadow-md"
        >
          ยืนยันอัพเกรด
        </button>
        <button
          onClick={onCancel}
          className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition"
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
};

export default UpgradePreviewPanel;
