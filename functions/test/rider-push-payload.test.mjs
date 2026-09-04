// ---------------------------------------------------------------------------
// push ถึงไรเดอร์ต้องออกจาก pushToRider เป็น data-only เสมอ
//
//   node functions/test/rider-push-payload.test.mjs
//
// ที่มา: bkk-rider-app/docs/reports/2026-09-03-rider-push-delivery-survey.md
// ข้อ D — ทั้ง 11 call site ของ pushToRider ส่ง `notification: {title, body}`
// โดย data ไม่มี title/body ผลบนเครื่องไรเดอร์คือเด้งสองใบ ใบที่สองเป็น
// "BKK Rider" เนื้อว่าง
//
// เทสสองชั้น: (1) พฤติกรรมของตัวแปลง บน payload จริงของ call site
// (2) อ่าน SOURCE ของ pushToRider ว่ายังส่งผ่านตัวแปลงอยู่ — เพราะการแก้กลับ
// ที่กลัวคือ "มีคนเอา { ...message, tokens } กลับมา" ซึ่งเป็นบรรทัดในไฟล์
// ไม่ใช่ค่าที่ฟังก์ชันคืน (รูปเดียวกับ ledger-updated-by.test.mjs)
//
// ผล injection — วัดจริงหลังรันทีละตัว (ร่างแรกเขียน 5/4 ไว้จากการเดา ซึ่งผิด
// ทั้งคู่ — ตัวเลขที่เดาแล้วอ่านเหมือนวัดมา อันตรายกว่าการไม่ใส่เลย):
//   ไม่ถอด notification ออก                         → แดง 3 จาก 14
//   ไม่ย้าย title/body ลง data                        → แดง 3
//   data ที่มีอยู่แล้ว ถูก notification ทับ            → แดง 1
//   ไม่แปลงค่าที่ไม่ใช่ string / ไม่ทิ้ง null         → แดง 2
//   pushToRider กลับไปส่ง { ...message, tokens } ตรงๆ → แดง 1
//   ไม่ trim title/body                               → แดง 1
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
const { toDataOnlyRiderPush } = require("../rider-push-payload.js");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// --- payload จริงจาก onPickupScheduleRescheduled (index.js) ---
const rescheduled = toDataOnlyRiderPush({
  notification: {
    title: "🔄 นัดหมายถูกเลื่อน",
    body: "iPhone 14 · คุณเอ · เวลาใหม่ 2026-09-05 13:00",
  },
  data: { type: "appointment_rescheduled", jobId: "J1", newDate: "2026-09-05", newTime: "13:00" },
  android: { priority: "high" },
  apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
});
check("ถอด notification ออก", !("notification" in rescheduled));
check("title ย้ายลง data", rescheduled.data.title === "🔄 นัดหมายถูกเลื่อน");
check("body ย้ายลง data", rescheduled.data.body === "iPhone 14 · คุณเอ · เวลาใหม่ 2026-09-05 13:00");
check("data เดิมยังอยู่ครบ (type ที่ shouldNotify ใช้ gate)", rescheduled.data.type === "appointment_rescheduled" && rescheduled.data.jobId === "J1");
check("android/apns ส่งผ่านตามเดิม", rescheduled.android?.priority === "high" && rescheduled.apns?.payload?.aps?.sound === "default");

// --- payload จริงจาก reviewAmendment (reject) — data ไม่มี title/body ---
const rejected = toDataOnlyRiderPush({
  notification: { title: "❌ Admin ยกเลิก job", body: "Job #AB12" },
  data: { type: "amendment_rejected", amendmentId: "am1", jobId: "J2", rejectAction: "cancel_job" },
});
check("amendment_rejected: ไม่มี notification", rejected.notification === undefined);
check("amendment_rejected: data.title/body มาจาก notification", rejected.data.title === "❌ Admin ยกเลิก job" && rejected.data.body === "Job #AB12");

// --- data ที่มี title อยู่แล้วต้องชนะ notification ---
const explicit = toDataOnlyRiderPush({
  notification: { title: "จาก notification", body: "เนื้อ notification" },
  data: { type: "x", title: "จาก data", body: "เนื้อ data" },
});
check("data.title ที่ส่งมาเองชนะ", explicit.data.title === "จาก data" && explicit.data.body === "เนื้อ data");

// --- ค่าใน data ต้องเป็น string ทุกตัว (ข้อกำหนด FCM) ---
const typed = toDataOnlyRiderPush({
  notification: { title: "t" },
  data: { type: "y", count: 3, flag: true, gone: null, missing: undefined },
});
check("ตัวเลข/boolean แปลงเป็น string", typed.data.count === "3" && typed.data.flag === "true");
check("null/undefined ถูกทิ้ง ไม่กลายเป็น 'null'", !("gone" in typed.data) && !("missing" in typed.data));

// --- ไม่มี notification เลย (call site ที่ส่ง data-only อยู่แล้ว) ต้องผ่านไม่เปลี่ยน ---
const plain = toDataOnlyRiderPush({ data: { type: "z", title: "หัว", body: "เนื้อ" } });
check("data-only เดิมผ่านตามเดิม", plain.data.title === "หัว" && plain.data.body === "เนื้อ" && !("notification" in plain));

// --- notification ว่าง / ช่องว่าง ไม่ทำให้เกิด data.title เปล่า ---
const blank = toDataOnlyRiderPush({ notification: { title: "   ", body: "" }, data: { type: "w" } });
check("title/body ที่ว่างไม่ถูกใส่ลง data", !("title" in blank.data) && !("body" in blank.data));

// --- (2) SOURCE: pushToRider ต้องส่งผ่านตัวแปลง ---
const src = readFileSync(join(root, "index.js"), "utf8");
const fnStart = src.indexOf("async function pushToRider(");
const fnEnd = src.indexOf("\nfunction shortJobId(", fnStart);
const body = src.slice(fnStart, fnEnd);
check("หา pushToRider ใน index.js เจอ", fnStart > 0 && fnEnd > fnStart);
check(
  "pushToRider ส่งผ่าน toDataOnlyRiderPush ไม่ใช่ { ...message, tokens } ตรงๆ",
  body.includes("toDataOnlyRiderPush(message)") && !body.includes("{ ...message, tokens }")
);

if (failures) {
  console.log(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
