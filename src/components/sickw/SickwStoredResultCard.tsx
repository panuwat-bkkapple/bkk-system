// Card แสดง full Sickw result ที่เก็บไว้ใน jobs/{id}/sickw_check/last_check
// ใช้ในหน้ารายละเอียดใบงาน (mobile + desktop) เพื่อให้ admin เห็นข้อมูลครบ
// (รุ่น/ความจุ/ประเทศ/IMEI/Serial/Carrier/Warranty/ฯลฯ) โดยไม่ต้องเปิด modal
//
// Default = expanded (เพราะ admin/QC อ่านบ่อย) — กดปิดได้
// แสดง user / time / mismatch ใน header เพื่อให้สแกนตาเห็นเร็ว
// ปุ่ม "Sync to Job" ให้ admin override ข้อมูลใบงานด้วยค่าจาก Sickw

import { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import {
  Search, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, HelpCircle,
  Loader2, Wand2, User,
} from 'lucide-react';
import { db } from '../../api/firebase';
import {
  interpretFmi, interpretMdm, interpretBlacklist, syncJobFromSickw,
  type JobSickwCheck, type SickwFlagState, type SyncableField,
} from '../../utils/sickwApi';
import { useToast } from '../ui/ToastProvider';

interface Props {
  sickwCheck: JobSickwCheck | undefined | null;
  /** ใบงาน — ใช้สำหรับเทียบ mismatch + ปุ่ม Sync */
  job?: any;
  /** เริ่มต้นเปิด/ปิด (default: true) */
  defaultOpen?: boolean;
  className?: string;
}

const SYNCABLE_LABELS: Record<SyncableField, string> = {
  model: 'รุ่น',
  capacity: 'ความจุ',
  color: 'สี',
  country: 'ประเทศ',
  imei: 'IMEI',
  imei2: 'IMEI 2',
  serial: 'Serial',
};

export function SickwStoredResultCard({ sickwCheck, job, defaultOpen = true, className }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [showRaw, setShowRaw] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // ดึงชื่อผู้ตรวจจาก staff/{id} โดยใช้ uid ของ last_check.checked_by_uid
  // เพราะ snapshot บนใบงานเก็บแค่ uid — ต้อง resolve เป็นชื่อ
  const [checkedByName, setCheckedByName] = useState<string | null>(null);

  const lc = sickwCheck?.last_check;
  const uid = lc?.checked_by_uid;

  useEffect(() => {
    if (!uid) { setCheckedByName(null); return; }
    // วิธีหา: scan staff/ หา email — แต่ snapshot บน job ไม่เก็บ email
    // ใช้ทางลัด: query sickw_usage หา entry ล่าสุดของ uid นี้ → ได้ name resolved
    // (audit log มี name resolved แล้ว — reuse data)
    const unsub = onValue(ref(db, 'sickw_usage'), (snap) => {
      let bestName: string | null = null;
      let bestTime = 0;
      snap.forEach((s) => {
        const v = s.val();
        if (v && v.uid === uid && v.name && v.name !== 'Unknown' && v.timestamp > bestTime) {
          bestName = v.name;
          bestTime = v.timestamp;
        }
      });
      setCheckedByName(bestName);
    });
    return () => unsub();
  }, [uid]);

  // คำนวณ field ที่ Sickw มีค่าและต่างจากในใบงาน — แสดงเป็น mismatch chip
  const mismatches = useMemo(() => {
    if (!lc?.parsed || !job) return [] as { field: SyncableField; jobValue: string; sickwValue: string }[];
    const p = lc.parsed;
    const list: { field: SyncableField; jobValue: string; sickwValue: string }[] = [];
    const fields: SyncableField[] = ['model', 'capacity', 'color', 'country', 'imei', 'serial'];
    for (const f of fields) {
      const sickwVal = p[f];
      if (!sickwVal) continue;
      const jobVal = job[f] || '';
      // เปรียบเทียบแบบ case-insensitive + ตัด whitespace
      const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (norm(sickwVal) && norm(sickwVal) !== norm(jobVal)) {
        list.push({ field: f, jobValue: jobVal, sickwValue: String(sickwVal) });
      }
    }
    return list;
  }, [lc, job]);

  if (!lc) return null;

  const p = lc.parsed || {};
  const flags = lc.flags || {
    fmi: interpretFmi(p.fmiStatus || p.activationLock),
    mdm: interpretMdm(p.mdmStatus),
    blacklist: interpretBlacklist(p.blacklistStatus || p.iCloudStatus),
  };
  const fieldsCount = Object.keys(lc.fields || {}).length;

  const handleSync = async (fields: SyncableField[]) => {
    if (!job?.id) {
      toast.error('ไม่พบ jobId — ไม่สามารถ sync ได้');
      return;
    }
    setSyncing(true);
    try {
      const res = await syncJobFromSickw(job.id, fields);
      toast.success(`Sync ${res.fields.length} field สำเร็จ`);
    } catch (e: any) {
      toast.error(e?.message || 'Sync ไม่สำเร็จ');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className || ''}`}>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full p-4 flex items-start gap-3 hover:bg-slate-50 transition text-left"
      >
        <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <Search size={16} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800">ข้อมูลจาก Sickw</p>
            {mismatches.length > 0 && (
              <span className="text-[10px] font-black uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                {mismatches.length} field ไม่ตรงงาน
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            {p.model || '—'}
            {p.capacity && ` · ${p.capacity}`}
            {p.color && ` · ${p.color}`}
            {p.country && ` · ${p.country}`}
          </p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <User size={10} />
              {checkedByName || 'ไม่ทราบผู้ตรวจ'}
            </span>
            <span>{new Date(lc.checked_at).toLocaleString('th-TH')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono text-slate-400">svc {lc.service_id}</span>
          {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
          {/* Mismatch warning + sync button */}
          {mismatches.length > 0 && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-700" />
                <p className="text-xs font-black uppercase text-amber-900">ข้อมูลในใบงานไม่ตรงกับ Sickw</p>
              </div>
              <ul className="text-[11px] text-amber-900 space-y-0.5 pl-5">
                {mismatches.map((m) => (
                  <li key={m.field}>
                    <span className="font-bold">{SYNCABLE_LABELS[m.field]}:</span>{' '}
                    <span className="line-through text-amber-700">{m.jobValue || '(ว่าง)'}</span>
                    {' → '}
                    <span className="font-bold">{m.sickwValue}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSync(mismatches.map((m) => m.field))}
                disabled={syncing}
                className="w-full mt-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {syncing ? <><Loader2 size={12} className="animate-spin" /> กำลัง sync...</>
                  : <><Wand2 size={12} /> ใช้ข้อมูลจาก Sickw แทน ({mismatches.length} field)</>}
              </button>
            </div>
          )}

          {/* Flag badges */}
          <div className="grid grid-cols-3 gap-2 pt-3">
            <FlagBadge label="Find My / iCloud" state={flags.fmi} value={p.fmiStatus || p.activationLock || '-'} />
            <FlagBadge label="MDM" state={flags.mdm} value={p.mdmStatus || '-'} />
            <FlagBadge label="Blacklist" state={flags.blacklist} value={p.blacklistStatus || p.iCloudStatus || '-'} />
          </div>

          {/* Parsed info table */}
          <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
            <InfoRow label="รุ่น" value={p.model} highlight={mismatches.some((m) => m.field === 'model')} />
            <InfoRow label="Model No." value={p.modelNumber} mono />
            <InfoRow label="ความจุ" value={p.capacity} highlight={mismatches.some((m) => m.field === 'capacity')} />
            <InfoRow label="สี" value={p.color} highlight={mismatches.some((m) => m.field === 'color')} />
            <InfoRow label="ประเทศ" value={p.country} highlight={mismatches.some((m) => m.field === 'country')} />
            <InfoRow label="Carrier" value={p.carrier} />
            <InfoRow label="SIM Lock" value={p.simLock} />
            <InfoRow label="Activation" value={p.activationStatus} />
            <InfoRow label="ประกัน" value={p.warrantyStatus} />
            <InfoRow label="วันซื้อโดยประมาณ" value={p.estimatedPurchaseDate} />
            <InfoRow label="IMEI" value={p.imei || lc.imei} mono highlight={mismatches.some((m) => m.field === 'imei')} />
            <InfoRow label="IMEI 2" value={p.imei2} mono />
            <InfoRow label="Serial" value={p.serial} mono highlight={mismatches.some((m) => m.field === 'serial')} />
          </div>

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

function InfoRow({ label, value, mono, highlight }: { label: string; value?: string; mono?: boolean; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div className={`flex justify-between items-baseline gap-3 text-xs ${highlight ? 'bg-amber-100 -mx-1 px-1 rounded' : ''}`}>
      <span className="text-slate-400 font-medium shrink-0">{label}</span>
      <span className={`text-slate-800 font-bold text-right ${mono ? 'font-mono' : ''} ${highlight ? 'text-amber-900' : ''}`}>{value}</span>
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
