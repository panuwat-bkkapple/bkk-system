// ประตู GPS ของแอปพนักงาน — ล้วน มีเทส
//
// ─── ทำไมต้องเป็นไฟล์แยกและเป็นฟังก์ชันเดียว ───────────────────────────────
// โจทย์คือ "ไม่อนุญาตตำแหน่ง = ใช้แอปไม่ได้" ซึ่งฟังดูเหมือน `if` เดียว แต่จริงๆ
// มีเหตุผลที่ทำให้ตำแหน่งใช้ไม่ได้อยู่ **หกแบบที่ต้องบอกคนใช้คนละอย่าง** —
// เบราว์เซอร์ไม่รองรับ, เปิดผ่าน http, ปฏิเสธสิทธิ์, เปิดสิทธิ์แล้วแต่หาไม่เจอ,
// หมดเวลา, และได้พิกัดมาแต่เป็นของเมื่อชั่วโมงที่แล้ว
//
// ถ้ากระจายเป็น `if` ตามหน้าจอ จะมีหน้าหนึ่งที่ลืมเคสใดเคสหนึ่งเสมอ และเคสที่
// ถูกลืมบ่อยที่สุดคือเคสสุดท้าย เพราะมันไม่ error — มันแค่ตอบพิกัดเก่ามาให้
//
// เรียงเหตุผลตาม **ความถาวร** (แก้ไม่ได้เลย -> รอสักครู่ก็หาย) แบบเดียวกับ
// `oneTapBlockReason` ของเว็บลูกค้า
//
// ─── สิ่งที่ไฟล์นี้ *ไม่ได้* ทำ ─────────────────────────────────────────────
// **ไม่ตัดสินว่าอยู่ในรัศมีสาขาไหม** — นั่นเป็นของ server (`hr-attendance.js`)
// การตัดสินฝั่งนี้เป็นแค่การไม่ให้กดปุ่มที่ยังไงก็ถูกปฏิเสธ ไม่ใช่ด่าน
// **และ GPS โกงได้** — mock location ทำได้โดยไม่ต้องรูท อย่าเขียนข้อความบนจอ
// ที่อ้างว่าระบบพิสูจน์ได้ว่าคนอยู่ตรงนั้นจริง

export type GeoErrorCode =
  | 'unsupported'   // เบราว์เซอร์ไม่มี geolocation เลย
  | 'insecure'      // เปิดผ่าน http — API มีอยู่แต่จะ error เสมอ
  | 'denied'        // ผู้ใช้ปฏิเสธสิทธิ์
  | 'unavailable'   // อนุญาตแล้วแต่หาตำแหน่งไม่ได้
  | 'timeout';      // หมดเวลารอ

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy_m: number;
  /** เวลาที่ได้พิกัดนี้มา (epoch ms) */
  at: number;
}

export interface GeoInput {
  supported: boolean;
  secureContext: boolean;
  /** ผลจาก Permissions API — `null` = เบราว์เซอร์ไม่มี API นี้ ซึ่งไม่ใช่ความผิด */
  permission: 'granted' | 'denied' | 'prompt' | null;
  fix: GeoFix | null;
  error: GeoErrorCode | null;
  now: number;
}

export interface GeoBlock {
  code: GeoErrorCode | 'no_fix' | 'stale';
  title: string;
  detail: string;
  /** ปุ่ม "ลองใหม่" ช่วยได้ไหม — เคสที่ช่วยไม่ได้ต้องไม่มีปุ่มให้กดวนไปเรื่อยๆ */
  canRetry: boolean;
}

/**
 * พิกัดเก่ากว่านี้ถือว่าใช้ไม่ได้
 *
 * `watchPosition` เสิร์ฟพิกัดจากแคชได้เมื่อตั้ง `maximumAge` และแม้ตั้งเป็น 0
 * เบราว์เซอร์บางตัวก็ยังคืนค่าเก่าเมื่อสัญญาณหาย **เคสนี้ไม่ error** มันแค่ตอบ
 * พิกัดของที่ที่คุณอยู่เมื่อชั่วโมงที่แล้ว ซึ่งเป็นเคสที่อันตรายที่สุดของงานนี้
 * เพราะมันจะเช็คอินผ่านทั้งที่คนไม่ได้อยู่ที่ร้าน
 */
export const MAX_FIX_AGE_MS = 90_000;

const MESSAGES: Record<GeoErrorCode, { title: string; detail: string; canRetry: boolean }> = {
  unsupported: {
    title: 'เครื่องนี้ใช้ลงเวลาไม่ได้',
    detail: 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง ลองเปิดด้วย Safari หรือ Chrome รุ่นล่าสุด',
    canRetry: false,
  },
  insecure: {
    title: 'ที่อยู่เว็บไม่ปลอดภัย',
    detail: 'ต้องเปิดผ่าน https เท่านั้น เบราว์เซอร์จะไม่ยอมให้เว็บที่ไม่ปลอดภัยอ่านตำแหน่ง',
    canRetry: false,
  },
  denied: {
    title: 'ต้องอนุญาตให้เข้าถึงตำแหน่งก่อน',
    // บอก *วิธีแก้* ไม่ใช่แค่บอกว่าถูกปฏิเสธ — คนส่วนใหญ่ไม่รู้ว่าเมื่อกด
    // "ไม่อนุญาต" ไปแล้ว เบราว์เซอร์จะไม่ถามซ้ำอีก และปุ่มลองใหม่ก็ไม่ช่วย
    detail: 'เปิดการตั้งค่าเว็บไซต์ในเบราว์เซอร์ แล้วเปลี่ยนสิทธิ์ "ตำแหน่ง" เป็นอนุญาต จากนั้นเปิดแอปใหม่',
    canRetry: false,
  },
  unavailable: {
    title: 'หาตำแหน่งไม่พบ',
    detail: 'เปิด GPS ของเครื่อง แล้วออกไปที่ที่สัญญาณเข้าถึงได้ (ในอาคารลึกอาจจับไม่ได้)',
    canRetry: true,
  },
  timeout: {
    title: 'หาตำแหน่งนานเกินไป',
    detail: 'สัญญาณอาจอ่อน ลองใหม่อีกครั้ง',
    canRetry: true,
  },
};

/**
 * ใช้แอปได้ไหม — `null` = ได้
 *
 * เรียงตามความถาวร: สิ่งที่แก้ไม่ได้เลยต้องมาก่อน ไม่งั้นคนที่เปิดผ่าน http
 * จะเห็นข้อความ "กำลังหาตำแหน่ง" หมุนตลอดไปโดยไม่มีอะไรบอกว่าทำไม
 */
export function geoBlockReason(input: GeoInput): GeoBlock | null {
  const i = input || ({} as GeoInput);
  if (!i.supported) return { code: 'unsupported', ...MESSAGES.unsupported };
  if (!i.secureContext) return { code: 'insecure', ...MESSAGES.insecure };
  if (i.permission === 'denied') return { code: 'denied', ...MESSAGES.denied };
  // error ของ browser มาก่อน "ยังไม่มีพิกัด" เพราะมันบอกสาเหตุได้ ส่วน
  // "ยังไม่มีพิกัด" เป็นแค่การรอ
  if (i.error) return { code: i.error, ...MESSAGES[i.error] };
  if (!i.fix) {
    return {
      code: 'no_fix',
      title: 'กำลังหาตำแหน่ง',
      detail: 'รอสักครู่ ระบบกำลังอ่านพิกัดจาก GPS ของเครื่อง',
      canRetry: true,
    };
  }
  const age = Number(i.now) - Number(i.fix.at);
  // `Number.isFinite` อย่างเดียวไม่พอ — `at` ที่หายไปจะได้ NaN ซึ่ง
  // เปรียบเทียบแล้วเป็น false ทุกทาง แปลว่าพิกัดที่ไม่รู้เวลาจะ "สดเสมอ"
  if (!Number.isFinite(age) || age > MAX_FIX_AGE_MS) {
    return {
      code: 'stale',
      title: 'ตำแหน่งเป็นข้อมูลเก่า',
      detail: 'พิกัดที่เครื่องให้มาไม่ใช่ของตอนนี้ กดลองใหม่เพื่ออ่านตำแหน่งปัจจุบัน',
      canRetry: true,
    };
  }
  return null;
}

/** ระยะทางสำหรับคนอ่าน — เมตรจนถึง 1 กม. แล้วค่อยเป็นกิโล */
export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined) return '-';
  const n = Number(m);
  if (!Number.isFinite(n)) return '-';
  if (n < 1000) return `${Math.round(n).toLocaleString('th-TH')} ม.`;
  return `${(n / 1000).toFixed(n < 10000 ? 2 : 1)} กม.`;
}

/** เวลาแบบ HH:MM ของไทย — ค่าว่างต้องไม่กลายเป็น 07:00 ของปี 1970 */
export function clockTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return new Date(n).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/** "8 ชม. 30 น." — นาทีดิบอ่านไม่ออกเมื่อเกินสองชั่วโมง */
export function durationText(min: number | null | undefined): string {
  if (min === null || min === undefined) return '-';
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0) return '-';
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  if (!h) return `${m} นาที`;
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

/** เวลาเริ่ม-จบกะจากนาทีของวัน (server ส่งมาเป็นนาที ไม่ใช่สตริง) */
export function shiftTimeText(startMin: number | null, endMin: number | null): string {
  const fmt = (v: number | null) => {
    if (v === null || !Number.isFinite(Number(v))) return '--:--';
    const n = Number(v);
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  };
  return `${fmt(startMin)} - ${fmt(endMin)}`;
}
