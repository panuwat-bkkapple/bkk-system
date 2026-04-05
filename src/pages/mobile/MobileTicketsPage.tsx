import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Search, Filter, ChevronRight, Phone, MapPin,
  Truck, Store, Mail, Clock, Package, RefreshCw
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'New Lead':           { bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  'New B2B Lead':       { bg: 'bg-indigo-100',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  'Following Up':       { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  'Appointment Set':    { bg: 'bg-cyan-100',     text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  'Waiting Drop-off':   { bg: 'bg-teal-100',     text: 'text-teal-700',    dot: 'bg-teal-500' },
  'Active Leads':       { bg: 'bg-orange-100',   text: 'text-orange-700',  dot: 'bg-orange-500' },
  'Assigned':           { bg: 'bg-violet-100',   text: 'text-violet-700',  dot: 'bg-violet-500' },
  'Arrived':            { bg: 'bg-lime-100',     text: 'text-lime-700',    dot: 'bg-lime-500' },
  'In-Transit':         { bg: 'bg-yellow-100',   text: 'text-yellow-700',  dot: 'bg-yellow-500' },
  'Being Inspected':    { bg: 'bg-purple-100',   text: 'text-purple-700',  dot: 'bg-purple-500' },
  'Pending QC':         { bg: 'bg-pink-100',     text: 'text-pink-700',    dot: 'bg-pink-500' },
  'QC Review':          { bg: 'bg-fuchsia-100',  text: 'text-fuchsia-700', dot: 'bg-fuchsia-500' },
  'Revised Offer':      { bg: 'bg-rose-100',     text: 'text-rose-700',    dot: 'bg-rose-500' },
  'Negotiation':        { bg: 'bg-red-100',      text: 'text-red-700',     dot: 'bg-red-500' },
  'Payout Processing':  { bg: 'bg-emerald-100',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'Paid':               { bg: 'bg-green-100',    text: 'text-green-700',   dot: 'bg-green-500' },
  'PAID':               { bg: 'bg-green-100',    text: 'text-green-700',   dot: 'bg-green-500' },
  'In Stock':           { bg: 'bg-slate-100',    text: 'text-slate-700',   dot: 'bg-slate-500' },
  'Cancelled':          { bg: 'bg-gray-100',     text: 'text-gray-500',    dot: 'bg-gray-400' },
  'Closed (Lost)':      { bg: 'bg-gray-100',     text: 'text-gray-500',    dot: 'bg-gray-400' },
  'Returned':           { bg: 'bg-gray-100',     text: 'text-gray-500',    dot: 'bg-gray-400' },
};

const PHASE_FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'sales', label: 'เปิดงาน' },
  { key: 'logistics', label: 'ดำเนินการ' },
  { key: 'closed', label: 'ปิดงาน' },
];

const SALES_STATUSES = ['New Lead', 'New B2B Lead', 'Following Up', 'Appointment Set', 'Waiting Drop-off'];
const LOGISTICS_STATUSES = ['Active Leads', 'Assigned', 'Arrived', 'In-Transit', 'Being Inspected', 'Pending QC', 'QC Review', 'Revised Offer', 'Negotiation', 'Payout Processing', 'Waiting for Handover'];
const CLOSED_STATUSES = ['Paid', 'PAID', 'Sent to QC Lab', 'In Stock', 'Ready to Sell', 'Cancelled', 'Closed (Lost)', 'Returned', 'Completed', 'Sold'];

const METHOD_ICONS: Record<string, React.ReactNode> = {
  'Pickup':   <Truck size={12} />,
  'Store-in': <Store size={12} />,
  'Mail-in':  <Mail size={12} />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MobileTicketsPage = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [phase, setPhase] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const jobsRef = ref(db, 'jobs');
    const unsub = onValue(jobsRef, (snap) => {
      if (!snap.exists()) { setJobs([]); setLoading(false); return; }
      const list: any[] = [];
      snap.forEach((child) => {
        list.push({ id: child.key, ...child.val() });
      });
      list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      setJobs(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = jobs;

    // Phase filter
    if (phase === 'sales') list = list.filter((j) => SALES_STATUSES.includes(j.status));
    else if (phase === 'logistics') list = list.filter((j) => LOGISTICS_STATUSES.includes(j.status));
    else if (phase === 'closed') list = list.filter((j) => CLOSED_STATUSES.includes(j.status));

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((j) =>
        (j.model || '').toLowerCase().includes(q) ||
        (j.ref_no || '').toLowerCase().includes(q) ||
        (j.cust_name || '').toLowerCase().includes(q) ||
        (j.cust_phone || '').includes(q)
      );
    }

    return list;
  }, [jobs, phase, search]);

  // Phase counts
  const phaseCounts = useMemo(() => ({
    all: jobs.length,
    sales: jobs.filter((j) => SALES_STATUSES.includes(j.status)).length,
    logistics: jobs.filter((j) => LOGISTICS_STATUSES.includes(j.status)).length,
    closed: jobs.filter((j) => CLOSED_STATUSES.includes(j.status)).length,
  }), [jobs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search + Filter Bar */}
      <div className="px-4 pt-3 pb-2 bg-white border-b border-slate-100 shrink-0 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหารุ่น, ชื่อลูกค้า, เบอร์..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2.5 rounded-xl border transition-colors ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-slate-200 text-slate-400'}`}
          >
            <Filter size={18} />
          </button>
        </div>

        {/* Phase filter pills */}
        {showFilters && (
          <div className="flex gap-1.5 pb-1 overflow-x-auto">
            {PHASE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setPhase(f.key)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  phase === f.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {f.label} ({phaseCounts[f.key as keyof typeof phaseCounts]})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Job Count */}
      <div className="px-4 py-2 shrink-0">
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          {filtered.length} งาน
        </p>
      </div>

      {/* Job List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <Package size={40} className="text-slate-200" />
            <p className="text-sm font-bold">ไม่พบงาน</p>
          </div>
        ) : (
          filtered.map((job) => (
            <JobCard key={job.id} job={job} onClick={() => navigate(`/mobile/job/${job.id}`)} />
          ))
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Job Card
// ---------------------------------------------------------------------------

const JobCard = ({ job, onClick }: { job: any; onClick: () => void }) => {
  const sc = STATUS_COLORS[job.status] || { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };
  const isNew = job.status === 'New Lead' || job.status === 'New B2B Lead';
  const isB2B = job.type === 'B2B Trade-in' || job.status === 'New B2B Lead';
  const price = job.final_price || job.price;

  return (
    <button
      onClick={onClick}
      className={`w-full bg-white rounded-xl border p-3.5 text-left transition-all active:scale-[0.98] ${
        isNew ? 'border-blue-300 shadow-md shadow-blue-100' : 'border-slate-100 shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Row 1: Model + Price */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {isNew && <span className="shrink-0 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
                {isB2B && <span className="text-[9px] font-black bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full shrink-0">B2B</span>}
                <span className="text-sm font-black text-slate-800 truncate">{job.model || 'ไม่ระบุรุ่น'}</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {job.ref_no || `#${(job.id || '').slice(-6)}`}
              </p>
            </div>
            {price && (
              <span className="text-sm font-black text-emerald-600 shrink-0">
                ฿{Number(price).toLocaleString()}
              </span>
            )}
          </div>

          {/* Row 2: Customer */}
          <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
            {job.cust_name && <span className="truncate">{job.cust_name}</span>}
            {job.cust_phone && (
              <span className="flex items-center gap-0.5 shrink-0">
                <Phone size={10} /> {job.cust_phone}
              </span>
            )}
          </div>

          {/* Row 3: Status + Method + Time */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${sc.bg} ${sc.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {job.status}
            </span>

            {job.receive_method && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">
                {METHOD_ICONS[job.receive_method]}
                {job.receive_method}
              </span>
            )}

            {job.agent_name && (
              <span className="text-[10px] text-slate-400 truncate">
                👤 {job.agent_name}
              </span>
            )}

            <span className="text-[10px] text-slate-300 ml-auto shrink-0 flex items-center gap-0.5">
              <Clock size={10} />
              {formatTimeAgo(job.created_at)}
            </span>
          </div>
        </div>

        <ChevronRight size={18} className="text-slate-300 shrink-0 mt-2" />
      </div>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return 'ตอนนี้';
  if (min < 60) return `${min}m`;
  if (hr < 24) return `${hr}h`;
  if (day < 7) return `${day}d`;
  return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
