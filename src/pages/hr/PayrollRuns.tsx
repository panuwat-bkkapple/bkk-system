// src/pages/hr/PayrollRuns.tsx
//
// รอบจ่ายเงินเดือน — เฟส P5 ของ docs/hr-system-design.md
// ตัดรอบวันที่ 20 จ่ายวันที่ 25 (ค่าอยู่ที่ settings/hr ไม่ได้ฝังในหน้านี้)
//
// หน้านี้มีหน้าที่เดียวที่สำคัญกว่าอย่างอื่น: **ทำให้ตัวเลขถูกตรวจได้ก่อนเงิน
// ออก** ทุกบรรทัดกางดูที่มาได้ทั้งฝั่งรายได้ ฝั่งหัก และฐานคิดภาษีทั้งปี
// เพราะสิ่งที่ป้องกันการจ่ายผิดไม่ใช่ความมั่นใจในสูตร แต่คือคนที่อ่านมันก่อน
// กดอนุมัติ
//
// ส่งออกเป็น CSV สองใบ (ภ.ง.ด.1 / ประกันสังคม) — **ไม่ใช่ไฟล์ e-filing ของ
// กรมสรรพากรหรือประกันสังคม** เป็นตารางตัวเลขต่อคนสำหรับกรอก/อัปโหลดต่อ
// การเดารูปแบบไฟล์ราชการโดยไม่มีสเปกจริงคือการส่งของที่ดูเหมือนใช้ได้แต่
// ยื่นไม่ผ่าน ซึ่งแย่กว่าการบอกตรงๆ ว่ายังไม่มี
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import {
  Banknote, RefreshCw, CheckCircle2, Download, AlertTriangle, ChevronDown, ChevronRight, Lock, Calendar, Plus, Trash2, Pencil, FileText,
} from 'lucide-react';
import { baht, thaiDate, toCsv, download, downloadBase64 } from './hrFormat';
// วันที่แบบไทยและกติกาการอ่านยอดวันลา — ล้วน มีเทส
import { bangkokIsoDate } from './employeeLeave';

const fns = () => getFunctions(app, 'asia-southeast1');
const call = async <T,>(name: string, data: Record<string, unknown>): Promise<T> => {
  const fn = httpsCallable(fns(), name);
  return (await fn(data)).data as T;
};

interface Line { label: string; amount: number; taxable?: boolean; sso_wage?: boolean; type?: string; note?: string | null }
interface WhtBasis {
  periods?: number; annual_income?: number; expenses?: number;
  allowances_total?: number; sso_allowance?: number; net_income?: number; annual_tax?: number;
  occasional_income?: number; occasional_tax?: number;
  skipped?: boolean;
}
interface Item {
  id: string;
  employee_id: string | null;
  employee_code: string | null;
  name: string | null;
  employment_type: string;
  earnings: Line[];
  deductions: Line[];
  gross: number;
  taxable_income: number;
  sso_wage: number;
  sso_employee: number;
  sso_employer: number;
  wht: number;
  wht_basis: WhtBasis;
  net: number;
  days_worked: number | null;
  note: string | null;
  incomplete: string | null;
  /** เรื่องที่ต้องตาม แต่ไม่ได้ทำให้สลิปใบนี้ผิด — **ไม่กันการอนุมัติ**
   *  (เช่น ยังไม่ขึ้นทะเบียนประกันสังคมเกิน 30 วัน) ดูเหตุผลที่ hr-compliance.js */
  warnings?: string[] | null;
  pay_method?: 'transfer' | 'cash';
  bank_name?: string | null;
  bank_masked?: string | null;
  manual_earnings?: ManualLine[];
  manual_deductions?: ManualLine[];
  wht_computed?: number;
  wht_override?: WhtOverride | null;
  occasional_income?: number;
}
interface Totals {
  headcount: number; gross: number; wht: number;
  sso_employee: number; sso_employer: number; net: number; incomplete: number; warned?: number;
  employer_cost?: number; transfer?: number; cash?: number;
}
interface Preset { id: string | null; label: string; kind: 'earning' | 'deduction'; taxable: boolean; sso_wage: boolean; occasional?: boolean }
interface ManualLine { label: string; amount: number; taxable?: boolean; sso_wage?: boolean; occasional?: boolean }
interface WhtOverride { amount: number; reason: string; by_name?: string | null; at?: number | null }
interface Run {
  id: string;
  period: string;
  period_from: number;
  period_to: number;
  pay_date: number;
  status: 'draft' | 'approved' | 'paid';
  totals: Totals;
  approved_at?: number;
  approved_by_name?: string | null;
  paid_at?: number;
}

const STATUS = {
  draft: { label: 'ร่าง (แก้ได้)', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'อนุมัติแล้ว (ล็อก)', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  paid: { label: 'จ่ายแล้ว', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

const thisPeriod = () => {
  const now = new Date();
  return { year: now.getFullYear() + 543, month: now.getMonth() + 1 };
};

export const PayrollRuns = () => {
  const toast = useToast();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState(thisPeriod);
  const [presets, setPresets] = useState<Preset[]>([]);
  // วันลาไม่รับค่าจ้างในรอบนี้ — **แสดงอย่างเดียว ไม่หักเงิน**
  // การหักอัตโนมัติเป็นงานรอบถัดไปที่ต้องตัดสินใจแยก (ดู functions/hr-leave.js)
  const [unpaidLeave, setUnpaidLeave] = useState<Record<string, { days: number }>>({});

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<{ items: Run[] }>('adminHrPayrollList', {});
      setRuns(res.items || []);
      if (!selected && res.items?.length) setSelected(res.items[0].id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'โหลดรายการรอบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [toast, selected]);

  const loadRun = useCallback(async (key: string) => {
    try {
      const res = await call<{ run: Run; items: Item[]; presets: Preset[] }>('adminHrPayrollGet', { period: key });
      setRun(res.run); setItems(res.items || []); setPresets(res.presets || []);

      // ยิงแยกและล้มได้เงียบ — hosting ขึ้นก่อน functions เสมอ หน้ารอบจ่าย
      // ต้องใช้งานได้เต็มที่แม้ callable ตัวนี้ยังไม่ได้ deploy
      const ids = (res.items || []).map((i) => i.employee_id).filter((x): x is string => Boolean(x));
      if (ids.length && res.run) {
        try {
          const lv = await call<{ rows: Record<string, { days: number }> }>('adminHrLeaveUnpaidInPeriod', {
            employeeIds: ids,
            from: bangkokIsoDate(res.run.period_from),
            to: bangkokIsoDate(res.run.period_to),
          });
          setUnpaidLeave(lv.rows || {});
        } catch {
          setUnpaidLeave({});
        }
      } else {
        setUnpaidLeave({});
      }
    } catch (e) {
      setRun(null); setItems([]);
      toast.error(e instanceof Error ? e.message : 'โหลดรอบไม่สำเร็จ');
    }
  }, [toast]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { if (selected) void loadRun(selected); }, [selected, loadRun]);

  const draft = async () => {
    setBusy(true);
    try {
      const res = await call<{ run: Run; count: number }>('adminHrPayrollDraft', period);
      toast.success(`คำนวณรอบ ${res.run.period} แล้ว (${res.count} คน)`);
      setSelected(res.run.id);
      await loadRuns(); await loadRun(res.run.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'คำนวณรอบไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  // ทุกการแก้บรรทัดเดินทางเดียวกัน: ส่ง "สภาพที่ควรเป็น" ทั้งชุดให้ server
  // คิดใหม่ ไม่ใช่ส่ง delta — บรรทัดที่คิดจากค่าคนละชุดกับบรรทัดอื่นในรอบเดียวกัน
  // คือที่มาของยอดที่กระทบไม่ลง
  const saveItem = async (item: Item, patch: {
    days_worked?: string | number | null;
    extra_earnings?: ManualLine[];
    extra_deductions?: ManualLine[];
    wht_override?: WhtOverride | null;
  }) => {
    if (!run) return;
    setBusy(true);
    try {
      await call('adminHrPayrollSetItem', {
        period: run.id,
        employeeId: item.employee_id,
        days_worked: patch.days_worked !== undefined ? patch.days_worked : item.days_worked,
        extra_earnings: patch.extra_earnings ?? item.manual_earnings ?? [],
        extra_deductions: patch.extra_deductions ?? item.manual_deductions ?? [],
        wht_override: patch.wht_override !== undefined ? patch.wht_override : (item.wht_override ?? null),
      });
      await loadRun(run.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const approve = async () => {
    if (!run) return;
    if (!window.confirm(`อนุมัติรอบ ${run.id} ยอดจ่ายสุทธิ ${baht(run.totals?.net)} บาท\n\nอนุมัติแล้วแก้ไม่ได้ ถ้าตัวเลขผิดต้องออกรอบปรับปรุง`)) return;
    setBusy(true);
    try {
      await call('adminHrPayrollApprove', { period: run.id });
      toast.success('อนุมัติรอบแล้ว');
      await loadRuns(); await loadRun(run.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const markPaid = async () => {
    if (!run) return;
    if (!window.confirm(`บันทึกว่าโอนเงินรอบ ${run.id} แล้ว\n\nระบบไม่ได้โอนให้ ปุ่มนี้บันทึกว่าคุณโอนไปแล้วเท่านั้น`)) return;
    setBusy(true);
    try {
      await call('adminHrPayrollMarkPaid', { period: run.id });
      toast.success('บันทึกว่าจ่ายแล้ว');
      await loadRuns(); await loadRun(run.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const payslip = async (item: Item) => {
    if (!run) return;
    setBusy(true);
    try {
      const res = await call<{ filename: string; base64: string; draft: boolean }>(
        'adminHrPayrollPayslip', { period: run.id, employeeId: item.employee_id }
      );
      downloadBase64(res.filename, res.base64);
      if (res.draft) toast.error('รอบนี้ยังเป็นร่าง — สลิปติดป้ายว่าร่างไว้ในชื่อไฟล์ อย่าเพิ่งส่งให้พนักงาน');
      else toast.success('ดาวน์โหลดสลิปแล้ว');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ออกสลิปไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  const exportWht = () => {
    if (!run) return;
    const rows: (string | number)[][] = [
      ['รหัสพนักงาน', 'ชื่อ-สกุล', 'เงินได้ที่ต้องเสียภาษี', 'ภาษีหัก ณ ที่จ่าย', 'ประมาณการเงินได้ทั้งปี', 'เงินได้สุทธิทั้งปี', 'ภาษีทั้งปี', 'จำนวนงวด'],
      ...items.map((i) => [
        i.employee_code || '', i.name || '', i.taxable_income, i.wht,
        i.wht_basis?.annual_income ?? '', i.wht_basis?.net_income ?? '',
        i.wht_basis?.annual_tax ?? '', i.wht_basis?.periods ?? '',
      ]),
      [], ['รวม', '', run.totals?.gross ?? '', run.totals?.wht ?? ''],
    ];
    download(`pnd1-${run.id}.csv`, toCsv(rows));
  };

  const exportSso = () => {
    if (!run) return;
    const rows: (string | number)[][] = [
      ['รหัสพนักงาน', 'ชื่อ-สกุล', 'ค่าจ้างที่ใช้คำนวณ', 'เงินสมทบลูกจ้าง', 'เงินสมทบนายจ้าง', 'รวม'],
      ...items.map((i) => [
        i.employee_code || '', i.name || '', i.sso_wage, i.sso_employee, i.sso_employer,
        Math.round((i.sso_employee + i.sso_employer) * 100) / 100,
      ]),
      [], ['รวม', '', '', run.totals?.sso_employee ?? '', run.totals?.sso_employer ?? '',
        Math.round(((run.totals?.sso_employee || 0) + (run.totals?.sso_employer || 0)) * 100) / 100],
    ];
    download(`sso-${run.id}.csv`, toCsv(rows));
  };

  const locked = run?.status !== 'draft';
  const incomplete = useMemo(() => items.filter((i) => i.incomplete), [items]);
  const warned = useMemo(() => items.filter((i) => (i.warnings || []).length > 0), [items]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Banknote className="text-rose-500" /> รอบจ่ายเงินเดือน
          </h1>
          <p className="text-sm text-gray-500 mt-1">ตัดรอบวันที่ 20 จ่ายวันที่ 25 — ตั้งค่าได้ที่ settings/hr</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-xs font-bold text-gray-500">
            ปี (พ.ศ.)
            <input type="number" value={period.year}
              onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
              className="mt-1 block w-24 px-2 py-2 rounded-xl border border-gray-200 text-sm" />
          </label>
          <label className="text-xs font-bold text-gray-500">
            เดือน
            <select value={period.month}
              onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}
              className="mt-1 block px-2 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button onClick={() => void draft()} disabled={busy}
            className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> คำนวณรอบนี้
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold flex items-center gap-2"><AlertTriangle size={16} /> ตรวจตัวเลขก่อนอนุมัติทุกครั้ง</p>
        <p className="mt-1 leading-relaxed">
          อัตราภาษีและประกันสังคมที่ระบบใช้เป็น <b>ค่าตั้งต้น</b> ที่แก้ได้ที่ <code>settings/hr</code> —
          ควรตรวจกับกรมสรรพากรและสำนักงานประกันสังคมก่อนยื่นจริงรอบแรก
          รอบที่อนุมัติแล้วจะ <b>แช่อัตราที่ใช้ตอนนั้นไว้</b> ตัวเลขบนสลิปเก่าจึงไม่เปลี่ยนตามการแก้ค่าในภายหลัง
        </p>
      </div>

      {runs.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {runs.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)}
              className={`px-3 py-1.5 rounded-xl text-sm font-bold border ${selected === r.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
              {r.id}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-center text-gray-400 py-12 font-bold">กำลังโหลด...</p>
      ) : !run ? (
        <div className="text-center py-12 text-gray-400">
          <Banknote size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-bold">ยังไม่มีรอบจ่าย</p>
          <p className="text-sm mt-2">เลือกเดือนแล้วกด &quot;คำนวณรอบนี้&quot;</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-black text-lg text-gray-800">งวด {run.id}</h2>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${STATUS[run.status].cls}`}>
                    {STATUS[run.status].label}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                  <Calendar size={13} />
                  {thaiDate(run.period_from)} - {thaiDate(run.period_to)} · จ่าย {thaiDate(run.pay_date)}
                </p>
                {run.approved_at && (
                  <p className="text-xs text-gray-400 mt-1">
                    อนุมัติ {thaiDate(run.approved_at)}{run.approved_by_name ? ` โดย ${run.approved_by_name}` : ''}
                    {run.paid_at ? ` · จ่าย ${thaiDate(run.paid_at)}` : ''}
                  </p>
                )}
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={exportWht} className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={15} /> ภ.ง.ด.1 (CSV)
                </button>
                <button onClick={exportSso} className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={15} /> ประกันสังคม (CSV)
                </button>
                {run.status === 'draft' && (
                  <button onClick={() => void approve()} disabled={busy || incomplete.length > 0}
                    className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-2">
                    <CheckCircle2 size={15} /> อนุมัติรอบ
                  </button>
                )}
                {run.status === 'approved' && (
                  <button onClick={() => void markPaid()} disabled={busy}
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">
                    บันทึกว่าโอนแล้ว
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-5">
              {[
                ['พนักงาน', `${run.totals?.headcount ?? 0} คน`],
                ['รวมรายได้', baht(run.totals?.gross)],
                ['ภาษีหัก ณ ที่จ่าย', baht(run.totals?.wht)],
                ['ประกันสังคม (ลูกจ้าง/นายจ้าง)', `${baht(run.totals?.sso_employee)} / ${baht(run.totals?.sso_employer)}`],
                ['ยอดจ่ายสุทธิ', baht(run.totals?.net)],
                ['ต้นทุนบริษัท (รวมสมทบนายจ้าง)', baht(run.totals?.employer_cost)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-gray-50 p-3">
                  <p className="text-[11px] font-bold text-gray-400">{label}</p>
                  <p className="font-black text-gray-800 mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {incomplete.length > 0 && (
              <p className="mt-4 text-sm font-bold text-rose-700 flex items-center gap-2">
                <AlertTriangle size={15} /> ยังกรอกไม่ครบ {incomplete.length} คน — อนุมัติไม่ได้จนกว่าจะครบ
              </p>
            )}
            {/* **เตือน ไม่กัน** — การหักเงินสมทบตั้งแต่เดือนแรกถูกต้องอยู่แล้ว
                ถ้ากันไว้ ทั้งบริษัทจะจ่ายเงินเดือนไม่ได้เพราะคนใหม่หนึ่งคน
                สิ่งที่ต้องไม่เกิดคือความเงียบ ไม่ใช่การจ่ายเงิน */}
            {warned.length > 0 && (
              <p className="mt-2 text-sm font-bold text-amber-700 flex items-center gap-2">
                <AlertTriangle size={15} /> มี {warned.length} คนที่ต้องตามเรื่องประกันสังคม — อนุมัติได้ แต่อย่าปล่อยไว้
              </p>
            )}
            <p className="mt-4 text-xs text-gray-500">
              แยกตามช่องทางจ่าย — โอน {baht(run.totals?.transfer)} · เงินสด {baht(run.totals?.cash)}
              <span className="text-gray-400"> (ตามช่องทางที่ตั้งไว้ในแฟ้มพนักงาน ไม่ได้เดาจากการมีเลขบัญชี)</span>
            </p>
            {locked && (
              <p className="mt-2 text-xs text-gray-400 flex items-center gap-1">
                <Lock size={12} /> รอบนี้ล็อกแล้ว การแก้ไขต้องออกรอบปรับปรุง
              </p>
            )}
          </div>

          <div className="space-y-2">
            {items.map((item) => {
              const open = expanded === item.id;
              return (
                <div key={item.id} className={`rounded-2xl border bg-white ${item.incomplete ? 'border-rose-300' : 'border-gray-200'}`}>
                  <button onClick={() => setExpanded(open ? null : item.id)}
                    className="w-full flex items-center justify-between gap-3 p-4 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      {open ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-bold text-gray-800 truncate">
                          {item.name}
                          <span className="text-xs font-mono text-gray-400 ml-2">{item.employee_code}</span>
                        </p>
                        {item.incomplete && <p className="text-xs font-bold text-rose-600 mt-0.5">{item.incomplete}</p>}
                        {(item.warnings || []).map((w) => (
                          <p key={w} className="text-xs font-bold text-amber-700 mt-0.5">{w}</p>
                        ))}
                        {(unpaidLeave[item.employee_id || '']?.days || 0) > 0 && (
                          <p className="text-xs font-bold text-amber-700 mt-0.5">
                            รอบนี้มีวันลาไม่รับค่าจ้าง {unpaidLeave[item.employee_id || ''].days} วัน
                            — ยังไม่ได้หักในยอดนี้ ถ้าต้องหักให้เพิ่มบรรทัด &quot;หักขาด/ลา/มาสาย&quot;
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-gray-800">{baht(item.net)}</p>
                      <p className="text-[11px] text-gray-400">
                        รายได้ {baht(item.gross)} · หัก {baht(item.gross - item.net)}
                        {item.pay_method === 'cash'
                          ? ' · จ่ายเงินสด (ไม่มีเลขบัญชี)'
                          : item.bank_masked ? ` · ${item.bank_name || 'โอน'} ${item.bank_masked}` : ''}
                      </p>
                    </div>
                  </button>

                  {open && (
                    <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
                      {item.employment_type === 'daily' && (
                        <label className="block text-xs font-bold text-gray-500">
                          จำนวนวันทำงานในงวดนี้
                          <input type="number" min={0} max={31} disabled={locked || busy}
                            defaultValue={item.days_worked ?? ''}
                            onBlur={(e) => { if (e.target.value !== String(item.days_worked ?? '')) void saveItem(item, { days_worked: e.target.value }); }}
                            className="mt-1 block w-32 px-3 py-2 rounded-xl border border-gray-200 text-sm disabled:bg-gray-50" />
                        </label>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-black text-gray-400 uppercase mb-2">รายได้</p>
                          {item.earnings.map((l, idx) => (
                            <div key={idx} className="flex justify-between text-sm py-1 border-b border-gray-50">
                              <span className="text-gray-600">
                                {l.label}
                                {l.note && <span className="text-xs text-gray-400 ml-1">({l.note})</span>}
                                {l.taxable === false && <span className="text-[10px] text-gray-400 ml-1">ไม่เสียภาษี</span>}
                              </span>
                              <span className="font-bold text-gray-800">{baht(l.amount)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-sm pt-2 font-black">
                            <span>รวมรายได้</span><span>{baht(item.gross)}</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-black text-gray-400 uppercase mb-2">รายการหัก</p>
                          {item.deductions.length === 0 && <p className="text-sm text-gray-400">ไม่มี</p>}
                          {item.deductions.map((l, idx) => (
                            <div key={idx} className="flex justify-between text-sm py-1 border-b border-gray-50">
                              <span className="text-gray-600">{l.label}</span>
                              <span className="font-bold text-rose-600">-{baht(l.amount)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between text-sm pt-2 font-black">
                            <span>ยอดโอนสุทธิ</span><span>{baht(item.net)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void payslip(item)} disabled={busy || Boolean(item.incomplete)}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1">
                          <FileText size={14} /> สลิปเงินเดือน (PDF)
                        </button>
                      </div>

                      {!locked && (
                        <ManualLinesEditor item={item} presets={presets} busy={busy} onSave={saveItem} />
                      )}

                      {/* ที่มาของภาษี — ตัวเลขที่อธิบายตัวเองไม่ได้คือตัวเลขที่ไม่มีใครกล้าตรวจ */}
                      {!item.wht_basis?.skipped && (
                        <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
                          <p className="font-black text-gray-500">ที่มาของภาษีหัก ณ ที่จ่าย</p>
                          <p>ประมาณการเงินได้ทั้งปี {baht(item.wht_basis?.annual_income)} ({item.wht_basis?.periods} งวด)</p>
                          <p>หักค่าใช้จ่าย {baht(item.wht_basis?.expenses)} · หักค่าลดหย่อน {baht(item.wht_basis?.allowances_total)} (รวมประกันสังคม {baht(item.wht_basis?.sso_allowance)})</p>
                          <p>
                            เงินได้สุทธิ {baht(item.wht_basis?.net_income)} → ภาษีทั้งปี {baht(item.wht_basis?.annual_tax)} → ต่องวด {baht((item.wht_basis?.annual_tax || 0) / (item.wht_basis?.periods || 12))}
                          </p>
                          {(item.wht_basis?.occasional_income || 0) > 0 && (
                            <p className="text-gray-700">
                              + เงินได้ครั้งคราว {baht(item.wht_basis?.occasional_income)} → ภาษีส่วนเพิ่ม {baht(item.wht_basis?.occasional_tax)}
                              <span className="text-gray-400"> (ไม่ถูกคูณจำนวนงวด เพราะไม่ได้จ่ายทุกเดือน)</span>
                            </p>
                          )}
                          <p className="font-bold text-gray-700">รวมหักงวดนี้ {baht(item.wht)}</p>
                          {item.wht_override && (
                            <p className="text-rose-700 font-bold">
                              แก้ด้วยมือ: ระบบคำนวณ {baht(item.wht_computed)} → ใช้ {baht(item.wht_override.amount)}
                              {item.wht_override.by_name ? ` โดย ${item.wht_override.by_name}` : ''} · {item.wht_override.reason}
                            </p>
                          )}
                          <p className="text-gray-400">
                            ค่าจ้างที่ใช้คิดประกันสังคม {baht(item.sso_wage)} (ลูกจ้าง {baht(item.sso_employee)} / นายจ้าง {baht(item.sso_employer)})
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            ไฟล์ CSV ที่ส่งออกเป็น <b>ตารางตัวเลขต่อคน</b> สำหรับใช้กรอกหรืออัปโหลดต่อ
            ไม่ใช่ไฟล์ e-filing ของกรมสรรพากรหรือประกันสังคมโดยตรง ·
            ไรเดอร์และผู้รับจ้างอิสระไม่อยู่ในรอบนี้ เพราะถูกจ่ายผ่านกระเป๋าเงินและหัก 3% ตอนถอนอยู่แล้ว
          </p>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// รายการปรับเพิ่ม/ปรับลดต่อคนต่อรอบ
//
// **ช่อง "เข้าฐานประกันสังคม" โชว์ให้เห็นทุกบรรทัดโดยตั้งใจ** — ค่าล่วงเวลากับ
// ค่าคอมมิชชั่นของพนักงานขายเป็นค่าจ้างตามกฎหมายประกันสังคมจึงเข้าฐานสมทบ
// ส่วนโบนัสประจำปีโดยทั่วไปไม่ใช่ เส้นแบ่งนี้ขึ้นกับข้อเท็จจริงของรายการ
// ไม่ใช่ชื่อของมัน การซ่อนไว้ในค่าตั้งต้นแปลว่าคนกรอกไม่มีทางรู้ว่าเลือกอะไรอยู่
//
// แก้แล้วยิงบันทึกทันทีทีละครั้ง ไม่มีปุ่ม "บันทึกทั้งหมด" — server คิดยอดใหม่
// ให้ทุกครั้ง คนกรอกจึงเห็นผลของสิ่งที่เพิ่งพิมพ์ ไม่ใช่เห็นตอนกดอนุมัติ
const ManualLinesEditor = ({ item, presets, busy, onSave }: {
  item: Item;
  presets: Preset[];
  busy: boolean;
  onSave: (item: Item, patch: {
    extra_earnings?: ManualLine[]; extra_deductions?: ManualLine[]; wht_override?: WhtOverride | null;
  }) => Promise<void>;
}) => {
  const earnings = item.manual_earnings || [];
  const deductions = item.manual_deductions || [];

  const commit = (kind: 'earning' | 'deduction', rows: ManualLine[]) =>
    onSave(item, kind === 'earning' ? { extra_earnings: rows } : { extra_deductions: rows });

  const addFrom = (kind: 'earning' | 'deduction', label: string) => {
    const preset = presets.find((p) => p.label === label && p.kind === kind);
    const row: ManualLine = {
      label,
      amount: 0,
      taxable: preset ? preset.taxable : true,
      sso_wage: preset ? preset.sso_wage : false,
      occasional: preset ? Boolean(preset.occasional) : false,
    };
    void commit(kind, [...(kind === 'earning' ? earnings : deductions), row]);
  };

  const block = (kind: 'earning' | 'deduction') => {
    const rows = kind === 'earning' ? earnings : deductions;
    const options = presets.filter((p) => p.kind === kind);
    return (
      <div>
        <p className="text-xs font-black text-gray-400 uppercase mb-2">
          {kind === 'earning' ? 'รายการปรับเพิ่ม' : 'รายการปรับลด'}
        </p>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={row.label} disabled={busy}
                onChange={(e) => {
                  const next = rows.map((r, idx) => (idx === i ? { ...r, label: e.target.value } : r));
                  void commit(kind, next);
                }}
                className="flex-1 min-w-[8rem] px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
              <input type="number" defaultValue={String(row.amount)} disabled={busy}
                onBlur={(e) => {
                  const v = Number(e.target.value) || 0;
                  if (v === row.amount) return;
                  void commit(kind, rows.map((r, idx) => (idx === i ? { ...r, amount: v } : r)));
                }}
                className="w-28 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-right" />
              {kind === 'earning' && (
                <>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                    <input type="checkbox" checked={row.sso_wage !== false} disabled={busy}
                      onChange={(e) => void commit(kind, rows.map((r, idx) => (idx === i ? { ...r, sso_wage: e.target.checked } : r)))}
                      className="w-3.5 h-3.5 rounded border-gray-300" />
                    เข้าฐานประกันสังคม
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                    <input type="checkbox" checked={Boolean(row.occasional)} disabled={busy}
                      onChange={(e) => void commit(kind, rows.map((r, idx) => (idx === i ? { ...r, occasional: e.target.checked } : r)))}
                      className="w-3.5 h-3.5 rounded border-gray-300" />
                    จ่ายเป็นครั้งคราว
                  </label>
                </>
              )}
              <button onClick={() => void commit(kind, rows.filter((_, idx) => idx !== i))} disabled={busy}
                className="text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <select value="" disabled={busy}
            onChange={(e) => { if (e.target.value) addFrom(kind, e.target.value); }}
            className="text-xs font-bold border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="">เพิ่มรายการ...</option>
            {options.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
          </select>
          <button onClick={() => addFrom(kind, kind === 'earning' ? 'รายการเพิ่ม' : 'รายการหัก')} disabled={busy}
            className="text-xs font-bold text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <Plus size={13} /> กรอกเอง
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 p-3 grid grid-cols-1 md:grid-cols-2 gap-4">
      {block('earning')}
      {block('deduction')}
      <p className="md:col-span-2 text-[11px] text-gray-400">
        <b>จ่ายเป็นครั้งคราว</b> = ไม่ถูกคูณจำนวนงวดตอนประมาณการภาษีทั้งปี ใช้กับโบนัสหรือคอมมิชชั่นที่ไม่ได้ได้ทุกเดือน —
        ไม่ติ๊กแล้วระบบจะเดาว่าได้เท่านี้ทั้งปี ทำให้หักภาษีเกินจริงในเดือนที่ได้ก้อนใหญ่ ·
        รายการที่แก้ที่นี่ผูกกับรอบนี้เท่านั้น เงินเดือนกับเบี้ยเลี้ยงประจำแก้ที่แฟ้มพนักงาน ·
        ตั้งรายการที่ใช้บ่อยได้ที่หน้าตั้งค่าเงินเดือน/ภาษี
      </p>
      <WhtOverrideEditor item={item} busy={busy} onSave={onSave} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// พิมพ์ทับยอดภาษีหัก ณ ที่จ่าย
//
// มีไว้สำหรับเคสที่บัญชีคิดด้วยวิธีอื่น (เช่น เงินได้ครั้งคราวที่ไม่เข้ารูปแบบ
// ที่ระบบรองรับ) — **ต้องระบุเหตุผลทุกครั้ง** ตัวเลขภาษีที่ถูกแก้ด้วยมือโดยไม่มี
// คำอธิบายคือสิ่งแรกที่ผู้ตรวจถามและไม่มีใครตอบได้ ผู้แก้ถูกบันทึกจาก auth token
// ฝั่ง server ไม่ใช่จากที่หน้าจอส่งไป
const WhtOverrideEditor = ({ item, busy, onSave }: {
  item: Item;
  busy: boolean;
  onSave: (item: Item, patch: { wht_override?: WhtOverride | null }) => Promise<void>;
}) => {
  const [open, setOpen] = useState(Boolean(item.wht_override));
  const [amount, setAmount] = useState(item.wht_override ? String(item.wht_override.amount) : '');
  const [reason, setReason] = useState(item.wht_override?.reason || '');

  if (!open) {
    return (
      <div className="md:col-span-2">
        <button onClick={() => setOpen(true)} disabled={busy}
          className="text-xs font-bold text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <Pencil size={13} /> กรอกยอดภาษีเอง (ปกติไม่ต้อง — ระบบคำนวณให้แล้ว)
        </button>
      </div>
    );
  }

  return (
    <div className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3 space-y-2">
      <p className="text-xs font-bold text-rose-800">
        กรอกยอดภาษีหัก ณ ที่จ่ายเอง — ระบบคำนวณไว้ {baht(item.wht_computed ?? item.wht)} บาท
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" value={amount} disabled={busy} placeholder="ยอดภาษี"
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-right" />
        <input value={reason} disabled={busy} placeholder="เหตุผล (บังคับ)"
          onChange={(e) => setReason(e.target.value)}
          className="flex-1 min-w-[12rem] px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
        <button disabled={busy || !amount.trim() || !reason.trim()}
          onClick={() => void onSave(item, { wht_override: { amount: Number(amount), reason: reason.trim() } })}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-bold disabled:opacity-40">
          ใช้ยอดนี้
        </button>
        {item.wht_override && (
          <button disabled={busy}
            onClick={() => { setAmount(''); setReason(''); setOpen(false); void onSave(item, { wht_override: null }); }}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-gray-600">
            กลับไปใช้ที่ระบบคำนวณ
          </button>
        )}
        {!item.wht_override && (
          <button disabled={busy} onClick={() => setOpen(false)}
            className="text-xs font-bold text-gray-500">ยกเลิก</button>
        )}
      </div>
      <p className="text-[11px] text-rose-700">
        ยอดที่กรอกเองจะขึ้นบนสลิปว่า &quot;แก้ด้วยมือ&quot; พร้อมชื่อผู้แก้และเหตุผล และรอดจากการกดคำนวณรอบใหม่
      </p>
    </div>
  );
};
