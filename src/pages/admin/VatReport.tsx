// รายงานภาษีขาย (Output VAT) — สำหรับยื่น ภ.พ.30 (CEO / FINANCE)
//
// อ่านจาก /accounting_documents (เขียนโดย Cloud Functions ตอนออกใบกำกับภาษี)
// กรองตามงวด (period = YYYYMM, อิงเวลาไทย) แล้วสรุปมูลค่า + VAT รวม
// เพื่อให้บัญชีนำไปยื่นได้โดยไม่ต้องคีย์ซ้ำในระบบบัญชีภายนอก.

import { useEffect, useMemo, useState } from 'react';
import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { FileSpreadsheet, Loader2, Download, ExternalLink, ReceiptText } from 'lucide-react';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

interface TaxDoc {
  type: string;
  number: string;
  job_id: string;
  ref_no: string | null;
  issued_at: number;
  period: string;
  customer_name: string | null;
  base: number;
  vat: number;
  total: number;
  url?: string | null;
  description?: string;
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

export default function VatReport() {
  const toast = useToast();
  const [month, setMonth] = useState<string>(currentBangkokMonth()); // YYYY-MM
  const [rows, setRows] = useState<TaxDoc[]>([]);
  const [loading, setLoading] = useState(false);

  const period = month.replace('-', ''); // YYYYMM

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = query(ref(db, 'accounting_documents'), orderByChild('period'), equalTo(period));
    get(q)
      .then((snap) => {
        if (cancelled) return;
        const out: TaxDoc[] = [];
        snap.forEach((c) => {
          const v = c.val();
          if (v && v.type === 'tax_invoice') out.push(v as TaxDoc);
        });
        out.sort((a, b) => (a.issued_at || 0) - (b.issued_at || 0));
        setRows(out);
      })
      .catch((e) => {
        if (!cancelled) toast.error('โหลดรายงานไม่สำเร็จ: ' + (e?.message || e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, toast]);

  const totals = useMemo(
    () => rows.reduce((a, r) => ({ base: a.base + (Number(r.base) || 0), vat: a.vat + (Number(r.vat) || 0), total: a.total + (Number(r.total) || 0) }), { base: 0, vat: 0, total: 0 }),
    [rows]
  );

  const exportCsv = () => {
    const header = ['ลำดับ', 'วันที่', 'เลขที่ใบกำกับภาษี', 'ลูกค้า', 'รายการ', 'มูลค่า', 'VAT', 'รวม'];
    const lines = rows.map((r, i) => [
      i + 1,
      fmtDate(r.issued_at),
      r.number,
      (r.customer_name || '').replace(/"/g, '""'),
      (r.description || '').replace(/"/g, '""'),
      (Number(r.base) || 0).toFixed(2),
      (Number(r.vat) || 0).toFixed(2),
      (Number(r.total) || 0).toFixed(2),
    ]);
    lines.push(['', '', '', '', 'รวมทั้งสิ้น', totals.base.toFixed(2), totals.vat.toFixed(2), totals.total.toFixed(2)]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${c}"`).join(',')).join('\r\n');
    // BOM so Excel reads Thai UTF-8 correctly
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `รายงานภาษีขาย-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
          <FileSpreadsheet size={22} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white">รายงานภาษีขาย (Output VAT)</h1>
          <p className="text-xs text-slate-400">สรุปใบกำกับภาษีที่ออก สำหรับยื่น ภ.พ.30</p>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-300 font-bold">งวดภาษี</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-blue-500"
        />
        <div className="flex-1" />
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm flex items-center gap-2 disabled:opacity-40"
        >
          <Download size={15} /> Export CSV
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
          <p className="text-xs text-slate-400">มูลค่าบริการ (ก่อน VAT)</p>
          <p className="text-lg font-black text-white">{fmt(totals.base)}</p>
        </div>
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
          <p className="text-xs text-slate-400">ภาษีขาย (VAT)</p>
          <p className="text-lg font-black text-emerald-400">{fmt(totals.vat)}</p>
        </div>
        <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50">
          <p className="text-xs text-slate-400">รวมทั้งสิ้น ({rows.length} ใบ)</p>
          <p className="text-lg font-black text-white">{fmt(totals.total)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <ReceiptText className="mx-auto mb-2 opacity-40" size={28} />
            ไม่มีใบกำกับภาษีในงวดนี้
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-700/50">
                  <th className="px-3 py-2 font-bold">วันที่</th>
                  <th className="px-3 py-2 font-bold">เลขที่</th>
                  <th className="px-3 py-2 font-bold">ลูกค้า</th>
                  <th className="px-3 py-2 font-bold text-right">มูลค่า</th>
                  <th className="px-3 py-2 font-bold text-right">VAT</th>
                  <th className="px-3 py-2 font-bold text-right">รวม</th>
                  <th className="px-3 py-2 font-bold text-center">PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.number} className="border-b border-slate-700/30 text-slate-200">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.issued_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.number}</td>
                    <td className="px-3 py-2">{r.customer_name || '-'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(r.base)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-emerald-400">{fmt(r.vat)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-bold">{fmt(r.total)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex">
                          <ExternalLink size={14} />
                        </a>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900/50 font-black text-white">
                  <td className="px-3 py-2" colSpan={3}>รวมทั้งสิ้น</td>
                  <td className="px-3 py-2 text-right">{fmt(totals.base)}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">{fmt(totals.vat)}</td>
                  <td className="px-3 py-2 text-right">{fmt(totals.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
