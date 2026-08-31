import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, update, push, remove, get } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Phone, MapPin, Truck, Store, Mail, Clock, User, Package,
  MessageSquare, Send, ChevronDown, ChevronUp, DollarSign,
  ClipboardCheck, AlertTriangle, CheckCircle2, XCircle,
  Image as ImageIcon, RefreshCw, FileText, Camera,
  ShieldCheck, Search, Monitor, Battery, Smartphone, Cpu, Globe, Info,
  Edit3, Trash2, X as CloseIcon, History, Save
} from 'lucide-react';
import { ThaiPostTracking } from '../admin/components/ThaiPostTracking';
import { CustomerTimelineModal } from '../../components/customer/CustomerTimelineModal';
import { uploadImageToFirebase } from '../../utils/uploadImage';
import { subscribeJobChats, sendJobChatMessage } from '../../utils/jobChats';
import { useToast } from '../../components/ui/ToastProvider';
import { KYCInfoCard } from '../admin/components/KYCInfoCard';
import { LocationVerificationCard } from '../admin/components/LocationVerificationCard';
import { CheckpointsCard } from '../admin/components/CheckpointsCard';
import { AdminKYCModal } from './components/AdminKYCModal';
import { AdminInspectionModal } from './components/AdminInspectionModal';
import { AdminDeviceVerificationModal } from './components/AdminDeviceVerificationModal';
import { SickwGateBanner } from '../../components/sickw/SickwGateBanner';
import { SickwStoredResultCard } from '../../components/sickw/SickwStoredResultCard';
import { BatteryHealthCard } from '../../components/device/BatteryHealthCard';
import { getSickwGateStatus } from '../../utils/sickwApi';
import { sumAppliedAdjustments, sumAppliedCoupons, listAppliedCoupons, adminTopUpCouponFields, removeCouponAtFields, couponTotalWithout, listAdjustments, canReviewAdjustments } from '../../utils/adjustments';
import type { JobAdjustment } from '../../utils/adjustments';
import { signedAmount } from '../../utils/signedAmount';
import type { AmountDirection } from '../../utils/signedAmount';
import { SignedAmountInput } from '../../components/SignedAmountInput';
import { AmendmentBanner } from '../admin/components/AmendmentBanner';
import { CancelModal } from '../admin/components/CancelModal';
import DiagnosReportCard from '../../components/DiagnosReportCard';
import DiagnosStartPanel from '../../components/DiagnosStartPanel';
import { CANCEL_CATEGORY_LABEL_TH, REOPEN_WINDOW_MS } from '../../types/job-statuses';
import type { CancelCategory } from '../../types/job-statuses';
import { parseTimeRange, existingApptDate, buildPickupSchedule } from '../../utils/appointment';
import { RECEIVE_METHOD_OPTIONS, canChangeReceiveMethod, locationLabel, currentLocation, buildMethodLocationFields, buildStoreInBranchFields } from '../../utils/receiveMethod';
import type { BranchRecord } from '../../utils/receiveMethod';
import { isAwaitingOffer } from '../../utils/offerRequest';
import { CustomerOfferDecisionCard } from '../admin/components/CustomerOfferDecisionCard';
import { unpackAccessoryItemsToStock, sumAccessoryItems } from '../../utils/accessoryItems';
import PickupLocationPicker, { geocodeAddress } from '../../components/PickupLocationPicker';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  'New Lead':          'bg-blue-100 text-blue-700',
  'New B2B Lead':      'bg-indigo-100 text-indigo-700',
  'Following Up':      'bg-amber-100 text-amber-700',
  'Appointment Set':   'bg-cyan-100 text-cyan-700',
  'Active Leads':      'bg-orange-100 text-orange-700',
  'Assigned':          'bg-violet-100 text-violet-700',
  'Accepted':          'bg-blue-100 text-blue-700',
  'Heading to Customer': 'bg-sky-100 text-sky-700',
  'Arrived':           'bg-teal-100 text-teal-700',
  'In-Transit':        'bg-yellow-100 text-yellow-700',
  'Waiting Drop-off':  'bg-teal-100 text-teal-700',
  'Awaiting Shipping': 'bg-indigo-100 text-indigo-700',
  'Parcel In Transit': 'bg-yellow-100 text-yellow-700',
  'Parcel Received':   'bg-orange-100 text-orange-700',
  'Drop-off Received': 'bg-teal-100 text-teal-700',
  'Being Inspected':   'bg-purple-100 text-purple-700',
  'Pending QC':        'bg-pink-100 text-pink-700',
  'Revised Offer':     'bg-rose-100 text-rose-700',
  'Negotiation':       'bg-red-100 text-red-700',
  'Payout Processing': 'bg-emerald-100 text-emerald-700',
  'Paid':              'bg-green-100 text-green-700',
  'PAID':              'bg-green-100 text-green-700',
  'In Stock':          'bg-slate-100 text-slate-700',
  'Cancelled':         'bg-gray-100 text-gray-500',
  'Closed (Lost)':     'bg-gray-100 text-gray-500',
  'Returned':          'bg-gray-100 text-gray-500',
};

const METHOD_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  'Pickup':   { icon: <Truck size={14} />, color: 'bg-blue-100 text-blue-600' },
  'Store-in': { icon: <Store size={14} />, color: 'bg-purple-100 text-purple-600' },
  'Mail-in':  { icon: <Mail size={14} />, color: 'bg-orange-100 text-orange-600' },
};

// Pipeline steps
// Each step lists every status that should highlight that segment of the
// timeline. Includes BOTH legacy lowercase strings and the canonical
// values from JOB_STATUS so jobs written by either-vintage code render
// correctly. When the rider/admin app writes `Rider En Route`, the
// pickup pill activates. When a legacy code path writes
// `Heading to Customer`, the same pill activates.
const PIPELINE = [
  { label: 'เปิดงาน', statuses: ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'Awaiting Shipping'] },
  {
    label: 'รับเครื่อง',
    statuses: [
      'Active Leads',
      // Rider claims through legacy or canonical
      'Assigned', 'Accepted', 'Rider Accepted',
      // Heading out (legacy "Heading to Customer" / "In-Transit", canonical "Rider En Route")
      'Heading to Customer', 'In-Transit', 'Rider En Route',
      // On-site (legacy "Arrived", canonical "Rider Arrived")
      'Arrived', 'Rider Arrived',
      // Mail-in parcel / Store-in drop-off — same "device on its way to us"
      // segment, just without a rider.
      'Parcel In Transit', 'Parcel Received', 'Drop-off Received',
    ],
  },
  { label: 'ตรวจสอบ', statuses: ['Being Inspected', 'Pending QC', 'QC Review', 'Revised Offer', 'Negotiation'] },
  { label: 'จ่ายเงิน', statuses: ['Payout Processing', 'Waiting for Handover', 'Paid', 'PAID', 'Sent to QC Lab', 'In Stock', 'Ready to Sell', 'Sold', 'Completed'] },
];

// Statuses where a Store-in / Mail-in job is still awaiting branch-intake work
// (device verification + condition assessment), i.e. the admin has the device
// or is about to. Covers the sales phase, the Mail-in parcel statuses written
// by the customer's own tracking submission ('Parcel In Transit') and by the
// desktop hold button ('Parcel Received'), the Store-in 'Drop-off Received',
// and the legacy overloaded 'In-Transit'. Leaving the parcel statuses out is
// what stranded Mail-in jobs on mobile with nothing but the Diagnos panel.
const BRANCH_INTAKE_STATUSES = [
  'Following Up', 'Appointment Set', 'Waiting Drop-off',
  'Awaiting Shipping', 'Active Lead', 'Active Leads',
  'In-Transit', 'Parcel In Transit', 'Parcel Received', 'Drop-off Received',
  'Being Inspected',
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const MobileTicketDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const currentUser = useMemo(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  }, []);

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showKycModal, setShowKycModal] = useState(false);
  const [showInspectModal, setShowInspectModal] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [editForm, setEditForm] = useState<{ model: string; price: string; cust_name: string; cust_phone: string; cust_address: string; appt_date: string; appt_start: string; appt_end: string; receive_method: string; branch_id: string; cust_lat?: number; cust_lng?: number }>({ model: '', price: '', cust_name: '', cust_phone: '', cust_address: '', appt_date: '', appt_start: '', appt_end: '', receive_method: '', branch_id: '', cust_lat: undefined, cust_lng: undefined });
  // Real branch list for the Store-in picker (settings/branches — same source
  // the customer checkout uses). Loaded once when the edit modal opens.
  const [branchList, setBranchList] = useState<BranchRecord[]>([]);
  // Mail-in parcel tracking (mirrors CustomerInfoCard on desktop)
  const [isEditingTracking, setIsEditingTracking] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [courierInput, setCourierInput] = useState('');
  const [savingTracking, setSavingTracking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Keys of messages still on the legacy embedded path (pre-/job_chats) so
  // read-marking writes to the path each message actually lives on.
  const legacyChatsRef = useRef<Record<string, any>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [rider, setRider] = useState<{ name: string; phone: string } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  // Ad-hoc price adjustment form (ปรับราคา/โบนัสต่อรอง) — mirrors desktop
  // PricingSidebar. Adjustments survive the inspection recompute (every
  // recompute path folds in sumAppliedAdjustments), unlike a final_price
  // edit which gets rebuilt from catalog price − deductions at inspection.
  const [adjLabel, setAdjLabel] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  // Direction is a REQUIRED explicit choice (no default) — see signedAmount.
  const [adjDir, setAdjDir] = useState<AmountDirection | null>(null);
  const [adjBusy, setAdjBusy] = useState(false);
  // Inline coupon add/edit form (admin manual top-up / fix a wrong coupon)
  const [couponFormOpen, setCouponFormOpen] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponAmount, setCouponAmount] = useState('');

  // Load job. RTDB returns arrays as objects when keys aren't sequential
  // integers (e.g. qc_logs that got a string key written by mistake), so
  // we normalize the few array fields we know about up front. Consumers
  // (.some / .map / spread) then Just Work without each one re-checking.
  useEffect(() => {
    if (!id) return;
    const unsub = onValue(ref(db, `jobs/${id}`), (snap) => {
      if (snap.exists()) {
        const raw = snap.val();
        const normalized = {
          ...raw,
          qc_logs: Array.isArray(raw.qc_logs)
            ? raw.qc_logs
            : raw.qc_logs && typeof raw.qc_logs === 'object'
              ? Object.values(raw.qc_logs)
              : [],
        };
        setJob({ id: snap.key, ...normalized });
      }
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  // Load rider profile when job has rider_id
  useEffect(() => {
    if (!job?.rider_id) { setRider(null); return; }
    const unsub = onValue(ref(db, `riders/${job.rider_id}`), (snap) => {
      if (!snap.exists()) { setRider(null); return; }
      const raw = snap.val();
      setRider({
        name: raw.name || raw.fullName || raw.full_name || raw.displayName || raw.display_name || raw.rider_name || '',
        phone: raw.phone || raw.phoneNumber || raw.phone_number || raw.tel || raw.mobile || '',
      });
    });
    return () => unsub();
  }, [job?.rider_id]);

  // Load chat messages (merged legacy embedded path + /job_chats)
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeJobChats(id, (data) => {
      const list = Object.entries(data)
        .map(([key, val]: [string, any]) => ({ key, ...val, _legacy: !!legacyChatsRef.current[key] }))
        .sort((a: any, b: any) => a.timestamp - b.timestamp);
      setMessages(list);

      // Count unread from rider
      const unread = Object.values(data).filter((m: any) => m.sender === 'rider' && !m.read).length;
      setUnreadCount(unread);
    });
    const unsubLegacy = onValue(ref(db, `jobs/${id}/chats`), (snap) => {
      legacyChatsRef.current = snap.val() || {};
    });
    return () => { unsub(); unsubLegacy(); };
  }, [id]);

  // Auto scroll chat
  useEffect(() => {
    if (showChat) chatScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // Mark chat as read when opened
  useEffect(() => {
    if (!showChat || !id) return;
    messages.forEach((msg) => {
      if (msg.sender === 'rider' && !msg.read) {
        const path = msg._legacy ? `jobs/${id}/chats/${msg.key}` : `job_chats/${id}/${msg.key}`;
        update(ref(db, path), { read: true }).catch(() => {});
      }
    });
    update(ref(db, `jobs/${id}/chat_flags`), { unread_from_rider: false }).catch(() => {});
  }, [showChat, messages, id]);

  if (loading) return <div className="flex items-center justify-center h-full"><RefreshCw size={24} className="animate-spin text-slate-400" /></div>;
  if (!job) return <div className="flex items-center justify-center h-full text-red-500 font-bold">ไม่พบข้อมูลงาน</div>;

  const isCancelled = ['cancelled', 'closed (lost)', 'returned'].includes((job.status || '').toLowerCase());
  // Soft-close: "Cancelled" is reopenable on the same ticket until the 7-day
  // window lapses; "Closed (Lost)" and others are final.
  const isReopenable = (job.status || '').toLowerCase() === 'cancelled';
  const reopenDeadline = isReopenable && job.cancelled_at ? job.cancelled_at + REOPEN_WINDOW_MS : null;
  const reopenDaysLeft = reopenDeadline ? Math.max(0, Math.ceil((reopenDeadline - Date.now()) / 86400000)) : null;
  // Pickup job advanced to resale without the rider fee → handover was skipped,
  // rider unpaid. Offer a recovery action that rewinds to Pending QC.
  const needsFeeRecovery = job.receive_method === 'Pickup' && !!job.rider_id &&
    (!job.rider_fee || Number(job.rider_fee) <= 0) &&
    ['sent to qc lab', 'in stock'].includes((job.status || '').toLowerCase());
  const basePrice = Number(job.final_price || job.price || 0);
  // Effective pickup fee = gross fee minus the rider-fee discount the company
  // absorbs (rider pay is untouched). See net_payout invariant in CLAUDE.md.
  const grossPickupFee = job.receive_method === 'Pickup' ? Number(job.pickup_fee || 0) : 0;
  const riderFeeDiscount = job.receive_method === 'Pickup' ? Number(job.rider_fee_discount || 0) : 0;
  const pickupFee = Math.max(0, grossPickupFee - riderFeeDiscount);
  const couponValue = sumAppliedCoupons(job);
  const adjustmentsSum = sumAppliedAdjustments(job);
  const netPayout = Math.max(0, basePrice - pickupFee + couponValue + adjustmentsSum);
  const appliedAdjustments = listAdjustments(job).filter((a) => a && a.status === 'applied');
  const pendingAdjustments = listAdjustments(job).filter((a) => a && a.status === 'pending');
  // Mirrors desktop B2CWorkspacePage.hasBeenPaid — once money moved, the
  // payout composition is frozen (no more add/remove adjustment).
  const statusLowerForPaid = (job.status || '').trim().toLowerCase();
  const hasBeenPaid = !!job.paid_at || !!job.payment_slip ||
    ['paid', 'deal closed', 'deal closed (negotiated)', 'in stock', 'sent to qc lab', 'payment completed', 'completed', 'success', 'transferred', 'waiting for handover', 'ready to sell', 'sold', 'rider returning'].includes(statusLowerForPaid) ||
    statusLowerForPaid.includes('paid') ||
    (job.qc_logs || []).some((log: any) => ['paid', 'payment completed'].includes(String(log?.action || '').toLowerCase()));
  // CEO/MANAGER — may approve offers, edit/remove coupons and rider-fee
  // discounts, and remove applied lines. Other roles can only propose.
  const isPrivileged = canReviewAdjustments(currentUser?.role);
  const canTouchMoney = !hasBeenPaid && !isCancelled;

  // Pipeline progress
  // Use the FURTHEST step the job has ever reached (max from qc_logs +
  // current status), not just the current status. The flow legitimately
  // moves "backwards" from จ่ายเงิน → ตรวจสอบ when the rider returns to
  // base and the device awaits internal QC (Paid → Rider Returning →
  // Pending QC) — but the payment phase is still "completed", so the
  // pill should stay highlighted. qc_logs.action stores the canonical
  // status name in nearly all transitions, so a Set lookup against the
  // PIPELINE catches each step the job has ever touched.
  const reachedStatuses = new Set<string>();
  if (job.status) reachedStatuses.add(job.status);
  for (const log of (job.qc_logs || [])) {
    if (log && typeof log.action === 'string') reachedStatuses.add(log.action);
  }
  let currentStepIdx = -1;
  PIPELINE.forEach((step, idx) => {
    if (step.statuses.some((s) => reachedStatuses.has(s))) {
      currentStepIdx = Math.max(currentStepIdx, idx);
    }
  });

  const makeLog = (action: string, details: string) => ({
    action, details, by: currentUser?.name || 'Admin', timestamp: Date.now()
  });

  // Make Offer (ลูกค้าเสนอราคาเอง) — mirror ของ desktop
  // B2CWorkspacePage.handleDecideCustomerOffer (สูตรเงิน + qc_log เดียวกัน).
  // push/อีเมลแจ้งลูกค้า = cloud function onCustomerOfferDecided
  const handleDecideCustomerOffer = async (decision: 'accept' | 'counter' | 'decline', counterAmount?: number, note?: string) => {
    const offer = job.customer_offer;
    if (!offer || offer.status !== 'pending') return;
    if (!canReviewAdjustments(currentUser?.role)) { toast.warning('เฉพาะ CEO/MANAGER เท่านั้นที่ตัดสินข้อเสนอลูกค้าได้'); return; }
    const now = Date.now();
    const decidedBy = { decided_at: now, decided_by_uid: currentUser?.id || currentUser?.uid || null, decided_by_name: currentUser?.name || 'Admin' };
    if (decision === 'accept') {
      const p = Math.round(Number(offer.amount));
      const net = Math.max(0, p - pickupFee + couponValue + adjustmentsSum);
      const devs = Array.isArray(job.devices) ? [...job.devices] : [];
      // อัปเดตเฉพาะ price ไม่แตะ estimated_price (invariant เดียวกับ buildUpdatedDevices ฝั่ง desktop)
      if (devs.length === 1) devs[0] = { ...devs[0], price: p };
      await update(ref(db, `jobs/${job.id}`), {
        customer_offer: { ...offer, status: 'accepted', ...decidedBy },
        final_price: p, net_payout: net, ...(devs.length === 1 ? { devices: devs } : {}),
        qc_logs: [makeLog('Customer Offer Accepted', `รับข้อเสนอลูกค้า ฿${p.toLocaleString()} (จากราคาประเมิน ฿${Number(offer.quote_at_offer).toLocaleString()} · ยอดสุทธิ ${net.toLocaleString()} บ.)`), ...(job.qc_logs || [])],
        updated_at: now,
      });
      toast.success('รับข้อเสนอแล้ว — ระบบจะแจ้งลูกค้าอัตโนมัติ');
    } else if (decision === 'counter') {
      const c = Math.round(Number(counterAmount));
      if (!(c > Number(offer.quote_at_offer) && c < Number(offer.amount))) { toast.warning('ราคาเคาน์เตอร์ต้องอยู่ระหว่างราคาประเมินกับราคาที่ลูกค้าเสนอ'); return; }
      await update(ref(db, `jobs/${job.id}`), {
        customer_offer: { ...offer, status: 'countered', counter_amount: c, ...(note ? { counter_reason: note } : {}), ...decidedBy },
        qc_logs: [makeLog('Customer Offer Countered', `เคาน์เตอร์ข้อเสนอลูกค้า ฿${Number(offer.amount).toLocaleString()} → ฿${c.toLocaleString()} — รอลูกค้าตอบบนหน้า track`), ...(job.qc_logs || [])],
        updated_at: now,
      });
      toast.success('ส่งราคาเคาน์เตอร์แล้ว — รอลูกค้าตอบ');
    } else {
      await update(ref(db, `jobs/${job.id}`), {
        customer_offer: { ...offer, status: 'declined', ...decidedBy },
        qc_logs: [makeLog('Customer Offer Declined', `ยืนราคาประเมินเดิม ฿${Number(offer.quote_at_offer).toLocaleString()} (ลูกค้าเสนอ ฿${Number(offer.amount).toLocaleString()}) — งานเดินต่อที่ราคาประเมิน`), ...(job.qc_logs || [])],
        updated_at: now,
      });
      toast.success('ยืนราคาประเมินเดิม — ระบบจะแจ้งลูกค้าอัตโนมัติ');
    }
  };

  // Itemised ad-hoc adjustment (เช่น เพิ่มราคาจากการต่อรองในแชท หรือหักตำหนิ
  // ที่ไม่อยู่ในชุดประเมิน) — same write shape as desktop
  // B2CWorkspacePage.handleAddAdjustment. amount > 0 = เพิ่มเงิน, < 0 = หัก.
  // เข้าอยู่ในสูตร net_payout ทุกจุด (client + cloud functions + ตอนตรวจเครื่อง)
  // จึงไม่หายเมื่อระบบ recompute ราคาตอนรับเครื่องเข้าตรวจสอบ.
  const handleAddAdjustment = async () => {
    const lbl = adjLabel.trim();
    const amt = signedAmount(adjAmount, adjDir);
    if (!lbl || amt === null) { toast.warning('กรุณาระบุชื่อรายการ เลือกหัก/เพิ่ม และจำนวนเงิน'); return; }
    setAdjBusy(true);
    try {
      // CEO/MANAGER apply on the spot (self-approved trail). Other roles
      // PROPOSE: the line lands 'pending' (not in net_payout yet) and the
      // onAdminOfferProposed cloud function pushes an approval request to
      // CEO/MANAGER devices.
      const canApply = canReviewAdjustments(currentUser?.role);
      const now = Date.now();
      const entry: JobAdjustment = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `adj_${now}`),
        label: lbl, amount: amt, device_index: 0, source: 'admin_manual',
        status: canApply ? 'applied' : 'pending',
        by_uid: currentUser?.id || currentUser?.uid, by_name: currentUser?.name || 'Admin',
        by_role: currentUser?.role, at: now,
        ...(canApply ? {
          approved_by_uid: currentUser?.id || currentUser?.uid,
          approved_by_name: currentUser?.name || 'Admin',
          approved_by_role: currentUser?.role,
          approved_at: now,
        } : {}),
      };
      const list = [...listAdjustments(job), entry];
      const net = Math.max(0, basePrice - pickupFee + couponValue + sumAppliedAdjustments({ adjustments: list }));
      const sign = amt < 0 ? '-' : '+';
      await update(ref(db, `jobs/${job.id}`), {
        adjustments: list, net_payout: net,
        qc_logs: [makeLog(
          canApply ? 'Adjustment Added' : 'Offer Proposed',
          canApply
            ? `เพิ่มรายการ "${lbl}" ${sign}฿${Math.abs(amt).toLocaleString()} (ยอดสุทธิ ${net.toLocaleString()} บ.)`
            : `เสนอรายการ "${lbl}" ${sign}฿${Math.abs(amt).toLocaleString()} — รออนุมัติจาก CEO/MANAGER`,
        ), ...(job.qc_logs || [])],
        updated_at: Date.now(),
      });
      setAdjLabel(''); setAdjAmount(''); setAdjDir(null);
      toast.success(canApply ? 'เพิ่มรายการปรับราคาแล้ว' : 'ส่งคำขออนุมัติไปยัง CEO/MANAGER แล้ว');
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setAdjBusy(false);
    }
  };

  // CEO/MANAGER decision on a pending admin offer.
  const handleReviewAdjustment = async (adjId: string, approve: boolean) => {
    if (!canReviewAdjustments(currentUser?.role)) { toast.warning('เฉพาะ CEO/MANAGER เท่านั้นที่อนุมัติได้'); return; }
    const now = Date.now();
    const target = listAdjustments(job).find((a) => a.id === adjId);
    const list = listAdjustments(job).map((a): JobAdjustment => {
      if (a.id !== adjId || a.status !== 'pending') return a;
      return approve
        ? { ...a, status: 'applied', approved_by_uid: currentUser?.id || currentUser?.uid, approved_by_name: currentUser?.name || 'Admin', approved_by_role: currentUser?.role, approved_at: now }
        : { ...a, status: 'rejected', rejected_by_name: currentUser?.name || 'Admin', rejected_at: now };
    });
    const net = Math.max(0, basePrice - pickupFee + couponValue + sumAppliedAdjustments({ adjustments: list }));
    await update(ref(db, `jobs/${job.id}`), {
      adjustments: list, net_payout: net,
      qc_logs: [makeLog(
        approve ? 'Offer Approved' : 'Offer Rejected',
        `${approve ? 'อนุมัติ' : 'ปฏิเสธ'}รายการ "${target?.label || ''}" ${Number(target?.amount) < 0 ? '-' : '+'}฿${Math.abs(Number(target?.amount || 0)).toLocaleString()} (เสนอโดย ${target?.by_name || '-'})`,
      ), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    });
    toast.success(approve ? 'อนุมัติรายการแล้ว' : 'ปฏิเสธรายการแล้ว');
  };

  // Coupon add/edit/remove — mirrors desktop B2CWorkspacePage. The ledger
  // (issued_coupons) is server-write-only; the onJobCouponRevoked cloud
  // function reconciles it when a redeemed coupon is pulled off a job.
  const handleSaveCoupon = async () => {
    const code = couponCode.trim();
    const val = Number(couponAmount);
    if (!code || !Number.isFinite(val) || val <= 0) { toast.warning('กรุณาระบุโค้ดและจำนวนเงิน'); return; }
    await update(ref(db, `jobs/${job.id}`), {
      ...adminTopUpCouponFields(code, val),
      net_payout: Math.max(0, basePrice - pickupFee + val + adjustmentsSum),
      qc_logs: [makeLog('Admin Top-up', `แอดมิน${listAppliedCoupons(job).length > 0 ? 'แก้ไข' : 'เพิ่ม'}คูปอง: ${code} (+฿${val.toLocaleString()})`), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    });
    setCouponFormOpen(false); setCouponCode(''); setCouponAmount('');
    toast.success('บันทึกคูปองแล้ว');
  };
  // ลบทีละใบ — trigger ฝั่ง server คืน ledger/quota ให้เฉพาะใบที่หลุดจาก array
  const handleRemoveCoupon = async (index: number) => {
    const target = listAppliedCoupons(job)[index];
    if (!target) return;
    if (!confirm(`ยืนยันการลบคูปอง ${target.code || ''} และดึงเงินกลับ?`)) return;
    const remainingCoupon = couponTotalWithout(job, index);
    await update(ref(db, `jobs/${job.id}`), {
      ...removeCouponAtFields(job, index),
      net_payout: Math.max(0, basePrice - pickupFee + remainingCoupon + adjustmentsSum),
      qc_logs: [makeLog('Coupon Revoked', `แอดมินยกเลิกการใช้คูปอง: ${target.code || '-'} (-฿${(couponValue - remainingCoupon).toLocaleString()})`), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    });
    toast.success('ลบคูปองแล้ว');
  };

  // Rider-fee discount edit/remove — client recomputes net_payout; the
  // onRiderFeeDiscountEdited cloud function syncs the absorbed-cost ledger.
  const handleEditRiderDiscount = async (newValue: number) => {
    if (!Number.isFinite(newValue) || newValue < 0) return;
    const capped = Math.min(newValue, grossPickupFee);
    const effFee = Math.max(0, grossPickupFee - capped);
    await update(ref(db, `jobs/${job.id}`), {
      rider_fee_discount: capped,
      ...(capped === 0 ? { applied_rider_promo: null } : {}),
      net_payout: Math.max(0, basePrice - effFee + couponValue + adjustmentsSum),
      qc_logs: [makeLog('Rider-Fee Discount Edited', `แก้ส่วนลดค่าไรเดอร์เป็น ฿${capped.toLocaleString()} (เดิม ฿${riderFeeDiscount.toLocaleString()})`), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    });
    toast.success('อัปเดตส่วนลดค่าไรเดอร์แล้ว');
  };
  const handleRemoveRiderDiscount = async () => {
    if (!confirm('ยืนยันการยกเลิกส่วนลดค่าไรเดอร์? ลูกค้าจะถูกหักค่าบริการเต็มจำนวน')) return;
    await handleEditRiderDiscount(0);
  };

  const handleRemoveAdjustment = async (adjId: string) => {
    const target = listAdjustments(job).find((a) => a.id === adjId);
    const list = listAdjustments(job).filter((a) => a.id !== adjId);
    const net = Math.max(0, basePrice - pickupFee + couponValue + sumAppliedAdjustments({ adjustments: list }));
    await update(ref(db, `jobs/${job.id}`), {
      adjustments: list, net_payout: net,
      qc_logs: [makeLog('Adjustment Removed', `ลบรายการ "${target?.label || ''}" (ยอดสุทธิ ${net.toLocaleString()} บ.)`), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    });
    toast.success('ลบรายการปรับราคาแล้ว');
  };

  // Same write shape as desktop B2CWorkspacePage.handleCancelTicket —
  // structured category for analytics, free text kept separate, and the
  // combined string only in the human-readable log.
  const handleCancelJob = async (category: CancelCategory, detail: string) => {
    const categoryLabel = CANCEL_CATEGORY_LABEL_TH[category];
    const fullReason = detail ? `${categoryLabel} — ${detail}` : categoryLabel;
    await update(ref(db, `jobs/${job.id}`), {
      status: 'Cancelled',
      cancel_category: category,
      cancel_reason: detail || null,
      cancelled_by: `staff:${currentUser?.id || currentUser?.uid || 'admin'}`,
      cancelled_at: Date.now(),
      qc_logs: [makeLog('Cancelled', `ยกเลิกออเดอร์ เหตุผล: ${fullReason}`), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    setShowCancelModal(false);
    toast.success('ยกเลิกงานแล้ว');
  };

  // Actions
  const handleCall = () => {
    if (!job.cust_phone) { toast.warning('ไม่พบเบอร์โทร'); return; }
    window.location.href = `tel:${job.cust_phone}`;
  };

  const handleClaim = async () => {
    const next = job.status === 'New Lead' ? 'Following Up' : job.status;
    await update(ref(db, `jobs/${job.id}`), {
      agent_name: currentUser?.name || 'Admin',
      agent_id: currentUser?.uid || 'admin',
      status: next, is_read: true,
      qc_logs: [makeLog('Claimed Ticket', 'รับเคสผ่าน Mobile'), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    toast.success('รับเคสสำเร็จ');
  };

  const handleUpdateStatus = async (newStatus: string, details: string) => {
    await update(ref(db, `jobs/${job.id}`), {
      status: newStatus,
      qc_logs: [makeLog(newStatus, details), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    toast.success(`อัพเดทเป็น ${newStatus}`);
    // งานที่ขายพ่วงอุปกรณ์เสริม — เข้าคลังแล้วแตกเป็น stock รายชิ้น (ref -A1..)
    // แบบเดียวกับ B2B unpack. idempotent ผ่าน accessories_unpacked_at
    if (newStatus === 'In Stock') {
      const unpacked = await unpackAccessoryItemsToStock(job, currentUser?.name || 'Admin');
      if (unpacked > 0) toast.success(`แตกอุปกรณ์เสริม ${unpacked} ชิ้นเข้าสต๊อกแล้ว`);
    }
  };

  // Save the Mail-in parcel tracking number. Mirrors the desktop
  // CustomerInfoCard.handleSaveTracking, with one deliberate difference: it
  // writes the canonical `Parcel In Transit` (the value the customer's own
  // tracking submission produces on the track page) instead of the legacy
  // `In-Transit`, per the "writers emit canonical" rule in job-statuses.ts.
  // Both are accepted by every reader (normalizeStatus splits the In-Transit
  // overload by receive_method).
  const handleSaveTracking = async () => {
    const tracking = trackingInput.trim();
    if (!tracking) {
      toast.error('กรุณากรอกเลข Tracking');
      return;
    }
    setSavingTracking(true);
    try {
      // Only flip the status while the parcel hasn't been logged as shipped
      // yet — never drag a job that already reached QC/payout backwards.
      const preShipping = ['New Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off', 'Awaiting Shipping', 'Active Lead', 'Active Leads']
        .includes(job.status);
      const payload: Record<string, unknown> = {
        tracking_number: tracking,
        courier_name: courierInput.trim() || '',
        updated_at: Date.now(),
      };
      if (preShipping) {
        payload.status = 'Parcel In Transit';
        payload.qc_logs = [
          makeLog('Parcel In Transit', `อัพเดทเลขพัสดุ: ${tracking} — สถานะเปลี่ยนเป็นพัสดุอยู่ระหว่างขนส่ง`),
          ...(job.qc_logs || []),
        ];
      } else {
        payload.qc_logs = [
          makeLog('Tracking Updated', `อัพเดทเลขพัสดุ: ${tracking}`),
          ...(job.qc_logs || []),
        ];
      }
      await update(ref(db, `jobs/${job.id}`), payload);
      toast.success(preShipping ? 'บันทึกเลขพัสดุ และอัพเดทสถานะเป็นกำลังจัดส่งแล้ว' : 'อัพเดทเลขพัสดุเรียบร้อย');
      setIsEditingTracking(false);
    } catch (e: unknown) {
      toast.error('บันทึกไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingTracking(false);
    }
  };

  // Add a free-text sales note to the job history. Mirrors desktop
  // (TradeInDashboard.handleSaveNotes) — same 'Sales Note Added' qc_logs action
  // so the note shows in the same timeline on both mobile and desktop.
  const handleAddNote = async () => {
    const text = noteText.trim();
    if (!text || savingNote) return;
    setSavingNote(true);
    try {
      await update(ref(db, `jobs/${job.id}`), {
        qc_logs: [makeLog('Sales Note Added', text), ...(job.qc_logs || [])],
        updated_at: Date.now(),
      });
      setNoteText('');
      toast.success('บันทึกโน้ตแล้ว');
    } catch (e: unknown) {
      toast.error('บันทึกโน้ตไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingNote(false);
    }
  };

  // Reopen a soft-cancelled job onto the SAME ticket. Revised offer price
  // (price / final_price / net_payout) is untouched by cancel, so it's still
  // there — clear the cancel marks and route the job back. keepRider=true means
  // the rider was still nearby and turns around to re-collect the device.
  const handleReopen = async (keepRider: boolean) => {
    const reuseRider = keepRider && !!job.rider_id;
    const nextStatus = reuseRider ? 'Rider En Route' : 'Following Up';
    const detail = reuseRider
      ? 'นำงานกลับมาขายใหม่ (ลูกค้าตกลงราคา revised offer เดิม) — ไรเดอร์เดิมยังอยู่ใกล้ ให้กลับไปรับเครื่อง'
      : 'นำงานกลับมาขายใหม่ (ลูกค้าตกลงราคา revised offer เดิม) — เคลียร์ไรเดอร์เดิม รอจ่ายงานใหม่';
    const payload: any = {
      status: nextStatus,
      reopened_at: Date.now(),
      reopened_by: `staff:${currentUser?.uid || 'admin'}`,
      cancel_category: null,
      cancel_reason: null,
      cancelled_by: null,
      cancelled_at: null,
      qc_logs: [makeLog('Reopened', detail), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    };
    if (!reuseRider) payload.rider_id = null;
    await update(ref(db, `jobs/${job.id}`), payload);
    toast.success('เปิดงานกลับมาแล้ว');
  };

  // Rewind a skipped Pickup job to Pending QC so the rider-fee cloud function
  // runs and the rider gets paid. Stamp completed_at if missing for history.
  const handleRecoverHandover = async () => {
    if (!confirm('รับมอบเครื่องย้อนหลังและคำนวณค่าวิ่งให้ไรเดอร์? ใช้กรณีงานถูกข้ามขั้นส่งมอบ (Pending QC)')) return;
    const payload: any = {
      status: 'Pending QC',
      qc_logs: [makeLog('Pending QC', 'แก้ย้อนหลัง: งานถูกข้ามขั้นส่งมอบ ทำให้ค่าวิ่งไม่ถูกคำนวณ — รับเข้า Pending QC เพื่อให้ระบบคำนวณค่าวิ่งให้ไรเดอร์'), ...(job.qc_logs || [])],
      updated_at: Date.now(),
    };
    if (!job.completed_at) payload.completed_at = Date.now();
    await update(ref(db, `jobs/${job.id}`), payload);
    toast.success('รับมอบย้อนหลังแล้ว ระบบกำลังคำนวณค่าวิ่งให้ไรเดอร์');
  };

  // Force-finalize a soft-cancelled job immediately (skip the 7-day window).
  const handleCloseLost = async () => {
    if (!confirm('ปิดงานถาวร? หลังจากนี้จะไม่สามารถนำกลับมาขายใหม่ได้')) return;
    await update(ref(db, `jobs/${job.id}`), {
      status: 'Closed (Lost)',
      closed_at: Date.now(),
      closed_by: `staff:${currentUser?.uid || 'admin'}`,
      qc_logs: [makeLog('Closed (Lost)', 'ปิดงานถาวร (ไม่เปิดให้กลับมาขายใหม่)'), ...(job.qc_logs || [])],
      updated_at: Date.now()
    });
    toast.success('ปิดงานถาวรแล้ว');
  };

  const openEditModal = () => {
    const { start, end } = parseTimeRange(job.pickup_schedule);
    setEditForm({
      model: job.model || '',
      price: String(job.price ?? ''),
      cust_name: job.cust_name || '',
      cust_phone: job.cust_phone || '',
      // Pickup/Mail-in keep the location in cust_address. For Store-in the
      // branch comes from the picker (branch_id) — NOT free text, so the
      // customer's home address can never smear into store_branch again.
      cust_address: job.cust_address || '',
      appt_date: existingApptDate(job.pickup_schedule),
      appt_start: start,
      appt_end: end,
      receive_method: job.receive_method || '',
      branch_id: job.branch_details?.id || '',
      cust_lat: typeof job.cust_lat === 'number' ? job.cust_lat : undefined,
      cust_lng: typeof job.cust_lng === 'number' ? job.cust_lng : undefined,
    });
    // Load the branch list for the Store-in picker (small node, one-shot).
    get(ref(db, 'settings/branches')).then((snap) => {
      if (!snap.exists()) { setBranchList([]); return; }
      const data = snap.val() || {};
      const list: BranchRecord[] = Object.keys(data)
        .map((key) => ({ id: key, ...data[key] }))
        .filter((b: BranchRecord) => b.isActive !== false);
      setBranchList(list);
      // Legacy Store-in job without branch_details — try matching the stored
      // branch name so the picker preselects the right branch.
      if (!job.branch_details?.id && (job.branch_name || job.store_branch)) {
        const byName = list.find((b) => b.name && (b.name === job.branch_name || b.name === job.store_branch));
        if (byName) setEditForm((f) => ({ ...f, branch_id: f.branch_id || byName.id }));
      }
    }).catch(() => setBranchList([]));
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!job.id) return;
    const priceNum = editForm.price === '' ? null : Number(editForm.price);
    if (priceNum !== null && (isNaN(priceNum) || priceNum < 0)) {
      toast.warning('ราคาต้องเป็นตัวเลข');
      return;
    }

    // Appointment edit (optional). Validate the date/time-range up front.
    const apptDate = editForm.appt_date.trim();
    const apptStart = editForm.appt_start.trim();
    const apptEnd = editForm.appt_end.trim();
    if (apptDate || apptStart || apptEnd) {
      if (!apptDate || !apptStart) {
        toast.warning('กรุณาระบุวันและเวลาเริ่มของนัดหมาย');
        return;
      }
      if (apptEnd && apptEnd <= apptStart) {
        toast.warning('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม');
        return;
      }
    }

    // Trade method change (optional). Pricing + rider withdrawal are reconciled
    // server-side by onReceiveMethodChanged; here we just gate by status.
    const newMethod = editForm.receive_method || job.receive_method;
    const methodChanged = newMethod !== job.receive_method;
    if (methodChanged && !canChangeReceiveMethod(job.status)) {
      toast.warning('เปลี่ยนวิธีรับไม่ได้ในสถานะนี้ (งานเข้าสู่ขั้นรับเครื่อง/จ่ายเงินแล้ว)');
      return;
    }

    const isStoreIn = newMethod === 'Store-in';
    // Store-in must point at a REAL branch record — free text here used to
    // smear the customer's address into store_branch and left the tracking
    // page guessing a default branch.
    const selectedBranch = isStoreIn ? branchList.find((b) => b.id === editForm.branch_id) : undefined;
    if (isStoreIn && !selectedBranch) {
      toast.warning('กรุณาเลือกสาขาที่ลูกค้าจะนำเครื่องเข้ามา');
      return;
    }

    setIsSaving(true);
    try {
      const logs: any[] = [];

      const payload: any = {
        model: editForm.model.trim() || null,
        price: priceNum,
        cust_name: editForm.cust_name.trim() || null,
        cust_phone: editForm.cust_phone.trim() || null,
        updated_at: Date.now(),
        // Location is written to the fields that match the (possibly new)
        // method — Store-in snapshots the picked branch (same shape as the
        // customer checkout) so the tracking page shows the real branch.
        ...(isStoreIn && selectedBranch
          ? buildStoreInBranchFields(selectedBranch)
          : buildMethodLocationFields(newMethod, editForm.cust_address)),
      };

      if (isStoreIn && selectedBranch && job.branch_details?.id !== selectedBranch.id && !methodChanged) {
        logs.push(makeLog('Branch Changed', `เปลี่ยนสาขานัดหมายเป็น "${selectedBranch.name || selectedBranch.id}"`));
      }

      if (methodChanged) {
        payload.receive_method = newMethod;
        logs.push(makeLog(
          'Trade Method Changed',
          `เปลี่ยนวิธีรับจาก ${job.receive_method || '-'} เป็น ${newMethod}${isStoreIn && selectedBranch ? ` (สาขา ${selectedBranch.name || ''})` : ''} — ระบบจะคำนวณค่าธรรมเนียม/ยอดโอนใหม่อัตโนมัติ`,
        ));
      }

      // Pickup pin reconciliation. The rider navigates by cust_lat/cust_lng and
      // ignores the text address when a pin exists, so the pin must NEVER be
      // left stale after the address changes — otherwise the rider drives to the
      // old spot. Priority:
      //   1. admin moved the pin    → use those coords
      //   2. address text changed   → geocode it to a fresh pin
      //   3. geocode failed         → clear the pin so the rider falls back to
      //                               the (correct) text address
      if (newMethod === 'Pickup') {
        const pinMoved = typeof editForm.cust_lat === 'number' && typeof editForm.cust_lng === 'number'
          && (editForm.cust_lat !== job.cust_lat || editForm.cust_lng !== job.cust_lng);
        const addressChanged = (editForm.cust_address || '').trim() !== (job.cust_address || '').trim();

        if (pinMoved) {
          payload.cust_lat = editForm.cust_lat;
          payload.cust_lng = editForm.cust_lng;
          logs.push(makeLog('Pickup Location Updated', `ปรับจุดรับเครื่อง (${editForm.cust_lat!.toFixed(5)}, ${editForm.cust_lng!.toFixed(5)}) — คิดค่าไรเดอร์ใหม่อัตโนมัติ`));
        } else if (addressChanged) {
          const coords = await geocodeAddress(editForm.cust_address);
          if (coords) {
            payload.cust_lat = coords.lat;
            payload.cust_lng = coords.lng;
            logs.push(makeLog('Pickup Location Updated', `อัปเดตหมุดตามที่อยู่ใหม่ (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}) — คิดค่าไรเดอร์ใหม่อัตโนมัติ`));
          } else {
            // No coords for the new address — drop the old pin so the rider
            // doesn't navigate to the previous (wrong) location.
            payload.cust_lat = null;
            payload.cust_lng = null;
            logs.push(makeLog('Pickup Location Updated', 'ที่อยู่เปลี่ยนแต่หาพิกัดไม่ได้ — ล้างหมุดเดิม ไรเดอร์จะนำทางด้วยที่อยู่ข้อความ'));
            toast.warning('หาพิกัดจากที่อยู่ใหม่ไม่ได้ — ล้างหมุดเดิมแล้ว แนะนำให้ปักหมุดเองบนแผนที่');
          }
        }
      }

      // Reschedule: write the new date/time range into pickup_schedule (read by
      // the calendar, customer tracking and this detail page). Only write when
      // something actually changed so we don't re-stamp a no-op save.
      if (apptDate && apptStart) {
        const prev = parseTimeRange(job.pickup_schedule);
        const prevDate = existingApptDate(job.pickup_schedule);
        const hadSchedule = !!prevDate;
        const changed = !hadSchedule || prevDate !== apptDate || prev.start !== apptStart || prev.end !== apptEnd;
        if (changed) {
          payload.pickup_schedule = buildPickupSchedule(apptDate, apptStart, apptEnd, hadSchedule);
          const rangeLabel = apptEnd ? `${apptStart} - ${apptEnd}` : apptStart;
          logs.push(makeLog(
            hadSchedule ? 'Appointment Rescheduled' : 'Appointment Set',
            `${hadSchedule ? 'เลื่อนนัดหมายเป็น' : 'นัดหมาย'} ${apptDate} ${rangeLabel}`,
          ));
          // First appointment on a fresh Store-in moves it to Appointment Set,
          // mirroring the desktop scheduler. Rescheduling never changes status.
          if (isStoreIn && !hadSchedule) {
            const lower = (job.status || '').trim().toLowerCase();
            if (lower === 'new lead' || lower === 'following up') payload.status = 'Appointment Set';
          }
        }
      }

      logs.push(makeLog('Edited', 'แก้ไขข้อมูลงานผ่าน Mobile'));
      payload.qc_logs = [...logs, ...(job.qc_logs || [])];

      if (priceNum !== null) {
        const oldBasePrice = Number(job.final_price || job.price || 0);
        // Effective fee = gross pickup_fee minus the absorbed rider-fee discount.
        const grossFeeNum = job.receive_method === 'Pickup' ? Number(job.pickup_fee || 0) : 0;
        const riderDiscNum = job.receive_method === 'Pickup' ? Number(job.rider_fee_discount || 0) : 0;
        const feeNum = Math.max(0, grossFeeNum - riderDiscNum);
        const couponNum = sumAppliedCoupons(job);
        payload.final_price = priceNum;
        payload.net_payout = Math.max(0, priceNum - feeNum + couponNum + adjustmentsSum);

        if (Array.isArray(job.devices) && job.devices.length > 0) {
          const devs = [...job.devices];
          // อัปเดตเฉพาะ price (ราคาปัจจุบัน) — ไม่แตะ estimated_price ซึ่งเป็นราคาที่ลูกค้าประเมินตอนล็อก
          // ใช้เป็นฐานของ Internal QC (ล็อค 7 วัน) ถ้าเขียนทับจะทำให้ประเมินซ้ำแล้วค่าตกทบ
          if (devs.length === 1) {
            devs[0] = { ...devs[0], price: priceNum };
          } else {
            const diff = oldBasePrice - priceNum;
            devs[0] = {
              ...devs[0],
              price: Math.max(0, Number(devs[0].price || 0) - diff),
            };
          }
          payload.devices = devs;
        }
      }

      await update(ref(db, `jobs/${job.id}`), payload);
      toast.success('บันทึกการแก้ไขสำเร็จ');
      setShowEditModal(false);
    } catch {
      toast.error('บันทึกไม่สำเร็จ');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!job.id) return;
    if (!confirm(`ยืนยันลบงาน ${job.ref_no || job.id}? การลบจะไม่สามารถย้อนกลับได้`)) return;
    try {
      await remove(ref(db, `jobs/${job.id}`));
      toast.success('ลบงานสำเร็จ');
      navigate('/mobile');
    } catch {
      toast.error('ลบงานไม่สำเร็จ');
    }
  };

  const canEdit = currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER';
  const canDelete = currentUser?.role === 'CEO';

  // Chat handlers
  const handleSendChat = async () => {
    if (!chatInput.trim() || !id) return;
    const text = chatInput.trim();
    setChatInput('');
    await sendJobChatMessage(id, {
      sender: 'admin',
      senderName: currentUser?.name || 'Admin',
      text, timestamp: Date.now(), read: false
    });
  };

  const handleChatImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !id) return;
    setIsUploading(true);
    try {
      const url = await uploadImageToFirebase(e.target.files[0], `jobs/${id}/chats/images`, { opaqueFilename: true });
      await sendJobChatMessage(id, {
        sender: 'admin', senderName: currentUser?.name || 'Admin',
        text: '📷 ส่งรูปภาพ', imageUrl: url,
        timestamp: Date.now(), read: false
      });
    } catch { toast.error('อัปโหลดรูปไม่สำเร็จ'); }
    finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Available quick actions based on status
  const quickActions = getQuickActions(job.status, isCancelled, job.receive_method, job);

  return (
    <div className="h-full flex flex-col">
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">

          {/* === Device Info Card === */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-black text-slate-800">{job.model || 'ไม่ระบุรุ่น'}</h2>
                <p className="text-xs text-slate-400 font-bold">{job.ref_no || `#${(job.id || '').slice(-6)}`}</p>
              </div>
              <div className="flex items-center gap-2">
                {job.receive_method && METHOD_CONFIG[job.receive_method] && (
                  <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${METHOD_CONFIG[job.receive_method].color}`}>
                    {METHOD_CONFIG[job.receive_method].icon}
                    {job.receive_method}
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={openEditModal}
                    className="p-1.5 rounded-full bg-slate-100 text-slate-600 active:bg-slate-200"
                    aria-label="แก้ไข"
                  >
                    <Edit3 size={14} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={handleDelete}
                    className="p-1.5 rounded-full bg-red-50 text-red-500 active:bg-red-100"
                    aria-label="ลบ"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Status badge */}
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[job.status] || 'bg-slate-100 text-slate-600'}`}>
              {job.status}
            </span>

            {/* Pipeline */}
            <div className="flex items-center gap-1 mt-4">
              {PIPELINE.map((step, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`h-1.5 w-full rounded-full ${
                    i <= currentStepIdx ? 'bg-blue-500' :
                    isCancelled ? 'bg-red-200' : 'bg-slate-200'
                  }`} />
                  <span className={`text-[9px] font-bold ${
                    i <= currentStepIdx ? 'text-blue-600' : 'text-slate-400'
                  }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* === Price Summary Card === */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={16} className="text-emerald-500" />
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">ราคา</h3>
            </div>
            {/* ลูกค้าส่งคำขอใบเสนอราคา (สเปกยังไม่มีราคากลาง — ราคาเข้ามาเป็น 0)
                ทีมงานต้องติดต่อกลับแล้วตั้งราคาผ่าน "แก้ไขข้อมูลงาน" — พอมี
                final_price แล้วแบนเนอร์นี้หายเอง (isAwaitingOffer) */}
            {isAwaitingOffer(job) && (
              <div className="mb-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                <p className="text-xs font-black text-blue-700 mb-0.5">ลูกค้าขอใบเสนอราคา</p>
                <p className="text-[11px] text-blue-600 leading-relaxed">
                  สเปกนี้ยังไม่มีราคากลางในระบบ — โทรติดต่อลูกค้าเพื่อเสนอราคา แล้วบันทึกราคาที่ตกลงผ่านเมนู &ldquo;แก้ไขข้อมูลงาน&rdquo;
                </p>
              </div>
            )}
            {/* Make Offer — ลูกค้าเสนอราคาเอง: CEO/MANAGER ตัดสิน รับ/เคาน์เตอร์/ยืนราคา
                (เขียนเงินสูตรเดียวกับ desktop handleDecideCustomerOffer) */}
            {job.customer_offer && !isCancelled && (
              <CustomerOfferDecisionCard job={job} canReview={isPrivileged} onDecide={handleDecideCustomerOffer} light />
            )}
            <div className="space-y-2">
              {/* งานที่ขายพ่วงอุปกรณ์เสริม: basePrice คือยอดรวมก้อนเดียว (invariant เดิม)
                  — โชว์ breakdown เครื่อง + รายชิ้นให้แอดมินเห็น ไม่แตะสูตรเงิน */}
              {Array.isArray(job.accessory_items) && job.accessory_items.length > 0 ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">ราคาเครื่อง</span>
                    <span className="font-bold text-slate-800">฿{Math.max(0, basePrice - sumAccessoryItems(job.accessory_items)).toLocaleString()}</span>
                  </div>
                  {job.accessory_items.map((it: any, i: number) => (
                    <div key={it.id || i} className="flex justify-between text-[11px] pl-2">
                      <span className="text-slate-400">+ {it.model_name}{job.accessories_unpacked_at ? ' (เข้าสต๊อกแล้ว)' : ''}</span>
                      <span className="font-bold text-slate-500">฿{(Number(it.price) || 0).toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">รวมเครื่อง + อุปกรณ์เสริม</span>
                    <span className="font-bold text-slate-800">฿{basePrice.toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">ราคาเครื่อง</span>
                  <span className="font-bold text-slate-800">฿{basePrice.toLocaleString()}</span>
                </div>
              )}
              {grossPickupFee > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">ค่าไรเดอร์</span>
                  <span className="font-bold text-red-500">-฿{grossPickupFee.toLocaleString()}</span>
                </div>
              )}
              {/* Rider-fee discount the company absorbed (promo). Show it +
                  the net so a fully-waived fee (effective 0) isn't invisible
                  — the gross row above otherwise reconciles to nothing. */}
              {riderFeeDiscount > 0 && (
                <>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5 min-w-0">
                      <span className="truncate">ส่วนลดค่าไรเดอร์{(job.applied_rider_promo?.name || job.applied_rider_promo?.code) ? ` (${job.applied_rider_promo.name || job.applied_rider_promo.code})` : ''}</span>
                      {isPrivileged && canTouchMoney && (
                        <>
                          <button
                            onClick={() => {
                              const v = window.prompt('ส่วนลดค่าไรเดอร์ใหม่ (บาท)', String(riderFeeDiscount));
                              if (v === null) return;
                              const n = Number(v);
                              if (Number.isFinite(n) && n >= 0) handleEditRiderDiscount(n);
                            }}
                            className="text-[10px] text-blue-500 underline underline-offset-2 shrink-0"
                          >แก้ไข</button>
                          <button onClick={handleRemoveRiderDiscount} className="text-slate-300 active:text-red-500 shrink-0" aria-label="ยกเลิกส่วนลด">
                            <CloseIcon size={12} />
                          </button>
                        </>
                      )}
                    </span>
                    <span className="font-bold text-emerald-500 shrink-0">+฿{riderFeeDiscount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-[11px] pl-2">
                    <span className="text-slate-400">ค่าบริการรับเครื่องสุทธิ</span>
                    <span className="font-bold text-slate-500">{pickupFee === 0 ? 'ฟรี' : `-฿${pickupFee.toLocaleString()}`}</span>
                  </div>
                </>
              )}
              {/* หนึ่งบรรทัดต่อหนึ่งคูปอง — งานจากเว็บถือได้หลายใบ ลบได้ทีละใบ
                  (trigger คืน ledger/quota ให้เฉพาะใบที่หลุด). ปุ่ม "แก้ไข" อยู่
                  บรรทัดแรกใบเดียวเพราะมันคือ Manual Top-up ซึ่งแทนที่ทั้งชุด */}
              {!couponFormOpen && listAppliedCoupons(job).map((c, i) => {
                const v = Number(c.actual_value ?? c.value) || 0;
                if (v <= 0 && c.type !== 'service') return null;
                return (
                  <div key={`${c.code || 'coupon'}-${i}`} className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 flex items-center gap-1.5 min-w-0">
                      <span className="truncate">คูปอง ({c.code})</span>
                      {isPrivileged && canTouchMoney && (
                        <>
                          {i === 0 && (
                            <button
                              onClick={() => { setCouponCode(c.code || ''); setCouponAmount(String(v || '')); setCouponFormOpen(true); }}
                              className="text-[10px] text-blue-500 underline underline-offset-2 shrink-0"
                            >แก้ไข</button>
                          )}
                          <button onClick={() => handleRemoveCoupon(i)} className="text-slate-300 active:text-red-500 shrink-0" aria-label={`ลบคูปอง ${c.code || ''}`}>
                            <CloseIcon size={12} />
                          </button>
                        </>
                      )}
                    </span>
                    <span className="font-bold text-green-500 shrink-0">
                      {c.type === 'service' ? 'ฟรีค่าบริการ' : `+฿${v.toLocaleString()}`}
                    </span>
                  </div>
                );
              })}
              {isPrivileged && canTouchMoney && listAppliedCoupons(job).length === 0 && !couponFormOpen && (
                <button onClick={() => { setCouponCode(''); setCouponAmount(''); setCouponFormOpen(true); }} className="w-full py-1.5 border border-dashed border-slate-200 rounded-lg text-[11px] font-bold text-slate-400 active:bg-slate-50">
                  + เพิ่มคูปอง / Top-up (Admin)
                </button>
              )}
              {couponFormOpen && (
                <div className="pt-1">
                  <div className="flex gap-1.5">
                    <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="โค้ด / เหตุผล" className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
                    <input value={couponAmount} onChange={(e) => setCouponAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="1000" className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-right" />
                    <button onClick={handleSaveCoupon} className="bg-emerald-600 text-white px-3 rounded-lg text-xs font-black">บันทึก</button>
                    <button onClick={() => setCouponFormOpen(false)} className="text-slate-400 px-1" aria-label="ปิด"><CloseIcon size={14} /></button>
                  </div>
                </div>
              )}
              {/* Itemised ad-hoc adjustments (ต่อรองราคา/หักตำหนิ) — transparent
                  lines the customer also sees, survive the inspection
                  recompute (unlike a final_price edit). Mirrors desktop
                  PricingSidebar. */}
              {appliedAdjustments.map((a) => {
                const neg = Number(a.amount) < 0;
                return (
                  <div key={a.id} className="text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 flex items-center gap-1.5 min-w-0">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${neg ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>Offer</span>
                        <span className="truncate">{a.label}</span>
                        {isPrivileged && canTouchMoney && (
                          <button onClick={() => handleRemoveAdjustment(a.id)} className="text-slate-300 active:text-red-500 shrink-0" aria-label="ลบรายการ">
                            <CloseIcon size={12} />
                          </button>
                        )}
                      </span>
                      <span className={`font-bold shrink-0 ${neg ? 'text-red-500' : 'text-emerald-500'}`}>{neg ? '-' : '+'}฿{Math.abs(Number(a.amount)).toLocaleString()}</span>
                    </div>
                    {(a.by_name || a.approved_by_name) && (
                      <p className="text-[10px] text-slate-400 pl-1">เสนอโดย {a.by_name || '-'}{a.approved_by_name ? ` · อนุมัติโดย ${a.approved_by_name}` : ''}</p>
                    )}
                  </div>
                );
              })}
              {pendingAdjustments.map((a) => (
                <div key={a.id} className="text-xs text-amber-600">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 shrink-0">รออนุมัติ</span>
                      <span className="truncate">{a.label}</span>
                    </span>
                    <span className="font-bold shrink-0">{Number(a.amount) < 0 ? '-' : '+'}฿{Math.abs(Number(a.amount)).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between pl-1 mt-0.5">
                    <p className="text-[10px] text-slate-400">เสนอโดย {a.by_name || '-'}</p>
                    {a.source === 'admin_manual' && isPrivileged && canTouchMoney && (
                      <span className="flex gap-1.5 shrink-0">
                        <button onClick={() => handleReviewAdjustment(a.id, true)} className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black active:bg-emerald-700">อนุมัติ</button>
                        <button onClick={() => handleReviewAdjustment(a.id, false)} className="px-2.5 py-1 rounded-lg bg-red-50 text-red-500 border border-red-100 text-[10px] font-black active:bg-red-100">ปฏิเสธ</button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {canTouchMoney && (
                <div className="pt-1 space-y-1.5">
                  <input
                    value={adjLabel}
                    onChange={(e) => setAdjLabel(e.target.value)}
                    placeholder="เช่น เพิ่มราคาตามตกลงในแชท"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <SignedAmountInput tone="light" amount={adjAmount} direction={adjDir} onChange={(a, d) => { setAdjAmount(a); setAdjDir(d); }} />
                    <button onClick={handleAddAdjustment} disabled={adjBusy || !adjLabel.trim() || signedAmount(adjAmount, adjDir) === null} className="bg-slate-800 text-white px-3 rounded-lg text-xs font-black disabled:opacity-40 shrink-0">{isPrivileged ? 'เพิ่ม' : 'เสนอ'}</button>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    เลือก "- หัก" หรือ "+ เพิ่ม" แล้วใส่จำนวนเงิน · ไม่ถูกล้างตอนตรวจเครื่อง · ลูกค้าเห็นในหน้า Tracking
                    {!isPrivileged && ' · รายการของคุณจะส่งขออนุมัติจาก CEO/MANAGER ก่อนมีผล'}
                  </p>
                </div>
              )}
              <div className="border-t border-slate-100 pt-2 flex justify-between">
                <span className="text-sm font-bold text-slate-600">ยอดโอนลูกค้า</span>
                <span className="text-lg font-black text-emerald-600">฿{netPayout.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* === Rider-cancelled banner ===
              Rider cancelled mid-pickup. New rider writes (PR
              bkk-rider-app#52) park the job at Following Up so it
              doesn't auto-rebroadcast and spam other riders. Older
              jobs (pre-#52) sit at Active Leads with the same
              cancelled_* fields — both shapes show this banner. */}
          {(['Active Leads', 'Active Lead', 'Following Up'].includes(job.status)) &&
            !job.rider_id &&
            job.cancelled_at &&
            (job.cancelled_by || '').startsWith('rider:') && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-amber-700 uppercase tracking-wider">ไรเดอร์ยกเลิกระหว่างทาง — รอแอดมินตัดสิน</p>
                  {job.cancel_category && (
                    <p className="text-[11px] font-bold text-amber-700 mt-1">
                      เหตุผล: {CANCEL_CATEGORY_LABEL_TH[job.cancel_category as keyof typeof CANCEL_CATEGORY_LABEL_TH] || job.cancel_category}
                      {job.cancel_reason ? ` — ${job.cancel_reason}` : ''}
                    </p>
                  )}
                  <p className="text-[11px] text-amber-600 mt-1.5 leading-relaxed">
                    เลือก "ส่งให้ไรเดอร์ใหม่" เพื่อ broadcast ต่อ, "กลับไปติดตาม" เพื่อโทรลูกค้าก่อน, หรือกด "ยกเลิกงาน" ด้านล่างเพื่อปิดงาน
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* === Customer Info Card === */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <User size={16} className="text-blue-500" />
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">ข้อมูลลูกค้า</h3>
              </div>
              {job.cust_phone && (
                <button
                  onClick={() => setShowTimeline(true)}
                  className="flex items-center gap-1 text-[10px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-100 transition-colors uppercase tracking-wider"
                  title="ดูประวัติการซื้อ-ขายของลูกค้า"
                >
                  <History size={12} /> ประวัติลูกค้า
                </button>
              )}
            </div>
            <div className="space-y-2.5">
              {job.cust_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-700">{job.cust_name}</span>
                </div>
              )}
              {job.cust_phone && (
                <button onClick={handleCall} className="flex items-center gap-2 text-sm text-blue-600">
                  <Phone size={14} className="shrink-0" />
                  <span className="underline">{job.cust_phone}</span>
                </button>
              )}
              {(job.cust_address || job.store_branch) && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">{job.cust_address || job.store_branch}</span>
                </div>
              )}
              {job.cust_notes && (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2">
                  <ClipboardCheck size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-wider mb-0.5">หมายเหตุจากลูกค้า</p>
                    <p className="text-xs text-amber-900 leading-relaxed whitespace-pre-wrap break-words">{job.cust_notes}</p>
                  </div>
                </div>
              )}
              {job.agent_name && (
                <div className="flex items-center gap-2 text-sm">
                  <ClipboardCheck size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">ผู้รับผิดชอบ: <b>{job.agent_name}</b></span>
                </div>
              )}
              {(() => {
                const riderName = job.rider_name || job.assigned_rider_name || rider?.name;
                const riderPhone = job.rider_phone || rider?.phone;
                if (!riderName && !riderPhone && !job.rider_id) return null;
                return (
                  <div className="flex items-center gap-2 text-sm">
                    <Truck size={14} className="text-blue-500 shrink-0" />
                    <span className="text-slate-600">
                      ไรเดอร์: <b>{riderName || job.rider_id}</b>
                      {riderPhone && (
                        <>
                          {' '}
                          <a href={`tel:${riderPhone}`} className="text-blue-600 underline">{riderPhone}</a>
                        </>
                      )}
                    </span>
                  </div>
                );
              })()}
              {job.pickup_schedule && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">
                    นัดหมาย: {job.pickup_schedule.date || ''} {job.pickup_schedule.time || ''}
                    {job.pickup_schedule.type === 'instant' && ' (ด่วน)'}
                  </span>
                </div>
              )}
              {job.created_at && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-600">
                    สร้างเมื่อ: {new Date(job.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* === Mail-in parcel tracking ===
              PWA had no tracking UI at all — if the customer never submitted a
              number themselves, admin had to reach for a desktop to enter it.
              Same fields and same write as desktop CustomerInfoCard. */}
          {job.receive_method === 'Mail-in' && !isCancelled && (
            <div className="bg-white rounded-2xl border border-orange-100 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Truck size={16} className="text-orange-500" />
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">พัสดุ (Mail-in)</h3>
                </div>
                {!isEditingTracking && (
                  <button
                    onClick={() => {
                      setTrackingInput(job.tracking_number || '');
                      setCourierInput(job.courier_name || '');
                      setIsEditingTracking(true);
                    }}
                    className="flex items-center gap-1 text-[10px] font-black text-orange-600 bg-orange-50 px-2.5 py-1 rounded-lg border border-orange-100 uppercase tracking-wider active:bg-orange-100"
                  >
                    <Edit3 size={12} /> {job.tracking_number ? 'แก้ไข' : 'กรอกเลขพัสดุ'}
                  </button>
                )}
              </div>

              {isEditingTracking ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 ml-1">ขนส่ง (เช่น Kerry, Flash, J&amp;T)</label>
                    <input
                      type="text"
                      value={courierInput}
                      onChange={(e) => setCourierInput(e.target.value)}
                      placeholder="ชื่อขนส่ง"
                      className="w-full text-sm font-bold border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-orange-400 mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 ml-1">เลข Tracking</label>
                    <input
                      type="text"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                      placeholder="เลข Tracking Number"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      className="w-full text-sm font-bold font-mono border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:border-orange-400 mt-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsEditingTracking(false)}
                      className="flex-1 py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 bg-white"
                    >
                      ยกเลิก
                    </button>
                    <button
                      onClick={handleSaveTracking}
                      disabled={savingTracking}
                      className="flex-[2] py-3 rounded-xl text-sm font-bold text-white bg-orange-500 disabled:bg-orange-300 flex justify-center items-center gap-1.5"
                    >
                      <Save size={14} /> {savingTracking ? 'กำลังบันทึก...' : 'บันทึกเลขพัสดุ'}
                    </button>
                  </div>
                </div>
              ) : job.tracking_number ? (
                <div>
                  {job.courier_name && (
                    <p className="text-[10px] font-bold text-slate-500">{job.courier_name}</p>
                  )}
                  <p className="text-sm font-black text-orange-700 tracking-wider font-mono break-all">{job.tracking_number}</p>
                  <ThaiPostTracking jobId={job.id} trackingNumber={job.tracking_number} />
                </div>
              ) : (
                <p className="text-xs font-bold text-slate-400">รอลูกค้าส่งพัสดุและแจ้งเลข Tracking</p>
              )}
            </div>
          )}

          {/* === On-site amendment banner (if pending/approved) === */}
          <AmendmentBanner jobId={job.id} />

          {/* === KYC (rider-captured at pickup, admin-captured at branch for Store-in) === */}
          <KYCInfoCard
            job={job}
            onCaptureKyc={() => setShowKycModal(true)}
            staffName={currentUser?.name}
            currentRole={currentUser?.role}
          />

          {/* === Location verification (registration vs typed address) === */}
          <LocationVerificationCard job={job} />

          {/* === Rider check-in timeline (Phase 1A) — links each stage to Maps pin === */}
          <CheckpointsCard job={job} />

          {/* === Branch-intake device verification — IMEI / Battery / Find My / Warranty.
              Store-in (dropped off) and Mail-in (parcel) both land at the branch and
              are verified by admin (no rider in the loop). === */}
          {(job.receive_method === 'Store-in' || job.receive_method === 'Mail-in')
            && !job.verification_completed_at
            && !isCancelled
            && BRANCH_INTAKE_STATUSES.includes(job.status) && (
            <button
              onClick={() => setShowVerifyModal(true)}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-2xl p-4 flex items-center gap-3 shadow-md active:scale-[0.98] transition"
            >
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Smartphone size={20} />
              </div>
              <div className="text-left flex-1">
                <p className="font-bold">ตรวจเครื่องเบื้องต้น</p>
                <p className="text-xs text-blue-100">IMEI / Battery / Find My / Warranty (OCR)</p>
              </div>
            </button>
          )}

          {/* === Branch-intake inspection card — only when admin still needs to QC the device.
              Shown for Store-in and Mail-in: both arrive at the branch and the admin runs
              the assessment (the rider never touches these). === */}
          {(job.receive_method === 'Store-in' || job.receive_method === 'Mail-in')
            && !job.inspected_at
            && !isCancelled
            && BRANCH_INTAKE_STATUSES.includes(job.status) && (
            <button
              onClick={() => setShowInspectModal(true)}
              className="w-full bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-2xl p-4 flex items-center gap-3 shadow-md active:scale-[0.98] transition"
            >
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Camera size={20} />
              </div>
              <div className="text-left flex-1">
                <p className="font-bold">ตรวจสภาพเครื่อง</p>
                <p className="text-xs text-purple-100">ถ่ายรูป 6 ด้าน + เช็คลิสต์ → Pending QC</p>
              </div>
            </button>
          )}

          {/* === Sickw section — Banner สรุปสถานะ + Card ข้อมูลครบ === */}
          {job.sickw_check?.last_check && (
            <div className="space-y-3">
              <SickwGateBanner
                jobId={job.id}
                sickwCheck={job.sickw_check}
                gate={getSickwGateStatus(job.sickw_check)}
                currentRole={currentUser?.role}
              />
              {/* expandable card — แสดง parsed fields ครบทุกอย่าง
                  (Model, Capacity, Country, IMEI, Serial, Carrier, ฯลฯ) */}
              <SickwStoredResultCard sickwCheck={job.sickw_check} job={job} />
            </div>
          )}

          {/* ค่าแบตเตอรี่ — มาจากการตรวจสภาพเครื่อง (ไม่ใช่ SickW) */}
          <BatteryHealthCard job={job} editorName={currentUser?.name} />

          {/* === Device Details (enhanced) === */}
          {(job.devices && job.devices.length > 0 ? job.devices : [job]).map((dev: any, idx: number) => {
            const customerConds = dev.customer_conditions || (idx === 0 ? job.customer_conditions : []) || [];
            const riderChecks = dev.rider_conditions || dev.deductions || (idx === 0 ? job.deductions : []) || [];
            const devicePhotos = dev.photos || (idx === 0 && job.photos ? job.photos : []);
            const isInspected = dev.inspection_status === 'Inspected';

            return (
              <div key={idx} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm space-y-3">
                {/* Device header */}
                <div className="flex items-center gap-2 mb-1">
                  <Package size={16} className="text-purple-500" />
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                    เครื่อง {idx + 1}
                  </h3>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-bold text-slate-700">{dev.model || job.model || `เครื่อง #${idx + 1}`}</span>
                    {(dev.price || dev.estimated_price) && (
                      <span className="font-bold text-emerald-600">฿{Number(dev.price || dev.estimated_price).toLocaleString()}</span>
                    )}
                  </div>
                  {dev.storage && <p className="text-xs text-slate-500">ความจุ: {dev.storage}</p>}
                  {dev.color && <p className="text-xs text-slate-500">สี: {dev.color}</p>}
                  {dev.grade && <p className="text-xs text-slate-500">เกรด: <span className="font-bold">{dev.grade}</span></p>}
                  {dev.serial && <p className="text-xs text-slate-400">SN: {dev.serial}</p>}
                  {dev.isNewDevice && (
                    <p className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg inline-block">เครื่องใหม่มือ 1</p>
                  )}
                </div>

                {/* Customer reported conditions */}
                {customerConds.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <ShieldCheck size={12} /> ลูกค้าแจ้งสภาพ
                    </p>
                    <div className="space-y-1.5">
                      {customerConds.map((c: any, i: number) => {
                        const cText = getConditionText(c);
                        const Icon = getConditionIcon(cText);
                        const matched = riderChecks.length > 0 && riderChecks.some((r: any) => {
                          const rText = getConditionText(r);
                          return cText.includes(rText) || rText.includes(cText);
                        });
                        return (
                          <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-[11px] font-bold ${
                            riderChecks.length === 0 ? 'bg-slate-50 text-slate-600 border border-slate-100' :
                            matched ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            'bg-red-50 text-red-600 border border-red-100'
                          }`}>
                            <Icon size={13} className="shrink-0 mt-0.5" />
                            <span>{cText}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Inspection / Rider deductions */}
                {riderChecks.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Search size={12} /> ผลตรวจจริง
                    </p>
                    <div className="space-y-1.5">
                      {riderChecks.map((d: any, i: number) => {
                        const dText = getConditionText(d);
                        const Icon = getConditionIcon(dText);
                        const isGood = dText.includes('สมบูรณ์') || dText.includes('ปกติ');
                        const isMatch = isGood || (customerConds.length > 0 && customerConds.some((c: any) => {
                          const cText = getConditionText(c);
                          return dText.includes(cText) || cText.includes(dText);
                        }));
                        return (
                          <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-[11px] font-bold ${
                            isMatch ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            'bg-red-50 text-red-600 border border-red-100'
                          }`}>
                            <Icon size={13} className="shrink-0 mt-0.5" />
                            <span>{dText}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* BKK Diagnos — start a session (Store-in / Mail-in staff mode) */}
                {!['Cancelled', 'Completed', 'Paid', 'Returned'].includes(job.status) && (
                  <DiagnosStartPanel job={job} deviceIndex={idx} />
                )}

                {/* BKK Diagnos on-device test report */}
                {dev.diagnostics && <DiagnosReportCard diagnostics={dev.diagnostics} />}

                {/* No conditions yet */}
                {customerConds.length === 0 && riderChecks.length === 0 && !dev.isNewDevice && (
                  <div className="text-center py-3 text-slate-300">
                    <Search size={20} className="mx-auto mb-1 opacity-30" />
                    <p className="text-[10px] font-bold">ยังไม่มีข้อมูลสภาพเครื่อง</p>
                  </div>
                )}

                {/* Device photos */}
                {devicePhotos.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Camera size={12} /> รูปถ่าย ({devicePhotos.length})
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                      {devicePhotos.map((url: string, i: number) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer"
                          className="w-20 h-20 shrink-0 rounded-xl overflow-hidden border border-slate-200">
                          <img src={url} className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* === Add Note === */}
          {!isCancelled && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileText size={16} className="text-slate-400" /> เพิ่มโน้ต
              </h3>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="พิมพ์บันทึกย่อ (จะแสดงในประวัติงาน)..."
                rows={2}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-blue-500 resize-none"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim() || savingNote}
                className="w-full mt-2 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-30"
              >
                {savingNote ? 'กำลังบันทึก...' : 'บันทึกโน้ต'}
              </button>
            </div>
          )}

          {/* === Activity Log (collapsible) === */}
          {job.qc_logs && job.qc_logs.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-slate-400" />
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                    ประวัติ ({job.qc_logs.length})
                  </h3>
                </div>
                {showLogs ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
              </button>
              {showLogs && (
                <div className="px-4 pb-4 space-y-2 max-h-64 overflow-y-auto">
                  {job.qc_logs.map((log: any, i: number) => (
                    <div key={i} className="flex gap-3 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-700">{log.action}</p>
                        {log.details && <p className="text-slate-500">{log.details}</p>}
                        <p className="text-slate-400 mt-0.5">
                          {log.by} · {new Date(log.timestamp).toLocaleString('th-TH')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* === Quick Actions (always visible) === */}
          {/* Always show the action panel for non-cancelled jobs so admin
              can at least access the bottom red Cancel button — the
              previous "hide if no quick actions and agent set" gate left
              jobs at uncovered statuses (e.g. canonical 'Active Lead'
              singular before fall-through, or any future status the
              switch doesn't list) with no recovery path. */}
          {!isCancelled && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">
                ดำเนินการ
              </h3>
              {!job.agent_name && (
                <button
                  onClick={handleClaim}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold"
                >
                  รับเคสนี้ (Claim)
                </button>
              )}
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (action.confirm && !confirm(action.confirm)) return;
                    handleUpdateStatus(action.status, action.log);
                  }}
                  className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${action.style}`}
                >
                  {action.label}
                </button>
              ))}
              <button
                onClick={() => setShowCancelModal(true)}
                className="w-full py-3 rounded-xl text-sm font-bold border border-red-200 text-red-500 bg-red-50"
              >
                ยกเลิกงาน
              </button>
            </div>
          )}

          {/* Soft-cancelled job — reopen onto the same ticket (revised offer
              price preserved) or close permanently. */}
          {isReopenable && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-black text-amber-700 uppercase tracking-wider">นำกลับมาขายใหม่ได้</h3>
                {reopenDaysLeft !== null && (
                  <span className="text-[10px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                    เหลือ {reopenDaysLeft} วันก่อนปิดถาวร
                  </span>
                )}
              </div>
              <p className="text-[11px] font-bold text-amber-700/80 leading-relaxed mb-1">
                ใช้ราคา revised offer เดิมบนใบงานเดิม
              </p>
              {job.rider_id && (
                <button
                  onClick={() => handleReopen(true)}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white"
                >
                  เปิดงานใหม่ — ไรเดอร์เดิมกลับไปรับ
                </button>
              )}
              <button
                onClick={() => handleReopen(false)}
                className="w-full py-3 rounded-xl text-sm font-bold bg-slate-900 text-white"
              >
                เปิดงานใหม่ — จ่ายงานให้ไรเดอร์ใหม่
              </button>
              <button
                onClick={handleCloseLost}
                className="w-full py-3 rounded-xl text-sm font-bold border border-red-200 text-red-500 bg-white"
              >
                ปิดงานถาวร (Closed)
              </button>
            </div>
          )}

          {/* Recovery — Pickup job advanced past handover without a rider fee. */}
          {needsFeeRecovery && (
            <div className="bg-rose-50 rounded-2xl border border-rose-200 shadow-sm p-4 space-y-2">
              <h3 className="text-xs font-black text-rose-600 uppercase tracking-wider">ค่าวิ่งไรเดอร์ยังไม่ถูกคำนวณ</h3>
              <p className="text-[11px] font-bold text-rose-700/80 leading-relaxed">
                งานนี้ถูกข้ามขั้นส่งมอบ (Pending QC) ไรเดอร์จึงยังไม่ได้ค่าวิ่ง กดเพื่อรับมอบย้อนหลัง — ระบบจะคำนวณค่าวิ่งให้
              </p>
              <button onClick={handleRecoverHandover} className="w-full py-3 rounded-xl text-sm font-bold bg-rose-600 text-white">
                รับมอบย้อนหลัง + คำนวณค่าวิ่ง (→ Pending QC)
              </button>
            </div>
          )}

          {/* Spacer for bottom bar */}
          <div className="h-20" />
        </div>
      </div>

      {/* === Bottom Action Bar === */}
      <div className="shrink-0 bg-white border-t border-slate-200 p-3 flex gap-2 safe-bottom">
        <button
          onClick={handleCall}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-500 text-white rounded-xl font-bold text-sm"
        >
          <Phone size={18} /> โทร
        </button>
        <button
          onClick={() => setShowChat(true)}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm relative"
        >
          <MessageSquare size={18} /> แชท
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-5 h-5 rounded-full flex items-center justify-center font-black">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* === Chat Modal (fullscreen on mobile) === */}
      {showChat && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col safe-top safe-bottom">
          {/* Chat Header */}
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg"><MessageSquare size={16} /></div>
              <div>
                <h3 className="text-sm font-bold">{job.model}</h3>
                <p className="text-[10px] text-slate-400">{job.ref_no || `#${(job.id || '').slice(-6)}`}</p>
              </div>
            </div>
            <button onClick={() => setShowChat(false)} className="p-2 hover:bg-slate-800 rounded-full">
              <XCircle size={22} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <MessageSquare size={36} className="mx-auto text-slate-200 mb-2" />
                <p className="text-sm font-bold">ยังไม่มีข้อความ</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isAdmin = msg.sender === 'admin';
              return (
                <div key={i} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                    isAdmin
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-tl-sm shadow-sm'
                  }`}>
                    {!isAdmin && <p className="text-[10px] font-black text-blue-600 mb-1">{msg.senderName}</p>}
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt="attachment"
                        className="mt-2 rounded-lg w-full max-h-48 object-cover"
                        onClick={() => window.open(msg.imageUrl, '_blank')}
                      />
                    )}
                    <p className="text-[8px] mt-1 text-right opacity-50">
                      {isAdmin && msg.read && <span>อ่านแล้ว · </span>}
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={chatScrollRef} />
          </div>

          {/* Chat Input */}
          {!['Pending QC', 'In Stock', 'Paid', 'PAID', 'Completed', 'Returned', 'Closed (Lost)', 'Cancelled'].includes(job.status) ? (
            <div className="p-3 bg-white border-t border-slate-100 flex gap-2 items-center shrink-0">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleChatImage} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="p-2.5 text-slate-400 hover:text-blue-600 rounded-xl"
              >
                {isUploading ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : <ImageIcon size={20} />}
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                placeholder="พิมพ์ข้อความ..."
                className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim()}
                className="p-2.5 bg-blue-600 text-white rounded-xl disabled:bg-slate-200"
              >
                <Send size={18} />
              </button>
            </div>
          ) : (
            <div className="p-4 bg-slate-100 text-center shrink-0">
              <span className="text-xs font-bold text-slate-500">แชทถูกปิดแล้ว (จบงาน)</span>
            </div>
          )}
        </div>
      )}

      {/* === Admin KYC Modal (branch intake — Store-in / Mail-in) === */}
      {showKycModal && job && (
        <AdminKYCModal
          job={job}
          staffName={currentUser?.name || 'Admin'}
          onClose={() => setShowKycModal(false)}
        />
      )}

      {/* === Admin Inspection Modal (Store-in / Mail-in branch intake) === */}
      {showInspectModal && job && (
        <AdminInspectionModal
          job={job}
          staffName={currentUser?.name || 'Admin'}
          onClose={() => setShowInspectModal(false)}
        />
      )}

      {/* === Admin Device Verification Modal (Store-in / Mail-in branch intake) === */}
      {showVerifyModal && job && (
        <AdminDeviceVerificationModal
          job={job}
          onClose={() => setShowVerifyModal(false)}
        />
      )}

      {/* === Cancel Modal (โครงเดียวกับ desktop — เลือกหมวดเหตุผล + รายละเอียด) === */}
      <CancelModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancelJob}
      />

      {showTimeline && job?.cust_phone && (
        <CustomerTimelineModal
          phone={job.cust_phone}
          name={job.cust_name}
          onClose={() => setShowTimeline(false)}
        />
      )}

      {/* === Edit Modal === */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4"
          onClick={() => !isSaving && setShowEditModal(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 sm:hidden">
              <div className="w-10 h-1 bg-slate-200 rounded-full" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-black text-base">แก้ไขข้อมูลงาน</h2>
              <button
                onClick={() => !isSaving && setShowEditModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg"
              >
                <CloseIcon size={20} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">รุ่นสินค้า</label>
                <input
                  type="text"
                  value={editForm.model}
                  onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">ราคา (บาท)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={editForm.price}
                  onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <p className="text-[10px] text-amber-600 mt-1 leading-relaxed">
                  ราคาที่แก้ตรงนี้จะถูกคำนวณใหม่ตอนตรวจสภาพเครื่อง (คิดจากราคากลาง − ค่าหักสภาพ)
                  — ถ้าเป็นการเพิ่ม/ลดราคาจากการต่อรอง ให้ใช้ช่อง &quot;ปรับราคา&quot; ในการ์ดยอดเงินแทน จะไม่ถูกล้างทิ้ง
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">ชื่อลูกค้า</label>
                <input
                  type="text"
                  value={editForm.cust_name}
                  onChange={(e) => setEditForm({ ...editForm, cust_name: e.target.value })}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">เบอร์โทร</label>
                <input
                  type="tel"
                  value={editForm.cust_phone}
                  onChange={(e) => setEditForm({ ...editForm, cust_phone: e.target.value })}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Trade method — switching recalculates the rider fee / payout and
                  withdraws any assigned rider (handled server-side). */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">วิธีรับเครื่อง (Trade Method)</label>
                <div className="grid grid-cols-3 gap-2">
                  {RECEIVE_METHOD_OPTIONS.map((opt) => {
                    const active = editForm.receive_method === opt.id;
                    const locked = !canChangeReceiveMethod(job.status);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={locked && !active}
                        onClick={() => setEditForm({ ...editForm, receive_method: opt.id })}
                        className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-all ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'} ${locked && !active ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {!canChangeReceiveMethod(job.status) ? (
                  <p className="text-[10px] text-amber-600 mt-1">เปลี่ยนวิธีรับไม่ได้ในสถานะนี้ (งานเข้าสู่ขั้นรับเครื่อง/จ่ายเงินแล้ว)</p>
                ) : editForm.receive_method !== job.receive_method ? (
                  <p className="text-[10px] text-blue-600 mt-1">ระบบจะคำนวณค่าไรเดอร์/ยอดโอนใหม่อัตโนมัติหลังบันทึก{job.receive_method === 'Pickup' ? ' และถอนงานจากไรเดอร์ที่ถืออยู่' : ''}</p>
                ) : null}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">{locationLabel(editForm.receive_method)}</label>
                {editForm.receive_method === 'Store-in' ? (
                  // Store-in = pick a REAL branch (settings/branches) — never
                  // free text. The save snapshots branch_name/branch_details
                  // exactly like the customer checkout does.
                  <>
                    <select
                      value={editForm.branch_id}
                      onChange={(e) => setEditForm({ ...editForm, branch_id: e.target.value })}
                      className="w-full border rounded-xl px-4 py-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    >
                      <option value="">— เลือกสาขา —</option>
                      {branchList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name || b.id}{b.isOpen === false ? ' (ปิดทำการชั่วคราว)' : ''}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const b = branchList.find((x) => x.id === editForm.branch_id);
                      if (!b) return branchList.length === 0
                        ? <p className="text-[10px] text-amber-600 mt-1">โหลดรายชื่อสาขาไม่สำเร็จ หรือยังไม่มีสาขาในระบบ (จัดการที่เมนู Branch Manager)</p>
                        : null;
                      return (
                        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                          {[b.address, b.phone ? `โทร ${b.phone}` : ''].filter(Boolean).join(' · ')}
                        </p>
                      );
                    })()}
                  </>
                ) : (
                  <textarea
                    value={editForm.cust_address}
                    onChange={(e) => setEditForm({ ...editForm, cust_address: e.target.value })}
                    rows={2}
                    className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                  />
                )}
                {/* Pickup only — pin the location so the rider fee / payout can
                    be recomputed from the real distance (auto after save). */}
                {editForm.receive_method === 'Pickup' && (
                  <div className="mt-2">
                    <PickupLocationPicker
                      address={editForm.cust_address}
                      lat={editForm.cust_lat}
                      lng={editForm.cust_lng}
                      onChange={({ lat, lng }) => setEditForm((f) => ({ ...f, cust_lat: lat, cust_lng: lng }))}
                    />
                  </div>
                )}
              </div>

              {/* Reschedule — date + start/end time range. Works for every
                  receive method; writes pickup_schedule so the calendar updates. */}
              <div className="pt-2 mt-1 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1.5">
                  <Clock size={13} className="text-blue-500" /> วันและเวลานัดหมาย
                </label>
                <input
                  type="date"
                  value={editForm.appt_date}
                  onChange={(e) => setEditForm({ ...editForm, appt_date: e.target.value })}
                  className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-2"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 mb-1">เวลาเริ่ม</span>
                    <input
                      type="time"
                      value={editForm.appt_start}
                      onChange={(e) => setEditForm({ ...editForm, appt_start: e.target.value })}
                      className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 mb-1">เวลาสิ้นสุด</span>
                    <input
                      type="time"
                      value={editForm.appt_end}
                      onChange={(e) => setEditForm({ ...editForm, appt_end: e.target.value })}
                      className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">เว้นว่างไว้หากไม่ต้องการนัดหมาย • เวลาสิ้นสุดไม่บังคับ</p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t bg-slate-50 rounded-b-2xl">
              <button
                onClick={() => !isSaving && setShowEditModal(false)}
                disabled={isSaving}
                className="flex-1 px-4 py-2.5 rounded-xl border bg-white text-sm font-bold text-slate-600 active:bg-slate-100 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Condition text helpers
// ---------------------------------------------------------------------------

const getConditionText = (item: any): string => {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const textValue = item.value || item.label;
    if (item.title && textValue) return `[${item.title}] ${textValue}`;
    return textValue || item.title || JSON.stringify(item);
  }
  return '';
};

const getConditionIcon = (text: string) => {
  const t = text || '';
  if (t.includes('จอ') || t.includes('กระจก')) return Monitor;
  if (t.includes('ตัวเครื่อง') || t.includes('ฝาหลัง') || t.includes('รอย')) return Smartphone;
  if (t.includes('แบต')) return Battery;
  if (t.includes('ทำงาน') || t.includes('ระบบ')) return Cpu;
  if (t.includes('อุปกรณ์') || t.includes('กล่อง')) return Package;
  if (t.includes('โมเดล') || t.includes('ประเทศ') || t.includes('รหัส')) return Globe;
  return Info;
};

// ---------------------------------------------------------------------------
// Quick Actions by Status
// ---------------------------------------------------------------------------

function getQuickActions(status: string, isCancelled: boolean, receiveMethod?: string, job?: any) {
  if (isCancelled) return [];

  const actions: { label: string; status: string; log: string; style: string; confirm?: string }[] = [];
  const isPickup = receiveMethod === 'Pickup';
  const isMailIn = receiveMethod === 'Mail-in';
  // The "ส่งให้ไรเดอร์ (Active Leads)" broadcast button is available
  // through the whole sales phase for Pickup orders so admin can
  // dispatch as soon as the customer confirms — no need to walk
  // through every intermediate status.
  const dispatchAction = {
    label: 'ส่งให้ไรเดอร์ (Broadcast)',
    status: 'Active Leads',
    log: 'แอดมินส่งงานให้ไรเดอร์ (broadcast pool)',
    style: 'bg-orange-500 text-white',
  };
  // Branch intake (Store-in drop-off / Mail-in parcel): the device is at the
  // counter and admin runs the assessment — no rider in the loop. Being
  // Inspected is the status the branch-intake inspection card unlocks, which
  // then writes Pending QC on submit.
  const branchIntakeAction = {
    label: isMailIn
      ? 'เปิดพัสดุแล้ว เริ่มตรวจสอบ (Being Inspected)'
      : 'รับเครื่องแล้ว เริ่มตรวจสอบ (Being Inspected)',
    status: 'Being Inspected',
    log: isMailIn
      ? 'พัสดุถึงสาขา เปิดพัสดุแล้ว เริ่มตรวจสอบ'
      : 'รับเครื่องที่สาขา/พัสดุถึงแล้ว เริ่มตรวจสอบ',
    style: 'bg-purple-500 text-white',
  };
  // Mail-in only — parcel is physically in hand but nobody has opened it yet.
  // Mirrors the desktop "รับพัสดุไว้ก่อน (ยังไม่เปิด)" button in PricingSidebar.
  const parcelHeldAction = {
    label: 'รับพัสดุไว้ก่อน (ยังไม่เปิด)',
    status: 'Parcel Received',
    log: 'รับพัสดุที่สาขา รอเปิดและตรวจ',
    style: 'bg-orange-50 text-orange-700 border border-orange-200',
  };

  switch (status) {
    case 'New Lead':
      actions.push({ label: 'เริ่มติดตาม (Following Up)', status: 'Following Up', log: 'เริ่มติดตามลูกค้า', style: 'bg-amber-500 text-white' });
      actions.push({ label: 'นัดหมายแล้ว (Appointment Set)', status: 'Appointment Set', log: 'ลูกค้ายืนยันนัดหมาย', style: 'bg-cyan-500 text-white' });
      if (isPickup) actions.push(dispatchAction);
      break;
    case 'Following Up': {
      const wasRiderCancelled = !!job?.cancelled_at && (job?.cancelled_by || '').startsWith('rider:');
      actions.push({ label: 'นัดหมายแล้ว (Appointment Set)', status: 'Appointment Set', log: 'ลูกค้ายืนยันนัดหมาย', style: 'bg-cyan-500 text-white' });
      if (isPickup) {
        // After a rider cancels mid-pickup we land here (PR bkk-rider-app#52).
        // Re-label the broadcast button so admin knows this is a deliberate
        // re-dispatch, not the first send.
        if (wasRiderCancelled) {
          actions.push({
            label: 'ส่งให้ไรเดอร์ใหม่ (Re-broadcast)',
            status: 'Active Leads',
            log: 'แอดมินยืนยันให้ broadcast ใหม่หลังไรเดอร์ยกเลิก',
            style: 'bg-orange-500 text-white',
          });
        } else {
          actions.push(dispatchAction);
        }
      }
      break;
    }
    case 'Appointment Set':
    case 'Waiting Drop-off':
    case 'Awaiting Shipping':
      if (isPickup) {
        actions.push(dispatchAction);
      } else {
        // Store-in / Mail-in: the device can land at the counter at any point
        // during the sales phase (customer walks in early, parcel arrives
        // before anyone updates tracking), so offer the intake action here too
        // instead of forcing a detour through Active Leads.
        actions.push(branchIntakeAction);
        if (isMailIn) actions.push(parcelHeldAction);
        actions.push({ label: 'เริ่มดำเนินการ (Active Leads)', status: 'Active Leads', log: 'เริ่มดำเนินการ', style: 'bg-orange-500 text-white' });
      }
      break;
    // Mail-in logistics. `Parcel In Transit` is what the customer's own
    // tracking submission writes (bkk-frontend-next /api/jobs/action) and
    // `Parcel Received` is the desktop "hold the parcel unopened" state —
    // neither was covered here, so a Mail-in job that reached either status
    // had NO way forward on mobile (only the Diagnos panel rendered).
    case 'Parcel In Transit':
      actions.push(branchIntakeAction);
      actions.push(parcelHeldAction);
      break;
    case 'Parcel Received':
      actions.push(branchIntakeAction);
      break;
    // Store-in: parcel/device logged in at the branch, still needs assessment.
    case 'Drop-off Received':
      actions.push(branchIntakeAction);
      break;
    case 'Active Lead':
    case 'Active Leads': {
      // Mail-in / Store-in never have a rider in the loop — the customer ships
      // the device or drops it at the branch, then admin opens the parcel,
      // captures KYC at the counter, and starts inspection. The rider-centric
      // logic below assumes a Pickup, so for these methods it would strand the
      // job at Active Leads with only a backward "Following Up" button and no
      // way to move the work forward.
      if (!isPickup) {
        actions.push(branchIntakeAction);
        if (isMailIn) actions.push(parcelHeldAction);
        actions.push({ label: 'กลับไปติดตาม (Following Up)', status: 'Following Up', log: 'กลับไปสถานะติดตามลูกค้า', style: 'bg-amber-500 text-white' });
        break;
      }
      // Two distinct cases at Active Lead (Pickup):
      // 1) Fresh broadcast — rider hasn't claimed yet, rider_id is null,
      //    cancelled_at is unset. Only useful action is wait for a rider
      //    to pick it up; admin can move it back to Following Up if they
      //    want to re-call the customer.
      // 2) Post-rider-cancel — rider claimed then cancelled mid-pickup.
      //    rider_id is null again BUT cancelled_at + cancel_category
      //    linger from the rider's write. Admin needs to either confirm
      //    the cancellation (use bottom red button) or re-broadcast.
      // The old single 'In-Transit' action assumed a rider was already
      // dispatched and just needed admin to mark them en-route — wrong
      // for both cases above.
      const hasRider = !!job?.rider_id;
      const wasRiderCancelled = !!job?.cancelled_at && (job?.cancelled_by || '').startsWith('rider:');
      if (hasRider) {
        actions.push({ label: 'กำลังเดินทาง (In-Transit)', status: 'In-Transit', log: 'ไรเดอร์กำลังเดินทาง', style: 'bg-yellow-500 text-white' });
      } else {
        // No rider currently. Either nobody picked up yet, or a rider
        // dropped it. Admin can re-broadcast or fall back to Following Up.
        if (wasRiderCancelled) {
          actions.push({
            label: 'ส่งให้ไรเดอร์ใหม่ (Re-broadcast)',
            status: 'Active Leads',
            log: 'แอดมินยืนยันให้ broadcast ใหม่หลังไรเดอร์ยกเลิก',
            style: 'bg-orange-500 text-white',
          });
        }
        actions.push({ label: 'กลับไปติดตาม (Following Up)', status: 'Following Up', log: 'กลับไปสถานะติดตามลูกค้า', style: 'bg-amber-500 text-white' });
      }
      break;
    }
    case 'Assigned':
    case 'Accepted':
      actions.push({ label: 'กำลังเดินทาง (In-Transit)', status: 'In-Transit', log: 'ไรเดอร์กำลังเดินทาง', style: 'bg-yellow-500 text-white' });
      break;
    case 'Heading to Customer':
    case 'In-Transit':
    case 'Arrived':
      // 'In-Transit' is overloaded (see normalizeStatus in job-statuses.ts):
      // Pickup = rider on the road, Mail-in = parcel with the courier. Legacy
      // Mail-in jobs still sit on this value, so give them the parcel actions.
      if (!isPickup) {
        actions.push(branchIntakeAction);
        if (isMailIn) actions.push(parcelHeldAction);
        break;
      }
      actions.push({ label: 'รับเครื่องแล้ว ตรวจสอบ (Being Inspected)', status: 'Being Inspected', log: 'ได้รับเครื่องแล้ว เริ่มตรวจสอบ', style: 'bg-purple-500 text-white' });
      break;
    case 'Being Inspected':
    case 'Pending QC':
    case 'QC Review': {
      // "Pending QC" appears in TWO different points in our flow:
      //   1. PRE-payment (Mail-in / Store-in inspection at branch
      //      before admin transfers money) → next step is Payout.
      //   2. POST-payment (Pickup flow, after rider returns to branch
      //      with the device) → payment already done; next step is
      //      Lab / Stock / Sold for the resale pipeline.
      // Detect by scanning qc_logs for a prior "Paid" / "PAID" entry.
      // If we ever paid this job, "ผ่าน QC → Payout" would loop a
      // second payout — wrong. Branch accordingly.
      const wasPaid = (job?.qc_logs || []).some(
        (l: any) => l && (l.action === 'Paid' || l.action === 'PAID'),
      );
      if (status === 'Pending QC' && wasPaid) {
        actions.push({ label: 'ผ่าน QC → ส่ง QC Lab', status: 'Sent to QC Lab', log: 'ผ่าน final QC ส่งเข้า Lab refurb', style: 'bg-emerald-500 text-white' });
        actions.push({ label: 'ผ่าน QC → เก็บ Stock', status: 'In Stock', log: 'ผ่าน final QC เข้า stock พร้อมขาย', style: 'bg-blue-500 text-white' });
        actions.push({ label: 'ขายแล้ว (Sold)', status: 'Sold', log: 'ขายเครื่องนี้ออกแล้ว', style: 'bg-purple-500 text-white', confirm: 'ยืนยันทำเครื่องหมายว่า "ขายแล้ว (Sold)"? ปุ่มนี้ปิดวงจรการขาย' });
      } else {
        actions.push({ label: 'ผ่าน QC → Payout', status: 'Payout Processing', log: 'ผ่านการตรวจสอบ ดำเนินการจ่ายเงิน', style: 'bg-emerald-500 text-white' });
        actions.push({ label: 'ต้องเจรจาราคา (Negotiation)', status: 'Negotiation', log: 'ต้องเจรจาราคากับลูกค้า', style: 'bg-red-500 text-white' });
      }
      break;
    }
    case 'Revised Offer':
    case 'Negotiation':
      actions.push({ label: 'ตกลงราคา → Payout', status: 'Payout Processing', log: 'ลูกค้าตกลงราคา เริ่มจ่ายเงิน', style: 'bg-emerald-500 text-white' });
      break;
    case 'Payout Processing':
      actions.push({ label: 'จ่ายเงินแล้ว (Paid)', status: 'Paid', log: 'โอนเงินให้ลูกค้าเรียบร้อย', style: 'bg-green-600 text-white' });
      break;
    case 'Paid':
    case 'PAID':
    case 'Waiting For Handover':
    case 'Waiting for Handover':
    case 'Rider Returning':
      // Post-payment. Finance parks every B2C payout at "Waiting for Handover"
      // (see TradeInPayouts), so this is the normal paid state for all methods.
      if (isPickup) {
        // Pickup: the device is still with the rider until they hand it over at
        // the branch (→ Pending QC, where the rider fee is computed). Block the
        // QC-lab / stock jump; only offer the handover confirmation, which
        // routes through Pending QC so the rider always gets paid.
        actions.push({ label: 'ยืนยันไรเดอร์ส่งมอบเครื่องแล้ว (รับเข้าสาขา)', status: 'Pending QC', log: 'แอดมินยืนยันรับมอบเครื่องจากไรเดอร์ที่สาขา', style: 'bg-emerald-600 text-white' });
      } else {
        // Store-in / Mail-in: device is already at the branch → send into the
        // QC pipeline or straight to stock.
        actions.push({ label: 'ส่งเข้า QC Lab', status: 'Sent to QC Lab', log: 'รับมอบเครื่องและส่งเข้าห้องแล็บ', style: 'bg-purple-600 text-white' });
        actions.push({ label: 'เข้าสต็อก (In Stock)', status: 'In Stock', log: 'นำเข้าสต็อกเรียบร้อย', style: 'bg-slate-700 text-white' });
      }
      break;
    case 'Sold':
    case 'In Stock':
    case 'Ready to Sell':
    case 'Sent to QC Lab':
      // Post-sale inventory states previously had NO actions at all — a mis-tap
      // on "Sold" (or stock/lab) left the job stuck with no way back. Offer a
      // guarded rewind to the post-payment QC hub (Pending QC). Since this job
      // was already Paid, the Pending QC branch re-offers Lab/Stock/Sold (not a
      // second payout), so no double-pay risk.
      actions.push({ label: 'ย้อนสถานะกลับ → Pending QC', status: 'Pending QC', log: 'แอดมินย้อนสถานะกลับเพื่อแก้กรณีกดผิด', style: 'border border-amber-300 text-amber-700 bg-amber-50', confirm: 'ย้อนสถานะกลับไป Pending QC? ใช้กรณีเผลอกดสถานะผิด' });
      break;
  }

  return actions;
}
