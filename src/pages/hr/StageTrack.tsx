// src/pages/hr/StageTrack.tsx
//
// แถบความคืบหน้าของใบสมัคร (stepper)
//
// **ลำดับขั้นมาจาก `track` ที่ server ส่งมา ไม่ใช่ array ที่คอมโพเนนต์นี้ถือเอง**
// และ **ขั้นที่กดได้มาจาก `row.next` เท่านั้น** — แถบนี้เป็นแค่หน้าตาใหม่ของ
// ปุ่มชุดเดิม ไม่ใช่กติกาชุดที่สอง ขั้นที่เครื่องสถานะไม่อนุญาตจะกดไม่ได้แม้จะ
// วาดอยู่บนแถบ (การวาดทั้งสายทำให้เห็นว่าใบนี้อยู่ตรงไหน ซึ่งเป็นสิ่งที่แถวปุ่ม
// เรียงกันบอกไม่ได้เลย)
//
// **ใบที่อยู่นอกสาย (ไม่ผ่าน / ผู้สมัครปฏิเสธ / ค่าเก่า) ได้ `track_step = 0`**
// แถบจึงเป็นสีเทาทั้งเส้น ไม่ใช่เดินไปสุด — การระบายเต็มให้ใบที่ถูกปฏิเสธคือ
// การบอกว่ามันไปถึงปลายทางแล้ว ซึ่งตรงข้ามกับความจริง
//
// -----------------------------------------------------------------------------
// **แยกออกมาเป็นไฟล์ของตัวเองเพื่อให้เทสเรียกได้จริง** — `Recruitment.tsx`
// import `api/firebase` ตอนโหลดโมดูล การ import มันในเทสจึงพัง (ไม่มี config)
// ทำให้ด่านของแถบนี้เหลือได้แค่การหาข้อความในซอร์ส ซึ่งพิสูจน์พฤติกรรมไม่ได้
// ไฟล์นี้ไม่มี dependency นอกจาก react กับไอคอน จึง SSR ในเทสได้ตรงๆ
// -----------------------------------------------------------------------------
import React from 'react';
import { Check } from 'lucide-react';

export interface StageMeta {
  label: string; short?: string; tone: string;
  terminal?: boolean; legacy?: boolean; offtrack?: boolean;
}
export interface TrackStep { key: string; step: number; short: string; label: string }
/** ส่วนของใบสมัครที่แถบนี้ต้องใช้จริง — ไม่รับทั้งก้อนเพื่อให้เทสประกอบง่าย */
export interface StageTrackRow { next: string[]; track_step: number }

export const StageTrack: React.FC<{
  row: StageTrackRow;
  track: TrackStep[];
  meta: (s: string) => StageMeta;
  busy: boolean;
  onMove: (to: string) => void;
}> = ({ row, track, meta, busy, onMove }) => {
  const at = row.track_step;
  const offtrack = at === 0;
  // ทางออกด้านข้าง (ไม่ผ่าน / ผู้สมัครปฏิเสธ) ไม่มีตำแหน่งบนสาย จึงอยู่เป็น
  // ปุ่มแยก — ยัดลงแถบเมื่อไหร่ก็ต้องแต่งขั้นให้มันที่ไม่เคยมีจริง
  const sideExits = row.next.filter((k) => !track.some((t) => t.key === k));

  // -------------------------------------------------------------------------
  // ไม่มีลำดับขั้น = ฝั่ง server ยังเป็นตัวเก่าที่ไม่ส่ง `track` มา
  //
  // **ต้องถอยไปเป็นแถวปุ่มเดิม ห้ามคืน null** — hosting กับ functions เป็นคนละ
  // job ใน workflow เดียวกัน และ **hosting ขึ้นก่อนเสมอ** (วัดจริง 4 ก.ย. 2569:
  // hosting เสร็จ 02:46 ส่วน functions ยังไม่จบที่ 03:0x) ช่วงระหว่างนั้นหน้า
  // ใหม่คุยกับ callable ตัวเก่า ถ้าคืน null ก็คือ **แอดมินไม่มีปุ่มเปลี่ยน
  // สถานะเลยหลายนาที** — เกิดขึ้นจริงมาแล้วหนึ่งรอบ
  //
  // กฎเดียวกับที่ CLAUDE.md เขียนไว้ฝั่งตะกร้าลูกค้า: "Vercel deploy ถึงก่อน
  // deploy-functions หลายนาที ตะกร้าห้ามพังในช่องว่างนั้น"
  // -------------------------------------------------------------------------
  if (!track.length) {
    return (
      <div className="mt-3 flex gap-1.5 flex-wrap">
        {row.next.map((to) => (
          <button key={to} type="button" onClick={() => onMove(to)} disabled={busy}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-600 disabled:opacity-50">
            {meta(to).label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-end gap-3 flex-wrap">
      <div className="flex items-start flex-1 min-w-[320px]">
        {track.map((st, i) => {
          // **ขั้นที่ยืนอยู่ไม่ใช่ขั้นที่ทำเสร็จแล้ว** — เดิมใช้ `>=` ทำให้ขั้น
          // ปัจจุบันขึ้นเครื่องหมายถูกด้วย แถบจึงอ่านว่า "เสร็จหมดแล้ว" ทั้งที่
          // ใบยังค้างอยู่ตรงนั้น (เห็นจากการเรนเดอร์จริง ไม่มีเทสไหนจับได้)
          const done = !offtrack && at > st.step;
          const current = !offtrack && at === st.step;
          const can = row.next.includes(st.key);
          return (
            <React.Fragment key={st.key}>
              <button
                type="button"
                disabled={!can || busy}
                onClick={() => onMove(st.key)}
                title={can ? `ย้ายไป "${meta(st.key).label}"` : meta(st.key).label}
                className={`flex flex-col items-center gap-1 w-[52px] shrink-0 group ${
                  can ? 'cursor-pointer' : 'cursor-default'
                } disabled:opacity-100`}
              >
                {/* สามสภาพต้องแยกออกจากกันตั้งแต่ยังไม่เอาเมาส์ไปชี้:
                    ทำแล้ว (ทึบ+ถูก) · ยืนอยู่ (วงแหวน+เลข) · ไปได้ (เส้นประ)
                    ส่วนขั้นที่เครื่องสถานะไม่อนุญาตเป็นเทาจาง กดไม่ได้ —
                    ถ้า "ไปได้" กับ "ไปไม่ได้" หน้าตาเหมือนกัน หน้าจอที่มีไว้
                    ตอบว่า "ทำอะไรต่อได้" ก็ตอบไม่ได้จนกว่าจะเอาเมาส์ไล่ชี้
                    ขั้นที่ทำไปแล้วแต่ถอยกลับได้ยังเป็นวงทึบ (มันทำไปแล้วจริง)
                    ได้แค่วงแหวนตอนชี้ — การถอยกลับเป็นทางที่ไม่ควรชวนให้กด */}
                <span
                  className={`w-[26px] h-[26px] rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-colors ${
                    done
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : current
                        ? 'bg-white border-emerald-500 text-emerald-600 ring-2 ring-emerald-500/20 ring-offset-1'
                        : can
                          ? 'bg-white border-dashed border-emerald-300 text-emerald-500 group-hover:bg-emerald-50 group-hover:border-emerald-500 group-hover:border-solid'
                          : 'bg-white border-gray-200 text-gray-300'
                  } ${done && can ? 'group-hover:ring-2 group-hover:ring-emerald-500/30' : ''}`}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : st.step}
                </span>
                <span
                  className={`text-[10px] leading-tight text-center ${
                    current ? 'font-black text-emerald-700'
                      : done ? 'font-bold text-gray-500'
                        : can ? 'font-bold text-emerald-600'
                          : 'text-gray-300'
                  }`}
                >
                  {st.short}
                </span>
              </button>
              {i < track.length - 1 && (
                <span
                  className={`h-0.5 flex-1 mt-[12px] rounded-full ${
                    !offtrack && at > st.step ? 'bg-emerald-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {sideExits.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {sideExits.map((to) => (
            <button key={to} type="button" onClick={() => onMove(to)} disabled={busy}
              className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-[11px] font-bold text-gray-500 disabled:opacity-50">
              {meta(to).label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
