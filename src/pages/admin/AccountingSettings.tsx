// หน้าตั้งค่าระบบบัญชี (CEO / FINANCE)
//
// คุมระบบส่งอีเมลยืนยันออเดอร์ + ออกเอกสาร (ใบสำคัญรับเงิน / ใบกำกับภาษี)
// ที่ทำงานใน Cloud Functions (onJobCreatedSendEmails / onJobStatusEmail).
// Functions อ่านค่าจาก settings/accounting — ถ้า master toggle ปิดอยู่
// ระบบจะไม่ทำอะไรเลย (ไม่ส่งอีเมล ไม่จองเลขใบกำกับภาษี ไม่เขียน Storage)
// เพื่อให้ deploy ได้อย่างปลอดภัยก่อนตั้งค่า Resend เสร็จ.

import { useEffect, useState } from 'react';
import { ref, onValue, update } from 'firebase/database';
import {
  Calculator, Save, Loader2, CheckCircle2, Power, ReceiptText, Percent, Info, AlertTriangle, RotateCcw, Building2,
} from 'lucide-react';
import { db, auth } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';

type TaxInvoiceFormat = 'plain' | 'year_month' | 'year';

interface CompanyProfile {
  legalName: string;
  tradeName: string;
  taxId: string;
  address: string;
  branch: string;
  nameEn: string;
  addressEn: string;
  phone: string;
}

interface AccountingSettings {
  order_emails_enabled: boolean;
  vat_registered: boolean;
  vat_rate_percent: number;
  tax_invoice_prefix: string;
  tax_invoice_format: TaxInvoiceFormat;
  company: CompanyProfile;
}

// Defaults mirror functions/email.js COMPANY (the hardcoded fallback).
const DEFAULT_COMPANY: CompanyProfile = {
  legalName: 'บริษัท เก็ทโมบี้ จำกัด',
  tradeName: 'BKK APPLE',
  taxId: '0105565094088',
  address: '596/163 ซอย 6/1 โครงการ อารียา ทูบี ถนนลาดปลาเค้า แขวงจรเข้บัว เขตลาดพร้าว กรุงเทพฯ 10230',
  branch: 'สำนักงานใหญ่',
  nameEn: '',
  addressEn: '',
  phone: '',
};

const DEFAULTS: AccountingSettings = {
  order_emails_enabled: false,
  vat_registered: true,
  vat_rate_percent: 7,
  tax_invoice_prefix: 'IV-',
  tax_invoice_format: 'plain',
  company: DEFAULT_COMPANY,
};

function previewNumber(prefix: string, fmt: TaxInvoiceFormat, seq: number): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  if (fmt === 'year_month') return `${prefix}${y}${m}${String(seq).padStart(4, '0')}`;
  if (fmt === 'year') return `${prefix}${y}${String(seq).padStart(4, '0')}`;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

function Field({ label, value, onChange, textarea, placeholder }: { label: string; value: string; onChange: (v: string) => void; textarea?: boolean; placeholder?: string }) {
  const cls = 'w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-500';
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-300">{label}</span>
      {textarea ? (
        <textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} mt-1 resize-none`} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${cls} mt-1`} />
      )}
    </label>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-emerald-500' : 'bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function AccountingSettings() {
  const toast = useToast();
  const [s, setS] = useState<AccountingSettings>(DEFAULTS);
  const [seq, setSeq] = useState<number>(0);
  const [seqByPeriod, setSeqByPeriod] = useState<Record<string, number>>({});
  const [resetting, setResetting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, 'settings/accounting'), (snap) => {
      const v = snap.val() || {};
      const c = v.company || {};
      setS({
        order_emails_enabled: v.order_emails_enabled === true,
        vat_registered: v.vat_registered !== false,
        vat_rate_percent: typeof v.vat_rate_percent === 'number' ? v.vat_rate_percent : 7,
        tax_invoice_prefix: typeof v.tax_invoice_prefix === 'string' && v.tax_invoice_prefix ? v.tax_invoice_prefix : 'IV-',
        tax_invoice_format: (['plain', 'year_month', 'year'].includes(v.tax_invoice_format) ? v.tax_invoice_format : 'plain') as TaxInvoiceFormat,
        company: { ...DEFAULT_COMPANY, ...c },
      });
      setSeq(typeof v.tax_invoice_seq === 'number' ? v.tax_invoice_seq : 0);
      setSeqByPeriod(v.tax_invoice_seq_by_period && typeof v.tax_invoice_seq_by_period === 'object' ? v.tax_invoice_seq_by_period : {});
      setLoaded(true);
    });
    return () => { unsub(); };
  }, []);

  const setCompany = (patch: Partial<CompanyProfile>) => setS((prev) => ({ ...prev, company: { ...prev.company, ...patch } }));

  // Effective "issued so far" for the active format: global counter for 'plain',
  // current-period counter for 'year_month'/'year'.
  const now = new Date();
  const periodKey = s.tax_invoice_format === 'year_month'
    ? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    : s.tax_invoice_format === 'year' ? `${now.getFullYear()}` : null;
  const currentSeq = periodKey ? (seqByPeriod[periodKey] || 0) : seq;
  const nextNumber = previewNumber(s.tax_invoice_prefix || 'IV-', s.tax_invoice_format, currentSeq + 1);

  const handleResetSeq = async () => {
    const ok = window.confirm(
      `รีเซ็ตเลขรันใบกำกับภาษีกลับเป็น 0?\n\nใบถัดไปจะเริ่มที่ ${previewNumber(s.tax_invoice_prefix || 'IV-', s.tax_invoice_format, 1)}\n\n` +
      `คำเตือน: ทำเฉพาะ "ก่อนเปิดใช้งานจริง" เพื่อล้างเลขจากการทดสอบ — ` +
      `ห้ามรีเซ็ตหลังออกใบกำกับภาษีจริงไปแล้ว เพราะจะทำให้เลขซ้ำ (ผิดกฎหมายภาษี)`
    );
    if (!ok) return;
    setResetting(true);
    try {
      await update(ref(db, 'settings/accounting'), {
        tax_invoice_seq: 0,
        tax_invoice_seq_by_period: null,
        tax_invoice_seq_reset_at: Date.now(),
        tax_invoice_seq_reset_by: auth.currentUser?.email || 'unknown',
      });
      toast.success('รีเซ็ตเลขรันใบกำกับภาษีเรียบร้อย (เริ่มใหม่ที่ 1)');
    } catch (e: any) {
      toast.error('รีเซ็ตไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setResetting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setShowSuccess(false);
    try {
      const rate = Number(s.vat_rate_percent);
      const c = s.company;
      await update(ref(db, 'settings/accounting'), {
        order_emails_enabled: s.order_emails_enabled,
        vat_registered: s.vat_registered,
        vat_rate_percent: Number.isFinite(rate) && rate > 0 ? rate : 7,
        tax_invoice_prefix: (s.tax_invoice_prefix || 'IV-').trim(),
        tax_invoice_format: s.tax_invoice_format,
        company: {
          legalName: (c.legalName || '').trim(),
          tradeName: (c.tradeName || '').trim(),
          taxId: (c.taxId || '').trim(),
          address: (c.address || '').trim(),
          branch: (c.branch || 'สำนักงานใหญ่').trim(),
          nameEn: (c.nameEn || '').trim(),
          addressEn: (c.addressEn || '').trim(),
          phone: (c.phone || '').trim(),
        },
        updated_at: Date.now(),
        updated_by: auth.currentUser?.email || 'unknown',
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (e: any) {
      toast.error('บันทึกการตั้งค่าไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> กำลังโหลด...
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
          <Calculator size={22} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white">ตั้งค่าระบบบัญชี</h1>
          <p className="text-xs text-slate-400">อีเมลยืนยันออเดอร์ · ใบสำคัญรับเงิน · ใบกำกับภาษี</p>
        </div>
      </div>

      {/* Master toggle */}
      <div className={`rounded-3xl p-6 shadow-xl border ${s.order_emails_enabled ? 'bg-emerald-950/40 border-emerald-600/40' : 'bg-slate-800 border-slate-700/50'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Power size={20} className={s.order_emails_enabled ? 'text-emerald-400 mt-0.5' : 'text-slate-400 mt-0.5'} />
            <div>
              <h2 className="text-base font-black text-white">เปิดใช้งานระบบส่งอีเมล + ออกเอกสารอัตโนมัติ</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                เมื่อ<span className="text-emerald-400 font-bold">เปิด</span> ระบบจะส่งอีเมลยืนยันออเดอร์ให้ลูกค้า/แอดมิน และออกใบสำคัญรับเงิน/ใบกำกับภาษีตอนสถานะ "จ่ายเงินแล้ว".
                เมื่อ<span className="text-rose-400 font-bold">ปิด</span> ระบบจะไม่ทำอะไรเลย (ไม่ส่งอีเมล ไม่จองเลขใบกำกับภาษี)
              </p>
            </div>
          </div>
          <Toggle checked={s.order_emails_enabled} onChange={(v) => setS({ ...s, order_emails_enabled: v })} />
        </div>
      </div>

      {/* Resend reminder */}
      <div className="rounded-2xl p-4 bg-amber-950/30 border border-amber-700/40 flex gap-3">
        <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200/90 leading-relaxed">
          การส่งอีเมลจริงต้องตั้งค่า <span className="font-bold">Resend</span> ให้เสร็จก่อน (verify domain + ใส่ GitHub Secrets:
          <code className="mx-1 px-1 rounded bg-black/30">RESEND_API_KEY</code>,
          <code className="mx-1 px-1 rounded bg-black/30">EMAIL_FROM</code>,
          <code className="mx-1 px-1 rounded bg-black/30">ORDER_NOTIFY_EMAIL</code>).
          ถ้ายังไม่ตั้ง แม้เปิด toggle อีเมลจะถูก skip เงียบๆ (ไม่ error)
        </p>
      </div>

      {/* Business profile */}
      <div className="bg-slate-800 rounded-3xl p-6 shadow-xl border border-slate-700/50 space-y-4">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-sky-400" />
          <h2 className="text-base font-black text-white">ข้อมูลธุรกิจ (สำหรับออกเอกสาร)</h2>
        </div>
        <div className="flex items-start gap-2 text-[11px] text-amber-300/80 bg-amber-950/20 rounded-lg p-2.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>ชื่อนิติบุคคล / เลขผู้เสียภาษี / ที่อยู่ ต้องตรงกับที่จดทะเบียนจริง และควร sync กับหน้านโยบาย (PDPA) ของเว็บลูกค้า — ค่าที่นี่มีผลกับเอกสารบัญชี (ใบสำคัญรับเงิน / ใบกำกับภาษี)</span>
        </div>
        <Field label="ชื่อนิติบุคคล" value={s.company.legalName} onChange={(v) => setCompany({ legalName: v })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="ชื่อทางการค้า (Trade name)" value={s.company.tradeName} onChange={(v) => setCompany({ tradeName: v })} />
          <Field label="เลขประจำตัวผู้เสียภาษี" value={s.company.taxId} onChange={(v) => setCompany({ taxId: v })} />
        </div>
        <Field label="ที่อยู่" value={s.company.address} onChange={(v) => setCompany({ address: v })} textarea />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="สำนักงานใหญ่ / สาขา" value={s.company.branch} onChange={(v) => setCompany({ branch: v })} placeholder="สำนักงานใหญ่" />
          <Field label="เบอร์ติดต่อ (บนเอกสาร)" value={s.company.phone} onChange={(v) => setCompany({ phone: v })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Business Name (EN, ไม่บังคับ)" value={s.company.nameEn} onChange={(v) => setCompany({ nameEn: v })} />
          <Field label="Address (EN, ไม่บังคับ)" value={s.company.addressEn} onChange={(v) => setCompany({ addressEn: v })} />
        </div>
      </div>

      {/* VAT settings */}
      <div className="bg-slate-800 rounded-3xl p-6 shadow-xl border border-slate-700/50 space-y-5">
        <div className="flex items-center gap-2">
          <Percent size={18} className="text-blue-400" />
          <h2 className="text-base font-black text-white">ภาษีมูลค่าเพิ่ม (VAT)</h2>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-200">บริษัทจดทะเบียน VAT</p>
            <p className="text-xs text-slate-400 mt-0.5">เปิด = แตก VAT จากค่าบริการ + ออกใบกำกับภาษี / ปิด = ไม่ออกใบกำกับภาษี</p>
          </div>
          <Toggle checked={s.vat_registered} onChange={(v) => setS({ ...s, vat_registered: v })} />
        </div>

        <div className={`flex items-center justify-between gap-4 ${s.vat_registered ? '' : 'opacity-50'}`}>
          <div>
            <p className="text-sm font-bold text-slate-200">อัตรา VAT (%)</p>
            <p className="text-xs text-slate-400 mt-0.5">ถอดจากค่าบริการที่เก็บ (ถือว่าเป็นยอดรวม VAT แล้ว)</p>
          </div>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            disabled={!s.vat_registered}
            value={s.vat_rate_percent}
            onChange={(e) => setS({ ...s, vat_rate_percent: Number(e.target.value) })}
            className="w-24 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-right font-bold focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </div>
      </div>

      {/* Tax invoice */}
      <div className={`bg-slate-800 rounded-3xl p-6 shadow-xl border border-slate-700/50 space-y-4 ${s.vat_registered ? '' : 'opacity-50'}`}>
        <div className="flex items-center gap-2">
          <ReceiptText size={18} className="text-purple-400" />
          <h2 className="text-base font-black text-white">ใบกำกับภาษี</h2>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-200">คำนำหน้าเลขที่ใบกำกับภาษี</p>
            <p className="text-xs text-slate-400 mt-0.5">ตัวอย่างเลขถัดไป: <code className="px-1 rounded bg-black/30">{nextNumber}</code></p>
          </div>
          <input
            type="text"
            maxLength={12}
            disabled={!s.vat_registered}
            value={s.tax_invoice_prefix}
            onChange={(e) => setS({ ...s, tax_invoice_prefix: e.target.value })}
            className="w-28 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-right font-bold focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-200">รูปแบบเลขรัน</p>
            <p className="text-xs text-slate-400 mt-0.5">ปี/เดือน และ ปี จะรีเซ็ตเลขรันอัตโนมัติเมื่อขึ้นงวดใหม่</p>
          </div>
          <select
            disabled={!s.vat_registered}
            value={s.tax_invoice_format}
            onChange={(e) => setS({ ...s, tax_invoice_format: e.target.value as TaxInvoiceFormat })}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
          >
            <option value="plain">ต่อเนื่อง (000001)</option>
            <option value="year_month">ปี/เดือน (2026060001)</option>
            <option value="year">ปี (20260001)</option>
          </select>
        </div>
        <div className="text-xs text-slate-400 bg-slate-900/50 rounded-xl p-3 flex items-start gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>ออกใบกำกับภาษีเฉพาะออเดอร์ที่มีค่าบริการรับเครื่อง (pickup) ตอนสถานะ "จ่ายเงินแล้ว" — เลขรันเดินหน้าต่อเนื่องอัตโนมัติ</span>
        </div>

        {/* Running number + reset */}
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs text-slate-400">ออกใบกำกับภาษีไปแล้ว{periodKey ? ` (งวด ${periodKey})` : ''}</p>
              <p className="text-lg font-black text-white">{currentSeq.toLocaleString()} <span className="text-sm font-normal text-slate-400">ใบ</span></p>
              <p className="text-xs text-slate-400 mt-1">ใบถัดไป: <span className="text-emerald-400 font-bold">{nextNumber}</span></p>
            </div>
            <button
              onClick={handleResetSeq}
              disabled={resetting || !s.vat_registered}
              className="px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-600/50 text-rose-300 font-bold rounded-xl text-sm flex items-center gap-2 disabled:opacity-40"
            >
              {resetting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} รีเซ็ตเลขรันเป็น 0
            </button>
          </div>
          <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-300/80 bg-amber-950/20 rounded-lg p-2.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              ใช้ "รีเซ็ต" เฉพาะ<span className="font-bold">ก่อนเปิดใช้งานจริง</span>เพื่อล้างเลขจากการทดสอบ —
              <span className="font-bold"> ห้ามรีเซ็ตหลังออกใบกำกับภาษีจริง</span> เพราะจะทำให้เลขซ้ำ (ผิดกฎหมายภาษี)
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? <><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</>
          : showSuccess ? <><CheckCircle2 size={16} /> บันทึกเรียบร้อย</>
          : <><Save size={16} /> บันทึกการตั้งค่า</>}
      </button>
    </div>
  );
}
