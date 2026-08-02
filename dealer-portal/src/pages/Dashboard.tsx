// Dealer Dashboard — หน้าแรกของ portal: สรุปทุกอย่างที่ต้องรู้/ต้องทำในจอเดียว
// (ล็อตเปิดรับ, ซองที่กำลังเสนอ, งานรอชำระ, ของกำลังส่ง, ยอดซื้อสะสม)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes, Lock, Upload, Truck, Clock3, ChevronRight, Trophy, RefreshCw, Wallet,
} from 'lucide-react';
import { listLots, listOrders } from '../api';
import { useDealerSession } from '../hooks/useDealerSession';
import { fmtBaht, fmtDateTime, type DealerOrderSummary, type LotSummary } from '../types';

export const Dashboard = () => {
  const navigate = useNavigate();
  const { dealer } = useDealerSession();
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [orders, setOrders] = useState<DealerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [l, o] = await Promise.all([listLots(), listOrders()]);
      setLots(l.lots);
      setOrders(o.orders);
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ — ลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const openLots = useMemo(() => lots.filter((l) => l.status === 'open'), [lots]);
  const notBidYet = useMemo(() => openLots.filter((l) => !l.my_bid), [openLots]);
  // Active Bidding: ซองที่ยังมีผลผูกพัน (lot ยังเปิด หรือปิดรับแล้วรอประกาศ)
  const activeBids = useMemo(
    () => lots.filter((l) => l.my_bid && ['open', 'closed', 'awarding'].includes(l.status)),
    [lots]
  );
  const pendingPay = useMemo(() => orders.filter((o) => o.status === 'pending_payment'), [orders]);
  const inTransit = useMemo(
    () => orders.filter((o) => ['payment_review', 'paid', 'preparing', 'shipped'].includes(o.status)),
    [orders]
  );
  const history = useMemo(() => orders.filter((o) => o.status === 'completed'), [orders]);
  const totalPurchased = useMemo(() => history.reduce((s, o) => s + (o.amount || 0), 0), [history]);
  const recentWins = useMemo(
    () => lots.filter((l) => l.my_result === 'won').slice(0, 2),
    [lots]
  );

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1">สวัสดี, {dealer?.company_name}</h1>
          <div className="sub">
            ดีลเลอร์ระดับ Tier {dealer?.tier}
            {history.length > 0 && <> · ซื้อสำเร็จ {history.length} ดีล รวม {fmtBaht(totalPurchased)}</>}
          </div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && <div className="error">{error}</div>}

      {!loading && (
        <>
          {/* สถิติหลัก 4 ช่อง — กดแล้วพาไปหน้าที่เกี่ยวข้อง */}
          <div className="stat-grid">
            <div className="stat" onClick={() => navigate('/lots')}>
              <div className="k"><Boxes size={13} /> ล็อตเปิดรับราคา</div>
              <div className="v">{openLots.length}</div>
              <div className="s">{notBidYet.length > 0 ? `${notBidYet.length} ล็อตยังไม่ได้เสนอ` : 'เสนอครบทุกล็อตแล้ว'}</div>
            </div>
            <div className="stat" onClick={() => navigate('/lots')}>
              <div className="k"><Lock size={13} /> ซองที่กำลังเสนอ</div>
              <div className="v">{activeBids.length}</div>
              <div className="s">รอปิดรับ / รอประกาศผล</div>
            </div>
            <div className={`stat ${pendingPay.length > 0 ? 'hot' : ''}`} onClick={() => navigate('/orders')}>
              <div className="k"><Upload size={13} /> รอคุณชำระ</div>
              <div className="v">{pendingPay.length}</div>
              <div className="s">{pendingPay.length > 0 ? `รวม ${fmtBaht(pendingPay.reduce((s, o) => s + o.amount, 0))}` : 'ไม่มียอดค้าง'}</div>
            </div>
            <div className="stat" onClick={() => navigate('/orders')}>
              <div className="k"><Truck size={13} /> กำลังดำเนินการ</div>
              <div className="v">{inTransit.length}</div>
              <div className="s">ตรวจสลิป / เตรียมส่ง / ขนส่ง</div>
            </div>
          </div>

          {/* งานที่ต้องทำตอนนี้ — สำคัญสุด ขึ้นก่อน */}
          {(pendingPay.length > 0 || recentWins.length > 0) && (
            <>
              <div className="sec-title">ต้องทำตอนนี้</div>
              {pendingPay.map((o) => (
                /* hero navy widget (ตาม Pending Orders widget ของ Stitch dashboard) */
                <div key={o.id} className="hero-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${o.id}`)}>
                  <div className="row">
                    <span className="glass-badge"><Trophy size={11} /> ชนะดีล {o.lot_no}</span>
                    <span className="glass-chip">{o.order_no}</span>
                  </div>
                  <div className="money" style={{ fontSize: 30, fontWeight: 700, marginTop: 14, letterSpacing: '-0.5px' }}>
                    {fmtBaht(o.amount)}
                  </div>
                  <div className="tiny bold" style={{ color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
                    {o.item_count} เครื่อง · รอชำระเงินและแนบสลิปเพื่อเริ่มจัดส่ง
                  </div>
                  <button className="btn accent" style={{ marginTop: 14, padding: 13, fontSize: 14 }}
                    onClick={(e) => { e.stopPropagation(); navigate(`/orders/${o.id}`); }}>
                    <Upload size={15} /> โอนเงินและแนบสลิป
                  </button>
                </div>
              ))}
            </>
          )}

          {/* ล็อตใกล้ปิดที่ยังไม่ได้เสนอ */}
          {notBidYet.length > 0 && (
            <>
              <div className="sec-title">
                อย่าพลาด — ยังไม่ได้เสนอราคา
                <a onClick={(e) => { e.preventDefault(); navigate('/lots'); }} href="/lots">ดูทั้งหมด</a>
              </div>
              {notBidYet
                .slice()
                .sort((a, b) => (a.close_at || 0) - (b.close_at || 0))
                .slice(0, 3)
                .map((lot) => {
                  const remain = (lot.close_at || 0) - now;
                  const urgent = remain < 3600_000;
                  return (
                    <div key={lot.id} className="card clickable" onClick={() => navigate(`/lots/${lot.id}`)}>
                      <div className="row">
                        <div>
                          <div className="bold" style={{ fontSize: 15 }}>{lot.title}</div>
                          <div className="tiny muted bold mt8">{lot.lot_no} · {lot.item_count} เครื่อง{lot.asking_total ? ` · ${fmtBaht(lot.asking_total)}` : ''}</div>
                        </div>
                        <span className={`chip time ${urgent ? 'urgent' : ''}`}>
                          <Clock3 size={12} /> ปิด {fmtDateTime(lot.close_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </>
          )}

          {/* Active Bidding — ซองที่ยื่นแล้ว */}
          {activeBids.length > 0 && (
            <>
              <div className="sec-title">ซองที่กำลังเสนอ ({activeBids.length})</div>
              {activeBids.map((lot) => (
                <div key={lot.id} className="card clickable" onClick={() => navigate(`/lots/${lot.id}`)}>
                  <div className="row">
                    <div>
                      <div className="bold" style={{ fontSize: 15 }}>{lot.title}</div>
                      <div className="tiny muted bold mt8">
                        {lot.lot_no} · ซองของคุณ:{' '}
                        <b style={{ color: 'var(--info)' }}>
                          {lot.my_bid!.type === 'whole_lot' ? fmtBaht(lot.my_bid!.amount_total) : `${lot.my_bid!.item_count} เครื่อง`}
                        </b>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {lot.status === 'open'
                        ? <span className="pill green">แก้ไขได้ถึงปิดรับ</span>
                        : <span className="pill amber">รอประกาศผล</span>}
                      <div className="tiny muted bold mt8" style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <ChevronRight size={12} /> {lot.status === 'open' ? `ปิด ${fmtDateTime(lot.close_at)}` : `ปิดแล้ว ${fmtDateTime(lot.close_at)}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ยอดสะสม */}
          {history.length > 0 && (
            <>
              <div className="sec-title">
                ประวัติการซื้อ
                <a onClick={(e) => { e.preventDefault(); navigate('/orders'); }} href="/orders">ดูทั้งหมด</a>
              </div>
              <div className="card row" onClick={() => navigate('/orders')} style={{ cursor: 'pointer' }}>
                <div className="small bold" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wallet size={16} style={{ color: 'var(--accent)' }} /> ซื้อสำเร็จ {history.length} ดีล
                </div>
                <div className="black money" style={{ fontSize: 17 }}>{fmtBaht(totalPurchased)}</div>
              </div>
            </>
          )}

          {openLots.length === 0 && activeBids.length === 0 && pendingPay.length === 0 && (
            <div className="empty">
              <Boxes size={28} style={{ color: 'var(--faint)', marginBottom: 8 }} />
              <div><b>ยังไม่มีล็อตเปิดรับราคาตอนนี้</b><br />เมื่อมีล็อตใหม่สำหรับระดับของคุณ เราจะแจ้งทางอีเมลทันที</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
