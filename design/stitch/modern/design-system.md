# Core Ledger (Modern / iWholesale Pro) — Design System

Design system ที่ไฟล์ HTML ทุกไฟล์ในโฟลเดอร์นี้ใช้จริง

- **โปรเจกต์:** Stitch — Wholesale Dealer Auction Portal (`projects/17067141965117549720`)
- **Asset:** `assets/d22a51a3e69d436bb434128c37d22e35` (version 1)
- **Color mode:** Light · **Color variant:** Fidelity
- **Brand seed color:** `#0f172a`
- **Roundness preset:** ROUND_EIGHT (0.5rem) · **Spacing scale:** 2
- **Fonts:** Plus Jakarta Sans (headline) · Inter (body) · JetBrains Mono (label/technical)

> **หมายเหตุสำคัญ** — โปรเจกต์นี้มี design system **สองตัวที่ชื่อ "Core Ledger" เหมือนกัน**
>
> | | asset | ใช้กับ |
> |---|---|---|
> | ตัวนี้ | `assets/d22a51a3…` | ชุด **Modern / iWholesale Pro** ← ไฟล์ในโฟลเดอร์นี้ |
> | อีกตัว | `assets/1509b1a6…` | ชุด **DealerPortal** — ดู [`../dealerportal/design-system.md`](../dealerportal/design-system.md) |
>
> `get_project` คืน `designTheme` มาแค่ตัวแรกเท่านั้น ต้องใช้ `list_design_systems`
> หรืออ่าน `tailwind.config` ที่ inline อยู่ในไฟล์ HTML ถึงจะเห็นตัวที่สอง

### ความครอบคลุม — ทวนกับไฟล์จริงแล้ว

เทียบ color token 20 ตัวของแต่ละไฟล์กับ design system ทั้งสองตัว:

| ไฟล์ | ตรงกับ Modern | ตรงกับ DealerPortal | `display-lg` |
|---|---|---|---|
| `dashboard.html` | 20 / 20 ✅ | 0 | 48px ✅ |
| `lots.html` | 20 / 20 ✅ | 0 | 48px ✅ |
| `lot-detail.html` | 20 / 20 ✅ | 0 | 48px ✅ |
| `orders.html` | 20 / 20 ✅ | 0 | 48px ✅ |
| `specs.html` | 20 / 20 ✅ | 0 | 48px ✅ |
<<<<<<< HEAD:design/stitch/modern/design-system.md
| `../dealerportal/grading-standards.html` | **0 / 17 ❌** | **17 / 17** | — |

> ⛔ **`grading-standards.html` ไม่ได้ใช้ design system ตัวนี้**
>
> ย้ายไปอยู่ `../dealerportal/` แล้ว เพราะเป็นของ **DealerPortal** เต็มตัว —
> Hanken Grotesk, `primary` `#041627`, `secondary` `#006d37`, `surface` `#f9f9ff`
> และ `borderRadius` `0.125 / 0.25 / 0.5rem` ซึ่งแคบกว่าทุกไฟล์
> อ่านสเปกที่ [`../dealerportal/design-system.md`](../dealerportal/design-system.md) แทน
=======
| `grading-standards.html` | **0 / 17 ❌** | **17 / 17** | — |

> ⛔ **`grading-standards.html` ไม่ได้ใช้ design system ตัวนี้**
>
> ไฟล์นี้อยู่ในโฟลเดอร์เดียวกันแต่เป็นของ **DealerPortal** เต็มตัว —
> Hanken Grotesk, `primary` `#041627`, `secondary` `#006d37`, `surface` `#f9f9ff`
> และ `borderRadius` `0.125 / 0.25 / 0.5rem` ซึ่งแคบกว่าทุกไฟล์
> อ่านสเปกที่ [`design-system-dealerportal.md`](./design-system-dealerportal.md) แทน
>>>>>>> origin/main:design/stitch/design-system.md
>
> `<title>` ของไฟล์ยังใช้ชื่อแบรนด์ที่สาม — **"ElectroWholesale Pro"** ไม่ใช่ทั้ง
> DealerPortal และ iWholesale Pro

> **`specs.html` เคยเป็นลูกผสม — แก้แล้ว**
>
> เวอร์ชันแรกที่ export มามีสีกลางค้างอยู่ที่ DealerPortal 10 ตัว และ `display-lg`
> เป็น 40px จึงสั่ง `apply_design_system` ด้วย `assets/d22a51a3…` ใหม่
>
> Stitch สร้าง screen resource ใหม่ **แล้วชี้ instance เดิมบน canvas ไปที่ใบใหม่**
> ตำแหน่ง `y=22183` จึงยังมีหน้าเดียว ไม่ได้ซ้ำซ้อนบน canvas
>
> | | screen ID | สถานะ |
> |---|---|---|
> | เดิม (ลูกผสม) | `653c6be88ed641738dcc6fd02f0971bc` | ยังมีอยู่เป็น resource แต่หลุดจาก canvas แล้ว |
> | **ใหม่ — ไฟล์นี้มาจากหน้านี้** | `ff4e0d291a774be98cc6eb48a265cca3` | อยู่บน canvas ที่ `y=22183` |
>
> instance บน canvas ยังใช้ id `653c6be8…` อยู่ แต่ field `sourceScreen` ชี้ไป
> `ff4e0d29…` — ถ้าดูแค่ instance id จะเข้าใจผิดว่ายังเป็นใบเก่า

### ข้อควรรู้ — `borderRadius` ในไฟล์ export ไม่ตรงกับสเปก

ทั้ง **5 ไฟล์** ประกาศ `borderRadius` ชุดเดียวกันคือ

```
DEFAULT: 0.25rem · lg: 0.5rem · xl: 0.75rem · full: 9999px
```

ซึ่ง **ไม่ตรงกับสเปกในหัวข้อ [Shapes](#5-shapes)** ที่กำหนดไว้ `DEFAULT: 0.5rem ·
lg: 1rem · xl: 1.5rem` (ROUND_EIGHT) ค่าที่ออกมาบังเอิญตรงกับค่า default ของ
Tailwind พอดี

เป็นลักษณะของ export ทั้งชุด ไม่ใช่ปัญหาเฉพาะไฟล์ใดไฟล์หนึ่ง — ทุกหน้าจึงมุมคม
เท่ากันหมด ยังดูเข้าชุดกัน แต่ถ้าจะเอาไปทำเป็น production ต้อง override
`borderRadius` ให้ตรงสเปกเอง

### `specs.html` มีบล็อกที่เพิ่มด้วยมือ

section **Schematics & Dimensions** ท้ายคอลัมน์ขวาของ `specs.html` ไม่ได้มาจาก
Stitch — กู้มาจากหน้า `Technical Product Specs`
(`0cf497ca65aa41d29fe70416b5607e5a`) ซึ่งเป็นที่เดียวที่ยังมีข้อมูลขนาดตัวเครื่อง
ส่วนที่เหลือของไฟล์ตรงกับ Stitch ทุกตัวอักษร

---

## 1. Brand & Style

ระบบออกแบบสะท้อนสภาพแวดล้อม B2B ระดับพรีเมียมที่เน้นประสิทธิภาพสูง ออกแบบมาเฉพาะ
สำหรับงานค้าส่งอุปกรณ์ Apple บุคลิกแบรนด์คือ *professional, precise และ sophisticated*
มุ่งสร้างความรู้สึกน่าเชื่อถือและการเข้าถึงแบบ exclusive

สุนทรียะคือ **Corporate Modern with Glassmorphic accents** — ใช้ whitespace คุณภาพสูง
เพื่อลด cognitive load ระหว่างจัดการสต็อกที่ซับซ้อน ขณะที่เลเยอร์กึ่งโปร่งใสให้ความรู้สึก
ถึงมิติและความทันสมัย อินเทอร์เฟซให้ความรู้สึกเบาแต่มีโครงสร้างมั่นคง ให้ความสำคัญกับ
ความชัดเจนและงานเก็บรายละเอียดระดับพรีเมียมมากกว่าการตกแต่งที่รกตา

---

## 2. Colors

### 2.1 Brand overrides

| บทบาท | ค่า | ชื่อเรียก |
|---|---|---|
| Primary | `#0f172a` | Indigo-950 |
| Secondary | `#10b981` | Emerald |
| Neutral | `#64748b` | Slate-500 |

**แนวทางการใช้**

- **Primary (Indigo-950)** — navigation หลัก, ปุ่ม action หลัก, หัวข้อสถานะสำคัญ
  ทำหน้าที่เป็น anchor คอนทราสต์สูงที่ยึดทั้ง UI ไว้
- **Surface (Slate-50)** — สีพื้นหลังหลัก เป็น off-white สะอาดตา ลดอาการล้าตาเมื่อเทียบกับ
  ขาวล้วน และช่วยขับ container ที่ซ้อนเป็นชั้น
- **Success / Highlights (Emerald + Electric Blue)** — Emerald สงวนไว้สำหรับสถานะสต็อก
  เชิงบวกและธุรกรรมสำเร็จ ส่วน Electric Blue ใช้กับ accent รอง, ลิงก์ และ focus state
- **Neutral (Slate-500/700)** — ข้อความรองและเส้นขอบ เพื่อคงลำดับชั้นแบบคอนทราสต์ต่ำ
  สำหรับข้อมูลที่ไม่ใช่สาระสำคัญ

### 2.2 Semantic tokens

**Primary**

| Token | Hex |
|---|---|
| `primary` | `#000000` |
| `on-primary` | `#ffffff` |
| `primary-container` | `#131b2e` |
| `on-primary-container` | `#7c839b` |
| `primary-fixed` | `#dae2fd` |
| `primary-fixed-dim` | `#bec6e0` |
| `on-primary-fixed` | `#131b2e` |
| `on-primary-fixed-variant` | `#3f465c` |
| `inverse-primary` | `#bec6e0` |

**Secondary (Emerald)**

| Token | Hex |
|---|---|
| `secondary` | `#006c49` |
| `on-secondary` | `#ffffff` |
| `secondary-container` | `#6cf8bb` |
| `on-secondary-container` | `#00714d` |
| `secondary-fixed` | `#6ffbbe` |
| `secondary-fixed-dim` | `#4edea3` |
| `on-secondary-fixed` | `#002113` |
| `on-secondary-fixed-variant` | `#005236` |

**Tertiary (warm amber)**

| Token | Hex |
|---|---|
| `tertiary` | `#000000` |
| `on-tertiary` | `#ffffff` |
| `tertiary-container` | `#271901` |
| `on-tertiary-container` | `#98805d` |
| `tertiary-fixed` | `#fcdeb5` |
| `tertiary-fixed-dim` | `#dec29a` |
| `on-tertiary-fixed` | `#271901` |
| `on-tertiary-fixed-variant` | `#574425` |

**Surface & background**

| Token | Hex |
|---|---|
| `background` / `surface` / `surface-bright` | `#f8f9ff` |
| `surface-container-lowest` | `#ffffff` |
| `surface-container-low` | `#eff4ff` |
| `surface-container` | `#e5eeff` |
| `surface-container-high` | `#dce9ff` |
| `surface-container-highest` | `#d3e4fe` |
| `surface-dim` | `#cbdbf5` |
| `surface-variant` | `#d3e4fe` |
| `surface-tint` | `#565e74` |
| `on-background` / `on-surface` | `#0b1c30` |
| `on-surface-variant` | `#45464d` |
| `inverse-surface` | `#213145` |
| `inverse-on-surface` | `#eaf1ff` |
| `outline` | `#76777d` |
| `outline-variant` | `#c6c6cd` |

**Error**

| Token | Hex |
|---|---|
| `error` | `#ba1a1a` |
| `on-error` | `#ffffff` |
| `error-container` | `#ffdad6` |
| `on-error-container` | `#93000a` |

---

## 3. Typography

กลยุทธ์ตัวอักษรสร้างสมดุลระหว่างบุคลิกกับประโยชน์ใช้สอย

- **Plus Jakarta Sans** — หัวข้อทั้งหมด ให้ลุคเป็นมิตรแต่ยังเรขาคณิตและดูมืออาชีพ
  ช่อง aperture กว้างกว่าเล็กน้อยทำให้หัวข้อดูทันสมัยและเข้าถึงง่าย
- **Inter** — ข้อความใช้งานทั้งหมด เพื่อความอ่านง่ายสูงสุดในทุกขนาด โดยเฉพาะในตาราง
  ข้อมูลหนาแน่นและสรุปคำสั่งซื้อ
- **JetBrains Mono** — เฉพาะ Serial Number, SKU และ IMEI การเลือก monospace
  ทำให้แยก `0`/`O` และ `1`/`l` ออกจากกันได้ ซึ่งสำคัญมากกับงานโลจิสติกส์ค้าส่ง

| Token | Font | Size | Weight | Line height | Letter spacing |
|---|---|---|---|---|---|
| `display-lg` | Plus Jakarta Sans | 48px | 700 | 1.2 | −0.02em |
| `headline-lg` | Plus Jakarta Sans | 32px | 700 | 1.25 | — |
| `headline-lg-mobile` | Plus Jakarta Sans | 24px | 700 | 1.3 | — |
| `headline-md` | Plus Jakarta Sans | 24px | 600 | 1.4 | — |
| `body-lg` | Inter | 18px | 400 | 1.6 | — |
| `body-md` | Inter | 16px | 400 | 1.5 | — |
| `body-sm` | Inter | 14px | 400 | 1.5 | — |
| `technical-id` | JetBrains Mono | 13px | 500 | 1 | 0.02em |
| `label-caps` | Inter | 12px | 600 | 1 | 0.05em |

---

## 4. Layout & Spacing

ใช้โมเดล **Fluid Grid** พร้อมระยะ "Stack" ที่ใจกว้าง เพื่อให้ได้ความรู้สึกพรีเมียม

| Token | ค่า |
|---|---|
| `unit` | 4px |
| `stack-sm` | 8px |
| `stack-md` | 16px |
| `stack-lg` | 32px |
| `stack-xl` | 64px |
| `gutter` | 24px |
| `margin-mobile` | 16px |
| `margin-desktop` | 48px |

**Responsive grid**

| Breakpoint | Columns | Gutter | Margin |
|---|---|---|---|
| Desktop | 12 | 24px | 48px |
| Tablet | 8 | 20px | — |
| Mobile | 4 | 16px | 16px |

- ใช้ `stack-lg` (32px) เป็นจังหวะแนวตั้งเริ่มต้นระหว่าง section หลัก เพื่อกันไม่ให้หน้าดูรก
- **Inventory view** — ใช้ `stack-sm` กับรายการที่หนาแน่น แต่ครอบ container ทั้งก้อน
  ด้วย padding `stack-lg` เพื่อคงลุค editorial ระดับสูงของพอร์ทัล

---

## 5. Shapes

ภาษารูปทรงเป็นแบบ **Rounded** เพื่อลดทอนความแข็งเชิงเทคนิคของพอร์ทัล

| Token | ค่า |
|---|---|
| `rounded-sm` | 0.25rem |
| `rounded` (DEFAULT) | 0.5rem |
| `rounded-md` | 0.75rem |
| `rounded-lg` | 1rem |
| `rounded-xl` | 1.5rem |
| `rounded-full` | 9999px |

- **องค์ประกอบมาตรฐาน** (ปุ่ม, input, chip) → radius ฐาน 8px
- **Container** — การ์ดใหญ่และ modal surface ใช้ 16px (`rounded-lg`) ถึง 24px (`rounded-xl`)
  เพื่อสร้างเอกลักษณ์ container ที่ทันสมัยและชัดเจน
- **Focus state** — ตามรัศมีของ container โดยเว้น offset 2px

---

## 6. Elevation & Depth

จัดการความลึกด้วยสองวิธีที่แยกจากกันชัดเจน

### 6.1 Glassmorphism
Navigation bar และ Card Header ใช้ backdrop filter (**blur 12px**) ร่วมกับพื้นขาว
กึ่งโปร่งใส (**opacity 70%**) สร้างเอฟเฟกต์ frosted glass ที่ให้ความรู้สึกเบาและทันสมัย

### 6.2 Soft Layered Shadows
เงาไม่ใช้ดำหนัก ๆ แต่ซ้อนเลเยอร์ opacity ต่ำของสี Primary (Indigo) เพื่อให้ได้แสงเรือง
ที่นุ่มและกระจายตัว

| ระดับ | ค่า |
|---|---|
| Level 1 (Cards) | `0px 4px 20px rgba(15, 23, 42, 0.04)` |
| Level 2 (Modals) | `0px 12px 40px rgba(15, 23, 42, 0.08)` |

---

## 7. Components

### Buttons
- **Primary** — Indigo-950 ทึบ ตัวอักษรขาว
- **Secondary** — ghost style ขอบ Electric Blue
- ทั้งหมดใช้ radius 8px พร้อม transition นุ่ม ๆ ตอน hover

### Input Fields
พื้น Slate-100 + ขอบ 1px Slate-200 — ตอน focus ขอบเปลี่ยนเป็น Electric Blue
พร้อม outer glow นุ่ม 4px

### Inventory Cards
หัวการ์ดเป็น glassmorphic สำหรับหมวดสินค้า ตัวการ์ดเป็นขาวสะอาดสำหรับสเปก
**Serial Number แสดงด้วย JetBrains Mono เสมอ**

### Status Chips
ทรง **pill** — สถานะ success ใช้พื้น Emerald อ่อน + ตัวอักษร Emerald เข้ม
ส่วน neutral/pending ใช้ Slate-100 + ตัวอักษร Slate-700

### Data Tables
แถวมี padding แนวตั้ง 16px แบบใจกว้าง ใช้ hover state Slate-50 บาง ๆ เพื่อไฮไลต์แถว

### Navigation Bar
แถบ glassmorphic ยึดด้านบนแบบ fixed มีเส้นขอบล่าง 1px สีขาว opacity 20%
เพื่อกำหนดขอบเขตให้ชัดเมื่อวางทับเนื้อหา

---

## หมายเหตุเรื่องการเปิดไฟล์ HTML

ไฟล์ทั้ง 5 เป็นจอ **MOBILE** (Stitch พรีวิวที่ 390px) แต่มี responsive class
`md:` / `lg:` อยู่ในไฟล์ — เปิดเต็มจอ desktop แล้วคลาสเหล่านี้จะทำงานหมด ได้ layout
ที่ต่างจากที่เห็นใน Stitch **ให้ย่อหน้าต่างเหลือ ~390px หรือใช้ DevTools โหมดมือถือ**

ไฟล์พึ่งพา CDN ภายนอก 3 แหล่ง — `cdn.tailwindcss.com` (compile ในเบราว์เซอร์),
Google Fonts (Plus Jakarta Sans / Inter / JetBrains Mono) และ Material Symbols
สำหรับไอคอน หากออฟไลน์ สไตล์จะหายทั้งหมดและไอคอนจะแสดงเป็นคำ เช่น `architecture`

---

## ที่มา

Export จาก Stitch เมื่อ 2 สิงหาคม 2026 · โปรเจกต์ `17067141965117549720`
· design system `assets/d22a51a3e69d436bb434128c37d22e35` (version 1)
ดึงผ่าน `list_design_systems` และทวนกับ `tailwind.config` ที่ inline อยู่ในไฟล์ HTML
