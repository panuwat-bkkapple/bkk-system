/**
 * 🔧 One-time script: เพิ่ม transaction ที่หายไปของ OID-433503
 *
 * วิธีใช้:
 * 1. กรอกข้อมูลด้านล่างจาก Firebase Console (ดูที่ Realtime Database > jobs > หา OID-433503)
 * 2. รัน: npx tsx scripts/fix-missing-transaction.ts
 */

import { ref, update, push, child } from 'firebase/database';
import { db } from '../src/api/firebase';

// ====== กรอกข้อมูลตรงนี้ ======
const JOB_KEY = '';           // Job key เช่น "-OnXxXxXxXx" (ดูจาก Firebase > jobs)
const PAYMENT_SLIP_URL = '';  // Copy จาก jobs > [JOB_KEY] > payment_slip
const RIDER_ID = '';          // Copy จาก jobs > [JOB_KEY] > rider_id
const NET_PAYOUT = 0;        // ยอดจ่ายสุทธิ เช่น 12000
const PICKUP_FEE = 0;        // ค่าไรเดอร์ เช่น 50
const PAID_AT = 0;           // Copy จาก jobs > [JOB_KEY] > paid_at (timestamp)
const MODEL_NAME = '';        // ชื่อรุ่น เช่น "MacBook Pro 13\" M1"
const CUST_NAME = '';         // ชื่อลูกค้า เช่น "ปฐมพงศ์ วงศ์อำมาตย์"
const REF_NO = 'OID-433503';
// ================================

async function fixMissingTransaction() {
  if (!JOB_KEY || !PAYMENT_SLIP_URL || NET_PAYOUT === 0 || PAID_AT === 0) {
    console.error('❌ กรุณากรอกข้อมูลให้ครบก่อนรัน script');
    process.exit(1);
  }

  const updates: Record<string, any> = {};

  // 1. DEBIT - จ่ายเงินรับซื้อสุทธิ
  const debitKey = push(child(ref(db), 'transactions')).key;
  updates[`transactions/${debitKey}`] = {
    rider_id: 'SYSTEM',
    amount: NET_PAYOUT,
    type: 'DEBIT',
    category: 'TRADE_IN_PAYOUT',
    description: `จ่ายเงินรับซื้อสุทธิ ${MODEL_NAME} (${CUST_NAME})`,
    timestamp: PAID_AT,
    ref_job_id: JOB_KEY,
    slip_url: PAYMENT_SLIP_URL
  };

  // 2. CREDIT - ค่าไรเดอร์ (ถ้ามี)
  if (PICKUP_FEE > 0) {
    const creditKey = push(child(ref(db), 'transactions')).key;
    updates[`transactions/${creditKey}`] = {
      rider_id: RIDER_ID || 'SYSTEM',
      amount: PICKUP_FEE,
      type: 'CREDIT',
      category: 'LOGISTICS_REVENUE',
      description: `รายได้ค่าบริการไรเดอร์รับเครื่อง - Ref: ${REF_NO}`,
      timestamp: PAID_AT,
      ref_job_id: JOB_KEY
    };
  }

  console.log('📝 กำลังเขียน transactions:', JSON.stringify(updates, null, 2));

  await update(ref(db), updates);
  console.log('✅ เพิ่ม transaction สำเร็จ! ลองเช็คใน Audit Log ได้เลย');
  process.exit(0);
}

fixMissingTransaction().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
