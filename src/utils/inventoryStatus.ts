// สถานะ "อยู่ในคลัง" ที่หน้า /inventory ใช้กรอง/นับ/ตัดสินปุ่ม — เทียบผ่าน
// normalizeStatus ทั้งสองฝั่ง ไม่ใช่ string literal
//
// เคสจริง 4 ก.ย. 2569 (ต่อจาก #709): ปุ่มเข้าสต็อก / ขึ้น POS ย้ายไป engine (#674)
// ซึ่งเขียน canonical 'Ready To Sell' แต่ Inventory.tsx กรองด้วย
// ['In Stock','Ready to Sell','Reserved'].includes(j.status) → เครื่องที่เพิ่งขึ้น
// POS หายจากหน้าคลังและ KPI ทั้งสามใบ
//
// 'Reserved' ไม่มี canonical (ไม่อยู่ใน JOB_STATUS/LEGACY_ALIAS — ดู CLAUDE.md
// "ตัวที่ยังไม่ผ่าน engine") normalizeStatus จึงคืน null ต้องตกกลับไปใช้ค่าดิบ
import { JOB_STATUS, normalizeStatus } from '../types/job-statuses';

export const RESERVED_STATUS = 'Reserved';

type StatusJob = { status?: string | null; receive_method?: string | null } | null | undefined;

/** canonical ถ้าอ่านออก ไม่งั้นค่าดิบ (สำหรับสถานะที่ยังไม่มี canonical เช่น Reserved) */
export const inventoryStatusOf = (job: StatusJob): string | null => {
   const raw = job?.status;
   const canonical = normalizeStatus(raw, job?.receive_method);
   if (canonical) return canonical;
   return typeof raw === 'string' && raw ? raw : null;
};

const INVENTORY_STATUSES: ReadonlySet<string> = new Set([
   JOB_STATUS.IN_STOCK, JOB_STATUS.READY_TO_SELL, RESERVED_STATUS,
]);

export const isInventoryStock = (job: StatusJob): boolean => {
   const s = inventoryStatusOf(job);
   return !!s && INVENTORY_STATUSES.has(s);
};
export const isInStock = (job: StatusJob): boolean => inventoryStatusOf(job) === JOB_STATUS.IN_STOCK;
export const isReadyToSell = (job: StatusJob): boolean => inventoryStatusOf(job) === JOB_STATUS.READY_TO_SELL;
export const isReserved = (job: StatusJob): boolean => inventoryStatusOf(job) === RESERVED_STATUS;
