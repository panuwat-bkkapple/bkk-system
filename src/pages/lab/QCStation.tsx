// src/pages/QCStation.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { useToast } from '../../components/ui/ToastProvider';
import { formatDate } from '../../utils/formatters';
import {
   ClipboardCheck, Search, Printer, Save,
   Smartphone, Cpu, AlertTriangle, Lock, Eraser, CheckCircle2, ShieldCheck, X,
   History, User, ListFilter, CheckSquare, FileText
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { QC_STATION_STATUSES } from '../../constants/statusGroups';

const SUPERVISORS = ["Head QC - Somchai", "Head QC - Wichai"];

export const QCStation = () => {
   const toast = useToast();
   const { data: jobs, loading } = useDatabase('jobs');
   const [searchTerm, setSearchTerm] = useState('');
   const [activeTab, setActiveTab] = useState<'todo' | 'done'>('todo');
   const [selectedJob, setSelectedJob] = useState<any>(null);
   const [supervisor, setSupervisor] = useState(SUPERVISORS[0]);
   const [printMode, setPrintMode] = useState<'none' | 'cert' | 'sticker'>('none');

   const [qcForm, setQcForm] = useState({
      screen_touch: true, screen_display: true, truetone: true, faceid: true,
      camera_front: true, camera_rear: true, speaker_mic: true, wifi_bt: true, buttons: true, charging: true,
      part_screen: 'Original', part_battery: 'Original', part_camera: 'Original',
      final_grade: 'A', battery_health: 100, cycle_count: 0, actual_color: '', model_code: '', actual_imei: '', actual_serial: '',
      icloud_off: true, find_my_off: true, mdm_clear: true, sim_unlocked: true, data_erased: false,
      notes: ''
   });

   const generateTXN = (prefix: string) => {
      const random = Math.floor(1000 + Math.random() * 9000);
      return `${prefix}-${Date.now().toString().slice(-4)}${random}`;
   };

   // 🔥 1. Logic ดึงงานเข้าแผนก QC
   const { todoList, doneList } = useMemo(() => {
      const list = Array.isArray(jobs) ? jobs : [];
      const filtered = list.filter(j =>
         j.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.ref_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.serial?.toLowerCase().includes(searchTerm.toLowerCase()) ||
         j.qc_txn_id?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      return {
         // ✅ TO DO: เพิ่มสถานะ 'Sent to QC Lab' เข้าไปให้ระบบดึงงานมาโชว์
         todoList: filtered.filter(j => [
            'Sent to QC Lab'        // สำหรับงานไรเดอร์ที่จ่ายเงินแล้ว และส่งมาล้างข้อมูล
         ].includes(j.status)),

         // ✅ DONE: งานที่ตรวจ QC เสร็จแล้ว (มีเลข qc_txn_id)
         doneList: filtered.filter(j => !!j.qc_txn_id).sort((a, b) => (b.qc_date || 0) - (a.qc_date || 0))
      };
   }, [jobs, searchTerm]);

   const currentList = activeTab === 'todo' ? todoList : doneList;

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
      setQcForm({
         screen_touch: job.qc_details?.screen_touch ?? true,
         screen_display: job.qc_details?.screen_display ?? true,
         truetone: job.qc_details?.truetone ?? true,
         faceid: job.qc_details?.faceid ?? true,
         camera_front: job.qc_details?.camera_front ?? true,
         camera_rear: job.qc_details?.camera_rear ?? true,
         speaker_mic: job.qc_details?.speaker_mic ?? true,
         wifi_bt: job.qc_details?.wifi_bt ?? true,
         buttons: job.qc_details?.buttons ?? true,
         charging: job.qc_details?.charging ?? true,
         part_screen: job.qc_details?.part_screen || 'Original',
         part_battery: job.qc_details?.part_battery || 'Original',
         part_camera: job.qc_details?.part_camera || 'Original',
         final_grade: job.grade || 'A',
         battery_health: job.battery_health || 100,
         cycle_count: job.qc_details?.cycle_count || 0,
         actual_color: job.color || '',
         model_code: job.qc_details?.model_code || 'TH/A',
         actual_imei: job.imei || '',
         actual_serial: job.serial || '',
         icloud_off: job.qc_details?.icloud_off ?? true,
         find_my_off: job.qc_details?.find_my_off ?? true,
         mdm_clear: job.qc_details?.mdm_clear ?? true,
         sim_unlocked: job.qc_details?.sim_unlocked ?? true,
         data_erased: job.qc_details?.data_erased ?? false,
         notes: job.qc_details?.notes || ''
      });
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

   // 🔥 2. Logic ส่งไม้ต่อ: แบบ Smart Dynamic (ป้องกันการวนลูป)
   const handleSubmitQC = async () => {
      if (!qcForm.data_erased) { toast.warning('กรุณายืนยันการล้างข้อมูลก่อนบันทึก'); return; }
      if (!qcForm.actual_imei || qcForm.actual_imei.trim() === '') {
         toast.warning('กรุณาสแกนหรือกรอกเลข IMEI เครื่องก่อนบันทึกเข้าคลัง'); return;
      }
      if (!confirm('ยืนยันผลการตรวจสอบอุปกรณ์?')) return;

      try {
         const qcTxnId = generateTXN('TXN-QC');

         // 🟢 เช็คประวัติว่า "เคยจ่ายเงินไปแล้วหรือยัง?" (ถ้าเคยแล้ว ห้ามส่งกลับไป QC Review เด็ดขาด)
         const isAlreadyPaid = selectedJob.qc_logs?.some((log: any) =>
            ['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action)
         );

         let nextStatus = 'In Stock';
         let actionLog = 'QC PASSED';
         let detailLog = `ตรวจสอบเรียบร้อย นำสินค้าเข้าคลัง (Grade: ${qcForm.final_grade})`;

         // 🟢 ถ้ายังไม่เคยจ่ายเงิน และเป็น Mail-in/Store-in -> ส่งไปให้ Admin เคาะราคาก่อน
         if (!isAlreadyPaid && (selectedJob.receive_method === 'Mail-in' || selectedJob.receive_method === 'Store-in')) {
            nextStatus = 'QC Review';
            actionLog = 'QC COMPLETED';
            detailLog = `ช่างตรวจเสร็จสิ้น (Grade: ${qcForm.final_grade}) ส่งผลให้แอดมินประเมินราคา`;
         }

         const newLogEntry = { action: actionLog, by: supervisor, timestamp: Date.now(), details: detailLog };
         const updatedLogs = [newLogEntry, ...(selectedJob.qc_logs || [])];

         await update(ref(db, `jobs/${selectedJob.id}`), {
            status: nextStatus, // 👈 ระบบจะฉลาดพอที่จะไม่ส่งกลับไปวนลูปแล้ว
            qc_txn_id: qcTxnId,
            qc_passed: isFunctionalPass,
            qc_date: Date.now(),
            qc_by: supervisor,
            grade: qcForm.final_grade,
            battery_health: qcForm.battery_health,
            color: qcForm.actual_color || selectedJob.color,
            model_code: qcForm.model_code || selectedJob.model_code,
            serial: qcForm.actual_serial || selectedJob.serial,
            imei: qcForm.actual_imei || selectedJob.imei,
            qc_details: qcForm,
            qc_logs: updatedLogs
         });

         if (nextStatus === 'QC Review') {
            toast.success(`บันทึกผลสำเร็จ! ส่งให้ Admin เคาะราคาแล้ว (TXN: ${qcTxnId})`);
         } else {
            toast.success(`บันทึกสำเร็จ! ส่งสินค้าเข้าคลังแล้ว ปิดจ๊อบสมบูรณ์! (TXN: ${qcTxnId})`);
         }

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
                                 <p className="text-[10px] font-bold text-slate-400">SN: {selectedJob.serial || 'N/A'}</p>
                              </div>
                           </div>
                           <div className="flex gap-2">
                              <select className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" value={supervisor} onChange={e => setSupervisor(e.target.value)}>{SUPERVISORS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                              <button onClick={() => triggerPrint('sticker')} className="flex items-center gap-2 bg-white border-2 border-slate-800 text-slate-800 px-4 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 transition-all shadow-sm"><Smartphone size={16} /> Print Sticker</button>
                              <button onClick={handlePrintCert} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-xs hover:bg-black transition-colors shadow-md"><Printer size={16} /> Print Cert</button>
                           </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
                           <section className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                              <h3 className="text-xs font-black text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Smartphone size={16} /> Identity</h3>
                              <div className="grid grid-cols-2 gap-4">
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Confirm Serial Number</label><input type="text" value={qcForm.actual_serial} onChange={e => setQcForm({ ...qcForm, actual_serial: e.target.value })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Confirm IMEI</label><input type="text" placeholder="Scan IMEI..." value={qcForm.actual_imei} onChange={e => setQcForm({ ...qcForm, actual_imei: e.target.value })} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-mono text-sm font-bold outline-none" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Color</label><input type="text" value={qcForm.actual_color} onChange={e => setQcForm({ ...qcForm, actual_color: e.target.value })} placeholder={selectedJob.color} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold" /></div>
                                 <div><label className="text-[10px] font-bold text-slate-400 uppercase">Capacity</label><input type="text" value={qcForm.model_code} onChange={e => setQcForm({ ...qcForm, model_code: e.target.value })} placeholder={selectedJob.capacity} className="w-full mt-1 p-3 rounded-xl border border-slate-200 font-bold" /></div>
                              </div>
                           </section>

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
                           {/* 🔥 ปุ่มนี้จะฉลาดขึ้นตามสถานะการจ่ายเงิน */}
                           {(QC_STATION_STATUSES as readonly string[]).includes(selectedJob.status) && (
                              <button onClick={handleSubmitQC} className="px-8 py-4 bg-blue-600 text-white rounded-xl font-black uppercase text-sm shadow-lg hover:bg-blue-700 active:scale-95 flex items-center gap-2 transition-all">
                                 <Save size={18} />
                                 {(() => {
                                    const isPaid = selectedJob.qc_logs?.some((log: any) => ['Payout Processing', 'Paid', 'PAID', 'Deal Closed (Negotiated)'].includes(log.action));
                                    // ถ้าจ่ายเงินแล้ว หรือเป็นเคส Pickup ให้ขึ้นปุ่มส่งเข้าสต็อก
                                    if (isPaid || selectedJob.receive_method === 'Pickup') return 'Approve & Send to Stock';
                                    // ถ้ายังไม่จ่ายเงิน ให้ขึ้นปุ่มส่งให้ Admin
                                    return 'Submit QC to Admin';
                                 })()}
                              </button>
                           )}
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
                        <div><p className="font-black text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">Specifications</p><p className="font-bold text-black">{qcForm.model_code || selectedJob.capacity || 'N/A'} • {qcForm.actual_color || selectedJob.color || 'N/A'}</p></div>
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