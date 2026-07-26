import { useEffect, useMemo, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  MessageSquare, Timer, ShieldCheck, ArrowRightLeft, RefreshCcw,
  Star, ThumbsUp, GraduationCap, ClipboardCheck,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';

// =============================================================================
// Chat Analytics & SLA Dashboard (/chat-analytics) — CEO + MANAGER
// เปรียบเทียบประสิทธิภาพ AI Assistant vs Human Admin จากข้อมูลแชทจริง (inbox/*)
// ทั้งหมดคำนวณฝั่ง client จาก messages ของแต่ละบทสนทนา — ไม่มี mock data.
// ดีไซน์: corporate/minimal — พื้นขาว เทา slate เข้ม navy, เส้นขอบบาง,
// สีสถานะมาตรฐาน (เขียว=ผ่าน แดง=หลุด SLA) — ห้ามธีมล้ำยุค/นีออน
// =============================================================================

// SLA targets (วินาที) — เกณฑ์ตอบครั้งแรกนับจากข้อความแรกของลูกค้า
const SLA_AI_FIRST_RESPONSE_SEC = 120; // AI ต้องตอบภายใน 2 นาที
const SLA_ADMIN_FIRST_RESPONSE_SEC = 900; // เจ้าหน้าที่ภายใน 15 นาที

interface ConvoMetric {
  id: string;
  name: string;
  createdAt: number;
  firstCustomerAt: number | null;
  firstAiReplySec: number | null; // first AI reply after first customer msg
  firstAdminReplySec: number | null; // first human-admin reply
  handledBy: 'AI' | 'Admin';
  waitSec: number | null; // first response of the party that handled it
  resolutionMin: number | null; // createdAt -> last message, resolved only
  resolved: boolean;
  escalated: boolean;
  slaBreached: boolean;
  csatScore: number | null; // service rating the customer left (1-5)
}

interface FeedbackRec { rating: 'good' | 'bad'; at: number; taught: boolean }

const fmtSec = (s: number | null) =>
  s == null ? '—' : s < 60 ? `${Math.round(s)} วิ` : `${(s / 60).toFixed(1)} นาที`;
const fmtMin = (m: number | null) => (m == null ? '—' : m < 60 ? `${Math.round(m)} นาที` : `${(m / 60).toFixed(1)} ชม.`);
const dayKey = (ts: number) => {
  const d = new Date(ts + 7 * 3600 * 1000); // Bangkok day
  return d.toISOString().slice(5, 10); // MM-DD
};

export function ChatAnalytics() {
  const [metrics, setMetrics] = useState<ConvoMetric[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await get(ref(db, 'inbox'));
        if (!snap.exists()) { if (!cancelled) setMetrics([]); return; }
        const out: ConvoMetric[] = [];
        const entries = Object.entries(snap.val() as Record<string, any>)
          .filter(([, v]) => v && (v.type || 'customer') === 'customer');
        for (const [id, v] of entries) {
          const msgs = Object.values((v.messages || {}) as Record<string, any>)
            .filter((m) => m && Number(m.timestamp) > 0)
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
          const firstCustomer = msgs.find((m) => m.senderRole === 'customer');
          const firstCustomerAt = firstCustomer ? Number(firstCustomer.timestamp) : null;
          let firstAiReplySec: number | null = null;
          let firstAdminReplySec: number | null = null;
          let adminTouched = false;
          if (firstCustomerAt != null) {
            for (const m of msgs) {
              const ts = Number(m.timestamp);
              if (ts <= firstCustomerAt) continue;
              if (m.senderRole === 'ai' && firstAiReplySec == null) firstAiReplySec = (ts - firstCustomerAt) / 1000;
              if (m.senderRole === 'admin') {
                adminTouched = true;
                if (firstAdminReplySec == null) firstAdminReplySec = (ts - firstCustomerAt) / 1000;
              }
            }
          }
          const handledBy: 'AI' | 'Admin' = adminTouched ? 'Admin' : 'AI';
          const waitSec = handledBy === 'Admin'
            ? (firstAdminReplySec ?? firstAiReplySec)
            : firstAiReplySec;
          const resolved = v.status === 'resolved';
          const createdAt = Number(v.createdAt) || firstCustomerAt || 0;
          const lastAt = Number(v.lastMessageAt) || createdAt;
          const escalated = !!v.escalation || v.status === 'waiting_human' || v.status === 'human';
          const slaTarget = handledBy === 'Admin' ? SLA_ADMIN_FIRST_RESPONSE_SEC : SLA_AI_FIRST_RESPONSE_SEC;
          const slaBreached = waitSec == null ? firstCustomerAt != null : waitSec > slaTarget;
          out.push({
            id,
            name: v.customer_name || v.name || 'ไม่ระบุชื่อ',
            createdAt,
            firstCustomerAt,
            firstAiReplySec,
            firstAdminReplySec,
            handledBy,
            waitSec,
            resolutionMin: resolved && lastAt > createdAt ? (lastAt - createdAt) / 60000 : null,
            resolved,
            escalated,
            slaBreached,
            csatScore: v.csat && Number(v.csat.score) >= 1 ? Number(v.csat.score) : null,
          });
        }
        out.sort((a, b) => b.createdAt - a.createdAt);
        if (!cancelled) setMetrics(out);
        // Per-answer thumbs feedback from the console (rate -> coach -> learn)
        try {
          const fbSnap = await get(ref(db, 'chat_feedback'));
          const fb: FeedbackRec[] = fbSnap.exists()
            ? Object.values(fbSnap.val() as Record<string, any>)
                .filter((f) => f && (f.rating === 'good' || f.rating === 'bad'))
                .map((f) => ({ rating: f.rating, at: Number(f.at) || 0, taught: f.taught === true }))
            : [];
          if (!cancelled) setFeedback(fb);
        } catch { /* feedback stats are additive — never block the page */ }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const kpi = useMemo(() => {
    const withCustomer = metrics.filter((m) => m.firstCustomerAt != null);
    const aiTimes = withCustomer.map((m) => m.firstAiReplySec).filter((s): s is number => s != null);
    const adminTimes = withCustomer.map((m) => m.firstAdminReplySec).filter((s): s is number => s != null);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const measurable = withCustomer.filter((m) => m.waitSec != null);
    const onTime = measurable.filter((m) => !m.slaBreached).length;
    return {
      total: withCustomer.length,
      avgAi: avg(aiTimes),
      avgAdmin: avg(adminTimes),
      slaRate: measurable.length ? (onTime / measurable.length) * 100 : null,
      handover: withCustomer.length
        ? (withCustomer.filter((m) => m.escalated).length / withCustomer.length) * 100
        : null,
    };
  }, [metrics]);

  // 7-day trend: avg first-response by day, AI vs Admin
  const trendData = useMemo(() => {
    const days: { key: string; ai: number[]; admin: number[] }[] = [];
    for (let i = 6; i >= 0; i--) {
      const ts = Date.now() - i * 86400000;
      days.push({ key: dayKey(ts), ai: [], admin: [] });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    metrics.forEach((m) => {
      const d = byKey.get(dayKey(m.createdAt));
      if (!d) return;
      if (m.firstAiReplySec != null) d.ai.push(m.firstAiReplySec);
      if (m.firstAdminReplySec != null) d.admin.push(m.firstAdminReplySec);
    });
    return days.map((d) => ({
      day: d.key,
      AI: d.ai.length ? Number((d.ai.reduce((x, y) => x + y, 0) / d.ai.length / 60).toFixed(2)) : null,
      Admin: d.admin.length ? Number((d.admin.reduce((x, y) => x + y, 0) / d.admin.length / 60).toFixed(2)) : null,
    }));
  }, [metrics]);

  // Resolution volume: resolved conversations per day, split by who handled
  const volumeData = useMemo(() => {
    const days: { key: string; ai: number; admin: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const ts = Date.now() - i * 86400000;
      days.push({ key: dayKey(ts), ai: 0, admin: 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    metrics.forEach((m) => {
      if (!m.resolved) return;
      const d = byKey.get(dayKey(m.createdAt));
      if (!d) return;
      if (m.handledBy === 'Admin') d.admin += 1; else d.ai += 1;
    });
    return days.map((d) => ({ day: d.key, 'AI ปิดเอง': d.ai, 'เจ้าหน้าที่ปิด': d.admin }));
  }, [metrics]);

  // คุณภาพคำตอบ + CSAT
  const quality = useMemo(() => {
    const scores = metrics.map((m) => m.csatScore).filter((x): x is number => x != null);
    const resolvedCount = metrics.filter((m) => m.resolved).length;
    const good = feedback.filter((f) => f.rating === 'good').length;
    const bad = feedback.filter((f) => f.rating === 'bad').length;
    const pendingTeach = feedback.filter((f) => f.rating === 'bad' && !f.taught).length;
    return {
      csatAvg: scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null,
      csatCount: scores.length,
      csatResponseRate: resolvedCount ? (scores.length / resolvedCount) * 100 : null,
      goodRate: good + bad > 0 ? (good / (good + bad)) * 100 : null,
      rated: good + bad,
      pendingTeach,
    };
  }, [metrics, feedback]);

  const csatDist = useMemo(() => {
    const dist = [1, 2, 3, 4, 5].map((n) => ({ score: `${n} ดาว`, 'จำนวนรีวิว': 0 }));
    metrics.forEach((m) => {
      if (m.csatScore != null && m.csatScore >= 1 && m.csatScore <= 5) dist[m.csatScore - 1]['จำนวนรีวิว'] += 1;
    });
    return dist;
  }, [metrics]);

  const feedbackTrend = useMemo(() => {
    const days: { key: string; good: number; bad: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const ts = Date.now() - i * 86400000;
      days.push({ key: dayKey(ts), good: 0, bad: 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    feedback.forEach((f) => {
      const d = byKey.get(dayKey(f.at));
      if (!d) return;
      if (f.rating === 'good') d.good += 1; else d.bad += 1;
    });
    return days.map((d) => ({ day: d.key, 'ตอบดี': d.good, 'ต้องสอน': d.bad }));
  }, [feedback]);

  const recent = metrics.filter((m) => m.firstCustomerAt != null).slice(0, 25);

  if (loading) {
    return <div className="p-10 text-center text-slate-400 font-bold animate-pulse">กำลังคำนวณสถิติจากบทสนทนาจริง...</div>;
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6 bg-white min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Chat Analytics & SLA</h1>
          <p className="text-xs text-slate-500 mt-1">
            เปรียบเทียบประสิทธิภาพ AI Assistant กับเจ้าหน้าที่ จากบทสนทนาจริงทั้งหมด · เกณฑ์ SLA ตอบครั้งแรก: AI {SLA_AI_FIRST_RESPONSE_SEC / 60} นาที · เจ้าหน้าที่ {SLA_ADMIN_FIRST_RESPONSE_SEC / 60} นาที
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 border border-slate-300 rounded-md hover:bg-slate-50"
        >
          <RefreshCcw size={13} /> โหลดข้อมูลใหม่
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={<MessageSquare size={16} />}
          label="บทสนทนาทั้งหมด"
          value={String(kpi.total)}
          sub="เฉพาะแชทลูกค้าที่มีข้อความจริง"
        />
        <KpiCard
          icon={<Timer size={16} />}
          label="เวลาตอบครั้งแรกเฉลี่ย"
          value={fmtSec(kpi.avgAi)}
          sub={`AI · เจ้าหน้าที่ ${fmtSec(kpi.avgAdmin)}`}
        />
        <KpiCard
          icon={<ShieldCheck size={16} />}
          label="อัตราผ่าน SLA"
          value={kpi.slaRate == null ? '—' : `${kpi.slaRate.toFixed(1)}%`}
          sub="ตอบครั้งแรกภายในเกณฑ์"
          tone={kpi.slaRate != null && kpi.slaRate < 90 ? 'bad' : 'good'}
        />
        <KpiCard
          icon={<ArrowRightLeft size={16} />}
          label="อัตราส่งต่อเจ้าหน้าที่"
          value={kpi.handover == null ? '—' : `${kpi.handover.toFixed(1)}%`}
          sub="แชทที่ AI ส่งต่อ (Handover Rate)"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-bold text-slate-800">แนวโน้มเวลาตอบครั้งแรก (นาที)</h2>
          <p className="text-[11px] text-slate-400 mb-3">7 วันล่าสุด · AI เทียบเจ้าหน้าที่ · ค่าเฉลี่ยรายวัน</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip formatter={(v) => [v == null ? '—' : `${v} นาที`, '']} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="AI" stroke="#1e3a8a" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="Admin" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-bold text-slate-800">ปริมาณแชทที่ปิดจบ</h2>
          <p className="text-[11px] text-slate-400 mb-3">7 วันล่าสุด · แยกตามผู้ดูแลหลักของบทสนทนา</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="AI ปิดเอง" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
                <Bar dataKey="เจ้าหน้าที่ปิด" fill="#94a3b8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* คุณภาพคำตอบ & CSAT */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={<Star size={16} />}
          label="CSAT เฉลี่ย (ลูกค้าให้คะแนน)"
          value={quality.csatAvg == null ? '—' : `${quality.csatAvg.toFixed(2)} / 5`}
          sub={`จาก ${quality.csatCount} รีวิวหลังปิดจ็อบ`}
          tone={quality.csatAvg != null && quality.csatAvg < 4 ? 'bad' : 'good'}
        />
        <KpiCard
          icon={<ClipboardCheck size={16} />}
          label="อัตราการให้คะแนน"
          value={quality.csatResponseRate == null ? '—' : `${quality.csatResponseRate.toFixed(1)}%`}
          sub="สัดส่วนแชทปิดจ็อบที่ลูกค้ากลับมาให้คะแนน"
        />
        <KpiCard
          icon={<ThumbsUp size={16} />}
          label="คำตอบ AI ที่ทีมรีวิวว่าดี"
          value={quality.goodRate == null ? '—' : `${quality.goodRate.toFixed(1)}%`}
          sub={`จากคำตอบที่ถูกรีวิว ${quality.rated} รายการ`}
          tone={quality.goodRate != null && quality.goodRate < 80 ? 'bad' : 'good'}
        />
        <KpiCard
          icon={<GraduationCap size={16} />}
          label="คิวสอนค้าง"
          value={String(quality.pendingTeach)}
          sub="คำตอบที่กดไม่ดีแล้วยังไม่ได้สอน (จัดการที่คลังคำตอบ AI)"
          tone={quality.pendingTeach > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-bold text-slate-800">การกระจายคะแนน CSAT</h2>
          <p className="text-[11px] text-slate-400 mb-3">คะแนนบริการจากลูกค้าหลังปิดจ็อบ (1-5 ดาว) ทั้งหมด</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={csatDist} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="score" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Bar dataKey="จำนวนรีวิว" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-bold text-slate-800">รีวิวคำตอบ AI โดยทีมงาน</h2>
          <p className="text-[11px] text-slate-400 mb-3">7 วันล่าสุด · ตอบดี เทียบ ต้องสอน (จากปุ่มให้คะแนนในหน้าแชท)</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={feedbackTrend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ตอบดี" stackId="fb" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
                <Bar dataKey="ต้องสอน" stackId="fb" fill="#dc2626" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* SLA Table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-800">สถานะ SLA รายบทสนทนา (ล่าสุด {recent.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-200">
                <th className="px-4 py-2.5 font-semibold">Ticket</th>
                <th className="px-4 py-2.5 font-semibold">ลูกค้า</th>
                <th className="px-4 py-2.5 font-semibold">ผู้ดูแล</th>
                <th className="px-4 py-2.5 font-semibold">เวลารอตอบครั้งแรก</th>
                <th className="px-4 py-2.5 font-semibold">เวลาปิดจบ</th>
                <th className="px-4 py-2.5 font-semibold">SLA</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-500">#{m.id.slice(-6).toUpperCase()}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-800">{m.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                      m.handledBy === 'AI'
                        ? 'bg-slate-50 text-blue-900 border-blue-200'
                        : 'bg-slate-50 text-slate-600 border-slate-300'
                    }`}>
                      {m.handledBy === 'AI' ? 'AI Assistant' : 'เจ้าหน้าที่'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{fmtSec(m.waitSec)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">{m.resolved ? fmtMin(m.resolutionMin) : 'ยังไม่ปิด'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      m.slaBreached ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
                    }`}>
                      {m.slaBreached ? 'Breached' : 'On Time'}
                    </span>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-400">ยังไม่มีบทสนทนา</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'good' | 'bad';
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 text-slate-500">
        <span className="text-slate-400">{icon}</span>
        <p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-2xl font-bold mt-2 ${
        tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-green-700' : 'text-slate-900'
      }`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}
