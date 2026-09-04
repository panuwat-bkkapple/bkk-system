// ตัวเทียบสถานะงานตัวเดียวของ functions/ — normalize ทั้งสองฝั่ง แทน string literal
//
// MIRROR ของ src/utils/statusCompare.ts (แอดมิน) — functions เป็น JS import TS
// ไม่ได้ กติกาต้องตรงกัน: canonicalStatus / statusIs / statusIn / actionIs
// ให้คำตอบเดียวกันทุกอินพุต ด่านคือ src/utils/statusMatchParity.test.ts ซึ่ง
// require ไฟล์นี้มารันบน fixture ชุดเดียวกับฝั่ง TS
//
// ที่มา (4 ก.ย. 2569, docs/reports/2026-09-04-status-literal-compare-survey-cross-repo.md):
// ทุก trigger/scheduler ใน index.js เทียบ status กับลิสต์ literal ที่เขียน "ทั้งสอง
// สะกด" ด้วยมือ — ตัวที่ลืมสะกดหนึ่งพังเงียบ 3 จุดในวันเดียว (FEE_TRIGGER_STATUSES,
// TERMINAL_STATUSES, SELLABLE_STATUSES). กติกาใหม่: reader เขียนเซ็ตด้วย
// JOB_STATUS.* อย่างเดียวแล้วถามผ่านตัวนี้ ด่าน functions/test/status-literal-census.test.mjs
// นับ literal สะกดเก่าในตำแหน่งเทียบทั้ง functions/ ต้องเป็น 0
//
// ข้อยกเว้นที่ตัวนี้มีแต่ฝั่ง TS ไม่มี: queryStatusesFor — fetchJobsByStatuses
// query ตาม index `status` ทีละค่า จึงต้องระบุ**ทุกสะกดที่อยู่ใน DB จริง** ไม่ใช่แค่
// canonical (แถวเก่าสะกดเดิมอยู่ถาวร) ตัวนี้กางจาก LEGACY_ALIAS ให้ ไม่ต้องจำเอง
const { normalizeStatus, LEGACY_ALIAS } = require("./status-vocab.generated");

/** canonical ถ้าอ่านออก ไม่งั้นค่าดิบ (string ไม่ว่าง) ไม่งั้น null */
function canonicalStatus(raw, receiveMethod) {
  const text = typeof raw === "string" && raw ? raw : null;
  if (!text) return null;
  return normalizeStatus(text, receiveMethod || null) || text;
}

function canonicalStatusOf(job) {
  return canonicalStatus(job && job.status, job && job.receive_method);
}

/** งานอยู่ในสถานะใดสถานะหนึ่งที่ให้มา (เขียนด้วย JOB_STATUS.*) */
function statusIs(job, ...canonical) {
  const s = canonicalStatusOf(job);
  return !!s && canonical.includes(s);
}

function statusIn(job, set) {
  const s = canonicalStatusOf(job);
  if (!s) return false;
  return set instanceof Set ? set.has(s) : set.includes(s);
}

/**
 * เทียบสถานะที่มาเป็นค่าเดี่ยว (before/after ของ onValueUpdated) — ไม่มี
 * receive_method ให้ใช้ได้เฉพาะสถานะที่ไม่ overload ('In-Transit' ต้องส่ง job)
 */
function rawStatusIs(raw, receiveMethod, ...canonical) {
  const s = canonicalStatus(raw, receiveMethod);
  return !!s && canonical.includes(s);
}

/** เทียบ qc_logs[].action — engine เขียน action = ชื่อสถานะ canonical, log เก่าสะกดเดิม */
function actionIs(action, ...accepted) {
  const a = canonicalStatus(action);
  return !!a && accepted.includes(a);
}

/**
 * ทุกสะกดที่ต้องส่งให้ fetchJobsByStatuses เพื่อให้ได้แถวของสถานะ canonical
 * ชุดนี้ครบ — canonical เอง + ทุก alias ที่ normalize มาลงเซ็ต. 'In-Transit'
 * (overload ตาม receive_method) ถูกรวมเมื่อขอ Rider Returning หรือ Parcel In
 * Transit; caller ต้องกรองซ้ำด้วย statusIs หลัง fetch เพราะ index query ไม่รู้จัก
 * receive_method
 */
function queryStatusesFor(canonical) {
  const wanted = new Set(canonical);
  const out = [...canonical];
  for (const [legacy, target] of Object.entries(LEGACY_ALIAS)) {
    if (wanted.has(target) && !out.includes(legacy)) out.push(legacy);
  }
  if ((wanted.has("Rider Returning") || wanted.has("Parcel In Transit")) && !out.includes("In-Transit")) {
    out.push("In-Transit");
  }
  return out;
}

module.exports = { canonicalStatus, canonicalStatusOf, statusIs, statusIn, rawStatusIs, actionIs, queryStatusesFor };
