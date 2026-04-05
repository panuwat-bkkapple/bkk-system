import React, { useState, useEffect, useCallback } from 'react';
import { Package, MapPin, CheckCircle2, Loader2, RefreshCw, AlertCircle, Truck } from 'lucide-react';
import { ref, onValue } from 'firebase/database';
import { db } from '@/api/firebase';

interface TrackingItem {
  status: string;
  status_code: string;
  date: string;
  location: string;
  postcode: string;
  delivery_status: string | null;
  receiver_name: string | null;
}

interface TrackingData {
  barcode: string;
  status: 'found' | 'not_found';
  fetched_at: number;
  items: TrackingItem[];
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  delivered: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: <CheckCircle2 size={14} className="text-emerald-500" /> },
  in_transit: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700', icon: <Truck size={14} className="text-blue-500" /> },
  default: { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-700', icon: <Package size={14} className="text-slate-400" /> },
};

function getStatusStyle(item: TrackingItem) {
  const code = String(item.status_code || '').trim();
  if (code === '501' || item.delivery_status === 'S') return STATUS_STYLES.delivered;
  if (['201', '202', '203', '204', '301'].includes(code)) return STATUS_STYLES.in_transit;
  return STATUS_STYLES.default;
}

function formatThaiDate(dateStr: string) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

function timeAgo(timestamp: number) {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return `${Math.floor(hrs / 24)} วันที่แล้ว`;
}

export const ThaiPostTracking: React.FC<{ jobId: string; trackingNumber: string }> = ({ jobId, trackingNumber }) => {
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen to tracking_data from RTDB (real-time)
  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    const trackingRef = ref(db, `jobs/${jobId}/tracking_data`);
    const unsub = onValue(trackingRef, (snap) => {
      setData(snap.val());
      setLoading(false);
    });
    return () => unsub();
  }, [jobId]);

  // Trigger refresh by re-writing tracking_number (fires the cloud function)
  const handleRefresh = useCallback(async () => {
    if (!trackingNumber || !jobId) return;
    setLoading(true);
    try {
      const { update } = await import('firebase/database');
      await update(ref(db, `jobs/${jobId}`), {
        tracking_number: trackingNumber, // re-write same value triggers onValueWritten
      });
    } catch { /* ignore */ }
    // Loading will be cleared by the onValue listener when tracking_data updates
    setTimeout(() => setLoading(false), 5000); // fallback timeout
  }, [jobId, trackingNumber]);

  if (!trackingNumber) return null;

  return (
    <div className="mt-3 border border-orange-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-orange-50">
        <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5">
          <Package size={12} /> Thailand Post Tracking
        </p>
        <div className="flex items-center gap-2">
          {data?.fetched_at && (
            <span className="text-[8px] text-orange-300">{timeAgo(data.fetched_at)}</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="text-orange-400 hover:text-orange-600 disabled:opacity-50 transition-colors p-1"
            title="รีเฟรช"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 bg-white max-h-[200px] overflow-y-auto no-scrollbar">
        {loading && !data && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
            <Loader2 size={14} className="animate-spin" /> กำลังโหลดสถานะพัสดุ...
          </div>
        )}

        {!loading && !data && (
          <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
            <AlertCircle size={14} /> รอระบบดึงข้อมูลจากไปรษณีย์ไทย...
          </div>
        )}

        {data && data.status === 'not_found' && (
          <p className="text-xs text-slate-400 py-3 text-center">ไม่พบข้อมูลพัสดุ (อาจยังไม่เข้าระบบ)</p>
        )}

        {data && data.items && data.items.length > 0 && (
          <div className="space-y-0 relative before:absolute before:left-[6px] before:top-2 before:bottom-2 before:w-[1.5px] before:bg-slate-100">
            {data.items.map((item, i) => {
              const style = getStatusStyle(item);
              return (
                <div key={i} className="flex gap-2.5 relative py-1.5">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm z-10 shrink-0 mt-0.5 ${i === 0 ? 'bg-orange-500' : 'bg-slate-200'}`} />
                  <div className={`flex-1 px-2.5 py-1.5 rounded-lg border ${i === 0 ? style.bg : 'bg-white border-slate-100'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[10px] font-bold ${i === 0 ? style.text : 'text-slate-500'} flex items-center gap-1`}>
                        {i === 0 && style.icon} {item.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.location && (
                        <span className="text-[9px] text-slate-400 flex items-center gap-0.5">
                          <MapPin size={8} /> {item.location}
                        </span>
                      )}
                      <span className="text-[9px] text-slate-300">{formatThaiDate(item.date)}</span>
                    </div>
                    {item.receiver_name && (
                      <p className="text-[9px] text-emerald-600 font-bold mt-0.5">ผู้รับ: {item.receiver_name}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
