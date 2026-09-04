// ---------------------------------------------------------------------------
// สวิตช์การแจ้งเตือนต้องรู้จัก data.type ที่ codebase ฝั่งไรเดอร์ส่ง
//
//   node functions/test/notification-settings-rider.test.mjs
//
// ที่มา (bkk-rider-app/docs/reports/2026-09-03-rider-push-delivery-survey.md ข้อ I):
// push งานใหม่/broadcast/แชทของไรเดอร์ส่งจาก bkk-rider-app/functions ซึ่งไม่เคย
// อ่านสวิตช์เลย — ตอนนี้ฝั่งนั้น gate ด้วยตารางเดียวกันนี้ (MIRROR ที่
// notificationGate.ts ของรีโปนั้น มีเทสอ่านไฟล์นี้มาเทียบ) เทสนี้จึงตรึงสามบรรทัด
// ไว้จากฝั่งเจ้าของตาราง: ลบ/เปลี่ยนหมวดเมื่อไหร่แดงที่นี่ก่อนไปแดงที่รีโปนั้น
//
// ผล injection — วัดจริงหลังรันทีละตัว ไม่ได้เขียนไว้ก่อน:
//   ลบบรรทัด chat ออกจาก EVENT_CATEGORY        → แดง 3 จาก 14
//   broadcast_job ชี้หมวดผิด (field_ops)         → แดง 3
//   job_status ชี้หมวดผิด (chat_message)         → แดง 3
// ---------------------------------------------------------------------------

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { EVENT_CATEGORY, shouldNotify, notificationCategory } = require("../notification-settings.js");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const RIDER_TYPES = { chat: "chat_message", job_status: "status_change", broadcast_job: "new_ticket" };

for (const [type, category] of Object.entries(RIDER_TYPES)) {
  check(`EVENT_CATEGORY.${type} === "${category}"`, EVENT_CATEGORY[type] === category);
  check(`notificationCategory("${type}") === "${category}"`, notificationCategory(type) === category);
}

// พฤติกรรมผ่าน shouldNotify — ช่อง rider_push
const off = { channels: { rider_push: false } };
for (const type of Object.keys(RIDER_TYPES)) {
  const d = shouldNotify(off, "rider_push", { data: { type } });
  check(`rider_push=false ปิด ${type}`, d.allowed === false && d.reason === "channel:rider_push");
}
check("rider_push=false ไม่กระทบ admin_push", shouldNotify(off, "admin_push", { data: { type: "chat" } }).allowed === true);

// หมวด
check("ปิด chat_message = แชทไรเดอร์เงียบ", shouldNotify({ events: { chat_message: false } }, "rider_push", { data: { type: "chat" } }).allowed === false);
check("ปิด chat_message ไม่กระทบ job_status", shouldNotify({ events: { chat_message: false } }, "rider_push", { data: { type: "job_status" } }).allowed === true);
check("ปิด new_ticket = broadcast เงียบ", shouldNotify({ events: { new_ticket: false } }, "rider_push", { data: { type: "broadcast_job" } }).allowed === false);
check("ไม่มี settings = ส่ง (fail-open)", shouldNotify({}, "rider_push", { data: { type: "job_status" } }).allowed === true);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
