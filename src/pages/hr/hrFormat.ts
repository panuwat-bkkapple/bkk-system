// ---------------------------------------------------------------------------
// ตัวช่วยที่หน้าฝ่ายบุคคลใช้ร่วมกัน — ตัวเลข วันที่ CSV และการดาวน์โหลด
//
// ย้ายออกมาจาก PayrollRuns.tsx ตอนเพิ่มหน้าเอกสารภาษีรายปี **ไม่ใช่เพื่อความ
// สวยงาม แต่เพราะ `toCsv` ถือกติกาที่ผิดแล้วเงียบ**: ถ้าสำเนาที่สองลืม BOM
// ไฟล์ที่ออกมาจะเปิดใน Excel แล้วภาษาไทยเป็นตัวยึกยือ ซึ่งไม่มี error ไม่มี
// เทสไหนแดง มีแต่คนที่เปิดไฟล์แล้วอ่านไม่ออก
//
// จงใจไม่ยกขึ้นไปเป็น util ของทั้งแอป — แพตเทิร์นเดียวกันถูกเขียนซ้ำอยู่แล้ว
// อีกสิบหน้า (VatReport, WhtReport, FinancialReport ฯลฯ) การรวบทั้งหมดเป็น
// งานแยกที่ควรแตะหน้าเหล่านั้นพร้อมกัน ไม่ใช่พ่วงมากับ PR เรื่องภาษีรายปี
// ---------------------------------------------------------------------------

export const baht = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '-';

export const thaiDate = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

// CSV: คั่นด้วย comma และครอบด้วยเครื่องหมายคำพูดเสมอ + BOM เพื่อให้ Excel
// ภาษาไทยเปิดแล้วไม่เป็นตัวยึกยือ
export const toCsv = (rows: (string | number)[][]) =>
  '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

const saveBlob = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

export const downloadBase64 = (filename: string, base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  saveBlob(filename, new Blob([bytes], { type: 'application/pdf' }));
};

export const download = (filename: string, content: string) =>
  saveBlob(filename, new Blob([content], { type: 'text/csv;charset=utf-8;' }));
