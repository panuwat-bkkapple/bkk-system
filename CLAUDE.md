# CLAUDE.md - Project Context for Claude Code

## Project Overview
- **Project:** BKK System (Admin Panel สำหรับธุรกิจ Trade-in มือถือ)
- **Stack:** Vite + React 19 + TypeScript + Firebase (Realtime DB, Auth, Storage, FCM)
- **Repo:** panuwat-bkkapple/bkk-system
- **Branch:** main

## Related Repos (ห้ามแก้ไข repos อื่น)
- **bkk-frontend-next** — เว็บฝั่งลูกค้า (customer tracking, คนละระบบ)
- **BKK Rider** — แอป PWA สำหรับ rider (มีระบบ push notification แยกต่างหาก)

## Deployment
- **Platform:** Firebase Hosting (`bkk-apple-admin.web.app`)
- **CI/CD:** GitHub Actions (auto deploy on push to main)
- **Build:** ใช้ **GitHub Secrets** (ไม่ใช่ `.env` file) — ดู `.github/workflows/firebase-hosting-deploy.yml`
- **Cloud Functions:** Deploy พร้อม Hosting ใน workflow เดียวกัน (region: asia-southeast1)
- **ต้องเช็ค GitHub Actions ผ่านก่อนบอกให้ user เทส** — ถ้า workflow fail = โค้ดใหม่ยังไม่ขึ้น
- **Secrets ที่ต้องมี:** VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_VAPID_KEY, VITE_GOOGLE_MAPS_API_KEY, FIREBASE_SERVICE_ACCOUNT_BKK_APPLE_TRADEIN

## Mobile App (PWA)
- **URL:** `bkk-apple-admin.web.app/mobile`
- **ใช้งานบน iOS** ผ่าน Add to Home Screen (PWA standalone mode)
- **Push Notification:** ใช้ Firebase Cloud Messaging (FCM) + Service Worker (`firebase-messaging-sw.js`)
- **iOS Push:** ต้อง Add to Home Screen + Grant permission จาก PWA context
- **VAPID Key:** ต้องตั้งค่าใน GitHub Secrets (ไม่ใช่แค่ .env)

## Firebase Database Paths
- **`jobs/`** — ข้อมูล ticket/job ทั้งหมด
- **`jobs_archived/`** — งานเก่าที่ archive แล้ว (>90 วัน)
- **`admin_fcm_tokens/{staffId}/{tokenKey}`** — FCM tokens ของ admin สำหรับ push notification
- **`riders/{riderId}/fcm_token`** — FCM token ของ rider
- **`inbox/`** — ข้อความ inbox (unreadCount)
- **`models/`** — ข้อมูลรุ่นสินค้า (PriceEditor)
- **`series/`** — series ของสินค้า
- **`staff/`** — ข้อมูลพนักงาน (role, email, status)
- **`settings/condition_sets/`** — ชุดเงื่อนไขสำหรับประเมินราคา

## Key Architecture
- **Admin Layout:** `/src/components/layout/AdminLayout.tsx` (desktop sidebar)
- **Mobile Layout:** `/src/pages/mobile/MobileLayout.tsx` (bottom tab bar)
- **Routes:** `/src/App.tsx` (React Router v7)
- **Cloud Functions:** `/functions/index.js` (new ticket, chat, status change notifications)
- **Push Hook:** `/src/hooks/useAdminPushNotifications.ts`
- **Service Worker:** `/public/firebase-messaging-sw.js` (hardcoded Firebase config ไม่ใช้ env)
- **Ticket Creation:** `/src/features/trade-in/TradeInDashboard.tsx`
- **Instant Sell:** `/src/features/trade-in/components/InstantSellModal.tsx`
- **PriceEditor:** `/src/features/trade-in/PriceEditor.tsx`
- **Desktop Notifications:** `/src/components/layout/NotificationCenter.tsx`
- **Mobile Notifications:** `/src/pages/mobile/MobileNotificationsPage.tsx`

## Job/Ticket Statuses
- **B2C Normal:** สร้างด้วย status `"New Lead"`
- **Instant Sell:** สร้างด้วย status `"Active Leads"` (ข้ามขั้นตอนขาย)
- **B2B:** สร้างด้วย status `"New B2B Lead"`
- **B2B Unpacked:** child items สร้างด้วย status `"Pending QC"`
- **Notification triggers ต้องครอบคลุมทั้ง 3 status (New Lead, Active Leads, New B2B Lead)**

## Cloud Functions (Push Notification Triggers)
- **`onNewTicketCreated`** — trigger เมื่อสร้าง job ใหม่ → ส่ง push ให้ admin ทุกคน
- **`onChatMessageCreated`** — trigger เมื่อมีแชทใหม่ → ส่ง push ให้ admin หรือ rider
- **`onJobStatusChanged`** — trigger เมื่อ status เปลี่ยน (Cancelled, Returned, Negotiation ฯลฯ) → ส่ง push ให้ admin

## Role-Based Access
- **CEO:** เข้าถึงทุกฟีเจอร์
- **MANAGER:** เข้าถึงเกือบทุกฟีเจอร์ (ยกเว้น Staff Management, Global Settings)
- **STAFF:** เข้าถึงฟีเจอร์พื้นฐาน
- **FINANCE:** เข้าถึง Finance, Daily Expenses

## Known Issues & Workarounds
- **VAPID Key + atob():** Firebase SDK ใช้ `atob()` ภายใน `getToken()` ซึ่ง fail กับ base64url ไม่มี padding → ต้อง patch `window.atob` ชั่วคราว (ดู `useAdminPushNotifications.ts`)
- **Service Worker Config:** `firebase-messaging-sw.js` ใช้ Firebase config แบบ hardcode (ไม่ใช่ env vars) — ถ้าเปลี่ยน Firebase project ต้องแก้ไฟล์นี้ด้วย

## Important Notes
- ก่อน push ให้ตรวจสอบว่า TypeScript compile ผ่าน (`tsc --noEmit`)
- ถ้าแก้ Cloud Functions ต้องรอ GitHub Actions deploy functions ด้วย (ไม่ใช่แค่ hosting)
- เทสบน Chrome DevTools ≠ เทสบน iPhone จริง (โดยเฉพาะ push notification)
- iOS PWA มีข้อจำกัดเรื่อง service worker และ push ที่ต่างจาก Android/Chrome
- ถ้าลองแก้ปัญหาเดิม 2 ครั้งแล้วไม่สำเร็จ → หยุดวิเคราะห์ root cause ให้ลึกก่อน อย่าแก้วน
