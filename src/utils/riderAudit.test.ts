// เทสของใบตรวจงานไรเดอร์ — เขียนจากรูปข้อมูลที่ผู้เขียนแต่ละรายเขียนจริง
// ไม่ใช่จากสคีมาที่อยากให้เป็น
//
// กฎที่ชุดนี้ตรึงไว้:
//   - ไม่มีค่า = null ห้ามเป็น 0 (Number(null) === 0 และ 0 ก็ finite)
//   - พิกัดต้องครบคู่ มี lat ไม่มี lng = ใช้ไม่ได้
//   - จุดออกเดินทางของไรเดอร์แยกจากระยะทางที่ใช้คิดเงินเสมอ
//   - งานที่ไรเดอร์ยกเลิก (rider_id ถูกล้าง) ต้องยังอยู่ในใบตรวจ
import { describe, it, expect } from 'vitest';
import {
  buildRiderAuditRow,
  involvesRider,
  auditFlags,
  finiteOrNull,
  pointOrNull,
  riderIdFromCancelledBy,
} from './riderAudit';
import { JOB_STATUS } from '../types/job-statuses';

const baseJob = {
  id: 'j1',
  ref_no: 'OID-ABC-001',
  receive_method: 'Pickup',
  status: 'Pending QC',
  rider_id: 'r1',
  cust_lat: 13.74,
  cust_lng: 100.53,
  cust_address: '123 ถนนสุขุมวิท',
  cust_address_geocoded_status: 'ok',
  checkpoints: {
    rider_en_route: { at: 1_756_000_000_000, lat: 13.8, lng: 100.6, gps_status: 'ok' },
    branch_handover: { at: 1_756_003_600_000, lat: 13.85, lng: 100.61, distance_m: 42, is_within_zone: true },
  },
  rider_fee_meta: {
    distance_km: 12.4,
    duration_min: 31,
    travel_mode: 'DRIVE',
    eta_travel_mode: 'TWO_WHEELER',
    branch_source: 'branches/main',
    reason: 'calculated',
  },
  pickup_fee_meta: { distance_km: 11.2, distance_basis: 'client_driving' },
  rider_fee: 95,
  rider_fee_estimate: 90,
  pickup_fee: 120,
  rider_fee_discount: 20,
  created_at: 1_755_999_000_000,
  completed_at: 1_756_003_700_000,
  rider_fee_status: 'Pending',
};

describe('finiteOrNull — 0 กับ "ไม่มี" ต้องแยกกัน', () => {
  it('null/undefined/สตริงว่าง คืน null ไม่ใช่ 0', () => {
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull('')).toBeNull();
    expect(finiteOrNull('  ')).toBeNull();
  });
  it('0 ที่เป็นค่าจริงต้องรอด', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull('0')).toBe(0);
  });
  it('ค่าที่ไม่ใช่ตัวเลขคืน null', () => {
    expect(finiteOrNull('abc')).toBeNull();
    expect(finiteOrNull(NaN)).toBeNull();
  });
});

describe('pointOrNull — พิกัดต้องครบคู่', () => {
  it('ครบคู่ = ใช้ได้ (รวม 0,0 ซึ่งเป็นพิกัดจริงในทะเล)', () => {
    expect(pointOrNull(13.7, 100.5)).toEqual({ lat: 13.7, lng: 100.5 });
    expect(pointOrNull(0, 0)).toEqual({ lat: 0, lng: 0 });
  });
  it('ขาดข้างใดข้างหนึ่ง = null ไม่ใช่ครึ่งพิกัด', () => {
    expect(pointOrNull(13.7, null)).toBeNull();
    expect(pointOrNull(null, 100.5)).toBeNull();
    expect(pointOrNull(undefined, undefined)).toBeNull();
  });
});

describe('buildRiderAuditRow', () => {
  it('อ่านคอลัมน์หลักครบจากงานปกติ', () => {
    const r = buildRiderAuditRow(baseJob)!;
    expect(r.refNo).toBe('OID-ABC-001');
    expect(r.status).toBe(JOB_STATUS.PENDING_QC);
    expect(r.riderDistanceKm).toBe(12.4);
    expect(r.riderDurationMin).toBe(31);
    expect(r.settledFee).toBe(95);
    expect(r.customerPin).toEqual({ lat: 13.74, lng: 100.53 });
  });

  it('จุดออกเดินทางของไรเดอร์แยกจากพิกัดลูกค้า และไม่ใช่ที่มาของระยะทาง', () => {
    const r = buildRiderAuditRow(baseJob)!;
    expect(r.departure?.point).toEqual({ lat: 13.8, lng: 100.6 });
    expect(r.departure?.point).not.toEqual(r.customerPin);
    // branch_source บอกได้แค่ว่า resolve ตกชั้นไหน ไม่ได้เก็บพิกัดที่ใช้วัด
    expect(r.branchSource).toBe('branches/main');
  });

  it('ระยะทางสองตัวเก็บแยกช่อง เพราะวัดคนละคู่พิกัด', () => {
    const r = buildRiderAuditRow(baseJob)!;
    expect(r.riderDistanceKm).toBe(12.4);
    expect(r.customerDistanceKm).toBe(11.2);
    expect(r.distanceBasis).toBe('client_driving');
  });

  it('เวลาที่ผ่านไปจริงคิดจาก checkpoint ไม่ใช่จาก duration ที่ Routes ทำนาย', () => {
    const r = buildRiderAuditRow(baseJob)!;
    expect(r.elapsedMin).toBe(60);
    expect(r.riderDurationMin).toBe(31);
  });

  it('ไม่มี checkpoint ปลายทาง = บอกเวลาที่ผ่านไปไม่ได้ ต้องเป็น null', () => {
    const r = buildRiderAuditRow({
      ...baseJob,
      checkpoints: { rider_en_route: baseJob.checkpoints.rider_en_route },
    })!;
    expect(r.elapsedMin).toBeNull();
  });

  it('checkpoint ที่ GPS ล้ม ยังเป็นแถว แต่ไม่มีพิกัดและบอกเหตุผล', () => {
    const r = buildRiderAuditRow({
      ...baseJob,
      checkpoints: { rider_en_route: { at: 1_756_000_000_000, gps_status: 'denied' } },
    })!;
    expect(r.departure).not.toBeNull();
    expect(r.departure!.point).toBeNull();
    expect(r.departure!.gpsStatus).toBe('denied');
  });

  it('ยอดที่ลูกค้าจ่ายจริงคิดเอง เพราะ DB ไม่มีฟิลด์นี้', () => {
    expect(buildRiderAuditRow(baseJob)!.effectivePickupFee).toBe(100);
  });

  it('ส่วนลดมากกว่าค่าบริการ ต้องไม่ติดลบ', () => {
    const r = buildRiderAuditRow({ ...baseJob, pickup_fee: 50, rider_fee_discount: 80 })!;
    expect(r.effectivePickupFee).toBe(0);
  });

  it('ไม่มี pickup_fee เลย = null ไม่ใช่ 0 (Store-in/Mail-in ต่างจากค่าส่งศูนย์บาท)', () => {
    const { pickup_fee, ...noFee } = baseJob;
    expect(buildRiderAuditRow(noFee)!.effectivePickupFee).toBeNull();
  });

  it('meta ของงานที่ยังไม่ settle ตกไปอ่าน estimate meta', () => {
    const { rider_fee_meta, ...j } = baseJob;
    const r = buildRiderAuditRow({ ...j, rider_fee_estimate_meta: { distance_km: 9.9, reason: 'calculated' } })!;
    expect(r.riderDistanceKm).toBe(9.9);
  });

  it('status legacy ถูก normalize ก่อนใช้ และเก็บค่าดิบไว้ด้วย', () => {
    const r = buildRiderAuditRow({ ...baseJob, status: 'Active Leads' })!;
    expect(r.rawStatus).toBe('Active Leads');
    expect(r.status).toBe(JOB_STATUS.ACTIVE_LEAD);
  });

  it('งานที่ไม่มี id คืน null', () => {
    expect(buildRiderAuditRow({ ref_no: 'x' })).toBeNull();
    expect(buildRiderAuditRow(null)).toBeNull();
  });
});

describe('หมุดที่ใช้วัดจริง', () => {
  const withMeasured = {
    ...baseJob,
    rider_fee_meta: {
      ...baseJob.rider_fee_meta,
      measured_from: { lat: 13.74, lng: 100.53 },
      measured_to: { lat: 13.85, lng: 100.61 },
    },
  };

  it('อ่านหมุดทั้งสองปลายที่ระบบใช้คิดเงิน', () => {
    const r = buildRiderAuditRow(withMeasured)!;
    expect(r.measuredFrom).toEqual({ lat: 13.74, lng: 100.53 });
    expect(r.measuredTo).toEqual({ lat: 13.85, lng: 100.61 });
  });

  it('งานเก่าที่คำนวณก่อนมีฟิลด์นี้ = null ไม่ใช่เดาจาก cust_lat', () => {
    const r = buildRiderAuditRow(baseJob)!;
    expect(r.measuredFrom).toBeNull();
    expect(r.measuredTo).toBeNull();
  });

  it('หมุดครึ่งใบใน meta = null', () => {
    const r = buildRiderAuditRow({
      ...baseJob,
      rider_fee_meta: { ...baseJob.rider_fee_meta, measured_from: { lat: 13.74 } },
    })!;
    expect(r.measuredFrom).toBeNull();
  });

  it('หมุดตรงกับหมุดลูกค้าปัจจุบัน = ไม่มีธง', () => {
    expect(auditFlags(buildRiderAuditRow(withMeasured)!).map((f) => f.code))
      .not.toContain('pin_moved_after_pricing');
  });

  it('หมุดลูกค้าถูกขยับหลังคิดค่ารอบ = ขึ้นธง (เคสที่ใบตรวจนี้มีไว้จับ)', () => {
    const moved = { ...withMeasured, cust_lat: 13.9, cust_lng: 100.7 };
    expect(auditFlags(buildRiderAuditRow(moved)!).map((f) => f.code))
      .toContain('pin_moved_after_pricing');
  });

  it('ขยับนิดเดียวระดับความคลาดเคลื่อน GPS ไม่ขึ้นธง', () => {
    const jitter = { ...withMeasured, cust_lat: 13.7404, cust_lng: 100.5305 };
    expect(auditFlags(buildRiderAuditRow(jitter)!).map((f) => f.code))
      .not.toContain('pin_moved_after_pricing');
  });

  it('ไม่มีหมุดที่ใช้วัด = เทียบไม่ได้ ต้องไม่ขึ้นธงมั่ว', () => {
    expect(auditFlags(buildRiderAuditRow(baseJob)!).map((f) => f.code))
      .not.toContain('pin_moved_after_pricing');
  });
});

describe('การ์ดอัตรา — ฐาน / ต่อ กม. / รวม', () => {
  const rates = { base_fee: 60, per_km: 15, min_fee: 100, max_fee: 500, vehicle: 'motorcycle' };
  const withRates = (over: any = {}) => ({
    ...baseJob,
    rider_fee_meta: { ...baseJob.rider_fee_meta, rates, ...over.meta },
    ...over.job,
  });

  it('แตกการ์ดอัตราออกเป็นคอลัมน์ได้จากข้อมูลที่เก็บอยู่แล้ว', () => {
    const r = buildRiderAuditRow(withRates())!;
    expect(r.rateBase).toBe(60);
    expect(r.ratePerKm).toBe(15);
    expect(r.rateMinFee).toBe(100);
    expect(r.rateMaxFee).toBe(500);
    expect(r.rateVehicle).toBe('motorcycle');
  });

  it('สูตรตรงๆ: 60 + 15 x 12.4 = 246', () => {
    const r = buildRiderAuditRow(withRates({ job: { rider_fee: 246 } }))!;
    expect(r.feeBeforeClamp).toBe(246);
    expect(r.feeRule).toBe('formula');
  });

  it('ต่ำกว่าขั้นต่ำ = min_floor และยอดจริงคือ min_fee ไม่ใช่ผลของสูตร', () => {
    // 60 + 15 x 2 = 90 ซึ่งต่ำกว่า min_fee 100 — ถ้าไม่บอกกฎ คนตรวจจะเห็น
    // ฐาน 60 ต่อกม. 15 ระยะ 2 รวม 100 แล้วนึกว่าบวกเลขผิด
    const r = buildRiderAuditRow(withRates({
      meta: { distance_km: 2 }, job: { rider_fee: 100 },
    }))!;
    expect(r.feeBeforeClamp).toBe(90);
    expect(r.feeRule).toBe('min_floor');
    expect(r.settledFee).toBe(100);
  });

  it('เกินเพดาน = max_cap', () => {
    const r = buildRiderAuditRow(withRates({
      meta: { distance_km: 100 }, job: { rider_fee: 500 },
    }))!;
    expect(r.feeBeforeClamp).toBe(1560);
    expect(r.feeRule).toBe('max_cap');
  });

  it('วัดระยะไม่ได้ = no_distance ไม่ใช่ฐานเปล่าๆ', () => {
    const r = buildRiderAuditRow(withRates({
      meta: { distance_km: null }, job: { rider_fee: 100 },
    }))!;
    expect(r.feeBeforeClamp).toBeNull();
    expect(r.feeRule).toBe('no_distance');
  });

  it('งานเก่าที่ไม่มีการ์ดอัตราเก็บไว้ = unknown ไม่ใช่เดาจากค่าปัจจุบัน', () => {
    const r = buildRiderAuditRow(baseJob)!;
    expect(r.rateBase).toBeNull();
    expect(r.feeRule).toBe('unknown');
  });

  it('ไม่มีการ์ดอัตรา ต้องไม่ขึ้นธง "ยอดไม่ตรง" — ไม่งั้นงานเก่าติดธงยกแผง', () => {
    expect(auditFlags(buildRiderAuditRow(baseJob)!).map((f) => f.code))
      .not.toContain('fee_unexplained');
  });

  it('ยอดจริงไม่ตรงกับสูตร = ไม่รายงานว่า formula และขึ้นธง', () => {
    // อัตราถูกแก้หลังคิดเงินไปแล้ว หรือยอดมาจากทางอื่น
    const r = buildRiderAuditRow(withRates({ job: { rider_fee: 999 } }))!;
    expect(r.feeRule).toBe('unknown');
    expect(auditFlags(r).map((f) => f.code)).toContain('fee_unexplained');
  });

  it('ค่าเสียเวลาที่มี breakdown อยู่แล้ว ไม่ต้องขึ้นธงซ้ำ', () => {
    const r = buildRiderAuditRow(withRates({
      job: { rider_fee: 40, rider_fee_breakdown: { type: 'time_loss_customer_cancel' } },
    }))!;
    const codes = auditFlags(r).map((f) => f.code);
    expect(codes).toContain('fee_not_from_distance');
    expect(codes).not.toContain('fee_unexplained');
  });

  it('อัตราของยานพาหนะที่ต่างกันอ่านออกจากแถว ไม่ต้องเดา', () => {
    const car = buildRiderAuditRow(withRates({
      meta: { rates: { ...rates, base_fee: 120, per_km: 25, vehicle: 'car' } },
    }))!;
    expect(car.rateVehicle).toBe('car');
    expect(car.rateBase).toBe(120);
  });
});

describe('riderIdFromCancelledBy', () => {
  it('อ่าน id กลับจากรูป rider:{id}', () => {
    expect(riderIdFromCancelledBy('rider:r9')).toBe('r9');
  });
  it('ลูกค้ายกเลิก หรือรูปอื่น คืน null ไม่เดา', () => {
    expect(riderIdFromCancelledBy('customer')).toBeNull();
    expect(riderIdFromCancelledBy('rider:')).toBeNull();
    expect(riderIdFromCancelledBy(null)).toBeNull();
  });
});

describe('involvesRider — งานที่ไรเดอร์ยกเลิกต้องไม่หายจากใบตรวจ', () => {
  it('มี rider_id = เข้าข่าย', () => {
    expect(involvesRider(baseJob)).toBe(true);
  });

  it('ไรเดอร์ยกเลิกแล้ว rider_id ถูกล้าง แต่ยังต้องอยู่ในใบตรวจ', () => {
    // เคสจริง: useJobActions เขียน rider_id: null เสมอตอนไรเดอร์ยกเลิก
    const cancelled = { ...baseJob, rider_id: null, cancelled_by: 'rider:r1', status: 'Following Up' };
    expect(involvesRider(cancelled)).toBe(true);
    expect(buildRiderAuditRow(cancelled)!.riderIdFromCancel).toBe('r1');
  });

  it('มีแค่ checkpoint ก็พอ (ออกเดินทางแล้วแต่ข้อมูลอื่นหาย)', () => {
    expect(involvesRider({ checkpoints: { rider_en_route: { at: 1 } } })).toBe(true);
  });

  it('มีค่ารอบค้างอยู่ก็เข้าข่าย แม้ rider_id หาย', () => {
    expect(involvesRider({ rider_fee: 80 })).toBe(true);
  });

  it('งานที่ไรเดอร์ไม่เคยแตะ = ไม่เข้าข่าย', () => {
    expect(involvesRider({ id: 'x', receive_method: 'Mail-in' })).toBe(false);
    expect(involvesRider({})).toBe(false);
  });
});

describe('auditFlags — บอกว่าระบบตอบอะไรไม่ได้ ไม่ใช่ตัดสินว่าใครผิด', () => {
  it('งานปกติไม่มีธง', () => {
    expect(auditFlags(buildRiderAuditRow(baseJob)!)).toEqual([]);
  });

  it('ไม่มีค่ารอบที่ประทับ = ธง', () => {
    const { rider_fee, ...j } = baseJob;
    expect(auditFlags(buildRiderAuditRow(j)!).map((f) => f.code)).toContain('no_settled_fee');
  });

  it('งานที่ยกเลิกไม่ควรถูกทวงค่ารอบ', () => {
    const { rider_fee, ...j } = baseJob;
    const codes = auditFlags(buildRiderAuditRow({ ...j, status: 'Cancelled' })!).map((f) => f.code);
    expect(codes).not.toContain('no_settled_fee');
  });

  it('วัดระยะไม่ได้ = ธง', () => {
    const r = buildRiderAuditRow({ ...baseJob, rider_fee_meta: { reason: 'routes_api_403' } })!;
    expect(auditFlags(r).map((f) => f.code)).toContain('no_distance');
  });

  it('GPS ล้มตอนออกเดินทาง = ธงที่บอกเหตุผลด้วย', () => {
    const r = buildRiderAuditRow({
      ...baseJob,
      checkpoints: { rider_en_route: { at: 1, gps_status: 'denied' } },
    })!;
    const flag = auditFlags(r).find((f) => f.code === 'no_departure_gps');
    expect(flag?.label).toContain('denied');
  });

  it('ค่ารอบที่ไม่ได้มาจากระยะทางต้องขึ้นธง ไม่งั้นแอดมินไล่หาความผิดที่ไม่มี', () => {
    const r = buildRiderAuditRow({
      ...baseJob,
      rider_fee_breakdown: { type: 'time_loss_customer_cancel' },
    })!;
    const flag = auditFlags(r).find((f) => f.code === 'fee_not_from_distance');
    expect(flag?.label).toContain('time_loss_customer_cancel');
  });

  it('งาน Pickup ที่ไม่มีหมุดลูกค้า = ธง แต่ Store-in ไม่ใช่', () => {
    const { cust_lat, cust_lng, ...j } = baseJob;
    expect(auditFlags(buildRiderAuditRow(j)!).map((f) => f.code)).toContain('no_customer_pin');
    expect(
      auditFlags(buildRiderAuditRow({ ...j, receive_method: 'Store-in' })!).map((f) => f.code),
    ).not.toContain('no_customer_pin');
  });

  it('งานที่หลุดจากไรเดอร์แล้วขึ้นธงบอก', () => {
    const r = buildRiderAuditRow({ ...baseJob, rider_id: null, cancelled_by: 'rider:r1' })!;
    expect(auditFlags(r).map((f) => f.code)).toContain('rider_detached');
  });
});
