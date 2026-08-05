// =============================================================================
// Email templates — เปิด/ปิด และแก้ข้อความอีเมลรายสถานะจากหน้า /email-settings
//
// เจตนา: `email.js` ยังเป็นเจ้าของ "โครงอีเมล" ทั้งหมด (layout, การ์ดสรุป
// ยอดเงิน, ปุ่มติดตาม, ใบสำคัญรับเงิน) — ที่หน้าตั้งค่าแก้ได้คือ **ข้อความ**
// สามบรรทัดต่อสถานะเท่านั้น (subject / heading / intro) บวกสวิตช์เปิด-ปิด
// แยกฝั่งลูกค้ากับฝั่งแอดมิน. เหตุผลที่ไม่เปิดให้แก้ HTML ทั้งก้อน:
//   - การ์ดยอดเงินและใบกำกับ/ใบสำคัญรับเงินเป็นเอกสารที่มีผลทางบัญชี/ภาษี
//     แก้ถ้อยคำอิสระแล้วผิดสาระสำคัญได้ (ม.86/4) — ของพวกนี้ต้องมาจากโค้ด
//   - เทมเพลตเริ่มต้นหลายตัวมีเงื่อนไข (เช่น Pickup/Mail-in/Store-in พูดคนละ
//     อย่าง) ซึ่ง textarea แทนไม่ได้ — จึงใช้เป็น **override**: ช่องว่าง =
//     ใช้ค่าจากโค้ดตามเดิมพร้อมเงื่อนไขครบ, กรอกแล้ว = ใช้ข้อความที่กรอก
//
// fail-open ทุกทางเหมือน notification-settings: อ่านไม่ได้ / ไม่มี node /
// ไม่มี key = ส่งตามเดิม มีแต่ `false` ที่แอดมินกดเองเท่านั้นที่ปิด. master
// gate `settings/accounting/order_emails_enabled` ยังคุมทับอีกชั้นตามเดิม
//
// เก็บที่ `settings/email_templates/{key}` — อยู่ใต้ `settings` จึงใช้ rule
// เดิม (read = auth, write = admin) ไม่ต้อง deploy rules ใหม่
// =============================================================================

const TEMPLATES_PATH = "settings/email_templates";

// สถานะที่ข้อความเป็นเอกสารทางบัญชี — เปิด/ปิดได้ แต่ห้ามแก้ถ้อยคำ
// (ลูกค้าได้ใบสำคัญรับเงิน, แอดมินได้สรุปการซื้อขายเต็มรูปแบบ)
const LOCKED_COPY_KEYS = new Set(["paid"]);

/** อ่าน override ทั้งหมด — คืน {} เมื่ออ่านไม่ได้ (fail-open) */
async function loadEmailTemplates(db) {
  try {
    return (await db.ref(TEMPLATES_PATH).once("value")).val() || {};
  } catch (e) {
    console.warn("[emailTemplates] read failed:", e?.message || e);
    return {};
  }
}

/**
 * สวิตช์เปิด-ปิดรายสถานะ แยกฝั่งลูกค้า/แอดมิน.
 * scope = "customer" | "admin". มีแต่ `false` ชัดๆ เท่านั้นที่ปิด
 */
function emailEnabled(templates, key, scope) {
  const t = templates && templates[key];
  if (!t) return true;
  const field = scope === "admin" ? t.admin_enabled : t.customer_enabled;
  return field !== false;
}

/** ตัวแปรที่ใช้ในข้อความได้ — เพิ่มตัวใหม่ต้องเพิ่มที่ UI ด้วย (ช่องช่วยจำ) */
function placeholderValues(job, extra = {}) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("th-TH") : "";
  };
  return {
    ref: job.ref_no || "",
    name: job.cust_name || "",
    model: job.model || "",
    payout: num(job.net_payout != null ? job.net_payout : job.final_price),
    brand: "BKK APPLE",
    method: job.receive_method || "",
    branch: job.branch_name || job.store_branch || "",
    ...extra,
  };
}

/**
 * แทนที่ `{key}` ด้วยค่าจากงาน. **escape ค่าที่แทนเสมอ** — ข้อความมาจาก
 * แอดมินแต่ค่าที่แทนมาจากข้อมูลลูกค้า (ชื่อ/รุ่น) ซึ่งใส่ `<` ได้
 * placeholder ที่ไม่รู้จักปล่อยไว้ตามเดิม ให้แอดมินเห็นว่าพิมพ์ผิด
 */
function renderPlaceholders(text, job, esc, extra) {
  if (!text) return "";
  const values = placeholderValues(job, extra);
  return String(text).replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? esc(values[key]) : whole,
  );
}

/** override ตัวนี้มีข้อความอะไรให้ใช้ไหม (ช่องว่าง = ใช้ค่า default) */
function hasCopyOverride(t) {
  if (!t) return false;
  return Boolean(
    (t.subject && t.subject.trim()) ||
    (t.heading && t.heading.trim()) ||
    (t.intro && t.intro.trim()),
  );
}

/**
 * ผสม override เข้ากับค่า default ทีละฟิลด์ — ฟิลด์ที่แอดมินไม่กรอกยังได้
 * ข้อความเดิมจากโค้ด (รวมเงื่อนไขตาม receive_method) ครบ
 */
function resolveCopy(defaults, override, job, esc, extra) {
  if (!override || LOCKED_COPY_KEYS.has(override._key)) return defaults;
  const pick = (field) => {
    const v = override[field];
    return v && String(v).trim()
      ? renderPlaceholders(v, job, esc, extra)
      : defaults[field];
  };
  return { subject: pick("subject"), heading: pick("heading"), intro: pick("intro") };
}

module.exports = {
  TEMPLATES_PATH,
  LOCKED_COPY_KEYS,
  loadEmailTemplates,
  emailEnabled,
  renderPlaceholders,
  hasCopyOverride,
  resolveCopy,
  placeholderValues,
};
