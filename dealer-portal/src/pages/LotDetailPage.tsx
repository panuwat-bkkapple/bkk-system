// รายละเอียดล็อต + ฟอร์มเสนอราคา (ยกล็อต / รายตัว) — แก้ซองได้จนกว่าจะปิดรับ
// ตัวล็อต subscribe realtime ตรงจาก RTDB (rules อนุญาตดีลเลอร์ tier ที่มีสิทธิ์)
// ซองของตัวเองอ่าน/เขียนผ่าน callable เท่านั้น
// เมื่อประกาศผลแล้ว: แสดง banner "ยินดีด้วย คุณชนะดีลนี้" (+CTA ไปชำระเงิน)
// หรือ "ครั้งนี้ไม่ได้รับเลือก" — ดีลเลอร์ต้องรู้ผลจากหน้านี้ ไม่ใช่เดาเอาจากหน้าออเดอร์
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { onValue, ref } from 'firebase/database';
import {
  Lock, Trophy, ArrowRight, Clock3, X, Info, ChevronRight,
  Package, CalendarClock, CheckCircle2, XCircle, HeartPulse, Layers, ShieldCheck, BatteryCharging,
} from 'lucide-react';
import { db } from '../firebase';
import { getMyBid, placeBid } from '../api';
import {
  LOT_STATUS_LABEL, QC_CHECK_LABEL, CLEAN_STATUS_LABEL, fmtBaht, fmtDateTime,
  type LotBidMode, type LotItem, type LotStatus, type MyBid, type MyLotOrder,
} from '../types';

interface LotNode {
  lot_no?: string;
  title?: string;
  description?: string;
  status: LotStatus | 'draft';
  bid_mode?: LotBidMode;
  items?: Record<string, LotItem>;
  item_count?: number;
  asking_total?: number;
  close_at?: number;
  bid_stats?: { bid_count: number } | null;
  eligible_count?: number;
  show_bid_stats?: boolean;
}

export const LotDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lot, setLot] = useState<LotNode | null>(null);
  const [denied, setDenied] = useState(false);
  const [myBid, setMyBid] = useState<MyBid | null>(null);
  const [award, setAward] = useState<{ result: 'won' | 'lost' | null; order: MyLotOrder | null }>({
    result: null,
    order: null,
  });
  const [now, setNow] = useState(Date.now());

  // ฟอร์ม
  const [mode, setMode] = useState<'whole_lot' | 'per_item'>('whole_lot');
  const [amountTotal, setAmountTotal] = useState('');
  const [itemBids, setItemBids] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // sheet สเปก + Diagnostic Report ของเครื่องที่แตะดู
  const [sheetItem, setSheetItem] = useState<{ id: string; item: LotItem } | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsub = onValue(
      ref(db, `lots/${id}`),
      (snap) => setLot(snap.val()),
      () => setDenied(true)
    );
    return unsub;
  }, [id]);

  const refreshMyBid = (lotId: string) =>
    getMyBid(lotId)
      .then((res) => {
        setMyBid(res.bid);
        setAward({ result: res.result, order: res.order });
        if (res.bid) {
          setMode(res.bid.type);
          if (res.bid.amount_total) setAmountTotal(String(res.bid.amount_total));
          if (res.bid.item_bids) {
            const m: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.bid.item_bids)) m[k] = String(v);
            setItemBids(m);
          }
          if (res.bid.note) setNote(res.bid.note);
        }
      })
      .catch(() => {});

  useEffect(() => {
    if (id) void refreshMyBid(id);
  }, [id]);

  // ประกาศผลระหว่างเปิดหน้าอยู่ → ดึงผลใหม่ทันที (lot subscribe แบบ realtime)
  const lotStatus = lot?.status;
  useEffect(() => {
    if (id && (lotStatus === 'awarded' || lotStatus === 'completed')) void refreshMyBid(id);
  }, [id, lotStatus]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(() => Object.entries(lot?.items || {}), [lot]);
  const isOpen = lot?.status === 'open' && (lot?.close_at || 0) > now;
  const bidMode: LotBidMode = lot?.bid_mode || 'both';
  const canWhole = bidMode !== 'per_item';
  const canPerItem = bidMode !== 'whole_lot';

  const remain = Math.max(0, (lot?.close_at || 0) - now);
  const remainText = useMemo(() => {
    const s = Math.floor(remain / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d} วัน ${h} ชม. ${m} นาที`;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }, [remain]);

  const perItemTotal = useMemo(
    () => Object.values(itemBids).reduce((s, v) => s + (Number(v) || 0), 0),
    [itemBids]
  );

  const handleSubmit = async () => {
    if (!id || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: Parameters<typeof placeBid>[0] = { lotId: id, type: mode, note: note.trim() };
      if (mode === 'whole_lot') {
        const amt = Number(amountTotal);
        if (!amt || amt <= 0) throw new Error('กรอกยอดเสนอยกล็อตก่อน');
        payload.amount_total = amt;
      } else {
        const bids: Record<string, number> = {};
        for (const [jobId, v] of Object.entries(itemBids)) {
          const n = Number(v);
          if (n > 0) bids[jobId] = n;
        }
        if (Object.keys(bids).length === 0) throw new Error('กรอกราคาอย่างน้อย 1 เครื่อง');
        payload.item_bids = bids;
      }
      const res = await placeBid(payload);
      setMsg({
        kind: 'ok',
        text: `${myBid ? 'แก้ไขซองแล้ว' : 'ส่งซองแล้ว'} (${res.bid_no}) — แก้ไขได้จนกว่าจะปิดรับราคา`,
      });
      await refreshMyBid(id);
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: (err as Error)?.message || 'ส่งซองไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <div className="empty mt16">ล็อตนี้ไม่เปิดสำหรับบัญชีของคุณ</div>;
  if (!lot) return (<><div className="skel" style={{ marginTop: 20 }} /><div className="skel" /></>);

  const meta = LOT_STATUS_LABEL[lot.status] || { label: lot.status, cls: '' };
  const decided = ['awarded', 'completed'].includes(lot.status);
  const wonItemIds = new Set(Object.keys(award.order?.items || {}));

  return (
    <div>
      {/* breadcrumbs (ตาม lot-detail.html) */}
      <nav className="crumbs">
        <a onClick={(e) => { e.preventDefault(); navigate('/lots'); }} href="/lots">ล็อตสินค้า</a>
        <ChevronRight className="sep" size={12} />
        <b>{lot.lot_no}</b>
      </nav>

      <div className="row mt12">
        <span className={`pill ${meta.cls}`}>{meta.label}</span>
      </div>
      <h1 className="h1" style={{ margin: '6px 0 2px' }}>{lot.title}</h1>
      {lot.description && <div className="small muted bold">{lot.description}</div>}
      <div className="meta-row">
        <span><Package size={14} /> {lot.item_count || items.length} เครื่อง</span>
        {lot.close_at ? <span><CalendarClock size={14} /> ปิดรับ {fmtDateTime(lot.close_at)}</span> : null}
      </div>

      {/* ─── ผลการประมูล — ต้องเป็นสิ่งแรกที่เห็นเมื่อประกาศแล้ว ─── */}
      {decided && award.result === 'won' && award.order && (
        <div
          className="card"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)', textAlign: 'center', padding: '24px 18px' }}
        >
          <div
            style={{
              width: 52, height: 52, borderRadius: 999, background: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginBottom: 10,
            }}
          >
            <Trophy size={26} />
          </div>
          <div className="black" style={{ fontSize: 19, color: 'var(--accent-deep)' }}>ยินดีด้วย — คุณชนะดีลนี้</div>
          <div className="small bold mt8" style={{ color: 'var(--ink-2)' }}>
            {award.order.item_count > 0 && award.order.item_count < (lot.item_count || 0)
              ? `ได้รับเลือก ${award.order.item_count} เครื่องจากล็อตนี้`
              : `เหมายกล็อต ${lot.item_count} เครื่อง`}
            {' · ยอดชำระ '}
            <span className="black money" style={{ color: 'var(--accent-deep)' }}>{fmtBaht(award.order.amount)}</span>
          </div>
          <div className="tiny muted bold mt8">
            คำสั่งซื้อ {award.order.order_no} — ใบเสนอราคาส่งไปที่อีเมลของคุณแล้ว
          </div>
          <button className="btn accent" style={{ marginTop: 14 }} onClick={() => navigate(`/orders/${award.order!.id}`)}>
            โอนเงินและแนบสลิป <ArrowRight size={16} />
          </button>
        </div>
      )}
      {decided && award.result === 'lost' && (
        <div className="card center" style={{ padding: '22px 18px' }}>
          <div className="black" style={{ fontSize: 16 }}>ครั้งนี้ยังไม่ได้รับเลือก</div>
          <div className="small muted bold mt8" style={{ lineHeight: 1.7 }}>
            ขอบคุณที่ร่วมเสนอราคาล็อต {lot.lot_no} — ซองของคุณ
            {myBid?.type === 'whole_lot' ? ` (${fmtBaht(myBid?.amount_total)})` : ''} ไม่ผ่านการคัดเลือก
            <br />ล็อตใหม่เปิดสม่ำเสมอ เราจะแจ้งทางอีเมลทันทีที่มีล็อตสำหรับระดับของคุณ
          </div>
          <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => navigate('/')}>ดูล็อตที่เปิดอยู่</button>
        </div>
      )}
      {['closed', 'awarding'].includes(lot.status) && myBid && (
        <div className="notice mt12" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Clock3 size={15} style={{ flexShrink: 0 }} />
          ปิดรับราคาแล้ว — อยู่ระหว่างพิจารณา ผลจะแจ้งทางอีเมลและหน้านี้
        </div>
      )}

      {isOpen && (
        <div className="card row">
          <div className="small bold muted">เหลือเวลาเสนอราคา</div>
          <span className={`chip time ${remain < 3600_000 ? 'urgent' : ''}`} style={{ fontSize: 16, padding: '8px 14px' }}>
            {remainText}
          </span>
        </div>
      )}
      {lot.bid_stats && lot.eligible_count != null && lot.status === 'open' && (
        <div className="notice mt12">มีผู้เสนอราคาแล้ว {lot.bid_stats.bid_count}/{lot.eligible_count} ราย</div>
      )}

      {/* รายการเครื่อง */}
      <div className="card">
        <div className="tiny muted black" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          รายการเครื่อง ({items.length})
        </div>
        <table className="itemtable mt8">
          <thead>
            <tr>
              <th>เครื่อง</th>
              <th className="amt">ราคาตั้ง</th>
              {canPerItem && isOpen && <th className="amt">เสนอ (บาท)</th>}
            </tr>
          </thead>
          <tbody>
            {items.map(([jobId, it]) => (
              <tr key={jobId} style={decided && wonItemIds.size > 0 && !wonItemIds.has(jobId) ? { opacity: 0.45 } : undefined}>
                <td>
                  <div
                    className="bold"
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                    onClick={() => setSheetItem({ id: jobId, item: it })}
                  >
                    {it.model}
                    <Info size={13} style={{ color: 'var(--info)', flexShrink: 0 }} />
                    {decided && wonItemIds.has(jobId) && (
                      <span className="pill green" style={{ padding: '2px 8px', fontSize: 10 }}>ของคุณ</span>
                    )}
                  </div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>
                    เกรด {it.grade || '-'}
                    {it.battery_pct != null ? ` · แบต ${it.battery_pct}%` : ''}
                    {it.color ? ` · ${it.color}` : ''}
                    {' · SN '}{it.serial_masked || '-'}
                  </div>
                </td>
                <td className="amt bold money">{fmtBaht(it.asking_price)}</td>
                {canPerItem && isOpen && (
                  <td className="amt">
                    <input
                      className="bid-input"
                      type="number"
                      inputMode="numeric"
                      placeholder="-"
                      value={itemBids[jobId] || ''}
                      onChange={(e) => {
                        setItemBids({ ...itemBids, [jobId]: e.target.value });
                        if (e.target.value) setMode('per_item');
                      }}
                      disabled={mode === 'whole_lot' && !itemBids[jobId]}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {lot.asking_total ? (
          <div className="row mt8 small bold muted">
            <span>ราคาตั้งรวม</span><span className="money">{fmtBaht(lot.asking_total)}</span>
          </div>
        ) : null}
      </div>

      {/* ฟอร์มเสนอราคา */}
      {isOpen ? (
        <div className="card">
          {/* หัวการ์ด navy (ตาม Bidding Card ของ Stitch): ราคาตั้ง + สถานะปิดซอง */}
          <div className="bid-head">
            <div>
              <div className="k">ราคาตั้งรวม</div>
              <div className="v">{lot.asking_total ? fmtBaht(lot.asking_total) : '-'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="k">รูปแบบ</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 700, marginTop: 2 }}>
                <Lock size={13} /> เสนอราคาปิดซอง
              </div>
            </div>
          </div>

          {bidMode === 'both' && (
            <div className="row mt12" style={{ gap: 8 }}>
              <button className={`btn small ${mode === 'whole_lot' ? '' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setMode('whole_lot')}>
                เหมายกล็อต
              </button>
              <button className={`btn small ${mode === 'per_item' ? '' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setMode('per_item')}>
                เลือกรายตัว
              </button>
            </div>
          )}

          {mode === 'whole_lot' && canWhole && (
            <div className="field">
              <label>ยอดเสนอเหมายกล็อต (รวม VAT)</label>
              <div className="input-prefix">
                <span className="cur">฿</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={amountTotal}
                  onChange={(e) => setAmountTotal(e.target.value)}
                  placeholder={lot.asking_total ? lot.asking_total.toLocaleString() : 'ยอดรวมทั้งล็อต'}
                />
              </div>
              {lot.asking_total ? (
                <div className="tiny muted bold mt8" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Info size={11} /> ราคาตั้ง {fmtBaht(lot.asking_total)} — เสนอต่ำกว่าได้ ผู้ขายพิจารณาทุกซอง
                </div>
              ) : null}
            </div>
          )}
          {mode === 'per_item' && canPerItem && (
            <div className="notice mt12">
              กรอกราคาที่ช่อง "เสนอ" ของเครื่องที่ต้องการในตารางด้านบน (ไม่ต้องครบทุกเครื่อง)
              — ยอดรวมที่กรอก: <b className="money">{fmtBaht(perItemTotal)}</b>
            </div>
          )}

          <div className="field">
            <label>หมายเหตุถึงผู้ขาย (ไม่บังคับ)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น รับของเองที่ร้าน" />
          </div>

          <button className="btn" style={{ marginTop: 16 }} onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? 'กำลังส่ง...' : myBid ? 'แก้ไขซองราคา' : 'ส่งซองราคา'} <ArrowRight size={16} />
          </button>
          {msg && <div className={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</div>}

          {/* กล่อง Sealed Bid (ตาม lot-detail.html) */}
          <div className="sealed-box">
            <span className="ic"><Lock size={17} /></span>
            <span>
              <b>การเสนอราคาแบบปิดซอง</b> — ไม่มีผู้ใดเห็นราคาของคุณ (รวมถึงเจ้าหน้าที่)
              จนกว่าจะปิดรับราคาและเปิดซองโดยผู้มีอำนาจ ทุกการแก้ไขถูกบันทึกประวัติ
            </span>
          </div>
        </div>
      ) : (
        !decided && myBid && (
          <div className="card">
            <div className="tiny muted black" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>ซองของคุณ ({myBid.bid_no})</div>
            <div className="bold mt8">
              {myBid.type === 'whole_lot'
                ? <>เหมายกล็อต <span className="money">{fmtBaht(myBid.amount_total)}</span></>
                : <>รายตัว {Object.keys(myBid.item_bids || {}).length} เครื่อง รวม <span className="money">{fmtBaht(Object.values(myBid.item_bids || {}).reduce((s, v) => s + v, 0))}</span></>}
            </div>
            <div className="tiny muted bold mt8">
              ส่งล่าสุด {fmtDateTime(myBid.updated_at)}{myBid.updated_by ? ` โดย ${myBid.updated_by}` : ''}
            </div>
          </div>
        )
      )}

      {sheetItem && <DeviceSheet id={sheetItem.id} item={sheetItem.item} onClose={() => setSheetItem(null)} />}
    </div>
  );
};

// ─── Diagnostic Report รายเครื่อง (bottom sheet) — โครงตาม specs.html + จอ Detailed Diagnostic Report ───
const RING_R = 48;
const RING_C = 2 * Math.PI * RING_R;

const DeviceSheet = ({ item, onClose }: { id: string; item: LotItem; onClose: () => void }) => {
  const checks = Object.entries(item.qc_checks || {});
  const passed = checks.filter(([, v]) => v).length;
  const clean = Object.entries(item.clean_status || {});
  const bat = item.battery_pct;
  const batLow = bat != null && bat < 80;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="label-caps muted">Diagnostic Report</div>
          <button className="btn ghost small" onClick={onClose} style={{ padding: 7 }}><X size={16} /></button>
        </div>

        {/* hero navy (ตาม mesh hero ของ specs.html) */}
        <div className="hero-card">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 19, fontWeight: 800, lineHeight: 1.3 }}>{item.model}</div>
              <div className="tiny bold" style={{ color: 'rgba(255,255,255,0.65)', marginTop: 3 }}>
                {[item.capacity, item.color].filter(Boolean).join(' · ') || 'สเปกตามรายการ'}
              </div>
            </div>
            {item.grade && <span className="glass-badge">เกรด {item.grade}</span>}
          </div>
          <div className="row mt12" style={{ justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap' }}>
            <span className="glass-chip">{item.ref_no}</span>
            <span className="glass-chip">SN {item.serial_masked || '-'}</span>
            {item.model_code && <span className="glass-chip">{item.model_code}</span>}
          </div>
          <div className="hero-specs">
            {bat != null && (
              <div>
                <div className="k">สุขภาพแบต</div>
                <div className={`v ${batLow ? '' : 'ok'}`}>{bat}%{batLow ? '' : ' '}{!batLow && <CheckCircle2 size={13} />}</div>
              </div>
            )}
            {item.asking_price != null && (
              <div><div className="k">ราคาตั้ง</div><div className="v money">{fmtBaht(item.asking_price)}</div></div>
            )}
            {checks.length > 0 && (
              <div><div className="k">ผลตรวจการทำงาน</div><div className={`v ${passed === checks.length ? 'ok' : ''}`}>{passed}/{checks.length} ผ่าน</div></div>
            )}
            {item.warranty_days != null && (
              <div><div className="k">ประกันร้าน</div><div className="v">{item.warranty_days} วัน</div></div>
            )}
          </div>
          {item.qc_date ? (
            <div className="tiny bold mt12" style={{ color: 'rgba(255,255,255,0.5)' }}>
              ตรวจสภาพเมื่อ {fmtDateTime(item.qc_date)}
              {item.qc_passed === false ? ' · พบตำหนิ — ดูหมายเหตุด้านล่าง' : item.qc_passed ? ' · ผ่านการตรวจ QC' : ''}
            </div>
          ) : null}
        </div>

        {/* Battery & Power Health — วงแหวน % (ตาม specs.html) */}
        {bat != null && (
          <>
            <div className="sec-head">
              <span className="ic"><BatteryCharging size={17} /></span> แบตเตอรี่
            </div>
            <div className="bat-wrap">
              <div className="ring-wrap">
                <svg width="116" height="116" viewBox="0 0 116 116">
                  <circle className="ring-track" cx="58" cy="58" r={RING_R} fill="transparent" strokeWidth="8" />
                  <circle
                    className={`ring-val ${batLow ? 'low' : ''}`}
                    cx="58" cy="58" r={RING_R} fill="transparent" strokeWidth="9" strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - Math.min(100, Math.max(0, bat)) / 100)}
                  />
                </svg>
                <div className="txt">
                  <span className="pct">{bat}%</span>
                  <span className="cap">Health</span>
                </div>
              </div>
              <div className="bat-tiles">
                {item.battery_cycles != null && (
                  <div className="bat-tile"><div className="k">รอบชาร์จ</div><div className="v">{item.battery_cycles}</div></div>
                )}
                <div className="bat-tile">
                  <div className="k">สถานะ</div>
                  <div className={`v ${batLow ? 'warn' : 'ok'}`}>{batLow ? 'ต่ำกว่าเกณฑ์ 80%' : 'ปกติ'}</div>
                </div>
                {item.parts?.battery && (
                  <div className="bat-tile"><div className="k">แบตเตอรี่</div><div className="v" style={{ fontFamily: 'var(--font-body)', fontSize: 13.5 }}>{item.parts.battery}</div></div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Diagnostic Check — แถวผลตรวจ ชื่อซ้าย/สถานะขวา */}
        {checks.length > 0 && (
          <>
            <div className="sec-head">
              <span className="ic"><HeartPulse size={17} /></span> ผลตรวจการทำงาน
              <span className="cnt2">{passed}/{checks.length} ผ่าน</span>
            </div>
            <div className="check-grid">
              {checks.map(([k, v]) => (
                <span key={k} className={`check ${v ? '' : 'bad'}`}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{QC_CHECK_LABEL[k] || k}</span>
                  {v ? <CheckCircle2 className="st" size={16} /> : <XCircle className="st" size={16} />}
                </span>
              ))}
            </div>
          </>
        )}

        {/* สเปก/ชิ้นส่วน */}
        {(item.parts_condition || item.accessories || item.parts?.screen || item.parts?.camera) && (
          <>
            <div className="sec-head"><span className="ic"><Layers size={17} /></span> สภาพเครื่องและชิ้นส่วน</div>
            <div className="spec-grid">
              {item.parts?.screen && <div className="cell"><div className="k">จอ</div><div className="v">{item.parts.screen}</div></div>}
              {item.parts?.camera && <div className="cell"><div className="k">กล้อง</div><div className="v">{item.parts.camera}</div></div>}
              {item.parts_condition && <div className="cell"><div className="k">อะไหล่</div><div className="v">{item.parts_condition}</div></div>}
              {item.accessories && <div className="cell"><div className="k">อุปกรณ์ที่ให้</div><div className="v">{item.accessories}</div></div>}
            </div>
          </>
        )}

        {/* ความพร้อมขายต่อ */}
        {clean.length > 0 && (
          <>
            <div className="sec-head"><span className="ic"><ShieldCheck size={17} /></span> พร้อมขายต่อ</div>
            <div className="check-grid">
              {clean.map(([k, v]) => (
                <span key={k} className={`check ${v ? '' : 'bad'}`}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CLEAN_STATUS_LABEL[k] || k}</span>
                  {v ? <CheckCircle2 className="st" size={16} /> : <XCircle className="st" size={16} />}
                </span>
              ))}
            </div>
          </>
        )}

        {item.qc_notes && (
          <>
            <div className="sec-head"><span className="ic"><Info size={17} /></span> หมายเหตุจากผู้ตรวจ</div>
            <div className="notice mt8">{item.qc_notes}</div>
          </>
        )}

        {checks.length === 0 && bat == null && !item.parts && (
          <div className="notice mt16">เครื่องนี้ยังไม่มีรายงานผลตรวจละเอียดในระบบ — สอบถามเพิ่มเติมได้ที่เจ้าหน้าที่</div>
        )}
      </div>
    </div>
  );
};
