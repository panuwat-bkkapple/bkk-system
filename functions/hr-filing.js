// แถวสำหรับยื่นแบบ — ภ.ง.ด.1 และ สปส.1-10
//
// ─── ทำไมเป็น callable แยก ไม่ใช่ฟิลด์เพิ่มบนแถวรอบจ่าย ────────────────────
// แบบยื่นทั้งสองฉบับ **ผูกกับเลขประจำตัวประชาชน ไม่ใช่รหัสพนักงาน** — CSV ที่
// หน้ารอบจ่ายออกอยู่วันนี้จึงยื่นไม่ได้จริง ต้องเปิดแฟ้มลับหาเลข 13 หลักทีละคน
//
// แต่การเติมเลขบัตรลงแถวรอบจ่ายเลยแปลว่า **ทุกครั้งที่ใครเปิดหน้ารอบจ่าย
// เลขบัตรของทุกคนถูกส่งลงเบราว์เซอร์** ทั้งที่ 99% ของการเปิดหน้านั้นคือการ
// ดูยอดเงิน ไม่ใช่การยื่นแบบ — จึงแยกเป็น callable ของตัวเอง: PII ไหลตอนที่มี
// คนตั้งใจกดยื่นแบบเท่านั้น (หลักเดียวกับที่ `employees_private` แยกจาก
// `employees` มาตั้งแต่ต้น)
//
// ─── สิ่งที่ไฟล์นี้ *ไม่ได้* ทำ และเป็นการตัดสินใจ ────────────────────────
// **ไม่ได้ผลิตไฟล์ text สำหรับอัปโหลดเข้า e-Filing ของกรมสรรพากร/ปกส.**
// รูปแบบไฟล์นั้นเป็น layout เฉพาะ (ความกว้างคอลัมน์/ตัวคั่น/ลำดับฟิลด์) ที่
// ต้องตรงเป๊ะทุกไบต์ ระบบถึงจะรับ — และเราไม่มีสเปกฉบับจริงหรือไฟล์ตัวอย่าง
// มายืนยัน **การเดา layout แล้วติดป้ายว่า "พร้อมอัปโหลด" แย่กว่าการไม่มีไฟล์เลย**
// เพราะคนจะเอาไปอัปโหลดตอนใกล้ครบกำหนดยื่นแล้วเจอว่าถูกปฏิเสธ
// สิ่งที่ทำได้แน่ๆ และทำแล้วคือ: ออกตารางที่มี **ทุกช่องที่แบบต้องการ
// เรียงตามลำดับของแบบ** ให้คีย์หรือวางเข้าเทมเพลตได้โดยไม่ต้องไปหาข้อมูลที่อื่น
// ปิดงานนี้ให้จบต้องใช้ไฟล์ตัวอย่างหนึ่งใบจากบัญชี — ดู docs/hr-system-status.md

"use strict";

const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * ช่องของ ภ.ง.ด.1 (ใบแนบ) ตามลำดับของแบบ
 *
 * เงินได้ประเภท 1 = เงินเดือน ค่าจ้าง (มาตรา 40(1)) ซึ่งเป็นประเภทเดียวที่
 * รอบจ่ายนี้ผลิต — ฟรีแลนซ์/ไรเดอร์ถูกหัก 3% ตอนถอนและออก 50 ทวิ คนละใบ
 * (functions/rider-wht.js) **ห้ามเอามารวมในแบบเดียวกัน**
 */
const PND1_COLUMNS = [
  "ลำดับที่",
  "เลขประจำตัวประชาชน",
  "คำนำหน้าชื่อ",
  "ชื่อ",
  "นามสกุล",
  "ประเภทเงินได้",
  "จำนวนเงินที่จ่าย",
  "ภาษีที่หักและนำส่ง",
];

/** ช่องของ สปส.1-10 (ส่วนที่ 2) ตามลำดับของแบบ */
const SSO_COLUMNS = [
  "ลำดับที่",
  "เลขประจำตัวประชาชน",
  "คำนำหน้าชื่อ",
  "ชื่อ",
  "นามสกุล",
  "ค่าจ้าง",
  "เงินสมทบ",
];

const INCOME_TYPE_SALARY = "1";

/**
 * เลขบัตรใช้ยื่นได้ไหม
 *
 * ตรวจแค่รูป (13 หลัก) **ไม่ตรวจ checksum ที่นี่** — `isThaiNationalId` ใน
 * hr-core ทำตอนบันทึกไปแล้ว ถ้าเลขในฐานผิด checksum แปลว่ามันผ่านมาทางอื่น
 * ซึ่งเป็นปัญหาของแถวนั้น ไม่ใช่ของการยื่น และการปฏิเสธซ้ำที่นี่จะทำให้คน
 * หายไปจากแบบโดยที่หน้าจอไม่เคยบอกว่าทำไม
 */
function usableNationalId(raw) {
  const digits = str(raw, 30).replace(/\D/g, "");
  return digits.length === 13 ? digits : null;
}

/**
 * แถวหนึ่งคน — คืน `null` เมื่อยื่นแทนคนนี้ไม่ได้
 *
 * **คนที่ยื่นไม่ได้ต้องถูกรายงาน ไม่ใช่ถูกข้ามเงียบ** — แบบที่ขาดคนไปหนึ่งคน
 * ยังส่งได้และดูปกติทุกอย่าง กว่าจะรู้คือตอนลูกจ้างไปเช็คสิทธิ์แล้วไม่มีชื่อ
 */
function filingRowFor({ employee, priv }) {
  const emp = employee || {};
  const p = priv || {};
  const id = usableNationalId(p.national_id);
  const first = str(emp.first_name, 60);
  const last = str(emp.last_name, 60);
  const blockers = [];
  if (!id) blockers.push("ไม่มีเลขประจำตัวประชาชน");
  // แบบยื่นมีช่องชื่อกับนามสกุลแยกกัน — `name` ก้อนเดียวเติมลงแบบไม่ได้
  if (!first || !last) blockers.push("ยังไม่ได้แยกชื่อ-นามสกุล");
  return {
    national_id: id,
    title: str(emp.title, 40),
    first_name: first,
    last_name: last,
    blockers,
  };
}

/**
 * สร้างตารางยื่นแบบจากรายการในรอบจ่าย
 *
 * `kind` = `"pnd1"` หรือ `"sso"` · คืนทั้งแถวที่ยื่นได้และรายชื่อที่ยื่นไม่ได้
 * พร้อมเหตุผล **ยอดรวมคิดจากแถวที่ยื่นได้เท่านั้น** เพราะยอดในหัวแบบต้องตรง
 * กับผลรวมของบรรทัดที่อยู่ในแบบจริง ไม่ใช่กับยอดในระบบเรา
 */
function buildFilingTable({ kind, items, employees, privates }) {
  const empMap = employees || {};
  const privMap = privates || {};
  const rows = [];
  const excluded = [];
  let n = 0;

  for (const item of Array.isArray(items) ? items : []) {
    const employeeId = item && item.employee_id;
    if (!employeeId) continue;
    // ฟรีแลนซ์ไม่เข้ารอบเงินเดือนอยู่แล้ว (`skipped: "freelance"`) แต่กันไว้อีกชั้น
    if (item.skipped) continue;

    const employee = empMap[employeeId] || {};
    const priv = privMap[employeeId] || {};
    const wage = kind === "sso" ? round2(item.sso_wage) : round2(item.taxable_income);
    const amount = kind === "sso" ? round2(item.sso_employee) : round2(item.wht);

    // สปส.1-10 ยื่นเฉพาะคนที่อยู่ในระบบประกันสังคมของรอบนั้น — ค่าจ้างที่ใช้
    // คำนวณเป็น 0 แปลว่าเขาไม่ได้อยู่ในระบบ ไม่ใช่ว่าเขาสมทบศูนย์บาท
    if (kind === "sso" && wage <= 0) continue;

    const f = filingRowFor({ employee, priv });
    if (f.blockers.length) {
      excluded.push({
        employee_id: employeeId,
        employee_code: employee.employee_code || null,
        reasons: f.blockers,
      });
      continue;
    }

    n += 1;
    rows.push(
      kind === "sso"
        ? [n, f.national_id, f.title, f.first_name, f.last_name, wage, amount]
        : [n, f.national_id, f.title, f.first_name, f.last_name, INCOME_TYPE_SALARY, wage, amount]
    );
  }

  const wageIdx = kind === "sso" ? 5 : 6;
  const amountIdx = kind === "sso" ? 6 : 7;
  return {
    columns: kind === "sso" ? SSO_COLUMNS : PND1_COLUMNS,
    rows,
    excluded,
    totals: {
      count: rows.length,
      wage: round2(rows.reduce((s, r) => s + Number(r[wageIdx] || 0), 0)),
      amount: round2(rows.reduce((s, r) => s + Number(r[amountIdx] || 0), 0)),
    },
  };
}

module.exports = {
  PND1_COLUMNS,
  SSO_COLUMNS,
  INCOME_TYPE_SALARY,
  usableNationalId,
  filingRowFor,
  buildFilingTable,
};
