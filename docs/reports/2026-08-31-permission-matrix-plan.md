# Permission inventory + แผน Permission Matrix — bkk-system

- วันที่: 2026-08-31 · ประเภทงาน: **survey + plan เท่านั้น ไม่มีโค้ด implementation**
- เลขบรรทัดทุกตัวผูกกับ `bkk-system` commit `ed69290` (origin/main ณ วันสำรวจ)
- เอกสารตั้งต้น: `docs/reports/2026-08-29-auth-rbac-survey.md` ใน bkk-frontend-next — **ไฟล์นั้นยังไม่อยู่บน main** อยู่บน branch `claude/auth-permission-cross-repo-survey-71kuza` (อ่านจาก branch นั้นแล้ว ใช้เป็นฐานของรายงานนี้)
- การตัดสินใจใหม่ที่รายงานนี้รองรับ: **permission matrix แก้ได้จากหน้า settings** (เลิกแบบ role ฮาร์ดโค้ดล้วน) · role คงเดิม 4 ค่า CEO / MANAGER / STAFF / FINANCE · ขอบเขตเฉพาะ bkk-system

## ข้อเท็จจริงฐานที่ทุกส่วนอ้างถึง (จาก survey เดิม ยืนยันกับโค้ดปัจจุบันแล้ว)

1. **RTDB rules รู้จักสิทธิ์แค่ boolean เดียว** — `admins/{uid}/role === 'admin'` (120 จุดใน `bkk-frontend-next/database.rules.json`) และ `admins/{uid}/role` ถูกเขียนเป็นค่าคงที่ `"admin"` เสมอ (`functions/staff-accounts.js:157`, `:251`) — role ธุรกิจไม่เคยไปถึงชั้น rules ดังนั้น **STAFF กับ CEO มีอำนาจอ่าน/เขียนชั้นข้อมูลเท่ากันทุก byte**
2. ผลคือ gate ปัจจุบันมี 4 แบบ และตาราง inventory ใช้คำเหล่านี้:
   - **client-only** = เช็ค role ใน UI/route เท่านั้น ชั้นข้อมูลเป็น admin boolean → role อื่นยิงเขียนตรงผ่าน SDK ได้
   - **admin-boolean** = ไม่เช็ค role เลยแม้ใน UI (ทุก role ที่ login เข้าได้/กดได้) หรือ callable ที่เช็คแค่เป็นแอดมิน
   - **server:ROLE** = callable เช็ค role จริงฝั่ง server (ปลอมไม่ได้)
   - **secret / ไม่มี gate** = ตามตัวอักษร
3. จำนวนที่กวาดได้รอบนี้: จุดเขียน RTDB จาก client **242 จุด** (ในนั้น `remove()` 20 จุด + multi-path `null` delete 2 จุด), callable/HTTP ฝั่ง functions **72 ตัว**, trigger/scheduler 39 ตัว, external API จาก client = 0 `fetch` (ทั้งหมดผ่าน callable SDK; ที่ออกนอกจริงคือ Google Maps JS/Geocoder + barcode/CDN — รายละเอียดในตาราง)

---

# ส่วนที่ 1 — Permission inventory

วิธีอ่านตาราง:
- **key** = permission key ตั้งให้นิ่ง (snake_case) จะไม่เปลี่ยนอีก — แยก "ดู" กับ "แก้" คนละ key เสมอ
- **คำอธิบาย** = ภาษาที่จะแสดงในหน้า settings จริง (เขียนสำหรับคนไม่ใช่โปรแกรมเมอร์)
- **จุดที่ต้องบังคับสิทธิ์** = file:line ของ route / ปุ่ม / จุดเขียนข้อมูล / callable ที่ key นี้ครอบ (จุดเขียนที่อยู่ใน flow เดียวกันรวมไว้ในแถวเดียว)
- **HIGH** = แตะเงิน ราคา ลบถาวร หรือสิทธิ์ผู้ใช้

| key | คำอธิบาย (แสดงในหน้า settings) | จุดที่ต้องบังคับสิทธิ์ (file:line) | gate ปัจจุบัน | HIGH |
|---|---|---|---|---|
| **— ราคา / แคตตาล็อก —** | | | | |
| `catalog_view` | เปิดดูหน้าแคตตาล็อกราคารับซื้อ (Price Editor) | route `src/App.tsx:171-172`, mobile `src/App.tsx:125-126`, เมนู `src/components/layout/AdminLayout.tsx:243`, `src/pages/settings/settingsNav.tsx:50-51` | client-only (CEO/MANAGER) | — |
| `catalog_price_edit` | แก้ราคารับซื้อของรุ่นสินค้า รวมการปรับราคาทีละหลายรุ่น | `src/features/trade-in/PriceEditor.tsx:515` (บันทึกรุ่น), `:545` (แถว price_ledger), `src/features/trade-in/modals/BatchPriceAdjustModal.tsx:94`, `:102` | client-only (route CEO/MANAGER; `models` write = admin boolean) | **HIGH** |
| `catalog_model_manage` | เพิ่ม/ลบรุ่นสินค้า เปิด-ปิดการรับซื้อ นำเข้ารุ่นเลิกผลิต | `PriceEditor.tsx:518` (สร้าง), `:558` (**ลบถาวร**), `:559-560` (เปิด/ปิด/แนะนำ), `:591` (เติมชื่อเรียก), `:615` (นำเข้า), `:331` (backfill อุปกรณ์เสริม) | client-only | **HIGH** |
| `catalog_structure_manage` | จัดการหมวดหมู่ แบรนด์ ซีรีส์ และหมวดย่อยของสินค้า | `src/features/trade-in/modals/CategoryBrandManagementModal.tsx:50,83,108,154,163,177` (ลบ `:108`, `:177`), `SeriesManagementModal.tsx:39,66,90` (ลบ `:90`), `SubcategoryManagementModal.tsx:75,93,105,124` (ลบ `:124`), `src/features/trade-in/ModelEditorPage.tsx:194` | client-only | **HIGH** (มีลบถาวร) |
| `condition_sets_edit` | แก้ชุดเงื่อนไขหักราคาตามสภาพเครื่อง (กระทบราคาที่ลูกค้าได้ทันที) | `src/features/trade-in/utils/conditionSets.ts:55`, `modals/EngineSettingsModal.tsx:146`, `:189` (**ลบชุด**), `ModelEditorPage.tsx:180` (clone), `utils/perModelConditionSets.ts:142` (แตกชุดรายรุ่น) | client-only | **HIGH** |
| **— ออเดอร์ / งานรับซื้อ —** | | | | |
| `tickets_view` | ดูรายการงานและรายละเอียดงานทั้งหมด | route `src/App.tsx:134-135`, mobile `:121-122` | admin-boolean (ไม่เช็ค role) | — |
| `tickets_create` | สร้างงานใหม่ (B2C / Instant Sell / B2B) | `src/features/trade-in/TradeInDashboard.tsx:133`, `:167`, `:208` | admin-boolean | — |
| `tickets_edit` | แก้ไขข้อมูลงานทั่วไป: ข้อมูลลูกค้า สถานะงาน รับงานเป็นเจ้าของ เลขพัสดุ โน้ต เปิด/ปิดเคสซ้ำ | `TradeInDashboard.tsx:234,274,297,319,325`, `src/pages/admin/B2CWorkspacePage.tsx:83,147,152,162,334,345,357,394,401,420,425,434`, `src/pages/mobile/MobileTicketDetail.tsx:506,527,538,588,606,641,655,662`, `src/pages/admin/components/CustomerInfoCard.tsx:52`, `components/ThaiPostTracking.tsx:78-79`, `src/features/trade-in/components/b2c/B2CWorkspace.tsx:93`, `src/services/jobService.ts:40,44`, `src/components/device/BatteryHealthCard.tsx:86`, `src/pages/crm/WarrantyClaims.tsx:105` | admin-boolean (mobile แก้ไข/ลบมี client gate `MobileTicketDetail.tsx:891-892` เฉพาะปุ่ม แก้ไข=CEO/MANAGER, ลบ=CEO) | — |
| `tickets_price_edit` | แก้ราคา/ยอดจ่ายของงานโดยตรง (ช่องแก้ราคาในโมดอลแก้ไขงาน) | `MobileTicketDetail.tsx:869` | client-only (ปุ่มเปิดโมดอล CEO/MANAGER `MobileTicketDetail.tsx:891`) | **HIGH** |
| `tickets_delete` | ลบใบงานทิ้งถาวร | `MobileTicketDetail.tsx:883` | client-only (ปุ่ม CEO เท่านั้น `MobileTicketDetail.tsx:892`; ชั้นข้อมูล admin boolean) | **HIGH** |
| `tickets_method_edit` | เปลี่ยนวิธีรับเครื่อง (Pickup/Store-in/Mail-in) เลื่อนนัดหมาย ปรับจุดรับเครื่อง กดรับพัสดุ | `src/pages/admin/components/PricingSidebar.tsx:290` (method), `:344` (นัด), `:659,675` (รับพัสดุ) — เงินให้ cloud function คิดต่อ (`onReceiveMethodChanged`) | admin-boolean | — |
| `offer_propose` | เสนอรายการหัก/เพิ่มเงิน (Offer) — role อื่นเข้าคิวรออนุมัติ | `B2CWorkspacePage.tsx:217`, `MobileTicketDetail.tsx:395`, ฟอร์มใน `PricingSidebar.tsx:436` | admin-boolean (ผลลัพธ์ applied/pending ตัดสินด้วย `src/utils/adjustments.ts:39` ฝั่ง client) | — |
| `offer_approve` | อนุมัติ/ปฏิเสธ/ลบ Offer และตัดสินข้อเสนอราคาจากลูกค้า | `B2CWorkspacePage.tsx:243,283,304,314,321`, `MobileTicketDetail.tsx:336,346,353,426,492`, `PricingSidebar.tsx:368,488,508` — ตัวตัดสิน `src/utils/adjustments.ts:39` (`canReviewAdjustments` CEO/MANAGER) | client-only (`onAdminOfferProposed` `functions/index.js:3821` แค่แจ้งเตือน ไม่ validate) | **HIGH** |
| `coupon_on_job_edit` | เพิ่ม (Top-up) หรือดึงคูปองออกจากงาน | `B2CWorkspacePage.tsx:169,182`, `MobileTicketDetail.tsx:444,459` | client-only (UI ให้ CEO/MANAGER ผ่าน `isPrivileged` `MobileTicketDetail.tsx:293`) | **HIGH** |
| `rider_discount_on_job_edit` | แก้/ลบส่วนลดค่าไรเดอร์บนงาน | `B2CWorkspacePage.tsx:261`, `MobileTicketDetail.tsx:474` | client-only | **HIGH** |
| `amendment_review` | อนุมัติ/ปฏิเสธคำขอแก้ราคาที่ไรเดอร์ส่งจากหน้างาน | `src/pages/admin/components/AmendmentReviewModal.tsx:150` (ปฏิเสธ), `:357` (อนุมัติ) → callable `reviewAmendment` `functions/index.js:4592` | **admin-boolean ฝั่ง server** (`functions/index.js:4605-4607` เช็คแค่เป็นแอดมิน ไม่แยก role) | **HIGH** |
| `qc_submit` | บันทึกผลตรวจสภาพ/QC ซึ่งคำนวณราคาสุทธิใหม่ + แตกอุปกรณ์เสริมเข้าสต๊อก | `src/utils/qcStation.ts:133,186`, `src/pages/lab/QCStation.tsx:173`, `src/features/trade-in/components/qc/InternalQCModal.tsx:323`, `src/pages/mobile/components/AdminInspectionModal.tsx:341`, `AdminDeviceVerificationModal.tsx:144`, `src/utils/accessoryItems.ts:145` | admin-boolean | **HIGH** (เขียน final_price/net_payout) |
| `b2b_manage` | จัดการงาน B2B: แตกกล่อง ตรวจนับ ส่งใบเสนอราคาเบื้องต้น | `src/features/trade-in/components/b2b/B2BManager.tsx:87,112,129,141,221`, `B2BAuditorTool.tsx:151,168,189`, `src/pages/admin/B2BDispatchQueue.tsx:90,107,121,187` (`:187` = ส่ง pre-quote ผูกราคา) | admin-boolean | **HIGH** (pre-quote ผูกราคา) |
| `kyc_record` | บันทึกข้อมูลยืนยันตัวตนลูกค้า (KYC) | `src/pages/mobile/components/AdminKYCModal.tsx:213`, upload ผ่าน `src/utils/uploadImage.ts:71` | admin-boolean | — |
| `kyc_delete` | ลบ/รีเซ็ตข้อมูล KYC และไฟล์ภาพถาวร | `src/pages/admin/components/KYCInfoCard.tsx:170` (ลบข้อมูล), `:180` (ลบไฟล์ Storage) | client-only (ปุ่ม CEO/MANAGER `KYCInfoCard.tsx:151`) | **HIGH** |
| `sickw_check` | ยิงตรวจเครื่องกับ SICKW (เสียเครดิตเงินจริงต่อครั้ง) | `src/utils/sickwApi.ts:92,196` → callable `functions/index.js:5476`, `:6119`; ปุ่มใน `SickwDeviceCheck.tsx:127,132`, `SickwStoredResultCard.tsx:145,147` | **auth-only ฝั่ง server** (`index.js:5477`, `:6120` — บัญชีลูกค้าใน tenant เดียวกันก็เรียกได้) | **HIGH** |
| `sickw_gate_override` | สั่งข้ามด่านตรวจ SICKW ของงาน | `src/utils/sickwApi.ts:107` → `functions/index.js:5854`, gate `:5873-5876` | **server:CEO/MANAGER** (ของจริงตัวเดียวในกลุ่มงาน) | **HIGH** |
| `sickw_sync` | ซิงก์ผลตรวจ SICKW ที่มีอยู่แล้วเข้าใบงาน | `src/utils/sickwApi.ts:184` → `functions/index.js:5928` | auth-only (คอมเมนต์ที่ `index.js:5948` อ้างว่ามี role check แต่โค้ดไม่ได้เช็ค — `lookupStaffByAuth` ที่ `:5949` ใช้แค่ทำ audit string) | — |
| `diagnos_session_create` | สร้างเซสชันตรวจสภาพให้ลูกค้า (QR/ลิงก์) | `src/components/DiagnosStartPanel.tsx:62` → `functions/diagnostics.js:156` (gate `:175-182`) | server: rider ของงาน หรือ admin-boolean | — |
| `vision_ocr` | อ่านข้อมูลจากภาพถ่าย (บัตรประชาชน/IMEI/แบต) ด้วย OCR | `src/utils/visionOcr.ts:56` → callable `extractFromImage` (อยู่ repo bkk-frontend-next: `functions/src/index.ts:2339`, gate auth-only `functions/src/vision/extractFromImage.ts:36`) | auth-only (ข้าม repo) | — |
| **— ลูกค้า —** | | | | |
| `crm_view` | ดูฐานข้อมูลลูกค้า (CRM) | route `src/App.tsx:157` | admin-boolean | — |
| `crm_edit` | เพิ่ม/แก้ข้อมูลลูกค้า | `src/pages/crm/CustomerCRM.tsx:64,66`, upsert จาก POS `src/pages/sales/POS.tsx:152` | admin-boolean | — |
| `crm_delete` | ลบข้อมูลลูกค้าถาวร | `CustomerCRM.tsx:181` (**ปุ่มถังขยะ ไม่มีเช็ค role ใดๆ**) | admin-boolean | **HIGH** |
| `crm_backfill` | รันเชื่อมข้อมูลลูกค้าย้อนหลัง (เครื่องมือครั้งเดียว) | `src/pages/crm/Customers.tsx:34` → `functions/index.js:6551` (gate `:6554-6557`) | admin-boolean ฝั่ง server | — |
| `chat_view` | เปิดอ่านแชทลูกค้า (inbox) — การเปิดจะ mark อ่านแล้ว | `src/pages/inbox/InboxPage.tsx:276,280` | admin-boolean | — |
| `chat_operate` | ตอบแชทลูกค้า takeover จาก AI ปิดเคส ติดแท็ก รวม/แยกบัญชี สร้างบทสนทนา | `InboxPage.tsx:586,593,603,618,624,644,651,667,698,705,721,737,783,801,1688`, `:348,352` (แท็ก), `:368,380` (ให้คะแนน AI), `ContactEditModal.tsx:82`, แชทหาไรเดอร์ `src/utils/jobChats.ts:46,48,67,69`, `MobileTicketDetail.tsx:253,256` | admin-boolean | — |
| `chat_quote_send` | ส่งใบเสนอราคาในแชท (ผูกราคาที่เสนอให้ลูกค้า) | `src/pages/inbox/QuoteComposer.tsx:260,270,280` | admin-boolean | **HIGH** |
| `chat_delete` | ลบบทสนทนาทั้งกล่องถาวร | `InboxPage.tsx:762` | admin-boolean | **HIGH** |
| `chat_ai_assist` | ให้ AI ช่วยร่างคำตอบ (เสียเครดิต Anthropic ต่อครั้ง) | `InboxPage.tsx:395` → `functions/chat-ai.js:4948` (gate `:4951` auth-only — เปิดอ่าน transcript ลูกค้า convo ไหนก็ได้) | auth-only ฝั่ง server | **HIGH** (เงิน API) |
| `reviews_manage` | อนุมัติ/ปฏิเสธ/ลบรีวิวลูกค้า | `src/pages/admin/ReviewManager.tsx:43`, `:55` (**ลบถาวร**); route `src/App.tsx:175` | client-only (CEO/MANAGER) | **HIGH** (ลบถาวร) |
| **— ไรเดอร์ —** | | | | |
| `riders_view` | ดูทะเบียนไรเดอร์ | route `src/App.tsx:153` (**ไม่มี role gate — ทุก role เข้าได้**) | admin-boolean | — |
| `riders_manage` | อนุมัติ/พัก/คืนสถานะไรเดอร์ แก้โปรไฟล์และประเภทยานพาหนะ (กระทบอัตราค่าจ้าง) | `src/pages/fleet/RiderManagement.tsx:148,166,182,197,229` (**ไม่มีเช็ค role แม้ใน UI**) | admin-boolean | **HIGH** |
| `riders_delete` | ลบบัญชีไรเดอร์ถาวร | `RiderManagement.tsx:238` | admin-boolean | **HIGH** |
| `dispatch_assign` | จ่ายงาน/ถอนงานให้ไรเดอร์ และสลับโหมด dispatch | `src/pages/fleet/DispatcherPage.tsx:109,117,130` | admin-boolean | — |
| `discrepancy_resolve` | ปิด/เปิดรายงานความผิดปกติจากหน้างาน | `src/pages/fleet/DiscrepancyReports.tsx:111,126` | admin-boolean | — |
| `rider_performance_view` | ดูรายงานประสิทธิภาพไรเดอร์ | route `src/App.tsx:154-155` | client-only (CEO/MANAGER) | — |
| `rider_fee_promos_manage` | จัดการโปรโมชันส่วนลดค่าไรเดอร์ | `src/pages/admin/RiderFeePromotions.tsx:340,343,354,363` (ลบ `:354`); route `src/App.tsx:190` | client-only (CEO/MANAGER) | **HIGH** |
| `rider_settlement_approve` | อนุมัติค่ารอบไรเดอร์เข้ากระเป๋าเงิน (ตั้งหนี้บริษัท) | `src/pages/finance/SettlementPage.tsx:41,74`, `components/RiderSettlements.tsx:57,86` | client-only (อยู่ใต้ route `/finance` `src/App.tsx:151` CEO/MANAGER/FINANCE) | **HIGH** |
| `rider_withdrawal_transfer` | ยืนยันโอนเงินถอนให้ไรเดอร์ (เงินออกจริง + หัก WHT) | `src/pages/finance/components/RiderWithdrawals.tsx:123`, `WithdrawalPage.tsx:131` | client-only (ใต้ `/finance`) | **HIGH** |
| **— การเงิน —** | | | | |
| `finance_view` | เปิดหน้าการเงิน (จ่ายเงินลูกค้า/ค่ารอบ/ถอนเงิน) | desktop route `src/App.tsx:151` (CEO/MANAGER/FINANCE) แต่ **mobile route `src/App.tsx:123` ไม่มี gate** | client-only ครึ่งเดียว | — |
| `payout_transfer` | ยืนยันจ่ายเงินค่าเครื่องให้ลูกค้า (เงินออกจริง) | `src/pages/finance/components/TradeInPayouts.tsx:184`, **`src/pages/mobile/MobileFinancePage.tsx:199` — เข้าถึงได้ทุก role ผ่าน `/mobile/finance`** (ไฟล์นี้ไม่เช็ค role เลย ใช้ `currentUser` แค่ใส่ชื่อ `MobileFinancePage.tsx:158,166`) | admin-boolean (mobile) / client-only (desktop) | **HIGH** |
| `transaction_repair` | ซ่อม/เพิ่มรายการ transaction ย้อนหลัง | `src/pages/finance/components/TransactionRepair.tsx:116` | client-only (ใต้ `/finance`) | **HIGH** |
| `expenses_record` | บันทึกค่าใช้จ่ายรายวัน | `src/pages/finance/DailyExpenses.tsx:40`; route `src/App.tsx:152` | client-only (CEO/MANAGER/FINANCE) | — |
| `expenses_delete` | ลบรายการค่าใช้จ่าย | `DailyExpenses.tsx:59` (ปุ่ม gate CEO/MANAGER `DailyExpenses.tsx:190,218`) | client-only | **HIGH** |
| `test_data_cleanup` | ลบงาน+transaction เป็นชุด (เครื่องมือล้างข้อมูลทดสอบ — จุดทำลายล้างสูงสุดของระบบ) | `src/pages/finance/components/DataCleanup.tsx:121` | client-only (ใต้ `/finance`) | **HIGH** |
| `tax_reports_view` | ดูรายงานภาษี ภ.พ.30 / ภ.ง.ด.3 | routes `src/App.tsx:177` (/vat-report), `:178` (/wht-report) | client-only (CEO/FINANCE; ข้อมูล `accounting_documents`/`wht_certificates` อ่านตรง = admin boolean) | — |
| `financial_report_view` | ดูรายงานกำไรขาดทุน (P&L) | route `src/App.tsx:179` | client-only (CEO/FINANCE) | — |
| `ledger_view` | เปิดดูสมุดรายวัน (General Ledger) | route `src/App.tsx:180` | client-only (CEO/FINANCE) | — |
| `ledger_edit` | ลงรายการบัญชีในสมุดรายวัน | `src/pages/admin/GeneralLedger.tsx:81` | client-only (`journal_entries` write = admin boolean → STAFF ลงบัญชีตรงได้) | **HIGH** |
| `accounting_settings_edit` | ตั้งค่าระบบบัญชี: VAT, WHT ไรเดอร์, ข้อมูลนิติบุคคล, **รีเซ็ตเลขรันใบกำกับภาษี** | `src/pages/admin/AccountingSettings.tsx:217` (รีเซ็ตเลข), `:237` (บันทึก); route `src/App.tsx:195` | client-only (CEO/FINANCE) | **HIGH** |
| `dealer_finance_ops` | ยืนยันรับชำระเงินดีลเลอร์ / คืนเงินเคลม | `src/pages/dealers/DealerOrders.tsx:127` → `functions/dealer-portal.js:2660` (gate `:2662` CEO/FINANCE), `DealerClaims.tsx:119` → `:2175` (gate `:2177` CEO/FINANCE) | **server:CEO/FINANCE** | **HIGH** |
| **— คลังสินค้า / การขาย —** | | | | |
| `inventory_view` | ดูคลังสินค้า | route `src/App.tsx:147` | admin-boolean | — |
| `inventory_edit` | ตั้งราคาขาย/ต้นทุนเครื่องในสต๊อก ส่งเข้า POS กด Sold | `src/pages/inventory/Inventory.tsx:109,125,138` (ปุ่มต้นทุน/แก้ไข gate CEO/MANAGER `Inventory.tsx:186,237,248`) | client-only บางปุ่ม | **HIGH** |
| `accessories_manage` | จัดการสินค้าอุปกรณ์เสริม (เพิ่ม/แก้/ลบ) | `src/pages/inventory/Accessories.tsx:40,43,52` (**ลบ `:52` ไม่มีเช็ค role**) | admin-boolean | **HIGH** (ลบถาวร) |
| `pos_checkout` | ขายสินค้าหน้าร้าน (POS) — สร้างบิลขาย ตัดสต๊อก | `src/pages/sales/POS.tsx:140,152,164,169,174`; route `src/App.tsx:115` | admin-boolean | **HIGH** |
| `sales_history_view` | ดูประวัติการขาย | route `src/App.tsx:149` | admin-boolean | — |
| `sales_void` | ยกเลิกบิลขาย (void) และคืนเครื่องเข้าสต๊อก | `src/pages/sales/SalesHistory.tsx:134,137,141` — **`hasAccess` ถูก import ที่ `SalesHistory.tsx:18` แต่ไม่เคยถูกเรียก = ปุ่ม void ไม่มี gate** | admin-boolean | **HIGH** |
| `stock_audit_run` | นับสต๊อกและบันทึกผลตรวจนับ | `src/pages/inventory/StockAudit.tsx:61`; route `src/App.tsx:150` | client-only (CEO/MANAGER) | — |
| `lots_manage` | จัดการล็อตขายส่ง: สร้าง เผยแพร่ ปิดรับ เปิดซอง award | `src/pages/dealers/LotManager.tsx:202`, `LotDetail.tsx:140,148,157,165,213` → callables `functions/dealer-portal.js:991,1092,1239,1250,2342,2402` (gate CEO/MANAGER ต่อตัว) | **server:CEO/MANAGER** (award/unseal ของจริง) | **HIGH** |
| `lots_cost_view` | เห็นต้นทุน/ราคา reserve ของล็อต | UI ซ่อนที่ `LotManager.tsx:117`, `LotDetail.tsx:43` — แต่ `lot_private` read rule = admin boolean (survey §2.3) → STAFF อ่านตรงได้ | client-only | **HIGH** (ข้อมูลต้นทุน) |
| `dealer_orders_fulfil` | แพ็ค/สแกน/จัดส่ง/ปิดออเดอร์ขายส่ง | `src/pages/dealers/DealerOrders.tsx:63,79,91,135,145` → callables gate CEO/MANAGER/STAFF (`dealer-portal.js:2782,2866,2893`) | **server:CEO/MANAGER/STAFF** | — |
| **— ตั้งค่าระบบ —** | | | | |
| `settings_global_edit` | ตั้งค่ากลางของระบบ: อัตราค่าวิ่งไรเดอร์ ค่าส่ง เกณฑ์ flag การยืนราคา ซ่อนราคาหน้าเว็บ | `src/pages/admin/GlobalSettings.tsx:100,138,202,263,284,316`; route `src/App.tsx:194` | client-only (CEO — `settings` write = admin boolean → ทุก role เขียนตรงได้) | **HIGH** |
| `settings_store_edit` | ตั้งค่าหน้าร้าน: โปรไฟล์ร้าน เวลาทำการ/วันหยุด สมาชิก เกณฑ์ข้อเสนอลูกค้า | `src/pages/admin/StoreSettings.tsx:70`, `BusinessHoursSettings.tsx:195`, `MembershipSettings.tsx:95`, `CustomerOfferSettings.tsx:53`; routes `src/App.tsx:197-198,202-203` | client-only (CEO/MANAGER) | — |
| `settings_branches_edit` | จัดการสาขา (เพิ่ม/แก้/ลบ — กระทบ checkout ลูกค้า) | `src/pages/admin/BranchManager.tsx:56,58,82` (ลบ `:82`); route `src/App.tsx:204` | client-only (CEO/MANAGER) | **HIGH** (ลบกระทบ checkout) |
| `settings_notifications_edit` | เปิด/ปิดสวิตช์การแจ้งเตือนทั้งระบบ | `src/pages/admin/NotificationSettings.tsx:55,60`; route `src/App.tsx:191` | client-only (CEO/MANAGER) | — |
| `settings_chat_ai_edit` | ตั้งค่าแชท AI: เปิด/ปิด งบรายวัน คลังคำตอบ โปรไฟล์ AI | `src/pages/admin/ChatWidgetSettings.tsx:229,241,267`, `AiProfileSettings.tsx:115`, `ChatKnowledgeGraph.tsx:383,388,488` (`:488` = **เขียนทับคลังทั้งก้อน**), `SickwSettingsSection.tsx:39`; routes `src/App.tsx:199-201` | client-only (CEO/MANAGER) | **HIGH** (คุมงบ AI + ทับทั้งก้อน) |
| `settings_email_templates_edit` | เปิด/ปิดและแก้ข้อความอีเมลที่ส่งถึงลูกค้า | `src/pages/admin/EmailSettings.tsx:144,156,164`; list ผ่าน callable `functions/email-templates-admin.js:166` (gate `:168-173` CEO/FINANCE) | client-only เขียนตรง (callable gate เฉพาะฝั่ง list — survey §2.3) | — |
| `settings_coupons_manage` | สร้าง/แก้/ลบแคมเปญคูปอง (เงินที่แจกลูกค้า) | `src/pages/admin/CouponManager.tsx:315,318,329,338,347` (ลบ `:329`); route `src/App.tsx:189` | client-only (CEO/MANAGER) | **HIGH** |
| `system_health_view` | ดู/สั่งรันตรวจสุขภาพระบบ + ปิดการตรวจรายตัว | `src/pages/admin/SystemHealth.tsx:120,130` → `functions/health-check.js:695` (gate `:700-704` CEO/MANAGER); route `src/App.tsx:192` | **server:CEO/MANAGER** (ตัวรัน) / client-only (mute) | — |
| `ops_view` | ดูแดชบอร์ดปฏิบัติการ (ops) | `src/pages/admin/OpsDashboard.tsx:110` → `functions/ops-dashboard.js:341` (gate `:344-348`); route `src/App.tsx:193` | **server:CEO/MANAGER** | — |
| `analytics_view` | ดูหน้าวิเคราะห์ (ซื้อ/ขาย/คูปอง/แชท) + ตั้งเงินทุนหมุนเวียน | routes `src/App.tsx:139-141,146`; เขียน `src/pages/analytics/Analytics.tsx:63,66` (`settings/working_capital`, `settings/fixed_costs`) | client-only (CEO/MANAGER) | — |
| `analytics_search_view` | ดูวิเคราะห์การค้นหา (PDPA: สิทธิ์นี้บันทึกใน RoPA Activity 11 — ห้ามเปิดกว้างโดยไม่ทบทวน RoPA) | route `src/App.tsx:145` + callable `functions/search-analytics.js:269` (gate `:274-280` CEO/MANAGER) | **server:CEO/MANAGER** | — |
| `analytics_profit_view` | เห็นตัวเลขกำไรบนแดชบอร์ดหน้าแรก | `src/pages/dashboard/CEODashboard.tsx:154` (การ์ดกำไรขั้นต้น คำนวณ `:40`) — route `/` `src/App.tsx:133` **ไม่มี gate ทุก role เห็น** | admin-boolean | — |
| `appointments_manage` | จัดการปฏิทินนัดหมาย (เพิ่ม/แก้/ลบนัด) | `src/pages/appointments/AppointmentCalendar.tsx:602,605,622,631` (ลบ `:622`); routes `src/App.tsx:127,182` | admin-boolean | — |
| **— ผู้ใช้ / บัญชี —** | | | | |
| `staff_view` | ดูรายชื่อพนักงานและ role | route `/staff` `src/App.tsx:188` (CEO) — แต่ `/staff` read rule = admin boolean → role อื่นอ่านตารางตรงได้ (survey §2.3) | client-only (CEO) | — |
| `staff_manage` | สร้าง/แก้/พักงาน/ลบบัญชีพนักงาน + รีเซ็ตรหัสผ่าน | `src/pages/settings/StaffManagement.tsx:147,157,185,197,211,222` → callables `functions/staff-accounts.js:97,169,214,269,304` (gate `requireCeoCaller` `:37`) | **server:CEO** (แข็งแรงสุดในระบบ) | **HIGH** |
| `dealers_manage` | สร้าง/แก้/พัก/รีเซ็ตรหัสบัญชีดีลเลอร์ + อนุมัติ/ปฏิเสธใบสมัคร | `src/pages/dealers/DealerManager.tsx:106,118,125,150,153,165,174` → callables `functions/dealer-portal.js:650,747,792,826,951` (gate CEO/MANAGER ต่อตัว) | **server:CEO/MANAGER** | **HIGH** |
| `dealer_settings_edit` | ตั้งค่าระบบดีลเลอร์ (tier, บัญชีโอน) | `src/pages/admin/DealerSettings.tsx:111`; route `src/App.tsx:205` | client-only (CEO) | **HIGH** |
| `dealer_purge_test_data` | ล้างข้อมูลทดสอบระบบดีลเลอร์ทั้งชุด | `DealerSettings.tsx:55` → `functions/dealer-portal.js:1717` (gate `:1719` CEO) | **server:CEO** | **HIGH** |
| `permissions_manage` | เปิดหน้าจัดการสิทธิ์และติ๊ก/ปลดสิทธิ์ของแต่ละ role (หน้าใหม่ตามแผนส่วนที่ 3) | ยังไม่มี — จะเป็น route ใหม่ + callable ใหม่ | (ใหม่) — **CEO ฮาร์ดโค้ด ไม่อยู่ใน matrix** | **HIGH** |

### 1b. ของที่กวาดเจอแต่ **อยู่นอกอำนาจของ permission matrix** (ต้องแก้แยกต่างหาก — ห้ามเข้าใจว่า matrix ปิดให้)

| ปัญหา | file:line | เหตุผลที่ matrix ช่วยไม่ได้ |
|---|---|---|
| `notifyChatMessage` — HTTP endpoint **ไม่มี auth เลย** (`cors: true`): `?debug=true` dump FCM token พนักงานทุกคน, `&send=true` ยิง push หาทุกคน | `functions/index.js:2457`, debug `:2466-2493` | คนนอกที่ไม่ login ก็เรียกได้ — ต้องใส่ auth/ปิด debug ที่ตัว endpoint |
| callable กลุ่ม SICKW เป็น auth-only — **บัญชีลูกค้า (anonymous) ใน Auth tenant เดียวกันเรียกเผาเครดิตได้** | `functions/index.js:5477,5719,6018,6064,6120` | ต้องเปลี่ยน gate เป็น staff lookup ฝั่ง server (matrix ใช้ตอนนั้นได้) |
| `suggestAdminReplies` + `getChatAiKnowledge` auth-only — เผาเครดิต Anthropic + อ่าน transcript ลูกค้าได้ทุก convo | `functions/chat-ai.js:4948,4909` | เดียวกัน |
| `syncJobFromSickw` — คอมเมนต์อ้างว่าเช็ค role แต่โค้ดไม่เช็ค | `functions/index.js:5928,5948-5949` | แก้ที่ function |
| `sendTestAdminPush` auth-only | `functions/index.js:222` | ความเสี่ยงต่ำ (push เข้าเครื่องตัวเอง) แต่จดไว้ |
| แชทบนงาน (`jobs/$id/chats`, `job_chats/$id`) rules = `auth != null` — anonymous เขียนได้ | `bkk-frontend-next/database.rules.json:109-110,134-135` (จาก survey §3.3) | ต้องแก้ rules ที่ repo นั้น |
| bootstrap CEO ฝั่ง client เมื่อ `/staff` ว่าง (โค้ดตายบน production เพราะ rules ปิด แต่ยังอยู่) | `src/hooks/useStaffSession.ts:43-44` | ควรลบทิ้งตอน implement matrix |
| `dealerRegister` เปิด public โดยตั้งใจ (ฟอร์ม landing) | `functions/dealer-portal.js:848` | by design — จดไว้ให้รู้ว่าตั้งใจ |
| External API จาก client: Google Maps JS/Geocoder (`src/components/PickupLocationPicker.tsx:53,33-34`, `BranchManager.tsx:34,91-105`, `CustomerTracking.tsx:23`, `DispatcherPage.tsx:53`), barcode REST `bwipjs-api.metafloor.com` (`src/pages/lab/QCStation.tsx:254`), CDN icon/font (`DispatcherPage.tsx:235,260`, `CustomerTracking.tsx:234`, `src/utils/receiptGenerator.ts:15`) | ตามแถว | เป็น read-only/แสดงผล ไม่ใช่จุดบังคับสิทธิ์ — คุมด้วย key ของหน้าที่ใช้มัน |

---

# ส่วนที่ 2 — ตรวจสอบคำอธิบาย role ในกล่องแก้ไขพนักงาน

**ที่อยู่ข้อความ:** `src/pages/settings/StaffManagement.tsx:25-30` (array `ROLES`, ฟิลด์ `desc` บรรทัด 26-29) — แสดงในกล่องแก้ไข/สร้างพนักงานผ่านตัวเลือก role (render แถว `:427` เป็นต้นไป)

| ข้อความที่เขียนไว้ | สิ่งที่โค้ดบังคับจริง | ตรง? |
|---|---|---|
| **CEO** (`:26`) "เข้าถึงได้ทุกระบบ รวมจัดการพนักงาน ตั้งค่าระบบส่วนกลาง วิเคราะห์กำไร และอนุมัติ Offer" | CEO ผ่านทุก route guard (`src/App.tsx:125-205`) และเป็น role เดียวที่ผ่าน `requireCeoCaller` (`functions/staff-accounts.js:37`) | **ตรง** |
| **MANAGER** (`:27`) "...ยกเว้น...รายงานการเงิน/ภาษี" | รายงานภาษี/บัญชี 4 หน้า (vat/wht/financial-report/general-ledger `src/App.tsx:177-180`) กัน MANAGER จริง **แต่ MANAGER เข้า `/finance` + `/daily-expenses` ได้** (`src/App.tsx:151-152`) ซึ่งข้างในกดจ่ายเงินลูกค้า (`TradeInPayouts.tsx:184`) อนุมัติค่ารอบ ยืนยันถอนเงินไรเดอร์ และลบ expense ได้ (`DailyExpenses.tsx:190,218` เปิดให้ MANAGER) — คนอ่าน desc จะเข้าใจว่า MANAGER ไม่แตะการเงินเลย ซึ่งผิด | **ไม่ตรง** |
| **MANAGER** (`:27`) "เกือบทุกระบบ...ยกเว้นจัดการพนักงาน ตั้งค่าส่วนกลาง และรายงานการเงิน/ภาษี" (นัยว่ายกเว้นแค่ 3 อย่าง) | ของจริงยกเว้นมากกว่า: `/accounting-settings` (`src/App.tsx:195` CEO/FINANCE), `/email-settings` (`:196` CEO/FINANCE), `/dealer-settings` (`:205` CEO), `/dealer-finance` (`:167` CEO/FINANCE), `adminDealerOrderMarkPaid`/`MarkRefunded` ฝั่ง server (`dealer-portal.js:2662,2177` CEO/FINANCE) | **ไม่ตรง** (ยกเว้นไม่ครบ) |
| **STAFF** (`:28`) "งานปฏิบัติการพื้นฐาน: Tickets, QC Lab, คลังสินค้า, POS, ประวัติการขาย" | รายการที่เขียนถูก แต่**ต่ำกว่าสิทธิ์จริงมาก** — STAFF ยังเข้าและ**กดได้จริง**: หน้าแรก `/` เห็นกำไรขั้นต้น (`CEODashboard.tsx:154`, route `src/App.tsx:133` ไม่ gate) · `/riders` จัดการ/ลบไรเดอร์ (`src/App.tsx:153` ไม่ gate + ปุ่มใน `RiderManagement.tsx:148-238` ไม่เช็ค role) · **`/mobile/finance` กดยืนยันจ่ายเงินลูกค้าได้** (`src/App.tsx:123` ไม่ gate, `MobileFinancePage.tsx:199`) · void บิลขาย (`SalesHistory.tsx:134` — `hasAccess` import แล้วไม่ใช้ `:18`) · ลบลูกค้า CRM (`CustomerCRM.tsx:181`) · ลบอุปกรณ์เสริม (`Accessories.tsx:52`) · `/dispatcher`, `/b2b-dispatch` (ส่ง pre-quote `B2BDispatchQueue.tsx:187`), `/lots`, `/appointments`, `/warranty`, `/dealer-orders` (`src/App.tsx:116,137,162-164,168,182`) | **ไม่ตรง** |
| **STAFF** (`:28`) "เสนอ Offer ได้แต่ต้องรอ CEO/Manager อนุมัติ" | จริงเฉพาะชั้น UI (`src/utils/adjustments.ts:39` + `MobileTicketDetail.tsx:377`) — ชั้นข้อมูล `jobs` write = admin boolean → STAFF เขียน adjustment `status:'applied'` ตรงผ่าน SDK ได้ และ `onAdminOfferProposed` (`functions/index.js:3821`) แค่แจ้งเตือน ไม่ validate (survey §2.3) | **ตรงใน UI / ไม่ตรงในการบังคับจริง** |
| **FINANCE** (`:29`) "ระบบบัญชีและการเงิน: Finance, เบิกจ่าย, P&L, ภ.พ.30, สมุดรายวัน, ตั้งค่าระบบบัญชี และงานพื้นฐาน" | รายการที่เขียนถูกทั้งหมด (`src/App.tsx:151-152,177-180,195`) แต่ขาด: `/wht-report` ภ.ง.ด.3 (`:178`), `/email-settings` (`:196`), `/issued-coupons` + `/issued-rider-fee-discounts` (`:173-174`), `/dealer-claims` + `/dealer-finance` + ยืนยันรับเงิน/คืนเงินดีลเลอร์ (`:166-167`, server gate `dealer-portal.js:2662,2177`) และ "งานพื้นฐาน" ของ FINANCE จริงๆ รวมทุกหน้า ungated เหมือน STAFF (riders, POS, dispatcher ฯลฯ) | **ไม่ตรง** (ต่ำกว่าจริง) |
| (โครงสร้างเมนู ที่ desc ทุกตัวอิง) | เมนู "วิเคราะห์กำไร" ใน sidebar บอก CEO เท่านั้น (`AdminLayout.tsx:211`) แต่ route `/analytics/sales` ให้ CEO+MANAGER (`src/App.tsx:140`) — เมนูกับ route ขัดกันเอง | **ไม่ตรง** (ขัดกันภายใน) |
| (นัยรวมของ desc ทุกตัว: "role นี้ทำได้แค่นี้") | ทุกการ "ยกเว้น" ใน desc เป็นการซ่อนเมนู/route ฝั่ง client เท่านั้น — ชั้นข้อมูล (rules) ทุก role เขียนได้เท่ากันหมด (ข้อเท็จจริงฐานข้อ 1) | **ไม่ตรงทั้งระบบ** — เหตุผลหลักที่ต้องมี matrix + rules ตาม (ส่วนที่ 3) |

**สรุป findings ส่วนที่ 2:** ข้อความ 4 desc มีสถานะ "ตรง" แค่ CEO ตัวเดียว ที่เหลือบรรยายเมนูไม่ใช่สิทธิ์ และต่ำ/สูงกว่าจริงคนละทิศ — แผนส่วนที่ 3 จึงกำหนดให้**ลบข้อความเขียนมือทั้งชุดแล้ว generate จาก matrix แทน**

---

# ส่วนที่ 3 — แผน Permission Matrix

## 3.1 Schema ใน RTDB

```
/config/roles/{role}/perms/{key} : boolean        ← role ∈ { MANAGER, STAFF, FINANCE } เท่านั้น
/config/roles/{role}/updated_at  : number
/config/roles/{role}/updated_by  : staffId
/config/roles_meta/version       : number          ← bump ทุกครั้งที่แก้ (ให้ client รู้ว่าต้อง re-read)
/config/roles_meta/enforce       : boolean         ← kill switch ของชั้น client+functions (ไม่ใช่ rules)
/config/roles_audit/{pushId}     : { at, by_uid, by_staff_id, by_email, role, key, from, to }
```

- **CEO ไม่มีแถวใน matrix โดยโครงสร้าง** — ทุกตัวอ่าน (client helper / functions helper / rules) ฮาร์ดโค้ด `role === 'CEO' → อนุญาตทุก key` ก่อนแตะ matrix เสมอ ทำให้ "CEO ติ๊กออกไม่ได้ ซ่อนไม่ได้" เป็นจริงเชิงโครงสร้าง ไม่ใช่ validation
- **ไม่มี per-user override** — ไม่มี path ต่อ uid/staffId ใน schema เลย ทำให้กติกา "สิทธิ์ผูกกับ role เท่านั้น" ละเมิดไม่ได้โดยบังเอิญ
- ค่า key ที่หายไป (เพิ่ม key ใหม่ในโค้ดแต่ยังไม่มีใน matrix): อ่านเป็น **ค่าจาก DEFAULT_MATRIX ในโค้ด** (3.5) ไม่ใช่ true/false ลอยๆ — กัน "deploy โค้ดที่มี key ใหม่แล้วทุกคนโดนล็อกเงียบ" และกัน fail-open พร้อมกัน; หน้า settings จะ seed key ที่หายให้ครบทุกครั้งที่บันทึก
- **การเขียน matrix ทำผ่าน callable ใหม่ `adminPermissionMatrixSet` เท่านั้น** (gate `requireCeoCaller` ตัวเดียวกับ staff-accounts) — rules ปิด `/config` write สนิท (Admin SDK เขียนคนเดียว), read = admin boolean (ทุกพนักงานต้องอ่าน matrix เพื่อ gate UI ตัวเอง; ไม่มีความลับใน matrix)
- callable ตัวเดียวกันเขียน perms + แถว audit + bump version เป็น multi-path update ก้อนเดียว (atomic)
- **"คนที่ล็อกอินอยู่แก้สิทธิ์ role ตัวเองไม่ได้"** เป็นจริงเชิงโครงสร้าง: คนที่แก้ได้มีแต่ CEO และแถว CEO ไม่มีอยู่ให้แก้ — ไม่ต้องมี validation เพิ่ม (callable ยัง validate `role ∈ {MANAGER, STAFF, FINANCE}` และ `key ∈ catalog` อยู่ดี เพื่อกัน payload มั่ว)
- **"ห้ามเหลือ CEO ศูนย์คน"** มี guard อยู่แล้วที่ `functions/staff-accounts.js:191-193` (เปลี่ยน role), `:233-234` (พักงาน), `:282-283` (ลบ) — matrix ไม่แตะเส้นนี้ แค่จดว่า guard ชุดนี้คือของที่ห้ามถอดตอน refactor

### ฟิลด์ใหม่ที่ต้องเพิ่มคู่กัน: `admins/{uid}/staff_role`

rules อ่าน `/staff` ไม่ได้อย่างมีประสิทธิภาพ (join ด้วย email ทำใน rules ไม่ได้) — ตัวที่ rules อ่านคือ `admins/{uid}` ซึ่งวันนี้เก็บค่าคงที่ `role:"admin"` (แตะไม่ได้ — 120 rules เทียบค่านี้อยู่) จึง**เพิ่มฟิลด์ใหม่** `staff_role: "CEO"|"MANAGER"|"STAFF"|"FINANCE"`:
- จุดเขียนที่ต้องแก้: `adminStaffCreate` (`staff-accounts.js:156-160`), `adminStaffSetStatus` ขา reactivate (`:250-254`) และ **`adminStaffUpdate` (`:203-205`) ซึ่งวันนี้เปลี่ยน role โดยไม่แตะ `/admins` เลย** — ต้องเพิ่มการ sync `staff_role` ที่นี่ (และควร `revokeRefreshTokens` ตอน role เปลี่ยนด้วย ตาม survey ข้อ 5)
- backfill แถว `/admins` ที่มีอยู่: callable ครั้งเดียว CEO-gated (หรือ action ใหม่ใน `migrateOldJobs` ที่มี secret gate อยู่แล้ว `functions/index.js:893`)

## 3.2 RTDB rules อ่าน matrix อย่างไร + ผลกระทบ performance

รูปแบบต่อ node (ตัวอย่าง key `expenses_delete` — เขียนที่ `bkk-frontend-next/database.rules.json` และ deploy จาก repo นั้นเท่านั้น ตามกติกา canonical source):

```json
".write": "root.child('admins').child(auth.uid).child('role').val() === 'admin'
  && (root.child('admins').child(auth.uid).child('staff_role').val() === 'CEO'
      || (root.child('admins').child(auth.uid).child('staff_role').isString()
          && root.child('config').child('roles')
               .child(root.child('admins').child(auth.uid).child('staff_role').val())
               .child('perms').child('expenses_delete').val() === true))"
```

- เงื่อนไขแรกคงเดิม (ยังตัดคนนอก/ไรเดอร์/ลูกค้าเหมือนเดิมทุกประการ) — ชั้น matrix เป็น AND เพิ่ม จึง**แคบลงเท่านั้น ไม่มีทางกว้างขึ้น**
- `isString()` guard: ถ้า `staff_role` ยังไม่ถูก backfill → เงื่อนไข matrix เป็น false ทั้งก้อน → **fail closed** (เฉพาะ node ที่อัปเกรด rule แล้ว) — นี่คือเหตุผลที่ Phase 3 ต้องมาหลัง backfill เสมอ
- **Performance:** วันนี้ทุก operation ประเมิน `root.child('admins')...` อยู่แล้ว 1 lookup — pattern ใหม่เพิ่มเป็น ~3 lookup ต่อ operation (`admins` ×2 + `config/roles` ×1) ซึ่งเป็น in-memory lookup ของ rules engine ไม่ใช่ network read, ไม่คิดเงินเป็น download, และไม่โตตามขนาด matrix (เดินตรงตาม path ไม่ scan) — ความเสี่ยงจริงไม่ใช่ความเร็ว แต่คือ**ความยาว/ซ้ำของ expression ใน 120 จุด** จึงกำหนดว่า Phase 3 อัปเกรดเฉพาะ **node ที่มีแถว HIGH** (jobs, models+price_ledger, settings, coupons, rider_fee_promotions, expenses, transactions, journal_entries, riders, sales, products, jobs_kyc, inbox, reviews, appointments, customers) ไม่ไล่ทั้ง 120 จุดในรอบเดียว
- สิ่งที่ rules ทำไม่ได้และไม่พยายามทำ: แยก "ปุ่ม" สอง key ที่เขียน path เดียวกัน (เช่น `tickets_edit` กับ `offer_approve` เขียน `jobs/{id}` เหมือนกัน) — ชั้น rules จะ gate ด้วย key ที่กว้างกว่าของ path นั้น แล้วให้ความละเอียดระดับปุ่มเป็นหน้าที่ของ client + callable (จดเป็นข้อจำกัดตรงๆ ไม่แสร้งว่าปิดได้)

## 3.3 หน้า ตั้งค่า → จัดการสิทธิ์

- Route ใหม่ `/permission-settings` ใต้ `SettingsLayout` (`src/App.tsx` กลุ่มบรรทัด 186-206) + entry ใน `settingsNav.tsx` กลุ่ม company, `roles: ['CEO']` — และของจริงคือ callable `adminPermissionMatrixSet` ที่ gate CEO ฝั่ง server (route guard เป็นแค่ความสะดวก)
- ตาราง: แถว = permission ทั้ง ~70 key จัดกลุ่ม 8 โดเมนตามส่วนที่ 1 แสดง**คำอธิบายภาษาไทยจากคอลัมน์ 2 ของส่วนที่ 1 ตรงๆ** · คอลัมน์ = 4 role
  - คอลัมน์ CEO: ติ๊กถาวร + disabled + ไอคอนกุญแจ พร้อมคำอธิบาย "CEO ได้ทุกสิทธิ์เสมอ แก้ไม่ได้" — **แสดงเสมอ ไม่ซ่อน** (ตามกติกา)
  - แถว HIGH มีป้ายสีแดง "สิทธิ์สูง" + คำเตือนสั้นว่าแตะเงิน/ลบถาวร
  - การติ๊กเป็น staged changes → ปุ่มบันทึกเปิด confirm modal สรุป diff (role / key / เดิม→ใหม่) → เรียก callable
- แหล่ง key + คำอธิบาย = catalog กลาง `src/config/permissionCatalog.ts` (key, label ไทย, โดเมน, HIGH flag) — functions ต้องมี **mirror JS** `functions/permission-catalog.js` สำหรับ validate key (ธรรมเนียม mirror เดียวกับ `notification-settings.js` ↔ `notificationSettings.ts` — จดใน CLAUDE.md ว่าแก้ต้องแก้คู่)
- แผง audit ล่างตาราง: อ่าน `/config/roles_audit` ล่าสุด N แถว (ใคร แก้ role ไหน key ไหน จากอะไรเป็นอะไร เมื่อไหร่)

## 3.4 กล่องแก้ไขพนักงาน — สรุปสิทธิ์ generate จาก matrix

- **ลบ** ข้อความเขียนมือ `desc` ทั้ง 4 แถวที่ `src/pages/settings/StaffManagement.tsx:26-29`
- แทนด้วย component ที่คำนวณจาก matrix สด + `permissionCatalog`: "เข้าถึง {n} จาก {total} สิทธิ์ — {รายชื่อโดเมนที่ได้ครบ/บางส่วน}" + ปุ่มกางดูรายการ key ที่เปิด (ใช้ label ไทยชุดเดียวกับหน้า settings) + ลิงก์ "แก้สิทธิ์ของ role นี้ → /permission-settings" (เห็นเฉพาะ CEO)
- role CEO แสดงข้อความตายตัว "ได้ทุกสิทธิ์เสมอ (ฮาร์ดโค้ด)" — ไม่คำนวณ
- ผลพลอยได้: คำบรรยายจะไม่มีวันโกหกอีก เพราะมันคือข้อมูลเดียวกับที่ระบบใช้บังคับจริง (ปิดปัญหาทั้งตารางส่วนที่ 2 ถาวร)

## 3.5 Default matrix ตั้งต้น (CEO = ✓ ทุกแถวโดยนิยาม ไม่แสดงในตาราง)

หลักการ: **default = สิ่งที่ UI บังคับอยู่วันนี้** เพื่อให้เปิด enforcement แล้วไม่มีใครเสียสิทธิ์ที่เคยใช้ — ยกเว้นแถวที่ติด ⚠ ซึ่งเป็นการ**ปิดบั๊ก** (วันนี้ "ทำได้เพราะไม่มีใคร gate" ไม่ใช่ "ตั้งใจให้ทำได้") — แถว ⚠ คือ behavior change ที่ต้องให้เจ้าของระบบเคาะก่อนเปิดใช้

| key | MANAGER | STAFF | FINANCE | เหตุผล |
|---|---|---|---|---|
| `catalog_view` | ✓ | — | — | ตาม route ปัจจุบัน (`App.tsx:171`) |
| `catalog_price_edit` | ✓ | — | — | ตาม route ปัจจุบัน |
| `catalog_model_manage` | ✓ | — | — | ตาม route ปัจจุบัน |
| `catalog_structure_manage` | ✓ | — | — | อยู่ในหน้าเดียวกับ catalog |
| `condition_sets_edit` | ✓ | — | — | ตาม settingsNav (`settingsNav.tsx:51`) |
| `tickets_view` | ✓ | ✓ | ✓ | งานพื้นฐานทุก role (route ไม่ gate อยู่แล้ว) |
| `tickets_create` | ✓ | ✓ | — ⚠ | วันนี้ FINANCE สร้างงานได้เพราะไม่มี gate — ไม่ใช่งานของบัญชี ปิดเป็น default |
| `tickets_edit` | ✓ | ✓ | — ⚠ | เดียวกัน |
| `tickets_price_edit` | ✓ | — | — | ตาม UI ปัจจุบัน (`MobileTicketDetail.tsx:891`) |
| `tickets_delete` | — | — | — | ตาม UI ปัจจุบัน CEO เท่านั้น (`MobileTicketDetail.tsx:892`) |
| `tickets_method_edit` | ✓ | ✓ | — ⚠ | ปฏิบัติการหน้างาน |
| `offer_propose` | ✓ | ✓ | — ⚠ | STAFF เสนอได้ (เข้าคิว) ตาม flow ปัจจุบัน |
| `offer_approve` | ✓ | — | — | ตาม `canReviewAdjustments` (`adjustments.ts:39`) |
| `coupon_on_job_edit` | ✓ | — | — | ตาม UI ปัจจุบัน |
| `rider_discount_on_job_edit` | ✓ | — | — | ตาม UI ปัจจุบัน |
| `amendment_review` | ✓ | — ⚠ | — ⚠ | วันนี้ gate แค่ admin-boolean (`index.js:4605`) = STAFF/FINANCE อนุมัติได้ — จัดให้เท่ากับ `offer_approve` เพราะเป็นเงินเหมือนกัน |
| `qc_submit` | ✓ | ✓ | — ⚠ | QC เป็นงาน STAFF โดยตรง |
| `b2b_manage` | ✓ | ✓ | — ⚠ | ตามการใช้งานจริง (STAFF แตกกล่อง/นับ) — pre-quote ยังอยู่ใน key นี้ ถ้าจะแยกให้แตก key ใหม่ก่อนใช้จริง |
| `kyc_record` | ✓ | ✓ | — ⚠ | คนรับเครื่องเป็นคนบันทึก |
| `kyc_delete` | ✓ | — | — | ตาม UI ปัจจุบัน (`KYCInfoCard.tsx:151`) |
| `sickw_check` | ✓ | ✓ | — ⚠ | จำเป็นต่อ QC flow แต่เสียเงินต่อครั้ง — FINANCE ไม่มีเหตุใช้ |
| `sickw_gate_override` | ✓ | — | — | ตาม server gate ปัจจุบัน (`index.js:5852`) |
| `sickw_sync` | ✓ | ✓ | — ⚠ | อ่าน cache ไม่เสียเงิน |
| `diagnos_session_create` | ✓ | ✓ | — ⚠ | งานหน้าเครื่อง |
| `vision_ocr` | ✓ | ✓ | — ⚠ | ใช้ใน KYC/inspection flow |
| `crm_view` | ✓ | ✓ | ✓ | ตามปัจจุบัน (ไม่ gate) |
| `crm_edit` | ✓ | ✓ | — ⚠ | ตามการใช้งานจริง |
| `crm_delete` | ✓ | — ⚠ | — ⚠ | วันนี้ปุ่มลบไม่ gate เลย (`CustomerCRM.tsx:181`) — ลบถาวร PII ให้เฉพาะ CEO/MANAGER |
| `crm_backfill` | — | — | — | เครื่องมือครั้งเดียว ให้ CEO พอ |
| `chat_view` | ✓ | ✓ | ✓ | ตามปัจจุบัน |
| `chat_operate` | ✓ | ✓ | — ⚠ | งานบริการลูกค้า |
| `chat_quote_send` | ✓ | — ⚠ | — ⚠ | ผูกราคา — จัดกลุ่มเดียวกับ offer_approve |
| `chat_delete` | ✓ | — ⚠ | — ⚠ | ลบถาวร |
| `chat_ai_assist` | ✓ | ✓ | — ⚠ | เครื่องมือช่วยตอบของคนคุมแชท (เสียเงินต่อครั้ง — ถ้าจะรัดกว่านี้ให้เจ้าของระบบเคาะ) |
| `reviews_manage` | ✓ | — | — | ตาม route ปัจจุบัน (`App.tsx:175`) |
| `riders_view` | ✓ | ✓ | ✓ | ดูอย่างเดียวไม่อันตราย (วันนี้ก็เปิด) |
| `riders_manage` | ✓ | — ⚠ | — ⚠ | วันนี้ทุก role กดได้เพราะไม่มี gate (`RiderManagement.tsx:148-229`) — ปิดเหลือ CEO/MANAGER |
| `riders_delete` | — ⚠ | — ⚠ | — ⚠ | ลบถาวร ให้ CEO เท่านั้น (วันนี้ทุก role ลบได้) |
| `dispatch_assign` | ✓ | ✓ | — ⚠ | งานปฏิบัติการ |
| `discrepancy_resolve` | ✓ | ✓ | — ⚠ | งานปฏิบัติการ |
| `rider_performance_view` | ✓ | — | — | ตาม route (`App.tsx:154`) |
| `rider_fee_promos_manage` | ✓ | — | — | ตาม route (`App.tsx:190`) |
| `rider_settlement_approve` | ✓ | — | ✓ | ตาม route `/finance` ปัจจุบัน (CEO/MANAGER/FINANCE) |
| `rider_withdrawal_transfer` | ✓ | — | ✓ | เดียวกัน |
| `finance_view` | ✓ | — ⚠ | ✓ | desktop ปัจจุบัน = CEO/MANAGER/FINANCE; ⚠ = ปิดรู `/mobile/finance` ที่วันนี้ STAFF เข้าได้ (`App.tsx:123`) |
| `payout_transfer` | ✓ | — ⚠ | ✓ | เดียวกัน — ปิดรูจ่ายเงินจากมือถือของ STAFF |
| `transaction_repair` | — ⚠ | — ⚠ | ✓ | เครื่องมือบัญชี ให้ CEO/FINANCE |
| `expenses_record` | ✓ | — | ✓ | ตาม route (`App.tsx:152`) |
| `expenses_delete` | ✓ | — | — ⚠ | ตามปุ่มปัจจุบัน (CEO/MANAGER `DailyExpenses.tsx:190`) — FINANCE บันทึกได้แต่ลบไม่ได้ (คงพฤติกรรมเดิม) |
| `test_data_cleanup` | — ⚠ | — ⚠ | — ⚠ | จุดทำลายล้างสูงสุด ให้ CEO เท่านั้น (วันนี้ทุกคนใน `/finance` เห็น) |
| `tax_reports_view` | — | — | ✓ | ตาม route (`App.tsx:177-178`) |
| `financial_report_view` | — | — | ✓ | ตาม route (`App.tsx:179`) |
| `ledger_view` | — | — | ✓ | ตาม route (`App.tsx:180`) |
| `ledger_edit` | — | — | ✓ | เดียวกัน |
| `accounting_settings_edit` | — | — | ✓ | ตาม route (`App.tsx:195`) |
| `dealer_finance_ops` | — | — | ✓ | ตาม server gate (`dealer-portal.js:2662,2177`) |
| `inventory_view` | ✓ | ✓ | ✓ | ตามปัจจุบัน |
| `inventory_edit` | ✓ | — | — | ตามปุ่มปัจจุบัน (`Inventory.tsx:186,237,248`) |
| `accessories_manage` | ✓ | ✓ | — ⚠ | STAFF จัดสต๊อกอุปกรณ์เสริมอยู่แล้ว แต่การลบใน key นี้ — ถ้าอยากรัดให้แตก `accessories_delete` ก่อนใช้จริง |
| `pos_checkout` | ✓ | ✓ | — ⚠ | POS เป็นงานหน้าร้านของ STAFF |
| `sales_history_view` | ✓ | ✓ | ✓ | ตามปัจจุบัน |
| `sales_void` | ✓ | — ⚠ | — ⚠ | วันนี้ void ไม่มี gate (`SalesHistory.tsx:18` dead import) — ปิดเหลือ CEO/MANAGER |
| `stock_audit_run` | ✓ | — | — | ตาม route (`App.tsx:150`) |
| `lots_manage` | ✓ | — | — | ตาม server gate (`dealer-portal.js:1094` ฯลฯ) |
| `lots_cost_view` | ✓ | — | — | ตาม UI ปัจจุบัน (`LotManager.tsx:117`) |
| `dealer_orders_fulfil` | ✓ | ✓ | — | ตาม server gate (`dealer-portal.js:2782`) |
| `settings_global_edit` | — | — | — | CEO เท่านั้น ตาม route (`App.tsx:194`) |
| `settings_store_edit` | ✓ | — | — | ตาม routes (`App.tsx:197-203`) |
| `settings_branches_edit` | ✓ | — | — | ตาม route (`App.tsx:204`) |
| `settings_notifications_edit` | ✓ | — | — | ตาม route (`App.tsx:191`) |
| `settings_chat_ai_edit` | ✓ | — | — | ตาม routes (`App.tsx:199-201`) |
| `settings_email_templates_edit` | — | — | ✓ | ตาม route (`App.tsx:196`) |
| `settings_coupons_manage` | ✓ | — | — | ตาม route (`App.tsx:189`) |
| `system_health_view` | ✓ | — | — | ตาม server gate (`health-check.js:36`) |
| `ops_view` | ✓ | — | — | ตาม server gate (`ops-dashboard.js:36`) |
| `analytics_view` | ✓ | — | — | ตาม routes (`App.tsx:139-146`) |
| `analytics_search_view` | ✓ | — | — | **ห้ามขยาย** โดยไม่ทบทวน RoPA Activity 11 (PDPA) |
| `analytics_profit_view` | ✓ | — ⚠ | — ⚠ | วันนี้ทุก role เห็นกำไรบนหน้าแรก (`CEODashboard.tsx:154`) — ซ่อนการ์ดกำไรจาก STAFF/FINANCE (ซ่อนเฉพาะการ์ด ไม่ใช่ทั้งหน้า) |
| `appointments_manage` | ✓ | ✓ | — ⚠ | งานปฏิบัติการ |
| `staff_view` | — | — | — | CEO เท่านั้น ตาม route (`App.tsx:188`) |
| `staff_manage` | — | — | — | CEO เท่านั้น (server gate เดิม) |
| `dealers_manage` | ✓ | — | — | ตาม server gate (`dealer-portal.js:652`) |
| `dealer_settings_edit` | — | — | — | CEO เท่านั้น (`App.tsx:205`) |
| `dealer_purge_test_data` | — | — | — | CEO เท่านั้น (`dealer-portal.js:1719`) |
| `permissions_manage` | — | — | — | **CEO ฮาร์ดโค้ด — ไม่มีวันโผล่ให้ติ๊ก** |

## 3.6 Migration จาก admin boolean → dual-read → rollback

**Phase 0 — วางฐาน (ไม่เปลี่ยนพฤติกรรมใดๆ)**
1. เพิ่ม `staff_role` ใน `/admins` (3 จุดใน `staff-accounts.js` ตาม 3.1) + backfill แถวเก่า
2. สร้าง `permissionCatalog` (TS + mirror JS) + callable `adminPermissionMatrixSet` + seed default matrix (ค่าตาม 3.5 **โดยยังไม่รวมแถว ⚠** — seed ⚠ เป็นค่าปัจจุบันก่อน แล้วให้เจ้าของระบบไปปิดเองจากหน้า settings ทีละตัวเมื่อพร้อม)
3. rules เพิ่มเฉพาะ `/config` (write ปิด / read admin) — deploy จาก bkk-frontend-next
- **Rollback:** ลบ node `/config` — ไม่มีใครอ่าน ไม่มีผล

**Phase 1 — ชั้น client (dual-read)**
1. helper กลาง `can(session, key)`: CEO → true · matrix มีค่า → ใช้ค่า · matrix ไม่มีแถว/อ่านไม่ได้/`enforce=false` → ใช้ `DEFAULT_MATRIX` ในโค้ด (นี่คือ dual-read: ระบบวิ่งได้แม้ matrix หาย)
2. แทนที่ผู้อ่านทั้งหมด: route ternaries ใน `App.tsx`, `hasAccess` 2 นิยาม (`AdminLayout.tsx:67`, `useAuth.ts:14`), `canReviewAdjustments` (`adjustments.ts:39`), `settingsNav` roles, ปุ่ม 15 จุด gating (รายการจากส่วนที่ 1) — และ**เพิ่ม gate ให้จุดที่วันนี้ไม่มี** (riders, sales_void, crm_delete, mobile/finance, accessories delete, dashboard profit card)
3. หน้า `/permission-settings` + audit panel + กล่องพนักงาน generate (3.3, 3.4) + ลบ bootstrap CEO ที่ `useStaffSession.ts:43-44`
- **Rollback:** ตั้ง `/config/roles_meta/enforce = false` → ทุก gate ตกกลับ DEFAULT_MATRIX (= พฤติกรรมปัจจุบัน) ทันทีไม่ต้อง deploy; ถอนถาวร = revert commit

**Phase 2 — ชั้น functions**
1. helper `requireStaffPerm(db, auth, key)` ใน functions (CEO short-circuit → matrix → DEFAULT mirror) — เสียบแทน role array ใน callable ที่มี gate อยู่แล้ว และ**เพิ่ม gate ให้ตัวที่หลวม**: `reviewAmendment` (admin-boolean → `amendment_review`), กลุ่ม SICKW auth-only → `sickw_check`/`sickw_sync`, `suggestAdminReplies`/`getChatAiKnowledge` → `chat_ai_assist`/`ops_view`, `syncJobFromSickw` เพิ่ม role check ที่คอมเมนต์อ้างไว้, `notifyChatMessage` ปิด/ใส่ auth (อยู่นอก matrix แต่ทำรอบเดียวกัน)
- **Rollback:** helper อ่าน `enforce` flag เดียวกัน → ปิด flag = ตกกลับพฤติกรรม role array เดิม; ถอนถาวร = revert + rerun deploy functions

**Phase 3 — ชั้น rules (เฉพาะ node ที่มีแถว HIGH)**
1. อัปเกรด rule ตาม pattern 3.2 ทีละกลุ่ม node เริ่มจากที่เสี่ยงสุด (`jobs`, `models`+`price_ledger`, `settings`, `journal_entries`, `expenses`, `transactions`, `riders`, `sales`, `jobs_kyc`) — PR ละกลุ่ม เพื่อให้ rollback แม่นยำ
2. rules ไม่มี kill switch — rollback = revert ไฟล์ rules + merge → `deploy-rules.yml` รันอัตโนมัติ (เช็ค run เขียวก่อนถือว่าเสร็จ ตามบทเรียนใน CLAUDE.md ของ bkk-frontend-next)
- ข้อควรระวังช่วง dual-read ของ Phase 3: rule ที่อัปเกรดแล้ว fail closed สำหรับ uid ที่ยังไม่มี `staff_role` — ต้องยืนยันว่า backfill ครบ (นับแถว `/admins` ที่ไม่มี `staff_role` ต้องเป็น 0) ก่อน merge PR แรกของ phase นี้

## 3.7 Audit log

- ทุกการติ๊ก/ปลดผ่าน `adminPermissionMatrixSet` เขียน `/config/roles_audit/{pushId}` หนึ่งแถวต่อหนึ่ง key ที่เปลี่ยน: `{ at, by_uid, by_staff_id, by_email, role, key, from, to }` — เขียนใน multi-path เดียวกับตัว perms จึงไม่มีเคส "สิทธิ์เปลี่ยนแต่ log หาย"
- rules: read = admin boolean (โปร่งใสในทีม — ใครก็เห็นว่าใครแก้อะไร), write = ปิด (Admin SDK เท่านั้น) → client ปลอม log ไม่ได้
- แสดงในหน้า `/permission-settings` (ล่าสุดก่อน) — ขนาดข้อมูลเล็กมาก ไม่ต้องมี GC ในเฟสแรก

## 3.8 Test plan (ให้คุณทำเองบน preview — ผมเข้า RTDB ไม่ได้)

> ข้อเท็จจริงก่อนเริ่ม: bkk-system deploy preview ผ่าน **Firebase Hosting preview channel** (check "Deploy Preview" บน PR) ไม่ใช่ Vercel — และ preview **ต่อ production RTDB จริง** การติ๊ก matrix บน preview มีผลกับพนักงานจริงทันที จึงต้องทดสอบตามลำดับนี้และใช้ `enforce` flag เป็นตาข่าย

1. **เตรียม (ครั้งเดียว):** ใช้บัญชี CEO จริงที่ `/staff` สร้างบัญชีทดสอบ 3 บัญชี: `test-manager@`, `test-staff@`, `test-finance@` (role ตามชื่อ) — บัญชีเหล่านี้ใช้ซ้ำได้ทุกเฟส เสร็จแล้วพักงานทิ้งไว้
2. **Phase 0 (หลัง merge):** เปิด Firebase console → Realtime Database → ดูว่า `/config/roles` มีครบ 3 role และทุกแถว `/admins/{uid}` มี `staff_role` ตรงกับ role ใน `/staff` (ถ้ามีแถวที่ไม่มี = backfill ยังไม่ครบ **หยุด อย่าไป Phase ถัดไป**)
3. **Phase 1 (บน preview URL ของ PR):**
   a. login ทีละบัญชีทดสอบ → เดินตาม checklist ต่อ role: เมนูที่ควรเห็น/ไม่เห็น, พิมพ์ URL ตรง (`/finance`, `/mobile/finance`, `/staff`, `/global-settings`, `/riders`) ต้องถูกเด้งตาม matrix, ปุ่ม HIGH (ลบ expense, void บิล, อนุมัติ Offer, ลบไรเดอร์) ต้องหาย/แสดงตาม matrix
   b. ด้วยบัญชี CEO เปิด `/permission-settings` → ปิด key หนึ่งตัวของ STAFF ที่ไม่กระทบงานจริง (แนะนำ `stock_audit_run`) → บันทึก → รีเฟรชแท็บ test-staff → ปุ่ม/เมนูต้องหายใน 1 รีเฟรช → เปิดคืน → กลับมา
   c. เช็คแผง audit: ต้องมี 2 แถว (ปิด+เปิด) ระบุชื่อบัญชี CEO ของคุณ
   d. เช็คคอลัมน์ CEO ติ๊กเทา แก้ไม่ได้ และไม่มีที่ไหนให้ใส่สิทธิ์รายคน
   e. rollback drill: ตั้ง `/config/roles_meta/enforce = false` จาก Firebase console → รีเฟรชทุกแท็บ → พฤติกรรมต้องกลับเท่าก่อนเปิดระบบเป๊ะ → ตั้งกลับ `true`
4. **Phase 2:** ด้วยบัญชี test-staff เปิดหน้าที่เรียก callable ที่เพิ่ง gate (เช่น กด "ตรวจ IMEI" ใน ticket ถ้าปิด `sickw_check` ของ STAFF ไว้) → ต้องได้ error permission-denied ที่ UI แสดงสุภาพ ไม่ crash
5. **Phase 3 (rules):** login preview ด้วย test-staff → เปิด DevTools console บนแท็บนั้น → ยิงเขียนตรงไปยัง node ที่อัปเกรดแล้ว เช่น `firebase.database().ref('expenses/test-probe').set({x:1})` (หรือใช้ REST พร้อม idToken ของบัญชีทดสอบ) → ต้องได้ `PERMISSION_DENIED` · ทำซ้ำด้วยบัญชี CEO → ต้องผ่าน · ลบ probe ทิ้ง
6. **หลังทุกเฟส:** เช็ค GitHub Actions ว่า deploy run เขียว (hosting + functions + rules ตามเฟส) ก่อนถือว่าเฟสนั้นจบ

## 3.9 กติกาบังคับ — จุดที่แผนตอบทีละข้อ

| กติกา | ตอบที่ |
|---|---|
| CEO ได้ทุก permission เสมอ ฮาร์ดโค้ด ติ๊กออก/ซ่อนไม่ได้ | 3.1 (ไม่มีแถว CEO ใน matrix), 3.2 (short-circuit ใน rules), 3.3 (คอลัมน์ disabled แสดงเสมอ) |
| ไม่มี per-user override | 3.1 (schema ไม่มี path ต่อคน) |
| คนล็อกอินแก้สิทธิ์ role ตัวเองไม่ได้ | 3.1 (ผู้แก้มีแต่ CEO และแถว CEO ไม่มีให้แก้) |
| ห้ามเหลือ CEO ศูนย์คน | guard เดิม `staff-accounts.js:191,233,282` — ห้ามถอดตอน refactor |
| แยก "ดู" กับ "แก้" คนละ key | ตารางส่วนที่ 1 + 3.5 (เช่น `ledger_view`/`ledger_edit`, `finance_view`/`payout_transfer`, `lots_cost_view`/`lots_manage`) |
| ไม่แน่ใจให้บอกตรงๆ | จุดที่ยังไม่แน่ใจ: (1) `vision_ocr` — ยังไม่ได้ยืนยันว่า backend เรียก API เสียเงินตัวไหน (โค้ดอยู่ bkk-frontend-next `functions/src/vision/extractFromImage.ts` อ่านแค่ gate) (2) `b2b_manage` — ไม่แน่ใจว่า `handleSendPreQuote` ผูกราคาผูกพันทางธุรกิจแค่ไหน จึง mark HIGH ไว้ก่อน (3) แถว ⚠ ใน 3.5 ทุกแถวคือการเดาเจตนาธุรกิจจากโค้ด — ต้องให้เจ้าของระบบเคาะ |

---

*รายงานนี้เป็น survey + plan เท่านั้น ไม่มีการแก้โค้ด — เลขบรรทัดผูกกับ bkk-system `ed69290`; rules อ้างจาก `bkk-frontend-next/database.rules.json` ผ่าน survey 2026-08-29 (commit `f562a2a` ณ วันนั้น)*
