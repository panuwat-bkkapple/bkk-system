// /dealer-finance (CEO/FINANCE) — ลูกหนี้/เจ้าหนี้ฝั่งดีลเลอร์
// AR (ลูกหนี้การค้า) = ออเดอร์ค้างชำระ (pending_payment/payment_review) + aging
// AP (เจ้าหนี้) = เงินคืนเคลมที่อนุมัติแล้วยังไม่โอน + เครดิตคงค้างต่อร้าน
// ออเดอร์อ่านตรงจาก RTDB (admin read ได้) — เคลม/เครดิตผ่าน adminDealerListClaims
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useDatabase } from '../../hooks/useDatabase';
import { Scale, RefreshCw } from 'lucide-react';
import { fmtBaht } from '../../types/dealer';

interface ClaimRow {
  id: string;
  claim_no: string;
  company_name: string | null;
  status: string;
  resolution?: string | null;
  approved_amount?: number | null;
  decided_at?: number;
}

const AGING_BUCKETS = [
  { label: '0-3 วัน', max: 3 },
  { label: '4-7 วัน', max: 7 },
  { label: '8-14 วัน', max: 14 },
  { label: '15+ วัน', max: Infinity },
];

const agingOf = (ms: number): string => {
  const days = Math.floor((Date.now() - ms) / 86400000);
  for (const b of AGING_BUCKETS) if (days <= b.max) return b.label;
  return AGING_BUCKETS[AGING_BUCKETS.length - 1].label;
};

export const DealerFinance = () => {
  const { data: ordersRaw, loading: ordersLoading } = useDatabase('dealer_orders');
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [credits, setCredits] = useState<{ uid: string; company_name: string; balance: number }[]>([]);
  const [apLoading, setApLoading] = useState(true);

  const loadAp = useCallback(async () => {
    setApLoading(true);
    try {
      const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminDealerListClaims');
      const res = (await fn({})).data as { claims: ClaimRow[]; credits: { uid: string; company_name: string; balance: number }[] };
      setClaims(res.claims);
      setCredits(res.credits);
    } catch {
      setClaims([]);
      setCredits([]);
    } finally {
      setApLoading(false);
    }
  }, []);

  useEffect(() => { void loadAp(); }, [loadAp]);

  // AR: ออเดอร์ค้างชำระ per ดีลเลอร์ + aging bucket
  const ar = useMemo(() => {
    const list = ordersRaw
      ? (Array.isArray(ordersRaw) ? ordersRaw : Object.keys(ordersRaw).map((k) => ({ id: k, ...(ordersRaw as any)[k] })))
      : [];
    const open = list.filter((o: any) => ['pending_payment', 'payment_review'].includes(o.status));
    const rows = open.map((o: any) => ({
      id: o.id,
      order_no: o.order_no || '-',
      company: o.dealer_snapshot?.company_name || '-',
      amount: (Number(o.amount) || 0) - (Number(o.credit_applied) || 0),
      created_at: Number(o.created_at) || Date.now(),
      status: o.status,
      bucket: agingOf(Number(o.created_at) || Date.now()),
    }));
    rows.sort((a, b) => a.created_at - b.created_at);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const byBucket = AGING_BUCKETS.map((b) => ({
      label: b.label,
      total: rows.filter((r) => r.bucket === b.label).reduce((s, r) => s + r.amount, 0),
    }));
    return { rows, total, byBucket };
  }, [ordersRaw]);

  // AP: เคลม refund ที่อนุมัติแล้วยังไม่โอน + เครดิตคงค้าง
  const apRefunds = claims.filter((c) => c.status === 'approved' && c.resolution === 'refund');
  const apRefundTotal = apRefunds.reduce((s, c) => s + (Number(c.approved_amount) || 0), 0);
  const apCreditTotal = credits.reduce((s, c) => s + c.balance, 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
            <Scale size={22} className="text-blue-500" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">ลูกหนี้ / เจ้าหนี้ ดีลเลอร์ (AR/AP)</h1>
            <p className="text-xs text-slate-500 font-bold">ยอดค้างรับจากออเดอร์ · ยอดค้างจ่ายจากเคลมและเครดิต</p>
          </div>
        </div>
        <button onClick={() => void loadAp()} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-slate-200 flex items-center gap-1.5">
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      {/* สรุป */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AR — ลูกหนี้ค้างชำระ</div>
          <div className="font-mono font-black text-2xl text-blue-600 mt-1">{fmtBaht(ar.total)}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-1">{ar.rows.length} ออเดอร์</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AP — เงินคืนเคลมค้างโอน</div>
          <div className="font-mono font-black text-2xl text-red-500 mt-1">{fmtBaht(apRefundTotal)}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-1">{apRefunds.length} รายการ · จัดการที่หน้าเคลมดีลเลอร์</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AP — เครดิตคงค้าง</div>
          <div className="font-mono font-black text-2xl text-amber-600 mt-1">{fmtBaht(apCreditTotal)}</div>
          <div className="text-[10px] font-bold text-slate-400 mt-1">{credits.length} ร้าน · ใช้หักออเดอร์ถัดไป</div>
        </div>
      </div>

      {/* AR aging */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-3">AR Aging (นับจากวันสร้างออเดอร์)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ar.byBucket.map((b) => (
            <div key={b.label} className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
              <div className="text-[10px] font-black text-slate-400 uppercase">{b.label}</div>
              <div className="font-mono font-black text-sm mt-1">{fmtBaht(b.total)}</div>
            </div>
          ))}
        </div>
        <table className="w-full text-left mt-4">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="py-2 text-[10px] font-black text-slate-400 uppercase">ออเดอร์</th>
              <th className="py-2 text-[10px] font-black text-slate-400 uppercase">ดีลเลอร์</th>
              <th className="py-2 text-[10px] font-black text-slate-400 uppercase">ค้างมา</th>
              <th className="py-2 text-[10px] font-black text-slate-400 uppercase text-right">ยอดค้าง</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {ar.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5 font-mono font-bold text-xs">{r.order_no}
                  {r.status === 'payment_review' && <span className="ml-2 text-[9px] font-black text-orange-500">รอตรวจสลิป</span>}
                </td>
                <td className="py-2.5 text-xs font-bold text-slate-600">{r.company}</td>
                <td className="py-2.5 text-xs font-bold text-slate-500">{r.bucket}</td>
                <td className="py-2.5 font-mono font-bold text-xs text-right">{fmtBaht(r.amount)}</td>
              </tr>
            ))}
            {!ordersLoading && ar.rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400 italic font-bold text-xs">ไม่มีออเดอร์ค้างชำระ</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* AP รายละเอียด */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-black text-xs uppercase tracking-widest text-slate-500 mb-3">AP — รายละเอียดค้างจ่าย</h2>
        {apLoading && <div className="text-xs text-slate-400 font-bold">กำลังโหลด...</div>}
        {!apLoading && apRefunds.length === 0 && credits.length === 0 && (
          <div className="text-xs text-slate-400 italic font-bold">ไม่มียอดค้างจ่าย</div>
        )}
        {apRefunds.map((c) => (
          <div key={c.id} className="flex justify-between items-center py-2 border-b border-slate-50 text-xs font-bold">
            <span>เงินคืนเคลม {c.claim_no} · {c.company_name || '-'}</span>
            <span className="font-mono text-red-500">{fmtBaht(Number(c.approved_amount) || 0)}</span>
          </div>
        ))}
        {credits.map((c) => (
          <div key={c.uid} className="flex justify-between items-center py-2 border-b border-slate-50 text-xs font-bold">
            <span>เครดิตคงค้าง · {c.company_name}</span>
            <span className="font-mono text-amber-600">{fmtBaht(c.balance)}</span>
          </div>
        ))}
      </section>
    </div>
  );
};
