// src/pages/fleet/DiscrepancyReports.tsx
import { useState, useEffect } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, MapPin, User,
  Smartphone, Banknote, CalendarDays, HelpCircle,
  Filter, Search, Eye, X, ExternalLink, ImageIcon
} from 'lucide-react';
import { ref, onValue, update } from 'firebase/database';
import { db } from '@/api/firebase';
import { useToast } from '@/components/ui/ToastProvider';
import { formatDate } from '@/utils/formatters';
import { DiscrepancyCategory, DiscrepancyStatus } from '@/types/domain';
import type { DiscrepancyReport } from '@/types/domain';

// หมวดหมู่และไอคอน
const CATEGORY_CONFIG: Record<DiscrepancyCategory, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  [DiscrepancyCategory.ADDRESS]: { label: 'ที่อยู่ผิด', icon: <MapPin size={14} />, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  [DiscrepancyCategory.CUSTOMER]: { label: 'ชื่อลูกค้าไม่ตรง', icon: <User size={14} />, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  [DiscrepancyCategory.DEVICE]: { label: 'รุ่นเครื่องไม่ตรง', icon: <Smartphone size={14} />, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
  [DiscrepancyCategory.PRICE]: { label: 'ราคาไม่ตรง', icon: <Banknote size={14} />, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  [DiscrepancyCategory.APPOINTMENT]: { label: 'เวลานัดหมายไม่ตรง', icon: <CalendarDays size={14} />, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  [DiscrepancyCategory.OTHER]: { label: 'อื่นๆ', icon: <HelpCircle size={14} />, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
};

interface ReportWithJob extends DiscrepancyReport {
  jobModel?: string;
  jobCustomer?: string;
  jobRefNo?: string;
}

export const DiscrepancyReports = () => {
  const toast = useToast();
  const [reports, setReports] = useState<ReportWithJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'resolved'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReport, setSelectedReport] = useState<ReportWithJob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // ดึงข้อมูลจาก jobs/{jobId}/discrepancy_reports
  useEffect(() => {
    const jobsRef = ref(db, 'jobs');
    const unsub = onValue(jobsRef, (snapshot) => {
      if (!snapshot.exists()) {
        setReports([]);
        setLoading(false);
        return;
      }

      const jobsData = snapshot.val();
      const allReports: ReportWithJob[] = [];

      Object.entries(jobsData).forEach(([jobId, jobData]: [string, any]) => {
        if (jobData.discrepancy_reports) {
          Object.entries(jobData.discrepancy_reports).forEach(([reportId, reportData]: [string, any]) => {
            allReports.push({
              id: reportId,
              jobId,
              category: reportData.category || 'other',
              detail: reportData.detail || '',
              imageUrl: reportData.imageUrl || null,
              reported_by: reportData.reported_by || 'ไม่ระบุ',
              reported_at: reportData.reported_at || 0,
              status: reportData.status || 'pending',
              resolved_at: reportData.resolved_at || null,
              resolved_by: reportData.resolved_by || undefined,
              jobModel: jobData.model || '-',
              jobCustomer: jobData.cust_name || '-',
              jobRefNo: jobData.ref_no || jobId.slice(0, 8),
            });
          });
        }
      });

      // เรียงตาม reported_at ล่าสุดก่อน
      allReports.sort((a, b) => b.reported_at - a.reported_at);
      setReports(allReports);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // กรองข้อมูล
  const filtered = reports.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterCategory !== 'all' && r.category !== filterCategory) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        r.detail.toLowerCase().includes(q) ||
        r.reported_by.toLowerCase().includes(q) ||
        r.jobModel?.toLowerCase().includes(q) ||
        r.jobCustomer?.toLowerCase().includes(q) ||
        r.jobRefNo?.toLowerCase().includes(q) ||
        r.jobId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const pendingCount = reports.filter(r => r.status === 'pending').length;

  // Mark as resolved
  const handleResolve = async (report: ReportWithJob) => {
    try {
      const currentSession = sessionStorage.getItem('bkk_session');
      const adminName = currentSession ? JSON.parse(currentSession).name : 'Admin';

      await update(ref(db, `jobs/${report.jobId}/discrepancy_reports/${report.id}`), {
        status: 'resolved',
        resolved_at: Date.now(),
        resolved_by: adminName,
      });
      toast.success('อัปเดตสถานะเป็น "แก้ไขแล้ว" สำเร็จ');
      setSelectedReport(null);
    } catch {
      toast.error('เกิดข้อผิดพลาดในการอัปเดตสถานะ');
    }
  };

  // Reopen report
  const handleReopen = async (report: ReportWithJob) => {
    try {
      await update(ref(db, `jobs/${report.jobId}/discrepancy_reports/${report.id}`), {
        status: 'pending',
        resolved_at: null,
        resolved_by: null,
      });
      toast.success('เปิดรายงานอีกครั้งสำเร็จ');
      setSelectedReport(null);
    } catch {
      toast.error('เกิดข้อผิดพลาด');
    }
  };

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-3 bg-orange-100 text-orange-600 rounded-2xl">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tighter uppercase">
              รายงานข้อมูลไม่ตรง
            </h1>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Discrepancy Reports from Riders
            </p>
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="mt-4 px-4 py-3 bg-orange-50 border border-orange-200 rounded-2xl flex items-center gap-2">
            <Clock size={16} className="text-orange-500" />
            <span className="text-sm font-bold text-orange-700">
              มีรายงานรอตรวจสอบ {pendingCount} รายการ
            </span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[250px]">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหา... (รุ่นเครื่อง, ชื่อลูกค้า, Ref No, รายละเอียด)"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400 focus:bg-white transition-all"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-400" />
            <div className="flex bg-slate-100 rounded-xl p-1">
              {([['all', 'ทั้งหมด'], ['pending', 'รอตรวจสอบ'], ['resolved', 'แก้ไขแล้ว']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setFilterStatus(val)}
                  className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${filterStatus === val ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter */}
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-400"
          >
            <option value="all">ทุกหมวดหมู่</option>
            {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Reports List */}
      {loading ? (
        <div className="bg-white p-20 rounded-[2.5rem] border border-slate-200 shadow-sm text-center">
          <div className="animate-pulse text-slate-400 font-bold text-sm">กำลังโหลดข้อมูล...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-20 rounded-[2.5rem] border border-slate-200 shadow-sm text-center">
          <AlertTriangle size={48} className="mx-auto text-slate-200 mb-4" />
          <p className="text-sm font-bold text-slate-400">ไม่พบรายงานข้อมูลไม่ตรง</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(report => {
            const catConfig = CATEGORY_CONFIG[report.category as DiscrepancyCategory] || CATEGORY_CONFIG[DiscrepancyCategory.OTHER];
            const isPending = report.status === 'pending';

            return (
              <div
                key={`${report.jobId}-${report.id}`}
                onClick={() => setSelectedReport(report)}
                className={`bg-white p-6 rounded-2xl border shadow-sm cursor-pointer hover:shadow-md transition-all ${isPending ? 'border-orange-200 hover:border-orange-300' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    {/* Category Icon */}
                    <div className={`p-3 rounded-xl shrink-0 ${catConfig.bg} ${catConfig.color}`}>
                      {catConfig.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${catConfig.bg} ${catConfig.color} ${catConfig.border}`}>
                          {catConfig.label}
                        </span>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border ${isPending ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
                          {isPending ? 'รอตรวจสอบ' : 'แก้ไขแล้ว'}
                        </span>
                        {report.imageUrl && (
                          <span className="text-slate-400"><ImageIcon size={14} /></span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800 line-clamp-2 mb-2">{report.detail}</p>
                      <div className="flex items-center gap-4 text-[11px] font-bold text-slate-400">
                        <span>Job: {report.jobRefNo}</span>
                        <span>{report.jobModel}</span>
                        <span>{report.jobCustomer}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      {formatDate(report.reported_at)}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500">{report.reported_by}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary Stats */}
      {!loading && reports.length > 0 && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
            const count = reports.filter(r => r.category === key).length;
            const pendingCat = reports.filter(r => r.category === key && r.status === 'pending').length;
            return (
              <button
                key={key}
                onClick={() => setFilterCategory(filterCategory === key ? 'all' : key)}
                className={`p-4 rounded-2xl border text-center transition-all ${filterCategory === key ? `${cfg.bg} ${cfg.border} shadow-sm` : 'bg-white border-slate-200 hover:bg-slate-50'}`}
              >
                <div className={`mx-auto mb-2 ${cfg.color}`}>{cfg.icon}</div>
                <p className="text-lg font-black text-slate-800">{count}</p>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{cfg.label}</p>
                {pendingCat > 0 && (
                  <p className="text-[10px] font-bold text-orange-500 mt-1">รอ {pendingCat}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedReport(null)}>
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-8">
              {/* Modal Header */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${CATEGORY_CONFIG[selectedReport.category as DiscrepancyCategory]?.bg || 'bg-slate-50'} ${CATEGORY_CONFIG[selectedReport.category as DiscrepancyCategory]?.color || 'text-slate-600'}`}>
                    {CATEGORY_CONFIG[selectedReport.category as DiscrepancyCategory]?.icon || <HelpCircle size={14} />}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">รายงานข้อมูลไม่ตรง</h3>
                    <p className="text-[11px] font-bold text-slate-400">
                      {CATEGORY_CONFIG[selectedReport.category as DiscrepancyCategory]?.label || 'อื่นๆ'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedReport(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <X size={20} className="text-slate-400" />
                </button>
              </div>

              {/* Status */}
              <div className={`p-4 rounded-2xl border mb-6 ${selectedReport.status === 'pending' ? 'bg-orange-50 border-orange-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <div className="flex items-center gap-2">
                  {selectedReport.status === 'pending' ? (
                    <Clock size={16} className="text-orange-500" />
                  ) : (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  )}
                  <span className={`text-sm font-black uppercase ${selectedReport.status === 'pending' ? 'text-orange-700' : 'text-emerald-700'}`}>
                    {selectedReport.status === 'pending' ? 'รอตรวจสอบ' : 'แก้ไขแล้ว'}
                  </span>
                </div>
                {selectedReport.resolved_at && (
                  <p className="text-[11px] font-bold text-emerald-600 mt-1">
                    แก้ไขโดย {selectedReport.resolved_by || '-'} เมื่อ {formatDate(selectedReport.resolved_at)}
                  </p>
                )}
              </div>

              {/* Job Info */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">ข้อมูลงาน</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400">Ref No.</p>
                    <p className="font-black text-slate-800">{selectedReport.jobRefNo}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400">รุ่นเครื่อง</p>
                    <p className="font-black text-slate-800">{selectedReport.jobModel}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400">ลูกค้า</p>
                    <p className="font-black text-slate-800">{selectedReport.jobCustomer}</p>
                  </div>
                </div>
                <a
                  href={`/workspace/${selectedReport.jobId}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-500 hover:text-blue-700 transition-colors"
                >
                  <ExternalLink size={12} /> เปิด Workspace ของงานนี้
                </a>
              </div>

              {/* Report Detail */}
              <div className="mb-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">รายละเอียด</p>
                <p className="text-sm font-bold text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  {selectedReport.detail}
                </p>
              </div>

              {/* Reporter Info */}
              <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-4">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ผู้แจ้ง</p>
                  <p className="text-sm font-black text-slate-800">{selectedReport.reported_by}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">เวลาที่แจ้ง</p>
                  <p className="text-sm font-bold text-slate-600">{formatDate(selectedReport.reported_at)}</p>
                </div>
              </div>

              {/* Image */}
              {selectedReport.imageUrl && (
                <div className="mb-6">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">รูปภาพแนบ</p>
                  <img
                    src={selectedReport.imageUrl}
                    alt="หลักฐานแนบ"
                    className="w-full rounded-2xl border border-slate-200 cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setImagePreview(selectedReport.imageUrl!)}
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                {selectedReport.status === 'pending' ? (
                  <button
                    onClick={() => handleResolve(selectedReport)}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-100"
                  >
                    <CheckCircle2 size={18} /> แก้ไขแล้ว (Resolve)
                  </button>
                ) : (
                  <button
                    onClick={() => handleReopen(selectedReport)}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <Clock size={18} /> เปิดรายงานอีกครั้ง
                  </button>
                )}
                <button
                  onClick={() => setSelectedReport(null)}
                  className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-bold text-sm transition-all"
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {imagePreview && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setImagePreview(null)}>
          <button onClick={() => setImagePreview(null)} className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors">
            <X size={24} />
          </button>
          <img src={imagePreview} alt="Preview" className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl" />
        </div>
      )}
    </div>
  );
};
