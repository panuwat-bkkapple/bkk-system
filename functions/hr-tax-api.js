// =============================================================================
// เอกสารภาษีรายปีของพนักงาน — 50 ทวิ + ภ.ง.ด.1ก (callable)
//
// ตัวรวมยอดอยู่ที่ `hr-tax-year.js` (pure มี unit test) ไฟล์นี้ทำแค่ 3 อย่าง:
// โหลดข้อมูล · จองเลขที่เอกสาร · ประกอบ PDF
//
// **เลขที่ 50 ทวิ จองครั้งเดียวต่อ (ปีภาษี, พนักงาน) แล้วใช้ซ้ำตลอด** —
// ทะเบียนอยู่ที่ `wht_employee_certificates/{ปีพ.ศ.}_{employeeId}` การกด
// ดาวน์โหลดรอบที่สองต้องได้เลขเดิม ไม่ใช่เลขใหม่ (เอกสารสองใบเลขต่างกันสำหรับ
// เงินได้ก้อนเดียวคือของที่อธิบายตอนถูกตรวจไม่ได้) ฉบับที่ออกซ้ำจะพิมพ์กำกับ
// ไว้บนเอกสารว่าเป็นการออกซ้ำจากเลขเดิม
//
// **ปีที่ยังมีรอบค้างจ่าย = พรีวิว ไม่จองเลข** — ตัวเลขยังขยับได้ การเผาเลข
// ให้กับเอกสารที่ยังไม่นิ่งแปลว่าลำดับเลขจะมีช่องว่างที่ไม่มีใครอธิบายได้
// เอกสารพรีวิวติดป้ายไว้บนหน้ากระดาษเองด้วย ไม่ใช่แค่ในชื่อไฟล์
//
// **ไม่เก็บ PDF ลง Storage** เหมือนสลิป — รอบที่จ่ายแล้วถูก freeze ไว้เป็นตัวจริง
// อยู่แล้ว สร้างสดทุกครั้งจึงตรงเสมอ และไม่มี capability URL ของเอกสารเงินเดือน
// ลอยอยู่ให้ใครถือก็เปิดได้
//
// `wht_employee_certificates` ไม่มี rule เป็นของตัวเอง = ตกกฎ root
// `.read/.write: false` — client อ่านไม่ได้ Admin SDK เขียนได้ หน้าเว็บอ่าน
// ผ่าน callable นี้ที่ gate ด้วย role เท่านั้น **ไม่ต้อง deploy rules**
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES } = require("./hr-core");
const { aggregateTaxYear, taxYearOfRun } = require("./hr-tax-year");
const { buildEmployeeWhtCertificatePdf } = require("./voucher-pdf");

const REGION = "asia-southeast1";

function parseYear(data) {
  const y = Math.round(Number((data || {}).year));
  if (!Number.isFinite(y) || y < 2500 || y > 2700) {
    throw new HttpsError("invalid-argument", "ปีต้องเป็นพุทธศักราช เช่น 2569");
  }
  return { buddhist: y, gregorian: y - 543 };
}

/**
 * โหลดรอบทั้งหมดของปีภาษีหนึ่ง พร้อมบรรทัดของแต่ละรอบ
 *
 * `payroll_runs` เป็นโหนดเล็ก (ใบเดียวต่อเดือน) จึงอ่านทั้งก้อนได้ ส่วน
 * `payroll_items` อ่านเฉพาะงวดที่อยู่ในปีนั้น ไม่กวาดทั้งโหนด (กฎค่า RTDB)
 */
async function loadYear(db, gregorianYear) {
  const runsSnap = await db.ref("payroll_runs").once("value");
  const runs = Object.entries(runsSnap.val() || {})
    .map(([id, r]) => ({ id, ...(r || {}) }))
    .filter((r) => taxYearOfRun(r) === gregorianYear);

  const itemsByRun = {};
  await Promise.all(runs.map(async (r) => {
    const snap = await db.ref(`payroll_items/${r.id}`).once("value");
    itemsByRun[r.id] = snap.val() || {};
  }));
  return { runs, itemsByRun };
}

function registerHrTax() {
  // -------------------------------------------------------------------------
  // adminHrTaxYearSummary — ตาราง ภ.ง.ด.1ก ของทั้งปี
  // -------------------------------------------------------------------------
  const adminHrTaxYearSummary = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const year = parseYear(request.data);

    const { runs, itemsByRun } = await loadYear(db, year.gregorian);
    const summary = aggregateTaxYear({ year: year.gregorian, runs, itemsByRun });

    // เลขที่ที่เคยออกไปแล้ว — ให้หน้าจอบอกได้ว่าใครได้ใบไปแล้วบ้าง
    const certSnap = await db.ref("wht_employee_certificates").once("value");
    const issued = {};
    for (const [k, v] of Object.entries(certSnap.val() || {})) {
      if (!v || Number(v.buddhist_year) !== year.buddhist) continue;
      issued[v.employee_id] = { number: v.number, issued_at: v.issued_at || null };
    }

    console.log(`[hr-tax] summary ${year.buddhist} headcount=${summary.totals.headcount} pending=${summary.runs_pending.length}`);
    return { ...summary, issued };
  });

  // -------------------------------------------------------------------------
  // adminHrWhtCertificate — 50 ทวิ ของพนักงานหนึ่งคนในปีหนึ่ง
  // -------------------------------------------------------------------------
  const adminHrWhtCertificate = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const year = parseYear(request.data);
    const employeeId = String((request.data || {}).employeeId || "");
    if (!employeeId) throw new HttpsError("invalid-argument", "ต้องระบุพนักงาน");

    const { runs, itemsByRun } = await loadYear(db, year.gregorian);
    const summary = aggregateTaxYear({ year: year.gregorian, runs, itemsByRun });
    const row = summary.rows.find((r) => r.employee_id === employeeId);
    if (!row) {
      throw new HttpsError("not-found", "ไม่พบเงินได้ที่จ่ายจริงให้พนักงานคนนี้ในปีภาษีนี้");
    }

    const [empSnap, privSnap, acctSnap] = await Promise.all([
      db.ref(`employees/${employeeId}`).once("value"),
      db.ref(`employees_private/${employeeId}`).once("value"),
      db.ref("settings/accounting/company").once("value"),
    ]);

    const preview = summary.runs_pending.length > 0;
    const regRef = db.ref(`wht_employee_certificates/${year.buddhist}_${employeeId}`);
    const existing = (await regRef.once("value")).val();

    let number = existing ? existing.number : null;
    let reissued = Boolean(existing);
    if (!number && !preview) {
      number = await allocateEmployeeWhtNumber(db, year.buddhist);
      reissued = false;
    }

    const cert = {
      number: number || "(ยังไม่ออกเลขที่ — ฉบับพรีวิว)",
      buddhist_year: year.buddhist,
      name: row.name,
      employee_code: row.employee_code,
      gross: row.gross,
      wht: row.wht,
      sso_employee: row.sso_employee,
      periods: row.periods,
      first_pay_date: row.first_pay_date,
      last_pay_date: row.last_pay_date,
      draft: preview,
      reissued,
    };

    const pdf = await buildEmployeeWhtCertificatePdf({
      employee: empSnap.val() || {},
      priv: privSnap.val() || {},
      cert,
      company: acctSnap.val() || {},
    });

    // ลงทะเบียนหลังสร้างเอกสารสำเร็จเท่านั้น — เลขที่ถูกจองไปแล้วแต่ไม่มีใบ
    // คือช่องว่างในลำดับ ส่วนเลขที่ยังไม่ถูกจองก็แค่ลองใหม่ได้
    if (number && !existing) {
      await regRef.set({
        number,
        employee_id: employeeId,
        employee_code: row.employee_code || null,
        name: row.name || null,
        buddhist_year: year.buddhist,
        gross: row.gross,
        wht: row.wht,
        sso_employee: row.sso_employee,
        periods: row.periods,
        run_ids: row.run_ids,
        issued_at: Date.now(),
      });
    }

    const tag = preview ? "-พรีวิว" : "";
    console.log(`[hr-tax] wht-cert ${year.buddhist}/${employeeId} number=${number || "preview"} bytes=${pdf.length}`);
    return {
      filename: `wht50tavi-${year.buddhist}-${row.employee_code || employeeId}${tag}.pdf`,
      base64: pdf.toString("base64"),
      preview,
      reissued,
      number,
    };
  });

  return { adminHrTaxYearSummary, adminHrWhtCertificate };
}

/**
 * จองเลขหนังสือรับรองของลูกจ้าง — `WHTE-{ปีพ.ศ.}-####` รีเซ็ตรายปี
 *
 * **ตัวนับแยกจากของไรเดอร์โดยตั้งใจ** (`wht_seq_by_period` เป็นรายเดือนตามงวด
 * ภ.ง.ด.3) — คนละแบบยื่น คนละรอบ ใช้ตัวนับร่วมกันแปลว่าลำดับของทั้งสองแบบ
 * มีช่องว่างสลับกันไปมาโดยไม่มีเหตุผลที่อธิบายได้
 */
async function allocateEmployeeWhtNumber(db, buddhistYear) {
  const ref = db.ref(`settings/accounting/wht_employee_seq_by_year/${buddhistYear}`);
  const txn = await ref.transaction((cur) => (cur || 0) + 1);
  const seq = txn.snapshot.val() || 1;
  return `WHTE-${buddhistYear}-${String(seq).padStart(4, "0")}`;
}

module.exports = { registerHrTax, allocateEmployeeWhtNumber };
