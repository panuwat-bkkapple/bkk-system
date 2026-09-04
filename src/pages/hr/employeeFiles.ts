// src/pages/hr/employeeFiles.ts
//
// กติกาการ *แสดงผล* ของแฟ้มเอกสารพนักงาน — **ล้วน ไม่มี I/O ไม่ import firebase**
//
// -----------------------------------------------------------------------------
// **ไฟล์นี้ไม่มีตารางชนิดเอกสาร และห้ามมี**
//
// ป้ายภาษาไทยของแต่ละชนิด (`สำเนาบัตรประชาชน`, `ล.ย.01` ฯลฯ) มาจาก server
// ผ่าน `checklist` ของ callable `adminHrEmployeeFileList` — กฎเดียวกับที่หน้า
// ตั้งค่าอีเมลยึด ("รายการเทมเพลตมาจาก server ไม่ hardcode ฝั่ง UI") เพราะ
// สำเนาที่สองของตารางเดียวกันคือของที่ drift แล้วไม่มีใครรู้ว่าฝั่งไหนถูก
//
// **ผลที่ตามมาที่ต้องรับให้ได้:** callable ตัวเก่ายังไม่ deploy = ไม่มี
// `checklist` ส่งมา หน้าเว็บต้องไม่พังและต้องไม่โกหกว่า "ไม่ขาดอะไรเลย"
// (hosting ขึ้นก่อน functions เสมอ — บทเรียนจาก #684)
// -----------------------------------------------------------------------------

export interface ChecklistRow {
  kind: string;
  label: string;
  note?: string | null;
  required: boolean;
  count: number;
  missing: boolean;
}

export interface FileRow {
  id: string;
  kind: string;
  filename: string;
  content_type?: string | null;
  size?: number | null;
  uploaded_at?: number | null;
  uploaded_by_name?: string | null;
  note?: string | null;
}

/** ขนาดไฟล์แบบอ่านออก — ไม่มีขนาด = ขีด ไม่ใช่ "0 B" ซึ่งอ่านเหมือนไฟล์เสีย */
export function formatBytes(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * สรุปหัวโมดอล
 *
 * **`unknown: true` เมื่อ checklist ยังไม่มา** — ต่างจาก "ครบแล้ว" คนละเรื่อง
 * และเป็นความต่างที่สำคัญ: จอที่บอกว่าครบทั้งที่ยังไม่รู้ คือจอที่ทำให้ HR
 * เลิกตาม แล้วเอกสารก็ไม่เคยถูกเก็บ
 */
export function checklistSummary(rows: ChecklistRow[] | null | undefined): {
  required: number; have: number; missing: number; complete: boolean; unknown: boolean;
} {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { required: 0, have: 0, missing: 0, complete: false, unknown: true };
  }
  const req = rows.filter((r) => r.required);
  const missing = req.filter((r) => r.missing).length;
  return {
    required: req.length,
    have: req.length - missing,
    missing,
    complete: missing === 0,
    unknown: false,
  };
}

/**
 * จัดแถวไฟล์เข้าใต้ชนิดตามลำดับของ checklist
 *
 * **ไฟล์ที่ชนิดไม่อยู่ใน checklist ต้องยังขึ้น** ในกลุ่มท้ายสุด — กฎเดียวกับ
 * ไทม์ไลน์ที่ยังแสดง action ที่แปลไม่ออก: การซ่อนของที่อ่านไม่ออกทำให้หน้าจอ
 * ตอบผิดว่า "ไม่มีไฟล์นั้น" ทั้งที่มันมีอยู่และกินที่อยู่จริง
 */
export interface FileGroup {
  kind: string;
  label: string;
  note: string | null;
  required: boolean;
  files: FileRow[];
  unknownKind?: boolean;
}

export function groupFiles(
  checklist: ChecklistRow[] | null | undefined,
  files: FileRow[] | null | undefined,
): FileGroup[] {
  const rows = Array.isArray(checklist) ? checklist : [];
  const all = Array.isArray(files) ? files : [];
  const known = new Set(rows.map((r) => r.kind));

  const groups: FileGroup[] = rows.map((r) => ({
    kind: r.kind,
    label: r.label,
    note: r.note || null,
    required: r.required,
    files: all.filter((f) => f.kind === r.kind),
  }));

  // จัดกลุ่มตาม kind ดิบ แล้วบอกตรงๆ ว่าระบบไม่รู้จัก
  const byKind = new Map<string, FileRow[]>();
  for (const f of all) {
    if (known.has(f.kind)) continue;
    const list = byKind.get(f.kind) || [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  for (const [kind, list] of byKind) {
    groups.push({
      kind,
      label: kind ? `ชนิด "${kind}"` : 'ชนิดที่ไม่ระบุ',
      note: 'ระบบยังไม่รู้จักชนิดเอกสารนี้',
      required: false,
      files: list,
      unknownKind: true,
    });
  }
  return groups;
}
