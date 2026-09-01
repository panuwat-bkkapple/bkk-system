// ---------------------------------------------------------------------------
// วงจรชีวิตพนักงาน — แถวใน /staff ต้องไม่ถูกลบ และทุกการเปลี่ยนสิทธิ์ต้องมีร่องรอย
//
//   node functions/test/staff-lifecycle.test.mjs
//
// ทำไมต้องมีเทสนี้: `adminStaffDelete` เคยทำ `staff/{id}.remove()` จริง ซึ่งลบ
// ตัวตนของคนคนหนึ่งทิ้งทั้งใบ ทั้งที่ id ของเขาถูกประทับไว้บนงานที่เขาเคยแตะ
// (qc_logs, adjustments, rider_status_events.by_staff_id) — ทุกอ้างอิงกลายเป็น
// คีย์ที่ไม่มีอยู่ทันทีที่กดปุ่ม และ status_history ของ status machine v2 จะทำให้
// ปัญหานี้โตตามจำนวน transition ไม่ใช่ตามจำนวนคน
//
// เทสอ่าน SOURCE เพราะ staff-accounts.js ประกาศ callable ตอน import และทุก
// handler ต้องมี getDatabase()/getAuth() จริง — เรียก handler เดี่ยวๆ ในเทส
// offline ไม่ได้ และของที่ต้องกันคือ "มีคนเปลี่ยน .update กลับเป็น .remove"
// ซึ่งเป็นบรรทัดในไฟล์ ไม่ใช่ค่าที่ฟังก์ชันคืน (กฎเดียวกับ ledger-updated-by)
//
// ข้อ 6 เป็นตัวข้ามไฟล์: รูป by_* ต้องตรงกับ rider_status_events เป๊ะ ไม่งั้น
// ประวัติของคนสองกลุ่มจะ join ด้วยเงื่อนไขเดียวกันไม่ได้ ซึ่งเป็นปัญหาเดิมที่
// survey เจอ (คนคนเดียวถูกประทับบนงานด้วยสี่รูปแบบที่เข้ากันไม่ได้)
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const staffSrc = readFileSync(join(fnDir, "staff-accounts.js"), "utf8");
const riderSrc = readFileSync(join(fnDir, "rider-accounts.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/pages/settings/StaffManagement.tsx"), "utf8");

// ตัด handler ออกมาทีละตัว ไม่งั้นจะไปเจอ guard ของ handler ข้างเคียงแล้วผ่านฟรี
function handlerOf(name) {
  const start = staffSrc.indexOf(`exports.${name} = onCall`);
  if (start === -1) return null;
  const next = staffSrc.indexOf("\nexports.", start + 1);
  return staffSrc.slice(start, next === -1 ? staffSrc.length : next);
}

const del = handlerOf("adminStaffDelete");
const setStatus = handlerOf("adminStaffSetStatus");
const update = handlerOf("adminStaffUpdate");
const create = handlerOf("adminStaffCreate");
const resetPw = handlerOf("adminStaffResetPassword");

check("เจอ handler ครบทั้ง 5 ตัว", [del, setStatus, update, create, resetPw].every(Boolean));

// ── 1. หัวใจ: แถวใน /staff ต้องไม่ถูกลบ ─────────────────────────────────────
check(
  "adminStaffDelete ไม่ลบแถว staff/{id}",
  !!del && !/ref\(`staff\/\$\{staffId\}`\)\s*\.remove\(\)/.test(del)
);
check(
  "adminStaffDelete เขียน terminated_at แทน",
  !!del && /terminated_at:/.test(del) && /ref\(`staff\/\$\{staffId\}`\)\s*\.update\(/.test(del)
);
check(
  "adminStaffDelete ย้ายอีเมลไป email_at_termination (ปลดล็อกให้ออกบัญชีใหม่ด้วยอีเมลเดิมได้)",
  !!del && /email: null/.test(del) && /email_at_termination:/.test(del)
);

// ── 2. การถอนสิทธิ์ต้องไม่อ่อนลงเลย ─────────────────────────────────────────
// soft delete ที่แลกมาด้วยการปล่อยให้คนที่ออกไปแล้วยัง login ได้ = แย่กว่าเดิม
check("adminStaffDelete ยังลบ /admins/{uid}", !!del && /ref\(`admins\/\$\{existing\.uid\}`\)\s*\.remove\(\)/.test(del));
check("adminStaffDelete ยังลบบัญชี Auth", !!del && /deleteUser\(existing\.uid\)/.test(del));
check("adminStaffDelete ยังลบ FCM token", !!del && /admin_fcm_tokens/.test(del) && /\.remove\(\)/.test(del));

// ── 3. แถวที่ปิดบัญชีแล้วต้องแตะไม่ได้ทุกทาง ────────────────────────────────
// บัญชี Auth ถูกลบไปแล้ว การคืนสถานะจะไปเรียก updateUser บน uid ที่ไม่มีอยู่
// หลังจากเขียน /admins กลับไปแล้ว = คนที่ออกไปแล้วได้สิทธิ์ admin คืน
for (const [label, body] of [
  ["adminStaffSetStatus", setStatus],
  ["adminStaffUpdate", update],
  ["adminStaffResetPassword", resetPw],
  ["adminStaffDelete", del],
]) {
  check(`${label} ปฏิเสธแถวที่ terminated`, !!body && /isTerminated\(existing\)/.test(body));
}

// ── 4. ทุกการเปลี่ยนสิทธิ์ต้องเขียนประวัติ ──────────────────────────────────
const ACTIONS = ["created", "reissued", "role_changed", "suspended", "reactivated", "terminated", "password_reset"];
for (const action of ACTIONS) {
  // รับทั้ง `action: "x"` และรูป ternary `cond ? "a" : "x"`
  check(`มี event "${action}"`, new RegExp(`[:?]\\s*"${action}"`).test(staffSrc));
}
check(
  "ทุก handler ที่เปลี่ยนสิทธิ์เรียก recordStaffEvent",
  [del, setStatus, create, resetPw].every((b) => b && b.includes("recordStaffEvent(db,"))
);
check(
  "adminStaffUpdate เขียน event เมื่อ role เปลี่ยน",
  !!update && update.includes("recordStaffEvent(db,") && /prevRole !== role/.test(update)
);

// ── 5. เขียนประวัติต้อง best-effort ห้ามทำให้ operation ล้ม ─────────────────
// สิทธิ์ถูกเปลี่ยนไปแล้วจริงตอนที่เขียนประวัติ การโยน error จะทำให้ CEO เข้าใจว่า
// ไม่สำเร็จแล้วกดซ้ำ ซึ่งแย่กว่าประวัติขาดหนึ่งแถว
const recorder = staffSrc.slice(
  staffSrc.indexOf("async function recordStaffEvent"),
  staffSrc.indexOf("// ผู้กด")
);
check("recordStaffEvent จับ error เอง", /try\s*\{/.test(recorder) && /catch/.test(recorder));
check("recordStaffEvent ไม่ throw ต่อ", !/throw/.test(recorder));
check("เขียนลงโหนด staff_status_events", /ref\("staff_status_events"\)/.test(recorder));

// ── 6. รูป by_* ต้องตรงกับฝั่งไรเดอร์เป๊ะ ───────────────────────────────────
const byFields = (src) => [...src.matchAll(/\b(by_[a-z_]+):/g)].map((m) => m[1]);
const staffBy = [...new Set(byFields(staffSrc))].sort();
const riderBy = [...new Set(byFields(riderSrc))].sort();
check("rider-accounts.js ยังมีฟิลด์ by_* ให้เทียบ", riderBy.length > 0);
check(
  `by_* ของสองไฟล์ตรงกัน (${staffBy.join(",")})`,
  staffBy.length > 0 && staffBy.join(",") === riderBy.join(",")
);

// ── 7. UI ต้องไม่สัญญาสิ่งที่ server ไม่ได้ทำแล้ว ───────────────────────────
check('ข้อความยืนยันเลิกใช้คำว่า "ถาวร"', !/ลบพนักงาน[^`]*ถาวร/.test(uiSrc));
check("UI รู้จักแถวที่ปิดบัญชีแล้ว", /terminated_at/.test(uiSrc));
check("UI ซ่อนปุ่มจัดการของแถวที่ปิดบัญชีแล้ว", /terminated \? \(/.test(uiSrc));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
