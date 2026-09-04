// Firebase project เดียวกับระบบหลัก — config มาจาก GitHub Secrets ชุด
// VITE_FIREBASE_* เดิมตอน build ใน CI (เหมือน dealer-portal)
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// **ไม่ import getDatabase** โดยตั้งใจ — แอปนี้ไม่อ่าน RTDB ตรงเลยสักโหนด
// ทุกอย่างผ่าน callable ที่ตัดสินสิทธิ์ฝั่ง server (โหนด `attendance` /
// `shift_roster` ปิดสนิทตามกฎ root อยู่แล้ว)
export const functions = getFunctions(app, 'asia-southeast1');
