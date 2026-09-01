// เทสเขียนจากเคสจริง OID-MTHBWFJJ-384 (31 ส.ค. 2569) ไม่ใช่จาก spec —
// งานใบนั้นถูกอนุมัติคำแย้งไปแล้วทั้งที่หมุดลูกค้าถูกต้อง เพราะไม่มีอะไร
// วางหลักฐานที่ค้านไว้ตรงหน้าคนกดอนุมัติ
import { describe, it, expect } from 'vitest';
import { needsAcknowledgement, pinDisputeSignals, distanceMeters } from './pinDisputeSignals';

// พิกัดจริงของเคสนั้น
const PIN = { lat: 13.712840, lng: 100.431539 };          // หมุดลูกค้า (ศุภาลัย ลอฟท์ ภาษีเจริญ)
const GEO = { lat: 13.7129, lng: 100.4315 };              // geocode ที่อยู่ที่ลูกค้าพิมพ์
const CHECKIN = { lat: 13.798736171172097, lng: 100.49613429052745 }; // จุดที่กดปุ่ม (กลางทางขากลับ)
const T = 1788191373277;

const realCase = {
  cust_lat: PIN.lat, cust_lng: PIN.lng,
  cust_address_geocoded_lat: GEO.lat, cust_address_geocoded_lng: GEO.lng,
  checkpoints: {
    rider_en_route: { at: T - 63 * 60000 },
    rider_arrived: { at: T, lat: CHECKIN.lat, lng: CHECKIN.lng, distance_m: 11828 },
    customer_left: { at: T + 1000 },
    branch_handover: { at: T + 2000 },
  },
};

describe('เคสจริง OID-MTHBWFJJ-384', () => {
  it('ระยะหมุด↔จุดเช็คอิน ตรงกับที่ระบบบันทึกไว้ 11,828 ม.', () => {
    const d = distanceMeters(PIN.lat, PIN.lng, CHECKIN.lat, CHECKIN.lng);
    expect(Math.abs(d - 11828)).toBeLessThan(50);
  });

  it('ต้องขึ้นทั้งสองสัญญาณ และต้องบังคับให้แอดมินยืนยันก่อนอนุมัติ', () => {
    const ids = pinDisputeSignals(realCase).map((s) => s.id);
    expect(ids).toContain('pin_matches_address');
    expect(ids).toContain('burst_checkin');
    expect(needsAcknowledgement(realCase)).toBe(true);
  });
});

describe('เคสหมุดผิดจริง — ต้องไม่เตือนมั่ว', () => {
  const wrongPin = {
    cust_lat: 13.9, cust_lng: 100.6,                        // หมุดอยู่คนละที่กับที่อยู่
    cust_address_geocoded_lat: GEO.lat, cust_address_geocoded_lng: GEO.lng,
    checkpoints: {
      rider_arrived: { at: T },
      customer_left: { at: T + 20 * 60000 },                 // อยู่หน้างาน 20 นาที
      branch_handover: { at: T + 55 * 60000 },
    },
  };
  it('หมุดไม่ตรงที่อยู่ + เช็คอินห่างกันจริง = ไม่มีสัญญาณค้าน', () => {
    expect(pinDisputeSignals(wrongPin)).toHaveLength(0);
    expect(needsAcknowledgement(wrongPin)).toBe(false);
  });
});

describe('ข้อมูลไม่ครบ', () => {
  it('ไม่มี geocode = ไม่เดา (ไม่ขึ้นสัญญาณหมุดตรง)', () => {
    const ids = pinDisputeSignals({ cust_lat: PIN.lat, cust_lng: PIN.lng, checkpoints: { rider_arrived: { at: T } } }).map((s) => s.id);
    expect(ids).not.toContain('pin_matches_address');
  });
  it('เช็คอินจุดเดียว = ไม่ใช่การกดรวด', () => {
    const ids = pinDisputeSignals({ checkpoints: { rider_arrived: { at: T } } }).map((s) => s.id);
    expect(ids).not.toContain('burst_checkin');
  });
  it('at เป็น null ต้องไม่กลายเป็น 0 แล้วนับเป็นกดรวด', () => {
    const ids = pinDisputeSignals({ checkpoints: { rider_arrived: { at: null }, customer_left: { at: null } } }).map((s) => s.id);
    expect(ids).not.toContain('burst_checkin');
  });
  it('งานเปล่า = ไม่มีสัญญาณ ไม่ throw', () => {
    expect(pinDisputeSignals({})).toEqual([]);
    expect(pinDisputeSignals(null)).toEqual([]);
  });
});
