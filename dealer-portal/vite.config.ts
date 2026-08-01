import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dealer Portal — แอปแยกของ bounded context ขายส่ง (dealer.bkkapple.com)
// กฎ: ห้าม import จาก ../src (แอปแอดมิน) — ตัดออกเป็น repo แยกได้ทุกเมื่อ
export default defineConfig({
  plugins: [react()],
});
