// แยก "ค่าจ้าง" ออกจาก "เงินคืนค่าทดรอง" ในยอดถอนหนึ่งครั้ง — ฝั่งหน้าจอ
//
// **MIRROR ของ `functions/rider-cost-split.js` ซึ่งเป็นตัวจริง** (ลงบัญชีค่าจ้าง
// ตอนถอน + ฐานภาษี ณ ที่จ่ายบนหนังสือรับรอง) functions เป็น JS import TS ไม่ได้
// ฝั่งจอต้องมีเพราะคนกดโอนต้องเห็น "ยอดที่ต้องโอนจริง" ก่อนโอน และยอดนั้น
// ขึ้นกับว่าถอนก้อนนี้เป็นค่าจ้างเท่าไร เงินคืนเท่าไร
//
// สองสำเนาถูกตรึงให้ตอบเท่ากันด้วย `riderCostSplitParity.test.ts` ซึ่งรัน
// fixture ชุดเดียวกันผ่านทั้งสองไฟล์แล้ว deep-equal — **แก้ที่หนึ่งต้องแก้ทั้งคู่**
// และเทสนั้นคือด่านที่บอกว่าลืม
//
// กติกา (อ่านเหตุผลเต็มที่หัวไฟล์ JS): FIFO เงินคืนออกก่อนค่าจ้าง · "ที่ผ่านมา"
// = แถวก่อนแถวเป้าหมายเท่านั้น · แถวถอนเก่าที่มี `reimbursed_part` ใช้ค่านั้น
// (ตัวเลขที่ลงบัญชีแล้วห้ามคำนวณใหม่ให้ต่างจากเดิม)

export interface LedgerRow {
  id: string;
  type?: string;
  category?: string;
  amount?: number | string;
  timestamp?: number | string;
  created_at?: number | string;
  reimbursed_part?: number | string | null;
}

export interface WithdrawalSplit {
  gross: number;
  reimbursed: number;
  labour: number;
}

/** MIRROR ของ REIMBURSEMENT_CATEGORIES ฝั่ง functions */
export const REIMBURSEMENT_CATEGORIES: ReadonlySet<string> = new Set(['EXPENSE_REIMBURSEMENT']);

const num = (v: unknown): number => {
  if (typeof v !== 'number' && typeof v !== 'string') return 0;
  if (typeof v === 'string' && v.trim() === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitWithdrawal(rows: readonly (LedgerRow | null | undefined)[], txId: string): WithdrawalSplit | null {
  const list = (Array.isArray(rows) ? rows : []).filter((r): r is LedgerRow => !!r);
  const target = list.find((r) => r.id === txId);
  if (!target || target.category !== 'WITHDRAWAL') return null;

  const timeOf = (r: LedgerRow) => num(r.timestamp) || num(r.created_at);
  const at = timeOf(target);

  const before = list.filter((r) => {
    const t = timeOf(r);
    if (t < at) return true;
    return t === at && String(r.id) < String(txId);
  });

  let pool = 0;
  for (const r of before) {
    if (r.type === 'CREDIT' && REIMBURSEMENT_CATEGORIES.has(String(r.category))) {
      pool += num(r.amount);
    }
    if (r.type === 'DEBIT' && r.category === 'WITHDRAWAL') {
      const recorded = r.reimbursed_part;
      pool -= recorded == null ? Math.min(num(r.amount), Math.max(pool, 0)) : num(recorded);
    }
  }
  pool = Math.max(0, pool);

  const gross = num(target.amount);
  const reimbursed = round2(Math.min(gross, pool));
  return { gross: round2(gross), reimbursed, labour: round2(gross - reimbursed) };
}

/**
 * ฐานภาษีของการถอนที่**ยังไม่ได้เขียนลง ledger** — หน้าจอโอนเงินเรียกก่อน
 * เขียนแถว จึงประกอบแถวจำลองต่อท้ายแล้วแยกด้วยกฎเดียวกัน
 * server (onRiderWithdrawalExpense) จะคำนวณซ้ำจากแถวจริงหลังเขียน และได้ผล
 * เท่ากันตราบใดที่ไม่มีแถวถอนของคนเดียวกันแทรกระหว่างสองจังหวะนั้น
 */
export function splitPendingWithdrawal(rows: readonly LedgerRow[], amount: number, now: number): WithdrawalSplit {
  const PENDING_ID = '\uffff-pending';
  const split = splitWithdrawal(
    [...rows, { id: PENDING_ID, type: 'DEBIT', category: 'WITHDRAWAL', amount, timestamp: now }],
    PENDING_ID,
  );
  return split || { gross: round2(num(amount)), reimbursed: 0, labour: round2(num(amount)) };
}
