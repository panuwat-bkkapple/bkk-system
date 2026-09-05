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
  /**
   * เคยขอตำแหน่งจากการแตะของผู้ใช้ไปแล้วหรือยัง
   *
   * **iOS ขึ้นกล่องถามเฉพาะเมื่อคำขอมาจากการแตะ** — ขอตอนหน้าโหลดถูกปฏิเสธ
   * ทันทีโดยไม่ถาม แอปจึงต้องมีปุ่มให้แตะก่อน ไม่ใช่หมุนรอกล่องที่ไม่มีวันขึ้น
   */
  asked: boolean;
}

export interface GeoBlock {
  code: GeoErrorCode | 'no_fix' | 'stale' | 'needs_gesture';
  title: string;
  detail: string;
  /**
   * มีปุ่มให้กดไหม (และปุ่มนั้นเขียนว่าอะไร)
   *
   * **บทเรียน 5 ก.ย. 2569 — เดิมข้อนี้ผิด:** เคยตั้งใจไม่ให้ `denied` มีปุ่ม
   * ด้วยเหตุผลว่า "ปุ่มที่กดแล้วไม่มีทางสำเร็จ สอนให้คนกดวนไปเรื่อยๆ" ซึ่ง
   * **สมมติว่า `denied` แปลว่าผู้ใช้ปฏิเสธจริง** — บน iOS ไม่ใช่: การขอ
   * ตำแหน่งที่ไม่ได้เกิดจากการแตะของผู้ใช้ถูกปฏิเสธทันทีโดย**ไม่เคยขึ้นกล่อง
   * ถาม** ผลคือจอตัน ไม่มีปุ่ม ไม่มีทางไปต่อ ทั้งที่คนยังไม่เคยถูกถามด้วยซ้ำ
   */
  action: string | null;
}

/** ปุ่มที่กดแล้วมีทางสำเร็จ = ปุ่มที่ควรมี */
const ASK = 'อนุญาตให้เข้าถึงตำแหน่ง';
const RETRY = 'ลองใหม่';

/**
 * พิกัดเก่ากว่านี้ถือว่าใช้ไม่ได้
 *
 * `watchPosition` เสิร์ฟพิกัดจากแคชได้เมื่อตั้ง `maximumAge` และแม้ตั้งเป็น 0
 * เบราว์เซอร์บางตัวก็ยังคืนค่าเก่าเมื่อสัญญาณหาย **เคสนี้ไม่ error** มันแค่ตอบ
 * พิกัดของที่ที่คุณอยู่เมื่อชั่วโมงที่แล้ว ซึ่งเป็นเคสที่อันตรายที่สุดของงานนี้
 * เพราะมันจะเช็คอินผ่านทั้งที่คนไม่ได้อยู่ที่ร้าน
 */
export const MAX_FIX_AGE_MS = 90_000;

const MESSAGES: Record<GeoErrorCode, { title: string; detail: string; action: string | null }> = {
  unsupported: {
    title: 'เครื่องนี้ใช้ลงเวลาไม่ได้',
    detail: 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง ลองเปิดด้วย Safari หรือ Chrome รุ่นล่าสุด',
    action: null,
  },
  insecure: {
    title: 'ที่อยู่เว็บไม่ปลอดภัย',
    detail: 'ต้องเปิดผ่าน https เท่านั้น เบราว์เซอร์จะไม่ยอมให้เว็บที่ไม่ปลอดภัยอ่านตำแหน่ง',
    action: null,
  },
  denied: {
    title: 'ต้องอนุญาตให้เข้าถึงตำแหน่งก่อน',
    // **ข้อความต้องครอบสองเคส** — "เคยกดไม่อนุญาต" กับ "ยังไม่เคยถูกถามเลย"
    // (iOS ปฏิเสธคำขอที่ไม่ได้มาจากการแตะโดยไม่ขึ้นกล่องถาม) แยกสองเคสนี้จาก
    // ฝั่งเว็บไม่ได้ เบราว์เซอร์ส่งรหัสเดียวกันมาทั้งคู่ จึงต้องบอกทั้งสองทาง
    detail: 'กดปุ่มด้านล่างเพื่อขออนุญาตอีกครั้ง — ถ้ากล่องถามไม่ขึ้น แปลว่าเคยกดไม่อนุญาตไว้ ให้ไปที่ ตั้งค่า > ความเป็นส่วนตัว > บริการหาตำแหน่ง แล้วเปิดสิทธิ์ของเว็บไซต์นี้',
    action: ASK,
  },
  unavailable: {
    title: 'หาตำแหน่งไม่พบ',
    detail: 'เปิด GPS ของเครื่อง แล้วออกไปที่ที่สัญญาณเข้าถึงได้ (ในอาคารลึกอาจจับไม่ได้)',
    action: RETRY,
  },
  timeout: {
    title: 'หาตำแหน่งนานเกินไป',
    detail: 'สัญญาณอาจอ่อน ลองใหม่อีกครั้ง',
    action: RETRY,
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
  // **ยังไม่เคยแตะขอ = ขอปุ่มก่อน ไม่ใช่หมุนรอ** — บน iOS กล่องถามจะไม่ขึ้น
  // เลยถ้าคำขอไม่ได้มาจากการแตะ จอที่หมุนรออยู่จึงหมุนตลอดกาล
  if (!i.asked && !i.fix) {
    return {
      code: 'needs_gesture',
      title: 'แตะเพื่อเริ่มใช้งาน',
      detail: 'แอปนี้ใช้ตำแหน่งเพื่อยืนยันว่าคุณอยู่ที่สาขาตอนลงเวลา กดปุ่มด้านล่างแล้วเลือก "อนุญาต" ในกล่องที่ขึ้นมา',
      action: ASK,
    };
  }
  // error ของ browser มาก่อน "ยังไม่มีพิกัด" เพราะมันบอกสาเหตุได้ ส่วน
  // "ยังไม่มีพิกัด" เป็นแค่การรอ
  if (i.error) return { code: i.error, ...MESSAGES[i.error] };
  if (!i.fix) {
    return {
      code: 'no_fix',
      title: 'กำลังหาตำแหน่ง',
      detail: 'รอสักครู่ ระบบกำลังอ่านพิกัดจาก GPS ของเครื่อง',
      action: RETRY,
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
      action: RETRY,
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

/** ชื่อเดือนย่อภาษาไทย (index = เดือน 0-11) */
const THAI_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const THAI_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const THAI_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** แยกส่วนของวันที่รูป `YYYY-MM-DD` เป็นตัวเลข — คืน null ถ้ารูปไม่ตรง
 *
 * **อ่านเป็นเวลาท้องถิ่น ไม่ใช่ UTC โดยตั้งใจ** — `new Date('2026-09-05')`
 * ตีความเป็น UTC เที่ยงคืน ซึ่งในไทย (UTC+7) ยังเป็นวันเดียวกันก็จริง แต่
 * โซนที่ติดลบจะเลื่อนไปหนึ่งวัน. ค่าที่ server ส่งมาคือ "วันที่ของกะ" ตาม
 * ปฏิทินไทยอยู่แล้ว ห้ามให้เขตเวลาของเครื่องมาขยับมัน
 */
function ymd(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

/** `2026-09-05` -> `5 ก.ย. 2569` (พ.ศ.) — ใช้แสดงผลเท่านั้น
 *  ฟอร์มยังส่งค่ารูป ISO ให้ server เหมือนเดิม */
export function thaiDate(date: string): string {
  const p = ymd(date);
  if (!p) return String(date || '');
  return `${p.d} ${THAI_MONTH[p.m]} ${p.y + 543}`;
}

/** ช่วงวันที่ — ยุบส่วนที่ซ้ำกัน (`12 - 13 ก.ย. 2569`) ให้อ่านเร็วขึ้น */
export function thaiDateRange(from: string, to: string): string {
  const a = ymd(from);
  const b = ymd(to);
  if (!a || !b) return from === to ? thaiDate(from) : `${thaiDate(from)} - ${thaiDate(to)}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return thaiDate(from);
  if (a.y === b.y && a.m === b.m) return `${a.d} - ${b.d} ${THAI_MONTH[b.m]} ${b.y + 543}`;
  if (a.y === b.y) return `${a.d} ${THAI_MONTH[a.m]} - ${b.d} ${THAI_MONTH[b.m]} ${b.y + 543}`;
  return `${thaiDate(from)} - ${thaiDate(to)}`;
}

/** วันในสัปดาห์ + เลขวันที่ สำหรับคอลัมน์ซ้ายของแถวประวัติ */
export function thaiDayParts(date: string): { dow: string; num: string; month: string } {
  const p = ymd(date);
  if (!p) return { dow: '', num: String(date || '').slice(-2), month: '' };
  return {
    dow: THAI_DOW[new Date(p.y, p.m, p.d).getDay()] || '',
    num: String(p.d).padStart(2, '0'),
    month: `${THAI_MONTH_FULL[p.m]} ${p.y + 543}`,
  };
}
