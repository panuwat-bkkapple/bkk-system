// src/components/receipt/receiptSettings.ts
//
// ค่าตั้งของใบเสร็จขาย (POS + ประวัติการขาย) — เก็บที่ RTDB `settings/receipt`
// เหมือนหน้าตั้งค่าอื่นทุกหน้าของระบบนี้ (ไม่ใช่ Firestore: แอดมินฝั่งนี้ไม่มี
// client Firestore เลย และ `settings` มี rule ครอบอยู่แล้วจึงไม่ต้อง deploy rules)
//
// ไฟล์นี้ถือ "รูปของข้อมูล" อย่างเดียว — ตัวอ่านอยู่ที่ hooks/useReceiptSettings,
// ตัวเขียนอยู่ที่หน้า /settings/receipt, ตัวใช้คือ components/receipt/ReceiptTemplate

export type ReceiptPaperSize = 'A4' | 'thermal80';

export interface ReceiptSettings {
  shopName: string;
  addressLine: string;
  /** เลขประจำตัวผู้เสียภาษี — ว่าง = ไม่พิมพ์บรรทัดนี้ */
  taxId: string;
  footerLines: string[];
  paperSize: ReceiptPaperSize;
  fontSizePx: number;
  showImei: boolean;
  updated_at?: number;
  updated_by?: string;
}

// ค่าตั้งต้น = สิ่งที่ใบเสร็จพิมพ์อยู่ก่อนมีหน้าตั้งค่านี้ (POS.tsx ฉบับ 3 บรรทัดท้าย)
// เปลี่ยนค่าตรงนี้ = เปลี่ยนใบเสร็จของทุกร้านที่ยังไม่เคยกดบันทึกหน้าตั้งค่า
export const RECEIPT_DEFAULTS: ReceiptSettings = {
  shopName: 'BKK APPLE PRO',
  addressLine: 'Bangkok, Thailand',
  taxId: '01055xxxxxxxx',
  footerLines: [
    'Thank you for your purchase!',
    'สินค้าซื้อแล้วไม่รับเปลี่ยนคืนทุกกรณี',
    'โปรดเก็บใบเสร็จเพื่อเป็นหลักฐานการรับประกัน',
  ],
  paperSize: 'A4',
  fontSizePx: 12,
  showImei: true,
};

export const RECEIPT_FONT_MIN = 8;
export const RECEIPT_FONT_MAX = 24;

const toLines = (raw: unknown): string[] => {
  // RTDB คืน array เป็น object map ได้ถ้า index ไม่ต่อเนื่อง — รับทั้งสองรูป
  if (Array.isArray(raw)) return raw.map((l) => String(l ?? ''));
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>).map((l) => String(l ?? ''));
  return [];
};

const clampFont = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return RECEIPT_DEFAULTS.fontSizePx;
  return Math.min(RECEIPT_FONT_MAX, Math.max(RECEIPT_FONT_MIN, Math.round(n)));
};

/**
 * แปลงค่าดิบจาก RTDB เป็น ReceiptSettings ที่ใช้ได้เสมอ
 *
 * เส้นแบ่งที่สำคัญ: **ไม่มี doc** = ยังไม่เคยตั้งค่า → ใช้ค่าตั้งต้นทั้งชุด
 * ส่วน **มี doc แต่ไม่มี footerLines** = แอดมินลบท้ายใบเสร็จออกหมดแล้ว
 * (RTDB ลบคีย์ทิ้งเมื่อค่าเป็น array ว่าง) → ต้องได้ [] ไม่ใช่ค่าตั้งต้นกลับมา
 * มิฉะนั้นท้ายใบเสร็จที่เพิ่งลบจะโผล่กลับมาเองเงียบๆ
 */
export const normalizeReceiptSettings = (raw: unknown): ReceiptSettings => {
  if (!raw || typeof raw !== 'object') return { ...RECEIPT_DEFAULTS };
  const v = raw as Record<string, unknown>;
  return {
    shopName: String(v.shopName ?? RECEIPT_DEFAULTS.shopName),
    addressLine: String(v.addressLine ?? RECEIPT_DEFAULTS.addressLine),
    taxId: String(v.taxId ?? ''),
    footerLines: 'footerLines' in v ? toLines(v.footerLines) : [],
    paperSize: v.paperSize === 'thermal80' ? 'thermal80' : 'A4',
    fontSizePx: clampFont(v.fontSizePx),
    showImei: v.showImei !== false,
    updated_at: Number(v.updated_at) || undefined,
    updated_by: v.updated_by ? String(v.updated_by) : undefined,
  };
};
