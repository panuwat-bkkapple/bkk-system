import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Service worker มีไว้ให้ติดตั้งเป็นแอปบนหน้าจอโฮมได้ (PWA) — **ไม่ได้แคช
// ข้อมูล** โดยตั้งใจ: แอปนี้ทั้งแอปคือ "ตอนนี้อยู่ที่ไหน สถานะวันนี้เป็นยังไง"
// การเสิร์ฟหน้าเก่าจากแคชคือการโกหกเรื่องที่สำคัญที่สุดของมัน
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ติดตั้งไม่ได้ = ใช้เป็นเว็บปกติ */ });
  });
}
