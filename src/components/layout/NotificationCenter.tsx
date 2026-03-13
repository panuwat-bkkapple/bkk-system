import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  Bell, Package, ShieldAlert, Clock, Smartphone,
  AlertTriangle, X, CheckCircle2, MessageSquareQuote
} from 'lucide-react';

interface Notification {
  id: string;
  type: 'low_stock' | 'dead_stock' | 'pending_claim' | 'pending_review' | 'pending_job';
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  time: number;
  link?: string;
}

export const NotificationCenter = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const saved = sessionStorage.getItem('bkk_dismissed_notifs');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Listen to multiple Firebase paths for notifications
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    const now = Date.now();
    const msPerDay = 86400000;

    // 1. Jobs - pending trade-ins & dead stock
    unsubs.push(onValue(ref(db, 'jobs'), (snap) => {
      if (!snap.exists()) return;
      const data = snap.val();
      const jobs = Object.keys(data).map(k => ({ id: k, ...data[k] }));
      const alerts: Notification[] = [];

      // Pending jobs (waiting for action)
      const pendingJobs = jobs.filter((j: any) =>
        ['Pending Evaluation', 'Pending QC', 'Awaiting Pickup'].includes(j.status) &&
        j.type !== 'Withdrawal' && j.type !== 'B2B-Unpacked'
      );
      if (pendingJobs.length > 0) {
        alerts.push({
          id: 'pending_jobs',
          type: 'pending_job',
          title: `${pendingJobs.length} งานรอดำเนินการ`,
          description: `มี Trade-in ${pendingJobs.length} รายการที่รอประเมิน/ตรวจสอบ`,
          severity: pendingJobs.length >= 5 ? 'critical' : 'warning',
          time: now,
          link: '/tickets',
        });
      }

      // Dead stock (>14 days)
      const deadStock = jobs.filter((j: any) =>
        ['In Stock', 'Ready to Sell'].includes(j.status) &&
        j.type !== 'B2B Trade-in' &&
        (now - j.created_at) > (14 * msPerDay)
      );
      if (deadStock.length > 0) {
        alerts.push({
          id: 'dead_stock',
          type: 'dead_stock',
          title: `${deadStock.length} สินค้าดองสต็อก`,
          description: `สินค้าค้างมากกว่า 14 วัน ควรลดราคาขาย`,
          severity: deadStock.length >= 10 ? 'critical' : 'warning',
          time: now,
          link: '/inventory',
        });
      }

      setNotifications(prev => [
        ...prev.filter(n => n.type !== 'pending_job' && n.type !== 'dead_stock'),
        ...alerts,
      ]);
    }));

    // 2. Claims - open warranty claims
    unsubs.push(onValue(ref(db, 'claims'), (snap) => {
      if (!snap.exists()) {
        setNotifications(prev => prev.filter(n => n.type !== 'pending_claim'));
        return;
      }
      const data = snap.val();
      const openClaims = Object.values(data).filter((c: any) => c.status === 'OPEN');

      if (openClaims.length > 0) {
        setNotifications(prev => [
          ...prev.filter(n => n.type !== 'pending_claim'),
          {
            id: 'open_claims',
            type: 'pending_claim',
            title: `${openClaims.length} เคลมรอจัดการ`,
            description: 'มีเคสรับประกันที่ยังไม่ได้ดำเนินการ',
            severity: 'critical',
            time: now,
            link: '/warranty',
          },
        ]);
      } else {
        setNotifications(prev => prev.filter(n => n.type !== 'pending_claim'));
      }
    }));

    // 3. Reviews - pending reviews
    unsubs.push(onValue(ref(db, 'reviews'), (snap) => {
      if (!snap.exists()) {
        setNotifications(prev => prev.filter(n => n.type !== 'pending_review'));
        return;
      }
      const data = snap.val();
      const pendingReviews = Object.values(data).filter((r: any) => r.status === 'pending');

      if (pendingReviews.length > 0) {
        setNotifications(prev => [
          ...prev.filter(n => n.type !== 'pending_review'),
          {
            id: 'pending_reviews',
            type: 'pending_review',
            title: `${pendingReviews.length} รีวิวรออนุมัติ`,
            description: 'รีวิวจากลูกค้ารอตรวจสอบและเผยแพร่',
            severity: 'info',
            time: now,
            link: '/reviews',
          },
        ]);
      } else {
        setNotifications(prev => prev.filter(n => n.type !== 'pending_review'));
      }
    }));

    // 4. Products - low stock alerts
    unsubs.push(onValue(ref(db, 'products'), (snap) => {
      if (!snap.exists()) {
        setNotifications(prev => prev.filter(n => n.type !== 'low_stock'));
        return;
      }
      const data = snap.val();
      const products = Object.values(data) as any[];
      const lowStock = products.filter(p => p.status === 'ACTIVE' && (p.quantity || 0) <= (p.low_stock_threshold || 3) && (p.quantity || 0) > 0);
      const outOfStock = products.filter(p => p.status === 'ACTIVE' && (p.quantity || 0) === 0);

      const alerts: Notification[] = [];
      if (outOfStock.length > 0) {
        alerts.push({
          id: 'out_of_stock',
          type: 'low_stock',
          title: `${outOfStock.length} สินค้าหมดสต็อก`,
          description: 'สินค้าบางรายการหมดแล้ว ควรสั่งเติม',
          severity: 'critical',
          time: now,
          link: '/inventory',
        });
      }
      if (lowStock.length > 0) {
        alerts.push({
          id: 'low_stock',
          type: 'low_stock',
          title: `${lowStock.length} สินค้าใกล้หมด`,
          description: 'ระดับสต็อกต่ำกว่าเกณฑ์ขั้นต่ำ',
          severity: 'warning',
          time: now,
          link: '/inventory',
        });
      }

      setNotifications(prev => [
        ...prev.filter(n => n.type !== 'low_stock'),
        ...alerts,
      ]);
    }));

    return () => unsubs.forEach(fn => fn());
  }, []);

  const dismiss = (id: string) => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    sessionStorage.setItem('bkk_dismissed_notifs', JSON.stringify([...next]));
  };

  const clearAll = () => {
    const next = new Set(notifications.map(n => n.id));
    setDismissed(next);
    sessionStorage.setItem('bkk_dismissed_notifs', JSON.stringify([...next]));
  };

  const activeNotifications = notifications.filter(n => !dismissed.has(n.id));
  const criticalCount = activeNotifications.filter(n => n.severity === 'critical').length;
  const totalCount = activeNotifications.length;

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'low_stock': return <Package size={16} />;
      case 'dead_stock': return <Clock size={16} />;
      case 'pending_claim': return <ShieldAlert size={16} />;
      case 'pending_review': return <MessageSquareQuote size={16} />;
      case 'pending_job': return <Smartphone size={16} />;
    }
  };

  const getSeverityStyle = (severity: Notification['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 border-red-200 text-red-600';
      case 'warning': return 'bg-orange-50 border-orange-200 text-orange-600';
      case 'info': return 'bg-blue-50 border-blue-200 text-blue-600';
    }
  };

  const getBadgeStyle = (severity: Notification['severity']) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'warning': return 'bg-orange-500';
      case 'info': return 'bg-blue-500';
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2.5 rounded-xl hover:bg-slate-100 transition-colors group"
      >
        <Bell size={20} className={`${totalCount > 0 ? 'text-slate-700' : 'text-slate-400'} group-hover:text-blue-600 transition-colors`} />
        {totalCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-black text-white rounded-full px-1 ${criticalCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-orange-500'}`}>
            {totalCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex justify-between items-center px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <h3 className="font-black text-sm text-slate-800 uppercase tracking-wider">Notifications</h3>
              {totalCount > 0 && (
                <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-full">{totalCount}</span>
              )}
            </div>
            {totalCount > 0 && (
              <button onClick={clearAll} className="text-[10px] font-bold text-slate-400 hover:text-blue-600 uppercase tracking-wider transition-colors">
                เคลียร์ทั้งหมด
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto">
            {activeNotifications.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-3" />
                <div className="font-black text-sm text-slate-600">ไม่มีการแจ้งเตือน</div>
                <div className="text-xs text-slate-400 font-bold mt-1">ทุกอย่างเรียบร้อยดี!</div>
              </div>
            ) : (
              <div className="p-2 space-y-1.5">
                {activeNotifications
                  .sort((a, b) => {
                    const order = { critical: 0, warning: 1, info: 2 };
                    return order[a.severity] - order[b.severity];
                  })
                  .map((notif) => (
                    <div
                      key={notif.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all hover:shadow-sm cursor-pointer ${getSeverityStyle(notif.severity)}`}
                      onClick={() => {
                        if (notif.link) {
                          navigate(notif.link);
                          setIsOpen(false);
                        }
                      }}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${getBadgeStyle(notif.severity)} text-white`}>
                        {getIcon(notif.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-xs text-slate-800">{notif.title}</div>
                        <div className="text-[10px] font-bold text-slate-500 mt-0.5">{notif.description}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(notif.id);
                        }}
                        className="shrink-0 p-1 rounded-lg hover:bg-white/60 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > activeNotifications.length && (
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => {
                  setDismissed(new Set());
                  sessionStorage.removeItem('bkk_dismissed_notifs');
                }}
                className="text-[10px] font-bold text-blue-500 hover:text-blue-700 uppercase tracking-wider transition-colors"
              >
                แสดงที่ซ่อนอยู่ ({notifications.length - activeNotifications.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
