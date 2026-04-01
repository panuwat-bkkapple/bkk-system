// =============================================================================
// BKK System - Domain Types & Enums
// =============================================================================

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

/** สถานะงาน B2C */
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
