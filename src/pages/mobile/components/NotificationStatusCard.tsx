import { useCallback, useEffect, useState } from 'react';
import {
  BellRing, BellOff, RefreshCw, Send, CheckCircle2, XCircle, AlertTriangle, Loader2,
} from 'lucide-react';
import { auth } from '../../../api/firebase';
import {
  readAdminTokenHealth,
  refreshAdminPushToken,
  sendTestAdminPush,
  type AdminTokenHealth,
  type TestPushResult,
} from '../../../utils/adminPush';

// In-app diagnostic + self-heal for admin push notifications. iOS PWA web-push
// is fragile (the token dies when the app is closed), so this panel lets the
// admin see the live state, force a token refresh, and fire a test push that
// reports back whether delivery succeeded (token alive) or failed (token dead).
export const NotificationStatusCard = () => {
  const staffId = auth.currentUser?.uid || null;
  const [health, setHealth] = useState<AdminTokenHealth | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestPushResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!staffId) return;
    setHealth(await readAdminTokenHealth(staffId));
  }, [staffId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onRefresh = async () => {
    if (!staffId || refreshing) return;
    setRefreshing(true);
    setNote(null);
    setTest(null);
    const res = await refreshAdminPushToken(staffId, { force: true });
    if (!res.ok) {
      setNote(
        res.reason === 'permission-denied'
          ? 'การแจ้งเตือนถูกปิดไว้ — เปิดที่ ตั้งค่า iPhone > การแจ้งเตือน > BKK Admin'
          : res.reason === 'no-vapid'
            ? 'ระบบยังตั้งค่า VAPID key ไม่ครบ (แจ้งทีมพัฒนา)'
            : `รีเฟรชไม่สำเร็จ: ${res.reason || res.error || 'unknown'}`,
      );
    } else {
      setNote('รีเฟรช token สำเร็จ');
    }
    await reload();
    setRefreshing(false);
  };

  const onTest = async () => {
    if (testing) return;
    setTesting(true);
    setNote(null);
    setTest(null);
    try {
      const res = await sendTestAdminPush();
      setTest(res);
      if (res.total === 0) {
        setNote(res.message || 'ยังไม่มี token — กดรีเฟรชก่อน');
      } else if (res.successCount > 0) {
        setNote('ส่งถึงเซิร์ฟเวอร์แล้ว — ถ้าไม่เห็น popup เด้ง แปลว่า iOS ปิดการแจ้งเตือนของแอปนี้ (เช็คใน ตั้งค่า) ไม่ใช่บั๊กระบบ');
      } else {
        setNote('token หมดอายุ (ส่งไม่ถึงเครื่อง) — กด "รีเฟรชการแจ้งเตือน" แล้วลองใหม่');
      }
    } catch (err) {
      setNote(`ส่งทดสอบไม่สำเร็จ: ${String(err)}`);
    }
    await reload();
    setTesting(false);
  };

  if (!staffId) return null;

  const permGranted = health?.permission === 'granted';
  const permDenied = health?.permission === 'denied';

  return (
    <div className="mx-4 mt-3 mb-1 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100">
        {permGranted ? (
          <BellRing size={16} className="text-emerald-500" />
        ) : (
          <BellOff size={16} className="text-red-500" />
        )}
        <span className="text-sm font-black text-slate-800">สถานะการแจ้งเตือน</span>
      </div>

      <div className="px-4 py-3 space-y-2">
        <StatusRow
          label="อนุญาตแจ้งเตือน"
          ok={permGranted}
          value={
            health == null ? '...' : permGranted ? 'อนุญาตแล้ว' : permDenied ? 'ถูกปิด' : health.permission === 'unsupported' ? 'ไม่รองรับ' : 'ยังไม่ตั้งค่า'
          }
        />
        <StatusRow label="Service Worker" ok={!!health?.swActive} value={health == null ? '...' : health.swActive ? 'ทำงาน' : 'ไม่ทำงาน'} />
        <StatusRow
          label="ลงทะเบียนอุปกรณ์"
          ok={!!health?.hasToken && !health?.lastFailureAt}
          value={
            health == null
              ? '...'
              : !health.hasToken
                ? 'ยังไม่ลงทะเบียน'
                : health.lastFailureAt
                  ? 'ส่งล่าสุดล้มเหลว'
                  : `พร้อม${health.updatedAt ? ` · อัปเดต ${timeAgo(health.updatedAt)}` : ''}`
          }
        />
        {health?.lastFailureAt ? (
          <p className="text-[11px] text-amber-600 leading-snug">
            เซิร์ฟเวอร์ส่งล่าสุดไม่ถึงเครื่องนี้ ({health.lastFailureCode || 'unknown'}) เมื่อ {timeAgo(health.lastFailureAt)} — กดรีเฟรชเพื่อแก้
          </p>
        ) : null}
      </div>

      {permDenied ? (
        <div className="mx-4 mb-3 p-3 rounded-xl bg-red-50 border border-red-100 flex gap-2">
          <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-700 leading-snug">
            การแจ้งเตือนถูกปิดไว้ที่เครื่อง เปิดได้ที่ <b>ตั้งค่า iPhone &gt; การแจ้งเตือน &gt; BKK Admin</b> แล้วเปิด &quot;อนุญาตการแจ้งเตือน&quot;
          </p>
        </div>
      ) : null}

      <div className="px-4 pb-3 grid grid-cols-2 gap-2">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-bold disabled:opacity-50 active:bg-slate-700"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          รีเฟรชการแจ้งเตือน
        </button>
        <button
          onClick={onTest}
          disabled={testing}
          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-50 active:bg-blue-500"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          ส่งทดสอบ
        </button>
      </div>

      {note ? <p className="px-4 pb-2 text-[11px] text-slate-500 leading-snug">{note}</p> : null}

      {test && test.results.length > 0 ? (
        <div className="px-4 pb-3 space-y-1">
          {test.results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              {r.ok ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0" /> : <XCircle size={13} className="text-red-500 shrink-0" />}
              <span className="text-slate-600">{r.device === 'mobile' ? 'มือถือ' : r.device === 'desktop' ? 'เดสก์ท็อป' : r.device}</span>
              <span className={r.ok ? 'text-emerald-600' : 'text-red-500'}>{r.ok ? 'ส่งถึงแล้ว' : r.code || 'ล้มเหลว'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const StatusRow = ({ label, ok, value }: { label: string; ok: boolean; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-xs text-slate-500">{label}</span>
    <span className={`text-xs font-bold flex items-center gap-1 ${ok ? 'text-emerald-600' : 'text-slate-400'}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} className="text-slate-300" />}
      {value}
    </span>
  </div>
);

function timeAgo(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return 'เมื่อครู่';
  if (min < 60) return `${min} นาทีก่อน`;
  if (hr < 24) return `${hr} ชม.ก่อน`;
  return `${day} วันก่อน`;
}
