// ---------------------------------------------------------------------------
// meta ของค่าจ้างไรเดอร์ — ด่านกัน "ตัวเลขที่คำนวณแล้วถูกทิ้ง"
//
//   node functions/test/rider-fee-meta.test.mjs
//
// ทำไมมีไฟล์นี้: computeRiderFee ยิง Routes API แล้วได้ระยะทาง **และเวลา**
// กลับมา (และยิงรอบที่สองด้วยซ้ำเมื่อโหมดของยานพาหนะต่างจากฐานที่ใช้คิดเงิน
// เพื่อให้ ETA แม่นขึ้น) แต่ meta เดิมเก็บแค่ 5 ฟิลด์ — `duration_min` ถูกทิ้ง
// ทุกครั้งทั้งที่จ่ายเงินไปถามแล้ว เช่นเดียวกับ travel_mode / eta_travel_mode
// (คำตอบของ "เลขนี้มาจากฐานไหน") และ branch_source (คำตอบของ "วัดไปสาขาไหน"
// ซึ่ง resolveBranchCoords มี fallback สามชั้น)
//
// ด่านนี้จะแดงถ้ามีใครถอดฟิลด์ออกอีก หรือเปลี่ยนคีย์ที่หายให้กลายเป็นการละคีย์
// ทิ้งแทนการเป็น null (ซึ่งทำให้แถวเก่ากับแถวที่คำนวณแล้วไม่มีค่าแยกกันไม่ออก)
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { riderFeeMeta, finiteOrNull, pointOrNull } = require(join(here, "..", "rider-fee-meta.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else { console.log(`FAIL  ${label}`); failures += 1; }
};

const NOW = 1_700_000_000_000;

// รูปของผลลัพธ์ตอน Routes API ตอบสำเร็จ (ตาม computeRiderFee ใน index.js)
const calculated = {
  fee: 245,
  fee_by_vehicle: { motorcycle: 245, car: 320 },
  distance_km: 12.34,
  duration_min: 27,
  travel_mode: "DRIVE",
  eta_travel_mode: "TWO_WHEELER",
  vehicle: "motorcycle",
  eta_vehicle: "motorcycle",
  branch_source: "branches/main",
  rates: { vehicle: "motorcycle", base_fee: 60, per_km: 15, min_fee: 100, max_fee: 500, travel_mode: "DRIVE" },
  reason: "calculated",
};

const m = riderFeeMeta(calculated, NOW);

check("เก็บระยะทาง", m.distance_km === 12.34);
check("เก็บเวลาเดินทางที่ Routes API ตอบมา (เดิมถูกทิ้ง)", m.duration_min === 27);
check("เก็บฐานที่ใช้วัดระยะทาง (เงิน)", m.travel_mode === "DRIVE");
check("เก็บฐานที่ใช้วัดเวลา (ETA) แยกจากกัน", m.eta_travel_mode === "TWO_WHEELER");
check("เก็บสาขาปลายทางที่ resolve ได้", m.branch_source === "branches/main");
check("เก็บค่าจ้างของทั้งสองยานพาหนะ", m.fee_by_vehicle.car === 320);
check("คัดลอกการ์ดอัตราทั้งชุด ไม่ใช่แค่ชี้ไป", m.rates.per_km === 15);
check("เก็บเหตุผล", m.reason === "calculated");
check("เวลาที่คำนวณรับเข้ามาได้ (เทสตรึงค่าได้)", m.computed_at === NOW);

// --- เส้นทางที่วัดระยะไม่ได้ -------------------------------------------------
const noCoords = riderFeeMeta({
  fee: 100,
  fee_by_vehicle: { motorcycle: 100, car: 100 },
  distance_km: null,
  duration_min: null,
  travel_mode: "DRIVE",
  branch_source: "job.branch_details",
  rates: { min_fee: 100 },
  reason: "missing_customer_coords",
}, NOW);

check("ไม่มีหมุดลูกค้า: distance_km เป็น null ไม่ใช่ 0", noCoords.distance_km === null);
check("ไม่มีหมุดลูกค้า: duration_min เป็น null ไม่ใช่ 0", noCoords.duration_min === null);
check("ไม่มีหมุดลูกค้า: ยังบอกได้ว่าสาขาไหน resolve ได้", noCoords.branch_source === "job.branch_details");
check("ไม่มีหมุดลูกค้า: เหตุผลติดมาด้วย", noCoords.reason === "missing_customer_coords");

const routesDown = riderFeeMeta({
  fee: 100,
  fee_by_vehicle: { motorcycle: 100, car: 100 },
  travel_mode: "DRIVE",
  branch_source: "branches/main",
  rates: { min_fee: 100 },
  reason: "routes_api_timeout",
}, NOW);
check("Routes API ล้ม: แยกออกจากเคสไม่มีหมุดด้วย reason", routesDown.reason === "routes_api_timeout");
check("Routes API ล้ม: ระยะทางเป็น null", routesDown.distance_km === null);

// --- กติกา "ห้ามละคีย์ทิ้ง" --------------------------------------------------
const KEYS = [
  "distance_km", "duration_min", "fee_by_vehicle", "rates",
  "travel_mode", "eta_travel_mode", "branch_source", "reason", "computed_at",
  "measured_from", "measured_to",
];
const empty = riderFeeMeta({}, NOW);
check(
  "ผลลัพธ์ว่างเปล่าก็ยังมีคีย์ครบทุกตัว (คีย์ที่หายไปอ่านย้อนหลังแยกไม่ออกจากแถวเก่า)",
  KEYS.every((k) => k in empty),
);
check("ผลลัพธ์ว่าง: ทุกค่าที่ไม่มีเป็น null ไม่ใช่ undefined", 
  KEYS.filter((k) => k !== "computed_at").every((k) => empty[k] === null));
check("เรียกโดยไม่ส่ง result เลยก็ไม่ throw", (() => {
  try { riderFeeMeta(undefined, NOW); return true; } catch { return false; }
})());

// --- พิกัดที่ใช้วัดจริง ------------------------------------------------------
//
// branch_source บอกได้แค่ว่า resolveBranchCoords ตกชั้นไหน (`branches/{id}`)
// ไม่ได้บอกว่าหมุดนั้นอยู่ตรงไหน และหมุดสาขาแก้ได้ทีหลัง ส่วนหมุดลูกค้าแอดมิน
// ขยับได้ตลอด — ไม่เก็บไว้ตอนคำนวณ คำถาม "ตกลงเลขนี้วัดจากหมุดไหน" ตอบไม่ได้เลย
const withCoords = riderFeeMeta({
  origin_lat: 13.74, origin_lng: 100.53, dest_lat: 13.85, dest_lng: 100.61,
}, NOW);
check("เก็บพิกัดต้นทางที่ใช้วัดจริง",
  withCoords.measured_from && withCoords.measured_from.lat === 13.74 && withCoords.measured_from.lng === 100.53);
check("เก็บพิกัดปลายทางที่ใช้วัดจริง",
  withCoords.measured_to && withCoords.measured_to.lat === 13.85 && withCoords.measured_to.lng === 100.61);

check("ไม่มีพิกัดเลย = null ทั้งคู่ (ไม่ใช่ {lat:0,lng:0} ซึ่งเป็นพิกัดกลางมหาสมุทร)",
  empty.measured_from === null && empty.measured_to === null);

// พิกัดครึ่งใบใช้ไม่ได้ — เก็บไว้จะทำให้คนตรวจเห็นหมุดที่ไม่มีอยู่จริง
check("มี lat ไม่มี lng = null ไม่ใช่ครึ่งพิกัด",
  riderFeeMeta({ origin_lat: 13.74 }, NOW).measured_from === null);
check("มี lng ไม่มี lat = null",
  riderFeeMeta({ dest_lng: 100.61 }, NOW).measured_to === null);

// 0,0 เป็นพิกัดที่ถูกต้องตามหลัก (อ่าวกินี) — ตัวกรองต้องไม่ตัดทิ้งเพราะเป็นศูนย์
check("พิกัด 0,0 ไม่ถูกตัดทิ้ง (Number(null) === 0 คนละเรื่องกับค่าศูนย์จริง)",
  (() => { const m = riderFeeMeta({ origin_lat: 0, origin_lng: 0 }, NOW);
    return m.measured_from && m.measured_from.lat === 0 && m.measured_from.lng === 0; })());

check("สตริงตัวเลขจาก RTDB ยังอ่านเป็นพิกัดได้",
  (() => { const m = riderFeeMeta({ dest_lat: "13.85", dest_lng: "100.61" }, NOW);
    return m.measured_to && m.measured_to.lat === 13.85; })());

// --- finiteOrNull ------------------------------------------------------------
check("finiteOrNull: 0 เป็นตัวเลขที่ใช้ได้", finiteOrNull(0) === 0);
check("finiteOrNull: null/undefined/NaN = null", 
  finiteOrNull(null) === null && finiteOrNull(undefined) === null && finiteOrNull(NaN) === null);
check("finiteOrNull: สตริงตัวเลขจาก RTDB ยังอ่านได้", finiteOrNull("12.5") === 12.5);
check("finiteOrNull: สตริงที่ไม่ใช่ตัวเลข = null", finiteOrNull("ยังไม่คิด") === null);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
