// src/utils/transactionLogger.ts
import { push, ref, serverTimestamp } from 'firebase/database';
import { db } from '../api/firebase';

export type TransactionType = 'CREDIT' | 'DEBIT';

interface TransactionLog {
  rider_id: string;
  amount: number;
  type: TransactionType;
  // ADJUSTMENT = แก้ยอดที่คิดผิด (ไม่ใช่ค่าปรับ ไม่ใช่ค่ารอบใหม่)
  // MIRROR: bkk-rider-app/src/utils/walletLedger.ts (RIDER_WALLET_CATEGORIES)
  category: 'JOB_PAYOUT' | 'WITHDRAWAL' | 'PENALTY' | 'BONUS' | 'ADJUSTMENT';
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