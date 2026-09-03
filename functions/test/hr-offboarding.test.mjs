// ---------------------------------------------------------------------------
// P3 — พ้นสภาพแล้วปิดการเข้าถึงอัตโนมัติ
//
//   node functions/test/hr-offboarding.test.mjs
//
// สิ่งที่เทสชุดนี้เฝ้าไว้ไม่ใช่ "ปิดบัญชีได้ไหม" (นั่นต้องมี Firebase ถึงจะรู้)
// แต่คือ **ใครปิดใครได้ และปิดไม่ได้ตอนไหน** ซึ่งเป็นตรรกะล้วนและเป็นจุดที่
// พลาดแล้วเสียหายกู้ยาก: role HR ที่ปิดบัญชี CEO ได้ = ล็อกเจ้าของบริษัทออก
// จากระบบโดยที่คนเปิดคืนได้มีแค่คนที่เพิ่งถูกล็อก
//
// ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) — 3 ก.ย. 2569
//
//   #   ทำลายอะไร                                        ผล
//   1   HR ปิดบัญชี CEO ได้                               แดง 2
//   2   ถอดด่าน CEO ที่ ACTIVE คนสุดท้าย                  แดง
//   3   ถอดด่านปิดบัญชีตัวเอง                              แดง
//   4   ปฏิเสธแล้วยังคืนแผนปิดบัญชีมาด้วย                  แดง
//   5   ไรเดอร์เทียบกับ "approved" ตัวเล็ก (บั๊กเดิม)      แดง 2
//   6   accessSummary กลับไปเทียบ "approved" (บั๊กเดิม)    แดง 2
//   7   แถวเก่าที่ไม่มี approval_status ตกเป็น Pending      แดง 3
//   8   ปิดบัญชีที่พักงานอยู่แล้วซ้ำ                        แดง 4
//   9   นับ CEO ที่พักงาน/ปิดบัญชีว่ายังอยู่                เขียว* → เพิ่ม fixture 2 แถว
//  10   ถอด revokeRefreshTokens                            แดง
//  11   ไม่ลบ /admins                                       แดง
//  12   ไม่ disable บัญชี Auth                              แดง
//  13   ไรเดอร์ไม่ปิดบัญชี Auth                             แดง
//  14   ไรเดอร์เขียนธงเดียว (ลืม status)                    แดง
//  15   เขียนธงก่อนปิดบัญชี                                 แดง
//  16   hr.js เขียนกลไกปิดเอง                               แดง
//  17   ปฏิเสธแล้วเดินต่อ (warn แทน throw)                  เขียว* → ปักที่ throw
//  18   ปิดทุกครั้งไม่ใช่เฉพาะตอนพ้นสภาพ                    แดง
//  19   หน้าเว็บกลืน error ตอนปิดไม่สำเร็จ                  แดง
//  20   หน้าเว็บบอกว่าปิดแล้วทั้งที่ไม่มีบัญชี               แดง
//
// สองข้อที่เขียว (*) เป็นเทสว่างทั้งคู่ ไม่ใช่บั๊กในโค้ด:
//   ข้อ 9 — fixture มีแถว CEO แถวเดียว ตัวนับจึงไม่มีแถวที่สองให้ตัดสินผิด
//          เพิ่มเคส "CEO อีกคนที่พักงาน/ปิดบัญชีไปแล้ว" ซึ่งเป็นเคสที่ถ้าตัวนับ
//          ผิดจะปล่อยให้ปิด CEO คนสุดท้ายที่ยังเข้าระบบได้จริง
//   ข้อ 17 — ด่านเช็คแค่ "ตำแหน่งของคำว่า plan.refuse" ไม่ได้เช็คว่ามัน throw
//          เปลี่ยนเป็น console.warn แล้วยังเขียว ทั้งที่ปฏิเสธไปแล้วยังเดินต่อ
//
// **ข้อ 5/6/7 ไม่ใช่ injection สมมติ — มันคือบั๊กที่มีอยู่จริงก่อน PR นี้**
// `accessSummary` เทียบ approval_status กับสตริง "approved" ซึ่งไม่มีอยู่ใน
// ระบบเลย (ค่าจริงคือ Active/Pending/Rejected/Suspended) ธง stale_access จึง
// ไม่เคยเตือนเรื่องบัญชีไรเดอร์ที่ยังเปิดอยู่สักครั้งนับตั้งแต่ P1
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

const hr = require(join(fnDir, "hr-core.js"));

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const eq = (name, got, want) =>
  check(`${name} (${JSON.stringify(got)} = ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

const STAFF = {
  ceo: { role: "CEO", status: "ACTIVE", name: "เจ้าของ" },
  ceo2: { role: "CEO", status: "ACTIVE", name: "เจ้าของสอง" },
  hr1: { role: "HR", status: "ACTIVE", name: "ฝ่ายบุคคล" },
  staff1: { role: "STAFF", status: "ACTIVE", name: "พนักงาน" },
  gone: { role: "STAFF", status: "INACTIVE", name: "พักงานอยู่" },
  closed: { role: "STAFF", status: "ACTIVE", terminated_at: 1, name: "ปิดบัญชีแล้ว" },
};
const RIDERS = {
  r_active: { approval_status: "Active" },
  r_susp: { approval_status: "Suspended" },
  r_legacy: { status: "Online" }, // แถวเก่าที่ไม่มี approval_status
};
// อ่านรหัสการปฏิเสธแบบไม่พังเมื่อไม่มีการปฏิเสธ — เขียน `.refuse.code` ตรงๆ
// แล้วด่านที่ถูกทำลายจะทำให้เทสทั้งไฟล์ crash แทนที่จะรายงาน FAIL ทีละข้อ
// (เจอตอน injection ข้อ 2/3: แดงจริงแต่หยุดกลางทาง เลยไม่รู้ว่าข้ออื่นเป็นยังไง)
const refuseCode = (p) => (p && p.refuse ? p.refuse.code : null);

const plan = (over = {}) => hr.planAccountClosure({
  employee: { links: {} }, staffMap: STAFF, ridersMap: RIDERS,
  callerRole: "HR", callerStaffId: "hr1", ...over,
});

// ── 1. เคสปกติ ─────────────────────────────────────────────────────────────
{
  const p = plan({ employee: { links: { staff_id: "staff1" } } });
  eq("HR ปิดบัญชีพนักงานทั่วไปได้", [p.refuse, p.staff.close], [null, true]);

  const both = plan({ employee: { links: { staff_id: "staff1", rider_id: "r_active" } } });
  eq("ปิดได้ทั้งสองบัญชีในครั้งเดียว",
    [both.staff.close, both.rider.close], [true, true]);

  const none = plan({ employee: { links: {} } });
  eq("ไม่มีบัญชีผูกอยู่ = ไม่มีอะไรให้ปิด และไม่ใช่ error",
    [none.refuse, none.staff, none.rider, none.nothing_to_close], [null, null, null, true]);
}

// ── 2. สามข้อที่ต้องปฏิเสธทั้งรายการ ───────────────────────────────────────
{
  // HR ปิดบัญชี CEO ไม่ได้ — ไม่งั้นเป็นทางอ้อมล็อกเจ้าของบริษัทออกจากระบบ
  // และคนที่เปิดคืนได้คือ CEO ซึ่ง login ไม่ได้แล้ว
  eq("HR ปิดบัญชี CEO ไม่ได้",
    refuseCode(plan({ employee: { links: { staff_id: "ceo" } } })), "ceo_account");

  // CEO ทำเองได้ ถ้ายังมี CEO ที่ ACTIVE คนอื่นเหลืออยู่
  eq("CEO ปิดบัญชี CEO อีกคนได้ (ยังเหลืออีกคน)",
    plan({ employee: { links: { staff_id: "ceo" } }, callerRole: "CEO", callerStaffId: "ceo2" }).refuse, null);

  // CEO คนสุดท้ายห้ามปิด แม้คนกดจะเป็น CEO เอง
  const onlyCeo = { ceo: STAFF.ceo, staff1: STAFF.staff1 };
  eq("CEO ที่ ACTIVE คนสุดท้ายห้ามปิด",
    refuseCode(hr.planAccountClosure({
      employee: { links: { staff_id: "ceo" } }, staffMap: onlyCeo, ridersMap: {},
      callerRole: "CEO", callerStaffId: "staff1",
    })), "last_ceo");

  // **CEO คนอื่นที่ "มีแถวอยู่" ไม่เท่ากับ "ยังเข้าระบบได้"** — fixture ที่มี
  // CEO แถวเดียวพิสูจน์ข้อนี้ไม่ได้เลย เพราะไม่มีแถวที่สองให้ตัวนับตัดสินผิด
  // (injection ข้อ 9 ถอดเงื่อนไข ACTIVE/terminated ออกจากตัวนับแล้วยังเขียว)
  // ถ้าตัวนับนับ CEO ที่พักงานหรือปิดบัญชีไปแล้วว่ายังอยู่ = ปล่อยให้ปิด CEO
  // คนสุดท้ายที่ยังเข้าระบบได้จริง
  for (const [label, other] of [
    ["พักงานอยู่", { role: "CEO", status: "INACTIVE" }],
    ["ปิดบัญชีไปแล้ว", { role: "CEO", status: "ACTIVE", terminated_at: 1 }],
  ]) {
    eq(`CEO อีกคนที่${label} ไม่นับเป็นคนที่ยังอยู่`,
      refuseCode(hr.planAccountClosure({
        employee: { links: { staff_id: "ceoA" } },
        staffMap: { ceoA: { role: "CEO", status: "ACTIVE" }, ceoB: other, staff1: STAFF.staff1 },
        ridersMap: {}, callerRole: "CEO", callerStaffId: "staff1",
      })), "last_ceo");
  }

  // ปิดบัญชีตัวเองไม่ได้ — คำสั่งที่เหลือจะทำงานต่อไม่ได้
  eq("ปิดบัญชีของคนกดเองไม่ได้",
    refuseCode(plan({ employee: { links: { staff_id: "hr1" } } })), "self");

  // ปฏิเสธแล้วต้องไม่บอกให้ไปปิดบางส่วน — ทั้งรายการต้องเป็นโมฆะ
  const r = plan({ employee: { links: { staff_id: "ceo", rider_id: "r_active" } } });
  eq("ปฏิเสธแล้วไม่เหลือแผนปิดบัญชีไหนเลย", [r.staff, r.rider], [null, null]);
}

// ── 3. บัญชีที่ปิดไปแล้ว = ข้าม ไม่ใช่ error ────────────────────────────────
{
  const p = plan({ employee: { links: { staff_id: "gone" } } });
  eq("บัญชีที่พักงานอยู่แล้ว = ข้าม", [p.refuse, p.staff.close], [null, false]);
  check("บอกเหตุผลที่ข้าม", Boolean(p.staff.skip));

  const t = plan({ employee: { links: { staff_id: "closed" } } });
  eq("บัญชีที่ปิดไปแล้ว = ข้าม", t.staff.close, false);

  const s = plan({ employee: { links: { rider_id: "r_susp" } } });
  eq("ไรเดอร์ที่ระงับอยู่แล้ว = ข้าม", s.rider.close, false);

  // แถวที่ถูกพักงานอยู่แล้วต้องไม่ทำให้กฎ CEO ทำงาน — CEO ที่ถูกพักงานไปแล้ว
  // ไม่ได้เป็นความเสี่ยงอะไร
  const inactiveCeo = { ceoOff: { role: "CEO", status: "INACTIVE" }, ceo2: STAFF.ceo2 };
  eq("CEO ที่พักงานอยู่แล้ว ไม่ต้องปฏิเสธ",
    hr.planAccountClosure({
      employee: { links: { staff_id: "ceoOff" } }, staffMap: inactiveCeo, ridersMap: {},
      callerRole: "HR", callerStaffId: "hr1",
    }).refuse, null);
}

// ── 4. สถานะไรเดอร์ — ค่าจริงคือ Active/Pending/Rejected/Suspended ─────────
// **บั๊กที่เจอตอนทำ P3:** โค้ดเดิมเทียบ approval_status ที่ lowercase แล้วกับ
// สตริง "approved" ซึ่งไม่มีทางตรงกับค่าไหนเลย → riderOpen เป็น false เสมอ →
// ธง stale_access ไม่เคยเตือนเรื่องบัญชีไรเดอร์ที่ยังเปิดอยู่สักครั้ง
{
  eq("Active = เปิดอยู่", hr.riderApprovalStatus({ approval_status: "Active" }), "Active");
  eq("แถวเก่าที่ status เป็น Online ถือว่า Active", hr.riderApprovalStatus({ status: "Online" }), "Active");
  eq("ไม่มีอะไรเลย = Pending", hr.riderApprovalStatus({}), "Pending");

  const openRider = hr.accessSummary(
    { status: "resigned", links: { rider_id: "r1" } }, {}, { r1: { approval_status: "Active" } });
  eq("พ้นสภาพแล้วแต่ไรเดอร์ยัง Active = ต้องเตือน", openRider.stale_access, true);

  const shut = hr.accessSummary(
    { status: "resigned", links: { rider_id: "r1" } }, {}, { r1: { approval_status: "Suspended" } });
  eq("ระงับแล้วไม่เตือน", shut.stale_access, false);

  // ไรเดอร์แถวเก่าที่ไม่มี approval_status ก็ต้องถูกจับได้ ไม่ใช่หลุดเพราะฟิลด์หาย
  const legacy = hr.accessSummary(
    { status: "terminated", links: { rider_id: "r1" } }, {}, { r1: { status: "Online" } });
  eq("แถวเก่าที่ยังออนไลน์อยู่ก็ต้องเตือน", legacy.stale_access, true);

  eq("ยังเป็นพนักงานอยู่ = ไม่ใช่ stale แม้บัญชีเปิด",
    hr.accessSummary({ status: "active", links: { rider_id: "r1" } }, {}, { r1: { approval_status: "Active" } }).stale_access,
    false);

  const p = plan({ employee: { links: { rider_id: "r_legacy" } } });
  eq("แถวเก่าที่ยังออนไลน์ต้องถูกวางแผนปิดด้วย", p.rider.close, true);
}

// ── 5. กลไกการปิดต้องเป็นตัวเดียวกับที่ /staff และ /riders ใช้ ─────────────
// สำเนาที่สองของการปิดบัญชีคือทางที่ชั้นใดชั้นหนึ่งจะหายไปเงียบๆ — และชั้นที่
// หายง่ายที่สุดคือ revokeRefreshTokens ซึ่งเป็นตัวเดียวที่เตะ session ที่เปิดค้าง
{
  const sa = readFileSync(join(fnDir, "staff-accounts.js"), "utf8");
  const body = sa.slice(sa.indexOf("async function suspendStaffAccount"), sa.indexOf("exports.suspendStaffAccount"));
  check("ปิดบัญชีพนักงานครบสามชั้น",
    /updateUser\(existing\.uid, \{ disabled: true \}\)/.test(body) &&
    /revokeRefreshTokens\(existing\.uid\)/.test(body) &&
    /admins\/\$\{existing\.uid\}`\)\.remove\(\)/.test(body));
  check("staff-accounts export ตัวปิดออกมาให้ใช้ร่วม", /exports\.suspendStaffAccount = suspendStaffAccount/.test(sa));

  const ra = readFileSync(join(fnDir, "rider-accounts.js"), "utf8");
  const rbody = ra.slice(ra.indexOf("async function suspendRiderAccount"), ra.indexOf("// ประวัติการเปลี่ยนสถานะ"));
  check("ระงับไรเดอร์ปิดบัญชี Auth ด้วย", /setAuthDisabled\(riderId, true\)/.test(rbody));
  // เขียนธงเดียวไม่พอ — `status` คือตัวที่แอปไรเดอร์อ่าน
  check("ระงับไรเดอร์เขียนธงทั้งสองตัว", /\.\.\.target/.test(rbody) && /ACTIONS\.suspend/.test(rbody));
  check("ปิดบัญชีก่อนเขียนธง",
    rbody.indexOf("setAuthDisabled") < rbody.indexOf(".update("));

  const hrjs = readFileSync(join(fnDir, "hr.js"), "utf8");
  check("hr.js ใช้ตัวปิดร่วม ไม่ได้เขียนใหม่",
    /suspendStaffAccount/.test(hrjs) && /suspendRiderAccount/.test(hrjs));
  check("hr.js ไม่แตะ Auth เอง", !/getAuth\(\)/.test(hrjs));
}

// ── 6. ลำดับ: ตรวจ → เขียนสถานะ → ปิดบัญชี ────────────────────────────────
{
  const hrjs = readFileSync(join(fnDir, "hr.js"), "utf8");
  const i = hrjs.indexOf("const adminHrEmployeeSetStatus");
  const body = hrjs.slice(i, hrjs.indexOf("adminHrEmployeeLink", i));
  const planAt = body.indexOf("planAccountClosure");
  const writeAt = body.indexOf("`employees/${employeeId}`).update(");
  const closeAt = body.indexOf("suspendStaffAccount");
  check("ตรวจก่อนเขียนสถานะ", planAt > 0 && planAt < writeAt);
  // เขียนสถานะก่อนปิดบัญชี — ปิดล้มกลางทางแล้วยังมีบันทึกว่าพ้นสภาพ และธง
  // stale_access จะบอกเองว่ายังมีบัญชีเปิดค้าง ตรงข้ามกับการปิดก่อนแล้วบันทึก
  // ไม่สำเร็จ ซึ่งได้คนที่ถูกล็อกออกโดยไม่มีบันทึกว่าทำไม
  check("เขียนสถานะก่อนปิดบัญชี", writeAt > 0 && writeAt < closeAt);
  // ต้องปักที่ `throw` — เช็คแค่ตำแหน่งของคำว่า plan.refuse แล้วเปลี่ยน throw
  // เป็น console.warn จะยังเขียว (injection ข้อ 17) ซึ่งแปลว่าปฏิเสธแล้วยังเดิน
  // ต่อไปเขียนสถานะและปิดบัญชีอยู่ดี = ด่านที่ไม่ได้กันอะไรเลย
  const refuseAt = body.indexOf("if (plan.refuse) throw new HttpsError(");
  check("ปฏิเสธแล้ว throw ทันที ก่อนเขียนอะไร", refuseAt > 0 && refuseAt < writeAt);

  // ปิดอัตโนมัติ แต่ห้ามเปิดคืนอัตโนมัติ — การคืนสิทธิ์ต้องผ่านคนเสมอ
  check("ไม่มีการเปิดบัญชีคืนในเส้นทางนี้",
    !/disabled: false/.test(body) && !/unsuspend/.test(body));
  check("ปิดเฉพาะตอนพ้นสภาพ", /if \(leaving\)/.test(body));
}

// ── 7. หน้าเว็บต้องรายงานผลจริง ไม่ใช่ประกาศว่าสำเร็จ ─────────────────────
{
  const ui = readFileSync(join(root, "src/pages/hr/EmployeeRegister.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  check("ปิดไม่สำเร็จขึ้นเป็น error ไม่ใช่ success", /closed\?\.errors\?\.length/.test(ui));
  check("บอกว่าปิดบัญชีอะไรไปบ้าง", /บันทึกสถานะและปิด/.test(ui));
  check("คนที่ไม่มีบัญชีผูกอยู่ไม่ถูกบอกว่าปิดบัญชีแล้ว", /ไม่มีบัญชีเข้าระบบผูกอยู่/.test(ui));
  check("ยังเตือนเมื่อบัญชียังเปิดอยู่", /บัญชีเข้าระบบยังเปิดอยู่/.test(ui));
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
