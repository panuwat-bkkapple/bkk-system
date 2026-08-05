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

export function computeRiderWht(
  grossAmount: number,
  employmentType: RiderEmploymentType,
  cfg: RiderWhtConfig,
): RiderWhtResult {
  const gross = round2(Math.max(0, Number(grossAmount) || 0));
  const ratePercent = cfg?.ratePercent || DEFAULT_WHT_RATE_PERCENT;
  const none = (reason: string): RiderWhtResult => ({
    applies: false, gross, wht: 0, net: gross, ratePercent, reason,
  });

  if (!cfg?.enabled) return none('ระบบหักภาษี ณ ที่จ่ายยังปิดอยู่');
  if (gross <= 0) return none('ยอดถอนเป็นศูนย์');
  if (employmentType === 'employee') return none('ลูกจ้างประจำ — หักที่ระบบเงินเดือน (ภ.ง.ด.1)');
  if (employmentType !== 'freelance') return none('ยังไม่ระบุสถานะการจ้างของไรเดอร์');

  const wht = round2((gross * ratePercent) / 100);
  return { applies: true, gross, wht, net: round2(gross - wht), ratePercent, reason: '' };
}
