import React, { useState } from 'react';
import {
  CheckCircle2, Store, ListChecks, History, Wallet, MessageCircle,
  ExternalLink, Clock, AlertOctagon, XCircle, Send, PhoneCall, Archive,
  Plus, X, PackageOpen, ShieldCheck, Truck, CalendarClock
} from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '@/api/firebase';
import { formatCurrency, formatDate } from '@/utils/formatters';
import { CANCEL_CATEGORY_LABEL_TH, JOB_STATUS } from '@/types/job-statuses';
import type { CancelCategory } from '@/types/job-statuses';
import { parseTimeRange, existingApptDate as getApptDate, buildPickupSchedule } from '@/utils/appointment';
import { RECEIVE_METHOD_OPTIONS, canChangeReceiveMethod, locationLabel, currentLocation, buildMethodLocationFields } from '@/utils/receiveMethod';
import PickupLocationPicker, { geocodeAddress } from '@/components/PickupLocationPicker';

interface PricingSidebarHandlers {
  handleUpdateStatus: (newStatus: string, details: string) => Promise<void>;
  handleCallCustomer: () => Promise<void>;
  handleReviseOffer: () => Promise<void>;
  handleCloseNegotiation: () => Promise<void>;
  handleApplyAdminCoupon: () => Promise<void>;
  handleRemoveCoupon: () => Promise<void>;
  handleSaveNotes: () => Promise<void>;
  handleReopen: (keepRider: boolean) => Promise<void>;
  handleCloseLost: () => Promise<void>;
  handleRecoverHandover: () => Promise<void>;
  setIsQCModalOpen: (open: boolean) => void;
  setIsCancelModalOpen: (open: boolean) => void;
  setActiveChatJobId: (id: string | null) => void;
}

interface CouponState {
  isAddingCoupon: boolean;
  setIsAddingCoupon: (v: boolean) => void;
  adminCouponCode: string;
  setAdminCouponCode: (v: string) => void;
  adminCouponValue: string;
  setAdminCouponValue: (v: string) => void;
  revisedPrice: string;
  setRevisedPrice: (v: string) => void;
  reviseReason: string;
  setReviseReason: (v: string) => void;
  negotiatedPrice: string;
  setNegotiatedPrice: (v: string) => void;
  callNotes: string;
  setCallNotes: (v: string) => void;
}

interface PricingCalculations {
  basePrice: number;
  pickupFee: number;
  couponValue: number;
  netPayout: number;
  isCancelled: boolean;
  isReopenable: boolean;
  reopenDeadline: number | null;
  needsFeeRecovery: boolean;
  isNew: boolean;
  isLogistics: boolean;
  isQC: boolean;
  isNegotiation: boolean;
  isProcessingPayment: boolean;
  hasBeenPaid: boolean;
}

interface PricingSidebarProps {
  job: any;
  handlers: PricingSidebarHandlers;
  couponState: CouponState;
  pricing: PricingCalculations;
  currentUserName: string;
}

export const PricingSidebar: React.FC<PricingSidebarProps> = ({
  job, handlers, couponState, pricing, currentUserName
}) => {
  const {
    handleUpdateStatus, handleCallCustomer, handleReviseOffer,
    handleCloseNegotiation, handleApplyAdminCoupon, handleRemoveCoupon,
    handleSaveNotes, handleReopen, handleCloseLost, handleRecoverHandover,
    setIsQCModalOpen, setIsCancelModalOpen, setActiveChatJobId
  } = handlers;

  const {
    isAddingCoupon, setIsAddingCoupon,
    adminCouponCode, setAdminCouponCode,
    adminCouponValue, setAdminCouponValue,
    revisedPrice, setRevisedPrice,
    reviseReason, setReviseReason,
    negotiatedPrice, setNegotiatedPrice,
    callNotes, setCallNotes
  } = couponState;

  const {
    basePrice, pickupFee, couponValue, netPayout,
    isCancelled, isReopenable, reopenDeadline, needsFeeRecovery, isNew, isLogistics, isQC, isNegotiation,
    isProcessingPayment, hasBeenPaid
  } = pricing;

  const reopenDaysLeft = reopenDeadline
    ? Math.max(0, Math.ceil((reopenDeadline - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  const statusLower = String(job.status || '').trim().toLowerCase();

  // Store-in appointment scheduler. Reuses the `pickup_schedule` field
  // (same shape as Pickup) so the calendar/list code paths don't need a
  // separate field. Customers picking Store-in at /sell don't get a time
  // slot, so admin has to set it themselves; without this scheduler the
  // job had no calendar entry and admin had no way to add one.
  const existingApptDate = getApptDate(job.pickup_schedule);
  const existingRange = parseTimeRange(job.pickup_schedule);
  const existingApptTime = job.pickup_schedule?.time && job.pickup_schedule.time !== 'Instant' ? job.pickup_schedule.time : '';
  const [apptDate, setApptDate] = useState(existingApptDate);
  const [apptStart, setApptStart] = useState(existingRange.start);
  const [apptEnd, setApptEnd] = useState(existingRange.end);
  const [savingAppt, setSavingAppt] = useState(false);

  // Trade method change. Client writes method + location only; pricing
  // (pickup_fee/net_payout) and rider withdrawal are reconciled server-side by
  // the onReceiveMethodChanged Cloud Function.
  const [methodEdit, setMethodEdit] = useState(job.receive_method || '');
  const [methodLoc, setMethodLoc] = useState(currentLocation(job));
  const [methodLat, setMethodLat] = useState<number | undefined>(typeof job.cust_lat === 'number' ? job.cust_lat : undefined);
  const [methodLng, setMethodLng] = useState<number | undefined>(typeof job.cust_lng === 'number' ? job.cust_lng : undefined);
  const [savingMethod, setSavingMethod] = useState(false);

  const handleSaveMethod = async () => {
    const newMethod = methodEdit || job.receive_method;
    if (newMethod === job.receive_method || !canChangeReceiveMethod(job.status)) return;
    setSavingMethod(true);
    try {
      // Switching to Pickup: the rider navigates by cust_lat/cust_lng, so send a
      // pin. Prefer the one the admin set; otherwise geocode the address. Don't
      // leave a stale pin from a previous Pickup — clear it if we have none.
      let pinFields: Record<string, number | null> = {};
      if (newMethod === 'Pickup') {
        let lat = methodLat;
        let lng = methodLng;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          const coords = await geocodeAddress(methodLoc);
          if (coords) { lat = coords.lat; lng = coords.lng; }
        }
        pinFields = (typeof lat === 'number' && typeof lng === 'number')
          ? { cust_lat: lat, cust_lng: lng }
          : { cust_lat: null, cust_lng: null };
      }
      await update(ref(db, `jobs/${job.id}`), {
        receive_method: newMethod,
        ...buildMethodLocationFields(newMethod, methodLoc),
        ...pinFields,
        qc_logs: [
          {
            action: 'Trade Method Changed',
            by: currentUserName,
            timestamp: Date.now(),
            details: `เปลี่ยนวิธีรับจาก ${job.receive_method || '-'} เป็น ${newMethod} — ระบบจะคำนวณค่าธรรมเนียม/ยอดโอนใหม่อัตโนมัติ`,
          },
          ...(job.qc_logs || []),
        ],
        updated_at: Date.now(),
      });
    } finally {
      setSavingMethod(false);
    }
  };

  const handleSaveAppointment = async () => {
    if (!apptDate || !apptStart) return;
    if (apptEnd && apptEnd <= apptStart) return;
    setSavingAppt(true);
    try {
      const hadSchedule = !!existingApptDate;
      const rangeLabel = apptEnd ? `${apptStart} - ${apptEnd}` : apptStart;
      const updates: Record<string, unknown> = {
        pickup_schedule: buildPickupSchedule(apptDate, apptStart, apptEnd, hadSchedule),
        qc_logs: [
          {
            action: hadSchedule ? 'Appointment Rescheduled' : 'Appointment Set',
            by: currentUserName,
            timestamp: Date.now(),
            details: `${hadSchedule ? 'เลื่อนนัดหมายเป็น' : 'นัดหมาย'} ${apptDate} ${rangeLabel}`,
          },
          ...(job.qc_logs || []),
        ],
        updated_at: Date.now(),
      };
      // Only flip the status when we're setting an appointment for the
      // first time on a Pickup / Store-in New Lead / Following Up — Mail-in
      // flows via tracking_number → In-Transit → Pending QC and
      // shouldn't get pulled into the Appointment Set branch.
      const lower = (job.status || '').trim().toLowerCase();
      if (
        !hadSchedule &&
        (job.receive_method === 'Store-in' || job.receive_method === 'Pickup') &&
        (lower === 'new lead' || lower === 'following up')
      ) {
        updates.status = JOB_STATUS.APPOINTMENT_SET;
      }
      await update(ref(db, `jobs/${job.id}`), updates);
    } finally {
      setSavingAppt(false);
    }
  };

  return (
    <div className="w-[450px] bg-white border-l border-slate-200 flex flex-col shadow-2xl z-20 shrink-0">
      <div className="p-8 bg-slate-900 text-white relative shrink-0">
        <div className={`absolute top-0 right-0 w-32 h-32 blur-3xl rounded-full -mr-10 -mt-10 ${isCancelled ? 'bg-red-600/20' : isNegotiation ? 'bg-orange-600/20' : 'bg-blue-600/20'}`}></div>

        <div className="relative z-10">
          <div className="space-y-3 mb-6 pb-6 border-b border-white/10">
            {job.initial_customer_price && job.initial_customer_price !== basePrice && (
              <div className="flex justify-between items-center text-[11px] font-bold text-slate-400 mb-3 pb-3 border-b border-white/5">
                <span>ราคาที่ลูกค้าประเมินจากเว็บ (Initial Quote)</span>
                <span className="line-through">{formatCurrency(job.initial_customer_price)}</span>
              </div>
            )}
            {/* "Current Quote" instead of "Current Base" — this value is
                job.final_price (already net of QC deductions / negotiation),
                NOT the pre-deduction usedPrice. Calling it "Base" used to
                mislead admin into Negotiation re-deducting from an
                already-deducted number. Customer's pre-QC quote is shown
                above as Initial Quote when it differs. */}
            <div className="flex justify-between items-center text-sm font-bold text-slate-200">
              <span>ราคาประเมินปัจจุบัน (Current Quote)</span>
              <span>{formatCurrency(basePrice)}</span>
            </div>

            {job.receive_method === 'Pickup' && pickupFee > 0 && (
              <div className="flex justify-between items-center text-sm font-bold text-red-400">
                <span>หักค่าบริการไรเดอร์ (Rider Fee)</span>
                <span>- {formatCurrency(pickupFee)}</span>
              </div>
            )}

            {couponValue > 0 && (
              <div className="flex justify-between items-center text-sm font-bold text-emerald-400">
                <span className="flex items-center gap-2">
                  <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-widest border border-emerald-500/30">Coupon</span>
                  <span className="text-xs">{job.applied_coupon?.code || 'Manual Top-up'}</span>
                </span>
                <span>+{formatCurrency(couponValue)}</span>
              </div>
            )}
          </div>

          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">ยอดโอนสุทธิ (NET PAYOUT TO CUSTOMER)</p>
          <div className="flex items-baseline gap-2">
            <span className={`text-5xl font-black tracking-tighter ${isCancelled ? 'text-red-400 line-through' : 'text-white'}`}>
              {formatCurrency(netPayout)}
            </span>
            <span className="text-xs font-bold text-slate-400">THB</span>
          </div>
        </div>

        {isCancelled ? (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 relative z-10">
            <div className="p-2 bg-red-500 rounded-lg text-white shrink-0"><XCircle size={16} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase text-red-500 tracking-wider">ออเดอร์ถูกยกเลิก</p>
              {job.cancel_category && (
                <p className="text-[10px] font-black text-red-600 mt-0.5">
                  {CANCEL_CATEGORY_LABEL_TH[job.cancel_category as CancelCategory] || job.cancel_category}
                </p>
              )}
              {job.cancel_reason && (
                <p className="text-[9px] font-bold text-red-400/80 mt-0.5 break-words">{job.cancel_reason}</p>
              )}
              {!job.cancel_category && !job.cancel_reason && (
                <p className="text-[9px] font-bold text-red-400/80 mt-0.5">ไม่มีเหตุผลที่บันทึกไว้</p>
              )}
            </div>
          </div>
        ) : isProcessingPayment ? (
          <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 relative z-10">
            <div className="p-2 bg-amber-500 rounded-lg text-white"><Clock size={16} className="animate-pulse" /></div>
            <div>
              <p className="text-[11px] font-black uppercase text-amber-500 tracking-wider">Waiting for Finance</p>
              <p className="text-[9px] font-bold text-amber-500/70 mt-0.5">รอแผนกบัญชีตรวจสอบและโอนเงิน</p>
            </div>
          </div>
        ) : hasBeenPaid ? (
          <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 relative z-10">
            <div className="p-2 bg-emerald-500 rounded-lg text-white"><CheckCircle2 size={16} /></div>
            <p className="text-[10px] font-black uppercase text-emerald-400 tracking-wider">โอนเงินสำเร็จเรียบร้อยแล้ว</p>
          </div>
        ) : (
          <div className="mt-6 h-6"></div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar bg-slate-50">

        {/* Coupon section */}
        {!isCancelled && !hasBeenPaid && (
          <div className="mb-4 border-b border-slate-200 pb-6">
            {job.applied_coupon ? (
              <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex justify-between items-center transition-all group">
                <div>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Applied Coupon</p>
                  <p className="text-sm font-black text-emerald-800">{job.applied_coupon.code}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-black text-emerald-600">+{job.applied_coupon.actual_value || job.applied_coupon.value} ฿</p>
                  <button onClick={handleRemoveCoupon} className="p-1.5 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="นำคูปองออก"><X size={14} /></button>
                </div>
              </div>
            ) : (
              !isAddingCoupon ? (
                <button onClick={() => setIsAddingCoupon(true)} className="w-full py-3.5 bg-white hover:bg-slate-50 border border-slate-200 border-dashed text-slate-500 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm">
                  <Plus size={14} /> เพิ่มคูปอง / Manual Top-up (Admin)
                </button>
              ) : (
                <div className="bg-white border border-slate-200 p-4 rounded-2xl space-y-3 animate-in zoom-in-95 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Admin Manual Top-up</p>
                    <button onClick={() => setIsAddingCoupon(false)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={14} /></button>
                  </div>
                  <div className="flex gap-2">
                    <input type="text" placeholder="ชื่อโค้ด / เหตุผล" value={adminCouponCode} onChange={e => setAdminCouponCode(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400" />
                    <div className="relative w-28">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-500 font-bold text-xs">+</span>
                      <input type="number" placeholder="0" value={adminCouponValue} onChange={e => setAdminCouponValue(e.target.value)} className="w-full bg-slate-50 border border-slate-200 pl-6 pr-2 py-2.5 rounded-xl text-xs font-black outline-none focus:border-emerald-400 text-emerald-600" />
                    </div>
                  </div>
                  <button onClick={handleApplyAdminCoupon} disabled={!adminCouponCode || !adminCouponValue} className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-xl text-xs font-black uppercase transition-all disabled:opacity-50 active:scale-95">Apply Top-up</button>
                </div>
              )
            )}
          </div>
        )}

        {/* Mail-in Operations — visible from New Lead so admin can act
            on a fresh ticket without needing to claim first. */}
        {!isCancelled && job.receive_method === 'Mail-in' && isNew && !job.tracking_number && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Truck size={14} /> Mail-In Operations</p>
            <button onClick={handleCallCustomer} className="w-full py-3.5 bg-green-500 hover:bg-green-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-green-200 transition-all active:scale-95 flex justify-center items-center gap-2">
              <PhoneCall size={16} /> โทรแนะนำขนส่ง (Follow Up)
            </button>
            <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl">
              <p className="text-[10px] font-bold text-orange-600 flex items-center gap-2"><PackageOpen size={14} /> ขั้นตอนถัดไป: กรอกเลข Tracking Number ที่ส่วน Logistics ด้านซ้าย</p>
              <p className="text-[9px] font-bold text-orange-400 mt-1">เมื่อบันทึก Tracking แล้ว สถานะจะเปลี่ยนเป็น In-Transit อัตโนมัติ</p>
            </div>
          </div>
        )}

        {/* Mail-in Receiving */}
        {!isCancelled && job.receive_method === 'Mail-in' && (statusLower === 'in-transit' || statusLower === 'parcel in transit' || (job.tracking_number && ['new lead', 'following up', 'appointment set', 'waiting drop-off', 'awaiting shipping', 'active leads', 'active lead'].includes(statusLower))) && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><PackageOpen size={14} /> Mail-In Receiving</p>
            <button
              onClick={async () => {
                if(confirm('ยืนยันว่าได้รับพัสดุจากลูกค้าแล้วใช่หรือไม่?')) {
                  await update(ref(db, `jobs/${job.id}`), {
                    status: 'Pending QC',
                    qc_logs: [
                      { action: 'Package Received', by: currentUserName, timestamp: Date.now(), details: 'แอดมินได้รับพัสดุแล้ว เตรียมเข้าสู่กระบวนการ QC' },
                      ...(job.qc_logs || [])
                    ],
                    updated_at: Date.now()
                  });
                }
              }}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 transition-all active:scale-95 flex justify-center items-center gap-2"
            >
              <PackageOpen size={18} /> ยืนยันได้รับพัสดุ + พร้อมตรวจ
            </button>
            <button
              onClick={async () => {
                await update(ref(db, `jobs/${job.id}`), {
                  status: 'Parcel Received',
                  qc_logs: [
                    { action: 'Parcel Received', by: currentUserName, timestamp: Date.now(), details: 'รับพัสดุที่หน้างาน รอเปิดและตรวจ' },
                    ...(job.qc_logs || [])
                  ],
                  updated_at: Date.now()
                });
              }}
              className="w-full py-3 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
            >
              รับพัสดุไว้ก่อน (ยังไม่เปิด)
            </button>
          </div>
        )}

        {/* Mail-in expected arrival — admin's best guess at when the
            parcel will reach the branch, separate from Thai Post's
            real-time tracking. Lets the appointment calendar show
            "X parcels expected this Friday" so ops can plan QC slots.
            Saved into pickup_schedule (same shape as Pickup/Store-in)
            so calendar/list code paths stay uniform. Doesn't touch
            status — Mail-in flips via tracking_number → In-Transit.
            Visible for any non-cancelled Mail-in so admin can also
            back-fill the date on parcels already in QC. */}
        {!isCancelled && job.receive_method === 'Mail-in' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><CalendarClock size={14} /> Expected Arrival</p>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">วันและเวลาที่คาดว่าพัสดุจะถึง</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
                <input
                  type="time"
                  value={apptStart}
                  onChange={(e) => setApptStart(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
                <input
                  type="time"
                  value={apptEnd}
                  onChange={(e) => setApptEnd(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px] font-bold text-slate-400 uppercase tracking-wider -mt-1">
                <span>วันที่</span><span>เริ่ม</span><span>สิ้นสุด (ไม่บังคับ)</span>
              </div>
              {existingApptDate && (
                <p className="text-[10px] font-bold text-emerald-600">
                  คาดว่าจะถึง: {existingApptDate} เวลา {existingApptTime || '—'}
                </p>
              )}
              <button
                onClick={handleSaveAppointment}
                disabled={!apptDate || !apptStart || savingAppt}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2"
              >
                <CalendarClock size={16} />
                {savingAppt
                  ? 'กำลังบันทึก...'
                  : existingApptDate
                    ? 'อัปเดตวันคาดว่าจะถึง'
                    : 'บันทึกวันคาดว่าจะถึง'}
              </button>
            </div>
          </div>
        )}

        {/* Parcel received — opened + ready for QC */}
        {!isCancelled && statusLower === 'parcel received' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><PackageOpen size={14} /> รอเปิดพัสดุ + ตรวจสภาพ</p>
            <button
              onClick={() => handleUpdateStatus('Pending QC', 'เปิดพัสดุและพร้อมเข้ากระบวนการ QC')}
              className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-orange-200 transition-all active:scale-95 flex justify-center items-center gap-2"
            >
              <PackageOpen size={18} /> เปิดพัสดุ + พร้อมตรวจ (Pending QC)
            </button>
          </div>
        )}

        {/* Pickup / Store-in dispatch operations — visible from New Lead
            so admin can call the customer first, then explicitly
            broadcast (Pickup → Active Lead) or set the appointment
            (Store-in → Appointment Set). Active Lead is the trigger
            that broadcasts the job to riders' incoming list. */}
        {!isCancelled && isNew && job.receive_method === 'Pickup' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Send size={14} /> Dispatch Operations</p>
            <button onClick={handleCallCustomer} className="w-full py-3.5 bg-green-500 hover:bg-green-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-green-200 transition-all active:scale-95 flex justify-center items-center gap-2">
              <PhoneCall size={16} /> โทรคอนเฟิร์มลูกค้า (Follow Up)
            </button>
            <button
              onClick={() => {
                // Pickup: broadcast to riders. Works from any pre-rider
                // status (New Lead, Following Up, Appointment Set) so
                // admin can dispatch as soon as they're ready.
                handleUpdateStatus(JOB_STATUS.ACTIVE_LEAD, 'ส่งงานให้พนักงานเข้ารับเครื่อง');
              }}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2"
            >
              จ่ายงานให้ไรเดอร์ (Dispatch Rider)
            </button>
          </div>
        )}

        {/* Trade method changer — switching recalculates fee/payout and
            withdraws any assigned rider (handled server-side by
            onReceiveMethodChanged). */}
        {!isCancelled && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Truck size={14} /> Trade Method</p>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {RECEIVE_METHOD_OPTIONS.map((opt) => {
                  const active = methodEdit === opt.id;
                  const locked = !canChangeReceiveMethod(job.status);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={locked && !active}
                      onClick={() => { setMethodEdit(opt.id); setMethodLoc(currentLocation(job)); }}
                      className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-all ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'} ${locked && !active ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {!canChangeReceiveMethod(job.status) ? (
                <p className="text-[10px] font-bold text-amber-600">เปลี่ยนวิธีรับไม่ได้ในสถานะนี้ (งานเข้าสู่ขั้นรับเครื่อง/จ่ายเงินแล้ว)</p>
              ) : methodEdit !== job.receive_method ? (
                <>
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{locationLabel(methodEdit)}</p>
                    <textarea
                      value={methodLoc}
                      onChange={(e) => setMethodLoc(e.target.value)}
                      rows={2}
                      className="w-full bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400 resize-none"
                    />
                  </div>
                  {methodEdit === 'Pickup' && (
                    <PickupLocationPicker
                      address={methodLoc}
                      lat={methodLat}
                      lng={methodLng}
                      onChange={({ lat, lng }) => { setMethodLat(lat); setMethodLng(lng); }}
                    />
                  )}
                  <p className="text-[10px] font-bold text-blue-600">ระบบจะคำนวณค่าไรเดอร์/ยอดโอนใหม่อัตโนมัติหลังบันทึก{job.receive_method === 'Pickup' ? ' และถอนงานจากไรเดอร์ที่ถืออยู่' : ''}</p>
                  <button
                    onClick={handleSaveMethod}
                    disabled={savingMethod}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2"
                  >
                    <Truck size={16} /> {savingMethod ? 'กำลังบันทึก...' : `เปลี่ยนเป็น ${methodEdit}`}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* Pickup appointment scheduler — lets admin set or reschedule the
            pickup time window for a Pickup job. Visible for any non-cancelled
            Pickup ticket so an urgent ("รับด่วน") job that a rider couldn't
            reach in time can be moved to a new day/time, and a pre-booked
            slot can be changed. Writes pickup_schedule (range), same shape as
            Store-in/Mail-in, so the calendar and customer tracking stay in sync. */}
        {!isCancelled && job.receive_method === 'Pickup' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><CalendarClock size={14} /> Pickup Appointment</p>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">วันและช่วงเวลานัดรับเครื่อง</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
                <input
                  type="time"
                  value={apptStart}
                  onChange={(e) => setApptStart(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
                <input
                  type="time"
                  value={apptEnd}
                  onChange={(e) => setApptEnd(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px] font-bold text-slate-400 uppercase tracking-wider -mt-1">
                <span>วันที่</span><span>เริ่ม</span><span>สิ้นสุด (ไม่บังคับ)</span>
              </div>
              {existingApptDate && (
                <p className="text-[10px] font-bold text-emerald-600">
                  นัดปัจจุบัน: {existingApptDate} เวลา {existingApptTime || '—'}
                </p>
              )}
              <button
                onClick={handleSaveAppointment}
                disabled={!apptDate || !apptStart || savingAppt}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2"
              >
                <CalendarClock size={16} />
                {savingAppt
                  ? 'กำลังบันทึก...'
                  : existingApptDate
                    ? 'อัปเดตเวลานัดรับ'
                    : 'ยืนยันเวลานัดรับ'}
              </button>
            </div>
          </div>
        )}

        {/* Store-in appointment scheduler — customers picking Store-in
            at /sell don't get a time slot, so admin enters it here.
            Visible for any non-cancelled Store-in ticket so admin can:
              - set an appointment on a fresh ticket (sales phase)
              - reschedule after Appointment Set
              - back-fill the appointment time on a same-day walk-in
                that's already moved past sales (e.g. registered &
                received today — picker would otherwise disappear and
                the calendar would have no record). */}
        {!isCancelled && job.receive_method === 'Store-in' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><CalendarClock size={14} /> Store Appointment</p>
            <button onClick={handleCallCustomer} className="w-full py-3.5 bg-green-500 hover:bg-green-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-green-200 transition-all active:scale-95 flex justify-center items-center gap-2">
              <PhoneCall size={16} /> โทรคอนเฟิร์มลูกค้า (Follow Up)
            </button>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">วันและเวลานัดเข้าสาขา</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="date"
                  value={apptDate}
                  onChange={(e) => setApptDate(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
                <input
                  type="time"
                  value={apptStart}
                  onChange={(e) => setApptStart(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
                <input
                  type="time"
                  value={apptEnd}
                  onChange={(e) => setApptEnd(e.target.value)}
                  className="bg-white border border-slate-200 px-3 py-2.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px] font-bold text-slate-400 uppercase tracking-wider -mt-1">
                <span>วันที่</span><span>เริ่ม</span><span>สิ้นสุด (ไม่บังคับ)</span>
              </div>
              {existingApptDate && (
                <p className="text-[10px] font-bold text-emerald-600">
                  นัดปัจจุบัน: {existingApptDate} เวลา {existingApptTime || '—'}
                </p>
              )}
              <button
                onClick={handleSaveAppointment}
                disabled={!apptDate || !apptStart || savingAppt}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2"
              >
                <CalendarClock size={16} />
                {savingAppt
                  ? 'กำลังบันทึก...'
                  : existingApptDate
                    ? 'อัปเดตเวลานัดหมาย'
                    : 'ยืนยันนัดหมาย (Appointment Set)'}
              </button>
            </div>
          </div>
        )}

        {/* Rider Logistics Phase (Assigned / Accepted / Arrived) */}
        {!isCancelled && isLogistics && (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Truck size={14} /> Rider Logistics</p>
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
              <p className="text-[10px] font-bold text-blue-600 flex items-center gap-2">
                <Truck size={14} />
                {(statusLower === 'assigned' || statusLower === 'rider assigned') && 'รอไรเดอร์กดรับงาน'}
                {(statusLower === 'accepted' || statusLower === 'rider accepted') && 'ไรเดอร์รับงานแล้ว'}
                {statusLower === 'rider en route' && 'ไรเดอร์กำลังเดินทางไปลูกค้า'}
                {(statusLower === 'arrived' || statusLower === 'rider arrived') && 'ไรเดอร์ถึงจุดนัดหมายแล้ว'}
              </p>
              {job.assigned_rider_name && (
                <p className="text-[9px] font-bold text-blue-400 mt-1">Rider: {job.assigned_rider_name}</p>
              )}
            </div>
            {statusLower !== 'arrived' && statusLower !== 'rider arrived' && (
              <button
                onClick={() => handleUpdateStatus(JOB_STATUS.RIDER_ARRIVED, 'ไรเดอร์ถึงจุดนัดหมายแล้ว')}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all active:scale-95 flex justify-center items-center gap-2"
              >
                <Truck size={16} /> ไรเดอร์ถึงแล้ว (Mark Arrived)
              </button>
            )}
            <button
              onClick={() => handleUpdateStatus('Being Inspected', 'เริ่มตรวจสอบสภาพเครื่อง')}
              className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-purple-200 transition-all active:scale-95 flex justify-center items-center gap-2"
            >
              <ListChecks size={16} /> เริ่มตรวจสภาพเครื่อง (Start QC)
            </button>
          </div>
        )}

        {/* Store-in appointment confirmed */}
        {!isCancelled && (statusLower === 'appointment set' || statusLower === 'waiting drop-off') && job.receive_method === 'Store-in' && (
          <div className="space-y-3 mt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Store size={14} /> Store Operations</p>
            <button
              onClick={() => handleUpdateStatus('Being Inspected', 'ลูกค้ามาถึงสาขา แอดมินเริ่มประเมินสภาพเครื่อง')}
              className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-purple-200 transition-all active:scale-95 flex justify-center items-center gap-2"
            >
              <Store size={18} /> ลูกค้ามาถึงสาขา + เริ่มตรวจสภาพ
            </button>
            <button
              onClick={() => handleUpdateStatus('Drop-off Received', 'รับเครื่องที่เคาน์เตอร์ รอตรวจ')}
              className="w-full py-3 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
            >
              รับเครื่องไว้ก่อน (ยังไม่ตรวจ)
            </button>
          </div>
        )}

        {/* Drop-off received — device on counter, ready for QC */}
        {!isCancelled && statusLower === 'drop-off received' && (
          <div className="space-y-3 mt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Store size={14} /> รับเครื่องแล้ว — รอตรวจ</p>
            <button
              onClick={() => handleUpdateStatus('Being Inspected', 'เริ่มประเมินสภาพเครื่องที่รับไว้แล้ว')}
              className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-purple-200 transition-all active:scale-95 flex justify-center items-center gap-2"
            >
              <Store size={18} /> เริ่มตรวจสภาพ QC
            </button>
          </div>
        )}

        {/* QC Phase */}
        {!isCancelled && isQC && !hasBeenPaid && (
          <div className="space-y-4 mt-4">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ListChecks size={14} /> Quality Control Phase</p>
            <button onClick={() => setIsQCModalOpen(true)} className="w-full flex items-center justify-between p-4 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100 hover:bg-blue-100 transition-all font-black text-xs uppercase">
              <span>{job.receive_method === 'Pickup' ? 'ตรวจสอบผลจากไรเดอร์' : 'เริ่มตรวจสภาพเครื่อง (QC)'}</span><ListChecks size={18} />
            </button>

            <div className="space-y-3 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4"><Wallet size={14} className="text-blue-500" /> หักลบตำหนิ (Revised Offer)</p>
              <div className="space-y-3">
                <input type="number" value={revisedPrice} onChange={e => setRevisedPrice(e.target.value)} placeholder="ระบุราคาประเมินใหม่..." className="w-full bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-sm font-black outline-none focus:border-blue-400 focus:bg-white" />
                <textarea value={reviseReason} onChange={e => setReviseReason(e.target.value)} placeholder="ระบุเหตุผลที่หักราคา..." className="w-full bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-xs font-bold min-h-[80px] outline-none focus:border-blue-400 focus:bg-white" />
                <button onClick={handleReviseOffer} className="w-full py-3.5 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase hover:bg-black transition-colors">ส่งราคาใหม่ให้ลูกค้า</button>
              </div>
            </div>

            <button onClick={() => handleUpdateStatus('Payout Processing', 'Approve Order')} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 transition-all active:scale-95 flex justify-center items-center gap-2 mt-4">
              <CheckCircle2 size={16} /> สภาพผ่านเกณฑ์ (Approve)
            </button>
          </div>
        )}

        {/* Negotiation Phase */}
        {!isCancelled && isNegotiation && !hasBeenPaid && (
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 p-4 rounded-3xl animate-in slide-in-from-right-4">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-2 mb-2"><AlertOctagon size={14} /> Human Intervention</p>
              <p className="text-xs font-bold text-orange-800 mb-4 leading-relaxed">ลูกค้าปฏิเสธราคาใหม่ กรุณาติดต่อลูกค้าเพื่อเจรจาต่อรอง (Negotiation Phase)</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <PhoneCall size={16} className="text-slate-400" />
                  <input type="number" value={negotiatedPrice} onChange={e => setNegotiatedPrice(e.target.value)} placeholder="ระบุราคาประเมินปิดดีล..." className="w-full bg-white border border-orange-100 p-3.5 rounded-xl text-sm font-black outline-none focus:border-orange-400" />
                </div>
                <button onClick={handleCloseNegotiation} className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md">
                  ตกลงราคาได้ (ปิดการขาย)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Post-Payment Handover */}
        {!isCancelled && hasBeenPaid && statusLower !== 'sent to qc lab' && statusLower !== 'in stock' && (
          job.receive_method === 'Pickup' && statusLower !== 'pending qc' ? (
            // Pickup: the device is still with the rider until they hand it over
            // at the branch (status → Pending QC, which also computes the rider
            // fee). Block the QC-lab jump here so a fast click can't strand the
            // rider's job and skip their pay. Admin can confirm the handover on
            // the rider's behalf if needed — that still routes through Pending QC.
            <div className="space-y-3">
              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-2"><Truck size={14} /> รอไรเดอร์ส่งมอบเครื่อง</p>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
                <p className="text-xs font-black text-amber-800">เครื่องยังอยู่กับไรเดอร์</p>
                <p className="text-[11px] font-bold text-amber-700/80 leading-relaxed">
                  รอไรเดอร์เดินทางกลับและส่งมอบเครื่องที่สาขา ระบบจะคำนวณค่าวิ่งให้ไรเดอร์ตอนรับเข้า (Pending QC) — ยังส่งเข้า QC Lab ไม่ได้จนกว่าจะรับเครื่องจริง
                </p>
              </div>
              <button onClick={() => handleUpdateStatus('Pending QC', 'แอดมินยืนยันรับมอบเครื่องจากไรเดอร์ที่สาขา')} className="w-full flex items-center justify-between p-4 bg-emerald-600 text-white rounded-2xl shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all font-black text-xs uppercase tracking-widest">
                <span>ยืนยันไรเดอร์ส่งมอบเครื่องแล้ว (รับเข้าสาขา)</span><PackageOpen size={18} />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ListChecks size={14} /> Post-Payment / Handover</p>
              <button onClick={() => setIsQCModalOpen(true)} className="w-full flex items-center justify-between p-4 bg-blue-50 text-blue-700 rounded-2xl border border-blue-100 hover:bg-blue-100 transition-all font-black text-xs uppercase">
                <span>ตรวจสอบเครื่อง (Internal QC)</span><ListChecks size={18} />
              </button>
              <button onClick={() => handleUpdateStatus('Sent to QC Lab', 'รับมอบเครื่องและส่งเข้าห้องแล็บ')} className="w-full flex items-center justify-between p-4 bg-purple-600 text-white rounded-2xl shadow-lg shadow-purple-200 hover:bg-purple-700 transition-all font-black text-xs uppercase tracking-widest">
                <span>Send to QC LAB (ส่งเข้าแล็บ)</span><ShieldCheck size={18} />
              </button>
            </div>
          )
        )}

        {!isCancelled && statusLower === 'sent to qc lab' && (
          <div className="p-6 bg-purple-50 border border-purple-100 rounded-[2rem] flex flex-col items-center justify-center gap-2 text-center animate-in zoom-in-95 mt-4">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center text-purple-500 mb-2"><Archive size={32} className="animate-pulse" /></div>
            <p className="text-sm font-black uppercase text-purple-700 tracking-wider">รอแผนก QC LAB ตรวจสอบ</p>
            <p className="text-[10px] font-bold text-purple-500">เครื่องอยู่ระหว่างการบันทึกรายการ คัดเกรด ระบุตำหนิ S/N, IMEI และล้างข้อมูล</p>
            <p className="text-[9px] font-bold text-purple-400 mt-1">เมื่อ QC Lab ดำเนินการเสร็จ สถานะจะเปลี่ยนเป็น In Stock อัตโนมัติ</p>
          </div>
        )}

        {!isCancelled && statusLower === 'in stock' && (
          <div className="p-6 bg-slate-100/50 border border-slate-200 rounded-[2rem] flex flex-col items-center justify-center gap-2 text-center animate-in zoom-in-95 mt-4">
            <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center text-slate-400 mb-2"><PackageOpen size={32} /></div>
            <p className="text-sm font-black uppercase text-slate-800 tracking-wider">ออเดอร์นี้เสร็จสมบูรณ์</p>
            <p className="text-[10px] font-bold text-slate-500">เครื่องถูกล้างข้อมูลและนำเข้าคลังสินค้าเรียบร้อย</p>
          </div>
        )}

        {/* Recovery — a Pickup job that was advanced past handover without the
            rider fee being computed (the skip bug). Rewind to Pending QC so the
            fee function runs and the rider gets paid; admin re-advances after. */}
        {!isCancelled && needsFeeRecovery && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-2 mt-4">
            <p className="text-[10px] font-black uppercase text-rose-600 tracking-wider flex items-center gap-2"><AlertOctagon size={14} /> ค่าวิ่งไรเดอร์ยังไม่ถูกคำนวณ</p>
            <p className="text-[11px] font-bold text-rose-700/80 leading-relaxed">
              งานนี้ถูกข้ามขั้นส่งมอบ (Pending QC) ไรเดอร์จึงยังไม่ได้ค่าวิ่ง กดเพื่อรับมอบย้อนหลัง — ระบบจะคำนวณค่าวิ่งให้ไรเดอร์ แล้วค่อยส่งเข้า QC Lab ใหม่
            </p>
            <button onClick={handleRecoverHandover} className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
              รับมอบย้อนหลัง + คำนวณค่าวิ่ง (→ Pending QC)
            </button>
          </div>
        )}

        {/* Timeline */}
        <div className="space-y-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><History size={14} /> Activity Timeline</p>
          <div className="space-y-5 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200 ml-1">
            {(job.qc_logs || []).map((log: any, i: number) => (
              <div key={i} className="flex gap-4 relative">
                <div className={`w-5 h-5 rounded-full border-[3px] border-[#F8FAFC] shadow-sm z-10 shrink-0 ${i === 0 ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm w-full">
                  <p className={`text-[10px] font-black uppercase mb-1 ${log.action === 'Cancelled' ? 'text-red-500' : 'text-slate-800'}`}>{log.action}</p>
                  <p className="text-[10px] text-slate-500 font-bold">{log.details}</p>
                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2">
                    <span className="text-[8px] font-black text-slate-400 uppercase">{formatDate(log.timestamp)}</span>
                    <span className="text-[8px] font-black text-blue-500 uppercase bg-blue-50 px-1.5 py-0.5 rounded">BY: {log.by}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6 bg-white border-t border-slate-200 space-y-4">
        <div className="flex gap-3">
          <button onClick={() => setActiveChatJobId(job.id)} className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 transition-all">
            <MessageCircle size={14} className="text-blue-500" /> View Chats
          </button>
          <button onClick={() => window.open(`/invoice/${job.id}`, '_blank')} className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-3 rounded-xl flex items-center justify-center gap-2 font-black text-[10px] uppercase text-slate-600 transition-all">
            <ExternalLink size={14} /> Invoice
          </button>
        </div>

        {!isCancelled && !hasBeenPaid && !isProcessingPayment && (
          <button onClick={() => setIsCancelModalOpen(true)} className="w-full py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
            ยกเลิกออเดอร์ / ปฏิเสธการรับซื้อ
          </button>
        )}

        {/* Soft-cancelled job — admin can reopen onto the same ticket (revised
            offer price is preserved) or close it permanently. */}
        {isReopenable && (
          <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-amber-700 tracking-wider">นำกลับมาขายใหม่ได้</p>
              {reopenDaysLeft !== null && (
                <span className="text-[9px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  เหลือ {reopenDaysLeft} วันก่อนปิดถาวร
                </span>
              )}
            </div>
            <p className="text-[10px] text-amber-700/80 font-bold leading-relaxed">
              ใช้ราคา revised offer เดิม ({formatCurrency(netPayout)} ฿) บนใบงานเดิม
            </p>
            {job.rider_id && (
              <button onClick={() => handleReopen(true)} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
                เปิดงานใหม่ — ไรเดอร์เดิมกลับไปรับ
              </button>
            )}
            <button onClick={() => handleReopen(false)} className="w-full py-3 bg-slate-900 hover:bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
              เปิดงานใหม่ — จ่ายงานให้ไรเดอร์ใหม่
            </button>
            <button onClick={handleCloseLost} className="w-full py-2.5 bg-white border border-red-200 text-red-500 hover:bg-red-50 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all">
              ปิดงานถาวร (Closed)
            </button>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <input type="text" value={callNotes} onChange={e => setCallNotes(e.target.value)} placeholder="จดบันทึกภายใน..." className="flex-1 bg-slate-50 border border-slate-200 p-3.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400" />
          <button onClick={handleSaveNotes} className="bg-slate-900 text-white px-5 rounded-xl text-[10px] font-black uppercase hover:bg-slate-800 transition-all">Save</button>
        </div>
      </div>
    </div>
  );
};
