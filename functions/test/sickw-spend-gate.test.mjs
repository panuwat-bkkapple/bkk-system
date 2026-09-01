// ---------------------------------------------------------------------------
// endpoint ที่ยิงแล้วเสียเงิน ต้องไม่เปิดให้ "ใครก็ได้ที่ล็อกอิน"
//
//   node functions/test/sickw-spend-gate.test.mjs
//
// สามตัวนี้เรียก SICKW ซึ่งคิดเงินต่อครั้ง และเคยมีด่านเดียวคือ
// `if (!request.auth)` — ในโปรเจกต์นี้แปลว่าทุกคน เพราะลูกค้าบนเว็บได้
// anonymous auth ติดตัวมา. ไม่มีเพดานรายวันหรือ rate limit อยู่ที่ไหนเลย:
// sickw_usage บันทึกว่าใครใช้เท่าไร แต่บันทึกไม่ได้ห้ามใคร — ด่านนี้จึงเป็น
// ตัวคุมค่าใช้จ่ายตัวเดียวที่มีอยู่จริง
//
// เทสอ่าน SOURCE เพราะ index.js ประกาศ callable ตอน import และทุกตัวต้องมี
// getDatabase()/getAuth() จริง ของที่ต้องกันคือ "มีคนถอดบรรทัดด่านออก" ซึ่ง
// เป็นบรรทัดในไฟล์ (กฎเดียวกับ ledger-updated-by / staff-lifecycle)
//
// ข้อ 4 กับ 5 เป็นตัวข้ามไฟล์: ด่านทั้งหมดพึ่ง resolveActor ว่าจะไม่คืน
// standing ACTIVE ให้ไรเดอร์ที่ยังไม่อนุมัติ และไม่คืน actor ให้คนที่ไม่มี
// record — ข้อเท็จจริงสองข้อนั้นอยู่ใน actor.js ไม่ใช่ที่นี่
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { STANDING, riderStanding, resolveActor } = require(join(fnDir, "actor.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

const src = readFileSync(join(fnDir, "index.js"), "utf8");

function handlerOf(name) {
  const start = src.indexOf(`exports.${name} = onCall`);
  if (start === -1) return null;
  const next = src.indexOf("\nexports.", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

// ── 1. ทั้งสามตัวต้องมีด่าน ──────────────────────────────────────────────────
const PAID = ["checkDeviceWithSickw", "listSickwServices", "checkDeviceWithSickwBundle"];
for (const name of PAID) {
  const body = handlerOf(name);
  check(`${name} ยังอยู่`, body !== null);
  check(`${name} เรียก requireActiveWorker`, !!body && /await requireActiveWorker\(/.test(body));
}

// ── 2. ด่านต้องมาก่อนการยิง SICKW ───────────────────────────────────────────
// ด่านที่อยู่หลังการเรียก API คือด่านที่จ่ายเงินไปแล้ว
for (const name of PAID) {
  const body = handlerOf(name);
  if (!body) continue;
  const gateAt = body.indexOf("requireActiveWorker(");
  const spendAt = body.search(/callSickw|SICKW_ENDPOINT/);
  // ไม่มี `|| spendAt === -1` โดยตั้งใจ: ถ้าวันหนึ่งการประกอบ URL ถูกย้ายไป
  // helper แล้ว token หายไปจาก handler เช็คนี้ต้องแดงให้เห็น ไม่ใช่ผ่านฟรี
  // เพราะมันจะกลายเป็นด่านที่ไม่ได้ตรวจอะไรเลย
  check(`${name}: หา​จุดที่ยิง SICKW เจอ (ไม่งั้นเช็คลำดับไม่มีความหมาย)`, spendAt !== -1);
  check(`${name}: ด่านอยู่ก่อนการยิง SICKW`, gateAt !== -1 && spendAt !== -1 && gateAt < spendAt);
}

// ── 3. ตัวด่านเองต้องปฏิเสธจริง ไม่ใช่แค่ resolve ────────────────────────────
const gate = src.slice(
  src.indexOf("async function requireActiveWorker"),
  src.indexOf("exports.", src.indexOf("async function requireActiveWorker"))
);
// ต้องดู "ในบล็อกนั้น" ว่ามี throw จริง ไม่ใช่ดูว่าไฟล์มีคำว่า permission-denied
// อยู่ที่ไหนสักแห่ง — ฉบับแรกของเทสนี้เช็คแบบหลัง แล้ว injection ที่เปลี่ยน
// throw ของสาขา null เป็น console.warn ก็ยังเขียว เพราะอีกสาขาหนึ่งยังมีคำนั้น
function blockAfter(condition) {
  const at = gate.indexOf(condition);
  if (at === -1) return "";
  const open = gate.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < gate.length; i++) {
    if (gate[i] === "{") depth++;
    else if (gate[i] === "}" && --depth === 0) return gate.slice(open, i + 1);
  }
  return "";
}

const nullBranch = blockAfter("if (!resolved)");
check("มีสาขาที่รับเคส resolveActor คืน null", nullBranch.length > 0);
check("สาขานั้น throw จริง", /throw new HttpsError\(\s*"permission-denied"/.test(nullBranch));

const standingBranch = blockAfter("resolved.standing !== STANDING.ACTIVE");
check("มีสาขาที่รับเคส standing ไม่ active", standingBranch.length > 0);
check("สาขานั้น throw จริง", /throw new HttpsError\(/.test(standingBranch));

// ── 4. ไรเดอร์ที่ยังไม่อนุมัติต้องไม่ได้ standing active ─────────────────────
check("ไรเดอร์ Pending ไม่ active", riderStanding({ status: "Pending" }) !== STANDING.ACTIVE);
check("ไรเดอร์ Suspended ไม่ active", riderStanding({ approval_status: "Suspended" }) !== STANDING.ACTIVE);
check("ไรเดอร์ Rejected ไม่ active", riderStanding({ approval_status: "Rejected" }) !== STANDING.ACTIVE);
check("ไรเดอร์ที่อนุมัติแล้ว active", riderStanding({ approval_status: "Active" }) === STANDING.ACTIVE);

// ── 5. ลูกค้า anonymous ต้องไม่มี actor ─────────────────────────────────────
const fakeDb = () => ({
  ref: (path) => ({
    async once() {
      if (path === "staff") return { forEach: () => false };
      return { exists: () => false, val: () => null };
    },
  }),
});
const anon = await resolveActor(fakeDb(), { uid: "anon-visitor", token: {} });
check("ลูกค้า anonymous → resolveActor คืน null (ด่านจึงปฏิเสธ)", anon === null);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
