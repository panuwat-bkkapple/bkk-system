// หน้าตั้งค่าระบบบัญชี (CEO / FINANCE)
//
// คุมระบบส่งอีเมลยืนยันออเดอร์ + ออกเอกสาร (ใบสำคัญรับเงิน / ใบกำกับภาษี)
// ที่ทำงานใน Cloud Functions (onJobCreatedSendEmails / onJobStatusEmail).
// Functions อ่านค่าจาก settings/accounting — ถ้า master toggle ปิดอยู่
// ระบบจะไม่ทำอะไรเลย (ไม่ส่งอีเมล ไม่จองเลขใบกำกับภาษี ไม่เขียน Storage)
// เพื่อให้ deploy ได้อย่างปลอดภัยก่อนตั้งค่า Resend เสร็จ.
//
// ธีมหน้าตั้งค่า = สว่าง (การ์ดขาว ขอบ slate-200) ให้ตรงกับหน้าอื่นใต้
// SettingsLayout เช่น /email-settings — อย่ากลับไปใช้การ์ดพื้นเข้ม

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ref, onValue, update } from 'firebase/database';
import {
  Calculator, Save, Loader2, CheckCircle2, ReceiptText, Percent, Info, AlertTriangle,
  RotateCcw, Building2, Mail, ChevronRight,
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

const INPUT_CLS =
  'w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-sm font-bold ' +
  'placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:border-indigo-500 ' +
  'focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400';

function Field({
  label, value, onChange, textarea, placeholder, hint, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  textarea?: boolean; placeholder?: string; hint?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-black text-slate-500 uppercase tracking-wide">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {textarea ? (
        <textarea rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${INPUT_CLS} mt-1.5 resize-none leading-relaxed`} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`${INPUT_CLS} mt-1.5`} />
      )}
      {hint && <span className="block text-[11px] font-bold text-slate-400 mt-1">{hint}</span>}
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
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-emerald-500' : 'bg-slate-300'
      }`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// การ์ด section มาตรฐานของหน้านี้ — หัวข้อ + ไอคอนสี + เนื้อหา
function Section({
  icon, tint, title, subtitle, children, dimmed,
}: {
  icon: React.ReactNode; tint: string; title: string; subtitle?: string;
  children: React.ReactNode; dimmed?: boolean;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-2xl overflow-hidden transition-opacity ${dimmed ? 'opacity-60' : ''}`}>
      <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tint}`}>{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-800">{title}</h2>
          {subtitle && <p className="text-[11px] font-bold text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

// แถวตั้งค่า: คำอธิบายซ้าย — ตัวควบคุมขวา
function Row({ title, desc, children, last }: { title: string; desc?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3.5 ${last ? '' : 'border-b border-slate-100'}`}>
      <div className="min-w-0">
        <p className="text-sm font-black text-slate-700">{title}</p>
        {desc && <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function AccountingSettings() {
  const toast = useToast();
  const [s, setS] = useState<AccountingSettings>(DEFAULTS);
  const [saved, setSaved] = useState<AccountingSettings>(DEFAULTS);
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
      const next: AccountingSettings = {
        order_emails_enabled: v.order_emails_enabled === true,
        vat_registered: v.vat_registered !== false,
        vat_rate_percent: typeof v.vat_rate_percent === 'number' ? v.vat_rate_percent : 7,
        tax_invoice_prefix: typeof v.tax_invoice_prefix === 'string' && v.tax_invoice_prefix ? v.tax_invoice_prefix : 'IV-',
        tax_invoice_format: (['plain', 'year_month', 'year'].includes(v.tax_invoice_format) ? v.tax_invoice_format : 'plain') as TaxInvoiceFormat,
        company: { ...DEFAULT_COMPANY, ...c },
      };
      setS(next);
      setSaved(next); // baseline สำหรับ "มีการแก้ที่ยังไม่บันทึก"
      setSeq(typeof v.tax_invoice_seq === 'number' ? v.tax_invoice_seq : 0);
      setSeqByPeriod(v.tax_invoice_seq_by_period && typeof v.tax_invoice_seq_by_period === 'object' ? v.tax_invoice_seq_by_period : {});
      setLoaded(true);
    });
    return () => { unsub(); };
  }, []);

  const setCompany = (patch: Partial<CompanyProfile>) => setS((prev) => ({ ...prev, company: { ...prev.company, ...patch } }));

  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved]);

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
      <div className="p-8 flex items-center gap-2 text-slate-500 font-bold text-sm">
        <Loader2 size={18} className="animate-spin" /> กำลังโหลดการตั้งค่า...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <Calculator size={20} className="text-emerald-600" /> ตั้งค่าระบบบัญชี
        </h1>
        <p className="text-xs font-bold text-slate-500 mt-1">
          สวิตช์หลักของระบบอีเมล · ข้อมูลนิติบุคคลบนเอกสาร · VAT · เลขที่ใบกำกับภาษี
        </p>
      </div>

      {/* สวิตช์หลัก — สถานะปัจจุบันอ่านได้ในบรรทัดเดียว */}
      <div className={`rounded-2xl border p-5 mb-4 ${s.order_emails_enabled ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black text-slate-800">ระบบส่งอีเมล + ออกเอกสารอัตโนมัติ</h2>
              <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                s.order_emails_enabled ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-300'
              }`}>
                {s.order_emails_enabled ? 'เปิดอยู่' : 'ปิดอยู่'}
              </span>
            </div>
            <p className="text-xs font-bold text-slate-500 mt-1.5 leading-relaxed">
              {s.order_emails_enabled
                ? 'ระบบส่งอีเมลยืนยันออเดอร์ให้ลูกค้า/ทีม และออกใบสำคัญรับเงิน + ใบกำกับภาษีตอนสถานะ "จ่ายเงินแล้ว" อัตโนมัติ'
                : 'ตอนนี้ระบบไม่ทำอะไรเลย — ไม่ส่งอีเมล ไม่จองเลขใบกำกับภาษี (ปลอดภัยสำหรับช่วงตั้งค่า)'}
            </p>
          </div>
          <Toggle checked={s.order_emails_enabled} onChange={(v) => setS({ ...s, order_emails_enabled: v })} />
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200/70 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/email-settings" className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-600 hover:text-indigo-700">
            <Mail size={13} /> แก้ข้อความอีเมลรายสถานะ <ChevronRight size={12} />
          </Link>
          <span className="inline-flex items-start gap-1.5 text-[11px] font-bold text-slate-400">
            <Info size={13} className="shrink-0 mt-px" />
            ต้องตั้ง Resend (verify domain + GitHub Secrets: RESEND_API_KEY, EMAIL_FROM, ORDER_NOTIFY_EMAIL) ก่อนอีเมลจึงออกจริง
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* ข้อมูลนิติบุคคล */}
        <Section
          icon={<Building2 size={17} className="text-sky-600" />}
          tint="bg-sky-50"
          title="ข้อมูลนิติบุคคล"
          subtitle="ใช้พิมพ์บนใบสำคัญรับเงินและใบกำกับภาษี — ต้องตรงกับที่จดทะเบียนจริง"
        >
          <div className="space-y-4">
            <Field label="ชื่อนิติบุคคล" required value={s.company.legalName} onChange={(v) => setCompany({ legalName: v })} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="ชื่อทางการค้า" value={s.company.tradeName} onChange={(v) => setCompany({ tradeName: v })} hint="ชื่อแบรนด์ที่ลูกค้ารู้จัก" />
              <Field label="เลขประจำตัวผู้เสียภาษี" required value={s.company.taxId} onChange={(v) => setCompany({ taxId: v })} />
            </div>
            <Field label="ที่อยู่" required value={s.company.address} onChange={(v) => setCompany({ address: v })} textarea />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="สำนักงานใหญ่ / สาขา" value={s.company.branch} onChange={(v) => setCompany({ branch: v })} placeholder="สำนักงานใหญ่" />
              <Field label="เบอร์ติดต่อบนเอกสาร" value={s.company.phone} onChange={(v) => setCompany({ phone: v })} placeholder="02-xxx-xxxx" />
            </div>

            <details className="group">
              <summary className="cursor-pointer text-[11px] font-black text-slate-500 hover:text-slate-700 list-none flex items-center gap-1">
                <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
                ภาษาอังกฤษ (ไม่บังคับ)
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <Field label="Business Name (EN)" value={s.company.nameEn} onChange={(v) => setCompany({ nameEn: v })} />
                <Field label="Address (EN)" value={s.company.addressEn} onChange={(v) => setCompany({ addressEn: v })} />
              </div>
            </details>

            <p className="flex items-start gap-2 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              ค่าชุดนี้ควร sync กับหน้านโยบายความเป็นส่วนตัว (PDPA) ของเว็บลูกค้าด้วย
            </p>
          </div>
        </Section>

        {/* VAT */}
        <Section
          icon={<Percent size={17} className="text-blue-600" />}
          tint="bg-blue-50"
          title="ภาษีมูลค่าเพิ่ม (VAT)"
          subtitle="ใช้กับค่าบริการรับเครื่องและการขายสินค้า"
        >
          <Row
            title="บริษัทจดทะเบียน VAT"
            desc="ปิด = ไม่ออกใบกำกับภาษีและไม่แตก VAT จากยอดใดๆ"
          >
            <Toggle checked={s.vat_registered} onChange={(v) => setS({ ...s, vat_registered: v })} />
          </Row>
          <Row
            title="อัตรา VAT"
            desc="ถอดจากยอดที่เก็บ (ถือว่าเป็นยอดรวม VAT แล้ว)"
            last
          >
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={0} max={100} step={0.5}
                disabled={!s.vat_registered}
                value={s.vat_rate_percent}
                onChange={(e) => setS({ ...s, vat_rate_percent: Number(e.target.value) })}
                className={`${INPUT_CLS} w-20 text-right`}
              />
              <span className="text-sm font-black text-slate-400">%</span>
            </div>
          </Row>
        </Section>

        {/* ใบกำกับภาษี */}
        <Section
          icon={<ReceiptText size={17} className="text-purple-600" />}
          tint="bg-purple-50"
          title="เลขที่ใบกำกับภาษี"
          subtitle="ออกอัตโนมัติตอนสถานะ &quot;จ่ายเงินแล้ว&quot; และตอนขายสินค้า"
          dimmed={!s.vat_registered}
        >
          {/* ตัวอย่างเลขถัดไป — ตัวเลขจริงที่จะออกใบหน้า */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide">เลขใบถัดไป</p>
              <p className="text-2xl font-black text-slate-800 font-mono mt-0.5">{nextNumber}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-wide">
                ออกไปแล้ว{periodKey ? ` (งวด ${periodKey})` : ''}
              </p>
              <p className="text-2xl font-black text-slate-800 mt-0.5">
                {currentSeq.toLocaleString()} <span className="text-sm font-bold text-slate-400">ใบ</span>
              </p>
            </div>
          </div>

          <Row title="คำนำหน้าเลขที่" desc="ตัวอักษรนำหน้า เช่น IV-">
            <input
              type="text" maxLength={12}
              disabled={!s.vat_registered}
              value={s.tax_invoice_prefix}
              onChange={(e) => setS({ ...s, tax_invoice_prefix: e.target.value })}
              className={`${INPUT_CLS} w-28 text-right font-mono`}
            />
          </Row>
          <Row title="รูปแบบเลขรัน" desc="แบบปี และ ปี/เดือน จะเริ่มนับ 1 ใหม่เมื่อขึ้นงวดใหม่" last>
            <select
              disabled={!s.vat_registered}
              value={s.tax_invoice_format}
              onChange={(e) => setS({ ...s, tax_invoice_format: e.target.value as TaxInvoiceFormat })}
              className={`${INPUT_CLS} w-auto`}
            >
              <option value="plain">ต่อเนื่อง (000001)</option>
              <option value="year_month">ปี/เดือน (2026080001)</option>
              <option value="year">ปี (20260001)</option>
            </select>
          </Row>

          {/* Danger zone — แยกออกจากการตั้งค่าปกติชัดเจน */}
          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-black text-rose-700">รีเซ็ตเลขรันเป็น 0</p>
                <p className="text-[11px] font-bold text-rose-600/80 mt-1 leading-relaxed">
                  ใช้เฉพาะ<span className="font-black">ก่อนเปิดใช้งานจริง</span> เพื่อล้างเลขจากการทดสอบ —
                  <span className="font-black"> ห้ามรีเซ็ตหลังออกใบจริงแล้ว</span> เพราะเลขจะซ้ำ (ผิดกฎหมายภาษี)
                </p>
              </div>
              <button
                onClick={handleResetSeq}
                disabled={resetting || !s.vat_registered}
                className="px-4 py-2 bg-white hover:bg-rose-100 border border-rose-300 text-rose-700 font-black rounded-xl text-xs flex items-center gap-2 disabled:opacity-40 shrink-0"
              >
                {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} รีเซ็ต
              </button>
            </div>
          </div>
        </Section>
      </div>

      {/* แถบบันทึก — sticky อยู่ในคอลัมน์เนื้อหา (ไม่ใช่ fixed กับขอบจอ ซึ่งจะเยื้อง
          เพราะไม่รู้ความกว้างของเมนูซ้าย 2 ชั้น) */}
      <div className="sticky bottom-4 mt-4">
        <div className={`rounded-2xl border shadow-lg px-4 py-3 flex items-center justify-between gap-4 backdrop-blur transition-colors ${
          dirty ? 'bg-white/95 border-indigo-200' : 'bg-white/90 border-slate-200'
        }`}>
          <p className="text-[11px] font-black text-slate-500 min-w-0 truncate">
            {showSuccess ? <span className="text-emerald-600">บันทึกเรียบร้อยแล้ว</span>
              : dirty ? <span className="text-indigo-600">มีการแก้ไขที่ยังไม่ได้บันทึก</span>
              : 'การตั้งค่าเป็นปัจจุบัน'}
          </p>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs shadow-sm transition-all flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-emerald-600 shrink-0"
          >
            {saving ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</>
              : showSuccess ? <><CheckCircle2 size={14} /> บันทึกแล้ว</>
              : <><Save size={14} /> บันทึกการตั้งค่า</>}
          </button>
        </div>
      </div>
    </div>
  );
}
