// Admin page — Sickw usage log + summary
// เปิดเฉพาะ CEO + MANAGER (audit เรื่อง credit ของ Sickw)
// แสดง:
//   - Summary: ยอด check + credit ที่ใช้ (24h / 30d) + breakdown ต่อคน
//   - Anomaly: คนที่ตรวจโดยไม่ผูก jobId (suspicious — อาจ test ส่วนตัว)
//   - Log table: ทุก call ที่เคยเรียก Sickw (filter ตาม user/date/IMEI)

import { useEffect, useMemo, useState } from 'react';
import { ref, onValue, query, orderByChild, startAt } from 'firebase/database';
import { db } from '../../api/firebase';
import { Wallet, AlertTriangle, Search, Download, RefreshCw, Loader2, ShieldCheck, Users } from 'lucide-react';
import { SickwBalanceWidget } from '../../components/sickw/SickwBalanceWidget';

interface UsageEntry {
  timestamp: number;
  uid: string;
  name: string;
  role: string;
  imei: string;
  service_ids: string[];
  job_id: string | null;
  cached: boolean[];
  credit_used: number;
  status: string;
  source: string;
}

export default function SickwUsagePage() {
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUid, setFilterUid] = useState<string>('');
  const [filterImei, setFilterImei] = useState<string>('');
  const [hideJobless, setHideJobless] = useState(false);
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);

  useEffect(() => {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    // index ตาม timestamp ใน rules แล้ว — query แค่ช่วงเวลาที่เลือก
    const q = query(ref(db, 'sickw_usage'), orderByChild('timestamp'), startAt(cutoff));
    const unsub = onValue(q, (snap) => {
      const arr: UsageEntry[] = [];
      snap.forEach((s) => {
        const v = s.val();
        if (v) arr.push(v);
      });
      // descending by timestamp
      arr.sort((a, b) => b.timestamp - a.timestamp);
      setEntries(arr);
      setLoading(false);
    });
    return () => unsub();
  }, [windowDays]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterUid && e.uid !== filterUid) return false;
      if (filterImei && !e.imei.toLowerCase().includes(filterImei.toLowerCase())) return false;
      if (hideJobless && !e.job_id) return false;
      return true;
    });
  }, [entries, filterUid, filterImei, hideJobless]);

  const perUser = useMemo(() => {
    const map: Record<string, { uid: string; name: string; role: string; checks: number; credit: number; noJobId: number }> = {};
    for (const e of entries) {
      if (!map[e.uid]) map[e.uid] = { uid: e.uid, name: e.name, role: e.role, checks: 0, credit: 0, noJobId: 0 };
      map[e.uid].checks += 1;
      map[e.uid].credit += Number(e.credit_used || 0);
      if (!e.job_id) map[e.uid].noJobId += 1;
    }
    return Object.values(map).sort((a, b) => b.credit - a.credit);
  }, [entries]);

  const totals = useMemo(() => {
    const totalChecks = entries.length;
    const totalCredit = entries.reduce((acc, e) => acc + Number(e.credit_used || 0), 0);
    const totalNoJob = entries.filter((e) => !e.job_id).length;
    return { totalChecks, totalCredit, totalNoJob };
  }, [entries]);

  const exportCsv = () => {
    const header = ['timestamp', 'name', 'role', 'imei', 'services', 'cached', 'credit_used', 'status', 'job_id', 'source'];
    const rows = filtered.map((e) => [
      new Date(e.timestamp).toISOString(),
      e.name,
      e.role,
      e.imei,
      (e.service_ids || []).join('|'),
      (e.cached || []).join('|'),
      String(e.credit_used || 0),
      e.status,
      e.job_id || '',
      e.source || '',
    ]);
    const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sickw-usage-${windowDays}d-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-900 p-4 sm:p-8 text-white space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
          <ShieldCheck size={20} className="text-blue-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-black uppercase tracking-tight">Sickw Usage Audit</h1>
          <p className="text-xs text-slate-400">
            ทุก call ของ Sickw ถูกบันทึก พร้อม user / IMEI / credit — กันใช้ส่วนตัว
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg flex items-center gap-1 disabled:opacity-40"
        >
          <Download size={12} /> CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <SickwBalanceWidget />
        <Card label="Total checks" value={`${totals.totalChecks}`} icon={<Search size={16} className="text-blue-400" />} />
        <Card label="Credit ใช้รวม" value={`$${totals.totalCredit.toFixed(2)}`} icon={<Wallet size={16} className="text-emerald-400" />} />
        <Card label="ไม่ผูกใบงาน" value={`${totals.totalNoJob}`} alert={totals.totalNoJob > 0} icon={<AlertTriangle size={16} className={totals.totalNoJob > 0 ? 'text-red-400' : 'text-slate-400'} />} />
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3 border border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase">ช่วงเวลา:</span>
          {([7, 30, 90] as const).map((n) => (
            <button
              key={n}
              onClick={() => setWindowDays(n)}
              className={`px-3 py-1 rounded text-xs font-bold ${windowDays === n ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}
            >
              {n}d
            </button>
          ))}
        </div>
        <select
          value={filterUid}
          onChange={(e) => setFilterUid(e.target.value)}
          className="bg-slate-700 text-white text-xs px-3 py-1.5 rounded border border-slate-600 outline-none"
        >
          <option value="">ทุก user</option>
          {perUser.map((u) => (
            <option key={u.uid} value={u.uid}>{u.name} ({u.role})</option>
          ))}
        </select>
        <input
          type="text"
          value={filterImei}
          onChange={(e) => setFilterImei(e.target.value)}
          placeholder="ค้น IMEI / Serial..."
          className="bg-slate-700 text-white text-xs px-3 py-1.5 rounded border border-slate-600 outline-none font-mono"
        />
        <label className="flex items-center gap-1 text-xs text-slate-300">
          <input type="checkbox" checked={hideJobless} onChange={(e) => setHideJobless(e.target.checked)} />
          ซ่อนที่ผูกใบงานแล้ว → โชว์เฉพาะที่สงสัย
        </label>
      </div>

      {/* Per-user breakdown */}
      {perUser.length > 0 && (
        <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <h2 className="text-sm font-black uppercase tracking-tight">สรุปต่อคน ({windowDays} วัน)</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-700/30 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">ชื่อ</th>
                <th className="text-left px-4 py-2">Role</th>
                <th className="text-right px-4 py-2">Checks</th>
                <th className="text-right px-4 py-2">Credit</th>
                <th className="text-right px-4 py-2">ไม่ผูกใบงาน</th>
              </tr>
            </thead>
            <tbody>
              {perUser.map((u) => {
                const suspicious = u.noJobId > 0;
                return (
                  <tr key={u.uid} className="border-t border-slate-700/30 hover:bg-slate-700/20">
                    <td className="px-4 py-2 font-bold">{u.name}</td>
                    <td className="px-4 py-2 text-xs text-slate-400 font-mono">{u.role}</td>
                    <td className="px-4 py-2 text-right font-mono">{u.checks}</td>
                    <td className="px-4 py-2 text-right font-mono">${u.credit.toFixed(2)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${suspicious ? 'text-red-400 font-black' : 'text-slate-500'}`}>
                      {u.noJobId > 0 ? u.noJobId : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Log table */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2">
          <RefreshCw size={16} className="text-slate-400" />
          <h2 className="text-sm font-black uppercase tracking-tight">Audit Log ({filtered.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> โหลด log...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">ไม่มีข้อมูล</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-700/30 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2">เวลา</th>
                  <th className="text-left px-3 py-2">ผู้ใช้</th>
                  <th className="text-left px-3 py-2">IMEI / Serial</th>
                  <th className="text-left px-3 py-2">Services</th>
                  <th className="text-left px-3 py-2">Job</th>
                  <th className="text-right px-3 py-2">Credit</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((e, i) => {
                  const allCached = (e.cached || []).every(Boolean);
                  return (
                    <tr key={i} className={`border-t border-slate-700/30 ${!e.job_id ? 'bg-red-500/5' : ''}`}>
                      <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleString('th-TH')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-bold">{e.name}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{e.role}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-300">{e.imei}</td>
                      <td className="px-3 py-2 font-mono text-slate-400">
                        {(e.service_ids || []).map((id, idx) => (
                          <span key={id} className={e.cached?.[idx] ? 'opacity-50' : ''}>
                            {idx > 0 && ', '}{id}{e.cached?.[idx] ? '*' : ''}
                          </span>
                        ))}
                        {allCached && <span className="ml-2 text-[9px] uppercase bg-slate-700 text-slate-400 px-1 rounded">cached</span>}
                      </td>
                      <td className="px-3 py-2">
                        {e.job_id ? (
                          <a href={`/workspace/${e.job_id}`} className="text-blue-400 font-mono text-[11px] hover:underline">
                            {e.job_id.slice(-8)}
                          </a>
                        ) : (
                          <span className="text-red-400 font-bold text-[10px] uppercase">⚠ ไม่ผูก</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        ${(e.credit_used || 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          e.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                          'bg-amber-500/20 text-amber-300'
                        }`}>
                          {e.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="p-3 text-center text-[11px] text-slate-500">
                แสดง 500 รายการล่าสุดจาก {filtered.length} — ใช้ filter หรือ export CSV เพื่อดูเพิ่ม
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, icon, alert }: { label: string; value: string; icon?: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 border ${alert ? 'bg-red-500/10 border-red-500/30' : 'bg-slate-800 border-slate-700/50'}`}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`mt-1 text-xl font-black font-mono ${alert ? 'text-red-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}
