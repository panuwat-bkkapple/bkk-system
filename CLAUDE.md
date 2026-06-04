# CLAUDE.md - Project Context for Claude Code

## Project Overview
- **Project:** BKK System (Admin Panel สำหรับธุรกิจ Trade-in มือถือ)
- **Stack:** Vite + React 19 + TypeScript + Firebase (Realtime DB, Auth, Storage, FCM)
- **Repo:** panuwat-bkkapple/bkk-system
- **Branch:** main

## Related Repos (ห้ามแก้ไข repos อื่น)
- **bkk-frontend-next** — เว็บฝั่งลูกค้า (customer tracking, คนละระบบ)
  - **CANONICAL SOURCE FOR FIREBASE RULES**: `database.rules.json` และ `storage.rules` อยู่ใน repo นั้น repo เดียว — ห้าม recreate ใน repo นี้. ถ้าต้องแก้ rules ต้องไปแก้ที่ bkk-frontend-next แล้วรัน `firebase deploy --only database` หรือ `--only storage` จาก repo นั้น
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
- **`onAdminJobStatusNotify`** — trigger เมื่อ status เปลี่ยน (Cancelled, Returned, Negotiation ฯลฯ) → ส่ง push ให้ admin. **ห้ามตั้งชื่อชนกับ rider-notifications codebase** (เช่น `onJobStatusChanged`) เพราะ Firebase Cloud Functions identify ด้วย `{region}/{name}` ระดับ project — codebase แค่จัด deploy group ไม่ namespace name → deploy ของ codebase หนึ่งจะทับอีกฝั่งและ rider/admin notification จะหายสลับกันทุกครั้งที่ฝั่งใดฝั่งหนึ่ง deploy
- **`onPickupScheduleRescheduled`** — trigger เมื่อ `jobs/{id}/pickup_schedule` ที่มีนัดอยู่แล้วถูกเปลี่ยน (admin เลื่อนนัด Pickup/Store-in/Mail-in) → (1) push ให้ไรเดอร์ที่ถืองาน (`job.rider_id`) ผ่าน `pushToRider` (2) เขียน event ลง `outbox_emails/{pushId}` (status `pending`, type `appointment_rescheduled`) ให้ Resend worker (ทำแยกอีก section) ดึงไปส่งเมลลูกค้า. การ "set นัดครั้งแรก" จะไม่ trigger (เช็ค before ต้องมี date จริงก่อน). ชื่อ function ห้ามตั้งทั่วไป (เช่น `onJobUpdated`) ด้วยเหตุผล namespace เดียวกับด้านบน
- **`onReceiveMethodChanged`** — trigger เมื่อ `jobs/{id}/receive_method` ถูกเปลี่ยน (admin เปลี่ยน trade method) → เป็น **เจ้าของการคำนวณเงินฝั่ง server**: ถ้าเปลี่ยนเป็น Pickup จะ `computeRiderFee` แล้วเซ็ต `pickup_fee` + `rider_fee_estimate` และคิด `net_payout` ใหม่ (รวมค่าไรเดอร์), ถ้าเป็น Store-in/Mail-in จะเซ็ต `pickup_fee=0` และคิด `net_payout` ใหม่ (ไม่หักค่าไรเดอร์). ถ้าเดิมเป็น Pickup และมีไรเดอร์ถืออยู่ (`rider_id`) จะถอนงาน (push แจ้งไรเดอร์ + เคลียร์ `rider_id` + ดึง status กลับ `Following Up`). client เขียนแค่ `receive_method` + ฟิลด์สถานที่ + qc_log เท่านั้น ไม่แตะเงิน. ชื่อห้ามตั้งทั่วไป (เช่น `onJobUpdated`) ด้วยเหตุผล namespace เดียวกัน
- **`onPickupLocationChanged`** — trigger เมื่อ `jobs/{id}/cust_lat` เปลี่ยน (admin ปรับจุดรับเครื่องของงาน Pickup) → `computeRiderFee` ใหม่จากระยะทางใหม่ แล้วเซ็ต `pickup_fee` + `rider_fee_estimate` + `net_payout` อัตโนมัติ, และถ้ามีไรเดอร์ถืองานอยู่ (`rider_id`) จะ push แจ้ง "จุดรับเครื่องเปลี่ยน". **สำคัญ:** ไรเดอร์นำทางด้วย `cust_lat/cust_lng` (ดู `bkk-rider-app` `useJobActions.handleOpenNavigation`) และจะ**ไม่สนใจที่อยู่ข้อความเมื่อมีหมุด** — ห้ามแก้ `cust_address` แล้วปล่อยหมุดเก่าค้าง (ไรเดอร์จะวิ่งผิดที่). ชื่อห้ามตั้งทั่วไปด้วยเหตุผล namespace เดียวกัน

## Appointment / pickup_schedule (เลื่อนนัด)
- **`pickup_schedule`** ใช้ร่วมกันทุก receive_method เก็บ `{ type, date, time, time_start, time_end, rescheduled_at? }`
  - `time` = string รวมช่วงเวลา (`"12:00 - 14:00"`) เก็บไว้เพื่อ backward-compat กับตัวอ่านเดิม (calendar, customer tracking, ticket detail อ่าน `.time` ตรงๆ)
  - `time_start` / `time_end` = ช่วงเวลาแบบ structured (`time_end` ไม่บังคับ)
  - helper รวมอยู่ที่ `src/utils/appointment.ts` (`parseTimeRange`, `buildPickupSchedule`, `existingApptDate`) — ใช้ทั้ง mobile (`MobileTicketDetail` edit modal) และ desktop (`PricingSidebar`)
- **UI เลื่อนนัด:** mobile = โมดอล "แก้ไขข้อมูลงาน" ใน `MobileTicketDetail.tsx`; desktop = scheduler ใน `PricingSidebar.tsx` (มีครบทั้ง Pickup / Store-in / Mail-in)

## เปลี่ยน Trade Method (receive_method) หลังสร้างงาน
- เปลี่ยนได้ทุกทิศทาง (Pickup ⇄ Store-in ⇄ Mail-in). helper อยู่ที่ `src/utils/receiveMethod.ts` (`canChangeReceiveMethod`, `locationLabel`, `currentLocation`, `buildMethodLocationFields`)
- **client เขียนแค่ `receive_method` + ฟิลด์สถานที่ (`cust_address`/`store_branch`) + qc_log** — เรื่องเงิน (pickup_fee/net_payout) และการถอนไรเดอร์ให้ `onReceiveMethodChanged` (cloud function) จัดการ เพื่อให้ค่าไรเดอร์ใช้ `computeRiderFee` ที่เดียว
- `canChangeReceiveMethod` block เมื่อเครื่องอยู่ในมือ/จ่ายเงินแล้ว/พัสดุส่งแล้ว/ปิดงาน (เช็ค status) — UI ทั้ง mobile + desktop ใช้ guard เดียวกัน
- UI: mobile = ตัวเลือกในโมดอล "แก้ไขข้อมูลงาน"; desktop = section "Trade Method" ใน `PricingSidebar.tsx`

## จุดรับเครื่อง / หมุด (cust_lat / cust_lng) — สำคัญต่อการนำทางไรเดอร์
- **ไรเดอร์นำทางด้วยหมุด `cust_lat/cust_lng` เป็นหลัก** (`bkk-rider-app` → `useJobActions.handleOpenNavigation` เปิด Google Maps directions ไปที่พิกัด) และ**จะ fallback ไปใช้ `cust_address` (ข้อความ) ก็ต่อเมื่อไม่มีหมุดเท่านั้น**. geofence "ถึงแล้ว" (`checkpoints.ts`, target `customer`) ก็ใช้หมุดนี้
- **กฎเหล็ก:** แก้ที่อยู่ Pickup แล้ว**ห้ามปล่อยหมุดเก่าค้าง** มิฉะนั้นไรเดอร์วิ่งไปที่เดิม. UI admin (`PickupLocationPicker` ใน `src/components`) ให้ปักหมุด/geocode ได้ และ save handler จะ reconcile หมุด: ขยับหมุดเอง→ใช้พิกัดนั้น, แค่แก้ข้อความ→geocode ที่อยู่ใหม่, geocode ไม่ได้→**ล้างหมุด** (ให้ fallback ไปใช้ข้อความ)
- helper geocode ฝั่ง client: `geocodeAddress()` export จาก `PickupLocationPicker.tsx` (ใช้ Maps JS Geocoder)

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
