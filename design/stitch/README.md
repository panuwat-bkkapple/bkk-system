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

**ชุด GETMOBIE — เว็บ, flow สมัคร และการใช้งาน**

| ไฟล์ | หน้าจอ | screen ID |
|---|---|---|
| `landing.html` | GETMOBIE Wholesale Landing Page (หน้าแรก) | `47943c1c1fd141b081c9750e2c037563` |
| `onboarding.html` | Onboarding Carousel (เริ่มต้นการใช้งาน) | `5f51eb7fa9504f138ea28479a3150a80` |
| `login.html` | GETMOBIE Dealer Login | `b1475ccd8bfa4d088657155a7bc4491b` |
| `register.html` | Dealer Registration Form (ลงทะเบียนดีลเลอร์) | `468ae98ee45e407e86e7a0744f7653fe` |
| `application-status.html` | Application Status (สถานะการสมัคร) | `7306ebad010c4053bb0b51838db95265` |
| `documents-hub.html` | Documents Hub (คลังเอกสาร) | `3233000d3d3848f49de67e36f306297c` |
| `notifications.html` | Notification Center (การแจ้งเตือน) | `ebeeaf63d7e14d4a95b42a255d95d5ea` |
| `help-support.html` | Help & Support (ศูนย์ช่วยเหลือ) | `106be4ee3aeb413589f6c5660b863c82` |

แปดหน้านี้เดิมถูก generate ด้วย design system **ตัวที่สาม**
`assets/0a3f8f33dbf84f7fb3a2766a32457a1e` (`primary` `#004ac6` · Space Mono ·
การ์ด DS อยู่บน canvas ที่ `y=27716`) จึงสั่ง `apply_design_system` ด้วย
`assets/d22a51a3…` ให้เข้าชุดกับที่เหลือ

screen ID ด้านบนเป็นของหน้าที่ generate ใหม่ ไม่ใช่หน้าตั้งต้น — ยืนยันแล้วว่า
instance บน canvas ชี้มาที่ ID เหล่านี้ครบทั้ง 8

> **ข้อสังเกตจากการใช้ `apply_design_system`**
>
> ยิงหลายหน้าพร้อมกันในคำสั่งเดียว Stitch จะสร้าง screen ใหม่แต่ **ไม่ repoint
> instance บน canvas** ทำให้ canvas ยังโชว์ของเดิม ต้องยิง **ทีละหน้า** ถึงจะ
> repoint ให้ครบ

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
