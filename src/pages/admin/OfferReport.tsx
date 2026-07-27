/* eslint-disable @typescript-eslint/no-explicit-any */
// รายงาน Make Offer (ลูกค้าเสนอราคาเอง) — /offer-report (CEO/MANAGER)
//
// วัดผล conversion ของฟีเจอร์: อัตรารับข้อเสนอ, ส่วนต่างที่ลูกค้าขอ (delta %),
// เวลาตอบสนอง, และตารางรายรุ่นไว้ใช้จูน offerMaxPct / auto_accept_pct.
// อ่านจาก shared jobs store (useDatabase('jobs') — listener กลางตัวเดียวของ
// แอดมินทั้งแอป ไม่เพิ่มค่า download RTDB). งานที่ archive แล้ว (>90 วัน)
// ไม่รวมในรายงาน — ช่วงเวลาที่เลือกได้จึงพอดีกับข้อมูลที่ยังอยู่ใน /jobs.
import React, { useMemo, useState } from 'react';
import { HandCoins, Clock, CheckCircle2, Percent, TrendingUp, Zap } from 'lucide-react';
import { useDatabase } from '@/hooks/useDatabase';
import { formatCurrency } from '@/utils/formatters';
import { customerOfferOf, OFFER_STATUS_LABEL_TH, type CustomerOfferData, type CustomerOfferStatus } from '@/utils/customerOffer';

const RANGE_OPTIONS = [
  { key: 7, label: '7 วัน' },
  { key: 30, label: '30 วัน' },
  { key: 90, label: '90 วัน' },
  { key: 0, label: 'ทั้งหมด' },
] as const;

const ACCEPTED_STATUSES: CustomerOfferStatus[] = ['auto_accepted', 'accepted', 'counter_accepted'];
// สถานะงานที่ถือว่าปิดดีลสำเร็จ (เงินจ่าย/เครื่องเข้าระบบแล้ว) — heuristic
// เดียวกับ hasBeenPaid ฝั่ง ticket
const PAID_LIKE = ['paid', 'payment completed', 'in stock', 'sent to qc lab', 'ready to sell', 'sold', 'completed', 'rider returning', 'waiting for handover'];

interface OfferRow {
  jobId: string;
  refNo: string;
  model: string;
  modelId: string;
  offer: CustomerOfferData;
  deltaPct: number;
  responseHrs: number | null;
  jobPaid: boolean;
}

const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString()}%`;

export default function OfferReport() {
  const { data: jobs, loading } = useDatabase('jobs');
  const [rangeDays, setRangeDays] = useState<number>(30);

  const rows: OfferRow[] = useMemo(() => {
    const cutoff = rangeDays > 0 ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : 0;
    const out: OfferRow[] = [];
    for (const job of (jobs as any[]) || []) {
      const offer = customerOfferOf(job);
      if (!offer) continue;
      if (cutoff && Number(offer.proposed_at) < cutoff) continue;
      const quote = Number(offer.quote_at_offer) || 0;
      const statusLower = String(job.status || '').trim().toLowerCase();
      out.push({
        jobId: job.id,
        refNo: job.ref_no || job.id,
        model: job.model || 'ไม่ระบุรุ่น',
        modelId: job.devices?.[0]?.model_id || job.model || '-',
        offer,
        deltaPct: quote > 0 ? ((Number(offer.amount) - quote) / quote) * 100 : 0,
        responseHrs:
          offer.decided_at && offer.proposed_at && offer.status !== 'auto_accepted'
            ? (offer.decided_at - offer.proposed_at) / 3600000
            : offer.status === 'auto_accepted' ? 0 : null,
        jobPaid: !!job.paid_at || PAID_LIKE.includes(statusLower),
      });
    }
    return out.sort((a, b) => Number(b.offer.proposed_at) - Number(a.offer.proposed_at));
  }, [jobs, rangeDays]);

  const kpi = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.offer.status === 'pending').length;
    const awaitingCustomer = rows.filter((r) => r.offer.status === 'countered').length;
    const decided = rows.filter((r) => !['pending', 'countered'].includes(r.offer.status));
    const accepted = rows.filter((r) => ACCEPTED_STATUSES.includes(r.offer.status));
    const autoAccepted = rows.filter((r) => r.offer.status === 'auto_accepted').length;
    const acceptRate = decided.length > 0 ? (accepted.length / decided.length) * 100 : 0;
    const avgDeltaAsked = total > 0 ? rows.reduce((s, r) => s + r.deltaPct, 0) / total : 0;
    // มูลค่าที่จ่ายเพิ่มจากราคาประเมินเพราะรับข้อเสนอ (ต้นทุนของ conversion)
    const uplift = accepted.reduce((s, r) => {
      const agreed = r.offer.status === 'counter_accepted' ? Number(r.offer.counter_amount) : Number(r.offer.amount);
      return s + Math.max(0, agreed - Number(r.offer.quote_at_offer));
    }, 0);
    const responseTimes = rows.map((r) => r.responseHrs).filter((v): v is number => v !== null && v > 0);
    const avgResponseHrs = responseTimes.length > 0 ? responseTimes.reduce((s, v) => s + v, 0) / responseTimes.length : 0;
    const paidOfferJobs = rows.filter((r) => r.jobPaid).length;
    return { total, pending, awaitingCustomer, decided: decided.length, accepted: accepted.length, autoAccepted, acceptRate, avgDeltaAsked, uplift, avgResponseHrs, paidOfferJobs };
  }, [rows]);

  const byModel = useMemo(() => {
    const map = new Map<string, { model: string; total: number; accepted: number; deltaSum: number }>();
    for (const r of rows) {
      const key = r.modelId;
      const cur = map.get(key) || { model: r.model, total: 0, accepted: 0, deltaSum: 0 };
      cur.total++;
      if (ACCEPTED_STATUSES.includes(r.offer.status)) cur.accepted++;
      cur.deltaSum += r.deltaPct;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v, acceptRate: v.total > 0 ? (v.accepted / v.total) * 100 : 0, avgDelta: v.total > 0 ? v.deltaSum / v.total : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const statusCounts = useMemo(() => {
    const counts = new Map<CustomerOfferStatus, number>();
    for (const r of rows) counts.set(r.offer.status, (counts.get(r.offer.status) || 0) + 1);
    return counts;
  }, [rows]);

  if (loading) return <div className="p-10 text-center font-black text-slate-400">กำลังโหลดข้อมูล...</div>;

  const kpiCard = (icon: React.ReactNode, label: string, value: string, sub?: string) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <div className="text-2xl font-black text-slate-800 mt-1.5 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] font-bold text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center"><HandCoins size={22} /></div>
          <div>
            <h1 className="text-xl font-black text-slate-800">รายงาน Make Offer</h1>
            <p className="text-xs font-bold text-slate-400">ลูกค้าเสนอราคาเอง — อัตรารับ, ส่วนต่าง, เวลาตอบ (เฉพาะงานที่ยังไม่ถูก archive)</p>
          </div>
        </div>
        <div className="flex gap-1.5 bg-white rounded-xl border border-slate-200 p-1">
          {RANGE_OPTIONS.map((o) => (
            <button key={o.key} onClick={() => setRangeDays(o.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-colors ${rangeDays === o.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpiCard(<HandCoins size={14} />, 'ข้อเสนอทั้งหมด', kpi.total.toLocaleString(), `รอตัดสิน ${kpi.pending} · รอลูกค้าตอบ ${kpi.awaitingCustomer}`)}
        {kpiCard(<CheckCircle2 size={14} />, 'อัตรารับข้อเสนอ', kpi.decided > 0 ? pct1(kpi.acceptRate) : '-', `รับ ${kpi.accepted}/${kpi.decided} ที่ตัดสินแล้ว · Auto ${kpi.autoAccepted}`)}
        {kpiCard(<Percent size={14} />, 'ส่วนต่างที่ขอเฉลี่ย', kpi.total > 0 ? `+${pct1(kpi.avgDeltaAsked)}` : '-', `จ่ายเพิ่มจริงรวม ${formatCurrency(kpi.uplift)}`)}
        {kpiCard(<Clock size={14} />, 'เวลาตอบเฉลี่ย', kpi.avgResponseHrs > 0 ? `${(Math.round(kpi.avgResponseHrs * 10) / 10).toLocaleString()} ชม.` : '-', `งาน offer ที่ปิดดีลแล้ว ${kpi.paidOfferJobs}`)}
      </div>

      {/* status breakdown */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[...statusCounts.entries()].map(([s, n]) => (
          <span key={s} className={`px-3 py-1.5 rounded-full text-[11px] font-black border ${
            ACCEPTED_STATUSES.includes(s) ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
            : s === 'pending' ? 'bg-amber-50 text-amber-600 border-amber-200'
            : s === 'countered' ? 'bg-blue-50 text-blue-600 border-blue-200'
            : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
            {OFFER_STATUS_LABEL_TH[s]} · {n}
          </span>
        ))}
        {rows.length === 0 && <span className="text-sm font-bold text-slate-400">ยังไม่มีข้อเสนอในช่วงเวลานี้</span>}
      </div>

      {/* per-model table */}
      {byModel.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <TrendingUp size={15} className="text-slate-400" />
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">รายรุ่น — ใช้จูนเพดานเสนอ / Auto-Accept</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="px-5 py-3">รุ่น</th>
                  <th className="px-5 py-3 text-right">ข้อเสนอ</th>
                  <th className="px-5 py-3 text-right">รับ</th>
                  <th className="px-5 py-3 text-right">อัตรารับ</th>
                  <th className="px-5 py-3 text-right">ส่วนต่างที่ขอเฉลี่ย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {byModel.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 font-bold text-slate-800">{m.model}</td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums">{m.total}</td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums text-emerald-600">{m.accepted}</td>
                    <td className="px-5 py-3 text-right font-black tabular-nums">{pct1(m.acceptRate)}</td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums text-amber-600">+{pct1(m.avgDelta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* recent offers */}
      {rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Zap size={15} className="text-slate-400" />
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">ข้อเสนอล่าสุด</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="px-5 py-3">Ref</th>
                  <th className="px-5 py-3">รุ่น</th>
                  <th className="px-5 py-3 text-right">ประเมิน</th>
                  <th className="px-5 py-3 text-right">เสนอ</th>
                  <th className="px-5 py-3 text-right">Δ</th>
                  <th className="px-5 py-3">สถานะข้อเสนอ</th>
                  <th className="px-5 py-3">วันที่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.slice(0, 50).map((r) => (
                  <tr key={r.jobId}>
                    <td className="px-5 py-3 font-mono text-[11px] font-black text-blue-600">{r.refNo}</td>
                    <td className="px-5 py-3 font-bold text-slate-800">{r.model}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-500">{formatCurrency(Number(r.offer.quote_at_offer))}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-black">{formatCurrency(Number(r.offer.amount))}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold text-amber-600">+{pct1(r.deltaPct)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[11px] font-black ${ACCEPTED_STATUSES.includes(r.offer.status) ? 'text-emerald-600' : r.offer.status === 'pending' ? 'text-amber-600' : 'text-slate-500'}`}>
                        {OFFER_STATUS_LABEL_TH[r.offer.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[11px] font-bold text-slate-400">
                      {new Date(Number(r.offer.proposed_at)).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
