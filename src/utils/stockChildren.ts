// งานลูกที่เป็น "เครื่องในคลัง" ไม่ใช่ใบสั่งขายของลูกค้า — นิยามเดียวของทั้งแอป
//
// มีสามชนิด และทุกชนิดถูกสร้างโดยระบบจากงานแม่ใบเดียว:
//   'B2B-Unpacked'  ล็อตขายส่งระเบิดกล่อง (functions/b2b-unpack.js)
//   'Accessory'     Pencil/Keyboard ที่ขายพ่วง iPad (accessoryItems.ts + b2c-unpack.js)
//   'B2C-Unpacked'  งานขายปลีกที่มีหลายเครื่อง แตกรายเครื่องตอนเข้าคิวคลัง
//                   (functions/b2c-unpack.js)
//
// ทำไมต้องมีไฟล์นี้: ก่อนหน้านี้แต่ละหน้าจอพิมพ์รายการชนิดเอง และ**รายการไม่เท่ากัน**
// (Analytics ตัด Accessory แต่ไม่ตัด B2B-Unpacked · NotificationCenter ตัด
// B2B-Unpacked แต่ไม่ตัด Accessory) — กฎเดียว ติดตั้งไม่ครบทุกคนที่อ่านมัน
// พอเพิ่มชนิดที่สามจึงต้องรวมเป็น seam เดียว. `stockChildren.test.ts` สแกนว่าไม่มี
// ไฟล์ไหนใน src/ เทียบชนิดพวกนี้เองอีก
//
// MIRROR: `STOCK_CHILD_TYPES` ใน functions/b2c-unpack.js — เทสอ่านไฟล์นั้นมาเทียบ
import { JOB_STATUS } from '../types/job-statuses';

export const B2B_UNPACKED_JOB_TYPE = 'B2B-Unpacked';
export const ACCESSORY_CHILD_JOB_TYPE = 'Accessory';
export const B2C_UNPACKED_JOB_TYPE = 'B2C-Unpacked';

export const STOCK_CHILD_TYPES: readonly string[] = [
  B2B_UNPACKED_JOB_TYPE,
  ACCESSORY_CHILD_JOB_TYPE,
  B2C_UNPACKED_JOB_TYPE,
];

// สถานะที่ trigger ฝั่ง server แตกงานหลายเครื่อง ("เครื่องถึงร้านแล้ว") — การ์ดบน
// ตั๋วใช้ตัดสินว่าควรมีปุ่มรันซ้ำไหม. MIRROR: ENTRY_STATUSES ใน functions/b2c-unpack.js
// (ซึ่ง = FEE_TRIGGER_CANONICAL ของค่ารอบไรเดอร์) — เทสเทียบสองสำเนา
export const MULTI_UNPACK_ENTRY_STATUSES: readonly string[] = [
  JOB_STATUS.PENDING_QC,
  JOB_STATUS.SENT_TO_QC_LAB,
  JOB_STATUS.IN_STOCK,
];

type TypedJob = { type?: unknown } | null | undefined;

/** แถวนี้เป็นเครื่องในคลังที่ระบบแตกมาจากงานแม่ (ไม่ใช่ ticket ลูกค้า / ไม่ใช่เงินที่จ่าย) */
export const isStockChildJob = (job: TypedJob): boolean =>
  typeof job?.type === 'string' && STOCK_CHILD_TYPES.includes(job.type);

/** งานลูกรายเครื่องของงานขายปลีกหลายเครื่อง — มี parent_ref_no + device_index */
export const isB2cUnpackedChild = (job: TypedJob): boolean =>
  job?.type === B2C_UNPACKED_JOB_TYPE;

/** stamp ที่ b2c-unpack.js เขียนบนงานแม่ */
export interface MultiUnpackStamp {
  at?: number;
  by?: string;
  count?: number;
  child_ids?: string[];
  child_refs?: string[];
  accessory_child_ids?: string[];
  written?: boolean;
  written_at?: number;
}

type ParentLike = { multi_unpack?: MultiUnpackStamp | null; status?: unknown; devices?: unknown } | null | undefined;

/**
 * สถานะของการแตกบนงานแม่ — ใช้ตัดสินป้ายและปุ่มรันซ้ำบนตั๋ว
 *   'none'     ยังไม่เคยเริ่ม (หรือไม่ใช่งานหลายเครื่อง)
 *   'partial'  stamp มีแต่รอบที่แล้วล้มก่อนเขียนลูกครบ / ก่อนแม่ปิด — ต้องรันซ้ำ
 *   'done'     ลูกเขียนครบและแม่ปิด (Completed) แล้ว
 */
export type MultiUnpackState = 'none' | 'partial' | 'done';

export const multiUnpackState = (job: ParentLike, parentIsCompleted: boolean): MultiUnpackState => {
  const stamp = job?.multi_unpack;
  if (!stamp) return 'none';
  return stamp.written === true && parentIsCompleted ? 'done' : 'partial';
};
