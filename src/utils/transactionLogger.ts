// src/utils/transactionLogger.ts
import { push, ref, serverTimestamp } from 'firebase/database';
import { db } from '../api/firebase';

export type TransactionType = 'CREDIT' | 'DEBIT';

interface TransactionLog {
  rider_id: string;
  amount: number;
  type: TransactionType;
  // ADJUSTMENT = แก้ยอดที่คิดผิด (ไม่ใช่ค่าปรับ ไม่ใช่ค่ารอบใหม่)
  //
  // MIRROR 3 ที่ — แก้ที่นี่ต้องแก้อีกสองที่เสมอ:
  //   bkk-rider-app/src/utils/walletLedger.ts   (allowlist + ป้ายไทยของจอ)
  //   bkk-rider-app/functions/src/index.ts      (ตัวคำนวณ "ยอดถอนได้")
  // เคยเดินห่างกันมาแล้วจริง: ADJUSTMENT ถูกเพิ่มที่ไฟล์นี้กับ walletLedger.ts
  // แต่ **ลืมสำเนาใน functions** ผลคือยอดที่ไรเดอร์เห็นกับยอดที่ถอนได้ไม่ตรงกัน
  // โดยไม่มี error ที่ไหนบอก (ปิดไปแล้วพร้อมกับ EXPENSE_REIMBURSEMENT)
  // EXPENSE_REIMBURSEMENT = คืนเงินที่ไรเดอร์สำรองจ่าย (ทางด่วน/ที่จอดรถ)
  // ห้ามใช้ BONUS แทน — โบนัสเป็นเงินได้ที่ต้องเสียภาษี เงินคืนไม่ใช่
  // COMPANY_ADVANCE = เครดิตที่บริษัทเติมให้ล่วงหน้าเพื่อใช้จ่ายในงาน (ไม่ใช่เงินได้)
  // RIDER_DEPOSIT   = เงินที่ไรเดอร์ฝากเข้ามาเอง (เงินของเขา ไม่ใช่เงินได้)
  category:
    | 'JOB_PAYOUT'
    | 'WITHDRAWAL'
    | 'PENALTY'
    | 'BONUS'
    | 'ADJUSTMENT'
    | 'EXPENSE_REIMBURSEMENT'
    | 'COMPANY_ADVANCE'
    | 'RIDER_DEPOSIT';
  description: string;
  ref_job_id?: string;
  /**
   * แถว CREDIT ทุกแถวต้องประกาศว่าเป็นเงินได้ไหม — ตัวแยกฐานภาษีตอนถอน
   * (`riderCostSplit`) อ่านธงนี้ก่อน ไม่ได้อ่านชื่อหมวด. ไม่ระบุ = เติมจาก
   * `walletCreditTaxable(category)` ให้ตอนเขียน (ดูเหตุผลที่ฟังก์ชันนั้น)
   */
  taxable?: boolean;
}

export type WalletCategory = TransactionLog['category'];

/**
 * เงินเข้ากระเป๋าหมวดนี้เป็น "เงินได้พึงประเมิน" ที่ต้องหัก ณ ที่จ่ายไหม
 *
 * **นี่คือกฎเดียวของทั้งระบบ ห้ามตัดสินจากชื่อหมวดที่อื่น** — ทุกแถว CREDIT ถูก
 * ประทับ `taxable` ตอนเขียนจากตารางนี้ แล้วตัวแยกฐานภาษี (`riderCostSplit`,
 * `functions/rider-cost-split.js`) อ่าน**ธงบนแถว** ไม่ใช่ตารางนี้ ผลคือถ้าวันหนึ่ง
 * คำตอบทางบัญชีเปลี่ยน แถวเก่ายังอ่านได้ตามกติกา ณ วันที่เขียน (ledger ห้าม
 * เปลี่ยนความหมายย้อนหลัง) ส่วนแถวใหม่ตามตารางใหม่
 *
 * เจ้าของงานเคาะ (4 ก.ย. 2569): ค่ารอบ/โบนัส = เงินได้ · เงินคืนค่าทดรอง /
 * เครดิตบริษัทเติมให้ / เงินฝากของไรเดอร์ = ไม่ใช่เงินได้
 *
 * MIRROR: `functions/rider-cost-split.js` (NON_TAXABLE_CREDIT_CATEGORIES —
 * ใช้เป็น fallback ให้แถวเก่าที่เกิดก่อนมีธง) แก้ต้องแก้ทั้งคู่ + parity test
 */
export const WALLET_CREDIT_TAXABLE: Record<WalletCategory, boolean> = {
  JOB_PAYOUT: true,
  BONUS: true,
  ADJUSTMENT: true, // ปรับปรุงค่ารอบ = ค่ารอบที่คิดใหม่ ยังเป็นเงินได้
  EXPENSE_REIMBURSEMENT: false,
  COMPANY_ADVANCE: false,
  RIDER_DEPOSIT: false,
  // สองหมวดนี้ไม่ใช่เงินเข้า — ค่าในตารางมีไว้ให้ type ครบ ไม่มีใครอ่าน
  WITHDRAWAL: false,
  PENALTY: false,
};

/** หมวดที่ไม่รู้จัก = ถือเป็นเงินได้ — ทิศหักเกิน (คืนได้) ไม่ใช่หักขาด (ต้องไล่เก็บ) */
export const walletCreditTaxable = (category: string): boolean =>
  (WALLET_CREDIT_TAXABLE as Record<string, boolean | undefined>)[category] ?? true;

/**
 * ประกอบแถวเงินเข้ากระเป๋าไรเดอร์ — จุดเดียวที่ธง `taxable` ถูกประทับ
 *
 * ทุกที่ที่เขียนแถว CREDIT ควรมาทางนี้ (หรืออย่างน้อยเรียก `walletCreditTaxable`)
 * แถวที่เขียนตรงโดยไม่มีธงยังอ่านได้ (ตัวแยกมี fallback ตามหมวด) แต่นั่นคือ
 * การพึ่งวินัย ไม่ใช่โครงสร้าง
 */
export function buildWalletCredit(input: Omit<TransactionLog, 'type' | 'taxable'> & { taxable?: boolean; timestamp?: number }) {
  const { timestamp, ...rest } = input;
  return {
    ...rest,
    type: 'CREDIT' as const,
    taxable: input.taxable ?? walletCreditTaxable(input.category),
    timestamp: timestamp ?? Date.now(),
  };
}

export const logTransaction = async (data: TransactionLog) => {
  try {
    await push(ref(db, 'transactions'), {
      ...data,
      // แถว CREDIT ต้องมีธงเสมอ — ไม่ส่งมา = เติมจากตารางกลาง
      ...(data.type === 'CREDIT' && data.taxable == null
        ? { taxable: walletCreditTaxable(data.category) }
        : {}),
      created_at: serverTimestamp(),
      timestamp: Date.now()
    });
  } catch (error) {
    // silently handled
  }
};