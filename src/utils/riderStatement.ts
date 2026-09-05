// src/utils/riderStatement.ts — ประกอบ statement (passbook) และ reconcile กระเป๋าไรเดอร์ (pure)
//
// อ่านอย่างเดียวโดยโครงสร้าง: ไฟล์นี้ไม่ import firebase และไม่มีเมธอดเขียนใดๆ
// (ด่านคือ `riderStatementReadOnly.test.ts` ซึ่ง grep ไฟล์นี้กับหน้าที่เรียกมัน)
//
// กติกาที่ไฟล์นี้ **ไม่ได้เป็นเจ้าของ** และห้ามเขียนซ้ำ: อะไรนับเข้ากระเป๋า
// (`isRiderWalletTx`) · ยอดคงเหลือ (`walletBalance`) · ยอดจอง (`pendingWithdrawalHold`)
// ทั้งสามมาจาก `riderWalletLedger.ts` ซึ่งเป็น MIRROR ของไฟล์ที่จอไรเดอร์ใช้ —
// ยอดคงเหลือสะสมท้ายตารางจึงเท่ากับแอปไรเดอร์โดยนิยาม (ป้อนแถวสะสมทีละแถวเข้า
// `walletBalance` ตัวเดียวกัน ไม่ใช่บวกลบเอง)
//
// สิ่งที่ไฟล์นี้เป็นเจ้าของ: การเรียงเวลา · การแปลงแถว ledger เป็นบรรทัดที่อ่านออก
// (ห้ามใช้ description ดิบ — แถวถอนเงินมีเลขบัญชีอยู่ในนั้น) · ป้ายข้อมูลเสีย ·
// กล่อง reconcile สามยอด (A ledger · B ประกอบจากงาน · C ถอนได้) และรายการส่วนต่างสองทิศ
//
// "งาน Paid" ในกล่อง reconcile = `rider_fee_status === 'Paid'` (สถานะจ่ายค่ารอบ ที่
// `buildRiderFeeApproval` ประทับคู่กับแถว JOB_PAYOUT ใน multi-path เดียว) ไม่ใช่ `status`
// ของงาน. ค่าอื่นทั้งหมด (Pending, Waived, ไม่มี) = ไม่ใช่ Paid ทั้งสองฝั่งของ reconcile
import { isRiderWalletTx, pendingWithdrawalHold, walletBalance, walletCategoryLabel } from './riderWalletLedger';

/** แถวจาก RTDB ตามที่มันเป็นจริง — ทุกฟิลด์ต้องถูกคัดชนิดก่อนใช้ ไม่มีสัญญาว่ารูปถูก */
export interface Loose {
  [key: string]: unknown;
  id?: unknown;
  type?: unknown;
  category?: unknown;
  amount?: unknown;
  rider_id?: unknown;
  status?: unknown;
  withdraw_amount?: unknown;
}
const rec = (v: unknown): Loose | null => (v && typeof v === 'object' ? (v as Loose) : null);

export type RefKind = 'job' | 'job_archived' | 'job_missing' | 'withdrawal' | 'expense' | 'none';

export interface StatementRef {
  kind: RefKind;
  id: string | null;
  /** ref_no ของงาน / key ของคำขอถอน / เลขใบเบิก — สิ่งที่คนอ่านใช้ตามรอย */
  refNo: string | null;
}

export type StatementWarning =
  | 'amount_not_finite'
  | 'negative_amount'
  | 'bad_type'
  | 'type_mismatch'
  | 'no_ref'
  | 'ref_missing'
  | 'ref_archived'
  | 'timestamp_missing'
  | 'relabeled'
  | 'other_rider';

export const WARNING_LABEL_TH: Record<StatementWarning, string> = {
  amount_not_finite: 'จำนวนเงินไม่ใช่ตัวเลข — ไม่นับเข้ายอด',
  negative_amount: 'จำนวนเงินติดลบ',
  bad_type: 'type ไม่ใช่ CREDIT/DEBIT — ไม่นับเข้ายอด',
  type_mismatch: 'ทิศทาง (type) ไม่ตรงกับหมวด',
  no_ref: 'ไม่มีการอ้างอิงงาน/คำขอ',
  ref_missing: 'ไม่พบงานที่อ้างถึงใน /jobs',
  ref_archived: 'งานที่อ้างถึงถูก archive แล้ว',
  timestamp_missing: 'ไม่มีเวลา — แสดงไว้ท้ายตาราง',
  relabeled: 'ป้ายหมวดถูกแก้ย้อนหลัง',
  other_rider: 'งานที่อ้างถึงเป็นของไรเดอร์คนอื่น',
};

export interface StatementRow {
  id: string;
  at: number | null;
  category: string;
  type: string;
  label: string;
  detail: string;
  ref: StatementRef;
  /** DEBIT = เงินออกจากกระเป๋า */
  dr: number | null;
  /** CREDIT = เงินเข้ากระเป๋า */
  cr: number | null;
  /** ผ่าน isRiderWalletTx = นับเข้ายอดของแอปไรเดอร์ */
  counted: boolean;
  /** ยอดคงเหลือสะสมหลังแถวนี้ — null เมื่อแถวไม่ถูกนับ */
  running: number | null;
  source: string | null;
  warnings: StatementWarning[];
  inRange: boolean;
}

export interface PaidJobWithoutPayout {
  jobId: string;
  refNo: string | null;
  fee: number | null;
  settledAt: number | null;
}

export type PayoutMismatchReason = 'job_missing' | 'job_archived' | 'other_rider' | 'fee_status' | 'amount_mismatch' | 'duplicate_payout';

export interface PayoutMismatch {
  txId: string;
  jobId: string | null;
  refNo: string | null;
  amount: number;
  fee: number | null;
  feeStatus: string | null;
  reasons: PayoutMismatchReason[];
}

export const MISMATCH_LABEL_TH: Record<PayoutMismatchReason, string> = {
  job_missing: 'ไม่พบงานใน /jobs',
  job_archived: 'งานถูก archive',
  other_rider: 'งานเป็นของไรเดอร์คนอื่น',
  fee_status: 'งานไม่ได้อยู่ในสถานะ Paid',
  amount_mismatch: 'ยอดไม่เท่า rider_fee บนงาน',
  duplicate_payout: 'งานเดียวมี JOB_PAYOUT มากกว่าหนึ่งแถว',
};

export interface Reconcile {
  /** A — walletBalance ของแถวที่นับ (ทั้งช่วงเวลา ไม่จำกัดตามตัวกรอง) */
  ledger: number;
  /** B — ประกอบจากงาน Paid + หมวดอื่นใน ledger */
  fromJobs: {
    paidFees: number;
    paidJobCount: number;
    withdrawals: number;
    adjustments: number;
    others: { category: string; label: string; amount: number }[];
    total: number;
  };
  /** C — A − ยอดจองค้าง */
  available: number;
  hold: number;
  /** A − B */
  diff: number;
  paidJobsWithoutPayout: PaidJobWithoutPayout[];
  payoutsNotMatchingJob: PayoutMismatch[];
  /** Σ withdraw_amount ของ /withdrawals status paid — เทียบกับ Σ WITHDRAWAL ใน ledger */
  withdrawalsNodePaid: number;
}

export interface Statement {
  riderId: string;
  rows: StatementRow[];
  visible: StatementRow[];
  /** ยอดยกมาก่อนช่วงที่เลือก */
  opening: number;
  balance: number;
  hold: number;
  requested: { id: string; amount: number; requestedAt: number | null }[];
  available: number;
  reconcile: Reconcile;
  /** id งานที่อ้างถึงแต่ไม่พบใน /jobs และไม่ใช่ key ของ /withdrawals — หน้าจอเอาไปเช็ค jobs_archived */
  unresolvedJobIds: string[];
}

export interface StatementInput {
  riderId: string;
  transactions: readonly Loose[];
  jobs: readonly Loose[];
  withdrawals: readonly Loose[];
  /** ผลเช็ค jobs_archived/{id}/ref_no — key = job id ที่เช็คแล้ว: string = พบใน archive (ref_no),
   *  null = เช็คแล้วไม่พบทั้งสองที่ (ยังเป็น "ไม่พบ" แต่ไม่ต้องเช็คซ้ำ) · ไม่มี key = ยังไม่ได้เช็ค */
  archived?: Readonly<Record<string, string | null>>;
  from?: number | null;
  to?: number | null;
  /** ชื่อพนักงานตาม staff id (และ uid) — `rider_fee_approved_by` บนงานเก็บเป็น id ไม่ใช่ชื่อ
   *  ไม่มี key = แสดง id ดิบ (ไม่ซ่อน เพราะ id ยังตามรอยได้) */
  staffNames?: Readonly<Record<string, string>>;
}

/** number|string ที่แปลงเป็นเลข finite ได้ → number, อย่างอื่น → null (`Number(null) === 0` คือกับดัก) */
export const finiteOrNull = (v: unknown): number | null => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** ทิศที่แต่ละหมวดควรเป็น ตามจุดเขียนจริง — 'ANY' = เขียนได้ทั้งสองทิศโดยดีไซน์ */
const EXPECTED_TYPE: Record<string, 'CREDIT' | 'DEBIT' | 'ANY'> = {
  JOB_PAYOUT: 'CREDIT',
  BONUS: 'CREDIT',
  EXPENSE_REIMBURSEMENT: 'CREDIT',
  COMPANY_ADVANCE: 'CREDIT',
  RIDER_DEPOSIT: 'CREDIT',
  WITHDRAWAL: 'DEBIT',
  PENALTY: 'DEBIT',
  ADJUSTMENT: 'ANY',
};

const REF_REQUIRED = new Set(['JOB_PAYOUT', 'WITHDRAWAL', 'ADJUSTMENT']);

/** งานใบนี้เป็นของไรเดอร์คนนี้ไหม — งานที่ยกเลิกถูก engine ล้าง rider_id แต่ยังถือ
 *  cancelled_by รูป `rider:{id}` (กติกาเดียวกับ buildRiderFeeApproval) */
export const jobBelongsToRider = (job: Loose | null | undefined, riderId: string): boolean =>
  !!job && (job.rider_id === riderId || job.cancelled_by === `rider:${riderId}`);

export const timeOf = (t: Loose | null | undefined): number | null => {
  const ts = finiteOrNull(t?.timestamp);
  if (ts !== null && ts > 0) return ts;
  const created = finiteOrNull(t?.created_at);
  return created !== null && created > 0 ? created : null;
};

/** ป้ายผู้เขียนแถว JOB_PAYOUT อนุมานจากคำนำของ description — ไม่คืน description เอง */
const payoutWriterLabel = (description: unknown): string | null => {
  const d = String(description || '');
  if (d.includes('[Backfill Settle]')) return 'สคริปต์ settle-pending (เก่า)';
  if (d.includes('[Batch]')) return 'ปุ่ม batch รุ่นเก่า';
  if (d.startsWith('[ซ่อม]')) return 'TransactionRepair';
  if (d.startsWith('ค่าเที่ยวงาน')) return 'อนุมัติจาก UI';
  return null;
};

const jobRefNo = (job: Loose | null | undefined): string | null => str(job?.ref_no) ?? str(job?.OID);

const joinParts = (parts: (string | null | undefined)[]): string | null => {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return kept.length ? kept.join(' · ') : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RANGE_DAYS = 90;

/** ช่วงเริ่มต้น: 90 วันย้อนหลังถึงสิ้นวันนี้ (เวลาเครื่องผู้ใช้ — ตัวกรองแสดงผล ไม่ใช่ตัวเลขบัญชี) */
export function defaultRange(now: number = Date.now()): { from: number; to: number } {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  start.setHours(0, 0, 0, 0);
  return { from: start.getTime(), to: end.getTime() };
}

export function buildStatement(input: StatementInput): Statement {
  const riderId = input.riderId;
  const archived = input.archived || {};
  const from = input.from ?? null;
  const to = input.to ?? null;
  const staffNames = input.staffNames || {};
  const personName = (id: string) => staffNames[id] || id;

  const jobsById: Record<string, Loose> = {};
  for (const j of input.jobs || []) if (j && typeof j.id === 'string') jobsById[j.id] = j;
  const wdById: Record<string, Loose> = {};
  for (const w of input.withdrawals || []) if (w && typeof w.id === 'string') wdById[w.id] = w;

  const mine = (input.transactions || []).filter((t) => t && t.rider_id === riderId);

  // เรียงเวลาเก่า→ใหม่ · ไม่มีเวลา = ท้ายสุด · เวลาเท่ากันเรียงตาม id (คงที่ ไม่ขึ้นกับลำดับที่ส่งมา)
  const sorted = [...mine].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta === null && tb === null) return String(a.id) < String(b.id) ? -1 : 1;
    if (ta === null) return 1;
    if (tb === null) return -1;
    if (ta !== tb) return ta - tb;
    return String(a.id) < String(b.id) ? -1 : 1;
  });

  const rows: StatementRow[] = [];
  const unresolved: string[] = [];
  const unresolvedSeen = new Set<string>();
  let counted: Loose[] = [];
  let opening = 0;

  for (const t of sorted) {
    const category = String(t.category ?? '');
    const type = String(t.type ?? '');
    const amount = finiteOrNull(t.amount);
    const at = timeOf(t);
    const isCounted = isRiderWalletTx(t);
    const warnings: StatementWarning[] = [];
    const warn = (w: StatementWarning) => {
      if (!warnings.includes(w)) warnings[warnings.length] = w;
    };

    if (amount === null) warn('amount_not_finite');
    else if (amount < 0) warn('negative_amount');
    if (type !== 'CREDIT' && type !== 'DEBIT') warn('bad_type');
    const expected = EXPECTED_TYPE[category];
    if (expected && expected !== 'ANY' && (type === 'CREDIT' || type === 'DEBIT') && type !== expected) warn('type_mismatch');
    if (at === null) warn('timestamp_missing');
    if (t.category_was) warn('relabeled');

    // ── อ้างอิง ──
    const refId = str(t.ref_job_id);
    let ref: StatementRef = { kind: 'none', id: null, refNo: null };
    let job: Loose | null = null;
    let wd: Loose | null = null;
    if (category === 'EXPENSE_REIMBURSEMENT') {
      const exp = str(t.rider_expense_id);
      ref = { kind: exp ? 'expense' : 'none', id: exp, refNo: exp };
    } else if (refId) {
      if (wdById[refId]) {
        wd = wdById[refId];
        ref = { kind: 'withdrawal', id: refId, refNo: refId };
      } else if (jobsById[refId]) {
        job = jobsById[refId];
        ref = { kind: 'job', id: refId, refNo: jobRefNo(job) };
        if (!jobBelongsToRider(job, riderId)) warn('other_rider');
      } else if (typeof archived[refId] === 'string') {
        ref = { kind: 'job_archived', id: refId, refNo: archived[refId] };
        warn('ref_archived');
      } else {
        ref = { kind: 'job_missing', id: refId, refNo: null };
        warn('ref_missing');
        // ยังไม่เคยเช็ค jobs_archived → ส่งให้หน้าจอไปเช็ค (เช็คแล้วไม่พบ = key มีค่า null ไม่ส่งซ้ำ)
        if (!Object.prototype.hasOwnProperty.call(archived, refId) && !unresolvedSeen.has(refId)) {
          unresolvedSeen.add(refId);
          unresolved[unresolved.length] = refId;
        }
      }
    } else if (REF_REQUIRED.has(category)) {
      warn('no_ref');
    }

    // ── บรรทัดที่อ่านออก — ไม่ใช้ description ดิบ ──
    const label = isCounted || EXPECTED_TYPE[category] ? walletCategoryLabel(category) : category || 'รายการอื่น';
    let detail: string;
    let source: string | null = null;
    if (category === 'WITHDRAWAL') {
      detail = `ถอนเงิน · ${refId || '-'}`;
      const wht = finiteOrNull(wd?.wht_amount ?? t.wht_amount);
      const paidBy = str(wd?.paid_by);
      const wdStatus = str(wd?.status);
      source = joinParts([
        paidBy ? `โอนโดย ${paidBy}` : null,
        wht !== null && wht > 0 ? `หัก ณ ที่จ่าย ${wht}` : null,
        wdStatus && wdStatus !== 'paid' ? `คำขอสถานะ ${wdStatus}` : null,
      ]);
    } else if (category === 'JOB_PAYOUT') {
      detail = joinParts(['ค่ารอบงาน', str(job?.model), ref.refNo || (ref.kind === 'none' ? null : '(ไม่พบงาน)')]) || 'ค่ารอบงาน';
      const reason = str(rec(job?.rider_fee_meta)?.reason);
      const approvedBy = str(job?.rider_fee_approved_by);
      source = joinParts([
        approvedBy ? `อนุมัติโดย ${personName(approvedBy)}` : null,
        payoutWriterLabel(t.description),
        reason && reason !== 'calculated' ? `ค่ารอบจาก ${reason}` : null,
      ]);
    } else if (category === 'ADJUSTMENT') {
      detail = joinParts(['ปรับปรุงค่ารอบ', ref.refNo]) || 'ปรับปรุงค่ารอบ';
      const was = str(t.category_was);
      const why = str(t.category_correction_reason);
      source = joinParts([job?.pin_dispute ? 'คำแย้งหมุด' : null, was ? `เดิมหมวด ${was}${why ? `: ${why}` : ''}` : null]);
    } else if (category === 'EXPENSE_REIMBURSEMENT') {
      detail = `คืนเงินสำรองจ่าย · ใบเบิก ${ref.refNo || '-'}`;
      source = 'ระบบเบิกค่าใช้จ่ายไรเดอร์';
    } else if (isCounted || EXPECTED_TYPE[category]) {
      detail = joinParts([label, ref.refNo]) || label;
      source = joinParts([str(t.category_was) ? `เดิมหมวด ${str(t.category_was)}` : null]);
    } else {
      detail = `${category || 'ไม่มีหมวด'} · ไม่นับเข้ากระเป๋า`;
    }

    let running: number | null = null;
    if (isCounted) {
      counted = [...counted, t];
      running = walletBalance(counted);
    }
    const inRange = at === null ? true : (from === null || at >= from) && (to === null || at <= to);
    if (isCounted && at !== null && from !== null && at < from) opening = running as number;

    rows[rows.length] = {
      id: String(t.id),
      at,
      category,
      type,
      label,
      detail,
      ref,
      dr: type === 'DEBIT' ? amount : null,
      cr: type === 'CREDIT' ? amount : null,
      counted: isCounted,
      running,
      source,
      warnings,
      inRange,
    };
  }

  const balance = walletBalance(counted);
  const myWithdrawals = (input.withdrawals || []).filter((w) => w && w.rider_id === riderId);
  const hold = pendingWithdrawalHold(myWithdrawals);
  const requested = myWithdrawals
    .filter((w) => w.status === 'requested')
    .map((w) => ({ id: String(w.id), amount: finiteOrNull(w.withdraw_amount) ?? 0, requestedAt: finiteOrNull(w.requested_at) }))
    .sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0));
  const available = balance - hold;

  return {
    riderId,
    rows,
    visible: rows.filter((r) => r.inRange),
    opening,
    balance,
    hold,
    requested,
    available,
    reconcile: reconcile({ riderId, counted, jobs: input.jobs || [], jobsById, withdrawals: myWithdrawals, archived, balance, hold }),
    unresolvedJobIds: unresolved,
  };
}

function reconcile(args: {
  riderId: string;
  counted: readonly Loose[];
  jobs: readonly Loose[];
  jobsById: Record<string, Loose>;
  withdrawals: readonly Loose[];
  archived: Readonly<Record<string, string | null>>;
  balance: number;
  hold: number;
}): Reconcile {
  const { riderId, counted, jobsById, archived, balance, hold } = args;
  const signed = (t: Loose) => (t.type === 'CREDIT' ? Number(t.amount) : -Number(t.amount));

  // ฝั่งงาน: ทุกใบของไรเดอร์คนนี้ที่ค่ารอบถูกประทับว่า Paid
  const paidJobs = args.jobs.filter((j) => j && typeof j.id === 'string' && jobBelongsToRider(j, riderId) && j.rider_fee_status === 'Paid');
  let paidFees = 0;
  for (const j of paidJobs) paidFees += finiteOrNull(j.rider_fee) ?? 0;

  // ฝั่ง ledger: แยกตามหมวด (เฉพาะแถวที่นับ)
  const payouts = counted.filter((t) => t.category === 'JOB_PAYOUT');
  let withdrawals = 0;
  let adjustments = 0;
  const otherSums: Record<string, number> = {};
  for (const t of counted) {
    if (t.category === 'JOB_PAYOUT') continue;
    if (t.category === 'WITHDRAWAL') withdrawals += Number(t.amount);
    else if (t.category === 'ADJUSTMENT') adjustments += signed(t);
    else otherSums[String(t.category)] = (otherSums[String(t.category)] || 0) + signed(t);
  }
  const others = Object.keys(otherSums)
    .sort()
    .map((category) => ({ category, label: walletCategoryLabel(category), amount: otherSums[category] }));
  const othersTotal = others.reduce((s, o) => s + o.amount, 0);
  const total = paidFees - withdrawals + adjustments + othersTotal;

  // (i) งาน Paid ที่ไม่มี JOB_PAYOUT ชี้มา
  const payoutJobIds = new Set(payouts.map((t) => String(t.ref_job_id || '')));
  const paidJobsWithoutPayout: PaidJobWithoutPayout[] = paidJobs
    .filter((j) => !payoutJobIds.has(String(j.id)))
    .map((j) => ({ jobId: String(j.id), refNo: jobRefNo(j), fee: finiteOrNull(j.rider_fee), settledAt: finiteOrNull(j.settled_at) }))
    .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));

  // (ii) JOB_PAYOUT ที่งานไม่ใช่ Paid / ยอดไม่ตรง / งานหาย / งานของคนอื่น / ซ้ำ
  const seenJob: Record<string, number> = {};
  const payoutsNotMatchingJob: PayoutMismatch[] = [];
  for (const t of payouts) {
    const jobId = str(t.ref_job_id);
    const job = jobId ? jobsById[jobId] : null;
    const reasons: PayoutMismatchReason[] = [];
    const amount = Number(t.amount);
    let fee: number | null = null;
    let feeStatus: string | null = null;
    if (!job) {
      reasons[reasons.length] = jobId && typeof archived[jobId] === 'string' ? 'job_archived' : 'job_missing';
    } else {
      fee = finiteOrNull(job.rider_fee);
      feeStatus = str(job.rider_fee_status);
      if (!jobBelongsToRider(job, riderId)) reasons[reasons.length] = 'other_rider';
      if (feeStatus !== 'Paid') reasons[reasons.length] = 'fee_status';
      if (fee === null || fee !== amount) reasons[reasons.length] = 'amount_mismatch';
    }
    if (jobId) {
      seenJob[jobId] = (seenJob[jobId] || 0) + 1;
      if (seenJob[jobId] > 1) reasons[reasons.length] = 'duplicate_payout';
    }
    if (reasons.length) {
      payoutsNotMatchingJob[payoutsNotMatchingJob.length] = {
        txId: String(t.id),
        jobId,
        refNo: job ? jobRefNo(job) : jobId && archived[jobId] ? archived[jobId] : null,
        amount,
        fee,
        feeStatus,
        reasons,
      };
    }
  }

  let withdrawalsNodePaid = 0;
  for (const w of args.withdrawals) if (w.status === 'paid') withdrawalsNodePaid += finiteOrNull(w.withdraw_amount) ?? 0;

  return {
    ledger: balance,
    fromJobs: { paidFees, paidJobCount: paidJobs.length, withdrawals, adjustments, others, total },
    available: balance - hold,
    hold,
    diff: balance - total,
    paidJobsWithoutPayout,
    payoutsNotMatchingJob,
    withdrawalsNodePaid,
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const csvCell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function formatStatementTime(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** CSV ของแถวที่แสดงอยู่ (ตามช่วงวันที่) + ยอดยกมา/ยอดคงเหลือ — ไม่มี description ดิบ */
export function statementCsv(s: Statement): string {
  const header = ['เวลา', 'หมวด', 'รายการ', 'อ้างอิง', 'Dr (ออก)', 'Cr (เข้า)', 'คงเหลือสะสม', 'นับเข้ากระเป๋า', 'ที่มา', 'หมายเหตุ'];
  const lines: string[][] = [];
  lines[lines.length] = ['', '', 'ยอดยกมา', '', '', '', String(s.opening), '', '', ''];
  for (const r of s.visible) {
    lines[lines.length] = [
      formatStatementTime(r.at),
      r.label,
      r.detail,
      r.ref.refNo || r.ref.id || '',
      r.dr === null ? '' : String(r.dr),
      r.cr === null ? '' : String(r.cr),
      r.running === null ? '' : String(r.running),
      r.counted ? 'Y' : 'N',
      r.source || '',
      r.warnings.map((w) => WARNING_LABEL_TH[w]).join(' / '),
    ];
  }
  lines[lines.length] = ['', '', 'ยอดคงเหลือ (ทั้งหมด)', '', '', '', String(s.balance), '', '', ''];
  lines[lines.length] = ['', '', 'ยอดจองค้าง', '', '', '', String(s.hold), '', '', ''];
  lines[lines.length] = ['', '', 'ยอดถอนได้', '', '', '', String(s.available), '', '', ''];
  return [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
