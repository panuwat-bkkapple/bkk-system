import React from 'react';
import { useNavigate } from 'react-router-dom';
import { visibleSettingsGroups } from './settingsNav';

// หน้า landing รวมเมนูตั้งค่าทั้งระบบ (Reusely-style): การ์ดจัดกลุ่ม
// Company / Basic / Advanced, filter ตาม role ของผู้ใช้
export const SettingsHub: React.FC<{ currentUser: any }> = ({ currentUser }) => {
  const navigate = useNavigate();
  const groups = visibleSettingsGroups(currentUser?.role);

  return (
    <div className="p-4 lg:p-8 max-w-[1200px] mx-auto">
      <h1 className="text-3xl font-black text-slate-900">Settings</h1>
      <p className="text-sm font-bold text-slate-400 mt-1 mb-8">จัดการการตั้งค่าระบบทั้งหมดจากที่เดียว</p>

      {groups.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-400 font-bold">
          บัญชีของคุณไม่มีสิทธิ์เข้าถึงหน้าตั้งค่า
        </div>
      )}

      <div className="space-y-8">
        {groups.map(group => (
          <section key={group.key} className="bg-white border border-slate-200 rounded-3xl p-6 lg:p-8 shadow-sm">
            <h2 className="text-lg font-black text-slate-800">{group.title}</h2>
            <p className="text-xs font-bold text-slate-400 mt-0.5 mb-5">{group.subtitle}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {group.items.map(item => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className="flex items-start gap-4 text-left bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-400 hover:shadow-md transition group"
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-sm text-slate-800 group-hover:text-blue-700 transition-colors">{item.label}</div>
                    <div className="text-xs font-medium text-slate-400 mt-1 leading-relaxed">{item.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default SettingsHub;
