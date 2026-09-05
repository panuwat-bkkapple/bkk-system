# Survey เฟส A: กระเป๋าไรเดอร์ของเจ้าของ — ก่อนกลับรายการ (5 ก.ย. 2569, read-only)

> **โหมด:** สำรวจโค้ดอย่างเดียว ไม่แก้โค้ด ไม่แตะ RTDB (session นี้ไม่มี credential และ proxy ปิดโดเมน RTDB
> เหมือนรอบ `bkk-frontend-next/docs/reports/2026-09-05-rider-wallet-status-survey.md`)
>
> **ขอบเขต:** `bkk-system` @ `b0bf366` (#729) · `bkk-rider-app` @ `b9b4fc8` (#165) · `bkk-frontend-next` @ `111b646` (#947)
>
> **OWNER** = `GmxKmv51QxNr0HTuZ5FqmIB50kQ2` (ค่าเริ่มต้นของ `--owner-rider` ใน `scripts/rider-wallet-audit.cjs:19`)
>
> **ตัวเลข 121 / 129 / 97 / 26 / 104 / 45,659 ในโจทย์มาจากรายงาน audit บนเครื่อง Martens ซึ่งยังไม่ได้แนบ** —
> รายงานนี้ยืนยันได้เฉพาะ *กลไก* ในโค้ด ไม่ยืนยันตัวเลข ทุกข้อที่ต้องพึ่งข้อมูลจริงระบุไว้ว่าต้องอ่านจาก T-section ไหน
> ของ audit

---

## A1. ปุ่ม batch รุ่นเก่าที่เขียนแถว `[Batch]`

**ไฟล์:** `src/pages/finance/components/RiderSettlements.tsx` ฟังก์ชัน `handleApproveAll` — เวอร์ชันที่มีชีวิตอยู่ตอน
2026-09-01 01:10 +07 คือ commit `d027600` (#522, 5 ส.ค.) เพราะ commit ถัดไปของไฟล์นี้คือ #612 `179f094`
(2026-09-01 **19:11** +07) ซึ่งมาหลังเวลานั้น 18 ชั่วโมง

โค้ดที่เขียน 121 แถว (`d027600` บรรทัด 62-90):

```ts
pendingFees.forEach(job => {
  updates[`jobs/${job.id}/rider_fee_status`] = 'Paid';
  updates[`jobs/${job.id}/settled_at`] = now;
  const txKey = push(child(ref(db), 'transactions')).key;
  updates[`transactions/${txKey}`] = {
    rider_id: job.rider_id,
    amount: Number(job.rider_fee || 150),        // fallback 150 ที่ #612 ถอดทิ้ง
    type: 'CREDIT', category: 'JOB_PAYOUT',
    description: `ค่าเที่ยวงาน ${job.model || 'Unknown'} (${job.ref_no || '-'}) [Batch]`,
    timestamp: now, ref_job_id: job.id,
  };
});
await update(ref(db), updates);                   // multi-path ก้อนเดียว จาก client แอดมิน
```

**ตัวกรองของคิว** (`d027600` บรรทัด 24-35): `status ∈ {Pending QC, Completed, Waiting for Handover}` (literal) และ
`rider_fee_status === 'Pending'` และ `type !== 'Withdrawal'` และ **`rider_id != null`** — เท่านั้น

- **ไม่มีการกรอง OWNER** ทุกใบที่ rider_id เป็นเจ้าของผ่านหมด
- `rider_id != null` **ปล่อย `''` ผ่าน** (`'' != null` เป็นจริง) — ใบที่ rider_id เป็นสตริงว่างจะถูกเขียนแถวที่ `rider_id: ''`
  ส่วนใบที่ rider_id เป็น `undefined`/`null` ถูกกรองออก (T5 ของ audit แยกสองรูปนี้ไม่ออก — คอลัมน์ `rider_id` ขึ้น
  `(none)` ทั้งคู่)
- ไม่มี `taxable` บนแถว (ธงนี้เกิด #604 ทีหลัง) → ตัวแยกฐานภาษีตอนถอนตกไปอ่านชื่อหมวด = JOB_PAYOUT เป็นเงินได้ (`functions/rider-cost-split.js:12-15`)

**สิทธิ์:** component เองไม่เช็ค role — ด่านเดียวคือ route `/finance` = **CEO / MANAGER / FINANCE** (`src/App.tsx:162`)
แท็บ `settlements` ใน `src/pages/finance/Finance.tsx:78`

**ยังกดได้ไหม: ไม่ได้ ตั้งแต่ 2026-09-02 03:17 +07 (#643 `68ab3b1`)** — ไทม์ไลน์ของปุ่ม:

| commit | วันที่ | ปุ่มเดี่ยว | ปุ่ม batch | หมายเหตุ |
|---|---|---|---|---|
| `d027600` #522 | 08-05 | มี (`\|\| 150`) | มี (`\|\| 150`, `[Batch]`) | **เวอร์ชันที่เขียน 121 แถว** |
| `179f094` #612 | 09-01 19:11 | มี ผ่าน `settledRiderFee` | **ยังมี** (`[Batch]` บรรทัด 105, ข้ามใบไม่มีค่ารอบ) | ถอด fallback 150 |
| `68ab3b1` #643 | 09-02 03:17 | ลบ | **ลบ** | ย้ายการอนุมัติไป `/rider-audit`, จอนี้เหลืออ่านอย่างเดียว |
| `3d4ef18` #714 | 09-04 | — | — | เทียบ status ผ่าน `statusIs` |

ไฟล์ปัจจุบันไม่มี `update(` เลย แต่**ยัง import `ref, update, push, child` และ `db` ค้างอยู่** (`RiderSettlements.tsx:7-8`)
= import ตาย ซึ่ง B2 ควรถอดออกให้ชัดว่าจอนี้เขียนอะไรไม่ได้

**ทางเขียน JOB_PAYOUT ที่ยังมีชีวิตวันนี้ มีทางเดียว:** `src/pages/fleet/RiderAuditPage.tsx:150-190` `approvePicked`
(เลือกหลายใบได้ = ก็คือ batch อยู่ดี แค่ต้องติ๊กเอง) → `buildRiderFeeApproval` (`src/utils/riderSettlement.ts:52-81`)
- ปุ่มเห็นเฉพาะ `hasAccess(['CEO','MANAGER'])` (`:85`) หน้าเปิดได้ CEO/MANAGER/FINANCE (`App.tsx:166`)
- แถวในหน้า = `involvesRider` (`src/utils/riderAudit.ts:310-314`): มี rider_id **หรือ** `cancelled_by` รูป `rider:` **หรือ**
  มี checkpoint `rider_en_route` **หรือ มี `rider_fee`** — ข้อสุดท้ายทำให้**ใบ rider_id ว่างที่มี rider_fee โผล่ในคิว**
  และ `isPayable` (`:141-142` = `Pending` + `settledRiderFee !== null`) ให้ติ๊กได้ แล้ว `buildRiderFeeApproval` คืน `null`
  (`riderSettlement.ts:60-66` หา riderId ไม่เจอ) → ถูกนับเป็น "ข้าม N ใบ" ทุกครั้ง ไม่มีที่ไหนบอกว่าทำไม
- **ไม่มีการกรอง OWNER** — เจ้าของกดอนุมัติให้ตัวเองได้จากหน้านี้วันนี้
- ทางที่สอง `scripts/settle-pending-rider-fees.cjs` (`[Backfill Settle]`) **ปิดแล้ว** ตั้งแต่ #728 (`main()` throw ทันที)

---

## A2. trigger 2 ตัวบน `/transactions` — derive อะไรออกจาก 129 แถว JOB_PAYOUT ของ OWNER

grep รูป `ref: "/transactions/{txId}"` ทั้ง 3 repo ได้สองตัว ทั้งคู่อยู่ `bkk-system/functions` และ**ทั้งคู่กรองด้วย
`category === 'WITHDRAWAL'` ตั้งแต่บรรทัดแรก**:

| trigger | ไฟล์ | เงื่อนไขยิง | เขียนอะไร |
|---|---|---|---|
| `onRiderWhtWithheld` | `functions/rider-wht-issue.js:96-103` | `category === 'WITHDRAWAL'` **และ** `wht_amount > 0` | `wht_certificates/WHT_<เลข>` + `withdrawals/{ref_job_id}/wht_certificate` + PDF ใน Storage `wht_certificates/<id>.pdf` + counter `settings/accounting/wht_seq_by_period/{ym}` + อีเมล |
| `onRiderWithdrawalExpense` | `functions/rider-fee-expense.js:92-97` | `category === 'WITHDRAWAL'` **และ** `type === 'DEBIT'` | patch 4 ฟิลด์ลงแถวถอนเดิม (`exempt_part/taxable_part/reimbursed_part/labour_part` `:145-148`) + `expenses/{key}` (`:150`) |

**คำตอบตรงๆ: แถว JOB_PAYOUT CREDIT ไม่ทำให้ trigger ไหนยิงเลย** — ใบ 50 ทวิ, expense split, เลข WHT, PDF จะเกิด
**ก็ต่อเมื่อ OWNER เคยถอนเงิน** (มีแถว `WITHDRAWAL` DEBIT ของ OWNER) เท่านั้น. ระบบไม่มี cache ยอดคงเหลือ
(grep `wallet_balance|/wallet` ใน functions ทั้ง 3 repo = 0; `bkk-rider-app/functions/src/index.ts:521` เขียนไว้ตรงๆ ว่า
ยังไม่ denormalize) ยอดจึงเป็นผลรวมสดของ ledger ทุกครั้ง

**สิ่งที่ต้องอ่านจาก audit ของ Martens ก่อนตัดสิน:** `T4.withdrawalDebit` และ `withdrawalsNode.paid` (`rider-wallet-audit.cjs:341-352`)
- **= 0** → ไม่มีอะไร derive ออกไปจาก ledger เลย การกลับรายการจบที่ `/transactions` + `/jobs`
- **> 0** → แถวถอนนั้นมี `exempt_part/taxable_part` ที่ FIFO คำนวณจากกอง JOB_PAYOUT ของ OWNER, มีแถว `expenses/<key>`,
  และถ้า `wht_amount > 0` มี 50 ทวิออกไปแล้วพร้อมเลขรัน (ดูข้อเสนอ 2 ทางท้าย A2)

**key ที่ derive จาก 129 แถวจริงๆ วันนี้ (ไม่ผ่าน trigger แต่เขียนใน multi-path เดียวกันตอนอนุมัติ):**

| key | ใครเขียน | ใครอ่าน |
|---|---|---|
| `jobs/{id}/rider_fee_status = 'Paid'` | ปุ่ม batch / `buildRiderFeeApproval:68` | ดู A3 |
| `jobs/{id}/settled_at` | เดียวกัน (`:69`) | `src/utils/riderAudit.ts:291` (คอลัมน์) · `bkk-rider-app/src/components/history/HistoryJobSheet.tsx:213-214` (ป้าย "โอนเข้ากระเป๋า <วันที่>") |
| `jobs/{id}/rider_fee_approved_by` | `buildRiderFeeApproval:70` (เฉพาะรุ่นหลัง #643 — แถว `[Batch]` ไม่มี) | `rider-wallet-audit.cjs` เท่านั้น |

การเขียน `jobs/{id}` ทำให้ trigger ฝั่ง job ยิงตามปกติ (`onJobWritePublicTrack` ของ bkk-frontend-next) แต่ `rider_fee_status`
/`settled_at` **ไม่อยู่ใน allowlist ของ `public_track`** (`publicTrackFields.ts` มีแค่ `rider_fee_discount`) จึงไม่มีอะไร
หลุดออกโหนดสาธารณะ และ B3 ที่เขียน `Waived` ก็ไม่ต้องแตะ mirror

**ของที่โจทย์ให้ปล่อยไว้: 104 คู่ ADJUSTMENT** — ในโค้ดวันนี้มีผู้เขียน ADJUSTMENT แค่สอง: callable `adminReviewPinDispute`
(`functions/pin-dispute.js:143-151` เฉพาะใบที่ `rider_fee_status === 'Paid'` และ delta ≠ 0) กับ `scripts/revert-pin-dispute.cjs`
(รายใบ) — สองตัวนี้ผลิตคู่ CREDIT/DEBIT ที่หักกันเองได้ แต่ **104 คู่ในรอบเดียวไม่ตรงกับผู้เขียนตัวไหนในโค้ดปัจจุบัน**
ต้องอ่าน `T6` ของ audit (`adjustments[]` ต่องาน) เพื่อรู้ที่มา ถ้าคู่เหล่านั้น**ไม่ได้**หักกันพอดีเป็นศูนย์ต่อใบ balance หลัง
B3 จะไม่ลงที่ 0 ตามคาด — dry-run ของ B3 จะฟ้องเองเพราะพิมพ์ balance ก่อน/หลังจาก `walletLedger.ts` ตัวจริง

### ถ้ามี 50 ทวิออกไปแล้ว — 2 ทาง (เสนอไว้ก่อน ยังไม่เขียนโค้ด)

| | ทาง 1: void ใบเดิม + กลับ split | ทาง 2: ปล่อยใบเดิม ลงแถวชดเชยฝั่งภาษี |
|---|---|---|
| ทำอะไร | `wht_certificates/{id}/status = 'void'` + `void_reason` (รูปเดียวกับใบกำกับภาษีที่สร้างไม่สำเร็จ ดู CLAUDE.md "เลขใบกำกับภาษีห้ามกระโดดเงียบ") · ล้าง `withdrawals/{id}/wht_certificate` · ลบ `expenses/{key}` ของแถวถอน · ประทับ `exempt_part/taxable_part` ใหม่บนแถวถอน (ค่าที่ประทับแล้วชนะ FIFO — `rider-cost-split.js:49-52`) | ไม่แตะเอกสารที่ออกไปแล้ว · ลงแถว ADJUSTMENT DEBIT กลับรายการตามปกติ · ยอด `/wht-report` งวดนั้นยังคงเดิม |
| ข้อดี | ทะเบียนบัญชีตรงความจริง: เงินก้อนนั้นไม่ใช่เงินได้ของไรเดอร์ตั้งแต่ต้น ภาษีที่ "หัก" ไม่ควรนำส่ง · `/wht-report` ไม่นับเงินที่ไม่มีอยู่จริง | เล็ก ปลอดภัย ไม่แก้เอกสารที่อาจส่งสรรพากรไปแล้ว |
| ข้อเสีย | แตะ 4 node (`wht_certificates`, `withdrawals`, `expenses`, แถวถอน) + PDF ใน Storage ยังอยู่ · ถ้านำส่ง ภ.ง.ด.3 งวดนั้นไปแล้วต้องยื่นเพิ่มเติม/ขอคืน นอกระบบ | ภาษีที่หักไว้จาก "เงินได้" ที่ไม่มีจริงยังค้างในระบบว่าต้องนำส่ง = ส่งเกิน · balance OWNER ลง 0 ได้ แต่เอกสารกับ ledger เล่าคนละเรื่อง |
| ควรใช้เมื่อ | ยังไม่ยื่นภาษีงวดนั้น | ยื่นไปแล้ว หรือ Martens ตัดสินใจถือเป็นค่าใช้จ่ายจริงของงวดนั้น |

ทั้งสองทางเขียนในสคริปต์ B3 ตัวเดียวกันได้ (node เดียวกันหมด ยกเว้น Storage ซึ่งสคริปต์จะ**ไม่ลบ** PDF — เก็บไว้เป็นหลักฐาน
ว่าเคยออก) — **เลือกได้หลังเห็น T4 เท่านั้น**

---

## A3. `rider_fee_status` — ประกาศไว้ที่ไหน ใครอ่าน 'Paid'/'Pending'

**ไม่มี enum/union ที่ไหนเลยในทั้ง 3 repo** — `bkk-rider-app/src/types/index.ts:47` ประกาศเป็น `rider_fee_status?: string`,
`bkk-system/src/types/domain.ts` ไม่มีฟิลด์นี้ (ทุกจุดอ่านผ่าน `job: any`), `bkk-frontend-next` **ไม่มีทั้งผู้อ่านและผู้เขียน**
(grep `app/`, `functions/src`, `lib` = 0) → การเพิ่ม `'Waived'` แตะ **2 repo ไม่ใช่ 3**

**ผู้เขียน:**

| ค่า | ที่ |
|---|---|
| `'Pending'` | `functions/index.js:3445-3447` (`onJobHandedOverCalcRiderFee` — เฉพาะเมื่อยังไม่มีค่า) · `functions/index.js:4583` (amendment `customer_request_cancel` ค่าเสียเวลา) · `functions/pin-dispute.js:139-140` (เฉพาะเมื่อยังไม่มีค่า) · **`bkk-rider-app/src/hooks/useJobActions.ts:436`** (`handleCompleteJob` ส่ง `rider_fee_status: 'Pending'` ใน patch ของ `RETURN_ARRIVED` — เขียน**ทุกครั้ง**ที่ไรเดอร์ส่งมอบ ไม่เช็คค่าเดิม) |
| `'Paid'` | `src/utils/riderSettlement.ts:68` (ทางเดียวที่มีชีวิต) · `scripts/settle-pending-rider-fees.cjs:114` (ปิดแล้ว) |

**ผู้อ่านและผลเมื่อค่าเป็น `'Waived'` (ไม่ใช่ทั้ง Paid และ Pending):**

| ผู้อ่าน | เทียบ | ผลกับ Waived |
|---|---|---|
| `src/components/layout/AdminLayout.tsx:126` badge คิว rider-audit | `=== 'Pending' && rider_fee > 0` | หายจากตัวนับ — **ต้องการ** |
| `src/pages/finance/components/RiderSettlements.tsx:35` คิวรอตรวจ | `=== 'Pending'` | หายจากคิว — ต้องการ |
| `src/pages/fleet/RiderAuditPage.tsx:141-142` `isPayable` | `feeStatus === 'Pending'` | ติ๊กจ่ายไม่ได้ — ต้องการ; แต่แถว**ยังโผล่**ในตาราง (involvesRider) → B1 ต้องซ่อน default |
| `src/utils/riderSettlement.ts:56` กันจ่ายซ้ำ | `=== 'Paid'` → null | **Waived ผ่านด่านนี้** ถ้ามีใครเรียกตรง → B1 ต้องเพิ่ม `!== 'Pending'` เป็น reject ด้วย ไม่ใช่กันแค่ Paid |
| `src/pages/admin/components/PinDisputeCard.tsx:59` | `settled = === 'Paid'` | ป้ายบอกว่ายังไม่จ่าย — ยอมรับได้ |
| `functions/pin-dispute.js:210,301` | `settled = === 'Paid'` | แย้งหมุดบนใบ Waived = ถือว่ายังไม่ settle → แก้ `rider_fee` โดยไม่ลง ledger และ `:139` ไม่ทับ Waived (มีค่าอยู่แล้ว) — ปลอดภัย แต่ค่ารอบใหม่จะไม่ถูกจ่ายซึ่งตรงเจตนา |
| `bkk-rider-app/src/components/history/HistoryJobSheet.tsx:87` | `feePaid = === 'Paid'` | ไรเดอร์เห็น "ยังไม่ได้รับ" ตลอดไป — สำหรับ OWNER ยอมรับได้ ถ้าจะใช้ Waived กับไรเดอร์จริงต้องมีป้ายที่นั่น |
| `scripts/rider-wallet-audit.cjs:360,418,632` | `!== 'Pending'` ข้าม / พิมพ์ค่าดิบ | T5 ไม่นับ, T6 พิมพ์ "Waived" — ใช้ยืนยันผล B3 ได้เลย |
| `scripts/audit-travel-mode-repricing.cjs:198,310-311` | `=== 'Paid'` แยกถัง | ถูกนับเป็น "ยังไม่จ่าย" — สคริปต์อ่านอย่างเดียว ไม่กระทบ |

**สองอย่างที่ต้องระวังตอนเพิ่ม Waived:**
1. `useJobActions.ts:436` ของแอปไรเดอร์เขียน `Pending` ทับได้ถ้า OWNER ใช้แอปส่งมอบงานอีก — ด่าน B1 ที่ปุ่มอนุมัติกันเงินออกได้ แต่ใบจะกลับมา
   นั่งในคิวเป็น Pending ใหม่ (ไม่ใช่ Waived) → B1 ควรให้หน้า /rider-audit ติดป้าย "บัญชีเจ้าของ" และไม่ให้ติ๊ก ไม่ใช่พึ่ง Waived อย่างเดียว
2. **`statusWriterCensus.test.ts` นับทุกการเขียน `jobs/{id}` ตรงจาก client เพดาน 77 ลดได้ขึ้นไม่ได้** (`:60,92-94`) —
   ปุ่ม Waive ที่เขียน `jobs/{id}/rider_fee_status` จาก RiderAuditPage โดยตรง**จะทำให้ด่านนั้นแดง** → ทางที่ไม่ชนกฎคือ
   callable ฝั่ง server (เช่น `adminWaiveRiderFee` ใน functions) ซึ่งเป็นที่เดียวกับที่ด่าน OWNER ฝั่ง server ควรอยู่. ฟิลด์
   `rider_fee_status` ไม่อยู่ใน `ENGINE_OWNED` (`functions/status-apply.js:36-46`) และไม่มี `.validate` ใน rules
   (`database.rules.json:75-80` มีแค่ `rider_fee`/`rider_fee_estimate`) จึงเขียนได้ทั้งสองทาง — เป็นเรื่องเลือกดีไซน์ ไม่ใช่ข้อจำกัด

---

## A4. `onJobHandedOverCalcRiderFee` คำนวณค่ารอบให้ใบที่ rider_id ว่างได้อย่างไร

`functions/index.js:3372-3455` trigger `onValueUpdated /jobs/{jobId}/status` — มี**สองทางเข้า**และด่านไม่เท่ากัน:

```js
if (!isFeeTriggerStatus(after)) return;            // Pending QC | Sent To QC Lab | In Stock  (rider-fee-trigger.js:5-9)
...
if (isSafetyNetEntry(after, job.receive_method)) { // = canonical ไม่ใช่ Pending QC
  if (job.receive_method !== "Pickup") return;     // ด่าน 1 — เฉพาะตาข่าย
  if (!job.rider_id) return;                       // ด่าน 2 — เฉพาะตาข่าย
  if (typeof job.rider_fee === "number" && job.rider_fee > 0) return;
}
if (typeof job.rider_fee === "number" && job.rider_fee > 0) return; // ด่านเดียวของทางหลัก
const result = await computeRiderFeeForAssignee(db, job);
... updates.rider_fee = result.fee; if (!job.rider_fee_status) updates.rider_fee_status = "Pending";
```

**เงื่อนไขที่หลุด: ทางหลัก (`status → Pending QC`) ไม่เช็ค `rider_id` และไม่เช็ค `receive_method` เลย** — สองด่านนั้นถูก
เขียนไว้เฉพาะในบล็อกตาข่าย (`:3406-3411`) ด้วยความเชื่อว่า "Pending QC เกิดจากไรเดอร์ส่งมอบเท่านั้น" ซึ่งไม่จริง:
งาน Store-in / Mail-in ก็เดินเข้า Pending QC และแอดมินเลื่อนสถานะงานใดก็ได้เข้าไป

แล้ว `computeRiderFee` (`index.js:599-650`) **ไม่มีทางคืน "ไม่มีค่ารอบ"** — ไม่มีพิกัดลูกค้า (Store-in/Mail-in ไม่มี `cust_lat`)
คืน `fee: rates.min_fee` พร้อม `reason: 'missing_customer_coords'`, ไม่มีพิกัดสาขาคืน `min_fee` + `missing_branch_coords`,
Routes ล้มคืน `min_fee` + `routes_api_*`. `computeRiderFeeForAssignee` ที่ไม่มี rider_id = อัตรามอเตอร์ไซค์ (`:758-761`)

ผลคือใบที่ rider_id ว่างได้ `rider_fee = min_fee` (ค่าเริ่มต้น 100) + `rider_fee_status = 'Pending'` + `qc_logs` แถว
`settled_at_handover` และไปนั่งในคิว `/rider-audit` (ผ่าน `involvesRider` ข้อ "มี rider_fee") **วิธียืนยันจากข้อมูล:** ใบ 25-26 ใบ
ใน T5 ควรมี `rider_fee_meta.reason = 'missing_customer_coords'` แทบทั้งหมด และ `receive_method` ไม่ใช่ Pickup — T6 พิมพ์ทั้งสองคอลัมน์

ทางเข้าที่สอง (เล็กกว่า): amendment `customer_request_cancel` (`index.js:4553-4590`) เขียน `rider_fee` + `Pending`
เป็นค่าเสียเวลาให้ไรเดอร์ที่ออกเดินทางแล้ว ขณะที่ engine ข้อ cancel `clears: ["rider_id"]` (`status-engine.js:267,296`) —
ใบพวกนี้มี rider_id ว่าง**โดยตั้งใจ** และ `buildRiderFeeApproval` ตกไปอ่าน `cancelled_by` รูป `rider:{id}` (`riderSettlement.ts:60-65`)
ถ้า cancelled_by เป็นของลูกค้า/แอดมิน ใบนั้นจ่ายไม่ได้แต่ค้าง Pending ตลอดกาล — ถูกนับใน 26 ใบด้วย และ B3 ที่ waive `no_rider`
จะครอบมันไปด้วย (ถูกต้องสำหรับ OWNER-era แต่ถ้าวันหน้ามีไรเดอร์จริงต้องแยก)

**สิ่งที่โจทย์เฟส B ไม่ได้สั่งแต่ต้องเคาะ:** ไม่ปิดรูนี้ = หลัง B3 ทุกใบ Store-in/Mail-in ที่เข้า Pending QC จะสร้าง Pending
ใบใหม่ต่อไปเรื่อยๆ (ด่าน B1 กันเงินออกได้ แต่คิวจะเต็มใบ "ไม่มีไรเดอร์") — แก้ 2 บรรทัดโดยย้ายด่าน `receive_method`/`rider_id`
ขึ้นมาก่อน `computeRiderFeeForAssignee` ให้ครอบทั้งสองทางเข้า (มีเทส `functions/test/rider-fee-trigger.test.mjs` รองรับอยู่แล้ว)

---

## คำถามที่ต้องให้ Martens ตอบก่อนเฟส B

1. **A2:** `T4.withdrawalDebit` ของ OWNER = 0 ไหม — ถ้าไม่ ให้เลือกทาง 1 หรือ 2 ของ 50 ทวิ
2. **A2:** 104 คู่ ADJUSTMENT มาจากไหน (T6) และหักกันเป็นศูนย์ต่อใบไหม — ถ้าไม่ balance หลัง B3 จะไม่ใช่ 0
3. **B1 (จาก A3 ข้อ 2):** Waive ผ่าน callable ฝั่ง server (`adminWaiveRiderFee`, ไม่ชน `statusWriterCensus`) หรือเขียนตรงจาก
   client แล้วขยับเพดาน 77 (ขัดกฎ "ลดได้ ขึ้นไม่ได้") — แนะนำ callable
4. **B1:** `OWNER_RIDER_IDS` เป็น hardcode ที่ mirror 2 ที่ (`src/utils/ownerRiders.ts` + `functions/owner-riders.js` มี parity test)
   หรืออ่านจาก `settings/fleet/owner_rider_ids` — แนะนำ hardcode เป็นค่าเริ่มต้น + settings เป็น override เฉพาะ server
5. **A4:** ให้เฟส B ปิดรูใน `onJobHandedOverCalcRiderFee` ด้วยไหม (ข้อ B5 นอกโจทย์เดิม) — ไม่ปิด = ใบ `no_rider` งอกใหม่หลังกลับรายการ
6. **A3:** `Waived` เพิ่มเป็น union `'Pending' | 'Paid' | 'Waived'` ใน 2 repo (bkk-system ใหม่ + `bkk-rider-app/src/types/index.ts:47`) —
   frontend-next ไม่แตะเพราะไม่มีผู้อ่าน ตกลงตามนี้ไหม

---

## คำตอบของ Martens (5 ก.ย. 2569) และสิ่งที่เฟส B ทำตาม

| ข้อ | คำตอบ | ทำใน PR #731 |
|---|---|---|
| 1 | `T4`: WITHDRAWAL มี 1 แถวทั้งระบบ เป็นของไรเดอร์จ้าง — ไม่มี 50 ทวิ/expense split ของ OWNER | สคริปต์แตะแค่ `/transactions` + `jobs/*/rider_fee_status` |
| 2 | 104 คู่ ADJUSTMENT: CREDIT 1 / DEBIT 1 เท่ากัน หักกันเป็นศูนย์ | ปล่อยไว้ planner ไม่นับเป็นแถวกลับ (มีเทส) |
| 3 | Waive เป็น callable ฝั่ง server role เท่าหน้า finance รับหลายใบ reason บังคับ multi-path ก้อนเดียว | `adminRiderFeeWaive` + อนุมัติก็ย้ายขึ้น `adminRiderFeeApprove` census 77 → 74 |
| 4 | `OWNER_RIDER_IDS` อ่านจาก config/env ของ functions ไม่ hardcode | env + GitHub Secret, fail closed, สคริปต์ก็อ่าน env เดียวกัน |
| 5 | ปิดรู A4 ในเฟส B | `feeCalcBlockReason` ทั้งสองทางเข้า (B5) |
| 6 | union ใน 2 repo ไฟล์ shared + parity test; แอปไรเดอร์ห้ามเขียน Pending ทับ Paid/Waived (PR แยก) | `riderFeeStatus.ts` ×2 + `rider-fee-status.js` + parity 2 ทิศ; bkk-rider-app PR `handoverPatch` |
| ขอบเขต | ทั้ง 129 แถวรวม 8 แถว 3–4 ก.ย. | planner กลับทุก JOB_PAYOUT/CREDIT ของ OWNER ไม่ดูวันที่ |
| census | ห้ามเพิ่ม client write | ทุกการเขียนผ่าน callable/สคริปต์ |

