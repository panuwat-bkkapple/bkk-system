// ด่านของ scripts/rider-wallet-audit.cjs — สคริปต์ตรวจกระเป๋าไรเดอร์ที่ต้องอ่านอย่างเดียว
// "โดยโครงสร้าง" ไม่ใช่โดยวินัย: ไฟล์ต้องไม่มีเมธอดเขียน RTDB แม้แต่ตัวเดียว และไม่มี
// สวิตช์เขียนจริง. เทสนี้ grep ไฟล์จริง (ไม่ใช่ mock) และพิสูจน์ก่อนว่า regex ของตัวเอง
// จับได้จริงด้วยตัวอย่างที่ควรแดง — ด่านที่ไม่ได้ทดสอบว่าจับอะไรได้ คือด่านที่ไม่รู้ว่าตัวเองว่าง
//
// ส่วนที่สองเทสตัววิเคราะห์ (pure) ด้วย fixture ที่สร้างจากข้อเท็จจริงในรายงาน
// 2026-09-05-rider-wallet-status-survey.md (bkk-frontend-next): แถว LOGISTICS_REVENUE ที่ติด
// rider_id, แถว 150, ป้าย [Backfill Settle], ใบ Pending ก่อน/หลัง 1 ก.ย., งานเคส OID-MTIAI3FH-851
//
// ส่วนที่สาม (ข้ามเมื่อไม่มี checkout ของ bkk-rider-app ข้างๆ) โหลด walletLedger.ts ตัวจริงผ่าน
// loader ของสคริปต์ — พิสูจน์ว่าเส้นทาง "ใช้สูตรของแอป ไม่คัดลอก" ทำงานกับไฟล์จริง
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const SCRIPT = resolve(__dirname, '../../scripts/rider-wallet-audit.cjs');
const source = readFileSync(SCRIPT, 'utf8');

// เมธอดเขียนของ firebase-admin Reference ทุกตัว + สวิตช์เขียนจริงที่สคริปต์พี่น้องใช้
const WRITE_CALL = /\.(set|update|push|remove|transaction|setWithPriority|setPriority)\s*\(/;
const APPLY_FLAG = /--apply/;

describe('rider-wallet-audit.cjs อ่านอย่างเดียวโดยโครงสร้าง', () => {
  it('regex จับเมธอดเขียนได้จริง (injection ของด่านเอง)', () => {
    for (const bad of ["db.ref('x').set(1)", 'ref.update({})', "db.ref('t').push()", 'r.remove()', 'lockRef.transaction(fn)', 'a.set (b)']) {
      expect(WRITE_CALL.test(bad), bad).toBe(true);
    }
    expect(APPLY_FLAG.test("process.argv.includes('--apply')")).toBe(true);
    // สิ่งที่ต้องไม่ถูกจับผิด: การอ่าน และ Set/add ของ JS
    for (const ok of ["db.ref('x').once('value')", 'new Set([1])', 'seen.add(id)', 'list[list.length] = x']) {
      expect(WRITE_CALL.test(ok), ok).toBe(false);
    }
  });

  it('ไฟล์ไม่มีเมธอดเขียน RTDB และไม่มีสวิตช์ --apply', () => {
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => WRITE_CALL.test(line) || APPLY_FLAG.test(line));
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it('ประกาศ READ-ONLY ที่หัวไฟล์ และการอ่าน RTDB ใช้ once(value) เท่านั้น', () => {
    expect(source.split('\n').slice(0, 5).join('\n')).toContain('READ-ONLY');
    const refCalls = source.match(/db\.ref\([^)]*\)\.[a-zA-Z]+\(/g) || [];
    expect(refCalls.length).toBeGreaterThan(0);
    for (const c of refCalls) expect(c, c).toMatch(/\.once\($/);
  });
});

// ─── fixture ────────────────────────────────────────────────────────────────

const OWNER = 'OWNER_UID';
const RIDER = 'RIDER_UID';
const BKK = 7 * 3600 * 1000;
const at = (ymd: string, hhmm = '12:00') => Date.parse(`${ymd}T${hhmm}:00Z`) - BKK;

// ตัวแทนของ walletLedger.ts สำหรับเทส pure — ใช้เฉพาะเมื่อไม่มี checkout จริง (ดูส่วนที่สาม)
// กติกาที่จำลอง: allowlist 8 หมวด, amount ต้องเป็นเลข finite, CREDIT บวก DEBIT ลบ
type TxLike = { type?: unknown; category?: unknown; amount?: unknown };
type WdLike = { status?: unknown; withdraw_amount?: unknown };

const STAND_IN_LEDGER = {
  RIDER_WALLET_CATEGORIES: ['JOB_PAYOUT', 'WITHDRAWAL', 'PENALTY', 'BONUS', 'ADJUSTMENT', 'EXPENSE_REIMBURSEMENT', 'COMPANY_ADVANCE', 'RIDER_DEPOSIT'] as const,
  isRiderWalletTx(t: TxLike | null | undefined) {
    if (!t || (t.type !== 'CREDIT' && t.type !== 'DEBIT')) return false;
    if (!(STAND_IN_LEDGER.RIDER_WALLET_CATEGORIES as readonly string[]).includes(String(t.category ?? ''))) return false;
    if (typeof t.amount !== 'number' && typeof t.amount !== 'string') return false;
    return Number.isFinite(Number(t.amount));
  },
  walletBalance(rows: readonly TxLike[]) {
    return rows.reduce((acc, t) => (t.type === 'CREDIT' ? acc + Number(t.amount) : acc - Number(t.amount)), 0);
  },
  pendingWithdrawalHold(rows: readonly WdLike[]) {
    return rows.reduce((acc, w) => (w.status === 'requested' ? acc + Number(w.withdraw_amount) : acc), 0);
  },
};

const CASE_ID = '-P0QekIHDPBe7phJhabu';

// รูปแถวของ T6/T7 ที่เทสแตะ (สคริปต์เป็น CJS ไม่มี type ให้ import)
interface LedgerRef { id: string; amount: number | null; writer?: string; type?: string }
interface T6Job { job_id: string; rider_fee: number | null; payouts: LedgerRef[]; adjustments: LedgerRef[]; diff: number | null; approved_by: string | null }
interface T1Row { rider_id: string; rows: number; balance: number; balanceLegacy: number; diff: number; hold: number; available: number; perCategory: Record<string, { count: number; sum: number; bad: number }> }
interface Flagged { id: string; flags: string[] }
interface PayoutRef { id: string; rider_id: string }
interface Report {
  meta: { currentAllowlist: string[] };
  t1: T1Row[];
  ridersWithoutLedger: string[];
  t2: Flagged[];
  t3: { windowInverted: boolean; amount150: PayoutRef[]; inWindow: PayoutRef[]; reasonNotCalculated: PayoutRef[]; paidNotEqualFee: PayoutRef[] };
  t4: { withdrawalTotal: number; backfillSettle: PayoutRef[]; batchTagged: number; withdrawalsNode: Record<string, number> };
  t5: { owner: PendingJob[]; rider: PendingJob[]; noFee: PendingJob[]; ownerSum: number; riderSum: number };
  t6: T6Job[];
  caseFound: boolean;
  t7: { verdicts: Verdict[]; decisions: string[] };
}
interface PendingJob { job_id: string; dateField: string; labelMismatch?: boolean }
interface Verdict { rider_id: string; trusted: boolean; reasons: string[] }

const fixture = () => ({
  tx: {
    tx_payout_ok: { rider_id: RIDER, amount: 182, type: 'CREDIT', category: 'JOB_PAYOUT', description: 'ค่าเที่ยวงาน iPhone (OID-MTIAI3FH-851)', timestamp: at('2026-09-02'), ref_job_id: CASE_ID },
    tx_payout_150: { rider_id: OWNER, amount: 150, type: 'CREDIT', category: 'JOB_PAYOUT', description: 'ค่าเที่ยวงาน x (R-1) [Batch]', timestamp: at('2026-08-12'), ref_job_id: 'job_old_150' },
    tx_payout_backfill: { rider_id: OWNER, amount: 200, type: 'CREDIT', category: 'JOB_PAYOUT', description: 'ค่าเที่ยวงาน y (R-2) [Backfill Settle]', timestamp: at('2026-08-20'), ref_job_id: 'job_old_200' },
    tx_logistics_mistag: { rider_id: OWNER, amount: 300, type: 'CREDIT', category: 'LOGISTICS_REVENUE', timestamp: at('2026-08-15'), ref_job_id: 'job_old_150' },
    tx_logistics_sys: { rider_id: 'SYSTEM', amount: 120, type: 'CREDIT', category: 'LOGISTICS_REVENUE', timestamp: at('2026-08-15'), ref_job_id: 'job_old_200' },
    tx_withdraw: { rider_id: RIDER, amount: 100, type: 'DEBIT', category: 'WITHDRAWAL', description: 'ถอนเงินเข้าบัญชี KBANK (1234567890)', timestamp: at('2026-09-03'), ref_job_id: 'wd_1' },
    tx_bad_amount: { rider_id: RIDER, amount: 'abc', type: 'CREDIT', category: 'BONUS', timestamp: at('2026-09-03'), ref_job_id: CASE_ID },
    tx_negative: { rider_id: RIDER, amount: -50, type: 'DEBIT', category: 'PENALTY', timestamp: at('2026-09-03'), ref_job_id: CASE_ID },
    tx_wrong_dir: { rider_id: RIDER, amount: 10, type: 'DEBIT', category: 'BONUS', timestamp: at('2026-09-03'), ref_job_id: CASE_ID },
    tx_no_ref: { rider_id: RIDER, amount: 10, type: 'CREDIT', category: 'BONUS', timestamp: at('2026-09-03') },
    tx_missing_job: { rider_id: RIDER, amount: 10, type: 'CREDIT', category: 'BONUS', timestamp: at('2026-09-03'), ref_job_id: 'job_gone' },
    tx_archived_job: { rider_id: RIDER, amount: 10, type: 'CREDIT', category: 'BONUS', timestamp: at('2026-09-03'), ref_job_id: 'job_archived' },
    tx_no_ts: { rider_id: RIDER, amount: 10, type: 'CREDIT', category: 'BONUS', ref_job_id: CASE_ID },
    tx_no_rider: { amount: 5, type: 'CREDIT', category: 'BONUS', timestamp: at('2026-09-03'), ref_job_id: CASE_ID },
    tx_adjust: { rider_id: RIDER, amount: 25, type: 'DEBIT', category: 'ADJUSTMENT', timestamp: at('2026-09-04'), ref_job_id: CASE_ID },
  },
  jobs: {
    [CASE_ID]: { ref_no: 'OID-MTIAI3FH-851', rider_id: RIDER, status: 'Pending QC', rider_fee: 182, rider_fee_estimate: 182, rider_fee_status: 'Paid', rider_fee_meta: { reason: 'calculated', distance_km: 19.35 }, rider_fee_estimate_meta: { distance_km: 24.37 }, created_at: at('2026-09-01', '13:00'), completed_at: at('2026-09-01', '17:05'), rider_fee_approved_by: 'ADMIN_UID' },
    job_old_150: { ref_no: 'R-1', rider_id: OWNER, status: 'Sold', rider_fee: 150, rider_fee_status: 'Paid', rider_fee_meta: { reason: 'no_coords' }, created_at: at('2026-08-10'), completed_at: at('2026-08-12') },
    job_old_200: { ref_no: 'R-2', rider_id: OWNER, status: 'Sold', rider_fee: 210, rider_fee_status: 'Paid', rider_fee_meta: { reason: 'calculated' }, created_at: at('2026-08-19'), completed_at: at('2026-08-20') },
    job_pending_owner: { ref_no: 'R-3', rider_id: OWNER, status: 'In Stock', rider_fee: 120, rider_fee_status: 'Pending', created_at: at('2026-08-25'), completed_at: at('2026-08-26') },
    job_pending_owner_by_created: { ref_no: 'R-4', rider_id: OWNER, status: 'Cancelled', rider_fee: 80, rider_fee_status: 'Pending', created_at: at('2026-08-30') },
    job_pending_rider: { ref_no: 'R-5', rider_id: RIDER, status: 'Pending QC', rider_fee: 160, rider_fee_status: 'Pending', rider_fee_meta: { reason: 'calculated' }, created_at: at('2026-09-02'), completed_at: at('2026-09-02', '18:00') },
    job_pending_rider_label_mismatch: { ref_no: 'R-6', rider_id: OWNER, status: 'Pending QC', rider_fee: 90, rider_fee_status: 'Pending', created_at: at('2026-09-03'), completed_at: at('2026-09-03') },
    job_pending_no_fee: { ref_no: 'R-7', rider_id: RIDER, status: 'Pending QC', rider_fee_status: 'Pending', receive_method: 'Pickup', created_at: at('2026-09-03'), completed_at: at('2026-09-03') },
    job_rider_era_unpaid: { ref_no: 'R-8', rider_id: RIDER, status: 'Pending QC', rider_fee: 140, rider_fee_status: 'Pending', created_at: at('2026-09-04'), completed_at: at('2026-09-04') },
  },
  riders: { [OWNER]: { name: 'x' }, [RIDER]: { name: 'y' }, GHOST_UID: { name: 'z' } },
  withdrawals: {
    wd_1: { rider_id: RIDER, withdraw_amount: 100, status: 'paid', requested_at: at('2026-09-03') },
    wd_2: { rider_id: RIDER, withdraw_amount: 40, status: 'requested', requested_at: at('2026-09-04') },
    wd_3: { rider_id: RIDER, withdraw_amount: 999, status: 'rejected', requested_at: at('2026-09-04') },
  },
  archivedFound: new Set(['job_archived']),
  ledger: STAND_IN_LEDGER,
  opts: { ownerRider: OWNER, windowEnd: '2026-08-07' },
});

describe('analyze — ตารางจาก fixture ที่สร้างจากเคสจริง', () => {
  const audit = require(SCRIPT);
  const r = audit.analyze(fixture()) as Report;
  const t1 = Object.fromEntries(r.t1.map((x) => [x.rider_id, x]));

  it('T1: balance มาจากสูตรที่ส่งเข้ามา, LOGISTICS_REVENUE ไม่เข้ากระเป๋า, จองค้างหักออก', () => {
    // RIDER: 182 −100 (withdraw) −10 (wrong-dir bonus DEBIT) +10 +10 +10 +10 (bonus rows) −25 (adjust)
    //   = 87 ; แถว abc และ −50: abc ถูกข้าม ส่วน −50 เป็น DEBIT ของเลขลบ = +50 → 137
    expect(t1[RIDER].balance).toBe(137);
    expect(t1[RIDER].hold).toBe(40);
    expect(t1[RIDER].available).toBe(97);
    // allowlist 4 หมวดเดิม: ไม่มี ADJUSTMENT → 137 + 25 = 162 → ส่วนต่าง −25
    expect(t1[RIDER].balanceLegacy).toBe(162);
    expect(t1[RIDER].diff).toBe(-25);
    // OWNER: 150 + 200 เท่านั้น — LOGISTICS_REVENUE 300 ไม่นับ
    expect(t1[OWNER].balance).toBe(350);
    expect(t1[OWNER].perCategory['LOGISTICS_REVENUE/CREDIT'].sum).toBe(300);
    expect(t1.SYSTEM.balance).toBe(0);
    expect(t1['(none)'].rows).toBe(1);
    expect(r.ridersWithoutLedger).toEqual(['GHOST_UID']);
  });

  it('T2: จับแถวผิดปกติทุกชนิดพร้อม key', () => {
    const flagsOf = (id: string) => (r.t2.find((a) => a.id === id) || { flags: [] }).flags;
    expect(flagsOf('tx_bad_amount')).toContain('amount_not_finite');
    expect(flagsOf('tx_negative')).toContain('negative_amount');
    expect(flagsOf('tx_wrong_dir')).toContain('type_DEBIT_but_category_expects_CREDIT');
    expect(flagsOf('tx_no_ref')).toContain('no_ref_job_id');
    expect(flagsOf('tx_missing_job')).toContain('ref_job_missing');
    expect(flagsOf('tx_archived_job')).toContain('ref_job_archived');
    expect(flagsOf('tx_no_ts')).toContain('timestamp_missing');
    expect(flagsOf('tx_payout_ok')).toEqual([]);
    expect(flagsOf('tx_withdraw')).toEqual([]); // ref_job_id ของแถวถอน = id ใน /withdrawals
    expect(flagsOf('tx_logistics_mistag')).toEqual([]); // ผิดเชิงหมวดแต่รูปแถวถูก — T1 เป็นคนโชว์
  });

  it('T3: แถว 150, หน้าต่างกลับด้าน, fallback reason, ยอดไม่ตรง rider_fee', () => {
    expect(r.t3.amount150.map((x) => x.id)).toEqual(['tx_payout_150']);
    expect(r.t3.windowInverted).toBe(true);
    expect(r.t3.inWindow).toEqual([]);
    expect(r.t3.reasonNotCalculated.map((x) => x.id)).toEqual(['tx_payout_150']);
    expect(r.t3.paidNotEqualFee.map((x) => x.id)).toEqual(['tx_payout_backfill']); // 200 vs 210
    // หน้าต่างที่ปลายอยู่หลังต้น ต้องเจอแถวในช่วง
    const r2 = audit.analyze({ ...fixture(), opts: { ownerRider: OWNER, windowEnd: '2026-08-31' } }) as Report;
    expect(r2.t3.windowInverted).toBe(false);
    expect(r2.t3.inWindow.map((x) => x.id).sort()).toEqual(['tx_payout_150', 'tx_payout_backfill']);
  });

  it('T4: นับ WITHDRAWAL และป้าย [Backfill Settle]', () => {
    expect(r.t4.withdrawalTotal).toBe(1);
    expect(r.t4.backfillSettle.map((x) => x.id)).toEqual(['tx_payout_backfill']);
    expect(r.t4.batchTagged).toBe(1);
    expect(r.t4.withdrawalsNode).toEqual({ total: 3, requested: 1, paid: 1, rejected: 1, other: 0 });
  });

  it('T5: แยก OWNER/RIDER ด้วย completed_at ก่อน created_at, ป้ายไม่ตรง, ใบไม่มี fee', () => {
    const ids = (list: PendingJob[]) => list.map((j) => j.job_id);
    const byJob = (list: PendingJob[], id: string) => list.find((j) => j.job_id === id) as PendingJob;
    expect(ids(r.t5.owner)).toEqual(['job_pending_owner', 'job_pending_owner_by_created']);
    expect(byJob(r.t5.owner, 'job_pending_owner_by_created').dateField).toBe('created_at');
    expect(r.t5.ownerSum).toBe(200);
    expect(ids(r.t5.rider)).toEqual(['job_pending_rider', 'job_pending_rider_label_mismatch', 'job_rider_era_unpaid']);
    expect(byJob(r.t5.rider, 'job_pending_rider_label_mismatch').labelMismatch).toBe(true);
    expect(r.t5.riderSum).toBe(390);
    expect(ids(r.t5.noFee)).toEqual(['job_pending_no_fee']);
  });

  it('T6: งานเคส + งานยุคไรเดอร์ พร้อมแถว ledger ที่ชี้มาและส่วนต่าง', () => {
    const byId = Object.fromEntries(r.t6.map((j: T6Job) => [j.job_id, j])) as Record<string, T6Job | undefined>;
    expect(r.caseFound).toBe(true);
    const c = byId[CASE_ID] as T6Job;
    expect(c.rider_fee).toBe(182);
    expect(c.payouts.map((p) => p.amount)).toEqual([182]);
    expect(c.payouts[0].writer).toContain('UI');
    expect(c.adjustments.map((a) => a.amount)).toEqual([25]);
    expect(c.diff).toBe(-25); // 182 − 25 − 182
    expect(c.approved_by).toBe('ADMIN_UID');
    // งานของ OWNER ในยุคไรเดอร์ไม่เข้า T6 แม้เกิดหลัง 1 ก.ย.
    expect(byId.job_pending_rider_label_mismatch).toBeUndefined();
    expect(Object.keys(byId).sort()).toEqual([CASE_ID, 'job_pending_no_fee', 'job_pending_rider', 'job_rider_era_unpaid'].sort());
  });

  it('T7: คำตัดสินต่อ rider และรายการที่ต้องตัดสินใจ — ไม่มีข้อเสนอทางแก้', () => {
    const v = Object.fromEntries(r.t7.verdicts.map((x: Verdict) => [x.rider_id, x])) as Record<string, Verdict | undefined>;
    expect(v[RIDER]?.trusted).toBe(false);
    expect(v[OWNER]?.trusted).toBe(false);
    expect(v.SYSTEM).toBeUndefined();
    expect(r.t7.decisions.some((d: string) => d.includes('[Backfill Settle]'))).toBe(true);
    expect(r.t7.decisions.some((d: string) => d.includes('OWNER'))).toBe(true);
  });

  it('render: ไม่มีชื่อ/เลขบัญชี/description ดิบหลุดไปในรายงาน', () => {
    const md: string = audit.renderMarkdown(r, { ledgerSource: { file: 'fixture', rev: '-' }, ranAt: '2026-09-05T00:00:00.000Z' });
    expect(md).toContain('## T1');
    expect(md).toContain('## T7');
    expect(md).not.toContain('1234567890');
    expect(md).not.toContain('KBANK');
    expect(md).not.toMatch(/\| x \||\| y \|/);
    expect(md).toContain('settle-pending-rider-fees.cjs เคยถูก apply'); // fixture มีแถว [Backfill Settle] 1 แถว
    expect(md).not.toContain('ไม่เคยถูก apply');
  });
});

describe('loader — สูตรของแอปไรเดอร์ตัวจริง (ข้ามเมื่อไม่มี checkout)', () => {
  const audit = require(SCRIPT);
  const dir = audit.resolveRiderAppDir(process.env.BKK_RIDER_APP_DIR || null);
  const hasCheckout = Boolean(dir && existsSync(resolve(dir, 'src/utils/walletLedger.ts')));
  it.skipIf(!hasCheckout)('transpile walletLedger.ts แล้วได้ฟังก์ชันจริงที่ให้ผลตรงกับกติกาที่ประกาศ', () => {
    const { ledger, source: src } = audit.loadWalletLedger(dir);
    expect(src.file).toMatch(/walletLedger\.ts$/);
    expect(Array.from(ledger.RIDER_WALLET_CATEGORIES)).toContain('JOB_PAYOUT');
    expect(ledger.isRiderWalletTx({ type: 'CREDIT', category: 'LOGISTICS_REVENUE', amount: 1 })).toBe(false);
    expect(ledger.isRiderWalletTx({ type: 'CREDIT', category: 'JOB_PAYOUT', amount: null })).toBe(false);
    expect(ledger.walletBalance([{ type: 'CREDIT', amount: 10 }, { type: 'DEBIT', amount: 4 }])).toBe(6);
    const r = audit.analyze({ ...fixture(), ledger }) as Report;
    expect(r.meta.currentAllowlist.length).toBeGreaterThanOrEqual(4);
  });
});
