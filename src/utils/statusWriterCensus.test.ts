// สำมะโนการเขียน `jobs/{id}` ตรงจากไคลเอนต์ — ตัวเลขต้องลดลงเท่านั้น
//
// **ตัวนับรอบแรก (#657) นับผิด และนี่คือรอบแก้** ของเดิมมองหา `status:` ใน
// หน้าต่าง 25 บรรทัดหลังคำสั่ง update ซึ่งจับ `status` ของ object ที่ถูกเขียน
// เป็น **ค่า** มาด้วย (`customer_offer.status: 'accepted'`, adjustment ที่
// `status: 'pending'`) — B2CWorkspacePage จึงถูกรายงานว่ามี 17 จุดทั้งที่จริง
// มี 11 และเลข 53/51 ที่เขียนไว้ใน PR ก่อนหน้าก็เกินจริงตามกันไป
//
// รอบนี้เปลี่ยนไปนับสิ่งที่ **นับพลาดไม่ได้**: จำนวนคำสั่งเขียนโหนดงานทั้งหมด
// ไม่ว่า payload จะเป็นรูปไหน (object literal, ตัวแปรที่ประกอบไว้ก่อน,
// multi-path). ตัวนับที่พลาดไปข้างน้อยคือตัวนับที่ปล่อยตัวเขียนใหม่เข้ามาได้
// ซึ่งเป็นทิศที่อันตรายกว่าการนับเกิน
//
// สิ่งที่นับได้จึงกว้างกว่า "ตัวเขียนสถานะ" — มีทั้งการเขียน qc_logs เปล่าๆ
// ข้อมูลลูกค้า และคูปอง ซึ่งไม่ใช่ transition และไม่ต้องย้ายทั้งหมด **แต่ในฐานะ
// ราวกันตกมันตอบคำถามที่ถูกกว่า: "มีทางเขียนโหนดงานตรงเพิ่มขึ้นไหม"**
//
// แดงเพราะเพิ่มขึ้น = ไปแก้ที่ตัวเขียนใหม่ ให้เรียก runJobTransition
// แดงเพราะลดลง = ย้ายสำเร็จ ลดเลขข้างล่างพร้อมกับ PR นั้น
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 112 · ลดได้ ขึ้นไม่ได้ (113 ตอนเริ่ม P2-h)
 *
 * P2-i ย้ายผู้เรียก `handleUpdateStatus` ครบทั้ง 10 จุด แล้วลบตัวฟังก์ชันทิ้ง
 * ซึ่งเป็นตอนที่เลขขยับจริง — P2-h ย้ายไป 3 จุดแต่เลขไม่ขยับเพราะตัวเขียนตรง
 * คือฟังก์ชันตัวเดียวนั้น ไม่ใช่ผู้เรียก **ตัวเลขที่นิ่งไม่ใช่สัญญาณว่าไม่มี
 * ความคืบหน้า และไม่ใช่เหตุผลให้ไปลดเพดานเอาเอง**
 */
const MAX_DIRECT_JOB_WRITES = 112;

const SRC = resolve(__dirname, '..');

/** คำสั่งเขียนโหนดงาน: `update|set|remove(ref(db, \`jobs/${...}\`)` */
const CALL_FORM = /(?:update|set|remove)\(ref\(db,\s*`jobs\/\$\{[^`]*`\)/g;
/** multi-path: `updates[\`jobs/${id}/...\`] = ...` */
const PATH_FORM = /\[`jobs\/\$\{[^`]*`\]\s*=/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) return [];
    return [full];
  });
}

function countDirectWrites(source: string): number {
  return (source.match(CALL_FORM) || []).length + (source.match(PATH_FORM) || []).length;
}

describe('สำมะโนการเขียนโหนดงานตรง', () => {
  const perFile = walk(SRC)
    .map((f) => [f.slice(SRC.length + 1), countDirectWrites(readFileSync(f, 'utf8'))] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = perFile.reduce((sum, [, n]) => sum + n, 0);

  it(`ไม่เกินเพดาน ${MAX_DIRECT_JOB_WRITES} จุด`, () => {
    expect(total, `เหลือ:\n${perFile.map(([f, n]) => `  ${n} ${f}`).join('\n')}`)
      .toBeLessThanOrEqual(MAX_DIRECT_JOB_WRITES);
  });

  it('เพดานไม่หลวมเกินจริง — ย้ายสำเร็จแล้วต้องลดเลขในไฟล์นี้ด้วย', () => {
    // เพดานที่ตั้งสูงกว่าความจริงมากคือเพดานที่รับตัวเขียนใหม่ได้เงียบๆ
    expect(total).toBeGreaterThan(MAX_DIRECT_JOB_WRITES - 3);
  });

  it('DispatcherPage ย้ายแล้ว ห้ามกลับมาเขียนตรง', () => {
    expect(perFile.find(([f]) => f.endsWith('DispatcherPage.tsx'))).toBeUndefined();
  });

  it('PricingSidebar ไม่เหลือ handleUpdateStatus เลย และยิง event 10 จุด', () => {
    // ด่านนี้เพิ่มเข้ามาเพราะ injection รอบก่อนเขียว: ย้อนปุ่มกลับไปเป็น
    // handleUpdateStatus แล้วไม่มีเทสไหนรู้สึกอะไรเลย — ด่านที่ไปไม่ถึง
    //
    // นับจำนวนผู้เรียก ไม่ใช่เช็คว่า "มี handleTransition อยู่ไหม" เพราะแบบหลัง
    // เขียวได้ทั้งที่ปุ่มถูกย้อนกลับไปแล้วทุกตัว
    const sidebar = readFileSync(
      resolve(SRC, 'pages/admin/components/PricingSidebar.tsx'), 'utf8',
    );
    expect(sidebar).not.toContain('handleUpdateStatus');
    expect((sidebar.match(/handleTransition\(JOB_EVENT\./g) || []).length).toBe(10);
  });

  it('B2CWorkspacePage ไม่มีตัวเขียนสถานะแบบไคลเอนต์เลือกปลายทางเหลืออยู่', () => {
    // ตัวฟังก์ชันถูกลบ ไม่ใช่แค่ไม่มีคนเรียก — ฟังก์ชันที่ยังอยู่คือฟังก์ชันที่
    // PR หน้าจะหยิบมาใช้เพราะมันสะดวกกว่าการหา event ที่ถูก
    const page = readFileSync(resolve(SRC, 'pages/admin/B2CWorkspacePage.tsx'), 'utf8');
    expect(page).not.toContain('const handleUpdateStatus');
  });

  it('ยังนับเจอกองใหญ่ — ตัวนับที่นับไม่เจออะไรเลยจะเขียวเสมอ', () => {
    const names = perFile.map(([f]) => f);
    expect(names.some((f) => f.endsWith('B2CWorkspacePage.tsx'))).toBe(true);
    expect(names.some((f) => f.endsWith('MobileTicketDetail.tsx'))).toBe(true);
    // นับได้ทั้งสองรูป ไม่ใช่แค่รูปเดียว: TradeInPayouts เป็น multi-path ล้วน
    expect(names.some((f) => f.endsWith('TradeInPayouts.tsx'))).toBe(true);
  });
});
