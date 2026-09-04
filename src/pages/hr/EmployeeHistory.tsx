// ประวัติพนักงาน — เรนเดอร์อย่างเดียว ไม่ import firebase (เทสเรนเดอร์ได้จริง)
//
// **แทนที่ `EmployeeTimeline` ซึ่งไม่ใช่ประวัติ แต่เป็น audit log ที่ปลอมตัวมา**
// ของเดิมแสดงรายการ "มีคนกดแก้ไขเมื่อ 3 ก.ย." ซึ่งเป็นคำถามของ audit log และ
// ตอบได้ไม่ครบด้วยซ้ำ — บรรทัด "ปรับเงินเดือน" ต้องเขียนแก้ตัวว่า *"ระบบไม่ได้
// บันทึกจำนวนเงินไว้ในประวัติ"* แล้วชี้ให้ไปกดปุ่มแก้ไขดู **ค่าปัจจุบัน**
//
// หน้านี้ตอบคำถามของ *คน*: ทำงานมานานแค่ไหน · เคยอยู่ตำแหน่งไหน · เงินเดือน
// ขึ้นครั้งละเท่าไร · ปีนี้ลาไปกี่วัน · ออกเอกสารอะไรให้ไปแล้ว
//
// audit log ยังมีอยู่ และอยู่คนละที่ (ปุ่ม "บันทึกการแก้ไข") — ดู audit-log.js

import React from 'react';
import { Clock, TrendingUp, Briefcase, CalendarDays, FileText, AlertTriangle } from 'lucide-react';
import { baht, thaiDate } from './hrFormat';
import {
  LEAVE_TYPE_LABEL, STATUS_LABEL, salaryDeltaText, positionRangeText,
  type EmployeeHistoryData,
} from './employeeHistoryView';

export const HistoryHeading: React.FC = () => <>ประวัติพนักงาน</>;

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({
  icon, title, children,
}) => (
  <div className="space-y-1.5">
    <p className="text-xs font-black text-gray-700 flex items-center gap-1.5">{icon} {title}</p>
    {children}
  </div>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] text-gray-400">{children}</p>
);

export const EmployeeHistoryView: React.FC<{
  data: EmployeeHistoryData | null;
  loading: boolean;
}> = ({ data, loading }) => {
  if (loading) return <p className="text-sm text-gray-400">กำลังโหลด...</p>;
  if (!data) return <p className="text-sm text-gray-400">ยังไม่มีข้อมูลประวัติ</p>;

  const s = data.summary;

  return (
    <div className="space-y-5">
      {/* ── สรุป — สิ่งแรกที่คนเปิดประวัติอยากรู้ ── */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-gray-500">ระยะเวลางาน</span>
          {s.tenure_text ? (
            <span className="text-base font-black text-gray-800">
              {s.tenure_text}
              {s.tenure_ended && <span className="text-xs font-bold text-gray-400 ml-1.5">(พ้นสภาพแล้ว)</span>}
            </span>
          ) : (
            // **ไม่รู้ ต้องเขียนว่าไม่รู้** — คนที่ไม่มีวันเริ่มงานในระบบอาจ
            // ทำงานมาสามปีแล้ว การเขียน "0 วัน" คือการรายงานสิ่งที่ไม่เคยตรวจ
            <span className="text-xs font-bold text-amber-700 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> ยังไม่ได้กรอกวันเริ่มงาน
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500">
          {s.position || 'ไม่ระบุตำแหน่ง'}
          {s.department && ` · ${s.department}`}
          {s.hired_at && ` · เริ่มงาน ${thaiDate(s.hired_at)}`}
        </p>
      </div>

      {/* ── ตำแหน่ง ── */}
      <Section icon={<Briefcase size={13} />} title="ตำแหน่งที่เคยอยู่">
        {data.positions.length === 0 ? (
          <Empty>ยังไม่มีข้อมูลตำแหน่ง</Empty>
        ) : (
          <div className="space-y-1">
            {data.positions.map((p, i) => (
              <div key={`${p.position}-${i}`}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 ${
                  p.current ? 'border-emerald-100 bg-emerald-50' : 'border-gray-100'}`}>
                <span className="text-xs font-bold text-gray-700">{p.position}</span>
                <span className="text-[11px] text-gray-500 shrink-0">{positionRangeText(p)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── เงินเดือน — ท่อนที่ของเดิมทำไม่ได้ ── */}
      {data.salary !== null && (
        <Section icon={<TrendingUp size={13} />} title="ประวัติเงินเดือน">
          {data.salary.length === 0 ? (
            <Empty>ยังไม่เคยปรับเงินเดือนหลังจากระบบเริ่มบันทึก</Empty>
          ) : (
            <div className="space-y-1">
              {data.salary.map((r, i) => (
                <div key={`${r.at}-${i}`} className="rounded-lg border border-gray-100 px-3 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-gray-700">
                      {r.withheld ? (
                        // แถวเก่าที่ระบบยังไม่เก็บค่า — พูดตรงๆ ว่าไม่มีข้อมูล
                        // ไม่ใช่แสดงเป็น 0 บาท
                        <span className="text-gray-400">ไม่ได้บันทึกจำนวนเงินไว้</span>
                      ) : (
                        <>
                          {baht(r.from)} <span className="text-gray-400">→</span> {baht(r.to)}
                          {r.pct !== null && (
                            <span className={`ml-1.5 text-[11px] font-black ${
                              r.pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {salaryDeltaText(r.pct)}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                    <span className="text-[11px] text-gray-400 shrink-0">{thaiDate(r.at)}</span>
                  </div>
                  {(r.reason || r.by_name) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {r.reason}{r.reason && r.by_name ? ' · ' : ''}{r.by_name && `โดย ${r.by_name}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── วันลารายปี ── */}
      <Section icon={<CalendarDays size={13} />} title="วันลาแต่ละปี">
        {data.leave_by_year.length === 0 ? (
          <Empty>ยังไม่มีใบลาที่อนุมัติแล้ว</Empty>
        ) : (
          <div className="space-y-1">
            {data.leave_by_year.map((y) => (
              <div key={y.year} className="rounded-lg border border-gray-100 px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-700">ปี {y.year}</span>
                  <span className="text-[11px] text-gray-600">
                    ลาไป <b>{y.days}</b> วัน
                    {y.unpaid_days > 0 && (
                      <span className="text-amber-700 font-bold"> · ไม่ได้ค่าจ้าง {y.unpaid_days} วัน</span>
                    )}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {Object.entries(y.by_type)
                    .map(([t, d]) => `${LEAVE_TYPE_LABEL[t] || t} ${d} วัน`)
                    .join(' · ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── สถานะการจ้าง ── */}
      <Section icon={<Clock size={13} />} title="สถานะการจ้าง">
        {data.statuses.length === 0 ? (
          <Empty>ยังไม่มีข้อมูล</Empty>
        ) : (
          <div className="space-y-1">
            {data.statuses.map((st, i) => (
              <div key={`${st.at}-${i}`} className="flex items-center justify-between gap-2 text-xs px-3 py-1">
                <span className="text-gray-700">
                  {st.from ? `${STATUS_LABEL[st.from] || st.from} → ` : ''}
                  <b>{(st.to && STATUS_LABEL[st.to]) || st.to || 'ไม่ระบุ'}</b>
                  {st.by_name && <span className="text-gray-400 font-normal"> · โดย {st.by_name}</span>}
                </span>
                <span className="text-[11px] text-gray-400 shrink-0">{thaiDate(st.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── เอกสาร ── */}
      <Section icon={<FileText size={13} />} title="เอกสารที่ออกให้">
        {data.documents.length === 0 ? (
          <Empty>ยังไม่เคยออกเอกสาร</Empty>
        ) : (
          <div className="space-y-1">
            {data.documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-xs px-3 py-1">
                <span className="text-gray-700 font-mono">{d.number || d.type}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{thaiDate(d.issued_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};
