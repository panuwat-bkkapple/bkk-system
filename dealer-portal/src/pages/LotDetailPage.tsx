// รายละเอียดล็อต + ฟอร์มเสนอราคา (ยกล็อต / รายตัว) — แก้ซองได้จนกว่าจะปิดรับ
// ตัวล็อต subscribe realtime ตรงจาก RTDB (rules อนุญาตดีลเลอร์ tier ที่มีสิทธิ์)
// ซองของตัวเองอ่าน/เขียนผ่าน callable เท่านั้น
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { onValue, ref } from 'firebase/database';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { db } from '../firebase';
import { getMyBid, placeBid } from '../api';
import {
  LOT_STATUS_LABEL, fmtBaht, fmtDateTime,
  type LotBidMode, type LotItem, type LotStatus, type MyBid,
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
  const [now, setNow] = useState(Date.now());

  // ฟอร์ม
  const [mode, setMode] = useState<'whole_lot' | 'per_item'>('whole_lot');
  const [amountTotal, setAmountTotal] = useState('');
  const [itemBids, setItemBids] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    const unsub = onValue(
      ref(db, `lots/${id}`),
      (snap) => setLot(snap.val()),
      () => setDenied(true)
    );
    return unsub;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void getMyBid(id).then((res) => {
      setMyBid(res.bid);
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
    }).catch(() => {});
  }, [id]);

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
      const refreshed = await getMyBid(id);
      setMyBid(refreshed.bid);
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: (err as Error)?.message || 'ส่งซองไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <div className="card center muted bold mt16">ล็อตนี้ไม่เปิดสำหรับบัญชีของคุณ</div>;
  if (!lot) return <div className="loading">กำลังโหลด...</div>;

  const meta = LOT_STATUS_LABEL[lot.status] || { label: lot.status, cls: '' };

  return (
    <div>
      <button className="btn ghost small" style={{ marginTop: 16 }} onClick={() => navigate('/')}>
        <ArrowLeft size={14} /> กลับ
      </button>

      <div className="row mt12">
        <span className="mono tiny muted bold">{lot.lot_no}</span>
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
      </div>
      <h1 className="h1" style={{ margin: '6px 0 2px' }}>{lot.title}</h1>
      {lot.description && <div className="small muted bold">{lot.description}</div>}

      {isOpen && (
        <div className="card row">
          <div className="small bold muted">เหลือเวลาเสนอราคา</div>
          <div className="countdown" style={{ fontSize: 18 }}>{remainText}</div>
        </div>
      )}
      {lot.bid_stats && lot.eligible_count != null && (
        <div className="notice mt12">มีผู้เสนอราคาแล้ว {lot.bid_stats.bid_count}/{lot.eligible_count} ราย</div>
      )}

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
              <tr key={jobId}>
                <td>
                  <div className="bold">{it.model}</div>
                  <div className="tiny muted">
                    เกรด {it.grade || '-'}{it.parts_condition ? ` · ${it.parts_condition}` : ''} · SN {it.serial_masked || '-'}
                  </div>
                </td>
                <td className="amt bold">{fmtBaht(it.asking_price)}</td>
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
            <span>ราคาตั้งรวม</span><span>{fmtBaht(lot.asking_total)}</span>
          </div>
        ) : null}
      </div>

      {isOpen ? (
        <div className="card">
          <div className="tiny muted black" style={{ textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} /> เสนอราคา (ปิดซอง)
          </div>

          {bidMode === 'both' && (
            <div className="row mt12" style={{ gap: 8 }}>
              <button className={`btn small ${mode === 'whole_lot' ? 'accent' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setMode('whole_lot')}>
                เหมายกล็อต
              </button>
              <button className={`btn small ${mode === 'per_item' ? 'accent' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setMode('per_item')}>
                เลือกรายตัว
              </button>
            </div>
          )}

          {mode === 'whole_lot' && canWhole && (
            <div className="field">
              <label>ยอดเสนอเหมายกล็อต (บาท รวม VAT)</label>
              <input
                type="number"
                inputMode="numeric"
                value={amountTotal}
                onChange={(e) => setAmountTotal(e.target.value)}
                placeholder={lot.asking_total ? `ราคาตั้ง ${lot.asking_total.toLocaleString()}` : 'ระบุยอดรวมทั้งล็อต'}
              />
            </div>
          )}
          {mode === 'per_item' && canPerItem && (
            <div className="notice mt12">
              กรอกราคาที่ช่อง "เสนอ" ของเครื่องที่ต้องการในตารางด้านบน (ไม่ต้องครบทุกเครื่อง)
              — ยอดรวมที่กรอก: <b>{fmtBaht(perItemTotal)}</b>
            </div>
          )}

          <div className="field">
            <label>หมายเหตุถึงผู้ขาย (ไม่บังคับ)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น รับของเองที่ร้าน" />
          </div>

          <button className="btn accent" style={{ marginTop: 16 }} onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? 'กำลังส่ง...' : myBid ? 'แก้ไขซองราคา' : 'ส่งซองราคา'}
          </button>
          {msg && <div className={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</div>}

          <div className="notice mt12" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              การเสนอราคาเป็นแบบ<b>ปิดซอง</b> — ไม่มีผู้ใดเห็นราคาของคุณ (รวมถึงเจ้าหน้าที่)
              จนกว่าจะปิดรับราคาและเปิดซองโดยผู้มีอำนาจ ทุกการแก้ไขถูกบันทึกประวัติ
            </span>
          </div>
        </div>
      ) : (
        myBid && (
          <div className="card">
            <div className="tiny muted black" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>ซองของคุณ ({myBid.bid_no})</div>
            <div className="bold mt8">
              {myBid.type === 'whole_lot'
                ? `เหมายกล็อต ${fmtBaht(myBid.amount_total)}`
                : `รายตัว ${Object.keys(myBid.item_bids || {}).length} เครื่อง รวม ${fmtBaht(Object.values(myBid.item_bids || {}).reduce((s, v) => s + v, 0))}`}
            </div>
            <div className="tiny muted bold mt8">ส่งล่าสุด {fmtDateTime(myBid.updated_at)} · ปิดรับแล้ว — รอประกาศผลทางอีเมลและหน้าคำสั่งซื้อ</div>
          </div>
        )
      )}
    </div>
  );
};
