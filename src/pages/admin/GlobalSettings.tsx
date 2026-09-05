'use client';

import React, { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
// ⚠️ แก้ไข path db ให้ตรงกับโปรเจกต์ของคุณ
import { db } from '../../api/firebase'; 
import { Settings, Map, Save, Loader2, Info, CheckCircle2, Navigation, AlertTriangle, Bike, XCircle, Timer } from 'lucide-react';
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
  //
  // แยกอัตราตามยานพาหนะ เพราะต้นทุนจริงคนละราคา (น้ำมัน ค่าจอด) — ความต่างของ
  // ยานพาหนะต้องอยู่ที่ "อัตรา" ที่แอดมินตั้งเอง ไม่ใช่ที่วิธีวัดระยะทาง
  // มิฉะนั้นไรเดอร์ที่ตั้งตัวเองเป็นรถยนต์จะได้เงินมากกว่าสำหรับงานเดียวกัน
  // (เส้นทางรถยนต์ระยะทางไกลกว่าเพราะขึ้นทางด่วน)
  const [ratesVehicle, setRatesVehicle] = useState<'motorcycle' | 'car'>('motorcycle');
  const [vehicleRates, setVehicleRates] = useState({
    motorcycle: { ...DEFAULT_RIDER_RATES },
    car: { ...DEFAULT_RIDER_RATES },
  });
  // โหมดวัดเส้นทางที่ใช้ "คิดเงิน" — ค่าเดียวทั้งระบบ ไม่แยกตามคนขับ เพราะค่า
  // บริการถูกโชว์ให้ลูกค้าก่อนที่จะรู้ว่าใครรับงาน
  const [travelMode, setTravelMode] = useState<'DRIVE' | 'TWO_WHEELER'>('DRIVE');
  const riderRates = vehicleRates[ratesVehicle];
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

  // ⏱️ ราคาประเมิน / การยืนราคา — settings/quote
  //
  // ราคารับซื้อขยับได้ทุกวัน ระบบจึงไม่เก็บราคาไว้ฝั่งลูกค้าเลย (ตะกร้าเก็บแค่
  // รหัสประเมิน ราคาคำนวณสดทุกครั้งที่เปิด) ค่าสองตัวนี้คือกรอบเวลาสองช่วงที่
  // เหลืออยู่: ระหว่างกรอกฟอร์ม และหลังลงทะเบียนแล้ว
  const [quote, setQuote] = useState({
    checkout_ttl_min: 15,
    lock_days: 7,
    assessment_gc_days: 30,
    // ให้ลูกค้าพิมพ์รหัสประเมินกู้ตะกร้าข้ามเครื่อง — ปิดเป็นค่าเริ่มต้น
    allow_code_recovery: false,
    // ปุ่ม "เพิ่มเครื่องแบบเดียวกัน" บน /cart + /checkout ของเว็บลูกค้า — remote flag
    // ปิดเป็นค่าเริ่มต้น (server ของเว็บลูกค้าตรวจธงนี้เองใน duplicateAssessment)
    allow_duplicate_line: false,
  });
  const [isSavingQuote, setIsSavingQuote] = useState(false);
  const [showQuoteSuccess, setShowQuoteSuccess] = useState(false);

  // สวิตช์ซ่อนราคาบนหน้า /sell เว็บลูกค้า ก่อนลูกค้าทำแบบประเมิน — settings/sell/hide_prices_until_quote
  // เขียนทันทีตอนกดสวิตช์ ไม่ผูกกับปุ่ม "บันทึกการตั้งค่าราคา" (คนละ node กับ settings/quote)
  const [hidePreQuotePrices, setHidePreQuotePrices] = useState(false);
  const [savingHidePrices, setSavingHidePrices] = useState(false);

  useEffect(() => {
    const r = ref(db, 'settings/sell/hide_prices_until_quote');
    const unsubscribe = onValue(r, (snapshot) => {
      setHidePreQuotePrices(snapshot.val() === true);
    });
    return () => unsubscribe();
  }, []);

  const handleToggleHidePrices = async (next: boolean) => {
    setSavingHidePrices(true);
    try {
      await update(ref(db, 'settings/sell'), { hide_prices_until_quote: next, updated_at: Date.now() });
      toast.success(next ? 'ซ่อนราคาก่อนประเมินบนหน้า /sell แล้ว' : 'กลับมาแสดงราคาบนหน้า /sell แล้ว');
    } catch {
      toast.error('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setSavingHidePrices(false);
    }
  };

  useEffect(() => {
    const quoteRef = ref(db, 'settings/quote');
    const unsubscribe = onValue(quoteRef, (snapshot) => {
      if (snapshot.exists()) {
        const v = snapshot.val() || {};
        setQuote((prev) => ({
          checkout_ttl_min: Number(v.checkout_ttl_min) > 0 ? Number(v.checkout_ttl_min) : prev.checkout_ttl_min,
          lock_days: Number(v.lock_days) > 0 ? Number(v.lock_days) : prev.lock_days,
          assessment_gc_days: Number(v.assessment_gc_days) > 0 ? Number(v.assessment_gc_days) : prev.assessment_gc_days,
          allow_code_recovery: v.allow_code_recovery === true,
          allow_duplicate_line: v.allow_duplicate_line === true,
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSaveQuote = async () => {
    if (quote.checkout_ttl_min < 3) {
      toast.warning('เวลากรอกฟอร์มสั้นเกินไป — ลูกค้ากรอกที่อยู่กับเลขบัญชีไม่ทัน');
      return;
    }
    if (quote.assessment_gc_days < quote.lock_days) {
      // รหัสประเมินถูกลบก่อนที่ราคาที่ยืนไว้จะหมดอายุ = อ้างอิงย้อนหลังไม่ได้
      toast.warning('อายุรหัสประเมินต้องไม่น้อยกว่าจำนวนวันที่ยืนราคา');
      return;
    }
    setIsSavingQuote(true);
    setShowQuoteSuccess(false);
    try {
      await update(ref(db, 'settings/quote'), { ...quote, updated_at: Date.now() });
      setShowQuoteSuccess(true);
      setTimeout(() => setShowQuoteSuccess(false), 3000);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการบันทึกการตั้งค่าราคา');
    } finally {
      setIsSavingQuote(false);
    }
  };

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
        // fallback ทีละฟิลด์: by_vehicle → ฟิลด์แบนเดิม → default
        const read = (vehicle: 'motorcycle' | 'car') => {
          const per = (v.by_vehicle && v.by_vehicle[vehicle]) || {};
          const pick = (field: keyof typeof DEFAULT_RIDER_RATES) =>
            Number(per[field] ?? v[field] ?? DEFAULT_RIDER_RATES[field]);
          return {
            base_fee: pick('base_fee'),
            per_km: pick('per_km'),
            min_fee: pick('min_fee'),
            max_fee: pick('max_fee'),
          };
        };
        setVehicleRates({ motorcycle: read('motorcycle'), car: read('car') });
        setTravelMode(String(v.travel_mode || '').toUpperCase() === 'TWO_WHEELER' ? 'TWO_WHEELER' : 'DRIVE');
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSaveRiderRates = async () => {
    const offender = (['motorcycle', 'car'] as const).find(
      (v) => vehicleRates[v].min_fee > vehicleRates[v].max_fee
    );
    if (offender) {
      // ตรวจทั้งสองยานพาหนะ ไม่ใช่แค่แท็บที่เปิดอยู่ — ค่าที่ผิดในแท็บที่ปิดไว้
      // จะถูกบันทึกไปด้วยถ้าไม่เช็ค
      toast.warning(
        `min_fee ต้องไม่มากกว่า max_fee (${offender === 'car' ? 'รถยนต์' : 'มอเตอร์ไซค์'})`
      );
      return;
    }
    setIsSavingRider(true);
    setShowRiderSuccess(false);
    try {
      await update(ref(db, 'settings/logistics_rates'), {
        // ฟิลด์แบนที่ root = อัตรามอเตอร์ไซค์ เพื่อให้ทุกตัวที่ยังอ่าน root
        // (fallback ฝั่ง functions) ได้เลขเดียวกับกองไรเดอร์ส่วนใหญ่
        ...vehicleRates.motorcycle,
        by_vehicle: vehicleRates,
        travel_mode: travelMode,
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

  // Edits land on the card of the vehicle tab currently open, and only that
  // one — the other vehicle's rates have to survive switching tabs and saving.
  const handleRiderRateChange = (field: keyof typeof riderRates, value: string) => {
    setVehicleRates(prev => ({
      ...prev,
      [ratesVehicle]: { ...prev[ratesVehicle], [field]: Number(value) },
    }));
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

      {/* ⏱️ ราคาประเมิน / การยืนราคา */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <h2 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
          <Timer className="text-indigo-600" /> ราคาประเมิน และการยืนราคา
        </h2>
        <p className="text-xs font-bold text-slate-500 mt-3 mb-5 leading-relaxed">
          ราคารับซื้อขยับตามตลาดทุกวัน ระบบจึง<strong>ไม่เก็บราคาไว้ในเครื่องลูกค้าเลย</strong> — ตะกร้าเก็บแค่รหัสประเมิน
          ราคาคำนวณสดจาก <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">/models</code> ทุกครั้งที่เปิด
          บันทึกเป็น <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">settings/quote</code>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-black text-slate-600 mb-1.5">เวลากรอกฟอร์ม (นาที)</label>
            <input
              type="number"
              min={3}
              value={quote.checkout_ttl_min}
              onChange={(e) => setQuote({ ...quote, checkout_ttl_min: Number(e.target.value) })}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-indigo-400 outline-none"
            />
            <p className="text-[11px] text-slate-400 font-medium mt-1.5">
              นับตั้งแต่กดยืนยันจากตะกร้า เกินแล้วต้องประเมินราคาใหม่
            </p>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-600 mb-1.5">ยืนราคาหลังลงทะเบียน (วัน)</label>
            <input
              type="number"
              min={1}
              value={quote.lock_days}
              onChange={(e) => setQuote({ ...quote, lock_days: Number(e.target.value) })}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-indigo-400 outline-none"
            />
            <p className="text-[11px] text-slate-400 font-medium mt-1.5">
              ลงทะเบียนแล้วยืนราคานี้ให้ แม้ราคาตลาดจะปรับลงระหว่างรอเครื่อง
            </p>
          </div>
          <div>
            <label className="block text-xs font-black text-slate-600 mb-1.5">อายุรหัสประเมิน (วัน)</label>
            <input
              type="number"
              min={1}
              value={quote.assessment_gc_days}
              onChange={(e) => setQuote({ ...quote, assessment_gc_days: Number(e.target.value) })}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold focus:ring-2 focus:ring-indigo-400 outline-none"
            />
            <p className="text-[11px] text-slate-400 font-medium mt-1.5">
              รหัสที่ไม่กลายเป็นงานถูกลบทิ้งอัตโนมัติหลังจากนี้
            </p>
          </div>
        </div>

        <label className="mt-5 flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={quote.allow_code_recovery}
            onChange={(e) => setQuote({ ...quote, allow_code_recovery: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"
          />
          <span>
            <span className="block text-xs font-black text-slate-700">ให้ลูกค้ากรอกรหัสประเมินเพื่อกู้ตะกร้าข้ามเครื่อง</span>
            <span className="block text-[11px] font-medium text-slate-400 mt-1 leading-relaxed">
              ปิดไว้เป็นค่าเริ่มต้น — แทบไม่มีลูกค้าจำรหัสข้ามอุปกรณ์จริง และช่องกรอกที่เปิดทิ้งไว้
              คือช่องให้เดารหัสของคนอื่น แอดมินเปิดดูรหัสจากตั๋วได้อยู่แล้วโดยไม่ต้องเปิดสวิตช์นี้
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={quote.allow_duplicate_line}
            onChange={(e) => setQuote({ ...quote, allow_duplicate_line: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"
          />
          <span>
            <span className="block text-xs font-black text-slate-700">ปุ่ม "เพิ่มเครื่องแบบเดียวกัน" ในตะกร้าเว็บลูกค้า</span>
            <span className="block text-[11px] font-medium text-slate-400 mt-1 leading-relaxed">
              ลูกค้าเพิ่มเครื่องรุ่น/สภาพเดียวกันเป็นอีกแถวได้ทันทีโดยไม่ต้องประเมินซ้ำ (รหัสประเมินใหม่
              ราคาคิดใหม่ ตรวจสภาพแยกเครื่อง เพดาน 10 เครื่องต่อตะกร้า) — ปิดได้ทันทีถ้าแถวแฝดทำให้
              ตั๋ว/ไรเดอร์สับสน มีผลกับปุ่มบนเว็บและกับ server ที่ออกรหัสพร้อมกัน ไม่ต้อง deploy
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={hidePreQuotePrices}
            disabled={savingHidePrices}
            onChange={(e) => handleToggleHidePrices(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"
          />
          <span>
            <span className="text-xs font-black text-slate-700 flex items-center gap-2">
              ซ่อนราคาบนหน้าเลือกรุ่น (/sell) จนกว่าลูกค้าจะทำแบบประเมิน
              {savingHidePrices && <Loader2 size={12} className="animate-spin text-indigo-500" />}
            </span>
            <span className="block text-[11px] font-medium text-slate-400 mt-1 leading-relaxed">
              เปิดแล้วบรรทัด "สูงสุด ฿X" บนการ์ดรุ่น/ตัวเลือกความจุของเว็บลูกค้าจะถูกซ่อน
              ลูกค้าจะเห็นราคาครั้งแรกหลังตอบคำถามประเมินสภาพเสร็จ —
              สวิตช์นี้บันทึกทันทีที่กด มีผลกับเว็บทันทีโดยไม่ต้อง deploy
              (เก็บที่ <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">settings/sell/hide_prices_until_quote</code>)
            </span>
          </span>
        </label>

        <div className="mt-5 bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex gap-3">
          <Info size={16} className="text-indigo-500 shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-indigo-900 leading-relaxed">
            การยืนราคาครอบคลุมเฉพาะ <strong>ราคาตลาด</strong> ไม่ได้ยืนผลตรวจสภาพ —
            ถ้า QC พบตำหนิที่ลูกค้าไม่ได้แจ้ง ยังหักได้ตามจริงเหมือนเดิม
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleSaveQuote}
            disabled={isSavingQuote}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-3 rounded-xl flex items-center gap-2 disabled:opacity-50 transition-all"
          >
            {isSavingQuote ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            บันทึกการตั้งค่าราคา
          </button>
          {showQuoteSuccess && (
            <span className="text-emerald-600 font-bold text-sm flex items-center gap-1.5">
              <CheckCircle2 size={16} /> บันทึกแล้ว
            </span>
          )}
        </div>
      </div>

      {/* 🏍️ อัตราค่าวิ่งไรเดอร์ (Rider Fee Rates) */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <h2 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
          <Bike className="text-emerald-600" /> อัตราค่าวิ่งไรเดอร์ (Rider Fee)
        </h2>
        <p className="text-xs font-bold text-slate-500 mt-3 mb-5">
          ใช้คำนวณ <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">jobs/&#123;id&#125;/rider_fee</code> ตอนสถานะงานเปลี่ยนเป็น <strong>Pending QC</strong> โดย Cloud Function — บันทึกเป็น <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">settings/logistics_rates</code>
        </p>

        {/* ยานพาหนะที่กำลังแก้อัตราอยู่ — ตัวเลขทั้ง 4 ช่องด้านล่างเป็นของคันที่เลือก */}
        <div className="flex items-center gap-2 mb-5">
          {(['motorcycle', 'car'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRatesVehicle(v)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                ratesVehicle === v
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {v === 'motorcycle' ? 'มอเตอร์ไซค์' : 'รถยนต์'}
            </button>
          ))}
          <span className="text-[11px] text-slate-400 font-medium ml-1">
            อัตราแยกตามยานพาหนะ เพราะต้นทุนจริงคนละราคา
          </span>
        </div>

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

        <div className="mt-5 p-4 rounded-xl border border-slate-200 bg-slate-50/60">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
            วิธีวัดระยะทางที่ใช้คิดเงิน
          </label>
          <select
            value={travelMode}
            onChange={(e) => setTravelMode(e.target.value as 'DRIVE' | 'TWO_WHEELER')}
            className="w-full md:w-72 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="DRIVE">เส้นทางรถยนต์ (DRIVE)</option>
            <option value="TWO_WHEELER">เส้นทางมอเตอร์ไซค์ (TWO_WHEELER)</option>
          </select>
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed font-medium">
            ค่านี้ใช้ <strong>ค่าเดียวทั้งระบบ</strong> ไม่แยกตามคนขับ เพราะค่าบริการถูกแสดงให้ลูกค้าก่อนที่จะรู้ว่าใครรับงาน
            ถ้าแยกตามคนขับ ลูกค้าสองคนที่อยู่ที่เดียวกันจะจ่ายไม่เท่ากัน
            <br />
            มอเตอร์ไซค์ขึ้นทางด่วนไม่ได้ เส้นทางรถยนต์จึงมีระยะทางไกลกว่าเกือบทุกครั้ง — เปลี่ยนค่านี้กระทบทั้งค่าบริการที่เก็บลูกค้าและค่าวิ่งที่จ่ายไรเดอร์
            <br />
            <strong>เวลาถึงลูกค้า (ETA)</strong> ใช้ยานพาหนะจริงของไรเดอร์ที่รับงานอยู่แล้ว ไม่เกี่ยวกับค่านี้
          </p>
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

      {/* ค่าชดเชยไรเดอร์เวลาลูกค้ายกเลิก (Customer Cancel Compensation)
          ข้อความบนการ์ดต้องเล่ากติกาครบสามข้อ ไม่ใช่แค่ช่องที่ตั้งได้ — คนที่มาตั้ง
          ค่านี้รอบหน้าต้องรู้ว่าตัวเลขนี้ใช้กับ "ยกเลิกระหว่างทาง" เท่านั้น อีกสองกรณี
          ระบบตัดสินเองจากขั้นที่ไรเดอร์ไปถึง (bkk-system #741, functions/rider-fee-cancel.js) */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 mb-6">
        <h2 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-4">
          <XCircle className="text-rose-600" /> ค่ารอบไรเดอร์เมื่องานถูกยกเลิก
        </h2>
        <p className="text-xs font-bold text-slate-500 mt-3 mb-3">
          ระบบตัดสินอัตโนมัติทุกครั้งที่งาน Pickup เข้าสถานะ Cancelled ไม่ว่าใครเป็นคนยกเลิก
          (ลูกค้ากดจากเว็บ / แอดมิน / ไรเดอร์ยื่นคำขอแทนลูกค้า) โดยดูว่าไรเดอร์ไปถึงขั้นไหนแล้ว
        </p>
        <div className="mb-5 overflow-x-auto">
          <table className="w-full text-xs border border-slate-200 rounded-xl overflow-hidden">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-widest text-[10px]">
              <tr>
                <th className="text-left px-3 py-2 font-bold">ยกเลิกตอนไหน</th>
                <th className="text-left px-3 py-2 font-bold">ไรเดอร์ได้อะไร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-3 py-2 font-bold text-slate-700">รับงานแล้ว แต่ยังไม่กดออกเดินทาง</td>
                <td className="px-3 py-2 text-slate-600">ไม่จ่าย — ยอดที่ตรึงไว้ตอนกดรับถูกประทับเป็นโมฆะ</td>
              </tr>
              <tr className="bg-rose-50/40">
                <td className="px-3 py-2 font-bold text-slate-700">ออกเดินทางแล้ว ถูกยกเลิกระหว่างทาง</td>
                <td className="px-3 py-2 text-slate-600">ค่าเสียเวลาตามช่องด้านล่างนี้ (เข้าคิวจ่ายค่ารอบตามปกติ)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-bold text-slate-700">ถึงหน้างาน ตรวจเครื่องแล้วไม่ผ่าน</td>
                <td className="px-3 py-2 text-slate-600">ค่ารอบตามเรทปกติ (ยอดที่ตรึงตอนกดรับ หรือคิดจากระยะทาง)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 font-bold mb-5">
          ช่องนี้กำหนดเฉพาะกรณี "ยกเลิกระหว่างทาง" อีกสองกรณีไม่มีค่าให้ตั้ง — เก็บที่
          <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] ml-1">settings/rider_compensation</code>
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
              ตั้ง 0 ได้ถ้าตั้งใจไม่จ่ายค่าเสียเวลา — แต่ถ้ายังไม่เคยบันทึกเลย ระบบจะไม่จ่ายและแจ้ง error แทนการเดาเลข
            </p>
          </div>
        </div>

        {compLoaded && riderComp.customer_cancel_time_loss === 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 p-3 rounded-xl flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
            <span className="font-bold leading-relaxed">
              ค่ายังเป็น 0 หรือยังไม่เคยบันทึก — ถ้ายังไม่เคยบันทึก การยกเลิกระหว่างทางจะไม่จ่ายค่าเสียเวลา
              และคำขอยกเลิกที่ไรเดอร์ยื่นแทนลูกค้าจะถูกปฏิเสธจนกว่าจะบันทึกค่านี้ (กันการจ่ายเลขที่ไม่มีใครตั้ง)
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