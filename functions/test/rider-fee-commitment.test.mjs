// ---------------------------------------------------------------------------
// ด่านของ "ยอดที่ไรเดอร์เห็นตอนกดรับ คือยอดที่เขาได้"
//
//   node functions/test/rider-fee-commitment.test.mjs
//
// fixture หลักคือ **งานจริง** OID-MTIAI3FH-851 ที่อ่านจาก RTDB เมื่อ 1 ก.ย. 2569
// ไรเดอร์กดรับเห็น ฿182 ปิดจ๊อบได้ ฿157 เพราะ travel_mode ถูกสลับ 8 นาทีก่อน
// ปิดจ๊อบ — ถ้ากฎการตรึงทำงาน เคสนี้จะจบที่ 182
//
// สี่ข้อที่ชุดนี้ตรึงไว้:
//   1. คำนวณไม่สำเร็จ (reason != calculated) **ห้ามตรึง** — min_fee เป็นพื้น
//      ไม่ใช่ราคางาน ตรึงไว้ = ล็อกไรเดอร์ที่พื้นตลอดไป
//   2. ยอดที่มาจากการส่งมอบ/แอดมิน/คำแย้งหมุด **ห้ามเขียนทับ**
//   3. เปลี่ยนตัวไรเดอร์ก่อนส่งมอบ = ต้องคิดใหม่ให้คนใหม่ (คนละยานพาหนะได้)
//   4. ไรเดอร์คนเดิมกดซ้ำ = ไม่มีอะไรเปลี่ยน (idempotent)
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
  FROZEN_AT_ACCEPT,
  shouldSkipForSettledFee,
  freezeDecision,
  frozenFeeMeta,
  riderFeeLogEntry,
  existingLogs,
} = require(join(here, "..", "rider-fee-commitment.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

const RIDER = "LALYFeWzdZQKP8gfrbPA4MMDT6e2";
const OTHER = "GmxKmv51QxNr0HTuZ5FqmIB50kQ2";
// ผลจาก computeRiderFee ตอนไรเดอร์กดรับงานจริง (13:32:58 น. 1 ก.ย. 2569)
const OK_RESULT = { fee: 182, distance_km: 24.37, reason: "calculated" };
const FALLBACK = { fee: 100, distance_km: null, reason: "routes_api_timeout" };
const pickup = (extra) => ({ receive_method: "Pickup", ...extra });

// ── 1) เคสจริง: งานที่ยังไม่มียอด ต้องตรึง ────────────────────────────────
const first = freezeDecision(pickup({}), RIDER, OK_RESULT);
check("เคสจริง: งานใหม่ + คำนวณสำเร็จ = ตรึง", first.freeze === true && first.why === "first_freeze");

// ── 2) คำนวณไม่สำเร็จ ห้ามตรึง (ไม่งั้นล็อกไรเดอร์ไว้ที่ min_fee) ──────────
check("Routes ล้ม = ไม่ตรึง", freezeDecision(pickup({}), RIDER, FALLBACK).freeze === false);
check("Routes ล้ม: เหตุผลบอกว่า not_calculated",
  freezeDecision(pickup({}), RIDER, FALLBACK).why === "not_calculated");
check("ไม่มี result เลย = ไม่ตรึง", freezeDecision(pickup({}), RIDER, null).freeze === false);

// ── 3) เงื่อนไขพื้นฐาน ────────────────────────────────────────────────────
check("ไม่มีไรเดอร์ = ไม่ตรึง", freezeDecision(pickup({}), null, OK_RESULT).freeze === false);
check("ไม่ใช่ Pickup = ไม่ตรึง",
  freezeDecision({ receive_method: "Store-in" }, RIDER, OK_RESULT).freeze === false);

// ── 4) ยอดที่นิ่งแล้ว ห้ามแตะ ─────────────────────────────────────────────
const settled = pickup({ rider_fee: 157, rider_fee_meta: { distance_km: 19.35 } }); // ไม่มี frozen_source
check("ยอดจากการส่งมอบ = skip (ก่อนยิง Routes)", shouldSkipForSettledFee(settled, RIDER) === true);
check("ยอดจากการส่งมอบ = ไม่ตรึงทับ", freezeDecision(settled, RIDER, OK_RESULT).freeze === false);
check("ยอดจากการส่งมอบ: เหตุผล fee_is_final",
  freezeDecision(settled, RIDER, OK_RESULT).why === "fee_is_final");

// ── 5) ไรเดอร์คนเดิม = idempotent ─────────────────────────────────────────
const frozenSame = pickup({
  rider_fee: 182,
  rider_fee_meta: { frozen_source: FROZEN_AT_ACCEPT, frozen_for_rider_id: RIDER },
});
check("คนเดิมกดซ้ำ = skip", shouldSkipForSettledFee(frozenSame, RIDER) === true);
check("คนเดิมกดซ้ำ = ไม่ตรึงซ้ำ", freezeDecision(frozenSame, RIDER, OK_RESULT).freeze === false);

// ── 6) เปลี่ยนตัวไรเดอร์ก่อนส่งมอบ = ต้องคิดใหม่ ──────────────────────────
const frozenOther = pickup({
  rider_fee: 182,
  rider_fee_meta: { frozen_source: FROZEN_AT_ACCEPT, frozen_for_rider_id: OTHER },
});
check("เปลี่ยนตัวไรเดอร์ = ไม่ skip (ต้องยิง Routes ใหม่)",
  shouldSkipForSettledFee(frozenOther, RIDER) === false);
const re = freezeDecision(frozenOther, RIDER, OK_RESULT);
check("เปลี่ยนตัวไรเดอร์ = ตรึงใหม่ให้คนใหม่", re.freeze === true && re.why === "reassigned");

// แต่ถ้าส่งมอบไปแล้ว ห้ามแตะแม้จะเป็นคนละคน
const frozenOtherDone = { ...frozenOther, completed_at: 1788257140649 };
check("เปลี่ยนตัวหลังส่งมอบแล้ว = skip", shouldSkipForSettledFee(frozenOtherDone, RIDER) === true);

// ── 7) ยอดเป็น 0 หรือค่าเสีย = ถือว่ายังไม่มี ────────────────────────────
check("rider_fee = 0 = ยังไม่มียอด", shouldSkipForSettledFee(pickup({ rider_fee: 0 }), RIDER) === false);
check("rider_fee เป็นสตริงเสีย = ยังไม่มียอด",
  shouldSkipForSettledFee(pickup({ rider_fee: "abc" }), RIDER) === false);

// ── 8) meta ที่ตรึง ต้องพกคำตอบว่า "ตรึงให้ใคร เมื่อไหร่" ─────────────────
const meta = frozenFeeMeta({ distance_km: 24.37, reason: "calculated" }, RIDER, 1788244378617);
check("frozenFeeMeta: เก็บ frozen_source", meta.frozen_source === FROZEN_AT_ACCEPT);
check("frozenFeeMeta: เก็บว่าตรึงให้ใคร", meta.frozen_for_rider_id === RIDER);
check("frozenFeeMeta: เก็บเวลา", meta.frozen_at === 1788244378617);
check("frozenFeeMeta: ไม่ทิ้งฟิลด์เดิมของ meta", meta.distance_km === 24.37 && meta.reason === "calculated");
// ต้องพอสำหรับให้ freezeDecision รอบหน้าอ่านกลับได้
check("meta ที่ตรึงแล้ว ทำให้รอบหน้าของคนเดิม skip",
  shouldSkipForSettledFee(pickup({ rider_fee: 182, rider_fee_meta: meta }), RIDER) === true);

// ── 9) qc_logs ─────────────────────────────────────────────────────────────
const log = riderFeeLogEntry({
  to: 182, cause: "frozen_at_accept", distanceKm: 24.37, reason: "calculated", riderId: RIDER, now: 1,
});
check("log: action คงที่ ค้นย้อนหลังได้", log.action === "Rider Fee Set");
check("log: มียอดในข้อความ", log.details.includes("182"));
check("log: มีระยะทาง", log.details.includes("24.37"));
check("log: reason = calculated ไม่ต้องรก", log.details.includes("ฐานคำนวณ") === false);
const logFallback = riderFeeLogEntry({ to: 100, cause: "settled_at_handover", reason: "routes_api_timeout", now: 1 });
check("log: reason ที่ไม่ใช่ calculated ต้องโผล่", logFallback.details.includes("routes_api_timeout"));
const logRe = riderFeeLogEntry({ from: 182, to: 157, cause: "frozen_reassigned", now: 1 });
check("log: มีค่าเดิมเมื่อเป็นการเปลี่ยนยอด", logRe.details.includes("จากเดิม") && logRe.details.includes("182"));
check("log: ไม่มีค่าเดิม ไม่ต้องเขียนคำว่าจากเดิม",
  riderFeeLogEntry({ to: 182, cause: "frozen_at_accept", now: 1 }).details.includes("จากเดิม") === false);

// ── 10) existingLogs ทนกับรูปที่ RTDB คืนมาได้ทั้งสองแบบ ──────────────────
check("existingLogs: array", existingLogs({ qc_logs: [{ a: 1 }] }).length === 1);
check("existingLogs: object (RTDB คืนแบบนี้เมื่อคีย์ไม่ต่อเนื่อง)",
  existingLogs({ qc_logs: { 0: { a: 1 }, 2: { b: 2 } } }).length === 2);
check("existingLogs: ไม่มี qc_logs = []", existingLogs({}).length === 0);
check("existingLogs: job เป็น null = []", existingLogs(null).length === 0);

console.log(failures === 0 ? "\nOK — ผ่านทั้งหมด" : `\nFAILED ${failures} เคส`);
process.exit(failures === 0 ? 0 : 1);
