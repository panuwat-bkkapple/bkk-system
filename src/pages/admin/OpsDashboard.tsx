// Ops Dashboard (/ops) — หน้าเดียว สี่แถว อ่านรู้เรื่องใน 5 วินาที
// (CEO/MANAGER): หลอดงบ AI วันนี้ · สุขภาพคำตอบ · cache/latency ·
// สถานะ flag ตอนนี้. ข้อมูลทั้งหมดมาจาก callable `adminOpsDashboard`
// (functions/ops-dashboard.js) ซึ่งอ่านจาก chat_ai_usage +
// search_overview_archive + settings ที่มีอยู่แล้ว — หน้านี้ไม่อ่าน RTDB ตรง
// เพราะทั้งสอง node อยู่ใต้ root deny (client อ่านไม่ได้ และควรเป็นแบบนั้นต่อ)
//
// auto-refresh 60 วินาที — ตัวเลขบนจอนี้มีไว้เฝ้าระหว่างเปิดสวิตช์ v2
// ไม่ใช่รายงานย้อนหลัง (กราฟย้อนหลัง/alert = รอบหน้า ตามโจทย์)

import { useCallback, useEffect, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Gauge, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { app } from '../../api/firebase';

interface OriginBudget {
  calls: number;
  cap: number;
  cost_usd: number;
  cost_basis: 'tokens' | 'estimate' | 'none';
}

interface OpsData {
  ymd: string;
  generated_at: number;
  budget: {
    search: OriginBudget;
    chat: OriginBudget;
    total_calls: number;
    total_cap: number;
    pct: number;
    total_cost_usd: number;
  };
  health: {
    search: {
      answered: number;
      salvaged: number;
      excised_answers: number;
      excised_sentences: number;
      unparseable: number;
      skipped: Record<string, number>;
      skipped_total: number;
      gate: Record<string, number>;
    };
    chat: null;
  };
  perf: {
    cache_hits: number;
    generated: number;
    cache_hit_rate: number | null;
    latency_p50: number | null;
    latency_p95: number | null;
    extract_p50: number | null;
    extract_p95: number | null;
    rate_limited_this_hour: number;
    rate_limited_today: number;
  };
  flags: {
    assistant_enabled: boolean;
    ai_suspended: boolean;
    ai_suspended_reason: string;
    ai_suspended_at: number | null;
    search_overview_key_set: boolean;
    anthropic_key_set: boolean;
    overview_model: string;
    extract_model: string;
    chat_model: string;
    last_model_fallback: unknown;
    v2_answers_today: number;
    v1_answers_today: number;
  };
}

const REFRESH_MS = 60_000;

const usd = (v: number) => `$${v >= 10 ? v.toFixed(2) : v.toFixed(3)}`;
const ms = (v: number | null) => (v == null ? '—' : v >= 10_000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const pctText = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${
        ok ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'
      }`}
    >
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {label}
    </span>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${alert ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className={`text-2xl font-bold tabular-nums ${alert ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function OpsDashboard() {
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const fn = httpsCallable<Record<string, never>, OpsData>(
        getFunctions(app, 'asia-southeast1'),
        'adminOpsDashboard',
        { timeout: 30000 },
      );
      const res = await fn({});
      setData(res.data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const b = data?.budget;
  const h = data?.health.search;
  const p = data?.perf;
  const f = data?.flags;
  const searchPct = b && b.total_cap > 0 ? (b.search.calls / b.total_cap) * 100 : 0;
  const chatPct = b && b.total_cap > 0 ? (b.chat.calls / b.total_cap) * 100 : 0;
  const overBudget = b ? b.pct >= 0.8 : false;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Gauge size={22} className="text-blue-600" />
          Ops Dashboard
          {data && <span className="text-sm font-normal text-slate-400">{data.ymd} (เวลาไทย)</span>}
        </h1>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-gray-200 text-sm font-bold text-slate-600 hover:bg-gray-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          รีเฟรช
        </button>
      </div>
      {data && (
        <p className="text-xs text-slate-400 -mt-3">
          อัปเดตล่าสุด {new Date(data.generated_at).toLocaleTimeString('th-TH')} · รีเฟรชเองทุก 60 วินาที
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {!data && loading && <div className="text-sm text-slate-400">กำลังโหลด...</div>}

      {b && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-end justify-between mb-2">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">งบ AI วันนี้</h2>
            <div className={`text-3xl font-bold tabular-nums ${overBudget ? 'text-red-600' : 'text-slate-900'}`}>
              {Math.round(b.pct * 100)}%
            </div>
          </div>
          {/* หลอดเดียว สองสี — search (น้ำเงิน) + chat (ม่วง) เทียบเพดานรวม */}
          <div className="h-6 rounded-full bg-gray-100 overflow-hidden flex">
            <div className="bg-blue-500 h-full" style={{ width: `${Math.min(100, searchPct)}%` }} />
            <div className="bg-violet-500 h-full" style={{ width: `${Math.min(100 - Math.min(100, searchPct), chatPct)}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              <span className="text-slate-600">
                search <b className="tabular-nums">{b.search.calls.toLocaleString()}</b> / {b.search.cap.toLocaleString()} ·{' '}
                {usd(b.search.cost_usd)}
                {b.search.cost_basis === 'estimate' && <span className="text-slate-400"> (ประมาณ)</span>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500 shrink-0" />
              <span className="text-slate-600">
                chat <b className="tabular-nums">{b.chat.calls.toLocaleString()}</b> / {b.chat.cap.toLocaleString()} ·{' '}
                {b.chat.cost_basis === 'none' ? '—' : usd(b.chat.cost_usd)}
              </span>
            </div>
            <div className="text-slate-900 font-bold sm:text-right">
              รวม ~{usd(b.total_cost_usd)} วันนี้
              <span className="block text-[11px] font-normal text-slate-400">จาก token จริงเมื่อมี ไม่งั้นประมาณจากจำนวน call</span>
            </div>
          </div>
        </section>
      )}

      {h && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">
            สุขภาพคำตอบวันนี้ <span className="normal-case font-normal">(search — แชทยังไม่มี archive รายคำตอบ)</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label="ตอบสำเร็จ" value={h.answered} />
            <Stat label="ปฏิเสธ (ทุกเหตุผล)" value={h.skipped_total} />
            <Stat label="กู้จาก reply ขาด (salvaged)" value={h.salvaged} alert={h.salvaged > 0} />
            <Stat label="ตัดประโยคที่ผิดกฎ (excised)" value={h.excised_answers} alert={h.excised_answers > 0} />
            <Stat label="parse ไม่ได้เลย" value={h.unparseable} alert={h.unparseable > 0} />
          </div>
          {(h.skipped_total > 0 || Object.keys(h.gate).length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {Object.entries(h.skipped).map(([reason, n]) => (
                <span key={reason} className="px-2 py-0.5 rounded-full bg-gray-100 text-slate-600">
                  {reason}: {n}
                </span>
              ))}
              {Object.entries(h.gate).map(([reason, n]) => (
                <span key={`g-${reason}`} className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                  ก่อนถึงระบบ · {reason}: {n}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {p && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">ประสิทธิภาพ</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Stat label={`cache hit (${p.cache_hits}/${p.cache_hits + p.generated})`} value={pctText(p.cache_hit_rate)} />
            <Stat label="เขียนคำตอบ p50" value={ms(p.latency_p50)} />
            <Stat label="เขียนคำตอบ p95" value={ms(p.latency_p95)} />
            <Stat label="extract p50 (v2)" value={ms(p.extract_p50)} />
            <Stat
              label={`โดน rate limit ชั่วโมงนี้ (วันนี้ ${p.rate_limited_today})`}
              value={p.rate_limited_this_hour}
              alert={p.rate_limited_this_hour > 0}
            />
          </div>
        </section>
      )}

      {f && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">สถานะตอนนี้</h2>
          <div className="flex flex-wrap gap-2">
            <Chip ok={f.assistant_enabled} label={f.assistant_enabled ? 'ผู้ช่วย AI เปิด' : 'ผู้ช่วย AI ปิด'} />
            <Chip ok={!f.ai_suspended} label={f.ai_suspended ? 'SUSPENDED' : 'ไม่ถูก suspend'} />
            <Chip ok={f.search_overview_key_set} label="SEARCH_OVERVIEW_KEY" />
            <Chip ok={f.anthropic_key_set} label="ANTHROPIC_API_KEY" />
            {/* SEARCH_OVERVIEW_V2 เป็น env ฝั่ง Vercel — ฝั่งนี้อ่านไม่ได้
                จึงรายงาน "ความจริงที่สังเกตได้": วันนี้คำตอบวิ่ง pipeline ไหน */}
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border bg-blue-50 text-blue-700 border-blue-100">
              v2 ตอบวันนี้ {f.v2_answers_today} · v1 ตอบ {f.v1_answers_today}
            </span>
          </div>
          {f.ai_suspended && (
            <p className="mt-3 text-sm text-red-600">
              เหตุ: {f.ai_suspended_reason || 'ไม่ระบุ'}
              {f.ai_suspended_at ? ` · ตั้งแต่ ${new Date(f.ai_suspended_at).toLocaleString('th-TH')}` : ''}
            </p>
          )}
          <p className="mt-3 text-xs text-slate-400">
            โมเดล: writer {f.overview_model} · extract {f.extract_model} · chat {f.chat_model}
            {f.last_model_fallback ? ' · มีการ fallback โมเดลวันนี้' : ''}
          </p>
        </section>
      )}
    </div>
  );
}
