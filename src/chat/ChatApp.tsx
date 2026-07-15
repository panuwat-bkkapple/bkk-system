import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MessageSquare, LogOut, Bell } from 'lucide-react';
import { LoginScreen } from '../components/auth/LoginScreen';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { InboxPage } from '../pages/inbox/InboxPage';
import { useStaffSession } from '../hooks/useStaffSession';
import { useAdminPushNotifications } from '../hooks/useAdminPushNotifications';
import { refreshAdminPushToken } from '../utils/adminPush';

// =============================================================================
// BKK Chat — standalone chat console app (chat.html entry, its own Firebase
// Hosting site / domain, same repo + same build as the admin app).
//
// Deliberately thin: login + a compact top bar + the SAME InboxPage the admin
// app uses. All chat features (3-column console, QuoteComposer, contact
// editor, Customer 360) come from that single shared component — this file
// must never grow its own chat logic (anti-mirror rule).
//
// Layout notes (learned from the first on-device test):
//   - PWA standalone + black-translucent status bar = content starts UNDER
//     the iOS clock, so the header pads by env(safe-area-inset-top)
//   - the app routes under /mobile/inbox so InboxPage picks its h-full mode
//     (it fills our flex column) instead of assuming the admin top bar
// =============================================================================

type StaffUser = { uid?: string; id?: string; name?: string; role?: string };

// iOS only fires the notification-permission prompt from a user gesture, so
// mounting the push hook alone never asks — this strip does, with the same
// refreshAdminPushToken flow the admin mobile app uses.
function PushPermissionStrip({ staffId }: { staffId: string }) {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  );
  const [busy, setBusy] = useState(false);
  if (perm !== 'default') return null;
  return (
    <div className="shrink-0 bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center gap-2">
      <Bell size={14} className="text-blue-600 shrink-0" />
      <p className="text-xs text-blue-900 flex-1">เปิดการแจ้งเตือนเพื่อไม่พลาดแชทลูกค้า</p>
      <button
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          await refreshAdminPushToken(staffId, { force: false, app: 'chat' }).catch(() => {});
          setPerm('Notification' in window ? Notification.permission : 'unsupported');
          setBusy(false);
        }}
        disabled={busy}
        className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-blue-600 text-white disabled:opacity-50"
      >
        {busy ? 'กำลังเปิด...' : 'เปิดการแจ้งเตือน'}
      </button>
    </div>
  );
}

function ChatShell({ currentUser, onLogout }: { currentUser: StaffUser; onLogout: () => void }) {
  const staffId = currentUser?.uid || currentUser?.id || '';
  useAdminPushNotifications(staffId || null, 'chat');
  return (
    <div className="h-[100dvh] flex flex-col bg-[#F5F5F7]">
      <header
        className="shrink-0 bg-white border-b border-slate-200"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-[52px] flex items-center px-4 gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center">
            <MessageSquare size={16} />
          </div>
          <h1 className="font-black text-sm text-slate-800">BKK Chat Console</h1>
          <div className="flex-1" />
          <span className="text-xs font-bold text-slate-500 truncate max-w-[160px]">
            {currentUser?.name || 'Staff'}
          </span>
          <button
            onClick={onLogout}
            title="ออกจากระบบ"
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      {staffId && <PushPermissionStrip staffId={staffId} />}
      {/* InboxPage in /mobile mode uses h-full — this flex cell gives it an
          exact height so nothing hides under the safe area or overflows */}
      <div className="flex-1 min-h-0">
        <InboxPage />
      </div>
    </div>
  );
}

export default function ChatApp() {
  const { loading, currentUser, handleLogin, handleLogout } = useStaffSession();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7]">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <Router>
          {currentUser ? (
            <Routes>
              <Route path="/mobile/inbox" element={<ChatShell currentUser={currentUser} onLogout={handleLogout} />} />
              <Route path="*" element={<Navigate to="/mobile/inbox" replace />} />
            </Routes>
          ) : (
            <LoginScreen onLogin={handleLogin} />
          )}
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}
