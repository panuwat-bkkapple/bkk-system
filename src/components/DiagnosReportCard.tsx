// BKK Diagnos report card — renders the server-verified diagnostic snapshot
// stored at jobs/{id}/devices/{i}/diagnostics (written by
// finalizeDiagnosticSession). Shared by the mobile ticket detail and the
// desktop ConditionVerification panel. Read-only: money and status are
// never touched from here — mismatches are evidence for the amendment flow.

import {
  Activity, AlertTriangle, Camera, CheckCircle2, MinusCircle, XCircle,
} from 'lucide-react';

interface DiagnosSnapshot {
  session_id?: string;
  mode?: string;
  performed_by?: string;
  submitted_at?: number;
  results?: Record<string, 'pass' | 'fail' | 'skipped'>;
  values?: Record<string, any>;
  summary?: { pass: number; fail: number; skipped: number };
  mismatches?: Array<{
    step_id: string;
    step_label?: string;
    customer_said?: string;
    /** Pre-built message (e.g. battery threshold flags) — shown as-is. */
    reason?: string;
  }>;
}

const STEP_LABEL: Record<string, string> = {
  device_identity: 'ข้อมูลเครื่อง',
  find_my: 'Find My',
  touch_grid: 'ทัชสกรีน',
  display: 'จอภาพ',
  camera_back: 'กล้องหลัง',
  camera_front: 'กล้องหน้า',
  mic_speaker: 'ไมค์/ลำโพง',
  gps: 'GPS',
  motion: 'เซ็นเซอร์',
  haptic_guided: 'ระบบสั่น',
  battery_guided: 'แบตเตอรี่',
  faceid_guided: 'Face ID',
};

const STEP_ORDER = Object.keys(STEP_LABEL);

/** Human-readable detail per step from the recorded value. */
function valueDetail(stepId: string, v: any): string {
  if (!v) return '';
  switch (stepId) {
    case 'battery_guided':
      return v.reported_pct ? `${v.reported_pct}%` : '';
    case 'gps':
      return v.accuracy_m ? `ความแม่นยำ ±${v.accuracy_m} ม.` : '';
    case 'touch_grid':
      return v.untouched ? `ลากไม่ติด ${v.untouched} จุด` : v.cells ? `ครบ ${v.cells} ช่อง` : '';
    case 'camera_back': {
      const parts: string[] = [];
      if (Array.isArray(v.lenses_viewed) && v.lenses_viewed.length) {
        parts.push(`ดูแล้ว ${v.lenses_viewed.length} เลนส์`);
      }
      if (typeof v.photo_count === 'number' && v.photo_count > 0) parts.push(`ถ่าย ${v.photo_count} ภาพ`);
      if (v.flash === 'ok') parts.push('แฟลชติด');
      if (v.flash === 'fail') parts.push('แฟลชไม่ติด');
      return parts.join(' · ');
    }
    case 'find_my':
      if (v.status === 'off') return 'ปิดแล้ว';
      if (v.status === 'on_can_disable') return 'เปิดอยู่ ปิดเองได้';
      if (v.status === 'locked_or_unknown') return 'ปิดไม่ได้/ติดล็อก';
      return '';
    default:
      return '';
  }
}

const ResultIcon = ({ r }: { r?: string }) => {
  if (r === 'pass') return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (r === 'fail') return <XCircle size={14} className="text-red-500 shrink-0" />;
  if (r === 'skipped') return <MinusCircle size={14} className="text-slate-400 shrink-0" />;
  return null;
};

export default function DiagnosReportCard({ diagnostics }: { diagnostics: DiagnosSnapshot }) {
  if (!diagnostics || !diagnostics.results) return null;
  const { results, values = {}, summary, mismatches = [], performed_by, submitted_at } = diagnostics;

  const photos: Array<{ lens?: string; url: string }> = [];
  ['camera_back', 'camera_front'].forEach((k) => {
    const list = values[k]?.photos;
    if (Array.isArray(list)) {
      list.forEach((p: any) => p?.url && photos.push({ lens: p.lens, url: p.url }));
    }
  });

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
          <Activity size={12} /> BKK Diagnos — ผลเทสจากเครื่อง
        </p>
        {summary && (
          <span className="text-[10px] font-bold text-slate-500 shrink-0">
            <span className="text-emerald-600">{summary.pass} ผ่าน</span>
            {' · '}
            <span className="text-red-500">{summary.fail} ไม่ผ่าน</span>
            {' · '}
            <span>{summary.skipped} ข้าม</span>
          </span>
        )}
      </div>

      {(performed_by || submitted_at) && (
        <p className="text-[10px] text-slate-400">
          {performed_by === 'Customer' ? 'ลูกค้าทดสอบเอง' : performed_by}
          {submitted_at
            ? ` · ${new Date(submitted_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`
            : ''}
        </p>
      )}

      {mismatches.length > 0 && (
        <div className="space-y-1.5">
          {mismatches.map((m, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] font-bold text-red-700"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {m.reason
                  ? m.reason
                  : `${m.step_label || STEP_LABEL[m.step_id] || m.step_id} เทสไม่ผ่าน${
                      m.customer_said ? ` — ขัดกับที่ลูกค้าแจ้ง: ${m.customer_said}` : ' — ขัดกับที่ลูกค้าแจ้ง'
                    }`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {STEP_ORDER.filter((id) => results[id]).map((id) => {
          const detail = valueDetail(id, values[id]);
          return (
            <div
              key={id}
              className="flex items-center gap-1.5 rounded-lg bg-white border border-slate-100 px-2 py-1.5"
            >
              <ResultIcon r={results[id]} />
              <span className="text-[11px] font-bold text-slate-600 truncate">
                {STEP_LABEL[id] || id}
                {detail && <span className="font-normal text-slate-400"> · {detail}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {photos.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Camera size={11} /> ภาพจากการทดสอบกล้อง ({photos.length})
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <a
                key={i}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200"
              >
                <img src={p.url} className="h-full w-full object-cover" alt={`ภาพทดสอบ ${i + 1}`} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
