// src/hooks/useReceiptSettings.ts
import { useEffect, useState } from 'react';
import { get, ref } from 'firebase/database';
import { db } from '../api/firebase';
import {
  RECEIPT_DEFAULTS,
  normalizeReceiptSettings,
  type ReceiptSettings,
} from '../components/receipt/receiptSettings';

// =============================================================================
// อ่านค่าตั้งใบเสร็จจาก `settings/receipt` ครั้งเดียวต่อการเปิดแอป แล้วแคชไว้
//
// กติกาข้อเดียวที่ห้ามผ่อน: **การพิมพ์ต้องไม่พังเพราะอ่านค่าตั้งไม่ได้**
// ไม่มี doc / อ่านไม่ได้ / เน็ตหลุด → คืนค่าตั้งต้น ไม่ throw ไม่ค้าง
// (ใบเสร็จคือสิ่งที่ลูกค้ายืนรออยู่หน้าเคาน์เตอร์ ไม่ใช่หน้าจอที่ retry ได้)
//
// แคชเป็น module-level เพราะค่านี้เปลี่ยนน้อยมากและถูกอ่านจาก 3 จุด
// (POS, ประวัติการขาย, หน้าตั้งค่า) — หน้าตั้งค่าเรียก primeReceiptSettings()
// หลังบันทึกเพื่อให้ใบเสร็จใบถัดไปในแท็บเดียวกันใช้ค่าใหม่ทันที
// =============================================================================

let cache: ReceiptSettings | null = null;
let inflight: Promise<ReceiptSettings> | null = null;

export const loadReceiptSettings = (): Promise<ReceiptSettings> => {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = get(ref(db, 'settings/receipt'))
      .then((snap) => normalizeReceiptSettings(snap.exists() ? snap.val() : null))
      .catch(() => ({ ...RECEIPT_DEFAULTS }))
      .then((value) => {
        cache = value;
        inflight = null;
        return value;
      });
  }
  return inflight;
};

/** อัปเดตแคชหลังบันทึก — ไม่ต้องรีเฟรชหน้าเพื่อให้ใบเสร็จใบถัดไปใช้ค่าใหม่ */
export const primeReceiptSettings = (value: ReceiptSettings) => {
  cache = value;
};

export function useReceiptSettings() {
  const [settings, setSettings] = useState<ReceiptSettings>(() => cache || RECEIPT_DEFAULTS);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    loadReceiptSettings().then((value) => {
      if (!alive) return;
      setSettings(value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { settings, loading };
}
