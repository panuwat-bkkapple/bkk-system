import { Plus, X } from 'lucide-react';
import { TABS, QUICK_ACTIONS } from './tabs';
import type { Screen, TabScreen } from './nav';
import { isTabScreen } from './nav';

/**
 * แถบล่าง — สี่แท่น + ปุ่มกลมตรงกลาง
 *
 * แยกไฟล์จาก `App.tsx` เพราะชั้นเบราว์เซอร์ของด่านต้อง SSR มันได้: ตอนมาร์กอัป
 * นี้ยังอยู่ใน App.tsx (ซึ่ง import Firebase) บั๊กคอนทราสต์ของปุ่มกลม 1.16:1
 * ลอดออกไปถึงมือผู้ใช้ได้ทั้งที่ด่านเขียวครบทุกช่อง
 */
export default function TabBar({ screen, onSelect, sheetOpen, onToggleSheet }: {
  screen: Screen;
  onSelect: (s: Screen) => void;
  sheetOpen: boolean;
  onToggleSheet: (open: boolean) => void;
}) {
  const current: TabScreen | null = isTabScreen(screen) ? screen : null;
  const btn = (t: (typeof TABS)[number]) => (
    <button key={t.id} aria-current={current === t.id} onClick={() => { onToggleSheet(false); onSelect(t.id); }}>
      <t.icon size={19} strokeWidth={current === t.id ? 2.3 : 1.8} />
      {t.label}
    </button>
  );
  return (
    <nav className="tabs">
      {sheetOpen && (
        <>
          <div className="sheetveil" onClick={() => onToggleSheet(false)} />
          <div className="sheet" role="menu">
            {QUICK_ACTIONS.map((a) => (
              <button key={a.id} role="menuitem"
                onClick={() => { onToggleSheet(false); onSelect(a.id); }}>
                <a.icon size={17} strokeWidth={1.9} /> {a.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="dock">
        {TABS.slice(0, 2).map(btn)}
        <div className="fabgap" aria-hidden="true" />
        {TABS.slice(2).map(btn)}
      </div>
      <button className="fab" aria-label={sheetOpen ? 'ปิดทางลัด' : 'ทางลัด'}
        aria-expanded={sheetOpen}
        onClick={() => onToggleSheet(!sheetOpen)}>
        {sheetOpen ? <X size={24} strokeWidth={2} /> : <Plus size={24} strokeWidth={2} />}
      </button>
    </nav>
  );
}
