// =============================================================================
// แฟ้มเอกสารพนักงาน — กติกาล้วน ไม่มี Firebase ไม่มี I/O
//
// **ช่องว่างที่ไฟล์นี้ปิด:** ระบบเก็บ "ข้อมูล" พนักงานได้ครบ แต่ไม่มีที่เก็บ
// "ไฟล์" เลยแม้แต่ช่องเดียว — ลูกค้าที่ขายเครื่องให้เรามีสำเนาบัตรเก็บไว้ที่
// `jobs_kyc/{jobId}` ส่วนพนักงานของเราเองไม่มี สัญญาจ้างที่ระบบพิมพ์ออกไปแล้ว
// เซ็นกลับมาก็ไม่มีที่วาง
//
// ─── ทำไมไฟล์ไม่ได้อัปโหลดตรงเข้า Storage จากเบราว์เซอร์ ───────────────────
// เส้นทางอื่นในระบบ (เรซูเม่ผู้สมัคร, รูป QC, สลิป) ให้ client เขียน Storage
// ตรงแล้วให้ `storage.rules` เป็นด่าน **แต่ทางนั้นใช้กับแฟ้มนี้ไม่ได้:**
//
//   1. `storage.rules` มีคำกล่าวเดียวที่แปลว่า "แอดมิน" คือ `isAdmin()` ซึ่งอ่าน
//      **มิเรอร์ของ `/admins` ใน Firestore** เพราะกฎ Storage อ่าน RTDB ไม่ได้
//      — และ `firestore.rules` ของรีโปนั้นเขียนไว้ตรงตัวว่า "Firestore holds
//      search analytics and nothing else" ไม่มีโค้ดที่ไหนในสามรีโปเขียนมิเรอร์
//      นั้นเลย (grep แล้ว) ด่านที่พึ่งของที่อาจไม่มีอยู่จริงคือด่านที่เราไม่รู้
//      ว่ามันปฏิเสธทุกคนหรือปล่อยผ่านทุกคน
//   2. กติกาที่เหลือใน `storage.rules` คือ `request.auth != null` ซึ่งแปลว่า
//      **"ใครก็ได้ที่ล็อกอิน" รวมลูกค้านิรนามทุกคน** — ไฟล์นี้คือสำเนาบัตร
//      ประชาชนของพนักงาน ซึ่งเป็นเส้นที่ไฟล์กฎเองก็ขีดไว้แล้ว
//      ("THE ID-DOCUMENT PREFIXES ARE THE EXCEPTION — DO NOT RE-WIDEN THEM")
//   3. `storage.rules` เป็นของ `bkk-frontend-next` ต้อง deploy แยกจากอีกรีโป
//      ฟีเจอร์ที่ต้องรอ deploy ข้ามรีโปถึงจะทำงานคือฟีเจอร์ที่พังเงียบระหว่าง
//      รอ (บทเรียนเดียวกับ `SEARCH_OVERVIEW_KEY` และ TTL ของ Firestore)
//
// จึงเดินทาง **callable ทั้งขาขึ้นและขาลง**: Admin SDK เขียน/อ่านไฟล์ ส่วน
// prefix `employee_files/` ใน Storage **ไม่ต้องมี rule เลย** — มันตกกฎ
// catch-all `allow read, write: if false` ที่มีอยู่แล้ว แปลว่าเบราว์เซอร์ไม่มี
// ทางแตะไฟล์เหล่านี้ได้ ไม่ว่าจะรู้ path หรือไม่ และ **ไม่ต้อง deploy rules**
//
// ─── ทำไมไม่เก็บ URL ไว้บนแถว ─────────────────────────────────────────────
// เอกสารตัวอื่น (voucher, ใบกำกับภาษี) เก็บ tokenised download URL ไว้ให้กดเปิด
// ได้เลย — URL แบบนั้น **ข้ามกฎ Storage โดยการออกแบบ** ใครถือลิงก์ก็เปิดได้
// ตลอดไป ซึ่งรับได้กับใบเสร็จของลูกค้าเจ้าของออเดอร์ แต่ไม่ใช่กับสำเนาบัตร
// ประชาชนของพนักงาน แฟ้มนี้จึงไม่มี URL อยู่ที่ไหนเลย: การเปิดไฟล์ต้องยิง
// callable ที่ผ่านด่านสิทธิ์ทุกครั้ง แล้วได้ bytes กลับมา (รูปเดียวกับ
// `adminHrDocumentPrint`)
// =============================================================================

const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);

// เพดานไฟล์ — callable ของ Firebase รับ payload ได้ราว 10 MB และ base64 พองขึ้น
// 4/3 เท่า เพดานดิบ 5 MB จึงกลายเป็น ~6.7 MB บนสาย ยังอยู่ใต้เพดานพร้อมที่ว่าง
// สำหรับฟิลด์อื่น **ตัวเลขนี้เป็นเพดานของ "ทางเดิน" ไม่ใช่ของ "ความจำเป็น"**
// ถ้าวันหนึ่งต้องรับสแกนหลายหน้าที่ใหญ่กว่านี้ ทางแก้คือ resumable upload ผ่าน
// signed URL ไม่ใช่การดัน base64 ให้ชนเพดาน
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// allowlist ของชนิดไฟล์ ไม่ใช่ `image/.*` — subtype ที่ประดิษฐ์เอง (image/svg+xml
// พา script มาด้วย) คือช่องที่ regex กว้างๆ เปิดทิ้งไว้ เหตุผลเดียวกับ
// `isImage()` ใน storage.rules ของอีกรีโป
const CONTENT_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

// ลูกจ้างที่เข้ารอบจ่ายเงินเดือน = ถูกหักภาษีแบบ ม.40(1) และอยู่ในประกันสังคม
// ม.33 · ฟรีแลนซ์เดินคนละเส้น (หัก ณ ที่จ่าย 3% ตอนถอน — ดู rider-wht.js)
const isPayrollEmployee = (e) =>
  ["monthly", "daily"].includes(str((e || {}).employment_type).toLowerCase());

/**
 * ชนิดเอกสารในแฟ้ม
 *
 * `required` = ฟังก์ชันที่ตอบว่า "คนนี้ต้องมีใบนี้ไหม" ไม่ใช่ค่าคงที่ เพราะ
 * ความจำเป็นขึ้นกับรูปแบบการจ้าง — ฟรีแลนซ์ไม่ได้อยู่ในมาตรา 33 จึงไม่มี
 * สปส.1-03 และไม่ถูกหักภาษีแบบเงินเดือนจึงไม่มี ล.ย.01 การขึ้นว่า "ขาด"
 * ให้เขากลายเป็นเช็คลิสต์ที่ไม่มีวันครบ ซึ่งสอนให้คนเลิกอ่านมันทั้งใบ
 */
const FILE_KINDS = {
  id_card: {
    label: "สำเนาบัตรประชาชน",
    required: () => true,
    note: "ใช้เป็นหลักฐานประกอบการจ่ายเงินและการยื่นภาษี",
  },
  house_registration: {
    label: "สำเนาทะเบียนบ้าน",
    required: () => true,
    note: null,
  },
  bank_book: {
    label: "หน้าสมุดบัญชีธนาคาร",
    required: () => true,
    note: "ต้องตรงกับเลขบัญชีที่กรอกไว้ในแฟ้มลับ",
  },
  signed_contract: {
    label: "สัญญาจ้างที่ลงนามแล้ว",
    required: () => true,
    // ระบบพิมพ์สัญญาออกได้ แต่ฉบับที่ **เซ็นกลับมา** เป็นคนละใบกับ PDF ที่เรา
    // สร้าง และเป็นใบเดียวที่ใช้ยันกันได้ตอนมีข้อพิพาท
    note: "คนละใบกับ PDF ที่ระบบออกให้ — ต้องเป็นฉบับที่ทั้งสองฝ่ายเซ็นแล้ว",
  },
  ly01: {
    label: "ล.ย.01 ใบแจ้งรายการลดหย่อน",
    required: (e) => isPayrollEmployee(e),
    note: "ใช้คำนวณภาษีหัก ณ ที่จ่ายให้ถูกต้อง",
  },
  sso_1_03: {
    label: "สปส.1-03 ขึ้นทะเบียนผู้ประกันตน",
    required: (e) => isPayrollEmployee(e),
    note: "ต้องยื่นภายใน 30 วันนับแต่วันเริ่มงาน",
  },
  driver_license: {
    label: "ใบขับขี่",
    required: (e, ctx) => Boolean(ctx && ctx.hasRider),
    note: "จำเป็นเมื่อพนักงานคนนี้ผูกกับบัญชีไรเดอร์",
  },
  education: {
    label: "วุฒิการศึกษา",
    required: () => false,
    note: null,
  },
  photo: {
    label: "รูปถ่าย",
    required: () => false,
    note: null,
  },
  other: {
    label: "เอกสารอื่น",
    required: () => false,
    note: null,
  },
};

/**
 * เช็คลิสต์ของคนหนึ่งคน — "มีอะไรแล้ว ขาดอะไร"
 *
 * **`photo` ถือว่ามีได้จากสองทาง** เพราะทะเบียนมีช่อง `photo_url` มาก่อนแฟ้มนี้
 * และมันเป็นรูปเดียวกัน การรายงานว่า "ขาดรูปถ่าย" ให้คนที่มีรูปอยู่แล้วคือ
 * เช็คลิสต์ที่พูดไม่ตรงความจริง (กฎเดียวกับที่ไทม์ไลน์ยึด: fallback ต้องจริงเสมอ)
 */
function checklistFor({ employee, files, hasRider = false } = {}) {
  const emp = employee || {};
  const rows = Array.isArray(files) ? files : [];
  const ctx = { hasRider: Boolean(hasRider) };

  const countByKind = new Map();
  for (const f of rows) {
    const k = str((f || {}).kind, 40);
    if (!k) continue;
    countByKind.set(k, (countByKind.get(k) || 0) + 1);
  }

  return Object.entries(FILE_KINDS).map(([kind, meta]) => {
    let count = countByKind.get(kind) || 0;
    if (kind === "photo" && count === 0 && str(emp.photo_url)) count = 1;
    const required = Boolean(meta.required(emp, ctx));
    return {
      kind,
      label: meta.label,
      note: meta.note || null,
      required,
      count,
      missing: required && count === 0,
    };
  });
}

/** ชนิดที่ยัง "ขาด" — สิ่งที่หน้าเว็บเอาไปขึ้นเป็นป้ายเตือนบนแถวพนักงาน */
const missingKinds = (args) => checklistFor(args).filter((r) => r.missing).map((r) => r.kind);

/**
 * ชื่อไฟล์ที่ปลอดภัยพอจะส่งกลับไปให้เบราว์เซอร์ save
 *
 * ชื่อมาจากเครื่องของคนอัปโหลด — path separator, `..` และอักขระควบคุมต้องหลุด
 * ออกไปก่อน **ชื่อนี้ไม่ได้ถูกใช้เป็น path ใน Storage** (path ใช้ id ที่เราออก
 * เอง) มันเป็นแค่ชื่อที่โชว์และชื่อตอนดาวน์โหลด แต่การปล่อยให้ชื่อพา `../`
 * เดินทางไปถึงตัวเรียกที่ยังไม่มีในวันนี้ คือการฝากความปลอดภัยไว้กับคนอ่านรอบหน้า
 */
function safeFilename(name, ext) {
  const cleaned = str(name, 120)
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+/, "")
    .trim();
  if (!cleaned) return `document.${ext}`;
  return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
}

/**
 * ตรวจไฟล์ที่ถูกส่งขึ้นมา
 *
 * คืน `{ error }` เมื่อไม่ผ่าน ไม่ throw — ตัวเรียกเป็นคนแปลงเป็น HttpsError
 * เพื่อให้เทสเรียกได้โดยไม่ต้องมี firebase-functions
 *
 * **ขนาดตรวจจาก bytes ที่ decode แล้ว ไม่ใช่ความยาวสตริง** — base64 ยาวกว่า
 * ของจริง 4/3 เท่า การเทียบความยาวสตริงกับเพดานจะปฏิเสธไฟล์ที่ยังไม่ถึงเพดาน
 * จริงประมาณหนึ่งในสี่ของช่วง
 */
function validateUpload({ kind, filename, contentType, base64 } = {}) {
  const k = str(kind, 40);
  if (!Object.prototype.hasOwnProperty.call(FILE_KINDS, k)) {
    return { error: "ชนิดเอกสารไม่ถูกต้อง" };
  }

  const ct = str(contentType, 100).toLowerCase();
  const ext = CONTENT_TYPES[ct];
  if (!ext) {
    return { error: "รองรับเฉพาะไฟล์ PDF และรูปภาพ (jpeg, png, webp, heic, heif)" };
  }

  const raw = String(base64 == null ? "" : base64);
  if (!raw) return { error: "ไม่พบข้อมูลไฟล์" };
  let buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    return { error: "ไฟล์เสียหาย อ่านไม่ได้" };
  }
  if (!buffer.length) return { error: "ไฟล์ว่างเปล่า" };
  if (buffer.length > MAX_FILE_BYTES) {
    return { error: `ไฟล์ใหญ่เกิน ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB` };
  }

  return {
    kind: k,
    contentType: ct,
    ext,
    buffer,
    size: buffer.length,
    filename: safeFilename(filename, ext),
  };
}

/**
 * path ใน Storage
 *
 * ประกอบจาก id ที่ฝั่งเราออกเองทั้งคู่ **ไม่มีชิ้นไหนมาจากผู้ใช้** จึงไม่มีทาง
 * ที่ชื่อไฟล์แปลกๆ จะพาการเขียนออกนอกโฟลเดอร์ที่ตั้งใจ
 */
function fileStoragePath(employeeId, fileId, ext) {
  const e = str(employeeId, 60).replace(/[^A-Za-z0-9_-]/g, "");
  const f = str(fileId, 60).replace(/[^A-Za-z0-9_-]/g, "");
  const x = str(ext, 8).replace(/[^a-z0-9]/g, "");
  if (!e || !f || !x) return null;
  return `employee_files/${e}/${f}.${x}`;
}

module.exports = {
  FILE_KINDS, CONTENT_TYPES, MAX_FILE_BYTES,
  isPayrollEmployee, checklistFor, missingKinds,
  validateUpload, safeFilename, fileStoragePath,
};
