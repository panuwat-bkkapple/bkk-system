# Stitch export — Wholesale Dealer Auction Portal

หน้าจอที่ export จากโปรเจกต์ Stitch `projects/17067141965117549720`
(ดึงเมื่อ 2 สิงหาคม 2026)

โปรเจกต์นี้มี design system **สองตัวที่ชื่อ "Core Ledger" เหมือนกันทั้งคู่**
ไฟล์จึงแยกโฟลเดอร์ตาม design system ที่ใช้จริง ไม่ใช่ตามชื่อ

## `modern/` — iWholesale Pro

design system `assets/d22a51a3e69d436bb434128c37d22e35`
Plus Jakarta Sans · `primary` `#000000` · glassmorphism · MOBILE 390px

**ชุด Dealer Portal**

| ไฟล์ | หน้าจอ | screen ID |
|---|---|---|
| `dashboard.html` | Dealer Dashboard (Modern) | `657457bd9247455f92699efc893df59f` |
| `lots.html` | Active Bidding Lots (Modern) | `945fa1642d51401cad6fa2a23cbf62cb` |
| `lot-detail.html` | Lot Details & Bidding (Modern) | `f2b51bc703234a799217b42756876591` |
| `orders.html` | Order Status & History (Modern) | `a2fef80626304c3c8394ba3e2696ba26` |
| `specs.html` | iPhone 15 Pro: Technical Specs & Hardware Grading (Modern) | `ff4e0d291a774be98cc6eb48a265cca3` |

**ชุด GETMOBIE — flow สมัครและเริ่มใช้งาน**

| ไฟล์ | หน้าจอ | screen ID |
|---|---|---|
| `onboarding.html` | Onboarding Carousel (เริ่มต้นการใช้งาน) | `2c5ea585856342b3bc4f64a2864ac0aa` |
| `login.html` | GETMOBIE Dealer Login | `79b18098de244a2795919c01d74a376d` |
| `register.html` | Dealer Registration Form (ลงทะเบียนดีลเลอร์) | `083570ef8f31492ca53b8a8bfae07448` |
| `application-status.html` | Application Status (สถานะการสมัคร) | `83abd11eea5d4314a12a449d5078eaac` |
| `documents-hub.html` | Documents Hub (คลังเอกสาร) | `cba840321eea4d4699ba789a9618d74e` |

ห้าหน้านี้เดิมถูก generate ด้วย design system ตัวที่สาม `assets/0a3f8f33dbf84f7fb3a2766a32457a1e`
(`primary` `#004ac6` · Space Mono) จึงสั่ง `apply_design_system` ด้วย `assets/d22a51a3…`
ให้เข้าชุดกับที่เหลือ — screen ID ด้านบนเป็นของหน้าที่ generate ใหม่ ไม่ใช่หน้าตั้งต้น

สเปก: [`modern/design-system.md`](./modern/design-system.md)

## `dealerportal/` — ElectroWholesale Pro

design system `assets/1509b1a6f2194039b9436ac973e85dda`
Hanken Grotesk · `primary` `#041627` · tonal layers · DESKTOP 2560px

| ไฟล์ | หน้าจอ | screen ID |
|---|---|---|
| `grading-standards.html` | Grading & Quality Standards | `f9c0f40b62ca4baa82aab5e3b814c667` |

สเปก: [`dealerportal/design-system.md`](./dealerportal/design-system.md)

---

## ข้อควรรู้ก่อนเปิดไฟล์

- **`modern/` เป็นจอ MOBILE** — Stitch พรีวิวที่ 390px แต่ในไฟล์มีคลาส `md:` / `lg:`
  เปิดเต็มจอ desktop แล้วคลาสพวกนี้จะทำงาน ได้ layout ที่ Stitch ไม่เคยแสดง
  ให้ย่อหน้าต่างเหลือ ~390px หรือใช้ DevTools โหมดมือถือ
  ส่วน `dealerportal/grading-standards.html` เป็น DESKTOP 2560px ดูเต็มจอได้เลย
- **ต้องต่อเน็ต** — ทุกไฟล์โหลด Tailwind จาก `cdn.tailwindcss.com` (compile ในเบราว์เซอร์),
  ฟอนต์จาก Google Fonts และไอคอนจาก Material Symbols ถ้าออฟไลน์สไตล์จะหายหมด
  และไอคอนจะแสดงเป็นคำ เช่น `architecture`
- **`modern/specs.html` มีบล็อกที่เพิ่มด้วยมือ** — section Schematics & Dimensions
  กู้มาจากหน้า Technical Product Specs (`0cf497ca65aa41d29fe70416b5607e5a`)
  ซึ่งเป็นที่เดียวที่ยังมีข้อมูลขนาดตัวเครื่อง ส่วนที่เหลือตรงกับ Stitch ทุกตัวอักษร
- **`borderRadius` ไม่ตรงสเปกทั้งชุด** — รายละเอียดอยู่ในไฟล์ design system ของแต่ละโฟลเดอร์

## ยังไม่ได้ export

หน้าจออื่นบน canvas ยังมีอีกมาก — ชุด DealerPortal เดิม (Dashboard, Lots, Lot Detail,
Orders, Order Tracking), หน้า desktop อย่าง Help & Support Center, Warranty Verification,
Notification Preferences และรูปประกอบ ดูผัง canvas เต็มได้จาก `get_project`
field `screenInstances`
