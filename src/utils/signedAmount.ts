// Sign entry for ad-hoc adjustment amounts. iOS's numeric keypad has no
// minus key, so the amount field takes DIGITS ONLY and the sign comes from
// an explicit direction toggle (deduct/add) — the same convention the rider
// app and AmendmentReviewModal already use (positive text, sign applied in
// code). The stored shape is unchanged: callers still write one signed
// number into JobAdjustment.amount.

export type AmountDirection = 'deduct' | 'add';

// Normalise a raw keystroke/paste into digits + (possibly) a direction.
// A "-" anywhere in the raw text (typed on desktop/Android, or pasted)
// switches the toggle to deduct — staff used to typing "-500" keep their
// habit working instead of silently losing the sign.
export function parseAmountInput(
  raw: string,
  current: AmountDirection | null,
): { amount: string; direction: AmountDirection | null } {
  return {
    amount: raw.replace(/[^0-9]/g, ''),
    direction: raw.includes('-') ? 'deduct' : current,
  };
}

// null = not submittable yet (no direction chosen, or no positive number
// typed). Direction is REQUIRED by design, not defaulted: a wrong-sign line
// either overpays the customer or shows a bogus deduction on their tracking
// page, so the form makes staff pick a side every time.
export function signedAmount(amount: string, direction: AmountDirection | null): number | null {
  if (!direction) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return direction === 'deduct' ? -n : n;
}
