# สำรวจทุกจุดที่เทียบสถานะงานกับ string literal ในแอดมิน (4 ก.ย. 2569)

**ที่มา:** วันเดียวกันเจอกับดักเดียวกันสองรอบ — `/qc-station` To Do ว่าง (#709, engine เขียน `Sent To QC Lab` แต่หน้าเทียบ `'Sent to QC Lab'`) แล้วพอ deploy `/inventory` ก็หายเครื่องที่ขึ้น POS (#711, engine เขียน `Ready To Sell` แต่หน้าเทียบ `'Ready to Sell'`). ทั้งสองครั้งไม่มี error ไม่มีเทสแดง หน้าจอแค่ว่างลงเงียบๆ. รายงานนี้ไล่ทั้ง `src/` ให้ครบทีเดียว เพื่อให้เหลือ sweep PR ใบเดียว ไม่ใช่ hotfix ทีละหน้าตามที่ผู้ใช้บ่น

**ข้อเท็จจริงหลักที่ทำให้กับดักนี้ "ติดอาวุธ" แล้ว:** ตั้งแต่ P2/P3 (#661–#707, 3–4 ก.ย.) **ไม่มี writer ตัวไหนใน 3 repo เขียนสะกดเก่าอีกแล้ว** — grep `status: '<สะกดเก่า>'` ทั้ง `bkk-system/src`, `bkk-system/functions`, `bkk-rider-app`, `bkk-frontend-next` ได้ศูนย์ (ยกเว้น `B2CWorkspace.tsx:608` ซึ่งอยู่ในคอมโพเนนต์ที่ไม่ถูก mount). ทุกแถวใหม่จึงเป็น canonical ล้วน และ **ทุก reader ที่เทียบสะกดเก่าเพียงสะกดเดียวจะไม่เห็นแถวใหม่แม้แต่ใบเดียว** — ไม่ใช่ "บางที" ไม่ใช่ "เฉพาะบางเครื่อง"

สคริปต์ที่ใช้สแกน (ทำซ้ำได้): ดึงค่าจาก `functions/status-vocab.generated.js` (`JOB_STATUS` + `JOB_STATUS_B2B`) + คีย์ใน `LEGACY_ALIAS` ของ `src/types/job-statuses.ts` + `In-Transit`/`Reserved`/`PAID` แล้ว grep เป็น string literal ในทุก `.ts/.tsx` ใต้ `src/` ที่ไม่ใช่เทส ตัดบรรทัดคอมเมนต์ทิ้ง → 528 hit → คัดเฉพาะรูปการเทียบ (`===`/`!==`/`case`/ลิสต์ที่ถูก `.includes`/`Set`) = **375 จุด ใน 37 ไฟล์** (ภาคผนวก A) + ตารางป้าย/สีอีก 92 key (ภาคผนวก B)

---

## 1. ลำดับความสำคัญสำหรับ sweep PR

### P1 — เทียบสะกดเก่าสะกดเดียว ในจุดที่ตัดสิน "แถวนี้โผล่ไหม / ปุ่มนี้ขึ้นไหม / นับไหม" (พังแบบ #709/#711 อยู่ตอนนี้)

| ไฟล์:บรรทัด | literal | engine เขียน | ผลบนจอตอนนี้ |
|---|---|---|---|
| `src/pages/sales/POS.tsx:22` | `j.status === 'Ready to Sell'` | `Ready To Sell` (`pushed_to_pos`) | **POS ไม่เห็นเครื่องที่กด Push to POS หลัง #674** — ขายหน้าร้านไม่ได้ ตัวเดียวกับ #711 แต่คนละหน้า |
| `src/components/layout/NotificationCenter.tsx:73` | `['In Stock','Ready to Sell'].includes` | เดียวกัน | ตัวนับสต็อกในกระดิ่งขาด |
| `src/pages/dashboard/CEODashboard.tsx:76` | เดียวกัน | เดียวกัน | KPI สต็อกบน CEO dashboard ต่ำกว่าจริง |
| `src/pages/analytics/Analytics.tsx:132` | เดียวกัน | เดียวกัน | มูลค่าสต็อกใน Analytics ต่ำกว่าจริง |
| `src/pages/inventory/StockAudit.tsx:33` | เดียวกัน | เดียวกัน | ตรวจนับสต็อกไม่เห็นเครื่องที่ขึ้น POS |
| `src/pages/dealers/LotManager.tsx:171` | เดียวกัน | เดียวกัน | เลือกเครื่องเข้าล็อตขายส่งไม่เห็นเครื่องบน POS |
| `src/pages/mobile/MobileLayout.tsx:61` | เดียวกัน | เดียวกัน | badge สต็อกบนมือถือ |
| `src/pages/mobile/MobileNotificationsPage.tsx:70` | เดียวกัน | เดียวกัน | แจ้งเตือนสต็อกบนมือถือ |
| `src/pages/finance/components/RiderSettlements.tsx:32` | `j.status === 'Waiting for Handover'` | `Waiting For Handover` (`payout_*`) | งานที่รอส่งมอบหลุดจากรายการเคลียร์ค่ารอบไรเดอร์ |
| `src/pages/finance/Finance.tsx:25` · `components/TransactionRepair.tsx:43` | `'Waiting for Handover'` / `'Sent to QC Lab'` / `'Payment Completed'` | ทั้งสาม | **แก้แล้วใน #710 (draft) — รอตัวเลข before/after** |
| `src/features/trade-in/TradeInDashboard.tsx:114` | `isB2BLogistics = [..., 'Payment Completed']` | B2B จ่ายเงินแล้วเขียน `Paid` ตั้งแต่ P3-a (#690) | ล็อต B2B ที่จ่ายแล้วหลุดจากแท็บ Logistics ของ B2B |
| `src/features/trade-in/TradeInDashboard.tsx:247` | `case 'Payment Completed'` (badge) | เดียวกัน | ล็อตที่จ่ายแล้วขึ้นป้าย default แทน PAID |
| `src/features/trade-in/components/b2b/B2BAuditorTool.tsx:91` | `lockedStatuses = [..., 'Payment Completed', ...]` | เดียวกัน | **ล็อตที่จ่ายเงินแล้วยังแก้เกรด/ราคาได้** เพราะไม่ถูกล็อก — ทิศอันตราย |
| `src/pages/fleet/DispatcherPage.tsx:259` | `task.status === 'Assigned'` | `Rider Assigned` (`rider_assigned`) | ปุ่ม/ป้ายของงานที่เพิ่ง assign บน dispatcher (บรรทัด 78 รับทั้งคู่แล้ว แต่ 259 ไม่) |
| `src/components/Fleet/AdminChatBox.tsx:137` | `[..., 'Returned', ...].includes` (ปิดแชท) | `Return Confirmed` (`return_confirmed`) | งานที่คืนเครื่องแล้วยังเปิดแชทได้ |
| `src/pages/mobile/MobileLayout.tsx:66` | `alertStatuses = [..., 'Returned', ...]` | เดียวกัน | ไม่แจ้งเตือนตอนคืนเครื่อง |
| `src/pages/mobile/MobileTicketDetail.tsx:1608`, `:1874` | `!['Cancelled','Completed','Paid','Returned'].includes` | เดียวกัน | ปุ่มแก้ไข/ยกเลิกยังขึ้นบนงานที่คืนเครื่องแล้ว |
| `src/features/trade-in/components/modal/TradeInUI.tsx:36-39`, `:78-79` | `isCancelled` list มี `'Returned'`+`'Return Confirmed'` (ปลอดภัย) แต่ `status === 'Returned'` ที่ 78-79 เลือกข้อความ | เดียวกัน | งานคืนเครื่องขึ้นข้อความ "Cancelled" แทน "Item Returned" |
| `src/pages/mobile/MobileTicketDetail.tsx:2354` | `case 'In-Transit'` | `Rider Returning` / `Parcel In Transit` | ต้องดู case ข้างเคียง — ถ้ามี case canonical แยกแล้ว บรรทัดนี้แค่ legacy fallback (ตรวจตอนทำ sweep) |

**รูปเดียวกันทั้งหมด 4 กลุ่ม** — `Ready to Sell` (×10), `Payment Completed` (B2B ×3), `Returned` (×5), `Waiting for Handover` (×3 นอก #710). แก้ด้วย helper ที่มีอยู่แล้ว: `isInventoryStock/isReadyToSell` (#711), `isPostSaleRewindable` (#709) หรือ `normalizeStatus(j.status, j.receive_method) === JOB_STATUS.*` ตรงๆ

### P2 — เทียบ canonical สะกดเดียว (ไม่พังสำหรับแถวใหม่ แต่**มองไม่เห็นแถวเก่า**ที่ยังสะกดเดิมถาวรใน DB)

283 จุด (ดูภาคผนวก A คอลัมน์ `canonical`). ผลคือหน้าประวัติ/analytics/รายงานที่ย้อนดูงานเก่า bucket ผิด. CLAUDE.md ระบุอยู่แล้วว่าย้ายเมื่อแตะไฟล์ — ไม่ต้องเข้า sweep ใบเดียวกับ P1 แต่ควรตั้ง ceiling (ข้อ 3) ไม่ให้เพิ่ม. ไฟล์ที่หนักสุด: `MobileTicketDetail.tsx` (146 hit ทั้งไฟล์ — `switch (status)` ใน `getQuickActions` เทียบค่าดิบทุก case), `TradeInDashboard.tsx` (25), `DispatcherPage.tsx` (22), `B2CWorkspacePage.tsx` (16), `AppointmentCalendar.tsx` (15), `B2BDispatchQueue.tsx` (14)

### P3 — ตารางป้าย/สี key ด้วย literal (ภาคผนวก B)

`src/utils/statusColors.ts` (39 key) เป็นตัวใหญ่สุด — key สะกดเดียว = อีกสะกดได้สี default. แก้ที่เดียวด้วยการ lookup ผ่าน `normalizeStatus(raw) ?? raw` ก่อนเปิดตาราง แล้วเก็บ key เป็น canonical + `Reserved`

---

## 2. ทำไม "engine เขียน canonical" ครอบทุกแถวใหม่แล้ว

- เซ็ต `to` ของ `TRANSITIONS` (`functions/status-engine.js`) มี 45 ค่า ทั้งหมดเป็น canonical — รวมคู่ของทุกสะกดเก่าที่ยังถูกเทียบอยู่: `Ready To Sell`, `Waiting For Handover`, `Sent To QC Lab`, `Paid` (แทน `Payment Completed`/`PAID` ทั้งสาย B2C และ B2B), `Active Lead`, `Rider Assigned`/`Rider Accepted`/`Rider Arrived`/`Rider En Route`, `Return Confirmed`, `Rider Returning`/`Parcel In Transit`
- สถานะที่ engine **ไม่ได้**เขียน (ตารางระบุ N): `New Lead`, `New B2B Lead` (เขียนตอนสร้างงาน สะกดเดียวกับ enum), `Reserved` (dealer portal ฝั่ง server — ไม่มี canonical), `Auditor Assigned`, `B2B-Unpacked` (สร้างงานลูก) — เทียบ literal สะกดนั้นยังถูกต้องเพราะ writer กับ reader สะกดเดียวกัน
- แถวเก่าสะกดเดิม**อยู่ถาวร** (ไม่มี migration และ CLAUDE.md บอกว่าไม่ควรมี) → การเทียบที่ถูกต้องคือ normalize ทั้งสองฝั่ง ไม่ใช่เปลี่ยน literal จากสะกดเก่าเป็นสะกดใหม่ (นั่นคือย้ายรูของ P1 ไปเป็นรูของ P2)

---

## 3. ข้อเสนอ: ด่าน CI ที่แดงเมื่อมี literal compare ใหม่

ตอนนี้ไม่มีอะไรจับได้เลย — `tsc` ไม่รู้จักความต่าง `'Sent to QC Lab'`/`'Sent To QC Lab'`, eslint ใน CI เป็น advisory (`continue-on-error: true`), และเทสของแต่ละหน้ามีเฉพาะที่เพิ่งเขียนใน #709/#711

**ข้อเสนอ ก (บังคับ ทำได้ใน sweep PR): `src/utils/statusLiteralCensus.test.ts` — รูปเดียวกับ `statusWriterCensus.test.ts`** ที่มีอยู่และ gate อยู่แล้ว
- เดินทุก `src/**/*.{ts,tsx}` ที่ไม่ใช่เทส ยกเว้น `types/job-statuses.ts`, `types/domain.ts` และ allowlist ของไฟล์ที่ normalize ทั้งสองฝั่งแล้ว (`utils/qcStation.ts`, `utils/inventoryStatus.ts`, `utils/jobTransitions.ts`, `utils/statusColors.ts` เมื่อแก้ตาม P3)
- นับ literal ที่อยู่ในคำศัพท์สถานะ (`JOB_STATUS` + `JOB_STATUS_B2B` + คีย์ `LEGACY_ALIAS` + `In-Transit`/`PAID`) ในตำแหน่งเทียบ — regex ชุดเดียวกับที่ใช้สร้างภาคผนวก A, ตัดบรรทัดคอมเมนต์ก่อน (บทเรียน 4 ก.ย.: regex โกหกได้สองทาง)
- **สองเพดาน ลดได้ ขึ้นไม่ได้:** `legacy` (เริ่มที่ 92 = จำนวน legacy compare วันนี้) และ `canonical` (เริ่มที่ 283). แดงเพราะเพิ่ม = ไปแก้ที่ reader ใหม่ให้ใช้ `normalizeStatus`; แดงเพราะลด = ลดเลขพร้อม PR
- เพดาน `legacy` ต้องไปถึง 0 หลัง sweep แล้ว **ล็อกที่ 0** — ตั้งแต่นั้น literal สะกดเก่าตัวเดียวใน compare ก็แดง
- ทำไมเป็น vitest ไม่ใช่ eslint: job "Admin app (lint, types, tests)" gate ด้วยเทส ไม่ gate ด้วย lint และเทสอ่านไฟล์ enum จริงได้ (regex ไม่ต้อง hardcode คำศัพท์ — เพิ่มสถานะแล้วด่านตามเอง)

**ข้อเสนอ ข (เสริม, advisory): ESLint `no-restricted-syntax`** ใน `eslint.config.js` (flat config, มี block `files: ['**/*.{ts,tsx}']` อยู่แล้ว) สองตัวเลือก selector:
```
BinaryExpression[operator=/^[!=]==?$/] > Literal[value=/^(Sent to QC Lab|Ready to Sell|Waiting for Handover|Payment Completed|PAID|Active Leads|Returned|In-Transit|Assigned|Accepted|Arrived|Heading to Customer)$/]
SwitchCase > Literal[value=/^(...ชุดเดียวกัน...)$/]
```
จับได้เฉพาะสะกดเก่าใน `===`/`case` (ลิสต์ `.includes([...])` ต้องใช้ selector ซับซ้อนกว่านั้น) จึงเป็นตัวเตือนตอนเขียนใน editor ไม่ใช่ด่าน — ด่านคือข้อ ก. ใช้เมื่อ lint ถูกทำให้ blocking แล้วเท่านั้น (CI บอกว่าจะ block เมื่อ error ถึง 0 ซึ่งวันนี้อยู่ที่ 1106)

**ข้อเสนอ ค (ทางเลือกระยะยาว ไม่ใช่ของ sweep):** ให้ `useDatabase('jobs')` แนบ `status_canonical = normalizeStatus(status, receive_method) ?? status` ให้ทุกแถวตั้งแต่ตอน map (ที่เดียวกับที่มัน normalize `qc_logs` อยู่แล้ว) แล้ว reader เทียบฟิลด์นั้น — ปิดกับดักทั้งตระกูลที่ต้นทางเดียว แต่แตะทุก reader และซ่อนความจริงว่า DB มีสองสะกด (ต้องเคาะแยก ไม่ใส่ใน sweep)

---

## 4. สิ่งที่ sweep PR ควรเป็น

- **ใบเดียว commit ต่อไฟล์** (แบบ #709) ครอบ P1 ทั้ง 20 จุด + `statusColors.ts` (P3) + ด่านข้อ ก พร้อมเพดานที่วัดจริงหลังแก้
- ทุกจุดใช้ helper ที่มีแล้ว ห้ามเพิ่ม literal สะกดใหม่แทนสะกดเก่า
- injection ต่อ helper ไม่ต่อหน้า: helper แต่ละตัวมีเทสที่ป้อนทั้งสองสะกดอยู่แล้ว (`qcStation.test.ts`, `inventoryStatus.test.ts`, `jobTransitions.test.ts`) — จุดใหม่ที่ใช้ helper เดิมไม่ต้องมีเทสของตัวเอง; จุดที่ต้องมี helper ใหม่ (`Returned`/`Return Confirmed`, `Payment Completed`/`Paid` ฝั่ง B2B) เขียนเทสรูปเดียวกัน
- P2 ไม่เข้า sweep — ตั้งเพดานแล้วปล่อยลดตามการแตะไฟล์

## ภาคผนวก A — ทุกจุดที่เทียบสถานะกับ string literal ใน `src/` (ยกเว้น `types/job-statuses.ts`, `types/domain.ts`, ไฟล์เทส)

375 จุด ใน 37 ไฟล์ (สร้างจากสคริปต์ — ชนิด "รูปการเทียบ" เป็น heuristic จากบรรทัดนั้น ดูหมายเหตุท้ายตาราง). คอลัมน์ **engine เขียน canonical** = literal (หรือคู่ canonical ของ legacy) อยู่ในเซ็ต `to` ของ `TRANSITIONS` ใน `functions/status-engine.js`. คอลัมน์ **คู่ canonical ใกล้ๆ** = สำหรับ legacy: มีคู่ canonical อยู่ในบรรทัดเดียวกันหรือ ±3 บรรทัด (site ที่รับทั้งสองสะกดอยู่แล้ว)


### `src/components/Fleet/AdminChatBox.tsx` (8)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 137 | `Pending QC` | canonical | list |  | Y | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `In Stock` | canonical | list |  | Y | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `Paid` | canonical | list |  | Y | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `PAID` | legacy | list | มี | Y → Paid | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `Completed` | canonical | list |  | Y | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `Returned` | legacy | list | **ไม่มี** | Y → Return Confirmed | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `Closed (Lost)` | canonical | list |  | Y | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |
| 137 | `Cancelled` | canonical | list |  | Y | `{['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Can` |

### `src/components/layout/AdminLayout.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 47 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2B = ticket.status === 'New B2B Lead';` |

### `src/components/layout/NotificationCenter.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 56 | `Pending QC` | canonical | list |  | Y | `['Pending QC', 'Awaiting Pickup'].includes(j.status) &&` |
| 57 | `B2B-Unpacked` | canonical | === |  | N (creator/other writer, same spelling) | `j.type !== 'Withdrawal' && j.type !== 'B2B-Unpacked'` |
| 73 | `In Stock` | canonical | list |  | Y | `['In Stock', 'Ready to Sell'].includes(j.status) &&` |
| 73 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `['In Stock', 'Ready to Sell'].includes(j.status) &&` |

### `src/features/trade-in/TradeInDashboard.tsx` (23)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 55 | `B2B-Unpacked` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2BChild = j.type === 'B2B-Unpacked';` |
| 113 | `New B2B Lead` | canonical | list |  | N (creator/other writer, same spelling) | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Following Up` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Pre-Quote Sent` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Pre-Quote Accepted` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Site Visit & Grading` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Final Quote Sent` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Final Quote Accepted` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 113 | `Negotiation` | canonical | list |  | Y | `const isB2BSales = ['New B2B Lead', 'Following Up', 'Pre-Quote Sent', 'Pre-Quote Accepted'` |
| 114 | `PO Issued` | canonical | list |  | Y | `const isB2BLogistics = ['PO Issued', 'Waiting for Invoice/Tax Inv.', 'Pending Finance Appr` |
| 114 | `Waiting for Invoice/Tax Inv.` | canonical | list |  | Y | `const isB2BLogistics = ['PO Issued', 'Waiting for Invoice/Tax Inv.', 'Pending Finance Appr` |
| 114 | `Pending Finance Approval` | canonical | list |  | Y | `const isB2BLogistics = ['PO Issued', 'Waiting for Invoice/Tax Inv.', 'Pending Finance Appr` |
| 114 | `Payment Completed` | legacy | list | **ไม่มี** | Y → Paid | `const isB2BLogistics = ['PO Issued', 'Waiting for Invoice/Tax Inv.', 'Pending Finance Appr` |
| 115 | `In Stock` | canonical | list |  | Y | `const isB2BClosed = ['In Stock', 'Completed', 'Cancelled', 'Closed (Lost)'].includes(j.sta` |
| 115 | `Completed` | canonical | list |  | Y | `const isB2BClosed = ['In Stock', 'Completed', 'Cancelled', 'Closed (Lost)'].includes(j.sta` |
| 115 | `Cancelled` | canonical | list |  | Y | `const isB2BClosed = ['In Stock', 'Completed', 'Cancelled', 'Closed (Lost)'].includes(j.sta` |
| 115 | `Closed (Lost)` | canonical | list |  | Y | `const isB2BClosed = ['In Stock', 'Completed', 'Cancelled', 'Closed (Lost)'].includes(j.sta` |
| 232 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if ((job.status === 'New Lead' \|\| job.status === 'New B2B Lead') && !job.is_read) {` |
| 232 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if ((job.status === 'New Lead' \|\| job.status === 'New B2B Lead') && !job.is_read) {` |
| 245 | `New B2B Lead` | canonical | case |  | N (creator/other writer, same spelling) | `case 'New B2B Lead': return <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded` |
| 246 | `PO Issued` | canonical | case |  | Y | `case 'PO Issued': return <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-` |
| 247 | `Payment Completed` | legacy | case | **ไม่มี** | Y → Paid | `case 'Payment Completed': return <span className="bg-blue-100 text-blue-700 px-3 py-1 roun` |
| 248 | `In Stock` | canonical | case |  | Y | `case 'In Stock': return <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded` |

### `src/features/trade-in/components/b2b/B2BAuditorTool.tsx` (8)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 91 | `Pending Finance Approval` | canonical | list |  | Y | `const lockedStatuses = ['Pending Finance Approval', 'Payment Completed', 'In Stock', 'Comp` |
| 91 | `Payment Completed` | legacy | list | **ไม่มี** | Y → Paid | `const lockedStatuses = ['Pending Finance Approval', 'Payment Completed', 'In Stock', 'Comp` |
| 91 | `In Stock` | canonical | list |  | Y | `const lockedStatuses = ['Pending Finance Approval', 'Payment Completed', 'In Stock', 'Comp` |
| 91 | `Completed` | canonical | list |  | Y | `const lockedStatuses = ['Pending Finance Approval', 'Payment Completed', 'In Stock', 'Comp` |
| 91 | `Cancelled` | canonical | list |  | Y | `const lockedStatuses = ['Pending Finance Approval', 'Payment Completed', 'In Stock', 'Comp` |
| 91 | `Closed (Lost)` | canonical | list |  | Y | `const lockedStatuses = ['Pending Finance Approval', 'Payment Completed', 'In Stock', 'Comp` |
| 153 | `Site Visit & Grading` | canonical | list |  | Y | `!!currentJob && ['Site Visit & Grading', 'Auditor Assigned'].includes(currentJob.status);` |
| 153 | `Auditor Assigned` | canonical | list |  | N (creator/other writer, same spelling) | `!!currentJob && ['Site Visit & Grading', 'Auditor Assigned'].includes(currentJob.status);` |

### `src/features/trade-in/components/b2b/B2BManager.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 512 | `Cancelled` | canonical | === |  | Y | `<p className={text-[10px] font-black uppercase ${log.action === 'Cancelled' ? 'text-red-5` |

### `src/features/trade-in/components/b2c/B2CWorkspace.tsx` (5)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 51 | `Paid` | canonical | list |  | Y | `['Paid', 'PAID', 'Payment Completed'].includes(log.action)` |
| 51 | `PAID` | legacy | list | มี | Y → Paid | `['Paid', 'PAID', 'Payment Completed'].includes(log.action)` |
| 51 | `Payment Completed` | legacy | list | มี | Y → Paid | `['Paid', 'PAID', 'Payment Completed'].includes(log.action)` |
| 551 | `Payout Processing` | canonical | list |  | Y | `onClick={() => onUpdateStatus(job.id, 'Payout Processing', 'แอดมินตรวจสอบรายละเอียดและอนุม` |
| 608 | `Sent to QC Lab` | legacy | list | **ไม่มี** | Y → Sent To QC Lab | `<button onClick={() => onUpdateStatus(job.id, 'Sent to QC Lab', 'แอดมินส่งเครื่องเข้าห้องแ` |

### `src/features/trade-in/components/modal/TradeInUI.tsx` (49)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 37 | `Cancelled` | canonical | list |  | Y | `'Cancelled', 'Closed (Lost)', 'Returned', 'Return Confirmed',` |
| 37 | `Closed (Lost)` | canonical | list |  | Y | `'Cancelled', 'Closed (Lost)', 'Returned', 'Return Confirmed',` |
| 37 | `Returned` | legacy | list | มี | Y → Return Confirmed | `'Cancelled', 'Closed (Lost)', 'Returned', 'Return Confirmed',` |
| 37 | `Return Confirmed` | canonical | list |  | Y | `'Cancelled', 'Closed (Lost)', 'Returned', 'Return Confirmed',` |
| 38 | `Drop-off Expired` | canonical | list |  | Y | `'Drop-off Expired', 'Shipping Expired', 'Parcel Lost',` |
| 38 | `Shipping Expired` | canonical | list |  | Y | `'Drop-off Expired', 'Shipping Expired', 'Parcel Lost',` |
| 38 | `Parcel Lost` | canonical | list |  | Y | `'Drop-off Expired', 'Shipping Expired', 'Parcel Lost',` |
| 42 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `'New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 42 | `Following Up` | canonical | list |  | Y | `'New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 42 | `Appointment Set` | canonical | list |  | Y | `'New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 42 | `Waiting Drop-off` | canonical | list |  | Y | `'New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 43 | `Awaiting Shipping` | canonical | list |  | Y | `'Awaiting Shipping',` |
| 47 | `Active Leads` | legacy | list | มี | Y → Active Lead | `'Active Leads', 'Assigned', 'Accepted', 'Heading to Customer', 'Arrived', 'In-Transit',` |
| 47 | `Assigned` | legacy | list | มี | Y → Rider Assigned | `'Active Leads', 'Assigned', 'Accepted', 'Heading to Customer', 'Arrived', 'In-Transit',` |
| 47 | `Accepted` | legacy | list | มี | Y → Rider Accepted | `'Active Leads', 'Assigned', 'Accepted', 'Heading to Customer', 'Arrived', 'In-Transit',` |
| 47 | `Heading to Customer` | legacy | list | มี | Y → Rider En Route | `'Active Leads', 'Assigned', 'Accepted', 'Heading to Customer', 'Arrived', 'In-Transit',` |
| 47 | `Arrived` | legacy | list | มี | Y → Rider Arrived | `'Active Leads', 'Assigned', 'Accepted', 'Heading to Customer', 'Arrived', 'In-Transit',` |
| 47 | `In-Transit` | legacy | list | มี | Y → Rider Returning / Parcel In Transit | `'Active Leads', 'Assigned', 'Accepted', 'Heading to Customer', 'Arrived', 'In-Transit',` |
| 49 | `Active Lead` | canonical | list |  | Y | `'Active Lead', 'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 49 | `Rider Assigned` | canonical | list |  | Y | `'Active Lead', 'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 49 | `Rider Accepted` | canonical | list |  | Y | `'Active Lead', 'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 49 | `Rider En Route` | canonical | list |  | Y | `'Active Lead', 'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 49 | `Rider Arrived` | canonical | list |  | Y | `'Active Lead', 'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 50 | `Rider Returning` | canonical | list |  | Y | `'Rider Returning', 'Parcel In Transit',` |
| 50 | `Parcel In Transit` | canonical | list |  | Y | `'Rider Returning', 'Parcel In Transit',` |
| 52 | `Drop-off Received` | canonical | list |  | Y | `'Drop-off Received', 'Parcel Received',` |
| 52 | `Parcel Received` | canonical | list |  | Y | `'Drop-off Received', 'Parcel Received',` |
| 55 | `Being Inspected` | canonical | list |  | Y | `'Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation',` |
| 55 | `QC Review` | canonical | list |  | Y | `'Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation',` |
| 55 | `Revised Offer` | canonical | list |  | N (creator/other writer, same spelling) | `'Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation',` |
| 55 | `Negotiation` | canonical | list |  | Y | `'Being Inspected', 'QC Review', 'Revised Offer', 'Negotiation',` |
| 56 | `Price Accepted` | canonical | list |  | Y | `'Price Accepted', 'Discrepancy Reported',` |
| 56 | `Discrepancy Reported` | canonical | list |  | N (creator/other writer, same spelling) | `'Price Accepted', 'Discrepancy Reported',` |
| 59 | `Payout Processing` | canonical | list |  | Y | `'Payout Processing', 'Waiting for Handover', 'Waiting For Handover',` |
| 59 | `Waiting for Handover` | legacy | list | มี | Y → Waiting For Handover | `'Payout Processing', 'Waiting for Handover', 'Waiting For Handover',` |
| 59 | `Waiting For Handover` | canonical | list |  | Y | `'Payout Processing', 'Waiting for Handover', 'Waiting For Handover',` |
| 60 | `PAID` | legacy | list | มี | Y → Paid | `'PAID', 'Paid', 'Pending QC', 'Sent to QC Lab', 'In Stock', 'Ready to Sell',` |
| 60 | `Paid` | canonical | list |  | Y | `'PAID', 'Paid', 'Pending QC', 'Sent to QC Lab', 'In Stock', 'Ready to Sell',` |
| 60 | `Pending QC` | canonical | list |  | Y | `'PAID', 'Paid', 'Pending QC', 'Sent to QC Lab', 'In Stock', 'Ready to Sell',` |
| 60 | `Sent to QC Lab` | legacy | list | **ไม่มี** | Y → Sent To QC Lab | `'PAID', 'Paid', 'Pending QC', 'Sent to QC Lab', 'In Stock', 'Ready to Sell',` |
| 60 | `In Stock` | canonical | list |  | Y | `'PAID', 'Paid', 'Pending QC', 'Sent to QC Lab', 'In Stock', 'Ready to Sell',` |
| 60 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `'PAID', 'Paid', 'Pending QC', 'Sent to QC Lab', 'In Stock', 'Ready to Sell',` |
| 61 | `Sold` | canonical | list |  | Y | `'Sold', 'Completed',` |
| 61 | `Completed` | canonical | list |  | Y | `'Sold', 'Completed',` |
| 73 | `In Stock` | canonical | list |  | Y | `{ id: 4, name: 'Finance & QC', active: inList(phase4_Finance), done: inList(['In Stock', '` |
| 73 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `{ id: 4, name: 'Finance & QC', active: inList(phase4_Finance), done: inList(['In Stock', '` |
| 78 | `Returned` | legacy | === | **ไม่มี** | Y → Return Confirmed | `<div className={p-4 rounded-2xl text-center font-black text-xs uppercase tracking-widest ` |
| 79 | `Returned` | legacy | === | **ไม่มี** | Y → Return Confirmed | `{status === 'Returned' ? '📦 Item Returned (ส่งเครื่องคืนลูกค้าแล้ว)' : '🚫 Ticket Closed / ` |
| 134 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `{job.status === 'New Lead' && !job.is_read && <span className="bg-red-500 text-white px-1.` |

### `src/hooks/useNewTicketAlert.ts` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 66 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2B = ticket.status === 'New B2B Lead';` |
| 109 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (job && (job.status === 'New Lead' \|\| job.status === 'New B2B Lead')) {` |
| 109 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (job && (job.status === 'New Lead' \|\| job.status === 'New B2B Lead')) {` |

### `src/pages/admin/B2BDispatchQueue.tsx` (13)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 41 | `New B2B Lead` | canonical | list |  | N (creator/other writer, same spelling) | `.filter(j => j.type === 'B2B Trade-in' && ['New B2B Lead', 'Following Up', 'Pre-Quote Sent` |
| 41 | `Following Up` | canonical | list |  | Y | `.filter(j => j.type === 'B2B Trade-in' && ['New B2B Lead', 'Following Up', 'Pre-Quote Sent` |
| 41 | `Pre-Quote Sent` | canonical | list |  | Y | `.filter(j => j.type === 'B2B Trade-in' && ['New B2B Lead', 'Following Up', 'Pre-Quote Sent` |
| 41 | `Pre-Quote Accepted` | canonical | list |  | Y | `.filter(j => j.type === 'B2B Trade-in' && ['New B2B Lead', 'Following Up', 'Pre-Quote Sent` |
| 49 | `Site Visit & Grading` | canonical | list |  | Y | `.filter(j => j.type === 'B2B Trade-in' && ['Site Visit & Grading', 'Auditor Assigned'].inc` |
| 49 | `Auditor Assigned` | canonical | list |  | N (creator/other writer, same spelling) | `.filter(j => j.type === 'B2B Trade-in' && ['Site Visit & Grading', 'Auditor Assigned'].inc` |
| 254 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `<span className={text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest` |
| 255 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `{job.status === 'New B2B Lead' ? 'NEW' : job.status === 'Pre-Quote Sent' ? 'QUOTED' : job.` |
| 255 | `Pre-Quote Sent` | canonical | === |  | Y | `{job.status === 'New B2B Lead' ? 'NEW' : job.status === 'Pre-Quote Sent' ? 'QUOTED' : job.` |
| 255 | `Pre-Quote Accepted` | canonical | === |  | Y | `{job.status === 'New B2B Lead' ? 'NEW' : job.status === 'Pre-Quote Sent' ? 'QUOTED' : job.` |
| 428 | `Pre-Quote Sent` | canonical | === |  | Y | `disabled={expectedItems.length === 0 \|\| !quoteExpiryDate \|\| currentJob?.status === 'Pre-Qu` |
| 430 | `Pre-Quote Sent` | canonical | === |  | Y | `expectedItems.length > 0 && quoteExpiryDate && currentJob?.status !== 'Pre-Quote Sent'` |
| 435 | `Pre-Quote Sent` | canonical | === |  | Y | `<FileText size={16} /> {currentJob?.status === 'Pre-Quote Sent' ? 'Pre-Quote ส่งแล้ว' : 'ส` |

### `src/pages/admin/B2CWorkspacePage.tsx` (6)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 167 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (job.status === 'New Lead') await update(ref(db, jobs/${job.id}), { status: 'Followin` |
| 351 | `Revised Offer` | canonical | list |  | N (creator/other writer, same spelling) | `qc_logs: [makeLog('Revised Offer', เสนอราคาเครื่องใหม่: ${p} บ. (ยอดสุทธิ: ${net} บ.) เหต` |
| 378 | `Cancelled` | canonical | list |  | Y | `qc_logs: [makeLog('Cancelled', ยกเลิกออเดอร์ เหตุผล: ${fullReason}), ...(job.qc_logs \|\| ` |
| 420 | `Closed (Lost)` | canonical | list |  | Y | `qc_logs: [makeLog('Closed (Lost)', 'ปิดงานถาวร (ไม่เปิดให้กลับมาขายใหม่)'), ...(job.qc_log` |
| 431 | `Pending QC` | canonical | list |  | Y | `qc_logs: [makeLog('Pending QC', 'แก้ย้อนหลัง: งานถูกข้ามขั้นส่งมอบ ทำให้ค่าวิ่งไม่ถูกคำนวณ` |
| 448 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const nextStatus = job.status === 'New Lead' ? 'Following Up' : job.status;` |

### `src/pages/admin/components/KYCInfoCard.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 228 | `Rider Arrived` | canonical | list |  | Y | `const expectedSoon = isPickup && ['Rider Arrived', 'Arrived', 'Being Inspected', 'QC Revie` |
| 228 | `Arrived` | legacy | list | มี | Y → Rider Arrived | `const expectedSoon = isPickup && ['Rider Arrived', 'Arrived', 'Being Inspected', 'QC Revie` |
| 228 | `Being Inspected` | canonical | list |  | Y | `const expectedSoon = isPickup && ['Rider Arrived', 'Arrived', 'Being Inspected', 'QC Revie` |
| 228 | `QC Review` | canonical | list |  | Y | `const expectedSoon = isPickup && ['Rider Arrived', 'Arrived', 'Being Inspected', 'QC Revie` |

### `src/pages/admin/components/PinDisputeCard.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 59 | `Paid` | canonical | === |  | Y | `const settled = job?.rider_fee_status === 'Paid';` |

### `src/pages/admin/components/PricingSidebar.tsx` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 330 | `Appointment Set` | canonical | list |  | Y | `action: hadSchedule ? 'Appointment Rescheduled' : 'Appointment Set',` |
| 685 | `Parcel Received` | canonical | list |  | Y | `{ action: 'Parcel Received', by: currentUserName, timestamp: Date.now(), details: 'รับพัสด` |
| 1182 | `Cancelled` | canonical | === |  | Y | `<p className={text-[10px] font-black uppercase mb-1 ${log.action === 'Cancelled' ? 'text-` |

### `src/pages/analytics/Analytics.tsx` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 132 | `In Stock` | canonical | list |  | Y | `const currentStock = jobsList.filter(j => ['In Stock', 'Ready to Sell'].includes(j.status)` |
| 132 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `const currentStock = jobsList.filter(j => ['In Stock', 'Ready to Sell'].includes(j.status)` |

### `src/pages/appointments/AppointmentCalendar.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 547 | `Cancelled` | canonical | list |  | Y | `cancelled: monthJobs.filter(e => ['Cancelled', 'Closed (Lost)'].includes(e.jobStatus \|\| ''` |
| 547 | `Closed (Lost)` | canonical | list |  | Y | `cancelled: monthJobs.filter(e => ['Cancelled', 'Closed (Lost)'].includes(e.jobStatus \|\| ''` |
| 646 | `Cancelled` | canonical | list |  | Y | `.filter(e => e.date >= todayStr && !['Cancelled', 'Closed (Lost)'].includes(e.jobStatus \|\|` |
| 646 | `Closed (Lost)` | canonical | list |  | Y | `.filter(e => e.date >= todayStr && !['Cancelled', 'Closed (Lost)'].includes(e.jobStatus \|\|` |

### `src/pages/dashboard/CEODashboard.tsx` (16)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 45 | `B2B-Unpacked` | canonical | === |  | N (creator/other writer, same spelling) | `if (j.type === 'Withdrawal' \|\| j.type === 'B2B-Unpacked' \|\| j.type === 'Accessory') return` |
| 49 | `Payment Completed` | legacy | list | มี | Y → Paid | `['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing']` |
| 49 | `In Stock` | canonical | list |  | Y | `['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing']` |
| 49 | `Paid` | canonical | list |  | Y | `['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing']` |
| 49 | `Payout Processing` | canonical | list |  | Y | `['Payment Completed', 'In Stock', 'Paid', 'Deal Closed (Negotiated)', 'Payout Processing']` |
| 76 | `In Stock` | canonical | list |  | Y | `['In Stock', 'Ready to Sell'].includes(j.status) &&` |
| 76 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `['In Stock', 'Ready to Sell'].includes(j.status) &&` |
| 87 | `B2B-Unpacked` | canonical | === |  | N (creator/other writer, same spelling) | `if (j.type === 'Withdrawal' \|\| j.type === 'B2B-Unpacked' \|\| j.type === 'Accessory') return` |
| 88 | `Payment Completed` | legacy | list | มี | Y → Paid | `return j.qc_logs?.some((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed ` |
| 88 | `In Stock` | canonical | list |  | Y | `return j.qc_logs?.some((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed ` |
| 88 | `Paid` | canonical | list |  | Y | `return j.qc_logs?.some((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed ` |
| 88 | `Payout Processing` | canonical | list |  | Y | `return j.qc_logs?.some((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'Deal Closed ` |
| 91 | `Payment Completed` | legacy | list | มี | Y → Paid | `const closedLog = j.qc_logs?.find((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'D` |
| 91 | `In Stock` | canonical | list |  | Y | `const closedLog = j.qc_logs?.find((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'D` |
| 91 | `Paid` | canonical | list |  | Y | `const closedLog = j.qc_logs?.find((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'D` |
| 91 | `Payout Processing` | canonical | list |  | Y | `const closedLog = j.qc_logs?.find((l: any) => ['Payment Completed', 'In Stock', 'Paid', 'D` |

### `src/pages/dealers/LotManager.tsx` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 171 | `In Stock` | canonical | list |  | Y | `['In Stock', 'Ready to Sell'].includes(j.status) &&` |
| 171 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `['In Stock', 'Ready to Sell'].includes(j.status) &&` |

### `src/pages/finance/Finance.tsx` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 25 | `Waiting for Handover` | legacy | === | **ไม่มี** | Y → Waiting For Handover | `const isPaid = j.paid_at && (j.status === 'Waiting for Handover' \|\| j.status === 'Sent to ` |
| 25 | `Sent to QC Lab` | legacy | === | **ไม่มี** | Y → Sent To QC Lab | `const isPaid = j.paid_at && (j.status === 'Waiting for Handover' \|\| j.status === 'Sent to ` |
| 25 | `Completed` | canonical | === |  | Y | `const isPaid = j.paid_at && (j.status === 'Waiting for Handover' \|\| j.status === 'Sent to ` |

### `src/pages/finance/components/RiderSettlements.tsx` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 32 | `Pending QC` | canonical | === |  | Y | `(j.status === 'Pending QC' \|\| j.status === 'Completed' \|\| j.status === 'Waiting for Handov` |
| 32 | `Completed` | canonical | === |  | Y | `(j.status === 'Pending QC' \|\| j.status === 'Completed' \|\| j.status === 'Waiting for Handov` |
| 32 | `Waiting for Handover` | legacy | === | **ไม่มี** | Y → Waiting For Handover | `(j.status === 'Pending QC' \|\| j.status === 'Completed' \|\| j.status === 'Waiting for Handov` |

### `src/pages/finance/components/TransactionRepair.tsx` (3)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 43 | `Waiting for Handover` | legacy | === | **ไม่มี** | Y → Waiting For Handover | `const isPaid = j.paid_at && (j.status === 'Waiting for Handover' \|\| j.status === 'Sent to ` |
| 43 | `Sent to QC Lab` | legacy | === | **ไม่มี** | Y → Sent To QC Lab | `const isPaid = j.paid_at && (j.status === 'Waiting for Handover' \|\| j.status === 'Sent to ` |
| 43 | `Completed` | canonical | === |  | Y | `const isPaid = j.paid_at && (j.status === 'Waiting for Handover' \|\| j.status === 'Sent to ` |

### `src/pages/fleet/DispatcherPage.tsx` (17)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 23 | `Assigned` | legacy | list | **ไม่มี** | Y → Rider Assigned | `'Assigned', 'Accepted', 'Arrived', 'Being Inspected',` |
| 23 | `Accepted` | legacy | list | **ไม่มี** | Y → Rider Accepted | `'Assigned', 'Accepted', 'Arrived', 'Being Inspected',` |
| 23 | `Arrived` | legacy | list | **ไม่มี** | Y → Rider Arrived | `'Assigned', 'Accepted', 'Arrived', 'Being Inspected',` |
| 23 | `Being Inspected` | canonical | list |  | Y | `'Assigned', 'Accepted', 'Arrived', 'Being Inspected',` |
| 24 | `Price Accepted` | canonical | list |  | Y | `'Price Accepted', 'Revised Offer', 'Payout Processing',` |
| 24 | `Revised Offer` | canonical | list |  | N (creator/other writer, same spelling) | `'Price Accepted', 'Revised Offer', 'Payout Processing',` |
| 24 | `Payout Processing` | canonical | list |  | Y | `'Price Accepted', 'Revised Offer', 'Payout Processing',` |
| 25 | `Waiting for Handover` | legacy | list | **ไม่มี** | Y → Waiting For Handover | `'Waiting for Handover', 'In-Transit',` |
| 25 | `In-Transit` | legacy | list | **ไม่มี** | Y → Rider Returning / Parcel In Transit | `'Waiting for Handover', 'In-Transit',` |
| 29 | `Rider Assigned` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider Arrived', 'Rider En Route', 'Rider Returning',` |
| 29 | `Rider Accepted` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider Arrived', 'Rider En Route', 'Rider Returning',` |
| 29 | `Rider Arrived` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider Arrived', 'Rider En Route', 'Rider Returning',` |
| 29 | `Rider En Route` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider Arrived', 'Rider En Route', 'Rider Returning',` |
| 29 | `Rider Returning` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider Arrived', 'Rider En Route', 'Rider Returning',` |
| 77 | `Active Leads` | legacy | === | มี | Y → Active Lead | `(j.status === 'Active Leads' \|\| j.status === JOB_STATUS.ACTIVE_LEAD \|\|` |
| 78 | `Assigned` | legacy | === | **ไม่มี** | Y → Rider Assigned | `((j.status === 'Assigned' \|\| j.status === JOB_STATUS.RIDER_ASSIGNED) && !j.rider_id)) &&` |
| 259 | `Assigned` | legacy | === | **ไม่มี** | Y → Rider Assigned | `{task.status === 'Assigned' && (` |

### `src/pages/fleet/RiderPerformance.tsx` (28)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 83 | `Rider Assigned` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 83 | `Rider Accepted` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 83 | `Rider En Route` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 83 | `Rider Arrived` | canonical | list |  | Y | `'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',` |
| 84 | `Accepted` | legacy | list | มี | Y → Rider Accepted | `'Accepted', 'Heading to Customer', 'Arrived', // legacy` |
| 84 | `Heading to Customer` | legacy | list | มี | Y → Rider En Route | `'Accepted', 'Heading to Customer', 'Arrived', // legacy` |
| 84 | `Arrived` | legacy | list | มี | Y → Rider Arrived | `'Accepted', 'Heading to Customer', 'Arrived', // legacy` |
| 85 | `Being Inspected` | canonical | list |  | Y | `'Being Inspected', 'QC Review', 'Negotiation', 'Revised Offer',` |
| 85 | `QC Review` | canonical | list |  | Y | `'Being Inspected', 'QC Review', 'Negotiation', 'Revised Offer',` |
| 85 | `Negotiation` | canonical | list |  | Y | `'Being Inspected', 'QC Review', 'Negotiation', 'Revised Offer',` |
| 85 | `Revised Offer` | canonical | list |  | N (creator/other writer, same spelling) | `'Being Inspected', 'QC Review', 'Negotiation', 'Revised Offer',` |
| 86 | `Price Accepted` | canonical | list |  | Y | `'Price Accepted', 'Payout Processing',` |
| 86 | `Payout Processing` | canonical | list |  | Y | `'Price Accepted', 'Payout Processing',` |
| 87 | `Waiting For Handover` | canonical | list |  | Y | `'Waiting For Handover', 'Waiting for Handover',` |
| 87 | `Waiting for Handover` | legacy | list | มี | Y → Waiting For Handover | `'Waiting For Handover', 'Waiting for Handover',` |
| 88 | `Rider Returning` | canonical | list |  | Y | `'Rider Returning', 'In-Transit', // legacy returning` |
| 88 | `In-Transit` | legacy | list | มี | Y → Rider Returning / Parcel In Transit | `'Rider Returning', 'In-Transit', // legacy returning` |
| 89 | `Pending QC` | canonical | list |  | Y | `'Pending QC',` |
| 93 | `Paid` | canonical | list |  | Y | `'Paid', 'Payment Completed',` |
| 93 | `Payment Completed` | legacy | list | มี | Y → Paid | `'Paid', 'Payment Completed',` |
| 94 | `Sent To QC Lab` | canonical | list |  | Y | `'Sent To QC Lab', 'Sent to QC Lab',` |
| 94 | `Sent to QC Lab` | legacy | list | มี | Y → Sent To QC Lab | `'Sent To QC Lab', 'Sent to QC Lab',` |
| 95 | `Ready To Sell` | canonical | list |  | Y | `'Ready To Sell', 'Ready to Sell',` |
| 95 | `Ready to Sell` | legacy | list | มี | Y → Ready To Sell | `'Ready To Sell', 'Ready to Sell',` |
| 96 | `Sold` | canonical | list |  | Y | `'Sold', 'In Stock', 'Completed',` |
| 96 | `In Stock` | canonical | list |  | Y | `'Sold', 'In Stock', 'Completed',` |
| 96 | `Completed` | canonical | list |  | Y | `'Sold', 'In Stock', 'Completed',` |
| 105 | `Cancelled` | canonical | === |  | Y | `job.status === 'Cancelled' && (` |

### `src/pages/fleet/RiderPerformanceDetail.tsx` (10)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 83 | `Cancelled` | canonical | === |  | Y | `if (job.status === 'Cancelled' && (` |
| 91 | `Paid` | canonical | list |  | Y | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Payment Completed` | legacy | list | มี | Y → Paid | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Sent To QC Lab` | canonical | list |  | Y | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Sent to QC Lab` | legacy | list | มี | Y → Sent To QC Lab | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Ready To Sell` | canonical | list |  | Y | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Ready to Sell` | legacy | list | มี | Y → Ready To Sell | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Sold` | canonical | list |  | Y | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `In Stock` | canonical | list |  | Y | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |
| 91 | `Completed` | canonical | list |  | Y | `if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Sent to QC Lab', 'Ready To Sell', 'Re` |

### `src/pages/inventory/StockAudit.tsx` (2)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 33 | `In Stock` | canonical | list |  | Y | `const currentStock = allJobs.filter(j => ['In Stock', 'Ready to Sell'].includes(j.status))` |
| 33 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `const currentStock = allJobs.filter(j => ['In Stock', 'Ready to Sell'].includes(j.status))` |

### `src/pages/inventory/Traceability.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 167 | `Sold` | canonical | === |  | Y | `<span className={px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${searchRes` |

### `src/pages/lab/QCStation.tsx` (5)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 229 | `QC Review` | canonical | === |  | Y | `if (nextStatus === 'QC Review') {` |
| 285 | `Pending QC` | canonical | === |  | Y | `<span className={text-[10px] font-black uppercase px-2 py-1 rounded ${job.status === 'Pen` |
| 532 | `Payout Processing` | canonical | list |  | Y | `const isPaid = selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID` |
| 532 | `Paid` | canonical | list |  | Y | `const isPaid = selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID` |
| 532 | `PAID` | legacy | list | มี | Y → Paid | `const isPaid = selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID` |

### `src/pages/mobile/MobileLayout.tsx` (15)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 42 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (j.status === 'New Lead' \|\| j.status === 'New B2B Lead' \|\| j.status === 'Active Leads' ` |
| 42 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (j.status === 'New Lead' \|\| j.status === 'New B2B Lead' \|\| j.status === 'Active Leads' ` |
| 42 | `Active Leads` | legacy | === | มี | Y → Active Lead | `if (j.status === 'New Lead' \|\| j.status === 'New B2B Lead' \|\| j.status === 'Active Leads' ` |
| 42 | `Active Lead` | canonical | === |  | Y | `if (j.status === 'New Lead' \|\| j.status === 'New B2B Lead' \|\| j.status === 'Active Leads' ` |
| 55 | `Pending QC` | canonical | list |  | Y | `const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];` |
| 55 | `Being Inspected` | canonical | list |  | Y | `const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];` |
| 55 | `Payout Processing` | canonical | list |  | Y | `const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];` |
| 61 | `In Stock` | canonical | list |  | Y | `if (['In Stock', 'Ready to Sell'].includes(j.status)) {` |
| 61 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `if (['In Stock', 'Ready to Sell'].includes(j.status)) {` |
| 66 | `Cancelled` | canonical | list |  | Y | `const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised O` |
| 66 | `Closed (Lost)` | canonical | list |  | Y | `const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised O` |
| 66 | `Returned` | legacy | list | **ไม่มี** | Y → Return Confirmed | `const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised O` |
| 66 | `Negotiation` | canonical | list |  | Y | `const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised O` |
| 66 | `Revised Offer` | canonical | list |  | N (creator/other writer, same spelling) | `const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised O` |
| 66 | `Price Accepted` | canonical | list |  | Y | `const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised O` |

### `src/pages/mobile/MobileNotificationsPage.tsx` (10)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 39 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (job.status === 'New Lead' \|\| job.status === 'New B2B Lead' \|\| job.status === 'Active L` |
| 39 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `if (job.status === 'New Lead' \|\| job.status === 'New B2B Lead' \|\| job.status === 'Active L` |
| 39 | `Active Leads` | legacy | === | มี | Y → Active Lead | `if (job.status === 'New Lead' \|\| job.status === 'New B2B Lead' \|\| job.status === 'Active L` |
| 39 | `Active Lead` | canonical | === |  | Y | `if (job.status === 'New Lead' \|\| job.status === 'New B2B Lead' \|\| job.status === 'Active L` |
| 40 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2B = job.status === 'New B2B Lead';` |
| 53 | `Pending QC` | canonical | list |  | Y | `const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];` |
| 53 | `Being Inspected` | canonical | list |  | Y | `const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];` |
| 53 | `Payout Processing` | canonical | list |  | Y | `const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];` |
| 70 | `In Stock` | canonical | list |  | Y | `if (['In Stock', 'Ready to Sell'].includes(job.status)) {` |
| 70 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `if (['In Stock', 'Ready to Sell'].includes(job.status)) {` |

### `src/pages/mobile/MobileQCStation.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 157 | `QC Review` | canonical | === |  | Y | `if (nextStatus === 'QC Review') {` |
| 394 | `Payout Processing` | canonical | list |  | Y | `selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID', 'Deal Closed` |
| 394 | `Paid` | canonical | list |  | Y | `selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID', 'Deal Closed` |
| 394 | `PAID` | legacy | list | มี | Y → Paid | `selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID', 'Deal Closed` |

### `src/pages/mobile/MobileTicketDetail.tsx` (106)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 104 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `{ label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Se` |
| 104 | `New B2B Lead` | canonical | list |  | N (creator/other writer, same spelling) | `{ label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Se` |
| 104 | `Following Up` | canonical | list |  | Y | `{ label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Se` |
| 104 | `Appointment Set` | canonical | list |  | Y | `{ label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Se` |
| 104 | `Waiting Drop-off` | canonical | list |  | Y | `{ label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Se` |
| 104 | `Awaiting Shipping` | canonical | list |  | Y | `{ label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Se` |
| 108 | `Active Leads` | legacy | list | มี | Y → Active Lead | `'Active Leads', 'Active Lead',` |
| 108 | `Active Lead` | canonical | list |  | Y | `'Active Leads', 'Active Lead',` |
| 110 | `Assigned` | legacy | list | **ไม่มี** | Y → Rider Assigned | `'Assigned', 'Accepted', 'Rider Accepted',` |
| 110 | `Accepted` | legacy | list | มี | Y → Rider Accepted | `'Assigned', 'Accepted', 'Rider Accepted',` |
| 110 | `Rider Accepted` | canonical | list |  | Y | `'Assigned', 'Accepted', 'Rider Accepted',` |
| 112 | `Heading to Customer` | legacy | list | มี | Y → Rider En Route | `'Heading to Customer', 'In-Transit', 'Rider En Route',` |
| 112 | `In-Transit` | legacy | list | **ไม่มี** | Y → Rider Returning / Parcel In Transit | `'Heading to Customer', 'In-Transit', 'Rider En Route',` |
| 112 | `Rider En Route` | canonical | list |  | Y | `'Heading to Customer', 'In-Transit', 'Rider En Route',` |
| 114 | `Arrived` | legacy | list | มี | Y → Rider Arrived | `'Arrived', 'Rider Arrived',` |
| 114 | `Rider Arrived` | canonical | list |  | Y | `'Arrived', 'Rider Arrived',` |
| 117 | `Parcel In Transit` | canonical | list |  | Y | `'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 117 | `Parcel Received` | canonical | list |  | Y | `'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 117 | `Drop-off Received` | canonical | list |  | Y | `'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 120 | `Being Inspected` | canonical | list |  | Y | `{ label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offe` |
| 120 | `Pending QC` | canonical | list |  | Y | `{ label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offe` |
| 120 | `QC Review` | canonical | list |  | Y | `{ label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offe` |
| 120 | `Revised Offer` | canonical | list |  | N (creator/other writer, same spelling) | `{ label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offe` |
| 120 | `Negotiation` | canonical | list |  | Y | `{ label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offe` |
| 121 | `Payout Processing` | canonical | list |  | Y | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `Waiting for Handover` | legacy | list | **ไม่มี** | Y → Waiting For Handover | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `Paid` | canonical | list |  | Y | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `PAID` | legacy | list | มี | Y → Paid | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `Sent to QC Lab` | legacy | list | **ไม่มี** | Y → Sent To QC Lab | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `In Stock` | canonical | list |  | Y | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `Ready to Sell` | legacy | list | **ไม่มี** | Y → Ready To Sell | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `Sold` | canonical | list |  | Y | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 121 | `Completed` | canonical | list |  | Y | `{ label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID` |
| 132 | `Following Up` | canonical | list |  | Y | `'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 132 | `Appointment Set` | canonical | list |  | Y | `'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 132 | `Waiting Drop-off` | canonical | list |  | Y | `'Following Up', 'Appointment Set', 'Waiting Drop-off',` |
| 133 | `Awaiting Shipping` | canonical | list |  | Y | `'Awaiting Shipping', 'Active Lead', 'Active Leads',` |
| 133 | `Active Lead` | canonical | list |  | Y | `'Awaiting Shipping', 'Active Lead', 'Active Leads',` |
| 133 | `Active Leads` | legacy | list | มี | Y → Active Lead | `'Awaiting Shipping', 'Active Lead', 'Active Leads',` |
| 134 | `In-Transit` | legacy | list | มี | Y → Rider Returning / Parcel In Transit | `'In-Transit', 'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 134 | `Parcel In Transit` | canonical | list |  | Y | `'In-Transit', 'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 134 | `Parcel Received` | canonical | list |  | Y | `'In-Transit', 'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 134 | `Drop-off Received` | canonical | list |  | Y | `'In-Transit', 'Parcel In Transit', 'Parcel Received', 'Drop-off Received',` |
| 135 | `Being Inspected` | canonical | list |  | Y | `'Being Inspected',` |
| 536 | `Cancelled` | canonical | list |  | Y | `qc_logs: [makeLog('Cancelled', ยกเลิกออเดอร์ เหตุผล: ${fullReason}), ...(job.qc_logs \|\| ` |
| 550 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const next = job.status === 'New Lead' ? 'Following Up' : job.status;` |
| 587 | `In Stock` | canonical | === |  | Y | `if (res.to === 'In Stock') {` |
| 615 | `New Lead` | canonical | list |  | N (creator/other writer, same spelling) | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 615 | `Following Up` | canonical | list |  | Y | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 615 | `Appointment Set` | canonical | list |  | Y | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 615 | `Waiting Drop-off` | canonical | list |  | Y | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 615 | `Awaiting Shipping` | canonical | list |  | Y | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 615 | `Active Lead` | canonical | list |  | Y | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 615 | `Active Leads` | legacy | list | มี | Y → Active Lead | `const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'A` |
| 625 | `Parcel In Transit` | canonical | list |  | Y | `makeLog('Parcel In Transit', อัพเดทเลขพัสดุ: ${tracking} — สถานะเปลี่ยนเป็นพัสดุอยู่ระหว่` |
| 697 | `Pending QC` | canonical | list |  | Y | `qc_logs: [makeLog('Pending QC', 'แก้ย้อนหลัง: งานถูกข้ามขั้นส่งมอบ ทำให้ค่าวิ่งไม่ถูกคำนวณ` |
| 712 | `Closed (Lost)` | canonical | list |  | Y | `qc_logs: [makeLog('Closed (Lost)', 'ปิดงานถาวร (ไม่เปิดให้กลับมาขายใหม่)'), ...(job.qc_log` |
| 873 | `Appointment Set` | canonical | list |  | Y | `hadSchedule ? 'Appointment Rescheduled' : 'Appointment Set',` |
| 1245 | `Active Leads` | legacy | list | มี | Y → Active Lead | `{(['Active Leads', 'Active Lead', 'Following Up'].includes(job.status)) &&` |
| 1245 | `Active Lead` | canonical | list |  | Y | `{(['Active Leads', 'Active Lead', 'Following Up'].includes(job.status)) &&` |
| 1245 | `Following Up` | canonical | list |  | Y | `{(['Active Leads', 'Active Lead', 'Following Up'].includes(job.status)) &&` |
| 1608 | `Cancelled` | canonical | list |  | Y | `{!['Cancelled', 'Completed', 'Paid', 'Returned'].includes(job.status) && (` |
| 1608 | `Completed` | canonical | list |  | Y | `{!['Cancelled', 'Completed', 'Paid', 'Returned'].includes(job.status) && (` |
| 1608 | `Paid` | canonical | list |  | Y | `{!['Cancelled', 'Completed', 'Paid', 'Returned'].includes(job.status) && (` |
| 1608 | `Returned` | legacy | list | **ไม่มี** | Y → Return Confirmed | `{!['Cancelled', 'Completed', 'Paid', 'Returned'].includes(job.status) && (` |
| 1874 | `Pending QC` | canonical | list |  | Y | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `In Stock` | canonical | list |  | Y | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `Paid` | canonical | list |  | Y | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `PAID` | legacy | list | มี | Y → Paid | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `Completed` | canonical | list |  | Y | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `Returned` | legacy | list | **ไม่มี** | Y → Return Confirmed | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `Closed (Lost)` | canonical | list |  | Y | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 1874 | `Cancelled` | canonical | list |  | Y | `{!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Ca` |
| 2241 | `New Lead` | canonical | case |  | N (creator/other writer, same spelling) | `case 'New Lead':` |
| 2246 | `Following Up` | canonical | case |  | Y | `case 'Following Up': {` |
| 2266 | `Appointment Set` | canonical | case |  | Y | `case 'Appointment Set':` |
| 2267 | `Waiting Drop-off` | canonical | case |  | Y | `case 'Waiting Drop-off':` |
| 2268 | `Awaiting Shipping` | canonical | case |  | Y | `case 'Awaiting Shipping':` |
| 2286 | `Parcel In Transit` | canonical | case |  | Y | `case 'Parcel In Transit':` |
| 2290 | `Parcel Received` | canonical | case |  | Y | `case 'Parcel Received':` |
| 2294 | `Drop-off Received` | canonical | case |  | Y | `case 'Drop-off Received':` |
| 2297 | `Active Lead` | canonical | case |  | Y | `case 'Active Lead':` |
| 2298 | `Active Leads` | legacy | case | มี | Y → Active Lead | `case 'Active Leads': {` |
| 2347 | `Assigned` | legacy | case | มี | Y → Rider Assigned | `case 'Assigned':` |
| 2348 | `Accepted` | legacy | case | มี | Y → Rider Accepted | `case 'Accepted':` |
| 2349 | `Rider Assigned` | canonical | case |  | Y | `case 'Rider Assigned':` |
| 2350 | `Rider Accepted` | canonical | case |  | Y | `case 'Rider Accepted':` |
| 2353 | `Heading to Customer` | legacy | case | มี | Y → Rider En Route | `case 'Heading to Customer':` |
| 2354 | `In-Transit` | legacy | case | **ไม่มี** | Y → Rider Returning / Parcel In Transit | `case 'In-Transit':` |
| 2355 | `Arrived` | legacy | case | มี | Y → Rider Arrived | `case 'Arrived':` |
| 2356 | `Rider En Route` | canonical | case |  | Y | `case 'Rider En Route':` |
| 2357 | `Rider Arrived` | canonical | case |  | Y | `case 'Rider Arrived':` |
| 2368 | `Being Inspected` | canonical | case |  | Y | `case 'Being Inspected':` |
| 2369 | `Pending QC` | canonical | case |  | Y | `case 'Pending QC':` |
| 2370 | `QC Review` | canonical | case |  | Y | `case 'QC Review': {` |
| 2381 | `Paid` | canonical | === |  | Y | `(l: any) => l && (l.action === 'Paid' \|\| l.action === 'PAID'),` |
| 2381 | `PAID` | legacy | === | มี | Y → Paid | `(l: any) => l && (l.action === 'Paid' \|\| l.action === 'PAID'),` |
| 2383 | `Pending QC` | canonical | === |  | Y | `if (status === 'Pending QC' && wasPaid) {` |
| 2393 | `Revised Offer` | canonical | case |  | N (creator/other writer, same spelling) | `case 'Revised Offer':` |
| 2394 | `Negotiation` | canonical | case |  | Y | `case 'Negotiation':` |
| 2397 | `Payout Processing` | canonical | case |  | Y | `case 'Payout Processing':` |
| 2400 | `Paid` | canonical | case |  | Y | `case 'Paid':` |
| 2401 | `PAID` | legacy | case | มี | Y → Paid | `case 'PAID':` |
| 2402 | `Waiting For Handover` | canonical | case |  | Y | `case 'Waiting For Handover':` |
| 2403 | `Waiting for Handover` | legacy | case | มี | Y → Waiting For Handover | `case 'Waiting for Handover':` |
| 2404 | `Rider Returning` | canonical | case |  | Y | `case 'Rider Returning':` |

### `src/pages/mobile/MobileTicketsPage.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 32 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `job.status === 'New B2B Lead' ? 'sales' : jobListPhaseOf(job.status, job.receive_method);` |
| 197 | `New Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isNew = !receded && (job.status === 'New Lead' \|\| job.status === 'New B2B Lead');` |
| 197 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isNew = !receded && (job.status === 'New Lead' \|\| job.status === 'New B2B Lead');` |
| 198 | `New B2B Lead` | canonical | === |  | N (creator/other writer, same spelling) | `const isB2B = job.type === 'B2B Trade-in' \|\| job.status === 'New B2B Lead';` |

### `src/pages/mobile/components/AdminInspectionModal.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 337 | `Pending QC` | canonical | list |  | Y | `[jobs/${job.id}/status]: 'Pending QC',` |

### `src/pages/sales/POS.tsx` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 22 | `Ready to Sell` | legacy | === | **ไม่มี** | Y → Ready To Sell | `return list.filter(j => j.status === 'Ready to Sell');` |

### `src/pages/tracking/CustomerTracking.tsx` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 61 | `Cancelled` | canonical | === |  | Y | `const isCancelled = job.status === 'Cancelled' \|\| job.status === 'Closed (Lost)';` |
| 61 | `Closed (Lost)` | canonical | === |  | Y | `const isCancelled = job.status === 'Cancelled' \|\| job.status === 'Closed (Lost)';` |
| 68 | `PAID` | legacy | list | **ไม่มี** | Y → Paid | `if (slipUrl \|\| ['PAYMENT COMPLETED', 'PAID', 'IN STOCK', 'READY TO SELL', 'COMPLETED', 'DE` |
| 69 | `PRICE ACCEPTED` | legacy | list | **ไม่มี** | Y → Price Accepted | `if (['PRICE ACCEPTED', 'REVISED OFFER', 'PAYOUT PROCESSING', 'PENDING FINANCE APPROVAL', '` |

### `src/utils/qcStation.ts` (4)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 157 | `Payout Processing` | canonical | list |  | Y | `['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action));` |
| 157 | `Paid` | canonical | list |  | Y | `['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action));` |
| 157 | `PAID` | legacy | list | มี | Y → Paid | `['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action));` |
| 259 | `In Stock` | canonical | === |  | Y | `if (nextStatus === 'In Stock') {` |

### `src/utils/riderSettlement.ts` (1)

| บรรทัด | literal | ชนิด | รูปการเทียบ | คู่ canonical ใกล้ๆ | engine เขียน canonical | โค้ด |
|---|---|---|---|---|---|---|
| 54 | `Paid` | canonical | === |  | Y | `if (job.rider_fee_status === 'Paid') return null; // กันจ่ายซ้ำ` |

หมายเหตุของตาราง: (1) `src/pages/tracking/CustomerTracking.tsx` เทียบหลัง `.toUpperCase()` จึง**ไม่สนตัวพิมพ์** — ปลอดภัยจากกับดักนี้ทั้งไฟล์ แม้จะขึ้นในตาราง (2) `TradeInUI.tsx` เฟส 1-4 กับ `MobileTicketDetail.tsx` PIPELINE (บรรทัด 104-121) normalize ทั้งสองฝั่งตั้งแต่ #709 — literal ในลิสต์พวกนั้นไม่เป็นกับดักแล้ว ที่ยังเป็นคือ `isCancelled`/`Returned` (TradeInUI 36-39, 78-79) (3) `RiderPerformance*.tsx` และ `DispatcherPage.tsx` `ACTIVE_STATUSES` รับทั้งสองสะกดอยู่แล้ว (4) `B2CWorkspace.tsx:608` เป็น writer ในคอมโพเนนต์ที่ไม่ถูก mount (ดูรายงาน 2026-09-04-qc-station) (5) `src/utils/qcStation.ts`, `inventoryStatus.ts`, `jobTransitions.ts` คือ helper ที่ normalize แล้ว literal ที่ขึ้นคือ `Reserved` หรือค่าใน `JOB_STATUS.*` ที่ regex จับจาก enum reference ไม่ได้ — ไม่ใช่กับดัก


## ภาคผนวก B — ตารางป้าย/สี ที่ key ด้วย literal (ไม่ใช่การเทียบ แต่ key สะกดเดียวจะได้ค่า default สำหรับอีกสะกด)

| ไฟล์ | จำนวน key | legacy key |
|---|---|---|
| `src/utils/statusColors.ts` | 39 | `Accepted`, `Active Leads`, `Arrived`, `Assigned`, `Heading to Customer`, `In-Transit`, `PAID`, `Returned` |
| `src/pages/mobile/MobileTicketDetail.tsx` | 31 | `Accepted`, `Active Leads`, `Arrived`, `Assigned`, `Heading to Customer`, `In-Transit`, `PAID`, `Returned` |
| `src/pages/appointments/AppointmentCalendar.tsx` | 11 | `Active Leads`, `In-Transit` |
| `src/pages/mobile/MobileNotificationsPage.tsx` | 6 | `Returned` |
| `src/pages/fleet/DispatcherPage.tsx` | 5 | `Accepted`, `In-Transit` |