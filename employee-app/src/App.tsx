import { useCallback, useEffect, useState } from 'react';
import {
  Home as HomeIcon, CalendarPlus, Repeat, Inbox as InboxIcon, CalendarDays,
  LogOut, Loader2, RefreshCw, ShieldAlert,
} from 'lucide-react';
import { useEmployeeSession } from './hooks/useEmployeeSession';
import { useGeolocation } from './hooks/useGeolocation';
import { geoBlockReason } from './geo';
import { appGate, sessionVerdict, type SessionFailure, type EmployeeMe } from './session';

/** ผลของการถามตัวตนที่จบแล้ว — ไม่มี `checking` เพราะ "ยังไม่รู้" คือ `null` */
type SessionResolved = SessionFailure | { kind: 'employee'; me: EmployeeMe };
import { call } from './api';
import AppHeader from './AppHeader';
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
  // **ผูกผลการตรวจไว้กับ uid ที่ตรวจ** — เก็บเป็น state เปล่าๆ แล้วล้างตอน user
  // เปลี่ยน จะมีช่วงหนึ่งที่ผลของ *คนก่อนหน้า* ยังค้างอยู่บนจอของคนใหม่
  // (และการล้างใน effect คือ setState ตอน render ซึ่ง lint จับถูกแล้ว)
  const [session, setSession] = useState<{ uid: string; state: SessionResolved } | null>(null);
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
  // **คืนผล ไม่เซ็ต state เอง** — ผู้เรียกเป็นคนตัดสินว่าจะเก็บไหม ทำให้ effect
  // เซ็ต state ได้ใน `.then` (ไม่ใช่ตอน render) และทิ้งผลที่มาช้าหลัง unmount ได้
  const resolveMe = useCallback(async (): Promise<SessionResolved> => {
    try {
      return { kind: 'employee', me: await call<EmployeeMe>('employeeMe') };
    } catch (e) {
      return sessionVerdict(e);
    }
  }, []);

  // ผลที่ใช้ได้ = ผลที่ตรวจของ uid ที่ล็อกอินอยู่ตอนนี้เท่านั้น
  // `null` = ยังไม่รู้ ซึ่ง `appGate` แปลว่า "รอ" ไม่ใช่ "ปล่อยผ่าน"
  const state = user && session?.uid === user.uid ? session.state : null;

  useEffect(() => {
    if (!ready || !user || state) return;
    let alive = true;
    const uid = user.uid;
    void resolveMe().then((st) => { if (alive) setSession({ uid, state: st }); });
    // คำตอบที่มาถึงหลังผู้ใช้ออกจากระบบไปแล้ว ต้องไม่ถูกเก็บ
    return () => { alive = false; };
  }, [ready, user, state, resolveMe]);

  const retryIdentify = useCallback(() => {
    const uid = user?.uid;
    if (!uid) return;
    void resolveMe().then((st) => setSession({ uid, state: st }));
  }, [user, resolveMe]);

  // ไม่ใช่พนักงาน = ออกจากระบบทันที (ปล่อยให้ค้างไว้เฉยๆ แปลว่าคนแปลกหน้ายัง
  // ถือ session ของเราอยู่) — เหตุผลอยู่ใน `session` ซึ่งไม่ถูกล้างตอน logout
  // จึงยังขึ้นบนหน้าล็อกอินได้โดยไม่ต้องมี state ตัวที่สอง
  useEffect(() => {
    if (state?.kind !== 'rejected') return;
    void logout();
  }, [state, logout]);

  const loginNotice = session?.state.kind === 'rejected' ? session.state.message : null;

  const view = appGate({
    authReady: ready,
    signedIn: Boolean(user),
    session: state,
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
          <button className="btn ghost" onClick={retryIdentify}>
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

  const me = state?.kind === 'employee' ? state.me : null;

  return (
    <div className="app">
      <AppHeader
        name={me?.name || 'แอปพนักงาน'}
        sub={`${me?.employee_code || 'BKK APPLE'}${me?.position ? ` · ${me.position}` : ''}`}
        onLogout={() => void logout()}
      />

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
