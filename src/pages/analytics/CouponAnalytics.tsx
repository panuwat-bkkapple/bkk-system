// Coupon Analytics dashboard.
//
// Per-coupon usage breakdown — count, total discount value, average per
// use, % of limit consumed, last-used timestamp. Aggregates the
// authoritative used_count from /coupons (kept current by the
// validateAndCreateOrder Cloud Function transaction) and walks /jobs to
// derive per-coupon discount totals from each job's applied_coupon
// snapshot. The two sources should agree on count; if they drift, the
// table surfaces both so admin can investigate.
//
// CEO/MANAGER only — same gating as CouponManager.

import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Ticket, Loader2, ArrowUpDown, TrendingUp, BadgeDollarSign,
  Percent, ListChecks, AlertTriangle,
} from 'lucide-react';

interface Coupon {
  id: string;
  code?: string;
  name?: string;
  description?: string;
  type?: 'fixed' | 'percent' | 'service' | string;
  value?: number;
  max_discount?: number;
  total_limit?: number;
  used_count?: number;
  is_active?: boolean;
  created_at?: number;
  updated_at?: number;
  show_on_homepage?: boolean;
}

interface AppliedCoupon {
  code?: string;
  value?: number;
  actual_value?: number;
  name?: string;
  type?: string;
}

interface Job {
  id: string;
  status?: string;
  created_at?: number;
  applied_coupon?: AppliedCoupon | null;
}

interface CouponStats {
  coupon: Coupon;
  derivedUseCount: number;        // counted from /jobs
  totalDiscountValue: number;     // sum of actual_value
  avgPerUse: number | null;
  lastUsedAt: number | null;
  percentOfLimit: number | null;  // used_count / total_limit
  countMismatch: boolean;         // used_count vs derivedUseCount differs
}

function isWithinDateRange(ts: number | undefined, fromTs: number, toTs: number): boolean {
  if (!ts) return false;
  return ts >= fromTs && ts <= toTs;
}

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}

function typeLabel(t?: string): string {
  switch (t) {
    case 'fixed': return 'ส่วนลดบาท';
    case 'percent': return 'ส่วนลด %';
    case 'service': return 'ฟรีค่าส่ง';
    default: return t || '-';
  }
}

export const CouponAnalytics: React.FC = () => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<'code' | 'derivedUseCount' | 'totalDiscountValue' | 'avgPerUse' | 'percentOfLimit'>('totalDiscountValue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [dateRange, setDateRange] = useState<7 | 30 | 90 | 0>(30);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    const unsubCoupons = onValue(ref(db, 'coupons'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const list: Coupon[] = Object.entries(data).map(([id, c]: [string, any]) => ({ id, ...c }));
        setCoupons(list);
      } else {
        setCoupons([]);
      }
    });

    const unsubJobs = onValue(ref(db, 'jobs'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const list: Job[] = Object.entries(data).map(([id, j]: [string, any]) => ({
          id,
          status: j.status,
          created_at: j.created_at,
          applied_coupon: j.applied_coupon || null,
        }));
        setJobs(list);
      } else {
        setJobs([]);
      }
      setLoading(false);
    });

    return () => { unsubCoupons(); unsubJobs(); };
  }, []);

  const stats = useMemo<CouponStats[]>(() => {
    const now = Date.now();
    const fromTs = dateRange === 0 ? 0 : now - dateRange * 24 * 60 * 60 * 1000;
    const toTs = now;

    // Aggregate per-coupon-code from jobs once, then attach to coupon master.
    const bucket: Record<string, { count: number; total: number; lastTs: number | null }> = {};
    for (const job of jobs) {
      const ac = job.applied_coupon;
      if (!ac?.code) continue;
      if (dateRange !== 0 && !isWithinDateRange(job.created_at, fromTs, toTs)) continue;
      const key = ac.code.toUpperCase();
      const v = Number(ac.actual_value ?? ac.value ?? 0);
      // value is negative when stored (it's a discount applied to net); take absolute.
      const amount = Math.abs(v);
      if (!bucket[key]) bucket[key] = { count: 0, total: 0, lastTs: null };
      bucket[key].count += 1;
      bucket[key].total += amount;
      if (job.created_at && (bucket[key].lastTs == null || job.created_at > bucket[key].lastTs)) {
        bucket[key].lastTs = job.created_at;
      }
    }

    return coupons
      .filter((c) => {
        if (activeFilter === 'active') return c.is_active === true;
        if (activeFilter === 'inactive') return c.is_active === false;
        return true;
      })
      .map((coupon) => {
        const key = (coupon.code || '').toUpperCase();
        const b = bucket[key] || { count: 0, total: 0, lastTs: null };
        const usedCount = coupon.used_count || 0;
        const limit = coupon.total_limit || 0;
        const percent = limit > 0 ? usedCount / limit : null;
        return {
          coupon,
          derivedUseCount: b.count,
          totalDiscountValue: Math.round(b.total),
          avgPerUse: b.count > 0 ? Math.round(b.total / b.count) : null,
          lastUsedAt: b.lastTs,
          percentOfLimit: percent,
          // Mismatch outside the date-range filter is expected (we only counted
          // jobs inside the window). Only flag when scanning all-time.
          countMismatch: dateRange === 0 ? Math.abs(usedCount - b.count) > 0 : false,
        };
      });
  }, [coupons, jobs, dateRange, activeFilter]);

  const sortedStats = useMemo(() => {
    const arr = [...stats];
    arr.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === 'code') { av = a.coupon.code || ''; bv = b.coupon.code || ''; }
      else if (sortKey === 'avgPerUse') { av = a.avgPerUse ?? -1; bv = b.avgPerUse ?? -1; }
      else if (sortKey === 'percentOfLimit') { av = a.percentOfLimit ?? -1; bv = b.percentOfLimit ?? -1; }
      else { av = (a[sortKey] as number) ?? 0; bv = (b[sortKey] as number) ?? 0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [stats, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
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
      activeCount: acc.activeCount + (s.coupon.is_active ? 1 : 0),
      totalUses: acc.totalUses + s.derivedUseCount,
      totalValue: acc.totalValue + s.totalDiscountValue,
    }),
    { activeCount: 0, totalUses: 0, totalValue: 0 }
  );
  const avgPerUseAll = totals.totalUses > 0 ? Math.round(totals.totalValue / totals.totalUses) : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto font-sans text-slate-800 animate-in fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black mb-2 flex items-center gap-3">
          <div className="bg-fuchsia-600 p-2 rounded-xl text-white">
            <Ticket size={24} />
          </div>
          Coupon Analytics
        </h1>
        <p className="text-slate-500 font-medium ml-12">
          การใช้คูปอง · มูลค่าส่วนลด · อัตราการ redeem ต่อแคมเปญ
          <Link to="/coupons" className="ml-3 text-xs font-black text-fuchsia-600 hover:text-fuchsia-700 hover:underline">
            จัดการแคมเปญ →
          </Link>
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">ช่วงเวลา:</span>
        {([7, 30, 90, 0] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDateRange(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              dateRange === d ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {d === 0 ? 'ทั้งหมด' : `${d} วันล่าสุด`}
          </button>
        ))}

        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-4">สถานะ:</span>
        {(['all', 'active', 'inactive'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeFilter === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === 'all' ? 'ทั้งหมด' : s === 'active' ? 'Active' : 'Inactive'}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <SummaryCard icon={<ListChecks className="text-fuchsia-600" />} label="แคมเปญที่ active" value={totals.activeCount.toString()} />
        <SummaryCard icon={<Ticket className="text-emerald-600" />} label="ใช้งานทั้งหมด" value={`${totals.totalUses} ครั้ง`} />
        <SummaryCard icon={<BadgeDollarSign className="text-amber-600" />} label="มูลค่าส่วนลดรวม" value={`฿${formatTHB(totals.totalValue)}`} />
        <SummaryCard icon={<TrendingUp className="text-blue-600" />} label="เฉลี่ย/ครั้ง" value={`฿${formatTHB(avgPerUseAll)}`} />
      </div>

      {/* Per-coupon table */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-widest text-slate-500 font-black">
              <tr>
                <Th label="Code" onClick={() => toggleSort('code')} active={sortKey === 'code'} dir={sortDir} />
                <th className="text-left p-4">ประเภท</th>
                <Th label="ใช้แล้ว" onClick={() => toggleSort('derivedUseCount')} active={sortKey === 'derivedUseCount'} dir={sortDir} />
                <Th label="มูลค่ารวม" onClick={() => toggleSort('totalDiscountValue')} active={sortKey === 'totalDiscountValue'} dir={sortDir} />
                <Th label="เฉลี่ย/ครั้ง" onClick={() => toggleSort('avgPerUse')} active={sortKey === 'avgPerUse'} dir={sortDir} />
                <Th label="% ของ limit" onClick={() => toggleSort('percentOfLimit')} active={sortKey === 'percentOfLimit'} dir={sortDir} />
                <th className="text-left p-4">ใช้ล่าสุด</th>
                <th className="text-left p-4">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedStats.length === 0 ? (
                <tr><td colSpan={8} className="text-center p-8 text-slate-400 font-bold">ไม่พบคูปอง</td></tr>
              ) : sortedStats.map((s) => (
                <tr key={s.coupon.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="p-4">
                    <div className="font-black text-slate-800 flex items-center gap-2">
                      {s.coupon.code || <span className="text-slate-300">—</span>}
                      {s.countMismatch && (
                        <span
                          title={`used_count (${s.coupon.used_count || 0}) ไม่ตรงกับจำนวนที่นับจาก /jobs (${s.derivedUseCount})`}
                          className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-black border border-rose-200 flex items-center gap-1"
                        >
                          <AlertTriangle size={10} /> MISMATCH
                        </span>
                      )}
                    </div>
                    {s.coupon.name && <div className="text-[11px] text-slate-400 font-medium">{s.coupon.name}</div>}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                      {s.coupon.type === 'percent' && <Percent size={12} className="text-amber-500" />}
                      {typeLabel(s.coupon.type)}
                      {s.coupon.value != null && (
                        <span className="text-slate-400">
                          ({s.coupon.value}{s.coupon.type === 'percent' ? '%' : '฿'})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 font-black text-emerald-700">{s.derivedUseCount}</td>
                  <td className="p-4 font-black text-amber-700">฿{formatTHB(s.totalDiscountValue)}</td>
                  <td className="p-4 font-bold text-slate-700">
                    {s.avgPerUse == null ? <span className="text-slate-300">—</span> : `฿${formatTHB(s.avgPerUse)}`}
                  </td>
                  <td className="p-4">
                    {s.percentOfLimit == null ? (
                      <span className="text-slate-300 text-xs">ไม่จำกัด</span>
                    ) : (
                      <div className="leading-tight">
                        <span className={`font-black ${s.percentOfLimit >= 0.9 ? 'text-rose-600' : s.percentOfLimit >= 0.7 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {(s.percentOfLimit * 100).toFixed(0)}%
                        </span>
                        <div className="text-[10px] text-slate-400 font-bold">
                          {s.coupon.used_count || 0}/{s.coupon.total_limit}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-xs text-slate-500 font-medium">
                    {s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td className="p-4">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                      s.coupon.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}>
                      {s.coupon.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4 leading-relaxed">
        <strong>หมายเหตุ:</strong> "ใช้แล้ว" และ "มูลค่ารวม" คำนวณจาก <code className="bg-slate-100 px-1 rounded">jobs/&#123;id&#125;/applied_coupon</code> ตาม date range. "% ของ limit" ใช้ <code className="bg-slate-100 px-1 rounded">coupons.used_count</code> ที่ Cloud Function <code className="bg-slate-100 px-1 rounded">validateAndCreateOrder</code> increment ผ่าน transaction (all-time, ไม่ filter by date). ถ้า used_count กับจำนวนนับจาก jobs ต่างกันตอน "ทั้งหมด" → MISMATCH badge ขึ้น (อาจเป็น order ถูกลบ/archive)
      </p>
    </div>
  );
};

interface ThProps { label: string; onClick: () => void; active: boolean; dir: 'asc' | 'desc'; }
const Th: React.FC<ThProps> = ({ label, onClick, active, dir }) => (
  <th className="text-left p-4 select-none cursor-pointer hover:bg-slate-100 transition-colors" onClick={onClick}>
    <div className="flex items-center gap-1">
      {label}
      <ArrowUpDown size={12} className={active ? (dir === 'asc' ? 'text-fuchsia-600 rotate-180' : 'text-fuchsia-600') : 'text-slate-300'} />
    </div>
  </th>
);

interface SummaryCardProps { icon: React.ReactNode; label: string; value: string; }
const SummaryCard: React.FC<SummaryCardProps> = ({ icon, label, value }) => (
  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm flex items-center gap-4">
    <div className="p-3 bg-slate-50 rounded-xl">{icon}</div>
    <div>
      <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</div>
      <div className="text-2xl font-black text-slate-800">{value}</div>
    </div>
  </div>
);

export default CouponAnalytics;
