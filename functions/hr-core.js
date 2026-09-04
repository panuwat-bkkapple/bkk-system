// =============================================================================
// HR core — กติกาล้วนของทะเบียนพนักงาน (ไม่มี Firebase ไม่มี I/O)
//
// แยกออกจาก hr.js ด้วยเหตุผลเดียวกับ actor.js และ couponEngine.ts: สิ่งที่
// ตัดสิน "อะไรเข้าไปอยู่ในทะเบียนได้บ้าง" ต้องทดสอบได้โดยไม่ต้องมีฐานข้อมูล
// เพราะมันคือด่านของข้อมูลที่อ่อนไหวที่สุดในระบบ (เลขบัตรประชาชน เงินเดือน)
//
// สองกฎที่ไฟล์นี้ถือไว้และห้ามย้ายไปที่อื่น:
//
//   1. **allowlist ทั้งสองชั้น** — ฟิลด์ที่ client ส่งมาได้ถูกประกาศเป็นรายชื่อ
//      ไม่ใช่ "รับทุกอย่างแล้วลบที่ไม่ต้องการ". บทเรียนจาก public_track ที่พลาด
//      สองรอบเพราะดูแค่ชั้นเดียว: object ซ้อน (emergency_contact, bank, pay)
//      ต้องมี allowlist ของตัวเอง ไม่ใช่ก๊อปทั้งก้อน
//   2. **แยก public ออกจาก private ตั้งแต่ชั้นรับข้อมูล** — ไม่ใช่แค่ตอนอ่าน
//      เพราะฟิลด์ที่หลุดเข้า employees/ ครั้งเดียวจะอยู่ที่นั่นตลอดไป และ
//      หน้าแอดมินเดิมอ่าน employees/ ได้ (ชื่อ/ตำแหน่ง) แต่ต้องไม่เห็นเงินเดือน
// =============================================================================

// ฝ่ายบุคคลกับ CEO เท่านั้น — **ไม่รวม MANAGER โดยตั้งใจ** เพราะโหนดที่ gate นี้
// คุมมีเงินเดือนของทุกคนรวมถึงเงินเดือนของ MANAGER คนอื่น การเปิดให้ทั้งชั้น
// บริหารอ่านได้เป็นการตัดสินใจเรื่องคน ไม่ใช่เรื่องเทคนิค และต้องมีคนสั่ง
// ไม่ใช่ไหลมาเองจากการจัดกลุ่มเมนู
const HR_ROLES = ["CEO", "HR"];

const EMPLOYMENT_TYPES = ["monthly", "daily", "freelance"];
const EMPLOYEE_STATUSES = ["probation", "active", "resigned", "terminated"];

// สถานะที่แปลว่า "ไม่ได้ทำงานที่นี่แล้ว" — ใช้ตัดสินว่าบัญชีที่ยังเปิดอยู่
// เป็นความเสี่ยงหรือเป็นเรื่องปกติ
const EX_EMPLOYEE_STATUSES = ["resigned", "terminated"];

const EMPLOYEE_EVENT_ACTIONS = [
  "hired", "probation_passed", "promoted", "salary_changed", "transferred",
  "resigned", "terminated", "account_issued", "account_revoked",
  "linked", "unlinked", "profile_updated",
  "document_uploaded", "document_deleted",
];

const str = (v) => String(v == null ? "" : v).trim();
const clip = (v, max) => str(v).slice(0, max);

// ── เลขบัตรประชาชน ──────────────────────────────────────────────────────────
// ตรวจ checksum จริง ไม่ใช่แค่นับหลัก — เลข 13 หลักที่พิมพ์ผิดหนึ่งตัวยังนับได้
// 13 หลักอยู่ดี แล้วมันจะไปโผล่บนหนังสือรับรองหัก ณ ที่จ่ายที่ยื่นสรรพากร
//
// ข้อจำกัดที่รู้ตัว: รองรับเฉพาะเลขบัตรไทย พนักงานต่างชาติ (พาสปอร์ต/work
// permit) ยังกรอกไม่ได้ — จดไว้ในเอกสารออกแบบข้อ 11 ไม่ใช่ปล่อยให้ค้นพบเอง
function isThaiNationalId(v) {
  const digits = str(v).replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

const normalizeNationalId = (v) => str(v).replace(/[\s-]/g, "");

// ── รหัสประจำตัวพนักงาน ─────────────────────────────────────────────────────
// EMP-2569-0007 — ปีพุทธศักราชตามเวลาไทย เหมือนเลขรันเอกสารตัวอื่นในระบบ
// (accounting_documents ใช้ period แบบเดียวกัน) ตัวนับแยกรายปีจึงรีเซ็ตเองโดย
// ไม่ต้องมีใครไปกด
function bangkokBuddhistYear(now) {
  const d = new Date(now + 7 * 60 * 60 * 1000);
  return d.getUTCFullYear() + 543;
}

function formatEmployeeCode(prefix, year, seq) {
  const p = str(prefix) || "EMP";
  return `${p}-${year}-${String(seq).padStart(4, "0")}`;
}

// ── allowlist: ข้อมูลที่ไม่อ่อนไหว (employees/{id}) ─────────────────────────
// ฟิลด์ที่ "ไม่อยู่ในนี้" ไม่ได้แปลว่าเก็บไม่ได้ แต่แปลว่า client ตั้งเองไม่ได้:
// employee_code / status / links / terminated_at เป็นของ server ทั้งหมด
// เพราะแต่ละตัวมีกติกาของตัวเอง (ตัวนับ, การเปลี่ยนสถานะต้องมีประวัติ,
// การผูกบัญชีต้องตรวจว่าไม่ถูกคนอื่นจองไว้)
// ── ชื่อ: คำนำหน้า / ชื่อ / นามสกุล ────────────────────────────────────────
//
// **ทะเบียนเก็บ `name` เป็นช่องเดียวมาตั้งแต่ต้น และมีคนอ่านมันเยอะมาก** —
// สัญญาจ้าง, สลิปเงินเดือน, 50 ทวิ, ภ.ง.ด.1ก, บรรทัดในรอบจ่าย, ข้อความเตือน
// ตอนผูกบัญชีซ้ำ การเปลี่ยนไปเก็บเป็นสามช่องแล้วทิ้ง `name` = ไล่แก้คนอ่านทุกตัว
// พร้อมกัน ซึ่งเป็นรูปเดียวกับบั๊ก `status_history` ที่ทำให้ไทม์ไลน์แอดมินหาย
// ไปหนึ่งชั่วโมง (ดู "ย้าย writer: ถามว่าใครอ่านของเดิม" ใน CLAUDE.md)
//
// จึง **เพิ่มสามช่อง แล้วให้ `name` เป็นผลลัพธ์ที่ประกอบจากสองในสามช่องนั้น**
// คนอ่านเดิมไม่ต้องรู้เรื่องอะไรเลย ส่วนแบบยื่นภาษี (ภ.ง.ด.1) ที่ต้องการชื่อกับ
// นามสกุลแยกช่องก็หยิบไปใช้ได้ตรงๆ
//
// **คำนำหน้าไม่อยู่ใน `name`** เพราะเอกสารทุกใบวันนี้พิมพ์ `name` ต่อจากคำที่
// ระบุความสัมพันธ์อยู่แล้ว ("กับ สมชาย ใจดี") การยัดคำนำหน้าเข้าไปทำให้ข้อความ
// เดิมทั้งหมดอ่านแปลกโดยไม่ได้เพิ่มความถูกต้องอะไร

/** คำนำหน้าที่พบบ่อย — เป็น **ตัวช่วยพิมพ์** ไม่ใช่ allowlist */
const COMMON_TITLES = ["นาย", "นาง", "นางสาว"];

/**
 * เดาการแยกชื่อจากช่องเดียว — **ผลลัพธ์เป็นข้อเสนอ ไม่ใช่ข้อสรุป**
 *
 * ใช้เติมค่าเริ่มต้นให้ฟอร์มเท่านั้น **ห้ามเอาไปเขียนลงฐานข้อมูลอัตโนมัติ** —
 * ชื่อกับนามสกุลจะไปโผล่บนแบบยื่นภาษี การเดาผิดแล้วบันทึกเงียบๆ คือการยื่นผิด
 * โดยไม่มีใครรู้ คนต้องเห็นและกดบันทึกเอง
 *
 * ภาษาไทยไม่มีกฎที่แน่นอนว่าชื่อกี่คำ — ตัวนี้จึงรับเฉพาะรูปที่ชัดเจนจริงๆ:
 * "ชื่อ นามสกุล" และ "คำนำหน้า ชื่อ นามสกุล" (ติดกันหรือเว้นวรรคก็ได้)
 * นอกนั้นคืน `confident: false` แล้วปล่อยให้คนกรอกเอง
 */
function splitThaiName(full) {
  const raw = str(full).replace(/\s+/g, " ");
  if (!raw) return { title: null, first_name: null, last_name: null, confident: false };

  // **เรียงจากยาวไปสั้นก่อนเทียบ** — ไม่งั้น "นางสาว" จะถูกตัดเป็น "นาง" แล้ว
  // เหลือ "สาว" ไปติดหัวชื่อ
  const byLength = [...COMMON_TITLES].sort((a, b) => b.length - a.length);
  const hit = byLength.find((x) => raw.startsWith(x));
  const title = hit || null;
  const rest = hit ? raw.slice(hit.length).trim() : raw;

  const parts = rest.split(" ").filter(Boolean);
  if (parts.length === 2) {
    return { title, first_name: parts[0], last_name: parts[1], confident: true };
  }
  // คำเดียว = ไม่รู้ว่าเป็นชื่อหรือนามสกุล · เกินสองคำ = ชื่อกลาง/นามสกุลหลายคำ
  // ทั้งสองแบบเดาแล้วผิดได้จริง จึงคืนสิ่งที่แน่ใจ (คำนำหน้า) แล้วบอกว่าไม่มั่นใจ
  return {
    title,
    first_name: parts.length === 1 ? parts[0] : null,
    last_name: null,
    confident: false,
  };
}

function sanitizeEmployeePublic(input, { partial = false } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  const errors = [];

  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);

  // ── ชื่อ ──────────────────────────────────────────────────────────────────
  // **`name` เป็นผลลัพธ์เมื่อมีชื่อ+นามสกุล ไม่ใช่ช่องอิสระ** — มีที่เดียวที่
  // เขียนความจริงเรื่องชื่อ ไม่งั้นสองช่องจะเล่าคนละเรื่องแล้วไม่มีใครรู้ว่า
  // เอกสารใบไหนอ่านช่องไหน
  //
  // ยังรับ `name` เดี่ยวๆ ต่อไป เพราะสายกดจ้างจากใบสมัคร
  // (`hr-recruitment-api`) ส่งมาแค่ชื่อเต็มที่ผู้สมัครกรอก — บังคับให้แยกตรงนั้น
  // แปลว่าต้องเดาแทนผู้สมัคร ซึ่งเป็นการเดาที่ไปโผล่บนแบบยื่นภาษี
  const nameKeys = ["name", "title", "first_name", "last_name"];
  if (!partial || nameKeys.some(has)) {
    const title = clip(src.title, 40);
    const first = clip(src.first_name, 60);
    const last = clip(src.last_name, 60);
    out.title = title || null;
    out.first_name = first || null;
    out.last_name = last || null;

    const composed = first && last ? `${first} ${last}` : "";
    const name = composed || clip(src.name, 120);
    if (!name) errors.push("ต้องระบุชื่อ-สกุลพนักงาน");
    // มีชื่อแต่ไม่มีนามสกุล = แยกไม่ครบ ซึ่งใช้ยื่นภาษีไม่ได้ — บอกตรงนี้ดีกว่า
    // ให้ไปรู้ตอนออกแบบยื่นแล้วชื่อขาด
    if (first && !last) errors.push("กรอกชื่อแล้วต้องกรอกนามสกุลด้วย");
    if (last && !first) errors.push("กรอกนามสกุลแล้วต้องกรอกชื่อด้วย");
    out.name = name;
  }
  for (const [key, max] of [["nickname", 60], ["position", 120], ["department", 120], ["branch", 120]]) {
    if (!partial || has(key)) out[key] = clip(src[key], max) || null;
  }
  // ── หัวหน้างาน + กะประจำตัว ──────────────────────────────────────────────
  //
  // **`supervisor_id` ชี้ไปที่ `employees/{id}` ไม่ใช่ `staff/{id}`** — คนอนุมัติ
  // ใบลาคือ *คน* ในทะเบียน ไม่ใช่ *บัญชีเข้าระบบ* (หัวหน้าที่ยังไม่มีบัญชีก็ยัง
  // เป็นหัวหน้าได้ และคนหนึ่งคนมีบัญชีได้หลายใบ)
  //
  // **ที่นี่ไม่ตรวจว่ามีคนนั้นอยู่จริงหรือชี้วนกลับมาหาตัวเอง** — sanitizer
  // ไม่มีทะเบียนให้ดู การตรวจนั้นเป็นของ callable ที่มี `loadRegistry` อยู่แล้ว
  // (เขียนไว้ตรงนี้เพื่อไม่ให้คนอ่านรอบหน้าเข้าใจว่าตรงนี้เป็นด่าน)
  for (const key of ["supervisor_id", "default_shift_id"]) {
    if (!partial || has(key)) out[key] = clip(src[key], 80) || null;
  }
  if (!partial || has("photo_url")) {
    const url = clip(src.photo_url, 500);
    // ยอมเฉพาะ https — รูปโปรไฟล์ที่เป็น javascript:/data: คือ XSS ที่รอถูก render
    if (url && !/^https:\/\//i.test(url)) errors.push("ลิงก์รูปต้องเป็น https");
    out.photo_url = url || null;
  }
  if (!partial || has("employment_type")) {
    const t = str(src.employment_type).toLowerCase();
    if (!EMPLOYMENT_TYPES.includes(t)) {
      errors.push(`ประเภทการจ้างต้องเป็นหนึ่งใน: ${EMPLOYMENT_TYPES.join(", ")}`);
    }
    out.employment_type = t;
  }
  for (const key of ["hired_at", "probation_until"]) {
    if (!partial || has(key)) {
      const raw = src[key];
      if (raw == null || raw === "") { out[key] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) errors.push(`${key} ต้องเป็นเวลาที่ถูกต้อง`);
      else out[key] = Math.round(n);
    }
  }
  if ((!partial || has("hired_at")) && !partial && !out.hired_at) {
    errors.push("ต้องระบุวันเริ่มงาน");
  }
  return { value: out, errors };
}

// ── allowlist: ข้อมูลอ่อนไหว (employees_private/{id}) ───────────────────────
// object ซ้อนทุกตัวมี allowlist ของตัวเอง — การรับ `src.bank` ทั้งก้อนแปลว่า
// ใครก็ตามที่ยิง callable ได้เขียนอะไรก็ได้ลงใต้ชื่อที่เราคิดว่ารู้จัก
function sanitizeEmployeePrivate(input, { partial = false } = {}) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);

  if (!partial || has("national_id")) {
    const raw = str(src.national_id);
    if (!raw) out.national_id = null;
    else if (!isThaiNationalId(raw)) errors.push("เลขบัตรประชาชนไม่ถูกต้อง (13 หลักและต้องผ่านการตรวจเลขหลักสุดท้าย)");
    else out.national_id = normalizeNationalId(raw);
  }
  if (!partial || has("birth_date")) {
    const raw = src.birth_date;
    if (raw == null || raw === "") out.birth_date = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) errors.push("วันเกิดไม่ถูกต้อง");
      else out.birth_date = Math.round(n);
    }
  }
  for (const [key, max] of [
    ["address", 500], ["phone", 40], ["email", 200], ["line", 100],
    ["tax_id", 20], ["social_security_no", 20],
  ]) {
    if (!partial || has(key)) out[key] = clip(src[key], max) || null;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) {
    errors.push("อีเมลไม่ถูกต้อง");
  }

  if (!partial || has("emergency_contact")) {
    const c = src.emergency_contact && typeof src.emergency_contact === "object" ? src.emergency_contact : null;
    out.emergency_contact = c
      ? { name: clip(c.name, 120) || null, relation: clip(c.relation, 60) || null, phone: clip(c.phone, 40) || null }
      : null;
  }
  if (!partial || has("bank")) {
    const b = src.bank && typeof src.bank === "object" ? src.bank : null;
    out.bank = b
      ? { name: clip(b.name, 80) || null, account: clip(b.account, 40) || null, account_name: clip(b.account_name, 120) || null }
      : null;
  }
  // ค่าลดหย่อนภาษีของคนนี้ — เข้าสูตรคิดภาษีหัก ณ ที่จ่ายในรอบเงินเดือน (P5)
  // เก็บเป็น "จำนวน" ไม่ใช่ "จำนวนเงิน" เพราะจำนวนเงินต่อหัวเป็นอัตราที่
  // กฎหมายกำหนดและอยู่ที่ settings/hr — เก็บเงินไว้ตรงนี้ด้วยแปลว่าอัตรา
  // เปลี่ยนแล้วต้องไล่แก้ทุกคน
  if (!partial || has("tax")) {
    const t = src.tax && typeof src.tax === "object" ? src.tax : {};
    const count = (v, label, max) => {
      if (v == null || v === "") return 0;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) { errors.push(`${label} ไม่ถูกต้อง`); return 0; }
      return Math.round(n);
    };
    out.tax = {
      spouse: t.spouse === true,
      children: count(t.children, "จำนวนบุตร", 20),
      parents: count(t.parents, "จำนวนบิดามารดาในอุปการะ", 4),
      other: (() => {
        if (t.other == null || t.other === "") return 0;
        const n = Number(t.other);
        if (!Number.isFinite(n) || n < 0) { errors.push("ค่าลดหย่อนอื่นต้องไม่ติดลบ"); return 0; }
        return Math.round(n * 100) / 100;
      })(),
    };
  }
  if (!partial || has("pay")) {
    const p = src.pay && typeof src.pay === "object" ? src.pay : {};
    const money = (v, label) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) { errors.push(`${label} ต้องเป็นจำนวนเงินที่ไม่ติดลบ`); return null; }
      return Math.round(n * 100) / 100;
    };
    const allowances = Array.isArray(p.allowances) ? p.allowances.slice(0, 20).map((a) => ({
      label: clip(a && a.label, 80) || null,
      amount: money(a && a.amount, "เบี้ยเลี้ยง") || 0,
      taxable: (a && a.taxable) !== false,
      recurring: (a && a.recurring) !== false,
    })).filter((a) => a.label) : [];
    out.pay = {
      base_salary: money(p.base_salary, "เงินเดือน"),
      daily_rate: money(p.daily_rate, "ค่าแรงรายวัน"),
      allowances,
      // ช่องทางจ่าย — **เป็นการประกาศ ไม่ใช่การเดาจากการมี/ไม่มีเลขบัญชี**
      // ของเดิมอ่านว่า "ไม่มีเลขบัญชี = จ่ายเงินสด" ทำให้คนที่ควรได้รับโอนแต่
      // ข้อมูลยังไม่ครบ ตกไปอยู่ถังเงินสดเงียบๆ แล้วยอดสรุปก็ดูสมเหตุสมผล
      // (กติกาเต็มอยู่ที่ hr-compliance.js)
      pay_method: str(p.pay_method).toLowerCase() === "cash" ? "cash" : "transfer",
    };
  }
  return { value: out, errors };
}

// สถานะอนุมัติของไรเดอร์ — MIRROR ของ `effectiveApprovalStatus` ใน actor.js
//
// ก๊อปกฎมาแทนที่จะ import เพราะ actor.js ลาก `sickw-core` (แตะ Firebase) เข้ามา
// ด้วย ส่วนไฟล์นี้ตั้งใจให้ไม่มี dependency เลยเพื่อให้เทสขับได้ตรงๆ —
// **แก้กฎที่หนึ่งต้องแก้ทั้งคู่**
//
// **ค่าจริงในระบบคือ Active / Pending / Rejected / Suspended (ขึ้นต้นตัวใหญ่)**
// ไม่ใช่ "approved" — โค้ดเดิมของ accessSummary เทียบกับ `"approved"` ตัวเล็ก
// ซึ่งไม่มีทางตรงกับค่าไหนเลย แปลว่า `riderOpen` เป็น false เสมอ และธง
// `stale_access` **ไม่เคยเตือนเรื่องบัญชีไรเดอร์ที่ยังเปิดอยู่สักครั้ง**
// (เจอตอนทำ P3 ก.ย. 2569 — ด่านที่เทียบกับค่าที่ไม่มีอยู่จริงคือด่านที่ว่าง)
function riderApprovalStatus(riderRow) {
  const r = riderRow || {};
  if (r.approval_status) return String(r.approval_status);
  const status = String(r.status || "");
  if (["Online", "Offline", "Busy"].includes(status)) return "Active";
  return status || "Pending";
}

// ── สถานะการเข้าถึงระบบของพนักงานคนหนึ่ง ────────────────────────────────────
// ทะเบียนบอกว่า "พ้นสภาพแล้ว" ได้ แต่การปิดบัญชีจริงเป็นงานของ P3
// (adminHrTerminate) — ระหว่างนั้นหน้าเว็บต้องบอกความจริงว่าบัญชียังเปิดอยู่
// ไม่ใช่โชว์คำว่าพ้นสภาพแล้วปล่อยให้เข้าใจว่าปิดแล้ว **นี่คือความต่างระหว่าง
// ระบบที่บอกความจริงกับระบบที่ตอบผิดเงียบๆ**
function accessSummary(employee, staffMap, ridersMap) {
  const links = (employee && employee.links) || {};
  const staffId = links.staff_id || null;
  const riderId = links.rider_id || null;
  const staffRow = staffId ? (staffMap || {})[staffId] : null;
  const riderRow = riderId ? (ridersMap || {})[riderId] : null;

  const staff = staffRow
    ? {
        id: staffId,
        status: String(staffRow.status || "").toUpperCase() || "ACTIVE",
        terminated: Boolean(staffRow.terminated_at),
        role: String(staffRow.role || "").toUpperCase() || null,
      }
    : null;
  const rider = riderRow
    ? { id: riderId, approval_status: riderApprovalStatus(riderRow) }
    : null;

  // "เปิดอยู่" = ยังเข้าระบบได้จริง ไม่ใช่ "ยังมีแถวอยู่"
  const staffOpen = Boolean(staff && !staff.terminated && staff.status === "ACTIVE");
  const riderOpen = Boolean(rider && rider.approval_status === "Active");
  const exEmployee = EX_EMPLOYEE_STATUSES.includes(String(employee && employee.status || "").toLowerCase());

  return {
    staff, rider,
    open: staffOpen || riderOpen,
    // ธงเดียวที่หน้าเว็บต้องทำอะไรกับมัน
    stale_access: exEmployee && (staffOpen || riderOpen),
  };
}

// ── P3: ปิดการเข้าถึงเมื่อพ้นสภาพ — ตัววางแผนล้วน ──────────────────────────
//
// **การปิดบัญชีเป็นการถอนสิทธิ์ ปลอดภัยที่จะทำอัตโนมัติ · การเปิดคืนเป็นการ
// ให้สิทธิ์ ต้องทำด้วยมือเสมอ** — ความไม่สมมาตรนี้เป็นกติกา ไม่ใช่ความขี้เกียจ:
// การแก้สถานะกลับเป็น active คือการแก้ข้อมูล ไม่ใช่การอนุมัติให้คนกลับเข้าระบบ
// ระบบที่คืนสิทธิ์ให้เป็นผลข้างเคียงของการแก้ข้อมูล คือระบบที่ให้สิทธิ์โดย
// ไม่มีใครตั้งใจ (การเปิดคืนอยู่ที่ /staff และ /riders ซึ่ง gate ด้วย CEO/MANAGER)
//
// สามข้อที่ต้องปฏิเสธทั้งรายการ ไม่ใช่ข้ามเงียบ:
//   1. **บัญชีที่จะปิดเป็นของ CEO และคนกดไม่ใช่ CEO** — ถ้าปล่อยผ่าน role HR
//      จะปิดบัญชีเจ้าของบริษัทได้ผ่านทางอ้อม และการเปิดคืนต้องใช้ CEO ซึ่ง
//      login ไม่ได้แล้ว = ล็อกตัวเองออกจากระบบแบบกู้ไม่ได้
//   2. **CEO ที่ ACTIVE คนสุดท้าย** — เหตุผลเดียวกัน แม้คนกดจะเป็น CEO เอง
//   3. **บัญชีของคนกดเอง** — ปิดกลางคำสั่งแล้วคำสั่งที่เหลือจะทำงานต่อไม่ได้
//
// ปฏิเสธ = ไม่แตะอะไรเลยแม้แต่สถานะในทะเบียน เพราะการบันทึกว่า "พ้นสภาพ"
// ไว้โดยที่บัญชียังเปิด แล้วบอกให้ไปตามคนอื่นมากดต่อ คือสภาพครึ่งๆ กลางๆ
// ที่ P3 มีไว้กำจัด
function planAccountClosure({ employee, staffMap, ridersMap, callerRole, callerStaffId }) {
  const links = (employee && employee.links) || {};
  const staffId = links.staff_id || null;
  const riderId = links.rider_id || null;
  const staffRow = staffId ? (staffMap || {})[staffId] : null;
  const riderRow = riderId ? (ridersMap || {})[riderId] : null;
  const caller = String(callerRole || "").toUpperCase();

  const staffStatus = String((staffRow && staffRow.status) || "").toUpperCase() || "ACTIVE";
  const staffTerminated = Boolean(staffRow && staffRow.terminated_at);
  const staffOpen = Boolean(staffRow) && !staffTerminated && staffStatus === "ACTIVE";
  const staffRole = String((staffRow && staffRow.role) || "").toUpperCase();

  if (staffOpen) {
    if (staffRole === "CEO" && caller !== "CEO") {
      return refuse("ceo_account", "บัญชีที่ผูกอยู่เป็นบัญชี CEO — ต้องให้ CEO เป็นคนบันทึกการพ้นสภาพเอง หรือถอดการผูกบัญชีออกก่อน");
    }
    if (staffId && staffId === callerStaffId) {
      return refuse("self", "ปิดบัญชีของตัวเองไม่ได้ — ให้คนอื่นเป็นคนบันทึกการพ้นสภาพ");
    }
    if (staffRole === "CEO" && countOtherActiveCeos(staffMap, staffId) === 0) {
      return refuse("last_ceo", "ต้องมี CEO ที่ Active อย่างน้อย 1 คนเสมอ — ตั้ง CEO คนใหม่ก่อน");
    }
  }

  const riderStatus = riderRow ? riderApprovalStatus(riderRow) : null;
  const riderOpen = riderStatus === "Active";

  return {
    refuse: null,
    staff: staffRow
      ? { id: staffId, close: staffOpen, skip: staffOpen ? null : (staffTerminated ? "ปิดบัญชีไปแล้ว" : `สถานะ ${staffStatus}`) }
      : null,
    rider: riderRow
      ? { id: riderId, close: riderOpen, skip: riderOpen ? null : `สถานะ ${riderStatus}` }
      : null,
    // ไม่มีบัญชีให้ปิดไม่ใช่ความผิดพลาด — พนักงานที่ไม่เคยได้บัญชีก็มี แต่ต้อง
    // บอกออกไปให้หน้าเว็บพูดได้ตรง ไม่ใช่ขึ้นว่า "ปิดบัญชีแล้ว" ทั้งที่ไม่มีอะไรถูกปิด
    nothing_to_close: !staffRow && !riderRow,
  };
}

const refuse = (code, message) => ({ refuse: { code, message }, staff: null, rider: null, nothing_to_close: false });

/** CEO ที่ยัง ACTIVE คนอื่นนอกจากคนนี้ — MIRROR ของ countOtherActiveCeos ใน staff-accounts.js */
function countOtherActiveCeos(staffMap, exceptId) {
  let n = 0;
  for (const [id, s] of Object.entries(staffMap || {})) {
    if (!s || id === exceptId) continue;
    if (String(s.role || "").toUpperCase() !== "CEO") continue;
    if (String(s.status || "").toUpperCase() !== "ACTIVE") continue;
    if (s.terminated_at) continue;
    n += 1;
  }
  return n;
}

// ── บัญชีที่ยังไม่ถูกผูกเข้าทะเบียน ──────────────────────────────────────────
// P1 คือการ "ผูกของเดิมเข้าทะเบียน" ไม่ใช่การสร้างคนใหม่ทั้งหมด — หน้าเว็บ
// ต้องบอกได้ว่ายังเหลือใครที่มีบัญชีแต่ไม่มีแฟ้ม
function unlinkedAccounts(employees, staffMap, ridersMap) {
  const usedStaff = new Set();
  const usedRider = new Set();
  for (const e of Object.values(employees || {})) {
    const l = (e && e.links) || {};
    if (l.staff_id) usedStaff.add(l.staff_id);
    if (l.rider_id) usedRider.add(l.rider_id);
  }
  const staff = Object.entries(staffMap || {})
    .filter(([id, s]) => s && !usedStaff.has(id) && !s.terminated_at)
    .map(([id, s]) => ({
      id, kind: "staff",
      name: s.name || s.email || id,
      email: s.email || null,
      role: String(s.role || "").toUpperCase() || null,
      status: String(s.status || "").toUpperCase() || "ACTIVE",
    }));
  const riders = Object.entries(ridersMap || {})
    .filter(([id, r]) => r && !usedRider.has(id))
    .map(([id, r]) => ({
      id, kind: "rider",
      name: r.name || r.displayName || r.email || id,
      email: r.email || null,
      role: "RIDER",
      status: String(r.approval_status || "approved").toLowerCase(),
    }));
  return [...staff, ...riders];
}

// ── ผู้กระทำ — รูปเดียวกับ staff_status_events / rider_status_events ────────
// ฟิลด์ by_* ต้องเหมือนกันเป๊ะทั้งสามโหนด ไม่งั้นประวัติของคนกลุ่มเดียวกัน
// join ด้วย query shape เดียวไม่ได้ ซึ่งเป็นปัญหาที่ survey เจอมาแล้ว
/**
 * หัวหน้างานที่ตั้งให้คนนี้ ใช้ได้ไหม
 *
 * คืนข้อความ error หรือ `null` — ล้วน ทดสอบได้
 *
 * **วงกลมของสายบังคับบัญชาต้องกันที่นี่ ไม่ใช่ปล่อยให้ไปตันตอนอนุมัติ** —
 * A มีหัวหน้าเป็น B และ B มีหัวหน้าเป็น A แปลว่าใบลาของทั้งคู่ไม่มีใครอนุมัติ
 * ได้เลย และมันจะไม่ error ที่ไหน มันแค่เงียบ
 *
 * `employeeId` เป็น `null` ได้ (ตอนสร้างแฟ้มยังไม่มี id) — เคสนั้นตรวจได้แค่
 * ว่าคนที่ชี้ไปมีอยู่จริง ซึ่งพอ เพราะแฟ้มใหม่ยังไม่มีใครชี้มาหามัน
 */
function supervisorChainError(employees, employeeId, supervisorId) {
  const sup = String(supervisorId == null ? "" : supervisorId).trim();
  if (!sup) return null;
  const rows = employees && typeof employees === "object" ? employees : {};
  if (employeeId && sup === employeeId) return "หัวหน้างานต้องไม่ใช่ตัวเอง";
  if (!rows[sup]) return "ไม่พบหัวหน้างานในทะเบียนพนักงาน";
  if (!employeeId) return null;

  const seen = new Set([employeeId]);
  let cur = sup;
  while (cur) {
    if (seen.has(cur)) return "สายบังคับบัญชาวนกลับมาหาตัวเอง";
    seen.add(cur);
    const next = (rows[cur] || {}).supervisor_id;
    cur = String(next == null ? "" : next).trim();
    if (cur && !rows[cur]) break;
  }
  return null;
}

function employeeActorFields(callerStaffId, staffMap, auth) {
  const caller = (staffMap && staffMap[callerStaffId]) || {};
  return {
    by_staff_id: callerStaffId || null,
    by_uid: (auth && auth.uid) || null,
    by_name: caller.name || caller.email || null,
    by_role: String(caller.role || "").toUpperCase() || null,
  };
}

module.exports = {
  HR_ROLES,
  COMMON_TITLES, splitThaiName,
  EMPLOYMENT_TYPES,
  EMPLOYEE_STATUSES,
  EX_EMPLOYEE_STATUSES,
  EMPLOYEE_EVENT_ACTIONS,
  isThaiNationalId,
  normalizeNationalId,
  bangkokBuddhistYear,
  formatEmployeeCode,
  sanitizeEmployeePublic,
  sanitizeEmployeePrivate,
  accessSummary,
  riderApprovalStatus,
  planAccountClosure,
  countOtherActiveCeos,
  unlinkedAccounts,
  employeeActorFields,
  supervisorChainError,
};
