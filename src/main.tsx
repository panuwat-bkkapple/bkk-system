import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installStaleBuildRecovery } from './utils/staleBuildReload'

// Chunk ของ build เก่าหายหลัง deploy — กู้คืนด้วยการโหลดหน้าใหม่
//
// ตัวนี้ดักได้เฉพาะกรณีที่ Vite preload dependency ไม่สำเร็จ. กรณีที่
// `import()` ตัวหลักได้ 404 ตรงๆ เบราว์เซอร์ throw เข้า React.lazy โดยไม่ยิง
// event นี้เลย — ชั้นนั้นดักที่ ErrorBoundary ซึ่งใช้ helper และ cooldown
// ตัวเดียวกัน จึงไม่มีทางที่สองชั้นจะสั่ง reload ซ้อนกันเป็นสองรอบ
installStaleBuildRecovery();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
