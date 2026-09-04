// =============================================================================
// Dealer Portal — ขายส่งยกล็อต + ประมูลแบบปิดซอง (sealed bid)
//
// Bounded context แยกจากโดเมนหลัก: node ใหม่ทั้งหมด (dealers, lots, lot_private,
// lot_bids, lot_audit, dealer_orders, settings/dealer) ปิด client write สนิทใน
// database rules (bkk-frontend-next/database.rules.json) — Admin SDK ในไฟล์นี้
// เป็นผู้เขียนคนเดียว. จุดสัมผัสโดเมนหลักมี 4 จุดเท่านั้น:
//   1. publish: อ่าน job รายตัว (เฉพาะ id ที่เลือก — ห้ามกวาด /jobs) → snapshot
//   2. publish/cancel/award: ล็อก/ปลดเครื่อง (status Reserved + lot_id)
//   3. markPaid: ตัดสต๊อก (status Sold + sold_channel 'dealer')
//   4. markPaid: เขียน /sales record → onSaleCreated เดิมออกใบกำกับภาษี + บัญชี
//
// SEALED BID — หัวใจกันทุจริต:
//   - lot_bids อ่าน/เขียนไม่ได้จาก client เลย (รวม admin) — ผ่าน callable เท่านั้น
//   - ตัวนับผู้เสนอ canonical อยู่ lot_private/{lotId}/bid_count (admin เห็น);
//     mirror ไป lots/{lotId}/bid_stats เฉพาะเมื่อ lot.show_bid_stats === true
//     (toggle กลยุทธ์ต่อ lot — ดีลเลอร์เห็น 5/30 เฉพาะเมื่อเปิด)
//   - เปิดซอง (unseal) ได้เฉพาะ CEO/MANAGER และเฉพาะหลังปิดรับ — ประทับ
//     unsealed_at/by + ลง lot_audit ตรวจย้อนได้เสมอ
//   - แก้ซองได้จนกว่าจะปิดรับ แต่ทุก revision ต่อท้าย history[] ลบไม่ได้
//   - lot_audit ไม่เก็บตัวตนดีลเลอร์ของ bid events (admin อ่าน audit ได้ก่อนเปิดซอง)
//
// ชื่อ function ทุกตัว prefix adminDealer* / dealer* — unique ระดับ project
// ({region}/{name} ชนกับ rider codebase = ทับกันเงียบๆ).
//
// Push ทุกตัวส่งผ่าน dispatchAdminPush (inject จาก index.js) ซึ่ง gate ด้วย
// shouldNotify อยู่แล้ว — data.type ของโดเมนนี้ (dealer_bid, dealer_lot,
// dealer_payment, dealer_order) ถูก map เข้า category "dealer" ใน
// notification-settings.js (+ mirror src/utils/notificationSettings.ts)
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueUpdated } = require("firebase-functions/v2/database");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const { sendEmail, esc, formatTHB } = require("./email");
const { buildQuotationPdf, buildCreditNotePdf } = require("./voucher-pdf");
const { sellableVerdict } = require("./dealer-sellable");

// ─── แบรนด์ฝั่งขายส่ง ────────────────────────────────────────────────────────
// BKK APPLE = แบรนด์ฝั่ง "รับซื้อ" (B2C) เท่านั้น — การเสนอขายส่งให้ดีลเลอร์ทำใน
// นามนิติบุคคลจดทะเบียนโดยตรง: บริษัท เก็ทโมบี้ จำกัด (GETMOBIE / getmobie.com)
// ทุก touchpoint ฝั่งดีลเลอร์ (portal, อีเมล, ใบเสนอราคา) ต้องเป็นแบรนด์นี้
// ห้ามหลุด BKK APPLE. อีเมลใช้ sender แยกได้ผ่าน env DEALER_EMAIL_FROM
// (เช่น "GETMOBIE <noreply@getmobie.com>" — ต้อง verify โดเมนใน Resend ก่อน)
// ไม่ตั้ง = fallback ไป EMAIL_FROM เดิม
const DEALER_BRAND = "GETMOBIE";
const DEALER_LEGAL_NAME = "บริษัท เก็ทโมบี้ จำกัด";
const dealerEmailFrom = () => process.env.DEALER_EMAIL_FROM || undefined;

// template อีเมลของโดเมน dealer — โครงเดียวกับ shell() ใน email.js แต่หัว/ท้าย
// เป็น GETMOBIE (จงใจไม่ reuse ตัวเดิมเพื่อไม่ให้แบรนด์ฝั่งรับซื้อรั่วมาฝั่งขายส่ง)
function dealerShell({ heading, intro, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans Thai',sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:#111827;padding:20px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">${esc(DEALER_BRAND)}</span>
          <span style="color:#93c5fd;font-size:11px;font-weight:700;letter-spacing:2px;margin-left:8px;">DEALER</span>
        </td></tr>
        <tr><td style="padding:32px 32px 8px;">
          <h1 style="margin:0 0 8px;font-size:20px;line-height:1.4;color:#111827;">${esc(heading)}</h1>
          ${intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">${intro}</p>` : ""}
        </td></tr>
        <tr><td style="padding:0 32px 24px;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 32px 28px;border-top:1px solid #eef0f3;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
            อีเมลฉบับนี้ส่งอัตโนมัติจากระบบ Dealer Portal ของ ${esc(DEALER_LEGAL_NAME)} (${esc(DEALER_BRAND)}) — กรุณาอย่าตอบกลับโดยตรง
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const REGION = "asia-southeast1";
const DEALER_TIERS = ["A", "B", "C"];
// MIRROR: label/ลำดับชั้น tier — sync กับ src/types/dealer.ts (TIER_META) และ
// dealer-portal/src/types.ts (TIER_LABEL). internal key ยังเป็น A/B/C เสมอ
const TIER_RANK = { A: 3, B: 2, C: 1 };
const TIER_LABEL = { A: "Gold", B: "Silver", C: "Bronze" };
const LOT_BID_MODES = ["whole_lot", "per_item", "both"];
// Lot lifecycle: draft → open → closed → awarding → awarded → completed | cancelled
// Order lifecycle: pending_payment → payment_review → paid → preparing → shipped
//                  → completed | cancelled  (enum แยกจาก job-statuses — ไม่ sync 3 repo)

const normEmail = (e) => String(e || "").trim().toLowerCase();
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const nowMs = () => Date.now();

// mirror ของ stockCost() ใน src/utils/accessoryItems.ts (functions import TS ไม่ได้)
const stockCostOf = (job) => {
  if (job && job.stock_cost != null) return Number(job.stock_cost) || 0;
  return Number(job?.final_price) || Number(job?.price) || 0;
};

const maskTail = (s) => {
  const v = String(s || "").trim();
  if (!v) return null;
  return v.length > 4 ? `••••${v.slice(-4)}` : v;
};

// mirror ของ bangkokYM ใน index.js (period เลขเอกสารอิงเวลาไทย)
function bangkokYM(now) {
  const d = new Date(now + 7 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return { yyyy, mm, ym: `${yyyy}${mm}` };
}

const portalBaseUrl = () =>
  (process.env.DEALER_PORTAL_BASE_URL || "https://app.getmobie.com").replace(/\/$/, "");

// ── auth gates ───────────────────────────────────────────────────────────────

// Generalized จาก requireCeoCaller (staff-accounts.js): จับคู่ด้วยอีเมลใน
// verified auth token (client ปลอมไม่ได้) → staff record ACTIVE → role ในลิสต์
async function requireStaffRole(db, auth, roles) {
  if (!auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const email = normEmail(auth.token && auth.token.email);
  if (!email) throw new HttpsError("permission-denied", "บัญชีที่ login ไม่มีอีเมล");
  const snap = await db.ref("staff").once("value");
  const staffMap = snap.exists() ? snap.val() : {};
  for (const [id, s] of Object.entries(staffMap)) {
    if (!s) continue;
    const status = String(s.status || "").toUpperCase();
    if (normEmail(s.email) === email && (status === "" || status === "ACTIVE")) {
      const role = String(s.role || "").toUpperCase();
      if (!roles.includes(role)) {
        throw new HttpsError("permission-denied", `ต้องเป็น ${roles.join("/")} เท่านั้น`);
      }
      return { callerStaffId: id, caller: s, callerRole: role, staffMap };
    }
  }
  throw new HttpsError("permission-denied", "ไม่พบข้อมูลพนักงานของบัญชีนี้");
}

// Team members: 1 ร้านมีได้หลายบัญชี login
//   - บัญชีร้านเดิม (dealers/{uid}) = OWNER โดยอัตโนมัติ ไม่ต้อง migrate
//   - สมาชิกที่เจ้าของร้านสร้าง = dealer_members/{uid} {company_id, member_role,
//     name, email, status} ชี้กลับไปที่ร้าน
//   - ซอง/ออเดอร์/สลิป ยัง key ด้วย id ร้าน (dealerUid = companyId) เหมือนเดิม —
//     กติกาประมูล "1 ร้าน 1 ซอง" ไม่เปลี่ยน แต่บันทึก memberUid/ชื่อคนทำทุกครั้ง
async function requireDealerCaller(db, auth) {
  if (!auth) throw new HttpsError("unauthenticated", "ต้องเข้าสู่ระบบ");
  const uid = auth.uid;

  const memberSnap = await db.ref(`dealer_members/${uid}`).once("value");
  const member = memberSnap.val();
  let companyId = uid;
  if (member) {
    if (String(member.status || "").toUpperCase() !== "ACTIVE") {
      throw new HttpsError("permission-denied", "บัญชีสมาชิกถูกระงับ — ติดต่อเจ้าของร้าน");
    }
    companyId = String(member.company_id || "");
    if (!companyId) throw new HttpsError("permission-denied", "บัญชีสมาชิกไม่ผูกกับร้าน");
  }

  const snap = await db.ref(`dealers/${companyId}`).once("value");
  const dealer = snap.val();
  if (!dealer) throw new HttpsError("permission-denied", "บัญชีนี้ไม่ได้ลงทะเบียนเป็นดีลเลอร์");
  if (String(dealer.status || "").toUpperCase() !== "ACTIVE") {
    throw new HttpsError("permission-denied", "บัญชีดีลเลอร์ถูกระงับ — ติดต่อเจ้าหน้าที่");
  }
  return {
    dealerUid: companyId, // id ของ "ร้าน" — ตัว key ของซอง/ออเดอร์ทั้งหมด
    memberUid: uid,
    member,
    memberRole: member ? String(member.member_role || "MEMBER").toUpperCase() : "OWNER",
    memberName: member ? member.name || member.email : dealer.contact_name || dealer.company_name,
    dealer,
  };
}

// ลำดับชั้นในร้าน: บัญชีหลักของร้าน (implicit OWNER) → OWNER/MANAGER → STAFF
//   - OWNER (รวมบัญชีหลัก): สร้าง/จัดการสมาชิกได้ทุก role + แก้ข้อมูลติดต่อร้าน
//   - MANAGER: สร้าง/จัดการได้เฉพาะ STAFF
//   - STAFF: ใช้งานปกติ (ดู lot, เสนอราคา, แนบสลิป) จัดการสมาชิกไม่ได้
const DEALER_MEMBER_ROLES = ["OWNER", "MANAGER", "STAFF"];

function canManageMemberRole(actorRole, targetRole) {
  if (actorRole === "OWNER") return true;
  if (actorRole === "MANAGER") return targetRole === "STAFF";
  return false;
}

// เฉพาะเจ้าของร้าน (บัญชีหลักของร้าน หรือ membership ที่ role OWNER)
async function requireDealerOwner(db, auth) {
  const ctx = await requireDealerCaller(db, auth);
  if (ctx.memberRole !== "OWNER") {
    throw new HttpsError("permission-denied", "เฉพาะเจ้าของร้านเท่านั้นที่ทำรายการนี้ได้");
  }
  return ctx;
}

// ผู้มีสิทธิ์จัดการสมาชิก (OWNER หรือ MANAGER)
async function requireDealerManager(db, auth) {
  const ctx = await requireDealerCaller(db, auth);
  if (!["OWNER", "MANAGER"].includes(ctx.memberRole)) {
    throw new HttpsError("permission-denied", "เฉพาะเจ้าของร้านหรือผู้จัดการเท่านั้นที่จัดการสมาชิกได้");
  }
  return ctx;
}

// อีเมลถูกใช้ในระบบไหนแล้วบ้าง (staff/dealer/member) — กันบัญชีชนกันข้ามระบบ
async function dealerEmailInUse(db, email) {
  const [staffSnap, dealersSnap, membersSnap] = await Promise.all([
    db.ref("staff").once("value"),
    db.ref("dealers").orderByChild("email").equalTo(email).once("value"),
    db.ref("dealer_members").orderByChild("email").equalTo(email).once("value"),
  ]);
  for (const s of Object.values(staffSnap.val() || {})) {
    if (s && normEmail(s.email) === email) return "staff";
  }
  if (dealersSnap.exists()) return "dealer";
  if (membersSnap.exists()) return "member";
  return null;
}

// ── document numbers / settings ──────────────────────────────────────────────

async function loadDealerSettings(db) {
  try {
    const snap = await db.ref("settings/dealer").once("value");
    return snap.val() || {};
  } catch (e) {
    console.error("[dealer] settings read failed:", e?.message || e);
    return {};
  }
}

// เลขเอกสารรัน reset รายเดือน — atomic transaction แบบเดียวกับ
// allocateTaxInvoiceNumber (index.js). kind: lot | quotation | order
async function allocateDealerNumber(db, kind, prefix, now) {
  const { ym } = bangkokYM(now);
  const ref = db.ref(`settings/dealer/${kind}_seq_by_period/${ym}`);
  const txn = await ref.transaction((cur) => (cur || 0) + 1);
  const seq = txn.snapshot.val() || 1;
  return `${prefix}${ym}-${String(seq).padStart(4, "0")}`;
}

// ── audit (append-only, เขียนโดย server เท่านั้น) ────────────────────────────
// bid events จงใจไม่เก็บตัวตนดีลเลอร์ — admin อ่าน lot_audit ได้ก่อนเปิดซอง
async function logLotAudit(db, lotId, event, detail) {
  try {
    await db.ref(`lot_audit/${lotId}`).push({
      at: nowMs(),
      event,
      ...(detail ? { detail } : {}),
    });
  } catch (e) {
    console.error(`[dealer] audit write failed ${lotId}/${event}:`, e?.message || e);
  }
}

// ── in-app notifications ของดีลเลอร์ (จอ Notification Center) ────────────────
// เขียนโดย server เท่านั้น — rules ไม่เปิด read/write ที่ dealer_notifications
// (client อ่าน/มาร์คอ่านผ่าน callable dealerListNotifications/MarkRead เพราะ
// สมาชิกทีม login ด้วย uid ตัวเอง ไม่ใช่ uid ร้าน — rule auth.uid==$uid ใช้ไม่ได้)
// cat = หมวด filter ใน UI: lot | result | payment | shipping
async function pushDealerNotification(db, dealerUid, notif) {
  if (!dealerUid) return;
  try {
    const ref = db.ref(`dealer_notifications/${dealerUid}`);
    await ref.push({ ...notif, created_at: nowMs(), read: false });
    // prune best-effort — push key เรียงตามเวลาอยู่แล้ว เกิน 60 ตัดเหลือ 50
    const snap = await ref.once("value");
    const keys = [];
    snap.forEach((c) => {
      keys.push(c.key);
    });
    if (keys.length > 60) {
      const updates = {};
      for (const k of keys.slice(0, keys.length - 50)) updates[k] = null;
      await ref.update(updates);
    }
  } catch (e) {
    console.error(`[dealer] notification write failed ${dealerUid}:`, e?.message || e);
  }
}

async function pushStatusLog(db, orderId, status, byName) {
  try {
    await db.ref(`dealer_orders/${orderId}/status_log`).push({
      status,
      at: nowMs(),
      ...(byName ? { by: byName } : {}),
    });
  } catch (e) {
    console.error(`[dealer] status_log failed ${orderId}:`, e?.message || e);
  }
}

// ── lot helpers ──────────────────────────────────────────────────────────────

// เลขสต๊อกฝั่งดีลเลอร์ (GM-XXXXXX) — regenerate ใหม่ ไม่ผูกกับ ref_no (OID) ของ
// ใบงานรับซื้อ B2C เพราะ OID โยงกลับไปหน้าบ้าน (tracking/อีเมลลูกค้า) ซึ่งเปิดเผย
// ราคาที่เรารับซื้อมาได้ — ทุกจุดที่ดีลเลอร์เห็นต้องเป็น stock_no เท่านั้น.
// ออกครั้งแรกตอน QC บันทึกผล (src/utils/qcStation.ts — MIRROR format กัน) และ
// backfill ที่นี่ตอน publish สำหรับเครื่องเก่าที่ QC ก่อนมีระบบนี้
const STOCK_NO_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ตัด 0/O/1/I/L กันอ่านสับสน
function generateStockNo() {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += STOCK_NO_ALPHABET[Math.floor(Math.random() * STOCK_NO_ALPHABET.length)];
  }
  return `GM-${s}`;
}

function lotItemSnapshot(job, askingPrice) {
  const asking =
    askingPrice != null
      ? Number(askingPrice) || null
      : Number(job.promo_price) || Number(job.selling_price) || null;

  // สเปก + ผลตรวจ QC (Diagnostic Report) ให้ดีลเลอร์ดูก่อนเสนอราคา —
  // เอาเฉพาะข้อมูลเครื่อง ห้ามมี PII/serial เต็ม/ผล SickW (PDPA)
  const qc = job.qc_details && typeof job.qc_details === "object" ? job.qc_details : {};
  const pickBool = (v) => (typeof v === "boolean" ? v : null);
  const checks = {};
  for (const k of [
    "screen_touch", "screen_display", "truetone", "faceid", "camera_front",
    "camera_rear", "speaker_mic", "wifi_bt", "buttons", "charging",
  ]) {
    const v = pickBool(qc[k]);
    if (v !== null) checks[k] = v;
  }
  const clean = {};
  for (const k of ["icloud_off", "find_my_off", "mdm_clear", "sim_unlocked"]) {
    const v = pickBool(qc[k]);
    if (v !== null) clean[k] = v;
  }
  const battery = job.battery_health ?? job.battery_health_pct ?? null;

  return {
    model: job.model || "-",
    // ดีลเลอร์เห็น stock_no (GM-xxx) เท่านั้น — ห้าม fallback ไป job.ref_no (OID
    // โยงถึงราคารับซื้อหน้าบ้านได้). publish การันตีว่า stock_no มีเสมอ (backfill)
    ref_no: job.stock_no || null,
    grade: job.grade || null,
    parts_condition: job.partsCondition || null,
    accessories: job.accessories || null,
    warranty_days: job.warranty_days != null ? Number(job.warranty_days) : null,
    serial_masked: maskTail(job.serial || job.imei),
    asking_price: asking,
    // Device Specifications
    color: job.color || null,
    capacity: job.capacity || null,
    model_code: job.model_code || null,
    battery_pct: battery != null ? Number(battery) : null,
    battery_cycles: job.battery_cycle_count != null ? Number(job.battery_cycle_count) : null,
    // Diagnostic Report (จากผลตรวจ QC จริง)
    qc_passed: typeof job.qc_passed === "boolean" ? job.qc_passed : null,
    qc_date: job.qc_date || null,
    qc_checks: Object.keys(checks).length > 0 ? checks : null,
    parts: qc.part_screen || qc.part_battery || qc.part_camera
      ? {
          screen: qc.part_screen || null,
          battery: qc.part_battery || null,
          camera: qc.part_camera || null,
        }
      : null,
    clean_status: Object.keys(clean).length > 0 ? clean : null,
    qc_notes: String(qc.notes || "").trim() || null,
    // รูปสภาพเครื่องให้ดีลเลอร์ดูก่อนเสนอราคา — ลำดับความสำคัญ:
    // 1) jobs/{id}/lot_photos (แอดมินจัดชุดเองผ่าน adminDealerLotItemPhotos)
    // 2) รูปจากขั้น QC Lab — job.qc_photos (QCStation "/qc-station") หรือ
    //    devices[0].photos (InternalQCModal "แนบรูปถ่ายอ้างอิง")
    //    — ถ่ายตอนเครื่องอยู่ในมือพนักงานพอดี ไม่ต้องอัปโหลดซ้ำตอนจัด lot
    // จงใจไม่ใช้รูป inspection ของไรเดอร์ (ถ่ายก่อนล้างเครื่อง จออาจติดข้อมูล
    // ส่วนตัวลูกค้า — PDPA)
    photos: (() => {
      if (Array.isArray(job.lot_photos) && job.lot_photos.length > 0) {
        return job.lot_photos.slice(0, 8);
      }
      if (Array.isArray(job.qc_photos) && job.qc_photos.length > 0) {
        return job.qc_photos.slice(0, 8);
      }
      const dev = Array.isArray(job.devices) && job.devices.length === 1 ? job.devices[0] : null;
      if (dev && Array.isArray(dev.photos) && dev.photos.length > 0) {
        return dev.photos.slice(0, 8);
      }
      return null;
    })(),
  };
}

// รับเฉพาะ URL รูปจาก Firebase Storage ของ project เรา (กันยัด URL ภายนอก)
function sanitizePhotoUrls(raw, max) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("https://firebasestorage.googleapis.com/"))
    .slice(0, max);
}

async function readLotJobs(db, itemIds) {
  const snaps = await Promise.all(itemIds.map((id) => db.ref(`jobs/${id}`).once("value")));
  const out = {};
  snaps.forEach((s, i) => {
    out[itemIds[i]] = s.val();
  });
  return out;
}

// ตรวจว่าเครื่องยังขายเข้า lot ได้ — เรียกทั้งตอน create (feedback เร็ว) และ
// ตอน publish (กันสถานะเปลี่ยนระหว่างที่ draft ค้างอยู่). กติกาอยู่ที่
// ./dealer-sellable.js (pure, normalize ทั้งสองสะกดของ Ready To Sell — ลิสต์
// literal เดิมปฏิเสธเครื่องที่ engine เขียนทุกใบ)
function assertJobSellable(jobId, job, lotId) {
  const blocked = sellableVerdict(jobId, job, lotId);
  if (blocked) throw new HttpsError(blocked.code, blocked.message);
}

function sanitizeVisibleTiers(raw) {
  const out = {};
  for (const t of DEALER_TIERS) {
    if (raw && raw[t] === true) out[t] = true;
  }
  if (Object.keys(out).length === 0) {
    throw new HttpsError("invalid-argument", "ต้องเลือก tier ที่มองเห็น lot อย่างน้อย 1 tier");
  }
  return out;
}

async function loadActiveDealers(db) {
  const snap = await db.ref("dealers").once("value");
  const map = snap.exists() ? snap.val() : {};
  return Object.entries(map)
    .filter(([, d]) => d && String(d.status || "").toUpperCase() === "ACTIVE")
    .map(([uid, d]) => ({ uid, ...d }));
}

const eligibleDealersOf = (dealers, visibleTiers) =>
  dealers.filter((d) => visibleTiers[String(d.tier || "").toUpperCase()] === true);

// นับซองใหม่จากจำนวน children จริง (กัน drift) แล้ว mirror ตาม toggle
async function refreshBidCount(db, lotId, showBidStats, eligibleCount) {
  const snap = await db.ref(`lot_bids/${lotId}`).once("value");
  const count = snap.exists() ? snap.numChildren() : 0;
  await db.ref(`lot_private/${lotId}/bid_count`).set(count);
  if (showBidStats) {
    await db.ref(`lots/${lotId}/bid_stats`).set({ bid_count: count });
  } else {
    await db.ref(`lots/${lotId}/bid_stats`).remove();
  }
  return { count, eligibleCount };
}

// ── email templates (โครง shell เดียวกับอีเมลลูกค้า) ─────────────────────────

function lotItemsTable(items) {
  const rows = Object.values(items || {})
    .map(
      (it) => `<tr>
        <td style="padding:6px 0;font-size:14px;color:#374151;">${esc(it.model)}${it.grade ? ` <span style="color:#6b7280;">(เกรด ${esc(it.grade)})</span>` : ""}</td>
        <td style="padding:6px 0;font-size:14px;color:#374151;text-align:right;white-space:nowrap;">${it.asking_price != null ? esc(formatTHB(it.asking_price)) : "-"}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:8px 16px;"><tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr></table>`;
}

function buildLotOpenEmail(lot) {
  const closeAt = lot.close_at
    ? new Date(lot.close_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })
    : "-";
  return {
    subject: `เปิดประมูลล็อตใหม่ ${lot.lot_no} — ${lot.title || ""}`,
    html: dealerShell({
      heading: `เปิดรับเสนอราคา ${esc(lot.lot_no)}`,
      intro: `${esc(lot.title || "")} จำนวน ${lot.item_count} เครื่อง · ปิดรับราคา ${esc(closeAt)}`,
      bodyHtml:
        lotItemsTable(lot.items) +
        `<div style="text-align:center;margin-top:20px;">
          <a href="${portalBaseUrl()}/lots/${esc(lot.id)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">ดูรายละเอียดและเสนอราคา</a>
        </div>`,
      footerNote: "การเสนอราคาเป็นแบบปิดซอง — ไม่มีผู้ใดเห็นราคาของท่านจนกว่าจะปิดรับและเปิดซองโดยผู้มีอำนาจ",
    }),
  };
}

function buildAwardEmail(order, lot, paymentInfo) {
  const pay = paymentInfo && paymentInfo.account_no
    ? `<p style="margin:16px 0 0;font-size:14px;color:#374151;">ช่องทางชำระเงิน: <strong>${esc(paymentInfo.bank || "")} ${esc(paymentInfo.account_no)}</strong> (${esc(paymentInfo.account_name || "")})</p>`
    : "";
  return {
    subject: `คุณได้รับเลือกใน ${lot.lot_no} — ใบเสนอราคา ${order.quotation.number}`,
    html: dealerShell({
      heading: "ยินดีด้วย — ข้อเสนอของคุณได้รับการอนุมัติ",
      intro: `ล็อต ${esc(lot.lot_no)} · คำสั่งซื้อ ${esc(order.order_no)} · ยอดรวม <strong>${esc(formatTHB(order.amount))}</strong> (รวม VAT)`,
      bodyHtml:
        `<p style="margin:0 0 12px;font-size:14px;color:#374151;">แนบใบเสนอราคาเลขที่ ${esc(order.quotation.number)} มาพร้อมอีเมลฉบับนี้ กรุณาชำระเงินและแนบหลักฐานผ่านระบบ</p>` +
        pay +
        `<div style="text-align:center;margin-top:20px;">
          <a href="${portalBaseUrl()}/orders/${esc(order.id)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">ดูคำสั่งซื้อ / แนบสลิป</a>
        </div>`,
    }),
  };
}

function buildLoseEmail(lot) {
  return {
    subject: `ผลการเสนอราคา ${lot.lot_no}`,
    html: dealerShell({
      heading: `ล็อต ${esc(lot.lot_no)} ปิดการขายแล้ว`,
      intro: "ขอบคุณที่ร่วมเสนอราคา — ครั้งนี้ข้อเสนอของท่านไม่ได้รับเลือก แล้วพบกันในล็อตถัดไป",
      bodyHtml: `<div style="text-align:center;margin-top:8px;">
        <a href="${portalBaseUrl()}" style="display:inline-block;background:#111827;color:#ffffff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">ดูล็อตที่เปิดอยู่</a>
      </div>`,
    }),
  };
}

// milestone → อีเมลดีลเลอร์ (allowlist แบบ STATUS_COPY — สถานะที่ไม่อยู่ = ไม่ส่ง)
const ORDER_STATUS_COPY = {
  paid: {
    heading: "ยืนยันรับชำระเงินแล้ว",
    intro: (o) => `คำสั่งซื้อ ${esc(o.order_no)} ยอด ${esc(formatTHB(o.amount))} — กำลังเตรียมสินค้าเพื่อจัดส่ง ใบกำกับภาษีจะส่งตามในอีเมลถัดไป`,
  },
  shipped: {
    heading: "จัดส่งสินค้าแล้ว",
    intro: (o) =>
      `คำสั่งซื้อ ${esc(o.order_no)} จัดส่งแล้ว${o.shipping && o.shipping.tracking_no ? ` · เลขติดตาม <strong>${esc(o.shipping.tracking_no)}</strong>${o.shipping.method ? ` (${esc(o.shipping.method)})` : ""}` : ""}`,
  },
  completed: {
    heading: "คำสั่งซื้อเสร็จสมบูรณ์",
    intro: (o) => `คำสั่งซื้อ ${esc(o.order_no)} ปิดงานเรียบร้อย — ขอบคุณที่ทำธุรกิจกับเรา`,
  },
  cancelled: {
    heading: "คำสั่งซื้อถูกยกเลิก",
    intro: (o) => `คำสั่งซื้อ ${esc(o.order_no)} ถูกยกเลิก หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่`,
  },
};

// ── storage ──────────────────────────────────────────────────────────────────

async function archivePdf(storagePath, pdfBuffer, tokenSeed) {
  const token = `${tokenSeed}-${Date.now()}`;
  const bucket = getStorage().bucket();
  await bucket.file(storagePath).save(pdfBuffer, {
    contentType: "application/pdf",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

// =============================================================================
// registerDealerPortal — index.js เรียกแล้ว spread เข้า exports
// deps: { dispatchAdminPush, dispatchTelegram, staffIdsByRoles } (helper กลาง
// ใน index.js — inject เพื่อเลี่ยง circular require และให้ gate/prune token
// ทำงานที่เดียว)
// =============================================================================
function registerDealerPortal({ dispatchAdminPush, dispatchTelegram, staffIdsByRoles }) {
  const fns = {};

  // ระบบ "แนะนำ" อัปเกรด tier จากยอดซื้อ — ระบบไม่เปลี่ยน tier เอง แค่เขียน
  // dealers/{uid}/tier_suggestion + push CEO/MANAGER แล้วให้แอดมินกดยืนยันที่ /dealers.
  // เกณฑ์ต่อ tier (settings/dealer/tiers/{t}): ผ่านอย่างใดอย่างหนึ่ง =
  //   min_order_amount (ยอดออเดอร์เดียว) หรือ min_monthly_amount (ยอดสะสมเดือนไทย)
  // ไม่มี auto-downgrade — เกณฑ์ไม่ถึงก็แค่ไม่แนะนำ
  async function maybeSuggestTierUpgrade(db, order, monthTotal) {
    try {
      const uid = order.dealer_uid;
      if (!uid) return;
      const dealer = (await db.ref(`dealers/${uid}`).once("value")).val();
      if (!dealer) return;
      const currentRank = TIER_RANK[dealer.tier] || 0;
      const tiers = (await loadDealerSettings(db)).tiers || {};
      const orderAmt = Number(order.amount) || 0;

      let best = null;
      let bestReason = null;
      for (const t of DEALER_TIERS) {
        if ((TIER_RANK[t] || 0) <= currentRank) continue;
        const cfg = tiers[t] || {};
        const perOrder = Number(cfg.min_order_amount) || 0;
        const perMonth = Number(cfg.min_monthly_amount) || 0;
        const byOrder = perOrder > 0 && orderAmt >= perOrder;
        const byMonth = perMonth > 0 && monthTotal >= perMonth;
        if (!byOrder && !byMonth) continue;
        if (!best || TIER_RANK[t] > TIER_RANK[best]) {
          best = t;
          bestReason = byMonth && !byOrder ? "monthly" : "order";
        }
      }
      if (!best) return;
      // มีข้อเสนอเดิมที่สูงเท่ากันหรือกว่าอยู่แล้ว = ไม่เขียนซ้ำ (กัน push รัว)
      const prev = dealer.tier_suggestion;
      if (prev && prev.suggest && (TIER_RANK[prev.suggest] || 0) >= TIER_RANK[best]) return;

      await db.ref(`dealers/${uid}/tier_suggestion`).set({
        suggest: best,
        from: dealer.tier || null,
        reason: bestReason,
        order_no: order.order_no || null,
        order_amount: orderAmt,
        month_total: monthTotal,
        at: nowMs(),
      });
      const label = TIER_LABEL[best] || best;
      const targets = await staffIdsByRoles(db, ["CEO", "MANAGER"]);
      await dispatchAdminPush(
        {
          data: {
            type: "dealer_tier",
            title: `แนะนำอัปเกรดดีลเลอร์เป็น ${label}`,
            body: `${dealer.company_name || "ดีลเลอร์"} ${
              bestReason === "monthly"
                ? `ยอดสะสมเดือนนี้ ${monthTotal.toLocaleString()} บาท`
                : `ออเดอร์ ${order.order_no || ""} ยอด ${orderAmt.toLocaleString()} บาท`
            } ถึงเกณฑ์ ${label} — กดยืนยันที่หน้า Dealers`,
            url: `/dealers`,
          },
        },
        "dealerTierSuggest",
        "admin",
        targets
      );
    } catch (e) {
      // best-effort — markPaid สำเร็จไปแล้ว อย่าให้การแนะนำ tier ทำให้ callable ล้ม
      console.error("[dealer] tier suggestion failed:", e?.message || e);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // วงจรบัญชีดีลเลอร์ (CEO/MANAGER) — โครงเดียวกับ staff-accounts.js
  // ดีลเลอร์มี Firebase Auth ของตัวเอง แต่ "ไม่มี" /admins/{uid} (ไม่ใช่แอดมิน)
  // ───────────────────────────────────────────────────────────────────────────

  fns.adminDealerCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};

    const email = normEmail(data.email);
    if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "อีเมลไม่ถูกต้อง");
    if (typeof data.password !== "string" || data.password.length < 8) {
      throw new HttpsError("invalid-argument", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
    }
    const companyName = String(data.company_name || "").trim();
    if (!companyName) throw new HttpsError("invalid-argument", "ต้องระบุชื่อบริษัท/ร้านของดีลเลอร์");
    const tier = String(data.tier || "").toUpperCase();
    if (!DEALER_TIERS.includes(tier)) {
      throw new HttpsError("invalid-argument", `tier ต้องเป็นหนึ่งใน: ${DEALER_TIERS.join(", ")}`);
    }

    // อีเมลห้ามชนบัญชีระบบอื่น (staff/rider) และห้ามซ้ำดีลเลอร์เดิม
    const [staffSnap, dealersSnap] = await Promise.all([
      db.ref("staff").once("value"),
      db.ref("dealers").once("value"),
    ]);
    for (const s of Object.values(staffSnap.val() || {})) {
      if (s && normEmail(s.email) === email) {
        throw new HttpsError("already-exists", "อีเมลนี้เป็นบัญชีพนักงาน — ใช้กับดีลเลอร์ไม่ได้");
      }
    }
    for (const d of Object.values(dealersSnap.val() || {})) {
      if (d && normEmail(d.email) === email) {
        throw new HttpsError("already-exists", "อีเมลนี้ถูกใช้กับดีลเลอร์รายอื่นแล้ว");
      }
    }
    const memberDupSnap = await db
      .ref("dealer_members").orderByChild("email").equalTo(email).once("value");
    if (memberDupSnap.exists()) {
      throw new HttpsError("already-exists", "อีเมลนี้เป็นสมาชิกทีมของดีลเลอร์รายอื่นอยู่แล้ว");
    }

    let authUser = null;
    try {
      authUser = await getAuth().getUserByEmail(email);
    } catch (e) {
      if (!e || e.code !== "auth/user-not-found") {
        throw new HttpsError("internal", `ตรวจสอบบัญชี Auth ไม่สำเร็จ: ${e?.message || e}`);
      }
    }
    if (authUser) {
      const [riderSnap, adminSnap] = await Promise.all([
        db.ref(`riders/${authUser.uid}`).once("value"),
        db.ref(`admins/${authUser.uid}`).once("value"),
      ]);
      if (riderSnap.exists() || adminSnap.exists()) {
        throw new HttpsError("already-exists", "อีเมลนี้ผูกกับบัญชีระบบอื่นอยู่ — ใช้ไม่ได้");
      }
      await getAuth().updateUser(authUser.uid, {
        password: data.password,
        displayName: companyName,
        disabled: false,
      });
    } else {
      authUser = await getAuth().createUser({
        email,
        password: data.password,
        displayName: companyName,
      });
    }

    const record = {
      company_name: companyName,
      tax_id: String(data.tax_id || "").trim() || null,
      address: String(data.address || "").trim() || null,
      contact_name: String(data.contact_name || "").trim() || null,
      phone: String(data.phone || "").trim() || null,
      line_id: String(data.line_id || "").trim() || null,
      email,
      tier,
      status: "ACTIVE",
      created_at: nowMs(),
      created_by: caller.name || null,
      updated_at: nowMs(),
    };
    await db.ref(`dealers/${authUser.uid}`).set(record);

    // ออกบัญชีจากใบสมัครหน้า landing → ปิดใบสมัครเป็น approved
    const applicationId = String(data.applicationId || "");
    if (applicationId) {
      await db.ref(`dealer_applications/${applicationId}`).update({
        status: "approved",
        approved_at: nowMs(),
        approved_by: caller.name || null,
        dealer_uid: authUser.uid,
      });
    }
    console.log(`[dealer] created dealer ${email} (uid ${authUser.uid}) tier ${tier}`);
    return { ok: true, uid: authUser.uid };
  });

  fns.adminDealerUpdate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const uid = String(data.uid || "");
    const snap = await db.ref(`dealers/${uid}`).once("value");
    const existing = snap.val();
    if (!existing) throw new HttpsError("not-found", "ไม่พบดีลเลอร์");

    const patch = { updated_at: nowMs() };
    for (const f of ["company_name", "tax_id", "address", "contact_name", "phone", "line_id"]) {
      if (data[f] !== undefined) patch[f] = String(data[f] || "").trim() || null;
    }
    if (data.tier !== undefined) {
      const tier = String(data.tier || "").toUpperCase();
      if (!DEALER_TIERS.includes(tier)) throw new HttpsError("invalid-argument", "tier ไม่ถูกต้อง");
      patch.tier = tier;
      // เปลี่ยน tier (ยืนยันหรือปรับเอง) = ข้อเสนอแนะเดิมหมดหน้าที่
      patch.tier_suggestion = null;
    }
    // แอดมินปัดตกข้อเสนอแนะอัปเกรดโดยไม่เปลี่ยน tier
    if (data.clear_tier_suggestion === true) patch.tier_suggestion = null;
    if (data.email !== undefined) {
      const email = normEmail(data.email);
      if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "อีเมลไม่ถูกต้อง");
      if (email !== normEmail(existing.email)) {
        const dealersSnap = await db.ref("dealers").once("value");
        for (const [id, d] of Object.entries(dealersSnap.val() || {})) {
          if (id !== uid && d && normEmail(d.email) === email) {
            throw new HttpsError("already-exists", "อีเมลนี้ถูกใช้กับดีลเลอร์รายอื่นแล้ว");
          }
        }
        await getAuth().updateUser(uid, { email });
        patch.email = email;
      }
    }
    if (patch.company_name) {
      await getAuth().updateUser(uid, { displayName: patch.company_name });
    }
    await db.ref(`dealers/${uid}`).update(patch);
    return { ok: true };
  });

  // ระงับ = 3 ชั้นแบบ staff: disable auth + revoke tokens + client watcher เตะ
  // session สด (portal เฝ้า dealers/{uid}/status realtime)
  fns.adminDealerSetStatus = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const uid = String(data.uid || "");
    const status = String(data.status || "").toUpperCase();
    if (!["ACTIVE", "SUSPENDED"].includes(status)) {
      throw new HttpsError("invalid-argument", "status ต้องเป็น ACTIVE หรือ SUSPENDED");
    }
    const snap = await db.ref(`dealers/${uid}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบดีลเลอร์");

    if (status === "SUSPENDED") {
      await getAuth().updateUser(uid, { disabled: true });
      await getAuth().revokeRefreshTokens(uid);
      await db.ref(`dealers/${uid}`).update({
        status: "SUSPENDED",
        suspended_at: nowMs(),
        suspended_by: caller.name || null,
        updated_at: nowMs(),
      });
    } else {
      await getAuth().updateUser(uid, { disabled: false });
      await db.ref(`dealers/${uid}`).update({
        status: "ACTIVE",
        suspended_at: null,
        suspended_by: null,
        updated_at: nowMs(),
      });
    }
    console.log(`[dealer] set status ${status} for dealer ${uid}`);
    return { ok: true };
  });

  fns.adminDealerResetPassword = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const uid = String(data.uid || "");
    if (typeof data.password !== "string" || data.password.length < 8) {
      throw new HttpsError("invalid-argument", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
    }
    const snap = await db.ref(`dealers/${uid}`).once("value");
    if (!snap.exists()) throw new HttpsError("not-found", "ไม่พบดีลเลอร์");
    await getAuth().updateUser(uid, { password: data.password });
    await getAuth().revokeRefreshTokens(uid);
    return { ok: true };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // สมัครดีลเลอร์จากหน้า landing getmobie.com (ไม่ต้อง login)
  // ไม่สร้างบัญชี Auth ทันที — เก็บเป็นใบสมัครที่ dealer_applications (rules ปิด
  // read/write ฝั่ง client ยกเว้น admin read) ให้ CEO/MANAGER ตรวจแล้วออกบัญชี
  // ผ่าน adminDealerCreate (ส่ง applicationId มาปิดใบสมัคร) — แอดมินยังเป็นคน
  // คุม credential เหมือนเดิม และไม่มี auth user ค้างจาก bot/สมัครเล่น
  // ───────────────────────────────────────────────────────────────────────────
  fns.dealerRegister = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const data = request.data || {};

    // honeypot: ฟิลด์ 'website' ซ่อนอยู่ในฟอร์ม — คนจริงไม่เห็น/ไม่กรอก
    if (String(data.website || "").trim()) return { ok: true };

    const company = String(data.company_name || "").trim();
    const contact = String(data.contact_name || "").trim();
    const phone = String(data.phone || "").trim();
    const email = normEmail(data.email);
    if (!company || company.length > 200) {
      throw new HttpsError("invalid-argument", "กรุณาระบุชื่อบริษัท/ร้าน");
    }
    if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "อีเมลไม่ถูกต้อง");
    if (!phone || phone.length > 30) throw new HttpsError("invalid-argument", "กรุณาระบุเบอร์โทรติดต่อ");

    // กันซ้ำ: เป็นดีลเลอร์/สมาชิกทีมอยู่แล้ว / มีใบสมัครค้างอยู่แล้ว
    const dealersSnap = await db.ref("dealers").orderByChild("email").equalTo(email).once("value");
    if (dealersSnap.exists()) {
      throw new HttpsError("already-exists", "อีเมลนี้เป็นดีลเลอร์ในระบบแล้ว — เข้าสู่ระบบได้ที่ portal หรือติดต่อเจ้าหน้าที่");
    }
    const memberSnap = await db.ref("dealer_members").orderByChild("email").equalTo(email).once("value");
    if (memberSnap.exists()) {
      throw new HttpsError("already-exists", "อีเมลนี้เป็นสมาชิกทีมดีลเลอร์ในระบบแล้ว — เข้าสู่ระบบได้ที่ portal");
    }
    const appsSnap = await db.ref("dealer_applications").orderByChild("email").equalTo(email).once("value");
    if (appsSnap.exists()) {
      let hasPending = false;
      appsSnap.forEach((c) => {
        if ((c.val() || {}).status === "pending") hasPending = true;
      });
      if (hasPending) {
        throw new HttpsError("already-exists", "อีเมลนี้มีใบสมัครรอตรวจสอบอยู่แล้ว — เจ้าหน้าที่จะติดต่อกลับโดยเร็ว");
      }
    }

    // ปริมาณสั่งซื้อคาดการณ์/เดือน — allowlist ตามฟอร์ม landing (chip เลือกค่าเดียว)
    const MONTHLY_VOLUMES = ["<50", "50-200", "200+"];
    const monthlyVolume = MONTHLY_VOLUMES.includes(String(data.monthly_volume || "").trim())
      ? String(data.monthly_volume).trim()
      : null;

    // เลขอ้างอิงใบสมัคร REG-YYYYMM-#### (โชว์หน้ายืนยัน + การ์ดแอดมิน)
    const appNo = await allocateDealerNumber(db, "application", "REG-", nowMs());
    const appRef = db.ref("dealer_applications").push();
    await appRef.set({
      app_no: appNo,
      company_name: company.slice(0, 200),
      tax_id: String(data.tax_id || "").trim().slice(0, 20) || null,
      address: String(data.address || "").trim().slice(0, 500) || null,
      contact_name: contact.slice(0, 100) || null,
      phone: phone.slice(0, 30),
      line_id: String(data.line_id || "").trim().slice(0, 100) || null,
      email,
      monthly_volume: monthlyVolume,
      note: String(data.note || "").trim().slice(0, 1000) || null,
      status: "pending",
      created_at: nowMs(),
    });

    // แจ้งแอดมิน (CEO/MANAGER) + Telegram, และอีเมลยืนยันไปหาผู้สมัคร — best-effort
    try {
      const targets = await staffIdsByRoles(db, ["CEO", "MANAGER"]);
      await dispatchAdminPush(
        {
          data: {
            type: "dealer_register",
            title: "ใบสมัครดีลเลอร์ใหม่",
            body: `${company} (${contact || phone}) — รอตรวจสอบ`,
            url: "/dealers",
          },
        },
        "dealerRegister",
        "admin",
        targets
      );
      await dispatchTelegram(
        `📋 <b>ใบสมัครดีลเลอร์ใหม่</b>\n${company}\n${contact || "-"} · ${phone}\n${email}`,
        "dealerRegister"
      );
    } catch (e) {
      console.error("[dealer] register notify failed:", e?.message || e);
    }
    try {
      await sendEmail({
        to: email,
        from: dealerEmailFrom(),
        subject: "GETMOBIE ได้รับใบสมัครดีลเลอร์ของคุณแล้ว",
        html: dealerShell({
          heading: "ได้รับใบสมัครแล้ว",
          intro: `ขอบคุณที่สนใจร่วมเป็นดีลเลอร์กับ ${esc(DEALER_LEGAL_NAME)} — เจ้าหน้าที่กำลังตรวจสอบข้อมูลของ <strong>${esc(company)}</strong>`,
          bodyHtml: `<p style="margin:0 0 8px;font-size:14px;color:#374151;">เลขอ้างอิงใบสมัคร: <strong style="font-family:monospace;">${esc(appNo)}</strong></p><p style="margin:0;font-size:14px;color:#374151;">เมื่อผ่านการตรวจสอบ คุณจะได้รับอีเมลพร้อมบัญชีเข้าใช้งาน Dealer Portal เพื่อดูล็อตสินค้าและเสนอราคา โดยปกติใช้เวลาไม่เกิน 1-2 วันทำการ</p>`,
        }),
      });
    } catch (e) {
      console.error("[dealer] register confirm email failed:", e?.message || e);
    }
    console.log(`[dealer] application received ${email} (${company}) ${appNo}`);
    return { ok: true, app_no: appNo };
  });

  // ปฏิเสธใบสมัคร (CEO/MANAGER) — แจ้งผู้สมัครทางอีเมล best-effort
  fns.adminDealerApplicationReject = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const appId = String(data.applicationId || "");
    const app = (await db.ref(`dealer_applications/${appId}`).once("value")).val();
    if (!app) throw new HttpsError("not-found", "ไม่พบใบสมัคร");
    if (app.status !== "pending") throw new HttpsError("failed-precondition", "ใบสมัครนี้ถูกจัดการไปแล้ว");

    await db.ref(`dealer_applications/${appId}`).update({
      status: "rejected",
      rejected_at: nowMs(),
      rejected_by: caller.name || null,
      rejected_reason: String(data.reason || "").trim() || null,
    });
    if (app.email) {
      try {
        await sendEmail({
          to: app.email,
          from: dealerEmailFrom(),
          subject: "ผลการสมัครดีลเลอร์ GETMOBIE",
          html: dealerShell({
            heading: "ขออภัย — ใบสมัครยังไม่ผ่านการตรวจสอบ",
            intro: `ขอบคุณที่สนใจร่วมเป็นดีลเลอร์กับ ${esc(DEALER_LEGAL_NAME)} ครั้งนี้เรายังไม่สามารถเปิดบัญชีให้ได้`,
            bodyHtml: `<p style="margin:0;font-size:14px;color:#374151;">หากต้องการข้อมูลเพิ่มเติมหรือคิดว่าเกิดความผิดพลาด กรุณาติดต่อเจ้าหน้าที่เพื่อยื่นใหม่อีกครั้ง</p>`,
          }),
        });
      } catch (e) {
        console.error("[dealer] reject email failed:", e?.message || e);
      }
    }
    return { ok: true };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Lot lifecycle (ฝั่งแอดมิน)
  // ───────────────────────────────────────────────────────────────────────────

  // draft สร้างได้ทุก role (รวม STAFF ที่จัดของหน้าคลัง) — publish เท่านั้นที่
  // จำกัด CEO/MANAGER
  fns.adminDealerLotCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { callerStaffId, caller } = await requireStaffRole(db, request.auth, [
      "CEO", "MANAGER", "STAFF",
    ]);
    const data = request.data || {};

    const title = String(data.title || "").trim();
    if (!title) throw new HttpsError("invalid-argument", "ต้องตั้งชื่อ lot");
    const itemIds = Array.isArray(data.item_ids) ? data.item_ids.map(String).filter(Boolean) : [];
    if (itemIds.length === 0) throw new HttpsError("invalid-argument", "ต้องเลือกเครื่องอย่างน้อย 1 เครื่อง");
    const bidMode = LOT_BID_MODES.includes(data.bid_mode) ? data.bid_mode : "both";
    const closeAt = Number(data.close_at) || 0;
    if (closeAt <= nowMs()) throw new HttpsError("invalid-argument", "เวลาปิดรับราคาต้องอยู่ในอนาคต");
    const visibleTiers = sanitizeVisibleTiers(data.visible_tiers);

    const jobs = await readLotJobs(db, itemIds);
    for (const id of itemIds) assertJobSellable(id, jobs[id], null);

    const lotRef = db.ref("lots").push();
    const lotId = lotRef.key;
    const itemIdsMap = {};
    itemIds.forEach((id) => { itemIdsMap[id] = true; });

    await lotRef.set({
      title,
      description: String(data.description || "").trim() || null,
      status: "draft",
      bid_mode: bidMode,
      item_ids: itemIdsMap,
      item_count: itemIds.length,
      close_at: closeAt,
      visible_tiers: visibleTiers,
      show_bid_stats: data.show_bid_stats === true, // default: ดีลเลอร์ไม่เห็น 5/30
      created_at: nowMs(),
      created_by: callerStaffId,
      created_by_name: caller.name || null,
    });
    await db.ref(`lot_private/${lotId}`).set({
      reserve_price: Number(data.reserve_price) > 0 ? Number(data.reserve_price) : null,
      asking_prices: data.asking_prices && typeof data.asking_prices === "object" ? data.asking_prices : null,
      bid_count: 0,
    });
    return { ok: true, lotId };
  });

  fns.adminDealerLotUpdate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, ["CEO", "MANAGER", "STAFF"]);
    const data = request.data || {};
    const lotId = String(data.lotId || "");
    const snap = await db.ref(`lots/${lotId}`).once("value");
    const lot = snap.val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    if (lot.status !== "draft") {
      throw new HttpsError("failed-precondition", "แก้ได้เฉพาะ lot ที่ยังเป็น draft — lot ที่เปิดแล้วต้องยกเลิกก่อน");
    }

    const patch = {};
    if (data.title !== undefined) {
      const title = String(data.title || "").trim();
      if (!title) throw new HttpsError("invalid-argument", "ต้องตั้งชื่อ lot");
      patch.title = title;
    }
    if (data.description !== undefined) patch.description = String(data.description || "").trim() || null;
    if (data.bid_mode !== undefined) {
      if (!LOT_BID_MODES.includes(data.bid_mode)) throw new HttpsError("invalid-argument", "bid_mode ไม่ถูกต้อง");
      patch.bid_mode = data.bid_mode;
    }
    if (data.close_at !== undefined) {
      const closeAt = Number(data.close_at) || 0;
      if (closeAt <= nowMs()) throw new HttpsError("invalid-argument", "เวลาปิดรับราคาต้องอยู่ในอนาคต");
      patch.close_at = closeAt;
    }
    if (data.visible_tiers !== undefined) patch.visible_tiers = sanitizeVisibleTiers(data.visible_tiers);
    if (data.show_bid_stats !== undefined) patch.show_bid_stats = data.show_bid_stats === true;
    if (data.item_ids !== undefined) {
      const itemIds = Array.isArray(data.item_ids) ? data.item_ids.map(String).filter(Boolean) : [];
      if (itemIds.length === 0) throw new HttpsError("invalid-argument", "ต้องเลือกเครื่องอย่างน้อย 1 เครื่อง");
      const jobs = await readLotJobs(db, itemIds);
      for (const id of itemIds) assertJobSellable(id, jobs[id], null);
      const map = {};
      itemIds.forEach((id) => { map[id] = true; });
      patch.item_ids = map;
      patch.item_count = itemIds.length;
    }
    await db.ref(`lots/${lotId}`).update(patch);
    if (data.reserve_price !== undefined) {
      await db.ref(`lot_private/${lotId}/reserve_price`).set(
        Number(data.reserve_price) > 0 ? Number(data.reserve_price) : null
      );
    }
    if (data.asking_prices !== undefined) {
      await db.ref(`lot_private/${lotId}/asking_prices`).set(
        data.asking_prices && typeof data.asking_prices === "object" ? data.asking_prices : null
      );
    }
    return { ok: true };
  });

  // publish = จุดสัมผัสโดเมนหลัก: snapshot เครื่อง + ล็อกเป็น Reserved
  fns.adminDealerLotPublish = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const lotId = String(data.lotId || "");
    const lotSnap = await db.ref(`lots/${lotId}`).once("value");
    const lot = lotSnap.val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    if (lot.status !== "draft") throw new HttpsError("failed-precondition", "lot นี้ถูก publish ไปแล้ว");
    if (Number(lot.close_at) <= nowMs()) {
      throw new HttpsError("failed-precondition", "เวลาปิดรับราคาผ่านไปแล้ว — แก้เวลาก่อน publish");
    }

    const itemIds = Object.keys(lot.item_ids || {});
    if (itemIds.length === 0) throw new HttpsError("failed-precondition", "lot ไม่มีเครื่อง");
    const jobs = await readLotJobs(db, itemIds);
    for (const id of itemIds) assertJobSellable(id, jobs[id], lotId);

    const priv = (await db.ref(`lot_private/${lotId}`).once("value")).val() || {};
    const askingPrices = priv.asking_prices || {};

    const items = {};
    const itemCosts = {};
    const prevStatus = {};
    let askingTotal = 0;
    let totalCost = 0;
    for (const id of itemIds) {
      const job = jobs[id];
      // backfill stock_no ให้เครื่องที่ QC ก่อนมีระบบเลขสต๊อก — snapshot ด้านล่าง
      // ใช้เลขนี้เป็น ref ฝั่งดีลเลอร์ และเขียนกลับลง job ใน multi-update
      if (!job.stock_no) job.stock_no = generateStockNo();
      items[id] = lotItemSnapshot(job, askingPrices[id]);
      itemCosts[id] = stockCostOf(job);
      totalCost += itemCosts[id];
      prevStatus[id] = String(job.status || "In Stock");
      if (items[id].asking_price) askingTotal += items[id].asking_price;
    }

    const settings = await loadDealerSettings(db);
    const lotNo = await allocateDealerNumber(db, "lot", settings.lot_no_prefix || "LOT-", nowMs());
    const dealers = await loadActiveDealers(db);
    const eligible = eligibleDealersOf(dealers, lot.visible_tiers || {});

    // Early access ตาม tier: tier ที่ตั้ง early_access_min มากสุดเปิดทันที
    // tier อื่นเปิดช้ากว่าตามส่วนต่าง (settings/dealer/tiers/{t}/early_access_min)
    const tiersCfg = settings.tiers || {};
    const visibleTierKeys = Object.keys(lot.visible_tiers || {});
    const earlyOf = (t) => Number(tiersCfg[t] && tiersCfg[t].early_access_min) || 0;
    const maxEarly = Math.max(0, ...visibleTierKeys.map(earlyOf));
    const publishAt = nowMs();
    const tierOpenAt = {};
    for (const t of visibleTierKeys) {
      tierOpenAt[t] = publishAt + (maxEarly - earlyOf(t)) * 60000;
    }

    // multi-path update เดียว: เปิด lot + ล็อกทุกเครื่อง (atomic — ไม่มีเครื่อง
    // ครึ่งล็อกครึ่งหลุดถ้าพังกลางทาง)
    const updates = {};
    updates[`lots/${lotId}/status`] = "open";
    updates[`lots/${lotId}/lot_no`] = lotNo;
    updates[`lots/${lotId}/items`] = items;
    updates[`lots/${lotId}/asking_total`] = askingTotal > 0 ? askingTotal : null;
    updates[`lots/${lotId}/open_at`] = nowMs();
    updates[`lots/${lotId}/published_at`] = nowMs();
    updates[`lots/${lotId}/eligible_count`] = eligible.length;
    updates[`lots/${lotId}/tier_open_at`] = tierOpenAt;
    if (lot.show_bid_stats === true) {
      updates[`lots/${lotId}/bid_stats`] = { bid_count: 0 };
    }
    for (const id of itemIds) {
      updates[`jobs/${id}/status`] = "Reserved";
      updates[`jobs/${id}/lot_id`] = lotId;
      updates[`jobs/${id}/lot_no`] = lotNo;
      updates[`jobs/${id}/stock_no`] = jobs[id].stock_no;
    }
    await db.ref().update(updates);
    await db.ref(`lot_private/${lotId}`).update({
      item_costs: itemCosts,
      total_cost: totalCost,
      prev_status: prevStatus,
      bid_count: 0,
    });
    await logLotAudit(db, lotId, "published", {
      lot_no: lotNo,
      item_count: itemIds.length,
      eligible_count: eligible.length,
      by: caller.name || null,
    });

    // แจ้งดีลเลอร์ (best-effort — อีเมลพังไม่ทำให้ publish ล้ม): ส่งทันทีเฉพาะ
    // tier ที่หน้าต่างเปิดแล้ว — tier ที่รอ early access ให้ scheduler ส่งเมื่อถึงเวลา
    // (กันอีเมลลิงก์ไป lot ที่ตัวเองยังเปิดไม่ได้)
    const mail = buildLotOpenEmail({ ...lot, id: lotId, lot_no: lotNo, items, item_count: itemIds.length });
    const openNowTiers = visibleTierKeys.filter((t) => tierOpenAt[t] <= publishAt);
    const notifyNow = eligible.filter(
      (d) => d.email && openNowTiers.includes(String(d.tier || "").toUpperCase())
    );
    const results = await Promise.allSettled(notifyNow.map((d) => sendEmail({ to: d.email, from: dealerEmailFrom(), ...mail })));
    await Promise.allSettled(
      eligible
        .filter((d) => openNowTiers.includes(String(d.tier || "").toUpperCase()))
        .map((d) =>
          pushDealerNotification(db, d.uid, {
            type: "lot_open",
            cat: "lot",
            title: "ล็อตใหม่เปิดรับราคา",
            body: `${lotNo}${lot.title ? ` · ${lot.title}` : ""} · ${itemIds.length} เครื่อง`,
            ref: `/lots/${lotId}`,
          })
        )
    );
    for (const t of openNowTiers) {
      await db.ref(`lots/${lotId}/tier_notified/${t}`).set(nowMs());
    }
    const sent = results.filter((r) => r.status === "fulfilled").length;
    await dispatchTelegram(
      `📦 <b>เปิดประมูล ${lotNo}</b>\n${lot.title || ""}\n${itemIds.length} เครื่อง · แจ้งดีลเลอร์ ${sent}/${eligible.length} ราย`,
      "dealerLotPublish"
    );
    console.log(`[dealer] published ${lotNo} (${lotId}) items=${itemIds.length} eligible=${eligible.length} mailed=${sent}`);
    return { ok: true, lot_no: lotNo, eligible_count: eligible.length };
  });

  // ปิดรับราคา (แชร์กับ scheduler) — แจ้งเฉพาะ CEO/MANAGER ว่าเปิดซองได้แล้ว
  async function closeLotInternal(db, lotId, lot, closedByName) {
    await db.ref(`lots/${lotId}`).update({ status: "closed", closed_at: nowMs() });
    const bidCount = (await db.ref(`lot_private/${lotId}/bid_count`).once("value")).val() || 0;
    await logLotAudit(db, lotId, "closed", {
      by: closedByName || "scheduler",
      bid_count: bidCount,
    });
    const targets = await staffIdsByRoles(db, ["CEO", "MANAGER"]);
    await dispatchAdminPush(
      {
        data: {
          type: "dealer_lot",
          title: `ปิดรับราคา ${lot.lot_no || ""}`,
          body: `มีผู้เสนอราคา ${bidCount}/${lot.eligible_count || 0} ราย — เปิดซองได้แล้ว`,
          url: `/lots/${lotId}`,
        },
      },
      "dealerLotClose",
      "admin",
      targets
    );
  }

  fns.adminDealerLotClose = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const lotId = String((request.data || {}).lotId || "");
    const lot = (await db.ref(`lots/${lotId}`).once("value")).val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    if (lot.status !== "open") throw new HttpsError("failed-precondition", "lot นี้ไม่ได้เปิดรับราคาอยู่");
    await closeLotInternal(db, lotId, lot, caller.name || null);
    return { ok: true };
  });

  fns.adminDealerLotCancel = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const lotId = String(data.lotId || "");
    const lot = (await db.ref(`lots/${lotId}`).once("value")).val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    if (!["draft", "open", "closed", "awarding"].includes(lot.status)) {
      throw new HttpsError("failed-precondition", `ยกเลิก lot สถานะ "${lot.status}" ไม่ได้`);
    }

    const priv = (await db.ref(`lot_private/${lotId}`).once("value")).val() || {};
    const prevStatus = priv.prev_status || {};
    const itemIds = Object.keys(lot.item_ids || {});
    const updates = {};
    updates[`lots/${lotId}/status`] = "cancelled";
    updates[`lots/${lotId}/cancelled_at`] = nowMs();
    for (const id of itemIds) {
      // ปลดเฉพาะเครื่องที่ยังล็อกกับ lot นี้จริง (เช็คก่อนเขียน)
      const job = (await db.ref(`jobs/${id}`).once("value")).val();
      if (job && job.lot_id === lotId && job.status === "Reserved") {
        updates[`jobs/${id}/status`] = prevStatus[id] || "In Stock";
        updates[`jobs/${id}/lot_id`] = null;
        updates[`jobs/${id}/lot_no`] = null;
      }
    }
    await db.ref().update(updates);
    await logLotAudit(db, lotId, "cancelled", {
      by: caller.name || null,
      reason: String(data.reason || "").trim() || null,
    });
    return { ok: true };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ฝั่งดีลเลอร์ (portal)
  // ───────────────────────────────────────────────────────────────────────────

  // ลิสต์ lot ที่ดีลเลอร์คนนี้เห็น: lot เปิดของ tier ตัวเอง + lot ที่เคยเสนอ
  // (ตามไปดูผลได้). node lots เล็ก อ่านฝั่ง server ทั้งก้อนได้ ไม่ผิดกฎ RTDB cost
  fns.dealerListLots = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, dealer } = await requireDealerCaller(db, request.auth);
    const tier = String(dealer.tier || "").toUpperCase();

    const lotsSnap = await db.ref("lots").once("value");
    const lots = lotsSnap.exists() ? lotsSnap.val() : {};

    // ออเดอร์ของดีลเลอร์คนนี้ทั้งหมด (query เดียว, indexOn dealer_uid) —
    // ใช้ตัดสินผลประมูลต่อ lot: มี order = ชนะ, lot ประกาศแล้วแต่ไม่มี order = ไม่ได้รับเลือก
    const myOrdersSnap = await db
      .ref("dealer_orders").orderByChild("dealer_uid").equalTo(dealerUid).once("value");
    const myOrderByLot = {};
    if (myOrdersSnap.exists()) {
      myOrdersSnap.forEach((c) => {
        const o = c.val() || {};
        if (o.lot_id && o.status !== "cancelled") {
          myOrderByLot[o.lot_id] = {
            id: c.key,
            order_no: o.order_no || null,
            amount: Number(o.amount) || 0,
            status: o.status,
            item_count: o.item_count || 0,
          };
        }
      });
    }

    const out = [];
    for (const [lotId, lot] of Object.entries(lots)) {
      if (!lot || lot.status === "draft" || lot.status === "cancelled") continue;
      const tierVisible = lot.visible_tiers && lot.visible_tiers[tier] === true;
      // Early access: tier ที่หน้าต่างยังไม่เปิด มองไม่เห็น lot (เว้นแต่เคยเสนอแล้ว)
      const tierOpenAt = (lot.tier_open_at && lot.tier_open_at[tier]) || 0;
      const tierOpenNow = tierOpenAt <= nowMs();
      const myBidSnap = await db.ref(`lot_bids/${lotId}/${dealerUid}`).once("value");
      const myBid = myBidSnap.val();
      const isOpen = lot.status === "open" && Number(lot.close_at) > nowMs();
      if (!(isOpen && tierVisible && tierOpenNow) && !myBid) continue;

      const myOrder = myOrderByLot[lotId] || null;
      const decided = ["awarded", "completed"].includes(lot.status);

      out.push({
        // ผลประมูลของฉัน: won (มี order) / lost (ประกาศแล้ว เคยเสนอ แต่ไม่มี order) / null
        my_result: myOrder ? "won" : decided && myBid ? "lost" : null,
        my_order: myOrder,
        id: lotId,
        lot_no: lot.lot_no || null,
        title: lot.title || null,
        description: lot.description || null,
        status: lot.status,
        bid_mode: lot.bid_mode || "both",
        item_count: lot.item_count || 0,
        asking_total: lot.asking_total || null,
        open_at: lot.open_at || null,
        close_at: lot.close_at || null,
        // 5/30 ให้ดีลเลอร์เห็นเฉพาะเมื่อเปิด toggle (กลยุทธ์ต่อ lot)
        bid_stats: lot.show_bid_stats === true ? lot.bid_stats || { bid_count: 0 } : null,
        eligible_count: lot.show_bid_stats === true ? lot.eligible_count || 0 : null,
        my_bid: myBid
          ? {
              bid_no: myBid.bid_no || null,
              type: myBid.type,
              amount_total: myBid.amount_total || null,
              item_count: myBid.item_bids ? Object.keys(myBid.item_bids).length : 0,
              updated_at: myBid.updated_at || myBid.created_at || null,
            }
          : null,
      });
    }
    out.sort((a, b) => (b.open_at || 0) - (a.open_at || 0));
    return { lots: out };
  });

  fns.dealerGetMyBid = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerCaller(db, request.auth);
    const lotId = String((request.data || {}).lotId || "");
    if (!lotId) throw new HttpsError("invalid-argument", "ต้องระบุ lotId");
    const snap = await db.ref(`lot_bids/${lotId}/${dealerUid}`).once("value");
    const bid = snap.val();

    // ผลประมูลของ lot นี้ (สำหรับหน้ารายละเอียด — แสดง "ยินดีด้วย/ไม่ได้รับเลือก")
    let result = null;
    let order = null;
    const lot = (await db.ref(`lots/${lotId}`).once("value")).val() || {};
    if (["awarded", "completed"].includes(lot.status)) {
      const os = await db.ref("dealer_orders").orderByChild("lot_id").equalTo(lotId).once("value");
      if (os.exists()) {
        os.forEach((c) => {
          const o = c.val() || {};
          if (o.dealer_uid === dealerUid && o.status !== "cancelled") {
            order = {
              id: c.key,
              order_no: o.order_no || null,
              amount: Number(o.amount) || 0,
              status: o.status,
              item_count: o.item_count || 0,
              items: o.items || {},
            };
          }
        });
      }
      if (order) result = "won";
      else if (bid) result = "lost";
    }

    if (!bid) return { bid: null, result, order };
    // ส่งกลับเฉพาะซองตัวเอง — history ให้ดูได้ (เป็นของเขาเอง)
    return {
      bid: {
        bid_no: bid.bid_no || null,
        type: bid.type,
        amount_total: bid.amount_total || null,
        item_bids: bid.item_bids || null,
        note: bid.note || null,
        created_at: bid.created_at || null,
        updated_at: bid.updated_at || null,
        updated_by: bid.updated_by || null,
        history: bid.history || [],
      },
      result,
      order,
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Team members — ร้านจัดการสมาชิกเอง (สูงสุด MAX_MEMBERS คน/ร้าน)
  // บัญชีหลักของร้าน (ที่ GETMOBIE ออกให้) = OWNER → สร้าง OWNER/MANAGER/STAFF ได้
  // MANAGER → สร้าง/จัดการได้เฉพาะ STAFF. ทุก role ใช้งานปกติได้ (เสนอราคา/
  // แก้ซองของร้าน/ดูออเดอร์/แนบสลิป) — ทุกการกระทำบันทึกชื่อคนทำ
  // ───────────────────────────────────────────────────────────────────────────
  const MAX_MEMBERS = 10;

  fns.dealerListMembers = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerManager(db, request.auth);
    const snap = await db
      .ref("dealer_members").orderByChild("company_id").equalTo(dealerUid).once("value");
    const out = [];
    if (snap.exists()) {
      snap.forEach((c) => {
        const m = c.val() || {};
        out.push({
          uid: c.key,
          name: m.name || null,
          email: m.email || null,
          member_role: m.member_role || "MEMBER",
          status: m.status || "ACTIVE",
          created_at: m.created_at || null,
        });
      });
    }
    out.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    return { members: out, max: MAX_MEMBERS };
  });

  fns.dealerMemberCreate = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, dealer, memberRole } = await requireDealerManager(db, request.auth);
    const data = request.data || {};

    const name = String(data.name || "").trim();
    const email = normEmail(data.email);
    if (!name) throw new HttpsError("invalid-argument", "ระบุชื่อสมาชิก");
    if (!isValidEmail(email)) throw new HttpsError("invalid-argument", "อีเมลไม่ถูกต้อง");
    if (typeof data.password !== "string" || data.password.length < 8) {
      throw new HttpsError("invalid-argument", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
    }
    const newRole = String(data.member_role || "STAFF").toUpperCase();
    if (!DEALER_MEMBER_ROLES.includes(newRole)) {
      throw new HttpsError("invalid-argument", `role ต้องเป็นหนึ่งใน: ${DEALER_MEMBER_ROLES.join(", ")}`);
    }
    if (!canManageMemberRole(memberRole, newRole)) {
      throw new HttpsError("permission-denied", "ผู้จัดการสร้างได้เฉพาะพนักงาน (STAFF) — role อื่นต้องให้เจ้าของร้านสร้าง");
    }

    const countSnap = await db
      .ref("dealer_members").orderByChild("company_id").equalTo(dealerUid).once("value");
    if (countSnap.exists() && countSnap.numChildren() >= MAX_MEMBERS) {
      throw new HttpsError("failed-precondition", `เพิ่มสมาชิกได้สูงสุด ${MAX_MEMBERS} คนต่อร้าน`);
    }
    const used = await dealerEmailInUse(db, email);
    if (used) throw new HttpsError("already-exists", "อีเมลนี้ถูกใช้ในระบบแล้ว — ใช้อีเมลอื่น");

    let authUser = null;
    try {
      authUser = await getAuth().getUserByEmail(email);
    } catch (e) {
      if (!e || e.code !== "auth/user-not-found") {
        throw new HttpsError("internal", `ตรวจสอบบัญชีไม่สำเร็จ: ${e?.message || e}`);
      }
    }
    if (authUser) {
      // มีบัญชี Auth อยู่ (เช่น เคยเป็นลูกค้าเว็บ) แต่ไม่ได้อยู่ในระบบ dealer/staff —
      // กันสวมบัญชีคนอื่น: ไม่ยึดบัญชีเดิม ให้ใช้อีเมลอื่น
      throw new HttpsError("already-exists", "อีเมลนี้มีบัญชีอยู่แล้ว — ใช้อีเมลอื่นสำหรับสมาชิกทีม");
    }
    authUser = await getAuth().createUser({ email, password: data.password, displayName: name });

    await db.ref(`dealer_members/${authUser.uid}`).set({
      company_id: dealerUid,
      member_role: newRole,
      name,
      email,
      status: "ACTIVE",
      created_at: nowMs(),
      created_by: request.auth.uid,
    });
    console.log(`[dealer] member ${email} added to company ${dealerUid} (${dealer.company_name})`);
    return { ok: true, uid: authUser.uid };
  });

  fns.dealerMemberSetStatus = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, memberRole, memberUid } = await requireDealerManager(db, request.auth);
    const data = request.data || {};
    const uid = String(data.uid || "");
    const status = String(data.status || "").toUpperCase();
    if (!["ACTIVE", "SUSPENDED"].includes(status)) {
      throw new HttpsError("invalid-argument", "status ต้องเป็น ACTIVE หรือ SUSPENDED");
    }
    if (uid === memberUid) throw new HttpsError("failed-precondition", "ระงับบัญชีตัวเองไม่ได้");
    const m = (await db.ref(`dealer_members/${uid}`).once("value")).val();
    if (!m || m.company_id !== dealerUid) throw new HttpsError("not-found", "ไม่พบสมาชิกในร้านของคุณ");
    if (!canManageMemberRole(memberRole, String(m.member_role || "STAFF").toUpperCase())) {
      throw new HttpsError("permission-denied", "ผู้จัดการจัดการได้เฉพาะพนักงาน (STAFF)");
    }

    if (status === "SUSPENDED") {
      await getAuth().updateUser(uid, { disabled: true });
      await getAuth().revokeRefreshTokens(uid);
    } else {
      await getAuth().updateUser(uid, { disabled: false });
    }
    await db.ref(`dealer_members/${uid}`).update({ status, updated_at: nowMs() });
    return { ok: true };
  });

  fns.dealerMemberResetPassword = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, memberRole } = await requireDealerManager(db, request.auth);
    const data = request.data || {};
    const uid = String(data.uid || "");
    if (typeof data.password !== "string" || data.password.length < 8) {
      throw new HttpsError("invalid-argument", "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
    }
    const m = (await db.ref(`dealer_members/${uid}`).once("value")).val();
    if (!m || m.company_id !== dealerUid) throw new HttpsError("not-found", "ไม่พบสมาชิกในร้านของคุณ");
    if (!canManageMemberRole(memberRole, String(m.member_role || "STAFF").toUpperCase())) {
      throw new HttpsError("permission-denied", "ผู้จัดการจัดการได้เฉพาะพนักงาน (STAFF)");
    }
    await getAuth().updateUser(uid, { password: data.password });
    await getAuth().revokeRefreshTokens(uid);
    return { ok: true };
  });

  fns.dealerMemberDelete = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, memberRole, memberUid } = await requireDealerManager(db, request.auth);
    const uid = String((request.data || {}).uid || "");
    if (uid === memberUid) throw new HttpsError("failed-precondition", "ลบบัญชีตัวเองไม่ได้");
    const m = (await db.ref(`dealer_members/${uid}`).once("value")).val();
    if (!m || m.company_id !== dealerUid) throw new HttpsError("not-found", "ไม่พบสมาชิกในร้านของคุณ");
    if (!canManageMemberRole(memberRole, String(m.member_role || "STAFF").toUpperCase())) {
      throw new HttpsError("permission-denied", "ผู้จัดการจัดการได้เฉพาะพนักงาน (STAFF)");
    }
    try {
      await getAuth().deleteUser(uid);
    } catch (e) {
      if (!e || e.code !== "auth/user-not-found") throw e;
    }
    await db.ref(`dealer_members/${uid}`).remove();
    return { ok: true };
  });

  // ดีลเลอร์แก้ข้อมูลผู้ติดต่อของร้าน — เจ้าของร้านเท่านั้น (ข้อมูลนิติบุคคล
  // company_name/tax_id/address ผูกกับเอกสารภาษี ยังต้องให้แอดมินแก้)
  fns.dealerUpdateContact = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerOwner(db, request.auth);
    const data = request.data || {};
    const patch = { updated_at: nowMs() };
    if (data.contact_name !== undefined) patch.contact_name = String(data.contact_name || "").trim().slice(0, 100) || null;
    if (data.phone !== undefined) patch.phone = String(data.phone || "").trim().slice(0, 30) || null;
    if (data.line_id !== undefined) patch.line_id = String(data.line_id || "").trim().slice(0, 100) || null;
    await db.ref(`dealers/${dealerUid}`).update(patch);
    return { ok: true };
  });

  // ลิสต์คำสั่งซื้อของดีลเลอร์เอง — collection read ของ dealer_orders เป็น
  // admin-only (rules) ดีลเลอร์จึง query ตรงไม่ได้; server query ด้วย
  // .indexOn: dealer_uid แล้วคืนเฉพาะของตัวเอง (รายใบ subscribe ตรงได้ตาม rules)
  fns.dealerListOrders = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerCaller(db, request.auth);
    const snap = await db
      .ref("dealer_orders")
      .orderByChild("dealer_uid")
      .equalTo(dealerUid)
      .once("value");
    const out = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const o = child.val() || {};
        out.push({
          id: child.key,
          order_no: o.order_no,
          lot_no: o.lot_no || null,
          type: o.type,
          item_count: o.item_count || 0,
          items: o.items || {},
          amount: o.amount || 0,
          status: o.status,
          quotation: o.quotation ? { number: o.quotation.number, url: o.quotation.url || null } : null,
          payment: o.payment
            ? { slip_url: o.payment.slip_url || null, submitted_at: o.payment.submitted_at || null }
            : null,
          payment_info: o.payment_info || null,
          shipping: o.shipping || null,
          created_at: o.created_at || null,
        });
      });
    }
    out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return { orders: out };
  });

  // คลังเอกสารของดีลเลอร์ (จอ Documents Hub) — รวมใบเสนอราคา (dealer_orders)
  // + ใบกำกับภาษีขาย ซึ่งอยู่ /sales ที่ดีลเลอร์อ่านตรงไม่ได้ตาม rules —
  // server อ่านรายใบเฉพาะ sale_id ของออเดอร์ตัวเองเท่านั้น (ไม่กวาด /sales)
  fns.dealerListDocuments = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerCaller(db, request.auth);
    const snap = await db
      .ref("dealer_orders")
      .orderByChild("dealer_uid")
      .equalTo(dealerUid)
      .once("value");
    const docs = [];
    const sales = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const o = child.val() || {};
        if (o.status === "cancelled") return;
        if (o.quotation && o.quotation.number) {
          docs.push({
            type: "quotation",
            number: o.quotation.number,
            url: o.quotation.url || null,
            order_no: o.order_no || null,
            amount: Number(o.amount) || 0,
            issued_at: o.created_at || null,
          });
        }
        if (o.sale_id) {
          sales.push({ saleId: o.sale_id, order_no: o.order_no || null, amount: Number(o.amount) || 0 });
        }
      });
    }
    for (const s of sales) {
      try {
        const ti = (await db.ref(`sales/${s.saleId}/tax_invoice`).once("value")).val();
        if (ti && ti.number) {
          docs.push({
            type: "tax_invoice",
            number: ti.number,
            url: ti.url || null,
            order_no: s.order_no,
            amount: Number(ti.total) || s.amount,
            issued_at: ti.issued_at || null,
          });
        }
      } catch (e) {
        console.error(`[dealer] doc read failed sale ${s.saleId}:`, e?.message || e);
      }
    }
    docs.sort((a, b) => (b.issued_at || 0) - (a.issued_at || 0));
    return { documents: docs };
  });

  // การแจ้งเตือนในแอป — อ่านของร้านตัวเอง (ล่าสุด 50) + จำนวนยังไม่อ่าน
  fns.dealerListNotifications = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerCaller(db, request.auth);
    const snap = await db.ref(`dealer_notifications/${dealerUid}`).limitToLast(50).once("value");
    const out = [];
    if (snap.exists()) {
      snap.forEach((c) => {
        out.push({ id: c.key, ...(c.val() || {}) });
      });
    }
    out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return { notifications: out, unread: out.filter((n) => n.read !== true).length };
  });

  fns.dealerNotificationsMarkRead = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerCaller(db, request.auth);
    const data = request.data || {};
    const ref = db.ref(`dealer_notifications/${dealerUid}`);
    const updates = {};
    if (data.all === true) {
      const snap = await ref.once("value");
      if (snap.exists()) {
        snap.forEach((c) => {
          if ((c.val() || {}).read !== true) updates[`${c.key}/read`] = true;
        });
      }
    } else if (Array.isArray(data.ids)) {
      for (const id of data.ids.slice(0, 100)) {
        const key = String(id).replace(/[.#$/[\]]/g, "");
        if (key) updates[`${key}/read`] = true;
      }
    }
    if (Object.keys(updates).length > 0) await ref.update(updates);
    return { ok: true };
  });

  // ── ล้างข้อมูลทดสอบ Dealer Portal ก่อน go-live (CEO เท่านั้น) ─────────────
  // ใช้ครั้งเดียวก่อนเปิดใช้จริง: ลบ lot/ซอง/ออเดอร์/ใบสมัคร/แจ้งเตือนทดสอบ,
  // คืนสถานะเครื่องที่ติด lot หรือถูกขายผ่าน dealer กลับเข้าคลัง (ใช้ prev_status
  // จาก lot_private), ลบ /sales ช่อง dealer + ใบกำกับ + accounting_documents
  // ที่พ่วงมา, reset counter เลขเอกสาร LOT-/DO-/QT-/REG- (เลขใบกำกับภาษีกลาง
  // reset แยกที่หน้าตั้งค่าระบบบัญชี). บัญชีดีลเลอร์ "ไม่ถูกลบ" — เคลียร์แค่
  // stats/tier_suggestion. confirm ต้องส่งสตริง "PURGE" เท่านั้น ไม่งั้น = dry-run
  fns.adminDealerPurgeTestData = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO"]);
    const confirmed = (request.data || {}).confirm === "PURGE";

    const [lotsSnap, ordersSnap, appsSnap, dealersSnap, notifSnap] = await Promise.all([
      db.ref("lots").once("value"),
      db.ref("dealer_orders").once("value"),
      db.ref("dealer_applications").once("value"),
      db.ref("dealers").once("value"),
      db.ref("dealer_notifications").once("value"),
    ]);
    const lots = lotsSnap.val() || {};
    const orders = ordersSnap.val() || {};
    const apps = appsSnap.val() || {};
    const dealers = dealersSnap.val() || {};

    // เครื่องที่เกี่ยวข้อง = ทุกใบใน lot + ทุกใบในออเดอร์ (กันหลุดกรณี lot ถูกลบแล้ว)
    const jobIds = new Set();
    for (const lot of Object.values(lots)) {
      for (const id of Object.keys(lot.item_ids || lot.items || {})) jobIds.add(id);
    }
    for (const o of Object.values(orders)) {
      for (const id of Object.keys(o.items || {})) jobIds.add(id);
    }
    const saleIds = [...new Set(Object.values(orders).map((o) => o.sale_id).filter(Boolean))];

    const summary = {
      lots: Object.values(lots).map((l) => l.lot_no || "(draft)"),
      orders: Object.values(orders).map((o) => o.order_no || "?"),
      applications: Object.values(apps).map((a) => a.app_no || a.company_name || "?"),
      sales_to_delete: saleIds.length,
      jobs_to_restore: jobIds.size,
      notifications_cleared: notifSnap.exists() ? Object.keys(notifSnap.val()).length : 0,
      dealer_stats_reset: Object.keys(dealers).length,
    };
    if (!confirmed) return { dry_run: true, summary };

    // 1) คืนสถานะเครื่อง — prev_status ต่อใบอยู่ใน lot_private/{lotId}/prev_status
    const prevStatusOf = {};
    for (const lotId of Object.keys(lots)) {
      const priv = (await db.ref(`lot_private/${lotId}/prev_status`).once("value")).val() || {};
      Object.assign(prevStatusOf, priv);
    }
    const updates = {};
    for (const jobId of jobIds) {
      const job = (await db.ref(`jobs/${jobId}`).once("value")).val();
      if (!job) continue;
      if (!job.lot_id && job.sold_channel !== "dealer") continue; // ปลดไปแล้ว/ขายช่องอื่น — ไม่แตะ
      updates[`jobs/${jobId}/status`] = prevStatusOf[jobId] || "In Stock";
      updates[`jobs/${jobId}/lot_id`] = null;
      updates[`jobs/${jobId}/lot_no`] = null;
      if (job.sold_channel === "dealer") {
        updates[`jobs/${jobId}/sold_date`] = null;
        updates[`jobs/${jobId}/sold_channel`] = null;
        updates[`jobs/${jobId}/sale_id`] = null;
      }
    }

    // 2) ลบ sales ช่อง dealer + accounting_documents + PDF ใน Storage (best-effort)
    for (const saleId of saleIds) {
      const sale = (await db.ref(`sales/${saleId}`).once("value")).val();
      if (!sale) continue;
      const tiNumber = sale.tax_invoice && sale.tax_invoice.number;
      if (tiNumber) updates[`accounting_documents/TI_${tiNumber}`] = null;
      updates[`sales/${saleId}`] = null;
      try {
        await getStorage().bucket().file(`sales_tax_invoices/${saleId}.pdf`).delete();
      } catch {
        /* ไม่มีไฟล์ = ข้าม */
      }
    }
    for (const orderId of Object.keys(orders)) {
      try {
        await getStorage().bucket().file(`dealer_quotations/${orderId}.pdf`).delete();
      } catch {
        /* ไม่มีไฟล์ = ข้าม */
      }
    }

    // 3) ลบ node โดเมน dealer ทั้งชุด + reset counter เลขเอกสาร + เคลียร์ stats
    // เคลมทดสอบ: ลบใบลดหนี้ที่พ่วง (ทะเบียนเอกสาร + PDF) ด้วย
    const claimsSnap = await db.ref("dealer_claims").once("value");
    if (claimsSnap.exists()) {
      for (const [claimId, cl] of Object.entries(claimsSnap.val())) {
        if (cl && cl.credit_note && cl.credit_note.number) {
          updates[`accounting_documents/CN_${cl.credit_note.number}`] = null;
        }
        try {
          await getStorage().bucket().file(`dealer_credit_notes/${claimId}.pdf`).delete();
        } catch {
          /* ไม่มีไฟล์ = ข้าม */
        }
      }
    }
    Object.assign(updates, {
      lots: null,
      lot_private: null,
      lot_bids: null,
      lot_audit: null,
      dealer_orders: null,
      dealer_notifications: null,
      dealer_applications: null,
      dealer_claims: null,
      dealer_credit_ledger: null,
      "settings/dealer/lot_seq_by_period": null,
      "settings/dealer/order_seq_by_period": null,
      "settings/dealer/quotation_seq_by_period": null,
      "settings/dealer/application_seq_by_period": null,
      "settings/dealer/claim_seq_by_period": null,
      "settings/dealer/credit_note_seq_by_period": null,
    });
    for (const uid of Object.keys(dealers)) {
      updates[`dealers/${uid}/stats`] = null;
      updates[`dealers/${uid}/tier_suggestion`] = null;
      updates[`dealers/${uid}/credit_balance`] = null;
    }
    await db.ref().update(updates);
    console.log(`[dealer] TEST DATA PURGED by ${caller.name || "?"}:`, JSON.stringify(summary));
    return { ok: true, summary };
  });

  // รูปเครื่องใน lot — แอดมินอัปโหลดไฟล์เข้า Storage (lot_photos/{jobId}/) จาก
  // client แล้วส่ง URL มาบันทึกที่นี่: เขียน jobs/{jobId}/lot_photos (ติดตัวเครื่อง
  // ใช้ซ้ำถ้าเข้า lot ใหม่) + sync snapshot lots/{lotId}/items ถ้า publish แล้ว
  fns.adminDealerLotItemPhotos = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, ["CEO", "MANAGER", "STAFF"]);
    const data = request.data || {};
    const jobId = String(data.jobId || "");
    const photos = sanitizePhotoUrls(data.photos, 8);
    const job = (await db.ref(`jobs/${jobId}`).once("value")).val();
    if (!job) throw new HttpsError("not-found", "ไม่พบเครื่องนี้");
    const updates = {};
    updates[`jobs/${jobId}/lot_photos`] = photos.length > 0 ? photos : null;
    if (job.lot_id) {
      const itemSnap = await db.ref(`lots/${job.lot_id}/items/${jobId}`).once("value");
      if (itemSnap.exists()) {
        updates[`lots/${job.lot_id}/items/${jobId}/photos`] = photos.length > 0 ? photos : null;
      }
    }
    await db.ref().update(updates);
    return { ok: true, count: photos.length };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // เคลมสินค้า / คืนเงิน / เครดิต / ใบลดหนี้
  // - ดีลเลอร์ขอเคลมรายเครื่องภายใน warranty_days ของเครื่อง (นับจากวันจัดส่ง)
  // - แอดมินอนุมัติเลือกได้ต่อเคส: refund (โอนคืน — ค้างเป็น AP จนบันทึกโอน) หรือ
  //   credit (ตั้งเครดิตหักออเดอร์ถัดไป — จบทันที)
  // - อนุมัติ = ออกใบลดหนี้เต็มรูปอ้างใบกำกับขายเดิม (ม.86/10) + ลง
  //   accounting_documents type 'credit_note' → ภ.พ.30 หักภาษีขายอัตโนมัติ
  // - เครดิต: dealers/{uid}/credit_balance (server เขียนคนเดียว) + ledger
  //   dealer_credit_ledger/{uid} — ใช้หักตอน markPaid (use_credit)
  // - เข้าถึงผ่าน callable ทั้งหมด (ไม่ต้อง deploy rules)
  // ───────────────────────────────────────────────────────────────────────────

  // MIRROR: สถานะเคลม — sync กับ src/types/dealer.ts + dealer-portal/src/types.ts
  // submitted → approved (resolution=refund รอโอน) | resolved (credit จบทันที /
  // refund โอนแล้ว) | rejected
  const CLAIM_STATUSES = ["submitted", "approved", "resolved", "rejected"];
  void CLAIM_STATUSES;

  async function adjustDealerCredit(db, dealerUid, delta, entry) {
    let after = 0;
    await db.ref(`dealers/${dealerUid}/credit_balance`).transaction((cur) => {
      after = Math.max(0, (Number(cur) || 0) + delta);
      return after;
    });
    await db.ref(`dealer_credit_ledger/${dealerUid}`).push({
      delta,
      balance_after: after,
      ...entry,
      at: nowMs(),
    });
    return after;
  }

  fns.dealerSubmitClaim = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, dealer, memberName } = await requireDealerCaller(db, request.auth);
    const data = request.data || {};
    const orderId = String(data.orderId || "");
    const jobId = String(data.jobId || "");
    const reason = String(data.reason || "").trim().slice(0, 1000);
    if (!reason) throw new HttpsError("invalid-argument", "กรุณาระบุอาการ/เหตุผลการเคลม");

    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order || order.dealer_uid !== dealerUid) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    if (!["shipped", "completed"].includes(order.status)) {
      throw new HttpsError("failed-precondition", "เคลมได้เฉพาะคำสั่งซื้อที่จัดส่งแล้ว");
    }
    const item = (order.items || {})[jobId];
    if (!item) throw new HttpsError("not-found", "ไม่พบเครื่องนี้ในคำสั่งซื้อ");

    // หน้าต่างเคลม = warranty_days ของเครื่อง (snapshot ใน lot) นับจากวันจัดส่ง
    const lotItem = order.lot_id
      ? (await db.ref(`lots/${order.lot_id}/items/${jobId}`).once("value")).val()
      : null;
    const warrantyDays = Number(lotItem && lotItem.warranty_days) || 0;
    if (warrantyDays <= 0) {
      throw new HttpsError("failed-precondition", "เครื่องนี้ไม่มีประกันร้าน — เคลมผ่านระบบไม่ได้ กรุณาติดต่อเจ้าหน้าที่");
    }
    const shippedAt = Number(order.shipping && order.shipping.shipped_at) || 0;
    if (!shippedAt) throw new HttpsError("failed-precondition", "ไม่พบวันที่จัดส่ง — ติดต่อเจ้าหน้าที่");
    const deadline = shippedAt + warrantyDays * 86400000;
    if (nowMs() > deadline) {
      throw new HttpsError(
        "failed-precondition",
        `หมดระยะเคลมแล้ว (ประกัน ${warrantyDays} วัน ถึง ${new Date(deadline).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })})`
      );
    }

    // กันเคลมซ้ำเครื่องเดิม (ยังมีเคสค้างอยู่)
    const dupSnap = await db.ref("dealer_claims").orderByChild("job_id").equalTo(jobId).once("value");
    if (dupSnap.exists()) {
      let active = false;
      dupSnap.forEach((c) => {
        const v = c.val() || {};
        if (v.order_id === orderId && ["submitted", "approved"].includes(v.status)) active = true;
      });
      if (active) throw new HttpsError("already-exists", "เครื่องนี้มีคำขอเคลมค้างอยู่แล้ว");
    }

    // รูปประกอบ (ดีลเลอร์อัปโหลดเข้า dealer_claims/{orderId}/{uid}/ แล้วส่ง URL มา)
    const photos = sanitizePhotoUrls(data.photos, 5);

    const claimNo = await allocateDealerNumber(db, "claim", "CLM-", nowMs());
    const claimRef = db.ref("dealer_claims").push();
    await claimRef.set({
      claim_no: claimNo,
      photos: photos.length > 0 ? photos : null,
      dealer_uid: dealerUid,
      company_name: dealer.company_name || null,
      order_id: orderId,
      order_no: order.order_no || null,
      sale_id: order.sale_id || null,
      job_id: jobId,
      model: item.model || null,
      ref_no: item.ref_no || null,
      amount: Number(item.amount) || 0,
      warranty_days: warrantyDays,
      reason,
      status: "submitted",
      created_at: nowMs(),
      created_by: memberName || null,
    });

    try {
      const targets = await staffIdsByRoles(db, ["CEO", "MANAGER"]);
      await dispatchAdminPush(
        {
          data: {
            type: "dealer_claim",
            title: `ขอเคลม ${claimNo}`,
            body: `${dealer.company_name || "ดีลเลอร์"} · ${item.model || ""} (${order.order_no || ""}) — รอตรวจสอบ`,
            url: "/dealer-claims",
          },
        },
        "dealerClaimSubmit",
        "admin",
        targets
      );
    } catch (e) {
      console.error("[dealer] claim notify failed:", e?.message || e);
    }
    return { ok: true, claim_no: claimNo };
  });

  // เคลม + เครดิตของร้านตัวเอง (จอ "เคลม & เครดิต" ใน portal)
  fns.dealerListClaims = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid } = await requireDealerCaller(db, request.auth);
    const [claimsSnap, balSnap, ledgerSnap] = await Promise.all([
      db.ref("dealer_claims").orderByChild("dealer_uid").equalTo(dealerUid).once("value"),
      db.ref(`dealers/${dealerUid}/credit_balance`).once("value"),
      db.ref(`dealer_credit_ledger/${dealerUid}`).limitToLast(20).once("value"),
    ]);
    const claims = [];
    if (claimsSnap.exists()) {
      claimsSnap.forEach((c) => {
        const v = c.val() || {};
        claims.push({
          id: c.key,
          claim_no: v.claim_no,
          order_no: v.order_no,
          model: v.model,
          ref_no: v.ref_no,
          amount: v.amount || 0,
          reason: v.reason,
          photos: Array.isArray(v.photos) ? v.photos : null,
          status: v.status,
          resolution: v.resolution || null,
          approved_amount: v.approved_amount || null,
          reject_reason: v.reject_reason || null,
          credit_note: v.credit_note ? { number: v.credit_note.number, url: v.credit_note.url || null } : null,
          created_at: v.created_at || null,
          decided_at: v.decided_at || null,
          resolved_at: v.resolved_at || null,
        });
      });
    }
    claims.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const ledger = [];
    if (ledgerSnap.exists()) {
      ledgerSnap.forEach((c) => {
        ledger.push({ id: c.key, ...(c.val() || {}) });
      });
    }
    ledger.sort((a, b) => (b.at || 0) - (a.at || 0));
    return { claims, credit_balance: Number(balSnap.val()) || 0, ledger };
  });

  fns.adminDealerListClaims = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireStaffRole(db, request.auth, ["CEO", "MANAGER", "FINANCE"]);
    const snap = await db.ref("dealer_claims").once("value");
    const claims = [];
    if (snap.exists()) {
      snap.forEach((c) => {
        claims.push({ id: c.key, ...(c.val() || {}) });
      });
    }
    claims.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    // เครดิตคงค้างทุกร้าน (ฝั่ง AP)
    const dealersSnap = await db.ref("dealers").once("value");
    const credits = [];
    if (dealersSnap.exists()) {
      dealersSnap.forEach((c) => {
        const v = c.val() || {};
        const bal = Number(v.credit_balance) || 0;
        if (bal > 0) credits.push({ uid: c.key, company_name: v.company_name || "-", balance: bal });
      });
    }
    return { claims, credits };
  });

  // อนุมัติเคลม: ออกใบลดหนี้ + refund (ค้างโอน) หรือ credit (จบทันที)
  fns.adminDealerClaimApprove = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const claimId = String(data.claimId || "");
    const resolution = data.resolution === "credit" ? "credit" : "refund";
    const claim = (await db.ref(`dealer_claims/${claimId}`).once("value")).val();
    if (!claim) throw new HttpsError("not-found", "ไม่พบคำขอเคลม");
    if (claim.status !== "submitted") throw new HttpsError("failed-precondition", "คำขอนี้ถูกตัดสินไปแล้ว");

    const maxAmount = Number(claim.amount) || 0;
    const amount = data.amount !== undefined ? Math.round(Number(data.amount) || 0) : maxAmount;
    if (amount <= 0 || amount > maxAmount) {
      throw new HttpsError("invalid-argument", `ยอดชดเชยต้องอยู่ระหว่าง 1 ถึง ${maxAmount.toLocaleString()} บาท`);
    }

    // ใบลดหนี้อ้างใบกำกับขายเดิมของออเดอร์ (จาก sale ที่ markPaid สร้าง)
    const sale = claim.sale_id ? (await db.ref(`sales/${claim.sale_id}`).once("value")).val() : null;
    const origTi = sale && sale.tax_invoice ? sale.tax_invoice : null;
    const acct = (await db.ref("settings/accounting").once("value")).val() || {};
    const vatRate = (Number(acct.vat_rate_percent) || 7) / 100;
    const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const base = round2(amount / (1 + vatRate));
    const vat = round2(amount - base);

    // ออกใบลดหนี้เมื่อมีใบกำกับเดิมให้อ้างเท่านั้น (ไม่มี = ข้าม พร้อม flag)
    let creditNote = null;
    if (origTi && origTi.number) {
      const cnNumber = await allocateDealerNumber(db, "credit_note", "CN-", nowMs());
      creditNote = { number: cnNumber, issued_at: nowMs(), base, vat, total: amount, orig_number: origTi.number };
      try {
        const dealer = (await db.ref(`dealers/${claim.dealer_uid}`).once("value")).val() || {};
        const pdf = await buildCreditNotePdf(
          {
            cn: creditNote,
            orig: { number: origTi.number, issued_at: origTi.issued_at, total: origTi.total },
            buyer: { company_name: dealer.company_name, tax_id: dealer.tax_id, address: dealer.address },
            claim: { claim_no: claim.claim_no, order_no: claim.order_no, model: claim.model, ref_no: claim.ref_no, reason: claim.reason },
          },
          acct.company || null
        );
        creditNote.storage_path = `dealer_credit_notes/${claimId}.pdf`;
        creditNote.url = await archivePdf(creditNote.storage_path, pdf, claimId);
      } catch (e) {
        console.error(`[dealer] credit note PDF failed ${claimId}:`, e?.message || e);
      }
      // ลงทะเบียนเอกสาร → ภ.พ.30 หักภาษีขาย (VatReport อ่าน type credit_note เป็นยอดลบ)
      const { ym } = bangkokYM(nowMs());
      await db.ref(`accounting_documents/CN_${creditNote.number}`).set({
        type: "credit_note",
        category: "goods",
        number: creditNote.number,
        ref_invoice: origTi.number,
        customer_name: claim.company_name || null,
        description: `ใบลดหนี้เคลม ${claim.claim_no} (${claim.model || "-"})`,
        period: ym,
        base,
        vat,
        total: amount,
        issued_at: nowMs(),
        url: creditNote.url || null,
      });
    }

    const patch = {
      resolution,
      approved_amount: amount,
      decided_at: nowMs(),
      decided_by: caller.name || null,
      credit_note: creditNote,
      admin_note: String(data.note || "").trim() || null,
    };
    if (resolution === "credit") {
      await adjustDealerCredit(db, claim.dealer_uid, amount, {
        source: "claim",
        ref: claim.claim_no,
        by: caller.name || null,
      });
      patch.status = "resolved";
      patch.resolved_at = nowMs();
    } else {
      patch.status = "approved"; // ค้างโอน = AP จนกด markRefunded
    }
    await db.ref(`dealer_claims/${claimId}`).update(patch);

    await pushDealerNotification(db, claim.dealer_uid, {
      type: "claim_approved",
      cat: "payment",
      title: resolution === "credit" ? "เคลมอนุมัติ — ตั้งเครดิตให้แล้ว" : "เคลมอนุมัติ — รอโอนเงินคืน",
      body: `${claim.claim_no} · ${claim.model || ""} ยอด ${amount.toLocaleString()} บาท${resolution === "credit" ? " ใช้หักยอดออเดอร์ถัดไปได้ทันที" : ""}`,
      ref: "/claims",
    });
    return { ok: true, credit_note: creditNote ? creditNote.number : null };
  });

  fns.adminDealerClaimReject = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const claimId = String(data.claimId || "");
    const claim = (await db.ref(`dealer_claims/${claimId}`).once("value")).val();
    if (!claim) throw new HttpsError("not-found", "ไม่พบคำขอเคลม");
    if (claim.status !== "submitted") throw new HttpsError("failed-precondition", "คำขอนี้ถูกตัดสินไปแล้ว");
    await db.ref(`dealer_claims/${claimId}`).update({
      status: "rejected",
      reject_reason: String(data.reason || "").trim() || null,
      decided_at: nowMs(),
      decided_by: caller.name || null,
    });
    await pushDealerNotification(db, claim.dealer_uid, {
      type: "claim_rejected",
      cat: "payment",
      title: "คำขอเคลมไม่ผ่านการอนุมัติ",
      body: `${claim.claim_no} · ${claim.model || ""}${data.reason ? ` — ${String(data.reason).trim()}` : ""}`,
      ref: "/claims",
    });
    return { ok: true };
  });

  // บันทึกว่าโอนเงินคืนแล้ว (ปิด AP ของเคลม refund)
  fns.adminDealerClaimMarkRefunded = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "FINANCE"]);
    const data = request.data || {};
    const claimId = String(data.claimId || "");
    const claim = (await db.ref(`dealer_claims/${claimId}`).once("value")).val();
    if (!claim) throw new HttpsError("not-found", "ไม่พบคำขอเคลม");
    if (claim.status !== "approved" || claim.resolution !== "refund") {
      throw new HttpsError("failed-precondition", "เคลมนี้ไม่ได้อยู่สถานะรอโอนเงินคืน");
    }
    await db.ref(`dealer_claims/${claimId}`).update({
      status: "resolved",
      resolved_at: nowMs(),
      refund_note: String(data.note || "").trim() || null,
      refunded_by: caller.name || null,
    });
    await pushDealerNotification(db, claim.dealer_uid, {
      type: "claim_refunded",
      cat: "payment",
      title: "โอนเงินคืนเคลมแล้ว",
      body: `${claim.claim_no} · ยอด ${(Number(claim.approved_amount) || 0).toLocaleString()} บาท — ตรวจสอบบัญชีของคุณ`,
      ref: "/claims",
    });
    return { ok: true };
  });

  // ช่องทางติดต่อสำหรับหน้า Help & Support — แอดมินตั้งที่ /dealer-settings
  // (settings/dealer/support) ไม่ตั้ง = portal ซ่อนการ์ดช่องทางนั้น ไม่โชว์ค่า placeholder
  fns.dealerGetSupportInfo = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    await requireDealerCaller(db, request.auth);
    const support = (await loadDealerSettings(db)).support || {};
    return {
      support: {
        line_id: support.line_id || null,
        phone: support.phone || null,
        hours: support.hours || null,
      },
    };
  });

  // เสนอ/แก้ซอง — แก้ได้จนกว่าจะปิดรับ ทุก revision ต่อท้าย history (ลบไม่ได้)
  fns.dealerPlaceBid = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, dealer, memberUid, memberName } = await requireDealerCaller(db, request.auth);
    const data = request.data || {};
    const lotId = String(data.lotId || "");
    const lot = (await db.ref(`lots/${lotId}`).once("value")).val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    if (lot.status !== "open") throw new HttpsError("failed-precondition", "lot นี้ปิดรับราคาแล้ว");
    // server clock เป็นตัวตัดสิน — กันกรณี scheduler ยังไม่ทัน close
    if (nowMs() >= Number(lot.close_at)) {
      throw new HttpsError("failed-precondition", "หมดเวลาเสนอราคาแล้ว");
    }
    const tier = String(dealer.tier || "").toUpperCase();
    if (!(lot.visible_tiers && lot.visible_tiers[tier] === true)) {
      throw new HttpsError("permission-denied", "lot นี้ไม่เปิดสำหรับ tier ของคุณ");
    }
    // Early access: บังคับซ้ำฝั่ง server (ชั้นแสดงผลอย่างเดียวไว้ใจไม่ได้)
    const tierOpenAtBid = (lot.tier_open_at && lot.tier_open_at[tier]) || 0;
    if (nowMs() < Number(tierOpenAtBid)) {
      throw new HttpsError(
        "failed-precondition",
        `lot นี้จะเปิดให้ tier ของคุณเวลา ${new Date(Number(tierOpenAtBid)).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`
      );
    }

    const type = data.type === "per_item" ? "per_item" : "whole_lot";
    const mode = lot.bid_mode || "both";
    if (mode !== "both" && mode !== type) {
      throw new HttpsError("invalid-argument", `lot นี้รับเฉพาะการเสนอแบบ ${mode === "whole_lot" ? "ยกล็อต" : "รายตัว"}`);
    }

    let amountTotal = null;
    let itemBids = null;
    if (type === "whole_lot") {
      amountTotal = Math.round(Number(data.amount_total));
      if (!Number.isFinite(amountTotal) || amountTotal <= 0) {
        throw new HttpsError("invalid-argument", "ยอดเสนอยกล็อตไม่ถูกต้อง");
      }
    } else {
      const raw = data.item_bids && typeof data.item_bids === "object" ? data.item_bids : {};
      itemBids = {};
      for (const [jobId, amt] of Object.entries(raw)) {
        if (!lot.items || !lot.items[jobId]) {
          throw new HttpsError("invalid-argument", "มีรายการเครื่องที่ไม่อยู่ใน lot นี้");
        }
        const n = Math.round(Number(amt));
        if (!Number.isFinite(n) || n <= 0) {
          throw new HttpsError("invalid-argument", `ราคาเสนอของ ${lot.items[jobId].model} ไม่ถูกต้อง`);
        }
        itemBids[jobId] = n;
      }
      if (Object.keys(itemBids).length === 0) {
        throw new HttpsError("invalid-argument", "ต้องเสนอราคาอย่างน้อย 1 เครื่อง");
      }
    }

    const bidRef = db.ref(`lot_bids/${lotId}/${dealerUid}`);
    const existing = (await bidRef.once("value")).val();
    const isRevision = Boolean(existing);

    let bidNo = existing && existing.bid_no;
    if (!bidNo) {
      const txn = await db.ref(`lot_private/${lotId}/bid_seq`).transaction((c) => (c || 0) + 1);
      bidNo = `B-${String(txn.snapshot.val() || 1).padStart(3, "0")}`;
    }

    const history = Array.isArray(existing && existing.history) ? existing.history.slice() : [];
    if (isRevision) {
      history.push({
        at: existing.updated_at || existing.created_at || nowMs(),
        type: existing.type,
        amount_total: existing.amount_total || null,
        item_bids: existing.item_bids || null,
        by: existing.updated_by || null, // audit รายคนในทีม
      });
    }

    await bidRef.set({
      bid_no: bidNo,
      type,
      amount_total: amountTotal,
      item_bids: itemBids,
      note: String(data.note || "").trim() || null,
      created_at: existing ? existing.created_at || nowMs() : nowMs(),
      updated_at: nowMs(),
      // ใครในร้านเป็นคนยื่น/แก้ครั้งล่าสุด (ทีมมีหลายคน — ต้อง trace ได้)
      updated_by: memberName || null,
      updated_by_uid: memberUid,
      history,
    });

    const { count } = await refreshBidCount(
      db, lotId, lot.show_bid_stats === true, lot.eligible_count || 0
    );
    await logLotAudit(db, lotId, isRevision ? "bid_revised" : "bid_placed", { bid_no: bidNo });

    // แจ้งแอดมินเฉพาะซองใหม่ (ไม่บอกใคร/เท่าไหร่ — บอกแค่จำนวน)
    if (!isRevision) {
      await dispatchAdminPush(
        {
          data: {
            type: "dealer_bid",
            title: `มีผู้เสนอราคา ${lot.lot_no || ""}`,
            body: `เสนอแล้ว ${count}/${lot.eligible_count || 0} ราย`,
            url: `/lots/${lotId}`,
          },
        },
        "dealerPlaceBid"
      );
      await dispatchTelegram(
        `🔒 <b>${lot.lot_no || lotId}</b> มีผู้เสนอราคาแล้ว ${count}/${lot.eligible_count || 0} ราย`,
        "dealerPlaceBid"
      );
    }
    return {
      ok: true,
      bid_no: bidNo,
      bid_count: lot.show_bid_stats === true ? count : null,
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // เปิดซอง + อนุมัติ (CEO/MANAGER เท่านั้น, หลังปิดรับเท่านั้น)
  // ───────────────────────────────────────────────────────────────────────────

  fns.adminDealerLotUnsealBids = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller, callerStaffId } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const lotId = String((request.data || {}).lotId || "");
    const lot = (await db.ref(`lots/${lotId}`).once("value")).val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    // กติกาเหล็ก: เปิดซองก่อนปิดรับไม่ได้ แม้เป็น CEO
    if (!["closed", "awarding", "awarded", "completed"].includes(lot.status)) {
      throw new HttpsError("failed-precondition", "ต้องปิดรับราคาก่อนจึงเปิดซองได้");
    }

    const [bidsSnap, privSnap, dealersSnap] = await Promise.all([
      db.ref(`lot_bids/${lotId}`).once("value"),
      db.ref(`lot_private/${lotId}`).once("value"),
      db.ref("dealers").once("value"),
    ]);
    const bidsMap = bidsSnap.exists() ? bidsSnap.val() : {};
    const priv = privSnap.val() || {};
    const dealersMap = dealersSnap.exists() ? dealersSnap.val() : {};

    if (!lot.unsealed_at && lot.status === "closed") {
      await db.ref(`lots/${lotId}`).update({
        status: "awarding",
        unsealed_at: nowMs(),
        unsealed_by: callerStaffId,
        unsealed_by_name: caller.name || null,
      });
      await logLotAudit(db, lotId, "unsealed", { by: caller.name || null });
    }

    const bids = Object.entries(bidsMap).map(([uid, b]) => {
      const d = dealersMap[uid] || {};
      return {
        dealer_uid: uid,
        company_name: d.company_name || "(ไม่พบข้อมูลดีลเลอร์)",
        tier: d.tier || null,
        phone: d.phone || null,
        bid_no: b.bid_no || null,
        type: b.type,
        amount_total: b.amount_total || null,
        item_bids: b.item_bids || null,
        note: b.note || null,
        created_at: b.created_at || null,
        updated_at: b.updated_at || null,
        revision_count: Array.isArray(b.history) ? b.history.length : 0,
      };
    });
    bids.sort((a, b) => (b.amount_total || 0) - (a.amount_total || 0));

    return {
      bids,
      private: {
        total_cost: priv.total_cost || 0,
        item_costs: priv.item_costs || {},
        reserve_price: priv.reserve_price || null,
        bid_count: priv.bid_count || 0,
      },
    };
  });

  fns.adminDealerLotAward = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller, callerStaffId } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const lotId = String(data.lotId || "");
    const lot = (await db.ref(`lots/${lotId}`).once("value")).val();
    if (!lot) throw new HttpsError("not-found", "ไม่พบ lot");
    if (lot.status !== "awarding") {
      throw new HttpsError("failed-precondition", "ต้องเปิดซองก่อนจึงอนุมัติได้");
    }

    const [bidsSnap, privSnap, dealersSnap] = await Promise.all([
      db.ref(`lot_bids/${lotId}`).once("value"),
      db.ref(`lot_private/${lotId}`).once("value"),
      db.ref("dealers").once("value"),
    ]);
    const bidsMap = bidsSnap.exists() ? bidsSnap.val() : {};
    const priv = privSnap.val() || {};
    const dealersMap = dealersSnap.exists() ? dealersSnap.val() : {};

    // สร้างรายการ award ต่อดีลเลอร์ — "ยอดมาจากซองจริงเสมอ" (server อ่านเอง
    // จาก lot_bids ไม่รับตัวเลขจาก client — กันแก้ยอดตอนอนุมัติ)
    const type = data.type === "per_item" ? "per_item" : "whole_lot";
    /** @type {Map<string, {items: Record<string, number>, amount: number}>} */
    const perDealer = new Map();

    if (type === "whole_lot") {
      const winnerUid = String(data.dealer_uid || "");
      const bid = bidsMap[winnerUid];
      if (!bid || bid.type !== "whole_lot" || !bid.amount_total) {
        throw new HttpsError("invalid-argument", "ดีลเลอร์ที่เลือกไม่มีซองแบบยกล็อต");
      }
      const itemAmounts = {};
      for (const jobId of Object.keys(lot.items || {})) itemAmounts[jobId] = 0; // ราคารายตัวไม่ระบุ — ยอดอยู่ที่ก้อนรวม
      perDealer.set(winnerUid, { items: itemAmounts, amount: Math.round(Number(bid.amount_total)) });
    } else {
      const itemAwards = data.item_awards && typeof data.item_awards === "object" ? data.item_awards : {};
      const entries = Object.entries(itemAwards);
      if (entries.length === 0) throw new HttpsError("invalid-argument", "ต้องเลือกผู้ชนะอย่างน้อย 1 เครื่อง");
      for (const [jobId, uid] of entries) {
        if (!lot.items || !lot.items[jobId]) {
          throw new HttpsError("invalid-argument", "มีเครื่องที่ไม่อยู่ใน lot นี้");
        }
        const bid = bidsMap[String(uid)];
        const amt = bid && bid.item_bids && bid.item_bids[jobId];
        if (!amt) {
          throw new HttpsError("invalid-argument", `ดีลเลอร์ที่เลือกไม่ได้เสนอราคาเครื่อง ${lot.items[jobId].model}`);
        }
        const cur = perDealer.get(String(uid)) || { items: {}, amount: 0 };
        cur.items[jobId] = Math.round(Number(amt));
        cur.amount += Math.round(Number(amt));
        perDealer.set(String(uid), cur);
      }
    }

    const totalAmount = [...perDealer.values()].reduce((s, v) => s + v.amount, 0);
    const reserve = Number(priv.reserve_price) || 0;
    if (reserve > 0 && totalAmount < reserve && data.below_reserve_ack !== true) {
      throw new HttpsError(
        "failed-precondition",
        `ยอดรวม ${totalAmount.toLocaleString()} ต่ำกว่าราคาขั้นต่ำ ${reserve.toLocaleString()} — ยืนยันอีกครั้งเพื่ออนุมัติต่ำกว่า reserve`
      );
    }

    const settings = await loadDealerSettings(db);
    const vatRate = 0.07; // ยอดเสนอเป็น VAT-inclusive — แตก VAT ตอนออกใบกำกับ (onSaleCreated)
    const orders = [];
    const awardedJobIds = new Set();

    for (const [dealerUid, alloc] of perDealer.entries()) {
      const d = dealersMap[dealerUid] || {};
      const orderRef = db.ref("dealer_orders").push();
      const orderId = orderRef.key;
      const orderNo = await allocateDealerNumber(db, "order", settings.order_prefix || "DO-", nowMs());
      const qtNo = await allocateDealerNumber(db, "quotation", settings.quotation_prefix || "QT-", nowMs());

      const orderItems = {};
      for (const [jobId, amt] of Object.entries(alloc.items)) {
        awardedJobIds.add(jobId);
        const it = (lot.items && lot.items[jobId]) || {};
        orderItems[jobId] = { model: it.model || "-", ref_no: it.ref_no || null, amount: amt };
      }

      const order = {
        order_no: orderNo,
        lot_id: lotId,
        lot_no: lot.lot_no || null,
        dealer_uid: dealerUid,
        dealer_snapshot: {
          company_name: d.company_name || null,
          tax_id: d.tax_id || null,
          address: d.address || null,
          contact_name: d.contact_name || null,
          phone: d.phone || null,
          email: d.email || null,
        },
        type,
        items: orderItems,
        item_count: Object.keys(orderItems).length,
        amount: alloc.amount, // VAT-inclusive
        vat_rate: vatRate,
        status: "pending_payment",
        quotation: { number: qtNo, issued_at: nowMs() },
        payment_info: settings.payment_info || null,
        created_at: nowMs(),
        created_by: caller.name || null,
        // staff id ของคนออกรายการ — ระบบจัดของใช้บังคับแบ่งหน้าที่ (four-eyes):
        // คนออกรายการห้ามเป็นคนสแกนจัดของเอง
        created_by_id: callerStaffId || null,
      };

      // ใบเสนอราคา PDF (best-effort — พังแล้วออเดอร์ยังเกิด แนบทีหลังได้)
      let pdfBuffer = null;
      try {
        // ใบเสนอราคาออกในนามนิติบุคคล (เก็ทโมบี้) โดย trade name = GETMOBIE
        // ไม่ใช่ BKK APPLE (แบรนด์ฝั่งรับซื้อ)
        pdfBuffer = await buildQuotationPdf({ ...order, id: orderId }, { tradeName: DEALER_BRAND });
        const url = await archivePdf(`dealer_quotations/${orderId}.pdf`, pdfBuffer, orderId);
        order.quotation.storage_path = `dealer_quotations/${orderId}.pdf`;
        order.quotation.url = url;
      } catch (e) {
        console.error(`[dealer] quotation PDF failed ${orderId}:`, e?.message || e);
      }

      await orderRef.set(order);
      await pushStatusLog(db, orderId, "pending_payment", caller.name || null);
      orders.push({ id: orderId, ...order });

      if (d.email) {
        try {
          const mail = buildAwardEmail({ ...order, id: orderId }, lot, settings.payment_info);
          await sendEmail({
            to: d.email,
            from: dealerEmailFrom(),
            ...mail,
            attachments: pdfBuffer
              ? [{ filename: `ใบเสนอราคา-${qtNo}.pdf`, content: pdfBuffer.toString("base64") }]
              : undefined,
          });
        } catch (e) {
          console.error(`[dealer] award email failed ${orderId}:`, e?.message || e);
        }
      }
      await pushDealerNotification(db, dealerUid, {
        type: "won",
        cat: "result",
        title: "ยินดีด้วย คุณชนะประมูล",
        body: `${orderNo} · ยอด ${formatTHB(alloc.amount)} — ดูใบเสนอราคาและชำระเงิน`,
        ref: `/orders/${orderId}`,
      });
    }

    // ปลดเครื่องที่ไม่ถูกซื้อกลับสต๊อก + ปิดสถานะ lot
    const prevStatus = priv.prev_status || {};
    const updates = {};
    updates[`lots/${lotId}/status`] = "awarded";
    updates[`lots/${lotId}/awarded_at`] = nowMs();
    updates[`lots/${lotId}/award`] = {
      type,
      dealer_uid: type === "whole_lot" ? [...perDealer.keys()][0] : null,
      total_amount: totalAmount,
      order_ids: orders.map((o) => o.id),
      below_reserve: reserve > 0 && totalAmount < reserve,
      approved_by: callerStaffId,
      approved_by_name: caller.name || null,
      approved_at: nowMs(),
    };
    for (const jobId of Object.keys(lot.items || {})) {
      if (!awardedJobIds.has(jobId)) {
        updates[`jobs/${jobId}/status`] = prevStatus[jobId] || "In Stock";
        updates[`jobs/${jobId}/lot_id`] = null;
        updates[`jobs/${jobId}/lot_no`] = null;
      }
    }
    await db.ref().update(updates);
    await logLotAudit(db, lotId, "awarded", {
      by: caller.name || null,
      type,
      total_amount: totalAmount,
      order_nos: orders.map((o) => o.order_no),
      below_reserve: reserve > 0 && totalAmount < reserve,
      note: String(data.note || "").trim() || null,
    });

    // แจ้งดีลเลอร์ที่ไม่ได้รับเลือก (best-effort)
    const loserUids = Object.keys(bidsMap).filter((uid) => !perDealer.has(uid));
    await Promise.allSettled(
      loserUids
        .map((uid) => dealersMap[uid])
        .filter((d) => d && d.email)
        .map((d) => sendEmail({ to: d.email, from: dealerEmailFrom(), ...buildLoseEmail(lot) }))
    );
    await Promise.allSettled(
      loserUids.map((uid) =>
        pushDealerNotification(db, uid, {
          type: "lost",
          cat: "result",
          title: `ประกาศผล ${lot.lot_no || ""}`,
          body: "ครั้งนี้ข้อเสนอของคุณไม่ได้รับเลือก — แล้วพบกันในล็อตถัดไป",
          ref: "/lots",
        })
      )
    );

    await dispatchTelegram(
      `✅ <b>อนุมัติ ${lot.lot_no || lotId}</b>\nยอดรวม ${totalAmount.toLocaleString()} บาท · ${orders.length} คำสั่งซื้อ · โดย ${caller.name || "-"}`,
      "dealerLotAward"
    );
    return { ok: true, orders: orders.map((o) => ({ id: o.id, order_no: o.order_no, amount: o.amount })) };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Phase 2 — ชำระเงิน + จัดส่ง
  // ───────────────────────────────────────────────────────────────────────────

  fns.dealerSubmitPaymentSlip = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { dealerUid, memberName } = await requireDealerCaller(db, request.auth);
    const data = request.data || {};
    const orderId = String(data.orderId || "");
    const slipUrl = String(data.slip_url || "").trim();
    if (!slipUrl) throw new HttpsError("invalid-argument", "ต้องแนบหลักฐานการชำระเงิน");
    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order || order.dealer_uid !== dealerUid) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    if (!["pending_payment", "payment_review"].includes(order.status)) {
      throw new HttpsError("failed-precondition", "คำสั่งซื้อนี้ไม่ได้รอการชำระเงิน");
    }

    await db.ref(`dealer_orders/${orderId}`).update({
      status: "payment_review",
      payment: {
        ...(order.payment || {}),
        slip_url: slipUrl,
        submitted_at: nowMs(),
        submitted_by: memberName || null,
      },
    });
    await pushStatusLog(db, orderId, "payment_review", null);

    const targets = await staffIdsByRoles(db, ["CEO", "FINANCE"]);
    await dispatchAdminPush(
      {
        data: {
          type: "dealer_payment",
          title: `สลิปเข้า ${order.order_no}`,
          body: `${order.dealer_snapshot?.company_name || "ดีลเลอร์"} แจ้งชำระ ${Number(order.amount).toLocaleString()} บาท — รอตรวจสอบ`,
          url: `/dealer-orders`,
        },
      },
      "dealerPaymentSlip",
      "admin",
      targets
    );
    return { ok: true };
  });

  // verify สลิป → เขียน /sales (onSaleCreated เดิมออกใบกำกับภาษีเต็มรูป —
  // dealer_snapshot มี tax_id) + ตัดสต๊อก Sold ในจังหวะเดียว
  fns.adminDealerOrderMarkPaid = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "FINANCE"]);
    const orderId = String((request.data || {}).orderId || "");
    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    if (!["pending_payment", "payment_review"].includes(order.status)) {
      throw new HttpsError("failed-precondition", `คำสั่งซื้อสถานะ "${order.status}" ยืนยันชำระไม่ได้`);
    }
    if (order.sale_id) throw new HttpsError("failed-precondition", "คำสั่งซื้อนี้บันทึกการขายไปแล้ว");

    const jobIds = Object.keys(order.items || {});
    const jobs = await readLotJobs(db, jobIds);
    let totalCost = 0;
    const saleItems = jobIds.map((jobId) => {
      const job = jobs[jobId] || {};
      const cost = stockCostOf(job);
      totalCost += cost;
      const perItemAmount = Number(order.items[jobId].amount) || 0;
      return {
        id: jobId,
        type: "DEVICE",
        name: order.items[jobId].model || job.model || "-",
        // code โผล่บนใบกำกับภาษีขายที่ส่งให้ดีลเลอร์ — ใช้ stock_no เท่านั้น
        // ห้าม fallback ไป job.ref_no (OID โยงถึงราคารับซื้อหน้าบ้าน)
        code: order.items[jobId].ref_no || job.stock_no || null,
        // ยกล็อตราคารายตัวเป็น 0 — ยอดจริงอยู่ grand_total (ใบกำกับใช้ยอดรวม)
        price: perItemAmount,
        cost,
        qty: 1,
      };
    });

    // หักเครดิตจากเคลม (ถ้าแอดมินเลือกใช้) — เครดิตเป็น "วิธีชำระ" ไม่ใช่ส่วนลด:
    // ใบกำกับขายยังเต็มยอดออเดอร์ VAT ไม่เปลี่ยน (ใบลดหนี้ออกไปแล้วตอนอนุมัติเคลม)
    const useCredit = (request.data || {}).use_credit === true;
    let creditApplied = 0;
    if (useCredit) {
      const bal = Number((await db.ref(`dealers/${order.dealer_uid}/credit_balance`).once("value")).val()) || 0;
      creditApplied = Math.min(bal, Number(order.amount) || 0);
      if (creditApplied > 0) {
        await adjustDealerCredit(db, order.dealer_uid, -creditApplied, {
          source: "order_payment",
          ref: order.order_no || orderId,
          by: caller.name || null,
        });
      }
    }

    const ds = order.dealer_snapshot || {};
    const saleRef = db.ref("sales").push();
    const sale = {
      receipt_no: order.order_no,
      customer_name: ds.company_name || "ดีลเลอร์",
      customer_phone: ds.phone || null,
      customer_email: ds.email || null,
      customer_tax_id: ds.tax_id || null, // มี tax_id → onSaleCreated ออกใบกำกับเต็มรูป
      customer_address: ds.address || null,
      subtotal: Number(order.amount) || 0,
      discount: 0,
      grand_total: Number(order.amount) || 0, // VAT-inclusive ตามแนว POS
      total_cost: totalCost,
      net_profit: (Number(order.amount) || 0) - totalCost,
      payment_method: creditApplied > 0 ? (creditApplied >= (Number(order.amount) || 0) ? "CREDIT" : "TRANSFER+CREDIT") : "TRANSFER",
      items: saleItems,
      sold_at: nowMs(),
      cashier: caller.name || null,
      channel: "dealer",
      dealer_uid: order.dealer_uid,
      dealer_order_id: orderId,
    };
    await saleRef.set(sale);

    const updates = {};
    updates[`dealer_orders/${orderId}/status`] = "paid";
    updates[`dealer_orders/${orderId}/sale_id`] = saleRef.key;
    if (creditApplied > 0) updates[`dealer_orders/${orderId}/credit_applied`] = creditApplied;
    updates[`dealer_orders/${orderId}/payment/verified_by`] = caller.name || null;
    updates[`dealer_orders/${orderId}/payment/verified_at`] = nowMs();
    for (const jobId of jobIds) {
      updates[`jobs/${jobId}/status`] = "Sold";
      updates[`jobs/${jobId}/sold_date`] = nowMs();
      updates[`jobs/${jobId}/sold_channel`] = "dealer";
      updates[`jobs/${jobId}/sale_id`] = saleRef.key;
    }
    await db.ref().update(updates);
    await pushStatusLog(db, orderId, "paid", caller.name || null);
    if (order.lot_id) {
      await logLotAudit(db, order.lot_id, "order_paid", {
        order_no: order.order_no,
        amount: Number(order.amount) || 0,
        by: caller.name || null,
      });
    }
    // สถิติสะสมของดีลเลอร์ (server เขียนคนเดียว) — โชว์ในหน้า /dealers + analytics
    // monthly/{YYYYMM} (เดือนไทย) ใช้เป็นฐานเกณฑ์ยอดสะสมของ tier suggestion
    const { ym } = bangkokYM(nowMs());
    let monthTotal = 0;
    await db.ref(`dealers/${order.dealer_uid}/stats`).transaction((cur) => {
      const c = cur || {};
      const monthly = { ...(c.monthly || {}) };
      monthly[ym] = (Number(monthly[ym]) || 0) + (Number(order.amount) || 0);
      monthTotal = monthly[ym];
      return {
        ...c,
        orders: (Number(c.orders) || 0) + 1,
        total_amount: (Number(c.total_amount) || 0) + (Number(order.amount) || 0),
        last_order_at: nowMs(),
        monthly,
      };
    });
    await maybeSuggestTierUpgrade(db, order, monthTotal);
    return { ok: true, sale_id: saleRef.key };
  });

  // ── ระบบจัดของ (picking) — สแกนบาร์โค้ดเช็คของก่อนส่ง ─────────────────────
  // แบ่งหน้าที่ (four-eyes): คนออกรายการ (award → created_by_id) ห้ามเป็นคน
  // สแกนจัดของเอง — CEO override ได้ (ระบบประทับไว้ใน picking node)
  // การสแกนจับคู่กับ qc_txn_id / IMEI / serial / stock_no / ref_no ของเครื่องใน
  // ออเดอร์ (บาร์โค้ดสติกเกอร์ QC = TXN id, กล่องเครื่อง = IMEI)
  fns.adminDealerOrderPicking = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller, callerStaffId, callerRole } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER", "STAFF"]);
    const data = request.data || {};
    const orderId = String(data.orderId || "");
    const action = String(data.action || "");
    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    if (!["paid", "preparing"].includes(order.status)) {
      throw new HttpsError("failed-precondition", "จัดของได้เฉพาะออเดอร์ที่ยืนยันการชำระแล้ว");
    }
    const jobIds = Object.keys(order.items || {});
    if (jobIds.length === 0) throw new HttpsError("failed-precondition", "ออเดอร์ไม่มีรายการเครื่อง");
    const picking = order.picking || {};

    // four-eyes: เทียบ staff id ของคนออกรายการ (ออเดอร์เก่าไม่มี id ให้เทียบชื่อ)
    const sameAsCreator = order.created_by_id
      ? order.created_by_id === callerStaffId
      : !!order.created_by && order.created_by === (caller.name || null);
    if (sameAsCreator && callerRole !== "CEO") {
      throw new HttpsError("permission-denied",
        "คนออกรายการห้ามจัดของเอง — ให้แอดมินอีกคนเป็นผู้สแกนจัดของ");
    }

    if (action === "scan") {
      const code = String(data.code || "").trim().toUpperCase();
      if (!code) throw new HttpsError("invalid-argument", "ไม่มีรหัสที่สแกน");
      const jobs = await readLotJobs(db, jobIds);
      const matchId = jobIds.find((id) => {
        const j = jobs[id] || {};
        return [j.qc_txn_id, j.imei, j.serial, j.stock_no, j.ref_no]
          .filter(Boolean)
          .map((s) => String(s).toUpperCase())
          .includes(code);
      });
      if (!matchId) {
        throw new HttpsError("not-found", `ไม่พบ "${code}" ในออเดอร์นี้ — เช็คว่าหยิบถูกเครื่อง/ถูกออเดอร์`);
      }
      const already = !!(picking.items && picking.items[matchId]);
      if (!already) {
        await db.ref(`dealer_orders/${orderId}/picking`).update({
          [`items/${matchId}`]: { at: nowMs(), by: caller.name || null, by_id: callerStaffId || null, code },
          ...(picking.started_at ? {} : {
            started_at: nowMs(),
            started_by: caller.name || null,
            started_by_id: callerStaffId || null,
            ...(sameAsCreator ? { creator_override: true } : {}),
          }),
        });
      }
      const picked = Object.keys(picking.items || {}).length + (already ? 0 : 1);
      const it = order.items[matchId] || {};
      return { ok: true, jobId: matchId, model: it.model || "-", ref_no: it.ref_no || null, already, picked, total: jobIds.length };
    }

    if (action === "undo") {
      const jobId = String(data.jobId || "");
      if (!jobId || !order.items[jobId]) throw new HttpsError("invalid-argument", "ไม่พบเครื่องนี้ในออเดอร์");
      await db.ref(`dealer_orders/${orderId}/picking/items/${jobId}`).remove();
      return { ok: true };
    }

    if (action === "complete") {
      const items = picking.items || {};
      const missing = jobIds.filter((id) => !items[id]);
      if (missing.length > 0) {
        throw new HttpsError("failed-precondition", `ยังสแกนไม่ครบ — ขาดอีก ${missing.length} เครื่อง`);
      }
      await db.ref(`dealer_orders/${orderId}/picking`).update({
        status: "done",
        completed_at: nowMs(),
        completed_by: caller.name || null,
        completed_by_id: callerStaffId || null,
      });
      if (order.status === "paid") {
        await db.ref(`dealer_orders/${orderId}/status`).set("preparing");
        await pushStatusLog(db, orderId, "preparing", caller.name || null);
      }
      return { ok: true };
    }

    throw new HttpsError("invalid-argument", "action ไม่ถูกต้อง");
  });

  fns.adminDealerOrderShip = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER", "STAFF"]);
    const data = request.data || {};
    const orderId = String(data.orderId || "");
    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    if (!["paid", "preparing"].includes(order.status)) {
      throw new HttpsError("failed-precondition", "ต้องยืนยันการชำระเงินก่อนจัดส่ง");
    }
    // ต้องจัดของ (สแกนครบทุกเครื่อง) ก่อนจึงส่งได้ — กันส่งผิดเครื่อง/ส่งไม่ครบ
    if (!order.picking || order.picking.status !== "done") {
      throw new HttpsError("failed-precondition", "ต้องจัดของ (สแกนเช็คครบทุกเครื่อง) ก่อนจัดส่ง — กดปุ่ม 'จัดของ' ในออเดอร์");
    }
    await db.ref(`dealer_orders/${orderId}`).update({
      status: "shipped",
      shipping: {
        method: String(data.method || "").trim() || null,
        tracking_no: String(data.tracking_no || "").trim() || null,
        shipped_at: nowMs(),
        shipped_by: caller.name || null,
      },
    });
    await pushStatusLog(db, orderId, "shipped", caller.name || null);
    return { ok: true };
  });

  fns.adminDealerOrderComplete = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER", "STAFF"]);
    const orderId = String((request.data || {}).orderId || "");
    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    if (order.status !== "shipped") {
      throw new HttpsError("failed-precondition", "ต้องจัดส่งก่อนจึงปิดงานได้");
    }
    await db.ref(`dealer_orders/${orderId}`).update({ status: "completed", completed_at: nowMs() });
    await pushStatusLog(db, orderId, "completed", caller.name || null);

    // ทุกออเดอร์ของ lot จบ → lot completed
    if (order.lot_id) {
      const lot = (await db.ref(`lots/${order.lot_id}`).once("value")).val();
      const orderIds = (lot && lot.award && lot.award.order_ids) || [];
      if (orderIds.length > 0) {
        const statuses = await Promise.all(
          orderIds.map((id) => db.ref(`dealer_orders/${id}/status`).once("value"))
        );
        const allDone = statuses.every((s) => ["completed", "cancelled"].includes(s.val()));
        if (allDone) {
          await db.ref(`lots/${order.lot_id}`).update({ status: "completed", completed_at: nowMs() });
          await logLotAudit(db, order.lot_id, "completed", null);
        }
      }
    }
    return { ok: true };
  });

  fns.adminDealerOrderCancel = onCall({ region: REGION }, async (request) => {
    const db = getDatabase();
    const { caller } = await requireStaffRole(db, request.auth, ["CEO", "MANAGER"]);
    const data = request.data || {};
    const orderId = String(data.orderId || "");
    const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
    if (!order) throw new HttpsError("not-found", "ไม่พบคำสั่งซื้อ");
    // จ่ายแล้ว/ส่งแล้ว = ยกเลิกผ่านระบบไม่ได้ (ต้องทำเรื่องคืนเงิน/คืนของแยก)
    if (!["pending_payment", "payment_review"].includes(order.status)) {
      throw new HttpsError("failed-precondition", `คำสั่งซื้อสถานะ "${order.status}" ยกเลิกไม่ได้`);
    }

    const priv = order.lot_id
      ? (await db.ref(`lot_private/${order.lot_id}`).once("value")).val() || {}
      : {};
    const prevStatus = priv.prev_status || {};
    const updates = {};
    updates[`dealer_orders/${orderId}/status`] = "cancelled";
    updates[`dealer_orders/${orderId}/cancelled_at`] = nowMs();
    updates[`dealer_orders/${orderId}/cancelled_reason`] = String(data.reason || "").trim() || null;
    for (const jobId of Object.keys(order.items || {})) {
      const job = (await db.ref(`jobs/${jobId}`).once("value")).val();
      if (job && job.lot_id === order.lot_id && job.status === "Reserved") {
        updates[`jobs/${jobId}/status`] = prevStatus[jobId] || "In Stock";
        updates[`jobs/${jobId}/lot_id`] = null;
        updates[`jobs/${jobId}/lot_no`] = null;
      }
    }
    await db.ref().update(updates);
    await pushStatusLog(db, orderId, "cancelled", caller.name || null);
    if (order.lot_id) {
      await logLotAudit(db, order.lot_id, "order_cancelled", {
        order_no: order.order_no,
        reason: String(data.reason || "").trim() || null,
        by: caller.name || null,
      });
    }
    return { ok: true };
  });

  // milestone email ถึงดีลเลอร์เมื่อสถานะออเดอร์เปลี่ยน (allowlist — สถานะที่
  // ไม่อยู่ใน ORDER_STATUS_COPY ไม่ส่ง) กันส่งซ้ำด้วย email_sent/{status}
  fns.onDealerOrderStatusNotify = onValueUpdated(
    { ref: "/dealer_orders/{orderId}/status", region: REGION },
    async (event) => {
      try {
        const status = event.data.after.val();
        const copy = ORDER_STATUS_COPY[status];
        if (!copy) return;
        const orderId = event.params.orderId;
        const db = getDatabase();
        const order = (await db.ref(`dealer_orders/${orderId}`).once("value")).val();
        if (!order) return;

        const guardRef = db.ref(`dealer_orders/${orderId}/email_sent/${status}`);
        if ((await guardRef.once("value")).exists()) return;
        await guardRef.set(nowMs());

        // in-app notification (หมวดตามสถานะ) — ส่งแม้ไม่มีอีเมล
        const NOTIF_CAT = { paid: "payment", shipped: "shipping", completed: "shipping", cancelled: "result" };
        await pushDealerNotification(db, order.dealer_uid, {
          type: `order_${status}`,
          cat: NOTIF_CAT[status] || "payment",
          title: copy.heading,
          body:
            status === "shipped" && order.shipping && order.shipping.tracking_no
              ? `${order.order_no} · ${order.shipping.method || ""} เลขพัสดุ ${order.shipping.tracking_no}`.trim()
              : `${order.order_no} · ยอด ${formatTHB(order.amount)}`,
          ref: `/orders/${orderId}`,
        });

        const email = order.dealer_snapshot && order.dealer_snapshot.email;
        if (!email) return;

        await sendEmail({
          to: email,
          from: dealerEmailFrom(),
          subject: `${copy.heading} — ${order.order_no}`,
          html: dealerShell({
            heading: copy.heading,
            intro: copy.intro({ ...order, id: orderId }),
            bodyHtml: `<div style="text-align:center;margin-top:8px;">
              <a href="${portalBaseUrl()}/orders/${esc(orderId)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">ดูสถานะคำสั่งซื้อ</a>
            </div>`,
          }),
        });
      } catch (e) {
        console.error("[dealer] onDealerOrderStatusNotify failed:", e?.message || e);
      }
    }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Scheduler — ปิดรับอัตโนมัติเมื่อถึง close_at (+ เตือนใกล้ปิดรับ Phase 3)
  // query ตาม .indexOn: status เฉพาะ lot ที่ open — node เล็ก ไม่ผิดกฎ RTDB cost
  // ───────────────────────────────────────────────────────────────────────────
  const CLOSING_SOON_MS = 60 * 60 * 1000; // เตือน 1 ชม.ก่อนปิดรับ

  fns.dealerLotScheduler = onSchedule(
    { schedule: "every 5 minutes", region: REGION, timeZone: "Asia/Bangkok" },
    async () => {
      const db = getDatabase();
      try {
        const snap = await db.ref("lots").orderByChild("status").equalTo("open").once("value");
        if (!snap.exists()) return;
        const now = nowMs();
        const openLots = [];
        snap.forEach((child) => {
          openLots.push({ id: child.key, lot: child.val() });
        });

        // 1) ปิดรับอัตโนมัติเมื่อเลย close_at
        const toClose = openLots.filter(({ lot }) => lot && Number(lot.close_at) > 0 && now >= Number(lot.close_at));
        await Promise.all(toClose.map(({ id, lot }) => closeLotInternal(db, id, lot, null)));
        if (toClose.length > 0) console.log(`[dealer] scheduler closed ${toClose.length} lot(s)`);

        const stillOpen = openLots.filter(({ lot }) => lot && now < Number(lot.close_at));
        if (stillOpen.length === 0) return;
        const dealers = await loadActiveDealers(db);

        for (const { id, lot } of stillOpen) {
          // 2) Early access: tier ที่หน้าต่างเพิ่งเปิด → ส่งอีเมลเปิด lot (ครั้งเดียวต่อ tier)
          const tierOpenAt = lot.tier_open_at || {};
          const notified = lot.tier_notified || {};
          const dueTiers = Object.keys(lot.visible_tiers || {}).filter(
            (t) => !notified[t] && Number(tierOpenAt[t] || 0) <= now
          );
          if (dueTiers.length > 0) {
            const mail = buildLotOpenEmail({ ...lot, id });
            const targets = dealers.filter(
              (d) => d.email && dueTiers.includes(String(d.tier || "").toUpperCase())
            );
            await Promise.allSettled(targets.map((d) => sendEmail({ to: d.email, from: dealerEmailFrom(), ...mail })));
            await Promise.allSettled(
              dealers
                .filter((d) => dueTiers.includes(String(d.tier || "").toUpperCase()))
                .map((d) =>
                  pushDealerNotification(db, d.uid, {
                    type: "lot_open",
                    cat: "lot",
                    title: "ล็อตใหม่เปิดรับราคา",
                    body: `${lot.lot_no || ""}${lot.title ? ` · ${lot.title}` : ""} · ${lot.item_count || "-"} เครื่อง`,
                    ref: `/lots/${id}`,
                  })
                )
            );
            for (const t of dueTiers) await db.ref(`lots/${id}/tier_notified/${t}`).set(now);
            console.log(`[dealer] early-access mail ${lot.lot_no || id} tiers=${dueTiers.join(",")} sent=${targets.length}`);
          }

          // 3) ใกล้ปิดรับ (1 ชม.) → เตือนเฉพาะดีลเลอร์ที่มีสิทธิ์แต่ยังไม่เสนอ (ครั้งเดียว)
          if (!lot.closing_soon_at && Number(lot.close_at) - now <= CLOSING_SOON_MS) {
            const bidsSnap = await db.ref(`lot_bids/${id}`).once("value");
            const bidderUids = new Set(bidsSnap.exists() ? Object.keys(bidsSnap.val()) : []);
            const targets = eligibleDealersOf(dealers, lot.visible_tiers || {}).filter(
              (d) =>
                d.email &&
                !bidderUids.has(d.uid) &&
                Number((lot.tier_open_at || {})[String(d.tier || "").toUpperCase()] || 0) <= now
            );
            const closeText = new Date(Number(lot.close_at)).toLocaleString("th-TH", {
              timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short",
            });
            await Promise.allSettled(
              targets.map((d) =>
                sendEmail({
                  to: d.email,
                  from: dealerEmailFrom(),
                  subject: `ใกล้ปิดรับราคา ${lot.lot_no || ""} — เหลือไม่ถึง 1 ชั่วโมง`,
                  html: dealerShell({
                    heading: `ล็อต ${esc(lot.lot_no || "")} ใกล้ปิดรับราคา`,
                    intro: `${esc(lot.title || "")} · ปิดรับ ${esc(closeText)} — คุณยังไม่ได้เสนอราคา`,
                    bodyHtml: `<div style="text-align:center;margin-top:8px;">
                      <a href="${portalBaseUrl()}/lots/${esc(id)}" style="display:inline-block;background:#111827;color:#ffffff;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;">เสนอราคาตอนนี้</a>
                    </div>`,
                  }),
                })
              )
            );
            await Promise.allSettled(
              targets.map((d) =>
                pushDealerNotification(db, d.uid, {
                  type: "lot_closing",
                  cat: "lot",
                  title: "อีก 1 ชั่วโมงจะปิดรับราคา",
                  body: `คุณยังไม่ได้เสนอราคา ${lot.lot_no || ""}`,
                  ref: `/lots/${id}`,
                })
              )
            );
            await db.ref(`lots/${id}/closing_soon_at`).set(now);
            console.log(`[dealer] closing-soon mail ${lot.lot_no || id} sent=${targets.length}`);
          }
        }
      } catch (e) {
        console.error("[dealer] scheduler failed:", e?.message || e);
      }
    }
  );

  return fns;
}

module.exports = { registerDealerPortal };
