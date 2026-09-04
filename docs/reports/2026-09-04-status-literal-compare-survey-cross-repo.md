# สำรวจทุกจุดที่เทียบสถานะงานกับ string literal นอกแอดมิน — `functions/` · bkk-rider-app · bkk-frontend-next (4 ก.ย. 2569, ขั้นที่ 3)

**ที่มา:** ขั้นที่ 1–2 (รายงาน `2026-09-04-status-literal-compare-survey.md` + sweep #714) ปิดฝั่ง `bkk-system/src` ไปแล้ว: literal สะกดเก่าในตำแหน่งเทียบ = 0 และมีด่าน `statusLiteralCensus.test.ts` กันไม่ให้กลับมา. รายงานนี้ไล่**ส่วนที่เหลือของระบบที่อ่าน `jobs/{id}/status` แถวเดียวกัน**: Cloud Functions ของ bkk-system (trigger / scheduler / push / อีเมล / callable), แอปไรเดอร์ (ทั้ง PWA และ `functions/src` ที่ส่ง push), เว็บลูกค้า (`app/` + `lib/` + `functions/src`) และ RTDB rules. เหตุผลเดิม: engine เขียน canonical ให้ทุก transition ตั้งแต่ P2/P3 ส่วนแถวเก่าสะกดเดิมอยู่ถาวร — reader ที่เทียบสะกดเดียวจึงพลาดอีกสะกดทั้งหมด ไม่มี error ไม่มีเทสแดง

**คำถามที่สองที่รายงานนี้ต้องตอบ (สั่งมาพร้อมกัน):** ถ้า writer `src/utils/payoutTransfer.ts` ย้ายไป engine (งานที่กำลังทำ — ตอนนี้บน branch มี 2 commit: ย้าย helper เงินไป `functions/job-money.js` + engine รับ `payment_confirmed` จาก Price Accepted และเพิ่ม `b2b_payment_confirmed`) **ใครอ่านค่าที่ writer ตัวนั้นเขียนอยู่บ้าง และจะเห็นอะไรเปลี่ยน** — หัวข้อ 2 ตอบข้อนี้ทีละฟิลด์ตามเช็คลิสต์ "ย้าย writer ถามว่าใครอ่านของเดิม" ใน CLAUDE.md ของ bkk-frontend-next

**วิธีสแกน (ทำซ้ำได้ — สคริปต์เดียวกับรายงานขั้นที่ 2 ปรับ 3 จุด):** คำศัพท์ = `JOB_STATUS` + `JOB_STATUS_B2B` จาก `functions/status-vocab.generated.js` (40 + 11 ค่า) + คีย์ `LEGACY_ALIAS` จาก `src/types/job-statuses.ts` + `In-Transit`/`PAID`/`Reserved` — enum ทั้ง 3 รีโปตรวจแล้ว**ตรงกันทุกตัวอักษร** (diff ว่าง) จึงใช้ชุดเดียว. grep เป็น string literal ในทุกไฟล์ที่ไม่ใช่เทส ตัดบรรทัดคอมเมนต์ก่อน แล้วจำแนกรูป (`===` / `case` / ลิสต์ที่ถูก `.includes`/`Set` / `status: '…'` = write / `'…':` = map). ที่ปรับจากขั้นที่ 2: (1) "คู่ canonical ใกล้ๆ" นับรูป `JOB_STATUS.X` ด้วย ไม่ใช่แค่ string เพราะแอปไรเดอร์เขียนคู่แบบนั้นทั้งไฟล์ (2) ไฟล์ที่ `toUpperCase()` ก่อนเทียบ literal ตัวใหญ่ที่ตรงกับ canonical นับเป็น `canonical(UPPER)` — เทียบแบบไม่สนตัวพิมพ์จึง**ไม่มีปัญหาสะกด `For`/`for`** แต่ยังพลาดสถานะที่**เปลี่ยนคำ** (`ACCEPTED` ≠ `RIDER ACCEPTED`) (3) แยก `action: '…'` (ข้อความใน qc_logs) กับ `<option value>` ออกจากการเทียบ

| ขอบเขต | ไฟล์ที่สแกน | hit ทั้งหมด | จุดเทียบ/เขียน (ภาคผนวก A) | ในนั้นสะกดเก่า | สะกดเก่า**ไม่มีคู่** canonical ใกล้ๆ | ตารางป้าย (ภาคผนวก B) |
|---|---|---|---|---|---|---|
| `bkk-system/functions/*.js` | 59 | 154 | 100 ใน 7 ไฟล์ | 22 | **9** (4 เป็น `Reserved` ที่ไม่มี canonical) | 54 key |
| `bkk-rider-app` (`src/` + `functions/src/`) | 106 | 74 | 60 ใน 7 ไฟล์ | 28 | **1** | 14 key |
| `bkk-frontend-next` (`app/` + `lib/` + `functions/src/`) | 521 | 49 | 38 ใน 13 ไฟล์ | 6 (+6 แบบ UPPER) | **2** | 11 key |
| `database.rules.json` / `storage.rules` | 2 | — | **0** | — | — | — |

**RTDB rules ไม่มีการเทียบ `jobs/{id}/status` เลย** — `data.child('status')` ที่พบ 4 จุดเป็นของ `dealers`/`lots` (`draft`/`cancelled`/`ACTIVE`) และ `diagnostic_sessions` (`open`/`in_progress`) คนละคำศัพท์ ไม่เกี่ยวกับสถานะงาน. `storage.rules` ไม่แตะสถานะ. **rules จึงไม่ใช่ที่ที่จะเพิ่มด่านสะกด** (และไม่ควร — ดูข้อ 4)

---

## 1. สิ่งที่พังอยู่ตอนนี้ (สะกดเก่าสะกดเดียวในตำแหน่งที่ตัดสิน) — เรียงตามความเสียหาย

### P1 ฝั่ง server (`bkk-system/functions`) — 3 จุด แก้ได้ด้วยการ**ขยายลิสต์** ไม่ต้องรื้ออะไร

| ไฟล์:บรรทัด | literal | engine เขียน | ผลตอนนี้ |
|---|---|---|---|
| `functions/index.js:769` `TERMINAL_STATUSES` | `"Returned"` (ไม่มี `Return Confirmed`) | `Return Confirmed` (`return_confirmed`) | **สองคนอ่านลิสต์นี้:** `runArchive` (:801 ผ่าน `fetchJobsByStatuses`) — งานที่ตีกลับผ่าน engine **ไม่ถูก archive เลย** อยู่ใน `/jobs` ตลอดไปและทุก client ที่ subscribe ทั้งโหนดจ่ายค่า download ให้มัน · `onJobTerminalCancelAmendments` (:4995) — amendment ที่ค้างบนงานที่ตีกลับ**ไม่ถูกปิด** ไรเดอร์คนถัดไปโดน single-pending guard บล็อก |
| `functions/index.js:3391` `FEE_TRIGGER_STATUSES` | `"Sent to QC Lab"` (ไม่มี `Sent To QC Lab`) | `Sent To QC Lab` (`sent_to_lab`) | ตาข่ายกันตกของ `onJobHandedOverCalcRiderFee` (งาน Pickup ที่แอดมินข้ามขั้น Pending QC ไปเข้าแล็บตรง) **ตายสำหรับแถวที่ engine เขียน** — ทางหลัก `Pending QC` ยังทำงาน (สะกดเดียวกับ enum) จึงไม่มีใครเห็นจนกว่าจะเกิดเคสข้ามขั้นจริง = ไรเดอร์ไม่ได้ค่ารอบ |
| `functions/dealer-portal.js:89` `SELLABLE_STATUSES` | `"Ready to Sell"` (ไม่มี `Ready To Sell`) | `Ready To Sell` (`pushed_to_pos`) | :426 ตรวจตอน publish ล็อตขายส่ง — **เครื่องที่ขึ้น POS ผ่าน engine หลัง #674 ใส่ล็อตดีลเลอร์ไม่ได้** ถูกปฏิเสธที่ server ทั้งที่ #714 เพิ่งแก้ให้ `LotManager` ฝั่งหน้าจอเห็นเครื่องพวกนั้นแล้ว (หน้าจอเลือกได้ → server ปฏิเสธ = ปุ่มที่โกหกคนกด รูปเดียวกับที่ `financeGate.ts` เตือน) |

**สามตัวนี้คือ "กฎมีกี่คนอ่าน" อีกรอบ:** #714 ปิด reader ฝั่ง `src/` ของสถานะเดียวกันครบแล้ว (`Return Confirmed` ×5, `Sent To QC Lab` ×6, `Ready To Sell` ×10) แต่สำเนาฝั่ง `functions/` ของกฎเดียวกันไม่ได้ถูกไล่ เพราะขอบเขตขั้นที่ 2 คือ `src/` — และ `functions/` ไม่มีด่านอะไรเลย (ข้อ 4)

### P1 ฝั่ง push ถึงไรเดอร์ (`bkk-rider-app/functions/src/index.ts`) — 1 จุด และมันจะ**เปลี่ยนพฤติกรรม**ตอน cutover

| ไฟล์:บรรทัด | literal | ตอนนี้ | หลัง cutover (`b2b_payment_confirmed` → `Paid`) |
|---|---|---|---|
| `:220-222` `case "Waiting for Handover": case "Waiting For Handover": case "Payment Completed":` + `:265-267 isPayout` | `Payment Completed` ไม่มีคู่ `Paid` ในกิ่งนี้ — `Paid` อยู่อีก `case` (:214-215 "งานเสร็จสมบูรณ์") | ล็อต B2B จ่ายเงิน → push "💸 โอนเงินให้ลูกค้าแล้ว" + `event: payment_transferred` | ล็อต B2B จ่ายเงิน → ตก `case "Paid"` → push "🎉 งานเสร็จสมบูรณ์" **ไม่มี `event: payment_transferred`** ในขณะที่ B2C ยังได้เหมือนเดิม (`Waiting For Handover` มีคู่แล้ว). ผลจริงจำกัด: ล็อต B2B แทบไม่มี `rider_id` (ไม่มี dispatch ขาไรเดอร์) แต่เป็นความต่างที่ต้อง**เลือก**ก่อน deploy ไม่ใช่ปล่อยให้เกิด — ทางแก้ที่ถูกคือย้าย `Paid`/`PAID` มาอยู่กิ่ง payout (ทั้งสองความหมายคือ "เงินออกแล้ว") หรือ normalize ก่อน `switch` |

### P1 ฝั่งเว็บลูกค้า (`bkk-frontend-next/app`) — หน้าแอดมินของเว็บ 2 จุด + ฟังก์ชันแจ้งเตือน 1 จุด

| ไฟล์:บรรทัด | literal | engine เขียน | ผลตอนนี้ |
|---|---|---|---|
| `app/admin/page.tsx:55` | `o.status === 'Active Leads'` (ไม่มี `Active Lead`) | `Active Lead` (`broadcast_to_riders` / `rider_unassigned` / `broadcast_recalled`) | ตัวนับ "รอดำเนินการ" บนแดชบอร์ดแอดมินของเว็บ**ไม่นับงานที่กระจายให้ไรเดอร์ผ่าน engine** — ต่ำกว่าจริงทุกงาน Pickup ที่ผ่าน dispatcher |
| `app/admin/orders/page.tsx:192` `<option value="Active Leads">` + `:132 order.status === statusFilter` | เลือกตัวกรอง "รับเรื่องแล้ว" = เทียบ `'Active Leads'` ตรงตัว | เดียวกัน | ตัวกรองนั้น**ว่าง**สำหรับแถวที่ engine เขียน (เห็นเฉพาะแถวเก่า). `:39` `STATUS_CONFIG` key เดียวกัน → แถว canonical ได้ป้าย default (ภาคผนวก B) |
| `app/hooks/useStatusNotification.ts:5-16` (map key ตัวใหญ่, lookup ผ่าน `toUpperCase()`) | key มี `ACCEPTED`/`IN-TRANSIT`/`HEADING TO CUSTOMER`/`ARRIVED` **ไม่มี** `RIDER ASSIGNED`/`RIDER ACCEPTED`/`RIDER EN ROUTE`/`RIDER ARRIVED`/`RIDER RETURNING`/`WAITING FOR HANDOVER` | ทุกตัวที่ขาด | browser notification บนหน้า `/track` **เงียบทุกขั้นของไรเดอร์**สำหรับงานที่ผ่าน engine (ทุกงานตั้งแต่ P2) — เหลือแค่ `BEING INSPECTED`/`PRICE ACCEPTED`/`PAYOUT PROCESSING`/`PAID`/`CANCELLED`. `WAITING FOR HANDOVER` ไม่เคยอยู่ใน map ตั้งแต่ก่อน cutover (writer เก่าเขียน `Waiting for Handover` ก็ไม่ match) จึงเป็นรูเดิม ไม่ใช่รูใหม่ |

### P2 — ลิสต์ที่เทียบแบบ `toUpperCase()` แล้ว**ขาดคำ** canonical (ไม่ใช่ปัญหาตัวพิมพ์ แต่เป็นสถานะที่เปลี่ยนชื่อ)

| ไฟล์:บรรทัด | ลิสต์ | ขาด | ผล |
|---|---|---|---|
| `app/history/page.tsx:52-54` `classifyStatus` | cancelled = `CANCELLED/RETURNED/CLOSED (LOST)` · in-transit มี `ACCEPTED/IN-TRANSIT/ARRIVED` | `RETURN CONFIRMED`, `RETURNING TO CUSTOMER` (→ ตก `pending`) · `RIDER ASSIGNED/ACCEPTED/EN ROUTE/ARRIVED/RETURNING`, `PARCEL IN TRANSIT` (→ ตก `pending` แทน `in-transit`) | ประวัติการขายของลูกค้าติดป้าย "PENDING" บนงานที่ไรเดอร์กำลังไปหาหรืองานที่ตีกลับแล้ว |
| `app/history/page.tsx:78` `getInTransitDetail` | qc = `ARRIVED/PENDING QC/QC REVIEW/BEING INSPECTED/SENT TO QC LAB` | `RIDER ARRIVED` | ป้ายย่อยผิดกลุ่มบนงานที่ไรเดอร์ถึงบ้านลูกค้า |
| `app/profile/hooks/useUserOrders.ts:65-67` `getFriendlyStatus` | paid = `PAYMENT COMPLETED/PAID/COMPLETED/DEAL CLOSED` (มี `slip` ช่วย) · cancelled = `CANCELLED` | `CLOSED (LOST)`, `RETURN CONFIRMED` | แบนเนอร์ออเดอร์ล่าสุดขึ้น "กำลังดำเนินการ" บนงานที่ปิดแพ้/ตีกลับแล้ว (รูเดิม ไม่เกี่ยวสะกด) |
| `app/track/[id]/page.tsx:106-133` `getCurrentStep` | **รับทั้งสองสะกดครบแล้ว** (คอมเมนต์ "Canonical additions" ทุกขั้น) | — | ไม่มี — เป็นตัวอย่างที่ถูกของทั้งเว็บ |
| `app/components/tracking/PickupDeliveryLegacy.tsx:259-269` | `COLLECTED_STATUSES` / `isPayoutPhase` | — (คำเดียวกันทั้งสองสะกด) | ไม่มี |

### P3 — ตารางป้าย/สี key ด้วยสะกดเก่า (ภาคผนวก B)

- `bkk-system/functions/index.js:2701` `NOTIFY_STATUS_MAP["Payment Completed"] = "ชำระเงินเสร็จ (B2B)"` — หลัง cutover ล็อต B2B ไปที่ `Paid` ซึ่งมี key อยู่แล้ว (`"💸 จ่ายเงินเรียบร้อย"`) push แอดมินจึง**ไม่หาย แค่เปลี่ยนถ้อยคำ**เป็นของ B2C. `:2671` `"Waiting for Handover"` มีคู่ `"Waiting For Handover"` อยู่บรรทัดบน — ปลอดภัย
- `bkk-frontend-next/app/admin/members/page.tsx:323`, `app/admin/orders/page.tsx:39` — `'Active Leads'` key เดียว
- `bkk-rider-app/functions/src/index.ts` `switch (after)` — ทุก `case` สะกดเก่ามีคู่ canonical ติดกัน ยกเว้นกิ่ง payout ข้างบน
- `bkk-system/functions/b2b-unpack.js:92` `action: "Sent to QC Lab"` — ข้อความใน `qc_logs` ของงานลูก ไม่ใช่สถานะ; reader ฝั่ง `src/` อ่านผ่าน `actionIs` (normalize) แล้ว จึงเป็นความไม่สม่ำเสมอ ไม่ใช่บั๊ก

### ที่ตรวจแล้ว**ไม่พบปัญหา**และควรจดไว้ว่าทำไม

- **แอปไรเดอร์ (`src/`) ทั้ง 28 จุดสะกดเก่า มีคู่ `JOB_STATUS.X` บนบรรทัดเดียวกัน** (`ActiveJobCard`, `JobDetailPage`, `useJobActions`, `ChatModal`) และ `useRiderJobs`/`useRiderData`/`History*` normalize ก่อนเทียบ — ฝั่งนี้เขียนแบบ "รับทั้งสอง" มาตั้งแต่ Phase 2A จึงรอด. **ราคาที่จ่ายคือทุก compare ยาวสองเท่า** และไม่มีอะไรบังคับให้จุดใหม่ทำตาม (ข้อ 4)
- **`bkk-system/functions/index.js` ลิสต์ที่มีทั้งสองสะกด:** `PAID_STATUSES` (:2765 — `Paid`/`PAID`/`Payment Completed` ตัวประทับ `paid_at`), `PAYOUT_NOTIFY_STATUSES` (:2831), `RIDER_DEPARTED_STATUSES` (:4489-4494), `newStatuses`/`ORDER_CREATED_STATUSES`/`OFFER_PENDING_STATUSES` (:1700/:1949/:4106 — `Active Leads`+`Active Lead`), `statusIsCompleted` (:5114), `STILL_OUT_STATUSES` (:5287)
- **`email.js` + `email-templates-admin.js`** เทียบ `status === "Paid"` **หลัง** `normalizeStatus` (index.js:2040 `const status = normalizeStatus(after, job.receive_method)` ก่อนส่งเข้ามา, `STATUS_COPY` key เป็น canonical ล้วน และ `email-templates-admin.js` วนจาก `Object.keys(STATUS_COPY)` เอง) — `Payment Completed` → `Paid` → ใบสำคัญรับเงินฉบับเดิม ทั้งก่อนและหลัง cutover
- **`bkk-frontend-next/functions/src`** ไม่มีการเทียบสถานะเลย มีแต่ **writer** ตอนสร้างงาน (`"New Lead"` :1784, `"New B2B Lead"` :2511 — สะกดเดียวกับ enum ตามที่ตารางระบุ N)
- `bkk-system/functions/index.js:2813` `after === "In-Transit" && receive_method !== "Pickup"` — guard เฉพาะค่าเก่าที่ overload ความหมาย ค่า canonical (`Rider Returning`/`Parcel In Transit`) มี key ของตัวเองใน map จึงไม่ต้องผ่าน guard นี้

---

## 2. ใครอ่านค่าที่ `payoutTransfer.ts` เขียน — ทีละฟิลด์ พร้อมสิ่งที่จะเปลี่ยนเมื่อ writer ย้ายไป engine

writer วันนี้ (`buildPayoutUpdates`) เขียน **10 ฟิลด์บนงาน + 1-2 แถว ledger** ใน `update()` ก้อนเดียว:
`status` (`'Waiting for Handover'` B2C / `'Payment Completed'` B2B) · `paid_at` · `transferred_at` · `paid_by` · `payment_slip` · `updated_at` · `bank_name`/`bank_account`/`bank_holder` · `qc_logs[0]` (`action: 'Paid'` B2C / `'Payment Completed'` B2B, `evidence_url`, `details`) · `transactions/{debit}` (`TRADE_IN_PAYOUT`/`B2B_PURCHASE`, `rider_id: 'SYSTEM'`) · `transactions/{credit}` (`LOGISTICS_REVENUE`, เฉพาะ Pickup ที่มีค่าส่ง)

แผน cutover ที่กำลังทำ (สำหรับอ่านคอลัมน์ขวา): callable `confirmPayoutTransfer` ฝั่ง server → `applyTransition(payment_confirmed | b2b_payment_confirmed)` โดยฟิลด์ domain (`transferred_at`/`paid_by`/`payment_slip`/`bank_*`) ไปใน `patch` ของ transaction เดียวกัน · engine เขียน `status` canonical + `updated_at` + `qc_logs[0]` (`action` = สถานะปลายทาง, `details` = reason) + `paid_at` (B2C ประทับใน transaction; B2B ประทับโดย trigger `onAdminJobStatusNotify` ตอนเข้า `Paid` เพราะ registry ให้ `stampsPaid` ตัวเดียว) · แล้วค่อยเขียน ledger เป็น write ที่สอง

| ฟิลด์ที่เขียน | ค่าใหม่หลัง cutover | คนอ่าน (นอก `bkk-system/src`) | เปลี่ยนไหม |
|---|---|---|---|
| `status` B2C `'Waiting for Handover'` | `'Waiting For Handover'` | `functions/index.js` `NOTIFY_STATUS_MAP` :2665+:2671, `PAYOUT_NOTIFY_STATUSES` :2831 · `email.js` (normalize; ไม่มี copy ที่ milestone นี้ = ไม่ส่งอีเมล ทั้งก่อนหลัง) · rider `functions/src/index.ts` :220-221, :265-266 · rider `ActiveJobCard:235`, `JobDetailPage:566` (ปุ่มยืนยันส่งมอบ) · web `track/[id]:121` (step 2, UPPER), `PickupDeliveryLegacy:261/269` (UPPER) · web `useStatusNotification` (ไม่มี key) · web `abandoned-carts:66` (ไม่มี) | **ไม่เปลี่ยน** — ทุกตัวที่เห็นสะกดเก่าเห็นสะกดใหม่ด้วย; ตัวที่ไม่เห็น (notification hook, abandoned-carts) ไม่เห็นทั้งสองสะกดอยู่แล้ว |
| `status` B2B `'Payment Completed'` | `'Paid'` | `functions/index.js` `PAID_STATUSES` :2765 (มี `Paid` — ประทับ `paid_at` ให้ขานี้), :2701 label, :2831, `statusIsCompleted` :5114, `STILL_OUT_STATUSES` :5287 (มีทั้งคู่) · `email.js` (normalize → `Paid` เหมือนเดิม) · `b2b-unpack.js` `checkUnpackable` (normalize → `Paid`) · rider `functions/src/index.ts` **:222/:267** · web `abandoned-carts:66` (มี `Paid`) · `bkk-system/src`: `b2bStatus.ts` (#713 รับทั้งสาม), **`Finance.tsx:25` / `TransactionRepair.tsx:43` (#710 ยังไม่ merge — เทียบ `'Payment Completed'` สะกดเดียว)** | **เปลี่ยน 3 ที่:** push ไรเดอร์เปลี่ยนถ้อยคำ/ไม่มี `payment_transferred` (ข้อ 1) · push แอดมินเปลี่ยนถ้อยคำเป็นของ B2C (P3) · **Finance/TransactionRepair ไม่นับล็อต B2B ที่จ่ายผ่าน engine เป็น "จ่ายแล้ว" → orphan ledger ของล็อตพวกนั้นจะไม่ถูกจับจนกว่า #710 จะ merge** — และนี่คือตาข่ายกันตกของ write ที่สอง (ledger) ที่ cutover สร้างขึ้นพอดี |
| `qc_logs[0].action` `'Paid'` (B2C) / `'Payment Completed'` (B2B) | `'Waiting For Handover'` (B2C) / `'Paid'` (B2B) — engine เขียน action = สถานะปลายทาง | web `app/utils/jobPayment.ts:35` `jobWasPaid` (แต่เช็ค `paid_at` → `has_payment_slip` → `payment_slip` **ก่อน** ถึง qc_logs) · `bkk-system/src`: `qcStation.ts:157` `isJobAlreadyPaid` (`PAYOUT_PROCESSING`/`PAID`/`Deal Closed`) ซึ่งมี**สามคนอ่าน** — `submitQcStation:214` เลือกปลายทาง, `QCStation.tsx:532` + `MobileQCStation.tsx:393` เลือกข้อความปุ่ม · `CEODashboard:17` `CLOSED_LOG_ACTIONS` (วันปิดจ๊อบ) · `MobileTicketDetail:2375` `wasPaid` (`PAID` ตัวเดียว) | **เปลี่ยนเฉพาะฝั่ง `bkk-system/src` แต่กระทบสองรูปต่างกัน:** (1) `MobileTicketDetail.wasPaid` อ่านแค่ `PAID` — งาน Pickup ทุกใบที่จ่ายผ่าน engine จะไม่มี action นั้นเลย (ทางใหม่ได้ `Waiting For Handover` → `Rider Returning` → `Pending QC`; `Paid` เกิดเฉพาะ `payment_handover_done`) → ที่ Pending QC ปุ่มเสนอ "ผ่าน QC → Payout" ซ้ำแทน "ส่ง QC Lab / เก็บ Stock" **ทุกใบ** ไม่ใช่บางใบ (2) `isJobAlreadyPaid` ยังเห็น `Payout Processing` ของงานที่ผ่าน `payout_started` แต่ทางจ่ายตรงจาก Price Accepted (หน้า finance ดึงมาโอนโดยไม่ผ่าน "ผ่าน QC → Payout") ไม่มี action ไหนในลิสต์ → งาน **Mail-in/Store-in** ที่จ่ายแล้วถูก `submitQcStation` ส่งกลับ `QC Review` (วนลูปที่คอมเมนต์ในไฟล์นั้นกันไว้พอดี) และปุ่มสองสถานีขึ้นข้อความผิด; Pickup ไม่โดนข้อนี้เพราะเงื่อนไขมี `receive_method === 'Pickup'` คั่น (3) `CLOSED_LOG_ACTIONS` ทางจ่ายตรงไม่มีแถวจนกว่าจะถึง In Stock → วันปิดจ๊อบบน CEO dashboard เลื่อน. **ต้องแก้ใน PR cutover:** ให้ทั้งสามอ่าน `paid_at` ก่อน (engine ประทับใน transaction เดียวกันสำหรับ B2C) แล้วรับ `WAITING_FOR_HANDOVER` เป็น action ด้วย. ฝั่งเว็บไม่กระทบเพราะเช็ค `paid_at`/slip ก่อน |
| `qc_logs[0].evidence_url` | **หายไป** (engine ไม่มีช่องนี้ใน qc_logs; สลิปอยู่ที่ `payment_slip` เหมือนเดิม) | **ไม่มีใครอ่านใน 3 รีโป** (grep เจอแค่ `evidence_urls` ของ amendment ซึ่งคนละฟิลด์) | ไม่เปลี่ยน — ฟิลด์ที่ไม่มีคนอ่าน |
| `paid_at` | B2C: engine ประทับใน transaction เดียวกัน (= now) · B2B: trigger ประทับหลัง status ลง ~หลักร้อย ms (เดิม synchronous) | `functions/index.js` :2106-2107 (`issued_at`/`period` ของ `accounting_documents`), :2869 push payload, `checkOverdueReturns` :5364-5377 (Pickup เท่านั้น) · `email.js:540`, `:1056` (fallback หลัง `transferred_at`), `voucher-pdf.js:143` (fallback) · `status-engine.js` `jobIsPaid` (`blockedWhenPaid`) · web `TrackDeliverySection:256`, `PickupDeliveryLegacy:507/914`, `jobPayment.ts` (ลำดับแรก), `publicTrack.ts` (dead read) · rider `jobHelpers` (ไม่อ่าน paid_at อ่านสลิป) | **B2C ไม่เปลี่ยน.** B2B: ทุกคนอ่านที่ trigger/อีเมล (ยิงจาก `onValueUpdated(status)` ซึ่งเกิด**หลัง** transaction ทั้งก้อน) `onAdminJobStatusNotify` ประทับเองก่อนอ่าน · `onJobStatusEmail` ใช้ `transferred_at` ก่อน (มาใน patch) · `jobIsPaid` ที่กัน `cancelled` ของล็อต: from-list ตัด `Paid` ออกอยู่แล้ว ไม่พึ่ง `paid_at` — **ช่องว่างจริงมีช่องเดียว:** ระหว่าง transaction commit ถึง trigger เขียน `paid_at` ถ้ามีคนอ่าน `hasBeenPaid` ของล็อต B2B พอดี จะเห็น "จ่ายแล้ว" จากสถานะแต่ไม่เห็นเวลา — เท่ากับพฤติกรรมของ `admin_marked_paid` ทุกวันนี้ |
| `transferred_at` · `paid_by` · `payment_slip` · `bank_*` | เหมือนเดิม (patch ใน transaction เดียวกัน) | `transferred_at`: `email.js:540/1056`, `email-templates-admin.js:112`, `voucher-pdf.js:143` · `paid_by`: `Traceability.tsx:192` · `payment_slip`: `publicTrackFields.ts` (→ `has_payment_slip` บน `public_track`), `api/member/orders` allowlist, web `history:49`, `useUserOrders`, `jobPayment.ts`, rider `jobHelpers:15`, `bkk-system/src` `MobileLayout:51`, `TradeInPayouts:86` + `MobileFinancePage:82` (กันโผล่ซ้ำในคิวจ่ายเงิน), `TransactionRepair:87/100/212`, `Traceability:195-203`, `CustomerTracking:65` · `bank_*`: `InvoicePage:202`, จอจ่ายเงินสองจอ | **ไม่เปลี่ยน** — ชื่อฟิลด์เดิม เวลาเดิม (ต้องคง `payment_slip` ไว้ใน patch: มันคือตัวที่ทำให้งาน**หายจากคิวจ่ายเงิน**และคือ `has_payment_slip` ที่หน้า `/track` ใช้ตัดสินว่าจ่ายแล้ว) |
| `updated_at` | engine เขียนเอง | ทุกหน้าที่ sort | ไม่เปลี่ยน |
| `transactions/{debit}` `TRADE_IN_PAYOUT`/`B2B_PURCHASE` + `transactions/{credit}` `LOGISTICS_REVENUE` | รูปเดิม แต่เป็น **write ที่สองหลัง transition** (ลำดับ transition → ledger โดยตั้งใจ: ทางที่ล้มได้คือ transition ซึ่งถูกปฏิเสธได้; ledger ล้มเฉพาะ infra) | `bkk-system/src` `Finance.tsx` orphan (จับงานที่ `paid_at` แต่ไม่มี `ref_job_id`), `TransactionRepair` (ซ่อม), `FinanceAuditLog` · rider `walletLedger.ts` **ข้ามหมวดพวกนี้โดยตั้งใจ** (allowlist 6 หมวดของไรเดอร์เท่านั้น) · `bkk-frontend-next` ไม่อ่าน `/transactions` | **เปลี่ยน failure mode:** เดิม all-or-nothing · ใหม่มีช่อง "สถานะเปลี่ยนแล้ว ledger ยังไม่ลง" ซึ่ง `Finance.tsx` มีไว้จับพอดี — **แต่ตัวจับนั้นเทียบสะกดเก่า (#710) จึงมองไม่เห็นงานที่ engine เขียน** ทั้ง `Waiting For Handover` และ `Paid`. ลำดับ merge ที่ถูก: #710 ก่อน cutover |

**สรุปข้อ 2 เป็นเงื่อนไขของ PR cutover:** (ก) แก้ reader ของ `qc_logs.action` 3 ตัวใน `bkk-system/src` (`isJobAlreadyPaid` · `CLOSED_LOG_ACTIONS` · `wasPaid`) ให้อ่าน `paid_at` + รับ `WAITING_FOR_HANDOVER` — ตัว `wasPaid` พังทุกงาน Pickup ไม่ใช่เฉพาะทางจ่ายตรง (ข) ตัดสินเรื่อง push ไรเดอร์ขา B2B ที่ `bkk-rider-app/functions` (ค) merge #710 ก่อน เพราะมันคือตาข่ายของ write ที่สอง (ง) `payment_slip`/`transferred_at`/`paid_by`/`bank_*` ต้องอยู่ใน patch ครบ — เทสฝั่ง functions ควร assert ชื่อฟิลด์ทั้งชุด ไม่ใช่แค่สถานะ

---

## 3. writer นอก engine ที่เจอระหว่างสแกน (ไม่ใช่ปัญหาสะกด แต่คือคอลัมน์ "engine เขียน canonical" ที่ตอบ N)

| ที่ | เขียนอะไร | หมายเหตุ |
|---|---|---|
| `bkk-system/functions/dealer-portal.js` :1162 `"Reserved"` · :1271/:1766/:2571/:2944 คืน `prev_status` หรือ `"In Stock"` · :2740 `"Sold"` | ล็อตขายส่ง lock/unlock/markPaid | `Reserved` ไม่มี canonical (CLAUDE.md: การตัดสินใจที่ยังไม่เคาะ) — สถานะที่คืนกลับเป็นค่าที่อ่านมาก่อนล็อก จึงสะกดตามแถวเดิม |
| `bkk-system/functions/index.js` :889 `"Closed (Lost)"`, :1575 `"Drop-off Expired"`, :1602 `"Shipping Expired"`, :3136 `"Following Up"` (ถอนไรเดอร์ตอนเปลี่ยน receive_method), :4562/:4688 `"Cancelled"` (amendment) | scheduler/trigger ฝั่ง server | canonical ทุกตัว; ยังไม่ผ่าน `applyTransition` (ไม่ได้ `status_version`/`status_history`) — `finalized_lost`/`dropoff_expired`/`shipping_expired` มี event ในตารางแล้วแต่ยังไม่มีผู้เรียก |
| `bkk-frontend-next/app/api/jobs/action/route.ts` :89/:110/:143/:179/:270, `app/api/cancel-order/route.ts:65` | ลูกค้ากดยอมรับราคา/ต่อรอง/ส่งพัสดุ/ยกเลิก | canonical ทุกตัว (เขียนตรงจาก Next route ด้วย Admin SDK) — `customer_accepted_price` มีในตารางแล้ว |
| `bkk-frontend-next/functions/src/index.ts` :1784/:2511, `bkk-system/functions/email-templates-admin.js:54` | สร้างงาน (`New Lead`/`New B2B Lead`) / งานสมมติสำหรับพรีวิวอีเมล | ตอนสร้างไม่มี transition ให้ผ่าน |

ไม่พบ writer สะกดเก่าที่ไหนเลยนอก `payoutTransfer.ts` — ตรงกับที่รายงานขั้นที่ 2 แก้ข้อความไว้

---

## 4. ข้อเสนอ: ด่านต่อรีโป (แต่ละรีโปมี CI คนละแบบ ก๊อป `statusLiteralCensus.test.ts` ไปวางไม่ได้)

- **`bkk-system/functions` — `functions/test/status-literal-census.test.mjs`** รูปเดียวกับ suite ออฟไลน์ตัวอื่น (CI job "Cloud Functions" วน glob `functions/test/*.test.mjs` จึงถูกหยิบไปรันเองโดยไม่แก้ workflow) อ่านคำศัพท์จาก `status-vocab.generated.js` + คีย์ `LEGACY_ALIAS` (ต้อง export เพิ่มจาก generator — วันนี้ generated file ไม่ export ตารางนั้น) สแกน `functions/*.js` ที่ไม่ใช่ generated. **เพดานเริ่มต้นวัดวันนี้:** legacy 22 (ในนั้น `Reserved` 4 ซึ่งไม่มีคู่และต้อง allowlist เป็นชื่อ), canonical 78. หลังแก้ P1 สามจุดข้างบน legacy จะเป็น 19 — ลิสต์ที่ "รับทั้งสองสะกด" ยังนับเป็น legacy อยู่ (เจตนาเดียวกับ #714 คือถอดสะกดเก่าออกแล้ว normalize ฝั่งค่าแทน ทีละไฟล์)
- **`bkk-rider-app` — `src/utils/statusLiteralCensus.test.ts`** (vitest มีอยู่แล้ว) ครอบ `src/` + `functions/src/`. เริ่ม legacy 28 / canonical 32. ทางเดียวกับ #714: ให้ `useRiderJobs`-style normalize เป็นค่าเริ่มต้นแล้วถอดคู่สะกดเก่าออกจาก JSX ทีละไฟล์ — คู่ที่มีอยู่ไม่ผิด แต่ไม่มีอะไรบังคับจุดใหม่
- **`bkk-frontend-next` — `test/statusLiteralCensus.test.ts`** ครอบ `app/` + `lib/` + `functions/src/`. ต้องมี**กฎที่สาม**สำหรับรูป `toUpperCase()`: literal ตัวใหญ่ที่ตรงกับ `canonical.toUpperCase()` = ผ่าน, ตัวใหญ่ที่ตรงกับ `legacy.toUpperCase()` แล้วไม่มี canonical ตัวใหญ่ในลิสต์เดียวกัน = แดง (คือรูปที่ `history/page.tsx` กับ `useStatusNotification.ts` พลาด). เริ่ม legacy 6 / UPPER-legacy ที่ไม่มีคู่ 4 กลุ่ม / canonical 26
- **RTDB rules ไม่ใช่ที่ใส่ด่าน** — rules ไม่ตรวจ `status` เลยวันนี้ และการเพิ่ม `.validate` ที่บังคับสะกด canonical จะ**ปฏิเสธ writer ที่ยังเขียนตรง** (ข้อ 3 ทั้งตาราง + `payoutTransfer` จนกว่าจะ cutover) ก่อนที่พวกมันจะย้าย = พังโดยตั้งใจ ไม่ใช่ด่าน
- **ก่อน sweep ฝั่ง server ใบแรก ควรมี `normalizeStatus` เป็นทางเข้าเดียว** — `status-vocab.generated.js` มีให้แล้วและ `email.js`/`b2b-unpack.js`/`status-engine.js` ใช้อยู่ ที่เหลือใน `index.js` ยังเทียบค่าดิบทั้งไฟล์

---

## ภาคผนวก A — ทุกจุดที่ literal สถานะโผล่ในตำแหน่งเทียบ/เขียน (ยกเว้น `job-statuses.ts` ทั้งสามสำเนา, `domain.ts`, `status-vocab.generated.js`, ไฟล์เทส)

สร้างจากสคริปต์ — คอลัมน์ **รูปการเทียบ** เป็น heuristic จากบรรทัดนั้น (`list` = สมาชิกของ array/Set ที่ถูก `.includes`/`.has` · `other` = literal ในบริบทที่จำแนกไม่ได้ ดูโค้ด) · **ชนิด** `canonical(UPPER)` = ไฟล์เทียบผ่าน `toUpperCase()` ตัวใหญ่ที่ตรงกับ canonical · **คู่ canonical ใกล้ๆ** (เฉพาะ legacy) = มี string canonical, ตัวใหญ่ของมัน หรือ `JOB_STATUS.X` ในบรรทัดเดียวกันหรือ ±3 บรรทัด · **engine เขียน canonical** = literal (หรือคู่ canonical ของ legacy) อยู่ในเซ็ต `to` ของ `TRANSITIONS`

### A1 — `bkk-system/functions/*.js` (triggers · scheduler · push · email · callable) — 100 จุดเทียบ/เขียน ใน 7 ไฟล์ (+ ตารางป้าย 54 key ในภาคผนวก B)

#### `bkk-system/functions/b2b-unpack.js` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 44 | `B2B-Unpacked` | canonical | other |  | N (creator/other writer, same spelling) | `const CHILD_TYPE = "B2B-Unpacked";` |
| 92 | `Sent to QC Lab` | legacy | log-action | **ไม่มี** | Y → Sent To QC Lab | `action: "Sent to QC Lab",` |

#### `bkk-system/functions/chat-ai.js` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 5528 | `B2B-Unpacked` | canonical | === |  | N (creator/other writer, same spelling) | `if (job.type === "Accessory" \|\| job.type === "B2B-Unpacked") return;` |

#### `bkk-system/functions/dealer-portal.js` (12)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 89 | `In Stock` | canonical | list |  | Y | `const SELLABLE_STATUSES = ["In Stock", "Ready to Sell"];` |
| 89 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `const SELLABLE_STATUSES = ["In Stock", "Ready to Sell"];` |
| 426 | `Reserved` | legacy | === | **ไม่มี** | N | `const ok = SELLABLE_STATUSES.includes(st) \|\| (st === "Reserved" && job.lot_id === lotId)` |
| 1126 | `In Stock` | canonical | other |  | Y | `prevStatus[id] = String(job.status \|\| "In Stock");` |
| 1162 | `Reserved` | legacy | write | **ไม่มี** | N | `updates[ˋjobs/${id}/statusˋ] = "Reserved";` |
| 1270 | `Reserved` | legacy | === | **ไม่มี** | N | `if (job && job.lot_id === lotId && job.status === "Reserved") {` |
| 1271 | `In Stock` | canonical | other |  | Y | `updates[ˋjobs/${id}/statusˋ] = prevStatus[id] \|\| "In Stock";` |
| 1766 | `In Stock` | canonical | other |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = prevStatusOf[jobId] \|\| "In Stock";` |
| 2571 | `In Stock` | canonical | other |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = prevStatus[jobId] \|\| "In Stock";` |
| 2740 | `Sold` | canonical | write |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = "Sold";` |
| 2943 | `Reserved` | legacy | === | **ไม่มี** | N | `if (job && job.lot_id === order.lot_id && job.status === "Reserved") {` |
| 2944 | `In Stock` | canonical | other |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = prevStatus[jobId] \|\| "In Stock";` |

#### `bkk-system/functions/email-templates-admin.js` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 54 | `New Lead` | canonical | write |  | N (creator/other writer, same spelling) | `status: "New Lead",` |
| 153 | `Paid` | canonical | === |  | Y | `status === "Paid"` |
| 159 | `Paid` | canonical | === |  | Y | `...(status === "Paid" ? { attachments: await paidAttachments(jobForStatus) } : {}),` |

#### `bkk-system/functions/email.js` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 497 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2B = job.status === "New B2B Lead";` |
| 962 | `Paid` | canonical | === |  | Y | `if (status === "Paid") return buildCustomerPaymentVoucherEmail(job);` |

#### `bkk-system/functions/index.js` (78)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 765 | `Completed` | canonical | list |  | Y | `"Completed",` |
| 766 | `Sold` | canonical | list |  | Y | `"Sold",` |
| 767 | `Cancelled` | canonical | list |  | Y | `"Cancelled",` |
| 768 | `Closed (Lost)` | canonical | list |  | Y | `"Closed (Lost)",` |
| 769 | `Returned` | legacy | list | **ไม่มี** | Y → Return Confirmed | `"Returned",` |
| 872 | `Cancelled` | canonical | other |  | Y | `const jobs = await fetchJobsByStatuses(db, ["Cancelled"]);` |
| 889 | `Closed (Lost)` | canonical | write |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = "Closed (Lost)";` |
| 894 | `Closed (Lost)` | canonical | log-action |  | Y | `action: "Closed (Lost)",` |
| 1537 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `"New Lead",` |
| 1538 | `Following Up` | canonical | list |  | Y | `"Following Up",` |
| 1539 | `Appointment Set` | canonical | list |  | Y | `"Appointment Set",` |
| 1540 | `Waiting Drop-off` | canonical | list |  | Y | `"Waiting Drop-off",` |
| 1543 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `"New Lead",` |
| 1544 | `Following Up` | canonical | list |  | Y | `"Following Up",` |
| 1545 | `Awaiting Shipping` | canonical | list |  | Y | `"Awaiting Shipping",` |
| 1575 | `Drop-off Expired` | canonical | write |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = "Drop-off Expired";` |
| 1584 | `Drop-off Expired` | canonical | log-action |  | Y | `action: "Drop-off Expired",` |
| 1602 | `Shipping Expired` | canonical | write |  | Y | `updates[ˋjobs/${jobId}/statusˋ] = "Shipping Expired";` |
| 1611 | `Shipping Expired` | canonical | log-action |  | Y | `action: "Shipping Expired",` |
| 1700 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `const newStatuses = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead"];` |
| 1700 | `New B2B Lead` | canonical | list |  | N (creator/other writer, same spelling) | `const newStatuses = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead"];` |
| 1700 | `Active Leads` | legacy | list | มี | Y → Active Lead | `const newStatuses = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead"];` |
| 1700 | `Active Lead` | canonical | list |  | Y | `const newStatuses = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead"];` |
| 1727 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2B = job.status === "New B2B Lead";` |
| 1949 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `const ORDER_CREATED_STATUSES = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead` |
| 1949 | `New B2B Lead` | canonical | list |  | N (creator/other writer, same spelling) | `const ORDER_CREATED_STATUSES = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead` |
| 1949 | `Active Leads` | legacy | list | มี | Y → Active Lead | `const ORDER_CREATED_STATUSES = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead` |
| 1949 | `Active Lead` | canonical | list |  | Y | `const ORDER_CREATED_STATUSES = ["New Lead", "New B2B Lead", "Active Leads", "Active Lead` |
| 2074 | `Paid` | canonical | === |  | Y | `if (status === "Paid") {` |
| 2081 | `Paid` | canonical | === |  | Y | `if (status === "Paid") {` |
| 2252 | `Paid` | canonical | === |  | Y | `if (status === "Paid") {` |
| 2738 | `Following Up` | canonical | === |  | Y | `(after === "Following Up" \|\| after === "Rider En Route")` |
| 2738 | `Rider En Route` | canonical | === |  | Y | `(after === "Following Up" \|\| after === "Rider En Route")` |
| 2744 | `Cancelled` | canonical | === |  | Y | `if (after === "Cancelled") {` |
| 2751 | `Closed (Lost)` | canonical | === |  | Y | `if (after === "Closed (Lost)") return "ปิดงาน (Lost)";` |
| 2755 | `Following Up` | canonical | === |  | Y | `if (after === "Following Up") {` |
| 2765 | `Paid` | canonical | list |  | Y | `const PAID_STATUSES = ["Paid", "PAID", "Payment Completed"];` |
| 2765 | `PAID` | canonical(UPPER) | list |  | Y | `const PAID_STATUSES = ["Paid", "PAID", "Payment Completed"];` |
| 2765 | `Payment Completed` | legacy | list | มี | Y → Paid | `const PAID_STATUSES = ["Paid", "PAID", "Payment Completed"];` |
| 2813 | `In-Transit` | legacy | === | **ไม่มี** | Y → Rider Returning | `if (after === "In-Transit" && job.receive_method !== "Pickup") return;` |
| 2831 | `Waiting for Handover` | legacy | list | มี | Y → Waiting For Handover | `"Waiting for Handover", "Waiting For Handover",` |
| 2831 | `Waiting For Handover` | canonical | list |  | Y | `"Waiting for Handover", "Waiting For Handover",` |
| 2832 | `Payment Completed` | legacy | list | มี | Y → Paid | `"Payment Completed",` |
| 2833 | `Paid` | canonical | list |  | Y | `"Paid", "PAID",` |
| 2833 | `PAID` | canonical(UPPER) | list |  | Y | `"Paid", "PAID",` |
| 3136 | `Following Up` | canonical | write |  | Y | `if (riderPhase.includes(lower)) updates.status = "Following Up";` |
| 3391 | `Pending QC` | canonical | list |  | Y | `const FEE_TRIGGER_STATUSES = ["Pending QC", "Sent to QC Lab", "In Stock"];` |
| 3391 | `Sent to QC Lab` | legacy | list | **ไม่มี** | Y → Sent To QC Lab | `const FEE_TRIGGER_STATUSES = ["Pending QC", "Sent to QC Lab", "In Stock"];` |
| 3391 | `In Stock` | canonical | list |  | Y | `const FEE_TRIGGER_STATUSES = ["Pending QC", "Sent to QC Lab", "In Stock"];` |
| 3407 | `Pending QC` | canonical | === |  | Y | `if (after !== "Pending QC") {` |
| 4106 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `"New Lead", "Active Lead", "Active Leads", "Following Up",` |
| 4106 | `Active Lead` | canonical | list-member |  | Y | `"New Lead", "Active Lead", "Active Leads", "Following Up",` |
| 4106 | `Active Leads` | legacy | list-member | มี | Y → Active Lead | `"New Lead", "Active Lead", "Active Leads", "Following Up",` |
| 4106 | `Following Up` | canonical | list |  | Y | `"New Lead", "Active Lead", "Active Leads", "Following Up",` |
| 4107 | `Appointment Set` | canonical | list |  | Y | `"Appointment Set", "Waiting Drop-off", "Awaiting Shipping",` |
| 4107 | `Waiting Drop-off` | canonical | other |  | Y | `"Appointment Set", "Waiting Drop-off", "Awaiting Shipping",` |
| 4107 | `Awaiting Shipping` | canonical | list |  | Y | `"Appointment Set", "Waiting Drop-off", "Awaiting Shipping",` |
| 4490 | `Heading to Customer` | legacy | list | มี | Y → Rider En Route | `"Heading to Customer",` |
| 4491 | `Rider En Route` | canonical | list |  | Y | `"Rider En Route",` |
| 4492 | `Arrived` | legacy | list | มี | Y → Rider Arrived | `"Arrived",` |
| 4493 | `Rider Arrived` | canonical | list |  | Y | `"Rider Arrived",` |
| 4562 | `Cancelled` | canonical | write |  | Y | `u[ˋ${jobBase}/statusˋ] = "Cancelled";` |
| 4688 | `Cancelled` | canonical | write |  | Y | `updates[ˋjobs/${am.job_id}/statusˋ] = "Cancelled";` |
| 5114 | `Paid` | canonical | list |  | Y | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Payment Completed` | legacy | list | มี | Y → Paid | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Sent To QC Lab` | canonical | list |  | Y | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Sent to QC Lab` | legacy | list | มี | Y → Sent To QC Lab | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Ready To Sell` | canonical | list |  | Y | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Ready to Sell` | legacy | list | มี | Y → Ready To Sell | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Sold` | canonical | list |  | Y | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `In Stock` | canonical | list |  | Y | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5114 | `Completed` | canonical | list |  | Y | `return ["Paid", "Payment Completed", "Sent To QC Lab", "Sent to QC Lab", "Ready To Sell"` |
| 5176 | `Cancelled` | canonical | === |  | Y | `else if (job.status === "Cancelled" && (` |
| 5287 | `Paid` | canonical | list |  | Y | `"Paid", "PAID", "Payment Completed",` |
| 5287 | `PAID` | canonical(UPPER) | list-member |  | Y | `"Paid", "PAID", "Payment Completed",` |
| 5287 | `Payment Completed` | legacy | list | มี | Y → Paid | `"Paid", "PAID", "Payment Completed",` |
| 5288 | `Rider Returning` | canonical | list |  | Y | `"Rider Returning", "In-Transit",` |
| 5288 | `In-Transit` | legacy | list | มี | Y → Rider Returning | `"Rider Returning", "In-Transit",` |

#### `bkk-system/functions/pin-dispute.js` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 207 | `Paid` | canonical | === |  | Y | `fee_settled_at_request: job.rider_fee_status === "Paid",` |
| 298 | `Paid` | canonical | === |  | Y | `const settled = job.rider_fee_status === "Paid";` |


### A2 — `bkk-rider-app` (`src/` + `functions/src/`) — 60 จุดเทียบ/เขียน ใน 7 ไฟล์ (+ ตารางป้าย 14 key ในภาคผนวก B)

#### `bkk-rider-app/functions/src/index.ts` (7)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 177 | `Rider En Route` | canonical | === |  | Y | `(after === "Rider En Route" \|\| after === "Heading to Customer")` |
| 177 | `Heading to Customer` | legacy | === | มี | Y → Rider En Route | `(after === "Rider En Route" \|\| after === "Heading to Customer")` |
| 265 | `Waiting for Handover` | legacy | === | มี | Y → Waiting For Handover | `after === "Waiting for Handover" \|\|` |
| 266 | `Waiting For Handover` | canonical | === |  | Y | `after === "Waiting For Handover" \|\|` |
| 267 | `Payment Completed` | legacy | === | **ไม่มี** | Y → Paid | `after === "Payment Completed";` |
| 374 | `Active Leads` | legacy | === | มี | Y → Active Lead | `(after !== "Active Leads" && after !== "Active Lead") \|\|` |
| 374 | `Active Lead` | canonical | === |  | Y | `(after !== "Active Leads" && after !== "Active Lead") \|\|` |

#### `bkk-rider-app/src/components/chat/ChatModal.tsx` (9)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 18 | `Pending QC` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `In Stock` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `Paid` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `PAID` | legacy | list | มี | Y → Paid | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `Completed` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `Returned` | legacy | list | มี | Y → Return Confirmed | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `Return Confirmed` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `Closed (Lost)` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |
| 18 | `Cancelled` | canonical | list |  | Y | `const CLOSED_STATUSES = ['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returne` |

#### `bkk-rider-app/src/components/history/HistoryJobSheet.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 87 | `Paid` | canonical | === |  | Y | `const feePaid = job.rider_fee_status === 'Paid';` |

#### `bkk-rider-app/src/components/home/ActiveJobCard.tsx` (17)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 128 | `In-Transit` | legacy | list | มี | Y → Rider Returning | `{!hasPendingDiscrepancy && !['In-Transit', JOB_STATUS.RIDER_RETURNING, 'Pending QC', 'Co` |
| 128 | `Pending QC` | canonical | list |  | Y | `{!hasPendingDiscrepancy && !['In-Transit', JOB_STATUS.RIDER_RETURNING, 'Pending QC', 'Co` |
| 128 | `Completed` | canonical | list |  | Y | `{!hasPendingDiscrepancy && !['In-Transit', JOB_STATUS.RIDER_RETURNING, 'Pending QC', 'Co` |
| 138 | `Accepted` | legacy | === | มี | Y → Rider Accepted | `{(job.status === 'Accepted' \|\| job.status === JOB_STATUS.RIDER_ACCEPTED) && (` |
| 149 | `Heading to Customer` | legacy | === | มี | Y → Rider En Route | `{(job.status === 'Heading to Customer' \|\| job.status === JOB_STATUS.RIDER_EN_ROUTE) && (` |
| 155 | `Arrived` | legacy | === | มี | Y → Rider Arrived | `{((job.status === 'Arrived' \|\| job.status === JOB_STATUS.RIDER_ARRIVED) \|\| job.status ==` |
| 155 | `Being Inspected` | canonical | === |  | Y | `{((job.status === 'Arrived' \|\| job.status === JOB_STATUS.RIDER_ARRIVED) \|\| job.status ==` |
| 156 | `Arrived` | legacy | === | มี | Y → Rider Arrived | `const arrived = job.status === 'Arrived' \|\| job.status === JOB_STATUS.RIDER_ARRIVED;` |
| 177 | `QC Review` | canonical | === |  | Y | `{job.status === 'QC Review' && (() => {` |
| 228 | `Payout Processing` | canonical | === |  | Y | `{(job.status === 'Payout Processing' \|\| job.status === 'Price Accepted') && (` |
| 228 | `Price Accepted` | canonical | === |  | Y | `{(job.status === 'Payout Processing' \|\| job.status === 'Price Accepted') && (` |
| 235 | `Waiting For Handover` | canonical | list |  | Y | `{['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].includes(job.status) &` |
| 235 | `Waiting for Handover` | legacy | list | มี | Y → Waiting For Handover | `{['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].includes(job.status) &` |
| 235 | `Paid` | canonical | list |  | Y | `{['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].includes(job.status) &` |
| 235 | `PAID` | legacy | list | มี | Y → Paid | `{['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].includes(job.status) &` |
| 250 | `In-Transit` | legacy | === | มี | Y → Rider Returning | `{(job.status === 'In-Transit' \|\| job.status === JOB_STATUS.RIDER_RETURNING) && (` |
| 256 | `Revised Offer` | canonical | === |  | N (creator/other writer, same spelling) | `{job.status === 'Revised Offer' && (` |

#### `bkk-rider-app/src/hooks/useJobActions.ts` (5)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 139 | `Accepted` | legacy | === | มี | Y → Rider Accepted | `if (nextStatus === JOB_STATUS.RIDER_ACCEPTED \|\| nextStatus === 'Accepted') {` |
| 142 | `Heading to Customer` | legacy | === | มี | Y → Rider En Route | `} else if (nextStatus === JOB_STATUS.RIDER_EN_ROUTE \|\| nextStatus === 'Heading to Custom` |
| 145 | `Arrived` | legacy | === | มี | Y → Rider Arrived | `} else if (nextStatus === JOB_STATUS.RIDER_ARRIVED \|\| nextStatus === 'Arrived') {` |
| 154 | `In-Transit` | legacy | === | มี | Y → Rider Returning | `} else if (nextStatus === JOB_STATUS.RIDER_RETURNING \|\| nextStatus === 'In-Transit') {` |
| 402 | `QC Review` | canonical | === |  | Y | `if (!job \|\| job.status !== 'QC Review') {` |

#### `bkk-rider-app/src/hooks/useRiderJobs.ts` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 26 | `Active Lead` | canonical | list |  | Y | `'Active Lead',` |
| 27 | `Active Leads` | legacy | list | มี | Y → Active Lead | `'Active Leads',` |
| 28 | `Rider Assigned` | canonical | list |  | Y | `'Rider Assigned',` |
| 29 | `Assigned` | legacy | list | มี | Y → Rider Assigned | `'Assigned',` |

#### `bkk-rider-app/src/pages/JobDetailPage.tsx` (17)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 422 | `In-Transit` | legacy | list | มี | Y → Rider Returning | `{mode === 'active' && !hasPendingDiscrepancy && !['In-Transit', JOB_STATUS.RIDER_RETURNI` |
| 422 | `Pending QC` | canonical | list |  | Y | `{mode === 'active' && !hasPendingDiscrepancy && !['In-Transit', JOB_STATUS.RIDER_RETURNI` |
| 422 | `Completed` | canonical | list |  | Y | `{mode === 'active' && !hasPendingDiscrepancy && !['In-Transit', JOB_STATUS.RIDER_RETURNI` |
| 457 | `Accepted` | legacy | === | มี | Y → Rider Accepted | `{mode === 'active' && (job.status === 'Accepted' \|\| job.status === JOB_STATUS.RIDER_ACCE` |
| 468 | `Heading to Customer` | legacy | === | มี | Y → Rider En Route | `{mode === 'active' && (job.status === 'Heading to Customer' \|\| job.status === JOB_STATUS` |
| 474 | `Arrived` | legacy | === | มี | Y → Rider Arrived | `{mode === 'active' && ((job.status === 'Arrived' \|\| job.status === JOB_STATUS.RIDER_ARRI` |
| 474 | `Being Inspected` | canonical | === |  | Y | `{mode === 'active' && ((job.status === 'Arrived' \|\| job.status === JOB_STATUS.RIDER_ARRI` |
| 475 | `Arrived` | legacy | === | มี | Y → Rider Arrived | `const arrived = job.status === 'Arrived' \|\| job.status === JOB_STATUS.RIDER_ARRIVED;` |
| 507 | `QC Review` | canonical | === |  | Y | `{mode === 'active' && job.status === 'QC Review' && (() => {` |
| 559 | `Payout Processing` | canonical | === |  | Y | `{mode === 'active' && (job.status === 'Payout Processing' \|\| job.status === 'Price Accep` |
| 559 | `Price Accepted` | canonical | === |  | Y | `{mode === 'active' && (job.status === 'Payout Processing' \|\| job.status === 'Price Accep` |
| 566 | `Waiting For Handover` | canonical | list |  | Y | `{mode === 'active' && ['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].i` |
| 566 | `Waiting for Handover` | legacy | list | มี | Y → Waiting For Handover | `{mode === 'active' && ['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].i` |
| 566 | `Paid` | canonical | list |  | Y | `{mode === 'active' && ['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].i` |
| 566 | `PAID` | legacy | list | มี | Y → Paid | `{mode === 'active' && ['Waiting For Handover', 'Waiting for Handover', 'Paid', 'PAID'].i` |
| 578 | `In-Transit` | legacy | === | มี | Y → Rider Returning | `{mode === 'active' && (job.status === 'In-Transit' \|\| job.status === JOB_STATUS.RIDER_RE` |
| 584 | `Revised Offer` | canonical | === |  | N (creator/other writer, same spelling) | `{mode === 'active' && job.status === 'Revised Offer' && (` |


### A3 — `bkk-frontend-next` (`app/` + `lib/` + `functions/src/`) — 38 จุดเทียบ/เขียน ใน 13 ไฟล์ (+ ตารางป้าย 11 key ในภาคผนวก B)

#### `bkk-frontend-next/app/admin/abandoned-carts/page.tsx` (6)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 66 | `Paid` | canonical | list |  | Y | `const PAID_STATUSES = new Set(['Paid', 'Payment Completed', 'In Stock', 'Completed', 'Re` |
| 66 | `Payment Completed` | legacy | list | มี | Y → Paid | `const PAID_STATUSES = new Set(['Paid', 'Payment Completed', 'In Stock', 'Completed', 'Re` |
| 66 | `In Stock` | canonical | list |  | Y | `const PAID_STATUSES = new Set(['Paid', 'Payment Completed', 'In Stock', 'Completed', 'Re` |
| 66 | `Completed` | canonical | list |  | Y | `const PAID_STATUSES = new Set(['Paid', 'Payment Completed', 'In Stock', 'Completed', 'Re` |
| 66 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `const PAID_STATUSES = new Set(['Paid', 'Payment Completed', 'In Stock', 'Completed', 'Re` |
| 66 | `Sold` | canonical | list |  | Y | `const PAID_STATUSES = new Set(['Paid', 'Payment Completed', 'In Stock', 'Completed', 'Re` |

#### `bkk-frontend-next/app/admin/page.tsx` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 55 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const pending = orders.filter((o: any) => o.status === 'pending' \|\| o.status === 'review` |
| 55 | `Active Leads` | legacy | === | **ไม่มี** | Y → Active Lead | `const pending = orders.filter((o: any) => o.status === 'pending' \|\| o.status === 'review` |

#### `bkk-frontend-next/app/api/cancel-order/route.ts` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 56 | `Cancelled` | canonical | log-action |  | Y | `action: 'Cancelled',` |
| 65 | `Cancelled` | canonical | write |  | Y | `status: 'Cancelled',` |

#### `bkk-frontend-next/app/api/jobs/action/route.ts` (7)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 89 | `Price Accepted` | canonical | write |  | Y | `status: 'Price Accepted',` |
| 94 | `Price Accepted` | canonical | log-action |  | Y | `action: 'Price Accepted',` |
| 110 | `Negotiation` | canonical | write |  | Y | `updates = { status: 'Negotiation', updated_at: now };` |
| 143 | `Parcel In Transit` | canonical | write |  | Y | `status: 'Parcel In Transit',` |
| 157 | `Pre-Quote Accepted` | canonical | list |  | Y | `const newStatus = currentLower.includes('final') ? 'Final Quote Accepted' : 'Pre-Quote A` |
| 179 | `Negotiation` | canonical | write |  | Y | `updates = { status: 'Negotiation', updated_at: now };` |
| 270 | `Returning To Customer` | canonical | value |  | Y | `status: accepted ? 'Price Accepted' : 'Returning To Customer',` |

#### `bkk-frontend-next/app/components/tracking/PickupDeliveryLegacy.tsx` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 261 | `PRICE ACCEPTED` | legacy | other | มี | Y → Price Accepted | `'APPROVED', 'PRICE ACCEPTED', 'PAYOUT PROCESSING', 'WAITING FOR HANDOVER',` |
| 269 | `PRICE ACCEPTED` | legacy | list-member | มี | Y → Price Accepted | `'APPROVED', 'PRICE ACCEPTED', 'PAYOUT PROCESSING', 'WAITING FOR HANDOVER',` |

#### `bkk-frontend-next/app/corporate/CorporateTradeInClient.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 364 | `Pending QC` | canonical | write |  | Y | `{ no: 5, device: 'iPhone 13 128GB', serial: '353•••••567', grade: 'C', gradeColor: 'text` |

#### `bkk-frontend-next/app/history/page.tsx` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 52 | `PAID` | canonical(UPPER) | list |  | Y | `if (slipUrl \|\| ['PAYMENT COMPLETED', 'PAID', 'COMPLETED', 'DEAL CLOSED', 'IN STOCK', 'RE` |
| 53 | `PRICE ACCEPTED` | canonical(UPPER) | list |  | Y | `if (['ACCEPTED', 'IN-TRANSIT', 'APPOINTMENT SET', 'WAITING DROP-OFF', 'ARRIVED', 'PENDIN` |
| 78 | `PRICE ACCEPTED` | canonical(UPPER) | list |  | Y | `if (['PRICE ACCEPTED', 'REVISED OFFER', 'PAYOUT PROCESSING', 'PENDING FINANCE APPROVAL',` |

#### `bkk-frontend-next/app/i18n/dictionaries/home.en.ts` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 230 | `Sold` | canonical | value |  | Y | `soldPrefix: 'Sold',` |

#### `bkk-frontend-next/app/i18n/dictionaries/member.en.ts` (5)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 49 | `Paid` | canonical | value |  | Y | `statusPaid: 'Paid',` |
| 50 | `Cancelled` | canonical | value |  | Y | `statusCancelled: 'Cancelled',` |
| 121 | `Completed` | canonical | value |  | Y | `statCompleted: 'Completed',` |
| 127 | `Paid` | canonical | value |  | Y | `completed: 'Paid',` |
| 128 | `Cancelled` | canonical | value |  | Y | `cancelled: 'Cancelled',` |

#### `bkk-frontend-next/app/profile/hooks/useUserOrders.ts` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 65 | `PAID` | canonical(UPPER) | list |  | Y | `if (slip \|\| ['PAYMENT COMPLETED', 'PAID', 'COMPLETED', 'DEAL CLOSED'].includes(s))` |

#### `bkk-frontend-next/app/track/[id]/page.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 114 | `PAID` | canonical(UPPER) | list-member |  | Y | `'PAYMENT COMPLETED', 'PAID', 'IN STOCK', 'COMPLETED',` |
| 123 | `PRICE ACCEPTED` | canonical(UPPER) | other |  | Y | `'PENDING QC', 'PRICE ACCEPTED', 'REVISED OFFER',` |
| 366 | `Cancelled` | canonical | === |  | Y | `const isSoftCancelled = job?.status === 'Cancelled';` |
| 367 | `Closed (Lost)` | canonical | === |  | Y | `const isCancelled = isSoftCancelled \|\| job?.status === 'Closed (Lost)';` |

#### `bkk-frontend-next/app/utils/jobPayment.ts` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 35 | `Paid` | canonical | === |  | Y | `(l: any) => l && (l.action === 'Paid' \|\| l.action === 'PAID'),` |
| 35 | `PAID` | legacy | === | มี | Y → Paid | `(l: any) => l && (l.action === 'Paid' \|\| l.action === 'PAID'),` |

#### `bkk-frontend-next/functions/src/index.ts` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 1784 | `New Lead` | canonical | other |  | N (creator/other writer, same spelling) | `const initialStatus = "New Lead";` |
| 2511 | `New B2B Lead` | canonical | write |  | N (creator/other writer, same spelling) | `status: "New B2B Lead",` |

## ภาคผนวก B — ตารางป้าย/สี/`<option>` ที่ key ด้วย literal (ไม่ใช่การเทียบ แต่ key สะกดเดียวจะได้ค่า default สำหรับอีกสะกด)

### B-1 — `bkk-system/functions` (54 key)

| ไฟล์:บรรทัด | key | ชนิด | มีคู่ canonical เป็น key ด้วยไหม | โค้ด |
|---|---|---|---|---|
| `bkk-system/functions/email.js:771` | `Active Lead` | canonical |  | `"Active Lead": {` |
| `bkk-system/functions/email.js:790` | `Appointment Set` | canonical |  | `"Appointment Set": {` |
| `bkk-system/functions/email.js:801` | `Drop-off Received` | canonical |  | `"Drop-off Received": {` |
| `bkk-system/functions/email.js:809` | `Parcel Received` | canonical |  | `"Parcel Received": {` |
| `bkk-system/functions/email.js:817` | `Being Inspected` | canonical |  | `"Being Inspected": {` |
| `bkk-system/functions/email.js:825` | `Revised Offer` | canonical |  | `"Revised Offer": {` |
| `bkk-system/functions/email.js:858` | `Closed (Lost)` | canonical |  | `"Closed (Lost)": {` |
| `bkk-system/functions/email.js:869` | `Drop-off Expired` | canonical |  | `"Drop-off Expired": {` |
| `bkk-system/functions/email.js:877` | `Shipping Expired` | canonical |  | `"Shipping Expired": {` |
| `bkk-system/functions/email.js:885` | `Investigating Carrier` | canonical |  | `"Investigating Carrier": {` |
| `bkk-system/functions/email.js:893` | `Parcel Lost` | canonical |  | `"Parcel Lost": {` |
| `bkk-system/functions/email.js:901` | `Returning To Customer` | canonical |  | `"Returning To Customer": {` |
| `bkk-system/functions/email.js:909` | `Return Confirmed` | canonical |  | `"Return Confirmed": {` |
| `bkk-system/functions/email.js:929` | `Refund Initiated` | canonical |  | `"Refund Initiated": {` |
| `bkk-system/functions/email.js:941` | `Refund Completed` | canonical |  | `"Refund Completed": {` |
| `bkk-system/functions/index.js:2626` | `Appointment Set` | canonical |  | `"Appointment Set": "📅 นัดหมายลูกค้าเรียบร้อย",` |
| `bkk-system/functions/index.js:2627` | `Waiting Drop-off` | canonical |  | `"Waiting Drop-off": "🏬 รอลูกค้านำเครื่องมาส่งที่สาขา",` |
| `bkk-system/functions/index.js:2628` | `Awaiting Shipping` | canonical |  | `"Awaiting Shipping": "📮 รอลูกค้าส่งเครื่องทางไปรษณีย์",` |
| `bkk-system/functions/index.js:2630` | `Revised Offer` | canonical |  | `"Revised Offer": "💰 เสนอราคาใหม่",` |
| `bkk-system/functions/index.js:2632` | `Price Accepted` | canonical |  | `"Price Accepted": "✅ ลูกค้ารับราคา",` |
| `bkk-system/functions/index.js:2633` | `Discrepancy Reported` | canonical |  | `"Discrepancy Reported": "❗ พบความไม่ตรงตอนตรวจ — ต้องตรวจสอบ",` |
| `bkk-system/functions/index.js:2647` | `Rider Assigned` | canonical |  | `"Rider Assigned": "📋 จ่ายงานให้ไรเดอร์",` |
| `bkk-system/functions/index.js:2649` | `Rider Accepted` | canonical |  | `"Rider Accepted": "✋ ไรเดอร์รับงาน",` |
| `bkk-system/functions/index.js:2651` | `Rider En Route` | canonical |  | `"Rider En Route": "🛣️ ไรเดอร์ออกเดินทาง",` |
| `bkk-system/functions/index.js:2652` | `Heading to Customer` | legacy | มี | `"Heading to Customer": "🛣️ ไรเดอร์ออกเดินทาง",` |
| `bkk-system/functions/index.js:2653` | `Rider Arrived` | canonical |  | `"Rider Arrived": "📍 ไรเดอร์ถึงจุดนัดหมาย",` |
| `bkk-system/functions/index.js:2656` | `Drop-off Received` | canonical |  | `"Drop-off Received": "📥 ลูกค้านำเครื่องมาส่งที่สาขาแล้ว",` |
| `bkk-system/functions/index.js:2657` | `Parcel In Transit` | canonical |  | `"Parcel In Transit": "📦 พัสดุอยู่ระหว่างขนส่ง",` |
| `bkk-system/functions/index.js:2658` | `Parcel Received` | canonical |  | `"Parcel Received": "📬 พัสดุถึงสาขาแล้ว",` |
| `bkk-system/functions/index.js:2660` | `Being Inspected` | canonical |  | `"Being Inspected": "🔍 ไรเดอร์เริ่มตรวจสภาพเครื่อง",` |
| `bkk-system/functions/index.js:2661` | `QC Review` | canonical |  | `"QC Review": "⚠️ ส่งผลตรวจ — รออนุมัติ QC",` |
| `bkk-system/functions/index.js:2662` | `Pending QC` | canonical |  | `"Pending QC": "📦 ไรเดอร์ส่งมอบเครื่อง — รอ QC",` |
| `bkk-system/functions/index.js:2664` | `Payout Processing` | canonical |  | `"Payout Processing": "💵 รอจ่ายเงิน — บัญชีต้อง action",` |
| `bkk-system/functions/index.js:2665` | `Waiting For Handover` | canonical |  | `"Waiting For Handover": "🤝 จ่ายเงินแล้ว — รอส่งมอบเครื่องกลับ",` |
| `bkk-system/functions/index.js:2671` | `Waiting for Handover` | legacy | **ไม่มี** | `"Waiting for Handover": "🤝 จ่ายเงินแล้ว — รอส่งมอบเครื่องกลับ",` |
| `bkk-system/functions/index.js:2673` | `Rider Returning` | canonical |  | `"Rider Returning": "🔙 ไรเดอร์กำลังกลับสาขา",` |
| `bkk-system/functions/index.js:2674` | `In-Transit` | legacy | มี | `"In-Transit": "🔙 ไรเดอร์กำลังกลับสาขา",` |
| `bkk-system/functions/index.js:2679` | `Return Confirmed` | canonical |  | `"Return Confirmed": "ตีเครื่องกลับ",` |
| `bkk-system/functions/index.js:2680` | `Returning To Customer` | canonical |  | `"Returning To Customer": "↩️ กำลังตีเครื่องคืนลูกค้า",` |
| `bkk-system/functions/index.js:2684` | `Refund Initiated` | canonical |  | `"Refund Initiated": "⚠️ พบปัญหาหลังจ่ายเงิน — ต้องเรียกเงินคืน (admin ต้อง actio` |
| `bkk-system/functions/index.js:2685` | `Refund Completed` | canonical |  | `"Refund Completed": "✅ ปิดเรื่องเรียกคืนเงินแล้ว",` |
| `bkk-system/functions/index.js:2688` | `Drop-off Expired` | canonical |  | `"Drop-off Expired": "⏰ ลูกค้าไม่มา drop-off ตามนัด — งานหมดอายุ",` |
| `bkk-system/functions/index.js:2689` | `Shipping Expired` | canonical |  | `"Shipping Expired": "⏰ ลูกค้าไม่ส่งพัสดุตามนัด — งานหมดอายุ",` |
| `bkk-system/functions/index.js:2690` | `Investigating Carrier` | canonical |  | `"Investigating Carrier": "🔎 กำลังตามขนส่ง — พัสดุล่าช้า",` |
| `bkk-system/functions/index.js:2691` | `Parcel Lost` | canonical |  | `"Parcel Lost": "🚨 ขนส่งทำพัสดุหาย",` |
| `bkk-system/functions/index.js:2693` | `Pre-Quote Sent` | canonical |  | `"Pre-Quote Sent": "ส่งใบเสนอราคาเบื้องต้น (B2B)",` |
| `bkk-system/functions/index.js:2694` | `Pre-Quote Accepted` | canonical |  | `"Pre-Quote Accepted": "ลูกค้ายอมรับราคาเบื้องต้น (B2B)",` |
| `bkk-system/functions/index.js:2695` | `Site Visit & Grading` | canonical |  | `"Site Visit & Grading": "ส่งทีมประเมินหน้างาน (B2B)",` |
| `bkk-system/functions/index.js:2696` | `Final Quote Sent` | canonical |  | `"Final Quote Sent": "ส่งใบเสนอราคาจริง (B2B)",` |
| `bkk-system/functions/index.js:2697` | `Final Quote Accepted` | canonical |  | `"Final Quote Accepted": "ลูกค้ายอมรับราคาจริง (B2B)",` |
| `bkk-system/functions/index.js:2698` | `PO Issued` | canonical |  | `"PO Issued": "ออก PO เรียบร้อย (B2B)",` |
| `bkk-system/functions/index.js:2699` | `Waiting for Invoice/Tax Inv.` | canonical |  | `"Waiting for Invoice/Tax Inv.": "รอใบกำกับภาษี (B2B)",` |
| `bkk-system/functions/index.js:2700` | `Pending Finance Approval` | canonical |  | `"Pending Finance Approval": "รอบัญชีตรวจสอบ (B2B)",` |
| `bkk-system/functions/index.js:2701` | `Payment Completed` | legacy | **ไม่มี** | `"Payment Completed": "ชำระเงินเสร็จ (B2B)",` |

### B-2 — `bkk-rider-app` (14 key)

| ไฟล์:บรรทัด | key | ชนิด | มีคู่ canonical เป็น key ด้วยไหม | โค้ด |
|---|---|---|---|---|
| `bkk-rider-app/functions/src/index.ts:193` | `Assigned` | legacy | มี | `case "Assigned":` |
| `bkk-rider-app/functions/src/index.ts:194` | `Rider Assigned` | canonical |  | `case "Rider Assigned":` |
| `bkk-rider-app/functions/src/index.ts:199` | `QC Review` | canonical |  | `case "QC Review":` |
| `bkk-rider-app/functions/src/index.ts:203` | `Price Accepted` | canonical |  | `case "Price Accepted":` |
| `bkk-rider-app/functions/src/index.ts:208` | `Revised Offer` | canonical |  | `case "Revised Offer":` |
| `bkk-rider-app/functions/src/index.ts:213` | `Completed` | canonical |  | `case "Completed":` |
| `bkk-rider-app/functions/src/index.ts:214` | `Paid` | canonical |  | `case "Paid":` |
| `bkk-rider-app/functions/src/index.ts:215` | `PAID` | legacy | มี | `case "PAID":` |
| `bkk-rider-app/functions/src/index.ts:220` | `Waiting for Handover` | legacy | มี | `case "Waiting for Handover":` |
| `bkk-rider-app/functions/src/index.ts:221` | `Waiting For Handover` | canonical |  | `case "Waiting For Handover":` |
| `bkk-rider-app/functions/src/index.ts:222` | `Payment Completed` | legacy | **ไม่มี** | `case "Payment Completed":` |
| `bkk-rider-app/functions/src/index.ts:232` | `Cancelled` | canonical |  | `case "Cancelled": {` |
| `bkk-rider-app/functions/src/index.ts:253` | `Returning To Customer` | canonical |  | `case "Returning To Customer":` |
| `bkk-rider-app/functions/src/index.ts:254` | `Return Confirmed` | canonical |  | `case "Return Confirmed":` |

### B-3 — `bkk-frontend-next` (11 key)

| ไฟล์:บรรทัด | key | ชนิด | มีคู่ canonical เป็น key ด้วยไหม | โค้ด |
|---|---|---|---|---|
| `bkk-frontend-next/app/admin/members/page.tsx:322` | `New Lead` | canonical |  | `'New Lead': { text: 'รอตรวจสอบ', cls: 'bg-amber-100 text-amber-700' },` |
| `bkk-frontend-next/app/admin/members/page.tsx:323` | `Active Leads` | legacy | **ไม่มี** | `'Active Leads': { text: 'รอตรวจสอบ', cls: 'bg-amber-100 text-amber-700' },` |
| `bkk-frontend-next/app/admin/orders/page.tsx:38` | `New Lead` | canonical |  | `'New Lead': { text: 'รอตรวจสอบ', cls: 'bg-amber-100 text-amber-700 border-amber-` |
| `bkk-frontend-next/app/admin/orders/page.tsx:39` | `Active Leads` | legacy | **ไม่มี** | `'Active Leads': { text: 'รับเรื่องแล้ว', cls: 'bg-blue-100 text-blue-700 border-` |
| `bkk-frontend-next/app/admin/orders/page.tsx:191` | `New Lead` | canonical |  | `<option value="New Lead">รอตรวจสอบ</option>` |
| `bkk-frontend-next/app/admin/orders/page.tsx:192` | `Active Leads` | legacy | **ไม่มี** | `<option value="Active Leads">รับเรื่องแล้ว</option>` |
| `bkk-frontend-next/app/api/jobs/action/route.ts:157` | `Final Quote Accepted` | canonical |  | `const newStatus = currentLower.includes('final') ? 'Final Quote Accepted' : 'Pre` |
| `bkk-frontend-next/app/api/jobs/action/route.ts:270` | `Price Accepted` | canonical |  | `status: accepted ? 'Price Accepted' : 'Returning To Customer',` |
| `bkk-frontend-next/app/components/checkout-v2/PriceRevisionCard.tsx:5` | `Revised Offer` | canonical |  | `Shown in the track page when status === 'Revised Offer': the team` |
| `bkk-frontend-next/app/hooks/useStatusNotification.ts:11` | `PRICE ACCEPTED` | canonical(UPPER) |  | `'PRICE ACCEPTED': { title: 'ยืนยันราคาแล้ว', body: 'ราคารับซื้อได้รับการยืนยันเร` |
| `bkk-frontend-next/app/hooks/useStatusNotification.ts:14` | `PAID` | canonical(UPPER) |  | `'PAID': { title: 'โอนเงินสำเร็จ!', body: 'เงินถูกโอนเข้าบัญชีของคุณเรียบร้อยแล้ว` |