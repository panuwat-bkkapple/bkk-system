import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { B2B_ACTION_EVENT, buildCancelPatch, type B2BActionType } from './b2bActions';
import { JOB_EVENT } from '@/utils/jobTransitions';

const require = createRequire(import.meta.url);
const engine = require(resolve(__dirname, '../../../../../functions/status-engine.js'));

describe('B2B_ACTION_EVENT', () => {
  // ตารางนี้มีอยู่เพราะ injection จับไม่ได้ตอนมันยังเป็น switch — สลับ event
  // ของปุ่มสองใบให้ผิดตัวแล้วเทสเขียวหมด ทั้งที่พางานไปคนละสถานะ
  const expected: Record<B2BActionType, string> = {
    send_pre_quote: 'Pre-Quote Sent',
    accept_pre_quote: 'Pre-Quote Accepted',
    dispatch_inspector: 'Site Visit & Grading',
    send_final_quote: 'Final Quote Sent',
    accept_final_quote: 'Final Quote Accepted',
    enter_negotiation: 'Negotiation',
    issue_po: 'PO Issued',
    wait_invoice: 'Waiting for Invoice/Tax Inv.',
    submit_to_finance: 'Pending Finance Approval',
  };

  it('ทุกปุ่มพางานไปสถานะที่ป้ายบนปุ่มสัญญาไว้', () => {
    for (const [action, event] of Object.entries(B2B_ACTION_EVENT)) {
      expect(engine.TRANSITIONS[event]?.to, action).toBe(expected[action as B2BActionType]);
    }
  });

  it('ทุก action มีปลายทางปักไว้ — เพิ่มปุ่มแล้วลืมปักคือรูเดิม', () => {
    for (const action of Object.keys(B2B_ACTION_EVENT)) {
      expect(expected[action as B2BActionType], action).toBeDefined();
    }
  });

  it('ทุก event ในตารางเป็น event ของสาย B2B จริง ไม่ใช่ของขายปลีก', () => {
    for (const [action, event] of Object.entries(B2B_ACTION_EVENT)) {
      expect(engine.TRANSITIONS[event]?.jobTypes, action).toEqual(engine.B2B_JOB_TYPES);
    }
  });

  // ถ้าใครเอา JOB_EVENT.B2B_* กลับไปฝังในหน้าจอ ตารางจะกลายเป็นของประดับที่
  // เทสข้างบนยังเขียวอยู่ทั้งที่หน้าจอไม่ได้ใช้มัน — สองหน้านี้ทำ action
  // ชุดเดียวกัน (`send_pre_quote` / `dispatch_inspector` มีทั้งคู่) จึงต้อง
  // อ่านจากตารางเดียวกัน ไม่งั้นวันหนึ่งสองหน้าจะพางานไปคนละสถานะ
  const screens: Array<[string, string[]]> = [
    // [ไฟล์, event ที่ยังฝังตรงได้เพราะไม่ได้อยู่ในตาราง]
    [resolve(__dirname, 'B2BManager.tsx'), ['B2B_FOLLOWED_UP']],
    [resolve(__dirname, '../../../../pages/admin/B2BDispatchQueue.tsx'), []],
  ];

  for (const [file, allowed] of screens) {
    it(`${file.split('/').pop()} อ่าน event จากตาราง ไม่ได้ฝังเอง`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('B2B_ACTION_EVENT');
      const inlined = [...src.matchAll(/JOB_EVENT\.(B2B_[A-Z_]+)/g)].map((m) => m[1]);
      expect([...new Set(inlined)].sort()).toEqual([...allowed].sort());
    });
  }
});

describe('buildCancelPatch', () => {
  it('เขียนครบสามฟิลด์ที่ engine บังคับ', () => {
    const patch = buildCancelPatch('u1', 'price_disagreement', 'ลูกค้าปฏิเสธ', 1_700_000_000_000);
    for (const field of engine.TRANSITIONS.cancelled.requires) {
      expect(patch[field], field).toBeTruthy();
    }
  });

  it('งาน B2B ที่ยกเลิกด้วย patch นี้ผ่าน engine จริง', () => {
    const patch = buildCancelPatch('u1', 'other', 'เหตุผล', 1_700_000_000_000);
    const out = engine.decideTransition({
      job: { status: 'PO Issued', type: 'B2B Trade-in', ...patch },
      event: 'cancelled',
      actor: engine.ACTOR.ADMIN_STAFF,
    });
    expect(out.ok, out.code).toBe(true);
    expect(out.to).toBe('Cancelled');
  });

  it('cancelled_by ไม่ขึ้นต้นด้วย rider: — ไม่งั้นถูกนับเป็นไรเดอร์ทิ้งงาน', () => {
    expect(buildCancelPatch('u1', 'other', 'r').cancelled_by).toBe('admin:u1');
    expect(String(buildCancelPatch(null, 'other', 'r').cancelled_by)).not.toMatch(/^rider:/);
  });
});
