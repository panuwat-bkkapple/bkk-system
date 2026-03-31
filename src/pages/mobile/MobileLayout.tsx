import { useState, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import {
  ClipboardList, Inbox, Bell, User, LogOut,
  ChevronLeft, Banknote, DollarSign
} from 'lucide-react';
import { useAdminPushNotifications } from '../../hooks/useAdminPushNotifications';

interface MobileLayoutProps {
  currentUser: any;
  onLogout: () => void;
}

export const MobileLayout = ({ currentUser, onLogout }: MobileLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Register FCM token for push notifications (lock screen + background)
  useAdminPushNotifications(currentUser?.uid || currentUser?.id || null);
  const [newTicketCount, setNewTicketCount] = useState(0);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [pendingPayouts, setPendingPayouts] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [showProfile, setShowProfile] = useState(false);

  // Count new/unread tickets + pending payouts + notifications
  useEffect(() => {
    const jobsRef = ref(db, 'jobs');
    const unsub = onValue(jobsRef, (snap) => {
      if (!snap.exists()) return;
      let count = 0;
      let payoutCount = 0;
      let nCount = 0;
      const now = Date.now();
      snap.forEach((child) => {
        const j = child.val();
        if (j.status === 'New Lead' || j.status === 'New B2B Lead' || j.status === 'Active Leads') {
          count++;
          nCount++; // new ticket notification
        }
        const s = String(j.status || '').trim().toLowerCase();
        if (!j.slip_url && !j.payment_slip &&
            (s === 'payout processing' || s === 'pending finance approval' || s === 'waiting for finance' || s === 'price accepted')) {
          payoutCount++;
        }
        // Pending jobs stuck > 2 hours
        const pendingStatuses = ['Pending QC', 'Being Inspected', 'Payout Processing'];
        if (pendingStatuses.includes(j.status)) {
          const age = now - (j.updated_at || j.created_at || now);
          if (age > 2 * 3600000) nCount++;
        }
        // Dead stock > 14 days
        if (['In Stock', 'Ready to Sell'].includes(j.status)) {
          const age = now - (j.updated_at || j.created_at || now);
          if (age > 14 * 86400000) nCount++;
        }
        // Status changes within 24 hours
        const alertStatuses = ['Cancelled', 'Closed (Lost)', 'Returned', 'Negotiation', 'Revised Offer', 'Price Accepted', 'Withdrawal Requested'];
        if (alertStatuses.includes(j.status) && j.updated_at && (now - j.updated_at) < 24 * 3600000) {
          nCount++;
        }
      });
      setNewTicketCount(count);
      setPendingPayouts(payoutCount);
      setNotifCount(nCount);
    });
    return () => unsub();
  }, []);

  // Count inbox unread
  useEffect(() => {
    const inboxRef = ref(db, 'inbox');
    const unsub = onValue(inboxRef, (snap) => {
      if (!snap.exists()) { setInboxUnread(0); return; }
      let count = 0;
      snap.forEach((child) => {
        const c = child.val();
        if (c.unreadCount > 0) count += c.unreadCount;
      });
      setInboxUnread(count);
    });
    return () => unsub();
  }, []);

  const isDetailPage = location.pathname.match(/^\/mobile\/job\/.+/);

  const isManager = currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER';

  const tabs = [
    { key: '/mobile', label: 'งาน', icon: ClipboardList, badge: newTicketCount },
    { key: '/mobile/finance', label: 'โอนเงิน', icon: Banknote, badge: pendingPayouts },
    ...(isManager ? [{ key: '/mobile/pricing', label: 'ราคา', icon: DollarSign, badge: 0 }] : []),
    { key: '/mobile/inbox', label: 'แชท', icon: Inbox, badge: inboxUnread },
    { key: '/mobile/notifications', label: 'แจ้งเตือน', icon: Bell, badge: notifCount },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#F5F5F7]">
      {/* Top Bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0 safe-top">
        <div className="flex items-center gap-3">
          {isDetailPage ? (
            <button onClick={() => navigate('/mobile')} className="p-1 -ml-1 text-slate-500">
              <ChevronLeft size={24} />
            </button>
          ) : (
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-black">BKK</span>
            </div>
          )}
          <div>
            <h1 className="text-sm font-black text-slate-800 leading-none">
              {isDetailPage ? 'รายละเอียดงาน' : 'BKK System'}
            </h1>
            {!isDetailPage && (
              <p className="text-[10px] text-slate-400 font-bold">{currentUser?.name} ({currentUser?.role})</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowProfile(!showProfile)}
          className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center"
        >
          <User size={18} className="text-blue-600" />
        </button>
      </div>

      {/* Profile dropdown */}
      {showProfile && (
        <div className="absolute right-4 top-14 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-4 w-56">
          <p className="text-sm font-black text-slate-800">{currentUser?.name}</p>
          <p className="text-xs text-slate-400 mb-3">{currentUser?.email}</p>
          <button
            onClick={() => { setShowProfile(false); onLogout(); }}
            className="w-full flex items-center gap-2 py-2 px-3 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={16} /> ออกจากระบบ
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>

      {/* Bottom Navigation - hide on detail page */}
      {!isDetailPage && (
        <div className="bg-white border-t border-slate-200 flex shrink-0 safe-bottom">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.key ||
              (tab.key === '/mobile' && location.pathname === '/mobile');
            return (
              <button
                key={tab.key}
                onClick={() => navigate(tab.key)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 relative transition-colors ${
                  isActive ? 'text-blue-600' : 'text-slate-400'
                }`}
              >
                <div className="relative">
                  <tab.icon size={22} />
                  {tab.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center font-black">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold">{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
