// ลำดับ milestone ของคำสั่งซื้อ + ป้าย/คำอธิบาย — ใช้ร่วมกัน 3 ที่:
// การ์ดในหน้า Orders (mini-steps), แผง Status Timeline ฝั่งขวา (desktop), หน้า OrderDetail
import type { OrderStatus } from './types';

export const ORDER_FLOW: OrderStatus[] = ['pending_payment', 'payment_review', 'paid', 'shipped', 'completed'];

export const ORDER_FLOW_LABEL: Record<string, string> = {
  pending_payment: 'ชนะประมูล — รอชำระเงิน',
  payment_review: 'ตรวจสอบการชำระ',
  paid: 'ชำระแล้ว — เตรียมสินค้า',
  shipped: 'จัดส่งแล้ว',
  completed: 'รับสินค้าสำเร็จ',
};

// คำอธิบายของขั้นที่กำลังทำ — แสดงในกล่อง glass บน timeline (ตาม orders.html)
export const ORDER_FLOW_DESC: Record<string, string> = {
  pending_payment: 'โอนเงินตามยอดในใบเสนอราคา แล้วแนบสลิปเพื่อยืนยัน',
  payment_review: 'เจ้าหน้าที่กำลังตรวจสอบยอดโอนของคุณ โดยปกติไม่เกิน 1 วันทำการ',
  paid: 'รับยอดเรียบร้อย — กำลังเตรียมสินค้าและเอกสารสำหรับจัดส่ง',
  shipped: 'สินค้าอยู่ระหว่างขนส่ง ติดตามสถานะได้จากเลขพัสดุ',
  completed: 'รับสินค้าเรียบร้อยแล้ว ขอบคุณที่ซื้อกับ GETMOBIE',
};
