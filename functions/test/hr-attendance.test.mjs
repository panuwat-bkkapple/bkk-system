// =============================================================================
// ลงเวลาเข้า-ออกงาน — กติกา + การต่อสาย
//   node functions/test/hr-attendance.test.mjs
//
// ชุดนี้เฝ้าสามเส้นที่พังแล้วเงียบ:
//   1. **พิกัดที่หายไปต้องไม่กลายเป็น (0,0)** — `Number(null) === 0` และ 0 เป็น
//      ละติจูดที่ถูกต้อง (อ่าวกินี) การเช็ค `Number.isFinite` อย่างเดียวจึงปล่อย
//      แถวที่ไม่มีพิกัดให้ผ่านโดยหน้าตาเหมือนการมาทำงานปกติ
//   2. **กะข้ามเที่ยงคืนต้องเป็นแถวเดียว** — ไม่งั้นวันแรกอ่านว่า "ไม่ได้ออกงาน"
//      และวันหลังอ่านว่า "ไม่ได้เข้างาน" ทั้งที่คนคนเดียวทำงานกะเดียว
//   3. **เวลาต้องมาจาก server** — นาฬิกาเครื่องตั้งเองได้
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                                | ผล |
//   |----------------------------------------------------------|----|
//   | พิกัดใช้ `Number()` แทน guard (null -> 0)                  | แดง 9 |
//   | พิกัดที่หายไปกลายเป็น (0,0) แทนการปฏิเสธ                    | แดง 2 |
//   | สาขาที่ไม่มีพิกัดถือว่าอยู่ที่ (0,0)                        | แดง 2 |
//   | กะข้ามเที่ยงคืนผูกตามนาฬิกา ไม่ใช่ตามวันที่กะเริ่ม           | แดง 1 |
//   | เวลาในตารางกะที่เสียถูกปัดเป็น 00:00                       | แดง 3 |
//   | ตารางเวรแพ้กะประจำตัว                                     | แดง 2 |
//   | ไม่มีกะ = บล็อกการเข้างาน                                  | แดง 3 |
//   | ไม่มีกะ = รายงานว่าสาย 0 นาที (แทน "ไม่รู้")                | แดง 1 |
//   | นอกรัศมีแล้วไม่บอกระยะจริง                                 | แดง 1 |
//   | สัญญาณไม่แม่นแล้วบอกว่า "อยู่ผิดที่"                        | แดง 1 |
//   | ออกงานนอกรัศมี = บล็อก (แถวค้างเปิดตลอดไป)                 | แดง 2 |
//   | ไม่หักเวลาพักออกจากชั่วโมงทำงาน                            | แดง 1 |
//   | เข้างานซ้ำเขียนทับเวลาแรกได้                               | แดง 1 |
//   | พ้นสภาพแล้วยังใช้แอปได้                                    | แดง 1 |
//   | ไม่ตรวจวงกลมสายบังคับบัญชา                                 | แดง 1 |
//   | callable รับเวลาจาก client                                | แดง 2 |
//   | ไม่ใช้ transaction ตอนเขียน                                | แดง 1 |
//   | กวาดโหนด `attendance` ทั้งก้อน                            | แดง 2 |
//
// **แถว "callable รับเวลาจาก client" เคยเขียว** — ด่านเดิมเขียนว่า `d.now`
// อย่างเดียว ส่วน injection เขียน `(request.data || {}).now` ซึ่งเดินผ่านหน้า
// ไปเฉยๆ ด่านจึงถูกเปลี่ยนไปดู *การกำหนดค่าให้ `now`* แทนรูปประโยคที่บังเอิญ
// นึกออกตอนเขียนเทส — injection ไม่ได้ตรวจโค้ด มันตรวจเทส
// =============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, "..");
const A = require(join(FUNCTIONS, "hr-attendance.js"));
const AUTH = require(join(FUNCTIONS, "hr-employee-auth.js"));
const CORE = require(join(FUNCTIONS, "hr-core.js"));

let passed = 0;
const failures = [];
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const TH = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00Z`) - A.TZ_OFFSET_MS;
const { shifts } = A.normalizeShifts(null);
const MORNING = A.shiftById(shifts, "morning");
const NIGHT = A.shiftById(shifts, "night");

// สาขาจริงหนึ่งใบ (พิกัดสยาม) + ใบที่ไม่มีพิกัด + ใบที่ปิด
const BRANCHES = {
  b1: { name: "สาขาสยาม", lat: 13.7460, lng: 100.5340, isActive: true },
  b2: { name: "สาขาไม่มีพิกัด", isActive: true },
  b3: { name: "สาขาปิดแล้ว", lat: 13.7461, lng: 100.5341, isActive: false },
};
const AT_SITE = { lat: 13.7461, lng: 100.5341, accuracy_m: 12 };
const FAR = { lat: 13.8000, lng: 100.6000, accuracy_m: 12 };

// ── 1. พิกัด ───────────────────────────────────────────────────────────────
{
  check("lat ที่หายไปไม่กลายเป็น 0", A.coordsOf({ lat: null, lng: 100.5 }) === null);
  check("lat ที่เป็นสตริงว่างไม่กลายเป็น 0", A.coordsOf({ lat: "", lng: 100.5 }) === null);
  check("lat ที่เป็น undefined ไม่กลายเป็น 0", A.coordsOf({ lng: 100.5 }) === null);
  // 0,0 **เป็นพิกัดจริง** — มันต้องผ่านการแปลง แล้วไปตกที่ "อยู่ไกลเกินไป"
  // ไม่ใช่ถูกปฏิเสธว่า "ไม่มีพิกัด" ซึ่งจะบอกคนใช้ผิดเรื่อง
  check("0,0 เป็นพิกัดที่แปลงได้ (แต่จะไกลเกินไป)", A.coordsOf({ lat: 0, lng: 0 }) !== null);
  check("นอกช่วงโลกไม่ใช่พิกัด", A.coordsOf({ lat: 91, lng: 0 }) === null);
  check("true ไม่ใช่พิกัด", A.coordsOf({ lat: true, lng: true }) === null);
  check("ระยะทางคำนวณได้ (~1 กม.)",
    Math.abs(A.haversineMeters({ lat: 13.75, lng: 100.5 }, { lat: 13.759, lng: 100.5 }) - 1000) < 20);
}

// ── 2. จุดลงเวลา ───────────────────────────────────────────────────────────
{
  const sites = A.attendanceSites(BRANCHES);
  check("สาขาที่ไม่มีพิกัดถูกตัดทิ้ง ไม่ใช่ถือว่าอยู่ที่ (0,0)",
    sites.length === 1 && sites[0].id === "b1");
  check("สาขาที่ปิดแล้วไม่ใช่จุดลงเวลา", !sites.some((s) => s.id === "b3"));

  const near = A.nearestSite(AT_SITE, sites, 150);
  check("ยืนหน้าร้าน = อยู่ในรัศมี", near && near.inside && near.distance_m < 30);
  const far = A.nearestSite(FAR, sites, 150);
  check("อยู่ไกล = นอกรัศมี และรู้ระยะจริง", far && !far.inside && far.distance_m > 1000);
}

// ── 3. กะ ──────────────────────────────────────────────────────────────────
{
  check("กะตั้งต้นมีสามกะ", shifts.length === 3);
  check("กะดึกถูกทำเครื่องหมายว่าข้ามเที่ยงคืน", NIGHT.crosses_midnight === true);
  check("กะเช้าไม่ข้ามเที่ยงคืน", MORNING.crosses_midnight === false);

  // เวลาเสียต้อง **ถูกตัดทิ้งพร้อมเหตุผล** ไม่ใช่ปัดเป็น 00:00 ซึ่งจะทำให้ทุกคน
  // ในกะนั้นสายทั้งวันโดยไม่มีใครรู้ว่าทำไม
  const bad = A.normalizeShifts({ x: { label: "เพี้ยน", start: "8:00", end: "17:00" } });
  check("เวลาที่ไม่ใช่ HH:MM ถูกตัดทิ้ง", bad.shifts.length === 0 && bad.dropped.length === 1);
  // `?.` ตั้งใจ — injection ที่ทำให้ dropped ว่างต้องได้ "แดง N" ไม่ใช่ stack
  // trace ที่อ่านจำนวนข้อที่แดงไม่ออก (บทเรียนจาก hr-filing injection)
  check("และบอกเหตุผลไว้ด้วย", /HH:MM/.test(bad.dropped[0]?.reason || ""));
  check("25:00 ไม่ใช่เวลา", A.minutesOfDay("25:00") === null);
  check("08:00 = 480 นาที", A.minutesOfDay("08:00") === 480);
  // 00:00 ต้องแปลงได้จริง ไม่ใช่ตกเพราะ falsy
  check("00:00 = 0 ไม่ใช่ null", A.minutesOfDay("00:00") === 0);

  const off = A.normalizeShifts({ a: { start: "08:00", end: "17:00", active: false }, b: { start: "09:00", end: "18:00" } });
  check("กะที่ปิดใช้งานไม่อยู่ในตาราง", off.shifts.length === 1 && off.shifts[0].id === "b");

  const same = A.normalizeShifts({ z: { start: "08:00", end: "08:00" } });
  check("กะที่เข้าและออกเวลาเดียวกันถูกตัดทิ้ง", same.shifts.length === 0);
}

// ── 4. กะของคนคนนั้นในวันนั้น ──────────────────────────────────────────────
{
  const emp = { default_shift_id: "morning" };
  const roster = { "2026-09-10": { shift_id: "night" } };
  check("ตารางเวรมาก่อนกะประจำตัว",
    A.resolveShift({ shifts, roster, employee: emp, iso: "2026-09-10" }).shift.id === "night");
  check("ไม่มีเวรวันนั้น = ใช้กะประจำตัว",
    A.resolveShift({ shifts, roster, employee: emp, iso: "2026-09-11" }).shift.id === "morning");
  check("ไม่มีทั้งคู่ = ไม่มีกะ (ไม่ใช่เดาเป็นกะเช้า)",
    A.resolveShift({ shifts, roster: {}, employee: {}, iso: "2026-09-11" }).shift === null);
  check("แหล่งที่มาบอกได้ว่ามาจากไหน",
    A.resolveShift({ shifts, roster, employee: emp, iso: "2026-09-10" }).source === "roster");
}

// ── 5. กะข้ามเที่ยงคืน — ข้อที่ทำให้ต้องเขียนไฟล์นี้ ───────────────────────
{
  const emp = { default_shift_id: "night" };
  const inAt = TH("2026-09-04", "22:05");
  const d1 = A.attendanceDayFor({ now: inAt, shifts, roster: {}, employee: emp });
  check("เข้ากะดึก 22:05 ผูกกับวันที่ 4", d1.iso === "2026-09-04");

  const stillIn = TH("2026-09-05", "01:00");
  const d2 = A.attendanceDayFor({ now: stillIn, shifts, roster: {}, employee: emp });
  check("ตี 1 ของวันที่ 5 ยังผูกกับกะที่เริ่มวันที่ 4", d2.iso === "2026-09-04");

  const w = A.shiftWindow(NIGHT, "2026-09-04");
  check("ช่วงกะดึกจบเช้าวันถัดไป", A.bangkokIso(w.endMs) === "2026-09-05");

  // กะเช้าต้องไม่ถูกดูดไปเป็นของเมื่อวาน
  const day = A.attendanceDayFor({ now: TH("2026-09-05", "08:10"), shifts, roster: {}, employee: { default_shift_id: "morning" } });
  check("กะเช้า 08:10 ผูกกับวันของตัวเอง", day.iso === "2026-09-05");
}

// ── 6. คำตัดสินตอนเข้างาน ──────────────────────────────────────────────────
{
  const emp = { default_shift_id: "morning" };
  const day = A.attendanceDayFor({ now: TH("2026-09-04", "08:05"), shifts, roster: {}, employee: emp });
  const base = { now: TH("2026-09-04", "08:05"), sites: BRANCHES, settings: {}, existing: null, day };

  const noGps = A.checkInVerdict({ ...base, coords: { lat: null, lng: null } });
  check("ไม่มีพิกัด = ปฏิเสธ", noGps.ok === false && noGps.code === "no_coords");
  check("และบอกให้เปิด GPS", /GPS/.test(noGps.message));

  const lowAcc = A.checkInVerdict({ ...base, coords: { ...AT_SITE, accuracy_m: 900 } });
  check("สัญญาณไม่แม่นพอ = ปฏิเสธ", lowAcc.code === "low_accuracy");
  // ข้อความต้องบอกว่า "รอสัญญาณ" ไม่ใช่ "อยู่ผิดที่" — คนที่ยืนถูกที่แล้วโดน
  // บอกว่าอยู่ผิดที่จะเลิกเชื่อระบบตั้งแต่วันแรก
  check("และบอกให้รอสัญญาณ ไม่ใช่บอกว่าอยู่ผิดที่",
    /รอ/.test(lowAcc.message) && !/ห่าง|ผิดที่/.test(lowAcc.message));

  const far = A.checkInVerdict({ ...base, coords: FAR });
  check("นอกรัศมี = ปฏิเสธ", far.code === "too_far");
  check("และบอกระยะจริงเป็นตัวเลข", far.distance_m > 1000 && /\d/.test(far.message));

  const ok = A.checkInVerdict({ ...base, coords: AT_SITE });
  check("ยืนหน้าร้าน = ผ่าน", ok.ok === true);
  check("บันทึกสาขาที่เข้าเกณฑ์", ok.site.id === "b1");
  check("สาย 5 นาทีจากเวลาเริ่มกะ", ok.late_min === 5);
  check("ยังอยู่ในช่วงผ่อนผัน", ok.within_grace === true);

  const late = A.checkInVerdict({
    ...base, now: TH("2026-09-04", "08:40"), coords: AT_SITE,
    day: A.attendanceDayFor({ now: TH("2026-09-04", "08:40"), shifts, roster: {}, employee: emp }),
  });
  check("สาย 40 นาที = เกินช่วงผ่อนผัน", late.late_min === 40 && late.within_grace === false);

  const again = A.checkInVerdict({ ...base, coords: AT_SITE, existing: { in_at: 1 } });
  check("เข้างานซ้ำในกะเดิม = ปฏิเสธ", again.code === "already_in");

  const noSites = A.checkInVerdict({ ...base, coords: AT_SITE, sites: { b2: { name: "ไม่มีพิกัด" } } });
  check("ไม่มีสาขาที่ตั้งพิกัดไว้ = บอกให้ไปตั้งค่า ไม่ใช่บอกว่าอยู่ไกล",
    noSites.code === "no_sites");
}

// ── 7. ไม่มีกะ ก็ยังเข้างานได้ (กฎข้อ 4) ───────────────────────────────────
{
  const day = A.attendanceDayFor({ now: TH("2026-09-04", "10:00"), shifts, roster: {}, employee: {} });
  const v = A.checkInVerdict({
    now: TH("2026-09-04", "10:00"), coords: AT_SITE, sites: BRANCHES,
    settings: {}, existing: null, day,
  });
  // การบล็อกคนเพราะแอดมินยังไม่ได้จัดเวร คือการลงโทษคนผิดคน
  check("ไม่มีกะยังเช็คอินได้", v.ok === true);
  check("แต่ติดธงไว้ให้แอดมินเห็น", v.no_shift === true);
  check("และไม่คำนวณว่าสายกี่นาที (ไม่ใช่ 0)", v.late_min === null);
}

// ── 8. คำตัดสินตอนออกงาน ───────────────────────────────────────────────────
{
  const inAt = TH("2026-09-04", "08:00");
  const outAt = TH("2026-09-04", "17:00");
  const win = A.shiftWindow(MORNING, "2026-09-04");
  const base = { now: outAt, coords: AT_SITE, sites: BRANCHES, settings: {}, shift: MORNING, window: win };

  check("ยังไม่เข้างาน = ออกไม่ได้",
    A.checkOutVerdict({ ...base, existing: null }).code === "not_in");
  check("ออกไปแล้ว = ออกซ้ำไม่ได้",
    A.checkOutVerdict({ ...base, existing: { in_at: inAt, out_at: outAt } }).code === "already_out");

  const ok = A.checkOutVerdict({ ...base, existing: { in_at: inAt } });
  check("ออกงานปกติ = ผ่าน", ok.ok === true);
  check("ชั่วโมงทำงานหักพักเที่ยงแล้ว (9 ชม. - 1 ชม. = 480 นาที)", ok.worked_min === 480);
  check("ไม่ได้ออกก่อน", ok.early_min === 0);

  const early = A.checkOutVerdict({ ...base, now: TH("2026-09-04", "15:00"), existing: { in_at: inAt } });
  check("ออกก่อนสองชั่วโมง", early.early_min === 120);

  // ออกงานนอกรัศมีต้อง **ผ่าน** แต่ติดธง — คนที่ออกไปส่งของแล้วกลับบ้านเลย
  // ยังต้องปิดกะได้ ไม่งั้นแถวจะค้างเปิดตลอดไปแล้วอ่านว่า "ยังทำงานอยู่"
  const outside = A.checkOutVerdict({ ...base, coords: FAR, existing: { in_at: inAt } });
  check("ออกงานนอกรัศมียังผ่าน", outside.ok === true);
  check("แต่ติดธงว่าอยู่นอกพื้นที่", outside.outside === true);

  check("ออกก่อนเวลาเข้า = ปฏิเสธ",
    A.checkOutVerdict({ ...base, now: inAt - 1000, existing: { in_at: inAt } }).code === "before_in");
  check("ออกงานก็ต้องมีพิกัด",
    A.checkOutVerdict({ ...base, coords: {}, existing: { in_at: inAt } }).code === "no_coords");
}

// ── 9. ใครกดในแอปพนักงาน ───────────────────────────────────────────────────
{
  const emps = {
    e1: { name: "ก", status: "active", links: { auth_uid: "u1" } },
    e2: { name: "ข", status: "resigned", links: { auth_uid: "u2" } },
    e3: { name: "ค", status: "probation", links: { staff_id: "s9" } },
    e4: { name: "ง", status: "active", links: { rider_id: "u4" } },
  };
  check("ผูกด้วย auth_uid", AUTH.matchEmployeeByAuth(emps, { uid: "u1" }).id === "e1");
  check("ผูกด้วย staff_id ผ่าน uid ของบัญชี",
    AUTH.matchEmployeeByAuth(emps, { uid: "ux", staffMap: { s9: { uid: "ux" } } }).id === "e3");
  check("ผูกด้วย rider_id (riders/{uid})", AUTH.matchEmployeeByAuth(emps, { uid: "u4" }).id === "e4");
  // พ้นสภาพต้องแยกจาก "ยังไม่ได้ผูกบัญชี" — สองเรื่องนี้บอกคนใช้คนละอย่าง
  check("พ้นสภาพแล้วใช้แอปไม่ได้", AUTH.matchEmployeeByAuth(emps, { uid: "u2" }).reason === "not_working");
  check("ยังไม่ได้ผูกบัญชี = คนละเหตุผล", AUTH.matchEmployeeByAuth(emps, { uid: "zz" }).reason === "not_linked");
  check("ทุกเหตุผลมีข้อความให้แสดง",
    ["no_uid", "not_linked", "not_working"].every((r) => AUTH.REASON_MESSAGE[r]));
}

// ── 10. หัวหน้างาน ─────────────────────────────────────────────────────────
{
  const E = { a: { supervisor_id: "b" }, b: {}, c: { supervisor_id: "a" } };
  check("ตัวเองเป็นหัวหน้าตัวเองไม่ได้", CORE.supervisorChainError(E, "a", "a") !== null);
  check("หัวหน้าที่ไม่มีในทะเบียนไม่ได้", CORE.supervisorChainError(E, "a", "zz") !== null);
  check("หัวหน้าปกติได้", CORE.supervisorChainError(E, "c", "b") === null);
  // วงกลมทำให้ใบลาของทั้งคู่ไม่มีใครอนุมัติได้ และมันจะไม่ error ที่ไหน
  check("สายบังคับบัญชาวนกลับ = ปฏิเสธ",
    CORE.supervisorChainError({ a: { supervisor_id: "b" }, b: { supervisor_id: "a" } }, "a", "b") !== null);
  check("ไม่ระบุหัวหน้า = ผ่าน", CORE.supervisorChainError(E, "a", "") === null);
  check("sanitizer เก็บ supervisor_id และ default_shift_id",
    CORE.sanitizeEmployeePublic(
      { name: "ก ข", first_name: "ก", last_name: "ข", employment_type: "monthly", hired_at: 1,
        supervisor_id: "e9", default_shift_id: "night" },
    ).value.supervisor_id === "e9");
}

// ── 11. การต่อสาย (สแกนซอร์ส) ──────────────────────────────────────────────
{
  const read = (f) => readFileSync(join(FUNCTIONS, f), "utf8");
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const API = strip(read("hr-attendance-api.js"));

  // **เวลาต้องมาจาก server** — นาฬิกาเครื่องตั้งเองได้ และมันคือช่องที่ง่าย
  // ที่สุดในการย้อนเวลาเข้างาน
  // **ด่านนี้เคยว่าง และ injection เป็นตัวจับได้** — เขียนไว้ว่า `d.now` อย่าง
  // เดียว แล้ว injection ที่เขียน `(request.data || {}).now` เดินผ่านหน้าไป
  // เฉยๆ เทสจึงต้องดูที่ *การกำหนดค่าให้ now* ไม่ใช่ที่รูปประโยคที่บังเอิญ
  // นึกออกตอนเขียนเทส
  const nowAssigns = [...API.matchAll(/const now\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  check("มีการกำหนดเวลาให้ตรวจจริง (ตัวสแกนยังใช้ได้)", nowAssigns.length >= 3);
  check(`ทุกจุดใช้เวลาของ server (พบ: ${nowAssigns.join(" | ") || "ไม่มี"})`,
    nowAssigns.length > 0 && nowAssigns.every((v) => v === "nowMs()"));
  check("ไม่มีที่ไหนอ่านเวลาจากสิ่งที่ผู้เรียกส่งมา",
    !/(request\.data|\bd)\b[^;\n]*\.(now|at|timestamp|client_time)\b/.test(API));

  // uid ต้องมาจาก token ไม่ใช่ body — uid ที่ปลอมได้ = ลงเวลาแทนคนอื่นได้
  check("ไม่รับ employeeId จาก body ในเส้นทางของพนักงานเอง",
    !/requireEmployeeCaller[\s\S]{0,400}?d\.employeeId/.test(API));
  check("ทุก callable ของพนักงานผ่าน requireEmployeeCaller",
    (API.match(/requireEmployeeCaller\(/g) || []).length >= 4);

  // กฎค่า RTDB — ห้ามกวาดโหนดทั้งก้อน
  check("ไม่กวาดโหนด attendance ทั้งก้อน", !/ref\("attendance"\)/.test(API));
  check("ไม่กวาดโหนด shift_roster ทั้งก้อน", !/ref\("shift_roster"\)/.test(API));
  check("อ่านช่วงวันด้วย orderByKey ไม่ใช่ดึงทั้ง subtree แล้วกรอง",
    (API.match(/orderByKey\(\)/g) || []).length >= 3);

  // เข้างานซ้ำต้องไม่เขียนทับเวลาแรก
  check("เขียนด้วย transaction (กดสองครั้งพร้อมกันได้แถวเดียว)",
    (API.match(/\.transaction\(/g) || []).length >= 2);

  check("ลงทะเบียนใน index.js แล้ว",
    /require\("\.\/hr-attendance-api"\)\.registerHrAttendance\(/.test(read("index.js")));

  // ── ราวกันตกของทั้งแอปพนักงาน: callable ทุกตัวต้องมีด่าน ────────────────
  //
  // **บัญชี Firebase Auth ของโปรเจกต์นี้เป็นกองเดียวกันทั้งระบบ** — พนักงาน
  // ไรเดอร์ ดีลเลอร์ **และลูกค้า** (`createUserWithEmailAndPassword` ที่
  // `bkk-frontend-next/app/components/loginActions.ts`) ใครก็ตามที่มีบัญชีจึง
  // ยิง callable เหล่านี้ได้ **หน้าล็อกอินไม่ใช่ด่าน** ด่านคือบรรทัดเดียวที่
  // ต้นฟังก์ชัน และตัวที่ลืมใส่จะไม่ error อะไรเลย มันจะแค่ตอบข้อมูลให้คนแปลกหน้า
  //
  // ตั้งชื่อขึ้นต้น `employee*`/`supervisor*` = ของเจ้าตัว ต้องใช้
  // `requireEmployeeCaller` · `admin*` = ของฝ่ายบุคคล ต้องใช้ `requireStaffRole`
  {
    const files = ["hr-attendance-api.js", "hr-employee-portal.js"];
    const rows = [];
    for (const f of files) {
      const src = strip(read(f));
      for (const m of src.matchAll(/const (\w+) = onCall\(/g)) {
        const body = src.slice(m.index, m.index + 900);
        rows.push({
          file: f,
          name: m[1],
          employeeGate: body.includes("requireEmployeeCaller("),
          staffGate: body.includes("requireStaffRole("),
        });
      }
    }
    check(`มี callable ให้ตรวจจริง (พบ ${rows.length})`, rows.length >= 15);

    const ungated = rows.filter((r) => !r.employeeGate && !r.staffGate);
    check(`ทุก callable มีด่าน (ไม่มีด่าน: ${ungated.map((r) => r.name).join(", ") || "ไม่มี"})`,
      ungated.length === 0);

    const selfWrong = rows
      .filter((r) => /^(employee|supervisor)/.test(r.name) && !r.employeeGate);
    check(`เส้นทางของเจ้าตัวใช้ requireEmployeeCaller ครบ (ผิด: ${selfWrong.map((r) => r.name).join(", ") || "ไม่มี"})`,
      selfWrong.length === 0);

    const adminWrong = rows.filter((r) => /^admin/.test(r.name) && !r.staffGate);
    check(`เส้นทางของฝ่ายบุคคลใช้ requireStaffRole ครบ (ผิด: ${adminWrong.map((r) => r.name).join(", ") || "ไม่มี"})`,
      adminWrong.length === 0);

    // ด่านตัวตนของแอป — ถ้าไม่มีตัวนี้ แอปจะรู้ว่าใครเป็นใครก็ต่อเมื่อยิง
    // callable ที่อ่านข้อมูลจริง ซึ่งแปลว่าต้องขอสิทธิ์ตำแหน่งไปก่อนแล้ว
    check("มี employeeMe ไว้ให้แอปตรวจตัวตนก่อนขอสิทธิ์ตำแหน่ง",
      rows.some((r) => r.name === "employeeMe" && r.employeeGate));
  }
  check("ฝ่ายบุคคลอ่านของทุกคนได้ผ่าน gate ของ HR",
    /requireStaffRole\(db, request\.auth, HR_ROLES\)/.test(API));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
