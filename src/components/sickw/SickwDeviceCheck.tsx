// ปุ่ม + พาเนลผลตรวจ Sickw แบบนำกลับมาใช้ได้
// ใช้ที่: InternalQCModal, QCStation
//
// รองรับ 2 mode:
// - single service: เลือก 1 service → ใช้ checkDeviceWithSickw
// - bundle: เลือกหลาย service → ใช้ checkDeviceWithSickwBundle (parallel)
//
// Service catalog โหลดจาก Cloud Function listSickwServices (cache 1 ชม.)
// → admin/rider เห็นชื่อ + ราคาทุกครั้ง, ไม่ต้องจำ ID

import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { Search, Loader2, CheckCircle2, AlertTriangle, HelpCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { db } from '../../api/firebase';
import {
  checkDeviceWithSickw, checkDeviceWithSickwBundle,
  interpretFmi, interpretMdm, interpretBlacklist,
  type SickwCheckResult, type SickwBundleResult, type SickwFlagState,
  type SickwParsedFields,
} from '../../utils/sickwApi';
import { SickwServicePicker } from './SickwServicePicker';

const BUNDLE_STORAGE_KEY = 'sickw:lastSelectedServices';

interface Props {
  initialImei?: string;
  initialSerial?: string;
  className?: string;
  /** ส่ง jobId เพื่อให้ Cloud Function เก็บ snapshot ลง jobs/{id}/sickw_check */
  jobId?: string;
}

// Unified shape: ทั้ง single + bundle map ลง interface เดียวกันเพื่อ render พาเนลเดียว
interface UnifiedResult {
  ok: boolean;
  cached: boolean;
  checkedAt: number;
  bundle: boolean;
  serviceLabel: string; // "service 3" or "bundle [3,4]"
  status: string;
  parsed: SickwParsedFields;
  fields: Record<string, string>;
  raw: string;
  imei: string;
  errors?: string[];
}

function toUnifiedFromSingle(r: SickwCheckResult): UnifiedResult {
  return {
    ok: r.ok,
    cached: r.cached,
    checkedAt: r.checkedAt,
    bundle: false,
    serviceLabel: `service ${r.serviceId}`,
    status: r.status,
    parsed: r.parsed,
    fields: r.fields,
    raw: r.raw,
    imei: r.imei,
  };
}

function toUnifiedFromBundle(r: SickwBundleResult): UnifiedResult {
  const errors: string[] = [];
  for (const [id, perSvc] of Object.entries(r.perService)) {
    if (perSvc.error) errors.push(`svc ${id}: ${perSvc.error}`);
  }
  const allCached = Object.values(r.perService).every((p) => p.cached);
  return {
    ok: r.ok,
    cached: allCached,
    checkedAt: r.checkedAt,
    bundle: true,
    serviceLabel: `bundle [${r.serviceIds.join(', ')}]`,
    status: r.ok ? 'success' : 'error',
    parsed: r.parsed,
    fields: r.fields,
    raw: Object.values(r.perService).map((p) => `--- svc_${p.serviceId} ---\n${p.raw || p.error || ''}`).join('\n\n'),
    imei: r.imei,
    errors: errors.length ? errors : undefined,
  };
}

export function SickwDeviceCheck({ initialImei, initialSerial, className, jobId }: Props) {
  const [imei, setImei] = useState(initialImei || initialSerial || '');
  const [selectedServices, setSelectedServices] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BUNDLE_STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.map(String) : [];
    } catch { return []; }
  });
  const [defaultBundle, setDefaultBundle] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnifiedResult | null>(null);
  const [showAllFields, setShowAllFields] = useState(false);

  // โหลด default bundle จาก settings/sickw/default_bundle
  useEffect(() => {
    const unsub = onValue(ref(db, 'settings/sickw/default_bundle'), (snap) => {
      const v = snap.val();
      if (Array.isArray(v)) setDefaultBundle(v.map(String));
    });
    return () => unsub();
  }, []);

  // ครั้งแรก ถ้า user ยังไม่เคยเลือก service ใช้ default bundle ของ admin
  useEffect(() => {
    if (selectedServices.length === 0 && defaultBundle.length > 0) {
      setSelectedServices(defaultBundle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultBundle]);

  // infer source สำหรับ audit log: ดูว่าอยู่ในหน้า mobile หรือ desktop
  const source = typeof window !== 'undefined' && window.location.pathname.startsWith('/mobile')
    ? 'admin_mobile' : 'admin_desktop';

  const runCheck = async (forceRefresh = false) => {
    setError(null);
    setLoading(true);
    try {
      if (selectedServices.length === 1) {
        const res = await checkDeviceWithSickw({
          imei, serviceId: selectedServices[0], forceRefresh, jobId, source,
        });
        setResult(toUnifiedFromSingle(res));
      } else {
        const res = await checkDeviceWithSickwBundle({
          imei, serviceIds: selectedServices, forceRefresh, jobId, source,
        });
        setResult(toUnifiedFromBundle(res));
      }
      localStorage.setItem(BUNDLE_STORAGE_KEY, JSON.stringify(selectedServices));
    } catch (e: any) {
      setError(e?.message || 'ตรวจสอบไม่สำเร็จ');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = imei.trim().length >= 8 && selectedServices.length > 0 && !loading;

  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 ${className || ''}`}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
          <Search size={16} className="text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Sickw IMEI Check</h3>
          <p className="text-[10px] text-slate-500">เลือก service ที่จะตรวจ (1+ ตัว) — ราคาตามที่ Sickw กำหนด</p>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-bold text-slate-400 uppercase">IMEI / Serial</label>
        <input
          type="text"
          value={imei}
          onChange={(e) => setImei(e.target.value.replace(/\s/g, ''))}
          placeholder="358xxxxxxxxxxx"
          className="w-full mt-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-blue-400"
        />
      </div>

      <SickwServicePicker
        value={selectedServices}
        onChange={setSelectedServices}
        defaultBundle={defaultBundle}
        disabled={loading}
      />

      <div className="flex gap-2">
        <button
          onClick={() => runCheck(false)}
          disabled={!canSubmit}
          className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold text-sm shadow-sm hover:bg-blue-700 active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:active:scale-100 flex justify-center items-center gap-2 transition-all"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> กำลังตรวจ...</>
            : <><Search size={16} /> {selectedServices.length > 1 ? `ตรวจครบชุด (${selectedServices.length} services)` : 'ตรวจสอบ'}</>}
        </button>
        {result && (
          <button
            onClick={() => runCheck(true)}
            disabled={loading}
            title="ข้าม cache (เปลืองเครดิตอีกรอบ)"
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

function SickwResultPanel({ result, showAll, onToggleAll }: { result: UnifiedResult; showAll: boolean; onToggleAll: () => void }) {
  const p = result.parsed;
  const failed = result.status !== 'success';

  if (failed && !p.model && !p.fmiStatus && !p.iCloudStatus) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-600" />
          <span className="text-sm font-bold text-amber-900">Sickw ตอบกลับว่า: {result.status}</span>
        </div>
        {result.errors && (
          <ul className="text-[11px] text-amber-800 list-disc pl-5">
            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {result.raw && (
          <pre className="text-[11px] text-amber-800 bg-white/50 p-2 rounded font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {result.raw.slice(0, 800)}
          </pre>
        )}
      </div>
    );
  }

  // fmi ดูเฉพาะ "icloud lock / activation lock / fmi status" — ห้ามดู iCloudStatus
  // (อันนั้นบอก lost/clean ของ blacklist ไม่ใช่ FMI ติดล็อคไหม)
  const fmi = interpretFmi(p.fmiStatus || p.activationLock);
  const mdm = interpretMdm(p.mdmStatus);
  const bl = interpretBlacklist(p.blacklistStatus || p.iCloudStatus);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>
          {result.serviceLabel} · {new Date(result.checkedAt).toLocaleString('th-TH')}
        </span>
        {result.cached && (
          <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded font-bold uppercase tracking-wider">cached</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <FlagBadge label="Find My / iCloud" state={fmi} value={p.fmiStatus || p.activationLock || '-'} />
        <FlagBadge label="MDM" state={mdm} value={p.mdmStatus || '-'} />
        <FlagBadge label="Blacklist" state={bl} value={p.blacklistStatus || p.iCloudStatus || '-'} />
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

      {result.errors && result.errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 text-[10px] text-amber-800">
          <p className="font-bold mb-1">บาง service ใน bundle ล้มเหลว:</p>
          <ul className="list-disc pl-4">
            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <button
        onClick={onToggleAll}
        className="w-full flex items-center justify-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 py-1"
      >
        {showAll
          ? <><ChevronUp size={12} /> ซ่อนข้อมูลดิบทั้งหมด</>
          : <><ChevronDown size={12} /> ดูข้อมูลดิบทั้งหมด ({Object.keys(result.fields).length} field)</>}
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
