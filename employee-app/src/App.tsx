import { useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEmployeeSession } from './hooks/useEmployeeSession';
import { useGeolocation } from './hooks/useGeolocation';
import { geoBlockReason } from './geo';
import { appGate, sessionVerdict, type SessionFailure, type EmployeeMe } from './session';

/** ผลของการถามตัวตนที่จบแล้ว — ไม่มี `checking` เพราะ "ยังไม่รู้" คือ `null` */
type SessionResolved = SessionFailure | { kind: 'employee'; me: EmployeeMe };
import { call } from './api';
import AppHeader from './AppHeader';
import TabBar from './TabBar';
import { type Tab } from './tabs';
import GateShell from './GateShell';
import Login from './pages/Login';
import Splash from './pages/Splash';
import Onboarding from './pages/Onboarding';
import { onboardingSeen, shouldShowOnboarding } from './onboarding';
import GpsGate from './pages/GpsGate';
import Home from './pages/Home';
import Leave from './pages/Leave';
import ShiftChange from './pages/ShiftChange';
import Inbox from './pages/Inbox';
import History from './pages/History';

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
  // อ่านครั้งเดียวตอน mount — localStorage อ่านทุก render ไม่มีประโยชน์
  const [seenOnb, setSeenOnb] = useState(() => onboardingSeen());

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

  if (view.screen === 'loading') return <Splash />;
  // หน้าแนะนำแทรกก่อนหน้าล็อกอินเท่านั้น และ **ไม่ขอสิทธิ์อะไรจากเครื่อง**
  // (ตัวขอสิทธิ์ตำแหน่งยังอยู่หลัง `employeeMe` เหมือนเดิม — บั๊ก #726)
  if (shouldShowOnboarding(view.screen, seenOnb)) {
    return <Onboarding onDone={() => setSeenOnb(true)} />;
  }
  if (view.screen === 'login') return <Login notice={view.notice} />;
  if (view.screen === 'session_error') {
    return (
      <GateShell
        icon={<ShieldAlert size={22} strokeWidth={2} />}
        title="เชื่อมต่อระบบไม่ได้"
        detail={view.message}
      >
        {/* ไม่เตะออกจากระบบ — ยังไม่รู้ว่าไม่ใช่พนักงาน รู้แค่ว่าถามไม่สำเร็จ */}
        <button className="btn" onClick={retryIdentify}>
          <RefreshCw size={16} /> ลองใหม่
        </button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => void logout()}>
          <LogOut size={15} /> ออกจากระบบ
        </button>
      </GateShell>
    );
  }
  if (view.screen === 'geo') return <GpsGate block={view.block} onAct={geo.request} />;

  const me = state?.kind === 'employee' ? state.me : null;

  return (
    <div className="app">
      <AppHeader
        name={me?.name || 'แอปพนักงาน'}
        sub={`${me?.employee_code || 'BKK APPLE'}${me?.position ? ` · ${me.position}` : ''}`}
        photoUrl={me?.photo_url}
        onLogout={() => void logout()}
      />

      <div className="main">
        {tab === 'home' && geo.fix && <Home fix={geo.fix} />}
        {tab === 'leave' && <Leave />}
        {tab === 'shift' && <ShiftChange />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'history' && <History />}
      </div>

      <TabBar tab={tab} onSelect={setTab} />

    </div>
  );
}
