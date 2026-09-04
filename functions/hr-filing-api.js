// =============================================================================
// ตารางยื่นแบบ ภ.ง.ด.1 / สปส.1-10 — callable
//
// กติกาทั้งหมดอยู่ `hr-filing.js` (ล้วน มีเทส) ไฟล์นี้ต่อสายกับ Firebase เท่านั้น
//
// **แยกจาก `adminHrPayrollGet` เพราะ PII** — แถวยื่นแบบมีเลขประจำตัวประชาชน
// ของทุกคน ส่วนหน้ารอบจ่ายถูกเปิดเพื่อดูยอดเงินเป็นหลัก การเติมเลขบัตรลงแถว
// รอบจ่ายแปลว่าเลขบัตรของทุกคนถูกส่งลงเบราว์เซอร์ทุกครั้งที่ใครเปิดหน้านั้น
// ทั้งที่แทบไม่มีครั้งไหนต้องใช้ — callable นี้จึงไหล PII เฉพาะตอนมีคนตั้งใจ
// กดออกไฟล์ยื่นแบบ
//
// **สิทธิ์แคบกว่า HR_ROLES โดยตั้งใจ** — เป็นการดึงเลขบัตรทั้งบริษัทออกมาใน
// คราวเดียว ซึ่งเป็นการกระทำระดับที่คนดูแลภาษีทำ ไม่ใช่ระดับงานประจำวันของ HR
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { buildFilingTable } = require("./hr-filing");

const REGION = "asia-southeast1";
const str = (v, max = 60) => String(v == null ? "" : v).trim().slice(0, max);

/** คนที่ดึงเลขบัตรทั้งบริษัทออกมาได้ */
const FILING_ROLES = ["CEO", "FINANCE"];

const KINDS = ["pnd1", "sso"];

function registerHrFiling() {
  // -------------------------------------------------------------------------
  // adminHrFilingRows — แถวยื่นแบบของรอบจ่ายหนึ่งรอบ
  // -------------------------------------------------------------------------
  const adminHrFilingRows = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, FILING_ROLES);

    const d = request.data || {};
    const period = str(d.period, 20);
    const kind = str(d.kind, 10);
    if (!period) throw new HttpsError("invalid-argument", "ต้องระบุรอบจ่าย");
    if (!KINDS.includes(kind)) throw new HttpsError("invalid-argument", "ชนิดแบบไม่ถูกต้อง");

    const runSnap = await db.ref(`payroll_runs/${period}`).once("value");
    if (!runSnap.exists()) throw new HttpsError("not-found", "ไม่พบรอบจ่ายนี้");
    const run = runSnap.val() || {};

    const itemsSnap = await db.ref(`payroll_items/${period}`).once("value");
    const items = [];
    itemsSnap.forEach((c) => { items.push({ id: c.key, ...c.val() }); return false; });

    // อ่านเฉพาะคนที่อยู่ในรอบนี้ **ไม่กวาด `employees_private` ทั้งโหนด**
    // (กฎค่า RTDB — และเลขบัตรของคนที่ไม่เกี่ยวกับรอบนี้ไม่ควรถูกอ่านด้วยซ้ำ)
    const ids = [...new Set(items.map((i) => i.employee_id).filter(Boolean))].slice(0, 500);
    const employees = {};
    const privates = {};
    await Promise.all(ids.map(async (id) => {
      const [e, p] = await Promise.all([
        db.ref(`employees/${id}`).once("value"),
        db.ref(`employees_private/${id}`).once("value"),
      ]);
      if (e.exists()) employees[id] = e.val();
      if (p.exists()) privates[id] = p.val();
    }));

    const table = buildFilingTable({ kind, items, employees, privates });
    return {
      period,
      kind,
      run_status: run.status || null,
      ...table,
    };
  });

  return { adminHrFilingRows };
}

module.exports = { registerHrFiling, FILING_ROLES };
