// หน้า audit log — เรนเดอร์จริงด้วย renderToStaticMarkup + กฎการจัดรูป
//
// **ข้อที่ตั้งใจไม่มีในไฟล์นี้:** การทดสอบตัว container (`AuditLog` default
// export) ซึ่ง import firebase ตอนโหลดโมดูล จึง SSR ในเทสไม่ได้ — เทสจึงจับ
// `AuditLogView` ที่แยกออกมา ไม่ใช่เขียนเทสว่างไว้ให้ดูเหมือนมีด่าน
//
// ─── ผล injection ─────────────────────────────────────────────────────────
//   (ตัวเลขวัดจริง ไม่ใช่ที่คาดไว้)
//
//   | ทำลายอะไร                                                | ผล |
//   |----------------------------------------------------------|----|
//   | แถว withheld วาดเป็นค่าปกติ (ดูเหมือนไม่มีอะไรเกิดขึ้น)     | แดง 2 |
//   | `0` ถูกอ่านเป็นค่าว่าง (เงินเดือนลดเป็น 0 หายไป)            | แดง 2 |
//   | UI มีตารางป้าย action ของตัวเอง                           | แดง 1 |
//   | ถอด guard `ms == null` (แถวไม่มีเวลาได้ปี 1970)           | แดง 1 |
//   | ซ่อนป้าย "ชนเพดาน" เมื่อกรองแล้วไม่เหลือแถว                | แดง 1 |
//   | คนที่ไม่อยู่ในทะเบียนแล้วขึ้นเป็น "-" แทน id ดิบ            | แดง 1 |
//   | ช่องค้นหาไม่มองป้ายภาษาไทยของฟิลด์                        | แดง 1 |

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuditLogView } from './AuditLog';
import {
  auditDateTime, formatAuditValue, changeLine, subjectText, actorText,
  filterAuditRows, type AuditListResult, type AuditRow,
} from './auditLogView';

const META = {
  base_salary: { label: 'เงินเดือน', kind: 'money' as const, mask: false },
  hired_at: { label: 'วันเริ่มงาน', kind: 'date' as const, mask: false },
  national_id: { label: 'เลขบัตรประชาชน', kind: 'text' as const, mask: true },
  position: { label: 'ตำแหน่ง', kind: 'text' as const, mask: false },
};

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 'r1', entity: 'employee', entity_id: 'e1',
  at: 1788000000000, action: 'updated',
  changes: [{ field: 'base_salary', from: 15000, to: 20000 }],
  reason: 'ผ่านทดลองงาน',
  actor_uid: 'u1', actor_name: 'Panuwat', actor_role: 'CEO',
  ...over,
});

const data = (over: Partial<AuditListResult> = {}): AuditListResult => ({
  entity: 'employee',
  rows: [row()],
  capped: false,
  names: { e1: { name: 'สมชาย ใจดี', employee_code: 'EMP-2569-0001' } },
  field_meta: META,
  action_labels: { created: 'สร้างแฟ้ม', updated: 'แก้ไขข้อมูล', account_revoked: 'ปิดบัญชีเข้าระบบ' },
  max_rows: 400,
  entities_scanned: 3,
  ...over,
});

const html = (d: AuditListResult | null, loading = false, action = '', q = '') =>
  renderToStaticMarkup(<AuditLogView data={d} loading={loading} action={action} q={q} />);

describe('แถว audit บนหน้าจอ', () => {
  it('แสดงค่าเก่าและค่าใหม่ทั้งคู่', () => {
    const out = html(data());
    // นี่คือคำถามเดียวที่หน้านี้มีไว้ตอบ ถ้าหายไปคือกลับไปเป็นบั๊กเดิม
    expect(out).toContain('15,000');
    expect(out).toContain('20,000');
  });

  it('แสดงคนกด เวลา และเหตุผล', () => {
    const out = html(data());
    expect(out).toContain('Panuwat');
    expect(out).toContain('ผ่านทดลองงาน');
    expect(out).toContain('สมชาย');
  });

  it('ฟิลด์ที่ระบบไม่เก็บค่า ต้องบอกตรงๆ ไม่ใช่แสดงเป็นค่าว่าง', () => {
    // แถว withheld คือ "เปลี่ยน แต่ตั้งใจไม่เก็บว่าเปลี่ยนเป็นอะไร" ถ้าวาดเป็น
    // "ว่าง -> ว่าง" คนอ่านจะสรุปว่าไม่มีอะไรเกิดขึ้น ซึ่งตรงข้ามกับความจริง
    const out = html(data({
      rows: [row({ changes: [{ field: 'secret_field', from: null, to: null, withheld: true }] })],
    }));
    expect(out).toContain('ระบบไม่ได้เก็บค่าไว้');
    expect(out).not.toContain('ว่าง</span>');
  });

  it('ฟิลด์ที่ mask บอกว่าเก็บเฉพาะ 4 ตัวท้าย', () => {
    const out = html(data({
      rows: [row({ changes: [{ field: 'national_id', from: '****1234', to: '****5678' }] })],
    }));
    expect(out).toContain('4 ตัวท้าย');
  });

  it('ชนเพดานต้องขึ้นบนหน้า ไม่ตัดเงียบ', () => {
    expect(html(data({ capped: true }))).toContain('สูงสุด');
    expect(html(data({ capped: false }))).not.toContain('สูงสุด');
  });

  it('ป้าย action มาจากข้อมูลที่ server ส่งมา ไม่ใช่ตารางฝั่ง UI', () => {
    // ถ้าวันหนึ่ง UI มีตารางของตัวเอง ป้ายปลอมข้างล่างจะถูกกลบแล้วเทสนี้แดง
    const out = html(data({
      action_labels: { updated: 'ป้ายที่ server กำหนด' },
    }));
    expect(out).toContain('ป้ายที่ server กำหนด');
  });

  it('action ที่ไม่มีป้ายขึ้นชื่อดิบ ไม่ใช่ช่องว่าง', () => {
    const out = html(data({ rows: [row({ action: 'brand_new_action' })], action_labels: {} }));
    expect(out).toContain('brand_new_action');
  });
});

describe('auditDateTime', () => {
  it('มีทั้งวันและเวลา', () => {
    // วันอย่างเดียวตอบไม่ได้ว่าการแก้สองครั้งในวันเดียว อันไหนก่อน
    const s = auditDateTime(1788000000000);
    expect(s).toMatch(/\d{2}:\d{2}/);
  });

  it('ค่าว่างไม่กลายเป็นปี 1970', () => {
    // `Number(null) === 0` และ 0 เป็น finite — กับดักที่กัดโปรเจกต์นี้มาสามรอบ
    expect(auditDateTime(null)).toBe('-');
    expect(auditDateTime(undefined)).toBe('-');
    expect(auditDateTime(0)).toBe('-');
    expect(auditDateTime(NaN)).toBe('-');
  });
});

describe('formatAuditValue', () => {
  it('เงินมีตัวคั่นหลักพันและหน่วย', () => {
    expect(formatAuditValue(20000, 'money')).toBe('20,000 บาท');
  });

  it('วันที่ไม่ขึ้นเป็น ms', () => {
    const s = formatAuditValue(1788000000000, 'date');
    expect(s).not.toContain('1,788');
    expect(s).toMatch(/\d{2}:\d{2}/);
  });

  it('ค่าว่างอ่านออกว่าว่าง ไม่ใช่ช่องเปล่า', () => {
    expect(formatAuditValue(null, 'text')).toBe('ว่าง');
    expect(formatAuditValue('', 'text')).toBe('ว่าง');
  });

  it('เลข 0 ของฟิลด์เงินไม่ถูกอ่านเป็นค่าว่าง', () => {
    // เงินเดือนถูกปรับลงเป็น 0 คือเหตุการณ์ที่ audit ต้องเล่าได้ ไม่ใช่กลืนหาย
    expect(formatAuditValue(0, 'money')).toBe('0 บาท');
  });

  it('บูลีนอ่านเป็นภาษาคน', () => {
    expect(formatAuditValue(true, 'text')).toBe('ใช่');
    expect(formatAuditValue(false, 'text')).toBe('ไม่ใช่');
  });
});

describe('changeLine', () => {
  it('ใช้ป้ายจาก meta', () => {
    expect(changeLine({ field: 'base_salary', from: 1, to: 2 }, META).label).toBe('เงินเดือน');
  });

  it('ฟิลด์ที่ไม่มี meta ขึ้นชื่อดิบ ไม่ใช่ค่าว่าง', () => {
    expect(changeLine({ field: 'unknown_field', from: 1, to: 2 }, META).label).toBe('unknown_field');
  });

  it('withheld ไม่พยายามจัดรูปค่า', () => {
    const l = changeLine({ field: 'x', from: null, to: null, withheld: true }, META);
    expect(l.withheld).toBe(true);
    expect(l.from).toBe('');
    expect(l.to).toBe('');
  });
});

describe('subjectText / actorText', () => {
  const names = { e1: { name: 'สมชาย ใจดี', employee_code: 'EMP-1' } };

  it('มีชื่อและรหัสพนักงาน', () => {
    expect(subjectText(row(), names)).toBe('สมชาย ใจดี · EMP-1');
  });

  it('คนที่ไม่อยู่ในทะเบียนแล้วขึ้น id ดิบ ไม่ใช่หายไปเฉยๆ', () => {
    // แถว audit ของคนที่ถูกลบออกจากทะเบียนคือแถวที่ต้องเห็นมากที่สุด
    expect(subjectText(row({ entity_id: 'ghost' }), names)).toContain('ghost');
  });

  it('ไม่มีชื่อคนกด ยังตามตัวได้ด้วย uid', () => {
    expect(actorText(row({ actor_name: null, actor_role: null }))).toBe('uid u1');
  });
});

describe('filterAuditRows', () => {
  const rows = [
    row({ id: 'a', action: 'created', entity_id: 'e1' }),
    row({ id: 'b', action: 'updated', entity_id: 'e2', actor_name: 'Somsri', reason: null }),
  ];
  const names = { e1: { name: 'สมชาย', employee_code: 'EMP-1' }, e2: { name: 'มานี', employee_code: 'EMP-2' } };

  it('กรองตาม action', () => {
    expect(filterAuditRows(rows, { action: 'created' }, names, META).map((r) => r.id)).toEqual(['a']);
  });

  it('ค้นด้วยชื่อคนที่ถูกแก้', () => {
    expect(filterAuditRows(rows, { q: 'มานี' }, names, META).map((r) => r.id)).toEqual(['b']);
  });

  it('ค้นด้วยชื่อคนกด', () => {
    expect(filterAuditRows(rows, { q: 'somsri' }, names, META).map((r) => r.id)).toEqual(['b']);
  });

  it('ค้นด้วยป้ายภาษาไทยของฟิลด์ ไม่ใช่แค่ชื่อฟิลด์ดิบ', () => {
    // คนกรอกช่องค้นหาพิมพ์ "เงินเดือน" ไม่ได้พิมพ์ "base_salary"
    expect(filterAuditRows(rows, { q: 'เงินเดือน' }, names, META).length).toBe(2);
  });

  it('ไม่มีเงื่อนไข = ได้ทุกแถว', () => {
    expect(filterAuditRows(rows, {}, names, META).length).toBe(2);
  });
});

describe('สถานะขอบ', () => {
  it('กำลังโหลดไม่พัง', () => {
    expect(html(null, true)).toContain('กำลังโหลด');
  });

  it('ไม่มีข้อมูลไม่พัง', () => {
    expect(html(null)).toContain('ยังไม่มีข้อมูล');
  });

  it('กรองแล้วไม่เหลือแถว ก็ยังบอกว่าเพดานชนอยู่', () => {
    // ธง capped พูดถึงจำนวนแถวที่ "อ่านมา" ไม่ใช่จำนวนแถวที่เหลือหลังกรอง
    const out = html(data({ capped: true }), false, '', 'ไม่มีทางตรงกับอะไร');
    expect(out).toContain('สูงสุด');
    expect(out).toContain('ไม่พบรายการ');
  });
});
