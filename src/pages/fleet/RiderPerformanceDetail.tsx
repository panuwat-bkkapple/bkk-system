// Per-rider drill-down (Phase 1C).
//
// Click a row in /rider-performance → land here. Shows the full job
// history of one rider with check-in timestamps from /jobs/{id}/checkpoints.
// Each job is collapsed to its essentials by default; click to expand
// the full checkpoint timeline.
//
// Lean by design — no map view yet (Phase 1D if we need it).

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  ArrowLeft, Bike, Loader2, MapPin, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, AlertTriangle, Phone, Mail, ExternalLink,
} from 'lucide-react';

interface Rider {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  photo?: string;
  approval_status?: string;
  score?: number;
  zone?: string;
}

type Stage = 'rider_accepted' | 'rider_en_route' | 'rider_arrived' | 'customer_left' | 'branch_handover';

interface Checkpoint {
  at: number;
  rider_id?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  distance_m?: number;
  is_within_zone?: boolean;
  zone_m?: number;
  target?: { lat: number; lng: number; label: string };
}

interface Job {
  id: string;
  rider_id?: string | null;
  status?: string;
  cancelled_by?: string;
  cancel_category?: string;
  cancel_reason?: string;
  cust_name?: string;
  cust_phone?: string;
  cust_address?: string;
  ref_no?: string;
  created_at?: number;
  completed_at?: number;
  cancelled_at?: number;
  checkpoints?: Partial<Record<Stage, Checkpoint>>;
}

const STAGE_ORDER: Stage[] = ['rider_accepted', 'rider_en_route', 'rider_arrived', 'customer_left', 'branch_handover'];

const STAGE_LABEL: Record<Stage, string> = {
  rider_accepted: 'รับงาน',
  rider_en_route: 'ออกเดินทาง',
  rider_arrived: 'ถึงลูกค้า',
  customer_left: 'ออกจากลูกค้า',
  branch_handover: 'ส่งมอบสาขา',
};

function formatDateTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function jobOutcome(job: Job, riderId: string): { label: string; color: string; icon: React.ReactNode } {
  if (job.cancelled_by === `rider:${riderId}`) {
    return { label: 'ไรเดอร์ปฏิเสธ/ยกเลิก', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: <AlertTriangle size={14} /> };
  }
  if (job.status === 'Cancelled' && job.cancel_category === 'customer_request_cancel') {
    return { label: 'ลูกค้ายกเลิก', color: 'text-rose-600 bg-rose-50 border-rose-200', icon: <XCircle size={14} /> };
  }
  if (['Paid', 'Payment Completed', 'Sent To QC Lab', 'Ready To Sell', 'Sold', 'In Stock', 'Completed'].includes(job.status || '')) {
    return { label: 'สำเร็จ', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={14} /> };
  }
  return { label: job.status || 'ไม่ทราบ', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: <Clock size={14} /> };
}

export const RiderPerformanceDetail: React.FC = () => {
  const { riderId } = useParams<{ riderId: string }>();
  const [rider, setRider] = useState<Rider | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  useEffect(() => {
    if (!riderId) return;
    const unsubRider = onValue(ref(db, `riders/${riderId}`), (snap) => {
      if (snap.exists()) {
        const r = snap.val();
        setRider({
          id: riderId,
          name: r.name || r.fullName || r.full_name || 'ไม่ระบุชื่อ',
          phone: r.phone,
          email: r.email,
          photo: r.photo || r.photo_url,
          approval_status: r.approval_status || r.status,
          score: r.score,
          zone: r.zone,
        });
      }
    });

    const unsubJobs = onValue(ref(db, 'jobs'), (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        const list: Job[] = Object.entries(data)
          .map(([id, j]: [string, any]) => ({ id, ...j }))
          .filter((j) => j.rider_id === riderId || j.cancelled_by === `rider:${riderId}`)
          .sort((a, b) => {
            const ta = a.completed_at || a.cancelled_at || a.created_at || 0;
            const tb = b.completed_at || b.cancelled_at || b.created_at || 0;
            return tb - ta;
          });
        setJobs(list);
      }
      setLoading(false);
    });

    return () => { unsubRider(); unsubJobs(); };
  }, [riderId]);

  const summary = useMemo(() => {
    const s = { completed: 0, customerCancelled: 0, riderCancelled: 0, active: 0, totalArrivalDist: 0, arrivalSamples: 0, outsideZone: 0 };
    if (!riderId) return s;
    for (const job of jobs) {
      const out = jobOutcome(job, riderId);
      if (out.label === 'สำเร็จ') s.completed += 1;
      else if (out.label === 'ลูกค้ายกเลิก') s.customerCancelled += 1;
      else if (out.label === 'ไรเดอร์ปฏิเสธ/ยกเลิก') s.riderCancelled += 1;
      else s.active += 1;

      const arrived = job.checkpoints?.rider_arrived;
      if (arrived?.distance_m != null) {
        s.totalArrivalDist += arrived.distance_m;
        s.arrivalSamples += 1;
        if (arrived.is_within_zone === false) s.outsideZone += 1;
      }
    }
    return s;
  }, [jobs, riderId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  if (!rider) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Link to="/rider-performance" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={16} /> กลับ
        </Link>
        <div className="text-center p-12 bg-white rounded-2xl border border-slate-100">
          <p className="text-slate-500 font-bold">ไม่พบไรเดอร์ ID นี้</p>
        </div>
      </div>
    );
  }

  const completionRate = summary.completed + summary.customerCancelled > 0
    ? summary.completed / (summary.completed + summary.customerCancelled)
    : null;
  const avgDist = summary.arrivalSamples > 0 ? Math.round(summary.totalArrivalDist / summary.arrivalSamples) : null;

  return (
    <div className="p-6 max-w-6xl mx-auto font-sans text-slate-800 animate-in fade-in">
      <Link to="/rider-performance" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 mb-4 font-bold">
        <ArrowLeft size={16} /> Rider Performance
      </Link>

      {/* Rider header */}
      <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm mb-6 flex items-center gap-5">
        {rider.photo ? (
          <img src={rider.photo} alt="" className="w-20 h-20 rounded-full object-cover" />
        ) : (
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center text-2xl font-black text-emerald-700">
            {rider.name?.charAt(0) || 'R'}
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-black flex items-center gap-2 mb-1">
            <Bike size={20} className="text-emerald-600" /> {rider.name}
          </h1>
          <div className="flex items-center gap-4 text-xs text-slate-500 font-medium">
            {rider.phone && <span className="flex items-center gap-1"><Phone size={12} /> {rider.phone}</span>}
            {rider.email && <span className="flex items-center gap-1"><Mail size={12} /> {rider.email}</span>}
            {rider.zone && <span className="bg-slate-100 px-2 py-0.5 rounded-full">โซน: {rider.zone}</span>}
            {rider.score != null && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black">คะแนน {rider.score}</span>}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <SummaryStat label="งานสำเร็จ" value={summary.completed} color="emerald" />
        <SummaryStat label="ลูกค้ายกเลิก" value={summary.customerCancelled} color="rose" />
        <SummaryStat label="ไรเดอร์ยกเลิก" value={summary.riderCancelled} color="amber" />
        <SummaryStat label="กำลังทำ" value={summary.active} color="blue" />
        <SummaryStat label="อัตราสำเร็จ" value={completionRate == null ? '—' : `${Math.round(completionRate * 100)}%`} color="emerald" />
      </div>

      {avgDist != null && (
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="text-slate-500" size={20} />
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">ความแม่นยำการมาถึง (ค่าเฉลี่ย)</div>
              <div className="text-2xl font-black text-slate-800">{avgDist} ม. <span className="text-xs text-slate-400">จาก {summary.arrivalSamples} ครั้ง</span></div>
            </div>
          </div>
          {summary.outsideZone > 0 && (
            <div className="bg-rose-100 text-rose-700 px-3 py-1.5 rounded-full text-xs font-black">
              นอกโซน {summary.outsideZone} ครั้ง
            </div>
          )}
        </div>
      )}

      {/* Jobs list */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="text-lg font-black">ประวัติงาน <span className="text-sm text-slate-400 font-medium">({jobs.length} งาน)</span></h2>
        </div>

        {jobs.length === 0 ? (
          <div className="text-center p-12 text-slate-400 font-bold">ยังไม่มีประวัติงาน</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const outcome = jobOutcome(job, rider.id);
              const isExpanded = expandedJob === job.id;
              const ts = job.completed_at || job.cancelled_at || job.created_at;

              return (
                <div key={job.id} className="p-5 hover:bg-slate-50/50 transition-colors">
                  <button
                    onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                    className="w-full text-left flex items-center gap-4"
                  >
                    {isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-slate-800">{job.ref_no || `#${job.id.slice(-6).toUpperCase()}`}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-black flex items-center gap-1 ${outcome.color}`}>
                          {outcome.icon} {outcome.label}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-medium truncate">
                        {job.cust_name || 'ไม่ระบุชื่อ'} · {job.cust_address || 'ไม่ระบุที่อยู่'}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 font-bold whitespace-nowrap">{formatDateTime(ts)}</div>
                  </button>

                  {isExpanded && (
                    <div className="mt-4 pl-7">
                      {job.cancel_reason && (
                        <div className="mb-4 bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-800">
                          <strong>เหตุผลยกเลิก:</strong> {job.cancel_reason}
                        </div>
                      )}
                      <CheckpointTimeline checkpoints={job.checkpoints} />
                      <div className="mt-3">
                        <Link
                          to={`/workspace/${job.id}`}
                          className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          ดูงานเต็ม →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const CheckpointTimeline: React.FC<{ checkpoints?: Partial<Record<Stage, Checkpoint>> }> = ({ checkpoints }) => {
  if (!checkpoints || Object.keys(checkpoints).length === 0) {
    return <p className="text-xs text-slate-400 font-medium">ไม่มี check-in data — งานนี้อาจเก่ากว่า Phase 1A</p>;
  }
  return (
    <div className="space-y-2">
      {STAGE_ORDER.map((stage) => {
        const cp = checkpoints[stage];
        if (!cp) return null;
        const url = cp.lat != null && cp.lng != null
          ? `https://www.google.com/maps/search/?api=1&query=${cp.lat},${cp.lng}`
          : null;
        const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
          url ? (
            <a href={url} target="_blank" rel="noreferrer noopener" className="flex items-start gap-3 text-xs group hover:bg-slate-50 -mx-2 px-2 py-1 rounded-lg transition-colors">{children}</a>
          ) : (
            <div className="flex items-start gap-3 text-xs">{children}</div>
          );

        return (
          <Wrapper key={stage}>
            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${cp.is_within_zone === false ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            <div className="flex-1 min-w-0">
              <div className="font-black text-slate-700 flex items-center gap-1.5">
                {STAGE_LABEL[stage]}
                {url && <ExternalLink size={10} className="text-slate-400 group-hover:text-blue-600 transition-colors" />}
              </div>
              <div className="text-slate-500 font-medium">
                {formatDateTime(cp.at)}
                {cp.distance_m != null && (
                  <span className={`ml-2 font-black ${cp.is_within_zone ? 'text-emerald-600' : 'text-rose-600'}`}>
                    · {cp.distance_m} ม. จาก{cp.target?.label || 'เป้าหมาย'}
                    {cp.is_within_zone === false && ` (เกิน ${cp.zone_m} ม.)`}
                  </span>
                )}
              </div>
            </div>
          </Wrapper>
        );
      })}
    </div>
  );
};

const SummaryStat: React.FC<{ label: string; value: string | number; color: string }> = ({ label, value, color }) => {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-700 bg-emerald-50',
    rose: 'text-rose-700 bg-rose-50',
    amber: 'text-amber-700 bg-amber-50',
    blue: 'text-blue-700 bg-blue-50',
  };
  return (
    <div className={`rounded-2xl p-4 border border-slate-100 ${colorMap[color] || 'bg-slate-50'}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
    </div>
  );
};

export default RiderPerformanceDetail;
