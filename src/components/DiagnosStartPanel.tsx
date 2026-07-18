// BKK Diagnos start panel (admin) — covers the two channels the rider app
// can't: Store-in (customer walks in, staff shows the QR) and Mail-in
// (no customer present — staff opens the link on the customer's device and
// runs the SOP in staff mode). Sessions resume across admins/devices via
// the jobs/{id}/diagnos_sessions/{deviceIndex} pointer; results render in
// DiagnosReportCard once finalized.

import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, onValue } from 'firebase/database';
import QRCode from 'qrcode';
import { Activity, Copy, Loader2, QrCode as QrIcon, RefreshCcw } from 'lucide-react';
import { app, db } from '../api/firebase';

const STEP_TOTAL = 12;

interface Props {
  job: any;
  deviceIndex: number;
}

interface LiveSession {
  status?: string;
  claimed_by?: string | null;
  mode?: string;
  steps?: Record<string, { result?: string }>;
}

export default function DiagnosStartPanel({ job, deviceIndex }: Props) {
  const [mode, setMode] = useState<'customer' | 'staff'>('customer');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState<LiveSession | null>(null);

  // Resume live view from the job pointer (works even if another admin or
  // the rider created the session).
  const pointerId: string | undefined = job?.diagnos_sessions?.[deviceIndex];
  useEffect(() => {
    if (!pointerId) {
      setLive(null);
      return;
    }
    const unsub = onValue(
      ref(db, `diagnostic_sessions/${pointerId}`),
      (snap) => setLive(snap.exists() ? (snap.val() as LiveSession) : null),
      () => setLive(null),
    );
    return unsub;
  }, [pointerId]);

  const create = async () => {
    setCreating(true);
    setError('');
    setCopied(false);
    try {
      const fn = httpsCallable(getFunctions(app, 'asia-southeast1'), 'createDiagnosticSession');
      const res = await fn({ jobId: job.id, deviceIndex, mode });
      const data = res.data as { url: string };
      setUrl(data.url);
      setQr(await QRCode.toDataURL(data.url, { width: 480, margin: 1 }));
    } catch (e: any) {
      setError(e?.message || 'สร้างเซสชันไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('คัดลอกไม่สำเร็จ — กดค้างที่ลิงก์เพื่อคัดลอกเอง');
    }
  };

  const active = live && (live.status === 'open' || live.status === 'in_progress');
  const doneCount = live?.steps ? Object.keys(live.steps).length : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Activity size={12} className="text-blue-600" /> เริ่ม BKK Diagnos (เครื่อง {deviceIndex + 1})
        </p>
        {active && (
          <span className="text-[10px] font-bold text-blue-600">
            {live?.claimed_by ? `กำลังทดสอบ ${doneCount}/${STEP_TOTAL}` : 'รอสแกน QR'}
          </span>
        )}
        {live?.status === 'submitted' && (
          <span className="text-[10px] font-bold text-emerald-600">ทดสอบเสร็จแล้ว — ดูผลด้านล่าง</span>
        )}
      </div>

      {!url && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('customer')}
              className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-bold border ${
                mode === 'customer'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              ลูกค้าสแกนทำเอง (Store-in)
            </button>
            <button
              onClick={() => setMode('staff')}
              className={`flex-1 rounded-lg px-2 py-2 text-[11px] font-bold border ${
                mode === 'staff'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              พนักงานทำเอง (Mail-in)
            </button>
          </div>
          <button
            onClick={create}
            disabled={creating}
            className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-bold text-xs flex justify-center items-center gap-2 active:scale-95 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <QrIcon size={14} />}
            สร้าง QR / ลิงก์ทดสอบ
          </button>
        </>
      )}

      {url && (
        <div className="space-y-2">
          {qr && (
            <div className="flex justify-center">
              <img src={qr} alt="Diagnos QR" className="w-44 h-44 rounded-lg border border-slate-200 bg-white" />
            </div>
          )}
          <p className="text-[10px] text-slate-500 text-center">
            {mode === 'customer'
              ? 'ให้ลูกค้าสแกนด้วยเครื่องที่จะขาย'
              : 'สแกน/เปิดลิงก์นี้บนเครื่องของลูกค้า แล้วพนักงานทดสอบตามขั้นตอน'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={copyLink}
              className="flex-1 bg-white border border-slate-200 text-slate-600 py-2 rounded-lg font-bold text-[11px] flex justify-center items-center gap-1.5"
            >
              <Copy size={12} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="flex-1 bg-white border border-slate-200 text-slate-600 py-2 rounded-lg font-bold text-[11px] flex justify-center items-center gap-1.5"
            >
              <RefreshCcw size={12} /> QR ใหม่
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] font-bold text-red-500">{error}</p>}
    </div>
  );
}
