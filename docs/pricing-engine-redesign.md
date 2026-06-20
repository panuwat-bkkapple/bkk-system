# Pricing Engine Redesign — Design Doc

> สถานะ: **ออกแบบ (ยังไม่ลงมือแก้ logic)** — รออนุมัติทิศทาง + เคาะ "จุดที่ต้องเคาะ" (§7) ก่อนเริ่ม implement
> ขอบเขต: เครื่องคิดราคารับซื้อ (trade-in) ข้าม 3 repo — `bkk-system` (แอดมิน), `bkk-frontend-next` (เว็บลูกค้า + server functions)
> เป็นเงินจริงข้าม repo → ทุกการแก้ต้อง "ครบวง" ทั้ง 3 ฝั่ง ไม่งั้นราคา quote / server / inspection หลุดกัน

---

## 1. ปัญหาที่ต้องแก้ (3 แกน อิสระต่อกัน)

| | ปัญหา | อาการ | สาเหตุราก |
|---|---|---|---|
| **A** | ของถูกถูกหักจน 0 | iPad 3,000 หักรอย 3,000 → 0 ทั้งที่ยังมีมูลค่า | deduction เป็น **บาทคงที่** แบ่ง 3 tier หยาบ — t3 คลุม base 1–14,999 |
| **B** | ของใหม่แยกอายุไม่ได้ | iPhone 17 ซื้อปีก่อน vs เดือนก่อน ราคาเท่ากัน | ไม่มี **แกนเวลา/ประกัน** — condition grading saturate (ทุกเครื่องแบต>90% + ประกันเต็ม) |
| **C** | engine แตกเป็น 3 ก๊อปปี้ ไม่ตรงกัน | แอดมินมี pct/liquidityFactor แต่ลูกค้า+server ไม่มี → ตั้ง pct เมื่อไหร่ราคาหลุด | logic คิดราคาถูก copy-paste แยก 3 ฝั่ง |

---

## 2. สถานะจริงของ engine วันนี้ (ground truth)

### 2.1 ฝั่งคิดราคา (3 ก๊อปปี้แยกกัน)

| ฝั่ง | ไฟล์ | สูตร | `pct`? | `liquidityFactor`? | floor |
|---|---|---|:---:|:---:|---|
| แอดมิน | `bkk-system/src/utils/pricingResolver.ts` (`resolveOptionDeduction` L64) | tier t1/t2/t3 ตาม bucket | ✅ | ✅ | `max(0)` |
| ลูกค้า | `bkk-frontend-next/app/sell/SellPageClient.tsx` `calculateCurrentPrice()` (L444-463 **และซ้ำที่ L518-524**) | tier เดียวกัน | ❌ | ❌ | บางส่วน |
| server | `bkk-frontend-next/functions/src/index.ts` `calculateDeductAmount()` (L204-206) | tier เดียวกัน | ❌ | ❌ | `max(0)` L524 |

**tier bucket ปัจจุบัน** (`tierDeduction` ใน pricingResolver):
`base ≥ 30,000 → t1` · `15,000–29,999 → t2` · `< 15,000 → t3` · แล้ว `× liquidityFactor` (เฉพาะแอดมิน) · รวมแบบบวกสะสม · `max(0, base − รวม)`

> **C ชัดเจน:** `pct` + `liquidityFactor` ทำงานเฉพาะแอดมิน — ลูกค้า/server ignore. แม้แต่ `liquidityFactor` วันนี้ก็ทำให้ราคาแอดมิน ≠ ลูกค้าอยู่แล้ว

### 2.2 branch serial lookup (`claude/sickw-version-check-brainstorm-nbL6B`, bkk-frontend-next)

ทำเสร็จแล้ว (input + matching + persist):
- `SerialLookup.tsx` → CF `lookupDeviceForQuote` (อยู่ใน **bkk-system**) → cache `device_checks/{imei}/svc_{id}.parsed`
- `app/utils/deviceMatcher.ts` แปลง SickW `model + capacity` → catalog model+variant (iPhone เฟส 1; ปรัชญา under-match กันราคาเพี้ยน)
- `functions/src/sickwQuote.ts` (`attachSickwSnapshotToJob`) copy snapshot ลง `jobs/{id}/sickw_check`
- คงทางเลือกรุ่นเองไว้คู่กัน (ลูกค้าเลือกได้)

**ช่องว่าง (engine ไม่กิน):**
- `deviceMatcher` ใช้แค่ `model + capacity` → คืน base
- `lookupInfo` พกแค่ `{ imei, modelId }` (SellPageClient L197) → **`warrantyStatus` / `estimatedPurchaseDate` / `activationStatus` ที่ SickW คืนมาแล้ว ถูกทิ้งก่อนคิดราคา**
- มี `deviceCondition: 'new' | 'used' | 'pending'` + path เครื่องใหม่ (L569 `newPrice − (receipt ? 0 : 500)`) อยู่แล้ว แต่ sealed/new เป็น manual select ยังไม่ผูก SickW `activationStatus`

### 2.3 ข้อมูล SickW ที่มีอยู่ (ใช้ทำแกน B ได้เลย)
จาก `sickwApi.ts`: `model, modelNumber, capacity, color, country, warrantyStatus, estimatedPurchaseDate, activationStatus, activationLock, fmiStatus, blacklistStatus, simLock, carrier`
— ปัจจุบันโชว์เฉย ๆ ในการ์ดแอดมิน (`SickwDeviceCheck`) ไม่เคยเข้าราคา

---

## 3. base anchoring (เคาะแล้ว)

| อายุรุ่น | ตั้ง base ยังไง | แกนเวลา (B) |
|---|---|---|
| ≤ 1 ปี | ราคาเครื่องประกันเต็ม/เพิ่งซื้อ | **decay ตามอายุ** ทำงานหนัก |
| > 1 ปี | ราคาตลาดปัจจุบัน (ไม่ใช่ราคาเปิดตัว) | นิ่งแล้ว decay น้อย/ไม่มี |

⚠️ ต้องจัดการ "จุดส่งต่อ 1 ปี" ไม่ให้ decay นับซ้ำตอน base เปลี่ยน fresh→market

---

## 4. Engine เป้าหมาย — 1 spec, mirror 3 ฝั่ง

```ts
resolvePrice({
  base,                 // จาก variant (serial-match หรือเลือกเอง)
  conditionSet,         // option = { fixedBaht, pct }      // A5 — เลิก tier
  selectedOptionIds,
  liquidityFactor,
  deviceCondition,      // 'new'(ซีล) | 'used'
  timeContext?,         // B2: { ageMonths | estimatedPurchaseDate, activationStatus, monthlyDecayPercent }
                        //     มาจาก SickW parsed; ไม่มี = ข้าม time-adjust
}): number
```

**สูตร**
```
deviceCondition === 'new'
   → base − fixedNewAdjust                      // ซีล: ข้ามหักสภาพ

else
   → max(0,
         base
         − Σ (fixedBaht + pct·base) · liquidityFactor    // A5 หักสภาพ
         − timeAdjust(base, timeContext)                 // B2 อายุ/ประกัน
     )
```

### 4.1 A5 — หักสภาพสูตรเดียว (`฿คงที่ + %`)
ทิ้ง tier t1/t2/t3. แต่ละ option ตั้ง 2 ช่อง:
- **`fixedBaht`** — flaw ที่ต้นทุน/ผลกระทบคงที่ (จอแตก, Face ID, แบต, ที่ชาร์จ/กล่อง)
- **`pct`** — flaw ที่ด้อยค่าตามมูลค่า (รอยขีดข่วน, บุบ, รุ่นนอก)

> เหตุผลต้องมี 2 ช่อง: "% ล้วน" พังกับ flaw ต้นทุนคงที่ (จอแตกซ่อม ~2,500 เท่ากันทุกเครื่อง — % จะ under บนเครื่องถูก, over บนเครื่องแพง)

### 4.2 B2 — time-value
`timeAdjust` จาก `estimatedPurchaseDate` → `ageMonths` → decay (เช่น `base × monthlyDecayPercent × ageMonths`, มี cap); `activationStatus = never activated` → sealed → `deviceCondition='new'`

### 4.3 Single source of truth
mirror สูตรเดียวกัน 3 ฝั่ง: `pricingResolver.ts` (แอดมิน) ↔ `SellPageClient.calculateCurrentPrice` (ลูกค้า) ↔ `functions/src/index.ts` `calculateDeductAmount` (server) + **golden test เวกเตอร์เดียวกันทั้ง 3** (รูปแบบเดียวกับ `normalizeStatus` mirror ใน email.js) — JS import TS ข้าม repo ไม่ได้ ต้อง mirror + ทดสอบ

---

## 5. ให้ engine กิน serial data ของ branch
1. `lookupInfo` ต้องพก `parsed` (warranty/purchaseDate/activation) ไม่ใช่แค่ `{imei, modelId}`
2. `activationStatus = never activated` → `deviceCondition='new'` อัตโนมัติ + ข้ามคำถามสภาพ
3. `estimatedPurchaseDate` → `ageMonths` → `timeAdjust`
4. ทางเลือกรุ่นเอง (ไม่มี serial) → ไม่มี `timeContext` → ข้าม decay → **(เคาะ §7)** ถาม self-report อายุ หรือโชว์ base เป็น "ราคาเริ่มต้น"
5. trust: serial ที่ quote = ประเมิน; server รัน engine ซ้ำตอนสร้างออเดอร์; แอดมิน verify ตอนตรวจ — ทั้ง 3 รัน engine ตัวเดียวกัน

---

## 6. ตัวอย่างคำนวณ (พิสูจน์ A5)

### 6.1 MacBook Air M1 — base 8,000 (ตกใน t3 เดิม)
| | ดีสุด | แย่สุด |
|---|---|---|
| ระบบเดิม (t3) | 8,000 | **0** (จริง −4,000) |
| A5 (cosmetic→%, ซ่อม→฿) | 8,000 | **1,900** |

แย่สุด A5: จอลึก 17% (1,360) + บุบ 13% (1,040) + Service Battery ฿2,500 + เครื่องเปล่า ฿1,200 = 6,100 → 8,000−6,100 = 1,900

### 6.2 iPhone 17 Pro Max — base 38,000 (t1 เดิม) + แกน B
| สถานะ | ราคา (decay สมมุติ 2.5%/เดือน) |
|---|---|
| ซีล ยังไม่เปิดใช้ | 38,000 |
| ซื้อ 1 เดือน | 37,050 |
| ซื้อ 11 เดือน | 27,550 |

ของแพงหักสภาพ ≈ เดิม (จอลึก 17% ≈ 5,100 ≈ เดิม 5,000) — A5 ไม่ทำให้ของแพงเพี้ยน; แก้เฉพาะของถูก + เพิ่มแกนเวลา

> ค่า % / ฿ / decay ทั้งหมด = ตัวอย่างที่เสนอ ปรับได้ทุกตัว

---

## 7. จุดที่ต้องเคาะก่อน implement
1. **ยืนยันสูตร A5** (`฿คงที่ + %`) แทน tier — และ **ทิ้ง tier ถาวร** (schema เปลี่ยน) โอเคไหม
2. **`liquidityFactor`** จะ mirror ไปลูกค้า+server ด้วยไหม (วันนี้แอดมินมี ลูกค้าไม่มี = ต่างกันอยู่แล้ว)
3. ทางเลือกรุ่นเอง (ไม่มี serial): self-report อายุ/ประกัน หรือโชว์ base เป็น "ราคาเริ่มต้น"
4. เส้น decay: linear / curve ชันช่วงแรก + cap + field `monthlyDecayPercent` ต่อรุ่น + จุดส่งต่อ 1 ปี
5. ผลรวมหัก: บวกตรง ๆ (ลง 0 ได้) หรือมี floor ขั้นต่ำ (เช่น ≥ X% ของ base)
6. SickW cost ตอน quote: cache `device_checks` มีแล้ว — ยืนยันกลยุทธ์ rate-limit/ปุ่มตรวจ

---

## 8. Rollout เป็นเฟส (ทุกเฟสไม่ merge จนอนุมัติ)
- **P1 — ยุบ engine + migrate (ไม่ขยับราคา):** สร้าง engine สูตรเดียว, แปลง `t1/t2/t3` → `fixedBaht` (pct=0) = ราคาเท่าเดิมเป๊ะ, golden tests lock, พอร์ตครบ 3 ฝั่ง + ลบโค้ดซ้ำ 2 ที่ใน SellPageClient → deploy ปลอดภัย
- **P2 — config:** จูน cosmetic เป็น % (งานแอดมินกรอก/seed) → ของถูกดีขึ้นแบบตั้งใจ
- **P3 — time-value:** เปิด `monthlyDecayPercent` ต่อรุ่น + ต่อ `estimatedPurchaseDate` จาก SickW (แอดมินก่อน แล้วลูกค้า)
- **P4 — sealed auto + self-report:** `activationStatus`→new อัตโนมัติ + คำถามอายุทางเลือกรุ่นเอง

---

## ภาคผนวก — ไฟล์อ้างอิง
- แอดมิน engine: `bkk-system/src/utils/pricingResolver.ts` (+ `pricingResolver.test.ts`)
- condition set schema/UI: `bkk-system/src/features/trade-in/utils/conditionSets.ts`, `components/pricing/DeductionTableView.tsx`, `modals/EngineSettingsModal.tsx`
- ลูกค้า engine: `bkk-frontend-next/app/sell/SellPageClient.tsx` (`calculateCurrentPrice`), `app/components/sell-flow/AssessmentFlow.tsx`
- server engine: `bkk-frontend-next/functions/src/index.ts` (`calculateDeductAmount`, `validateAndCreateOrder`)
- serial lookup (branch): `app/components/sell-flow/SerialLookup.tsx`, `app/utils/deviceMatcher.ts`, `functions/src/sickwQuote.ts`, CF `lookupDeviceForQuote` (bkk-system)
- SickW fields: `bkk-system/src/utils/sickwApi.ts`
