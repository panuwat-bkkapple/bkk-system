// รายงานการเงิน (P&L รายเดือน + ภาษีมูลค่าเพิ่มสุทธิ) — Phase 4 (CEO / FINANCE)
//
// สรุปจากข้อมูลจริงใน operation โดยไม่ต้องคีย์ซ้ำ:
//   - ยอดขาย POS + ต้นทุน + กำไรขั้นต้น  → /sales
//   - รายได้ค่าบริการ + ภาษีขาย          → /accounting_documents
//   - ค่าใช้จ่ายดำเนินงาน                 → /expenses
// เลือกงวด (เดือน, อิงเวลาไทย) → P&L + VAT สุทธิ + export CSV.

import { useEffect, useMemo, useState } from 'react';
import { ref, get, query, orderByChild, equalTo } from 'firebase/database';
import { TrendingUp, Loader2, Download } from 'lucide-react';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

function currentBangkokMonth(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// [start, end) epoch-ms covering a Bangkok calendar month "YYYY-MM".
function bangkokMonthRange(month: string): [number, number] {
  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1) - 7 * 3600 * 1000;
  const end = Date.UTC(y, m, 1) - 7 * 3600 * 1000;
  return [start, end];
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Totals {
  salesGross: number; cogs: number; grossProfit: number;
  serviceBase: number; opex: number;
  outputVat: number; salesCount: number;
}

const ZERO: Totals = { salesGross: 0, cogs: 0, grossProfit: 0, serviceBase: 0, opex: 0, outputVat: 0, salesCount: 0 };

export default function FinancialReport() {
  const toast = useToast();
  const [month, setMonth] = useState<string>(currentBangkokMonth());
  const [loading, setLoading] = useState(false);
  const [t, setT] = useState<Totals>(ZERO);

  const period = month.replace('-', '');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const [start, end] = bangkokMonthRange(month);

    Promise.all([
      get(ref(db, 'sales')),
      get(ref(db, 'expenses')),
      get(query(ref(db, 'accounting_documents'), orderByChild('period'), equalTo(period))),
    ])
      .then(([salesSnap, expSnap, docSnap]) => {
        if (cancelled) return;
        const out: Totals = { ...ZERO };

        salesSnap.forEach((c) => {
          const s = c.val();
          const at = Number(s?.sold_at) || 0;
          if (at >= start && at < end && !s?.is_test) {
            out.salesGross += Number(s.grand_total) || 0;
            out.cogs += Number(s.total_cost) || 0;
            out.grossProfit += Number(s.net_profit) || 0;
            out.salesCount += 1;
          }
        });

        expSnap.forEach((c) => {
          const e = c.val();
          const at = Number(e?.created_at) || 0;
          if (at >= start && at < end) out.opex += Number(e.amount) || 0;
        });

        docSnap.forEach((c) => {
          const d = c.val();
          if (d?.type !== 'tax_invoice') return;
          out.outputVat += Number(d.vat) || 0;
          if (d.category !== 'goods') out.serviceBase += Number(d.base) || 0; // service fee revenue
        });

        setT(out);
      })
      .catch((e) => { if (!cancelled) toast.error('โหลดรายงานไม่สำเร็จ: ' + (e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, period, toast]);

  const netProfit = useMemo(() => t.grossProfit + t.serviceBase - t.opex, [t]);

  const rows: Array<[string, number, 'in' | 'out' | 'net' | 'sub']> = [
    ['ยอดขายสินค้า (POS, รวม VAT)', t.salesGross, 'sub'],
    ['ต้นทุนสินค้าที่ขาย (COGS)', -t.cogs, 'sub'],
    ['กำไรขั้นต้นจากการขาย', t.grossProfit, 'in'],
    ['รายได้ค่าบริการรับเครื่อง (ก่อน VAT)', t.serviceBase, 'in'],
    ['ค่าใช้จ่ายดำเนินงาน', -t.opex, 'out'],
    ['กำไรสุทธิโดยประมาณ', netProfit, 'net'],
  ];

  const exportCsv = () => {
    const lines = [
      ['รายงานการเงิน', month],
      [],
      ['ยอดขายสินค้า (POS, รวม VAT)', t.salesGross.toFixed(2)],
      ['ต้นทุนสินค้าที่ขาย', t.cogs.toFixed(2)],
      ['กำไรขั้นต้นจากการขาย', t.grossProfit.toFixed(2)],
      ['รายได้ค่าบริการ (ก่อน VAT)', t.serviceBase.toFixed(2)],
      ['ค่าใช้จ่ายดำเนินงาน', t.opex.toFixed(2)],
      ['กำไรสุทธิโดยประมาณ', netProfit.toFixed(2)],
      [],
      ['ภาษีขาย (Output VAT)', t.outputVat.toFixed(2)],
      ['ภาษีซื้อ (Input VAT)', '0.00'],
      ['ภาษีต้องชำระ (โดยประมาณ)', t.outputVat.toFixed(2)],
    ];
    const csv = lines.map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `รายงานการเงิน-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
          <TrendingUp size={22} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white">รายงานการเงิน (P&amp;L)</h1>
          <p className="text-xs text-slate-400">สรุปกำไร-ขาดทุน + ภาษีมูลค่าเพิ่ม รายเดือน</p>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700/50 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-300 font-bold">งวด</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-emerald-500" />
        <div className="flex-1" />
        <button onClick={exportCsv} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm flex items-center gap-2">
          <Download size={15} /> Export CSV
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={18} /> กำลังคำนวณ...</div>
      ) : (
        <>
          {/* P&L */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/50 text-xs font-black text-slate-400 uppercase tracking-wide">กำไร-ขาดทุน ({t.salesCount} บิลขาย)</div>
            <table className="w-full text-sm">
              <tbody>
                {rows.map(([label, val, kind]) => (
                  <tr key={label} className={`border-b border-slate-700/30 ${kind === 'net' ? 'bg-slate-900/50' : ''}`}>
                    <td className={`px-4 py-2.5 ${kind === 'net' ? 'font-black text-white' : 'text-slate-200'}`}>{label}</td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap font-bold ${
                      kind === 'net' ? (val >= 0 ? 'text-emerald-400 text-lg' : 'text-rose-400 text-lg')
                      : kind === 'out' ? 'text-rose-300' : kind === 'in' ? 'text-emerald-300' : 'text-slate-300'
                    }`}>{fmt(val)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* VAT */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/50 text-xs font-black text-slate-400 uppercase tracking-wide">ภาษีมูลค่าเพิ่ม (ภ.พ.30)</div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-700/30">
                  <td className="px-4 py-2.5 text-slate-200">ภาษีขาย (Output VAT)</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-300">{fmt(t.outputVat)}</td>
                </tr>
                <tr className="border-b border-slate-700/30">
                  <td className="px-4 py-2.5 text-slate-200">ภาษีซื้อ (Input VAT)</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-400">0.00</td>
                </tr>
                <tr className="bg-slate-900/50">
                  <td className="px-4 py-2.5 font-black text-white">ภาษีต้องชำระ (โดยประมาณ)</td>
                  <td className="px-4 py-2.5 text-right font-black text-amber-400 text-lg">{fmt(t.outputVat)}</td>
                </tr>
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11px] text-slate-500">ภาษีซื้อยังไม่ได้บันทึกในระบบ (ถ้ามีใบกำกับซื้อจาก supplier จะเพิ่มภายหลัง) — ยอดนี้เป็นค่าประมาณ ควรให้ผู้ทำบัญชีตรวจสอบก่อนยื่นจริง</p>
          </div>
        </>
      )}
    </div>
  );
}
