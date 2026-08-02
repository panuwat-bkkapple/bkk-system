import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, FileText, ChevronRight, Upload, Truck, ClipboardList } from 'lucide-react';
import { listOrders } from '../api';
import { ORDER_STATUS_LABEL, fmtBaht, fmtDateTime, type DealerOrderSummary, type OrderStatus } from '../types';

type TabKey = 'action' | 'progress' | 'done' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'action', label: 'รอคุณชำระ' },
  { key: 'progress', label: 'กำลังดำเนินการ' },
  { key: 'done', label: 'สำเร็จ' },
  { key: 'all', label: 'ทั้งหมด' },
];

const bucketOf = (o: DealerOrderSummary): Exclude<TabKey, 'all'> => {
  if (o.status === 'pending_payment') return 'action';
  if (['completed', 'cancelled'].includes(o.status)) return 'done';
  return 'progress'; // payment_review / paid / preparing / shipped
};

// ลำดับ milestone สำหรับแถบ progress บนการ์ด
const FLOW: OrderStatus[] = ['pending_payment', 'payment_review', 'paid', 'shipped', 'completed'];

export const Orders = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<DealerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listOrders();
      setOrders(res.orders);
      // เปิดหน้ามาโฟกัสสิ่งที่ต้องทำก่อน — ถ้ามีรอชำระให้ landing ที่แท็บนั้น
      if (res.orders.some((o) => o.status === 'pending_payment')) setTab('action');
    } catch {
      setError('โหลดรายการไม่สำเร็จ — ลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { action: 0, progress: 0, done: 0, all: orders.length };
    for (const o of orders) c[bucketOf(o)] += 1;
    return c;
  }, [orders]);

  const visible = useMemo(
    () => (tab === 'all' ? orders : orders.filter((o) => bucketOf(o) === tab)),
    [orders, tab]
  );

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1">คำสั่งซื้อ</h1>
          <div className="sub">การชำระเงินและการจัดส่งของดีลที่คุณชนะ</div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      <div className="filter-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`ftab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className={`cnt ${t.key === 'action' && counts.action > 0 ? 'hot' : ''}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && <div className="error">{error}</div>}

      {/* สรุปประวัติสะสมในแท็บ "สำเร็จ" */}
      {!loading && tab === 'done' && counts.done > 0 && (
        <div className="card row">
          <span className="small bold muted">ซื้อสำเร็จ {orders.filter((o) => o.status === 'completed').length} ดีล</span>
          <span className="black money" style={{ fontSize: 17, color: 'var(--accent-deep)' }}>
            {fmtBaht(orders.filter((o) => o.status === 'completed').reduce((s, o) => s + o.amount, 0))}
          </span>
        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="empty">
          <ClipboardList size={28} style={{ color: 'var(--faint)', marginBottom: 8 }} />
          <div>
            {tab === 'all'
              ? (<><b>ยังไม่มีคำสั่งซื้อ</b><br />เมื่อคุณชนะการเสนอราคา คำสั่งซื้อและใบเสนอราคาจะปรากฏที่นี่</>)
              : 'ไม่มีรายการในหมวดนี้'}
          </div>
        </div>
      )}

      {visible.map((o) => {
        const meta = ORDER_STATUS_LABEL[o.status] || { label: o.status, cls: '' };
        const flowIdx = FLOW.indexOf(o.status);
        const needSlip = o.status === 'pending_payment';
        return (
          <div key={o.id} className={`card clickable ${needSlip ? 'action' : ''}`} onClick={() => navigate(`/orders/${o.id}`)}>
            <div className="row">
              <span className="mono tiny muted bold">{o.order_no} · {o.lot_no}</span>
              <span className={`pill ${meta.cls}`}>{meta.label}</span>
            </div>

            <div className="row mt8" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="black money" style={{ fontSize: 20, color: 'var(--ink)' }}>{fmtBaht(o.amount)}</div>
                <div className="tiny muted bold mt8">
                  {o.item_count} เครื่อง · {fmtDateTime(o.created_at)}
                  {o.quotation && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6 }}>
                      · <FileText size={10} /> {o.quotation.number}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--faint)', flexShrink: 0, marginTop: 2 }} />
            </div>

            {/* แถบ progress 5 ขั้น — เห็นสถานะได้โดยไม่ต้องอ่าน */}
            {o.status !== 'cancelled' ? (
              <div className="mini-steps">
                {FLOW.map((s, i) => (
                  <span key={s} className={`seg ${flowIdx >= i ? 'done' : ''}`} />
                ))}
              </div>
            ) : (
              <div className="mini-steps"><span className="seg cancelled" style={{ flex: 1 }} /></div>
            )}

            {/* บอก next action ตรงๆ */}
            {needSlip && (
              <button
                className="btn accent"
                style={{ marginTop: 12, padding: 12, fontSize: 14 }}
                onClick={(e) => { e.stopPropagation(); navigate(`/orders/${o.id}`); }}
              >
                <Upload size={15} /> โอนเงินและแนบสลิป
              </button>
            )}
            {o.status === 'shipped' && o.shipping?.tracking_no && (
              <div className="notice mt12" style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <Truck size={14} /> {o.shipping.method || 'ขนส่ง'} · <b className="mono">{o.shipping.tracking_no}</b>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
