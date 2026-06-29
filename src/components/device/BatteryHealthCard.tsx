// Card แสดงค่าแบตเตอรี่ของเครื่องในหน้ารายละเอียดใบงาน (mobile + desktop)
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

import { BatteryFull, BatteryWarning } from 'lucide-react';

interface Props {
  job: any;
  className?: string;
}

export function BatteryHealthCard({ job, className }: Props) {
  // QC เขียน battery_health, ไรเดอร์เขียน battery_health_pct — อ่านทั้งคู่กันค่าหาย
  const pct: number | null | undefined = job?.battery_health ?? job?.battery_health_pct;
  // job root เป็นหลัก, fallback ไป qc_details สำหรับงานเก่าที่ QC เซฟไว้ก่อน mirror
  const cycles: number | null | undefined = job?.battery_cycle_count ?? job?.qc_details?.cycle_count;
  const photo: string | undefined = job?.verification_battery_photo;
  // ไรเดอร์ตรวจแล้วแต่อ่านแบตไม่ได้ (เครื่องเปิดไม่ได้) — ยังเป็นข้อมูลสำคัญ ต้องโชว์
  const unavailable: boolean = job?.battery_unavailable === true;

  // ยังไม่มีข้อมูลแบตเลย (และไม่ได้ flag ว่าอ่านไม่ได้) — ไม่ต้องแสดงการ์ดเปล่า
  if (pct == null && cycles == null && !photo && !unavailable) return null;

  // เคสไรเดอร์ flag "เครื่องเปิดไม่ได้ / อ่านแบตไม่ได้" และยังไม่มีตัวเลขจาก QC
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
            <a href={photo} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-blue-600 hover:underline mt-1 inline-block">
              ดูรูปหน้าจอแบต
            </a>
          )}
        </div>
      </div>
    );
  }

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
