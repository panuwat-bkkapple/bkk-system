// ครึ่ง pure ของ scripts/audit-qc-backlog.mjs
//
// ตัวเลขจากสคริปต์นี้คือสิ่งที่ใช้ตัดสินว่า migration ต้องมี pass ปิดงานเก่า
// ยกชุดหรือไม่ — จัดกลุ่มอายุผิด = ตัดสินใจผิดกับงานครึ่งหนึ่งของระบบ
import assert from "node:assert/strict";
import { ageBucket, lastHumanTouch, summarise } from "../../scripts/audit-qc-backlog.mjs";

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failures++; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

console.log("audit-qc-backlog");

check("ขอบของแต่ละช่วงอายุ", () => {
  assert.equal(ageBucket(0), "0-7 วัน");
  assert.equal(ageBucket(6.9 * DAY), "0-7 วัน");
  assert.equal(ageBucket(7 * DAY), "7-30 วัน");
  assert.equal(ageBucket(29.9 * DAY), "7-30 วัน");
  assert.equal(ageBucket(30 * DAY), "30-90 วัน");
  assert.equal(ageBucket(200 * DAY), "เกิน 180 วัน");
});

check("อายุที่คำนวณไม่ได้ = 'ไม่รู้' ไม่ใช่ 0 วัน", () => {
  // ถ้าตกไปช่อง 0-7 วัน งานที่ไม่มีข้อมูลเลยจะดูเหมือน backlog สดๆ
  assert.equal(ageBucket(NaN), "ไม่รู้");
  assert.equal(ageBucket(-1), "ไม่รู้");
});

check("lastHumanTouch ใช้เวลาล่าสุดจากไทม์ไลน์ที่คนสร้าง", () => {
  const job = {
    updated_at: NOW,                                   // trigger เขียนได้เอง
    qc_logs: [{ timestamp: NOW - 100 * DAY }],
    status_history: [{ at: NOW - 50 * DAY }],
  };
  assert.equal(lastHumanTouch(job), NOW - 50 * DAY);
});

check("updated_at ถูกใช้ต่อเมื่อไม่มีร่องรอยของคนเลย", () => {
  assert.equal(lastHumanTouch({ updated_at: 123 }), 123);
  assert.equal(lastHumanTouch({}), null);
});

check("updated_at ที่ trigger เขียนไม่กลบอายุจริง", () => {
  // นี่คือเหตุผลที่มี lastHumanTouch แทนการอ่าน updated_at ตรงๆ:
  // งานที่ไม่มีใครแตะครึ่งปีแต่ mirror ไป public_track เมื่อวาน ต้องยังนับว่าเก่า
  const stale = { updated_at: NOW, qc_logs: [{ timestamp: NOW - 200 * DAY }] };
  const { byBucket } = summarise({ J1: { ...stale, status: "Pending QC" } }, ["Pending QC"], NOW);
  assert.deepEqual(byBucket["Pending QC"], { "เกิน 180 วัน": 1 });
});

check("นับเฉพาะสถานะที่ถาม", () => {
  const jobs = {
    J1: { status: "Pending QC", updated_at: NOW },
    J2: { status: "In Stock", updated_at: NOW },
  };
  const out = summarise(jobs, ["Pending QC"], NOW);
  assert.equal(out.total, 1);
  assert.equal(out.rows[0].jobId, "J1");
});

check("แยกช่องตามสถานะ ไม่รวมกอง", () => {
  const jobs = {
    J1: { status: "Pending QC", updated_at: NOW },
    J2: { status: "Sent to QC Lab", updated_at: NOW - 100 * DAY },
  };
  const { byBucket } = summarise(jobs, ["Pending QC", "Sent to QC Lab"], NOW);
  assert.deepEqual(byBucket["Pending QC"], { "0-7 วัน": 1 });
  assert.deepEqual(byBucket["Sent to QC Lab"], { "90-180 วัน": 1 });
});

check("qc_logs ที่เก็บเป็น object แบบ push-key อ่านได้", () => {
  assert.equal(lastHumanTouch({ qc_logs: { "-Nabc": { timestamp: 999 } } }), 999);
});

if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("all checks passed");
