// =============================================================================
// สายการรับสมัครงาน — เครื่องสถานะล้วน ไม่มี I/O
//
// ใบสมัครถูกเขียนโดยฟอร์ม `/careers` ของเว็บลูกค้า (`bkk-frontend-next`) ลงที่
// `job_applications/{id}` **โหนดยังอยู่ที่เดิม ไม่ย้ายข้อมูล** — สิ่งที่ย้ายมา
// ฝั่งนี้คือ "การตัดสินใจจ้าง" ซึ่งเป็นงานของ HR และเป็นที่ที่ทะเบียนพนักงานอยู่
//
// **ทำไมต้องมีเครื่องสถานะ ไม่ใช่ dropdown ให้เลือกอิสระ:** ใบสมัครที่กระโดด
// จาก `new` ไป `hired` ตรงๆ แปลว่ามีคนถูกจ้างโดยไม่มีบันทึกว่าเคยสัมภาษณ์หรือ
// เคยยื่นข้อเสนอ ซึ่งเป็นเอกสารที่ต้องมีตอนมีข้อพิพาทเรื่องการจ้าง
//
// **"ยื่นข้อเสนอแล้ว" ต่างจาก "เขาตอบรับแล้ว" และต้องแยกกัน** — ระหว่างสองอัน
// นี้คือช่วงที่ HR ต้องรู้ว่ารออะไรอยู่ ถ้ายุบรวมเป็นสถานะเดียว ใบที่ยื่นไป
// แล้วเงียบกับใบที่ตกลงแล้วรอเริ่มงานจะหน้าตาเหมือนกัน
// =============================================================================

const STAGES = {
  new: { label: "ใหม่", tone: "red" },
  reviewing: { label: "กำลังตรวจสอบ", tone: "amber" },
  interview: { label: "นัดสัมภาษณ์", tone: "blue" },
  offer: { label: "ยื่นข้อเสนอแล้ว", tone: "violet" },
  accepted: { label: "ตอบรับแล้ว รอเริ่มงาน", tone: "teal" },
  hired: { label: "จ้างแล้ว", tone: "emerald", terminal: true },
  rejected: { label: "ไม่ผ่าน", tone: "gray", terminal: true },
  declined: { label: "ผู้สมัครปฏิเสธ", tone: "gray", terminal: true },
  // ค่าเก่าจากหน้ารีวิวฝั่งเว็บลูกค้า — ข้อมูลที่ลงไปแล้วเปลี่ยนย้อนหลังไม่ได้
  // จึงเป็นสมาชิกถาวรของคำศัพท์ชุดนี้ ไม่ใช่ scaffolding (กฎเดียวกับ
  // LEGACY_ALIAS ใน job-statuses.ts)
  //
  // **อ่านได้ แต่ย้ายไปไม่ได้ และกติกาข้อนั้นอยู่ที่ ALLOWED ไม่ใช่ธง `legacy`**
  // เดิมมีด่านแยกที่เช็ค `STAGES[to].legacy` ไว้ด้วย — ถอดออกแล้วเทสยังเขียว
  // (injection ข้อ 7) เพราะไม่มี ALLOWED ตัวไหนมี "approved" อยู่เลย ด่านนั้น
  // จึงไปไม่ถึงตลอดกาล ตามกฎ "ด่านที่ไปไม่ถึง ให้ลบ ไม่ใช่ ship"
  // ถ้าวันหนึ่งมีคนเติม "approved" ลง ALLOWED มันจะย้ายไปได้ทันที — เทสข้อ
  // "ย้ายไป approved ไม่ได้" คือตัวที่จะแดง
  approved: { label: "ผ่าน (ค่าเดิม)", tone: "green", legacy: true },
};

// เดินไปไหนได้บ้าง — เขียนเป็นตารางชัดๆ ไม่ derive จากลำดับ เพราะสายจริงมี
// ทั้งการถอยกลับและทางออกด้านข้าง ซึ่งลำดับเส้นตรงอธิบายไม่ได้
//
// **ถอยกลับได้หนึ่งขั้นโดยตั้งใจ** — สัมภาษณ์รอบสอง หรือยื่นข้อเสนอแล้วต้อง
// คุยใหม่ เกิดขึ้นจริง ถ้าบล็อกไว้คนจะไปสร้างใบสมัครใบที่สองแทน แล้วประวัติ
// ของคนคนเดียวจะแตกเป็นสองใบ
const ALLOWED = {
  new: ["reviewing", "interview", "rejected"],
  reviewing: ["interview", "offer", "rejected", "new"],
  interview: ["offer", "rejected", "reviewing"],
  offer: ["accepted", "declined", "rejected", "interview"],
  accepted: ["hired", "declined", "offer"],
  approved: ["offer", "interview", "rejected"],
  hired: [],
  rejected: [],
  declined: [],
};

const isStage = (s) => Object.prototype.hasOwnProperty.call(STAGES, String(s || ""));

/** สถานะปัจจุบันของใบสมัคร — ใบที่ไม่มีสถานะคือใบที่เพิ่งเข้ามา */
function stageOf(app) {
  const raw = String((app && app.status) || "");
  return isStage(raw) ? raw : "new";
}

/**
 * ย้ายสถานะได้ไหม
 *
 * คืนเหตุผลเป็นข้อความไทยเสมอเมื่อไม่ได้ — ข้อความนี้ไปโผล่บนหน้าจอโดยตรง
 * `{ ok: true }` หรือ `{ ok: false, reason }`
 */
function canTransition(from, to) {
  if (!isStage(to)) return { ok: false, reason: `ไม่รู้จักสถานะ "${to}"` };
  const cur = isStage(from) ? String(from) : "new";
  if (cur === to) return { ok: false, reason: "สถานะเดิมอยู่แล้ว" };
  if (STAGES[cur].terminal) {
    return { ok: false, reason: `ใบนี้ปิดไปแล้ว (${STAGES[cur].label}) เปลี่ยนสถานะไม่ได้` };
  }
  if (!(ALLOWED[cur] || []).includes(to)) {
    return { ok: false, reason: `จาก "${STAGES[cur].label}" ไป "${STAGES[to].label}" ไม่ได้` };
  }
  return { ok: true };
}

/** สถานะถัดไปที่กดได้จากสถานะปัจจุบัน — หน้าเว็บ render ปุ่มจากค่านี้ */
const nextStages = (from) => (ALLOWED[isStage(from) ? String(from) : "new"] || []).slice();

/**
 * จ้างได้ไหม
 *
 * **ต้องผ่าน `accepted` เท่านั้น** — การกดจ้างคือการสร้างแฟ้มพนักงานจริง
 * ใบที่ยังไม่มีใครตอบรับข้อเสนอแล้วถูกจ้าง แปลว่ามีแฟ้มพนักงานของคนที่ยังไม่
 * ตกลงจะมาทำงาน ซึ่งไปโผล่ในรอบเงินเดือนได้
 */
function canHire(app) {
  const cur = stageOf(app);
  if (cur === "hired") return { ok: false, reason: "ใบนี้จ้างไปแล้ว" };
  if (cur !== "accepted") {
    return { ok: false, reason: `ต้องอยู่สถานะ "${STAGES.accepted.label}" ก่อนจึงจะกดจ้างได้ (ตอนนี้ ${STAGES[cur].label})` };
  }
  if (app && app.employee_id) return { ok: false, reason: "ใบนี้มีแฟ้มพนักงานแล้ว" };
  return { ok: true };
}

/**
 * แปลงใบสมัครเป็นข้อมูลตั้งต้นของแฟ้มพนักงาน
 *
 * **หยิบเฉพาะที่เป็นข้อเท็จจริงของตัวคน** — ชื่อ/เบอร์/อีเมล/ตำแหน่งที่สมัคร
 * ส่วนเงินเดือน วันเริ่มงาน ประเภทการจ้าง เป็นสิ่งที่ตกลงกันตอนยื่นข้อเสนอ
 * ไม่ได้อยู่ในใบสมัคร **ห้ามเดาแทน HR** ค่าที่เดาให้แล้วไม่มีใครตรวจคือค่าที่
 * จะไปโผล่ในรอบจ่ายเงินเดือนรอบแรก
 */
function employeeDraftFrom(app) {
  const a = app || {};
  return {
    name: String(a.full_name || "").trim(),
    phone: String(a.phone || "").trim() || null,
    email: String(a.email || "").trim() || null,
    position: String(a.position_title || "").trim() || null,
  };
}

/** นับใบตามสถานะ + ใบที่ยังไม่มีใครแตะ (ตัวเลขที่ HR ต้องเห็นก่อนอย่างอื่น) */
function summarize(apps) {
  const counts = {};
  for (const k of Object.keys(STAGES)) counts[k] = 0;
  let open = 0;
  for (const a of apps || []) {
    const s = stageOf(a);
    counts[s] += 1;
    if (!STAGES[s].terminal) open += 1;
  }
  return { total: (apps || []).length, counts, open, untouched: counts.new };
}

module.exports = {
  STAGES, ALLOWED, isStage, stageOf, canTransition, nextStages, canHire,
  employeeDraftFrom, summarize,
};
