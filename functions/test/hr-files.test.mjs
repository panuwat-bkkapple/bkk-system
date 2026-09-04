// =============================================================================
// แฟ้มเอกสารพนักงาน — เทสออฟไลน์ (ไม่ต้องมี Firebase ไม่ต้องมีคีย์)
//   node functions/test/hr-files.test.mjs
//
// ─── ผล injection (ทำลายกฎทีละข้อแล้วดูว่าแดงไหม) ─────────────────────────
//
//   | ทำลายอะไร                                                | ผล |
//   |----------------------------------------------------------|----|
//   | `required` ของ ly01/sso_1_03 คืน true เสมอ (ไม่ดูประเภทจ้าง) | แดง 2 |
//   | ถอดกฎ "photo_url นับเป็นมีรูปแล้ว"                          | แดง 1 |
//   | `driver_license` required เสมอ (ไม่ดู hasRider)             | แดง 2 |
//   | เทียบขนาดจากความยาว base64 แทน bytes ที่ decode แล้ว        | แดง 1 |
//   | รับ contentType ด้วย `image/.*` แทน allowlist               | แดง 1 |
//   | ถอดการล้าง `/` `\\` ออกจาก safeFilename                     | แดง 1 |
//   | ถอด sanitize ของ employeeId ใน fileStoragePath              | แดง 1 |
//   | ถอด `document_uploaded`/`document_deleted` จาก catalogue    | แดง 1 |
//
// **ข้อที่ไม่มีอะไรจับได้ และบันทึกไว้ตรงๆ แทนการแต่ง fixture:**
// `MAX_FILE_BYTES` เปลี่ยนค่าเป็นเท่าไรก็ไม่มีเทสไหนแดง นอกจากเทสที่อ้างค่านั้น
// เอง — มันเป็น **นโยบาย** ไม่ใช่ค่าที่คำนวณมาจากอะไร เทสจึงตรึงแค่ "ต้องอยู่ใต้
// เพดาน payload ของ callable หลัง base64 พองแล้ว" ซึ่งเป็นข้อเท็จจริงที่ตรวจได้จริง
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, "..");

const F = require(join(FUNCTIONS, "hr-files.js"));
const CORE = require(join(FUNCTIONS, "hr-core.js"));

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
}

const b64 = (n) => Buffer.alloc(n, 7).toString("base64");
const pdf = (extra = {}) => ({
  kind: "id_card", filename: "a.pdf", contentType: "application/pdf",
  base64: b64(100), ...extra,
});

// ── 1. เช็คลิสต์ผูกกับประเภทการจ้าง ─────────────────────────────────────────
{
  const kinds = (rows) => Object.fromEntries(rows.map((r) => [r.kind, r]));

  const monthly = kinds(F.checklistFor({ employee: { employment_type: "monthly" }, files: [] }));
  check("ลูกจ้างรายเดือนต้องมี ล.ย.01", monthly.ly01.required === true);
  check("ลูกจ้างรายเดือนต้องมี สปส.1-03", monthly.sso_1_03.required === true);

  const freelance = kinds(F.checklistFor({ employee: { employment_type: "freelance" }, files: [] }));
  check("ฟรีแลนซ์ไม่ต้องมี ล.ย.01 (ไม่ได้หักภาษีแบบเงินเดือน)", freelance.ly01.required === false);
  check("ฟรีแลนซ์ไม่ต้องมี สปส.1-03 (ไม่ได้อยู่ ม.33)", freelance.sso_1_03.required === false);
  check("ฟรีแลนซ์ยังต้องมีสำเนาบัตร", freelance.id_card.required === true);
  check("ฟรีแลนซ์ยังต้องมีสัญญาที่เซ็นแล้ว", freelance.signed_contract.required === true);

  check(
    "ประเภทจ้างที่ไม่รู้จัก = ไม่บังคับเอกสารของสายเงินเดือน (ไม่เดา)",
    kinds(F.checklistFor({ employee: { employment_type: "อะไรสักอย่าง" }, files: [] })).ly01.required === false,
  );
}

// ── 2. ใบขับขี่ผูกกับการเป็นไรเดอร์ ─────────────────────────────────────────
{
  const of = (hasRider) => F.checklistFor({ employee: {}, files: [], hasRider })
    .find((r) => r.kind === "driver_license");
  check("ไม่ได้ผูกบัญชีไรเดอร์ = ไม่บังคับใบขับขี่", of(false).required === false);
  check("ผูกบัญชีไรเดอร์แล้ว = บังคับใบขับขี่", of(true).required === true);
}

// ── 3. photo_url เดิมนับว่ามีรูปแล้ว ───────────────────────────────────────
//
// ทะเบียนมีช่อง `photo_url` มาก่อนแฟ้มนี้ ถ้าเช็คลิสต์ไม่รู้จักมัน หน้าเว็บจะ
// รายงานว่า "ขาดรูปถ่าย" ให้คนที่มีรูปอยู่แล้ว
{
  const photoOf = (employee, files = []) => F.checklistFor({ employee, files })
    .find((r) => r.kind === "photo");
  check("มี photo_url อยู่แล้ว = นับว่ามีรูป", photoOf({ photo_url: "https://x/y.jpg" }).count === 1);
  check("ไม่มีทั้งไฟล์และ photo_url = นับเป็น 0", photoOf({}).count === 0);
  check(
    "photo_url ว่าง ไม่นับ",
    photoOf({ photo_url: "   " }).count === 0,
  );
}

// ── 4. missing = เฉพาะที่บังคับและยังไม่มี ─────────────────────────────────
{
  const missing = F.missingKinds({
    employee: { employment_type: "monthly" },
    files: [{ kind: "id_card" }, { kind: "education" }],
  });
  check("สิ่งที่มีแล้วไม่อยู่ในรายการขาด", !missing.includes("id_card"));
  check("เอกสารไม่บังคับที่ยังไม่มี ไม่นับว่าขาด", !missing.includes("photo"));
  check("สิ่งที่บังคับและยังไม่มี = ขาด", missing.includes("bank_book") && missing.includes("ly01"));

  const done = F.missingKinds({
    employee: { employment_type: "freelance" },
    files: ["id_card", "house_registration", "bank_book", "signed_contract"].map((kind) => ({ kind })),
  });
  check("ฟรีแลนซ์ครบสี่ใบ = ไม่ขาดอะไร", done.length === 0);
}

// ── 5. ตรวจไฟล์ขาเข้า ───────────────────────────────────────────────────────
{
  check("ไฟล์ปกติผ่าน", !F.validateUpload(pdf()).error);
  check("ชนิดเอกสารนอกลิสต์ = ปฏิเสธ", Boolean(F.validateUpload(pdf({ kind: "passport" })).error));
  check("ไม่ระบุชนิด = ปฏิเสธ", Boolean(F.validateUpload(pdf({ kind: "" })).error));
  check(
    "ชนิดที่มาจาก prototype ไม่นับว่ามีอยู่",
    Boolean(F.validateUpload(pdf({ kind: "constructor" })).error),
  );

  check("svg ถูกปฏิเสธ (ไม่ได้ใช้ image/.*)",
    Boolean(F.validateUpload(pdf({ contentType: "image/svg+xml" })).error));
  check("subtype ที่ประดิษฐ์เองถูกปฏิเสธ",
    Boolean(F.validateUpload(pdf({ contentType: "image/anything" })).error));
  check("jpeg ผ่าน", !F.validateUpload(pdf({ contentType: "image/jpeg", filename: "a.jpg" })).error);
  check("contentType ตัวใหญ่ยังผ่าน (normalize แล้ว)",
    !F.validateUpload(pdf({ contentType: "Application/PDF" })).error);

  check("ไฟล์ว่าง = ปฏิเสธ", Boolean(F.validateUpload(pdf({ base64: "" })).error));

  // **ขนาดต้องวัดจาก bytes ที่ decode แล้ว** — สตริง base64 ของไฟล์ที่ยังไม่ถึง
  // เพดานจะยาวกว่าเพดานราว 4/3 เท่า การเทียบความยาวสตริงจึงปฏิเสธไฟล์ที่ควรผ่าน
  const nearMax = F.MAX_FILE_BYTES - 1024;
  const okBig = F.validateUpload(pdf({ base64: b64(nearMax) }));
  check("ไฟล์เกือบเต็มเพดานยังผ่าน (วัดจาก bytes ไม่ใช่ความยาวสตริง)", !okBig.error);
  check("ขนาดที่รายงานคือ bytes จริง", okBig.size === nearMax);
  check("เกินเพดาน = ปฏิเสธ",
    Boolean(F.validateUpload(pdf({ base64: b64(F.MAX_FILE_BYTES + 1) })).error));

  // เพดานต้องอยู่ใต้ payload ของ callable (~10 MB) หลัง base64 พองแล้ว
  check("เพดานหลัง base64 ยังอยู่ใต้ 10 MB ของ callable",
    Math.ceil(F.MAX_FILE_BYTES * 4 / 3) < 9 * 1024 * 1024);
}

// ── 6. ชื่อไฟล์ ─────────────────────────────────────────────────────────────
{
  check("path separator ถูกล้างออกจากชื่อไฟล์",
    !F.safeFilename("../../etc/passwd", "pdf").includes("/"));
  check("backslash ก็ถูกล้าง",
    !F.safeFilename("..\\..\\windows\\x", "pdf").includes("\\"));
  check("ชื่อว่าง = ได้ชื่อกลางๆ", F.safeFilename("", "pdf") === "document.pdf");
  check("ชื่อที่มีนามสกุลอยู่แล้วไม่ถูกต่อซ้ำ",
    F.safeFilename("บัตร.pdf", "pdf") === "บัตร.pdf");
  check("ชื่อที่ไม่มีนามสกุลถูกเติมให้",
    F.safeFilename("บัตร", "pdf") === "บัตร.pdf");
  check("อักขระควบคุมถูกล้าง",
    F.safeFilename("a\u0000b\u001fc", "pdf") === "abc.pdf");
  check("ชื่อไทยที่มีช่องว่างยังอ่านได้ (ไม่ล้างเกินจำเป็น)",
    F.safeFilename("สำเนาบัตร สมชาย", "pdf") === "สำเนาบัตร สมชาย.pdf");
}

// ── 7. path ใน Storage ─────────────────────────────────────────────────────
{
  check("path ปกติถูกต้อง",
    F.fileStoragePath("EMP-1", "abc123", "pdf") === "employee_files/EMP-1/abc123.pdf");
  check("employeeId ที่มี ../ ไม่พา path ออกนอกโฟลเดอร์",
    F.fileStoragePath("../../secret", "abc", "pdf") === "employee_files/secret/abc.pdf");
  check("fileId ที่มี / ก็ถูกล้าง",
    F.fileStoragePath("EMP-1", "a/b", "pdf") === "employee_files/EMP-1/ab.pdf");
  check("อยู่ใต้ prefix employee_files/ เสมอ",
    F.fileStoragePath("EMP-1", "abc", "pdf").startsWith("employee_files/"));
  check("ค่าว่าง = คืน null ให้ตัวเรียกล้ม ไม่ใช่ได้ path เพี้ยน",
    F.fileStoragePath("", "abc", "pdf") === null);
}

// ── 8. catalogue ของ action ต้องตรงกับสิ่งที่โค้ดเขียนจริง ─────────────────
//
// `EMPLOYEE_EVENT_ACTIONS` ไม่ได้ถูกใช้เป็นด่านที่ไหน (ตรวจแล้ว: ไม่มีใคร
// import ไปเทียบ) มันคือ **สารบัญ** ว่าไทม์ไลน์มีเหตุการณ์อะไรได้บ้าง — และ
// สารบัญที่ไม่ตรงกับความจริงแย่กว่าไม่มีสารบัญ เทสนี้จึงอ่าน `action: "..."`
// ที่โค้ดเขียนจริงจากซอร์ส แล้วเทียบกับสารบัญ
{
  const sources = ["hr.js", "hr-files-api.js", "hr-recruitment-api.js"]
    .map((f) => readFileSync(join(FUNCTIONS, f), "utf8"))
    .join("\n")
    // ตัดคอมเมนต์ทิ้งก่อน — action ที่ถูกพูดถึงในคอมเมนต์ไม่ใช่ action ที่ถูกเขียน
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const written = new Set();
  for (const m of sources.matchAll(/action:\s*"([a-z_]+)"/g)) written.add(m[1]);

  check("มี action ที่โค้ดเขียนจริงให้ตรวจ (regex ยังจับได้)", written.size >= 5);
  const missing = [...written].filter((a) => !CORE.EMPLOYEE_EVENT_ACTIONS.includes(a));
  check(`ทุก action ที่โค้ดเขียนอยู่ในสารบัญ (ขาด: ${missing.join(", ") || "ไม่มี"})`,
    missing.length === 0);
  check("สารบัญรู้จักการเพิ่มเอกสาร", written.has("document_uploaded"));
  check("สารบัญรู้จักการลบเอกสาร", written.has("document_deleted"));
}

// ── 9. ป้ายของชนิดเอกสารมาจาก server ที่เดียว ──────────────────────────────
//
// หน้าเว็บ render จาก `checklist` ที่ callable ส่งมา **ห้ามมีตารางป้ายชุดที่สอง
// ฝั่ง UI** (กฎเดียวกับ `STATUS_COPY` ของหน้าตั้งค่าอีเมล) เทสนี้ตรึงว่าแถวที่
// ส่งออกไปมีป้ายติดมาด้วยจริง ไม่ใช่มีแต่ `kind` แล้วหวังให้ UI แปลเอง
{
  const rows = F.checklistFor({ employee: { employment_type: "monthly" }, files: [] });
  check("ทุกแถวมีป้ายภาษาไทยติดมาด้วย",
    rows.length > 0 && rows.every((r) => typeof r.label === "string" && r.label.length > 0));
  check("จำนวนแถวเท่ากับจำนวนชนิดทั้งหมด",
    rows.length === Object.keys(F.FILE_KINDS).length);
}

console.log("");
if (failures.length) {
  console.log(`FAILED ${failures.length}:`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log(`ALL PASS (${passed} passed)`);
