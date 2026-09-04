// =============================================================================
// Push ถึงไรเดอร์ต้องเป็น data-only — ตัวแปลงตัวเดียวสำหรับทุก call site
//
// ทำไมต้องมี: แอปไรเดอร์ (bkk-rider-app) มีผู้ส่งสองราย — functions ของมันเอง
// ส่ง data-only (`data.title` / `data.body`) ส่วน `pushToRider` ของรีโปนี้ส่ง
// `notification: {title, body}` มาตลอด 11 จุด และ Service Worker ฝั่งนั้นสร้าง
// ใบแจ้งจาก `data.title` / `data.body` เท่านั้น
//
// กติกาของ @firebase/messaging (อ่านจากซอร์สที่ติดตั้งจริง 0.12.12,
// `onPush` ใน dist/index.sw.cjs) คือ: ถ้ามี `notification` SDK จะ
// showNotification ให้เอง **แล้วยังเรียก** onBackgroundMessage ต่ออีก —
// ผลบนเครื่องไรเดอร์คือ push จากรีโปนี้ **เด้งสองใบ** ใบที่สองเป็น "BKK Rider"
// เนื้อว่าง (SW หา data.title/data.body ไม่เจอ) ดูรายงานสำรวจ
// bkk-rider-app/docs/reports/2026-09-03-rider-push-delivery-survey.md ข้อ D
//
// แก้ที่ seam เดียวคือ `pushToRider` ไม่ไล่แก้ 11 call site — call site เขียนรูป
// `notification` ต่อไปได้ตามเดิม ตัวนี้ย้าย title/body ลง `data` แล้วถอด
// `notification` ออกก่อนส่ง ทำให้ทุกใบมีรูปเดียวกับที่ functions ฝั่งไรเดอร์ส่ง
//
// **ห้ามเอา `notification` กลับมา** — แม้ดูเหมือน "ปลอดภัยกว่า" เพราะเบราว์เซอร์
// แสดงให้เอง ความจริงคือมันคือต้นเหตุของใบซ้ำ และ foreground ฝั่งไรเดอร์
// (bkk-rider-app #149) อ่าน data.title/data.body ก่อน notification อยู่แล้ว
//
// pure — ไม่แตะ firebase เพื่อให้ functions/test/rider-push-payload.test.mjs
// require ได้โดยไม่ต้อง initializeApp
// =============================================================================

/** แปลง message ที่ call site ส่งมาให้เป็น data-only
 *  - title/body จาก `notification` ถูกย้ายลง `data` (data ที่มีอยู่แล้วชนะ —
 *    call site ที่ส่ง data.title มาเองถือว่าตั้งใจ)
 *  - `notification` ถูกถอดออกเสมอ
 *  - ค่าใน data ต้องเป็น string ทุกตัวตามข้อกำหนดของ FCM — ตัวที่ไม่ใช่ string
 *    แปลงด้วย String() ส่วน null/undefined ทิ้ง (FCM ปฏิเสธทั้งข้อความถ้ามี)
 *  - ฟิลด์อื่น (android/apns/webpush/tokens) ส่งผ่านตามเดิม */
function toDataOnlyRiderPush(message) {
  const src = message && typeof message === "object" ? message : {};
  const { notification, data: rawData, ...rest } = src;

  const data = {};
  for (const [k, v] of Object.entries(rawData || {})) {
    if (v === null || v === undefined) continue;
    data[k] = typeof v === "string" ? v : String(v);
  }

  const title = typeof notification?.title === "string" ? notification.title.trim() : "";
  const body = typeof notification?.body === "string" ? notification.body.trim() : "";
  if (!data.title && title) data.title = title;
  if (!data.body && body) data.body = body;

  return { ...rest, data };
}

module.exports = { toDataOnlyRiderPush };
