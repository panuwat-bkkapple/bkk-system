# ทำไม /qc-station To Do ขึ้น (0) ทั้งที่งานเพิ่งถูกส่งเข้า QC Lab (สำรวจ 4 ก.ย. 2569)

**เคส:** แอดมินกด "Send to QC LAB" บน OID-MTH3OCEC-820 (serial HQ594LKGQL) · Trace ขึ้น CURRENT STATUS = SENT TO QC LAB · workspace ขึ้น "รอแผนก QC LAB ตรวจสอบ" · `/qc-station` แท็บ To Do ขึ้น (0)

**สรุปบรรทัดเดียว:** ปุ่มส่งเข้าแล็บย้ายไป status engine แล้วและเขียนสถานะสะกด canonical `Sent To QC Lab` (T ใหญ่) แต่ `/qc-station` ยังกรอง To Do ด้วย string literal `'Sent to QC Lab'` (t เล็ก) แบบ case-sensitive โดยไม่ผ่าน `normalizeStatus` — งานจึงอยู่ใน path ที่หน้านั้นอ่านอยู่แล้ว แต่ไม่ผ่านตัวกรองบรรทัดเดียว. Trace กับ workspace "ยืนยันว่าส่งแล้ว" ได้เพราะทั้งสองที่**ไม่สนตัวพิมพ์** (CSS `uppercase` ตัวหนึ่ง, `toLowerCase()` อีกตัวหนึ่ง) จึงมองไม่เห็นความต่างที่ To Do มองเห็น

สำรวจอย่างเดียว ไม่แก้โค้ด. ไม่ได้อ่านฐานข้อมูลจริง — ค่าสถานะของงานใบนี้เป็นการอนุมานจากโค้ดของ writer (ข้อ 1) ซึ่งเป็นทางเดียวที่ปุ่มนั้นเดินได้วันนี้

---

## 1. ปุ่ม "send to QC" — เขียนอะไร ที่ไหน

### 1a. ทางเข้าที่มีชีวิต (ทั้งหมดผ่าน engine)

| ปุ่ม | ไฟล์:บรรทัด | event ที่ยิง |
|---|---|---|
| "Send to QC LAB (ส่งเข้าแล็บ)" บน desktop workspace | `src/pages/admin/components/PricingSidebar.tsx:1135` | `JOB_EVENT.SENT_TO_LAB` |
| "ส่งเข้า QC Lab" บนมือถือ (Store-in / Mail-in หลังจ่ายเงิน) | `src/pages/mobile/MobileTicketDetail.tsx:2408` | `JOB_EVENT.SENT_TO_LAB` |
| "ผ่าน QC → ส่ง QC Lab" บนมือถือ (จาก Pending QC) | `src/pages/mobile/MobileTicketDetail.tsx:2376` | `JOB_EVENT.SENT_TO_LAB` |

- `JOB_EVENT.SENT_TO_LAB = 'sent_to_lab'` — `src/utils/jobTransitions.ts:42`
- desktop: `handleTransition` ที่ PricingSidebar รับเป็น prop มาจาก `src/pages/admin/B2CWorkspacePage.tsx:160-163` → `runJobTransition(job.id, event, { reason })`
- `runJobTransition` → `httpsCallable(..., 'transitionJob')` — `src/utils/runJobTransition.ts:56-59`
- callable `transitionJob` — `functions/status-transition-api.js:88-135`: role มาจาก auth token (`actorForRole`, บรรทัด 41-42, 110) แล้วเรียก `applyTransition` (บรรทัด 115-126) ด้วย `by = "admin_staff:{staffId}"`, `byName = who.name`
- กติกา transition `sent_to_lab` — `functions/status-engine.js:547-552`:
  ```
  from: [Pending QC, In Stock, Paid, Waiting For Handover, Rider Returning]
  to:   S.SENT_TO_QC_LAB
  custody: CUSTODY.STORE
  actors: [ACTOR.ADMIN_STAFF]
  ```
  `decideTransition` อ่านสถานะปัจจุบันผ่าน `normalizeStatus` ก่อนเทียบ from-list (`status-engine.js:909`) — ฝั่ง**อ่านของ engine** จึงรับทั้งสองสะกดได้ แต่ฝั่ง**เขียน**ออกค่าเดียวคือ enum

### 1b. สิ่งที่ `applyTransition` เขียน (`functions/status-apply.js:98-190`)

**path เดียว:** `jobs/{jobId}` ผ่าน `db.ref('jobs/'+jobId).transaction(...)` (บรรทัด 111) — ไม่มี path อื่น ไม่มีโหนดคิวแยกของ QC

| ฟิลด์ | ค่าที่เขียน (สำหรับ `sent_to_lab`) | บรรทัด |
|---|---|---|
| `status` | `JOB_STATUS.SENT_TO_QC_LAB` = **`'Sent To QC Lab'`** (`src/types/job-statuses.ts:65`, สำเนา JS `functions/status-vocab.generated.js:79`) | 140 |
| `status_version` | ค่าเดิม + 1 | 141 |
| `updated_at` | `Date.now()` | 142 |
| `status_history[]` | append `{ from, to: 'Sent To QC Lab', event: 'sent_to_lab', actor: 'admin_staff', by: 'admin_staff:{staffId}', at, reason }` เก็บท้าย 60 แถว (`MAX_HISTORY`, บรรทัด 51) | 143-155 |
| `qc_logs[]` | prepend `{ action: 'Sent To QC Lab', by: <ชื่อพนักงาน>, timestamp, details: 'รับมอบเครื่องและส่งเข้าห้องแล็บ' }` (details = `reason` ที่ปุ่มส่งมา) | 161-169 |
| `custody` | `'store'` (`CUSTODY.STORE`, `status-engine.js:51`) | 171 |
| `paid_at` / `refunded_at` / `withdrawn_*` | ไม่แตะ — `sent_to_lab` ไม่มี stamps และไม่มี `clears` | 174-184 |

**ข้อสังเกตสำคัญ: `qc_logs[].action` ก็เป็น `'Sent To QC Lab'` (T ใหญ่) เช่นกัน** — ไม่ใช่แค่ `status`

### 1c. ทางเข้าที่ยังเขียน `'Sent to QC Lab'` (t เล็ก) แต่ตายแล้ว

- `src/features/trade-in/components/b2c/B2CWorkspace.tsx:608` — `onUpdateStatus(job.id, 'Sent to QC Lab', ...)` (writer รูปเก่า). คอมโพเนนต์นี้ถูก mount ที่เดียวคือ `TicketDetailsModal.tsx:28` และ **`TicketDetailsModal` ไม่ถูก import จากไฟล์ไหนใน `src/` เลย** (grep ทั้ง repo ได้ศูนย์นอกไฟล์ตัวเอง). `handleUpdateStatus` ตัวจริงถูกลบไปใน P2-i2 #662 / P2-k (`src/features/trade-in/TradeInDashboard.tsx:220-228` บันทึกไว้ว่า "ตัวจริงที่หน้าจอใช้อยู่คือ B2CWorkspacePage, MobileTicketDetail, PricingSidebar ซึ่งย้ายมา engine แล้ว")
- `src/features/trade-in/components/b2b/B2BManager.tsx:310` — เขียน `qc_logs[].action: 'Sent to QC Lab'` ตอนระเบิดกล่อง B2B (แต่ `status` ของงานลูกเป็น `Pending QC`) ไม่เกี่ยวกับเคสนี้

**ผล:** วันนี้ไม่มีทางเข้าที่มีชีวิตทางไหนเขียน `'Sent to QC Lab'` อีกแล้ว ทุกปุ่มออก `'Sent To QC Lab'`

---

## 2. `/qc-station` แท็บ To Do — อ่านอะไร กรองอะไร

ไฟล์: `src/pages/lab/QCStation.tsx`

- **path ที่ subscribe:** `useDatabase('jobs')` (บรรทัด 30) → `onValue(ref(db, 'jobs'))` ทั้งโหนด (`src/hooks/useDatabase.ts:54-55`) map เป็น array `{ id, ...job }` (บรรทัด 59-65). **ไม่อ่าน `jobs_archived`, ไม่มีโหนดคิว QC แยก, ไม่มี query ตาม status**
- **"parent OID" ในหน้านี้ = `job.ref_no`** — แสดงเป็นป้าย mono บนการ์ด (บรรทัด 291) และเป็นบาร์โค้ด "OID Barcode" บนสติกเกอร์ (บรรทัด 574-575). ไม่มีแนวคิด parent/child ในตัวกรอง — หน้านี้ list ทุกแถวของ `jobs` ตรงๆ (งานลูกจากการ unpack ก็โผล่เป็นแถวของตัวเองถ้าสถานะตรง)
- **ตัวกรองทั้งหมดก่อน render** (บรรทัด 59-77):
  1. ช่องค้นหา (บรรทัด 61-67): OR ของ `model` / `ref_no` / `serial` / `stock_no` / `qc_txn_id` แต่ละตัว `.toLowerCase().includes(searchTerm.toLowerCase())` — ช่องว่างผ่านทุกแถวที่มีฟิลด์ใดฟิลด์หนึ่งเป็น string
  2. **To Do** (บรรทัด 70-72): `['Sent to QC Lab'].includes(j.status)` — **สถานะค่าเดียว, เทียบตัวอักษรตรงๆ, case-sensitive, ไม่ผ่าน `normalizeStatus`**
  3. Done (บรรทัด 75): `!!j.qc_txn_id` เรียงตาม `qc_date`
- **ไม่มีตัวกรองวันที่ · ไม่มีตัวกรองสาขา · ไม่มีตัวกรองผู้รับผิดชอบ** — `supervisor` (บรรทัด 34) เป็นแค่ dropdown ที่ประทับตอน submit ไม่ได้กรองรายการ
- สำเนามือถือ `src/pages/mobile/MobileQCStation.tsx:57-70` ใช้กติกาชุดเดียวกันเป๊ะ (`['Sent to QC Lab'].includes(j.status)` บรรทัด 68) และ badge นับงาน QC ที่ bottom tab `src/pages/mobile/MobileLayout.tsx:45` ก็ `j.status === 'Sent to QC Lab'`

---

## 3. ตารางป้ายของ Trace และ workspace — map จาก raw value อะไร

### 3a. Trace "CURRENT STATUS" — ไม่มีตารางป้าย

`src/pages/inventory/Traceability.tsx:166-170`:
```tsx
<DataRow label="Current Status" value={
  <span className={`... uppercase ... ${searchResult.job?.status === 'Sold' ? ... : ...}`}>
    {searchResult.job?.status || 'UNKNOWN'}
  </span>
} />
```
- แสดง **`job.status` ดิบ** ไม่มี map ใดๆ (ตาราง `label` ที่บรรทัด 103-109 เป็นของ sale logs ไม่ใช่สถานะงาน)
- **class `uppercase` ทำให้ `'Sent To QC Lab'` กับ `'Sent to QC Lab'` เรนเดอร์เป็น `SENT TO QC LAB` เหมือนกันทุกตัวอักษร** — ตาที่ดู Trace จึงแยกสองสะกดไม่ออกโดยดีไซน์
- raw value ที่ทำให้ขึ้น SENT TO QC LAB: `'Sent To QC Lab'`, `'Sent to QC Lab'`, `'SENT TO QC LAB'`, หรือสะกดใดก็ตามที่ต่างกันแค่ตัวพิมพ์
- ที่มาของแถว: Trace หาใน `jobs` + `jobs_archived` (บรรทัด 24-26) ด้วย `matches(j.serial) || matches(j.imei) || matches(j.ref_no) || matches(j.stock_no) || matches(j.qc_txn_id)` เทียบเต็มสตริงแบบ upper-case (บรรทัด 42-45)

### 3b. Workspace "รอแผนก QC LAB ตรวจสอบ"

`src/pages/admin/components/PricingSidebar.tsx:1142-1148`:
```tsx
{!isCancelled && statusLower === 'sent to qc lab' && ( ... <p>รอแผนก QC LAB ตรวจสอบ</p> ... )}
```
- `statusLower = String(job.status || '').trim().toLowerCase()` (บรรทัด 221)
- raw value ที่ map มา: **ทุกสตริงที่ lowercase แล้วเท่ากับ `sent to qc lab`** — ครอบทั้ง `'Sent To QC Lab'` และ `'Sent to QC Lab'` (และตัดช่องว่างหัวท้าย)
- ป้ายนี้จึงขึ้นสำหรับงานที่ engine เขียน แม้ To Do จะไม่เห็น

### 3c. เพื่อเทียบ — ตัวแปลงกลางที่ทั้งสองหน้าข้างบน "ไม่ได้ใช้"

`src/types/job-statuses.ts:371-396` `normalizeStatus()`: คืน canonical ทันทีถ้าตรง enum (บรรทัด 378-380) มิฉะนั้นดู `LEGACY_ALIAS` ซึ่งมีแถว `'Sent to QC Lab': JOB_STATUS.SENT_TO_QC_LAB` (บรรทัด 360) พร้อมคอมเมนต์ที่บอกที่มาของสะกดเก่า (บรรทัด 357-359: "lowercase 'to' … B2CWorkspace, PricingSidebar, B2BManager, Inventory") — writer พวกนั้นย้ายไป engine หมดแล้ว (ข้อ 1c) แต่ alias ต้องอยู่ต่อเพราะแถวเก่าใน DB ยังสะกดแบบนั้นถาวร

---

## 4. Diff: (1) กับ (2) ชนกันตรงไหน

| แกน | writer (engine) | reader (QCStation To Do) | ตรงกันไหม |
|---|---|---|---|
| RTDB path | `jobs/{id}` | `jobs` ทั้งโหนด → รวม `jobs/{id}` | **ตรง** |
| ฟิลด์ที่ตัดสิน | `status` | `status` | **ตรง** |
| ค่า | `'Sent To QC Lab'` | `'Sent to QC Lab'` (เทียบ `includes` ตรงตัว) | **ไม่ตรง — ต่างกันหนึ่งตัวอักษร (`T`/`t`)** |
| การ normalize ก่อนเทียบ | engine normalize ฝั่ง *อ่าน* ก่อนตัดสิน from | **ไม่ normalize** | — |

**คำตอบ:** write ลง path/ฟิลด์ที่ query อ่าน**อยู่แล้ว** — แถวอยู่ใน array `jobs` ที่หน้านี้ถืออยู่ในหน่วยความจำ แต่ตกที่ `['Sent to QC Lab'].includes(j.status)` เพราะ `'Sent To QC Lab' !== 'Sent to QC Lab'`

**ฝั่งที่ผิดตาม intended flow คือ reader (`QCStation.tsx:70-72` และสำเนาที่ `MobileQCStation.tsx:68`, `MobileLayout.tsx:45`)** ด้วยเหตุผลสามข้อ:

1. กติกาของ repo (`CLAUDE.md` หัวข้อ Job/Ticket Statuses): "โค้ดใหม่ห้ามเทียบ status ด้วย string literal — เขียนด้วย `JOB_STATUS.*` และอ่านค่าจาก DB ผ่าน `normalizeStatus(raw, receiveMethod)` ก่อนเทียบเสมอ" — writer ทำตามแล้ว reader ยังไม่ทำ
2. `job-statuses.ts:65` ประกาศ `'Sent To QC Lab'` เป็น canonical และไฟล์นี้ mirror byte-for-byte ไป `bkk-frontend-next/app/types/job-statuses.ts:65` และ `bkk-rider-app/src/types/job-statuses.ts:65` (ยืนยันแล้วทั้งสามที่สะกดเหมือนกัน) — การให้ engine เขียนสะกดเก่าจะทำให้ enum กลางโกหก
3. กับดักนี้ถูกจับไว้แล้วครั้งหนึ่งในหน้าอื่น — `src/pages/fleet/RiderPerformance.tsx:77-81` คอมเมนต์ว่า "the enum canonicalized to Title Case … matching only the enum spelling made these buckets silently never match (จับได้จาก survey ส.ค. 2569)" แล้วแก้ด้วยการรับ**ทั้งสองสะกด** (บรรทัด 94 และ `RiderPerformanceDetail.tsx:91`). ตอนนั้นสถานการณ์กลับด้าน (writer ยังสะกดเก่า reader สะกดใหม่) พอ writer ย้ายไป engine ใน P2-i1/i2/j1/o1 (#661 #662 #667 #687, 3-4 ก.ย.) สถานการณ์ก็พลิก แต่หน้าที่เทียบสะกดเก่าเพียงสะกดเดียวไม่ได้ถูกไล่ตาม

### ทำไมสามหน้าจอพูดไม่ตรงกันโดยไม่มี error

- Trace: `uppercase` กลบความต่าง (3a)
- Workspace: `toLowerCase()` กลบความต่าง (3b)
- To Do: เทียบตรงตัว → เห็นความต่าง → (0)
- `jobListPhase.ts` ผ่าน `normalizeStatus` จึงยังจัดแท็บถูก (ไม่มีอาการที่นั่น)

รูปเดียวกับ "กฎมีกี่คนอ่าน" ใน `bkk-frontend-next/CLAUDE.md`: alias เขียนถูกแล้วที่ `normalizeStatus` แต่คนอ่านสถานะยังต่อสายไม่ครบ

### คนอ่านอื่นที่เทียบ `'Sent to QC Lab'` สะกดเดียวแบบ case-sensitive (จะพลาดงานที่ engine เขียนเหมือนกัน — ตรวจแล้วเฉพาะ `src/`)

| ไฟล์:บรรทัด | ผลที่ตามมาสำหรับงานสะกด canonical |
|---|---|
| `src/pages/lab/QCStation.tsx:70-72` | **To Do ว่าง** (เคสนี้) |
| `src/pages/lab/QCStation.tsx:523` + `src/utils/qcStation.ts:15` (`QC_SUBMITTABLE_STATUSES`) | ต่อให้เปิดงานได้ (ผ่านแท็บ Done หรือค้นหา) **ปุ่ม submit QC ไม่ขึ้น** |
| `src/pages/mobile/MobileQCStation.tsx:68` | To Do มือถือว่าง |
| `src/pages/mobile/MobileLayout.tsx:45` | badge งาน QC บน bottom tab ไม่นับ |
| `src/pages/mobile/MobileTicketDetail.tsx:121` | แถบขั้นตอน "จ่ายเงิน" ไม่ติดสว่าง |
| `src/pages/mobile/MobileTicketDetail.tsx:2232` + `2415` (`switch (status)` ค่าดิบ, `case 'Sent to QC Lab'`) | ปุ่ม "ย้อนสถานะกลับ → Pending QC" ไม่ขึ้นบนมือถือ |
| `src/pages/finance/Finance.tsx:25`, `src/pages/finance/components/TransactionRepair.tsx:43` | `isPaid` เป็น false สำหรับงานที่ `paid_at` มีแล้วแต่สถานะสะกดใหม่ |
| `src/features/trade-in/components/modal/TradeInUI.tsx:60` | ลิสต์สถานะ (ยังไม่ได้ไล่ผลกระทบ) |

หมายเหตุ: ตัวที่รับทั้งสองสะกดอยู่แล้ว — `RiderPerformance.tsx:94`, `RiderPerformanceDetail.tsx:91`, `functions/index.js:5158`, `functions/index.js:3435` (`FEE_TRIGGER_STATUSES` มีเฉพาะสะกดเก่า แต่ตัวนั้นเป็น trigger ค่าวิ่ง ไม่ใช่เคสนี้ — จดไว้เฉยๆ)

### ขอบเขตของบั๊กตามเวลา

engine เริ่มเป็นเจ้าของปุ่มส่งเข้าแล็บบน desktop ตั้งแต่ P2-i2 #662 (3 ก.ย. 2569) และบนมือถือตั้งแต่ P2-j1 #667 (3 ก.ย.) — **ทุกงานที่ถูกส่งเข้าแล็บหลังจากนั้นหายจาก To Do ทั้งหมด ไม่ใช่เฉพาะใบนี้** (repo ถูก clone แบบ shallow 50 commit จึงยืนยันวันที่จาก commit ที่มองเห็นเท่านั้น)

---

## 5. ช่องค้นหาของ station — จับ serial, OID, หรือทั้งคู่

`src/pages/lab/QCStation.tsx:61-67` (มือถือ `MobileQCStation.tsx:60-66` เหมือนกัน): substring case-insensitive บน **ทั้งคู่** — `j.ref_no` (OID) และ `j.serial` — บวก `model`, `stock_no`, `qc_txn_id`. ป้ายในช่องเขียน "Scan Barcode / OID / SN..." (บรรทัด 272)

**แต่ "serial" ที่มันอ่านคือ `jobs/{id}/serial` ระดับ root ซึ่งงาน B2C ที่ยังไม่ผ่าน QC มักไม่มี:**

| ใครเขียน serial ของงาน | ฟิลด์ | ไฟล์:บรรทัด |
|---|---|---|
| แอปไรเดอร์ตอนตรวจหน้างาน | `devices[i].device_serial` **และ** root `device_serial` | `bkk-rider-app/src/pages/RiderApp.tsx:185`, `:236` |
| แอดมินตรวจ IMEI บนมือถือ | root `device_serial` | `src/pages/mobile/components/AdminDeviceVerificationModal.tsx:129` |
| QC Lab submit (หลังตรวจเสร็จ) | root `serial` | `src/utils/qcStation.ts:203` |
| B2B unpack | root `serial` (= imei) | `src/features/trade-in/components/b2b/B2BManager.tsx:308` |

ช่องค้นหาไม่ได้อ่าน `device_serial` เลย — ดังนั้นสำหรับงานที่**รอ**เข้า QC (ซึ่งคือทุกใบใน To Do) การพิมพ์ serial `HQ594LKGQL` จะไม่เจอ ต้องพิมพ์ OID. `AdminInspectionModal.tsx:466` รู้เรื่องนี้แล้ว (`job.device_serial || job.serial`) แต่ station ยังไม่รู้. Trace ก็อ่านแค่ `serial`/`imei` root (Traceability.tsx:44) — การที่ Trace หาใบนี้เจอจึงน่าจะมาจาก OID หรือจากงานที่มี `imei`/`serial` root อยู่แล้ว (ยืนยันจากโค้ดไม่ได้ ต้องดูแถวจริง)

เรื่องนี้เป็นบั๊กคนละตัวกับข้อ 4 และ**ไม่ใช่สาเหตุของ (0)** — To Do ว่างตั้งแต่ก่อนพิมพ์อะไรในช่อง

---

## ข้อเสนอสำหรับงานแก้ (ไม่ได้ทำในรอบนี้)

- **แก้ที่ reader ไม่ใช่ writer:** ให้ To Do / `QC_SUBMITTABLE_STATUSES` / badge / progress step เทียบผ่าน `normalizeStatus(j.status, j.receive_method) === JOB_STATUS.SENT_TO_QC_LAB` — ครอบทั้งแถวเก่า (alias) และแถวใหม่ (enum) ในครั้งเดียว และเป็นรูปที่ `jobListPhase.ts` ใช้อยู่แล้ว
- ไล่ตารางในข้อ 4 ให้ครบ ไม่ใช่แค่ `QCStation.tsx:71` — สามตัวแรก (To Do, submit gate, มือถือ) อยู่ในเส้นทางเดียวกัน แก้ตัวเดียวจะได้หน้า To Do ที่เห็นงานแต่กดส่งไม่ได้
- เขียนเทสจากเคสจริง: fixture งานที่ `status: 'Sent To QC Lab'` (สิ่งที่ engine เขียนวันนี้) และ `status: 'Sent to QC Lab'` (แถวเก่า) ต้องโผล่ใน To Do ทั้งคู่ — ตอนนี้ไม่มีเทสไหนแตะตัวกรองของหน้านี้ (grep `src/**/*.test.*` ได้ศูนย์)
- ข้อ 5 แยกเป็นงานของตัวเอง: ให้ช่องค้นหาอ่าน `device_serial` และ `devices[].device_serial` ด้วย
