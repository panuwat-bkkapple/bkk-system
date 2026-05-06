// Rider Performance Dashboard (Phase 1B).
//
// Per-rider acceptance / completion / cancellation rates aggregated from
// /jobs. Reads /jobs/{id}/checkpoints/{stage} (written by the rider app
// in Phase 1A) to compute arrival accuracy. No event log yet — Phase 1A
// data is what we have, so a brand-new rider with no history shows
// "ยังไม่มีข้อมูล" instead of zeros.
//
// Heavy queries (whole /jobs scan) are fine at the current scale; switch
// to indexed queries with date filters once jobs > a few thousand.

import React, { useState, useEffect, useMemo } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Bike, TrendingUp, TrendingDown, AlertTriangle, MapPin, Loader2,
  CheckCircle2, XCircle, Activity, ArrowUpDown,
} from 'lucide-react';

interface AutoReviewFlag {
  flagged_at?: number;
  reasons?: string[];
}

interface Rider {
  id: string;
  name?: string;
  phone?: string;
  photo?: string;
  photo_url?: string;
  approval_status?: string;
  flags?: { auto_review?: AutoReviewFlag };
}

interface Checkpoint {
  at?: number;
  distance_m?: number;
  is_within_zone?: boolean;
  zone_m?: number;
}

interface Job {
  id: string;
  rider_id?: string | null;
  status?: string;
  cancelled_by?: string;
  cancel_category?: string;
  created_at?: number;
  completed_at?: number;
  cancelled_at?: number;
  checkpoints?: Record<string, Checkpoint>;
}

interface RiderStats {
  rider: Rider;
  active: number;
  completed: number;
  riderCancelled: number;       // rider rejected / abandoned
  customerCancelled: number;    // customer cancel after assignment
  totalAssigned: number;        // active + completed + customerCancelled (rider keeps id)
  completionRate: number | null;       // completed / (completed + customerCancelled)
  avgArrivalDistanceM: number | null;
  outsideZoneArrivals: number;
  arrivalSamples: number;
}

const ACTIVE_STATUSES = new Set([
  'Rider Assigned', 'Rider Accepted', 'Rider En Route', 'Rider Arrived',
  'Accepted', 'Heading to Customer', 'Arrived', // legacy
  'Being Inspected', 'QC Review', 'Negotiation', 'Revised Offer',
  'Price Accepted', 'Payout Processing', 'Waiting For Handover',
  'Rider Returning', 'In-Transit', // legacy returning
  'Pending QC',
]);

const COMPLETED_STATUSES = new Set([
  'Paid', 'Payment Completed', 'Sent To QC Lab', 'Ready To Sell',
  'Sold', 'In Stock', 'Completed',
]);

function isWithinDateRange(ts: number | undefined, fromTs: number, toTs: number): boolean {
  if (!ts) return false;
  return ts >= fromTs && ts <= toTs;
}

export const RiderPerformance: React.FC = () => {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<keyof RiderStats | 'name'>('completionRate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [dateRange, setDateRange] = useState<7 | 30 | 90 | 0>(30);

  useEffect(() => {
    const unsubRiders = onValue(ref(db, 'riders'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const list: Rider[] = Object.entries(data).map(([id, r]: [string, any]) => ({
          id,
          name: r.name || r.fullName || r.full_name || 'ไม่ระบุชื่อ',
          phone: r.phone,
          photo: r.photo || r.photo_url,
          approval_status: r.approval_status || r.status,
          flags: r.flags,
        }));
        setRiders(list);
      }
    });

    const unsubJobs = onValue(ref(db, 'jobs'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const list: Job[] = Object.entries(data).map(([id, j]: [string, any]) => ({ id, ...j }));
        setJobs(list);
      }
      setLoading(false);
    });

    return () => { unsubRiders(); unsubJobs(); };
  }, []);

  const stats = useMemo<RiderStats[]>(() => {
    const now = Date.now();
    const fromTs = dateRange === 0 ? 0 : now - dateRange * 24 * 60 * 60 * 1000;
    const toTs = now;

    return riders
      .filter((r) => r.approval_status === 'Active' || r.approval_status === 'Online' || r.approval_status === 'Offline' || r.approval_status === 'Busy')
      .map((rider) => {
        const s: RiderStats = {
          rider,
          active: 0,
          completed: 0,
          riderCancelled: 0,
          customerCancelled: 0,
          totalAssigned: 0,
          completionRate: null,
          avgArrivalDistanceM: null,
          outsideZoneArrivals: 0,
          arrivalSamples: 0,
        };

        let arrivalSum = 0;

        for (const job of jobs) {
          const refTs = job.completed_at || job.cancelled_at || job.created_at;
          if (dateRange !== 0 && !isWithinDateRange(refTs, fromTs, toTs)) continue;

          // Rider self-cancel/reject — rider_id is wiped, so check cancelled_by.
          if (job.cancelled_by === `rider:${rider.id}`) {
            s.riderCancelled += 1;
            continue;
          }

          if (job.rider_id !== rider.id) continue;

          if (job.status && COMPLETED_STATUSES.has(job.status)) {
            s.completed += 1;
          } else if (job.status === 'Cancelled' && job.cancel_category === 'customer_request_cancel') {
            s.customerCancelled += 1;
          } else if (job.status && ACTIVE_STATUSES.has(job.status)) {
            s.active += 1;
          }

          // Arrival accuracy from rider_arrived checkpoint
          const arrived = job.checkpoints?.rider_arrived;
          if (arrived?.distance_m != null) {
            arrivalSum += arrived.distance_m;
            s.arrivalSamples += 1;
            if (arrived.is_within_zone === false) s.outsideZoneArrivals += 1;
          }
        }

        s.totalAssigned = s.completed + s.customerCancelled + s.active;
        const denom = s.completed + s.customerCancelled;
        s.completionRate = denom > 0 ? s.completed / denom : null;
        s.avgArrivalDistanceM = s.arrivalSamples > 0 ? Math.round(arrivalSum / s.arrivalSamples) : null;

        return s;
      });
  }, [riders, jobs, dateRange]);

  const sortedStats = useMemo(() => {
    const arr = [...stats];
    arr.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === 'name') { av = a.rider.name || ''; bv = b.rider.name || ''; }
      else if (sortKey === 'completionRate') { av = a.completionRate ?? -1; bv = b.completionRate ?? -1; }
      else if (sortKey === 'avgArrivalDistanceM') { av = a.avgArrivalDistanceM ?? Infinity; bv = b.avgArrivalDistanceM ?? Infinity; }
      else { av = (a[sortKey] as number) ?? 0; bv = (b[sortKey] as number) ?? 0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [stats, sortKey, sortDir]);

  const toggleSort = (key: keyof RiderStats | 'name') => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  const totals = stats.reduce(
    (acc, s) => ({
      completed: acc.completed + s.completed,
      customerCancelled: acc.customerCancelled + s.customerCancelled,
      riderCancelled: acc.riderCancelled + s.riderCancelled,
      active: acc.active + s.active,
    }),
    { completed: 0, customerCancelled: 0, riderCancelled: 0, active: 0 }
  );

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans text-slate-800 animate-in fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black mb-2 flex items-center gap-3">
          <div className="bg-emerald-600 p-2 rounded-xl text-white">
            <Bike size={24} />
          </div>
          Rider Performance Dashboard
        </h1>
        <p className="text-slate-500 font-medium ml-12">อัตราความสำเร็จ / การยกเลิก / ความแม่นยำของการมาถึงต่อไรเดอร์</p>
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">ช่วงเวลา:</span>
        {([7, 30, 90, 0] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDateRange(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              dateRange === d
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {d === 0 ? 'ทั้งหมด' : `${d} วันล่าสุด`}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <SummaryCard icon={<CheckCircle2 className="text-emerald-600" />} label="งานสำเร็จ" value={totals.completed} color="emerald" />
        <SummaryCard icon={<Activity className="text-blue-600" />} label="งานกำลังดำเนินการ" value={totals.active} color="blue" />
        <SummaryCard icon={<XCircle className="text-rose-600" />} label="ลูกค้ายกเลิก" value={totals.customerCancelled} color="rose" />
        <SummaryCard icon={<AlertTriangle className="text-amber-600" />} label="ไรเดอร์ยกเลิก/ปฏิเสธ" value={totals.riderCancelled} color="amber" />
      </div>

      {/* Per-rider table */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500 font-black">
              <tr>
                <Th label="ไรเดอร์" onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir} />
                <Th label="งานสำเร็จ" onClick={() => toggleSort('completed')} active={sortKey === 'completed'} dir={sortDir} />
                <Th label="ลูกค้ายกเลิก" onClick={() => toggleSort('customerCancelled')} active={sortKey === 'customerCancelled'} dir={sortDir} />
                <Th label="ไรเดอร์ยกเลิก" onClick={() => toggleSort('riderCancelled')} active={sortKey === 'riderCancelled'} dir={sortDir} />
                <Th label="กำลังทำ" onClick={() => toggleSort('active')} active={sortKey === 'active'} dir={sortDir} />
                <Th label="อัตราสำเร็จ" onClick={() => toggleSort('completionRate')} active={sortKey === 'completionRate'} dir={sortDir} />
                <Th label="ระยะถึง (เฉลี่ย)" onClick={() => toggleSort('avgArrivalDistanceM')} active={sortKey === 'avgArrivalDistanceM'} dir={sortDir} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedStats.length === 0 ? (
                <tr><td colSpan={7} className="text-center p-8 text-slate-400 font-bold">ยังไม่มีไรเดอร์ที่ active</td></tr>
              ) : sortedStats.map((s) => (
                <tr key={s.rider.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      {s.rider.photo ? (
                        <img src={s.rider.photo} alt="" className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-500">
                          {s.rider.name?.charAt(0) || 'R'}
                        </div>
                      )}
                      <div className="leading-tight">
                        <div className="font-bold text-slate-800 flex items-center gap-2">
                          {s.rider.name}
                          {s.rider.flags?.auto_review && (
                            <span
                              title={s.rider.flags.auto_review.reasons?.join(' / ') || 'Auto-flagged for review'}
                              className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black border border-amber-200"
                            >
                              FLAGGED
                            </span>
                          )}
                        </div>
                        {s.rider.phone && <div className="text-[11px] text-slate-400">{s.rider.phone}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="p-4 font-black text-emerald-700">{s.completed}</td>
                  <td className="p-4 font-bold text-rose-600">{s.customerCancelled}</td>
                  <td className="p-4 font-bold text-amber-600">{s.riderCancelled}</td>
                  <td className="p-4 font-bold text-blue-600">{s.active}</td>
                  <td className="p-4">
                    {s.completionRate == null ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className={`font-black ${s.completionRate >= 0.9 ? 'text-emerald-600' : s.completionRate >= 0.7 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {(s.completionRate * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    {s.avgArrivalDistanceM == null ? (
                      <span className="text-slate-300 text-xs">ยังไม่มีข้อมูล</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-slate-400" />
                        <span className={`font-black ${s.avgArrivalDistanceM <= 100 ? 'text-emerald-600' : s.avgArrivalDistanceM <= 200 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {s.avgArrivalDistanceM} ม.
                        </span>
                        {s.outsideZoneArrivals > 0 && (
                          <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-black">
                            นอกโซน {s.outsideZoneArrivals}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4 leading-relaxed">
        <strong>หมายเหตุ:</strong> ระยะถึงเฉลี่ยคำนวณจาก <code className="bg-slate-100 px-1 rounded">jobs/&#123;id&#125;/checkpoints/rider_arrived</code> ที่เก็บโดยแอปไรเดอร์ตอนกด "ถึงลูกค้า" — ไรเดอร์ที่เพิ่งเริ่มต้น/ยังไม่มีข้อมูล check-in จะแสดง "ยังไม่มีข้อมูล". อัตราสำเร็จ = สำเร็จ ÷ (สำเร็จ + ลูกค้ายกเลิก) — ไม่นับงานที่ไรเดอร์ปฏิเสธ
      </p>
    </div>
  );
};

interface ThProps { label: string; onClick: () => void; active: boolean; dir: 'asc' | 'desc'; }
const Th: React.FC<ThProps> = ({ label, onClick, active, dir }) => (
  <th className="text-left p-4 select-none cursor-pointer hover:bg-slate-100 transition-colors" onClick={onClick}>
    <div className="flex items-center gap-1">
      {label}
      <ArrowUpDown size={12} className={active ? (dir === 'asc' ? 'text-emerald-600 rotate-180' : 'text-emerald-600') : 'text-slate-300'} />
    </div>
  </th>
);

interface SummaryCardProps { icon: React.ReactNode; label: string; value: number; color: string; }
const SummaryCard: React.FC<SummaryCardProps> = ({ icon, label, value }) => (
  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
    <div className="p-3 bg-slate-50 rounded-xl">{icon}</div>
    <div>
      <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</div>
      <div className="text-2xl font-black text-slate-800">{value}</div>
    </div>
  </div>
);

export default RiderPerformance;
