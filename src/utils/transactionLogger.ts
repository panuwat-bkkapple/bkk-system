// src/utils/transactionLogger.ts
import { push, ref, serverTimestamp } from 'firebase/database';
import { db } from '../api/firebase';

export type TransactionType = 'CREDIT' | 'DEBIT';

interface TransactionLog {
  rider_id: string;
  amount: number;
  type: TransactionType;
  category: 'JOB_PAYOUT' | 'WITHDRAWAL' | 'PENALTY' | 'BONUS';
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
    console.error("Transaction Error:", error);
  }
};