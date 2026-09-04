import { useEffect, useState } from 'react';
import { Home as HomeIcon, CalendarPlus, Repeat, Inbox as InboxIcon, CalendarDays, LogOut, Loader2 } from 'lucide-react';
import { useEmployeeSession } from './hooks/useEmployeeSession';
import { useGeolocation } from './hooks/useGeolocation';
import { geoBlockReason } from './geo';
import Login from './pages/Login';
import GpsGate from './pages/GpsGate';
import Home from './pages/Home';
import Leave from './pages/Leave';
import ShiftChange from './pages/ShiftChange';
import Inbox from './pages/Inbox';
import History from './pages/History';

type Tab = 'home' | 'leave' | 'shift' | 'inbox' | 'history';

const TABS: { id: Tab; label: string; icon: typeof HomeIcon }[] = [
  { id: 'home', label: 'ลงเวลา', icon: HomeIcon },
  { id: 'leave', label: 'ขอลา', icon: CalendarPlus },
  { id: 'shift', label: 'เปลี่ยนกะ', icon: Repeat },
  { id: 'inbox', label: 'อนุมัติ', icon: InboxIcon },
  { id: 'history', label: 'ประวัติ', icon: CalendarDays },
];

export default function App() {
  const { user, ready, logout } = useEmployeeSession();
  const geo = useGeolocation();
  const [tab, setTab] = useState<Tab>('home');
  // lazy initializer — `useState(Date.now())` เรียกฟังก์ชันที่ไม่บริสุทธิ์
  // ตอน render ทุกครั้ง (ค่าถูกทิ้ง แต่ lint จับได้ถูกแล้ว)
  const [now, setNow] = useState(() => Date.now());

  // นาฬิกาเดินเองทุก 15 วินาที เพื่อให้ "พิกัดเก่า" ถูกจับได้จริง — ถ้าคำนวณ
  // อายุพิกัดครั้งเดียวตอน render แรก หน้าจอจะค้างอยู่ที่ "ผ่าน" ตลอดไป
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  if (!ready) {
    return <div className="gate center"><Loader2 size={22} className="spin" /></div>;
  }
  if (!user) return <Login />;

  const block = geoBlockReason({
    supported: geo.supported,
    secureContext: geo.secureContext,
    permission: geo.permission,
    fix: geo.fix,
    error: geo.error,
    now,
    asked: geo.asked,
  });

  // **ไม่อนุญาตตำแหน่ง = ใช้แอปไม่ได้ทั้งแอป** ไม่ใช่แค่ปุ่มลงเวลาถูกปิด
  if (block) return <GpsGate block={block} onAct={geo.request} />;

  return (
    <div className="app">
      <div className="head">
        <div className="row">
          <div>
            <h1>แอปพนักงาน</h1>
            <div className="sub">BKK APPLE</div>
          </div>
          <button className="btn ghost sm" onClick={() => void logout()}>
            <LogOut size={13} /> ออก
          </button>
        </div>
      </div>

      <div className="main">
        {tab === 'home' && geo.fix && <Home fix={geo.fix} />}
        {tab === 'leave' && <Leave />}
        {tab === 'shift' && <ShiftChange />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'history' && <History />}
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            <t.icon size={19} strokeWidth={tab === t.id ? 2.4 : 1.8} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
