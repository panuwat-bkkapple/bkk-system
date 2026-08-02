// การแจ้งเตือน — โครงตามจอ Stitch notifications.html: filter chips
// (ทั้งหมด/ล็อตสินค้า/ผลประมูล/การชำระเงิน/การจัดส่ง) + จัดกลุ่มตามวัน
// (วันนี้/เมื่อวาน/ก่อนหน้านี้) + การ์ดยังไม่อ่าน = พื้นฟ้าจาง + จุดน้ำเงิน
// ข้อมูลจาก dealerListNotifications (server เขียน event ตอนเปิดล็อต/ใกล้ปิด/
// ผลประมูล/ชำระ/จัดส่ง) — กดการ์ด = มาร์คอ่าน + นำทางไปหน้าที่เกี่ยวข้อง
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes, Clock3, Trophy, Wallet, Truck, Bell, RefreshCw, CheckCheck, Megaphone,
} from 'lucide-react';
import { listNotifications, markNotificationsRead } from '../api';
import type { DealerNotification } from '../types';

const CAT_TABS: { key: 'all' | DealerNotification['cat']; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'lot', label: 'ล็อตสินค้า' },
  { key: 'result', label: 'ผลประมูล' },
  { key: 'payment', label: 'การชำระเงิน' },
  { key: 'shipping', label: 'การจัดส่ง' },
];

const iconOf = (n: DealerNotification): { node: React.ReactNode; color: string } => {
  if (n.type === 'lot_open') return { node: <Boxes size={18} />, color: 'var(--brand-deep)' };
  if (n.type === 'lot_closing') return { node: <Clock3 size={18} />, color: 'var(--warn)' };
  if (n.type === 'won') return { node: <Trophy size={18} />, color: '#c6a34f' };
  if (n.cat === 'payment') return { node: <Wallet size={18} />, color: 'var(--accent-deep)' };
  if (n.cat === 'shipping') return { node: <Truck size={18} />, color: 'var(--info)' };
  return { node: <Megaphone size={18} />, color: 'var(--muted)' };
};

const relTime = (ms: number): string => {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'เมื่อสักครู่';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ชั่วโมงที่แล้ว`;
  return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' });
};

// กลุ่มวันอิงเวลาไทย
const dayGroupOf = (ms: number): 'วันนี้' | 'เมื่อวาน' | 'ก่อนหน้านี้' => {
  const dayKey = (t: number) => new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86_400_000);
  const k = dayKey(ms);
  if (k === today) return 'วันนี้';
  if (k === yesterday) return 'เมื่อวาน';
  return 'ก่อนหน้านี้';
};

export const Notifications = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<DealerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'all' | DealerNotification['cat']>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listNotifications();
      setItems(res.notifications);
    } catch {
      setError('โหลดการแจ้งเตือนไม่สำเร็จ — ลองรีเฟรชอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = items.filter((n) => !n.read).length;

  const markAll = async () => {
    if (unread === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await markNotificationsRead({ all: true });
    } catch {
      /* best-effort — โหลดครั้งหน้า sync เอง */
    }
  };

  const open = (n: DealerNotification) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void markNotificationsRead({ ids: [n.id] }).catch(() => {});
    }
    if (n.ref) navigate(n.ref);
  };

  const visible = items.filter((n) => tab === 'all' || n.cat === tab);
  const groups: { title: string; list: DealerNotification[] }[] = ['วันนี้', 'เมื่อวาน', 'ก่อนหน้านี้']
    .map((title) => ({ title, list: visible.filter((n) => dayGroupOf(n.created_at) === title) }))
    .filter((g) => g.list.length > 0);

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h1 className="h1">การแจ้งเตือน</h1>
          <div className="sub">{unread > 0 ? `ยังไม่อ่าน ${unread} รายการ` : 'อ่านครบทุกรายการแล้ว'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unread > 0 && (
            <button className="btn ghost small" onClick={() => void markAll()}>
              <CheckCheck size={13} /> อ่านทั้งหมด
            </button>
          )}
          <button className="btn ghost small" onClick={() => void load()}>
            <RefreshCw size={13} /> รีเฟรช
          </button>
        </div>
      </div>

      <div className="filter-tabs">
        {CAT_TABS.map((t) => (
          <button key={t.key} className={`ftab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'all' && unread > 0 && <span className="cnt hot">{unread}</span>}
          </button>
        ))}
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && !loading && <div className="error mt12">{error}</div>}

      {!loading && !error && visible.length === 0 && (
        <div className="empty">
          <Bell size={26} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>
            ยังไม่มีการแจ้งเตือน — เราจะแจ้งเมื่อมีล็อตใหม่ตามระดับของคุณ
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.title}>
          <div className="label-caps muted" style={{ marginTop: 18, marginBottom: 4, paddingLeft: 4 }}>{g.title}</div>
          {g.list.map((n) => {
            const ic = iconOf(n);
            return (
              <div
                key={n.id}
                className="card mini-row"
                onClick={() => open(n)}
                style={{
                  cursor: 'pointer',
                  alignItems: 'flex-start',
                  position: 'relative',
                  ...(n.read ? {} : { background: '#eef3fc', borderColor: '#c9d6ef' }),
                }}
              >
                {!n.read && (
                  <span style={{ position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)', width: 9, height: 9, borderRadius: '50%', background: 'var(--brand-deep)', boxShadow: '0 0 0 3px var(--bg)' }} />
                )}
                <span className="mr-ic" style={{ background: '#fff', border: '1px solid var(--line)', color: ic.color }}>
                  {ic.node}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                    <span className="bold small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                    <span className="tiny muted bold" style={{ flexShrink: 0 }}>{relTime(n.created_at)}</span>
                  </div>
                  <div className="small muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{n.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
