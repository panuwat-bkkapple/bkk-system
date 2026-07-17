/* eslint-disable @typescript-eslint/no-explicit-any */
// ขอใบเสนอราคา (offer request) — job ที่ลูกค้าส่งเข้ามาทาง self-checkout ทั้งที่
// สเปกยังไม่มีราคากลาง (validateAndCreateOrder ใน bkk-frontend-next ติดธง
// `offer_request: true` และราคาเข้ามาเป็น 0) ทีมงานต้องติดต่อกลับเพื่อเสนอราคา
// ผ่านการแก้ราคาปกติ (final_price) — พอมีราคาแล้วถือว่าเสนอราคาเสร็จ ป้าย/แบนเนอร์
// "รอเสนอราคา" จะหายไปเองโดยไม่ต้องเขียนธงกลับ

/** job นี้ยังรอทีมงานเสนอราคาอยู่หรือไม่ (ธง offer_request และยังไม่มีราคาจริง) */
export function isAwaitingOffer(job: any): boolean {
  if (!job || job.offer_request !== true) return false;
  return !(Number(job.final_price || job.price) > 0);
}
