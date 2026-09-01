// ---------------------------------------------------------------------------
// การเปลี่ยนสถานะไรเดอร์ — ด่านของ rider-accounts.js
//
//   node functions/test/rider-lifecycle.test.mjs
//
// สองอย่างที่เทสนี้กัน และเหตุผลที่มันคุ้มกว่าที่หน้าตาบอก:
//
//   1. `BLOCKS_LOGIN` คือการตัดสินใจเรื่องความปลอดภัยที่ทั้งฟีเจอร์ยืนอยู่บน
//      มัน — แอปไรเดอร์เช็คตอน login แค่ `status === 'Pending'` เท่านั้น
//      (bkk-rider-app/src/pages/Login.tsx) แปลว่าคนที่ถูก Rejected หรือ
//      Suspended **ยังผ่านด่านนั้นได้** ตัวที่กันจริงคือการปิดบัญชี Auth ซึ่ง
//      เกิดขึ้นก็ต่อเมื่อ action อยู่ในเซ็ตนี้ ถ้าวันหนึ่งมีคนถอด "reject"
//      ออกไปเพราะดูเหมือนไม่จำเป็น จะไม่มีอะไรพังให้เห็นเลย — คนที่ถูก
//      ปฏิเสธจะแค่ login ได้เงียบๆ
//
//   2. `effectiveApprovalStatus` เป็น MIRROR ของ normalizeRider ในหน้าแอดมิน
//      (src/pages/fleet/RiderManagement.tsx) ซึ่งเป็นรูปแบบบั๊กที่แพงที่สุด
//      ของ repo นี้ (สำเนาสองฝั่งที่ค่อยๆ เดินห่างกัน) เทสจึงยึดจากเคสจริงใน
//      ข้อมูล: record ที่เพิ่งสมัคร (มีแต่ status: 'Pending'), record ของคนที่
//      กำลังออนไลน์ (status เป็น Online/Busy = สถานะการทำงาน ไม่ใช่สถานะ
//      การอนุมัติ) และ record เก่าที่ไม่มีอะไรเลย
// ---------------------------------------------------------------------------

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ci";

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { effectiveApprovalStatus, ACTIONS, BLOCKS_LOGIN } = require(
  join(here, "..", "rider-accounts.js")
);

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// --- 1. action ที่ต้องปิดบัญชี Auth --------------------------------------
check("suspend ปิดบัญชี Auth", BLOCKS_LOGIN.has("suspend"));
check("reject ปิดบัญชี Auth ด้วย (ด่าน login เช็คแค่ Pending)", BLOCKS_LOGIN.has("reject"));
check("approve ไม่ปิดบัญชี", !BLOCKS_LOGIN.has("approve"));
check("unsuspend ไม่ปิดบัญชี", !BLOCKS_LOGIN.has("unsuspend"));

// --- 2. ทุก action เขียนธงทั้งสองตัวเสมอ ----------------------------------
// `approval_status` = ธงที่หน้าแอดมินอ่าน, `status` = ธงที่แอปไรเดอร์อ่าน
// ปล่อยให้ตัวใดตัวหนึ่งหายไป = สองฝั่งเห็นคนละความจริง
for (const [action, fields] of Object.entries(ACTIONS)) {
  check(
    `${action}: เขียนทั้ง approval_status และ status`,
    typeof fields.approval_status === "string" && typeof fields.status === "string"
  );
}
check("approve/unsuspend พาไปสถานะ Active", ACTIONS.approve.status === "Active" && ACTIONS.unsuspend.status === "Active");
check("reject พาไปสถานะ Rejected", ACTIONS.reject.approval_status === "Rejected");
check("suspend พาไปสถานะ Suspended", ACTIONS.suspend.approval_status === "Suspended");

// --- 3. effectiveApprovalStatus (mirror ของ normalizeRider) ---------------
const cases = [
  // [ชื่อเคส, record, ค่าที่ต้องได้]
  ["สมัครใหม่ ยังไม่มี approval_status", { status: "Pending" }, "Pending"],
  ["approval_status มีอยู่แล้ว ใช้ค่านั้น", { approval_status: "Suspended", status: "Offline" }, "Suspended"],
  ["กำลังออนไลน์ = ผ่านการอนุมัติแล้ว", { status: "Online" }, "Active"],
  ["ออฟไลน์ก็ยังคือผ่านการอนุมัติแล้ว", { status: "Offline" }, "Active"],
  ["กำลังวิ่งงาน", { status: "Busy" }, "Active"],
  ["record เปล่า = ถือว่ารออนุมัติ", {}, "Pending"],
  ["ถูกปฏิเสธไว้ ไม่มี approval_status", { status: "Rejected" }, "Rejected"],
];
for (const [label, rider, expected] of cases) {
  const got = effectiveApprovalStatus(rider);
  check(`${label} → ${expected}`, got === expected);
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
