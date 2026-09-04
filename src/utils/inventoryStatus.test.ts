// ด่านของหน้า /inventory (ต่อจาก #709) — engine เขียน 'Ready To Sell' แต่หน้าคลัง
// เทียบ 'Ready to Sell' → เครื่องที่ขึ้น POS วันนี้หายจากรายการและ KPI
//
// injection ที่ต้องแดง: เปลี่ยน inventoryStatusOf ให้คืนค่าดิบเสมอ (ไม่ normalize)
// → เคส canonical แดง (isInventoryStock / isReadyToSell ของ 'Ready To Sell')
import { describe, it, expect } from 'vitest';
import { JOB_STATUS } from '../types/job-statuses';
import { isInventoryStock, isInStock, isReadyToSell, isReserved, inventoryStatusOf, selectPosStock } from './inventoryStatus';

describe('inventory status compare', () => {
   it('lists both spellings of Ready To Sell, In Stock, and raw Reserved', () => {
      const jobs = [
         { id: 'engine-pos', status: JOB_STATUS.READY_TO_SELL }, // 'Ready To Sell'
         { id: 'legacy-pos', status: 'Ready to Sell' },
         { id: 'stock', status: JOB_STATUS.IN_STOCK },
         { id: 'reserved', status: 'Reserved' },
         { id: 'lab', status: JOB_STATUS.SENT_TO_QC_LAB },
         { id: 'sold', status: JOB_STATUS.SOLD },
         { id: 'none', status: null },
      ];
      expect(JOB_STATUS.READY_TO_SELL).not.toBe('Ready to Sell');
      expect(jobs.filter(isInventoryStock).map((j) => j.id)).toEqual(['engine-pos', 'legacy-pos', 'stock', 'reserved']);
      expect(jobs.filter(isReadyToSell).map((j) => j.id)).toEqual(['engine-pos', 'legacy-pos']);
      expect(jobs.filter(isInStock).map((j) => j.id)).toEqual(['stock']);
      expect(jobs.filter(isReserved).map((j) => j.id)).toEqual(['reserved']);
   });

   it('inventoryStatusOf returns canonical when readable, raw otherwise', () => {
      expect(inventoryStatusOf({ status: 'Ready to Sell' })).toBe(JOB_STATUS.READY_TO_SELL);
      expect(inventoryStatusOf({ status: 'Reserved' })).toBe('Reserved');
      expect(inventoryStatusOf({ status: '' })).toBeNull();
      expect(inventoryStatusOf(null)).toBeNull();
   });
});

// POS (#711 commit 2): เครื่องที่ Push to POS หลัง #674 สะกด 'Ready To Sell' ต้องขายได้
// injection ที่ต้องแดง: selectPosStock กลับเป็น jobs.filter(j => j.status === 'Ready to Sell')
describe('POS stock list', () => {
   it('sells devices under both spellings of Ready To Sell and nothing else', () => {
      const jobs = [
         { id: 'engine-pos', status: JOB_STATUS.READY_TO_SELL },
         { id: 'legacy-pos', status: 'Ready to Sell' },
         { id: 'stock', status: JOB_STATUS.IN_STOCK },
         { id: 'reserved', status: 'Reserved' },
         { id: 'sold', status: JOB_STATUS.SOLD },
      ];
      expect(selectPosStock(jobs).map((j) => j.id)).toEqual(['engine-pos', 'legacy-pos']);
   });
});
