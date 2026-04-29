// src/features/trade-in/components/qc/InternalQCModal.tsx
import React, { useState, useRef, useMemo } from 'react';
import {
    X, CheckCircle2, Smartphone, Camera, ChevronLeft,
    ListChecks, Upload, PackageOpen, ShieldCheck, AlertTriangle, Info, Loader2
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../../../api/firebase';
import { uploadImageToFirebase } from '../../../../utils/uploadImage';
import { formatCurrency } from '../../../../utils/formatters';
import { useToast } from '../../../../components/ui/ToastProvider';

interface InternalQCModalProps {
    isOpen: boolean;
    onClose: () => void;
    job: any;
    modelsData: any[];
    conditionSets?: any[]; 
}

// 🌟 ฟังก์ชันช่วยแสดงชื่อรุ่นพร้อมความจุ
const getDeviceDisplayName = (device: any) => {
    const cap = device.capacity || device.storage || '';
    return `${device.model || 'Unknown Device'} ${cap ? `(${cap})` : ''}`.trim();
};

export const InternalQCModal = ({ isOpen, onClose, job, modelsData, conditionSets }: InternalQCModalProps) => {
    const toast = useToast();
    const [activeDeviceIndex, setActiveDeviceIndex] = useState<number | null>(null);
    const [inspectedDevicesData, setInspectedDevicesData] = useState<Record<number, any>>({});
    const [checks, setChecks] = useState<string[]>([]);
    const [photos, setPhotos] = useState<string[]>([]);
    const [photoFiles, setPhotoFiles] = useState<File[]>([]);
    const [isUploadingQC, setIsUploadingQC] = useState(false);

    const [newDeviceStatus, setNewDeviceStatus] = useState<'perfect' | 'opened_not_act' | 'opened_act_today' | 'convert_to_used'>('perfect');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const devicesList = useMemo(() => {
        if (!job) return [];
        if (job.devices && Array.isArray(job.devices) && job.devices.length > 0) return job.devices;
        
        const fallbackPrice = job.original_price || job.price || job.final_price || 0;
        
        return [{
            device_id: 'default',
            model: job.model || 'Unknown Device',
            capacity: job.capacity || job.storage || '', // 🌟 ดึงความจุมาด้วย
            estimated_price: fallbackPrice, 
            isNewDevice: job.assessment_details?.isNewDevice || job.isNewDevice || false,
            rules: job.rules || job.assessment_details?.rules // 🌟 ดึง rules ที่อาจจะแนบมาตอนสร้างออเดอร์
        }];
    }, [job]);

    // 🌟 THE FIX: ดึง Checklist จาก Condition Sets Engine ผ่าน conditionSetId ของ model
    const activeChecklist = useMemo(() => {
        if (activeDeviceIndex === null) return [];
        const activeDevice = devicesList[activeDeviceIndex];

        // 1. พยายามดึง Rules จากตัวเครื่องก่อน (Snapshot ตอนลูกค้าทำรายการ)
        let rulesSource = activeDevice.rules || job.rules || job.assessment_details?.rules;

        // 2. ถ้าไม่มี ให้ไปค้นหา model จาก modelsData แล้วดึง conditionSetId
        if (!rulesSource && modelsData && modelsData.length > 0) {
            const cleanDeviceModel = (activeDevice.model || '').replace(/\s+\d+(GB|TB).*$/i, '').trim().toLowerCase();
            const targetModel = modelsData.find(m => {
                const mName = (m.name || '').toLowerCase();
                return mName === cleanDeviceModel || cleanDeviceModel.includes(mName) || mName.includes(cleanDeviceModel);
            });

            // 2a. ถ้า model มี rules แบบเดิม ใช้ได้เลย
            if (targetModel && targetModel.rules) {
                rulesSource = targetModel.rules;
            }

            // 2b. ถ้าไม่มี rules แต่มี conditionSetId → ดึงจาก conditionSets
            if (!rulesSource && targetModel?.conditionSetId && conditionSets && conditionSets.length > 0) {
                const matchedSet = conditionSets.find(cs => cs.id === targetModel.conditionSetId);
                if (matchedSet?.groups && Array.isArray(matchedSet.groups)) {
                    // Match the customer-side tier ladder so admin's
                    // deduction values agree with what the customer was
                    // quoted (otherwise t1 always wins and devices priced
                    // <30k get over-deducted at QC).
                    const tierBase = Number(activeDevice.base_price || activeDevice.estimated_price || 0);
                    const pickTier = (opt: any): number => {
                        if (tierBase >= 30000) return Number(opt.t1 || 0);
                        if (tierBase >= 15000) return Number(opt.t2 || 0);
                        return Number(opt.t3 || 0);
                    };
                    return matchedSet.groups
                        .filter((g: any) => g && g.options && Array.isArray(g.options) && g.options.length > 0)
                        .map((group: any) => ({
                            id: group.id || `g_${Math.random().toString(36).slice(2, 8)}`,
                            title: group.title || 'หัวข้อประเมิน',
                            options: group.options.map((opt: any, idx: number) => ({
                                id: opt.id || `${group.id}_opt_${idx}`,
                                label: opt.label || opt.name || 'ไม่มีชื่อตำหนิ',
                                deduction: pickTier(opt),
                            })),
                        }));
                }
            }
        }

        if (!rulesSource) return [];

        const groups: any[] = [];
        const tiers = [
            { key: 't1', title: 'สภาพหน้าจอ และ ตัวเครื่อง' },
            { key: 't2', title: 'ประสิทธิภาพแบตเตอรี่' },
            { key: 't3', title: 'ประสิทธิภาพการทำงาน' },
            { key: 't4', title: 'อุปกรณ์เสริม (ถ้ามี)' }
        ];

        tiers.forEach(tier => {
            const rulesInTier = rulesSource[tier.key] || rulesSource[tier.key.toUpperCase()];
            if (rulesInTier && Array.isArray(rulesInTier) && rulesInTier.length > 0) {
                groups.push({
                    id: tier.key,
                    title: tier.title,
                    options: rulesInTier.map((rule: any, idx: number) => ({
                        id: `${tier.key}_${idx}`,
                        label: rule.label || rule.name || rule.condition || rule.title || 'ไม่มีชื่อตำหนิ',
                        deduction: Number(rule.deduction || rule.value || rule.price || rule.amount || 0)
                    }))
                });
            }
        });

        return groups;
    }, [activeDeviceIndex, devicesList, modelsData, conditionSets, job]);

    if (!isOpen || !job) return null;

    const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            setPhotoFiles(prev => [...prev, ...files]);
            setPhotos(prev => [...prev, ...files.map(f => URL.createObjectURL(f))]);
        }
    };

    const saveDeviceInspection = () => {
        if (activeDeviceIndex === null) return;
        const activeDevice = devicesList[activeDeviceIndex];
        // Used-device QC must start from base_price (the full pre-deduction
        // price), not estimated_price (which is already net of the customer's
        // self-assessed deductions). Subtracting admin's deductions on top of
        // estimated_price double-counts every condition the customer also
        // marked, dropping the final quote even when the conditions match.
        // For new devices the customer flow only applies a small
        // hasReceipt deduction, so estimated_price is the correct
        // starting point — the new_status deductions below are an
        // independent axis that doesn't overlap.
        let finalPrice = activeDevice.isNewDevice
            ? Number(activeDevice.estimated_price || activeDevice.base_price || 0)
            : Number(activeDevice.base_price || activeDevice.estimated_price || 0);
        let deductionLabels: string[] = [];

        if (activeDevice.isNewDevice) {
            if (newDeviceStatus === 'perfect') {
                deductionLabels.push("[สภาพสินค้า] เครื่องใหม่มือ 1 (ตรวจสอบซีลและกล่องสมบูรณ์)");
            } else if (newDeviceStatus === 'opened_not_act') {
                finalPrice -= 1000;
                deductionLabels.push("[สภาพสินค้า] แกะซีลแล้ว แต่ยังไม่ Activated (หัก 1,000)");
            } else if (newDeviceStatus === 'opened_act_today') {
                finalPrice -= 2000;
                deductionLabels.push("[สภาพสินค้า] แกะซีลแล้ว และ Activated วันนี้ (หัก 2,000)");
            } else if (newDeviceStatus === 'convert_to_used') {
                finalPrice -= 3500;
                deductionLabels.push("[สภาพสินค้า] สภาพเครื่องมือสอง/ประกันเดินนานแล้ว (ตีเป็นมือสองเกรด A)");
            }
        } else {
            activeChecklist.forEach((group: any) => group.options?.forEach((opt: any) => {
                if (checks.includes(opt.id)) {
                    deductionLabels.push(`[${group.title}] ${opt.label}`);
                }
            }));

            const deductionTotal = activeChecklist.reduce((acc: number, group: any) =>
                acc + (group.options?.reduce((sum: number, opt: any) =>
                    checks.includes(opt.id) ? sum + Number(opt.deduction || 0) : sum, 0) || 0), 0);

            finalPrice = Math.max(0, finalPrice - deductionTotal);
        }

        setInspectedDevicesData(prev => ({
            ...prev, [activeDeviceIndex]: {
                checks: [...checks],
                photos: [...photos],
                photoFiles: [...photoFiles],
                deductions: deductionLabels,
                final_price: finalPrice,
                new_status: activeDevice.isNewDevice ? newDeviceStatus : null
            }
        }));
        setActiveDeviceIndex(null);
        setChecks([]); setPhotos([]); setPhotoFiles([]); setNewDeviceStatus('perfect');
    };

    const submitAllInspections = async () => {
        setIsUploadingQC(true);
        try {
            const updatedDevices = devicesList.map((device: any, index: number) => {
                const data = inspectedDevicesData[index];
                if (data) {
                    return {
                        ...device,
                        inspection_status: "Inspected",
                        deductions: data.deductions,
                        final_price: data.final_price,
                        internal_qc_status: data.new_status || 'used',
                        temp_photo_files: data.photoFiles
                    };
                }
                return device;
            });

            let totalFinalPrice = 0;

            for (let i = 0; i < updatedDevices.length; i++) {
                const device = updatedDevices[i];
                if (device.temp_photo_files && device.temp_photo_files.length > 0) {
                    const urls = await Promise.all(
                        device.temp_photo_files.map((f: File) =>
                            uploadImageToFirebase(f, `jobs/${job.id}/qc/device_${i}`)
                        )
                    );
                    updatedDevices[i].photos = urls;
                }
                delete updatedDevices[i].temp_photo_files;
                totalFinalPrice += Number(updatedDevices[i].final_price || updatedDevices[i].estimated_price || 0);
            }

            // Sync net_payout ให้ตรงกับ final_price ใหม่ — กันค่าเก่าค้างใน DB ที่หน้า Finance จะไปหยิบไปแสดง
            const pickupFee = job.receive_method === 'Pickup' ? Number(job.pickup_fee || 0) : 0;
            const couponValue = Number(job.applied_coupon?.actual_value || job.applied_coupon?.value || 0);
            const newNetPayout = Math.max(0, totalFinalPrice - pickupFee + couponValue);

            const updatePayload = {
                status: 'QC Review',
                devices: updatedDevices,
                final_price: totalFinalPrice,
                net_payout: newNetPayout,
                inspected_at: Date.now(),
                updated_at: Date.now(),
                deductions: updatedDevices[0].deductions || [],
                inspection_status: "Inspected",
                qc_logs: [
                    { action: 'Internal QC Completed', by: 'Admin/QC', timestamp: Date.now(), details: 'ตรวจสอบสภาพเครื่องและหักราคาตำหนิเสร็จสิ้น เข้าสู่ขั้นตอนการสรุปราคา' },
                    ...(job.qc_logs || [])
                ]
            };

            await update(ref(db, `jobs/${job.id}`), updatePayload);
            Object.assign(job, updatePayload);
            onClose(); 
        } catch (error) {
            console.error(error);
            toast.error('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        } finally {
            setIsUploadingQC(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[150] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-xl h-[85vh] rounded-[3rem] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">

                {activeDeviceIndex === null ? (
                    <div className="flex flex-col h-full">
                        <div className="bg-slate-900 text-white p-8 flex justify-between items-center">
                            <div><h3 className="text-xl font-black uppercase tracking-tight">Internal QC Process</h3><p className="text-xs text-slate-400 mt-1">เครื่องในรายการ: {devicesList.length} เครื่อง</p></div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full transition-colors"><X /></button>
                        </div>
                        <div className="p-8 flex-1 overflow-y-auto bg-slate-50 space-y-4">
                            {devicesList.map((device: any, idx: number) => (
                                <div key={idx} className={`p-5 rounded-3xl border-2 flex justify-between items-center transition-all ${inspectedDevicesData[idx] ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200 shadow-sm'}`}>
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-2xl ${inspectedDevicesData[idx] ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                                            {device.isNewDevice ? <PackageOpen size={24} /> : <Smartphone size={24} />}
                                        </div>
                                        <div>
                                            {/* 🌟 แสดงชื่อรุ่น + ความจุ */}
                                            <p className="font-bold text-slate-800">{getDeviceDisplayName(device)}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className={`text-[9px] font-black px-2 py-0.5 rounded ${device.isNewDevice ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-500'}`}>
                                                    {device.isNewDevice ? 'NEW DEVICE' : 'USED DEVICE'}
                                                </span>
                                                <p className={`text-[10px] font-black uppercase ${inspectedDevicesData[idx] ? 'text-emerald-500' : 'text-slate-400'}`}>
                                                    {inspectedDevicesData[idx] ? '✓ ตรวจแล้ว' : 'รอตรวจสอบ'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setActiveDeviceIndex(idx)} className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${inspectedDevicesData[idx] ? 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50' : 'bg-slate-900 text-white hover:bg-black'}`}>
                                        {inspectedDevicesData[idx] ? 'แก้ไข' : 'เริ่มตรวจ (Start)'}
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="p-8 bg-white border-t border-slate-100">
                            <button 
                                onClick={submitAllInspections} 
                                disabled={Object.keys(inspectedDevicesData).length !== devicesList.length || isUploadingQC} 
                                className={`w-full py-5 rounded-2xl font-black shadow-xl transition-all active:scale-[0.98] flex justify-center items-center gap-2 ${
                                    Object.keys(inspectedDevicesData).length === devicesList.length && !isUploadingQC
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200' 
                                    : 'bg-slate-200 text-slate-400 shadow-none cursor-not-allowed'
                                }`}
                            >
                                {isUploadingQC ? <><Loader2 size={18} className="animate-spin" /> กำลังบันทึกและอัปโหลดรูป...</> : 'สรุปผลและส่งรายงาน QC'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col h-full">
                        <div className="p-6 bg-white border-b flex items-center gap-4">
                            <button onClick={() => setActiveDeviceIndex(null)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-all"><ChevronLeft size={20} /></button>
                            <div>
                                {/* 🌟 แสดงชื่อรุ่น + ความจุ ในหน้าตรวจย่อย */}
                                <h3 className="font-black text-slate-800 uppercase tracking-tight">{getDeviceDisplayName(devicesList[activeDeviceIndex])}</h3>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">การตรวจสอบสภาพเครื่อง (QC)</p>
                            </div>
                        </div>
                        <div className="p-8 flex-1 overflow-y-auto bg-slate-50 space-y-8 no-scrollbar">

                            <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><Camera size={14} /> แนบรูปถ่ายอ้างอิง</label>
                                <div className="grid grid-cols-4 gap-3">
                                    {photos.map((p, i) => <div key={i} className="aspect-square rounded-2xl overflow-hidden border border-slate-200 shadow-sm"><img src={p} className="w-full h-full object-cover" /></div>)}
                                    <button onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/30 text-blue-500 flex flex-col items-center justify-center gap-1 hover:bg-blue-50 transition-all"><Upload size={20} /><span className="text-[8px] font-bold uppercase">Add Photo</span></button>
                                </div>
                                <input type="file" multiple accept="image/*" className="hidden" ref={fileInputRef} onChange={handleCapture} />
                                <p className="text-[9px] text-slate-400 mt-4 font-medium flex items-center gap-1"><Info size={10} /> ควรถ่ายรูปรอบเครื่องและจุดที่มีตำหนิเพื่อเป็นหลักฐานอ้างอิง</p>
                            </div>

                            {devicesList[activeDeviceIndex].isNewDevice ? (
                                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm space-y-4">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-purple-500 mb-2 flex items-center gap-2"><ShieldCheck size={14} /> New Device Verification</label>
                                    <div className="space-y-3">
                                        <button onClick={() => setNewDeviceStatus('perfect')} className={`w-full p-5 rounded-2xl border-2 flex justify-between items-center transition-all ${newDeviceStatus === 'perfect' ? 'bg-emerald-50 border-emerald-500 shadow-md' : 'bg-slate-50 border-slate-100'}`}>
                                            <div className="text-left"><p className="text-sm font-black text-slate-800 uppercase">ซีลสมบูรณ์ 100%</p><p className="text-[10px] text-emerald-600 font-bold">ตรงตามที่ลูกค้าแจ้ง (ไม่หักเงิน)</p></div>
                                            {newDeviceStatus === 'perfect' && <CheckCircle2 className="text-emerald-500" />}
                                        </button>

                                        <button onClick={() => setNewDeviceStatus('opened_not_act')} className={`w-full p-5 rounded-2xl border-2 flex justify-between items-center transition-all ${newDeviceStatus === 'opened_not_act' ? 'bg-amber-50 border-amber-500 shadow-md' : 'bg-slate-50 border-slate-100'}`}>
                                            <div className="text-left"><p className="text-sm font-black text-slate-800 uppercase">แกะซีลแล้ว / ยังไม่ Activate</p><p className="text-[10px] text-amber-600 font-bold">หักออก {formatCurrency(1000)}</p></div>
                                            {newDeviceStatus === 'opened_not_act' && <CheckCircle2 className="text-amber-500" />}
                                        </button>

                                        <button onClick={() => setNewDeviceStatus('opened_act_today')} className={`w-full p-5 rounded-2xl border-2 flex justify-between items-center transition-all ${newDeviceStatus === 'opened_act_today' ? 'bg-orange-50 border-orange-200 shadow-md' : 'bg-slate-50 border-slate-100'}`}>
                                            <div className="text-left"><p className="text-sm font-black text-slate-800 uppercase">แกะซีลแล้ว / Activate วันนี้</p><p className="text-[10px] text-orange-600 font-bold">หักออก {formatCurrency(2000)}</p></div>
                                            {newDeviceStatus === 'opened_act_today' && <CheckCircle2 className="text-orange-500" />}
                                        </button>

                                        <div className="pt-4 border-t border-dashed border-slate-200 mt-4">
                                            <button onClick={() => setNewDeviceStatus('convert_to_used')} className={`w-full p-5 rounded-2xl border-2 flex justify-between items-center transition-all ${newDeviceStatus === 'convert_to_used' ? 'bg-red-50 border-red-500 shadow-md' : 'bg-red-50/30 border-red-100'}`}>
                                                <div className="text-left"><p className="text-sm font-black text-red-700 uppercase">เป็นเครื่องมือสอง / ประกันเดินแล้ว</p><p className="text-[10px] text-red-500 font-bold">หักตามสภาพมือสอง เกรด A</p></div>
                                                <AlertTriangle className="text-red-500" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><ListChecks size={14} /> Fault Checklist (ตำหนิที่ตรวจพบ)</label>
                                    
                                    {activeChecklist.length > 0 ? (
                                        activeChecklist.map((group: any) => (
                                            <div key={group.id} className="mb-6 last:mb-0">
                                                <p className="text-xs font-black text-slate-700 mb-3 bg-slate-100 px-3 py-1.5 rounded-lg inline-block">{group.title}</p>
                                                <div className="space-y-2">
                                                    {group.options.map((opt: any) => (
                                                        <button 
                                                            key={opt.id} 
                                                            onClick={() => setChecks(prev => checks.includes(opt.id) ? prev.filter(id => id !== opt.id) : [...prev, opt.id])} 
                                                            className={`w-full p-4 rounded-xl border text-left flex justify-between items-center transition-all ${checks.includes(opt.id) ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-slate-50 border-slate-100 hover:border-slate-300'}`}
                                                        >
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-800">{opt.label}</p>
                                                                {opt.deduction > 0 && (
                                                                    <p className="text-[10px] text-red-500 font-black mt-0.5">หักเงิน -{formatCurrency(opt.deduction)}</p>
                                                                )}
                                                            </div>
                                                            {checks.includes(opt.id) && <CheckCircle2 className="text-red-500" size={18} />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                            <AlertTriangle size={24} className="mx-auto mb-2 opacity-50" />
                                            <p className="text-sm font-bold text-slate-500">ไม่มีข้อมูล Checklists สำหรับเครื่องรุ่นนี้</p>
                                            <p className="text-[10px] mt-1">โปรดตรวจสอบการตั้งค่า Engine Rules ในหน้า Price Editor</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="p-8 bg-white border-t border-slate-100">
                            <button onClick={saveDeviceInspection} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all">
                                บันทึกผลตรวจเครื่องนี้ (Save Device)
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};