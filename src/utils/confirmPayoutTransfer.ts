// ประตูเดียวของ "ฝ่ายบัญชีโอนเงินให้ลูกค้าแล้ว" — เรียก callable confirmPayoutTransfer
//
// แทน `buildPayoutUpdates` + การ update โหนดงานตรงจากเบราว์เซอร์ที่สองจอเคยทำ (payoutTransfer.ts
// ถูกลบไปพร้อมกัน 4 ก.ย. 2569). server เป็นคนเลือก event (ขายปลีก/B2B), ผ่าน status
// engine (from-list / status_version / paid_at ครั้งเดียว / สะกด canonical) แล้วเขียน
// แถว ledger — ไคลเอนต์ส่งแค่ข้อเท็จจริงที่มันรู้: สลิป เวลาโอน บัญชี และ**เลขที่จอแสดง**
// (server คิดเลขจากแถวจริงในธุรกรรม ไม่ตรงกัน = amount_changed)
//
// **คืนผลลัพธ์ ไม่ throw** — รูปเดียวกับ runJobTransition ด้วยเหตุผลเดียวกัน
//
// `ledgerWritten: false` = สถานะเปลี่ยนแล้วแต่แถวบัญชีลงไม่สำเร็จ (infra) — จอต้อง
// บอกให้ไปดูแท็บ "ซ่อม Transaction" ไม่ใช่บอกว่าล้มเหลว (กดซ้ำ = already_paid อยู่ดี)
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../api/firebase';
import { engineErrorCode, transitionErrorMessage } from './jobTransitions';

const REGION = 'asia-southeast1';

export interface ConfirmPayoutInput {
  jobId: string;
  /** URL สลิปที่อัปโหลดเสร็จแล้ว (คนเรียกอัปโหลดเอง) */
  slipUrl: string;
  /** เวลาโอนจริงตามสลิป — รองรับ backdate, ledger เงินสดอิงค่านี้ */
  transferredAt: number;
  bank: { name: string; account: string; holder: string };
  /** ยอดสุทธิที่จอแสดงให้คนกดเห็น (getNetPayout) */
  expectedNetPayout: number;
}

export interface ConfirmPayoutSuccess {
  ok: true;
  from: string;
  to: string;
  event: string;
  /** เลขที่ server คิดจากแถวจริงและลง ledger */
  netPayout: number;
  debitKey: string;
  creditKey: string | null;
  ledgerWritten: boolean;
}

export interface ConfirmPayoutFailure {
  ok: false;
  code: string | null;
  message: string;
}

export type ConfirmPayoutResult = ConfirmPayoutSuccess | ConfirmPayoutFailure;

/** รหัสที่ server ใส่ตัวเลข/ชื่อฟิลด์ไว้ในข้อความแล้ว — ใช้ข้อความนั้นแทนคำแปลกลาง */
const SERVER_MESSAGE_CODES = new Set(['amount_changed', 'invalid_input']);

export async function confirmPayoutTransfer(input: ConfirmPayoutInput): Promise<ConfirmPayoutResult> {
  try {
    const fn = httpsCallable<ConfirmPayoutInput, Omit<ConfirmPayoutSuccess, 'ok'>>(
      getFunctions(app, REGION),
      'confirmPayoutTransfer',
    );
    const res = await fn(input);
    return { ok: true, ...res.data };
  } catch (error) {
    const code = engineErrorCode(error);
    const serverMessage = (error as { message?: unknown } | null)?.message;
    console.error(`[confirmPayoutTransfer] ${input.jobId} failed:`, code || error);
    const message =
      code && SERVER_MESSAGE_CODES.has(code) && typeof serverMessage === 'string' && serverMessage
        ? serverMessage
        : transitionErrorMessage(code, 'บันทึกการโอนเงินไม่สำเร็จ กรุณาลองใหม่');
    return { ok: false, code, message };
  }
}
