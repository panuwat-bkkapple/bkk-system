// payout-ledger — ส่วน pure ของ confirmPayoutTransfer (สูตรยอดโอน, แถว ledger,
// ด่านสิทธิ์, guard ในธุรกรรม). สูตรฝั่งแอดมินถูกเทียบกับไฟล์นี้อีกทางที่
// src/utils/payoutNet.test.ts — ที่นี่ตรึงพฤติกรรมของสำเนา server เอง
//
// INJECTION (วัดจริง — เขียนหลังรัน): ดูท้ายไฟล์ payout-transfer.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const L = require(path.join(root, "functions/payout-ledger.js"));
const { JOB_TYPE } = require(path.join(root, "functions/status-engine.js"));

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

console.log("payout-ledger");

check("netPayoutOf: Pickup หัก (pickup_fee - rider_fee_discount) บวกคูปองที่มีตัวเงิน + adjustments ที่ applied เท่านั้น", () => {
  const job = {
    final_price: 22000, price: 25000, receive_method: "Pickup", pickup_fee: 300, rider_fee_discount: 100,
    applied_coupons: [{ type: "promo", value: 200 }, { type: "service", value: 300 }],
    adjustments: [{ status: "applied", amount: -500 }, { status: "pending", amount: -999 }],
  };
  assert.equal(L.netPayoutOf(job), 22000 - 200 + 200 - 500);
});

check("netPayoutOf: final_price มาก่อน price; ไม่ใช่ Pickup ไม่หักค่าส่งแม้มี pickup_fee", () => {
  assert.equal(L.netPayoutOf({ final_price: 10000, price: 12000, receive_method: "Store-in", pickup_fee: 300 }), 10000);
  assert.equal(L.netPayoutOf({ price: 12000, receive_method: "Mail-in", pickup_fee: 300 }), 12000);
});

check("netPayoutOf: ส่วนลดค่าไรเดอร์เกินค่าส่งไม่กลายเป็นเงินบวก และยอดรวมไม่ติดลบ", () => {
  assert.equal(L.netPayoutOf({ final_price: 5000, receive_method: "Pickup", pickup_fee: 100, rider_fee_discount: 900 }), 5000);
  assert.equal(L.netPayoutOf({ final_price: 100, receive_method: "Pickup", pickup_fee: 300 }), 0);
  assert.equal(L.netPayoutOf(null), 0);
});

check("netPayoutOf: คูปองใช้ actual_value ก่อน value และ applied_coupon เดี่ยวเป็น fallback เท่านั้น", () => {
  assert.equal(L.netPayoutOf({ final_price: 1000, applied_coupons: [{ value: 100, actual_value: 60 }], applied_coupon: { value: 999 } }), 1060);
  assert.equal(L.netPayoutOf({ final_price: 1000, applied_coupon: { value: 50 } }), 1050);
});

check("effectiveCustomerPickupFee: 0 เมื่อไม่ใช่ Pickup / ส่งฟรี / ส่วนลดกลบหมด", () => {
  assert.equal(L.effectiveCustomerPickupFee({ receive_method: "Pickup", pickup_fee: 300, rider_fee_discount: 100 }), 200);
  assert.equal(L.effectiveCustomerPickupFee({ receive_method: "Store-in", pickup_fee: 300 }), 0);
  assert.equal(L.effectiveCustomerPickupFee({ receive_method: "Pickup", pickup_fee: 300, applied_coupons: [{ type: "service" }] }), 0);
  assert.equal(L.effectiveCustomerPickupFee({ receive_method: "Pickup", pickup_fee: 300, rider_fee_discount: 300 }), 0);
});

check("buildLogisticsRevenueTx: แถว CREDIT ของ SYSTEM ที่เวลาโอนจริง — null เมื่อไม่มีค่าส่งให้บันทึก", () => {
  const tx = L.buildLogisticsRevenueTx({ id: "J1", ref_no: "OID-1", receive_method: "Pickup", pickup_fee: 300 }, 1_700_000_000_000);
  assert.deepEqual(tx, {
    rider_id: "SYSTEM", amount: 300, type: "CREDIT", category: "LOGISTICS_REVENUE",
    description: "รายได้ค่าบริการรับเครื่อง (ค่าส่งที่เก็บจากลูกค้า) - Ref: OID-1",
    timestamp: 1_700_000_000_000, ref_job_id: "J1",
  });
  assert.equal(L.buildLogisticsRevenueTx({ id: "J1", receive_method: "Store-in" }, 1), null);
  assert.equal(L.buildLogisticsRevenueTx({ receive_method: "Pickup", pickup_fee: 300 }, 1), null, "no id = no row");
  assert.match(L.buildLogisticsRevenueTx({ id: "J1", receive_method: "Pickup", pickup_fee: 1 }, 1, { repair: true }).description, /^\[ซ่อม\] /);
});

check("buildPayoutDebitTx: หมวดตามสาย (B2B_PURCHASE / TRADE_IN_PAYOUT) เวลา = เวลาโอนจริง rider_id = SYSTEM", () => {
  const base = { id: "J1", model: "iPhone 15", cust_name: "สมชาย (081)" };
  const retail = L.buildPayoutDebitTx({ job: base, netPayout: 22000, transferredAt: 5, slipUrl: "https://s/x.jpg" });
  assert.deepEqual(retail, {
    rider_id: "SYSTEM", amount: 22000, type: "DEBIT", category: "TRADE_IN_PAYOUT",
    description: "จ่ายเงินรับซื้อสุทธิ iPhone 15 (สมชาย )", timestamp: 5, ref_job_id: "J1", slip_url: "https://s/x.jpg",
  });
  for (const type of [JOB_TYPE.B2B, JOB_TYPE.B2B_SHORT]) {
    assert.equal(L.buildPayoutDebitTx({ job: { ...base, type }, netPayout: 1, transferredAt: 1, slipUrl: "https://s" }).category, "B2B_PURCHASE", type);
  }
});

check("buildPayoutPatch: ครบ 6 ฟิลด์ที่มีคนอ่าน ไม่มีฟิลด์ของ engine", () => {
  const patch = L.buildPayoutPatch({ transferredAt: 7, paidBy: "บัญชี A", slipUrl: "https://s", bank: { name: "กสิกร", account: "123", holder: "สมชาย" } });
  assert.deepEqual(Object.keys(patch).sort(), [...L.PAYOUT_PATCH_FIELDS].sort());
  assert.deepEqual(patch, { transferred_at: 7, paid_by: "บัญชี A", payment_slip: "https://s", bank_name: "กสิกร", bank_account: "123", bank_holder: "สมชาย" });
  for (const k of ["status", "paid_at", "qc_logs", "status_version"]) assert.ok(!(k in patch), k);
});

check("payoutLogDetails: ข้อความเดิมของ payoutTransfer.ts (ยอด บัญชี เวลาไทย)", () => {
  const s = L.payoutLogDetails({ netPayout: 22000, bank: { name: "กสิกร", account: "123-4" }, transferredAt: Date.UTC(2023, 10, 14, 22, 13) });
  assert.equal(s, "ฝ่ายบัญชีโอนเงินสำเร็จ ยอดสุทธิ ฿22,000 เข้าบัญชี กสิกร (123-4) เมื่อ 15 พ.ย. 66 05:13");
});

check("payoutGateVerdict: ลำดับเดียวกับ evaluateFinanceGate — CEO เสมอ, claim, FINANCE, legacy เมื่อยังไม่ enforce", () => {
  assert.deepEqual(L.payoutGateVerdict({ role: "CEO", hasClaim: false, enforce: true }), { allowed: true, reason: "ceo" });
  assert.deepEqual(L.payoutGateVerdict({ role: "STAFF", hasClaim: true, enforce: true }), { allowed: true, reason: "claim" });
  assert.deepEqual(L.payoutGateVerdict({ role: "finance", hasClaim: false, enforce: true }), { allowed: true, reason: "finance_role" });
  assert.deepEqual(L.payoutGateVerdict({ role: "MANAGER", hasClaim: false, enforce: false }), { allowed: true, reason: "legacy_admin" });
  assert.deepEqual(L.payoutGateVerdict({ role: "STAFF", hasClaim: false, enforce: true }), { allowed: false, reason: "no_claim" });
  assert.deepEqual(L.payoutGateVerdict({ role: "", hasClaim: false, enforce: true }), { allowed: false, reason: "no_claim" });
});

check("payoutGuard: จ่ายซ้ำถูกปฏิเสธจาก paid_at หรือ payment_slip ตัวใดตัวหนึ่ง", () => {
  const g = L.payoutGuard({ expectedNetPayout: 100, seen: {} });
  assert.equal(g({ final_price: 100, paid_at: 1 }).code, "already_paid");
  assert.equal(g({ final_price: 100, payment_slip: "https://s" }).code, "already_paid");
  assert.equal(g({ final_price: 100 }), null);
});

check("payoutGuard: ยอดจริงในธุรกรรมไม่เท่าที่คนกดเห็น = amount_changed และเลขจริงถูกส่งออกทาง seen", () => {
  const seen = {};
  const g = L.payoutGuard({ expectedNetPayout: 22000, seen });
  const refused = g({ final_price: 21000 });
  assert.equal(refused.code, "amount_changed");
  assert.match(refused.message, /22,000/);
  assert.match(refused.message, /21,000/);
  assert.equal(seen.net, 21000);
  assert.equal(g({ final_price: 22000.4 }), null, "ต่างกันแค่เศษสตางค์ไม่นับ");
  assert.equal(seen.net, 22000.4);
});

check("isB2BPayout: ตามชุด jobTypes ของ engine ไม่ใช่สะกดเดียว", () => {
  assert.equal(L.isB2BPayout({ type: JOB_TYPE.B2B }), true);
  assert.equal(L.isB2BPayout({ type: JOB_TYPE.B2B_SHORT }), true);
  assert.equal(L.isB2BPayout({ type: "Accessory" }), false);
  assert.equal(L.isB2BPayout({}), false);
});

if (failures) {
  console.error(`payout-ledger: ${failures} failing`);
  process.exit(1);
}
console.log("payout-ledger: all passing");
