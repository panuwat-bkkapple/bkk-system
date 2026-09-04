// คำศัพท์และการจัดรูปของหน้า audit log — ล้วน มีเทส
//
// **ไม่มีตารางป้ายอยู่ในไฟล์นี้** — ป้ายของฟิลด์และของ action มาจาก callable
// (`field_meta` / `action_labels` ซึ่ง server สร้างจาก `AUDIT_FIELDS` /
// `AUDIT_ACTIONS` ใน functions/audit-log.js) ตารางป้ายชุดที่สองฝั่ง UI คือของ
// ที่วันหนึ่งจะไม่ตรงกับ allowlist จริง แล้วหน้าเว็บจะเล่าเรื่องที่ระบบไม่ได้
// เก็บ ที่เหลืออยู่ในไฟล์นี้คือ *การจัดรูป* ซึ่งเป็นเรื่องของหน้าจอล้วนๆ

export interface AuditChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
  withheld?: boolean;
}

export interface AuditRow {
  id: string;
  entity: string;
  entity_id: string;
  at: number;
  action: string;
  changes?: AuditChange[];
  reason?: string | null;
  actor_uid?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
}

export interface FieldMeta {
  label: string;
  kind: 'text' | 'money' | 'date';
  mask: boolean;
}

export interface AuditSubject {
  name: string | null;
  employee_code: string | null;
}

export interface AuditListResult {
  entity: string;
  rows: AuditRow[];
  capped: boolean;
  names: Record<string, AuditSubject>;
  field_meta: Record<string, FieldMeta>;
  action_labels: Record<string, string>;
  max_rows: number;
  entities_scanned: number;
}

/**
 * วันที่ **พร้อมเวลา** — audit log ที่บอกแค่วันตอบคำถาม "ก่อนหรือหลัง" ไม่ได้
 * ซึ่งเป็นคำถามหลักเวลามีการแก้สองครั้งในวันเดียว
 *
 * `Number(null) === 0` และ 0 เป็น finite — เช็ค `Number.isFinite` อย่างเดียว
 * จะได้เวลาปี 1970 ให้กับแถวที่ไม่มี `at` (เคยกัดมาแล้วสามรอบในโปรเจกต์นี้)
 */
export function auditDateTime(ms: number | null | undefined): string {
  if (ms == null) return '-';
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return new Date(n).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** ค่าที่ไม่เคยมี ต้องอ่านออกว่า "ว่าง" ไม่ใช่ช่องเปล่าที่ดูเหมือนหน้าจอพัง */
export const EMPTY_VALUE = 'ว่าง';

/**
 * จัดรูปค่าตามชนิดที่ server บอกมา
 *
 * `date` สำคัญที่สุด — วันเริ่มงานเก็บเป็น ms ถ้าไม่แปลงจะขึ้นบนหน้าเป็น
 * "1,753,920,000,000" ซึ่งไม่มีใครเทียบกับอะไรได้
 */
export function formatAuditValue(
  v: AuditChange['from'],
  kind: FieldMeta['kind'] | undefined,
): string {
  if (v === null || v === undefined || v === '') return EMPTY_VALUE;
  if (typeof v === 'boolean') return v ? 'ใช่' : 'ไม่ใช่';
  if (kind === 'date') return auditDateTime(typeof v === 'number' ? v : Number(v));
  if (kind === 'money') {
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toLocaleString('th-TH')} บาท` : String(v);
  }
  return String(v);
}

export interface ChangeLine {
  label: string;
  from: string;
  to: string;
  withheld: boolean;
  masked: boolean;
}

/**
 * แถวการเปลี่ยนแปลงหนึ่งบรรทัด
 *
 * **แยก "ไม่เก็บค่าไว้" ออกจาก "ค่าว่าง" เสมอ** — ฟิลด์นอก allowlist ถูกบันทึก
 * ว่าเปลี่ยนโดยไม่เก็บค่า (fail-safe ของ audit-log.js) ถ้าหน้าเว็บวาดมันเป็น
 * "ว่าง → ว่าง" คนอ่านจะสรุปว่าไม่มีอะไรเกิดขึ้น ทั้งที่ความจริงคือมีบางอย่าง
 * เปลี่ยนแต่ระบบตั้งใจไม่เก็บว่าเปลี่ยนเป็นอะไร
 */
export function changeLine(
  c: AuditChange,
  meta: Record<string, FieldMeta> | undefined,
): ChangeLine {
  const m = (meta || {})[c.field];
  const label = (m && m.label) || c.field;
  if (c.withheld) {
    return { label, from: '', to: '', withheld: true, masked: Boolean(m && m.mask) };
  }
  return {
    label,
    from: formatAuditValue(c.from, m && m.kind),
    to: formatAuditValue(c.to, m && m.kind),
    withheld: false,
    masked: Boolean(m && m.mask),
  };
}

/** ชื่อคนที่ถูกแก้ — ไม่มีในทะเบียนแล้วต้องขึ้น id ดิบ ไม่ใช่ซ่อนแถวทิ้ง */
export function subjectText(
  row: AuditRow,
  names: Record<string, AuditSubject> | undefined,
): string {
  const s = (names || {})[row.entity_id];
  if (!s) return `${row.entity_id} (ไม่อยู่ในทะเบียนแล้ว)`;
  const code = s.employee_code ? ` · ${s.employee_code}` : '';
  return `${s.name || row.entity_id}${code}`;
}

/** คนที่กด — ไม่มีชื่อให้แสดง uid เพื่อให้ยังตามตัวได้ */
export function actorText(row: AuditRow): string {
  const name = (row.actor_name || '').trim();
  const role = (row.actor_role || '').trim();
  if (name) return role ? `${name} (${role})` : name;
  if (row.actor_uid) return `uid ${row.actor_uid}`;
  return 'ไม่ทราบผู้กระทำ';
}

export interface AuditFilter {
  action?: string;
  /** ข้อความค้นหา — ชื่อคนถูกแก้ ชื่อคนกด เหตุผล หรือชื่อฟิลด์ */
  q?: string;
}

/**
 * กรองแถวฝั่งหน้าเว็บ
 *
 * กรองบน `rows` ที่ callable ส่งมาแล้วเท่านั้น **ไม่ได้ลดจำนวนแถวที่ถูกอ่าน**
 * — ธง `capped` จึงยังต้องขึ้นบนหน้าแม้ผลกรองจะเหลือไม่กี่แถว ไม่งั้นคนอ่าน
 * จะนึกว่าเห็นครบทั้งช่วงเวลา
 */
export function filterAuditRows(
  rows: AuditRow[],
  filter: AuditFilter,
  names?: Record<string, AuditSubject>,
  meta?: Record<string, FieldMeta>,
): AuditRow[] {
  const action = (filter.action || '').trim();
  const q = (filter.q || '').trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (action && r.action !== action) return false;
    if (!q) return true;
    const fields = (r.changes || [])
      .map((c) => `${c.field} ${((meta || {})[c.field] || { label: '' }).label}`)
      .join(' ');
    const hay = [
      subjectText(r, names), actorText(r), r.reason || '', fields, r.action,
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}
