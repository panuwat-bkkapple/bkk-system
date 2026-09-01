// ---------------------------------------------------------------------------
// สัญญาของ actor resolver — ตัวเชื่อมระหว่าง Firebase auth กับ status-engine
//
//   node functions/test/actor-contract.test.mjs
//
// status-engine.js เป็น decision core บริสุทธิ์ที่รับ `actor` เป็นสตริงจาก
// ชุด ACTOR ของมันเอง ส่วนระบบจริงรู้จักคนผ่าน role ในภาษาธุรกิจ
// (CEO/MANAGER/STAFF/FINANCE/RIDER) — actor.js คือแผนที่ระหว่างสองภาษานั้น
// และเทสนี้คือตัวตรึงว่าแผนที่ยัง "ใช้ได้จริงกับ engine" ไม่ใช่แค่รูปสวย
//
// ข้อ 8 คือข้อที่มีค่าที่สุด: มันป้อนค่าที่ resolveActor คืนเข้า
// decideTransition จริงๆ แผนที่ที่พิมพ์ผิดหรือ ACTOR ที่ถูกเปลี่ยนชื่อจะโผล่
// ตรงนั้นทันที ส่วนเทสที่เทียบสตริงกับสตริงจะยังเขียวอยู่
// ---------------------------------------------------------------------------

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const { STANDING, ROLE_TO_ACTOR, effectiveApprovalStatus, riderStanding, resolveActor } =
  require(join(fnDir, "actor.js"));
const { ACTOR, decideTransition } = require(join(fnDir, "status-engine.js"));

let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`PASS  ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
};

// ── fake RTDB — พอสำหรับสองการอ่านที่ lookupStaffByAuth ทำเท่านั้น ──────────
function fakeDb({ staff = {}, riders = {} } = {}) {
  return {
    ref(path) {
      return {
        async once() {
          if (path === "staff") {
            return {
              forEach(cb) {
                for (const [key, val] of Object.entries(staff)) {
                  if (cb({ key, val: () => val })) return true;
                }
                return false;
              },
            };
          }
          const m = /^riders\/(.+)$/.exec(path);
          if (m) {
            const r = riders[m[1]];
            return { exists: () => Boolean(r), val: () => r };
          }
          throw new Error(`fakeDb: unexpected path ${path}`);
        },
      };
    },
  };
}

const authOf = (uid, email) => ({ uid, token: email ? { email } : {} });

// ── 1. แผนที่ต้องครอบทุก role ที่ระบบออกให้ได้จริง ──────────────────────────
// staff-accounts.js เป็นตัวเดียวที่สร้าง staff record — role ที่มีได้จริงคือ
// VALID_ROLES ของมัน เพิ่ม role ใหม่ที่นั่นแล้วลืมที่นี่ = คนนั้นไม่มี actor
// แล้วยิง event ไม่ได้เลยโดยไม่มีอะไรบอก

const staffSrc = readFileSync(join(fnDir, "staff-accounts.js"), "utf8");
const VALID_ROLES = (staffSrc.match(/const VALID_ROLES = \[([^\]]*)\]/) || [])[1]
  ?.split(",")
  .map((s) => s.trim().replace(/^["']|["']$/g, ""))
  .filter(Boolean);

check("อ่าน VALID_ROLES จาก staff-accounts.js ได้", Array.isArray(VALID_ROLES) && VALID_ROLES.length > 0);
check(
  "ROLE_TO_ACTOR ครอบทุก role ใน VALID_ROLES",
  Array.isArray(VALID_ROLES) && VALID_ROLES.every((r) => ROLE_TO_ACTOR[r])
);

// ── 2. ปลายทางทุกเส้นต้องเป็น ACTOR จริงของ engine ──────────────────────────
const ACTOR_VALUES = new Set(Object.values(ACTOR));
check(
  "ทุกค่าใน ROLE_TO_ACTOR เป็นสมาชิกของ ACTOR",
  Object.values(ROLE_TO_ACTOR).every((a) => ACTOR_VALUES.has(a))
);

// ── 3. การ map ที่ตั้งใจ ────────────────────────────────────────────────────
check("CEO → admin_manager", ROLE_TO_ACTOR.CEO === ACTOR.ADMIN_MANAGER);
check("MANAGER → admin_manager", ROLE_TO_ACTOR.MANAGER === ACTOR.ADMIN_MANAGER);
check("STAFF → admin_staff", ROLE_TO_ACTOR.STAFF === ACTOR.ADMIN_STAFF);
check("FINANCE → finance", ROLE_TO_ACTOR.FINANCE === ACTOR.FINANCE);
check("RIDER → rider", ROLE_TO_ACTOR.RIDER === ACTOR.RIDER);

// ── 4. role ที่เลิกใช้ต้องไม่มี actor ────────────────────────────────────────
check("CASHIER ไม่มี actor", !ROLE_TO_ACTOR.CASHIER);
check("QC ไม่มี actor", !ROLE_TO_ACTOR.QC);

// ── 5. standing ของไรเดอร์ fail closed ──────────────────────────────────────
check("Active → active", riderStanding({ approval_status: "Active" }) === STANDING.ACTIVE);
check("Pending → pending", riderStanding({ approval_status: "Pending" }) === STANDING.PENDING);
check("Rejected → blocked", riderStanding({ approval_status: "Rejected" }) === STANDING.BLOCKED);
check("Suspended → blocked", riderStanding({ approval_status: "Suspended" }) === STANDING.BLOCKED);
check("ค่าที่ไม่รู้จัก → blocked", riderStanding({ approval_status: "Vacation" }) === STANDING.BLOCKED);

// ── 6. fallback ของ record เก่าที่ยังไม่มี approval_status ──────────────────
check("Online → Active", effectiveApprovalStatus({ status: "Online" }) === "Active");
check("Offline → Active", effectiveApprovalStatus({ status: "Offline" }) === "Active");
check("ไม่มีอะไรเลย → Pending", effectiveApprovalStatus({}) === "Pending");
check(
  "สมัครใหม่ (status Pending ไม่มี approval_status) → standing pending",
  riderStanding({ status: "Pending" }) === STANDING.PENDING
);

// ── 7. resolveActor ─────────────────────────────────────────────────────────
const db = fakeDb({
  staff: {
    "-Nstaff1": { email: "boss@bkkapple.com", name: "สมชาย", role: "CEO", status: "ACTIVE", uid: "uid-ceo" },
    "-Nstaff2": { email: "fin@bkkapple.com", name: "สมหญิง", role: "FINANCE", status: "ACTIVE", uid: "uid-fin" },
    "-Nstaff3": { email: "old@bkkapple.com", name: "เก่า", role: "QC", status: "ACTIVE", uid: "uid-qc" },
  },
  riders: {
    "uid-rider-ok": { name: "ไรเดอร์ดี", approval_status: "Active" },
    "uid-rider-susp": { name: "ไรเดอร์พัก", approval_status: "Suspended" },
    "uid-rider-new": { name: "ไรเดอร์ใหม่", status: "Pending" },
  },
});

const results = {};
for (const [label, auth] of [
  ["none", null],
  ["anon", authOf("uid-anon")],
  ["ceo", authOf("uid-ceo", "boss@bkkapple.com")],
  ["finance", authOf("uid-fin", "fin@bkkapple.com")],
  ["deprecated", authOf("uid-qc", "old@bkkapple.com")],
  ["rider", authOf("uid-rider-ok")],
  ["riderSuspended", authOf("uid-rider-susp")],
  ["riderNew", authOf("uid-rider-new")],
]) {
  results[label] = await resolveActor(db, auth);
}

check("ไม่มี auth → null", results.none === null);
check("ลูกค้า anonymous (ไม่มี record ที่ไหนเลย) → null", results.anon === null);
check("staff role ที่เลิกใช้ → null", results.deprecated === null);

check("CEO → actor admin_manager", results.ceo?.actor === ACTOR.ADMIN_MANAGER);
check("CEO → standing active", results.ceo?.standing === STANDING.ACTIVE);
check("CEO → identity.source = staff", results.ceo?.identity.source === "staff");
check("CEO → actor_id เป็น push id ของ /staff ไม่ใช่ uid", results.ceo?.identity.actor_id === "-Nstaff1");
check("CEO → uid เป็น Firebase uid", results.ceo?.identity.uid === "uid-ceo");
check("CEO → identity เก็บ name/role เป็น snapshot",
  results.ceo?.identity.name === "สมชาย" && results.ceo?.identity.role === "CEO");

check("FINANCE → actor finance", results.finance?.actor === ACTOR.FINANCE);

check("ไรเดอร์ที่อนุมัติแล้ว → actor rider + active", 
  results.rider?.actor === ACTOR.RIDER && results.rider?.standing === STANDING.ACTIVE);
check("ไรเดอร์ → identity.source = rider และ actor_id เป็น uid",
  results.rider?.identity.source === "rider" && results.rider?.identity.actor_id === "uid-rider-ok");

// หัวใจของกติกา "รายงาน ไม่ใช่ปฏิเสธ": ไรเดอร์ที่ถูกพักงานต้องยัง resolve ได้
// พร้อมชื่อ เพื่อให้ audit line ยังเรียกชื่อเขาถูก — แต่ standing บอกว่าห้าม
check("ไรเดอร์ที่ถูกพักงาน → ยัง resolve ได้ ไม่ใช่ null", results.riderSuspended !== null);
check("ไรเดอร์ที่ถูกพักงาน → standing blocked", results.riderSuspended?.standing === STANDING.BLOCKED);
check("ไรเดอร์ที่ถูกพักงาน → ยังมีชื่อให้ audit",
  results.riderSuspended?.identity.name === "ไรเดอร์พัก");
check("ไรเดอร์ที่ยังไม่อนุมัติ → standing pending", results.riderNew?.standing === STANDING.PENDING);

// ── 8. ค่าที่ได้ต้องใช้กับ engine ได้จริง ───────────────────────────────────
// เทียบสตริงกับสตริงพิสูจน์แค่ว่าแผนที่รูปสวย ข้อนี้ป้อนเข้า decideTransition
// ของจริง — ACTOR ที่ถูกเปลี่ยนชื่อหรือพิมพ์ผิดจะโผล่ที่นี่เท่านั้น

const managerOnly = { job: { status: "Investigating Carrier" }, event: "parcel_declared_lost" };
const financeOnly = { job: { status: "Payout Processing" }, event: "payment_confirmed" };

const decide = (base, who) => decideTransition({ ...base, actor: who.actor });

check("actor ของ CEO ผ่าน event ที่ gate ไว้ที่ admin_manager", decide(managerOnly, results.ceo).ok === true);
check("actor ของไรเดอร์ไม่ผ่าน event นั้น", decide(managerOnly, results.rider).code === "wrong_actor");
check("actor ของ FINANCE ผ่าน event ที่ gate ไว้ที่ finance", decide(financeOnly, results.finance).ok === true);
check("actor ของ CEO ไม่ผ่าน event ที่เป็นของ finance เท่านั้น",
  decide(financeOnly, results.ceo).code === "wrong_actor");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
