'use client';

import React, { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
// ⚠️ แก้ไข path db ให้ตรงกับโปรเจกต์ของคุณ
import { db } from '../../api/firebase'; 
import { Settings, Map, Save, Loader2, Info, CheckCircle2, Navigation, AlertTriangle, Bike, XCircle } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';
import { SickwSettingsSection } from './SickwSettingsSection';

const DEFAULT_RIDER_RATES = {
  base_fee: 60,
  per_km: 15,
  min_fee: 100,
  max_fee: 500,
};

export default function GlobalSettings() {
  const toast = useToast();
  // 🌟 1. State สำหรับตัวแปรคำนวณระยะทาง
  const [pricing, setPricing] = useState({
    baseFare: 50,      // ค่าบริการเริ่มต้น (บาท)
    freeRadius: 5,     // ระยะทางส่งฟรี / ครอบคลุมในค่าเริ่มต้น (กม.)
    perKmRate: 10,     // ค่าบริการกิโลเมตรถัดไป (บาท/กม.)
    maxDistance: 50    // ระยะทางให้บริการสูงสุด (กม.)
  });

  // 🏍️ อัตราค่าวิ่งไรเดอร์ — Cloud Function อ่านจาก settings/logistics_rates
  const [riderRates, setRiderRates] = useState(DEFAULT_RIDER_RATES);
  const [isSavingRider, setIsSavingRider] = useState(false);
  const [showRiderSuccess, setShowRiderSuccess] = useState(false);

  // ค่าชดเชยไรเดอร์เวลาลูกค้ายกเลิกงานกลางทาง
  // — Cloud Function reviewAmendment อ่านจาก settings/rider_compensation
  // ก่อนหน้านี้ค่านี้ hard-code 100 ที่ Cloud Function — ย้ายมาให้ admin
  // แก้ผ่าน UI ได้ + ลบ fallback ทิ้งฝั่ง functions เพื่อบังคับให้ตั้งค่าก่อน
  const [riderComp, setRiderComp] = useState({ customer_cancel_time_loss: 0 });
  const [isSavingComp, setIsSavingComp] = useState(false);
  const [showCompSuccess, setShowCompSuccess] = useState(false);
  const [compLoaded, setCompLoaded] = useState(false);

  // Auto-flag thresholds — Cloud Function autoFlagRiders runs daily and
  // marks /riders/{id}/flags/auto_review for riders whose stats exceed
  // these. Stored at settings/rider_flag_thresholds. Hard-coded fallback
  // lives in the function so an empty settings node still flags obvious
  // bad actors; this UI is for tuning the bar, not bootstrapping it.
  const [flagThresholds, setFlagThresholds] = useState({
    customer_cancel_rate: 0.30,
    rider_cancel_rate: 0.30,
    acceptance_rate_min: 0.20,
    min_sample_size: 10,
  });
  const [isSavingFlag, setIsSavingFlag] = useState(false);
  const [showFlagSuccess, setShowFlagSuccess] = useState(false);

  const [testDistance, setTestDistance] = useState<number>(12); // สำหรับ Slider จำลองระยะทาง
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // ดึงข้อมูลจาก Firebase
  useEffect(() => {
    const settingsRef = ref(db, 'settings/store/delivery_pricing');
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      if (snapshot.exists()) {
        setPricing(snapshot.val());
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const ratesRef = ref(db, 'settings/logistics_rates');
    const unsubscribe = onValue(ratesRef, (snapshot) => {
      if (snapshot.exists()) {
        const v = snapshot.val() || {};
        setRiderRates({
          base_fee: Number(v.base_fee ?? DEFAULT_RIDER_RATES.base_fee),
          per_km: Number(v.per_km ?? DEFAULT_RIDER_RATES.per_km),
          min_fee: Number(v.min_fee ?? DEFAULT_RIDER_RATES.min_fee),
          max_fee: Number(v.max_fee ?? DEFAULT_RIDER_RATES.max_fee),
        });
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSaveRiderRates = async () => {
    if (riderRates.min_fee > riderRates.max_fee) {
      toast.warning('min_fee ต้องไม่มากกว่า max_fee');
      return;
    }
    setIsSavingRider(true);
    setShowRiderSuccess(false);
    try {
      await update(ref(db, 'settings/logistics_rates'), {
        ...riderRates,
        updated_at: Date.now(),
      });
      setShowRiderSuccess(true);
      setTimeout(() => setShowRiderSuccess(false), 3000);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการบันทึกอัตราค่าวิ่ง');
    } finally {
      setIsSavingRider(false);
    }
  };

  useEffect(() => {
    const compRef = ref(db, 'settings/rider_compensation');
    const unsubscribe = onValue(compRef, (snapshot) => {
      if (snapshot.exists()) {
        const v = snapshot.val() || {};
        setRiderComp({
          customer_cancel_time_loss: Number(v.customer_cancel_time_loss ?? 0),
        });
      }
      setCompLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const flagRef = ref(db, 'settings/rider_flag_thresholds');
    const unsubscribe = onValue(flagRef, (snap) => {
      if (snap.exists()) {
        const v = snap.val() || {};
        setFlagThresholds({
          customer_cancel_rate: Number(v.customer_cancel_rate ?? 0.30),
          rider_cancel_rate: Number(v.rider_cancel_rate ?? 0.30),
          acceptance_rate_min: Number(v.acceptance_rate_min ?? 0.20),
          min_sample_size: Number(v.min_sample_size ?? 10),
        });
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSaveFlagThresholds = async () => {
    if (flagThresholds.customer_cancel_rate < 0 || flagThresholds.customer_cancel_rate > 1
      || flagThresholds.rider_cancel_rate < 0 || flagThresholds.rider_cancel_rate > 1
      || flagThresholds.acceptance_rate_min < 0 || flagThresholds.acceptance_rate_min > 1) {
      toast.warning('อัตราต้องอยู่ระหว่าง 0–1 (เช่น 0.30 = 30%)');
      return;
    }
    if (flagThresholds.min_sample_size < 1) {
      toast.warning('Sample size ต้องอย่างน้อย 1');
      return;
    }
    setIsSavingFlag(true);
    setShowFlagSuccess(false);
    try {
      await update(ref(db, 'settings/rider_flag_thresholds'), {
        ...flagThresholds,
        updated_at: Date.now(),
      });
      setShowFlagSuccess(true);
      setTimeout(() => setShowFlagSuccess(false), 3000);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการบันทึก threshold');
    } finally {
      setIsSavingFlag(false);
    }
  };

  const handleSaveRiderCompensation = async () => {
    if (!Number.isFinite(riderComp.customer_cancel_time_loss) || riderComp.customer_cancel_time_loss < 0) {
      toast.warning('ค่าชดเชยต้องเป็นตัวเลขไม่ติดลบ');
      return;
    }
    setIsSavingComp(true);
    setShowCompSuccess(false);
    try {
      await update(ref(db, 'settings/rider_compensation'), {
        customer_cancel_time_loss: Math.round(riderComp.customer_cancel_time_loss),
        updated_at: Date.now(),
      });
      setShowCompSuccess(true);
      setTimeout(() => setShowCompSuccess(false), 3000);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการบันทึกค่าชดเชย');
    } finally {
      setIsSavingComp(false);
    }
  };

  const handleRiderRateChange = (field: keyof typeof riderRates, value: string) => {
    setRiderRates(prev => ({ ...prev, [field]: Number(value) }));
  };

  const previewRiderFee = (km: number) => {
    const raw = riderRates.base_fee + riderRates.per_km * km;
    return Math.round(Math.max(riderRates.min_fee, Math.min(riderRates.max_fee, raw)));
  };

  // บันทึกข้อมูลลง Firebase
  const handleSaveSettings = async () => {
    setIsSaving(true);
    setShowSuccess(false);
    try {
      await update(ref(db, 'settings/store/delivery_pricing'), {
        ...pricing,
        updated_at: Date.now()
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (field: keyof typeof pricing, value: string) => {
    setPricing(prev => ({ ...prev, [field]: Number(value) }));
  };

  // 🌟 2. สมการคำนวณค่าส่งสไตล์ Logistics App
  const calculateDeliveryFee = (km: number) => {
    if (km > pricing.maxDistance) return -1; // -1 คืออยู่นอกพื้นที่ให้บริการ
    const chargeableKm = Math.max(0, km - pricing.freeRadius); // คิดเงินเฉพาะกิโลเมตรที่เกินระยะฟรี
    return pricing.baseFare + (chargeableKm * pricing.perKmRate);
  };

  const currentFee = calculateDeliveryFee(testDistance);

  return (
    <div className="p-6 max-w-5xl mx-auto font-sans text-slate-800 animate-in fade-in">
      
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black mb-2 flex items-center gap-3">
          <div className="bg-slate-800 p-2 rounded-xl text-white">
            <Settings size={24} />
          </div>
          ตั้งค่าระบบส่วนกลาง (Global Settings)
        </h1>
        <p className="text-slate-500 font-medium ml-12">กำหนดสมการคำนวณค่าบริการเข้ารับเครื่องตามระยะทาง (Distance-Based Pricing)</p>
      </div>

      {/* 🏍️ อัตราค่าวิ่งไรเดอร์ (Rider Fee Rates) */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <h2 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
          <Bike className="text-emerald-600" /> อัตราค่าวิ่งไรเดอร์ (Rider Fee)
        </h2>
        <p className="text-xs font-bold text-slate-500 mt-3 mb-5">
          ใช้คำนวณ <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">jobs/&#123;id&#125;/rider_fee</code> ตอนสถานะงานเปลี่ยนเป็น <strong>Pending QC</strong> โดย Cloud Function — บันทึกเป็น <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">settings/logistics_rates</code>
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Base Fee</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
              <input type="number" value={riderRates.base_fee} onChange={(e) => handleRiderRateChange('base_fee', e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Per KM</label>
            <div className="relative">
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">บาท/กม.</span>
              <input type="number" value={riderRates.per_km} onChange={(e) => handleRiderRateChange('per_km', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Min Fee</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
              <input type="number" value={riderRates.min_fee} onChange={(e) => handleRiderRateChange('min_fee', e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Max Fee</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
              <input type="number" value={riderRates.max_fee} onChange={(e) => handleRiderRateChange('max_fee', e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all" />
            </div>
          </div>
        </div>

        <div className="mt-5 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex items-start gap-3 text-xs text-emerald-800">
          <Info size={16} className="shrink-0 mt-0.5 text-emerald-500" />
          <div className="leading-relaxed font-medium">
            <strong>สูตร:</strong> clamp(base_fee + per_km × distance_km, min_fee, max_fee)
            <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
              <div className="bg-white/80 rounded-lg p-2 text-center">
                <div className="text-slate-500">5 กม.</div>
                <div className="font-black text-emerald-700">฿{previewRiderFee(5).toLocaleString()}</div>
              </div>
              <div className="bg-white/80 rounded-lg p-2 text-center">
                <div className="text-slate-500">15 กม.</div>
                <div className="font-black text-emerald-700">฿{previewRiderFee(15).toLocaleString()}</div>
              </div>
              <div className="bg-white/80 rounded-lg p-2 text-center">
                <div className="text-slate-500">30 กม.</div>
                <div className="font-black text-emerald-700">฿{previewRiderFee(30).toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-5">
          <button onClick={handleSaveRiderRates} disabled={isSavingRider} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-black transition-all shadow-lg active:scale-95 disabled:bg-slate-300 flex items-center gap-2">
            {isSavingRider ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} บันทึกอัตราค่าวิ่ง
          </button>
          {showRiderSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-2.5 rounded-xl animate-in fade-in text-sm">
              <CheckCircle2 size={18} /> อัปเดตอัตราค่าวิ่งสำเร็จ!
            </div>
          )}
        </div>
      </div>

      {/* ค่าชดเชยไรเดอร์เวลาลูกค้ายกเลิก (Customer Cancel Compensation) */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <h2 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
          <XCircle className="text-rose-600" /> ค่าชดเชยไรเดอร์เมื่อลูกค้ายกเลิก
        </h2>
        <p className="text-xs font-bold text-slate-500 mt-3 mb-5">
          จ่ายให้ไรเดอร์เมื่อลูกค้ากดยกเลิกระหว่างที่ไรเดอร์ออกเดินทางแล้ว
          (status: <code className="bg-slate-100 px-1 rounded text-[10px]">Heading to Customer</code> /
          <code className="bg-slate-100 px-1 rounded text-[10px]">Rider En Route</code> /
          <code className="bg-slate-100 px-1 rounded text-[10px]">Arrived</code> /
          <code className="bg-slate-100 px-1 rounded text-[10px]">Rider Arrived</code>) — Cloud Function
          <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">reviewAmendment</code> อ่านจาก
          <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">settings/rider_compensation</code>
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
              ค่าเสียเวลา (Customer Cancel Time Loss)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
              <input
                type="number"
                min={0}
                value={riderComp.customer_cancel_time_loss}
                onChange={(e) => setRiderComp(prev => ({ ...prev, customer_cancel_time_loss: Number(e.target.value) }))}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 outline-none transition-all"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1 font-bold">
              บันทึกลง <code>jobs/&#123;id&#125;/rider_fee</code> + <code>rider_fee_breakdown.type = "time_loss_customer_cancel"</code>
            </p>
          </div>
        </div>

        {compLoaded && riderComp.customer_cancel_time_loss === 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <span className="font-bold leading-relaxed">
              ค่ายังเป็น 0 หรือยังไม่เคยตั้ง — Cloud Function จะ throw error เมื่อมีคำขอยกเลิกของลูกค้าเข้ามา
              เพื่อกันการจ่ายโดยไม่ตั้งใจ. กำหนดค่าก่อนเปิดให้ลูกค้ายกเลิกผ่านระบบ.
            </span>
          </div>
        )}

        <div className="flex items-center gap-4 mt-5">
          <button
            onClick={handleSaveRiderCompensation}
            disabled={isSavingComp}
            className="bg-rose-600 hover:bg-rose-700 text-white px-6 py-3 rounded-xl font-black transition-all shadow-lg active:scale-95 disabled:bg-slate-300 flex items-center gap-2"
          >
            {isSavingComp ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} บันทึกค่าชดเชย
          </button>
          {showCompSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-2.5 rounded-xl animate-in fade-in text-sm">
              <CheckCircle2 size={18} /> อัปเดตค่าชดเชยสำเร็จ!
            </div>
          )}
        </div>
      </div>

      {/* Auto-flag thresholds — drives the daily Cloud Function */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <h2 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
          <AlertTriangle className="text-amber-600" /> เกณฑ์ Flag ไรเดอร์อัตโนมัติ (Auto-flag Thresholds)
        </h2>
        <p className="text-xs font-bold text-slate-500 mt-3 mb-5">
          Cloud Function <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">autoFlagRiders</code> รันทุกวัน 04:00 น. — ไรเดอร์ที่มีตัวเลขเกินเกณฑ์ใดๆ ใน 30 วันล่าสุด จะถูกตั้ง flag <code className="bg-slate-100 px-1 rounded text-[11px]">riders/&#123;id&#125;/flags/auto_review</code> + ส่ง push ให้แอดมินตรวจสอบ. ระบบไม่ auto-suspend
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ลูกค้ายกเลิก ≥</label>
            <div className="relative">
              <input type="number" step="0.01" min="0" max="1"
                value={flagThresholds.customer_cancel_rate}
                onChange={(e) => setFlagThresholds(p => ({ ...p, customer_cancel_rate: Number(e.target.value) }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">{(flagThresholds.customer_cancel_rate * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ไรเดอร์ยกเลิก ≥</label>
            <div className="relative">
              <input type="number" step="0.01" min="0" max="1"
                value={flagThresholds.rider_cancel_rate}
                onChange={(e) => setFlagThresholds(p => ({ ...p, rider_cancel_rate: Number(e.target.value) }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">{(flagThresholds.rider_cancel_rate * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">รับงาน &lt;</label>
            <div className="relative">
              <input type="number" step="0.01" min="0" max="1"
                value={flagThresholds.acceptance_rate_min}
                onChange={(e) => setFlagThresholds(p => ({ ...p, acceptance_rate_min: Number(e.target.value) }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">{(flagThresholds.acceptance_rate_min * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Min sample size</label>
            <div className="relative">
              <input type="number" min="1"
                value={flagThresholds.min_sample_size}
                onChange={(e) => setFlagThresholds(p => ({ ...p, min_sample_size: Number(e.target.value) }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">งาน</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 font-bold">ไรเดอร์ที่มี sample &lt; ค่านี้ ไม่ถูก flag</p>
          </div>
        </div>

        <div className="mt-5 bg-amber-50/50 p-4 rounded-xl border border-amber-100 flex items-start gap-3 text-xs text-amber-800">
          <Info size={16} className="shrink-0 mt-0.5 text-amber-500" />
          <div className="leading-relaxed font-medium">
            <strong>หมายเหตุ:</strong> ค่าเป็นเศษส่วน (0–1). ตัวอย่าง 0.30 = 30%. ถ้าตั้งสูงเกินไป → flag ไม่ค่อยขึ้น; ถ้าต่ำเกินไป → flag ขึ้นบ่อยจนเป็น noise
          </div>
        </div>

        <div className="flex items-center gap-4 mt-5">
          <button onClick={handleSaveFlagThresholds} disabled={isSavingFlag} className="bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-xl font-black transition-all shadow-lg active:scale-95 disabled:bg-slate-300 flex items-center gap-2">
            {isSavingFlag ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} บันทึกเกณฑ์
          </button>
          {showFlagSuccess && (
            <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-2.5 rounded-xl animate-in fade-in text-sm">
              <CheckCircle2 size={18} /> อัปเดตเกณฑ์สำเร็จ!
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* 🎛️ ฝั่งซ้าย: ฟอร์มตั้งค่าสมการ */}
        <div className="w-full lg:w-7/12 space-y-6">
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <h2 className="text-lg font-black mb-6 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
              <Map className="text-[#144EE3]" /> พารามิเตอร์คำนวณค่าบริการ
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Base Fare */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ค่าเริ่มต้น (Base Fare)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">฿</span>
                  <input type="number" value={pricing.baseFare} onChange={(e) => handleInputChange('baseFare', e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-[#144EE3] focus:ring-2 focus:ring-[#144EE3]/20 outline-none transition-all" />
                </div>
              </div>

              {/* Free Radius */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ระยะทางเหมาจ่าย (Free Radius)</label>
                <div className="relative">
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">กม.</span>
                  <input type="number" value={pricing.freeRadius} onChange={(e) => handleInputChange('freeRadius', e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-[#144EE3] focus:ring-2 focus:ring-[#144EE3]/20 outline-none transition-all" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-bold">*ระยะทางที่จะไม่คิดเงินเพิ่ม (คิดแค่ Base Fare)</p>
              </div>

              {/* Per KM Rate */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ค่าบริการส่วนเกิน (Per KM)</label>
                <div className="relative">
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">บาท / กม.</span>
                  <input type="number" value={pricing.perKmRate} onChange={(e) => handleInputChange('perKmRate', e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-[#144EE3] focus:ring-2 focus:ring-[#144EE3]/20 outline-none transition-all" />
                </div>
              </div>

              {/* Max Distance */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">ระยะทางสูงสุดที่รับงาน (Max)</label>
                <div className="relative">
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">กม.</span>
                  <input type="number" value={pricing.maxDistance} onChange={(e) => handleInputChange('maxDistance', e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black focus:border-[#144EE3] focus:ring-2 focus:ring-[#144EE3]/20 outline-none transition-all" />
                </div>
              </div>
            </div>

            <div className="mt-6 bg-blue-50/50 p-4 rounded-xl border border-blue-100 flex items-start gap-3 text-sm text-blue-800">
              <Info size={18} className="shrink-0 mt-0.5 text-blue-500" />
              <p className="leading-relaxed font-medium">
                <strong>สูตรการคำนวณ:</strong> ค่าเริ่มต้น + ((ระยะทางจริง - ระยะเหมาจ่าย) × ค่าบริการส่วนเกิน)
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button onClick={handleSaveSettings} disabled={isSaving} className="bg-[#1D1D1F] hover:bg-[#144EE3] text-white px-8 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95 disabled:bg-slate-300 flex items-center gap-2">
              {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />} บันทึกสมการ
            </button>
            {showSuccess && (
              <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-4 py-3 rounded-xl animate-in fade-in">
                <CheckCircle2 size={20} /> อัปเดตสมการสำเร็จ!
              </div>
            )}
          </div>
        </div>

        {/* 📱 ฝั่งขวา: Live Preview จำลองหน้าจอลูกค้า */}
        <div className="w-full lg:w-5/12">
          <div className="bg-slate-900 rounded-[2rem] p-8 shadow-xl text-white relative overflow-hidden h-full">
            <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none"><Navigation size={150} /></div>
            
            <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-6 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span> Live Preview
            </p>

            <div className="mb-8 relative z-10">
              <label className="block text-sm font-bold text-slate-300 mb-4 flex justify-between">
                <span>จำลองระยะทาง (กิโลเมตร)</span>
                <span className="text-xl font-black text-white">{testDistance} กม.</span>
              </label>
              <input 
                type="range" min="1" max={pricing.maxDistance + 10} step="1" 
                value={testDistance} onChange={(e) => setTestDistance(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#D4FF00]"
              />
            </div>

            <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/10 relative z-10 space-y-4">
              <h3 className="font-bold text-slate-300 border-b border-white/10 pb-3">สรุปยอดประเมิน</h3>
              
              <div className="flex justify-between items-center text-sm font-medium">
                <span className="text-slate-400">iPhone 17 Pro Max</span>
                <span>฿43,000</span>
              </div>
              
              {currentFee === -1 ? (
                <div className="bg-red-500/20 border border-red-500/50 p-3 rounded-xl flex items-start gap-2 text-red-200 text-xs font-bold mt-4">
                  <AlertTriangle size={16} className="shrink-0 text-red-400" />
                  <p>ระยะทาง {testDistance} กม. อยู่นอกพื้นที่ให้บริการสูงสุดที่กำหนดไว้ ({pricing.maxDistance} กม.)</p>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className="text-slate-400 flex flex-col">
                      ค่าบริการเข้ารับเครื่อง
                      <span className="text-[10px] text-slate-500">ระยะทาง {testDistance} กม.</span>
                    </span>
                    <span className="text-red-400">- ฿{currentFee.toLocaleString()}</span>
                  </div>

                  {/* จำลองกรณีใช้คูปองฟรีค่าส่ง */}
                  <div className="flex justify-between items-center text-sm font-medium opacity-60 line-through decoration-emerald-400">
                    <span className="text-emerald-400">คูปองฟรีค่าบริการเข้ารับ</span>
                    <span className="text-emerald-400">+ ฿{currentFee.toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>

        <SickwSettingsSection />

      </div>
    </div>
  );
}