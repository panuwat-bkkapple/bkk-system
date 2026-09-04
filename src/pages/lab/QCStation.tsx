// src/pages/QCStation.tsx
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { formatDate } from '../../utils/formatters';
import {
   ClipboardCheck, Search, Printer, Save,
   Smartphone, Cpu, AlertTriangle, Lock, Eraser, CheckCircle2, ShieldCheck, X,
   History, User, ListFilter, CheckSquare, FileText, Camera, Plus
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { SickwDeviceCheck } from '../../components/sickw/SickwDeviceCheck';
import { SickwStoredResultCard } from '../../components/sickw/SickwStoredResultCard';
import { SickwGateBanner } from '../../components/sickw/SickwGateBanner';
import { getSickwGateStatus, type SickwParsedFields } from '../../utils/sickwApi';
import { useAuth } from '../../hooks/useAuth';
// Logic การบันทึก QC ใช้ util กลางร่วมกับหน้า mobile (/mobile/qc) — แก้กติกาที่
// src/utils/qcStation.ts ที่เดียว
import {
   MAX_QC_PHOTOS, QC_SUPERVISORS, buildQcFormFromJob,
   validateQcSubmit, submitQcStation, saveQcPhotosOnly,
   selectQcTodoList, selectQcDoneList,
} from '../../utils/qcStation';

const SUPERVISORS = QC_SUPERVISORS;

export const QCStation = () => {
   const toast = useToast();
   const { currentUser } = useAuth();
   const { data: jobs, loading } = useDatabase('jobs');
   const [searchTerm, setSearchTerm] = useState('');
   const [activeTab, setActiveTab] = useState<'todo' | 'done'>('todo');
   const [selectedJob, setSelectedJob] = useState<any>(null);
   const [supervisor, setSupervisor] = useState(SUPERVISORS[0]);
   const [printMode, setPrintMode] = useState<'none' | 'cert' | 'sticker'>('none');

   // Serial ของอุปกรณ์เสริมที่พ่วงมากับงาน (key = accessory item id) — ช่างกรอก
   // ก่อนกดเข้าคลัง แล้วค่าจะติดไปกับ child stock job ตอน unpack
   const [accessorySerials, setAccessorySerials] = useState<Record<string, string>>({});

   // รูปสภาพเครื่อง — เก็บเป็น jobs/{id}/qc_photos (flat field แบบเดียวกับฟิลด์อื่น
   // ของหน้านี้). dealer portal ใช้เป็นรูปให้ดีลเลอร์ดูก่อนเสนอราคาผ่าน
   // lotItemSnapshot (ลำดับ lot_photos → qc_photos → devices[0].photos)
   const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
   const [photoFiles, setPhotoFiles] = useState<File[]>([]);
   const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
   const photoInputRef = useRef<HTMLInputElement>(null);

   const [qcForm, setQcForm] = useState({
      screen_touch: true, screen_display: true, truetone: true, faceid: true,
      camera_front: true, camera_rear: true, speaker_mic: true, wifi_bt: true, buttons: true, charging: true,
      part_screen: 'Original', part_battery: 'Original', part_camera: 'Original',
      final_grade: 'A', battery_health: 100, cycle_count: 0, actual_color: '', capacity: '', model_code: '', actual_imei: '', actual_serial: '',
      icloud_off: true, find_my_off: true, mdm_clear: true, sim_unlocked: true, data_erased: false,
      notes: ''
   });

   // 🔥 1. Logic ดึงงานเข้าแผนก QC
   const { todoList, doneList } = useMemo(() => {
      const list = Array.isArray(jobs) ? jobs : [];
      const filtered = list.filter(j =>
         j.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.ref_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.serial?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.stock_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.qc_txn_id?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      // To Do / Done ตัดสินใน utils/qcStation.ts (normalizeStatus ทั้งสองฝั่ง —
      // รับทั้ง 'Sent To QC Lab' ที่ engine เขียนและ 'Sent to QC Lab' แถวเก่า)
      return {
         todoList: selectQcTodoList(filtered),
         doneList: selectQcDoneList(filtered),
      };
   }, [jobs, searchTerm]);

   const currentList = activeTab === 'todo' ? todoList : doneList;

   // selectedJob เป็น snapshot ตอนกดเปิด — แต่หลังกดตรวจ Sickw จาก panel
   // Cloud Function จะเขียน sickw_check ลง DB ใหม่. ดึงตัวล่าสุดจาก realtime jobs
   // มาใช้กับ Gate / Sickw card เพื่อให้สะท้อนผลตรวจล่าสุดโดยไม่ต้องปิด-เปิดใหม่
   const liveJob = useMemo(() => {
      if (!selectedJob) return null;
      const list = Array.isArray(jobs) ? jobs : [];
      return list.find((j) => j.id === selectedJob.id) || selectedJob;
   }, [jobs, selectedJob]);

   // Auto-fill: เอาค่าจาก Sickw (authoritative — ดึงจาก Apple DB จริง) เติมลงฟอร์ม QC
   // Sickw ชนะเสมอเมื่อมีค่า ช่างยังแก้ทับได้ทีหลัง
   const applySickwToForm = (parsed: SickwParsedFields) => {
      setQcForm(prev => ({
         ...prev,
         actual_serial: parsed.serial || prev.actual_serial,
         actual_imei: parsed.imei || prev.actual_imei,
         actual_color: parsed.color || prev.actual_color,
         capacity: parsed.capacity || prev.capacity,
         model_code: parsed.modelNumber || prev.model_code,
      }));
      const filled = [
         parsed.serial && 'SN', parsed.imei && 'IMEI', parsed.color && 'สี',
         parsed.capacity && 'ความจุ', parsed.modelNumber && 'Model No.',
      ].filter(Boolean);
      if (filled.length > 0) toast.success(`เติมข้อมูลจากผลตรวจ IMEI แล้ว: ${filled.join(', ')}`);
   };

   const repairItems = useMemo(() => {
      const items = [];
      if (qcForm.part_screen !== 'Original') items.push({ label: 'SCREEN', type: qcForm.part_screen });
      if (qcForm.part_battery !== 'Original') items.push({ label: 'BATTERY', type: qcForm.part_battery });
      if (qcForm.part_camera !== 'Original') items.push({ label: 'CAMERA', type: qcForm.part_camera });
      return items;
   }, [qcForm]);

   const isNoRepairHistory = repairItems.length === 0;
   const hasUnknownPart = repairItems.some(item => item.type === 'Unknown');

   const isFunctionalPass =
      qcForm.screen_touch && qcForm.screen_display && qcForm.truetone &&
      qcForm.faceid && qcForm.camera_front && qcForm.camera_rear &&
      qcForm.speaker_mic && qcForm.wifi_bt && qcForm.buttons && qcForm.charging;

   const failedList = useMemo(() => {
      const fails = [];
      if (!qcForm.screen_touch) fails.push('TOUCH SCREEN');
      if (!qcForm.screen_display) fails.push('DISPLAY/LCD');
      if (!qcForm.truetone) fails.push('TRUETONE');
      if (!qcForm.faceid) fails.push('FACE ID/TOUCH ID');
      if (!qcForm.camera_front) fails.push('FRONT CAMERA');
      if (!qcForm.camera_rear) fails.push('REAR CAMERA');
      if (!qcForm.speaker_mic) fails.push('SPEAKER/MIC');
      if (!qcForm.wifi_bt) fails.push('WIFI/BLUETOOTH');
      if (!qcForm.buttons) fails.push('PHYSICAL BUTTONS');
      if (!qcForm.charging) fails.push('CHARGING PORT');
      return fails;
   }, [qcForm]);

   const handleOpenQC = (job: any) => {
      setSelectedJob(job);
      setExistingPhotos(Array.isArray(job.qc_photos) ? job.qc_photos.filter(Boolean) : []);
      photoPreviews.forEach(u => URL.revokeObjectURL(u));
      setPhotoFiles([]);
      setPhotoPreviews([]);
      setAccessorySerials(Object.fromEntries(
         (Array.isArray(job.accessory_items) ? job.accessory_items : [])
            .filter(Boolean)
            .map((it: any, i: number) => [it.id || String(i), it.serial || ''])
      ));
      // เติมฟอร์มจากใบงาน (รวมค่าจาก Sickw เมื่อผลตรวจเป็นของเครื่องนี้จริง) —
      // logic อยู่ใน util กลางร่วมกับหน้า mobile
      setQcForm(buildQcFormFromJob(job));
   };

   const triggerPrint = (mode: 'cert' | 'sticker') => {
      setPrintMode(mode);
      setTimeout(() => {
         window.print();
      }, 800);
   };

   useEffect(() => {
      const handleAfterPrint = () => setPrintMode('none');
      window.addEventListener('afterprint', handleAfterPrint);
      return () => window.removeEventListener('afterprint', handleAfterPrint);
   }, []);

   const handlePrintCert = async () => {
      if (selectedJob) {
         try {
            const newLog = { action: 'PRINTED', by: supervisor, timestamp: Date.now(), details: 'QC Report Cert Printed' };
            const updatedLogs = [newLog, ...(selectedJob.qc_logs || [])];
            await update(ref(db, `jobs/${selectedJob.id}`), { qc_logs: updatedLogs });
         } catch (error) {
            toast.error('บันทึก print log ไม่สำเร็จ');
         }
      }
      triggerPrint('cert');
   };

   const handlePickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;
      const room = MAX_QC_PHOTOS - existingPhotos.length - photoFiles.length;
      if (room <= 0) { toast.warning(`เพิ่มรูปได้สูงสุด ${MAX_QC_PHOTOS} รูปต่อเครื่อง`); return; }
      const accepted = files.slice(0, room);
      if (accepted.length < files.length) toast.warning(`เพิ่มได้อีก ${room} รูป (สูงสุด ${MAX_QC_PHOTOS} รูป) — ตัดส่วนเกินออก`);
      setPhotoFiles(prev => [...prev, ...accepted]);
      setPhotoPreviews(prev => [...prev, ...accepted.map(f => URL.createObjectURL(f))]);
   };

   const removeExistingPhoto = (url: string) => setExistingPhotos(prev => prev.filter(u => u !== url));

   const removeNewPhoto = (index: number) => {
      URL.revokeObjectURL(photoPreviews[index]);
      setPhotoFiles(prev => prev.filter((_, i) => i !== index));
      setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
   };

   // มีรูปที่ยังไม่ได้บันทึกไหม — เทียบกับค่าใน DB ล่าสุด (รูปใหม่ หรือลบรูปเดิมออก)
   const savedPhotos: string[] = Array.isArray(liveJob?.qc_photos) ? liveJob.qc_photos : [];
   const photosDirty = photoFiles.length > 0 || existingPhotos.length !== savedPhotos.length;
   const [savingPhotos, setSavingPhotos] = useState(false);

   // บันทึกเฉพาะรูปทันที — จำเป็นสำหรับงานแท็บ Done (In Stock/Reserved) ที่ไม่มีปุ่ม
   // Submit QC; งาน To Do ก็ใช้เก็บรูปก่อนกรอกฟอร์มเสร็จได้
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

   // 🔥 2. Logic ส่งไม้ต่อ — ตัวจริงอยู่ใน util กลาง (submitQcStation) ใช้ร่วมกับ
   // หน้า mobile: guard → อัปโหลดรูป → เขียนผล QC → แตกอุปกรณ์เสริมเข้าสต๊อก
   const handleSubmitQC = async () => {
      const error = validateQcSubmit(qcForm, liveJob);
      if (error) { toast.warning(error); return; }
      if (!confirm('ยืนยันผลการตรวจสอบอุปกรณ์?')) return;

      try {
         const { nextStatus, qcTxnId, unpackedAccessories } = await submitQcStation({
            job: selectedJob, liveJob, qcForm, supervisor, accessorySerials,
            existingPhotos, photoFiles,
            onProgress: (msg) => toast.info(msg),
         });

         if (nextStatus === 'QC Review') {
            toast.success(`บันทึกผลสำเร็จ! ส่งให้ Admin เคาะราคาแล้ว (TXN: ${qcTxnId})`);
         } else {
            toast.success(`บันทึกสำเร็จ! ส่งสินค้าเข้าคลังแล้ว ปิดจ๊อบสมบูรณ์! (TXN: ${qcTxnId})`);
            if (unpackedAccessories > 0) {
               toast.success(`แตกอุปกรณ์เสริม ${unpackedAccessories} ชิ้นเข้าสต๊อกแล้ว (ref ${selectedJob.ref_no}-A1..)`);
            }
         }

         photoPreviews.forEach(u => URL.revokeObjectURL(u));
         setPhotoFiles([]);
         setPhotoPreviews([]);
         setSelectedJob(null);
      } catch (e) { toast.error('เกิดข้อผิดพลาด: ' + e); }
   };

   const getBarcodeUrl = (text: string, height: number = 10) => {
      if (!text) return '';
      return `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(text)}&scale=2&height=${height}&rotate=N&includetext=false`;
   };

   if (loading) return <div className="p-10 text-center text-slate-400 font-mono animate-pulse uppercase">Loading QC Lab...</div>;

   return (
      <>
         <div className={`p-6 bg-slate-100 min-h-screen font-sans text-slate-800 ${printMode !== 'none' ? 'hidden' : ''}`}>
            <div className="flex justify-between items-center mb-8">
               <div className="flex items-center gap-3">
                  <div className="bg-slate-800 p-3 rounded-xl text-white shadow-lg"><ClipboardCheck size={28} /></div>
                  <div>
                     <h1 className="text-2xl font-black uppercase tracking-tight">QC Lab Station</h1>
                     <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Master OID Ecosystem</p>
                  </div>
               </div>
               <div className="flex items-center gap-3 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                  <Search className="text-slate-400 ml-2" size={20} />
                  <input type="text" placeholder="Scan Barcode / OID / SN..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="bg-transparent outline-none font-bold text-sm w-64" />
               </div>
            </div>

            <div className="grid grid-cols-12 gap-6">
               <div className="col-span-4 space-y-4">
                  <div className="bg-slate-200 p-1 rounded-xl flex font-bold text-xs mb-4">
                     <button onClick={() => { setActiveTab('todo'); setSelectedJob(null); }} className={`flex-1 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'todo' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <ListFilter size={14} /> To Do ({todoList.length})
                     </button>
                     <button onClick={() => { setActiveTab('done'); setSelectedJob(null); }} className={`flex-1 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'done' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <CheckSquare size={14} /> Done ({doneList.length})
                     </button>
                  </div>
                  <div className="space-y-3 h-[70vh] overflow-y-auto pr-2 no-scrollbar">
                     {currentList.length === 0 && <div className="text-center p-10 text-slate-400 font-bold">ไม่มีรายการ</div>}
                     {currentList.map(job => (
                        <div key={job.id} onClick={() => handleOpenQC(job)} className={`p-5 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md ${selectedJob?.id === job.id ? 'bg-white border-blue-500 shadow-lg ring-4 ring-blue-500/10' : 'bg-white border-slate-100 hover:border-blue-200'}`}>
                           <div className="flex justify-between items-start mb-2">
                              <span className="font-mono text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded">{job.ref_no}</span>
                              <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${job.status === 'Pending QC' ? 'bg-orange-50 text-orange-600' : 'bg-green-100 text-green-600'}`}>{job.status}</span>
                           </div>
                           <h4 className="font-black text-slate-800 text-lg mb-1">{job.model}</h4>
                           <p className="text-xs text-slate-500 font-bold">SN: {job.serial || 'N/A'}</p>
                        </div>
                     ))}
                  </div>
               </div>

               <div className="col-span-8">
                  {selectedJob ? (
                     <div className="bg-white rounded-[2rem] shadow-xl border border-slate-200 overflow-hidden flex flex-col h-[85vh]">
                        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                           <div className="flex items-center gap-4">
                              <div className="bg-blue-600 text-white px-4 py-2 rounded-xl text-center">
                                 <p className="text-[9px] font-black uppercase opacity-80">Master OID</p>
                                 <p className="text-sm font-mono font-bold">{selectedJob.ref_no}</p>
                              </div>
                              <div>
                                 <h2 className="text-xl font-black text-slate-800">{selectedJob.model}</h2>
                                 <p className="text-[10px] font-bold text-slate-400">
                                    SN: {selectedJob.serial || 'N/A'}
                                    {liveJob?.stock_no && <span className="text-blue-400"> · Stock: {liveJob.stock_no}</span>}
                                 </p>
                              </div>
                           </div>
                           <div className="flex gap-2">
                              <select className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" value={supervisor} onChange={e => setSupervisor(e.target.value)}>{SUPERVISORS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                              <button onClick={() => triggerPrint('sticker')} className="flex items-center gap-2 bg-white border-2 border-slate-800 text-slate-800 px-4 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 transition-all shadow-sm"><Smartphone size={16} /> Print Sticker</button>
                              <button onClick={handlePrintCert} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-black transition-colors shadow-md"><Printer size={16} /> Print Cert</button>
                           </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
                           {/* Sickw Gate Status — banner ด้านบนสุด */}
                           <SickwGateBanner
                              jobId={selectedJob.id}
                              sickwCheck={liveJob?.sickw_check}
                              gate={getSickwGateStatus(liveJob?.sickw_check)}
                              currentRole={currentUser?.role}
                           />
                           <section className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                              <h3 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Smartphone size={16} /> Identity</h3>
                              <div className="grid grid-cols-2 gap-4">
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Confirm Serial Number</label><input type="text" value={qcForm.actual_serial} onChange={e => setQcForm({ ...qcForm, actual_serial: e.target.value })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Confirm IMEI</label><input type="text" placeholder="Scan IMEI..." value={qcForm.actual_imei} onChange={e => setQcForm({ ...qcForm, actual_imei: e.target.value })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Color</label><input type="text" value={qcForm.actual_color} onChange={e => setQcForm({ ...qcForm, actual_color: e.target.value })} placeholder={selectedJob.color} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Capacity</label><input type="text" value={qcForm.capacity} onChange={e => setQcForm({ ...qcForm, capacity: e.target.value })} placeholder={selectedJob.capacity} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold" /></div>
                                 <div className="col-span-2"><label className="text-[10px] font-bold text-slate-400 uppercase">Model No. (Part No.)</label><input type="text" value={qcForm.model_code} onChange={e => setQcForm({ ...qcForm, model_code: e.target.value })} placeholder={selectedJob.model_code || 'MYWV3ZP/A'} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                              </div>
                           </section>

                           <section className="space-y-4">
                              <SickwDeviceCheck
                                 key={selectedJob.id}
                                 jobId={selectedJob.id}
                                 initialImei={qcForm.actual_imei || selectedJob.imei || ''}
                                 initialSerial={qcForm.actual_serial || selectedJob.serial || ''}
                                 onResult={applySickwToForm}
                              />
                              {/* แสดงผลที่เก็บไว้ + ตรวจ mismatch กับใบงาน + ปุ่ม Sync to Job */}
                              <SickwStoredResultCard sickwCheck={liveJob?.sickw_check} job={liveJob} />
                           </section>

                           {/* อุปกรณ์เสริมที่รับซื้อพ่วงมากับเครื่องนี้ — ตรวจของให้ครบก่อน
                               กด In Stock (ระบบจะแตกเป็น stock รายชิ้น ref -A1.. อัตโนมัติ) */}
                           {Array.isArray(selectedJob.accessory_items) && selectedJob.accessory_items.length > 0 && (
                              <section className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                                 <h3 className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-4 flex items-center gap-2"><ClipboardCheck size={16} /> Accessories in this job ({selectedJob.accessory_items.length})</h3>
                                 <div className="space-y-2">
                                    {selectedJob.accessory_items.map((it: any, i: number) => {
                                       const itemKey = it.id || String(i);
                                       return (
                                          <div key={itemKey} className="flex justify-between items-center gap-3 bg-white rounded-xl border border-indigo-100 px-4 py-3">
                                             <div className="flex-1 min-w-0">
                                                <div className="font-black text-sm text-slate-800 truncate">{it.model_name}</div>
                                                {selectedJob.accessories_unpacked_at ? (
                                                   it.serial && <div className="text-[10px] font-mono font-bold text-slate-400">SN: {it.serial}</div>
                                                ) : (
                                                   <input
                                                      type="text"
                                                      placeholder="Serial (ถ้ามี — Pencil/Keyboard มีบนตัว/กล่อง)"
                                                      value={accessorySerials[itemKey] ?? ''}
                                                      onChange={e => setAccessorySerials(prev => ({ ...prev, [itemKey]: e.target.value }))}
                                                      className="w-full mt-1 p-2 rounded-lg border border-indigo-100 font-mono text-xs font-bold outline-none focus:border-indigo-400"
                                                   />
                                                )}
                                             </div>
                                             <div className="font-black text-sm text-indigo-600 shrink-0">฿{(Number(it.price) || 0).toLocaleString()}</div>
                                          </div>
                                       );
                                    })}
                                 </div>
                                 <p className="text-[10px] font-bold text-indigo-400 mt-3">
                                    {selectedJob.accessories_unpacked_at
                                       ? 'แตกเข้าสต๊อกเป็นรายชิ้นแล้ว (ref -A1..)'
                                       : 'เมื่อกดเข้าคลัง (In Stock) ระบบจะแตกอุปกรณ์เสริมเป็น stock รายชิ้นอัตโนมัติ'}
                                 </p>
                              </section>
                           )}

                           <section>
                              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Cpu size={16} /> Hardware Diagnostics</h3>
                              <div className="grid grid-cols-2 gap-4">
                                 {[
                                    { id: 'screen_touch', label: 'Screen Touch / Digitizer' }, { id: 'screen_display', label: 'Display Quality' },
                                    { id: 'truetone', label: 'TrueTone / FaceID Sensors' }, { id: 'wifi_bt', label: 'Wifi / Bluetooth / GPS' },
                                    { id: 'camera_front', label: 'Front Camera & Mic' }, { id: 'camera_rear', label: 'Rear Cameras & Flash' },
                                    { id: 'speaker_mic', label: 'Speakers & Microphones' }, { id: 'charging', label: 'Charging Port' }
                                 ].map((test: any) => (
                                    <label key={test.id} className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${qcForm[test.id as keyof typeof qcForm] ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                       <span className="text-sm font-bold text-slate-700">{test.label}</span>
                                       <input type="checkbox" checked={qcForm[test.id as keyof typeof qcForm] as boolean} onChange={e => setQcForm({ ...qcForm, [test.id]: e.target.checked })} className="w-5 h-5 accent-green-600" />
                                    </label>
                                 ))}
                              </div>
                           </section>

                           <div className="grid grid-cols-2 gap-8">
                              <section>
                                 <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><AlertTriangle size={16} /> Parts & Grade</h3>
                                 <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
                                    <div className="grid grid-cols-3 gap-2">
                                       {['Screen', 'Battery', 'Camera'].map(part => (
                                          <div key={part}>
                                             <label className="text-[9px] font-black text-slate-400 uppercase">{part}</label>
                                             <select value={qcForm[`part_${part.toLowerCase()}` as keyof typeof qcForm] as string} onChange={e => setQcForm({ ...qcForm, [`part_${part.toLowerCase()}`]: e.target.value })} className="w-full mt-1 p-2 rounded-lg border border-slate-200 font-bold text-[10px]">
                                                <option value="Original">Original</option>
                                                <option value="Genuine">Genuine</option>
                                                <option value="Unknown">Unknown</option>
                                             </select>
                                          </div>
                                       ))}
                                    </div>
                                    <div><label className="text-[10px] font-bold text-slate-400 uppercase">Final Grade</label><select value={qcForm.final_grade} onChange={e => setQcForm({ ...qcForm, final_grade: e.target.value })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-black text-lg outline-none"><option value="New">Grade New</option><option value="A">Grade A</option><option value="B">Grade B</option><option value="C">Grade C</option><option value="D">Grade D</option></select></div>
                                    <div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] font-bold text-slate-400 uppercase">Bat Health %</label><input type="number" value={qcForm.battery_health} onChange={e => setQcForm({ ...qcForm, battery_health: Number(e.target.value) })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold" /></div><div><label className="text-[10px] font-bold text-slate-400 uppercase">Cycle Count</label><input type="number" value={qcForm.cycle_count} onChange={e => setQcForm({ ...qcForm, cycle_count: Number(e.target.value) })} className="text-gray-900 w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold" /></div></div>
                                 </div>
                              </section>
                              <section>
                                 <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Lock size={16} /> Security & Erasure</h3>
                                 <div className="p-6 bg-red-50 rounded-2xl border border-red-100 space-y-3">
                                    <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={qcForm.icloud_off} onChange={e => setQcForm({ ...qcForm, icloud_off: e.target.checked })} className="w-4 h-4 accent-red-600" /><span className="text-xs font-bold text-slate-700">iCloud / Find My: OFF</span></label>
                                    <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={qcForm.mdm_clear} onChange={e => setQcForm({ ...qcForm, mdm_clear: e.target.checked })} className="w-4 h-4 accent-red-600" /><span className="text-xs font-bold text-slate-700">MDM Profile: CLEAR</span></label>
                                    <hr className="border-red-200" />
                                    <div className="pt-2"><label className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all ${qcForm.data_erased ? 'bg-green-600 text-white border-green-600 shadow-lg' : 'bg-white text-red-600 border-red-200'}`}><Eraser size={20} /><span className="font-black uppercase tracking-tight">{qcForm.data_erased ? 'Data Wiped' : 'Confirm Erasure'}</span><input type="checkbox" className="hidden" checked={qcForm.data_erased} onChange={e => setQcForm({ ...qcForm, data_erased: e.target.checked })} /></label></div>
                                 </div>
                              </section>
                           </div>

                           <section>
                              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><FileText size={16} /> Technical Notes</h3>
                              <textarea value={qcForm.notes} onChange={e => setQcForm({ ...qcForm, notes: e.target.value })} placeholder="Notes on exterior condition..." className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-xs font-bold text-slate-700 outline-none focus:border-blue-400 min-h-[100px] shadow-inner" />
                           </section>

                           {/* รูปสภาพเครื่อง — บันทึกเป็น jobs/{id}/qc_photos ตอนกด Submit
                               ดีลเลอร์เห็นรูปชุดนี้ใน Diagnostic Report ก่อนเสนอราคา (ผ่าน lot snapshot) */}
                           <section>
                              <div className="flex items-center justify-between mb-4">
                                 <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <Camera size={16} /> Device Photos (รูปสภาพเครื่อง)
                                    <span className="text-slate-300 normal-case tracking-normal">{existingPhotos.length + photoFiles.length}/{MAX_QC_PHOTOS}</span>
                                 </h3>
                                 {photosDirty && (
                                    <button type="button" onClick={handleSavePhotosOnly} disabled={savingPhotos}
                                       className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-black text-xs uppercase transition-all shadow ${savingPhotos ? 'bg-slate-200 text-slate-400 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}`}>
                                       <Save size={13} /> {savingPhotos ? 'กำลังบันทึก...' : 'บันทึกรูป'}
                                    </button>
                                 )}
                              </div>
                              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                                 <div className="flex flex-wrap gap-3">
                                    {existingPhotos.map((url) => (
                                       <div key={url} className="relative group">
                                          <a href={url} target="_blank" rel="noreferrer">
                                             <img src={url} alt="รูปสภาพเครื่อง" loading="lazy" className="w-20 h-20 object-cover rounded-xl border border-slate-200" />
                                          </a>
                                          <button type="button" onClick={() => removeExistingPhoto(url)} title="ลบรูปนี้"
                                             className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow opacity-0 group-hover:opacity-100 transition-opacity">
                                             <X size={12} />
                                          </button>
                                       </div>
                                    ))}
                                    {photoPreviews.map((url, i) => (
                                       <div key={url} className="relative group">
                                          <img src={url} alt={`รูปใหม่ ${i + 1}`} className="w-20 h-20 object-cover rounded-xl border-2 border-blue-300" />
                                          <span className="absolute bottom-1 left-1 bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase">New</span>
                                          <button type="button" onClick={() => removeNewPhoto(i)} title="เอารูปออก"
                                             className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow opacity-0 group-hover:opacity-100 transition-opacity">
                                             <X size={12} />
                                          </button>
                                       </div>
                                    ))}
                                    {existingPhotos.length + photoFiles.length < MAX_QC_PHOTOS && (
                                       <button type="button" onClick={() => photoInputRef.current?.click()}
                                          className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors flex flex-col items-center justify-center gap-1">
                                          <Plus size={18} />
                                          <span className="text-[9px] font-black uppercase">เพิ่มรูป</span>
                                       </button>
                                    )}
                                 </div>
                                 <p className="text-[10px] font-bold text-slate-400 mt-3">
                                    ถ่ายรอบตัวเครื่อง (หน้า/หลัง/ขอบ/ตำหนิ) — กด "บันทึกรูป" เพื่ออัปโหลดทันที (หรือรูปจะถูกบันทึกพร้อมตอนกด Submit QC) ดีลเลอร์จะเห็นชุดนี้ก่อนเสนอราคาเมื่อเครื่องถูกจัดเข้า Lot
                                 </p>
                                 <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePickPhotos} />
                              </div>
                           </section>

                           <section className="pb-10">
                              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><History size={16} /> Audit History</h3>
                              <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden max-h-48 overflow-y-auto">
                                 {selectedJob.qc_logs && selectedJob.qc_logs.length > 0 ? (
                                    selectedJob.qc_logs.map((log: any, i: number) => (
                                       <div key={i} className="p-4 border-b border-slate-100 flex items-start gap-3 last:border-0 hover:bg-white transition-colors">
                                          <div className="bg-slate-200 p-2 rounded-full text-slate-500 mt-1"><User size={12} /></div>
                                          <div className="flex-1">
                                             <div className="flex justify-between items-center"><span className="text-xs font-black text-slate-700 uppercase">{log.action}</span><span className="text-[10px] text-slate-400 font-mono font-bold">{formatDate(log.timestamp)}</span></div>
                                             <div className="text-[10px] text-slate-500 mt-0.5">{log.details}</div>
                                             <div className="text-[9px] text-blue-400 font-black mt-1 uppercase">By: {log.by}</div>
                                          </div>
                                       </div>
                                    ))
                                 ) : (
                                    <div className="p-6 text-center text-xs text-slate-400 italic">No history recorded</div>
                                 )}
                              </div>
                           </section>
                        </div>

                        <div className="p-6 bg-white border-t border-slate-200 flex justify-end gap-4 shadow-2xl">
                           <button onClick={() => setSelectedJob(null)} className="px-6 py-4 rounded-xl font-bold text-slate-400 hover:bg-slate-50 uppercase text-xs tracking-widest">Cancel</button>
                           {/* 🔥 ปุ่มนี้จะฉลาดขึ้นตามสถานะการจ่ายเงิน + ถูก Sickw Gate block ได้ */}
                           {['Pending QC', 'Waiting for Handover', 'Sent to QC Lab'].includes(selectedJob.status) && (() => {
                              const qcGate = getSickwGateStatus(liveJob?.sickw_check);
                              return (
                                 <button
                                    onClick={handleSubmitQC}
                                    disabled={qcGate.blocked}
                                    className={`px-8 py-4 rounded-xl font-black uppercase text-sm shadow-lg active:scale-95 flex items-center gap-2 transition-all ${
                                       qcGate.blocked
                                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                                          : 'bg-blue-600 text-white hover:bg-blue-700'
                                    }`}
                                 >
                                    {qcGate.blocked ? <AlertTriangle size={18} /> : <Save size={18} />}
                                    {qcGate.blocked
                                       ? 'IMEI Gate Block — ต้อง Override'
                                       : (() => {
                                          const isPaid = selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action));
                                          if (isPaid || selectedJob.receive_method === 'Pickup') return 'Approve & Send to Stock';
                                          return 'Submit QC to Admin';
                                       })()}
                                 </button>
                              );
                           })()}
                        </div>
                     </div>
                  ) : (
                     <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-[2rem] bg-white/50 animate-in fade-in duration-500">
                        <ClipboardCheck size={64} className="mb-4 opacity-20" />
                        <h3 className="text-xl font-black uppercase tracking-[0.2em] opacity-30">Select Device (Parent OID)</h3>
                     </div>
                  )}
               </div>
            </div>
         </div>

         {/* 🏷️ STICKER MODE */}
         {selectedJob && printMode === 'sticker' && (
            <div className="fixed inset-0 bg-white z-[9999] flex items-center justify-center print:block print:static">
               <style>{`
            @media print {
              @page { size: 50mm 30mm; margin: 0; }
              body { margin: 0; padding: 0; visibility: hidden; }
              .sticker-content { visibility: visible; position: fixed; top: 0; left: 0; width: 50mm; height: 30mm; }
            }
          `}</style>
               <div className="sticker-content w-[50mm] h-[30mm] p-2 flex flex-col justify-between border-0 overflow-hidden box-border bg-white text-black">
                  <div>
                     <h3 className="text-[9px] font-black leading-none uppercase truncate mb-0.5">{selectedJob.model}</h3>
                     <p className="text-[7px] font-mono font-bold leading-none">SN: {selectedJob.serial || 'N/A'}</p>
                  </div>
                  <div className="flex flex-col items-center">
                     <img src={getBarcodeUrl(selectedJob.ref_no, 20)} alt="OID Barcode" className="h-[10mm] w-auto max-w-full object-contain" />
                     <p className="text-[6px] font-mono font-bold leading-none mt-0.5">{selectedJob.ref_no}</p>
                  </div>
               </div>
            </div>
         )}

         {/* 🖨️ CERTIFICATE MODE */}
         {selectedJob && printMode === 'cert' && (
            <div className="fixed inset-0 bg-white z-[9999] flex justify-center items-start pt-10 print:pt-0 print:block print:static">
               <style>{`
            @media print {
              @page { size: A4 portrait; margin: 5mm; }
              body { visibility: hidden; }
              .cert-page-container { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; }
            }
          `}</style>
               <div className="cert-page-container w-[190mm] min-h-[270mm] bg-white p-10 flex flex-col font-sans text-black">
                  <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-gray-100">
                     <div className="flex items-center gap-3">
                        <div className="bg-black text-white p-2 rounded-lg"><ClipboardCheck size={32} /></div>
                        <div>
                           <h1 className="text-2xl font-black tracking-tight uppercase">BKK Certified</h1>
                           <p className="text-[9px] text-gray-500 font-bold uppercase tracking-[0.2em]">Device History Report</p>
                        </div>
                     </div>
                     <div className="flex gap-6 items-center">
                        <div className="flex flex-col items-center">
                           <img src={getBarcodeUrl(selectedJob.qc_txn_id || 'PENDING', 25)} alt="TXN Barcode" className="h-10 w-auto mb-1" />
                           <span className="text-[8px] font-mono font-bold text-gray-400">{selectedJob.qc_txn_id || 'PENDING'}</span>
                        </div>
                        <div className="text-right border-l-2 border-gray-100 pl-6">
                           <div className="mb-1"><span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block">FINAL GRADE</span><span className="text-7xl font-black text-black leading-none">{qcForm.final_grade}</span></div>
                           <p className="text-[9px] text-gray-400 font-mono font-bold mt-1 uppercase">OID: {selectedJob.ref_no}</p>
                        </div>
                     </div>
                  </div>

                  <div className="mb-8">
                     <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Device Information</p>
                     <h2 className="text-4xl font-black mb-6 leading-tight tracking-tight uppercase">{selectedJob.model}</h2>
                     <div className="grid grid-cols-2 gap-y-4 gap-x-12 text-sm">
                        <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Serial Number</p><p className="font-mono font-bold text-black">{qcForm.actual_serial || selectedJob.serial || 'N/A'}</p></div>
                        <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">IMEI Number</p><p className="font-mono font-bold text-black">{qcForm.actual_imei || 'N/A'}</p></div>
                        <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Specifications</p><p className="font-bold text-black">{qcForm.capacity || selectedJob.capacity || 'N/A'} • {qcForm.actual_color || selectedJob.color || 'N/A'}{(qcForm.model_code || selectedJob.model_code) ? ` • ${qcForm.model_code || selectedJob.model_code}` : ''}</p></div>
                        <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Inspection TXN</p><p className="font-mono font-bold text-black tracking-tight">{selectedJob.qc_txn_id || 'NEW-TXN'}</p></div>
                     </div>
                  </div>

                  <div className="flex-1 space-y-0 divide-y divide-gray-100 border-t border-gray-100">
                     <CheckItem label="Not reported lost or stolen (Blacklist Verified)" checked={qcForm.icloud_off} />
                     <CheckItem label="No Activation Lock / Find My iPhone OFF" checked={qcForm.icloud_off} />
                     <CheckItem label="MDM / Remote Management Status: CLEAR" checked={qcForm.mdm_clear} />
                     <CheckItem label="Carrier Status: FACTORY UNLOCKED" checked={qcForm.sim_unlocked} />
                     {isNoRepairHistory ? (
                        <CheckItem label="No repair history found (All Original Parts)" checked={true} />
                     ) : (
                        <div className="flex items-start gap-4 py-3 transition-all">
                           {hasUnknownPart ? <X size={20} className="text-red-500 mt-0.5 shrink-0" /> : <div className="bg-green-500 text-white p-0.5 rounded-full mt-0.5"><CheckCircle2 size={16} strokeWidth={3} /></div>}
                           <div>
                              <span className={`font-black text-sm uppercase tracking-tight ${hasUnknownPart ? 'text-red-600' : 'text-green-600'}`}>{hasUnknownPart ? 'Repair history detected' : 'Genuine parts replaced'}</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                 {repairItems.map((item, idx) => (
                                    <div key={idx} className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${item.type === 'Genuine' ? 'bg-green-50 text-green-600 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>{item.label}: {item.type}</div>
                                 ))}
                              </div>
                           </div>
                        </div>
                     )}
                     <CheckItem label={`Battery Health Verification: ${qcForm.battery_health}%`} checked={qcForm.battery_health >= 80} />
                     {!isFunctionalPass && (
                        <div className="flex items-start gap-4 py-3 transition-all">
                           <X size={20} className="text-red-500 mt-0.5 shrink-0" />
                           <div>
                              <span className="font-black text-sm text-red-600 uppercase tracking-tight">Functional issues detected</span>
                              <div className="text-[9px] text-red-500 font-bold uppercase mt-1 tracking-wider bg-red-50 px-2 py-1 rounded-md border border-red-100 inline-block uppercase">FAILED: {failedList.join(' | ')}</div>
                           </div>
                        </div>
                     )}
                     {qcForm.notes && (
                        <div className="flex items-start gap-4 py-3">
                           <FileText size={20} className="text-slate-400 mt-0.5 shrink-0" />
                           <div>
                              <span className="font-black text-[9px] text-slate-400 uppercase tracking-widest block">QC Technical Comments</span>
                              <p className="text-xs font-bold text-slate-700 italic mt-0.5 leading-tight">{qcForm.notes}</p>
                           </div>
                        </div>
                     )}
                     <CheckItem label="Data Erasure Status: SECURELY WIPED (Certified)" checked={qcForm.data_erased} />
                  </div>

                  <div className="mt-8 border-2 border-green-500 bg-green-50/50 rounded-2xl p-8 flex gap-6 items-start shadow-sm">
                     <div className="bg-green-500 text-white p-2 rounded-full"><ShieldCheck size={32} /></div>
                     <div>
                        <h3 className="text-green-900 font-black text-lg mb-1 uppercase tracking-tight">Buyback Guarantee</h3>
                        <p className="text-green-700 text-xs leading-relaxed font-bold">No issues were reported by the global blacklist. If you find that this device has been reported as lost or stolen to the global blacklist and not included in this report, BKK System will buy this device back.</p>
                     </div>
                  </div>
                  <div className="text-center mt-8 text-[9px] text-gray-400 font-black uppercase tracking-[0.2em]">Verified by BKK QC Lab Station • Inspector: {supervisor.split(' - ')[1]}</div>
               </div>
            </div>
         )}
      </>
   );
};

const CheckItem = ({ label, checked }: { label: string, checked: boolean }) => (
   <div className="flex items-center gap-5 py-3 transition-all">
      {checked ? (
         <div className="bg-green-500 text-white p-0.5 rounded-full"><CheckCircle2 size={20} strokeWidth={3} /></div>
      ) : (
         <div className="bg-red-400 text-white p-0.5 rounded-full"><X size={20} strokeWidth={3} /></div>
      )}
      <span className={`font-bold text-sm tracking-tight ${checked ? 'text-slate-800' : 'text-red-400'}`}>{label}</span>
   </div>
);