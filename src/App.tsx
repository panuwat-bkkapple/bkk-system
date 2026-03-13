// src/App.tsx
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, Navigate, Outlet, useParams } from 'react-router-dom';
import { LoginScreen } from './components/auth/LoginScreen';
import {
  LayoutDashboard, Package, LogOut, ClipboardCheck,
  BarChart3, TrendingUp, Banknote, Settings,
  Smartphone, ChevronLeft, ChevronRight,
  Map as MapIcon, ShoppingCart, Store, Headphones, Receipt, ShieldCheck,
  User, Users, ShieldAlert, Activity, ReceiptText, ScanLine, Map, ArrowRight,
  Bell, Circle, UserCheck, Building2, Ticket,
  MessageSquareQuote // 🌟 1. เพิ่ม Import ไอคอน MessageSquareQuote
} from 'lucide-react';
import { auth, db } from './api/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, update, onValue } from 'firebase/database';
import type { User as FirebaseUser } from 'firebase/auth';

// --- Pages Import ---
import { TradeInDashboard } from './features/trade-in/TradeInDashboard';
import { Inventory } from './pages/inventory/Inventory';
import { Analytics } from './pages/analytics/Analytics';
import { Evaluation } from './features/trade-in/Evaluation';
import { PriceEditor } from './features/trade-in/PriceEditor';
import { QCStation } from './pages/lab/QCStation';
import { SettlementPage } from './pages/finance/SettlementPage';
import { WithdrawalPage } from './pages/finance/WithdrawalPage';
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

// 🌟 2. Import หน้า Review Manager (⚠️ แก้ Path ให้ตรงกับที่คุณเซฟไว้นะครับ)
import ReviewManager from './pages/admin/ReviewManager';

// ==========================================
// 🚀 1. คอมโพเนนต์ปุ่มเมนู (NavButton) แบบใหม่ (รองรับการแสดงตัวเลข Badge แจ้งเตือน)
// ==========================================
const NavButton = ({ to, icon, label, collapsed, badgeCount }: { to: string, icon: any, label: string, collapsed: boolean, badgeCount?: number }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === to;

  return (
    <button
      onClick={() => navigate(to)}
      title={collapsed ? label : ''}
      className={`w-full flex items-center transition-all duration-200 rounded-xl font-bold ${active ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-gray-500 hover:bg-gray-50'} ${collapsed ? 'justify-center p-3 relative' : 'gap-3 px-5 py-3 text-sm'}`}
    >
      <div className="shrink-0 relative">
        {icon}
        {/* แสดงจุดแดงเตือนตอนเมนูหด (Collapsed) */}
        {collapsed && badgeCount && badgeCount > 0 ? (
          <span className="absolute -top-1 -right-1 bg-red-500 border-2 border-white w-3 h-3 rounded-full"></span>
        ) : null}
      </div>

      {!collapsed && (
        <div className="flex-1 flex justify-between items-center overflow-hidden">
          <span className="whitespace-nowrap animate-in fade-in slide-in-from-left-1">{label}</span>
          {/* แสดงตัวเลขเตือนตอนเมนูขยาย */}
          {badgeCount && badgeCount > 0 ? (
            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
              {badgeCount}
            </span>
          ) : null}
        </div>
      )}
    </button>
  );
};

// ==========================================
// 🏢 2. โครงร่างระบบหลังบ้าน (Admin Layout) มีแถบเมนูด้านซ้าย
// ==========================================
const AdminLayout = ({ currentUser, onLogout }: { currentUser: any, onLogout: () => void }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();

  // 🌟 State สำหรับเก็บจำนวนรีวิวที่รออนุมัติ
  const [pendingReviews, setPendingReviews] = useState(0);

  const hasAccess = (allowedRoles: string[]) => {
    return allowedRoles.includes(currentUser?.role);
  };

  // 🌟 ดึงข้อมูลจำนวนรีวิวที่รออนุมัติแบบ Real-time
  useEffect(() => {
    const reviewsRef = ref(db, 'reviews');
    const unsub = onValue(reviewsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const count = Object.values(data).filter((r: any) => r.status === 'pending').length;
        setPendingReviews(count);
      } else {
        setPendingReviews(0);
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex transition-all duration-300">
      {/* Sidebar */}
      <aside className={`${isCollapsed ? 'w-20' : 'w-72'} bg-white border-r flex flex-col fixed h-full z-20 shadow-sm transition-all duration-300 ease-in-out`}>
        <button onClick={() => setIsCollapsed(!isCollapsed)} className="absolute -right-3 top-10 bg-white border shadow-md rounded-full p-1 z-30 text-gray-400 hover:text-blue-600 transition-colors">
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <div className={`h-20 flex items-center ${isCollapsed ? 'justify-center' : 'px-8'} border-b overflow-hidden`}>
          <h1 className="font-black text-xl text-[#0071E3] tracking-tighter uppercase flex items-center gap-2 whitespace-nowrap">
            BKK {isCollapsed ? '' : <><span className="animate-in fade-in duration-500">APPLE</span> <span className="bg-blue-100 text-blue-600 text-[10px] px-2 py-0.5 rounded-full">PRO</span></>}
          </h1>
        </div>

        <nav className="p-4 space-y-6 flex-1 overflow-y-auto no-scrollbar pb-20 overflow-x-hidden">
          {/* Trade-In Dept */}
          <div>
            {!isCollapsed && <p className="text-[10px] font-black text-gray-400 uppercase px-4 mb-2 tracking-widest">Trade-In Management</p>}
            <div className="space-y-1">
              {hasAccess(['CEO', 'MANAGER']) && <NavButton collapsed={isCollapsed} to="/" icon={<Activity size={18} />} label="ภาพรวม (Dashboard)" />}
              <NavButton collapsed={isCollapsed} to="/tickets" icon={<LayoutDashboard size={18} />} label="Tickets" />
              <NavButton collapsed={isCollapsed} to="/evaluation" icon={<ClipboardCheck size={18} />} label="ประเมินราคาใหม่" />
              <NavButton collapsed={isCollapsed} to="/qc-station" icon={<ClipboardCheck size={18} />} label="QC Lab Station" />
              <NavButton collapsed={isCollapsed} to="/b2b-auditor" icon={<ScanLine size={18} />} label="สแกนหน้างาน (B2B)" />
              {hasAccess(['CEO', 'MANAGER']) && <NavButton collapsed={isCollapsed} to="/analytics/trade-in" icon={<BarChart3 size={18} />} label="สถิติการรับซื้อ" />}
            </div>
          </div>

          {/* Inventory & Sales Dept */}
          <div>
            {!isCollapsed && <p className="text-[10px] font-black text-gray-400 uppercase px-4 mb-2 tracking-widest">Inventory & Sales</p>}
            <div className="space-y-1">
              <NavButton collapsed={isCollapsed} to="/inventory" icon={<Package size={18} />} label="คลังสินค้า" />
              <NavButton collapsed={isCollapsed} to="/accessories" icon={<Headphones size={18} />} label="อุปกรณ์เสริม (Accessories)" />
              <NavButton collapsed={isCollapsed} to="/sales-history" icon={<Receipt size={18} />} label="ประวัติการขาย & คืนสินค้า" />
              {hasAccess(['CEO', 'MANAGER']) && <NavButton collapsed={isCollapsed} to="/stock-audit" icon={<ScanLine size={18} />} label="นับสต็อก (Stock Audit)" />}
              {hasAccess(['CEO']) && <NavButton collapsed={isCollapsed} to="/analytics/sales" icon={<TrendingUp size={18} />} label="วิเคราะห์กำไร" />}
            </div>
          </div>

          {/* Finance & Rider Dept */}
          <div>
            {!isCollapsed && <p className="text-[10px] font-black text-gray-400 uppercase px-4 mb-2 tracking-widest">Finance & Rider</p>}
            <div className="space-y-1">
              <NavButton collapsed={isCollapsed} to="/finance" icon={<Banknote size={18} />} label="ระบบบัญชี (Finance)" />
              <NavButton collapsed={isCollapsed} to="/daily-expenses" icon={<ReceiptText size={18} />} label="บันทึกเบิกจ่ายจิปาถะ" />
              <NavButton collapsed={isCollapsed} to="/riders" icon={<UserCheck size={18} />} label="จัดการไรเดอร์" />
            </div>
          </div>

          {/* CRM & Marketing */}
          {hasAccess(['CEO', 'MANAGER']) && (
            <div>
              {!isCollapsed && <p className="text-[10px] font-black text-gray-400 uppercase px-4 mb-2 tracking-widest">CRM & Marketing</p>}
              <div className="space-y-1">
                <NavButton collapsed={isCollapsed} to="/crm" icon={<User size={18} />} label="ฐานข้อมูลลูกค้า (CRM)" />
                <NavButton collapsed={isCollapsed} to="/coupons" icon={<Ticket size={18} />} label="จัดการแคมเปญคูปอง" />

                {/* 🌟 3. เพิ่มปุ่มเมนูจัดการรีวิวตรงนี้ พร้อมส่ง Badge Count ไปด้วย */}
                <NavButton collapsed={isCollapsed} to="/reviews" icon={<MessageSquareQuote size={18} />} label="จัดการรีวิว (Reviews)" badgeCount={pendingReviews} />

                <NavButton collapsed={isCollapsed} to="/traceability" icon={<ShieldCheck size={18} />} label="สืบประวัติสินค้า (Trace)" />
                <NavButton collapsed={isCollapsed} to="/warranty" icon={<ShieldAlert size={18} />} label="รับประกัน & เคลม (Claims)" />
                <NavButton collapsed={isCollapsed} to="/customer-crm" icon={<Users size={18} />} label="Customer CRM (Advanced)" />

              </div>
            </div>
          )}
          {/* Terminal Apps */}
          <div className={`pt-4 mt-2 border-t border-gray-100 bg-gray-50/50 rounded-xl transition-all ${isCollapsed ? 'p-1 mx-1' : 'p-2 mx-2'}`}>
            {!isCollapsed && <p className="text-[10px] font-black text-purple-400 uppercase px-2 mb-2 tracking-widest">Terminal Apps</p>}
            <div className="space-y-2">
              <button onClick={() => navigate('/pos')} className={`w-full flex items-center transition-all group rounded-xl font-bold bg-white text-gray-800 border border-purple-200 shadow-sm hover:shadow-md hover:border-purple-400 ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-4 py-3 text-sm'}`}>
                <div className="bg-purple-100 p-2 rounded-lg text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors shrink-0"><Store size={18} /></div>
                {!isCollapsed && <><span className="flex-1 text-left whitespace-nowrap overflow-hidden">POS หน้าร้าน</span><ShoppingCart size={16} className="text-gray-300 group-hover:text-purple-500" /></>}
              </button>
              <button onClick={() => navigate('/dispatcher')} className={`w-full flex items-center transition-all group rounded-xl font-bold bg-white text-gray-800 border border-orange-200 shadow-sm hover:shadow-md hover:border-orange-400 ${isCollapsed ? 'justify-center p-2' : 'gap-3 px-4 py-3 text-sm'}`}>
                <div className="bg-orange-100 p-2 rounded-lg text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-colors shrink-0"><Map size={18} /></div>
                {!isCollapsed && <><span className="flex-1 text-left whitespace-nowrap overflow-hidden">Dispatcher</span><ArrowRight size={16} className="text-gray-300 group-hover:text-orange-500" /></>}
              </button>
            </div>
          </div>

          {/* Settings */}
          <div className="pt-4 border-t border-gray-100 mt-4">
            <NavButton collapsed={isCollapsed} to="/global-settings" icon={<Settings size={18} />} label="ตั้งค่าระบบส่วนกลาง" />
            <NavButton collapsed={isCollapsed} to="/pricing" icon={<Settings size={18} />} label="Price Editor" />
            <NavButton collapsed={isCollapsed} to="/admin/branches" icon={<Store size={18} />} label="จัดการสาขา" />
            <NavButton collapsed={isCollapsed} to="/staff" icon={<Users size={18} />} label="จัดการพนักงาน (Staff)" />
          </div>
        </nav>


        {/* Profile & Logout */}
        <div className="mt-auto border-t border-slate-200 p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black shadow-md ${currentUser?.role === 'CEO' ? 'bg-purple-600' : currentUser?.role === 'MANAGER' ? 'bg-blue-600' : 'bg-emerald-600'}`}>
              {currentUser?.name?.charAt(0) || 'A'}
            </div>
            {!isCollapsed && (
              <div className="overflow-hidden">
                <div className="font-black text-sm text-slate-800 truncate">{currentUser?.name}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{currentUser?.role}</div>
              </div>
            )}
          </div>
          <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-500 hover:bg-red-500 hover:text-white py-3 rounded-xl font-black text-xs uppercase transition-colors">
            <LogOut size={16} /> {!isCollapsed && 'ออกจากระบบ'}
          </button>
        </div>
      </aside>

      {/* 🌟 พื้นที่แสดงผลเนื้อหาแต่ละหน้า (Outlet) */}
      <main className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-20' : 'ml-72'}`}>
        <Outlet />
      </main>
    </div>
  );
};


// ==========================================
// 🌐 3. ตัวจัดการแอปพลิเคชันหลัก (Main Router)
// ==========================================
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = sessionStorage.getItem('bkk_session');
    return saved ? JSON.parse(saved) : null;
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      
      // ⚡ AUTO-LOGIN: ถ้า Firebase Auth ผ่าน → เข้า Dashboard เลย ไม่ต้องเลือก user
      if (firebaseUser && !currentUser) {
        const autoUser = {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Admin',
          email: firebaseUser.email || '',
          role: 'CEO'
        };
        sessionStorage.setItem('bkk_session', JSON.stringify(autoUser));
        setCurrentUser(autoUser);
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
    <Router>
      <Routes>

        {/* 🟢 PUBLIC ROUTES (ไม่ต้อง Login) */}
        <Route path="/track/:id" element={<CustomerTrackingWrapper />} />

        {/* 🟡 LOGIN ROUTE */}
        <Route
          path="/login"
          element={!currentUser ? <LoginScreen onLogin={handleLogin} /> : <Navigate to="/" replace />}
        />

        {/* 🔴 PROTECTED ROUTES (ต้อง Login) */}
        {currentUser ? (
          <>
            {/* --- หน้าแบบเต็มจอ (Full Screen) ไม่มีแถบเมนู --- */}
            <Route path="/pos" element={<div className="relative min-h-screen"><POSButtonWrapper to="/inventory" label="Exit POS" /><POS /></div>} />
            <Route path="/dispatcher" element={<div className="relative min-h-screen bg-[#F5F7FA]"><POSButtonWrapper to="/tickets" label="กลับสู่ระบบหลังบ้าน (Exit)" /><DispatcherPage /></div>} />
            <Route path="/invoice/:id" element={<InvoicePage />} />

            {/* --- หน้าระบบหลังบ้านปกติ (มีแถบเมนู) --- */}
            <Route element={<AdminLayout currentUser={currentUser} onLogout={handleLogout} />}>
              <Route path="/" element={<CEODashboard onNavigate={() => { }} />} />
              <Route path="/tickets" element={<TradeInDashboardWrapper />} />
              <Route path="/workspace/:id" element={<B2CWorkspacePageWrapper />} />
              <Route path="/evaluation" element={<Evaluation />} />
              <Route path="/qc-station" element={<QCStation />} />
              <Route path="/b2b-auditor" element={<B2BAuditorTool />} />
              <Route path="/analytics/trade-in" element={<Analytics mode="buying" />} />
              <Route path="/analytics/sales" element={<Analytics mode="sales" />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/accessories" element={<Accessories />} />
              <Route path="/sales-history" element={<SalesHistory />} />
              <Route path="/stock-audit" element={<StockAudit />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/daily-expenses" element={<DailyExpenses />} />
              <Route path="/riders" element={<RiderManagement />} />
              <Route path="/crm" element={<Customers />} />
              <Route path="/customer-crm" element={<CustomerCRM />} />
              <Route path="/traceability" element={<Traceability />} />
              <Route path="/warranty" element={<WarrantyClaims />} />
              <Route path="/pricing" element={<PriceEditor />} />
              <Route path="/staff" element={<StaffManagement />} />
              <Route path="/coupons" element={<CouponManager />} />
              <Route path="/reviews" element={<ReviewManager />} />
              <Route path="/global-settings" element={<GlobalSettings />} />
              <Route path="/admin/branches" element={<BranchManager />} />

            </Route>
          </>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}

      </Routes>
    </Router>
  );
}

// --- Wrappers เล็กๆ เพื่อช่วยให้โค้ดเก่าทำงานร่วมกับ React Router ได้ ---

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