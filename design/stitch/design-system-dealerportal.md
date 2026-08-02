# Core Ledger (DealerPortal) — Design System

> **เอกสารนี้อธิบายไฟล์เดียวในโฟลเดอร์: `grading-standards.html`**
>
> โปรเจกต์ Stitch นี้มี design system **สองตัวที่ชื่อ "Core Ledger" เหมือนกันทั้งคู่**
> เอกสารนี้อธิบายตัวแรก `assets/1509b1a6f2194039b9436ac973e85dda` ซึ่งใช้กับชุดหน้าจอ
> **DealerPortal** (แถว y=0 และ y=2179 บน canvas)
>
> | ไฟล์ในโฟลเดอร์นี้ | design system |
> |---|---|
> | `grading-standards.html` | **ตัวนี้** (DealerPortal) — ทวนแล้วตรง 17/17 |
> | `dashboard` · `lots` · `lot-detail` · `orders` · `specs` | Modern / iWholesale Pro — ดู [`design-system.md`](./design-system.md) |
>
> ⚠️ `grading-standards.html` มี `borderRadius` เป็น `0.125 / 0.25 / 0.5rem`
> ซึ่งไม่ตรงกับสเปกในหัวข้อ [Shapes](#5-shapes) (`0.25 / 0.5 / 0.75rem`)
> และ `<title>` ใช้ชื่อแบรนด์ที่สาม **"ElectroWholesale Pro"**
> หน้าจอ `Grading & Quality Standards` · screen `f9c0f40b62ca4baa82aab5e3b814c667`
> · DESKTOP 2560×2048 · canvas `y=26436`
>
> `get_project` คืน `designTheme` มาแค่ตัวเดียว (ตัวนี้) และเพราะชื่อซ้ำกัน
> ชื่อจึงแยกไม่ออก ต้องดู `list_design_systems` หรือ `tailwind.config` ที่ inline
> อยู่ใน HTML แต่ละไฟล์เท่านั้น

Design system ของโปรเจกต์ Stitch **Wholesale Dealer Auction Portal**
(`projects/17067141965117549720`) · asset `assets/1509b1a6f2194039b9436ac973e85dda`

- **Color mode:** Light · **Color variant:** Fidelity
- **Brand seed color:** `#1a2b3c`
- **Roundness preset:** ROUND_FOUR (0.25rem) · **Spacing scale:** 2

---

## 1. Brand & Style

ระบบออกแบบสำหรับงาน wholesale ที่มีเดิมพันสูง เน้น **ความน่าเชื่อถือแบบมืออาชีพ
และประสิทธิภาพในการทำงาน** มากกว่าความสวยตามเทรนด์ สไตล์เป็น **Corporate / Modern**
คุณลักษณะเด่นคือความชัดเจนเชิงโครงสร้าง ลำดับชั้นที่เป็นระบบ และความหนาแน่นของข้อมูลสูง

บุคลิกแบรนด์คือ *authoritative และ reliable* ทำงานเหมือนเครื่องมือระดับ enterprise
กลุ่มเป้าหมายคือดีลเลอร์มืออาชีพที่ต้องการ workspace ซึ่งลด cognitive load
แต่ยังให้ข้อมูลครบสำหรับการตัดสินใจอย่างรวดเร็ว

---

## 2. Colors

### 2.1 Brand overrides

| บทบาท | ค่า | ใช้ตรงไหน |
|---|---|---|
| Primary | `#1a2b3c` | navigation หลัก, CTA หลัก, header หนัก ๆ |
| Secondary (Success) | `#27ae60` | สถานะ "Approved", จ่ายเงินสำเร็จ, ยืนยัน bid สำเร็จ |
| Neutral | `#4a5568` | โทนกลาง |
| Tertiary | `#f4f7f9` | พื้นหลังรอง / zebra striping |

### 2.2 Semantic tokens

**Primary**

| Token | Hex |
|---|---|
| `primary` | `#041627` |
| `on-primary` | `#ffffff` |
| `primary-container` | `#1a2b3c` |
| `on-primary-container` | `#8192a7` |
| `primary-fixed` | `#d2e4fb` |
| `primary-fixed-dim` | `#b7c8de` |
| `on-primary-fixed` | `#0b1d2d` |
| `on-primary-fixed-variant` | `#38485a` |
| `inverse-primary` | `#b7c8de` |

**Secondary (success green)**

| Token | Hex |
|---|---|
| `secondary` | `#006d37` |
| `on-secondary` | `#ffffff` |
| `secondary-container` | `#7bf8a1` |
| `on-secondary-container` | `#007239` |
| `secondary-fixed` | `#7efba4` |
| `secondary-fixed-dim` | `#61de8a` |
| `on-secondary-fixed` | `#00210c` |
| `on-secondary-fixed-variant` | `#005228` |

**Tertiary (near-black)**

| Token | Hex |
|---|---|
| `tertiary` | `#121617` |
| `on-tertiary` | `#ffffff` |
| `tertiary-container` | `#262a2c` |
| `on-tertiary-container` | `#8d9193` |
| `tertiary-fixed` | `#e0e3e5` |
| `tertiary-fixed-dim` | `#c4c7c9` |
| `on-tertiary-fixed` | `#181c1e` |
| `on-tertiary-fixed-variant` | `#434749` |

**Surface & background**

| Token | Hex |
|---|---|
| `background` / `surface` / `surface-bright` | `#f9f9ff` |
| `surface-container-lowest` | `#ffffff` |
| `surface-container-low` | `#f0f3ff` |
| `surface-container` | `#e7eeff` |
| `surface-container-high` | `#dee8ff` |
| `surface-container-highest` | `#d8e3fa` |
| `surface-dim` | `#cfdaf1` |
| `surface-variant` | `#d8e3fa` |
| `surface-tint` | `#4f6073` |
| `on-background` / `on-surface` | `#111c2c` |
| `on-surface-variant` | `#44474c` |
| `inverse-surface` | `#263142` |
| `inverse-on-surface` | `#ebf1ff` |
| `outline` | `#74777d` |
| `outline-variant` | `#c4c6cd` |

**Error**

| Token | Hex |
|---|---|
| `error` | `#ba1a1a` |
| `on-error` | `#ffffff` |
| `error-container` | `#ffdad6` |
| `on-error-container` | `#93000a` |

### 2.3 Status accents

ใช้เฉพาะกับ timeline / badge สถานะ เพื่อให้แยกออกจากกันชัดเจน

| สถานะ | สี |
|---|---|
| Pending | `#D97706` (amber) |
| Shipping | `#3182CE` (systematic blue) |
| Approved / Completed | `#27AE60` |
| Warning (timer < 5 นาที) | `#E53E3E` |
| Text charcoal | `#2D3748` |
| Border cool-grey | `#E2E8F0` |
| Canvas | `#F8FAFC` |
| Zebra stripe | `#F4F7F9` |

### 2.4 Dealer tier badges

โทน monochrome แนวโลหะ ตัวอักษรสีขาว · small caps · bold · radius 4px

| Tier | สี |
|---|---|
| Bronze | `#A8705C` |
| Silver | `#718096` |
| Gold | `#C6A34F` |
| Platinum | `#4A5568` |

---

## 3. Typography

ฟอนต์ 3 ตัว แบ่งหน้าที่ชัดเจน

- **Hanken Grotesk** — headline ทั้งหมด ให้ความรู้สึกคม ทันสมัย แบบผู้บริหาร
- **Inter** — body และ label ทุกชนิด เลือกเพราะอ่านง่ายมากในสภาพแวดล้อมข้อมูลหนาแน่น
- **JetBrains Mono** — เฉพาะตัวเลข, countdown timer, SKU เพื่อให้ตัวอักษรเรียงตรงกัน สแกนตัวเลขได้เร็ว

| Token | Font | Size | Weight | Line height | Letter spacing |
|---|---|---|---|---|---|
| `display` | Hanken Grotesk | 36px | 700 | 44px | −0.02em |
| `headline-lg` | Hanken Grotesk | 28px | 600 | 36px | — |
| `headline-lg-mobile` | Hanken Grotesk | 24px | 600 | 32px | — |
| `headline-md` | Hanken Grotesk | 20px | 600 | 28px | — |
| `body-lg` | Inter | 16px | 400 | 24px | — |
| `body-md` | Inter | 14px | 400 | 20px | — |
| `label-caps` | Inter | 12px | 700 | 16px | 0.05em |
| `data-mono` | JetBrains Mono | 13px | 500 | 18px | — |

> ใช้ **`label-caps`** (ตัวพิมพ์ใหญ่ + tracking กว้าง) กับ section header และหัวคอลัมน์ตาราง
> เพื่อสร้างการแบ่งเชิงโครงสร้างให้ต่างจากเนื้อหาอย่างชัดเจน

---

## 4. Layout & Spacing

ใช้โมเดล **Fixed Grid** สำหรับ desktop dashboard เพื่อให้ความหนาแน่นของข้อมูลคาดเดาได้
เนื้อหาจัดกึ่งกลางใน container 1440px บน 12-column grid

| Token | ค่า |
|---|---|
| `base` | 8px |
| `container-max` | 1440px |
| `gutter` | 24px |
| `margin-desktop` | 40px |
| `margin-mobile` | 16px |
| `stack-sm` | 4px |
| `stack-md` | 12px |
| `stack-lg` | 24px |

**Responsive grid**

| Breakpoint | Columns | Gutter | Side margin |
|---|---|---|---|
| Desktop | 12 | 24px | 40px |
| Tablet | 8 | 16px | 24px |
| Mobile | 4 | 16px | 16px |

ระยะแนวนอนเดินตามจังหวะ 8px — สำหรับตารางข้อมูลหนาแน่นลด padding แนวตั้งเหลือ
4px (`stack-sm`) ได้ ส่วน layout แบบการ์ด (เช่น Lot Card) ให้ใช้ 24px (`stack-lg`)
เพื่อการแยกทางสายตาที่ดีกว่า

---

## 5. Shapes

ภาษารูปทรงเป็นแบบ **Soft (0.25rem)** — ให้ความทันสมัยเล็กน้อยแต่ยังคงโครงสร้าง
เชิงเรขาคณิตที่มีวินัย เหมาะกับงาน B2B

| Token | ค่า |
|---|---|
| `rounded-sm` | 0.125rem |
| `rounded` (DEFAULT) | 0.25rem |
| `rounded-md` | 0.375rem |
| `rounded-lg` | 0.5rem |
| `rounded-xl` | 0.75rem |
| `rounded-full` | 9999px |

- **องค์ประกอบเล็ก** (ปุ่ม, input, checkbox) → 4px
- **องค์ประกอบกลาง** (Lot Card, status container) → 8px
- **Dealer Tier badge** → 4px เท่านั้น **หลีกเลี่ยงทรง pill** เพื่อคงภาษาแบบ "เครื่องมือมืออาชีพ"

---

## 6. Elevation & Depth

สื่อความลึกด้วย **Tonal Layers** ไม่ใช่เงาหนัก ๆ เพื่อรักษาความรู้สึกแบบ professional tool

1. **Level 0 (Canvas)** — พื้นหลังฐานใช้เทาอ่อนมาก `#F8FAFC` ลดอาการล้าตา
2. **Level 1 (Surface)** — การ์ดและ container หลักใช้ขาวล้วน `#FFFFFF` + เส้นขอบบาง 1px `#E2E8F0`
3. **Level 2 (Active/Hover)** — องค์ประกอบ interactive ใช้เงา ambient นุ่ม ๆ
   (Y: 4px, Blur: 12px, opacity 5% ของสี primary) เพื่อสื่อการยกตัวโดยไม่ดูเป็นของตกแต่ง
4. **Overlays** — modal ยืนยันการ bid ใช้ backdrop blur 20% + overlay navy กึ่งโปร่งใส
   เพื่อคงบริบทไว้ขณะโฟกัสความสนใจ

---

## 7. Components

### Lot Cards & Bidding
- **Countdown timer** ใช้ typography `data-mono` — ถ้าเวลาเหลือ **< 5 นาที** เปลี่ยนสีเป็นแดงเตือน `#E53E3E`
- **Secure Bidding Input** มี prefix icon (สัญลักษณ์สกุลเงิน) และปุ่ม "Place Bid" ฝังอยู่ใน suffix ของ field
  ต้องแสดง helper text `"Minimum Bid: $X.XX"` ด้วยขนาด `body-sm`

### Status Tracking Timeline
เส้นแนวนอนหรือแนวตั้งพร้อม node

- **Active node** — navy primary + วงแหวนรอบนอกแบบ pulsing
- **Completed node** — เขียว success + ไอคอน checkmark
- **Future node** — ขอบเทาอ่อน พื้นขาว

### Dashboard & Lists
- **Data table** — ใช้ zebra striping สลับแถวด้วย `#F4F7F9`
- **Header** — sticky header + เส้นขอบล่าง 1px และ elevation `Level 1` แบบบาง ๆ ตอน scroll
- **Primary button** — `#1A2B3C` ทึบ ตัวอักษรขาว **ห้ามใช้ gradient**

---

## ที่มา

Export จาก Stitch เมื่อ 2 สิงหาคม 2026 · โปรเจกต์ `17067141965117549720`
· design system `assets/1509b1a6f2194039b9436ac973e85dda` (version 1)
(`designTheme.designMd` + `designTheme.namedColors` / `typography` / `spacing` / `rounded`)
