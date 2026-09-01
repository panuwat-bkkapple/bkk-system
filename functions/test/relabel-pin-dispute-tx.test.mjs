// เทสของ scripts/relabel-pin-dispute-tx.cjs — ตัวแก้ป้ายหมวดแถวปรับค่ารอบ
//
// สิ่งที่เทสนี้คุ้ม: มันแก้ "ป้าย" เท่านั้น ไม่แตะเงิน, มันเก็บร่องรอยของป้าย
// เดิมไว้เสมอ, มันไม่แตะแถวที่ไม่ใช่ของงานนี้, และรันซ้ำแล้วไม่ทำอะไร
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { planRelabel } = require("../../scripts/relabel-pin-dispute-tx.cjs");

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failed++;
}

const JOB = "J1";
const NOW = 1_700_000_000_000;

// เคสจริง: DEBIT PENALTY 104 (ตอนอนุมัติ) + CREDIT JOB_PAYOUT 104 (ตอนย้อน)
const job = { pin_dispute: { delta_tx_id: "TX_DEBIT", revert_tx_id: "TX_CREDIT" } };
const txs = {
  TX_DEBIT: { type: "DEBIT", category: "PENALTY", amount: 104, ref_job_id: JOB, rider_id: "R1" },
  TX_CREDIT: { type: "CREDIT", category: "JOB_PAYOUT", amount: 104, ref_job_id: JOB, rider_id: "R1" },
};
const plan = planRelabel(JOB, job, txs, NOW);

check("แก้ทั้งสองแถว", plan.changed.length === 2);
check("ทิศลบ PENALTY -> ADJUSTMENT", plan.updates["transactions/TX_DEBIT/category"] === "ADJUSTMENT");
check("ทิศบวก JOB_PAYOUT -> ADJUSTMENT", plan.updates["transactions/TX_CREDIT/category"] === "ADJUSTMENT");
check("เก็บป้ายเดิมไว้ทั้งคู่",
  plan.updates["transactions/TX_DEBIT/category_was"] === "PENALTY" &&
  plan.updates["transactions/TX_CREDIT/category_was"] === "JOB_PAYOUT");
check("ประทับเวลาที่แก้", plan.updates["transactions/TX_DEBIT/category_corrected_at"] === NOW);

// เงินห้ามขยับ — ไม่มี path ไหนแตะ amount/type/timestamp/description/ref_job_id
const MONEY = /\/(amount|type|timestamp|created_at|description|ref_job_id|rider_id)$/;
check("ไม่มี path ไหนแตะเงินหรือข้อเท็จจริงของแถว",
  Object.keys(plan.updates).every((p) => !MONEY.test(p)));

// รันซ้ำ: แถวที่เป็น ADJUSTMENT แล้วต้องถูกข้าม
const after = {
  TX_DEBIT: { ...txs.TX_DEBIT, category: "ADJUSTMENT" },
  TX_CREDIT: { ...txs.TX_CREDIT, category: "ADJUSTMENT" },
};
const again = planRelabel(JOB, job, after, NOW);
check("idempotent: รันซ้ำไม่แก้อะไร", again.changed.length === 0 && Object.keys(again.updates).length === 0);
// ด่าน "เป็น ADJUSTMENT อยู่แล้ว" ถูกกลบด้วยด่าน RELABELABLE ถ้าดูแค่ว่าแก้ไหม
// (ทั้งคู่ให้ผลเป็น "ไม่แก้" เหมือนกัน) — ต้องอ่าน *เหตุผล* ถึงจะพิสูจน์ว่ามันทำงาน
// ไม่งั้นคนอ่านรอบหน้าจะได้ข้อความว่า "หมวด 'ADJUSTMENT' ไม่อยู่ในชุดที่ยอมให้แก้"
// ซึ่งอ่านเหมือนมีอะไรผิด ทั้งที่แค่แก้ไปแล้ว
check("รันซ้ำต้องบอกว่า 'แก้ไปแล้ว' ไม่ใช่ 'หมวดแปลกปลอม'",
  again.skipped.every((s) => s.why.includes("อยู่แล้ว")));

// แถวที่อ้างงานอื่น = ไม่แตะ (กัน tx id ที่ค้างผิดใบ)
const crossed = planRelabel(JOB, job, {
  ...txs,
  TX_DEBIT: { ...txs.TX_DEBIT, ref_job_id: "OTHER_JOB" },
}, NOW);
check("แถวที่อ้างงานอื่นถูกข้าม", crossed.updates["transactions/TX_DEBIT/category"] === undefined);
check("แต่แถวที่ถูกต้องยังถูกแก้", crossed.updates["transactions/TX_CREDIT/category"] === "ADJUSTMENT");

// หมวดนอกชุดที่ยอมให้แก้ = ไม่แตะ (WITHDRAWAL/BONUS เป็นคนละเรื่อง)
const foreign = planRelabel(JOB, job, {
  ...txs,
  TX_DEBIT: { ...txs.TX_DEBIT, category: "WITHDRAWAL" },
}, NOW);
check("หมวดนอกชุดถูกข้าม", foreign.updates["transactions/TX_DEBIT/category"] === undefined);

// แถวหาย = รายงาน ไม่สร้างโหนดผี
const missing = planRelabel(JOB, job, { TX_CREDIT: txs.TX_CREDIT }, NOW);
check("แถวที่หายไปไม่ถูกสร้างใหม่", missing.updates["transactions/TX_DEBIT/category"] === undefined);
check("แถวที่หายไปถูกรายงาน", missing.skipped.some((s) => s.key === "TX_DEBIT"));

// งานที่ไม่มีคำแย้ง / คำแย้งที่ไม่เคยลง ledger
check("งานไม่มีคำแย้ง = error", !!planRelabel(JOB, {}, {}, NOW).error);
check("คำแย้งที่ไม่เคยลง ledger = error", !!planRelabel(JOB, { pin_dispute: { status: "approved" } }, {}, NOW).error);

console.log(failed === 0 ? "\nOK — relabel-pin-dispute-tx" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
