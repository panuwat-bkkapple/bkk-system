'use client';

import React, { useState, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { detectAnomalies } from '../../utils/priceValidator';
import type { PriceAnomaly } from '../../utils/priceValidator';

interface PriceAnomalyBannerProps {
  models: any[];
  onEditModel?: (modelId: string) => void;
}

export const PriceAnomalyBanner: React.FC<PriceAnomalyBannerProps> = ({ models, onEditModel }) => {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const anomalies = useMemo(() => detectAnomalies(models), [models]);

  if (anomalies.length === 0 || dismissed) return null;

  const errors = anomalies.filter(a => a.severity === 'error');
  const warnings = anomalies.filter(a => a.severity === 'warning');

  return (
    <div className={`rounded-2xl border p-4 mb-4 ${errors.length > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className={errors.length > 0 ? 'text-red-500' : 'text-amber-500'} />
          <span className="font-black text-sm text-slate-800">
            พบราคาผิดปกติ {anomalies.length} รายการ
          </span>
          {errors.length > 0 && (
            <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-md">{errors.length} errors</span>
          )}
          {warnings.length > 0 && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-md">{warnings.length} warnings</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)} className="text-xs font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1 transition">
            {expanded ? <><ChevronUp size={14} /> ซ่อน</> : <><ChevronDown size={14} /> ดูรายละเอียด</>}
          </button>
          <button onClick={() => setDismissed(true)} className="text-slate-400 hover:text-slate-600 transition">
            <XCircle size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {anomalies.map((a: PriceAnomaly, i: number) => (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs p-2 rounded-lg border ${
                a.severity === 'error' ? 'bg-red-100/50 border-red-200' : 'bg-amber-100/50 border-amber-200'
              }`}
            >
              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${
                a.severity === 'error' ? 'bg-red-200 text-red-700' : 'bg-amber-200 text-amber-700'
              }`}>
                {a.severity}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-700">{a.modelName} — {a.message}</div>
                <div className="text-slate-500 truncate">{a.detail}</div>
              </div>
              {onEditModel && (
                <button
                  onClick={() => onEditModel(a.modelId)}
                  className="text-[10px] font-bold text-blue-600 hover:underline shrink-0"
                >
                  แก้ไข
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PriceAnomalyBanner;
