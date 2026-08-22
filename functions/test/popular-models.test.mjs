// ---------------------------------------------------------------------------
// popular-models — "รุ่นที่คนขายมากที่สุด" ต้องมาจากยอดขายจริง นับถูกตัว
//
//   node functions/test/popular-models.test.mjs
//
// เทสเขียนจากรูปงานจริงสองทางเข้า: งานลูกค้า (validateAndCreateOrder) มี
// devices[].model_id ส่วนงานแอดมิน (CreateTicketModal/InstantSellModal) มีแค่
// ชื่อรุ่นใน `model` และชื่อนั้นอาจพ่วง variant ต่อท้าย — จุดพลาดคลาสสิกคือ
// prefix ชนกัน ("iPhone 15" ไปเคลมงานของ "iPhone 15 Pro") กับการนับ type ลูก
// (Accessory/B2B-Unpacked) ซ้ำกับงานแม่
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const { collectCounts, rankCounts, resolveNameToId, normName } = require(
  join(dirname(fileURLToPath(import.meta.url)), "..", "popular-models.js")
);

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const cutoff = NOW - 30 * DAY;

const CATALOG = [
  { id: "iphone-15", norm: normName("iPhone 15") },
  { id: "iphone-15-pro", norm: normName("iPhone 15 Pro") },
  { id: "iphone-15-pro-max", norm: normName("iPhone 15 Pro Max") },
  { id: "macbook-air-13-m2", norm: normName("MacBook Air 13\" (ชิป M2, 2022)") },
];

// --- resolveNameToId: ขอบคำต้องชนะ ไม่ใช่แค่ prefix ---
const sorted = [...CATALOG].sort((a, b) => b.norm.length - a.norm.length);
check(
  "ชื่อเพียว match ตรงตัว",
  resolveNameToId(normName("iPhone 15 Pro"), sorted) === "iphone-15-pro"
);
check(
  "ชื่อ + variant ต่อท้าย → รุ่นชื่อยาวสุดชนะ (ไม่ตกไป iPhone 15)",
  resolveNameToId(normName("iPhone 15 Pro 256GB"), sorted) === "iphone-15-pro"
);
check(
  "iPhone 15 128GB ยังเป็นของ iPhone 15 (ไม่โดนรุ่นยาวเคลม)",
  resolveNameToId(normName("iPhone 15 128GB"), sorted) === "iphone-15"
);
check(
  "prefix ที่ไม่จบตรงขอบคำไม่ match (iPhone 15S ไม่ใช่ iPhone 15)",
  resolveNameToId(normName("iPhone 15S"), sorted) === null
);
check(
  "ชื่อที่ไม่อยู่ใน catalog = null ไม่เดา",
  resolveNameToId(normName("Samsung S24"), sorted) === null
);

// --- collectCounts: งานจริงสองทางเข้า + ตัวที่ต้องข้าม ---
const jobs = [
  // งานลูกค้า 2 เครื่องในออเดอร์เดียว — นับต่อเครื่อง ไม่ใช่ต่อออเดอร์
  {
    created_at: NOW - 1 * DAY,
    status: "New Lead",
    devices: [{ model_id: "iphone-15-pro" }, { model_id: "macbook-air-13-m2" }],
  },
  // งานลูกค้าอีกใบ รุ่นเดิม
  { created_at: NOW - 2 * DAY, status: "Paid", devices: [{ model_id: "iphone-15-pro" }] },
  // งานแอดมิน — มีแต่ชื่อ (พ่วง variant)
  { created_at: NOW - 3 * DAY, status: "Active Leads", model: "iPhone 15 Pro 256GB" },
  { created_at: NOW - 4 * DAY, status: "Active Leads", model: "iPhone 15 128GB" },
  // ต้องข้าม: ยกเลิก / เครื่องลูกที่แตกจากงานแม่ / งานถอนเงิน
  { created_at: NOW - 5 * DAY, status: "Cancelled", devices: [{ model_id: "iphone-15" }] },
  { created_at: NOW - 5 * DAY, status: "In Stock", type: "Accessory", model: "Apple Pencil Pro" },
  { created_at: NOW - 5 * DAY, status: "Pending QC", type: "B2B-Unpacked", model: "iPhone 15" },
  { created_at: NOW - 5 * DAY, status: "Paid", type: "Withdrawal" },
  // ต้องข้าม: นอกหน้าต่าง 30 วัน / created_at เป็น string (หลุด startAt ฝั่ง RTDB ได้)
  { created_at: NOW - 45 * DAY, status: "Paid", devices: [{ model_id: "iphone-15" }] },
  { created_at: "2023-01-01", status: "Paid", devices: [{ model_id: "iphone-15" }] },
];

const { counts, nameCounts, jobsCounted } = collectCounts(jobs, cutoff);
check("นับงานที่เข้าเกณฑ์ครบ 4 ใบ", jobsCounted === 4);
check("iphone-15-pro จาก model_id = 2 เครื่อง", counts.get("iphone-15-pro") === 2);
check("macbook จาก model_id = 1 เครื่อง", counts.get("macbook-air-13-m2") === 1);
check("งานชื่ออย่างเดียวไปกอง nameCounts", nameCounts.get(normName("iPhone 15 Pro 256GB")) === 1);
check("งาน Cancelled ไม่ถูกนับ", ![...counts.keys()].includes("iphone-15") || counts.get("iphone-15") === undefined);

// --- rankCounts: รวมชื่อเข้า id แล้วเรียงตามยอด ---
const ranked = rankCounts(counts, nameCounts, CATALOG, 10);
check("อันดับ 1 = iphone-15-pro (2 จาก id + 1 จากชื่อ = 3)", ranked[0] === "iphone-15-pro");
check("iphone-15 ติดอันดับจากงานชื่อ 128GB", ranked.includes("iphone-15"));
check("ไม่มีรุ่นนอก catalog หลุดเข้าลิสต์", ranked.every((id) => CATALOG.some((c) => c.id === id)));

// limit ตัดจริง
check("limit ทำงาน", rankCounts(counts, nameCounts, CATALOG, 1).length === 1);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall popular-models tests passed");
