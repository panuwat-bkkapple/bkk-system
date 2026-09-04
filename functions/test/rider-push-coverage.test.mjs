// ---------------------------------------------------------------------------
// สถานะ push ของไรเดอร์ที่แอดมินเห็น — ต้องอ่านจากรูปข้อมูลที่แอปไรเดอร์เขียนจริง
//
//   node functions/test/rider-push-coverage.test.mjs
//
// fixture คือรูปที่ usePushNotifications ของ bkk-rider-app เขียน:
//   riders/{id}/fcm_tokens/{deviceId} = { token, device, updated_at }
//   riders/{id}/fcm_updated_at        = ตัวเลข
// และแถวเก่าที่ยังมี riders/{id}/fcm_token (string) อย่างเดียว
//
// ผล injection — วัดจริงหลังรันทีละตัว ไม่ได้เขียนไว้ก่อน:
//   เส้น stale 7 → 30 วัน                      → แดง 4 จาก 21
//   ไม่ทิ้ง entry ที่ token ว่าง                  → แดง 1
//   ทิ้ง legacy fcm_token                         → แดง 2
//   มี token แต่ไม่มีเวลา = ok แทน stale           → แดง 1
//   เอาเวลาแรกแทนเวลาล่าสุด (สองเครื่อง)          → แดง 1
//   ไม่อ่าน fcm_updated_at                        → แดง 2
//   สรุปฝูง: stale ถูกนับเป็น none                 → แดง 2
// ทุกกฎมีเทสไปถึงอย่างน้อยหนึ่งตัว — ไม่มีด่านที่ไปไม่ถึงให้ลบ
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { assessRiderPushHealth, summarizeRiderPushCoverage, STALE_MS } = require("../rider-push-coverage.js");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

// --- รูปที่แอปเขียนวันนี้ ---
const fresh = assessRiderPushHealth({
  fcm_tokens: { abc123: { token: "tok-1", device: "ios", updated_at: NOW - 5 * 60_000 } },
  fcm_updated_at: NOW - 5 * 60_000,
}, NOW);
check("token สด 5 นาที = ok", fresh.level === "ok");
check("นับ 1 เครื่อง", fresh.devices === 1);
check("updatedAt คือเวลาที่เขียน", fresh.updatedAt === NOW - 5 * 60_000);

// --- สองเครื่อง เอาเวลาล่าสุด ---
const two = assessRiderPushHealth({
  fcm_tokens: {
    old: { token: "a", updated_at: NOW - 30 * DAY },
    new: { token: "b", updated_at: NOW - 1 * DAY },
  },
}, NOW);
check("สองเครื่อง นับ 2", two.devices === 2);
check("เวลาล่าสุดชนะ (เครื่องใหม่ต่ออายุแล้ว) = ok", two.level === "ok" && two.updatedAt === NOW - 1 * DAY);

// --- ไม่ได้เปิดแอปเกิน 7 วัน ---
const stale = assessRiderPushHealth({
  fcm_tokens: { d: { token: "t", updated_at: NOW - 8 * DAY } },
  fcm_updated_at: NOW - 8 * DAY,
}, NOW);
check("8 วัน = stale", stale.level === "stale");
check("6 วันยัง ok — เส้นอยู่ที่ 7", assessRiderPushHealth({ fcm_tokens: { d: { token: "t", updated_at: NOW - 6 * DAY } } }, NOW).level === "ok");
check("STALE_MS = 7 วัน ตรงกับการ์ดในแอปไรเดอร์", STALE_MS === 7 * DAY);

// --- server ตัด token ทิ้งหมดแล้ว (เคสที่ probe มีไว้จับ) ---
const none = assessRiderPushHealth({ fcm_updated_at: NOW - 2 * DAY }, NOW);
check("fcm_tokens หายแต่ fcm_updated_at ยังอยู่ = none (token ถูกตัดทิ้ง)", none.level === "none" && none.devices === 0);
check("updatedAt ยังรายงานได้ เพื่อบอกว่าเคยลงทะเบียนเมื่อไหร่", none.updatedAt === NOW - 2 * DAY);
check("ไม่มีอะไรเลย = none", assessRiderPushHealth({}, NOW).level === "none");
check("null = none ไม่ throw", assessRiderPushHealth(null, NOW).level === "none");

// --- entry เสีย (token ว่าง) ไม่นับ ---
check("entry ที่ token ว่างไม่นับเป็นเครื่อง", assessRiderPushHealth({ fcm_tokens: { x: { token: "", updated_at: NOW } } }, NOW).level === "none");

// --- แถวเก่า legacy fcm_token อย่างเดียว ---
const legacy = assessRiderPushHealth({ fcm_token: "legacy-token", fcm_updated_at: NOW - 1 * DAY }, NOW);
check("legacy fcm_token นับเป็น 1 เครื่อง", legacy.devices === 1 && legacy.level === "ok");
check("legacy ไม่มีเวลาเลย = stale (ไม่รู้ว่าเมื่อไหร่ ต้องไม่บอกว่า ok)", assessRiderPushHealth({ fcm_token: "legacy" }, NOW).level === "stale");

// --- สรุปทั้งฝูง ---
const summary = summarizeRiderPushCoverage([
  { id: "r1", name: "เอ", rider: { fcm_tokens: { d: { token: "t", updated_at: NOW - DAY } } } },
  { id: "r2", name: "บี", rider: { fcm_tokens: { d: { token: "t", updated_at: NOW - 10 * DAY } } } },
  { id: "r3", name: "ซี", rider: {} },
  { id: "r4", rider: {} },
], NOW);
check("total นับครบ", summary.total === 4);
check("ok 1", summary.ok === 1);
check("stale รายชื่อ", summary.stale.length === 1 && summary.stale[0] === "บี");
check("none รายชื่อ — ไม่มีชื่อใช้ id แทน", summary.none.length === 2 && summary.none[0] === "ซี" && summary.none[1] === "r4");
check("ลิสต์ว่างไม่พัง", summarizeRiderPushCoverage([], NOW).total === 0);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
