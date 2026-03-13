import { useState, useEffect } from 'react';
import { useNavigate, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Package, LogOut, ClipboardCheck,
  BarChart3, TrendingUp, Banknote, Settings,
  ChevronLeft, ChevronRight,
  ShoppingCart, Store, Headphones, Receipt, ShieldCheck,
  User, Users, ShieldAlert, Activity, ReceiptText, ScanLine, Map, ArrowRight,
  Ticket, MessageSquareQuote, UserCheck
} from 'lucide-react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../api/firebase';
import { NavButton } from './NavButton';
import { useAdminPushNotifications } from '../../hooks/useAdminPushNotifications';

interface AdminLayoutProps {
  currentUser: any;
  onLogout: () => void;
}

export const AdminLayout = ({ currentUser, onLogout }: AdminLayoutProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const [pendingReviews, setPendingReviews] = useState(0);

  // Register admin FCM token for push notifications
  useAdminPushNotifications(currentUser?.uid || currentUser?.id || null);

  const hasAccess = (allowedRoles: string[]) => {
    return allowedRoles.includes(currentUser?.role);
  };

  useEffect(() => {
    const reviewsRef = ref(db, 'reviews');
    const unsub = onValue(reviewsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const count = Object.values(data).filter((r: any) => r && r.status === 'pending').length;
        setPendingReviews(count);
      } else {
        setPendingReviews(0);
      }
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex transition-all duration-300">
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

      <main className={`flex-1 transition-all duration-300 ${isCollapsed ? 'ml-20' : 'ml-72'}`}>
        <Outlet />
      </main>
    </div>
  );
};
