import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Boxes, ClipboardList, UserRound, LogOut, BadgeCheck } from 'lucide-react';
import { DealerSessionProvider, useDealerSession } from './hooks/useDealerSession';
import { MEMBER_ROLE_LABEL, TIER_COLOR, TIER_LABEL } from './types';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { LotList } from './pages/LotList';
import { LotDetailPage } from './pages/LotDetailPage';
import { DeviceReport } from './pages/DeviceReport';
import { Orders } from './pages/Orders';
import { OrderDetail } from './pages/OrderDetail';
import { Profile } from './pages/Profile';
import { GradingStandards } from './pages/GradingStandards';
import { Onboarding, shouldShowOnboarding } from './pages/Onboarding';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { dealer, memberName, memberRole, logout } = useDealerSession();
  const loc = useLocation();
  const active = {
    home: loc.pathname === '/',
    lots: loc.pathname.startsWith('/lots'),
    orders: loc.pathname.startsWith('/orders'),
    profile: loc.pathname === '/profile',
    grading: loc.pathname === '/grading',
  };
  return (
    <>
      {/* mobile: topbar + tabbar (ซ่อนบน desktop) */}
      <header className="topbar">
        <div className="brand">GETMOBIE <span>DEALER</span></div>
        <div className="who">
          <div>{memberName && memberName !== dealer?.company_name ? `${memberName} · ${dealer?.company_name}` : dealer?.company_name}</div>
          <button onClick={() => void logout()}>
            <LogOut size={11} /> ออกจากระบบ
          </button>
        </div>
      </header>

      {/* desktop ≥1024px: side navigation (ตาม SideNavBar ในจอ Stitch ชุด DealerPortal, render ธีม Modern) */}
      <aside className="sidenav">
        <div className="brand">GETMOBIE <span>DEALER</span></div>
        <div className="side-co">
          <div className="bold small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dealer?.company_name}
          </div>
          {dealer?.tier && (
            <span className="tier-badge" style={{ background: TIER_COLOR[dealer.tier] || 'var(--brand)', marginTop: 6 }}>
              {TIER_LABEL[dealer.tier] || `Tier ${dealer.tier}`}
            </span>
          )}
        </div>
        <nav className="side-links">
          <NavLink to="/" className={`nav ${active.home ? 'on' : ''}`}>
            <LayoutDashboard size={17} /> หน้าหลัก
          </NavLink>
          <NavLink to="/lots" className={`nav ${active.lots ? 'on' : ''}`}>
            <Boxes size={17} /> ล็อตสินค้า
          </NavLink>
          <NavLink to="/orders" className={`nav ${active.orders ? 'on' : ''}`}>
            <ClipboardList size={17} /> คำสั่งซื้อ
          </NavLink>
          <NavLink to="/profile" className={`nav ${active.profile ? 'on' : ''}`}>
            <UserRound size={17} /> โปรไฟล์
          </NavLink>
          <div className="side-sep" />
          <NavLink to="/grading" className={`nav ${active.grading ? 'on' : ''}`}>
            <BadgeCheck size={17} /> เกณฑ์การเกรด
          </NavLink>
        </nav>
        <div className="side-foot">
          <span className="avatar">{(memberName || dealer?.company_name || '?').charAt(0).toUpperCase()}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="bold tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {memberName || dealer?.company_name}
            </div>
            <div className="tiny muted bold">{MEMBER_ROLE_LABEL[memberRole]}</div>
          </div>
          <button className="btn ghost small" style={{ padding: 8 }} title="ออกจากระบบ" onClick={() => void logout()}>
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* หน้าที่มีเลย์เอาต์ desktop หลายคอลัมน์ตาม Stitch — ขยาย container:
          Dashboard (bento), Orders (list + timeline), Diagnostic Report (grid หมวดผลตรวจ) */}
      <div className="content">
        <main
          className={
            ['/', '/orders', '/lots', '/profile', '/grading'].includes(loc.pathname) || /^\/lots\/[^/]+\/device\//.test(loc.pathname)
              ? 'shell wide'
              : 'shell'
          }
        >
          {children}
        </main>
      </div>

      <nav className="tabbar">
        <NavLink to="/" className={active.home ? 'active' : ''}>
          <LayoutDashboard size={20} /> หน้าหลัก
        </NavLink>
        <NavLink to="/lots" className={active.lots ? 'active' : ''}>
          <Boxes size={20} /> ล็อตสินค้า
        </NavLink>
        <NavLink to="/orders" className={active.orders ? 'active' : ''}>
          <ClipboardList size={20} /> คำสั่งซื้อ
        </NavLink>
        <NavLink to="/profile" className={active.profile ? 'active' : ''}>
          <UserRound size={20} /> โปรไฟล์
        </NavLink>
      </nav>
    </>
  );
};

const Guarded = () => {
  const { loading, dealer } = useDealerSession();
  // onboarding ครั้งแรกหลัง login (state init ครั้งเดียว — จบแล้วจำใน localStorage)
  const [showOnboard, setShowOnboard] = useState(shouldShowOnboarding);
  if (loading) return <div className="loading">กำลังโหลด...</div>;
  if (!dealer) return <Login />;
  if (showOnboard) return <Onboarding onDone={() => setShowOnboard(false)} />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/lots" element={<LotList />} />
        <Route path="/lots/:id" element={<LotDetailPage />} />
        <Route path="/lots/:id/device/:jobId" element={<DeviceReport />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/grading" element={<GradingStandards />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};

export default function App() {
  return (
    <DealerSessionProvider>
      <BrowserRouter>
        <Guarded />
      </BrowserRouter>
    </DealerSessionProvider>
  );
}
