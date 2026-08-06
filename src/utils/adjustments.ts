// Ad-hoc price adjustments on a job — itemised deductions/additions that admin
// QC or a rider (via approved amendment) records, instead of silently
// overwriting the total. Each line is transparent to the customer.
//
// net_payout folds in ONLY adjustments with status 'applied'. Rider-proposed
// lines start 'pending' and become 'applied' when an admin approves the
// amendment (server-side reviewAmendment). The canonical formula lives in the
// data contract (bkk-system/CLAUDE.md invariant #2); sumAppliedAdjustments is
// mirrored in bkk-frontend-next/functions, bkk-system/functions, and the rider
// app — keep all copies in sync.

export interface JobAdjustment {
  id: string;
  label: string;
  amount: number; // negative = deduct, positive = add (baht)
  device_index?: number;
  source: 'admin_qc' | 'admin_manual' | 'rider_proposed';
  status: 'applied' | 'pending' | 'rejected';
  by_uid?: string;
  by_name?: string;
  by_role?: string;
  at: number;
  reason?: string;
  evidence?: { url: string; uploaded_at?: number }[];
  // Approval trail — admin offers proposed by non-CEO/MANAGER staff start
  // 'pending' and need a CEO/MANAGER decision (push notified via the
  // onAdminOfferProposed cloud function). CEO/MANAGER-created lines are
  // self-approved on the spot so the trail is never empty.
  approved_by_uid?: string;
  approved_by_name?: string;
  approved_by_role?: string;
  approved_at?: number;
  rejected_by_name?: string;
  rejected_at?: number;
}

// Roles allowed to approve/reject a pending admin offer (and to create one
// that applies immediately). Everyone else proposes → pending.
export function canReviewAdjustments(role?: string): boolean {
  const r = String(role || '').toUpperCase();
  return r === 'CEO' || r === 'MANAGER';
}

// RTDB stores adjustments as an array or a push-keyed object depending on the
// writer — normalise to an array.
export function listAdjustments(job: unknown): JobAdjustment[] {
  const raw = (job as { adjustments?: unknown } | null)?.adjustments;
  if (Array.isArray(raw)) return raw as JobAdjustment[];
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, JobAdjustment>);
  return [];
}

export function sumAppliedAdjustments(job: unknown): number {
  return listAdjustments(job).reduce((sum, a) => {
    if (!a || a.status !== 'applied') return sum;
    const amt = Number(a.amount);
    return Number.isFinite(amt) ? sum + amt : sum;
  }, 0);
}

// ─── คูปอง ────────────────────────────────────────────────────────────────
//
// งานหนึ่งใบถือคูปองได้หนึ่งใบต่อหนึ่ง bucket — คูปองที่ผูกกับสินค้า (ได้ทุกเครื่อง
// ในออเดอร์), คูปองรีวิว 1 ใบ, คูปองโปรโมชั่นระดับออเดอร์ 1 ใบ — เก็บที่
// `jobs/{id}/applied_coupons`. งานเก่าและ Manual Top-up ของแอดมินยังเป็น object
// เดี่ยว `applied_coupon`. **ห้ามบวกทั้งสองรูปแบบ** เพราะตอนสร้างงาน server ยัง
// เขียน `applied_coupon` = ใบที่มูลค่าสูงสุด ไว้ให้ UI ที่ยังไม่ย้ายโชว์ได้ —
// array มาก่อนเสมอ
//
// MIRROR 4 ที่ (ต้อง sync): bkk-frontend-next/functions/src/index.ts,
// bkk-frontend-next/app/utils/jobPricing.ts, bkk-system/functions/index.js,
// bkk-rider-app/src/utils/adjustments.ts

export interface AppliedCouponLine {
  /** ช่องที่คูปองใบนี้ครอง — หนึ่งใบต่อหนึ่งช่องต่อออเดอร์
   *  (`device` ได้หนึ่งใบต่อหนึ่งเครื่อง) */
  bucket?: 'device' | 'review' | 'promo';
  code?: string;
  coupon_id?: string;
  name?: string;
  type?: string;
  value?: number;
  actual_value?: number;
  /** เฉพาะ bucket `device` — เครื่องที่คูปองใบนี้เกาะอยู่ */
  device_id?: string;
  model_id?: string;
  /** เฉพาะคูปองที่ออกให้รายบุคคล (รีวิว) — คีย์ใน users/{uid}/coupons */
  wallet_id?: string;
  applied_at?: number;
}

export function listAppliedCoupons(job: unknown): AppliedCouponLine[] {
  const j = job as { applied_coupons?: unknown; applied_coupon?: AppliedCouponLine } | null;
  const raw = j?.applied_coupons;
  const list = Array.isArray(raw)
    ? (raw as AppliedCouponLine[])
    : (raw && typeof raw === 'object' ? Object.values(raw as Record<string, AppliedCouponLine>) : []);
  const present = list.filter(Boolean);
  if (present.length > 0) return present;
  return j?.applied_coupon ? [j.applied_coupon] : [];
}

/** เงินที่คูปองบวกเข้ายอดโอน — คูปองชนิด `service` (ส่งฟรี) ไม่มีตัวเงิน
 *  มันไปล้างค่าบริการรับเครื่องแทน */
export function sumAppliedCoupons(job: unknown): number {
  return listAppliedCoupons(job).reduce((sum, c) => {
    if (!c || c.type === 'service') return sum;
    const v = Number(c.actual_value ?? c.value);
    return Number.isFinite(v) ? sum + v : sum;
  }, 0);
}

/**
 * ลบคูปองทั้งหมดออกจากงาน — **ต้องล้างทั้งสองฟิลด์**
 *
 * งานที่สร้างจากเว็บใหม่เก็บของจริงไว้ที่ `applied_coupons` ส่วน `applied_coupon`
 * เป็นแค่สำเนาไว้ให้ UI เก่าโชว์ ถ้าล้างแค่ตัวเดียว `sumAppliedCoupons` จะยังนับ
 * เงินก้อนเดิมอยู่ = กด "ดึงเงินกลับ" แล้วเงินไม่กลับ
 *
 * cloud function `onJobCouponsRevoked` จะคืน ledger/quota ให้เองหลังจากนี้
 */
export const REVOKED_COUPON_FIELDS = {
  applied_coupon: null,
  applied_coupons: null,
} as const;

/**
 * Manual Top-up ของแอดมิน — **แทนที่คูปองทั้งชุดบนงาน** (พฤติกรรมเดิมของช่องนี้
 * ตั้งแต่ยังมีคูปองใบเดียว) คูปองแคมเปญที่ลูกค้าได้มาจะถูกถอดออกและ
 * `onJobCouponsRevoked` จะคืน ledger/quota ให้ครบ
 *
 * ไม่ใส่ `mirrored` เพราะนี่เป็นคูปองจริงของมันเอง ไม่ใช่สำเนา — trigger ตัวเดี่ยว
 * (`onJobCouponRevoked`) จึงยังเป็นเจ้าของการ reconcile ใบนี้ตอนถูกลบทีหลัง
 */
export function adminTopUpCouponFields(code: string, value: number) {
  return {
    applied_coupon: { code, name: 'Admin Manual Top-up', value, actual_value: value },
    applied_coupons: null,
  };
}
