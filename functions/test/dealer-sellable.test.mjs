// dealer-sellable — offline suite. เขียนจากบั๊กจริง: SELLABLE_STATUSES ใน
// dealer-portal.js สะกด 'Ready to Sell' ตัวเดียว → เครื่องที่ engine เขียน
// 'Ready To Sell' (Push to POS ตั้งแต่ #674) ถูกปฏิเสธตอน publish ล็อต ทั้งที่
// หน้า LotManager (#714) เลือกได้แล้ว
//
// INJECTION RESULTS (ทำทีละตัว วัดหลังรัน):
//   1. isSellableStatus เทียบ raw === ไม่ normalize     -> แดง 1 (ทั้งสองสะกด)
//   2. ตัด READY_TO_SELL ออกจาก SELLABLE_CANONICAL       -> แดง 2
//   3. Reserved ผ่านโดยไม่เช็ค lot_id เดียวกัน           -> แดง 1
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { SELLABLE_CANONICAL, isSellableStatus, sellableVerdict } = require(
  path.join(root, "functions/dealer-sellable.js")
);
const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const device = (status, over = {}) => ({ ref_no: "OID-1", type: "B2C Trade-in", status, ...over });

console.log("dealer-sellable");

check("Ready To Sell ทั้งสองสะกดขายเข้าล็อตได้ — ของ engine และแถวเก่า", () => {
  for (const spelling of ["Ready To Sell", "Ready to Sell"]) {
    assert.equal(isSellableStatus(spelling), true, spelling);
    assert.equal(sellableVerdict("J1", device(spelling), null), null, spelling);
  }
});

check("In Stock ขายได้", () => {
  assert.equal(sellableVerdict("J1", device("In Stock"), null), null);
});

check("สถานะปลายทางของ pushed_to_pos ในตาราง engine ผ่านตัวนี้ — ด่านตามตารางจริง", () => {
  assert.equal(isSellableStatus(TRANSITIONS.pushed_to_pos.to), true);
  assert.ok(SELLABLE_CANONICAL.includes(TRANSITIONS.pushed_to_pos.to));
});

check("Reserved ผ่านเฉพาะล็อตที่ล็อกมันไว้เอง", () => {
  assert.equal(sellableVerdict("J1", device("Reserved", { lot_id: "L1" }), "L1"), null);
  const other = sellableVerdict("J1", device("Reserved", { lot_id: "L1" }), "L2");
  assert.equal(other && other.code, "failed-precondition");
  const draft = sellableVerdict("J1", device("Reserved"), "L1");
  assert.equal(draft && draft.code, "failed-precondition", "Reserved ที่ไม่มี lot_id ต้องไม่ผ่าน");
});

check("สถานะที่ไม่ใช่สต๊อกถูกปฏิเสธพร้อมสะกดดิบในข้อความ", () => {
  for (const status of ["Sent To QC Lab", "Sold", "Pending QC", "Paid", ""]) {
    const v = sellableVerdict("J1", device(status), null);
    assert.equal(v && v.code, "failed-precondition", status);
    assert.ok(v.message.includes(`"${status}"`), `ข้อความต้องบอกสถานะที่เห็นจริง: ${v.message}`);
  }
});

check("ชนิดงานที่ไม่ใช่สินค้าสต๊อก / ติดล็อตอื่น / ไม่พบ", () => {
  assert.equal(sellableVerdict("J1", device("In Stock", { type: "B2B Trade-in" }), null).code, "failed-precondition");
  assert.equal(sellableVerdict("J1", device("In Stock", { type: "Withdrawal" }), null).code, "failed-precondition");
  assert.equal(sellableVerdict("J1", device("In Stock", { lot_id: "L9", lot_no: "LOT-9" }), "L1").code, "failed-precondition");
  assert.equal(sellableVerdict("J1", null, null).code, "not-found");
});

if (failures > 0) {
  console.error(`\ndealer-sellable: ${failures} failing`);
  process.exit(1);
}
console.log("dealer-sellable: all passing");
