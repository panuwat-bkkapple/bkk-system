// src/pages/mobile/MobileQCStation.tsx
// QC Lab Station ฉบับมือถือ (/mobile/qc) — ให้ทีม QC ตรวจเครื่อง + ถ่ายรูปสภาพ
// จากมือถือได้เลย ไม่ต้องไปคอขวดที่ desktop. logic การบันทึกทั้งหมดใช้ util กลาง
// src/utils/qcStation.ts ตัวเดียวกับหน้า desktop (/qc-station) — ห้าม fork logic
import React, { useState, useMemo, useRef } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../hooks/useAuth';
import {
   ClipboardCheck, Search, ChevronLeft, Camera, ImagePlus, X, Save,
   Cpu, Lock, Eraser, AlertTriangle, FileText, Smartphone, ListFilter, CheckSquare,
} from 'lucide-react';
import { SickwGateBanner } from '../../components/sickw/SickwGateBanner';
import { SickwStoredResultCard } from '../../components/sickw/SickwStoredResultCard';
import { SickwDeviceCheck } from '../../components/sickw/SickwDeviceCheck';
import { getSickwGateStatus, type SickwParsedFields } from '../../utils/sickwApi';
import {
   MAX_QC_PHOTOS, QC_SUPERVISORS, canSubmitQc, selectQcTodoList, selectQcDoneList,
   buildQcFormFromJob, validateQcSubmit, submitQcStation, saveQcPhotosOnly,
   type QcFormState,
} from '../../utils/qcStation';

const HW_CHECKS: { id: keyof QcFormState; label: string }[] = [
   { id: 'screen_touch', label: 'ทัชสกรีน' },
   { id: 'screen_display', label: 'จอแสดงผล' },
   { id: 'truetone', label: 'TrueTone / เซนเซอร์ Face ID' },
   { id: 'faceid', label: 'Face ID / Touch ID' },
   { id: 'camera_front', label: 'กล้องหน้า + ไมค์' },
   { id: 'camera_rear', label: 'กล้องหลัง + แฟลช' },
   { id: 'speaker_mic', label: 'ลำโพง / ไมโครโฟน' },
   { id: 'wifi_bt', label: 'WiFi / Bluetooth / GPS' },
   { id: 'buttons', label: 'ปุ่มกดทั้งหมด' },
   { id: 'charging', label: 'พอร์ตชาร์จ' },
];

export const MobileQCStation = () => {
   const toast = useToast();
   const { currentUser } = useAuth();
   const { data: jobs, loading } = useDatabase('jobs');

   const [searchTerm, setSearchTerm] = useState('');
   const [activeTab, setActiveTab] = useState<'todo' | 'done'>('todo');
   const [selectedJob, setSelectedJob] = useState<any>(null);
   const [supervisor, setSupervisor] = useState(QC_SUPERVISORS[0]);
   const [accessorySerials, setAccessorySerials] = useState<Record<string, string>>({});
   const [qcForm, setQcForm] = useState<QcFormState | null>(null);
   const [submitting, setSubmitting] = useState(false);

   // รูปสภาพเครื่อง — โครงเดียวกับ desktop (jobs/{id}/qc_photos)
   const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
   const [photoFiles, setPhotoFiles] = useState<File[]>([]);
   const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
   const [savingPhotos, setSavingPhotos] = useState(false);
   const cameraInputRef = useRef<HTMLInputElement>(null);
   const galleryInputRef = useRef<HTMLInputElement>(null);

   const { todoList, doneList } = useMemo(() => {
      const list = Array.isArray(jobs) ? jobs : [];
      const q = searchTerm.toLowerCase();
      const filtered = list.filter(j =>
         j.model?.toLowerCase().includes(q) ||
         j.ref_no?.toLowerCase().includes(q) ||
         j.serial?.toLowerCase().includes(q) ||
         j.stock_no?.toLowerCase().includes(q) ||
         j.qc_txn_id?.toLowerCase().includes(q)
      );
      // To Do / Done ตัดสินใน utils/qcStation.ts ตัวเดียวกับ desktop (normalizeStatus
      // ทั้งสองฝั่ง — รับทั้ง 'Sent To QC Lab' ที่ engine เขียนและ 'Sent to QC Lab' แถวเก่า)
      return {
         todoList: selectQcTodoList(filtered),
         doneList: selectQcDoneList(filtered),
      };
   }, [jobs, searchTerm]);

   const liveJob = useMemo(() => {
      if (!selectedJob) return null;
      const list = Array.isArray(jobs) ? jobs : [];
      return list.find((j) => j.id === selectedJob.id) || selectedJob;
   }, [jobs, selectedJob]);

   const handleOpen = (job: any) => {
      setSelectedJob(job);
      setQcForm(buildQcFormFromJob(job));
      setExistingPhotos(Array.isArray(job.qc_photos) ? job.qc_photos.filter(Boolean) : []);
      photoPreviews.forEach(u => URL.revokeObjectURL(u));
      setPhotoFiles([]);
      setPhotoPreviews([]);
      setAccessorySerials(Object.fromEntries(
         (Array.isArray(job.accessory_items) ? job.accessory_items : [])
            .filter(Boolean)
            .map((it: any, i: number) => [it.id || String(i), it.serial || ''])
      ));
   };

   const handleClose = () => {
      photoPreviews.forEach(u => URL.revokeObjectURL(u));
      setPhotoFiles([]);
      setPhotoPreviews([]);
      setSelectedJob(null);
      setQcForm(null);
   };

   const applySickwToForm = (parsed: SickwParsedFields) => {
      setQcForm(prev => prev ? ({
         ...prev,
         actual_serial: parsed.serial || prev.actual_serial,
         actual_imei: parsed.imei || prev.actual_imei,
         actual_color: parsed.color || prev.actual_color,
         capacity: parsed.capacity || prev.capacity,
         model_code: parsed.modelNumber || prev.model_code,
      }) : prev);
      toast.success('เติมข้อมูลจากผลตรวจ IMEI แล้ว');
   };

   const handlePickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;
      const room = MAX_QC_PHOTOS - existingPhotos.length - photoFiles.length;
      if (room <= 0) { toast.warning(`เพิ่มรูปได้สูงสุด ${MAX_QC_PHOTOS} รูปต่อเครื่อง`); return; }
      const accepted = files.slice(0, room);
      if (accepted.length < files.length) toast.warning(`เพิ่มได้อีก ${room} รูป — ตัดส่วนเกินออก`);
      setPhotoFiles(prev => [...prev, ...accepted]);
      setPhotoPreviews(prev => [...prev, ...accepted.map(f => URL.createObjectURL(f))]);
   };

   const removeExistingPhoto = (url: string) => setExistingPhotos(prev => prev.filter(u => u !== url));
   const removeNewPhoto = (index: number) => {
      URL.revokeObjectURL(photoPreviews[index]);
      setPhotoFiles(prev => prev.filter((_, i) => i !== index));
      setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
   };

   const savedPhotos: string[] = Array.isArray(liveJob?.qc_photos) ? liveJob.qc_photos : [];
   const photosDirty = photoFiles.length > 0 || existingPhotos.length !== savedPhotos.length;

   const handleSavePhotosOnly = async () => {
      if (!selectedJob || savingPhotos) return;
      setSavingPhotos(true);
      try {
         const saved = await saveQcPhotosOnly(selectedJob, existingPhotos, photoFiles, (msg) => toast.info(msg));
         photoPreviews.forEach(u => URL.revokeObjectURL(u));
         setPhotoFiles([]);
         setPhotoPreviews([]);
         setExistingPhotos(saved);
         toast.success(`บันทึกรูปแล้ว (${saved.length} รูป)`);
      } catch (e) { toast.error('บันทึกรูปไม่สำเร็จ: ' + e); }
      finally { setSavingPhotos(false); }
   };

   const handleSubmit = async () => {
      if (!qcForm || !selectedJob || submitting) return;
      const error = validateQcSubmit(qcForm, liveJob);
      if (error) { toast.warning(error); return; }
      if (!confirm('ยืนยันผลการตรวจสอบอุปกรณ์?')) return;
      setSubmitting(true);
      try {
         const { nextStatus, qcTxnId, unpackedAccessories } = await submitQcStation({
            job: selectedJob, liveJob, qcForm, supervisor, accessorySerials,
            existingPhotos, photoFiles,
            onProgress: (msg) => toast.info(msg),
         });
         if (nextStatus === 'QC Review') {
            toast.success(`บันทึกผลสำเร็จ! ส่งให้ Admin เคาะราคาแล้ว (TXN: ${qcTxnId})`);
         } else {
            toast.success(`บันทึกสำเร็จ! ส่งสินค้าเข้าคลังแล้ว (TXN: ${qcTxnId})`);
            if (unpackedAccessories > 0) toast.success(`แตกอุปกรณ์เสริม ${unpackedAccessories} ชิ้นเข้าสต๊อกแล้ว`);
         }
         handleClose();
      } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e); }
      finally { setSubmitting(false); }
   };

   if (loading) return <div className="p-10 text-center text-slate-400 font-bold animate-pulse">กำลังโหลด QC Lab...</div>;

   // ---------- ฟอร์มตรวจ (เปิดทับเต็มจอ รวม bottom nav) ----------
   if (selectedJob && qcForm) {
      const gate = getSickwGateStatus(liveJob?.sickw_check);
      const canSubmit = canSubmitQc(selectedJob);
      const totalPhotos = existingPhotos.length + photoFiles.length;
      return (
         <div className="fixed inset-0 z-[60] bg-[#F5F5F7] flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-3 py-3 flex items-center gap-2 shrink-0 safe-top">
               <button onClick={handleClose} className="p-1 text-slate-500"><ChevronLeft size={24} /></button>
               <div className="min-w-0 flex-1">
                  <h1 className="text-sm font-black text-slate-800 truncate">{selectedJob.model}</h1>
                  <p className="text-[10px] font-mono font-bold text-slate-400">{selectedJob.ref_no} · {selectedJob.status}</p>
               </div>
               <select value={supervisor} onChange={e => setSupervisor(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none max-w-[130px]">
                  {QC_SUPERVISORS.map(s => <option key={s} value={s}>{s}</option>)}
               </select>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5 pb-6">
               <SickwGateBanner
                  jobId={selectedJob.id}
                  sickwCheck={liveJob?.sickw_check}
                  gate={gate}
                  currentRole={currentUser?.role}
               />

               {/* รูปสภาพเครื่อง — หัวใจของหน้านี้ ถ่ายจากกล้องมือถือได้ตรงๆ */}
               <section className="bg-white rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                     <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Camera size={14} /> รูปสภาพเครื่อง
                        <span className="text-slate-300">{totalPhotos}/{MAX_QC_PHOTOS}</span>
                     </h3>
                     {photosDirty && (
                        <button type="button" onClick={handleSavePhotosOnly} disabled={savingPhotos}
                           className={`flex items-center gap-1 px-3 py-1.5 rounded-lg font-black text-[11px] transition-all ${savingPhotos ? 'bg-slate-200 text-slate-400' : 'bg-blue-600 text-white active:scale-95'}`}>
                           <Save size={12} /> {savingPhotos ? 'กำลังบันทึก...' : 'บันทึกรูป'}
                        </button>
                     )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                     {existingPhotos.map((url) => (
                        <div key={url} className="relative aspect-square">
                           <img src={url} alt="รูปสภาพเครื่อง" loading="lazy" className="w-full h-full object-cover rounded-xl border border-slate-200" />
                           <button type="button" onClick={() => removeExistingPhoto(url)}
                              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-1 shadow"><X size={11} /></button>
                        </div>
                     ))}
                     {photoPreviews.map((url, i) => (
                        <div key={url} className="relative aspect-square">
                           <img src={url} alt={`รูปใหม่ ${i + 1}`} className="w-full h-full object-cover rounded-xl border-2 border-blue-300" />
                           <span className="absolute bottom-1 left-1 bg-blue-600 text-white text-[8px] font-black px-1 py-0.5 rounded uppercase">New</span>
                           <button type="button" onClick={() => removeNewPhoto(i)}
                              className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-1 shadow"><X size={11} /></button>
                        </div>
                     ))}
                  </div>
                  {totalPhotos < MAX_QC_PHOTOS && (
                     <div className="grid grid-cols-2 gap-2 mt-3">
                        <button type="button" onClick={() => cameraInputRef.current?.click()}
                           className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-blue-300 text-blue-600 font-black text-xs active:bg-blue-50">
                           <Camera size={16} /> ถ่ายรูป
                        </button>
                        <button type="button" onClick={() => galleryInputRef.current?.click()}
                           className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 font-black text-xs active:bg-slate-50">
                           <ImagePlus size={16} /> เลือกจากคลัง
                        </button>
                     </div>
                  )}
                  <p className="text-[10px] font-bold text-slate-400 mt-2">
                     ถ่ายรอบตัวเครื่อง (หน้า/หลัง/ขอบ/ตำหนิ) — ดีลเลอร์เห็นชุดนี้ก่อนเสนอราคาเมื่อจัดเข้า Lot
                  </p>
                  {/* capture เปิดกล้องหลังตรงๆ / อีกช่องเลือกหลายรูปจากคลังภาพ */}
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePickPhotos} />
                  <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePickPhotos} />
               </section>

               {/* Identity */}
               <section className="bg-white rounded-2xl border border-slate-200 p-4">
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Smartphone size={14} /> Identity</h3>
                  <div className="grid grid-cols-1 gap-3">
                     <div><label className="text-[10px] font-bold text-slate-400 uppercase">Serial Number</label>
                        <input type="text" value={qcForm.actual_serial} onChange={e => setQcForm({ ...qcForm, actual_serial: e.target.value })}
                           className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                     <div><label className="text-[10px] font-bold text-slate-400 uppercase">IMEI</label>
                        <input type="text" inputMode="numeric" placeholder="Scan IMEI..." value={qcForm.actual_imei} onChange={e => setQcForm({ ...qcForm, actual_imei: e.target.value })}
                           className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                     <div className="grid grid-cols-2 gap-3">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase">สี</label>
                           <input type="text" value={qcForm.actual_color} onChange={e => setQcForm({ ...qcForm, actual_color: e.target.value })} placeholder={selectedJob.color}
                              className="w-full mt-1 p-3 rounded-xl border border-slate-200 text-sm font-bold outline-none" /></div>
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase">ความจุ</label>
                           <input type="text" value={qcForm.capacity} onChange={e => setQcForm({ ...qcForm, capacity: e.target.value })} placeholder={selectedJob.capacity}
                              className="w-full mt-1 p-3 rounded-xl border border-slate-200 text-sm font-bold outline-none" /></div>
                     </div>
                     <div><label className="text-[10px] font-bold text-slate-400 uppercase">Model No. (Part No.)</label>
                        <input type="text" value={qcForm.model_code} onChange={e => setQcForm({ ...qcForm, model_code: e.target.value })} placeholder={selectedJob.model_code || 'MYWV3ZP/A'}
                           className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                  </div>
               </section>

               {/* Sickw check panel + ผลที่เก็บไว้ */}
               <section className="space-y-3">
                  <SickwDeviceCheck
                     key={selectedJob.id}
                     jobId={selectedJob.id}
                     initialImei={qcForm.actual_imei || selectedJob.imei || ''}
                     initialSerial={qcForm.actual_serial || selectedJob.serial || ''}
                     onResult={applySickwToForm}
                  />
                  <SickwStoredResultCard sickwCheck={liveJob?.sickw_check} job={liveJob} />
               </section>

               {/* อุปกรณ์เสริมพ่วง */}
               {Array.isArray(selectedJob.accessory_items) && selectedJob.accessory_items.length > 0 && (
                  <section className="bg-white rounded-2xl border border-indigo-200 p-4">
                     <h3 className="text-[11px] font-black text-indigo-500 uppercase tracking-widest mb-3 flex items-center gap-2"><ClipboardCheck size={14} /> อุปกรณ์เสริมพ่วง ({selectedJob.accessory_items.length})</h3>
                     <div className="space-y-2">
                        {selectedJob.accessory_items.filter(Boolean).map((it: any, i: number) => {
                           const itemKey = it.id || String(i);
                           return (
                              <div key={itemKey} className="bg-indigo-50 rounded-xl px-3 py-2.5">
                                 <div className="flex justify-between items-center gap-2">
                                    <span className="font-black text-xs text-slate-800 truncate">{it.model_name}</span>
                                    <span className="font-black text-xs text-indigo-600 shrink-0">฿{(Number(it.price) || 0).toLocaleString()}</span>
                                 </div>
                                 {selectedJob.accessories_unpacked_at ? (
                                    it.serial && <div className="text-[10px] font-mono font-bold text-slate-400 mt-1">SN: {it.serial}</div>
                                 ) : (
                                    <input type="text" placeholder="Serial (ถ้ามี)"
                                       value={accessorySerials[itemKey] ?? ''}
                                       onChange={e => setAccessorySerials(prev => ({ ...prev, [itemKey]: e.target.value }))}
                                       className="w-full mt-1.5 p-2 rounded-lg border border-indigo-200 font-mono text-xs font-bold outline-none bg-white" />
                                 )}
                              </div>
                           );
                        })}
                     </div>
                  </section>
               )}

               {/* Hardware checks */}
               <section className="bg-white rounded-2xl border border-slate-200 p-4">
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Cpu size={14} /> ตรวจฮาร์ดแวร์</h3>
                  <div className="space-y-2">
                     {HW_CHECKS.map((test) => (
                        <label key={test.id} className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${qcForm[test.id] ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                           <span className="text-xs font-bold text-slate-700">{test.label}</span>
                           <input type="checkbox" checked={qcForm[test.id] as boolean}
                              onChange={e => setQcForm({ ...qcForm, [test.id]: e.target.checked })} className="w-5 h-5 accent-green-600" />
                        </label>
                     ))}
                  </div>
               </section>

               {/* Parts & Grade */}
               <section className="bg-white rounded-2xl border border-slate-200 p-4">
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><AlertTriangle size={14} /> อะไหล่ & เกรด</h3>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                     {['Screen', 'Battery', 'Camera'].map(part => (
                        <div key={part}>
                           <label className="text-[9px] font-black text-slate-400 uppercase">{part}</label>
                           <select value={qcForm[`part_${part.toLowerCase()}` as keyof QcFormState] as string}
                              onChange={e => setQcForm({ ...qcForm, [`part_${part.toLowerCase()}`]: e.target.value })}
                              className="w-full mt-1 p-2 rounded-lg border border-slate-200 font-bold text-[11px] bg-white">
                              <option value="Original">Original</option>
                              <option value="Genuine">Genuine</option>
                              <option value="Unknown">Unknown</option>
                           </select>
                        </div>
                     ))}
                  </div>
                  <div className="mb-3"><label className="text-[10px] font-bold text-slate-400 uppercase">Final Grade</label>
                     <select value={qcForm.final_grade} onChange={e => setQcForm({ ...qcForm, final_grade: e.target.value })}
                        className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-black text-base bg-white">
                        <option value="New">Grade New</option><option value="A">Grade A</option><option value="B">Grade B</option>
                        <option value="C">Grade C</option><option value="D">Grade D</option>
                     </select></div>
                  <div className="grid grid-cols-2 gap-3">
                     <div><label className="text-[10px] font-bold text-slate-400 uppercase">Battery Health %</label>
                        <input type="number" inputMode="numeric" value={qcForm.battery_health} onChange={e => setQcForm({ ...qcForm, battery_health: Number(e.target.value) })}
                           className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold outline-none" /></div>
                     <div><label className="text-[10px] font-bold text-slate-400 uppercase">Cycle Count</label>
                        <input type="number" inputMode="numeric" value={qcForm.cycle_count} onChange={e => setQcForm({ ...qcForm, cycle_count: Number(e.target.value) })}
                           className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold outline-none" /></div>
                  </div>
               </section>

               {/* Security & Erasure */}
               <section className="bg-white rounded-2xl border border-red-200 p-4">
                  <h3 className="text-[11px] font-black text-red-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Lock size={14} /> ความปลอดภัย & ล้างข้อมูล</h3>
                  <div className="space-y-2.5">
                     <label className="flex items-center gap-3"><input type="checkbox" checked={qcForm.icloud_off} onChange={e => setQcForm({ ...qcForm, icloud_off: e.target.checked })} className="w-4 h-4 accent-red-600" /><span className="text-xs font-bold text-slate-700">iCloud / Find My: OFF</span></label>
                     <label className="flex items-center gap-3"><input type="checkbox" checked={qcForm.mdm_clear} onChange={e => setQcForm({ ...qcForm, mdm_clear: e.target.checked })} className="w-4 h-4 accent-red-600" /><span className="text-xs font-bold text-slate-700">MDM Profile: CLEAR</span></label>
                     <label className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 transition-all ${qcForm.data_erased ? 'bg-green-600 text-white border-green-600' : 'bg-white text-red-600 border-red-200'}`}>
                        <Eraser size={18} /><span className="font-black uppercase text-sm">{qcForm.data_erased ? 'Data Wiped' : 'ยืนยันล้างข้อมูลแล้ว'}</span>
                        <input type="checkbox" className="hidden" checked={qcForm.data_erased} onChange={e => setQcForm({ ...qcForm, data_erased: e.target.checked })} />
                     </label>
                  </div>
               </section>

               {/* Notes */}
               <section className="bg-white rounded-2xl border border-slate-200 p-4">
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><FileText size={14} /> หมายเหตุช่าง</h3>
                  <textarea value={qcForm.notes} onChange={e => setQcForm({ ...qcForm, notes: e.target.value })}
                     placeholder="สภาพภายนอก / ตำหนิ / เรื่องที่แอดมินควรรู้..."
                     className="w-full border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-700 outline-none min-h-[80px]" />
               </section>
            </div>

            {/* Footer submit */}
            {canSubmit && (
               <div className="p-4 bg-white border-t border-slate-200 shrink-0 safe-bottom">
                  <button onClick={handleSubmit} disabled={submitting || gate.blocked}
                     className={`w-full py-4 rounded-xl font-black uppercase text-sm shadow-lg flex items-center justify-center gap-2 transition-all ${
                        submitting || gate.blocked ? 'bg-slate-200 text-slate-400' : 'bg-blue-600 text-white active:scale-[0.98]'
                     }`}>
                     {gate.blocked ? (<><AlertTriangle size={18} /> IMEI Gate Block — ต้อง Override</>)
                        : submitting ? 'กำลังบันทึก...'
                        : (() => {
                           const paidOrPickup = selectedJob.receive_method === 'Pickup' ||
                              selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action));
                           return (<><Save size={18} /> {paidOrPickup ? 'ผ่าน QC — เข้าคลัง' : 'ส่งผลให้แอดมินเคาะราคา'}</>);
                        })()}
                  </button>
               </div>
            )}
         </div>
      );
   }

   // ---------- รายการงาน ----------
   const currentList = activeTab === 'todo' ? todoList : doneList;
   return (
      <div className="h-full flex flex-col">
         <div className="p-4 pb-2 space-y-3 shrink-0">
            <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200">
               <Search className="text-slate-400 ml-1" size={18} />
               <input type="text" placeholder="ค้นหา รุ่น / OID / SN..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="bg-transparent outline-none font-bold text-sm flex-1" />
            </div>
            <div className="bg-slate-200 p-1 rounded-xl flex font-bold text-xs">
               <button onClick={() => setActiveTab('todo')} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${activeTab === 'todo' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                  <ListFilter size={13} /> รอตรวจ ({todoList.length})
               </button>
               <button onClick={() => setActiveTab('done')} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${activeTab === 'done' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500'}`}>
                  <CheckSquare size={13} /> ตรวจแล้ว ({doneList.length})
               </button>
            </div>
         </div>
         <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5">
            {currentList.length === 0 && (
               <div className="text-center p-10 text-slate-400 font-bold">
                  <ClipboardCheck size={40} className="mx-auto mb-3 opacity-30" />ไม่มีรายการ
               </div>
            )}
            {currentList.map(job => {
               const photoCount = Array.isArray(job.qc_photos) ? job.qc_photos.length : 0;
               return (
                  <button key={job.id} onClick={() => handleOpen(job)}
                     className="w-full text-left bg-white p-4 rounded-2xl border border-slate-200 active:border-blue-400 transition-all">
                     <div className="flex justify-between items-start mb-1.5">
                        <span className="font-mono text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{job.ref_no}</span>
                        <div className="flex items-center gap-1.5">
                           {photoCount > 0 && (
                              <span className="flex items-center gap-0.5 text-[10px] font-black text-blue-500"><Camera size={11} /> {photoCount}</span>
                           )}
                           <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${activeTab === 'todo' ? 'bg-orange-50 text-orange-600' : 'bg-green-100 text-green-600'}`}>{job.status}</span>
                        </div>
                     </div>
                     <h4 className="font-black text-slate-800 text-base">{job.model}</h4>
                     <p className="text-[11px] text-slate-400 font-bold">
                        SN: {job.serial || 'N/A'}{job.grade ? ` · Grade ${job.grade}` : ''}{job.stock_no ? ` · ${job.stock_no}` : ''}
                     </p>
                  </button>
               );
            })}
         </div>
      </div>
   );
};
