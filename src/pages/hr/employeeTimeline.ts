// src/pages/hr/employeeTimeline.ts
//
// แปลแถว `employee_events` เป็นบรรทัดที่คนอ่านออก — **ล้วน ไม่มี I/O**
// (เขียนโดย `recordEmployeeEvent` ใน functions/hr.js ทุกครั้งที่จ้าง เลื่อน
// ตำแหน่ง เปลี่ยนเงินเดือน เปลี่ยนสถานะ หรือผูก/ถอนบัญชี)
//
// -----------------------------------------------------------------------------
// **สองข้อที่ไฟล์นี้มีไว้เพื่อไม่ให้ไทม์ไลน์โกหก**
//
// 1. **action ที่ไม่รู้จักต้องยังขึ้นบนไทม์ไลน์ ห้ามถูกกรองทิ้ง** — ไทม์ไลน์คือ
//    คำตอบของคำถาม "เกิดอะไรขึ้นกับคนนี้บ้าง" การซ่อนแถวที่แปลไม่ออกทำให้มัน
//    ตอบผิดโดยไม่มีใครรู้ว่าขาดอะไรไป (บทเรียนเดียวกับสถานะใบสมัครที่ตกเป็น
//    "ส่งใบสมัครแล้ว" — fallback ต้องเป็นประโยคที่ไม่อ้างอะไร ไม่ใช่การเดา)
//
// 2. **`salary_changed` ไม่มีตัวเลขโดยตั้งใจ** — ฝั่ง server เขียน `from`/`to`
//    เป็น null พร้อมคอมเมนต์ว่า "ค่าเก่าเป็นข้อมูลอ่อนไหว เก็บใน
//    employees_private เท่านั้น" ไทม์ไลน์จึงต้องเขียนบอกตรงๆ ว่าไม่ได้บันทึก
//    จำนวนเงินไว้ ไม่ใช่ปล่อยบรรทัดว่างให้ดูเหมือนข้อมูลหาย
// -----------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  action?: string | null;
  at?: number | null;
  reason?: string | null;
  by_name?: string | null;
  by_role?: string | null;
  from?: Record<string, unknown> | null;
  to?: Record<string, unknown> | null;
}

export interface EventView {
  label: string;
  tone: 'emerald' | 'blue' | 'amber' | 'violet' | 'gray';
  /** บรรทัดอธิบายใต้หัวข้อ — ว่างได้ */
  lines: string[];
  /** true = ระบบไม่รู้จัก action นี้ (ยังต้องแสดง) */
  unknown?: boolean;
}

const STATUS_TH: Record<string, string> = {
  active: 'ทำงานอยู่',
  probation: 'ทดลองงาน',
  resigned: 'ลาออก',
  terminated: 'พ้นสภาพ',
};
const statusTh = (v: unknown) => STATUS_TH[String(v || '')] || String(v || '') || '—';

const EVENTS: Record<string, { label: string; tone: EventView['tone'] }> = {
  hired: { label: 'เริ่มงาน', tone: 'emerald' },
  promoted: { label: 'เปลี่ยนตำแหน่ง', tone: 'blue' },
  salary_changed: { label: 'ปรับเงินเดือน', tone: 'violet' },
  probation_passed: { label: 'ผ่านทดลองงาน', tone: 'emerald' },
  resigned: { label: 'ลาออก', tone: 'gray' },
  terminated: { label: 'พ้นสภาพ', tone: 'gray' },
  profile_updated: { label: 'แก้ไขข้อมูล', tone: 'gray' },
  linked: { label: 'ผูกบัญชีเข้าระบบ', tone: 'blue' },
  unlinked: { label: 'ถอนบัญชีออกจากแฟ้ม', tone: 'amber' },
};

/** แปลงหนึ่งแถวเป็นสิ่งที่แสดงบนจอ */
export function describeEvent(ev: TimelineEvent): EventView {
  const action = String(ev.action || '').trim();
  const meta = EVENTS[action];
  const lines: string[] = [];

  if (action === 'promoted') {
    const before = String((ev.from && ev.from.position) || '') || '—';
    const after = String((ev.to && ev.to.position) || '') || '—';
    lines.push(`${before} → ${after}`);
  } else if (action === 'salary_changed') {
    // ห้ามเดาตัวเลข — server ไม่ได้เก็บไว้ตรงนี้โดยตั้งใจ
    lines.push('ระบบไม่ได้บันทึกจำนวนเงินไว้ในประวัติ (ดูค่าปัจจุบันที่ปุ่มแก้ไข)');
  } else if (ev.from || ev.to) {
    const before = ev.from && 'status' in ev.from ? statusTh(ev.from.status) : null;
    const after = ev.to && 'status' in ev.to ? statusTh(ev.to.status) : null;
    // **ต้องมีทั้งสองข้างถึงจะเขียนลูกศร** — `hired` มีแต่ปลายทาง (from เป็น
    // null เพราะก่อนหน้านั้นเขายังไม่ได้อยู่ในทะเบียน) การเขียน "— → ทำงานอยู่"
    // คือบรรทัดที่ไม่ได้บอกอะไรเพิ่มจากป้าย "เริ่มงาน" ที่อยู่ข้างบนแล้ว
    if (before && after) lines.push(`${before} → ${after}`);
  }
  if (ev.reason) lines.push(`เหตุผล: ${ev.reason}`);

  if (!meta) {
    // ไม่รู้จัก = ยังต้องขึ้น และต้องบอกตรงๆ ว่าอ่านไม่ออก ไม่ใช่เดาเป็นอย่างอื่น
    return {
      label: action ? `เหตุการณ์ "${action}"` : 'เหตุการณ์ที่ไม่ระบุชนิด',
      tone: 'gray',
      lines,
      unknown: true,
    };
  }
  return { label: meta.label, tone: meta.tone, lines };
}

/** ผู้ทำรายการ — ไม่มีชื่อคือรายการที่ระบบทำเอง ไม่ใช่ "ไม่รู้ว่าใคร" */
export function actorLabel(ev: TimelineEvent): string {
  const name = String(ev.by_name || '').trim();
  if (!name) return 'ระบบ';
  const role = String(ev.by_role || '').trim();
  return role ? `${name} (${role})` : name;
}

/** เรียงใหม่จากล่าสุดไปเก่าสุด — ไม่เชื่อลำดับที่ได้มา (แถวไม่มีเวลาไปท้าย) */
export function sortEvents(items: TimelineEvent[]): TimelineEvent[] {
  return [...(items || [])].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}
