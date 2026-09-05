# CLAUDE.md - Project Context for Claude Code

## กฎ async-stop (อ่านก่อนเริ่มทุก turn)
- **คำสั่งเบรกจากผู้ใช้มาถึงระหว่าง turn ได้** — ทุกครั้งที่เริ่ม turn ใหม่ ให้เช็คก่อนว่าข้อความล่าสุดมีคำสั่งหยุด/เปลี่ยนทิศไหม
- **ถ้ามี:** งานที่ทำไปใน turn ก่อนหน้า **หลังจุดที่คำสั่งถูกส่ง** ถือเป็นงานที่ต้อง**รายงานและรอ confirm ก่อนต่อยอด** ห้ามเดินหน้าต่อเหมือนไม่มีอะไรเกิดขึ้น และห้าม revert ทิ้งเองด้วย — ให้ผู้ใช้ตัดสิน
- **ฝั่งผู้ใช้ (บันทึกไว้เพื่อให้ทั้งสองฝั่งเล่นตามกติกาเดียวกัน):** งานความเสี่ยงสูง — push, เปิด PR, merge, deploy, แตะ secret — ให้สั่งเป็น turn สั้นๆ ที่จบเร็ว เพื่อให้มีจุดเบรกถี่
- **ผลที่ตามมาสำหรับงานความเสี่ยงสูง:** อย่ารวบหลายอย่างไว้ใน turn เดียว จบให้ไวแล้วรายงาน ดีกว่าทำยาวแล้วพบว่ามีคำสั่งเบรกค้างอยู่กลางทาง

## ตัด branch ใหม่ต้อง `git fetch origin` ก่อนเสมอ
- **กฎ:** `git fetch origin main` **แล้วค่อย** `git checkout -B <branch> origin/main` — ห้ามใช้ `origin/main` ที่ค้างอยู่ในเครื่อง เพราะ ref ในเครื่องเก่าได้ทันทีที่มี PR อื่น merge ระหว่างทาง (เคสจริง ส.ค. 2026 ที่ bkk-frontend-next: ตัด branch จาก `origin/main` ที่ค้างอยู่ก่อน merge ไป 1 commit)
- **อันตรายจริงไม่ใช่สิ่งที่คิดตอนแรก:** ตอนเจอเข้าใจว่า squash merge จะย้อน fix ที่ merge ไปแล้วทิ้งเงียบๆ ซึ่ง**ผิด** — ทดสอบแล้ว (สร้าง branch จำลองจากฐานเก่าแล้ว `git merge --squash` เข้า main จริง) git ทำ three-way merge และเก็บเวอร์ชันของ main ไว้สำหรับไฟล์ที่ branch ไม่ได้แตะ
- **อันตรายที่แท้จริง: เทสผิดต้นไม้** — `tsc` เทส build ทั้งหมดรันบน tree ที่ไม่มีการแก้ล่าสุด แล้วไปรายงานตัวเลขที่ไม่ใช่ของโค้ดที่จะอยู่บน main จริง ถ้างานใหม่พึ่งพาสิ่งที่ commit ล่าสุดเปลี่ยน จะรู้ตอน merge ไปแล้ว (แตะไฟล์เดียวกัน = conflict ซึ่งดังพอ ตัวที่เงียบคือ semantic conflict)
- **ด่านอัตโนมัติ: `.githooks/pre-push`** — fetch แล้วเช็ค `git merge-base --is-ancestor origin/main HEAD` ถ้าฐานเก่าจะบล็อกการ push พร้อมบอกวิธีแก้. เปิดใช้อัตโนมัติผ่าน `prepare` script ตอน `npm install` (ตั้ง `core.hooksPath .githooks`) — **clone ใหม่ต้อง `npm install` ก่อน hook ถึงทำงาน** ซึ่งเป็นจุดอ่อนของ container ที่ clone สดทุกครั้ง. ไม่มีเน็ต/ไม่มี remote = ปล่อยผ่าน (hook ที่บล็อกงานตอนเน็ตหลุดจะสอนให้คนพิมพ์ `--no-verify` จนติดเป็นนิสัย). ตั้งใจข้ามจริงๆ: `git push --no-verify`
- **ด่านที่สอง: CI** (`.github/workflows/ci.yml`) — `pull_request` ของ GitHub checkout **ผลลัพธ์หลัง merge** ไม่ใช่ปลาย branch ตัวเลขจาก CI จึงเป็นของต้นไม้ที่จะมีอยู่จริงหลัง merge เสมอ แม้ฐานในเครื่องจะเก่า
- วิธีเช็คมือ: `git fetch origin main && git merge-base --is-ancestor origin/main HEAD` — exit 0 = ฐานทันสมัย, exit 1 = ฐานเก่า ผลเทสเชื่อไม่ได้
- เผลอตัดจากฐานเก่าไปแล้ว: `git fetch origin main && git reset --soft origin/main` แล้ว `git checkout origin/main -- <ไฟล์ที่ commit ใหม่แตะแต่เราไม่ได้แตะ>` จากนั้น**รันเทสใหม่ทั้งชุดก่อนรายงานตัวเลขใดๆ**

## ตรวจ NUL byte ก่อน commit ไฟล์ text (ด่านอัตโนมัติจับไม่ได้)
- **อาการ:** `git diff` ขึ้น `Bin 11924 -> 16119 bytes` แทน diff อ่านได้ / `grep` ตอบ `binary file matches` / `file` บอก `data` แทน `JavaScript source, UTF-8 text`
- **ทำไมต้องตรวจมือ:** NUL byte ตัวเดียวใน string literal **ผ่าน `node --check`, ผ่าน `tsc`, ผ่าน eslint, ผ่านเทส, รันได้ปกติ** — ไม่มีด่านอัตโนมัติตัวไหนจับได้ แต่ git จะถือว่าไฟล์เป็น binary ตั้งแต่นั้น **แปลว่า code review ของไฟล์นั้นตายถาวร** (เคสจริง ส.ค. 2026: `functions/search-overview.js` ตอนตั้งใจเขียนช่องว่างใน `` `${query} ${context}` `` แล้วได้ `\x00` แทน)
- **วิธีเช็ค:** ดูว่า `git diff --stat` ไม่มีคำว่า `Bin` หรือรัน `python3 -c "print(open(F,'rb').read().count(b'\\x00'))"` ต้องได้ 0 ทุกไฟล์ที่แก้
- **เสี่ยงสุดตอนไหน:** เขียนไฟล์ผ่าน heredoc/สคริปต์ที่มี escape ซ้อนกันหลายชั้น ไม่ใช่ตอนพิมพ์ในเอดิเตอร์

## Injection test — วินัยอยู่ที่ `bkk-frontend-next/CLAUDE.md` ไม่ได้ก๊อปมาไว้ที่นี่

- **อ่านที่นั่นก่อนลงมือ:** หัวข้อ "Injection test — วิธีพิสูจน์ว่าด่านของเราไม่ว่าง" ใน `bkk-frontend-next/CLAUDE.md` — วิธีทำ + กับดัก 6 ข้อ + ขั้นตอนบังคับ (commit checkpoint ก่อนเริ่มเสมอ) **ไม่ก๊อปเนื้อมาที่นี่โดยตั้งใจ** เพราะสองสำเนาของกฎเดียวกันคือของที่ drift ซึ่งเป็นสิ่งที่กฎในไฟล์นั้นเตือนไว้เอง
- **แต่ injection ส่วนใหญ่รันที่รีโปนี้** — เทสออฟไลน์อยู่ `functions/test/*.test.mjs` รันด้วย `node functions/test/<ชื่อ>.test.mjs` ไม่ต้องใช้ API key ไม่ต้องมี Firebase. CI (`ci.yml` job "Cloud Functions") วนด้วย glob **ไฟล์เทสใหม่จึงถูกหยิบไปรันเองโดยไม่ต้องแก้ workflow**
- **กฎ "commit checkpoint ก่อน injection เสมอ" โดนละเมิดเป็นครั้งที่สามแล้ว (5 ก.ย. 2569)** — รอบนี้ `git checkout -- employee-app/src` ตอนคืน injection กวาดงานที่ยังไม่ commit ทิ้งทั้งชุด (แก้ 8 ไฟล์หายหมด เหลือแค่ไฟล์ใหม่ที่ยัง untracked) แล้ว injection สองตัวถัดมา**เขียวเพราะเทสที่ควรจับมันถูกลบไปด้วย** ไม่ใช่เพราะด่านมีรู — **อาการนี้อ่านเหมือน "ด่านไม่ครอบ" เป๊ะๆ ซึ่งจะพาไปแก้ผิดที่** เจอ injection เขียวผิดคาดเมื่อไหร่ ให้เช็ค `git status` ก่อนสรุปว่าด่านมีรู
- **ตัวอย่างที่เขียนตารางผล injection ไว้ในหัวไฟล์แล้ว ใช้เป็นแบบได้:** `functions/test/search-models.test.mjs` — 8 ตัว รวมข้อที่ **ไม่มีอะไรจับได้** พร้อมเหตุผลว่าทำไมจึงบันทึกไว้ตรงๆ แทนที่จะแต่ง fixture ให้ดูเหมือนมีด่าน
- **กับดักที่เป็นของรีโปนี้โดยเฉพาะ — จำนวน seam ลอกจากฝั่งเว็บไม่ได้:** กฎเดียวกันฝั่ง `bkk-frontend-next` มักต้องการ seam เดียว เพราะ `rankQueryTokens` normalize ก่อน tokenize แล้วทุกกฎปลายทางตัดสินด้วย token ชุดนั้น. ฝั่งนี้กฎเดียวกันมักต้องหลาย seam เพราะมี**ทางเข้าที่อยู่เหนือจุด normalize** หลายทาง (`rankQueryTokens`, `normalizeForPin`, `modelLineMismatch`) — เคสจริง 1 ก.ย. 2569: `expandLineShorthand` ฝั่งเว็บถอด 3 ใน 4 seam ออกแล้วเทสยังเขียว แต่ฝั่งนี้ถอด seam ไหนก็แดง. **mirror ต้อง mirror *กฎ* ไม่ใช่ *จำนวนจุดที่เรียกกฎ*** — ลอกจำนวนมาเมื่อไหร่ได้สำเนาที่ไม่มีวันถูกเรียกฟรีๆ ทันที

## ผลพิมพ์ (print) — ด่านอัตโนมัติทุกตัวจับไม่ได้ ต้องวัดจาก PDF จริง (บทเรียน 3 ก.ย. 2569)

> ตระกูลเดียวกับ NUL byte ข้างบน: **โค้ดถูกทุกด่าน แต่ผิดบนกระดาษ** — `tsc` ผ่าน eslint ผ่าน เทส 320 ตัวผ่าน `vite build` ผ่าน CI เขียวครบทุกช่อง แล้วใบเสร็จออกมาผิดขนาดกระดาษ. เจอตอนไล่ตรวจใบเสร็จ POS (#650 → #653) **สองบั๊กในสามตัวไม่มีอะไรจับได้เลยนอกจากการสั่งพิมพ์จริง**

- **`@page { size: <length> auto }` เป็น CSS ที่ใช้ไม่ได้ และมัน "พัง" แบบเงียบที่สุด** — สเปกไม่ให้ผสม `<length>` กับ `auto` ในค่าเดียวกัน เบราว์เซอร์จึง**ทิ้งทั้ง declaration** แล้วตกไปใช้กระดาษเริ่มต้นของเครื่อง. ตั้ง "ความร้อน 80mm" ไว้แต่ได้ Letter กว้าง 215.9mm โดยไม่มี error ไม่มี warning วัดจริงด้วย Chromium headless:

  | เขียน | ได้จริง |
  |---|---|
  | `size: 80mm auto` | **215.9 × 279.4 mm** (Letter — ค่าถูกทิ้ง) |
  | `size: 80mm` | 80 × 80 mm (จัตุรัส ตัดหน้าใหม่ทุก 80mm) |
  | `size: 80mm 297mm` | 80 × 297 mm ✓ |

  **ต้องระบุสองความยาวเสมอ** ความสูงคือเพดานของกล่องหน้า ไม่ใช่ความยาวกระดาษที่ป้อนจริง (เครื่องม้วนตัดตามเนื้อ)
- **`@page` เป็นเจ้าของขนาดกระดาษที่เดียว ห้ามตรึงความกว้างที่ตัวกล่องซ้ำ** — กระดาษ 80mm หักขอบ 4mm สองข้างเหลือพื้นที่พิมพ์ 72mm การเขียน `width: 80mm` ไว้ด้วยทำให้เนื้อล้นออกไป 8mm. ปล่อย `width: 100%` แล้วให้ `@page` คุมกระดาษ
- **A4 ไม่ใช่สลิปที่ถูกยืด** — เอามาร์กอัปสลิป 72mm ไปวางบนหน้า 180mm แล้วป้ายกับตัวเลขจะไปเกาะขอบซ้าย-ขวาสุด ตาต้องกวาดข้ามกระดาษทั้งใบเพื่ออ่านคู่กัน. คนละกระดาษ = คนละ layout (`ThermalBody` / `A4Body` ใน `ReceiptTemplate.tsx`) **เจ้าของงานจับได้จากการเปิดดูหน้าจริง ไม่ใช่จากเทส**
- **`display` คุม "พื้นที่" · `visibility` คุม "หมึก" — ต้องคุมทั้งสองแกน (บทเรียน #655 → #656)** ซ่อนของที่ไม่พิมพ์ด้วย `visibility: hidden` ทำให้ของนั้นยังกินความสูงอยู่ จำนวนหน้าที่พิมพ์จึงมาจากความสูงของ**ทั้งหน้า** — พิมพ์บิลใบเดียวจาก `/sales-history` ได้ 3 หน้า ว่าง 2 หน้า. แต่พอเปลี่ยนเป็น `display: none` แล้วถอด `visibility: visible` ออกไปด้วย กลายเป็น 1 หน้า**ว่างเปล่า** เพราะหน้าโฮสต์มี print CSS ของตัวเองที่สั่ง `body * { visibility: hidden }` ทับใบเสร็จ. **แก้แกนเดียวคือเปลี่ยนบั๊กเป็นบั๊กอีกตัว**
- **หน้าที่โฮสต์ของที่จะพิมพ์เป็นส่วนหนึ่งของสัญญา ไม่ใช่ฉากหลัง** — ทั้ง**โครง DOM** (ยาวกี่หน้ากระดาษ ซ้อนอยู่ในโมดอลไหม) และ **`<style>` ของหน้านั้นเอง** (SalesHistory มี print CSS ของ Z-Read อยู่ตลอดเวลา และมันแข่งกับเรา). สิ่งที่จะพิมพ์ต้อง**ดึงตัวเองกลับมาให้เห็นเสมอ** (`visibility: visible !important` ทั้งตัวเองและลูก) ห้ามหวังว่าหน้าโฮสต์จะไม่ยุ่ง
- **วิธีวัด (ทำได้ในเครื่อง ไม่ต้องมีเครื่องพิมพ์):** SSR คอมโพเนนต์ด้วย `renderToStaticMarkup` + คอมไพล์ Tailwind ของจริงด้วย `npx tailwindcss` → เขียนเป็นไฟล์ HTML → Playwright `page.pdf({ preferCSSPageSize: true })` → อ่านขนาดหน้า/จำนวนหน้าด้วย `pdf-lib`
  - **วัด `getComputedStyle(...).visibility` ของสิ่งที่จะพิมพ์ด้วย ไม่ใช่แค่จำนวนหน้า** — **หน้าว่างก็นับได้ 1 หน้า** ซึ่งเป็นช่องที่บั๊ก #656 ลอดมาได้ทั้งที่ด่านเขียว
  - **ใช้ Chromium ที่ playwright ติดตั้ง หรือที่ image เตรียมมา ห้ามรัน `npx playwright install` ในคอนเทนเนอร์นี้** — เวอร์ชัน npm กับ build ที่ติดตั้งไว้ไม่ตรงกันเป็นปกติ ให้ไล่หาจาก `PLAYWRIGHT_BROWSERS_PATH` แล้วส่ง `executablePath` เอง (ใน CI ติดตั้งเฉพาะ chromium ได้ตามปกติ)
  - **`file://` ใช้ได้เฉพาะ HTML ที่ไม่มี module script** — ถ้า harness โหลด JS ผ่าน Vite จะโดน CORS บล็อกแล้วได้หน้าว่าง (เคยเสียเวลาไปหนึ่งรอบ) เสิร์ฟผ่าน `python3 -m http.server` ถ้าต้องมีสคริปต์
- **harness เขียวทั้งที่ของจริงพัง เกิดขึ้น 3 รอบติดในงานเดียว และทุกรอบสาเหตุเดียวกัน: ทดสอบในบริบทที่ไม่ใช่ของจริง**

  | รอบ | harness ขาดอะไร | ของจริงเป็นยังไง |
  |---|---|---|
  | 1 | โหลดผ่าน `file://` จน CORS บล็อก คอมโพเนนต์ไม่ได้ render | หน้าเปล่าก็ผ่าน เพราะเงื่อนไขคือ "1 หน้า" |
  | 2 | เรนเดอร์บนหน้าเปล่า ไม่มีโครง DOM ของหน้าโฮสต์ | พิมพ์จริงได้ 3 หน้า ว่าง 2 หน้า |
  | 3 | มีโครง DOM ของหน้าโฮสต์ **แต่ไม่มี `<style>` ของมัน** | พิมพ์จริงได้ 1 หน้า **ว่างเปล่า** |

  รอบ 2 กับ 3 หลุดถึงมือผู้ใช้ทั้งคู่ และรอบ 3 หลุดหลังจากสร้างด่านถาวรเพื่อกันเรื่องนี้ไปแล้วหนึ่งชั่วโมง — **ทุกครั้งที่เพิ่มบริบทเข้า harness แล้วมันแดง แปลว่าบริบทนั้นสำคัญ ให้เพิ่มต่อ ไม่ใช่พอใจว่าเขียวแล้ว**
- **มีด่านถาวรแล้ว: `src/components/receipt/receiptPrint.test.tsx`** (รันด้วย `npm test` ตามปกติ) สองชั้น — ชั้นสตริงตรวจกติกา `@page`/`width`/`min-height`/`display:none` ไม่ต้องใช้เบราว์เซอร์ · ชั้น PDF สั่งพิมพ์จริงแล้ววัด
  - **`REQUIRE_PRINT_CHECKS=1` ตั้งไว้ใน `ci.yml` แล้ว** ไม่มี Chromium = **สอบตก** ไม่ใช่ข้ามเงียบๆ (บนเครื่อง dev ที่ไม่มีเบราว์เซอร์ ข้ามได้พร้อมข้อความบอกเหตุผล). ห้ามถอด env นี้ออก — ด่านที่ skip ตัวเองเงียบๆ คือด่านที่ไม่มีใครรู้ว่ามันว่าง
  - **`npx playwright install --with-deps chromium` เป็นขั้นตอนหนึ่งของ job** เพิ่มเวลา ~25 วิ ทั้ง job อยู่ที่ ~90 วิ
  - injection ที่พิสูจน์แล้วว่าแดง: `size: 80mm 297mm` → `80mm auto` (แดง 4) · `width: 100%` → `80mm` (แดง 1) · ถอด `min-height: 0` (แดง 2) · ย้อนเป็น `visibility: hidden` (แดง 3) · ถอด `visibility: visible` (แดง 3)
- **ลบ assertion ที่ไปไม่ถึงบั๊กออกไปหนึ่งตัว อย่าเอากลับมา** — `scrollWidth - clientWidth` ถูกเขียนไว้กันเนื้อล้นพื้นที่พิมพ์ แต่มันวัด "เนื้อกับกล่อง" ขณะที่บั๊กคือ "กล่องกับหน้ากระดาษ" ซึ่ง Chromium ย่อให้พอดีเงียบๆ ถอด `width: 100%` ออกแล้วยังเขียว → ให้ชั้นสตริงคุมข้อนี้แทน
- **สิ่งที่วิธีนี้ยังพิสูจน์ไม่ได้:** พฤติกรรมของไดรเวอร์เครื่องพิมพ์จริง (ม้วนตัดตามเนื้อ หรือป้อนเต็มความสูงที่ประกาศ) — Chromium ยืนยันได้แค่กล่องหน้า ไม่ใช่กระดาษที่ออกจากเครื่อง
- **กดพิมพ์จริงหนึ่งครั้งก่อน merge ยังคุ้มกว่าอ่านผลเทสสิบบรรทัด** — ไม่ใช่คำพูดลอยๆ: บั๊ก 2 ใน 3 ตัวของงานนี้ถูกจับโดยเจ้าของงานกดพิมพ์บน production ขณะที่ CI เขียวครบทุกช่อง. **PR ที่แตะ print CSS ให้เปิด preview channel ของ PR นั้นแล้วสั่งพิมพ์ดูก่อน** (`/sales-history` → เลือกบิล → พิมพ์ใบเสร็จ) — เร็วกว่าและจับได้มากกว่าการรอ merge แล้วค่อยเจอ

## Project Overview
- **Project:** BKK System (Admin Panel สำหรับธุรกิจ Trade-in มือถือ)
- **Stack:** Vite + React 19 + TypeScript + Firebase (Realtime DB, Auth, Storage, FCM)
- **Repo:** panuwat-bkkapple/bkk-system
- **Branch:** main

## Related Repos (ห้ามแก้ไข repos อื่น)
- **bkk-frontend-next** — เว็บฝั่งลูกค้า (customer tracking, คนละระบบ)
  - **CANONICAL SOURCE FOR FIREBASE RULES**: `database.rules.json` และ `storage.rules` อยู่ใน repo นั้น repo เดียว — ห้าม recreate ใน repo นี้. ถ้าต้องแก้ rules ต้องไปแก้ที่ bkk-frontend-next แล้วรัน `firebase deploy --only database` หรือ `--only storage` จาก repo นั้น
- **BKK Rider** — แอป PWA สำหรับ rider (มีระบบ push notification แยกต่างหาก)

## Deployment
- **Platform:** Firebase Hosting (`bkk-apple-admin.web.app`)
- **CI/CD:** GitHub Actions (auto deploy on push to main)
- **Build:** ใช้ **GitHub Secrets** (ไม่ใช่ `.env` file) — ดู `.github/workflows/firebase-hosting-deploy.yml`
- **`.env` ไม่ถูก track แล้ว (ก.ย. 2569) — และห้าม commit กลับเข้ามา** `.gitignore` ครอบ `.env*` ยกเว้น `.env.example` · clone ใหม่ให้ `cp .env.example .env` แล้วเติมค่าเอง (ค่าฝั่ง build จริงมาจาก GitHub Secrets ทั้งหมด ยืนยันแล้วด้วยการ build โดยไม่มีไฟล์นี้บนดิสก์) · **ที่มา:** ไฟล์นี้ถูก commit มาตั้งแต่ initial commit พร้อมคีย์ Google Maps ตัวจริง ถูกลบและเติม `.gitignore` ที่ `03d8c3b` แล้ว **commit ถัดมา `41c0fdd` ถอดบรรทัดนั้นออกและ commit ไฟล์กลับเข้ามาในวันเดียวกัน** ค้างมา ~5.5 เดือนในรีโปที่ public — รายละเอียดเต็มที่ `bkk-frontend-next/docs/reports/2026-09-01-secret-history-audit.md`
- **Cloud Functions:** Deploy พร้อม Hosting ใน workflow เดียวกัน (region: asia-southeast1)
- **ต้องเช็ค GitHub Actions ผ่านก่อนบอกให้ user เทส** — ถ้า workflow fail = โค้ดใหม่ยังไม่ขึ้น
- **Secrets ที่ต้องมี:** VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_DATABASE_URL, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_VAPID_KEY, VITE_GOOGLE_MAPS_API_KEY, FIREBASE_SERVICE_ACCOUNT_BKK_APPLE_TRADEIN
- **Secrets (Cloud Functions):** THAILAND_POST_API_KEY, GOOGLE_MAPS_API_KEY, SICKW_API_KEY, RESEND_API_KEY, EMAIL_FROM, ORDER_NOTIFY_EMAIL (optional: EMAIL_REPLY_TO, CUSTOMER_TRACKING_BASE_URL) — ดู Order Confirmation Emails ด้านล่าง

## คิว deploy บน main — คนที่ merge ก่อนอาจไม่มี run ของตัวเองให้ดู (บทเรียน 4 ก.ย. 2569)
- **concurrency ของ `firebase-hosting-deploy.yml` (#675) ทำงานถูก: run ที่กำลัง deploy ไม่ถูกฆ่า** แต่ GitHub เก็บ *pending* ได้แค่ตัวเดียวต่อ group — push เข้า main ใบใหม่ระหว่างที่มีตัวรออยู่ = **ตัวที่รอถูก `cancelled` และถูกแทนที่** เกิดจริงคืนเดียว 3 รอบติด (#724 → #725 → #727 ถูกแทนที่หมด ขณะที่ ≥4 session merge ห่างกันไม่กี่นาที)
- **มันไม่ใช่ deploy ครึ่งๆ** — run ที่ถูกแทนที่มี **0 jobs** (ยังไม่เคยเริ่ม) และ run ที่รอดจะ deploy ทั้ง tree ที่รวมทุก commit ก่อนหน้า ของทุกคนจึงขึ้นครบ **แต่ commit ของคุณจะไม่มี run ของตัวเอง**
- **วิธียืนยันว่าของตัวเองขึ้นแล้ว:** หา run ล่าสุดที่ `completed/success` บน main แล้วเช็คว่า commit ของคุณเป็นบรรพบุรุษของ head ของ run นั้น — `git merge-base --is-ancestor <ของคุณ> <head ของ run>` — และดูสอง job โดยชื่อ (`Deploy Cloud Functions` + `Deploy Hosting (admin web app)`) ไม่ใช่ดูว่า "run ของฉันเขียวไหม" เพราะ run ของคุณอาจไม่มีอยู่
- **ข้อเสียที่ยังอยู่:** ถ้า run ที่รอดพัง จะแยกไม่ออกว่าของใครพัง — ยังไม่มีทางแก้ที่ถูกกว่าการ merge ห่างกัน

## push ถึงไรเดอร์ — data-only เสมอ และสวิตช์ต้องครอบทั้งสองรีโป (ก.ย. 2569)
- **`pushToRider` ถอด `notification` ออกแล้วย้าย title/body ลง `data` ก่อนส่งทุกใบ** (`functions/rider-push-payload.js` seam เดียว call site เขียนรูป `notification` ต่อไปได้) — ห้ามเอา `notification` กลับมา: SDK ฝั่ง SW (`@firebase/messaging`, `onPush`) จะ showNotification เองแล้ว**ยังเรียก** onBackgroundMessage ต่ออีก ผลคือไรเดอร์ได้สองใบ ใบที่สองเป็น "BKK Rider" เนื้อว่าง (เคยเป็นแบบนั้นจริงทั้ง 11 จุด — bkk-rider-app #148 ข้อ D, แก้ #685)
- **ผู้ส่ง push ถึงไรเดอร์มีสองราย** — `pushToRider` ที่นี่ กับ `sendToRider` ใน `bkk-rider-app/functions` (งานใหม่ · broadcast · แชท) ทั้งคู่ต้องอ่าน `settings/notifications` ช่อง `rider_push` — ฝั่งนั้นเพิ่งเริ่มอ่าน (#155) และ**หมวดของ type ฝั่งนั้น (`chat`/`job_status`/`broadcast_job`) อยู่ใน `EVENT_CATEGORY` ของ `functions/notification-settings.js` ที่นี่** เป็นต้นทาง มี MIRROR ที่ `bkk-rider-app/functions/src/notificationGate.ts` และเทสฝั่งนั้นอ่านไฟล์นี้มาเทียบตัวอักษร — แก้หมวดที่นี่ต้องแก้ที่นั่น
- **สถานะ token ของไรเดอร์ดูได้ที่ `/riders` (ป้ายข้างชื่อ + การ์ดในโมดอล) และ probe `rider_push_tokens` ใน `/system-health`** (#692) — อ่านจาก `riders/{id}/fcm_tokens/*.updated_at` + `fcm_updated_at` ที่แอปไรเดอร์เขียนอยู่แล้ว เกณฑ์ 7 วัน**ตัวเดียวกับการ์ดในแอปไรเดอร์** (`bkk-rider-app/src/utils/pushHealth.ts`) สามที่ต้องเห็นตรงกัน. MIRROR: `functions/rider-push-coverage.js` ↔ `src/utils/riderPushHealth.ts` ด่านเป็นเทสพฤติกรรม (TS test `require` สำเนา JS มารันบน fixture เดียวกัน)
- **"ปิดรับ" มีผลจริงแล้ว (เคาะ 4 ก.ย. 2569, bkk-rider-app #159)** — แอปไรเดอร์เขียน `riders/{id}/status: 'Offline'` เมื่อกดปิดรับ (`useRiderData.setPresence` + `utils/presence.ts` ที่นั่น) ตัวกรอง `status !== 'Offline'` ใน `DispatcherPage` ที่เขียนเผื่อไว้แต่ไม่เคยกรองใครออกจึงทำงานจริงตั้งแต่นี้ · จุดสีใน `RiderManagement` หายเมื่อปิดรับ · broadcast ข้ามคนที่ Offline. **presence ยังบอกได้แค่ทางเดียว**: `Offline` = ปิดรับแน่ ส่วน Online/Busy ค้างได้เมื่อปิดแอปโดยไม่กดปิดรับ ห้ามใช้ Online/Busy กรองว่า "กำลังเปิดรับอยู่". ไม่ใช้ `onDisconnect` — iOS ตัดการเชื่อมต่อทุกครั้งที่พับ PWA ไรเดอร์ที่ขี่อยู่โดยล็อกหน้าจอจะหายจากรายชื่อทั้งที่เปิดรับอยู่

## Cloud Functions env vars (กับดักที่กัดมาแล้ว)
- **`functions/.env` = ที่ที่ env var ทุกตัวถูกประกาศตอน deploy** (แต่ละ function เป็น Cloud Run service ของตัวเอง ตัวที่ไม่ได้ deploy ไม่กระทบกัน)
- `.env` ถูก gitignore → CI เขียนขึ้นจาก GitHub Secrets ที่ step "Create Functions .env" ใน `firebase-hosting-deploy.yml` (THAILAND_POST_API_KEY, GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_BROWSER_KEY, SICKW_API_KEY, RESEND_API_KEY, EMAIL_FROM, ORDER_NOTIFY_EMAIL, EMAIL_REPLY_TO, CUSTOMER_TRACKING_BASE_URL, TELEGRAM_*, ANTHROPIC_API_KEY, CHAT_AI_MODEL, MIGRATION_API_KEY)
- **deploy ด้วยมือจาก clone ที่ไม่มี `.env` — สังเกตแล้วว่า env var ที่ตั้งไว้เดิม "ไม่" ถูกล้าง** (30 ก.ค. 2026: deploy มือ 13:02 UTC → งาน 13:29 ยังขึ้น `rider_fee_estimate ... (calculated, 0 km)` = ยังมีคีย์ Routes API อยู่). อย่าอนุมานเกินหลักฐานนี้ทั้งสองทาง — ยังไม่ได้ทดสอบเคส env var ที่ตั้ง**ครั้งแรก** จาก clone ที่ไม่มี `.env`. ทางที่ปลอดภัยยังเป็นให้ CI deploy (push main) เพราะ `.env` ถูกเขียนจาก secrets ครบทุกตัวแน่นอน
- **วิธีเช็คว่าคีย์ Maps ยังใช้ได้จริง** (ไม่ต้องเดาจาก config): `firebase functions:log --only onNewTicketCreated -n 30` แล้วดู `reason` ในบรรทัด `rider_fee_estimate` — `calculated` = Routes API ตอบจริง, `routes_api_*` = คีย์/เน็ตมีปัญหา, `missing_customer_coords` = งานไม่มีหมุด (ปกติสำหรับ Store-in/Mail-in)

## Mobile App (PWA)
- **URL:** `bkk-apple-admin.web.app/mobile`
- **ใช้งานบน iOS** ผ่าน Add to Home Screen (PWA standalone mode)
- **Push Notification:** ใช้ Firebase Cloud Messaging (FCM) + Service Worker (`firebase-messaging-sw.js`)
- **iOS Push:** ต้อง Add to Home Screen + Grant permission จาก PWA context
- **VAPID Key:** ต้องตั้งค่าใน GitHub Secrets (ไม่ใช่แค่ .env)

## Firebase Database Paths
- **`jobs/`** — ข้อมูล ticket/job ทั้งหมด (ห้ามฝัง blob โต ๆ เพิ่ม — ทุก byte คูณด้วยทุกคนอ่าน)
- **`job_chats/{jobId}/`** — ข้อความแชทของงาน (ย้ายออกจาก `jobs/{id}/chats` เพื่อลดค่า download RTDB). ตัว job มีแค่ `chat_flags` (`unread_from_admin/rider/customer`, `last_at`) ที่ cloud function (`onJobChatMessageV2`/`onChatMessageCreated`) เซ็ตให้ badge อ่าน — client อ่าน/เขียนผ่าน helper `src/utils/jobChats.ts` (mirror ใน bkk-rider-app; frontend inline ใน `RiderChatModal`) ซึ่ง dual-read path เก่า+ใหม่ช่วงเปลี่ยนผ่าน. migration ครั้งเดียว: `migrateOldJobs?action=move-chats` (รันหลัง deploy rules + ทุก client; **ทุก action ของ `migrateOldJobs` ต้องแนบ shared secret** — header `x-migration-key` หรือ `?key=` เทียบกับ env `MIGRATION_API_KEY`, ไม่ตั้ง = endpoint ปิดสนิท 503). archive จะ fold แชทกลับเข้า `jobs_archived/{id}/chats`
- **`jobs_archived/`** — งานเก่าที่ archive แล้ว (>90 วัน)
- **`admin_fcm_tokens/{staffId}/{tokenKey}`** — FCM tokens ของ admin สำหรับ push notification
- **`riders/{riderId}/fcm_token`** — FCM token ของ rider
- **`inbox/`** — ข้อความ inbox (unreadCount)
- **`models/`** — ข้อมูลรุ่นสินค้า (PriceEditor)
- **`series/`** — series ของสินค้า
- **`staff/`** — ข้อมูลพนักงาน (role, email, status)
- **`settings/condition_sets/`** — ชุดเงื่อนไขสำหรับประเมินราคา

## Key Architecture
- **Admin Layout:** `/src/components/layout/AdminLayout.tsx` (desktop sidebar)
- **Mobile Layout:** `/src/pages/mobile/MobileLayout.tsx` (bottom tab bar)
- **Routes:** `/src/App.tsx` (React Router v7)
- **Cloud Functions:** `/functions/index.js` (new ticket, chat, status change notifications)
- **Push Hook:** `/src/hooks/useAdminPushNotifications.ts`
- **Service Worker:** `/public/firebase-messaging-sw.js` (hardcoded Firebase config ไม่ใช้ env)
- **Settings Hub:** `/settings` (`src/pages/settings/SettingsHub.tsx` การ์ดจัดกลุ่ม + `SettingsLayout.tsx` เมนูซ้าย Company/Basic/Advanced ครอบหน้าตั้งค่า) — โครงเมนู+role ทั้งหมดอยู่ที่ `src/pages/settings/settingsNav.tsx` ที่เดียว: เพิ่มหน้าตั้งค่าใหม่ = เพิ่ม entry ที่นั่น + route ใน App.tsx (ใต้ `<SettingsLayout>` ถ้าไม่ใช่หน้า immersive; `/pricing` เป็น immersive อยู่นอก layout). URL ตั้งค่าเดิมทุกตัวคงเดิม
- **Ticket Creation:** `/src/features/trade-in/TradeInDashboard.tsx`
- **Instant Sell:** `/src/features/trade-in/components/InstantSellModal.tsx`
- **PriceEditor:** `/src/features/trade-in/PriceEditor.tsx`
- **Desktop Notifications:** `/src/components/layout/NotificationCenter.tsx`
- **Mobile Notifications:** `/src/pages/mobile/MobileNotificationsPage.tsx`
- **Notification Settings:** `/notification-settings` (ดู section สวิตช์การแจ้งเตือน)

## Job/Ticket Statuses
- **โค้ดใหม่ห้ามเทียบ status ด้วย string literal** — เขียนด้วย `JOB_STATUS.*` และอ่านค่าจาก DB ผ่าน `normalizeStatus(raw, receiveMethod)` ก่อนเทียบเสมอ (`src/types/job-statuses.ts` — ไฟล์ mirror 3 repo). เหตุผล: DB มีแถว legacy spelling (`Active Leads`, `Waiting for Handover`, `Sent to QC Lab`, `PAID` ฯลฯ) **ถาวร** จากงานที่ปิดไปแล้ว — `LEGACY_ALIAS` จึงเป็นของถาวร ไม่ใช่ scaffolding. ตัวเทียบ literal เดิม ~245 จุดให้ย้ายเมื่อแตะไฟล์นั้นด้วยเหตุอื่น (ตัวอย่างที่ย้ายแล้ว: `jobListPhaseOf`, `isRecededStatus`). `JobStatusB2C` enum ใน `domain.ts` ถูกลบแล้ว (ส.ค. 2569 — deprecated + สมาชิกไม่มีใครใช้); `JobStatusB2B` ยังอยู่ (track แยก ยังไม่ redesign)
- **B2C Normal:** สร้างด้วย status `"New Lead"`
- **Instant Sell:** สร้างด้วย `JOB_STATUS.ACTIVE_LEAD` = `"Active Lead"` เอกพจน์ (ข้ามขั้นตอนขาย) — เอกสารนี้เคยเขียนว่า `"Active Leads"` พหูพจน์ซึ่งเป็นค่า legacy ที่ writer เลิกเขียนแล้ว แต่ยังอยู่ใน DB เก่าและ notification triggers ต้องรับทั้งคู่
- **B2B:** สร้างด้วย status `"New B2B Lead"`
- **B2B Unpacked:** child items สร้างด้วย status `"Pending QC"`
- **Notification triggers ต้องครอบคลุมทั้งค่าใหม่และ legacy (New Lead, Active Lead, Active Leads, New B2B Lead)**

## Status engine — ทุกการเปลี่ยนสถานะงานต้องผ่าน `transitionJob` (ก.ย. 2569)

> ก่อนหน้านี้ทุกหน้าจอเขียน `update(ref(db, 'jobs/'+id), { status: X })` เอง ไม่มีตารางบอกว่าสถานะไหนไปสถานะไหนได้ และ RTDB rules ไม่ตรวจฟิลด์นี้เลย — ไรเดอร์เขียน `"Paid"` ทับ `"New Lead"` ได้ สิ่งเดียวที่กันอยู่คือ "ไม่มีปุ่มให้กด" ซึ่ง React tree ที่ค้าง แท็บที่สอง หรือการเรียก callable ตรงๆ เดินผ่านได้หมด

- **ไฟล์ที่เป็นเจ้าของกติกา:** `functions/status-engine.js` (ตาราง `TRANSITIONS` + `decideTransition` — pure ไม่มี I/O) · `functions/status-apply.js` (`applyTransition` — transaction + `status_version` + `status_history` + mirror ลง `qc_logs`) · `functions/status-transition-api.js` (callable `transitionJob` — role มาจาก auth token ไม่ใช่จาก body)
- **ฝั่งไคลเอนต์มีประตูเดียว: `src/utils/runJobTransition.ts`** (คืนผลลัพธ์ **ไม่ throw**) และคำศัพท์อยู่ที่ `src/utils/jobTransitions.ts` (`JOB_EVENT` + `transitionErrorMessage`) — **ห้าม `httpsCallable('transitionJob')` ตรงที่อื่น**
- **ปุ่มส่ง "สิ่งที่เกิดขึ้น" ไม่ใช่ "สถานะที่อยากได้"** — ปลายทางเป็นเรื่องของตาราง ที่เดียว ถ้าเห็นโค้ดรูป `handleUpdateStatus(สถานะ, รายละเอียด)` นั่นคือรูปเก่า **ห้ามสร้างใหม่**
- **สามแกน ไม่ใช่แกนเดียว:** `status` (อยู่ตรงไหนของ flow) · `custody` (ใครถือเครื่องอยู่) · `paid_at` (ประทับครั้งเดียว โดย event เดียว ตาม `SIDE_EFFECT_OWNER`)
- **ฟิลด์ของ engine ห้ามส่งมาใน `patch`** (`ENGINE_OWNED`: status, custody, status_version, status_history, paid_at, refunded_at, **qc_logs**) — ส่งมาจะโดน `patch_conflict`. อยากได้ข้อความในไทม์ไลน์ให้ส่ง `reason` engine เขียนแถวให้เอง
- **แก้ from-list ให้ "ขยาย" เสมอ ห้ามหด** — ปุ่มที่วันนี้กดได้ต้องกดได้ต่อไป ถ้าเงื่อนไขปุ่มหลวมเกินไป **ให้ไปรัดที่ปุ่ม ไม่ใช่หด from-list** (หดแล้วปุ่มพังเงียบๆ โดยไม่มีใครแก้ปุ่ม)
- **สองสาย ใช้สถานะร่วมกัน 5 ตัว** (Following Up, Negotiation, Paid, In Stock, Completed) — แถวของสาย B2B จึงมี `jobTypes` เป็นตัวกั้น **opt-in รายแถว**: แถวขายปลีกไม่มีและห้ามใส่ เพราะงานเก่าบน production ไม่มีฟิลด์ `type` เลย บังคับเมื่อไหร่พังทันที
- **`methods` ใช้กับสาย B2B ไม่ได้** — ล็อตแม่ไม่มี `receive_method` ที่ enum รู้จัก (ฟอร์มเว็บองค์กรเขียน `Corporate Pickup`, ดีลที่แอดมินสร้างไม่เขียนอะไรเลย, งานลูกเป็น `Corporate Bulk`)
- **จ่ายเงินลูกค้า = callable `confirmPayoutTransfer` (`functions/payout-transfer.js`, 4 ก.ย. 2569)** — writer สถานะตัวสุดท้ายที่ย้ายจากไคลเอนต์ (`src/utils/payoutTransfer.ts` ถูกลบ; สองจอจ่ายเงินเรียก `src/utils/confirmPayoutTransfer.ts`) เดิมมันเขียนสถานะ + แถว ledger ใน update() ก้อนเดียวและเป็นตัวเดียวที่ยังเขียนสะกดเก่า ('Waiting for Handover' / 'Payment Completed')
  - **ลำดับ transition → ledger โดยตั้งใจ** (RTDB transact ข้าม sibling ไม่ได้): transition ถูกปฏิเสธได้ด้วยเหตุผลธุรกิจ (สถานะผิด / จ่ายซ้ำ / ยอดเปลี่ยน / ไม่มีสิทธิ์) และตอนนั้นยังไม่มีอะไรถูกเขียน · ledger ล้มได้เฉพาะ infra → ได้ "จ่ายแล้วไม่มีแถวบัญชี" ซึ่งตัวนับ orphan ของ `Finance.tsx` + แท็บ `TransactionRepair` จับอยู่แล้ว (#710 ทำให้สองตัวนั้นอ่านสะกด canonical ได้ — **ต้อง merge ก่อน cutover** และได้ merge แล้ว) · callable คืน `ledgerWritten:false` ไม่ throw หลังสถานะเปลี่ยน (error หลังเงินออก = แอดมินกดซ้ำ)
  - **guard ในธุรกรรม** (`payoutGuard` ใน `functions/payout-ledger.js`): จ่ายซ้ำ (`paid_at` หรือ `payment_slip` มีแล้ว → `already_paid`) และ **ยอดเปลี่ยน** — จอส่ง `expectedNetPayout` = เลขที่คนกดเห็น server คิด `netPayoutOf` จากแถวจริงในธุรกรรม ไม่ตรง (ปัดบาท) = `amount_changed` ไม่ใช่โอนตามเลขเก่า. สูตรยอดสุทธิ MIRROR: `src/utils/payoutNet.ts` ↔ `netPayoutOf` และ `src/utils/logisticsRevenue.ts` ↔ สำเนาใน payout-ledger.js — ด่าน `src/utils/payoutNet.test.ts` รันสองฝั่งบน fixture เดียวกัน
  - **actor = FINANCE ตามผล `payoutGateVerdict`** (mirror ของ `evaluateFinanceGate` + role FINANCE) ไม่ใช่ role ดิบ — แถว `payment_confirmed`/`b2b_payment_confirmed` ระบุ actors: [FINANCE] แปลว่า "ผ่านด่านจ่ายเงินออก" ซึ่ง CEO ผ่านเสมอ และ MANAGER/STAFF ผ่านตราบใดที่ `settings/finance_gate/enforce` ยังปิด (เท่ากับหน้าจอวันนี้; ใช้ role ดิบ = MANAGER โดน wrong_actor ทั้งที่จอให้กด)
  - **สิ่งที่เปลี่ยนสำหรับคนอ่าน `qc_logs.action`:** engine เขียน action = สถานะปลายทาง — B2C ได้ `'Waiting For Handover'` ไม่ใช่ `'Paid'` (`'Paid'` โผล่ตอนไรเดอร์ส่งมอบ) และ B2B ได้ `'Paid'` ไม่ใช่ `'Payment Completed'`. reader สามตัวที่เคยหา 'Paid' (`MobileTicketDetail.wasPaid` / `qcStation.isJobAlreadyPaid` / `CEODashboard`) ย้ายไปอ่าน **`paid_at` ก่อนแล้วค่อย log** ผ่าน `src/utils/paidTrail.ts` — reader ใหม่ที่อยากรู้ว่า "จ่ายแล้วไหม" ใช้ตัวนั้น ห้ามสแกน action เอง. ฟิลด์ `evidence_url` ใน qc_logs หายไป (ไม่มีใครอ่านใน 3 รีโป สลิปอยู่ `payment_slip` เหมือนเดิม)
  - ขา B2B: `paid_at` ยังประทับโดย trigger `onAdminJobStatusNotify` ตอนเข้า Paid (registry ให้ `payment_confirmed` ประทับตัวเดียว) — ช้ากว่าสถานะหลักร้อย ms เท่ากับพฤติกรรมของ `admin_marked_paid`
- **ตัวที่ยังไม่ผ่าน engine และเป็นการตัดสินใจ ไม่ใช่การลืม:**
  - `unpack_to_stock` ใน `B2BManager` — เขียนสถานะงานแม่ + **สร้างงานลูกรายเครื่อง** ในก้อนเดียวกัน (ล็อตที่ปิดแล้วแต่เครื่องไม่โผล่ที่ไหนเลย แย่กว่าไม่ทำทั้งคู่). event `b2b_unpacked_to_stock` มีในตารางแล้วแต่**ยังไม่มีผู้เรียก** — ปลดล็อกได้เมื่อการสร้างงานลูกย้ายไปฝั่ง server
  - `Reserved` (dropdown หน้าคลัง) — **ไม่มีคู่ canonical ให้ alias ไปหา** map ไป In Stock จะกลืนความหมายที่หน้าคลังใช้จริง ทางแก้คือเพิ่มเข้า enum = แก้ 3 repo พร้อมกัน **เป็นการตัดสินใจที่ยังไม่เคาะ**
- **`src/utils/statusWriterCensus.test.ts` คือราวกันตก** — นับ *ทุก* การเขียน `jobs/{id}` ตรง (ไม่ใช่แค่ที่มี `status:`) เพดานลดได้ ขึ้นไม่ได้. **ตัวเลขที่ไม่ขยับไม่ได้แปลว่าไม่มีความคืบหน้า** — ปุ่มที่เรียกผ่าน prop หรือผ่านฟังก์ชันกลางไม่ถูกนับ (P2-h ย้าย 3 จุดแล้วเลขนิ่ง, P3-c ย้าย 12 ปุ่มแล้วเลขขยับ 3)

## บทเรียน: การผูก "ปุ่ม -> event" ที่อยู่ใน onClick คือของที่เทสมองไม่เห็น (4 ก.ย. 2569)

- **เคสจริง (P3-c):** injection สลับ event ของปุ่ม "จ่ายงานให้ผู้ตรวจ" ไปเป็นของ "ส่ง Pre-Quote" — **คนละสถานะปลายทาง เทสเขียวหมด** และ injection อีกตัวที่ทำให้ปุ่มยกเลิกลืมเขียน `cancelled_at` ก็เขียวเหมือนกัน
- **ทางแก้ไม่ใช่เขียนเทสสแกน source ให้ผ่านๆ แต่คือทำให้มันเป็นข้อมูล** — ย้ายการผูกไปเป็นตาราง (`B2B_ACTION_EVENT` ใน `b2bActions.ts`) และย้ายการสร้าง patch ไปเป็นฟังก์ชัน (`buildCancelPatch`) แล้วเทสเทียบกับตาราง `TRANSITIONS` จริง — injection ทั้งสองแดงทันที (รูปเดียวกับ `getQuickActions` ของ `MobileTicketDetail`)
- **กฎที่ได้: ถ้า injection จับไม่ได้เพราะ "โค้ดอยู่ในที่ที่เทสเข้าไม่ถึง" คำตอบคือย้ายโค้ด ไม่ใช่ยอมรับว่าจับไม่ได้**
- **และ regex ของเทสโครงสร้างโกหกได้สองทาง — เจอทั้งคู่ในรอบเดียว:** `/status:\s*'/` แมตช์หางของ `finance_status:` และแมตช์**คอมเมนต์**ที่พูดถึงโค้ดเก่า วิธีแก้คือใส่ boundary + ตัดบรรทัดคอมเมนต์ทิ้งก่อนสแกน **ไม่ใช่ผ่อน assert ให้ผ่าน** (ผ่อนเมื่อไหร่มันเลิกจับตัวเขียนจริงไปพร้อมกัน)

## บทเรียน: "ส่งสถานะเดิมกลับเข้าไปเพื่อให้ได้แถว log" คือตัวเขียนทับที่ไม่มีใครนับ (4 ก.ย. 2569)

- **รูปที่ต้องจำ:** `onUpdateStatus(job.id, job.status, 'ข้อความ')` — เจตนาคืออยากได้แถวใน `qc_logs` เท่านั้น แต่มันเขียน `status` ด้วยค่าที่อ่านมาจาก React tree **ถ้าอีกหน้าจอเพิ่งเลื่อนสถานะไป การกด "บันทึกโน้ต" จะย้อนสถานะกลับเงียบๆ**
- **ทางแก้: `src/utils/jobActivityLog.ts`** — เขียน `qc_logs` (+ patch อื่น) โดยไม่แตะสถานะ และ **throw ถ้ามีใครใส่ `status` มาใน patch** เพื่อไม่ให้มันกลายเป็นทางลัดเขียนสถานะทางที่สอง
- **ห้ามทำให้เป็น transition** — engine ไม่มี event ที่ปลายทางเท่าต้นทาง และไม่ควรมี: `status_history` ที่มีแถว "ไม่มีอะไรเกิดขึ้น" คือไทม์ไลน์ที่อ่านยากขึ้นโดยไม่ได้ข้อมูลเพิ่ม
- **ผลพลอยได้ที่ใหญ่กว่าที่ตั้งใจ:** ตอนย้ายปุ่มยกเลิกของ B2B มาที่ engine พบว่ามันไม่เคยเขียน `cancelled_at` / `cancelled_by` / `cancel_category` เลยสักตัว — งาน B2B ที่ยกเลิกจึงหลุดจาก soft-close ทั้งหมด (`finalizeCancelledJobs` ไม่ปิดเป็น Closed (Lost), คำนวณกำหนดเปิดใหม่ไม่ได้) **ค้างที่ Cancelled ตลอดกาลโดยไม่มีใครเห็น** — `requires` ของ engine ปิดรูนี้ให้ฟรีตอนย้าย

## Cloud Functions (Push Notification Triggers)
- **`onNewTicketCreated`** — trigger เมื่อสร้าง job ใหม่ → ส่ง push ให้ admin ทุกคน
- **`onChatMessageCreated`** — trigger เมื่อมีแชทใหม่ → ส่ง push ให้ admin หรือ rider
- **`onAdminJobStatusNotify`** — trigger เมื่อ status เปลี่ยน (Cancelled, Returned, Negotiation ฯลฯ) → ส่ง push ให้ admin. **ห้ามตั้งชื่อชนกับ rider-notifications codebase** (เช่น `onJobStatusChanged`) เพราะ Firebase Cloud Functions identify ด้วย `{region}/{name}` ระดับ project — codebase แค่จัด deploy group ไม่ namespace name → deploy ของ codebase หนึ่งจะทับอีกฝั่งและ rider/admin notification จะหายสลับกันทุกครั้งที่ฝั่งใดฝั่งหนึ่ง deploy
- **`onPickupScheduleRescheduled`** — trigger เมื่อ `jobs/{id}/pickup_schedule` ที่มีนัดอยู่แล้วถูกเปลี่ยน (admin เลื่อนนัด Pickup/Store-in/Mail-in) → (1) push ให้ไรเดอร์ที่ถืองาน (`job.rider_id`) ผ่าน `pushToRider` (2) เขียน event ลง `outbox_emails/{pushId}` (status `pending`, type `appointment_rescheduled`) ให้ Resend worker (ทำแยกอีก section) ดึงไปส่งเมลลูกค้า. การ "set นัดครั้งแรก" จะไม่ trigger (เช็ค before ต้องมี date จริงก่อน). ชื่อ function ห้ามตั้งทั่วไป (เช่น `onJobUpdated`) ด้วยเหตุผล namespace เดียวกับด้านบน
- **`onReceiveMethodChanged`** — trigger เมื่อ `jobs/{id}/receive_method` ถูกเปลี่ยน (admin เปลี่ยน trade method) → เป็น **เจ้าของการคำนวณเงินฝั่ง server**: ถ้าเปลี่ยนเป็น Pickup จะ `computeRiderFee` แล้วเซ็ต `pickup_fee` + `rider_fee_estimate` และคิด `net_payout` ใหม่ (รวมค่าไรเดอร์), ถ้าเป็น Store-in/Mail-in จะเซ็ต `pickup_fee=0` และคิด `net_payout` ใหม่ (ไม่หักค่าไรเดอร์). ถ้าเดิมเป็น Pickup และมีไรเดอร์ถืออยู่ (`rider_id`) จะถอนงาน (push แจ้งไรเดอร์ + เคลียร์ `rider_id` + ดึง status กลับ `Following Up`). client เขียนแค่ `receive_method` + ฟิลด์สถานที่ + qc_log เท่านั้น ไม่แตะเงิน. ชื่อห้ามตั้งทั่วไป (เช่น `onJobUpdated`) ด้วยเหตุผล namespace เดียวกัน
- **`onAdminOfferProposed`** — trigger เมื่อ `jobs/{id}/adjustments` เปลี่ยน: (1) มีรายการใหม่ `source='admin_manual'` + `status='pending'` (แอดมินที่ไม่ใช่ CEO/MANAGER เสนอ Offer) → push เฉพาะเครื่องของ staff role CEO/MANAGER (ผ่าน `dispatchAdminPush(..., allowStaffIds)`) (2) pending → applied/rejected → push กลับหาผู้เสนอ (`by_uid` = staff id). การอนุมัติทำใน UI ticket (mobile+desktop) โดย `handleReviewAdjustment` ซึ่งเซ็ต `approved_by_*`/`rejected_by_*` และคิด net_payout ใหม่
- **`onJobCouponRevoked` + `onJobCouponsRevoked`** — trigger เมื่อคูปองถูกลบ/เปลี่ยนออกจากงาน → reconcile ledger ฝั่ง server (client เขียนไม่ได้): flip `issued_coupons` (used→issued, เคลียร์ used_*), เคลียร์ `is_used` ใน wallet `users/{uid}/coupons`, คืน quota `coupons/{id}/used_count`. ทั้งคู่เรียก `reconcileRevokedCoupon()` ตัวเดียวกัน. Manual Top-up ของแอดมินไม่มี ledger = no-op
  - **diff ของ `onJobCouponsRevoked` key ด้วย code + device_id (`functions/coupon-revoke-diff.js` pure) ไม่ใช่ code อย่างเดียว (5 ก.ย. 2569)** — device bucket ให้แคมเปญเดียวเกาะหลายเครื่อง งานจึงมี code เดียวกันสองบรรทัดได้ (สอง MacBook หรือปุ่ม "เพิ่มเครื่องแบบเดียวกัน") diff เดิมเชื่อว่า "แคมเปญเดียวปรากฏสองครั้งไม่ได้" แอดมินลบใบแฝดใบเดียว = code ยังอยู่ = ไม่คืน quota/ledger เงียบๆ. คืนหนึ่งครั้งต่อหนึ่งบรรทัดที่หาย ตรงกับที่ order creation จอง `used_count` ต่อบรรทัด. บรรทัดเก่าไม่มี `device_id` ได้ key `CODE|` = พฤติกรรมเดิมเป๊ะ. ด่าน: `functions/test/coupon-revoke-diff.test.mjs` (พฤติกรรม + สแกน source ว่า trigger ยังเรียกมัน)
  - **เอกสารที่มีหลายเครื่องใส่ `#1 / #2` นำหน้าชื่อเครื่อง** (`deviceLines` ใน `email.js` + `voucher-pdf.js`, ป้าย "เครื่องที่ N" ใน `AssessmentCodes` ของ PricingSidebar) เฉพาะเมื่อมีมากกว่าหนึ่ง — สองเครื่องเหมือนกันต้องอ่านออกว่าเป็นสองเครื่อง ไม่ใช่บรรทัดพิมพ์ซ้ำ. ด่าน: `functions/test/device-lines-numbered.test.mjs`
  - **สองตัวเพราะคูปองอยู่สองฟิลด์:** `applied_coupons[]` (ของจริงบนงานใหม่) กับ `applied_coupon` (ใบเดียว — งานเก่า/Top-up, บนงานใหม่เป็นแค่**สำเนา**ของใบสูงสุดที่ติดธง `mirrored: true`). แอดมินลบคูปองจะล้างพร้อมกันทั้งสองฟิลด์ → trigger ยิงทั้งคู่ → **ตัวเดี่ยวจึงข้ามค่าที่ติดธง `mirrored`** ไม่งั้น quota ถูกคืนสองรอบ
  - **การเขียนฝั่ง client ต้องผ่าน helper** `REVOKED_COUPON_FIELDS` / `adminTopUpCouponFields()` ใน `src/utils/adjustments.ts` — ล้างแค่ `applied_coupon` ฟิลด์เดียวแปลว่ากด "ดึงเงินกลับ" แล้วเงินไม่กลับ (array ยังอยู่ `sumAppliedCoupons` ยังนับ)
- **`onRiderFeeDiscountEdited`** — trigger เมื่อ `jobs/{id}/rider_fee_discount` เปลี่ยน (แอดมินแก้/ลบส่วนลดจาก ticket UI) → sync `issued_rider_fee_discounts/{jobId}` (row เดิมเท่านั้น ไม่สร้างใหม่)
- **`onPickupLocationChanged`** — trigger เมื่อ `jobs/{id}/cust_lat` เปลี่ยน (admin ปรับจุดรับเครื่องของงาน Pickup) → `computeRiderFee` ใหม่จากระยะทางใหม่ แล้วเซ็ต `pickup_fee` + `rider_fee_estimate` + `net_payout` อัตโนมัติ, และถ้ามีไรเดอร์ถืองานอยู่ (`rider_id`) จะ push แจ้ง "จุดรับเครื่องเปลี่ยน". **สำคัญ:** ไรเดอร์นำทางด้วย `cust_lat/cust_lng` (ดู `bkk-rider-app` `useJobActions.handleOpenNavigation`) และจะ**ไม่สนใจที่อยู่ข้อความเมื่อมีหมุด** — ห้ามแก้ `cust_address` แล้วปล่อยหมุดเก่าค้าง (ไรเดอร์จะวิ่งผิดที่). ชื่อห้ามตั้งทั่วไปด้วยเหตุผล namespace เดียวกัน
- **`onRiderAssignedRecalcEstimate`** — trigger เมื่อ `jobs/{id}/rider_id` เปลี่ยน (ไรเดอร์กดรับ / แอดมิน assign / ถอนงาน) → คิด `rider_fee_estimate` ใหม่ด้วย **การ์ดอัตราของยานพาหนะคนที่ถืองานจริง** (`computeRiderFeeForAssignee`). ใช้ `onValueWritten` เพราะเคสหลักคือ `rider_id` ถูก **สร้าง** ไม่ใช่แก้ (`onValueUpdated` จะไม่ยิง). **แตะเฉพาะเงินฝั่งไรเดอร์** — `pickup_fee`/`net_payout` ของลูกค้าห้ามขยับเพราะใครรับงาน (invariant #3). ข้ามงานที่ไม่ใช่ Pickup และงานที่ `rider_fee` (settlement) คิดไปแล้ว

## AI Overview ของ /search เว็บลูกค้า (functions/search-overview.js)
- **`customerSearchOverview`** (onRequest, POST) = ตัวเดียวที่เรียก Anthropic ให้หน้า `/search` ของ `bkk-frontend-next`. **มันไม่รู้ว่าอะไรราคาเท่าไหร่** — เว็บ match กับ catalog เองแล้วส่ง "ข้อเท็จจริง" (ราคา/สถานะงดรับซื้อ/ชื่อหน้า) มาให้ ฟังก์ชันนี้แค่เรียบเรียงเป็นภาษาไทย. **matcher อยู่ repo นั้น ห้าม mirror มาที่นี่**
- **ทำไมอยู่ที่นี่ไม่ใช่ Vercel:** มันคือ**สิ่งที่สองในโปรเจกต์ที่จ่ายเงินค่า Anthropic** จึงต้องอยู่ใต้เพดานรายวันเดียวกันและ auto-suspension เดียวกับแชท. คีย์อีกใบบน Vercel = ทางเผาเครดิตที่ไม่มีอะไรคุมและปิดไม่ได้ ซึ่งคือความพังที่งาน suspension มีไว้กันพอดี — `isPermanentAiFailure` / `suspendAssistant` **export จาก chat-ai.js มาใช้ร่วม ไม่ก๊อป**
- **cache อยู่ที่นี่ ไม่ใช่ฝั่ง Next** — `search_overview_cache/{hash}` เช็ค**ก่อน**ยิง Anthropic และ**ก่อน**นับเพดาน (cache hit ไม่ได้จ่ายเงิน จึงไม่ควรกินโควตา). เดิมใช้ `unstable_cache` ฝั่ง Vercel ซึ่ง**ทำงานใน local build แต่ไม่ทำงานบน production** (แต่ละ request ตกคนละ lambda instance → ยิงคำถามเดิม 3 ครั้งได้คำตอบต่างกัน 3 ครั้ง = จ่าย 3 รอบ) จึงย้ายมาอยู่ข้างของที่มันปกป้อง
  - **key = hash ของ query + context** ไม่ใช่ query อย่างเดียว — context มีราคาอยู่ ราคาขยับเมื่อไหร่ key เปลี่ยนตาม กันเคสราคาเปลี่ยนกลางรอบแล้วยังเสิร์ฟเลขเก่า
  - **`OVERVIEW_CACHE_TTL_SECONDS` = MIRROR ของ `CATALOG_REVALIDATE_SECONDS`** (`bkk-frontend-next/lib/cachePolicy.ts`) คนละ repo คนละภาษา รวมเป็น constant เดียวไม่ได้ — **แก้ต้องแก้ทั้งคู่**. ทั้งคู่ย้าย 300 → 3600 (ส.ค. 2569) ตอนที่แคตตาล็อกเลิก poll แล้วเปลี่ยนเป็น push — ดูหัวข้อ "แคตตาล็อกสด" ใน CLAUDE.md ของ repo นั้น
  - **สิ่งที่กันย่อหน้าไม่ให้อ้างราคาเก่าคือ key ไม่ใช่ TTL** — key เป็น hash ของ query **และ context** ซึ่ง context มีราคาอยู่ ราคาขยับ = key เปลี่ยน = ย่อหน้าเก่า**หาไม่เจอ**ไม่ใช่แค่หมดอายุ. TTL คุมแค่ว่าคำถามเดิมบนแคตตาล็อกเดิมจะใช้คำตอบเดิมนานแค่ไหน ซึ่งเป็นสิ่งที่มันควรคุมพอดี
  - อ่าน/เขียนพังได้โดยไม่กระทบลูกค้า (อ่านไม่ได้ = ถือเป็น miss, เขียนไม่ได้ = เสียแค่ call ถัดไป) และ**เก็บเฉพาะคำตอบที่ parse ผ่านแล้ว** คำตอบเสียจึงไม่ถูกแช่ไว้ทั้งรอบ
  - โหนดนี้ไม่มี rule เป็นของตัวเอง = ตกกฎ root `.read/.write: false` ลูกค้าอ่านไม่ได้ Admin SDK เขียนได้ **ไม่ต้อง deploy rules**
  - **มีตัวกวาดแล้ว: `pruneSearchOverviewCache`** (scheduler `0 4 * * *` เวลาไทย, ใน `functions/search-overview.js`) — `runCacheGc` ลบตาม `expires_at` ครั้งละไม่เกิน `CACHE_GC_BATCH = 500` และ **ไม่แตะแถวที่ไม่มี `expires_at`เลย**, `runRateBucketGc` ลบ bucket ของ rate limit ที่เก่ากว่า 48 ชม. · ต้องมี `.indexOn: ["expires_at"]` ที่โหนดนี้ (อยู่ใน `database.rules.json` ของ bkk-frontend-next, deploy แล้ว) ไม่งั้น query จะกวาดทั้งโหนด · log บรรทัดเดียวต่อรอบ `[searchOverviewGc] cache scanned=… deleted=… · rate buckets deleted=…` — **scanned ที่โตขึ้นเรื่อยๆ ขณะที่ deleted ยังน้อย = index หาย**
- **ช่วงราคารวมต้องมาจากฟิลด์ของตัวเอง** — เว็บส่งบรรทัด "ช่วงราคารับซื้อของทุกรุ่นที่ตรงกับคำค้นนี้" ที่คำนวณจาก**ทุกรุ่นที่ match** (ไม่ใช่แค่ที่ส่งมา) + จำนวนรุ่นที่ไม่ได้แสดง และ **กฎข้อ 8 ห้ามโมเดลคำนวณช่วงรวมเองจากรายรุ่น** เพราะรายรุ่นเป็นแค่ตัวอย่าง. เคสจริงที่ทำให้ต้องมีกฎนี้: สรุปว่า "M1 = 18,000-37,000" ทั้งที่ 13" M1 อยู่ที่ 12,000-16,000 แต่ถูกตัดเพราะไม่พอที่
- **ห้ามให้โมเดลเขียนลิงก์หรือชวนกดปุ่ม** — เว็บ render ปุ่มเองจาก catalog (`buildCta`) กฎข้อนี้เขียนเป็นข้อห้ามเพราะกฎเดิม**สั่งให้**ชวนกด การลบเฉยๆ ไม่พอ
- **เพดานเป็นของตัวเอง** (`chat_ai_usage/{ymd}/overview_calls`, default 2000, override ที่ `settings/chat_widget/public/daily_overview_cap`) — จ่ายเงินก้อนเดียวกันแต่พังคนละแบบ: search เป็นทราฟฟิกนิรนามตัดทิ้งได้ไม่มีใครเสียหาย ส่วนแชทที่หยุดตอบทิ้งลูกค้ากลางประโยค **ตัวนับเดียวกัน = ของถูกอดของแพง**
- **shared secret `SEARCH_OVERVIEW_KEY` บังคับ fail closed** — ไม่ตั้ง = deploy แล้ว 503 ปิดสนิท (กฎเดียวกับ `migrateOldJobs`) ไม่งั้นมันคือ Anthropic proxy เปิดโล่งบนอินเทอร์เน็ต. CI เขียนลง `functions/.env` จาก GitHub Secret ชื่อเดียวกัน และค่านี้ต้องตรงกับ env `SEARCH_OVERVIEW_KEY` ฝั่ง Vercel
- **gate เดียวกับ widget:** `enabled !== true` หรือ `ai_suspended === true` → ตอบ `{skipped}` ไม่เรียก API. ทุกการปฏิเสธตอบ 200 พร้อมเหตุผลที่มีชื่อ **ไม่ใช่ status code** เพราะหน้าค้นหาต้องไม่พังเพราะย่อหน้าเสริมเขียนไม่ได้
- **กฎใน system prompt เขียนเป็นข้อห้าม** — ห้ามใช้ราคาตลาด/ราคาร้านอื่น/สเปกที่ไม่ได้ส่งมา, ข้อมูลไม่พอให้บอกตรงๆ ห้ามเดา, รุ่นที่งดรับซื้อห้ามเสนอราคา. ตอบเป็น JSON `{summary, detail}` (detail = ส่วนที่ถูกพับใต้ "แสดงเพิ่มเติม")
- ชื่อ `customerSearchOverview` unique ระดับ project ตามกฎ `{region}/{name}` เหมือนทุกตัว

## System Health (ส.ค. 2026)
- **หน้า `/system-health`** (`src/pages/admin/SystemHealth.tsx`, CEO/MANAGER, อยู่ใน settingsNav กลุ่ม Advanced) — สถานะ service/API ทุกตัวที่ระบบพึ่งพาในที่เดียว. logic ตรวจทั้งหมดอยู่ **`functions/health-check.js`** (`registerHealthCheck` inject `dispatchAdminPush`/`dispatchTelegram` จาก index.js แบบเดียวกับ dealer-portal)
- **Functions:** `systemHealthCheck` (scheduler รายชั่วโมง นาที 21 เวลาไทย) + `adminSystemHealthRun` (callable, gate role CEO/MANAGER ผ่าน `lookupStaffByAuth`) — ชื่อ unique ระดับ project ตามกฎ `{region}/{name}`
- **Probes:** `checkout_config` (สาขา active + พิกัด finite + โซนค่าส่ง — ตัวจับบั๊ก "กำลังคำนวณ..." ของ checkout ลูกค้าโดยตรง), `customer_quote` (ยิง `quotePickupServiceability` ของ bkk-frontend-next แบบ end-to-end ด้วยพิกัดกลางกรุงเทพ), `routes_api`, `geocoding_api`, `rtdb`, `sickw` (action=balance ฟรี + warn เมื่อเครดิต < $10), `resend` (list domains + เช็ค verify), `telegram` (getMe), `thailand_post` (getToken), `anthropic` (list models), `search_analytics_ttl` (ดูด้านล่าง), `browser_maps_key` (ดูด้านล่าง). env key ไม่ตั้ง = status `skip` ไม่ใช่ fail
- **`browser_maps_key` = ตัวเดียวที่ทดสอบ checkout ด้วยคีย์ที่ลูกค้าถือจริง (บทเรียน billing ค้างชำระ 4 ก.ย. 2569)** — คืนนั้น checkout เลือกวิธีรับเครื่องไม่ได้ทั้งคืน แต่ `customer_quote` ไม่แดง เพราะมันส่งชื่อจังหวัดไปเป็น hint เอง จึงข้ามขั้น "เบราว์เซอร์ reverse geocode หาจังหวัด" ซึ่งเป็นขั้นที่**ไม่มี fallback** และล้มจริง (province null → `eligibleMethods` ว่าง → ปุ่มยืนยัน disable) ส่วน `geocoding_api`/`routes_api` ใช้คีย์ server คนละใบ. probe นี้ยิง Geocoding + Routes ด้วย **คีย์เบราว์เซอร์ + header `Referer` ของเว็บลูกค้า** (คีย์ล็อก HTTP referrer ไว้ ยิงเปล่าจาก Cloud Function โดนปฏิเสธเสมอ) แล้วให้ `browserKeyVerdict` (`functions/health-check-browser-key.js`, pure มีเทส `health-browser-key.test.mjs`) ตัดสิน: geocode ล้ม = **fail** (ไม่มี fallback) · Routes ล้มอย่างเดียว = **warn** (มี haversine ×1.3 รองรับ ระบบยังขายได้) · Geocoding REST ตอบว่าไม่รับคีย์ referer ทั้งชนิด = **skip** พร้อมเหตุผล ไม่ใช่ fail เพราะเป็นข้อจำกัดของวิธี probe ไม่ใช่คีย์พัง (Routes รับคีย์ referer แน่นอน เว็บลูกค้ายิงแบบนั้นบน production)
  - **ต้องตั้ง GitHub Secret `GOOGLE_MAPS_BROWSER_KEY`** = ค่าเดียวกับ `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` บน Vercel (CI เขียนลง `functions/.env` แล้ว) — ไม่ตั้ง = `skip` ตาม convention. Referer default มาจาก origin ของ `CUSTOMER_TRACKING_BASE_URL` override ได้ด้วย `HEALTH_BROWSER_REFERER`. **เปลี่ยน secret แล้วต้อง Run workflow ด้วยมือ** (กับดักเดิมในหัวข้อ env vars)
  - โควตา: +1 Geocoding +1 Routes ต่อรอบ รวมแล้วยังอยู่ใน free tier (~1.5k/เดือน/SKU)
- **`search_analytics_ttl` = probe ตัวเดียวที่ตรวจ "การตั้งค่าที่ไม่มีอยู่ในโค้ดของ repo ไหนเลย"** — ตาราง `search_events` (Firestore, เว็บลูกค้าเขียน) ต้องหายเองใน 90 วันตามที่ประกาศไว้ใน `/privacy` + RoPA แต่**ตัวลบคือ TTL policy ที่ตั้งใน Google Cloud** ไม่ใช่โค้ด (โค้ดแค่ประทับ `expires_at`) **ไม่ตั้ง = ทุก write สำเร็จ ไม่มี error แถวก็แค่ไม่หาย** แล้วกลายเป็นทะเบียนคำค้นถาวร ซึ่งเป็นปัญหา PDPA ไม่ใช่ปัญหาพื้นที่. probe จึงถาม**ผลลัพธ์** (เอกสารเก่าสุดอายุกี่วัน) ไม่ถาม config เพราะ config ที่ตั้งไว้แต่ไม่ทำงานก็ยังอ่านว่าตั้งแล้ว. เผื่อ 7 วันเพราะ TTL ของ Firestore ลบภายใน 24 ชม.หลังหมดอายุ "โดยทั่วไป" ไม่ใช่ตรงเป๊ะ — เตือนช้าไปวันเดียวคือเตือนหมาป่า. ยังไม่เปิด Firestore = `skip` ไม่ใช่ fail
- **ผลเก็บที่ `system_health/`** (`services/{id}` + `summary`) — read rule = admin เท่านั้น อยู่ที่ `bkk-frontend-next/database.rules.json` (deploy จาก repo นั้น), write ปิด (Admin SDK เขียน)
- **`order_reconciliation` = probe ตัวเดียวที่ตรวจ "ธุรกิจ" ไม่ใช่ "ของข้างนอก"** — เทียบคนที่ยิง `checkout_submit_attempt` กับคนที่จบที่ปลายทางใดปลายทางหนึ่ง (`order_completed` / `checkout_submit_blocked` / `checkout_submit_error`). ไม่มีปลายทาง = ลูกค้ากดแล้วระบบเงียบ ซึ่ง server มองไม่เห็นเพราะไม่มี request มาถึง. **ห้ามใส่เบอร์/ชื่อลูกค้าลงข้อความแจ้งเตือน (PDPA)** — ชี้ไปหน้า Session Monitor (`/admin/sessions` ของเว็บลูกค้า) ที่ gate สิทธิ์แล้วแทน. query ตาม index `timestamp` ไม่กวาดทั้ง node
  - **หน้าต่างของ "การกด" กับ "ปลายทาง" ไม่เท่ากันโดยตั้งใจ** — การกดนับเฉพาะ 3 ชม.→30 นาที (คนที่เพิ่งกดอาจยังทำรายการอยู่) แต่ปลายทางรับถึง `now` มิฉะนั้นคนที่กดจ่อขอบหน้าต่างแล้วสำเร็จอีก 3 วินาทีถัดมาจะถูกนับว่าเงียบทั้งที่ได้ออเดอร์แล้ว
  - **ก่อนเตือนต้องถามความจริงฝั่ง server เสมอ** — ปลายทางทั้งสามตัวเขียนโดยเบราว์เซอร์ลูกค้า ปิดแท็บก่อน event ถึง = เห็นเป็นเงียบทั้งที่ออเดอร์เข้าแล้ว. probe จึง query `/jobs` ตาม index `uid` (เพดาน 20 uid, ยิงเฉพาะรายที่ยังน่าสงสัยซึ่งปกติมีศูนย์ถึงหยิบมือ) ถ้ามีงานเกิดในหน้าต่างเดียวกัน = ไม่ใช่เงียบ แต่นับเป็น `lost_event` แล้วรายงานเป็น ok พร้อมหมายเหตุ
- **probe ที่ fail จะถูกลองซ้ำอีกครั้ง (หน่วง 2 วิ) ก่อนตัดสิน** — เน็ตจาก Cloud Function ไป API ภายนอกกระตุกเป็นปกติ ถ้าเตือนตั้งแต่ครั้งแรกจะกลายเป็นเตือนหมาป่าจนคนเลิกอ่าน (เคสจริง 5 ส.ค. 2026: Telegram probe timeout แล้วแจ้งเตือน ทั้งที่ข้อความแจ้งเตือนนั้นส่งผ่าน Telegram สำเร็จ = ใช้งานได้ปกติ). ลองซ้ำในรอบเดียวกันไม่ใช่รอรอบหน้า เพราะของที่พังจริงต้องเตือนทันที
- **แจ้งเตือนเฉพาะตอน "เปลี่ยนสถานะ"** (อะไรก็ตาม→fail = push+Telegram, fail→หาย = Telegram) — รันซ้ำตอนยังพังไม่สแปม. push ใช้ `data.type: "system_health_alert"` map เข้าหมวด `system_alert` ใน `functions/notification-settings.js` แล้ว (ปิดได้จาก /notification-settings)
- **ปิดการตรวจรายตัวได้ (mute)** — toggle ต่อ service ที่ `settings/health_checks/{id}/enabled` (สวิตช์บนการ์ดในหน้า /system-health). fail-open: มีแต่ `false` ชัดๆ เท่านั้นที่ปิด → probe ได้สถานะ `skip` ไม่นับ fail ไม่แจ้งเตือน. fail→skip ไม่นับเป็น "หายพัง" (ไม่ส่ง Telegram recovery). อยู่ใต้ `settings` ใช้ rule เดิม ไม่ต้อง deploy rules. ใช้กับ service ที่รอฝั่งภายนอกแก้ (เช่น Thailand Post รอ activate บัญชี)
- **เพิ่ม probe ใหม่** = เพิ่ม 1 entry ใน `buildProbes()` — หน้า UI render ตามข้อมูลไม่ต้องแก้. probe ต้องเป็น endpoint ฟรี/ราคาศูนย์เสมอ (balance/getMe/list ไม่ใช่ transaction จริง). Routes+Geocoding+quote กิน quota จริงรอบละ ~3 calls (รายชั่วโมง ≈ 2.2k/เดือน อยู่ใน free tier 10k) — **อย่าลด interval โดยไม่คิดโควตา**

## แอปพนักงาน (`employee-app/`) — ลงเวลาด้วย GPS ใบลา และคำขอเปลี่ยนกะ

> PWA แยกของ bounded context "คนทำงาน" — พนักงานลงเวลาเข้า-ออกงานโดยอ้างพิกัด ขอลา ขอเปลี่ยนกะ และหัวหน้ากดอนุมัติ **ในแอปเท่านั้น** (โจทย์ของเจ้าของงาน ก.ย. 2569)

- **โครงเดียวกับ `dealer-portal/`:** Vite app ของตัวเอง · hosting target `employee` → site `bkk-apple-employee` · **ห้าม import จาก `src/`** ตัดออกเป็น repo แยกได้ทุกเมื่อ. ข้อยกเว้นทางเดียว: `vite.config.ts` ของรีโปหลักเก็บไฟล์เทสในโฟลเดอร์นี้ด้วย — **เทสข้ามเข้ามาได้ โค้ดข้ามออกไปไม่ได้** (ประตู GPS เป็นสิ่งที่ทั้งแอปขึ้นอยู่กับมัน ปล่อยให้อยู่นอกสายตา vitest ไม่ได้)
- **`Permissions-Policy` ของ site นี้ต้องเป็น `geolocation=(self)`** — ก๊อปหัวของ dealer มาตรงๆ (`geolocation=()`) จะปิด GPS ทั้งแอป **โดยไม่มี error ที่ไหนเลย** มีแต่ "หาตำแหน่งไม่พบ" ตลอดกาล ซึ่งไล่กลับไปหาสาเหตุยากมาก ตั้งไว้ใน `firebase.json` แล้ว
- **ไม่อนุญาตตำแหน่ง = ใช้ไม่ได้ทั้งแอป ไม่ใช่แค่ปุ่มลงเวลาถูกปิด** — ทุกอย่างในแอปผูกกับ "อยู่ที่ไหนตอนนี้" ถ้าเข้าหน้าอื่นได้ คนจะเข้าใจว่าแอปใช้ได้แล้วแค่ปุ่มเสีย. ตัวตัดสินคือ `geoBlockReason` (`employee-app/src/geo.ts` ล้วน มีเทส) เรียงเหตุผลตาม**ความถาวร** (ไม่รองรับ > http > ปฏิเสธสิทธิ์ > หาไม่เจอ > หมดเวลา > ยังไม่มีพิกัด > พิกัดเก่า) แบบเดียวกับ `oneTapBlockReason` ของเว็บลูกค้า
  - **คำขอตำแหน่งครั้งแรกต้องมาจากการแตะของผู้ใช้ (บั๊กที่หลุดถึงมือผู้ใช้ 5 ก.ย. 2569)** — iOS Safari โดยเฉพาะตอนติดตั้งเป็นแอปบนหน้าจอโฮม **ไม่ขึ้นกล่องถาม**ให้คำขอที่เกิดตอนหน้าโหลด และตอบ `PERMISSION_DENIED` ทันที เวอร์ชันแรกขอตอน mount แล้วจอ `denied` ก็ **ตั้งใจไม่ให้มีปุ่ม** (เหตุผลตอนนั้น: "ปุ่มที่กดแล้วไม่มีทางสำเร็จ สอนให้คนกดวนไปเรื่อยๆ") ผลคือเปิดแอปครั้งแรกเจอจอตันสนิท ทั้งที่ยังไม่มีใครถูกถามสักครั้ง — **เหตุผลนั้นตั้งอยู่บนสมมติฐานที่ผิดว่า `denied` แปลว่าผู้ใช้ปฏิเสธจริง**. วันนี้: `watchPosition` เริ่มเองเฉพาะเมื่อ Permissions API ตอบ `granted` นอกนั้นรอปุ่ม และ **ทุกเหตุผลที่แก้ได้ต้องมีปุ่ม ที่แก้ไม่ได้จริงๆ (ไม่รองรับ / http) ต้องไม่มี** มีเทสเป็นราวกันตก
  - **Safari ไม่มี `geolocation` ใน Permissions API เลย** — `query()` reject ตลอด แปลว่า `permission` เป็น `null` เสมอบน iOS **เส้นทางที่ต้องแตะปุ่มจึงเป็นเส้นทางปกติของ iOS ไม่ใช่เคสขอบ**
  - **`navigator.permissions` เป็น null ได้จริง** — ต้อง `?.query()` เสมอ ไม่งั้นทั้งหน้าพังเข้า error boundary ไม่ใช่แค่ฟีเจอร์นี้พัง (เคสเดียวกับที่จดไว้ใน CLAUDE.md ของเว็บลูกค้า)
  - **จอที่ปิดทางต้องไม่ตัน** — และรหัสเหตุผล (`block.code`) ถูกพิมพ์ตัวเล็กๆ ไว้ท้ายจอ เพราะการไล่ปัญหาตำแหน่งจากคำบรรยายของผู้ใช้อย่างเดียวแทบเป็นไปไม่ได้
  - **"พิกัดเก่า" เป็นเคสที่อันตรายที่สุดเพราะมันไม่ error** — เบราว์เซอร์คืนพิกัดจากแคชได้เงียบๆ ถ้าไม่ตรวจอายุ (`MAX_FIX_AGE_MS` 90 วิ) คนจะเช็คอินผ่านด้วยพิกัดของที่ที่เขาอยู่เมื่อชั่วโมงที่แล้ว. `at` ใช้ `Date.now()` ตอนรับค่า **ไม่ใช่ `pos.timestamp`** (นาฬิกาเครื่องตั้งเองได้)
- **GPS โกงได้ และระบบนี้ไม่ได้แก้เรื่องนั้น** — mock location ทำได้โดยไม่ต้องรูท สิ่งที่ได้คือ *บันทึกที่ตรวจย้อนหลังได้* (พิกัด ระยะห่าง ความแม่นยำ สาขาที่เข้าเกณฑ์) **ห้ามเขียนข้อความบนจอที่อ้างเกินกว่านี้**

### ใครเข้าแอปนี้ได้ — และทำไมหน้าล็อกอินไม่ใช่ด่าน (เจ้าของงานสังเกตเจอ 5 ก.ย. 2569)

> *"คนที่มี UID เหมือนจะล็อกอินได้หมดเลย ทั้งที่ไม่ควรจะเป็นอย่างงั้น แม้กระทั่งไรเดอร์เอง กลัวว่าลูกค้าก็จะล็อกอินเข้ามาได้เหมือนกัน"* — **ถูกทุกคำ**

- **บัญชี Firebase Auth ของโปรเจกต์นี้เป็นกองเดียวกันทั้งระบบ** — พนักงาน (`adminStaffCreate`) · ไรเดอร์ · ดีลเลอร์ (`adminDealerCreate`) · **และลูกค้า** ซึ่งสร้างบัญชี email/password ได้เองที่ `bkk-frontend-next/app/components/loginActions.ts` (`createUserWithEmailAndPassword`). `signInWithEmailAndPassword` ของแอปพนักงานจึงรับทุกคนในกองนั้น **หน้าล็อกอินไม่ได้กันใครเลยและกันไม่ได้ด้วย** (ไคลเอนต์ยังไม่มีตัวตนให้ตรวจก่อนล็อกอิน)
- **สิ่งที่กันข้อมูลอยู่คือด่านของ callable ทุกตัว ไม่ใช่หน้าล็อกอิน** — ตรวจแล้ว callable ทั้ง 16 ตัวมีด่านครบ (`requireEmployeeCaller` สำหรับ `employee*`/`supervisor*` · `requireStaffRole` สำหรับ `admin*`) และแอปไม่อ่าน RTDB ตรงเลยสักโหนด **ข้อมูลไม่รั่ว** — แต่ **นั่นไม่ใช่เหตุผลให้ปล่อยคนแปลกหน้าเข้ามานั่งในแอป**
- **บั๊กจริงคือลำดับ: เวอร์ชันแรกขอสิทธิ์ GPS ก่อนตรวจว่าเป็นพนักงานไหม** — ลูกค้าที่กรอกรหัสผ่านของตัวเองเข้ามาจะถูกขอ **พิกัดปัจจุบัน** ก่อนจะถูกปฏิเสธ นั่นคือการขอข้อมูลที่เราไม่มีสิทธิ์ขอตั้งแต่แรก **กฎ: ตรวจตัวตนก่อนขออะไรจากเครื่องเขาเสมอ**
- **`employeeMe` เป็นด่านแรกของแอป ไม่ใช่แค่ไว้โชว์ชื่อ** — เรียกทันทีหลังล็อกอิน อ่านแค่ `employees` + `staff` ผลลัพธ์ตัดสินผ่าน `appGate` (`employee-app/src/session.ts` ล้วน มีเทส) ซึ่งทำให้**ลำดับของด่านเป็นข้อมูลที่เทสอ่านได้ ไม่ใช่ลำดับ `if` ที่ซ่อนใน JSX**
- **"ถามไม่สำเร็จ" ต้องไม่ถูกปฏิบัติเหมือน "ถูกปฏิเสธ"** — `sessionVerdict` ถือว่ามีแค่ `permission-denied`/`unauthenticated` ที่แปลว่าไม่ใช่พนักงานแน่นอน (เตะออกจากระบบ) ส่วน `unavailable`/`internal`/timeout = **ยังไม่รู้** ขึ้นจอ "ลองใหม่" ไม่เตะออก — ไม่งั้นพนักงานที่สัญญาณกระตุกหน้าร้านจะถูกล็อกเอาต์ทุกครั้ง ซึ่งเกิดบ่อยกว่าคนแปลกหน้าล็อกอินเข้ามามาก
- **ผลการตรวจผูกกับ uid ที่ตรวจ** (`{uid, state}`) — เก็บเป็น state เปล่าๆ แล้วล้างตอน user เปลี่ยน จะมีช่วงที่ผลของ *คนก่อนหน้า* ค้างบนจอของคนใหม่
- **ด่าน:** `employee-app/src/session.test.ts` (14 ข้อ รวมราวกันตก "ไม่มีเส้นทางไหนที่คนไม่ใช่พนักงานไปถึงจอ GPS หรือหน้าแอปได้") + section ใน `functions/test/hr-attendance.test.mjs` ที่สแกนว่า **callable ทุกตัวมีด่าน** — ตัวหลังตอนเขียนครั้งแรก**มีรูเอง** (ตัด body ด้วยหน้าต่างความยาวคงที่ ด่านของฟังก์ชันถัดไปจึงทำให้ตัวที่ไม่มีด่านผ่าน) injection เป็นตัวจับได้ แก้เป็นตัดที่ callable ตัวถัดไป

### หน้าตาแอป — สองบั๊กที่ไม่มีด่านไหนเห็น เพราะ "ไม่มีอะไรพัง" (5 ก.ย. 2569)

> เจ้าของงานส่งภาพหน้าขอลามาบอกสั้นๆ ว่า "UI พัง" — `tsc` ผ่าน eslint ผ่าน เทส 704 ตัวผ่าน build ผ่าน CI เขียวครบทุกช่อง ตระกูลเดียวกับบทเรียน "ผลพิมพ์ (print)" ข้างบน: **โค้ดถูกทุกด่าน แต่ผิดบนจอ**

- **บั๊กที่ 1 — ชื่อพนักงานหายไปเพราะขาวบนขาว:** หัวแอปใช้ `className="row"` ซึ่งชนกับ `.row` ที่เป็น**การ์ดในลิสต์** (พื้นขาว มีขอบ) สไตล์การ์ดจึงทาทับหัวแอปสีกรม แล้วตัวหนังสือสีขาวที่สืบทอดมาจาก `.head` ก็ไปนั่งบนพื้นขาว. วัดจริงในเบราว์เซอร์: `background: rgb(255,255,255)` คู่กับ `color: rgb(255,255,255)` = contrast **1.00:1**. **ชื่อกับรหัสพนักงานยังอยู่ใน DOM ครบ มันแค่มองไม่เห็น** — screen reader อ่านได้ เทสที่หา text ก็เจอ
  - แก้: หัวแอปใช้ `.bar` ของตัวเอง **และ** การ์ดในลิสต์ถูก scope เป็น `.list .row` — **ต้องทำทั้งสองข้าง** เพราะการแก้ข้างเดียวคือการรอให้ชนกันอีกรอบด้วยชื่ออื่น
- **บั๊กที่ 2 — หัวแอปมุดใต้แถบสถานะ:** `index.html` ตั้ง `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style: black-translucent` (เว็บวิวกินพื้นที่ใต้แถบสถานะ) แต่ CSS มีแค่ `--safe-b` **ไม่มี `--safe-t` เลย** — `src/index.css` ของแอปแอดมินมี `.safe-top` มาตั้งนานแล้ว แต่แอปนี้เขียนขึ้นใหม่แล้วก๊อปมาไม่ครบ
- **บั๊กที่ 3 — ช่องวันที่เป็นกล่องเปล่า:** iOS Safari วาด `input[type=date]` ที่ไม่มีค่าเป็น**กล่องเปล่าสนิท** ขณะที่เดสก์ท็อป Chrome ขึ้น `mm/dd/yyyy` ให้ — **ซึ่งเป็นเหตุผลที่มองไม่เห็นตอนพัฒนา**. แก้โดยวางป้ายของเราเองทับตอนว่าง **และซ่อนป้ายเนทีฟตอนว่างด้วย** (`.datefield.empty > input::-webkit-datetime-edit { opacity: 0 }`) ไม่งั้นบน Chromium จะพิมพ์ทับกันสองชั้น — **แก้ข้างเดียวคือเปลี่ยนบั๊กเป็นบั๊กอีกตัว** (รูปเดียวกับ `display`/`visibility` ของใบเสร็จ)
- **ด่านถาวร: `employee-app/src/appChrome.test.ts` สองชั้น** (รันด้วย `npm test` ตามปกติ)
  - **ชั้นสตริง** — คลาสที่ใช้ในหัวแอปห้ามมีกฎที่ทา `background` โดยไม่ตั้ง `color` ของตัวเอง (`.btn.ghost` ตั้งทั้งคู่จึงผ่านถูกต้อง) · การ์ดต้อง scope ใต้ `.list` · `--safe-t` ต้องถูกใช้เมื่อ index.html ยังตั้ง cover อยู่ (**เขียนเป็นเงื่อนไข ไม่ใช่บังคับ** — ถอด cover ออกเมื่อไหร่บั๊กก็หายเอง)
  - **ชั้นเบราว์เซอร์** — SSR `AppHeader` + CSS จริง แล้ววัด contrast ที่ Chromium คำนวณให้ ต้อง ≥ 4.5:1. ใช้สวิตช์ `REQUIRE_PRINT_CHECKS=1` ตัวเดียวกับด่านพิมพ์ (CI ติดตั้ง chromium อยู่แล้ว จึงแทบไม่มีต้นทุนเพิ่ม)
  - **สองชั้นนี้ไม่ซ้ำซ้อนกัน และพิสูจน์แล้ว** — injection ที่ทา `.head` เป็นสีอ่อนโดยไม่แตะ `.row` เลยทำให้**ชั้นสตริงเขียวสนิท** (ไม่มีกฎไหนผิดรูป) แต่ตัวหนังสือขาวบนพื้นสว่างอ่านไม่ออกจริง — ชั้นเบราว์เซอร์จับได้ตัวเดียว
- **`AppHeader.tsx` ถูกแยกออกจาก `App.tsx` เพื่อให้เทสเข้าถึงได้** (App.tsx import Firebase จึง SSR ไม่ได้) — บทเรียนเดิม: **ถ้า injection จับไม่ได้เพราะโค้ดอยู่ในที่ที่เทสเข้าไม่ถึง คำตอบคือย้ายโค้ด ไม่ใช่ยอมรับว่าจับไม่ได้** และมีเทสกันไม่ให้ App.tsx เขียนมาร์กอัปหัวแอปเองซ้ำ (ไม่งั้นด่านจะไปวัดของที่ไม่มีใครใช้)
- **บั๊กที่ 3 หลุดรอบสองเพราะแก้ที่หน้าเดียว (เจ้าของงานส่งภาพมาซ้ำวันเดียวกัน)** — `DateField` ถูกเขียนไว้ใน `Leave.tsx` หน้า **เปลี่ยนกะ** จึงยังเป็นกล่องเปล่าอยู่ **และเทสที่เพิ่งเขียนไว้ก็ดูแค่ `Leave.tsx` จึงเขียวสนิท** นี่คือกฎ "กฎมีกี่คนอ่าน" เป๊ะๆ: กฎถูกแล้ว แต่ติดตั้งไม่ครบทุกคนที่อ่านมัน — และ**ด่านที่ตรวจแค่ call site เดียวก็เป็นด่านที่ไม่ครบแบบเดียวกัน**
  - แก้: `employee-app/src/DateField.tsx` เป็นเจ้าของช่องวันที่ที่เดียว + เทส**สแกนทุกไฟล์ `.tsx`** ว่า **ไม่มีหน้าไหนเขียน `type="date"` เองได้เลย** (และต้องมีคนเรียก `DateField` จริง ไม่ใช่คอมโพเนนต์ที่ไม่มีใครใช้)
  - **เทสที่เขียนว่า "ไฟล์ A ทำถูก" อ่อนกว่าเทสที่เขียนว่า "ไม่มีไฟล์ไหนทำผิด" เสมอ** — ข้อแรกโตตามจำนวนหน้าไม่ได้ ข้อหลังโตเอง
- **วิธีไล่บั๊กหน้าตาครั้งหน้า:** สร้าง harness ชั่วคราวที่ import **คอมโพเนนต์จริง + `styles.css` จริง** (alias `../api` ไปที่ stub) → `vite build` → เสิร์ฟด้วย `python3 -m http.server` → Playwright screenshot + `getComputedStyle`. **การอ่านโค้ดอย่างเดียวไม่มีทางเห็นบั๊ก cascade** — รอบนี้เดาผิดไปสองรอบก่อนจะยอมเปิดเบราว์เซอร์ดู แล้วเจอสาเหตุจริงในนาทีเดียว

### ระบบดีไซน์ "ธีมการ์ดนุ่ม" — ที่มา ขอบเขต และสิ่งที่จงใจไม่ทำ (5 ก.ย. 2569)

> เจ้าของงานส่ง handoff จาก Claude Design (`Employee App.dc.html` 13 จอ) มาให้ทำจริง
> ผลคือ **เปลี่ยนภาษาภาพทั้งแอป แต่ไม่เพิ่มหน้าที่ระบบยังทำไม่ได้สักจอเดียว**

- **โทเคนทั้งหมดอยู่ `employee-app/src/styles.css` ที่เดียว** — พื้น `#f5f7fc` · การ์ดขาวมุม 20px เงาบาง · แอคเซนต์เขียวมิ้นต์ `#0c7a6d` · ป้ายหัวข้อเป็นสีแบรนด์ลอย**นอก**การ์ด (`.section > h2`) · ตัวเลขทุกตัว `tabular-nums` · ฟอนต์ IBM Plex Sans Thai (น้ำหนักสูงสุด 600 ไม่ใช่ 800 แบบเดิม)
- **แถบสถานะ iOS เปลี่ยนจาก `black-translucent` เป็น `default` และนั่นเป็นส่วนหนึ่งของดีไซน์ ไม่ใช่ผลข้างเคียง** — `black-translucent` บังคับตัวอักษร**สีขาว** ซึ่งอ่านไม่ออกบนหัวแอปสว่าง (ดีไซน์ต้นทางเองก็วาดแถบสถานะเป็นสีดำทุกจอที่ไม่ใช่ splash) `viewport-fit=cover` ยังอยู่เพื่อเผื่อขอบล่าง กฎ `--safe-t` ในเทสจึงผูกกับ `cover` อย่างเดียวแล้ว
- **`GateShell` เป็นเจ้าของจอเต็มทุกใบ** (ล็อกอิน · สิทธิ์ตำแหน่ง · ถามตัวตนไม่สำเร็จ · กำลังโหลด) เหตุผลเดียวกับ `DateField` เป๊ะๆ: สี่จอนี้เคยเขียนเปลือกของตัวเองคนละไฟล์ ซึ่งคือรูปที่ทำให้ช่องวันที่หลุดรอบสอง. **ห้าม import Firebase ในไฟล์นี้** เพราะชั้นเบราว์เซอร์ต้อง SSR มันได้
- **สิ่งที่ดีไซน์มีแต่ *ไม่ได้ทำ* และเหตุผล — อ่านก่อนคิดว่า "ทำไม่ครบ":**

  | จอในดีไซน์ | ทำไมไม่ทำ |
  |---|---|
  | ~~06 สลิปเงินเดือน · 07 แฟ้มเอกสาร~~ | **ข้อนี้ผิด ทำแล้ว** — ที่ไม่มีคือ callable *ฝั่งพนักงาน* ส่วนข้อมูลมีครบมาตลอด ดูหัวข้อ "ปิดช่องว่างของดีไซน์ให้ครบทั้ง 8 จอ" |
  | 00b–00d ออนบอร์ดดิ้ง + สวิตช์สิทธิ์ (กล้อง/แจ้งเตือน) | แอปไม่ได้ใช้กล้อง ไม่มี push — สวิตช์ที่กดแล้วไม่เกิดอะไรแย่กว่าไม่มี |
  | ~~03 ตารางกะล่วงหน้า~~ | **ทำแล้ว** — `employeeRoster` อ่านตารางเวรจริงผ่าน `resolveShift` ดูหัวข้อรอบสาม |
  | ~~04 สลับกะกับเพื่อน~~ | **ทำแล้ว** — เพิ่มเส้นทางสองขั้น (เพื่อนรับ → หัวหน้าอนุมัติ) ดูหัวข้อรอบสาม |
  | 02 แผนที่ geofence · สแกน QR · เช็คอินนอกสถานที่ · แถบเลื่อนยืนยัน | สองอันกลางไม่มีในระบบ · แผนที่ต้องโหลด Maps JS ทุกการเปิดแอปเพื่อภาพที่ไม่เปลี่ยนคำตอบ (server ตัดสินรัศมีอยู่แล้ว) |
  | ~~08 ข้อมูลพนักงาน (แท็บ "ฉัน")~~ | **ทำแล้ว** — `employeeProfile` (สรุปเดือนนี้รายงานชั่วโมงทำงาน ไม่ใช่โอที) ดูหัวข้อรอบสาม |
  | ~~ชื่อแบรนด์ `getmobie` ในดีไซน์~~ | **ข้อนี้ผิด แก้แล้ว — ดูหัวข้อ "ชื่อแอปคือ getmobie" ด้านล่าง** |

- **สิ่งเดียวที่ได้เพิ่มเพราะดีไซน์ถาม และข้อมูลมีอยู่แล้ว: การ์ดสิทธิ์ลา** — `employeeLeaveList` คืน `balances` มาตั้งแต่ต้นแต่ UI ประกาศเป็น `unknown` แล้วไม่เคยวาด (ฟิลด์ที่เขียนแล้วไม่มีใครอ่าน = ของที่หายเงียบๆ ตามบทเรียน `status_history`) วันนี้มีคนอ่านแล้ว **ไม่ต้องแก้ server**
  - **แต่ห้ามเขียนว่า "วันลาคงเหลือ" ลอยๆ** — `entitled_paid_days` คือเพดาน **ค่าจ้าง** ไม่ใช่เพดานวันลา (ลาป่วย ม.32 ลาได้ตามที่ป่วยจริง จ่ายไม่เกิน 30 วัน) หัวข้อจึงเป็น "สิทธิ์ลาที่ได้ค่าจ้าง" พร้อมหมายเหตุใต้การ์ด **ห้ามลบหมายเหตุนั้น**
  - **สามสถานะที่ห้ามวาดเป็น `0` เหมือนกัน** (`balanceText` ใน `Leave.tsx`): `locked: 'service'` = ยังไม่ครบอายุงาน · `entitled_paid_days == null` = ไม่มีเพดานในกฎหมาย (ลาทำหมัน) · `entitled_paid_days === 0` = ชนิดนี้ไม่ได้ค่าจ้างอยู่แล้ว — เลข 0 ตัวเดียวกันแปลว่าคนละเรื่องทั้งสามอัน
- **`thaiDate` / `thaiDateRange` / `thaiDayParts` (`geo.ts`) เป็นตัวแสดงผลเท่านั้น** — ฟอร์มยังส่ง `YYYY-MM-DD` ให้ server เหมือนเดิม และตัวแปลง**อ่านวันที่เป็นเวลาท้องถิ่น ไม่ใช่ UTC** (`new Date('2026-09-05')` ตีเป็น UTC เที่ยงคืน โซนติดลบจะเลื่อนไปหนึ่งวัน — วันที่ที่ server ส่งมาคือ "วันที่ของกะ" ตามปฏิทินไทยอยู่แล้ว ห้ามให้เขตเวลาของเครื่องขยับมัน)
- **สามอย่างที่ *อ่านโค้ดไม่เห็น* และเจอตอนเปิดเบราว์เซอร์ดูจริง** (ยืนยันกฎเดิมอีกรอบ):
  1. การ์ดสิทธิ์ลาสามใบ **ตัวเลขอยู่คนละระดับ** เพราะชื่อชนิดลายาวไม่เท่ากัน (`ลาป่วย` 1 บรรทัด / `ลากิจธุระอันจำเป็น` 2 บรรทัด) — แก้ด้วย `.grid3 > .tile > .btm { margin-top: auto }` ไม่ใช่การตัดชื่อให้สั้น
  2. หน้าประวัติขึ้น `06:36 - -` ตอนยังไม่ออกงาน ซึ่งอ่านเหมือนจอเสีย
  3. 30 วันคร่อมสองเดือนได้ แต่แถวมีแค่เลขวันที่ — เพิ่มหัวข้อคั่นเดือน
- **ด่านถูกขยายพร้อมกัน ไม่ใช่ตามหลัง** (`appChrome.test.ts`, ตาราง injection 12 ข้อวัดจริงอยู่ในหัวไฟล์):
  - ชั้นสตริงเดิม + กฎใหม่ "จอเต็มทุกใบต้องผ่าน `GateShell` ที่เดียว" (รูปเดียวกับกฎ `DateField`)
  - ชั้นเบราว์เซอร์เดิมวัดแค่หัวแอป ตอนนี้วัด **`GpsGate` ทั้งใบ** (จอเต็มจริงใบเดียวที่ SSR ได้ เพราะไม่ลาก Firebase) **และ `.pill.*` / `.note.*` ทุกรูปแบบที่ CSS ประกาศไว้ บนพื้นสองแบบ** — เลือกวิธี "อ่านรูปแบบจาก CSS" แทนการไล่ลิสต์เอง เพราะเทสที่เขียนว่า *ไม่มีรูปแบบไหนอ่านไม่ออก* โตตามตัวเองได้ ส่วนเทสที่ไล่ชื่อโตไม่ได้
  - **ยังไม่ครอบ และไม่แกล้งว่าครอบ:** หน้าในแอป (Home/Leave/ShiftChange/Inbox/History) import `../api` ซึ่งลาก Firebase จึง SSR ไม่ได้ — เขียนบอกไว้ในหัวไฟล์เทสตรงๆ
- **วิธีตรวจงานหน้าตาครั้งหน้า (ใช้ได้จริง ทำมาแล้วรอบนี้):** สร้าง harness ชั่วคราวที่ import **คอมโพเนนต์จริง + `styles.css` จริง** โดยใช้ vite plugin `resolveId` สลับ `src/api.ts` กับ `src/firebase.ts` เป็น stub (alias ด้วย specifier ไม่พอ เพราะแต่ละหน้าเรียกด้วย path สัมพัทธ์คนละแบบ) → `vite build` → `python3 -m http.server` → Playwright ถ่ายทุกจอ. **`file://` ใช้ไม่ได้ถ้ามี module script** และ **fonts.googleapis.com ยิงจากคอนเทนเนอร์นี้ไม่ออก** ฟอนต์ที่เห็นในภาพจึงเป็น fallback ไม่ใช่ IBM Plex Sans Thai — ตรวจโครง/สี/การล้นกรอบได้ ตรวจ metric ของฟอนต์จริงไม่ได้

### ปิดช่องว่างของดีไซน์ + splash/onboarding (รอบสอง 5 ก.ย. 2569)

> รอบแรกทำเฉพาะจอที่มีข้อมูลจริงแล้วรายงานช่องว่างไว้ เจ้าของงานสั่ง "ทำเลย" และ
> ตามด้วย "ในต้นฉบับมี logo screen loading / onboarding ด้วย อ้างอิงต้นฉบับ 100%"

- **เส้นแบ่งที่ใช้ตัดสินทุกครั้ง: โครงและหน้าตาลอกต้นฉบับ 100% · คำพูดต้องเป็นความจริงของระบบนี้** — หน้าแนะนำที่สัญญาสิ่งที่กดแล้วไม่เจอ ทำให้คนสรุปว่าแอปพัง ไม่ใช่ว่าเรายังไม่ได้ทำ
  - สไลด์ต้นฉบับพูดถึง **สแกน QR · ดูตารางกะ · สลับกะกับเพื่อน · สลิปเงินเดือน · แฟ้มเอกสาร** — ยังไม่มีสักอย่าง จึงเขียนคำใหม่ให้ตรงกับสิ่งที่แอปทำได้ **มีเทสเป็นราวกันตก** (`uiBits.test.ts`) ที่เขียนว่า *ไม่มีสไลด์ไหนอ้างคำต้องห้าม* ไม่ใช่ *สไลด์ที่ 1 ถูกต้อง* — ครอบสไลด์ที่เพิ่มวันหลังด้วย
  - จอ splash ต้นฉบับมีแถบความคืบหน้าค้างที่ **62%** ซึ่งเป็นเปอร์เซ็นต์ที่เราไม่รู้จริง (ไม่มีทางรู้ว่า `employeeMe` เหลืออีกเท่าไร) → ทำเป็น**แถบวิ่ง** บอกว่ายังทำงานอยู่ · และตัดบรรทัด `v2.4.0` ออกเพราะ `package.json` ยังเป็น `0.0.0` — พิมพ์เลขเวอร์ชันที่ไม่มีอยู่จริงคือการโกหกบนจอแรกที่คนเห็น
  - ~~แบรนด์ getmobie → BKK APPLE~~ **ข้อนี้ผิด แก้แล้ว** — ดูหัวข้อถัดไป
- **`shouldShowOnboarding` แทรกก่อนหน้า `login` เท่านั้น และหน้าแนะนำ *ไม่ขอสิทธิ์อะไรจากเครื่องเลย*** — สไลด์สุดท้ายของต้นฉบับมีสวิตช์สิทธิ์สามตัว (ตำแหน่ง/แจ้งเตือน/กล้อง) ถ้าลอกมาตรงๆ จะกลายเป็นการขอพิกัด**ก่อน**รู้ว่าใครใช้อยู่ ซึ่งคือบั๊ก #726 ที่เพิ่งแก้ไป สไลด์สุดท้ายจึงเป็นการ**บอกล่วงหน้า**ว่าจะถูกขออะไร ตัวขอจริงยังเป็นจอ `geo` หลัง `employeeMe` เหมือนเดิม **มีเทสตรึงว่าไม่มีจอไหนนอกจาก `login` ที่โชว์หน้าแนะนำได้**
- **ปุ่มกลมกลางแถบล่าง = `home` (ลงเวลา) ไม่ใช่ปุ่ม "+" ตามรูป** — ปุ่ม "+" ในต้นฉบับไม่มีปลายทางในระบบนี้ ส่วนการลงเวลาคือสิ่งที่คนเปิดแอปมาทำ จึงตรงกับตำแหน่งที่เด่นที่สุดพอดี
- **แถบเลื่อนยืนยัน (`SlideConfirm`) ยังเป็น `<button>` จริง** — คนที่ใช้โปรแกรมอ่านหน้าจอหรือคีย์บอร์ดลาก pointer ไม่ได้ กด Enter/Space ยืนยันได้ตรงๆ. การลากเป็นด่านกัน**กดพลาด**ของนิ้ว ไม่ใช่ด่านความปลอดภัย — ตัวตัดสินจริงยังอยู่ที่ server. `reachedConfirm` แยกเป็นไฟล์ล้วนและ **กัน `max <= 0`** เพราะตอน ref ยังไม่ถูกวัดขนาด การแตะเบาๆ ครั้งเดียวจะลงเวลาให้ทันที
- **`initialsOf` แยกจาก `Avatar.tsx`** เพราะ eslint (`react-refresh/only-export-components`) ห้ามไฟล์คอมโพเนนต์ export ค่าที่ไม่ใช่คอมโพเนนต์ — กฎเดียวกันบังคับให้ `TABS`/`Tab` ไปอยู่ `tabs.ts` และ `reachedConfirm` ไปอยู่ `slideConfirm.ts` ผลพลอยได้คือทั้งสามตัวเทสได้โดยไม่ต้อง render

#### บั๊กที่ 4 ของตระกูลเดียวกัน: กฎของแท็บเอื้อมไปทับปุ่มกลม (คอนทราสต์ 1.16:1)

- `.tabs button[aria-current='true']` มี specificity **(0,2,1)** ซึ่ง**ชนะ** `.tabs .fab` **(0,2,0)** → ไอคอนปุ่มกลมกลายเป็น `color: var(--brand)` บนพื้น `var(--brand-deep)` = **1.16:1 มองแทบไม่เห็น**
- **`tsc`/eslint/เทสเขียวหมด และชั้นเบราว์เซอร์ก็มองไม่เห็น** เพราะมาร์กอัปแถบล่างอยู่ใน `App.tsx` ซึ่ง import Firebase จึง SSR ไม่ได้ — **รูปเดียวกับตอนที่หัวแอปยังอยู่ใน App.tsx เป๊ะๆ** คำตอบจึงเหมือนเดิม: **ย้ายโค้ด** (`TabBar.tsx`) แล้วให้ด่านวัดมัน
- **จับได้เพราะวัดสี ไม่ใช่เพราะดูภาพ** — ในภาพถ่ายไอคอนแค่ "ดูจางๆ" ซึ่งอ่านผ่านได้ง่ายมาก ตัวเลข 1.16 เป็นสิ่งที่ทำให้หยุด
- **ต้องแก้สองข้างตามกฎเดิม**: scope กฎแท็บใต้ `.dock` **และ** ให้ปุ่มกลมประกาศ `color` ของตัวเองทุกสถานะ — และเพราะแต่ละข้างกันบั๊กได้เอง **injection ที่ถอดทีละตัวจึงเขียวถูกแล้ว ต้องถอดเป็นคู่** (กับดักข้อ 1 ของหัวข้อ injection test)
- **บทเรียนที่ทวนเป็นครั้งที่สี่:** ทุกครั้งที่เพิ่มของใหม่เข้าเปลือกแอป ให้ถามว่า *ด่านมองเห็นมันไหม* ก่อนถามว่า *มันสวยไหม* — สามครั้งก่อนหน้าคือหัวแอป (ขาวบนขาว) · ช่องวันที่ (กล่องเปล่า) · ช่องวันที่รอบสอง (แก้หน้าเดียว)

### ชื่อแอปคือ `getmobie` ไม่ใช่ BKK APPLE — และผมเคยตีความกฎแบรนด์ผิด (5 ก.ย. 2569)

- **ที่ผิดคือการตีความ ไม่ใช่ตัวกฎ** — กฎในหัวข้อ Dealer Portal เขียนว่า *touchpoint ฝั่งดีลเลอร์ต้องเป็น GETMOBIE ห้ามหลุด BKK APPLE* และ *BKK APPLE เป็นแบรนด์ฝั่ง "รับซื้อ" (B2C) เท่านั้น* ตอนทำดีไซน์รอบแรกผมอ่านว่า "getmobie = ของดีลเลอร์เท่านั้น" แล้วเปลี่ยนชื่อแอปพนักงานเป็น BKK APPLE ซึ่ง**กลับหัวความหมายของกฎ**
- **ความจริง:** พนักงานเป็นลูกจ้างของ **บริษัท เก็ทโมบี้ จำกัด** ซึ่งเป็นนิติบุคคล ส่วน BKK APPLE เป็นชื่อทางการค้าของสายธุรกิจหนึ่ง แอปภายในของพนักงานจึงต้องใช้ชื่อบริษัท — ต้นฉบับที่เขียน "getmobie for work" ถูกอยู่แล้ว (เจ้าของงานทักเอง)
- **ชื่อมีแหล่งเดียว: `employee-app/src/appName.ts` (`APP_NAME`)** และหน้าจอวาดผ่าน `Wordmark.tsx` ซึ่งเป็นตัวเดียวที่รู้ว่าชื่อถูกตัดครึ่งเพื่อทาสีคนละสี (พื้นสว่างใช้เขียวแบรนด์ · จอโลโก้ใช้เขียวอ่อนตามต้นฉบับ)
- **ด่านสองข้อ ทั้งคู่เขียนเป็น "ไม่มีไฟล์ไหนทำผิด"** (`uiBits.test.ts`): ไม่มี `.tsx` ไฟล์ไหนพิมพ์ชื่อเอง · `index.html` `<title>` กับ `manifest.webmanifest` `name` ต้องขึ้นต้นด้วย `APP_NAME` — สามที่นี้คนละภาษา ไม่มี type ไหนบังคับให้ตรงกัน และ**ตอนเขียนด่านนี้มันจับได้ทันทีว่ายังมีอีกสองที่พิมพ์ชื่อเอง**
- **คอนทราสต์ของครึ่งหลัง (#8fe0d3 บน #0e6f63) วัดได้ 3.97:1** ซึ่ง**ต่ำกว่า 4.5 แต่ผ่านเกณฑ์ตัวอักษรใหญ่ของ WCAG (3:1)** เพราะขนาด 30px — จึงเก็บสีของต้นฉบับไว้ **แต่ด่านตรวจ "ขนาดต้องใหญ่พอที่จะใช้เกณฑ์ 3:1 ได้" ควบไปด้วย** ไม่ใช่ผ่อนเกณฑ์ทิ้งไว้เฉยๆ ใครย่อชื่อลงเมื่อไหร่แดงทันที (injection ยืนยันแล้ว)

### ปิดช่องว่างของดีไซน์ให้ครบทั้ง 8 จอ (รอบสาม 5 ก.ย. 2569)

> เจ้าของงานถามว่า "จุดที่ต่างกันระหว่างต้นฉบับกับที่คุณสร้างขึ้นมาคืออะไร" แล้วสั่ง
> **"เพิ่มฟีเจอร์ทั้งหมดจากต้นฉบับ ขาดตัวไหนเพิ่มได้เลย"**

- **ผมเคยรายงานผิดหนึ่งข้อ และมันเปลี่ยนขอบเขตงานทั้งก้อน** — ตารางในหัวข้อข้างบนเขียนว่าสลิปเงินเดือนกับแฟ้มเอกสาร "ไม่มี callable ไหนคืนข้อมูลนี้ให้พนักงานเลย" ความจริงคือ **ไม่มี callable *ฝั่งพนักงาน*** แต่ **ข้อมูลมีครบ** (`payroll_runs` / `payroll_items` / `employee_files` / `hr_documents` และตัวสร้าง PDF สลิปก็มีแล้ว) — สองจอนั้นจึงทำได้จริงมาตลอด **บทเรียน: "ไม่มี API" กับ "ไม่มีข้อมูล" คนละเรื่อง และผมสรุปข้อแรกจากการไม่เห็นข้อหลัง**
- **โครงนำทางเปลี่ยนจากแท็บแบนเป็น hub-and-detail ตามต้นฉบับ** — สี่แท่น (หน้าแรก · กะงาน · เอกสาร · ฉัน) + หน้าลูกที่มีปุ่มย้อนกลับ. **`nav.ts` เป็นเจ้าของโครงทั้งหมดในรูปตาราง** (`SUB_PARENT` / `SUB_TITLE`) ไม่ใช่ลำดับ `if` ใน JSX — ปุ่มย้อนกลับพาไป**แท่นที่เป็นเจ้าของหน้านั้น ไม่ใช่ประวัติการกด** เพราะคนที่เข้าหน้าขอลาจากแผงทางลัดกับจากหน้าแรกต้องออกไปที่เดียวกัน
- **ปุ่มกลมกลางแถบล่างเปิดแผงทางลัด** (ลงเวลา · ขอลา · สลับกะ) แทนเครื่องหมายบวกลอยๆ ของต้นฉบับที่ไม่มีปลายทาง
- **`Geofence` วาดเอง ไม่โหลดแผนที่** — ต้นฉบับวางกล่อง `MAP PLACEHOLDER · geofence 120 m` ไว้ คำถามที่ภาพต้องตอบมีสองข้อ (อยู่ในรั้วยัง · ห่างอีกเท่าไร) ซึ่ง SVG ตอบได้ครบ **ทิศเป็นทิศจริง ระยะบีบด้วย log แล้วพิมพ์ตัวเลขจริงกำกับเสมอ** — ภาพเป็นตัวช่วยอ่าน ไม่ใช่แหล่งความจริง (server ยังเป็นคนตัดสินรัศมี)
- **ลาครึ่งวัน:** ธง `half_start`/`half_end` เป็นของ**วันหัวและวันท้าย ไม่ใช่ของทั้งใบ** (ลายาวห้าวันแล้วเริ่มบ่ายวันแรกเป็นเรื่องปกติ) · หัก 0.5 **เฉพาะวันที่ถูกนับอยู่แล้ว** (ครึ่งวันที่ตกวันหยุดไม่ทำให้ยอดติดลบ) · **ใบวันเดียวที่ติดธงสองตัวหักครั้งเดียว** ไม่ใช่สองครั้ง. ตรวจแล้วว่า**วันลาไม่ได้ป้อนเข้าการคิดเงินเดือนอัตโนมัติ** (payroll ใช้ `days_worked` ที่ HR กรอกเอง) เศษ .5 จึงไหลไปแค่ยอดสิทธิ์กับหน้าจอ
- **สลับกะกับเพื่อนเป็นสองขั้นเสมอ** (`awaiting_peer` → เพื่อนรับ → `pending` → หัวหน้าอนุมัติ) — **คำขอที่หัวหน้าอนุมัติได้ทันทีโดยเพื่อนไม่เคยรู้ คือการเปลี่ยนกะของคนอื่นลับหลังเขา ซึ่งแย่กว่าไม่มีฟีเจอร์นี้เลย** · อนุมัติแล้ว **เขียนตารางเวรสองฝั่งใน `update()` ก้อนเดียว** (RTDB multi-path = atomic) เขียนทีละฝั่งแล้วล้มกลางทางแปลว่าวันนั้นมีสองคนอยู่กะเดียวกันและอีกกะไม่มีใคร **โดยไม่มีใครเห็นจนถึงวันงาน** · กล่อง "รอฉันตอบ" ใช้ตัวชี้ `shift_swap_inbox/{peerId}/{reqId}` ไม่ไล่อ่าน `shift_requests` ของทุกคน (กฎค่า RTDB) · **คนที่สลับไม่ได้ถูกส่งมาพร้อมเหตุผล ไม่ใช่ถูกกรองทิ้ง** — การหายไปเฉยๆ ทำให้คนไล่หาชื่อเพื่อนที่รู้ว่ามีตัวตนแล้วสรุปว่าแอปพัง
- **แนบเอกสารใบลา = ตัวชี้ไปที่ `employee_files` ไม่ใช่สำเนาที่สอง** · หัวหน้าเปิดดูผ่าน `supervisorLeaveAttachment` ซึ่งตรวจ **สามชั้น**: เป็นลูกน้องตรง · ใบลาเป็นของเขา · **และไฟล์นั้นถูกแนบไว้กับใบนั้น** — **ชั้นที่สามคือชั้นที่สำคัญ** ไม่งั้นมันกลายเป็นประตูอ่านสำเนาบัตรประชาชนของลูกน้องทุกคนโดยอ้างว่าจะอนุมัติใบลา
- **`functions/hr-employee-self.js` = เส้นทาง "ข้อมูลของฉัน" ทั้งหมด** (ตารางกะ · สลิป · แฟ้ม · โปรไฟล์) แยกจาก `hr-employee-portal.js` ซึ่งเป็นเจ้าของ "คำขอและการอนุมัติ" — ทุกตัวส่งออกเป็น **allowlist ไม่ใช่ทั้งแถว** (`payroll_items` มีหมายเหตุภายในของ HR และ `wht_override.by_staff_id` อยู่ด้วย)
  - **สลิปเห็นเฉพาะรอบ `approved`/`paid`** — รอบร่างยังถูกแก้ตัวเลขได้จนถึงวินาทีที่อนุมัติ ถ้าพนักงานเห็นก่อนจะจำเลขที่ยังไม่ใช่เลขจริงแล้วมาทักตอนเงินเข้าไม่ตรง (ฝั่ง HR ออกสลิปฉบับร่างได้เพราะมีคนตรวจอยู่ตรงนั้น — คนละสถานการณ์)
  - **ตารางกะต้องผ่าน `resolveShift` ไม่ใช่อ่าน `shift_roster` ตรง** — วันที่ไม่มีแถวตกไปที่ `default_shift_id` ถ้าจอนี้อ่านเอง พนักงานจะเห็น "วันหยุด" แล้วไม่มาทำงาน ทั้งที่ระบบจะบันทึกว่าขาดงาน
  - **หนังสือเตือนไม่อยู่ในลิสต์ที่เปิดดูเองได้** — ไม่ใช่ความลับจากเจ้าตัว แต่การให้รู้จากแอปก่อนหัวหน้าได้คุยด้วย เป็นการส่งข่าวแบบที่ระบบไม่ควรเป็นคนทำ
  - **สรุปเดือนนี้รายงาน "ชั่วโมงทำงาน" ไม่ใช่ "โอทีสะสม" ตามดีไซน์** — ระบบลงเวลาไม่ได้เก็บโอที (โอทีเกิดที่รอบเงินเดือนในฐานะรายการรายได้ที่ HR กรอก) การเอา `worked_min` มาเรียกว่าโอทีคือการประกาศตัวเลขที่ไม่มีใครรับรอง
- **จอ/ปุ่มที่ยังไม่ทำ และเป็นการตัดสินใจ ไม่ใช่การลืม:** สแกน QR หน้างาน (**QR ที่ติดไว้เฉยๆ ถ่ายรูปส่งให้เพื่อนได้ มันจึงไม่พิสูจน์ว่าใครอยู่ตรงนั้น** การทำให้พิสูจน์ได้ต้องเป็นรหัสที่หมุนบนจอที่สาขา = ระบบใหม่ทั้งชุด) · ปุ่ม "ขอเอกสารจาก HR" (ยังไม่มีเส้นทางรับคำขอ) · ปุ่ม "จัดเรียง" เมนู (ไม่มีที่เก็บลำดับที่ผู้ใช้จัดเอง) · ลิงก์บัญชีธนาคาร/ตั้งค่าความปลอดภัย (แก้จากแอปไม่ได้ — เลขบัญชีอยู่ในแฟ้มลับ รหัสผ่านรีเซ็ตโดย HR) · เอกสารที่ HR ออกให้ยังเปิดไฟล์จากแอปไม่ได้ (ตัวสร้าง PDF อยู่ฝั่ง HR ยังไม่มี callable ให้เจ้าตัวสั่งพิมพ์ซ้ำ) **แสดงเลขที่+วันที่ไว้ให้อ้างอิง พร้อมเขียนบอกตรงๆ ดีกว่าใส่ปุ่มที่กดแล้ว error**

#### ด่านใหม่สามไฟล์ และรูที่ injection จับได้ในตัวด่านเอง

- **`employee-app/src/nav.test.ts`** — ข้อที่สำคัญที่สุดคือ **"ทุกจอที่โมเดลรู้จัก มีคนวาดใน App.tsx จริง"**: พอแอปเป็นสิบจอ การเพิ่มจอเข้า `nav.ts` แล้วลืมต่อสายจะได้ **หน้าว่างเปล่า** ที่ไม่มี error ไม่มีเทสแดง และไม่มีใครเจอจนกว่าจะมีคนกดปุ่มนั้น
- **`functions/test/hr-employee-self.test.mjs`** · **`functions/test/hr-shift-swap.test.mjs`** — ตาราง injection 18 ข้ออยู่ในหัวไฟล์ รวมข้อที่เขียวพร้อมเหตุผล
- **injection จับรูใน *ตัวด่าน* ได้สองตัวในรอบนี้ ไม่ใช่ในโค้ด:**
  1. assert "ไม่รับ `employeeId` จาก body" เขียนเป็น `/data\.employeeId/` แล้ว injection ที่เขียน `(request.data || {}).employeeId` **ลอดผ่าน** เพราะข้างหน้าจุดเป็นวงเล็บปิด — `git status` สะอาด จึงไม่ใช่เคสงานหาย. แก้เป็น **"ไม่มีการอ่าน `.employeeId` เลย"** ซึ่งตรงกับความจริงของไฟล์นั้นและลอดด้วยการเปลี่ยนวิธีเขียนไม่ได้
  2. เทส "callable อ่านอย่างเดียว" เขียนเป็น `/\.(set|update|push)\(/` แล้วไปโดน `days.push()` ซึ่งเป็นอาร์เรย์ธรรมดา **แดงทั้งที่โค้ดถูก** — แก้โดยตามโซ่จาก `db.ref(` ถึงจบ statement (บทเรียน P3-c: รัดขอบเขต ไม่ใช่ผ่อน assert)
- **`.fab[aria-current]` กลายเป็นกฎที่ไปไม่ถึง** ตอนปุ่มกลมเปลี่ยนจาก "แท็บที่เปิดอยู่" เป็น "ตัวกางแผงทางลัด" — injection ที่ถอดมันจึง**เขียวถูกแล้ว**. ตามกฎ "ด่านที่ไปไม่ถึง ให้ลบ ไม่ใช่ ship" จึงย้ายไป `[aria-expanded='true']` ซึ่งเป็นสถานะที่เกิดจริง แล้ว injection ตัวเดิมแดงทันทีที่ 1.00:1

### แก้และยกเลิกใบลาจากแอป

- **`employeeLeaveUpdate` แก้ใบในที่เดิม ไม่ใช่ยกเลิกแล้วยื่นใหม่** — สองคำสั่งที่ล้มกลางทางได้แปลว่าใบเดิมหายแล้วใบใหม่ไม่เกิด. แก้ได้เฉพาะใบที่ยัง `pending` (กฎเดียวกับการยกเลิก: วันลาที่อนุมัติแล้วถูกนับเข้ายอดและอาจจัดเวรแทนไปแล้ว)
- **`draft.id` คือทั้งหมดของเรื่องนี้** — `validateLeaveRequest` รับ `id` เพื่อ**ข้ามใบที่กำลังแก้**ทั้งตอนเช็คช่วงทับและตอนรวมวันที่ใช้ไปแล้ว ไม่ส่ง = ทุกการแก้ถูกปฏิเสธว่า "ทับกับใบลาที่มีอยู่แล้ว" โดยชนกับตัวเอง. **`employeeLeavePreview` ต้องส่ง `requestId` ด้วย** ไม่งั้นตัวเลขบนจอบอกว่ายื่นไม่ได้ทั้งที่กดบันทึกแล้วผ่าน
- **`edited_at` มีคนอ่านจริงสองที่** (ลิสต์ของพนักงานเอง + กล่องอนุมัติของหัวหน้า) — หัวหน้าต้องรู้ว่าใบนี้ถูกแก้หลังยื่น ไม่ใช่ใบที่ยื่นมาแบบนี้ตั้งแต่แรก. เพิ่มเข้า `publicRequest` แล้ว (ฟิลด์ที่เขียนแล้วไม่มีใครอ่าน = ของที่หายเงียบๆ ตามบทเรียน `status_history`)
- **`days`/`paid_days`/`unpaid_days` คำนวณใหม่ฝั่ง server ทุกครั้ง ห้ามรับจาก client** — รับเมื่อไหร่ พนักงานยิง callable ตรงๆ ก็ประกาศเองได้ว่าลา 1 วันทั้งที่หายไปทั้งสัปดาห์

### ฝั่ง server

- **`functions/hr-attendance.js` (ล้วน) = เจ้าของกติกาทั้งหมด** — รั้วพิกัด กะข้ามเที่ยงคืน สาย/ออกก่อน. ฝั่งแอปคำนวณระยะเองเพื่อ**บอกก่อนกด**เท่านั้น ไม่ใช่สำเนาของกฎ
- **เวลาที่บันทึกคือเวลาของ server เสมอ** — นาฬิกาเครื่องตั้งเองได้ และเป็นช่องที่ง่ายที่สุดในการย้อนเวลาเข้างาน (เทสสแกนว่า `const now` ทุกจุดเป็น `nowMs()`)
- **`Number(null) === 0` และ 0 เป็นละติจูดที่ถูกต้อง** (อ่าวกินี) — พิกัดที่หายไปต้องไม่กลายเป็น (0,0) เงียบๆ ทั้งฝั่งพิกัดคนและพิกัดสาขา (`realNumber` / `coordsOf`)
- **ไม่มีกะในตาราง = ยังเช็คอินได้** ติดธง `no_shift` ไว้แทน — บล็อกคนเพราะแอดมินยังไม่ได้จัดเวรคือการลงโทษคนผิดคน · **ออกงานนอกรัศมี = ผ่าน** ติดธง `out_outside` — ไม่งั้นแถวค้างเปิดตลอดไปแล้วอ่านว่า "ยังทำงานอยู่"
- **กะข้ามเที่ยงคืนผูกกับวันที่กะ *เริ่ม*** (`attendanceDayFor`) — ผูกตามนาฬิกาจะได้สองแถวที่ต่างก็ไม่สมบูรณ์ วันแรกอ่านว่า "ไม่ได้ออกงาน" วันหลังอ่านว่า "ไม่ได้เข้างาน"
- **เขียนด้วย transaction** — กดสองครั้งพร้อมกัน (เน็ตกระตุกแล้วกดซ้ำ) ต้องได้แถวเดียว ไม่ใช่เวลาเข้างานถูกเขียนทับด้วยครั้งที่สอง
- **`attendance/{employeeId}/{YYYY-MM-DD}` และ `shift_roster/{employeeId}/{YYYY-MM-DD}`** ซ้อนใต้ id เพื่อให้อ่านของคนเดียวโดยไม่ต้องมี `.indexOn` (หลักเดียวกับ `audit_log`) · โหนดใหม่ทั้งคู่ไม่มี rule = ตกกฎ root `.read/.write: false` → **ไม่ต้อง deploy rules** และพนักงานอ่าน RTDB ตรงไม่ได้เลย ทุกอย่างผ่าน callable
- **ตัวตนมาจาก auth token เท่านั้น** (`requireEmployeeCaller` ใน `hr-employee-auth.js`) — ไม่มี callable ไหนรับ `employeeId` จาก body ในเส้นทางของเจ้าตัว. จับคู่ผ่าน `employees/{id}/links` (`auth_uid` / `rider_id` / `staff_id`) และ **พ้นสภาพแล้วใช้แอปไม่ได้** ซึ่งเป็นด่านที่สองต่อจากการปิดบัญชี Auth (ด่านแรกล้มกลางทางได้ — ธง `stale_access`)
- **กติกาการลาไม่ได้เขียนใหม่** — `validateLeaveRequest` ตัวเดียวกับที่ฝ่ายบุคคลใช้ (`hr-leave.js`) สูตรสองชุดแปลว่าพนักงานกับ HR เห็นยอดคงเหลือคนละเลข. `publicRequest`/`loadPolicy`/`loadRequests` export จาก `hr-leave-api.js` มาใช้ร่วม
- **หัวหน้าอนุมัติได้เฉพาะลูกน้องตรง** (`employees/{id}/supervisor_id` ชี้มาที่แฟ้มเขา) ไม่ใช่ทั้งแผนก และ**ไม่ใช่ตัวเอง**. `supervisorChainError` (`hr-core.js`) กันวงกลม — A มีหัวหน้าเป็น B และ B มีหัวหน้าเป็น A แปลว่าใบลาของทั้งคู่ไม่มีใครอนุมัติได้ **และมันไม่ error ที่ไหน มันแค่เงียบ**
- **อนุมัติคำขอเปลี่ยนกะ = เขียน `shift_roster` จริง** ไม่ใช่แค่ติดสถานะ — คำขอที่อนุมัติแล้วแต่ตารางไม่เปลี่ยน คือคำสัญญาที่ระบบไม่ได้ทำตาม และคนจะรู้ตอนมาเช็คอินแล้วกะไม่ตรง

### ฝั่งแอดมิน

- **หน้า `/hr/shifts`** (`src/pages/hr/Shifts.tsx`, CEO/HR) — นิยามกะ (`settings/hr/shifts`) · รัศมี/ความแม่นยำ (`settings/hr/attendance`) · ตารางเวรรายสัปดาห์ · การลงเวลารายวัน. **`update()` รายคีย์เท่านั้นที่ `settings/hr`** ตามกฎเดิมของ `HrSettings.tsx`
- **ตารางเวรส่งเฉพาะเซลล์ที่เปลี่ยน** (`rosterDiff`) — เปิดหน้าแล้วกดบันทึกเฉยๆ ต้องไม่เขียนทับเวรที่คนอื่นเพิ่งแก้ และ `null` (ลบเวร) ต้องต่างจาก "ไม่ได้แตะ"
- **พิกัดสาขามาจาก `settings/branches`** — สาขาที่ไม่ได้ปักหมุดใช้ลงเวลาไม่ได้ (ถูกตัดออก ไม่ใช่ถือว่าอยู่ที่ (0,0))
- **`supervisor_id` / `default_shift_id` ตั้งในแฟ้มพนักงาน** (`/employees`) — ไม่ตั้งหัวหน้า = ไม่มีใครอนุมัติจากแอปได้ ต้องให้ฝ่ายบุคคลกดแทน

### ต้องทำครั้งเดียวก่อนใช้จริง

1. site `bkk-apple-employee` ถูกสร้างอัตโนมัติโดย workflow แต่ **custom domain ต้องผูกเองใน Firebase console** ถ้าจะใช้ชื่ออื่น
2. เพิ่มโดเมนของแอปใน **Auth > Authorized domains**
3. ตั้งพิกัดสาขาให้ครบที่หน้าจัดการสาขา — ไม่มีพิกัด = ทั้งสาขาลงเวลาไม่ได้
4. ผูกบัญชี Auth เข้ากับแฟ้มพนักงาน (`links.staff_id` / `auth_uid`) — **ไม่ผูก = เข้าแอปไม่ได้** ขึ้นข้อความ "ยังไม่ได้ผูกกับแฟ้มพนักงาน"

## Audit log (/audit-log) — คนละเรื่องกับ "ประวัติพนักงาน" และนั่นคือทั้งเหตุผลที่มันมี

> ก่อนหน้านี้ `employee_events` ถูกใช้เป็นทั้ง audit log และประวัติพนักงานพร้อมกัน แล้วเลยทำได้ไม่ดีสักอย่าง — อาการบนจอคือบรรทัด "ปรับเงินเดือน" ที่ต้องเขียนแก้ตัวว่า *"ระบบไม่ได้บันทึกจำนวนเงินไว้ในประวัติ"* ซึ่งมาจาก writer ที่เขียน `from: null, to: null` เพราะกลัวข้อมูลอ่อนไหวรั่วในโหนดที่คนอ่านกว้าง

- **สองอย่างนี้ต้องการสิ่งตรงข้ามกัน ห้ามยุบกลับ:** *audit log* ต้องมีค่าเก่า→ค่าใหม่ (ไม่งั้นตอบคำถามเดียวที่มันมีไว้ตอบไม่ได้) และคนอ่านแคบ · *ประวัติพนักงาน* เป็นเรื่องของ **คน** (ทำงานมากี่ปี เคยอยู่ตำแหน่งไหน) คนอ่านกว้างกว่า และเป็นของที่ **คำนวณ** จาก audit + ข้อมูลจริง (`functions/employee-history.js`) **ไม่ใช่โหนดที่สาม**
- **ไฟล์ที่เป็นเจ้าของกติกา:** `functions/audit-log.js` (ล้วน มีเทส — allowlist ฟิลด์ + การ mask + สารบัญ action + ป้าย) · `functions/audit-log-api.js` (callable `adminAuditLogList`) · `src/pages/admin/AuditLog.tsx` + `auditLogView.ts` (หน้าจอ)
- **`audit_log/{entity}/{entityId}/{pushId}` ซ้อนใต้ entity โดยตั้งใจ** — อ่านของคนเดียวคืออ่าน subtree เล็กๆ **ไม่ต้องมี `.indexOn`** ซึ่งอยู่ในไฟล์กฎของอีกรีโป (และเป็นหนี้ที่ `employee_events` ติดอยู่ทุกวันนี้). โหนดนี้ไม่มี rule ของตัวเอง = ตกกฎ root `.read/.write: false` → Admin SDK เขียนได้ ลูกค้าอ่านไม่ได้ **ไม่ต้อง deploy rules**
- **CEO เท่านั้น และแคบกว่า `HR_ROLES` โดยตั้งใจ** — หน้านี้รวมค่าเก่า→ค่าใหม่ของทุกฟิลด์ที่เฝ้าอยู่ (เงินเดือนทุกคน ทุกครั้งที่เคยขยับ) ซึ่งกว้างกว่าการเปิดแฟ้มทีละคนมาก คนที่ทำงาน HR ประจำวันไม่ต้องใช้มัน
- **append-only — ไม่มี callable ที่แก้หรือลบ และห้ามเพิ่ม** ถ้าวันหนึ่งต้องลบตามคำขอ PDPA ให้เขียนสคริปต์ที่ทิ้งร่องรอย ไม่ใช่เปิดปุ่มลบบนหน้าเว็บ (เทสสแกนโซ่ `db.ref(...)` ว่ามีแต่เมธอดอ่าน)
- **allowlist ต่อฟิลด์ = fail-safe:** ฟิลด์ที่ไม่อยู่ใน `AUDIT_FIELDS` ถูกบันทึกว่า **"เปลี่ยน" โดยไม่เก็บค่า** (ธง `withheld`) ฟิลด์อ่อนไหวที่ใครเพิ่มวันหน้าจึงไม่ไหลลง audit เองโดยไม่มีใครตัดสินใจ (หลักเดียวกับ `PUBLIC_TRACK_FIELDS`) · ตัวระบุตัวบุคคล (เลขบัตร/เลขบัญชี/เบอร์/อีเมล) **mask เหลือ 4 ตัวท้ายเสมอ** ส่วนข้อเท็จจริงทางธุรกิจ (เงินเดือน ตำแหน่ง สถานะ) **เก็บเต็ม** เพราะนั่นคือสิ่งที่ระบบนี้มีไว้ตรวจ
- **หน้าเว็บต้องแยก "ไม่เก็บค่าไว้" ออกจาก "ค่าว่าง" เสมอ** — วาด `withheld` เป็น "ว่าง → ว่าง" แปลว่าคนอ่านสรุปว่าไม่มีอะไรเกิดขึ้น ทั้งที่ความจริงคือมีบางอย่างเปลี่ยนแต่ระบบตั้งใจไม่เก็บว่าเปลี่ยนเป็นอะไร (มีเทส)
- **ป้ายฟิลด์/ป้าย action มาจาก server ที่เดียว** (`auditFieldMeta` / `AUDIT_ACTION_LABEL` ส่งมาใน response ตอนอ่าน) — **ห้ามมีตารางป้ายชุดที่สองฝั่ง UI** (กฎเดียวกับ `checklistFor` ของหน้าเอกสาร) และ **ไม่ฝังป้ายลงแถวที่เก็บ** เพราะแถว audit เก็บถาวรและมีจำนวนมาก ป้ายที่ฝังไว้จะค้างเป็นคำเก่าเมื่อวันหนึ่งเราเรียกฟิลด์นั้นด้วยคำใหม่
- **`AUDIT_ACTIONS` ต้องมีผู้เขียนจริงทุกค่า** — ตอนร่างครั้งแรกลิสต์มี `deleted` กับ `account_issued` ติดมาด้วยทั้งที่ไม่มีโค้ดบรรทัดไหนเขียนเลย = หน้าเว็บสัญญาว่าตอบสองคำถามที่มันตอบไม่ได้ (กฎ "ด่านที่ไปไม่ถึง ให้ลบ ไม่ใช่ ship"). วันนี้เหลือ 3 ตัวและมีผู้เขียนครบ: `created` (`createEmployeeRecord` — **seam เดียว ครอบทั้งทางทะเบียนและทางกดจ้างผู้สมัคร**) · `updated` (`adminHrEmployeeUpdate`, `adminHrEmployeeSetStatus`) · `account_revoked` (การปิดบัญชีตอนพ้นสภาพ). จะเพิ่ม `account_issued` ต้องไปเสียบที่ `adminStaffCreate` (`staff-accounts.js`) **ไม่ใช่เดาจากการ "ผูกบัญชี" ใน `adminHrEmployeeLink` (ผูก ≠ ออกบัญชี)**
- **`fields` ที่ส่งให้ `recordAudit` ต้องมาจาก `auditFieldsFor(entity)` ไม่ใช่ลิสต์ที่พิมพ์มือ** — ลิสต์ที่พิมพ์ไว้ที่ call site คือสำเนาที่สองของ allowlist ซึ่งจะเงียบเมื่อมีคนเพิ่มฟิลด์เข้า `AUDIT_FIELDS` แล้วลืมแก้ call site (ฟิลด์นั้นจะไม่ถูก audit เลยโดยไม่มีอะไรบอก) — เคยเป็นลิสต์ 18 ชื่อจริงๆ
- **แถวตอนสร้างแฟ้มคือแถวที่สำคัญที่สุด** — "ใครเอาคนนี้เข้าทะเบียนเงินเดือน และตั้งเงินเดือนเริ่มต้นไว้เท่าไร" ถ้าเก็บเฉพาะการแก้ทีหลัง คนที่ถูกสร้างมาพร้อมเงินเดือนสูงแล้วไม่เคยถูกแก้เลยจะไม่มีแถวไหนเล่าถึงเขา
- **โหมด "ทุกคน" อ่าน subtree ของแต่ละคนแยกกัน ไม่กวาดโหนด `audit_log`** (กฎค่า RTDB) เพดาน `MAX_ENTITIES = 200` / `MAX_ROWS = 400` **ชนเพดานต้องขึ้นบนหน้า ไม่ตัดเงียบ** — audit log ที่ตัดท่อนต้นทิ้งโดยไม่บอกคือ audit log ที่ตอบผิดเรื่อง "เปลี่ยนครั้งแรกเมื่อไหร่". โตจนตัวเลขนี้ไม่จริงเมื่อไหร่ ต้องเพิ่ม index แล้ว query ตามเวลา **ไม่ใช่ขยายเพดานไปเรื่อยๆ**
- **อย่าสับสนกับ `FinanceAuditLog.tsx`** (`src/pages/finance/components/`) — ตัวนั้นคือรายการเดินบัญชีของ `/transactions` (เงินเข้า-ออก) ชื่อพ้องกันเฉยๆ คนละโหนด คนละคำถาม หน้านี้ตอบว่า *ใครแก้ข้อมูล* ไม่ใช่ *เงินไปไหน*
- **ด่าน:** `functions/test/audit-log.test.mjs` (กติกาการเก็บ/mask) + `functions/test/audit-log-writers.test.mjs` (สารบัญตรงกับผู้เขียนจริง · call site ดึงลิสต์จาก allowlist · callable อ่านอย่างเดียว) + `src/pages/admin/auditLog.test.tsx` (การจัดรูปบนจอ) — ตาราง injection อยู่ในหัวไฟล์ทั้งสาม

## Search Analytics (/analytics/search) — ตัวอ่านของตาราง Firestore
- **หน้า `/analytics/search`** (`src/pages/analytics/SearchAnalytics.tsx`, CEO/MANAGER, กลุ่ม Analytics ใน AdminLayout) — ตอบ 3 ชั้นตามโจทย์: ลูกค้าค้นหาอะไร · ระบบตอบอะไรกลับไป · ลูกค้าทำอะไรต่อ
- **ข้อมูลอยู่ Firestore ของ project เดียวกัน เขียนโดยเว็บลูกค้า** (`bkk-frontend-next` — ดู CLAUDE.md ของ repo นั้นสำหรับ schema/redaction/TTL) repo นี้เป็นแค่**คนอ่าน** ห้ามเขียน
- **ต้องผ่าน callable `adminSearchAnalytics` เท่านั้น ห้ามให้หน้าเว็บอ่าน Firestore ตรง** — `firestore.rules` ปฏิเสธทุก path เพราะแอปนี้เช็คสิทธิ์จาก `/admins/{uid}` ซึ่งอยู่ใน **RTDB** และ**กฎ Firestore อ่าน RTDB ไม่ได้** จะ gate ตรงๆ ต้องมีสำเนาตารางพนักงานตัวที่สองซึ่งแย่กว่า. gate = `lookupStaffByAuth` + `READ_ROLES` (CEO/MANAGER) ตัวเดียวกับ route guard ใน App.tsx — **สิทธิ์นี้เป็นส่วนหนึ่งของการชั่งน้ำหนักตาม PDPA ที่บันทึกใน RoPA Activity 11 ไม่ใช่แค่การจัดเมนู ห้ามเปิดกว้างโดยไม่ทบทวน RoPA**
- **join 2 ชั้นและต่างกันโดยตั้งใจ:** *คลิก* ผูกด้วย `sid` แม่นยำ (เกิดบน `/search` ที่รู้ sid) · *ดีลจริง* join ด้วย **uid + หน้าต่าง 24 ชม.** เพราะการร้อย `sid` ผ่าน `/sell` → `/cart` → `/checkout` → `validateAndCreateOrder` = แก้เส้นทางสร้างออเดอร์ซึ่งเป็นโค้ดที่พังไม่ได้ที่สุด เพื่อความแม่นที่ทราฟฟิกระดับนี้ (วัดจริง ส.ค. 2569 ~40 ค้นหา/วัน) ยังไม่ต้องการ. **ทราฟฟิกโตสิบเท่าเมื่อไหร่ค่อยกลับมาร้อย sid**
- **ตัวหารของ conversion คือการค้นหาที่มี uid เท่านั้น** ไม่ใช่การค้นหาทั้งหมด — การค้นหาที่ไม่มี uid join กับออเดอร์ไม่ได้เลย เอามารวมในตัวหารจะได้ conversion ที่ต่ำกว่าจริงโดยไม่มีใครรู้ว่าต่ำเพราะอะไร
- **query `/jobs` ตาม index `uid` เท่านั้น ห้ามกวาดทั้ง node** (กฎค่า RTDB) และมีเพดาน `MAX_UID_LOOKUPS` · เพดานแถวทุกตัวถ้าชนจะ**บอกบนหน้า** ไม่ตัดเงียบ
- **`overview_key` = คีย์ join ไปหา `search_overview_archive`** (โหนดที่ K5 เขียน) — เว็บลูกค้าเก็บ hash ที่ `customerSearchOverview` ส่งกลับมาไว้บนแถวของตัวเอง ทำให้ต่อสองครึ่งได้: ฝั่ง Firestore ถือ**คำถาม** (redact แล้ว) ฝั่ง RTDB ถือ**สิ่งที่มีแต่ generator รู้** (model/latency/เหตุผลที่ปฏิเสธ) โดยไม่มีใครต้องเก็บข้อความของอีกฝั่ง · **ห้าม join ด้วย query text หรือเวลา**
- **`source` แยก `template` ออกจาก `ai`** — เส้นทาง template (C3) ไม่เรียก generator จึง `overview_key = null` **โดยนิยาม** ไม่ใช่ข้อมูลหาย หน้า dashboard เขียนกำกับไว้แล้ว **ห้ามลบหมายเหตุนั้น** เพราะคนอ่านจะนึกว่าท่อพัง
- **ไม่มีไทม์ไลน์รายคนในหน้านี้โดยตั้งใจ** — Session Monitor ของเว็บลูกค้า (`/admin/sessions`) ทำอยู่แล้ว หน้านี้ลิงก์ไปแทนการสร้างตัวที่สอง
- **ตัวเลข `unverified` ตีความให้ระวัง** — คำถามเรื่องบริการ (ค่าส่ง/สาขา) ขึ้นได้แม้ตัวเลขถูก เพราะ `customerSearchOverview` โหลด service facts เพิ่มเองฝั่งนี้ ซึ่งตัวตรวจฝั่งเว็บ (ที่เทียบกับ context ที่มันส่งมา) มองไม่เห็น หน้าเว็บเขียนหมายเหตุนี้ไว้แล้ว **ห้ามลบ**

## สวิตช์การแจ้งเตือน (settings/notifications)
- **หน้า `/notification-settings`** (`src/pages/admin/NotificationSettings.tsx`, CEO/MANAGER) = ที่รวมการตั้งค่าแจ้งเตือนทั้งระบบ. ก่อนหน้านี้กระจายอยู่ 3 ที่ (การ์ดสถานะ push ใน `/mobile/notifications`, สวิตช์อีเมลใน `/accounting-settings`, permission strip ในคอนโซลแชท) + env-only อีก 2 ตัว
- **สิ่งที่หน้านี้เป็นเจ้าของจริง** = `settings/notifications` เท่านั้น: `channels {admin_push, rider_push, telegram}` + `events {new_ticket, status_change, chat_message, approval, field_ops, system_alert}`. ค่าที่เจ้าของอยู่หน้าอื่น (อีเมล = `settings/accounting/order_emails_enabled`, SLA ข้อเสนอ, เกณฑ์ flag ไรเดอร์) หน้านี้แค่**โชว์สถานะ + ลิงก์ไป** ห้ามเขียนทับ — กันสองหน้าแก้ฟิลด์เดียวกัน. ข้อยกเว้นเดียวคือ `settings/system/rider_overdue_min` ซึ่งเดิม**ไม่มี UI เลย** จึงให้หน้านี้เป็นเจ้าของ
- **การ gate ทำฝั่ง server** ที่ `functions/notification-settings.js` (`shouldNotify`) — เสียบไว้ที่ choke point ทุกตัวที่ยิง push จริง: `dispatchAdminPush`, `pushToRider`, `dispatchTelegram`, `dispatchAmendmentPush` (มี branch ที่ยิง `getMessaging()` ตรง เลี่ยง dispatchAdminPush ได้) และ push ของ `sickw-daily`. **เพิ่มที่ยิง push ใหม่ = ต้องเสียบ gate ด้วย** ไม่งั้นสวิตช์ปิดแล้วยังเด้ง
- **ตัดสินจาก `message.data.type`** ผ่าน map `EVENT_CATEGORY` → หมวดที่โชว์ใน UI. **fail-open ทุกทาง**: type ที่ไม่อยู่ใน map / ไม่มี node / อ่านพัง = ส่งตามเดิม มีแต่ `false` ที่แอดมินเขียนเองเท่านั้นที่ปิด. push ทดสอบ (`sendTestAdminPush`) ไม่ถูก gate โดยตั้งใจ — เป็นเครื่องมือ diagnose
- **MIRROR 2 ที่:** หมวด/ช่องทาง/ค่า default อยู่ทั้ง `functions/notification-settings.js` (JS, ตัวที่ gate จริง) และ `src/utils/notificationSettings.ts` (TS, label ของ UI) — functions import TS ไม่ได้ **เพิ่มหมวดต้องแก้ทั้งคู่ + map `data.type` ฝั่ง server**
- `settings/notifications` อยู่ใต้ `settings` จึงใช้ rule เดิม (read = auth, write = admin) **ไม่ต้อง deploy rules ใหม่**

## ค่ารอบไรเดอร์ — สถานะ Waived + ด่านบัญชีเจ้าของ/ไม่มีไรเดอร์ (5 ก.ย. 2569, PR #731)

> ที่มา: บัญชีไรเดอร์ของเจ้าของบริษัทได้ค่ารอบเข้ากระเป๋า 129 แถว (Σ ~45,659) จากปุ่ม batch รุ่นเก่า
> ของ `RiderSettlements` (#522 `rider_fee || 150` ไม่กรองใคร) + การอนุมัติจาก `/rider-audit` และงาน
> Store-in/Mail-in 26 ใบได้ค่ารอบขั้นต่ำจาก trigger ทั้งที่ไม่มีไรเดอร์ **กติกา: เจ้าของต้องไม่มีค่ารอบเข้า
> กระเป๋าเลย ไม่ว่างานวันไหน** — survey เต็ม `docs/reports/2026-09-05-owner-rider-wallet-reversal-survey.md`

- **`rider_fee_status` มี 3 ค่า `Pending | Paid | Waived`** ประกาศที่ `functions/rider-fee-status.js` (ตัวจริง) MIRROR
  `src/types/riderFeeStatus.ts` + `bkk-rider-app/src/types/riderFeeStatus.ts` — ด่าน `src/utils/riderFeeStatusParity.test.ts`
  (อ่านสำเนาแอปไรเดอร์เมื่อ checkout ข้างกัน; ฝั่งนั้นอ่านกลับผ่าน sparse-checkout ใน CI). **Paid/Waived เป็นปลายทาง**
  ตัวเขียน Pending ทุกตัว (trigger, pin-dispute, แอปไรเดอร์ตอนส่งมอบ) ต้องไม่ทับ — ใช้ `pendingFeeStatusPatch`
  - **PAID อยู่ท้าย object โดยไม่มี trailing comma โดยตั้งใจ** — `statusLiteralCensus.test.ts` นับ `'Paid',` เป็นการเทียบ
    สถานะงาน (Paid เป็นทั้งสถานะงานและสถานะค่ารอบ ตัวจำแนกแยกไม่ออก) ลำดับ values ต้องตรงกันทุกสำเนา
- **การอนุมัติ/ยกเว้นค่ารอบไม่เขียนจากเบราว์เซอร์อีกแล้ว** — `/rider-audit` เรียก callable `adminRiderFeeApprove`
  (CEO/MANAGER) / `adminRiderFeeWaive` (CEO/MANAGER/FINANCE, reason บังคับ, หลายใบ) / `adminRiderFeeConfig`
  (`functions/rider-fee-admin-api.js`) ผ่าน `src/utils/riderFeeAdmin.ts` ตัวเดียว. `buildRiderFeeApproval` ย้ายจาก
  `src/utils/riderSettlement.ts` ไป `functions/rider-fee-guard.js` เพราะด่านในเบราว์เซอร์ข้ามได้ด้วย console (rules อนุญาต
  admin เขียน `/transactions` ทุกรูป) ฝั่ง client เหลือ `riderFeeBlockReason` เป็น UX (ป้าย + ปิด checkbox) ที่ parity กับ JS
  - `statusWriterCensus` ลด 77 → 74 ตามนั้น **ห้ามเพิ่ม client write ของงานค่ารอบกลับมา** ทุกอย่างผ่าน callable หรือสคริปต์ admin
- **ด่านถาวร (`functions/rider-fee-guard.js`, pure):** rider_id ว่าง (รวมสตริงว่างที่ปุ่ม batch เก่าปล่อยผ่าน และ `cancelled_by`
  ที่ไม่ใช่ `rider:{id}`) หรือ rider อยู่ใน **`OWNER_RIDER_IDS`** → `assertRiderFeePayable` throw. callable อนุมัติที่เจอใบชนด่าน
  แม้ใบเดียว = **ปฏิเสธทั้งชุด ไม่เขียนอะไร** (เขียนครึ่งชุดแล้วรายงานว่าข้ามคือของที่ไม่มีใครอ่าน)
  - **`OWNER_RIDER_IDS` อ่านจาก env ของ functions (คั่นด้วย `,`) ไม่มี uid ในโค้ด** — GitHub Secret ชื่อเดียวกัน CI เขียนลง
    `functions/.env` (`firebase-hosting-deploy.yml`). **ไม่ตั้ง = callable อนุมัติปฏิเสธทุกใบ (fail closed)** และหน้า /rider-audit
    ขึ้นป้ายแดง. เปลี่ยน secret แล้วต้อง Run workflow ด้วยมือ (กับดักเดิมในหัวข้อ env vars)
- **`/rider-audit`:** ใบ Waived ซ่อน default (สวิตช์ "ดูใบที่ยกเว้น") · ใบไม่มีไรเดอร์แยกส่วน "ไม่มีไรเดอร์" **ไม่มีปุ่มจ่าย** มีแต่ยกเว้น ·
  ใบบัญชีเจ้าของขึ้นป้าย ติ๊กจ่ายไม่ได้ · Waive ต่อใบ/หลายใบ ถาม reason ผ่าน prompt. `RiderSettlements` (แท็บ finance) อ่านอย่างเดียว
  โดยโครงสร้าง — ไม่ import อะไรที่เขียน RTDB ได้
- **`onJobHandedOverCalcRiderFee` มีด่านร่วมสองทางเข้าแล้ว** (`feeCalcBlockReason` ใน `rider-fee-trigger.js`): ไม่ใช่ Pickup หรือ
  rider_id ว่าง = ไม่คำนวณ ไม่ตั้ง status. ก่อนหน้านี้สองด่านอยู่เฉพาะบล็อกตาข่าย ทางหลัก (Pending QC) จึงคิด `min_fee` ให้
  Store-in/Mail-in (`computeRiderFee` ไม่มีทางคืน "ไม่มีค่ารอบ")
- **กลับรายการของเก่า = `scripts/reverse-owner-rider-payouts.cjs`** (dry-run default, `--apply`, `--rider` ต้องอยู่ใน env
  `OWNER_RIDER_IDS`): แถวคู่กลับ `ADJUSTMENT/DEBIT` amount เท่ากัน `taxable:false` `meta.reverses=<key เดิม>` **ไม่ลบไม่แก้แถวเดิม**
  · งาน Paid/Pending ของเจ้าของ → `Waived` reason `owner_run` · Pending ไม่มีไรเดอร์ → `no_rider` · ไม่แตะ `rider_fee` · multi-path
  ก้อนเดียว · idempotent ด้วย `meta.reverses` · balance ก่อน/หลังจาก `walletLedger.ts` ตัวจริง (loader ของ `rider-wallet-audit.cjs`).
  **ลำดับ: deploy functions → deploy แอปไรเดอร์ (ตัวเขียน Pending ไม่ทับปลายทาง, bkk-rider-app PR) → dry-run → --apply → rider-wallet-audit**
  · คู่ ADJUSTMENT เดิม 104 คู่ของเจ้าของหักกันเป็นศูนย์ ปล่อยไว้ · ไม่มี 50 ทวิ/expense split ให้กลับ (WITHDRAWAL 1 แถวทั้งระบบ ไม่ใช่ของเจ้าของ)
- **ด่าน:** `functions/test/rider-fee-guard.test.mjs` · `functions/test/reverse-owner-rider-payouts.test.mjs` (fixture 3 แถว, รันสองรอบ
  ได้แถวกลับชุดเดียว) · `rider-fee-trigger.test.mjs` (ข้อ 4-5) · `src/utils/riderSettlement.test.ts` (parity UX ↔ JS) · ตาราง injection
  วัดจริงอยู่หัวไฟล์ทุกตัว

## ค่าวิ่งไรเดอร์ แยกตามยานพาหนะ (motorcycle / car)
- **อัตรา** อยู่ที่ `settings/logistics_rates/by_vehicle/{motorcycle|car}` (ตั้งที่ `/global-settings` แท็บยานพาหนะ) — ฟิลด์แบนที่ root ยังเป็น fallback ทีละฟิลด์ ระบบเดิมจึงคิดเงินเท่าเดิมเป๊ะจนกว่าจะกรอก `by_vehicle`
- **ยานพาหนะของไรเดอร์** อยู่ที่ `riders/{id}/vehicle_type` (+ mirror ที่ `riders/{id}/vehicle/type` ซึ่งเป็นตัวที่ลูกค้าอ่านได้ตามกฎ read ของ subtree `vehicle`) — ตั้งที่หน้า `/riders`
- **แยกสามเรื่องอย่าสับสน** (ดู doc comment ของ `computeRiderFee`): ระยะทางที่ใช้**คิดเงิน**ใช้ `rates.travel_mode` ฐานเดียวทั้งระบบ (ไม่อิงคนขับ ไม่งั้นตั้งตัวเองเป็นรถยนต์ = ขึ้นเงิน) | **อัตรา** แยกตามยานพาหนะได้ | **ETA** ใช้โหมดของยานพาหนะจริง (มอเตอร์ไซค์ขึ้นทางด่วนไม่ได้)
- **`fee_by_vehicle`** ใน `rider_fee_estimate_meta`/`rider_fee_meta` = ค่าจ้างของทั้งสองยานพาหนะจากระยะทางชุดเดียวกัน (ได้ฟรี ไม่ยิง Routes เพิ่ม) — งานในกองยังไม่มีใครถือ ตัวเลขก้อนเดียวจึงเป็นของมอเตอร์ไซค์เสมอ แอปไรเดอร์อ่านตัวนี้ผ่าน `getRiderPayout(job, vehicleType)` (`bkk-rider-app/src/utils/jobHelpers.ts`) เพื่อโชว์เลขของคนดูเอง
- ที่เขียนเงินฝั่งไรเดอร์ต้องใช้ `computeRiderFeeForAssignee` (อิงคนถืองาน) — `computeRiderFee` เปล่าๆ ใช้เฉพาะตอนสร้างงานที่ยังไม่มีใครรับ

## Appointment / pickup_schedule (เลื่อนนัด)
- **`pickup_schedule`** ใช้ร่วมกันทุก receive_method เก็บ `{ type, date, time, time_start, time_end, rescheduled_at? }`
  - `time` = string รวมช่วงเวลา (`"12:00 - 14:00"`) เก็บไว้เพื่อ backward-compat กับตัวอ่านเดิม (calendar, customer tracking, ticket detail อ่าน `.time` ตรงๆ)
  - `time_start` / `time_end` = ช่วงเวลาแบบ structured (`time_end` ไม่บังคับ)
  - helper รวมอยู่ที่ `src/utils/appointment.ts` (`parseTimeRange`, `buildPickupSchedule`, `existingApptDate`) — ใช้ทั้ง mobile (`MobileTicketDetail` edit modal) และ desktop (`PricingSidebar`)
- **UI เลื่อนนัด:** mobile = โมดอล "แก้ไขข้อมูลงาน" ใน `MobileTicketDetail.tsx`; desktop = scheduler ใน `PricingSidebar.tsx` (มีครบทั้ง Pickup / Store-in / Mail-in)

## เปลี่ยน Trade Method (receive_method) หลังสร้างงาน
- เปลี่ยนได้ทุกทิศทาง (Pickup ⇄ Store-in ⇄ Mail-in). helper อยู่ที่ `src/utils/receiveMethod.ts` (`canChangeReceiveMethod`, `locationLabel`, `currentLocation`, `buildMethodLocationFields`, `buildStoreInBranchFields`)
- **Store-in ต้องเลือกสาขาจริงจาก `settings/branches` เสมอ (dropdown ทั้ง mobile + desktop) — ห้าม free text.** การ save ใช้ `buildStoreInBranchFields(branch)` เขียน `store_branch` + `branch_name` + `branch_details {id,name,address,phone,lat,lng,openHour,closeHour}` รูปเดียวกับ `validateAndCreateOrder` ฝั่ง checkout เพื่อให้หน้า track ลูกค้า resolve สาขาสดจาก `branch_details.id` ได้ (บั๊กเดิม: ช่องข้อความทำให้ที่อยู่ลูกค้าไหลเข้า `store_branch` และ track โชว์สาขา fallback มั่ว). ช่องแก้ที่อยู่ใน CustomerInfoCard/B2CWorkspace เขียนได้แค่ `cust_address` ห้ามแตะ `store_branch`. ออกจาก Store-in → `buildMethodLocationFields` ล้าง `branch_name`/`branch_details` ทิ้งด้วย
- **client เขียนแค่ `receive_method` + ฟิลด์สถานที่ (`cust_address`/`store_branch`) + qc_log** — เรื่องเงิน (pickup_fee/net_payout) และการถอนไรเดอร์ให้ `onReceiveMethodChanged` (cloud function) จัดการ เพื่อให้ค่าไรเดอร์ใช้ `computeRiderFee` ที่เดียว
- `canChangeReceiveMethod` block เมื่อเครื่องอยู่ในมือ/จ่ายเงินแล้ว/พัสดุส่งแล้ว/ปิดงาน (เช็ค status) — UI ทั้ง mobile + desktop ใช้ guard เดียวกัน
- UI: mobile = ตัวเลือกในโมดอล "แก้ไขข้อมูลงาน"; desktop = section "Trade Method" ใน `PricingSidebar.tsx`

## จุดรับเครื่อง / หมุด (cust_lat / cust_lng) — สำคัญต่อการนำทางไรเดอร์
- **ไรเดอร์นำทางด้วยหมุด `cust_lat/cust_lng` เป็นหลัก** (`bkk-rider-app` → `useJobActions.handleOpenNavigation` เปิด Google Maps directions ไปที่พิกัด) และ**จะ fallback ไปใช้ `cust_address` (ข้อความ) ก็ต่อเมื่อไม่มีหมุดเท่านั้น**. geofence "ถึงแล้ว" (`checkpoints.ts`, target `customer`) ก็ใช้หมุดนี้
- **กฎเหล็ก:** แก้ที่อยู่ Pickup แล้ว**ห้ามปล่อยหมุดเก่าค้าง** มิฉะนั้นไรเดอร์วิ่งไปที่เดิม. UI admin (`PickupLocationPicker` ใน `src/components`) ให้ปักหมุด/geocode ได้ และ save handler จะ reconcile หมุด: ขยับหมุดเอง→ใช้พิกัดนั้น, แค่แก้ข้อความ→geocode ที่อยู่ใหม่, geocode ไม่ได้→**ล้างหมุด** (ให้ fallback ไปใช้ข้อความ)
- helper geocode ฝั่ง client: `geocodeAddress()` export จาก `PickupLocationPicker.tsx` (ใช้ Maps JS Geocoder)

## public_track/{jobId} — โหนดที่ทั้งโลกอ่านได้ (repo นี้เป็นเจ้าของ backfill)
- **`public_track/$jobId` มี `.read: true` โดยตั้งใจ ห้ามปิด** — ลูกค้าที่ถือลิงก์ติดตามเป็น guest ไม่มีบัญชีให้ gate สิทธิ์ได้. มันคือกระจกเฉพาะฟิลด์ที่หน้า `/track` กับ `/quote` ของเว็บลูกค้าใช้จริง ซึ่งทำให้ `jobs/{id}` ตัวจริงถูกปิดเป็น owner/rider/admin ได้
- **สิทธิ์อ่านต้องอยู่ที่ชั้น `$jobId` ห้ามเลื่อนขึ้นไปไว้ที่ `public_track`** — RTDB ให้สิทธิ์ read ไหลลงทั้ง subtree **และครอบตัวโหนดนั้นเอง** `.read: true` ที่ระดับ `public_track` จึงแปลว่า `curl .../public_track.json` ครั้งเดียวได้ทะเบียนออเดอร์ทั้งร้านโดยไม่ต้องรู้ jobId. **เคยเป็นแบบนั้นจริงจนถึง ส.ค. 2026** และรอดมาสองรอบเพราะบรรทัดนี้เคยเขียนว่า `public_track/{jobId}` ซึ่งอ่านเหมือนมีชั้น `$jobId` ทั้งที่ไฟล์กฎจริงไม่มี — คนรีวิวอ่านเอกสาร ไม่ได้เปิดไฟล์กฎ. **แก้ที่ `bkk-frontend-next/database.rules.json` แล้ว deploy จาก repo นั้น**
- **sanitizer กับชั้นของกฎเป็นคนละแกน** — sanitizer คุม "หนึ่งใบมีอะไรบ้าง" (ซึ่ง backfill ของ repo นี้ต้องตรงกับ trigger เป๊ะ) ส่วนชั้นของกฎคุม "ดึงได้กี่ใบ" อย่าคิดว่าแกนหนึ่งผ่านแล้วอีกแกนปลอดภัยตาม
- **เพราะมันเปิด จึงห้ามมี PII หรือข้อมูลภายในอยู่ในนั้น "ไม่ว่าระดับใด"** — รวมถึงข้างใน object และ array. ซ่อนที่ UI ไม่นับ เพราะ `curl .../public_track/{id}.json` ข้ามหน้าเว็บไปเลย
- **allowlist อยู่ 2 ที่ ต้อง sync ด้วยมือ:**
  - `bkk-frontend-next/functions/src/publicTrackFields.ts` = **ต้นทาง** (trigger `onJobWritePublicTrack` เขียนทุกครั้งที่ job ถูกเขียน)
  - `functions/index.js` ของ repo นี้ = มิเรอร์ของ **backfill** — `PUBLIC_TRACK_FIELDS_MIRROR` (ระดับบนสุด) + `sanitizeNestedMirror` และ allowlist `MIRROR_*_FIELDS` (ชั้นใน) + `buildPublicTrackMirror`
  - ทั้งสองเขียนโหนดเดียวกัน **ผลลัพธ์ต้องเหมือนกันเป๊ะ** ไม่งั้น backfill จะไปลบล้างสิ่งที่ trigger ทำ. วิธีตรวจ: รันทั้งคู่บน fixture ชุดเดียวกันแล้ว diff JSON — **harness อยู่ที่ `bkk-frontend-next/scripts/mirror-parity.mjs`** (มันอ่านไฟล์ `functions/index.js` ของ repo นี้ตรงๆ) แก้ `PUBLIC_TRACK_FIELDS_MIRROR` หรือ `sanitizeNestedMirror` เมื่อไหร่ต้องรัน — เคยเจอ drift จริงด้วยวิธีนี้ (`maskCustomerEmailMirror` ตัด 2 ตัวแรกของทั้งสตริงแทนที่จะเป็นของ local part ทำให้อีเมลที่ local part ยาว 1 ตัวอักษรได้ผลต่างจากฝั่ง frontend)
- **การเพิ่ม field ต้องผ่าน sanitizer เสมอ ห้าม copy ตรง** — อยู่ใน `PUBLIC_TRACK_FIELDS_MIRROR` แปลว่า "key นี้โผล่ได้" ไม่ใช่ "ส่งทุกอย่างที่อยู่ใต้มัน". ค่าที่เป็น object/array ต้องมี allowlist ของตัวเอง
- **guard อยู่ที่ `bkk-frontend-next/functions/src/publicTrack.test.ts`** (repo นั้น รันด้วย vitest) — **แดงเมื่อไหร่ห้าม disable ให้ไปแก้ที่ sanitizer** เพราะแดงแปลว่ามีข้อมูลกำลังจะหลุดออกโหนดสาธารณะ. repo นี้ไม่มี test ของตัวเอง จึงต้องเทียบผลลัพธ์กับต้นทางด้วยมือทุกครั้งที่แก้
- **`runPublicTrackBackfill` คืน 2 counter:** `jobs_with_pii` (ดูเฉพาะชื่อ key ระดับบนสุด) กับ `jobs_with_nested_internal` (ข้อมูลภายในที่ซ่อนอยู่ใน object ที่อยู่ใน allowlist). ตัวแรกลำพังจะรายงานต่ำกว่าความจริงเสมอ เพราะจุดบอดของมันคือสิ่งที่รอบสองแก้พอดี
- **ประวัติ อ่านเพื่อไม่พลาดซ้ำ:** รอบแรก (#529) ปิดเฉพาะ **ชื่อ key ระดับบนสุด** — object ทุกตัวจึงยังถูกก๊อปทั้งก้อน. รอบสอง (branch `claude/sanitize-public-track-r2-tbeh7w`) ปิด **ชั้นใน** — `devices[].imei/device_serial/diagnostics.performed_by` (ชื่อพนักงานหรือไรเดอร์จริง = PII ของบุคคลที่สาม), `adjustments[].by_name/reason/evidence[].url`, `accessory_items[].serial`, `customer_offer.decided_by_*`. **ทั้งสองรอบพลาดด้วยสาเหตุเดียวกัน: ดูแค่ชั้นเดียวแล้วคิดว่าครบ**
- **บทเรียนข้ามระบบ:** `sickw_check` ถูกกันออกจากมิเรอร์ถูกต้องแล้ว แต่แอปไรเดอร์ก๊อปผลลัพธ์ SICKW ชุดเดียวกันไปเขียนที่ `devices[].device_imei/find_my_status/warranty_*` ผลจึงเดินอ้อมกำแพงเข้าไปอยู่ในโหนดสาธารณะ — **การบล็อกชื่อฟิลด์หนึ่งไม่ได้บล็อกข้อมูลนั้น** ต้องไล่ดูทุกที่ที่ข้อมูลถูกคัดลอกไป
- **รูที่ยังเหลือ:** `devices[].photos` เป็น Storage URL ของรูปเครื่องลูกค้า ยังอยู่ในมิเรอร์เพราะหน้า `/track` แสดงจริง — **ปิดที่ `storage.rules` (อยู่ที่ `bkk-frontend-next`) ไม่ใช่ที่ mirror**

## price_ledger — โหนดสาธารณะที่เคยเกือบรั่วอีเมลพนักงาน (ส.ค. 2569)

- **`price_ledger` มี `.read: true`** โดยตั้งใจ (ลูกค้าดูประวัติการเปลี่ยนราคาได้ — หน้า `/admin/statement` ของเว็บลูกค้าอ่านมัน) ดังนั้น **ทุกฟิลด์ในนั้นคือของสาธารณะ** `curl .../price_ledger.json` ครั้งเดียวได้ทั้งก้อนโดยไม่ต้อง login
- **จุดเขียนมีสองที่:** `src/features/trade-in/PriceEditor.tsx` (รายรุ่น) และ `src/features/trade-in/modals/BatchPriceAdjustModal.tsx` (ปรับยกชุด) — ทั้งคู่เขียน `updated_by` เป็น **`auth.currentUser?.uid` fallback `'admin'`** ห้ามกลับไปเป็นอีเมล. audit ภายในยังทำได้ (map uid → คนจาก `/staff`) แต่คนนอกอ่านไม่ออก. ด่าน: `functions/test/ledger-updated-by.test.mjs`
- **สิ่งที่พบตอนไล่ล้างข้อมูลเก่า และควรจดให้ตรง: ไม่เคยมีอีเมลรั่วจริง** — dry-run ของ `scripts/strip-ledger-emails.cjs` บน production ได้ **0 จาก 4,360 แถว** ที่เป็นรูปอีเมล แปลว่า `auth.currentUser?.email` เป็น `null` มาตลอด ทุกแถวจึงตกไปที่ fallback `'System Admin'` (สอดคล้องกับที่เพิ่งเลิกใช้บัญชีมาสเตอร์ร่วมแล้วย้ายมาเป็นบัญชีรายคน — ดูหัวข้อ Role-Based Access)
- **บทเรียน: 0 แถวไม่ได้แปลว่าสคริปต์พัง และไม่ได้แปลว่างานนี้เสียเปล่า** — มันคือการปิดรูที่**กำลังจะรั่ว** (พอทุกคนมีบัญชีอีเมลของตัวเองแล้ว แถวถัดไปทุกแถวจะมีอีเมลจริง) ไม่ใช่รูที่รั่วไปแล้ว. เวลาอ่านย้อนหลังอย่าสรุปว่า "เคยหลุดอีเมลทีมทั้งชุด" เพราะไม่จริง — แต่ก็อย่าถอดการแก้ออก เพราะเหตุผลที่มันยังไม่รั่วคือบั๊กคนละตัวที่ถูกแก้ไปแล้ว
- **ผลข้างเคียงที่ยังค้าง:** `bkk-frontend-next/app/admin/statement/page.tsx` แสดง `item.updated_by.split('@')[0]` และ export ลง CSV — แถวใหม่จะโชว์ uid ดิบแทนชื่อ อ่านยากขึ้นแต่ไม่พัง ถ้าจะให้สวยต้อง map uid → ชื่อจาก `/staff` ที่หน้านั้น (งานแยก ยังไม่ทำ)

## Data Contracts / Invariants (กันบั๊ก "แก้ไม่ครบวง")
> บั๊กร้ายแรงเกือบทั้งหมดของระบบนี้คือ "แก้ฟิลด์เดียวของชุดที่ผูกกัน" หรือ "ลืมคนอ่านอีก repo". **ก่อนแก้ฟิลด์ข้อมูลใน Firebase หรือพฤติกรรมที่ข้าม repo ให้ `grep` ทั้ง `/home/user` (ครบทั้ง 3 repo + `functions/`) หาคนเขียน/คนอ่านก่อนเสมอ** แล้วแก้ให้ครบทุกทางเข้าและทุกคนอ่าน. ข้อมูลงานเดียวกันถูกใช้โดย: `bkk-system` (admin), `bkk-rider-app` (ไรเดอร์), `bkk-frontend-next` (เว็บลูกค้า + customer functions).

ชุดฟิลด์ที่ **ต้องไปด้วยกันเสมอ** (ห้ามมีตัวใดค้างค่าเก่า):

1. **จุดรับเครื่อง:** `cust_address` (ข้อความ) ↔ `cust_lat`/`cust_lng` (หมุด) ↔ `cust_address_geocoded_*`
   - คนอ่านข้าม repo: **ไรเดอร์นำทาง/geofence ใช้หมุดเป็นหลัก** (ดู section "จุดรับเครื่อง / หมุด"). แก้ที่อยู่ต้อง reconcile หมุดเสมอ
2. **ราคา/ยอดเงินลูกค้า:** `price`/`final_price` ↔ `pickup_fee` ↔ `applied_coupons`/`applied_coupon` ↔ `adjustments` ↔ `net_payout`
   - **`coupon` ในสูตร = `sumAppliedCoupons(job)`** (ผลรวมทุกใบใน `applied_coupons[]`, fallback ใบเดียว `applied_coupon`) — ห้ามอ่านฟิลด์ตรงๆ ดู section Coupons
   - สูตรเดียวที่ใช้ทุกที่: `net_payout = max(0, base − (receive_method==='Pickup' ? pickup_fee : 0) + coupon + Σ(applied adjustments))` (client: `MobileTicketDetail` ~บรรทัด 423; server: `functions/index.js`). แก้สูตร = แก้ทั้ง client + functions
   - **`adjustments[]`** = รายการหัก/เพิ่ม ad-hoc แบบ itemized (`{id,label,amount,device_index,source,status,by_*,at,reason?,evidence?,approved_by_*?,approved_at?,rejected_by_name?,rejected_at?}`) — เฉพาะ `status==='applied'` เข้าสูตร (ของไรเดอร์เริ่ม `pending` จนแอดมินอนุมัติผ่าน `reviewAmendment`; **Offer ของแอดมิน role อื่นที่ไม่ใช่ CEO/MANAGER ก็เริ่ม `pending`** จน CEO/MANAGER กดอนุมัติใน ticket UI — push แจ้งผ่าน `onAdminOfferProposed`, CEO/MANAGER สร้างเอง = applied + self-approved ทันที, helper role: `canReviewAdjustments()` ใน `src/utils/adjustments.ts`). helper `sumAppliedAdjustments(job)` mirror 4 ที่ (frontend functions + bkk-system functions + clients). ลูกค้าเห็นเป็นบรรทัดๆ ที่ `OrderSummaryModal` (เฉพาะ applied)
   - **หลังสร้างงาน เรื่องเงินเป็นของ cloud function** (`onReceiveMethodChanged`, `onPickupLocationChanged`) — client เขียนได้แค่ `final_price` (ตอนแก้ราคา) แล้วปล่อยให้ function คิด `pickup_fee`/`net_payout` ต่อ
   - คนอ่านข้าม repo: `bkk-frontend-next` แสดง `net_payout` ให้ลูกค้า (track/profile/history/analytics); finance pages อ่าน `net_payout`
2b. **ราคาที่ยืนให้ลูกค้า:** `price_locked_amount` ↔ `price_locked_until` ↔ `assessment_codes`
   - เขียนตอนสร้างงานโดย `validateAndCreateOrder` จาก `settings/quote/lock_days` — **ล็อกเฉพาะราคาตลาด ไม่ได้ล็อกผลตรวจสภาพ** (QC หักตามตำหนิที่พบจริงได้ตามปกติ) สิ่งที่ล็อกห้ามคือ "ลดราคาเพราะราคาตลาดลง"
   - `assessment_codes` = รหัสประเมินที่ลูกค้าเห็นตอนกดยืนยัน ใช้ย้อนดูได้ว่าราคาที่ตกลงกันมาจากคำตอบชุดไหน (แถวอยู่ที่ `assessments/{code}` ฝั่ง bkk-frontend-next, ไม่ถูกลบถ้ากลายเป็นงานแล้ว)
   - UI: `PricingSidebar` โชว์ป้ายยืนราคา/หมดอายุ. เจ้าของ logic ทั้งหมดอยู่ `bkk-frontend-next/functions/src/assessments.ts` — ดู CLAUDE.md ของ repo นั้น
3. **ค่าธรรมเนียม — คนละตัว อย่าสับสน:** `pickup_fee` = หักจาก**ลูกค้า** (อยู่ในสูตร net_payout) | `rider_fee`/`rider_fee_estimate` = จ่ายให้**ไรเดอร์** (อ่านโดย finance settlement + ไรเดอร์เห็น estimate ก่อนรับงาน). คนละความหมาย ห้ามเอามาใช้แทนกัน
   - `pickup_fee` ถูก quote ให้ลูกค้าตอน checkout ด้วยระบบราคาโซนของเว็บ (`bkk-frontend-next` เป็นเจ้าของ) — **ห้ามขยับเพราะไรเดอร์คนไหนรับงาน**. ส่วน `rider_fee*` อิงยานพาหนะของคนถืองานได้ (ดู section ค่าวิ่งไรเดอร์)
4. **วิธีรับเครื่อง:** `receive_method` ↔ `pickup_fee` ↔ `rider_id` ↔ `status` ↔ location fields (`cust_address`/`store_branch`)
   - เจ้าของ reconcile = `onReceiveMethodChanged` (ดู section Cloud Functions + Trade Method)
5. **นัดหมาย:** `pickup_schedule.time` (string `"12:00 - 14:00"`, backward-compat) ↔ `time_start`/`time_end`
   - **ต้องเขียนผ่าน `buildPickupSchedule()` (`src/utils/appointment.ts`) เสมอ** เพื่อให้ `.time` ถูกเซ็ตคู่ไปด้วย — คนอ่าน `.time` ตรงๆ: calendar, `bkk-frontend-next` (track/DeliverySection), `bkk-rider-app` (`jobHelpers`), ticket detail
6. **สถานะงาน:** `job-statuses.ts` มี **3 ก๊อปปี้** (`bkk-system`, `bkk-rider-app`, `bkk-frontend-next`/`app/types`) — เพิ่ม/แก้ status ต้อง sync ทั้ง 3 ไฟล์ และเช็ค notification triggers + archive (`TERMINAL_STATUSES`) + guard ต่างๆ
7. **Cloud Functions naming:** ชื่อ function ห้ามชนกับ rider-notifications codebase (identify ด้วย `{region}/{name}` ระดับ project — ดูหมายเหตุใน section Cloud Functions)
7b. **กระจกลูกค้า `public_track/{jobId}`:** allowlist มี 2 ก๊อปปี้ที่ต้อง sync มือ — `bkk-frontend-next/functions/src/publicTrackFields.ts` (trigger, ต้นทาง) ↔ `functions/index.js` ของ repo นี้ (backfill). โหนดนี้ `.read: true` **ห้ามใส่ PII หรือข้อมูลภายในลงไปทุกระดับ รวมถึงข้างใน object/array** — ดู section public_track ด้านบน
8. **ค่าหักชุดประเมิน (condition sets):** ต่อ option ใช้ precedence `pct` (% ของราคา) > `deduct` (บาทค่าเดียว) > legacy `t1/t2/t3` (tier เก่า — **อ่านอย่างเดียวเป็น fallback สำหรับข้อมูลที่ยังไม่ migrate ห้ามเขียนเพิ่ม**). resolver mirror 4 ที่: `bkk-system/src/utils/pricingResolver.ts`, `bkk-frontend-next/app/utils/pricingResolver.ts`, `bkk-frontend-next/functions/src/devicePricing.ts` (`calculateDeductAmount` — ย้ายออกจาก index.ts แล้ว), `bkk-rider-app/src/utils/pricingResolver.ts` — แก้สูตรต้อง sync ทั้ง 4. ฟิลด์ `title_en`/`description_en` (group) และ `label_en`/`description_en` (option) เป็น **display-only สำหรับหน้า /en ของเว็บลูกค้า** — ไทยยังเป็นค่า canonical ที่ใช้ match/payload เสมอ, `sanitizeGroups` เก็บ `*_en` ไว้ตอน save (ค่าว่าง = ลบฟิลด์ทิ้ง), ห้ามเอา `*_en` ไปใช้ในสูตรเงินหรือการ match. แนวทางออกแบบ = **1 ชุดประเมินต่อ 1 รุ่น** — ทำได้ 2 ทาง: ปุ่ม Clone รายรุ่นใน `ModelEditorPage`, หรือปุ่ม bulk "แตกชุดรายรุ่น" ใน sidebar ของ Engine (`EngineSettingsModal`) ที่ไล่ clone ทุกรุ่นที่ยังใช้ชุดร่วมกันทีเดียว. ทั้งคู่ใช้ helper กลาง `utils/perModelConditionSets.ts` (`representativeBasePrice` = median ราคามือสองของ variants, `convertGroupsToSingleDeduct` = แปลง tier เดิมเป็น `deduct` ที่ราคานั้น, `planPerModelSplit` = pure planner — วางแผนเฉพาะรุ่นที่ set ถูกแชร์ ≥2 รุ่น จึง idempotent กดซ้ำไม่สร้างซ้ำ). หลัง split ชุดเดิมกลายเป็น orphan (ไม่ถูกลบอัตโนมัติ — ลบเองจาก sidebar). การ save จาก Engine (`writeConditionSet`/`applyRowsToSet` — `sanitizeGroups`) จะลบ t1/t2/t3 ทิ้งทันทีที่ option มี `deduct` หรือ `pct`

## งาน B2C หลายเครื่อง → แตกเป็นงานลูกรายเครื่องตอนเข้าคิวคลัง (5 ก.ย. 2569)

> ตะกร้าเว็บลูกค้าขายได้หลายเครื่องในใบเดียว (และปุ่ม "เพิ่มเครื่องแบบเดียวกัน" — bkk-frontend-next #950 — ทำให้เกิดบ่อยขึ้น) แต่ทุกอย่างหลังรับเครื่องของฝั่งนี้คิดเป็น "หนึ่งงาน = หนึ่งเครื่อง": QC Station มีฟอร์มเดียวต่องาน หน้าคลังนับหนึ่งงานเป็นหนึ่งแถว POS ขายหนึ่งงานเป็นหนึ่งชิ้น. งานสองเครื่องจึงเคยเข้าคลังเป็น "เครื่อง" เดียวราคาสองเครื่องรวมกัน **ไม่มี error ไหนบอก** (เจอตอนไล่ดูว่าแถวแฝดไปจบที่ไหน ไม่ใช่เพราะมีใครรายงาน)

- **รูปเดียวกับ B2B และอุปกรณ์เสริม:** งานแม่ยังเป็น**ใบสั่งขายของลูกค้า** (เงิน ใบสำคัญรับเงิน คูปอง หน้า track อยู่ที่นี่ทั้งหมด ไม่ถูกแตะ) ส่วน "เครื่อง" แต่ละใบกลายเป็นงานลูก `type: 'B2C-Unpacked'` (`ref {parent}-D1..`, `parent_job_id` / `parent_ref_no` / `device_index`) ที่เข้า **Pending QC แยกกัน** — แต่ละใบมี QC / IMEI / SickW / คลัง / POS ของตัวเอง. แม่ปิดที่ **Completed** ผ่าน engine (event `multi_device_unpacked` — `requires: ["multi_unpack"]` = ลำดับ "ลูกก่อน แม่ทีหลัง" ถูกบังคับที่ตาราง)
- **เจ้าของกติกา: `functions/b2c-unpack.js`** (pure halves มีเทส `functions/test/b2c-unpack.test.mjs`) — trigger `onJobStatusUnpackMultiDevice` บน `jobs/{id}/status` ยิงเมื่อสถานะเข้าชุด `ENTRY_STATUSES` = **`FEE_TRIGGER_CANONICAL` ของค่ารอบไรเดอร์ตัวเดียวกัน** (Pending QC / Sent To QC Lab / In Stock — "เครื่องถึงมือร้านแล้ว" import ไม่ก๊อป) และงานเป็นขายปลีกที่ `devices[].length >= 2`. **ไม่มีปุ่มให้ลืมกด**. callable `unpackMultiDeviceJob` มีไว้**รันซ้ำ**เมื่อรอบอัตโนมัติล้มกลางทาง — ปุ่มบนตั๋ว (`MultiDeviceUnpackCard`) ขึ้นเฉพาะตอนนั้น (`multiUnpackState` = `partial`)
- **สามขั้น และทำไม idempotent โดยไม่ต้องมี `.indexOn` ใหม่:** (1) transaction จอง `jobs/{id}/multi_unpack` (กัน trigger สองรอบชนกัน — key ของลูกถูกจองไว้ใน stamp) → (2) multi-path เดียว: ลูกทุกใบ + อุปกรณ์เสริมที่ยังไม่แตก + `multi_unpack.written=true` (all-or-nothing) → (3) `applyTransition` แม่ → Completed. ล้ม 1→2 = stamp มี `written:false` รอบถัดไปเขียนลูกด้วย key เดิม · ล้ม 2→3 = ลูกอยู่ในคิว QC แล้ว แม่ยังอ่านสถานะเดิม ปุ่มรันซ้ำขึ้น. ต่างจาก B2B ที่ต้อง query `parent_b2b_id` เพราะ stamp บนแม่อยู่ใน multi-path เดียวกับลูก
- **ลูกไม่ได้รับอะไรที่เป็น "ของออเดอร์" โดยตั้งใจ** — ไม่มี `uid` (ไม่งั้นโผล่ในประวัติการขายของลูกค้าเป็นออเดอร์ที่ไม่มีอยู่จริง) ไม่มี `cust_phone/email/address` ไม่มี `net_payout/pickup_fee/applied_coupons/adjustments` และ**ไม่มี `paid_at`** (Finance/TransactionRepair นับแถวที่มี `paid_at` แต่ไม่มี ledger เป็น orphan). หลักฐานว่าจ่ายแล้วส่งผ่าน**แถวไทม์ไลน์** `qc_logs[0] = {action: 'Paid', details: 'จ่ายเงินแล้วผ่านงานแม่ …'}` ซึ่ง `paidTrail.ts` อ่านเป็น "จ่ายแล้ว" → ปุ่ม Pending QC บนมือถือเสนอทาง Lab/Stock **ไม่ใช่เสนอจ่ายเงินซ้ำ** (B2B-Unpacked ไม่มีแถวนี้ — รูเดิมของสายนั้น ยังไม่ได้แก้). ด่าน: `ORDER_ONLY_KEYS` ใน b2c-unpack.test.mjs เดินทุกแถวลูก
- **สิ่งที่ลูกได้:** ทุกอย่างที่เป็น "ของเครื่อง" จาก `devices[i]` — ราคาหลังไรเดอร์ตรวจ (`price` ของเครื่องนั้น ไม่ใช่ยอดรวม) IMEI/serial ทั้งชื่อ `imei/serial` (reader เดิมของ QC/SickW) และ `device_imei/device_serial` (ชื่อที่ไรเดอร์เขียน) แบต Find My รูป deductions คำตอบลูกค้า และ `sickw_check` ของแม่**เฉพาะลูกที่ IMEI ตรง `last_check.imei`** (ไม่ต้องจ่าย SickW ซ้ำที่ QC)
- **อุปกรณ์เสริมถูกแตกที่นี่ด้วย** เพราะแม่ที่ถูกแตกปิดที่ Completed โดยไม่ผ่านปุ่ม In Stock ที่ `unpackAccessoryItemsToStock` เกาะอยู่ — `buildAccessoryChildUpdates` มีสองสำเนา (TS `src/utils/accessoryItems.ts` ↔ JS `b2c-unpack.js`) ด่าน `src/utils/accessoryUnpackParity.test.ts` รันทั้งคู่บน fixture เดียวกันแล้ว diff
- **`isStockChildJob()` (`src/utils/stockChildren.ts`) = นิยามเดียวของ "แถวนี้เป็นเครื่องในคลัง ไม่ใช่ ticket/ไม่ใช่เงิน"** ครอบสามชนิด (`B2B-Unpacked` / `Accessory` / `B2C-Unpacked`) — ก่อนหน้านี้แต่ละหน้าพิมพ์รายการเอง**และไม่เท่ากัน** (Analytics ตัด Accessory แต่ไม่ตัด B2B-Unpacked = ล็อตที่ระเบิดกล่องแล้วถูกนับ spend สองรอบ · NotificationCenter ตัด B2B-Unpacked แต่ไม่ตัด Accessory). ตอนนี้ 6 seam (NotificationCenter · TradeInDashboard · CEODashboard ×2 · Analytics · Inventory · `functions/chat-ai.js` ผ่าน `functions/stock-child-types.js`) อ่านที่เดียว และ `stockChildren.test.ts` **สแกนทั้ง `src/` ว่าไม่มีไฟล์ไหนเทียบ literal เอง** (เทส "ไม่มีไฟล์ไหนทำผิด" โตเองตามจำนวนหน้า)
- **หน้า track ของลูกค้าไม่ต้องแก้** — Completed อยู่ในขั้น "สำเร็จ" ของ `getCurrentStep` อยู่แล้ว (ทางเดียวกับที่งานเครื่องเดียวไปถึงหลังขาย) และ `STATUS_COPY` ไม่มี Completed จึงไม่มีอีเมล. ค่ารอบไรเดอร์ (`onJobHandedOverCalcRiderFee`) ยิงบนสถานะเดียวกันก่อนแม่ขยับ ไม่กระทบ
- **ยังไม่ทำและเป็นการตัดสินใจ:** งานลูกไม่มี `custody` (สร้างตรงเหมือน B2B children ไม่ผ่าน engine) · `Traceability` ยังไม่เดินจากลูกขึ้นไปแม่อัตโนมัติ (ค้นด้วย ref ของแม่ได้ตามเดิม)

## อุปกรณ์เสริม iPad ขายพ่วง (Apple Pencil / Magic Keyboard)
- **Catalog:** accessory เป็น model จริงใน `/models` category `Tablet Accessories` (schema ใน `categorySchemas.ts`, seed+backfill ใน PriceEditor) + `compatible_series: string[]` (ชื่อ series iPad — ว่าง = ทุกรุ่น, UI ใน `ModelEditorPage`). ฝั่งเว็บลูกค้า category นี้**ถูก exclude จาก sell picker + search** (add-on only)
- **Data contract (invariant เดียวกับข้อ 2):** `accessory_items[]` (`{id, model_id, model_name, price, serial?}`) เป็น **breakdown เท่านั้น** — มูลค่ารวมอยู่ใน `price`/`final_price` ก้อนเดียวเสมอ สูตร net_payout ไม่เปลี่ยน. **ทุกจุดที่ recompute final_price จากผลรวม devices ต้องบวก `sumAccessoryItems()` กลับ** — ตอนนี้มี 2 จุด: rider `RiderApp.handleInspectionSubmit` (bkk-rider-app) และ `InternalQCModal` (repo นี้). Amendment ปลอดภัยเพราะทำงานแบบ delta
- **Helper กลาง:** `src/utils/accessoryItems.ts` (mirror: `bkk-frontend-next/app/utils/accessoryAddOns.ts` + validation ใน `validateAndCreateOrder`, `bkk-rider-app/src/utils/jobHelpers.ts`)
- **เข้าสต๊อก:** งานที่มี `accessory_items` เมื่อถึง `In Stock` (QCStation + MobileTicketDetail) → `unpackAccessoryItemsToStock()` แตก child job ต่อชิ้น (`ref {parent}-A1..`, `type: 'Accessory'`, status In Stock, กัน trigger อีเมล/พุชเพราะไม่ใช่ status งานใหม่) idempotent ด้วย `accessories_unpacked_at`. Serial กรอกได้ที่ QCStation ก่อนเข้าคลัง
- **ต้นทุน:** งานแม่ได้ `stock_cost` = ยอดจ่าย − มูลค่าอุปกรณ์เสริม; Inventory/POS/Analytics stock อ่านผ่าน `stockCost()` กันนับซ้ำ. ตัวรวม spend (Analytics/CEODashboard) + รายการ ticket B2C ต้อง exclude `type === 'Accessory'` แบบเดียวกับ `B2B-Unpacked`

## Order Confirmation Emails (Resend)
- **Provider:** Resend ผ่าน REST API ตรงๆ ด้วย `fetch` (Node 22) — ไม่เพิ่ม npm dependency. Logic + templates อยู่ใน `/functions/email.js`
- **`onJobCreatedSendEmails`** (trigger: `onValueCreated /jobs/{jobId}`) — ออเดอร์เข้ามา → ส่งอีเมล "เราได้รับคำสั่งขาย" ให้ลูกค้า (`cust_email`) + แจ้งอีเมลกลางของแอดมิน (`ORDER_NOTIFY_EMAIL`)
- **`onJobStatusEmail`** (trigger: `onValueUpdated /jobs/{jobId}/status`) — ส่งอีเมลตาม milestone ของ lifecycle (Active Lead, รับเครื่อง, ปรับราคา, โอนเงิน, ยกเลิก, ส่งคืน, คืนเงิน ฯลฯ) ให้ลูกค้า + แจ้งแอดมินกลางทุก milestone
- **Milestone copy-map = allowlist:** `STATUS_COPY` ใน `email.js` — สถานะไหนไม่อยู่ใน map = ไม่ส่งอีเมล (เฟส Inventory/Logistics ภายในไม่ส่ง). เพิ่มสถานะใหม่ = เพิ่ม 1 entry ไม่ต้องแตะ logic. **ใช้ template กลางตัวเดียว** ไม่แยกต่อสถานะ
- **Paid = ใบสำคัญรับเงิน (ไม่ใช่ใบเสร็จ):** เราเป็นผู้ซื้อจ่ายเงินให้บุคคลธรรมดาที่ออกใบเสร็จไม่ได้ → ลูกค้าได้ `buildCustomerPaymentVoucherEmail` = **ใบสำคัญรับเงิน** (ผู้จ่าย=นิติบุคคล+เลขผู้เสียภาษี+ที่อยู่, ผู้รับเงิน, จำนวนเงินตัวอักษร `bahtText()` "บาทถ้วน", หมายเหตุเหตุผลออกแทนใบเสร็จ) — สินค้า/ยอด/บัญชี mask เท่านั้น **ห้ามใส่ SickW/FMI/KYC** (PDPA)
- **Paid แอดมิน = สรุปเต็ม + voucher backing:** `buildAdminPaidSummaryEmail` = parties + order + payout + ตัวอักษร + ผลตรวจ SickW GSX/FMI/iCloud (จาก `job.sickw_check.last_check`) + KYC (จาก `/jobs_kyc/{jobId}` เลขบัตร mask 4 ตัวท้าย). อ่าน snapshot ที่เก็บตอน inspection — **ไม่ call SickW API ซ้ำ**
- **COMPANY mirror:** ข้อมูลนิติบุคคล (`COMPANY` ใน `email.js`) เป็น **ค่า default/fallback** — แอดมินแก้ทับได้ที่หน้าตั้งค่าระบบบัญชี (`settings/accounting/company`); trigger resolve แล้ว stash ที่ `job._company` (`companyOf()` merge override ทับ default). ยัง mirror source of truth ที่ `bkk-frontend-next` — ถ้าเปลี่ยน entity จดทะเบียนต้อง sync ทั้ง 2 repo + หน้า PDPA
- **เลขรันใบกำกับภาษี format ได้:** `tax_invoice_format` = `plain` ({prefix}{6หลัก} ต่อเนื่อง) / `year_month` ({prefix}{YYYYMM}{4หลัก} reset รายเดือน) / `year` ({prefix}{YYYY}{4หลัก} reset รายปี). period format ใช้ counter แยกที่ `settings/accounting/tax_invoice_seq_by_period/{period}` (`allocateTaxInvoiceNumber` ใน index.js)
- **ส่วนลดค่าบริการต้องโชว์เป็นบรรทัด ห้ามหักเงียบ (ม.79(1)):** ส่วนลดที่ให้ขณะให้บริการจะกันออกจากฐานภาษีได้ **ก็ต่อเมื่อแสดงส่วนลดไว้ในใบกำกับภาษีให้ชัดแจ้ง** — `serviceFeeBreakdown` จึงคืน `grossBase`/`discountBase` (ฐานก่อน VAT ทั้งคู่, `discountBase` คิดจากการลบเพื่อให้ `grossBase − discountBase = base` เป๊ะ ไม่มีเศษจากการปัดสองรอบ) และทั้ง `buildTaxInvoicePdf` + การ์ดสรุปในอีเมลต้องพิมพ์บรรทัด "หัก ส่วนลดค่าบริการ" ออกมา. หน้า checkout ฝั่งลูกค้าโชว์ 3 บรรทัดนี้อยู่แล้ว เอกสารต้องเล่าตรงกัน. ส่วนลดกลบหมด (`feeIncl <= 0`) = ไม่ออกใบกำกับ (ไม่มีมูลค่าที่เก็บจริง)
- **เลขใบกำกับภาษีห้ามกระโดดเงียบ:** เลขถูกจอง **ก่อน** สร้าง PDF (เพราะต้องพิมพ์เลขลงบนเอกสาร) ถ้าสร้างไม่สำเร็จ เลขจะถูกใช้ไปโดยไม่มีเอกสาร — จึงต้องลงทะเบียนเป็น `accounting_documents` ที่มี `status: "void"` + `void_reason` มูลค่า 0 เพื่อให้ลำดับอธิบายได้ตอนถูกตรวจ. คีย์เป็น `TI_{number}` ถ้ารันซ้ำแล้วสำเร็จ แถวจริงจะทับแถว void เอง. `/vat-report` แสดงป้าย "ยกเลิก" + เหตุผลทั้งบนตารางและใน CSV
- **ไม่เก็บลายมือชื่อผู้รับเงิน (ยืนยันกับบัญชีแล้ว):** จ่ายด้วยการโอน ไม่มีการพบหน้าตอนจ่าย — หลักฐานคือ **สลิปโอน + สำเนาบัตรประชาชนจาก KYC** ใบสำคัญรับเงินจึงพิมพ์บรรทัด "หลักฐานประกอบการจ่ายเงิน" (อ้างเลขบัตร 4 ตัวท้ายจาก `/jobs_kyc/{jobId}` เพื่อ match กับสำเนาบัตร) และเหลือเส้นเซ็นเฉพาะ **ผู้มีอำนาจจ่ายเงิน** ฝั่งบริษัท ไม่พิมพ์เส้นเซ็นผู้รับเงินที่ไม่มีวันถูกเซ็น
- **ใบกำกับภาษีค่าบริการ = คนละฉบับกับใบสำคัญรับเงินโดยตั้งใจ** — เป็นธุรกรรมคนละตัวเดินคนละทิศ (บริษัทซื้อเครื่อง = รายจ่าย / ลูกค้าซื้อบริการรับเครื่อง = รายได้) ที่บังเอิญหักกลบกันตอนโอน. ใบสำคัญรับเงินยัง**ต้องโชว์การหักกลบ** เพราะยอดในสลิปคือยอดสุทธิ ถ้าเอกสารบอกยอดเต็มจะไม่ตรงกับหลักฐานการโอน — คำว่า "(เราจ่ายคุณ)" / "(คุณชำระเรา)" จึงเก็บไว้เฉพาะบนเอกสารบัญชี (`showVatDetail`) ส่วนอีเมลยืนยันออเดอร์ซึ่งเป็นแค่ใบเสนอราคาตัดออก
- **`etax_enabled` (settings/accounting, default ปิด):** ยังไม่ขึ้นระบบ e-Tax Invoice ของสรรพากร = PDF ที่แนบอีเมล**ไม่ใช่**ใบกำกับภาษีอิเล็กทรอนิกส์ตามกฎหมาย ต้นฉบับต้องเป็นกระดาษ เอกสารจึงประทับ "สำเนา — ต้นฉบับออกเป็นเอกสารกระดาษ" อัตโนมัติ (`taxDocCopyMark` ใน voucher-pdf.js ใช้ทั้งใบกำกับค่าบริการและใบกำกับขาย). เปิดสวิตช์ที่ `/accounting-settings` เมื่อขึ้นระบบแล้วเท่านั้น
- **ห้ามอ้างสิ่งที่ระบบไม่ได้เก็บลงบนเอกสาร:** ใบสำคัญรับเงินเคยเขียนว่า "ผู้รับเงินได้ลงลายมือชื่อไว้แล้ว ณ จุดส่งมอบเครื่อง" ซึ่งเป็นเท็จ — ลายเซ็นถูกเก็บเฉพาะ KYC โหมด fallback, ไม่มีใน Store-in/Mail-in, และเซ็นก่อนโอนเงินจึงรับรองการรับเงินไม่ได้ ทั้งฉบับ PDF ก็พิมพ์เส้นให้เซ็นอยู่แล้ว = สองฉบับพูดคนละเรื่อง
- **ค่าบริการรับเครื่อง = รายได้บริษัท (VAT):** บริษัทจด VAT — `pickup_fee` (ค่าบริการไรเดอร์ที่หักจาก payout) เป็น**รายได้ค่าบริการ** ถือเป็น VAT-inclusive. `serviceFeeBreakdown()` ใน `email.js` แตก base + VAT 7% ออกมา. voucher/admin Paid โชว์บรรทัด 2 ทาง "ราคารับซื้อเครื่อง (เราจ่ายคุณ) − ค่าบริการรับเครื่อง (คุณชำระเรา รวม VAT) = ยอดรับสุทธิ" + รายละเอียด VAT (ทั้ง HTML + PDF). คนละก้อนกับค่าวิ่งที่จ่ายไรเดอร์ (expense + อาจมี WHT)
- **ใบกำกับภาษีค่าบริการ:** ที่ Paid ถ้ามี `pickup_fee` → ออก **ใบกำกับภาษี/ใบเสร็จรับเงิน** แยกสำหรับค่าบริการ (`buildTaxInvoicePdf` ตาม ม.86/4: เลขที่ running, ผู้ขาย=บริษัท สนญ., ผู้ซื้อ=ลูกค้า, มูลค่าบริการ + VAT แยก). เลขที่จองจาก atomic counter `settings/accounting/tax_invoice_seq` (transaction; format `{prefix}000123`) เก็บที่ `jobs/{id}/tax_invoice` (กัน allocate ซ้ำ) + archive `tax_invoices/{jobId}.pdf`. แนบไปทั้งลูกค้า+แอดมินคู่กับใบสำคัญรับเงิน. **เลขรัน reset ได้** จากหน้าตั้งค่าระบบบัญชี (เก็บใต้ settings/accounting แอดมินจึงอ่าน/เขียนได้) — ใช้เฉพาะก่อน go-live เพื่อล้างเลขทดสอบ, ห้าม reset หลังออกใบจริง (เลขซ้ำ ผิดกฎหมาย)
- **Voucher PDF:** ที่ Paid `onJobStatusEmail` สร้างไฟล์ PDF ใบสำคัญรับเงิน (`functions/voucher-pdf.js` ใช้ `pdf-lib` + ฟอนต์ `functions/assets/fonts/Sarabun-*.ttf` — TH Sarabun New OFL, ต้องมีไม่งั้นภาษาไทยเป็นกล่อง) → **แนบไปทั้งอีเมลลูกค้า + แอดมิน** และ **archive ที่ Storage `vouchers/{jobId}.pdf`** + เขียน reference `jobs/{jobId}/payment_voucher` (storage_path, url ผ่าน download token, amount, generated_at) ให้โชว์ในประวัติการขายได้. PDF/Storage เป็น best-effort — ถ้าล้มเหลวอีเมลยังส่ง. Deps: `pdf-lib`, `@pdf-lib/fontkit` (pure JS ไม่มี native binary)
- **Normalize ก่อน lookup:** `normalizeStatus()` ใน `email.js` mirror จาก `src/types/job-statuses.ts` (LEGACY_ALIAS + In-Transit overload) เพราะ functions เป็น JS import TS enum ไม่ได้ — **แก้ status enum ต้อง sync 2 ที่**
- **กันส่งซ้ำ:** create ใช้ `confirmation_email_sent_at`; milestone ใช้ `status_email_sent/{slug}` (per-status) guard ที่ต้นฟังก์ชัน
- **ครอบคลุมทั้ง 2 ทางสร้างออเดอร์:** ลูกค้า self-checkout (`validateAndCreateOrder` ใน bkk-frontend-next) กับแอดมินสร้างเอง เขียน `/jobs` path เดียวกัน project เดียวกัน → DB trigger ตัวเดียวครอบคลุมหมด
- **ชื่อ function ต้อง unique ระดับ project** เช่นเดียวกับ `onAdminJobStatusNotify` (กฎ `{region}/{name}` collision)
- **Deliverability:** ต้อง verify sending domain `bkkapple.com` ใน Resend (SPF/DKIM/DMARC) ก่อนส่งจริง ไม่งั้นเข้า spam หรือถูก reject
- **ทะเบียนเอกสาร + รายงานภาษีขาย (Phase 2):** ทุกใบที่ออกถูก log ที่ `accounting_documents/{docId}` (`TI_{number}` = ใบกำกับภาษี, `PV_{jobId}` = ใบสำคัญรับเงิน) มี `period` (YYYYMM อิงเวลาไทย `bangkokYM`), base/vat/total, url. หน้า `/vat-report` (`VatReport.tsx`, CEO+FINANCE) query ตาม period → สรุป output VAT + export CSV สำหรับ ภ.พ.30. **read rule ของ `accounting_documents` อยู่ที่ `bkk-frontend-next/database.rules.json`** (admin read, write false, indexOn period/type/issued_at) — ต้อง deploy rules จาก repo นั้น
- **ขายเครื่อง refurbished → ใบกำกับภาษีขาย (Phase 3):** `onSaleCreated` (trigger `onValueCreated /sales/{saleId}`) ออก **ใบกำกับภาษีขาย** (output VAT) ตอน POS checkout — เต็มรูปเมื่อลูกค้าให้ `customer_tax_id`/`customer_address`, ไม่งั้นอย่างย่อ (ม.86/6 retail). ใช้ running-number series เดียวกับใบกำกับค่าบริการ (`allocateTaxInvoiceNumber`), แตก VAT จาก `grand_total` (VAT-inclusive), archive `sales_tax_invoices/{saleId}.pdf` + เขียน `accounting_documents` (type `tax_invoice`, category `goods`) → เข้ารายงาน ภ.พ.30 เดียวกัน. gated ด้วย master toggle + vat_registered, idempotent ด้วย `sales/{id}/tax_invoice`
- **รายงานการเงิน P&L (Phase 4):** หน้า `/financial-report` (`FinancialReport.tsx`, CEO+FINANCE) สรุปรายเดือน (เวลาไทย) จาก `/sales` (ยอดขาย/COGS/กำไรขั้นต้น) + `/accounting_documents` (รายได้ค่าบริการ + ภาษีขาย) + `/expenses` (ค่าใช้จ่าย) → P&L + VAT สุทธิ + export CSV. ภาษีซื้อยังไม่เก็บ (= 0). **read rule ของ `expenses` เพิ่งเพิ่มที่ `bkk-frontend-next/database.rules.json`** — ต้อง deploy rules. Phase 4d (สมุดรายวัน double-entry + งบการเงิน) ยังไม่ทำ
- **Master gate (ตั้งค่าระบบบัญชี):** ทั้ง `onJobCreatedSendEmails` + `onJobStatusEmail` อ่าน `settings/accounting` (`loadAccountingSettings`) — ถ้า `order_emails_enabled !== true` = **inert สนิท** (ไม่ส่ง ไม่จองเลขใบกำกับ ไม่เขียน Storage) deploy ก่อนตั้ง Resend ได้ปลอดภัย. config อื่น: `vat_registered` (ปิด=ไม่ออกใบกำกับภาษี+ไม่แตก VAT), `vat_rate_percent` (default 7), `tax_invoice_prefix` (default `IV-`). resolve แล้ว stash ที่ `job._accounting` (in-memory) ให้ `serviceFeeBreakdown` ใช้. หน้า UI: `/accounting-settings` (`src/pages/admin/AccountingSettings.tsx`, CEO+FINANCE)
- **หน้าตั้งค่าอีเมล `/email-settings`** (`src/pages/admin/EmailSettings.tsx`, CEO+FINANCE, อยู่ใน settingsNav กลุ่ม Company) — เปิด/ปิดและแก้ข้อความอีเมลรายสถานะ
  - **เจ้าของ `settings/email_templates/{key}` เท่านั้น**: `customer_enabled` / `admin_enabled` (fail-open มีแต่ `false` ที่ปิด) + override `subject` / `heading` / `intro`. **master switch ยังเป็นของ `/accounting-settings`** (`order_emails_enabled`) หน้านี้แค่โชว์สถานะ+ลิงก์ไป ห้ามเขียนทับ
  - `key` = `statusEmailKey(status)` ตัวเดียวกับ idempotency slug + `order_created` (อีเมลตอนออเดอร์เข้า)
  - **เป็น override ไม่ใช่ replace** — ช่องว่าง = ใช้ข้อความ default จากโค้ดพร้อมเงื่อนไขครบ (Pickup/Mail-in/Store-in พูดคนละอย่าง ซึ่ง textarea แทนไม่ได้). placeholder `{ref} {name} {model} {payout} {brand} {method} {branch}` **escape ค่าที่แทนเสมอ** (ข้อความมาจากแอดมิน แต่ค่าที่แทนมาจากข้อมูลลูกค้า)
  - **`LOCKED_COPY_KEYS` (ตอนนี้มี `paid`) = เปิด/ปิดได้แต่แก้ถ้อยคำไม่ได้** — ใบสำคัญรับเงิน/สรุปการซื้อขายเป็นเอกสารทางบัญชี-ภาษี แก้อิสระแล้วผิดสาระสำคัญได้
  - logic อยู่ `functions/email-templates.js` (load/gate/render) + `email-templates-admin.js` (callable `adminEmailTemplateList`). **รายการเทมเพลตมาจาก server ไม่ hardcode ฝั่ง UI** — เพิ่ม entry ใน `STATUS_COPY` แล้วหน้าตั้งค่าขึ้นเอง ไม่เกิด mirror ตัวที่ 3. ตัวอย่างอีเมล render จาก **งานสมมติ** ไม่ใช่งานจริง (PDPA) และโชว์ใน iframe `sandbox=""`
  - `settings/email_templates` อยู่ใต้ `settings` ใช้ rule เดิม **ไม่ต้อง deploy rules**
- **Secrets ที่ต้องเพิ่ม:** `RESEND_API_KEY`, `EMAIL_FROM` (เช่น `BKK APPLE <noreply@bkkapple.com>`), `ORDER_NOTIFY_EMAIL` (อีเมลกลางแอดมิน). Optional: `EMAIL_REPLY_TO`, `CUSTOMER_TRACKING_BASE_URL` (ลิงก์ติดตามในอีเมลลูกค้า). ถ้าไม่ตั้ง `RESEND_API_KEY`/`EMAIL_FROM` → ระบบ skip การส่งเงียบๆ ไม่ crash

## Dealer Portal — ขายส่งยกล็อต + ประมูลปิดซอง (ส.ค. 2026)
- **แบรนด์แยกขาด: ฝั่งดีลเลอร์ = GETMOBIE ไม่ใช่ BKK APPLE** — BKK APPLE เป็นแบรนด์ฝั่ง "รับซื้อ" (B2C) เท่านั้น การเสนอขายส่งทำในนามนิติบุคคลจดทะเบียนโดยตรง (บริษัท เก็ทโมบี้ จำกัด / getmobie.com) ทุก touchpoint ฝั่งดีลเลอร์ (portal `app.getmobie.com`, อีเมล `dealerShell()`, ใบเสนอราคา trade name) ต้องเป็น GETMOBIE ห้ามหลุด BKK APPLE. อีเมลดีลเลอร์ตั้ง sender แยกได้ด้วย env `DEALER_EMAIL_FROM` (เช่น `GETMOBIE <noreply@getmobie.com>` — ต้อง verify โดเมน getmobie.com ใน Resend ก่อน ไม่ตั้ง = ใช้ EMAIL_FROM เดิม)
- **Bounded context แยกจากโดเมนหลัก** — ดีไซน์เต็มที่ `docs/dealer-portal-design.md`. โครง: แอปดีลเลอร์แยกที่ `dealer-portal/` (Vite app ของตัวเอง, hosting target `dealer` → site `getmobie-app` → ซับโดเมน `app.getmobie.com`, **ห้าม import จาก `src/`**), admin UI ใน `src/pages/dealers/`, logic ทั้งหมดใน `functions/dealer-portal.js` (index.js inject `dispatchAdminPush`/`dispatchTelegram`/`staffIdsByRoles` ผ่าน `registerDealerPortal`)
- **Node ใหม่:** `dealers/{uid}` (บัญชี = Firebase Auth, ไม่มี `/admins`), `lots/{id}` (snapshot สินค้า — ดีลเลอร์อ่านรายใบตาม `visible_tiers`+`tier_open_at` ใน rules), `lot_private/{lotId}` (ต้นทุน/reserve/ตัวนับซอง — admin เท่านั้น), `lot_bids/{lotId}/{dealerUid}` (**SEALED — rules ปิด read/write ทุกคนรวม admin**, เข้าถึงผ่าน callable เท่านั้น), `lot_audit` (append-only, bid events ไม่เก็บตัวตน), `dealer_orders/{id}` (ดีลเลอร์อ่านของตัวเอง), `settings/dealer` (tiers/prefix/บัญชีโอน — **ห้ามแตะ `*_seq_by_period` counter**)
- **Sealed bid:** ตัวนับ canonical ที่ `lot_private/{id}/bid_count`; mirror `lots/{id}/bid_stats` เฉพาะเมื่อ `show_bid_stats` (toggle กลยุทธ์ต่อ lot — default ดีลเลอร์ไม่เห็น 5/30). เปิดซอง `adminDealerLotUnsealBids` = CEO/MANAGER + lot ปิดรับแล้วเท่านั้น (ประทับ `unsealed_by`). award อ่านยอดจากซองจริงฝั่ง server — ไม่รับตัวเลขจาก client. reserve price อยู่ `lot_private` ต่ำกว่าต้องส่ง `below_reserve_ack`
- **จุดสัมผัสโดเมนหลักมี 4 จุดเท่านั้น (server ทำ):** publish อ่าน job รายตัว→snapshot + ล็อก `status: Reserved`+`lot_id`+`lot_no` (สถานะ `Reserved` เดิมไม่มีใครใช้ — ตอนนี้เป็นของ lot; Inventory กันแก้สถานะเครื่องติด lot, POS ปลอดภัยเพราะกรอง `Ready to Sell`) | cancel/award ปลดเครื่องคืน `prev_status` | markPaid ตัดสต๊อก `Sold`+`sold_channel:'dealer'` | markPaid เขียน `/sales` (มี `customer_tax_id` จาก dealer_snapshot) → `onSaleCreated` เดิมออกใบกำกับเต็มรูป+ลงบัญชี ภ.พ.30/P&L โดยไม่แก้อะไรเพิ่ม
- **เอกสาร:** ใบเสนอราคาออกอัตโนมัติตอน award (`buildQuotationPdf` ใน voucher-pdf.js, เลข `QT-YYYYMM-####` transaction ที่ `settings/dealer/quotation_seq_by_period`) archive `dealer_quotations/{orderId}.pdf` + แนบอีเมล. เลข lot `LOT-`, order `DO-` pattern เดียวกัน
- **Early access ตาม tier:** publish คำนวณ `tier_open_at` จาก `settings/dealer/tiers/{t}/early_access_min` — บังคับ 3 ชั้น (dealerListLots ซ่อน / dealerPlaceBid ปฏิเสธ / rules เช็ค `now`). scheduler `dealerLotScheduler` (5 นาที, query by status — ห้ามกวาดทั้ง node): ปิดรับอัตโนมัติ + ส่งเมล tier ที่เพิ่งถึงเวลา + เตือน 1 ชม.ก่อนปิดเฉพาะคนยังไม่เสนอ
- **Notification:** หมวด `dealer` (types: `dealer_bid`, `dealer_lot`, `dealer_payment`, `dealer_order`) — mirror 2 ไฟล์ตามกฎเดิม. ปิดรับ→push เจาะ CEO/MANAGER, สลิปเข้า→CEO/FINANCE. อีเมลดีลเลอร์ตามสถานะออเดอร์ = allowlist `ORDER_STATUS_COPY` ใน dealer-portal.js
- **MIRROR types 3 ที่:** `src/types/dealer.ts` (admin) ↔ `dealer-portal/src/types.ts` (portal) ↔ enum ใน `functions/dealer-portal.js` — เพิ่มสถานะ lot/order หรือ tier ต้อง sync ทั้ง 3 (สถานะพวกนี้**ไม่เกี่ยว**กับ `job-statuses.ts`)
- **ชื่อ callable ทุกตัว prefix `adminDealer*`/`dealer*`** ตามกฎ namespace `{region}/{name}`
- **Landing getmobie.com (`getmobie-landing/`):** static site ล้วน (ไม่มี build) hosting target `www` → site `getmobie-landing` — ฟอร์มสมัครดีลเลอร์ยิง callable `dealerRegister` ตรงผ่าน HTTP (โปรโตคอล callable `POST {data}`, ไม่พ่วง Firebase SDK, มี honeypot `website`) → เขียน `dealer_applications/{id}` (rules: admin read, write ปิด — **ไม่สร้าง Auth user ตอนสมัคร**) + push/Telegram แจ้ง CEO/MANAGER + อีเมลยืนยันผู้สมัคร. แอดมินอนุมัติที่ `/dealers` (การ์ดใบสมัคร → prefill โมดอลสร้างบัญชี → `adminDealerCreate` รับ `applicationId` ไปปิดใบสมัคร) หรือปฏิเสธผ่าน `adminDealerApplicationReject`
- **Setup ครั้งเดียวก่อนใช้จริง:** สร้าง custom domain `app.getmobie.com` ชี้ site `getmobie-app` + `getmobie.com` ชี้ site `getmobie-landing` ใน Firebase console + เพิ่ม `app.getmobie.com` ใน Auth Authorized domains + deploy rules จาก bkk-frontend-next + (optional) env `DEALER_PORTAL_BASE_URL` ใน functions/.env ถ้าไม่ใช่ค่า default

## ภาษีหัก ณ ที่จ่าย ค่าตอบแทนไรเดอร์ (ส.ค. 2026)
- **จุดที่หักคือ "ตอนถอน" ไม่ใช่ "ตอนอนุมัติค่ารอบเข้า wallet"** — อนุมัติค่ารอบ = ตั้งหนี้ (เงินยังไม่ออกจากบัญชีบริษัท), ถอน = จ่ายเงินจริงมีสลิปเป็นหลักฐาน. หน้าที่หักภาษีเกิดเมื่อ "จ่ายเงินได้" จึงผูกกับการถอน. ผลพลอยได้: ยอดหักสะสมทั้งปี = 3% ของเงินที่ไรเดอร์ได้รับจริงพอดี ไม่ต้องกระทบยอดย้อนหลังเมื่อถอนไม่หมด
- **หักเฉพาะ `riders/{id}/employment.type === 'freelance'`** — `employee` = เงินได้ ม.40(1) หักที่ payroll (ภ.ง.ด.1) ไม่หักรายครั้ง | **ไม่ระบุ = บล็อกการโอน** (จอ Rider Withdrawals disable ปุ่ม) เพราะเดาผิดทางแปลว่าหักคนที่ไม่ควรหัก หรือปล่อยคนที่ควรหัก ซึ่งเรียกคืนย้อนหลังยาก
- **master switch `settings/accounting/rider_wht.enabled` ปิดเป็นค่าเริ่มต้น** — เปิดแล้วไรเดอร์ได้เงินน้อยลงจากเดิม ต้องแจ้งเขาก่อน ไม่ใช่แค่ deploy. `rate_percent` default 3 (ค่าจ้างทำของ/ค่าบริการ) ตั้งที่ `/accounting-settings`
- **MIRROR สูตร 3 ที่:** `functions/rider-wht.js` (ตัวจริง ออกเอกสาร) ↔ `src/utils/riderWht.ts` (จอ finance ต้องโชว์ยอดโอนสุทธิก่อนโอน) ↔ `bkk-rider-app/src/utils/riderWht.ts` (ไรเดอร์ต้องเห็นก่อนกดถอน) — **แก้สูตรต้องแก้ทั้งสาม**
- **`wallet` ลดเต็มยอดที่ขอถอน** ไม่ใช่ยอดสุทธิ — ภาษีที่หักคือเงินของไรเดอร์ที่บริษัทนำส่งแทน ไม่ใช่เงินที่ไม่เคยเป็นของเขา. `transactions/{id}` เก็บ `amount` (เต็ม) + `wht_amount` + `net_paid` (โอนจริง)
- **เอกสาร 50 ทวิ ออกต่อการถอน 1 ครั้ง** (ม.50 ทวิ: ออกทุกครั้งที่หัก ไม่ใช่สรุปท้ายเดือน) — trigger `onRiderWhtWithheld` (`functions/rider-wht-issue.js`) ยิงเมื่อ `transactions/{id}` category `WITHDRAWAL` ที่มี `wht_amount`: จองเลข `WHT-YYYYMM-####` (transaction ที่ `settings/accounting/wht_seq_by_period/{ym}`) → สร้าง PDF (`buildWhtCertificatePdf`) → archive `wht_certificates/{id}.pdf` → เขียนทะเบียน `wht_certificates/{id}` + สำเนาบนงานถอน `jobs/{id}/wht_certificate` (ไรเดอร์อ่านงานตัวเองได้อยู่แล้ว **ไม่ต้องเพิ่ม rule ให้ไรเดอร์**) → อีเมลแนบ PDF. สร้างไม่สำเร็จ = ลงทะเบียนเป็น `status: "void"` เหมือนใบกำกับภาษี ไม่ปล่อยเลขหายเงียบ
- **`/wht-report` (CEO+FINANCE) เป็นส่วนบังคับ ไม่ใช่ของแถม** — ภาษีที่หักไว้**ไม่ใช่รายได้บริษัท** แต่เป็นเงินของไรเดอร์ที่ถือไว้แทนและต้องนำส่งภายในวันที่ 7 ของเดือนถัดไป ถ้าไม่มีหน้าบอกยอดค้างนำส่ง เงินจะนอนปนในบัญชีแล้วลืมยื่น = เบี้ยปรับ. query ตาม `.indexOn: period`
- **read rule ของ `wht_certificates` อยู่ที่ `bkk-frontend-next/database.rules.json`** (admin read, write ปิด) — **ต้อง deploy rules จาก repo นั้น**
- **แอปไรเดอร์ต้องขึ้นพร้อมกัน** — `WithdrawModal` แสดง "ขอถอน / หัก / ได้รับจริง" ก่อนกดยืนยัน ถ้าเปิดสวิตช์โดยแอปยังไม่แก้ ไรเดอร์จะรู้ตอนเงินเข้าแล้วว่าได้ไม่ครบ
- **ฐานภาษีไม่ใช่ยอดถอน — คือส่วนของยอดถอนที่ดึงจาก "กองเงินได้" (เคาะ 4 ก.ย. 2569)** กระเป๋าไรเดอร์มีเงินสองกอง: เงินได้ (ค่ารอบ/โบนัส/ปรับปรุงค่ารอบ) กับไม่ใช่เงินได้ (เงินคืนค่าทดรอง/เครดิตบริษัทเติมให้/เงินฝากของไรเดอร์) **การถอนดึงกองไม่ใช่เงินได้จนหมดก่อนเสมอ** แล้วที่เหลือมาจากกองเงินได้ ภาษี 3% คิดเฉพาะส่วนหลัง. acceptance ของเจ้าของงาน: กระเป๋า 520 (ค่ารอบ 500 + ค่าจอด 20) ถอน 20 → ฐาน 0 · ถอน 520 → ฐาน 500 ภาษี 15 โอน 505 · กระเป๋า 570 (550+20) ถอน 300 → ไม่ใช่เงินได้ 20 / เงินได้ 280 ภาษี 8.40 โอน 291.60 และ 270 ที่เหลือเป็นเงินได้ล้วน
  - **กองทั้งสองไม่ได้ถูกเก็บเป็นฟิลด์ — derive จาก ledger ทุกครั้ง** (`functions/rider-cost-split.js` `splitWithdrawal`, mirror `src/utils/riderCostSplit.ts` ตรึงด้วย `riderCostSplitParity.test.ts`): กอง = Σ CREDIT ที่ไม่ใช่เงินได้ก่อนแถวนี้ − Σ ส่วนที่การถอนก่อนหน้าดึงไปแล้ว. แถวถอนทุกแถวถูกประทับ `exempt_part`/`taxable_part` (+ชื่อเดิม `reimbursed_part`/`labour_part`) โดย `onRiderWithdrawalExpense` และ**ค่าที่ประทับแล้วชนะการเดา FIFO เสมอ** (ตัวเลขที่ลงบัญชีแล้วห้ามคำนวณใหม่ — เคสที่ต่างกันจริงคือแถวเงินเข้าถูกแก้ป้ายหลังการถอนลงบัญชีไปแล้ว). "270 ที่เหลือคง identity เงินได้" จึงไม่ได้มาจากป้าย แต่จากโครงสร้าง: กองไม่ใช่เงินได้เป็น 0 แล้ว
  - **การจำแนกอ่านธง `taxable` บนแถว CREDIT ไม่ใช่ชื่อหมวด** — ตารางกลางตัวเดียว `WALLET_CREDIT_TAXABLE` ใน `src/utils/transactionLogger.ts` (JOB_PAYOUT/BONUS/ADJUSTMENT = true · EXPENSE_REIMBURSEMENT/COMPANY_ADVANCE/RIDER_DEPOSIT = false) ประทับตอนเขียนผ่าน `buildWalletCredit()`/`logTransaction()`/`buildRiderFeeApproval` ฝั่ง functions (`pin-dispute.js`, สคริปต์ settle/revert) เขียน `taxable: true` ตรงๆ. ชื่อหมวดเป็น **fallback ให้แถวเก่าที่เกิดก่อนมีธงเท่านั้น** (`NON_TAXABLE_CREDIT_CATEGORIES` — MIRROR ของตารางกลาง ทั้ง JS และ TS, parity test เทียบสามที่). **หมวดที่ไม่รู้จัก = เงินได้** (ทิศหักเกิน คืนได้ ไม่ใช่หักขาดที่ต้องไล่เก็บ). ธงที่ไม่ใช่ boolean ไม่นับเป็นธง
  - **หนังสือรับรอง 50 ทวิ พิมพ์เฉพาะฐานภาษี + ภาษี** (`gross = tx.wht_base`) ยอดถอนเต็มกับส่วนที่ไม่ใช่เงินได้อยู่ในฟิลด์แยก (`withdrawal_amount`/`exempt`) ไม่ใช่บนเอกสาร
  - **`COMPANY_ADVANCE`/`RIDER_DEPOSIT` ยังไม่มีหน้าจอเขียน** — มีแค่หมวด + ธง + ป้ายในแอปไรเดอร์ + `buildWalletCredit` ให้เรียก. ตอนเพิ่มหน้าจอต้องเขียนผ่าน helper นั้น ไม่ใช่ push แถวตรง

## หมวดแถวกระเป๋าไรเดอร์ (/transactions.category) — MIRROR **3 ที่** (บรรทัดนี้เคยเขียนว่า 2 และนั่นทำให้หลุดจริง)
- **สามสำเนา ต้องแก้ให้ครบทุกครั้ง:**
  1. `bkk-rider-app/src/utils/walletLedger.ts` — `RIDER_WALLET_CATEGORIES` + ป้ายไทยของจอ
  2. `bkk-rider-app/functions/src/index.ts` — สำเนาใน `riderRequestWithdraw` ที่ใช้คำนวณ **"ยอดถอนได้"**
  3. `src/utils/transactionLogger.ts` ของ repo นี้ — union ของ `category` **+ ตาราง `WALLET_CREDIT_TAXABLE`** (หมวดใหม่ต้องประกาศว่าเป็นเงินได้ไหม — type บังคับ)
- **หมวดตอนนี้มี 8:** JOB_PAYOUT · WITHDRAWAL · PENALTY · BONUS · ADJUSTMENT · EXPENSE_REIMBURSEMENT · COMPANY_ADVANCE (เครดิตบริษัทเติมให้ล่วงหน้า) · RIDER_DEPOSIT (ไรเดอร์ฝากเข้ามาเอง) — สองตัวท้ายเพิ่ม 4 ก.ย. 2569 พร้อมธง `taxable` (ดูหัวข้อ WHT ข้อ "ฐานภาษีไม่ใช่ยอดถอน")
- **หลุดมาแล้วจริงหนึ่งรอบ:** `ADJUSTMENT` (#125) ถูกเพิ่มที่ (1) กับ (3) แต่**ลืม (2)** ผลคือกระเป๋าบนจอไรเดอร์รวมแถว ADJUSTMENT แล้ว แต่ยอดที่ถอนได้ไม่นับมัน — ตัวเลขสองตัวบนจอเดียวกันไม่ตรงกัน **โดยไม่มี error ที่ไหนบอก** และไม่มีเทสไหนจับได้จนกระทั่งมาอ่านโค้ดตอนทำระบบเบิกค่าใช้จ่าย (ก.ย. 2569) — ปิดไปแล้วพร้อมกับการเพิ่ม `EXPENSE_REIMBURSEMENT`
- **ด่านที่กันไม่ให้หลุดอีก:** `bkk-rider-app/src/utils/walletCategoryParity.test.ts` เทียบทั้งสามสำเนาจาก**ข้อความจริงในไฟล์** (import ตัว functions ไม่ได้เพราะมันเรียก `initializeApp` ตอนโหลด) — สำเนาที่สามอยู่คนละรีโป ไม่ได้ checkout ไว้ = ข้าม ไม่ใช่แดง (แบบเดียวกับ `mirror-parity.mjs`)
- **หมวดนอก allowlist ถูกข้ามโดยตั้งใจ** — ดูหัวไฟล์ walletLedger (แถวฝั่งบริษัทที่ติด rider_id เคยทำให้ยอดบวม)
- **`ADJUSTMENT` = แก้ยอดที่คิดผิด ไม่ใช่ `PENALTY` และไม่ใช่ `JOB_PAYOUT`** — ใช้ทั้งสองทิศ (CREDIT/DEBIT) ที่ `functions/pin-dispute.js` (`settlementDelta`) กับ `scripts/revert-pin-dispute.cjs`. เดิมทิศลบเป็น `PENALTY` ซึ่งขึ้นบนกระเป๋าว่า **"รายการหัก"** ทั้งที่ไม่มีใครทำผิด (เคสจริง 1 ก.ย. 2569 งาน OID-MTHBWFJJ-384 — หมุดลูกค้าถูกอยู่แล้ว แต่ไรเดอร์กดสามสถานะรวดตอนขากลับ ค่ารอบเลยถูกคิดใหม่จากจุดเช็คอิน แล้วต้องย้อนคืน)
- **หมวดเก่าห้ามถอดออกจาก allowlist** — `PENALTY`/`JOB_PAYOUT` ยังอยู่ทั้งคู่ ถอดเมื่อไหร่แถวเก่าที่ยังอ้างมันหลุดจาก balance เงียบๆ
- **แถวเก่าที่ติดป้ายผิด แก้ป้ายได้ แต่ต้องทิ้งร่องรอย** — `scripts/relabel-pin-dispute-tx.cjs <jobId>` (dry-run เป็นค่าเริ่มต้น) แก้เฉพาะ `category` ของแถวที่ `pin_dispute` ชี้ (`delta_tx_id`/`revert_tx_id`) แล้วเขียน `category_was` + `category_corrected_at` + `category_correction_reason` ไว้ด้วยเสมอ
  - **เส้นแบ่งคือ ป้าย ≠ เงิน** — จำนวนเงิน/เวลา/คำอธิบาย/`ref_job_id` **ห้ามแตะย้อนหลังเด็ดขาด** (ผิดยอด = ลงแถวชดเชย ไม่ใช่แก้แถวเดิม — ดู `revert-pin-dispute.cjs`) ส่วนป้ายที่ติดผิดตั้งแต่ต้นคือการ**แก้ให้อ่านตรงความจริง** ซึ่งทับเงียบๆ ไม่ได้ จึงต้องเก็บป้ายเดิมไว้ให้ย้อนดูได้
  - **ห้าม scan `/transactions` หา `PENALTY` แล้วแก้ยกชุด** — ค่าปรับจริงมีอยู่จริงและเป็นคนละเรื่อง (และกฎค่า RTDB ห้ามกวาดทั้ง node อยู่แล้ว) สคริปต์จึงเข้าถึงแถวผ่าน `pin_dispute` เท่านั้น

## Coupons / Review Reward Ledger
- **Master campaign:** `/coupons` (จัดการที่ `/coupons` — `CouponManager.tsx`). save เขียน `is_model_restricted` คู่กับ `applicable_models` (true เมื่อระบุรุ่นเอง) — ฝั่งลูกค้า (`bkk-frontend-next`) ใช้แยก "ไม่จำกัดรุ่น" ([] + false) ออกจาก "จำกัดแต่ config ขาด" (fail closed)
- **Review reward:** ลูกค้ารีวิว → `bkk-frontend-next` `app/api/reviews/submit` mint คูปองลง `users/{uid}/coupons` (code `THX-xxxx`, `coupon_id` ชี้ master ร่วม `/coupons/REVIEW_REWARD` ที่ `system: true`) + เขียน ledger `/issued_coupons/{id}`
- **Ledger `/issued_coupons/{id}`:** `{ code, value, uid, review_id, job_id, issued_at, expires_at, status: issued|used, used_at, used_job_id }`. ออกตอนรีวิว (status `issued`), `validateAndCreateOrder` flip เป็น `used` ตอน redeem. **read rule = admin** (อยู่ที่ `bkk-frontend-next/database.rules.json` — deploy จาก repo นั้น)
- **หลายใบต่อออเดอร์ (bucket) — ส.ค. 2026:** งานหนึ่งใบถือคูปองได้หนึ่งใบต่อหนึ่ง bucket ที่ `jobs/{id}/applied_coupons[]` — `device` (หนึ่งใบต่อหนึ่งเครื่อง และแคมเปญเดียวกันเกาะได้ทุกเครื่องที่เข้าเงื่อนไข — โควตาถูกตัดหนึ่งครั้งต่อหนึ่งเครื่อง), `review` (คูปองรีวิว), `promo` (แคมเปญระดับออเดอร์). เจ้าของ logic คือ `bkk-frontend-next/functions/src/couponEngine.ts` — repo นี้เป็นแค่**คนอ่าน**กับ**คนลบ**
  - **อ่านผ่าน `sumAppliedCoupons()` / `listAppliedCoupons()` (`src/utils/adjustments.ts`) เท่านั้น** — array มาก่อน แล้ว fallback `applied_coupon`. **ห้ามบวกทั้งสองฟิลด์** (บนงานใหม่ `applied_coupon` เป็นสำเนาของใบสูงสุด = นับซ้ำ). MIRROR 4 ที่: `bkk-frontend-next/app/utils/jobPricing.ts` + `functions/src/index.ts`, repo นี้, `bkk-rider-app/src/utils/adjustments.ts`
  - สูตร net_payout ไม่เปลี่ยนรูป แค่ `coupon` กลายเป็น **ผลรวมของทุกใบ** (คูปองชนิด `service` เป็น 0 — มันไปล้าง `pickup_fee` แทน)
  - **UI ตั๋วโชว์ครบทุกใบแล้ว** (PricingSidebar / MobileTicketDetail / InvoicePage / B2CWorkspace / `/coupon-analytics`) — บรรทัดละใบ **และลบได้ทีละใบ** ผ่าน `removeCouponAtFields()` + `couponTotalWithout()` (`src/utils/adjustments.ts`): เขียน array ที่เหลือ + สำเนาใหม่ (ต้องติดธง `mirrored` เสมอแม้เหลือใบเดียว) แล้ว `onJobCouponsRevoked` diff ให้เองว่าใบไหนหลุด. ปุ่ม "แก้ไข" ยังมีใบเดียวเพราะมันคือ Manual Top-up ซึ่ง**แทนที่ทั้งชุด**
  - **ตั้งค่าที่ `/coupons`** (`CouponManager.tsx`): dropdown "คูปองใบนี้ผูกกับอะไร" = `scope` และสวิตช์ "ใส่ให้ลูกค้าอัตโนมัติ" = `auto_apply` (ตัวหลังคือสวิตช์เปิดระบบทั้งหมด). save เขียนสองฟิลด์นี้ลงทุกใบเสมอ (default `promo` + ปิด) คูปองเก่าจึงมีความหมายชัดเจนโดยไม่ต้องให้ server เดา. ตารางโชว์ป้าย scope + "อัตโนมัติ" เพื่อให้เห็นจากหน้ารายการว่าใบไหนแจกเองอยู่
- **หน้า reconcile:** `/issued-coupons` (`src/pages/admin/IssuedCoupons.tsx`, CEO/MANAGER/FINANCE) — ตาราง issued vs used vs expired + มูลค่า + cross-check กับ `/reviews` (flag ใบที่ used แต่ไม่พบรีวิว) + export CSV

## Role-Based Access & Staff Accounts (สถาปัตยกรรมใหม่ ส.ค. 2026)
- **พนักงานแต่ละคนมีบัญชี Firebase Auth ของตัวเอง** (อีเมล+รหัสผ่านส่วนตัว) — เลิกใช้บัญชีมาสเตอร์ร่วม + เลือกชื่อ + PIN แล้ว. `LoginScreen` เป็น email/password ขั้นตอนเดียว
- **วงจรบัญชีทั้งหมดผ่าน cloud functions เท่านั้น** (`functions/staff-accounts.js` — CEO-gated ฝั่ง server ด้วยอีเมลใน auth token): `adminStaffCreate` / `adminStaffUpdate` / `adminStaffSetStatus` / `adminStaffDelete` / `adminStaffResetPassword`. **database rules ปิด client write ที่ `/staff` และ `/admins` แล้ว** (แก้ที่ `bkk-frontend-next/database.rules.json` — ต้อง deploy จาก repo นั้น) — Admin SDK ใน functions เป็นผู้เขียนคนเดียว. functions สร้าง/ถอน `/admins/{uid}` คู่กับบัญชีเสมอ
- **พักงาน (INACTIVE) บังคับ 3 ชั้น:** auth user ถูก disable (login ใหม่ไม่ได้) + revoke refresh tokens + ลบ `/admins/{uid}` (rules ตัดสิทธิ์ทันที). ฝั่ง client `useStaffSession` เฝ้า `staff/{id}/status` แบบ realtime — ถูกพักงานปุ๊บ session ที่เปิดค้างโดนเตะออกทันที. ไม่มี fallback "ไม่รู้จัก = role STAFF" อีกแล้ว: อีเมลที่ไม่ match staff record ที่ ACTIVE จะถูก sign out
- Role ที่ระบบรู้จักมี **4 ค่าเท่านั้น**: CEO / MANAGER / STAFF / FINANCE (route guard ใน `App.tsx`, `settingsNav.tsx`, `AdminLayout`, `canReviewAdjustments`, `functions/staffIdsByRoles`) — ค่าเก่า CASHIER/QC ถูกเลิกใช้ หน้า `/staff` จะ flag ให้แก้
- **CEO:** เข้าถึงทุกฟีเจอร์ + จัดการบัญชีพนักงาน
- **MANAGER:** เข้าถึงเกือบทุกฟีเจอร์ (ยกเว้น Staff Management, Global Settings, รายงานการเงิน/ภาษี)
- **STAFF:** เข้าถึงฟีเจอร์พื้นฐาน (Tickets, QC, คลัง, POS) — เสนอ Offer ได้แต่ต้องรอ CEO/MANAGER อนุมัติ
- **FINANCE:** เข้าถึง Finance, Daily Expenses, P&L, ภ.พ.30, สมุดรายวัน, ตั้งค่าระบบบัญชี
- **การผูก role ใช้อีเมล:** staff record มี `email` (lowercase) + `uid` ของบัญชี Auth — `useStaffSession` ฝั่ง client และ `lookupStaffByAuth` ฝั่ง functions จับคู่ด้วยอีเมล
- **FCM token ต้อง key ด้วย staff push id** (`admin_fcm_tokens/{staffId}`) ไม่ใช่ Firebase uid — push แบบเจาะ role (`staffIdsByRoles` → `dispatchAdminPush(allowStaffIds)`) ฟิลเตอร์ด้วย staff id; session มี `id` เสมอ call sites ใช้ `currentUser?.id || currentUser?.uid`

## เวลาทำการ & วันหยุด (settings/store/business_hours)
- **หน้า `/business-hours`** (`src/pages/admin/BusinessHoursSettings.tsx`, CEO/MANAGER, กลุ่ม Company ใน settingsNav) = เจ้าของ `settings/store/business_hours`: `openHour` / `closeHour` / `closedDays[]` (0=อา..6=ส) / `holidays[]` (YYYY-MM-DD ปฏิทินไทย) / `temporaryClosed` + `temporaryClosedMessage`
- **ค่าชุดนี้ gate หน้า checkout ของลูกค้าจริง** — ตัวเลือกวันใน modal นัดรับเครื่อง (ทั้งไรเดอร์และเข้าสาขา) มาจากมันโดยตรง และ `validateAndCreateOrder` ฝั่ง `bkk-frontend-next/functions` ตรวจซ้ำด้วยค่าเดียวกัน ตั้งวันหยุดที่นี่ = ลูกค้ากดจองวันนั้นไม่ได้ทันที ไม่ต้อง deploy
- **ห้ามสับสนกับ "เวลาทำการมาตรฐาน" ที่ `/store-settings`** — อันนั้นคือ `settings/store_profile.hours_start/hours_end` ซึ่งเป็น**ข้อความที่ AI เอาไปพูดกับลูกค้าเท่านั้น ไม่ได้ควบคุมอะไร** แอดมินที่เข้าไปแก้ตรงนั้นเพื่อหวังปิดไม่ให้จองจะไม่เกิดอะไรขึ้นเลยและไม่มีอะไรบอกเขา — จึงมีกล่องเตือน + ลิงก์ข้ามไปหน้านี้ฝังไว้ที่ `StoreSettings.tsx` **ห้ามลบ**
- **ที่มา:** เดิมค่านี้แก้ได้ที่ `bkk-frontend-next/app/admin/settings` ที่เดียว ซึ่งกำลังจะถูกยุบมารวมที่ระบบนี้ หน้านี้จึงเกิดขึ้นมารับช่วง — **ทั้งสองหน้าเขียน path เดียวกัน** ช่วงเปลี่ยนผ่านจึงใช้พร้อมกันได้ ไม่ต้อง migrate ข้อมูล
- **เตือนเมื่อปิดวันที่มีนัดค้าง:** กดเพิ่มวันหยุดที่มีนัดอยู่ → โมดอลโชว์รายการงาน (ref/เวลา/วิธีรับ/สถานะ) + วันหยุดที่ตั้งไว้แล้วขึ้นป้ายแดงถ้ามีนัดค้าง **เตือน ไม่ใช่บล็อก** — ปิดร้านกะทันหันต้องทำได้จริง (พนักงานป่วย ไฟดับ) สิ่งที่ต้องไม่เกิดคือปิดไปเงียบๆ แล้วลูกค้ามาเจอประตูล็อก เพราะการปิดวันไม่ได้ยกเลิกนัดที่จองไว้
- **MIRROR 2 ที่:** `src/utils/holidayConflicts.ts` ↔ `bkk-frontend-next/app/utils/holidayConflicts.ts` — กฎเดียวกัน เทสเดียวกัน แชร์ไม่ได้เพราะแต่ละ repo ถือ `job-statuses.ts` ของตัวเอง (ดู Data Contracts ข้อ 6) และตัวนี้อ่าน `getPhase()` จากมัน **แก้ที่หนึ่งต้องแก้ทั้งคู่พร้อมเทส**
  - เกณฑ์คือ "ยังมีคนจะมาไหม" ไม่ใช่ `isTerminal()` — ข้ามงานที่เครื่องถึงมือแล้ว (`Drop-off Received`/`Parcel Received` + เฟส inspection/payout/inventory/terminal/pending_close) นอกนั้นนับหมด **รวมงานที่กำลังส่งเครื่องคืนลูกค้า** เพราะนั่นก็เป็นการเดินทางที่ตกวันหยุดได้
  - **สถานะที่ไม่รู้จักนับว่ายังมีคนจะมา** โดยตั้งใจ — สถานะใหม่มีโอกาสเป็นขั้นกลางทางมากกว่าเป็นวิธีจบงานแบบใหม่ และต้นทุนเดาผิดไม่สมมาตร (เตือนเกิน = เหลือบมองครั้งเดียว / เตือนขาด = ลูกค้ายืนหน้าร้านที่ปิด)
- **การตรวจนัดค้างใช้ `useDatabase('jobs')` ไม่ยิง query ใหม่** — แอปนี้ subscribe `jobs` อยู่แล้วทั้งแอป การเปิดหน้านี้จึงไม่เพิ่มค่า download เลย (กฎค่า RTDB)

## ราคาสด / ยืนราคา (settings/quote)
- **ราคารับซื้อไม่ถูกเก็บไว้ในเครื่องลูกค้าอีกแล้ว** — ตะกร้าเว็บลูกค้าเก็บแค่รหัสประเมิน `Q-XXXXXX` ราคาคำนวณสดจาก `/models` ทุกครั้ง. ระบบทั้งหมดอยู่ `bkk-frontend-next/functions/src/assessments.ts` (ดู CLAUDE.md ของ repo นั้น) — repo นี้เป็นเจ้าของแค่**หน้าตั้งค่า**กับ**การแสดงผลบนตั๋ว**
- **หน้าตั้งค่า:** `/global-settings` การ์ด "ราคาประเมิน และการยืนราคา" เขียน `settings/quote`: `checkout_ttl_min` (15 นาที ระหว่างกรอกฟอร์ม) / `lock_days` (7 วัน ยืนราคาหลังลงทะเบียน) / `assessment_gc_days` (30 วัน อายุรหัสที่ไม่กลายเป็นงาน)
- **กันไว้ 2 เคสตอนบันทึก:** เวลากรอกฟอร์ม < 3 นาที (ลูกค้ากรอกเลขบัญชีไม่ทัน) และอายุรหัส < วันยืนราคา (รหัสถูกลบก่อนราคาหมดอายุ = อ้างอิงย้อนหลังไม่ได้)
- **สิ่งที่ยืนคือราคาตลาด ไม่ใช่ผลตรวจ** — ป้ายใน `PricingSidebar` เขียนบอกไว้ตรงๆ ห้ามแก้ข้อความให้กำกวม เพราะแอดมินที่เข้าใจผิดว่า "ห้ามหักอะไรเลย" จะทำให้ QC ไม่กล้าหักตำหนิที่พบจริง
- `settings/quote` อยู่ใต้ `settings` ใช้ rule เดิม **ไม่ต้อง deploy rules**

## ใบเสร็จขาย (settings/receipt) — คอมโพเนนต์เดียว สองขนาดกระดาษ

- **`src/components/receipt/ReceiptTemplate.tsx` = หน้าตาใบเสร็จขายตัวเดียวของทั้งระบบ** ใช้ร่วมกัน 3 จุด: POS หลังจ่ายเงิน (`pages/sales/POS.tsx`), พรีวิวในประวัติการขาย และฉบับที่ส่งเข้าเครื่องพิมพ์ (`pages/sales/SalesHistory.tsx`) — **ห้ามก๊อปมาร์กอัปใบเสร็จไปไว้ที่อื่นอีก**
- **ที่มา:** เดิมมาร์กอัปชุดนี้ถูกก๊อป 3 ที่แล้วเพี้ยนจากกันทีละจุด จน**ฉบับที่พิมพ์จริงกลายเป็นฉบับที่ข้อมูลน้อยที่สุด** (ไม่มีแคชเชียร์ ไม่มีชื่อลูกค้า และบิลที่ยกเลิกพิมพ์ออกมาสะอาดเหมือนบิลปกติ) ไม่มีใครรายงาน เพราะมันไม่พัง มันแค่พิมพ์ไม่ครบ
- **สองขนาดกระดาษ = สอง layout ไม่ใช่ตัวเดียวยืด** — `ThermalBody` (80mm เรียงลงเป็นแถบเดียว คั่นเส้นประ) / `A4Body` (เอกสาร: หัวสองคอลัมน์ ตารางรายการมีหัวคอลัมน์ ยอดรวมชิดขวา). ดูหัวข้อ "ผลพิมพ์ (print)" ก่อนแตะ print CSS
- **ค่าตั้งอยู่ RTDB `settings/receipt`** (ไม่ใช่ Firestore — แอดมินฝั่งนี้ไม่มี client Firestore เลย): `shopName` / `addressLine` / `taxId` / `footerLines[]` / `paperSize` / `fontSizePx` / `showImei`. อยู่ใต้ `settings` ใช้ rule เดิม **ไม่ต้อง deploy rules**
- **หน้าตั้งค่า `/settings/receipt`** (`src/pages/admin/ReceiptSettings.tsx`, CEO, กลุ่ม Basic ใน settingsNav) — พรีวิวใช้ `ReceiptTemplate` **ตัวเดียวกับที่พิมพ์จริง** ไม่ใช่ภาพจำลอง และ render จากงานสมมติ ไม่ใช่บิลจริง (PDPA)
- **`useReceiptSettings` fail-soft ทุกทาง ห้ามทำให้ throw** — ไม่มี doc / อ่านไม่ได้ / เน็ตหลุด = คืนค่าตั้งต้น เพราะใบเสร็จคือสิ่งที่ลูกค้ายืนรออยู่หน้าเคาน์เตอร์ ไม่ใช่หน้าจอที่กด retry ได้. แคช module-level อ่านครั้งเดียวต่อการเปิดแอป หน้าตั้งค่าเรียก `primeReceiptSettings()` หลังบันทึก
- **`normalizeReceiptSettings` แยก "ไม่มี doc" ออกจาก "ลบท้ายใบเสร็จหมดแล้ว"** — RTDB ลบคีย์ทิ้งเมื่อค่าเป็น array ว่าง ถ้าไม่แยกสองเคสนี้ ท้ายใบเสร็จที่แอดมินเพิ่งลบจะโผล่กลับมาเองเงียบๆ
- **`.print-area` ใน `SalesHistory` เป็นของ Z-Read เท่านั้นแล้ว** — ใบเสร็จมี print CSS ของตัวเองที่เทมเพลต (ซึ่งประกาศ `@page` ตามขนาดกระดาษ) อย่าเอาสองอันมาปนกัน. **แต่ `<style>` ของ Z-Read ยังอยู่บนหน้าตลอดเวลาและสั่ง `body * { visibility: hidden }`** ซึ่งครอบใบเสร็จด้วย — เทมเพลตจึงต้องมี `visibility: visible !important` ของตัวเองไว้ดึงกลับ **ห้ามถอด** (ถอดแล้วพิมพ์ได้ 1 หน้าว่างเปล่า เกิดขึ้นจริงใน #655 แก้ที่ #656)
- **ด่านผลพิมพ์อยู่ที่ `receiptPrint.test.tsx`** — แตะ print CSS หรือ layout ของใบเสร็จแล้วต้องผ่านชุดนี้ และควรเปิด preview ของ PR สั่งพิมพ์ดูด้วยตาอีกรอบ (ดูหัวข้อ "ผลพิมพ์ (print)")
- **`updated_by` เก็บชื่อพนักงาน ไม่เก็บอีเมล** ตามบทเรียน `price_ledger`

## RTDB Cost Rules (บทเรียนจากบิล ก.ค. 2026 — อย่าทำพัง)
- **ห้าม scheduler อ่าน `/jobs` ทั้งก้อน** — ใช้ `fetchJobsByStatuses()` (query ตาม `.indexOn: status`) เสมอ. `checkOverdueReturns` รันทุก 5 นาที เคยกวาดทั้ง node = ~288 full download/วัน ลงบิลตรงๆ. ข้อยกเว้นที่ตั้งใจ: `autoFlagRiders` (วันละครั้ง ต้องดูทุกงานใน lookback) และ endpoint migration แบบ manual
- **ห้าม client subscribe `/jobs` ทั้งก้อนจากอุปกรณ์จำนวนมาก** — rider ใช้ `useRiderJobs` (query rider_id + pool statuses). แอดมินใช้ shared keep-alive store ใน `useDatabase` (listener ต่อ path ตัวเดียวทั้งแอป ห้ามกลับไป subscribe/unsubscribe ต่อหน้า)
- **แคตตาล็อกฝั่ง bkk-frontend-next = 3600s + on-demand invalidate** (`CATALOG_REVALIDATE_SECONDS` ใน `lib/cachePolicy.ts`) — **ห้ามลดกลับโดยไม่อ่านหัวข้อ "แคตตาล็อกสด" ใน CLAUDE.md ของ repo นั้นก่อน**: ความสดมาจากการ invalidate ตอนมีคนแก้ราคา ไม่ใช่จากนาฬิกา ตัวเลข 3600 เป็นตาข่ายกันตกเฉยๆ (ทุก revalidate = ดึง `/models.json` ทั้งก้อน). บรรทัดนี้เคยเขียนว่า 300s ซึ่งเป็นค่าเก่าก่อนเปลี่ยนจาก poll เป็น push

## ทะเบียนงานค้าง (เก็บรอบหน้า)

> รูปแบบเดียวกับหัวข้อชื่อเดียวกันใน `bkk-frontend-next/CLAUDE.md` — **ของที่รู้ว่ายังไม่ได้ทำ ต้องมีที่อยู่ ไม่งั้นมันหายไปพร้อมกับ session ที่รู้เรื่องมัน** และรอบหน้าจะมาเจอตอนลูกค้าหรือเจ้าของงานถาม
>
> เกณฑ์ที่ใช้ตัดสินว่าอะไรควรอยู่ที่นี่: **"ตัดสินใจแล้วว่าไม่ทำตอนนี้"** (พร้อมเหตุผล) หรือ **"ทำครึ่งเดียวโดยตั้งใจ"** — ไม่ใช่ไอเดียลอยๆ ที่ไม่มีใครเคาะ

### แอปพนักงาน — ค้างจากรอบสาม (5 ก.ย. 2569)

**ฝั่งที่ยังไม่มีคนเขียน ทั้งที่ฝั่งอ่านทำไปแล้ว** (รูปกลับด้านของบทเรียน `status_history` — คราวนี้คือ *reader มี writer ไม่มี* ซึ่งอ่านบนจอแล้วเหมือนฟีเจอร์เสีย):
- **โน้ตรายวันของตารางเวร** — `employeeRoster` อ่าน `shift_roster/{id}/{date}.note` และหน้าตารางกะวาดมันแล้ว แต่ **`adminHrRosterSet` ยังไม่รับ `note`** ตารางเวรฝั่งแอดมิน (`/hr/shifts`) เป็นตะแกรง dropdown ต่อเซลล์ การเพิ่มช่องโน้ตต้องออกแบบเซลล์ใหม่ **จนกว่าจะทำ ฟิลด์นี้จะว่างเสมอ ซึ่งไม่ผิด แต่ก็ไม่มีใครได้ใช้**
- **ระดับพนักงาน (`P4 · Senior` ในดีไซน์ 08)** — ไม่มีฟิลด์นี้ในทะเบียนพนักงานเลย หน้าโปรไฟล์จึงแสดง ฝ่าย/สาขา แทน. จะทำต้องเพิ่ม `job_level` ที่ `hr-core.js` (sanitize) + ฟอร์ม `/employees` + `AUDIT_FIELDS`

**ฝั่งแอดมินยังตามไม่ทันของใหม่ในแอป:**
- **HR กรอกใบลาครึ่งวันแทนพนักงานไม่ได้** — `validateLeaveRequest` รับ `half_start`/`half_end` แล้ว แต่ฟอร์มใน `EmployeeRegister.tsx` ยังไม่มีตัวเลือก **ผลคือใบที่พนักงานยื่นเองเป็น 0.5 วันได้ แต่ใบที่ HR กรอกแทนเป็นจำนวนเต็มเสมอ** — ไม่พัง แต่สองทางเข้าให้ผลไม่เท่ากัน
- **หน้า HR ไม่แสดงไฟล์แนบของใบลา** — `publicRequest` ส่ง `attachments` ออกมาแล้วและกล่องอนุมัติในแอปใช้ได้ แต่หน้า `/employees` ฝั่งเว็บยังไม่วาด **ยังไม่มี callable ให้ HR (ที่ไม่ใช่หัวหน้าตรง) เปิดไฟล์แนบด้วย** — `supervisorLeaveAttachment` ผูกกับสายบังคับบัญชาโดยตั้งใจ
- **ไม่มีการแจ้งเตือนเมื่อมีคำขอสลับกะถึงเพื่อน** — ตอนนี้เขาต้องเปิดแอปมาเจอเอง (มีแค่ตัวชี้ `shift_swap_inbox`). แอปพนักงานยังไม่มีระบบ push เลยทั้งแอป การเพิ่มต้องเริ่มที่ FCM ของ site นี้ก่อน ไม่ใช่แค่เสียบ trigger

**ตัดสินใจแล้วว่าไม่ทำ พร้อมเหตุผล** (อย่ารื้อโดยไม่มีข้อมูลใหม่):
- **สแกน QR หน้างาน** — QR ที่ติดไว้เฉยๆ ถ่ายรูปส่งให้เพื่อนได้ จึงไม่พิสูจน์ว่าใครอยู่ตรงนั้น ทำให้พิสูจน์ได้ต้องเป็นรหัสหมุนบนจอที่สาขา = ระบบใหม่ทั้งชุด (อุปกรณ์ + นาฬิกาที่ตรงกัน + เส้นทางสำรองตอนจอดับ)
- **เช็คอินนอกสถานที่** — ยังไม่มีเส้นทางในระบบ ต้องออกแบบว่าใครอนุมัติและมันต่างจาก `out_outside` ที่มีอยู่ยังไง
- **แผนที่จริงบนจอเช็คอิน** — ใช้ `Geofence` ที่วาดเองแทน ดูเหตุผลในไฟล์นั้น (คิดเงินต่อการโหลด + คีย์ล็อก referrer ไว้กับโดเมนอื่น)
- **ปุ่ม "ขอเอกสารจาก HR"** — ยังไม่มีเส้นทางรับคำขอ ปุ่มที่กดแล้วไม่มีใครได้รับคือคำสัญญาปลอม
- **เปิดไฟล์เอกสารที่ HR ออกให้ จากแอป** — ตัวสร้าง PDF อยู่ฝั่ง HR (`adminHrDocumentPrint`) ยังไม่มี callable ให้เจ้าตัวสั่งพิมพ์ซ้ำ ตอนนี้แสดงเลขที่+วันที่ไว้อ้างอิงพร้อมเขียนบอกตรงๆ
- **ปุ่ม "จัดเรียง" เมนูหน้าแรก** — ไม่มีที่เก็บลำดับที่ผู้ใช้จัดเอง
- **ลิงก์ "บัญชีธนาคาร" / "ตั้งค่าความปลอดภัย" ในแท็บฉัน** — แก้จากแอปไม่ได้ (เลขบัญชีอยู่ในแฟ้มลับที่ HR ดูแล · รหัสผ่านรีเซ็ตโดย HR)
- **จอสวัสดิการ** — ไม่มีข้อมูลสวัสดิการในระบบเลย

### ต้องทำครั้งเดียวก่อนใช้จริง (ยังไม่ได้ทำ — ผมทำแทนไม่ได้)

1. เพิ่มโดเมนแอปพนักงานใน **Auth > Authorized domains**
2. ผูกบัญชี Auth เข้ากับแฟ้มพนักงาน (`links.staff_id` / `auth_uid`) — **ไม่ผูก = เข้าแอปไม่ได้**
3. ตั้ง **พิกัดสาขา** ให้ครบ — ไม่มีพิกัด = ทั้งสาขาลงเวลาไม่ได้
4. ตั้ง **`supervisor_id`** ในแฟ้มพนักงาน — ไม่ตั้ง = ใบลาไม่มีใครอนุมัติจากแอปได้ (แอปเตือนให้แล้วในหน้าโปรไฟล์ แต่คนแก้คือ HR)
5. จัด **ตารางเวร** อย่างน้อยหนึ่งเดือน หรือตั้ง `default_shift_id` — ไม่งั้นหน้าตารางกะขึ้นว่ายังไม่มีเวร

### หนี้เก่าที่ยังไม่ปิด

- **`account_issued` ใน `AUDIT_ACTIONS` ยังไม่มีผู้เขียน** — ต้องไปเสียบที่ `adminStaffCreate` (`staff-accounts.js`) **ไม่ใช่เดาจากการ "ผูกบัญชี" ใน `adminHrEmployeeLink`** (ผูก ≠ ออกบัญชี)
- **บัญชี Auth เป็นกองเดียวกันทั้งระบบ** (พนักงาน · ไรเดอร์ · ดีลเลอร์ · **ลูกค้า**) — หน้าล็อกอินของแอปพนักงานจึงกันใครไม่ได้ ตัวที่กันคือด่านของ callable ทุกตัว **ข้อมูลไม่รั่ว แต่คนแปลกหน้ายังเข้ามานั่งในแอปได้จนกว่า `employeeMe` จะตอบ** การแยกกอง Auth เป็นการตัดสินใจสถาปัตยกรรมที่ยังไม่เคาะ
- **สัญญา `CT-2569-0001` ต้องออกใหม่** (ค้างจากรอบก่อน)

## Known Issues & Workarounds
- **VAPID Key + atob():** Firebase SDK ใช้ `atob()` ภายใน `getToken()` ซึ่ง fail กับ base64url ไม่มี padding → ต้อง patch `window.atob` ชั่วคราว (ดู `useAdminPushNotifications.ts`)
- **Service Worker Config:** `firebase-messaging-sw.js` ใช้ Firebase config แบบ hardcode (ไม่ใช่ env vars) — ถ้าเปลี่ยน Firebase project ต้องแก้ไฟล์นี้ด้วย

## ตรวจงานก่อน push: `npm run verify` คำสั่งเดียว (บทเรียน 5 ก.ย. 2569)

- **`npm run verify` (`scripts/verify.sh`) รันด่านชุดเดียวกับ CI ตามลำดับเดียวกัน** — tsc ของ root · status vocab · เทสทั้งรีโป (`REQUIRE_PRINT_CHECKS=1`) · **build แอปพนักงาน** · เทสออฟไลน์ของ functions · syntax ของ functions
- **ที่มา: การรัน "ทีละอย่างตามที่จำได้" พลาดมาแล้วจริง (PR #730)** — ตรวจด้วย `npx tsc -b` ที่ root แล้ว `npx vite build` ใน `employee-app/` แล้วรายงานว่าเขียว **ทั้งสองคำสั่งไม่ตรวจ type ของแอปพนักงานเลยสักตัว**:
  - `tsc -b` ที่ root อ่าน tsconfig ของ root ซึ่ง**ไม่ได้ reference `employee-app/`**
  - `npx vite build` **ข้าม tsc** (สคริปต์จริงคือ `tsc -b && vite build`)
  - CI จับได้สองข้อในนาทีเดียว (`requested_by_name` ที่ไม่มีใน type · fixture ของ `session.test.ts` ที่ขาดฟิลด์ใหม่) ทั้งที่ในเครื่องเขียวสนิท
- **ความรู้ข้อนี้เขียนไว้แล้วใน `.github/workflows/ci.yml`** ("`npx tsc -b` ของ root มองไม่เห็นมันเลย") **แต่ไฟล์นั้นไม่ใช่ที่ที่คนเปิดอ่านตอนกำลังตรวจงานก่อน push** — รูปเดียวกับบทเรียน "เอกสารที่เตือนไว้แล้วช่วยไม่ได้ ถ้าไม่ได้เปิดอ่านตอนกำลังแก้" ของ `bkk-frontend-next` ทางแก้จึงเป็นการ**ย้ายกฎมาเป็นคำสั่งที่รันได้** ไม่ใช่เขียนเตือนเพิ่มอีกที่
- **แอปย่อยทุกตัวมี tsconfig ของตัวเอง** (`employee-app/`, `dealer-portal/`) — เพิ่มแอปย่อยใหม่เมื่อไหร่ **ต้องเพิ่มขั้นตอน build ของมันเข้า `verify.sh` และเข้า `ci.yml` พร้อมกัน** ไม่งั้นมันจะไม่ถูกตรวจ type เลยจนกว่าจะ deploy

## Important Notes
- ก่อน push ให้รัน **`npm run verify`** (ดูหัวข้อข้างบน) — `tsc --noEmit` หรือ `tsc -b` เปล่าๆ **ไม่ครอบแอปย่อย**
- ถ้าแก้ Cloud Functions ต้องรอ GitHub Actions deploy functions ด้วย (ไม่ใช่แค่ hosting)
- เทสบน Chrome DevTools ≠ เทสบน iPhone จริง (โดยเฉพาะ push notification)
- iOS PWA มีข้อจำกัดเรื่อง service worker และ push ที่ต่างจาก Android/Chrome
- ถ้าลองแก้ปัญหาเดิม 2 ครั้งแล้วไม่สำเร็จ → หยุดวิเคราะห์ root cause ให้ลึกก่อน อย่าแก้วน
