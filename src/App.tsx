import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate, useParams, useLocation } from 'react-router-dom';
import { LoginScreen } from './components/auth/LoginScreen';
import { AdminLayout } from './components/layout/AdminLayout';
import { auth, db } from './api/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get, push, set } from 'firebase/database';
import { Toaster } from 'react-hot-toast';

// --- Static Imports (needed immediately) ---
import { MobileLayout } from './pages/mobile/MobileLayout';
import { ToastProvider } from './components/ui/ToastProvider';

// --- Lazy-loaded Pages ---
const TradeInDashboard = lazy(() => import('./features/trade-in/TradeInDashboard').then(m => ({ default: m.TradeInDashboard })));
const Inventory = lazy(() => import('./pages/inventory/Inventory').then(m => ({ default: m.Inventory })));
const Analytics = lazy(() => import('./pages/analytics/Analytics').then(m => ({ default: m.Analytics })));
const PriceEditor = lazy(() => import('./features/trade-in/PriceEditor').then(m => ({ default: m.PriceEditor })));
const QCStation = lazy(() => import('./pages/lab/QCStation').then(m => ({ default: m.QCStation })));
const DispatcherPage = lazy(() => import('./pages/fleet/DispatcherPage').then(m => ({ default: m.DispatcherPage })));
const POS = lazy(() => import('./pages/sales/POS').then(m => ({ default: m.POS })));
const Accessories = lazy(() => import('./pages/inventory/Accessories').then(m => ({ default: m.Accessories })));
const SalesHistory = lazy(() => import('./pages/sales/SalesHistory').then(m => ({ default: m.SalesHistory })));
const Traceability = lazy(() => import('./pages/inventory/Traceability').then(m => ({ default: m.Traceability })));
const StaffManagement = lazy(() => import('./pages/settings/StaffManagement').then(m => ({ default: m.StaffManagement })));
const WarrantyClaims = lazy(() => import('./pages/crm/WarrantyClaims').then(m => ({ default: m.WarrantyClaims })));
const CEODashboard = lazy(() => import('./pages/dashboard/CEODashboard').then(m => ({ default: m.CEODashboard })));
const DailyExpenses = lazy(() => import('./pages/finance/DailyExpenses').then(m => ({ default: m.DailyExpenses })));
const StockAudit = lazy(() => import('./pages/inventory/StockAudit').then(m => ({ default: m.StockAudit })));
const Finance = lazy(() => import('./pages/finance/Finance').then(m => ({ default: m.Finance })));
const B2BAuditorTool = lazy(() => import('./features/trade-in/components/b2b/B2BAuditorTool').then(m => ({ default: m.B2BAuditorTool })));
const CustomerCRM = lazy(() => import('./pages/crm/CustomerCRM').then(m => ({ default: m.CustomerCRM })));
const RiderManagement = lazy(() => import('./pages/fleet/RiderManagement').then(m => ({ default: m.RiderManagement })));
const DiscrepancyReports = lazy(() => import('./pages/fleet/DiscrepancyReports').then(m => ({ default: m.DiscrepancyReports })));
const CustomerTracking = lazy(() => import('./pages/tracking/CustomerTracking').then(m => ({ default: m.CustomerTracking })));
const B2CWorkspacePage = lazy(() => import('@/pages/admin/B2CWorkspacePage').then(m => ({ default: m.B2CWorkspacePage })));
const InvoicePage = lazy(() => import('./features/trade-in/pages/InvoicePage').then(m => ({ default: m.InvoicePage })));
const CouponManager = lazy(() => import('./pages/admin/CouponManager').then(m => ({ default: m.CouponManager })));
const GlobalSettings = lazy(() => import('./pages/admin/GlobalSettings'));
const BranchManager = lazy(() => import('./pages/admin/BranchManager'));
const ReviewManager = lazy(() => import('./pages/admin/ReviewManager'));
const InboxPage = lazy(() => import('./pages/inbox/InboxPage').then(m => ({ default: m.InboxPage })));
const MobileTicketsPage = lazy(() => import('./pages/mobile/MobileTicketsPage').then(m => ({ default: m.MobileTicketsPage })));
const MobileTicketDetail = lazy(() => import('./pages/mobile/MobileTicketDetail').then(m => ({ default: m.MobileTicketDetail })));
const MobileNotificationsPage = lazy(() => import('./pages/mobile/MobileNotificationsPage').then(m => ({ default: m.MobileNotificationsPage })));
const MobileFinancePage = lazy(() => import('./pages/mobile/MobileFinancePage').then(m => ({ default: m.MobileFinancePage })));

// ==========================================
// Main App Router
// ==========================================
export default function App() {
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !currentUser) {
        try {
          const staffSnap = await get(ref(db, 'staff'));
          let role = 'STAFF';
          let staffName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Admin';

          if (staffSnap.exists()) {
            const staffData = staffSnap.val();
            const matched = Object.values(staffData).find(
              (s: any) => s.email === firebaseUser.email && s.status === 'ACTIVE'
            ) as any;
            if (matched) {
              role = matched.role || 'STAFF';
              staffName = matched.name || staffName;
            }
          } else {
            // Database is empty - bootstrap first user as CEO
            const newStaffRef = push(ref(db, 'staff'));
            await set(newStaffRef, {
              name: staffName,
              email: firebaseUser.email,
              role: 'CEO',
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
            });
            role = 'CEO';
          }

          const autoUser = {
            uid: firebaseUser.uid,
            name: staffName,
            email: firebaseUser.email || '',
            role,
          };
          sessionStorage.setItem('bkk_session', JSON.stringify(autoUser));
          setCurrentUser(autoUser);
        } catch (err) {
          // Auto-login role fetch failed
        }
      }

      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = (staffUser: any) => {
    sessionStorage.setItem('bkk_session', JSON.stringify(staffUser));
    setCurrentUser(staffUser);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('bkk_session');
    setCurrentUser(null);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center font-bold text-gray-400">LOADING BKK SYSTEM...</div>;

  return (
    <ToastProvider>
    <Router>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center font-bold text-gray-400 animate-pulse">Loading...</div>}>
      <Routes>
        {/* Public Routes */}
        <Route path="/track/:id" element={<CustomerTrackingWrapper />} />

        {/* Login Route */}
        <Route
          path="/login"
          element={!currentUser ? <LoginScreen onLogin={handleLogin} /> : <RedirectAfterLogin />}
        />

        {/* Protected Routes */}
        {currentUser ? (
          <>
            {/* Full Screen Pages (no sidebar) */}
            <Route path="/pos" element={<div className="relative min-h-screen"><POSButtonWrapper to="/inventory" label="Exit POS" /><POS /></div>} />
            <Route path="/dispatcher" element={<div className="relative min-h-screen bg-[#F5F7FA]"><POSButtonWrapper to="/tickets" label="กลับสู่ระบบหลังบ้าน (Exit)" /><DispatcherPage /></div>} />
            <Route path="/invoice/:id" element={<InvoicePage />} />

            {/* Mobile Admin Pages */}
            <Route element={<MobileLayout currentUser={currentUser} onLogout={handleLogout} />}>
              <Route path="/mobile" element={<MobileTicketsPage />} />
              <Route path="/mobile/job/:id" element={<MobileTicketDetail />} />
              <Route path="/mobile/inbox" element={<InboxPage />} />
              <Route path="/mobile/finance" element={<MobileFinancePage />} />
              <Route path="/mobile/notifications" element={<MobileNotificationsPage />} />
            </Route>

            {/* Admin Layout Pages */}
            <Route element={<AdminLayout currentUser={currentUser} onLogout={handleLogout} />}>
              <Route path="/" element={<CEODashboard />} />
              <Route path="/tickets" element={<TradeInDashboardWrapper />} />
              <Route path="/workspace/:id" element={<B2CWorkspacePageWrapper />} />
              <Route path="/qc-station" element={<QCStation />} />
              <Route path="/b2b-auditor" element={<B2BAuditorTool />} />
              <Route path="/analytics/trade-in" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <Analytics mode="buying" /> : <Navigate to="/" replace />} />
              <Route path="/analytics/sales" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <Analytics mode="sales" /> : <Navigate to="/" replace />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/accessories" element={<Accessories />} />
              <Route path="/sales-history" element={<SalesHistory />} />
              <Route path="/stock-audit" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <StockAudit /> : <Navigate to="/" replace />} />
              <Route path="/finance" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' || currentUser?.role === 'FINANCE' ? <Finance /> : <Navigate to="/" replace />} />
              <Route path="/daily-expenses" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' || currentUser?.role === 'FINANCE' ? <DailyExpenses /> : <Navigate to="/" replace />} />
              <Route path="/riders" element={<RiderManagement />} />
              <Route path="/discrepancy-reports" element={<DiscrepancyReports />} />
              <Route path="/crm" element={<CustomerCRM />} />
              <Route path="/customer-crm" element={<Navigate to="/crm" replace />} />
              <Route path="/traceability" element={<Traceability />} />
              <Route path="/warranty" element={<WarrantyClaims />} />
              <Route path="/pricing" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <PriceEditor /> : <Navigate to="/" replace />} />
              <Route path="/staff" element={currentUser?.role === 'CEO' ? <StaffManagement /> : <Navigate to="/" replace />} />
              <Route path="/coupons" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <CouponManager /> : <Navigate to="/" replace />} />
              <Route path="/reviews" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <ReviewManager /> : <Navigate to="/" replace />} />
              <Route path="/global-settings" element={currentUser?.role === 'CEO' ? <GlobalSettings /> : <Navigate to="/" replace />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/admin/branches" element={currentUser?.role === 'CEO' || currentUser?.role === 'MANAGER' ? <BranchManager /> : <Navigate to="/" replace />} />
            </Route>
          </>
        ) : (
          <Route path="*" element={<SavePathAndRedirect />} />
        )}
      </Routes>
      </Suspense>
    </Router>
    <Toaster position="top-right" />
    </ToastProvider>
  );
}

// --- Route Wrappers ---
const CustomerTrackingWrapper = () => {
  const { id } = useParams();
  return <CustomerTracking jobId={id as string} />;
};

const B2CWorkspacePageWrapper = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  return <B2CWorkspacePage id={id as string} onBack={() => navigate('/tickets')} />;
};

const TradeInDashboardWrapper = () => {
  const navigate = useNavigate();
  return <TradeInDashboard onOpenWorkspace={(id: string) => navigate(`/workspace/${id}`)} />;
};


const SavePathAndRedirect = () => {
  const location = useLocation();
  const intendedPath = location.pathname + location.search;
  if (intendedPath && intendedPath !== '/login' && intendedPath !== '/') {
    sessionStorage.setItem('bkk_redirect', intendedPath);
  }
  return <Navigate to="/login" replace />;
};

const RedirectAfterLogin = () => {
  const redirectTo = sessionStorage.getItem('bkk_redirect') || '/';
  sessionStorage.removeItem('bkk_redirect');
  return <Navigate to={redirectTo} replace />;
};

const POSButtonWrapper = ({ to, label }: { to: string, label: string }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="absolute top-6 right-6 z-50 px-4 py-2 bg-slate-900 text-white rounded-xl font-black text-xs uppercase shadow-md hover:bg-black transition-colors"
    >
      {label}
    </button>
  );
};
