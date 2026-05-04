// src/pages/mobile/components/AdminDeviceVerificationModal.tsx
//
// Admin-side mirror of bkk-rider-app's DeviceVerificationModal. Captures
// 4 iOS Settings screens before condition checklist:
//
//   1. IMEI / Serial    — Settings → General → About
//   2. Battery Health   — Settings → Battery → Battery Health
//   3. Find My          — HARD GATE: must be OFF
//   4. Warranty         — AppleCare status + expiry
//
// Same /jobs/{id}/verification/ Storage path, same RTDB fields
// (device_imei, battery_health_pct, find_my_status, warranty_status,
// etc.) so existing admin/finance dashboards work unchanged.

import { useState } from 'react';
import {
  X, Smartphone, BatteryFull, Search, ShieldCheck, AlertTriangle,
  Loader2, Trash2, Camera, Award,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../../api/firebase';
import { uploadImageToFirebase } from '../../../utils/uploadImage';
import {
  ocrImei, ocrBattery, ocrFindMy, ocrWarranty, OCR_VERIFY_THRESHOLD,
  type ImeiFields, type BatteryFields, type FindMyFields, type WarrantyFields,
} from '../../../utils/visionOcr';
import { useToast } from '../../../components/ui/ToastProvider';

interface Props {
  job: { id: string };
  onClose: () => void;
  onComplete?: () => void;
}

type Slot = 'imei' | 'battery' | 'findMy' | 'warranty';

interface SlotState<F> {
  url: string | null;
  fields: F | null;
  confidence: number;
  uploading: boolean;
  ocring: boolean;
}

function emptySlot<F>(): SlotState<F> {
  return { url: null, fields: null, confidence: 0, uploading: false, ocring: false };
}

export const AdminDeviceVerificationModal = ({ job, onClose, onComplete }: Props) => {
  const toast = useToast();
  const [imei, setImei] = useState<SlotState<ImeiFields>>(emptySlot());
  const [battery, setBattery] = useState<SlotState<BatteryFields>>(emptySlot());
  const [findMy, setFindMy] = useState<SlotState<FindMyFields>>(emptySlot());
  const [warranty, setWarranty] = useState<SlotState<WarrantyFields>>(emptySlot());
  const [isSaving, setIsSaving] = useState(false);
  const [imeiText, setImeiText] = useState('');
  const [batteryPct, setBatteryPct] = useState('');
  const [warrantyExpires, setWarrantyExpires] = useState('');

  const handleUpload = async (file: File | undefined, slot: Slot) => {
    if (!file) return;
    const setter = slot === 'imei' ? setImei
      : slot === 'battery' ? setBattery
      : slot === 'findMy' ? setFindMy
      : setWarranty;
    setter((s: SlotState<unknown>) => ({ ...s, uploading: true }));
    try {
      const url = await uploadImageToFirebase(file, `jobs/${job.id}/verification`, { opaqueFilename: true });
      setter((s: SlotState<unknown>) => ({ ...s, url, uploading: false, ocring: true }));

      try {
        if (slot === 'imei') {
          const r = await ocrImei(url);
          setImei({ url, fields: r.fields, confidence: r.confidence, uploading: false, ocring: false });
          if (r.fields?.imei && !imeiText) setImeiText(r.fields.imei);
        } else if (slot === 'battery') {
          const r = await ocrBattery(url);
          setBattery({ url, fields: r.fields, confidence: r.confidence, uploading: false, ocring: false });
          if (r.fields?.maximumCapacityPct != null && !batteryPct) {
            setBatteryPct(String(r.fields.maximumCapacityPct));
          }
        } else if (slot === 'findMy') {
          const r = await ocrFindMy(url);
          setFindMy({ url, fields: r.fields, confidence: r.confidence, uploading: false, ocring: false });
        } else {
          const r = await ocrWarranty(url);
          setWarranty({ url, fields: r.fields, confidence: r.confidence, uploading: false, ocring: false });
          if (r.fields?.expiresAt && !warrantyExpires) setWarrantyExpires(r.fields.expiresAt);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[AdminDeviceVerification] OCR failed', { slot, error: msg });
        setter((s: SlotState<unknown>) => ({ ...s, ocring: false }));
        toast.info('อ่านข้อมูลอัตโนมัติไม่ได้ — กรุณากรอกเอง');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setter((s: SlotState<unknown>) => ({ ...s, uploading: false }));
      toast.error('อัปโหลดไม่สำเร็จ: ' + msg);
    }
  };

  const findMyIsOn = findMy.fields?.findMyStatus === 'on' || findMy.fields?.activationLock === 'on';
  const findMyConfirmedOff = findMy.fields?.findMyStatus === 'off';

  const handleSave = async () => {
    if (findMyIsOn) {
      toast.error('Find My ยังเปิดอยู่ — ขอให้ลูกค้า sign out ก่อน');
      return;
    }
    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = {
        verification_completed_at: Date.now(),
        updated_at: Date.now(),
      };
      if (imeiText.trim()) updates.device_imei = imeiText.trim();
      if (imei.fields?.serial) updates.device_serial = imei.fields.serial;
      if (imei.fields?.modelNumber) updates.device_model_number = imei.fields.modelNumber;
      if (imei.url) updates.verification_imei_photo = imei.url;
      if (batteryPct.trim()) updates.battery_health_pct = parseInt(batteryPct, 10);
      if (battery.fields?.cycleCount != null) updates.battery_cycle_count = battery.fields.cycleCount;
      if (battery.url) updates.verification_battery_photo = battery.url;
      if (findMy.fields?.findMyStatus) updates.find_my_status = findMy.fields.findMyStatus;
      if (findMy.url) updates.verification_findmy_photo = findMy.url;
      if (warranty.fields?.status) updates.warranty_status = warranty.fields.status;
      if (warrantyExpires.trim()) updates.warranty_expires_at = warrantyExpires.trim();
      if (warranty.fields?.coverageType) updates.warranty_coverage_type = warranty.fields.coverageType;
      if (warranty.url) updates.verification_warranty_photo = warranty.url;

      await update(ref(db, `jobs/${job.id}`), updates);
      toast.success('บันทึกข้อมูลเครื่องเรียบร้อย');
      onComplete?.();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('บันทึกไม่สำเร็จ: ' + msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Smartphone size={22} className="text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">ตรวจสอบเครื่องเบื้องต้น</h2>
              <p className="text-xs text-gray-500">ถ่าย 4 หน้าจอจาก Settings — ระบบจะอ่านอัตโนมัติ</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full" aria-label="ปิด">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Find My — most critical, surface first */}
          <SlotComponent
            title="Find My / Activation Lock"
            instruction="ที่เครื่อง: Settings → [Apple ID] → Find My"
            icon={Search}
            state={findMy}
            onUpload={(f) => handleUpload(f, 'findMy')}
            onClear={() => setFindMy(emptySlot())}
            renderResult={() => {
              if (!findMy.fields) return null;
              if (findMyIsOn) {
                return (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 mt-2 flex gap-2 items-start">
                    <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-red-900">
                      <p className="font-bold">Find My ยังเปิดอยู่ — ห้ามรับเครื่อง</p>
                      <p className="mt-1">ขอให้ลูกค้า sign out จาก Apple ID และ disable Find My ก่อน แล้วถ่ายรูปใหม่</p>
                      {findMy.fields.appleIdHint && (
                        <p className="mt-1 text-[11px] text-red-700">Apple ID: {findMy.fields.appleIdHint}</p>
                      )}
                    </div>
                  </div>
                );
              }
              if (findMyConfirmedOff) {
                return (
                  <p className="text-[11px] text-emerald-600 font-medium mt-2">
                    ✓ Find My ปิด — รับเครื่องต่อได้
                  </p>
                );
              }
              return (
                <p className="text-[11px] text-amber-600 font-medium mt-2">
                  อ่านสถานะไม่ชัด — กรุณายืนยันด้วยตาเปล่าก่อนรับเครื่อง
                </p>
              );
            }}
          />

          {/* IMEI */}
          <SlotComponent
            title="IMEI / Serial Number"
            instruction="ที่เครื่อง: Settings → General → About"
            icon={Smartphone}
            state={imei}
            onUpload={(f) => handleUpload(f, 'imei')}
            onClear={() => { setImei(emptySlot()); setImeiText(''); }}
            renderResult={() => imei.fields && (
              <div className="space-y-2 mt-2">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">IMEI (15 หลัก)</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={imeiText}
                    onChange={(e) => setImeiText(e.target.value)}
                    placeholder="358xxxxxxxxxxx"
                    className="w-full mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono"
                  />
                </div>
                {imei.fields.serial && (
                  <p className="text-[11px] text-gray-500">Serial: <span className="font-mono">{imei.fields.serial}</span></p>
                )}
                {imei.fields.modelNumber && (
                  <p className="text-[11px] text-gray-500">Model: <span className="font-mono">{imei.fields.modelNumber}</span></p>
                )}
                {imei.confidence < OCR_VERIFY_THRESHOLD && (
                  <p className="text-[11px] text-amber-600">อ่านได้ความมั่นใจต่ำ — กรุณาตรวจ</p>
                )}
              </div>
            )}
          />

          {/* Battery Health */}
          <SlotComponent
            title="Battery Health"
            instruction="ที่เครื่อง: Settings → Battery → Battery Health"
            icon={BatteryFull}
            state={battery}
            onUpload={(f) => handleUpload(f, 'battery')}
            onClear={() => { setBattery(emptySlot()); setBatteryPct(''); }}
            renderResult={() => battery.fields && (
              <div className="space-y-2 mt-2">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Maximum Capacity (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={batteryPct}
                    onChange={(e) => setBatteryPct(e.target.value)}
                    placeholder="89"
                    className="w-full mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono"
                  />
                </div>
                {battery.fields.cycleCount != null && (
                  <p className="text-[11px] text-gray-500">Cycle count: <span className="font-mono">{battery.fields.cycleCount}</span></p>
                )}
                {battery.fields.peakPerformanceCapability && (
                  <p className="text-[11px] text-gray-500">Peak performance: {battery.fields.peakPerformanceCapability}</p>
                )}
                {battery.confidence < OCR_VERIFY_THRESHOLD && (
                  <p className="text-[11px] text-amber-600">อ่านได้ความมั่นใจต่ำ — กรุณาตรวจ</p>
                )}
              </div>
            )}
          />

          {/* Warranty / AppleCare */}
          <SlotComponent
            title="Warranty / AppleCare"
            instruction="ที่เครื่อง: Settings → General → AppleCare & Warranty"
            icon={Award}
            state={warranty}
            onUpload={(f) => handleUpload(f, 'warranty')}
            onClear={() => { setWarranty(emptySlot()); setWarrantyExpires(''); }}
            renderResult={() => warranty.fields && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                    warranty.fields.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    warranty.fields.status === 'expired' ? 'bg-red-50 text-red-700 border border-red-200' :
                    'bg-gray-100 text-gray-600 border border-gray-200'
                  }`}>
                    {warranty.fields.status === 'active' ? 'อยู่ในประกัน' :
                     warranty.fields.status === 'expired' ? 'หมดประกันแล้ว' :
                     'ไม่ทราบสถานะ'}
                  </span>
                  {warranty.fields.coverageType && (
                    <span className="text-[11px] text-gray-500">
                      {warranty.fields.coverageType === 'applecare_plus' ? 'AppleCare+' : 'Limited Warranty'}
                    </span>
                  )}
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">วันหมดประกัน (YYYY-MM-DD)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={warrantyExpires}
                    onChange={(e) => setWarrantyExpires(e.target.value)}
                    placeholder="2026-10-31"
                    className="w-full mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono"
                  />
                </div>
                {warranty.fields.expiresAtRaw && warranty.fields.expiresAtRaw !== warrantyExpires && (
                  <p className="text-[11px] text-gray-500">อ่านได้: <span className="font-medium">{warranty.fields.expiresAtRaw}</span></p>
                )}
                {warranty.confidence < OCR_VERIFY_THRESHOLD && (
                  <p className="text-[11px] text-amber-600">อ่านได้ความมั่นใจต่ำ — กรุณาตรวจ</p>
                )}
              </div>
            )}
          />
        </div>

        {/* Footer */}
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-gray-100 shrink-0 space-y-2">
          <button
            onClick={handleSave}
            disabled={isSaving || findMyIsOn}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-md active:scale-95 flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {isSaving ? (
              <><Loader2 size={20} className="animate-spin" /> กำลังบันทึก...</>
            ) : findMyIsOn ? (
              <><AlertTriangle size={20} /> ปิด Find My ก่อน</>
            ) : (
              <><ShieldCheck size={20} /> บันทึกข้อมูลเครื่อง</>
            )}
          </button>
          <button
            onClick={onClose}
            className="w-full text-xs font-bold text-gray-400 hover:text-gray-600 underline py-2"
          >
            ข้ามขั้นตอนนี้
          </button>
        </div>
      </div>
    </div>
  );
};

interface SlotProps {
  title: string;
  instruction: string;
  icon: LucideIcon;
  state: SlotState<unknown>;
  onUpload: (file: File | undefined) => void;
  onClear: () => void;
  renderResult?: () => React.ReactNode;
}

function SlotComponent({ title, instruction, icon: Icon, state, onUpload, onClear, renderResult }: SlotProps) {
  const inputId = `slot-${title.replace(/\W/g, '-')}`;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-gray-500" />
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        </div>
        {state.url && (
          <button onClick={onClear} className="text-xs text-red-500 font-medium flex items-center gap-1 hover:underline">
            <Trash2 size={12} /> ถ่ายใหม่
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500 mb-2">{instruction}</p>

      {state.url ? (
        <div className="relative">
          <img src={state.url} alt={title} className="w-full aspect-[3/4] object-cover rounded-2xl border border-gray-200" />
          {state.ocring && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-2xl">
              <div className="bg-white px-3 py-2 rounded-xl shadow flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-blue-600" />
                <span className="text-xs font-medium text-gray-700">กำลังอ่านข้อมูล...</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
          <label
            htmlFor={inputId}
            className="w-full aspect-[3/4] border-2 border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-blue-400 hover:bg-blue-50/50 transition cursor-pointer"
          >
            {state.uploading ? (
              <Loader2 size={28} className="animate-spin text-blue-500" />
            ) : (
              <>
                <Camera size={28} />
                <span className="text-sm font-medium">ถ่ายรูปหรือเลือกจากคลังภาพ</span>
              </>
            )}
          </label>
        </>
      )}

      {renderResult && renderResult()}
    </div>
  );
}
