// =============================================================================
// Audit log — callable สำหรับหน้าดู
//
// กติกาทั้งหมดอยู่ `audit-log.js` (ล้วน มีเทส) ไฟล์นี้ต่อสายกับ Firebase เท่านั้น
//
// **CEO เท่านั้น และแคบกว่า HR_ROLES โดยตั้งใจ** — audit log รวมค่าเก่า→ค่าใหม่
// ของทุกฟิลด์ที่ระบบเฝ้าอยู่ (เงินเดือนทุกคน ทุกครั้งที่เคยขยับ) ซึ่งเป็นมุมมอง
// ที่กว้างกว่าการเปิดแฟ้มพนักงานทีละคนมาก คนที่ทำงาน HR ประจำวันไม่ต้องใช้มัน
//
// **อ่านอย่างเดียว ไม่มี callable ที่แก้หรือลบ** — append-only เป็นคุณสมบัติของ
// audit log ไม่ใช่ของที่ค่อยมาบังคับทีหลัง ถ้าวันหนึ่งต้องลบตามคำขอ PDPA
// ให้เขียนสคริปต์ที่ทิ้งร่องรอย ไม่ใช่เปิดปุ่มลบบนหน้าเว็บ
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");

const { requireStaffRole } = require("./staff-accounts");
const { AUDITED_ENTITIES, auditFieldMeta, AUDIT_ACTION_LABEL } = require("./audit-log");

const REGION = "asia-southeast1";
const str = (v, max = 80) => String(v == null ? "" : v).trim().slice(0, max);

/** คนที่เห็น audit log ได้ */
const AUDIT_READ_ROLES = ["CEO"];

/**
 * เพดานแถวต่อการเรียกหนึ่งครั้ง
 *
 * **ชนเพดานต้องบอกบนหน้า ไม่ตัดเงียบ** — audit log ที่ตัดท่อนต้นทิ้งโดยไม่บอก
 * คือ audit log ที่ตอบผิดเรื่อง "เปลี่ยนครั้งแรกเมื่อไหร่"
 */
const MAX_ROWS = 400;

/** เพดานจำนวน entity ที่ยอมไล่อ่านในโหมด "ทุกคน" */
const MAX_ENTITIES = 200;

/** ทะเบียนที่เป็นเจ้าของ id ของ entity นั้น (ไม่ใช่โหนด audit เอง) */
const REGISTRY_OF = { employee: "employees" };

function registerAuditLog() {
  // -------------------------------------------------------------------------
  // adminAuditLogList — แถว audit ของคนเดียว หรือของทั้ง entity type
  //
  // **โหมด "ทุกคน" อ่าน subtree ของแต่ละ entity แยกกัน ไม่กวาดโหนด `audit_log`**
  // (กฎค่า RTDB) — จำนวนคนในทะเบียนเป็นหลักสิบ ไม่ใช่หลักหมื่น ถ้าวันหนึ่งโต
  // จนตัวเลขนี้ไม่จริง ต้องเพิ่ม index แล้ว query ตามเวลา **ไม่ใช่ขยายเพดาน
  // ไปเรื่อยๆ** (index อยู่ในไฟล์กฎของอีกรีโป จึงเป็นงานที่ต้องตั้งใจทำ)
  // -------------------------------------------------------------------------
  const adminAuditLogList = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, AUDIT_READ_ROLES);

    const d = request.data || {};
    const entity = str(d.entity, 40) || "employee";
    if (!AUDITED_ENTITIES.includes(entity)) {
      throw new HttpsError("invalid-argument", "ชนิดข้อมูลไม่ถูกต้อง");
    }
    const entityId = str(d.entityId, 80);
    const registry = REGISTRY_OF[entity] || null;

    // ชื่อคนสำหรับแสดงผล — มาจากทะเบียนของ entity เอง ไม่ได้เก็บซ้ำใน audit
    // (โหนด audit มี id ของคนที่ถูกลบไปแล้วได้ ซึ่งไม่มีชื่อให้แสดง — หน้าเว็บ
    // ต้องขึ้น id ดิบ ไม่ใช่ซ่อนแถวนั้นทิ้ง)
    const names = {};
    const ids = [];
    if (registry) {
      const snap = await db.ref(registry).once("value");
      snap.forEach((c) => {
        ids.push(c.key);
        const v = c.val() || {};
        names[c.key] = { name: v.name || null, employee_code: v.employee_code || null };
        return false;
      });
    }

    const rows = [];
    const readOne = async (id) => {
      const snap = await db.ref(`audit_log/${entity}/${id}`)
        .limitToLast(MAX_ROWS).once("value");
      snap.forEach((c) => {
        rows.push({ id: c.key, entity, entity_id: id, ...(c.val() || {}) });
        return false;
      });
    };

    let capped = false;
    if (entityId) {
      await readOne(entityId);
    } else {
      if (ids.length > MAX_ENTITIES) capped = true;
      await Promise.all(ids.slice(0, MAX_ENTITIES).map(readOne));
    }

    rows.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    if (rows.length > MAX_ROWS) capped = true;

    return {
      entity,
      rows: rows.slice(0, MAX_ROWS),
      capped,
      names,
      // ป้าย/ชนิดของฟิลด์มาจาก allowlist ฝั่ง server ที่เดียว — หน้าเว็บห้ามมี
      // ตารางป้ายของตัวเอง (ดู auditFieldMeta ใน audit-log.js)
      field_meta: auditFieldMeta(entity),
      action_labels: AUDIT_ACTION_LABEL,
      max_rows: MAX_ROWS,
      entities_scanned: entityId ? 1 : Math.min(ids.length, MAX_ENTITIES),
    };
  });

  return { adminAuditLogList };
}

module.exports = { registerAuditLog, AUDIT_READ_ROLES, MAX_ROWS, MAX_ENTITIES, REGISTRY_OF };
