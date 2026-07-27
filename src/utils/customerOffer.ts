/* eslint-disable @typescript-eslint/no-explicit-any */
// Make Offer (ลูกค้าเสนอราคาเอง) — helper ฝั่งแอดมิน
//
// ลูกค้าเสนอราคาที่ต้องการจากหน้าสรุปประเมิน (bkk-frontend-next) →
// validateAndCreateOrder validate กรอบแล้วเขียน jobs/{id}/customer_offer
// (metadata — ไม่แตะ price/net_payout). ถ้าไม่เข้าเพดาน auto-accept
// (settings/customer_offer) จะค้างเป็น status 'pending' รอ CEO/MANAGER
// ตัดสินใน ticket UI: รับ / เคาน์เตอร์ / ยืนราคาประเมิน.
// - รับ (accept): เขียน final_price = ราคาเสนอ + คิด net_payout สูตรกลางเดิม
// - เคาน์เตอร์ (counter): เขียน counter_amount → ลูกค้ากดตอบบนหน้า /track
//   (bkk-frontend-next /api/jobs/action: accept-offer-counter / decline-offer-counter)
// - ยืนราคาประเมิน (decline): งานเดินต่อที่ราคาประเมินเดิม ไม่แตะเงิน
// push/อีเมลแจ้งผล = cloud function onCustomerOfferDecided (functions/index.js)
//
// MIRROR (contract เดียวกัน): bkk-frontend-next app/utils/customerOffer.ts
// + functions/src/index.ts (ตัว validate/auto-accept)

export type CustomerOfferStatus =
  | 'pending' | 'auto_accepted' | 'accepted'
  | 'countered' | 'counter_accepted' | 'counter_declined' | 'declined';

export interface CustomerOfferData {
  amount: number;
  quote_at_offer: number;
  reason?: string;
  status: CustomerOfferStatus;
  proposed_at: number;
  decided_at?: number;
  decided_by_uid?: string;
  decided_by_name?: string;
  counter_amount?: number;
  counter_reason?: string;
  counter_decided_at?: number;
}

/** เพดานเริ่มต้น % ที่ลูกค้าเสนอเกินราคาประเมินได้ (mirror ฝั่งลูกค้า) */
export const DEFAULT_OFFER_MAX_PCT = 15;

export function customerOfferOf(job: any): CustomerOfferData | null {
  const o = job?.customer_offer;
  return o && typeof o === 'object' && Number(o.amount) > 0 ? (o as CustomerOfferData) : null;
}

/** ยังรอแอดมินตัดสิน (โชว์การ์ด/ป้ายเตือนใน ticket + push หา CEO/MANAGER) */
export function isOfferAwaitingDecision(job: any): boolean {
  return customerOfferOf(job)?.status === 'pending';
}

/** รอลูกค้าตอบเคาน์เตอร์อยู่ (แสดงสถานะรอฝั่งลูกค้า) */
export function isOfferAwaitingCustomer(job: any): boolean {
  return customerOfferOf(job)?.status === 'countered';
}

/** ข้อเสนอจบแบบลูกค้าได้ราคาที่ตกลง (เงินของงานตามข้อเสนอแล้ว) */
export function offerWasAccepted(job: any): boolean {
  const s = customerOfferOf(job)?.status;
  return s === 'auto_accepted' || s === 'accepted' || s === 'counter_accepted';
}

export const OFFER_STATUS_LABEL_TH: Record<CustomerOfferStatus, string> = {
  pending: 'รอพิจารณา',
  auto_accepted: 'รับอัตโนมัติ',
  accepted: 'รับข้อเสนอ',
  countered: 'รอลูกค้าตอบเคาน์เตอร์',
  counter_accepted: 'ลูกค้ารับเคาน์เตอร์',
  counter_declined: 'ลูกค้าไม่รับเคาน์เตอร์ (ขายราคาประเมิน)',
  declined: 'ยืนราคาประเมิน',
};
