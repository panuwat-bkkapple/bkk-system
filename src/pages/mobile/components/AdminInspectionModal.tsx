// src/pages/mobile/components/AdminInspectionModal.tsx
//
// Admin-side mirror of bkk-rider-app's InspectionModal. Used for branch-intake
// jobs (Store-in drop-off and Mail-in parcel) where the device arrives at the
// branch — admin does the same 6-angle photos + condition checklist + price
// recalculation the rider does at pickup. Same /jobs/{id}/inspection/ Storage path,
// same device shape (photos, deductions, final_price), same status
// transition (→ "Pending QC") so existing admin/finance dashboards work
// unchanged.

import { useState, useRef, useMemo, useEffect } from 'react';
import {
  X, ChevronLeft, CheckCircle2, Camera, Upload,
  Smartphone, ShieldCheck, PackageOpen, ListChecks,
} from 'lucide-react';
import { ref as dbRef, onValue, update } from 'firebase/database';
import { db, auth } from '../../../api/firebase';
import { formatCurrency } from '../../../utils/formatters';
import { resolveOptionDeduction } from '../../../utils/pricingResolver';
import { uploadImageToFirebase } from '../../../utils/uploadImage';
import { useToast } from '../../../components/ui/ToastProvider';
import { SickwDeviceCheck } from '../../../components/sickw/SickwDeviceCheck';
import { SickwGateBanner } from '../../../components/sickw/SickwGateBanner';
import { getSickwGateStatus } from '../../../utils/sickwApi';
import { useAuth } from '../../../hooks/useAuth';

// Required photo slots — admin must take one per angle so QC can verify
// the device condition without ambiguity.
const PHOTO_SLOTS = [
  { key: 'front',  label: 'ด้านหน้า (เปิดหน้าจอ)', hint: 'หน้าจอเปิดและสว่างให้เห็นพิกเซลชัด' },
  { key: 'back',   label: 'ด้านหลัง',              hint: 'เห็นโลโก้และกล้องครบ' },
  { key: 'top',    label: 'ด้านบน',                hint: 'ปุ่มเปิด/ปิด, ลำโพง' },
  { key: 'bottom', label: 'ด้านล่าง',              hint: 'ช่องชาร์จ, ลำโพง' },
  { key: 'left',   label: 'ด้านข้างซ้าย',          hint: 'ปุ่มเสียง, ปุ่ม Action (ถ้ามี)' },
  { key: 'right',  label: 'ด้านข้างขวา',           hint: 'ปุ่มเปิดปิด/ปุ่ม Power' },
] as const;

// Brand-new sealed devices skip the 6-angle device shots — replace with
// box + seal + IMEI proof so QC can verify authenticity.
const NEW_DEVICE_PHOTO_SLOTS = [
  { key: 'front',  label: 'หน้ากล่อง',           hint: 'เห็นรุ่น / สี / ความจุชัด' },
  { key: 'back',   label: 'ใต้กล่อง (IMEI)',     hint: 'ป้าย IMEI / Serial บนกล่อง' },
  { key: 'top',    label: 'ซีลพลาสติก',          hint: 'close-up ให้เห็นว่าซีลยังครบ ไม่แกะ' },
  { key: 'bottom', label: 'ซีลฝั่งตรงข้าม',      hint: 'ซีลอีกด้านของกล่อง' },
] as const;

type SlotKey = typeof PHOTO_SLOTS[number]['key'];
const SLOT_KEYS: SlotKey[] = PHOTO_SLOTS.map((s) => s.key);
const REQUIRED_SLOTS = PHOTO_SLOTS.length;
const NEW_DEVICE_REQUIRED_SLOTS = NEW_DEVICE_PHOTO_SLOTS.length;

interface SlotPhoto { url: string; file: File }

interface InspectedDeviceData {
  checks: string[];
  photos: string[];
  photoFiles: File[];
  deductions: string[];
  final_price: number;
}

interface AdminInspectionModalProps {
  job: any;
  staffName: string;
  onClose: () => void;
  onSaved?: () => void;
}

// Mirror of bkk-rider-app's getDevicesList — multi-device aware, falls
// back to a synthetic device built from job-level fields for single-item
// legacy jobs.
function getDevicesList(job: any): any[] {
  if (!job) return [];
  if (job.devices && Array.isArray(job.devices) && job.devices.length > 0) return job.devices;
  return [{
    device_id: 'old_item_1',
    model: job.model,
    estimated_price: job.price,
    isNewDevice: job.assessment_details?.isNewDevice || false,
    rawConditions: job.assessment_details?.rawConditions || {},
    customer_conditions: job.customer_conditions || [],
  }];
}

export const AdminInspectionModal = ({ job, staffName, onClose, onSaved }: AdminInspectionModalProps) => {
  const toast = useToast();
  const { currentUser } = useAuth();
  const gate = getSickwGateStatus(job?.sickw_check);

  const [modelsData, setModelsData] = useState<any[]>([]);
  const [conditionSets, setConditionSets] = useState<any[]>([]);

  const [activeDeviceIndex, setActiveDeviceIndex] = useState<number | null>(null);
  const [inspectedDevicesData, setInspectedDevicesData] = useState<Record<number, InspectedDeviceData>>({});
  const [checks, setChecks] = useState<string[]>([]);
  const [slotPhotos, setSlotPhotos] = useState<Record<SlotKey, SlotPhoto | null>>({
    front: null, back: null, top: null, bottom: null, left: null, right: null,
  });
  const [damagePhotos, setDamagePhotos] = useState<SlotPhoto[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);
  const damageInputRef = useRef<HTMLInputElement>(null);

  const devicesList = getDevicesList(job);

  // Load models + condition_sets — same paths PriceEditor uses.
  useEffect(() => {
    const unsubModels = onValue(dbRef(db, 'models'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const formatted = Object.keys(data).map((k) => ({ id: k, ...data[k] }));
        setModelsData(formatted);
      } else {
        setModelsData([]);
      }
    });
    const unsubSets = onValue(dbRef(db, 'settings/condition_sets'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const formatted = Object.keys(data).map((k) => ({ id: k, ...data[k] }));
        setConditionSets(formatted);
      } else {
        setConditionSets([]);
      }
    });
    return () => { unsubModels(); unsubSets(); };
  }, []);

  const activeChecklist = useMemo((): any[] => {
    if (!job || activeDeviceIndex === null || !modelsData.length || !conditionSets.length) return [];
    const activeDevice = devicesList[activeDeviceIndex];
    if (!activeDevice) return [];
    const baseModelName = (activeDevice.model || '').split(' (')[0].trim();
    const targetModel = modelsData.find(
      (m: any) => m.name === baseModelName || (activeDevice.model || '').includes(m.name),
    );
    if (!targetModel || !targetModel.conditionSetId) return [];
    const targetSet = conditionSets.find((s: any) => s.id === targetModel.conditionSetId);
    return targetSet?.groups || [];
  }, [job, activeDeviceIndex, modelsData, conditionSets, devicesList]);

  const getBasePrice = (device: any): number => {
    let trueBasePrice = 0;
    if (modelsData.length && device) {
      const targetModel = modelsData.find((m: any) => m.name === device.model);
      if (targetModel && targetModel.variants) {
        const targetVariant = targetModel.variants.find((v: any) => v.name === device.variant);
        if (targetVariant) trueBasePrice = Number(targetVariant.usedPrice || targetVariant.price || 0);
        else trueBasePrice = Number(targetModel.variants[0]?.usedPrice || targetModel.variants[0]?.price || 0);
      }
    }
    if (trueBasePrice > 0) return trueBasePrice;
    const fromDevice = Number(device?.base_price || 0);
    if (fromDevice > 0) return fromDevice;
    if (device?.estimated_price) {
      console.warn(
        `[AdminInspectionModal] No base_price for ${device?.model} (${device?.variant}); falling back to estimated_price — deductions may double-count.`,
      );
    }
    return Number(device?.estimated_price || 0);
  };

  // Per-model liquidity multiplier — MUST mirror the customer quote
  // (SellPageClient), internal QC (InternalQCModal) and the server
  // (validateAndCreateOrder) so admin-inspection deductions don't diverge from
  // what the customer was shown. <1 = high-demand model, deduct less.
  const getLiquidityFactor = (device: any): number => {
    const baseModelName = (device?.model || '').split(' (')[0].trim();
    const targetModel = modelsData.find(
      (m: any) => m.name === device?.model || m.name === baseModelName || (device?.model || '').includes(m.name),
    );
    const lf = Number(targetModel?.liquidityFactor);
    return lf > 0 ? lf : 1;
  };

  const handleSlotCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeSlot) return;
    setSlotPhotos((prev) => ({
      ...prev,
      [activeSlot]: { url: URL.createObjectURL(file), file },
    }));
    setActiveSlot(null);
  };

  const handleClearSlot = (key: SlotKey) => {
    setSlotPhotos((prev) => ({ ...prev, [key]: null }));
  };

  const handleDamageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDamagePhotos((prev) => [...prev, { url: URL.createObjectURL(file), file }]);
  };

  const handleClearDamage = (index: number) => {
    setDamagePhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const filledSlotCount = Object.values(slotPhotos).filter(Boolean).length;
  const activeDeviceIsNew = activeDeviceIndex !== null && !!devicesList[activeDeviceIndex]?.isNewDevice;
  const requiredCountForActive = activeDeviceIsNew ? NEW_DEVICE_REQUIRED_SLOTS : REQUIRED_SLOTS;
  const allRequiredSlotsFilled = filledSlotCount >= requiredCountForActive;

  const saveDeviceInspection = () => {
    if (activeDeviceIndex === null) return;
    const activeDevice = devicesList[activeDeviceIndex];
    if (!allRequiredSlotsFilled) {
      toast.error(
        activeDevice.isNewDevice
          ? 'กรุณาถ่ายภาพกล่อง ซีล และ IMEI ครบทั้ง 4 รูปก่อนบันทึก'
          : 'กรุณาถ่ายรูปครบทั้ง 6 ด้านก่อนบันทึก',
      );
      return;
    }
    const deductionLabels: string[] = [];
    const startingPrice = getBasePrice(activeDevice);

    let totalDeduction = 0;
    if (activeDevice.isNewDevice) {
      deductionLabels.push('[สภาพสินค้า] เครื่องใหม่มือ 1 (ตรวจสอบซีลและกล่องสมบูรณ์)');
    } else {
      const lf = getLiquidityFactor(activeDevice);
      activeChecklist.forEach((group: any) => {
        group.options?.forEach((opt: any) => {
          if (checks.includes(opt.id)) {
            const deductAmount = resolveOptionDeduction(opt, startingPrice, lf);
            totalDeduction += deductAmount;
            deductionLabels.push(deductAmount > 0
              ? `[${group.title}] ${opt.label} (-฿${deductAmount.toLocaleString()})`
              : `[${group.title}] ${opt.label}`,
            );
          }
        });
      });
    }

    const finalPrice = activeDevice.isNewDevice ? startingPrice : Math.max(0, startingPrice - totalDeduction);
    const slotPairs = SLOT_KEYS.map((k) => slotPhotos[k]).filter((p): p is SlotPhoto => p != null);
    const orderedPhotos = [...slotPairs, ...damagePhotos];

    setInspectedDevicesData((prev) => ({
      ...prev,
      [activeDeviceIndex]: {
        checks: activeDevice.isNewDevice ? [] : [...checks],
        photos: orderedPhotos.map((p) => p.url),
        photoFiles: orderedPhotos.map((p) => p.file),
        deductions: deductionLabels,
        final_price: finalPrice,
      },
    }));
    setActiveDeviceIndex(null);
  };

  const handleSubmitAll = async () => {
    if (!auth.currentUser) {
      toast.error('กรุณา login ใหม่');
      return;
    }
    setIsUploading(true);
    try {
      const updatedDevices = [...devicesList];
      let jobTotalDevicePrice = 0;
      for (let i = 0; i < updatedDevices.length; i++) {
        const data = inspectedDevicesData[i];
        if (data) {
          const uploadedUrls = await Promise.all(
            data.photoFiles.map((file: File) => uploadImageToFirebase(file, `jobs/${job.id}/inspection/device_${i}`)),
          );
          updatedDevices[i] = {
            ...updatedDevices[i],
            photos: uploadedUrls,
            deductions: data.deductions,
            estimated_price: data.final_price,
            price: data.final_price,
            inspection_status: 'Inspected',
          };
          jobTotalDevicePrice += data.final_price;
        } else {
          jobTotalDevicePrice += Number(updatedDevices[i].estimated_price || updatedDevices[i].price || 0);
        }
      }

      const pickupFee = Number(job.pickup_fee || 0);
      const couponValue = Number(job.applied_coupon?.value || job.applied_coupon?.actual_value || 0);
      const newNetPayout = Math.max(0, jobTotalDevicePrice - pickupFee + couponValue);

      const inspectedAt = Date.now();
      // qc_logs is stored as an array — prepend-and-replace, same pattern
      // the rest of the codebase uses. Mixing string keys into the array
      // path turns it into a map and crashes consumers.
      const newLog = {
        action: 'INSPECTED',
        by: staffName,
        by_uid: auth.currentUser.uid,
        timestamp: inspectedAt,
        details: `${job.receive_method || 'Store-in'} inspection: ${updatedDevices.length} device(s), final ฿${jobTotalDevicePrice.toLocaleString()}`,
      };
      const updatedLogs = [newLog, ...((job.qc_logs as unknown[]) || [])];
      const updates: Record<string, unknown> = {
        [`jobs/${job.id}/devices`]: updatedDevices,
        [`jobs/${job.id}/final_price`]: jobTotalDevicePrice,
        [`jobs/${job.id}/price`]: jobTotalDevicePrice,
        [`jobs/${job.id}/net_payout`]: newNetPayout,
        [`jobs/${job.id}/inspected_at`]: inspectedAt,
        [`jobs/${job.id}/status`]: 'Pending QC',
        [`jobs/${job.id}/qc_logs`]: updatedLogs,
      };

      await update(dbRef(db), updates);
      toast.success('บันทึกผลตรวจสภาพสำเร็จ');
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('อัปโหลดรูปภาพล้มเหลว: ' + msg);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[100] flex items-end animate-in fade-in duration-300">
      <div className="bg-white w-full rounded-t-[2rem] p-6 pb-12 max-h-[90vh] overflow-y-auto flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">

        {activeDeviceIndex === null ? (
          <div className="animate-in fade-in">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">ตรวจสภาพเครื่อง{job.receive_method ? ` (${job.receive_method})` : ''}</h3>
                <p className="text-sm text-gray-500 mt-1">ทั้งหมด {devicesList.length} เครื่อง</p>
              </div>
              <button onClick={onClose} className="bg-gray-100 p-2 rounded-full text-gray-500 hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>
            {/* Sickw Gate status — มาก่อนรายการเครื่อง */}
            <div className="mb-4">
              <SickwGateBanner
                jobId={job.id}
                sickwCheck={job?.sickw_check}
                gate={gate}
                currentRole={currentUser?.role}
              />
            </div>
            <div className="space-y-3 mb-8">
              {devicesList.map((device: any, index: number) => {
                const isDone = !!inspectedDevicesData[index];
                return (
                  <div key={index} className={`p-4 rounded-2xl border transition-all flex justify-between items-center ${isDone ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white shadow-sm'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isDone ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                        {isDone ? <CheckCircle2 size={24} /> : <Smartphone size={24} />}
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-gray-900 leading-tight">{device.model}</div>
                        {isDone
                          ? <div className="text-xs font-medium text-emerald-600 mt-1">ตรวจแล้ว · ฿{inspectedDevicesData[index].final_price.toLocaleString()}</div>
                          : <div className="text-xs font-medium text-amber-500 mt-1">รอตรวจสอบ</div>
                        }
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setChecks(inspectedDevicesData[index]?.checks || []);
                        const savedUrls = inspectedDevicesData[index]?.photos || [];
                        const savedFiles = inspectedDevicesData[index]?.photoFiles || [];
                        const restored: Record<SlotKey, SlotPhoto | null> = {
                          front: null, back: null, top: null, bottom: null, left: null, right: null,
                        };
                        SLOT_KEYS.forEach((k, i) => {
                          if (savedUrls[i] && savedFiles[i]) restored[k] = { url: savedUrls[i], file: savedFiles[i] };
                        });
                        setSlotPhotos(restored);
                        const damage: SlotPhoto[] = [];
                        for (let i = REQUIRED_SLOTS; i < savedUrls.length; i++) {
                          if (savedUrls[i] && savedFiles[i]) damage.push({ url: savedUrls[i], file: savedFiles[i] });
                        }
                        setDamagePhotos(damage);
                        setActiveDeviceIndex(index);
                      }}
                      className={`px-4 py-2 rounded-xl font-semibold text-xs transition-all ${isDone ? 'bg-white text-gray-600 border border-gray-200' : 'bg-blue-600 text-white shadow-md hover:bg-blue-700'}`}
                    >
                      {isDone ? 'แก้ไข' : 'เริ่มตรวจ'}
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => {
                if (gate.blocked) {
                  toast.error(`IMEI Gate: ${gate.reasons.join(' / ')} — ต้องให้ MANAGER/CEO override ก่อน`);
                  return;
                }
                handleSubmitAll();
              }}
              disabled={isUploading || Object.keys(inspectedDevicesData).length !== devicesList.length || gate.blocked}
              className={`w-full py-4 rounded-2xl font-bold text-lg shadow-md transition-all flex items-center justify-center gap-2 ${
                isUploading || Object.keys(inspectedDevicesData).length !== devicesList.length || gate.blocked
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-500 text-white active:scale-95 hover:bg-emerald-600'
              }`}
            >
              {isUploading
                ? <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" /> อัปโหลด...</>
                : gate.blocked
                  ? <>IMEI Gate Block — ต้อง Override</>
                  : <><Upload size={22} /> ส่งผลตรวจ → Pending QC</>
              }
            </button>
          </div>
        ) : (
          <div className="animate-in slide-in-from-right duration-300">
            <div className="flex items-center gap-3 mb-6">
              <button onClick={() => setActiveDeviceIndex(null)} className="p-2 bg-gray-100 rounded-full text-gray-600 hover:bg-gray-200">
                <ChevronLeft size={20} />
              </button>
              <h3 className="text-lg font-bold text-gray-900 leading-tight flex-1 line-clamp-1">
                {devicesList[activeDeviceIndex].model}
              </h3>
            </div>

            <div className="space-y-8">
              {/* Sickw IMEI Check — ตรวจสอบสถานะเครื่องกับฐานข้อมูล Apple
                  วางก่อน Photos เพื่อให้ admin verify รุ่น/ความจุ/FMI ก่อนเริ่มถ่ายรูป */}
              <SickwDeviceCheck
                jobId={job.id}
                initialImei={
                  (devicesList[activeDeviceIndex] as any)?.imei ||
                  job.device_imei || job.imei || ''
                }
                initialSerial={
                  (devicesList[activeDeviceIndex] as any)?.serial ||
                  job.device_serial || job.serial || ''
                }
              />

              {/* Photos — named slots */}
              {(() => {
                const isNew = devicesList[activeDeviceIndex]?.isNewDevice;
                const slotsToShow = isNew ? NEW_DEVICE_PHOTO_SLOTS : PHOTO_SLOTS;
                const totalRequired = isNew ? NEW_DEVICE_REQUIRED_SLOTS : REQUIRED_SLOTS;
                return (
                  <div>
                    <label className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                      <Camera size={16} className="text-blue-500" />
                      {isNew ? 'รูปถ่ายกล่อง + ซีล' : 'รูปถ่ายตัวเครื่อง'}
                      <span className={`text-[11px] font-normal ml-auto ${allRequiredSlotsFilled ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {filledSlotCount} / {totalRequired}
                      </span>
                    </label>
                    <p className="text-[11px] text-gray-500 mb-3">
                      {isNew
                        ? 'เครื่องใหม่ยังไม่แกะซีล — ถ่ายกล่อง ซีลพลาสติก และเลข IMEI ให้ครบ'
                        : 'ถ่ายทั้ง 6 ด้านเพื่อให้ QC ตรวจสภาพได้ครบ'}
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {slotsToShow.map((slot) => {
                        const photo = slotPhotos[slot.key];
                        return (
                          <div key={slot.key} className="space-y-1">
                            {photo ? (
                              <div className="aspect-square rounded-2xl overflow-hidden relative shadow-sm border border-emerald-200">
                                <img src={photo.url} className="w-full h-full object-cover" />
                                <button
                                  onClick={() => handleClearSlot(slot.key)}
                                  className="absolute top-1.5 right-1.5 bg-white/90 text-red-500 rounded-full p-1 shadow-sm"
                                >
                                  <X size={12} />
                                </button>
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                                  <p className="text-[10px] font-bold text-white truncate">{slot.label}</p>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setActiveSlot(slot.key); slotInputRef.current?.click(); }}
                                className="w-full aspect-square rounded-2xl border-2 border-dashed border-blue-200 flex flex-col items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors bg-blue-50/30 px-1 text-center"
                              >
                                <Camera size={20} />
                                <span className="text-[11px] font-bold mt-1 leading-tight">{slot.label}</span>
                                <span className="text-[9px] text-blue-400 mt-0.5 leading-tight line-clamp-2">{slot.hint}</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <input
                      ref={slotInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleSlotCapture}
                    />

                    {/* Optional damage close-ups */}
                    <div className="mt-4">
                      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                        เพิ่มภาพรอย/จุดเสียหาย (ถ้ามี)
                      </p>
                      <div className="grid grid-cols-3 gap-3">
                        {damagePhotos.map((p, i) => (
                          <div key={i} className="aspect-square rounded-2xl overflow-hidden relative shadow-sm border border-amber-200">
                            <img src={p.url} className="w-full h-full object-cover" />
                            <button
                              onClick={() => handleClearDamage(i)}
                              className="absolute top-1.5 right-1.5 bg-white/90 text-red-500 rounded-full p-1 shadow-sm"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => damageInputRef.current?.click()}
                          className="aspect-square rounded-2xl border-2 border-dashed border-amber-200 flex flex-col items-center justify-center text-amber-500 hover:bg-amber-50 transition-colors bg-amber-50/30"
                        >
                          <Camera size={20} />
                          <span className="text-[11px] font-bold mt-1">เพิ่มภาพรอย</span>
                        </button>
                      </div>
                      <input
                        ref={damageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleDamageCapture}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Checklist */}
              <div>
                <label className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <ListChecks size={16} className="text-purple-500" /> เช็คลิสต์สภาพเครื่อง
                </label>
                {devicesList[activeDeviceIndex]?.isNewDevice ? (
                  <div className="bg-blue-50 border border-blue-200 p-6 rounded-2xl text-center shadow-sm">
                    <PackageOpen size={36} className="text-blue-500 mx-auto mb-3 animate-pulse" />
                    <h4 className="font-bold text-blue-800 text-base mb-1">เครื่องใหม่มือ 1 (Brand New)</h4>
                    <p className="text-xs text-blue-600 font-medium leading-relaxed">
                      รายการนี้เป็นเครื่องใหม่ยังไม่แกะซีล<br />ไม่ต้องทำรายการเช็คลิสต์สภาพตัวเครื่อง<br />
                      <strong className="text-blue-800 mt-2 block bg-white p-2 rounded-lg border border-blue-100">กรุณาถ่ายรูปกล่อง ซีลพลาสติก และเลข IMEI ให้ชัดเจน</strong>
                    </p>
                  </div>
                ) : activeChecklist.length > 0 ? (
                  activeChecklist.map((group: any) => (
                    <div key={group.id} className="mb-4">
                      <h4 className="text-sm font-medium text-gray-600 mb-2 pl-1">{group.title}</h4>
                      <div className="space-y-2">
                        {group.options?.map((opt: any) => {
                          const isChecked = checks.includes(opt.id);
                          const currentDevice = devicesList[activeDeviceIndex];
                          const startingPrice = getBasePrice(currentDevice);

                          const displayDeduct = resolveOptionDeduction(opt, startingPrice, getLiquidityFactor(currentDevice));

                          return (
                            <button
                              key={opt.id}
                              onClick={() => {
                                setChecks((prev) => {
                                  const optionsInThisGroup = group.options.map((o: any) => o.id);
                                  const otherChecks = prev.filter((id: string) => !optionsInThisGroup.includes(id));
                                  return isChecked ? otherChecks : [...otherChecks, opt.id];
                                });
                              }}
                              className={`w-full p-4 rounded-2xl border text-left flex justify-between items-center transition-all ${isChecked ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300'}`}
                            >
                              <div>
                                <div className={`font-semibold text-sm mb-1 ${isChecked ? 'text-red-700' : 'text-gray-800'}`}>{opt.label}</div>
                                <div className="text-xs font-medium text-red-500 bg-red-100/50 px-2 py-0.5 rounded-md w-fit">
                                  หัก {formatCurrency(displayDeduct)}
                                </div>
                              </div>
                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isChecked ? 'bg-red-500 border-red-500 text-white' : 'border-gray-300'}`}>
                                {isChecked && <CheckCircle2 size={16} strokeWidth={3} />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-2xl border-dashed border-2 border-gray-200">
                    <ShieldCheck size={24} className="text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500 font-medium">ไม่มีชุดคำถามสำหรับรุ่นนี้</p>
                  </div>
                )}
              </div>

              <div className="pt-2">
                {!allRequiredSlotsFilled && (
                  <p className="text-center text-xs text-amber-600 font-medium mb-2">
                    เหลืออีก {requiredCountForActive - filledSlotCount} {activeDeviceIsNew ? 'รูปกล่อง' : 'ด้าน'} — บันทึกไม่ได้จนกว่าจะครบ
                  </p>
                )}
                <button
                  onClick={saveDeviceInspection}
                  disabled={!allRequiredSlotsFilled}
                  className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold text-lg shadow-xl active:scale-95 transition-all flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  บันทึกเครื่องนี้
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
