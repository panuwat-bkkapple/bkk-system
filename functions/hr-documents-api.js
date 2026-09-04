// =============================================================================
// เอกสารบุคคล — callable (ออก · พิมพ์ซ้ำ · ยกเลิก)
//
// **เอกสารถูก "ออก" ครั้งเดียว แล้วพิมพ์ซ้ำได้เท่าที่ต้องการ โดยได้ฉบับเดิมเป๊ะ**
// เลขที่ วันที่ และเงื่อนไขทั้งชุดถูก freeze ลงทะเบียน `hr_documents/{id}` ตอน
// ออก การพิมพ์ซ้ำสร้าง PDF ใหม่จากค่าที่ freeze ไว้ ไม่ใช่จาก settings วันนี้ —
// สัญญาที่เซ็นไปแล้วต้องอธิบายตัวเองได้แม้เงื่อนไขมาตรฐานจะถูกแก้พรุ่งนี้
// (รูปเดียวกับ payroll_runs.config และใบกำกับภาษี)
//
// **ไม่เก็บไฟล์ลง Storage** เหมือนสลิปกับ 50 ทวิ — เอกสารเหล่านี้มีเงินเดือน
// เลขบัตรประชาชน และเรื่องทางวินัยอยู่ในนั้น capability URL ที่ใครถือก็เปิดได้
// เป็นสิ่งที่ไม่ควรมีสำหรับเอกสารกลุ่มนี้ ทะเบียนเก็บ "ออกอะไรไปแล้วบ้าง"
// ส่วนตัวไฟล์สร้างสดทุกครั้ง
//
// `hr_documents` ไม่มี rule ของตัวเอง = ตกกฎ root `.read/.write: false` client
// อ่าน/เขียนไม่ได้ ต้องผ่าน callable ที่ gate ด้วย role **ไม่ต้อง deploy rules**
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, employeeActorFields, bangkokBuddhistYear } = require("./hr-core");
const {
  DOC_TYPES, resolveContractTerms, probationEnd, warningExpiry, activeWarnings,
  missingFor, payLine, formatDocNumber, workScheduleCheck,
} = require("./hr-documents");
const { buildEmploymentContractPdf, buildHrLetterPdf } = require("./voucher-pdf");

const REGION = "asia-southeast1";
const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);

/** เลขที่เอกสาร — ตัวนับแยกต่อชนิดต่อปี ลำดับของสัญญากับหนังสือเตือนไม่ปนกัน */
async function allocateDocNumber(db, type, buddhistYear) {
  const ref = db.ref(`settings/accounting/hr_doc_seq/${type}_${buddhistYear}`);
  const res = await ref.transaction((cur) => (Number(cur) || 0) + 1);
  if (!res.committed) throw new HttpsError("aborted", "จองเลขที่เอกสารไม่สำเร็จ ลองใหม่อีกครั้ง");
  return formatDocNumber(DOC_TYPES[type].prefix, buddhistYear, res.snapshot.val());
}

async function loadPerson(db, employeeId) {
  const [empSnap, privSnap, setSnap, acctSnap] = await Promise.all([
    db.ref(`employees/${employeeId}`).once("value"),
    db.ref(`employees_private/${employeeId}`).once("value"),
    db.ref("settings/hr").once("value"),
    db.ref("settings/accounting/company").once("value"),
  ]);
  if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");
  return {
    employee: { id: employeeId, ...empSnap.val() },
    priv: privSnap.val() || {},
    settings: setSnap.val() || {},
    company: acctSnap.val() || {},
  };
}

async function renderDoc({ type, employee, priv, doc, company }) {
  if (type === "contract") {
    return buildEmploymentContractPdf({ employee, priv, doc, company });
  }
  return buildHrLetterPdf({ type, employee, priv, doc, company });
}

function registerHrDocuments() {
  // -------------------------------------------------------------------------
  // adminHrDocumentList — เอกสารที่เคยออกให้คนนี้
  // -------------------------------------------------------------------------
  const adminHrDocumentList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const employeeId = str((request.data || {}).employeeId, 60);
    if (!employeeId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุพนักงาน");

    // **เก็บซ้อนใต้ employeeId โดยตั้งใจ ไม่ได้แบนแล้ว query ด้วย index** —
    // การ query `orderByChild("employee_id")` ต้องมี `.indexOn` ซึ่งอยู่ใน
    // `database.rules.json` ของ bkk-frontend-next (คนละรีโป ต้อง deploy แยก)
    // ถ้าไม่มี index RTDB จะดาวน์โหลดทั้งโหนดมากรองเอง = ผิดกฎค่า RTDB เงียบๆ
    // โครงซ้อนอ่านของคนเดียวเป็นการอ่าน subtree เล็กๆ ตรงๆ ไม่ต้องมี index เลย
    const snap = await db.ref(`hr_documents/${employeeId}`).once("value");
    const docs = [];
    snap.forEach((c) => { docs.push({ id: c.key, ...c.val() }); return false; });
    docs.sort((a, b) => (b.issued_at || 0) - (a.issued_at || 0));

    const { employee, priv, settings } = await loadPerson(db, employeeId);
    const terms = resolveContractTerms(settings);
    const now = Date.now();

    return {
      documents: docs,
      // หนังสือเตือนที่ยังมีผล — ตัวเลขที่ต้องรู้ก่อนออกใบถัดไป ใบที่หมดอายุแล้ว
      // ใช้อ้างอิงตอนพิจารณาโทษไม่ได้ การนับรวมจะทำให้เข้าใจผิดว่ามีประวัติมากกว่าจริง
      active_warnings: activeWarnings(docs, now).length,
      terms,
      probation_end: probationEnd(employee.hired_at, terms.probation_days),
      // ออกอะไรได้บ้าง + ขาดอะไร — หน้าเว็บบอกก่อนกด ไม่ใช่ให้กดแล้วค่อยรู้
      availability: Object.fromEntries(Object.keys(DOC_TYPES).map((t) => [
        t, { label: DOC_TYPES[t].label, missing: missingFor(t, { employee, priv }) },
      ])),
    };
  });

  // -------------------------------------------------------------------------
  // adminHrDocumentIssue — ออกเอกสารใหม่ (freeze เงื่อนไข + จองเลขที่)
  // -------------------------------------------------------------------------
  const adminHrDocumentIssue = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const type = str(data.type, 40);
    const employeeId = str(data.employeeId, 60);
    if (!DOC_TYPES[type]) throw new HttpsError("invalid-argument", "ไม่รู้จักชนิดเอกสารนี้");
    if (!employeeId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุพนักงาน");

    const { employee, priv, settings, company } = await loadPerson(db, employeeId);

    // ตรวจก่อนจองเลข — เลขที่จองไปแล้วแต่ออกเอกสารไม่ได้ คือช่องว่างในลำดับ
    const missing = missingFor(type, { employee, priv });
    if (missing.length) {
      throw new HttpsError("failed-precondition", `ยังกรอกข้อมูลไม่ครบ: ${missing.join(" · ")}`);
    }
    // หนังสือเตือนต้องระบุว่าเตือนเรื่องอะไร — ใบที่ไม่บอกเหตุใช้อ้างอิงไม่ได้
    // และเป็นเอกสารที่มีผลต่อคนคนหนึ่ง การปล่อยให้ออกใบเปล่าคือความเสียหายจริง
    if (type === "warning" && !str(data.incident)) {
      throw new HttpsError("invalid-argument", "หนังสือเตือนต้องระบุเหตุที่เตือน");
    }

    const at = Date.now();
    const terms = resolveContractTerms(settings);

    // **สัญญาที่ขัดกันเองแย่กว่าสัญญาที่ยังพิมพ์ไม่ได้** — ข้อ "เวลาทำงาน" พิมพ์
    // ทั้งช่วงเวลาและชั่วโมงต่อวัน ถ้าหักเวลาพักแล้วสองตัวเลขไม่ลงตัว เอกสารที่
    // คนต้องเซ็นจะบวกกันไม่ได้บนหน้ากระดาษ และใช้อ้างอิงตอนมีข้อพิพาทไม่ได้
    // ค่าตั้งต้น (09:00-18:00 · 8 ชม. · พัก 60 นาที) ลงตัวพอดี ด่านนี้จึงเงียบ
    // จนกว่าจะมีคนตั้งค่าที่ขัดกันเอง ซึ่งเป็นจังหวะที่ควรถูกหยุดพอดี
    if (type === "contract") {
      const sched = workScheduleCheck(terms);
      if (!sched.ok) {
        throw new HttpsError(
          "failed-precondition",
          `เวลาทำงานในค่าตั้งขัดกันเอง ออกสัญญาไม่ได้ — ${sched.reason} (แก้ที่หน้าตั้งค่าเงินเดือน/ภาษี)`,
        );
      }
    }

    const number = await allocateDocNumber(db, type, bangkokBuddhistYear(at));

    const doc = {
      type,
      number,
      employee_id: employeeId,
      employee_code: employee.employee_code || null,
      employee_name: employee.name || null,
      issued_at: at,
      // เงื่อนไขทั้งชุด — freeze ไว้ที่นี่ พิมพ์ซ้ำอ่านจากตรงนี้ ไม่ใช่จาก settings
      terms,
      pay: payLine(employee, priv),
      probation_end: probationEnd(employee.hired_at, terms.probation_days),
      status: "issued",
      ...employeeActorFields(callerStaffId, staffMap, request.auth),
    };
    // ฟิลด์เฉพาะชนิด
    if (type === "contract") {
      doc.fixed_term_end = Number(data.fixedTermEnd) || null;
    } else if (type === "salary_certificate") {
      doc.purpose = str(data.purpose, 200) || null;
    } else if (type === "warning") {
      doc.subject = str(data.subject, 200) || null;
      doc.incident = str(data.incident, 1000);
      doc.incident_at = Number(data.incidentAt) || null;
      doc.expires_at = warningExpiry(at, terms.warning_valid_days);
    } else if (type === "probation_pass") {
      doc.effective_at = Number(data.effectiveAt) || doc.probation_end;
      doc.note = str(data.note, 500) || null;
    }

    const pdf = await renderDoc({ type, employee, priv, doc, company });

    // ลงทะเบียนหลังสร้าง PDF สำเร็จเท่านั้น
    const ref = db.ref(`hr_documents/${employeeId}`).push();
    await ref.set(doc);

    console.log(`[hr-doc] issue ${type} ${number} for ${employeeId} by ${callerStaffId || "?"}`);
    return {
      ok: true, documentId: ref.key, number,
      filename: `${type}-${number}-${employee.employee_code || employeeId}.pdf`,
      base64: pdf.toString("base64"),
    };
  });

  // -------------------------------------------------------------------------
  // adminHrDocumentPrint — พิมพ์ซ้ำจากทะเบียน (ได้ฉบับเดิมเป๊ะ)
  // -------------------------------------------------------------------------
  const adminHrDocumentPrint = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const documentId = str(data.documentId, 60);
    const employeeId = str(data.employeeId, 60);
    if (!documentId || !employeeId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุเอกสาร");

    const snap = await db.ref(`hr_documents/${employeeId}/${documentId}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบเอกสาร");
    const doc = snap.val();
    const { employee, priv, company } = await loadPerson(db, doc.employee_id);

    const pdf = await renderDoc({ type: doc.type, employee, priv, doc, company });
    console.log(`[hr-doc] reprint ${doc.type} ${doc.number}`);
    return {
      filename: `${doc.type}-${doc.number}-${employee.employee_code || doc.employee_id}.pdf`,
      base64: pdf.toString("base64"),
      voided: doc.status === "void",
    };
  });

  // -------------------------------------------------------------------------
  // adminHrDocumentVoid — ยกเลิกเอกสาร
  //
  // **ไม่ลบแถว** — เลขที่ที่หายไปจากลำดับคือสิ่งที่อธิบายไม่ได้ตอนถูกตรวจ
  // ยกเลิกแล้วยังอยู่ในทะเบียนพร้อมเหตุผล และหนังสือเตือนที่ยกเลิกจะไม่ถูกนับ
  // เป็นใบที่ยังมีผลอีกต่อไป
  // -------------------------------------------------------------------------
  const adminHrDocumentVoid = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const documentId = str(data.documentId, 60);
    const employeeId = str(data.employeeId, 60);
    const reason = str(data.reason, 300);
    if (!documentId || !employeeId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุเอกสาร");
    if (!reason) throw new HttpsError("invalid-argument", "การยกเลิกต้องระบุเหตุผล");

    const ref = db.ref(`hr_documents/${employeeId}/${documentId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบเอกสาร");
    if (snap.val().status === "void") throw new HttpsError("failed-precondition", "เอกสารนี้ยกเลิกไปแล้ว");

    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    await ref.update({
      status: "void",
      void_reason: reason,
      voided_at: Date.now(),
      voided_by: actor.by_name || callerStaffId || null,
    });
    console.log(`[hr-doc] void ${snap.val().number} by ${callerStaffId || "?"}`);
    return { ok: true };
  });

  return { adminHrDocumentList, adminHrDocumentIssue, adminHrDocumentPrint, adminHrDocumentVoid };
}

module.exports = { registerHrDocuments, allocateDocNumber };
