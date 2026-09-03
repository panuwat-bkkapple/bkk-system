// ---------------------------------------------------------------------------
// สายการรับสมัครงาน — เครื่องสถานะ + สะพานไปทะเบียนพนักงาน
//
//   node functions/test/hr-recruitment.test.mjs
//
// สิ่งที่ชุดนี้เฝ้าไว้: **ใบสมัครกระโดดข้ามขั้นไม่ได้ และคนที่ยังไม่ตอบรับ
// ข้อเสนอกลายเป็นพนักงานไม่ได้** — สองอย่างนี้ถ้าพลาด จะได้แฟ้มพนักงานของคนที่
// ยังไม่ตกลงจะมาทำงาน ซึ่งเดินเข้ารอบจ่ายเงินเดือนได้เลย
//
// ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) — 3 ก.ย. 2569
//
//   #   ทำลายอะไร                                       ผล
//   1   new กระโดดไป hired/offer/accepted ได้            แดง 4
//   2   ถอดด่านสถานะปลายทาง (ใบที่ปิดแล้วแก้ได้)          แดง
//   3   จ้างได้ทุกสถานะ                                   แดง 7
//   4   จ้างซ้ำได้ทั้งที่มีแฟ้มแล้ว                        แดง
//   5   employeeDraftFrom เดาเงินเดือน/ประเภทการจ้างให้    แดง 3
//   6   ส่งใบสมัครทั้งก้อนกลับไปหน้าเว็บ                   แดง
//   7   ถอดด่าน "ย้ายไปค่าเก่าไม่ได้"                      เขียว* → ด่านตาย ลบทิ้ง
//   8   สถานะที่ไม่รู้จักไม่ตกเป็น new                     แดง
//   9   เขียนสถานะที่ client ส่งมาลงตรงๆ                   แดง
//  10   ถอดด่านกดจ้าง                                     แดง
//  11   ถอด gate สิทธิ์ของ list                            แดง
//  12   กวาด job_applications ทั้งโหนด                     แดง
//  13   ออกบัญชี login ให้เองในสายนี้                      แดง
//  14   บอกว่าออกบัญชีแล้วทั้งที่ไม่ได้ออก                 แดง
//  15   สร้างแฟ้มเองไม่ผ่าน createEmployeeRecord           แดง 2
//  16   ไม่ผูกกลับจากแฟ้มไปใบสมัคร                         แดง
//  17   หน้าเว็บ hardcode ลำดับสถานะเอง                    แดง
//  18   ปุ่มสร้างแฟ้มขึ้นทุกใบ                              แดง
//  19   ไม่บอกว่ายังไม่มีบัญชีเข้าระบบ                      แดง
//  20   เปิด route ให้ทุก role                             แดง
//  21   ถอดการลงทะเบียนใน index.js                         แดง
//
// (*) ข้อ 7 **ไม่ใช่เทสว่าง แต่เป็นด่านที่ไปไม่ถึง** — `canTransition` เคยมี
// บรรทัดเช็ค `STAGES[to].legacy` แยกไว้ต่างหาก ถอดออกแล้วยังเขียวเพราะไม่มี
// ลิสต์ไหนใน ALLOWED มี "approved" อยู่เลย ตารางจึงปฏิเสธไปก่อนถึงบรรทัดนั้น
// เสมอ ตามกฎ "ด่านที่ไปไม่ถึง ให้ลบ ไม่ใช่ ship" จึงลบทิ้งแล้วให้ ALLOWED เป็น
// เจ้าของกติกาที่เดียว — ยืนยันว่าด่านที่เหลือทำงานจริงด้วย injection 7b
// (เติม "approved" ลง ALLOWED.interview → แดง 2)
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(fnDir, "..");

const r = require(join(fnDir, "hr-recruitment.js"));

let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const eq = (name, got, want) =>
  check(`${name} (${JSON.stringify(got)} = ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

const ok = (from, to) => r.canTransition(from, to).ok;

// ── 1. สายปกติเดินได้ครบ ───────────────────────────────────────────────────
{
  const path = ["new", "reviewing", "interview", "offer", "accepted", "hired"];
  for (let i = 0; i < path.length - 1; i++) {
    check(`${path[i]} → ${path[i + 1]} เดินได้`, ok(path[i], path[i + 1]));
  }
}

// ── 2. กระโดดข้ามขั้นไม่ได้ ────────────────────────────────────────────────
// ใบที่กระโดดจาก new ไป hired ตรงๆ แปลว่ามีคนถูกจ้างโดยไม่มีบันทึกว่าเคย
// สัมภาษณ์หรือเคยยื่นข้อเสนอ ซึ่งเป็นเอกสารที่ต้องมีตอนมีข้อพิพาท
{
  for (const [from, to] of [
    ["new", "hired"], ["new", "offer"], ["new", "accepted"],
    ["reviewing", "hired"], ["reviewing", "accepted"], ["interview", "hired"],
    ["offer", "hired"],
  ]) {
    check(`${from} → ${to} ไม่ได้`, !ok(from, to));
  }
  check("บอกเหตุผลเป็นข้อความไทย", /ไม่ได้/.test(r.canTransition("new", "hired").reason || ""));
}

// ── 3. ปฏิเสธได้ทุกขั้นที่ยังไม่ปิด ────────────────────────────────────────
{
  for (const from of ["new", "reviewing", "interview", "offer"]) {
    check(`${from} → rejected ได้`, ok(from, "rejected"));
  }
  // ผู้สมัครปฏิเสธได้เฉพาะหลังมีข้อเสนอ — ก่อนหน้านั้นยังไม่มีอะไรให้ปฏิเสธ
  check("offer → declined ได้", ok("offer", "declined"));
  check("accepted → declined ได้ (ถอนตัวก่อนเริ่มงาน)", ok("accepted", "declined"));
  check("new → declined ไม่ได้", !ok("new", "declined"));
  check("interview → declined ไม่ได้", !ok("interview", "declined"));
}

// ── 4. ถอยกลับหนึ่งขั้นได้ แต่ถอยข้ามไม่ได้ ────────────────────────────────
// สัมภาษณ์รอบสองเกิดขึ้นจริง ถ้าบล็อกไว้คนจะไปสร้างใบสมัครใบที่สองแทน
{
  check("interview → reviewing ได้ (คุยใหม่)", ok("interview", "reviewing"));
  check("offer → interview ได้", ok("offer", "interview"));
  check("accepted → offer ได้", ok("accepted", "offer"));
  check("offer → new ไม่ได้ (ถอยข้าม)", !ok("offer", "new"));
  check("accepted → interview ไม่ได้ (ถอยข้าม)", !ok("accepted", "interview"));
}

// ── 5. สถานะปลายทางปิดแล้วปิดเลย ───────────────────────────────────────────
{
  for (const from of ["hired", "rejected", "declined"]) {
    for (const to of ["new", "interview", "offer", "hired"]) {
      if (from === to) continue;
      check(`${from} → ${to} ไม่ได้ (ปิดแล้ว)`, !ok(from, to));
    }
  }
  check("บอกว่าปิดไปแล้ว", /ปิดไปแล้ว/.test(r.canTransition("hired", "offer").reason || ""));
}

// ── 6. ค่าเก่าจากหน้ารีวิวฝั่งเว็บลูกค้า ───────────────────────────────────
// ข้อมูลที่ลงไปแล้วเปลี่ยนย้อนหลังไม่ได้ ใบที่ค้างสถานะ approved ต้องเดินต่อได้
// ไม่ใช่ติดตาย และต้องย้าย *ไป* ไม่ได้ (ค่าเก่าไม่ใช่ปลายทางที่เลือกใหม่)
{
  eq("ใบที่ไม่มีสถานะ = new", r.stageOf({}), "new");
  eq("สถานะที่ไม่รู้จัก = new", r.stageOf({ status: "อะไรก็ไม่รู้" }), "new");
  eq("ค่าเก่ายังอ่านได้", r.stageOf({ status: "approved" }), "approved");
  check("approved → offer ได้ (ใบเก่าเดินต่อได้)", ok("approved", "offer"));
  // กติกา "ย้ายไปค่าเก่าไม่ได้" ถูกบังคับด้วย ALLOWED (ไม่มีลิสต์ไหนมี approved)
  // ไม่ใช่ด้วยด่านแยก — ด่านแยกที่เคยมีไปไม่ถึงตลอดกาล จึงถูกลบทิ้งแล้ว
  for (const from of ["new", "reviewing", "interview", "offer", "accepted"]) {
    check(`ย้ายจาก ${from} ไป approved ไม่ได้`, !ok(from, "approved"));
  }
}

// ── 7. กดจ้างได้เฉพาะใบที่ตอบรับแล้ว ───────────────────────────────────────
// **นี่คือด่านที่แพงที่สุดถ้าพลาด** — จ้างคนที่ยังไม่ตอบรับ = แฟ้มพนักงานของคน
// ที่ยังไม่ตกลงจะมาทำงาน ซึ่งเดินเข้ารอบจ่ายเงินเดือนได้เลย
{
  check("accepted จ้างได้", r.canHire({ status: "accepted" }).ok);
  for (const s of ["new", "reviewing", "interview", "offer", "approved", "rejected", "declined"]) {
    check(`${s} จ้างไม่ได้`, !r.canHire({ status: s }).ok);
  }
  check("ใบที่จ้างไปแล้วกดซ้ำไม่ได้", !r.canHire({ status: "hired" }).ok);
  // กันกดสองครั้งซ้อน: ใบที่มีแฟ้มแล้วต้องไม่สร้างแฟ้มใบที่สอง
  check("ใบที่มีแฟ้มพนักงานแล้วกดซ้ำไม่ได้",
    !r.canHire({ status: "accepted", employee_id: "e1" }).ok);
}

// ── 8. ข้อมูลตั้งต้นของแฟ้ม — หยิบเฉพาะข้อเท็จจริงของตัวคน ────────────────
// เงินเดือน/วันเริ่มงาน/ประเภทการจ้าง ตกลงกันตอนยื่นข้อเสนอ ไม่ได้อยู่ในใบสมัคร
// **ห้ามเดาแทน HR** ค่าที่เดาให้แล้วไม่มีใครตรวจคือค่าที่จะไปโผล่ในรอบจ่ายเงิน
// เดือนรอบแรก
{
  const draft = r.employeeDraftFrom({
    full_name: " สมชาย ใจดี ", phone: "0800000000", email: "a@b.co",
    position_title: "ช่างซ่อม", experience: "3 ปี", resume_url: "https://x/y.pdf",
    status: "accepted", uid: "u1",
  });
  eq("หยิบเฉพาะฟิลด์ที่ตั้งใจ", Object.keys(draft).sort(), ["email", "name", "phone", "position"]);
  eq("ตัดช่องว่างหัวท้ายชื่อ", draft.name, "สมชาย ใจดี");
  check("ไม่เดาเงินเดือน", !("base_salary" in draft) && !("pay" in draft));
  check("ไม่เดาวันเริ่มงาน", !("hired_at" in draft));
  check("ไม่เดาประเภทการจ้าง", !("employment_type" in draft));
}

// ── 9. ตัวนับที่ HR ต้องเห็นก่อนอย่างอื่น ──────────────────────────────────
{
  const s = r.summarize([
    { status: "new" }, { status: "new" }, { status: "interview" },
    { status: "hired" }, { status: "rejected" }, {},
  ]);
  // ใบที่ไม่มีสถานะนับเป็น new ด้วย → new = 3
  eq("นับใบที่ยังไม่มีใครแตะ", s.untouched, 3);
  eq("นับใบที่ยังดำเนินอยู่ (ไม่รวมปลายทาง)", s.open, 4);
  eq("นับทั้งหมด", s.total, 6);
}

// ── 10. ปุ่มบนหน้าเว็บมาจาก server ไม่ใช่ลิสต์ที่หน้าเว็บถือเอง ────────────
{
  eq("ปุ่มจาก interview", r.nextStages("interview").sort(), ["offer", "rejected", "reviewing"]);
  eq("ใบที่ปิดแล้วไม่มีปุ่ม", r.nextStages("hired"), []);

  const ui = readFileSync(join(root, "src/pages/hr/Recruitment.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  check("หน้าเว็บ render ปุ่มจาก row.next", /row\.next\.map/.test(ui));
  // เครื่องสถานะมีสำเนาเดียว — ลิสต์ที่ hardcode ฝั่ง client คือสำเนาที่สอง
  check("หน้าเว็บไม่ถือลำดับสถานะเอง",
    !/'reviewing'\s*,\s*'interview'/.test(ui) && !/ALLOWED/.test(ui));
  check("ปุ่มสร้างแฟ้มขึ้นเฉพาะใบที่ตอบรับแล้ว",
    /row\.status === 'accepted' && !row\.employee_id/.test(ui));
  check("บอกว่ายังไม่มีบัญชีเข้าระบบ", /ยังไม่มีบัญชีเข้าระบบ/.test(ui));
  check("บอกว่ายังไม่มีการแจ้งเตือนใบสมัครใหม่", /ยังไม่แจ้งเตือนเมื่อมีใบสมัครใหม่/.test(ui));
  check("โมดอลบอกว่าเงินเดือน/วันเริ่มงานไม่ได้อยู่ในใบสมัคร",
    /ไม่ได้อยู่ในใบสมัคร/.test(ui));
}

// ── 11. กติกาของ callable ──────────────────────────────────────────────────
{
  const raw = readFileSync(join(fnDir, "hr-recruitment-api.js"), "utf8");
  const src = raw.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  for (const name of ["adminHrApplicationList", "adminHrApplicationSetStage", "adminHrApplicationHire"]) {
    const start = src.indexOf(`const ${name} = onCall`);
    const end = src.indexOf("\n  });", start);
    check(`ตัด ${name} ได้จริง`, start > 0 && end > start);
    check(`${name} มี gate requireStaffRole(..., HR_ROLES)`,
      /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(src.slice(start, end)));
  }

  // เครื่องสถานะต้องถูกถามจริง ไม่ใช่เขียนสถานะที่ client ส่งมาลงตรงๆ
  check("ย้ายสถานะผ่าน canTransition", /canTransition\(stageOf\(app\), to\)/.test(src));
  check("ปฏิเสธแล้ว throw", /if \(!verdict\.ok\) throw new HttpsError/.test(src));
  check("กดจ้างผ่าน canHire", /canHire\(app\)/.test(src));

  // สร้างแฟ้มด้วยทางเดียวกับหน้าทะเบียน ไม่ได้เขียนใหม่ — สำเนาที่สองของการ
  // สร้างแฟ้มคือทางที่ employees_private หรือ employee_code จะหายไปเงียบๆ
  check("สร้างแฟ้มด้วย createEmployeeRecord", /createEmployeeRecord\(db, \{/.test(src));
  check("ไม่ push employees เอง", !/ref\("employees"\)\.push\(\)/.test(src));
  check("ไม่เขียน employees_private เอง", !/employees_private\/\$\{/.test(src));

  // **ห้ามออกบัญชี login** — การออกบัญชีคือการให้สิทธิ์พร้อม role ซึ่ง gate
  // ไว้ที่ CEO ถ้าสายนี้ออกบัญชีเองได้ role HR จะสร้างบัญชี role อะไรก็ได้
  check("ไม่ออกบัญชี Auth ในสายนี้",
    !/getAuth\(\)/.test(src) && !/adminStaffCreate|createUser/.test(src));
  check("บอกออกไปว่ายังไม่ได้ออกบัญชี", /accountIssued: false/.test(src));

  // ผูกสองทาง — ตอบได้ทั้ง "คนนี้มาจากใบไหน" และ "ใบนี้กลายเป็นใคร"
  check("ใบสมัครชี้ไปแฟ้ม", /employee_id: employeeId/.test(src));
  check("แฟ้มชี้กลับไปใบสมัคร", /application_id`\)\.set\(id\)/.test(src));

  // อ่านตาม index ไม่กวาดทั้งโหนด (กฎค่า RTDB)
  check("อ่านใบสมัครตาม index created_at",
    /orderByChild\("created_at"\)\.limitToLast\(MAX_APPLICATIONS\)/.test(src));

  // ส่งออกเฉพาะฟิลด์ที่ตั้งใจ ไม่ใช่ทั้งก้อน
  const pub = src.slice(src.indexOf("function publicApplication"), src.indexOf("function registerHrRecruitment"));
  check("ส่งออกใบสมัครแบบ allowlist", !/\.\.\.a\b/.test(pub) && /full_name: a\.full_name/.test(pub));
}

// ── 12. ทางเข้าและสิทธิ์ ───────────────────────────────────────────────────
{
  const idx = readFileSync(join(fnDir, "index.js"), "utf8");
  check("index.js ลงทะเบียน registerHrRecruitment",
    /require\("\.\/hr-recruitment-api"\)\.registerHrRecruitment\(\)/.test(idx));

  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  const line = app.split("\n").find((l) => l.includes('path="/employees/recruitment"')) || "";
  check(`route ถูก gate ด้วย CEO/HR (${line.trim().slice(0, 48)}...)`,
    /'CEO'/.test(line) && /'HR'/.test(line) && /Navigate to="\//.test(line));

  // เส้นทางต้องอยู่ในขอบเขต role HR ไม่งั้น HR กดเมนูแล้วถูกเด้งกลับ
  const scope = readFileSync(join(root, "src/utils/hrScope.ts"), "utf8");
  const prefixes = [...scope.matchAll(/'(\/[a-z-]+)'/g)].map((m) => m[1]);
  check(`/employees/recruitment อยู่ในขอบเขต HR (${prefixes.join(" ")})`,
    prefixes.some((p) => "/employees/recruitment".startsWith(`${p}/`)));
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
