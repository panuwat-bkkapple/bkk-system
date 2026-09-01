// การ์ด "ไรเดอร์แย้งหมุดลูกค้า" บนตั๋วงาน
//
// ไรเดอร์ยื่นแย้งเมื่อหมุดที่ลูกค้าปักไม่ใช่จุดรับจริง — ค่าวิ่งถูกคิดจาก
// เส้นทาง "หมุด → สาขา" ซึ่งเป็นที่ที่ไม่มีใครไป. แอดมิน (CEO/MANAGER)
// ตัดสินโดยดูจุดเช็คอินจริงเทียบกับหมุด แล้วอนุมัติให้คิดค่าวิ่งใหม่จาก
// จุดเช็คอิน — การคำนวณทั้งหมดทำฝั่ง server (callable adminReviewPinDispute)
// หน้านี้ไม่คิดเงินเองและไม่ส่งตัวเลขไปให้ server
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AlertTriangle, Check, ExternalLink, MapPinOff, X } from 'lucide-react';
import { app } from '@/api/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/ToastProvider';
import { canReviewAdjustments } from '@/utils/adjustments';
import { pinDisputeSignals, needsAcknowledgement } from '@/utils/pinDisputeSignals';

interface PinDispute {
  status?: 'pending' | 'approved' | 'rejected';
  requested_at?: number;
  requested_by_rider_name?: string;
  reason?: string;
  checkin?: { lat?: number; lng?: number; at?: number; distance_m?: number | null };
  fee_before?: number;
  fee_after?: number;
  delta?: number;
  distance_km_before?: number | null;
  distance_km_after?: number | null;
  reviewed_by_name?: string;
  reviewed_at?: number;
  admin_note?: string;
  delta_tx_id?: string;
}

const baht = (n: unknown) => `฿${Number(n || 0).toLocaleString('th-TH')}`;
const meters = (n: unknown) => `${Math.round(Number(n || 0)).toLocaleString('th-TH')} ม.`;
const when = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

export const PinDisputeCard = ({ job }: { job: any }) => {
  const dispute: PinDispute | undefined = job?.pin_dispute;
  const { currentUser } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [acked, setAcked] = useState(false);

  if (!dispute?.status) return null;

  const canReview = canReviewAdjustments(currentUser?.role);
  const checkin = dispute.checkin;
  const mapUrl =
    checkin?.lat != null && checkin?.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${checkin.lat},${checkin.lng}`
      : null;
  const pinUrl =
    typeof job?.cust_lat === 'number' && typeof job?.cust_lng === 'number'
      ? `https://www.google.com/maps/search/?api=1&query=${job.cust_lat},${job.cust_lng}`
      : null;
  const settled = job?.rider_fee_status === 'Paid';
  const signals = pinDisputeSignals(job);
  const mustAck = needsAcknowledgement(job);

  const review = async (decision: 'approve' | 'reject') => {
    if (!canReview) { toast.warning('เฉพาะ CEO/MANAGER เท่านั้นที่ตัดสินได้'); return; }
    if (decision === 'approve' && mustAck && !acked) {
      toast.warning('มีหลักฐานที่ค้านคำแย้งนี้ — อ่านแล้วติ๊กยืนยันก่อนอนุมัติ');
      return;
    }
    setBusy(decision);
    try {
      const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'adminReviewPinDispute');
      const res: any = await fn({ jobId: job.id, decision, adminNote: note.trim() || undefined });
      if (decision === 'approve') {
        const d = Number(res?.data?.delta || 0);
        toast.success(
          `คิดค่าวิ่งใหม่แล้ว: ${baht(res?.data?.fee)}` +
            (d === 0 ? ' (เท่าเดิม)' : d > 0 ? ` (+${baht(d)})` : ` (${baht(d)})`)
        );
      } else {
        toast.success('ปฏิเสธคำแย้งแล้ว ค่าวิ่งคงเดิม');
      }
      setNote('');
    } catch (e: any) {
      toast.error(e?.message || 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  };

  const tone =
    dispute.status === 'pending'
      ? { box: 'border-amber-300 bg-amber-50', head: 'text-amber-900', icon: 'text-amber-600' }
      : dispute.status === 'approved'
        ? { box: 'border-emerald-200 bg-emerald-50', head: 'text-emerald-900', icon: 'text-emerald-600' }
        : { box: 'border-slate-200 bg-slate-50', head: 'text-slate-700', icon: 'text-slate-400' };

  return (
    <div className={`rounded-[2rem] p-6 border ${tone.box}`}>
      <h3 className={`text-lg font-black mb-1 flex items-center gap-2 ${tone.head}`}>
        <MapPinOff size={20} className={tone.icon} />
        ไรเดอร์แย้งหมุดลูกค้า
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/70 border border-current/20">
          {dispute.status === 'pending' ? 'รอตรวจ' : dispute.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}
        </span>
      </h3>
      <p className="text-xs text-slate-500 font-medium mb-4">
        {dispute.requested_by_rider_name || 'ไรเดอร์'} ยื่นเมื่อ {when(dispute.requested_at)}
      </p>

      {dispute.reason && (
        <div className="text-sm text-slate-700 bg-white/70 rounded-2xl px-4 py-3 mb-4 leading-relaxed">
          "{dispute.reason}"
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <div className="bg-white/70 rounded-2xl px-4 py-3">
          <div className="text-[11px] font-bold text-slate-400 mb-1">หมุดที่ลูกค้าปัก</div>
          <div className="text-sm font-bold text-slate-800">
            {dispute.distance_km_before != null ? `${dispute.distance_km_before} กม. ถึงสาขา` : 'ไม่มีข้อมูลระยะทาง'}
          </div>
          {pinUrl && (
            <a href={pinUrl} target="_blank" rel="noreferrer noopener" className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 mt-1">
              เปิดบนแผนที่ <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div className="bg-white/70 rounded-2xl px-4 py-3">
          <div className="text-[11px] font-bold text-slate-400 mb-1">จุดที่ไรเดอร์เช็คอินจริง</div>
          <div className="text-sm font-bold text-slate-800">
            {checkin?.distance_m != null ? `ห่างหมุด ${meters(checkin.distance_m)}` : 'ไม่มีระยะเทียบหมุด'}
          </div>
          {mapUrl && (
            <a href={mapUrl} target="_blank" rel="noreferrer noopener" className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 mt-1">
              เปิดบนแผนที่ <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {dispute.status === 'approved' ? (
        <div className="bg-white/70 rounded-2xl px-4 py-3 text-sm">
          <div className="font-bold text-slate-800">
            ค่าวิ่ง {baht(dispute.fee_before)} → {baht(dispute.fee_after)}
            {typeof dispute.delta === 'number' && dispute.delta !== 0 && (
              <span className={dispute.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                {' '}({dispute.delta > 0 ? '+' : ''}{baht(dispute.delta)})
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {dispute.distance_km_after != null && `คิดจากจุดเช็คอิน ${dispute.distance_km_after} กม. · `}
            อนุมัติโดย {dispute.reviewed_by_name || 'Admin'} {when(dispute.reviewed_at)}
            {dispute.delta_tx_id && ' · ลงส่วนต่างในกระเป๋าไรเดอร์แล้ว'}
          </div>
          {dispute.admin_note && <div className="text-xs text-slate-600 mt-1">หมายเหตุ: {dispute.admin_note}</div>}
        </div>
      ) : dispute.status === 'rejected' ? (
        <div className="bg-white/70 rounded-2xl px-4 py-3 text-sm text-slate-600">
          ไม่อนุมัติโดย {dispute.reviewed_by_name || 'Admin'} {when(dispute.reviewed_at)} — ค่าวิ่งคงเดิมที่ {baht(dispute.fee_before)}
          {dispute.admin_note && <div className="text-xs mt-1">หมายเหตุ: {dispute.admin_note}</div>}
        </div>
      ) : (
        <>
          {settled && (
            <div className="flex items-start gap-2 text-xs font-bold text-amber-800 bg-white/70 rounded-2xl px-4 py-3 mb-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              ค่ารอบงานนี้จ่ายเข้ากระเป๋าไปแล้ว — อนุมัติแล้วระบบจะลงส่วนต่างเป็นรายการใหม่ในกระเป๋าไรเดอร์ (เพิ่มหรือหักคืนตามตัวเลขที่คิดใหม่)
            </div>
          )}
          {signals.length > 0 && (
            <div className="bg-white/70 border border-rose-200 rounded-2xl px-4 py-3 mb-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-black text-rose-700">
                <AlertTriangle size={14} /> หลักฐานที่ค้านคำแย้งนี้
              </div>
              {signals.map((sig) => (
                <div key={sig.id} className="text-xs text-slate-700 leading-relaxed">- {sig.text}</div>
              ))}
              {mustAck && (
                <label className="flex items-start gap-2 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acked}
                    onChange={(e) => setAcked(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs font-bold text-slate-700">
                    อ่านแล้ว และยืนยันว่ายังต้องการคิดค่าวิ่งใหม่จากจุดเช็คอิน
                  </span>
                </label>
              )}
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="หมายเหตุถึงไรเดอร์ (ไม่บังคับ)"
            rows={2}
            maxLength={500}
            className="w-full text-sm rounded-2xl border border-slate-200 px-4 py-3 mb-3 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          {canReview ? (
            <div className="flex gap-2">
              <button
                onClick={() => review('approve')}
                disabled={busy !== null || (mustAck && !acked)}
                className="flex-1 bg-emerald-600 text-white font-bold text-sm rounded-2xl py-3 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Check size={16} /> {busy === 'approve' ? 'กำลังคิดใหม่...' : 'อนุมัติ — คิดค่าวิ่งใหม่จากจุดเช็คอิน'}
              </button>
              <button
                onClick={() => review('reject')}
                disabled={busy !== null}
                className="px-5 bg-white text-rose-600 border border-rose-200 font-bold text-sm rounded-2xl py-3 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <X size={16} /> ไม่อนุมัติ
              </button>
            </div>
          ) : (
            <div className="text-xs font-bold text-slate-500">เฉพาะ CEO/MANAGER เท่านั้นที่ตัดสินคำแย้งนี้ได้</div>
          )}
        </>
      )}
    </div>
  );
};
