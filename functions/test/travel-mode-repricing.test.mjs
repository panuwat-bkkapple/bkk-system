// ---------------------------------------------------------------------------
// ด่านของ scripts/audit-travel-mode-repricing.cjs
//
//   node functions/test/travel-mode-repricing.test.mjs
//
// fixture หลักคือ **งานจริง** OID-MTIAI3FH-851 (jobs/-P0QekIHDPBe7phJhabu)
// ที่อ่านออกมาจาก RTDB เมื่อ 1 ก.ย. 2569 ไม่ใช่เคสที่แต่งขึ้นตาม spec —
// กฎ "เขียนเทสจากเคสที่ลูกค้าทำจริง" ใน CLAUDE.md ของ bkk-frontend-next
//
// สิ่งที่ด่านนี้ตรึงไว้:
//   1. ใบที่ travel_mode เปลี่ยนกลางทางต้องเข้าถัง A ไม่ใช่ถัง C
//      (ทั้งสองถังมี distance ต่างกันเหมือนกัน ต่างกันที่ "ทำไม")
//   2. ยอดที่เทียบต้องเป็นเลขที่ไรเดอร์ *เห็นจริง* คือ fee_by_vehicle[vehicle]
//      ไม่ใช่ rider_fee_estimate เปล่าๆ — สองค่านี้ต่างกันได้เมื่อไรเดอร์ขับรถยนต์
//   3. ใบที่ยังไม่ปิดจ๊อบ (ไม่มี rider_fee_meta) ต้องไม่ถูกนับ
//   4. summarize ต้องแยก Paid ออกจากยังไม่จ่าย เพราะทางแก้คนละเรื่อง
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { classifyJob, analyzeJobs, summarize, shownEstimate } =
  require(join(here, "..", "..", "scripts", "audit-travel-mode-repricing.cjs"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

// ── fixture: งานจริง OID-MTIAI3FH-851 ─────────────────────────────────────
const REAL = {
  ref_no: "OID-MTIAI3FH-851",
  status: "Pending QC",
  receive_method: "Pickup",
  rider_id: "LALYFeWzdZQKP8gfrbPA4MMDT6e2",
  rider_fee_estimate: 182,
  rider_fee: 157,
  rider_fee_status: "Pending",
  rider_fee_estimate_meta: {
    computed_at: 1788244378617,
    distance_km: 24.37,
    fee_by_vehicle: { car: 222, motorcycle: 182 },
    rates: { base_fee: 60, max_fee: 500, min_fee: 100, per_km: 5, travel_mode: "DRIVE", vehicle: "motorcycle" },
    reason: "calculated",
  },
  rider_fee_meta: {
    computed_at: 1788257141733,
    distance_km: 19.35,
    fee_by_vehicle: { car: 197, motorcycle: 157 },
    rates: { base_fee: 60, max_fee: 500, min_fee: 100, per_km: 5, travel_mode: "TWO_WHEELER", vehicle: "motorcycle" },
    reason: "calculated",
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// 1) เคสจริงต้องถูกจับ และเข้าถัง A
const real = classifyJob("-P0QekIHDPBe7phJhabu", REAL);
check("เคสจริง: ถูกจับ", real !== null);
check("เคสจริง: เข้าถัง A_travel_mode ไม่ใช่ C", real.bucket === "A_travel_mode");
check("เคสจริง: travel_mode DRIVE -> TWO_WHEELER", real.travel_mode_before === "DRIVE" && real.travel_mode_after === "TWO_WHEELER");
check("เคสจริง: shown 182 / settled 157 / delta -25", real.shown_estimate === 182 && real.settled_fee === 157 && real.delta === -25);
check("เคสจริง: ระยะ 24.37 -> 19.35", real.distance_km_before === 24.37 && real.distance_km_after === 19.35);
check("เคสจริง: ไม่มี rate field ไหนต่างกัน", real.rate_diffs.length === 0);
check("เคสจริง: ไม่ใช่ fallback (calculated ทั้งคู่)", real.fallback_involved === false);

// 2) ยอดที่เทียบต้องเป็นเลขของยานพาหนะคนนั้น ไม่ใช่ rider_fee_estimate เปล่า
//    ไรเดอร์รถยนต์เห็น 222 บนการ์ด ขณะที่ rider_fee_estimate เก็บ 182 (ของมอไซค์)
const carJob = clone(REAL);
carJob.rider_fee_estimate_meta.rates.vehicle = "car";
carJob.rider_fee_meta.rates.vehicle = "car";
carJob.rider_fee = 197;
const car = classifyJob("car", carJob);
check("รถยนต์: shown = fee_by_vehicle.car (222) ไม่ใช่ rider_fee_estimate (182)", car.shown_estimate === 222);
check("รถยนต์: delta = 197 - 222 = -25", car.delta === -25);
check("shownEstimate ตกกลับไป rider_fee_estimate เมื่อไม่มี fee_by_vehicle",
  shownEstimate({ rider_fee_estimate: 99, rider_fee_estimate_meta: { rates: { vehicle: "motorcycle" } } }) === 99);

// 3) ใบที่ไม่ควรถูกนับ
check("ไม่ใช่ Pickup = ไม่นับ", classifyJob("x", { ...clone(REAL), receive_method: "Store-in" }) === null);
check("ไม่มีไรเดอร์ = ไม่นับ", classifyJob("x", { ...clone(REAL), rider_id: null }) === null);
const notDone = clone(REAL);
delete notDone.rider_fee_meta;
check("ยังไม่ปิดจ๊อบ (ไม่มี rider_fee_meta) = ไม่นับ", classifyJob("x", notDone) === null);
const noEstimate = clone(REAL);
delete noEstimate.rider_fee_estimate_meta;
check("ไม่มี estimate_meta = ไม่นับ (ไม่มีอะไรให้เทียบ)", classifyJob("x", noEstimate) === null);

// 4) ใบที่ทุกอย่างเหมือนกัน = ไม่นับ (ด่านกันการรายงานเกินจริง)
const same = clone(REAL);
same.rider_fee_meta = clone(REAL.rider_fee_estimate_meta);
check("ฐานเดียวกันทั้งใบ = ไม่นับ", classifyJob("x", same) === null);

// 5) ถัง B — อัตราเปลี่ยน แต่ travel_mode เดิม
const rateChanged = clone(REAL);
rateChanged.rider_fee_meta.rates.travel_mode = "DRIVE"; // เท่าเดิม
rateChanged.rider_fee_meta.rates.per_km = 7;
rateChanged.rider_fee_meta.distance_km = 24.37; // ระยะเท่าเดิมด้วย
const bRow = classifyJob("x", rateChanged);
check("อัตราเปลี่ยน travel_mode เดิม = ถัง B", bRow && bRow.bucket === "B_rate_fields");
check("ถัง B: รายงานว่า per_km 5 -> 7", bRow.rate_diffs.length === 1 && bRow.rate_diffs[0].field === "per_km" && bRow.rate_diffs[0].after === 7);

// 6) ถัง C — อัตราและโหมดเหมือนกันหมด เหลือแต่ระยะต่าง
const distOnly = clone(REAL);
distOnly.rider_fee_meta.rates.travel_mode = "DRIVE";
const cRow = classifyJob("x", distOnly);
check("โหมดและอัตราเดิม เหลือระยะต่าง = ถัง C", cRow && cRow.bucket === "C_distance_only");

// 7) travel_mode ชนะ rate_diffs เมื่อเปลี่ยนพร้อมกัน (ถังต้องไม่ทับกัน)
const both = clone(REAL);
both.rider_fee_meta.rates.per_km = 7;
check("เปลี่ยนทั้งโหมดและอัตรา = เข้าถัง A (ถังไม่ทับกัน)", classifyJob("x", both).bucket === "A_travel_mode");

// 8) fallback ต้องถูกติดธง — ส่วนต่างของใบพวกนี้อธิบายด้วยฐานวัดอย่างเดียวไม่ได้
const fb = clone(REAL);
fb.rider_fee_meta.reason = "routes_api_timeout";
check("reason ไม่ใช่ calculated = ติดธง fallback_involved", classifyJob("x", fb).fallback_involved === true);

// 9) summarize แยก Paid ออกจากยังไม่จ่าย
const paid = clone(REAL);
paid.rider_fee_status = "Paid";
const rows = analyzeJobs({ a: REAL, b: paid }, "jobs");
const s = summarize(rows);
check("analyzeJobs: จับได้ 2 ใบ", rows.length === 2);
check("summarize: แยก paid 1 / unpaid 1", s.A_travel_mode.paid === 1 && s.A_travel_mode.unpaid === 1);
check("summarize: delta แยกกอง (-25 ต่อกอง)", s.A_travel_mode.delta_paid === -25 && s.A_travel_mode.delta_unpaid === -25);

// 10) analyzeJobs ต้องทนกับ node ว่าง/ค่าเสีย
check("analyzeJobs: node ว่าง = []", analyzeJobs(null, "jobs").length === 0);
check("analyzeJobs: ข้ามงานที่เป็น null", analyzeJobs({ a: null, b: REAL }, "jobs").length === 1);

console.log(failures === 0 ? "\nOK — ผ่านทั้งหมด" : `\nFAILED ${failures} เคส`);
process.exit(failures === 0 ? 0 : 1);
