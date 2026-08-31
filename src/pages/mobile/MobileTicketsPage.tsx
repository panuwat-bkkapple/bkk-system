import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import { normalizeQcLogs } from '../../utils/jobNormalizer';
import {
  Search, Filter, ChevronRight, Phone, MapPin,
  Truck, Store, Mail, Clock, Package, RefreshCw, History
} from 'lucide-react';
import { CustomerTimelineModal } from '../../components/customer/CustomerTimelineModal';
import { isAwaitingOffer } from '../../utils/offerRequest';
import { isOfferAwaitingDecision } from '../../utils/customerOffer';
import { isRecededStatus } from '../../types/job-statuses';
import { jobListPhaseOf } from '../../utils/jobListPhase';
// Per-status chip colors live in utils/statusColors.ts, shared with the
// desktop StatusBadge — edit them there, not here.
import { statusChipColors } from '../../utils/statusColors';

const PHASE_FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'sales', label: 'เปิดงาน' },
  { key: 'logistics', label: 'ดำเนินการ' },
  { key: 'closed', label: 'ปิดงาน' },
];

// Tab classification is shared with the desktop dashboard via
// jobListPhaseOf (utils/jobListPhase.ts) — the two pages used to keep
// separate hand-written status arrays and drifted. 'New B2B Lead' is the
// one B2B status this page has always shown under เปิดงาน; the B2C
// classifier does not know B2B statuses, so it stays a special case here.
const listPhaseOf = (job: { status?: string | null; receive_method?: string | null }) =>
  job.status === 'New B2B Lead' ? 'sales' : jobListPhaseOf(job.status, job.receive_method);

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
  const [timelineCust, setTimelineCust] = useState<{ phone: string; name?: string } | null>(null);

  useEffect(() => {
    const jobsRef = ref(db, 'jobs');
    const unsub = onValue(jobsRef, (snap) => {
      if (!snap.exists()) { setJobs([]); setLoading(false); return; }
      const list: any[] = [];
      snap.forEach((child) => {
        const raw = child.val();
        list.push({ id: child.key, ...raw, qc_logs: normalizeQcLogs(raw?.qc_logs) });
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
    if (phase === 'sales') list = list.filter((j) => listPhaseOf(j) === 'sales');
    else if (phase === 'logistics') list = list.filter((j) => listPhaseOf(j) === 'active');
    else if (phase === 'closed') list = list.filter((j) => listPhaseOf(j) === 'closed');

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
    sales: jobs.filter((j) => listPhaseOf(j) === 'sales').length,
    logistics: jobs.filter((j) => listPhaseOf(j) === 'active').length,
    closed: jobs.filter((j) => listPhaseOf(j) === 'closed').length,
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
            <JobCard
              key={job.id}
              job={job}
              onClick={() => navigate(`/mobile/job/${job.id}`)}
              onViewHistory={() => job.cust_phone && setTimelineCust({ phone: job.cust_phone, name: job.cust_name })}
            />
          ))
        )}
      </div>

      {timelineCust && (
        <CustomerTimelineModal
          phone={timelineCust.phone}
          name={timelineCust.name}
          onClose={() => setTimelineCust(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Job Card
// ---------------------------------------------------------------------------

const JobCard = ({ job, onClick, onViewHistory }: { job: any; onClick: () => void; onViewHistory: () => void }) => {
  const sc = statusChipColors(job.status);
  // Receded = terminal or soft-closed: content ink goes quiet (never the
  // status chip, never the card background) and attention markers (new-lead
  // dot/ring, offer CTA badges) are suppressed so active work stands out.
  const receded = isRecededStatus(job.status, job.receive_method);
  const isNew = !receded && (job.status === 'New Lead' || job.status === 'New B2B Lead');
  const isB2B = job.type === 'B2B Trade-in' || job.status === 'New B2B Lead';
  const price = job.final_price || job.price;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`w-full bg-white rounded-xl border p-3.5 text-left transition-all active:scale-[0.98] cursor-pointer ${
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
                {!receded && isAwaitingOffer(job) && <span className="text-[9px] font-black bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full shrink-0">ขอราคา</span>}
                {!receded && isOfferAwaitingDecision(job) && <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full shrink-0">เสนอราคา</span>}
                <span className={`text-sm font-black truncate ${receded ? 'text-ink-receded' : 'text-slate-800'}`}>{job.model || 'ไม่ระบุรุ่น'}</span>
              </div>
              <p className={`text-[10px] mt-0.5 ${receded ? 'text-ink-receded-muted' : 'text-slate-400'}`}>
                {job.ref_no || `#${(job.id || '').slice(-6)}`}
              </p>
            </div>
            {!receded && isAwaitingOffer(job) ? (
              <span className="text-[11px] font-black text-blue-600 shrink-0">รอเสนอราคา</span>
            ) : price ? (
              <span className={`text-sm font-black shrink-0 ${receded ? 'text-ink-receded' : 'text-emerald-600'}`}>
                ฿{Number(price).toLocaleString()}
              </span>
            ) : null}
          </div>

          {/* Row 2: Customer — กดเพื่อดูประวัติลูกค้า (ไทม์ไลน์ซื้อ-ขาย) */}
          {(job.cust_name || job.cust_phone) && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewHistory(); }}
              className="flex items-center gap-2 text-xs text-slate-500 mb-2 -mx-1 px-1 py-0.5 rounded-md hover:bg-blue-50 active:bg-blue-100 transition-colors max-w-full"
              title="ดูประวัติลูกค้า"
            >
              {job.cust_name && <span className={`truncate font-bold underline decoration-dotted underline-offset-2 ${receded ? 'text-ink-receded' : 'text-blue-600'}`}>{job.cust_name}</span>}
              {job.cust_phone && (
                <span className="flex items-center gap-0.5 shrink-0">
                  <Phone size={10} /> {job.cust_phone}
                </span>
              )}
              <History size={11} className={`shrink-0 ${receded ? 'text-ink-receded-muted' : 'text-blue-400'}`} />
            </button>
          )}

          {/* Row 3: Status + Method + Time */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${sc.bg} ${sc.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
              {job.status}
            </span>

            {job.receive_method && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 ${receded ? 'text-ink-receded' : 'text-slate-500'}`}>
                {METHOD_ICONS[job.receive_method]}
                {job.receive_method}
              </span>
            )}

            {job.agent_name && (
              <span className={`text-[10px] truncate ${receded ? 'text-ink-receded-muted' : 'text-slate-400'}`}>
                👤 {job.agent_name}
              </span>
            )}

            <span className={`text-[10px] ml-auto shrink-0 flex items-center gap-0.5 ${receded ? 'text-ink-receded-muted' : 'text-slate-300'}`}>
              <Clock size={10} />
              {formatTimeAgo(job.created_at)}
            </span>
          </div>
        </div>

        <ChevronRight size={18} className="text-slate-300 shrink-0 mt-2" />
      </div>
    </div>
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
