// เครื่องใบนี้ขายเข้าล็อตดีลเลอร์ได้ไหม — ตัวตัดสินของ dealer-portal
//
// แยกออกจาก dealer-portal.js (ซึ่ง init firebase-functions ตอน require เทสไม่ได้)
// เพราะกฎตัวนี้เพิ่งพัง (4 ก.ย. 2569): `SELLABLE_STATUSES = ["In Stock", "Ready to
// Sell"]` สะกดเก่าของ Ready to Sell ตัวเดียว ขณะที่ engine เขียน 'Ready To Sell'
// ให้ทุกเครื่องที่กด Push to POS ตั้งแต่ #674 — server จึงปฏิเสธเครื่องพวกนั้นตอน
// publish ล็อต ทั้งที่ #714 เพิ่งแก้ให้หน้า LotManager เห็นและเลือกได้ = ปุ่มที่
// โกหกคนกด. รายงาน: docs/reports/2026-09-04-status-literal-compare-survey-cross-repo.md
//
// คืน null เมื่อขายได้ หรือ { code, message } ให้ caller ห่อเป็น HttpsError —
// รูปเดียวกับ checkUnpackable ใน b2b-unpack.js
const { JOB_STATUS, normalizeStatus } = require("./status-vocab.generated");

/** สถานะสต๊อกที่ขายเข้าล็อตได้ (canonical) */
const SELLABLE_CANONICAL = [JOB_STATUS.IN_STOCK, JOB_STATUS.READY_TO_SELL];

// 'Reserved' ไม่มี canonical (normalizeStatus คืน null — ดู legacy-status-readable
// test) จึงเทียบค่าดิบ: เครื่องที่ล็อตนี้ล็อกไว้เองย่อมขายเข้าล็อตเดิมได้
const RESERVED = "Reserved";

function isSellableStatus(status) {
  const raw = String(status || "");
  const canonical = normalizeStatus(raw) || raw;
  return SELLABLE_CANONICAL.includes(canonical);
}

/**
 * ตรวจว่าเครื่องยังขายเข้า lot ได้ — เรียกทั้งตอน create (feedback เร็ว) และ
 * ตอน publish (กันสถานะเปลี่ยนระหว่างที่ draft ค้างอยู่)
 */
function sellableVerdict(jobId, job, lotId) {
  if (!job) return { code: "not-found", message: `ไม่พบเครื่อง ${jobId} ในระบบ` };
  const type = String(job.type || "");
  if (type === "B2B Trade-in" || type === "Withdrawal") {
    return { code: "failed-precondition", message: `เครื่อง ${job.ref_no || jobId} ไม่ใช่สินค้าสต๊อก` };
  }
  if (job.lot_id && job.lot_id !== lotId) {
    return {
      code: "failed-precondition",
      message: `เครื่อง ${job.ref_no || jobId} ติดอยู่ใน lot อื่น (${job.lot_no || job.lot_id})`,
    };
  }
  const st = String(job.status || "");
  const ok = isSellableStatus(st) || (st === RESERVED && job.lot_id === lotId);
  if (!ok) {
    return { code: "failed-precondition", message: `เครื่อง ${job.ref_no || jobId} สถานะ "${st}" ขายเข้า lot ไม่ได้` };
  }
  return null;
}

module.exports = { SELLABLE_CANONICAL, isSellableStatus, sellableVerdict };
