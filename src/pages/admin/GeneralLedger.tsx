// สมุดรายวัน (double-entry journal) + งบทดลอง (trial balance) — Phase 4d
// ลงรายการบัญชีคู่ด้วยมือ + ดูงบทดลองรายงวด. auto-posting จาก operation
// (POS/ออเดอร์/ค่าใช้จ่าย) + งบการเงิน จะตามมาใน sub-PR ถัดไป.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { ref, push, get, query, orderByChild, equalTo } from 'firebase/database';
import { BookOpen, Plus, Trash2, Save, Loader2, Scale, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { db, auth } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  DEFAULT_COA, ACCOUNT_BY_CODE, ACCOUNT_TYPE_TH, normalSide,
  entryIsBalanced, periodFromDate, round2,
  type JournalEntry, type JournalLine, type AccountType,
} from '../../utils/accounting';

function currentBangkokDate(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
const fmt = (n: number) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ACCOUNT_GROUPS = (['asset', 'liability', 'equity', 'revenue', 'expense'] as AccountType[]).map((type) => ({
  type, label: ACCOUNT_TYPE_TH[type], accounts: DEFAULT_COA.filter((a) => a.type === type),
}));

export default function GeneralLedger() {
  const toast = useToast();
  const [tab, setTab] = useState<'journal' | 'trial'>('journal');
  const [month, setMonth] = useState<string>(currentBangkokDate().slice(0, 7)); // YYYY-MM
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const period = month.replace('-', '');

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    get(query(ref(db, 'journal_entries'), orderByChild('period'), equalTo(period)))
      .then((snap) => {
        const out: JournalEntry[] = [];
        snap.forEach((c) => { const v = c.val(); if (v) out.push({ id: c.key, ...v }); });
        out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        setEntries(out);
      })
      .catch((e) => { setEntries([]); setErr('อ่านสมุดรายวันไม่ได้: ' + (e?.message || e)); })
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  // ── New entry form ─────────────────────────────────────────────────────────
  const [date, setDate] = useState(currentBangkokDate());
  const [desc, setDesc] = useState('');
  const [refNo, setRefNo] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([
    { account: '', debit: 0, credit: 0 },
    { account: '', debit: 0, credit: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  const totalDebit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const balanced = entryIsBalanced(lines) && lines.every((l) => !((Number(l.debit) || 0) > 0 && (Number(l.credit) || 0) > 0));
  const canSave = balanced && desc.trim() && lines.filter((l) => l.account && ((Number(l.debit) || 0) || (Number(l.credit) || 0))).length >= 2;

  const setLine = (i: number, patch: Partial<JournalLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const clean = lines
        .filter((l) => l.account && ((Number(l.debit) || 0) || (Number(l.credit) || 0)))
        .map((l) => ({ account: l.account, debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0) }));
      const entry: JournalEntry = {
        date, period: periodFromDate(date), description: desc.trim(), ref: refNo.trim() || undefined,
        source: 'manual', lines: clean, created_at: Date.now(), created_by: auth.currentUser?.email || 'unknown',
      };
      await push(ref(db, 'journal_entries'), entry);
      toast.success('บันทึกรายการเรียบร้อย');
      setDesc(''); setRefNo(''); setLines([{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }]);
      if (periodFromDate(date) === period) load();
    } catch (e: any) {
      toast.error('บันทึกไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  // ── Trial balance ──────────────────────────────────────────────────────────
  const trial = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const e of entries) {
      for (const l of e.lines || []) {
        const cur = map.get(l.account) || { debit: 0, credit: 0 };
        cur.debit += Number(l.debit) || 0;
        cur.credit += Number(l.credit) || 0;
        map.set(l.account, cur);
      }
    }
    const rows = [...map.entries()].map(([code, v]) => {
      const acc = ACCOUNT_BY_CODE[code];
      const net = round2(v.debit - v.credit);
      const side = acc ? normalSide(acc.type) : (net >= 0 ? 'debit' : 'credit');
      return {
        code, name: acc?.name || code,
        debit: side === 'debit' ? Math.max(net, 0) || (net > 0 ? net : 0) : 0,
        credit: side === 'credit' ? Math.max(-net, 0) || (net < 0 ? -net : 0) : 0,
        rawNet: net,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));
    // present each account's balance on the side of its net
    const norm = rows.map((r) => ({ code: r.code, name: r.name, debit: r.rawNet >= 0 ? r.rawNet : 0, credit: r.rawNet < 0 ? -r.rawNet : 0 }));
    const td = round2(norm.reduce((s, r) => s + r.debit, 0));
    const tc = round2(norm.reduce((s, r) => s + r.credit, 0));
    return { rows: norm, td, tc, balanced: td === tc };
  }, [entries]);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
          <BookOpen size={22} className="text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white">สมุดรายวัน &amp; งบทดลอง</h1>
          <p className="text-xs text-slate-400">บันทึกบัญชีคู่ (double-entry) + ตรวจงบทดลองรายงวด</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setTab('journal')} className={`px-4 py-2 rounded-xl text-sm font-bold ${tab === 'journal' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>สมุดรายวัน</button>
        <button onClick={() => setTab('trial')} className={`px-4 py-2 rounded-xl text-sm font-bold ${tab === 'trial' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>งบทดลอง</button>
        <div className="flex-1" />
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </div>

      {err && (
        <div className="rounded-2xl p-4 bg-amber-950/30 border border-amber-700/40 flex gap-3">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/90">{err}</p>
        </div>
      )}

      {tab === 'journal' && (
        <>
          {/* New entry */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700/50 p-5 space-y-3">
            <div className="flex items-center gap-2"><Plus size={16} className="text-indigo-400" /><h2 className="font-black text-white text-sm">บันทึกรายการใหม่</h2></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
              <input type="text" placeholder="คำอธิบายรายการ" value={desc} onChange={(e) => setDesc(e.target.value)} className="sm:col-span-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />
            </div>
            <input type="text" placeholder="เลขที่อ้างอิง (ไม่บังคับ)" value={refNo} onChange={(e) => setRefNo(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm" />

            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} className="col-span-6 px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs">
                    <option value="">— เลือกบัญชี —</option>
                    {ACCOUNT_GROUPS.map((g) => (
                      <optgroup key={g.type} label={g.label}>
                        {g.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <input type="number" placeholder="เดบิต" value={l.debit || ''} onChange={(e) => setLine(i, { debit: Number(e.target.value), credit: 0 })} className="col-span-2 px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs text-right" />
                  <input type="number" placeholder="เครดิต" value={l.credit || ''} onChange={(e) => setLine(i, { credit: Number(e.target.value), debit: 0 })} className="col-span-3 px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs text-right" />
                  <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} disabled={lines.length <= 2} className="col-span-1 text-rose-400 disabled:opacity-30 flex justify-center"><Trash2 size={15} /></button>
                </div>
              ))}
              <button onClick={() => setLines([...lines, { account: '', debit: 0, credit: 0 }])} className="text-xs text-indigo-400 font-bold inline-flex items-center gap-1"><Plus size={13} /> เพิ่มบรรทัด</button>
            </div>

            <div className="flex items-center justify-between border-t border-slate-700/50 pt-3 text-sm">
              <div className={`flex items-center gap-2 font-bold ${balanced ? 'text-emerald-400' : 'text-amber-400'}`}>
                {balanced ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                เดบิต {fmt(totalDebit)} / เครดิต {fmt(totalCredit)} {balanced ? '(สมดุล)' : '(ไม่สมดุล)'}
              </div>
              <button onClick={save} disabled={!canSave || saving} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-xl text-sm flex items-center gap-2 disabled:opacity-40">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} บันทึก
              </button>
            </div>
          </div>

          {/* Journal list */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/50 text-xs font-black text-slate-400 uppercase">รายการในงวด {month} ({entries.length})</div>
            {loading ? <div className="p-8 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={16} /> โหลด...</div>
              : entries.length === 0 ? <div className="p-8 text-center text-slate-400 text-sm">ยังไม่มีรายการ</div>
              : entries.map((e) => (
                <div key={e.id} className="px-4 py-3 border-b border-slate-700/30">
                  <div className="flex justify-between text-sm"><span className="font-bold text-white">{e.date} · {e.description}</span>{e.ref && <span className="text-xs text-slate-500">{e.ref}</span>}</div>
                  {(e.lines || []).map((l, i) => (
                    <div key={i} className="flex justify-between text-xs text-slate-300 pl-3 mt-1">
                      <span>{ACCOUNT_BY_CODE[l.account]?.name || l.account}</span>
                      <span className="font-mono">{l.debit ? `Dr ${fmt(l.debit)}` : `   Cr ${fmt(l.credit)}`}</span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </>
      )}

      {tab === 'trial' && (
        <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-2 text-xs font-black text-slate-400 uppercase">
            <Scale size={14} /> งบทดลอง · งวด {month}
          </div>
          {loading ? <div className="p-8 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={16} /> โหลด...</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 border-b border-slate-700/50">
                <th className="px-4 py-2 text-left">บัญชี</th><th className="px-4 py-2 text-right">เดบิต</th><th className="px-4 py-2 text-right">เครดิต</th>
              </tr></thead>
              <tbody>
                {trial.rows.map((r) => (
                  <tr key={r.code} className="border-b border-slate-700/30 text-slate-200">
                    <td className="px-4 py-2">{r.code} {r.name}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.debit ? fmt(r.debit) : ''}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.credit ? fmt(r.credit) : ''}</td>
                  </tr>
                ))}
                {trial.rows.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">ไม่มีรายการในงวดนี้</td></tr>}
              </tbody>
              <tfoot><tr className={`font-black ${trial.balanced ? 'bg-slate-900/50 text-white' : 'bg-rose-950/40 text-rose-300'}`}>
                <td className="px-4 py-2">รวม {trial.balanced ? '(สมดุล)' : '(ไม่สมดุล!)'}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(trial.td)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(trial.tc)}</td>
              </tr></tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
