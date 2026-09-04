// Audit log — ใครแก้อะไร จากค่าอะไรเป็นค่าอะไร เมื่อไหร่
//
// ─── ทำไมต้องมีแยกจาก "ประวัติพนักงาน" ─────────────────────────────────────
// ก่อนหน้านี้ `employee_events` ถูกใช้เป็นทั้งสองอย่างพร้อมกัน แล้วเลยทำได้
// ไม่ดีสักอย่าง อาการที่เห็นบนจอคือบรรทัด "ปรับเงินเดือน" ที่ต้องเขียนแก้ตัว
// ว่า *"ระบบไม่ได้บันทึกจำนวนเงินไว้ในประวัติ"* — ซึ่งมาจาก writer ที่เขียน
// `from: null, to: null` เพราะกลัวข้อมูลอ่อนไหวรั่วในโหนดที่คนอ่านได้กว้าง
//
// สองอย่างนี้ต้องการสิ่งตรงข้ามกัน:
//   - **audit log** ต้องมีค่าเก่า→ค่าใหม่ ไม่งั้นมันตอบคำถามเดียวที่มันมีไว้
//     ตอบไม่ได้ ("ใครเปลี่ยนเงินเดือนจาก 15,000 เป็น 20,000") · คนอ่านแคบ
//   - **ประวัติพนักงาน** เป็นเรื่องของ *คน* (ทำงานมากี่ปี เคยอยู่ตำแหน่งไหน)
//     ไม่ใช่รายการการแก้ฟิลด์ · คนอ่านกว้างกว่า
// การยัดไว้ที่เดียวแปลว่าต้องเลือกอย่างใดอย่างหนึ่ง แล้วเราเลือกผิดทั้งคู่
//
// ─── กฎที่ไฟล์นี้ถือไว้ ────────────────────────────────────────────────────
// 1. **allowlist ของฟิลด์ต่อ entity** — ฟิลด์ที่ไม่อยู่ในลิสต์ถูกบันทึกว่า
//    "เปลี่ยน" **โดยไม่เก็บค่า** นี่คือ fail-safe: ฟิลด์อ่อนไหวที่ใครเพิ่ม
//    เข้ามาวันหน้าจะไม่ไหลลง audit เองโดยไม่มีใครตัดสินใจ (หลักเดียวกับ
//    `PUBLIC_TRACK_FIELDS`)
// 2. **ตัวระบุตัวบุคคลถูก mask เสมอ** (เลขบัตร เลขบัญชี เบอร์) — audit ตอบว่า
//    "เปลี่ยนจาก ****1234 เป็น ****5678" ได้ครบหน้าที่โดยไม่ต้องเก็บเลขเต็ม
//    ตัวที่ **ไม่** mask คือข้อเท็จจริงทางธุรกิจ (เงินเดือน ตำแหน่ง สถานะ)
//    เพราะนั่นคือสิ่งที่ทั้งระบบมีไว้ตรวจ
// 3. **ไม่มีอะไรเปลี่ยน = ไม่เขียนแถว** — แถวที่บอกว่าไม่มีอะไรเกิดขึ้นคือ
//    ขยะที่กลบแถวจริง
// 4. **append-only** — ไม่มีเส้นทางแก้หรือลบใน callable ใดๆ ทั้งสิ้น
// 5. เก็บซ้อน `audit_log/{entity}/{entityId}/{pushId}` — อ่านของชิ้นเดียวคือ
//    อ่าน subtree เล็กๆ **ไม่ต้องมี `.indexOn`** ซึ่งอยู่ในไฟล์กฎของอีกรีโป
//    (และเป็นหนี้ที่ `employee_events` ติดอยู่ทุกวันนี้)

"use strict";

const str = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);

/**
 * ฟิลด์ที่เก็บค่าได้ต่อ entity
 *
 * `mask: true` = เก็บรูปที่ระบุตัวไม่ได้ · ไม่มีในลิสต์ = บันทึกว่าเปลี่ยน
 * แต่ไม่เก็บค่า
 */
const AUDIT_FIELDS = {
  employee: {
    name: {},
    title: {},
    first_name: {},
    last_name: {},
    position: {},
    department: {},
    status: {},
    employment_type: {},
    hired_at: { kind: "date" },
    terminated_at: { kind: "date" },
    employee_code: {},
    // ข้อเท็จจริงทางธุรกิจ — เก็บเต็ม เพราะนี่คือสิ่งที่ audit มีไว้ตรวจ
    base_salary: { kind: "money" },
    daily_rate: { kind: "money" },
    pay_method: {},
    supervisor_id: {},
    // ตัวระบุตัวบุคคล — mask เสมอ
    national_id: { mask: true },
    bank_account_no: { mask: true },
    phone: { mask: true },
    email: { mask: true },
  },
  leave_request: {
    status: {},
    type: {},
    from: { kind: "date" },
    to: { kind: "date" },
    days: {},
    paid_days: {},
    unpaid_days: {},
  },
  settings: {
    // ค่าตั้งระบบเป็นตัวเลข/สวิตช์ล้วน เก็บเต็มได้
    value: {},
  },
};

const AUDITED_ENTITIES = Object.keys(AUDIT_FIELDS);

/**
 * สารบัญ action ของ audit — **คนละชุดกับ `EMPLOYEE_EVENT_ACTIONS`**
 *
 * ไทม์ไลน์การจ้างพูดภาษาของ HR (`hired` / `promoted` / `resigned`)
 * ส่วน audit พูดภาษาของการแก้ข้อมูล (`created` / `updated` / `deleted`)
 * — สองคำศัพท์นี้ห้ามยุบรวมกัน แต่ **ทั้งคู่ต้องมีสารบัญ** เพราะสารบัญที่ไม่
 * ตรงกับความจริงแย่กว่าไม่มีสารบัญ (เหตุผลเดียวกับที่ hr-files.test.mjs
 * สแกนซอร์สมาเทียบ)
 */
const AUDIT_ACTIONS = [
  "created", "updated", "deleted",
  "account_issued", "account_revoked",
];

/** ค่าที่บันทึกไม่ได้ให้เป็น `null` ไม่ใช่ `"undefined"` (สตริงนั้นอ่านเหมือนค่าจริง) */
function normalizeValue(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return str(v, 200);
}

/**
 * ปิดบังค่าที่ระบุตัวบุคคลได้ โดยยังเทียบ "เปลี่ยนหรือไม่" ได้อยู่
 *
 * เก็บ 4 ตัวท้าย — พอให้คนตรวจจับคู่กับเอกสารที่ถืออยู่ได้ แต่ไม่พอให้เอา
 * ตัวเลขไปใช้ทำอย่างอื่น
 */
function maskAuditValue(v) {
  const s = str(v, 200);
  if (!s) return null;
  if (s.length <= 4) return "****";
  return `****${s.slice(-4)}`;
}

/** ค่าที่จะถูกเก็บจริงสำหรับฟิลด์นั้น */
function auditValueFor(entity, field, raw) {
  const spec = (AUDIT_FIELDS[entity] || {})[field];
  // ไม่อยู่ใน allowlist = รู้ว่าเปลี่ยน แต่ไม่เก็บค่า (fail-safe)
  if (!spec) return { value: null, withheld: true };
  if (spec.mask) return { value: maskAuditValue(raw), withheld: false };
  return { value: normalizeValue(raw), withheld: false };
}

/** ค่าสองตัวถือว่าต่างกันไหม — เทียบหลัง normalize เพื่อไม่ให้ `""` กับ `null` นับเป็นการเปลี่ยน */
function changed(a, b) {
  return JSON.stringify(normalizeValue(a)) !== JSON.stringify(normalizeValue(b));
}

/**
 * หาว่าเปลี่ยนอะไรบ้าง
 *
 * เดินตาม `fields` ที่ผู้เรียกประกาศ ไม่ใช่ตาม key ที่บังเอิญมีใน object —
 * ไม่งั้นฟิลด์ที่ระบบเขียนเองทุกครั้ง (`updated_at`) จะกลายเป็น "การเปลี่ยนแปลง"
 * ทุกแถว แล้ว audit จะเต็มไปด้วยแถวที่ไม่มีใครสั่ง
 */
function diffFields({ entity, before, after, fields }) {
  const b = before || {};
  const a = after || {};
  const list = Array.isArray(fields) ? fields : [];
  const out = [];
  for (const f of list) {
    const name = str(f, 60);
    if (!name) continue;
    if (!changed(b[name], a[name])) continue;
    const from = auditValueFor(entity, name, b[name]);
    const to = auditValueFor(entity, name, a[name]);
    out.push({
      field: name,
      from: from.value,
      to: to.value,
      ...(from.withheld || to.withheld ? { withheld: true } : {}),
    });
  }
  return out;
}

const MAX_CHANGES = 40;

/**
 * ประกอบแถว audit — คืน `null` เมื่อไม่มีอะไรต้องบันทึก
 *
 * `null` แปลว่า **ห้ามเขียน** ไม่ใช่ "เขียนแถวว่าง" (กฎข้อ 3 ในหัวไฟล์)
 */
function buildAuditEntry({ entity, entityId, action, actor, before, after, fields, reason, at }) {
  const ent = str(entity, 40);
  const id = str(entityId, 80);
  const act = str(action, 40);
  if (!ent || !id || !act) return null;

  const changes = diffFields({ entity: ent, before, after, fields }).slice(0, MAX_CHANGES);
  // action ที่ไม่ใช่การแก้ฟิลด์ (สร้าง/ลบ/ออกบัญชี) ยังต้องมีแถว แม้ diff ว่าง
  const isStateAction = act !== "updated";
  if (!changes.length && !isStateAction) return null;

  const a = actor || {};
  return {
    at: Number(at) || Date.now(),
    action: act,
    changes,
    reason: str(reason, 300) || null,
    actor_uid: str(a.uid, 80) || null,
    actor_name: str(a.name, 120) || null,
    actor_role: str(a.role, 40) || null,
  };
}

/** ที่อยู่ของแถว — ซ้อนใต้ entity เพื่อให้อ่านของชิ้นเดียวโดยไม่ต้องมี index */
function auditPath(entity, entityId) {
  const ent = str(entity, 40);
  const id = str(entityId, 80);
  if (!ent || !id) return null;
  return `audit_log/${ent}/${id}`;
}

module.exports = {
  AUDIT_FIELDS,
  AUDITED_ENTITIES,
  AUDIT_ACTIONS,
  MAX_CHANGES,
  normalizeValue,
  maskAuditValue,
  auditValueFor,
  changed,
  diffFields,
  buildAuditEntry,
  auditPath,
};
