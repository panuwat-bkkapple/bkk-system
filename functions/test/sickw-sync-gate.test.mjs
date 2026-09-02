// ---------------------------------------------------------------------------
// `syncJobFromSickw` ต้องมีด่าน role ไม่ใช่แค่ `if (!request.auth)`
//
//   node functions/test/sickw-sync-gate.test.mjs
//
// ทำไมต้องมีเทสนี้ทั้งที่เป็นการเติมด่านไม่กี่บรรทัด: ฟังก์ชันนี้เขียนทับ
// model/capacity/color/country/imei/imei2/serial ของใบงานไหนก็ได้ที่รู้ jobId
// และเดิมมีด่านเดียวคือ "ล็อกอินอยู่" ซึ่งในโปรเจกต์นี้แปลว่า "ใครก็ได้" —
// ลูกค้าทุกคนบนเว็บได้ anonymous auth ติดตัวมาอยู่แล้ว
//
// เทสอ่าน SOURCE ตรงๆ แทนที่จะเรียกฟังก์ชัน เพราะของที่ต้องกันคือ "มีคนลบ
// ด่านออกอีกครั้ง" ซึ่งเป็นบรรทัดในไฟล์ ไม่ใช่ค่าที่ฟังก์ชันคืน — และเพราะ
// index.js เป็นไฟล์ 6,000 บรรทัดที่ define ฟังก์ชันตอน import จึงเรียก
// handler เดี่ยวๆ ในเทส offline ไม่ได้
//
// ข้อ 5 เป็นตัวที่ข้ามไฟล์: allowlist จะปลอดภัยก็ต่อเมื่อ resolver ไม่คืน
// role ของพนักงานให้ไรเดอร์ ซึ่งเป็นข้อเท็จจริงที่อยู่ในอีกไฟล์หนึ่ง
// (บทเรียน "กฎมีกี่คนอ่าน" ใน CLAUDE.md)
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const index = readFileSync(join(fnDir, "index.js"), "utf8");
const staffAccounts = readFileSync(join(fnDir, "staff-accounts.js"), "utf8");
const sickwCore = readFileSync(join(fnDir, "sickw-core.js"), "utf8");

// ---- helpers --------------------------------------------------------------

// ตัดตัว handler ของ callable ออกมา: จาก `exports.<name> = onCall` ไปจนถึง
// `exports.` ตัวถัดไป ไม่งั้นจะไปเจอด่านของฟังก์ชันข้างเคียงแล้วผ่านฟรี
function handlerOf(name) {
  const start = index.indexOf(`exports.${name} = onCall`);
  if (start === -1) return null;
  const next = index.indexOf("\nexports.", start + 1);
  return index.slice(start, next === -1 ? index.length : next);
}

function roleListOf(src, constName) {
  const m = src.match(new RegExp(`const ${constName} = \\[([^\\]]*)\\]`));
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

// ---- 1. ตัว handler มีอยู่จริง และมีด่าน role -------------------------------

const sync = handlerOf("syncJobFromSickw");
check("syncJobFromSickw ยังอยู่ใน index.js", sync !== null);

const SYNC_ROLES = roleListOf(index, "SICKW_SYNC_ROLES");
check("SICKW_SYNC_ROLES ประกาศไว้", Array.isArray(SYNC_ROLES) && SYNC_ROLES.length > 0);

check(
  "syncJobFromSickw ปฏิเสธด้วย permission-denied เมื่อ role ไม่อยู่ใน allowlist",
  !!sync &&
    /SICKW_SYNC_ROLES\.includes\(/.test(sync) &&
    /permission-denied/.test(sync)
);

// ---- 2. ด่านต้องมาก่อนการเขียน --------------------------------------------
// ด่านที่อยู่หลังการเขียนไม่ใช่ด่าน

if (sync) {
  const gateAt = sync.indexOf("SICKW_SYNC_ROLES.includes(");
  const writeAt = sync.search(/db\.ref\([^)]*\)\.(update|set|push)\(|\.update\(updates\)/);
  check(
    "ด่าน role อยู่ก่อนการเขียน RTDB ตัวแรกของ handler",
    gateAt !== -1 && writeAt !== -1 && gateAt < writeAt
  );
}

// ---- 3. ไรเดอร์ต้องไม่อยู่ใน allowlist --------------------------------------
// lookupStaffByAuth คืน role "RIDER" ให้ไรเดอร์ — ถ้าค่านี้หลุดเข้า allowlist
// ไรเดอร์ทุกคน (รวมคนที่ยังไม่อนุมัติ) จะเขียนทับฟิลด์เครื่องได้

check(
  'SICKW_SYNC_ROLES ไม่มี "RIDER"',
  Array.isArray(SYNC_ROLES) && !SYNC_ROLES.includes("RIDER")
);

// ---- 4. allowlist ต้องสอดคล้องกับตัวที่เขียน /staff จริง --------------------
// staff-accounts.js เป็นตัวเดียวที่สร้าง staff record — role ที่ออกได้จริงมี
// เท่าที่อยู่ใน VALID_ROLES ของมัน. เพิ่ม role ใหม่ที่นั่นแล้วลืมที่นี่ =
// พนักงานจริงโดนปฏิเสธ, ใส่ role ที่ออกไม่ได้ไว้ที่นี่ = allowlist กว้างเกินจริง
//
// เดิมข้อนี้บังคับให้สองลิสต์ "เท่ากันเป๊ะ" ซึ่งซ่อนสมมติฐานว่า **ทุก role ของ
// พนักงานควรยิง SickW ได้** สมมติฐานนั้นพังตอนเพิ่ม role HR (ก.ย. 2569):
// ฝ่ายบุคคลไม่มีเหตุแตะข้อมูลเครื่องบนใบงาน และเอนด์พอยต์นี้จ่ายเงินจริงต่อการ
// เรียกหนึ่งครั้ง — การเติม HR เข้ามาเพื่อให้เทสเขียวคือการซื้อสิทธิ์ให้คนที่
// ไม่ได้ขอด้วยเงินของบริษัท
//
// จึงเปลี่ยนเป็นสองข้อ: allowlist ต้องเป็นสับเซตของ role ที่ออกได้จริง และ
// ทุก role ที่ออกได้ต้อง "อยู่ใน allowlist หรืออยู่ในรายชื่อที่ประกาศว่าไม่ให้"
// สัญญาณเตือนตอนเพิ่ม role ใหม่แล้วลืมจึงยังดังเหมือนเดิม แต่การกันออกกลาย
// เป็นสิ่งที่ต้องเขียนชื่อลงไป ไม่ใช่สิ่งที่เกิดจากการลืม
const SICKW_EXCLUDED_ROLES = ["HR"];

const VALID_ROLES = roleListOf(staffAccounts, "VALID_ROLES");
check("staff-accounts.js ยังประกาศ VALID_ROLES", Array.isArray(VALID_ROLES));
check(
  "SICKW_SYNC_ROLES เป็นสับเซตของ VALID_ROLES (ไม่มี role ที่ออกไม่ได้จริง)",
  Array.isArray(SYNC_ROLES) && Array.isArray(VALID_ROLES) &&
    SYNC_ROLES.every((r) => VALID_ROLES.includes(r))
);
check(
  "ทุก role ที่ออกได้จริงอยู่ใน allowlist หรืออยู่ในรายชื่อที่ตั้งใจกันออก",
  Array.isArray(SYNC_ROLES) && Array.isArray(VALID_ROLES) &&
    VALID_ROLES.every((r) => SYNC_ROLES.includes(r) || SICKW_EXCLUDED_ROLES.includes(r))
);
check(
  "role ที่ตั้งใจกันออกต้องไม่หลุดเข้า allowlist",
  Array.isArray(SYNC_ROLES) && SICKW_EXCLUDED_ROLES.every((r) => !SYNC_ROLES.includes(r))
);
check(
  "role ที่ตั้งใจกันออกต้องมีอยู่จริงใน VALID_ROLES — ไม่ใช่ข้อยกเว้นของ role ที่ไม่มีอยู่",
  Array.isArray(VALID_ROLES) && SICKW_EXCLUDED_ROLES.every((r) => VALID_ROLES.includes(r))
);

// ---- 5. resolver ต้องไม่แจก role พนักงานให้ไรเดอร์ --------------------------
// ข้อเท็จจริงข้ามไฟล์ที่ allowlist ทั้งอันพึ่งอยู่

const riderBranch = sickwCore.slice(
  sickwCore.indexOf("const riderSnap"),
  sickwCore.indexOf("return null;", sickwCore.indexOf("const riderSnap"))
);
const riderRole = (riderBranch.match(/role:\s*["']([^"']+)["']/) || [])[1];
check(
  "lookupStaffByAuth คืน role ของไรเดอร์เป็นค่าที่ไม่อยู่ใน allowlist",
  !!riderRole && Array.isArray(SYNC_ROLES) && !SYNC_ROLES.includes(riderRole)
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
