// Admin's review modal for v2 unified amendment workflow.
//
// Handles all 8 amendment types via a discriminated sub-form. Two
// architectural classes:
//
//   contractual (device_mismatch / add_device / remove_device)
//     → admin composes `after` snapshot (devices + price); approve sends
//       to rider for customer signature; consent → atomic apply
//
//   operational (appointment / address / customer_info / cancel / other)
//     → admin reviews target hint from rider, edits if needed; approve =
//       atomic apply immediately (no consent step). Skipped consent is
//       enforced server-side too.
//
// Reject is the same across all types: choose action, optional note,
// rider gets a plain-Thai instruction with no decision required.
//
// Schema synced via @/types/domain — JobAmendment, AmendmentTarget union.

import React, { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app } from '@/api/firebase';
import {
  X, AlertTriangle, Check, ImageOff, ExternalLink, Loader2, ShieldCheck,
  Calendar, MapPin, User, Phone, Mail, Ban, MessageSquare, Smartphone, Plus,
} from 'lucide-react';
import type {
  JobAmendment, AmendmentDevice, JobAmendmentRejectAction, AmendmentClass,
} from '@/types/domain';
import { CANCEL_CATEGORY_LABEL_TH, type CancelCategory } from '@/types/job-statuses';
import { useToast } from '../../../components/ui/ToastProvider';
import { useDatabase } from '@/hooks/useDatabase';

interface Props {
  amendmentId: string;
  onClose: () => void;
}

interface FlatVariant {
  modelId: string;
  modelName: string;
  variantId: string;
  variantName: string;
  price: number;
  brand: string;
}

const REJECT_ACTION_LABEL: Record<JobAmendmentRejectAction, string> = {
  continue_original: 'ปฏิเสธ amendment — rider รับเครื่อง/ทำงานตาม spec เดิม',
  cancel_job: 'ยกเลิก job ทั้งหมด — rider แจ้งลูกค้าและกลับ',
  wait_admin_call: 'admin จะติดต่อลูกค้าเอง — rider standby ที่จุดรับ',
};

export const AmendmentReviewModal: React.FC<Props> = ({ amendmentId, onClose }) => {
  const toast = useToast();
  const [amendment, setAmendment] = useState<JobAmendment | null>(null);
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectAction, setRejectAction] = useState<JobAmendmentRejectAction>('continue_original');
  const [adminNote, setAdminNote] = useState('');

  const { data: modelsData } = useDatabase('models');

  // Subscribe to amendment + job
  useEffect(() => {
    const unsubA = onValue(ref(db, `jobs_amendments/${amendmentId}`), (snap) => {
      setAmendment(snap.exists() ? (snap.val() as JobAmendment) : null);
      setLoading(false);
    });
    return () => unsubA();
  }, [amendmentId]);
  useEffect(() => {
    if (!amendment?.job_id) return;
    const unsubJ = onValue(ref(db, `jobs/${amendment.job_id}`), (snap) => {
      setJob(snap.exists() ? snap.val() : null);
    });
    return () => unsubJ();
  }, [amendment?.job_id]);

  const flatVariants = useMemo<FlatVariant[]>(() => {
    const list = Array.isArray(modelsData) ? modelsData : [];
    const out: FlatVariant[] = [];
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const rv = (m as any).variants;
      const variants: any[] = !rv ? [] : Array.isArray(rv) ? rv : Object.values(rv);
      // Schema field on /models/{id} is `name` (display name like
      // "iPhone 16"). The legacy `m.model` reference returns undefined
      // on live data so picker rendered empty labels. Same bug fix
      // applied in bkk-rider-app's useFlatVariants.
      const modelId = m.id || m.name || m.model;
      const modelName = m.name || m.model || '';
      const brand = m.brand || 'Apple';
      const basePrice = (typeof m.baseUsedPrice === 'number' ? m.baseUsedPrice :
                         typeof m.baseNewPrice === 'number' ? m.baseNewPrice :
                         typeof m.base_price === 'number' ? m.base_price : 0);
      if (variants.length === 0) {
        out.push({ modelId, modelName, variantId: '', variantName: '', price: basePrice, brand });
        continue;
      }
      for (const v of variants) {
        // PriceEditor modifier mode writes `usedPrice` + `newPrice`
        // separately. For trade-in (the only operation here) we want
        // usedPrice — that's the buy-back price. Fall back through
        // legacy `price` and `newPrice` for back-compat.
        const variantPrice =
          typeof v.usedPrice === 'number' ? v.usedPrice :
          typeof v.price === 'number' ? v.price :
          typeof v.newPrice === 'number' ? v.newPrice :
          basePrice;
        out.push({
          modelId,
          modelName,
          variantId: v.id || v.name,
          variantName: v.name || '',
          price: variantPrice,
          brand,
        });
      }
    }
    return out;
  }, [modelsData]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 flex items-center gap-3">
          <Loader2 className="animate-spin text-blue-600" size={20} /> โหลดข้อมูล...
        </div>
      </div>
    );
  }
  if (!amendment) {
    return <CloseShell onClose={onClose} message="ไม่พบข้อมูล amendment นี้" />;
  }
  if (amendment.status !== 'pending') {
    return (
      <CloseShell
        onClose={onClose}
        message={`Amendment ตอบกลับแล้ว (สถานะ: ${amendment.status})`}
        note={amendment.admin_note}
      />
    );
  }

  const fnReview = httpsCallable(getFunctions(app, 'asia-southeast1'), 'reviewAmendment');

  const handleReject = async () => {
    setSubmitting(true);
    try {
      await fnReview({
        amendmentId,
        decision: 'reject',
        rejectAction,
        adminNote: adminNote.trim() || undefined,
      });
      toast.success('ส่งคำสั่งปฏิเสธให้ rider แล้ว');
      onClose();
    } catch (e: any) {
      toast.error('ปฏิเสธไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const cls: AmendmentClass = amendment.amendment_class || 'contractual';

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92dvh] flex flex-col">
          <Header amendment={amendment} onClose={onClose} />

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <CommonInfo
              amendment={amendment}
              onLightbox={setLightbox}
            />

            {!rejectMode ? (
              <ApprovePanel
                amendment={amendment}
                job={job}
                flatVariants={flatVariants}
                onSubmitting={setSubmitting}
                submitting={submitting}
                onClose={onClose}
                adminNote={adminNote}
                onAdminNote={setAdminNote}
              />
            ) : (
              <RejectPanel
                rejectAction={rejectAction}
                onRejectAction={setRejectAction}
                adminNote={adminNote}
                onAdminNote={setAdminNote}
              />
            )}
          </div>

          <div className="p-4 border-t border-slate-100 shrink-0 flex gap-2">
            {!rejectMode ? (
              <>
                <button
                  onClick={() => setRejectMode(true)}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl text-sm font-bold border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-40"
                >
                  ปฏิเสธ
                </button>
                {/* Approve button moved into ApprovePanel since logic is type-specific */}
              </>
            ) : (
              <>
                <button
                  onClick={() => setRejectMode(false)}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  ย้อนกลับ
                </button>
                <button
                  onClick={handleReject}
                  disabled={submitting}
                  className="flex-[2] py-3 rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                  ส่งคำสั่งปฏิเสธ
                </button>
              </>
            )}
          </div>
          {/* Hint about flow */}
          <div className="px-4 pb-4 text-[11px] text-slate-400 text-center">
            {cls === 'contractual'
              ? 'อนุมัติ → rider ขอลายเซ็นลูกค้า → atomic apply'
              : 'อนุมัติ → atomic apply ทันที (ไม่ต้องเซ็น)'}
          </div>
        </div>
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[300] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img src={lightbox} className="max-w-full max-h-full object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
          <a
            href={lightbox}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 right-4 bg-white text-slate-900 px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-lg"
          >
            <ExternalLink size={12} /> เปิดในแท็บใหม่
          </a>
        </div>
      )}
    </>
  );
};

// ─── Header ─────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, React.ComponentType<any>> = {
  device_mismatch: Smartphone, add_device: Plus, remove_device: Smartphone,
  appointment_reschedule: Calendar, address_wrong: MapPin,
  customer_info_wrong: User, customer_request_cancel: Ban, other: MessageSquare,
};
const TYPE_LABEL: Record<string, string> = {
  device_mismatch: 'เครื่องไม่ตรง', add_device: 'เพิ่มเครื่อง',
  remove_device: 'ลด/ยกเลิกเครื่อง', appointment_reschedule: 'เลื่อนนัด',
  address_wrong: 'ที่อยู่ผิด', customer_info_wrong: 'ข้อมูลลูกค้าผิด',
  customer_request_cancel: 'ลูกค้าขอยกเลิก', other: 'อื่นๆ',
};

const Header: React.FC<{ amendment: JobAmendment; onClose: () => void }> = ({ amendment, onClose }) => {
  const Icon = TYPE_ICON[amendment.type] || AlertTriangle;
  const cls = amendment.amendment_class || 'contractual';
  return (
    <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${cls === 'contractual' ? 'bg-amber-100' : 'bg-blue-100'}`}>
          <Icon size={20} className={cls === 'contractual' ? 'text-amber-600' : 'text-blue-600'} />
        </div>
        <div>
          <h2 className="font-bold text-slate-900">{TYPE_LABEL[amendment.type] || amendment.type}</h2>
          <p className="text-xs text-slate-500">
            {amendment.requested_by_rider_name} · job #{amendment.job_id.slice(-4).toUpperCase()}
            {' · '}
            <span className={cls === 'contractual' ? 'text-amber-700' : 'text-blue-700'}>{cls}</span>
          </p>
        </div>
      </div>
      <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
        <X size={20} className="text-slate-400" />
      </button>
    </div>
  );
};

// ─── Common info (rider note + evidence) ─────────────────────────────

const CommonInfo: React.FC<{
  amendment: JobAmendment;
  onLightbox: (url: string) => void;
}> = ({ amendment, onLightbox }) => {
  const evidenceUrls = (amendment.evidence?.map((e) => e.url) || amendment.evidence_urls || []);
  return (
    <>
      {amendment.rider_note && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-[11px] font-black text-amber-700 uppercase tracking-wider mb-1">หมายเหตุจาก rider</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{amendment.rider_note}</p>
        </div>
      )}

      {evidenceUrls.length > 0 && (
        <div>
          <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">
            รูปประกอบจาก rider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {evidenceUrls.map((url, i) => (
              <button
                key={i}
                onClick={() => onLightbox(url)}
                className="aspect-[4/3] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 hover:ring-2 hover:ring-emerald-200"
              >
                <img src={url} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

// ─── Approve panel (type-aware sub-form) ─────────────────────────────

const ApprovePanel: React.FC<{
  amendment: JobAmendment;
  job: any;
  flatVariants: FlatVariant[];
  submitting: boolean;
  onSubmitting: (b: boolean) => void;
  onClose: () => void;
  adminNote: string;
  onAdminNote: (s: string) => void;
}> = ({ amendment, job, flatVariants, submitting, onSubmitting, onClose, adminNote, onAdminNote }) => {
  const toast = useToast();
  const fnReview = httpsCallable(getFunctions(app, 'asia-southeast1'), 'reviewAmendment');

  // Type-specific local state
  // 3-level cascading picker for device types (brand → model → variant).
  // Flat dropdown didn't scale with our catalog size; cascading + natural
  // sort keeps browsing fast. Mirror of bkk-rider-app implementation.
  const [pickBrand, setPickBrand] = useState<string>('');
  const [pickModelId, setPickModelId] = useState<string>('');
  const [pickVariantId, setPickVariantId] = useState<string>('');
  const [newPriceText, setNewPriceText] = useState<string>('');
  const [newAppointmentTime, setNewAppointmentTime] = useState<string>(''); // datetime-local string
  const [newAddress, setNewAddress] = useState<string>('');
  const [custInfoField, setCustInfoField] = useState<'cust_name' | 'cust_phone' | 'cust_email'>('cust_phone');
  const [custInfoValue, setCustInfoValue] = useState<string>('');
  const [cancelCategory, setCancelCategory] = useState<CancelCategory>('customer_changed_mind');
  const [cancelDetail, setCancelDetail] = useState<string>('');

  // Reset cascading state when parent changes
  useEffect(() => { setPickModelId(''); setPickVariantId(''); }, [pickBrand]);
  useEffect(() => { setPickVariantId(''); }, [pickModelId]);

  const naturalCompare = (a: string, b: string) =>
    (a || '').localeCompare(b || '', 'en', { numeric: true, sensitivity: 'base' });

  const brandOptions = useMemo(
    () => Array.from(new Set(flatVariants.map((v) => v.brand).filter(Boolean))).sort(naturalCompare),
    [flatVariants],
  );
  const modelOptions = useMemo(() => {
    if (!pickBrand) return [];
    const seen = new Map<string, { id: string; name: string }>();
    for (const v of flatVariants) {
      if (v.brand !== pickBrand) continue;
      if (!v.modelId || seen.has(v.modelId)) continue;
      seen.set(v.modelId, { id: v.modelId, name: v.modelName });
    }
    return Array.from(seen.values()).sort((a, b) => naturalCompare(a.name, b.name));
  }, [flatVariants, pickBrand]);
  const variantOptions = useMemo(() => {
    if (!pickModelId) return [];
    return flatVariants
      .filter((v) => v.modelId === pickModelId)
      .sort((a, b) => naturalCompare(a.variantName, b.variantName));
  }, [flatVariants, pickModelId]);

  // Pre-populate from rider's target hint, if any
  useEffect(() => {
    if (!amendment.target) return;
    const t = amendment.target as any;
    if (t.kind === 'appointment' && typeof t.new_appointment_time === 'number') {
      const d = new Date(t.new_appointment_time);
      const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      setNewAppointmentTime(localISO);
    } else if (t.kind === 'address') {
      setNewAddress(t.new_address || '');
    } else if (t.kind === 'customer_info') {
      setCustInfoField(t.field);
      setCustInfoValue(t.new_value || '');
    } else if (t.kind === 'cancel') {
      setCancelCategory(t.reason_category as CancelCategory);
      setCancelDetail(t.reason_detail || '');
    } else if (t.kind === 'device_pick' && typeof t.model_id === 'string') {
      // Rider already identified the device — decompose into the 3
      // cascading levels so picker shows the same selection. brand
      // resolved from flatVariants since rider may not have sent it.
      const match = flatVariants.find((v) => v.modelId === t.model_id);
      if (match) {
        setPickBrand(match.brand);
        // Defer model + variant set until brand-effect fires (it
        // resets them); use a microtask to reapply.
        Promise.resolve().then(() => {
          setPickModelId(t.model_id);
          if (t.variant_id) {
            Promise.resolve().then(() => setPickVariantId(t.variant_id));
          }
        });
      }
      if (typeof t.suggested_price === 'number') {
        setNewPriceText(String(t.suggested_price));
      }
    }
  }, [amendment.target, flatVariants]);

  const selectedVariant = useMemo(() => {
    if (!pickModelId) return null;
    return flatVariants.find((v) => v.modelId === pickModelId && v.variantId === pickVariantId)
      || (variantOptions.length === 1 && !variantOptions[0].variantId ? variantOptions[0] : null);
  }, [pickModelId, pickVariantId, flatVariants, variantOptions]);

  useEffect(() => {
    if (selectedVariant) setNewPriceText(String(selectedVariant.price));
  }, [selectedVariant]);

  const before = amendment.before;
  const newPriceNum = Number(newPriceText);

  const handleApprove = async (afterPayload: any, targetPayload: any) => {
    onSubmitting(true);
    try {
      await fnReview({
        amendmentId: amendment.id,
        decision: 'approve',
        ...(afterPayload ? { after: afterPayload } : {}),
        ...(targetPayload ? { target: targetPayload } : {}),
        adminNote: adminNote.trim() || undefined,
      });
      toast.success(amendment.amendment_class === 'contractual'
        ? 'อนุมัติแล้ว — rider จะให้ลูกค้าเซ็น'
        : 'อนุมัติแล้ว — apply เรียบร้อย');
      onClose();
    } catch (e: any) {
      toast.error('อนุมัติไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      onSubmitting(false);
    }
  };

  // ─── Sub-forms per type ──────────────────────────────────────────

  if (amendment.type === 'device_mismatch' || amendment.type === 'add_device') {
    const isAdd = amendment.type === 'add_device';
    const beforeDevices: AmendmentDevice[] = (before?.devices || []) as any;
    const newDevice: AmendmentDevice | null = selectedVariant ? {
      model: `${selectedVariant.modelName}${selectedVariant.variantName ? ' ' + selectedVariant.variantName : ''}`,
      brand: selectedVariant.brand as any,
      model_id: selectedVariant.modelId,
      variant_id: selectedVariant.variantId || undefined,
      model_name: selectedVariant.modelName,
      variant_name: selectedVariant.variantName || undefined,
      unit_price: newPriceNum || selectedVariant.price,
    } : null;

    const proposedDevices = newDevice
      ? (isAdd
          ? [...beforeDevices, newDevice]
          : [newDevice, ...beforeDevices.slice(1)])
      : beforeDevices;
    const proposedFinal = (newDevice && isAdd)
      ? (before?.final_price || 0) + (newDevice.unit_price || 0)
      : (newDevice && !isAdd)
        ? (before?.final_price || 0) - ((beforeDevices[0]?.unit_price as number) || 0) + (newDevice.unit_price || 0)
        : (before?.final_price || 0);

    return (
      <>
        <BeforeSection before={before} />
        <SubForm title={isAdd ? 'เครื่องที่จะเพิ่ม' : 'แก้ไขเป็นรุ่นใหม่'}>
          {!isAdd && beforeDevices.length > 1 && (
            <p className="text-[11px] text-amber-700 mb-2">
              Job มี {beforeDevices.length} เครื่อง — แก้เครื่องที่ 1 (ตัวอื่นคงเดิม)
            </p>
          )}
          <div className="space-y-2 mb-2">
            <select
              value={pickBrand}
              onChange={(e) => setPickBrand(e.target.value)}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:border-emerald-500 outline-none"
            >
              <option value="">— ยี่ห้อ —</option>
              {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={pickModelId}
              onChange={(e) => setPickModelId(e.target.value)}
              disabled={!pickBrand}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:border-emerald-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">— รุ่น —</option>
              {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select
              value={pickVariantId}
              onChange={(e) => setPickVariantId(e.target.value)}
              disabled={!pickModelId || variantOptions.length === 0}
              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:border-emerald-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">— ความจุ / variant —</option>
              {variantOptions.map((v) => (
                <option key={v.variantId || '_'} value={v.variantId}>
                  {v.variantName || '(ไม่มี variant)'} {' — ฿'}{v.price.toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-slate-500">ราคาเครื่องนี้ (บาท):</span>
            <input
              type="number"
              inputMode="numeric"
              value={newPriceText}
              onChange={(e) => setNewPriceText(e.target.value)}
              className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono"
            />
          </div>
        </SubForm>

        {newDevice && (
          <PriceDelta beforeFinal={before?.final_price || 0} afterFinal={proposedFinal} />
        )}

        <AdminNote value={adminNote} onChange={onAdminNote} />

        <ApproveButton
          disabled={submitting || !newDevice || !Number.isFinite(newPriceNum) || newPriceNum < 0}
          onClick={() => handleApprove({ devices: proposedDevices, final_price: proposedFinal }, null)}
          submitting={submitting}
          label={`อนุมัติ + แจ้ง rider (฿${proposedFinal.toLocaleString()})`}
        />
      </>
    );
  }

  if (amendment.type === 'remove_device') {
    const idx = amendment.target_device_index ?? 0;
    const beforeDevices: AmendmentDevice[] = (before?.devices || []) as any;
    const removed = beforeDevices[idx];
    const proposedDevices = beforeDevices.filter((_, i) => i !== idx);
    const proposedFinal = (before?.final_price || 0) - ((removed?.unit_price as number) || 0);

    return (
      <>
        <BeforeSection before={before} highlightIdx={idx} />
        <SubForm title={`เครื่องที่จะลบ (slot #${idx + 1})`}>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
            <p className="font-bold text-red-900">{removed?.model || '?'}</p>
            <p className="text-xs text-red-700">ราคา ฿{(removed?.unit_price as number)?.toLocaleString() || '-'}</p>
          </div>
        </SubForm>
        <PriceDelta beforeFinal={before?.final_price || 0} afterFinal={proposedFinal} />
        <AdminNote value={adminNote} onChange={onAdminNote} />
        <ApproveButton
          disabled={submitting || !removed}
          onClick={() => handleApprove({ devices: proposedDevices, final_price: proposedFinal }, null)}
          submitting={submitting}
          label="อนุมัติ + แจ้ง rider"
        />
      </>
    );
  }

  if (amendment.type === 'appointment_reschedule') {
    const ts = newAppointmentTime ? new Date(newAppointmentTime).getTime() : 0;
    const currentTs = job?.appointment_time;
    return (
      <>
        <SubForm title="วัน/เวลานัดปัจจุบัน">
          <p className="text-sm text-slate-600">
            {currentTs ? new Date(currentTs).toLocaleString('th-TH') : '— ยังไม่ได้นัด —'}
          </p>
        </SubForm>
        <SubForm title="แก้เป็น">
          <input
            type="datetime-local"
            value={newAppointmentTime}
            onChange={(e) => setNewAppointmentTime(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
          />
        </SubForm>
        <AdminNote value={adminNote} onChange={onAdminNote} />
        <ApproveButton
          disabled={submitting || !ts}
          onClick={() => handleApprove(null, { kind: 'appointment', new_appointment_time: ts })}
          submitting={submitting}
          label="อนุมัติ + apply (เลื่อนนัด)"
        />
      </>
    );
  }

  if (amendment.type === 'address_wrong') {
    return (
      <>
        <SubForm title="ที่อยู่ปัจจุบัน">
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{job?.cust_address || '-'}</p>
        </SubForm>
        <SubForm title="แก้เป็น">
          <textarea
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm resize-none"
            placeholder="ที่อยู่ใหม่ที่ลูกค้าแจ้ง"
          />
        </SubForm>
        <AdminNote value={adminNote} onChange={onAdminNote} />
        <ApproveButton
          disabled={submitting || newAddress.trim().length < 5}
          onClick={() => handleApprove(null, { kind: 'address', new_address: newAddress.trim() })}
          submitting={submitting}
          label="อนุมัติ + apply (แก้ที่อยู่)"
        />
      </>
    );
  }

  if (amendment.type === 'customer_info_wrong') {
    return (
      <>
        <SubForm title="ฟิลด์ที่จะแก้">
          <select
            value={custInfoField}
            onChange={(e) => setCustInfoField(e.target.value as any)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
          >
            <option value="cust_name">ชื่อ</option>
            <option value="cust_phone">เบอร์โทร</option>
            <option value="cust_email">อีเมล</option>
          </select>
        </SubForm>
        <SubForm title="ค่าปัจจุบัน">
          <p className="text-sm text-slate-600">{job?.[custInfoField] || '-'}</p>
        </SubForm>
        <SubForm title="แก้เป็น">
          <input
            type="text"
            value={custInfoValue}
            onChange={(e) => setCustInfoValue(e.target.value)}
            maxLength={500}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
          />
        </SubForm>
        <AdminNote value={adminNote} onChange={onAdminNote} />
        <ApproveButton
          disabled={submitting || custInfoValue.trim().length < 1}
          onClick={() => handleApprove(null, { kind: 'customer_info', field: custInfoField, new_value: custInfoValue.trim() })}
          submitting={submitting}
          label="อนุมัติ + apply (แก้ข้อมูลลูกค้า)"
        />
      </>
    );
  }

  if (amendment.type === 'customer_request_cancel') {
    return (
      <>
        <SubForm title="หมวดหมู่การยกเลิก">
          <select
            value={cancelCategory}
            onChange={(e) => setCancelCategory(e.target.value as CancelCategory)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
          >
            {Object.entries(CANCEL_CATEGORY_LABEL_TH).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </SubForm>
        <SubForm title="รายละเอียดเพิ่มเติม (ไม่บังคับ)">
          <textarea
            value={cancelDetail}
            onChange={(e) => setCancelDetail(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm resize-none"
          />
        </SubForm>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-900">
          <p className="font-bold mb-1">⚠️ การกด "อนุมัติ" จะ:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>เปลี่ยน status job เป็น <strong>Cancelled</strong></li>
            <li>บันทึก cancel_category + reason</li>
            <li>แจ้ง rider ผ่าน push</li>
          </ul>
        </div>
        <AdminNote value={adminNote} onChange={onAdminNote} />
        <ApproveButton
          disabled={submitting}
          onClick={() => handleApprove(null, {
            kind: 'cancel',
            reason_category: cancelCategory,
            reason_detail: cancelDetail.trim() || undefined,
          })}
          submitting={submitting}
          label="อนุมัติ + ยกเลิก job"
          danger
        />
      </>
    );
  }

  if (amendment.type === 'other') {
    return (
      <>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900">
          <p className="font-bold mb-1">📞 หมวด "อื่นๆ" — admin โทรคุยเอง</p>
          <p className="text-xs leading-relaxed">
            ระบบไม่มี atomic apply สำหรับเคสนี้ — admin ใช้ chat คุยกับลูกค้าและประสานงานกับ rider เอง.
            กดอนุมัติเมื่อจัดการเสร็จเพื่อปลด rider จากสถานะ "รอ admin"
          </p>
        </div>
        <AdminNote value={adminNote} onChange={onAdminNote} placeholder="สรุปการจัดการ (ส่งให้ rider เห็นใน push)" />
        <ApproveButton
          disabled={submitting}
          onClick={() => handleApprove(null, null)}
          submitting={submitting}
          label="อนุมัติ + แจ้ง rider ว่าจัดการแล้ว"
        />
      </>
    );
  }

  return <p className="text-sm text-slate-500">type ไม่รองรับ: {amendment.type}</p>;
};

// ─── Reject panel ────────────────────────────────────────────────────

const RejectPanel: React.FC<{
  rejectAction: JobAmendmentRejectAction;
  onRejectAction: (a: JobAmendmentRejectAction) => void;
  adminNote: string;
  onAdminNote: (s: string) => void;
}> = ({ rejectAction, onRejectAction, adminNote, onAdminNote }) => (
  <div>
    <label className="text-[11px] font-black text-red-700 uppercase tracking-widest block mb-2">
      เลือกคำสั่งให้ rider
    </label>
    <div className="space-y-2">
      {(Object.keys(REJECT_ACTION_LABEL) as JobAmendmentRejectAction[]).map((k) => (
        <label key={k} className={`flex items-start gap-2 p-3 rounded-xl border cursor-pointer ${rejectAction === k ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
          <input type="radio" checked={rejectAction === k} onChange={() => onRejectAction(k)} className="mt-0.5" />
          <span className="text-sm text-slate-800">{REJECT_ACTION_LABEL[k]}</span>
        </label>
      ))}
    </div>
    <div className="mt-3">
      <AdminNote value={adminNote} onChange={onAdminNote} placeholder="อธิบายสาเหตุที่ปฏิเสธ" />
    </div>
  </div>
);

// ─── Sub-form helpers ────────────────────────────────────────────────

const SubForm: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">
      {title}
    </label>
    {children}
  </div>
);

const BeforeSection: React.FC<{ before?: any; highlightIdx?: number }> = ({ before, highlightIdx }) => (
  <SubForm title="ปัจจุบัน (ก่อนแก้)">
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
      {(before?.devices || []).map((d: AmendmentDevice, i: number) => (
        <div key={i} className={`text-sm flex items-center justify-between rounded px-2 py-1 ${i === highlightIdx ? 'bg-red-100 text-red-900' : 'text-slate-900'}`}>
          <span>{i + 1}. {d.model || '-'}</span>
          {d.unit_price != null && <span className="font-mono text-xs">฿{Number(d.unit_price).toLocaleString()}</span>}
        </div>
      ))}
      <div className="text-xs text-slate-500 pt-1.5 border-t border-slate-200 mt-2">
        รวม ฿{(before?.final_price ?? 0).toLocaleString()}
      </div>
    </div>
  </SubForm>
);

const PriceDelta: React.FC<{ beforeFinal: number; afterFinal: number }> = ({ beforeFinal, afterFinal }) => {
  const diff = afterFinal - beforeFinal;
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm">
      <div className="flex justify-between text-slate-700">
        <span>ก่อน:</span><span>฿{beforeFinal.toLocaleString()}</span>
      </div>
      <div className="flex justify-between font-bold text-emerald-800">
        <span>หลัง:</span><span>฿{afterFinal.toLocaleString()}</span>
      </div>
      <div className={`flex justify-between text-xs font-bold pt-1.5 mt-1.5 border-t border-emerald-200 ${diff >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
        <span>ส่วนต่าง:</span><span>{diff >= 0 ? '+' : ''}฿{diff.toLocaleString()}</span>
      </div>
    </div>
  );
};

const AdminNote: React.FC<{ value: string; onChange: (s: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => (
  <SubForm title="หมายเหตุถึง rider (ไม่บังคับ)">
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      maxLength={1000}
      placeholder={placeholder || 'ข้อความเพิ่มเติมที่อยากแจ้ง rider'}
      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm resize-none"
    />
  </SubForm>
);

const ApproveButton: React.FC<{
  disabled: boolean; onClick: () => void; submitting: boolean; label: string; danger?: boolean;
}> = ({ disabled, onClick, submitting, label, danger }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full py-3 rounded-xl text-sm font-bold text-white active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2 ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
  >
    {submitting ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
    {label}
  </button>
);

const CloseShell: React.FC<{ onClose: () => void; message: string; note?: string }> = ({ onClose, message, note }) => (
  <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl p-6 max-w-md">
      <h3 className="font-bold text-slate-900 mb-2">{message}</h3>
      {note && <p className="text-xs text-slate-500 mt-2">หมายเหตุ: {note}</p>}
      <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm font-bold">ปิด</button>
    </div>
  </div>
);
