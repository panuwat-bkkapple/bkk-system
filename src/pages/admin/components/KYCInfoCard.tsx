import React, { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import {
  ShieldCheck, AlertTriangle, IdCard, MapPin, Smartphone, User, PencilLine,
  ImageOff, Eye, EyeOff, Copy, Check, ExternalLink, Clock, Calendar, CalendarX,
} from 'lucide-react';
import { db } from '@/api/firebase';
import type { Job, KYCRecord } from '@/types/domain';
import { KYC_AMLO_THRESHOLD, KYC_FALLBACK_REASON_LABEL_TH } from '@/types/domain';
import { useToast } from '../../../components/ui/ToastProvider';

interface KYCInfoCardProps {
  job: Job;
}

// Format 1234567890123 → 1-2345-67890-12-3 (Thai NID display style)
function formatThaiNid(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length !== 13) return raw || '';
  return `${d.slice(0, 1)}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
}

function maskNid(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length !== 13) return raw || '—';
  return `${d.slice(0, 1)}-XXXX-XXXXX-${d.slice(10, 12)}-${d.slice(12)}`;
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// Thai/English month name → 1-12. Mirrors the parser in
// bkk-frontend-next/functions/src/vision/parsers/idCard.ts so any string
// the OCR pipeline emits round-trips correctly here. Update both maps
// together when adding/removing month aliases.
const MONTH_NAME_TO_NUM: Record<string, number> = {
  // Thai full
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
  // Thai abbrev
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
  // English full + abbrev (keys lowercased; matched case-insensitively)
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Best-effort parse of a Thai card date string. Cards print DD/MM/YYYY in
 * either พ.ศ. (e.g. "15/08/2570") or ค.ศ. ("15/08/2027"), but Vision OCR
 * also returns the Thai/English month variants the card prints alongside
 * the numeric form ("15 ก.ค. 2570" / "15 Jul. 2027"). Returns a Date in
 * Gregorian terms, or null if the string isn't recognisable.
 * Heuristic: year >= 2400 → treat as พ.ศ. and subtract 543.
 */
function parseCardDate(s: string | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  // Try Thai/English month-name format first (most common on cards).
  const named = trimmed.match(/(\d{1,2})\s+([A-Za-z฀-๿.]+?)\s+(\d{2,4})/);
  if (named) {
    const lookup = MONTH_NAME_TO_NUM[named[2]] ?? MONTH_NAME_TO_NUM[named[2].toLowerCase()];
    if (lookup) {
      day = Number(named[1]);
      month = lookup;
      year = Number(named[3]);
    }
  }

  // Fall back to all-numeric DD/MM/YYYY.
  if (day === null) {
    const numeric = trimmed.match(/(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{2,4})/);
    if (numeric) {
      day = Number(numeric[1]);
      month = Number(numeric[2]);
      year = Number(numeric[3]);
    }
  }

  if (day === null || month === null || year === null) return null;
  if (year < 100) year += 2500; // 2-digit fallback — cards usually print 4
  if (year >= 2400) year -= 543;
  if (!day || !month || month > 12 || day > 31) return null;
  if (year < 1900 || year > 2100) return null; // sanity bound — reject parser noise
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? null : d;
}

function isExpired(s: string | undefined): boolean {
  const d = parseCardDate(s);
  if (!d) return false;
  // Compare on calendar date (ignore time-of-day)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

export const KYCInfoCard: React.FC<KYCInfoCardProps> = ({ job }) => {
  const toast = useToast();
  const [showFullNid, setShowFullNid] = useState(false);
  const [copiedNid, setCopiedNid] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Loaded from /jobs_kyc/{jobId} — separate node from /jobs/{id} so RTDB
  // read rules can lock down access (admin + assigned rider only) instead
  // of inheriting the public-by-jobId rule used for customer tracking.
  const [kyc, setKyc] = useState<KYCRecord | null>(null);
  const [kycLoading, setKycLoading] = useState(true);

  useEffect(() => {
    if (!job.id) return;
    setKycLoading(true);
    const unsubscribe = onValue(ref(db, `jobs_kyc/${job.id}`), (snap) => {
      setKyc(snap.exists() ? (snap.val() as KYCRecord) : null);
      setKycLoading(false);
    }, (error) => {
      console.error('[KYCInfoCard] read error:', error);
      setKyc(null);
      setKycLoading(false);
    });
    return () => unsubscribe();
  }, [job.id]);

  const netPayout = Number((job as any).net_payout ?? job.final_price ?? job.price ?? 0);
  const amloApplies = netPayout >= KYC_AMLO_THRESHOLD;
  const isPickup = (job.receive_method || '').toLowerCase() === 'pickup';

  const handleCopyNid = async () => {
    if (!kyc?.id_number) return;
    try {
      await navigator.clipboard.writeText(kyc.id_number);
      setCopiedNid(true);
      setTimeout(() => setCopiedNid(false), 1500);
    } catch {
      toast.error('คัดลอกไม่สำเร็จ');
    }
  };

  // ── Loading state ────────────────────────────────────────────────────
  if (kycLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <ShieldCheck size={20} className="text-slate-400 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">ยืนยันตัวตนลูกค้า (KYC)</h3>
            <p className="text-xs text-slate-400">กำลังโหลด...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────
  if (!kyc) {
    const expectedSoon = isPickup && ['Rider Arrived', 'Arrived', 'Being Inspected', 'QC Review'].includes(job.status);
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <ShieldCheck size={20} className="text-slate-400" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">ยืนยันตัวตนลูกค้า (KYC)</h3>
            <p className="text-xs text-slate-500">ไรเดอร์ยังไม่ได้บันทึก KYC สำหรับงานนี้</p>
          </div>
        </div>
        {expectedSoon && (
          <div className="flex gap-2 items-start bg-amber-50 border border-amber-200 rounded-xl p-3">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 leading-relaxed">
              งานนี้อยู่ในสถานะที่ควรมี KYC แล้ว — ตรวจสอบกับไรเดอร์/แอป rider ว่าบันทึกข้อมูลครบหรือไม่
            </p>
          </div>
        )}
        {!isPickup && (
          <p className="text-xs text-slate-400">
            งาน {job.receive_method} จะบันทึก KYC ที่สาขา/ตอนเปิดพัสดุ ไม่ผ่านไรเดอร์
          </p>
        )}
      </div>
    );
  }

  // ── Has KYC ────────────────────────────────────────────────────────
  const isFallback = kyc.method === 'typed_fallback';

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isFallback ? 'bg-amber-100' : 'bg-emerald-100'}`}>
              <ShieldCheck size={20} className={isFallback ? 'text-amber-600' : 'text-emerald-600'} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">ยืนยันตัวตนลูกค้า (KYC)</h3>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                <Clock size={11} /> บันทึกเมื่อ {formatTimestamp(kyc.verified_at)} โดย {kyc.verified_by_rider_name}
              </p>
            </div>
          </div>
          <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md border ${
            isFallback
              ? 'text-amber-700 bg-amber-50 border-amber-200'
              : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}>
            {isFallback ? 'Fallback' : 'Photo Verified'}
          </span>
        </div>

        {/* Fallback warning banner */}
        {isFallback && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 items-start">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900 leading-relaxed space-y-1">
              <p className="font-bold">เคสนี้ลูกค้าไม่มีบัตรประชาชนขณะรับเครื่อง — ต้องการการตรวจสอบเพิ่มเติม</p>
              <p>
                เหตุผล: <span className="font-medium">{KYC_FALLBACK_REASON_LABEL_TH[kyc.fallback_reason || 'other']}</span>
                {kyc.fallback_detail && <> — {kyc.fallback_detail}</>}
              </p>
            </div>
          </div>
        )}

        {/* AMLO note */}
        {amloApplies && !isFallback && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2 items-start">
            <ShieldCheck size={14} className="text-blue-600 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-800 leading-relaxed">
              ออเดอร์ ≥ 50,000 ฿ — ครอบคลุม CDD ของ ปปง. (ภาพลูกค้าถือบัตรเก็บแล้ว)
            </p>
          </div>
        )}

        {/* ID number */}
        <div>
          <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
            <IdCard size={11} /> เลขบัตรประชาชน 13 หลัก
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-sm tracking-wide text-slate-900">
              {showFullNid ? formatThaiNid(kyc.id_number) : maskNid(kyc.id_number)}
            </div>
            <button
              onClick={() => setShowFullNid((v) => !v)}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"
              title={showFullNid ? 'ซ่อน' : 'แสดงเต็ม'}
            >
              {showFullNid ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={handleCopyNid}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"
              title="คัดลอก"
            >
              {copiedNid ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Optional ID-card fields auto-filled by Vision OCR. Render only
            when at least one is present so legacy KYC records (pre-OCR)
            don't show empty blocks. */}
        {(kyc.id_name || kyc.id_dob || kyc.id_issued_at || kyc.id_expires_at) && (
          <div>
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
              <User size={11} /> ข้อมูลตามบัตรประชาชน
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {kyc.id_name && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">ชื่อ-นามสกุล</p>
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900">
                    {kyc.id_name}
                  </div>
                </div>
              )}
              {kyc.id_dob && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Calendar size={9} />วันเกิด</p>
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-900">
                    {kyc.id_dob}
                  </div>
                </div>
              )}
              {kyc.id_issued_at && (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">วันออกบัตร</p>
                  <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-900">
                    {kyc.id_issued_at}
                  </div>
                </div>
              )}
              {kyc.id_expires_at && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">วันบัตรหมดอายุ</p>
                  <div className={`px-3 py-2 border rounded-lg text-sm font-mono flex items-center justify-between ${
                    isExpired(kyc.id_expires_at)
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}>
                    <span>{kyc.id_expires_at}</span>
                    {isExpired(kyc.id_expires_at) && (
                      <span className="text-[10px] font-bold text-red-600 flex items-center gap-1">
                        <CalendarX size={11} /> หมดอายุแล้ว
                      </span>
                    )}
                  </div>
                  {isExpired(kyc.id_expires_at) && (
                    <p className="mt-1.5 text-[11px] text-red-700 flex items-start gap-1">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      <span>บัตรประชาชนหมดอายุแล้ว — ตรวจสอบกับลูกค้าและพิจารณาขอเอกสารใหม่ก่อนอนุมัติ</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ID address — compare against pre-filled if exists */}
        <div>
          <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
            <MapPin size={11} /> ที่อยู่ตามบัตรประชาชน
          </label>
          <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
            {kyc.id_address || '—'}
          </div>
          {job.cust_id_address && job.cust_id_address.trim() !== kyc.id_address.trim() && (
            <p className="mt-1.5 text-[11px] text-amber-700 flex items-start gap-1">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>ลูกค้ากรอกล่วงหน้าใน checkout ต่างจากที่ rider บันทึก: <em>"{job.cust_id_address}"</em></span>
            </p>
          )}
        </div>

        {/* Photos grid */}
        <div>
          <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
            หลักฐานภาพถ่าย
          </label>
          <div className="grid grid-cols-2 gap-2">
            <PhotoTile label="บัตรประชาชน" icon={IdCard} url={kyc.id_card_url} onOpen={setLightboxUrl} />
            <PhotoTile label="บัตร + เครื่อง (IMEI/Serial)" icon={Smartphone} url={kyc.id_with_device_url} onOpen={setLightboxUrl} />
            {amloApplies && (
              <PhotoTile label="ลูกค้าถือบัตร (AMLO)" icon={User} url={kyc.holder_url} onOpen={setLightboxUrl} />
            )}
            {isFallback && (
              <PhotoTile label="ลายเซ็นลูกค้า" icon={PencilLine} url={kyc.signature_url} onOpen={setLightboxUrl} />
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
        >
          <img
            src={lightboxUrl}
            alt="KYC evidence"
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={lightboxUrl}
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

// ─────────────────────────────────────────────────────────────────────
// Photo tile — clickable thumbnail; falls back to a placeholder when
// the URL is missing (e.g. AMLO photo on a Standard < 50K job).
// ─────────────────────────────────────────────────────────────────────
interface PhotoTileProps {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  url?: string | null;
  onOpen: (url: string) => void;
}

const PhotoTile: React.FC<PhotoTileProps> = ({ label, icon: Icon, url, onOpen }) => {
  if (!url) {
    return (
      <div className="aspect-[4/3] border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-1 text-slate-300">
        <ImageOff size={18} />
        <span className="text-[10px] font-bold">{label}</span>
        <span className="text-[10px]">ไม่มีรูป</span>
      </div>
    );
  }
  return (
    <button
      onClick={() => onOpen(url)}
      className="group relative aspect-[4/3] border border-slate-200 rounded-xl overflow-hidden bg-slate-50 hover:border-emerald-400 hover:ring-2 hover:ring-emerald-100 transition"
    >
      <img src={url} alt={label} className="w-full h-full object-cover" loading="lazy" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 flex items-center gap-1">
        <Icon size={10} className="text-white shrink-0" />
        <span className="text-[10px] font-bold text-white truncate">{label}</span>
      </div>
    </button>
  );
};
