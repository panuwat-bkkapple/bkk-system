// Card แสดง + แก้ไขค่าแบตเตอรี่ของเครื่องในหน้ารายละเอียดใบงาน (mobile + desktop)
// ค่าแบต "ไม่ได้" มาจากผลตรวจ IMEI/SickW — มาจากการตรวจสภาพเครื่อง
// (ไรเดอร์ตรวจ หรือแอดมินผ่าน AdminDeviceVerificationModal / QCStation)
//
// คนเขียน field เหล่านี้:
//   - battery_health_pct      → ไรเดอร์ + AdminDeviceVerificationModal
//   - battery_health          → QCStation (ก๊อปปี้ฝั่ง QC, ความหมายเดียวกัน)
//   - battery_cycle_count     → verification modal / QC
//   - battery_unavailable     → ไรเดอร์กด "เครื่องเปิดไม่ได้ / อ่านแบตไม่ได้" (รอตรวจตอน QC)
//   - verification_battery_photo → รูปหน้าจอ Settings > Battery ที่อัปโหลด
// อ่านแบบ fallback `battery_health ?? battery_health_pct` ให้ตรงกับ Inventory/QCStation
//
// แก้ไข inline ได้จากการ์ดนี้เลย (ปุ่มดินสอ) — เดิมแก้ได้แค่ในโมดอลตรวจสอบเครื่อง
// ซึ่งเข้าได้เฉพาะตอนงานยังไม่ verify เสร็จ. save เขียน job root + mirror ไป
// devices[0] เมื่อมีเครื่องเดียว (ให้ Inventory ที่อ่าน device-level เห็นตรงกัน)

import { useState } from 'react';
import { BatteryFull, BatteryWarning, Pencil, Check, X } from 'lucide-react';
import { ref, update } from 'firebase/database';
import { db } from '../../api/firebase';
import { useToast } from '../ui/ToastProvider';

interface Props {
  job: any;
  /** ชื่อผู้แก้ไข (ลง audit log) */
  editorName?: string;
  className?: string;
}

export function BatteryHealthCard({ job, editorName, className }: Props) {
  const toast = useToast();
  // QC เขียน battery_health, ไรเดอร์เขียน battery_health_pct — อ่านทั้งคู่กันค่าหาย
  const pct: number | null | undefined = job?.battery_health ?? job?.battery_health_pct;
  // job root เป็นหลัก, fallback ไป qc_details สำหรับงานเก่าที่ QC เซฟไว้ก่อน mirror
  const cycles: number | null | undefined = job?.battery_cycle_count ?? job?.qc_details?.cycle_count;
  const photo: string | undefined = job?.verification_battery_photo;
  // ไรเดอร์ตรวจแล้วแต่อ่านแบตไม่ได้ (เครื่องเปิดไม่ได้) — ยังเป็นข้อมูลสำคัญ ต้องโชว์
  const unavailable: boolean = job?.battery_unavailable === true;

  const [editing, setEditing] = useState(false);
  const [pctInput, setPctInput] = useState('');
  const [cycleInput, setCycleInput] = useState('');
  const [saving, setSaving] = useState(false);

  const openEditor = () => {
    setPctInput(pct == null ? '' : String(pct));
    setCycleInput(cycles == null ? '' : String(cycles));
    setEditing(true);
  };

  const save = async () => {
    const pctNum = pctInput.trim() === '' ? null : parseInt(pctInput, 10);
    const cycleNum = cycleInput.trim() === '' ? null : parseInt(cycleInput, 10);
    if (pctNum != null && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100)) {
      toast.error('สุขภาพแบตต้องอยู่ระหว่าง 0–100'); return;
    }
    if (cycleNum != null && (!Number.isFinite(cycleNum) || cycleNum < 0)) {
      toast.error('รอบการชาร์จต้องเป็นเลขจำนวนเต็มบวก'); return;
    }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        // mirror ทั้ง 2 ฟิลด์ (admin อ่าน battery_health, ไรเดอร์/อื่นๆ อ่าน battery_health_pct)
        battery_health: pctNum,
        battery_health_pct: pctNum,
        battery_cycle_count: cycleNum,
        // กรอกค่าเองแล้ว = ไม่ใช่ "อ่านแบตไม่ได้" อีกต่อไป
        battery_unavailable: false,
        updated_at: Date.now(),
        qc_logs: [
          {
            action: 'Battery Updated',
            by: editorName || 'Admin',
            timestamp: Date.now(),
            details: `แก้ค่าแบต: สุขภาพ ${pctNum == null ? '-' : pctNum + '%'}, รอบชาร์จ ${cycleNum == null ? '-' : cycleNum}`,
          },
          ...(job?.qc_logs || []),
        ],
      };
      // มีเครื่องเดียว → mirror ลง devices[0] ให้ตัวอ่าน device-level (Inventory) เห็นตรงกัน
      if (Array.isArray(job?.devices) && job.devices.length === 1) {
        updates['devices/0/battery_health_pct'] = pctNum;
        updates['devices/0/battery_cycle_count'] = cycleNum;
        updates['devices/0/battery_unavailable'] = false;
      }
      await update(ref(db, `jobs/${job.id}`), updates);
      toast.success('บันทึกค่าแบตแล้ว');
      setEditing(false);
    } catch (e: unknown) {
      toast.error('บันทึกไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  // ยังไม่มีข้อมูลแบตเลย (และไม่ได้ flag ว่าอ่านไม่ได้) และไม่ได้กำลังแก้ — ไม่แสดงการ์ดเปล่า
  if (pct == null && cycles == null && !photo && !unavailable && !editing) return null;

  // ----- โหมดแก้ไข -----
  if (editing) {
    return (
      <div className={`bg-white rounded-2xl border border-blue-200 p-4 ${className || ''}`}>
        <div className="flex items-center gap-2 mb-3">
          <BatteryFull size={16} className="text-blue-600" />
          <p className="text-sm font-bold text-slate-800">แก้ไขค่าแบตเตอรี่</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">สุขภาพแบต (%)</label>
            <input
              type="number" min={0} max={100} value={pctInput}
              onChange={(e) => setPctInput(e.target.value)}
              placeholder="เช่น 89"
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">รอบการชาร์จ</label>
            <input
              type="number" min={0} value={cycleInput}
              onChange={(e) => setCycleInput(e.target.value)}
              placeholder="เช่น 120"
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={save} disabled={saving}
            className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
          <button
            onClick={() => setEditing(false)} disabled={saving}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <X size={14} /> ยกเลิก
          </button>
        </div>
      </div>
    );
  }

  // ----- โหมดไรเดอร์ flag "อ่านแบตไม่ได้" และยังไม่มีตัวเลขจาก QC -----
  if (unavailable && pct == null) {
    return (
      <div className={`bg-amber-50 rounded-2xl border border-amber-200 p-4 flex items-start gap-3 ${className || ''}`}>
        <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <BatteryWarning size={16} className="text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900">สุขภาพแบตเตอรี่</p>
          <p className="text-[11px] text-amber-700 mt-0.5">เครื่องเปิดไม่ได้ / อ่านแบตไม่ได้ — รอตรวจแบตตอน QC</p>
          {photo && (
            <a href={photo} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-blue-600 hover:underline mt-1 inline-block mr-3">
              ดูรูปหน้าจอแบต
            </a>
          )}
          <button onClick={openEditor} className="text-[11px] font-bold text-amber-800 hover:underline mt-1 inline-flex items-center gap-1">
            <Pencil size={11} /> กรอกค่าแบต
          </button>
        </div>
      </div>
    );
  }

  // ----- โหมดแสดงผลปกติ -----
  const healthy = typeof pct === 'number' && pct >= 80;
  const pctColor =
    pct == null ? 'text-slate-400'
    : healthy ? 'text-emerald-600'
    : 'text-red-600';

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${healthy ? 'bg-emerald-100' : pct == null ? 'bg-slate-100' : 'bg-red-100'}`}>
          <BatteryFull size={16} className={healthy ? 'text-emerald-600' : pct == null ? 'text-slate-500' : 'text-red-600'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">สุขภาพแบตเตอรี่</p>
          <p className="text-[11px] text-slate-500">ความจุแบตสูงสุด · จากการตรวจสภาพเครื่อง</p>
        </div>
        <span className={`text-2xl font-black tabular-nums ${pctColor}`}>
          {pct == null ? '-' : `${pct}%`}
        </span>
        <button
          onClick={openEditor}
          title="แก้ไขค่าแบต"
          className="ml-1 w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center shrink-0"
        >
          <Pencil size={14} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="bg-slate-50 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">รอบการชาร์จ</p>
          <p className="text-sm font-bold text-slate-800 tabular-nums">
            {cycles == null ? '-' : cycles.toLocaleString()}
          </p>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 flex flex-col justify-center">
          {photo ? (
            <a
              href={photo}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline"
            >
              ดูรูปหน้าจอแบต
            </a>
          ) : (
            <span className="text-xs text-slate-400">ไม่มีรูปหน้าจอแบต</span>
          )}
        </div>
      </div>
    </div>
  );
}
