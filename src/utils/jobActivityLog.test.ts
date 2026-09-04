import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withNewLogEntry, appendJobActivityLog } from './jobActivityLog';

const entry = { action: 'a', details: 'd', by: 'Admin', timestamp: 1 };

describe('withNewLogEntry', () => {
  it('แถวใหม่อยู่หัวลิสต์ — ไทม์ไลน์ของหน้า B2B อ่านจากบนลงล่าง', () => {
    const out = withNewLogEntry([{ action: 'เก่า' }], entry);
    expect(out[0]).toEqual(entry);
    expect(out).toHaveLength(2);
  });

  it('งานที่ยังไม่มี qc_logs ไม่ทำให้พัง', () => {
    expect(withNewLogEntry(undefined, entry)).toEqual([entry]);
    expect(withNewLogEntry(null, entry)).toEqual([entry]);
  });

  it('qc_logs ที่ไม่ใช่ array (ข้อมูลเพี้ยน) ถูกทิ้ง ไม่ใช่ทำให้ครashed', () => {
    // RTDB คืน object แทน array ได้เมื่อ key ไม่ต่อเนื่อง — ของจริงเจอมาแล้ว
    expect(withNewLogEntry({ 0: { action: 'x' } }, entry)).toEqual([entry]);
  });
});

describe('appendJobActivityLog', () => {
  it('ปฏิเสธ patch ที่มี status — สถานะเป็นของ engine เท่านั้น', async () => {
    // ด่านนี้คือสิ่งที่กันไม่ให้ helper นี้กลายเป็นทางลัดเขียนสถานะทางที่สอง
    // ซึ่งเป็นรูปเดิมที่งานทั้งชุดนี้กำจัด (`onUpdateStatus(id, status, ...)`)
    await expect(
      appendJobActivityLog({ id: 'J1' }, 'a', 'd', 'Admin', { status: 'Paid' })
    ).rejects.toThrow(/status/);
  });
});

describe('สาย B2B ไม่เหลือตัวเขียนสถานะตรง', () => {
  // ด่านโครงสร้าง: เขียน `status:` ตรงในสามไฟล์นี้อีกเมื่อไหร่แดง
  //
  // ยกเว้นเดียวที่ประกาศไว้ชัดคือ multi-path ของ `unpack_to_stock` ใน
  // B2BManager ซึ่งสร้าง **งานลูก** พร้อมสถานะตั้งต้นในคำสั่งเดียวกับงานแม่ —
  // ล็อตที่ปิดแล้วแต่เครื่องไม่โผล่ที่ไหนเลย แย่กว่าไม่ทำทั้งคู่ การแยกให้
  // งานแม่ผ่าน engine จึงต้องรอให้การสร้างงานลูกย้ายไปฝั่ง server ก่อน
  const files = [
    'src/pages/admin/B2BDispatchQueue.tsx',
    'src/features/trade-in/components/b2b/B2BAuditorTool.tsx',
  ];

  // สองกับดักที่ regex ตัวแรกของเทสนี้ตกไปทั้งคู่ และเป็นเหตุผลที่ต้องเขียน
  // ให้แม่นแทนที่จะผ่อน assert:
  //   1. `finance_status: 'Waiting for Transfer'` — `status:` เป็นหางของชื่อ
  //      ฟิลด์อื่น ต้องมี boundary ข้างหน้า
  //   2. คอมเมนต์ที่ *พูดถึง* `status: 'Cancelled'` เพื่ออธิบายของเดิม —
  //      ต้องตัดบรรทัดคอมเมนต์ทิ้งก่อนสแกน
  // เทสที่ผ่อน assert ให้ผ่านสองอันนี้ จะเลิกจับตัวเขียนจริงไปพร้อมกัน
  function statusLiterals(rel: string): string[] {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    const code = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    return [...code.matchAll(/(?:^|[^A-Za-z0-9_])status:\s*'([^']+)'/g)].map((m) => m[1]);
  }

  for (const rel of files) {
    it(`${rel} ไม่มีตัวเขียนสถานะตรงเหลือ`, () => {
      // `status: 'New B2B Lead'` ของ handleCreateB2BJob เป็น **การสร้างงาน**
      // ไม่ใช่ transition — งานที่ยังไม่มีอยู่ไม่มีสถานะเดิมให้ engine ตรวจ
      expect(statusLiterals(rel).filter((v) => v !== 'New B2B Lead')).toEqual([]);
    });
  }

  it('B2BManager เหลือการเขียนสถานะแค่ในบล็อกสร้างงานลูก', () => {
    const rel = 'src/features/trade-in/components/b2b/B2BManager.tsx';
    // งานลูกเริ่มที่ Pending QC — ค่าเดียวที่เหลือในรูป `status: '...'`
    expect(statusLiterals(rel)).toEqual(['Pending QC']);

    // งานแม่ปิดเป็น Completed ผ่าน multi-path (`jobs/${id}/status`) ซึ่งเป็น
    // คนละรูปและ regex ข้างบนมองไม่เห็น — ปักไว้แยกเพื่อไม่ให้ "เทสเขียว"
    // แปลว่า "ไม่มีการเขียนสถานะแล้ว" ทั้งที่ยังมี
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    const pathWrites = [...src.matchAll(/\[`jobs\/\$\{[^`]*\/status`\]\s*=\s*'([^']+)'/g)].map(
      (m) => m[1]
    );
    expect(pathWrites).toEqual(['Completed']);
  });

  it('ไม่มีไฟล์ B2B ไหนเรียก onUpdateStatus อีก', () => {
    for (const rel of [
      'src/features/trade-in/components/b2b/B2BManager.tsx',
      'src/pages/admin/B2CWorkspacePage.tsx',
    ]) {
      const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
      const calls = [...src.matchAll(/onUpdateStatus\(/g)];
      expect(calls, `${rel} ยังเรียก onUpdateStatus`).toEqual([]);
    }
  });
});
