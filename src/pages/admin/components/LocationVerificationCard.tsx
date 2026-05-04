// src/pages/admin/components/LocationVerificationCard.tsx
//
// Cross-checks customer-typed pickup address against the silent
// browser-geolocation captured at checkout time. Helps admin spot:
//   - Different country / province (likely fraud)
//   - Customer registering from work but pickup at home (commute,
//     usually OK but worth noting before dispatching rider)
//
// Concepts kept distinct (do not conflate):
//   - cust_address          : typed pickup/shipping address
//   - cust_id_address       : ID card address from KYC (different concept)
//   - cust_lat/lng          : pickup pin dragged on map (Pickup only)
//   - registration_lat/lng  : browser geolocation at checkout
//   - cust_address_geocoded : Google Geocoding result for typed address

import React from 'react';
import { MapPin, Navigation, Smartphone, AlertTriangle, CheckCircle2, Info, ExternalLink } from 'lucide-react';
import type { Job } from '@/types/domain';

interface Props {
  job: Job;
}

const FLAG_CONFIG: Record<NonNullable<Job['location_flag']>, {
  label: string;
  bg: string;
  border: string;
  text: string;
  Icon: typeof CheckCircle2;
}> = {
  green: { label: 'ตรงกัน', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', Icon: CheckCircle2 },
  yellow: { label: 'ใกล้เคียง', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', Icon: Info },
  orange: { label: 'ตรวจสอบเพิ่ม', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', Icon: AlertTriangle },
  red: { label: 'ผิดปกติ', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', Icon: AlertTriangle },
};

function formatTimestamp(ts: number | undefined | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export const LocationVerificationCard: React.FC<Props> = ({ job }) => {
  const hasRegistration = typeof job.registration_lat === 'number' && typeof job.registration_lng === 'number';
  const hasGeocode = typeof job.cust_address_geocoded_lat === 'number' && typeof job.cust_address_geocoded_lng === 'number';
  const hasPin = typeof job.cust_lat === 'number' && typeof job.cust_lng === 'number';

  // Skip rendering if there's truly nothing to show — keeps the detail
  // page tidy on legacy tickets created before this feature.
  if (!hasRegistration && !hasGeocode && !hasPin) return null;

  const flag = job.location_flag;
  const flagCfg = flag ? FLAG_CONFIG[flag] : null;
  const distance = job.registration_pickup_distance_km;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <MapPin size={20} className="text-blue-600" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">พิกัดยืนยันตัวตน</h3>
            <p className="text-xs text-slate-500">ตรวจสอบว่าลูกค้าลงทะเบียนจากที่ใด vs ที่อยู่ที่กรอก</p>
          </div>
        </div>
        {flagCfg && distance != null && (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-black uppercase tracking-wider ${flagCfg.bg} ${flagCfg.border} ${flagCfg.text}`}>
            <flagCfg.Icon size={12} />
            {flagCfg.label} · {distance} km
          </span>
        )}
      </div>

      {/* === Typed pickup/contact address === */}
      <div>
        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
          <Navigation size={11} /> ที่อยู่ที่ลูกค้ากรอก
          <span className="text-[10px] text-slate-400 normal-case font-medium">(สำหรับนัดรับ/นัดส่ง)</span>
        </label>
        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
          {job.cust_address || '—'}
        </div>
        {hasGeocode && (
          <p className="mt-2 text-[11px] text-slate-500">
            Geocode →{' '}
            <span className="font-mono">{job.cust_address_geocoded_lat!.toFixed(4)}, {job.cust_address_geocoded_lng!.toFixed(4)}</span>
            {job.cust_address_geocoded_status === 'partial' && (
              <span className="ml-1.5 text-amber-600 font-medium">(จับคู่บางส่วน)</span>
            )}
            {job.cust_address_geocoded_status === 'failed' && (
              <span className="ml-1.5 text-red-600 font-medium">(หาไม่เจอ)</span>
            )}
          </p>
        )}
      </div>

      {/* === Pickup pin (Pickup only) === */}
      {hasPin && (
        <div>
          <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
            <MapPin size={11} /> Pin ที่ลูกค้าปัก
            <span className="text-[10px] text-slate-400 normal-case font-medium">(จุดที่ไรเดอร์ใช้นำทาง)</span>
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono tracking-wide text-slate-900">
              {job.cust_lat!.toFixed(6)}, {job.cust_lng!.toFixed(6)}
            </div>
            <a
              href={`https://www.google.com/maps?q=${job.cust_lat},${job.cust_lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={12} /> Maps
            </a>
          </div>
        </div>
      )}

      {/* === Browser geolocation at registration === */}
      <div>
        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
          <Smartphone size={11} /> พิกัดตอนลงทะเบียน
          <span className="text-[10px] text-slate-400 normal-case font-medium">(browser, opt-in)</span>
        </label>
        {hasRegistration ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono tracking-wide text-slate-900">
                {job.registration_lat!.toFixed(6)}, {job.registration_lng!.toFixed(6)}
              </div>
              <a
                href={`https://www.google.com/maps?q=${job.registration_lat},${job.registration_lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink size={12} /> Maps
              </a>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              ความแม่นยำ ~{Math.round(job.registration_accuracy || 0)} m · บันทึกเมื่อ {formatTimestamp(job.registration_captured_at)}
            </p>
          </>
        ) : (
          <p className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 italic">
            ลูกค้าไม่อนุญาตให้เข้าถึงพิกัด — ใช้ที่อยู่ที่กรอกเป็นหลัก
          </p>
        )}
      </div>

      {/* === Mismatch interpretation === */}
      {flag === 'orange' || flag === 'red' ? (
        <div className={`flex gap-2 items-start p-3 rounded-xl border ${flagCfg!.bg} ${flagCfg!.border}`}>
          <flagCfg!.Icon size={14} className={`${flagCfg!.text} mt-0.5 shrink-0`} />
          <p className={`text-xs ${flagCfg!.text} leading-relaxed`}>
            พิกัดที่ลูกค้าลงทะเบียนห่างจากที่อยู่ที่กรอกถึง <strong>{distance} กม.</strong>
            {flag === 'red' && ' — น่าจะคนละประเทศหรือผิดปกติ ตรวจสอบตัวตนเพิ่มเติมก่อนดำเนินการ'}
            {flag === 'orange' && ' — ต่างจังหวัด อาจเป็นการเดินทางมาทำธุระ ตรวจสอบให้แน่ใจก่อนส่งไรเดอร์'}
          </p>
        </div>
      ) : null}
    </div>
  );
};
