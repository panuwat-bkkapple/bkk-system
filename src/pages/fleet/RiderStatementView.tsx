// src/pages/fleet/RiderStatementView.tsx — หน้าตาของ statement กระเป๋าไรเดอร์ (pure)
//
// แยกจาก RiderStatementPage เพื่อให้ SSR ได้โดยไม่ลาก Firebase (ตรวจตาด้วย harness +
// เทสได้) — **ห้าม import จาก api/firebase หรือ hooks ที่ต่อ DB ในไฟล์นี้**
// ไม่มีปุ่มเขียนเงินใดๆ: หน้านี้อ่านอย่างเดียวโดยโครงสร้าง (ด่าน riderStatementReadOnly.test.ts)
import { AlertTriangle, ArrowRight, Bike, Download, Scale } from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';
import { MISMATCH_LABEL_TH, WARNING_LABEL_TH, formatStatementTime } from '../../utils/riderStatement';
import type { Statement, StatementRow } from '../../utils/riderStatement';

export interface RiderOption {
  id: string;
  name: string;
  approvalStatus: string | null;
  /** rider_id นี้ไม่มีแฟ้มใน /riders (โผล่จาก ledger หรือพิมพ์เอง) */
  orphan?: boolean;
}

export interface RiderStatementViewProps {
  riders: RiderOption[];
  riderId: string;
  riderName: string | null;
  fromYmd: string;
  toYmd: string;
  statement: Statement | null;
  loading: boolean;
  error: string | null;
  /** เหลืองานที่อ้างถึงแต่ยังเช็ค jobs_archived ไม่ครบ (เกินเพดาน) */
  archiveLookupCapped: boolean;
  onRiderChange: (id: string) => void;
  onFromChange: (ymd: string) => void;
  onToChange: (ymd: string) => void;
  onExport: () => void;
  jobHref: (jobId: string) => string;
}

const money = (n: number | null) => (n === null ? <span className="text-slate-300">—</span> : formatCurrency(n));
const signed = (n: number) => (n < 0 ? `−${formatCurrency(Math.abs(n))}` : formatCurrency(n));

const RefCell = ({ row, jobHref }: { row: StatementRow; jobHref: (id: string) => string }) => {
  const { ref } = row;
  if (ref.kind === 'job' && ref.id) {
    return <a href={jobHref(ref.id)} className="font-bold text-blue-600 hover:underline">{ref.refNo || ref.id}</a>;
  }
  if (ref.kind === 'withdrawal') return <span className="font-mono text-[11px] text-slate-600">คำขอถอน {ref.id}</span>;
  if (ref.kind === 'expense') return <span className="font-mono text-[11px] text-slate-600">ใบเบิก {ref.id}</span>;
  if (ref.kind === 'job_archived') return <span className="text-slate-500">{ref.refNo || ref.id} <span className="text-[10px] text-slate-400">(archive)</span></span>;
  if (ref.kind === 'job_missing') return <span className="font-mono text-[11px] text-amber-700">{ref.id} <span className="text-[10px]">(ไม่พบ)</span></span>;
  return <span className="text-slate-300">—</span>;
};

const Warnings = ({ row }: { row: StatementRow }) =>
  row.warnings.length === 0 ? null : (
    <div className="mt-1 flex flex-wrap gap-1">
      {row.warnings.map((w) => (
        <span key={w} className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200" title={w}>
          <AlertTriangle size={10} /> {WARNING_LABEL_TH[w]}
        </span>
      ))}
    </div>
  );

export const RiderStatementView = (p: RiderStatementViewProps) => {
  const s = p.statement;
  const rc = s?.reconcile ?? null;
  const balanced = rc ? Math.abs(rc.diff) < 0.005 : null;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Bike size={24} className="text-orange-500" /> สมุดบัญชีไรเดอร์ (Statement)</h1>
            <p className="text-xs font-bold text-slate-400 mt-1">
              อ่านอย่างเดียว — ยอดคงเหลือสะสมคำนวณด้วยสูตรเดียวกับแอปไรเดอร์ (mirror ของ walletLedger) จึงเท่ากันโดยนิยาม · ยอดคงเหลือ/reconcile เป็นของทั้งประวัติ ส่วนช่วงวันที่เป็นแค่ตัวกรองตาราง
            </p>
          </div>
          <button type="button" onClick={p.onExport} disabled={!s} className="inline-flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase shadow-lg hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {/* ตัวเลือก */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="md:col-span-2 block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">ไรเดอร์ (ทุกสถานะ รวมบัญชีที่ต้องตรวจย้อนหลัง)</span>
            <select value={p.riderId} onChange={(e) => p.onRiderChange(e.target.value)} className="mt-1 w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:ring-4 ring-orange-500/5">
              <option value="">— เลือกไรเดอร์ —</option>
              {p.riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || '(ไม่มีชื่อ)'}{r.approvalStatus ? ` · ${r.approvalStatus}` : ''}{r.orphan ? ' · ไม่อยู่ใน /riders' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">จากวันที่</span>
            <input type="date" value={p.fromYmd} onChange={(e) => p.onFromChange(e.target.value)} className="mt-1 w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none" />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">ถึงวันที่</span>
            <input type="date" value={p.toYmd} onChange={(e) => p.onToChange(e.target.value)} className="mt-1 w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none" />
          </label>
        </div>

        {p.error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm font-bold flex items-center gap-2"><AlertTriangle size={16} /> {p.error}</div>
        )}

        {!p.riderId && !p.error && (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">เลือกไรเดอร์เพื่อดู statement</div>
        )}

        {p.riderId && p.loading && (
          <div className="p-10 text-center font-black text-slate-300 animate-pulse uppercase">Loading ledger...</div>
        )}

        {s && !p.loading && (
          <>
            {/* ยอด */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-[2rem] border border-slate-100 p-6">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">ยอดคงเหลือ (ledger)</div>
                <div className={`text-3xl font-black mt-1 ${s.balance < 0 ? 'text-red-500' : 'text-slate-800'}`}>{signed(s.balance)}</div>
                <div className="text-[11px] font-bold text-slate-400 mt-1">{p.riderName || p.riderId} · {s.rows.filter((r) => r.counted).length} แถวที่นับ / {s.rows.length} แถวทั้งหมด</div>
              </div>
              <div className="bg-white rounded-[2rem] border border-slate-100 p-6">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">ยอดจอง (คำขอถอนค้าง)</div>
                <div className="text-3xl font-black mt-1 text-amber-600">{signed(-s.hold)}</div>
                <div className="text-[11px] font-bold text-slate-400 mt-1 space-y-0.5">
                  {s.requested.length === 0 && <div>ไม่มีคำขอถอนค้าง</div>}
                  {s.requested.map((w) => (
                    <div key={w.id} className="font-mono">{w.id} · {formatCurrency(w.amount)} · {formatStatementTime(w.requestedAt) || '-'}</div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-[2rem] border border-slate-100 p-6">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">ยอดถอนได้ (C = A − จอง)</div>
                <div className={`text-3xl font-black mt-1 ${s.available < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{signed(s.available)}</div>
              </div>
            </div>

            {/* ตาราง passbook */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                      <th className="p-4 pl-6">วันที่-เวลา</th>
                      <th className="p-4">รายการ</th>
                      <th className="p-4">อ้างอิง</th>
                      <th className="p-4 text-right">Dr (ออก)</th>
                      <th className="p-4 text-right">Cr (เข้า)</th>
                      <th className="p-4 text-right">คงเหลือสะสม</th>
                      <th className="p-4 pr-6">ที่มา</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    <tr className="bg-slate-50/60">
                      <td className="p-4 pl-6 text-[11px] font-bold text-slate-400" colSpan={5}>ยอดยกมาก่อน {p.fromYmd || 'เริ่มต้น'}</td>
                      <td className="p-4 text-right font-black text-slate-600 tabular-nums">{signed(s.opening)}</td>
                      <td className="p-4" />
                    </tr>
                    {s.visible.map((r) => (
                      <tr key={r.id} className={`hover:bg-slate-50/50 transition-colors ${r.counted ? '' : 'opacity-50'}`}>
                        <td className="p-4 pl-6 align-top">
                          <div className="text-[11px] font-bold text-slate-600 tabular-nums">{formatStatementTime(r.at) || <span className="text-amber-600">ไม่มีเวลา</span>}</div>
                          <div className="text-[10px] font-mono text-slate-300 mt-0.5">{r.id}</div>
                        </td>
                        <td className="p-4 align-top">
                          <div className="font-bold text-slate-800">{r.detail}</div>
                          <div className="text-[10px] font-bold text-slate-400 mt-0.5 flex flex-wrap gap-1 items-center">
                            <span>{r.category || '(ไม่มีหมวด)'} · {r.type || '(ไม่มี type)'}</span>
                            {!r.counted && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-200">ไม่นับเข้ากระเป๋า</span>
                            )}
                          </div>
                          <Warnings row={r} />
                        </td>
                        <td className="p-4 align-top text-xs"><RefCell row={r} jobHref={p.jobHref} /></td>
                        <td className="p-4 align-top text-right font-bold text-red-500 tabular-nums">{money(r.dr)}</td>
                        <td className="p-4 align-top text-right font-bold text-emerald-600 tabular-nums">{money(r.cr)}</td>
                        <td className="p-4 align-top text-right font-black text-slate-800 tabular-nums">{r.running === null ? <span className="text-slate-300">—</span> : signed(r.running)}</td>
                        <td className="p-4 pr-6 align-top text-[11px] font-bold text-slate-500">{r.source || <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                    {s.visible.length === 0 && (
                      <tr><td colSpan={7} className="p-16 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">ไม่มีรายการในช่วงที่เลือก</td></tr>
                    )}
                    <tr className="bg-slate-50/60 border-t border-slate-100">
                      <td className="p-4 pl-6 text-[11px] font-bold text-slate-500" colSpan={5}>ยอดคงเหลือ (ทั้งประวัติ)</td>
                      <td className="p-4 text-right font-black text-slate-800 tabular-nums">{signed(s.balance)}</td>
                      <td className="p-4" />
                    </tr>
                    <tr className="bg-slate-50/60">
                      <td className="p-4 pl-6 text-[11px] font-bold text-amber-700" colSpan={5}>ยอดจอง — คำขอถอนที่ยังรอจ่าย ({s.requested.length} ใบ)</td>
                      <td className="p-4 text-right font-black text-amber-700 tabular-nums">{signed(-s.hold)}</td>
                      <td className="p-4" />
                    </tr>
                  </tbody>
                </table>
              </div>
              {p.archiveLookupCapped && (
                <div className="px-6 py-3 text-[11px] font-bold text-amber-700 bg-amber-50 border-t border-amber-100">
                  งานที่อ้างถึงแต่ไม่พบใน /jobs มีมากกว่าเพดานที่เช็ค jobs_archived ต่อครั้ง — บางแถวจึงขึ้น "ไม่พบ" ทั้งที่อาจถูก archive แล้ว
                </div>
              )}
            </div>

            {/* Reconcile */}
            {rc && (
              <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 p-6 space-y-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="text-lg font-black text-slate-800 flex items-center gap-2"><Scale size={18} className="text-slate-500" /> Reconcile — สามยอดที่ต้องเท่ากัน</h2>
                  <span className={`text-[10px] font-black px-3 py-1 rounded-full border ${balanced ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {balanced ? 'A = B' : `A − B = ${signed(rc.diff)}`}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="rounded-2xl border border-slate-100 p-4">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">A · ยอด ledger</div>
                    <div className="text-2xl font-black text-slate-800 mt-1 tabular-nums">{signed(rc.ledger)}</div>
                    <div className="text-[11px] text-slate-400 font-bold mt-1">walletBalance ของแถวที่ผ่าน allowlist</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 p-4">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">B · ประกอบจากงาน</div>
                    <div className="text-2xl font-black text-slate-800 mt-1 tabular-nums">{signed(rc.fromJobs.total)}</div>
                    <div className="text-[11px] text-slate-500 font-bold mt-2 space-y-0.5 tabular-nums">
                      <div className="flex justify-between gap-3"><span>Σ rider_fee งาน Paid ({rc.fromJobs.paidJobCount} ใบ)</span><span>{signed(rc.fromJobs.paidFees)}</span></div>
                      <div className="flex justify-between gap-3"><span>− Σ ถอนเงิน (WITHDRAWAL)</span><span>{signed(-rc.fromJobs.withdrawals)}</span></div>
                      <div className="flex justify-between gap-3"><span>± ปรับปรุงค่ารอบ (ADJUSTMENT)</span><span>{signed(rc.fromJobs.adjustments)}</span></div>
                      {rc.fromJobs.others.map((o) => (
                        <div key={o.category} className="flex justify-between gap-3"><span>± {o.label}</span><span>{signed(o.amount)}</span></div>
                      ))}
                      <div className="flex justify-between gap-3 text-slate-400"><span>เช็ค: Σ /withdrawals ที่จ่ายแล้ว</span><span>{signed(rc.withdrawalsNodePaid)}{Math.abs(rc.withdrawalsNodePaid - rc.fromJobs.withdrawals) > 0.005 ? ' ≠ ledger' : ' ✓'}</span></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 p-4">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">C · ยอดถอนได้</div>
                    <div className={`text-2xl font-black mt-1 tabular-nums ${rc.available < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{signed(rc.available)}</div>
                    <div className="text-[11px] text-slate-400 font-bold mt-1">A − ยอดจอง {formatCurrency(rc.hold)}</div>
                  </div>
                </div>

                {!balanced && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                      <div className="text-xs font-black text-amber-800 mb-2">(i) งาน Paid ที่ไม่มี JOB_PAYOUT ใน ledger — {rc.paidJobsWithoutPayout.length} ใบ</div>
                      {rc.paidJobsWithoutPayout.length === 0 ? <div className="text-[11px] text-slate-400 font-bold">ไม่มี</div> : (
                        <ul className="space-y-1 text-xs">
                          {rc.paidJobsWithoutPayout.map((j) => (
                            <li key={j.jobId} className="flex items-center justify-between gap-3">
                              <a href={p.jobHref(j.jobId)} className="font-bold text-blue-600 hover:underline inline-flex items-center gap-1">{j.refNo || j.jobId} <ArrowRight size={11} /></a>
                              <span className="text-slate-500 font-bold tabular-nums">{j.fee === null ? 'ไม่มี rider_fee' : formatCurrency(j.fee)} · {formatStatementTime(j.settledAt) || 'ไม่มี settled_at'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
                      <div className="text-xs font-black text-amber-800 mb-2">(ii) JOB_PAYOUT ที่งานไม่ใช่ Paid หรือยอด ≠ rider_fee — {rc.payoutsNotMatchingJob.length} แถว</div>
                      {rc.payoutsNotMatchingJob.length === 0 ? <div className="text-[11px] text-slate-400 font-bold">ไม่มี</div> : (
                        <ul className="space-y-1 text-xs">
                          {rc.payoutsNotMatchingJob.map((m) => (
                            <li key={m.txId} className="flex items-start justify-between gap-3">
                              <div>
                                {m.jobId && !m.reasons.includes('job_missing') && !m.reasons.includes('job_archived')
                                  ? <a href={p.jobHref(m.jobId)} className="font-bold text-blue-600 hover:underline">{m.refNo || m.jobId}</a>
                                  : <span className="font-mono text-slate-500">{m.refNo || m.jobId || '(ไม่มี ref)'}</span>}
                                <div className="text-[10px] text-amber-700 font-bold">{m.reasons.map((r) => MISMATCH_LABEL_TH[r]).join(' · ')}{m.feeStatus ? ` · สถานะ ${m.feeStatus}` : ''}</div>
                                <div className="text-[10px] font-mono text-slate-300">{m.txId}</div>
                              </div>
                              <span className="text-slate-500 font-bold tabular-nums whitespace-nowrap">ledger {formatCurrency(m.amount)}{m.fee !== null ? ` / งาน ${formatCurrency(m.fee)}` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
