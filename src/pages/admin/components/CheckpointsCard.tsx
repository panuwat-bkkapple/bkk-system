// CheckpointsCard — admin-side view of rider check-in timeline for a job.
//
// Reads /jobs/{id}/checkpoints/{stage} (written by the rider PWA in
// Phase 1A) and renders the 5-stage timeline with timestamps, distances
// to target, and a clickable Maps link per stage so admin can verify
// where the rider actually checked in.

import React from 'react';
import { MapPin, ExternalLink, AlertTriangle, Clock } from 'lucide-react';

type Stage = 'rider_accepted' | 'rider_en_route' | 'rider_arrived' | 'customer_left' | 'branch_handover';

interface Checkpoint {
  at?: number;
  rider_id?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  distance_m?: number;
  is_within_zone?: boolean;
  zone_m?: number;
  target?: { lat: number; lng: number; label: string };
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

function mapsUrl(cp: Checkpoint): string | null {
  if (cp.lat == null || cp.lng == null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${cp.lat},${cp.lng}`;
}

interface Props {
  job: {
    checkpoints?: Partial<Record<Stage, Checkpoint>>;
  };
}

export const CheckpointsCard: React.FC<Props> = ({ job }) => {
  const checkpoints = job.checkpoints;
  const hasAny = checkpoints && Object.keys(checkpoints).some((k) => checkpoints[k as Stage]);

  if (!hasAny) {
    return (
      <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-200">
        <h3 className="text-lg font-black mb-2 flex items-center gap-2 text-slate-800">
          <MapPin size={20} className="text-emerald-600" />
          ไรเดอร์เช็คอิน
        </h3>
        <p className="text-sm text-slate-400 font-medium">
          ยังไม่มีข้อมูล check-in — งานนี้อาจยังไม่ถึงขั้น rider, หรือเป็นงานเก่าก่อนระบบ check-in
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-200">
      <h3 className="text-lg font-black mb-4 flex items-center gap-2 text-slate-800">
        <MapPin size={20} className="text-emerald-600" />
        ไรเดอร์เช็คอิน
      </h3>
      <div className="space-y-3">
        {STAGE_ORDER.map((stage, idx) => {
          const cp = checkpoints?.[stage];
          if (!cp) return null;
          const url = mapsUrl(cp);
          const isLast = idx === STAGE_ORDER.length - 1 || !STAGE_ORDER.slice(idx + 1).some((s) => checkpoints?.[s]);

          return (
            <div key={stage} className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className={`w-3 h-3 rounded-full ${cp.is_within_zone === false ? 'bg-rose-500' : 'bg-emerald-500'} ring-2 ring-white shadow`} />
                {!isLast && <div className="w-0.5 flex-1 bg-slate-200 mt-1" style={{ minHeight: 28 }} />}
              </div>

              <div className="flex-1 pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-black text-sm text-slate-800">{STAGE_LABEL[stage]}</div>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                    >
                      เปิดบนแผนที่ <ExternalLink size={11} />
                    </a>
                  )}
                </div>

                <div className="text-xs text-slate-500 font-medium mt-0.5 flex items-center gap-1.5">
                  <Clock size={11} className="text-slate-400" />
                  {formatDateTime(cp.at)}
                  {cp.accuracy != null && (
                    <span className="text-[10px] text-slate-400">· ±{Math.round(cp.accuracy)} ม.</span>
                  )}
                </div>

                {cp.distance_m != null && cp.target && (
                  <div className={`text-xs font-bold mt-1 flex items-center gap-1.5 ${cp.is_within_zone === false ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {cp.is_within_zone === false && <AlertTriangle size={11} />}
                    {cp.distance_m} ม. จาก{cp.target.label}
                    {cp.is_within_zone === false && cp.zone_m != null && (
                      <span className="text-[10px] bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-full border border-rose-200">
                        นอกโซน {cp.zone_m} ม.
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
