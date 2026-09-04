// index.html ต้องบอกเบราว์เซอร์ว่าห้ามแปลหน้า — ตรวจจาก SOURCE ของ index.html
//
// ที่มา (บั๊กจากเครื่อง Android ของไรเดอร์จริง 4 ก.ย. 2569 ที่ bkk-rider-app #160 — รีโปนี้มี lang="en" แบบเดียวกัน และแอดมินเปิด /mobile บนมือถือเหมือนกัน): index.html ประกาศ
// lang="en" ทั้งที่เนื้อหาเป็นไทยทั้งแอป Chrome จึงเสนอแปลหน้า (ไทย→ไทย ได้ข้อความ
// เพี้ยน: "เกิดข้อผิดพลาด" กลายเป็น "นั่นก็คือ") และการแปลของ Chrome **แก้ DOM
// ตรงๆ** — ห่อทุก text node ด้วย <font> — React จึงหา child ที่ตัวเองสร้างไม่เจอ
// ตอน reconcile แล้วล้มทั้งแอปด้วย NotFoundError: insertBefore/removeChild
// (React issue #11538) จอที่ไรเดอร์เห็นคือ ErrorBoundary ซึ่งข้อความในนั้นก็ถูก
// แปลไปด้วยจนอ่านไม่ออก
//
// กันสามชั้นเพราะแต่ละเบราว์เซอร์อ่านคนละอย่าง: lang="th" (Chrome ไม่เสนอแปล
// หน้าที่ภาษาตรงกับผู้ใช้อยู่แล้ว) · translate="no" บน <html> (มาตรฐาน HTML) ·
// <meta name="google" content="notranslate"> (Google Translate ทุกรูป รวม
// Samsung Internet ที่ใช้เอนจินเดียวกัน). แอปนี้เป็นไทยล้วนสำหรับพนักงานไทย
// ไม่มีเคสที่ต้องการให้แปล — ถ้าวันหนึ่งมีพนักงานต่างชาติ ให้ทำ i18n ในแอปเอง
// ไม่ใช่ปล่อยให้เบราว์เซอร์แก้ DOM ของ React
//
// injection (วัดจริง): เปลี่ยนกลับเป็น lang="en" → แดง 1 · ถอด translate="no" →
// แดง 1 · ลบ <meta notranslate> → แดง 1

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
const htmlTag = html.match(/<html\b[^>]*>/)?.[0] ?? '';

describe('index.html ห้ามให้เบราว์เซอร์แปลหน้า', () => {
  it('<html> ประกาศ lang="th" — เนื้อหาเป็นไทยทั้งแอป', () => {
    expect(htmlTag).toMatch(/\blang="th"/);
  });

  it('<html> มี translate="no"', () => {
    expect(htmlTag).toMatch(/\btranslate="no"/);
  });

  it('มี <meta name="google" content="notranslate">', () => {
    expect(html).toMatch(/<meta\s+name="google"\s+content="notranslate"\s*\/?>/);
  });
});
