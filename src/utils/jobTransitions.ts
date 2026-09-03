// สิ่งที่แอดมิน "ทำ" ไม่ใช่สถานะที่แอดมิน "เลือก"
//
// เดสก์ท็อปมีจุดที่เขียน `jobs/{id}/status` ตรงอยู่ 53 จุดใน 17 ไฟล์ แปลว่า
// กติกาว่าสถานะไหนไปสถานะไหนได้ กระจายอยู่ใน onClick ของทุกปุ่ม และแต่ละจุด
// จำได้ไม่เท่ากันว่าต้องเขียนฟิลด์อะไรพ่วงไปด้วย ไฟล์นี้คือประตูที่ปุ่มพวกนั้น
// จะย้ายมาทีละตัว: ปุ่มส่ง **event** ปลายทางเป็นเรื่องของ `TRANSITIONS` ใน
// `functions/status-engine.js` ที่เดียว
//
// pure โดยตั้งใจ (ไม่ import firebase) — ตัวที่ยิง callable อยู่ที่
// `runJobTransition.ts` แยกไฟล์ เพื่อให้เทสชุดนี้รันได้โดยไม่ต้องมี DB

/** event ที่ฝั่งแอดมินยิงได้ — ชื่อต้องตรงกับคีย์ใน status-engine.js เป๊ะ */
export const JOB_EVENT = {
  // จ่ายงานให้ไรเดอร์คนใดคนหนึ่ง (โหมด manual บนหน้า /dispatcher)
  RIDER_ASSIGNED: 'rider_assigned',
  // แอดมินดึงงานกลับเข้าคิว — **คนละเหตุการณ์กับ rider_withdrew** และห้ามสลับ:
  // ตัวนี้ลง Active Lead (กลับเข้าคิวแย่งงานตรงๆ) ส่วนไรเดอร์ทิ้งงานลง
  // Following Up เพราะลูกค้ารออยู่แล้วไม่มีใครไป ต้องมีคนโทรไปบอก
  //
  // และตัวนี้ไม่ประทับ withdrawn_* — ถ้าประทับ แอดมินที่เพิ่งกดสับเปลี่ยนเอง
  // จะโดนแบนเนอร์เตือนว่า "ไรเดอร์ทิ้งงานใบนี้" ทุกครั้ง (`wasRiderWithdrawn`)
  RIDER_UNASSIGNED: 'rider_unassigned',

  // ── ขั้นรับเครื่องเข้าร้าน ──────────────────────────────────────────────
  // สามตัวนี้ย้ายมาจาก `handleUpdateStatus(สถานะ, รายละเอียด)` ซึ่งเป็นตัวเขียน
  // แบบ "ไคลเอนต์เลือกปลายทางเอง" ที่ PricingSidebar เรียกอยู่ 10 จุด
  //
  // **ย้ายมาแค่ 3 จุด ไม่ใช่ 10 โดยตั้งใจ** — อีก 7 จุดปุ่มมันโผล่ในสถานะที่
  // กว้างกว่า from-list ของ engine (เช่นปุ่ม "ไรเดอร์ถึงแล้ว" ขึ้นตั้งแต่งานยัง
  // อยู่ Rider Assigned) ย้ายทั้งชุดตอนนี้ = ปุ่มแอดมินพังบน production. การ
  // ขยาย from-list เป็นการตัดสินใจเชิงธุรกิจว่า override ไหนของแอดมินถูกต้อง
  // ดูตารางใน bkk-frontend-next/docs/design/status-machine-v2.md §12
  INTAKE_QUEUED_FOR_QC: 'intake_queued_for_qc',
  DROPOFF_RECEIVED: 'dropoff_received',
  INSPECTION_STARTED: 'inspection_started',
} as const;

export type JobEvent = (typeof JOB_EVENT)[keyof typeof JOB_EVENT];

/**
 * แปลคำปฏิเสธของ engine เป็นภาษาที่แอดมินทำอะไรต่อได้
 *
 * ข้อความชุดนี้ต่างจากของแอปไรเดอร์โดยตั้งใจ ไม่ใช่สำเนาที่ลืม sync — คนอ่าน
 * คนละคนและทำอะไรต่อได้ไม่เหมือนกัน: ไรเดอร์ยืนอยู่หน้าบ้านลูกค้าและทำได้แค่
 * รีเฟรช ส่วนแอดมินนั่งอยู่หน้าจอที่เห็นงานทั้งคิวและแก้ที่ต้นเหตุได้
 *
 * `illegal_from` เป็นเคสที่เจอบ่อยที่สุดและมีสาเหตุเดียวเสมอ: มีคนอื่น (หรือ
 * ตัวไรเดอร์เอง) เปลี่ยนสถานะไปแล้วระหว่างที่หน้านี้เปิดค้างไว้
 */
export function transitionErrorMessage(code: string | null | undefined, fallback?: string): string {
  switch (code) {
    case 'illegal_from':
      return 'สถานะงานเปลี่ยนไปแล้วระหว่างที่หน้านี้เปิดค้างอยู่ — รีเฟรชแล้วลองใหม่';
    case 'wrong_actor':
      return 'บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้';
    case 'not_job_owner':
      return 'งานนี้มีเจ้าของอยู่แล้ว กรุณารีเฟรช';
    case 'job_not_found':
      return 'ไม่พบงานนี้ (อาจถูกลบไปแล้ว)';
    case 'wrong_receive_method':
      return 'ขั้นตอนนี้ใช้กับงานรับถึงบ้านเท่านั้น';
    case 'already_paid':
      return 'งานนี้จ่ายเงินไปแล้ว ย้อนกลับไม่ได้';
    case 'not_paid':
      return 'ต้องโอนเงินให้ลูกค้าก่อนจึงจะดำเนินการต่อได้';
    case 'missing_field':
      return 'ข้อมูลงานยังไม่ครบสำหรับขั้นตอนนี้';
    case 'patch_conflict':
      return 'ระบบส่งข้อมูลที่ทับกับฟิลด์ของ engine — แจ้งทีมพัฒนา';
    case 'unknown_event':
      return 'ระบบยังไม่รู้จักคำสั่งนี้ (เวอร์ชันเว็บกับเซิร์ฟเวอร์อาจไม่ตรงกัน) — รีเฟรชหน้าจอ';
    case 'write_contended':
      return 'มีคนแก้ไขงานนี้พร้อมกัน กรุณาลองใหม่';
    case 'unreadable_status':
      return 'สถานะปัจจุบันของงานนี้อ่านไม่ออก — แจ้งทีมพัฒนา';
    default:
      return fallback || 'เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่';
  }
}

/**
 * ดึงรหัสข้อผิดพลาดของ engine ออกจาก error ของ callable
 *
 * `httpsCallable` ห่อ `details` ที่ server ใส่มาไว้ที่ `error.details` — engine
 * ใส่ `{ code }` ไว้ตรงนั้น ส่วน `error.code` เป็นรหัส gRPC ("permission-denied")
 * ซึ่งหยาบเกินกว่าจะบอกได้ว่าเกิดอะไรขึ้นจริง
 *
 * ตรรกะเดียวกับ `engineErrorCode` ของแอปไรเดอร์ — คนละ repo แชร์โค้ดไม่ได้
 * รับไว้เป็นสำเนาที่ยอมรับได้ เพราะมันอ่านรูปร่างของ SDK ไม่ใช่กติกาธุรกิจ
 * drift ที่เลวร้ายที่สุดคือได้ข้อความ fallback ไม่ใช่ตัวเลขหรือสถานะที่ผิด
 */
export function engineErrorCode(error: unknown): string | null {
  const details = (error as { details?: unknown } | null)?.details;
  if (details && typeof details === 'object' && typeof (details as { code?: unknown }).code === 'string') {
    return (details as { code: string }).code;
  }
  return null;
}
