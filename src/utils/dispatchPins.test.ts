// เทสของ jobPin / riderPin — เขียนจากรูปข้อมูลจริงบน jobs/{id} และ riders/{id}
//
// ด่านที่ชุดนี้ตรึงไว้คือ "ห้ามสังเคราะห์พิกัด": ของเดิมปั้นพิกัดงานจาก hash ของ
// job id และปั้นพิกัดไรเดอร์เป็นกลางกรุงเทพเมื่อไม่มีค่า ทั้งสองอย่างทำให้
// หน้าจ่ายงานเรียงไรเดอร์ตามระยะทางที่ไม่มีอยู่จริง — ถ้าใครใส่ค่า fallback
// กลับเข้ามา เคส "ไม่มีหมุด = null" จะแดงทันที
import { describe, it, expect } from 'vitest';
import { jobPin, riderPin } from './dispatchPins';

describe('jobPin', () => {
  it('อ่าน cust_lat/cust_lng ที่ checkout เขียนไว้', () => {
    expect(jobPin({ cust_lat: 13.7563, cust_lng: 100.5018 }))
      .toEqual({ lat: 13.7563, lng: 100.5018 });
  });

  it('รองรับชื่อฟิลด์สำรองตามลำดับเดียวกับ resolveCustomerCoords ฝั่ง functions', () => {
    expect(jobPin({ customer_lat: 13.1, customer_lng: 100.1 })).toEqual({ lat: 13.1, lng: 100.1 });
    expect(jobPin({ pickup_lat: 13.2, pickup_lng: 100.2 })).toEqual({ lat: 13.2, lng: 100.2 });
    expect(jobPin({ pickup_location: { lat: 13.3, lng: 100.3 } })).toEqual({ lat: 13.3, lng: 100.3 });
  });

  it('cust_lat มาก่อนฟิลด์สำรอง', () => {
    expect(jobPin({ cust_lat: 13.9, cust_lng: 100.9, pickup_lat: 13.1, pickup_lng: 100.1 }))
      .toEqual({ lat: 13.9, lng: 100.9 });
  });

  it('ไม่มีหมุด = null ห้ามสังเคราะห์จาก id', () => {
    // งานที่แอดมินสร้างเอง (TradeInDashboard / InstantSellModal) ไม่เคยเขียน
    // cust_lat เลย และงานที่สลับออกจาก Pickup ถูกล้างหมุดเป็น null โดยตั้งใจ
    expect(jobPin({ id: 'abc123', model: 'iPhone 15' })).toBeNull();
    expect(jobPin({ cust_lat: null, cust_lng: null })).toBeNull();
    expect(jobPin(null)).toBeNull();
    expect(jobPin(undefined)).toBeNull();
  });

  it('หมุดครึ่งใบ (มี lat ไม่มี lng) ไม่นับเป็นหมุด', () => {
    expect(jobPin({ cust_lat: 13.75 })).toBeNull();
    expect(jobPin({ cust_lng: 100.5 })).toBeNull();
  });

  it('ค่าที่เป็นสตริงไม่ถูกตีความเป็นพิกัด', () => {
    // RTDB คืนตัวเลขเป็น number อยู่แล้ว สตริงที่หลุดมาแปลว่าข้อมูลผิดรูป
    // ซึ่งไม่ควรถูกเดาว่าเป็นพิกัดที่ใช้นำทางได้
    expect(jobPin({ cust_lat: '13.75', cust_lng: '100.5' })).toBeNull();
  });
});

describe('riderPin', () => {
  it('อ่านตำแหน่งล่าสุดที่แอปไรเดอร์เขียนไว้', () => {
    expect(riderPin({ lat: 13.8, lng: 100.6 })).toEqual({ lat: 13.8, lng: 100.6 });
  });

  it('ยังไม่เคยรายงานตำแหน่ง = null ไม่ใช่กลางกรุงเทพ', () => {
    expect(riderPin({})).toBeNull();
    expect(riderPin({ lat: null, lng: null })).toBeNull();
    expect(riderPin(null)).toBeNull();
  });

  it('0,0 ไม่ใช่ตำแหน่ง — เป็นค่าเริ่มต้นที่หลุดมา ไม่ใช่กลางมหาสมุทร', () => {
    expect(riderPin({ lat: 0, lng: 0 })).toBeNull();
  });

  it('ค่าที่มีจริงฝั่งเดียวไม่นับ', () => {
    expect(riderPin({ lat: 13.8 })).toBeNull();
  });
});
