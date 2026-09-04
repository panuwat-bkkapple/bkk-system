// ข้อเท็จจริงบนใบสมัครที่ต้อง "ไม่รู้" ได้ ไม่ใช่แค่ใช่/ไม่ใช่
//
// ทั้งสองเรื่องในไฟล์นี้มีสามสถานะ ไม่ใช่สอง และสถานะที่สามคือตัวที่สำคัญ:
// ใบสมัครที่ส่งมา**ก่อน**ฟอร์มจะถามคำถามนั้น ไม่ได้แปลว่าผู้สมัครตอบว่าไม่
// การยุบสองอย่างนี้เข้าด้วยกันคือการรายงานสิ่งที่ไม่เคยถามว่าเป็นคำตอบ
// (บทเรียนเดียวกับ `SsoBadge` — `unknown` ห้ามกลายเป็น `ok`)

export type LicenseFact =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'unasked' };

export type ConsentFact =
  | { kind: 'recorded'; version: string | null; at: number }
  | { kind: 'unrecorded' };

/**
 * ผู้สมัครมีใบขับขี่ไหม
 *
 * `null`/`undefined` = ตำแหน่งนี้ไม่ได้ถาม หรือใบนี้ส่งมาก่อนฟอร์มจะมีคำถาม
 * **ห้ามอ่านเป็น "ไม่มี"** — ตำแหน่งไรเดอร์ที่ขึ้นว่าไม่มีใบขับขี่ทั้งที่
 * ไม่เคยถูกถาม คือเหตุผลให้ HR ปฏิเสธคนที่มีใบขับขี่จริง
 */
export function licenseFact(raw: unknown): LicenseFact {
  if (raw === true) return { kind: 'yes' };
  if (raw === false) return { kind: 'no' };
  return { kind: 'unasked' };
}

/**
 * ผู้สมัครยินยอมให้เก็บข้อมูลตามประกาศฉบับไหน
 *
 * ต้องมีเวลาที่ยินยอมจริงเท่านั้นถึงนับว่าบันทึกไว้ — เวอร์ชันอย่างเดียว
 * ไม่พอ (แปลว่าเรารู้ว่าประกาศคือฉบับไหน แต่ไม่รู้ว่าเขากดยินยอมเมื่อไร)
 *
 * `unrecorded` **ไม่ได้แปลว่าผู้สมัครปฏิเสธ** — ใบที่ส่งก่อนเราเริ่มบันทึก
 * ความยินยอมก็อยู่กลุ่มนี้ ป้ายจึงต้องเขียนว่า "ไม่มีบันทึก" ไม่ใช่ "ไม่ยินยอม"
 */
export function consentFact(row: {
  consent_at?: unknown;
  consent_privacy_version?: unknown;
}): ConsentFact {
  const at = Number((row || {}).consent_at);
  if (!Number.isFinite(at) || at <= 0) return { kind: 'unrecorded' };
  const v = (row || {}).consent_privacy_version;
  const version = typeof v === 'string' && v.trim() ? v.trim() : null;
  return { kind: 'recorded', version, at };
}

/** ข้อความบนป้ายใบขับขี่ — `null` = ไม่ต้องขึ้นป้ายเลย */
export function licenseLabel(fact: LicenseFact): string | null {
  if (fact.kind === 'yes') return 'มีใบขับขี่';
  if (fact.kind === 'no') return 'ไม่มีใบขับขี่';
  return null;
}
