// รายงานภาษีหัก ณ ที่จ่าย ค่าตอบแทนไรเดอร์ — สำหรับยื่น ภ.ง.ด.3 (CEO / FINANCE)
//
// **ภาษีที่หักไว้ไม่ใช่รายได้ของบริษัท — เป็นเงินของไรเดอร์ที่บริษัทถือไว้แทน
// และต้องนำส่งกรมสรรพากรภายในวันที่ 7 ของเดือนถัดไป** ถ้าไม่มีหน้าที่บอกยอด
// ค้างนำส่ง เงินก้อนนี้จะนอนปนอยู่ในบัญชีบริษัทแล้วไม่มีใครยื่น = เบี้ยปรับ
// หน้านี้จึงเป็นส่วนบังคับของระบบหักภาษี ไม่ใช่ของแถม
//
// อ่านจาก /wht_certificates ที่ trigger `onRiderWhtWithheld` เขียนไว้ตอนออก
// หนังสือรับรอง (50 ทวิ) กรองตามงวด (period = YYYYMM เวลาไทย) ตาม .indexOn

import { useEffect, useMemo, useState } from 'react';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { Receipt, Loader2, Download, ExternalLink, AlertTriangle, Info } from 'lucide-react';
import { db } from '../../api/firebase';

interface WhtCert {
  number: string;
  period: string;
  rider_id: string | null;
  rider_name: string | null;
  rider_tax_id: string | null;
  gross: number;
  wht: number;
  net: number;
  rate_percent: number;
  paid_at: number;
  withdrawal_job_id: string;
  url?: string | null;
  status?: string;
  void_reason?: string;
}

function currentBangkokMonth(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (ms: number) => {
  try {
    return new Date(ms).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok' });
  } catch {
    return '';
  }
};

/** กำหนดนำส่ง ภ.ง.ด.3 = วันที่ 7 ของเดือนถัดจากงวด */
function remitDeadline(periodYm: string): string {
  const y = Number(periodYm.slice(0, 4));
  const m = Number(periodYm.slice(4, 6));
  if (!y || !m) return '';
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `7 ${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][nm - 1]} ${ny + 543}`;
}

export default function WhtReport() {
  const [month, setMonth] = useState<string>(currentBangkokMonth()); // YYYY-MM
  const [rows, setRows] = useState<WhtCert[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const period = month.replace('-', '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    get(query(ref(db, 'wht_certificates'), orderByChild('period'), equalTo(period)))
      .then((snap) => {
        if (cancelled) return;
        const list: WhtCert[] = [];
        snap.forEach((c) => { list.push(c.val() as WhtCert); return undefined; });
        list.sort((a, b) => (a.paid_at || 0) - (b.paid_at || 0));
        setRows(list);
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'อ่านข้อมูลไม่สำเร็จ'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  // ใบที่ยกเลิก (ออกเอกสารไม่สำเร็จ) ไม่นับเป็นยอดนำส่ง แต่ยังต้องแสดงให้เห็น
  // เพื่อให้ลำดับเลขอธิบายได้
  const live = useMemo(() => rows.filter((r) => r.status !== 'void'), [rows]);
  const totals = useMemo(
    () => live.reduce(
      (a, r) => ({ gross: a.gross + (Number(r.gross) || 0), wht: a.wht + (Number(r.wht) || 0) }),
      { gross: 0, wht: 0 },
    ),
    [live],
  );
  const riderCount = useMemo(() => new Set(live.map((r) => r.rider_id).filter(Boolean)).size, [live]);

  const exportCsv = () => {
    const header = ['ลำดับ', 'วันที่จ่าย', 'เลขที่หนังสือรับรอง', 'ผู้ถูกหักภาษี', 'เลขประจำตัวผู้เสียภาษี', 'จำนวนเงินที่จ่าย', 'อัตรา %', 'ภาษีที่หัก', 'ยอดโอนจริง', 'สถานะ'];
    const lines = rows.map((r, i) => [
      i + 1,
      fmtDate(r.paid_at),
      r.number,
      (r.rider_name || '').replace(/"/g, '""'),
      r.rider_tax_id || '',
      (Number(r.gross) || 0).toFixed(2),
      String(r.rate_percent ?? ''),
      (Number(r.wht) || 0).toFixed(2),
      (Number(r.net) || 0).toFixed(2),
      r.status === 'void' ? `ยกเลิก — ${r.void_reason || ''}` : 'ออกแล้ว',
    ]);
    lines.push(['', '', '', '', 'รวมทั้งสิ้น', totals.gross.toFixed(2), '', totals.wht.toFixed(2), '', '']);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${c}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ภงด3-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-screen bg-slate-900 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Receipt size={24} className="text-amber-400" /> ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3)
            </h1>
            <p className="text-xs font-bold text-slate-400 mt-1">
              ค่าตอบแทนไรเดอร์อิสระ — ภาษีที่หักไว้ต้องนำส่งกรมสรรพากร
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 bg-amber-500 text-slate-900 px-4 py-2 rounded-xl text-xs font-black disabled:opacity-40"
            >
              <Download size={14} /> CSV
            </button>
          </div>
        </div>

        {totals.wht > 0 && (
          <div className="bg-amber-950/40 border border-amber-600/40 rounded-2xl p-4 mb-4 flex items-start gap-3">
            <Info size={18} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs font-bold text-amber-200">
              ยอด <span className="font-black text-amber-300">{fmt(totals.wht)} บาท</span> นี้เป็นเงินของไรเดอร์ที่บริษัทถือไว้แทน
              ต้องยื่นแบบ ภ.ง.ด.3 และนำส่งภายใน <span className="font-black text-amber-300">{remitDeadline(period)}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
            <p className="text-[11px] font-black text-slate-400 uppercase">เงินที่จ่ายรวม</p>
            <p className="text-lg font-black text-white">{fmt(totals.gross)}</p>
          </div>
          <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
            <p className="text-[11px] font-black text-slate-400 uppercase">ภาษีที่หักและต้องนำส่ง</p>
            <p className="text-lg font-black text-amber-400">{fmt(totals.wht)}</p>
          </div>
          <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
            <p className="text-[11px] font-black text-slate-400 uppercase">จำนวนผู้ถูกหัก</p>
            <p className="text-lg font-black text-white">{riderCount} คน · {live.length} ใบ</p>
          </div>
        </div>

        {err && (
          <div className="bg-rose-950/40 border border-rose-600/40 rounded-2xl p-4 mb-4 flex items-start gap-2 text-xs font-bold text-rose-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {err}
          </div>
        )}

        <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
          {loading ? (
            <div className="p-10 flex items-center justify-center gap-2 text-slate-400 font-bold text-sm">
              <Loader2 size={18} className="animate-spin" /> กำลังโหลด...
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-slate-500 font-bold text-sm">
              ไม่มีการหักภาษี ณ ที่จ่ายในงวดนี้
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/50 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-bold text-left">วันที่จ่าย</th>
                    <th className="px-3 py-2 font-bold text-left">เลขที่</th>
                    <th className="px-3 py-2 font-bold text-left">ผู้ถูกหักภาษี</th>
                    <th className="px-3 py-2 font-bold text-right">เงินที่จ่าย</th>
                    <th className="px-3 py-2 font-bold text-right">ภาษีที่หัก</th>
                    <th className="px-3 py-2 font-bold text-right">โอนจริง</th>
                    <th className="px-3 py-2 font-bold text-center">เอกสาร</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.number} className="border-b border-slate-700/30 text-slate-200">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.paid_at)}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {r.number}
                        {r.status === 'void' && (
                          <span className="ml-1.5 text-[10px] font-black text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded px-1 py-0.5">
                            ยกเลิก
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.status === 'void' ? (
                          <span className="text-slate-500">{r.void_reason || 'ไม่ได้ออกเอกสาร'}</span>
                        ) : (
                          <>
                            <div>{r.rider_name || '-'}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{r.rider_tax_id || 'ไม่มีเลขผู้เสียภาษี'}</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.gross)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-amber-400">{fmt(r.wht)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.net)}</td>
                      <td className="px-3 py-2 text-center">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex">
                            <ExternalLink size={14} />
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-900/50 font-black text-white">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>รวมทั้งสิ้น</td>
                    <td className="px-3 py-2 text-right">{fmt(totals.gross)}</td>
                    <td className="px-3 py-2 text-right text-amber-400">{fmt(totals.wht)}</td>
                    <td className="px-3 py-2" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <p className="text-[11px] font-bold text-slate-500 mt-4">
          ใบที่ขึ้นว่า &quot;ยกเลิก&quot; คือเลขที่ถูกจองแล้วแต่สร้างเอกสารไม่สำเร็จ ไม่นับเป็นยอดนำส่ง
          แต่แสดงไว้เพื่อให้ลำดับเลขอธิบายได้ตอนถูกตรวจ
        </p>
      </div>
    </div>
  );
}
