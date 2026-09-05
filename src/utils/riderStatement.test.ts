// statement + reconcile กระเป๋าไรเดอร์ — fixture 6 แถวที่มีครบ CREDIT/DEBIT/หมวดนอก
// allowlist/amount เสีย และ reconcile ทั้งสองทิศ (งาน Paid ไม่มี JOB_PAYOUT · JOB_PAYOUT
// ที่งานไม่ Paid/ยอดไม่ตรง/งานหาย)
//
// ยอดคงเหลือสะสมในเทสนี้ถูกเทียบกับ walletBalance ของ mirror ตรงๆ ด้วย (ไม่ใช่เลขที่พิมพ์
// ไว้อย่างเดียว) — ถ้าวันหนึ่งสูตรของแอปเปลี่ยน เลขที่พิมพ์ไว้จะแดง แต่ข้อ "ยอดท้ายตาราง =
// walletBalance" ต้องเขียวตลอด นั่นคือสัญญาของหน้านี้
//
// ตาราง injection (วัดจริง 5 ก.ย. 2569 หลัง commit checkpoint · รันสามไฟล์เทสของหน้านี้พร้อมกัน):
//   1. running = reduce บวก/ลบเอง (ไม่ผ่าน walletBalance)            → **เขียวทั้ง 44** เพราะสูตรเท่ากัน
//      ทางคณิตศาสตร์ — ตัวเลขแยกไม่ได้โดยนิยาม จึงเป็นด่านเชิงโครงสร้างใน riderStatementReadOnly
//      ("running/balance ถูก assign จาก walletBalance เท่านั้น") ซึ่งแดง 1 หลังเพิ่ม
//   2. นับแถวนอก allowlist เข้ายอด                                    → แดง 9
//   3. ตีแถว amount 'abc' เป็น 0 แล้วนับ                             → แดง 11
//   4. (i) นับ Waived เป็น Paid                                       → แดง 3
//   5. (ii) ไม่เช็ค amount ≠ rider_fee                                → แดง 1
//   6. WITHDRAWAL แสดง description ดิบ                                → แดง 2 (เลขบัญชีหลุดทั้ง JSON และ CSV)
//   7. mirror: ถอด RIDER_DEPOSIT ออกจาก allowlist                     → แดง 5 (parity + ตัวเลขจริง)
//   8. mirror: hold นับคำขอ paid ด้วย                                  → แดง 6
//   9. page: เติม update(ref(db,...))                                 → แดง 1 (read-only)
//  10. page: import logTransaction                                     → แดง 1 (read-only)
//  11. view: อ่าน .description มาแสดง                                  → แดง 1 (read-only)
import { describe, it, expect } from 'vitest';
import { buildStatement, defaultRange, statementCsv, DEFAULT_RANGE_DAYS } from './riderStatement';
import { isRiderWalletTx, walletBalance } from './riderWalletLedger';

const R = 'RIDER_A';
const OTHER = 'RIDER_B';
const T0 = Date.parse('2026-08-01T05:00:00Z');
const at = (days: number, h = 0) => T0 + days * 86_400_000 + h * 3_600_000;

const JOBS = [
  // งานที่มี JOB_PAYOUT ตรงยอด — ปกติ
  { id: 'jobA', ref_no: 'OID-A', model: 'iPhone 15', rider_id: R, rider_fee: 300, rider_fee_status: 'Paid', settled_at: at(1), rider_fee_approved_by: 'Somchai', rider_fee_meta: { reason: 'calculated' } },
  // งาน Paid ที่ไม่มี JOB_PAYOUT เลย → (i)
  { id: 'jobB', ref_no: 'OID-B', rider_id: R, rider_fee: 150, rider_fee_status: 'Paid', settled_at: at(2) },
  // งาน Waived — ไม่ใช่ Paid ทั้งสองฝั่ง: ไม่เข้า (i) และ JOB_PAYOUT ที่ชี้มา (ถ้ามี) เข้า (ii)
  { id: 'jobW', ref_no: 'OID-W', rider_id: R, rider_fee: 100, rider_fee_status: 'Waived' },
  // งาน Pending มี JOB_PAYOUT ชี้มา (amount ไม่ตรงด้วย) → (ii) สองเหตุผล
  { id: 'jobC', ref_no: 'OID-C', rider_id: R, rider_fee: 120, rider_fee_status: 'Pending' },
  // งานที่ไรเดอร์ทิ้งแล้วถูกยกเลิก — rider_id ถูกล้าง แต่ cancelled_by ชี้มา → นับเป็นของ R
  { id: 'jobD', ref_no: 'OID-D', rider_id: null, cancelled_by: `rider:${R}`, rider_fee: 80, rider_fee_status: 'Paid' },
  // งานของคนอื่น Paid → ต้องไม่โผล่ใน (i) ของ R
  { id: 'jobX', ref_no: 'OID-X', rider_id: OTHER, rider_fee: 999, rider_fee_status: 'Paid' },
];

const WITHDRAWALS = [
  { id: 'wd1', rider_id: R, status: 'paid', withdraw_amount: 100, paid_by: 'Finance A', requested_at: at(3), paid_at: at(3, 2), bank_account: '1234567890' },
  { id: 'wd2', rider_id: R, status: 'requested', withdraw_amount: 50, requested_at: at(6) },
  { id: 'wd3', rider_id: OTHER, status: 'requested', withdraw_amount: 777 },
];

// 6 แถวหลัก (ของ R) + แถวของคนอื่น 1 แถวที่ต้องถูกกรองออก
const TX = [
  { id: 't1', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 300, timestamp: at(1), ref_job_id: 'jobA', description: 'ค่าเที่ยวงาน iPhone 15 (OID-A)' },
  { id: 't2', rider_id: R, type: 'DEBIT', category: 'WITHDRAWAL', amount: 100, timestamp: at(3, 2), ref_job_id: 'wd1', description: 'ถอนเงินเข้าบัญชี KBANK (1234567890)' },
  { id: 't3', rider_id: R, type: 'CREDIT', category: 'LOGISTICS_REVENUE', amount: 500, timestamp: at(3, 3), ref_job_id: 'jobA', description: 'ค่าบริการรับเครื่อง' },
  { id: 't4', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 'abc', timestamp: at(4), ref_job_id: 'jobC', description: 'ค่าเที่ยวงาน (OID-C) [Batch]' },
  { id: 't5', rider_id: R, type: 'DEBIT', category: 'ADJUSTMENT', amount: 20, timestamp: at(5), ref_job_id: 'jobA' },
  { id: 't6', rider_id: R, type: 'CREDIT', category: 'EXPENSE_REIMBURSEMENT', amount: '65', timestamp: at(7), rider_expense_id: 'exp9' },
  { id: 'tx', rider_id: OTHER, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 999, timestamp: at(1), ref_job_id: 'jobX' },
];

const build = (extra: Partial<Parameters<typeof buildStatement>[0]> = {}) =>
  buildStatement({ riderId: R, transactions: TX, jobs: JOBS, withdrawals: WITHDRAWALS, ...extra });

describe('statement — เรียงเวลา, running balance ผ่าน walletBalance ทีละแถว', () => {
  const s = build();

  it('มีเฉพาะแถวของไรเดอร์คนนี้ เรียงเก่า→ใหม่', () => {
    expect(s.rows.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
  });

  it('running balance: 300 → 200 → (ไม่นับ) → (ไม่นับ) → 180 → 245', () => {
    expect(s.rows.map((r) => r.running)).toEqual([300, 200, null, null, 180, 245]);
  });

  it('ยอดท้ายตาราง = walletBalance ของแถวที่ isRiderWalletTx รับ (สัญญาของหน้านี้)', () => {
    const mine = TX.filter((t) => t.rider_id === R && isRiderWalletTx(t));
    expect(s.balance).toBe(walletBalance(mine));
    const lastCounted = [...s.rows].reverse().find((r) => r.counted);
    expect(lastCounted?.running).toBe(s.balance);
  });

  it('แถวนอก allowlist: ไม่นับ มีป้าย และไม่มี warning ปลอม', () => {
    const r = s.rows[2];
    expect(r.counted).toBe(false);
    expect(r.running).toBeNull();
    expect(r.detail).toContain('ไม่นับเข้ากระเป๋า');
    expect(r.cr).toBe(500);
    expect(r.warnings).toEqual([]);
  });

  it('แถว amount เสีย: ไม่นับ ไม่พังหน้า มีป้าย amount_not_finite และไม่ตีเป็น 0', () => {
    const r = s.rows[3];
    expect(r.counted).toBe(false);
    expect(r.cr).toBeNull();
    expect(r.warnings).toContain('amount_not_finite');
    expect(r.source).toContain('ปุ่ม batch รุ่นเก่า');
  });

  it('Dr/Cr ตามทิศ: DEBIT ลง Dr, CREDIT ลง Cr, string ตัวเลขนับได้', () => {
    expect(s.rows[1].dr).toBe(100);
    expect(s.rows[1].cr).toBeNull();
    expect(s.rows[5].cr).toBe(65);
    expect(s.rows[5].counted).toBe(true);
  });

  it('WITHDRAWAL แสดง "ถอนเงิน · <key>" เท่านั้น — เลขบัญชีใน description ห้ามหลุด', () => {
    const r = s.rows[1];
    expect(r.detail).toBe('ถอนเงิน · wd1');
    expect(r.ref).toEqual({ kind: 'withdrawal', id: 'wd1', refNo: 'wd1' });
    expect(r.source).toContain('โอนโดย Finance A');
    expect(JSON.stringify(s)).not.toContain('1234567890');
    expect(statementCsv(s)).not.toContain('1234567890');
  });

  it('JOB_PAYOUT: อ้างอิง ref_no ของงาน ลิงก์ได้ · ผู้อนุมัติดึงจากงาน', () => {
    const r = s.rows[0];
    expect(r.ref).toEqual({ kind: 'job', id: 'jobA', refNo: 'OID-A' });
    expect(r.detail).toBe('ค่ารอบงาน · iPhone 15 · OID-A');
    expect(r.source).toBe('อนุมัติโดย Somchai · อนุมัติจาก UI');
  });

  it('ผู้อนุมัติที่เก็บเป็น staff id ถูกแปลงเป็นชื่อเมื่อมี map · ไม่มี = id ดิบ (ไม่ซ่อน)', () => {
    const jobs = JOBS.map((j) => (j.id === 'jobA' ? { ...j, rider_fee_approved_by: '-On_staffPushId' } : j));
    const raw = build({ jobs });
    expect(raw.rows[0].source).toBe('อนุมัติโดย -On_staffPushId · อนุมัติจาก UI');
    const named = build({ jobs, staffNames: { '-On_staffPushId': 'สมชาย' } });
    expect(named.rows[0].source).toBe('อนุมัติโดย สมชาย · อนุมัติจาก UI');
  });

  it('EXPENSE_REIMBURSEMENT อ้างใบเบิก ไม่ใช่งาน', () => {
    expect(s.rows[5].ref).toEqual({ kind: 'expense', id: 'exp9', refNo: 'exp9' });
  });

  it('ยอดจอง: บรรทัดแยก เฉพาะ requested ของคนนี้ · C = A − จอง', () => {
    expect(s.hold).toBe(50);
    expect(s.requested).toEqual([{ id: 'wd2', amount: 50, requestedAt: at(6) }]);
    expect(s.available).toBe(195);
  });
});

describe('ช่วงวันที่ — ตัวกรองแสดงผล ไม่ใช่ตัวเลขบัญชี', () => {
  it('ยอดยกมา = running ก่อนช่วง · แถวนอกช่วงไม่แสดง · ยอดคงเหลือยังเป็นทั้งหมด', () => {
    const s = build({ from: at(4), to: at(8) });
    expect(s.opening).toBe(200);
    expect(s.visible.map((r) => r.id)).toEqual(['t4', 't5', 't6']);
    expect(s.balance).toBe(245);
  });

  it('แถวไม่มีเวลา: อยู่ท้ายสุด แสดงเสมอ ติดป้าย และยังนับเข้ายอด', () => {
    const s = build({
      transactions: [...TX, { id: 't0', rider_id: R, type: 'CREDIT', category: 'BONUS', amount: 10 }],
      from: at(4),
      to: at(8),
    });
    const last = s.rows[s.rows.length - 1];
    expect(last.id).toBe('t0');
    expect(last.warnings).toContain('timestamp_missing');
    expect(last.inRange).toBe(true);
    expect(s.balance).toBe(255);
  });

  it('defaultRange = 90 วันย้อนหลังถึงสิ้นวันนี้', () => {
    const now = Date.parse('2026-09-05T10:00:00');
    const r = defaultRange(now);
    expect(r.to).toBeGreaterThan(now);
    expect(Math.round((r.to - r.from) / 86_400_000)).toBe(DEFAULT_RANGE_DAYS);
  });
});

describe('reconcile — A ledger · B จากงาน · C ถอนได้ · ส่วนต่างสองทิศ', () => {
  const s = build();
  const rc = s.reconcile;

  it('A = walletBalance · C = A − จอง', () => {
    expect(rc.ledger).toBe(245);
    expect(rc.available).toBe(195);
    expect(rc.hold).toBe(50);
  });

  it('B: Σ rider_fee งาน Paid ของคนนี้ (รวมใบที่ cancelled_by ชี้มา, ไม่รวม Waived/Pending/คนอื่น) − ถอน ± adjustment ± หมวดอื่น', () => {
    expect(rc.fromJobs.paidJobCount).toBe(3); // jobA jobB jobD
    expect(rc.fromJobs.paidFees).toBe(530);
    expect(rc.fromJobs.withdrawals).toBe(100);
    expect(rc.fromJobs.adjustments).toBe(-20);
    expect(rc.fromJobs.others).toEqual([{ category: 'EXPENSE_REIMBURSEMENT', label: 'คืนเงินสำรองจ่าย', amount: 65 }]);
    expect(rc.fromJobs.total).toBe(475);
    expect(rc.diff).toBe(-230); // A 245 − B 475 = −(150 + 80) = งาน Paid สองใบที่ไม่มี JOB_PAYOUT
  });

  it('(i) งาน Paid ที่ไม่มี JOB_PAYOUT — jobB, jobD · ไม่มี jobW (Waived) ไม่มี jobX (คนอื่น)', () => {
    expect(rc.paidJobsWithoutPayout.map((j) => j.jobId).sort()).toEqual(['jobB', 'jobD']);
    expect(rc.paidJobsWithoutPayout.find((j) => j.jobId === 'jobB')).toEqual({ jobId: 'jobB', refNo: 'OID-B', fee: 150, settledAt: at(2) });
  });

  it('(ii) JOB_PAYOUT ที่งานไม่ใช่ Paid / ยอดไม่ตรง / งานหาย / ซ้ำ', () => {
    const s2 = build({
      transactions: [
        ...TX,
        { id: 't7', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 100, timestamp: at(8), ref_job_id: 'jobW' },
        { id: 't8', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 120, timestamp: at(8), ref_job_id: 'jobC' },
        { id: 't9', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 300, timestamp: at(9), ref_job_id: 'jobA' },
        { id: 't10', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 90, timestamp: at(9), ref_job_id: 'jobGone' },
        { id: 't11', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 999, timestamp: at(9), ref_job_id: 'jobX' },
        { id: 't12', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 250, timestamp: at(9), ref_job_id: 'jobA' },
      ],
      archived: { jobGone: 'OID-GONE' },
    });
    const by = Object.fromEntries(s2.reconcile.payoutsNotMatchingJob.map((m) => [m.txId, m]));
    expect(by.t7.reasons).toEqual(['fee_status']); // Waived ≠ Paid
    expect(by.t8.reasons).toEqual(['fee_status']); // Pending, ยอดตรง
    expect(by.t9.reasons).toEqual(['duplicate_payout']);
    expect(by.t10.reasons).toEqual(['job_archived']);
    expect(by.t10.refNo).toBe('OID-GONE');
    expect(by.t11.reasons).toEqual(['other_rider']);
    expect(by.t12.reasons).toEqual(['amount_mismatch', 'duplicate_payout']);
    expect(by.t1).toBeUndefined(); // แถวปกติไม่โผล่
    // แถว t4 (amount 'abc') ไม่ถูกนับ จึงไม่อยู่ใน (ii) — มันอยู่ในตารางพร้อมป้ายแทน
    expect(by.t4).toBeUndefined();
    // และ jobC ยังไม่โผล่ใน (i) เพราะไม่ใช่ Paid
    expect(s2.reconcile.paidJobsWithoutPayout.map((j) => j.jobId)).not.toContain('jobC');
  });

  it('A = B เมื่อทุกงาน Paid มี JOB_PAYOUT ตรงยอด', () => {
    const s3 = build({
      transactions: [
        ...TX,
        { id: 't7', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 150, timestamp: at(2), ref_job_id: 'jobB' },
        { id: 't8', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 80, timestamp: at(2), ref_job_id: 'jobD' },
      ],
    });
    expect(s3.reconcile.diff).toBe(0);
    expect(s3.reconcile.paidJobsWithoutPayout).toEqual([]);
    expect(s3.reconcile.payoutsNotMatchingJob).toEqual([]);
  });

  it('Σ /withdrawals paid เทียบ Σ WITHDRAWAL ใน ledger', () => {
    expect(rc.withdrawalsNodePaid).toBe(100);
    expect(rc.withdrawalsNodePaid).toBe(rc.fromJobs.withdrawals);
  });

  it('ref ที่หาไม่พบถูกส่งออกให้หน้าจอไปเช็ค jobs_archived', () => {
    const s4 = build({ transactions: [...TX, { id: 't7', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 1, timestamp: at(8), ref_job_id: 'jobGone' }] });
    expect(s4.unresolvedJobIds).toEqual(['jobGone']);
    expect(s4.rows.find((r) => r.id === 't7')?.warnings).toContain('ref_missing');
    // เช็คแล้วไม่พบ (null) = ยัง "ไม่พบ" แต่ไม่ถูกส่งไปเช็คซ้ำ
    const s5 = build({ transactions: s4.rows.length ? [...TX, { id: 't7', rider_id: R, type: 'CREDIT', category: 'JOB_PAYOUT', amount: 1, timestamp: at(8), ref_job_id: 'jobGone' }] : TX, archived: { jobGone: null } });
    expect(s5.unresolvedJobIds).toEqual([]);
    expect(s5.rows.find((r) => r.id === 't7')?.ref.kind).toBe('job_missing');
    expect(s5.reconcile.payoutsNotMatchingJob.find((m) => m.txId === 't7')?.reasons).toEqual(['job_missing']);
  });
});

describe('CSV', () => {
  it('มีหัวตาราง ยอดยกมา แถวที่แสดง และยอดท้าย · escape เครื่องหมายคำพูด', () => {
    const s = build({ from: at(4), to: at(8) });
    const csv = statementCsv(s);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('คงเหลือสะสม');
    expect(lines[1]).toContain('ยอดยกมา');
    expect(lines[1]).toContain('"200"');
    expect(lines.length).toBe(1 + 1 + 3 + 3);
    expect(lines[lines.length - 1]).toContain('ยอดถอนได้');
    expect(lines[lines.length - 1]).toContain('"195"');
  });
});
