import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Plus, Clock, Phone, User,
  X, Edit3, Trash2, CalendarDays, CheckCircle2, XCircle, AlertCircle,
  Zap, Smartphone, Filter
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

function timestampToDateStr(ts: number) {
  const d = new Date(ts);
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function timestampToTimeStr(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Unified calendar entry
interface CalendarEntry {
  id: string;
  title: string;
  customer_name: string;
  customer_phone?: string;
  date: string;
  time: string;
  source: 'job' | 'appointment';
  // Job-specific
  jobId?: string;
  jobStatus?: string;
  price?: number;
  receive_method?: string;
  pickupType?: 'instant' | 'scheduled' | null;
  ref_no?: string;
  // Appointment-specific
  type?: AppointmentType;
  status?: AppointmentStatus;
  notes?: string;
}

const JOB_STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  'New Lead': { color: 'text-blue-700', bg: 'bg-blue-100' },
  'Active Leads': { color: 'text-emerald-700', bg: 'bg-emerald-100' },
  'New B2B Lead': { color: 'text-purple-700', bg: 'bg-purple-100' },
  'Following Up': { color: 'text-amber-700', bg: 'bg-amber-100' },
  'Appointment Set': { color: 'text-indigo-700', bg: 'bg-indigo-100' },
  'In-Transit': { color: 'text-orange-700', bg: 'bg-orange-100' },
  'Pending QC': { color: 'text-yellow-700', bg: 'bg-yellow-100' },
  'Cancelled': { color: 'text-red-700', bg: 'bg-red-100' },
  'Closed (Lost)': { color: 'text-red-700', bg: 'bg-red-100' },
};

// ==========================================
// Job Card (for jobs on calendar)
// ==========================================

const JobCard = ({ entry, onClick }: { entry: CalendarEntry; onClick?: () => void }) => {
  const statusColors = JOB_STATUS_COLORS[entry.jobStatus || ''] || { color: 'text-gray-700', bg: 'bg-gray-100' };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full text-left bg-white rounded-xl border shadow-sm p-3 sm:p-4 space-y-1.5 enabled:hover:shadow-md enabled:hover:border-blue-300 enabled:active:scale-[0.99] transition disabled:cursor-default"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {entry.pickupType === 'instant' ? (
              <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                <Zap size={10} /> ขายด่วน
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                <CalendarDays size={10} /> นัดล่วงหน้า
              </span>
            )}
            {entry.jobStatus && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors.bg} ${statusColors.color}`}>
                {entry.jobStatus}
              </span>
            )}
          </div>
          <h4 className="font-bold text-sm mt-1.5 truncate">{entry.title}</h4>
          {entry.ref_no && <p className="text-[10px] text-gray-400 font-mono">{entry.ref_no}</p>}
        </div>
        {entry.price != null && entry.price > 0 && (
          <span className="text-sm font-black text-emerald-600 shrink-0">
            ฿{entry.price.toLocaleString()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 sm:gap-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1">
          <Clock size={12} /> {entry.time}
          {entry.pickupType === 'instant' && <span className="text-orange-500 font-bold">(+1-2 ชม.)</span>}
        </span>
        <span className="flex items-center gap-1"><User size={12} /> {entry.customer_name}</span>
        {entry.customer_phone && <span className="flex items-center gap-1"><Phone size={12} /> {entry.customer_phone}</span>}
        {entry.receive_method && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 rounded">{entry.receive_method}</span>}
      </div>
    </button>
  );
};

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
  const { data: appointments, loading: loadingAppts } = useDatabase('appointments');
  const { data: jobs, loading: loadingJobs } = useDatabase('jobs');
  const { currentUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = location.pathname.startsWith('/mobile');
  const loading = loadingAppts || loadingJobs;

  const openJob = useCallback((jobId?: string) => {
    if (!jobId) return;
    navigate(isMobile ? `/mobile/job/${jobId}` : `/workspace/${jobId}`);
  }, [navigate, isMobile]);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'jobs' | 'appointments'>('all');

  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // Convert jobs to calendar entries
  const jobEntries = useMemo<CalendarEntry[]>(() => {
    return jobs
      .filter((j: any) => j.created_at && j.receive_method === 'Pickup')
      .map((j: any) => {
        const ps = j.pickup_schedule;
        const isInstant = ps?.type?.toLowerCase() === 'instant';
        const isScheduled = ps && !isInstant && ps.date && ps.date !== 'Instant';

        // Determine date: scheduled uses pickup_schedule.date, instant uses created_at
        let entryDate: string;
        let entryTime: string;

        if (isScheduled) {
          // Parse scheduled date (could be ISO string)
          const parsed = new Date(ps.date);
          entryDate = !isNaN(parsed.getTime()) ? timestampToDateStr(parsed.getTime()) : timestampToDateStr(j.created_at);
          entryTime = ps.time || timestampToTimeStr(j.created_at);
        } else {
          entryDate = timestampToDateStr(j.created_at);
          entryTime = timestampToTimeStr(j.created_at);
        }

        return {
          id: `job_${j.id}`,
          jobId: j.id,
          title: j.model || 'ไม่ระบุรุ่น',
          customer_name: j.cust_name || 'ไม่ระบุชื่อ',
          customer_phone: j.cust_phone,
          date: entryDate,
          time: entryTime,
          source: 'job' as const,
          jobStatus: j.status,
          price: j.price ? Number(j.price) : undefined,
          receive_method: j.receive_method,
          pickupType: isInstant ? 'instant' : isScheduled ? 'scheduled' : null,
          ref_no: j.ref_no,
        };
      });
  }, [jobs]);

  // Convert manual appointments to calendar entries
  const appointmentEntries = useMemo<CalendarEntry[]>(() => {
    return appointments
      .filter((a: Appointment) => a.date)
      .map((a: Appointment) => ({
        id: a.id,
        title: a.title,
        customer_name: a.customer_name,
        customer_phone: a.customer_phone,
        date: a.date,
        time: a.time,
        source: 'appointment' as const,
        type: a.type,
        status: a.status,
        notes: a.notes,
      }));
  }, [appointments]);

  // Merge all entries
  const allEntries = useMemo(() => {
    if (sourceFilter === 'jobs') return jobEntries;
    if (sourceFilter === 'appointments') return appointmentEntries;
    return [...jobEntries, ...appointmentEntries];
  }, [jobEntries, appointmentEntries, sourceFilter]);

  // Group entries by date
  const entriesByDate = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    allEntries.forEach(entry => {
      if (!map[entry.date]) map[entry.date] = [];
      map[entry.date].push(entry);
    });
    Object.values(map).forEach(list => list.sort((a, b) => a.time.localeCompare(b.time)));
    return map;
  }, [allEntries]);

  // Stats
  const stats = useMemo(() => {
    const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    const monthEntries = allEntries.filter(e => e.date?.startsWith(monthStr));
    const monthJobs = monthEntries.filter(e => e.source === 'job');
    return {
      total: monthEntries.length,
      instant: monthJobs.filter(e => e.pickupType === 'instant').length,
      scheduled: monthJobs.filter(e => e.pickupType === 'scheduled').length,
      manualAppts: monthEntries.filter(e => e.source === 'appointment').length,
      cancelled: monthJobs.filter(e => ['Cancelled', 'Closed (Lost)'].includes(e.jobStatus || '')).length,
    };
  }, [allEntries, viewYear, viewMonth]);

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

  // Selected date entries
  const selectedEntries = selectedDate ? (entriesByDate[selectedDate] || []) : [];

  // Upcoming list (for list view)
  const upcomingEntries = useMemo(() => {
    return [...allEntries]
      .filter(e => e.date >= todayStr && !['Cancelled', 'Closed (Lost)'].includes(e.jobStatus || ''))
      .sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date))
      .slice(0, 50);
  }, [allEntries, todayStr]);

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
          { label: 'ขายด่วน', value: stats.instant, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'นัดล่วงหน้า', value: stats.scheduled, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'นัดหมายเอง', value: stats.manualAppts, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'ยกเลิก', value: stats.cancelled, color: 'text-red-500', bg: 'bg-red-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl border p-2.5 sm:p-4`}>
            <div className={`text-lg sm:text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[10px] sm:text-xs font-bold text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Source Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={14} className="text-gray-400" />
        {[
          { key: 'all' as const, label: 'ทั้งหมด' },
          { key: 'jobs' as const, label: 'งานจากหน้าบ้าน' },
          { key: 'appointments' as const, label: 'นัดหมายเอง' },
        ].map(f => (
          <button key={f.key} onClick={() => setSourceFilter(f.key)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${sourceFilter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {f.label}
          </button>
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
                const dayEntries = entriesByDate[cell.dateStr] || [];
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

                    {/* Entry indicators */}
                    {dayEntries.length > 0 && (
                      <>
                        {/* Mobile: colored dots */}
                        <div className="flex items-center gap-0.5 mt-0.5 flex-wrap sm:hidden">
                          {dayEntries.slice(0, 3).map(e => (
                            <div key={e.id} className={`w-1.5 h-1.5 rounded-full ${e.pickupType === 'instant' ? 'bg-orange-500' : e.pickupType === 'scheduled' ? 'bg-blue-500' : 'bg-purple-500'}`} />
                          ))}
                          {dayEntries.length > 3 && <span className="text-[8px] text-gray-400">+{dayEntries.length - 3}</span>}
                        </div>
                        {/* Desktop: text labels */}
                        <div className="mt-0.5 space-y-0.5 hidden sm:block">
                          {dayEntries.slice(0, 3).map(e => {
                            const colors = e.source === 'job'
                              ? (e.pickupType === 'instant' ? { bg: 'bg-orange-100', color: 'text-orange-700' } : { bg: 'bg-blue-100', color: 'text-blue-700' })
                              : { bg: 'bg-purple-100', color: 'text-purple-700' };
                            return (
                              <div key={e.id} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${colors.bg} ${colors.color} truncate`}>
                                {e.time} {e.title}
                              </div>
                            );
                          })}
                          {dayEntries.length > 3 && (
                            <div className="text-[9px] font-bold text-gray-400 px-1.5">+{dayEntries.length - 3} อื่นๆ</div>
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
                  {selectedEntries.length} รายการ
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
              ) : selectedEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 sm:h-40 text-gray-300">
                  <CalendarDays size={36} />
                  <p className="text-xs font-bold mt-2">ไม่มีรายการในวันนี้</p>
                </div>
              ) : (
                selectedEntries.map(entry =>
                  entry.source === 'appointment' ? (
                    <AppointmentCard
                      key={entry.id}
                      appt={appointments.find((a: Appointment) => a.id === entry.id)!}
                      onEdit={() => { setEditingAppointment(appointments.find((a: Appointment) => a.id === entry.id)!); setFormOpen(true); }}
                      onDelete={() => handleDelete(entry.id)}
                      onStatusChange={(s) => handleStatusChange(entry.id, s)}
                    />
                  ) : (
                    <JobCard key={entry.id} entry={entry} onClick={() => openJob(entry.jobId)} />
                  )
                )
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
            <h3 className="font-black text-sm">รายการที่กำลังจะมาถึง</h3>
            <p className="text-xs text-gray-400 mt-0.5">{upcomingEntries.length} รายการ</p>
          </div>
          <div className="p-4 space-y-3">
            {upcomingEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                <CalendarDays size={36} />
                <p className="text-xs font-bold mt-2">ยังไม่มีรายการ</p>
              </div>
            ) : (
              upcomingEntries.map(entry => (
                <div key={entry.id} className="flex items-start gap-4">
                  <div className="text-center shrink-0 w-14">
                    <div className="text-lg font-black text-slate-800">{entry.date.split('-')[2]}</div>
                    <div className="text-[10px] font-bold text-gray-400">
                      {MONTHS_TH[parseInt(entry.date.split('-')[1]) - 1]?.slice(0, 3)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {entry.source === 'appointment' ? (
                      <AppointmentCard
                        appt={appointments.find((a: Appointment) => a.id === entry.id)!}
                        onEdit={() => { setEditingAppointment(appointments.find((a: Appointment) => a.id === entry.id)!); setFormOpen(true); }}
                        onDelete={() => handleDelete(entry.id)}
                        onStatusChange={(s) => handleStatusChange(entry.id, s)}
                      />
                    ) : (
                      <JobCard entry={entry} onClick={() => openJob(entry.jobId)} />
                    )}
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
