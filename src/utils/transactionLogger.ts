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
  category:
    | 'JOB_PAYOUT'
    | 'WITHDRAWAL'
    | 'PENALTY'
    | 'BONUS'
    | 'ADJUSTMENT'
    | 'EXPENSE_REIMBURSEMENT';
  description: string;
  ref_job_id?: string;
}

export const logTransaction = async (data: TransactionLog) => {
  try {
    await push(ref(db, 'transactions'), {
      ...data,
      created_at: serverTimestamp(),
      timestamp: Date.now()
    });
  } catch (error) {
    // silently handled
  }
};