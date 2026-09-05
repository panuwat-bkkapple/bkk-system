// ---------------------------------------------------------------------------
// onJobCouponsRevoked ต้อง diff บรรทัดคูปองด้วย code + device_id ไม่ใช่ code
//
//   node functions/test/coupon-revoke-diff.test.mjs
//
// ที่มา: device bucket ให้แคมเปญเดียวเกาะได้ทุกเครื่องที่เข้าเงื่อนไข
// (couponEngine.ts ฝั่ง bkk-frontend-next) งานที่มี MacBook สองเครื่องใต้
// "MacBook +1,000" จึงมี code เดียวกันสองบรรทัด. diff เดิม key ด้วย code
// อย่างเดียว พร้อมคอมเมนต์ว่า "แคมเปญเดียวกันปรากฏสองครั้งบนงานเดียวไม่ได้"
// ซึ่งไม่จริงแล้ว — แอดมินลบใบแฝดใบเดียว → code ยังอยู่ → removed = [] →
// quota/ledger ไม่ถูกคืน เงียบสนิท. ปุ่ม "เพิ่มเครื่องแบบเดียวกัน" ที่กำลังจะมา
// ทำให้เคสนี้เป็นเรื่องปกติ ไม่ใช่เคสขอบ
//
// เทสสองชั้น: (1) พฤติกรรมของตัว diff (2) อ่าน SOURCE ของ onJobCouponsRevoked
// ว่ายังเรียก revokedCouponLines อยู่ และไม่มี Set ที่ key ด้วย code เปล่าๆ
// กลับมา (รูปเดียวกับ rider-push-payload.test.mjs)
//
// ผล injection — วัดจริง 5 ก.ย. 2569 (commit checkpoint ก่อน แล้วถอดทีละตัว):
//   couponLineKey ทิ้ง device_id (key = code อย่างเดียว)  → แดง 3
//   ไม่ข้ามบรรทัดที่ไม่มี code                             → แดง 1
//   ไม่ uppercase code                                     → แดง 1
//   onJobCouponsRevoked กลับไปสร้าง Set ด้วย code เอง      → แดง 2
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const { revokedCouponLines, couponLineKey } = require("../coupon-revoke-diff.js");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const ride = (deviceId, extra = {}) => ({
  code: "MACBOOK1000", coupon_id: "camp_mac", bucket: "device", value: 1000, device_id: deviceId, ...extra,
});
const twinA = ride("mac_m2_256_1757060000000_0");
const twinB = ride("mac_m2_256_1757060000000_1");
const review = { code: "THX-AB12", coupon_id: "REVIEW_REWARD", bucket: "review", value: 300 };

// ── (1) พฤติกรรม ────────────────────────────────────────────────────────────
{
  const removed = revokedCouponLines([twinA, twinB, review], [twinA, review]);
  check("ลบใบแฝดใบเดียว → คืนบรรทัดนั้นบรรทัดเดียว (เคสที่ diff เดิมพลาด)",
    removed.length === 1 && removed[0].device_id === twinB.device_id);
}
{
  const removed = revokedCouponLines([twinA, twinB, review], [review]);
  check("ลบทั้งสองใบแฝด → คืนสองบรรทัด (quota คืนสองครั้ง เท่ากับที่จองไปสองครั้ง)",
    removed.length === 2);
}
{
  check("ไม่มีอะไรหาย → []", revokedCouponLines([twinA, twinB], [twinB, twinA]).length === 0);
  check("before ว่าง → []", revokedCouponLines(null, [twinA]).length === 0);
  check("after ว่าง → ทุกบรรทัดถูกคืน", revokedCouponLines([twinA, review], null).length === 2);
}
{
  // แถวเก่าก่อนมี bucket: ไม่มี device_id เลย — ต้องได้ผลเหมือน diff เดิมเป๊ะ
  const legacy = { code: "PROMO500", coupon_id: "camp_promo", value: 500 };
  check("บรรทัดเก่าไม่มี device_id ยัง diff ได้ด้วย code", revokedCouponLines([legacy], []).length === 1);
  check("บรรทัดเก่าที่ยังอยู่ไม่ถูกนับว่าหาย", revokedCouponLines([legacy], [{ ...legacy }]).length === 0);
}
{
  // RTDB คืน array เป็น object {0:..,1:..} ได้เมื่อมีรู
  const removed = revokedCouponLines({ 0: twinA, 2: twinB }, { 0: twinA });
  check("รับรูป object ของ RTDB", removed.length === 1 && removed[0] === twinB);
}
{
  check("code เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง",
    revokedCouponLines([{ ...twinA, code: " macbook1000 " }], [twinA]).length === 0);
  check("บรรทัดที่ไม่มี code ไม่ถูกนับว่าหาย (ไม่มีอะไรให้คืน)",
    revokedCouponLines([{ value: 100, device_id: "x" }], []).length === 0);
  check("couponLineKey แยกแฝดด้วย device_id", couponLineKey(twinA) !== couponLineKey(twinB));
}

// ── (2) source ของ trigger ──────────────────────────────────────────────────
{
  const src = readFileSync(join(root, "index.js"), "utf8");
  const start = src.indexOf("exports.onJobCouponsRevoked = onValueWritten(");
  const end = src.indexOf("\n);", start);
  const body = start >= 0 ? src.slice(start, end) : "";
  check("index.js มี onJobCouponsRevoked", body.length > 0);
  check("onJobCouponsRevoked เรียก revokedCouponLines(", body.includes("revokedCouponLines("));
  check("ไม่มี Set ที่ key ด้วย code เปล่าๆ ใน trigger อีก",
    !/new Set\([^)]*\.code/.test(body) && !body.includes("stillThere"));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
