// ป้ายสถานะประกันสังคมบนแถวพนักงาน — เรนเดอร์จริงด้วย renderToStaticMarkup
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   | ทำลายอะไร                                  | ผล |
//   |--------------------------------------------|----|
//   | `unknown` ไม่ขึ้นป้าย (เงียบเหมือน ok)        | แดง 2 |
//   | `pending` ขึ้นป้าย (ป้ายติดตลอดจนไม่มีใครมอง) | แดง 1 |
//   | `overdue` ใช้สีเดียวกับ `due_soon`            | แดง 1 |
//   | ป้าย overdue ไม่บอกจำนวนวัน                   | แดง 1 |

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SsoBadge } from './SsoBadge';
import type { SsoState } from './SsoBadge';

const html = (sso: SsoState | null | undefined) => renderToStaticMarkup(<SsoBadge sso={sso} />);

describe('SsoBadge', () => {
  it('สถานะที่ไม่ต้องทำอะไรต้องเงียบ', () => {
    // ป้ายที่ติดอยู่ตลอดเวลาคือป้ายที่ไม่มีใครมอง — ขึ้นเฉพาะตอนมีอะไรต้องทำ
    for (const state of ['ok', 'not_required', 'pending'] as const) {
      expect(html({ state })).toBe('');
    }
  });

  it('ไม่มีข้อมูลเลยก็เงียบ (callable เก่ายังไม่ deploy)', () => {
    // hosting ขึ้นก่อน functions เสมอ — แถวที่ยังไม่มีฟิลด์ sso ต้องไม่พัง
    expect(html(null)).toBe('');
    expect(html(undefined)).toBe('');
  });

  it('เลยกำหนดขึ้นป้ายแดงพร้อมจำนวนวัน', () => {
    const out = html({ state: 'overdue', days_left: -12, message: 'เลยกำหนด...' });
    expect(out).toContain('เลยกำหนด 12 วัน');
    expect(out).toContain('rose');
  });

  it('ใกล้ครบกำหนดขึ้นป้ายเหลือง คนละสีกับเลยกำหนด', () => {
    const soon = html({ state: 'due_soon', days_left: 4 });
    expect(soon).toContain('เหลือ 4 วัน');
    expect(soon).toContain('amber');
    expect(soon).not.toContain('rose');
  });

  it('ไม่มีวันเริ่มงาน = ต้องเห็นได้ ไม่ใช่เงียบ', () => {
    // **ข้อสำคัญที่สุดของไฟล์นี้** — คนที่ไม่มีวันเริ่มงานอาจเข้าทำงานมาแล้ว
    // ครึ่งปี การไม่ขึ้นป้ายให้เขาคือการเดาไปทางที่สบายกว่า
    const out = html({ state: 'unknown' });
    expect(out).not.toBe('');
    expect(out).toContain('ยังไม่ขึ้นทะเบียน');
  });

  it('ข้อความเต็มจาก server ไปอยู่ใน title ให้เอาเมาส์ชี้อ่านได้', () => {
    const out = html({ state: 'overdue', days_left: -1, message: 'ต้องยื่นภายใน 30 วัน' });
    expect(out).toContain('title="ต้องยื่นภายใน 30 วัน"');
  });

  it('สถานะที่ระบบไม่รู้จักไม่ทำให้พัง', () => {
    expect(html({ state: 'อะไรสักอย่าง' } as unknown as SsoState)).toBe('');
  });
});
