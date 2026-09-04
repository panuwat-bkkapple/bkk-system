// confirmPayoutTransfer — แกน callable กับ RTDB ปลอมที่ replay transaction ได้
//
// เขียนจากพฤติกรรมที่ payoutTransfer.ts (ไคลเอนต์) ทำอยู่จริงก่อนย้าย ไม่ใช่จาก
// spec: ทุกฟิลด์ที่มันเคยเขียนต้องยังอยู่ (ชื่อฟิลด์ทั้งชุด ไม่ใช่แค่สถานะ) และ
// สิ่งที่ engine เพิ่มให้ (status_version / status_history / paid_at ครั้งเดียว)
// ต้องมาด้วย
//
// INJECTION (วัดจริง 4 ก.ย. 2569 — เขียนหลังรัน ไม่ใช่ก่อน; รวมสองไฟล์
// payout-ledger + payout-transfer):
//   guard ไม่เช็ค paid_at/payment_slip            → แดง 3
//   guard ไม่เทียบยอด (คืน null เสมอ)             → แดง 3
//   actor เป็น ADMIN_STAFF แทน FINANCE             → แดง 8 (ทุกทางที่ผ่านด่านโดน wrong_actor)
//   patch ไม่มี payment_slip                       → แดง 3
//   netPayoutOf ไม่หัก rider_fee_discount          → แดง 9
//   ledger ไม่ถูก gate ด้วยผล transition            → แดง 5
//   payoutGateVerdict ไม่มีขา legacy                → แดง 3
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { __test__ } = require(path.join(root, "functions/payout-transfer.js"));
const { CODE_TO_HTTPS } = require(path.join(root, "functions/status-transition-api.js"));
const { JOB_STATUS, JOB_STATUS_B2B } = require(path.join(root, "functions/status-vocab.generated.js"));
const { JOB_TYPE } = require(path.join(root, "functions/status-engine.js"));
const { PAYOUT_PATCH_FIELDS } = require(path.join(root, "functions/payout-ledger.js"));
const { confirmPayoutTransferCore, validatePayoutInput, FINANCE_ENFORCE_PATH } = __test__;

let failures = 0;
const results = [];
function check(name, fn) {
  results.push(
    Promise.resolve()
      .then(fn)
      .then(() => console.log(`  ok   ${name}`))
      .catch((err) => {
        failures++;
        console.error(`  FAIL ${name}\n       ${err.message}`);
      })
  );
}

console.log("payout-transfer");

const NOW = 1_700_000_999_000;
const TRANSFERRED_AT = 1_700_000_000_000;
const clock = () => NOW;

/**
 * RTDB ปลอม: store แบน key = path. `jobs/{id}` มี transaction ที่ replay เมื่อมีคน
 * เขียนแทรก (mutateOnce) เหมือน status-apply.test.mjs · `transactions` push คืน key
 * เรียงลำดับ · `ref().update()` เขียน multi-path (ล้มได้ด้วย failLedger)
 */
function fakeDb(initial, { mutateOnce = null, failLedger = false } = {}) {
  const store = { ...initial };
  let pendingMutation = mutateOnce;
  let pushes = 0;
  const log = { transactions: 0, updates: [] };
  return {
    store,
    log,
    ref(pathname) {
      if (pathname === undefined) {
        return {
          async update(obj) {
            if (failLedger) throw new Error("ledger down");
            log.updates.push(obj);
            Object.assign(store, obj);
          },
        };
      }
      if (pathname === "transactions") {
        return { push: () => ({ key: `TX${++pushes}` }) };
      }
      return {
        async once() {
          const v = store[pathname];
          return { val: () => (v === undefined ? null : v), exists: () => v !== undefined };
        },
        async transaction(fn) {
          assert.match(pathname, /^jobs\//);
          for (let i = 0; i < 25; i++) {
            log.transactions++;
            const current = store[pathname] === undefined ? null : { ...store[pathname] };
            const proposed = fn(current);
            if (proposed === undefined) return { committed: false, snapshot: { val: () => store[pathname] } };
            if (pendingMutation) {
              store[pathname] = pendingMutation({ ...store[pathname] });
              pendingMutation = null;
              continue;
            }
            store[pathname] = proposed;
            return { committed: true, snapshot: { val: () => store[pathname] } };
          }
          return { committed: false, snapshot: { val: () => store[pathname] } };
        },
      };
    },
  };
}

const finance = { id: "S1", role: "FINANCE", name: "บัญชี A" };
const staff = { id: "S2", role: "STAFF", name: "พนักงาน B" };
const bank = { name: "กสิกร", account: "123-4-56789-0", holder: "สมชาย" };
const input = (over = {}) => ({
  jobId: "J1", slipUrl: "https://storage/slip.jpg", transferredAt: TRANSFERRED_AT, bank, expectedNetPayout: 21500, ...over,
});
const retailJob = (over = {}) => ({
  status: JOB_STATUS.PAYOUT_PROCESSING, receive_method: "Pickup", ref_no: "OID-1", model: "iPhone 15",
  cust_name: "สมชาย (081)", final_price: 22000, pickup_fee: 300, rider_fee_discount: 100,
  applied_coupons: [{ type: "promo", value: 200 }], adjustments: [{ status: "applied", amount: -500 }],
  qc_logs: [{ action: "Payout Processing", by: "x", timestamp: 1 }], ...over,
});
const run = (db, { data, ...rest } = {}) =>
  confirmPayoutTransferCore({ db, who: finance, token: {}, data: input(data), now: clock, ...rest });

check("B2C: Payout Processing → Waiting For Handover (canonical) พร้อมทุกฟิลด์ที่ writer เดิมเขียน + ของที่ engine เพิ่ม", async () => {
  const db = fakeDb({ "jobs/J1": retailJob() });
  const res = await run(db);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.event, "payment_confirmed");
  assert.equal(res.to, JOB_STATUS.WAITING_FOR_HANDOVER);
  assert.equal(res.netPayout, 21500);
  assert.equal(res.ledgerWritten, true);

  const job = db.store["jobs/J1"];
  assert.equal(job.status, "Waiting For Handover", "สะกด canonical ไม่ใช่ 'Waiting for Handover'");
  assert.equal(job.paid_at, NOW, "paid_at = เวลาที่บันทึก ไม่ใช่เวลาโอน");
  assert.equal(job.transferred_at, TRANSFERRED_AT);
  assert.equal(job.paid_by, "บัญชี A");
  assert.equal(job.payment_slip, "https://storage/slip.jpg");
  assert.equal(job.bank_name, "กสิกร");
  assert.equal(job.bank_account, "123-4-56789-0");
  assert.equal(job.bank_holder, "สมชาย");
  for (const f of PAYOUT_PATCH_FIELDS) assert.ok(job[f] !== undefined, `patch field ${f} missing`);
  assert.equal(job.updated_at, NOW);
  assert.equal(job.status_version, 1);
  assert.equal(job.status_history.at(-1).event, "payment_confirmed");
  assert.equal(job.status_history.at(-1).actor, "finance");
  assert.equal(job.status_history.at(-1).by, "finance:S1");
  // qc_logs: แถวใหม่อยู่หัว action = สถานะปลายทาง (engine) details = ข้อความเดิม
  assert.equal(job.qc_logs.length, 2);
  assert.equal(job.qc_logs[0].action, "Waiting For Handover");
  assert.equal(job.qc_logs[0].by, "บัญชี A");
  assert.match(job.qc_logs[0].details, /ฝ่ายบัญชีโอนเงินสำเร็จ ยอดสุทธิ ฿21,500 เข้าบัญชี กสิกร \(123-4-56789-0\)/);
});

check("B2C Pickup: ledger สองแถว — DEBIT ยอดสุทธิ + CREDIT ค่าส่งที่เก็บจริง ทั้งคู่ SYSTEM ที่เวลาโอนจริง", async () => {
  const db = fakeDb({ "jobs/J1": retailJob() });
  const res = await run(db);
  assert.equal(res.debitKey, "TX1");
  assert.equal(res.creditKey, "TX2");
  assert.equal(db.log.updates.length, 1, "ledger เป็น multi-path update ก้อนเดียว");
  const debit = db.store["transactions/TX1"];
  assert.deepEqual(debit, {
    rider_id: "SYSTEM", amount: 21500, type: "DEBIT", category: "TRADE_IN_PAYOUT",
    description: "จ่ายเงินรับซื้อสุทธิ iPhone 15 (สมชาย )", timestamp: TRANSFERRED_AT, ref_job_id: "J1",
    slip_url: "https://storage/slip.jpg",
  });
  const credit = db.store["transactions/TX2"];
  assert.equal(credit.category, "LOGISTICS_REVENUE");
  assert.equal(credit.amount, 200, "pickup_fee 300 - rider_fee_discount 100");
  assert.equal(credit.rider_id, "SYSTEM");
  assert.equal(credit.timestamp, TRANSFERRED_AT);
  assert.equal(credit.ref_job_id, "J1");
});

check("B2C Store-in จาก Price Accepted (ทางจ่ายตรงจากเว็บ): ผ่าน และไม่มีแถว CREDIT", async () => {
  const db = fakeDb({ "jobs/J1": retailJob({ status: JOB_STATUS.PRICE_ACCEPTED, receive_method: "Store-in", pickup_fee: 0 }) });
  const res = await run(db, { data: { expectedNetPayout: 22000 + 200 - 500 } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.creditKey, null);
  assert.equal(db.store["transactions/TX2"], undefined);
  assert.equal(db.store["jobs/J1"].status, JOB_STATUS.WAITING_FOR_HANDOVER);
});

check("B2B: Pending Finance Approval → Paid ผ่าน b2b_payment_confirmed หมวด B2B_PURCHASE และ paid_at ไม่ถูกประทับที่นี่ (trigger ทำ)", async () => {
  const lot = { status: JOB_STATUS_B2B.PENDING_FINANCE_APPROVAL, type: JOB_TYPE.B2B, ref_no: "B2B-1", model: "ล็อต 20 เครื่อง", cust_name: "บจก. X (คุณ Y)", price: 300000 };
  const db = fakeDb({ "jobs/J1": lot });
  const res = await run(db, { data: { expectedNetPayout: 300000 } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.event, "b2b_payment_confirmed");
  assert.equal(res.to, JOB_STATUS.PAID);
  const job = db.store["jobs/J1"];
  assert.equal(job.status, "Paid", "ไม่ใช่ 'Payment Completed'");
  assert.equal(job.paid_at, undefined, "registry ให้ payment_confirmed ประทับตัวเดียว — ขา B2B มาจาก onAdminJobStatusNotify");
  assert.equal(job.payment_slip, "https://storage/slip.jpg");
  assert.equal(job.qc_logs[0].action, "Paid");
  assert.equal(db.store["transactions/TX1"].category, "B2B_PURCHASE");
  assert.equal(db.store["transactions/TX1"].amount, 300000);
  assert.equal(res.creditKey, null);
});

check("จ่ายซ้ำ: งานที่มี paid_at แล้ว → already_paid ไม่มีอะไรถูกเขียน", async () => {
  const db = fakeDb({ "jobs/J1": retailJob({ paid_at: 5 }) });
  const before = JSON.stringify(db.store);
  const res = await run(db);
  assert.equal(res.ok, false);
  assert.equal(res.code, "already_paid");
  assert.equal(JSON.stringify(db.store), before);
  assert.equal(db.log.updates.length, 0, "ledger ต้องไม่ถูกเขียนเมื่อ transition ถูกปฏิเสธ");
});

check("จ่ายซ้ำ: งานที่มี payment_slip แล้ว (แถวเก่าไม่มี paid_at) → already_paid", async () => {
  const db = fakeDb({ "jobs/J1": retailJob({ payment_slip: "https://old" }) });
  const res = await run(db);
  assert.equal(res.code, "already_paid");
  assert.equal(db.log.updates.length, 0);
});

check("ยอดเปลี่ยน: คนกดเห็น 21,500 แต่แถวจริงเป็น 20,000 → amount_changed ไม่มีอะไรถูกเขียน", async () => {
  const db = fakeDb({ "jobs/J1": retailJob({ final_price: 20500 }) });
  const before = JSON.stringify(db.store);
  const res = await run(db);
  assert.equal(res.code, "amount_changed");
  assert.match(res.message, /21,500/);
  assert.equal(JSON.stringify(db.store), before);
  assert.equal(db.log.updates.length, 0);
});

check("ยอดเปลี่ยนระหว่างธุรกรรม (คนอื่นแก้ราคาแทรก): replay จับได้ — guard ตัดสินจากแถวในธุรกรรม ไม่ใช่แถวที่อ่านก่อน", async () => {
  const db = fakeDb({ "jobs/J1": retailJob() }, { mutateOnce: (j) => ({ ...j, final_price: 19000 }) });
  const res = await run(db);
  assert.equal(res.code, "amount_changed");
  assert.equal(db.store["jobs/J1"].status, JOB_STATUS.PAYOUT_PROCESSING);
  assert.equal(db.log.updates.length, 0);
  assert.ok(db.log.transactions >= 2, "ต้องมีรอบ replay");
});

check("สถานะที่จ่ายไม่ได้ (New Lead) → illegal_from จาก engine", async () => {
  const db = fakeDb({ "jobs/J1": retailJob({ status: JOB_STATUS.NEW_LEAD }) });
  const res = await run(db, { data: { expectedNetPayout: 21500 } });
  assert.equal(res.code, "illegal_from");
  assert.equal(db.log.updates.length, 0);
});

check("ไม่พบงาน → job_not_found", async () => {
  const res = await run(fakeDb({}));
  assert.equal(res.code, "job_not_found");
});

check("ด่านสิทธิ์: STAFF ไม่มี claim + enforce เปิด → not_finance (ก่อนอ่านงาน)", async () => {
  const db = fakeDb({ "jobs/J1": retailJob(), [FINANCE_ENFORCE_PATH]: true });
  const res = await run(db, { who: staff });
  assert.equal(res.code, "not_finance");
  assert.equal(db.store["jobs/J1"].status, JOB_STATUS.PAYOUT_PROCESSING);
});

check("ด่านสิทธิ์: STAFF ขณะ enforce ยังปิด = legacy ผ่าน (ตรงกับหน้าจอวันนี้); มี claim ผ่านแม้ enforce เปิด", async () => {
  const legacy = await run(fakeDb({ "jobs/J1": retailJob() }), { who: staff });
  assert.equal(legacy.ok, true, JSON.stringify(legacy));
  const claimed = await run(fakeDb({ "jobs/J1": retailJob(), [FINANCE_ENFORCE_PATH]: true }), { who: staff, token: { finance_disburse: true } });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.to, JOB_STATUS.WAITING_FOR_HANDOVER);
});

check("actor ที่ engine เห็นคือ finance เสมอเมื่อผ่านด่าน — ไม่ใช่ role ดิบ (ไม่งั้น MANAGER โดน wrong_actor)", async () => {
  const db = fakeDb({ "jobs/J1": retailJob() });
  const res = await run(db, { who: { id: "M1", role: "MANAGER", name: "ผู้จัดการ" } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(db.store["jobs/J1"].status_history.at(-1).actor, "finance");
  assert.equal(db.store["jobs/J1"].status_history.at(-1).by, "finance:M1");
});

check("ledger ล้ม: สถานะเปลี่ยนไปแล้ว ผลลัพธ์ยัง ok แต่ ledgerWritten=false (Finance.tsx จับ orphan ต่อ)", async () => {
  const db = fakeDb({ "jobs/J1": retailJob() }, { failLedger: true });
  const res = await run(db);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.ledgerWritten, false);
  assert.equal(res.debitKey, "TX1");
  assert.equal(db.store["jobs/J1"].status, JOB_STATUS.WAITING_FOR_HANDOVER);
  assert.equal(db.store["transactions/TX1"], undefined);
});

check("ledger เขียนหลัง transition เท่านั้น — ถ้า transition ถูกปฏิเสธ ledger ไม่มีทางถูกแตะ (ทุกทางปฏิเสธข้างบนยืนยัน updates=0)", async () => {
  // ทาง input ผิด: ยังไม่ถึง DB เลย
  const db = fakeDb({ "jobs/J1": retailJob() });
  const res = await run(db, { data: { transferredAt: NOW + 120_000 } });
  assert.equal(res.code, "invalid_input");
  assert.equal(db.log.transactions, 0);
  assert.equal(db.log.updates.length, 0);
});

check("validatePayoutInput: รูปที่หน้าจอเคยเช็คเอง ต้องถูกเช็คที่นี่ด้วย", () => {
  const ok = validatePayoutInput(input(), NOW);
  assert.equal(ok.ok, true);
  assert.equal(validatePayoutInput(input({ jobId: "" }), NOW).code, "invalid_input");
  assert.equal(validatePayoutInput(input({ slipUrl: "" }), NOW).code, "invalid_input");
  assert.equal(validatePayoutInput(input({ slipUrl: "http://insecure" }), NOW).code, "invalid_input");
  assert.equal(validatePayoutInput(input({ transferredAt: "abc" }), NOW).code, "invalid_input");
  assert.equal(validatePayoutInput(input({ transferredAt: NOW + 59_000 }), NOW).ok, true, "นาฬิกาเพี้ยน 1 นาทีให้ผ่าน");
  assert.equal(validatePayoutInput(input({ bank: { name: "กสิกร", account: "", holder: "x" } }), NOW).code, "invalid_input");
  assert.equal(validatePayoutInput(input({ expectedNetPayout: -1 }), NOW).code, "invalid_input");
  assert.equal(validatePayoutInput(input({ expectedNetPayout: "22000" }), NOW).value.expectedNetPayout, 22000);
  assert.equal(validatePayoutInput(null, NOW).code, "invalid_input");
});

check("ทุกรหัสที่ callable นี้คืนได้มี HttpsError mapping และ 'ห้าม' กับ 'ลองใหม่' ไม่ปนกัน", () => {
  for (const code of ["invalid_input", "not_finance", "job_not_found", "already_paid", "amount_changed", "illegal_from", "wrong_actor", "write_contended"]) {
    assert.ok(CODE_TO_HTTPS[code], `no mapping for ${code}`);
  }
  assert.equal(CODE_TO_HTTPS.not_finance, "permission-denied");
  assert.equal(CODE_TO_HTTPS.amount_changed, "failed-precondition");
  assert.equal(CODE_TO_HTTPS.invalid_input, "invalid-argument");
});

Promise.all(results).then(() => {
  if (failures) {
    console.error(`payout-transfer: ${failures} failing`);
    process.exit(1);
  }
  console.log("payout-transfer: all passing");
});
