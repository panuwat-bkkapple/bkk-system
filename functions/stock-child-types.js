// ชนิดของงานลูกที่เป็น "เครื่องในคลัง" ไม่ใช่ใบสั่งขายของลูกค้า — ไฟล์นี้ไม่ require
// อะไรเลยโดยตั้งใจ เพื่อให้ chat-ai.js / b2c-unpack.js / ใครก็ตาม require ได้โดย
// ไม่ลากโมดูล firebase-functions ติดมาและไม่เกิด require cycle
//
// MIRROR: src/utils/stockChildren.ts (STOCK_CHILD_TYPES) — เทส stockChildren.test.ts
// อ่านค่าจาก b2c-unpack.js ซึ่ง re-export ตัวนี้
const B2B_UNPACKED_TYPE = "B2B-Unpacked";
const ACCESSORY_TYPE = "Accessory";
const B2C_UNPACKED_TYPE = "B2C-Unpacked";
const STOCK_CHILD_TYPES = [B2B_UNPACKED_TYPE, ACCESSORY_TYPE, B2C_UNPACKED_TYPE];

module.exports = { B2B_UNPACKED_TYPE, ACCESSORY_TYPE, B2C_UNPACKED_TYPE, STOCK_CHILD_TYPES };
