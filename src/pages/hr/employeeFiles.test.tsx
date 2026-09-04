// เทสแฟ้มเอกสารพนักงาน — กฎล้วน + เรนเดอร์จริงด้วย renderToStaticMarkup
//
// เรนเดอร์ได้เพราะ `EmployeeFiles.tsx` ไม่ import firebase (รูปเดียวกับ
// `StageTrack` และ `EmployeeHistory`)
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   | ทำลายอะไร                                              | ผล |
//   |--------------------------------------------------------|----|
//   | `checklistSummary` คืน complete:true เมื่อ checklist ว่าง | แดง 2 |
//   | `groupFiles` กรองไฟล์ที่ชนิดไม่รู้จักทิ้ง                  | แดง 2 |
//   | แถบสรุปใช้ข้อความ "ครบแล้ว" ตอน unknown                  | แดง 1 |
//   | ถอดป้าย "ต้องมี" ออกจากกลุ่มที่บังคับ                      | แดง 1 |
//   | `formatBytes` คืน "0 B" แทน "—" เมื่อไม่มีขนาด            | แดง 1 |
//   | ถอด `disabled` ออกจากปุ่มดาวน์โหลด                        | แดง 1 |
//   | เรนเดอร์รายการทั้งที่ยัง loading                            | แดง 1 |
//   | ปล่อยให้กลุ่มชนิดที่ไม่รู้จักมีปุ่ม "แนบไฟล์"                  | แดง 1 |

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checklistSummary, formatBytes, groupFiles } from './employeeFiles';
import type { ChecklistRow, FileRow } from './employeeFiles';
import { EmployeeFilesPanel, FilesSummary } from './EmployeeFiles';

const row = (over: Partial<ChecklistRow>): ChecklistRow => ({
  kind: 'id_card', label: 'สำเนาบัตรประชาชน', note: null,
  required: true, count: 0, missing: true, ...over,
});
const file = (over: Partial<FileRow>): FileRow => ({
  id: 'f1', kind: 'id_card', filename: 'a.pdf', size: 2048,
  uploaded_at: 1_756_000_000_000, uploaded_by_name: 'สมชาย', note: null, ...over,
});

describe('checklistSummary', () => {
  it('checklist ที่ยังไม่มา = unknown ไม่ใช่ครบ', () => {
    for (const input of [null, undefined, []]) {
      const s = checklistSummary(input as ChecklistRow[] | null);
      expect(s.unknown).toBe(true);
      // **นี่คือข้อที่สำคัญที่สุดของไฟล์นี้** — จอที่บอกว่าครบทั้งที่ยังไม่รู้
      // ทำให้ HR เลิกตาม แล้วเอกสารก็ไม่เคยถูกเก็บ
      expect(s.complete).toBe(false);
    }
  });

  it('นับเฉพาะรายการที่บังคับ', () => {
    const s = checklistSummary([
      row({ kind: 'id_card', count: 1, missing: false }),
      row({ kind: 'bank_book', count: 0, missing: true }),
      row({ kind: 'photo', required: false, count: 0, missing: false }),
    ]);
    expect(s.required).toBe(2);
    expect(s.have).toBe(1);
    expect(s.missing).toBe(1);
    expect(s.complete).toBe(false);
    expect(s.unknown).toBe(false);
  });

  it('ครบทุกใบที่บังคับ = complete แม้ยังไม่มีใบที่ไม่บังคับ', () => {
    const s = checklistSummary([
      row({ count: 1, missing: false }),
      row({ kind: 'photo', required: false, count: 0, missing: false }),
    ]);
    expect(s.complete).toBe(true);
    expect(s.missing).toBe(0);
  });
});

describe('formatBytes', () => {
  it('ไม่มีขนาด = ขีด ไม่ใช่ 0 B (ซึ่งอ่านเหมือนไฟล์เสีย)', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes('อะไรสักอย่าง')).toBe('—');
  });
  it('แปลงหน่วยตามขนาด', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('groupFiles', () => {
  it('จัดไฟล์เข้าใต้ชนิดตามลำดับของ checklist', () => {
    const groups = groupFiles(
      [row({ kind: 'id_card' }), row({ kind: 'bank_book', label: 'หน้าสมุดบัญชีธนาคาร' })],
      [file({ id: 'a', kind: 'bank_book' }), file({ id: 'b', kind: 'id_card' })],
    );
    expect(groups.map((g) => g.kind)).toEqual(['id_card', 'bank_book']);
    expect(groups[0].files.map((f) => f.id)).toEqual(['b']);
    expect(groups[1].files.map((f) => f.id)).toEqual(['a']);
  });

  it('ไฟล์ที่ชนิดไม่อยู่ใน checklist ต้องยังขึ้น พร้อมบอกว่าไม่รู้จัก', () => {
    const groups = groupFiles([row({ kind: 'id_card' })], [file({ id: 'x', kind: 'work_permit' })]);
    const orphan = groups.find((g) => g.kind === 'work_permit');
    expect(orphan).toBeTruthy();
    expect(orphan?.unknownKind).toBe(true);
    expect(orphan?.files.map((f) => f.id)).toEqual(['x']);
    // ไม่บังคับ — ระบบไม่รู้จักมัน จะบอกว่ามันจำเป็นไม่ได้
    expect(orphan?.required).toBe(false);
  });

  it('checklist ยังไม่มา แต่มีไฟล์อยู่ = ไฟล์ต้องไม่หายไปจากจอ', () => {
    const groups = groupFiles(null, [file({ id: 'z' })]);
    expect(groups.flatMap((g) => g.files).map((f) => f.id)).toEqual(['z']);
  });
});

describe('การเรนเดอร์', () => {
  const noop = () => {};

  it('แถบสรุปบอกจำนวนที่ขาด', () => {
    const html = renderToStaticMarkup(
      <FilesSummary checklist={[row({ missing: true }), row({ kind: 'bank_book', count: 1, missing: false })]} />,
    );
    expect(html).toContain('ยังขาด 1');
    expect(html).not.toContain('ครบแล้ว');
  });

  it('checklist ที่ยังอ่านไม่ได้ ต้องไม่ขึ้นว่าครบ', () => {
    const html = renderToStaticMarkup(<FilesSummary checklist={null} />);
    expect(html).toContain('ยังอ่านรายการเอกสารที่ต้องมีไม่ได้');
    expect(html).not.toContain('ครบแล้ว');
    expect(html).not.toContain('ยังขาด');
  });

  it('ครบแล้วขึ้นเขียว', () => {
    const html = renderToStaticMarkup(
      <FilesSummary checklist={[row({ count: 1, missing: false })]} />,
    );
    expect(html).toContain('ครบแล้ว');
  });

  it('กลุ่มที่บังคับและยังไม่มีไฟล์ ต้องติดป้าย "ต้องมี" และบอกว่ายังไม่มีไฟล์', () => {
    const html = renderToStaticMarkup(
      <EmployeeFilesPanel checklist={[row({})]} files={[]}
        onPick={noop} onDownload={noop} onDelete={noop} />,
    );
    expect(html).toContain('สำเนาบัตรประชาชน');
    expect(html).toContain('ต้องมี');
    expect(html).toContain('ยังไม่มีไฟล์');
  });

  it('กลุ่มที่ไม่บังคับไม่ติดป้าย "ต้องมี"', () => {
    const html = renderToStaticMarkup(
      <EmployeeFilesPanel checklist={[row({ kind: 'photo', label: 'รูปถ่าย', required: false, missing: false })]}
        files={[]} onPick={noop} onDownload={noop} onDelete={noop} />,
    );
    expect(html).toContain('ไม่บังคับ');
    expect(html).not.toContain('>ต้องมี<');
  });

  it('แถวไฟล์โชว์ชื่อ ขนาด และคนอัปโหลด', () => {
    const html = renderToStaticMarkup(
      <EmployeeFilesPanel checklist={[row({ count: 1, missing: false })]} files={[file({})]}
        onPick={noop} onDownload={noop} onDelete={noop} />,
    );
    expect(html).toContain('a.pdf');
    expect(html).toContain('2 KB');
    expect(html).toContain('สมชาย');
  });

  it('ระหว่างทำงานอยู่ ปุ่มทุกใบต้องกดไม่ได้', () => {
    const html = renderToStaticMarkup(
      <EmployeeFilesPanel checklist={[row({ count: 1, missing: false })]} files={[file({})]}
        busy onPick={noop} onDownload={noop} onDelete={noop} />,
    );
    // `disabled=""` คือรูปที่ React เรนเดอร์จริง — เทียบ `\bdisabled\b` เฉยๆ จะไป
    // ชนคลาส `disabled:opacity-50` ของ Tailwind แล้วผ่านโดยไม่พิสูจน์อะไรเลย
    // (เคยพลาดมาแล้วตอนทำ StageTrack)
    const buttons = html.match(/<button[^>]*>/g) || [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.includes('disabled=""'))).toBe(true);
  });

  it('ชนิดที่ระบบไม่รู้จัก: ดู/ลบไฟล์เดิมได้ แต่แนบใหม่ไม่ได้', () => {
    // แนบเข้าชนิดที่ระบบไม่รู้จักไม่ได้ เพราะ server จะปฏิเสธ `kind` นั้นอยู่แล้ว
    // (allowlist ใน validateUpload) — ปุ่มที่กดแล้วขึ้น error เสมอคือปุ่มที่ไม่ควรมี
    // ส่วนไฟล์ที่มีอยู่ต้องยังเปิดและลบได้ ไม่งั้นมันค้างอยู่โดยไม่มีทางจัดการ
    const html = renderToStaticMarkup(
      <EmployeeFilesPanel
        checklist={[row({ count: 1, missing: false })]}
        files={[file({}), file({ id: 'w', kind: 'work_permit', filename: 'permit.pdf' })]}
        onPick={noop} onDownload={noop} onDelete={noop} />,
    );
    expect(html).toContain('work_permit');
    expect(html).toContain('permit.pdf');
    // มีปุ่มแนบไฟล์ใบเดียว = ของกลุ่มที่รู้จักเท่านั้น
    expect((html.match(/แนบไฟล์/g) || []).length).toBe(1);
    expect(html.slice(html.indexOf('work_permit'))).not.toContain('แนบไฟล์');
  });

  it('ยังโหลดอยู่ = ไม่เรนเดอร์รายการ (จะได้ไม่กระพริบว่า "ยังไม่มีไฟล์")', () => {
    const html = renderToStaticMarkup(
      <EmployeeFilesPanel checklist={null} files={null} loading
        onPick={noop} onDownload={noop} onDelete={noop} />,
    );
    expect(html).toContain('กำลังโหลด');
    expect(html).not.toContain('ยังไม่มีไฟล์');
  });
});
