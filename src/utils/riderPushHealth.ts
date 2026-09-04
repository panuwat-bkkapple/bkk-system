// src/utils/riderPushHealth.ts
//
// "เครื่องของไรเดอร์คนนี้ยังรับ push ได้ไหม" — สำหรับหน้า RiderManagement
//
// MIRROR ของ `functions/rider-push-coverage.js` (ตัวที่ probe ใน /system-health
// ใช้) — functions import TS ไม่ได้ กฎ/เกณฑ์ต้องตรงกัน แก้ที่หนึ่งต้องแก้ทั้งคู่.
// เกณฑ์ 7 วันตรงกับการ์ดในแอปไรเดอร์ (bkk-rider-app `src/utils/pushHealth.ts`)
// ซึ่งเตือนไรเดอร์ด้วยเลขเดียวกัน — สามที่ต้องเห็นตรงกัน ไม่งั้นแอดมินเห็นแดง
// ขณะที่ไรเดอร์เห็นเขียว
//
// ทำไมต้องมี (bkk-rider-app/docs/reports/2026-09-03-rider-push-delivery-survey.md ข้อ H):
// server ตัด token ที่ FCM ปฏิเสธทิ้งทันทีโดยไม่บันทึกที่ไหน และ token ต่ออายุ
// ได้เฉพาะตอนไรเดอร์เปิดแอป จึงมีสภาพ "อนุมัติแล้วแต่ push ไปไม่ถึงเลย" เกิดได้
// เงียบๆ และก่อนหน้านี้ไม่มีจอไหนในระบบตอบคำถามนี้ได้จนกว่าไรเดอร์จะบ่น

export const RIDER_PUSH_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type RiderPushLevel = 'ok' | 'stale' | 'none';

export interface RiderPushDevice {
  deviceId: string;
  device: string;
  updatedAt: number | null;
}

export interface RiderPushHealth {
  level: RiderPushLevel;
  devices: RiderPushDevice[];
  /** เวลาเขียน token ล่าสุดจากทุกเครื่อง (หรือ fcm_updated_at) */
  updatedAt: number | null;
  /** ป้ายสั้นสำหรับตาราง */
  label: string;
  /** ประโยคสำหรับ tooltip / การ์ด */
  detail: string;
}

type RiderLike = {
  fcm_tokens?: unknown;
  fcm_token?: unknown;
  fcm_updated_at?: unknown;
} | null | undefined;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function formatAgo(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

export function riderPushHealth(rider: RiderLike, now: number = Date.now()): RiderPushHealth {
  const r = rider && typeof rider === 'object' ? rider : {};
  const devices: RiderPushDevice[] = [];
  let updatedAt: number | null = null;

  const multi = r.fcm_tokens && typeof r.fcm_tokens === 'object' ? (r.fcm_tokens as Record<string, unknown>) : {};
  for (const [deviceId, raw] of Object.entries(multi)) {
    const entry = raw as { token?: unknown; device?: unknown; updated_at?: unknown } | null;
    if (!entry || typeof entry.token !== 'string' || !entry.token) continue;
    const t = num(entry.updated_at);
    devices.push({ deviceId, device: typeof entry.device === 'string' ? entry.device : '?', updatedAt: t });
    if (t !== null && (updatedAt === null || t > updatedAt)) updatedAt = t;
  }
  // legacy single-token field — client ลบทิ้งเมื่อมี multi แล้ว แต่แถวเก่ายังมีได้
  if (devices.length === 0 && typeof r.fcm_token === 'string' && r.fcm_token) {
    devices.push({ deviceId: 'legacy', device: '?', updatedAt: null });
  }

  const top = num(r.fcm_updated_at);
  if (top !== null && (updatedAt === null || top > updatedAt)) updatedAt = top;

  if (devices.length === 0) {
    return {
      level: 'none',
      devices,
      updatedAt,
      label: 'ไม่มี token',
      detail: updatedAt
        ? `เคยลงทะเบียน ${formatAgo(updatedAt, now)} แต่ token ถูกตัดทิ้งแล้ว (FCM ปฏิเสธ) — push ไปไม่ถึงจนกว่าไรเดอร์จะเปิดแอปแล้วกด "ลองใหม่"`
        : 'ไม่เคยลงทะเบียนรับการแจ้งเตือน — push ไปไม่ถึง',
    };
  }
  if (updatedAt === null || now - updatedAt > RIDER_PUSH_STALE_MS) {
    return {
      level: 'stale',
      devices,
      updatedAt,
      label: 'อาจหลุด',
      detail: updatedAt
        ? `ไม่ได้ต่ออายุมา ${formatAgo(updatedAt, now)} (เกิน 7 วัน) — token อาจตายแล้วโดยไม่มีใครรู้จนกว่าจะส่งจริง`
        : 'มี token แต่ไม่รู้ว่าเขียนเมื่อไหร่',
    };
  }
  return {
    level: 'ok',
    devices,
    updatedAt,
    label: 'รับ push ได้',
    detail: `${devices.length} เครื่อง · ล่าสุด ${formatAgo(updatedAt, now)}`,
  };
}
