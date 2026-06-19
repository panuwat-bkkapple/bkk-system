'use client';

import React, { useMemo, useState } from 'react';
import { Calculator, Wallet } from 'lucide-react';
import {
  resolveOptionDeduction,
  resolveFinalPrice,
  isPercentOption,
} from '../../../../utils/pricingResolver';

interface Props {
  /** The model being edited (editingItem) — uses its conditionSetId, variants, liquidityFactor. */
  model: any;
  conditionSets: any[];
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString()}`;

/**
 * In-product price simulator. Pulls the model's assigned condition set
 * (Engine Rules), lets the admin pick a base price + conditions, and computes
 * the resulting customer price LIVE using the SAME pricingResolver the customer
 * site / server / inspection use — so testing here matches reality without
 * opening the public website. Read-only: it never writes the set or the model.
 */
export const PriceSimulatorPanel: React.FC<Props> = ({ model, conditionSets }) => {
  const set = useMemo(
    () => conditionSets.find((s) => s.id === model?.conditionSetId),
    [conditionSets, model?.conditionSetId],
  );

  const variants: any[] = Array.isArray(model?.variants) ? model.variants : [];
  const variantBase = (v: any) => Number(v?.usedPrice || v?.price || 0);
  const defaultBase =
    variantBase(variants[0]) ||
    Number(model?.baseUsedPrice || 0) ||
    Number(model?.baseNewPrice || 0) ||
    0;

  const [basePrice, setBasePrice] = useState<number>(defaultBase);
  // groupId -> selected optionId
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const lf = model?.liquidityFactor;
  const groups: any[] = set?.groups || [];

  const { lines, total } = useMemo(() => {
    const out: { groupTitle: string; label: string; amount: number; pct?: number }[] = [];
    let sum = 0;
    for (const g of groups) {
      const opt = (g.options || []).find((o: any) => o.id === answers[g.id]);
      if (opt) {
        const amount = resolveOptionDeduction(opt, basePrice, lf);
        sum += amount;
        out.push({
          groupTitle: g.title || '',
          label: opt.label || '',
          amount,
          pct: isPercentOption(opt) ? Number(opt.pct) : undefined,
        });
      }
    }
    return { lines: out, total: sum };
  }, [groups, answers, basePrice, lf]);

  const finalPrice = resolveFinalPrice(basePrice, total);
  const lfNum = Number(lf);
  const lfActive = lfNum > 0 && lfNum !== 1;

  if (!model?.conditionSetId || !set) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-400">
        เลือก "Assign Condition Item" ด้านบนก่อน เพื่อทดสอบราคาของรุ่นนี้
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Calculator size={16} className="text-violet-600" />
        <span className="text-xs font-black uppercase tracking-wide text-violet-700">ทดสอบราคา (Price Simulator)</span>
        <span className="text-[10px] font-bold text-slate-400">ตรงกับหน้าเว็บลูกค้า</span>
      </div>

      {/* Base price: editable + quick-pick from variants */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase text-slate-400">ราคาตั้งต้น (base price)</label>
        <input
          type="number"
          min={0}
          value={basePrice}
          onChange={(e) => setBasePrice(Number(e.target.value) || 0)}
          className="w-full p-2.5 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-800 focus:ring-2 focus:ring-violet-500 outline-none"
        />
        {variants.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {variants.slice(0, 12).map((v: any, i: number) => (
              <button
                key={v.id || v.name || i}
                type="button"
                onClick={() => setBasePrice(variantBase(v))}
                className={`text-[10px] font-bold px-2 py-1 rounded-md border transition ${
                  basePrice === variantBase(v)
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'
                }`}
                title={baht(variantBase(v))}
              >
                {v.name || `variant ${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Condition groups — pick one option per group (radio); chips show the
          effective deduction for THIS base price + lf. */}
      <div className="space-y-3">
        {groups.map((g: any) => (
          <div key={g.id}>
            <div className="text-[11px] font-black text-slate-600 mb-1.5">{g.title}</div>
            <div className="flex flex-wrap gap-1.5">
              {(g.options || []).map((opt: any) => {
                const amount = resolveOptionDeduction(opt, basePrice, lf);
                const selected = answers[g.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setAnswers((prev) => {
                        const next = { ...prev };
                        if (next[g.id] === opt.id) delete next[g.id];
                        else next[g.id] = opt.id;
                        return next;
                      })
                    }
                    className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition text-left ${
                      selected
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-rose-300'
                    }`}
                  >
                    {opt.label || 'ไม่มีชื่อ'}
                    <span className={`ml-1.5 ${selected ? 'text-rose-100' : 'text-rose-500'}`}>
                      {amount > 0 ? `-${baht(amount)}` : '0'}
                      {isPercentOption(opt) ? ` · ${Number(opt.pct)}%` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Result */}
      <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-1 text-sm">
        <div className="flex justify-between text-slate-500 font-bold">
          <span>ราคาตั้งต้น</span><span>{baht(basePrice)}</span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between text-rose-600 text-xs">
            <span className="truncate pr-2">− {l.groupTitle}: {l.label}{l.pct != null ? ` (${l.pct}%)` : ''}</span>
            <span className="shrink-0">-{baht(l.amount)}</span>
          </div>
        ))}
        {lfActive && (
          <div className="text-[10px] text-emerald-600 font-bold">× liquidityFactor {lfNum} (รวมในตัวเลขแล้ว)</div>
        )}
        <div className="flex justify-between items-center pt-1.5 border-t border-slate-100 font-black text-emerald-700">
          <span className="flex items-center gap-1"><Wallet size={14} /> ราคาที่ลูกค้าจะได้</span>
          <span className="text-lg">{baht(finalPrice)}</span>
        </div>
      </div>
    </div>
  );
};

export default PriceSimulatorPanel;
