// Issued Rider-Fee Discounts ledger — reconciliation view for the rider-fee
// discount promotions (the customer pickup_fee the company absorbs). Reads the
// /issued_rider_fee_discounts ledger written by the order Cloud Function:
//   - validateAndCreateOrder writes one row per job (status 'applied')
//   - recomputeCustomerPickupFee overwrites it in place when the fee/discount
//     changes (status 'reverted', value 0, when no longer eligible)
// Each row's `value` is the baht the company absorbed. Totals here feed the
// "absorbed cost" line shown in the Financial Report (P&L).
//
// CEO / MANAGER / FINANCE.

import React, { useState, useEffect, useMemo } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Bike, Loader2, CheckCircle2, RotateCcw, BadgeDollarSign, Search, Download,
} from 'lucide-react';

interface IssuedRiderDiscount {
  id: string;
  promo_id?: string;
  code?: string;
  name?: string;
  discount_type?: string;
  value?: number;
  uid?: string;
  job_id?: string;
  status?: 'applied' | 'reverted' | string;
  applied_at?: number;
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

type StatusFilter = 'all' | 'applied' | 'reverted';

export const IssuedRiderFeeDiscounts: React.FC = () => {
  const [rowsRaw, setRowsRaw] = useState<IssuedRiderDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const unsub = onValue(ref(db, 'issued_rider_fee_discounts'), (snap) => {
      const data = snap.val() || {};
      setRowsRaw(Object.entries(data).map(([id, v]: [string, any]) => ({ id, ...v })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    let appliedCount = 0, revertedCount = 0, valueAbsorbed = 0;
    for (const r of rowsRaw) {
      const status = r.status === 'reverted' || (r.value || 0) <= 0 ? 'reverted' : 'applied';
      if (status === 'applied') { appliedCount += 1; valueAbsorbed += r.value || 0; }
      else revertedCount += 1;
    }
    return { appliedCount, revertedCount, valueAbsorbed, total: rowsRaw.length };
  }, [rowsRaw]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rowsRaw
      .filter((r) => {
        const status = r.status === 'reverted' || (r.value || 0) <= 0 ? 'reverted' : 'applied';
        if (statusFilter !== 'all' && status !== statusFilter) return false;
        if (q) {
          const hay = `${r.code || ''} ${r.name || ''} ${r.uid || ''} ${r.job_id || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.applied_at || 0) - (a.applied_at || 0));
  }, [rowsRaw, statusFilter, search]);

  const exportCsv = () => {
    const header = ['code', 'name', 'discount_type', 'status', 'value', 'uid', 'job_id', 'applied_at'];
    const lines = rows.map((r) => {
      const status = r.status === 'reverted' || (r.value || 0) <= 0 ? 'reverted' : 'applied';
      return [
        r.code || '', (r.name || '').replace(/,/g, ' '), r.discount_type || '', status, r.value || 0,
        r.uid || '', r.job_id || '', r.applied_at ? new Date(r.applied_at).toISOString() : '',
      ].join(',');
    });
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `issued_rider_fee_discounts_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> กำลังโหลดข้อมูลส่วนลดค่าไรเดอร์...
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
          <Bike size={20} /> ส่วนลดค่าไรเดอร์ที่ออกให้ (Issued Rider-Fee Discounts)
        </h1>
        <button onClick={exportCsv} className="flex items-center gap-2 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50">
          <Download size={16} /> Export CSV
        </button>
      </div>
      <p className="text-xs font-bold text-slate-400 mb-5">
        ต้นทุนที่บริษัทรับภาระจากการลดค่าบริการรับเครื่องให้ลูกค้า — ติดตามว่าใช้กับงานใด มูลค่าเท่าไหร่ เพื่อ reconcile และดูใน P&amp;L
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard icon={<Bike size={18} className="text-blue-500" />} label="ออกทั้งหมด" value={formatTHB(stats.total)} />
        <StatCard icon={<CheckCircle2 size={18} className="text-emerald-500" />} label="ใช้จริง" value={formatTHB(stats.appliedCount)} tone="text-emerald-600" />
        <StatCard icon={<RotateCcw size={18} className="text-slate-400" />} label="ยกเลิก/คืนค่า" value={formatTHB(stats.revertedCount)} tone="text-slate-500" />
        <StatCard icon={<BadgeDollarSign size={18} className="text-rose-500" />} label="มูลค่าที่บริษัทรับภาระ" value={`฿${formatTHB(stats.valueAbsorbed)}`} tone="text-rose-600" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา code / ชื่อ / uid / job..."
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500"
          />
        </div>
        {(['all', 'applied', 'reverted'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-colors ${statusFilter === s ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
          >
            {s === 'all' ? 'ทั้งหมด' : s === 'applied' ? 'ใช้จริง' : 'ยกเลิก'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-widest text-left">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">แคมเปญ</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3 text-right">มูลค่าที่ลด</th>
                <th className="px-4 py-3">ใช้เมื่อ</th>
                <th className="px-4 py-3">ลูกค้า (uid)</th>
                <th className="px-4 py-3">งาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-bold">ไม่มีข้อมูล</td></tr>
              ) : rows.map((r) => {
                const status = r.status === 'reverted' || (r.value || 0) <= 0 ? 'reverted' : 'applied';
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-black text-slate-800">{r.code || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{r.name || '-'}</td>
                    <td className="px-4 py-3">
                      {status === 'applied' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-xs"><CheckCircle2 size={13} /> ใช้จริง</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400 font-bold text-xs"><RotateCcw size={13} /> ยกเลิก</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-rose-600">-฿{formatTHB(r.value || 0)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateTime(r.applied_at)}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs truncate max-w-[120px]" title={r.uid}>{r.uid || '-'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500" title={r.job_id || ''}>
                      {r.job_id ? r.job_id.slice(0, 8) : '-'}
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

export default IssuedRiderFeeDiscounts;
