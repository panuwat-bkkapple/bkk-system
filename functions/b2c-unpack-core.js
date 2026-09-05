// b2c-unpack-core — ครึ่ง pure ของการแตกงาน B2C หลายเครื่อง (ไม่มี firebase)
//
// แยกออกจาก b2c-unpack.js เพราะเทสฝั่งแอดมิน (vitest ใน src/) require ไฟล์นี้มา
// เทียบ parity และ CI job "Admin app" **ไม่ติดตั้ง functions/node_modules** — ถ้า
// ไฟล์ที่ถูก require ดึง firebase-functions ตอนโหลด เทสจะล้มที่ "Cannot find
// module" ทั้งที่กติกาถูก (เคสเดียวกับ cartLimits.ts ของ bkk-frontend-next #950).
// ไฟล์นี้ require ได้เฉพาะโมดูลที่ pure เหมือนกัน: status-engine (ตาราง),
// status-vocab.generated, rider-fee-trigger, stock-child-types. เหตุผลของกติกา
// แต่ละข้ออยู่ที่หัว b2c-unpack.js
const { B2B_JOB_TYPES } = require("./status-engine");
const { JOB_STATUS, normalizeStatus } = require("./status-vocab.generated");
const { FEE_TRIGGER_CANONICAL } = require("./rider-fee-trigger");

const EVENT = "multi_device_unpacked";

// ชนิดของงานลูก — อยู่ที่ stock-child-types.js (ไม่มี dependency) MIRROR:
// src/utils/stockChildren.ts ซึ่งเทส stockChildren.test.ts อ่านผ่านไฟล์นี้มาเทียบ
const { STOCK_CHILD_TYPES, B2C_UNPACKED_TYPE, ACCESSORY_TYPE } = require("./stock-child-types");
const CHILD_TYPE = B2C_UNPACKED_TYPE;
const ACCESSORY_CHILD_TYPE = ACCESSORY_TYPE;

// สถานะที่แปลว่า "เครื่องถึงมือร้านและกำลังเข้าคิวคลัง" — **ชุดเดียวกับที่คิดค่ารอบ
// ไรเดอร์** (import ไม่ก๊อป: สองลิสต์ที่ตอบคำถามเดียวกันคือของที่ drift) และ
// from-list ของแถว engine มีเทสตรึงไว้ทั้งสองฝั่ง
const ENTRY_STATUSES = FEE_TRIGGER_CANONICAL;

const UNPACK_REASON = (n) =>
  `แตกงานหลายเครื่องเป็นงานลูก ${n} ใบเข้าคิว QC รายเครื่อง — ใบนี้ปิดในฐานะใบสั่งขาย (เงิน/เอกสารอยู่ที่นี่)`;

// ── pure halves ─────────────────────────────────────────────────────────────

/** RTDB คืน array เป็น object เมื่อ key ไม่ต่อเนื่อง — อ่านได้ทั้งสองรูป */
function listOf(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === "object") return Object.values(raw).filter(Boolean);
  return [];
}

function devicesOf(job) {
  return listOf(job && job.devices);
}

function canonicalOf(job) {
  return normalizeStatus(job && job.status, (job && job.receive_method) || null);
}

/** งานขายปลีกที่มีตั้งแต่สองเครื่องขึ้นไป — ไม่ใช่ล็อต B2B และไม่ใช่งานลูกอยู่แล้ว */
function isMultiDeviceRetailJob(job) {
  if (!job) return false;
  const type = job.type || null;
  if (B2B_JOB_TYPES.includes(type)) return false;
  if (STOCK_CHILD_TYPES.includes(type)) return false;
  return devicesOf(job).length >= 2;
}

/** สถานะปัจจุบัน (สะกดใดก็ได้) อยู่ในชุดเข้าคิวคลังไหม */
function isEntryStatus(status, receiveMethod) {
  const canonical = normalizeStatus(status, receiveMethod || null);
  return !!canonical && ENTRY_STATUSES.includes(canonical);
}

/** stamp ที่บอกว่ารอบก่อนเขียนลูกครบแล้ว */
function childrenWritten(job) {
  return !!(job && job.multi_unpack && job.multi_unpack.written === true);
}

/**
 * ทุกอย่างที่ต้องจริงก่อนจะแตะฐานข้อมูล — pure เพื่อให้เทสได้
 * คืน null = แตกได้, ไม่งั้น { code, message }
 */
function checkUnpackable(job) {
  if (!job) return { code: "not-found", message: "ไม่พบงานนี้" };
  if (!isMultiDeviceRetailJob(job)) {
    return { code: "failed-precondition", message: "งานนี้ไม่ใช่งานขายปลีกที่มีหลายเครื่อง" };
  }
  if (childrenWritten(job) && canonicalOf(job) === JOB_STATUS.COMPLETED) {
    return { code: "already-exists", message: "งานนี้แตกเป็นงานลูกเรียบร้อยแล้ว" };
  }
  if (!isEntryStatus(job.status, job.receive_method)) {
    return {
      code: "failed-precondition",
      message: "แตกเป็นงานลูกได้เมื่อเครื่องถึงร้านแล้ว (Pending QC / Sent To QC Lab / In Stock)",
    };
  }
  return null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ราคาของเครื่องหนึ่งใบ — ราคาหลังไรเดอร์ตรวจ (price) ก่อน แล้วค่อยราคาประเมิน */
function devicePrice(d) {
  return num(d && d.price) || num(d && d.estimated_price) || num(d && d.base_price);
}

/** ตัด undefined ทิ้ง — RTDB ปฏิเสธทั้ง multi-path ถ้ามี undefined แม้ตัวเดียว */
function defined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * หลักฐานว่าแม่จ่ายเงินแล้ว — paid_at ก่อน แล้วค่อยแถวไทม์ไลน์ (กติกาเดียวกับ
 * src/utils/paidTrail.ts) คืน timestamp หรือ null
 */
function paidEvidenceOf(job) {
  const paidAt = num(job && job.paid_at);
  if (paidAt > 0) return paidAt;
  const accepted = [JOB_STATUS.PAID, JOB_STATUS.WAITING_FOR_HANDOVER];
  const hit = listOf(job && job.qc_logs).find((l) => {
    const canonical = normalizeStatus(l && l.action, null);
    return !!canonical && accepted.includes(canonical);
  });
  if (!hit) return null;
  const ts = num(hit.timestamp);
  return ts > 0 ? ts : num(job && job.updated_at) || null;
}

/** sickw_check ของแม่ผูกกับ IMEI เดียว — ส่งต่อให้ลูกที่ IMEI ตรงเท่านั้น */
function sickwFor(job, imei) {
  const sc = job && job.sickw_check;
  const checked = sc && sc.last_check && sc.last_check.imei ? String(sc.last_check.imei).toUpperCase() : "";
  if (!checked || !imei || checked !== String(imei).toUpperCase()) return undefined;
  return sc;
}

/**
 * แถวงานลูกรายเครื่อง — pure, `keys` คือ push id ที่ผู้เรียกจองไว้
 * ลูกได้ทุกอย่างที่เป็น "ของเครื่อง" (ผลตรวจไรเดอร์ IMEI แบต รูป คำตอบลูกค้า)
 * และ **ไม่ได้** อะไรที่เป็น "ของออเดอร์" (uid เงิน คูปอง ที่อยู่)
 */
function buildDeviceChildren({ job, jobId, keys, now, by }) {
  const devices = devicesOf(job);
  const parentRef = job.ref_no || jobId;
  const paidAt = paidEvidenceOf(job);
  const updates = {};
  devices.forEach((d, index) => {
    const imei = String(d.device_imei || d.imei || "").trim().toUpperCase();
    const price = devicePrice(d);
    const trail = [];
    if (paidAt) {
      trail.push({
        action: JOB_STATUS.PAID,
        by: "System",
        timestamp: paidAt,
        details: `จ่ายเงินแล้วผ่านงานแม่ ${parentRef} (ยอดทั้งใบและหลักฐานการโอนอยู่ที่งานแม่)`,
      });
    }
    trail.push({
      action: "Device Unpacked",
      by,
      timestamp: now,
      details: `แตกจากงานแม่ ${parentRef} เครื่องที่ ${index + 1}/${devices.length} เข้าคิว QC (฿${price.toLocaleString()})`,
    });
    updates[`jobs/${keys[index]}`] = defined({
      ref_no: `${parentRef}-D${index + 1}`,
      type: CHILD_TYPE,
      model: d.model || job.model || "",
      model_id: d.model_id || "",
      variant: d.variant,
      capacity: d.capacity,
      color: d.color,
      imageUrl: d.imageUrl,
      // ราคาของเครื่องนี้ = ต้นทุนสต๊อก — Inventory/POS อ่าน final_price||price
      price,
      final_price: price,
      base_price: d.base_price != null ? num(d.base_price) : undefined,
      estimated_price: d.estimated_price != null ? num(d.estimated_price) : undefined,
      // reader เดิมของ QC/SickW อ่าน imei/serial ระดับงาน ส่วน device_* คือชื่อที่
      // ไรเดอร์เขียน — ให้ทั้งสองชื่อเพื่อไม่ต้องแก้ reader
      imei,
      serial: d.device_serial || "",
      device_imei: imei || undefined,
      device_serial: d.device_serial,
      device_model_number: d.device_model_number,
      battery_health_pct: d.battery_health_pct,
      battery_health: d.battery_health_pct,
      battery_cycle_count: d.battery_cycle_count,
      battery_unavailable: d.battery_unavailable,
      battery_photo: d.battery_photo,
      find_my_status: d.find_my_status,
      find_my_manual: d.find_my_manual,
      warranty_status: d.warranty_status,
      warranty_expires_at: d.warranty_expires_at,
      photos: Array.isArray(d.photos) ? d.photos : undefined,
      deductions: d.deductions,
      functional_check: d.functional_check,
      customer_conditions: d.customer_conditions,
      isNewDevice: d.isNewDevice,
      inspection_status: d.inspection_status,
      sickw_check: sickwFor(job, imei),
      status: JOB_STATUS.PENDING_QC,
      receive_method: job.receive_method || "",
      cust_name: job.cust_name || "",
      agent_name: job.agent_name || "Admin",
      parent_job_id: jobId,
      parent_ref_no: job.ref_no || "",
      device_index: index,
      created_at: now,
      updated_at: now,
      qc_logs: trail,
    });
  });
  return updates;
}

/**
 * แถวอุปกรณ์เสริม — MIRROR ของ buildAccessoryChildUpdates ใน
 * src/utils/accessoryItems.ts (ด่าน: accessoryUnpackParity.test.ts รันทั้งสอง
 * บน fixture เดียวกัน) ต้องมีที่นี่เพราะแม่ที่ถูกแตกจะปิดที่ Completed โดยไม่ผ่าน
 * ปุ่ม In Stock ที่ helper ฝั่งไคลเอนต์เกาะอยู่ — ถ้าไม่แตกที่นี่ Pencil/Keyboard
 * ที่ขายพ่วงจะไม่เข้าคลังเลย
 */
function buildAccessoryChildUpdates(job, keys, by, now) {
  const items = listOf(job && job.accessory_items);
  const updates = {};
  if (!job || !job.id || items.length === 0 || job.accessories_unpacked_at) return updates;
  const total = num(job.final_price) || num(job.price);
  const parentRef = job.ref_no || job.id;
  let accessoryTotal = 0;
  items.forEach((it, idx) => {
    const price = num(it.price);
    accessoryTotal += price;
    updates[`jobs/${keys[idx]}`] = {
      ref_no: `${parentRef}-A${idx + 1}`,
      type: ACCESSORY_CHILD_TYPE,
      model: it.model_name || "Accessory",
      model_id: it.model_id || "",
      price,
      final_price: price,
      serial: it.serial || "",
      parent_job_id: job.id,
      parent_ref_no: job.ref_no || "",
      cust_name: job.cust_name || "",
      receive_method: job.receive_method || "",
      status: JOB_STATUS.IN_STOCK,
      qc_date: now,
      created_at: now,
      updated_at: now,
      qc_logs: [
        {
          action: "Accessory Unpacked",
          by,
          timestamp: now,
          details: `แตกอุปกรณ์เสริมจากงานแม่ ${parentRef} เข้าสต๊อก (฿${price.toLocaleString()})`,
        },
      ],
    };
  });
  updates[`jobs/${job.id}/accessories_unpacked_at`] = now;
  updates[`jobs/${job.id}/stock_cost`] = Math.max(0, total - accessoryTotal);
  updates[`jobs/${job.id}/updated_at`] = now;
  return updates;
}

/** จำนวน key อุปกรณ์เสริมที่ต้องจอง — 0 เมื่อไม่มีหรือแตกไปแล้ว */
function accessoryKeyCount(job) {
  if (!job || job.accessories_unpacked_at) return 0;
  return listOf(job.accessory_items).length;
}

/**
 * multi-path ทั้งก้อนของขั้นที่ 2: ลูกรายเครื่อง + อุปกรณ์เสริม + written=true
 * `stamp` คือค่าที่ transaction ขั้นที่ 1 จองไว้ (ถือ key ทั้งหมด)
 */
function buildUnpackUpdates({ job, jobId, stamp, now, by }) {
  const withId = { ...job, id: jobId };
  const updates = {
    ...buildDeviceChildren({ job: withId, jobId, keys: stamp.child_ids, now, by }),
    ...buildAccessoryChildUpdates(withId, stamp.accessory_child_ids || [], by, now),
  };
  updates[`jobs/${jobId}/multi_unpack/written`] = true;
  updates[`jobs/${jobId}/multi_unpack/written_at`] = now;
  updates[`jobs/${jobId}/updated_at`] = now;
  return updates;
}

/** stamp ที่ transaction ขั้นที่ 1 เขียน — pure เพื่อเทสรูป */
function buildClaimStamp({ job, jobId, keys, accessoryKeys, now, by }) {
  const devices = devicesOf(job);
  const parentRef = job.ref_no || jobId;
  return {
    at: now,
    by,
    count: devices.length,
    child_ids: keys,
    child_refs: devices.map((_, i) => `${parentRef}-D${i + 1}`),
    ...(accessoryKeys.length > 0 ? { accessory_child_ids: accessoryKeys } : {}),
    written: false,
  };
}

module.exports = {
  CHILD_TYPE,
  STOCK_CHILD_TYPES,
  ENTRY_STATUSES,
  EVENT,
  UNPACK_REASON,
  devicesOf,
  isMultiDeviceRetailJob,
  isEntryStatus,
  childrenWritten,
  checkUnpackable,
  paidEvidenceOf,
  buildDeviceChildren,
  buildAccessoryChildUpdates,
  buildUnpackUpdates,
  buildClaimStamp,
  accessoryKeyCount,
};
