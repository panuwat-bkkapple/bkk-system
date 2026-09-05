// b2c-unpack — offline suite for the pure halves.
//
// The callable/trigger need a database; what is testable without one is every
// decision made BEFORE a write, plus the exact shape of the child rows — which
// is what the QC station, the inventory page, the finance orphan counter and
// the customer's order history all read afterwards. The last two are why the
// "what the child must NOT carry" checks exist: a uid on a child puts a phantom
// order in the customer's history, a paid_at on a child makes Finance count a
// payout that never happened.
//
// INJECTION RESULTS — each applied alone (checkpoint committed first), then
// restored. Counts are red checks in THIS file unless noted:
//   see the table at the bottom of the file (filled in after measuring)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mod = require(path.join(root, "functions/b2c-unpack.js"));
const {
  CHILD_TYPE, STOCK_CHILD_TYPES, ENTRY_STATUSES,
  devicesOf, isMultiDeviceRetailJob, isEntryStatus, checkUnpackable, paidEvidenceOf,
  buildDeviceChildren, buildAccessoryChildUpdates, buildUnpackUpdates, buildClaimStamp, accessoryKeyCount,
} = mod;
const { JOB_STATUS } = require(path.join(root, "functions/status-vocab.generated.js"));

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

// A two-device Pickup order after the rider's inspection and the payout —
// the state the job is in when it reaches Pending QC.
const device = (over = {}) => ({
  device_id: "m1_256GB_1_0",
  model_id: "m1",
  model: "iPhone 15 Pro 256GB",
  variant: "256GB",
  capacity: "256GB",
  imageUrl: "https://img/iphone15pro.png",
  base_price: 30000,
  estimated_price: 29000,
  price: 28500,
  isNewDevice: false,
  customer_conditions: [{ title: "จอ", value: "ปกติ" }],
  photos: ["https://storage/a.jpg"],
  deductions: [{ label: "รอยขีดข่วน", amount: -500 }],
  inspection_status: "Inspected",
  device_imei: "35000abc",
  device_serial: "SN-1",
  battery_health_pct: 91,
  battery_cycle_count: 120,
  find_my_status: "off",
  find_my_manual: false,
  warranty_status: "expired",
  ...over,
});

const parent = (over = {}) => ({
  ref_no: "OID-ABC123",
  type: "Trade-in",
  status: "Pending QC",
  receive_method: "Pickup",
  uid: "customer-uid",
  cust_name: "สมชาย ใจดี",
  cust_phone: "0812345678",
  cust_email: "somchai@example.com",
  cust_address: "123 ถนนสุขุมวิท",
  cust_lat: 13.7,
  cust_lng: 100.5,
  agent_name: "Admin A",
  price: 57000,
  final_price: 57000,
  net_payout: 56500,
  pickup_fee: 500,
  paid_at: 1_800_000_000_000,
  applied_coupons: [{ code: "PROMO", value: 300 }],
  adjustments: [{ id: "adj1", amount: -200, status: "applied" }],
  sickw_check: { last_check: { imei: "35000ABC", parsed: { model: "iPhone 15 Pro" } } },
  devices: [device(), device({ device_id: "m1_256GB_1_1", device_imei: "35000def", device_serial: "SN-2", price: 28000 })],
  ...over,
});

console.log("b2c-unpack");

// ── Which jobs this is for ──────────────────────────────────────────────────

check("devices[] reads both the array and the object shape RTDB hands back", () => {
  assert.equal(devicesOf({ devices: [device(), device()] }).length, 2);
  assert.equal(devicesOf({ devices: { 0: device(), 2: device() } }).length, 2);
  assert.equal(devicesOf({}).length, 0);
});

check("only a retail job with two or more devices qualifies", () => {
  assert.ok(isMultiDeviceRetailJob(parent()));
  assert.equal(isMultiDeviceRetailJob(parent({ devices: [device()] })), false, "one device = nothing to split");
  assert.equal(isMultiDeviceRetailJob(parent({ type: "B2B Trade-in" })), false, "a lot has its own unpack");
  assert.equal(isMultiDeviceRetailJob(parent({ type: "B2B" })), false);
  for (const t of STOCK_CHILD_TYPES) {
    assert.equal(isMultiDeviceRetailJob(parent({ type: t })), false, `${t} is already a stock row`);
  }
  assert.ok(isMultiDeviceRetailJob(parent({ type: undefined })), "legacy rows carry no type and are retail");
});

check("entry statuses: the three 'device is at the shop' statuses, any spelling", () => {
  assert.deepEqual([...ENTRY_STATUSES].sort(), [JOB_STATUS.IN_STOCK, JOB_STATUS.PENDING_QC, JOB_STATUS.SENT_TO_QC_LAB].sort());
  assert.ok(isEntryStatus("Pending QC"));
  assert.ok(isEntryStatus("Sent to QC Lab"), "legacy spelling the old writer produced");
  assert.ok(isEntryStatus("In Stock"));
  assert.equal(isEntryStatus("Paid"), false, "Paid = still with the rider");
  assert.equal(isEntryStatus("Completed"), false);
  assert.equal(isEntryStatus(null), false);
});

check("checkUnpackable: the refusals, in the order the run asks them", () => {
  assert.equal(checkUnpackable(null).code, "not-found");
  assert.equal(checkUnpackable(parent({ devices: [device()] })).code, "failed-precondition");
  assert.equal(checkUnpackable(parent({ status: "Paid" })).code, "failed-precondition", "not at the shop yet");
  assert.equal(checkUnpackable(parent({ status: "Waiting For Handover" })).code, "failed-precondition");
  assert.equal(
    checkUnpackable(parent({ status: "Completed", multi_unpack: { written: true } })).code,
    "already-exists",
    "a finished run is reported as done, not re-run"
  );
  assert.equal(checkUnpackable(parent()), null);
  assert.equal(checkUnpackable(parent({ status: "In Stock" })), null, "store-in admin pressed In Stock directly");
  assert.equal(checkUnpackable(parent({ status: "Sent to QC Lab" })), null);
});

check("checkUnpackable: a half-finished run (stamp but parent still open) may resume", () => {
  assert.equal(checkUnpackable(parent({ multi_unpack: { written: true } })), null);
  assert.equal(checkUnpackable(parent({ multi_unpack: { written: false } })), null);
});

// ── Child rows ──────────────────────────────────────────────────────────────

const NOW = 1_800_000_500_000;
const keys = ["k1", "k2"];
const childrenOf = (job) => buildDeviceChildren({ job, jobId: "job-1", keys, now: NOW, by: "system:test" });

check("one child per device, numbered -D1/-D2, entering the retail flow at Pending QC", () => {
  const out = childrenOf(parent());
  assert.deepEqual(Object.keys(out), ["jobs/k1", "jobs/k2"]);
  const c1 = out["jobs/k1"];
  const c2 = out["jobs/k2"];
  assert.equal(c1.ref_no, "OID-ABC123-D1");
  assert.equal(c2.ref_no, "OID-ABC123-D2");
  assert.equal(c1.type, CHILD_TYPE);
  assert.equal(c1.status, JOB_STATUS.PENDING_QC);
  assert.equal(c1.parent_job_id, "job-1");
  assert.equal(c1.parent_ref_no, "OID-ABC123");
  assert.equal(c1.device_index, 0);
  assert.equal(c2.device_index, 1);
  assert.equal(c1.receive_method, "Pickup");
  assert.equal(c1.cust_name, "สมชาย ใจดี");
});

check("price = this device's post-inspection price, not the order total", () => {
  const out = childrenOf(parent());
  assert.equal(out["jobs/k1"].price, 28500);
  assert.equal(out["jobs/k1"].final_price, 28500);
  assert.equal(out["jobs/k2"].price, 28000);
  // never the parent's 57000
  assert.notEqual(out["jobs/k1"].price, 57000);
  // a device the rider has not repriced falls back to the quote
  const quoted = childrenOf(parent({ devices: [device({ price: undefined, estimated_price: 29000 }), device()] }));
  assert.equal(quoted["jobs/k1"].price, 29000);
});

check("the device's own inspection data rides along under the names both readers use", () => {
  const c1 = childrenOf(parent())["jobs/k1"];
  assert.equal(c1.imei, "35000ABC", "job-level imei (QC station, SickW gate) — upper-cased");
  assert.equal(c1.device_imei, "35000ABC", "rider-written name");
  assert.equal(c1.serial, "SN-1");
  assert.equal(c1.device_serial, "SN-1");
  assert.equal(c1.battery_health_pct, 91);
  assert.equal(c1.battery_health, 91, "QC form prefill reads battery_health");
  assert.equal(c1.find_my_status, "off");
  assert.deepEqual(c1.photos, ["https://storage/a.jpg"]);
  assert.deepEqual(c1.deductions, [{ label: "รอยขีดข่วน", amount: -500 }]);
  assert.deepEqual(c1.customer_conditions, [{ title: "จอ", value: "ปกติ" }]);
  assert.equal(c1.model, "iPhone 15 Pro 256GB");
  assert.equal(c1.imageUrl, "https://img/iphone15pro.png");
});

check("sickw_check goes only to the child whose IMEI it was run for", () => {
  const out = childrenOf(parent());
  assert.ok(out["jobs/k1"].sickw_check, "first device's IMEI matches last_check");
  assert.equal(out["jobs/k2"].sickw_check, undefined);
});

const ORDER_ONLY_KEYS = [
  "uid", "cust_phone", "cust_email", "cust_address", "cust_lat", "cust_lng",
  "net_payout", "pickup_fee", "paid_at", "applied_coupons", "applied_coupon", "adjustments",
  "assessment_codes", "price_locked_amount", "price_locked_until", "rider_id", "rider_fee", "rider_fee_estimate",
  "payment_slip", "payment_voucher", "tax_invoice", "customer_offer", "devices", "accessory_items",
];

check("a child carries nothing that belongs to the ORDER: no identity, no money", () => {
  const out = childrenOf(parent());
  for (const row of Object.values(out)) {
    for (const key of ORDER_ONLY_KEYS) {
      assert.equal(key in row, false, `${key} leaked onto ${row.ref_no}`);
    }
  }
});

check("no undefined anywhere in the multi-path — RTDB rejects the whole write on one", () => {
  const sparse = device({ variant: undefined, color: undefined, photos: undefined, battery_health_pct: undefined, warranty_status: undefined });
  const out = buildUnpackUpdates({
    job: parent({ devices: [sparse, device()], accessory_items: [{ id: "a", model_id: "a", model_name: "Apple Pencil", price: 2000 }] }),
    jobId: "job-1",
    stamp: { child_ids: keys, accessory_child_ids: ["a1"], written: false },
    now: NOW,
    by: "system:test",
  });
  const walk = (v, at) => {
    assert.notEqual(v, undefined, `undefined at ${at}`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  walk(out, "updates");
});

// ── The paid trail ──────────────────────────────────────────────────────────

check("paidEvidenceOf: paid_at first, then the timeline (legacy spelling too), else null", () => {
  assert.equal(paidEvidenceOf(parent()), 1_800_000_000_000);
  assert.equal(
    paidEvidenceOf(parent({ paid_at: null, qc_logs: [{ action: "Waiting for Handover", timestamp: 42 }] })),
    42
  );
  assert.equal(paidEvidenceOf(parent({ paid_at: null, qc_logs: [{ action: "Paid", timestamp: 43 }] })), 43);
  assert.equal(paidEvidenceOf(parent({ paid_at: null, qc_logs: [{ action: "Rider Accepted", timestamp: 1 }] })), null);
});

check("a child's timeline says it was paid (via the parent) BEFORE it says it was unpacked", () => {
  const c1 = childrenOf(parent())["jobs/k1"];
  assert.equal(c1.qc_logs.length, 2);
  assert.equal(c1.qc_logs[0].action, JOB_STATUS.PAID, "paidTrail.ts reads this as 'already paid' — no second payout offered");
  assert.equal(c1.qc_logs[0].timestamp, 1_800_000_000_000);
  assert.match(c1.qc_logs[0].details, /OID-ABC123/);
  assert.equal(c1.qc_logs[1].action, "Device Unpacked");
  assert.match(c1.qc_logs[1].details, /เครื่องที่ 1\/2/);
  assert.equal("paid_at" in c1, false, "the stamp itself stays on the parent — Finance counts paid_at rows");
});

check("no paid evidence on the parent = no Paid row invented on the child", () => {
  const c1 = childrenOf(parent({ paid_at: null, qc_logs: [] }))["jobs/k1"];
  assert.equal(c1.qc_logs.length, 1);
  assert.equal(c1.qc_logs[0].action, "Device Unpacked");
});

// ── Accessories ─────────────────────────────────────────────────────────────

const withAccessory = (over = {}) => parent({
  accessory_items: [{ id: "acc1", model_id: "acc1", model_name: "Apple Pencil Pro", price: 2000, serial: "AP-1" }],
  price: 59000,
  final_price: 59000,
  ...over,
});

check("accessory rows mirror the client helper: -A1, In Stock, parent stamped", () => {
  const job = { ...withAccessory(), id: "job-1" };
  const out = buildAccessoryChildUpdates(job, ["a1"], "system:test", NOW);
  const a = out["jobs/a1"];
  assert.equal(a.ref_no, "OID-ABC123-A1");
  assert.equal(a.type, "Accessory");
  assert.equal(a.status, JOB_STATUS.IN_STOCK);
  assert.equal(a.price, 2000);
  assert.equal(a.serial, "AP-1");
  assert.equal(a.parent_job_id, "job-1");
  assert.equal(out["jobs/job-1/accessories_unpacked_at"], NOW);
  assert.equal(out["jobs/job-1/stock_cost"], 57000);
  assert.equal(accessoryKeyCount(withAccessory()), 1);
});

check("accessories already unpacked by the client helper are left alone", () => {
  const job = { ...withAccessory({ accessories_unpacked_at: 1 }), id: "job-1" };
  assert.deepEqual(buildAccessoryChildUpdates(job, ["a1"], "system:test", NOW), {});
  assert.equal(accessoryKeyCount(withAccessory({ accessories_unpacked_at: 1 })), 0);
  assert.equal(accessoryKeyCount(parent()), 0, "no accessories = no keys to reserve");
});

// ── The stamp and the multi-path ────────────────────────────────────────────

check("claim stamp: keys reserved, refs precomputed, written=false until step 2", () => {
  const stamp = buildClaimStamp({ job: parent(), jobId: "job-1", keys, accessoryKeys: [], now: NOW, by: "system:test" });
  assert.deepEqual(stamp.child_ids, keys);
  assert.deepEqual(stamp.child_refs, ["OID-ABC123-D1", "OID-ABC123-D2"]);
  assert.equal(stamp.count, 2);
  assert.equal(stamp.written, false);
  assert.equal("accessory_child_ids" in stamp, false);
  const withAcc = buildClaimStamp({ job: withAccessory(), jobId: "job-1", keys, accessoryKeys: ["a1"], now: NOW, by: "x" });
  assert.deepEqual(withAcc.accessory_child_ids, ["a1"]);
});

check("step 2 is ONE multi-path: every child, the accessories, and written=true together", () => {
  const out = buildUnpackUpdates({
    job: withAccessory(),
    jobId: "job-1",
    stamp: { child_ids: keys, accessory_child_ids: ["a1"], written: false },
    now: NOW,
    by: "system:test",
  });
  assert.ok(out["jobs/k1"] && out["jobs/k2"], "device children");
  assert.ok(out["jobs/a1"], "accessory child");
  assert.equal(out["jobs/job-1/multi_unpack/written"], true);
  assert.equal(out["jobs/job-1/multi_unpack/written_at"], NOW);
  assert.equal(out["jobs/job-1/accessories_unpacked_at"], NOW);
  // and nothing in step 2 touches the engine's fields on the parent
  for (const k of Object.keys(out)) {
    assert.doesNotMatch(k, /^jobs\/job-1\/(status|custody|status_version|status_history|paid_at|qc_logs)$/, k);
  }
});

// ── Wiring ──────────────────────────────────────────────────────────────────

check("index.js registers the trigger and the callable", () => {
  const src = fs.readFileSync(path.join(root, "functions/index.js"), "utf8");
  assert.match(src, /require\("\.\/b2c-unpack"\)\.registerB2cUnpack\(\)/);
});

check("the trigger's status filter and the engine row cannot drift apart", () => {
  const { TRANSITIONS } = require(path.join(root, "functions/status-engine.js"));
  assert.deepEqual([...TRANSITIONS.multi_device_unpacked.from].sort(), [...ENTRY_STATUSES].sort());
  assert.deepEqual(TRANSITIONS.multi_device_unpacked.requires, ["multi_unpack"]);
  assert.equal(TRANSITIONS.multi_device_unpacked.to, JOB_STATUS.COMPLETED);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
