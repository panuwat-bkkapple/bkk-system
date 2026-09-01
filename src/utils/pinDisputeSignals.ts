// สัญญาณที่บอกว่า "คำแย้งหมุดใบนี้น่าเชื่อแค่ไหน" — pure, มีเทส
//
// ที่มา (เคสจริง 31 ส.ค. 2569, OID-MTHBWFJJ-384): ไรเดอร์แย้งว่าหมุดผิด
// แอดมินอนุมัติ ค่าวิ่งถูกคิดใหม่จาก 290 เหลือ 186 — แล้วพบทีหลังว่า
// **หมุดลูกค้าถูกต้อง** ส่วนพิกัดเช็คอินคือจุดกลางทางขากลับ เพราะไรเดอร์กด
// สามสถานะรวดเดียวหลังออกจากลูกค้าไปแล้ว
//
// ข้อมูลที่ตัดสินเรื่องนี้ได้ **อยู่บนงานอยู่แล้วทั้งคู่** แต่ไม่เคยถูกเอามา
// วางตรงหน้าคนที่กดอนุมัติ:
//   1. ที่อยู่ที่ลูกค้าพิมพ์ geocode แล้วตรงกับหมุด = หมุดไม่ผิด
//   2. จุดเช็คอินหลายจุดเวลาเดียวกัน = กดรวดเดียว พิกัดไม่ใช่จุดเกิดเหตุ
//
// ทั้งสองข้อไม่บล็อกการอนุมัติ (แอดมินอาจมีข้อมูลนอกระบบ) แต่ต้องบังคับให้
// อ่านก่อน — ดู PinDisputeCard ที่ขอ checkbox ยืนยันเมื่อมีสัญญาณเตือน

/** ระยะทางเส้นตรง (เมตร) — Haversine ตัวเดียวกับที่แอปไรเดอร์ใช้ */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const finite = (v: unknown): number | null => {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** หมุดกับที่อยู่ที่ลูกค้าพิมพ์ห่างกันเกินเท่านี้ = หมุดอาจไม่ตรงที่อยู่จริง */
export const PIN_MATCHES_ADDRESS_M = 300;
/** เช็คอินสองจุดห่างกันไม่เกินเท่านี้ = กดรวดเดียว ไม่ใช่เหตุการณ์จริงสองครั้ง */
export const BURST_TAP_MS = 60_000;

export interface PinDisputeSignal {
  id: 'pin_matches_address' | 'burst_checkin';
  /** true = ต้องให้แอดมินยืนยันก่อนกดอนุมัติ */
  strong: boolean;
  text: string;
}

/**
 * สัญญาณทั้งหมดของงานหนึ่งใบ — ว่างเปล่า = ไม่มีอะไรค้าน
 */
export function pinDisputeSignals(job: any): PinDisputeSignal[] {
  const out: PinDisputeSignal[] = [];

  // 1. หมุด vs ที่อยู่ที่ลูกค้าพิมพ์ (geocode ตอนสร้างงาน)
  const pinLat = finite(job?.cust_lat);
  const pinLng = finite(job?.cust_lng);
  const geoLat = finite(job?.cust_address_geocoded_lat);
  const geoLng = finite(job?.cust_address_geocoded_lng);
  if (pinLat !== null && pinLng !== null && geoLat !== null && geoLng !== null) {
    const gap = distanceMeters(pinLat, pinLng, geoLat, geoLng);
    if (gap <= PIN_MATCHES_ADDRESS_M) {
      out.push({
        id: 'pin_matches_address',
        strong: true,
        text: `หมุดตรงกับที่อยู่ที่ลูกค้าพิมพ์ (ห่างกัน ${gap} ม.) — หมุดน่าจะไม่ผิด ระยะที่ต่างอาจมาจากจังหวะที่ไรเดอร์กดเช็คอิน`,
      });
    }
  }

  // 2. เช็คอินหลายจุดในนาทีเดียว
  const stamps: { key: string; at: number }[] = [];
  for (const stage of ['rider_arrived', 'customer_left', 'branch_handover']) {
    const at = finite(job?.checkpoints?.[stage]?.at);
    if (at !== null && at > 0) stamps.push({ key: stage, at });
  }
  stamps.sort((a, b) => a.at - b.at);
  const burst = stamps.length >= 2 && stamps[stamps.length - 1].at - stamps[0].at <= BURST_TAP_MS;
  if (burst) {
    out.push({
      id: 'burst_checkin',
      strong: true,
      text: `เช็คอิน ${stamps.length} จุดถูกกดภายในนาทีเดียว — พิกัดที่บันทึกน่าจะเป็นที่ที่กดปุ่ม ไม่ใช่จุดรับเครื่องจริง`,
    });
  }

  return out;
}

/** มีสัญญาณที่ต้องให้ยืนยันก่อนอนุมัติไหม */
export function needsAcknowledgement(job: any): boolean {
  return pinDisputeSignals(job).some((s) => s.strong);
}
