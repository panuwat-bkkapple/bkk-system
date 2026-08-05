// =============================================================================
// Callable ที่หน้า /email-settings ใช้ดึง "รายการอีเมลทั้งหมดที่ระบบส่ง"
// พร้อมข้อความเริ่มต้นและตัวอย่างจริง
//
// ทำไมต้องเป็น callable แทนที่จะ hardcode รายการไว้ฝั่ง UI: เทมเพลตทั้งหมด
// อยู่ใน `email.js` (JS) ซึ่ง React (TS) import ไม่ได้ ถ้า copy รายการไปไว้
// ฝั่ง UI ก็จะกลายเป็น mirror ตัวที่ 3 ที่ลืม sync ได้ตามระเบียบของ repo นี้
// (ดูรายการ MIRROR ใน CLAUDE.md ว่ามันเจ็บแค่ไหน). ให้ server เป็นคนตอบว่า
// "ตอนนี้มีอีเมลอะไรบ้าง หน้าตาเป็นยังไง" แล้ว UI แค่ render ตามที่ได้มา —
// เพิ่มสถานะใหม่ใน STATUS_COPY แล้วหน้าตั้งค่าขึ้นให้เองโดยไม่ต้องแก้ UI
//
// ตัวอย่างถูก render จาก "งานสมมติ" ไม่ใช่งานจริง — หน้าตั้งค่าจึงไม่เปิด
// ข้อมูลลูกค้าคนไหนออกมา (PDPA) และดูได้ตลอดแม้ยังไม่มีออเดอร์ในระบบ
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getDatabase } = require("firebase-admin/database");
const { lookupStaffByAuth } = require("./sickw-core");
const {
  STATUS_COPY,
  statusEmailKey,
  buildCustomerReceivedEmail,
  buildAdminNewOrderEmail,
  buildCustomerStatusEmail,
  buildAdminStatusEmail,
  buildAdminPaidSummaryEmail,
} = require("./email");
const { LOCKED_COPY_KEYS } = require("./email-templates");

const REGION = "asia-southeast1";
// ตั้งค่าอีเมล = เรื่องบัญชี/เอกสาร จึงใช้สิทธิ์ชุดเดียวกับ /accounting-settings
const MANAGE_ROLES = ["CEO", "FINANCE"];
const SAMPLE_ADMIN_TO = "orders@example.com";

/** งานสมมติสำหรับ render ตัวอย่าง — ไม่มีข้อมูลลูกค้าจริง */
function sampleJob() {
  return {
    ref_no: "BKK-250805-0001",
    cust_name: "ตัวอย่าง ลูกค้า",
    cust_email: "customer@example.com",
    cust_phone: "0812345678",
    model: "iPhone 17 Pro 256GB",
    price: 32000,
    final_price: 32000,
    net_payout: 31800,
    pickup_fee: 200,
    receive_method: "Pickup",
    status: "New Lead",
    devices: [{ model: "iPhone 17 Pro 256GB", price: 32000 }],
    pickup_schedule: { type: "schedule", date: "2026-08-06", time: "12:00 - 14:00" },
    payment_info: { type: "bank", bank: "กสิกรไทย", account_name: "ตัวอย่าง ลูกค้า", account_number: "1234567890" },
    _accounting: { vat_registered: true, vat_rate: 0.07 },
  };
}

/** ปลอดภัยเสมอ — ตัวอย่างที่ build ไม่ผ่านต้องไม่ทำให้ทั้งหน้าพัง */
function safeBuild(fn) {
  try {
    return fn() || null;
  } catch (e) {
    console.warn("[emailTemplates] preview build failed:", e?.message || e);
    return null;
  }
}

function previewOf(msg) {
  if (!msg) return null;
  return {
    subject: msg.subject || "",
    heading: (msg.copy && msg.copy.heading) || "",
    intro: (msg.copy && msg.copy.intro) || "",
    html: msg.html || "",
    // ไม่มี `copy` = เทมเพลตนี้ประกอบข้อความจากโค้ดล้วน (เช่นใบสำคัญรับเงิน)
    // แก้ถ้อยคำจากหน้าตั้งค่าไม่ได้ ดูตัวอย่างได้อย่างเดียว
    editable: Boolean(msg.copy),
  };
}

/** รายการอีเมลทั้งหมดที่ระบบส่ง เรียงตามลำดับที่ลูกค้าเจอจริง */
function buildManifest() {
  const job = sampleJob();
  const items = [
    {
      key: "order_created",
      label: "ออเดอร์เข้าระบบ",
      note: "ส่งทันทีที่ลูกค้ายืนยันคำสั่งขาย (ทั้งลูกค้าเองและแอดมินสร้างให้)",
      customer: previewOf(safeBuild(() => buildCustomerReceivedEmail(job))),
      admin: previewOf(safeBuild(() => buildAdminNewOrderEmail(job, SAMPLE_ADMIN_TO))),
    },
  ];

  for (const status of Object.keys(STATUS_COPY)) {
    const key = statusEmailKey(status);
    const jobForStatus = { ...job, status };
    items.push({
      key,
      status,
      label: STATUS_COPY[status].adminLabel || status,
      locked: LOCKED_COPY_KEYS.has(key),
      customer: previewOf(safeBuild(() => buildCustomerStatusEmail(jobForStatus, status))),
      admin: previewOf(
        safeBuild(() =>
          status === "Paid"
            ? buildAdminPaidSummaryEmail(jobForStatus, null, SAMPLE_ADMIN_TO)
            : buildAdminStatusEmail(jobForStatus, status, SAMPLE_ADMIN_TO),
        ),
      ),
    });
  }
  return items;
}

function registerEmailTemplateAdmin() {
  const adminEmailTemplateList = onCall(
    { region: REGION, timeoutSeconds: 60 },
    async (request) => {
      if (!request.auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
      const db = getDatabase();
      const staff = (await lookupStaffByAuth(db, request.auth)) || {};
      const role = String(staff.role || "").toUpperCase();
      if (!MANAGE_ROLES.includes(role)) {
        throw new HttpsError("permission-denied", `เฉพาะ ${MANAGE_ROLES.join("/")} เท่านั้น`);
      }
      return {
        items: buildManifest(),
        // ตัวแปรที่ใช้ในข้อความได้ — ส่งมาจาก server เพื่อให้ช่องช่วยจำใน UI
        // ตรงกับตัวที่ renderPlaceholders รู้จักจริงเสมอ
        placeholders: ["ref", "name", "model", "payout", "brand", "method", "branch"],
        // env ที่ยังไม่ตั้ง = ต่อให้เปิดสวิตช์ก็ยังไม่มีเมลออก บอกให้ UI
        // เตือนได้ตรงจุดแทนที่จะให้แอดมินเปิดแล้วงงว่าทำไมเงียบ
        provider: {
          resend_key: Boolean(process.env.RESEND_API_KEY),
          email_from: Boolean(process.env.EMAIL_FROM),
          admin_inbox: Boolean(process.env.ORDER_NOTIFY_EMAIL),
        },
      };
    },
  );

  return { adminEmailTemplateList };
}

module.exports = { registerEmailTemplateAdmin, buildManifest };
