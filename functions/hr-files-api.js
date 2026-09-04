// =============================================================================
// แฟ้มเอกสารพนักงาน — callable
//
// กติกาทั้งหมดอยู่ `hr-files.js` (ล้วน มีเทส) ไฟล์นี้ต่อสายกับ Firebase เท่านั้น
//
// **โครงเก็บซ้อนใต้ employeeId แบบเดียวกับ `hr_documents`** — อ่านของคนเดียวคือ
// การอ่าน subtree เล็กๆ ตรงๆ ไม่ต้องมี `.indexOn` ซึ่งอยู่ในไฟล์กฎของอีกรีโป
// (ปัญหาที่ `employee_events` ยังติดอยู่ทุกวันนี้ — จดไว้ที่ hr.js)
//
// **`employee_files` ไม่มี rule เป็นของตัวเองทั้งใน RTDB และ Storage** จึงตกกฎ
// ปิดของ root ทั้งสองที่: RTDB `.read/.write: false` และ Storage catch-all
// `allow read, write: if false` — Admin SDK เท่านั้นที่แตะได้ **ไม่ต้อง deploy
// rules ทั้งสองฝั่ง** ซึ่งเป็นเหตุผลหนึ่งที่เลือกทางนี้ (ดูหัวไฟล์ hr-files.js)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");

const { requireStaffRole } = require("./staff-accounts");
const { HR_ROLES, employeeActorFields } = require("./hr-core");
const {
  FILE_KINDS, MAX_FILE_BYTES, checklistFor, validateUpload, fileStoragePath,
} = require("./hr-files");

const REGION = "asia-southeast1";
const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);

/**
 * โหลดพนักงาน + แถวไฟล์ของเขา
 *
 * `hasRider` มาจาก `links.rider_id` ไม่ใช่จากการเดา — ใบขับขี่จำเป็นเฉพาะคนที่
 * ผูกกับบัญชีไรเดอร์จริง การบังคับทุกคนจะทำให้เช็คลิสต์ของพนักงานออฟฟิศไม่มีวันครบ
 */
async function loadFiles(db, employeeId) {
  const [empSnap, filesSnap] = await Promise.all([
    db.ref(`employees/${employeeId}`).once("value"),
    db.ref(`employee_files/${employeeId}`).once("value"),
  ]);
  if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");
  const employee = { id: employeeId, ...empSnap.val() };
  const files = [];
  filesSnap.forEach((c) => { files.push({ id: c.key, ...c.val() }); return false; });
  files.sort((a, b) => (b.uploaded_at || 0) - (a.uploaded_at || 0));
  return { employee, files, hasRider: Boolean((employee.links || {}).rider_id) };
}

/**
 * แถวที่ส่งกลับหน้าเว็บ — **ไม่มี URL และไม่มี storage_path**
 *
 * `storage_path` ไม่ได้เป็นความลับในตัวมันเอง แต่การส่งออกไปแปลว่ามีที่อยู่ของ
 * สำเนาบัตรประชาชนวางอยู่ใน DOM ของเบราว์เซอร์โดยไม่มีใครต้องใช้มัน —
 * การเปิดไฟล์อ้างด้วย `fileId` ซึ่ง server แปลงเป็น path เอง
 */
const publicRow = (f) => ({
  id: f.id,
  kind: f.kind,
  filename: f.filename,
  content_type: f.content_type,
  size: f.size,
  uploaded_at: f.uploaded_at,
  uploaded_by_name: f.uploaded_by_name || null,
  note: f.note || null,
});

function registerHrFiles() {
  // -------------------------------------------------------------------------
  // adminHrEmployeeFileList — แฟ้มของคนหนึ่งคน + เช็คลิสต์ว่าขาดอะไร
  // -------------------------------------------------------------------------
  const adminHrEmployeeFileList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, HR_ROLES);
    const employeeId = str((request.data || {}).employeeId, 60);
    if (!employeeId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุพนักงาน");

    const { employee, files, hasRider } = await loadFiles(db, employeeId);
    return {
      files: files.map(publicRow),
      checklist: checklistFor({ employee, files, hasRider }),
      max_bytes: MAX_FILE_BYTES,
    };
  });

  // -------------------------------------------------------------------------
  // adminHrEmployeeFileUpload — รับไฟล์เข้าแฟ้ม
  //
  // **เขียน Storage ก่อน แล้วค่อยเขียนแถว** — ลำดับนี้ทำให้ความล้มเหลวที่เป็นไป
  // ได้คือ "ไฟล์อยู่แต่ไม่มีแถว" (เปลืองที่ แต่ไม่มีใครเห็นและกู้ได้) ไม่ใช่
  // "แถวชี้ไปยังไฟล์ที่ไม่มี" ซึ่งจะกลายเป็นปุ่มดาวน์โหลดที่พังตลอดไป
  // -------------------------------------------------------------------------
  const adminHrEmployeeFileUpload = onCall(
    { region: REGION, memory: "512MiB" },
    async (request) => {
      const db = getDatabase();
      const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
      const data = request.data || {};
      const employeeId = str(data.employeeId, 60);
      if (!employeeId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุพนักงาน");

      const checked = validateUpload(data);
      if (checked.error) throw new HttpsError("invalid-argument", checked.error);

      const empSnap = await db.ref(`employees/${employeeId}`).once("value");
      if (!empSnap.exists()) throw new HttpsError("not-found", "ไม่พบพนักงานในทะเบียน");

      const ref = db.ref(`employee_files/${employeeId}`).push();
      const fileId = ref.key;
      const path = fileStoragePath(employeeId, fileId, checked.ext);
      if (!path) throw new HttpsError("internal", "สร้างที่เก็บไฟล์ไม่สำเร็จ");

      // **ไม่ตั้ง firebaseStorageDownloadTokens** — เอกสารตัวอื่นตั้งเพื่อให้ได้
      // URL เปิดตรงได้ ซึ่งเป็น URL ที่ข้ามกฎ Storage ตลอดไป ไฟล์กลุ่มนี้ไม่มี
      // token จึงไม่มีทางเปิดได้เลยนอกจากผ่าน callable ที่ตรวจสิทธิ์
      await getStorage().bucket().file(path).save(checked.buffer, {
        contentType: checked.contentType,
        resumable: false,
      });

      const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
      const row = {
        kind: checked.kind,
        filename: checked.filename,
        content_type: checked.contentType,
        size: checked.size,
        storage_path: path,
        note: str(data.note, 300) || null,
        uploaded_at: Date.now(),
        uploaded_by: actor.by_uid || callerStaffId || null,
        uploaded_by_name: actor.by_name || null,
      };
      await ref.set(row);

      // `to.document` = ชื่อชนิดเอกสาร — ไทม์ไลน์อ่านฟิลด์นี้ (รูปเดียวกับ
      // `to.position` ของ promoted) **ห้ามใส่ชื่อไฟล์จริง** เพราะคนตั้งชื่อไฟล์
      // ว่าอะไรก็ได้ รวมถึงเลขบัตรของตัวเอง แล้วมันจะไปนั่งอยู่บนไทม์ไลน์ถาวร
      await recordFileEvent(db, {
        employee_id: employeeId,
        action: "document_uploaded",
        from: null,
        to: { document: FILE_KINDS[checked.kind].label },
        ...actor,
      });

      console.log(`[hr-files] upload ${checked.kind} ${employeeId} (${checked.size} bytes)`);
      return { file: publicRow({ id: fileId, ...row }) };
    },
  );

  // -------------------------------------------------------------------------
  // adminHrEmployeeFileGet — เปิด/ดาวน์โหลดไฟล์
  //
  // คืน bytes ไม่คืน URL (รูปเดียวกับ `adminHrDocumentPrint`) — ทุกครั้งที่มีคน
  // เปิดสำเนาบัตร ต้องผ่านด่านสิทธิ์ใหม่ ไม่ใช่ผ่านลิงก์ที่ออกไว้เมื่อปีที่แล้ว
  //
  // **ไม่เขียน employee_events** โดยตั้งใจ: การเปิดดูเกิดบ่อยกว่าการเปลี่ยนแปลง
  // มาก ถ้าลงไทม์ไลน์ ประวัติของคนคนหนึ่งจะกลายเป็นรายการ "เปิดดูไฟล์" จนกลบ
  // เหตุการณ์จริง — ร่องรอยจึงอยู่ที่ log บรรทัดเดียวแทน
  // -------------------------------------------------------------------------
  const adminHrEmployeeFileGet = onCall(
    { region: REGION, memory: "512MiB" },
    async (request) => {
      const db = getDatabase();
      const { callerStaffId } = await requireStaffRole(db, request.auth, HR_ROLES);
      const data = request.data || {};
      const employeeId = str(data.employeeId, 60);
      const fileId = str(data.fileId, 60);
      if (!employeeId || !fileId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุไฟล์");

      const snap = await db.ref(`employee_files/${employeeId}/${fileId}`).once("value");
      if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบไฟล์");
      const row = snap.val();

      // path มาจากแถวใน DB ที่ Admin SDK เขียนเอง ไม่ได้มาจาก client
      const [buf] = await getStorage().bucket().file(row.storage_path).download();
      console.log(`[hr-files] read ${row.kind} ${employeeId}/${fileId} by ${callerStaffId || "?"}`);
      return {
        filename: row.filename,
        content_type: row.content_type,
        base64: buf.toString("base64"),
      };
    },
  );

  // -------------------------------------------------------------------------
  // adminHrEmployeeFileDelete — ลบไฟล์ออกจากแฟ้ม
  //
  // **ลบไฟล์ก่อน แล้วค่อยลบแถว และล้มทั้งคู่ถ้าลบไฟล์ไม่ได้** — กติกาเดียวกับ
  // การลบใบสมัครพร้อมเรซูเม่ (`adminHrApplicationDelete`): ลบแถวทิ้งโดยไฟล์ยังอยู่
  // = สำเนาบัตรประชาชนกำพร้าที่ไม่มีใครรู้ว่ามีอยู่และไม่มี process ไหนตามมาเก็บ
  // ซึ่งเป็นสิ่งที่แย่กว่าการลบไม่สำเร็จแล้วบอกให้ลองใหม่
  // -------------------------------------------------------------------------
  const adminHrEmployeeFileDelete = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, staffMap } = await requireStaffRole(db, request.auth, HR_ROLES);
    const data = request.data || {};
    const employeeId = str(data.employeeId, 60);
    const fileId = str(data.fileId, 60);
    if (!employeeId || !fileId) throw new HttpsError("invalid-argument", "ไม่ได้ระบุไฟล์");

    const ref = db.ref(`employee_files/${employeeId}/${fileId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบไฟล์");
    const row = snap.val();

    try {
      await getStorage().bucket().file(row.storage_path).delete();
    } catch (e) {
      // 404 = ไฟล์หายไปแล้ว ซึ่งคือสถานะที่การลบต้องการอยู่แล้ว
      const code = e && (e.code || e.status);
      if (String(code) !== "404") {
        throw new HttpsError("internal", "ลบไฟล์ในที่เก็บไม่สำเร็จ ยังไม่ได้ลบรายการ ลองใหม่อีกครั้ง");
      }
    }

    await ref.remove();
    const actor = employeeActorFields(callerStaffId, staffMap, request.auth);
    await recordFileEvent(db, {
      employee_id: employeeId,
      action: "document_deleted",
      from: { document: (FILE_KINDS[row.kind] || {}).label || row.kind },
      to: null,
      ...actor,
    });
    console.log(`[hr-files] delete ${row.kind} ${employeeId}/${fileId} by ${callerStaffId || "?"}`);
    return { ok: true };
  });

  return {
    adminHrEmployeeFileList,
    adminHrEmployeeFileUpload,
    adminHrEmployeeFileGet,
    adminHrEmployeeFileDelete,
  };
}

/**
 * เขียนไทม์ไลน์ — ล้มเงียบเหมือน `recordEmployeeEvent` ใน hr.js
 *
 * ไฟล์ถูกอัปโหลด/ลบไปแล้วจริงตอนที่บรรทัดนี้ทำงาน การโยน error ตรงนี้จะทำให้
 * คนกดเข้าใจว่าไม่สำเร็จแล้วกดซ้ำ ซึ่งแย่กว่าประวัติขาดแถว
 */
async function recordFileEvent(db, event) {
  try {
    await db.ref("employee_events").push({ at: Date.now(), ...event });
  } catch (e) {
    console.error("[hr-files] event log failed:", e && e.message ? e.message : e);
  }
}

module.exports = { registerHrFiles };
