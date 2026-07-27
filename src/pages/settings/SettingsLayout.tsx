import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { visibleSettingsGroups } from './settingsNav';

// Layout ครอบหน้าตั้งค่า (ยกเว้นหน้า immersive อย่าง Catalog): เมนูซ้าย
// จัดกลุ่ม Company / Basic / Advanced แบบ Reusely — เห็นทุกหน้าตั้งค่า
// ค้างไว้ สลับหน้าได้โดยไม่ต้องถอยกลับ hub. ซ่อนบนจอเล็ก (ใช้ hub แทน)
export const SettingsLayout: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const groups = visibleSettingsGroups(currentUser?.role);

  return (
    <div className="flex min-h-[calc(100vh-49px)]">
      <aside className="hidden lg:block w-64 shrink-0 bg-white border-r border-slate-200">
        <div className="sticky top-[49px] p-5 max-h-[calc(100vh-49px)] overflow-y-auto">
          <button
            onClick={() => navigate('/settings')}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-black transition mb-4 ${location.pathname === '/settings' ? 'bg-blue-600 text-white' : 'text-slate-800 hover:bg-slate-50'}`}
          >
            <Settings size={16} /> Settings
          </button>
          {groups.map(group => (
            <div key={group.key} className="mb-5">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3 mb-1.5">{group.title}</p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const active = location.pathname === item.path
                    || (item.path !== '/pricing' && location.pathname.startsWith(`${item.path}/`))
                    || (item.path === '/pricing' && location.pathname.startsWith('/pricing') && !location.pathname.startsWith('/pricing/condition-sets'));
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-bold text-left transition ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                    >
                      <span className={active ? 'text-blue-600' : 'text-slate-400'}>{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
};

export default SettingsLayout;
