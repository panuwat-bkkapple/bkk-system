// src/pages/hr/TaxYear.tsx
//
// เอกสารภาษีรายปีของพนักงาน — 50 ทวิ + ตาราง ภ.ง.ด.1ก (ข้อ 2 ของแผน HR)
//
// หน้านี้ตอบคำถามเดียว: **สิ้นปีต้องยื่นเท่าไหร่ และใครได้ใบไปแล้วบ้าง**
//
// สามเรื่องที่ตั้งใจให้เห็นบนหน้าจอ ไม่ใช่ซ่อนไว้ในโค้ด:
//   1. ปีภาษีตัดที่ **วันจ่ายเงิน** ไม่ใช่งวดงาน (ตอนนี้ตรงกันเพราะจ่ายวันที่
//      25 ของเดือนเดียวกัน แต่วันจ่ายแก้ได้ที่ settings/hr)
//   2. นับเฉพาะรอบที่ **จ่ายแล้ว** — รอบที่ค้างอยู่ขึ้นเป็นรายการให้เห็น
//      ไม่ใช่หายไปเงียบๆ
//   3. ตราบใดที่ยังมีรอบค้าง ใบ 50 ทวิ เป็น **พรีวิว ไม่จองเลขที่**
//
// CSV ที่ออกจากหน้านี้ก็เหมือนของรายเดือน: **ไม่ใช่ไฟล์ e-filing ของกรมสรรพากร**
// เป็นตารางตัวเลขต่อคนไว้กรอกต่อ
import React, { useCallback, useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { FileText, RefreshCw, Download, AlertTriangle, CalendarDays, ShieldCheck } from 'lucide-react';
import { baht, thaiDate, toCsv, download, downloadBase64 } from './hrFormat';

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async <T,>(name: string, data: Record<string, unknown>): Promise<T> => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as T;
};

interface Row {
  employee_id: string;
  employee_code: string | null;
  name: string | null;
  gross: number;
  wht: number;
  sso_employee: number;
  periods: number;
  first_pay_date: number | null;
  last_pay_date: number | null;
  run_ids: string[];
}
interface Pending { id: string; status: string | null; pay_date: number | null }
interface Summary {
  year: number;
  buddhist_year: number;
  rows: Row[];
  totals: { headcount: number; gross: number; wht: number; sso_employee: number };
  runs_counted: string[];
  runs_pending: Pending[];
  issued: Record<string, { number: string; issued_at: number | null }>;
}

const thisTaxYear = () => new Date().getFullYear() + 543;

export const TaxYear: React.FC = () => {
  const toast = useToast();
  const [year, setYear] = useState(thisTaxYear);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    try {
      setData(await call<Summary>('adminHrTaxYearSummary', { year: y }));
    } catch (e) {
      setData(null);
      toast.error(e instanceof Error ? e.message : 'โหลดสรุปภาษีรายปีไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(year); }, [load, year]);

  const certificate = async (row: Row) => {
    setBusy(true);
    try {
      const res = await call<{ filename: string; base64: string; preview: boolean; reissued: boolean; number: string | null }>(
        'adminHrWhtCertificate', { year, employeeId: row.employee_id }
      );
      downloadBase64(res.filename, res.base64);
      if (res.preview) {
        toast.error('ปีนี้ยังมีรอบที่ยังไม่จ่าย — ได้ฉบับพรีวิวที่ยังไม่มีเลขที่ ตัวเลขจะเปลี่ยนเมื่อจ่ายครบ');
      } else if (res.reissued) {
        toast.success(`ออกซ้ำจากเลขเดิม ${res.number}`);
      } else {
        toast.success(`ออกหนังสือรับรองเลขที่ ${res.number}`);
      }
      await load(year);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ออกหนังสือรับรองไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const exportPnd1k = () => {
    if (!data) return;
    const rows: (string | number)[][] = [
      [`ภ.ง.ด.1ก ปีภาษี ${data.buddhist_year}`],
      [`รอบที่นับ: ${data.runs_counted.join(' ') || 'ไม่มี'}`],
      ...(data.runs_pending.length
        ? [[`รอบที่ยังไม่จ่ายและไม่ได้นับ: ${data.runs_pending.map((p) => `${p.id}(${p.status})`).join(' ')}`]]
        : []),
      [],
      ['รหัสพนักงาน', 'ชื่อ-สกุล', 'จำนวนงวดที่จ่าย', 'เงินได้ทั้งปี', 'ภาษีหัก ณ ที่จ่ายทั้งปี', 'เงินสมทบประกันสังคม (ลูกจ้าง)', 'เลขที่ 50 ทวิ'],
      ...data.rows.map((r) => [
        r.employee_code || '', r.name || '', r.periods, r.gross, r.wht, r.sso_employee,
        data.issued[r.employee_id]?.number || '',
      ]),
      [],
      ['รวม', '', '', data.totals.gross, data.totals.wht, data.totals.sso_employee, ''],
    ];
    download(`pnd1k-${data.buddhist_year}.csv`, toCsv(rows));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <FileText className="text-rose-500" /> เอกสารภาษีรายปี (50 ทวิ / ภ.ง.ด.1ก)
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            ยื่น ภ.ง.ด.1ก ภายในเดือนกุมภาพันธ์ของปีถัดไป · 50 ทวิ ต้องออกให้ลูกจ้างทุกคน
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-bold text-gray-500">
            ปีภาษี (พ.ศ.)
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 block w-28 px-2 py-2 rounded-xl border border-gray-200 text-sm" />
          </label>
          <button onClick={() => void load(year)} disabled={loading}
            className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
          </button>
          <button onClick={exportPnd1k} disabled={!data || !data.rows.length}
            className="px-4 py-2 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            <Download size={15} /> ภ.ง.ด.1ก (CSV)
          </button>
        </div>
      </div>

      {/* ปีภาษีอิงวันจ่ายเงิน — เขียนไว้บนหน้าจอเพราะเป็นกติกาที่คนกรอกต้องรู้
          ไม่ใช่รายละเอียดของโค้ด */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-[13px] text-blue-900 flex gap-2">
        <CalendarDays size={16} className="mt-0.5 shrink-0" />
        <p>
          ปีภาษีตัดที่ <b>วันที่จ่ายเงิน</b> ไม่ใช่งวดงาน และนับเฉพาะ <b>รอบที่จ่ายแล้ว</b> เท่านั้น —
          50 ทวิ รับรองเงินที่จ่ายจริงและภาษีที่หักไว้จริง รอบที่อนุมัติแล้วแต่ยังไม่โอนยังไม่ใช่เงินได้ของลูกจ้าง
        </p>
      </div>

      {data && data.runs_pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[13px] text-amber-900 flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">ปีนี้ยังมีรอบที่ยังไม่จ่าย {data.runs_pending.length} รอบ — ตัวเลขยังไม่ครบ</p>
            <p className="mt-1">
              {data.runs_pending.map((p) => `${p.id} (${p.status === 'draft' ? 'ร่าง' : 'อนุมัติแล้ว รอโอน'})`).join(' · ')}
            </p>
            <p className="mt-1">ระหว่างนี้ออก 50 ทวิ ได้เป็น <b>ฉบับพรีวิวที่ยังไม่มีเลขที่</b> เพื่อไม่ให้เลขที่เอกสารถูกใช้ไปกับตัวเลขที่ยังขยับได้</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-black text-gray-800">
            สรุปรายคน ปีภาษี {data?.buddhist_year || year}
          </h2>
          {data && (
            <p className="text-xs text-gray-500">
              นับจากรอบที่จ่ายแล้ว {data.runs_counted.length} รอบ · พนักงาน {data.totals.headcount} คน
            </p>
          )}
        </div>

        {loading && <p className="p-6 text-sm text-gray-400">กำลังโหลด...</p>}
        {!loading && (!data || !data.rows.length) && (
          <p className="p-6 text-sm text-gray-400">
            ยังไม่มีรอบที่จ่ายแล้วในปีภาษีนี้ — ตัวเลขจะขึ้นเมื่อกด &quot;จ่ายแล้ว&quot; ที่หน้ารอบจ่ายเงินเดือน
          </p>
        )}

        {!loading && data && data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-5 py-2 font-bold">พนักงาน</th>
                  <th className="text-right px-3 py-2 font-bold">งวด</th>
                  <th className="text-right px-3 py-2 font-bold">เงินได้ทั้งปี</th>
                  <th className="text-right px-3 py-2 font-bold">ภาษีหัก ณ ที่จ่าย</th>
                  <th className="text-right px-3 py-2 font-bold">ประกันสังคม (ลูกจ้าง)</th>
                  <th className="text-left px-3 py-2 font-bold">50 ทวิ</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.rows.map((r) => {
                  const cert = data.issued[r.employee_id];
                  return (
                    <tr key={r.employee_id} className="hover:bg-gray-50/60">
                      <td className="px-5 py-3">
                        <p className="font-bold text-gray-800">{r.name || '-'}</p>
                        <p className="text-xs text-gray-400">
                          {r.employee_code || '-'} · จ่าย {thaiDate(r.first_pay_date)} ถึง {thaiDate(r.last_pay_date)}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.periods}</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-800">{baht(r.gross)}</td>
                      <td className="px-3 py-3 text-right font-bold text-rose-600">{baht(r.wht)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{baht(r.sso_employee)}</td>
                      <td className="px-3 py-3">
                        {cert ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                            <ShieldCheck size={13} /> {cert.number}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">ยังไม่ออก</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => void certificate(r)} disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
                          <FileText size={13} /> {cert ? 'ออกซ้ำ' : '50 ทวิ (PDF)'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-black text-gray-800">
                <tr>
                  <td className="px-5 py-3">รวม</td>
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3 text-right">{baht(data.totals.gross)}</td>
                  <td className="px-3 py-3 text-right text-rose-600">{baht(data.totals.wht)}</td>
                  <td className="px-3 py-3 text-right">{baht(data.totals.sso_employee)}</td>
                  <td className="px-3 py-3" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        CSV ที่ออกจากหน้านี้เป็น <b>ตารางตัวเลขต่อคน ไม่ใช่ไฟล์ e-filing ของกรมสรรพากร</b> ·
        เลขที่ 50 ทวิ จองครั้งเดียวต่อคนต่อปี กดออกซ้ำจะได้เลขเดิมเสมอ ·
        เอกสารสร้างสดจากรอบที่จ่ายแล้ว ไม่ได้เก็บไฟล์ไว้บนเซิร์ฟเวอร์
      </p>
    </div>
  );
};
