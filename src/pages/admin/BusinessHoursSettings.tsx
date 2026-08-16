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
  Clock, Save, Loader2, AlertTriangle, Plus, X, Power, CalendarDays, Info,
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
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 size={20} className="animate-spin mr-2" /> กำลังโหลด...
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
          <Clock size={20} className="text-amber-500" /> เวลาทำการ &amp; วันหยุด
        </h1>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          ค่าชุดนี้ควบคุมปฏิทินนัดรับเครื่องบนหน้า checkout ของลูกค้าโดยตรง
          ทั้งเส้นทางไรเดอร์และเข้าสาขา — บันทึกแล้วมีผลทันที ไม่ต้อง deploy
        </p>
      </div>

      {/* กันสับสนกับ "เวลาทำการมาตรฐาน" ที่หน้าข้อมูลร้าน ซึ่งเป็นแค่ข้อความ
          ที่ AI เอาไปพูด ไม่ได้ควบคุมปฏิทินอะไรเลย */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
        <Info size={15} className="text-blue-600 shrink-0 mt-0.5" />
        <p className="text-[11.5px] text-blue-900 leading-relaxed">
          <b>คนละอันกับ "เวลาทำการมาตรฐาน" ในหน้าข้อมูลร้าน</b> — อันนั้นเป็นข้อความที่ผู้ช่วย AI
          ใช้ตอบลูกค้าเท่านั้น ไม่ได้ควบคุมว่าลูกค้าจองวันไหนได้ ถ้าต้องการปิดไม่ให้จอง ต้องตั้งที่หน้านี้
        </p>
      </div>

      {/* ปิดรับชั่วคราว */}
      <div className={`rounded-2xl border p-5 ${config.temporaryClosed ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-black text-sm text-slate-800 flex items-center gap-2">
              <Power size={16} className={config.temporaryClosed ? 'text-red-500' : 'text-slate-400'} /> ปิดรับชั่วคราว
            </h2>
            <p className="text-[11px] text-slate-500 mt-1">
              เปิดสวิตช์นี้ = ลูกค้าจองนัดใหม่ไม่ได้ทุกวัน จนกว่าจะปิดสวิตช์
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setConfig((p) => ({ ...p, temporaryClosed: !p.temporaryClosed })); setDirty(true); }}
            className={`px-4 py-2 rounded-xl font-bold text-xs shrink-0 transition-colors ${config.temporaryClosed ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {config.temporaryClosed ? 'กำลังปิดรับ' : 'เปิดรับปกติ'}
          </button>
        </div>
        {config.temporaryClosed && (
          <input
            value={config.temporaryClosedMessage}
            onChange={(e) => { setConfig((p) => ({ ...p, temporaryClosedMessage: e.target.value })); setDirty(true); }}
            placeholder="ข้อความที่ลูกค้าจะเห็น เช่น ปิดปรับปรุงร้าน 20-22 ส.ค."
            className="w-full mt-3 px-4 py-2.5 bg-white border border-red-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-400"
          />
        )}
      </div>

      {/* ชั่วโมงเปิด-ปิด */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2 mb-1">
          <Clock size={16} className="text-amber-500" /> ชั่วโมงที่เปิดให้จอง
        </h2>
        <p className="text-[11px] text-slate-500 mb-4">
          รอบเวลาบนหน้า checkout ถูกแบ่งเป็นช่วงละ 2 ชั่วโมงจากค่านี้
        </p>
        <div className="flex gap-4">
          {([['เปิด', 'openHour'], ['ปิด', 'closeHour']] as const).map(([label, key]) => (
            <div key={key} className="flex-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">{label}</label>
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
      </div>

      {/* วันหยุดประจำสัปดาห์ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2 mb-4">
          <CalendarDays size={16} className="text-slate-500" /> วันหยุดประจำสัปดาห์
        </h2>
        <div className="grid grid-cols-7 gap-2">
          {DAY_NAMES.map((name, i) => {
            const closed = config.closedDays.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleClosedDay(i)}
                className={`flex flex-col items-center py-3 rounded-xl border-2 transition-all ${closed ? 'border-red-200 bg-red-50 text-red-500' : 'border-emerald-200 bg-emerald-50 text-emerald-600'}`}
              >
                <span className="text-[10px] font-bold">{name.slice(0, 2)}</span>
                <span className="text-[9px] font-bold mt-1">{closed ? 'ปิด' : 'เปิด'}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 mt-2">กดเพื่อสลับเปิด/ปิดในแต่ละวัน</p>
      </div>

      {/* วันหยุดพิเศษ */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-black text-sm text-slate-800 flex items-center gap-2 mb-4">
          <AlertTriangle size={16} className="text-amber-500" /> วันหยุดพิเศษ
        </h2>
        <div className="flex gap-2 mb-3">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleAddHoliday}
            disabled={!newHoliday}
            className="px-4 py-2.5 bg-slate-900 text-white font-bold text-sm rounded-xl hover:bg-black disabled:opacity-30 transition-all flex items-center gap-1"
          >
            <Plus size={14} /> เพิ่ม
          </button>
        </div>
        {config.holidays.length > 0 ? (
          <div className="space-y-2">
            {config.holidays.map((date) => {
              // ป้ายขึ้นเฉพาะเมื่ออ่านงานสำเร็จ — ไม่มีป้ายจึงแปลว่า "ไม่มีนัด"
              // ไม่ใช่ "ยังไม่รู้"
              const stranded = jobsLoading ? [] : (bookingsByDate.get(date) || []);
              return (
                <div key={date} className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-amber-800">{date}</span>
                    <button
                      type="button"
                      onClick={() => { setConfig((p) => ({ ...p, holidays: p.holidays.filter((h) => h !== date) })); setDirty(true); }}
                      className="p-1 text-amber-500 hover:text-red-500 transition-colors"
                      aria-label={`ลบวันหยุด ${date}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {stranded.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-amber-200">
                      <p className="text-[11px] font-bold text-red-600 flex items-center gap-1">
                        <AlertTriangle size={11} /> มีนัดค้างอยู่ {stranded.length} งาน — ลูกค้ายังถือใบยืนยัน
                      </p>
                      <div className="mt-1.5 space-y-0.5">
                        {stranded.map((r) => (
                          <p key={r.id} className="text-[10px] text-amber-700 font-medium">
                            {r.ref}{r.time ? ` · ${r.time}` : ''}{r.method ? ` · ${r.method}` : ''} · {r.status}
                          </p>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1.5">ติดต่อลูกค้าเพื่อเลื่อนนัด หรือลบวันหยุดนี้ออก</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-3">ยังไม่มีวันหยุดพิเศษ</p>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !dirty}
        className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-md shadow-blue-200 flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        {saving ? 'กำลังบันทึก...' : dirty ? 'บันทึกเวลาทำการ' : 'บันทึกแล้ว'}
      </button>

      {/* ยืนยันก่อนปิดวันที่มีนัดค้าง — รายชื่องานอยู่ในนี้เลยเพื่อให้ตัดสินใจ
          ได้ทันทีว่าจะเลื่อนนัดหรือไม่ปิด ไม่ต้องไปเปิดอีกหน้า */}
      {conflictPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setConflictPrompt(null)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500 shrink-0" />
                วันที่ {conflictPrompt.date} มีนัดอยู่แล้ว {conflictPrompt.rows.length} งาน
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                ปิดวันนี้ไม่ได้ยกเลิกนัดที่จองไว้ ลูกค้ายังถือใบยืนยันและจะมาตามนัด ถ้าจะปิดจริง ต้องติดต่อลูกค้าเพื่อเลื่อนนัดด้วย
              </p>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-2">
              {conflictPrompt.rows.map((r) => (
                <div key={r.id} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs font-bold text-slate-800">{r.ref}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {r.time || 'ไม่ระบุเวลา'}{r.method ? ` · ${r.method}` : ''} · {r.status}
                  </p>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => setConflictPrompt(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => { commitHoliday(conflictPrompt.date); setConflictPrompt(null); }}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-all"
              >
                ปิดวันนี้อยู่ดี
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
