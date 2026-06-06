// ผังบัญชี (chart of accounts) + double-entry helpers — Phase 4d foundation.
// ผังบัญชีมาตรฐานแบบย่อสำหรับธุรกิจรับซื้อ-ขายมือถือ. ปรับ/เพิ่มได้ตามที่
// ผู้ทำบัญชีกำหนด (ค่านี้เป็น default; ภายหลังอาจย้ายไป settings ได้).

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  code: string;
  name: string;
  type: AccountType;
}

export const ACCOUNT_TYPE_TH: Record<AccountType, string> = {
  asset: 'สินทรัพย์',
  liability: 'หนี้สิน',
  equity: 'ส่วนของเจ้าของ',
  revenue: 'รายได้',
  expense: 'ค่าใช้จ่าย',
};

// บัญชีปกติฝั่งเดบิต = asset, expense; ฝั่งเครดิต = liability, equity, revenue.
export function normalSide(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}

export const DEFAULT_COA: Account[] = [
  // สินทรัพย์
  { code: '1010', name: 'เงินสด', type: 'asset' },
  { code: '1020', name: 'เงินฝากธนาคาร', type: 'asset' },
  { code: '1030', name: 'ลูกหนี้การค้า', type: 'asset' },
  { code: '1040', name: 'สินค้าคงเหลือ', type: 'asset' },
  { code: '1050', name: 'ภาษีซื้อ', type: 'asset' },
  // หนี้สิน
  { code: '2010', name: 'เจ้าหนี้การค้า', type: 'liability' },
  { code: '2020', name: 'ภาษีขายที่ต้องนำส่ง', type: 'liability' },
  { code: '2030', name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', type: 'liability' },
  // ส่วนของเจ้าของ
  { code: '3010', name: 'ทุนจดทะเบียน', type: 'equity' },
  { code: '3020', name: 'กำไรสะสม', type: 'equity' },
  // รายได้
  { code: '4010', name: 'รายได้จากการขายสินค้า', type: 'revenue' },
  { code: '4020', name: 'รายได้ค่าบริการ', type: 'revenue' },
  // ต้นทุน/ค่าใช้จ่าย
  { code: '5010', name: 'ต้นทุนขาย', type: 'expense' },
  { code: '5020', name: 'ค่าใช้จ่ายดำเนินงาน', type: 'expense' },
  { code: '5030', name: 'ค่าใช้จ่ายค่าขนส่ง/ไรเดอร์', type: 'expense' },
];

export const ACCOUNT_BY_CODE: Record<string, Account> = Object.fromEntries(
  DEFAULT_COA.map((a) => [a.code, a])
);

export interface JournalLine {
  account: string; // account code
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id?: string;
  date: string; // YYYY-MM-DD
  period: string; // YYYYMM
  description: string;
  ref?: string;
  source?: string; // 'manual' | 'pos' | 'service' | ...
  lines: JournalLine[];
  created_at: number;
  created_by?: string;
}

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function entryIsBalanced(lines: JournalLine[]): boolean {
  const d = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const c = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  return d === c && d > 0;
}

export function periodFromDate(date: string): string {
  // date = YYYY-MM-DD -> YYYYMM
  return (date || '').slice(0, 7).replace('-', '');
}
