// =============================================================================
// สถานะ "เครื่องของไรเดอร์คนนี้ยังรับ push ได้ไหม" — อ่านจากสิ่งที่แอปไรเดอร์
// เขียนไว้อยู่แล้ว (riders/{id}/fcm_tokens/{deviceId}.updated_at และ
// riders/{id}/fcm_updated_at) ไม่ต้องเพิ่ม writer ใหม่
//
// ทำไมต้องมี (bkk-rider-app/docs/reports/2026-09-03-rider-push-delivery-survey.md ข้อ H):
// server ตัด token ที่ FCM ปฏิเสธทิ้งทันทีโดยไม่บันทึกที่ไหน (pushToRider และ
// sendToRider ฝั่งไรเดอร์) และ token ต่ออายุได้เฉพาะตอนไรเดอร์เปิดแอป — จึงมี
// สภาพ "ไรเดอร์ที่อนุมัติแล้วแต่ push ไปไม่ถึงเลย" เกิดได้เงียบๆ และ**ไม่มีจอไหน
// ในระบบตอบคำถามนี้ได้** จนกว่าไรเดอร์จะบ่น
//
// MIRROR: bkk-system/src/utils/riderPushHealth.ts (TS สำหรับหน้า RiderManagement)
// — functions import TS ไม่ได้ กฎ/เกณฑ์ต้องตรงกัน แก้ที่หนึ่งต้องแก้ทั้งคู่.
// เกณฑ์ 7 วันตรงกับการ์ดในแอปไรเดอร์ (bkk-rider-app src/utils/pushHealth.ts
// AGE_STALE_MS) ซึ่งเตือนไรเดอร์ด้วยเลขเดียวกัน — สามที่ต้องเห็นตรงกัน ไม่งั้น
// แอดมินเห็นแดงขณะที่ไรเดอร์เห็นเขียว
//
// pure — ไม่แตะ firebase เพื่อให้ functions/test/rider-push-coverage.test.mjs
// require ได้ และ health-check.js เรียกใช้ได้โดยส่ง snapshot ที่อ่านมาแล้ว
// =============================================================================

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** สรุปสถานะ push ของไรเดอร์หนึ่งคน
 *  @returns {{ level: 'ok'|'stale'|'none', devices: number, updatedAt: number|null }}
 *    ok    = มี token และเขียนล่าสุดไม่เกิน 7 วัน
 *    stale = มี token แต่ไม่ได้ต่ออายุเกิน 7 วัน (ไรเดอร์ไม่ได้เปิดแอป — อาจตายแล้ว)
 *    none  = ไม่มี token เลย (ถูก server ตัดทิ้งหมด / ไม่เคยลงทะเบียน)
 */
function assessRiderPushHealth(rider, now = Date.now()) {
  const r = rider && typeof rider === "object" ? rider : {};
  let devices = 0;
  let updatedAt = null;

  const multi = r.fcm_tokens && typeof r.fcm_tokens === "object" ? r.fcm_tokens : {};
  for (const entry of Object.values(multi)) {
    if (!entry || typeof entry.token !== "string" || !entry.token) continue;
    devices += 1;
    const t = Number(entry.updated_at);
    if (Number.isFinite(t) && t > 0 && (updatedAt === null || t > updatedAt)) updatedAt = t;
  }
  // legacy single-token field — client ลบทิ้งเมื่อมี multi แล้ว แต่แถวเก่ายังมีได้
  if (devices === 0 && typeof r.fcm_token === "string" && r.fcm_token) devices = 1;

  const top = Number(r.fcm_updated_at);
  if (Number.isFinite(top) && top > 0 && (updatedAt === null || top > updatedAt)) updatedAt = top;

  if (devices === 0) return { level: "none", devices: 0, updatedAt };
  if (updatedAt === null || now - updatedAt > STALE_MS) return { level: "stale", devices, updatedAt };
  return { level: "ok", devices, updatedAt };
}

/** สรุปทั้งฝูงสำหรับ probe — รับเฉพาะไรเดอร์ที่ผู้เรียกกรองว่า "อนุมัติแล้ว" มาแล้ว
 *  @param {Array<{id:string, name?:string, rider:object}>} approved
 *  @returns {{ total:number, ok:number, stale:string[], none:string[] }} (ชื่อไรเดอร์)
 */
function summarizeRiderPushCoverage(approved, now = Date.now()) {
  const out = { total: 0, ok: 0, stale: [], none: [] };
  for (const item of approved || []) {
    out.total += 1;
    const label = String(item.name || item.id || "?");
    const h = assessRiderPushHealth(item.rider, now);
    if (h.level === "ok") out.ok += 1;
    else if (h.level === "stale") out.stale.push(label);
    else out.none.push(label);
  }
  return out;
}

module.exports = { assessRiderPushHealth, summarizeRiderPushCoverage, STALE_MS };
