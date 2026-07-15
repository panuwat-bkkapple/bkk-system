import { BrowserRouter as Router } from 'react-router-dom';
import { MessageSquare, LogOut } from 'lucide-react';
import { LoginScreen } from '../components/auth/LoginScreen';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { InboxPage } from '../pages/inbox/InboxPage';
import { useStaffSession } from '../hooks/useStaffSession';
import { useAdminPushNotifications } from '../hooks/useAdminPushNotifications';

// =============================================================================
// BKK Chat — standalone chat console app (chat.html entry, its own Firebase
// Hosting site / domain, same repo + same build as the admin app).
//
// Deliberately thin: login + a 52px top bar + the SAME InboxPage the admin
// app uses. All chat features (3-column console, QuoteComposer, contact
// editor, Customer 360) come from that single shared component — this file
// must never grow its own chat logic (anti-mirror rule).
//
// Known limitations of the separate origin (accepted, see PR):
//   - staff sessions are NOT shared with bkk-apple-admin.web.app (login again)
//   - links out to ticket pages open the admin app (second login there)
//   - push tokens register per-origin (a second device entry per staff — the
//     admin_fcm_tokens schema already supports multiple devices)
// =============================================================================

// InboxPage sizes itself as h-[calc(100vh-52px)] on desktop (it normally sits
// under the AdminLayout top bar) — this bar is exactly 52px so the math holds.
function ChatShell({ currentUser, onLogout }: { currentUser: { uid?: string; id?: string; name?: string; role?: string }; onLogout: () => void }) {
  useAdminPushNotifications(currentUser?.uid || currentUser?.id || null);
  return (
    <div className="min-h-screen bg-[#F5F5F7]">
      <header className="h-[52px] bg-white border-b border-slate-200 flex items-center px-4 gap-3">
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
      </header>
      <InboxPage />
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
            <ChatShell currentUser={currentUser} onLogout={handleLogout} />
          ) : (
            <LoginScreen onLogin={handleLogin} />
          )}
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}
