// สำมะโนตัวเขียน `jobs/{id}/status` ตรง — ตัวเลขต้องลดลงเท่านั้น
//
// ทำไมเป็นเทส ไม่ใช่รายการใน doc: ตอนเริ่ม P2 ฝั่งเดสก์ท็อปมี 53 จุดใน 17 ไฟล์
// การย้ายทั้งหมดใช้หลาย PR หลายวัน ระหว่างนั้นมีคนอื่นเขียนฟีเจอร์ใหม่ในไฟล์
// เดียวกัน — ถ้าไม่มีอะไรนับ จุดใหม่จะเพิ่มเข้ามาเงียบๆ เร็วกว่าที่เราย้ายออก
// แล้วงานนี้จะไม่จบ (รูปเดียวกับด่าน census ของแอปไรเดอร์ที่ตอนนี้ตรึงไว้ที่ 0)
//
// **แดงเพราะเพิ่มขึ้น = ไปแก้ที่ตัวเขียนใหม่ ให้เรียก runJobTransition**
// **แดงเพราะลดลง = ย้ายสำเร็จ ลดเลขในไฟล์นี้ลงพร้อมกับ PR นั้น**
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * เพดานปัจจุบัน — ลดลงทุกครั้งที่ย้าย writer สำเร็จ ห้ามขึ้น
 *
 * 53 คือตัวเลขตอนเริ่ม (ก่อน P2-g2) · DispatcherPage ย้ายไป 2 จุดใน PR นี้
 */
const MAX_DIRECT_STATUS_WRITERS = 51;

const SRC = resolve(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) return [];
    return [full];
  });
}

/**
 * นับจุดที่เขียน `status` ลง `jobs/{id}` ตรงๆ
 *
 * สองรูป: multi-path (`updates['jobs/${id}/status'] = ...`) กับ object update
 * (`update(ref(db, 'jobs/${id}'), { status: ... })` ซึ่งฟิลด์อยู่ในบล็อกถัดไป)
 */
function countDirectStatusWrites(source: string): number {
  const lines = source.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\[`jobs\/\$\{[^}]+\}\/status`\]/.test(line) || /`jobs\/\$\{[^}]+\}\/status`/.test(line)) {
      count++;
      continue;
    }
    if (/(update|set)\(ref\(db, `jobs\/\$\{[^}]+\}`\)/.test(line)) {
      const blob = lines.slice(i, i + 25).join('\n');
      if (/\bstatus:\s/.test(blob)) count++;
    }
  }
  return count;
}

describe('สำมะโนตัวเขียนสถานะตรง', () => {
  const perFile = walk(SRC)
    .map((file) => [file.slice(SRC.length + 1), countDirectStatusWrites(readFileSync(file, 'utf8'))] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const total = perFile.reduce((sum, [, n]) => sum + n, 0);

  it(`ไม่เกินเพดาน ${MAX_DIRECT_STATUS_WRITERS} จุด`, () => {
    // ข้อความนี้คือสิ่งที่คนแก้จะอ่านตอนแดง — ต้องบอกว่าเหลือที่ไหนบ้าง
    expect(total, `เหลือ:\n${perFile.map(([f, n]) => `  ${n} ${f}`).join('\n')}`)
      .toBeLessThanOrEqual(MAX_DIRECT_STATUS_WRITERS);
  });

  it('เพดานไม่หลวมเกินจริง — ย้ายสำเร็จแล้วต้องลดเลขในไฟล์นี้ด้วย', () => {
    // เพดานที่ตั้งสูงกว่าความจริงมากคือเพดานที่รับ writer ใหม่ได้เงียบๆ
    expect(total).toBeGreaterThan(MAX_DIRECT_STATUS_WRITERS - 3);
  });

  it('DispatcherPage ย้ายแล้ว ห้ามกลับมาเขียนตรง', () => {
    const dispatcher = perFile.find(([f]) => f.endsWith('DispatcherPage.tsx'));
    expect(dispatcher).toBeUndefined();
  });

  it('ยังรู้ว่ากองใหญ่อยู่ที่ไหน', () => {
    // ถ้าสองไฟล์นี้หลุดออกจากลิสต์ไปเองโดยไม่มี PR ที่ย้ายมัน แปลว่า regex
    // นับไม่เจอแล้ว ไม่ใช่ว่างานเสร็จ — ตัวนับที่นับไม่เจออะไรเลยจะเขียวเสมอ
    const names = perFile.map(([f]) => f);
    expect(names.some((f) => f.endsWith('B2CWorkspacePage.tsx'))).toBe(true);
    expect(names.some((f) => f.endsWith('MobileTicketDetail.tsx'))).toBe(true);
  });
});
