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
  // ครบทั้ง 10 ปุ่มแล้ว (P2-i) — from-list ของ engine ถูกขยายให้ตรงกับสถานะที่
  // ปุ่มพวกนี้ไปถึงได้จริงก่อน ไม่ใช่ปล่อยให้ปุ่มโดนปฏิเสธ
  //
  // ที่ยังรู้ว่าหลวมและเป็นงานแยก: ปุ่ม Start QC ขึ้นตั้งแต่งานอยู่ Rider Assigned
  // (เริ่มตรวจก่อนไรเดอร์ถึงบ้านลูกค้าไม่มีความหมาย) และปุ่ม Approve ขึ้นตั้งแต่
  // Being Inspected (ข้ามขั้น QC Review) — **ทางแก้คือรัดเงื่อนไขปุ่ม ไม่ใช่หด
  // from-list กลับ ซึ่งจะทำให้ปุ่มพังโดยไม่มีใครแก้ปุ่ม**
  INTAKE_QUEUED_FOR_QC: 'intake_queued_for_qc',
  DROPOFF_RECEIVED: 'dropoff_received',
  INSPECTION_STARTED: 'inspection_started',
  BROADCAST_TO_RIDERS: 'broadcast_to_riders',
  RIDER_ARRIVED: 'rider_arrived',
  PAYOUT_STARTED: 'payout_started',
  RIDER_RETURN_ARRIVED: 'rider_return_arrived',
  SENT_TO_LAB: 'sent_to_lab',

  // P2-j — ตาราง getQuickActions() ของ MobileTicketDetail
  CASE_CLAIMED: 'case_claimed',
  APPOINTMENT_SET: 'appointment_set',
  PARCEL_RECEIVED: 'parcel_received',
  RIDER_DEPARTED: 'rider_departed',
  OFFER_REVISED: 'offer_revised',
  INTAKE_QC_PASSED: 'intake_qc_passed',
  SOLD: 'sold',
  // แอดมินถอนงานออกจากคิวแย่งงาน — วิ่งสวนทางกับ rider_unassigned ห้ามสลับ
  BROADCAST_RECALLED: 'broadcast_recalled',
  // ย้อนสถานะปลายทางขายที่กดผิดกลับมา Pending QC — ไม่ใช่ sale_voided ซึ่งพูดถึง
  // การยกเลิกการขายที่มีความหมายทางบัญชี
  SALE_REVERTED_TO_QC: 'sale_reverted_to_qc',

  // P2-l — หน้าคลัง (Inventory)
  PUSHED_TO_POS: 'pushed_to_pos',

  // P2-o — สองใบสุดท้ายของตาราง quick actions
  //
  // `ADMIN_MARKED_PAID` เป็นทางลัดที่ประกาศว่าเงินออกโดยไม่สร้างแถว
  // `transactions` — **การที่มันมี event ไม่ได้แปลว่าทางนั้นถูกต้องทางบัญชี**
  // คำถามนั้นยังเปิดอยู่ สิ่งที่ย้ายมาให้ engine คุมคือ from-list / version lock
  // / audit trail ซึ่งเดิมไม่มีเลย
  ADMIN_MARKED_PAID: 'admin_marked_paid',
  // เริ่มดำเนินการของ Store-in/Mail-in — **คนละตัวกับ BROADCAST_TO_RIDERS**
  // ถึงปลายทางจะเป็น Active Lead เหมือนกัน (คิวไรเดอร์กรอง non-Pickup ทิ้งอยู่แล้ว
  // งานสองวิธีนี้จึงไม่โผล่ให้ไรเดอร์เห็น)
  PROCESSING_STARTED: 'processing_started',

  // ── P3-c: สายรับซื้อเหมาองค์กร (B2B) ────────────────────────────────────
  //
  // เส้นนี้ไม่มีสถานะไหนข้ามไปมากับสายขายปลีก แต่**ใช้สถานะร่วมกัน 5 ตัว**
  // (Following Up, Negotiation, Paid, In Stock, Completed) ทุก event ข้างล่าง
  // จึงถูก engine จำกัดด้วย `jobTypes: ['B2B Trade-in']` — ยิงใส่งานขายปลีก
  // จะได้ `wrong_job_type` กลับมา ไม่ใช่เขียนสำเร็จ
  B2B_FOLLOWED_UP: 'b2b_followed_up',
  B2B_PRE_QUOTE_SENT: 'b2b_pre_quote_sent',
  B2B_PRE_QUOTE_ACCEPTED: 'b2b_pre_quote_accepted',
  // จ่ายงานให้ผู้ตรวจพร้อมวันนัดหน้างาน — **คนละตัวกับ B2B_GRADING_STARTED**
  // ถึงปลายทางจะเป็น Site Visit & Grading เหมือนกัน: ตัวนั้นแปลว่า "ผู้ตรวจเริ่ม
  // สแกนเครื่องแล้ว" ซึ่งไม่มี site_visit_date อยู่เบื้องหลัง
  B2B_AUDITOR_DISPATCHED: 'b2b_auditor_dispatched',
  B2B_GRADING_STARTED: 'b2b_grading_started',
  B2B_FINAL_QUOTE_SENT: 'b2b_final_quote_sent',
  B2B_NEGOTIATION_OPENED: 'b2b_negotiation_opened',
  B2B_FINAL_QUOTE_ACCEPTED: 'b2b_final_quote_accepted',
  B2B_PO_ISSUED: 'b2b_po_issued',
  B2B_INVOICE_REQUESTED: 'b2b_invoice_requested',
  B2B_SUBMITTED_TO_FINANCE: 'b2b_submitted_to_finance',
  // ปิดล็อต: งานแม่จบ งานลูกรายเครื่องถูกสร้างในคำสั่งเดียวกันฝั่งไคลเอนต์
  // (ล็อตที่เปลี่ยนสถานะแล้วเครื่องไม่โผล่ที่ไหนเลย แย่กว่าไม่ทำทั้งคู่)
  B2B_UNPACKED_TO_STOCK: 'b2b_unpacked_to_stock',

  // ยกเลิกงาน — **ใช้ได้ทั้งสองสาย** (ไม่มี jobTypes ในตาราง engine)
  //
  // engine บังคับ `cancel_category` / `cancelled_by` / `cancelled_at` ผ่าน
  // `requires` ซึ่งเป็นสามฟิลด์ที่ปุ่มยกเลิกของ B2B **ไม่เคยเขียนเลย** งานที่
  // ยกเลิกทางนั้นจึงหลุดจาก soft-close ทั้งหมด (finalizeCancelledJobs หา
  // cancelled_at ไม่เจอ = ไม่มีวันปิดเป็น Closed (Lost))
  CANCELLED: 'cancelled',
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
    // สายขายปลีกกับสายเหมาองค์กรใช้สถานะร่วมกันหลายตัว รหัสนี้จึงแปลว่า "ปุ่มนี้
    // ถูกกดบนงานผิดสาย" ซึ่งบนหน้าจอปกติเกิดไม่ได้ — เกิดเมื่อไหร่แปลว่าหน้าจอ
    // เปิดค้างข้ามงาน หรือมีบั๊กที่ต้องแจ้ง ไม่ใช่สิ่งที่แอดมินแก้เองได้
    case 'wrong_job_type':
      return 'ปุ่มนี้ใช้กับงานคนละประเภทกับงานใบนี้ — รีเฟรชแล้วลองใหม่ ถ้ายังเป็นอยู่ให้แจ้งทีมพัฒนา';
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
