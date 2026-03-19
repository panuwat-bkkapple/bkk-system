import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Bell, Package, AlertTriangle, Clock, ChevronRight,
  RefreshCw, Smartphone, XCircle, RotateCcw, DollarSign, MessageSquare
} from 'lucide-react';

interface Notification {
  id: string;
  type: 'new_ticket' | 'pending_job' | 'dead_stock' | 'status_change';
  title: string;
  body: string;
  jobId?: string;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
}

export const MobileNotificationsPage = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const jobsRef = ref(db, 'jobs');
    const unsub = onValue(jobsRef, (snap) => {
      if (!snap.exists()) { setNotifications([]); setLoading(false); return; }

      const notifs: Notification[] = [];
      const now = Date.now();

      snap.forEach((child) => {
        const job = child.val();
        const jobId = child.key!;

        // New tickets
        if (job.status === 'New Lead' || job.status === 'New B2B Lead') {
          const isB2B = job.status === 'New B2B Lead';
          notifs.push({
            id: `new-${jobId}`,
            type: 'new_ticket',
            title: isB2B ? '📦 B2B Ticket ใหม่' : '📱 Ticket ใหม่',
            body: `${job.model || 'ไม่ระบุรุ่น'} ${job.price ? `฿${Number(job.price).toLocaleString()}` : ''} ${job.cust_name ? `- ${job.cust_name}` : ''}`.trim(),
            jobId,
            timestamp: job.created_at || now,
            severity: 'critical',
          });
        }

        // Pending jobs (stuck > 2 hours)
        const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];
        if (pendingStatuses.includes(job.status)) {
          const age = now - (job.updated_at || job.created_at || now);
          if (age > 2 * 3600000) {
            notifs.push({
              id: `pending-${jobId}`,
              type: 'pending_job',
              title: '⏳ งานค้างนาน',
              body: `${job.model} อยู่ในสถานะ "${job.status}" มา ${Math.floor(age / 3600000)} ชม.`,
              jobId,
              timestamp: job.updated_at || job.created_at || now,
              severity: 'warning',
            });
          }
        }

        // Dead stock (In Stock > 14 days)
        if (['In Stock', 'Ready to Sell'].includes(job.status)) {
          const age = now - (job.updated_at || job.created_at || now);
          if (age > 14 * 86400000) {
            notifs.push({
              id: `dead-${jobId}`,
              type: 'dead_stock',
              title: '📦 ค้างสต็อก',
              body: `${job.model} อยู่ในสต็อก ${Math.floor(age / 86400000)} วัน`,
              jobId,
              timestamp: job.updated_at || job.created_at || now,
              severity: age > 30 * 86400000 ? 'critical' : 'warning',
            });
          }
        }

        // Status changes (cancelled, returned, negotiation, etc.) within 24 hours
        const statusLabels: Record<string, { title: string; severity: 'critical' | 'warning' | 'info' }> = {
          'Cancelled': { title: '🚫 ยกเลิกงาน', severity: 'critical' },
          'Closed (Lost)': { title: '❌ ปิดงาน (Lost)', severity: 'critical' },
          'Returned': { title: '📦 ตีเครื่องกลับ', severity: 'critical' },
          'Negotiation': { title: '💬 ลูกค้าต่อราคา', severity: 'warning' },
          'Revised Offer': { title: '💰 เสนอราคาใหม่', severity: 'warning' },
          'Price Accepted': { title: '✅ ลูกค้ารับราคา', severity: 'info' },
          'Withdrawal Requested': { title: '💸 ขอถอนเงิน', severity: 'warning' },
        };
        const statusInfo = statusLabels[job.status];
        if (statusInfo) {
          const updatedAge = now - (job.updated_at || 0);
          if (updatedAge < 24 * 3600000 && job.updated_at) {
            const reason = job.cancel_reason ? ` - ${job.cancel_reason}` : '';
            notifs.push({
              id: `status-${jobId}`,
              type: 'status_change',
              title: statusInfo.title,
              body: `${job.model || 'ไม่ระบุรุ่น'}${job.cust_name ? ` - ${job.cust_name}` : ''}${reason}`,
              jobId,
              timestamp: job.updated_at,
              severity: statusInfo.severity,
            });
          }
        }
      });

      notifs.sort((a, b) => b.timestamp - a.timestamp);
      setNotifications(notifs);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const criticalCount = notifications.filter((n) => n.severity === 'critical').length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 bg-white border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-slate-600" />
            <h2 className="text-sm font-black text-slate-800">แจ้งเตือน</h2>
          </div>
          {criticalCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
              {criticalCount} ด่วน
            </span>
          )}
        </div>
      </div>

      {/* Notification List */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2 mt-10">
            <Bell size={40} className="text-slate-200" />
            <p className="text-sm font-bold">ไม่มีแจ้งเตือน</p>
            <p className="text-xs">ทุกอย่างเรียบร้อยดี</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((notif) => (
              <button
                key={notif.id}
                onClick={() => notif.jobId && navigate(`/mobile/job/${notif.jobId}`)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                {/* Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  notif.severity === 'critical' ? 'bg-red-100' :
                  notif.severity === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
                }`}>
                  {notif.type === 'new_ticket' ? (
                    <Smartphone size={18} className={notif.severity === 'critical' ? 'text-red-500' : 'text-blue-500'} />
                  ) : notif.type === 'pending_job' ? (
                    <Clock size={18} className="text-amber-500" />
                  ) : notif.type === 'status_change' ? (
                    <Bell size={18} className={notif.severity === 'critical' ? 'text-red-500' : notif.severity === 'warning' ? 'text-amber-500' : 'text-green-500'} />
                  ) : (
                    <Package size={18} className={notif.severity === 'critical' ? 'text-red-500' : 'text-amber-500'} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-slate-800">{notif.title}</span>
                    {notif.severity === 'critical' && (
                      <AlertTriangle size={12} className="text-red-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{notif.body}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {formatTimeAgo(notif.timestamp)}
                  </p>
                </div>

                <ChevronRight size={16} className="text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function formatTimeAgo(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return 'ตอนนี้';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  if (hr < 24) return `${hr} ชม.ที่แล้ว`;
  if (day < 7) return `${day} วันที่แล้ว`;
  return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
