// =============================================================================
// BKK System - Domain Types & Enums
// =============================================================================

// Re-export the canonical status surface so new code can write
//   import { JOB_STATUS, normalizeStatus } from '../types/domain';
// without learning the file split. The source-of-truth lives in
// ./job-statuses.ts and is mirrored byte-for-byte to the other two repos.
//
// `JobStatus` and `ReceiveMethod` are intentionally NOT re-exported here:
// this file already defines its own (legacy) types under those names, and
// re-exporting would clash (TS2484). Code that needs the canonical types
// imports them directly from `./job-statuses`.
export {
  JOB_STATUS,
  PHASE,
  CANCEL_CATEGORY,
  CANCEL_CATEGORY_LABEL_TH,
  RECEIVE_METHOD,
  getPhase,
  isTerminal,
  normalizeStatus,
} from './job-statuses';
export type { Phase, CancelCategory } from './job-statuses';

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/**
 * @deprecated Use `JOB_STATUS` from `./job-statuses` instead. Kept here so
 * existing imports keep compiling; new code should import the const map.
 * Note that several values in this enum overlap or have been renamed in the
 * canonical map (e.g. `IN_TRANSIT` is split into `RIDER_RETURNING` /
 * `PARCEL_IN_TRANSIT`, `PAID_UPPER` collapses into `PAID`). Use
 * `normalizeStatus(legacyValue, receiveMethod)` when comparing values read
 * from the database.
 */
export enum JobStatusB2C {
  NEW_LEAD = 'New Lead',
  FOLLOWING_UP = 'Following Up',
  APPOINTMENT_SET = 'Appointment Set',
  WAITING_DROP_OFF = 'Waiting Drop-off',
  ACTIVE_LEADS = 'Active Leads',
  ASSIGNED = 'Assigned',
  ARRIVED = 'Arrived',
  IN_TRANSIT = 'In-Transit',
  BEING_INSPECTED = 'Being Inspected',
  PENDING_QC = 'Pending QC',
  QC_REVIEW = 'QC Review',
  REVISED_OFFER = 'Revised Offer',
  NEGOTIATION = 'Negotiation',
  PAYOUT_PROCESSING = 'Payout Processing',
  WAITING_FOR_HANDOVER = 'Waiting for Handover',
  PAID_UPPER = 'PAID',
  PAID = 'Paid',
  SENT_TO_QC_LAB = 'Sent to QC Lab',
  IN_STOCK = 'In Stock',
  READY_TO_SELL = 'Ready to Sell',
  CANCELLED = 'Cancelled',
  CLOSED_LOST = 'Closed (Lost)',
  RETURNED = 'Returned',
  SOLD = 'Sold',
  COMPLETED = 'Completed',
}

/** สถานะงาน B2B */
export enum JobStatusB2B {
  NEW_B2B_LEAD = 'New B2B Lead',
  PRE_QUOTE_SENT = 'Pre-Quote Sent',
  PRE_QUOTE_ACCEPTED = 'Pre-Quote Accepted',
  FOLLOWING_UP = 'Following Up',
  SITE_VISIT_GRADING = 'Site Visit & Grading',
  AUDITOR_ASSIGNED = 'Auditor Assigned',
  FINAL_QUOTE_SENT = 'Final Quote Sent',
  FINAL_QUOTE_ACCEPTED = 'Final Quote Accepted',
  NEGOTIATION = 'Negotiation',
  PO_ISSUED = 'PO Issued',
  WAITING_FOR_INVOICE = 'Waiting for Invoice/Tax Inv.',
  PENDING_FINANCE_APPROVAL = 'Pending Finance Approval',
  PAYMENT_COMPLETED = 'Payment Completed',
  IN_STOCK = 'In Stock',
  COMPLETED = 'Completed',
  B2B_UNPACKED = 'B2B-Unpacked',
  CANCELLED = 'Cancelled',
  CLOSED_LOST = 'Closed (Lost)',
  RETURNED = 'Returned',
}

/** วิธีการชำระเงิน */
export enum PaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  CREDIT = 'CREDIT',
}

/** บทบาทผู้ใช้งาน */
export enum UserRole {
  CEO = 'CEO',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER',
  QC = 'QC',
  FINANCE = 'FINANCE',
  STAFF = 'STAFF',
}

/** สถานะพนักงาน */
export enum StaffStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** หมวดหมู่สินค้า */
export enum ProductCategory {
  SMARTPHONES = 'Smartphones',
  TABLETS = 'Tablets',
  MAC_LAPTOP = 'Mac / Laptop',
  SMART_WATCH = 'Smart Watch',
  CAMERA = 'Camera',
  GAME_SYSTEM = 'Game System',
}

/** แบรนด์สินค้า */
export enum Brand {
  APPLE = 'Apple',
  SAMSUNG = 'Samsung',
  GOOGLE = 'Google',
  OPPO = 'Oppo',
  VIVO = 'Vivo',
  SONY = 'Sony',
  NINTENDO = 'Nintendo',
}

/** ประเภทสินค้า POS */
export enum ProductType {
  DEVICE = 'DEVICE',
  SKU = 'SKU',
}

/** เกรดตรวจสอบคุณภาพ */
export enum QCGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
}

/** สภาพอะไหล่ */
export enum PartsCondition {
  ORIGINAL = 'Original',
  REPLACED = 'Replaced',
  UNKNOWN = 'Unknown',
}

/** สถานะไรเดอร์ */
export enum RiderStatus {
  PENDING = 'Pending',
  ACTIVE = 'Active',
  SUSPENDED = 'Suspended',
  REJECTED = 'Rejected',
}

/** สถานะออนไลน์ไรเดอร์ */
export enum RiderOnlineStatus {
  ONLINE = 'Online',
  OFFLINE = 'Offline',
  BUSY = 'Busy',
}

/** วิธีการรับสินค้า */
export enum ReceiveMethod {
  STORE_IN = 'Store-in',
  PICKUP = 'Pickup',
  MAIL_IN = 'Mail-in',
}

/** ประเภทธุรกรรม */
export enum TransactionType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/** หมวดหมู่ค่าใช้จ่าย */
export enum ExpenseCategory {
  TRANSPORT = 'TRANSPORT',
  SUPPLIES = 'SUPPLIES',
  MARKETING = 'MARKETING',
  MISC = 'MISC',
}

/** หมวดหมู่รายงานข้อมูลไม่ตรง */
export enum DiscrepancyCategory {
  ADDRESS = 'address',
  CUSTOMER = 'customer',
  DEVICE = 'device',
  PRICE = 'price',
  APPOINTMENT = 'appointment',
  OTHER = 'other',
}

/** สถานะรายงานข้อมูลไม่ตรง */
export enum DiscrepancyStatus {
  PENDING = 'pending',
  RESOLVED = 'resolved',
}

/** สถานะเคลมประกัน */
export enum WarrantyClaimStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

/** สถานะรีวิว */
export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** ประเภทนัดหมาย */
export enum AppointmentType {
  TRADE_IN = 'trade-in',
  PICKUP = 'pickup',
  DELIVERY = 'delivery',
  CONSULTATION = 'consultation',
  OTHER = 'other',
}

/** สถานะนัดหมาย */
export enum AppointmentStatus {
  SCHEDULED = 'scheduled',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no-show',
}

/** ประเภทคูปอง */
export enum CouponType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
}

/** สถานะใบเสร็จ */
export enum ReceiptStatus {
  PAID = 'PAID',
  VOIDED = 'VOIDED',
}

/** ธนาคาร */
export enum Bank {
  /** กสิกรไทย */
  KBANK = 'KBank',
  /** ไทยพาณิชย์ */
  SCB = 'SCB',
  /** กรุงเทพ */
  BBL = 'BBL',
  /** กรุงศรี */
  BAY = 'BAY',
  /** ออมสิน */
  GSB = 'GSB',
  /** พร้อมเพย์ */
  PROMPTPAY = 'PromptPay',
}

// -----------------------------------------------------------------------------
// Union Types
// -----------------------------------------------------------------------------

/** สถานะงานทั้งหมด (รวม B2C + B2B) */
export type JobStatus = JobStatusB2C | JobStatusB2B;

// -----------------------------------------------------------------------------
// Interfaces
// -----------------------------------------------------------------------------

/** บันทึกการตรวจสอบคุณภาพ */
export interface QCLog {
  /** การดำเนินการ เช่น "grade_assigned", "inspection_done" */
  action: string;
  /** รายละเอียดเพิ่มเติม */
  details: string;
  /** ชื่อหรือ ID ผู้ดำเนินการ */
  by: string;
  /** เวลาที่บันทึก */
  timestamp: Date;
}

/** อุปกรณ์ที่อยู่ในงาน */
export interface JobDevice {
  /** รุ่นอุปกรณ์ */
  model: string;
  /** แบรนด์ */
  brand: Brand;
  /** เกรด QC */
  grade?: QCGrade;
  /** สภาพอะไหล่ */
  partsCondition?: PartsCondition;
  /** IMEI / Serial Number */
  serial?: string;
}

/** คูปองที่ใช้กับงาน */
export interface AppliedCoupon {
  /** รหัสคูปอง */
  code: string;
  /** ประเภทคูปอง */
  type: CouponType;
  /** มูลค่าส่วนลด (บาท หรือ %) */
  value: number;
}

/** งาน (Job) - ข้อมูลหลักของการรับซื้อ/ขาย */
export interface Job {
  /** รหัสงาน */
  id: string;
  /** สถานะงานปัจจุบัน */
  status: JobStatus;
  /** รุ่นสินค้าหลัก */
  model: string;
  /** ราคาเสนอ */
  price: number;
  /** ราคาสุดท้าย (หลังเจรจา/หักส่วนลด) */
  final_price: number;

  // ข้อมูลลูกค้า
  /** ชื่อลูกค้า */
  cust_name: string;
  /** เบอร์โทรลูกค้า */
  cust_phone: string;
  /** อีเมลลูกค้า */
  cust_email?: string;
  /** ที่อยู่ลูกค้า */
  cust_address?: string;
  /** หมายเหตุจากลูกค้า (กรอกตอน checkout) */
  cust_notes?: string;

  // การรับสินค้า
  /** วิธีการรับสินค้า */
  receive_method: ReceiveMethod;
  /** ค่าบริการรับสินค้า (บาท) */
  pickup_fee?: number;

  // คูปอง & QC
  /** คูปองที่ใช้ */
  applied_coupon?: AppliedCoupon;
  /** ประวัติการตรวจ QC */
  qc_logs: QCLog[];
  /** รายการอุปกรณ์ในงาน */
  devices: JobDevice[];

  // วิธีชำระเงิน & ธนาคาร
  /** วิธีการชำระเงิน */
  payment_method?: PaymentMethod;
  /** ธนาคารสำหรับโอนเงิน */
  bank?: Bank;

  // Timestamps
  /** วันที่สร้างงาน */
  created_at: Date;
  /** วันที่อัปเดตล่าสุด */
  updated_at: Date;

  /** พนักงานที่รับผิดชอบ */
  assigned_staff?: string;
  /** UID ของ admin เจ้าของเคส — เพิ่มเข้ามาคู่กับ agent_name เพื่อให้ notification
   *  ระบบสามารถส่ง push ตรงให้เจ้าของเคสได้โดยไม่ต้อง lookup จากชื่อ.
   *  Optional เพราะ job เก่าก่อน feature นี้ไม่มี — fall back broadcast all admins. */
  agent_uid?: string;
  /** หมายเหตุเพิ่มเติม */
  notes?: string;

  // Cancellation taxonomy (PR-5B)
  // ----------------------------
  // Why both? `cancel_category` is a closed enum that is cheap to filter,
  // group, and feed into analytics dashboards. `cancel_reason` is the free
  // text the rider/admin actually typed; it captures the specifics that
  // don't fit into a category. We ask for both at the cancel UI:
  // category is required, free text is optional unless category === 'other'.
  /** หมวดเหตุผลที่ยกเลิก (สำหรับ analytics) */
  cancel_category?: import('./job-statuses').CancelCategory;
  /** เหตุผลเสริม (พิมพ์เองโดยไรเดอร์/แอดมิน) */
  cancel_reason?: string;
  /** UID/staffId/riderId ของผู้กดยกเลิก */
  cancelled_by?: string;
  /** เวลาที่กดยกเลิก (epoch ms) */
  cancelled_at?: number;

  // Optimistic-lock metadata (PR-5B)
  // --------------------------------
  // status_version increments by one on every status transition. Writers
  // that need to guard against concurrent updates can read the current
  // version, set status_version: previous + 1, and rely on the RTDB rules
  // (or a runTransaction) to reject stale writes. Old jobs without this
  // field behave as version 0.
  /** เวอร์ชันของสถานะ — เพิ่มทุกครั้งที่เปลี่ยน status */
  status_version?: number;

  /** ประวัติการเปลี่ยน status (audit trail แบบ structured) */
  status_history?: Array<{
    /** สถานะก่อนเปลี่ยน */
    from: string | null;
    /** สถานะหลังเปลี่ยน */
    to: string;
    /** เวลาที่เปลี่ยน (epoch ms) */
    at: number;
    /** ผู้เปลี่ยน — staffId / riderId / 'system' / 'customer' */
    by: string;
    /** ข้อความเสริม เช่น เหตุผลยกเลิก, log ของ QC */
    reason?: string;
  }>;

  // KYC capture (PR-KYC)
  // -------------------
  // ไรเดอร์บันทึก KYC ที่จุดรับเครื่อง (ดู bkk-rider-app KYCModal).
  // ตัว record เต็มอยู่ที่ /jobs_kyc/{jobId} (locked read — admin + rider
  // assigned เท่านั้น). บน /jobs/{id} เก็บแค่ flag non-sensitive 2 ตัวสำหรับ
  // index/filter dashboard. Schema ของ KYCRecord sync กับ
  // bkk-rider-app/src/types/index.ts — แก้ที่นั่นต้องแก้ที่นี่ด้วย.
  /** ที่อยู่ตามบัตรประชาชนที่ลูกค้ากรอกล่วงหน้าตอน checkout (optional pre-fill) */
  cust_id_address?: string;
  /** Mirror ของ kyc.verified_at — ใช้เป็น index/filter ใน dashboard (non-sensitive) */
  kyc_verified_at?: number;
  /** Mirror ของ kyc.method — non-sensitive flag เพื่อ filter "Review (Fallback)" */
  kyc_method?: KYCMethod;
}

/** AMLO (พ.ร.บ.ฟอกเงิน) threshold — ออเดอร์ ≥ 50,000 ต้องเก็บภาพลูกค้าถือบัตร */
export const KYC_AMLO_THRESHOLD = 50000;

export type KYCMethod = 'photo' | 'typed_fallback';

export type KYCFallbackReason =
  | 'forgot_card'
  | 'lost_card'
  | 'awaiting_new_card'
  | 'other';

export const KYC_FALLBACK_REASON_LABEL_TH: Record<KYCFallbackReason, string> = {
  forgot_card: 'ลืมบัตรประชาชน',
  lost_card: 'ทำบัตรหาย',
  awaiting_new_card: 'รอออกบัตรใหม่',
  other: 'อื่น ๆ',
};

export interface KYCRecord {
  method: KYCMethod;
  /** เลขบัตรประชาชน 13 หลัก (ผ่าน checksum mod 11) */
  id_number: string;
  /** ที่อยู่บนหน้าบัตร (rider transcribe หรือ pre-filled จากลูกค้า แล้ว rider verify) */
  id_address: string;
  /** Storage URL: ภาพถ่ายบัตรประชาชนใบเดียว (Standard) */
  id_card_url?: string | null;
  /** Storage URL: ภาพถ่ายบัตรคู่กับเครื่อง โชว์ IMEI/Serial (Standard — มัดบุคคล↔เครื่อง) */
  id_with_device_url?: string | null;
  /** Storage URL: ภาพถ่ายลูกค้าถือบัตร — เฉพาะเมื่อ net_payout ≥ KYC_AMLO_THRESHOLD */
  holder_url?: string | null;
  /** Storage URL: ลายเซ็นดิจิทัล — เฉพาะ typed_fallback */
  signature_url?: string | null;
  fallback_reason?: KYCFallbackReason;
  fallback_detail?: string;
  /** ชื่อ-นามสกุลตามบัตร รวมคำนำหน้า (เช่น "นาย สมชาย ใจดี") — auto-fill จาก Vision OCR, rider แก้ได้ */
  id_name?: string;
  /** วันเกิดตามบัตร (DD/MM/YYYY ตามที่ปรากฏบนบัตร — อาจเป็น พ.ศ. หรือ ค.ศ.) */
  id_dob?: string;
  /** วันออกบัตร */
  id_issued_at?: string;
  /** วันบัตรหมดอายุ — admin ใช้ดูว่าบัตรยังไม่หมดอายุ (display-only ตอนนี้, ไม่ block submit) */
  id_expires_at?: string;
  verified_at: number;
  verified_by_rider_uid: string;
  verified_by_rider_name: string;
}

// =====================================================================
// Job Amendment v2 (PR-AMEND v2 — Big Bang)
// ---------------------------------------------------------------------
// Unified on-site change-request workflow. Replaces the older
// /jobs/{id}/discrepancy_reports/* path which had no atomic apply, no
// customer consent, no real FCM notification — all admin-side state
// drift bugs we hit in production stem from that.
//
// Two classes of amendment:
//   contractual (กระทบสัญญาซื้อขาย: ราคา/รุ่น/จำนวนเครื่อง)
//     → require customer consent (signature) before atomic apply
//   operational (admin handles backend: นัด/ที่อยู่/ข้อมูลลูกค้า/ยกเลิก)
//     → admin approve = atomic apply (no consent step)
//
// Schema synced with bkk-rider-app/src/types/index.ts and validate
// rules in bkk-system/database.rules.json — change all 3 together.
// =====================================================================

export type AmendmentClass = 'contractual' | 'operational';

export type JobAmendmentType =
  // Contractual (require customer consent before apply)
  | 'device_mismatch'
  | 'add_device'
  | 'remove_device'
  // Operational (admin approve = apply, no consent)
  | 'appointment_reschedule'
  | 'address_wrong'
  | 'customer_info_wrong'
  | 'customer_request_cancel'
  | 'other';

/** Map type → class. Server validates this matches; clients use it to
 *  decide whether to gate consent step. Single source of truth here. */
export const AMENDMENT_TYPE_CLASS: Record<JobAmendmentType, AmendmentClass> = {
  device_mismatch: 'contractual',
  add_device: 'contractual',
  remove_device: 'contractual',
  appointment_reschedule: 'operational',
  address_wrong: 'operational',
  customer_info_wrong: 'operational',
  customer_request_cancel: 'operational',
  other: 'operational',
};

export const AMENDMENT_TYPE_LABEL_TH: Record<JobAmendmentType, string> = {
  device_mismatch: 'เครื่องไม่ตรงตามที่ลงทะเบียน',
  add_device: 'ลูกค้าขอเพิ่มเครื่อง',
  remove_device: 'ลูกค้าขอลด/ยกเลิกบางเครื่อง',
  appointment_reschedule: 'ลูกค้าขอเลื่อนนัดหมาย',
  address_wrong: 'ที่อยู่ไม่ตรง',
  customer_info_wrong: 'ข้อมูลลูกค้าไม่ตรง (ชื่อ/เบอร์/อีเมล)',
  customer_request_cancel: 'ลูกค้าขอยกเลิกทั้งงาน',
  other: 'อื่นๆ — admin โทรคุยลูกค้า',
};

export type JobAmendmentStatus =
  | 'pending'        // rider submitted, admin hasn't reviewed
  | 'approved'       // admin approved (contractual only — waiting consent)
  | 'rejected'       // admin rejected
  | 'consented'      // customer signed; cloud function applying
  | 'applied'        // changes written to /jobs/{id}; flow continues
  | 'cancelled'      // amendment voided (admin cancel, rider re-open, etc.)
  | 'expired';       // approved + 24h passed without customer consent

export type JobAmendmentRejectAction =
  | 'continue_original'   // rider proceeds with original job spec
  | 'cancel_job'          // entire job cancelled
  | 'wait_admin_call';    // rider stands by, admin contacts customer

export type AmendmentConsentMethod = 'signature' | 'otp' | 'verbal';

/** Discriminated union — typed payload of what's being changed. Only
 *  set for operational types where the change is field-level rather
 *  than a snapshot replacement. Contractual types use before/after. */
export type AmendmentTarget =
  | { kind: 'appointment'; new_appointment_time: number }
  | { kind: 'address'; new_address: string; new_lat?: number; new_lng?: number }
  | { kind: 'customer_info'; field: 'cust_name' | 'cust_phone' | 'cust_email'; new_value: string }
  | { kind: 'cancel'; reason_category: import('./job-statuses').CancelCategory; reason_detail?: string }
  | { kind: 'other'; admin_freeform?: string }
  // Rider's identification of the actual device (for device_mismatch /
  // add_device). Rider has the physical device in hand and can read
  // its model/variant directly — letting them seed the pick saves
  // admin a guess from the photo. Admin can still override during
  // review (e.g. if photo doesn't match what rider claimed).
  | {
      kind: 'device_pick';
      model_id: string;
      variant_id?: string;
      model_name: string;
      variant_name?: string;
      brand?: string;
      /** Catalog price ของ variant ตอน rider เลือก. Admin can override. */
      suggested_price?: number;
    };

/** Per-device entry in an amendment snapshot. v1 readers see `model`/
 *  `brand` only; v2 readers can use the catalog binding (model_id +
 *  variant_id) and per-device unit_price. Server always writes both
 *  for forward+back compat. */
export interface AmendmentDevice {
  // V1 fields — always written
  model: string;          // "iPhone 17 256GB Black"
  brand: Brand;
  serial?: string;
  imei?: string;
  grade?: QCGrade;
  partsCondition?: PartsCondition;

  // V2 fields — also written for v2 readers
  model_id?: string;      // foreign key to /models/{id}
  variant_id?: string;
  model_name?: string;
  variant_name?: string;
  unit_price?: number;
}

export interface AmendmentSnapshot {
  devices: AmendmentDevice[];
  /** V1 field — sum of unit_price minus discount, including pickup_fee.
   *  Always written for back-compat. */
  final_price: number;
  /** V2 — explicit breakdown. Optional for v1 records. */
  pricing?: {
    devices_subtotal: number;
    pickup_fee: number;
    coupon_discount: number;
    final_price: number;
    currency: 'THB';
  };
}

export interface AmendmentEvidence {
  url: string;
  purpose: 'device_back' | 'settings_about' | 'imei_label' | 'box' | 'customer_with_device' | 'address_pin' | 'other';
  uploaded_at: number;
}

export interface AmendmentConsent {
  method: AmendmentConsentMethod;
  consented_at: number;
  signature_url?: string;
  otp_phone_masked?: string;
  otp_verified_at?: number;
  verbal_transcript?: string;
  /** Snapshot of disclosure copy shown to customer at consent time —
   *  for legal replay if a dispute arises. */
  disclosure_text_snapshot: string;
  disclosure_version: string;
  captured_on: 'rider_app' | 'admin_app';
  captured_by_uid: string;
}

export interface JobAmendment {
  // Identity + version
  id: string;
  job_id: string;
  /** Schema version. v1 records (Phase 1) won't have this field — read
   *  adapters treat missing as 1. */
  schema_version?: 2;
  /** Idempotency key generated by the rider client (UUIDv4). Server
   *  rejects duplicate submissions with the same id within 1h. */
  client_request_id?: string;

  // Classification
  amendment_class: AmendmentClass;
  type: JobAmendmentType;

  // Operational target (kind discriminator inside)
  target?: AmendmentTarget;
  /** Index into job.devices for replace/remove. Undefined for add. */
  target_device_index?: number;

  // Rider input
  requested_at: number;
  requested_by_rider_uid: string;
  requested_by_rider_name: string;
  rider_note?: string;
  /** v1: legacy field. v2 readers should prefer `evidence`. Server
   *  writes both for compat. */
  evidence_urls?: string[];
  evidence?: AmendmentEvidence[];

  // Snapshots (contractual only)
  before?: AmendmentSnapshot;
  after?: AmendmentSnapshot;

  status: JobAmendmentStatus;

  // Admin decision
  reviewed_at?: number;
  reviewed_by_admin_uid?: string;
  reviewed_by_admin_name?: string;
  admin_note?: string;
  reject_action?: JobAmendmentRejectAction;

  // Consent (contractual only)
  consent?: AmendmentConsent;
  /** v1 flat fields — kept for back-compat readers. Server populates
   *  these when consent_method='signature' alongside the v2 `consent`
   *  object. */
  consented_at?: number;
  consent_method?: AmendmentConsentMethod;
  consent_signature_url?: string;

  // Lifecycle
  approved_expires_at?: number;
  applied_at?: number;
  cancelled_at?: number;
  escalated_at?: number;
}

/** Back-compat alias for v1 callers. Same shape as AmendmentSnapshot. */
export type JobAmendmentSnapshot = AmendmentSnapshot;

/** ซีรีส์สินค้า */
export interface Series {
  id: string;
  name: string;
  brand: string;
  category: string;
  imageUrl: string;
  subcategory?: string;
}

/** กลุ่มย่อยสินค้า (เช่น MacBook Air, MacBook Pro) */
export interface Subcategory {
  id: string;
  name: string;
  brand: string;
  category: string;
  imageUrl: string;
}

/** ตัวเลือกสินค้า (เช่น ความจุ, สี) */
export interface ProductVariant {
  /** ชื่อ variant เช่น "128GB - Black" */
  name: string;
  /** SKU */
  sku?: string;
  /** ราคา (บาท) */
  price: number;
  /** จำนวนคงเหลือ */
  stock: number;
}

// ==========================================
// Attribute-Based Pricing (Modifier Mode)
// ==========================================

/** Schema attribute สำหรับ category (เช่น processor, ram, storage) */
export interface AttributeSchemaItem {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
}

/** ตัวเลือกแต่ละค่าของ attribute พร้อม price modifier */
export interface AttributeOptionModifier {
  value: string;
  newPriceMod: number;
  usedPriceMod: number;
}

/** Modifier data ของ attribute หนึ่งตัว */
export interface AttributeModifier {
  options: AttributeOptionModifier[];
}

/** โหมดการตั้งราคา */
export type PricingMode = 'legacy' | 'modifier';

/** Model ฉบับเต็มสำหรับ PriceEditor (ใช้กับ Firebase /models/) */
export interface PricingModel {
  id: string;
  name: string;
  brand: string;
  category: string;
  series: string;
  imageUrl: string;
  isActive: boolean;
  isFeatured: boolean;
  inStore: boolean;
  pickup: boolean;
  mailIn: boolean;
  conditionSetId: string;
  attributesSchema: AttributeSchemaItem[];
  updatedAt: number;

  /** โหมดราคา: 'legacy' = กรอกทีละ variant, 'modifier' = base + modifiers */
  pricingMode: PricingMode;

  /** ราคาฐานสำหรับ modifier mode */
  baseRetailPrice?: number;
  baseSellPrice?: number;
  baseSellUsedPrice?: number;
  baseNewPrice?: number;
  baseUsedPrice?: number;

  /** Price modifiers ต่อ attribute key */
  attributeModifiers?: Record<string, AttributeModifier>;

  /** Override ราคาสำหรับ combination พิเศษ (key = "val1|val2|val3") */
  priceOverrides?: Record<string, { newPrice: number; usedPrice: number }>;

  /** Flat variants (generated จาก modifiers หรือกรอกมือ) */
  variants: any[];
}

/** สินค้า */
export interface Product {
  /** รหัสสินค้า */
  id: string;
  /** ชื่อรุ่น */
  model: string;
  /** แบรนด์ */
  brand: Brand;
  /** หมวดหมู่ */
  category: ProductCategory;
  /** ซีรีส์ เช่น "iPhone 15", "Galaxy S24" */
  series?: string;
  /** จำนวนคงเหลือรวม */
  stock: number;
  /** ราคา (บาท) */
  price: number;
  /** เปิดขายอยู่หรือไม่ */
  isActive: boolean;
  /** สินค้าแนะนำ */
  isFeatured: boolean;
  /** ตัวเลือกย่อย */
  variants: ProductVariant[];
  /** ประเภทสินค้า POS */
  type?: ProductType;
}

/** พนักงาน */
export interface Staff {
  /** รหัสพนักงาน */
  id: string;
  /** ชื่อพนักงาน */
  name: string;
  /** อีเมล */
  email: string;
  /** บทบาท */
  role: UserRole;
  /** สถานะการทำงาน */
  status: StaffStatus;
  /** PIN สำหรับเข้าระบบ POS */
  pin: string;
}

/** ข้อความแชท */
export interface ChatMessage {
  /** ผู้ส่ง (user ID หรือ role) */
  sender: string;
  /** ชื่อผู้ส่งที่แสดง */
  senderName: string;
  /** เนื้อหาข้อความ */
  text: string;
  /** URL รูปภาพแนบ (ถ้ามี) */
  imageUrl?: string;
  /** เวลาที่ส่ง */
  timestamp: Date;
  /** อ่านแล้วหรือยัง */
  read: boolean;
}

/** รายงานข้อมูลไม่ตรงจากไรเดอร์ */
export interface DiscrepancyReport {
  /** รหัสรายงาน */
  id: string;
  /** รหัสงานที่เกี่ยวข้อง */
  jobId: string;
  /** หมวดหมู่ */
  category: DiscrepancyCategory;
  /** รายละเอียดที่ไรเดอร์กรอก */
  detail: string;
  /** URL รูปภาพแนบ (ถ้ามี) */
  imageUrl?: string | null;
  /** ผู้แจ้ง */
  reported_by: string;
  /** เวลาที่แจ้ง (timestamp) */
  reported_at: number;
  /** สถานะ */
  status: DiscrepancyStatus;
  /** เวลาที่แก้ไขแล้ว */
  resolved_at?: number | null;
  /** ผู้แก้ไข */
  resolved_by?: string;
}

/** นัดหมาย */
export interface Appointment {
  /** รหัสนัดหมาย (Firebase key) */
  id: string;
  /** หัวข้อนัดหมาย */
  title: string;
  /** ชื่อลูกค้า */
  customer_name: string;
  /** เบอร์โทรลูกค้า */
  customer_phone?: string;
  /** วันที่นัด (YYYY-MM-DD) */
  date: string;
  /** เวลาเริ่ม (HH:mm) */
  time: string;
  /** เวลาสิ้นสุด (HH:mm) */
  end_time?: string;
  /** ประเภทนัดหมาย */
  type: AppointmentType;
  /** สถานะ */
  status: AppointmentStatus;
  /** หมายเหตุ */
  notes?: string;
  /** รหัส job ที่เกี่ยวข้อง */
  job_id?: string;
  /** ผู้สร้างนัดหมาย */
  created_by: string;
  /** เวลาสร้าง (timestamp) */
  created_at: number;
  /** เวลาอัปเดตล่าสุด (timestamp) */
  updated_at?: number;
  /** สาขา */
  branch?: string;
  /** พนักงานที่รับผิดชอบ */
  assigned_to?: string;
}

/** ธุรกรรมทางการเงิน */
export interface Transaction {
  /** รหัสธุรกรรม */
  id: string;
  /** ประเภท (เดบิต/เครดิต) */
  type: TransactionType;
  /** จำนวนเงิน (บาท) */
  amount: number;
  /** หมวดหมู่ค่าใช้จ่าย */
  category?: ExpenseCategory;
  /** รายละเอียด */
  description: string;
  /** เวลาที่ทำรายการ */
  timestamp: Date;
  /** รหัสงานที่เกี่ยวข้อง */
  ref_job_id?: string;
}
