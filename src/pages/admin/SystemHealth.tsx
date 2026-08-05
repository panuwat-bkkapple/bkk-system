// หน้า System Health — สถานะ service/API ทุกตัวที่ระบบพึ่งพาในที่เดียว
// (CEO/MANAGER). อ่านผลจาก `system_health/` ที่ cloud function
// `systemHealthCheck` (scheduler รายชั่วโมง) เขียนไว้ + ปุ่ม "ตรวจตอนนี้"
// เรียก callable `adminSystemHealthRun`. ฝั่งตรวจจริงอยู่
// functions/health-check.js — เพิ่ม probe ใหม่ที่นั่น หน้านี้ render ตามข้อมูล
// ไม่ต้องแก้. read rule ของ `system_health` (admin เท่านั้น) อยู่ที่
// bkk-frontend-next/database.rules.json

import { useEffect, useState } from 'react';
import { ref, onValue, set } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Activity, RefreshCw, CheckCircle2, XCircle, AlertTriangle, MinusCircle, Clock, Info,
} from 'lucide-react';
import { db } from '../../api/firebase';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

type HealthStatus = 'ok' | 'warn' | 'fail' | 'skip';

interface HealthService {
  label: string;
  status: HealthStatus;
  message: string;
  latency_ms: number;
  checked_at: number;
  last_ok_at?: number | null;
  last_status_change_at?: number;
}

interface HealthSummary {
  overall: HealthStatus;
  ok: number;
  warn: number;
  fail: number;
  skip: number;
  checked_at: number;
  ran_by?: string;
}

// ลำดับการ์ดคงที่ (สำคัญมาก่อน) — service ที่ไม่อยู่ในลิสต์ต่อท้ายตามชื่อ
const SERVICE_ORDER = [
  'checkout_config',
  'customer_quote',
  'routes_api',
  'geocoding_api',
  'rtdb',
  'sickw',
  'resend',
  'telegram',
  'thailand_post',
  'anthropic',
];

const STATUS_META: Record<HealthStatus, { label: string; icon: React.ReactNode; chip: string; dot: string }> = {
  ok: {
    label: 'ปกติ',
    icon: <CheckCircle2 size={15} />,
    chip: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    dot: 'bg-emerald-500',
  },
  warn: {
    label: 'ควรตรวจสอบ',
    icon: <AlertTriangle size={15} />,
    chip: 'bg-amber-50 text-amber-600 border-amber-100',
    dot: 'bg-amber-500',
  },
  fail: {
    label: 'มีปัญหา',
    icon: <XCircle size={15} />,
    chip: 'bg-rose-50 text-rose-600 border-rose-100',
    dot: 'bg-rose-500',
  },
  skip: {
    label: 'ยังไม่ตั้งค่า',
    icon: <MinusCircle size={15} />,
    chip: 'bg-slate-50 text-slate-400 border-slate-200',
    dot: 'bg-slate-300',
  },
};

function timeAgo(ts: number | undefined | null): string {
  if (!ts) return '—';
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'เมื่อครู่นี้';
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชั่วโมงที่แล้ว`;
  return new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

export default function SystemHealth() {
  const toast = useToast();
  const [services, setServices] = useState<Record<string, HealthService> | null>(null);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  // สวิตช์เปิด/ปิดการตรวจรายตัว — เก็บที่ settings/health_checks/{id}/enabled
  // (ใต้ settings ใช้ rule เดิม read auth / write admin ไม่ต้อง deploy rules)
  // fail-open: มีแต่ false ชัดๆ เท่านั้นที่ปิด. ฝั่ง functions
  // (health-check.js) อ่าน node เดียวกัน — probe ที่ปิดจะได้สถานะ skip
  // ไม่นับ fail ไม่ส่งแจ้งเตือน. ใช้ mute service ที่รู้อยู่แล้วว่าพัง
  // เพราะรอฝั่งภายนอกแก้ (เช่น Thailand Post รอ activate บัญชี)
  const [toggles, setToggles] = useState<Record<string, { enabled?: boolean }>>({});

  useEffect(() => {
    const unsubs = [
      onValue(ref(db, 'system_health'), (snap) => {
        const v = snap.val() || {};
        setServices(v.services || {});
        setSummary(v.summary || null);
      }),
      onValue(ref(db, 'settings/health_checks'), (snap) => setToggles(snap.val() || {})),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const isProbeEnabled = (id: string) => toggles[id]?.enabled !== false;
  const handleToggleProbe = async (id: string, enabled: boolean) => {
    try {
      await set(ref(db, `settings/health_checks/${id}/enabled`), enabled);
      toast.success(enabled ? 'เปิดการตรวจแล้ว — มีผลรอบถัดไป' : 'ปิดการตรวจแล้ว — จะไม่นับเป็นปัญหาและไม่แจ้งเตือน');
    } catch {
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    }
  };

  const handleRunNow = async () => {
    setIsRunning(true);
    try {
      const fn = httpsCallable<Record<string, never>, { overall: HealthStatus }>(
        getFunctions(app, 'asia-southeast1'),
        'adminSystemHealthRun',
        { timeout: 120000 },
      );
      const res = await fn({});
      const overall = res.data?.overall;
      if (overall === 'fail') toast.error('ตรวจเสร็จ — มี service ที่ล้มเหลว ดูรายละเอียดด้านล่าง');
      else if (overall === 'warn') toast.success('ตรวจเสร็จ — ปกติเกือบหมด มีบางรายการควรตรวจสอบ');
      else toast.success('ตรวจเสร็จ — ทุก service ปกติ');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`ตรวจไม่สำเร็จ: ${msg}`);
    } finally {
      setIsRunning(false);
    }
  };

  const entries = Object.entries(services || {}).sort(([a], [b]) => {
    const ia = SERVICE_ORDER.indexOf(a);
    const ib = SERVICE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  // service ที่ปิดการตรวจไว้ไม่นับเป็นปัญหา (การ์ดโชว์เทาทันทีแม้ผลตรวจ
  // ล่าสุดที่เก็บไว้ยังเป็น fail — สถานะจริงใน DB จะตามมาในรอบถัดไป)
  const failCount = entries.filter(([id, s]) => isProbeEnabled(id) && s.status === 'fail').length;
  const warnCount = entries.filter(([id, s]) => isProbeEnabled(id) && s.status === 'warn').length;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-teal-100 text-teal-600 flex items-center justify-center">
            <Activity size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">System Health</h1>
            <p className="text-xs font-bold text-slate-400">
              สถานะ API และ config สำคัญของระบบ — ตรวจอัตโนมัติทุกชั่วโมง
            </p>
          </div>
        </div>
        <button
          onClick={handleRunNow}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-bold hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={15} className={isRunning ? 'animate-spin' : ''} />
          {isRunning ? 'กำลังตรวจ…' : 'ตรวจตอนนี้'}
        </button>
      </div>

      {summary ? (
        <div
          className={`mb-5 p-3.5 rounded-xl border flex items-center gap-3 ${
            failCount > 0
              ? 'bg-rose-50 border-rose-100'
              : warnCount > 0
                ? 'bg-amber-50 border-amber-100'
                : 'bg-emerald-50 border-emerald-100'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              failCount > 0 ? 'bg-rose-500' : warnCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
          />
          <p className="text-xs font-bold text-slate-700 leading-relaxed">
            {failCount > 0
              ? `มี ${failCount} service ล้มเหลว${warnCount > 0 ? ` และ ${warnCount} รายการควรตรวจสอบ` : ''}`
              : warnCount > 0
                ? `ระบบทำงานได้ แต่มี ${warnCount} รายการควรตรวจสอบ`
                : 'ทุก service ทำงานปกติ'}
          </p>
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-slate-400 shrink-0">
            <Clock size={12} /> ตรวจล่าสุด {timeAgo(summary.checked_at)}
          </span>
        </div>
      ) : services !== null && entries.length === 0 ? (
        <div className="mb-5 p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex gap-2">
          <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
            ยังไม่มีผลตรวจ — กด "ตรวจตอนนี้" เพื่อรันครั้งแรก (หลัง deploy scheduler จะตรวจเองทุกชั่วโมง)
          </p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        {entries.map(([id, s]) => {
          const enabled = isProbeEnabled(id);
          const meta = enabled ? (STATUS_META[s.status] || STATUS_META.skip) : STATUS_META.skip;
          return (
            <div key={id} className={`p-4 rounded-2xl border shadow-sm ${enabled ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-75'}`}>
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-800">{s.label}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black ${meta.chip}`}
                    >
                      {meta.icon}
                      {enabled ? meta.label : 'ปิดการตรวจไว้'}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-500 mt-1 break-words">
                    {enabled ? (s.message || '—') : 'ปิดการตรวจไว้ — ไม่นับเป็นปัญหาและไม่แจ้งเตือน จนกว่าจะเปิดใหม่'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-bold text-slate-400">{timeAgo(s.checked_at)}</div>
                  {enabled && Number.isFinite(s.latency_ms) ? (
                    <div className="text-[10px] font-bold text-slate-300">{s.latency_ms} ms</div>
                  ) : null}
                </div>
                <button
                  onClick={() => handleToggleProbe(id, !enabled)}
                  title={enabled ? 'ปิดการตรวจ service นี้ชั่วคราว (mute)' : 'เปิดการตรวจ service นี้'}
                  className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${enabled ? 'bg-teal-500' : 'bg-slate-300'}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`}
                  />
                </button>
              </div>
              {enabled && s.status === 'fail' && s.last_ok_at ? (
                <p className="mt-2 pl-5 text-[11px] font-bold text-rose-400">
                  ปกติครั้งสุดท้าย {timeAgo(s.last_ok_at)}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {services === null ? (
        <div className="p-8 text-center text-sm font-bold text-slate-400">กำลังโหลด…</div>
      ) : null}
    </div>
  );
}
