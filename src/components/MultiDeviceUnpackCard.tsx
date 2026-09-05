// การ์ดบนตั๋ว: งานขายปลีกที่มีหลายเครื่อง ↔ งานลูกรายเครื่องที่ระบบแตกออกมา
//
// ขึ้นสองด้าน — บนงานแม่ (บอกว่าแตกแล้ว/กำลังจะแตก/ต้องรันซ้ำ + รหัสลูก) และบน
// งานลูก (บอกว่ามาจากงานไหน เครื่องที่เท่าไร และเงิน/เอกสารอยู่ที่แม่). กติกา
// ทั้งหมดอยู่ฝั่ง server (functions/b2c-unpack.js) การ์ดนี้แค่อ่าน stamp
// `multi_unpack` แล้วเลือกคำพูด ปุ่มเดียวที่มีคือ "รันซ้ำ" ซึ่งยิง callable ตัวเดียวกับ
// ที่ trigger อัตโนมัติใช้ — ขึ้นเฉพาะเมื่อรอบอัตโนมัติไม่จบ (ดู multiUnpackState)
import React, { useState } from 'react';
import { Layers, RefreshCw, CornerLeftUp } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../api/firebase';
import { useToast } from './ui/ToastProvider';
import { JOB_STATUS, normalizeStatus } from '../types/job-statuses';
import {
  isB2cUnpackedChild, multiUnpackState, MULTI_UNPACK_ENTRY_STATUSES,
} from '../utils/stockChildren';

type JobLike = {
  id?: string;
  status?: string;
  receive_method?: string;
  type?: string;
  devices?: unknown;
  multi_unpack?: { count?: number; child_refs?: string[]; written?: boolean } | null;
  parent_ref_no?: string;
  device_index?: number;
};

const devicesCount = (job: JobLike): number => {
  const raw = job.devices;
  if (Array.isArray(raw)) return raw.filter(Boolean).length;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>).filter(Boolean).length;
  return 0;
};

export function MultiDeviceUnpackCard({ job, light = false }: { job: JobLike; light?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canonical = normalizeStatus(job.status, job.receive_method as never);

  const shell = light
    ? 'rounded-xl border border-sky-200 bg-sky-50 p-3 text-sky-900'
    : 'rounded-xl border border-white/10 bg-white/5 p-3 text-slate-200';
  const muted = light ? 'text-sky-700' : 'text-slate-400';

  // ── งานลูก ────────────────────────────────────────────────────────────────
  if (isB2cUnpackedChild(job)) {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider">
          <CornerLeftUp size={14} /> เครื่องที่ {Number(job.device_index ?? 0) + 1} จากงาน {job.parent_ref_no || '-'}
        </div>
        <p className={`text-[11px] mt-1 leading-relaxed ${muted}`}>
          แถวนี้คือเครื่องในคลัง — ยอดจ่าย ใบสำคัญรับเงิน คูปอง และหน้าติดตามของลูกค้าอยู่ที่งานแม่ ไม่ใช่ที่นี่
        </p>
      </div>
    );
  }

  // ── งานแม่ ────────────────────────────────────────────────────────────────
  const count = devicesCount(job);
  if (count < 2 && !job.multi_unpack) return null;

  const state = multiUnpackState(job, canonical === JOB_STATUS.COMPLETED);
  const atShop = !!canonical && MULTI_UNPACK_ENTRY_STATUSES.includes(canonical);
  const refs = job.multi_unpack?.child_refs || [];

  const rerun = async () => {
    if (!job.id || busy) return;
    setBusy(true);
    try {
      const fn = httpsCallable<{ jobId: string }, { ok: true; children: number; recovered: boolean }>(
        getFunctions(app, 'asia-southeast1'),
        'unpackMultiDeviceJob',
      );
      const res = await fn({ jobId: job.id });
      toast.success(`แตกเป็นงานลูก ${res.data.children} เครื่องเรียบร้อย`);
    } catch (err) {
      const msg = (err as { message?: string })?.message || 'รันไม่สำเร็จ';
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  if (state === 'done') {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider">
          <Layers size={14} /> แตกเป็นงานลูก {job.multi_unpack?.count ?? count} เครื่องแล้ว
        </div>
        {refs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {refs.map((r) => (
              <span key={r} className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${light ? 'bg-white border border-sky-200' : 'bg-white/10'}`}>{r}</span>
            ))}
          </div>
        )}
        <p className={`text-[11px] mt-1.5 leading-relaxed ${muted}`}>
          ใบนี้ปิดในฐานะใบสั่งขาย — เครื่องแต่ละใบตรวจ QC และเข้าคลังแยกกันที่รหัสข้างบน
        </p>
      </div>
    );
  }

  // ยังไม่จบ: มี stamp แต่แม่ยังไม่ปิด / เครื่องถึงร้านแล้วแต่ยังไม่มี stamp — ปุ่มรันซ้ำ
  const needsRerun = state === 'partial' || atShop;
  return (
    <div className={shell}>
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider">
        <Layers size={14} /> งานนี้มี {count} เครื่อง
      </div>
      <p className={`text-[11px] mt-1 leading-relaxed ${muted}`}>
        {needsRerun
          ? 'เครื่องถึงร้านแล้วแต่ยังไม่ถูกแตกเป็นงานลูกรายเครื่อง — ปกติระบบทำให้เองภายในไม่กี่วินาที ถ้าค้างอยู่ให้กดรันซ้ำ'
          : 'เมื่อเครื่องถึงร้าน (เข้าคิว QC) ระบบจะแตกเป็นงานลูกรายเครื่องอัตโนมัติ เพื่อให้แต่ละเครื่องมี QC / IMEI / คลัง ของตัวเอง'}
      </p>
      {needsRerun && (
        <button
          onClick={rerun}
          disabled={busy}
          className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-lg transition-all ${light ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-white/15 text-white hover:bg-white/25'} disabled:opacity-50`}
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> {busy ? 'กำลังรัน...' : 'รันการแตกงานซ้ำ'}
        </button>
      )}
    </div>
  );
}
