// Card แสดง full Sickw result ที่เก็บไว้ใน jobs/{id}/sickw_check/last_check
// ใช้ในหน้ารายละเอียดใบงาน (mobile + desktop) เพื่อให้ admin เห็นข้อมูลครบ
// (รุ่น/ความจุ/ประเทศ/IMEI/Serial/Carrier/Warranty/ฯลฯ) โดยไม่ต้องเปิด modal
//
// collapsed by default — toggle เปิดได้ + ดู raw data ได้

import { useState } from 'react';
import {
  Search, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, HelpCircle,
} from 'lucide-react';
import {
  interpretFmi, interpretMdm, interpretBlacklist,
  type JobSickwCheck, type SickwFlagState,
} from '../../utils/sickwApi';

interface Props {
  sickwCheck: JobSickwCheck | undefined | null;
  /** เริ่มต้นเปิดอยู่ (default: false — collapse) */
  defaultOpen?: boolean;
  className?: string;
}

export function SickwStoredResultCard({ sickwCheck, defaultOpen, className }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [showRaw, setShowRaw] = useState(false);

  const lc = sickwCheck?.last_check;
  if (!lc) return null;

  const p = lc.parsed || {};
  const flags = lc.flags || {
    fmi: interpretFmi(p.fmiStatus || p.activationLock),
    mdm: interpretMdm(p.mdmStatus),
    blacklist: interpretBlacklist(p.blacklistStatus || p.iCloudStatus),
  };

  const fieldsCount = Object.keys(lc.fields || {}).length;

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className || ''}`}>
      {/* Header — clickable to toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition text-left"
      >
        <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <Search size={16} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">ข้อมูลจาก Sickw</p>
          <p className="text-[11px] text-slate-500 truncate">
            {p.model || '—'} · ตรวจเมื่อ {new Date(lc.checked_at).toLocaleString('th-TH')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-400">
            svc {lc.service_id}
          </span>
          {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
          {/* Flag badges */}
          <div className="grid grid-cols-3 gap-2 pt-3">
            <FlagBadge
              label="Find My / iCloud"
              state={flags.fmi}
              value={p.fmiStatus || p.activationLock || '-'}
            />
            <FlagBadge
              label="MDM"
              state={flags.mdm}
              value={p.mdmStatus || '-'}
            />
            <FlagBadge
              label="Blacklist"
              state={flags.blacklist}
              value={p.blacklistStatus || p.iCloudStatus || '-'}
            />
          </div>

          {/* Parsed info table */}
          <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
            <InfoRow label="รุ่น" value={p.model} />
            <InfoRow label="Model No." value={p.modelNumber} mono />
            <InfoRow label="ความจุ" value={p.capacity} />
            <InfoRow label="สี" value={p.color} />
            <InfoRow label="ประเทศ" value={p.country} />
            <InfoRow label="Carrier" value={p.carrier} />
            <InfoRow label="SIM Lock" value={p.simLock} />
            <InfoRow label="Activation" value={p.activationStatus} />
            <InfoRow label="ประกัน" value={p.warrantyStatus} />
            <InfoRow label="วันซื้อโดยประมาณ" value={p.estimatedPurchaseDate} />
            <InfoRow label="IMEI" value={p.imei || lc.imei} mono />
            <InfoRow label="IMEI 2" value={p.imei2} mono />
            <InfoRow label="Serial" value={p.serial} mono />
          </div>

          {/* Raw data — collapsible */}
          {fieldsCount > 0 && (
            <>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="w-full flex items-center justify-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 py-1"
              >
                {showRaw
                  ? <><ChevronUp size={12} /> ซ่อนข้อมูลดิบ</>
                  : <><ChevronDown size={12} /> ดูข้อมูลดิบทั้งหมด ({fieldsCount} field)</>}
              </button>

              {showRaw && (
                <pre className="text-[10px] bg-slate-900 text-slate-100 p-3 rounded-xl font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                  {Object.entries(lc.fields || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-baseline gap-3 text-xs">
      <span className="text-slate-400 font-medium shrink-0">{label}</span>
      <span className={`text-slate-800 font-bold text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function FlagBadge({ label, state, value }: { label: string; state: SickwFlagState; value: string }) {
  const color =
    state === 'clean' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
    state === 'flagged' ? 'bg-red-50 border-red-300 text-red-800' :
    'bg-slate-50 border-slate-200 text-slate-600';
  const Icon = state === 'clean' ? CheckCircle2 : state === 'flagged' ? AlertTriangle : HelpCircle;
  return (
    <div className={`border rounded-lg p-2 ${color}`}>
      <div className="flex items-center gap-1 mb-0.5">
        <Icon size={11} />
        <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[11px] font-bold truncate" title={value}>{value}</p>
    </div>
  );
}
