import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { Boxes, ClipboardList, UserRound, LogOut } from 'lucide-react';
import { DealerSessionProvider, useDealerSession } from './hooks/useDealerSession';
import { Login } from './pages/Login';
import { LotList } from './pages/LotList';
import { LotDetailPage } from './pages/LotDetailPage';
import { Orders } from './pages/Orders';
import { OrderDetail } from './pages/OrderDetail';
import { Profile } from './pages/Profile';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { dealer, logout } = useDealerSession();
  const loc = useLocation();
  return (
    <>
      <header className="topbar">
        <div className="brand">GETMOBIE <span>DEALER</span></div>
        <div className="who">
          <div>{dealer?.company_name}</div>
          <button onClick={() => void logout()}>
            <LogOut size={11} /> ออกจากระบบ
          </button>
        </div>
      </header>
      <main className="shell">{children}</main>
      <nav className="tabbar">
        <NavLink to="/" className={loc.pathname === '/' || loc.pathname.startsWith('/lots') ? 'active' : ''}>
          <Boxes size={20} /> ล็อตสินค้า
        </NavLink>
        <NavLink to="/orders" className={loc.pathname.startsWith('/orders') ? 'active' : ''}>
          <ClipboardList size={20} /> คำสั่งซื้อ
        </NavLink>
        <NavLink to="/profile" className={loc.pathname === '/profile' ? 'active' : ''}>
          <UserRound size={20} /> โปรไฟล์
        </NavLink>
      </nav>
    </>
  );
};

const Guarded = () => {
  const { loading, dealer } = useDealerSession();
  if (loading) return <div className="loading">กำลังโหลด...</div>;
  if (!dealer) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<LotList />} />
        <Route path="/lots/:id" element={<LotDetailPage />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/profile" element={<Profile />} />
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
