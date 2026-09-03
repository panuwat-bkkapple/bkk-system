// ประตูเดียวของฝั่งแอดมินไปหา status engine
//
// ทุกปุ่มที่เปลี่ยนสถานะงานต้องเรียกผ่านตัวนี้ ห้าม `update(ref(db, 'jobs/...'))`
// พร้อมฟิลด์ `status` ที่ไหนอีก — ไม่ใช่เรื่องความสะอาด แต่เพราะการเขียนตรง
// ข้าม 4 อย่างที่ engine ทำให้ในธุรกรรมเดียวกัน: ตรวจว่าสถานะนี้ไปสถานะนั้นได้
// จริงไหม, ล็อกด้วย status_version กันสองเครื่องเขียนทับกัน, ประทับเวลาที่
// ฝั่งบัญชีอ่าน (paid_at) ครั้งเดียวห้ามขยับ, และเขียน qc_logs ที่หน้า
// Traceability ใช้สร้างไทม์ไลน์
//
// **คืนผลลัพธ์ ไม่ throw** — หน้าจอแอดมินแต่ละหน้าจัดการ error คนละแบบ (บางที่
// toast บางที่ขึ้นในโมดัล) ตัวที่ throw บังคับให้ทุก call site ต้องมี try/catch
// ที่เขียนเหมือนกัน ซึ่งเป็นจุดที่ข้อความจะเริ่มไม่ตรงกัน

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../api/firebase';
import { engineErrorCode, transitionErrorMessage, type JobEvent } from './jobTransitions';

const REGION = 'asia-southeast1';

export interface TransitionSuccess {
  ok: true;
  /** สถานะปลายทางที่ engine ตัดสิน — ไคลเอนต์ไม่ได้เป็นคนเลือก */
  to: string;
  from: string;
}

export interface TransitionFailure {
  ok: false;
  /** รหัสของ engine (illegal_from, wrong_actor, ...) — null เมื่อล้มก่อนถึง engine */
  code: string | null;
  /** ข้อความภาษาไทยพร้อมแสดงให้แอดมิน */
  message: string;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

export interface TransitionOptions {
  /**
   * ฟิลด์ของงานที่ไปพร้อมกับการเปลี่ยนสถานะ (rider_id, assigned_at, ...)
   *
   * ไปใน transaction เดียวกับสถานะ ไม่ใช่ write ที่สองที่อาจสำเร็จครึ่งเดียว
   * ฟิลด์ที่ engine เป็นเจ้าของ (status, status_version, qc_logs, paid_at, ...)
   * ส่งมาไม่ได้ — callable จะปฏิเสธด้วย patch_conflict
   */
  patch?: Record<string, unknown>;
  /** เหตุผลที่จะไปโผล่ใน qc_logs และ status_history */
  reason?: string;
}

export async function runJobTransition(
  jobId: string,
  event: JobEvent,
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  try {
    const fn = httpsCallable<
      { jobId: string; event: string; patch?: Record<string, unknown>; reason?: string },
      { ok: true; from: string; to: string }
    >(getFunctions(app, REGION), 'transitionJob');

    const res = await fn({
      jobId,
      event,
      ...(options.patch ? { patch: options.patch } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });

    return { ok: true, from: res.data.from, to: res.data.to };
  } catch (error) {
    const code = engineErrorCode(error);
    console.error(`[runJobTransition] ${jobId} ${event} failed:`, code || error);
    return { ok: false, code, message: transitionErrorMessage(code) };
  }
}
