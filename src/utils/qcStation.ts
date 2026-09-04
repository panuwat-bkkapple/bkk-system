// src/utils/qcStation.ts
// Logic กลางของการตรวจ QC — ใช้ร่วมกันระหว่าง desktop (/qc-station, QCStation.tsx)
// และ mobile (/mobile/qc, MobileQCStation.tsx). แก้กติกาการบันทึก/guard ที่นี่ที่เดียว
// เพื่อให้สองหน้าไม่มีวัน drift จากกัน
import { ref, update } from 'firebase/database';
import { db } from '../api/firebase';
import { uploadImageToFirebase } from './uploadImage';
import { unpackAccessoryItemsToStock } from './accessoryItems';
import { getSickwGateStatus } from './sickwApi';
import { JOB_STATUS, normalizeStatus } from '../types/job-statuses';
import { jobWasPaid } from './paidTrail';

export const MAX_QC_PHOTOS = 8;
export const QC_SUPERVISORS = ['Head QC - Somchai', 'Head QC - Wichai'];

// สถานะที่ถือว่าเป็นงานรอตรวจของแผนก QC (ปุ่ม submit โชว์เฉพาะกลุ่มนี้) — canonical
// เท่านั้น ห้าม includes(job.status) ตรงๆ ให้ถามผ่าน canSubmitQc ซึ่ง normalize ก่อน
export const QC_SUBMITTABLE_STATUSES: string[] = [
   JOB_STATUS.PENDING_QC, JOB_STATUS.WAITING_FOR_HANDOVER, JOB_STATUS.SENT_TO_QC_LAB,
];

type QcJobLike = { status?: string | null; receive_method?: string | null; qc_txn_id?: string | null; qc_date?: number | null };

// ช่องค้นหาของสถานี ("Scan Barcode / OID / SN...") — substring ไม่สนตัวพิมพ์
//
// serial ของงานอยู่ได้สองฟิลด์: `serial` (QC Lab เขียนตอนตรวจเสร็จ / B2B unpack)
// กับ `device_serial` (แอปไรเดอร์และการตรวจ IMEI ของแอดมินเขียนตอนตรวจหน้างาน —
// bkk-rider-app RiderApp.tsx, AdminDeviceVerificationModal.tsx). งานที่ *รอ* เข้า
// แล็บซึ่งคือทุกใบใน To Do จึงมักมีแค่ device_serial — ต้องอ่านทั้งคู่
// (ไม่ rename ไม่ backfill ฟิลด์ใดทั้งสิ้น)
const QC_SEARCH_FIELDS = ['model', 'ref_no', 'serial', 'device_serial', 'stock_no', 'qc_txn_id'] as const;

export const matchesQcStationSearch = (job: Record<string, unknown> | null | undefined, term: string): boolean => {
   const q = term.toLowerCase();
   return QC_SEARCH_FIELDS.some((field) => {
      const v = job?.[field];
      return typeof v === 'string' && v.toLowerCase().includes(q);
   });
};

// งานที่รอแผนก QC Lab ตรวจ (แท็บ To Do ของ /qc-station และ /mobile/qc)
//
// เทียบผ่าน normalizeStatus ทั้งสองฝั่ง ไม่ใช่ string literal — status engine
// เขียน canonical 'Sent To QC Lab' (JOB_STATUS.SENT_TO_QC_LAB) ตั้งแต่ปุ่มส่งเข้า
// แล็บย้ายไป transitionJob (#662/#667) ส่วนแถวเก่าใน DB ยังสะกด 'Sent to QC Lab'
// ถาวร. การเทียบ ['Sent to QC Lab'].includes(j.status) แบบเดิมจึงมองไม่เห็นงาน
// ที่ engine เพิ่งเขียนเลยสักใบ (To Do ขึ้น 0 — ดู
// docs/reports/2026-09-04-qc-station-todo-empty-survey.md)
export const isAwaitingQcLab = (job: QcJobLike | null | undefined): boolean =>
   normalizeStatus(job?.status, job?.receive_method) === JOB_STATUS.SENT_TO_QC_LAB;

// ปุ่ม submit ของสถานี — เทียบผ่าน normalizeStatus แบบเดียวกับ To Do ไม่งั้นเปิดงาน
// ที่ engine เขียนได้แต่กดส่งไม่ได้
export const canSubmitQc = (job: QcJobLike | null | undefined): boolean => {
   const canonical = normalizeStatus(job?.status, job?.receive_method);
   return !!canonical && QC_SUBMITTABLE_STATUSES.includes(canonical);
};

export const selectQcTodoList = <T extends QcJobLike>(jobs: T[]): T[] => jobs.filter(isAwaitingQcLab);

// แท็บ Done = งานที่ผ่านสถานีแล้ว (มีเลข qc_txn_id) เรียงล่าสุดก่อน — ไม่เทียบสถานะ
export const selectQcDoneList = <T extends QcJobLike>(jobs: T[]): T[] =>
   jobs.filter((j) => !!j.qc_txn_id).sort((a, b) => (b.qc_date || 0) - (a.qc_date || 0));

export interface QcFormState {
   screen_touch: boolean; screen_display: boolean; truetone: boolean; faceid: boolean;
   camera_front: boolean; camera_rear: boolean; speaker_mic: boolean; wifi_bt: boolean;
   buttons: boolean; charging: boolean;
   part_screen: string; part_battery: string; part_camera: string;
   final_grade: string; battery_health: number; cycle_count: number;
   actual_color: string; capacity: string; model_code: string;
   actual_imei: string; actual_serial: string;
   icloud_off: boolean; find_my_off: boolean; mdm_clear: boolean; sim_unlocked: boolean;
   data_erased: boolean;
   notes: string;
}

export const generateQcTxn = (prefix = 'TXN-QC'): string => {
   const random = Math.floor(1000 + Math.random() * 9000);
   return `${prefix}-${Date.now().toString().slice(-4)}${random}`;
};

// เลขสต๊อกฝั่งดีลเลอร์ (GM-XXXXXX) — regenerate ใหม่ตอน QC ไม่ผูกกับ ref_no (OID)
// ของใบงานรับซื้อ B2C: OID โยงกลับไปหน้าบ้าน (tracking/อีเมลลูกค้า) ซึ่งเปิดเผยราคา
// ที่เรารับซื้อมาได้ — dealer portal เห็นเลขนี้เท่านั้น (lotItemSnapshot ใน
// functions/dealer-portal.js ใช้ stock_no + backfill ให้เครื่องเก่าตอน publish;
// MIRROR format กับ generateStockNo ฝั่งนั้น)
const STOCK_NO_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ตัด 0/O/1/I/L กันอ่านสับสน
export const generateStockNo = (): string => {
   let s = '';
   for (let i = 0; i < 8; i++) {
      s += STOCK_NO_ALPHABET[Math.floor(Math.random() * STOCK_NO_ALPHABET.length)];
   }
   return `GM-${s}`;
};

// เติมฟอร์มจากใบงาน — ใช้ค่าจาก Sickw เฉพาะเมื่อผลตรวจเป็นของเครื่องนี้จริง
// (last_check.imei ตรงกับ imei/serial ของใบงาน) กัน snapshot ที่เคยเขียนผิดเครื่อง
export const buildQcFormFromJob = (job: any): QcFormState => {
   const lc = job.sickw_check?.last_check;
   const jobIds = [job.imei, job.serial].filter(Boolean).map((s: string) => String(s).toUpperCase());
   const checkedId = lc?.imei ? String(lc.imei).toUpperCase() : '';
   const sw = (lc && checkedId && jobIds.includes(checkedId)) ? (lc.parsed || {}) : {};
   return {
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
      // Rider inspection writes battery_health_pct (and mirrors it to
      // battery_health). Read either so the rider's reading auto-fills here.
      battery_health: job.battery_health ?? job.battery_health_pct ?? 100,
      cycle_count: job.qc_details?.cycle_count ?? job.battery_cycle_count ?? 0,
      actual_color: sw.color || job.color || '',
      capacity: sw.capacity || job.capacity || '',
      model_code: sw.modelNumber || job.qc_details?.model_code || job.model_code || '',
      actual_imei: sw.imei || job.imei || '',
      actual_serial: sw.serial || job.serial || '',
      icloud_off: job.qc_details?.icloud_off ?? true,
      find_my_off: job.qc_details?.find_my_off ?? true,
      mdm_clear: job.qc_details?.mdm_clear ?? true,
      sim_unlocked: job.qc_details?.sim_unlocked ?? true,
      data_erased: job.qc_details?.data_erased ?? false,
      notes: job.qc_details?.notes || '',
   };
};

export const isQcFunctionalPass = (f: QcFormState): boolean =>
   f.screen_touch && f.screen_display && f.truetone && f.faceid && f.camera_front &&
   f.camera_rear && f.speaker_mic && f.wifi_bt && f.buttons && f.charging;

// Guard ก่อนบันทึก — คืนข้อความ error (ไทย) หรือ null ถ้าผ่าน. liveJob = ตัวล่าสุด
// จาก realtime (ผลตรวจ Sickw ที่เพิ่งกดจาก panel เขียนลง DB หลังเปิดใบงาน)
export const validateQcSubmit = (qcForm: QcFormState, liveJob: any): string | null => {
   if (!qcForm.data_erased) return 'กรุณายืนยันการล้างข้อมูลก่อนบันทึก';
   // เครื่องบางประเภทไม่มี IMEI (Apple Watch GPS, iPad Wi-Fi) — ยืนยันด้วย Serial ได้
   if (!qcForm.actual_imei?.trim() && !qcForm.actual_serial?.trim()) {
      return 'กรุณาสแกน/กรอก IMEI หรือ Serial เครื่องก่อนบันทึกเข้าคลัง';
   }
   // Sickw Gate — ห้ามส่ง QC pass / เข้าคลังถ้าเครื่องติด FMI/MDM/Blacklist
   const gate = getSickwGateStatus(liveJob?.sickw_check);
   if (gate.blocked) return `IMEI Gate: ${gate.reasons.join(' / ')} — ต้องให้ MANAGER/CEO override ก่อน`;
   return null;
};

// งานนี้เคยจ่ายเงินลูกค้าไปแล้วหรือยัง — ถ้าเคยแล้วห้ามส่งกลับ QC Review (วนลูป)
//
// อ่าน paid_at ก่อน แล้วค่อยดู qc_logs (utils/paidTrail.ts — ตั้งแต่ writer จ่ายเงินย้ายไป
// engine ไทม์ไลน์ของ B2C มี 'Waiting For Handover' ไม่ใช่ 'Paid') สองตัวนี้คือ action
// เพิ่มเฉพาะสถานี: เริ่มจ่ายแล้ว / ปิดดีลด้วยการเจรจา
export const PAID_LOG_ACTIONS = [JOB_STATUS.PAYOUT_PROCESSING, 'Deal Closed (Negotiated)'] as const;
export const isJobAlreadyPaid = (job: any): boolean => jobWasPaid(job, PAID_LOG_ACTIONS);

// อัปโหลดไฟล์รูปเข้า Storage แล้วคืน URL ชุดที่รวมรูปเดิม (เพดาน MAX_QC_PHOTOS)
const uploadQcPhotoFiles = async (
   jobId: string, existingPhotos: string[], photoFiles: File[], onProgress?: (msg: string) => void,
): Promise<string[]> => {
   let qcPhotos = [...existingPhotos];
   if (photoFiles.length > 0) {
      onProgress?.(`กำลังอัปโหลดรูป ${photoFiles.length} รูป...`);
      const uploaded = await Promise.all(photoFiles.map(f =>
         uploadImageToFirebase(f, `jobs/${jobId}/qc/station`, { maxWidthOrHeight: 1600, maxSizeMB: 0.8, opaqueFilename: true })
      ));
      qcPhotos = [...qcPhotos, ...uploaded].slice(0, MAX_QC_PHOTOS);
   }
   return qcPhotos;
};

// บันทึกเฉพาะรูป (ไม่แตะผล QC) — สำหรับงานที่ตรวจเสร็จแล้ว (Done: In Stock/Reserved)
// ซึ่งไม่มีปุ่ม Submit QC ให้กด, หรือช่างอยากเก็บรูปก่อนกรอกฟอร์มเสร็จ
export const saveQcPhotosOnly = async (
   job: any, existingPhotos: string[], photoFiles: File[], onProgress?: (msg: string) => void,
): Promise<string[]> => {
   const qcPhotos = await uploadQcPhotoFiles(job.id, existingPhotos, photoFiles, onProgress);
   await update(ref(db, `jobs/${job.id}`), { qc_photos: qcPhotos.length > 0 ? qcPhotos : null });
   return qcPhotos;
};

export interface QcSubmitInput {
   job: any;                       // ใบงานที่เปิดตรวจ (snapshot ตอนกดเปิด)
   liveJob: any;                   // ตัวล่าสุดจาก realtime (ใช้ตอน unpack accessories)
   qcForm: QcFormState;
   supervisor: string;
   accessorySerials: Record<string, string>;
   existingPhotos: string[];       // URL รูปเดิมที่ยังไม่ถูกลบ
   photoFiles: File[];             // รูปใหม่ที่จะอัปโหลด
   onProgress?: (msg: string) => void;
}

export interface QcSubmitResult {
   nextStatus: string;
   qcTxnId: string;
   unpackedAccessories: number;
}

// บันทึกผล QC — เจ้าของ logic ตัวจริง (desktop + mobile เรียกตัวนี้):
// อัปโหลดรูป → เขียนฟิลด์ QC ลง job (รวม qc_photos ที่ dealer lot snapshot ใช้ต่อ)
// → ถ้าเข้าคลังและมีอุปกรณ์เสริม แตกเป็น stock รายชิ้น
export const submitQcStation = async (input: QcSubmitInput): Promise<QcSubmitResult> => {
   const { job, liveJob, qcForm, supervisor, accessorySerials, existingPhotos, photoFiles, onProgress } = input;
   const qcTxnId = generateQcTxn();

   let nextStatus = 'In Stock';
   let actionLog = 'QC PASSED';
   let detailLog = `ตรวจสอบเรียบร้อย นำสินค้าเข้าคลัง (Grade: ${qcForm.final_grade})`;

   // ถ้ายังไม่เคยจ่ายเงิน และเป็น Mail-in/Store-in → ส่งให้ Admin เคาะราคาก่อน
   if (!isJobAlreadyPaid(job) && (job.receive_method === 'Mail-in' || job.receive_method === 'Store-in')) {
      nextStatus = 'QC Review';
      actionLog = 'QC COMPLETED';
      detailLog = `ช่างตรวจเสร็จสิ้น (Grade: ${qcForm.final_grade}) ส่งผลให้แอดมินประเมินราคา`;
   }

   // อัปโหลดรูปสภาพเครื่อง (หลักฐานสภาพ — ความละเอียดสูงกว่า default เก็บรอยขีดข่วน)
   const qcPhotos = await uploadQcPhotoFiles(job.id, existingPhotos, photoFiles, onProgress);

   const newLogEntry = { action: actionLog, by: supervisor, timestamp: Date.now(), details: detailLog };
   const updatedLogs = [newLogEntry, ...(job.qc_logs || [])];

   // เขียน serial ที่ช่างกรอกกลับเข้า accessory_items — child stock job ได้ serial
   // ติดไปด้วยตอน unpack
   const rawAccessoryItems = Array.isArray(job.accessory_items) ? job.accessory_items.filter(Boolean) : [];
   const updatedAccessoryItems = rawAccessoryItems.map((it: any, i: number) => ({
      ...it,
      serial: (accessorySerials[it.id || String(i)] || '').trim(),
   }));

   await update(ref(db, `jobs/${job.id}`), {
      ...(updatedAccessoryItems.length > 0 ? { accessory_items: updatedAccessoryItems } : {}),
      // ออกเลขสต๊อกฝั่งดีลเลอร์ครั้งแรกที่ QC (ถ้ายังไม่มี — ไม่ regenerate ซ้ำ)
      ...(job.stock_no ? {} : { stock_no: generateStockNo() }),
      status: nextStatus,
      qc_txn_id: qcTxnId,
      qc_passed: isQcFunctionalPass(qcForm),
      qc_date: Date.now(),
      qc_by: supervisor,
      grade: qcForm.final_grade,
      battery_health: qcForm.battery_health,
      // mirror cycle count ขึ้น job root (เดิมเก็บแค่ใน qc_details) ให้ ticket
      // detail / inventory อ่าน battery_cycle_count ได้ตรงๆ
      battery_cycle_count: qcForm.cycle_count,
      color: qcForm.actual_color || job.color,
      capacity: qcForm.capacity || job.capacity,
      model_code: qcForm.model_code || job.model_code,
      serial: qcForm.actual_serial || job.serial,
      imei: qcForm.actual_imei || job.imei,
      // รูปสภาพเครื่อง — dealer lot snapshot ใช้ต่อ (null = ลบทิ้งเมื่อเอาออกหมด)
      qc_photos: qcPhotos.length > 0 ? qcPhotos : null,
      qc_details: qcForm,
      qc_logs: updatedLogs,
   });

   let unpackedAccessories = 0;
   if (nextStatus === 'In Stock') {
      // งานที่ขายพ่วงอุปกรณ์เสริม — แตกเป็น stock รายชิ้น (idempotent ด้วย
      // accessories_unpacked_at) ใช้ items ที่เพิ่งอัปเดต serial
      unpackedAccessories = await unpackAccessoryItemsToStock(
         { ...(liveJob || job), ...(updatedAccessoryItems.length > 0 ? { accessory_items: updatedAccessoryItems } : {}) },
         supervisor
      );
   }

   return { nextStatus, qcTxnId, unpackedAccessories };
};
