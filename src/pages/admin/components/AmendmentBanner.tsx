// On-job-detail banner that surfaces any open v2 amendment for the job.
//
// States:
//   pending    → red CTA, admin clicks to open AmendmentReviewModal
//   approved (contractual) → blue waiting-for-customer-consent indicator
//   approved (operational) → impossible (server applies immediately)
//   consented  → emerald "applying" indicator (transient)
//   rejected   → grey indicator with admin's chosen action
//   expired    → grey "ลูกค้าไม่ได้เซ็นใน 24 ชม." indicator
//   applied/cancelled → terminal, no banner
//
// Subscribes via .indexOn=["job_id"] on /jobs_amendments.

import React, { useEffect, useState } from 'react';
import { ref, onValue, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '@/api/firebase';
import {
  AlertTriangle, Clock, ShieldCheck, Ban,
} from 'lucide-react';
import type { JobAmendment, AmendmentClass } from '@/types/domain';
import { AmendmentReviewModal } from './AmendmentReviewModal';

interface Props { jobId: string; }

const TYPE_LABEL_TH: Record<string, string> = {
  device_mismatch: 'เครื่องไม่ตรง',
  add_device: 'เพิ่มเครื่อง',
  remove_device: 'ลด/ยกเลิกเครื่อง',
  appointment_reschedule: 'เลื่อนนัด',
  address_wrong: 'ที่อยู่ผิด',
  customer_info_wrong: 'ข้อมูลลูกค้าผิด',
  customer_request_cancel: 'ลูกค้าขอยกเลิก',
  other: 'อื่นๆ',
};

export const AmendmentBanner: React.FC<Props> = ({ jobId }) => {
  const [open, setOpen] = useState<JobAmendment | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const q = query(ref(db, 'jobs_amendments'), orderByChild('job_id'), equalTo(jobId));
    const unsub = onValue(q, (snap) => {
      let candidate: JobAmendment | null = null;
      snap.forEach((s) => {
        const am = s.val() as JobAmendment;
        // Show recent in-flight + recent terminal-with-info (rejected/expired)
        if (am.status === 'applied' || am.status === 'cancelled') return;
        if (!candidate || am.requested_at > candidate.requested_at) candidate = am;
      });
      setOpen(candidate);
    });
    return () => unsub();
  }, [jobId]);

  if (!open) return null;
  const cls: AmendmentClass = open.amendment_class || 'contractual';
  const typeLabel = TYPE_LABEL_TH[open.type] || open.type;

  if (open.status === 'pending') {
    const stale = open.escalated_at != null;
    return (
      <>
        <div className={`rounded-2xl border p-4 mb-4 ${stale ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className={stale ? 'text-red-600 mt-0.5' : 'text-amber-600 mt-0.5'} />
            <div className="flex-1 min-w-0">
              <p className={`font-bold ${stale ? 'text-red-900' : 'text-amber-900'}`}>
                {stale ? `Rider รออนุมัตินานเกิน 15 นาที — ${typeLabel}` : `Rider ขอแก้ไข — ${typeLabel}`}
              </p>
              <p className={`text-xs mt-0.5 ${stale ? 'text-red-700' : 'text-amber-700'}`}>
                {open.requested_by_rider_name} · {open.rider_note || '(ไม่มีหมายเหตุ)'}
              </p>
            </div>
            <button
              onClick={() => setReviewing(true)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold text-white ${stale ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'}`}
            >
              เปิดดู
            </button>
          </div>
        </div>
        {reviewing && (
          <AmendmentReviewModal
            amendmentId={open.id}
            onClose={() => setReviewing(false)}
          />
        )}
      </>
    );
  }

  if (open.status === 'approved') {
    if (cls === 'contractual') {
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <Clock size={18} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-bold text-blue-900">รอลูกค้าเซ็นยืนยัน — {typeLabel}</p>
            <p className="text-xs text-blue-700 mt-0.5">
              อนุมัติโดย {open.reviewed_by_admin_name}
              {open.after?.final_price != null && ` · ราคาใหม่ ฿${open.after.final_price.toLocaleString()}`}
              {open.approved_expires_at && ` · หมดอายุ ${new Date(open.approved_expires_at).toLocaleString('th-TH')}`}
            </p>
          </div>
        </div>
      );
    }
    // Operational shouldn't be in 'approved' (server applies immediately)
    return null;
  }

  if (open.status === 'rejected') {
    return (
      <div className="bg-slate-100 border border-slate-300 rounded-2xl p-4 mb-4 flex items-start gap-3">
        <Ban size={18} className="text-slate-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-bold text-slate-700">ปฏิเสธแล้ว — {typeLabel}</p>
          <p className="text-xs text-slate-600 mt-0.5">
            โดย {open.reviewed_by_admin_name} · คำสั่ง: {open.reject_action || '-'}
          </p>
          {open.admin_note && <p className="text-xs text-slate-500 mt-1 italic">"{open.admin_note}"</p>}
        </div>
      </div>
    );
  }

  if (open.status === 'consented') {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
        <ShieldCheck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-bold text-emerald-900">ลูกค้าเซ็นแล้ว — กำลัง apply</p>
        </div>
      </div>
    );
  }

  if (open.status === 'expired') {
    return (
      <div className="bg-slate-100 border border-slate-300 rounded-2xl p-4 mb-4 flex items-start gap-3">
        <Clock size={18} className="text-slate-500 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-bold text-slate-700">หมดอายุ — {typeLabel}</p>
          <p className="text-xs text-slate-600 mt-0.5">
            ลูกค้าไม่ได้เซ็นภายใน 24 ชม. — rider ต้องขอใหม่หากยังต้องการแก้
          </p>
        </div>
      </div>
    );
  }

  return null;
};
