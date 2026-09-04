// =============================================================================
// แถวสำหรับยื่นแบบ ภ.ง.ด.1 / สปส.1-10
//   node functions/test/hr-filing.test.mjs
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                                  | ผล |
//   |------------------------------------------------------------|----|
//   | คนที่ยื่นไม่ได้ถูกข้ามเงียบ (ไม่เข้า `excluded`)              | แดง 4 |
//   | สปส. ยื่นคนที่ค่าจ้างฐานเป็น 0 ด้วย                            | แดง 1 |
//   | ยอมรับเลขบัตรที่ไม่ครบ 13 หลัก                                | แดง 2 |
//   | ชื่อก้อนเดียว (ไม่แยกนามสกุล) ผ่านได้                          | แดง 2 |
//   | `ลำดับที่` กระโดดตามคนที่ถูกตัดออก                             | แดง 2 |
//   | ภ.ง.ด.1 ใช้ `sso_wage` แทน `taxable_income`                  | แดง 2 |
//   | ฟรีแลนซ์หลุดเข้าแบบเดียวกับพนักงานเงินเดือน                    | แดง 1 |
//   | ยอดรวมคิดจากทุกแถว ไม่ใช่เฉพาะแถวที่อยู่ในแบบ                  | แดง 1 |
//
// **ข้อที่ไม่มีอะไรจับได้ และบันทึกไว้ตรงๆ:** ลำดับของคอลัมน์ใน
// `PND1_COLUMNS`/`SSO_COLUMNS` — สลับสองช่องแล้วมีแต่เทสที่อ้างลิสต์นั้นเองที่
// แดง เพราะแถวข้อมูลถูกประกอบแยกจากหัวตาราง **นี่คือกฎขอบเขต ไม่ใช่ด่าน**:
// สิ่งที่ยืนยันว่าหัวตารางตรงกับแบบจริงได้มีอย่างเดียวคือเอาแบบมากาง ซึ่ง
// เทสทำแทนไม่ได้ จึงตรึงแค่ว่า **จำนวนช่องของหัวตารางต้องเท่ากับของแถว**
// (ถ้าเพิ่มช่องแล้วลืมเพิ่มอีกฝั่ง ตารางจะเหลื่อมทั้งใบ ซึ่งจับได้จริง)
// =============================================================================

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const F = require(join(HERE, "..", "hr-filing.js"));

let passed = 0;
const failures = [];
// deref ของแถว/รายการที่อาจว่างต้องกันไว้ทุกจุด — injection ที่ทำให้ลิสต์ว่าง
// ต้องออกมาเป็น **แดง** ที่อ่านจำนวนได้ ไม่ใช่ **crash** ที่หยุดไฟล์ไว้กลางทาง
// แล้วซ่อนว่าข้ออื่นแดงอีกกี่ข้อ (เจอตอนรัน injection รอบแรกของไฟล์นี้)
const check = (name, cond) => {
  if (cond) { passed += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}`); }
};

const EMP = {
  e1: { employee_code: "EMP-2569-0001", title: "นาย", first_name: "สมชาย", last_name: "ใจดี" },
  e2: { employee_code: "EMP-2569-0002", title: "นางสาว", first_name: "กชวรรณ", last_name: "วาสนโกมุท" },
};
const PRIV = {
  e1: { national_id: "1234567890121" },
  e2: { national_id: "9876543210987" },
};
const item = (id, over = {}) => ({
  employee_id: id, taxable_income: 30000, wht: 500,
  sso_wage: 15000, sso_employee: 750, ...over,
});

// ── 1. ภ.ง.ด.1: ช่องครบและใช้ฐานที่ถูก ────────────────────────────────────
{
  const t = F.buildFilingTable({ kind: "pnd1", items: [item("e1")], employees: EMP, privates: PRIV });
  check("มีแถวเดียว", t.rows.length === 1);
  check("จำนวนช่องของแถวเท่ากับหัวตาราง", (t.rows[0] || []).length === t.columns.length);
  const [seq, nid, title, first, last, kind, wage, tax] = t.rows[0] || [];
  check("ลำดับเริ่มที่ 1", seq === 1);
  check("เลขบัตร 13 หลัก", nid === "1234567890121");
  check("คำนำหน้า/ชื่อ/นามสกุลแยกช่อง", title === "นาย" && first === "สมชาย" && last === "ใจดี");
  check("ประเภทเงินได้ = 1 (เงินเดือน ม.40(1))", kind === "1");
  // **ภ.ง.ด.1 ใช้เงินได้ที่ต้องเสียภาษี ไม่ใช่ค่าจ้างฐานประกันสังคม**
  // สองตัวนี้ต่างกันจริง (ฐาน ปกส. มีเพดาน 17,500) เอาสลับกันคือยื่นเงินได้ผิด
  check("ใช้ taxable_income ไม่ใช่ sso_wage", wage === 30000);
  check("ภาษีที่นำส่ง = wht", tax === 500);
}

// ── 2. สปส.1-10: ใช้ฐานประกันสังคม ────────────────────────────────────────
{
  const t = F.buildFilingTable({ kind: "sso", items: [item("e1")], employees: EMP, privates: PRIV });
  check("สปส. จำนวนช่องตรงกับหัวตาราง", (t.rows[0] || []).length === t.columns.length);
  check("สปส. ใช้ sso_wage", (t.rows[0] || [])[5] === 15000);
  check("สปส. ใช้ sso_employee เป็นเงินสมทบ", (t.rows[0] || [])[6] === 750);
  check("สปส. ไม่มีช่องประเภทเงินได้", !t.columns.includes("ประเภทเงินได้"));
}

// ── 3. คนที่ยื่นไม่ได้ต้องถูกรายงาน ไม่ใช่ถูกข้ามเงียบ ──────────────────────
//
// แบบที่ขาดคนไปหนึ่งคนยังส่งได้และดูปกติทุกอย่าง กว่าจะรู้คือตอนลูกจ้างไป
// เช็คสิทธิ์แล้วไม่มีชื่อตัวเอง
{
  const noId = F.buildFilingTable({
    kind: "pnd1", items: [item("e1"), item("e2")],
    employees: EMP, privates: { e1: PRIV.e1, e2: {} },
  });
  check("คนที่ไม่มีเลขบัตรไม่อยู่ในแถว", noId.rows.length === 1);
  check("แต่ถูกรายงานว่าทำไมยื่นไม่ได้", noId.excluded.length === 1);
  check("รายงานบอกรหัสพนักงานให้ไปตามได้", noId.excluded[0]?.employee_code === "EMP-2569-0002");
  check("เหตุผลชี้ที่เลขบัตร", (noId.excluded[0]?.reasons || []).some((r) => r.includes("เลขประจำตัวประชาชน")));

  const oneName = F.buildFilingTable({
    kind: "pnd1", items: [item("e2")],
    employees: { e2: { employee_code: "EMP-2569-0002", first_name: "กชวรรณ" } },
    privates: PRIV,
  });
  check("ชื่อที่ยังไม่แยกนามสกุลยื่นไม่ได้", oneName.rows.length === 0);
  check("และถูกรายงานว่าเพราะยังไม่แยกชื่อ", (oneName.excluded[0]?.reasons || []).some((r) => r.includes("แยกชื่อ")));
}

// ── 4. ยอดรวมต้องเป็นของแถวที่อยู่ในแบบจริง ────────────────────────────────
//
// ยอดในหัวแบบต้องตรงกับผลรวมของบรรทัดที่ส่งไป ไม่ใช่กับยอดในระบบเรา
{
  const t = F.buildFilingTable({
    kind: "pnd1", items: [item("e1"), item("e2", { wht: 900, taxable_income: 40000 })],
    employees: EMP, privates: { e1: PRIV.e1, e2: {} },
  });
  check("ยอดรวมไม่รวมคนที่ยื่นไม่ได้", t.totals.amount === 500 && t.totals.wage === 30000);
  check("จำนวนคนตรงกับจำนวนแถว", t.totals.count === t.rows.length);
}

// ── 5. ลำดับที่ต้องเดินตามแถวที่อยู่ในแบบ ──────────────────────────────────
{
  const t = F.buildFilingTable({
    kind: "pnd1", items: [item("e1", { employee_id: "e0" }), item("e1"), item("e2")],
    employees: EMP, privates: PRIV,
  });
  // แถวแรก (e0) ยื่นไม่ได้เพราะไม่มีข้อมูลพนักงาน — ลำดับต้องยังเป็น 1, 2
  check("ลำดับไม่กระโดดตามคนที่ถูกตัดออก", t.rows.map((r) => r[0]).join(",") === "1,2");
}

// ── 6. สปส. ยื่นเฉพาะคนที่อยู่ในระบบประกันสังคมของรอบนั้น ──────────────────
//
// ค่าจ้างฐาน 0 แปลว่าเขาไม่ได้อยู่ในระบบ ไม่ใช่ว่าเขาสมทบศูนย์บาท
{
  const t = F.buildFilingTable({
    kind: "sso", items: [item("e1"), item("e2", { sso_wage: 0, sso_employee: 0 })],
    employees: EMP, privates: PRIV,
  });
  check("คนที่ค่าจ้างฐาน ปกส. เป็น 0 ไม่เข้าแบบ", t.rows.length === 1);
  check("และไม่ถูกรายงานว่าเป็นคนที่ยื่นไม่ได้", t.excluded.length === 0);

  // แต่ ภ.ง.ด.1 ของคนเดียวกันยังต้องยื่น (เขามีเงินได้ แค่ไม่อยู่ในระบบ ปกส.)
  const p = F.buildFilingTable({
    kind: "pnd1", items: [item("e2", { sso_wage: 0, sso_employee: 0 })],
    employees: EMP, privates: PRIV,
  });
  check("ภ.ง.ด.1 ของคนเดียวกันยังยื่น", p.rows.length === 1);
}

// ── 7. เลขบัตร ────────────────────────────────────────────────────────────
{
  check("13 หลักผ่าน", F.usableNationalId("1234567890121") === "1234567890121");
  check("มีขีดคั่นยังผ่าน (ตัดออกให้)", F.usableNationalId("1-2345-67890-12-1") === "1234567890121");
  check("ไม่ครบ 13 หลักไม่ผ่าน", F.usableNationalId("12345") === null);
  check("เกิน 13 หลักไม่ผ่าน", F.usableNationalId("12345678901234") === null);
  check("ค่าว่างไม่ผ่าน", F.usableNationalId(null) === null && F.usableNationalId("") === null);
}

// ── 8. ฟรีแลนซ์ต้องไม่หลุดเข้าแบบเดียวกับพนักงานเงินเดือน ───────────────────
//
// ไรเดอร์ถูกหัก 3% ตอนถอนและออก 50 ทวิ คนละใบ (functions/rider-wht.js)
// เอามารวมในแบบเดียวกันคือยื่นซ้ำ
{
  const t = F.buildFilingTable({
    kind: "pnd1", items: [item("e1", { skipped: "freelance" }), item("e2")],
    employees: EMP, privates: PRIV,
  });
  check("แถวที่ถูก skip ไม่เข้าแบบ", t.rows.length === 1 && (t.rows[0] || [])[3] === "กชวรรณ");
  check("และไม่ถูกรายงานว่ายื่นไม่ได้", t.excluded.length === 0);
}

// ── 9. ขอบเขต: หัวตารางกับแถวต้องมีจำนวนช่องเท่ากันเสมอ ────────────────────
{
  check("ภ.ง.ด.1 หัวตาราง 8 ช่อง", F.PND1_COLUMNS.length === 8);
  check("สปส. หัวตาราง 7 ช่อง", F.SSO_COLUMNS.length === 7);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
