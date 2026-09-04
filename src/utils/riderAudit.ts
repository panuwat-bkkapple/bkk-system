// src/utils/riderAudit.ts — ประกอบแถวใบตรวจงานไรเดอร์ (pure)
//
// หนึ่งแถว = หนึ่งใบงาน คอลัมน์ที่เหลือคือข้อเท็จจริงฝั่งไรเดอร์ที่แอดมินต้อง
// ไล่สอบก่อนงานจะไปถึงคิวจ่ายเงิน
//
// กติกาของไฟล์นี้ทั้งไฟล์คือ **ห้ามแต่งค่าที่ไม่มี** — ทุกช่องที่ระบบไม่รู้
// คืน null และคนเรียกต้องแสดงว่า "ไม่มี" ไม่ใช่แสดง 0 หรือขีด เพราะ 0 กับ
// "วัดไม่ได้" นำไปสู่การตัดสินใจคนละแบบ และนี่คือจอที่คนใช้ตัดสินว่าจะจ่ายเงิน
//
// สามเรื่องที่ตารางนี้ต้องเล่าให้ตรง ไม่งั้นมันจะโกหกอย่างน่าเชื่อถือ:
//
//   1. **จุดที่ไรเดอร์ออกเดินทาง ไม่ใช่จุดที่ระบบใช้คิดเงิน** — ค่ารอบคิดจาก
//      พิกัด "สาขา" ที่ resolveBranchCoords หามาให้ (functions/index.js) ส่วน
//      พิกัดจริงของไรเดอร์อยู่ใน checkpoint `rider_en_route` และไม่เคยถูกใช้
//      คิดเงินเลย จึงแยกเป็นคนละช่อง ห้ามยุบรวม
//
//   2. **ระยะทางสองตัววัดคนละคู่พิกัด คนละ endpoint** — riderDistanceKm คือ
//      ลูกค้า→สาขา ขาเดียวผ่าน Routes API ส่วน customerDistanceKm คือ
//      สาขา→ลูกค้า ที่อาจมาจาก Routes ฝั่งเบราว์เซอร์หรือเส้นตรง×1.3
//      (ดู distanceBasis) สองเลขนี้ต่างกันได้โดยไม่มีใครผิด
//
//   3. **ค่ารอบมีทางเข้าที่สามที่ไม่ได้คิดจากระยะ** — ค่าเสียเวลาตอนลูกค้า
//      ยกเลิกกลางทางเขียน rider_fee ตรงพร้อม rider_fee_breakdown
//      ถ้าไม่โชว์ breakdown แอดมินจะไล่หาความผิดที่ไม่มีอยู่จริง
import { JOB_STATUS, normalizeStatus } from '../types/job-statuses';
import type { AnyJobStatus } from '../types/job-statuses';

/** ค่าที่ finite เท่านั้น — `Number(null)` เป็น 0 และ 0 ก็ finite */
export const finiteOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** พิกัดที่ครบคู่เท่านั้น — มี lat แต่ไม่มี lng คือพิกัดที่ใช้ไม่ได้ */
export interface AuditPoint {
  lat: number;
  lng: number;
}
export const pointOrNull = (lat: unknown, lng: unknown): AuditPoint | null => {
  const a = finiteOrNull(lat);
  const b = finiteOrNull(lng);
  return a === null || b === null ? null : { lat: a, lng: b };
};

export interface AuditCheckpoint {
  at: number | null;
  point: AuditPoint | null;
  /** เหตุผลที่ไม่มีพิกัด — `denied` / `timeout` / `unavailable` / `unsupported` */
  gpsStatus: string | null;
  distanceM: number | null;
  withinZone: boolean | null;
}

/**
 * กฎที่ตัดสินยอดค่ารอบของใบงานหนึ่ง
 *
 * มีไว้เพราะพอแตกคอลัมน์เป็น ฐาน / ต่อ กม. / รวม แล้ว **แถวที่ชนเพดานหรือชน
 * ขั้นต่ำจะดูเหมือนบวกเลขผิด** — 60 + 15x2 ควรได้ 90 แต่ยอดจริงคือ 100 เพราะ
 * min_fee อุ้มไว้ ถ้าไม่บอกว่ากฎไหนทำงาน คนตรวจจะไล่หาความผิดที่ไม่มีอยู่จริง
 * (ปัญหาเดียวกับ rider_fee_breakdown ที่ธง fee_not_from_distance มีไว้จับ)
 *
 *   formula      สูตรตรงๆ ไม่ชนขอบ
 *   min_floor    ต่ำกว่าขั้นต่ำ ยอดถูกดันขึ้นเป็น min_fee
 *   max_cap      เกินเพดาน ยอดถูกกดลงเป็น max_fee
 *   no_distance  วัดระยะไม่ได้ ระบบจ่าย min_fee ตามพฤติกรรมเดิม
 *   unknown      ไม่มีการ์ดอัตราเก็บไว้ (งานเก่า) หรือค่ารอบมาจากทางอื่น
 */
export type FeeRule = 'formula' | 'min_floor' | 'max_cap' | 'no_distance' | 'unknown';

export interface RiderAuditRow {
  id: string;
  refNo: string | null;
  receiveMethod: string | null;
  /** normalize แล้ว — DB มี legacy spelling ถาวร ห้ามเทียบ string ดิบ */
  // `AnyJobStatus` ไม่ใช่ `JobStatus` — ตั้งแต่สาย B2B เข้า enum แล้ว
  // `normalizeStatus` คืนได้ทั้งสองเส้น. แถว audit ของไรเดอร์แทบไม่มีทางเป็น
  // งาน B2B (คิวไรเดอร์กรอง non-Pickup ทิ้ง) แต่ฟังก์ชันนี้รับ job อะไรก็ได้
  // การประกาศให้แคบกว่าความจริงคือการโกหก type ไม่ใช่การกันอะไร
  status: AnyJobStatus | null;
  rawStatus: string | null;

  riderId: string | null;
  /** `cancelled_by` เก็บรูป `rider:{id}` ไว้ ซึ่งเป็นทางเดียวที่ยังรู้ว่าใคร
   *  ทำงานใบนี้หลังการยกเลิกล้าง rider_id ทิ้ง */
  riderIdFromCancel: string | null;

  /** พิกัดไรเดอร์ตอนกด "เดินทาง" — ไม่ใช่ต้นทางที่ใช้คิดเงิน */
  departure: AuditCheckpoint | null;
  arrival: AuditCheckpoint | null;
  handover: AuditCheckpoint | null;

  customerPin: AuditPoint | null;
  customerAddress: string | null;
  /** geocode เชื่อได้แค่ไหน — `failed` แปลว่าพิกัดที่แปลงมาเป็น null */
  geocodeStatus: string | null;

  /** ลูกค้า→สาขา ขาเดียว ใช้คิดค่าจ้างไรเดอร์ */
  riderDistanceKm: number | null;
  riderDurationMin: number | null;
  /** ฐานที่ใช้วัดระยะของเงิน (ฐานเดียวทั้งระบบ ไม่อิงคนขับ) */
  travelMode: string | null;
  /** โหมดที่ใช้คิด ETA — ต่างจาก travelMode ได้ เพราะ ETA อิงยานพาหนะจริง */
  etaTravelMode: string | null;
  /** resolveBranchCoords ตกชั้นไหน (`branches/{id}`) — ไม่ใช่หมุดจริง */
  branchSource: string | null;
  /** หมุดที่ระบบ **ใช้วัดจริง** ตอนคิดค่ารอบ — ต้นทางคือหมุดลูกค้า ณ ตอนนั้น
   *  ปลายทางคือหมุดสาขา ทั้งสองแก้ได้ทีหลัง การเก็บไว้คือสิ่งเดียวที่ทำให้
   *  ตอบคำถาม "ตกลงเลขนี้วัดจากหมุดไหน" ได้ · null = งานที่คำนวณก่อนมีฟิลด์นี้ */
  measuredFrom: AuditPoint | null;
  measuredTo: AuditPoint | null;
  /** `calculated` / `missing_customer_coords` / `routes_api_*` */
  feeReason: string | null;

  /** สาขา→ลูกค้า ใช้คิดค่าบริการที่ลูกค้าจ่าย — คนละคู่พิกัดกับข้างบน */
  customerDistanceKm: number | null;
  distanceBasis: string | null;

  /** ตัวที่จ่ายได้จริง — null = ระบบยังไม่ได้ประทับค่ารอบ */
  settledFee: number | null;
  estimateFee: number | null;
  /** มีค่าเมื่อค่ารอบไม่ได้มาจากระยะทาง (เช่น ค่าเสียเวลาตอนลูกค้ายกเลิก) */
  feeBreakdownType: string | null;

  /** การ์ดอัตราที่ใช้คิดค่ารอบใบนี้ — snapshot ต่อใบงาน ไม่ใช่ค่าปัจจุบัน
   *  ของ settings จึงย้อนดูได้ว่าตอนนั้นคิดด้วยอัตราอะไร ซึ่งเป็นสิ่งเดียวที่
   *  จะทำให้อัตราที่ต่างกันรายคน (ถ้าวันหนึ่งมี) ตรวจย้อนหลังได้ */
  rateBase: number | null;
  ratePerKm: number | null;
  rateMinFee: number | null;
  rateMaxFee: number | null;
  /** ยานพาหนะที่ "อัตรา" อิง — คนละตัวกับที่ ETA อิงได้ */
  rateVehicle: string | null;
  /** ผลของสูตรก่อน clamp: base + per_km x ระยะ */
  feeBeforeClamp: number | null;
  /** กฎที่ตัดสินยอดจริง — ดู FeeRule */
  feeRule: FeeRule;

  pickupFee: number | null;
  riderFeeDiscount: number | null;
  /** ยอดที่ลูกค้าจ่ายจริง — ไม่มีฟิลด์นี้ใน DB ต้องคิดเอง */
  effectivePickupFee: number | null;

  createdAt: number | null;
  assignedAt: number | null;
  completedAt: number | null;
  cancelledAt: number | null;
  settledAt: number | null;
  /** เวลาที่ผ่านไปจริงระหว่างออกเดินทางกับส่งมอบ (นาที) */
  elapsedMin: number | null;

  cancelCategory: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;

  feeStatus: string | null;
}

const checkpointOf = (job: any, stage: string): AuditCheckpoint | null => {
  const c = job?.checkpoints?.[stage];
  if (!c) return null;
  return {
    at: finiteOrNull(c.at),
    point: pointOrNull(c.lat, c.lng),
    gpsStatus: str(c.gps_status),
    distanceM: finiteOrNull(c.distance_m),
    withinZone: typeof c.is_within_zone === 'boolean' ? c.is_within_zone : null,
  };
};

/** `rider:{id}` → `{id}` · `customer` และรูปอื่นคืน null */
export const riderIdFromCancelledBy = (v: unknown): string | null => {
  const s = str(v);
  if (!s || !s.startsWith('rider:')) return null;
  return str(s.slice('rider:'.length));
};

/**
 * แตกการ์ดอัตราออกเป็นคอลัมน์ และบอกว่ากฎไหนตัดสินยอด
 *
 * **ไม่คิดยอดใหม่เพื่อไปแทนที่ยอดที่จ่ายจริง** — `settledFee` ยังเป็นตัวเดียวที่
 * ถือความจริงเรื่องเงิน ตัวเลขที่คิดที่นี่มีไว้ **อธิบาย** ยอดนั้นเท่านั้น
 * (สูตรอยู่ที่ feeFromRates ใน functions/index.js — mirror ตัวที่สอง
 *  แก้สูตรฝั่งนั้นต้องมาดูที่นี่ด้วย)
 */
function rateFields(meta: any, distanceKm: number | null, settled: number | null) {
  const rates = meta?.rates;
  const base = finiteOrNull(rates?.base_fee);
  const perKm = finiteOrNull(rates?.per_km);
  const minFee = finiteOrNull(rates?.min_fee);
  const maxFee = finiteOrNull(rates?.max_fee);

  let before: number | null = null;
  let rule: FeeRule = 'unknown';

  if (base !== null && perKm !== null) {
    if (distanceKm === null) {
      // วัดระยะไม่ได้ = จ่ายขั้นต่ำ ไม่ใช่ base เปล่าๆ (พฤติกรรมของ feeFromRates)
      rule = 'no_distance';
    } else {
      before = base + perKm * distanceKm;
      if (minFee !== null && before < minFee) rule = 'min_floor';
      else if (maxFee !== null && before > maxFee) rule = 'max_cap';
      else rule = 'formula';
    }
  }
  // ค่ารอบที่มาจากทางอื่น (ค่าเสียเวลา) อธิบายด้วยการ์ดอัตราไม่ได้
  if (settled !== null && rule === 'formula' && before !== null && Math.round(before) !== settled) {
    rule = 'unknown';
  }

  return {
    rateBase: base,
    ratePerKm: perKm,
    rateMinFee: minFee,
    rateMaxFee: maxFee,
    rateVehicle: typeof rates?.vehicle === 'string' ? rates.vehicle : null,
    feeBeforeClamp: before === null ? null : Math.round(before * 100) / 100,
    feeRule: rule,
  };
}

export function buildRiderAuditRow(job: any): RiderAuditRow | null {
  if (!job?.id) return null;

  const riderMeta = job.rider_fee_meta || job.rider_fee_estimate_meta || null;
  const departure = checkpointOf(job, 'rider_en_route');
  const handover = checkpointOf(job, 'branch_handover');

  // เวลาที่ผ่านไปจริง คิดจาก checkpoint สองจุด ไม่ใช่จาก duration_min ที่
  // Routes API ทำนายไว้ — สองอย่างนี้คนละความหมาย และช่องว่างระหว่างมันคือ
  // สิ่งที่ใบตรวจนี้มีไว้ให้เห็น
  const elapsedMin =
    departure?.at != null && handover?.at != null && handover.at >= departure.at
      ? Math.round((handover.at - departure.at) / 60000)
      : null;

  const pickupFee = finiteOrNull(job.pickup_fee);
  const discount = finiteOrNull(job.rider_fee_discount);
  const effective =
    pickupFee === null ? null : Math.max(0, pickupFee - (discount ?? 0));

  return {
    id: String(job.id),
    refNo: str(job.ref_no) ?? str(job.OID),
    receiveMethod: str(job.receive_method),
    status: normalizeStatus(job.status, job.receive_method) ?? null,
    rawStatus: str(job.status),

    riderId: str(job.rider_id),
    riderIdFromCancel: riderIdFromCancelledBy(job.cancelled_by),

    departure,
    arrival: checkpointOf(job, 'rider_arrived'),
    handover,

    customerPin: pointOrNull(job.cust_lat, job.cust_lng),
    customerAddress: str(job.cust_address),
    geocodeStatus: str(job.cust_address_geocoded_status),

    riderDistanceKm: finiteOrNull(riderMeta?.distance_km),
    riderDurationMin: finiteOrNull(riderMeta?.duration_min),
    travelMode: str(riderMeta?.travel_mode),
    etaTravelMode: str(riderMeta?.eta_travel_mode),
    branchSource: str(riderMeta?.branch_source),
    measuredFrom: pointOrNull(riderMeta?.measured_from?.lat, riderMeta?.measured_from?.lng),
    measuredTo: pointOrNull(riderMeta?.measured_to?.lat, riderMeta?.measured_to?.lng),
    feeReason: str(riderMeta?.reason),

    customerDistanceKm: finiteOrNull(job.pickup_fee_meta?.distance_km),
    distanceBasis: str(job.pickup_fee_meta?.distance_basis),

    settledFee: finiteOrNull(job.rider_fee),
    estimateFee: finiteOrNull(job.rider_fee_estimate),
    feeBreakdownType: str(job.rider_fee_breakdown?.type),

    ...rateFields(riderMeta, finiteOrNull(riderMeta?.distance_km), finiteOrNull(job.rider_fee)),

    pickupFee,
    riderFeeDiscount: discount,
    effectivePickupFee: effective,

    createdAt: finiteOrNull(job.created_at),
    assignedAt: finiteOrNull(job.assigned_at),
    completedAt: finiteOrNull(job.completed_at),
    cancelledAt: finiteOrNull(job.cancelled_at),
    settledAt: finiteOrNull(job.settled_at),
    elapsedMin,

    cancelCategory: str(job.cancel_category),
    cancelReason: str(job.cancel_reason),
    cancelledBy: str(job.cancelled_by),

    feeStatus: str(job.rider_fee_status),
  };
}

/**
 * งานที่ควรอยู่ในใบตรวจ
 *
 * เกณฑ์คือ "มีไรเดอร์เข้าไปเกี่ยวข้องจริง" ไม่ใช่ "ยังมี rider_id อยู่" —
 * การยกเลิกของไรเดอร์ล้าง rider_id ทิ้งเสมอ (bkk-rider-app useJobActions)
 * ถ้ากรองด้วย rider_id อย่างเดียว งานที่ไรเดอร์ออกไปแล้วยกเลิกกลางทางจะหาย
 * จากใบตรวจทั้งที่เป็นงานที่ต้องตรวจที่สุด
 */
export const involvesRider = (job: any): boolean =>
  Boolean(str(job?.rider_id)) ||
  riderIdFromCancelledBy(job?.cancelled_by) !== null ||
  Boolean(job?.checkpoints?.rider_en_route) ||
  finiteOrNull(job?.rider_fee) !== null;

/** ธงเตือนต่อแถว — บอกว่า "ตรงไหนที่ระบบตอบไม่ได้" ไม่ใช่ "ตรงไหนผิด" */
export interface AuditFlag {
  code: string;
  label: string;
}

export function auditFlags(row: RiderAuditRow): AuditFlag[] {
  const out: AuditFlag[] = [];
  if (row.settledFee === null && row.status === JOB_STATUS.CANCELLED) {
    // งานที่ยกเลิกไม่ต้องมีค่ารอบ ไม่ใช่ความผิดปกติ
  } else if (row.settledFee === null) {
    out.push({ code: 'no_settled_fee', label: 'ยังไม่มีค่ารอบที่ระบบประทับ' });
  }
  if (row.riderDistanceKm === null) {
    out.push({ code: 'no_distance', label: 'วัดระยะทางไม่ได้' });
  }
  if (row.departure && row.departure.point === null) {
    out.push({
      code: 'no_departure_gps',
      label: `ไม่มีพิกัดตอนออกเดินทาง${row.departure.gpsStatus ? ` (${row.departure.gpsStatus})` : ''}`,
    });
  }
  if (!row.departure) {
    out.push({ code: 'no_departure', label: 'ไม่มีบันทึกตอนออกเดินทาง' });
  }
  if (row.customerPin === null && row.receiveMethod === 'Pickup') {
    out.push({ code: 'no_customer_pin', label: 'งานรับถึงบ้านแต่ไม่มีหมุดลูกค้า' });
  }
  // ธงนี้ขึ้นเฉพาะเมื่อ **มีการ์ดอัตราเก็บไว้แล้วคำนวณไม่ตรง** ซึ่งแปลว่าอัตรา
  // ถูกแก้หลังคิดเงินไปแล้ว หรือยอดมาจากทางอื่น — ทั้งสองอย่างต้องมีคนดู
  //
  // งานเก่าที่ **ไม่มี** การ์ดอัตราเก็บไว้เลยเป็นคนละเรื่อง และห้ามขึ้นธงนี้:
  // ฟิลด์เพิ่งมี งานก่อนหน้านั้นทุกใบจะติดธงพร้อมกันจนช่องธงไร้ประโยชน์
  // (จับได้จากเทสตัวเอง ไม่ใช่จากการอ่านโค้ด) — ตารางบอกว่า "ไม่มีการ์ดอัตรา"
  // ในช่องของมันอยู่แล้ว ซึ่งพอสำหรับกรณีนั้น
  const hasRateCard = row.rateBase !== null && row.ratePerKm !== null;
  if (hasRateCard && row.settledFee !== null && row.feeRule === 'unknown' && !row.feeBreakdownType) {
    out.push({ code: 'fee_unexplained', label: 'ยอดไม่ตรงกับการ์ดอัตราที่เก็บไว้' });
  }
  if (row.feeBreakdownType) {
    out.push({
      code: 'fee_not_from_distance',
      label: `ค่ารอบไม่ได้คิดจากระยะทาง (${row.feeBreakdownType})`,
    });
  }
  // หมุดลูกค้าถูกขยับหลังคิดค่ารอบแล้ว = เลขที่จ่ายวัดจากที่อื่น ซึ่งเป็นเคส
  // ที่ใบตรวจนี้มีไว้จับโดยตรง (เกณฑ์หยาบ ~100 ม. พอให้เห็นการย้ายที่มีความหมาย
  // โดยไม่ตื่นตูมกับความคลาดเคลื่อนของ GPS)
  if (row.measuredFrom && row.customerPin) {
    const dLat = row.measuredFrom.lat - row.customerPin.lat;
    const dLng = row.measuredFrom.lng - row.customerPin.lng;
    if (Math.abs(dLat) > 0.001 || Math.abs(dLng) > 0.001) {
      out.push({ code: 'pin_moved_after_pricing', label: 'หมุดลูกค้าถูกขยับหลังคิดค่ารอบ' });
    }
  }
  if (row.riderId === null && row.riderIdFromCancel !== null) {
    out.push({ code: 'rider_detached', label: 'งานถูกยกเลิกและหลุดจากไรเดอร์แล้ว' });
  }
  return out;
}
