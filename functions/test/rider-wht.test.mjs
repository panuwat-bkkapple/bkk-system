// ---------------------------------------------------------------------------
// ภาษีหัก ณ ที่จ่ายค่าตอบแทนไรเดอร์ — ฐานภาษีคือค่าจ้างล้วน ไม่รวมเงินคืนค่าทดรอง
//
//   node functions/test/rider-wht.test.mjs
//
// นักบัญชียืนยัน (4 ก.ย. 2569): เงินคืนค่าทางด่วน/ที่จอดรถไม่ใช่เงินได้ ไม่หัก 3%
// ก่อนหน้านี้ `computeRiderWht` หักบนยอดถอนทั้งก้อน = หักภาษีจากเงินที่ไม่ใช่
// เงินได้ของเขา ซึ่งผิดในทิศที่ "คืนได้" แต่ก็ยังผิด
//
// เคสชุดเดียวกับ src/utils/riderWht.test.ts โดยตั้งใจ (MIRROR)
//
// ผล injection (วัดจริง 4 ก.ย. 2569):
//   1. คูณอัตรากับ gross แทน taxableBase                → แดง 2 (ทั้งสองฝั่ง)
//   2. ถอด clamp ฐานไม่เกิน gross                        → แดง 1
//   3. ถอดเงื่อนไข "ฐาน 0 = ไม่หัก"                      → แดง 1
//   4. net = taxableBase − wht (ลืมโอนส่วนเงินคืน)        → แดง 1
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { computeRiderWht } = require(join(here, "..", "rider-wht.js"));

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`); failures += 1; }
};
const ON = { enabled: true, ratePercent: 3 };

{
  const r = computeRiderWht(1000, "freelance", ON);
  check("ไม่ส่งฐาน = หักบนยอดเต็ม", r.taxableBase === 1000 && r.wht === 30 && r.net === 970, JSON.stringify(r));
}
{
  const r = computeRiderWht(1065, "freelance", ON, { taxableBase: 1000 });
  check("ถอน 1,065 มีเงินคืน 65 = หัก 30 โอน 1,035",
    r.applies && r.taxableBase === 1000 && r.exempt === 65 && r.wht === 30 && r.net === 1035, JSON.stringify(r));
}
{
  const r = computeRiderWht(65, "freelance", ON, { taxableBase: 0 });
  check("เงินคืนล้วน = ไม่หัก พร้อมเหตุผล", !r.applies && r.wht === 0 && r.net === 65 && /เงินคืน/.test(r.reason));
}
{
  const r = computeRiderWht(500, "freelance", ON, { taxableBase: 9999 });
  check("ฐานเกินยอดถอนถูกบีบ", r.taxableBase === 500 && r.wht === 15);
  check("ฐานติดลบ = 0", computeRiderWht(500, "freelance", ON, { taxableBase: -10 }).taxableBase === 0);
  check("ฐาน NaN = ยอดเต็ม", computeRiderWht(500, "freelance", ON, { taxableBase: NaN }).taxableBase === 500);
}
{
  check("ปิดสวิตช์ไม่หัก", !computeRiderWht(1000, "freelance", { enabled: false, ratePercent: 3 }, { taxableBase: 1000 }).applies);
  check("ลูกจ้างประจำไม่หัก", !computeRiderWht(1000, "employee", ON, { taxableBase: 1000 }).applies);
  check("ไม่ระบุไม่หัก", !computeRiderWht(1000, null, ON, { taxableBase: 1000 }).applies);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
