import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// แอปพนักงาน — PWA แยกของ bounded context "คนทำงาน" (ลงเวลา ใบลา เปลี่ยนกะ)
//
// กฎเดียวกับ dealer-portal: **ห้าม import จาก ../src (แอปแอดมิน)** — ตัดออกไป
// เป็น repo แยกได้ทุกเมื่อ. ข้อยกเว้นทางเดียวคือ vitest ของรีโปหลักถูกตั้งให้
// เก็บไฟล์เทสในโฟลเดอร์นี้ด้วย (ดูหมายเหตุใน vitest.config.ts) — **เทสข้ามเข้ามา
// ได้ โค้ดข้ามออกไปไม่ได้**
export default defineConfig({
  plugins: [react()],
});
