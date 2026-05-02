// On-job-detail banner that surfaces any open amendment for the job.
//
// - "pending" → red call-to-action; admin clicks to open AmendmentReviewModal
// - "approved" → blue waiting-for-customer indicator (no action; rider's UI
//   holds the consent flow)
// - other terminal statuses don't render — flow is over.
//
// Subscribes to /jobs_amendments filtered by job_id and picks the most-
// recent open one. Multiple amendments per job aren't allowed by the
// requestAmendment guard, but we still render the latest if data drift
// ever produces more than one.

import React, { useEffect, useState } from 'react';
import { ref, onValue, query, orderByChild, equalTo } from 'firebase/database';
import { db } from '@/api/firebase';
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import type { JobAmendment } from '@/types/domain';
import { AmendmentReviewModal } from './AmendmentReviewModal';

interface Props {
  jobId: string;
}

export const AmendmentBanner: React.FC<Props> = ({ jobId }) => {
  const [openAmendment, setOpenAmendment] = useState<JobAmendment | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    // Query by job_id; index .indexOn=["status","job_id","requested_at"]
    const q = query(ref(db, 'jobs_amendments'), orderByChild('job_id'), equalTo(jobId));
    const unsub = onValue(q, (snap) => {
      let candidate: JobAmendment | null = null;
      snap.forEach((s) => {
        const am = s.val() as JobAmendment;
        // Show banner only for in-flight states. terminal: applied/rejected/cancelled
        if (am.status !== 'pending' && am.status !== 'approved' && am.status !== 'consented') return;
        if (!candidate || am.requested_at > candidate.requested_at) candidate = am;
      });
      setOpenAmendment(candidate);
    });
    return () => unsub();
  }, [jobId]);

  if (!openAmendment) return null;

  if (openAmendment.status === 'pending') {
    const stale = openAmendment.escalated_at != null;
    return (
      <>
        <div className={`rounded-2xl border p-4 mb-4 ${stale ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className={stale ? 'text-red-600 mt-0.5' : 'text-amber-600 mt-0.5'} />
            <div className="flex-1 min-w-0">
              <p className={`font-bold ${stale ? 'text-red-900' : 'text-amber-900'}`}>
                {stale ? 'Rider รออนุมัตินานเกิน 15 นาที' : 'Rider ขอแก้ไข — รอ admin อนุมัติ'}
              </p>
              <p className={`text-xs mt-0.5 ${stale ? 'text-red-700' : 'text-amber-700'}`}>
                {openAmendment.requested_by_rider_name} · {openAmendment.rider_note || 'ดูรายละเอียดในหน้า review'}
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
            amendmentId={openAmendment.id}
            onClose={() => setReviewing(false)}
          />
        )}
      </>
    );
  }

  if (openAmendment.status === 'approved') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
        <Clock size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-bold text-blue-900">รอลูกค้าเซ็นยืนยัน amendment</p>
          <p className="text-xs text-blue-700 mt-0.5">
            อนุมัติโดย {openAmendment.reviewed_by_admin_name} · ราคาใหม่ ฿{openAmendment.after?.final_price.toLocaleString() || '?'}
          </p>
        </div>
      </div>
    );
  }

  if (openAmendment.status === 'consented') {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
        <ShieldCheck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-bold text-emerald-900">ลูกค้าเซ็นแล้ว — กำลัง apply</p>
        </div>
      </div>
    );
  }

  return null;
};
