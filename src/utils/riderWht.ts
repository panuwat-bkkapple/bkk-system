// ภาษีหัก ณ ที่จ่ายค่าตอบแทนไรเดอร์ — ฝั่ง UI
//
// MIRROR ของ `functions/rider-wht.js` (functions เป็น JS import TS ไม่ได้)
// **แก้สูตรต้องแก้ทั้งสองไฟล์** ตามระเบียบ MIRROR ใน CLAUDE.md
//
// ฝั่ง UI ต้องมีสูตรด้วยเพราะคนที่กดโอนต้องเห็น "ยอดที่ต้องโอนจริง" ก่อนโอน
// ไม่ใช่รู้ทีหลังจากเอกสาร — โอนเกินไปแล้วเรียกคืนยากกว่ามาก. ฝั่ง server
// คำนวณซ้ำเองตอนออกหนังสือรับรอง และถือเป็นตัวจริงเสมอ

export const DEFAULT_WHT_RATE_PERCENT = 3;

export type RiderEmploymentType = 'employee' | 'freelance' | undefined | null;

export interface RiderWhtConfig {
  enabled: boolean;
  ratePercent: number;
}

export interface RiderWhtResult {
  applies: boolean;
  gross: number;
  /** ส่วนของยอดถอนที่เป็นเงินได้ (ค่าจ้าง) — ฐานที่คูณอัตรา */
  taxableBase: number;
  /** ส่วนที่ไม่ใช่เงินได้ (เงินคืนค่าทดรอง) = gross − taxableBase */
  exempt: number;
  wht: number;
  net: number;
  ratePercent: number;
  /** เหตุผลที่ไม่หัก — ใช้อธิบายคนกดโอนว่าทำไมยอดเต็ม */
  reason: string;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** อ่าน config จาก settings/accounting/rider_wht — fail-closed */
export function readRiderWhtConfig(raw: unknown): RiderWhtConfig {
  const s = (raw || {}) as { enabled?: unknown; rate_percent?: unknown };
  const rate = Number(s.rate_percent);
  return {
    enabled: s.enabled === true,
    ratePercent: rate > 0 && rate < 100 ? rate : DEFAULT_WHT_RATE_PERCENT,
  };
}

/**
 * **ฐานภาษีไม่ใช่ยอดถอนทั้งก้อน** — เงินคืนค่าทดรอง (EXPENSE_REIMBURSEMENT) ที่ปน
 * อยู่ในกระเป๋าไม่ใช่เงินได้ ไม่หัก 3% (นักบัญชียืนยัน 4 ก.ย. 2569) caller ส่ง
 * `taxableBase` = ค่าจ้างล้วนจาก `splitWithdrawal` (utils/riderCostSplit.ts)
 * ไม่ส่ง = หักบนยอดเต็ม ซึ่งเป็นทิศ "หักเกิน" ที่คืนได้ ไม่ใช่ "หักขาด" ที่ต้องไล่เก็บ
 */
export function computeRiderWht(
  grossAmount: number,
  employmentType: RiderEmploymentType,
  cfg: RiderWhtConfig,
  opts: { taxableBase?: number | null } = {},
): RiderWhtResult {
  const gross = round2(Math.max(0, Number(grossAmount) || 0));
  const rawBase = opts.taxableBase != null ? Number(opts.taxableBase) : gross;
  const taxableBase = round2(Math.min(gross, Math.max(0, Number.isFinite(rawBase) ? rawBase : gross)));
  const exempt = round2(gross - taxableBase);
  const ratePercent = cfg?.ratePercent || DEFAULT_WHT_RATE_PERCENT;
  const none = (reason: string): RiderWhtResult => ({
    applies: false, gross, taxableBase, exempt, wht: 0, net: gross, ratePercent, reason,
  });

  if (!cfg?.enabled) return none('ระบบหักภาษี ณ ที่จ่ายยังปิดอยู่');
  if (gross <= 0) return none('ยอดถอนเป็นศูนย์');
  if (employmentType === 'employee') return none('ลูกจ้างประจำ — หักที่ระบบเงินเดือน (ภ.ง.ด.1)');
  if (employmentType !== 'freelance') return none('ยังไม่ระบุสถานะการจ้างของไรเดอร์');
  if (taxableBase <= 0) return none('ยอดถอนทั้งก้อนเป็นเงินคืนค่าทดรอง ไม่ใช่เงินได้');

  const wht = round2((taxableBase * ratePercent) / 100);
  return {
    applies: true, gross, taxableBase, exempt, wht, net: round2(gross - wht), ratePercent, reason: '',
  };
}
