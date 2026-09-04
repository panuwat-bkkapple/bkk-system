// src/pages/hr/EmployeeTimeline.tsx
//
// ไทม์ไลน์ประวัติพนักงาน — **คอมโพเนนต์ใบ้ รับ items มาทางพร็อพ**
// การโหลดข้อมูลอยู่ที่ `EmployeeRegister.tsx` เพื่อให้ไฟล์นี้ไม่ต้อง import
// firebase และเทสเรนเดอร์ได้จริง (เหตุผลเดียวกับ StageTrack.tsx)
import React from 'react';
import { Clock } from 'lucide-react';
import { describeEvent, actorLabel, sortEvents, type TimelineEvent } from './employeeTimeline';
import { thaiDate } from './hrFormat';

const DOT: Record<string, string> = {
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  gray: 'bg-gray-300',
};

export const EmployeeTimeline: React.FC<{
  items: TimelineEvent[];
  capped?: boolean;
  loading?: boolean;
}> = ({ items, capped, loading }) => {
  const rows = sortEvents(items);

  if (loading) return <p className="text-sm text-gray-400 py-6">กำลังโหลด...</p>;
  if (!rows.length) {
    return (
      <p className="text-sm text-gray-400 py-6">
        ยังไม่มีประวัติของคนนี้ — ประวัติเริ่มบันทึกตั้งแต่วันที่แฟ้มถูกสร้างในระบบ
        แฟ้มที่ย้ายเข้ามาทีหลังจึงไม่มีเหตุการณ์ก่อนหน้านั้น
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {capped && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
          แสดงเฉพาะเหตุการณ์ล่าสุดเท่าที่เพดานอนุญาต — เก่ากว่านั้นไม่ได้อยู่ในรายการนี้
        </p>
      )}
      {rows.map((ev, i) => {
        const v = describeEvent(ev);
        return (
          <div key={ev.id} className="flex gap-3">
            {/* เส้นต่อระหว่างจุด — จุดสุดท้ายไม่มีเส้นห้อยลงมา */}
            <div className="flex flex-col items-center pt-1.5">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT[v.tone] || DOT.gray}`} />
              {i < rows.length - 1 && <span className="w-px flex-1 bg-gray-200 my-1" />}
            </div>
            <div className={`min-w-0 ${i === rows.length - 1 ? '' : 'pb-4'}`}>
              <p className="text-sm font-bold text-gray-800 flex items-center gap-2 flex-wrap">
                {v.label}
                {v.unknown && (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                    ระบบยังไม่รู้จักเหตุการณ์นี้
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {thaiDate(ev.at || null)} · โดย {actorLabel(ev)}
              </p>
              {v.lines.map((line, k) => (
                <p key={k} className="text-[13px] text-gray-600 mt-0.5">{line}</p>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const TimelineHeading: React.FC = () => (
  <span className="inline-flex items-center gap-1.5"><Clock size={15} /> ประวัติพนักงาน</span>
);
