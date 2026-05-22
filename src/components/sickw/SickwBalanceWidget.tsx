// แถบเล็กๆ โชว์เครดิต Sickw คงเหลือ + เตือนถ้าต่ำกว่า threshold
// ดึงผ่าน Cloud Function getSickwBalance (server cache 5 นาที — แอดมินหลายคน
// เปิดหน้าพร้อมกันไม่ burn quota)

import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import { getSickwBalance } from '../../utils/sickwApi';

interface Props {
  /** เตือนถ้าเครดิตคงเหลือต่ำกว่าค่านี้ (USD) — default 5 */
  lowThreshold?: number;
  compact?: boolean;
}

export function SickwBalanceWidget({ lowThreshold = 5, compact }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const load = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSickwBalance(force);
      setBalance(res.balance);
      setCachedAt(res.cachedAt);
    } catch (e: any) {
      setError(e?.message || 'โหลดยอดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const isLow = balance != null && balance < lowThreshold;

  if (compact) {
    return (
      <button
        onClick={() => load(true)}
        title={cachedAt ? `อัปเดต ${new Date(cachedAt).toLocaleTimeString('th-TH')}` : ''}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition ${
          isLow ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}
      >
        {loading
          ? <Loader2 size={11} className="animate-spin" />
          : isLow ? <AlertTriangle size={11} /> : <Wallet size={11} />}
        <span className="font-mono">
          {balance == null ? '—' : `$${balance.toFixed(2)}`}
        </span>
      </button>
    );
  }

  return (
    <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
      isLow ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
    }`}>
      <div className="flex items-center gap-2">
        {isLow ? <AlertTriangle size={16} className="text-red-600" /> : <Wallet size={16} className="text-emerald-700" />}
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${isLow ? 'text-red-700' : 'text-emerald-700'}`}>
            Sickw Credit
          </p>
          <p className={`text-lg font-mono font-black ${isLow ? 'text-red-900' : 'text-emerald-900'}`}>
            {loading ? '...' : error ? '—' : balance != null ? `$${balance.toFixed(2)}` : '—'}
          </p>
        </div>
      </div>
      <button
        onClick={() => load(true)}
        disabled={loading}
        className="p-2 hover:bg-white/50 rounded-lg disabled:opacity-40"
        title="รีเฟรชจริง (bypass cache)"
      >
        <RefreshCw size={14} className={`text-slate-600 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
