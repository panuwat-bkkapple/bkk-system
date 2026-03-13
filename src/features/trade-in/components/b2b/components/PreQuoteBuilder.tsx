import React from 'react';
import { ClipboardCheck, CalendarClock, X } from 'lucide-react';

interface PreQuoteBuilderProps {
  job: any;
  expectedItems: any[];
  expModel: string;
  expQty: number;
  expPrice: number;
  onExpModelChange: (val: string) => void;
  onExpQtyChange: (val: number) => void;
  onExpPriceChange: (val: number) => void;
  onAddItem: () => void;
  onRemoveItem: (id: string) => void;
  quoteExpiryDate: string;
  onQuoteExpiryDateChange: (val: string) => void;
  onSaveDate: (field: string, val: string) => void;
  basePricing: any[];
  preQuoteTotal: number;
}

export const PreQuoteBuilder = ({
  job, expectedItems, expModel, expQty, expPrice,
  onExpModelChange, onExpQtyChange, onExpPriceChange,
  onAddItem, onRemoveItem,
  quoteExpiryDate, onQuoteExpiryDateChange, onSaveDate,
  basePricing, preQuoteTotal
}: PreQuoteBuilderProps) => {
  const statusLower = String(job.status || '').toLowerCase();
  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes(statusLower);

  return (
    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 space-y-6">
      <div className="flex justify-between items-center border-b border-slate-100 pb-4">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">
          <ClipboardCheck className="text-indigo-500" size={20}/> 2. Pre-Quote Builder (เสนอราคาเบื้องต้น)
        </h3>
      </div>

      <div className="bg-amber-50/50 p-6 rounded-3xl border border-amber-100">

        {/* DUE DATE: Quote Validity */}
        <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-2xl border border-amber-200 shadow-sm w-fit">
           <CalendarClock size={18} className="text-amber-500"/>
           <label className="text-xs font-black text-amber-800 uppercase tracking-widest">Quote Validity (ใช้ได้ถึงวันที่):</label>
           <input type="date" value={quoteExpiryDate} disabled={isCancelled}
             onChange={e => { onQuoteExpiryDateChange(e.target.value); onSaveDate('quote_expiry_date', e.target.value); }}
             className="bg-amber-50 border border-amber-200 text-amber-900 font-bold px-3 py-1.5 rounded-lg outline-none focus:border-amber-500"
           />
        </div>

        {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && !isCancelled && (
          <div className="flex gap-4 mb-6 items-end">
            <div className="flex-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-2">รุ่น / อุปกรณ์ (Model)</label>
              <select
                value={expModel}
                onChange={(e) => {
                  const selectedName = e.target.value; onExpModelChange(selectedName);
                  let foundPrice = 0;
                  for (const model of basePricing) {
                    if (model.variants && model.variants.length > 0) {
                      const matchedVariant = model.variants.find((v: any) => `${model.name} ${v.name}`.trim() === selectedName);
                      if (matchedVariant) { foundPrice = Number(matchedVariant.usedPrice || matchedVariant.price || matchedVariant.newPrice || 0); break; }
                    } else {
                      if (model.name === selectedName) { foundPrice = Number(model.price || 0); break; }
                    }
                  }
                  onExpPriceChange(foundPrice);
                }}
                className="w-full bg-white border border-amber-200 p-4 rounded-xl font-bold text-sm outline-none focus:border-amber-500 shadow-sm"
              >
                <option value="">-- เลือกรุ่นและความจุ --</option>
                {basePricing?.map((model: any) => {
                  if (model.variants && model.variants.length > 0) {
                    return model.variants.map((v: any) => <option key={`${model.id}-${v.id}`} value={`${model.name} ${v.name}`.trim()}>{`${model.name} ${v.name}`.trim()}</option>);
                  } else {
                    return <option key={model.id} value={model.name}>{model.name}</option>;
                  }
                })}
              </select>
            </div>
            <div className="w-32"><label className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-2">จำนวน (Qty)</label><input type="number" value={expQty} onChange={e => onExpQtyChange(Number(e.target.value))} className="w-full bg-white border border-amber-200 p-4 rounded-xl font-black text-sm outline-none text-center shadow-sm focus:border-amber-500" /></div>
            <div className="w-48"><label className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-2">ราคา/เครื่อง (Unit)</label><input type="number" value={expPrice || ''} onChange={e => onExpPriceChange(Number(e.target.value))} className="w-full bg-white border border-amber-200 p-4 rounded-xl font-black text-sm outline-none shadow-sm focus:border-amber-500 text-right" /></div>
            <button onClick={onAddItem} className="bg-amber-500 text-white px-8 py-4 rounded-xl font-black text-xs uppercase hover:bg-amber-600 shadow-sm transition-colors active:scale-95">Add</button>
          </div>
        )}

        {expectedItems.length > 0 ? (
          <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-amber-50/80 border-b border-amber-100 text-amber-800">
                <tr>
                  <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px]">รุ่น / สินทรัพย์ (Asset)</th>
                  <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-center">จำนวน</th>
                  <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-right">ราคา/เครื่อง</th>
                  <th className="py-4 px-6 font-black uppercase tracking-widest text-[10px] text-right">รวม (Subtotal)</th>
                  {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && <th className="w-12"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-50">
                {expectedItems.map((item: any) => (
                  <tr key={item.id}>
                    <td className="py-4 px-6 font-bold text-slate-800">{item.model}</td>
                    <td className="py-4 px-6 text-center font-black text-indigo-600 bg-indigo-50/30">{item.qty}</td>
                    <td className="py-4 px-6 text-right text-slate-600 font-medium">฿{item.unit_price.toLocaleString()}</td>
                    <td className="py-4 px-6 text-right font-black text-emerald-600 bg-emerald-50/30">฿{(item.qty * item.unit_price).toLocaleString()}</td>
                    {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && (
                      <td className="py-4 px-2 text-center"><button onClick={() => onRemoveItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><X size={16} /></button></td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-amber-100/50 border-t border-amber-200">
                <tr>
                  <td colSpan={3} className="py-4 px-6 text-right font-black text-[11px] text-amber-800 uppercase tracking-widest">ยอดประเมินเบื้องต้น (Pre-Quote Total)</td>
                  <td className="py-4 px-6 text-right font-black text-2xl text-amber-600">฿{preQuoteTotal.toLocaleString()}</td>
                  {['new b2b lead', 'following up', 'pre-quote sent', 'pre-quote accepted'].includes(statusLower) && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-amber-400">
            <ClipboardCheck size={32} className="mb-2 opacity-50"/>
            <p className="text-xs font-bold">ยังไม่มีการคีย์รายการเบื้องต้น</p>
          </div>
        )}
      </div>
    </div>
  );
};
