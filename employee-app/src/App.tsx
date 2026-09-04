import { useCallback, useEffect, useState } from 'react';
import {
  Home as HomeIcon, CalendarPlus, Repeat, Inbox as InboxIcon, CalendarDays,
  LogOut, Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react';
import { useEmployeeSession } from './hooks/useEmployeeSession';
import { useGeolocation } from './hooks/useGeolocation';
import { geoBlockReason } from './geo';
import { appGate, sessionVerdict, type SessionState, type EmployeeMe } from './session';
import { call } from './api';
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
  const [session, setSession] = useState<SessionState | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  // lazy initializer — `useState(Date.now())` เรียกฟังก์ชันที่ไม่บริสุทธิ์
  // ตอน render ทุกครั้ง (ค่าถูกทิ้ง แต่ lint จับได้ถูกแล้ว)
  const [now, setNow] = useState(() => Date.now());

  // นาฬิกาเดินเองทุก 15 วินาที เพื่อให้ "พิกัดเก่า" ถูกจับได้จริง — ถ้าคำนวณ
  // อายุพิกัดครั้งเดียวตอน render แรก หน้าจอจะค้างอยู่ที่ "ผ่าน" ตลอดไป
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // ── ถามว่าเป็นพนักงานคนไหน ─────────────────────────────────────────────
  //
  // **บัญชี Auth ของโปรเจกต์นี้เป็นกองเดียวกันทั้งระบบ** (พนักงาน ไรเดอร์
  // ดีลเลอร์ และลูกค้า) หน้าล็อกอินจึงไม่ได้กันใครเลย ตัวที่กันคือด่านนี้ —
  // และมันต้องมาก่อนการขอสิทธิ์ตำแหน่ง (ดู `session.ts`)
  const identify = useCallback(async () => {
    setSession({ kind: 'checking' });
    try {
      const me = await call<EmployeeMe>('employeeMe');
      setSession({ kind: 'employee', me });
      setLoginNotice(null);
    } catch (e) {
      setSession(sessionVerdict(e));
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) { setSession(null); return; }
    void identify();
  }, [ready, user, identify]);

  // ไม่ใช่พนักงาน = ออกจากระบบทันที และพาเหตุผลไปขึ้นบนหน้าล็อกอิน
  // (ปล่อยให้ session ค้างไว้เฉยๆ แปลว่าคนแปลกหน้ายังถือ session ของเราอยู่)
  useEffect(() => {
    if (session?.kind !== 'rejected') return;
    setLoginNotice(session.message);
    void logout();
  }, [session, logout]);

  const view = appGate({
    authReady: ready,
    signedIn: Boolean(user),
    session,
    geoBlock: geoBlockReason({
      supported: geo.supported,
      secureContext: geo.secureContext,
      permission: geo.permission,
      fix: geo.fix,
      error: geo.error,
      now,
      asked: geo.asked,
    }),
    loginNotice,
  });

  if (view.screen === 'loading') {
    return <div className="gate center"><Loader2 size={22} className="spin" /></div>;
  }
  if (view.screen === 'login') return <Login notice={view.notice} />;
  if (view.screen === 'session_error') {
    return (
      <div className="gate">
        <div style={{ maxWidth: 380, width: '100%', margin: '0 auto' }}>
          <ShieldAlert size={38} strokeWidth={1.6} />
          <h2>เชื่อมต่อระบบไม่ได้</h2>
          <p>{view.message}</p>
          {/* ไม่เตะออกจากระบบ — ยังไม่รู้ว่าไม่ใช่พนักงาน รู้แค่ว่าถามไม่สำเร็จ */}
          <button className="btn ghost" onClick={() => void identify()}>
            <RefreshCw size={16} /> ลองใหม่
          </button>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => void logout()}>
            <LogOut size={13} /> ออกจากระบบ
          </button>
        </div>
      </div>
    );
  }
  if (view.screen === 'geo') return <GpsGate block={view.block} onAct={geo.request} />;

  const me = session?.kind === 'employee' ? session.me : null;

  return (
    <div className="app">
      <div className="head">
        <div className="row">
          <div>
            <h1>{me?.name || 'แอปพนักงาน'}</h1>
            <div className="sub">
              {me?.employee_code || 'BKK APPLE'}
              {me?.position ? ` · ${me.position}` : ''}
            </div>
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
