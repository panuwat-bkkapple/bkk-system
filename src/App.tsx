import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate, useParams } from 'react-router-dom';
import { LoginScreen } from './components/auth/LoginScreen';
import { AdminLayout } from './components/layout/AdminLayout';
import { auth, db } from './api/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, get, push, set } from 'firebase/database';

// --- Pages Import ---
import { TradeInDashboard } from './features/trade-in/TradeInDashboard';
import { Inventory } from './pages/inventory/Inventory';
import { Analytics } from './pages/analytics/Analytics';
import { Evaluation } from './features/trade-in/Evaluation';
import { PriceEditor } from './features/trade-in/PriceEditor';
import { QCStation } from './pages/lab/QCStation';
import { DispatcherPage } from './pages/fleet/DispatcherPage';
import { POS } from './pages/sales/POS';
import { Accessories } from './pages/inventory/Accessories';
import { SalesHistory } from './pages/sales/SalesHistory';
import { Traceability } from './pages/inventory/Traceability';
import { Customers } from './pages/crm/Customers';
import { StaffManagement } from './pages/settings/StaffManagement';
import { WarrantyClaims } from './pages/crm/WarrantyClaims';
import { CEODashboard } from './pages/dashboard/CEODashboard';
import { DailyExpenses } from './pages/finance/DailyExpenses';
import { StockAudit } from './pages/inventory/StockAudit';
import { Finance } from './pages/finance/Finance';
import { B2BAuditorTool } from './features/trade-in/components/b2b/B2BAuditorTool';
import { CustomerCRM } from './pages/crm/CustomerCRM';
import { RiderManagement } from './pages/fleet/RiderManagement';
import { CustomerTracking } from './pages/tracking/CustomerTracking';
import { B2CWorkspacePage } from '@/pages/admin/B2CWorkspacePage';
import { InvoicePage } from './features/trade-in/pages/InvoicePage';
import { CouponManager } from './pages/admin/CouponManager';
import GlobalSettings from './pages/admin/GlobalSettings';
import BranchManager from './pages/admin/BranchManager';
import ReviewManager from './pages/admin/ReviewManager';
import { InboxPage } from './pages/inbox/InboxPage';
import { ToastProvider } from './components/ui/ToastProvider';

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
      <Routes>
        {/* Public Routes */}
        <Route path="/track/:id" element={<CustomerTrackingWrapper />} />

        {/* Login Route */}
        <Route
          path="/login"
          element={!currentUser ? <LoginScreen onLogin={handleLogin} /> : <Navigate to="/" replace />}
        />

        {/* Protected Routes */}
        {currentUser ? (
          <>
            {/* Full Screen Pages (no sidebar) */}
            <Route path="/pos" element={<div className="relative min-h-screen"><POSButtonWrapper to="/inventory" label="Exit POS" /><POS /></div>} />
            <Route path="/dispatcher" element={<div className="relative min-h-screen bg-[#F5F7FA]"><POSButtonWrapper to="/tickets" label="กลับสู่ระบบหลังบ้าน (Exit)" /><DispatcherPage /></div>} />
            <Route path="/invoice/:id" element={<InvoicePage />} />

            {/* Admin Layout Pages */}
            <Route element={<AdminLayout currentUser={currentUser} onLogout={handleLogout} />}>
              <Route path="/" element={<CEODashboard />} />
              <Route path="/tickets" element={<TradeInDashboardWrapper />} />
              <Route path="/workspace/:id" element={<B2CWorkspacePageWrapper />} />
              <Route path="/evaluation" element={<Evaluation />} />
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
              <Route path="/crm" element={<Customers />} />
              <Route path="/customer-crm" element={<CustomerCRM />} />
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
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </Router>
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
