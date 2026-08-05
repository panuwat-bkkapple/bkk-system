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
- **Secrets (Cloud Functions):** THAILAND_POST_API_KEY, GOOGLE_MAPS_API_KEY, SICKW_API_KEY, RESEND_API_KEY, EMAIL_FROM, ORDER_NOTIFY_EMAIL (optional: EMAIL_REPLY_TO, CUSTOMER_TRACKING_BASE_URL) — ดู Order Confirmation Emails ด้านล่าง

## Cloud Functions env vars (กับดักที่กัดมาแล้ว)
- **`functions/.env` = ที่ที่ env var ทุกตัวถูกประกาศตอน deploy** (แต่ละ function เป็น Cloud Run service ของตัวเอง ตัวที่ไม่ได้ deploy ไม่กระทบกัน)
- `.env` ถูก gitignore → CI เขียนขึ้นจาก GitHub Secrets ที่ step "Create Functions .env" ใน `firebase-hosting-deploy.yml` (12 ตัว: THAILAND_POST_API_KEY, GOOGLE_MAPS_API_KEY, SICKW_API_KEY, RESEND_API_KEY, EMAIL_FROM, ORDER_NOTIFY_EMAIL, EMAIL_REPLY_TO, CUSTOMER_TRACKING_BASE_URL, TELEGRAM_*, ANTHROPIC_API_KEY, CHAT_AI_MODEL)
- **deploy ด้วยมือจาก clone ที่ไม่มี `.env` — สังเกตแล้วว่า env var ที่ตั้งไว้เดิม "ไม่" ถูกล้าง** (30 ก.ค. 2026: deploy มือ 13:02 UTC → งาน 13:29 ยังขึ้น `rider_fee_estimate ... (calculated, 0 km)` = ยังมีคีย์ Routes API อยู่). อย่าอนุมานเกินหลักฐานนี้ทั้งสองทาง — ยังไม่ได้ทดสอบเคส env var ที่ตั้ง**ครั้งแรก** จาก clone ที่ไม่มี `.env`. ทางที่ปลอดภัยยังเป็นให้ CI deploy (push main) เพราะ `.env` ถูกเขียนจาก secrets ครบทุกตัวแน่นอน
- **วิธีเช็คว่าคีย์ Maps ยังใช้ได้จริง** (ไม่ต้องเดาจาก config): `firebase functions:log --only onNewTicketCreated -n 30` แล้วดู `reason` ในบรรทัด `rider_fee_estimate` — `calculated` = Routes API ตอบจริง, `routes_api_*` = คีย์/เน็ตมีปัญหา, `missing_customer_coords` = งานไม่มีหมุด (ปกติสำหรับ Store-in/Mail-in)

## Mobile App (PWA)
- **URL:** `bkk-apple-admin.web.app/mobile`
- **ใช้งานบน iOS** ผ่าน Add to Home Screen (PWA standalone mode)
- **Push Notification:** ใช้ Firebase Cloud Messaging (FCM) + Service Worker (`firebase-messaging-sw.js`)
- **iOS Push:** ต้อง Add to Home Screen + Grant permission จาก PWA context
- **VAPID Key:** ต้องตั้งค่าใน GitHub Secrets (ไม่ใช่แค่ .env)

## Firebase Database Paths
- **`jobs/`** — ข้อมูล ticket/job ทั้งหมด (ห้ามฝัง blob โต ๆ เพิ่ม — ทุก byte คูณด้วยทุกคนอ่าน)
- **`job_chats/{jobId}/`** — ข้อความแชทของงาน (ย้ายออกจาก `jobs/{id}/chats` เพื่อลดค่า download RTDB). ตัว job มีแค่ `chat_flags` (`unread_from_admin/rider/customer`, `last_at`) ที่ cloud function (`onJobChatMessageV2`/`onChatMessageCreated`) เซ็ตให้ badge อ่าน — client อ่าน/เขียนผ่าน helper `src/utils/jobChats.ts` (mirror ใน bkk-rider-app; frontend inline ใน `RiderChatModal`) ซึ่ง dual-read path เก่า+ใหม่ช่วงเปลี่ยนผ่าน. migration ครั้งเดียว: `migrateOldJobs?action=move-chats` (รันหลัง deploy rules + ทุก client). archive จะ fold แชทกลับเข้า `jobs_archived/{id}/chats`
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
- **Settings Hub:** `/settings` (`src/pages/settings/SettingsHub.tsx` การ์ดจัดกลุ่ม + `SettingsLayout.tsx` เมนูซ้าย Company/Basic/Advanced ครอบหน้าตั้งค่า) — โครงเมนู+role ทั้งหมดอยู่ที่ `src/pages/settings/settingsNav.tsx` ที่เดียว: เพิ่มหน้าตั้งค่าใหม่ = เพิ่ม entry ที่นั่น + route ใน App.tsx (ใต้ `<SettingsLayout>` ถ้าไม่ใช่หน้า immersive; `/pricing` เป็น immersive อยู่นอก layout). URL ตั้งค่าเดิมทุกตัวคงเดิม
- **Ticket Creation:** `/src/features/trade-in/TradeInDashboard.tsx`
- **Instant Sell:** `/src/features/trade-in/components/InstantSellModal.tsx`
- **PriceEditor:** `/src/features/trade-in/PriceEditor.tsx`
- **Desktop Notifications:** `/src/components/layout/NotificationCenter.tsx`
- **Mobile Notifications:** `/src/pages/mobile/MobileNotificationsPage.tsx`
- **Notification Settings:** `/notification-settings` (ดู section สวิตช์การแจ้งเตือน)

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
- **`onAdminOfferProposed`** — trigger เมื่อ `jobs/{id}/adjustments` เปลี่ยน: (1) มีรายการใหม่ `source='admin_manual'` + `status='pending'` (แอดมินที่ไม่ใช่ CEO/MANAGER เสนอ Offer) → push เฉพาะเครื่องของ staff role CEO/MANAGER (ผ่าน `dispatchAdminPush(..., allowStaffIds)`) (2) pending → applied/rejected → push กลับหาผู้เสนอ (`by_uid` = staff id). การอนุมัติทำใน UI ticket (mobile+desktop) โดย `handleReviewAdjustment` ซึ่งเซ็ต `approved_by_*`/`rejected_by_*` และคิด net_payout ใหม่
- **`onJobCouponRevoked`** — trigger เมื่อ `jobs/{id}/applied_coupon` ถูกลบ/เปลี่ยน code → reconcile ledger ฝั่ง server (client เขียนไม่ได้): flip `issued_coupons` (used→issued, เคลียร์ used_*), เคลียร์ `is_used` ใน wallet `users/{uid}/coupons`, คืน quota `coupons/{id}/used_count`. Manual Top-up ของแอดมินไม่มี ledger = no-op
- **`onRiderFeeDiscountEdited`** — trigger เมื่อ `jobs/{id}/rider_fee_discount` เปลี่ยน (แอดมินแก้/ลบส่วนลดจาก ticket UI) → sync `issued_rider_fee_discounts/{jobId}` (row เดิมเท่านั้น ไม่สร้างใหม่)
- **`onPickupLocationChanged`** — trigger เมื่อ `jobs/{id}/cust_lat` เปลี่ยน (admin ปรับจุดรับเครื่องของงาน Pickup) → `computeRiderFee` ใหม่จากระยะทางใหม่ แล้วเซ็ต `pickup_fee` + `rider_fee_estimate` + `net_payout` อัตโนมัติ, และถ้ามีไรเดอร์ถืองานอยู่ (`rider_id`) จะ push แจ้ง "จุดรับเครื่องเปลี่ยน". **สำคัญ:** ไรเดอร์นำทางด้วย `cust_lat/cust_lng` (ดู `bkk-rider-app` `useJobActions.handleOpenNavigation`) และจะ**ไม่สนใจที่อยู่ข้อความเมื่อมีหมุด** — ห้ามแก้ `cust_address` แล้วปล่อยหมุดเก่าค้าง (ไรเดอร์จะวิ่งผิดที่). ชื่อห้ามตั้งทั่วไปด้วยเหตุผล namespace เดียวกัน
- **`onRiderAssignedRecalcEstimate`** — trigger เมื่อ `jobs/{id}/rider_id` เปลี่ยน (ไรเดอร์กดรับ / แอดมิน assign / ถอนงาน) → คิด `rider_fee_estimate` ใหม่ด้วย **การ์ดอัตราของยานพาหนะคนที่ถืองานจริง** (`computeRiderFeeForAssignee`). ใช้ `onValueWritten` เพราะเคสหลักคือ `rider_id` ถูก **สร้าง** ไม่ใช่แก้ (`onValueUpdated` จะไม่ยิง). **แตะเฉพาะเงินฝั่งไรเดอร์** — `pickup_fee`/`net_payout` ของลูกค้าห้ามขยับเพราะใครรับงาน (invariant #3). ข้ามงานที่ไม่ใช่ Pickup และงานที่ `rider_fee` (settlement) คิดไปแล้ว

## System Health (ส.ค. 2026)
- **หน้า `/system-health`** (`src/pages/admin/SystemHealth.tsx`, CEO/MANAGER, อยู่ใน settingsNav กลุ่ม Advanced) — สถานะ service/API ทุกตัวที่ระบบพึ่งพาในที่เดียว. logic ตรวจทั้งหมดอยู่ **`functions/health-check.js`** (`registerHealthCheck` inject `dispatchAdminPush`/`dispatchTelegram` จาก index.js แบบเดียวกับ dealer-portal)
- **Functions:** `systemHealthCheck` (scheduler รายชั่วโมง นาที 21 เวลาไทย) + `adminSystemHealthRun` (callable, gate role CEO/MANAGER ผ่าน `lookupStaffByAuth`) — ชื่อ unique ระดับ project ตามกฎ `{region}/{name}`
- **Probes:** `checkout_config` (สาขา active + พิกัด finite + โซนค่าส่ง — ตัวจับบั๊ก "กำลังคำนวณ..." ของ checkout ลูกค้าโดยตรง), `customer_quote` (ยิง `quotePickupServiceability` ของ bkk-frontend-next แบบ end-to-end ด้วยพิกัดกลางกรุงเทพ), `routes_api`, `geocoding_api`, `rtdb`, `sickw` (action=balance ฟรี + warn เมื่อเครดิต < $10), `resend` (list domains + เช็ค verify), `telegram` (getMe), `thailand_post` (getToken), `anthropic` (list models). env key ไม่ตั้ง = status `skip` ไม่ใช่ fail
- **ผลเก็บที่ `system_health/`** (`services/{id}` + `summary`) — read rule = admin เท่านั้น อยู่ที่ `bkk-frontend-next/database.rules.json` (deploy จาก repo นั้น), write ปิด (Admin SDK เขียน)
- **`order_reconciliation` = probe ตัวเดียวที่ตรวจ "ธุรกิจ" ไม่ใช่ "ของข้างนอก"** — เทียบคนที่ยิง `checkout_submit_attempt` กับคนที่จบที่ปลายทางใดปลายทางหนึ่ง (`order_completed` / `checkout_submit_blocked` / `checkout_submit_error`). ไม่มีปลายทาง = ลูกค้ากดแล้วระบบเงียบ ซึ่ง server มองไม่เห็นเพราะไม่มี request มาถึง. **ห้ามใส่เบอร์/ชื่อลูกค้าลงข้อความแจ้งเตือน (PDPA)** — ชี้ไปหน้า Session Monitor (`/admin/sessions` ของเว็บลูกค้า) ที่ gate สิทธิ์แล้วแทน. query ตาม index `timestamp` ไม่กวาดทั้ง node
  - **หน้าต่างของ "การกด" กับ "ปลายทาง" ไม่เท่ากันโดยตั้งใจ** — การกดนับเฉพาะ 3 ชม.→30 นาที (คนที่เพิ่งกดอาจยังทำรายการอยู่) แต่ปลายทางรับถึง `now` มิฉะนั้นคนที่กดจ่อขอบหน้าต่างแล้วสำเร็จอีก 3 วินาทีถัดมาจะถูกนับว่าเงียบทั้งที่ได้ออเดอร์แล้ว
  - **ก่อนเตือนต้องถามความจริงฝั่ง server เสมอ** — ปลายทางทั้งสามตัวเขียนโดยเบราว์เซอร์ลูกค้า ปิดแท็บก่อน event ถึง = เห็นเป็นเงียบทั้งที่ออเดอร์เข้าแล้ว. probe จึง query `/jobs` ตาม index `uid` (เพดาน 20 uid, ยิงเฉพาะรายที่ยังน่าสงสัยซึ่งปกติมีศูนย์ถึงหยิบมือ) ถ้ามีงานเกิดในหน้าต่างเดียวกัน = ไม่ใช่เงียบ แต่นับเป็น `lost_event` แล้วรายงานเป็น ok พร้อมหมายเหตุ
- **probe ที่ fail จะถูกลองซ้ำอีกครั้ง (หน่วง 2 วิ) ก่อนตัดสิน** — เน็ตจาก Cloud Function ไป API ภายนอกกระตุกเป็นปกติ ถ้าเตือนตั้งแต่ครั้งแรกจะกลายเป็นเตือนหมาป่าจนคนเลิกอ่าน (เคสจริง 5 ส.ค. 2026: Telegram probe timeout แล้วแจ้งเตือน ทั้งที่ข้อความแจ้งเตือนนั้นส่งผ่าน Telegram สำเร็จ = ใช้งานได้ปกติ). ลองซ้ำในรอบเดียวกันไม่ใช่รอรอบหน้า เพราะของที่พังจริงต้องเตือนทันที
- **แจ้งเตือนเฉพาะตอน "เปลี่ยนสถานะ"** (อะไรก็ตาม→fail = push+Telegram, fail→หาย = Telegram) — รันซ้ำตอนยังพังไม่สแปม. push ใช้ `data.type: "system_health_alert"` map เข้าหมวด `system_alert` ใน `functions/notification-settings.js` แล้ว (ปิดได้จาก /notification-settings)
- **ปิดการตรวจรายตัวได้ (mute)** — toggle ต่อ service ที่ `settings/health_checks/{id}/enabled` (สวิตช์บนการ์ดในหน้า /system-health). fail-open: มีแต่ `false` ชัดๆ เท่านั้นที่ปิด → probe ได้สถานะ `skip` ไม่นับ fail ไม่แจ้งเตือน. fail→skip ไม่นับเป็น "หายพัง" (ไม่ส่ง Telegram recovery). อยู่ใต้ `settings` ใช้ rule เดิม ไม่ต้อง deploy rules. ใช้กับ service ที่รอฝั่งภายนอกแก้ (เช่น Thailand Post รอ activate บัญชี)
- **เพิ่ม probe ใหม่** = เพิ่ม 1 entry ใน `buildProbes()` — หน้า UI render ตามข้อมูลไม่ต้องแก้. probe ต้องเป็น endpoint ฟรี/ราคาศูนย์เสมอ (balance/getMe/list ไม่ใช่ transaction จริง). Routes+Geocoding+quote กิน quota จริงรอบละ ~3 calls (รายชั่วโมง ≈ 2.2k/เดือน อยู่ใน free tier 10k) — **อย่าลด interval โดยไม่คิดโควตา**

## สวิตช์การแจ้งเตือน (settings/notifications)
- **หน้า `/notification-settings`** (`src/pages/admin/NotificationSettings.tsx`, CEO/MANAGER) = ที่รวมการตั้งค่าแจ้งเตือนทั้งระบบ. ก่อนหน้านี้กระจายอยู่ 3 ที่ (การ์ดสถานะ push ใน `/mobile/notifications`, สวิตช์อีเมลใน `/accounting-settings`, permission strip ในคอนโซลแชท) + env-only อีก 2 ตัว
- **สิ่งที่หน้านี้เป็นเจ้าของจริง** = `settings/notifications` เท่านั้น: `channels {admin_push, rider_push, telegram}` + `events {new_ticket, status_change, chat_message, approval, field_ops, system_alert}`. ค่าที่เจ้าของอยู่หน้าอื่น (อีเมล = `settings/accounting/order_emails_enabled`, SLA ข้อเสนอ, เกณฑ์ flag ไรเดอร์) หน้านี้แค่**โชว์สถานะ + ลิงก์ไป** ห้ามเขียนทับ — กันสองหน้าแก้ฟิลด์เดียวกัน. ข้อยกเว้นเดียวคือ `settings/system/rider_overdue_min` ซึ่งเดิม**ไม่มี UI เลย** จึงให้หน้านี้เป็นเจ้าของ
- **การ gate ทำฝั่ง server** ที่ `functions/notification-settings.js` (`shouldNotify`) — เสียบไว้ที่ choke point ทุกตัวที่ยิง push จริง: `dispatchAdminPush`, `pushToRider`, `dispatchTelegram`, `dispatchAmendmentPush` (มี branch ที่ยิง `getMessaging()` ตรง เลี่ยง dispatchAdminPush ได้) และ push ของ `sickw-daily`. **เพิ่มที่ยิง push ใหม่ = ต้องเสียบ gate ด้วย** ไม่งั้นสวิตช์ปิดแล้วยังเด้ง
- **ตัดสินจาก `message.data.type`** ผ่าน map `EVENT_CATEGORY` → หมวดที่โชว์ใน UI. **fail-open ทุกทาง**: type ที่ไม่อยู่ใน map / ไม่มี node / อ่านพัง = ส่งตามเดิม มีแต่ `false` ที่แอดมินเขียนเองเท่านั้นที่ปิด. push ทดสอบ (`sendTestAdminPush`) ไม่ถูก gate โดยตั้งใจ — เป็นเครื่องมือ diagnose
- **MIRROR 2 ที่:** หมวด/ช่องทาง/ค่า default อยู่ทั้ง `functions/notification-settings.js` (JS, ตัวที่ gate จริง) และ `src/utils/notificationSettings.ts` (TS, label ของ UI) — functions import TS ไม่ได้ **เพิ่มหมวดต้องแก้ทั้งคู่ + map `data.type` ฝั่ง server**
- `settings/notifications` อยู่ใต้ `settings` จึงใช้ rule เดิม (read = auth, write = admin) **ไม่ต้อง deploy rules ใหม่**

## ค่าวิ่งไรเดอร์ แยกตามยานพาหนะ (motorcycle / car)
- **อัตรา** อยู่ที่ `settings/logistics_rates/by_vehicle/{motorcycle|car}` (ตั้งที่ `/global-settings` แท็บยานพาหนะ) — ฟิลด์แบนที่ root ยังเป็น fallback ทีละฟิลด์ ระบบเดิมจึงคิดเงินเท่าเดิมเป๊ะจนกว่าจะกรอก `by_vehicle`
- **ยานพาหนะของไรเดอร์** อยู่ที่ `riders/{id}/vehicle_type` (+ mirror ที่ `riders/{id}/vehicle/type` ซึ่งเป็นตัวที่ลูกค้าอ่านได้ตามกฎ read ของ subtree `vehicle`) — ตั้งที่หน้า `/riders`
- **แยกสามเรื่องอย่าสับสน** (ดู doc comment ของ `computeRiderFee`): ระยะทางที่ใช้**คิดเงิน**ใช้ `rates.travel_mode` ฐานเดียวทั้งระบบ (ไม่อิงคนขับ ไม่งั้นตั้งตัวเองเป็นรถยนต์ = ขึ้นเงิน) | **อัตรา** แยกตามยานพาหนะได้ | **ETA** ใช้โหมดของยานพาหนะจริง (มอเตอร์ไซค์ขึ้นทางด่วนไม่ได้)
- **`fee_by_vehicle`** ใน `rider_fee_estimate_meta`/`rider_fee_meta` = ค่าจ้างของทั้งสองยานพาหนะจากระยะทางชุดเดียวกัน (ได้ฟรี ไม่ยิง Routes เพิ่ม) — งานในกองยังไม่มีใครถือ ตัวเลขก้อนเดียวจึงเป็นของมอเตอร์ไซค์เสมอ แอปไรเดอร์อ่านตัวนี้ผ่าน `getRiderPayout(job, vehicleType)` (`bkk-rider-app/src/utils/jobHelpers.ts`) เพื่อโชว์เลขของคนดูเอง
- ที่เขียนเงินฝั่งไรเดอร์ต้องใช้ `computeRiderFeeForAssignee` (อิงคนถืองาน) — `computeRiderFee` เปล่าๆ ใช้เฉพาะตอนสร้างงานที่ยังไม่มีใครรับ

## Appointment / pickup_schedule (เลื่อนนัด)
- **`pickup_schedule`** ใช้ร่วมกันทุก receive_method เก็บ `{ type, date, time, time_start, time_end, rescheduled_at? }`
  - `time` = string รวมช่วงเวลา (`"12:00 - 14:00"`) เก็บไว้เพื่อ backward-compat กับตัวอ่านเดิม (calendar, customer tracking, ticket detail อ่าน `.time` ตรงๆ)
  - `time_start` / `time_end` = ช่วงเวลาแบบ structured (`time_end` ไม่บังคับ)
  - helper รวมอยู่ที่ `src/utils/appointment.ts` (`parseTimeRange`, `buildPickupSchedule`, `existingApptDate`) — ใช้ทั้ง mobile (`MobileTicketDetail` edit modal) และ desktop (`PricingSidebar`)
- **UI เลื่อนนัด:** mobile = โมดอล "แก้ไขข้อมูลงาน" ใน `MobileTicketDetail.tsx`; desktop = scheduler ใน `PricingSidebar.tsx` (มีครบทั้ง Pickup / Store-in / Mail-in)

## เปลี่ยน Trade Method (receive_method) หลังสร้างงาน
- เปลี่ยนได้ทุกทิศทาง (Pickup ⇄ Store-in ⇄ Mail-in). helper อยู่ที่ `src/utils/receiveMethod.ts` (`canChangeReceiveMethod`, `locationLabel`, `currentLocation`, `buildMethodLocationFields`, `buildStoreInBranchFields`)
- **Store-in ต้องเลือกสาขาจริงจาก `settings/branches` เสมอ (dropdown ทั้ง mobile + desktop) — ห้าม free text.** การ save ใช้ `buildStoreInBranchFields(branch)` เขียน `store_branch` + `branch_name` + `branch_details {id,name,address,phone,lat,lng,openHour,closeHour}` รูปเดียวกับ `validateAndCreateOrder` ฝั่ง checkout เพื่อให้หน้า track ลูกค้า resolve สาขาสดจาก `branch_details.id` ได้ (บั๊กเดิม: ช่องข้อความทำให้ที่อยู่ลูกค้าไหลเข้า `store_branch` และ track โชว์สาขา fallback มั่ว). ช่องแก้ที่อยู่ใน CustomerInfoCard/B2CWorkspace เขียนได้แค่ `cust_address` ห้ามแตะ `store_branch`. ออกจาก Store-in → `buildMethodLocationFields` ล้าง `branch_name`/`branch_details` ทิ้งด้วย
- **client เขียนแค่ `receive_method` + ฟิลด์สถานที่ (`cust_address`/`store_branch`) + qc_log** — เรื่องเงิน (pickup_fee/net_payout) และการถอนไรเดอร์ให้ `onReceiveMethodChanged` (cloud function) จัดการ เพื่อให้ค่าไรเดอร์ใช้ `computeRiderFee` ที่เดียว
- `canChangeReceiveMethod` block เมื่อเครื่องอยู่ในมือ/จ่ายเงินแล้ว/พัสดุส่งแล้ว/ปิดงาน (เช็ค status) — UI ทั้ง mobile + desktop ใช้ guard เดียวกัน
- UI: mobile = ตัวเลือกในโมดอล "แก้ไขข้อมูลงาน"; desktop = section "Trade Method" ใน `PricingSidebar.tsx`

## จุดรับเครื่อง / หมุด (cust_lat / cust_lng) — สำคัญต่อการนำทางไรเดอร์
- **ไรเดอร์นำทางด้วยหมุด `cust_lat/cust_lng` เป็นหลัก** (`bkk-rider-app` → `useJobActions.handleOpenNavigation` เปิด Google Maps directions ไปที่พิกัด) และ**จะ fallback ไปใช้ `cust_address` (ข้อความ) ก็ต่อเมื่อไม่มีหมุดเท่านั้น**. geofence "ถึงแล้ว" (`checkpoints.ts`, target `customer`) ก็ใช้หมุดนี้
- **กฎเหล็ก:** แก้ที่อยู่ Pickup แล้ว**ห้ามปล่อยหมุดเก่าค้าง** มิฉะนั้นไรเดอร์วิ่งไปที่เดิม. UI admin (`PickupLocationPicker` ใน `src/components`) ให้ปักหมุด/geocode ได้ และ save handler จะ reconcile หมุด: ขยับหมุดเอง→ใช้พิกัดนั้น, แค่แก้ข้อความ→geocode ที่อยู่ใหม่, geocode ไม่ได้→**ล้างหมุด** (ให้ fallback ไปใช้ข้อความ)
- helper geocode ฝั่ง client: `geocodeAddress()` export จาก `PickupLocationPicker.tsx` (ใช้ Maps JS Geocoder)

## Data Contracts / Invariants (กันบั๊ก "แก้ไม่ครบวง")
> บั๊กร้ายแรงเกือบทั้งหมดของระบบนี้คือ "แก้ฟิลด์เดียวของชุดที่ผูกกัน" หรือ "ลืมคนอ่านอีก repo". **ก่อนแก้ฟิลด์ข้อมูลใน Firebase หรือพฤติกรรมที่ข้าม repo ให้ `grep` ทั้ง `/home/user` (ครบทั้ง 3 repo + `functions/`) หาคนเขียน/คนอ่านก่อนเสมอ** แล้วแก้ให้ครบทุกทางเข้าและทุกคนอ่าน. ข้อมูลงานเดียวกันถูกใช้โดย: `bkk-system` (admin), `bkk-rider-app` (ไรเดอร์), `bkk-frontend-next` (เว็บลูกค้า + customer functions).

ชุดฟิลด์ที่ **ต้องไปด้วยกันเสมอ** (ห้ามมีตัวใดค้างค่าเก่า):

1. **จุดรับเครื่อง:** `cust_address` (ข้อความ) ↔ `cust_lat`/`cust_lng` (หมุด) ↔ `cust_address_geocoded_*`
   - คนอ่านข้าม repo: **ไรเดอร์นำทาง/geofence ใช้หมุดเป็นหลัก** (ดู section "จุดรับเครื่อง / หมุด"). แก้ที่อยู่ต้อง reconcile หมุดเสมอ
2. **ราคา/ยอดเงินลูกค้า:** `price`/`final_price` ↔ `pickup_fee` ↔ `applied_coupon` ↔ `adjustments` ↔ `net_payout`
   - สูตรเดียวที่ใช้ทุกที่: `net_payout = max(0, base − (receive_method==='Pickup' ? pickup_fee : 0) + coupon + Σ(applied adjustments))` (client: `MobileTicketDetail` ~บรรทัด 423; server: `functions/index.js`). แก้สูตร = แก้ทั้ง client + functions
   - **`adjustments[]`** = รายการหัก/เพิ่ม ad-hoc แบบ itemized (`{id,label,amount,device_index,source,status,by_*,at,reason?,evidence?,approved_by_*?,approved_at?,rejected_by_name?,rejected_at?}`) — เฉพาะ `status==='applied'` เข้าสูตร (ของไรเดอร์เริ่ม `pending` จนแอดมินอนุมัติผ่าน `reviewAmendment`; **Offer ของแอดมิน role อื่นที่ไม่ใช่ CEO/MANAGER ก็เริ่ม `pending`** จน CEO/MANAGER กดอนุมัติใน ticket UI — push แจ้งผ่าน `onAdminOfferProposed`, CEO/MANAGER สร้างเอง = applied + self-approved ทันที, helper role: `canReviewAdjustments()` ใน `src/utils/adjustments.ts`). helper `sumAppliedAdjustments(job)` mirror 4 ที่ (frontend functions + bkk-system functions + clients). ลูกค้าเห็นเป็นบรรทัดๆ ที่ `OrderSummaryModal` (เฉพาะ applied)
   - **หลังสร้างงาน เรื่องเงินเป็นของ cloud function** (`onReceiveMethodChanged`, `onPickupLocationChanged`) — client เขียนได้แค่ `final_price` (ตอนแก้ราคา) แล้วปล่อยให้ function คิด `pickup_fee`/`net_payout` ต่อ
   - คนอ่านข้าม repo: `bkk-frontend-next` แสดง `net_payout` ให้ลูกค้า (track/profile/history/analytics); finance pages อ่าน `net_payout`
3. **ค่าธรรมเนียม — คนละตัว อย่าสับสน:** `pickup_fee` = หักจาก**ลูกค้า** (อยู่ในสูตร net_payout) | `rider_fee`/`rider_fee_estimate` = จ่ายให้**ไรเดอร์** (อ่านโดย finance settlement + ไรเดอร์เห็น estimate ก่อนรับงาน). คนละความหมาย ห้ามเอามาใช้แทนกัน
   - `pickup_fee` ถูก quote ให้ลูกค้าตอน checkout ด้วยระบบราคาโซนของเว็บ (`bkk-frontend-next` เป็นเจ้าของ) — **ห้ามขยับเพราะไรเดอร์คนไหนรับงาน**. ส่วน `rider_fee*` อิงยานพาหนะของคนถืองานได้ (ดู section ค่าวิ่งไรเดอร์)
4. **วิธีรับเครื่อง:** `receive_method` ↔ `pickup_fee` ↔ `rider_id` ↔ `status` ↔ location fields (`cust_address`/`store_branch`)
   - เจ้าของ reconcile = `onReceiveMethodChanged` (ดู section Cloud Functions + Trade Method)
5. **นัดหมาย:** `pickup_schedule.time` (string `"12:00 - 14:00"`, backward-compat) ↔ `time_start`/`time_end`
   - **ต้องเขียนผ่าน `buildPickupSchedule()` (`src/utils/appointment.ts`) เสมอ** เพื่อให้ `.time` ถูกเซ็ตคู่ไปด้วย — คนอ่าน `.time` ตรงๆ: calendar, `bkk-frontend-next` (track/DeliverySection), `bkk-rider-app` (`jobHelpers`), ticket detail
6. **สถานะงาน:** `job-statuses.ts` มี **3 ก๊อปปี้** (`bkk-system`, `bkk-rider-app`, `bkk-frontend-next`/`app/types`) — เพิ่ม/แก้ status ต้อง sync ทั้ง 3 ไฟล์ และเช็ค notification triggers + archive (`TERMINAL_STATUSES`) + guard ต่างๆ
7. **Cloud Functions naming:** ชื่อ function ห้ามชนกับ rider-notifications codebase (identify ด้วย `{region}/{name}` ระดับ project — ดูหมายเหตุใน section Cloud Functions)
8. **ค่าหักชุดประเมิน (condition sets):** ต่อ option ใช้ precedence `pct` (% ของราคา) > `deduct` (บาทค่าเดียว) > legacy `t1/t2/t3` (tier เก่า — **อ่านอย่างเดียวเป็น fallback สำหรับข้อมูลที่ยังไม่ migrate ห้ามเขียนเพิ่ม**). resolver mirror 4 ที่: `bkk-system/src/utils/pricingResolver.ts`, `bkk-frontend-next/app/utils/pricingResolver.ts`, `bkk-frontend-next/functions/src/index.ts` (`calculateDeductAmount`), `bkk-rider-app/src/utils/pricingResolver.ts` — แก้สูตรต้อง sync ทั้ง 4. ฟิลด์ `title_en`/`description_en` (group) และ `label_en`/`description_en` (option) เป็น **display-only สำหรับหน้า /en ของเว็บลูกค้า** — ไทยยังเป็นค่า canonical ที่ใช้ match/payload เสมอ, `sanitizeGroups` เก็บ `*_en` ไว้ตอน save (ค่าว่าง = ลบฟิลด์ทิ้ง), ห้ามเอา `*_en` ไปใช้ในสูตรเงินหรือการ match. แนวทางออกแบบ = **1 ชุดประเมินต่อ 1 รุ่น** — ทำได้ 2 ทาง: ปุ่ม Clone รายรุ่นใน `ModelEditorPage`, หรือปุ่ม bulk "แตกชุดรายรุ่น" ใน sidebar ของ Engine (`EngineSettingsModal`) ที่ไล่ clone ทุกรุ่นที่ยังใช้ชุดร่วมกันทีเดียว. ทั้งคู่ใช้ helper กลาง `utils/perModelConditionSets.ts` (`representativeBasePrice` = median ราคามือสองของ variants, `convertGroupsToSingleDeduct` = แปลง tier เดิมเป็น `deduct` ที่ราคานั้น, `planPerModelSplit` = pure planner — วางแผนเฉพาะรุ่นที่ set ถูกแชร์ ≥2 รุ่น จึง idempotent กดซ้ำไม่สร้างซ้ำ). หลัง split ชุดเดิมกลายเป็น orphan (ไม่ถูกลบอัตโนมัติ — ลบเองจาก sidebar). การ save จาก Engine (`writeConditionSet`/`applyRowsToSet` — `sanitizeGroups`) จะลบ t1/t2/t3 ทิ้งทันทีที่ option มี `deduct` หรือ `pct`

## อุปกรณ์เสริม iPad ขายพ่วง (Apple Pencil / Magic Keyboard)
- **Catalog:** accessory เป็น model จริงใน `/models` category `Tablet Accessories` (schema ใน `categorySchemas.ts`, seed+backfill ใน PriceEditor) + `compatible_series: string[]` (ชื่อ series iPad — ว่าง = ทุกรุ่น, UI ใน `ModelEditorPage`). ฝั่งเว็บลูกค้า category นี้**ถูก exclude จาก sell picker + search** (add-on only)
- **Data contract (invariant เดียวกับข้อ 2):** `accessory_items[]` (`{id, model_id, model_name, price, serial?}`) เป็น **breakdown เท่านั้น** — มูลค่ารวมอยู่ใน `price`/`final_price` ก้อนเดียวเสมอ สูตร net_payout ไม่เปลี่ยน. **ทุกจุดที่ recompute final_price จากผลรวม devices ต้องบวก `sumAccessoryItems()` กลับ** — ตอนนี้มี 2 จุด: rider `RiderApp.handleInspectionSubmit` (bkk-rider-app) และ `InternalQCModal` (repo นี้). Amendment ปลอดภัยเพราะทำงานแบบ delta
- **Helper กลาง:** `src/utils/accessoryItems.ts` (mirror: `bkk-frontend-next/app/utils/accessoryAddOns.ts` + validation ใน `validateAndCreateOrder`, `bkk-rider-app/src/utils/jobHelpers.ts`)
- **เข้าสต๊อก:** งานที่มี `accessory_items` เมื่อถึง `In Stock` (QCStation + MobileTicketDetail) → `unpackAccessoryItemsToStock()` แตก child job ต่อชิ้น (`ref {parent}-A1..`, `type: 'Accessory'`, status In Stock, กัน trigger อีเมล/พุชเพราะไม่ใช่ status งานใหม่) idempotent ด้วย `accessories_unpacked_at`. Serial กรอกได้ที่ QCStation ก่อนเข้าคลัง
- **ต้นทุน:** งานแม่ได้ `stock_cost` = ยอดจ่าย − มูลค่าอุปกรณ์เสริม; Inventory/POS/Analytics stock อ่านผ่าน `stockCost()` กันนับซ้ำ. ตัวรวม spend (Analytics/CEODashboard) + รายการ ticket B2C ต้อง exclude `type === 'Accessory'` แบบเดียวกับ `B2B-Unpacked`

## Order Confirmation Emails (Resend)
- **Provider:** Resend ผ่าน REST API ตรงๆ ด้วย `fetch` (Node 22) — ไม่เพิ่ม npm dependency. Logic + templates อยู่ใน `/functions/email.js`
- **`onJobCreatedSendEmails`** (trigger: `onValueCreated /jobs/{jobId}`) — ออเดอร์เข้ามา → ส่งอีเมล "เราได้รับคำสั่งขาย" ให้ลูกค้า (`cust_email`) + แจ้งอีเมลกลางของแอดมิน (`ORDER_NOTIFY_EMAIL`)
- **`onJobStatusEmail`** (trigger: `onValueUpdated /jobs/{jobId}/status`) — ส่งอีเมลตาม milestone ของ lifecycle (Active Lead, รับเครื่อง, ปรับราคา, โอนเงิน, ยกเลิก, ส่งคืน, คืนเงิน ฯลฯ) ให้ลูกค้า + แจ้งแอดมินกลางทุก milestone
- **Milestone copy-map = allowlist:** `STATUS_COPY` ใน `email.js` — สถานะไหนไม่อยู่ใน map = ไม่ส่งอีเมล (เฟส Inventory/Logistics ภายในไม่ส่ง). เพิ่มสถานะใหม่ = เพิ่ม 1 entry ไม่ต้องแตะ logic. **ใช้ template กลางตัวเดียว** ไม่แยกต่อสถานะ
- **Paid = ใบสำคัญรับเงิน (ไม่ใช่ใบเสร็จ):** เราเป็นผู้ซื้อจ่ายเงินให้บุคคลธรรมดาที่ออกใบเสร็จไม่ได้ → ลูกค้าได้ `buildCustomerPaymentVoucherEmail` = **ใบสำคัญรับเงิน** (ผู้จ่าย=นิติบุคคล+เลขผู้เสียภาษี+ที่อยู่, ผู้รับเงิน, จำนวนเงินตัวอักษร `bahtText()` "บาทถ้วน", หมายเหตุเหตุผลออกแทนใบเสร็จ) — สินค้า/ยอด/บัญชี mask เท่านั้น **ห้ามใส่ SickW/FMI/KYC** (PDPA)
- **Paid แอดมิน = สรุปเต็ม + voucher backing:** `buildAdminPaidSummaryEmail` = parties + order + payout + ตัวอักษร + ผลตรวจ SickW GSX/FMI/iCloud (จาก `job.sickw_check.last_check`) + KYC (จาก `/jobs_kyc/{jobId}` เลขบัตร mask 4 ตัวท้าย). อ่าน snapshot ที่เก็บตอน inspection — **ไม่ call SickW API ซ้ำ**
- **COMPANY mirror:** ข้อมูลนิติบุคคล (`COMPANY` ใน `email.js`) เป็น **ค่า default/fallback** — แอดมินแก้ทับได้ที่หน้าตั้งค่าระบบบัญชี (`settings/accounting/company`); trigger resolve แล้ว stash ที่ `job._company` (`companyOf()` merge override ทับ default). ยัง mirror source of truth ที่ `bkk-frontend-next` — ถ้าเปลี่ยน entity จดทะเบียนต้อง sync ทั้ง 2 repo + หน้า PDPA
- **เลขรันใบกำกับภาษี format ได้:** `tax_invoice_format` = `plain` ({prefix}{6หลัก} ต่อเนื่อง) / `year_month` ({prefix}{YYYYMM}{4หลัก} reset รายเดือน) / `year` ({prefix}{YYYY}{4หลัก} reset รายปี). period format ใช้ counter แยกที่ `settings/accounting/tax_invoice_seq_by_period/{period}` (`allocateTaxInvoiceNumber` ใน index.js)
- **ส่วนลดค่าบริการต้องโชว์เป็นบรรทัด ห้ามหักเงียบ (ม.79(1)):** ส่วนลดที่ให้ขณะให้บริการจะกันออกจากฐานภาษีได้ **ก็ต่อเมื่อแสดงส่วนลดไว้ในใบกำกับภาษีให้ชัดแจ้ง** — `serviceFeeBreakdown` จึงคืน `grossBase`/`discountBase` (ฐานก่อน VAT ทั้งคู่, `discountBase` คิดจากการลบเพื่อให้ `grossBase − discountBase = base` เป๊ะ ไม่มีเศษจากการปัดสองรอบ) และทั้ง `buildTaxInvoicePdf` + การ์ดสรุปในอีเมลต้องพิมพ์บรรทัด "หัก ส่วนลดค่าบริการ" ออกมา. หน้า checkout ฝั่งลูกค้าโชว์ 3 บรรทัดนี้อยู่แล้ว เอกสารต้องเล่าตรงกัน. ส่วนลดกลบหมด (`feeIncl <= 0`) = ไม่ออกใบกำกับ (ไม่มีมูลค่าที่เก็บจริง)
- **เลขใบกำกับภาษีห้ามกระโดดเงียบ:** เลขถูกจอง **ก่อน** สร้าง PDF (เพราะต้องพิมพ์เลขลงบนเอกสาร) ถ้าสร้างไม่สำเร็จ เลขจะถูกใช้ไปโดยไม่มีเอกสาร — จึงต้องลงทะเบียนเป็น `accounting_documents` ที่มี `status: "void"` + `void_reason` มูลค่า 0 เพื่อให้ลำดับอธิบายได้ตอนถูกตรวจ. คีย์เป็น `TI_{number}` ถ้ารันซ้ำแล้วสำเร็จ แถวจริงจะทับแถว void เอง. `/vat-report` แสดงป้าย "ยกเลิก" + เหตุผลทั้งบนตารางและใน CSV
- **ไม่เก็บลายมือชื่อผู้รับเงิน (ยืนยันกับบัญชีแล้ว):** จ่ายด้วยการโอน ไม่มีการพบหน้าตอนจ่าย — หลักฐานคือ **สลิปโอน + สำเนาบัตรประชาชนจาก KYC** ใบสำคัญรับเงินจึงพิมพ์บรรทัด "หลักฐานประกอบการจ่ายเงิน" (อ้างเลขบัตร 4 ตัวท้ายจาก `/jobs_kyc/{jobId}` เพื่อ match กับสำเนาบัตร) และเหลือเส้นเซ็นเฉพาะ **ผู้มีอำนาจจ่ายเงิน** ฝั่งบริษัท ไม่พิมพ์เส้นเซ็นผู้รับเงินที่ไม่มีวันถูกเซ็น
- **ใบกำกับภาษีค่าบริการ = คนละฉบับกับใบสำคัญรับเงินโดยตั้งใจ** — เป็นธุรกรรมคนละตัวเดินคนละทิศ (บริษัทซื้อเครื่อง = รายจ่าย / ลูกค้าซื้อบริการรับเครื่อง = รายได้) ที่บังเอิญหักกลบกันตอนโอน. ใบสำคัญรับเงินยัง**ต้องโชว์การหักกลบ** เพราะยอดในสลิปคือยอดสุทธิ ถ้าเอกสารบอกยอดเต็มจะไม่ตรงกับหลักฐานการโอน — คำว่า "(เราจ่ายคุณ)" / "(คุณชำระเรา)" จึงเก็บไว้เฉพาะบนเอกสารบัญชี (`showVatDetail`) ส่วนอีเมลยืนยันออเดอร์ซึ่งเป็นแค่ใบเสนอราคาตัดออก
- **`etax_enabled` (settings/accounting, default ปิด):** ยังไม่ขึ้นระบบ e-Tax Invoice ของสรรพากร = PDF ที่แนบอีเมล**ไม่ใช่**ใบกำกับภาษีอิเล็กทรอนิกส์ตามกฎหมาย ต้นฉบับต้องเป็นกระดาษ เอกสารจึงประทับ "สำเนา — ต้นฉบับออกเป็นเอกสารกระดาษ" อัตโนมัติ (`taxDocCopyMark` ใน voucher-pdf.js ใช้ทั้งใบกำกับค่าบริการและใบกำกับขาย). เปิดสวิตช์ที่ `/accounting-settings` เมื่อขึ้นระบบแล้วเท่านั้น
- **ห้ามอ้างสิ่งที่ระบบไม่ได้เก็บลงบนเอกสาร:** ใบสำคัญรับเงินเคยเขียนว่า "ผู้รับเงินได้ลงลายมือชื่อไว้แล้ว ณ จุดส่งมอบเครื่อง" ซึ่งเป็นเท็จ — ลายเซ็นถูกเก็บเฉพาะ KYC โหมด fallback, ไม่มีใน Store-in/Mail-in, และเซ็นก่อนโอนเงินจึงรับรองการรับเงินไม่ได้ ทั้งฉบับ PDF ก็พิมพ์เส้นให้เซ็นอยู่แล้ว = สองฉบับพูดคนละเรื่อง
- **ค่าบริการรับเครื่อง = รายได้บริษัท (VAT):** บริษัทจด VAT — `pickup_fee` (ค่าบริการไรเดอร์ที่หักจาก payout) เป็น**รายได้ค่าบริการ** ถือเป็น VAT-inclusive. `serviceFeeBreakdown()` ใน `email.js` แตก base + VAT 7% ออกมา. voucher/admin Paid โชว์บรรทัด 2 ทาง "ราคารับซื้อเครื่อง (เราจ่ายคุณ) − ค่าบริการรับเครื่อง (คุณชำระเรา รวม VAT) = ยอดรับสุทธิ" + รายละเอียด VAT (ทั้ง HTML + PDF). คนละก้อนกับค่าวิ่งที่จ่ายไรเดอร์ (expense + อาจมี WHT)
- **ใบกำกับภาษีค่าบริการ:** ที่ Paid ถ้ามี `pickup_fee` → ออก **ใบกำกับภาษี/ใบเสร็จรับเงิน** แยกสำหรับค่าบริการ (`buildTaxInvoicePdf` ตาม ม.86/4: เลขที่ running, ผู้ขาย=บริษัท สนญ., ผู้ซื้อ=ลูกค้า, มูลค่าบริการ + VAT แยก). เลขที่จองจาก atomic counter `settings/accounting/tax_invoice_seq` (transaction; format `{prefix}000123`) เก็บที่ `jobs/{id}/tax_invoice` (กัน allocate ซ้ำ) + archive `tax_invoices/{jobId}.pdf`. แนบไปทั้งลูกค้า+แอดมินคู่กับใบสำคัญรับเงิน. **เลขรัน reset ได้** จากหน้าตั้งค่าระบบบัญชี (เก็บใต้ settings/accounting แอดมินจึงอ่าน/เขียนได้) — ใช้เฉพาะก่อน go-live เพื่อล้างเลขทดสอบ, ห้าม reset หลังออกใบจริง (เลขซ้ำ ผิดกฎหมาย)
- **Voucher PDF:** ที่ Paid `onJobStatusEmail` สร้างไฟล์ PDF ใบสำคัญรับเงิน (`functions/voucher-pdf.js` ใช้ `pdf-lib` + ฟอนต์ `functions/assets/fonts/Sarabun-*.ttf` — TH Sarabun New OFL, ต้องมีไม่งั้นภาษาไทยเป็นกล่อง) → **แนบไปทั้งอีเมลลูกค้า + แอดมิน** และ **archive ที่ Storage `vouchers/{jobId}.pdf`** + เขียน reference `jobs/{jobId}/payment_voucher` (storage_path, url ผ่าน download token, amount, generated_at) ให้โชว์ในประวัติการขายได้. PDF/Storage เป็น best-effort — ถ้าล้มเหลวอีเมลยังส่ง. Deps: `pdf-lib`, `@pdf-lib/fontkit` (pure JS ไม่มี native binary)
- **Normalize ก่อน lookup:** `normalizeStatus()` ใน `email.js` mirror จาก `src/types/job-statuses.ts` (LEGACY_ALIAS + In-Transit overload) เพราะ functions เป็น JS import TS enum ไม่ได้ — **แก้ status enum ต้อง sync 2 ที่**
- **กันส่งซ้ำ:** create ใช้ `confirmation_email_sent_at`; milestone ใช้ `status_email_sent/{slug}` (per-status) guard ที่ต้นฟังก์ชัน
- **ครอบคลุมทั้ง 2 ทางสร้างออเดอร์:** ลูกค้า self-checkout (`validateAndCreateOrder` ใน bkk-frontend-next) กับแอดมินสร้างเอง เขียน `/jobs` path เดียวกัน project เดียวกัน → DB trigger ตัวเดียวครอบคลุมหมด
- **ชื่อ function ต้อง unique ระดับ project** เช่นเดียวกับ `onAdminJobStatusNotify` (กฎ `{region}/{name}` collision)
- **Deliverability:** ต้อง verify sending domain `bkkapple.com` ใน Resend (SPF/DKIM/DMARC) ก่อนส่งจริง ไม่งั้นเข้า spam หรือถูก reject
- **ทะเบียนเอกสาร + รายงานภาษีขาย (Phase 2):** ทุกใบที่ออกถูก log ที่ `accounting_documents/{docId}` (`TI_{number}` = ใบกำกับภาษี, `PV_{jobId}` = ใบสำคัญรับเงิน) มี `period` (YYYYMM อิงเวลาไทย `bangkokYM`), base/vat/total, url. หน้า `/vat-report` (`VatReport.tsx`, CEO+FINANCE) query ตาม period → สรุป output VAT + export CSV สำหรับ ภ.พ.30. **read rule ของ `accounting_documents` อยู่ที่ `bkk-frontend-next/database.rules.json`** (admin read, write false, indexOn period/type/issued_at) — ต้อง deploy rules จาก repo นั้น
- **ขายเครื่อง refurbished → ใบกำกับภาษีขาย (Phase 3):** `onSaleCreated` (trigger `onValueCreated /sales/{saleId}`) ออก **ใบกำกับภาษีขาย** (output VAT) ตอน POS checkout — เต็มรูปเมื่อลูกค้าให้ `customer_tax_id`/`customer_address`, ไม่งั้นอย่างย่อ (ม.86/6 retail). ใช้ running-number series เดียวกับใบกำกับค่าบริการ (`allocateTaxInvoiceNumber`), แตก VAT จาก `grand_total` (VAT-inclusive), archive `sales_tax_invoices/{saleId}.pdf` + เขียน `accounting_documents` (type `tax_invoice`, category `goods`) → เข้ารายงาน ภ.พ.30 เดียวกัน. gated ด้วย master toggle + vat_registered, idempotent ด้วย `sales/{id}/tax_invoice`
- **รายงานการเงิน P&L (Phase 4):** หน้า `/financial-report` (`FinancialReport.tsx`, CEO+FINANCE) สรุปรายเดือน (เวลาไทย) จาก `/sales` (ยอดขาย/COGS/กำไรขั้นต้น) + `/accounting_documents` (รายได้ค่าบริการ + ภาษีขาย) + `/expenses` (ค่าใช้จ่าย) → P&L + VAT สุทธิ + export CSV. ภาษีซื้อยังไม่เก็บ (= 0). **read rule ของ `expenses` เพิ่งเพิ่มที่ `bkk-frontend-next/database.rules.json`** — ต้อง deploy rules. Phase 4d (สมุดรายวัน double-entry + งบการเงิน) ยังไม่ทำ
- **Master gate (ตั้งค่าระบบบัญชี):** ทั้ง `onJobCreatedSendEmails` + `onJobStatusEmail` อ่าน `settings/accounting` (`loadAccountingSettings`) — ถ้า `order_emails_enabled !== true` = **inert สนิท** (ไม่ส่ง ไม่จองเลขใบกำกับ ไม่เขียน Storage) deploy ก่อนตั้ง Resend ได้ปลอดภัย. config อื่น: `vat_registered` (ปิด=ไม่ออกใบกำกับภาษี+ไม่แตก VAT), `vat_rate_percent` (default 7), `tax_invoice_prefix` (default `IV-`). resolve แล้ว stash ที่ `job._accounting` (in-memory) ให้ `serviceFeeBreakdown` ใช้. หน้า UI: `/accounting-settings` (`src/pages/admin/AccountingSettings.tsx`, CEO+FINANCE)
- **หน้าตั้งค่าอีเมล `/email-settings`** (`src/pages/admin/EmailSettings.tsx`, CEO+FINANCE, อยู่ใน settingsNav กลุ่ม Company) — เปิด/ปิดและแก้ข้อความอีเมลรายสถานะ
  - **เจ้าของ `settings/email_templates/{key}` เท่านั้น**: `customer_enabled` / `admin_enabled` (fail-open มีแต่ `false` ที่ปิด) + override `subject` / `heading` / `intro`. **master switch ยังเป็นของ `/accounting-settings`** (`order_emails_enabled`) หน้านี้แค่โชว์สถานะ+ลิงก์ไป ห้ามเขียนทับ
  - `key` = `statusEmailKey(status)` ตัวเดียวกับ idempotency slug + `order_created` (อีเมลตอนออเดอร์เข้า)
  - **เป็น override ไม่ใช่ replace** — ช่องว่าง = ใช้ข้อความ default จากโค้ดพร้อมเงื่อนไขครบ (Pickup/Mail-in/Store-in พูดคนละอย่าง ซึ่ง textarea แทนไม่ได้). placeholder `{ref} {name} {model} {payout} {brand} {method} {branch}` **escape ค่าที่แทนเสมอ** (ข้อความมาจากแอดมิน แต่ค่าที่แทนมาจากข้อมูลลูกค้า)
  - **`LOCKED_COPY_KEYS` (ตอนนี้มี `paid`) = เปิด/ปิดได้แต่แก้ถ้อยคำไม่ได้** — ใบสำคัญรับเงิน/สรุปการซื้อขายเป็นเอกสารทางบัญชี-ภาษี แก้อิสระแล้วผิดสาระสำคัญได้
  - logic อยู่ `functions/email-templates.js` (load/gate/render) + `email-templates-admin.js` (callable `adminEmailTemplateList`). **รายการเทมเพลตมาจาก server ไม่ hardcode ฝั่ง UI** — เพิ่ม entry ใน `STATUS_COPY` แล้วหน้าตั้งค่าขึ้นเอง ไม่เกิด mirror ตัวที่ 3. ตัวอย่างอีเมล render จาก **งานสมมติ** ไม่ใช่งานจริง (PDPA) และโชว์ใน iframe `sandbox=""`
  - `settings/email_templates` อยู่ใต้ `settings` ใช้ rule เดิม **ไม่ต้อง deploy rules**
- **Secrets ที่ต้องเพิ่ม:** `RESEND_API_KEY`, `EMAIL_FROM` (เช่น `BKK APPLE <noreply@bkkapple.com>`), `ORDER_NOTIFY_EMAIL` (อีเมลกลางแอดมิน). Optional: `EMAIL_REPLY_TO`, `CUSTOMER_TRACKING_BASE_URL` (ลิงก์ติดตามในอีเมลลูกค้า). ถ้าไม่ตั้ง `RESEND_API_KEY`/`EMAIL_FROM` → ระบบ skip การส่งเงียบๆ ไม่ crash

## Dealer Portal — ขายส่งยกล็อต + ประมูลปิดซอง (ส.ค. 2026)
- **แบรนด์แยกขาด: ฝั่งดีลเลอร์ = GETMOBIE ไม่ใช่ BKK APPLE** — BKK APPLE เป็นแบรนด์ฝั่ง "รับซื้อ" (B2C) เท่านั้น การเสนอขายส่งทำในนามนิติบุคคลจดทะเบียนโดยตรง (บริษัท เก็ทโมบี้ จำกัด / getmobie.com) ทุก touchpoint ฝั่งดีลเลอร์ (portal `app.getmobie.com`, อีเมล `dealerShell()`, ใบเสนอราคา trade name) ต้องเป็น GETMOBIE ห้ามหลุด BKK APPLE. อีเมลดีลเลอร์ตั้ง sender แยกได้ด้วย env `DEALER_EMAIL_FROM` (เช่น `GETMOBIE <noreply@getmobie.com>` — ต้อง verify โดเมน getmobie.com ใน Resend ก่อน ไม่ตั้ง = ใช้ EMAIL_FROM เดิม)
- **Bounded context แยกจากโดเมนหลัก** — ดีไซน์เต็มที่ `docs/dealer-portal-design.md`. โครง: แอปดีลเลอร์แยกที่ `dealer-portal/` (Vite app ของตัวเอง, hosting target `dealer` → site `getmobie-app` → ซับโดเมน `app.getmobie.com`, **ห้าม import จาก `src/`**), admin UI ใน `src/pages/dealers/`, logic ทั้งหมดใน `functions/dealer-portal.js` (index.js inject `dispatchAdminPush`/`dispatchTelegram`/`staffIdsByRoles` ผ่าน `registerDealerPortal`)
- **Node ใหม่:** `dealers/{uid}` (บัญชี = Firebase Auth, ไม่มี `/admins`), `lots/{id}` (snapshot สินค้า — ดีลเลอร์อ่านรายใบตาม `visible_tiers`+`tier_open_at` ใน rules), `lot_private/{lotId}` (ต้นทุน/reserve/ตัวนับซอง — admin เท่านั้น), `lot_bids/{lotId}/{dealerUid}` (**SEALED — rules ปิด read/write ทุกคนรวม admin**, เข้าถึงผ่าน callable เท่านั้น), `lot_audit` (append-only, bid events ไม่เก็บตัวตน), `dealer_orders/{id}` (ดีลเลอร์อ่านของตัวเอง), `settings/dealer` (tiers/prefix/บัญชีโอน — **ห้ามแตะ `*_seq_by_period` counter**)
- **Sealed bid:** ตัวนับ canonical ที่ `lot_private/{id}/bid_count`; mirror `lots/{id}/bid_stats` เฉพาะเมื่อ `show_bid_stats` (toggle กลยุทธ์ต่อ lot — default ดีลเลอร์ไม่เห็น 5/30). เปิดซอง `adminDealerLotUnsealBids` = CEO/MANAGER + lot ปิดรับแล้วเท่านั้น (ประทับ `unsealed_by`). award อ่านยอดจากซองจริงฝั่ง server — ไม่รับตัวเลขจาก client. reserve price อยู่ `lot_private` ต่ำกว่าต้องส่ง `below_reserve_ack`
- **จุดสัมผัสโดเมนหลักมี 4 จุดเท่านั้น (server ทำ):** publish อ่าน job รายตัว→snapshot + ล็อก `status: Reserved`+`lot_id`+`lot_no` (สถานะ `Reserved` เดิมไม่มีใครใช้ — ตอนนี้เป็นของ lot; Inventory กันแก้สถานะเครื่องติด lot, POS ปลอดภัยเพราะกรอง `Ready to Sell`) | cancel/award ปลดเครื่องคืน `prev_status` | markPaid ตัดสต๊อก `Sold`+`sold_channel:'dealer'` | markPaid เขียน `/sales` (มี `customer_tax_id` จาก dealer_snapshot) → `onSaleCreated` เดิมออกใบกำกับเต็มรูป+ลงบัญชี ภ.พ.30/P&L โดยไม่แก้อะไรเพิ่ม
- **เอกสาร:** ใบเสนอราคาออกอัตโนมัติตอน award (`buildQuotationPdf` ใน voucher-pdf.js, เลข `QT-YYYYMM-####` transaction ที่ `settings/dealer/quotation_seq_by_period`) archive `dealer_quotations/{orderId}.pdf` + แนบอีเมล. เลข lot `LOT-`, order `DO-` pattern เดียวกัน
- **Early access ตาม tier:** publish คำนวณ `tier_open_at` จาก `settings/dealer/tiers/{t}/early_access_min` — บังคับ 3 ชั้น (dealerListLots ซ่อน / dealerPlaceBid ปฏิเสธ / rules เช็ค `now`). scheduler `dealerLotScheduler` (5 นาที, query by status — ห้ามกวาดทั้ง node): ปิดรับอัตโนมัติ + ส่งเมล tier ที่เพิ่งถึงเวลา + เตือน 1 ชม.ก่อนปิดเฉพาะคนยังไม่เสนอ
- **Notification:** หมวด `dealer` (types: `dealer_bid`, `dealer_lot`, `dealer_payment`, `dealer_order`) — mirror 2 ไฟล์ตามกฎเดิม. ปิดรับ→push เจาะ CEO/MANAGER, สลิปเข้า→CEO/FINANCE. อีเมลดีลเลอร์ตามสถานะออเดอร์ = allowlist `ORDER_STATUS_COPY` ใน dealer-portal.js
- **MIRROR types 3 ที่:** `src/types/dealer.ts` (admin) ↔ `dealer-portal/src/types.ts` (portal) ↔ enum ใน `functions/dealer-portal.js` — เพิ่มสถานะ lot/order หรือ tier ต้อง sync ทั้ง 3 (สถานะพวกนี้**ไม่เกี่ยว**กับ `job-statuses.ts`)
- **ชื่อ callable ทุกตัว prefix `adminDealer*`/`dealer*`** ตามกฎ namespace `{region}/{name}`
- **Landing getmobie.com (`getmobie-landing/`):** static site ล้วน (ไม่มี build) hosting target `www` → site `getmobie-landing` — ฟอร์มสมัครดีลเลอร์ยิง callable `dealerRegister` ตรงผ่าน HTTP (โปรโตคอล callable `POST {data}`, ไม่พ่วง Firebase SDK, มี honeypot `website`) → เขียน `dealer_applications/{id}` (rules: admin read, write ปิด — **ไม่สร้าง Auth user ตอนสมัคร**) + push/Telegram แจ้ง CEO/MANAGER + อีเมลยืนยันผู้สมัคร. แอดมินอนุมัติที่ `/dealers` (การ์ดใบสมัคร → prefill โมดอลสร้างบัญชี → `adminDealerCreate` รับ `applicationId` ไปปิดใบสมัคร) หรือปฏิเสธผ่าน `adminDealerApplicationReject`
- **Setup ครั้งเดียวก่อนใช้จริง:** สร้าง custom domain `app.getmobie.com` ชี้ site `getmobie-app` + `getmobie.com` ชี้ site `getmobie-landing` ใน Firebase console + เพิ่ม `app.getmobie.com` ใน Auth Authorized domains + deploy rules จาก bkk-frontend-next + (optional) env `DEALER_PORTAL_BASE_URL` ใน functions/.env ถ้าไม่ใช่ค่า default

## ภาษีหัก ณ ที่จ่าย ค่าตอบแทนไรเดอร์ (ส.ค. 2026)
- **จุดที่หักคือ "ตอนถอน" ไม่ใช่ "ตอนอนุมัติค่ารอบเข้า wallet"** — อนุมัติค่ารอบ = ตั้งหนี้ (เงินยังไม่ออกจากบัญชีบริษัท), ถอน = จ่ายเงินจริงมีสลิปเป็นหลักฐาน. หน้าที่หักภาษีเกิดเมื่อ "จ่ายเงินได้" จึงผูกกับการถอน. ผลพลอยได้: ยอดหักสะสมทั้งปี = 3% ของเงินที่ไรเดอร์ได้รับจริงพอดี ไม่ต้องกระทบยอดย้อนหลังเมื่อถอนไม่หมด
- **หักเฉพาะ `riders/{id}/employment.type === 'freelance'`** — `employee` = เงินได้ ม.40(1) หักที่ payroll (ภ.ง.ด.1) ไม่หักรายครั้ง | **ไม่ระบุ = บล็อกการโอน** (จอ Rider Withdrawals disable ปุ่ม) เพราะเดาผิดทางแปลว่าหักคนที่ไม่ควรหัก หรือปล่อยคนที่ควรหัก ซึ่งเรียกคืนย้อนหลังยาก
- **master switch `settings/accounting/rider_wht.enabled` ปิดเป็นค่าเริ่มต้น** — เปิดแล้วไรเดอร์ได้เงินน้อยลงจากเดิม ต้องแจ้งเขาก่อน ไม่ใช่แค่ deploy. `rate_percent` default 3 (ค่าจ้างทำของ/ค่าบริการ) ตั้งที่ `/accounting-settings`
- **MIRROR สูตร 3 ที่:** `functions/rider-wht.js` (ตัวจริง ออกเอกสาร) ↔ `src/utils/riderWht.ts` (จอ finance ต้องโชว์ยอดโอนสุทธิก่อนโอน) ↔ `bkk-rider-app/src/utils/riderWht.ts` (ไรเดอร์ต้องเห็นก่อนกดถอน) — **แก้สูตรต้องแก้ทั้งสาม**
- **`wallet` ลดเต็มยอดที่ขอถอน** ไม่ใช่ยอดสุทธิ — ภาษีที่หักคือเงินของไรเดอร์ที่บริษัทนำส่งแทน ไม่ใช่เงินที่ไม่เคยเป็นของเขา. `transactions/{id}` เก็บ `amount` (เต็ม) + `wht_amount` + `net_paid` (โอนจริง)
- **เอกสาร 50 ทวิ ออกต่อการถอน 1 ครั้ง** (ม.50 ทวิ: ออกทุกครั้งที่หัก ไม่ใช่สรุปท้ายเดือน) — trigger `onRiderWhtWithheld` (`functions/rider-wht-issue.js`) ยิงเมื่อ `transactions/{id}` category `WITHDRAWAL` ที่มี `wht_amount`: จองเลข `WHT-YYYYMM-####` (transaction ที่ `settings/accounting/wht_seq_by_period/{ym}`) → สร้าง PDF (`buildWhtCertificatePdf`) → archive `wht_certificates/{id}.pdf` → เขียนทะเบียน `wht_certificates/{id}` + สำเนาบนงานถอน `jobs/{id}/wht_certificate` (ไรเดอร์อ่านงานตัวเองได้อยู่แล้ว **ไม่ต้องเพิ่ม rule ให้ไรเดอร์**) → อีเมลแนบ PDF. สร้างไม่สำเร็จ = ลงทะเบียนเป็น `status: "void"` เหมือนใบกำกับภาษี ไม่ปล่อยเลขหายเงียบ
- **`/wht-report` (CEO+FINANCE) เป็นส่วนบังคับ ไม่ใช่ของแถม** — ภาษีที่หักไว้**ไม่ใช่รายได้บริษัท** แต่เป็นเงินของไรเดอร์ที่ถือไว้แทนและต้องนำส่งภายในวันที่ 7 ของเดือนถัดไป ถ้าไม่มีหน้าบอกยอดค้างนำส่ง เงินจะนอนปนในบัญชีแล้วลืมยื่น = เบี้ยปรับ. query ตาม `.indexOn: period`
- **read rule ของ `wht_certificates` อยู่ที่ `bkk-frontend-next/database.rules.json`** (admin read, write ปิด) — **ต้อง deploy rules จาก repo นั้น**
- **แอปไรเดอร์ต้องขึ้นพร้อมกัน** — `WithdrawModal` แสดง "ขอถอน / หัก / ได้รับจริง" ก่อนกดยืนยัน ถ้าเปิดสวิตช์โดยแอปยังไม่แก้ ไรเดอร์จะรู้ตอนเงินเข้าแล้วว่าได้ไม่ครบ

## Coupons / Review Reward Ledger
- **Master campaign:** `/coupons` (จัดการที่ `/coupons` — `CouponManager.tsx`). save เขียน `is_model_restricted` คู่กับ `applicable_models` (true เมื่อระบุรุ่นเอง) — ฝั่งลูกค้า (`bkk-frontend-next`) ใช้แยก "ไม่จำกัดรุ่น" ([] + false) ออกจาก "จำกัดแต่ config ขาด" (fail closed)
- **Review reward:** ลูกค้ารีวิว → `bkk-frontend-next` `app/api/reviews/submit` mint คูปองลง `users/{uid}/coupons` (code `THX-xxxx`, `coupon_id` ชี้ master ร่วม `/coupons/REVIEW_REWARD` ที่ `system: true`) + เขียน ledger `/issued_coupons/{id}`
- **Ledger `/issued_coupons/{id}`:** `{ code, value, uid, review_id, job_id, issued_at, expires_at, status: issued|used, used_at, used_job_id }`. ออกตอนรีวิว (status `issued`), `validateAndCreateOrder` flip เป็น `used` ตอน redeem. **read rule = admin** (อยู่ที่ `bkk-frontend-next/database.rules.json` — deploy จาก repo นั้น)
- **หน้า reconcile:** `/issued-coupons` (`src/pages/admin/IssuedCoupons.tsx`, CEO/MANAGER/FINANCE) — ตาราง issued vs used vs expired + มูลค่า + cross-check กับ `/reviews` (flag ใบที่ used แต่ไม่พบรีวิว) + export CSV

## Role-Based Access & Staff Accounts (สถาปัตยกรรมใหม่ ส.ค. 2026)
- **พนักงานแต่ละคนมีบัญชี Firebase Auth ของตัวเอง** (อีเมล+รหัสผ่านส่วนตัว) — เลิกใช้บัญชีมาสเตอร์ร่วม + เลือกชื่อ + PIN แล้ว. `LoginScreen` เป็น email/password ขั้นตอนเดียว
- **วงจรบัญชีทั้งหมดผ่าน cloud functions เท่านั้น** (`functions/staff-accounts.js` — CEO-gated ฝั่ง server ด้วยอีเมลใน auth token): `adminStaffCreate` / `adminStaffUpdate` / `adminStaffSetStatus` / `adminStaffDelete` / `adminStaffResetPassword`. **database rules ปิด client write ที่ `/staff` และ `/admins` แล้ว** (แก้ที่ `bkk-frontend-next/database.rules.json` — ต้อง deploy จาก repo นั้น) — Admin SDK ใน functions เป็นผู้เขียนคนเดียว. functions สร้าง/ถอน `/admins/{uid}` คู่กับบัญชีเสมอ
- **พักงาน (INACTIVE) บังคับ 3 ชั้น:** auth user ถูก disable (login ใหม่ไม่ได้) + revoke refresh tokens + ลบ `/admins/{uid}` (rules ตัดสิทธิ์ทันที). ฝั่ง client `useStaffSession` เฝ้า `staff/{id}/status` แบบ realtime — ถูกพักงานปุ๊บ session ที่เปิดค้างโดนเตะออกทันที. ไม่มี fallback "ไม่รู้จัก = role STAFF" อีกแล้ว: อีเมลที่ไม่ match staff record ที่ ACTIVE จะถูก sign out
- Role ที่ระบบรู้จักมี **4 ค่าเท่านั้น**: CEO / MANAGER / STAFF / FINANCE (route guard ใน `App.tsx`, `settingsNav.tsx`, `AdminLayout`, `canReviewAdjustments`, `functions/staffIdsByRoles`) — ค่าเก่า CASHIER/QC ถูกเลิกใช้ หน้า `/staff` จะ flag ให้แก้
- **CEO:** เข้าถึงทุกฟีเจอร์ + จัดการบัญชีพนักงาน
- **MANAGER:** เข้าถึงเกือบทุกฟีเจอร์ (ยกเว้น Staff Management, Global Settings, รายงานการเงิน/ภาษี)
- **STAFF:** เข้าถึงฟีเจอร์พื้นฐาน (Tickets, QC, คลัง, POS) — เสนอ Offer ได้แต่ต้องรอ CEO/MANAGER อนุมัติ
- **FINANCE:** เข้าถึง Finance, Daily Expenses, P&L, ภ.พ.30, สมุดรายวัน, ตั้งค่าระบบบัญชี
- **การผูก role ใช้อีเมล:** staff record มี `email` (lowercase) + `uid` ของบัญชี Auth — `useStaffSession` ฝั่ง client และ `lookupStaffByAuth` ฝั่ง functions จับคู่ด้วยอีเมล
- **FCM token ต้อง key ด้วย staff push id** (`admin_fcm_tokens/{staffId}`) ไม่ใช่ Firebase uid — push แบบเจาะ role (`staffIdsByRoles` → `dispatchAdminPush(allowStaffIds)`) ฟิลเตอร์ด้วย staff id; session มี `id` เสมอ call sites ใช้ `currentUser?.id || currentUser?.uid`

## RTDB Cost Rules (บทเรียนจากบิล ก.ค. 2026 — อย่าทำพัง)
- **ห้าม scheduler อ่าน `/jobs` ทั้งก้อน** — ใช้ `fetchJobsByStatuses()` (query ตาม `.indexOn: status`) เสมอ. `checkOverdueReturns` รันทุก 5 นาที เคยกวาดทั้ง node = ~288 full download/วัน ลงบิลตรงๆ. ข้อยกเว้นที่ตั้งใจ: `autoFlagRiders` (วันละครั้ง ต้องดูทุกงานใน lookback) และ endpoint migration แบบ manual
- **ห้าม client subscribe `/jobs` ทั้งก้อนจากอุปกรณ์จำนวนมาก** — rider ใช้ `useRiderJobs` (query rider_id + pool statuses). แอดมินใช้ shared keep-alive store ใน `useDatabase` (listener ต่อ path ตัวเดียวทั้งแอป ห้ามกลับไป subscribe/unsubscribe ต่อหน้า)
- **ISR ฝั่ง bkk-frontend-next = 300s** — ห้ามลดต่ำกว่านี้โดยไม่คิดเรื่องบิล (ทุก revalidate = ดึง `/models.json` ทั้งก้อน)

## Known Issues & Workarounds
- **VAPID Key + atob():** Firebase SDK ใช้ `atob()` ภายใน `getToken()` ซึ่ง fail กับ base64url ไม่มี padding → ต้อง patch `window.atob` ชั่วคราว (ดู `useAdminPushNotifications.ts`)
- **Service Worker Config:** `firebase-messaging-sw.js` ใช้ Firebase config แบบ hardcode (ไม่ใช่ env vars) — ถ้าเปลี่ยน Firebase project ต้องแก้ไฟล์นี้ด้วย

## Important Notes
- ก่อน push ให้ตรวจสอบว่า TypeScript compile ผ่าน (`tsc --noEmit`)
- ถ้าแก้ Cloud Functions ต้องรอ GitHub Actions deploy functions ด้วย (ไม่ใช่แค่ hosting)
- เทสบน Chrome DevTools ≠ เทสบน iPhone จริง (โดยเฉพาะ push notification)
- iOS PWA มีข้อจำกัดเรื่อง service worker และ push ที่ต่างจาก Android/Chrome
- ถ้าลองแก้ปัญหาเดิม 2 ครั้งแล้วไม่สำเร็จ → หยุดวิเคราะห์ root cause ให้ลึกก่อน อย่าแก้วน
