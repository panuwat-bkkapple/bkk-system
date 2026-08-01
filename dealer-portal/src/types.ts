// MIRROR: โครงชนิดข้อมูลโดเมน dealer — ต้นทางร่วมคือ bkk-system/src/types/dealer.ts
// และ enum ฝั่ง server ใน functions/dealer-portal.js — แก้สถานะ/tier ต้อง sync 3 ที่
// (แอปนี้จงใจไม่ import ข้ามไป ../src เพื่อให้ตัดเป็น repo แยกได้)

export type DealerTier = 'A' | 'B' | 'C';

export interface DealerProfile {
  company_name: string;
  tax_id?: string | null;
  address?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email: string;
  tier: DealerTier;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
}

export type LotStatus = 'open' | 'closed' | 'awarding' | 'awarded' | 'completed' | 'cancelled';
export type LotBidMode = 'whole_lot' | 'per_item' | 'both';

export interface LotItem {
  model: string;
  ref_no?: string | null;
  grade?: string | null;
  parts_condition?: string | null;
  accessories?: string | null;
  warranty_days?: number | null;
  serial_masked?: string | null;
  asking_price?: number | null;
}

export interface LotSummary {
  id: string;
  lot_no: string | null;
  title: string | null;
  description: string | null;
  status: LotStatus;
  bid_mode: LotBidMode;
  item_count: number;
  asking_total: number | null;
  open_at: number | null;
  close_at: number | null;
  bid_stats: { bid_count: number } | null; // มีค่าเฉพาะ lot ที่เปิด show_bid_stats
  eligible_count: number | null;
  my_bid: {
    bid_no: string | null;
    type: 'whole_lot' | 'per_item';
    amount_total: number | null;
    item_count: number;
    updated_at: number | null;
  } | null;
  /** ผลประมูลของฉัน: won = มีคำสั่งซื้อ, lost = ประกาศแล้วแต่ไม่ได้รับเลือก */
  my_result: 'won' | 'lost' | null;
  my_order: MyLotOrder | null;
}

export interface MyLotOrder {
  id: string;
  order_no: string | null;
  amount: number;
  status: OrderStatus;
  item_count: number;
  items?: Record<string, { model: string; ref_no?: string | null; amount: number }>;
}

export interface MyBid {
  bid_no: string | null;
  type: 'whole_lot' | 'per_item';
  amount_total: number | null;
  item_bids: Record<string, number> | null;
  note: string | null;
  created_at: number | null;
  updated_at: number | null;
  history: { at: number; type: string; amount_total?: number | null }[];
}

export type OrderStatus =
  | 'pending_payment' | 'payment_review' | 'paid' | 'preparing' | 'shipped' | 'completed' | 'cancelled';

export interface DealerOrderSummary {
  id: string;
  order_no: string;
  lot_no: string | null;
  type: 'whole_lot' | 'per_item';
  item_count: number;
  items: Record<string, { model: string; ref_no?: string | null; amount: number }>;
  amount: number;
  status: OrderStatus;
  quotation: { number: string; url: string | null } | null;
  payment: { slip_url: string | null; submitted_at: number | null } | null;
  payment_info: { bank?: string; account_no?: string; account_name?: string } | null;
  shipping: { method?: string | null; tracking_no?: string | null; shipped_at?: number } | null;
  created_at: number | null;
}

export const LOT_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open: { label: 'เปิดรับราคา', cls: 'green' },
  closed: { label: 'ปิดรับแล้ว — รอผล', cls: 'amber' },
  awarding: { label: 'รอประกาศผล', cls: 'amber' },
  awarded: { label: 'ประกาศผลแล้ว', cls: 'blue' },
  completed: { label: 'จบการขาย', cls: '' },
  cancelled: { label: 'ยกเลิก', cls: 'red' },
};

export const ORDER_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: 'รอชำระเงิน', cls: 'amber' },
  payment_review: { label: 'กำลังตรวจสอบการชำระ', cls: 'amber' },
  paid: { label: 'ชำระแล้ว — กำลังเตรียมสินค้า', cls: 'blue' },
  preparing: { label: 'กำลังเตรียมจัดส่ง', cls: 'blue' },
  shipped: { label: 'จัดส่งแล้ว', cls: 'purple' },
  completed: { label: 'สำเร็จ', cls: 'green' },
  cancelled: { label: 'ยกเลิก', cls: 'red' },
};

export const fmtBaht = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(Number(n)) ? '-' : `฿${Number(n).toLocaleString('th-TH')}`;

export const fmtDateTime = (ms?: number | null): string =>
  ms
    ? new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })
    : '-';
