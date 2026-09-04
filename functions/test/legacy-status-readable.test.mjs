// แถวเก่าที่ยังอยู่บน production ต้องอ่านออก — ไม่ใช่เรื่องความสะอาด
//
// ตอนนี้ปุ่มแอดมินเกือบทั้งหมดเดินผ่าน `transitionJob` แล้ว และด่านแรกสุดของ
// engine คือ `normalizeStatus(job.status)` ถ้าอ่านไม่ออกมันตอบ unreadable_status
// **ก่อนถึง from-list เสียด้วย** แปลว่างานที่ค้างอยู่ที่สถานะซึ่งอ่านไม่ออก =
// ทุกปุ่มบนงานใบนั้นตาย โดยไม่มี error ให้ใครเห็นนอกจากคนที่กดอยู่
//
// และตัวที่ควรจะแก้แถวพวกนี้ก็ช่วยไม่ได้: `runStatusMigration` อ่านสถานะด้วย
// `normalizeStatus` ตัวเดียวกันนี้ (`resolveCanonical` ใน functions/index.js)
// แล้วข้ามแถวที่อ่านไม่ออกด้วย `if (!canonical) return` — มันข้ามแถวที่มันถูก
// เขียนขึ้นมาเพื่อแก้พอดี **ด่านล่างจึงตรึงความเป็นวงกลมข้อนี้ไว้ ไม่ใช่แค่
// ตรึงตาราง alias**
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { normalizeStatus, JOB_STATUS } = require(path.join(root, "functions/status-vocab.generated.js"));

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

check("PRICE ACCEPTED อ่านออกแล้ว", () => {
  // writer ถูกแก้ไปแล้ว (bkk-frontend-next /api/jobs/action เขียน canonical)
  // แต่แถวที่เขียนก่อนหน้านั้นยังอยู่ และเป็นสถานะกลางของดีล ไม่ใช่สถานะปิด
  assert.equal(normalizeStatus("PRICE ACCEPTED"), JOB_STATUS.PRICE_ACCEPTED);
});

check("migration จะเปลี่ยนชื่อแถวเก่าได้จริงแล้ว ไม่ข้ามอีก", () => {
  // จำลองเงื่อนไขจริงใน runStatusMigration:
  //   const canonical = resolveCanonical(job.status, job.receive_method);
  //   if (!canonical || canonical === job.status) return;   // <- เคยตกที่นี่
  const legacy = "PRICE ACCEPTED";
  const canonical = normalizeStatus(legacy, "Pickup");
  assert.ok(canonical, "อ่านไม่ออก migration จะข้ามแถวนี้เหมือนเดิม");
  assert.notEqual(canonical, legacy, "ต้องต่างจากเดิม ไม่งั้น migration ก็ข้าม");
});

check("ตัวที่ migration แก้ได้ ต้องอ่านออกทุกตัว — ความเป็นวงกลมของด่าน", () => {
  // ทุก key ใน LEGACY_ALIAS ต้องอ่านออกและต้องไม่เท่าตัวเอง มิฉะนั้นมันคือ
  // รายการที่ migration มองไม่เห็นทั้งที่ตั้งใจใส่ไว้ให้มันแก้
  for (const legacy of ["PAID", "Payment Completed", "Active Leads", "Waiting for Handover",
                        "Sent to QC Lab", "Ready to Sell", "Assigned", "Accepted",
                        "Heading to Customer", "Arrived", "Returned", "PRICE ACCEPTED"]) {
    const canonical = normalizeStatus(legacy, "Pickup");
    assert.ok(canonical, `${legacy} อ่านไม่ออก`);
    assert.notEqual(canonical, legacy, `${legacy} แปลงเป็นตัวเองซึ่ง migration จะข้าม`);
  }
});

check("'Reserved' เป็น canonical ของตัวเอง ไม่ใช่ alias ของ In Stock", () => {
  // ช่องที่ย่อหน้านี้เคยบอกว่า "ยังเปิดอยู่" ถูกปิดใน P3-f — เพิ่ม RESERVED เข้า
  // enum ทั้ง 3 repo แล้ว
  //
  // **สำคัญกว่าการที่มันอ่านออก คือมันต้องไม่ถูก alias ไป In Stock** — เครื่อง
  // ที่ล็อตขายส่งจองไว้กับเครื่องที่ว่างอยู่บนชั้นเป็นคนละเรื่อง และการปลดล็อต
  // คืนค่าจาก `lot_private/{lotId}/prev_status` ซึ่งอาจเป็น Ready To Sell ก็ได้
  // ถ้า alias ไป In Stock ความต่างนั้นหายตั้งแต่ตอนอ่าน
  //
  // อยู่ในไฟล์นี้เพราะไฟล์นี้ตรึง "อะไรอ่านออก/ไม่ออก" — และเทสข้างบนบังคับว่า
  // ทุก key ใน LEGACY_ALIAS ต้องแปลงเป็นค่าอื่น ดังนั้น Reserved จะเข้า
  // LEGACY_ALIAS ไม่ได้เลย มันต้องเป็นสมาชิกของ JOB_STATUS เท่านั้น
  assert.equal(normalizeStatus("Reserved"), "Reserved");
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
