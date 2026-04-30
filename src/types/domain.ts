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
  verified_at: number;
  verified_by_rider_uid: string;
  verified_by_rider_name: string;
}

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
