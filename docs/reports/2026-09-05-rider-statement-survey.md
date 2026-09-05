# Survey เฟส 1: หน้า Rider Statement (Dr/Cr + reconcile ต่อคน) — read-only (5 ก.ย. 2569)

> **โหมด:** สำรวจโค้ดอย่างเดียว ไม่แตะ RTDB (คอนเทนเนอร์นี้ไม่มี credential)
> **ขอบเขต:** `bkk-system` @ `694d000` (#730) · `bkk-rider-app` @ `f5d0a45` (#166) · `bkk-frontend-next` @ `856c785` (#952)
> **ห้ามแตะในงานนี้:** walletLedger ทุก mirror · `riderAudit.ts` · `RiderAuditPage` · `RiderSettlements` · `buildRiderFeeApproval` ·
> callable ทุกตัว · `scripts/` · `database.rules.json` · `functions/` — งาน Waived/กลับรายการเจ้าของกำลังทำอยู่อีก session
> (branch `claude/owner-rider-wallet-reversal-cj00hq` ตอนนี้มีแค่ survey `docs/reports/2026-09-05-owner-rider-wallet-reversal-survey.md`
> ยังไม่แตะโค้ด — ไฟล์ที่เขาวางแผนจะสร้าง: `src/utils/ownerRiders.ts`, ค่า `rider_fee_status: 'Waived'`)
>
> **เอกสารอ้างอิงที่โจทย์ให้ สองใบไม่อยู่ในคอนเทนเนอร์นี้:** `docs/reports/rider-wallet-audit-2026-09-05T08-09-52-216Z.md`
> เป็นไฟล์บนเครื่อง Martens (ไม่ commit ตามตั้งใจ) และ `bkk-rider-app/docs/reports/2026-09-05-rider-wallet-status-survey.md`
> ไม่มีบน branch ไหนของ bkk-rider-app (branch `claude/rider-wallet-status-survey-f6hlpb` แก้แค่ fix-plan.md)
> — เทสของ audit อ้างว่าไฟล์นี้อยู่ที่ **bkk-frontend-next** แต่ที่นั่นก็ไม่มีบน main. รายงานนี้จึงยืนยันได้เฉพาะ **shape และกลไก
> จากโค้ด** ส่วนกรณีข้อมูลเสียอ้างจากตัวจับ (`analyze()` ใน `scripts/rider-wallet-audit.cjs`) ไม่ใช่จากตัวเลขจริง

---

## ผลสรุปก่อน: ข้อ 3 ติด — bkk-system **ไม่มี mirror ของสูตร balance/allowlist**

หน้านี้ต้อง "import จาก mirror เท่านั้น ห้ามเขียนสูตรใหม่ ห้ามแก้ mirror" แต่ในรีโปนี้:

| สิ่งที่ต้องการ | มีไหม | ที่อยู่ |
|---|---|---|
| allowlist หมวดกระเป๋า (runtime array) | **ไม่มี** — มีแค่ **type union** ของ `category` ใน `src/utils/transactionLogger.ts:24-32` (ไม่มีค่า runtime ให้ `.includes`) และ `WALLET_CREDIT_TAXABLE` (Record ครบ 8 หมวด แต่ความหมายคือ "เป็นเงินได้ไหม" ไม่ใช่ "นับเข้ากระเป๋าไหม" — ใช้ key ของมันแทน allowlist = เขียนสูตรใหม่โดยอ้อม) | — |
| `isRiderWalletTx` / `walletBalance` / `pendingWithdrawalHold` | **ไม่มี** | ตัวจริงอยู่ `bkk-rider-app/src/utils/walletLedger.ts` เท่านั้น (+ สำเนาใน `bkk-rider-app/functions/src/index.ts` `riderRequestWithdraw`) |
| parity test ข้ามรีโป | มี แต่ทิศเดียวและตรวจแค่ allowlist: `bkk-rider-app/src/utils/walletCategoryParity.test.ts` อ่าน union ใน `transactionLogger.ts` ของรีโปนี้ (ข้ามถ้าไม่ checkout) | — |
| ตัวที่ใช้สูตรจริงของแอปในรีโปนี้ | `scripts/rider-wallet-audit.cjs` `loadWalletLedger()` — **transpile `walletLedger.ts` จาก checkout ข้างๆ ตอนรัน** (`--rider-app`) ไม่ได้คัดลอก · เทส `src/utils/riderWalletAuditReadOnly.test.ts` มี `STAND_IN_LEDGER` จำลองสูตรไว้ในเทสเอง (ใช้เมื่อไม่มี checkout) | ใช้กับหน้าเว็บไม่ได้: Vite build ของ CI ไม่มี bkk-rider-app (`ci.yml` ไม่ checkout) |

**ทางเลือกให้ Martens เคาะ (ยังไม่ทำ):**
1. **สร้าง mirror ตัวที่ 4 ในรีโปนี้** `src/utils/riderWalletLedger.ts` (คัดลอก `RIDER_WALLET_CATEGORIES` + 3 ฟังก์ชัน pure ตัวอักษรเดียวกัน) + parity test รูปเดียวกับ `riderCostSplitParity.test.ts`: transpile `../bkk-rider-app/src/utils/walletLedger.ts` ด้วย loader เดียวกับ audit แล้วรัน fixture ชุดเดียวกันทั้งสองฝั่ง deep-equal (ไม่มี checkout = ข้าม) และแก้หัวไฟล์ `walletLedger.ts` ฝั่งแอปว่า MIRROR มี 4 ที่ — **ข้อหลังคือการแตะ walletLedger ซึ่งโจทย์ห้าม** จึงต้องได้คำสั่งก่อน (หรือปล่อยให้ session ที่ถือไฟล์นั้นเป็นคนเพิ่มบรรทัด)
2. **รอ session Waived/กลับรายการจบ** แล้วทำข้อ 1 ในภายหลัง
3. ไม่ทำ mirror — ให้หน้า statement เป็น **ตัวแสดงผล** ของรายงานที่ `rider-wallet-audit.cjs` ผลิต (สคริปต์อยู่ในกลุ่มห้ามแตะเช่นกัน) — ไม่ตอบโจทย์ "ยอดท้ายตารางเท่ากับแอปไรเดอร์โดยนิยาม" แบบสด

ทุกทางที่ทำให้ "ยอดท้ายตาราง = แอปไรเดอร์โดยนิยาม" ต้องมีโค้ดสูตรเดียวกันอยู่ในรีโปนี้ ซึ่งวันนี้ไม่มี. **เฟส 2 จึงหยุดรอตามโจทย์**

---

## 1. หน้า admin ปัจจุบันที่แสดงข้อมูลไรเดอร์

| route | component | role (route guard `src/App.tsx`) | เมนู (`AdminLayout.tsx`) |
|---|---|---|---|
| `/riders` | `pages/fleet/RiderManagement.tsx` | CEO / MANAGER (`:164`) | `:276` "จัดการไรเดอร์" |
| `/rider-performance`, `/rider-performance/:riderId` | `RiderPerformance.tsx` / `RiderPerformanceDetail.tsx` | CEO / MANAGER (`:165,167`) | `:278` |
| `/rider-audit` | `pages/fleet/RiderAuditPage.tsx` | CEO / MANAGER / FINANCE (`:166`) — ปุ่มอนุมัติเฉพาะ `hasAccess(['CEO','MANAGER'])` (`:85`) | `:280` + badge คิว Pending |
| `/finance` แท็บ `withdrawals` | `pages/finance/components/RiderWithdrawals.tsx` — **หน้าที่จ่ายถอนจริง** | **CEO / MANAGER / FINANCE** (`:162`) + `useFinanceGate().guard('rider_withdrawal')` ตอนกดโอน | เมนู Finance |
| `/finance` แท็บ `settlements` | `RiderSettlements.tsx` (อ่านอย่างเดียวตั้งแต่ #643) | เดียวกัน | — |
| `/rider-expenses` | `pages/finance/RiderExpenses.tsx` | CEO / MANAGER / FINANCE (`:191`) | — |
| *(ไม่มี route)* | `pages/finance/WithdrawalPage.tsx` — มีแท็บ `statement` เลือกไรเดอร์+ช่วงวันที่อยู่แล้ว (`stmtRiderId`/`startDate`) แต่**ไม่ถูก import ที่ไหน** อ่านจาก `/jobs type='Withdrawal'` ท่อเก่าที่ไม่มีใครเขียน = โค้ดตาย ห้ามใช้เป็นแบบ | — |

**role ของหน้าใหม่ = เท่ากับหน้าจ่ายถอน = CEO / MANAGER / FINANCE** (ตามโจทย์ข้อ "role: เท่ากับหน้า finance ที่จ่ายถอน")

**pattern ตารางที่ใช้อยู่ (ลอกจาก `RiderWithdrawals.tsx:217-250` และ `RiderAuditPage`):** การ์ด `bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden` · `<table className="w-full text-left">` · `thead bg-slate-50 border-b border-slate-100` · หัวคอลัมน์ `text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]` · `tbody divide-y divide-slate-50` · แถว `hover:bg-slate-50/50` · id เป็น `font-mono text-[10px] text-slate-400` · แถวว่าง `colSpan` + `text-slate-400 font-bold uppercase tracking-widest text-xs` · ปุ่ม export CSV = `Download` จาก lucide (แบบ `WhtReport.tsx:96-116`: BOM + `text/csv;charset=utf-8;` + `a.download`) · ตัวเลขผ่าน `formatCurrency` / เวลาผ่าน `formatDate` (`utils/formatters.ts`) · ข้อมูล: `useDatabase(path)` (store แชร์ทั้งแอป คืน `data: any[]` ที่มี `id` ติดทุกแถว)

การอ่าน `/transactions` ตาม index: `RiderWithdrawals.tsx:62` ใช้ `get(query(ref(db,'transactions'), orderByChild('rider_id'), equalTo(riderId)))` อยู่แล้ว — ใช้รูปเดียวกัน

## 2. shape ของข้อมูล

### `/transactions/{pushId}` (rules: admin อ่านทั้งก้อน หรือ query `rider_id == auth.uid` · `.indexOn: ["timestamp","rider_id"]` — `database.rules.json:883-890` **index มีแล้ว ไม่ต้องเพิ่ม**)

ฟิลด์ร่วมทุกแถว: `rider_id` · `amount` (ควรเป็น number แต่ writer เก่าเขียน string/undefined ได้) · `type: 'CREDIT'|'DEBIT'` · `category` · `description` · `timestamp` (ms) · `ref_job_id?` · `created_at?`

| category | type | writer ที่มีชีวิต | ฟิลด์เพิ่ม | หมายเหตุสำหรับคอลัมน์ "อ้างอิง/ที่มา" |
|---|---|---|---|---|
| `JOB_PAYOUT` | CREDIT | `src/utils/riderSettlement.ts:71-81` (`buildRiderFeeApproval` ← `/rider-audit`) | `taxable: true`, `ref_job_id` = job id | ref → `jobs/{id}` (`ref_no` บนงาน); ผู้อนุมัติ **ไม่อยู่บนแถว** อยู่ที่ `jobs/{id}/rider_fee_approved_by` + `settled_at`; ป้ายผู้เขียนอนุมานจากคำนำ description (`ค่าเที่ยวงาน` / `[Batch]` / `[Backfill Settle]` — ดู `payoutWriterLabel` ใน audit) |
| `WITHDRAWAL` | DEBIT | `RiderWithdrawals.tsx:152-181` | `slip_url`, `wht_amount/wht_rate_percent/wht_base/wht_exempt/net_paid`, ภายหลัง `exempt_part/taxable_part/reimbursed_part/labour_part` (ประทับโดย `onRiderWithdrawalExpense`) | **`ref_job_id` = key ของ `/withdrawals` ไม่ใช่ job** · **description มีเลขบัญชี** (`ถอนเงินเข้าบัญชี {bank} ({account})`) → ห้ามแสดงดิบ |
| `ADJUSTMENT` | CREDIT/DEBIT | `functions/pin-dispute.js:143-151` (คำแย้งหมุด), `scripts/revert-pin-dispute.cjs` | `taxable`, `ref_job_id`, บางแถว `category_was/category_corrected_at/category_correction_reason` (relabel) | ทิศไหนก็หมวดนี้ |
| `EXPENSE_REIMBURSEMENT` | CREDIT | `functions/rider-expenses.js:136-146` | `taxable: false`, `rider_expense_id` | ref ไป `/rider_expenses` ไม่ใช่งาน |
| `PENALTY`, `BONUS` | DEBIT / CREDIT | `logTransaction()` (ผู้เรียกกระจาย) | — | หมวดเก่า ห้ามถอด |
| `COMPANY_ADVANCE`, `RIDER_DEPOSIT` | CREDIT | ยังไม่มีหน้าจอเขียน (มีแต่ `buildWalletCredit`) | `taxable: false` | — |
| **`LOGISTICS_REVENUE`, `TRADE_IN_PAYOUT`, `B2B_PURCHASE`, `[ซ่อม]` ของ TransactionRepair** | — | ฝั่งบริษัท | — | **นอก allowlist** — เคยติด `rider_id` ของไรเดอร์ตอน finance กดจ่ายลูกค้า (ที่มาของ allowlist) → แถวจาง "ไม่นับเข้ากระเป๋า" |

**กรณีข้อมูลเสียที่ตัวจับของ audit มองหา (`analyze()` T2 — เป็นสิ่งที่หน้าต้องแสดงพร้อมป้าย ไม่ให้พัง):**
`amount_not_finite` (string ว่าง/ไม่ใช่เลข → `isRiderWalletTx` คัดออกทั้งแถว ไม่ตีเป็น 0 — กับดัก `Number(null) === 0`) · `negative_amount` · `bad_type` (ไม่ใช่ CREDIT/DEBIT) · `unknown_category` · type ผิดทิศของหมวด (เช่น WITHDRAWAL ที่เป็น CREDIT) · `no_ref_job_id` · `ref_job_missing` (ไม่อยู่ใน `/jobs` และไม่ใช่ key ของ `/withdrawals`) · `ref_job_archived` (พบใน `jobs_archived/{id}` — ต้องอ่าน subpath ทีละใบ ไม่กวาด) · `timestamp_missing` · `rider_id` ว่าง (`''` ผ่านตัวกรอง `!= null` ของปุ่ม batch รุ่นเก่าได้ — audit แสดงเป็น `(none)`)

### `/withdrawals/{pushId}` (`.indexOn: ["rider_id","status","requested_at"]` — `database.rules.json:891-897`)
เขียนโดย callable `riderRequestWithdraw` (`bkk-rider-app/functions/src/index.ts:547-555`): `rider_id, rider_name, withdraw_amount, status: 'requested', requested_at, bank_name, bank_account`
เปลี่ยนสถานะโดย `RiderWithdrawals.tsx`: `paid` (+ `paid_at, paid_by, payment_slip, wht_*, net_paid`) หรือ `rejected` (+ `rejected_at, rejected_by`). **ยอดจอง = Σ `withdraw_amount` ของแถว `status === 'requested'`** (นิยามใน `pendingWithdrawalHold`) · โหนดเล็ก subscribe ทั้งก้อนได้ (`useDatabase('withdrawals')` ใช้อยู่แล้ว)

### `/jobs` ฟิลด์ที่เกี่ยว (`useDatabase('jobs')` แอปนี้ subscribe อยู่แล้ว เปิดหน้าไม่เพิ่มค่า download)
`rider_id` (งานที่ยกเลิกถูก engine ล้าง — ไรเดอร์เดิมอยู่ใน `cancelled_by: 'rider:{id}'`; `buildRiderFeeApproval` อ่านทั้งสองรูป) · `rider_fee` (number ที่ `onJobHandedOverCalcRiderFee` ประทับ; `settledRiderFee()` คืน null เมื่อไม่ finite/≤0 — **ห้าม fallback 150**) · `rider_fee_status: 'Pending' | 'Paid'` (ไม่มี union ประกาศที่ไหน; session คู่ขนานจะเพิ่ม `'Waived'` — หน้าใหม่ต้องถือค่าอื่นเป็น "ไม่ใช่ Paid" ไม่ใช่ error) · `rider_fee_meta.reason` (`calculated` / `missing_customer_coords` / `routes_api_*` — fallback = `min_fee`) · `settled_at`, `rider_fee_approved_by` (ประทับตอนอนุมัติ) · `completed_at` (อาจไม่มี → audit ตกไป `created_at`) · `ref_no` (fallback `OID`) · `status` (เทียบผ่าน `normalizeStatus`/`JOB_STATUS` เท่านั้น)

**ความหมายของ "งาน Paid" ในกล่อง Reconcile = `rider_fee_status === 'Paid'`** (สถานะการจ่ายค่ารอบ ไม่ใช่ `status` ของงาน) — ตรงกับที่ `buildRiderFeeApproval` เขียนคู่กับแถว JOB_PAYOUT ใน multi-path เดียว จึงเป็นสองฝั่งที่ต้องเท่ากันโดยโครงสร้าง

### `/riders/{id}`
`name`, `approval_status` (`Active|Pending|Suspended`; แถวเก่าไม่มี → `RiderManagement.tsx:91-96` อนุมานจาก `status`), `status` (presence), `employment.type`, `bank`, `vehicle_type` — **ไม่มี flag "เจ้าของ" ในโค้ดวันนี้** (session คู่ขนานเสนอ `ownerRiders.ts`) → หน้าใหม่ต้องลิสต์ **ทุกคน** ทุก approval_status + rider_id ที่โผล่ใน `/transactions` แต่ไม่มีใน `/riders` (ป้าย "ไม่อยู่ใน /riders") ถึงจะเห็นบัญชีเจ้าของได้

## 3. mirror + parity test — ดูผลสรุปด้านบน (ติด)

เพิ่มเติม: mirror ที่**มี**ในรีโปนี้และเกี่ยวข้อง — `src/utils/riderCostSplit.ts` ↔ `functions/rider-cost-split.js` (ด่าน `riderCostSplitParity.test.ts` รันสองสำเนาบน fixture เดียว) เป็น**แบบ**ของ parity test ที่จะใช้ถ้าอนุญาตสร้าง mirror ของ walletLedger · `src/utils/riderWht.ts` ↔ `bkk-rider-app/src/utils/riderWht.ts` (ไม่มีด่าน)

## 4. design token

รีโปนี้**ไม่มี design.md** สำหรับแอดมิน — `design/stitch/` เป็น export ของ dealer portal (Plus Jakarta Sans / Hanken Grotesk) ไม่ใช่ของแอปนี้. แอดมินใช้ Tailwind utility ตรงตาม pattern ข้อ 1 (พื้น `bg-slate-50`/`bg-slate-900` ตามหน้า · การ์ดขาวมุม `rounded-[2rem]` · ป้ายเตือน `bg-amber-50 border-amber-200 text-amber-800` · ตัวเลขติดลบ `text-red-500` บวก `text-emerald-600`) — จะลอกจาก `RiderWithdrawals` / `RiderAuditPage` ให้หน้าตาเหมือนกัน ไม่สร้างระบบใหม่

---

## แผนเฟส 2 (พร้อมทำทันทีเมื่อข้อ 3 ปลดล็อก)

- route `/riders/:riderId/statement` (+ `/riders/statement` ยังไม่เลือกคน) guard CEO/MANAGER/FINANCE · เมนูใต้ "ใบตรวจงานไรเดอร์" · ลิงก์จากการ์ดไรเดอร์ใน `/riders` (แตะ `RiderManagement` แค่เพิ่มลิงก์ — ไฟล์นี้ไม่อยู่ในกลุ่มห้าม)
- อ่าน: `get(query(transactions, orderByChild('rider_id'), equalTo(id)))` ครั้งเดียวต่อการเลือกคน · `useDatabase('jobs')` · `useDatabase('withdrawals')` · `useDatabase('riders')` · `jobs_archived/{id}/ref_no` เฉพาะ ref ที่หาย (cap)
- logic pure ทั้งหมดใน `src/utils/riderStatement.ts` (ประกอบแถว passbook + running balance ผ่าน `walletBalance` ทีละแถวสะสม + reconcile A/B/C สองทิศ) มีเทส fixture 6 แถว
- ด่าน `riderStatementReadOnly.test.ts`: สแกน source ของหน้า+util ว่าไม่มี `.set/.update/.push/.remove/.transaction(` และไม่ import `transactionLogger`/`riderSettlement`/`runJobTransition`/`confirmPayoutTransfer` (regex พิสูจน์ตัวเองด้วยตัวอย่างที่ควรแดง แบบ `riderWalletAuditReadOnly.test.ts`)
- ไม่มีรูป preview: session นี้ไม่มี credential ต่อ DB — จะแนบ screenshot จาก harness ที่ป้อน fixture แทน และบอกไว้ตรงๆ ใน PR
