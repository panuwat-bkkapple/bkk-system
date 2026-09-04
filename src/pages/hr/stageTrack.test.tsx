// แถบความคืบหน้าของใบสมัคร — เทสเชิงพฤติกรรม (SSR จริง ไม่ใช่หาข้อความในซอร์ส)
//
// **ข้อที่สำคัญที่สุด: ไม่มี `track` ต้องถอยไปเป็นแถวปุ่มเดิม ห้ามหายไปเฉยๆ**
// hosting กับ functions เป็นคนละ job และ hosting ขึ้นก่อนเสมอ — วัดจริงตอน
// deploy #682 (4 ก.ย. 2569): hosting เสร็จ 02:46:43 ส่วน functions ยังไม่จบ
// อีกสิบกว่านาที ระหว่างนั้นหน้าใหม่คุยกับ callable ตัวเก่าที่ไม่ส่ง `track`
// มาด้วย ผลคือ **แอดมินไม่มีปุ่มเปลี่ยนสถานะเลย** เพราะโค้ดคืน null
//
// ผล injection — 4 ก.ย. 2569
//
//   #   ทำลายอะไร                                        ผล
//   1   ไม่มี track แล้วคืน null (ของเดิม)                 แดง 3
//   2   fallback วาดปุ่มจากลิสต์ที่เขียนเอง ไม่ใช่ row.next  แดง 2
//   3   ขั้นที่ next ไม่อนุญาตกดได้                        แดง
//   4   ใบนอกสายระบายแถบเต็ม                              แดง 2
//   5   ขั้นปัจจุบันนับว่าทำเสร็จแล้ว (`>=`)                แดง
//   6   ทางออกด้านข้างหายไปจากแถบ                          แดง
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StageTrack, type TrackStep, type StageMeta } from './StageTrack';

const TRACK: TrackStep[] = [
  { key: 'new', step: 1, short: 'ใหม่', label: 'ใหม่' },
  { key: 'reviewing', step: 2, short: 'ตรวจสอบ', label: 'กำลังตรวจสอบ' },
  { key: 'interview', step: 3, short: 'สัมภาษณ์', label: 'นัดสัมภาษณ์' },
  { key: 'offer', step: 4, short: 'ข้อเสนอ', label: 'ยื่นข้อเสนอแล้ว' },
  { key: 'accepted', step: 5, short: 'ตอบรับ', label: 'ตอบรับแล้ว รอเริ่มงาน' },
  { key: 'hired', step: 6, short: 'จ้างแล้ว', label: 'จ้างแล้ว' },
];
const LABELS: Record<string, string> = {
  ...Object.fromEntries(TRACK.map((t) => [t.key, t.label])),
  rejected: 'ไม่ผ่าน', declined: 'ผู้สมัครปฏิเสธ',
};
const meta = (s: string): StageMeta => ({ label: LABELS[s] || s, tone: 'gray' });

const render = (track: TrackStep[], next: string[], step: number) =>
  renderToStaticMarkup(
    <StageTrack row={{ next, track_step: step }} track={track} meta={meta} busy={false} onMove={() => {}} />,
  );

/**
 * จำนวนปุ่มที่กดได้จริง
 *
 * เทียบกับ `disabled=""` ซึ่งเป็นรูปที่ React เรนเดอร์ออกมา **ไม่ใช่คำว่า
 * `disabled` ลอยๆ** — รอบแรกเขียน `\bdisabled\b` แล้วมันไปแมตช์คลาส
 * `disabled:opacity-50` ของ Tailwind ที่ติดอยู่ทุกปุ่ม ตัวนับจึงคืน 0 เสมอ
 * และเทส "กำลังทำงานอยู่ = กดอะไรไม่ได้เลย" ก็ผ่านด้วยเหตุผลที่ผิด
 */
const enabledButtons = (html: string) =>
  (html.match(/<button[^>]*>/g) || []).filter((t) => !t.includes('disabled=""')).length;

describe('ไม่มีลำดับขั้นจาก server (callable ตัวเก่ายังไม่ deploy)', () => {
  const next = ['interview', 'offer', 'rejected', 'new'];
  const html = render([], next, 2);

  it('ยังมีปุ่มให้กดครบทุกขั้นที่ไปได้', () => {
    expect(enabledButtons(html)).toBe(next.length);
  });

  it('ปุ่มมาจาก row.next ไม่ใช่ลิสต์ที่หน้าเว็บเขียนเอง', () => {
    for (const k of next) expect(html).toContain(LABELS[k]);
    // ขั้นที่เครื่องสถานะไม่อนุญาตต้องไม่โผล่
    expect(html).not.toContain('ตอบรับแล้ว รอเริ่มงาน');
    expect(html).not.toContain('จ้างแล้ว');
  });

  it('ไม่หายไปเฉยๆ', () => {
    expect(html.length).toBeGreaterThan(50);
  });

  it('ไม่มีทั้ง track และ next = ไม่มีอะไรให้กด แต่ก็ไม่พัง', () => {
    expect(() => render([], [], 0)).not.toThrow();
  });
});

describe('มีลำดับขั้นครบ', () => {
  it('กดได้เฉพาะขั้นที่ next อนุญาต', () => {
    // next 4 ตัว แต่ `rejected` ไม่อยู่บนแถบ → ปุ่มบนแถบ 3 + ปุ่มด้านข้าง 1
    const html = render(TRACK, ['interview', 'offer', 'rejected', 'new'], 2);
    expect(enabledButtons(html)).toBe(4);
  });

  it('ขั้นที่ยืนอยู่ยังไม่ใช่ขั้นที่ทำเสร็จ', () => {
    // ที่ขั้น 2: ขั้น 1 เสร็จแล้ว (ไม่มีเลข) ส่วนขั้น 2 ต้องยังโชว์เลข 2
    const html = render(TRACK, [], 2);
    expect(html).toContain('>2</span>');
    expect(html).not.toContain('>1</span>');
  });

  it('ใบนอกสายไม่ระบายแถบ — ทุกขั้นยังเป็นเลข', () => {
    const html = render(TRACK, [], 0);
    for (const st of TRACK) expect(html).toContain(`>${st.step}</span>`);
    expect(html).not.toContain('bg-emerald-500 border-emerald-500');
  });

  it('ใบที่เดินไปสุดสายระบายครบและไม่เหลือเลข', () => {
    const html = render(TRACK, [], 6);
    for (const st of TRACK.slice(0, 5)) expect(html).not.toContain(`>${st.step}</span>`);
  });

  it('ทางออกด้านข้างอยู่บนหน้าจอ แม้ไม่มีตำแหน่งบนแถบ', () => {
    const html = render(TRACK, ['accepted', 'declined', 'rejected'], 4);
    expect(html).toContain('ผู้สมัครปฏิเสธ');
    expect(html).toContain('ไม่ผ่าน');
  });

  it('กำลังทำงานอยู่ = กดอะไรไม่ได้เลย', () => {
    const html = renderToStaticMarkup(
      <StageTrack row={{ next: ['interview', 'rejected'], track_step: 2 }}
        track={TRACK} meta={meta} busy onMove={() => {}} />,
    );
    expect(enabledButtons(html)).toBe(0);
  });
});
