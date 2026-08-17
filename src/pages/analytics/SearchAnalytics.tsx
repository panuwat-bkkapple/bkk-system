// Search Analytics dashboard (/analytics/search) — CEO/MANAGER
//
// ตอบสามคำถามที่เจ้าของงานตั้งไว้ ตามลำดับนั้น:
//   1. ลูกค้าค้นหาอะไร        — top queries, คำที่ไม่มีผลลัพธ์, ช่องทางที่มา
//   2. ระบบตอบอะไรกลับไป      — overview ที่เขียนจริง, รุ่นที่เจอ, เลขที่ยืนยันไม่ได้
//   3. ลูกค้าทำอะไรต่อ         — คลิก, และการค้นหาที่ตามด้วยออเดอร์จริง
//
// ข้อมูลทั้งหมดมาจาก callable `adminSearchAnalytics` ตัวเดียว — หน้านี้ไม่มี
// สิทธิ์อ่าน Firestore เอง (firestore.rules ปิดทุก path) และนั่นคือดีไซน์
// ไม่ใช่ข้อจำกัดชั่วคราว
//
// ไม่มีไทม์ไลน์รายคนในหน้านี้โดยตั้งใจ — Session Monitor ของเว็บลูกค้าทำเรื่อง
// นั้นอยู่แล้ว การสร้างตัวที่สองคือการมีสองที่ที่ต้องแก้เวลา event เปลี่ยน

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import {
  Search, Loader2, RefreshCcw, AlertTriangle, MessageSquareQuote,
  MousePointerClick, TrendingUp, Ban, Sparkles, ExternalLink, ShieldQuestion,
} from 'lucide-react';

interface Counted { key: string; count: number }
interface DayRow {
  day: string; searches: number; questions: number; no_results: number;
  generated: number; clicks: number; orders: number;
}
interface Payload {
  enabled: boolean;
  reason?: string;
  range_days?: number;
  generated_at?: number;
  truncated?: { events: boolean; outcomes: boolean; uid_lookups: boolean };
  totals?: {
    searches: number; questions: number; no_results: number; generated: number;
    cached: number; refined: number; rescued: number; redacted: number;
    unverified: number; clicks: number; searches_with_click: number;
    with_uid: number; searches_with_order: number;
    question_searches: number; question_searches_with_order: number;
  };
  by_day?: DayRow[];
  by_channel?: Counted[];
  by_entry_channel?: Counted[];
  clicks_by_kind?: Counted[];
  top_queries?: Counted[];
  zero_result_queries?: Counted[];
  top_models?: Counted[];
  topics?: Counted[];
  unverified_samples?: { q: string; numbers: string[]; at: number }[];
  overview_samples?: { q: string; summary: string; cached: boolean; at: number }[];
}

const RANGES = [7, 30, 90];

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

const CHANNEL_LABEL: Record<string, string> = {
  ai_assistant: 'AI Assistant',
  organic: 'Search engine',
  social: 'Social',
  referral: 'เว็บอื่น',
  internal: 'หน้าอื่นในเว็บเรา',
  direct: 'เข้าตรง',
};

const CLICK_LABEL: Record<string, string> = {
  sell_click: 'กดขายเลย',
  model_page_click: 'เปิดหน้ารุ่น',
  page_click: 'เปิดหน้าของเรา',
  article_click: 'เปิดบทความ',
  overview_cta: 'กดปุ่มใต้คำตอบ AI',
  browse_all: 'ไปดูรุ่นทั้งหมด',
};

function Stat({
  label, value, sub, icon, tone = 'slate',
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  tone?: 'slate' | 'blue' | 'emerald' | 'amber';
}) {
  const tones = {
    slate: 'text-slate-600 bg-slate-50 border-slate-200',
    blue: 'text-blue-700 bg-blue-50 border-blue-200',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    amber: 'text-amber-700 bg-amber-50 border-amber-200',
  };
  return (
    <div className={`rounded-2xl border p-5 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider opacity-70">
        {icon} {label}
      </div>
      <p className="text-2xl font-black mt-2 text-slate-900">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-80">{sub}</p>}
    </div>
  );
}

function CountTable({
  title, rows, empty, labelMap, note,
}: {
  title: string; rows: Counted[]; empty: string;
  labelMap?: Record<string, string>; note?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
      {note && <p className="text-xs text-slate-500 mb-3">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-4">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-slate-700 break-words min-w-0">
                {labelMap?.[r.key] || r.key}
              </span>
              <span className="text-sm font-bold text-slate-900 shrink-0">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchAnalytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminSearchAnalytics');
      const res = await fn({ days });
      setData(res.data as Payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const conversion = useMemo(() => {
    if (!t) return null;
    // ตัวหารคือการค้นหาที่ "รู้ว่าเป็นใคร" เท่านั้น — การค้นหาที่ไม่มี uid
    // join กับออเดอร์ไม่ได้เลย การเอามารวมในตัวหารจะทำให้ conversion ดูต่ำ
    // กว่าความจริงโดยไม่มีใครรู้ว่าต่ำเพราะอะไร
    const base = t.with_uid;
    return {
      base,
      rate: pct(t.searches_with_order, base),
      questionRate: pct(t.question_searches_with_order, t.question_searches),
    };
  }, [t]);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Search size={28} className="text-[#144EE3]" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Search Analytics</h1>
            <p className="text-sm text-slate-500">
              ลูกค้าค้นหาอะไร ระบบตอบอะไร แล้วเขาทำอะไรต่อ
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border ${
                days === d
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {d} วัน
            </button>
          ))}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded-lg text-sm font-bold bg-white border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* ยังไม่เปิดฐานข้อมูล / ยังไม่ตั้งสวิตช์ — บอกวิธีเปิดตรงนี้เลย
          ดีกว่าปล่อยให้หน้าว่างแล้วเดาว่าไม่มีคนค้นหา */}
      {data && !data.enabled && (
        <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
          <p className="font-bold mb-1">ยังไม่ได้เปิดใช้งานการเก็บข้อมูล</p>
          <p className="text-sm">
            ต้องสร้าง Firestore (asia-southeast1) + deploy firestore rules/indexes จาก
            repo bkk-frontend-next + ตั้ง TTL policy + ตั้ง env{' '}
            <code className="px-1 bg-white/60 rounded">SEARCH_ANALYTICS_ENABLED=1</code>{' '}
            บน Vercel
          </p>
          {data.reason && <p className="text-xs mt-2 opacity-70">รายละเอียด: {data.reason}</p>}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
          <Loader2 className="animate-spin" size={20} /> กำลังโหลด...
        </div>
      )}

      {data?.enabled && t && (
        <>
          {(data.truncated?.events || data.truncated?.outcomes || data.truncated?.uid_lookups) && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              ข้อมูลถูกตัดเพราะชนเพดานต่อการเรียกหนึ่งครั้ง — ตัวเลขในหน้านี้ต่ำกว่าความจริง
              ให้ลดช่วงวันลงเพื่อดูภาพที่ครบ
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat
              icon={<Search size={14} />} label="การค้นหา"
              value={t.searches.toLocaleString()}
              sub={`เฉลี่ย ${(t.searches / (data.range_days || 1)).toFixed(0)} ครั้ง/วัน`}
            />
            <Stat
              icon={<MessageSquareQuote size={14} />} label="เป็นคำถาม" tone="blue"
              value={pct(t.questions, t.searches)}
              sub={`${t.questions} ครั้ง · ตอบด้วย AI ${t.generated} (จาก cache ${t.cached})`}
            />
            <Stat
              icon={<Ban size={14} />} label="ไม่พบผลลัพธ์" tone="amber"
              value={pct(t.no_results, t.searches)}
              sub={`${t.no_results} ครั้ง — ดูตารางคำที่ไม่มีผลลัพธ์ด้านล่าง`}
            />
            <Stat
              icon={<TrendingUp size={14} />} label="ค้นแล้วได้ออเดอร์" tone="emerald"
              value={conversion?.rate || '—'}
              sub={`${t.searches_with_order} จาก ${conversion?.base || 0} การค้นหาที่ระบุผู้ใช้ได้`}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Stat
              icon={<MousePointerClick size={14} />} label="มีการคลิกต่อ"
              value={pct(t.searches_with_click, t.searches)}
              sub={`${t.clicks} คลิก จาก ${t.searches_with_click} การค้นหา`}
            />
            <Stat
              icon={<Sparkles size={14} />} label="คำถามที่จบเป็นออเดอร์"
              value={conversion?.questionRate || '—'}
              sub={`เทียบกับคำค้นทั่วไป — ตัวเลขที่บอกว่าควรลงทุนกับ AI ต่อไหม`}
            />
            <Stat
              icon={<RefreshCcw size={14} />} label="ค้นต่อยอด (refinement)"
              value={t.refined.toLocaleString()}
              sub={`กู้จากหน้าเปล่าได้ ${t.rescued} ครั้ง`}
            />
            <Stat
              icon={<ShieldQuestion size={14} />} label="เลขที่ยืนยันไม่ได้" tone={t.unverified > 0 ? 'amber' : 'slate'}
              value={t.unverified.toLocaleString()}
              sub="AI พูดตัวเลขที่ context อธิบายไม่ได้"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <CountTable
              title="คำที่ค้นบ่อยที่สุด" rows={data.top_queries || []}
              empty="ยังไม่มีข้อมูล"
              note="ข้อความผ่านการลบข้อมูลระบุตัวตนแล้ว ([PHONE] [EMAIL] ฯลฯ คือส่วนที่ถูกลบ)"
            />
            <CountTable
              title="คำที่ค้นแล้วไม่เจออะไรเลย" rows={data.zero_result_queries || []}
              empty="ไม่มี — ทุกคำค้นเจอผลลัพธ์"
              note="ตารางที่บอกตรงๆ ว่าควรเพิ่มรุ่นอะไร เขียนหน้าอะไร หรือ matcher พลาดตรงไหน"
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mb-4">
            <CountTable
              title="ช่องทางที่มา (ของ request นี้)" rows={data.by_channel || []}
              empty="ยังไม่มีข้อมูล" labelMap={CHANNEL_LABEL}
              note="server เห็นได้แค่หน้าก่อนหน้า — มาจากหน้าอื่นในเว็บเรา = internal"
            />
            <CountTable
              title="ช่องทางที่เข้าเว็บครั้งแรก" rows={data.by_entry_channel || []}
              empty="ยังไม่มีข้อมูล" labelMap={CHANNEL_LABEL}
              note="ตัวจริงของคำถาม 'AI ส่งคนมาไหม' — คนที่ ChatGPT ส่งมาแล้วเดินในเว็บก่อนค้นจะอยู่ตรงนี้ ไม่ใช่ตารางซ้าย"
            />
            <CountTable
              title="ทำอะไรต่อ" rows={data.clicks_by_kind || []}
              empty="ยังไม่มีการคลิก" labelMap={CLICK_LABEL}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            <CountTable
              title="รุ่นที่โผล่ในผลค้นหาบ่อยที่สุด" rows={data.top_models || []}
              empty="ยังไม่มีข้อมูล"
            />
            <CountTable
              title="คำถามเรื่องร้าน (ไม่ใช่เรื่องเครื่อง)" rows={data.topics || []}
              empty="ยังไม่มี" note="ตัวหารของงาน service facts"
            />
          </div>

          {/* ชั้นที่ไม่มีใน log เดิมเลย: คำตอบที่ AI เขียนจริง */}
          {(data.overview_samples?.length || 0) > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
              <h3 className="font-bold text-slate-900 mb-1">คำตอบที่ AI ตอบไปจริง</h3>
              <p className="text-xs text-slate-500 mb-4">
                ชั้นนี้ไม่เคยมีใน log เดิม — &quot;generate แล้ว&quot; บอกไม่ได้ว่าคำตอบดีหรือไม่
              </p>
              <ul className="space-y-3">
                {data.overview_samples!.map((s, i) => (
                  <li key={i} className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-sm font-bold text-slate-900 break-words">{s.q}</span>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {s.cached ? 'จาก cache' : 'เรียก AI จริง'} · {fmtDateTime(s.at)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{s.summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.unverified_samples?.length || 0) > 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 p-5 mb-4">
              <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                ตัวเลขที่ AI พูดแต่ context อธิบายไม่ได้
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                หมายเหตุ: คำถามเรื่องบริการ (ค่าส่ง/สาขา) จะขึ้นตรงนี้ได้แม้ตัวเลขถูก —
                เพราะ Cloud Function โหลดข้อเท็จจริงเพิ่มเองฝั่งนั้น ซึ่งตัวตรวจฝั่งเว็บมองไม่เห็น
              </p>
              <ul className="space-y-2">
                {data.unverified_samples!.map((s, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 text-sm py-2 border-b border-slate-100 last:border-0">
                    <span className="text-slate-700 break-words">{s.q}</span>
                    <span className="font-mono text-xs text-amber-700 shrink-0">
                      {s.numbers.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="font-bold text-slate-900 mb-3">รายวัน</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <th className="py-2 pr-4">วัน</th>
                    <th className="py-2 pr-4 text-right">ค้นหา</th>
                    <th className="py-2 pr-4 text-right">คำถาม</th>
                    <th className="py-2 pr-4 text-right">ไม่พบ</th>
                    <th className="py-2 pr-4 text-right">AI ตอบ</th>
                    <th className="py-2 pr-4 text-right">คลิก</th>
                    <th className="py-2 text-right">ออเดอร์</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_day || []).map((d) => (
                    <tr key={d.day} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-slate-700">{d.day}</td>
                      <td className="py-2 pr-4 text-right">{d.searches}</td>
                      <td className="py-2 pr-4 text-right">{d.questions}</td>
                      <td className="py-2 pr-4 text-right">{d.no_results}</td>
                      <td className="py-2 pr-4 text-right">{d.generated}</td>
                      <td className="py-2 pr-4 text-right">{d.clicks}</td>
                      <td className="py-2 text-right font-bold text-emerald-700">{d.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 space-y-1.5">
            <p>
              <strong>การนับออเดอร์:</strong> จับคู่จากรหัสผู้ใช้นิรนามที่สั่งซื้อภายใน 24 ชม.
              หลังการค้นหา — ไม่ใช่การติดตามรายบุคคล และไม่ได้ผูกกับตัวตนจริงของลูกค้า
            </p>
            <p>
              <strong>ข้อมูลเก็บ 90 วัน</strong> แล้วลบอัตโนมัติ · คำค้นผ่านการลบข้อมูลระบุตัวตน
              ก่อนบันทึกเสมอ ({t.redacted} คำค้นในช่วงนี้มีข้อมูลถูกลบออก)
            </p>
            <p className="flex items-center gap-1.5">
              <ExternalLink size={12} />
              ดูไทม์ไลน์รายคน (ทำอะไรต่อหลังค้นหา) ที่ Session Monitor ของเว็บลูกค้า —
              หน้านี้ไม่ทำซ้ำโดยตั้งใจ
            </p>
            {data.generated_at && (
              <p className="opacity-70">อัปเดตเมื่อ {fmtDateTime(data.generated_at)}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SearchAnalytics;
