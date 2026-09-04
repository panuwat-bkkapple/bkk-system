// =============================================================================
// ภาษีหัก ณ ที่จ่าย ค่าตอบแทนไรเดอร์ (withholding tax on rider payouts)
//
// **จุดที่หักคือ "ตอนถอน" ไม่ใช่ "ตอนอนุมัติค่ารอบเข้า wallet"**
// การอนุมัติค่ารอบเป็นการตั้งหนี้ (บริษัทค้างจ่ายไรเดอร์) เงินยังไม่ออกจาก
// บัญชีบริษัท ส่วนการถอนคือการจ่ายเงินจริง มีสลิปโอนเป็นหลักฐาน — หน้าที่หัก
// ภาษี ณ ที่จ่ายเกิดเมื่อ "จ่ายเงินได้" จึงผูกกับการถอน. ผลพลอยได้คือยอดสะสม
// ที่หักได้ตลอดปีเท่ากับ 3% ของเงินที่ไรเดอร์ได้รับจริงพอดี ไม่ต้องกระทบยอด
// ย้อนหลังเมื่อไรเดอร์ถอนไม่หมด
//
// **ใช้เฉพาะไรเดอร์ที่ระบุสถานะเป็น `freelance`** (riders/{id}/employment.type):
//   - freelance = ค่าจ้างทำของ/ค่าบริการ → บริษัทมีหน้าที่หัก ณ ที่จ่าย
//     และออกหนังสือรับรอง (50 ทวิ) + ยื่น ภ.ง.ด.3
//   - employee  = เงินได้ ม.40(1) เข้าระบบเงินเดือน หักตามอัตราก้าวหน้าที่
//     payroll ไม่ใช่หักรายครั้งตรงนี้ → ไม่หัก
//   - ไม่ระบุ    = **ไม่หักและไม่เดา** ให้แอดมินไปกรอกสถานะก่อน การเดาผิดทาง
//     แปลว่าหักเงินคนที่ไม่ควรถูกหัก หรือปล่อยผ่านคนที่ควรถูกหัก
//
// **master switch ปิดเป็นค่าเริ่มต้น** (`settings/accounting/rider_wht.enabled`)
// เพราะการเริ่มหักทำให้ไรเดอร์ได้เงินน้อยลงจากเดิม เป็นเรื่องที่ต้องแจ้งเขา
// ก่อน ไม่ใช่แค่ deploy โค้ด. เปิดเมื่อสื่อสารเรียบร้อยแล้ว
//
// MIRROR: สูตรเดียวกันอยู่ที่ `src/utils/riderWht.ts` (ฝั่ง UI ต้องโชว์ยอดโอน
// สุทธิให้คนกดโอนเห็นก่อนโอน) และ `bkk-rider-app/src/utils/riderWht.ts`
// (ไรเดอร์เห็นก่อนกดถอน — ตัวนั้นไม่มีฐานภาษี จึงเป็นเพดานบน) — แก้สูตรต้องแก้ทั้งสาม
// =============================================================================

const DEFAULT_RATE_PERCENT = 3;

/** อ่าน config จาก settings/accounting — fail-closed: อ่านไม่ได้ = ไม่หัก */
async function loadRiderWhtSettings(db) {
  let s = {};
  try {
    s = (await db.ref("settings/accounting/rider_wht").once("value")).val() || {};
  } catch (e) {
    console.warn("[riderWht] read settings failed:", e?.message || e);
    return { enabled: false, ratePercent: DEFAULT_RATE_PERCENT };
  }
  const rate = Number(s.rate_percent);
  return {
    enabled: s.enabled === true,
    ratePercent: rate > 0 && rate < 100 ? rate : DEFAULT_RATE_PERCENT,
  };
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * คำนวณยอดหัก ณ ที่จ่ายของการถอนหนึ่งครั้ง
 *
 * **ฐานภาษีไม่ใช่ยอดถอนทั้งก้อน** — กระเป๋าไรเดอร์มีเงินคืนค่าทดรอง
 * (`EXPENSE_REIMBURSEMENT` — ค่าทางด่วน/ที่จอดรถที่เขาสำรองจ่าย) ปนอยู่ ซึ่ง
 * นักบัญชียืนยัน (4 ก.ย. 2569) ว่า**ไม่ใช่เงินได้ ไม่หัก 3%** ฐานภาษีจึงเป็น
 * "ค่าจ้าง" = ยอดถอน − ส่วนที่เป็นเงินคืน ซึ่งแยกด้วย `splitWithdrawal`
 * (`rider-cost-split.js` — สูตรเดียวกับที่ใช้ลงบัญชีค่าจ้าง ห้ามเขียนสูตรที่สอง)
 *
 * caller ส่ง `taxableBase` มาเอง (ค่าเริ่มต้น = gross ทั้งก้อน) เพราะฟังก์ชันนี้
 * pure ไม่แตะ ledger — ถ้าไม่ส่ง = หักบนยอดเต็ม ซึ่ง**หักเกิน** ไม่ใช่หักขาด
 * (ทิศที่ผิดแล้วคืนไรเดอร์ได้ ไม่ใช่ทิศที่ผิดแล้วต้องไล่เก็บ)
 *
 * @param grossAmount ยอดที่ไรเดอร์ขอถอน (ก่อนหัก)
 * @param employmentType riders/{id}/employment.type
 * @param cfg ผลจาก loadRiderWhtSettings
 * @param opts.taxableBase ส่วนของยอดถอนที่เป็นเงินได้ (ค่าจ้าง) — ไม่ส่ง = gross
 * @returns { applies, gross, taxableBase, exempt, wht, net, ratePercent, reason }
 *          `reason` บอกเหตุผลเมื่อไม่หัก เพื่อให้ UI อธิบายคนกดโอนได้
 */
function computeRiderWht(grossAmount, employmentType, cfg, opts) {
  const gross = round2(Math.max(0, Number(grossAmount) || 0));
  const rawBase = opts && opts.taxableBase != null ? Number(opts.taxableBase) : gross;
  // ฐานภาษีอยู่ระหว่าง 0 กับยอดถอนเสมอ — ค่าที่หลุดช่วง (ledger เพี้ยน) ถูกบีบ
  // ไม่ใช่ปล่อยให้หักติดลบหรือหักเกินยอดที่จ่าย
  const taxableBase = round2(Math.min(gross, Math.max(0, Number.isFinite(rawBase) ? rawBase : gross)));
  const exempt = round2(gross - taxableBase);
  const ratePercent = (cfg && cfg.ratePercent) || DEFAULT_RATE_PERCENT;
  const none = (reason) => ({
    applies: false, gross, taxableBase, exempt, wht: 0, net: gross, ratePercent, reason,
  });

  if (!cfg || !cfg.enabled) return none("ระบบหักภาษี ณ ที่จ่ายยังปิดอยู่");
  if (gross <= 0) return none("ยอดถอนเป็นศูนย์");
  if (employmentType === "employee") return none("ลูกจ้างประจำ — หักที่ระบบเงินเดือน (ภ.ง.ด.1)");
  if (employmentType !== "freelance") return none("ยังไม่ระบุสถานะการจ้างของไรเดอร์");
  if (taxableBase <= 0) return none("ยอดถอนทั้งก้อนเป็นเงินคืนค่าทดรอง ไม่ใช่เงินได้");

  const wht = round2((taxableBase * ratePercent) / 100);
  return {
    applies: true, gross, taxableBase, exempt, wht, net: round2(gross - wht), ratePercent, reason: "",
  };
}

module.exports = {
  DEFAULT_RATE_PERCENT,
  loadRiderWhtSettings,
  computeRiderWht,
};
