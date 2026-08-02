// Dealer Dashboard — bento grid ตาม dashboard.html ของ Stitch:
// main hero (Active Bid / ล็อตที่ควรเสนอ) 8 คอลัมน์ + widget navy "รอคุณชำระ" 4 คอลัมน์
// + สถิติ 4 ช่อง + section "ล็อตเปิดรับตอนนี้" (arrival cards) + งานที่ต้องทำ/ประวัติ
// Mobile เรียงลงมาคอลัมน์เดียว (ดู .bento ใน styles.css)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes, Lock, Upload, Truck, ChevronRight, Trophy, RefreshCw, Wallet, ArrowRight,
} from 'lucide-react';
import { listLots, listOrders } from '../api';
import { useDealerSession } from '../hooks/useDealerSession';
import { fmtBaht, fmtDateTime, TIER_LABEL, type DealerOrderSummary, type LotSummary } from '../types';
import { LotCard, remainText } from './LotList';

export const Dashboard = () => {
  const navigate = useNavigate();
  const { dealer } = useDealerSession();
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [orders, setOrders] = useState<DealerOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const openLots = useMemo(() => lots.filter((l) => l.status === 'open'), [lots]);
  const notBidYet = useMemo(() => openLots.filter((l) => !l.my_bid), [openLots]);
  // Active Bidding: ซองที่ยังมีผลผูกพัน (lot ยังเปิด หรือปิดรับแล้วรอประกาศ)
  const activeBids = useMemo(
    () => lots.filter((l) => l.my_bid && ['open', 'closed', 'awarding'].includes(l.status)),
    [lots]
  );
  const waitingResult = useMemo(
    () => activeBids.filter((l) => ['closed', 'awarding'].includes(l.status)),
    [activeBids]
  );
  const pendingPay = useMemo(() => orders.filter((o) => o.status === 'pending_payment'), [orders]);
  const inTransit = useMemo(
    () => orders.filter((o) => ['payment_review', 'paid', 'preparing', 'shipped'].includes(o.status)),
    [orders]
  );
  const history = useMemo(() => orders.filter((o) => o.status === 'completed'), [orders]);
  const totalPurchased = useMemo(() => history.reduce((s, o) => s + (o.amount || 0), 0), [history]);

  // hero หลักของ bento: ซองที่ใกล้ปิดสุด > ล็อตที่ยังไม่เสนอที่ใกล้ปิดสุด
  const heroLot = useMemo(() => {
    const openBids = activeBids.filter((l) => l.status === 'open');
    const pool = openBids.length > 0 ? openBids : notBidYet;
    return pool.slice().sort((a, b) => (a.close_at || 0) - (b.close_at || 0))[0] || null;
  }, [activeBids, notBidYet]);

  const doneRatio = orders.length > 0 ? Math.round((history.length / orders.length) * 100) : 0;

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h1 className="h1">สวัสดี, {dealer?.company_name}</h1>
          <div className="sub">
            ดีลเลอร์ระดับ {(dealer?.tier && TIER_LABEL[dealer.tier]) || `Tier ${dealer?.tier || '-'}`}
            {history.length > 0 && <> · ซื้อสำเร็จ {history.length} ดีล รวม {fmtBaht(totalPurchased)}</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost small" onClick={() => void load()}>
            <RefreshCw size={13} /> รีเฟรช
          </button>
          <button className="btn small" onClick={() => navigate('/lots')}>
            เสนอราคา <ArrowRight size={13} />
          </button>
        </div>
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && <div className="error">{error}</div>}

      {!loading && (
        <>
          {/* ─── Bento: hero 8 คอลัมน์ + widget navy 4 คอลัมน์ ─── */}
          <div className="bento">
            {heroLot ? (
              <div className="card clickable active-hero sp8" onClick={() => navigate(`/lots/${heroLot.id}`)}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="label-caps" style={{ color: heroLot.my_bid ? 'var(--accent-deep)' : 'var(--warn)' }}>
                      {heroLot.my_bid ? 'Active Bid — ส่งซองแล้ว' : 'เปิดรับราคา — ยังไม่ได้เสนอ'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-head)', fontSize: 19, fontWeight: 800, marginTop: 5, lineHeight: 1.35 }}>
                      {heroLot.title}
                    </div>
                    <div className="small muted bold mt8">{heroLot.lot_no} · {heroLot.item_count} เครื่อง</div>
                  </div>
                  {heroLot.my_bid
                    ? <span className="pill green">ส่งซองแล้ว</span>
                    : <span className="pill amber">ยังไม่ได้เสนอ</span>}
                </div>
                <div className="row" style={{ marginTop: 20, alignItems: 'flex-end' }}>
                  <div>
                    <div className="label-caps muted">
                      {heroLot.my_bid ? 'ซองของคุณ' : 'ราคาตั้งรวม'}
                    </div>
                    <div className="price-big" style={{ fontSize: 24, marginTop: 3 }}>
                      {heroLot.my_bid
                        ? (heroLot.my_bid.type === 'whole_lot' ? fmtBaht(heroLot.my_bid.amount_total) : `${heroLot.my_bid.item_count} เครื่อง`)
                        : (heroLot.asking_total ? fmtBaht(heroLot.asking_total) : 'สอบถาม')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="label-caps muted">ปิดรับใน</div>
                    <div
                      className="money"
                      style={{
                        fontSize: 17, fontWeight: 700, marginTop: 3,
                        color: (heroLot.close_at || 0) - now < 3600_000 ? 'var(--danger)' : 'var(--ink)',
                      }}
                    >
                      {remainText((heroLot.close_at || 0) - now)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card sp8 center" style={{ padding: '36px 20px', color: 'var(--muted)', fontWeight: 600 }}>
                <Boxes size={26} style={{ color: 'var(--faint)', marginBottom: 8 }} />
                <div><b style={{ color: 'var(--ink)' }}>ยังไม่มีล็อตเปิดรับราคาตอนนี้</b><br />เมื่อมีล็อตใหม่สำหรับระดับของคุณ เราจะแจ้งทางอีเมลทันที</div>
              </div>
            )}

            {/* widget navy (ตาม Pending Orders widget) */}
            <div className="hero-card sp4" style={{ cursor: 'pointer' }} onClick={() => navigate('/orders')}>
              <div className="row">
                <span className="label-caps" style={{ color: '#b7c8de' }}>รอคุณชำระ</span>
                <Upload size={15} style={{ color: '#b7c8de' }} />
              </div>
              <div className="money" style={{ fontSize: 42, fontWeight: 700, lineHeight: 1, marginTop: 12 }}>
                {pendingPay.length}
              </div>
              <div className="tiny bold" style={{ color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
                {pendingPay.length > 0
                  ? `รวม ${fmtBaht(pendingPay.reduce((s, o) => s + o.amount, 0))} — โอนแล้วแนบสลิปเพื่อเริ่มจัดส่ง`
                  : 'ไม่มียอดค้างชำระ'}
              </div>
              <div className="row" style={{ marginTop: 18 }}>
                <span className="label-caps" style={{ color: 'rgba(255,255,255,0.5)' }}>ดีลสำเร็จ</span>
                <span className="mono tiny" style={{ color: 'rgba(255,255,255,0.7)' }}>{history.length}/{orders.length}</span>
              </div>
              <div className="navy-bar"><span style={{ width: `${doneRatio}%` }} /></div>
            </div>
          </div>

          {/* สถิติ 4 ช่อง */}
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

          {/* งานที่ต้องทำตอนนี้ — ดีลที่ชนะแล้วรอชำระ (รายใบพร้อมปุ่ม) */}
          {pendingPay.length > 0 && (
            <>
              <div className="hr-title">ต้องทำตอนนี้ <span className="line" /></div>
              {pendingPay.map((o) => (
                <div key={o.id} className="card clickable action" onClick={() => navigate(`/orders/${o.id}`)}>
                  <div className="row">
                    <div>
                      <div className="black" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Trophy size={15} style={{ color: 'var(--accent)' }} /> ชนะดีล {o.lot_no} — รอชำระเงิน
                      </div>
                      <div className="tiny muted bold mt8 mono">{o.order_no} · {o.item_count} เครื่อง</div>
                    </div>
                    <div className="black money" style={{ fontSize: 17, color: 'var(--warn)' }}>{fmtBaht(o.amount)}</div>
                  </div>
                  <button className="btn accent" style={{ marginTop: 12, padding: 12, fontSize: 14 }}
                    onClick={(e) => { e.stopPropagation(); navigate(`/orders/${o.id}`); }}>
                    <Upload size={15} /> โอนเงินและแนบสลิป
                  </button>
                </div>
              ))}
            </>
          )}

          {/* ล็อตเปิดรับตอนนี้ — arrival cards ตาม Daily Arrivals (2 คอลัมน์บน desktop) */}
          {openLots.length > 0 && (
            <>
              <div className="hr-title">
                ล็อตเปิดรับตอนนี้ <span className="line" />
                <a onClick={(e) => { e.preventDefault(); navigate('/lots'); }} href="/lots">ดูทั้งหมด</a>
              </div>
              <div className="bento" style={{ marginTop: 12 }}>
                {openLots
                  .slice()
                  .sort((a, b) => (a.close_at || 0) - (b.close_at || 0))
                  .slice(0, 4)
                  .map((lot) => (
                    <div key={lot.id} className="sp6">
                      <LotCard lot={lot} now={now} onClick={() => navigate(`/lots/${lot.id}`)} />
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* ซองที่ปิดรับแล้ว รอประกาศผล */}
          {waitingResult.length > 0 && (
            <>
              <div className="hr-title">รอประกาศผล <span className="line" /></div>
              {waitingResult.map((lot) => (
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
                      <span className="pill amber">รอประกาศผล</span>
                      <div className="tiny muted bold mt8" style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                        <ChevronRight size={12} /> ปิดแล้ว {fmtDateTime(lot.close_at)}
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
              <div className="hr-title">
                ประวัติการซื้อ <span className="line" />
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
        </>
      )}
    </div>
  );
};
