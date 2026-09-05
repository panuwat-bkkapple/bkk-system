// rider-fee-cancel — offline suite. กติกาสามข้อของเจ้าของงาน (5 ก.ย. 2569):
//   รับแล้วยังไม่ออกเดินทาง = ไม่จ่าย · ยกเลิกระหว่างทาง = ค่าเสียเวลา ·
//   ตรวจเครื่องแล้วไม่ผ่าน = เรทปกติ
// fixture เขียนจากรูปข้อมูลจริง: ยอดที่ตรึงตอนกดรับ (rider-fee-commitment) +
// เคส OID-MTN2QCMQ-881 (กดรับ ยังไม่ออกเดินทาง ลูกค้ายกเลิกจากเว็บ ฿324 ค้าง)
//
// INJECTION RESULTS (ทำทีละตัว วัดหลังรัน 5 ก.ย. 2569):
//   1. cancelStageOf ไม่รู้จัก inspected (ตรวจแล้วนับเป็นระหว่างทาง)       -> แดง 4
//   2. ตัดสัญญาณจุดเช็คอิน ใช้แต่สถานะก่อนยกเลิก                            -> แดง 1
//   3. ถอด guard "ตัดสินไปแล้ว" (rider_fee_status มีค่า = skip)               -> แดง 1
//   4. void ลบ rider_fee ทิ้ง แทนที่จะประทับ Voided                           -> แดง 1
//   5. ค่าเสียเวลาไม่ตั้ง = ตกไปใช้ยอดที่ตรึง แทน blocked                    -> แดง 1
//   6. reopen ไม่ปลด Voided                                                  -> แดง 1
//   7. index.js amendment กลับไปมีกฎ departed ของตัวเอง แทนเรียก decision     -> แดง 1
//   (push ถึงไรเดอร์ — เพิ่มรอบสอง 5 ก.ย. 2569 วัดหลังรัน)
//   8. cancelFeePushMessage คืนข้อความให้ void ด้วย                          -> แดง 1
//   9. ถอด rider_fee_settled ออกจาก EVENT_CATEGORY                          -> แดง 1
//  10. trigger ไม่เรียก pushToRider                                          -> แดง 1
//  11. amendment ไม่ push ค่าเสียเวลา                                          -> แดง 1
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const {
  FEE_STATUS,
  RIDER_FEE_PUSH_TYPE,
  cancelFeePushMessage,
  CANCEL_STAGE,
  cancelStageOf,
  cancelFeeDecision,
  buildCancelFeeUpdates,
  buildReopenFeeUpdates,
} = require(path.join(root, "functions/rider-fee-cancel.js"));
const { JOB_STATUS } = require(path.join(root, "functions/status-vocab.generated.js"));
const { EVENT_CATEGORY } = require(path.join(root, "functions/notification-settings.js"));

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

console.log("rider-fee-cancel");

// งานจริง: ตรึง ฿324 ตอนกดรับ แล้วลูกค้ายกเลิกจากเว็บ (status เขียนเป็น Cancelled แล้ว)
const frozenAtAccept = {
  receive_method: "Pickup",
  rider_id: "R1",
  status: JOB_STATUS.CANCELLED,
  cancelled_by: "customer",
  rider_fee: 324,
  rider_fee_meta: { frozen_source: "accepted", frozen_for_rider_id: "R1", distance_km: 44.7 },
  checkpoints: { rider_accepted: { at: 1_000 } },
  qc_logs: [{ action: "Rider Fee Set", by: "System", timestamp: 1_000, details: "ตรึง" }],
};
const comp = { customer_cancel_time_loss: 100 };

// ── ขั้นที่ไรเดอร์ไปถึง ─────────────────────────────────────────────────────
check("รับแล้วยังไม่ออกเดินทาง = not_departed", () => {
  assert.equal(cancelStageOf(frozenAtAccept, JOB_STATUS.RIDER_ACCEPTED), CANCEL_STAGE.NOT_DEPARTED);
});
check("สถานะก่อนยกเลิกเป็น En Route / Arrived = departed", () => {
  assert.equal(cancelStageOf(frozenAtAccept, JOB_STATUS.RIDER_EN_ROUTE), CANCEL_STAGE.DEPARTED);
  assert.equal(cancelStageOf(frozenAtAccept, JOB_STATUS.RIDER_ARRIVED), CANCEL_STAGE.DEPARTED);
});
check("จุดเช็คอิน rider_en_route ก็นับว่าออกเดินทางแล้ว แม้สถานะถูกดึงกลับก่อนยกเลิก", () => {
  const job = { ...frozenAtAccept, checkpoints: { rider_en_route: { at: 2_000 } } };
  assert.equal(cancelStageOf(job, JOB_STATUS.FOLLOWING_UP), CANCEL_STAGE.DEPARTED);
});
check("เริ่มตรวจเครื่องแล้ว (Being Inspected / QC Review / Revised Offer) = inspected", () => {
  for (const s of [JOB_STATUS.BEING_INSPECTED, JOB_STATUS.QC_REVIEW, JOB_STATUS.REVISED_OFFER, JOB_STATUS.NEGOTIATION]) {
    assert.equal(cancelStageOf(frozenAtAccept, s), CANCEL_STAGE.INSPECTED, s);
  }
});
check("inspected_at บนงานก็นับว่าตรวจแล้ว แม้สถานะก่อนยกเลิกเป็น Rider Arrived", () => {
  const job = { ...frozenAtAccept, inspected_at: 3_000 };
  assert.equal(cancelStageOf(job, JOB_STATUS.RIDER_ARRIVED), CANCEL_STAGE.INSPECTED);
});
check("สะกด legacy ของสถานะก่อนยกเลิกถูก normalize ('Assigned' ยังไม่ออกเดินทาง)", () => {
  assert.equal(cancelStageOf(frozenAtAccept, "Assigned"), CANCEL_STAGE.NOT_DEPARTED);
});

// ── ข้อ 1: ไม่จ่าย ───────────────────────────────────────────────────────────
check("ข้อ 1: ยอดที่ตรึงตอนกดรับกลายเป็นโมฆะ ไม่ใช่เงิน", () => {
  const d = cancelFeeDecision({ job: frozenAtAccept, priorStatus: JOB_STATUS.RIDER_ACCEPTED, riderCompensation: comp });
  assert.equal(d.kind, "void");
  assert.equal(d.fee, 324);
  const u = buildCancelFeeUpdates(d, frozenAtAccept, 9_000);
  assert.equal(u.rider_fee_status, FEE_STATUS.VOIDED);
  assert.equal(u.rider_fee, undefined, "ไม่ลบ rider_fee — riderAudit ใช้มันเป็นสัญญาณว่าไรเดอร์เกี่ยวข้อง");
  assert.equal(u.rider_fee_meta.voided_at, 9_000);
  assert.equal(u.rider_fee_meta.frozen_source, "accepted", "meta เดิมต้องอยู่ครบ");
  assert.equal(u.qc_logs[0].action, "Rider Fee Voided");
  assert.equal(u.qc_logs.length, 2, "log เดิมต้องไม่หาย");
});
check("ข้อ 1 โดยไม่มียอดที่ตรึง = ไม่มีอะไรให้โมฆะ ไม่เขียน", () => {
  const job = { ...frozenAtAccept, rider_fee: undefined, rider_fee_meta: undefined };
  const d = cancelFeeDecision({ job, priorStatus: JOB_STATUS.RIDER_ACCEPTED, riderCompensation: comp });
  assert.equal(d.kind, "skip");
  assert.equal(d.why, "nothing_to_void");
});

// ── ข้อ 2: ค่าเสียเวลา ───────────────────────────────────────────────────────
check("ข้อ 2: ยกเลิกระหว่างทาง = ค่าเสียเวลาจาก settings เข้าคิว Pending", () => {
  const d = cancelFeeDecision({ job: frozenAtAccept, priorStatus: JOB_STATUS.RIDER_EN_ROUTE, riderCompensation: comp });
  assert.equal(d.kind, "time_loss");
  assert.equal(d.fee, 100, "ไม่ใช่ยอดที่ตรึง 324 — ค่าเสียเวลาคือเลขจาก settings");
  const u = buildCancelFeeUpdates(d, frozenAtAccept, 9_000, { priorStatus: JOB_STATUS.RIDER_EN_ROUTE });
  assert.equal(u.rider_fee, 100);
  assert.equal(u.rider_fee_status, FEE_STATUS.PENDING);
  assert.equal(u.rider_fee_breakdown.type, "time_loss_customer_cancel");
  assert.equal(u.rider_fee_breakdown.source, "settings");
});
check("ข้อ 2 แต่ยังไม่ตั้งค่าเสียเวลา = blocked ห้ามเดาเลข (ไม่ตั้ง / ติดลบ / ไม่ใช่ตัวเลข)", () => {
  for (const c of [null, {}, { customer_cancel_time_loss: -1 }, { customer_cancel_time_loss: "100" }]) {
    const d = cancelFeeDecision({ job: frozenAtAccept, priorStatus: JOB_STATUS.RIDER_ARRIVED, riderCompensation: c });
    assert.equal(d.kind, "blocked", JSON.stringify(c));
  }
});
check("ค่าเสียเวลา 0 บาทเป็นค่าที่ตั้งได้ (ตั้งใจไม่จ่าย) ไม่ใช่ blocked", () => {
  const d = cancelFeeDecision({ job: frozenAtAccept, priorStatus: JOB_STATUS.RIDER_EN_ROUTE, riderCompensation: { customer_cancel_time_loss: 0 } });
  assert.equal(d.kind, "time_loss");
  assert.equal(d.fee, 0);
});

// ── ข้อ 3: เรทปกติ ───────────────────────────────────────────────────────────
check("ข้อ 3: ตรวจเครื่องแล้วไม่ผ่าน = ยอดที่ตรึงตอนกดรับเข้าคิว Pending", () => {
  const d = cancelFeeDecision({ job: frozenAtAccept, priorStatus: JOB_STATUS.QC_REVIEW, riderCompensation: comp });
  assert.equal(d.kind, "normal");
  assert.equal(d.fee, 324);
  const u = buildCancelFeeUpdates(d, frozenAtAccept, 9_000, { priorStatus: JOB_STATUS.QC_REVIEW });
  assert.equal(u.rider_fee, 324);
  assert.equal(u.rider_fee_status, FEE_STATUS.PENDING);
  assert.equal(u.rider_fee_breakdown.type, "normal_rate_cancel_after_inspection");
});
check("ข้อ 3 โดยไม่มียอดที่ตรึง = fee null ให้ผู้เรียกคำนวณ และ builder ปฏิเสธจนกว่าจะเติม", () => {
  const job = { ...frozenAtAccept, rider_fee: undefined };
  const d = cancelFeeDecision({ job, priorStatus: JOB_STATUS.BEING_INSPECTED, riderCompensation: comp });
  assert.equal(d.kind, "normal");
  assert.equal(d.fee, null);
  assert.equal(buildCancelFeeUpdates(d, job, 9_000), null);
  d.fee = 210;
  const u = buildCancelFeeUpdates(d, job, 9_000, { distanceKm: 31.2, source: "calculated" });
  assert.equal(u.rider_fee, 210);
  assert.equal(u.rider_fee_breakdown.source, "calculated");
  assert.match(u.qc_logs[0].details, /31\.2 กม\./);
});

// ── สิ่งที่ห้ามแตะ ────────────────────────────────────────────────────────────
check("ตัดสินไปแล้ว (Pending/Paid/Voided) = skip — amendment เขียน Pending ก่อน trigger", () => {
  for (const st of [FEE_STATUS.PENDING, FEE_STATUS.PAID, FEE_STATUS.VOIDED]) {
    const d = cancelFeeDecision({ job: { ...frozenAtAccept, rider_fee_status: st }, priorStatus: JOB_STATUS.RIDER_EN_ROUTE, riderCompensation: comp });
    assert.equal(d.kind, "skip", st);
  }
});
check("ไม่ใช่ Pickup / ไม่มีไรเดอร์ = skip", () => {
  assert.equal(cancelFeeDecision({ job: { ...frozenAtAccept, receive_method: "Store-in" }, priorStatus: JOB_STATUS.RIDER_EN_ROUTE, riderCompensation: comp }).kind, "skip");
  assert.equal(cancelFeeDecision({ job: { ...frozenAtAccept, rider_id: null }, priorStatus: JOB_STATUS.RIDER_EN_ROUTE, riderCompensation: comp }).kind, "skip");
});

// ── reopen ───────────────────────────────────────────────────────────────────
check("reopen งานที่โมฆะแล้ว = ปลด Voided กลับเป็นยังไม่ตัดสิน และเก็บ meta เดิม", () => {
  const voided = { ...frozenAtAccept, rider_fee_status: FEE_STATUS.VOIDED, rider_fee_meta: { ...frozenAtAccept.rider_fee_meta, voided_at: 9_000, voided_reason: "cancelled_before_departure" } };
  const u = buildReopenFeeUpdates(voided, 10_000);
  assert.equal(u.rider_fee_status, null);
  assert.equal(u.rider_fee_meta.voided_at, undefined);
  assert.equal(u.rider_fee_meta.frozen_source, "accepted");
  assert.equal(u.qc_logs[0].action, "Rider Fee Unvoided");
});
check("reopen งานที่ค่ารอบ Pending/Paid หรือไม่มี status = ไม่แตะ", () => {
  assert.equal(buildReopenFeeUpdates({ ...frozenAtAccept, rider_fee_status: FEE_STATUS.PENDING }, 1), null);
  assert.equal(buildReopenFeeUpdates(frozenAtAccept, 1), null);
});

// ── push ถึงไรเดอร์ ──────────────────────────────────────────────────────────
check("ค่าเสียเวลา = push บอกยอดและเลขงาน ผ่าน type ที่สวิตช์แจ้งเตือนรู้จัก", () => {
  const msg = cancelFeePushMessage({ kind: "time_loss", fee: 100, riderId: "R1" }, "job1", "OID-X-1");
  assert.ok(msg);
  assert.match(msg.notification.title, /100/);
  assert.match(msg.notification.body, /OID-X-1/);
  assert.equal(msg.data.type, RIDER_FEE_PUSH_TYPE);
  assert.equal(msg.data.jobId, "job1");
  assert.equal(EVENT_CATEGORY[RIDER_FEE_PUSH_TYPE], "approval", "type ต้องอยู่ใน EVENT_CATEGORY ไม่งั้นแอดมินปิดไม่ได้");
});
check("โมฆะ / ข้าม / blocked / เรทปกติ = ไม่ push (งานถูกยกเลิกมีแจ้งเตือนของตัวเองอยู่แล้ว)", () => {
  for (const kind of ["void", "skip", "blocked", "normal"]) {
    assert.equal(cancelFeePushMessage({ kind, fee: 324, riderId: "R1" }, "job1"), null, kind);
  }
  assert.equal(cancelFeePushMessage(null, "job1"), null);
  assert.equal(cancelFeePushMessage({ kind: "time_loss", fee: null }, "job1"), null, "ไม่มียอด = ไม่มีอะไรจะบอก");
});

// ── ด่านต่อสาย: index.js ต้องเรียกใช้จริง ─────────────────────────────────────
const indexSrc = readFileSync(path.join(root, "functions/index.js"), "utf8");
check("trigger onJobCancelledSettleRiderFee มีอยู่ เกาะ jobs/{jobId}/status และเรียก cancelFeeDecision + buildReopenFeeUpdates", () => {
  const start = indexSrc.indexOf("exports.onJobCancelledSettleRiderFee");
  assert.ok(start > 0, "ไม่มี trigger");
  const body = indexSrc.slice(start, indexSrc.indexOf("\nexports.", start + 10));
  assert.match(body, /ref: "\/jobs\/\{jobId\}\/status"/);
  assert.match(body, /cancelFeeDecision\(/);
  assert.match(body, /buildReopenFeeUpdates\(/);
  assert.match(body, /computeRiderFeeForAssignee\(/, "เรทปกติที่ไม่มียอดตรึงต้องคำนวณจากระยะทาง");
  assert.match(body, /cancelFeePushMessage\(/, "ต้องบอกไรเดอร์เมื่อได้ค่าเสียเวลา");
  assert.match(body, /pushToRider\(/, "push ต้องผ่าน pushToRider (สวิตช์แจ้งเตือน + data-only)");
});
check("amendment ที่เขียนค่าเสียเวลาเอง ก็ push ให้ไรเดอร์ด้วยข้อความชุดเดียวกัน", () => {
  const start = indexSrc.indexOf('"amendment-applied-operational"');
  const body = indexSrc.slice(start, indexSrc.indexOf("\nexports.", start));
  assert.match(body, /time_loss_customer_cancel/);
  assert.match(body, /cancelFeePushMessage\(/);
  assert.match(body, /pushToRider\(/);
});
check("amendment customer_request_cancel ตัดสินผ่าน cancelFeeDecision ไม่มีกฎ 'departed' ของตัวเอง", () => {
  const start = indexSrc.indexOf('case "customer_request_cancel"');
  const body = indexSrc.slice(start, indexSrc.indexOf("case ", start + 10));
  assert.match(body, /cancelFeeDecision\(/);
  assert.doesNotMatch(body, /RIDER_DEPARTED_STATUSES|customer_cancel_time_loss ===|typeof riderCompensation/);
  assert.match(body, /failed-precondition/, "ยังไม่ตั้งค่าต้องปฏิเสธ amendment เหมือนเดิม");
});
check("RIDER_DEPARTED_STATUSES สำเนาเก่าถูกลบจาก index.js (กฎอยู่ที่ rider-fee-cancel.js ที่เดียว)", () => {
  assert.equal(indexSrc.includes("RIDER_DEPARTED_STATUSES"), false);
});

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
