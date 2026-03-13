import { useNavigate, useLocation } from 'react-router-dom';

interface NavButtonProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  badgeCount?: number;
}

export const NavButton = ({ to, icon, label, collapsed, badgeCount }: NavButtonProps) => {
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
        {collapsed && badgeCount && badgeCount > 0 ? (
          <span className="absolute -top-1 -right-1 bg-red-500 border-2 border-white w-3 h-3 rounded-full"></span>
        ) : null}
      </div>

      {!collapsed && (
        <div className="flex-1 flex justify-between items-center overflow-hidden">
          <span className="whitespace-nowrap animate-in fade-in slide-in-from-left-1">{label}</span>
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
