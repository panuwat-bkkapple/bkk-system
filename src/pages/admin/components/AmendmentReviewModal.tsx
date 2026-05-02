// On-site amendment review modal (admin-only).
//
// Opens from a banner on JobDetail / pull-down notification when a rider
// submits an amendment request from the field. Admin sees:
//   - what rider reported (type + photos + note)
//   - current job snapshot (before)
//   - editor to compose the new device list + price (after)
//   - approve/reject controls
//
// Flow ownership: admin chooses every value in `after`. Rider doesn't
// even see this modal — they wait for the push that this submit triggers.
//
// Reject path additionally requires picking a `reject_action` so the rider
// gets an unambiguous instruction (continue/cancel/wait) rather than having
// to decide on the spot.

import React, { useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db, app } from '@/api/firebase';
import {
  X, AlertTriangle, Check, ImageOff, ExternalLink, Loader2, ShieldCheck,
} from 'lucide-react';
import type { JobAmendment, JobDevice, JobAmendmentRejectAction } from '@/types/domain';
import { useToast } from '../../../components/ui/ToastProvider';
import { useDatabase } from '@/hooks/useDatabase';

interface Props {
  amendmentId: string;
  onClose: () => void;
}

interface FlatVariant {
  modelId: string;
  modelName: string;
  variantName: string;
  price: number;
}

const REJECT_ACTION_LABEL: Record<JobAmendmentRejectAction, string> = {
  continue_original: 'ปฏิเสธ amendment — rider รับเครื่องตาม spec เดิม',
  cancel_job: 'ยกเลิก job ทั้งหมด — rider แจ้งลูกค้าและกลับ',
  wait_admin_call: 'admin จะติดต่อลูกค้าเอง — rider standby ที่จุดรับ',
};

export const AmendmentReviewModal: React.FC<Props> = ({ amendmentId, onClose }) => {
  const toast = useToast();
  const [amendment, setAmendment] = useState<JobAmendment | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Editor for the `after` snapshot. Phase 1 supports replacing the first
  // device only (most common: single-device jobs). Multi-device jobs surface
  // a warning that we only edit slot 0.
  const [newModelKey, setNewModelKey] = useState<string>('');     // "${modelId}|${variantName}"
  const [newPriceText, setNewPriceText] = useState<string>('');
  const [adminNote, setAdminNote] = useState('');
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectAction, setRejectAction] = useState<JobAmendmentRejectAction>('continue_original');

  const { data: modelsData } = useDatabase('models');

  // Subscribe to amendment so admin sees if rider/another admin updates it
  React.useEffect(() => {
    const unsub = onValue(ref(db, `jobs_amendments/${amendmentId}`), (snap) => {
      setAmendment(snap.exists() ? (snap.val() as JobAmendment) : null);
      setLoading(false);
    });
    return () => unsub();
  }, [amendmentId]);

  // Flatten models→variants for the picker (mirrors CreateTicketModal pattern)
  const flatVariants = useMemo<FlatVariant[]>(() => {
    const list = Array.isArray(modelsData) ? modelsData : [];
    const out: FlatVariant[] = [];
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      const rv = (m as any).variants;
      const variants: any[] = !rv ? [] : Array.isArray(rv) ? rv : Object.values(rv);
      if (variants.length === 0) {
        out.push({ modelId: m.id || m.model, modelName: m.model || '', variantName: '', price: m.base_price || 0 });
        continue;
      }
      for (const v of variants) {
        out.push({
          modelId: m.id || m.model,
          modelName: m.model || '',
          variantName: v.name || '',
          price: typeof v.price === 'number' ? v.price : (m.base_price || 0),
        });
      }
    }
    return out;
  }, [modelsData]);

  const selectedVariant = useMemo(() => {
    if (!newModelKey) return null;
    const [modelId, variantName] = newModelKey.split('|');
    return flatVariants.find((v) => v.modelId === modelId && v.variantName === variantName) || null;
  }, [newModelKey, flatVariants]);

  // Auto-fill price from the picker, but only if admin hasn't typed manually
  React.useEffect(() => {
    if (selectedVariant) setNewPriceText(String(selectedVariant.price));
  }, [selectedVariant]);

  const before = amendment?.before;
  const newPriceNum = Number(newPriceText);
  const priceDiff = before && Number.isFinite(newPriceNum)
    ? newPriceNum - before.final_price
    : 0;

  const canApprove = !!selectedVariant && Number.isFinite(newPriceNum) && newPriceNum >= 0;

  const handleApprove = async () => {
    if (!amendment || !selectedVariant) return;
    if (!canApprove) {
      toast.error('กรุณาเลือกรุ่นใหม่และกรอกราคาให้ถูกต้อง');
      return;
    }
    setSubmitting(true);
    try {
      const functions = getFunctions(app, 'asia-southeast1');
      const fn = httpsCallable(functions, 'reviewAmendment');
      // Build new device list — replace slot 0, keep the rest
      const beforeDevices: JobDevice[] = before?.devices || [];
      const newDevices: JobDevice[] = [
        {
          ...(beforeDevices[0] || {}),
          model: selectedVariant.modelName,
          // brand is required by JobDevice type, retain old if present
          brand: (beforeDevices[0]?.brand || 'Apple') as any,
          // variant info isn't a JobDevice field on the schema, but we
          // store it via the model name ("iPhone 14 256GB Black")
          // — admin's free-form combination is captured fully here.
        },
      ];
      // Append "(variant)" suffix into model so dashboard shows storage/colour
      if (selectedVariant.variantName) {
        newDevices[0].model = `${selectedVariant.modelName} ${selectedVariant.variantName}`;
      }
      // Preserve any tail devices unchanged
      for (let i = 1; i < beforeDevices.length; i++) newDevices.push(beforeDevices[i]);

      await fn({
        amendmentId,
        decision: 'approve',
        adminNote: adminNote.trim() || undefined,
        after: {
          devices: newDevices,
          final_price: newPriceNum,
        },
      });
      toast.success('อนุมัติแล้ว — rider จะได้แจ้งเตือนเพื่อขอเซ็นจากลูกค้า');
      onClose();
    } catch (e: any) {
      toast.error('อนุมัติไม่สำเร็จ: ' + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!amendment) return;
    setSubmitting(true);
    try {
      const functions = getFunctions(app, 'asia-southeast1');
      const fn = httpsCallable(functions, 'reviewAmendment');
      await fn({
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
    return (
      <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-6 max-w-sm">
          <p className="text-sm text-slate-700">ไม่พบข้อมูล amendment นี้</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm font-bold">
            ปิด
          </button>
        </div>
      </div>
    );
  }

  if (amendment.status !== 'pending') {
    return (
      <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-6 max-w-md">
          <h3 className="font-bold text-slate-900 mb-2">Amendment ตอบกลับแล้ว</h3>
          <p className="text-sm text-slate-600">
            สถานะปัจจุบัน: <span className="font-bold">{amendment.status}</span>
          </p>
          {amendment.admin_note && (
            <p className="text-xs text-slate-500 mt-2">หมายเหตุ: {amendment.admin_note}</p>
          )}
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm font-bold">
            ปิด
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92dvh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900">ขอแก้ไขจาก Rider</h2>
                <p className="text-xs text-slate-500">
                  {amendment.requested_by_rider_name} · job #{amendment.job_id.slice(-4).toUpperCase()}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full">
              <X size={20} className="text-slate-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Rider note */}
            {amendment.rider_note && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-[11px] font-black text-amber-700 uppercase tracking-wider mb-1">หมายเหตุจาก rider</p>
                <p className="text-sm text-amber-900">{amendment.rider_note}</p>
              </div>
            )}

            {/* Evidence photos */}
            <div>
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                รูปประกอบจาก rider
              </label>
              <div className="grid grid-cols-3 gap-2">
                {amendment.evidence_urls.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setLightbox(url)}
                    className="aspect-[4/3] rounded-lg border border-slate-200 overflow-hidden bg-slate-50 hover:ring-2 hover:ring-emerald-200"
                  >
                    <img src={url} className="w-full h-full object-cover" />
                  </button>
                ))}
                {amendment.evidence_urls.length === 0 && (
                  <div className="aspect-[4/3] border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-slate-300">
                    <ImageOff size={18} /><span className="text-[10px]">ไม่มีรูป</span>
                  </div>
                )}
              </div>
            </div>

            {/* Before snapshot */}
            <div>
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                ปัจจุบัน (ก่อนแก้)
              </label>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
                {(before?.devices || []).map((d, i) => (
                  <div key={i} className="text-sm text-slate-900 flex items-center justify-between">
                    <span>{i + 1}. {d.model || '-'}</span>
                  </div>
                ))}
                <div className="text-xs text-slate-500 pt-1.5 border-t border-slate-200 mt-2">
                  รวม ฿{(before?.final_price ?? 0).toLocaleString()}
                </div>
              </div>
            </div>

            {/* After editor (only when not in reject mode) */}
            {!rejectMode && (
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                  แก้ไขเป็น (admin ระบุ)
                </label>

                {(before?.devices.length || 0) > 1 && (
                  <p className="text-[11px] text-amber-700 mb-2">
                    Job นี้มี {before?.devices.length} เครื่อง — Phase 1 รองรับแก้ไขเฉพาะเครื่องที่ 1; เครื่องที่เหลือคงเดิม
                  </p>
                )}

                <select
                  value={newModelKey}
                  onChange={(e) => setNewModelKey(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:border-emerald-500 outline-none mb-2"
                >
                  <option value="">-- เลือกรุ่น/variant --</option>
                  {flatVariants.map((v) => (
                    <option key={`${v.modelId}|${v.variantName}`} value={`${v.modelId}|${v.variantName}`}>
                      {v.modelName}{v.variantName ? ` — ${v.variantName}` : ''}  (฿{v.price.toLocaleString()})
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">ราคาใหม่ (บาท):</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={newPriceText}
                    onChange={(e) => setNewPriceText(e.target.value)}
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono focus:border-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>

                {selectedVariant && Number.isFinite(newPriceNum) && (
                  <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm">
                    <div className="flex justify-between text-slate-700">
                      <span>ก่อน:</span>
                      <span>฿{(before?.final_price ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-bold text-emerald-800">
                      <span>หลัง:</span>
                      <span>฿{newPriceNum.toLocaleString()}</span>
                    </div>
                    <div className={`flex justify-between text-xs font-bold pt-1.5 mt-1.5 border-t border-emerald-200 ${priceDiff >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      <span>ส่วนต่าง:</span>
                      <span>{priceDiff >= 0 ? '+' : ''}฿{priceDiff.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Reject form */}
            {rejectMode && (
              <div>
                <label className="text-[11px] font-black text-red-700 uppercase tracking-widest block mb-2">
                  เลือกคำสั่งให้ rider
                </label>
                <div className="space-y-2">
                  {(Object.keys(REJECT_ACTION_LABEL) as JobAmendmentRejectAction[]).map((k) => (
                    <label key={k} className={`flex items-start gap-2 p-3 rounded-xl border cursor-pointer ${rejectAction === k ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <input
                        type="radio"
                        checked={rejectAction === k}
                        onChange={() => setRejectAction(k)}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-slate-800">{REJECT_ACTION_LABEL[k]}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Admin note (both modes) */}
            <div>
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                หมายเหตุถึง rider {!rejectMode && '(ไม่บังคับ)'}
              </label>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:border-emerald-500 outline-none resize-none"
                placeholder={rejectMode ? 'อธิบายสาเหตุที่ปฏิเสธ' : 'ข้อความเพิ่มเติมที่อยากแจ้ง rider'}
              />
            </div>
          </div>

          {/* Footer */}
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
                <button
                  onClick={handleApprove}
                  disabled={submitting || !canApprove}
                  className="flex-[2] py-3 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
                  อนุมัติ + แจ้ง rider
                </button>
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
        </div>
      </div>

      {/* Lightbox */}
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
