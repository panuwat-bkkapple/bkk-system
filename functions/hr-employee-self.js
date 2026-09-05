// =============================================================================
// แอปพนักงาน — เส้นทาง "ข้อมูลของฉัน" (ตารางกะ · สลิปเงินเดือน · แฟ้มเอกสาร · โปรไฟล์)
//
// **ทุกตัวที่นี่อ่านได้เฉพาะของเจ้าตัว** — `employeeId` มาจาก auth token ผ่าน
// `requireEmployeeCaller` เสมอ ไม่มี callable ไหนรับ id จาก body เพราะ id ที่
// ผู้เรียกระบุเองได้ = สลิปเงินเดือนของเพื่อนร่วมงานที่เดาชื่อไฟล์ถูก
//
// **ทำไมเป็นไฟล์ใหม่ ไม่ต่อท้าย `hr-employee-portal.js`** — ไฟล์นั้นเป็นเจ้าของ
// "คำขอและการอนุมัติ" (ใบลา เปลี่ยนกะ กล่องหัวหน้า) ซึ่งเป็นเส้นทาง**เขียน**ที่มี
// กติกาของตัวเอง ส่วนไฟล์นี้เป็นเส้นทาง**อ่าน**ที่ยืมข้อมูลของโมดูล HR ตัวอื่นมา
// แสดง (payroll / files / documents / attendance) การรวมกันจะทำให้ไฟล์เดียว
// import โมดูล HR เกือบทั้งหมดโดยไม่มีเหตุผลร่วมกัน
//
// **ข้อมูลทุกชิ้นที่ส่งออกเป็น allowlist ไม่ใช่ส่งทั้งก้อน** — แถวใน
// `payroll_items` มีทั้ง `wht_override.by_staff_id` และหมายเหตุภายในของ HR อยู่
// ด้วย การส่งทั้งแถวคือการเปิดบันทึกภายในให้เจ้าตัวอ่านโดยไม่มีใครตัดสินใจ
// (หลักเดียวกับ `PUBLIC_TRACK_FIELDS` และ `publicRow` ของแฟ้มเอกสาร)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");

const { requireEmployeeCaller } = require("./hr-employee-auth");
const { validateUpload, fileStoragePath, FILE_KINDS } = require("./hr-files");
const { DOC_TYPES } = require("./hr-documents");
const { buildPayslipPdf } = require("./voucher-pdf");
const A = require("./hr-attendance");

const REGION = "asia-southeast1";
const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const nowMs = () => Date.now();
const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** เพดานของทุกลิสต์ — ชนแล้วบอกบนหน้าจอ ไม่ตัดเงียบ */
const MAX_PAYSLIPS = 24;
const MAX_FILES = 200;
const MAX_DOCS = 100;

/**
 * รอบเงินเดือนที่พนักงานเห็นได้
 *
 * **`draft` ห้ามหลุดออกไปเด็ดขาด** — รอบร่างยังถูกแก้ตัวเลขได้จนถึงวินาทีที่
 * อนุมัติ ถ้าพนักงานเห็นก่อน เขาจะจำเลขที่ยังไม่ใช่เลขจริง แล้วมาทักตอนเงินเข้า
 * ไม่ตรง ซึ่งเป็นปัญหาที่ระบบสร้างขึ้นเอง (ฝั่ง HR มีปุ่มออกสลิปฉบับร่างได้
 * เพราะมีคนตรวจอยู่ตรงนั้น — คนละสถานการณ์กัน)
 */
const VISIBLE_RUN_STATUSES = new Set(["approved", "paid"]);

/** ชนิดไฟล์ที่ "พนักงานส่งเองได้" — ไม่ใช่ทุกชนิดใน FILE_KINDS
 *
 *  ตัด `signed_contract` ออกโดยตั้งใจ: สัญญาที่เซ็นแล้วเป็นเอกสารที่ใช้ยันกัน
 *  ตอนมีข้อพิพาท ฉบับที่ถือว่าเป็นของจริงต้องมาจากมือ HR ไม่ใช่จากการอัปโหลด
 *  ของฝ่ายเดียว (พนักงานยังอัปโหลดเป็น `other` พร้อมโน้ตได้ ถ้าจะส่งให้ HR ดู)
 */
const EMPLOYEE_UPLOAD_KINDS = new Set([
  "id_card", "house_registration", "bank_book", "ly01", "sso_1_03",
  "driver_license", "education", "photo", "other",
]);

/**
 * ชนิดเอกสารที่ HR ออกให้ แล้วพนักงานเปิดดูเองได้
 *
 * **`warning` (หนังสือเตือน) ไม่อยู่ในลิสต์โดยตั้งใจ** — มันไม่ใช่ความลับจาก
 * เจ้าตัว (ตามกฎหมายเขาต้องได้รับอยู่แล้ว) แต่การให้มันโผล่เงียบๆ ในแฟ้มของ
 * แอปแปลว่าพนักงานอาจรู้ว่าถูกออกหนังสือเตือนจาก push ของแอป ก่อนที่หัวหน้าจะ
 * ได้คุยด้วย ซึ่งเป็นการส่งข่าวแบบที่ไม่ควรให้ระบบเป็นคนทำ
 */
const SELF_VISIBLE_DOC_TYPES = new Set(["contract", "salary_certificate", "probation_pass"]);

/** เดือนก่อนหน้า (YYYY-MM) — ใช้เดินย้อนหลังหาสลิป */
function prevMonth(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthOf = (ms) => A.bangkokIso(ms).slice(0, 7);
const monthStart = (ym) => `${ym}-01`;
const monthEnd = (ym) => `${ym}-31`;

/** แถวสลิปแบบย่อ (หน้ารายการ) */
const payslipBrief = (period, run, item) => ({
  period,
  status: run.status || null,
  pay_date: num(run.pay_date, 0) || null,
  net: num(item.net, 0),
  gross: num(item.gross, 0),
});

/**
 * สลิปเต็มใบ — allowlist
 *
 * ไม่ส่ง `wht_override` (มีชื่อและ staff id ของคนที่แก้), ไม่ส่ง `note` ของ HR,
 * ไม่ส่ง `warnings` (เป็นเรื่องที่ HR ต้องตามให้จบ ไม่ใช่เรื่องที่พนักงานแก้ได้
 * และบางข้อความอ่านแล้วเข้าใจผิดว่าเงินจะไม่เข้า)
 */
const payslipFull = (period, run, item) => ({
  period,
  status: run.status || null,
  pay_date: num(run.pay_date, 0) || null,
  period_from: num(run.from, 0) || null,
  period_to: num(run.to, 0) || null,
  name: item.name || null,
  employee_code: item.employee_code || null,
  pay_method: item.pay_method || null,
  bank_name: item.bank_name || null,
  bank_masked: item.bank_masked || null,
  earnings: (Array.isArray(item.earnings) ? item.earnings : [])
    .map((e) => ({ label: str(e && e.label, 120), amount: num(e && e.amount, 0) })),
  deductions: (Array.isArray(item.deductions) ? item.deductions : [])
    .map((e) => ({ label: str(e && e.label, 120), amount: num(e && e.amount, 0) })),
  gross: num(item.gross, 0),
  net: num(item.net, 0),
  wht: num(item.wht, 0),
  sso_employee: num(item.sso_employee, 0),
  days_worked: item.days_worked == null ? null : num(item.days_worked, 0),
});

function registerHrEmployeeSelf() {
  // -------------------------------------------------------------------------
  // employeeRoster — ตารางกะของฉันทั้งเดือน (จอ 03)
  //
  // **ต้องผ่าน `resolveShift` ไม่ใช่อ่าน `shift_roster` ตรงๆ** — วันที่ไม่มีแถว
  // ในตารางเวรไม่ได้แปลว่าวันหยุดเสมอไป มันตกไปที่ `default_shift_id` ของแฟ้ม
  // พนักงาน ซึ่งเป็นกฎเดียวกับที่ตอนเช็คอินใช้ตัดสิน ถ้าจอนี้อ่านเอง พนักงานจะ
  // เห็น "วันหยุด" แล้วไม่มาทำงาน ทั้งที่ระบบจะบันทึกว่าเขาขาดงาน
  // -------------------------------------------------------------------------
  const employeeRoster = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const asked = str((request.data || {}).month, 7);
    const month = MONTH_RE.test(asked) ? asked : monthOf(nowMs());

    const [hrSnap, rosterSnap, reqSnap, attSnap] = await Promise.all([
      db.ref("settings/hr").once("value"),
      db.ref(`shift_roster/${employeeId}`).orderByKey()
        .startAt(monthStart(month)).endAt(monthEnd(month)).once("value"),
      db.ref(`shift_requests/${employeeId}`).once("value"),
      db.ref(`attendance/${employeeId}`).orderByKey()
        .startAt(monthStart(month)).endAt(monthEnd(month)).once("value"),
    ]);

    const hr = hrSnap.exists() ? hrSnap.val() : {};
    const { shifts } = A.normalizeShifts(hr.shifts);
    const roster = {};
    rosterSnap.forEach((c) => { roster[c.key] = c.val(); return false; });
    const attended = {};
    attSnap.forEach((c) => { attended[c.key] = c.val(); return false; });

    // คำขอเปลี่ยนกะที่ยังรอตอบ ผูกกับวันของมัน — จอต้องบอกได้ว่าวันนี้ "รอตอบ"
    const pending = {};
    reqSnap.forEach((c) => {
      const v = c.val() || {};
      if (v.status === "pending" && DATE_RE.test(str(v.date, 10))) pending[v.date] = { id: c.key, ...v };
      return false;
    });

    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const todayIso = A.bangkokIso(nowMs());

    const days = [];
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      // resolveShift คืน { shift, source } ไม่ใช่ตัวกะ — ลืมแกะแล้วจะได้ undefined
      const { shift } = A.resolveShift({ shifts, roster, employee, iso });
      const p = pending[iso] || null;
      const att = attended[iso] || null;
      days.push({
        date: iso,
        today: iso === todayIso,
        shift: shift
          ? { id: shift.id, label: shift.label, start: shift.start, end: shift.end,
              crosses_midnight: shift.crosses_midnight === true }
          : null,
        // โน้ตรายวันของตารางเวร (ถ้า HR กรอกไว้) — ไม่มีก็คือไม่มี ห้ามเดา
        note: str((roster[iso] || {}).note, 120) || null,
        pending_change: p
          ? { id: p.id, to_shift_label: p.to_shift_label || null, to_shift_id: p.to_shift_id || null }
          : null,
        checked_in: att && A.realNumber(att.in_at) !== null,
        late_min: att ? A.realNumber(att.late_min) : null,
      });
    }

    return {
      month,
      days,
      shifts: shifts.map((s) => ({ id: s.id, label: s.label, start: s.start, end: s.end })),
      default_shift_id: employee.default_shift_id || null,
    };
  });

  // -------------------------------------------------------------------------
  // employeePayslipList / employeePayslipGet / employeePayslipPdf (จอ 06)
  //
  // เดินย้อนหลังทีละเดือนจากเดือนปัจจุบัน แทนการอ่าน `payroll_runs` ทั้งก้อน —
  // โหนดนั้นมีทุกคนของทุกงวดอยู่ในนั้น การดึงมาทั้งก้อนเพื่อหาของคนเดียวคือ
  // การจ่ายค่าดาวน์โหลดของทั้งบริษัทต่อการเปิดแอปหนึ่งครั้ง (กฎค่า RTDB)
  // -------------------------------------------------------------------------
  const employeePayslipList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const want = Math.min(Math.max(num((request.data || {}).limit, 12), 1), MAX_PAYSLIPS);

    const rows = [];
    let ym = monthOf(nowMs());
    // เผื่อเดือนที่ยังไม่มีรอบ — มองย้อนไม่เกิน 2 เท่าของที่ขอ แล้วหยุด
    for (let i = 0; i < want * 2 && rows.length < want; i += 1) {
      const [runSnap, itemSnap] = await Promise.all([
        db.ref(`payroll_runs/${ym}`).once("value"),
        db.ref(`payroll_items/${ym}/${employeeId}`).once("value"),
      ]);
      const run = runSnap.val();
      const item = itemSnap.val();
      if (run && item && VISIBLE_RUN_STATUSES.has(run.status) && !item.incomplete && !item.skipped) {
        rows.push(payslipBrief(ym, run, item));
      }
      ym = prevMonth(ym);
    }
    return { periods: rows };
  });

  /** โหลดสลิปหนึ่งใบพร้อมด่านทั้งหมด — ใช้ร่วมกันระหว่างตัวอ่านกับตัวออก PDF */
  async function loadOwnPayslip(db, employeeId, period) {
    if (!MONTH_RE.test(period)) throw new HttpsError("invalid-argument", "งวดไม่ถูกต้อง");
    const [runSnap, itemSnap] = await Promise.all([
      db.ref(`payroll_runs/${period}`).once("value"),
      db.ref(`payroll_items/${period}/${employeeId}`).once("value"),
    ]);
    const run = runSnap.val();
    const item = itemSnap.val();
    // รอบร่าง/ไม่มีแถวของเรา = "ยังไม่มีสลิปงวดนี้" เหมือนกันหมด ไม่บอกว่ามีรอบ
    // อยู่แต่ยังไม่อนุมัติ เพราะนั่นคือการเล่าสถานะภายในของ HR ให้ทุกคนฟัง
    if (!run || !item || !VISIBLE_RUN_STATUSES.has(run.status) || item.incomplete || item.skipped) {
      throw new HttpsError("not-found", "ยังไม่มีสลิปของงวดนี้");
    }
    return { run, item };
  }

  const employeePayslipGet = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const period = str((request.data || {}).period, 7);
    const { run, item } = await loadOwnPayslip(db, employeeId, period);
    return payslipFull(period, run, item);
  });

  const employeePayslipPdf = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const period = str((request.data || {}).period, 7);
    const { run, item } = await loadOwnPayslip(db, employeeId, period);
    const [empSnap, acctSnap] = await Promise.all([
      db.ref(`employees/${employeeId}`).once("value"),
      db.ref("settings/accounting/company").once("value"),
    ]);
    const pdf = await buildPayslipPdf({
      employee: empSnap.val() || {},
      item,
      run: { id: period, ...run },
      company: acctSnap.val() || {},
    });
    console.log(`[hr-employee-self] payslip ${period}/${employeeId} bytes=${pdf.length}`);
    return {
      filename: `payslip-${period}-${item.employee_code || employeeId}.pdf`,
      base64: pdf.toString("base64"),
    };
  });

  // -------------------------------------------------------------------------
  // employeeFileList / employeeFileDownload / employeeFileUpload (จอ 07)
  //
  // แฟ้มของพนักงานมีสองแหล่งที่คนละเจ้าของ: ไฟล์ที่อัปโหลด (`employee_files`)
  // กับเอกสารที่ HR ออกให้ (`hr_documents`) — จอเดียวแสดงทั้งสองอย่างได้ แต่
  // **ห้ามยุบเป็นลิสต์เดียวในข้อมูล** เพราะการเปิดไฟล์คนละทางกัน และการลบ
  // เอกสารที่ระบบออกเลขไว้แล้วไม่ใช่สิ่งที่พนักงานทำได้
  // -------------------------------------------------------------------------
  const employeeFileList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const [filesSnap, docsSnap] = await Promise.all([
      db.ref(`employee_files/${employeeId}`).once("value"),
      db.ref(`hr_documents/${employeeId}`).once("value"),
    ]);

    const files = [];
    filesSnap.forEach((c) => {
      const v = c.val() || {};
      files.push({
        id: c.key,
        kind: v.kind || "other",
        kind_label: (FILE_KINDS[v.kind] || {}).label || "เอกสารอื่น",
        filename: v.filename || null,
        content_type: v.content_type || null,
        size: num(v.size, 0),
        uploaded_at: num(v.uploaded_at, 0) || null,
        by_me: v.uploaded_by_employee === true,
      });
      return false;
    });
    files.sort((a, b) => (b.uploaded_at || 0) - (a.uploaded_at || 0));

    const documents = [];
    docsSnap.forEach((c) => {
      const v = c.val() || {};
      if (!SELF_VISIBLE_DOC_TYPES.has(v.type)) return false;
      if (v.status === "void" || v.voided_at) return false;
      documents.push({
        id: c.key,
        type: v.type,
        type_label: (DOC_TYPES[v.type] || {}).label || v.type,
        number: v.number || null,
        issued_at: num(v.issued_at, 0) || null,
      });
      return false;
    });
    documents.sort((a, b) => (b.issued_at || 0) - (a.issued_at || 0));

    return {
      files: files.slice(0, MAX_FILES),
      documents: documents.slice(0, MAX_DOCS),
      capped: files.length > MAX_FILES || documents.length > MAX_DOCS,
      upload_kinds: [...EMPLOYEE_UPLOAD_KINDS].map((k) => ({ id: k, label: FILE_KINDS[k].label })),
    };
  });

  const employeeFileDownload = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    const { id: employeeId } = await requireEmployeeCaller(db, request.auth);
    const fileId = str((request.data || {}).fileId, 60);
    if (!fileId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุไฟล์");
    // อ่านใต้ subtree ของเจ้าตัวเท่านั้น — id ของคนอื่นจึงหาไม่เจอโดยโครงสร้าง
    // ไม่ใช่เพราะมี if ตรวจ (เงื่อนไขที่ลืมได้ vs เส้นทางที่ไปไม่ถึง)
    const snap = await db.ref(`employee_files/${employeeId}/${fileId}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบไฟล์นี้");
    const row = snap.val() || {};
    if (!row.storage_path) throw new HttpsError("not-found", "ไฟล์นี้ไม่มีข้อมูลแนบ");
    const [buf] = await getStorage().bucket().file(row.storage_path).download();
    return {
      filename: row.filename || "document",
      content_type: row.content_type || "application/octet-stream",
      base64: buf.toString("base64"),
    };
  });

  const employeeFileUpload = onCall({ region: REGION, memory: "512MiB" }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const d = request.data || {};
    const kind = str(d.kind, 40);
    if (!EMPLOYEE_UPLOAD_KINDS.has(kind)) {
      throw new HttpsError("invalid-argument", "ชนิดเอกสารนี้ต้องให้ฝ่ายบุคคลเป็นผู้เพิ่ม");
    }
    const checked = validateUpload({
      kind, filename: d.filename, contentType: d.contentType, base64: d.base64,
    });
    if (checked.error) throw new HttpsError("invalid-argument", checked.error);

    const ref = db.ref(`employee_files/${employeeId}`).push();
    const path = fileStoragePath(employeeId, ref.key, checked.ext);
    if (!path) throw new HttpsError("internal", "สร้างที่เก็บไฟล์ไม่ได้");
    await getStorage().bucket().file(path).save(checked.buffer, {
      contentType: checked.contentType,
      resumable: false,
    });
    await ref.set({
      kind: checked.kind,
      filename: checked.filename,
      content_type: checked.contentType,
      size: checked.size,
      storage_path: path,
      uploaded_at: nowMs(),
      uploaded_by_name: employee.name || null,
      // **ธงนี้มีไว้ให้ HR เห็นว่าใครเป็นคนใส่** — ไฟล์ที่พนักงานส่งเองกับไฟล์ที่
      // HR ตรวจแล้วใส่เข้าแฟ้ม มีน้ำหนักไม่เท่ากันตอนใช้ยันเรื่อง
      uploaded_by_employee: true,
    });
    return { ok: true, id: ref.key };
  });

  // -------------------------------------------------------------------------
  // employeeProfile — "ฉันคือใครในระบบ" + สรุปเดือนนี้ (จอ 08)
  //
  // **สรุปเดือนนี้รายงานเฉพาะสิ่งที่ระบบวัดจริง** — ต้นฉบับของดีไซน์มีช่อง
  // "โอทีสะสม" แต่ระบบลงเวลาไม่ได้เก็บโอทีเป็นของตัวเอง (โอทีเกิดที่รอบเงินเดือน
  // ในฐานะรายการรายได้ที่ HR กรอก) การเอาเลขจาก `worked_min` มาเรียกว่าโอทีคือ
  // การประกาศตัวเลขที่ไม่มีใครรับรอง จึงรายงานเป็น "ชั่วโมงทำงาน" ตามที่วัดได้จริง
  // -------------------------------------------------------------------------
  const employeeProfile = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { id: employeeId, employee } = await requireEmployeeCaller(db, request.auth);
    const month = monthOf(nowMs());

    const supervisorId = str(employee.supervisor_id, 80);
    const [attSnap, supSnap] = await Promise.all([
      db.ref(`attendance/${employeeId}`).orderByKey()
        .startAt(monthStart(month)).endAt(monthEnd(month)).once("value"),
      supervisorId ? db.ref(`employees/${supervisorId}`).once("value") : Promise.resolve(null),
    ]);

    let worked = 0;
    let lateDays = 0;
    let workedMin = 0;
    attSnap.forEach((c) => {
      const v = c.val() || {};
      if (A.realNumber(v.in_at) === null) return false;
      worked += 1;
      if (num(v.late_min, 0) > 0) lateDays += 1;
      workedMin += num(v.worked_min, 0);
      return false;
    });

    const sup = supSnap && supSnap.exists() ? supSnap.val() : null;
    return {
      id: employeeId,
      name: employee.name || null,
      employee_code: employee.employee_code || null,
      position: employee.position || null,
      department: employee.department || null,
      branch: employee.branch || null,
      photo_url: employee.photo_url || null,
      hired_at: num(employee.hired_at, 0) || null,
      status: employee.status || null,
      // ชื่อหัวหน้าเป็นข้อมูลที่ลูกน้องต้องรู้อยู่แล้ว (ใบลาของเขาไปถึงคนนี้)
      // แต่ไม่ส่งอย่างอื่นของหัวหน้าออกไปนอกจากชื่อกับตำแหน่ง
      supervisor: sup ? { name: sup.name || null, position: sup.position || null } : null,
      month,
      summary: {
        worked_days: worked,
        late_days: lateDays,
        worked_hours: Math.round((workedMin / 60) * 10) / 10,
      },
    };
  });

  return {
    employeeRoster,
    employeePayslipList,
    employeePayslipGet,
    employeePayslipPdf,
    employeeFileList,
    employeeFileDownload,
    employeeFileUpload,
    employeeProfile,
  };
}

module.exports = {
  registerHrEmployeeSelf,
  VISIBLE_RUN_STATUSES,
  EMPLOYEE_UPLOAD_KINDS,
  SELF_VISIBLE_DOC_TYPES,
  payslipFull,
  prevMonth,
};
