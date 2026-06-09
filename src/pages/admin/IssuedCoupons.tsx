// Issued Coupons ledger — reconciliation view for system-granted coupons
// (currently the review reward). Reads the /issued_coupons ledger that the
// reviews API + validateAndCreateOrder Cloud Function maintain:
//   - reviews API writes one row per granted coupon (status 'issued')
//   - the order Cloud Function flips it to 'used' (used_at, used_job_id)
// Cross-checks against /reviews so admins can verify granted-vs-redeemed and
// spot drift (e.g. a redeemed coupon with no matching review).
//
// CEO / MANAGER / FINANCE.

import React, { useState, useEffect, useMemo } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Ticket, Loader2, CheckCircle2, Clock, AlertTriangle, BadgeDollarSign,
  Hourglass, Search, Download,
} from 'lucide-react';

interface IssuedCoupon {
  id: string;
  coupon_id?: string;
  code?: string;
  source?: string;
  uid?: string;
  review_id?: string;
  job_id?: string;
  value?: number;
  issued_at?: number;
  expires_at?: number;
  status?: 'issued' | 'used' | string;
  used_at?: number | null;
  used_job_id?: string | null;
}

function formatTHB(n: number): string {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}
function formatDateTime(ts?: number | null): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

type StatusFilter = 'all' | 'issued' | 'used' | 'expired';

export const IssuedCoupons: React.FC = () => {
  const [issued, setIssued] = useState<IssuedCoupon[]>([]);
  const [reviewIds, setReviewIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsubIssued = onValue(ref(db, 'issued_coupons'), (snap) => {
      const data = snap.val() || {};
      setIssued(Object.entries(data).map(([id, v]: [string, any]) => ({ id, ...v })));
      setLoading(false);
    });
    // Reviews — only the keys, for reconciliation (does each ledger row map to
    // a real review, and how many reviews never yielded a coupon).
    const unsubReviews = onValue(ref(db, 'reviews'), (snap) => {
      const data = snap.val() || {};
      setReviewIds(new Set(Object.keys(data)));
    });
    return () => { unsubIssued(); unsubReviews(); };
  }, []);

  const now = Date.now();
  const isExpired = (c: IssuedCoupon) =>
    c.status !== 'used' && !!c.expires_at && now > c.expires_at;

  const stats = useMemo(() => {
    let issuedCount = 0, usedCount = 0, expiredCount = 0, outstandingCount = 0;
    let valueIssued = 0, valueRedeemed = 0;
    let orphanRedeemed = 0; // used but review_id not found in /reviews
    for (const c of issued) {
      issuedCount += 1;
      valueIssued += c.value || 0;
      if (c.status === 'used') {
        usedCount += 1;
        valueRedeemed += c.value || 0;
        if (c.review_id && !reviewIds.has(c.review_id)) orphanRedeemed += 1;
      } else if (isExpired(c)) {
        expiredCount += 1;
      } else {
        outstandingCount += 1;
      }
    }
    return {
      issuedCount, usedCount, expiredCount, outstandingCount,
      valueIssued, valueRedeemed, orphanRedeemed,
      redemptionRate: issuedCount ? Math.round((usedCount / issuedCount) * 100) : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issued, reviewIds]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issued
      .filter((c) => {
        const effectiveStatus = c.status === 'used' ? 'used' : isExpired(c) ? 'expired' : 'issued';
        if (statusFilter !== 'all' && effectiveStatus !== statusFilter) return false;
        if (q) {
          const hay = `${c.code || ''} ${c.uid || ''} ${c.job_id || ''} ${c.review_id || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.issued_at || 0) - (a.issued_at || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issued, statusFilter, search]);

  const exportCsv = () => {
    const header = ['code', 'status', 'value', 'uid', 'review_id', 'job_id', 'issued_at', 'used_at', 'used_job_id', 'expires_at'];
    const lines = rows.map((c) => {
      const status = c.status === 'used' ? 'used' : isExpired(c) ? 'expired' : 'issued';
      return [
        c.code || '', status, c.value || 0, c.uid || '', c.review_id || '', c.job_id || '',
        c.issued_at ? new Date(c.issued_at).toISOString() : '',
        c.used_at ? new Date(c.used_at).toISOString() : '',
        c.used_job_id || '', c.expires_at ? new Date(c.expires_at).toISOString() : '',
      ].join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `issued_coupons_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> กำลังโหลดข้อมูลคูปองที่ออก...
      </div>
    );
  }

  const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; tone?: string }> = ({ icon, label, value, tone = 'text-slate-800' }) => (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">{icon}</div>
      <div>
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
        <p className={`text-xl font-black ${tone}`}>{value}</p>
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
          <Ticket size={20} /> คูปองที่ระบบออกให้ (Issued Coupons)
        </h1>
        <button onClick={exportCsv} className="flex items-center gap-2 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50">
          <Download size={16} /> Export CSV
        </button>
      </div>
      <p className="text-xs font-bold text-slate-400 mb-5">
        คูปองรางวัลรีวิว (THX) ที่ระบบสร้างให้ลูกค้า — ติดตามว่าออกเมื่อไหร่ ใช้เมื่อไหร่ มูลค่าเท่าไหร่ เพื่อ reconcile กับรีวิว
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<Ticket size={18} className="text-blue-500" />} label="ออกทั้งหมด" value={formatTHB(stats.issuedCount)} />
        <StatCard icon={<CheckCircle2 size={18} className="text-emerald-500" />} label={`ใช้แล้ว (${stats.redemptionRate}%)`} value={formatTHB(stats.usedCount)} tone="text-emerald-600" />
        <StatCard icon={<Clock size={18} className="text-amber-500" />} label="ยังไม่ใช้" value={formatTHB(stats.outstandingCount)} tone="text-amber-600" />
        <StatCard icon={<Hourglass size={18} className="text-slate-400" />} label="หมดอายุ" value={formatTHB(stats.expiredCount)} tone="text-slate-500" />
        <StatCard icon={<BadgeDollarSign size={18} className="text-blue-500" />} label="มูลค่าที่ออก" value={`฿${formatTHB(stats.valueIssued)}`} />
        <StatCard icon={<BadgeDollarSign size={18} className="text-emerald-500" />} label="มูลค่าที่ถูกใช้" value={`฿${formatTHB(stats.valueRedeemed)}`} tone="text-emerald-600" />
        <StatCard icon={<Ticket size={18} className="text-slate-400" />} label="รีวิวทั้งหมด" value={formatTHB(reviewIds.size)} />
        <StatCard
          icon={<AlertTriangle size={18} className={stats.orphanRedeemed > 0 ? 'text-rose-500' : 'text-slate-300'} />}
          label="ใช้แล้วแต่ไม่พบรีวิว"
          value={formatTHB(stats.orphanRedeemed)}
          tone={stats.orphanRedeemed > 0 ? 'text-rose-600' : 'text-slate-400'}
        />
      </div>

      {stats.orphanRedeemed > 0 && (
        <div className="mb-4 flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-700 text-sm font-bold">
          <AlertTriangle size={16} /> พบคูปองที่ถูกใช้ {stats.orphanRedeemed} ใบที่ไม่ตรงกับรีวิวในระบบ — ควรตรวจสอบ
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา code / uid / job / review..."
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500"
          />
        </div>
        {(['all', 'issued', 'used', 'expired'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${statusFilter === s ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
          >
            {s === 'all' ? 'ทั้งหมด' : s === 'issued' ? 'ยังไม่ใช้' : s === 'used' ? 'ใช้แล้ว' : 'หมดอายุ'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-widest text-left">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3 text-right">มูลค่า</th>
                <th className="px-4 py-3">ออกเมื่อ</th>
                <th className="px-4 py-3">ใช้เมื่อ</th>
                <th className="px-4 py-3">หมดอายุ</th>
                <th className="px-4 py-3">ลูกค้า (uid)</th>
                <th className="px-4 py-3">งานที่ใช้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 font-bold">ไม่มีข้อมูล</td></tr>
              ) : rows.map((c) => {
                const expired = isExpired(c);
                const status = c.status === 'used' ? 'used' : expired ? 'expired' : 'issued';
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-black text-slate-800">{c.code || '-'}</td>
                    <td className="px-4 py-3">
                      {status === 'used' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-xs"><CheckCircle2 size={13} /> ใช้แล้ว</span>
                      ) : status === 'expired' ? (
                        <span className="inline-flex items-center gap-1 text-slate-400 font-bold text-xs"><Hourglass size={13} /> หมดอายุ</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-bold text-xs"><Clock size={13} /> ยังไม่ใช้</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">฿{formatTHB(c.value || 0)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateTime(c.issued_at)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateTime(c.used_at)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateTime(c.expires_at)}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs truncate max-w-[120px]" title={c.uid}>{c.uid || '-'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500" title={c.used_job_id || ''}>
                      {c.used_job_id ? c.used_job_id.slice(0, 8) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default IssuedCoupons;
