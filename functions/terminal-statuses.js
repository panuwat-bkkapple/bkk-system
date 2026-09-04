// สถานะจบงาน — คนอ่านสองคน: runArchive (ย้ายไป jobs_archived หลัง 90 วัน) และ
// onJobTerminalCancelAmendments (ปิด amendment ที่ค้างตอนงานจบ)
//
// ทำไมต้องแยกไฟล์และ normalize (4 ก.ย. 2569): ลิสต์เดิมใน index.js เป็น literal
// ที่มี "Returned" สะกดเก่าตัวเดียว ขณะที่ engine เขียน 'Return Confirmed'
// (return_confirmed) → งานที่ตีกลับผ่าน engine ไม่ถูก archive เลย (ค้างใน /jobs
// ตลอดไป ทุก client ที่ subscribe ทั้งโหนดจ่ายค่า download ให้มัน) และ amendment
// ที่ค้างบนงานนั้นไม่ถูกปิด — ไรเดอร์คนถัดไปโดน single-pending guard บล็อก.
// รายงาน: docs/reports/2026-09-04-status-literal-compare-survey-cross-repo.md ข้อ 1
//
// **สองรูปเพราะคนอ่านสองคนใช้ต่างกัน:** archive ต้อง query ตาม index status
// (ห้ามกวาด /jobs — กฎค่า RTDB) จึงต้องมี**ทุกสะกดที่อยู่ใน DB จริง** เป็นค่า
// query แยกกัน (`TERMINAL_QUERY_STATUSES`); ส่วน trigger ได้ค่าเดียวมาแล้วเทียบ
// ผ่าน normalize (`isTerminalStatus`). สะกดเก่าใน query list เขียนไว้ตรงๆ เพราะ
// generated vocab ไม่ export ตาราง alias — เทสตรวจว่าทุก alias ในไฟล์ enum ที่
// normalize มาลงเซ็ตนี้อยู่ใน query list ครบ (ลืมเมื่อไหร่แดง)
//
// "Withdrawal Completed" ไม่อยู่ใน enum (งานถอนเงินของไรเดอร์ใช้คำศัพท์ของตัวเอง)
// จึงเทียบค่าดิบต่อไปเหมือนเดิม
const { JOB_STATUS, normalizeStatus } = require("./status-vocab.generated");

const TERMINAL_CANONICAL = [
  JOB_STATUS.COMPLETED,
  JOB_STATUS.SOLD,
  JOB_STATUS.CANCELLED,
  JOB_STATUS.CLOSED_LOST,
  JOB_STATUS.RETURN_CONFIRMED,
];
const RAW_TERMINAL = ["Withdrawal Completed"];

function canonicalOf(status) {
  if (typeof status !== "string" || !status) return null;
  return normalizeStatus(status) || null;
}

/** สถานะนี้ (สะกดใดก็ได้) คือจบงานไหม */
function isTerminalStatus(status) {
  if (RAW_TERMINAL.includes(status)) return true;
  const canonical = canonicalOf(status);
  return !!canonical && TERMINAL_CANONICAL.includes(canonical);
}

/** ทุกสะกดที่ต้อง query ตาม index status เพื่อให้ archive เห็นแถวเก่าด้วย */
const LEGACY_TERMINAL_SPELLINGS = ["Returned"];
const TERMINAL_QUERY_STATUSES = [...TERMINAL_CANONICAL, ...LEGACY_TERMINAL_SPELLINGS, ...RAW_TERMINAL];

module.exports = { TERMINAL_CANONICAL, TERMINAL_QUERY_STATUSES, isTerminalStatus };
