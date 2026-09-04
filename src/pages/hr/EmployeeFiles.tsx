// src/pages/hr/EmployeeFiles.tsx
//
// ตัวเรนเดอร์แฟ้มเอกสารพนักงาน — **ไม่ import firebase** เพื่อให้ SSR ในเทสได้
// จริง (รูปเดียวกับ `StageTrack` และ `EmployeeHistory`) ทุกการกระทำส่งออกไป
// เป็น callback ให้โมดอลใน `EmployeeRegister` เป็นคนยิง callable
//
// **ป้ายชนิดเอกสารทั้งหมดมาจาก `checklist` ที่ server ส่งมา** ไฟล์นี้ไม่มีตาราง
// ป้ายของตัวเอง — ดูเหตุผลที่หัวไฟล์ `employeeFiles.ts`

import React from 'react';
import { FileCheck2, AlertTriangle, Download, Trash2, Paperclip } from 'lucide-react';
import { checklistSummary, formatBytes, groupFiles } from './employeeFiles';
import type { ChecklistRow, FileRow } from './employeeFiles';

const thaiDate = (ms?: number | null) => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n).toLocaleDateString('th-TH', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok',
  });
};

/** แถบสรุปหัวโมดอล — บอกว่ายังขาดกี่ใบ หรือบอกตรงๆ ว่ายังไม่รู้ */
export const FilesSummary: React.FC<{ checklist: ChecklistRow[] | null }> = ({ checklist }) => {
  const s = checklistSummary(checklist);
  if (s.unknown) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500">
        ยังอ่านรายการเอกสารที่ต้องมีไม่ได้ — ไฟล์ที่อัปโหลดไว้แล้วยังอยู่ครบ
      </div>
    );
  }
  if (s.complete) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 flex items-center gap-1.5">
        <FileCheck2 size={14} /> เอกสารที่ต้องมีครบแล้ว ({s.required} รายการ)
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 flex items-center gap-1.5">
      <AlertTriangle size={14} /> ยังขาด {s.missing} จาก {s.required} รายการที่ต้องมี
    </div>
  );
};

interface PanelProps {
  checklist: ChecklistRow[] | null;
  files: FileRow[] | null;
  busy?: boolean;
  loading?: boolean;
  onPick: (kind: string) => void;
  onDownload: (file: FileRow) => void;
  onDelete: (file: FileRow) => void;
}

export const EmployeeFilesPanel: React.FC<PanelProps> = ({
  checklist, files, busy, loading, onPick, onDownload, onDelete,
}) => {
  if (loading) {
    return <p className="text-sm text-gray-400 py-6 text-center">กำลังโหลดแฟ้ม...</p>;
  }
  const groups = groupFiles(checklist, files);
  if (!groups.length) {
    return (
      <p className="text-sm text-gray-400 py-6 text-center">
        ยังไม่มีรายการเอกสาร — ถ้าเพิ่งอัปเดตระบบ ให้ลองใหม่อีกครั้งในอีกสักครู่
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.kind}
          className={`rounded-xl border px-3 py-2.5 ${
            g.required && g.files.length === 0
              ? 'border-amber-200 bg-amber-50/40'
              : 'border-gray-200 bg-white'
          }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-gray-800 flex items-center gap-1.5">
                {g.label}
                {g.required && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-800 text-white">
                    ต้องมี
                  </span>
                )}
                {g.unknownKind && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                    ไม่รู้จัก
                  </span>
                )}
              </p>
              {g.note && <p className="text-[11px] text-gray-400 mt-0.5">{g.note}</p>}
            </div>
            {!g.unknownKind && (
              <button type="button" disabled={busy} onClick={() => onPick(g.kind)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-600 inline-flex items-center gap-1.5 disabled:opacity-50">
                <Paperclip size={13} /> แนบไฟล์
              </button>
            )}
          </div>

          {g.files.length === 0 ? (
            <p className={`text-xs mt-2 ${g.required ? 'text-amber-700 font-bold' : 'text-gray-400'}`}>
              {g.required ? 'ยังไม่มีไฟล์' : 'ไม่มีไฟล์ (ไม่บังคับ)'}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {g.files.map((f) => (
                <li key={f.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-700 truncate">{f.filename}</p>
                    <p className="text-[11px] text-gray-400">
                      {formatBytes(f.size)} · {thaiDate(f.uploaded_at)}
                      {f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''}
                    </p>
                    {f.note && <p className="text-[11px] text-gray-500 mt-0.5">{f.note}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" disabled={busy} onClick={() => onDownload(f)}
                      title="เปิดไฟล์"
                      className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-500 disabled:opacity-50">
                      <Download size={13} />
                    </button>
                    <button type="button" disabled={busy} onClick={() => onDelete(f)}
                      title="ลบไฟล์"
                      className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-rose-50 text-rose-500 disabled:opacity-50">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};
