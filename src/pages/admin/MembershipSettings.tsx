'use client';

import { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { Gift, Save, Loader2, CheckCircle2, Plus, Trash2, ArrowUp, ArrowDown, Info } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

// Membership benefits config — edited here, stored at settings/store/membership
// (public-read subtree so the customer site reads it without a rules deploy),
// and rendered in the checkout "Learn more" sheet on bkk-frontend-next.
//
// icon = a key the customer app maps to a lucide icon. Keep this list in sync
// with ICON_MAP in bkk-frontend-next/app/components/checkout-v2/DeliveryDestinationSheets.tsx
const ICON_KEYS = [
  'zap', 'activity', 'history', 'ticket', 'shield',
  'wallet', 'gift', 'star', 'clock', 'trending-up', 'badge-check', 'lock',
];

interface Benefit { icon: string; title: string; desc: string }
interface MembershipConfig {
  enabled: boolean;
  header_title: string;
  header_subtitle: string;
  cta_text: string;
  card_image_url: string;
  benefits: Benefit[];
}

const DEFAULT_CONFIG: MembershipConfig = {
  enabled: true,
  header_title: 'สิทธิประโยชน์สมาชิก BKK APPLE',
  header_subtitle: 'สมัครฟรี ไม่มีค่าใช้จ่าย — ขายกับเราง่ายและคุ้มกว่าทุกครั้ง',
  cta_text: '',
  card_image_url: '',
  benefits: [
    { icon: 'zap', title: 'ขายซ้ำเร็วใน 1 แตะ', desc: 'ข้อมูลยืนยันตัวตน บัญชีรับเงิน และที่อยู่ถูกบันทึกไว้ ครั้งต่อไปไม่ต้องกรอกใหม่' },
    { icon: 'activity', title: 'ติดตามสถานะแบบเรียลไทม์', desc: 'รู้ทุกขั้นตอนตั้งแต่รับเครื่องจนโอนเงิน' },
    { icon: 'history', title: 'ประวัติการขายครบทุกครั้ง', desc: 'ดูรายการที่เคยขายและยอดที่ได้รับย้อนหลังได้ในบัญชี' },
    { icon: 'ticket', title: 'คูปองและสิทธิ์เฉพาะสมาชิก', desc: 'รับคูปองส่วนลด/โบนัส และรีวอร์ดจากการรีวิวเฉพาะสมาชิก' },
    { icon: 'shield', title: 'ปลอดภัยและเป็นส่วนตัว', desc: 'ข้อมูลของคุณถูกเก็บตามมาตรฐาน PDPA' },
  ],
};

const inputCls = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all';

export default function MembershipSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<MembershipConfig>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const r = ref(db, 'settings/store/membership');
    const unsub = onValue(r, (snap) => {
      if (snap.exists()) {
        const v = snap.val() || {};
        setConfig({
          enabled: v.enabled !== false,
          header_title: v.header_title ?? DEFAULT_CONFIG.header_title,
          header_subtitle: v.header_subtitle ?? DEFAULT_CONFIG.header_subtitle,
          cta_text: v.cta_text ?? '',
          card_image_url: v.card_image_url ?? '',
          benefits: Array.isArray(v.benefits)
            ? v.benefits.map((b: Partial<Benefit>) => ({ icon: b.icon || 'badge-check', title: b.title || '', desc: b.desc || '' }))
            : DEFAULT_CONFIG.benefits,
        });
      }
    });
    return () => unsub();
  }, []);

  const updateBenefit = (i: number, patch: Partial<Benefit>) =>
    setConfig((c) => ({ ...c, benefits: c.benefits.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) }));
  const addBenefit = () =>
    setConfig((c) => ({ ...c, benefits: [...c.benefits, { icon: 'badge-check', title: '', desc: '' }] }));
  const removeBenefit = (i: number) =>
    setConfig((c) => ({ ...c, benefits: c.benefits.filter((_, idx) => idx !== i) }));
  const moveBenefit = (i: number, dir: -1 | 1) =>
    setConfig((c) => {
      const arr = [...c.benefits];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return c;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...c, benefits: arr };
    });

  const handleSave = async () => {
    if (!config.header_title.trim()) { toast.warning('กรุณาระบุหัวข้อสิทธิประโยชน์'); return; }
    const benefits = config.benefits.filter((b) => b.title.trim());
    if (benefits.length === 0) { toast.warning('ต้องมีสิทธิพิเศษอย่างน้อย 1 รายการ'); return; }
    setIsSaving(true);
    setShowSuccess(false);
    try {
      await update(ref(db, 'settings/store/membership'), {
        enabled: config.enabled,
        header_title: config.header_title.trim(),
        header_subtitle: config.header_subtitle.trim(),
        cta_text: config.cta_text.trim(),
        card_image_url: config.card_image_url.trim(),
        benefits: benefits.map((b) => ({ icon: b.icon || 'badge-check', title: b.title.trim(), desc: (b.desc || '').trim() })),
        updated_at: Date.now(),
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto font-sans text-slate-800 animate-in fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-black mb-2 flex items-center gap-3">
          <div className="bg-slate-800 p-2 rounded-xl text-white"><Gift size={24} /></div>
          สมาชิก &amp; สิทธิพิเศษ (Membership)
        </h1>
        <p className="text-slate-500 font-medium ml-12">แก้สิทธิพิเศษที่ลูกค้าเห็นในหน้า "Learn more" ตอน checkout — มีผลทันทีหลังบันทึก ไม่ต้อง deploy</p>
      </div>

      {/* General */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
          <h2 className="text-lg font-black flex items-center gap-2 text-slate-800"><Gift className="text-blue-600" /> ข้อมูลทั่วไป</h2>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))} className="w-5 h-5 rounded accent-blue-600" />
            <span className="text-sm font-bold text-slate-600">{config.enabled ? 'เปิดแสดง "Learn more"' : 'ปิด (ซ่อนปุ่ม Learn more)'}</span>
          </label>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">หัวข้อ (Header)</label>
            <input type="text" value={config.header_title} onChange={(e) => setConfig((c) => ({ ...c, header_title: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">คำอธิบายใต้หัวข้อ (Subtitle)</label>
            <input type="text" value={config.header_subtitle} onChange={(e) => setConfig((c) => ({ ...c, header_subtitle: e.target.value }))} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ปุ่มล่าง (CTA) <span className="text-slate-400 normal-case">— ว่าง=ไม่โชว์</span></label>
              <input type="text" value={config.cta_text} onChange={(e) => setConfig((c) => ({ ...c, cta_text: e.target.value }))} placeholder="เช่น เริ่มขายเลย" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">URL ภาพหัวการ์ด <span className="text-slate-400 normal-case">— ว่าง=ใช้ gradient</span></label>
              <input type="text" value={config.card_image_url} onChange={(e) => setConfig((c) => ({ ...c, card_image_url: e.target.value }))} placeholder="https://..." className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      {/* Benefits */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
          <h2 className="text-lg font-black flex items-center gap-2 text-slate-800"><CheckCircle2 className="text-emerald-600" /> รายการสิทธิพิเศษ</h2>
          <button onClick={addBenefit} className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-600 font-bold text-sm rounded-xl hover:bg-blue-100 transition-colors">
            <Plus size={16} /> เพิ่มสิทธิ์
          </button>
        </div>

        <div className="space-y-4">
          {config.benefits.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">ยังไม่มีสิทธิพิเศษ — กด "เพิ่มสิทธิ์"</p>
          ) : config.benefits.map((b, i) => (
            <div key={i} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
              <div className="flex items-start gap-3">
                <div className="flex flex-col gap-1 pt-1">
                  <button onClick={() => moveBenefit(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="เลื่อนขึ้น"><ArrowUp size={15} /></button>
                  <button onClick={() => moveBenefit(i, 1)} disabled={i === config.benefits.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="เลื่อนลง"><ArrowDown size={15} /></button>
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex gap-2.5">
                    <select value={b.icon} onChange={(e) => updateBenefit(i, { icon: e.target.value })} className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500">
                      {ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input type="text" value={b.title} onChange={(e) => updateBenefit(i, { title: e.target.value })} placeholder="หัวข้อสิทธิ์" className="flex-1 px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-blue-500" />
                  </div>
                  <input type="text" value={b.desc} onChange={(e) => updateBenefit(i, { desc: e.target.value })} placeholder="คำอธิบาย (ไม่บังคับ)" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 outline-none focus:border-blue-500" />
                </div>
                <button onClick={() => removeBenefit(i)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors mt-1" aria-label="ลบ"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 bg-blue-50/50 p-4 rounded-xl border border-blue-100 flex items-start gap-3 text-xs text-blue-800">
          <Info size={16} className="shrink-0 mt-0.5 text-blue-500" />
          <div className="leading-relaxed font-medium">
            ไอคอนเลือกจากชุดที่กำหนด (sync กับฝั่งลูกค้า). v1 เป็น "เนื้อหาที่แสดง" — สิทธิ์ที่เป็นเงินจริง (เรตสมาชิก/โอนไว) ยังไม่ผูกกับการคิดเงินอัตโนมัติ ต้องทำเฟสถัดไป
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button onClick={handleSave} disabled={isSaving} className="bg-[#1D1D1F] hover:bg-blue-600 text-white px-8 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95 disabled:bg-slate-300 flex items-center gap-2">
          {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />} บันทึกสิทธิพิเศษ
        </button>
        {showSuccess && (
          <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-3 rounded-xl animate-in fade-in">
            <CheckCircle2 size={20} /> บันทึกสำเร็จ!
          </div>
        )}
      </div>
    </div>
  );
}
