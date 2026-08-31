import { describe, it, expect } from 'vitest';
import { parseAmountInput, signedAmount } from './signedAmount';

// Cases mirror how staff actually type on the order-detail adjustment field
// (PricingSidebar + MobileTicketDetail), not just the happy path.

describe('parseAmountInput', () => {
  it('keeps digits and leaves the direction untouched when no minus is typed', () => {
    expect(parseAmountInput('500', null)).toEqual({ amount: '500', direction: null });
    expect(parseAmountInput('500', 'add')).toEqual({ amount: '500', direction: 'add' });
  });

  it('typing or pasting "-500" (the old desktop habit) switches to deduct', () => {
    expect(parseAmountInput('-500', null)).toEqual({ amount: '500', direction: 'deduct' });
    // Even mid-string — "5-00" from a fumbled keypad still means deduct.
    expect(parseAmountInput('5-00', null)).toEqual({ amount: '500', direction: 'deduct' });
  });

  it('a minus overrides an already-chosen "add"', () => {
    expect(parseAmountInput('-500', 'add')).toEqual({ amount: '500', direction: 'deduct' });
  });

  it('deleting back to empty keeps the chosen direction', () => {
    expect(parseAmountInput('', 'deduct')).toEqual({ amount: '', direction: 'deduct' });
  });

  it('strips everything that is not a digit', () => {
    expect(parseAmountInput('1,500฿', 'add').amount).toBe('1500');
  });
});

describe('signedAmount', () => {
  it('is null until a direction is chosen — submit must stay disabled', () => {
    expect(signedAmount('500', null)).toBeNull();
  });

  it('is null for empty or zero amounts (zero-baht lines are rejected)', () => {
    expect(signedAmount('', 'deduct')).toBeNull();
    expect(signedAmount('0', 'deduct')).toBeNull();
  });

  it('applies the sign from the direction', () => {
    expect(signedAmount('500', 'deduct')).toBe(-500);
    expect(signedAmount('1000', 'add')).toBe(1000);
  });
});
