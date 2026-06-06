// Banner สรุปสถานะ Sickw บนใบงาน + ปุ่ม Override สำหรับ MANAGER/CEO
// ใช้ที่: หน้า Internal QC + QC Station (วางบนสุดของ detail panel)
//
// แสดง 4 state:
//   - none: ยังไม่เคยตรวจ → เตือนเหลือง (ไม่ block)
//   - error: Sickw ตอบ error/rejected → เตือนเทา (ไม่ block)
//   - clean: ผ่านครบ → แถบเขียวเล็กๆ
//   - flagged: ติด FMI/MDM/BL → แถบแดง + ปุ่ม Override
//   - overridden: มี flag แต่ MANAGER/CEO ปลดล็อกแล้ว → แถบส้ม + ชื่อคน override

import { useState } from 'react';
import { CheckCircle2, AlertTriangle, ShieldAlert, Info, Loader2, X } from 'lucide-react';
import { submitSickwGateOverride, type JobSickwCheck, type SickwGateStatus } from '../../utils/sickwApi';
import { useToast } from '../ui/ToastProvider';

interface Props {
  jobId: string;
  sickwCheck: JobSickwCheck | undefined | null;
  gate: SickwGateStatus;
  /** role ของผู้ใช้ปัจจุบัน — ใช้ตัดสินว่าโชว์ปุ่ม Override ได้ไหม */
  currentRole: string | undefined;
  /** callback หลัง override สำเร็จ ให้ parent re-fetch หรือ optimistic update */
  onOverridden?: () => void;
}

const OVERRIDE_ROLES = ['CEO', 'MANAGER'];

export function SickwGateBanner({ jobId, sickwCheck, gate, currentRole, onOverridden }: Props) {
  const [showOverrideModal, setShowOverrideModal] = useState(false);

  // state=none ไม่ต้องโชว์ banner ใหญ่ — โชว์แค่ inline note บางๆ
  if (gate.state === 'none') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900">
        <Info size={14} className="text-amber-600 shrink-0" />
        <span>ใบงานนี้ <b>ยังไม่ได้ตรวจ IMEI</b> — ตรวจก่อนผ่าน QC เพื่อรักษาความปลอดภัยของ payout</span>
      </div>
    );
  }

  if (gate.state === 'error') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[11px] text-slate-700">
        <Info size={14} className="text-slate-500 shrink-0" />
        <span>ตรวจ IMEI ไม่สำเร็จ (<code className="font-mono">{sickwCheck?.last_check?.status}</code>) — ผ่านได้ตามดุลพินิจ</span>
      </div>
    );
  }

  if (gate.state === 'clean') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900">
        <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
        <span>ตรวจ IMEI ผ่าน — Find My ปิด / ไม่ติด MDM / ไม่อยู่ใน Blacklist</span>
      </div>
    );
  }

  if (gate.state === 'overridden') {
    const o = gate.override!;
    return (
      <div className="bg-orange-50 border-2 border-orange-300 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert size={18} className="text-orange-600" />
          <h4 className="text-sm font-black uppercase tracking-tight text-orange-900">Override Active</h4>
        </div>
        <p className="text-xs text-orange-800 mb-2">
          ปกติเครื่องนี้จะ <b>ถูก block</b> เพราะ: {gate.reasons.join(' / ')}
        </p>
        <div className="bg-white/70 rounded-xl p-3 space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span className="text-orange-700 font-bold">ผู้ปลดล็อก</span>
            <span className="text-orange-900 font-bold">{o.overridden_by_name} ({o.overridden_by_role})</span>
          </div>
          <div className="flex justify-between">
            <span className="text-orange-700 font-bold">เวลา</span>
            <span className="text-orange-900 font-mono">{new Date(o.overridden_at).toLocaleString('th-TH')}</span>
          </div>
          <div>
            <span className="text-orange-700 font-bold">เหตุผล:</span>
            <p className="text-orange-900 mt-1 italic">"{o.reason}"</p>
          </div>
        </div>
      </div>
    );
  }

  // state === 'flagged' — block + ปุ่ม override (ถ้า role อนุญาต)
  const canOverride = !!currentRole && OVERRIDE_ROLES.includes(currentRole.toUpperCase());
  return (
    <>
      <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-red-600" />
          <h4 className="text-sm font-black uppercase tracking-tight text-red-900">เครื่องไม่ผ่านการตรวจ IMEI — ห้ามผ่าน QC</h4>
        </div>
        <ul className="text-xs text-red-800 list-disc pl-5 space-y-0.5 mb-3">
          {gate.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
        {gate.staleOverride && (
          <p className="text-[10px] text-red-700 bg-white/50 rounded p-2 mb-3">
            <b>Note:</b> ใบงานนี้เคย override ไว้แล้ว แต่ตรวจซ้ำใหม่ยังเจอ flag — ต้อง override ใหม่
          </p>
        )}
        {canOverride ? (
          <button
            onClick={() => setShowOverrideModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 active:scale-95 transition-all"
          >
            Override (ใช้สิทธิ์ {currentRole})
          </button>
        ) : (
          <p className="text-[11px] text-red-700">
            ต้องให้ <b>MANAGER หรือ CEO</b> เป็นผู้ปลดล็อก (override) ถึงจะส่ง QC ได้
          </p>
        )}
      </div>
      {showOverrideModal && (
        <OverrideModal
          jobId={jobId}
          reasons={gate.reasons}
          onClose={() => setShowOverrideModal(false)}
          onSuccess={() => {
            setShowOverrideModal(false);
            onOverridden?.();
          }}
        />
      )}
    </>
  );
}

function OverrideModal({
  jobId, reasons, onClose, onSuccess,
}: { jobId: string; reasons: string[]; onClose: () => void; onSuccess: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 10) {
      toast.error('ระบุเหตุผลอย่างน้อย 10 ตัวอักษร');
      return;
    }
    setSubmitting(true);
    try {
      await submitSickwGateOverride(jobId, reason.trim());
      toast.success('Override สำเร็จ — ผ่าน QC ต่อได้แล้ว');
      onSuccess();
    } catch (e: any) {
      toast.error(e?.message || 'Override ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-red-600 text-white p-5 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <ShieldAlert size={20} />
            <h3 className="font-black text-sm uppercase tracking-wide">Override IMEI Gate</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
            <p className="font-bold mb-1">เครื่องนี้ติด:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">เหตุผลการปลดล็อก (จะถูกบันทึก audit log)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              placeholder="เช่น: ลูกค้า sign out จาก iCloud ต่อหน้าแล้ว ระบบยังไม่ refresh — ตรวจสอบด้วยตาเปล่าผ่านแล้ว"
              rows={4}
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-red-400 resize-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">{reason.length}/500 — ขั้นต่ำ 10 ตัวอักษร</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50"
            >
              ยกเลิก
            </button>
            <button
              onClick={submit}
              disabled={submitting || reason.trim().length < 10}
              className="flex-1 py-3 rounded-xl bg-red-600 text-white font-black text-sm uppercase hover:bg-red-700 disabled:opacity-40 flex justify-center items-center gap-2 transition-all"
            >
              {submitting ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก...</> : 'ยืนยัน Override'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
