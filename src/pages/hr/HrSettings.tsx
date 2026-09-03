// src/pages/hr/HrSettings.tsx
//
// ตั้งค่าเงินเดือน ภาษี และประกันสังคม — เจ้าของ `settings/hr`
//
// เหตุผลที่หน้านี้ต้องมี: อัตราพวกนี้เปลี่ยนจริงและเปลี่ยนบ่อยกว่าที่คิด
// (เพดานค่าจ้างประกันสังคมขยับจาก 15,000 เป็น 17,500 ในปี 2569) ถ้าการแก้
// ตัวเลขต้องรอ deploy แปลว่าเดือนที่กฎเปลี่ยนจะคำนวณผิดทั้งเดือน
//
// **สองข้อห้ามของหน้านี้:**
//
//   1. **ห้าม `set()` ที่ `settings/hr` เด็ดขาด ต้อง `update()` รายคีย์**
//      เพราะใต้โหนดเดียวกันมี `employee_code_seq_by_year` ซึ่งเป็นตัวนับรหัส
//      พนักงาน — เขียนทับทั้งก้อนเมื่อไหร่ ตัวนับกลับไปเริ่มใหม่ แล้วรหัส
//      พนักงานจะซ้ำกับคนที่มีอยู่แล้ว มีเทสตรึงไว้
//   2. **ไม่คำนวณเงินให้ดูในหน้านี้** — เครื่องคิดเงินมีตัวเดียวคือ
//      `functions/hr-payroll.js` การทำตัวอย่างให้ดูตรงนี้คือการสร้างสูตร
//      สำเนาที่สองซึ่งวันหนึ่งจะไม่ตรงกับตัวจริง อยากเห็นผลให้กดคำนวณรอบใหม่
//      ที่หน้ารอบจ่าย ซึ่งกางที่มาของทุกตัวเลขอยู่แล้ว
import React, { useEffect, useMemo, useState } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { useNavigate } from 'react-router-dom';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { Settings, Save, AlertTriangle, Plus, Trash2, ArrowRight, RotateCcw, ListPlus } from 'lucide-react';

// ต้องตรงกับ DEFAULT_* ใน functions/hr-payroll.js — ที่นี่ใช้แค่แสดงว่า
// "ถ้าไม่ตั้งจะได้ค่าอะไร" ไม่ได้ใช้คำนวณ ตัวคำนวณจริงอ่านค่าจาก DB เองฝั่ง server
const CODE_DEFAULTS = {
  payroll: { cutoff_day: 20, pay_day: 25, prorate_divisor: 30 },
  social_security: { enabled: true, rate_percent: 5, wage_floor: 1650, wage_ceiling: 17500, round_to_baht: true },
  income_tax: {
    enabled: true, expense_rate_percent: 50, expense_cap: 100000,
    personal_allowance: 60000, spouse_allowance: 60000, child_allowance: 30000,
    parent_allowance: 30000, sso_allowance_cap: 10500,
  },
  employee_code_prefix: 'EMP',
};

const DEFAULT_BRACKETS = [
  { upTo: 150000, rate: 0 },
  { upTo: 300000, rate: 5 },
  { upTo: 500000, rate: 10 },
  { upTo: 750000, rate: 15 },
  { upTo: 1000000, rate: 20 },
  { upTo: 2000000, rate: 25 },
  { upTo: 5000000, rate: 30 },
  { upTo: null as number | null, rate: 35 },
];

interface Bracket { upTo: number | null; rate: number }
interface Preset { label: string; kind: 'earning' | 'deduction'; taxable: boolean; sso_wage: boolean; occasional: boolean }

// ต้องตรงกับ DEFAULT_ADJUSTMENT_PRESETS ใน functions/hr-payroll.js
const DEFAULT_PRESETS: Preset[] = [
  { label: 'ค่าล่วงเวลา', kind: 'earning', taxable: true, sso_wage: true, occasional: false },
  { label: 'ค่าคอมมิชชั่น', kind: 'earning', taxable: true, sso_wage: true, occasional: false },
  { label: 'โบนัส', kind: 'earning', taxable: true, sso_wage: false, occasional: true },
  { label: 'เบี้ยขยัน', kind: 'earning', taxable: true, sso_wage: true, occasional: false },
  { label: 'หักขาด/ลา/มาสาย', kind: 'deduction', taxable: true, sso_wage: false, occasional: false },
  { label: 'หักเงินเบิกล่วงหน้า', kind: 'deduction', taxable: true, sso_wage: false, occasional: false },
  { label: 'เงินหักอื่นๆ', kind: 'deduction', taxable: true, sso_wage: false, occasional: false },
];

const numOr = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const HrSettings = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    cutoff_day: '20', pay_day: '25', prorate_divisor: '30',
    sso_enabled: true, sso_rate: '5', sso_floor: '1650', sso_ceiling: '17500', sso_round: true,
    tax_enabled: true, expense_rate: '50', expense_cap: '100000',
    personal: '60000', spouse: '60000', child: '30000', parent: '30000', sso_allowance_cap: '10500',
    code_prefix: 'EMP',
  });
  const [brackets, setBrackets] = useState<Bracket[]>(DEFAULT_BRACKETS);
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_PRESETS);

  useEffect(() => {
    const unsub = onValue(ref(db, 'settings/hr'), (snap) => {
      const v = snap.val() || {};
      const p = v.payroll || {}; const s = v.social_security || {}; const t = v.income_tax || {};
      const d = CODE_DEFAULTS;
      setForm({
        cutoff_day: String(numOr(p.cutoff_day, d.payroll.cutoff_day)),
        pay_day: String(numOr(p.pay_day, d.payroll.pay_day)),
        prorate_divisor: String(numOr(p.prorate_divisor, d.payroll.prorate_divisor)),
        sso_enabled: s.enabled !== false,
        sso_rate: String(numOr(s.rate_percent, d.social_security.rate_percent)),
        sso_floor: String(numOr(s.wage_floor, d.social_security.wage_floor)),
        sso_ceiling: String(numOr(s.wage_ceiling, d.social_security.wage_ceiling)),
        sso_round: s.round_to_baht !== false,
        tax_enabled: t.enabled !== false,
        expense_rate: String(numOr(t.expense_rate_percent, d.income_tax.expense_rate_percent)),
        expense_cap: String(numOr(t.expense_cap, d.income_tax.expense_cap)),
        personal: String(numOr(t.personal_allowance, d.income_tax.personal_allowance)),
        spouse: String(numOr(t.spouse_allowance, d.income_tax.spouse_allowance)),
        child: String(numOr(t.child_allowance, d.income_tax.child_allowance)),
        parent: String(numOr(t.parent_allowance, d.income_tax.parent_allowance)),
        sso_allowance_cap: String(numOr(t.sso_allowance_cap, d.income_tax.sso_allowance_cap)),
        code_prefix: String(v.employee_code_prefix || d.employee_code_prefix),
      });
      setBrackets(Array.isArray(t.brackets) && t.brackets.length
        ? t.brackets.map((b: { upTo?: number | null; rate?: number }) => ({
            upTo: b.upTo == null ? null : Number(b.upTo), rate: Number(b.rate) || 0,
          }))
        : DEFAULT_BRACKETS);
      setPresets(Array.isArray(v.adjustment_presets) && v.adjustment_presets.length
        ? v.adjustment_presets.map((r: Partial<Preset>) => ({
            label: String(r.label || ''),
            kind: r.kind === 'deduction' ? 'deduction' : 'earning',
            taxable: r.taxable !== false,
            sso_wage: Boolean(r.sso_wage),
            occasional: Boolean(r.occasional),
          }))
        : DEFAULT_PRESETS);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // เพดานลดหย่อนที่บีบต่ำกว่ายอดที่หักไปจริง = คิดภาษีจากเงินที่ลูกจ้างไม่เคย
  // ได้รับ เตือนตรงนี้เพราะมันมองไม่เห็นจากตัวเลขสองตัวที่อยู่คนละหัวข้อกัน
  const capWarning = useMemo(() => {
    const maxMonthly = (Number(form.sso_ceiling) * Number(form.sso_rate)) / 100;
    const needed = Math.round(maxMonthly * 12);
    const cap = Number(form.sso_allowance_cap);
    if (!Number.isFinite(needed) || !Number.isFinite(cap) || cap >= needed) return null;
    return `เพดานลดหย่อนประกันสังคม (${cap.toLocaleString('th-TH')}) ต่ำกว่ายอดสมทบสูงสุดทั้งปีตามค่าที่ตั้งไว้ (${needed.toLocaleString('th-TH')}) — จะคิดภาษีจากเงินที่ลูกจ้างไม่เคยได้รับ`;
  }, [form.sso_ceiling, form.sso_rate, form.sso_allowance_cap]);

  const validate = (): string | null => {
    const int = (v: string) => Math.round(Number(v));
    if (!(int(form.cutoff_day) >= 1 && int(form.cutoff_day) <= 28)) return 'วันตัดรอบต้องอยู่ระหว่าง 1-28';
    if (!(int(form.pay_day) >= 1 && int(form.pay_day) <= 28)) return 'วันจ่ายต้องอยู่ระหว่าง 1-28';
    if (!(int(form.prorate_divisor) >= 1 && int(form.prorate_divisor) <= 31)) return 'ตัวหารคิดสัดส่วนต้องอยู่ระหว่าง 1-31';
    if (Number(form.sso_rate) < 0 || Number(form.sso_rate) > 100) return 'อัตราประกันสังคมต้องอยู่ระหว่าง 0-100';
    if (Number(form.sso_ceiling) <= Number(form.sso_floor)) return 'เพดานค่าจ้างต้องมากกว่าพื้น';
    if (Number(form.expense_rate) < 0 || Number(form.expense_rate) > 100) return 'อัตราค่าใช้จ่ายเหมาต้องอยู่ระหว่าง 0-100';
    for (const key of ['expense_cap', 'personal', 'spouse', 'child', 'parent', 'sso_allowance_cap', 'sso_floor', 'sso_ceiling'] as const) {
      if (!(Number(form[key]) >= 0)) return 'ค่าที่เป็นจำนวนเงินต้องไม่ติดลบ';
    }
    if (!form.code_prefix.trim()) return 'ต้องระบุคำนำหน้ารหัสพนักงาน';

    if (!brackets.length) return 'ต้องมีขั้นบันไดภาษีอย่างน้อย 1 ขั้น';
    if (brackets[brackets.length - 1].upTo != null) return 'ขั้นบนสุดต้องเว้นช่อง "ถึง" ไว้ (ไม่มีเพดาน)';
    let prev = 0;
    for (let i = 0; i < brackets.length - 1; i++) {
      const u = brackets[i].upTo;
      if (u == null) return 'มีแต่ขั้นบนสุดเท่านั้นที่เว้นช่อง "ถึง" ได้';
      if (!(u > prev)) return 'ขั้นบันไดต้องเรียงจากน้อยไปมาก';
      prev = u;
    }
    if (brackets.some((b) => b.rate < 0 || b.rate > 100)) return 'อัตราภาษีต้องอยู่ระหว่าง 0-100';
    if (presets.some((r) => !r.label.trim())) return 'รายการปรับเพิ่ม/ปรับลดต้องมีชื่อทุกบรรทัด';
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      // update() รายคีย์เท่านั้น — ห้าม set() ที่ settings/hr เพราะจะลบ
      // employee_code_seq_by_year (ตัวนับรหัสพนักงาน) ทิ้ง แล้วรหัสจะซ้ำ
      await update(ref(db, 'settings/hr'), {
        payroll: {
          cycle: 'monthly',
          cutoff_day: Math.round(Number(form.cutoff_day)),
          pay_day: Math.round(Number(form.pay_day)),
          prorate_divisor: Math.round(Number(form.prorate_divisor)),
        },
        social_security: {
          enabled: form.sso_enabled,
          rate_percent: Number(form.sso_rate),
          wage_floor: Number(form.sso_floor),
          wage_ceiling: Number(form.sso_ceiling),
          round_to_baht: form.sso_round,
        },
        income_tax: {
          enabled: form.tax_enabled,
          expense_rate_percent: Number(form.expense_rate),
          expense_cap: Number(form.expense_cap),
          personal_allowance: Number(form.personal),
          spouse_allowance: Number(form.spouse),
          child_allowance: Number(form.child),
          parent_allowance: Number(form.parent),
          sso_allowance_cap: Number(form.sso_allowance_cap),
          brackets: brackets.map((b) => ({ upTo: b.upTo, rate: b.rate })),
        },
        employee_code_prefix: form.code_prefix.trim(),
        adjustment_presets: presets.map((r) => ({
          label: r.label.trim(), kind: r.kind, taxable: r.taxable, sso_wage: r.sso_wage, occasional: r.occasional,
        })),
      });
      toast.success('บันทึกค่าตั้งแล้ว — รอบที่อนุมัติไปแล้วไม่เปลี่ยนตาม');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const money = (key: keyof typeof form, label: string, hint?: string) => (
    <label className="block">
      <span className="text-xs font-bold text-gray-500">{label}</span>
      <input type="number" value={String(form[key])} onChange={(e) => set(key as string, e.target.value)}
        className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200" />
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </label>
  );

  if (loading) return <p className="text-center text-gray-400 py-16 font-bold">กำลังโหลด...</p>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <Settings className="text-rose-500" /> ตั้งค่าเงินเดือน ภาษี และประกันสังคม
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            อัตราทุกตัวที่รอบจ่ายเงินเดือนใช้คำนวณ อยู่ที่นี่ที่เดียว แก้แล้วมีผลกับรอบที่คำนวณใหม่ทันที ไม่ต้องรอ deploy
          </p>
        </div>
        <button onClick={() => void save()} disabled={saving}
          className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2">
          <Save size={16} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold flex items-center gap-2"><AlertTriangle size={16} /> การแก้ที่นี่ไม่ย้อนไปแก้รอบที่อนุมัติแล้ว</p>
        <p className="mt-1 leading-relaxed">
          รอบที่อนุมัติไปแล้ว <b>แช่อัตราที่ใช้ตอนนั้นไว้กับตัวรอบ</b> ตัวเลขบนสลิปที่ส่งไปแล้วจึงไม่เปลี่ยน
          ส่วนรอบที่ยังเป็น &quot;ร่าง&quot; ต้องกด <b>คำนวณรอบนี้</b> ใหม่ถึงจะใช้ค่าใหม่
        </p>
        <button onClick={() => navigate('/payroll')}
          className="mt-2 text-amber-900 font-bold underline underline-offset-2 flex items-center gap-1">
          ไปหน้ารอบจ่ายเงินเดือน <ArrowRight size={13} />
        </button>
      </div>

      {capWarning && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 font-bold flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" /> {capWarning}
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="font-black text-gray-800 mb-1">รอบจ่าย</h2>
        <p className="text-xs text-gray-500 mb-4">
          ตัดรอบวันที่ {form.cutoff_day} จ่ายวันที่ {form.pay_day} — งวดของเดือนหนึ่งจะเริ่มวันถัดจากวันตัดรอบของเดือนก่อน
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {money('cutoff_day', 'วันตัดรอบ (1-28)')}
          {money('pay_day', 'วันจ่าย (1-28)')}
          {money('prorate_divisor', 'ตัวหารคิดสัดส่วน', 'ใช้คิดค่าจ้างต่อวันของลูกจ้างรายเดือน (กฎหมายแรงงานใช้ 30)')}
        </div>
        <div className="mt-3">
          <label className="block max-w-xs">
            <span className="text-xs font-bold text-gray-500">คำนำหน้ารหัสพนักงาน</span>
            <input value={form.code_prefix} onChange={(e) => set('code_prefix', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <span className="text-[11px] text-gray-400">เช่น EMP → EMP-2569-0001 · ตัวนับรหัสไม่ถูกแตะเมื่อบันทึกหน้านี้</span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-black text-gray-800">ประกันสังคม</h2>
          <label className="flex items-center gap-2 text-sm font-bold text-gray-600">
            <input type="checkbox" checked={form.sso_enabled} onChange={(e) => set('sso_enabled', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300" /> หักประกันสังคม
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          ปี 2569 เพดานค่าจ้างปรับเป็น 17,500 (สมทบสูงสุด 875 บาท/เดือน) พื้น 1,650 (สมทบต่ำสุด 83 บาท/เดือน)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {money('sso_rate', 'อัตราสมทบ (%)')}
          {money('sso_floor', 'พื้นค่าจ้าง (บาท)')}
          {money('sso_ceiling', 'เพดานค่าจ้าง (บาท)')}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 mt-3">
          <input type="checkbox" checked={form.sso_round} onChange={(e) => set('sso_round', e.target.checked)}
            className="w-4 h-4 rounded border-gray-300" />
          ปัดเงินสมทบเป็นจำนวนเต็มบาท
          <span className="text-[11px] text-gray-400">(ตารางของประกันสังคมเก็บ 83 บาทที่ค่าจ้างพื้น ซึ่งคือ 82.50 ปัดขึ้น)</span>
        </label>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-black text-gray-800">ภาษีเงินได้ (ภ.ง.ด.1)</h2>
          <label className="flex items-center gap-2 text-sm font-bold text-gray-600">
            <input type="checkbox" checked={form.tax_enabled} onChange={(e) => set('tax_enabled', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300" /> หักภาษี ณ ที่จ่าย
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          คิดแบบประมาณการเงินได้ทั้งปีแล้วหารจำนวนงวด — ค่าลดหย่อนรายคน (คู่สมรส บุตร บิดามารดา) ตั้งที่แฟ้มพนักงานแต่ละคน
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {money('expense_rate', 'ค่าใช้จ่ายเหมา (%)')}
          {money('expense_cap', 'เพดานค่าใช้จ่ายเหมา (บาท/ปี)')}
          {money('personal', 'ลดหย่อนส่วนตัว (บาท/ปี)')}
          {money('spouse', 'ลดหย่อนคู่สมรส (บาท/ปี)')}
          {money('child', 'ลดหย่อนบุตร (บาท/คน/ปี)')}
          {money('parent', 'ลดหย่อนบิดามารดา (บาท/คน/ปี)')}
          {money('sso_allowance_cap', 'เพดานลดหย่อนประกันสังคม (บาท/ปี)', 'ต้องไม่ต่ำกว่ายอดสมทบสูงสุดทั้งปี')}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-black text-gray-800">ขั้นบันไดภาษี</h2>
          <button onClick={() => setBrackets(DEFAULT_BRACKETS)}
            className="text-xs font-bold text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <RotateCcw size={13} /> คืนค่าตั้งต้น
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          เรียงจากน้อยไปมาก · ขั้นบนสุดเว้นช่อง &quot;ถึง&quot; ไว้ (ไม่มีเพดาน) · คิดแบบขั้นบันได ไม่ใช่อัตราเดียวทั้งก้อน
        </p>
        <div className="space-y-2">
          {brackets.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-14 shrink-0">ขั้น {i + 1}</span>
              <input type="number" placeholder="ไม่มีเพดาน"
                value={b.upTo == null ? '' : String(b.upTo)}
                onChange={(e) => setBrackets((rows) => rows.map((r, idx) =>
                  idx === i ? { ...r, upTo: e.target.value === '' ? null : Number(e.target.value) } : r))}
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm" />
              <span className="text-xs text-gray-400 shrink-0">อัตรา %</span>
              <input type="number" value={String(b.rate)}
                onChange={(e) => setBrackets((rows) => rows.map((r, idx) =>
                  idx === i ? { ...r, rate: Number(e.target.value) } : r))}
                className="w-24 px-3 py-2 rounded-xl border border-gray-200 text-sm" />
              <button onClick={() => setBrackets((rows) => rows.filter((_, idx) => idx !== i))}
                className="text-gray-300 hover:text-rose-500 shrink-0"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setBrackets((rows) => [...rows, { upTo: null, rate: 0 }])}
          className="mt-3 text-sm font-bold text-gray-600 hover:text-gray-800 flex items-center gap-1">
          <Plus size={15} /> เพิ่มขั้น
        </button>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-black text-gray-800 flex items-center gap-2"><ListPlus size={18} /> รายการปรับเพิ่ม / ปรับลด ที่ใช้ประจำ</h2>
          <button onClick={() => setPresets(DEFAULT_PRESETS)}
            className="text-xs font-bold text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <RotateCcw size={13} /> คืนค่าตั้งต้น
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          ตัวช่วยกรอกในหน้ารอบจ่าย เช่น ค่าคอมมิชชั่นของพนักงานขาย ค่าล่วงเวลา หักขาด/ลา/มาสาย —
          ตั้งชื่อไว้ที่นี่แล้วเลือกใช้ได้ทุกเดือนโดยไม่ต้องพิมพ์ใหม่ (ชื่อที่พิมพ์ต่างกันทุกเดือนทำให้รายงานย้อนหลังรวมยอดไม่ได้)
        </p>
        <p className="text-xs text-gray-500 mb-3 rounded-xl bg-gray-50 p-3 leading-relaxed">
          <b>เข้าฐานประกันสังคม</b> — ค่าล่วงเวลาและค่าคอมมิชชั่นเป็น &quot;ค่าจ้าง&quot; ตามกฎหมายประกันสังคมจึงเข้าฐานสมทบ
          ส่วนโบนัสประจำปีโดยทั่วไปไม่ใช่ ค่าที่ตั้งตรงนี้เป็นแค่ค่าเริ่มต้น หน้ารอบจ่ายยังติ๊กแก้รายบรรทัดได้เสมอ
          เพราะเส้นแบ่งขึ้นกับข้อเท็จจริงของรายการ ไม่ใช่ชื่อของมัน
          <br /><br />
          <b>จ่ายเป็นครั้งคราว</b> — รายการที่ไม่ได้จ่ายทุกเดือน (โบนัส คอมมิชชั่นที่ขึ้นลงแรง) จะไม่ถูกคูณจำนวนงวด
          ตอนประมาณการภาษีทั้งปี ระบบจะคิดภาษีจากรายได้ประจำก่อน แล้วบวกเฉพาะส่วนต่างที่เกิดจากก้อนนั้นในงวดที่จ่ายจริง —
          ถ้าไม่ติ๊ก ระบบจะเดาว่าได้เท่านี้ทุกเดือน แล้วหักภาษีเกินจริงในเดือนที่ได้ก้อนใหญ่
        </p>
        <div className="space-y-2">
          {presets.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select value={r.kind}
                onChange={(e) => setPresets((rows) => rows.map((x, idx) =>
                  idx === i ? { ...x, kind: e.target.value as Preset['kind'] } : x))}
                className="text-xs font-bold border border-gray-200 rounded-lg px-2 py-2 bg-white">
                <option value="earning">ปรับเพิ่ม</option>
                <option value="deduction">ปรับลด</option>
              </select>
              <input value={r.label}
                onChange={(e) => setPresets((rows) => rows.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                className="flex-1 min-w-[10rem] px-3 py-2 rounded-xl border border-gray-200 text-sm" />
              {r.kind === 'earning' && (
                <>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                    <input type="checkbox" checked={r.taxable}
                      onChange={(e) => setPresets((rows) => rows.map((x, idx) => (idx === i ? { ...x, taxable: e.target.checked } : x)))}
                      className="w-3.5 h-3.5 rounded border-gray-300" /> เสียภาษี
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                    <input type="checkbox" checked={r.sso_wage}
                      onChange={(e) => setPresets((rows) => rows.map((x, idx) => (idx === i ? { ...x, sso_wage: e.target.checked } : x)))}
                      className="w-3.5 h-3.5 rounded border-gray-300" /> เข้าฐานประกันสังคม
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
                    <input type="checkbox" checked={r.occasional}
                      onChange={(e) => setPresets((rows) => rows.map((x, idx) => (idx === i ? { ...x, occasional: e.target.checked } : x)))}
                      className="w-3.5 h-3.5 rounded border-gray-300" /> จ่ายเป็นครั้งคราว
                  </label>
                </>
              )}
              <button onClick={() => setPresets((rows) => rows.filter((_, idx) => idx !== i))}
                className="text-gray-300 hover:text-rose-500"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setPresets((rows) => [...rows, { label: '', kind: 'earning', taxable: true, sso_wage: true, occasional: false }])}
          className="mt-3 text-sm font-bold text-gray-600 hover:text-gray-800 flex items-center gap-1">
          <Plus size={15} /> เพิ่มรายการ
        </button>
      </section>

      <p className="text-xs text-gray-400 leading-relaxed">
        หน้านี้ไม่แสดงตัวอย่างการคำนวณโดยตั้งใจ — เครื่องคิดเงินมีตัวเดียวอยู่ฝั่ง server
        การทำสูตรจำลองไว้ตรงนี้คือสำเนาที่สองที่วันหนึ่งจะไม่ตรงกับตัวจริง
        อยากเห็นผลของค่าที่เพิ่งตั้ง ให้กด &quot;คำนวณรอบนี้&quot; ที่หน้ารอบจ่าย ซึ่งกางที่มาของทุกตัวเลขให้ตรวจอยู่แล้ว
      </p>
    </div>
  );
};
