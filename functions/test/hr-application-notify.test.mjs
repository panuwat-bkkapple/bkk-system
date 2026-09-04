// =============================================================================
// แจ้งเตือนใบสมัครงานใหม่
//   node functions/test/hr-application-notify.test.mjs
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                              | ผล |
//   |--------------------------------------------------------|----|
//   | ใส่ชื่อ/เบอร์/อีเมลผู้สมัครลงข้อความแจ้งเตือน            | แดง 3 |
//   | ถอด `job_application` ออกจาก EVENT_CATEGORY             | แดง 1 |
//   | หมวด `hr` หายจาก CATEGORIES ฝั่ง server                 | แดง 1 |
//   | entry ของหมวด `hr` หายจาก MIRROR ฝั่ง TS                | แดง 1 |
//   | ทริกเกอร์ถูกสร้างแม้ไม่ได้ฉีด deps                       | แดง 1 |
//   | ยิงให้ทุกคนแทนที่จะเจาะ CEO/MANAGER                      | แดง 1 |
//
// **ข้อที่ไม่มีอะไรจับได้ และบันทึกไว้ตรงๆ:** ตัว `ref` ของทริกเกอร์
// (`/job_applications/{appId}`) — เปลี่ยนเป็น path อื่นแล้วไม่มีอะไรแดง เพราะ
// การตรวจว่ามันชี้ถูก path ต้องรัน Firebase จริง ซึ่งชุดออฟไลน์ทำไม่ได้
// จึงตรวจแค่ว่า **สตริง path โผล่ในไฟล์** ซึ่งเป็นการตรึงที่อ่อน และบันทึกไว้
// ตรงๆ ดีกว่าแต่ง fixture ให้ดูเหมือนมีด่าน
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, "..");

const N = require(join(FUNCTIONS, "notification-settings.js"));
const R = require(join(FUNCTIONS, "hr-recruitment-api.js"));
const apiSrc = readFileSync(join(FUNCTIONS, "hr-recruitment-api.js"), "utf8");
const tsMirror = readFileSync(join(FUNCTIONS, "..", "src", "utils", "notificationSettings.ts"), "utf8");

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

// ── 1. หมวดต้องถูกต่อสายจริง ไม่ใช่แค่มีชื่อ ────────────────────────────────
//
// `shouldNotify` fail-open — type ที่ไม่อยู่ใน map จะ "ส่งตามเดิม" เสมอ ซึ่ง
// แปลว่าลืมต่อสายแล้ว **สวิตช์ปิดไม่ลง** โดยไม่มี error บอก
{
  const cats = N.CATEGORIES || [];
  check("มีหมวด hr ฝั่ง server", cats.includes("hr"));
  const map = N.EVENT_CATEGORY || {};
  check("job_application ถูก map เข้าหมวด hr", map.job_application === "hr");
}

// ── 2. MIRROR ฝั่ง TS ต้องมีหมวดเดียวกัน ────────────────────────────────────
//
// functions เป็น JS import ไฟล์ TS ไม่ได้ หมวดจึงมีสองสำเนา — ขาดฝั่ง TS
// แปลว่าหน้า /notification-settings ไม่มีสวิตช์ให้ปิด ทั้งที่ server gate อยู่
{
  check("หมวด hr อยู่ใน union ของ TS", /\|\s*'hr'/.test(tsMirror));
  check("หมวด hr มี entry พร้อม label ใน TS", /key:\s*'hr'/.test(tsMirror));
}

// ── 3. ห้ามมี PII ในข้อความแจ้งเตือน ───────────────────────────────────────
//
// push ขึ้นหน้าจอล็อก และ Telegram มีคนอยู่ในห้องมากกว่าคนที่ควรเห็นใบสมัคร
// ตำแหน่งที่สมัครไม่ใช่ PII และพอให้รู้ว่าต้องไปเปิดดู
{
  const block = apiSrc.slice(apiSrc.indexOf("onJobApplicationCreated ="));
  const body = block.slice(0, block.indexOf("return {"));
  check("ไม่อ้าง full_name ในบล็อกแจ้งเตือน", !body.includes("full_name"));
  check("ไม่อ้าง phone ในบล็อกแจ้งเตือน", !/\bapp\.phone\b/.test(body));
  check("ไม่อ้าง email ในบล็อกแจ้งเตือน", !/\bapp\.email\b/.test(body));
  check("ใช้ตำแหน่งที่สมัครแทน", body.includes("position_title"));
  check("ชี้ไปหน้าที่ gate สิทธิ์แล้ว", body.includes("/recruitment"));
}

// ── 4. เจาะเฉพาะ CEO/MANAGER ───────────────────────────────────────────────
{
  const block = apiSrc.slice(apiSrc.indexOf("onJobApplicationCreated ="));
  const body = block.slice(0, block.indexOf("return {"));
  check("เรียก staffIdsByRoles ด้วย CEO/MANAGER", /staffIdsByRoles\(db, \["CEO", "MANAGER"\]\)/.test(body));
}

// ── 5. ไม่ฉีด deps = ไม่มีทริกเกอร์ ────────────────────────────────────────
//
// เทสชุดออฟไลน์ require ไฟล์นี้ตรงๆ โดยไม่มี Firebase app — ถ้าทริกเกอร์ถูก
// สร้างเสมอ ชุดเทสจะพังทั้งไฟล์ด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่กำลังทดสอบ
{
  check("ไม่มี deps = ไม่สร้างทริกเกอร์",
    !Object.keys(R.registerHrRecruitment()).includes("onJobApplicationCreated"));
  check("callable ยังครบแม้ไม่มี deps",
    Object.keys(R.registerHrRecruitment()).includes("adminHrApplicationList"));
  check("มี deps = สร้างทริกเกอร์",
    Object.keys(R.registerHrRecruitment({ dispatchAdminPush: () => {} }))
      .includes("onJobApplicationCreated"));
}

// ── 6. แถวที่ส่งออกหน้าเว็บต้องไม่มีคีย์แปลกปลอม ───────────────────────────
//
// ตอนต่อทริกเกอร์รอบแรก การ spread ไปลงผิดที่ทำให้ `onJobApplicationCreated`
// กลายเป็นคีย์บนแถวใบสมัครทุกใบ — จับได้ก่อน ship แต่จดด่านไว้กันรอบหน้า
{
  const row = R.publicApplication("a1", { full_name: "x" }, {});
  check("publicApplication ไม่มีคีย์ของทริกเกอร์ปน", !("onJobApplicationCreated" in row));
  check("publicApplication ยังมีคีย์ที่ควรมี", "full_name" in row && "status" in row);
}

// ── 7. path ของทริกเกอร์ (การตรึงแบบอ่อน — ดูหมายเหตุหัวไฟล์) ──────────────
{
  check("ทริกเกอร์ชี้ที่ /job_applications/{appId}", apiSrc.includes("/job_applications/{appId}"));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
