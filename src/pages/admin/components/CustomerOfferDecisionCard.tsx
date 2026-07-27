/* eslint-disable @typescript-eslint/no-explicit-any */
// การ์ดตัดสินข้อเสนอราคาลูกค้า (Make Offer) — ฝังใน header เข้มของ PricingSidebar
// และใน MobileTicketDetail. สถานะ pending = CEO/MANAGER เลือก รับ / เคาน์เตอร์ /
// ยืนราคาประเมิน; สถานะอื่นแสดงผลอย่างเดียว. เงินถูกเขียนโดย handler ฝั่ง
// workspace (handleDecideCustomerOffer) — การ์ดนี้ไม่แตะ Firebase เอง
import React, { useState } from 'react';
import { HandCoins, Check, X } from 'lucide-react';
import { formatCurrency } from '@/utils/formatters';
import { customerOfferOf, OFFER_STATUS_LABEL_TH } from '@/utils/customerOffer';

export type OfferDecision = 'accept' | 'counter' | 'decline';

export const CustomerOfferDecisionCard: React.FC<{
  job: any;
  canReview: boolean;
  onDecide: (decision: OfferDecision, counterAmount?: number, note?: string) => Promise<void>;
  /** โทนสว่าง (mobile detail) — default โทนเข้มของ PricingSidebar header */
  light?: boolean;
}> = ({ job, canReview, onDecide, light }) => {
  const offer = customerOfferOf(job);
  const [mode, setMode] = useState<'idle' | 'counter'>('idle');
  const [counterAmount, setCounterAmount] = useState('');
  const [counterNote, setCounterNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!offer) return null;

  const pct = offer.quote_at_offer > 0
    ? Math.round(((offer.amount - offer.quote_at_offer) / offer.quote_at_offer) * 1000) / 10
    : 0;
  const pending = offer.status === 'pending';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const wrap = light
    ? 'mb-4 p-4 rounded-2xl bg-amber-50 border border-amber-200'
    : 'mb-4 p-3 rounded-xl bg-amber-500/15 border border-amber-400/30';
  const titleCls = light ? 'text-amber-700' : 'text-amber-300';
  const textCls = light ? 'text-slate-600' : 'text-amber-100/90';
  const numCls = light ? 'text-slate-900' : 'text-white';

  return (
    <div className={wrap}>
      <p className={`text-xs font-black mb-1.5 flex items-center gap-1.5 ${titleCls}`}>
        <HandCoins size={14} /> ลูกค้าเสนอราคาเอง (Make Offer) · {OFFER_STATUS_LABEL_TH[offer.status]}
      </p>
      <div className={`space-y-1 text-[11.5px] font-bold ${textCls}`}>
        <div className="flex justify-between"><span>ราคาประเมิน ณ ตอนเสนอ</span><span>{formatCurrency(offer.quote_at_offer)}</span></div>
        <div className="flex justify-between items-baseline">
          <span>ราคาที่ลูกค้าเสนอ</span>
          <span className={`text-sm font-black ${numCls}`}>{formatCurrency(offer.amount)} <span className={titleCls}>(+{pct}%)</span></span>
        </div>
        {Number(offer.counter_amount) > 0 && (
          <div className="flex justify-between"><span>ราคาเคาน์เตอร์ของเรา</span><span className={numCls}>{formatCurrency(Number(offer.counter_amount))}</span></div>
        )}
        {offer.reason && (
          <p className={`pt-1 font-medium leading-relaxed ${textCls}`}>เหตุผลลูกค้า: {offer.reason}</p>
        )}
        {offer.decided_by_name && offer.status !== 'pending' && (
          <p className={`pt-0.5 font-medium ${textCls}`}>ตัดสินโดย {offer.decided_by_name}</p>
        )}
      </div>

      {pending && (
        canReview ? (
          mode === 'counter' ? (
            <div className="mt-3 space-y-2">
              <input
                type="number"
                value={counterAmount}
                onChange={(e) => setCounterAmount(e.target.value)}
                placeholder={`ราคาเคาน์เตอร์ (ระหว่าง ${offer.quote_at_offer.toLocaleString()} - ${offer.amount.toLocaleString()})`}
                className="w-full p-2.5 rounded-lg text-sm font-bold text-slate-900 bg-white border border-amber-300 outline-none focus:ring-2 focus:ring-amber-500"
              />
              <input
                type="text"
                value={counterNote}
                onChange={(e) => setCounterNote(e.target.value.slice(0, 200))}
                placeholder="หมายเหตุถึงลูกค้า (ไม่บังคับ)"
                className="w-full p-2.5 rounded-lg text-sm font-bold text-slate-900 bg-white border border-amber-300 outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex gap-2">
                <button
                  disabled={busy || !(Number(counterAmount) > offer.quote_at_offer && Number(counterAmount) < offer.amount)}
                  onClick={() => run(() => onDecide('counter', Math.round(Number(counterAmount)), counterNote.trim()))}
                  className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white text-xs font-black hover:bg-amber-600 disabled:opacity-40 transition-colors"
                >ส่งเคาน์เตอร์ให้ลูกค้า</button>
                <button onClick={() => setMode('idle')} disabled={busy}
                  className="px-3 py-2.5 rounded-lg bg-white/80 text-slate-600 text-xs font-black hover:bg-white transition-colors"><X size={14} /></button>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm(`รับข้อเสนอ ${formatCurrency(offer.amount)}? ราคางานจะปรับตามข้อเสนอและแจ้งลูกค้าอัตโนมัติ`)) {
                    run(() => onDecide('accept'));
                  }
                }}
                className="py-2.5 rounded-lg bg-emerald-500 text-white text-xs font-black hover:bg-emerald-600 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
              ><Check size={13} /> รับ</button>
              <button
                disabled={busy}
                onClick={() => setMode('counter')}
                className="py-2.5 rounded-lg bg-amber-500 text-white text-xs font-black hover:bg-amber-600 disabled:opacity-40 transition-colors"
              >เคาน์เตอร์</button>
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm('ยืนราคาประเมินเดิม? งานเดินต่อที่ราคาประเมิน และแจ้งลูกค้าอัตโนมัติ')) {
                    run(() => onDecide('decline'));
                  }
                }}
                className="py-2.5 rounded-lg bg-slate-500/80 text-white text-xs font-black hover:bg-slate-600 disabled:opacity-40 transition-colors"
              >ยืนราคาเดิม</button>
            </div>
          )
        ) : (
          <p className={`mt-2 text-[11px] font-bold ${titleCls}`}>รอ CEO/MANAGER ตัดสินข้อเสนอนี้</p>
        )
      )}
    </div>
  );
};
