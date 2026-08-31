// Direction toggle (- หัก / + เพิ่ม) + digits-only amount field for ad-hoc
// price adjustments. Shared by the desktop PricingSidebar and the mobile
// MobileTicketDetail so the two order-detail surfaces cannot drift apart
// (they used to be hand-copied). Why a toggle instead of typing "-":
// iOS's numeric keypad has no minus key, so staff on the primary device
// could never enter a deduction.
//
// Renders as fragment children of the caller's flex row; the caller keeps
// its own submit button and gates it with signedAmount() === null.

import React from 'react';
import { parseAmountInput } from '../utils/signedAmount';
import type { AmountDirection } from '../utils/signedAmount';

interface SignedAmountInputProps {
  amount: string;
  direction: AmountDirection | null;
  onChange: (amount: string, direction: AmountDirection | null) => void;
  /** dark = PricingSidebar (slate-900 card) · light = mobile ticket detail */
  tone: 'dark' | 'light';
}

// Same red/emerald pairs each surface already uses for adjustment lines.
const TONE = {
  dark: {
    idle: 'bg-slate-800 border-slate-700 text-slate-500',
    deduct: 'bg-red-500/20 border-red-500/30 text-red-300',
    add: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300',
    input: 'bg-slate-800 border border-slate-700 text-white placeholder:text-slate-500',
  },
  light: {
    idle: 'bg-slate-50 border-slate-200 text-slate-400',
    deduct: 'bg-red-50 border-red-200 text-red-500',
    add: 'bg-emerald-50 border-emerald-200 text-emerald-600',
    input: 'bg-slate-50 border border-slate-200',
  },
} as const;

export const SignedAmountInput: React.FC<SignedAmountInputProps> = ({
  amount, direction, onChange, tone,
}) => {
  const t = TONE[tone];
  return (
    <>
      <button
        type="button"
        aria-pressed={direction === 'deduct'}
        onClick={() => onChange(amount, 'deduct')}
        className={`px-2 py-1.5 rounded-lg text-xs font-black border shrink-0 ${direction === 'deduct' ? t.deduct : t.idle}`}
      >- หัก</button>
      <button
        type="button"
        aria-pressed={direction === 'add'}
        onClick={() => onChange(amount, 'add')}
        className={`px-2 py-1.5 rounded-lg text-xs font-black border shrink-0 ${direction === 'add' ? t.add : t.idle}`}
      >+ เพิ่ม</button>
      <input
        value={amount}
        onChange={(e) => {
          const next = parseAmountInput(e.target.value, direction);
          onChange(next.amount, next.direction);
        }}
        inputMode="numeric"
        placeholder="500"
        aria-label="จำนวนเงิน (บาท)"
        className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs text-right ${t.input}`}
      />
    </>
  );
};
