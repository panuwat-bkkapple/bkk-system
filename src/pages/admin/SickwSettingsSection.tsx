// Section ของหน้า GlobalSettings ที่ตั้งค่า Sickw:
//   - default service bundle (ไรเดอร์/แอดมินกดทีเดียวใช้ตัวนี้)
//   - แสดง credit คงเหลือ
//   - ลิงก์ไปจัดการ key ที่ sickw.com

import { useEffect, useState } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { Save, Loader2, CheckCircle2, ExternalLink, ShieldCheck, History } from 'lucide-react';
import { db } from '../../api/firebase';
import { useToast } from '../../components/ui/ToastProvider';
import { SickwServicePicker } from '../../components/sickw/SickwServicePicker';
import { SickwBalanceWidget } from '../../components/sickw/SickwBalanceWidget';

export function SickwSettingsSection() {
  const toast = useToast();
  const [defaultBundle, setDefaultBundle] = useState<string[]>([]);
  // service สำหรับ "เช็ครุ่นหน้าเว็บลูกค้า" (lookupDeviceForQuote) — เก็บเป็น string
  // เดี่ยวใน settings/sickw/quote_lookup_service แต่ใช้ array กับ picker (singleOnly)
  const [quoteService, setQuoteService] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(db, 'settings/sickw/default_bundle'), (snap) => {
      const v = snap.val();
      if (Array.isArray(v)) setDefaultBundle(v.map(String));
    });
    const unsubQuote = onValue(ref(db, 'settings/sickw/quote_lookup_service'), (snap) => {
      const v = snap.val();
      setQuoteService(v ? [String(v)] : []);
    });
    return () => { unsub(); unsubQuote(); };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setShowSuccess(false);
    try {
      await update(ref(db, 'settings/sickw'), {
        default_bundle: defaultBundle,
        quote_lookup_service: quoteService[0] || null,
        updated_at: Date.now(),
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (e: any) {
      toast.error('บันทึก Sickw settings ไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-700/50">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
          <ShieldCheck size={20} className="text-blue-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-black text-white uppercase tracking-tight">Sickw IMEI Check</h2>
          <p className="text-xs text-slate-400">
            ตั้ง default bundle ของ service ที่ระบบจะใช้ตรวจ — ไรเดอร์/แอดมินกดปุ่ม "ใช้ default" ทีเดียวเรียกครบ
          </p>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <a
            href="/sickw-usage"
            className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 font-bold"
          >
            <History size={11} /> ดู Audit Log
          </a>
          <a
            href="https://sickw.com/?page=api"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            จัดการ key <ExternalLink size={11} />
          </a>
        </div>
      </div>

      <div className="mb-5">
        <SickwBalanceWidget />
      </div>

      <div className="mb-5 bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
        <SickwServicePicker
          value={defaultBundle}
          onChange={setDefaultBundle}
        />
        <p className="text-[11px] text-slate-400 mt-2">
          แนะนำ: เลือก 2-3 service ที่ครอบคลุม "Carrier/Model info" (รุ่น/ความจุ/ประเทศ) + "FMI/iCloud" + "Blacklist"
          เพื่อให้ Gate กันเครื่องมีปัญหาได้ครบ
        </p>
      </div>

      {/* Service สำหรับเช็ครุ่นหน้าเว็บลูกค้า (lookupDeviceForQuote) */}
      <div className="mb-5 bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
        <p className="text-xs font-bold text-slate-300 mb-2">Service สำหรับเช็ครุ่นหน้าเว็บลูกค้า</p>
        <SickwServicePicker
          value={quoteService}
          onChange={setQuoteService}
          singleOnly
        />
        <p className="text-[11px] text-slate-400 mt-2">
          ใช้ตอนลูกค้ากรอก Serial/IMEI ที่หน้า /sell — เลือกตัวที่คืน "รุ่น + ความจุ" และ
          <span className="text-emerald-400 font-bold"> ราคาถูกที่สุด</span> (เช่น iPhone Model Color &amp; Capacity)
          เพื่อคุมต้นทุน. ถ้าไม่ตั้ง ระบบจะ fallback ไปใช้ตัวแรกของ Default Bundle
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? <><Loader2 size={16} className="animate-spin" /> กำลังบันทึก...</>
          : showSuccess ? <><CheckCircle2 size={16} /> บันทึกเรียบร้อย</>
          : <><Save size={16} /> บันทึกการตั้งค่า</>}
      </button>
    </div>
  );
}
