// src/utils/dispatchPins.ts — อ่านหมุดของงานและของไรเดอร์สำหรับหน้าจ่ายงาน (pure)
//
// แยกออกจาก DispatcherPage.tsx เพื่อให้เทสได้โดยไม่ต้องโหลด Google Maps

// หมุดจุดรับเครื่องของงาน — ของจริงจาก jobs/{id} เท่านั้น, null เมื่อไม่มี
//
// เดิมฟังก์ชันนี้ชื่อ getJobCoordinates และ **สังเคราะห์พิกัดจาก hash ของ job id**
// ลงในกรอบสี่เหลี่ยมรอบกรุงเทพ ผลคือหน้าจ่ายงานปักหมุดงานในตำแหน่งที่ไม่มีอยู่จริง
// แล้วเอาตำแหน่งนั้นไปเรียงไรเดอร์ตาม "ระยะทาง" — เลขกิโลเมตรกับ ETA ที่แอดมิน
// เห็นตอนเลือกคนวิ่งจึงเป็นของจุดที่ถูกสุ่มมาจากตัวอักษรใน id ไม่ใช่ของลูกค้า
// (พิกัดคงที่ต่อ id ทำให้มันดูน่าเชื่อถือ ไม่กระพริบ ไม่มีอะไรบอกว่าผิด)
//
// ลำดับ fallback มิเรอร์ resolveCustomerCoords ใน bkk-system/functions/index.js
// เพื่อให้แอดมินเห็นหมุดตัวเดียวกับที่ computeRiderFee ใช้คิดเงิน —
// **แก้ที่นั่นต้องแก้ที่นี่ด้วย**
export const jobPin = (job: any): { lat: number; lng: number } | null => {
  if (!job) return null;
  const candidates: Array<[unknown, unknown]> = [
    [job.cust_lat, job.cust_lng],
    [job.customer_lat, job.customer_lng],
    [job.pickup_lat, job.pickup_lng],
    [job.pickup_location?.lat, job.pickup_location?.lng],
  ];
  for (const [lat, lng] of candidates) {
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  return null;
};

// ตำแหน่งล่าสุดของไรเดอร์ — null เมื่อยังไม่เคยรายงาน
//
// เดิมเขียน `Number(rider.lat) || 13.75` / `|| 100.50` ซึ่งเป็นการสังเคราะห์
// แบบเดียวกัน: ไรเดอร์ที่ยังไม่เคยเปิด GPS จะถูกวางไว้กลางกรุงเทพแล้วเข้าคิว
// เรียงระยะทางเหมือนคนที่รายงานตำแหน่งจริง — ซึ่งทำให้เขาชนะการจัดอันดับได้
// ทั้งที่ไม่มีใครรู้ว่าเขาอยู่ไหน
export const riderPin = (rider: any): { lat: number; lng: number } | null => {
  const lat = Number(rider?.lat);
  const lng = Number(rider?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
    ? { lat, lng }
    : null;
};
