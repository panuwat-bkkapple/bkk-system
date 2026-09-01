// ครึ่ง pure ของ scripts/backfill-qc-logs-from-history.mjs
//
// สคริปต์กู้ข้อมูลเป็นของที่รันครั้งเดียวบน production แล้วไม่มีใครดูอีก —
// ถ้ามันเติมของซ้ำหรือเรียงผิด จะไม่มีเทสไหนแดงและไม่มีใครรู้ ยกเว้นแอดมิน
// ที่เปิดไทม์ไลน์แล้วเห็นแถวซ้อนกัน
import assert from "node:assert/strict";
import { planJobBackfill, qcRowFromHistory } from "../../scripts/backfill-qc-logs-from-history.mjs";

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

const hist = (over = {}) => ({
  from: "Rider Accepted", to: "Rider En Route", event: "rider_departed",
  actor: "rider", by: "rider:r1", at: 1_700_000_000_000, ...over,
});

console.log("backfill-qc-logs");

check("เติมแถวที่หายจากช่วงที่ยังไม่มิเรอร์", () => {
  const plan = planJobBackfill({ status_history: [hist()], qc_logs: [] });
  assert.equal(plan.added, 1);
  assert.deepEqual(plan.qcLogs[0], {
    action: "Rider En Route", by: "rider:r1",
    timestamp: 1_700_000_000_000, details: "Rider Accepted -> Rider En Route (rider_departed)",
  });
});

check("reason ของ transition ถูกใช้เป็น details ถ้ามี", () => {
  const plan = planJobBackfill({ status_history: [hist({ reason: "ไรเดอร์ออกเดินทาง" })] });
  assert.equal(plan.qcLogs[0].details, "ไรเดอร์ออกเดินทาง");
});

check("idempotent: แถวที่มีคู่แล้วไม่ถูกเติมซ้ำ", () => {
  // นี่คือกรณีของทุกงานหลัง #636 deploy — สคริปต์ต้องข้ามทั้งหมด
  const job = {
    status_history: [hist()],
    qc_logs: [{ action: "Rider En Route", by: "สมชาย", timestamp: 1_700_000_000_000, details: "x" }],
  };
  assert.equal(planJobBackfill(job), null);
});

check("เติมเฉพาะแถวที่ขาด ไม่แตะแถวที่มีอยู่", () => {
  const job = {
    status_history: [hist(), hist({ to: "Rider Arrived", at: 1_700_000_060_000 })],
    qc_logs: [{ action: "Rider En Route", by: "เดิม", timestamp: 1_700_000_000_000, details: "ของเดิม" }],
  };
  const plan = planJobBackfill(job);
  assert.equal(plan.added, 1);
  assert.equal(plan.qcLogs.length, 2);
  // แถวเดิมต้องอยู่ครบพร้อมข้อความเดิม ไม่ถูกสร้างใหม่ทับ
  assert.equal(plan.qcLogs.find((l) => l.timestamp === 1_700_000_000_000).details, "ของเดิม");
});

check("เรียงใหม่ก่อนเก่า แม้ history จะเรียงกลับกัน", () => {
  const job = {
    status_history: [hist(), hist({ to: "Rider Arrived", at: 1_700_000_060_000 })],
    qc_logs: [{ action: "เก่ามาก", timestamp: 1_600_000_000_000 }],
  };
  const plan = planJobBackfill(job);
  const stamps = plan.qcLogs.map((l) => l.timestamp);
  assert.deepEqual(stamps, [1_700_000_060_000, 1_700_000_000_000, 1_600_000_000_000]);
});

check("งานยุคก่อน engine (ไม่มี status_history) ไม่ถูกแตะ", () => {
  assert.equal(planJobBackfill({ qc_logs: [{ action: "อะไรสักอย่าง", timestamp: 1 }] }), null);
  assert.equal(planJobBackfill({}), null);
});

check("history ที่เก็บเป็น object แบบ push-key อ่านได้ ไม่ใช่ข้าม", () => {
  const job = { status_history: { "-Nabc": hist() } };
  assert.equal(planJobBackfill(job).added, 1);
});

check("แถว history ที่ไม่มีเวลาถูกข้าม ไม่ใช่เขียนแถวเวลาว่าง", () => {
  // แถวเวลาว่างจะทำให้ Traceability ทิ้งมันอยู่ดี (มันเช็ค log.timestamp)
  // แล้วเราจะเหลือขยะที่ไม่มีใครเห็นแต่กินที่
  assert.equal(planJobBackfill({ status_history: [hist({ at: undefined })] }), null);
});

check("by ตกกลับไปที่ actor เมื่อไม่มี แล้วค่อยเป็น system", () => {
  assert.equal(qcRowFromHistory(hist({ by: undefined })).by, "rider");
  assert.equal(qcRowFromHistory(hist({ by: undefined, actor: undefined })).by, "system");
});

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
