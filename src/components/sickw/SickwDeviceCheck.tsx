// ปุ่ม + พาเนลผลตรวจ Sickw แบบนำกลับมาใช้ได้
// ใช้ที่: InternalQCModal, QCStation
//
// - จำ default Service ID ใน localStorage (กันแอดมินต้องพิมพ์ซ้ำ)
// - ตรวจซ้ำภายใน 24 ชม. = ดึง cache (cloud function จัดการให้)
// - กดปุ่ม "ตรวจใหม่อีกครั้ง" เพื่อ bypass cache (เปลืองเครดิตอีกครั้ง)

import { useEffect, useState } from 'react';
import { Search, Loader2, CheckCircle2, AlertTriangle, HelpCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import {
  checkDeviceWithSickw,
  interpretFmi, interpretMdm, interpretBlacklist,
  type SickwCheckResult, type SickwFlagState,
} from '../../utils/sickwApi';

const SVC_ID_STORAGE_KEY = 'sickw:lastServiceId';

interface Props {
  initialImei?: string;
  initialSerial?: string;
  defaultServiceId?: string;
  className?: string;
  /** ส่ง jobId เพื่อให้ Cloud Function เก็บ snapshot ลง jobs/{id}/sickw_check */
  jobId?: string;
  /** ผลตรวจที่เก็บไว้ก่อนหน้า — ใช้ pre-populate ตอนเปิดใบงานซ้ำ */
  existingResult?: SickwCheckResult | null;
  /** trigger หลังตรวจสำเร็จ ให้ parent re-evaluate gate */
  onChecked?: (result: SickwCheckResult) => void;
}

export function SickwDeviceCheck({ initialImei, initialSerial, defaultServiceId, className, jobId, existingResult, onChecked }: Props) {
  const [imei, setImei] = useState(initialImei || initialSerial || existingResult?.imei || '');
  const [serviceId, setServiceId] = useState(() =>
    defaultServiceId || existingResult?.serviceId || localStorage.getItem(SVC_ID_STORAGE_KEY) || ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SickwCheckResult | null>(existingResult || null);
  const [showAllFields, setShowAllFields] = useState(false);

  // ถ้า parent ส่ง existingResult ใหม่มา (เช่น โหลดใบงานเสร็จหลัง mount) → sync
  useEffect(() => {
    if (existingResult && !result) {
      setResult(existingResult);
      if (existingResult.imei && !imei) setImei(existingResult.imei);
      if (existingResult.serviceId && !serviceId) setServiceId(existingResult.serviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingResult]);

  const runCheck = async (forceRefresh = false) => {
    setError(null);
    setLoading(true);
    try {
      const res = await checkDeviceWithSickw({ imei, serviceId, forceRefresh, jobId });
      setResult(res);
      localStorage.setItem(SVC_ID_STORAGE_KEY, String(serviceId));
      onChecked?.(res);
    } catch (e: any) {
      setError(e?.message || 'ตรวจสอบไม่สำเร็จ');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = imei.trim().length >= 8 && /^\d+$/.test(serviceId.trim()) && !loading;

  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 ${className || ''}`}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
          <Search size={16} className="text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Sickw IMEI Check</h3>
          <p className="text-[10px] text-slate-500">ตรวจรุ่น / ความจุ / ประเทศ / iCloud / FMI / MDM / Blacklist</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">IMEI / Serial</label>
          <input
            type="text"
            value={imei}
            onChange={(e) => setImei(e.target.value.replace(/\s/g, ''))}
            placeholder="358xxxxxxxxxxx"
            className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">Service ID</label>
          <input
            type="text"
            inputMode="numeric"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="เช่น 3"
            className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-blue-400"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => runCheck(false)}
          disabled={!canSubmit}
          className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold text-sm shadow-sm hover:bg-blue-700 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:active:scale-100 flex justify-center items-center gap-2 transition-all"
        >
          {loading ? <><Loader2 size={16} className="animate-spin" /> กำลังตรวจ...</> : <><Search size={16} /> ตรวจสอบ</>}
        </button>
        {result && (
          <button
            onClick={() => runCheck(true)}
            disabled={loading}
            title="ข้าม cache แล้วเรียก Sickw ใหม่ (เปลืองเครดิต)"
            className="px-3 py-3 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-all"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-xs text-red-800">
          <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <SickwResultPanel result={result} showAll={showAllFields} onToggleAll={() => setShowAllFields((v) => !v)} />
      )}
    </div>
  );
}

function SickwResultPanel({ result, showAll, onToggleAll }: { result: SickwCheckResult; showAll: boolean; onToggleAll: () => void }) {
  const p = result.parsed;
  const failed = result.status !== 'success';

  if (failed) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-600" />
          <span className="text-sm font-bold text-amber-900">Sickw ตอบกลับว่า: {result.status}</span>
        </div>
        {result.raw && (
          <pre className="text-[11px] text-amber-800 bg-white/50 p-2 rounded font-mono whitespace-pre-wrap break-words">
            {result.raw.slice(0, 500)}
          </pre>
        )}
      </div>
    );
  }

  const fmi = interpretFmi(p.fmiStatus || p.iCloudStatus || p.activationLock);
  const mdm = interpretMdm(p.mdmStatus);
  const bl = interpretBlacklist(p.blacklistStatus);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>ตรวจเมื่อ: <span className="font-mono">{new Date(result.checkedAt).toLocaleString('th-TH')}</span></span>
        {result.cached && (
          <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded font-bold uppercase tracking-wider">cached</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <FlagBadge label="Find My / iCloud" state={fmi} value={p.fmiStatus || p.iCloudStatus || p.activationLock || '-'} />
        <FlagBadge label="MDM" state={mdm} value={p.mdmStatus || '-'} />
        <FlagBadge label="Blacklist" state={bl} value={p.blacklistStatus || '-'} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
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
        <InfoRow label="IMEI" value={p.imei || result.imei} mono />
        <InfoRow label="Serial" value={p.serial} mono />
      </div>

      <button
        onClick={onToggleAll}
        className="w-full flex items-center justify-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 py-1"
      >
        {showAll ? <><ChevronUp size={12} /> ซ่อนข้อมูลดิบทั้งหมด</> : <><ChevronDown size={12} /> ดูข้อมูลดิบทั้งหมด ({Object.keys(result.fields).length} field)</>}
      </button>

      {showAll && (
        <pre className="text-[10px] bg-slate-900 text-slate-100 p-3 rounded-xl font-mono whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {Object.entries(result.fields).map(([k, v]) => `${k}: ${v}`).join('\n')}
        </pre>
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
