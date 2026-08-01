import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, FileText } from 'lucide-react';
import { listOrders } from '../api';
import { ORDER_STATUS_LABEL, fmtBaht, fmtDateTime, type DealerOrderSummary } from '../types';

export const Orders = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<DealerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listOrders();
      setOrders(res.orders);
    } catch {
      setError('โหลดรายการไม่สำเร็จ — ลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="row">
        <div>
          <h1 className="h1">คำสั่งซื้อ</h1>
          <div className="sub">สถานะการชำระเงินและการจัดส่ง</div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={14} /> รีเฟรช
        </button>
      </div>

      {loading && <div className="loading">กำลังโหลด...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && orders.length === 0 && (
        <div className="card center muted bold">ยังไม่มีคำสั่งซื้อ — เมื่อชนะการเสนอราคา คำสั่งซื้อจะแสดงที่นี่</div>
      )}

      {orders.map((o) => {
        const meta = ORDER_STATUS_LABEL[o.status] || { label: o.status, cls: '' };
        return (
          <div key={o.id} className="card clickable" onClick={() => navigate(`/orders/${o.id}`)}>
            <div className="row">
              <span className="mono tiny muted bold">{o.order_no}</span>
              <span className={`badge ${meta.cls}`}>{meta.label}</span>
            </div>
            <div className="row mt8">
              <div>
                <div className="bold">{o.lot_no} · {o.item_count} เครื่อง</div>
                <div className="tiny muted bold">{fmtDateTime(o.created_at)}</div>
              </div>
              <div className="black" style={{ fontSize: 18, color: 'var(--accent)' }}>{fmtBaht(o.amount)}</div>
            </div>
            {o.quotation && (
              <div className="tiny muted bold mt8" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <FileText size={11} /> ใบเสนอราคา {o.quotation.number}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
