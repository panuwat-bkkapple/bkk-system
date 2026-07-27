'use client';

import { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { HandCoins, Save, Loader2, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';
import { DEFAULT_OFFER_MAX_PCT } from '../../utils/customerOffer';

// Make Offer (ลูกค้าเสนอราคาเอง) — master config เก็บที่ settings/customer_offer
// อ่านโดย validateAndCreateOrder (bkk-frontend-next functions) เท่านั้น:
// - enabled: master gate ทั้งฟีเจอร์ (ปิด = ทุกรุ่นปิด แม้ toggle รายรุ่นเปิดอยู่)
// - auto_accept_pct: เพดานรับอัตโนมัติ (% เหนือราคาประเมิน) — **ค่าลับ** ต้องอยู่
//   ที่ settings (auth-only read) เท่านั้น ห้ามย้ายไปไว้บน /models เพราะ
//   /models.json อ่านได้สาธารณะ ลูกค้าจะรู้เพดานแล้วเสนอชนเพดานทุกครั้ง
// การเปิดรายรุ่น + เพดานเสนอ (offerMaxPct — ค่าที่ลูกค้าเห็น) ตั้งที่
// Catalog → แก้ไขรุ่น (ModelEditorPage)

interface CustomerOfferConfig {
  enabled: boolean;
  auto_accept_pct: number; // 0 = ปิด auto-accept
}

const DEFAULT_CONFIG: CustomerOfferConfig = { enabled: false, auto_accept_pct: 0 };

const inputCls = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all';

export default function CustomerOfferSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<CustomerOfferConfig>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, 'settings/customer_offer'), (snap) => {
      const v = snap.val() || {};
      setConfig({
        enabled: v.enabled === true,
        auto_accept_pct: Number(v.auto_accept_pct) > 0 ? Number(v.auto_accept_pct) : 0,
      });
    });
    return () => unsub();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await update(ref(db, 'settings/customer_offer'), {
        enabled: config.enabled === true,
        auto_accept_pct: Number(config.auto_accept_pct) > 0 ? Math.min(Number(config.auto_accept_pct), 100) : 0,
        updated_at: Date.now(),
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
      toast.success('บันทึกการตั้งค่า Make Offer แล้ว');
    } catch {
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center"><HandCoins size={22} /></div>
        <div>
          <h1 className="text-xl font-black text-slate-800">เสนอราคาเอง (Make Offer)</h1>
          <p className="text-xs font-bold text-slate-400">ลูกค้าเสนอราคาที่ต้องการจากหน้าประเมิน — เพิ่มโอกาสปิดดีลจากลูกค้าที่รู้สึกว่าราคาประเมินต่ำไป</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
        <label className="flex items-center justify-between gap-4 p-5 cursor-pointer">
          <div>
            <p className="text-sm font-black text-slate-800">เปิดใช้งานฟีเจอร์ (Master Switch)</p>
            <p className="text-[11px] font-bold text-slate-400 mt-0.5">
              ปิด = ปิดทั้งระบบทันที แม้รุ่นจะเปิด toggle ไว้ · การเปิดรายรุ่นตั้งที่ Catalog → แก้ไขรุ่น → เสนอราคาเอง
            </p>
          </div>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
            className="w-5 h-5 rounded text-amber-600 focus:ring-amber-500 shrink-0"
          />
        </label>

        <div className="p-5">
          <p className="text-sm font-black text-slate-800 flex items-center gap-1.5">
            เพดานรับอัตโนมัติ Auto-Accept (%) <ShieldAlert size={14} className="text-amber-500" />
          </p>
          <p className="text-[11px] font-bold text-slate-400 mt-0.5 mb-3">
            ข้อเสนอที่ไม่เกินราคาประเมิน + % นี้ ระบบตอบรับทันทีตอน checkout (ลูกค้าไม่ต้องรอ = ปิดดีลไว) · 0 = ปิด ให้ทุกข้อเสนอรอ CEO/MANAGER ตัดสิน
          </p>
          <input
            type="number"
            min={0}
            max={100}
            value={config.auto_accept_pct || ''}
            placeholder="0 = ปิด Auto-Accept"
            onChange={(e) => setConfig((c) => ({ ...c, auto_accept_pct: Number(e.target.value) || 0 }))}
            className={inputCls}
          />
          <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-100 flex gap-2">
            <Info size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
              ค่านี้เป็น<span className="underline">ความลับ</span> — เก็บที่ settings ซึ่งลูกค้าอ่านไม่ได้ ห้ามนำไปแสดงบนเว็บลูกค้าหรือย้ายไปเก็บบน /models (สาธารณะ) เด็ดขาด มิฉะนั้นลูกค้าจะเสนอชนเพดานทุกครั้ง · เพดานที่ลูกค้า &ldquo;เห็น&rdquo; (กรอบเสนอสูงสุด, default {DEFAULT_OFFER_MAX_PCT}%) ตั้งแยกรายรุ่นที่หน้าแก้ไขรุ่น
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="mt-5 flex items-center gap-2 px-6 py-3.5 bg-slate-900 text-white rounded-xl font-black text-sm hover:bg-slate-800 disabled:opacity-50 transition-all"
      >
        {isSaving ? <Loader2 size={16} className="animate-spin" /> : showSuccess ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Save size={16} />}
        บันทึกการตั้งค่า
      </button>
    </div>
  );
}
