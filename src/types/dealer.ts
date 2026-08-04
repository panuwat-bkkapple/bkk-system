// Dealer Portal domain types — โดเมนขายส่งยกล็อต (แยกจาก job-statuses โดยตั้งใจ:
// สถานะ lot/order เป็น enum ใหม่ ไม่ต้อง sync 3 repo)
//
// MIRROR: ค่า label/status ชุดนี้ถูก mirror ที่ dealer-portal/src/types.ts
// (แอปดีลเลอร์เป็น Vite app แยก) และค่า enum ฝั่ง server อยู่ใน
// functions/dealer-portal.js — เพิ่มสถานะ/tier ต้องแก้ให้ครบทั้ง 3 ที่

export type DealerTier = 'A' | 'B' | 'C';
export const DEALER_TIERS: DealerTier[] = ['A', 'B', 'C'];

export type DealerStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';

export interface Dealer {
  id: string; // Firebase Auth uid
  company_name: string;
  tax_id?: string | null;
  address?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  line_id?: string | null;
  email: string;
  tier: DealerTier;
  status: DealerStatus;
  created_at?: number;
  suspended_at?: number | null;
  /** สถิติสะสม (server เขียนคนเดียวตอน markPaid) — monthly key = YYYYMM เวลาไทย */
  stats?: {
    orders?: number;
    total_amount?: number;
    last_order_at?: number;
    monthly?: Record<string, number>;
  } | null;
  /** เครดิตคงเหลือจากการเคลม (server เขียนคนเดียว — ledger ที่ dealer_credit_ledger) */
  credit_balance?: number;
  /** ข้อเสนอแนะอัปเกรด tier จากยอดซื้อ — ระบบเขียน แอดมินยืนยัน/ปัดตกที่ /dealers */
  tier_suggestion?: {
    suggest: DealerTier;
    from?: DealerTier | null;
    reason?: 'order' | 'monthly';
    order_no?: string | null;
    order_amount?: number;
    month_total?: number;
    at?: number;
  } | null;
}

export type LotStatus =
  | 'draft'
  | 'open'
  | 'closed'
  | 'awarding'
  | 'awarded'
  | 'completed'
  | 'cancelled';

export type LotBidMode = 'whole_lot' | 'per_item' | 'both';

export interface LotItemSnapshot {
  model: string;
  ref_no?: string | null;
  grade?: string | null;
  parts_condition?: string | null;
  accessories?: string | null;
  warranty_days?: number | null;
  serial_masked?: string | null;
  asking_price?: number | null;
  /** รูปสภาพเครื่อง (แอดมินอัปโหลด — sync จาก jobs/{id}/lot_photos ผ่าน adminDealerLotItemPhotos) */
  photos?: string[] | null;
}

export interface Lot {
  id: string;
  lot_no?: string | null;
  title: string;
  description?: string | null;
  status: LotStatus;
  bid_mode: LotBidMode;
  item_ids?: Record<string, true>;
  items?: Record<string, LotItemSnapshot>;
  item_count: number;
  asking_total?: number | null;
  visible_tiers: Partial<Record<DealerTier, true>>;
  show_bid_stats?: boolean;
  open_at?: number;
  close_at: number;
  closed_at?: number;
  eligible_count?: number;
  bid_stats?: { bid_count: number } | null;
  created_at: number;
  created_by_name?: string | null;
  published_at?: number;
  unsealed_at?: number;
  unsealed_by_name?: string | null;
  awarded_at?: number;
  award?: {
    type: LotBidMode;
    dealer_uid?: string | null;
    total_amount: number;
    order_ids?: string[];
    below_reserve?: boolean;
    approved_by_name?: string | null;
    approved_at?: number;
  };
}

/** ซองที่เปิดแล้ว (ผลจาก adminDealerLotUnsealBids — ไม่มีทางอ่านจาก client ตรงๆ) */
export interface UnsealedBid {
  dealer_uid: string;
  company_name: string;
  tier?: DealerTier | null;
  phone?: string | null;
  bid_no?: string | null;
  type: 'whole_lot' | 'per_item';
  amount_total?: number | null;
  item_bids?: Record<string, number> | null;
  note?: string | null;
  created_at?: number;
  updated_at?: number;
  revision_count: number;
}

export type DealerOrderStatus =
  | 'pending_payment'
  | 'payment_review'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'completed'
  | 'cancelled';

export interface DealerOrder {
  id: string;
  order_no: string;
  lot_id: string;
  lot_no?: string | null;
  dealer_uid: string;
  dealer_snapshot?: {
    company_name?: string | null;
    tax_id?: string | null;
    address?: string | null;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  type: 'whole_lot' | 'per_item';
  items: Record<string, { model: string; ref_no?: string | null; amount: number }>;
  item_count: number;
  amount: number; // VAT-inclusive
  status: DealerOrderStatus;
  quotation?: { number: string; issued_at: number; url?: string };
  payment?: {
    slip_url?: string;
    submitted_at?: number;
    verified_by?: string | null;
    verified_at?: number;
  };
  sale_id?: string;
  shipping?: { method?: string | null; tracking_no?: string | null; shipped_at?: number };
  created_at: number;
  created_by?: string | null;
  created_by_id?: string | null;
  // ระบบจัดของ (four-eyes: คนออกรายการ ≠ คนสแกน) — server เขียนผ่าน
  // adminDealerOrderPicking เท่านั้น
  picking?: {
    status?: 'done';
    items?: Record<string, { at: number; by?: string | null; by_id?: string | null; code?: string }>;
    started_at?: number;
    started_by?: string | null;
    creator_override?: boolean;
    completed_at?: number;
    completed_by?: string | null;
  };
}

export const LOT_STATUS_META: Record<LotStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  open: { label: 'เปิดรับราคา', cls: 'bg-green-50 text-green-700 border-green-200' },
  closed: { label: 'ปิดรับแล้ว', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  awarding: { label: 'เปิดซองแล้ว', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  awarded: { label: 'อนุมัติแล้ว', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'จบงาน', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-red-50 text-red-600 border-red-200' },
};

export const ORDER_STATUS_META: Record<DealerOrderStatus, { label: string; cls: string }> = {
  pending_payment: { label: 'รอชำระเงิน', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  payment_review: { label: 'รอตรวจสลิป', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  paid: { label: 'ชำระแล้ว', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  preparing: { label: 'เตรียมจัดส่ง', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  shipped: { label: 'จัดส่งแล้ว', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  completed: { label: 'สำเร็จ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'ยกเลิก', cls: 'bg-red-50 text-red-600 border-red-200' },
};

// MIRROR: สถานะเคลม — sync กับ dealer-portal/src/types.ts (ClaimStatus) และ
// CLAIM_STATUSES ใน functions/dealer-portal.js
// submitted → approved (refund รอโอน) | resolved | rejected
export type DealerClaimStatus = 'submitted' | 'approved' | 'resolved' | 'rejected';

// MIRROR: label tier — sync กับ TIER_LABEL ใน functions/dealer-portal.js และ
// dealer-portal/src/types.ts (internal key ยังเป็น A/B/C — ไม่ migrate ข้อมูล)
export const TIER_META: Record<DealerTier, { label: string; cls: string }> = {
  A: { label: 'Gold', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  B: { label: 'Silver', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  C: { label: 'Bronze', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
};

export const fmtBaht = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? '-' : `฿${Number(n).toLocaleString('th-TH')}`;

export const fmtDateTime = (ms?: number | null): string =>
  ms
    ? new Date(ms).toLocaleString('th-TH', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Bangkok',
      })
    : '-';
