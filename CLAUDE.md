# CLAUDE.md - Project Context for Claude Code

## Project Overview
- **Project:** BKK System (Admin Panel สำหรับธุรกิจ Trade-in มือถือ)
- **Stack:** Vite + React 19 + TypeScript + Firebase (Realtime DB, Auth, Storage, FCM)
- **Repo:** panuwat-bkkapple/bkk-system
- **Branch:** main

## Deployment
- **Platform:** Firebase Hosting (`bkk-apple-admin.web.app`)
- **CI/CD:** GitHub Actions (auto deploy on push to main)
- **Build:** ใช้ **GitHub Secrets** (ไม่ใช่ `.env` file) — ดู `.github/workflows/firebase-hosting-deploy.yml`
- **Cloud Functions:** Deploy พร้อม Hosting ใน workflow เดียวกัน (region: asia-southeast1)
- **Secrets ที่ต้องมี:** VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_VAPID_KEY, VITE_GOOGLE_MAPS_API_KEY, FIREBASE_SERVICE_ACCOUNT_BKK_APPLE_TRADEIN

## Mobile App (PWA)
- **URL:** `bkk-apple-admin.web.app/mobile`
- **ใช้งานบน iOS** ผ่าน Add to Home Screen (PWA standalone mode)
- **Push Notification:** ใช้ Firebase Cloud Messaging (FCM) + Service Worker (`firebase-messaging-sw.js`)
- **iOS Push:** ต้อง Add to Home Screen + Grant permission จาก PWA context
- **VAPID Key:** ต้องตั้งค่าใน GitHub Secrets (ไม่ใช่แค่ .env)

## Key Architecture
- **Admin Layout:** `/src/components/layout/AdminLayout.tsx` (desktop sidebar)
- **Mobile Layout:** `/src/pages/mobile/MobileLayout.tsx` (bottom tab bar)
- **Routes:** `/src/App.tsx` (React Router v7)
- **Cloud Functions:** `/functions/index.js` (new ticket, chat, status change notifications)
- **Push Hook:** `/src/hooks/useAdminPushNotifications.ts`
- **Service Worker:** `/public/firebase-messaging-sw.js`

## Job/Ticket Statuses
- **B2C Normal:** สร้างด้วย status `"New Lead"`
- **Instant Sell:** สร้างด้วย status `"Active Leads"` (ข้ามขั้นตอนขาย)
- **B2B:** สร้างด้วย status `"New B2B Lead"`
- **Notification triggers ต้องครอบคลุมทั้ง 3 status**

## Role-Based Access
- **CEO:** เข้าถึงทุกฟีเจอร์
- **MANAGER:** เข้าถึงเกือบทุกฟีเจอร์ (ยกเว้น Staff Management, Global Settings)
- **STAFF:** เข้าถึงฟีเจอร์พื้นฐาน
- **FINANCE:** เข้าถึง Finance, Daily Expenses

## Important Notes
- ก่อน push ให้ตรวจสอบว่า TypeScript compile ผ่าน (`tsc --noEmit`)
- ถ้าแก้ Cloud Functions ต้องรอ GitHub Actions deploy functions ด้วย (ไม่ใช่แค่ hosting)
- เทสบน Chrome DevTools ≠ เทสบน iPhone จริง (โดยเฉพาะ push notification)
- iOS PWA มีข้อจำกัดเรื่อง service worker และ push ที่ต่างจาก Android/Chrome
