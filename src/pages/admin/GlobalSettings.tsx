'use client';

import React, { useState, useEffect } from 'react';
import { ref, onValue, update } from 'firebase/database';
// ⚠️ แก้ไข path db ให้ตรงกับโปรเจกต์ของคุณ
import { db } from '../../api/firebase'; 
import { Settings, Map, Save, Loader2, Info, CheckCircle2, Navigation, AlertTriangle } from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';

export default function GlobalSettings() {
  const toast = useToast();
  // 🌟 1. State สำหรับตัวแปรคำนวณระยะทาง
  const [pricing, setPricing] = useState({
    baseFare: 50,      // ค่าบริการเริ่มต้น (บาท)
    freeRadius: 5,     // ระยะทางส่งฟรี / ครอบคลุมในค่าเริ่มต้น (กม.)
    perKmRate: 10,     // ค่าบริการกิโลเมตรถัดไป (บาท/กม.)
    maxDistance: 50    // ระยะทางให้บริการสูงสุด (กม.)
  });

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

      </div>
    </div>
  );
}