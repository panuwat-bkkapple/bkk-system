import { useState, useMemo, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Clock, Phone, User,
  X, Edit3, Trash2, CalendarDays, CheckCircle2, XCircle, AlertCircle
} from 'lucide-react';
import { ref, push, update, remove } from 'firebase/database';
import { db } from '../../api/firebase';
import { useDatabase } from '../../hooks/useDatabase';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/ToastProvider';
import { AppointmentType, AppointmentStatus } from '../../types/domain';
import type { Appointment } from '../../types/domain';

// ==========================================
// Constants
// ==========================================

const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const TYPE_CONFIG: Record<AppointmentType, { label: string; color: string; bg: string }> = {
  [AppointmentType.TRADE_IN]: { label: 'Trade-In', color: 'text-blue-700', bg: 'bg-blue-100' },
  [AppointmentType.PICKUP]: { label: 'รับสินค้า', color: 'text-orange-700', bg: 'bg-orange-100' },
  [AppointmentType.DELIVERY]: { label: 'ส่งสินค้า', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  [AppointmentType.CONSULTATION]: { label: 'ปรึกษา', color: 'text-purple-700', bg: 'bg-purple-100' },
  [AppointmentType.OTHER]: { label: 'อื่นๆ', color: 'text-gray-700', bg: 'bg-gray-100' },
};

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  [AppointmentStatus.SCHEDULED]: { label: 'นัดหมายแล้ว', color: 'text-blue-600', bg: 'bg-blue-50', icon: <Clock size={14} /> },
  [AppointmentStatus.CONFIRMED]: { label: 'ยืนยันแล้ว', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <CheckCircle2 size={14} /> },
  [AppointmentStatus.COMPLETED]: { label: 'เสร็จสิ้น', color: 'text-gray-500', bg: 'bg-gray-50', icon: <CheckCircle2 size={14} /> },
  [AppointmentStatus.CANCELLED]: { label: 'ยกเลิก', color: 'text-red-500', bg: 'bg-red-50', icon: <XCircle size={14} /> },
  [AppointmentStatus.NO_SHOW]: { label: 'ไม่มา', color: 'text-amber-600', bg: 'bg-amber-50', icon: <AlertCircle size={14} /> },
};

// ==========================================
// Helpers
// ==========================================

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatThaiDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS_TH[m - 1]} ${y + 543}`;
}

// ==========================================
// Form Modal
// ==========================================

interface AppointmentFormProps {
  appointment?: Appointment | null;
  initialDate?: string;
  onSave: (data: Omit<Appointment, 'id' | 'created_at' | 'created_by'>) => void;
  onClose: () => void;
}

const AppointmentForm = ({ appointment, initialDate, onSave, onClose }: AppointmentFormProps) => {
  const [title, setTitle] = useState(appointment?.title || '');
  const [customerName, setCustomerName] = useState(appointment?.customer_name || '');
  const [customerPhone, setCustomerPhone] = useState(appointment?.customer_phone || '');
  const [date, setDate] = useState(appointment?.date || initialDate || '');
  const [time, setTime] = useState(appointment?.time || '10:00');
  const [endTime, setEndTime] = useState(appointment?.end_time || '');
  const [type, setType] = useState<AppointmentType>(appointment?.type || AppointmentType.TRADE_IN);
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status || AppointmentStatus.SCHEDULED);
  const [notes, setNotes] = useState(appointment?.notes || '');
  const [assignedTo, setAssignedTo] = useState(appointment?.assigned_to || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !customerName.trim() || !date || !time) return;
    onSave({
      title: title.trim(),
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim() || undefined,
      date,
      time,
      end_time: endTime || undefined,
      type,
      status,
      notes: notes.trim() || undefined,
      assigned_to: assignedTo.trim() || undefined,
      updated_at: Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Drag handle on mobile */}
        <div className="flex justify-center pt-2 sm:hidden">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b">
          <h2 className="font-black text-base sm:text-lg">{appointment ? 'แก้ไขนัดหมาย' : 'สร้างนัดหมายใหม่'}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">หัวข้อนัดหมาย *</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)} required
              placeholder="เช่น นัดรับ iPhone 15 Pro Max"
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">ชื่อลูกค้า *</label>
              <input
                type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} required
                placeholder="ชื่อลูกค้า"
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">เบอร์โทร</label>
              <input
                type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                placeholder="0xx-xxx-xxxx"
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">วันที่ *</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)} required
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">เวลาเริ่ม *</label>
              <input
                type="time" value={time} onChange={e => setTime(e.target.value)} required
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">เวลาสิ้นสุด</label>
              <input
                type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Type & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">ประเภท</label>
              <select value={type} onChange={e => setType(e.target.value as AppointmentType)}
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                {Object.values(AppointmentType).map(t => (
                  <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">สถานะ</label>
              <select value={status} onChange={e => setStatus(e.target.value as AppointmentStatus)}
                className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
                {Object.values(AppointmentStatus).map(s => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Assigned To */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">พนักงานรับผิดชอบ</label>
            <input
              type="text" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              placeholder="ชื่อพนักงาน"
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">หมายเหตุ</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="รายละเอียดเพิ่มเติม..."
              className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border rounded-xl font-bold text-sm text-gray-500 hover:bg-gray-50 transition-colors">
              ยกเลิก
            </button>
            <button type="submit"
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100">
              {appointment ? 'บันทึก' : 'สร้างนัดหมาย'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==========================================
// Appointment Card
// ==========================================

const AppointmentCard = ({ appt, onEdit, onDelete, onStatusChange }: {
  appt: Appointment;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: AppointmentStatus) => void;
}) => {
  const typeConf = TYPE_CONFIG[appt.type] || TYPE_CONFIG[AppointmentType.OTHER];
  const statusConf = STATUS_CONFIG[appt.status] || STATUS_CONFIG[AppointmentStatus.SCHEDULED];

  return (
    <div className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${typeConf.bg} ${typeConf.color}`}>
              {typeConf.label}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${statusConf.bg} ${statusConf.color}`}>
              {statusConf.icon} {statusConf.label}
            </span>
          </div>
          <h4 className="font-bold text-sm mt-1.5 truncate">{appt.title}</h4>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-blue-600">
            <Edit3 size={14} />
          </button>
          <button onClick={onDelete} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-gray-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1"><Clock size={12} /> {appt.time}{appt.end_time ? ` - ${appt.end_time}` : ''}</span>
        <span className="flex items-center gap-1"><User size={12} /> {appt.customer_name}</span>
        {appt.customer_phone && <span className="flex items-center gap-1"><Phone size={12} /> {appt.customer_phone}</span>}
      </div>

      {appt.notes && <p className="text-xs text-gray-400 line-clamp-2">{appt.notes}</p>}

      {/* Quick status actions */}
      {appt.status !== AppointmentStatus.COMPLETED && appt.status !== AppointmentStatus.CANCELLED && (
        <div className="flex gap-1.5 pt-1">
          {appt.status === AppointmentStatus.SCHEDULED && (
            <button onClick={() => onStatusChange(AppointmentStatus.CONFIRMED)}
              className="text-[10px] font-bold px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors">
              ยืนยัน
            </button>
          )}
          <button onClick={() => onStatusChange(AppointmentStatus.COMPLETED)}
            className="text-[10px] font-bold px-2.5 py-1 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors">
            เสร็จสิ้น
          </button>
          <button onClick={() => onStatusChange(AppointmentStatus.NO_SHOW)}
            className="text-[10px] font-bold px-2.5 py-1 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors">
            ไม่มา
          </button>
          <button onClick={() => onStatusChange(AppointmentStatus.CANCELLED)}
            className="text-[10px] font-bold px-2.5 py-1 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors">
            ยกเลิก
          </button>
        </div>
      )}
    </div>
  );
};

// ==========================================
// Main Component
// ==========================================

export const AppointmentCalendar = () => {
  const { data: appointments, loading } = useDatabase('appointments');
  const { currentUser } = useAuth();
  const toast = useToast();

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [view, setView] = useState<'month' | 'list'>('month');

  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // Group appointments by date
  const appointmentsByDate = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    appointments.forEach((appt: Appointment) => {
      if (!appt.date) return;
      if (!map[appt.date]) map[appt.date] = [];
      map[appt.date].push(appt);
    });
    // Sort each day's appointments by time
    Object.values(map).forEach(list => list.sort((a, b) => a.time.localeCompare(b.time)));
    return map;
  }, [appointments]);

  // Stats
  const stats = useMemo(() => {
    const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    const monthAppts = appointments.filter((a: Appointment) => a.date?.startsWith(monthStr));
    return {
      total: monthAppts.length,
      scheduled: monthAppts.filter((a: Appointment) => a.status === AppointmentStatus.SCHEDULED).length,
      confirmed: monthAppts.filter((a: Appointment) => a.status === AppointmentStatus.CONFIRMED).length,
      completed: monthAppts.filter((a: Appointment) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: monthAppts.filter((a: Appointment) => a.status === AppointmentStatus.CANCELLED || a.status === AppointmentStatus.NO_SHOW).length,
    };
  }, [appointments, viewYear, viewMonth]);

  // Calendar grid
  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
    const prevMonthDays = getDaysInMonth(viewYear, viewMonth - 1);

    const days: { day: number; month: 'prev' | 'current' | 'next'; dateStr: string }[] = [];

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      days.push({ day: d, month: 'prev', dateStr: toDateStr(y, m, d) });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: 'current', dateStr: toDateStr(viewYear, viewMonth, d) });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      days.push({ day: d, month: 'next', dateStr: toDateStr(y, m, d) });
    }

    return days;
  }, [viewYear, viewMonth]);

  // Navigation
  const goToPrevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDate(todayStr);
  };

  // CRUD
  const handleSave = useCallback(async (data: Omit<Appointment, 'id' | 'created_at' | 'created_by'>) => {
    try {
      if (editingAppointment) {
        await update(ref(db, `appointments/${editingAppointment.id}`), data);
        toast.success('อัปเดตนัดหมายเรียบร้อย');
      } else {
        await push(ref(db, 'appointments'), {
          ...data,
          created_by: currentUser?.name || 'Admin',
          created_at: Date.now(),
        });
        toast.success('สร้างนัดหมายเรียบร้อย');
      }
      setFormOpen(false);
      setEditingAppointment(null);
    } catch {
      toast.error('เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
  }, [editingAppointment, currentUser, toast]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('ต้องการลบนัดหมายนี้หรือไม่?')) return;
    try {
      await remove(ref(db, `appointments/${id}`));
      toast.success('ลบนัดหมายเรียบร้อย');
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    }
  }, [toast]);

  const handleStatusChange = useCallback(async (id: string, status: AppointmentStatus) => {
    try {
      await update(ref(db, `appointments/${id}`), { status, updated_at: Date.now() });
      toast.success(`เปลี่ยนสถานะเป็น "${STATUS_CONFIG[status].label}" แล้ว`);
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    }
  }, [toast]);

  // Selected date appointments
  const selectedAppointments = selectedDate ? (appointmentsByDate[selectedDate] || []) : [];

  // Upcoming list (for list view)
  const upcomingAppointments = useMemo(() => {
    return [...appointments]
      .filter((a: Appointment) => a.date >= todayStr && a.status !== AppointmentStatus.CANCELLED)
      .sort((a: Appointment, b: Appointment) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date))
      .slice(0, 50);
  }, [appointments, todayStr]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 font-bold animate-pulse">Loading Calendar...</div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] mx-auto space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg sm:text-2xl font-black text-slate-800 flex items-center gap-2">
            <CalendarDays className="text-blue-600" size={24} /> ปฏิทินนัดหมาย
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-0.5">จัดการนัดหมายจากลูกค้าทุกช่องทาง</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-xl p-1">
            <button onClick={() => setView('month')}
              className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${view === 'month' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>
              ปฏิทิน
            </button>
            <button onClick={() => setView('list')}
              className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${view === 'list' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>
              รายการ
            </button>
          </div>
          <button onClick={() => { setEditingAppointment(null); setFormOpen(true); }}
            className="flex items-center gap-1.5 sm:gap-2 bg-blue-600 text-white px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl font-bold text-xs sm:text-sm hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100">
            <Plus size={16} /> <span className="hidden sm:inline">สร้าง</span>นัดหมาย
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: 'ทั้งหมด', value: stats.total, color: 'text-slate-800', bg: 'bg-white' },
          { label: 'รอดำเนินการ', value: stats.scheduled, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'ยืนยันแล้ว', value: stats.confirmed, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'เสร็จสิ้น', value: stats.completed, color: 'text-gray-500', bg: 'bg-gray-50' },
          { label: 'ยกเลิก/ไม่มา', value: stats.cancelled, color: 'text-red-500', bg: 'bg-red-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl border p-2.5 sm:p-4`}>
            <div className={`text-lg sm:text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[10px] sm:text-xs font-bold text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {view === 'month' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid */}
          <div className="lg:col-span-2 bg-white rounded-2xl border shadow-sm">
            {/* Month Navigation */}
            <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b">
              <button onClick={goToPrevMonth} className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <ChevronLeft size={20} />
              </button>
              <div className="text-center">
                <h2 className="font-black text-sm sm:text-lg">{MONTHS_TH[viewMonth]} {viewYear + 543}</h2>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button onClick={goToToday}
                  className="text-[10px] sm:text-xs font-bold px-2 sm:px-3 py-1 sm:py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
                  วันนี้
                </button>
                <button onClick={goToNextMonth} className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-xl transition-colors">
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 border-b">
              {DAYS_TH.map((d, i) => (
                <div key={d} className={`text-center py-2 text-[10px] sm:text-xs font-black ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Day Cells */}
            <div className="grid grid-cols-7">
              {calendarDays.map((cell, idx) => {
                const dayAppts = appointmentsByDate[cell.dateStr] || [];
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDate;
                const isCurrentMonth = cell.month === 'current';

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDate(cell.dateStr)}
                    className={`relative min-h-[48px] sm:min-h-[80px] p-1 sm:p-1.5 border-b border-r text-left transition-colors
                      ${isCurrentMonth ? '' : 'opacity-30'}
                      ${isSelected ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset' : 'hover:bg-gray-50'}
                    `}
                  >
                    <span className={`inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 text-[10px] sm:text-xs font-bold rounded-full
                      ${isToday ? 'bg-blue-600 text-white' : ''}
                      ${!isToday && idx % 7 === 0 ? 'text-red-400' : ''}
                      ${!isToday && idx % 7 === 6 ? 'text-blue-400' : ''}
                    `}>
                      {cell.day}
                    </span>

                    {/* Appointment indicators - dots on mobile, labels on desktop */}
                    {dayAppts.length > 0 && (
                      <>
                        {/* Mobile: colored dots */}
                        <div className="flex gap-0.5 mt-0.5 flex-wrap sm:hidden">
                          {dayAppts.slice(0, 3).map(a => {
                            const tc = TYPE_CONFIG[a.type] || TYPE_CONFIG[AppointmentType.OTHER];
                            return <div key={a.id} className={`w-1.5 h-1.5 rounded-full ${tc.bg.replace('100', '500')}`} />;
                          })}
                          {dayAppts.length > 3 && <span className="text-[8px] text-gray-400">+{dayAppts.length - 3}</span>}
                        </div>
                        {/* Desktop: text labels */}
                        <div className="mt-0.5 space-y-0.5 hidden sm:block">
                          {dayAppts.slice(0, 3).map(a => {
                            const tc = TYPE_CONFIG[a.type] || TYPE_CONFIG[AppointmentType.OTHER];
                            return (
                              <div key={a.id} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tc.bg} ${tc.color} truncate`}>
                                {a.time} {a.title}
                              </div>
                            );
                          })}
                          {dayAppts.length > 3 && (
                            <div className="text-[9px] font-bold text-gray-400 px-1.5">+{dayAppts.length - 3} อื่นๆ</div>
                          )}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day Detail Panel - side panel on desktop, bottom sheet on mobile */}
          <div className={`bg-white rounded-2xl border shadow-sm flex flex-col
            ${selectedDate ? 'fixed inset-x-0 bottom-0 z-30 rounded-b-none max-h-[60vh] lg:static lg:max-h-none lg:rounded-2xl lg:z-auto' : 'hidden lg:flex'}
          `}>
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-black text-sm">
                  {selectedDate ? formatThaiDate(selectedDate) : 'เลือกวันที่'}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedAppointments.length} นัดหมาย
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedDate && (
                  <button
                    onClick={() => { setEditingAppointment(null); setFormOpen(true); }}
                    className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                    title="เพิ่มนัดหมาย"
                  >
                    <Plus size={16} />
                  </button>
                )}
                {/* Close button on mobile */}
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="p-2 hover:bg-gray-100 rounded-xl transition-colors lg:hidden"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Drag handle on mobile */}
            <div className="flex justify-center py-1.5 lg:hidden">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
              {!selectedDate ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-300">
                  <CalendarDays size={48} />
                  <p className="text-sm font-bold mt-3">กดเลือกวันที่บนปฏิทิน</p>
                </div>
              ) : selectedAppointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 sm:h-40 text-gray-300">
                  <CalendarDays size={36} />
                  <p className="text-xs font-bold mt-2">ไม่มีนัดหมายในวันนี้</p>
                </div>
              ) : (
                selectedAppointments.map(appt => (
                  <AppointmentCard
                    key={appt.id}
                    appt={appt}
                    onEdit={() => { setEditingAppointment(appt); setFormOpen(true); }}
                    onDelete={() => handleDelete(appt.id)}
                    onStatusChange={(status) => handleStatusChange(appt.id, status)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Mobile backdrop when bottom sheet is open */}
          {selectedDate && (
            <div className="fixed inset-0 bg-black/20 z-20 lg:hidden" onClick={() => setSelectedDate(null)} />
          )}
        </div>
      ) : (
        /* List View */
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="px-6 py-4 border-b">
            <h3 className="font-black text-sm">นัดหมายที่กำลังจะมาถึง</h3>
            <p className="text-xs text-gray-400 mt-0.5">{upcomingAppointments.length} รายการ</p>
          </div>
          <div className="p-4 space-y-3">
            {upcomingAppointments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                <CalendarDays size={36} />
                <p className="text-xs font-bold mt-2">ยังไม่มีนัดหมาย</p>
              </div>
            ) : (
              upcomingAppointments.map((appt: Appointment) => (
                <div key={appt.id} className="flex items-start gap-4">
                  <div className="text-center shrink-0 w-14">
                    <div className="text-lg font-black text-slate-800">{appt.date.split('-')[2]}</div>
                    <div className="text-[10px] font-bold text-gray-400">
                      {MONTHS_TH[parseInt(appt.date.split('-')[1]) - 1]?.slice(0, 3)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <AppointmentCard
                      appt={appt}
                      onEdit={() => { setEditingAppointment(appt); setFormOpen(true); }}
                      onDelete={() => handleDelete(appt.id)}
                      onStatusChange={(status) => handleStatusChange(appt.id, status)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Form Modal */}
      {formOpen && (
        <AppointmentForm
          appointment={editingAppointment}
          initialDate={selectedDate || todayStr}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditingAppointment(null); }}
        />
      )}
    </div>
  );
};

export default AppointmentCalendar;
