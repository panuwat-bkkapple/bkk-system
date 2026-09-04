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

// `step` = ตำแหน่งบนแถบความคืบหน้า (stepper) ที่หน้าเว็บวาด · `short` = คำสั้น
// ที่ใช้บนแถบนั้น (ป้ายเต็มยาวเกินไปเมื่อวางเรียงกันหกขั้น)
//
// **ลำดับขั้นอยู่ที่นี่ ไม่ใช่ที่หน้าเว็บ** — หน้าเว็บวาดแถบจากค่าที่ server ส่ง
// มา ถ้าให้มันถือ array ของตัวเองก็จะได้สำเนาที่สองของเครื่องสถานะทันที และ
// วันที่ ALLOWED เปลี่ยน แถบจะยังวาดตามลำดับเก่าโดยไม่มีอะไรเตือน
//
// **`offtrack` ไม่ใช่ terminal** — `rejected`/`declined` เป็นทางออกด้านข้างที่
// ปิดสายด้วย ส่วน `approved` เป็นค่าเก่าที่ยังเดินต่อได้แต่**ไม่มีตำแหน่งบนสาย
// วันนี้** การยัดมันลงขั้นใดขั้นหนึ่งคือการแต่งตำแหน่งที่ไม่เคยมีจริง
const STAGES = {
  new: { label: "ใหม่", short: "ใหม่", tone: "red", step: 1 },
  reviewing: { label: "กำลังตรวจสอบ", short: "ตรวจสอบ", tone: "amber", step: 2 },
  interview: { label: "นัดสัมภาษณ์", short: "สัมภาษณ์", tone: "blue", step: 3 },
  offer: { label: "ยื่นข้อเสนอแล้ว", short: "ข้อเสนอ", tone: "violet", step: 4 },
  accepted: { label: "ตอบรับแล้ว รอเริ่มงาน", short: "ตอบรับ", tone: "teal", step: 5 },
  hired: { label: "จ้างแล้ว", short: "จ้างแล้ว", tone: "emerald", step: 6, terminal: true },
  rejected: { label: "ไม่ผ่าน", short: "ไม่ผ่าน", tone: "gray", terminal: true, offtrack: true },
  declined: { label: "ผู้สมัครปฏิเสธ", short: "ปฏิเสธ", tone: "gray", terminal: true, offtrack: true },
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
  approved: { label: "ผ่าน (ค่าเดิม)", short: "ผ่าน", tone: "green", legacy: true, offtrack: true },
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

/**
 * ขั้นบนแถบความคืบหน้า เรียงตามลำดับจริง
 *
 * derive จาก STAGES ไม่ได้เขียนซ้ำ — ลิสต์ที่พิมพ์เองเป็นครั้งที่สองคือลิสต์ที่
 * จะไม่ตรงกับ `step` ในวันที่มีคนแก้ค่าใดค่าหนึ่ง
 */
function buildTrack(stages) {
  return Object.entries(stages || {})
    .filter(([, m]) => m && !m.offtrack && Number.isFinite(m.step))
    // **การเรียงจำเป็นจริง ห้ามถอด** — `Object.entries` คืนตามลำดับที่ประกาศ
    // ซึ่งวันนี้บังเอิญตรงกับ `step` พอดี ทำให้ถอด sort ออกแล้วยังเขียว (เจอ
    // จาก injection ข้อ 4) แต่คนที่เพิ่มขั้นใหม่จะพิมพ์ต่อท้าย object เป็น
    // ธรรมชาติ แล้วแถบจะวาดผิดลำดับทันทีโดยไม่มีอะไรเตือน — เทสจึงป้อน stages
    // ที่ประกาศสลับลำดับเข้ามาตรงๆ เพื่อให้ไปถึงบรรทัดนี้
    .sort((a, b) => a[1].step - b[1].step)
    .map(([key, m]) => ({ key, step: m.step, short: m.short, label: m.label }));
}

const TRACK = buildTrack(STAGES);

/** ขั้นที่ใบนี้เดินมาถึง — ใบที่อยู่นอกสายคืน 0 (แถบไม่เดิน ไม่ใช่เดินไปสุด) */
function trackStepOf(app) {
  const m = STAGES[stageOf(app)];
  return m.offtrack || !Number.isFinite(m.step) ? 0 : m.step;
}

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

// ---------------------------------------------------------------------------
// ฟิลด์ภายในของ HR ต้องไม่อยู่บนแถวที่ผู้สมัครอ่านได้
//
// กฎของ `job_applications/$appId` ให้เจ้าของใบอ่านใบตัวเองได้
// (`data.child('uid').val() === auth.uid` ใน database.rules.json ของ
// bkk-frontend-next) — ซึ่งถูก ผู้สมัครต้องเห็นสถานะใบตัวเองที่หน้า
// /my-applications **แต่แปลว่าทุกฟิลด์ที่วางไว้บนแถวนั้นผู้สมัครอ่านได้หมด**
// ไม่ใช่แค่ที่หน้าเว็บเลือกแสดง (`curl .../job_applications/{id}.json` พร้อม
// token ของเขาเองข้ามหน้าเว็บไปเลย) — ตระกูลเดียวกับ public_track
//
// สามอย่างนี้จึงย้ายไป `job_application_notes/{id}` ซึ่ง**ไม่มี rule เป็นของ
// ตัวเอง** = ตกกฎ root `.read/.write: false` อ่านได้เฉพาะ Admin SDK
// **ไม่ต้อง deploy rules**:
//   - `admin_note`   โน้ต HR เกี่ยวกับตัวผู้สมัคร (หน้าเดิมฝั่งเว็บลูกค้าเขียน
//                    ลงแถวตรงๆ มาตลอด)
//   - `offer_note`   เงื่อนไขที่เสนอ — มีเงินเดือนอยู่ในนั้น
//   - `stage_history` มี `by_name` = ชื่อจริงของพนักงาน = PII ของบุคคลที่สาม
//
// สิ่งที่ยังอยู่บนแถวโดยตั้งใจคือ `status` (ผู้สมัครต้องเห็น) และฟิลด์ที่ตัวเขา
// กรอกมาเอง
// ---------------------------------------------------------------------------
const INTERNAL_FIELDS = ["admin_note", "offer_note", "stage_history"];

/**
 * แยกฟิลด์ภายในที่ยังค้างอยู่บนแถวใบสมัคร (แถวเก่าที่เขียนก่อนย้ายโหนด)
 *
 * คืน `null` เมื่อไม่มีอะไรค้าง — ตัวเรียกใช้ค่านี้ตัดสินว่าต้องย้ายไหม
 * จึงไม่เขียนซ้ำทุกครั้งที่เปิดหน้า
 */
function legacyInternalFields(app) {
  const a = app || {};
  const found = {};
  let any = false;
  for (const k of INTERNAL_FIELDS) {
    if (a[k] === undefined || a[k] === null || a[k] === "") continue;
    if (Array.isArray(a[k]) && a[k].length === 0) continue;
    found[k] = a[k];
    any = true;
  }
  return any ? found : null;
}

/**
 * รวมโน้ตจากโหนดใหม่กับค่าที่ยังค้างบนแถวเก่า
 *
 * **โหนดใหม่ชนะเสมอ** — ถ้ามีทั้งสองที่แปลว่าย้ายมาแล้วและถูกแก้ต่อ ค่าบนแถว
 * คือสำเนาที่แช่แข็งอยู่ ณ วันที่ย้าย
 */
function mergeNotes(app, notesRow) {
  const legacy = legacyInternalFields(app) || {};
  const n = notesRow || {};
  // เทียบด้วย "มีคีย์ไหม" ไม่ใช่ "ค่าเป็น null ไหม" — HR ที่ลบโน้ตทิ้งเขียน
  // `admin_note: null` ลงโหนดใหม่ ถ้าตีความว่า "ไม่มีค่า" แล้วถอยไปอ่านแถวเก่า
  // โน้ตที่เพิ่งลบจะฟื้นขึ้นมาเอง (เทสข้อ 14 จับได้ตอนเขียนครั้งแรก)
  //
  // ใน RTDB การเขียน null คือการลบคีย์ทิ้ง อ่านกลับมาจึงไม่มีคีย์และตกไปอ่าน
  // แถวเก่า — ที่ทำให้ถูกคือ **ทุกเส้นทางที่เขียนโน้ตล้างฟิลด์บนแถวเก่าไปด้วย
  // เสมอ** (`clearInternalOnRow`) ไม่ใช่กติกาข้อนี้ลำพัง
  const pick = (k) =>
    (Object.prototype.hasOwnProperty.call(n, k) ? n[k] : legacy[k]);
  const history = pick("stage_history");
  return {
    admin_note: pick("admin_note") || null,
    offer_note: pick("offer_note") || null,
    stage_history: Array.isArray(history) ? history : [],
  };
}

/**
 * ลบใบสมัครได้ไหม
 *
 * **ใบที่กลายเป็นแฟ้มพนักงานแล้วลบไม่ได้** — แฟ้มชี้กลับมาที่ใบนี้
 * (`employees/{id}/application_id`) ลบทิ้งแล้วได้แฟ้มที่ชี้ไปที่ว่าง และเอกสาร
 * ที่บอกว่าคนคนนี้ถูกจ้างมาได้อย่างไรก็หายไปด้วย ซึ่งเป็นสิ่งที่ต้องมีตอนมี
 * ข้อพิพาทเรื่องการจ้าง
 */
function canDelete(app) {
  const a = app || {};
  if (a.employee_id) return { ok: false, reason: "ใบนี้กลายเป็นแฟ้มพนักงานแล้ว ลบไม่ได้" };
  if (stageOf(a) === "hired") return { ok: false, reason: "ใบที่จ้างแล้วลบไม่ได้" };
  return { ok: true };
}

/**
 * ถอด path ใน Storage ออกจาก download URL ของเรซูเม่
 *
 * URL ที่ `getDownloadURL()` คืนมามีรูป
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path ที่ encode>?alt=media&token=...`
 * โดย `<path>` ถูก percent-encode ทั้งก้อน (`/` กลายเป็น `%2F`)
 *
 * **คืน null เมื่ออ่านไม่ออก และตัวเรียกต้องถือว่านั่นคือความล้มเหลว ไม่ใช่
 * "ไม่มีไฟล์"** — ลบแถวทิ้งโดยไฟล์ยังอยู่ = เรซูเม่กำพร้าที่ไม่มีใครหาเจอ
 * อีกเลย (URL อยู่บนแถวที่เพิ่งลบ) และไม่มี process ไหนตามมาเก็บ
 * (`functions/src/retention.ts` ของอีกรีโปกวาดเฉพาะ RTDB ไม่แตะ Storage)
 *
 * รับเฉพาะ path ใต้ `job-applications/` — URL ที่ชี้ไปที่อื่นคือสิ่งที่ไม่ควร
 * ถูกลบผ่านทางนี้
 */
function resumeStoragePath(url) {
  const raw = String(url || "");
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  const m = parsed.pathname.match(/\/o\/([^/?]+)$/);
  if (!m) return null;
  let path;
  try { path = decodeURIComponent(m[1]); } catch { return null; }
  if (!path.startsWith("job-applications/")) return null;
  if (path.includes("..")) return null;
  return path;
}

/**
 * ฟิลด์ที่ต้องถูกล้างออกจากแถวใบสมัคร (ค่า null = RTDB ลบคีย์ทิ้ง)
 *
 * ใช้ทั้งตอนย้ายแถวเก่าและตอนเขียนสถานะใหม่ — การเขียนสถานะเป็นจังหวะเดียวที่
 * รู้แน่ว่าแถวนี้กำลังถูกแตะอยู่ จึงเป็นจังหวะที่ถูกที่จะเก็บกวาดไปด้วย
 */
const clearInternalOnRow = () =>
  INTERNAL_FIELDS.reduce((acc, k) => { acc[k] = null; return acc; }, {});

/**
 * สิ่งที่เขียนลง `job_applications/{id}` ตอนย้ายสถานะ
 *
 * **แยกออกมาเป็นฟังก์ชันล้วนเพราะนี่คือจุดที่ข้อมูลภายในจะหลุดออกไปหาผู้สมัคร**
 * — เขียนอะไรลงแถวนี้ ผู้สมัครอ่านได้หมด เทสจึงตรวจ *ผลลัพธ์* ของฟังก์ชันนี้
 * ได้ตรงๆ แทนที่จะไปหาข้อความในซอร์ส
 */
function stageRowUpdate(to, at) {
  return { status: to, updated_at: at, ...clearInternalOnRow() };
}

/**
 * แถวทะเบียนการลบใบสมัคร
 *
 * **ห้ามมีชื่อ เบอร์ อีเมล หรือข้อความที่ผู้สมัครเขียน** — การเก็บข้อมูลของคน
 * ที่เพิ่งขอให้ลบไว้ในทะเบียนคือการไม่ได้ลบ สิ่งที่ต้องตอบได้ตอนถูกถามคือ
 * "ใบไหน ตำแหน่งอะไร ใครลบ เมื่อไหร่" เท่านั้น
 */
function deletionLogRow(id, app, actor, resumeDeleted, reason) {
  const a = app || {};
  const by = actor || {};
  return {
    application_id: id,
    position_title: a.position_title || null,
    created_at: Number(a.created_at) || null,
    deleted_at: Date.now(),
    by_name: by.by_name || null,
    by_staff_id: by.by_staff_id || null,
    resume_deleted: Boolean(resumeDeleted),
    reason: String(reason || "").slice(0, 200) || null,
  };
}

module.exports = {
  STAGES, ALLOWED, TRACK, buildTrack, trackStepOf, isStage, stageOf, canTransition, nextStages, canHire,
  employeeDraftFrom, summarize,
  INTERNAL_FIELDS, legacyInternalFields, mergeNotes, canDelete, resumeStoragePath,
  clearInternalOnRow, stageRowUpdate, deletionLogRow,
};
