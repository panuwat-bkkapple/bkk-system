'use client';

// เวลาทำการและวันหยุด — เจ้าของ `settings/store/business_hours`
//
// ค่าชุดนี้เป็นตัวที่ **gate หน้า checkout ของลูกค้าจริง**: ตัวเลือกวันใน
// modal นัดรับเครื่องมาจากมันโดยตรง และ `validateAndCreateOrder` ก็ตรวจซ้ำ
// ฝั่ง server ด้วยค่าเดียวกัน ตั้งวันหยุดที่นี่ = ลูกค้ากดจองวันนั้นไม่ได้ทันที
// ทั้งเส้นทางไรเดอร์และเส้นทางเข้าสาขา
//
// **อย่าสับสนกับ "เวลาทำการมาตรฐาน" ในหน้าข้อมูลร้าน** (`/store-settings`)
// อันนั้นคือ `settings/store_profile.hours_start/hours_end` ซึ่งเป็นข้อความที่
// AI เอาไปพูดกับลูกค้า **ไม่ได้ควบคุมอะไรเลย** แก้อันนั้นแล้วปฏิทินของลูกค้า
// จะไม่ขยับสักวัน — เคยไม่มีที่แก้ค่าที่ควบคุมจริงในระบบนี้เลย ต้องไปแก้ที่
// หน้า /admin ของเว็บลูกค้า ซึ่งกำลังจะถูกยุบ หน้านี้จึงเกิดขึ้นมารับช่วง
//
// การ์ดวันหยุดเตือนเมื่อวันที่กำลังจะปิดมีนัดค้างอยู่ — ปิดวันไม่ได้ยกเลิกนัด
// ที่จองไว้ ลูกค้ายังถือใบยืนยันและจะมาตามนัด

import React, { useState, useEffect, useMemo } from 'react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Clock, Save, Loader2, AlertTriangle, Plus, X, Power, CalendarDays, CalendarClock,
  CalendarOff, Info,
} from 'lucide-react';
import { useToast } from '../../components/ui/ToastProvider';
import { useDatabase } from '../../hooks/useDatabase';
import { findHolidayConflicts, bookedDateOf, type HolidayConflict, type BookingLike } from '../../utils/holidayConflicts';

interface BusinessHoursConfig {
  openHour: number;
  closeHour: number;
  /** 0=อาทิตย์ … 6=เสาร์ */
  closedDays: number[];
  /** วันหยุดพิเศษ รูปแบบ YYYY-MM-DD (ปฏิทินไทย) */
  holidays: string[];
  temporaryClosed: boolean;
  temporaryClosedMessage: string;
}

// ต้องตรงกับ DEFAULT_CONFIG ใน bkk-frontend-next/app/hooks/useBusinessHours.ts
// — ถ้าโหนดยังไม่เคยถูกเขียน ทั้งสองฝั่งต้องเดาค่าเดียวกัน
const DEFAULT_CONFIG: BusinessHoursConfig = {
  openHour: 10,
  closeHour: 22,
  closedDays: [],
  holidays: [],
  temporaryClosed: false,
  temporaryClosedMessage: '',
};

const DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * "2026-08-16" -> "อา. 16 ส.ค. 2026"
 *
 * แถวรายการโชว์ชื่อวันด้วย เพราะการปิดร้านมักผูกกับวันในสัปดาห์ ("ปิดวันจันทร์
 * นั้น") มากกว่าตัวเลขวันที่ ส่วน YYYY-MM-DD ดิบยังโชว์ใต้ไว้เพื่อให้เทียบกับ
 * ข้อมูลใน DB ได้ตรง ๆ. สร้าง Date แบบ local จาก 3 ส่วน ไม่ผ่าน Date.parse
 * เพื่อไม่ให้ ISO string ถูกอ่านเป็น UTC แล้วเลื่อนวันบนเครื่องที่ไม่ใช่ ICT
 */
function formatThaiDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('th-TH', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** การ์ด section มาตรฐาน — รูปเดียวกับ AccountingSettings / NotificationSettings */
function Section({ icon, tint, title, subtitle, children }: {
  icon: React.ReactNode; tint: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tint}`}>{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-800">{title}</h2>
          {subtitle && <p className="text-[11px] font-bold text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** แถวตั้งค่า: คำอธิบายซ้าย — ตัวควบคุมขวา */
function Row({ title, desc, children, last }: {
  title: string; desc?: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${last ? '' : 'pb-3.5 border-b border-slate-100'}`}>
      <div className="min-w-0">
        <p className="text-sm font-black text-slate-700">{title}</p>
        {desc && <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-rose-500' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export default function BusinessHoursSettings() {
  const toast = useToast();
  const [config, setConfig] = useState<BusinessHoursConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [newHoliday, setNewHoliday] = useState('');
  const [conflictPrompt, setConflictPrompt] = useState<{ date: string; rows: HolidayConflict[] } | null>(null);

  // งานทั้งหมดมาจาก store ที่แอปนี้ subscribe อยู่แล้ว — ไม่ยิง query ใหม่
  // จึงไม่มีค่า download เพิ่มจากการเปิดหน้านี้เลย (กฎค่า RTDB)
  const { data: jobs, loading: jobsLoading } = useDatabase('jobs');

  useEffect(() => {
    const unsub = onValue(ref(db, 'settings/store/business_hours'), (snap) => {
      const d = snap.val() || {};
      setConfig({
        openHour: d.openHour ?? DEFAULT_CONFIG.openHour,
        closeHour: d.closeHour ?? DEFAULT_CONFIG.closeHour,
        closedDays: Array.isArray(d.closedDays) ? d.closedDays : [],
        holidays: Array.isArray(d.holidays) ? d.holidays : [],
        temporaryClosed: d.temporaryClosed ?? false,
        temporaryClosedMessage: d.temporaryClosedMessage ?? '',
      });
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  /** นัดค้าง แยกตามวัน — ใช้ทั้งตอนกดเพิ่มวันหยุด และป้ายบนวันที่ตั้งไว้แล้ว */
  const bookingsByDate = useMemo(() => {
    if (jobsLoading || !Array.isArray(jobs)) return new Map<string, HolidayConflict[]>();
    // หยิบเฉพาะฟิลด์ที่ตัวตรวจใช้ ไม่ลากทั้ง job เข้ามา — ชนิดชัดและอ่านออกว่า
    // หน้านี้พึ่งอะไรจากงานบ้าง
    const rows: BookingLike[] = (jobs as Record<string, unknown>[]).map((j) => ({
      id: String(j.id ?? ''),
      ref_no: j.ref_no as string | undefined,
      status: j.status as string | undefined,
      receive_method: j.receive_method as string | undefined,
      pickup_schedule: j.pickup_schedule as BookingLike['pickup_schedule'],
      appointment_date: j.appointment_date as string | undefined,
      appointment_time: j.appointment_time as string | undefined,
    }));
    const dates = Array.from(new Set(rows.map(bookedDateOf).filter(Boolean)));
    return findHolidayConflicts(rows, dates);
  }, [jobs, jobsLoading]);

  const commitHoliday = (date: string) => {
    setConfig((p) => ({ ...p, holidays: [...p.holidays, date].sort() }));
    setNewHoliday('');
    setDirty(true);
  };

  const handleAddHoliday = () => {
    if (!newHoliday) return;
    if (config.holidays.includes(newHoliday)) {
      toast.warning('วันหยุดนี้มีอยู่แล้ว');
      return;
    }
    // เตือน ไม่ใช่บล็อก — ปิดร้านกะทันหันต้องทำได้จริง (พนักงานป่วย ไฟดับ)
    // สิ่งที่ต้องไม่เกิดคือปิดไปเงียบๆ แล้วลูกค้ามาเจอประตูล็อก
    const rows = bookingsByDate.get(newHoliday);
    if (rows && rows.length > 0) {
      setConflictPrompt({ date: newHoliday, rows });
      return;
    }
    commitHoliday(newHoliday);
  };

  const handleSave = async () => {
    if (config.openHour >= config.closeHour) {
      toast.warning('เวลาเปิดต้องน้อยกว่าเวลาปิด');
      return;
    }
    setSaving(true);
    try {
      await update(ref(db, 'settings/store'), {
        business_hours: { ...config, updated_at: Date.now() },
      });
      setDirty(false);
      toast.success('บันทึกเวลาทำการเรียบร้อย — มีผลกับหน้า checkout ของลูกค้าทันที');
    } catch {
      toast.error('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  };

  const toggleClosedDay = (day: number) => {
    setConfig((p) => ({
      ...p,
      closedDays: p.closedDays.includes(day)
        ? p.closedDays.filter((d) => d !== day)
        : [...p.closedDays, day].sort(),
    }));
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span className="text-sm font-bold">กำลังโหลด...</span>
      </div>
    );
  }

  const closedCount = config.closedDays.length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center">
          <CalendarClock size={22} />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-800">เวลาทำการ &amp; วันหยุด</h1>
          <p className="text-xs font-bold text-slate-400">
            คุมปฏิทินนัดรับเครื่องบนหน้า checkout ของลูกค้าโดยตรง ทั้งไรเดอร์และเข้าสาขา — บันทึกแล้วมีผลทันที
          </p>
        </div>
      </div>

      {/* กันสับสนกับ "เวลาทำการมาตรฐาน" ที่หน้าข้อมูลร้าน ซึ่งเป็นแค่ข้อความ
          ที่ AI เอาไปพูด ไม่ได้ควบคุมปฏิทินอะไรเลย */}
      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-100 flex gap-2">
        <Info size={15} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
          คนละอันกับ &quot;เวลาทำการมาตรฐาน&quot; ในหน้าข้อมูลร้าน — อันนั้นเป็นข้อความที่ผู้ช่วย AI ใช้ตอบลูกค้าเท่านั้น
          ไม่ได้ควบคุมว่าลูกค้าจองวันไหนได้ ถ้าต้องการปิดไม่ให้จอง ต้องตั้งที่หน้านี้
        </p>
      </div>

      <Section
        icon={<Power size={18} />}
        tint={config.temporaryClosed ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}
        title="ปิดรับชั่วคราว"
        subtitle="เปิดสวิตช์นี้ = ลูกค้าจองนัดใหม่ไม่ได้ทุกวัน จนกว่าจะปิดสวิตช์"
      >
        <Row
          title={config.temporaryClosed ? 'กำลังปิดรับนัดใหม่' : 'เปิดรับนัดตามปกติ'}
          desc={config.temporaryClosed ? 'นัดที่จองไว้แล้วไม่ถูกยกเลิก — ต้องติดต่อลูกค้าเอง' : undefined}
          last={!config.temporaryClosed}
        >
          <Toggle
            checked={config.temporaryClosed}
            onChange={(v) => { setConfig((p) => ({ ...p, temporaryClosed: v })); setDirty(true); }}
          />
        </Row>
        {config.temporaryClosed && (
          <div className="pt-3.5">
            <label className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">
              ข้อความที่ลูกค้าจะเห็น
            </label>
            <input
              value={config.temporaryClosedMessage}
              onChange={(e) => { setConfig((p) => ({ ...p, temporaryClosedMessage: e.target.value })); setDirty(true); }}
              placeholder="เช่น ปิดปรับปรุงร้าน 20-22 ส.ค."
              className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </Section>

      <Section
        icon={<Clock size={18} />}
        tint="bg-blue-100 text-blue-600"
        title="ชั่วโมงที่เปิดให้จอง"
        subtitle="รอบเวลาบนหน้า checkout ถูกแบ่งเป็นช่วงละ 2 ชั่วโมงจากค่านี้"
      >
        <div className="flex gap-4">
          {([['เปิด', 'openHour'], ['ปิด', 'closeHour']] as const).map(([label, key]) => (
            <div key={key} className="flex-1">
              <label className="text-[11px] font-black text-slate-500 uppercase tracking-wide block mb-1.5">{label}</label>
              <select
                value={config[key]}
                onChange={(e) => { setConfig((p) => ({ ...p, [key]: Number(e.target.value) })); setDirty(true); }}
                className="w-full px-4 py-2.5 bg-slate-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Section>

      <Section
        icon={<CalendarDays size={18} />}
        tint="bg-slate-100 text-slate-500"
        title="วันหยุดประจำสัปดาห์"
        subtitle={closedCount > 0 ? `ปิด ${closedCount} วันต่อสัปดาห์` : 'เปิดทุกวัน — กดวันที่ต้องการปิด'}
      >
        <div className="grid grid-cols-7 gap-1.5">
          {DAY_NAMES.map((name, i) => {
            const closed = config.closedDays.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleClosedDay(i)}
                aria-pressed={closed}
                className={`py-2.5 rounded-xl text-[11px] font-black transition-colors ${
                  closed
                    ? 'bg-rose-50 text-rose-600 border border-rose-100'
                    : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {name.slice(0, 2)}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        icon={<CalendarOff size={18} />}
        tint="bg-slate-100 text-slate-500"
        title="วันหยุดพิเศษ"
        subtitle="วันที่ปิดเป็นครั้งคราว เช่น วันหยุดนักขัตฤกษ์ หรือปิดร้านกะทันหัน"
      >
        <div className="flex gap-2">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="flex-1 px-4 py-2.5 bg-slate-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleAddHoliday}
            disabled={!newHoliday}
            className="px-4 py-2.5 bg-slate-800 text-white font-black text-sm rounded-xl hover:bg-slate-900 disabled:opacity-30 transition-colors flex items-center gap-1"
          >
            <Plus size={14} /> เพิ่ม
          </button>
        </div>

        {config.holidays.length > 0 ? (
          <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
            {config.holidays.map((date) => {
              // ป้ายขึ้นเฉพาะเมื่ออ่านงานสำเร็จ — ไม่มีป้ายจึงแปลว่า "ไม่มีนัด"
              // ไม่ใช่ "ยังไม่รู้"
              const stranded = jobsLoading ? [] : (bookingsByDate.get(date) || []);
              return (
                <div key={date} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-700">{formatThaiDate(date)}</p>
                      <p className="text-[11px] font-bold text-slate-400 mt-0.5">{date}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setConfig((p) => ({ ...p, holidays: p.holidays.filter((h) => h !== date) })); setDirty(true); }}
                      className="shrink-0 p-1.5 text-slate-300 hover:text-rose-500 transition-colors"
                      aria-label={`ลบวันหยุด ${date}`}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {stranded.length > 0 && (
                    <div className="mt-2 p-3 rounded-xl bg-rose-50 border border-rose-100">
                      <p className="text-[11px] font-black text-rose-700 flex items-center gap-1.5">
                        <AlertTriangle size={12} className="shrink-0" />
                        มีนัดค้างอยู่ {stranded.length} งาน — ลูกค้ายังถือใบยืนยัน
                      </p>
                      <div className="mt-1.5 space-y-0.5">
                        {stranded.map((r) => (
                          <p key={r.id} className="text-[11px] font-bold text-rose-600/80">
                            {r.ref}{r.time ? ` · ${r.time}` : ''}{r.method ? ` · ${r.method}` : ''} · {r.status}
                          </p>
                        ))}
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 mt-1.5">ติดต่อลูกค้าเพื่อเลื่อนนัด หรือลบวันหยุดนี้ออก</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] font-bold text-slate-400 text-center py-4 mt-2 border-t border-slate-100">
            ยังไม่มีวันหยุดพิเศษ
          </p>
        )}
      </Section>

      <button
        onClick={handleSave}
        disabled={saving || !dirty}
        className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? 'กำลังบันทึก...' : dirty ? 'บันทึกเวลาทำการ' : 'บันทึกแล้ว'}
      </button>

      {/* ยืนยันก่อนปิดวันที่มีนัดค้าง — รายชื่องานอยู่ตรงนี้เลยเพื่อให้ตัดสินใจ
          ได้ทันทีว่าจะเลื่อนนัดหรือไม่ปิด ไม่ต้องไปเปิดอีกหน้า */}
      {conflictPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setConflictPrompt(null)}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <header className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-black text-slate-800">
                  {formatThaiDate(conflictPrompt.date)} มีนัดอยู่แล้ว {conflictPrompt.rows.length} งาน
                </h2>
                <p className="text-[11px] font-bold text-slate-400 mt-0.5 leading-relaxed">
                  ปิดวันนี้ไม่ได้ยกเลิกนัดที่จองไว้ ลูกค้ายังถือใบยืนยันและจะมาตามนัด ถ้าจะปิดจริงต้องติดต่อลูกค้าเพื่อเลื่อนนัดด้วย
                </p>
              </div>
            </header>
            <div className="px-5 py-4 overflow-y-auto flex-1 divide-y divide-slate-100">
              {conflictPrompt.rows.map((r) => (
                <div key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-[13px] font-black text-slate-700">{r.ref}</p>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                    {r.time || 'ไม่ระบุเวลา'}{r.method ? ` · ${r.method}` : ''} · {r.status}
                  </p>
                </div>
              ))}
            </div>
            <footer className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => setConflictPrompt(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-black text-slate-600 hover:bg-slate-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => { commitHoliday(conflictPrompt.date); setConflictPrompt(null); }}
                className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-black hover:bg-rose-700 transition-colors"
              >
                ปิดวันนี้อยู่ดี
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
